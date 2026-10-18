const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export function replayDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp * 1000).getTime())) return '';
  const parts = dateFormat.formatToParts(new Date(timestamp * 1000));
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
}
function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
export function filterReplays(games, { from = '', to = '', player = '' } = {}) {
  if ((from && !validDate(from)) || (to && !validDate(to))) throw new Error('请输入有效的日期');
  if (from && to && from > to) throw new Error('开始日期不能晚于结束日期');
  const query = player.trim().toLocaleLowerCase('zh-CN');
  return games.filter((game) => {
    const date = replayDate(game.startTime);
    if ((from || to) && !date) return false;
    if ((from && date < from) || (to && date > to)) return false;
    return !query || game.players.some((member) => (member.nickname || '').toLocaleLowerCase('zh-CN').includes(query) || (member.accountId && String(member.accountId).includes(query)));
  }).sort((a, b) => (b.startTime || 0) - (a.startTime || 0) || a.uuid.localeCompare(b.uuid));
}
