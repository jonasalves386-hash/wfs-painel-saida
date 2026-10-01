'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { adaptSigaDeparture, adaptSigaDepartures } = require('../src/providers/SigaDepartureAdapter');
const { isWideBody } = require('../src/domain/wideBody');
const { createSaidasService, selectFlights } = require('../src/services/saidasService');
const { SigaClient } = require('../src/providers/SigaClient');
const { FoniaProvider } = require('../src/providers/FoniaProvider');
const { RestProvider } = require('../src/providers/RestProvider');
const { MalhaProvider } = require('../src/providers/MalhaProvider');
const { requestJson, ProviderError } = require('../src/providers/httpClient');
const { createProviders } = require('../src/providers');

function departure(overrides = {}) {
  return {
    id: 'dep-1',
    number_departure: 'LA 3210',
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

test('normaliza saída SIGA no fuso de São Paulo e prioriza ETD sobre STD', () => {
  const result = adaptSigaDeparture(departure());
  assert.equal(result.flightNumber, 'LA3210');
  assert.equal(result.destination, 'BSB');
  assert.equal(result.std, '2026-09-29T15:20:00.000Z');
  assert.equal(result.etd, '2026-09-29T15:30:00.000Z');
  assert.equal(result.operationalAt, result.etd);
  assert.equal(result.position, 'BOX 14');
});

test('aceita somente registros de saída', () => {
  const records = [
    departure(),
    { id: 'arr-1', number_arrival: 'LA1234', eta_date: '29/09/2026', eta_time: '12:30' },
    { id: 'arr-2', operation_type: 'ARRIVAL', flight_number: 'LA5678' },
  ];
  assert.deepEqual(adaptSigaDepartures(records).map(item => item.id), ['dep-1']);
});

test('extrai a perna de saída mesmo quando a operação também contém chegada', () => {
  const result = adaptSigaDeparture(departure({
    operation_type: 'ARRIVAL',
    number_arrival: 'LA3001',
    eta_date: '29/09/2026',
    eta_time: '10:00',
    park_position_arrival: '101',
    park_position_departure: '202',
  }));

  assert.equal(result.flightNumber, 'LA3210');
  assert.equal(result.position, '202');
});

test('mantém a data do STD quando o ETD atravessa a meia-noite', () => {
  const result = adaptSigaDeparture(departure({
    std_date: '29/09/2026',
    std_time: '23:25',
    etd_date: '30/09/2026',
    etd_time: '00:20',
  }));

  assert.equal(result.date, '2026-09-29');
  assert.equal(result.std, '2026-09-30T02:25:00.000Z');
  assert.equal(result.etd, '2026-09-30T03:20:00.000Z');
  assert.equal(selectFlights(
    [result],
    '2026-09-30',
    new Date('2026-09-30T03:10:00.000Z'),
  ).length, 1);
});

test('interpreta timestamp sem offset como horário de São Paulo', () => {
  const result = adaptSigaDeparture(departure({ updated_at: '2026-09-29 12:31:15' }));
  assert.equal(result.updatedAt, '2026-09-29T15:31:15.000Z');
});

test('identifica Wide Body por prefixo oficial, classificação e modelo', () => {
  assert.equal(isWideBody({ aircraftPrefix: 'PR-XTA' }), true);
  assert.equal(isWideBody({ bodyType: 'Wide Body' }), true);
  assert.equal(isWideBody({ aircraftModel: 'Boeing 787-9' }), true);
  assert.equal(isWideBody({ aircraftPrefix: 'PR-ABC', aircraftModel: 'A320' }), false);
});

test('filtra Wide Body e duplicados no backend antes da resposta', async () => {
  const providers = {
    malha: {
      getFlightsSnapshot: async () => [
        departure(),
        departure(),
        departure({ id: 'wide-prefix', prefix: 'PR-XTA', number_departure: 'LA8080' }),
        departure({ id: 'wide-model', prefix: 'XX-AAA', aircraft_model: 'B777-300', number_departure: 'LA8090' }),
      ],
    },
    fonia: { isConfigured: () => true, getAssignments: async () => [{ operationId: 'dep-1', teamName: 'ALFA-T1' }] },
    rest: {
      isConfigured: () => true,
      getDepartureServices: async () => [{
        id: '2026-09-29_3210',
        servicos: {
          pushback: { assigned: true },
          qtu: { assigned: true, completed: true },
          qta: { assigned: false },
        },
      }],
    },
  };
  const service = createSaidasService(providers, { error() {} });
  const result = await service.getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });

  assert.equal(result.voos.length, 1);
  assert.equal(result.voos[0].voo, 'LA3210');
  assert.equal(result.voos[0].fonia, undefined);
  assert.equal(result.voos[0].servicos.fonia.escalado, true);
  assert.equal(result.voos[0].servicos.pushback.escalado, true);
  assert.equal(result.voos[0].servicos.qtu.finalizado, true);
  assert.deepEqual(result.meta.disponibilidade, {
    malha: 'disponivel', fonia: 'disponivel', rest: 'disponivel',
  });
  assert.deepEqual(result.meta.contagens, {
    snapshot: 4, saidasNormalizadas: 4, saidasExibiveis: 1,
  });
});

