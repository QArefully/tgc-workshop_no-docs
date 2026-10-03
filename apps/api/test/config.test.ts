import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

void test('loadConfig accepts only absolute HTTP(S) reset base URLs', () => {
  assert.equal(loadConfig({}).resetBaseUrl, 'http://127.0.0.1:5173/');
  assert.equal(
    loadConfig({ SHOP_RESET_BASE_URL: 'https://shop.example.test/store' }).resetBaseUrl,
    'https://shop.example.test/store',
  );
  for (const value of ['not-a-url', 'ftp://shop.example.test', 'javascript:alert(1)']) {
    assert.throws(
      () => loadConfig({ SHOP_RESET_BASE_URL: value }),
      /SHOP_RESET_BASE_URL must be an absolute http\(s\) URL/,
    );
  }
});
