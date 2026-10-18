const metric = (key, label, type, description, numerator, denominator, extra = {}) => ({ key, label, type, description, numerator, denominator, ...extra });
export const DEFAULT_SORT = Object.freeze({ key: 'totalPt', direction: 'desc' });

/** Shared definitions keep the table, tooltips, sorting and workbook consistent. */
export const METRICS = [
  metric('totalPt', 'PT', 'pt', '已导入牌谱的结算分合计 / 1000；包含顺位马和返还，不含赛事额外修正分或最佳若干场规则。缺少结算分时不显示完整累计值。', 'ptRawSum', 'games', { macro: true }),
  metric('games', '对局数', 'integer', '去重后该选手参与的完整对局数。', null, null, { macro: true }),
  metric('firstRate', '一位率', 'percent', '一位次数 / 对局数。', 'firsts', 'games', { macro: true }),
  metric('secondRate', '二位率', 'percent', '二位次数 / 对局数。', 'seconds', 'games', { macro: true }),
  metric('thirdRate', '三位率', 'percent', '三位次数 / 对局数。', 'thirds', 'games', { macro: true }),
  metric('fourthRate', '四位率', 'percent', '四位次数 / 对局数。', 'fourths', 'games', { macro: true }),
  metric('averageRank', '平均顺位', 'decimal', '顺位合计 / 对局数；同点按起始座位顺序确定顺位。', 'rankSum', 'games', { macro: true, cellTooltip: false }),
  metric('rounds', '小局数', 'integer', '实际参与小局数，包含连庄、荒牌与途中流局。', null, null),
  metric('winRate', '和牌率', 'percent', '和牌局数 / 参与局数。', 'wins', 'rounds'),
  metric('dealInRate', '放铳率', 'percent', '放铳局数 / 参与局数；一炮多响只计一局，自摸支付及其他人的包牌支付不算放铳。', 'dealIns', 'rounds'),
  metric('tsumoRate', '自摸率', 'percent', '自摸局数 / 和牌局数。', 'tsumoWins', 'wins'),
  metric('damatenRate', '默胡率', 'percent', '门清且未立直的和牌次数 / 和牌次数，包含门清自摸；暗杠不破门清。', 'damatenWins', 'wins'),
  metric('drawRate', '流局率', 'percent', '荒牌流局次数 / 参与局数；途中流局另计，流局满贯仍按荒牌事件计数。', 'drawRounds', 'rounds'),
  metric('tenpaiRate', '流听率', 'percent', '荒牌时听牌次数 / 荒牌流局次数；不包含途中流局。', 'tenpaiDraws', 'drawRounds', { observed: 'tenpaiObservedDraws' }),
  metric('openRate', '副露率', 'percent', '发生过吃、碰或大明杠的局数 / 参与局数；暗杠不计副露。', 'openRounds', 'rounds'),
  metric('riichiRate', '立直率', 'percent', '立直宣言局数 / 参与局数，包含宣言牌被荣和的情况。', 'riichiRounds', 'rounds'),
  metric('averageWinPoints', '平均打点', 'points', '和牌打点合计 / 和牌次数；优先读取牌谱 dadian 字段，否则使用荣和点或自摸支付合计。', 'winPoints', 'wins', { cellTooltip: false }),
  metric('averageDealInPoints', '平均铳点', 'points', '放铳实际支付点数合计 / 放铳局数，含本场、不含供托；一炮多响合计，自摸支付与其他人的包牌支付不计入。', 'dealInPoints', 'dealIns', { observed: 'dealInObserved', cellTooltip: false }),
  metric('averageWinTurn', '和了巡数', 'decimal', '和牌时的（全桌累计舍牌数 / 4 + 1）合计 / 和牌次数，沿用原站口径。', 'winTurnSum', 'wins'),
];

export function visibleMetrics(detailed = false) { return METRICS.filter((item) => detailed || item.macro); }
export function formatMetric(item, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (item.type === 'percent') return `${(value * 100).toFixed(2)}%`;
  const digits = item.type === 'decimal' ? 3 : item.type === 'pt' ? 1 : 0;
  return (value === 0 ? 0 : value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function metricTooltip(item, player) {
  if (item.type === 'pt') return '';
  if (!player) return `${item.label}：${item.description}`;
  if (item.cellTooltip === false) return '';
  if (item.observed && player[item.observed] !== player[item.denominator]) return '—';
  if (item.numerator && item.denominator) return `${player[item.numerator] ?? '—'}/${player[item.denominator] ?? '—'}`;
  return formatMetric(item, player[item.key]);
}
export function sortPlayers(players, key = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction) {
  const allowed = key === 'nickname' || METRICS.some((item) => item.key === key);
  if (!allowed || !['asc', 'desc'].includes(direction)) throw new Error('排序指标或方向不正确');
  return [...players].sort((a, b) => {
    const x = a[key], y = b[key];
    const missingX = x === null || x === undefined || (typeof x === 'number' && !Number.isFinite(x));
    const missingY = y === null || y === undefined || (typeof y === 'number' && !Number.isFinite(y));
    if (missingX !== missingY) return missingX ? 1 : -1;
    const difference = missingX ? 0 : key === 'nickname' ? x.localeCompare(y, 'zh-CN') : x - y;
    return difference ? difference * (direction === 'desc' ? -1 : 1) : String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
  });
}
