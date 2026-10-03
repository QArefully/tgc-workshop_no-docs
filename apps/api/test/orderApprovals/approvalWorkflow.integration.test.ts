import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCompanyInviteRepository } from '../../src/features/companyAccounts/companyInviteRepository.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import { createCompanyRepository } from '../../src/features/companyAccounts/companyRepository.js';
import { createCompanyService } from '../../src/features/companyAccounts/companyService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createApprovalRepository } from '../../src/features/orderApprovals/approvalRepository.js';
import { createApprovalService } from '../../src/features/orderApprovals/approvalService.js';

void test('approval decisions enforce approver role and company non-disclosure', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-approval-workflow-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const now = new Date('2026-07-29T12:00:00.000Z');
  const clock = { now: () => now };
  const unitOfWork = createUnitOfWork(db);
  const mailbox = createMailboxRepository(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const companies = createCompanyService({
    companies: createCompanyRepository(db),
    memberships: createCompanyMembershipRepository(db),
    invites: createCompanyInviteRepository(db),
    mailbox,
    unitOfWork,
    audit,
    clock,
    baseUrl: 'http://example.test/',
    tokenSource: () => 'approval-invite-token',
  });
  const approvals = createApprovalService({
    approvals: createApprovalRepository(db),
    companies,
    mailbox,
    unitOfWork,
    audit,
    clock,
  });
  const addUser = (email: string, country: 'DE' | 'FR' = 'DE') =>
    Number(
      (
        db
          .prepare(
            `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
           VALUES (?, 'User', 'hash', 'salt', 'customer', ?) RETURNING id`,
          )
          .get(email, country) as { id: number }
      ).id,
    );
  const owner = addUser('owner@example.test', 'DE');
  const buyer = addUser('buyer@example.test', 'DE');
  const approver = addUser('approver@example.test', 'FR');
  const ordinaryMember = addUser('ordinary@example.test', 'DE');
  const outsider = addUser('outsider@example.test', 'FR');
  const company = Number(
    db
      .prepare(
        `INSERT INTO company_accounts
           (country, name, created_by_user_id, approval_threshold_cents, created_at, updated_at)
         VALUES ('DE', 'Co', ?, 0, ?, ?) RETURNING id`,
      )
      .get(owner, now.toISOString(), now.toISOString()).id,
  );
  for (const [userId, role] of [
    [owner, 'owner'],
    [buyer, 'buyer'],
    [approver, 'approver'],
    [ordinaryMember, 'buyer'],
  ] as const) {
    db.prepare(
      `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(company, userId, role, now.toISOString());
  }
  const invite = companies.inviteMember(owner, 'new-buyer@example.test', 'buyer', {
    actor: { type: 'user', userId: owner },
    requestId: 'invite-request',
  });
  assert.equal(invite.ok, true);
  assert.deepEqual(
    db
      .prepare(
        `SELECT recipient, subject, body, template_key, template_country, template_params_json
         FROM dev_mailbox WHERE template_key = 'company_invite'`,
      )
      .get(),
    {
      recipient: 'new-buyer@example.test',
      subject: 'Einladung zu Co',
      body: 'Nehmen Sie Ihre buyer-Einladung an: http://example.test/invites/accept?token=approval-invite-token. Die Einladung l\u00e4uft am 2026-08-05T12:00:00.000Z ab.',
      template_key: 'company_invite',
      template_country: 'DE',
      template_params_json: JSON.stringify({
        companyName: 'Co',
        inviteUrl: 'http://example.test/invites/accept?token=approval-invite-token',
        role: 'buyer',
        expiresAt: '2026-08-05T12:00:00.000Z',
      }),
    },
  );
  const evaluated = approvals.evaluate({
    userId: buyer,
    cartId: '1c0a91c8-20b8-4e9c-8c57-96d6b8a4999d',
    quoteTotalCents: 100_000,
    resolvedCommitments: {
      deliverySiteId: null,
      deliveryAddress: { line1: '1 Street', city: 'Town', postcode: 'AB1 2CD', countryCode: 'GB' },
      billingEntity: {
        legalName: 'Buyer Ltd',
        registrationNumber: null,
        vatNumber: null,
        address: { line1: '1 Street', city: 'Town', postcode: 'AB1 2CD', countryCode: 'GB' },
      },
      deliverySlot: { date: '2026-08-05', window: 'am' },
      purchaseOrderReference: null,
    },
    idempotencyKey: 'b547e4d7-9f1a-4d25-878c-299bb33bd198',
    context: { actor: { type: 'user', userId: buyer }, requestId: 'request' },
  });
  assert.equal(evaluated.gate, 'defer');
  if (evaluated.gate !== 'defer') throw new Error('Expected deferral');
  const approvalId = Number(evaluated.approvalRequestId);
  assert.deepEqual(
    db
      .prepare(
        `SELECT recipient, subject, body, kind, template_key, template_country, template_params_json
         FROM dev_mailbox WHERE template_key = 'order_approval_request' ORDER BY recipient`,
      )
      .all(),
    [
      {
        recipient: 'approver@example.test',
        kind: 'template',
        template_key: 'order_approval_request',
        template_country: 'FR',
        subject: 'Approbation de commande requise pour Co',
        body: `La demande d\u2019approbation n\u00b0 ${approvalId} attend votre examen. Total : 100000 pence.`,
        template_params_json: JSON.stringify({
          companyName: 'Co',
          approvalRequestId: String(approvalId),
          totalCents: 100_000,
        }),
      },
      {
        recipient: 'owner@example.test',
        kind: 'template',
        template_key: 'order_approval_request',
        template_country: 'DE',
        subject: 'Bestellfreigabe f\u00fcr Co erforderlich',
        body: `Freigabeanfrage Nr. ${approvalId} wartet auf Pr\u00fcfung. Gesamt: 100000 Pence.`,
        template_params_json: JSON.stringify({
          companyName: 'Co',
          approvalRequestId: String(approvalId),
          totalCents: 100_000,
        }),
      },
    ],
  );
  assert.equal(
    approvals.decide(ordinaryMember, approvalId, 'approve', undefined, {
      actor: { type: 'user', userId: ordinaryMember },
      requestId: 'ordinary',
    }).code,
    'NOT_APPROVER',
  );
  assert.equal(
    approvals.decide(outsider, approvalId, 'approve', undefined, {
      actor: { type: 'user', userId: outsider },
      requestId: 'outsider',
    }).code,
    'APPROVAL_NOT_FOUND',
  );
  assert.equal(
    approvals.decide(approver, approvalId, 'reject', 'Insufficient budget', {
      actor: { type: 'user', userId: approver },
      requestId: 'approver',
    }).ok,
    true,
  );
  assert.equal(
    approvals.evaluate({
      userId: buyer,
      cartId: '1c0a91c8-20b8-4e9c-8c57-96d6b8a4999d',
      quoteTotalCents: 100_000,
      resolvedCommitments: {
        deliverySiteId: null,
        deliveryAddress: {
          line1: '1 Street',
          city: 'Town',
          postcode: 'AB1 2CD',
          countryCode: 'GB',
        },
        billingEntity: {
          legalName: 'Buyer Ltd',
          registrationNumber: null,
          vatNumber: null,
          address: { line1: '1 Street', city: 'Town', postcode: 'AB1 2CD', countryCode: 'GB' },
        },
        deliverySlot: { date: '2026-08-05', window: 'am' },
        purchaseOrderReference: null,
      },
      idempotencyKey: 'b547e4d7-9f1a-4d25-878c-299bb33bd198',
      context: { actor: { type: 'user', userId: buyer }, requestId: 'retry' },
    }).gate,
    'rejected',
  );
});
