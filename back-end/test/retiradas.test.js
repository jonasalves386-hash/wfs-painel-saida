'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RetiradasProvider, adaptRetiradaRecord } = require('../src/providers/RetiradasProvider');
const { createSaidasService } = require('../src/services/saidasService');
const { createProviders } = require('../src/providers');

function departure(overrides = {}) {
  return {
    id: 'dep-1',
    number_departure: 'LA 3448',
    prefix: 'PR-ABC',
    des: 'BSB',
    std_date: '29/09/2026',
    std_time: '12:20',
    etd_date: '29/09/2026',
    etd_time: '12:30',
    position: 'BOX 14',
    status_flight_departure: 'PROGRAMADO',
    ...overrides,
  };
}

const registro = (overrides = {}) => ({
  voo: 'LA3448', data: '2026-09-29', status_retirada: 'RETIRADA',
  hr_retirada: '01 VOL 03:19–03:39', bagagens_pendentes: 2, atualizado_em: '2026-09-29T15:00:00Z',
  ...overrides,
});

test('retiradas: envia x-api-key e ?data, descarta hr_retirada nulo e remove prefixo do voo', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => [registro(), registro({ voo: 'LA9999', hr_retirada: null })] };
  };
  const provider = new RetiradasProvider({ url: 'https://ret.test/api/painel/retiradas', apiKey: 'k', fetchImpl });

  const result = await provider.getEscalados('2026-09-29');

  assert.equal(calls[0].url, 'https://ret.test/api/painel/retiradas?data=2026-09-29');
  assert.equal(calls[0].options.headers['x-api-key'], 'k');
  assert.deepEqual(result, [{
    date: '2026-09-29',
    flight_number: '3448',
    retirada: { texto: '01 VOL 03:19–03:39', status: 'RETIRADA', pendentes: 2, atualizadoEm: '2026-09-29T15:00:00Z' },
  }]);
});

test('retiradas: sem URL/token retorna lista vazia sem chamar a API', async () => {
  let called = false;
  const provider = new RetiradasProvider({ url: '', apiKey: '', fetchImpl: async () => { called = true; } });
  assert.equal(provider.isConfigured(), false);
  assert.deepEqual(await provider.getEscalados('2026-09-29'), []);
  assert.equal(called, false);
  assert.equal(adaptRetiradaRecord(registro({ hr_retirada: '  ' })), null);
});

test('retiradas: casa "LA3448" com a malha por data + voo', async () => {
  const providers = {
    malha: { getFlightsSnapshot: async () => [departure(), departure({ id: 'dep-2', number_departure: 'LA 5000' })] },
    retiradas: {
      isConfigured: () => true,
      getEscalados: async () => [adaptRetiradaRecord(registro())],
    },
    rest: { isConfigured: () => false },
  };
  const service = createSaidasService(providers, { error() {} });
  const result = await service.getVoos({ date: '2026-09-29', now: new Date('2026-09-29T15:00:00.000Z') });

  const byNumber = Object.fromEntries(result.voos.map((v) => [v.voo, v.servicos.retirada]));
  assert.equal(byNumber.LA3448.texto, '01 VOL 03:19–03:39');
  assert.equal(byNumber.LA3448.pendentes, 2);
  assert.equal(byNumber.LA5000.lancada, false);
  assert.equal(result.meta.disponibilidade.retiradas, 'disponivel');
});

test('retiradas: falha da API não derruba o painel', async () => {
  const providers = {
    malha: { getFlightsSnapshot: async () => [departure()] },
    retiradas: { isConfigured: () => true, getEscalados: async () => { throw new Error('boom'); } },
    rest: { isConfigured: () => false },
  };
  const service = createSaidasService(providers, { error() {} });
  const result = await service.getVoos({ date: '2026-09-29', now: new Date('2026-09-29T15:00:00.000Z') });

  assert.equal(result.voos.length, 1);
  assert.equal(result.voos[0].servicos.retirada.lancada, false);
  assert.equal(result.voos[0].servicos.retirada.indisponivel, true);
  assert.equal(result.meta.disponibilidade.retiradas, 'indisponivel');
});

test('retiradas: createProviders lê RETIRADAS_API_BASE_URL e RETIRADAS_API_TOKEN', () => {
  const providers = createProviders({
    MALHA_BASE_URL: 'https://malha.test', SIGA_STREAM_API_KEY: 'x',
    RETIRADAS_API_BASE_URL: 'https://ret.test/api/painel/retiradas', RETIRADAS_API_TOKEN: 't',
  });
  assert.equal(providers.retiradas.isConfigured(), true);
});
