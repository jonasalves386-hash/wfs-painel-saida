'use strict';

const {
  adaptSigaDepartures,
  normalizeDateKey,
  normalizeFlightNumber,
  saoPauloDateKey,
  serviceFlightNumber,
} = require('../providers/SigaDepartureAdapter');

const WINDOW_MINUTES = 60;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
    this.code = 'INVALID_DATE';
  }
}

function todayInSaoPaulo(now = new Date()) {
  return saoPauloDateKey(now);
}

function normalizeSelectedDate(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return todayInSaoPaulo(now);
  const normalized = normalizeDateKey(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new InputError('Data inválida. Use YYYY-MM-DD.');
  }
  return normalized;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  return /^(?:1|true|sim|yes|ok|finalizado|escalado)$/i.test(String(value || '').trim());
}

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function recordFlightNumber(record) {
  return normalizeFlightNumber(firstValue(record, [
    'number_departure', 'departure_flight_number', 'flight_number', 'flightNumber',
    'numeroVoo', 'voo', 'numero',
  ]));
}

function recordDate(record) {
  return normalizeDateKey(firstValue(record, [
    'date', 'data', 'flight_date', 'departure_date', 'dataSaida', 'std_date', 'etd_date',
  ]));
}

function matchingKeys(record) {
  const keys = new Set();
  for (const idKey of ['id', 'operation_id', 'operationId', 'flight_id', 'flightId', 'serviceKey']) {
    const id = String(record?.[idKey] || '').trim();
    if (id) keys.add(`id:${id}`);
  }
  const flight = recordFlightNumber(record);
  const date = recordDate(record);
  if (flight && date) {
    keys.add(`flight:${date}|${flight}`);
    keys.add(`service:${date}_${serviceFlightNumber(flight)}`);
  }
  return keys;
}

function flightKeys(flight) {
  return new Set([
    flight.sourceId ? `id:${flight.sourceId}` : '',
    flight.id ? `id:${flight.id}` : '',
    flight.serviceKey ? `id:${flight.serviceKey}` : '',
    `flight:${flight.date}|${flight.flightNumber}`,
    `service:${flight.serviceKey}`,
  ].filter(Boolean));
}

function indexRecords(records) {
  const index = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const key of matchingKeys(record)) index.set(key, record);
  }
  return index;
}

function findRecord(index, flight) {
  for (const key of flightKeys(flight)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

function serviceObject(record, names) {
  const containers = [record?.servicos, record?.services, record];
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const name of names) {
      if (container[name] && typeof container[name] === 'object') return container[name];
    }
  }
  return {};
}

function normalizeService(record, names) {
  const service = serviceObject(record, names);
  const assignedValue = firstValue(service, ['escalado', 'assigned', 'isAssigned', 'alocado']);
  const completedValue = firstValue(service, ['finalizado', 'completed', 'isCompleted', 'concluido']);
  const description = firstValue(service, ['valor', 'teamName', 'equipe', 'responsavel', 'name']);
  return {
    escalado: bool(assignedValue) || Boolean(String(description || '').trim()),
    finalizado: bool(completedValue),
    valor: String(description || '').trim(),
  };
}

function normalizeFonia(record) {
  const service = record?.fonia || {};
  const equipe = String(service.equipe || '').trim();
  return {
    escalado: Boolean(service.escalado),
    naPosicao: Boolean(service.naPosicao),
    finalizado: Boolean(service.finalizado),
    equipe,
    valor: equipe,
  };
}

function minutesBetween(future, now) {
  return (Date.parse(future) - now.getTime()) / 60000;
}

