import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

function readError(response: { body: string }): string {
  const body: unknown = JSON.parse(response.body);
  assert.ok(typeof body === 'object' && body !== null && 'error' in body);
  assert.equal(typeof body.error, 'string');
  return body.error;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function firstMailboxMessageBody(response: { body: string }): string {
  const body: unknown = JSON.parse(response.body);
  assert.ok(isUnknownArray(body));
  const message = body[0];
  assert.ok(typeof message === 'object' && message !== null && 'body' in message);
  const messageBody = message.body;
  if (typeof messageBody !== 'string') throw new Error('Mailbox message body must be a string');
  return messageBody;
}

function auditActions(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .prepare('SELECT action FROM audit_events ORDER BY id')
    .all()
    .map((row) => (row as { action: string }).action);
}

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const cookie = response.headers['set-cookie'];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!value) throw new Error('Expected a session cookie');
  return value.split(';', 1)[0];
}

void test('auth services isolate sessions, reset tokens, and mailbox', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  let now = new Date('2026-07-13T12:00:00.000Z');
  let token = 'raw-reset-token-one';
  const app = await buildApp({
    db,
    resetBaseUrl: 'https://web.example.test/store',
    clock: { now: () => now },
    resetTokenSource: () => token,
  });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const signupBody = {
    email: 'alice@example.test',
    password: 'password-one',
    displayName: 'Alice',
    country: 'UK',
  };
  await t.test('duplicate signup race maps one account to one clean conflict', async () => {
    const [first, second] = await Promise.all(
      [1, 2].map(() => app.inject({ method: 'POST', url: '/signup', payload: signupBody })),
    );
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
          .get('alice@example.test') as {
          count: number;
        }
      ).count,
      1,
    );
  });

  await t.test('reset link uses configured URL and raw token is never persisted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: signupBody.email, country: 'UK' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      db
        .prepare('PRAGMA table_info(password_reset_tokens)')
        .all()
        .map((column) => (column as { name: string }).name),
      ['id', 'user_id', 'token_digest', 'expires_at', 'used_at', 'created_at'],
    );
    const row = db.prepare('SELECT token_digest FROM password_reset_tokens').get() as {
      token_digest: string;
    };
    assert.notEqual(row.token_digest, token);
    assert.equal(JSON.stringify(row).includes(token), false);

    const mailbox = await app.inject({ method: 'GET', url: '/api/dev/mailbox' });
    assert.equal(mailbox.statusCode, 200);
    const mailboxBody = firstMailboxMessageBody(mailbox);
    assert.match(
      mailboxBody,
      /https:\/\/web\.example\.test\/reset-password\?token=raw-reset-token-one/,
    );
  });

  await t.test('expired, used, and successful reset behavior remains deterministic', async () => {
    now = new Date(now.getTime() + 31 * 60 * 1000);
    const expired = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token, newPassword: 'password-two' },
    });
    assert.equal(expired.statusCode, 400);
    assert.match(readError(expired), /expired/);

    token = 'raw-reset-token-two';
    await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: signupBody.email, country: 'UK' },
    });
    const reset = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token, newPassword: 'password-two' },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM sessions WHERE user_id =
             (SELECT id FROM users WHERE email = 'alice@example.test')`,
          )
          .get() as { count: number }
      ).count,
      0,
    );
    const used = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token, newPassword: 'password-three' },
    });
    assert.equal(used.statusCode, 400);
    assert.match(readError(used), /already been used/);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/login',
          payload: { email: signupBody.email, password: 'password-one', country: 'UK' },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/login',
          payload: { email: signupBody.email, password: 'password-two', country: 'UK' },
        })
      ).statusCode,
      200,
    );
  });

  await t.test('reset rolls back password and session changes together on failure', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        email: 'bob@example.test',
        password: 'password-one',
        displayName: 'Bob',
        country: 'UK',
      },
    });
    assert.equal(signup.statusCode, 201);
    token = 'raw-reset-token-three';
    await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'bob@example.test', country: 'UK' },
    });
    db.exec(
      `CREATE TRIGGER abort_reset_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'session delete failed'); END`,
    );
    const failed = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token, newPassword: 'password-two' },
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM sessions WHERE user_id =
             (SELECT id FROM users WHERE email = 'bob@example.test')`,
          )
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        db
          .prepare(
            'SELECT used_at FROM password_reset_tokens WHERE token_digest IS NOT NULL ORDER BY id DESC',
          )
          .get() as {
          used_at: string | null;
        }
      ).used_at,
      null,
    );
    db.exec('DROP TRIGGER abort_reset_session_delete');
    const completed = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token, newPassword: 'password-two' },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM sessions WHERE user_id =
             (SELECT id FROM users WHERE email = 'bob@example.test')`,
          )
          .get() as { count: number }
      ).count,
      0,
    );
  });
});

void test('auth audit events are atomic, privacy-bounded, and mutation-only', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-auth-audit-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  let token = 'audit-reset-token-one';
  const app = await buildApp({
    db,
    resetBaseUrl: 'https://web.example.test/store',
    clock: { now: () => new Date('2026-07-13T12:00:00.000Z') },
    resetTokenSource: () => token,
  });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const signup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'audit@example.test',
      password: 'password-one',
      displayName: 'Audit User',
      country: 'UK',
    },
  });
  assert.equal(signup.statusCode, 201);
  assert.deepEqual(auditActions(db), ['auth.user_signed_up', 'auth.session_created']);
  assert.deepEqual(db.prepare('SELECT metadata_json FROM audit_events ORDER BY id').all(), [
    { metadata_json: '{}' },
    { metadata_json: '{"source":"signup"}' },
  ]);

  const beforeInvalid = auditActions(db).length;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/signup',
        payload: { email: 'invalid', password: 'short', displayName: '', country: 'UK' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'audit@example.test', password: 'wrong-password', country: 'UK' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/forgot-password',
        payload: { email: 'unknown@example.test', country: 'UK' },
      })
    ).statusCode,
    200,
  );
  assert.equal(auditActions(db).length, beforeInvalid);

  await app.inject({
    method: 'POST',
    url: '/forgot-password',
    payload: { email: 'audit@example.test', country: 'UK' },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/reset-password',
        payload: { token: 'not-a-token', newPassword: 'password-two' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/reset-password',
        payload: { token, newPassword: 'password-two' },
      })
    ).statusCode,
    200,
  );

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'audit@example.test', password: 'password-two', country: 'UK' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = sessionCookie(login);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/password',
        headers: { cookie },
        payload: { currentPassword: 'password-two', newPassword: 'password-three' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/logout', headers: { cookie } })).statusCode,
    200,
  );
  assert.equal((await app.inject({ method: 'POST', url: '/logout' })).statusCode, 200);
  assert.deepEqual(auditActions(db), [
    'auth.user_signed_up',
    'auth.session_created',
    'auth.password_reset_requested',
    'auth.password_reset_completed',
    'auth.session_created',
    'auth.password_changed',
    'auth.session_destroyed',
  ]);
  const serializedAuditRows = JSON.stringify(db.prepare('SELECT * FROM audit_events').all());
  for (const secret of [
    'password-one',
    'password-two',
    'password-three',
    'audit-reset-token-one',
    'audit@example.test',
  ]) {
    assert.equal(serializedAuditRows.includes(secret), false);
  }

  db.exec(
    `CREATE TRIGGER abort_audit_signup BEFORE INSERT ON audit_events
     WHEN NEW.action = 'auth.user_signed_up'
     BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
  const failedSignup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'rollback@example.test',
      password: 'password-one',
      displayName: 'Rollback',
      country: 'UK',
    },
  });
  assert.equal(failedSignup.statusCode, 500);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
        .get('rollback@example.test') as {
        count: number;
      }
    ).count,
    0,
  );
  db.exec('DROP TRIGGER abort_audit_signup');

  db.exec(
    `CREATE TRIGGER abort_audit_reset_request BEFORE INSERT ON audit_events
     WHEN NEW.action = 'auth.password_reset_requested'
     BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
  const tokensBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get() as {
      count: number;
    }
  ).count;
  const mailboxBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM dev_mailbox').get() as {
      count: number;
    }
  ).count;
  token = 'audit-reset-token-two';
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/forgot-password',
        payload: { email: 'audit@example.test', country: 'UK' },
      })
    ).statusCode,
    500,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get() as { count: number })
      .count,
    tokensBefore,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM dev_mailbox').get() as { count: number }).count,
    mailboxBefore,
  );
  db.exec('DROP TRIGGER abort_audit_reset_request');

  const currentLogin = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'audit@example.test', password: 'password-three', country: 'UK' },
  });
  assert.equal(currentLogin.statusCode, 200);
  db.exec(
    `CREATE TRIGGER abort_audit_password_change BEFORE INSERT ON audit_events
     WHEN NEW.action = 'auth.password_changed'
     BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
  const failedPasswordChange = await app.inject({
    method: 'PATCH',
    url: '/password',
    headers: { cookie: sessionCookie(currentLogin) },
    payload: { currentPassword: 'password-three', newPassword: 'password-four' },
  });
  assert.equal(failedPasswordChange.statusCode, 500);
  db.exec('DROP TRIGGER abort_audit_password_change');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'audit@example.test', password: 'password-three', country: 'UK' },
      })
    ).statusCode,
    200,
  );

  token = 'audit-reset-token-three';
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/forgot-password',
        payload: { email: 'audit@example.test', country: 'UK' },
      })
    ).statusCode,
    200,
  );
  db.exec(
    `CREATE TRIGGER abort_audit_reset_completion BEFORE INSERT ON audit_events
     WHEN NEW.action = 'auth.password_reset_completed'
     BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/reset-password',
        payload: { token, newPassword: 'password-four' },
      })
    ).statusCode,
    500,
  );
  assert.equal(
    (
      db.prepare('SELECT used_at FROM password_reset_tokens ORDER BY id DESC LIMIT 1').get() as {
        used_at: string | null;
      }
    ).used_at,
    null,
  );
  db.exec('DROP TRIGGER abort_audit_reset_completion');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'audit@example.test', password: 'password-three', country: 'UK' },
      })
    ).statusCode,
    200,
  );

  db.exec(
    `CREATE TRIGGER abort_audit_session_create BEFORE INSERT ON audit_events
     WHEN NEW.action = 'auth.session_created'
     BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END`,
  );
  const signupWithSessionFailure = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'session-rollback@example.test',
      password: 'password-one',
      displayName: 'Session Rollback',
      country: 'UK',
    },
  });
  assert.equal(signupWithSessionFailure.statusCode, 500);
  const sessionFailureUser = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('session-rollback@example.test') as { id: number };
  assert.ok(sessionFailureUser);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
        .get(sessionFailureUser.id) as {
        count: number;
      }
    ).count,
    0,
  );
  db.exec('DROP TRIGGER abort_audit_session_create');
});
