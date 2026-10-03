import assert from 'node:assert/strict';
import test from 'node:test';
import { runServer } from '../../src/runServer.js';
import { startServer } from '../../src/server.js';

void test('the executable startup boundary invokes its lifecycle while the lifecycle module stays import-safe', () => {
  assert.equal(typeof startServer, 'function');

  let calls = 0;
  runServer(() => {
    calls += 1;
    return Promise.resolve();
  });
  assert.equal(calls, 1);
});
