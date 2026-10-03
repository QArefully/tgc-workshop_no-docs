import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createAuthService } from './authService.js';
import { createUserRepository } from './userRepository.js';

const noOpPasswords = {
  hash: (raw: string) => Promise.resolve(`hashed:${raw}`),
  verify: (raw: string, stored: string) => Promise.resolve(stored === `hashed:${raw}`),
};

void test('login rejects a persisted suspended user before session issuance', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-suspension-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  db.prepare(
    `INSERT INTO users
      (email, display_name, password_hash, password_salt, role, created_at, suspended_at)
     VALUES (?, ?, ?, '', 'customer', ?, ?)`,
  ).run(
    'suspended@example.test',
    'Suspended User',
    'stored-password',
    '2026-07-29T10:00:00.000Z',
    '2026-07-29T11:00:00.000Z',
  );
  const service = createAuthService({
    users: createUserRepository(db),
    clock: { now: () => new Date('2026-07-29T12:00:00.000Z') },
    passwords: { hash: () => Promise.resolve('unused'), verify: () => Promise.resolve(true) },
  });
  assert.deepEqual(
    await service.login({ email: 'suspended@example.test', password: 'password', country: 'UK' }),
    { ok: false, error: 'AUTH_SUSPENDED' },
  );
});

void test('same email different countries are separate accounts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-two-countries-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createAuthService({
    users: createUserRepository(db),
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
    passwords: noOpPasswords,
  });

  const uk = await service.signup({
    email: 'dual@example.test',
    password: 'password1',
    displayName: 'UK User',
    country: 'UK',
  });
  assert.equal(uk.ok, true);
  if (!uk.ok) throw new Error('unreachable');

  const us = await service.signup({
    email: 'dual@example.test',
    password: 'password2',
    displayName: 'US User',
    country: 'US',
  });
  assert.equal(us.ok, true);
  if (!us.ok) throw new Error('unreachable');

  assert.notEqual(uk.userId, us.userId);

  const ukLogin = await service.login({
    email: 'dual@example.test',
    password: 'password1',
    country: 'UK',
  });
  assert.deepEqual(ukLogin, { ok: true, userId: uk.userId, user: uk.user });

  const usLogin = await service.login({
    email: 'dual@example.test',
    password: 'password2',
    country: 'US',
  });
  assert.deepEqual(usLogin, { ok: true, userId: us.userId, user: us.user });

  const cross = await service.login({
    email: 'dual@example.test',
    password: 'password1',
    country: 'US',
  });
  assert.deepEqual(cross, { ok: false });
});

void test('right password wrong country same failure as wrong password', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-wrong-country-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createAuthService({
    users: createUserRepository(db),
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
    passwords: noOpPasswords,
  });

  const signup = await service.signup({
    email: 'countryless@example.test',
    password: 'correct12',
    displayName: 'Test',
    country: 'UK',
  });
  assert.equal(signup.ok, true);

  const wrongPwd = await service.login({
    email: 'countryless@example.test',
    password: 'wrongPass',
    country: 'UK',
  });
  assert.deepEqual(wrongPwd, { ok: false });

  const wrongCountry = await service.login({
    email: 'countryless@example.test',
    password: 'correct12',
    country: 'US',
  });
  assert.deepEqual(wrongCountry, { ok: false });
});

void test('duplicate email and country maps to EMAIL_EXISTS', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-dup-email-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createAuthService({
    users: createUserRepository(db),
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
    passwords: noOpPasswords,
  });

  const first = await service.signup({
    email: 'dup@example.test',
    password: 'password1',
    displayName: 'First',
    country: 'UK',
  });
  assert.equal(first.ok, true);

  const second = await service.signup({
    email: 'dup@example.test',
    password: 'password2',
    displayName: 'Second',
    country: 'UK',
  });
  assert.deepEqual(second, { ok: false, error: 'EMAIL_EXISTS' });
});

void test('country emitted on public user', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-country-on-user-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createAuthService({
    users: createUserRepository(db),
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
    passwords: noOpPasswords,
  });

  const result = await service.signup({
    email: 'country-on-user@example.test',
    password: 'password',
    displayName: 'Country User',
    country: 'DE',
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');

  assert.equal(result.user.country, 'DE');
  assert.deepStrictEqual(Object.keys(result.user).sort(), [
    'country',
    'displayName',
    'email',
    'id',
    'role',
  ]);

  const login = await service.login({
    email: 'country-on-user@example.test',
    password: 'password',
    country: 'DE',
  });
  assert.equal(login.ok, true);
  if (!login.ok) throw new Error('unreachable');
  assert.equal(login.user.country, 'DE');
});
