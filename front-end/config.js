// Endpoint interno; URLs e credenciais dos provedores existem somente no backend.
// - Servido pelo próprio Express (npm start): rota same-origin /api/saidas.
// - Live Server local (porta 5500): backend em localhost:3000.
// - VPS (coiwfs.com/painelsaidas): nginx encaminha /api-saidas/* para o backend
//   removendo o prefixo, então a rota fica /api-saidas/api/saidas.
const API_BASE_URL = (() => {
  const { hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isLocal && port === '5500') return 'http://localhost:3000/api/saidas';
  if (isLocal) return '/api/saidas';
  return `${origin}/api-saidas/api/saidas`;
})();
