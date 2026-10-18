import { mkdir, writeFile } from 'node:fs/promises';
import { Protocol } from '../src/protocol.mjs';

// Only public resources are fetched. No account or browser session is used.
const base = new URL('https://game.maj-soul.com/1/');
const cache = new URL('../.cache/', import.meta.url);
async function get(resource) {
  const url = new URL(resource, base);
  if (url.origin !== base.origin) throw new Error('协议资源地址不属于官方域名');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`协议下载失败：HTTP ${response.status}`);
  return response.json();
}
const version = await get('version.json');
if (typeof version.version !== 'string' || !/^[\w.-]+$/.test(version.version)) throw new Error('官方协议版本格式已变更');
const resources = await get(`resversion${version.version}.json`);
const prefix = resources.res?.['res/proto/liqi.json']?.prefix;
if (typeof prefix !== 'string' || !/^[\w./-]+$/.test(prefix)) throw new Error('官方协议资源地址已变更');
const definition = await get(`${prefix}/res/proto/liqi.json`);
const protocol = new Protocol(definition, version.version);
for (const type of ['lq.ResGameRecord', 'lq.ReqFetchCustomizedContestGameRecords', 'lq.RecordHule']) protocol.root.lookupType(type);
await mkdir(cache, { recursive: true });
await writeFile(new URL('liqi.json', cache), JSON.stringify(definition));
await writeFile(new URL('version.json', cache), JSON.stringify({ version: version.version }));
console.log(`已缓存官方公开协议：${version.version}`);
