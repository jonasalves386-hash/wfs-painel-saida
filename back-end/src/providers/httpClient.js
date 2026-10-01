'use strict';

class ProviderError extends Error {
  constructor(message, { status = 502, code = 'PROVIDER_UNAVAILABLE' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
  }
}

function normalizedBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const placeholderHost = /(?:^|\.)(?:example|exemplo)$|^sua-api-/i.test(url.hostname);
    return /^https?:$/.test(url.protocol) && !placeholderHost ? raw : '';
  } catch {
    return '';
  }
}

async function requestJson(url, { headers = {}, timeoutMs = 25000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      if (controller.signal.aborted) {
        throw new ProviderError('A API excedeu o tempo limite.', { status: 504, code: 'PROVIDER_TIMEOUT' });
      }
      throw new ProviderError('Não foi possível consultar a API.');
    }

    if (!response.ok) {
      throw new ProviderError('A API recusou a consulta.', { code: 'PROVIDER_REJECTED' });
    }

    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new ProviderError('A API excedeu o tempo limite.', { status: 504, code: 'PROVIDER_TIMEOUT' });
      }
      throw new ProviderError('A API retornou uma resposta inválida.', { code: 'PROVIDER_INVALID_RESPONSE' });
    }
  } finally {
    clearTimeout(timer);
  }
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'items', 'flights', 'voos', 'assignments', 'services']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new ProviderError('A API retornou uma resposta inválida.', { code: 'PROVIDER_INVALID_RESPONSE' });
}

module.exports = { ProviderError, normalizedBaseUrl, requestJson, extractArray };
