import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterReplays, replayDate } from '../src/record-list.mjs';
import { rankTeams } from '../src/team-ranking.mjs';
import { createServer } from '../src/server.mjs';

const seconds = (iso) => Date.parse(iso) / 1000;
const games = [
  { uuid: 'old', startTime: seconds('2026-10-16T15:59:59Z'), players: [{ nickname: 'Alice', accountId: 123 }] },
  { uuid: 'midnight', startTime: seconds('2026-10-16T16:00:00Z'), players: [{ nickname: 'Alice', accountId: 123 }, { nickname: 'Bob', accountId: 456 }] },
  { uuid: 'late', startTime: seconds('2026-10-17T15:59:59Z'), players: [{ nickname: 'Bob', accountId: 456 }] },
  { uuid: 'next', startTime: seconds('2026-10-17T16:00:00Z'), players: [{ nickname: 'Alice', accountId: 123 }] },
  { uuid: 'unknown', startTime: 0, players: [{ nickname: 'Alice', accountId: 123 }] },
];

test('replay dates use Beijing time and include both date boundaries', () => {
  assert.equal(replayDate(games[0].startTime), '2026-10-16');
  assert.equal(replayDate(games[1].startTime), '2026-10-17');
  assert.equal(replayDate(games[3].startTime), '2026-10-18');
  assert.deepEqual(filterReplays(games, { from: '2026-10-17', to: '2026-10-17' }).map((game) => game.uuid), ['late', 'midnight']);
  assert.equal(replayDate(NaN), ''); assert.equal(replayDate(Infinity), ''); assert.equal(replayDate(0), '');
});

test('combines date and nickname or account ID filters without changing source order', () => {
  assert.deepEqual(filterReplays(games, { player: ' aLiCe ', from: '2026-10-17', to: '2026-10-17' }).map((game) => game.uuid), ['midnight']);
  assert.deepEqual(filterReplays(games, { player: '456' }).map((game) => game.uuid), ['late', 'midnight']);
  assert.deepEqual(filterReplays(games, { player: 'nobody' }), []);
  assert.deepEqual(filterReplays(games).map((game) => game.uuid), ['next', 'late', 'midnight', 'old', 'unknown']);
  assert.equal(games[0].uuid, 'old');
});

test('rejects inverted and invalid date ranges rather than showing misleading matches', () => {
  assert.throws(() => filterReplays(games, { from: '2026-10-18', to: '2026-10-17' }), /不能晚于/);
  assert.throws(() => filterReplays(games, { from: '2026-02-30' }), /有效/);
  assert.throws(() => filterReplays(games, { to: '2026-13-01' }), /有效/);
});

test('team ordinal and gaps follow PT descending, with ties, negative PT and missing results', () => {
  const input = [{ id: 4, totalPt: null }, { id: 3, totalPt: -15.1 }, { id: 2, totalPt: 149.3 }, { id: 1, totalPt: 165.4 }, { id: 5, totalPt: 149.3 }];
  const ranked = rankTeams(input);
  assert.deepEqual(ranked.map((team) => team.id), [1, 2, 5, 3, 4]);
  assert.deepEqual(ranked.map((team) => team.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(ranked.map((team) => team.gapToPrevious), [null, 16.1, 0, 164.4, null]);
  assert.equal(input[0].rank, undefined);
});

test('serves a separate record page and shared filter module with the same local security headers', async (context) => {
  const { server, origin } = await createServer({ session: { status: () => ({}) }, store: { state: () => ({}) } });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const home = await (await fetch(origin)).text();
  assert.match(home, /href="\/records"/); assert.ok(!home.includes('id="replays-fold"'));
  const response = await fetch(`${origin}/records?from=2026-10-17&player=Alice`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const page = await response.text();
  for (const id of ['record-from', 'record-to', 'record-player', 'record-confirmation']) assert.ok(page.includes(`id="${id}"`));
  assert.match(page, /href="\/">返回统计/);
  for (const path of ['/record-list.js', '/records.js', '/contest-controls.js']) assert.equal((await fetch(origin + path)).status, 200);
});
