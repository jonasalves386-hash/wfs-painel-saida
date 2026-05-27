const API_URL = `${API_BASE_URL}/voos`;

// Ordem dos serviços conforme spec Saídas
const SERVICES = ['fonia', 'pushback', 'qtu', 'qta'];
const LOTE_SIZE = 12;
const ROTATION_MS = 60 * 60 * 1000;
const JANELA_MINUTOS = 60;

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
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtTempo(mins) {
  if (mins <= 0) return `-${Math.abs(mins)}min`;
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function tempoClass(mins) {
  if (mins <= 0) return 't-atrasado';
  if (mins <= 15) return 't-urgente';
  if (mins <= 30) return 't-alerta';
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

// FONIA: se push real foi detectado, tudo verde.
// Caso contrário: AZUL=escalado | AMARELO<=50 | VERMELHO<=40 | CINZA
function foniaStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.fonia?.escalado) return STATUS.AZUL;

  const mins = minutesTo(f.t);
  if (mins <= 40) return STATUS.VERMELHO;
  if (mins <= 50) return STATUS.AMARELO;
  return STATUS.CINZA;
}

// PUSHBACK:
// VERDE = push real detectado OU escalado + AJ válido.
// AZUL = AI válido + AK preenchido.
// AMARELO<=20 | VERMELHO<=15 | CINZA.
function pushbackStatus(f) {
  if (vooEmPushReal(f)) return STATUS.VERDE;
  if (f.pushback?.finalizado) return STATUS.VERDE;

  const mins = minutesTo(f.t);

  // Se está escalado mas ainda não finalizou, cobra novamente no -15
  if (f.pushback?.escalado) {
    if (mins <= 15) return STATUS.VERMELHO;
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

// Remoção é feita pelo backend (push+2min); aqui apenas retorna false
function deveRemoverVoo() {
  return false;
}

// ─── ADAPTAR VOOS ─────────────────────────────────────────────────────────────

function adaptarVoos(apiVoos) {
  return apiVoos
    .map(v => {
      const horario = String(v.horario || '').trim().slice(0, 5);
      const data = montarDataHojePorHorario(horario);
      if (!data) return null;

      const fonia    = v.servicos?.fonia    ?? { escalado: false, pushReal: false, valor: '' };
      const pushback = v.servicos?.pushback ?? { escalado: false, finalizado: false, pushReal: false, valor: '' };
      const qtu      = v.servicos?.qtu      ?? { escalado: false, finalizado: false, pushReal: false, valor: '' };
      const qta      = v.servicos?.qta      ?? { escalado: false, finalizado: false, emAndamento: false, pushReal: false, valor: '' };

      return {
        id:       String(v.voo || '').trim(),
        voo:      String(v.voo || '').trim(),
        route:    String(v.destino || v.origem || '').trim() || '-',
        t:        data,
        fonia,
        pushback,
        qtu,
        qta,
        s: {
          fonia:    fonia.escalado    ? 'ESC' : 'NAO',
          pushback: pushback.escalado || pushback.finalizado ? 'ESC' : 'NAO',
          qtu:      qtu.escalado      || qtu.finalizado      ? 'ESC' : 'NAO',
          qta:      qta.escalado      || qta.finalizado       ? 'ESC' : 'NAO',
        },
      };
    })
    .filter(Boolean)
    .filter(f => !deveRemoverVoo(f))
    .sort((a, b) => a.t - b.t)
    .slice(0, LOTE_SIZE);
}

// ─── ESTADO ───────────────────────────────────────────────────────────────────

let allFlights  = [];
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
    return `<th class="${cls}">${f.id}</th>`;
  }).join('');
  rows.push(`<tr><th class="row-label">VOO</th>${thVoos}</tr>`);

  // DESTINO
  const tdDestino = flights.map(f => `<td class="cell-info">${f.route}</td>`).join('');
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
      return `<td class="${col}"><div class="chip ${st.cls}">${st.label}</div></td>`;
    }).join('');

    rows.push(`<tr><td class="row-label">${SVC_LABEL[svc]}</td>${tds}</tr>`);
  });

  table.innerHTML = rows.join('');
}

// ─── TICKER ───────────────────────────────────────────────────────────────────

const msgs = [
  'WFS · PAINEL DE CONTROLE OPERACIONAL · GRU',
  'LATAM SAÍDAS',
  'ROTAÇÃO AUTOMÁTICA A CADA 1 HORA',
  'AMARELO = ATENÇÃO · VERMELHO = CRÍTICO · AZUL = ESCALADO · VERDE = FINALIZADO · CINZA = FORA DA JANELA',
];

document.getElementById('ticker').innerHTML =
  [...msgs, ...msgs].map(m => `<span>${m}</span>`).join('');

// ─── RELÓGIO ─────────────────────────────────────────────────────────────────

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('pt-BR');
}

// ─── FETCH ───────────────────────────────────────────────────────────────────

async function fetchFlights() {
  try {
    const res = await fetch(`${API_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('Formato inesperado da API:', data);
      allFlights  = [];
      currentLote = [];
      render();
      return;
    }

    console.log('TOTAL API:', data.length);
    allFlights  = adaptarVoos(data);
    currentLote = buildLote();
    console.log('VOOS NA TELA:', currentLote.length);

    render();
  } catch (err) {
    console.error('Erro ao buscar voos:', err);
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

currentLote  = [];
nextRotation = Date.now() + ROTATION_MS;

fetchFlights();
updateClock();

setInterval(updateClock,  1000);
setInterval(fetchFlights, 30000);

setInterval(() => {
  if (Date.now() >= nextRotation) rotateLote();
  render();
}, 30000);
