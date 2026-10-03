import assert from 'node:assert/strict';
import test from 'node:test';
import { JobHandlerRegistry } from './jobHandlerRegistry.js';

void test('job registry rejects duplicate kinds and leaves unknown kinds absent', () => {
  const registry = new JobHandlerRegistry();
  assert.equal(registry.get('notification.deliver'), undefined);
  registry.register('notification.deliver', () => ({ ok: true }));
  assert.throws(
    () => registry.register('notification.deliver', () => ({ ok: true })),
    /already registered/,
  );
});
