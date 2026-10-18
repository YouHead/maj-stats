import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from '../src/server.mjs';
import { createFixture, ids } from './fixtures/record-management.mjs';

test('serves the app locally and restricts mutations to its own origin', async (context) => {
  let opened = 0;
  let imports = 0;
  let contests = 0;
  let stops = 0;
  const session = { status: () => ({ ready: false }), open: async () => { opened++; }, logout: async () => {} };
  const store = { state: () => ({ summary: { gameCount: 0, roundCount: 0, players: [] }, games: [] }), start: (text) => { imports++; return { text }; }, startContest: () => { contests++; return { ok: true }; }, stop: () => { stops++; return { ok: true }; } };
  const { server, origin } = await createServer({ session, store });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await page.text(), /type="module" src="\/app.js"/);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(state.session.ready, false);
  const blocked = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 403);
  assert.equal(opened, 0);
  const accepted = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(accepted.status, 200);
  assert.equal(opened, 1);
  const imported = await fetch(`${origin}/api/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a link' }) });
  assert.equal(imported.status, 200);
  assert.equal(imports, 1);
  const externalContest = await fetch(`${origin}/api/contest/import`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(externalContest.status, 403);
  assert.equal(contests, 0);
  const contestImport = await fetch(`${origin}/api/contest/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(contestImport.status, 200);
  assert.equal(contests, 1);
  const stop = await fetch(`${origin}/api/import/stop`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(stop.status, 200);
  assert.equal(stops, 1);
});

test('record APIs require same-origin confirmation and enforce current-contest scope', async (context) => {
  const { manager: store, session } = await createFixture();
  const { server, origin } = await createServer({ session, store });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const post = (route, body, from = origin) => fetch(`${origin}${route}`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const route of ['/api/records/delete', '/api/records/clear']) {
    assert.equal((await post(route, { contestId: 196077, uuid: ids[0] })).status, 400);
    assert.equal((await post(route, { contestId: 196077, uuid: ids[0], confirmed: true }, 'https://example.com')).status, 403);
  }
  assert.equal(store.state().summary.gameCount, 2);
  assert.equal((await post('/api/records/delete', { contestId: 196077, uuid: ids[0], confirmed: true })).status, 200);
  assert.equal(store.state().summary.gameCount, 1);
  const deleted = store.state().trash[0].id;
  assert.equal((await post('/api/records/restore', { contestId: 196077, batchId: deleted })).status, 200);
  assert.equal(store.state().summary.gameCount, 2);
  assert.equal((await post('/api/contest/select', { contestId: '196078' })).status, 200);
  assert.equal((await post('/api/records/clear', { contestId: 196077, confirmed: true })).status, 400);
  assert.equal(store.state().contest.contest_id, 196078);
  assert.equal((await post('/api/contest/select', { contestId: '../bad' })).status, 400);
  assert.equal((await post('/api/contest/select', null)).status, 400);
  await post('/api/contest/select', { contestId: 196077 });
  assert.equal((await post('/api/records/clear', { contestId: 196077, confirmed: true })).status, 200);
  assert.equal(store.state().summary.gameCount, 0);
  assert.equal(store.state().sync, null);
  assert.equal((await fetch(`${origin}/record-controls.js`)).status, 200);
});

test('exposes storage information and opens only the fixed data directory through a same-origin request', async (context) => {
  const { manager: store, session } = await createFixture();
  let opens = 0;
  const application = { version: '0.2.0', storageRoot: 'fixture-user-storage', profilePath: 'fixture-user-storage/profile' };
  const { server, origin } = await createServer({ session, store, application, onOpenData: async () => { opens++; } });
  context.after(() => { server.closeAllConnections(); server.close(); });
  assert.deepEqual((await (await fetch(`${origin}/api/state`)).json()).application, application);
  const post = (from) => fetch(`${origin}/api/data/open`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'ignored-client-path' }) });
  assert.equal((await post('https://example.com')).status, 403);
  assert.equal(opens, 0);
  assert.equal((await post(origin)).status, 200);
  assert.equal(opens, 1);
});
