'use strict';

const { isWideBody, normalizeAircraftPrefix } = require('../domain/wideBody');

const TIMEZONE = 'America/Sao_Paulo';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = text(record?.[key]);
    if (value) return value;
  }
  return '';
}

function dateParts(value) {
  const source = text(value);
  let match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return validateDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return validateDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function validateDate(year, month, day) {
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function timeParts(value) {
  const match = text(value).match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) } : null;
}

function partsInTimezone(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

function zonedDateTime(dateValue, timeValue) {
  const date = dateParts(dateValue);
  const time = timeParts(timeValue);
  if (!date || !time) return null;

  const desired = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second);
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = partsInTimezone(instant);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    instant += desired - represented;
  }
  return new Date(instant).toISOString();
}

function saoPauloDateKey(value) {
  const instant = new Date(value || '');
  if (!Number.isFinite(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDateKey(value) {
  const parsed = dateParts(value);
  if (parsed) {
    return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
  }
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? saoPauloDateKey(timestamp) : '';
}

function parseDateTimeValue(value, fallbackDate = '') {
  const source = text(value);
  if (!source) return null;

  const br = source.match(/^(\d{2}\/\d{2}\/\d{4})[ T]([0-2]\d:[0-5]\d(?::[0-5]\d)?)$/);
  if (br) return zonedDateTime(br[1], br[2]);

  // O SIGA também pode serializar data/hora local sem offset. Nesses casos,
  // ela continua representando o relógio operacional de São Paulo.
  const isoLocal = source.match(/^(\d{4}-\d{2}-\d{2})[ T]([0-2]\d:[0-5]\d(?::[0-5]\d)?)(?:\.\d+)?$/);
  if (isoLocal) return zonedDateTime(isoLocal[1], isoLocal[2]);

  if (timeParts(source) && fallbackDate) return zonedDateTime(fallbackDate, source);

  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function extractDateTime(record, { pairs = [], values = [], fallbackDate = '' }) {
  for (const [dateKey, timeKey] of pairs) {
    const parsed = zonedDateTime(record?.[dateKey], record?.[timeKey]);
    if (parsed) return parsed;
  }
  for (const key of values) {
    const parsed = parseDateTimeValue(record?.[key], fallbackDate);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeFlightNumber(value) {
  return text(value).toUpperCase().replace(/\s+/g, '');
}

function serviceFlightNumber(value) {
  const normalized = normalizeFlightNumber(value);
  const numeric = normalized.match(/\d+[A-Z]?$/)?.[0] || normalized;
  return numeric.replace(/^0+(?=\d)/, '');
}

function operationType(record) {
  return firstText(record, ['operation_type', 'operationType', 'movement_type', 'movementType', 'tipo_operacao', 'tipoOperacao', 'direction']).toUpperCase();
}

function isDepartureRecord(record) {
  const hasDepartureLeg = Boolean(firstText(record, [
    'number_departure', 'departure_flight_number', 'flight_number_departure',
    'dep_flight_number', 'voo_saida',
  ]));
  if (hasDepartureLeg) return true;

  const type = operationType(record);
  if (/CHEGADA|ARRIVAL|\bARR\b/.test(type)) return false;
  if (/SAIDA|DEPARTURE|\bDEP\b/.test(type)) return true;
  return false;
}

function isCancelledStatus(value) {
  const normalized = text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  // No contrato atual do SIGA: O = operação ativa; C = cancelada.
  return normalized === 'C' || /CANCEL|CNLD?|\bCANC\b/.test(normalized);
}

function adaptSigaDeparture(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || !isDepartureRecord(record)) return null;

  const flightNumber = normalizeFlightNumber(firstText(record, [
    'number_departure', 'departure_flight_number', 'flight_number_departure',
    'dep_flight_number', 'voo_saida', 'flight_number', 'number', 'voo',
  ]));
  if (!flightNumber) return null;

  const fallbackDate = firstText(record, [
    'std_date', 'etd_date', 'departure_date', 'date_departure', 'data_saida', 'flight_date', 'date',
  ]);
  const std = extractDateTime(record, {
    pairs: [['std_date', 'std_time'], ['departure_date', 'std_time'], ['date_departure', 'std_time']],
    values: ['std', 'scheduled_departure', 'scheduledDeparture', 'departure_scheduled'],
    fallbackDate,
  });
  const etd = extractDateTime(record, {
    pairs: [['etd_date', 'etd_time'], ['departure_date', 'etd_time'], ['date_departure', 'etd_time']],
    values: ['etd', 'estimated_departure', 'estimatedDeparture', 'departure_estimated'],
    fallbackDate,
  });
  // Regra terminal do Painel de Saídas: somente o campo PUSH_OUT do snapshot
  // SIGA remove o voo. O sinal independe de o horário ser parseável.
  const rawPushOut = firstText(record, ['push_out', 'PUSH_OUT']);
  const hasPushOut = Boolean(rawPushOut);
  const pushOut = hasPushOut
    ? extractDateTime(record, {
      pairs: [['pushout_date', 'push_out'], ['push_out_date', 'push_out']],
      values: ['push_out', 'PUSH_OUT'],
      fallbackDate,
    })
    : null;
  const operationalAt = etd || std;
  if (!operationalAt) return null;

  const rawStatus = firstText(record, [
    'status_flight_departure', 'departure_status', 'statusDeparture', 'status_flight', 'status',
  ]);
  const aircraftPrefix = normalizeAircraftPrefix(firstText(record, [
    'prefix', 'aircraft_prefix', 'aircraftPrefix', 'registration', 'matricula',
  ]));
  const fleet = {
    aircraftPrefix,
    aircraftType: firstText(record, ['aircraft_type', 'aircraftType', 'equipment', 'equipamento']),
    aircraftModel: firstText(record, ['aircraft_model', 'aircraftModel', 'model', 'modelo']),
    equipment: firstText(record, ['equipment', 'equipamento']),
    bodyType: firstText(record, ['body_type', 'bodyType', 'aircraft_body']),
    fleetType: firstText(record, ['fleet_type', 'fleetType', 'frota']),
    category: firstText(record, ['category', 'categoria']),
  };

  // A data operacional pertence ao STD. O ETD pode atravessar a meia-noite e
  // não deve transformar a mesma perna em um voo de outro dia.
  const scheduledAt = std || operationalAt;
  const date = normalizeDateKey(firstText(record, [
    'std_date', 'departure_date', 'date_departure', 'data_saida', 'flight_date', 'date',
  ])) || saoPauloDateKey(scheduledAt);
  const sourceId = firstText(record, ['id', 'operation_id', 'operationId', 'flight_id', 'flightId']);
  const serviceKey = `${date}_${serviceFlightNumber(flightNumber)}`;
  const operationKey = `${date}|${flightNumber}|${scheduledAt}`;

  return {
    id: sourceId || operationKey,
    sourceId,
    serviceKey,
    operationKey,
    date,
    flightNumber,
    aircraftPrefix,
    destination: firstText(record, ['des', 'destination', 'destino', 'airport_destination', 'iata_destination']),
    std,
    etd,
    operationalAt,
    position: firstText(record, [
      'park_position_departure', 'position_departure', 'departure_position',
      'position', 'box', 'parking_position', 'parkingPosition', 'gate', 'stand',
    ]),
    rawStatus,
    status: hasPushOut ? 'REALIZADO' : rawStatus,
    pushOut,
    hasPushOut,
    cancelled: isCancelledStatus(rawStatus),
    wideBody: isWideBody(fleet),
    updatedAt: parseDateTimeValue(firstText(record, ['updated_at', 'updatedAt', 'last_update', 'lastUpdate'])),
    source: record,
  };
}

function adaptSigaDepartures(records) {
  return records.map(adaptSigaDeparture).filter(Boolean);
}

module.exports = {
  TIMEZONE,
  text,
  normalizeDateKey,
  zonedDateTime,
  saoPauloDateKey,
  normalizeFlightNumber,
  serviceFlightNumber,
  isDepartureRecord,
  isCancelledStatus,
  adaptSigaDeparture,
  adaptSigaDepartures,
};
