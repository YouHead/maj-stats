import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { loadProtocol } from '../src/protocol.mjs';
import { ReplayStore } from '../src/replay-store.mjs';

const protocol = await loadProtocol(new URL('../.cache/', import.meta.url));
const uuid = '260101-00000001-0000-4000-8000-000000000007';
const link = `https://game.maj-soul.com/1/?paipu=${uuid}_a123456789`;
const head = {
  uuid, start_time: 1792210000, end_time: 1792212000,
  accounts: [0, 1, 2, 3].map((seat) => ({ seat, account_id: seat + 1, nickname: `Player ${seat + 1}` })),
  result: { players: [0, 1, 2, 3].map((seat) => ({ seat, part_point_1: 40000 - seat * 10000 })) },
};
const events = [protocol.wrap('.lq.RecordNewRound', { scores: [25000, 25000, 25000, 25000] }), protocol.wrap('.lq.RecordDiscardTile', { seat: 3 }), protocol.wrap('.lq.RecordHule', { hules: [{ seat: 0, point_rong: 8000 }] })];
const data = protocol.wrap('.lq.GameDetailRecords', { version: 210715, actions: events.map((result) => ({ result })) });
const base = new URL('../.cache/tests/', import.meta.url);
async function directory() { await mkdir(base, { recursive: true }); return pathToFileURL((await mkdtemp(path.join(fileURLToPath(base), 'pipeline-'))) + path.sep); }

test('keeps protobuf zero settlement as valid zero PT', () => {
  const response = protocol.decode('lq.ResGameRecord', protocol.encode('lq.ResGameRecord', { head: { ...head, result: { players: head.result.players.map((player) => ({ ...player, total_point: 0 })) } }, data }));
  assert.equal(response.head.result.players[0].total_point, 0);
});

test('runs link to response to signed binary download to four-player statistics, then reuses cache', async () => {
  let calls = 0;
  const session = {
    status: () => ({ ready: true }), poll: async () => ({ ready: true, clientVersion: 'fixture' }),
    fetchRecord: async (request) => {
      calls++;
      const wrapper = protocol.decode('lq.Wrapper', request);
      assert.equal(protocol.decode('lq.ReqGameRecord', wrapper.data).game_uuid, uuid);
      return protocol.encode('lq.ResGameRecord', { head, data_url: `https://record.example.maj-soul.com/${uuid}` });
    },
  };
  const location = await directory();
  const store = new ReplayStore({ protocol, session, directory: location, fetcher: async () => new Response(data) });
  await store.initialize();
  store.start(`${link}\n${link}`);
  await store.running;
  assert.equal(store.job.items[0].status, 'done');
  assert.equal(store.job.duplicates, 1);
  assert.equal(store.state().summary.players.length, 4);
  assert.equal(store.state().summary.players.find((player) => player.accountId === 4).dealInRate, 1);
  assert.ok((await readFile(new URL(`${uuid}.bin`, location))).length);
  session.status = () => ({ ready: false });
  store.start(link);
  await store.running;
  assert.equal(store.job.items[0].status, 'cached');
  assert.equal(calls, 1);
  const restored = new ReplayStore({ protocol, session, directory: location });
  await restored.initialize();
  assert.equal(restored.state().summary.gameCount, 1);
});

test('does not report a successful import for authentication errors or unfinished records', async () => {
  const session = { status: () => ({ ready: true }), poll: async () => ({ ready: true }), fetchRecord: async () => protocol.encode('lq.ResGameRecord', { error: { code: 1004 } }) };
  const store = new ReplayStore({ protocol, session, directory: await directory() });
  await store.initialize();
  store.start(link);
  await store.running;
  assert.equal(store.job.items[0].status, 'failed');
  assert.equal(store.state().summary.gameCount, 0);
  assert.match(store.job.items[0].message, /登录/);
});

test('verifies tournament membership and preserves that check when reopening the cache', async () => {
  const contest = { contest_id: 196077, unique_id: 80196077, contest_name: 'Fixture tournament' };
  const tournamentHead = { ...head, config: { meta: { contest_uid: contest.unique_id } } };
  const session = {
    status: () => ({ ready: true }), poll: async () => ({ ready: true }),
    fetchRecord: async (request) => {
      const wrapper = protocol.decode('lq.Wrapper', request);
      return wrapper.name.endsWith('fetchCustomizedContestByContestId')
        ? protocol.encode('lq.ResFetchCustomizedContestByContestId', { contest_info: contest })
        : protocol.encode('lq.ResGameRecord', { head: tournamentHead, data });
    },
  };
  const location = await directory();
  const store = new ReplayStore({ protocol, session, directory: location, targetContestId: contest.contest_id });
  await store.initialize();
  store.start(link);
  await store.running;
  assert.equal(store.job.items[0].status, 'done');
  session.status = () => ({ ready: false });
  const restored = new ReplayStore({ protocol, session, directory: location, targetContestId: contest.contest_id });
  await restored.initialize();
  assert.equal(restored.state().summary.gameCount, 1);
  assert.equal(restored.state().contest.contest_name, contest.contest_name);
  await writeFile(new URL(`${uuid}.head.json`, location), JSON.stringify({ ...head, config: { meta: { contest_uid: 12345 } } }));
  const mismatched = new ReplayStore({ protocol, session, directory: location, targetContestId: contest.contest_id });
  await mismatched.initialize();
  assert.equal(mismatched.state().summary.gameCount, 0);
  assert.match(mismatched.state().cacheErrors[0].message, /比赛核对/);
});

test('excludes downloaded replays from a different tournament', async () => {
  const session = {
    status: () => ({ ready: true }), poll: async () => ({ ready: true }),
    fetchRecord: async (request) => protocol.decode('lq.Wrapper', request).name.endsWith('fetchCustomizedContestByContestId')
      ? protocol.encode('lq.ResFetchCustomizedContestByContestId', { contest_info: { contest_id: 196077, unique_id: 80196077 } })
      : protocol.encode('lq.ResGameRecord', { head: { ...head, config: { meta: { contest_uid: 12345 } } }, data }),
  };
  const store = new ReplayStore({ protocol, session, directory: await directory(), targetContestId: 196077 });
  await store.initialize();
  store.start(link);
  await store.running;
  assert.equal(store.job.items[0].status, 'failed');
  assert.match(store.job.items[0].message, /不属于比赛 196077/);
  assert.equal(store.state().summary.gameCount, 0);
});
