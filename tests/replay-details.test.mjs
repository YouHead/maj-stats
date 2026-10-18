import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGame } from '../src/statistics.mjs';
import { buildScoreHistory, buildReplayDetails } from '../src/replay-details.mjs';
import { scoreChartScale } from '../src/score-chart.mjs';
import { createServer } from '../src/server.mjs';
import { createFixture, head, ids } from './fixtures/record-management.mjs';

const event = (name, data) => ({ name, data });
const opening = (scores, ju = 0, ben = 0) => event('RecordNewRound', { scores, chang: 0, ju, ben });
const players = (scores) => scores.map((finalScore, seat) => ({ seat, finalScore }));

test('uses official win and draw snapshots including accepted riichi, repeated hands and negative points', () => {
  const records = [
    opening([25000, 25000, 25000, 25000]), event('RecordDiscardTile', { seat: 0, is_liqi: true }),
    event('RecordNoTile', { scores: [{ old_scores: [24000, 25000, 25000, 25000], delta_scores: [1500, -1500, -1500, 1500] }] }),
    opening([25500, 23500, 23500, 26500], 0, 1),
    event('RecordHule', { scores: [25500, 23500, 30000, 21000] }),
    opening([25500, 23500, 30000, 21000], 1),
    event('RecordHule', { old_scores: [25500, 23500, 30000, 20000], delta_scores: [-30000, 0, 0, 31000] }),
  ];
  const history = buildScoreHistory(players([-4500, 23500, 30000, 51000]), records);
  assert.deepEqual(history.points.map((point) => point.label), ['开局', '东1', '东1·1本场', '东2']);
  assert.deepEqual(history.points[1].scores, [25500, 23500, 23500, 26500]);
  assert.deepEqual(history.points[3].scores, [-4500, 23500, 30000, 51000]);
  assert.equal(history.complete, true);
});

test('does not add deltas to opening scores when the riichi-adjusted base is unavailable', () => {
  const history = buildScoreHistory(players([28000, 24000, 24000, 24000]), [
    opening([25000, 25000, 25000, 25000]), event('RecordHule', { delta_scores: [3000, -1000, -1000, -1000] }),
    opening([27000, 24000, 24000, 24000], 1), event('RecordHule', {}),
  ]);
  assert.deepEqual(history.points[1].scores, [27000, 24000, 24000, 24000]);
  assert.deepEqual(history.points.at(-1).scores, [28000, 24000, 24000, 24000]);
});

test('recognizes all-tenpai draws with omitted zero transfers before final deposit settlement', () => {
  const history = buildScoreHistory(players([26000, 25000, 25000, 24000]), [
    opening([25000, 25000, 25000, 25000]),
    event('RecordNoTile', { players: [0,1,2,3].map(() => ({ tingpai: true })), scores: [{ old_scores: [25000, 25000, 25000, 24000], delta_scores: [] }] }),
  ]);
  assert.deepEqual(history.points[1].scores, [25000, 25000, 25000, 24000]);
  assert.equal(history.points[2].phase, 'settlement');
});

test('separates final settlement and tracks explicit riichi payments on abortive draws', () => {
  const history = buildScoreHistory(players([26000, 24000, 25000, 25000]), [
    opening([25000, 25000, 25000, 25000]), event('RecordDiscardTile', { seat: 1, is_liqi: true }),
    event('RecordLiuJu', { liqi: { seat: 1, score: 24000, failed: false } }),
  ]);
  assert.deepEqual(history.points.map((point) => point.phase), ['opening', 'round-end', 'settlement']);
  assert.deepEqual(history.points[1].scores, [25000, 24000, 25000, 25000]);
  assert.equal(history.points[1].outcome, 'abortive-draw');
  const declaredOnly = buildScoreHistory(players([25000, 25000, 25000, 25000]), [opening([25000, 25000, 25000, 25000]), event('RecordDiscardTile', { seat: 1, is_liqi: true }), event('RecordLiuJu', { liqi: { seat: 1, score: 0, failed: true } })]);
  assert.deepEqual(declaredOnly.points.at(-1).scores, [25000, 25000, 25000, 25000]);
});