test('não confunde duas saídas reais do mesmo voo no mesmo dia', () => {
  const first = adaptSigaDeparture(departure({
    id: 'dep-madrugada', std_time: '00:25', etd_time: '00:25',
  }));
  const second = adaptSigaDeparture(departure({
    id: 'dep-noite', std_time: '22:25', etd_time: '22:25',
  }));

  const selected = selectFlights(
    [first, second],
    '2026-09-29',
    new Date('2026-10-01T12:00:00.000Z'),
  );
  assert.deepEqual(selected.map(flight => flight.id), ['dep-madrugada', 'dep-noite']);
});

test('remove status C do SIGA como cancelado', () => {
  const cancelled = adaptSigaDeparture(departure({ status_flight_departure: 'C' }));
  assert.equal(cancelled.cancelled, true);
  assert.equal(selectFlights(
    [cancelled],
    '2026-09-29',
    new Date('2026-09-29T15:00:00.000Z'),
  ).length, 0);
});

test('falha de enriquecimento é sinalizada sem criar escala fictícia', async () => {
  const providers = {
    malha: { getFlightsSnapshot: async () => [departure()] },
    fonia: { isConfigured: () => true, getAssignments: async () => { throw new Error('offline'); } },
    rest: { isConfigured: () => false, getDepartureServices: async () => [] },
  };
  const service = createSaidasService(providers, { error() {} });
  const result = await service.getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });

  assert.equal(result.voos[0].servicos.fonia.escalado, false);
  assert.equal(result.voos[0].servicos.fonia.indisponivel, true);
  assert.equal(result.voos[0].servicos.pushback.indisponivel, true);
  assert.equal(result.meta.disponibilidade.fonia, 'indisponivel');
  assert.equal(result.meta.disponibilidade.rest, 'nao_configurada');
});

test('PUSH_OUT preenchido remove o voo imediatamente', () => {
  const pushed = adaptSigaDeparture(departure({
    pushout_date: '29/09/2026',
    push_out: '12:02',
  }));
  assert.equal(pushed.hasPushOut, true);
  assert.equal(pushed.pushOut, '2026-09-29T15:02:00.000Z');
  assert.equal(pushed.status, 'REALIZADO');
  assert.equal(selectFlights([pushed], '2026-09-29', new Date('2026-09-29T15:00:00.000Z')).length, 0);
});

test('remoção não usa departure_time nem outro indicador no lugar de PUSH_OUT', () => {
  const flight = adaptSigaDeparture(departure({ departure_time: '12:03' }));
  assert.equal(flight.hasPushOut, false);
  assert.equal(flight.pushOut, null);
  assert.equal(flight.status, 'PROGRAMADO');
  assert.equal(selectFlights([flight], '2026-09-29', new Date('2026-09-29T15:00:00.000Z')).length, 1);
});

test('PUSH_OUT preenchido remove mesmo quando o valor não é um horário parseável', () => {
  const pushed = adaptSigaDeparture(departure({ push_out: 'CONFIRMADO' }));
  assert.equal(pushed.hasPushOut, true);
  assert.equal(pushed.pushOut, null);
  assert.equal(selectFlights([pushed], '2026-09-29', new Date('2026-09-29T15:00:00.000Z')).length, 0);
});

test('mapeia posição e push out pelos nomes reais do snapshot SIGA', () => {
  const pushed = adaptSigaDeparture(departure({
    position: '',
    park_position_departure: '204',
    pushout_date: '29/09/2026',
    push_out: '12:04',
  }));
  assert.equal(pushed.position, '204');
  assert.equal(pushed.hasPushOut, true);
  assert.equal(pushed.pushOut, '2026-09-29T15:04:00.000Z');
  assert.equal(pushed.status, 'REALIZADO');
});

