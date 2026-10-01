'use strict';

const { normalizedBaseUrl, requestJson, extractArray } = require('./httpClient');

class RestProvider {
  constructor({ baseUrl, token, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.token = String(token || '').trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async getDepartureServices(date) {
    if (!this.isConfigured()) return [];
    const query = new URLSearchParams({ tipo: 'saida', data: date });
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};
    const payload = await requestJson(`${this.baseUrl}/voos?${query}`, {
      headers,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return extractArray(payload);
  }
}

module.exports = { RestProvider };
