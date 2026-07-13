const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./index');

test('api entrypoint exposes service and grant routes', async () => {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
