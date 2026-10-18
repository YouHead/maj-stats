import { mkdtemp, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadProtocol } from '../../src/protocol.mjs';
import { TournamentManager } from '../../src/tournament-manager.mjs';

export const protocol = await loadProtocol(new URL('../../.cache/', import.meta.url));
export const ids = [7, 8].map((last) => `260101-00000001-0000-4000-8000-00000000000${last}`);
export const contests = [196077, 196078].map((contest_id) => ({ contest_id, unique_id: contest_id + 80000000, contest_name: `本地功能测试（合成）${contest_id}` }));
export const head = (uuid, contest = contests[0]) => ({
  uuid, start_time: 1792210000 + ids.indexOf(uuid), end_time: 1792212000,
  config: { meta: { contest_uid: contest.unique_id } },
  accounts: [0, 1, 2, 3].map((seat) => ({ seat, account_id: seat + 1, nickname: `测试选手 ${seat + 1}` })),
  result: { players: [0, 1, 2, 3].map((seat) => ({ seat, part_point_1: 40000 - seat * 10000, total_point: [53200, 6700, -21100, -38800][seat] })) },
});
const events = [protocol.wrap('.lq.RecordNewRound', { scores: [25000, 25000, 25000, 25000] }), protocol.wrap('.lq.RecordDiscardTile', { seat: 3 }), protocol.wrap('.lq.RecordHule', { hules: [{ seat: 0, point_rong: 8000 }] })];
export const data = protocol.wrap('.lq.GameDetailRecords', { version: 210715, actions: events.map((result) => ({ result })) });
export async function createFixture() {
  const base = new URL('../../.cache/tests/', import.meta.url);
  await mkdir(base, { recursive: true });
  const root = pathToFileURL((await mkdtemp(path.join(fileURLToPath(base), 'record-management-'))) + path.sep);
  const requests = [];
  let activeContest = contests[0];
  const session = {
    status: () => ({ ready: true, nickname: '本地合成测试', audioMuted: true }), poll: async () => ({ ready: true }),
    fetchRecord: async (bytes) => {
      const wrapper = protocol.decode('lq.Wrapper', bytes);
      requests.push(wrapper.name);
      if (wrapper.name.endsWith('fetchCustomizedContestByContestId')) {
        const { contest_id } = protocol.decode('lq.ReqFetchCustomizedContestByContestId', wrapper.data);
        activeContest = contests.find((contest) => contest.contest_id === contest_id);
        if (!activeContest) throw new Error('此合成测试没有配置该比赛');
        return protocol.encode('lq.ResFetchCustomizedContestByContestId', { contest_info: activeContest });
      }
      if (wrapper.name.endsWith('fetchCustomizedContestGameRecords')) return protocol.encode('lq.ResFetchCustomizedContestGameRecords', { record_list: ids.map((uuid) => head(uuid, activeContest)), next_index: 0 });
      if (wrapper.name.endsWith('fetchContestTeamRank')) return protocol.encode('lq.ResFetchContestTeamRank', { total: 2, rank: [{ team_id: 1, name: '合成甲队' }, { team_id: 2, name: '合成乙队' }] });
      if (wrapper.name.endsWith('fetchContestTeamMember')) {
        const request = protocol.decode('lq.ReqFetchContestTeamMember', wrapper.data);
        const accounts = request.team_id === 1 ? [1, 2] : [3, 4];
        return protocol.encode('lq.ResFetchContestTeamMember', { total: 2, rank: accounts.map((account_id) => ({ account_id, nickname: `测试选手 ${account_id}` })) });
      }
      const { game_uuid } = protocol.decode('lq.ReqGameRecord', wrapper.data);
      return protocol.encode('lq.ResGameRecord', { head: head(game_uuid, activeContest), data });
    },
  };
  const options = { protocol, session, directory: new URL('contests/', root), settingsFile: new URL('settings.json', root) };
  const manager = new TournamentManager(options); await manager.initialize();
  manager.startContest(); await manager.running;
  return { manager, options, session, requests, root };
}
