import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { test } from 'node:test';
import { TournamentManager, parseContestId } from '../src/tournament-manager.mjs';
import { createExcelExport } from '../src/excel-export.mjs';
import { createFixture, protocol, contests, ids, head, data } from './fixtures/record-management.mjs';

test('deleting one replay recomputes all statistics and coverage, survives reopening, and can be restored offline', async () => {
  const { manager, options, session } = await createFixture();
  const before = manager.state();
  const file = manager.current.path(ids[0], 'bin');
  const bytes = await readFile(file);
  await manager.removeReplay(196077, ids[0]);
  assert.equal(manager.state().summary.gameCount, 1);
  assert.equal(manager.state().summary.roundCount, 1);
  assert.equal(manager.state().summary.players[0].wins, 1);
  assert.equal(manager.state().sync.missingCount, 1);
  assert.equal(manager.state().sync.allImported, false);
  assert.equal(manager.state().job, null);
  assert.equal(manager.state().trash[0].replayCount, 1);
  await assert.rejects(access(file), { code: 'ENOENT' });
  session.status = () => ({ ready: false });
  const reopened = new TournamentManager(options); await reopened.initialize();
  assert.equal(reopened.state().summary.gameCount, 1);
  await reopened.restoreRecords(196077, reopened.state().trash[0].id);
  assert.deepEqual(reopened.state().summary, before.summary);
  assert.equal(reopened.state().sync.allImported, true);
  assert.equal(reopened.state().trash.length, 0);
  assert.deepEqual(await readFile(file), bytes);
});

test('clear removes only current records and sync progress; restoration recovers the complete dataset', async () => {
  const { manager } = await createFixture();
  const before = manager.state();
  await writeFile(new URL('user-notes.txt', manager.current.directory), 'keep');
  await manager.clearRecords(196077);
  assert.deepEqual(manager.state().summary.players, []);
  assert.equal(manager.state().summary.gameCount, 0);
  assert.equal(manager.state().recordCount, 0);
  assert.equal(manager.state().sync, null);
  assert.equal(manager.state().job, null);
  assert.equal(manager.state().contest.contest_id, 196077);
  assert.equal(manager.state().trash[0].replayCount, 2);
  assert.equal(await readFile(new URL('user-notes.txt', manager.current.directory), 'utf8'), 'keep');
  await assert.rejects(createExcelExport(manager.state()), /请先导入牌谱/);
  await manager.restoreRecords(196077, manager.state().trash[0].id);
  assert.deepEqual(manager.state().summary, before.summary);
  assert.deepEqual(manager.state().sync, before.sync);
});

test('resync downloads deleted records and restoring an older operation never duplicates or overwrites newer files', async () => {
  const { manager, requests } = await createFixture();
  await manager.removeReplay(196077, ids[0]);
  const batch = manager.state().trash[0].id;
  const replayCalls = () => requests.filter((name) => name.endsWith('fetchGameRecord')).length;
  assert.equal(replayCalls(), 2);
  manager.startContest(); await manager.running;
  assert.equal(replayCalls(), 3);
  assert.equal(manager.state().summary.gameCount, 2);
  const currentJob = await readFile(new URL('contest-sync.json', manager.current.directory));
  await manager.restoreRecords(196077, batch);
  assert.equal(manager.state().summary.gameCount, 2);
  assert.equal(manager.state().summary.players[0].wins, 2);
  assert.deepEqual(await readFile(new URL('contest-sync.json', manager.current.directory)), currentJob);
  await assert.rejects(manager.restoreRecords(196077, batch), /已经恢复或不存在/);
});

test('multiple deletions can be restored in reverse order without changing totals', async () => {
  const { manager } = await createFixture();
  const before = manager.state().summary;
  await manager.removeReplay(196077, ids[0]);
  await manager.clearRecords(196077);
  assert.equal(manager.state().trash.length, 2);
  await manager.restoreRecords(196077, manager.state().trash[0].id);
  assert.equal(manager.state().summary.gameCount, 1);
  await manager.restoreRecords(196077, manager.state().trash[0].id);
  assert.deepEqual(manager.state().summary, before);
});

test('changing contest is offline, persists the selection, and isolates records and recoveries across contests', async () => {
  const { manager, options, requests, session } = await createFixture();
  const before = manager.state().summary;
  const count = requests.length;
  await manager.selectContest('0196078');
  assert.equal(requests.length, count);
  assert.equal(manager.state().contest.contest_id, 196078);
  assert.equal(manager.state().summary.gameCount, 0);
  assert.equal(manager.state().sync, null);
  assert.equal(JSON.parse(await readFile(options.settingsFile)).contestId, 196078);
  manager.startContest(); await manager.running;
  assert.equal(manager.state().summary.gameCount, 2);
  assert.equal(manager.state().contest.unique_id, contests[1].unique_id);
  const reopened = new TournamentManager(options); await reopened.initialize();
  assert.equal(reopened.state().contest.contest_id, 196078);
  await reopened.clearRecords(196078);
  const batch = reopened.state().trash[0].id;
  session.status = () => ({ ready: false });
  await reopened.selectContest(196077);
  assert.deepEqual(reopened.state().summary, before);
  assert.equal(reopened.state().trash.length, 0);
  await assert.rejects(reopened.restoreRecords(196077, batch), /不存在/);
  assert.equal(reopened.state().savedContests.length, 2);
  await reopened.selectContest(196078);
  assert.equal(reopened.state().summary.gameCount, 0);
  await reopened.restoreRecords(196078, batch);
  assert.deepEqual(reopened.state().summary, before);
});

