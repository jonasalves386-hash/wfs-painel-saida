'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('GET /api/saidas/voos entrega somente o contrato interno normalizado', async (t) => {
  let receivedDate;
  const app = createApp({
    service: {
      async getVoos({ date }) {
        receivedDate = date;
        return { voos: [], meta: { data: date } };
      },
    },
    logger: { error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/saidas/voos?data=2026-09-29`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-data-stale'), 'false');
  assert.equal(receivedDate, '2026-09-29');
  assert.deepEqual(await response.json(), { voos: [], meta: { data: '2026-09-29' } });
});

test('GET /api/saidas/voos sinaliza snapshot antigo sem remover voos', async (t) => {
  const app = createApp({
    service: {
      async getVoos() {
        return {
          voos: [{ id: 'dep-1', voo: 'LA3210' }],
          meta: { disponibilidade: { malha: 'indisponivel' } },
        };
      },
    },
    logger: { error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/saidas/voos`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-data-stale'), 'true');
  assert.equal(payload.voos.length, 1);
});
