'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { createProviders } = require('./providers');
const { createSaidasService, InputError } = require('./services/saidasService');
const { ProviderError } = require('./providers/httpClient');

function createApp({ service, env = process.env, logger = console } = {}) {
  const app = express();
  const saidasService = service || createSaidasService(createProviders(env), logger);
  const allowedOrigins = [
    env.FRONTEND_URL,
    'https://jonasalves386-hash.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
  ].filter(Boolean);

  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origem não autorizada.'));
    },
    methods: ['GET'],
    exposedHeaders: ['X-Data-Stale'],
  }));

  app.get('/api/saidas/voos', async (req, res) => {
    try {
      const payload = await saidasService.getVoos({ date: req.query.data });
      res.set('Cache-Control', 'no-store');
      res.set('X-Data-Stale', payload?.meta?.disponibilidade?.malha === 'indisponivel' ? 'true' : 'false');
      return res.json(payload);
    } catch (error) {
      const knownError = error instanceof ProviderError || error instanceof InputError;
      const status = knownError ? error.status : 502;
      logger.error('[saidas] Erro ao carregar painel.', knownError ? error.code : error.name);
      return res.status(status).json({
        erro: knownError ? error.message : 'Não foi possível carregar os voos de saída.',
        codigo: knownError ? error.code : 'SAIDAS_UNAVAILABLE',
      });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(express.static(path.resolve(__dirname, '../../front-end')));
  return app;
}

const app = createApp();
module.exports = app;
module.exports.createApp = createApp;
