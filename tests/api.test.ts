import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi, validateResponse } from '../src/lib/api.ts';

test('HTTP local: contrato de salud y respuesta ante ruta desconocida', async () => {
  const api = createApi(() => {});
  api.route('getHealth', {}, (_req, res) => { res.json({ status: 'ok' }); });
  const server = api.finish().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(origin + '/health');
    assert.equal(response.status, 200);
    assert(validateResponse('getHealth', 200, await response.json()));
    assert.equal(validateResponse('getHealth', 200, { status: 'incorrecto' }), false);
    const missing = await fetch(origin + '/inexistente');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'NOT_FOUND');
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
