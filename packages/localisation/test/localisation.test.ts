import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import { COUNTRY_PROFILES } from '@shop/contracts/country-profiles';
import {
  convertPenceToDisplayMinor,
  defineMessages,
  formatCivilDate,
  formatDisplayMoney,
  formatDualTotal,
  formatInstant,
  formatNumber,
  formatSettlementMoney,
  translate,
} from '../src/index.js';
import { commonMessages } from '../src/messages/common.js';
import { countryMessages } from '../src/messages/country.js';
import { cartMessages } from '../src/messages/cart.js';
import { checkoutMessages } from '../src/messages/checkout.js';
import { customBlendMessages } from '../src/messages/customBlend.js';
import { orderLifecycleMessages } from '../src/messages/orderLifecycle.js';
import { tradeAsyncMessages } from '../src/messages/tradeAsync.js';
import { adminCommerceMessages } from '../src/messages/adminCommerce.js';
import { adminDiagnosticsMessages } from '../src/messages/adminDiagnostics.js';
import {
  adminCatalogMessages,
  adminDateTimeInputValue,
  localizeAdminError,
} from '../src/messages/adminCatalog.js';
import type { MessageCatalog } from '../src/messages/defineMessages.js';

void test('shared catalogs are exhaustive across all supported countries', () => {
  for (const catalog of [countryMessages, commonMessages]) {
    for (const entries of Object.values(catalog) as readonly Record<string, unknown>[]) {
      assert.deepEqual(Object.keys(entries).sort(), [...SUPPORTED_COUNTRIES].sort());
    }
  }
});

void test('admin catalogue has every key in every supported country', () => {
  const keys = Object.keys(adminCatalogMessages);
  assert.ok(keys.length > 0);
  for (const [key, entries] of Object.entries(adminCatalogMessages)) {
    assert.deepEqual(Object.keys(entries).sort(), [...SUPPORTED_COUNTRIES].sort(), key);
    for (const country of SUPPORTED_COUNTRIES) {
      const value = entries[country];
      assert.equal(typeof value, 'string', `${key}.${country}`);
      if (typeof value === 'string') {
        assert.notEqual(value.trim(), '', `${key}.${country}`);
      }
    }
  }
});

void test('admin errors expose only coded copy or selected-country safe fallback', () => {
  assert.equal(
    localizeAdminError({ code: 'REQUEST_INVALID', meta: null }, 'DE'),
    'Die Anfrage ist ungültig.',
  );
  assert.equal(
    localizeAdminError(new Error('Response contract violation for /admin/products: /items'), 'DE'),
    'Anfrage fehlgeschlagen.',
  );
  assert.equal(
    localizeAdminError({ status: null, response: null, message: 'socket detail' }, 'CN'),
    '请求失败。',
  );
  assert.equal(adminDateTimeInputValue('2026-01-01T12:34:56.789Z'), '2026-01-01T12:34');
});

void test('blend disclosure catalogs are exhaustive across all supported countries', () => {
  const catalogs: readonly MessageCatalog[] = [
    customBlendMessages,
    cartMessages,
    checkoutMessages,
    orderLifecycleMessages,
    tradeAsyncMessages,
    adminCommerceMessages,
    adminDiagnosticsMessages,
  ];
  for (const catalog of catalogs) {
    assert.ok(Object.keys(catalog).length > 0);
    for (const [key, entries] of Object.entries(catalog)) {
      assert.deepEqual(Object.keys(entries).sort(), [...SUPPORTED_COUNTRIES].sort(), key);
      for (const country of SUPPORTED_COUNTRIES) {
        const template = entries[country];
        assert.ok(template !== undefined, `${key}.${country}`);
        if (typeof template === 'string') assert.notEqual(template.trim(), '', `${key}.${country}`);
      }
    }
  }
});

void test('trade-credit message surfaces resolve in every supported country', () => {
  const cases = [
    [checkoutMessages, 'checkout.paymentMethod.tradeCreditDueOn', { date: '2026-10-01' }],
    [checkoutMessages, 'checkout.credit.available', { money: '£12.34' }],
    [orderLifecycleMessages, 'order.invoice.number', { invoiceNumber: 'QME-2026-000001' }],
    [orderLifecycleMessages, 'order.invoice.gross', { money: '£12.34' }],
    [orderLifecycleMessages, 'order.invoice.termsDue', { date: '2026-10-01' }],
    [tradeAsyncMessages, 'company.credit.available', { money: '£12.34' }],
    [tradeAsyncMessages, 'company.credit.reason', { reason: 'Review required' }],
    [
      adminCommerceMessages,
      'adminCommerce.invoice.settle.confirmation',
      {
        invoiceNumber: 'QME-2026-000001',
        money: '£12.34',
      },
    ],
    [adminDiagnosticsMessages, 'admin.shell.standingCountry', { country: 'UK' }],
  ] as const;
  for (const [catalog, key, params] of cases) {
    for (const country of SUPPORTED_COUNTRIES) {
      assert.notEqual(translate(catalog, country, key, params), '', `${key}.${country}`);
    }
  }
});