test('polling remove o voo quando PUSH_OUT surge no snapshot seguinte, independentemente da equipe', async () => {
  let snapshot = [departure()];
  const providers = {
    malha: { getFlightsSnapshot: async () => snapshot },
    fonia: {
      isConfigured: () => true,
      getAssignments: async () => [{ operationId: 'dep-1', teamName: 'ALFA-T1', inPosition: true }],
    },
    rest: {
      isConfigured: () => true,
      getDepartureServices: async () => [{ operationId: 'dep-1', push_out: 'IGNORADO' }],
    },
  };
  const service = createSaidasService(providers, { error() {} });

  const before = await service.getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });
  assert.equal(before.voos.length, 1);
  assert.equal(before.voos[0].servicos.fonia.pushReal, false);

  snapshot = [departure({ pushout_date: '29/09/2026', push_out: '12:01' })];
  const after = await service.getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:01.000Z'),
  });
  assert.equal(after.voos.length, 0);
});

test('SigaClient mantém URL e chave exclusivamente na chamada backend', async () => {
  let call;
  const client = new SigaClient({
    baseUrl: 'https://malha.test/base/',
    apiKey: 'segredo',
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, json: async () => [] };
    },
  });
  await client.getFlightsSnapshot();
  assert.equal(call.url, 'https://malha.test/base/siga-flights/public');
  assert.equal(call.options.headers['x-api-key'], 'segredo');
});

test('providers Fonia e REST consultam somente pelo backend com autenticação', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => [] };
  };
  const fonia = new FoniaProvider({
    baseUrl: 'https://fonia.test', apiKey: 'fonia-key', fetchImpl,
  });
  const rest = new RestProvider({
    baseUrl: 'https://rest.test', token: 'rest-token', fetchImpl,
  });

  await fonia.getAssignments('2026-09-29');
  await rest.getDepartureServices('2026-09-29');

  assert.equal(calls[0].url, 'https://fonia.test/fonia/public?data=2026-09-29');
  assert.equal(calls[0].options.headers['x-api-key'], 'fonia-key');
  assert.equal(calls[1].url, 'https://rest.test/voos?tipo=saida&data=2026-09-29');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer rest-token');
});

test('SIGA usa timeout dedicado sem alterar timeout dos enriquecimentos', () => {
  const providers = createProviders({
    MALHA_BASE_URL: 'https://malha.test',
    SIGA_STREAM_API_KEY: 'teste',
    PROVIDER_TIMEOUT_MS: '9000',
  });
  assert.equal(providers.malha.client.timeoutMs, 120000);
  assert.equal(providers.fonia.timeoutMs, 9000);
  assert.equal(providers.rest.timeoutMs, 9000);

  const custom = createProviders({
    MALHA_BASE_URL: 'https://malha.test',
    SIGA_STREAM_API_KEY: 'teste',
    SIGA_TIMEOUT_MS: '80000',
  });
  assert.equal(custom.malha.client.timeoutMs, 80000);
});

test('timeout durante leitura do JSON é classificado como timeout, não payload inválido', async () => {
  await assert.rejects(requestJson('https://malha.test/snapshot', {
    timeoutMs: 5,
    fetchImpl: async (url, options) => ({
      ok: true,
      json: () => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true });
      }),
    }),
  }), (error) => error.code === 'PROVIDER_TIMEOUT' && error.status === 504);
});

test('Malha preserva snapshot real, atualiza uma única vez em segundo plano e sinaliza stale', async () => {
  let calls = 0;
  let finishRefresh;
  let currentTime = 1000;
  const client = {
    isConfigured: () => true,
    getFlightsSnapshot: async () => {
      calls += 1;
      if (calls === 1) return [departure()];
      return new Promise((resolve) => { finishRefresh = resolve; });
    },
  };
  const provider = new MalhaProvider({
    client,
    now: () => currentTime,
    staleAfterMs: 120000,
    logger: { warn() {}, error() {} },
  });

  const first = await provider.getFlightsSnapshot();
  const cached = await provider.getFlightsSnapshot();
  assert.deepEqual(cached, first);
  assert.equal(calls, 2);

  currentTime += 120001;
  assert.equal(provider.getCacheStatus().stale, true);
  finishRefresh([departure({ id: 'dep-2', number_departure: 'LA3220' })]);
  await provider.refresh();
  assert.equal(provider.getCacheStatus().stale, false);
});

test('Malha restaura o último snapshot real após reiniciar o provider', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-saidas-cache-'));
  const cachePath = path.join(directory, 'malha-snapshot.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const writer = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => [departure()] },
    cachePath,
    logger: { warn() {}, error() {} },
    now: () => 123456,
  });
  const expected = await writer.getFlightsSnapshot();

  const reader = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => new Promise(() => {}) },
    cachePath,
    logger: { warn() {}, error() {} },
    now: () => 123456,
  });
  assert.deepEqual(await reader.getFlightsSnapshot(), expected);
  assert.equal(reader.getCacheStatus().updatedAt, new Date(123456).toISOString());
});

