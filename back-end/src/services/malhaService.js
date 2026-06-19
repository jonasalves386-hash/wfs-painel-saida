const axios = require('axios');
const { google } = require('googleapis');
const {
  isHorarioValido,
  extrairHorario,
  extrairData,
  isHoje,
  minutosAteHorario,
} = require('../utils/parseHorario');

// ─── AUTH ────────────────────────────────────────────────────────────────────

function getGoogleSheetsServiceClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── NORMALIZAÇÃO ────────────────────────────────────────────────────────────

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizarDataChave(valor) {
  const data = extrairData(valor);
  if (data) {
    const [dia, mes, ano] = data.split('/');
    return `${ano}${mes}${dia}`;
  }
  return normalizarTexto(String(valor || ''));
}

function chaveVoo(dataValor, vooValor) {
  return `${normalizarDataChave(dataValor)}|${normalizarTexto(vooValor)}`;
}

// Radicais/abrevia\u00e7\u00f5es aceitos como indica\u00e7\u00e3o de cancelamento.
// CANCEL cobre CANCELADO/CANCELADA/CANCELADOS/CANCELAMENTO/CANCEL (com ou sem espa\u00e7os extras).
// CNL/CNLD/CANC cobrem abrevia\u00e7\u00f5es comuns de opera\u00e7\u00e3o.
const CANCELADO_PADROES = [/CANCEL/, /\bCNLD?\b/, /\bCANC\b/];

function isCancelado(...valores) {
  return valores.some(v => {
    const texto = String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    if (!texto) return false;
    // Remove espa\u00e7os internos para pegar casos como "CANCE LADO" / "C A N C"
    const semEspacos = texto.replace(/\s+/g, '');
    return CANCELADO_PADROES.some(re => re.test(texto) || re.test(semEspacos));
  });
}
// ─── VALIDAÇÃO FONIA ──────────────────────────────────────────────────────────

const FONIA_EQUIPES_VALIDAS_RAW = [
  'ALFA - T1', 'ALFA-T2', 'ALFA-T3', 'ALFA -T4', 'BETA - T1', 'BETA-T2', 'BETA- T3', 'BETA- T4',
  'BLUE-T1', 'BLUE-T2', 'BLUE-T3', 'BLUE-T4', 'BRAVO - T1', 'BRAVO - T2', 'BRAVO - T3', 'BRAVO - T4',
  'BRONZE- T2', 'BRONZE- T3', 'CHARLIE - T1', 'CHARLIE- T2', 'CHARLIE - T3', 'CHARLIE - T4',
  'DELTA - T1', 'DELTA - T2', 'DELTA - T3', 'DELTA - T4', 'DIAMANTE- T1', 'DIAMANTE - T2',
  'DIAMANTE - T3', 'DIAMANTE - T4', 'ECHO-T1', 'ECHO-T2', 'ECHO-T3', 'ECHO-T4',
  'ELITE - T2', 'FENIX - T2', 'FERRARI - T2', 'FOXTROT -T1', 'FOXTROT-T2', 'FOXTROT -T3', 'FOXTROT- T4',
  'GOLDEN-T1', 'GOLDEN-T2', 'GOLDEN-T3', 'GOLDEN-T4', 'GOLF-T1', 'GOLF-T2', 'GOLF-T3', 'GOLF- T4',
  'HOTEL-T1', 'HOTEL-T2', 'HOTEL-T3', 'HOTEL-T4', 'INDIA - T1', 'INDIA - T2', 'INDIA - T3', 'INDIA - T4',
  'JULIET - T1', 'JULIET - T2', 'JULIET-T3', 'JULIET- T4', 'KILO- T1', 'KILO- T2', 'KILO- T3', 'KILO- T4',
  'LIMA -T1', 'LIMA - T2', 'LIMA - T3', 'LIMA - T4', 'MIKE - T1', 'MIKE - T2', 'MIKE - T3', 'MIKE - T4',
  'NOVEMBER-T2', 'NOVEMBER-T3', 'NOVEMBER-T4', 'OSCAR-T1', 'OSCAR-T2', 'OSCAR-T3', 'OSCAR- T4',
  'PAPA - T1', 'PAPA - T2', 'PAPA - T3', 'PAPA - T4', 'PRATA- T3', 'QUEBEC-T1', 'QUEBEC-T2', 'QUEBEC-T3',
  'QUEBEC-T4', 'RED-T1', 'RED-T2', 'RED-T3', 'RED-T4', 'ROMA-T1', 'ROMA-T2', 'ROMA-T3', 'ROMA-T4',
  'ROMEO- T1', 'ROMEO - T2', 'ROMEO-T3', 'ROMEO - T4', 'SIERRA - T1', 'SIERRA - T2', 'SIERRA - T3',
  'SIERRA - T4', 'SILVER-T1', 'SILVER-T2', 'SILVER-T3', 'SILVER-T4', 'TANGO - T1', 'TANGO - T2',
  'TANGO - T3', 'TANGO- T4', 'TITANIUM- T2', 'TITANIUM- T3', 'UNIFORM- T1', 'UNIFORM - T2',
  'UNIFORM - T3', 'UNIFORM - T4', 'VICTOR- T1', 'VICTOR - T2', 'VICTOR- T3', 'VICTOR - T4',
  'WHISKEY - T1', 'WHISKEY -T2', 'WHISKEY - T3', 'WHISKEY - T4', 'X RAY - T1', 'X RAY -T2',
  'X RAY-T3', 'X RAY- T4', 'XADREZ-T1', 'XADREZ-T2', 'XADREZ-T3', 'XADREZ - T4', 'YANKEE-T1', 'YANKEE - T2', 'YANKEE-T3',
  'YANKEE - T4', 'YELLOW-T1', 'YELLOW- T2', 'YELLOW- T3', 'YELLOW- T4', 'ZULU - T1', 'ZULU- T2',
  'ZULU- T3', 'ZULU - T4', 'ELITE - T3', 'TRASLADO', 'ELITE -T4', 'FENIX - T3', 'FENIX - T4',
  'TITANIUM- T4', 'BRONZE - T4', 'PRATA- T4', 'APOIO - T1', 'APOIO - T2', 'APOIO - T3', 'APOIO - T4',
  'DOURADOS - T1', 'DOURADOS - T2', 'DOURADOS - T3', 'DOURADOS - T4',
];

