import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, openDatabase, seedDatabase } from '../../src/db/index.js';
import { SEEDED_DATABASE_TEMPLATE_ENV } from './seededDatabase.js';
import { buildChildTestArgs } from './run-integration-tests-args.js';

const RUN_PREFIX = 'shop-api-integration-run-';
const TEMPLATE_FILENAME = 'seeded-template.db';
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function ensureNode22(): void {
  const major = Number(process.versions.node.split('.')[0]);
  assert.equal(
    major,
    22,
    `API integration tests require Node 22.x (found ${process.versions.node})`,
  );
}

function assertForeignKeys(db: ReturnType<typeof openDatabase>): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  assert.deepEqual(violations, [], 'seeded integration template must have no FK violations');
}

function createSeededTemplate(runDirectory: string): string {
  const templatePath = join(runDirectory, TEMPLATE_FILENAME);
  const db = openDatabase({ path: templatePath });
  try {
    seedDatabase(db);
    assertForeignKeys(db);
    // Copy only after TRUNCATE has removed WAL contents. The closed template is immutable while
    // children clone it, so no process can observe uncheckpointed writes or a live SQLite handle.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    closeDatabase(db);
  }
  return templatePath;
}

function spawnTestProcess(testArgs: string[], templatePath: string): Promise<ChildResult> {
  if (
    testArgs.some(
      (arg) =>
        arg === '--experimental-test-isolation=none' ||
        arg === '--experimental-test-isolation=threads',
    )
  ) {
    throw new Error('API integration tests require process test isolation');
  }
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [SEEDED_DATABASE_TEMPLATE_ENV]: templatePath,
  };
  // node:test sets this marker for descendants; carrying it into a fresh runner makes Node think
  // test execution is recursively nested and silently skips the requested files.
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', '--experimental-test-isolation=process', '--test', ...testArgs],
    {
      cwd: API_ROOT,
      env: childEnv,
      shell: false,
      stdio: 'inherit',
    },
  );

  return new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });
}

async function run(): Promise<number> {
  ensureNode22();
  const runDirectory = mkdtempSync(join(tmpdir(), RUN_PREFIX));
  try {
    const templatePath = createSeededTemplate(runDirectory);
    const testArgs = buildChildTestArgs(process.argv.slice(2));
    const result = await spawnTestProcess(testArgs, templatePath);
    // Node returns null for signal termination. Preserve ordinary child exit codes exactly and
    // use the conventional non-zero failure code for a signal so npm never reports a false pass.
    return result.code ?? 1;
  } finally {
    // Only this runner-created, resolved directory is ever removed. The child has exited before
    // cleanup, so SQLite sidecars cannot be recreated after this point.
    rmSync(resolve(runDirectory), { recursive: true, force: true });
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
