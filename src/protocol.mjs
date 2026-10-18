import { readFile, writeFile, mkdir } from 'node:fs/promises';
import protobuf from 'protobufjs';

const BASE = 'https://game.maj-soul.com/1/';
const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

export class Protocol {
  constructor(definition, version = '') {
    this.root = protobuf.Root.fromJSON(definition);
    this.version = version;
  }
  encode(typeName, value) {
    const type = this.root.lookupType(typeName);
    const error = type.verify(value);
    if (error) throw new Error(`Invalid ${typeName}: ${error}`);
    return Buffer.from(type.encode(type.create(value)).finish());
  }
  decode(typeName, bytes) {
    const type = this.root.lookupType(typeName);
    return type.toObject(type.decode(bytes), { defaults: true, longs: Number, enums: Number, bytes: Buffer });
  }
  wrap(name, value) {
    return this.encode('lq.Wrapper', { name, data: this.encode(name, value) });
  }
  unwrap(bytes) {
    const wrapper = this.decode('lq.Wrapper', bytes);
    if (!wrapper.name.startsWith('.lq.')) throw new Error('牌谱消息类型不正确');
    return { name: wrapper.name.slice(4), data: this.decode(wrapper.name, wrapper.data) };
  }
  replayRequest(uuid, clientVersion = '') {
    return this.encode('lq.Wrapper', {
      name: '.lq.Lobby.fetchGameRecord',
      data: this.encode('lq.ReqGameRecord', { game_uuid: uuid, client_version_string: clientVersion }),
    });
  }
  contestRequest(contestId) {
    return this.encode('lq.Wrapper', {
      name: '.lq.Lobby.fetchCustomizedContestByContestId',
      data: this.encode('lq.ReqFetchCustomizedContestByContestId', { contest_id: contestId }),
    });
  }
  contestRecordsRequest(uniqueId, lastIndex = 0) {
    return this.encode('lq.Wrapper', {
      name: '.lq.Lobby.fetchCustomizedContestGameRecords',
      data: this.encode('lq.ReqFetchCustomizedContestGameRecords', { unique_id: uniqueId, last_index: lastIndex }),
    });
  }
  contestTeamsRequest(uniqueId, offset = 0, limit = 50) {
    return this.encode('lq.Wrapper', { name: '.lq.Lobby.fetchContestTeamRank', data: this.encode('lq.ReqFetchContestTeamRank', { unique_id: uniqueId, offset, limit }) });
  }
  contestTeamMembersRequest(uniqueId, teamId, offset = 0, limit = 50) {
    return this.encode('lq.Wrapper', { name: '.lq.Lobby.fetchContestTeamMember', data: this.encode('lq.ReqFetchContestTeamMember', { unique_id: uniqueId, team_id: teamId, offset, limit }) });
  }
  records(bytes) {
    const { name, data } = this.unwrap(bytes);
    if (name !== 'GameDetailRecords') throw new Error(`不支持的牌谱容器：${name}`);
    const messages = data.version >= 210715
      ? data.actions.filter((action) => action.result?.length).map((action) => action.result)
      : data.records;
    if (!messages.length) throw new Error('牌谱中没有完整对局事件');
    return messages.map((message) => this.unwrap(message));
  }
}

export async function loadProtocol(cacheDirectory, fetcher = fetch, { bundledDirectory } = {}) {
  await mkdir(cacheDirectory, { recursive: true });
  let version;
  let definition;
  try {
    version = await json(new URL('version.json', cacheDirectory));
    definition = await json(new URL('liqi.json', cacheDirectory));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (bundledDirectory) {
      // The release contains only public protocol files, never a user cache.
      const bundled = await Promise.all([json(new URL('version.json', bundledDirectory)), json(new URL('liqi.json', bundledDirectory))]);
      new Protocol(bundled[1], bundled[0].version);
      await Promise.all([writeFile(new URL('version.json', cacheDirectory), JSON.stringify(bundled[0])), writeFile(new URL('liqi.json', cacheDirectory), JSON.stringify(bundled[1]))]);
      return new Protocol(bundled[1], bundled[0].version);
    }
    const get = async (path) => {
      const response = await fetcher(new URL(path, BASE), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('无法取得雀魂客户端协议，请检查网络后重试');
      return response.json();
    };
    version = await get('version.json');
    const resources = await get(`resversion${version.version}.json`);
    const prefix = resources.res['res/proto/liqi.json']?.prefix;
    if (!prefix) throw new Error('雀魂协议资源地址已变更');
    definition = await get(`${prefix}/res/proto/liqi.json`);
    await writeFile(new URL('version.json', cacheDirectory), JSON.stringify(version));
    await writeFile(new URL('liqi.json', cacheDirectory), JSON.stringify(definition));
  }
  return new Protocol(definition, version.version);
}