function deduplicate(flights) {
  const byKey = new Map();
  for (const flight of flights) {
    // STD + voo identifica a perna. Usar somente data + voo elimina saídas
    // legítimas quando o mesmo número opera mais de uma vez no mesmo dia.
    const key = flight.operationKey || `${flight.date}|${flight.flightNumber}|${flight.std || flight.operationalAt}`;
    const previous = byKey.get(key);
    const previousUpdatedAt = Date.parse(previous?.updatedAt || '');
    const currentUpdatedAt = Date.parse(flight.updatedAt || '');
    const currentIsNewer = Number.isFinite(currentUpdatedAt)
      && (!Number.isFinite(previousUpdatedAt) || currentUpdatedAt >= previousUpdatedAt);
    const currentIsRicher = Object.values(flight).filter(Boolean).length
      >= Object.values(previous || {}).filter(Boolean).length;
    if (!previous || currentIsNewer || (!Number.isFinite(currentUpdatedAt) && currentIsRicher)) {
      byKey.set(key, flight);
    }
  }
  return [...byKey.values()];
}

function selectFlights(flights, selectedDate, now) {
  const today = todayInSaoPaulo(now);
  const isLiveDate = selectedDate === today;
  return deduplicate(flights)
    // Exclusão terminal antes de data, janela, status e enriquecimentos.
    .filter((flight) => !flight.hasPushOut)
    .filter((flight) => !flight.wideBody && !flight.cancelled)
    .filter((flight) => {
      if (!isLiveDate) return flight.date === selectedDate;

      // Na visão ao vivo, ETD governa a janela. Assim um voo cujo STD era
      // antes da meia-noite continua visível se foi estimado para depois dela.
      const remaining = minutesBetween(flight.operationalAt, now);
      return Number.isFinite(remaining) && remaining >= -WINDOW_MINUTES && remaining <= WINDOW_MINUTES;
    })
    .sort((a, b) => (
      Date.parse(a.operationalAt) - Date.parse(b.operationalAt)
      || a.flightNumber.localeCompare(b.flightNumber)
      || String(a.operationKey || a.id).localeCompare(String(b.operationKey || b.id))
    ));
}

function normalizePushback(record) {
  const service = record?.pushback || {};
  const operador = String(service.operador || '').trim();
  return {
    escalado: Boolean(service.escalado),
    naPosicao: Boolean(service.naPosicao),
    acoplado: Boolean(service.acoplado),
    finalizado: Boolean(service.finalizado),
    operador,
    valor: operador,
  };
}

function publicFlight(flight, foniaRecord, pushbackRecord, restRecord, availability) {
  // Um PUSH_OUT da Malha nunca alcança esta etapa: ele já foi excluído em
  // selectFlights. Provedores de equipe não podem simular esse sinal terminal.
  const pushReal = false;
  const fonia = normalizeFonia(foniaRecord);
  const pushback = normalizePushback(pushbackRecord);
  const qtu = normalizeService(restRecord, ['qtu', 'QTU']);
  const qta = normalizeService(restRecord, ['qta', 'QTA']);

  return {
    id: flight.id,
    voo: flight.flightNumber,
    prefixo: flight.aircraftPrefix || null,
    destino: flight.destination || null,
    std: flight.std,
    etd: flight.etd,
    horario: flight.operationalAt,
    posicao: flight.position || null,
    box: flight.position || null,
    status: pushReal ? 'REALIZADO' : (flight.status || null),
    pushOutReal: flight.pushOut,
    data: flight.date,
    servicos: {
      fonia: { ...fonia, indisponivel: !availability.fonia, pushReal },
      pushback: { ...pushback, indisponivel: !availability.pushback, pushReal },
      qtu: { ...qtu, indisponivel: !availability.rest, pushReal },
      qta: {
        ...qta,
        emAndamento: qta.escalado && !qta.finalizado,
        indisponivel: !availability.rest,
        pushReal,
      },
    },
  };
}

const REUSE_LAST_MS = 5 * 60 * 1000;
const NOT_CONFIGURED = { isConfigured: () => false, getEscalados: async () => [] };

