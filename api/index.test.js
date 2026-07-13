const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./index');

test('api entrypoint exposes service and grant routes', async () => {
  process.env.GRANT_DB_PATH = ':memory:';
  const server = app.listen(0);
  const { port } = server.address();

  try {
    const rootResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(rootResponse.status, 200);
    assert.deepEqual(await rootResponse.json(), {
      ok: true,
      service: 'grant-foundation',
      routes: {
        grants: '/grants'
      }
    });

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
