import { METRICS, DEFAULT_SORT, visibleMetrics, formatMetric, metricTooltip, sortPlayers } from '/metrics.js';

const $ = (id) => document.getElementById(id);
export function createStatisticsTable() {
  let state, signature = '', headerSignature = '', sortKey = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction;
  let tooltipTarget = null;
  const tooltip = $('metric-tooltip');
  const wrap = $('table-wrap');
  function hideTooltip() {
    tooltip.hidden = true;
    tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = null;
  }
  function showTooltip(target) {
    const item = METRICS.find((item) => item.key === target.dataset.metricKey);
    if (!item || item.type === 'pt') { hideTooltip(); return; }
    hideTooltip();
    const player = state?.summary.players.find((player) => player.key === target.dataset.playerKey);
    const text = metricTooltip(item, player);
    if (!text) return;
    tooltipTarget = target;
    tooltip.classList.toggle('compact', Boolean(player));
    tooltip.textContent = text;
    tooltip.hidden = false;
    target.setAttribute('aria-describedby', 'metric-tooltip');
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 10))}px`;
    const below = rect.bottom + 8;
    tooltip.style.top = `${Math.max(8, below + tooltip.offsetHeight <= window.innerHeight ? below : rect.top - tooltip.offsetHeight - 8)}px`;
  }
  function changeSort(key) {
    direction = key === sortKey ? direction === 'asc' ? 'desc' : 'asc' : key === 'nickname' ? 'asc' : 'desc';
    sortKey = key;
    render(state);
  }
  function render(next) {
    if (!next) return;
    if (state?.contest?.contest_id !== next.contest?.contest_id) { $('player-search').value = ''; wrap.scrollTop = 0; wrap.scrollLeft = 0; sortKey = DEFAULT_SORT.key; direction = DEFAULT_SORT.direction; }
    state = next;
    const detailed = $('show-details').checked;
    const metrics = visibleMetrics(detailed);
    if (sortKey !== 'nickname' && !metrics.some((item) => item.key === sortKey)) { sortKey = DEFAULT_SORT.key; direction = DEFAULT_SORT.direction; }
    $('table-controls').hidden = !state.summary.gameCount;
    $('table-hint').hidden = !state.summary.gameCount;
    $('table-hint').textContent = detailed ? '横向滚动查看更多指标，选手名与表头保持固定。PT 仅累计已导入牌谱。' : '默认按 PT 排名，开启详细指标后可查看更多表现。PT 仅累计已导入牌谱。';
    const headerKeys = metrics.map((item) => item.key).join(',');
    if (headerKeys !== headerSignature) {
      headerSignature = headerKeys;
      $('metrics-head').replaceChildren();
      const row = document.createElement('tr');
      for (const item of [{ key: 'nickname', label: '选手' }, ...metrics]) {
        const th = document.createElement('th'); th.scope = 'col'; th.dataset.sortKey = item.key;
        if (item.key === 'rounds') th.classList.add('detail-start');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'sort-header'; button.dataset.sortKey = item.key;
        if (item.key !== 'nickname' && item.type !== 'pt') button.dataset.metricKey = item.key;
        button.textContent = item.label; th.append(button); row.append(th);
      }
      $('metrics-head').append(row);
      $('sort-key').replaceChildren();
      for (const item of [{ key: 'nickname', label: '选手名' }, ...metrics]) {
        const option = document.createElement('option'); option.value = item.key; option.textContent = item.label; $('sort-key').append(option);
      }
    }
    for (const th of $('metrics-head').querySelectorAll('th')) {
      const active = th.dataset.sortKey === sortKey;
      th.setAttribute('aria-sort', active ? direction === 'asc' ? 'ascending' : 'descending' : 'none');
      const item = METRICS.find((item) => item.key === th.dataset.sortKey);
      th.firstChild.textContent = `${item?.label || '选手'}${active ? direction === 'asc' ? ' ↑' : ' ↓' : ''}`;
    }
    $('sort-key').value = sortKey;
    $('sort-direction').textContent = direction === 'asc' ? '升序 ↑' : '降序 ↓';
    $('export-excel').href = `/api/export.xlsx?${new URLSearchParams({ sort: sortKey, direction })}`;
    const query = $('player-search').value.trim().toLowerCase();
    const nextSignature = JSON.stringify([state.summary, headerKeys, sortKey, direction, query]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    hideTooltip();
    $('players').replaceChildren();
    const players = sortPlayers(state.summary.players, sortKey, direction).filter((player) => !query || player.nickname.toLowerCase().includes(query) || String(player.accountId || '').includes(query) || player.teamName?.toLowerCase().includes(query));
    for (const player of players) {
      const row = document.createElement('tr'); row.dataset.playerKey = player.key;
      const name = document.createElement('th'); name.scope = 'row'; name.className = 'player-name'; name.title = player.nickname;
      const nickname = document.createElement('span'); nickname.className = 'nickname'; nickname.textContent = player.nickname;
      const id = document.createElement('span'); id.className = 'sub'; id.textContent = player.accountId ? `ID ${player.accountId}` : '电脑';
      const team = document.createElement('span'); team.className = 'player-team'; team.textContent = player.teamName || '未分队'; team.title = player.teamName || '';
      name.append(nickname, id, team); row.append(name);
      for (const item of metrics) {
        const cell = document.createElement('td'); cell.textContent = formatMetric(item, player[item.key]);
        if (item.type !== 'pt' && item.cellTooltip !== false) { cell.dataset.metricKey = item.key; cell.dataset.playerKey = player.key; cell.tabIndex = 0; }
        else if (item.type === 'pt') cell.dataset.pt = 'true';
        if (item.key === 'winRate') cell.className = 'win';
        if (item.key === 'dealInRate') cell.className = 'loss';
        if (item.type === 'pt' && player[item.key] < 0) cell.classList.add('negative-pt');
        if (item.key === 'rounds') cell.classList.add('detail-start');
        row.append(cell);
      }
      $('players').append(row);
    }
    if (!players.length) {
      const row = document.createElement('tr'), cell = document.createElement('td');
      cell.colSpan = metrics.length + 1; cell.className = 'no-matches'; cell.textContent = '没有匹配的选手'; row.append(cell); $('players').append(row);
    }
  }
  $('metrics-head').addEventListener('click', (event) => { const target = event.target.closest('button[data-sort-key]'); if (target) changeSort(target.dataset.sortKey); });
  $('sort-key').addEventListener('change', () => { sortKey = $('sort-key').value; render(state); });
  $('sort-direction').addEventListener('click', () => { direction = direction === 'asc' ? 'desc' : 'asc'; render(state); });
  $('show-details').addEventListener('change', () => render(state));
  $('player-search').addEventListener('input', () => render(state));
  wrap.addEventListener('pointerover', (event) => { const target = event.target.closest('[data-metric-key]'); if (target && target !== tooltipTarget) showTooltip(target); });
  wrap.addEventListener('pointerout', (event) => { if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip(); });
  wrap.addEventListener('focusin', (event) => { const target = event.target.closest('[data-metric-key]'); if (target) showTooltip(target); });
  wrap.addEventListener('focusout', hideTooltip);
  document.addEventListener('scroll', hideTooltip, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); });
  for (const item of METRICS) { const li = document.createElement('li'); li.textContent = `${item.label}：${item.description}`; $('methodology').append(li); }
  const note = document.createElement('li'); note.textContent = '跨牌谱先累计次数再计算比例。没有对应和牌、放铳或荒牌时显示“—”；途中流局单独计数。Excel 始终导出全部选手和全部指标。'; $('methodology').append(note);
  return { render };
}
