import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadProtocol } from '../src/protocol.mjs';
import config from '../electron-builder.cjs';
const { resolveAppPaths } = createRequire(import.meta.url)('../app/paths.cjs');
const baseOptions = { isPackaged: true, projectRoot: path.resolve('dist/resources/app.asar'), appData: path.resolve('.cache/Roaming'), localAppData: path.resolve('.cache/Local') };

test('release data and sessions use a stable per-user directory outside the executable', () => {
  const result = resolveAppPaths(baseOptions);
  assert.equal(result.storageRoot, path.join(baseOptions.localAppData, 'MajStats'));
  assert.equal(result.profile, path.join(result.storageRoot, 'profile'));
  assert.equal(result.contests, path.join(result.storageRoot, 'data', 'contests'));
  assert.equal(result.legacy, null);
  assert.deepEqual(resolveAppPaths({ ...baseOptions, projectRoot: path.resolve('.cache/another-temp-app.asar') }), result);
  assert.equal(resolveAppPaths({ ...baseOptions, localAppData: undefined }).storageRoot, path.join(baseOptions.appData, 'MajStats'));
});

test('development preserves existing paths and an isolated smoke test never uses the real profile', () => {
  const result = resolveAppPaths({ ...baseOptions, isPackaged: false });
  assert.equal(result.profile, path.join(baseOptions.projectRoot, '.local', 'profile'));
  assert.equal(result.contests, path.join(baseOptions.projectRoot, 'data', 'contests'));
  const isolated = path.resolve('.cache/disposable-package-test');
  assert.equal(resolveAppPaths({ ...baseOptions, testDataDirectory: isolated }).storageRoot, isolated);
  assert.throws(() => resolveAppPaths({ ...baseOptions, testDataDirectory: '../relative' }), /绝对路径/);
});

test('release configuration allows only runtime code, dependencies and two public protocol files', () => {
  assert.deepEqual(config.files, ['app/**', 'src/**', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '!**/*.map']);
  assert.deepEqual(config.extraResources[0].filter, ['liqi.json', 'version.json']);
  assert.equal(config.portable.requestExecutionLevel, 'user');
  assert.equal(config.publish, null);
});

test('first release boot initializes an empty user cache from bundled public resources without network', async () => {
  const base = new URL('../.cache/tests/', import.meta.url); await mkdir(base, { recursive: true });
  const root = pathToFileURL((await mkdtemp(path.join(fileURLToPath(base), 'bundled-protocol-'))) + path.sep);
  const bundledDirectory = new URL('public/', root), cache = new URL('cache/', root);
  await mkdir(bundledDirectory);
  const definition = { nested: { lq: { nested: { Example: { fields: { value: { type: 'uint32', id: 1 } } } } } } };
  await writeFile(new URL('version.json', bundledDirectory), JSON.stringify({ version: 'fixture-1' }));
  await writeFile(new URL('liqi.json', bundledDirectory), JSON.stringify(definition));
  let calls = 0;
  const network = async () => { calls++; throw new Error('Unexpected network request'); };
  const protocol = await loadProtocol(cache, network, { bundledDirectory });
  assert.equal(protocol.version, 'fixture-1');
  assert.equal(protocol.decode('lq.Example', protocol.encode('lq.Example', { value: 42 })).value, 42);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(await readFile(new URL('liqi.json', cache))), definition);
  await writeFile(new URL('version.json', bundledDirectory), JSON.stringify({ version: 'fixture-2' }));
  assert.equal((await loadProtocol(cache, network, { bundledDirectory })).version, 'fixture-1');
});
