function isHorarioValido(horario) {
  if (!horario || typeof horario !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(horario.trim());
}

// Extrai HH:MM de qualquer string (ex: "26/05/2026 14:35" → "14:35")
function extrairHorario(valor) {
  const texto = String(valor || '').trim();
  const match = texto.match(/([01]\d|2[0-3]):[0-5]\d/);
  return match ? match[0] : '';
}

// Extrai data no formato DD/MM/YYYY de qualquer string
function extrairData(valor) {
  const texto = String(valor || '').trim();
  const br = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return '';
}

function isDataValida(valor) {
  const data = extrairData(valor);
  if (!data) return false;
  const [dia, mes, ano] = data.split('/').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return d.getDate() === dia && d.getMonth() === mes - 1 && d.getFullYear() === ano;
}

function getAgoraBR() {
  const agora = new Date();
  const offset = -3;
  const utc = agora.getTime() + agora.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * offset);
}

function isHoje(valor) {
  const data = extrairData(valor);
  if (!isDataValida(data)) return false;
  const [dia, mes, ano] = data.split('/').map(Number);
  const hojeBR = getAgoraBR();
  return (
    dia === hojeBR.getDate() &&
    mes === hojeBR.getMonth() + 1 &&
    ano === hojeBR.getFullYear()
  );
}

function minutosAteHorario(horario) {
  if (!isHorarioValido(horario)) return null;
  const [h, m] = horario.trim().split(':').map(Number);
  const agoraBR = getAgoraBR();
  const alvo = new Date(agoraBR);
  alvo.setHours(h, m, 0, 0);
  return Math.floor((alvo - agoraBR) / 60000);
}

module.exports = {
  isHorarioValido,
  extrairHorario,
  extrairData,
  isDataValida,
  isHoje,
  minutosAteHorario,
};
