const API_URL = `${API_BASE_URL}/voos`;

// Ordem dos serviços conforme spec Saídas
const SERVICES = ['fonia', 'pushback', 'qtu', 'qta'];
const LOTE_SIZE = 12;
const ROTATION_MS = 60 * 60 * 1000;
const JANELA_MINUTOS = 60;
const SAO_PAULO_TZ = 'America/Sao_Paulo';
const REQUEST_TIMEOUT_MS = 125000;
const STORAGE_KEY = 'wfs-saidas:last-valid-flights';
const STORAGE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const SVC_LABEL = {
  fonia:    'FONIA',
  pushback: 'PUSHBACK',
  qtu:      'QTU',
  qta:      'QTA',
};

const STATUS = {
  NAO:      { label: 'NÃO ESC.',  cls: 'chip-nao'      },
  ESC:      { label: 'ESCALADO',  cls: 'chip-esc'      },
  CINZA:    { label: 'PADRÃO',    cls: 'chip-cinza'    },
  AZUL:     { label: 'ESCALADO',  cls: 'chip-azul'     },
  AMARELO:  { label: 'ATENÇÃO',   cls: 'chip-amarelo'  },
  VERMELHO: { label: 'CRÍTICO',   cls: 'chip-vermelho' },
  VERDE:    { label: 'OK',        cls: 'chip-verde'    },
};

function minutesTo(date) {
  return Math.round((date - Date.now()) / 60000);
}

function fmtTime(d) {
  return d.toLocaleTimeString('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtTempo(mins) {
  if (mins <= 0) return `-${Math.abs(mins)}min`;
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function tempoClass(mins) {
  if (mins <= 5) return 't-atrasado';
  if (mins <= 15) return 't-alerta';
  return 't-normal';
}

// ─── STATUS POR SERVIÇO ───────────────────────────────────────────────────────

function vooEmPushReal(f) {
  return Boolean(
    f.fonia?.pushReal ||
    f.pushback?.pushReal ||
    f.qtu?.pushReal ||
    f.qta?.pushReal
  );
}

// FONIA (API de escalados da Fonia, casada por data + voo):
// VERDE = equipe na posição (botão pressionado no mobile).
// AZUL = escalado (mostra a equipe).
// Sem escala: AMARELO<=50 | VERMELHO<=40 | CINZA fora da janela.
function foniaStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.fonia?.indisponivel) return STATUS.CINZA;
  if (f.fonia?.escalado && f.fonia?.naPosicao) return STATUS.VERDE;
  if (f.fonia?.escalado) return STATUS.AZUL;

  const mins = minutesTo(f.t);
  if (mins <= 40) return STATUS.VERMELHO;
  if (mins <= 50) return STATUS.AMARELO;
  return STATUS.CINZA;
}

// PUSHBACK (API de escalados do Pushback, casada por data + voo):
// VERDE = na posição e acoplado.
// AZUL = escalado (mostra o operador); VERMELHO se faltar <=10 min e ainda
// não estiver na posição.
// Sem escala: AMARELO<=20 | VERMELHO<=15 | CINZA fora da janela.
function pushbackStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.pushback?.indisponivel) return STATUS.CINZA;
  if (f.pushback?.finalizado) return STATUS.VERDE;

  const mins = minutesTo(f.t);

  // Escalado: na posição fica azul até acoplar; sem chegar na posição,
  // cobra novamente a partir de -10 min.
  if (f.pushback?.escalado) {
    if (!f.pushback?.naPosicao && mins <= 10) return STATUS.VERMELHO;
    return STATUS.AZUL;
  }

  if (mins <= 15) return STATUS.VERMELHO;
  if (mins <= 20) return STATUS.AMARELO;
  return STATUS.CINZA;
}

// QTU:
// VERDE = finalizado.
// Se escalado mas não finalizado: AZUL até >35, AMARELO<=35, VERMELHO<=30.
// Se não escalado: AMARELO<=45, VERMELHO<=30.
function qtuStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.qtu?.indisponivel) return STATUS.CINZA;
  if (f.qtu?.finalizado) return STATUS.VERDE;

  const mins = minutesTo(f.t);

  if (f.qtu?.escalado) {
    if (mins <= 30) return STATUS.VERMELHO;
    if (mins <= 35) return STATUS.AMARELO;
    return STATUS.AZUL;
  }

  if (mins <= 30) return STATUS.VERMELHO;
  if (mins <= 45) return STATUS.AMARELO;
  return STATUS.CINZA;
}

