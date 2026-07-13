const express = require('express');
const grantFoundation = require('..');

const app = express();
const root = '/grants';

app.use(root, grantFoundation({ root }));

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
