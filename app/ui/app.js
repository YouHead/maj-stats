import { createStatisticsTable } from '/table.js';
import { createContestControls } from '/contest-controls.js';
import { createTeamTable } from '/teams.js';
const $ = (id) => document.getElementById(id);
const statisticsTable = createStatisticsTable();
const teamTable = createTeamTable({ post, refresh: () => update() });
let busy = false;
let previousSignature = '';
let userNotice = '';
const contestControls = createContestControls({ post, refresh: async () => { userNotice = ''; await update(); }, onError: (message) => { userNotice = message; notice(message, true); } });
async function post(path, data = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作未完成，请重试');
  return result;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function render(state) {
  busy = state.busy;
  $('app-version').textContent = state.application?.version ? `v${state.application.version}` : '';
  $('open-data').hidden = !state.application?.storageRoot;
  $('open-data').title = state.application?.storageRoot || '';
  const session = state.session;
  $('session-dot').classList.toggle('green', session.ready);
  $('session-label').textContent = session.ready ? session.nickname || '已登录' : '未登录';
  $('login').textContent = session.ready ? '查看登录窗口' : session.phase === 'loading' ? '正在打开…' : '登录雀魂';
  $('logout').hidden = !session.ready;
  $('audio-status').hidden = !session.audioMuted;
  $('contest-name').textContent = state.contest?.contest_name || '尚未同步，导入时核对比赛信息';
  $('import').disabled = state.busy;
  $('import-contest').disabled = state.busy;
  $('import-contest').textContent = state.busy && state.job?.kind === 'contest' ? '正在同步比赛…' : `一键导入比赛 ${state.contest.contest_id}`;
  $('stop-import').hidden = !state.busy || state.mutating;
  $('stop-import').disabled = Boolean(state.job?.cancelRequested);
  $('stop-import').textContent = state.job?.cancelRequested ? '正在停止…' : '停止导入';
  $('import').textContent = state.busy ? '正在导入…' : '导入并统计 ↗';
  const { summary } = state;
  $('game-count').textContent = summary.gameCount;
  $('round-count').textContent = summary.roundCount;
  $('player-count').textContent = summary.players.length;
  $('coverage').textContent = summary.gameCount ? `${summary.gameCount} 份牌谱 · ${summary.roundCount} 局` : '等待导入';
  $('empty').hidden = Boolean(summary.gameCount);
  $('table-wrap').hidden = !summary.gameCount;
  statisticsTable.render(state);
  teamTable.render(state);
  contestControls.render(state);
  const sync = state.sync;
  const job = state.job;
  const completedItems = job?.items.filter((item) => ['done', 'cached', 'failed'].includes(item.status)).length || 0;
  if (state.busy && job?.phase === 'listing') $('sync-status').textContent = `正在读取比赛列表：已读取 ${job.pages} 页，发现 ${job.listedCount} 份不同牌谱。`;
  else if (sync) $('sync-status').textContent = `${sync.allImported ? '已导入此次查询的全部牌谱' : '比赛导入尚未完成'}：${sync.importedCount} / ${sync.listedCount} 份，${sync.pages} 页${sync.paginationComplete ? '，已读到最后一页' : '，尚未读完列表'}。${sync.listedAt ? `查询时间 ${new Date(sync.listedAt).toLocaleString('zh-CN')}；再次同步可补齐新增对局。` : ''}`;
  else $('sync-status').textContent = '尚未同步比赛列表，当前仅统计已导入的分享链接。';
  $('sync-progress').hidden = !state.busy || job?.kind !== 'contest';
  if (job?.phase === 'listing') $('sync-progress').removeAttribute('value');
  else { $('sync-progress').max = job?.items.length || 1; $('sync-progress').value = completedItems; }
  const signature = JSON.stringify([summary, job, state.games, state.cacheErrors]);
  if (signature !== previousSignature) {
    previousSignature = signature;
    $('jobs').replaceChildren();
    for (const item of state.job?.items || []) {
      const div = document.createElement('div'); div.className = `job ${item.status}`;
      const uuid = document.createElement('span'); uuid.className = 'id'; uuid.textContent = item.uuid;
      const message = document.createElement('span'); message.textContent = item.message || ({ waiting: '等待下载', downloading: '正在下载', analyzing: '正在统计' }[item.status]);
      div.append(uuid, message); $('jobs').append(div);
    }
    for (const error of [...(state.job?.errors || []), ...(state.cacheErrors || [])]) {
      const div = document.createElement('div'); div.className = 'job failed';
      div.textContent = `${error.line ? `第 ${error.line} 行：` : ''}${error.message}`;
      $('jobs').append(div);
    }
  }
  if (userNotice) return;
  if (state.mutating) notice('正在更新本地记录和统计…');
  else if (state.busy) notice(job?.phase === 'listing' ? '正在逐页读取比赛牌谱列表，读完后自动下载和统计。' : `正在下载并统计：已处理 ${completedItems} / ${job?.items.length || 0} 份，成功结果会自动更新。`);
  else if (state.recordNotice) notice(state.recordNotice);
  else if (job?.error) notice(job.error, job.phase !== 'stopped');
  else if (job?.kind === 'contest' && job.complete) {
    const added = job.items.filter((item) => item.status === 'done').length;
    const cached = job.items.filter((item) => item.status === 'cached').length;
    const failed = job.items.filter((item) => item.status === 'failed').length;
    notice(`比赛同步${failed ? '结束' : '完成'}：新增 ${added} 份，复用 ${cached} 份缓存，失败 ${failed} 份。${failed ? '再次一键导入可重试未完成的牌谱。' : ''}`, Boolean(failed));
  }
  else if (state.job?.complete) {
    const failed = state.job.items.filter((item) => item.status === 'failed').length;
    const invalid = state.job.errors?.length || 0;
    const skipped = state.job.duplicates;
    notice(failed || invalid ? `有 ${failed} 份牌谱未能完成，${invalid} 条输入无效，成功结果已保留。` : `导入完成，结果已更新。${skipped ? `跳过 ${skipped} 条重复链接。` : ''}`, Boolean(failed || invalid));
  } else if (session.ready) notice('登录成功。粘贴分享链接，点击“导入并统计”即可。');
  else if (session.phase === 'load-failed') notice('雀魂登录页面未能加载，请检查网络后再次点击“登录雀魂”。', true);
  else notice('首次使用请点击右上角“登录雀魂”，在打开的官方页面完成登录。');
}
$('login').addEventListener('click', async () => { try { userNotice = ''; await post('/api/login'); notice('请在打开的雀魂官方窗口中完成登录，完成后此处会自动更新。'); } catch (error) { notice(error.message, true); } });
$('logout').addEventListener('click', async () => { try { userNotice = ''; await post('/api/logout'); await update(); } catch (error) { notice(error.message, true); } });
$('import').addEventListener('click', async () => {
  if (busy) return;
  try { userNotice = ''; await post('/api/import', { text: $('links').value }); await update(); }
  catch (error) { userNotice = error.message; notice(error.message, true); }
});
$('import-contest').addEventListener('click', async () => {
  if (busy) return;
  try { userNotice = ''; await post('/api/contest/import'); await update(); }
  catch (error) { userNotice = error.message; notice(error.message, true); }
});
$('stop-import').addEventListener('click', async () => {
  try { await post('/api/import/stop'); await update(); }
  catch (error) { userNotice = error.message; notice(error.message, true); }
});
$('links').addEventListener('input', () => { userNotice = ''; });
$('open-data').addEventListener('click', async () => { try { await post('/api/data/open'); } catch (error) { userNotice = error.message; notice(error.message, true); } });
async function update() { try { render(await (await fetch('/api/state')).json()); } catch (_) { notice('本地服务暂时不可用，请重新打开软件。', true); } }
await update();
setInterval(update, 1200);