// QTA:
// VERDE = finalizado pela regra de porcentagem.
// Se escalado mas não finalizado: AZUL até >35, AMARELO<=35, VERMELHO<=30.
// Se não escalado: AMARELO<=45, VERMELHO<=30.
function qtaStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.qta?.indisponivel) return STATUS.CINZA;
  if (f.qta?.finalizado) return STATUS.VERDE;

  const mins = minutesTo(f.t);

  if (f.qta?.escalado) {
    if (mins <= 30) return STATUS.VERMELHO;
    if (mins <= 35) return STATUS.AMARELO;
    return STATUS.AZUL;
  }

  if (mins <= 30) return STATUS.VERMELHO;
  if (mins <= 45) return STATUS.AMARELO;
  return STATUS.CINZA;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isHorarioValido(h) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(h || '').trim());
}

function montarDataHojePorHorario(horario) {
  const h = String(horario || '').trim();
  if (!isHorarioValido(h)) return null;
  const [hh, mm] = h.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}

function parseHorarioOperacional(voo) {
  const timestamp = voo.horario || voo.etd || voo.std;
  const parsed = new Date(timestamp || '');
  if (Number.isFinite(parsed.getTime())) return parsed;

  const horario = String(timestamp || '').trim().slice(0, 5);
  return montarDataHojePorHorario(horario);
}

// "WENDEL GONÇALVES DA SILVA" -> "WENDEL GONÇALVES" (primeiro nome + primeiro sobrenome).
function nomeCurto(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  const sobrenome = partes.slice(1).find(p => !/^(D[AEO]S?|E)$/i.test(p));
  return [partes[0], sobrenome].filter(Boolean).join(' ');
}

// Nome exibido dentro do quadrado quando o serviço está escalado.
function nomeEscalado(svc, f, st) {
  if (st === STATUS.CINZA) return '';
  if (svc === 'pushback' && f.pushback?.escalado) return nomeCurto(f.pushback.operador);
  if (svc === 'fonia' && f.fonia?.escalado) return String(f.fonia.equipe || '').trim();
  return '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizarTempo(tempo) {
  if (typeof tempo === 'number') return tempo;
  if (typeof tempo !== 'string') return null;
  const s = tempo.trim();
  if (s.endsWith('h')) {
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * 60);
  }
  if (s.endsWith('min')) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  return null;
}

function isPending(f) {
  if (vooEmPushReal(f)) return false;
  const mins = normalizarTempo(minutesTo(f.t));
  if (typeof mins === 'number' && !isNaN(mins) && mins <= 0) return true;

  return SERVICES.some(svc => {
    let st;
    if      (svc === 'fonia')    st = foniaStatus(f);
    else if (svc === 'pushback') st = pushbackStatus(f);
    else if (svc === 'qtu')      st = qtuStatus(f);
    else if (svc === 'qta')      st = qtaStatus(f);
    else return false;
    return st === STATUS.AMARELO || st === STATUS.VERMELHO;
  });
}

function allEscalado(f) {
  return Object.values(f.s).every(v => v === 'ESC');
}

// A remoção oficial é do backend (PUSH_OUT da Malha). Aqui só protege contra
// dados antigos (cache local / API fora) que já saíram da janela de -60 min.
function deveRemoverVoo(f) {
  return minutesTo(f.t) < -JANELA_MINUTOS;
}

// ─── ADAPTAR VOOS ─────────────────────────────────────────────────────────────

function adaptarVoos(apiVoos) {
  const voos = apiVoos
    .map(v => {
      const data = parseHorarioOperacional(v);
      if (!data) return null;

      const fonia    = v.servicos?.fonia    ?? { escalado: false, pushReal: false, valor: '' };
      const pushback = v.servicos?.pushback ?? { escalado: false, finalizado: false, pushReal: false, valor: '' };
      const qtu      = v.servicos?.qtu      ?? { escalado: false, finalizado: false, pushReal: false, valor: '' };
      const qta      = v.servicos?.qta      ?? { escalado: false, finalizado: false, emAndamento: false, pushReal: false, valor: '' };

      return {
        id:       String(v.id || `${v.data || ''}|${v.voo || ''}|${v.prefixo || ''}`).trim(),
        voo:      String(v.voo || '').trim(),
        route:    String(v.destino || v.origem || '').trim() || '-',
        t:        data,
        prefixo:  String(v.prefixo || '').trim(),
        std:       v.std || null,
        etd:       v.etd || null,
        box:       String(v.box || v.posicao || '').trim(),
        status:    String(v.status || '').trim(),
        pushOut:   v.pushOutReal || null,
        fonia,
        pushback,
        qtu,
        qta,
        s: {
          fonia:    fonia.escalado || fonia.pushReal ? 'ESC' : 'NAO',
          pushback: pushback.escalado || pushback.finalizado || pushback.pushReal ? 'ESC' : 'NAO',
          qtu:      qtu.escalado || qtu.finalizado || qtu.pushReal ? 'ESC' : 'NAO',
          qta:      qta.escalado || qta.finalizado || qta.pushReal ? 'ESC' : 'NAO',
        },
      };
    })
    .filter(Boolean)
    .filter(f => !deveRemoverVoo(f))
    .sort((a, b) => a.t - b.t);

  return [...new Map(voos.map(voo => [voo.id, voo])).values()];
}

