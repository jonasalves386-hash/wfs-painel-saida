'use strict';

// Prefixos WB oficiais usados pelos painéis operacionais WFS.
const WIDE_BODY_PREFIXES = new Set([
  'CC-BBA', 'CC-BBB', 'CC-BBC', 'CC-BBD', 'CC-BBE', 'CC-BBF', 'CC-BBG', 'CC-BBH',
  'CC-BBI', 'CC-BBJ', 'CC-BDA', 'CC-BDB', 'CC-BDC', 'CC-BDD', 'CC-BGA', 'CC-BGB',
  'CC-BGC', 'CC-BGD', 'CC-BGE', 'CC-BGF', 'CC-BGG', 'CC-BGH', 'CC-BGI', 'CC-BGJ',
  'CC-BGK', 'CC-BGL', 'CC-BGM', 'CC-BGN', 'CC-BGO', 'CC-BGP', 'CC-BGQ', 'CC-BGR',
  'CC-BGS', 'CC-BGT', 'CC-BGU', 'CC-BGV', 'CC-BGW', 'CC-BGX', 'CC-BGY', 'CC-BGZ',
  'CC-BHM', 'CC-BJA', 'CC-BKA', 'CC-BKB', 'CC-BMA', 'CC-BMB', 'CC-BMC', 'CC-BMD',
  'CC-CWF', 'CC-CWG', 'CC-CWV', 'CC-CWY', 'CC-CXC', 'CC-CXD', 'CC-CXE', 'CC-CXF',
  'CC-CXG', 'CC-CXH', 'CC-CXI', 'CC-CXJ', 'CC-CXK', 'CC-CZT', 'CC-CZU', 'CC-CZZ',
  'LV-CDQ', 'LV-CFV', 'LV-IQW', 'LV-ZYV', 'N418LA', 'N420LA', 'N532LA', 'N534LA',
  'N536LA', 'N538LA', 'PR-ABB', 'PR-ABD', 'PR-ACO', 'PR-XTA', 'PR-XTB', 'PR-XTC',
  'PR-XTD', 'PR-XTE', 'PR-XTF', 'PR-XTG', 'PR-XTH', 'PR-XTI', 'PR-XTM', 'PS-LAA',
  'PT-MOA', 'PT-MOB', 'PT-MOC', 'PT-MOD', 'PT-MOE', 'PT-MOF', 'PT-MOG', 'PT-MSO',
  'PT-MSS', 'PT-MSV', 'PT-MSW', 'PT-MSX', 'PT-MSY', 'PT-MSZ', 'PT-MUA', 'PT-MUB',
  'PT-MUC', 'PT-MUD', 'PT-MUE', 'PT-MUF', 'PT-MUG', 'PT-MUH', 'PT-MUI', 'PT-MUJ',
]);

const WIDE_BODY_MODELS = /(?:^|\b)(?:A330|A33[2389]|A340|A34[236]|A350|A35[9K]|B?747|B?76[3467]|B?77[2-9]|B?78[789X]|DC-?10|MD-?11)(?:\b|$)/i;

function normalizeAircraftPrefix(value) {
  const compact = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!compact) return '';
  const withoutHyphen = compact.match(/^([A-Z]{2})([A-Z0-9]{3})$/);
  return withoutHyphen ? `${withoutHyphen[1]}-${withoutHyphen[2]}` : compact;
}

function isWideBody(record = {}) {
  const prefix = normalizeAircraftPrefix(record.aircraftPrefix || record.prefix || record.registration);
  if (WIDE_BODY_PREFIXES.has(prefix)) return true;

  const classification = [
    record.bodyType,
    record.aircraftBody,
    record.fleetType,
    record.category,
  ].filter(Boolean).join(' ').toUpperCase();
  if (/\b(?:WIDE\s*BODY|WIDEBODY|WB)\b/.test(classification)) return true;

  const model = [record.aircraftType, record.aircraftModel, record.equipment]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  return WIDE_BODY_MODELS.test(model);
}

module.exports = { WIDE_BODY_PREFIXES, normalizeAircraftPrefix, isWideBody };
