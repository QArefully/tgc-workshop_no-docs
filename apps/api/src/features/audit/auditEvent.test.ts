import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditEventValidationError, buildAuditEvent, type AuditEventInput } from './auditEvent.js';
import { AuditQueryError, normalizeAuditEventQuery } from './auditQuery.js';

const userContext = { actor: { type: 'user' as const, userId: 7 }, requestId: 'request-7' };

function expectEventError(action: () => unknown): void {
  assert.throws(action, AuditEventValidationError);
}

void test('builds action-specific metadata without caller-provided sensitive fields', () => {
  const event = buildAuditEvent({
    action: 'payment.succeeded',
    context: userContext,
    paymentId: 12,
    orderId: 45,
    amountCents: 1_999,
    cardNumber: '4111111111111111',
    cvc: '123',
    idempotencyKey: 'replay-key',
  } as AuditEventInput);

  assert.equal(event.entityType, 'payment');
  assert.equal(event.entityId, '12');
  assert.deepEqual(event.metadata, { orderId: 45, amountCents: 1_999 });
  assert.equal(event.metadataJson.includes('411111'), false);
  assert.equal(event.metadataJson.includes('cvc'), false);
  assert.equal(event.metadataJson.includes('replay'), false);
});

void test('builds a sanitized bundle-added audit event', () => {
  const event = buildAuditEvent({
    action: 'cart.bundle_added',
    context: userContext,
    cartId: 'cart-1',
    bundleId: 4,
    componentCount: 3,
    quantity: 3,
    componentNames: ['Powdered Tuesday'],
    totalCents: 9_999,
  } as AuditEventInput);

  assert.equal(event.entityType, 'cart');
  assert.equal(event.entityId, 'cart-1');
  assert.deepEqual(event.metadata, { bundleId: 4, componentCount: 3, quantity: 3 });
  assert.equal(event.metadataJson.includes('Powdered Tuesday'), false);
  assert.equal(event.metadataJson.includes('9999'), false);
});

void test('builds a sanitized reorder-added audit event', () => {
  const event = buildAuditEvent({
    action: 'cart.reorder_added',
    context: userContext,
    cartId: 'cart-1',
    orderId: 12,
    addedLineCount: 2,
    skippedLineCount: 0,
    productNames: ['Powdered Tuesday'],
    totalCents: 9_999,
  } as AuditEventInput);

  assert.equal(event.entityType, 'cart');
  assert.equal(event.entityId, 'cart-1');
  assert.deepEqual(event.metadata, { orderId: 12, addedLineCount: 2, skippedLineCount: 0 });
  assert.equal(event.metadataJson.includes('Powdered Tuesday'), false);
  assert.equal(event.metadataJson.includes('9999'), false);
});

void test('rejects a reorder-added audit event with unusable counts', () => {
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.reorder_added',
      context: userContext,
      cartId: 'cart-1',
      orderId: 0,
      addedLineCount: 1,
      skippedLineCount: 0,
    } as unknown as AuditEventInput),
  );
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.reorder_added',
      context: userContext,
      cartId: 'cart-1',
      orderId: 12,
      addedLineCount: -1,
      skippedLineCount: 0,
    } as unknown as AuditEventInput),
  );
});

void test('builds a scalar-only quick-order-added audit event', () => {
  const event = buildAuditEvent({
    action: 'cart.quick_order_added',
    context: userContext,
    cartId: 'cart-1',
    lineCount: 3,
    addedLineCount: 2,
    skippedLineCount: 1,
    pastedText: 'CEM-0001-001, 4',
    skus: ['CEM-0001-001'],
  } as AuditEventInput);

  assert.equal(event.entityType, 'cart');
  assert.equal(event.entityId, 'cart-1');
  assert.deepEqual(event.metadata, { lineCount: 3, addedLineCount: 2, skippedLineCount: 1 });
  assert.equal(event.metadataJson.includes('CEM-0001-001'), false);
});