// ─── ESTADO ───────────────────────────────────────────────────────────────────

function loadStoredFlights() {
  try {
    const payload = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Formato antigo (array sem data) ou cache velho não é reaproveitado.
    if (!Array.isArray(payload?.voos) || !(Date.now() - payload.savedAt <= STORAGE_MAX_AGE_MS)) return [];
    return adaptarVoos(payload.voos);
  } catch {
    return [];
  }
}

function storeFlights(voos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), voos }));
  } catch {
    // Proteção de recarga; a Malha consultada pelo backend continua sendo a fonte oficial.
  }
}

let allFlights  = loadStoredFlights();
let currentLote = [];
let nextRotation = Date.now() + ROTATION_MS;

function buildLote() {
  return [...allFlights]
    .sort((a, b) => a.t - b.t)
    .slice(0, LOTE_SIZE)
    .map(f => f.id);
}

function rotateLote() {
  const exibidos = new Set(currentLote);

  const pendentes = currentLote.filter(id => {
    const f = allFlights.find(x => x.id === id);
    return f && !allEscalado(f);
  });

  const proximos = allFlights
    .filter(f => !exibidos.has(f.id))
    .sort((a, b) => a.t - b.t)
    .map(f => f.id);

  currentLote  = [...pendentes, ...proximos].slice(0, LOTE_SIZE);
  nextRotation = Date.now() + ROTATION_MS;
}

function getSortedLote() {
  return currentLote
    .map(id => allFlights.find(f => f.id === id))
    .filter(Boolean)
    .filter(f => !deveRemoverVoo(f))
    .sort((a, b) => a.t - b.t)
    .slice(0, LOTE_SIZE);
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render() {
  const flights = getSortedLote();
  const pending = flights.filter(isPending).length;

  document.getElementById('cnt-total').textContent = flights.length;

  const colPending = {};
  flights.forEach(f => { colPending[f.id] = isPending(f); });

  const table = document.getElementById('painel');
  const rows  = [];

  // VOO
  const thVoos = flights.map(f => {
    const cls = colPending[f.id] ? 'col-voo has-pending' : 'col-voo';
    return `<th class="${cls}">${escapeHtml(f.voo)}</th>`;
  }).join('');
  rows.push(`<tr><th class="row-label">VOO</th>${thVoos}</tr>`);

  // DESTINO
  const tdDestino = flights.map(f => `<td class="cell-info">${escapeHtml(f.route)}</td>`).join('');
  rows.push(`<tr><td class="row-label">DESTINO</td>${tdDestino}</tr>`);

  // ETD
  const tdEtd = flights.map(f => `<td class="cell-info">${fmtTime(f.t)}</td>`).join('');
  rows.push(`<tr><td class="row-label">ETD</td>${tdEtd}</tr>`);

  // TEMPO
  const tdTempo = flights.map(f => {
    const mins = minutesTo(f.t);
    const cls  = tempoClass(mins);
    return `<td class="cell-info cell-tempo ${cls}">${fmtTempo(mins)}</td>`;
  }).join('');
  rows.push(`<tr><td class="row-label">TEMPO</td>${tdTempo}</tr>`);

  // BOX
  const tdBox = flights.map(f => `<td class="cell-info cell-gate">${escapeHtml(f.box || '-')}</td>`).join('');
  rows.push(`<tr><td class="row-label">BOX</td>${tdBox}</tr>`);

  // separador
  const sepCols = flights.map(() => '<td></td>').join('');
  rows.push(`<tr class="sep-row"><td></td>${sepCols}</tr>`);

  // SERVIÇOS
  SERVICES.forEach(svc => {
    const tds = flights.map(f => {
      let st;
      if      (svc === 'fonia')    st = foniaStatus(f);
      else if (svc === 'pushback') st = pushbackStatus(f);
      else if (svc === 'qtu')      st = qtuStatus(f);
      else if (svc === 'qta')      st = qtaStatus(f);
      else                         st = STATUS.CINZA;

      const col = colPending[f.id] ? 'cell-svc col-pending' : 'cell-svc';
      const nome = nomeEscalado(svc, f, st);
      if (nome) {
        return `<td class="${col}"><div class="chip ${st.cls}"><span class="chip-nome">${escapeHtml(nome)}</span></div></td>`;
      }
      return `<td class="${col}"><div class="chip ${st.cls}">${st.label}</div></td>`;
    }).join('');

    rows.push(`<tr><td class="row-label">${SVC_LABEL[svc]}</td>${tds}</tr>`);
  });

  const nextHtml = rows.join('');
  if (table.innerHTML !== nextHtml) table.innerHTML = nextHtml;
}

// ─── TICKER ───────────────────────────────────────────────────────────────────

const msgs = [
  'WFS · PAINEL DE CONTROLE OPERACIONAL · GRU',
  'LATAM SAÍDAS',
  'ROTAÇÃO AUTOMÁTICA A CADA 1 HORA',
  'AMARELO = ATENÇÃO · VERMELHO = CRÍTICO · AZUL = ESCALADO · VERDE = FINALIZADO · CINZA = SEM SINAL OU FORA DA JANELA',
];

document.getElementById('ticker').innerHTML =
  [...msgs, ...msgs].map(m => `<span>${m}</span>`).join('');

// ─── RELÓGIO ─────────────────────────────────────────────────────────────────

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('pt-BR', { timeZone: SAO_PAULO_TZ });
}