function normalizarEquipeFonia(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\bAPOIO\s+T([1-4])\b/g, 'APOIO-T$1')
    .replace(/\s+/g, ' ');
}

const FONIA_EQUIPES_VALIDAS = new Set(FONIA_EQUIPES_VALIDAS_RAW.map(normalizarEquipeFonia));

function contemEquipeValidaFonia(valor) {
  const texto = normalizarEquipeFonia(valor);
  if (!texto) return false;
  for (const equipe of FONIA_EQUIPES_VALIDAS) {
    if (texto.includes(equipe)) return true;
  }
  return /(^|\s)APOIO-T[1-4](\s|$)/.test(texto);
}

function foniaEscalada(a, b) {
  return contemEquipeValidaFonia(a) || contemEquipeValidaFonia(b);
}

// Validação de nome individual (QTU/QTA usam nomes próprios, não códigos de equipe)
function nomeValido(valor) {
  const texto = String(valor || '').trim();
  return texto.length >= 2 && /[A-Za-zÀ-ÿ]{2,}/.test(texto);
}

function duplaEscaladaLimpeza(a, b) {
  return nomeValido(a) && nomeValido(b);
}

// ─── MONITOR SAÍDAS ──────────────────────────────────────────────────────────
// Planilha: monitor chegadas (mesma) | Aba: monitor_saidas
// A(0)=DATA, D(3)=ETD_FINAL, G(6)=w_push, H(7)=c_push, K(10)=dep_flight_number(VOO)

async function getMonitorSaidas() {
  const sheetId = '1RusxsxP7g-PKVJX5b8qPrl_VojLhvflXqdLOQlk88EQ';
  const sheets  = getGoogleSheetsServiceClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'monitor_saidas!A:K',
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  return rows.slice(1).map(row => ({
    data: extrairData(String(row[0] ?? '')),   // A = DATA
    voo:  String(row[10] ?? '').trim(),         // K = dep_flight_number
    etd:  extrairHorario(row[3] ?? ''),         // D = ETD_FINAL
    push: extrairHorario(row[5] ?? ''), // F= DESCALÇO
  }));
}

// ─── LIMPEZA (NARROW) SAÍDAS ─────────────────────────────────────────────────
// Planilha: PROGRAMAÇÃO LIMPEZA QTA E QTU 1.0 | Aba: NARROW
// Match por saída: X(23)=DATA saída, Y(24)=VOO saída
// QTA: J(9), K(10) escalado | L(11) comparação | O(14) finalizado | AC(28) comparação2
// QTU: P(15), Q(16) escalado | T(19) finalizado

