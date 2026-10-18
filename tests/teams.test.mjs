import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { fetchContestTeams, applyTeams, validTeamRoster } from '../src/teams.mjs';
import { TournamentManager } from '../src/tournament-manager.mjs';
import { createExcelExport } from '../src/excel-export.mjs';
import { createServer } from '../src/server.mjs';
import { createFixture, protocol, contests, ids } from './fixtures/record-management.mjs';

const scope = { contestId: contests[0].contest_id, contestUid: contests[0].unique_id };
const teamResponse = (rank, total = rank.length) => protocol.encode('lq.ResFetchContestTeamRank', { total, rank });
const memberResponse = (rank, total = rank.length) => protocol.encode('lq.ResFetchContestTeamMember', { total, rank });

test('reads every team and member page by numeric account ID', async () => {
  const calls = [];
  const roster = await fetchContestTeams({ ...scope, protocol, request: async (bytes) => {
    const wrapper = protocol.decode('lq.Wrapper', bytes);
    const members = wrapper.name.endsWith('fetchContestTeamMember');
    const query = protocol.decode(members ? 'lq.ReqFetchContestTeamMember' : 'lq.ReqFetchContestTeamRank', wrapper.data);
    assert.equal(query.unique_id, scope.contestUid); assert.equal(query.limit, 50);
    calls.push([members ? query.team_id : 'teams', query.offset]);
    if (!members) return teamResponse([{ team_id: query.offset + 1, name: `Team ${query.offset + 1}` }], 2);
    return memberResponse([{ account_id: query.team_id * 10 + query.offset, nickname: 'Same nickname' }], 2);
  } });
  assert.deepEqual(calls, [['teams', 0], ['teams', 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
  assert.deepEqual(roster.teams.map((team) => team.members.map((member) => member.accountId)), [[10, 11], [20, 21]]);
  assert.ok(validTeamRoster(roster, scope.contestId, scope.contestUid));
  assert.equal(validTeamRoster(roster, 196078, scope.contestUid), false);
});

test('rejects incomplete or changing pages, authentication errors and conflicting memberships', async () => {
  const base = { ...scope, protocol };
  await assert.rejects(fetchContestTeams({ ...base, request: async () => teamResponse([{ team_id: 1, name: 'A' }], 2) }), /尚未读完/);
  let calls = 0;
  await assert.rejects(fetchContestTeams({ ...base, request: async () => ++calls === 1 ? teamResponse([{ team_id: 1 }], 2) : teamResponse([], 3) }), /发生变化/);
  await assert.rejects(fetchContestTeams({ ...base, request: async () => protocol.encode('lq.ResFetchContestTeamRank', { error: { code: 1004 } }) }), /1004/);
  await assert.rejects(fetchContestTeams({ ...base, request: async (bytes) => protocol.decode('lq.Wrapper', bytes).name.endsWith('fetchContestTeamRank') ? teamResponse([{ team_id: 1 }, { team_id: 2 }]) : memberResponse([{ account_id: 1 }]) }), /多个队伍/);
  const malformed = { ...scope, teams: [{ id: 1, name: 'A', members: [{ accountId: 1 }, { accountId: 1 }] }] };
  assert.equal(validTeamRoster(malformed, scope.contestId, scope.contestUid), false);
});

test('team PT sums raw settlement points once and preserves missing and real-zero distinctions', () => {
  const players = [
    { accountId: 1, nickname: 'Same', games: 1, ptObservedGames: 1, ptRawSum: 100, totalPt: 0.1 },
    { accountId: 2, nickname: 'Same', games: 1, ptObservedGames: 1, ptRawSum: -100, totalPt: -0.1 },
    { accountId: 3, nickname: 'C', games: 1, ptObservedGames: 0, ptRawSum: 0, totalPt: null },
    { accountId: 4, nickname: 'Unassigned', games: 1, ptObservedGames: 1, ptRawSum: 9000, totalPt: 9 },
  ];
  const roster = { teams: [{ id: 1, name: 'A', members: [{ accountId: 1 }, { accountId: 2 }] }, { id: 2, name: 'B', members: [{ accountId: 3 }] }, { id: 3, name: 'No imported games', members: [{ accountId: 5 }] }] };
  const result = applyTeams({ players }, roster);
  assert.equal(result.summary.players[0].teamName, 'A'); assert.equal(result.summary.players[3].teamName, '');
  assert.deepEqual(result.teams.map((team) => team.totalPt), [0, null, null]);
  assert.equal(result.teamInfo.unassignedCount, 1); assert.equal(result.teams[0].games, 2);
  assert.equal(players[0].teamName, undefined);
});

test('official roster is cached per contest, survives record management and preserves old data on refresh failure', async () => {
  const { manager, options, session } = await createFixture();
  assert.equal(manager.state().teamInfo.unassignedCount, 0);
  assert.deepEqual(manager.state().teams.map((team) => team.totalPt), [119.8, -119.8]);
  const file = new URL('contest-teams.json', manager.current.directory), saved = await readFile(file);
  session.fetchRecord = async () => protocol.encode('lq.ResFetchContestTeamRank', { error: { code: 1004 } });
  await assert.rejects(manager.syncTeams(196077), /1004/);
  assert.deepEqual(await readFile(file), saved); assert.equal(manager.state().teams[0].totalPt, 119.8);
  session.status = () => ({ ready: false });
  const reopened = new TournamentManager(options); await reopened.initialize();
  assert.equal(reopened.state().summary.players[0].teamName, '合成甲队');
  await reopened.removeReplay(196077, ids[0]); assert.equal(reopened.state().teams[0].totalPt, 59.9);
  await reopened.restoreRecords(196077, reopened.state().trash[0].id); assert.equal(reopened.state().teams[0].totalPt, 119.8);
  await reopened.clearRecords(196077); assert.deepEqual(await readFile(file), saved); assert.equal(reopened.state().teams[0].totalPt, null);
  await reopened.restoreRecords(196077, reopened.state().trash[0].id); assert.equal(reopened.state().teams[0].totalPt, 119.8);
  await reopened.selectContest(196078); assert.equal(reopened.state().teams.length, 0);
  await assert.rejects(reopened.syncTeams(196077), /已变更/);
  await reopened.selectContest(196077); assert.equal(reopened.state().teams[0].totalPt, 119.8);
  await writeFile(file, JSON.stringify({ ...scope, teams: [{ id: 1, name: 'Bad', members: null }] }));
  const corrupted = new TournamentManager(options); await corrupted.initialize(); assert.equal(corrupted.state().teams.length, 0);
});

test('exports team names, team PT and the detail separator without PT hover notes', async () => {
  const { manager } = await createFixture();
  const state = manager.state();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await createExcelExport(state));
  const players = workbook.getWorksheet('选手统计');
  assert.equal(players.getCell('C5').value, '队伍'); assert.equal(players.getCell('C6').value, '合成甲队');
  assert.equal(players.getCell('D5').value, 'PT'); assert.equal(players.getCell('E5').value, '对局数');
  assert.equal(players.getCell('K5').value, '小局数'); assert.equal(players.getCell('K6').border.left.style, 'medium');
  assert.equal(players.getCell('D5').note, undefined);
  const teams = workbook.getWorksheet('队伍 PT');
  assert.equal(teams.getCell('B6').value, '合成甲队'); assert.equal(teams.getCell('C6').value, 119.8);
  assert.equal(teams.getCell('C7').value, -119.8); assert.equal(teams.getCell('C7').numFmt, '0.0;[Red]-0.0;0.0');
});

test('team sync endpoint rejects foreign origins and stale contest requests', async (context) => {
  const { manager: store, session } = await createFixture();
  const { server, origin } = await createServer({ store, session });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const post = (from, contestId) => fetch(`${origin}/api/teams/sync`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify({ contestId }) });
  assert.equal((await post('https://example.com', 196077)).status, 403);
  assert.equal((await post(origin, 196078)).status, 400);
  assert.equal((await post(origin, 196077)).status, 200);
  assert.equal((await fetch(`${origin}/teams.js`)).status, 200);
});
