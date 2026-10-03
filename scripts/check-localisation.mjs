#!/usr/bin/env node
/**
 * Executable entry point for the translation-surface guard.
 *
 * Scanner implementation lives in the import-safe core module so focused tests
 * can exercise the same rules without executing a process-level command.
 */
import { checkRepository, printFindings } from './check-localisation-core.mjs';

try {
  const { files, findings } = checkRepository();
  if (findings.length > 0) {
    printFindings(findings);
    console.error(`localisation guard failed: ${findings.length} finding(s)`);
    process.exitCode = 1;
  } else {
    console.log(`localisation guard passed: ${files.length} source file(s), 0 findings`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