// Consulta uma integração de escalados (Fonia/Pushback) para as datas dos voos
// exibidos. Uma falha pontual reaproveita o último retorno válido por 5 min.
function createEscaladosLoader(name, provider, logger) {
  let last = { at: 0, dates: '', records: [] };

  return async function load(dates, now) {
    if (!provider.isConfigured()) return { state: 'nao_configurada', records: [] };
    if (!dates.length) return { state: 'disponivel', records: [] };
    const key = dates.join(',');
    try {
      const results = await Promise.all(dates.map((date) => provider.getEscalados(date)));
      last = { at: now.getTime(), dates: key, records: results.flat() };
      return { state: 'disponivel', records: last.records };
    } catch (error) {
      logger.error(`[saidas] Falha no provider ${name}.`, error.code || error.name);
      const reusable = last.dates === key && now.getTime() - last.at <= REUSE_LAST_MS;
      return reusable ? { state: 'disponivel', records: last.records } : { state: 'indisponivel', records: [] };
    }
  };
}

function createSaidasService(providers, logger = console) {
  const loadFonia = createEscaladosLoader('Fonia', providers.fonia || NOT_CONFIGURED, logger);
  const loadPushback = createEscaladosLoader('Pushback', providers.pushback || NOT_CONFIGURED, logger);

  async function getVoos({ date, now = new Date() } = {}) {
    const selectedDate = normalizeSelectedDate(date, now);

    let snapshot;
    try {
      snapshot = await providers.malha.getFlightsSnapshot();
    } catch (error) {
      logger.error('[saidas] Falha no provider SIGA/Malha.', error.code || error.name);
      throw error;
    }

    const malhaCache = providers.malha.getCacheStatus?.() || {
      available: true,
      stale: false,
      updatedAt: now.toISOString(),
    };

    const normalizedDepartures = adaptSigaDepartures(snapshot);
    const departures = selectFlights(normalizedDepartures, selectedDate, now);
    // Fonia e Pushback casam por data + voo: consulta as datas operacionais dos
    // voos exibidos (na virada do dia podem ser duas).
    const flightDates = [...new Set(departures.map((flight) => flight.date))].sort();
    const [foniaLoad, pushbackLoad, restResult] = await Promise.all([
      loadFonia(flightDates, now),
      loadPushback(flightDates, now),
      providers.rest.isConfigured()
        ? providers.rest.getDepartureServices(selectedDate).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        )
        : Promise.resolve({ status: 'fulfilled', value: null }),
    ]);

    if (restResult.status === 'rejected') logger.error('[saidas] Falha no provider REST.', restResult.reason?.code || restResult.reason?.name);

    const restRecords = restResult.status === 'fulfilled' && Array.isArray(restResult.value) ? restResult.value : [];
    const foniaIndex = indexRecords(foniaLoad.records);
    const restIndex = indexRecords(restRecords);
    const pushbackIndex = indexRecords(pushbackLoad.records);
    const availability = {
      fonia: foniaLoad.state === 'disponivel',
      pushback: pushbackLoad.state === 'disponivel',
      rest: providers.rest.isConfigured() && restResult.status === 'fulfilled',
    };

    const value = {
      voos: departures.map((flight) => publicFlight(
        flight,
        findRecord(foniaIndex, flight),
        findRecord(pushbackIndex, flight),
        findRecord(restIndex, flight),
        availability,
      )),
      meta: {
        data: selectedDate,
        timezone: 'America/Sao_Paulo',
        atualizadoEm: now.toISOString(),
        disponibilidade: {
          malha: malhaCache.stale ? 'indisponivel' : 'disponivel',
          fonia: foniaLoad.state,
          pushback: pushbackLoad.state,
          rest: !providers.rest.isConfigured()
            ? 'nao_configurada'
            : restResult.status === 'fulfilled' ? 'disponivel' : 'indisponivel',
        },
        malhaAtualizadaEm: malhaCache.updatedAt,
        contagens: {
          snapshot: snapshot.length,
          saidasNormalizadas: normalizedDepartures.length,
          saidasExibiveis: departures.length,
        },
      },
    };

    return value;
  }

  return { getVoos };
}

module.exports = {
  InputError,
  WINDOW_MINUTES,
  normalizeSelectedDate,
  selectFlights,
  createSaidasService,
};
