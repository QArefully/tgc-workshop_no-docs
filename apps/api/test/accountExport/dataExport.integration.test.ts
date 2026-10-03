import assert from 'node:assert/strict';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createDataExportService } from '../../src/features/accountExport/dataExportService.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createSessionRepository } from '../../src/features/auth/sessionRepository.js';
import { createSessionService } from '../../src/features/auth/sessionService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCartService } from '../../src/features/cart/cartService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createOrderService } from '../../src/features/orders/orderService.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createPreferencesRepository } from '../../src/features/preferences/preferencesRepository.js';
import { createPreferencesService } from '../../src/features/preferences/preferencesService.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import { createSavedListRepository } from '../../src/features/savedLists/savedListRepository.js';
import { createSavedListService } from '../../src/features/savedLists/savedListService.js';
import { authPlugin } from '../../src/plugins/auth.js';
import accountExportRoutes from '../../src/routes/accountExport.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

function assertNoSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecrets);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    assert.doesNotMatch(key, /(password|salt|token|fingerprint)/i, `secret key ${key} leaked`);
    assertNoSecrets(nested);
  }
}

type TestDb = ReturnType<typeof openSeededDatabase>['db'];

function insertTradeCreditInvoice(input: {
  db: TestDb;
  userId: number;
  companyId: number;
  orderId: number;
  invoiceId: number;
  invoiceNumber: string;
  paymentKey: string;
  country: 'DE' | 'FR';
  status: 'open' | 'paid';
  issuedAt: string;
  settledAt?: string;
}): void {
  const {
    db,
    userId,
    companyId,
    orderId,
    invoiceId,
    invoiceNumber,
    paymentKey,
    country,
    status,
    issuedAt,
    settledAt = undefined,
  } = input;
  if (status === 'paid' && settledAt === undefined) {
    throw new Error('paid invoice fixture requires settledAt');
  }
  const effectiveSettledAt = status === 'paid' ? settledAt! : null;
  const dueAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const billingEntity = {
    legalName: 'Shared Materials Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: {
      line1: '1 Export Road',
      city: 'Leeds',
      postcode: 'LS1 1AA',
      countryCode: 'GB',
    },
  };
  db.prepare(
    `INSERT INTO orders
       (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
        total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
        company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents,
        billing_entity_json, purchase_order_reference)
     VALUES (?, ?, ?, '1 Export Road', 1000, 0, 1200, ?, ?, 'processing', 0, ?, 'trade_credit',
             ?, 1000, 2000, 200, 1200, ?, 'PO-EXPORT')`,
  ).run(
    orderId,
    country === 'DE' ? 'Buyer Name' : 'Other Buyer',
    country === 'DE' ? 'buyer@example.test' : 'other@example.test',
    issuedAt,
    userId,
    country,
    companyId,
    JSON.stringify(billingEntity),
  );
  db.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
        discountable_total_cents, blending_fee_cents)
     VALUES (?, 1, 'Export Material', 1000, 1, 1000, 1000, 0)`,
  ).run(orderId);
  db.prepare(
    `INSERT INTO payments
       (order_id, idempotency_key, request_fingerprint, status, amount_cents,
        card_last4, card_brand, created_at, payment_method, company_id, user_id)
     VALUES (?, ?, ?, 'succeeded', 1200, NULL, NULL, ?, 'trade_credit', ?, ?)`,
  ).run(orderId, paymentKey, `${paymentKey}-fingerprint`, issuedAt, companyId, userId);
  const document = {
    version: 1,
    id: String(invoiceId),
    invoiceNumber,
    orderId: String(orderId),
    companyId: String(companyId),
    userId: String(userId),
    country,
    paymentMethod: 'trade_credit' as const,
    currency: 'GBP' as const,
    terms: 'net_30' as const,
    billingEntity,
    purchaseOrderReference: 'PO-EXPORT',
    paymentIdempotencyKey: paymentKey,
    lines: [
      {
        lineId: String(orderId),
        description: 'Export Material',
        productId: '1',
        quantity: 1,
        unitPriceCents: 1000,
        netCents: 1000,
      },
    ],
    netCents: 1000,
    vatRateBasisPoints: 2000,
    vatCents: 200,
    grossCents: 1200,
    issuedAt,
    dueAt,
  };
  db.prepare(
    `INSERT INTO invoices
       (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
        country, currency, terms, terms_days, document_json, net_cents,
        vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'GBP', 'net_30', 30, ?, 1000, 2000, 200, 1200, ?, ?)`,
  ).run(
    invoiceId,
    invoiceNumber,
    orderId,
    paymentKey,
    companyId,
    userId,
    country,
    JSON.stringify(document),
    issuedAt,
    dueAt,
  );
  db.prepare(
    `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    invoiceId,
    status,
    status === 'paid' ? 1 : 0,
    effectiveSettledAt,
    effectiveSettledAt ?? issuedAt,
  );
  db.prepare(
    `INSERT INTO invoice_events (invoice_id, event_type, occurred_at, idempotency_key)
     VALUES (?, 'issued', ?, NULL)`,
  ).run(invoiceId, issuedAt);
  if (status === 'paid') {
    db.prepare(
      `INSERT INTO invoice_events
         (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint)
       VALUES (?, 'settled', ?, ?, ?)`,
    ).run(
      invoiceId,
      effectiveSettledAt,
      paymentKey.replace(/001$|002$/, '101'),
      `${paymentKey}-settlement-fingerprint`,
    );
  }
}