void test('rejects a quick-order-added audit event with unusable counts', () => {
  for (const input of [
    { lineCount: -1, addedLineCount: 0, skippedLineCount: 0 },
    { lineCount: 1.5, addedLineCount: 0, skippedLineCount: 0 },
    { lineCount: 1, addedLineCount: Number.MAX_SAFE_INTEGER + 1, skippedLineCount: 0 },
    { lineCount: 1, addedLineCount: 0, skippedLineCount: -1 },
  ]) {
    expectEventError(() =>
      buildAuditEvent({
        action: 'cart.quick_order_added',
        context: userContext,
        cartId: 'cart-1',
        ...input,
      } as unknown as AuditEventInput),
    );
  }
});

void test('builds saved-list audit events with allowlisted scalar metadata', () => {
  const cases: Array<{
    input: AuditEventInput;
    entityType: 'saved_list' | 'cart';
    entityId: string;
    metadata: Record<string, string | number>;
  }> = [
    {
      input: {
        action: 'saved_list.created',
        context: userContext,
        savedListId: 9,
        name: 'Monthly restock',
      },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9, name: 'Monthly restock' },
    },
    {
      input: {
        action: 'saved_list.renamed',
        context: userContext,
        savedListId: 9,
        name: 'Quarterly restock',
      },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9, name: 'Quarterly restock' },
    },
    {
      input: { action: 'saved_list.deleted', context: userContext, savedListId: 9 },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9 },
    },
    {
      input: {
        action: 'saved_list.item_added',
        context: userContext,
        savedListId: 9,
        variantId: 12,
        quantity: 4,
      },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9, variantId: 12, quantity: 4 },
    },
    {
      input: {
        action: 'saved_list.item_updated',
        context: userContext,
        savedListId: 9,
        itemId: 4,
        quantity: 6,
      },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9, itemId: 4, quantity: 6 },
    },
    {
      input: { action: 'saved_list.item_removed', context: userContext, savedListId: 9, itemId: 4 },
      entityType: 'saved_list',
      entityId: '9',
      metadata: { savedListId: 9, itemId: 4 },
    },
    {
      input: {
        action: 'cart.saved_list_added',
        context: userContext,
        cartId: 'cart-1',
        savedListId: 9,
        itemCount: 4,
        addedLineCount: 3,
        skippedLineCount: 1,
      },
      entityType: 'cart',
      entityId: 'cart-1',
      metadata: { savedListId: 9, itemCount: 4, addedLineCount: 3, skippedLineCount: 1 },
    },
  ];

  for (const { input, entityType, entityId, metadata } of cases) {
    const event = buildAuditEvent(input);
    assert.equal(event.entityType, entityType);
    assert.equal(event.entityId, entityId);
    assert.deepEqual(event.metadata, metadata);
  }
});

void test('rejects unusable saved-list audit scalars', () => {
  for (const input of [
    { action: 'saved_list.created', savedListId: 0, name: 'Restock' },
    { action: 'saved_list.renamed', savedListId: 9, name: '' },
    { action: 'saved_list.item_added', savedListId: 9, variantId: 0, quantity: 1 },
    { action: 'saved_list.item_updated', savedListId: 9, itemId: 4, quantity: 0 },
    { action: 'saved_list.item_removed', savedListId: 9, itemId: 0 },
    {
      action: 'cart.saved_list_added',
      cartId: 'cart-1',
      savedListId: 9,
      itemCount: -1,
      addedLineCount: 0,
      skippedLineCount: 0,
    },
  ]) {
    expectEventError(() =>
      buildAuditEvent({ context: userContext, ...input } as unknown as AuditEventInput),
    );
  }
});

function acceptAuditEventInput(_input: AuditEventInput): void {
  void _input;
}

// @ts-expect-error Saved-list actions require their discriminated fields.
acceptAuditEventInput({ action: 'saved_list.deleted', context: userContext });

void test('enforces actor shape and request context rules', () => {
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.created',
      context: { actor: { type: 'anonymous', userId: 7 }, requestId: 'request' },
      cartId: 'cart-1',
    } as unknown as AuditEventInput),
  );
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.created',
      context: { actor: { type: 'user', userId: 0 }, requestId: 'request' },
      cartId: 'cart-1',
    } as unknown as AuditEventInput),
  );
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.created',
      context: { actor: { type: 'anonymous', userId: null }, requestId: null },
      cartId: 'cart-1',
    } as unknown as AuditEventInput),
  );
});

