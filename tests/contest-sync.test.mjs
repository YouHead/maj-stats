import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { loadProtocol } from '../src/protocol.mjs';
import { listContestRecords } from '../src/contest-records.mjs';
import { ReplayStore } from '../src/replay-store.mjs';

const protocol = await loadProtocol(new URL('../.cache/', import.meta.url));
const contest = { contest_id: 196077, unique_id: 80196077, contest_name: 'Fixture tournament' };
const ids = [7, 8, 9].map((last) => `260101-00000001-0000-4000-8000-00000000000${last}`);
const head = (uuid) => ({
  uuid, start_time: 1792210000 + ids.indexOf(uuid), end_time: 1792212000,
  config: { meta: { contest_uid: contest.unique_id } },
  accounts: [0, 1, 2, 3].map((seat) => ({ seat, account_id: seat + 1, nickname: `Player ${seat + 1}` })),
  result: { players: [0, 1, 2, 3].map((seat) => ({ seat, part_point_1: 40000 - seat * 10000 })) },
});
const pageBytes = (records, next_index = 0) => protocol.encode('lq.ResFetchCustomizedContestGameRecords', { record_list: records.map(head), next_index });
const actions = [protocol.wrap('.lq.RecordNewRound', { scores: [25000, 25000, 25000, 25000] }), protocol.wrap('.lq.RecordDiscardTile', { seat: 3 }), protocol.wrap('.lq.RecordHule', { hules: [{ seat: 0, point_rong: 8000 }] })];
const data = protocol.wrap('.lq.GameDetailRecords', { version: 210715, actions: actions.map((result) => ({ result })) });
const base = new URL('../.cache/tests/', import.meta.url);
async function directory() {
  await mkdir(base, { recursive: true });
  return pathToFileURL((await mkdtemp(path.join(fileURLToPath(base), 'contest-'))) + path.sep);
}

function sessionFixture({ failRecord, onRecord } = {}) {
  const downloads = new Map();
  const cursors = [];
  const session = {
    status: () => ({ ready: true }), poll: async () => ({ ready: true, clientVersion: 'fixture' }),
    fetchRecord: async (bytes) => {
      const wrapper = protocol.decode('lq.Wrapper', bytes);
      if (wrapper.name.endsWith('fetchCustomizedContestByContestId')) return protocol.encode('lq.ResFetchCustomizedContestByContestId', { contest_info: contest });
      if (wrapper.name.endsWith('fetchContestTeamRank')) return protocol.encode('lq.ResFetchContestTeamRank', { total: 0, rank: [] });
      if (wrapper.name.endsWith('fetchCustomizedContestGameRecords')) {
        const request = protocol.decode('lq.ReqFetchCustomizedContestGameRecords', wrapper.data);
        assert.equal(request.unique_id, contest.unique_id);
        cursors.push(request.last_index);
        return request.last_index === 0 ? pageBytes(ids.slice(0, 2), 50) : pageBytes(ids.slice(1));
      }
      const { game_uuid } = protocol.decode('lq.ReqGameRecord', wrapper.data);
      downloads.set(game_uuid, (downloads.get(game_uuid) || 0) + 1);
      onRecord?.(game_uuid);
      if (failRecord?.(game_uuid)) return protocol.encode('lq.ResGameRecord', { error: { code: 1004 } });
      return protocol.encode('lq.ResGameRecord', { head: head(game_uuid), data });
    },
  };
  return { session, downloads, cursors };
}

test('follows server cursors through overlapping pages and an empty final page', async () => {
  const cursors = [];
  const snapshots = [];
  const result = await listContestRecords({
    protocol, contestUid: contest.unique_id,
    request: async (bytes) => {
      const wrapper = protocol.decode('lq.Wrapper', bytes);
      const request = protocol.decode('lq.ReqFetchCustomizedContestGameRecords', wrapper.data);
      assert.equal(request.unique_id, contest.unique_id);
      cursors.push(request.last_index);
      return request.last_index === 0 ? pageBytes(ids.slice(0, 2), 100) : request.last_index === 100 ? pageBytes(ids.slice(1), 60) : pageBytes([]);
    },
    onPage: async (page) => snapshots.push(page),
  });
  assert.deepEqual(cursors, [0, 100, 60]);
  assert.deepEqual(result.records.map((record) => record.uuid), ids);
  assert.equal(result.duplicateEntries, 1);
  assert.deepEqual(snapshots.map((page) => page.paginationComplete), [false, false, true]);
});

test('rejects repeated cursors, empty intermediate pages, foreign contests and authentication errors', async () => {
  const options = { protocol, contestUid: contest.unique_id };
  await assert.rejects(listContestRecords({ ...options, request: async () => pageBytes([ids[0]], 10) }), /重复的分页/);
  await assert.rejects(listContestRecords({ ...options, request: async () => pageBytes([], 10) }), /空的中间页/);
  await assert.rejects(listContestRecords({ ...options, request: async () => protocol.encode('lq.ResFetchCustomizedContestGameRecords', { record_list: [{ ...head(ids[0]), config: { meta: { contest_uid: 12345 } } }] }) }), /其他比赛/);
  await assert.rejects(listContestRecords({ ...options, request: async () => protocol.encode('lq.ResFetchCustomizedContestGameRecords', { error: { code: 1004 } }) }), /登录/);
});

