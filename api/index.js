const express = require('express');
const path = require('node:path');
const grantFoundation = require('..');

function defaultDatabasePath() {
  if (process.env.GRANT_DB_PATH) {
    return process.env.GRANT_DB_PATH;
  }
  if (process.env.VERCEL) {
    return path.join('/tmp', 'grant-foundation.db');
  }
  return path.join(process.cwd(), 'grant-foundation.db');
}

function createApp() {
  const app = express();
  const root = '/grants';

  app.set('trust proxy', 1);
  app.use(root, grantFoundation({ root, dbPath: defaultDatabasePath() }));

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'grant-foundation',
      routes: {
        grants: root
      }
    });
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port);
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.defaultDatabasePath = defaultDatabasePath;
