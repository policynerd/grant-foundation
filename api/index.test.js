const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, defaultDatabasePath } = require('./index');

test('api entrypoint exposes service and grant routes', async () => {
  process.env.GRANT_DB_PATH = ':memory:';
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const rootResponse = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(rootResponse.status, 302);
    assert.equal(rootResponse.headers.get('location'), '/grants/ui');

    const healthResponse = await fetch(`http://127.0.0.1:${port}/grants/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      name: 'grant-foundation',
      root: '/grants'
    });

    const uiResponse = await fetch(`http://127.0.0.1:${port}/grants/ui`);
    assert.equal(uiResponse.status, 200);
    const uiText = await uiResponse.text();
    assert.equal(uiText.includes('Grant Foundation MVP'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.GRANT_DB_PATH;
  }
});

test('uses Vercel-writable temp storage by default in serverless runtime', () => {
  const originalVercel = process.env.VERCEL;
  const originalDbPath = process.env.GRANT_DB_PATH;

  try {
    delete process.env.GRANT_DB_PATH;
    process.env.VERCEL = '1';
    assert.equal(defaultDatabasePath(), '/tmp/grant-foundation.db');
  } finally {
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
    if (originalDbPath === undefined) {
      delete process.env.GRANT_DB_PATH;
    } else {
      process.env.GRANT_DB_PATH = originalDbPath;
    }
  }
});
