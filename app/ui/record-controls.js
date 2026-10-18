import { filterReplays } from '/record-list.js';
import { createReplayDetailLoader } from '/replay-details.js';
const $ = (id) => document.getElementById(id);

export function createRecordControls({ post, refresh, onError }) {
  let state, contestId, signature = '', pending = false, action;
  const dialog = $('record-confirmation');
  const detailLoader = createReplayDetailLoader({ post });
  const expanded = new Set();
  const initialFilters = new URLSearchParams(window.location.search);
  for (const [id, key] of [['record-from', 'from'], ['record-to', 'to'], ['record-player', 'player']]) $(id).value = initialFilters.get(key) || '';
  function render(next) {
    state = next;
    const selected = state.contest.contest_id;
    if (contestId !== selected) {
      if (contestId !== undefined && contestId !== selected) {
        for (const id of ['record-from', 'record-to', 'record-player']) $(id).value = '';
        expanded.clear();
      }
      contestId = selected;
      dialog.close(); action = null;
    }
    $('record-scope').textContent = `比赛 ${selected} · ${state.recordCount} 份本地牌谱`;
    const disabled = state.busy || pending;
    $('clear-records').disabled = disabled || !(state.recordCount || state.sync || state.job || state.cacheErrors?.length);
    const last = state.trash?.[0];
    $('restore-records').hidden = !last;
    $('restore-records').disabled = disabled;
    $('restore-records').title = last ? `${new Date(last.createdAt).toLocaleString('zh-CN')} ${last.action === 'clear' ? '清空' : '删除'}的 ${last.replayCount} 份牌谱` : '';
    $('record-notice').hidden = !state.recordNotice;
    $('record-notice').textContent = state.recordNotice || '';
    const filters = { from: $('record-from').value, to: $('record-to').value, player: $('record-player').value };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const search = params.toString();
    const path = `/records${search ? `?${search}` : ''}`;
    if (window.location.pathname + window.location.search !== path) window.history.replaceState(null, '', path);
    let games = [], filterError = '';
    try { games = filterReplays(state.games, filters); } catch (error) { filterError = error.message; }
    $('record-filter-error').hidden = !filterError;
    $('record-filter-error').textContent = filterError;
    $('record-result-count').textContent = `显示 ${games.length} / ${state.games.length} 份牌谱`;
    $('replays-empty').hidden = Boolean(games.length) || Boolean(filterError);
    $('replays-empty').textContent = state.games.length ? '没有符合筛选条件的牌谱。' : '当前比赛还没有本地牌谱。';
    const nextSignature = JSON.stringify([selected, state.games, filters, filterError]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      $('replays').replaceChildren();
      for (const game of games) {
        const row = document.createElement('div'); row.className = 'replay';
        const content = document.createElement('div'); content.className = 'replay-content';
        const title = document.createElement('div'); title.className = 'replay-title'; title.textContent = `${game.startTime ? new Date(game.startTime * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '时间未知'} · ${game.roundCount} 小局`;
        const players = document.createElement('div'); players.className = 'replay-players'; players.textContent = game.players.map((player) => player.nickname).join(' / ');
        const details = document.createElement('details'); details.className = 'replay-detail'; details.dataset.uuid = game.uuid; details.open = expanded.has(game.uuid);
        const summary = document.createElement('summary'); summary.textContent = '详细信息';
        const detailBody = document.createElement('div'); detailBody.className = 'replay-detail-body';
        details.append(summary, detailBody);
        const selectedContest = contestId;
        details.addEventListener('toggle', () => { if (details.open) detailLoader.load(detailBody, selectedContest, game.uuid); });
        const button = document.createElement('button'); button.className = 'text-button delete-record';
        button.dataset.uuid = game.uuid; button.textContent = '删除'; button.setAttribute('aria-label', `删除牌谱 ${game.uuid}`);
        content.append(title, players, details); row.append(content, button); $('replays').append(row);
      }
    }
    for (const button of $('replays').querySelectorAll('button.delete-record')) button.disabled = disabled;
  }
  async function perform(path, data) {
    pending = true; render(state);
    try { await post(path, data); await refresh(); }
    catch (error) { onError(error.message); }
    finally { pending = false; render(state); }
  }
  function confirmDeletion(uuid) {
    if (state.busy || pending) return;
    const game = uuid ? state.games.find((game) => game.uuid === uuid) : null;
    if (uuid && !game) return;
    action = { path: uuid ? '/api/records/delete' : '/api/records/clear', data: { contestId, uuid, confirmed: true } };
    $('record-confirmation-title').textContent = uuid ? '删除这份牌谱？' : `清空比赛 ${contestId} 的记录？`;
    $('record-confirmation-detail').textContent = uuid
      ? `比赛 ${contestId} · ${new Date(game.startTime * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n${game.players.map((player) => player.nickname).join(' / ')}\n${uuid}\n删除后，这份牌谱将不再计入选手统计。`
      : `将移除本比赛的 ${state.recordCount} 份本地牌谱，并清空统计和同步进度。其他比赛的数据保留。`;
    $('confirm-record-action').textContent = uuid ? '确认删除' : '确认清空';
    dialog.showModal(); $('cancel-record-action').focus();
  }
  $('record-filters').addEventListener('submit', (event) => event.preventDefault());
  for (const id of ['record-from', 'record-to', 'record-player']) $(id).addEventListener('input', () => { if (state) render(state); });
  $('clear-record-filters').addEventListener('click', () => { for (const id of ['record-from', 'record-to', 'record-player']) $(id).value = ''; if (state) render(state); });
  $('replays').addEventListener('toggle', (event) => {
    const target = event.target;
    if (target.matches('details[data-uuid]') && target.isConnected) { if (target.open) expanded.add(target.dataset.uuid); else expanded.delete(target.dataset.uuid); }
  }, true);
  $('replays').addEventListener('click', (event) => { const button = event.target.closest('button[data-uuid]'); if (button) confirmDeletion(button.dataset.uuid); });
  $('clear-records').addEventListener('click', () => confirmDeletion());
  $('restore-records').addEventListener('click', async () => {
    if (state.busy || pending || !state.trash?.length) return;
    await perform('/api/records/restore', { contestId, batchId: state.trash[0].id });
  });
  $('cancel-record-action').addEventListener('click', () => { action = null; dialog.close(); });
  dialog.addEventListener('cancel', () => { action = null; });
  $('confirm-record-action').addEventListener('click', async () => {
    if (!action || pending) return;
    const confirmed = action; action = null; dialog.close();
    await perform(confirmed.path, confirmed.data);
  });
  return { render };
}