void test('records standing country for admin contexts only', () => {
  const admin = buildAuditEvent({
    action: 'product.updated',
    context: {
      actor: { type: 'user', userId: 9 },
      requestId: 'admin-country-request',
      standingCountry: 'DE',
    },
    productId: 12,
  });
  assert.deepEqual(admin.metadata, { country: 'DE' });

  const customer = buildAuditEvent({
    action: 'cart.created',
    context: userContext,
    cartId: 'cart-customer',
  });
  assert.deepEqual(customer.metadata, {});

  const system = buildAuditEvent({
    action: 'job.succeeded',
    context: { actor: { type: 'system', userId: null }, requestId: null },
    jobId: 4,
  });
  assert.deepEqual(system.metadata, {});

  expectEventError(() =>
    buildAuditEvent({
      action: 'product.updated',
      context: { ...userContext, standingCountry: 'GB' },
      productId: 12,
    } as unknown as AuditEventInput),
  );
});

void test('rejects unknown actions and invalid scalar metadata values', () => {
  expectEventError(() =>
    buildAuditEvent({
      action: 'payment.refunded',
      context: userContext,
    } as unknown as AuditEventInput),
  );
  expectEventError(() =>
    buildAuditEvent({
      action: 'cart.product_added',
      context: userContext,
      cartId: 'cart-1',
      productId: Number.NaN,
      quantity: 1,
    } as unknown as AuditEventInput),
  );
  expectEventError(() =>
    buildAuditEvent({
      action: 'order.created',
      context: userContext,
      orderId: 1,
      totalCents: -1,
      itemCount: 1,
    } as unknown as AuditEventInput),
  );
});

void test('measures serialized metadata in UTF-8 bytes', () => {
  const hugeFailureCode = 'x'.repeat(2_050);
  expectEventError(() =>
    buildAuditEvent({
      action: 'payment.pre_gateway_failed',
      context: userContext,
      paymentId: 1,
      errorCode: hugeFailureCode,
    } as unknown as AuditEventInput),
  );
});

void test('builds body-free, scalar-only review audit metadata', () => {
  const created = buildAuditEvent({
    action: 'review.created',
    context: userContext,
    reviewId: 91,
    productId: 12,
    rating: 5,
    body: 'Sensitive review body that must never enter audit metadata.',
    authorEmail: 'customer@example.test',
  } as AuditEventInput);
  const hidden = buildAuditEvent({
    action: 'review.hidden',
    context: { actor: { type: 'user', userId: 1 }, requestId: 'admin-request' },
    reviewId: 91,
    productId: 12,
    bodyExcerpt: 'not retained',
  } as AuditEventInput);

  assert.equal(created.entityType, 'review');
  assert.equal(created.entityId, '91');
  assert.deepEqual(created.metadata, { productId: 12, rating: 5 });
  assert.equal(created.metadataJson.includes('Sensitive review body'), false);
  assert.equal(created.metadataJson.includes('customer@example.test'), false);
  assert.deepEqual(hidden.metadata, { productId: 12 });
  assert.equal(hidden.metadataJson.includes('bodyExcerpt'), false);
});

void test('builds lifecycle audit rows with shipment identity and allowlisted metadata', () => {
  const transitioned = buildAuditEvent({
    action: 'shipment.transitioned',
    context: userContext,
    shipmentId: 11,
    orderId: 7,
    status: 'delivered',
    trackingReference: 'not-retained',
  } as AuditEventInput);
  const packed = buildAuditEvent({
    action: 'order.shipment_packed',
    context: userContext,
    orderId: 7,
    shipmentCount: 2,
    allocation: [{ lineId: '1' }],
  } as AuditEventInput);
  assert.deepEqual(
    {
      entityType: transitioned.entityType,
      entityId: transitioned.entityId,
      metadata: transitioned.metadata,
    },
    { entityType: 'shipment', entityId: '11', metadata: { orderId: 7, status: 'delivered' } },
  );
  assert.deepEqual(packed.metadata, { shipmentCount: 2 });
  assert.equal(transitioned.metadataJson.includes('not-retained'), false);
  assert.equal(packed.metadataJson.includes('allocation'), false);
});

