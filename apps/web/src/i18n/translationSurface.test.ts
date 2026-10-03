import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript checker has no declarations.
import { ALLOWLIST, scanFiles } from '../../../../scripts/check-localisation-core.mjs';

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/localisation-fixtures',
);
const checkoutFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../features/checkout/CheckoutPage.test-fixtures.tsx',
);
const allowlist = ALLOWLIST as Record<string, ReadonlySet<string>>;
type Finding = { rule: string };
const scanLocalisationFiles = scanFiles as unknown as (files: string[]) => Finding[];

describe('localisation guard contract', () => {
  it('keeps semantic exemptions explicit', () => {
    for (const entries of Object.values(allowlist)) {
      for (const entry of entries) expect(entry).not.toContain('*');
    }
  });

  it.each([
    ['jsx-text.tsx', 'jsx-text'],
    ['visible-prop.tsx', 'visible-prop'],
    ['error-setter.tsx', 'error-setter'],
    ['presentation-map.ts', 'presentation-map'],
    ['display-intl.ts', 'display-intl'],
    ['raw-route-error.ts', 'raw-route-error'],
    ['literal-message-write.ts', 'literal-message-write'],
  ])('rejects forbidden %s surface', (fixture, rule) => {
    const findings = scanLocalisationFiles([resolve(fixtureRoot, fixture)]);
    expect(findings.some((finding) => finding.rule === rule)).toBe(true);
  });

  it('does not treat colocated test fixtures as production copy', () => {
    expect(scanLocalisationFiles([checkoutFixturePath])).toEqual([]);
  });
});
