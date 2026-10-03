import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createPasswordResetRepository } from '../../src/features/passwordReset/passwordResetRepository.js';
import { createPasswordResetService } from '../../src/features/passwordReset/passwordResetService.js';

void test('password reset never restores tombstoned account credentials', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-deleted-reset-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const now = new Date('2026-07-29T12:00:00.000Z');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const userId = Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
           VALUES ('deleted-1@tombstone.local', 'Deleted User', '', '', 'customer', ?)
           RETURNING id`,
        )
        .get(now.toISOString()) as { id: number }
    ).id,
  );
  const token = 'stale-reset-token';
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token_digest, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    userId,
    createHash('sha256').update(token).digest('hex'),
    new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    now.toISOString(),
  );
  const mailbox = createMailboxRepository(db);
  const resets = createPasswordResetService({
    repository: createPasswordResetRepository(db),
    mailbox,
    clock: { now: () => now },
    baseUrl: 'https://web.example.test',
  });

  resets.request('deleted-1@tombstone.local', 'UK');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS total FROM dev_mailbox').get() as { total: number }).total,
    0,
  );
  assert.equal(
    await resets.reset({ token, newPassword: 'replacement-password-123' }),
    'INVALID_TOKEN',
  );
  assert.deepEqual(
    db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId),
    {
      password_hash: '',
      password_salt: '',
    },
  );
});

void test('password reset persists translated DE and FR template snapshots', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-reset-localised-mail-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const now = new Date('2026-08-03T12:00:00.000Z');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const addUser = (email: string, country: 'DE' | 'FR') =>
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
         VALUES (?, 'Buyer', 'hash', 'salt', 'customer', ?)
         RETURNING id`,
      )
      .get(email, country) as { id: number };
  addUser('reset-de@example.test', 'DE');
  addUser('reset-fr@example.test', 'FR');

  const tokens = ['de-reset-token', 'fr-reset-token'];
  const mailbox = createMailboxRepository(db);
  const resets = createPasswordResetService({
    repository: createPasswordResetRepository(db),
    mailbox,
    clock: { now: () => now },
    baseUrl: 'https://web.example.test',
    tokenSource: () => tokens.shift() ?? 'unexpected-token',
  });
  resets.request('reset-de@example.test', 'DE');
  resets.request('reset-fr@example.test', 'FR');

  assert.deepEqual(
    db
      .prepare(
        `SELECT recipient, subject, body, template_key, template_country, template_params_json
         FROM dev_mailbox WHERE template_key = 'password_reset' ORDER BY recipient`,
      )
      .all(),
    [
      {
        recipient: 'reset-de@example.test',
        subject: 'Anfrage zum Zur\u00fccksetzen des Passworts',
        body: 'Verwenden Sie diesen Link, um Ihr Passwort zur\u00fcckzusetzen: https://web.example.test/reset-password?token=de-reset-token',
        template_key: 'password_reset',
        template_country: 'DE',
        template_params_json: JSON.stringify({
          resetUrl: 'https://web.example.test/reset-password?token=de-reset-token',
        }),
      },
      {
        recipient: 'reset-fr@example.test',
        subject: 'Demande de r\u00e9initialisation du mot de passe',
        body: 'Utilisez ce lien pour r\u00e9initialiser votre mot de passe : https://web.example.test/reset-password?token=fr-reset-token',
        template_key: 'password_reset',
        template_country: 'FR',
        template_params_json: JSON.stringify({
          resetUrl: 'https://web.example.test/reset-password?token=fr-reset-token',
        }),
      },
    ],
  );
});
