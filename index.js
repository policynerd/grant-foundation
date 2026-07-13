const express = require('express');

module.exports = function createGrantFoundation(config = {}) {
  const router = express.Router();
  const root = config.root || '';

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'grant-foundation',
      root
    });
  });

  return router;
};
