import assert from 'node:assert/strict';
import { test } from 'node:test';
import { METRICS, visibleMetrics, sortPlayers, metricTooltip, formatMetric } from '../src/metrics.mjs';

test('covers all screenshot metrics and keeps the macro view limited to overall results', () => {
  const screenshot = ['和牌率', '默胡率', '副露率', '平均打点', '放铳率', '流局率', '立直率', '平均铳点', '自摸率', '流听率', '和了巡数', '平均顺位'];
  for (const label of screenshot) assert.ok(METRICS.some((item) => item.label === label));
  assert.deepEqual(visibleMetrics().map((item) => item.key), ['totalPt', 'games', 'firstRate', 'secondRate', 'thirdRate', 'fourthRate', 'averageRank']);
  assert.ok(visibleMetrics(true).some((item) => item.key === 'rounds'));
  assert.ok(!METRICS.some((item) => item.key === 'averagePt'));
  assert.equal(visibleMetrics(true).length, METRICS.length);
});

test('formats PT without a positive sign and defaults to PT descending with missing values last', () => {
  const total = METRICS.find((item) => item.key === 'totalPt');
  assert.equal(total.label, 'PT');
  assert.equal(formatMetric(total, 59), '59.0');
  assert.equal(formatMetric(total, -1.25), '-1.3');
  assert.equal(formatMetric(total, 0), '0.0');
  const player = { games: 2, ptObservedGames: 2, ptRawSum: 59000, totalPt: 59, averagePt: 29.5 };
  assert.equal(formatMetric(total, -0), '0.0');
  assert.equal(metricTooltip(total, player), '');
  assert.equal(metricTooltip(total, { ...player, ptObservedGames: 1 }), '');
  assert.equal(metricTooltip(total), '');
  assert.equal(METRICS.find((item) => item.key === 'rounds').label, '小局数');
  const players = [{ key: '1', totalPt: -50 }, { key: '2', totalPt: 0 }, { key: '3', totalPt: 20 }, { key: '4', totalPt: null }];
  assert.deepEqual(sortPlayers(players, 'totalPt', 'desc').map((item) => item.key), ['3', '2', '1', '4']);
  assert.deepEqual(sortPlayers(players, 'totalPt', 'asc').map((item) => item.key), ['1', '2', '3', '4']);
  assert.deepEqual(sortPlayers(players).map((item) => item.key), ['3', '2', '1', '4']);
});

test('sorts both directions numerically and keeps missing values last without changing source order', () => {
  const players = [{ key: '4', winRate: null }, { key: '3', winRate: 0.1 }, { key: '2', winRate: 0.5 }, { key: '1', winRate: 0 }];
  assert.deepEqual(sortPlayers(players, 'winRate', 'asc').map((player) => player.key), ['1', '3', '2', '4']);
  assert.deepEqual(sortPlayers(players, 'winRate', 'desc').map((player) => player.key), ['2', '3', '1', '4']);
  assert.equal(players[0].key, '4');
  assert.throws(() => sortPlayers(players, 'not-a-metric'), /不正确/);
});

test('cell tooltips show only compact counts and headers show only definitions', () => {
  const tsumo = METRICS.find((item) => item.key === 'tsumoRate');
  assert.equal(metricTooltip(tsumo, { tsumoWins: 2, wins: 4, tsumoRate: 0.5 }), '2/4');
  assert.equal(metricTooltip(tsumo, { tsumoWins: 0, wins: 0, tsumoRate: null }), '0/0');
  assert.equal(metricTooltip(tsumo), `自摸率：${tsumo.description}`);
  assert.doesNotMatch(metricTooltip(tsumo), /点击|切换|升序|降序/);
  const tenpai = METRICS.find((item) => item.key === 'tenpaiRate');
  assert.equal(metricTooltip(tenpai, { tenpaiObservedDraws: 1, drawRounds: 2 }), '—');
  assert.equal(metricTooltip(METRICS.find((item) => item.key === 'games'), { games: 3 }), '3');
  assert.equal(formatMetric(tsumo, null), '—');
  assert.equal(formatMetric(tsumo, 0), '0.00%');
  for (const key of ['averageWinPoints', 'averageDealInPoints', 'averageRank']) {
    const average = METRICS.find((item) => item.key === key);
    assert.equal(metricTooltip(average, { winPoints: 8000, wins: 2, dealInPoints: 4000, dealIns: 1, dealInObserved: 1, rankSum: 5, games: 2 }), '');
    assert.equal(metricTooltip(average), `${average.label}：${average.description}`);
  }
});
