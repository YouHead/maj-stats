import { mkdir, readFile, writeFile, rename, readdir, copyFile, constants } from 'node:fs/promises';
import { ReplayStore } from './replay-store.mjs';

export function parseContestId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('请输入有效的比赛编号');
  const text = String(value).trim();
  if (!/^\d{1,10}$/.test(text)) throw new Error('比赛编号须为 1 至 10 位正整数');
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 4294967295) throw new Error('比赛编号超出有效范围');
  return number;
}

export class TournamentManager {
  constructor({ directory, settingsFile, legacyDirectory, defaultContestId = 196077, ...storeOptions }) {
    Object.assign(this, { directory, settingsFile, legacyDirectory, defaultContestId, storeOptions });
    this.modifying = false;
  }
  get busy() { return Boolean(this.modifying || this.current?.busy || this.current?.managing); }
  get games() { return this.current.games; }
  get running() { return this.current.running; }
  async saveSettings(settings) {
    await mkdir(new URL('./', this.settingsFile), { recursive: true });
    const temporary = new URL(this.settingsFile.href + '.tmp');
    await writeFile(temporary, JSON.stringify(settings, null, 2));
    await rename(temporary, this.settingsFile);
  }
  async migrateLegacy() {
    if (!this.legacyDirectory) return;
    const marker = new URL('migration.json', this.directory);
    try { await readFile(marker); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let names;
    try { names = await readdir(this.legacyDirectory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    let contestId = this.defaultContestId;
    try { contestId = parseContestId(JSON.parse(await readFile(new URL('contest.json', this.legacyDirectory), 'utf8')).contest_id); } catch (_) {}
    const destination = new URL(`${contestId}/replays/`, this.directory);
    await mkdir(destination, { recursive: true });
    // Copy only app-owned record files. Leave the original layout as a backup.
    const files = names.filter((name) => /^\d{6}-[a-f0-9-]{36}\.(bin|head\.json|analysis\.json)$/.test(name) || ['contest.json', 'contest-index.json', 'contest-sync.json'].includes(name));
    for (const name of files) {
      try { await copyFile(new URL(name, this.legacyDirectory), new URL(name, destination), constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await writeFile(marker, JSON.stringify({ migratedAt: new Date().toISOString(), contestId, files: files.length }, null, 2));
  }
  async loadContest(contestId) {
    const store = new ReplayStore({ ...this.storeOptions, targetContestId: contestId, directory: new URL(`${contestId}/replays/`, this.directory) });
    await store.initialize();
    return store;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    await this.migrateLegacy();
    let contestId = this.defaultContestId;
    try { contestId = parseContestId(JSON.parse(await readFile(this.settingsFile, 'utf8')).contestId); } catch (_) {}
    this.current = await this.loadContest(contestId);
    await this.refreshSaved();
  }
  async refreshSaved() {
    const saved = [];
    const entries = await readdir(this.directory, { withFileTypes: true });
    for (const entry of entries.filter((entry) => entry.isDirectory() && /^\d{1,10}$/.test(entry.name))) {
      try {
        const metadata = JSON.parse(await readFile(new URL(`${entry.name}/replays/contest.json`, this.directory), 'utf8'));
        const contestId = parseContestId(entry.name);
        if (metadata.contest_id === contestId) saved.push({ contestId, name: metadata.contest_name || '' });
      } catch (_) {}
    }
    this.saved = saved.sort((a, b) => a.contestId - b.contestId);
  }
  state() {
    const state = this.current.state();
    const saved = new Map((this.saved || []).map((contest) => [contest.contestId, contest]));
    if (state.contest?.unique_id) saved.set(state.contest.contest_id, { contestId: state.contest.contest_id, name: state.contest.contest_name || '' });
    return { ...state, busy: Boolean(this.modifying || state.busy), mutating: Boolean(this.modifying || state.mutating), savedContests: [...saved.values()].sort((a, b) => a.contestId - b.contestId) };
  }
  assertAvailable() { if (this.busy) throw new Error('正在导入或管理记录，请等待完成；需要时可先停止导入'); }
  assertCurrent(contestId) { if (parseContestId(contestId) !== this.current.targetContestId) throw new Error('当前比赛已变更，请刷新后重试'); }
  async mutate(work) {
    this.assertAvailable(); this.modifying = true;
    try { await work(); await this.refreshSaved(); }
    finally { this.modifying = false; }
    return this.state();
  }
  async selectContest(value) {
    const contestId = parseContestId(value);
    return this.mutate(async () => {
      if (contestId === this.current.targetContestId) { await this.saveSettings({ contestId }); return; }
      const next = await this.loadContest(contestId);
      await this.saveSettings({ contestId });
      this.current = next;
    });
  }
  start(text) { this.assertAvailable(); return this.current.start(text); }
  startContest() { this.assertAvailable(); return this.current.startContest(); }
  stop() { if (this.modifying) throw new Error('正在管理记录，请稍候'); return this.current.stop(); }
  async removeReplay(contestId, uuid) { this.assertCurrent(contestId); return this.mutate(() => this.current.removeReplay(uuid)); }
  async clearRecords(contestId) { this.assertCurrent(contestId); return this.mutate(() => this.current.clearRecords()); }
  async restoreRecords(contestId, batchId) { this.assertCurrent(contestId); return this.mutate(() => this.current.restoreRecords(batchId)); }
  async syncTeams(contestId) { this.assertCurrent(contestId); return this.mutate(() => this.current.syncTeams()); }
  async replayDetails(contestId, uuid) {
    this.assertCurrent(contestId);
    const current = this.current;
    const result = await current.replayDetails(uuid);
    this.assertCurrent(contestId);
    if (this.current !== current) throw new Error('记录已变更，请重新展开详情');
    return result;
  }
  replayUrl(contestId, uuid) {
    this.assertCurrent(contestId);
    if (!this.current.games.has(uuid)) throw new Error('未找到这份牌谱，可能已被删除');
    return `https://game.maj-soul.com/1/?paipu=${encodeURIComponent(uuid)}`;
  }
}