void test('rejects invalid review audit scalars', () => {
  for (const input of [
    { action: 'review.created', reviewId: 0, productId: 12, rating: 5 },
    { action: 'review.updated', reviewId: 91, productId: 0, rating: 5 },
    { action: 'review.created', reviewId: 91, productId: 12, rating: 6 },
    { action: 'review.updated', reviewId: 91, productId: 12, rating: 1.5 },
  ]) {
    expectEventError(() =>
      buildAuditEvent({ context: userContext, ...input } as unknown as AuditEventInput),
    );
  }
});

void test('builds privacy-safe review engagement and moderation facts', () => {
  const reported = buildAuditEvent({
    action: 'review.report_created',
    context: userContext,
    reviewId: 91,
    productId: 12,
    reason: 'unsafe',
    detail: 'Sensitive report detail must not enter audit metadata.',
    reporterEmail: 'reporter@example.test',
  } as AuditEventInput);
  const dismissed = buildAuditEvent({
    action: 'review.reports_dismissed',
    context: userContext,
    reviewId: 91,
    productId: 12,
    resolvedReportCount: 3,
    reportIds: [1, 2, 3],
  } as AuditEventInput);

  assert.deepEqual(reported.metadata, { productId: 12, reason: 'unsafe' });
  assert.equal(reported.metadataJson.includes('Sensitive report detail'), false);
  assert.equal(reported.metadataJson.includes('reporter@example.test'), false);
  assert.deepEqual(dismissed.metadata, { productId: 12, resolvedReportCount: 3 });
  expectEventError(() =>
    buildAuditEvent({
      action: 'review.report_created',
      context: userContext,
      reviewId: 91,
      productId: 12,
      reason: 'unknown',
    } as unknown as AuditEventInput),
  );
});

void test('normalizes UTC dates and pagination defaults', () => {
  assert.deepEqual(
    normalizeAuditEventQuery({ occurredFrom: '2026-02-03', occurredTo: '2026-02-04' }),
    {
      occurredFrom: '2026-02-03T00:00:00.000Z',
      occurredTo: '2026-02-04T23:59:59.999Z',
      page: 1,
      pageSize: 50,
    },
  );
});

void test('accepts review audit actions and entity type filters', () => {
  assert.deepEqual(normalizeAuditEventQuery({ action: 'review.restored', entityType: 'review' }), {
    action: 'review.restored',
    entityType: 'review',
    page: 1,
    pageSize: 50,
  });
});

void test('accepts shipment audit entity filters', () => {
  assert.deepEqual(normalizeAuditEventQuery({ entityType: 'shipment' }), {
    entityType: 'shipment',
    page: 1,
    pageSize: 50,
  });
});

void test('accepts admin and saved-list audit actions and entity type filters', () => {
  const actions = [
    'product.created',
    'product.updated',
    'product.retired',
    'variant.created',
    'variant.updated',
    'variant.retired',
    'variant.clearance_set',
    'variant.clearance_cleared',
    'promo.created',
    'promo.updated',
    'promo.deactivated',
    'user.role_changed',
    'user.suspended',
    'user.reactivated',
    'user.display_name_updated',
    'feature_flag.created',
    'feature_flag.updated',
    'feature_flag.deleted',
    'payment.admin_refunded',
    'saved_list.created',
    'saved_list.renamed',
    'saved_list.deleted',
    'saved_list.item_added',
    'saved_list.item_updated',
    'saved_list.item_removed',
    'cart.saved_list_added',
  ];
  const entityTypes = ['product', 'variant', 'promo', 'feature_flag', 'saved_list'];

  for (const action of actions) {
    assert.equal(normalizeAuditEventQuery({ action }).action, action);
  }
  for (const entityType of entityTypes) {
    assert.equal(normalizeAuditEventQuery({ entityType }).entityType, entityType);
  }
});

void test('rejects malformed, inverted, and out-of-bounds audit query values', () => {
  for (const query of [
    { occurredFrom: '2026-02-30' },
    { occurredFrom: '2026-02-05', occurredTo: '2026-02-04' },
    { page: 0 },
    { pageSize: 101 },
    { actorUserId: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => normalizeAuditEventQuery(query), AuditQueryError);
  }
});
