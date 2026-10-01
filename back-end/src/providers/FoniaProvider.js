'use strict';

const { requestJson, extractArray } = require('./httpClient');

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Integração de escalados da Fonia (coidatacenter.com/api-wfs-fonia, rota de
// saídas). O casamento com a Malha é data + voo de saída.
function adaptFoniaRecord(record) {
  const date = text(record?.data);
  const flightNumber = text(record?.voo);
  if (!date || !flightNumber || record.cancelado === true) return null;

  const equipe = text(record.equipe?.nome);
  return {
    date,
    flight_number: flightNumber,
    fonia: {
      escalado: record.escalado === true && Boolean(equipe),
      // Verde = botão "na posição" pressionado no mobile.
      naPosicao: record.na_posicao === true,
      finalizado: record.finalizada === true,
      equipe,
      valor: equipe,
    },
  };
}

class FoniaProvider {
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
    return extractArray(payload).map(adaptFoniaRecord).filter(Boolean);
  }
}

module.exports = { FoniaProvider, adaptFoniaRecord };