void test('data export is caller-scoped, allowlisted, mailed, and audited', async (t) => {
  const database = openSeededDatabase();
  const db = database.db;
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const unitOfWork = createUnitOfWork(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const sessions = createSessionService({
    sessions: createSessionRepository(db),
    clock,
    unitOfWork,
    audit,
  });
  const preferences = createPreferencesService({
    repository: createPreferencesRepository(db),
    unitOfWork,
    audit,
    clock,
  });
  const orders = createOrderRepository(db);
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const carts = createCartService(
    createCartRepository(db),
    { unitOfWork, audit },
    { inventory, clock },
  );
  const savedLists = createSavedListService({
    repository: createSavedListRepository(db),
    variants: createProductRepository(db),
    inventory,
    carts,
    orders: createOrderService({ repository: orders, unitOfWork, clock, audit, inventory }),
    unitOfWork,
    audit,
    clock,
  });
  const mailbox = createMailboxRepository(db);
  const dataExport = createDataExportService({
    unitOfWork,
    audit,
    clock,
    sessions,
    orders,
    savedLists,
    deliverySites: createDeliverySiteRepository(db),
    billingEntities: createBillingEntityRepository(db),
    preferences,
    mailbox,
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(accountExportRoutes, { services: { sessions, dataExport } });
  t.after(async () => {
    await app.close();
    await database.cleanup();
  });

  const callerId = Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
           VALUES ('buyer@example.test', 'Buyer Name', 'super-secret-hash', 'secret-salt', 'customer', 'DE')
           RETURNING id`,
        )
        .get() as { id: number }
    ).id,
  );
  const foreignId = Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
           VALUES ('other@example.test', 'Other Buyer', 'other-hash', 'other-salt', 'customer', 'FR')
           RETURNING id`,
        )
        .get() as { id: number }
    ).id,
  );
  const siteRepository = createDeliverySiteRepository(db);
  siteRepository.insert({
    user_id: callerId,
    label: 'Main Yard',
    contact_name: 'Buyer Name',
    contact_phone: null,
    address_line1: '1 Export Road',
    address_line2: null,
    address_city: 'Leeds',
    address_region: null,
    address_postcode: 'LS1 1AA',
    address_country_code: 'GB',
    is_default: true,
    now: '2026-07-29T10:00:00.000Z',
  });
  siteRepository.insert({
    user_id: foreignId,
    label: 'Foreign Yard',
    contact_name: 'Other Buyer',
    contact_phone: null,
    address_line1: '2 Foreign Road',
    address_line2: null,
    address_city: 'York',
    address_region: null,
    address_postcode: 'YO1 1AA',
    address_country_code: 'GB',
    is_default: true,
    now: '2026-07-29T10:00:00.000Z',
  });
  const billingRepository = createBillingEntityRepository(db);
  billingRepository.insert({
    user_id: callerId,
    legal_name: 'Buyer Materials Ltd',
    registration_number: '12345678',
    vat_number: null,
    address_line1: '1 Export Road',
    address_line2: null,
    address_city: 'Leeds',
    address_region: null,
    address_postcode: 'LS1 1AA',
    address_country_code: 'GB',
    is_default: true,
    now: '2026-07-29T10:00:00.000Z',
  });
  orders.create({
    customerName: 'Buyer Name',
    customerEmail: 'buyer@example.test',
    shippingAddress: '1 Export Road, Leeds, LS1 1AA',
    promoApplied: null,
    subtotalCents: 1000,
    discountCents: 0,
    totalCents: 1000,
    userId: callerId,
    createdAt: '2026-07-29T11:00:00.000Z',
    items: [
      {
        productId: '1',
        productName: 'Export Material',
        unitPriceCents: 1000,
        quantity: 1,
        discountableTotalCents: 1000,
        blendingFeeCents: 0,
        lineTotalCents: 1000,
        variantSnapshot: {
          variantId: 1,
          sku: 'EXPORT-001',
          label: '25 kg sack',
          weightGrams: 25_000,
          consumptionClassification: 'non-food',
          deliveryClass: 'freight',
        },
        customBlend: {
          configKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          basePercentage: 80,
          mixingGroup: 'trade-mortar',
          ingredients: [
            {
              variantId: 2,
              productId: '2',
              productName: 'Blend Ingredient',
              productDescription: 'A frozen export ingredient.',
              mixingGroup: 'trade-mortar',
              percentage: 20,
            },
          ],
          blendingFeeCents: 0,
          madeToOrder: true,
          returnable: false,
        },
      },
    ],
  });
  orders.create({
    customerName: 'Other Buyer',
    customerEmail: 'other@example.test',
    shippingAddress: '2 Foreign Road, York, YO1 1AA',
    promoApplied: null,
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    userId: foreignId,
    createdAt: '2026-07-29T11:01:00.000Z',
    items: [
      {
        productId: '2',
        productName: 'Foreign Material',
        unitPriceCents: 500,
        quantity: 1,
        discountableTotalCents: 500,
        blendingFeeCents: 0,
        lineTotalCents: 500,
      },
    ],
  });
  preferences.update(
    callerId,
    { marketingEmail: true },
    {
      actor: { type: 'user', userId: callerId },
      requestId: 'preferences-before-export',
    },
  );
  const savedListContext = {
    actor: { type: 'user' as const, userId: callerId },
    requestId: 'export-list',
  };
  const createdList = savedLists.create(callerId, 'Export materials', savedListContext);
  assert.equal(createdList.ok, true);
  if (!createdList.ok) assert.fail('Expected export saved list to be created');
  const addedItem = savedLists.addItem(
    callerId,
    Number(createdList.value.listId),
    1,
    2,
    savedListContext,
  );
  assert.equal(addedItem.ok, true);
  const callerSession = sessions.create(callerId);
  const foreignSession = sessions.create(foreignId);

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/account/export' });
  assert.equal(unauthenticated.statusCode, 401);

  const response = await app.inject({
    method: 'GET',
    url: '/api/account/export',
    headers: { cookie: `sid=${callerSession.token}` },
  });
  assert.equal(response.statusCode, 200, response.body);
  const snapshot = JSON.parse(response.body) as Record<string, unknown>;
  assertNoSecrets(snapshot);
  // `profile` is the shared PublicUser shape, which carries `country` since migration 032.
  assert.deepEqual(snapshot.profile, {
    id: String(callerId),
    email: 'buyer@example.test',
    displayName: 'Buyer Name',
    role: 'customer',
    country: 'DE',
  });
  assert.equal((snapshot.deliverySites as Array<{ label: string }>).length, 1);
  assert.equal((snapshot.deliverySites as Array<{ label: string }>)[0]!.label, 'Main Yard');
  assert.equal((snapshot.orders as Array<{ id: string }>).length, 1);
  assert.equal((snapshot.customBlends as unknown[]).length, 1);
  assert.deepEqual(
    (
      snapshot.savedLists as Array<{
        listId: string;
        name: string;
        items: Array<{ quantity: number }>;
      }>
    ).map((list) => ({
      listId: list.listId,
      name: list.name,
      itemCount: list.items.length,
      quantity: list.items[0]?.quantity,
    })),
    [{ listId: createdList.value.listId, name: 'Export materials', itemCount: 1, quantity: 2 }],
  );
  assert.equal((snapshot.preferences as { marketingEmail: boolean }).marketingEmail, true);
  assert.equal((snapshot.sessions as Array<{ sessionId: string }>).length, 1);
  assert.deepEqual(snapshot.companyMemberships, []);

  const foreignResponse = await app.inject({
    method: 'GET',
    url: '/api/account/export',
    headers: { cookie: `sid=${foreignSession.token}` },
  });
  assert.equal(foreignResponse.statusCode, 200, foreignResponse.body);
  assert.equal(
    (JSON.parse(foreignResponse.body) as { profile: { country: string } }).profile.country,
    'FR',
  );

  assert.deepEqual(
    db
      .prepare(
        `SELECT recipient, subject, body, kind, template_key, template_country, template_params_json
           FROM dev_mailbox WHERE template_key = 'data_export_ready' ORDER BY recipient`,
      )
      .all(),
    [
      {
        recipient: 'buyer@example.test',
        subject: 'QArefully Materials Exchange \u2014 Datenexport',
        body: 'Ihr Datenexport ist in Ihrem QArefully-Materials-Exchange-Konto verf\u00fcgbar.',
        kind: 'template',
        template_key: 'data_export_ready',
        template_country: 'DE',
        template_params_json: '{}',
      },
      {
        recipient: 'other@example.test',
        subject: 'QArefully Materials Exchange \u2014 export de donn\u00e9es',
        body: 'Votre export de donn\u00e9es est disponible dans votre compte QArefully Materials Exchange.',
        kind: 'template',
        template_key: 'data_export_ready',
        template_country: 'FR',
        template_params_json: '{}',
      },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT action, actor_user_id, entity_type, entity_id
         FROM audit_events WHERE action = 'auth.data_exported' ORDER BY actor_user_id`,
      )
      .all(),
    [
      {
        action: 'auth.data_exported',
        actor_user_id: callerId,
        entity_type: 'user',
        entity_id: String(callerId),
      },
      {
        action: 'auth.data_exported',
        actor_user_id: foreignId,
        entity_type: 'user',
        entity_id: String(foreignId),
      },
    ],
  );
});

void test('owned export line loading exceeds SQLite variable-list limits without leaking foreign lines', (t) => {
  const database = openSeededDatabase();
  const db = database.db;
  t.after(database.cleanup);

  const callerId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role)
         VALUES ('export-scale@example.test', 'Export Scale', 'hash', 'salt', 'customer')`,
      )
      .run().lastInsertRowid,
  );
  const foreignId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role)
         VALUES ('export-foreign@example.test', 'Export Foreign', 'hash', 'salt', 'customer')`,
      )
      .run().lastInsertRowid,
  );
  const ownedOrderCount = 32_768;
  const firstOwnedOrderId = Number(
    (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM orders').get() as { next: number })
      .next,
  );

  db.prepare(
    `WITH RECURSIVE sequence(value) AS (
       VALUES(1)
       UNION ALL
       SELECT value + 1 FROM sequence WHERE value < ?
     )
     INSERT INTO orders
       (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, user_id, created_at)
     SELECT 'Export Scale', 'export-scale@example.test', '1 Export Road', 100, 100, ?,
            '2026-07-29T12:00:00.000Z'
     FROM sequence`,
  ).run(ownedOrderCount, callerId);
  const foreignOrderId = Number(
    db
      .prepare(
        `INSERT INTO orders
       (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, user_id, created_at)
     VALUES ('Export Foreign', 'export-foreign@example.test', '2 Foreign Road', 100, 100, ?,
             '2026-07-29T12:00:00.000Z')`,
      )
      .run(foreignId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
        discountable_total_cents, blending_fee_cents)
     SELECT id, 1, 'Export Material', 100, 1, 100, 100, 0
     FROM orders WHERE user_id = ?`,
  ).run(callerId);
  db.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
        discountable_total_cents, blending_fee_cents)
     SELECT id, 2, 'Foreign Material', 100, 1, 100, 100, 0
     FROM orders WHERE user_id = ?`,
  ).run(foreignId);

  const exported = createOrderRepository(db).listExportOwned(callerId);

  assert.equal(exported.length, ownedOrderCount);
  assert.equal(exported[0]?.id, String(firstOwnedOrderId));
  assert.equal(exported.at(-1)?.id, String(firstOwnedOrderId + ownedOrderCount - 1));
  assert.ok(exported.every((order) => order.id !== String(foreignOrderId)));
  assert.equal(exported[0]?.items[0]?.productName, 'Export Material');
  assert.equal(exported.at(-1)?.items[0]?.productName, 'Export Material');
  assert.ok(exported.every((order) => order.items.length === 1));
});

void test('data export includes only the caller invoice with safe lifecycle settlement state', async (t) => {
  const database = openSeededDatabase();
  const db = database.db;
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const unitOfWork = createUnitOfWork(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const sessions = createSessionService({
    sessions: createSessionRepository(db),
    clock,
    unitOfWork,
    audit,
  });
  const preferences = createPreferencesService({
    repository: createPreferencesRepository(db),
    unitOfWork,
    audit,
    clock,
  });
  const orders = createOrderRepository(db);
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const carts = createCartService(
    createCartRepository(db),
    { unitOfWork, audit },
    { inventory, clock },
  );
  const savedLists = createSavedListService({
    repository: createSavedListRepository(db),
    variants: createProductRepository(db),
    inventory,
    carts,
    orders: createOrderService({ repository: orders, unitOfWork, clock, audit, inventory }),
    unitOfWork,
    audit,
    clock,
  });
  const mailbox = createMailboxRepository(db);
  const dataExport = createDataExportService({
    unitOfWork,
    audit,
    clock,
    sessions,
    orders,
    invoices: createInvoiceRepository(db),
    savedLists,
    deliverySites: createDeliverySiteRepository(db),
    billingEntities: createBillingEntityRepository(db),
    preferences,
    mailbox,
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(accountExportRoutes, { services: { sessions, dataExport } });
  t.after(async () => {
    await app.close();
    await database.cleanup();
  });

  const buyerId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
         VALUES ('buyer@example.test', 'Buyer Name', 'hash', 'salt', 'customer', 'DE')`,
      )
      .run().lastInsertRowid,
  );
  const foreignId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, country)
         VALUES ('other@example.test', 'Other Buyer', 'hash', 'salt', 'customer', 'FR')`,
      )
      .run().lastInsertRowid,
  );
  const companyId = Number(
    db
      .prepare(
        `INSERT INTO company_accounts
           (name, created_by_user_id, active, created_at, updated_at, country)
         VALUES ('Shared Export Co', ?, 1, ?, ?, 'UK')`,
      )
      .run(buyerId, '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:00.000Z').lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
     VALUES (?, ?, 'owner', 1, ?), (?, ?, 'buyer', 1, ?)`,
  ).run(
    companyId,
    buyerId,
    '2026-07-29T10:00:00.000Z',
    companyId,
    foreignId,
    '2026-07-29T10:00:00.000Z',
  );
  const firstOrderId = Number(
    (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM orders').get() as { next: number })
      .next,
  );
  const firstInvoiceId = Number(
    (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM invoices').get() as { next: number })
      .next,
  );
  insertTradeCreditInvoice({
    db,
    userId: buyerId,
    companyId,
    orderId: firstOrderId,
    invoiceId: firstInvoiceId,
    invoiceNumber: 'QME-2026-000901',
    paymentKey: '123e4567-e89b-42d3-a456-426614174001',
    country: 'DE',
    status: 'paid',
    issuedAt: '2026-07-29T10:00:00.000Z',
    settledAt: '2026-07-29T11:00:00.000Z',
  });
  insertTradeCreditInvoice({
    db,
    userId: foreignId,
    companyId,
    orderId: firstOrderId + 1,
    invoiceId: firstInvoiceId + 1,
    invoiceNumber: 'QME-2026-000902',
    paymentKey: '123e4567-e89b-42d3-a456-426614174002',
    country: 'FR',
    status: 'open',
    issuedAt: '2026-07-29T10:01:00.000Z',
  });

  const buyerSession = sessions.create(buyerId);
  const buyerResponse = await app.inject({
    method: 'GET',
    url: '/api/account/export',
    headers: { cookie: `sid=${buyerSession.token}` },
  });
  assert.equal(buyerResponse.statusCode, 200, buyerResponse.body);
  const buyerSnapshot = JSON.parse(buyerResponse.body) as {
    invoices: Array<Record<string, unknown>>;
  };
  assert.equal(buyerSnapshot.invoices.length, 1);
  const exported = buyerSnapshot.invoices[0]!;
  assert.equal(exported.invoiceNumber, 'QME-2026-000901');
  assert.equal(exported.status, 'paid');
  assert.equal(exported.settledAt, '2026-07-29T11:00:00.000Z');
  assert.equal('paymentIdempotencyKey' in exported, false);
  assert.equal('lifecycle' in exported, false);
  assert.equal('lifecycleVersion' in exported, false);
  assert.equal('settlement' in exported, false);
  assert.equal('events' in exported, false);
  assert.deepEqual(Object.keys(exported).sort(), [
    'billingEntity',
    'companyId',
    'country',
    'currency',
    'dueAt',
    'grossCents',
    'id',
    'invoiceNumber',
    'issuedAt',
    'lines',
    'netCents',
    'orderId',
    'paymentMethod',
    'purchaseOrderReference',
    'settledAt',
    'status',
    'terms',
    'userId',
    'vatCents',
    'vatRateBasisPoints',
    'version',
  ]);
  assert.deepEqual(Object.keys((exported.lines as Array<Record<string, unknown>>)[0]!).sort(), [
    'description',
    'lineId',
    'netCents',
    'productId',
    'quantity',
    'unitPriceCents',
  ]);

  const foreignSession = sessions.create(foreignId);
  const foreignResponse = await app.inject({
    method: 'GET',
    url: '/api/account/export',
    headers: { cookie: `sid=${foreignSession.token}` },
  });
  assert.equal(foreignResponse.statusCode, 200, foreignResponse.body);
  assert.deepEqual(
    (
      JSON.parse(foreignResponse.body) as { invoices: Array<{ invoiceNumber: string }> }
    ).invoices.map((invoice) => invoice.invoiceNumber),
    ['QME-2026-000902'],
  );
});
