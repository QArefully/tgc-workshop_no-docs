import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  Country,
  SUPPORTED_COUNTRIES,
  DEFAULT_GUEST_COUNTRY,
  LEGACY_DATA_COUNTRY,
} from '../src/country.js';
import { PublicUser, ForgotPasswordBody } from '../src/auth.js';
import * as CountryExports from '../src/country.js';
import * as BarrelExports from '../src/index.js';
import * as SubpathExports from '@shop/contracts/country';

void test('Country accepts all seven literals', () => {
  for (const code of SUPPORTED_COUNTRIES) {
    assert.equal(Value.Check(Country, code), true);
  }
});

void test('Country rejects invalid codes', () => {
  assert.equal(Value.Check(Country, 'GB'), false);
  assert.equal(Value.Check(Country, 'gb'), false);
  assert.equal(Value.Check(Country, 'EU'), false);
  assert.equal(Value.Check(Country, ''), false);
});

void test('Country rejects values that look similar but are wrong', () => {
  assert.equal(Value.Check(Country, 'UK '), false);
  assert.equal(Value.Check(Country, 'uk'), false);
  assert.equal(Value.Check(Country, 42), false);
  assert.equal(Value.Check(Country, null), false);
});

void test('Country rejects non-literal strings entirely', () => {
  assert.equal(Value.Check(Country, 'JP'), false);
  assert.equal(Value.Check(Country, 'XX'), false);
});

void test('SUPPORTED_COUNTRIES is ordered as specified', () => {
  assert.deepStrictEqual(SUPPORTED_COUNTRIES, ['UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR']);
});

void test('DEFAULT_GUEST_COUNTRY is US', () => {
  assert.equal(DEFAULT_GUEST_COUNTRY, 'US');
  assert.equal(Value.Check(Country, DEFAULT_GUEST_COUNTRY), true);
});

void test('LEGACY_DATA_COUNTRY is UK', () => {
  assert.equal(LEGACY_DATA_COUNTRY, 'UK');
  assert.equal(Value.Check(Country, LEGACY_DATA_COUNTRY), true);
});

void test('PublicUser requires country', () => {
  const validUser = {
    id: 'abc',
    email: 'buyer@example.test',
    displayName: 'Ada Shopper',
    role: 'customer',
    country: 'UK',
  };
  assert.equal(Value.Check(PublicUser, validUser), true);

  // missing country
  const { country, ...noCountry } = validUser;
  void country;
  assert.equal(Value.Check(PublicUser, noCountry), false);

  // invalid country
  assert.equal(Value.Check(PublicUser, { ...validUser, country: 'GB' }), false);
});

void test('ForgotPasswordBody requires country', () => {
  assert.equal(Value.Check(ForgotPasswordBody, { email: 'a@b.test', country: 'UK' }), true);
  assert.equal(Value.Check(ForgotPasswordBody, { email: 'a@b.test' }), false);
  assert.equal(Value.Check(ForgotPasswordBody, { email: 'a@b.test', country: 'GB' }), false);
});

void test('Country barrel export parity with source module', () => {
  const sourceKeys = new Set(Object.keys(CountryExports));
  const barrelKeys = Object.keys(BarrelExports);
  for (const name of [
    'Country',
    'SUPPORTED_COUNTRIES',
    'DEFAULT_GUEST_COUNTRY',
    'LEGACY_DATA_COUNTRY',
  ]) {
    assert.equal(sourceKeys.has(name), true, `${name} missing from source module`);
    assert.equal(barrelKeys.includes(name), true, `${name} missing from barrel exports`);
  }
});

void test('Country subpath export parity with source module', () => {
  for (const name of [
    'Country',
    'SUPPORTED_COUNTRIES',
    'DEFAULT_GUEST_COUNTRY',
    'LEGACY_DATA_COUNTRY',
  ]) {
    assert.ok(name in SubpathExports, `${name} missing from subpath exports`);
  }
});
