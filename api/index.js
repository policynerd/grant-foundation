const express = require('express');
const path = require('node:path');
const grantFoundation = require('..');

const app = express();
const root = '/grants';
const databasePath = process.env.GRANT_DB_PATH || path.join(process.cwd(), 'grant-foundation.db');

app.use(root, grantFoundation({ root, dbPath: databasePath }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'grant-foundation',
    routes: {
      grants: root
    }
  });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port);
}

module.exports = app;