test('serviço entrega cache stale com indisponibilidade explícita, sem transformar em lista vazia', async () => {
  const providers = {
    malha: {
      getFlightsSnapshot: async () => [departure()],
      getCacheStatus: () => ({ stale: true, updatedAt: '2026-09-29T14:59:00.000Z' }),
    },
    fonia: { isConfigured: () => false, getAssignments: async () => [] },
    rest: { isConfigured: () => false, getDepartureServices: async () => [] },
  };
  const result = await createSaidasService(providers, { error() {} }).getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });

  assert.equal(result.voos.length, 1);
  assert.equal(result.meta.disponibilidade.malha, 'indisponivel');
  assert.equal(result.meta.malhaAtualizadaEm, '2026-09-29T14:59:00.000Z');
});

test('snapshot SIGA válido e vazio é uma resposta disponível com zero voos', async () => {
  const providers = {
    malha: {
      getFlightsSnapshot: async () => [],
      getCacheStatus: () => ({ stale: false, updatedAt: '2026-09-29T15:00:00.000Z' }),
    },
    fonia: { isConfigured: () => false, getAssignments: async () => [] },
    rest: { isConfigured: () => false, getDepartureServices: async () => [] },
  };
  const result = await createSaidasService(providers, { error() {} }).getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });

  assert.deepEqual(result.voos, []);
  assert.equal(result.meta.disponibilidade.malha, 'disponivel');
  assert.deepEqual(result.meta.contagens, {
    snapshot: 0, saidasNormalizadas: 0, saidasExibiveis: 0,
  });
});

test('falha SIGA sem cache é propagada e nunca convertida em zero voos', async () => {
  const failure = Object.assign(new Error('falha controlada'), { code: 'SIGA_UNAVAILABLE' });
  const providers = {
    malha: { getFlightsSnapshot: async () => { throw failure; } },
    fonia: { isConfigured: () => false, getAssignments: async () => [] },
    rest: { isConfigured: () => false, getDepartureServices: async () => [] },
  };

  await assert.rejects(
    createSaidasService(providers, { error() {} }).getVoos({
      date: '2026-09-29',
      now: new Date('2026-09-29T15:00:00.000Z'),
    }),
    error => error === failure,
  );
});

test('cache antigo restaurado aguarda a Malha nova em vez de servir PUSH_OUT desatualizado', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-saidas-cache-'));
  const cachePath = path.join(directory, 'malha-snapshot.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = { warn() {}, error() {} };

  await new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => [departure({ id: 'antigo' })] },
    cachePath, logger, now: () => 0,
  }).getFlightsSnapshot();

  const fresh = [departure({ id: 'novo' })];
  const reader = new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => fresh },
    cachePath, logger, now: () => 16 * 60 * 1000,
  });
  assert.deepEqual(await reader.getFlightsSnapshot(), fresh);
});

test('cache antigo ainda é usado quando a Malha falha', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-saidas-cache-'));
  const cachePath = path.join(directory, 'malha-snapshot.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = { warn() {}, error() {} };

  const expected = await new MalhaProvider({
    client: { isConfigured: () => true, getFlightsSnapshot: async () => [departure({ id: 'antigo' })] },
    cachePath, logger, now: () => 0,
  }).getFlightsSnapshot();

  const reader = new MalhaProvider({
    client: {
      isConfigured: () => true,
      getFlightsSnapshot: async () => { throw new ProviderError('fora', { code: 'PROVIDER_TIMEOUT', status: 504 }); },
    },
    cachePath, logger, now: () => 16 * 60 * 1000,
  });
  assert.deepEqual(await reader.getFlightsSnapshot(), expected);
  assert.equal(reader.getCacheStatus().stale, true);
});

test('só os serviços REST liberados sinalizam; os demais ficam cinza', async () => {
  const providers = {
    malha: { getFlightsSnapshot: async () => [departure()] },
    fonia: { isConfigured: () => false, getAssignments: async () => [] },
    rest: { isConfigured: () => true, getDepartureServices: async () => [] },
  };
  const result = await createSaidasService(providers, { error() {} }, { restServices: ['pushback'] }).getVoos({
    date: '2026-09-29',
    now: new Date('2026-09-29T15:00:00.000Z'),
  });
  const { servicos } = result.voos[0];
  assert.equal(servicos.pushback.indisponivel, false);
  assert.equal(servicos.qtu.indisponivel, true);
  assert.equal(servicos.qta.indisponivel, true);
  assert.equal(servicos.fonia.indisponivel, true);
});
