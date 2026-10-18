import { formatMetric } from '/metrics.js';
const $ = (id) => document.getElementById(id);

export function createTeamTable({ post, refresh }) {
  let state, signature = '', pending = false, direction = 'desc', contestId, error = '', lastFetchedAt;
  function render(next) {
    state = next;
    if (contestId !== state.contest.contest_id) { contestId = state.contest.contest_id; direction = 'desc'; error = ''; signature = ''; }
    if (lastFetchedAt !== state.teamInfo?.fetchedAt) { lastFetchedAt = state.teamInfo?.fetchedAt; error = ''; }
    $('sync-teams').disabled = pending || state.busy || !state.session.ready;
    $('sync-teams').textContent = pending ? '正在同步…' : '同步队伍';
    $('team-sort').textContent = `PT ${direction === 'desc' ? '↓' : '↑'}`;
    $('team-sort').parentElement.setAttribute('aria-sort', direction === 'desc' ? 'descending' : 'ascending');
    $('teams-empty').hidden = Boolean(state.teams?.length);
    $('team-table-wrap').hidden = !state.teams?.length;
    const source = state.teamInfo?.fetchedAt ? `队伍名单更新于 ${new Date(state.teamInfo.fetchedAt).toLocaleString('zh-CN')}。` : '同步队伍后显示队名和队伍 PT。';
    $('team-status').textContent = error || state.teamError || `${source}${state.teamInfo?.unassignedCount ? ` ${state.teamInfo.unassignedCount} 位已参赛选手尚无队伍信息。` : ''}`;
    $('team-status').classList.toggle('error', Boolean(error || state.teamError));
    const nextSignature = JSON.stringify([state.teams, direction]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    $('teams').replaceChildren();
    const ordered = [...(state.teams || [])].sort((a, b) => (a.totalPt === null) - (b.totalPt === null) || ((a.totalPt ?? 0) - (b.totalPt ?? 0)) * (direction === 'desc' ? -1 : 1) || a.id - b.id);
    for (const team of ordered) {
      const row = document.createElement('tr');
      const rank = document.createElement('td'); rank.className = 'team-rank'; rank.textContent = team.rank;
      const name = document.createElement('th'); name.scope = 'row'; name.textContent = team.name; name.className = 'team-name';
      const pt = document.createElement('td'); pt.textContent = formatMetric({ type: 'pt' }, team.totalPt); if (team.totalPt < 0) pt.classList.add('negative-pt');
      const gap = document.createElement('td'), gapValue = document.createElement('span');
      gapValue.className = 'team-gap-value'; gapValue.textContent = formatMetric({ type: 'pt' }, team.gapToPrevious); gap.append(gapValue);
      row.append(rank, name, pt, gap); $('teams').append(row);
    }
  }
  $('team-sort').addEventListener('click', () => { direction = direction === 'desc' ? 'asc' : 'desc'; render(state); });
  $('sync-teams').addEventListener('click', async () => {
    if (pending || state.busy) return;
    pending = true; error = ''; render(state);
    try { await post('/api/teams/sync', { contestId }); }
    catch (reason) { error = reason.message; }
    finally { pending = false; await refresh(); render(state); }
  });
  return { render };
}