// ─── FETCH ───────────────────────────────────────────────────────────────────

function selectedDate() {
  const selected = document.querySelector('[data-selected-date]')?.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(selected || '')) return selected;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setAvailability(state, details = '') {
  const live = document.querySelector('.live');
  const label = document.querySelector('.live-text');
  const dot = document.querySelector('.live-dot');
  if (!live || !label || !dot) return;

  const settings = {
    ok:      { label: 'AO VIVO', textColor: '#4bd67e', dotColor: '#27bd64' },
    partial: { label: 'DADOS PARCIAIS', textColor: '#f4dd29', dotColor: '#d2bf08' },
    down:    { label: 'ATUALIZAÇÃO INDISPONÍVEL', textColor: '#f4dd29', dotColor: '#d2bf08' },
  }[state];
  label.textContent = settings.label;
  label.style.color = settings.textColor;
  dot.style.background = settings.dotColor;
  dot.style.boxShadow = 'none';
  live.title = details;
}

function reconcileFlights(nextFlights) {
  allFlights = nextFlights;
  const available = new Set(allFlights.map(flight => flight.id));
  const kept = currentLote.filter(id => available.has(id));
  const keptSet = new Set(kept);
  const additions = allFlights
    .filter(flight => !keptSet.has(flight.id))
    .sort((a, b) => a.t - b.t)
    .map(flight => flight.id);
  currentLote = [...kept, ...additions].slice(0, LOTE_SIZE);
}

let fetchSequence = 0;
let requestInProgress = false;

async function fetchFlights() {
  if (requestInProgress) return;
  requestInProgress = true;
  const sequence = ++fetchSequence;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({ data: selectedDate(), t: String(Date.now()) });
    const res = await fetch(`${API_URL}?${query}`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();
    const data = Array.isArray(payload) ? payload : payload?.voos;
    if (!Array.isArray(data)) throw new Error('Formato inesperado da API');
    if (sequence !== fetchSequence) return;

    reconcileFlights(adaptarVoos(data));
    storeFlights(data);
    const availability = payload?.meta?.disponibilidade;
    const unavailable = availability
      ? Object.entries(availability).filter(([, value]) => value === 'indisponivel')
      : [];
    setAvailability(
      unavailable.length ? 'partial' : 'ok',
      unavailable.length ? `Fontes: ${unavailable.map(([name, state]) => `${name} ${state}`).join(', ')}` : '',
    );

    render();
  } catch (err) {
    console.error('Erro ao buscar voos:', err);
    if (sequence !== fetchSequence) return;
    setAvailability('down', 'Não foi possível atualizar os dados.');
    if (!allFlights.length) render();
  } finally {
    clearTimeout(timeout);
    requestInProgress = false;
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

currentLote  = buildLote();
nextRotation = Date.now() + ROTATION_MS;

render();
setAvailability(
  allFlights.length ? 'partial' : 'down',
  allFlights.length ? 'Exibindo o último estado salvo enquanto a Malha é atualizada.' : 'Aguardando a Malha.',
);
fetchFlights();
updateClock();

setInterval(updateClock,  1000);
setInterval(fetchFlights, 30000);

setInterval(() => {
  if (Date.now() >= nextRotation) rotateLote();
  render();
}, 30000);
