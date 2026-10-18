import { formatMetric } from '/metrics.js';
import { scoreChartScale } from '/score-chart.js';

const node = (tag, className = '', text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const svgNode = (tag, attributes = {}, text) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
};
const pointsText = (value) => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
const outcomeText = { win: '和牌', draw: '流局', nagashi: '流局满贯', 'abortive-draw': '途中流局' };

function scoreChart(data) {
  const figure = node('figure', 'replay-score-chart');
  const heading = node('figcaption', 'score-chart-heading');
  heading.append(node('h3', '', '点数变化'), node('p', '', '开局与每小局结算后的持点'));
  figure.append(heading);
  const history = data.scoreHistory.points, scale = scoreChartScale(history);
  if (!scale) { figure.append(node('p', 'record-help', '这份牌谱缺少可用的点数记录。')); return figure; }
  const width = 960, height = 720, left = 92, right = 22, top = 25, bottom = 62;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index) => left + index * plotWidth / Math.max(1, history.length - 1);
  const y = (score) => top + (scale.max - score) * plotHeight / (scale.max - scale.min);
  const chart = svgNode('svg', { class: 'score-chart-svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '四位选手点数随小局变化，横轴为小局，纵轴为点数' });
  chart.append(svgNode('title', {}, '点数变化：可用鼠标或左右方向键查看每小局点数，点击图例可隐藏选手曲线。'));
  for (const tick of scale.ticks) {
    chart.append(svgNode('line', { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'score-grid score-zero' : 'score-grid' }));
    chart.append(svgNode('text', { x: left - 12, y: y(tick) + 6, 'text-anchor': 'end', class: 'score-axis-text' }, pointsText(tick)));
  }
  const stride = Math.max(1, Math.ceil((history.length - 1) / 8));
  history.forEach((point, index) => {
    if (index % stride && index !== history.length - 1) return;
    chart.append(svgNode('line', { x1: x(index), x2: x(index), y1: top, y2: height - bottom, class: 'score-grid score-grid-vertical' }));
    const label = point.phase === 'settlement' ? '终局结算' : point.label.replace('本场', '');
    chart.append(svgNode('text', { x: x(index), y: height - bottom + 25, 'text-anchor': index === history.length - 1 ? 'end' : index === 0 ? 'start' : 'middle', class: 'score-axis-text' }, label));
  });
  const legend = node('div', 'score-legend');
  const groups = new Map();
  for (const player of data.players) {
    const group = svgNode('g', { class: `score-series score-color-${player.seat}` });
    let path = '', connected = false;
    history.forEach((point, index) => {
      const score = point.scores[player.seat];
      if (!Number.isFinite(score)) { connected = false; return; }
      path += `${connected ? 'L' : 'M'}${x(index).toFixed(2)},${y(score).toFixed(2)} `; connected = true;
      group.append(svgNode('circle', { cx: x(index), cy: y(score), r: 2.2, class: 'score-point' }));
    });
    group.prepend(svgNode('path', { d: path.trim(), class: 'score-line' }));
    chart.append(group); groups.set(player.seat, group);
    const button = node('button', `score-legend-button score-color-${player.seat}`);
    button.type = 'button'; button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', `${player.nickname}曲线`);
    button.append(node('span', 'score-swatch'), node('span', '', player.nickname));
    button.addEventListener('click', () => {
      const hidden = group.classList.toggle('is-hidden');
      button.classList.toggle('is-off', hidden); button.setAttribute('aria-pressed', String(!hidden));
    });
    legend.append(button);
  }
  const crosshair = svgNode('line', { class: 'score-crosshair', y1: top, y2: height - bottom });
  chart.append(crosshair);
  const readout = node('div', 'score-readout'); readout.setAttribute('aria-live', 'polite'); readout.setAttribute('aria-atomic', 'true');
  const readoutTitle = node('div', 'score-readout-title'), values = node('div', 'score-readout-values');
  readout.append(readoutTitle, values);
  const hits = [];
  function inspect(index) {
    const point = history[index];
    if (point.phase === 'round-end') readoutTitle.replaceChildren(node('span', 'score-readout-round', `第 ${point.roundIndex} 小局`), node('span', 'score-readout-hand', `${point.label} · ${outcomeText[point.outcome] || '结束'}`));
    else readoutTitle.textContent = point.label;
    crosshair.setAttribute('x1', x(index)); crosshair.setAttribute('x2', x(index));
    hits.forEach((hit, position) => hit.setAttribute('tabindex', position === index ? '0' : '-1'));
    values.replaceChildren();
    for (const player of data.players) {
      const value = node('span', `score-readout-player score-color-${player.seat}`);
      value.append(node('span', '', player.nickname), node('strong', '', pointsText(point.scores[player.seat]))); values.append(value);
    }
  }
  history.forEach((point, index) => {
    const half = plotWidth / Math.max(1, history.length - 1) / 2;
    const start = Math.max(left, x(index) - half), end = Math.min(width - right, x(index) + half);
    const hit = svgNode('rect', { x: start, y: top, width: Math.max(1, end - start), height: plotHeight, class: 'score-chart-hit', tabindex: '-1', 'aria-label': `${point.label}，${data.players.map((player) => `${player.nickname} ${pointsText(point.scores[player.seat])}点`).join('，')}` });
    hit.addEventListener('pointerenter', () => inspect(index));
    hit.addEventListener('focus', () => inspect(index));
    hit.addEventListener('click', () => inspect(index));
    hit.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? history.length - 1 : Math.max(0, Math.min(history.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      hits[next].focus();
    });
    hits.push(hit); chart.append(hit);
  });
  inspect(history.length - 1);
  const scroll = node('div', 'score-chart-scroll'); scroll.append(chart);
  const layout = node('div', 'score-chart-layout'); layout.append(scroll, readout);
  figure.append(legend, layout);
  if (!data.scoreHistory.complete) figure.append(node('p', 'record-help', '部分小局点数缺失，折线在缺失处断开。'));
  return figure;
}

function renderDetails(target, data, onOpen) {
  target.replaceChildren();
  const toolbar = node('div', 'replay-detail-toolbar');
  const counts = node('dl', 'replay-kpis');
  for (const [label, value] of [['总局数', data.roundCount], ['流局数', data.drawCount], ['途中流局', data.abortiveDrawCount]]) {
    const item = node('div'); item.append(node('dt', '', label), node('dd', '', `${value} 局`)); counts.append(item);
  }
  const open = node('button', 'button secondary open-replay', '打开牌谱 ↗'); open.type = 'button';
  const openStatus = node('p', 'replay-open-status'); openStatus.setAttribute('role', 'status');
  open.addEventListener('click', async () => {
    open.disabled = true; openStatus.textContent = '';
    try { await onOpen(data.uuid); openStatus.textContent = '已在软件内的雀魂窗口打开牌谱。'; }
    catch (error) { openStatus.textContent = error.message; }
    finally { open.disabled = false; }
  });
  toolbar.append(counts, open); target.append(toolbar, openStatus);
  const wrap = node('div', 'replay-detail-table-wrap');
  const table = node('table', 'replay-detail-table'), head = node('thead'), header = node('tr');
  table.append(node('caption', '', '本场选手表现'));
  for (const label of ['选手', '顺位 / 终局点数 / PT', '立直次数', '和牌次数', '放铳次数']) { const th = node('th', '', label); th.scope = 'col'; header.append(th); }
  head.append(header); table.append(head);
  const body = node('tbody');
  for (const player of data.players) {
    const row = node('tr'), name = node('th'); name.scope = 'row';
    const nameLine = node('span', 'replay-player-name'); nameLine.append(node('i', `score-swatch score-color-${player.seat}`), node('span', '', player.nickname));
    name.append(nameLine, node('span', 'sub', player.accountId ? `ID ${player.accountId}` : '电脑'));
    row.append(name);
    const result = node('td', 'replay-result');
    const score = node('div', 'replay-result-score');
    score.append(node('span', 'replay-rank', `${player.rank} 位`), node('strong', '', pointsText(player.finalScore)));
    result.append(score, node('span', `replay-result-pt${player.pt < 0 ? ' negative-pt' : ''}`, `${formatMetric({ type: 'pt' }, player.pt)} PT`));
    row.append(result);
    for (const value of [player.riichiCount, player.winCount, player.dealInCount]) {
      row.append(node('td', '', value));
    }
    body.append(row);
  }
  table.append(body); wrap.append(table); target.append(wrap, scoreChart(data), node('code', 'replay-detail-uuid', data.uuid));
}

export function createReplayDetailLoader({ post }) {
  const cache = new Map(), pending = new Map();
  async function load(target, contestId, uuid) {
    const key = `${contestId}:${uuid}`;
    if (target.dataset.loaded === key || target.dataset.loading === key) return;
    target.dataset.loading = key; target.setAttribute('aria-busy', 'true');
    target.replaceChildren(node('p', 'record-help', '正在读取本地牌谱详情…'));
    try {
      if (!cache.has(key)) {
        if (!pending.has(key)) pending.set(key, (async () => {
          const response = await fetch(`/api/records/detail?${new URLSearchParams({ contestId, uuid })}`);
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '详情读取失败，请重试');
          cache.set(key, result); return result;
        })().finally(() => pending.delete(key)));
        await pending.get(key);
      }
      if (target.isConnected) {
        renderDetails(target, cache.get(key), (uuid) => post('/api/records/open', { contestId, uuid }));
        target.dataset.loaded = key;
      }
    } catch (error) {
      if (target.isConnected) {
        const retry = node('button', 'button secondary', '重试'); retry.type = 'button'; retry.addEventListener('click', () => load(target, contestId, uuid));
        target.replaceChildren(node('p', 'notice error', error.message), retry);
      }
    } finally { delete target.dataset.loading; target.removeAttribute('aria-busy'); }
  }
  return { load };
}