void test('credit-limit hints describe GBP decimal input in every country', () => {
  const expectedHints = {
    UK: 'Enter the credit limit in GBP, using at most two decimal places.',
    US: 'Enter the credit limit in GBP, using at most two decimal places.',
    CN: '请输入以 GBP 计价的额度上限，最多保留两位小数。',
    PL: 'Wpisz limit kredytowy w GBP, używając najwyżej dwóch miejsc po przecinku.',
    ES: 'Introduce el límite de crédito en GBP, con un máximo de dos decimales.',
    DE: 'Geben Sie das Kreditlimit in GBP mit höchstens zwei Dezimalstellen ein.',
    FR: 'Saisissez la limite de crédit en GBP avec au plus deux décimales.',
  } as const;

  for (const country of SUPPORTED_COUNTRIES) {
    const hint = translate(adminCommerceMessages, country, 'adminCommerce.credit.limitHint');
    assert.equal(hint, expectedHints[country], `${country} credit-limit hint`);
  }
});

void test('blend rule and pricing copy interpolates in every country', () => {
  const cases = [
    [customBlendMessages, 'customBlend.evaluationCurrentPrice', { money: '£12.34' }],
    [
      customBlendMessages,
      'customBlend.componentNextTier',
      { sacksToNextTier: 2, minTonnes: 5, discountPct: 5 },
    ],
    [cartMessages, 'cart.customBlend.componentSubtotal', { money: '£12.34' }],
    [checkoutMessages, 'checkout.customBlend.componentSourcePrice', { money: '£12.34' }],
    [orderLifecycleMessages, 'order.customBlend.componentWeight', { weight: '25 kg' }],
  ] as const;
  for (const [catalog, key, params] of cases) {
    for (const country of SUPPORTED_COUNTRIES) {
      assert.notEqual(translate(catalog, country, key, params), '', `${key}.${country}`);
    }
  }
});

void test('translation interpolates plain text and selects plural category', () => {
  assert.equal(
    translate(countryMessages, 'UK', 'postcode.example', { example: '<SW1A>' }),
    'Example: <SW1A>',
  );
  assert.equal(translate(commonMessages, 'UK', 'common.itemCount', { count: 1 }), '1 item');
  assert.equal(translate(commonMessages, 'UK', 'common.itemCount', { count: 2 }), '2 items');
  assert.equal(translate(commonMessages, 'CN', 'common.itemCount', { count: 1 }), '1 个项目');
  assert.equal(
    translate(commonMessages, 'PL', 'common.itemCount', { count: 9007199254740991n }),
    '9007199254740991 element\u00f3w',
  );
  assert.throws(
    () => translate(commonMessages, 'PL', 'common.itemCount', { count: 1000000000000000000002n }),
    /safe integer range/,
  );
  assert.throws(() => translate(commonMessages, 'UK', 'common.itemCount'), /requires a count/);
  assert.equal(
    translate(commonMessages, 'UK', 'common.required', { value: 'unused' }),
    'This field is required.',
  );
  assert.throws(
    () => translate(commonMessages, 'UK', 'common.nope' as never),
    /Unknown localisation/,
  );
});

void test('defineMessages rejects incomplete, empty, and mismatched templates', () => {
  const complete = Object.fromEntries(
    SUPPORTED_COUNTRIES.map((country) => [country, 'Hello {name}']),
  );
  assert.throws(
    () => defineMessages({ greeting: { ...complete, US: 'Hello' } }),
    /placeholder mismatch/,
  );
  const missing = { ...complete } as Record<string, string>;
  delete missing.FR;
  assert.throws(() => defineMessages({ greeting: missing as never }), /exhaustive/);
  assert.throws(
    () =>
      defineMessages({
        greeting: Object.fromEntries(SUPPORTED_COUNTRIES.map((country) => [country, ''])) as never,
      }),
    /non-empty/,
  );
  assert.throws(
    () =>
      defineMessages({
        greeting: Object.fromEntries(
          SUPPORTED_COUNTRIES.map((country) => [country, { one: 'one' }]),
        ) as never,
      }),
    /other branch/,
  );
});

