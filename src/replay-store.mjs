import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { parseShareLinks } from './share-links.mjs';
import { analyzeGame, aggregateGames } from './statistics.mjs';
import { listContestRecords } from './contest-records.mjs';
import { randomUUID } from 'node:crypto';
import { fetchContestTeams, applyTeams, validTeamRoster } from './teams.mjs';
import { buildReplayDetails } from './replay-details.mjs';

const REPLAY_FILE = /^(\d{6}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(bin|head\.json|analysis\.json)$/;
const BATCH_ID = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const metadataFile = (name) => ['contest-index.json', 'contest-sync.json'].includes(name);
const missing = (error) => error.code === 'ENOENT';

export class ReplayStore {
  constructor({ protocol, session, directory, fetcher = fetch, targetContestId = null, requestIntervalMs = 0, retryDelayMs = 800, responseRetryDelayMs = 2000 }) {
    Object.assign(this, { protocol, session, directory, fetcher, targetContestId, requestIntervalMs, retryDelayMs, responseRetryDelayMs });
    this.games = new Map();
    this.job = null;
    this.busy = false;
    this.cacheErrors = [];
  }
  path(uuid, extension) { return new URL(`${uuid}.${extension}`, this.directory); }
  async save(path, bytes) {
    const temporary = new URL(path.href + '.tmp');
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    this.games.clear(); this.cacheErrors = []; this.job = null; this.contest = null; this.index = null;
    this.detailCache = new Map();
    if (this.targetContestId) {
      try {
        const contest = JSON.parse(await readFile(new URL('contest.json', this.directory), 'utf8'));
        if (contest.contest_id === this.targetContestId && Number.isSafeInteger(contest.unique_id) && contest.unique_id > 0) this.contest = contest;
      } catch (_) { /* Older caches are verified again on their next import. */ }
    }
    const files = await readdir(this.directory);
    this.recordIds = new Set(files.map((name) => REPLAY_FILE.exec(name)?.[1]).filter(Boolean));
    for (const name of files.filter((file) => /^\d{6}-[a-f0-9-]{36}\.head\.json$/.test(file))) {
      const uuid = name.slice(0, -10);
      try {
        const head = JSON.parse(await readFile(this.path(uuid, 'head.json'), 'utf8'));
        if (head.uuid !== uuid) throw new Error('缓存的牌谱编号与文件名不一致');
        if (this.targetContestId && (!this.contest || head.config?.meta?.contest_uid !== this.contest.unique_id)) throw new Error('缓存尚未通过当前比赛核对，请登录后重新导入此牌谱');
        const data = await readFile(this.path(uuid, 'bin'));
        const game = analyzeGame(head, this.protocol.records(data));
        await this.save(this.path(uuid, 'analysis.json'), JSON.stringify(game, null, 2));
        this.games.set(uuid, game);
      } catch (error) { this.cacheErrors.push({ uuid, message: error.message }); }
    }
    if (this.contest) {
      try {
        const index = JSON.parse(await readFile(new URL('contest-index.json', this.directory), 'utf8'));
        if (index.contestId === this.targetContestId && index.contestUid === this.contest.unique_id && Array.isArray(index.records)) this.index = index;
      } catch (_) {}
      try {
        const job = JSON.parse(await readFile(new URL('contest-sync.json', this.directory), 'utf8'));
        if (job.contestId === this.targetContestId && job.complete) this.job = job;
      } catch (_) {}
    }
    this.trashEntries = await this.loadTrash();
    this.teamRoster = null;
    try {
      const roster = JSON.parse(await readFile(new URL('contest-teams.json', this.directory), 'utf8'));
      if (validTeamRoster(roster, this.targetContestId, this.contest?.unique_id)) this.teamRoster = roster;
    } catch (_) {}
  }
  async loadTrash() {
    let folders;
    try { folders = await readdir(new URL('.trash/', this.directory), { withFileTypes: true }); }
    catch (error) { if (missing(error)) return []; throw error; }
    const entries = [];
    for (const folder of folders.filter((entry) => entry.isDirectory() && BATCH_ID.test(entry.name))) {
      try {
        const entry = JSON.parse(await readFile(new URL(`.trash/${folder.name}/manifest.json`, this.directory), 'utf8'));
        if (entry.id !== folder.name || entry.contestId !== this.targetContestId || entry.restoredAt || !Array.isArray(entry.files) || !entry.files.every((name) => REPLAY_FILE.test(name) || metadataFile(name))) continue;
        entries.push(entry);
      } catch (_) { /* A partial manifest never authorizes arbitrary file paths. */ }
    }
    return entries.sort((a, b) => b.id.localeCompare(a.id));
  }
  assertIdle() {
    if (this.busy || this.managing) throw new Error('正在导入或管理记录，请等待完成；需要时可先停止导入');
  }
  async recordMutation(work) {
    this.assertIdle(); this.managing = true;
    try { return await work(); }
    finally { this.managing = false; }
  }
  async removeReplay(uuid) {
    if (typeof uuid !== 'string' || !REPLAY_FILE.test(`${uuid}.bin`)) throw new Error('牌谱编号不正确');
    return this.removeRecords(uuid);
  }
  async clearRecords() { return this.removeRecords(null); }
  async removeRecords(uuid) {
    return this.recordMutation(async () => {
      const names = await readdir(this.directory);
      const files = names.filter((name) => {
        const match = REPLAY_FILE.exec(name);
        return match ? !uuid || match[1] === uuid : metadataFile(name) && (!uuid || name === 'contest-sync.json');
      });
      if (uuid && !files.some((name) => REPLAY_FILE.exec(name)?.[1] === uuid)) throw new Error('没有找到这份本地牌谱，可能已经被删除');
      if (!files.length) { this.recordNotice = '当前比赛没有可清空的记录。'; return; }
      const id = `${Date.now()}-${randomUUID()}`;
      const directory = new URL(`.trash/${id}/`, this.directory);
      await mkdir(directory, { recursive: true });
      const manifest = { id, contestId: this.targetContestId, action: uuid ? 'delete' : 'clear', createdAt: new Date().toISOString(), files, replayCount: new Set(files.map((name) => REPLAY_FILE.exec(name)?.[1]).filter(Boolean)).size, status: 'preparing' };
      const manifestPath = new URL('manifest.json', directory);
      await this.save(manifestPath, JSON.stringify(manifest, null, 2));
      const moved = [];
      try {
        for (const name of files) { await rename(new URL(name, this.directory), new URL(name, directory)); moved.push(name); }
        manifest.status = 'ready';
        await this.save(manifestPath, JSON.stringify(manifest, null, 2));
      } catch (error) {
        let rollbackFailed = false;
        for (const name of moved.reverse()) { try { await rename(new URL(name, directory), new URL(name, this.directory)); } catch (_) { rollbackFailed = true; } }
        if (!rollbackFailed) { manifest.restoredAt = new Date().toISOString(); manifest.status = 'rolled-back'; }
        await this.save(manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {});
        await this.initialize();
        throw new Error(rollbackFailed ? '删除未完成，部分文件已保留在最近删除中，请使用恢复功能' : `删除未完成，已回退：${error.message}`);
      }
      await this.initialize();
      this.recordNotice = `${uuid ? '已删除' : '已清空当前比赛的'} ${manifest.replayCount} 份本地牌谱，统计已更新。可恢复上次操作；再次同步会重新获取这些牌谱。`;
    });
  }
  async restoreRecords(id) {
    return this.recordMutation(async () => {
      if (typeof id !== 'string' || !BATCH_ID.test(id)) throw new Error('恢复记录编号不正确');
      const manifest = (await this.loadTrash()).find((entry) => entry.id === id);
      if (!manifest) throw new Error('这组记录已经恢复或不存在');
      const directory = new URL(`.trash/${id}/`, this.directory);
      const existing = new Set(await readdir(this.directory));
      const restored = new Set();
      for (const name of manifest.files) {
        if (existing.has(name)) continue; // Keep newer records and list snapshots.
        try {
          await rename(new URL(name, directory), new URL(name, this.directory));
          const match = REPLAY_FILE.exec(name); if (match) restored.add(match[1]);
        } catch (error) { if (!missing(error)) { await this.initialize(); throw error; } }
      }
      manifest.restoredAt = new Date().toISOString(); manifest.status = 'restored';
      await this.save(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2));
      await this.initialize();
      this.recordNotice = restored.size ? `已恢复 ${restored.size} 份本地牌谱，统计已重新计算。` : '这些牌谱已经存在，已保留当前记录。';
    });
  }
  async replayDetails(uuid) {
    if (typeof uuid !== 'string' || !REPLAY_FILE.test(`${uuid}.bin`)) throw new Error('牌谱编号不正确');
    const game = this.games.get(uuid);
    if (!game) throw new Error('未找到这份牌谱，可能已被删除');
    if (!this.detailCache.has(uuid)) {
      const records = this.protocol.records(await readFile(this.path(uuid, 'bin')));
      if (this.games.get(uuid) !== game) throw new Error('记录已变更，请重新展开详情');
      this.detailCache.set(uuid, buildReplayDetails(game, records));
    }
    return this.detailCache.get(uuid);
  }
  state() {
    const listedIds = new Set(this.index?.records.map((record) => record.uuid) || []);
    const importedCount = [...listedIds].filter((uuid) => this.games.has(uuid)).length;
    return {
      busy: Boolean(this.busy || this.managing), mutating: Boolean(this.managing), job: this.job ? structuredClone(this.job) : null,
      ...applyTeams(aggregateGames([...this.games.values()]), this.teamRoster),
      teamError: this.teamError || '',
      games: [...this.games.values()].map((game) => ({ uuid: game.uuid, startTime: game.startTime, roundCount: game.roundCount, players: game.players.map(({ nickname, accountId, seat, finalScore, totalPt, ptRawSum, ptObservedGames }) => ({ nickname, accountId, seat, finalScore, pt: totalPt, ptRaw: ptObservedGames ? ptRawSum : null })) })),
      methodology: [...this.games.values()][0]?.methodology || null,
      cacheErrors: this.cacheErrors,
      recordCount: this.recordIds?.size || 0, recordNotice: this.recordNotice || '',
      trash: (this.trashEntries || []).map(({ id, action, createdAt, replayCount }) => ({ id, action, createdAt, replayCount })),
      contest: this.contest || (this.targetContestId ? { contest_id: this.targetContestId } : null),
      sync: this.index ? {
        contestId: this.index.contestId, listedAt: this.index.listedAt, startedAt: this.index.startedAt,
        pages: this.index.pages, listedCount: listedIds.size, importedCount,
        missingCount: listedIds.size - importedCount, paginationComplete: this.index.paginationComplete,
        allImported: this.index.paginationComplete && importedCount === listedIds.size,
      } : null,
    };
  }
  checkStopped() {
    if (this.job?.cancelRequested) throw new Error('已停止导入；成功结果已保留，再次一键导入可继续补齐');
  }
  async request(wrapper) {
    for (let attempt = 0; ; attempt++) {
      this.checkStopped();
      const delay = Math.max(0, (this.lastRequestAt || 0) + this.requestIntervalMs - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.checkStopped();
      this.lastRequestAt = Date.now();
      try { return await this.session.fetchRecord(wrapper); }
      catch (error) {
        if (attempt >= 2 || !/超时|网络|fetch failed|ETIMEDOUT|ECONN|socket/i.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
      }
    }
  }
  async ensureContest(refresh = false) {
    if (!this.targetContestId || (this.contest && !refresh)) return;
    const metadata = this.protocol.decode('lq.ResFetchCustomizedContestByContestId', await this.request(this.protocol.contestRequest(this.targetContestId)));
    if (metadata.error?.code === 1004) throw new Error('登录会话不可用，请重新登录后重试');
    if (metadata.error?.code || !metadata.contest_info?.unique_id || metadata.contest_info.contest_id !== this.targetContestId) throw new Error('暂时无法核对比赛信息，请重试');
    this.contest = metadata.contest_info;
    await this.save(new URL('contest.json', this.directory), JSON.stringify(this.contest, null, 2));
  }
  async fetchTeams() {
    await this.ensureContest();
    const roster = await fetchContestTeams({ protocol: this.protocol, request: (wrapper) => this.request(wrapper), contestId: this.targetContestId, contestUid: this.contest.unique_id, checkStopped: () => this.checkStopped() });
    if (!validTeamRoster(roster, this.targetContestId, this.contest.unique_id)) throw new Error('队伍名单格式不正确，已保留上次结果');
    await this.save(new URL('contest-teams.json', this.directory), JSON.stringify(roster, null, 2));
    this.teamRoster = roster;
    this.teamError = '';
  }
  async syncTeams() {
    return this.recordMutation(async () => {
      if (!this.session.status().ready) throw new Error('请先登录雀魂，再同步队伍');
      // A completed or stopped replay job must not cancel an independent team read.
      const job = this.job;
      this.job = null;
      try { await this.fetchTeams(); }
      catch (error) { this.teamError = error.message; throw error; }
      finally { this.job = job; }
    });
  }
  async fetchReplay(uuid, clientVersion, item) {
    for (let attempt = 0; ; attempt++) {
      const response = this.protocol.decode('lq.ResGameRecord', await this.request(this.protocol.replayRequest(uuid, clientVersion)));
      const code = response.error?.code;
      // The batch endpoint can temporarily refuse a record even though the
      // same authenticated read succeeds later. Keep the retry bounded.
      if (![161, 540].includes(code) || attempt >= 3) return response;
      item.status = 'retrying';
      item.message = `雀魂暂未提供牌谱（错误 ${code}），等待后重试 ${attempt + 1} / 3`;
      await new Promise((resolve) => setTimeout(resolve, this.responseRetryDelayMs * 2 ** attempt));
      this.checkStopped();
    }
  }
  begin(job, work) {
    this.recordNotice = '';
    this.job = { startedAt: new Date().toISOString(), complete: false, duplicates: 0, errors: [], items: [], ...job };
    this.busy = true;
    this.running = Promise.resolve().then(work).catch((error) => {
      this.job.error = error.message;
      this.job.phase = this.job.cancelRequested ? 'stopped' : 'failed';
    }).finally(async () => {
      for (const item of this.job.items) if (item.status === 'waiting') { item.status = 'pending'; item.message = '尚未导入，重新同步可继续'; }
      this.job.phase = ['failed', 'stopped'].includes(this.job.phase) ? this.job.phase : this.job.items.some((item) => item.status === 'failed') ? 'partial' : 'done';
      this.job.complete = true;
      this.job.finishedAt = new Date().toISOString();
      if (this.job.kind === 'contest') {
        try { await this.save(new URL('contest-sync.json', this.directory), JSON.stringify(this.job, null, 2)); }
        catch (error) { this.job.error = `同步记录未能保存：${error.message}`; }
      }
      this.busy = false;
    });
    return this.state();
  }
  stop() {
    if (this.busy) this.job.cancelRequested = true;
    return this.state();
  }
  start(text) {
    this.assertIdle();
    const parsed = parseShareLinks(text);
    if (!parsed.replays.length) throw new Error(parsed.errors[0]?.message || '请粘贴牌谱分享链接');
    const needsDownload = parsed.replays.some((replay) => !this.games.has(replay.uuid));
    if (needsDownload && !this.session.status().ready) throw new Error('请先登录雀魂，再导入牌谱');
    return this.begin({
      kind: 'links', phase: 'downloading', duplicates: parsed.duplicateCount,
      errors: parsed.errors, items: parsed.replays.map((replay) => ({ uuid: replay.uuid, status: 'waiting', message: '' })),
    }, async () => {
      await this.run(parsed.replays);
      if (this.targetContestId && !this.teamRoster && this.games.size && this.session.status().ready) {
        this.checkStopped();
        try { await this.fetchTeams(); }
        catch (error) { this.checkStopped(); this.teamError = error.message; }
      }
    });
  }
  startContest() {
    this.assertIdle();
    if (!this.targetContestId) throw new Error('尚未配置比赛编号');
    if (!this.session.status().ready) throw new Error('请先登录雀魂，再一键导入比赛');
    return this.begin({ kind: 'contest', phase: 'listing', contestId: this.targetContestId, pages: 0, listedCount: 0 }, async () => {
      await this.ensureContest(true);
      this.index = { contestId: this.targetContestId, contestUid: this.contest.unique_id, startedAt: this.job.startedAt, paginationComplete: false, records: [], pages: 0 };
      await this.save(new URL('contest-index.json', this.directory), JSON.stringify(this.index, null, 2));
      const listed = await listContestRecords({
        protocol: this.protocol, contestUid: this.contest.unique_id,
        request: (wrapper) => this.request(wrapper), checkStopped: () => this.checkStopped(),
        onPage: async (page) => {
          Object.assign(this.index, page);
          if (page.paginationComplete) this.index.listedAt = new Date().toISOString();
          this.job.pages = page.pages; this.job.listedCount = page.records.length; this.job.duplicates = page.duplicateEntries;
          await this.save(new URL('contest-index.json', this.directory), JSON.stringify(this.index, null, 2));
        },
      });
      const replays = listed.records.sort((a, b) => a.startTime - b.startTime);
      this.job.items = replays.map(({ uuid }) => ({ uuid, status: 'waiting', message: '' }));
      this.job.phase = 'downloading';
      await this.run(replays);
      this.checkStopped();
      try { await this.fetchTeams(); }
      catch (error) { this.checkStopped(); this.teamError = error.message; }
    });
  }
  async run(replays) {
    for (let index = 0; index < replays.length; index++) {
      this.checkStopped();
      const replay = replays[index];
      const item = this.job.items[index];
      if (this.games.has(replay.uuid)) { item.status = 'cached'; item.message = '已在统计中，未重复计数'; continue; }
      item.status = 'downloading';
      try {
        const state = await this.session.poll();
        await this.ensureContest();
        const response = await this.fetchReplay(replay.uuid, state.clientVersion, item);
        if (response.error?.code) {
          if (response.error.code === 1004) throw new Error('登录会话不可用，请重新登录后重试');
          throw new Error(`雀魂未能提供这份牌谱（错误 ${response.error.code}）`);
        }
        if (response.head?.uuid !== replay.uuid) throw new Error('下载结果与分享链接不一致');
        if (this.contest && response.head.config?.meta?.contest_uid !== this.contest.unique_id) throw new Error(`这份牌谱不属于比赛 ${this.targetContestId}，未加入统计`);
        let data = response.data;
        if (response.data_url) {
          const url = new URL(response.data_url);
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.maj-soul.com')) throw new Error('雀魂返回了无法识别的牌谱下载地址');
          const download = await this.fetcher(url, { signal: AbortSignal.timeout(30000) });
          if (!download.ok) throw new Error(`牌谱下载失败（${download.status}），请重试`);
          data = Buffer.from(await download.arrayBuffer());
        }
        if (!data?.length) throw new Error('雀魂返回的牌谱内容为空');
        await this.save(this.path(replay.uuid, 'head.json'), JSON.stringify(response.head, null, 2));
        await this.save(this.path(replay.uuid, 'bin'), data);
        this.recordIds ||= new Set(); this.recordIds.add(replay.uuid);
        item.status = 'analyzing';
        const game = analyzeGame(response.head, this.protocol.records(data));
        await this.save(this.path(replay.uuid, 'analysis.json'), JSON.stringify(game, null, 2));
        this.games.set(replay.uuid, game);
        this.cacheErrors = this.cacheErrors.filter((error) => error.uuid !== replay.uuid);
        item.status = 'done';
        item.message = `已统计全桌四位选手，共 ${game.roundCount} 局`;
      } catch (error) {
        item.status = 'failed'; item.message = error.message;
        if (!this.session.status().ready || this.job.cancelRequested) throw error;
      }
    }
  }
}
