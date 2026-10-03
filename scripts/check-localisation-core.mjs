/**
 * Translation-surface guard.
 *
 * Guard intent: catch new hard-coded shop copy at its first user-facing boundary.
 * Rules use TypeScript AST, not line regexes, so comments, identifiers, and data values
 * do not accidentally become findings. Allowlist entries name exact files/functions; no
 * directory-wide wildcard exemption exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = (value) => value.split(path.sep).join('/');
const relative = (file) => normalize(path.relative(ROOT, file));

/**
 * Semantic exceptions. Keep entries exact and explain why each boundary is safe:
 * - central localisation runtime owns locale-aware formatters;
 * - delivery slot computation needs a fixed civil-day clock, not display formatting;
 * - admin datetime-local helpers serialize an input instant for API writes;
 * - authored catalog/help fixtures are source data materialized through message keys;
 * - seed/contract fixtures are data or assertions, not generated user messages.
 */
export const ALLOWLIST = Object.freeze({
  intl: new Set([
    'packages/localisation/src/formatDate.ts',
    'packages/localisation/src/formatMoney.ts',
    'packages/localisation/src/formatNumber.ts',
    'packages/localisation/src/translate.ts',
    'apps/api/src/features/delivery/deliverySlotRules.ts',
    'apps/api/test/delivery/deliverySlotRules.test.ts',
    'packages/contracts/test/country-profiles.test.ts',
  ]),
  adminDateTimeSerialization: new Set([
    'apps/web/src/features/admin/lots/AdminVariantsPage.tsx',
    'apps/web/src/features/admin/promos/AdminPromosPage.tsx',
  ]),
  authoredContent: new Set([
    'apps/web/src/features/help/content/faqArticle.ts',
    'apps/web/src/features/help/content/policyArticles.ts',
    'apps/web/src/features/help/content/powderGuidanceArticles.ts',
    'apps/web/src/features/help/content/serviceArticles.ts',
    'apps/web/src/features/help/content/helpContentTypes.ts',
    'apps/web/src/features/designs/BagDesignsPage.tsx',
    'apps/web/src/components/BagArtwork.tsx',
    'packages/catalog/src/catalog.ts',
    'packages/catalog/src/catalogData.ts',
  ]),
  technicalMappings: new Set([
    'apps/web/src/features/account/accountError.ts',
    'apps/web/src/api/client.ts',
  ]),
  seedData: new Set([
    'apps/api/src/db/orderSeedScenarios.ts',
    'apps/api/src/db/reviewSeedScenarios.ts',
    'apps/api/src/db/seedAsyncScenarios.ts',
  ]),
});

const VISIBLE_PROP_NAMES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'caption',
  'description',
  'empty-label',
  'emptyLabel',
  'error',
  'helper-text',
  'helperText',
  'label',
  'loading-label',
  'loadingLabel',
  'message',
  'optional-label',
  'optionalLabel',
  'placeholder',
  'submit-label',
  'submitLabel',
  'title',
]);

