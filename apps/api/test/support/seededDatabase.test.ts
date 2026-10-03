import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  SEEDED_DATABASE_TEMPLATE_ENV,
  getSeededTemplatePath,
  openSeededDatabase,
} from './seededDatabase.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

void test('seeded clones are distinct writable files, isolated, and FK clean', (t) => {
  const first = openSeededDatabase();
  const second = openSeededDatabase();
  t.after(async () => {
    await first.cleanup();
    await second.cleanup();
  });

  assert.notEqual(first.databasePath, second.databasePath);
  assert.notEqual(first.directory, second.directory);
  assert.deepEqual(first.db.pragma('foreign_keys'), [{ foreign_keys: 1 }]);
  assert.deepEqual(second.db.pragma('foreign_keys'), [{ foreign_keys: 1 }]);
  assert.deepEqual(first.db.pragma('foreign_key_check'), []);
  assert.deepEqual(second.db.pragma('foreign_key_check'), []);

  const beforeSecond = second.db.prepare('SELECT name FROM products WHERE id = 1').get() as {
    name: string;
  };
  const template = openDatabase({ path: getSeededTemplatePath() });
  const beforeTemplate = template.prepare('SELECT name FROM products WHERE id = 1').get() as {
    name: string;
  };
  first.db.prepare('UPDATE products SET name = ? WHERE id = 1').run('clone-only mutation');
  assert.equal(
    (second.db.prepare('SELECT name FROM products WHERE id = 1').get() as { name: string }).name,
    beforeSecond.name,
  );
  assert.equal(
    (template.prepare('SELECT name FROM products WHERE id = 1').get() as { name: string }).name,
    beforeTemplate.name,
  );
  assert.notEqual(
    (first.db.prepare('SELECT name FROM products WHERE id = 1').get() as { name: string }).name,
    beforeSecond.name,
  );
  closeDatabase(template);
});

void test('direct focused runs build one process-local template when env is absent', async (t) => {
  const previous = process.env[SEEDED_DATABASE_TEMPLATE_ENV];
  delete process.env[SEEDED_DATABASE_TEMPLATE_ENV];
  t.after(() => {
    if (previous === undefined) delete process.env[SEEDED_DATABASE_TEMPLATE_ENV];
    else process.env[SEEDED_DATABASE_TEMPLATE_ENV] = previous;
  });

  const before = new Set(
    readdirSync(tmpdir()).filter((entry) => entry.startsWith('shop-api-test-template-')),
  );
  const fixture = openSeededDatabase();
  assert.ok(fixture.databasePath.endsWith('template.db'));
  assert.ok(fixture.directory.includes('shop-api-test-clone-'));
  await fixture.cleanup();
  const after = new Set(
    readdirSync(tmpdir()).filter((entry) => entry.startsWith('shop-api-test-template-')),
  );
  assert.ok(after.size >= before.size);
});