async function getLimpezaSaidas() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY não definida');

  const sheetId = '17ggPnOyf-xzDX8WWgGhKGyf0fkwiCvmWZhLbYEup8Eo';
  const range   = encodeURIComponent('NARROW') + '!A:AC';
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;

  const { data } = await axios.get(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });

  const rows = data.values;
  if (!rows || rows.length < 2) return [];

  return rows.slice(1).map(row => ({
    // Chave de match: dados da SAÍDA nas colunas X e Y
    data:     extrairData(String(row[23] ?? '')),  // X = DATA saída
    voo:      String(row[24] ?? '').trim(),         // Y = VOO saída
    // QTA
    qta1:     String(row[9]  ?? '').trim(),         // J = OP.QTA
    qta2:     String(row[10] ?? '').trim(),         // K = AUXILIAR
    qtaL:     String(row[11] ?? '').trim(),         // L = %
    qtaFinal: extrairHorario(row[14] ?? ''),        // O = HORA F.
    qtaAC:    String(row[28] ?? '').trim(),         // AC = comparação
    // QTU
    qtu1:     String(row[15] ?? '').trim(),         // P = OP.QTU
    qtu2:     String(row[16] ?? '').trim(),         // Q = AUXILIAR
    qtuFinal: extrairHorario(row[19] ?? ''),        // T = HORA F.
  }));
}

// ─── HELPER: L >= AC ─────────────────────────────────────────────────────────

function lMaiorOuIgualAC(lVal, acVal) {
  if (!lVal && !acVal) return false;
  // Remove % e espaços para comparação numérica
  const lNum  = parseFloat(String(lVal).replace(/[^0-9,.]/g, '').replace(',', '.'));
  const acNum = parseFloat(String(acVal).replace(/[^0-9,.]/g, '').replace(',', '.'));
  if (!isNaN(lNum) && !isNaN(acNum)) return lNum >= acNum;
  return String(lVal) >= String(acVal);
}

// ─── GETVOOOS ─────────────────────────────────────────────────────────────────

