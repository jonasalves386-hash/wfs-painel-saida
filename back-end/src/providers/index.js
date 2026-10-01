'use strict';

const path = require('node:path');
const { SigaClient } = require('./SigaClient');
const { MalhaProvider } = require('./MalhaProvider');
const { FoniaProvider } = require('./FoniaProvider');
const { RestProvider } = require('./RestProvider');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createProviders(env = process.env) {
  const timeoutMs = positiveInteger(env.PROVIDER_TIMEOUT_MS, 25000);
  const sigaTimeoutMs = positiveInteger(env.SIGA_TIMEOUT_MS, 120000);
  const malhaBaseUrl = env.MALHA_BASE_URL || env.FLIGHTRADAR_API_BASE_URL;
  const malhaApiKey = env.SIGA_STREAM_API_KEY || env.FLIGHTRADAR_STREAM_API_KEY || env.FLIGHTRADAR_API_KEY;

  const sigaClient = new SigaClient({
    baseUrl: malhaBaseUrl,
    apiKey: malhaApiKey,
    timeoutMs: sigaTimeoutMs,
  });

  return {
    malha: new MalhaProvider({
      client: sigaClient,
      cachePath: path.resolve(__dirname, '../../.runtime-cache/malha-snapshot.json'),
    }),
    fonia: new FoniaProvider({
      baseUrl: env.FONIA_API_BASE_URL || malhaBaseUrl,
      apiKey: env.FONIA_STREAM_API_KEY,
      timeoutMs,
    }),
    rest: new RestProvider({
      baseUrl: env.REST_API_BASE_URL,
      token: env.REST_API_TOKEN,
      timeoutMs,
    }),
  };
}

module.exports = { createProviders };
