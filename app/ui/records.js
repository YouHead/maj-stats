import { createRecordControls } from '/record-controls.js';
const $ = (id) => document.getElementById(id);
let userNotice = '';
function notice(message) { $('page-status').textContent = message; $('page-status').hidden = !message; }
async function post(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作未完成，请重试');
  return result;
}
const records = createRecordControls({ post, refresh: async () => { userNotice = ''; await update(); }, onError: (message) => { userNotice = message; notice(message); } });
async function update() {
  try {
    const response = await fetch('/api/state'); if (!response.ok) throw new Error();
    const state = await response.json();
    $('app-version').textContent = state.application?.version ? `v${state.application.version}` : '';
    $('records-contest-name').textContent = state.contest?.contest_name || '';
    records.render(state);
    notice(userNotice || (state.busy ? '正在更新比赛记录，完成后自动刷新。' : ''));
  } catch (_) { notice('本地服务暂时不可用，请重新打开软件。'); }
}
await update();
setInterval(update, 1200);