async function getVoos() {
  const apiKey  = process.env.GOOGLE_API_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!apiKey || !sheetId) {
    throw new Error('GOOGLE_API_KEY e GOOGLE_SHEET_ID são obrigatórias no .env');
  }

  // PROG!T:AK — índices a partir de T (col 0):
  // 0=T(PREFIXO), 1=U(DATA), 2=V(VOO), 3=W(DESTINO), 4=X(STD/ETD)
  // 9=AC(FONIA1), 10=AD(FONIA2)
  // 15=AI(PUSHBACK HORÁRIO ESCALADO)
  // 16=AJ(PUSHBACK FINALIZADO/OK)
  // 17=AK(PUSHBACK COMPLEMENTO/CONFIRMAÇÃO)
  const range = encodeURIComponent('PROG') + '!N:AK';
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}&t=${Date.now()}`;

  const [progResult, monitorResult, limpezaResult] = await Promise.allSettled([
    axios.get(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }),
    getMonitorSaidas(),
    getLimpezaSaidas(),
  ]);

  if (progResult.status === 'rejected') throw progResult.reason;

  const monitorSaidas = monitorResult.status === 'fulfilled' ? monitorResult.value : [];
  if (monitorResult.status === 'rejected') {
    console.warn('[getVoos] Falha MONITOR SAIDAS:', monitorResult.reason?.message);
  }

  const limpeza = limpezaResult.status === 'fulfilled' ? limpezaResult.value : [];
  if (limpezaResult.status === 'rejected') {
    console.warn('[getVoos] Falha LIMPEZA:', limpezaResult.reason?.message);
  }

  // Maps indexados por data|voo
  const monitorMap = new Map();
  for (const linha of monitorSaidas) {
    if (!linha.data || !linha.voo) continue;
    monitorMap.set(chaveVoo(linha.data, linha.voo), linha);
  }

  const limpezaMap = new Map();
  for (const linha of limpeza) {
    if (!linha.data || !linha.voo) continue;
    limpezaMap.set(chaveVoo(linha.data, linha.voo), linha);
  }

  const rows = progResult.value.data.values;
  if (!rows || rows.length < 2) return [];

  const voos = rows
    .slice(1)
    .filter(row => row && row.some(c => String(c ?? '').trim() !== ''))
    .map(row => {
// Range agora começa em N
// N=0 O=1 P=2 Q=3 R=4 S=5 T=6 U=7 V=8 W=9 X=10 ... AC=15 AD=16 AI=22 AJ=23 AK=24

      const cancelN   = String(row[0] ?? '').trim();         // N
      const cancelO   = String(row[1] ?? '').trim();         // O

      const dataSaida = extrairData(String(row[7] ?? ''));   // U = DATA SAÍDA
      const voo       = String(row[8] ?? '').trim();         // V = VOO
      const destino   = String(row[9] ?? '').trim();         // W = DESTINO
      const stdProg   = extrairHorario(row[10] ?? '');       // X = STD/ETD fallback

      const fonia1    = String(row[15] ?? '').trim();        // AC
      const fonia2    = String(row[16] ?? '').trim();        // AD

      const pushCell      = extrairHorario(row[21] ?? '');   // AI = HORÁRIO ESCALADO
      const pushFinalCell = extrairHorario(row[22] ?? '');   // AJ = HORÁRIO FINALIZADO/OK
      const pushConfCell  = String(row[23] ?? '').trim();    // AK = CONFIRMAÇÃO/RESPONSÁVEL

      if (!dataSaida || !voo) return null;
      if (!isHoje(dataSaida)) return null;
      // Ignorar voos cancelados — checa colunas N/O e também AC/AD (equipe/eq.apoio),
      // pois às vezes o cancelamento só é marcado nessas colunas de equipe.
      if (isCancelado(cancelN, cancelO, fonia1, fonia2)) return null;

      const chave   = chaveVoo(dataSaida, voo);
      const monitor = monitorMap.get(chave);
      const limp    = limpezaMap.get(chave);

      // ETD: prioridade monitor_saidas, fallback STD do PROG
      const etd           = monitor?.etd || stdProg;
      const pushFinalizado = monitor?.push || '';

      if (!isHorarioValido(etd)) return null;

      // Remoção: push real G/H + 5 minutos.
      // Enquanto estiver dentro desses 5 minutos, o front vai pintar todos os serviços de verde.
      if (isHorarioValido(pushFinalizado)) {
      const minutosDepoisPush = -(minutosAteHorario(pushFinalizado));
      if (minutosDepoisPush >= 5) return null;
      }

      const minutosParaETD = minutosAteHorario(etd);
      if (minutosParaETD === null) return null;
      if (minutosParaETD > 60)    return null; // além da janela futura
      if (minutosParaETD < -60)  return null; // mais de 1h atrás sem push

      // ── FONIA (equipes de fonia via lista de validação) ──
      const foniaEsc = foniaEscalada(fonia1, fonia2);

      // ── PUSHBACK ──
      // Escalado somente quando AI tem HH:MM válido E AK está preenchido.
      // Verde operacional do PUSHBACK quando está escalado E AJ tem HH:MM válido.
      // Push real G/H é gatilho geral para saída do painel e para pintar todos os serviços de verde no front.
      const pushbackEsc = isHorarioValido(pushCell) && pushConfCell.length > 0;
      const pushbackFin = pushbackEsc && isHorarioValido(pushFinalCell);
      const pushRealDetectado = isHorarioValido(pushFinalizado);

      // ── QTU (P e Q = nomes individuais) ──
      const qtu1     = limp?.qtu1     || '';
      const qtu2     = limp?.qtu2     || '';
      const qtuFinal = limp?.qtuFinal || '';
      const qtuEsc   = duplaEscaladaLimpeza(qtu1, qtu2);
      const qtuFin   = isHorarioValido(qtuFinal);

      // ── QTA (J e K = nomes individuais; O = finalizado; L vs AC) ──
      const qta1     = limp?.qta1     || '';
      const qta2     = limp?.qta2     || '';
      const qtaFinal = limp?.qtaFinal || '';
      const qtaL     = limp?.qtaL     || '';
      const qtaAC    = limp?.qtaAC    || '';
      const qtaEsc   = duplaEscaladaLimpeza(qta1, qta2);
      const qtaOk    = isHorarioValido(qtaFinal);
      const qtaFin   = qtaOk && lMaiorOuIgualAC(qtaL, qtaAC);
      const qtaEmAnd = qtaOk && !qtaFin; // iniciado mas L < AC

      return {
        voo,
        origem:  destino, // mantém compatibilidade com campo "origem" do front
        destino,
        horario: etd,
        data:    dataSaida,
        tempo:   minutosParaETD,
        servicos: {
          fonia: {
            escalado: foniaEsc,
            pushReal: pushRealDetectado,
            valor:    [fonia1, fonia2].filter(Boolean).join(' | '),
          },
          pushback: {
            escalado:   pushbackEsc,
            finalizado: pushbackFin,
            pushReal:   pushRealDetectado,
            valor:      [pushCell, pushConfCell, pushFinalCell].filter(Boolean).join(' | '),
          },
          qtu: {
            escalado:   qtuEsc,
            finalizado: qtuFin,
            pushReal:   pushRealDetectado,
            valor:      [qtu1, qtu2].filter(Boolean).join(' | '),
          },
          qta: {
            escalado:    qtaEsc,
            finalizado:  qtaFin,
            emAndamento: qtaEmAnd,
            pushReal:   pushRealDetectado,
            valor:       [qta1, qta2].filter(Boolean).join(' | '),
          },
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const tA = minutosAteHorario(a.horario) ?? 9999;
      const tB = minutosAteHorario(b.horario) ?? 9999;
      return tA - tB;
    })
    .slice(0, 12);

  console.log('[getVoos] Voos saídas retornados:', voos.length);
  return voos;
}

module.exports = { getVoos };
