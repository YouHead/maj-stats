import { parseShareLink } from './share-links.mjs';

/** Follow server cursors to the explicit end, retaining overlaps only once. */
export async function listContestRecords({ protocol, request, contestUid, onPage = async () => {}, checkStopped = () => {} }) {
  const records = new Map();
  const cursors = new Set();
  let cursor = 0;
  let duplicates = 0;
  for (let page = 1; page <= 10000; page++) {
    checkStopped();
    if (cursors.has(cursor)) throw new Error('雀魂返回了重复的分页位置，列表未读完，请重新同步');
    cursors.add(cursor);
    const response = protocol.decode('lq.ResFetchCustomizedContestGameRecords', await request(protocol.contestRecordsRequest(contestUid, cursor)));
    if (response.error?.code) {
      const error = new Error(response.error.code === 1004 ? '登录会话不可用，请重新登录后重试' : `读取比赛牌谱列表失败（错误 ${response.error.code}）`);
      error.code = response.error.code;
      throw error;
    }
    if (!Array.isArray(response.record_list)) throw new Error('比赛牌谱列表响应格式不正确');
    for (const record of response.record_list) {
      const { uuid } = parseShareLink(record.uuid);
      if (uuid !== record.uuid?.toLowerCase()) throw new Error('比赛列表含有无效的牌谱编号');
      if (record.config?.meta?.contest_uid && record.config.meta.contest_uid !== contestUid) throw new Error('比赛列表中出现了其他比赛的牌谱，已停止同步');
      if (records.has(uuid)) duplicates++;
      else records.set(uuid, { uuid, startTime: record.start_time, endTime: record.end_time });
    }
    const next = response.next_index;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('比赛列表的分页位置不正确');
    const complete = next === 0;
    await onPage({ records: [...records.values()], pages: page, duplicateEntries: duplicates, nextIndex: next, paginationComplete: complete });
    if (complete) return { records: [...records.values()], pages: page, duplicateEntries: duplicates };
    if (!response.record_list.length) throw new Error('雀魂返回了空的中间页，列表未读完，请重新同步');
    cursor = next;
  }
  throw new Error('比赛列表分页过多，已停止同步，尚未确认完整性');
}