void test('money conversion uses integer rational half-up rounding and distinct totals', () => {
  assert.equal(convertPenceToDisplayMinor(100, 'US'), 125);
  assert.equal(convertPenceToDisplayMinor(1, 'US'), 1);
  assert.equal(convertPenceToDisplayMinor(2, 'US'), 3);
  assert.equal(convertPenceToDisplayMinor(1, 'ES'), 1);
  assert.equal(convertPenceToDisplayMinor(100, 'ES'), 117);
  assert.equal(convertPenceToDisplayMinor(100, 'CN'), 900);
  assert.equal(convertPenceToDisplayMinor(-2, 'US'), -3);
  assert.equal(formatSettlementMoney(1234), '£12.34');
  assert.deepEqual(formatDualTotal(1234, 'UK'), { display: '£12.34' });
  assert.deepEqual(formatDualTotal(1234, 'US'), { display: '$15.43', settlement: '£12.34' });
  assert.equal(formatSettlementMoney(Number.MAX_SAFE_INTEGER), '\u00a390,071,992,547,409.91');
  assert.equal(formatDisplayMoney(Number.MAX_SAFE_INTEGER, 'UK'), '\u00a390,071,992,547,409.91');
  assert.throws(() => convertPenceToDisplayMinor(1.1, 'UK'), /safe integer/);
});

void test('date and number formatters bind every country profile', () => {
  const instant = '2026-01-02T23:30:00.000Z';
  const civil = '2026-01-02';
  for (const country of SUPPORTED_COUNTRIES) {
    assert.notEqual(formatInstant(instant, country), '');
    assert.notEqual(formatCivilDate(civil, country), '');
    assert.notEqual(formatNumber(1234.5, country), '');
    assert.equal(COUNTRY_PROFILES[country].dateLocale.length > 0, true);
  }
  // UTC civil formatting never shifts into the previous/next local day.
  assert.match(formatCivilDate(civil, 'US'), /1\/2\/(?:26|2026)|01\/02\/(?:26|2026)/);
  assert.doesNotMatch(formatCivilDate(civil, 'US'), /AM|PM|:/);
  // An instant does shift according to the profile time zone.
  assert.notEqual(formatInstant(instant, 'UK'), formatInstant(instant, 'CN'));
});

void test('formatter outputs stay exact for every country profile', () => {
  const expected = {
    UK: {
      money: '\u00a312.34',
      instant: '02/01/2026, 23:30',
      civil: '02/01/2026',
      decimal: '1,234.5',
      count: '1,235',
    },
    US: {
      money: '$15.43',
      instant: '1/2/26, 6:30 PM',
      civil: '1/2/26',
      decimal: '1,234.5',
      count: '1,235',
    },
    CN: {
      money: '\u00a5111.06',
      instant: '2026/1/3 07:30',
      civil: '2026/1/2',
      decimal: '1,234.5',
      count: '1,235',
    },
    PL: {
      money: '61,70\u00a0zł',
      instant: '3.01.2026, 00:30',
      civil: '2.01.2026',
      decimal: '1\u00a0234,5',
      count: '1\u00a0235',
    },
    ES: {
      money: '14,44\u00a0€',
      instant: '3/1/26, 0:30',
      civil: '2/1/26',
      decimal: '1.234,5',
      count: '1.235',
    },
    DE: {
      money: '14,44\u00a0€',
      instant: '03.01.26, 00:30',
      civil: '02.01.26',
      decimal: '1.234,5',
      count: '1.235',
    },
    FR: {
      money: '14,44\u00a0€',
      instant: '03/01/2026 00:30',
      civil: '02/01/2026',
      decimal: '1\u202f234,5',
      count: '1\u202f235',
    },
  } as const;

  for (const country of SUPPORTED_COUNTRIES) {
    const fixture = expected[country];
    assert.equal(formatDisplayMoney(1234, country), fixture.money, `${country} money`);
    assert.equal(
      formatInstant('2026-01-02T23:30:00.000Z', country),
      fixture.instant,
      `${country} instant`,
    );
    assert.equal(formatCivilDate('2026-01-02', country), fixture.civil, `${country} civil date`);
    assert.equal(formatNumber(1234.5, country), fixture.decimal, `${country} decimal`);
    assert.equal(formatNumber(1234.5, country, 'count'), fixture.count, `${country} count`);
  }
});

void test('formatter boundaries reject invalid values and preserve civil dates', () => {
  assert.throws(() => formatDisplayMoney(1.1, 'UK'), /safe integer/);
  assert.throws(() => formatNumber(Number.NaN, 'UK'), /finite/);
  assert.throws(() => formatInstant('not-a-date', 'UK'), /Invalid date/);
  assert.throws(() => formatCivilDate('2026-02-30', 'UK'), /not valid/);
  assert.throws(() => formatCivilDate('2026-01-02', 'UK', 'time'), /cannot use the time preset/);
  assert.equal(formatCivilDate('2026-01-02', 'US'), '1/2/26');
  assert.doesNotMatch(formatCivilDate('2026-01-02', 'US'), /AM|PM|:/);
});
