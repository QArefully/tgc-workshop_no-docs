#!/usr/bin/env node
/**
 * Cross-platform wall-time profiler for the named test tiers.
 *
 * Child output is inherited unchanged. The profiler only records timing and
 * exit status; it does not create benchmark files or alter test isolation.
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Commands deliberately mirror the root test graph and never call a parent tier. */
export const SUITES = Object.freeze({
  packages: ['run', 'test:packages'],
  'test:packages': ['run', 'test:packages'],
  'web-unit': ['run', 'test:unit', '-w', '@shop/web'],
  'test:web-unit': ['run', 'test:unit', '-w', '@shop/web'],
  'web-integration': ['run', 'test:integration', '-w', '@shop/web'],
  'test:web-integration': ['run', 'test:integration', '-w', '@shop/web'],
  'api-unit': ['run', 'test:unit', '-w', '@shop/api'],
  'test:api-unit': ['run', 'test:unit', '-w', '@shop/api'],
  'api-integration': ['run', 'test:integration', '-w', '@shop/api'],
  'test:api-integration': ['run', 'test:integration', '-w', '@shop/api'],
  root: ['test'],
});

function usage() {
  return [
    'Usage: node scripts/profile-tests.mjs [options] <suite>',
    '',
    'Suites: packages, web-unit, web-integration, api-unit, api-integration, root',
    '',
    'Options:',
    '  -s, --suite <name>     suite to run (repeatable; positional name also works)',
    '  -r, --repeat <count>   warm runs per suite (default: 1)',
    '      --json             emit one JSON timing record per run',
    '  -h, --help             show this help',
  ].join('\n');
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const suites = [];
  let repeat = 1;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      throw new Error('custom commands are not supported; choose a named suite');
    }
    if (argument === '-h' || argument === '--help') return { help: true };
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '-s' || argument === '--suite') {
      suites.push(takeValue(argv, index, argument));
      index += 1;
      continue;
    }
    if (argument.startsWith('--suite=')) {
      suites.push(argument.slice('--suite='.length));
      continue;
    }
    if (argument === '-r' || argument === '--repeat' || argument === '--runs') {
      const value = takeValue(argv, index, argument);
      repeat = Number(value);
      index += 1;
    } else if (argument.startsWith('--repeat=') || argument.startsWith('--runs=')) {
      repeat = Number(argument.slice(argument.indexOf('=') + 1));
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      suites.push(argument);
    }
  }

  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error('repeat count must be a positive integer');
  if (suites.length === 0) suites.push('root');
  for (const suite of suites) {
    if (!Object.hasOwn(SUITES, suite)) throw new Error(`unknown suite: ${suite}`);
  }
  return { help: false, suites, repeat, json };
}

function npmInvocation() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  candidates.push(
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  );
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, prefix: [npmCli] };

  // This fallback supports non-standard Node installations on POSIX systems.
  // Windows npm.cmd files cannot be spawned without a shell, so fail clearly.
  if (process.platform === 'win32') {
    throw new Error('could not locate npm-cli.js beside the active Node executable');
  }
  return { command: 'npm', prefix: [] };
}

export function suiteCommand(suite) {
  const args = SUITES[suite];
  if (!args) throw new Error(`unknown suite: ${suite}`);
  return args;
}

export function runChild(args, invocation = npmInvocation()) {
  const { command, prefix } = invocation;
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(command, [...prefix, ...args], {
      cwd: ROOT,
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });
    let settled = false;
    const finish = (exitCode, signal, error) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: exitCode ?? 1,
        signal: signal ?? null,
        error: error ?? null,
        wallMs: Number((performance.now() - started).toFixed(2)),
      });
    };
    child.once('error', (error) => finish(1, null, error));
    child.once('close', (exitCode, signal) => finish(exitCode, signal, null));
  });
}

function printRecord(record, json) {
  if (json) {
    console.log(JSON.stringify(record));
    return;
  }
  const signal = record.signal ? ` signal=${record.signal}` : '';
  console.log(
    `[profile] suite=${record.suite} run=${record.run} wallMs=${record.wallMs.toFixed(2)} exitCode=${record.exitCode}${signal}`,
  );
}

export async function profile({ suites, repeat, json }) {
  for (const suite of suites) {
    for (let run = 1; run <= repeat; run += 1) {
      const result = await runChild(suiteCommand(suite));
      const record = { suite, run, wallMs: result.wallMs, exitCode: result.exitCode };
      if (result.signal) record.signal = result.signal;
      if (result.error) record.error = result.error.message;
      printRecord(record, json);
      if (result.exitCode !== 0) return result.exitCode;
    }
  }
  return 0;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  try {
    process.exitCode = await profile(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main();
