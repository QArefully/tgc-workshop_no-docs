import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { createSeededAppFixture } from './support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0];
}

async function login(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<{ statusCode: number; cookie?: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  return {
    statusCode: response.statusCode,
    cookie: response.statusCode === 200 ? sessionCookie(response) : undefined,
  };
}

void test('admin suspension revokes sessions and blocks login until reactivation', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { app, db } = fixture;

  const admin = await login(app, 'admin@example.com');
  const alice = await login(app, 'alice@example.com');
  assert.equal(admin.statusCode, 200);
  assert.equal(alice.statusCode, 200);
  assert.ok(admin.cookie);
  assert.ok(alice.cookie);

  // The seed holds a UK and a DE Alice on the same email, so the lookup must name the country the
  // `login` helper authenticates with; an email-only lookup resolves to the DE row instead.
  const aliceId = (
    db
      .prepare('SELECT id FROM users WHERE email = ? AND country = ?')
      .get('alice@example.com', 'UK') as { id: number }
  ).id;
  const suspended = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${aliceId}/suspend`,
    headers: { cookie: admin.cookie },
    payload: { reason: 'Cross-lane suspension check' },
  });
  assert.equal(suspended.statusCode, 200);
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(aliceId) as {
        count: number;
      }
    ).count,
    0,
  );

  const blocked = await login(app, 'alice@example.com');
  assert.equal(blocked.statusCode, 401);

  const reactivated = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${aliceId}/reactivate`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(reactivated.statusCode, 200);

  const restored = await login(app, 'alice@example.com');
  assert.equal(restored.statusCode, 200);
});
