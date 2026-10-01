'use strict';

const { ProviderError, normalizedBaseUrl, requestJson, extractArray } = require('./httpClient');

class SigaClient {
  constructor({ baseUrl, apiKey, timeoutMs = 120000, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getFlightsSnapshot() {
    if (!this.isConfigured()) {
      throw new ProviderError('A consulta SIGA/Malha não está configurada.', {
        status: 503,
        code: 'SIGA_NOT_CONFIGURED',
      });
    }

    const payload = await requestJson(`${this.baseUrl}/siga-flights/public`, {
      headers: { 'x-api-key': this.apiKey },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return extractArray(payload);
  }
}

module.exports = { SigaClient };
