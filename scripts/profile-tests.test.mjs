import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import { parseArgs, runChild } from './profile-tests.mjs';

test('profiler accepts named suites and repeats', () => {
  assert.deepEqual(parseArgs(['--suite', 'api-unit', '--repeat', '2']), {
    help: false,
    suites: ['api-unit'],
    repeat: 2,
    json: false,
  });
});

test('profiler returns the child exit code unchanged', async () => {
  const result = await runChild(['-e', 'process.exitCode = 17'], {
    command: process.execPath,
    prefix: [],
  });
  assert.equal(result.exitCode, 17);
  assert.equal(result.signal, null);
  assert.ok(result.wallMs >= 0);
});
