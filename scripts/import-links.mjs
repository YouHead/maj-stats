// Developer entry point for link intake. Queuing a link is not replay download.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseShareLinks } from '../src/share-links.mjs';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('用法：node scripts/import-links.mjs "雀魂牌谱:https://game.maj-soul.com/1/?paipu=..."');
  console.log('批量：node scripts/import-links.mjs --file links.txt');
  process.exit(0);
}
const input = args[0] === '--file' ? await readFile(args[1], 'utf8') : args.join('\n');
const parsed = parseShareLinks(input.replace(/^\uFEFF/, ''));
if (!parsed.replays.length) {
  console.error('未识别到有效牌谱链接。', parsed.errors);
  process.exit(2);
}
const dataDirectory = new URL('../data/', import.meta.url);
const manifestPath = new URL('replays.json', dataDirectory);
await mkdir(dataDirectory, { recursive: true });
let existing = { format: 'maj-stats-link-queue-v1', replays: [] };
try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing.format !== 'maj-stats-link-queue-v1' || !Array.isArray(existing.replays)) {
  throw new Error('现有链接队列格式不兼容，未修改该文件');
}
const byId = new Map(existing.replays.map((item) => [item.uuid, item]));
let added = 0;
let duplicates = parsed.duplicateCount;
for (const replay of parsed.replays) {
  if (byId.has(replay.uuid)) { duplicates++; continue; }
  byId.set(replay.uuid, { ...replay, status: 'awaiting_download', addedAt: new Date().toISOString() });
  added++;
}
await writeFile(manifestPath, JSON.stringify({ ...existing, replays: [...byId.values()] }, null, 2) + '\n');
console.log(JSON.stringify({
  addedLinks: added,
  duplicatesSkipped: duplicates,
  totalLinks: byId.size,
  errors: parsed.errors,
  queueFile: fileURLToPath(manifestPath),
  downloadStatus: '尚未下载牌谱；链接识别和去重不代表统计已完成。',
}, null, 2));
if (parsed.errors.length) process.exitCode = 2;
