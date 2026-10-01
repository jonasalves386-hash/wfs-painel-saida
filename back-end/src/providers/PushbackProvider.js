'use strict';

const { requestJson, extractArray } = require('./httpClient');

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Integração de escalados do Pushback (coidatacenter.com/api-pushback).
// O casamento com a Malha é data + voo da perna de SAÍDA.
function adaptPushbackRecord(record) {
  const saida = record?.saida;
  const date = text(saida?.data);
  const flightNumber = text(saida?.voo);
  if (!date || !flightNumber) return null;

  const operador = text(record.operador?.nome);
  const acoplado = Boolean(text(record.acoplagem));
  return {
    date,
    flight_number: flightNumber,
    pushback: {
      escalado: record.escalado === true || Boolean(operador),
      naPosicao: Boolean(text(record.na_posicao)),
      acoplado,
      // Verde operacional = acoplado (ou encerrado pela ferramenta).
      finalizado: acoplado || record.finalizado === true,
      operador,
      valor: operador,
    },
  };
}

class PushbackProvider {
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
    return extractArray(payload).map(adaptPushbackRecord).filter(Boolean);
  }
}

module.exports = { PushbackProvider, adaptPushbackRecord };
