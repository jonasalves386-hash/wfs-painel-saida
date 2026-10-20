'use strict';

const { requestJson, extractArray } = require('./httpClient');

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// A API devolve "LA3448"; a Malha/Fonia usam "3448".
function stripAirlinePrefix(value) {
  return text(value).replace(/\s+/g, '').replace(/^[A-Za-z]{2}(?=\d)/, '').toUpperCase();
}

// Integração de retiradas (GET .../api/painel/retiradas, header x-api-key, ?data=AAAA-MM-DD).
// Só interessa voo com retirada lançada (hr_retirada preenchido).
function adaptRetiradaRecord(record) {
  const texto = text(record?.hr_retirada);
  const date = text(record?.data);
  const flightNumber = stripAirlinePrefix(record?.voo);
  if (!texto || !date || !flightNumber) return null;

  const pendentes = Number(record.bagagens_pendentes);
  return {
    date,
    flight_number: flightNumber,
    retirada: {
      texto,
      status: text(record.status_retirada) || null,
      pendentes: Number.isFinite(pendentes) ? pendentes : 0,
      atualizadoEm: text(record.atualizado_em) || null,
    },
  };
}

class RetiradasProvider {
  constructor({ url, apiKey, timeoutMs = 25000, fetchImpl = fetch } = {}) {
    this.url = text(url).replace(/\/+$/, '');
    this.apiKey = text(apiKey);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return /^https?:\/\//.test(this.url) && Boolean(this.apiKey);
  }

  async getEscalados(date) {
    if (!this.isConfigured()) return [];
    const query = new URLSearchParams({ data: date });
    const payload = await requestJson(`${this.url}?${query}`, {
      headers: { 'x-api-key': this.apiKey },
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return extractArray(payload).map(adaptRetiradaRecord).filter(Boolean);
  }
}

module.exports = { RetiradasProvider, adaptRetiradaRecord, stripAirlinePrefix };
