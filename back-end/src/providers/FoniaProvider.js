'use strict';

const { normalizedBaseUrl, requestJson, extractArray } = require('./httpClient');

class FoniaProvider {
  constructor({ baseUrl, apiKey, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizedBaseUrl(baseUrl);
    this.apiKey = String(apiKey || '').trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async getAssignments(date) {
    if (!this.isConfigured()) return [];
    const query = new URLSearchParams({ data: date });
    const payload = await requestJson(`${this.baseUrl}/fonia/public?${query}`, {
      headers: { 'x-api-key': this.apiKey },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return extractArray(payload);
  }
}

module.exports = { FoniaProvider };
