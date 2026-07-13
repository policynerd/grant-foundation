const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const grantFoundation = require('./index');

test('mounts as express middleware and serves health payload', async () => {
  const app = express();
  const server = app.use('/grants', grantFoundation({ root: '/grants' })).listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/grants/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      name: 'grant-foundation',
      root: '/grants'
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
