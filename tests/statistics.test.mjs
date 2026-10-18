import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGame, aggregateGames } from '../src/statistics.mjs';

export const sampleId = '260101-00000001-0000-4000-8000-000000000007';
export function head(uuid = sampleId) {
  return {
    uuid, start_time: 1792210000, end_time: 1792212000,
    accounts: [0, 1, 2, 3].map((seat) => ({ seat, account_id: seat + 1, nickname: `Player ${seat + 1}` })),
    result: { players: [3, 1, 0, 2].map((seat, index) => ({ seat, part_point_1: 40000 - 10000 * index })) },
  };
}
const record = (name, data) => ({ name, data });
const newRound = (ben = 0) => record('RecordNewRound', { scores: [25000, 25000, 25000, 25000], chang: 0, ju: 0, ben });
export function records() {
  return [
    newRound(),
    record('RecordDiscardTile', { seat: 1, is_liqi: true }),
    record('RecordChiPengGang', { seat: 2 }), record('RecordChiPengGang', { seat: 2 }),
    record('RecordDiscardTile', { seat: 3 }),
    record('RecordHule', { hules: [{ seat: 1, zimo: false, point_rong: 3900 }, { seat: 2, zimo: false, point_rong: 2000 }], delta_scores: [0, 3900, 2000, -5900] }),
    newRound(1),
    record('RecordHule', { hules: [{ seat: 0, zimo: true, qinjia: true, point_zimo_xian: 4000 }], delta_scores: [12300, -4100, -4100, -4100] }),
    newRound(), record('RecordAnGangAddGang', { seat: 0, type: 3 }),
    record('RecordDiscardTile', { seat: 2, is_liqi: true }),
    record('RecordNoTile', { liujumanguan: false }),
  ];
}

test('counts multiple ron once for the discarder, and excludes tsumo payments and concealed kans', () => {
  const result = analyzeGame(head(), records());
  assert.equal(result.roundCount, 3);
  assert.deepEqual(result.players.map((player) => player.dealIns), [0, 0, 0, 1]);
  assert.deepEqual(result.players.map((player) => player.wins), [1, 1, 1, 0]);
  assert.equal(result.players[2].openRounds, 1);
  assert.equal(result.players[0].openRounds, 0);
  assert.equal(result.players[1].riichiRate, 1 / 3);
  assert.equal(result.players[0].averageWinPoints, 12000);
  assert.equal(result.players[3].averageWinPoints, null);
});

test('reads signed tournament PT from official settlement fields without deriving it from final scores or rank', () => {
  const metadata = head();
  metadata.result.players.forEach((result) => { result.total_point = [53200, 0, -21100, -32100][result.seat]; });
  const game = analyzeGame(metadata, records());
  assert.equal(game.statisticsVersion, 3);
  assert.deepEqual(game.players.map((player) => player.totalPt), [53.2, 0, -21.1, -32.1]);
  assert.deepEqual(game.players.map((player) => player.averagePt), [53.2, 0, -21.1, -32.1]);
  assert.deepEqual(game.players.map((player) => player.ptObservedGames), [1, 1, 1, 1]);
  assert.equal(game.players[0].ptRawSum, 53200);
});

test('sums raw settlement integers before averaging PT, deduplicates games, and preserves exact zero totals', () => {
  const firstHead = head(), secondHead = head(sampleId.replace('00000001', '00000002'));
  firstHead.result.players.forEach((result) => { result.total_point = [101, 50000, -40000, -10101][result.seat]; });
  secondHead.result.players.forEach((result) => { result.total_point = [-101, -20000, 30000, -9899][result.seat]; });
  const first = analyzeGame(firstHead, records()), second = analyzeGame(secondHead, records());
  const total = aggregateGames([first, second, first]);
  const one = total.players.find((player) => player.accountId === 1), two = total.players.find((player) => player.accountId === 2);
  assert.equal(total.gameCount, 2); assert.equal(one.totalPt, 0); assert.equal(one.averagePt, 0);
  assert.equal(two.ptRawSum, 30000); assert.equal(two.totalPt, 30); assert.equal(two.averagePt, 15);
  assert.equal(total.players.reduce((sum, player) => sum + player.ptRawSum, 0), 0);
});

test('does not present missing or partial settlement fields as zero PT', () => {
  const complete = head(), partial = head(sampleId.replace('00000001', '00000002'));
  complete.result.players.forEach((result) => { result.total_point = 0; });
  const first = analyzeGame(complete, records()), second = analyzeGame(partial, records());
  assert.equal(first.players[0].totalPt, 0);
  assert.equal(second.players[0].totalPt, null);
  const total = aggregateGames([first, second]).players[0];
  assert.equal(total.ptObservedGames, 1); assert.equal(total.totalPt, null); assert.equal(total.averagePt, null);
});

test('deduplicates complete games and aggregates counts rather than averaging percentages', () => {
  const first = analyzeGame(head(), records());
  const secondId = sampleId.replace('00000001', '00000002');
  const metadata = head(secondId);
  metadata.accounts[0].nickname = 'Renamed';
  const second = analyzeGame(metadata, [newRound(), record('RecordLiuJu', {})]);
  const result = aggregateGames([first, first, second]);
  assert.equal(result.gameCount, 2);
  assert.equal(result.roundCount, 4);
  const player = result.players.find((item) => item.accountId === 1);
  assert.equal(player.nickname, 'Renamed');
  assert.equal(player.winRate, 1 / 4);
  assert.equal(player.games, 2);
});