test('rejects invalid inputs, unknown files and stale-contest requests without changing records', async () => {
  const { manager } = await createFixture();
  for (const value of ['', '0', '-1', '1.5', '../196077', '12e3', 4294967296, NaN, {}, null]) {
    assert.throws(() => parseContestId(value), /编号/);
    await assert.rejects(manager.selectContest(value), /编号/);
  }
  assert.equal(parseContestId(' 00196077 '), 196077);
  for (const uuid of ['../contest', `${ids[0]}/../contest`, 'missing']) await assert.rejects(manager.removeReplay(196077, uuid), /编号/);
  await assert.rejects(manager.removeReplay(196077, ids[0].replace(/7$/, '9')), /没有找到/);
  await assert.rejects(manager.restoreRecords(196077, '../anything'), /编号/);
  await assert.rejects(manager.clearRecords(196078), /当前比赛已变更/);
  assert.equal(manager.state().summary.gameCount, 2);
  assert.equal(manager.state().trash.length, 0);
});

test('record management and contest changes cannot overlap imports or another mutation', async () => {
  const { manager } = await createFixture();
  const original = manager.current.clearRecords.bind(manager.current);
  let finish;
  manager.current.clearRecords = async () => { await new Promise((resolve) => { finish = resolve; }); return original(); };
  const pending = manager.clearRecords(196077);
  assert.equal(manager.state().mutating, true);
  await assert.rejects(manager.selectContest(196078), /正在导入或管理/);
  await assert.rejects(manager.removeReplay(196077, ids[0]), /正在导入或管理/);
  assert.throws(() => manager.startContest(), /正在导入或管理/);
  finish(); await pending;
  manager.startContest();
  await assert.rejects(manager.clearRecords(196077), /正在导入或管理/);
  await assert.rejects(manager.selectContest(196078), /正在导入或管理/);
  await manager.running;
  assert.equal(manager.state().summary.gameCount, 2);
});

test('legacy records migrate once and never reappear from the backup after deletion or clear', async () => {
  const { options, root } = await createFixture();
  const legacyDirectory = new URL('legacy/', root); await mkdir(legacyDirectory);
  await writeFile(new URL('contest.json', legacyDirectory), JSON.stringify(contests[0]));
  await writeFile(new URL(`${ids[0]}.head.json`, legacyDirectory), JSON.stringify(head(ids[0])));
  await writeFile(new URL(`${ids[0]}.bin`, legacyDirectory), data);
  const migratedOptions = { ...options, directory: new URL('migrated/', root), legacyDirectory };
  const manager = new TournamentManager(migratedOptions); await manager.initialize();
  assert.equal(manager.state().summary.gameCount, 1);
  assert.deepEqual(await readFile(manager.current.path(ids[0], 'bin')), data);
  await manager.clearRecords(196077);
  const reopened = new TournamentManager(migratedOptions); await reopened.initialize();
  assert.equal(reopened.state().summary.gameCount, 0);
  assert.deepEqual(await readFile(new URL(`${ids[0]}.bin`, legacyDirectory)), data);
  await reopened.restoreRecords(196077, reopened.state().trash[0].id);
  assert.equal(reopened.state().summary.gameCount, 1);
});

test('an interrupted deletion can be recovered, and malicious archive manifests cannot move arbitrary files', async () => {
  const { manager } = await createFixture();
  await manager.removeReplay(196077, ids[0]);
  const entry = manager.state().trash[0];
  const manifestPath = new URL(`.trash/${entry.id}/manifest.json`, manager.current.directory);
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.status = 'preparing';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await manager.current.initialize();
  assert.equal(manager.state().trash.length, 1);
  await manager.restoreRecords(196077, entry.id);
  assert.equal(manager.state().summary.gameCount, 2);
  await manager.removeReplay(196077, ids[0]);
  const corrupted = manager.state().trash[0];
  const corruptedPath = new URL(`.trash/${corrupted.id}/manifest.json`, manager.current.directory);
  const unsafe = JSON.parse(await readFile(corruptedPath)); unsafe.files.push('../contest.json');
  await writeFile(corruptedPath, JSON.stringify(unsafe));
  await assert.rejects(manager.restoreRecords(196077, corrupted.id), /不存在/);
  assert.equal(manager.state().summary.gameCount, 1);
});