test('keeps unavailable scores as gaps and distinguishes inter-round point adjustments', () => {
  const history = buildScoreHistory(players([20000, 30000, 25000, 25000]), [
    opening([25000, 25000, 25000, 25000]), event('RecordHule', { scores: [24000, 26000, 25000, 25000] }),
    opening([23000, 27000, 25000, 25000], 1), event('RecordHule', {}),
    opening([], 2), event('RecordHule', {}),
  ]);
  assert.ok(history.points.some((point) => point.phase === 'adjustment'));
  assert.ok(history.points.some((point) => point.scores.every((score) => score === null)));
  assert.equal(history.complete, false);
});

test('summarizes actual counts by player and keeps exhaustive and abortive draws separate', () => {
  const records = [opening([25000, 25000, 25000, 25000]), event('RecordDiscardTile', { seat: 3, is_liqi: true }), event('RecordHule', { hules: [{ seat: 0, point_rong: 2000 }, { seat: 1, point_rong: 1000 }], scores: [27000, 26000, 25000, 22000] }), opening([27000, 26000, 25000, 22000], 1), event('RecordNoTile', {}), opening([27000, 26000, 25000, 22000], 1, 1), event('RecordLiuJu', {})];
  const game = analyzeGame(head(ids[0]), records), details = buildReplayDetails(game, records);
  assert.equal(details.roundCount, 3); assert.equal(details.drawCount, 1); assert.equal(details.abortiveDrawCount, 1);
  assert.equal(details.players.find((player) => player.seat === 3).dealInCount, 1);
  assert.equal(details.players.find((player) => player.seat === 3).riichiCount, 1);
  assert.equal(details.players.find((player) => player.seat === 0).winCount, 1);
  assert.deepEqual(details.players.map((player) => player.rank), [1, 2, 3, 4]);
  assert.equal(details.players[0].pt, 53.2);
});

test('chart scales include negative and zero scores and remain usable for constant scores', () => {
  const scale = scoreChartScale([{ scores: [-3400, 0, 25000, 64400] }]);
  assert.ok(scale.min < -3400); assert.ok(scale.max > 64400); assert.ok(scale.ticks.includes(0));
  const constant = scoreChartScale([{ scores: [25000, 25000, 25000, 25000] }]);
  assert.ok(constant.min < constant.max); assert.ok(constant.ticks.length >= 2);
  assert.equal(scoreChartScale([{ scores: [null, null, null, null] }]), null);
});

test('details read only the current cached contest and opening a replay uses a fixed official URL', async (context) => {
  const { manager: store, session } = await createFixture();
  session.fetchRecord = async () => { throw new Error('详情不得联网'); };
  const opened = [];
  const { server, origin } = await createServer({ store, session, onOpenReplay: async (url) => opened.push(url) });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const route = `${origin}/api/records/detail?contestId=196077&uuid=${ids[0]}`;
  const response = await fetch(route); assert.equal(response.status, 200);
  const detail = await response.json(); assert.equal(detail.players.length, 4); assert.equal(detail.scoreHistory.points.length, 2);
  assert.deepEqual(await (await fetch(route)).json(), detail);
  assert.equal((await fetch(`${origin}/api/records/detail?contestId=196078&uuid=${ids[0]}`)).status, 400);
  assert.equal((await fetch(`${origin}/api/records/detail?contestId=196077&uuid=../../settings`)).status, 400);
  const post = (from, body) => fetch(`${origin}/api/records/open`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('https://example.com', { contestId: 196077, uuid: ids[0] })).status, 403);
  assert.equal((await post(origin, { contestId: 196078, uuid: ids[0] })).status, 400);
  store.modifying = true;
  assert.equal((await post(origin, { contestId: 196077, uuid: ids[0] })).status, 409);
  assert.equal(opened.length, 0); store.modifying = false;
  assert.equal((await post(origin, { contestId: 196077, uuid: ids[0], url: 'https://example.com/ignored' })).status, 200);
  assert.deepEqual(opened, [`https://game.maj-soul.com/1/?paipu=${ids[0]}`]);
  await store.removeReplay(196077, ids[0]); assert.equal((await fetch(route)).status, 400);
  for (const path of ['/replay-details.js', '/score-chart.js']) assert.equal((await fetch(origin + path)).status, 200);
});
