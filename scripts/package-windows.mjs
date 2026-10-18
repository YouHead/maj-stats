import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build, Platform, Arch } from 'electron-builder';
import { Protocol, loadProtocol } from '../src/protocol.mjs';
import config from '../electron-builder.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= '5';
// This workstation uses a bundled Node runtime rather than a global npm install.
const bundledNpm = path.join(root, '.cache', 'tooling', 'package', 'bin', 'npm-cli.js');
try {
  await access(bundledNpm);
  const shimDirectory = path.join(root, '.cache', 'tooling', 'npm-shim');
  await mkdir(shimDirectory, { recursive: true });
  await writeFile(path.join(shimDirectory, 'npm.cmd'), `@echo off\r\n"${process.execPath}" "${bundledNpm}" %*\r\n`);
  process.env.PATH = `${shimDirectory}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const seed = new URL('../.cache/release-protocol/', import.meta.url);
await mkdir(seed, { recursive: true });
await loadProtocol(new URL('../.cache/', import.meta.url));
const version = JSON.parse(await readFile(new URL('../.cache/version.json', import.meta.url), 'utf8'));
const definition = JSON.parse(await readFile(new URL('../.cache/liqi.json', import.meta.url), 'utf8'));
const protocol = new Protocol(definition, version.version);
for (const type of ['lq.ResGameRecord', 'lq.ReqFetchCustomizedContestGameRecords', 'lq.RecordHule']) protocol.root.lookupType(type);
await writeFile(new URL('version.json', seed), JSON.stringify({ version: version.version }));
await writeFile(new URL('liqi.json', seed), JSON.stringify(definition));
const icon = spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts', 'create-icon.ps1')], { stdio: 'inherit', cwd: root });
if (icon.status !== 0) throw new Error('应用图标生成失败');
const packageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;
const artifacts = process.argv.includes('--verify-only')
  ? [path.join(root, 'dist', `雀赛统计-${packageVersion}-Windows-x64.exe`)]
  : await build({ projectDir: root, targets: Platform.WINDOWS.createTarget('portable', Arch.x64), config });
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const files = asar.listPackage(archive).map((name) => name.replaceAll('\\', '/').replace(/^\//, ''));
const unexpected = files.filter((name) => !['app', 'src', 'node_modules', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'].some((allowed) => name === allowed || name.startsWith(allowed + '/')));
if (unexpected.length) throw new Error(`发布包出现未允许的文件：${unexpected.join(', ')}`);
const ownFiles = files.filter((name) => /^(app|src)\/.*\.(cjs|mjs|js|html|css)$/.test(name));
for (const file of ownFiles) {
  const packed = asar.extractFile(archive, path.normalize(file));
  if (!packed.equals(await readFile(path.join(root, file)))) throw new Error(`发行内容与当前源码不一致，请重新打包：${file}`);
  if (/\b\d{6}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i.test(packed.toString())) throw new Error(`发布包含硬编码牌谱标识：${file}`);
}
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  if (!asar.extractFile(archive, file).equals(await readFile(path.join(root, file)))) throw new Error(`发行许可文件缺失或过期：${file}`);
  await copyFile(path.join(root, file), path.join(root, 'dist', file));
}
await copyFile(new URL('../发行说明.txt', import.meta.url), new URL('../dist/使用说明.txt', import.meta.url));
const checksumLines = [];
for (const artifact of artifacts.filter((file) => file.endsWith('.exe'))) {
  const hash = createHash('sha256').update(await readFile(artifact)).digest('hex').toUpperCase();
  checksumLines.push(`${hash}  ${path.basename(artifact)}`);
}
await writeFile(new URL('../dist/SHA256.txt', import.meta.url), checksumLines.join('\r\n') + '\r\n');
await writeFile(new URL('../dist/package-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), version: JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version, artifacts: artifacts.map((file) => path.basename(file)), archiveFiles: files.length, publicProtocolFiles: ['liqi.json', 'version.json'], personalDataIncluded: false }, null, 2));
console.log('打包完成：白名单检查通过，未包含牌谱记录、登录配置或个人样本。');