test('imports a whole tournament once, includes an existing shared replay, and restores coverage offline', async () => {
  const { session, downloads, cursors } = sessionFixture();
  const location = await directory();
  const store = new ReplayStore({ protocol, session, directory: location, targetContestId: contest.contest_id });
  await store.initialize();
  store.start(ids[0]); await store.running;
  store.startContest(); await store.running;
  assert.deepEqual(cursors, [0, 50]);
  assert.equal(store.job.duplicates, 1);
  assert.deepEqual(store.job.items.map((item) => item.status), ['cached', 'done', 'done']);
  assert.equal(store.state().summary.gameCount, 3);
  assert.equal(store.state().summary.roundCount, 3);
  assert.equal(store.state().summary.players.length, 4);
  assert.equal(store.state().summary.players.find((player) => player.accountId === 1).wins, 3);
  assert.equal(store.state().sync.allImported, true);
  store.startContest(); await store.running;
  assert.equal(store.job.items.every((item) => item.status === 'cached'), true);
  assert.deepEqual([...downloads.values()], [1, 1, 1]);
  session.status = () => ({ ready: false });
  const reopened = new ReplayStore({ protocol, session, directory: location, targetContestId: contest.contest_id });
  await reopened.initialize();
  assert.equal(reopened.state().summary.gameCount, 3);
  assert.equal(reopened.state().sync.allImported, true);
  assert.equal(reopened.job.kind, 'contest');
});

test('keeps failed replays visible and retries only missing records on the next whole-tournament import', async () => {
  let fail = true;
  const { session, downloads } = sessionFixture({ failRecord: (uuid) => fail && uuid === ids[1] });
  const store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: contest.contest_id });
  await store.initialize();
  store.startContest(); await store.running;
  assert.equal(store.job.phase, 'partial');
  assert.equal(store.state().sync.allImported, false);
  assert.equal(store.state().sync.missingCount, 1);
  assert.equal(store.job.items[1].status, 'failed');
  fail = false;
  store.startContest(); await store.running;
  assert.equal(store.state().sync.allImported, true);
  assert.equal(store.state().summary.gameCount, 3);
  assert.equal(downloads.get(ids[0]), 1);
  assert.equal(downloads.get(ids[1]), 2);
  assert.equal(downloads.get(ids[2]), 1);
});

test('does not label an incomplete listing as complete when pagination breaks', async () => {
  const { session } = sessionFixture();
  const original = session.fetchRecord;
  session.fetchRecord = async (bytes) => protocol.decode('lq.Wrapper', bytes).name.endsWith('fetchCustomizedContestGameRecords') ? pageBytes([ids[0]], 10) : original(bytes);
  const store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: contest.contest_id });
  await store.initialize();
  store.startContest(); await store.running;
  assert.equal(store.job.phase, 'failed');
  assert.match(store.job.error, /重复的分页/);
  assert.equal(store.state().sync.paginationComplete, false);
  assert.equal(store.state().sync.allImported, false);
  assert.equal(store.state().summary.gameCount, 0);
});

test('stops between downloads and resumes without downloading successful replays again', async () => {
  let store;
  let stopOnce = true;
  const { session, downloads } = sessionFixture({ onRecord: () => { if (stopOnce) { stopOnce = false; store.stop(); } } });
  store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: contest.contest_id });
  await store.initialize();
  store.startContest(); await store.running;
  assert.equal(store.job.phase, 'stopped');
  assert.equal(store.state().summary.gameCount, 1);
  assert.equal(store.state().sync.allImported, false);
  store.startContest(); await store.running;
  assert.equal(store.state().sync.allImported, true);
  assert.deepEqual([...downloads.values()], [1, 1, 1]);
});

test('automatically retries a transient read failure without duplicating imported games', async () => {
  const { session } = sessionFixture();
  const original = session.fetchRecord;
  let failedOnce = false;
  session.fetchRecord = async (bytes) => {
    if (!failedOnce) { failedOnce = true; throw new Error('牌谱下载超时，请重试'); }
    return original(bytes);
  };
  const store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: contest.contest_id, retryDelayMs: 0 });
  await store.initialize();
  store.startContest(); await store.running;
  assert.equal(store.state().summary.gameCount, 3);
  assert.equal(store.state().sync.allImported, true);
});

test('waits and retries temporary server record refusals, with a finite retry limit', async () => {
  const { session } = sessionFixture();
  const original = session.fetchRecord;
  let refusals = 0;
  let permanentlyRefuse = false;
  session.fetchRecord = async (bytes) => {
    if (protocol.decode('lq.Wrapper', bytes).name.endsWith('fetchGameRecord')) {
      refusals++;
      if (permanentlyRefuse || refusals <= 2) return protocol.encode('lq.ResGameRecord', { error: { code: 540 } });
    }
    return original(bytes);
  };
  const store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: contest.contest_id, responseRetryDelayMs: 0 });
  await store.initialize();
  store.start(ids[0]); await store.running;
  assert.equal(store.state().summary.gameCount, 1);
  assert.equal(refusals, 3);
  permanentlyRefuse = true; refusals = 0;
  store.start(ids[1]); await store.running;
  assert.equal(refusals, 4);
  assert.equal(store.job.items[0].status, 'failed');
  assert.equal(store.state().summary.gameCount, 1);
});
