const DEFAULT_TEST_PATTERN = 'test/**/*.integration.test.ts';
const TEST_CONCURRENCY_ENV = 'SHOP_TEST_CONCURRENCY';

/** Node test options whose following token is a value rather than a test path. */
const OPTIONS_WITH_VALUES = new Set([
  '--test-concurrency',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-shard',
]);

function hasExplicitTestPath(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (OPTIONS_WITH_VALUES.has(arg)) {
      index += 1;
      continue;
    }
    if (arg === '--') return args.slice(index + 1).some((value) => value !== '');
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

function readConcurrencyOverride(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[TEST_CONCURRENCY_ENV]?.trim();
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${TEST_CONCURRENCY_ENV} must be a positive integer`);
  }
  return value;
}

function hasCliConcurrency(args: string[]): boolean {
  return args.some((arg) => arg === '--test-concurrency' || arg.startsWith('--test-concurrency='));
}

/**
 * Build the child node:test arguments without allowing runner-only options to trigger discovery.
 * A file/glob is always explicit; the test-only environment override is translated to Node's
 * option so npm does not need to parse or forward a concurrency flag itself.
 */
export function buildChildTestArgs(
  rawArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const args = [...rawArgs];
  const concurrency = readConcurrencyOverride(env);
  if (concurrency !== undefined && !hasCliConcurrency(args)) {
    args.unshift(`--test-concurrency=${concurrency}`);
  }
  if (!hasExplicitTestPath(args)) args.push(DEFAULT_TEST_PATTERN);
  return args;
}

export { DEFAULT_TEST_PATTERN, TEST_CONCURRENCY_ENV };
