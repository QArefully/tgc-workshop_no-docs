import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildChildTestArgs,
  DEFAULT_TEST_PATTERN,
  TEST_CONCURRENCY_ENV,
} from './run-integration-tests-args.js';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_PREFIX = 'shop-api-integration-run-';

void test('concurrency-only invocation keeps an explicit integration glob', () => {
  const childArgs = buildChildTestArgs(['--test-concurrency=4'], {
    [TEST_CONCURRENCY_ENV]: undefined,
  });

  assert.deepEqual(childArgs, ['--test-concurrency=4', DEFAULT_TEST_PATTERN]);
  assert.ok(!childArgs.some((arg) => arg.includes('run-integration-tests')));
});

void test('test-only concurrency environment override keeps the default glob', () => {
  assert.deepEqual(buildChildTestArgs([], { [TEST_CONCURRENCY_ENV]: '7' }), [
    '--test-concurrency=7',
    DEFAULT_TEST_PATTERN,
  ]);
});

void test('split concurrency option does not treat its value as a test path', () => {
  assert.deepEqual(buildChildTestArgs(['--test-concurrency', '13']), [
    '--test-concurrency',
    '13',
    DEFAULT_TEST_PATTERN,
  ]);
});

function runFailingChild(testFile: string): Promise<number | null> {
  const runner = resolve(API_ROOT, 'test/support/run-integration-tests.ts');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'tsx/esm', runner, testFile], {
    cwd: API_ROOT,
    env,
    shell: false,
    stdio: 'inherit',
  });
  return new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveResult(code));
  });
}

void test('runner removes its owned temp directory after a forced child failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-api-runner-test-'));
  const failingTest = join(directory, 'forced-failure.test.mjs');
  writeFileSync(
    failingTest,
    "import assert from 'node:assert/strict'; import test from 'node:test'; void test('forced failure', () => assert.fail('runner cleanup probe'));\n",
    'utf8',
  );
  const before = new Set(readdirSync(tmpdir()).filter((entry) => entry.startsWith(RUN_PREFIX)));
  try {
    assert.equal(await runFailingChild(failingTest), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const after = new Set(readdirSync(tmpdir()).filter((entry) => entry.startsWith(RUN_PREFIX)));
  assert.deepEqual(after, before);
});