test('handles robbing a kan, and never treats the other pao payer as the discarder', () => {
  const result = analyzeGame(head(), [newRound(), record('RecordAnGangAddGang', { seat: 3 }), record('RecordHule', { hules: [{ seat: 1, zimo: false, point_rong: 32000 }], delta_scores: [-16000, 32000, 0, -16000] })]);
  assert.deepEqual(result.players.map((player) => player.dealIns), [0, 0, 0, 1]);
});

test('rejects incomplete and unsupported records instead of presenting partial rates', () => {
  assert.throws(() => analyzeGame(head(), [newRound()]), /不完整/);
  assert.throws(() => analyzeGame(head(), [newRound(), record('RecordHuleXueZhan', {})]), /暂不支持/);
  assert.throws(() => analyzeGame({ ...head(), accounts: head().accounts.slice(0, 3) }, records()), /四人/);
});

test('uses starting seat order to resolve equal final scores', () => {
  const metadata = head();
  metadata.result.players.forEach((player) => { player.part_point_1 = 25000; });
  const result = analyzeGame(metadata, [newRound(), record('RecordNoTile', {})]);
  assert.deepEqual(result.players.map((player) => player.averageRank), [1, 2, 3, 4]);
});

test('accepts Unity records with four empty opening entries', () => {
  const opening = newRound();
  opening.data.opens = [0, 1, 2, 3].map((seat) => ({ seat, tiles: [], count: [] }));
  assert.equal(analyzeGame(head(), [opening, record('RecordNoTile', {})]).roundCount, 1);
  opening.data.opens[0].tiles.push('1m');
  assert.throws(() => analyzeGame(head(), [opening, record('RecordNoTile', {})]), /特殊规则/);
});

test('counts placements, tsumo and closed non-riichi wins using the agreed denominators', () => {
  const game = analyzeGame(head(), records());
  assert.equal(game.players[3].firstRate, 1);
  assert.equal(game.players[1].secondRate, 1);
  assert.equal(game.players[0].thirdRate, 1);
  assert.equal(game.players[2].fourthRate, 1);
  assert.equal(game.players[0].tsumoRate, 1);
  assert.equal(game.players[0].damatenRate, 1);
  assert.equal(game.players[1].damatenRate, 0);
  assert.equal(game.players[2].damatenRate, 0);
  assert.equal(game.players[3].tsumoRate, null);
  const concealed = analyzeGame(head(), [newRound(), record('RecordAnGangAddGang', { seat: 0, type: 3 }), record('RecordHule', { hules: [{ seat: 0, zimo: true, point_zimo_qin: 2000, point_zimo_xian: 1000 }] })]);
  assert.equal(concealed.players[0].damatenRate, 1);
});

test('separates exhaustive and abortive draws and does not treat unknown tenpai data as zero', () => {
  const game = analyzeGame(head(), [newRound(), record('RecordNoTile', { players: [true, false, true, false].map((tingpai) => ({ tingpai })) }), newRound(), record('RecordLiuJu', {})]);
  assert.equal(game.players[0].drawRate, 0.5);
  assert.equal(game.players[0].tenpaiRate, 1);
  assert.equal(game.players[1].tenpaiRate, 0);
  assert.equal(game.players[0].abortiveDrawRounds, 1);
  const unknown = analyzeGame(head(), [newRound(), record('RecordNoTile', {})]);
  assert.equal(unknown.players[0].tenpaiRate, null);
  assert.equal(aggregateGames([game, unknown]).players[0].tenpaiRate, null);
});

test('averages actual deal-in payments once per round, including honba and excluding other pao payers', () => {
  const game = analyzeGame(head(), [
    newRound(1), record('RecordDiscardTile', { seat: 3 }),
    record('RecordHule', { hules: [{ seat: 1, point_rong: 3900 }, { seat: 2, point_rong: 2000 }], delta_scores: [0, 4200, 2300, -6500] }),
    newRound(), record('RecordAnGangAddGang', { seat: 3 }),
    record('RecordHule', { hules: [{ seat: 1, point_rong: 32000 }], delta_scores: [-16000, 32000, 0, -16000] }),
  ]);
  assert.equal(game.players[3].dealIns, 2);
  assert.equal(game.players[3].dealInPoints, 22500);
  assert.equal(game.players[3].averageDealInPoints, 11250);
  assert.equal(game.players[0].averageDealInPoints, null);
  const unknown = analyzeGame(head(), [newRound(), record('RecordDiscardTile', { seat: 3 }), record('RecordHule', { hules: [{ seat: 0, point_rong: 1000 }] })]);
  assert.equal(unknown.players[3].averageDealInPoints, null);
});

test('calculates winning turn from cumulative table discards divided by four plus one', () => {
  const game = analyzeGame(head(), [
    newRound(), ...[0, 1, 2, 3].map((seat) => record('RecordDiscardTile', { seat })),
    record('RecordHule', { hules: [{ seat: 0, point_rong: 2000 }] }),
    newRound(), record('RecordHule', { hules: [{ seat: 0, zimo: true, point_zimo_qin: 2000, point_zimo_xian: 1000 }] }),
  ]);
  assert.equal(game.players[0].winTurnSum, 3);
  assert.equal(game.players[0].averageWinTurn, 1.5);
  assert.equal(game.players[1].averageWinTurn, null);
});

test('keeps the latest nickname when an older tournament replay is imported later', () => {
  const latest = analyzeGame(head(), records());
  latest.players[0].nickname = 'Latest nickname';
  const olderHead = head(sampleId.replace('00000001', '00000002'));
  olderHead.start_time -= 1000;
  const older = analyzeGame(olderHead, records());
  const summary = aggregateGames([latest, older]);
  assert.equal(summary.players.find((player) => player.accountId === 1).nickname, 'Latest nickname');
});