const ERROR_SETTER_RE = /^set[A-Za-z]*(?:Error|Failure|Message)$/;
const ROUTE_ERROR_PROPERTY_NAMES = new Set(['error', 'message', 'detail', 'details']);
const MESSAGE_PROPERTY_NAMES = new Set(['body', 'message', 'subject', 'summary', 'title']);
const KEY_RE = /^[a-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;
const TECHNICAL_LITERAL_RE =
  /^(?:[\d\s/_:.#()+-]+|[A-Z]{2}\/\w{2}|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|(?:SKU|ID|URL|API|ZIP)\s*[:#-]?)$/;

/** Immutable product brand is authored identity, not translatable storefront copy. */
const IMMUTABLE_BRAND = Object.freeze({
  'apps/web/src/components/Header.tsx': new Set([
    'QArefully Materials Exchange',
    'QA',
    'refully Materials Exchange',
  ]),
  'apps/web/src/features/help/HelpIndexPage.tsx': new Set(['QArefully Materials Exchange']),
});

function isTypeScriptFile(file) {
  return /\.(?:ts|tsx)$/.test(file) && !file.endsWith('.d.ts');
}

function isTestFile(file) {
  // Colocated helpers use names such as `CheckoutPage.test-fixtures.tsx`; treat the
  // complete `.test*` suffix as test code while keeping ordinary production files in scope.
  return (
    /(?:\.test(?:[-.][\w-]+)*|\.node-test)\.(?:ts|tsx)$/.test(file) ||
    /(?:^|[\\/])test[\\/]/.test(file)
  );
}

function isCanonicalPath(file, set) {
  return set.has(relative(file));
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === 'coverage'
    ) {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (isTypeScriptFile(absolute)) files.push(absolute);
  }
  return files;
}

function sourceKind(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function lineOf(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function textOf(sourceFile, node) {
  return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

function literalValue(node) {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText();
  return null;
}

function jsxExpressionLiteralValue(node) {
  if (!ts.isJsxExpression(node)) return literalValue(node);
  let expression = node.expression;
  while (expression && ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  return null;
}

function hasHumanText(value) {
  if (typeof value !== 'string') return false;
  const withoutEntities = value.replace(
    /&(?:amp|apos|gt|lt|nbsp|mdash|middot|minus|times|ndash|mdash|hellip);/giu,
    '',
  );
  return /\p{L}/u.test(withoutEntities);
}

function isMessageKey(value) {
  return KEY_RE.test(value);
}

function isTechnicalLiteral(value) {
  return !hasHumanText(value) || TECHNICAL_LITERAL_RE.test(value);
}

function isRawCopy(value) {
  return hasHumanText(value) && !isMessageKey(value) && !isTechnicalLiteral(value);
}

function isImmutableBrand(file, value) {
  return IMMUTABLE_BRAND[relative(file)]?.has(value) === true;
}

function propertyName(node) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

function objectLiteralAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isObjectLiteralExpression(current)) return current;
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return null;
    current = current.parent;
  }
  return null;
}

function variableNameFor(node) {
  const variable = node.parent;
  if (!variable || !ts.isVariableDeclaration(variable) || !ts.isIdentifier(variable.name))
    return '';
  return variable.name.text;
}

function addFinding(findings, sourceFile, node, rule, message) {
  const location = lineOf(sourceFile, node);
  findings.push({
    rule,
    file: relative(sourceFile.fileName),
    line: location.line,
    column: location.column,
    message,
    snippet: textOf(sourceFile, node).slice(0, 160),
  });
}

function shouldSkipVisibleTestFixture(sourceFile) {
  if (!isTestFile(sourceFile.fileName)) return false;
  // Test JSX supplies assertions and accessibility fixtures, not production copy.
  return true;
}

function containsRawErrorMessage(node) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (ts.isPropertyAccessExpression(current) && current.name.text === 'message') {
      found = true;
      return;
    }
    const value = literalValue(current);
    if (value !== null && isRawCopy(value)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function isReplyResponseReceiver(node) {
  if (ts.isIdentifier(node)) return node.text === 'reply';
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  if (!['code', 'status'].includes(node.expression.name.text)) return false;
  return isReplyResponseReceiver(node.expression.expression);
}

function rawRouteErrorFields(node) {
  if (!ts.isObjectLiteralExpression(node)) return [];
  const fields = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property);
    if (!ROUTE_ERROR_PROPERTY_NAMES.has(name ?? '')) continue;
    const value = literalValue(property.initializer);
    if (value !== null && isRawCopy(value)) fields.push(property.initializer);
  }
  return fields;
}

function routeErrorPayloads(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return [];
  if (node.expression.name.text !== 'send') return [];
  if (!isReplyResponseReceiver(node.expression.expression)) return [];
  return node.arguments.flatMap(rawRouteErrorFields);
}

function inspectFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(file),
  );
  const findings = [];
  const rel = relative(file);
  const test = isTestFile(file);
  const fixture = rel.startsWith('scripts/localisation-fixtures/');

  function visit(node) {
    if (ts.isJsxText(node) && !test && !isCanonicalPath(file, ALLOWLIST.authoredContent)) {
      const value = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
      if (isRawCopy(value) && !isImmutableBrand(file, value))
        addFinding(findings, sourceFile, node, 'jsx-text', 'untranslated JSX text');
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !test &&
      !isCanonicalPath(file, ALLOWLIST.authoredContent)
    ) {
      const value = jsxExpressionLiteralValue(node);
      if (value !== null && isRawCopy(value) && !isImmutableBrand(file, value))
        addFinding(findings, sourceFile, node, 'jsx-text', 'untranslated JSX text');
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.text;
      const value = node.initializer ? jsxExpressionLiteralValue(node.initializer) : null;
      if (
        value !== null &&
        value !== '' &&
        VISIBLE_PROP_NAMES.has(name) &&
        !shouldSkipVisibleTestFixture(sourceFile)
      ) {
        if (isRawCopy(value) && !isImmutableBrand(file, value))
          addFinding(findings, sourceFile, node, 'visible-prop', `literal visible prop ${name}`);
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (ERROR_SETTER_RE.test(name)) {
        for (const argument of node.arguments) {
          const value = literalValue(argument);
          if (containsRawErrorMessage(argument) || (value !== null && isRawCopy(value))) {
            addFinding(
              findings,
              sourceFile,
              argument,
              'error-setter',
              `${name} receives untranslated error text`,
            );
          }
        }
      }
    }

    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const receiver = node.expression.expression;
      const member = node.expression.name.text;
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === 'Intl' &&
        ['NumberFormat', 'DateTimeFormat', 'PluralRules'].includes(member)
      ) {
        if (!isCanonicalPath(file, ALLOWLIST.intl)) {
          addFinding(
            findings,
            sourceFile,
            node,
            'display-intl',
            `direct Intl.${member} outside localisation boundary`,
          );
        }
      }
    }

    if (rel.startsWith('apps/api/src/routes/') || fixture) {
      for (const payload of routeErrorPayloads(node)) {
        addFinding(
          findings,
          sourceFile,
          payload,
          'raw-route-error',
          'reply emits literal route error',
        );
      }
      if (ts.isReturnStatement(node) && node.expression) {
        for (const payload of rawRouteErrorFields(node.expression)) {
          addFinding(
            findings,
            sourceFile,
            payload,
            'raw-route-error',
            'route returns literal route error',
          );
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        /^toLocale[A-Z]?/u.test(method) &&
        !isCanonicalPath(file, ALLOWLIST.intl) &&
        !isCanonicalPath(file, ALLOWLIST.adminDateTimeSerialization)
      ) {
        addFinding(
          findings,
          sourceFile,
          node,
          'display-intl',
          `direct ${method} outside localisation boundary`,
        );
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node);
      const value = literalValue(node.initializer);
      const parentObject = objectLiteralAncestor(node);
      const owner = variableNameFor(parentObject ?? node);
      const likelyPresentationOwner =
        /(?:label|title|message|copy|status|reason|option|presentation|map)/iu.test(owner);
      if (
        value !== null &&
        isRawCopy(value) &&
        name &&
        (MESSAGE_PROPERTY_NAMES.has(name) || likelyPresentationOwner)
      ) {
        if (
          !test &&
          (rel.startsWith('apps/web/src/') || fixture) &&
          !isCanonicalPath(file, ALLOWLIST.authoredContent) &&
          !isCanonicalPath(file, ALLOWLIST.technicalMappings)
        ) {
          const likelyPresentation = likelyPresentationOwner || name !== 'message';
          if (likelyPresentation)
            addFinding(
              findings,
              sourceFile,
              node.initializer,
              'presentation-map',
              `literal ${name} in presentation data`,
            );
        }
        if (
          !test &&
          (rel.startsWith('apps/api/src/') || fixture) &&
          !isCanonicalPath(file, ALLOWLIST.seedData)
        ) {
          const call = node.parent?.parent;
          const callName =
            call && ts.isCallExpression(call)
              ? ts.isIdentifier(call.expression)
                ? call.expression.text
                : ts.isPropertyAccessExpression(call.expression)
                  ? call.expression.name.text
                  : ''
              : '';
          if (
            /^(?:create|insert|save|write|record|enqueue|send|publish|notify|persist|add)/iu.test(
              callName,
            ) ||
            name === 'subject' ||
            name === 'title'
          ) {
            addFinding(
              findings,
              sourceFile,
              node.initializer,
              'literal-message-write',
              `literal generated ${name} write`,
            );
          }
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      rel.startsWith('packages/contracts/src/countryProfiles/')
    ) {
      const name = propertyName(node);
      const value = literalValue(node.initializer);
      if (value !== null && ['banner', 'label'].includes(name ?? '') && isRawCopy(value)) {
        addFinding(
          findings,
          sourceFile,
          node.initializer,
          'legacy-profile-copy',
          `raw profile ${name} copy`,
        );
      }
    }

    if (ts.isParameter(node) && node.initializer && rel === 'apps/api/src/utils/errors.ts') {
      const value = literalValue(node.initializer);
      if (value !== null && isRawCopy(value))
        addFinding(
          findings,
          sourceFile,
          node.initializer,
          'raw-route-error',
          'literal default route error',
        );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export function scanFiles(files) {
  return files.flatMap(inspectFile);
}

export function repositoryFiles() {
  return [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')].flatMap((directory) =>
    walk(directory),
  );
}

export function fixtureFiles() {
  const directory = path.join(ROOT, 'scripts', 'localisation-fixtures');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .map((name) => path.join(directory, name));
}

export function runFixtureAssertions() {
  const fixtures = fixtureFiles();
  const expected = new Map([
    ['jsx-text.tsx', 'jsx-text'],
    ['visible-prop.tsx', 'visible-prop'],
    ['error-setter.tsx', 'error-setter'],
    ['presentation-map.ts', 'presentation-map'],
    ['display-intl.ts', 'display-intl'],
    ['raw-route-error.ts', 'raw-route-error'],
    ['literal-message-write.ts', 'literal-message-write'],
  ]);
  for (const file of fixtures) {
    const name = path.basename(file);
    const findings = inspectFile(file);
    const rule = expected.get(name);
    if (rule && !findings.some((finding) => finding.rule === rule)) {
      throw new Error(`localisation fixture ${name} did not trigger ${rule}`);
    }
  }
  if (fixtures.length !== expected.size) {
    throw new Error(
      `localisation fixture set incomplete: expected ${expected.size}, found ${fixtures.length}`,
    );
  }
}

export function printFindings(findings) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} [${finding.rule}] ${finding.message} (${finding.snippet})`,
    );
  }
}

export function checkRepository() {
  runFixtureAssertions();
  const files = repositoryFiles();
  return { files, findings: scanFiles(files) };
}
