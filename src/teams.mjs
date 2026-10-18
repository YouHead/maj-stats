import { rankTeams } from './team-ranking.mjs';

async function readPages({ protocol, request, type, makeRequest, key, checkStopped }) {
  const entries = new Map();
  let offset = 0, total;
  for (let page = 0; page < 400; page++) {
    checkStopped();
    const result = protocol.decode(type, await request(makeRequest(offset)));
    if (result.error?.code) throw new Error(`队伍信息暂时无法读取（错误 ${result.error.code}）`);
    if (!Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.rank)) throw new Error('队伍列表格式不正确');
    if (total !== undefined && total !== result.total) throw new Error('队伍名单在查询时发生变化，请重试');
    total = result.total;
    const before = entries.size;
    for (const entry of result.rank) {
      if (!Number.isSafeInteger(entry[key]) || entry[key] <= 0) throw new Error('队伍或成员编号不正确');
      entries.set(entry[key], entry);
    }
    if (entries.size > total) throw new Error('队伍列表数量不一致，请重试');
    if (entries.size === total) return [...entries.values()];
    if (!result.rank.length || entries.size === before) throw new Error('队伍列表尚未读完，已保留上次结果，请重试');
    offset += result.rank.length;
  }
  throw new Error('队伍列表分页过多，请重试');
}

export function validTeamRoster(roster, contestId, contestUid) {
  if (!roster || roster.contestId !== contestId || roster.contestUid !== contestUid || !Array.isArray(roster.teams)) return false;
  const ids = new Set(), members = new Set();
  for (const team of roster.teams) {
    if (!Number.isSafeInteger(team.id) || team.id <= 0 || ids.has(team.id) || typeof team.name !== 'string' || !team.name.trim() || !Array.isArray(team.members)) return false;
    ids.add(team.id);
    for (const member of team.members) {
      if (!Number.isSafeInteger(member.accountId) || member.accountId <= 0 || members.has(member.accountId)) return false;
      members.add(member.accountId);
    }
  }
  return true;
}

export async function fetchContestTeams({ protocol, request, contestId, contestUid, checkStopped = () => {} }) {
  const common = { protocol, request, checkStopped };
  const teams = await readPages({ ...common, type: 'lq.ResFetchContestTeamRank', key: 'team_id', makeRequest: (offset) => protocol.contestTeamsRequest(contestUid, offset) });
  const assigned = new Set();
  const roster = [];
  for (const team of teams) {
    const members = await readPages({ ...common, type: 'lq.ResFetchContestTeamMember', key: 'account_id', makeRequest: (offset) => protocol.contestTeamMembersRequest(contestUid, team.team_id, offset) });
    for (const member of members) {
      if (assigned.has(member.account_id)) throw new Error('同一选手出现在多个队伍中，已保留上次名单，请重试');
      assigned.add(member.account_id);
    }
    roster.push({ id: team.team_id, name: team.name || `队伍 ${team.team_id}`, members: members.map(({ account_id, nickname }) => ({ accountId: account_id, nickname })) });
  }
  return { contestId, contestUid, fetchedAt: new Date().toISOString(), source: 'official', teams: roster };
}

export function applyTeams(summary, roster) {
  const membership = new Map();
  for (const team of roster?.teams || []) for (const member of team.members) membership.set(member.accountId, team);
  const players = summary.players.map((player) => {
    const team = membership.get(player.accountId);
    return { ...player, teamId: team?.id ?? null, teamName: team?.name || '' };
  });
  const teams = (roster?.teams || []).map((team) => {
    const members = players.filter((player) => player.teamId === team.id);
    const complete = members.length > 0 && members.every((player) => player.ptObservedGames === player.games);
    const raw = members.reduce((sum, player) => sum + player.ptRawSum, 0);
    return { id: team.id, name: team.name, memberCount: team.members.length, importedMemberCount: members.length, games: members.reduce((sum, player) => sum + player.games, 0), totalPt: complete ? raw / 1000 : null, members: members.map(({ accountId, nickname }) => ({ accountId, nickname })) };
  });
  return { summary: { ...summary, players }, teams: rankTeams(teams), teamInfo: { fetchedAt: roster?.fetchedAt || null, source: roster?.source || '', unassignedCount: players.filter((player) => !player.teamId).length } };
}
