const express = require('express');

module.exports = function createGrantFoundation(config = {}) {
  const router = express.Router();
  const root = config.root || '';
  const name = config.name || 'grant-foundation';

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      name,
      root,
      endpoints: {
        health: `${root}/health`
      }
    });
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name,
      root
    });
  });

  return router;
};
