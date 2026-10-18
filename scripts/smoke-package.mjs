import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixture, ids } from '../tests/fixtures/record-management.mjs';
import ExcelJS from 'exceljs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'))).version;
const executable = process.argv.includes('--unpacked') ? path.join(root, 'dist', 'win-unpacked', '雀赛统计.exe') : path.join(root, 'dist', `雀赛统计-${version}-Windows-x64.exe`);
const base = path.join(root, '.cache', 'tests'); await mkdir(base, { recursive: true });
const testRoot = await mkdtemp(path.join(base, 'packaged-exe-'));
const firstUser = path.join(testRoot, 'user-a'), secondUser = path.join(testRoot, 'user-b');
let child, origin, lastPid;
const outputs = new WeakMap();
const report = { version, executable: path.basename(executable), startedAt: new Date().toISOString(), checks: [] };
async function state() { return (await fetch(`${origin}/api/state`)).json(); }
async function post(route, data = {}) {
  const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function launch(directory) {
  await mkdir(directory, { recursive: true });
  child = spawn(executable, ['--smoke-test'], { cwd: directory, windowsHide: true, env: { ...process.env, MAJ_STATS_TEST_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const launched = child;
  const collect = (chunk) => { output += chunk; outputs.set(launched, output); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`exe 提前退出：${child.exitCode} ${output}`);
    try {
      const runtime = JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'));
      if (runtime.pid !== lastPid) {
        origin = runtime.url;
        const result = await state();
        assert.equal(result.application.packaged, true); assert.equal(result.application.version, version);
        assert.equal(result.application.storageRoot, directory);
        assert.equal(result.application.profilePath, path.join(directory, 'profile'));
        assert.equal(result.session.ready, false);
        lastPid = runtime.pid;
        console.log(`已启动实际 exe，独立数据目录：${path.basename(directory)}`);
        return result;
      }
    } catch (_) {}
    await delay(250);
  }
  throw new Error(`exe 启动超时 ${output}`);
}
async function quit() {
  if (!child || child.exitCode !== null) return;
  const processToWait = child;
  await post('/api/quit');
  if (processToWait.exitCode === null) await Promise.race([new Promise((resolve) => processToWait.once('exit', resolve)), delay(12000, undefined, { ref: false }).then(() => { if (processToWait.exitCode === null) throw new Error('exe 退出超时'); })]);
  assert.doesNotMatch(outputs.get(processToWait) || '', /应用启动失败|ERR_ABORTED|Uncaught Exception/i, '正常退出时不能误报启动失败');
  child = null; origin = null;
}
try {
  let current = await launch(firstUser);
  assert.equal(current.summary.gameCount, 0); assert.equal(current.recordCount, 0);
  assert.equal(current.cacheErrors.length, 0); assert.equal(current.trash.length, 0);
  const html = await (await fetch(origin)).text(); assert.ok(html.includes('id="open-data"')); assert.ok(!html.includes(ids[0]));
  assert.ok(!html.includes('每一局，都有据可查')); assert.ok(!html.includes('class="intro"'));
  await post('/api/contest/select', { contestId: 196078 });
  report.checks.push('clean-first-start-no-private-records-or-login', 'bundled-public-protocol-without-network', 'assets-and-local-server');
  await quit();
  const fixture = await createFixture();
  await cp(fileURLToPath(fixture.manager.current.directory), path.join(firstUser, 'data', 'contests', '196077', 'replays'), { recursive: true });
  current = await launch(firstUser);
  assert.equal(current.contest.contest_id, 196078); assert.equal(current.summary.gameCount, 0);
  await post('/api/contest/select', { contestId: 196077 }); current = await state();
  assert.equal(current.summary.gameCount, 2); assert.equal(current.summary.players.length, 4);
  const firstPlayer = current.summary.players.find((player) => player.accountId === 1);
  assert.equal(firstPlayer.totalPt, 106.4); assert.equal(firstPlayer.averagePt, 53.2);
  assert.equal(current.games[0].players[0].pt, 53.2);
  assert.equal(firstPlayer.teamName, '合成甲队'); assert.equal(current.teams[0].totalPt, 119.8); assert.equal(current.teams[1].totalPt, -119.8);
  assert.equal(current.sync.allImported, true); assert.equal(current.cacheErrors.length, 0);
  const excel = await fetch(`${origin}/api/export.xlsx`);
  assert.equal(excel.status, 200); assert.match(excel.headers.get('content-type'), /spreadsheetml/);
  const bytes = Buffer.from(await excel.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('选手统计');
  assert.equal(sheet.getCell('D5').value, 'PT'); assert.equal(sheet.getCell('E5').value, '对局数');
  assert.ok(!sheet.getRow(5).values.includes('平均 PT'));
  assert.equal(sheet.getCell('D6').numFmt, '0.0;[Red]-0.0;0.0');
  assert.equal(sheet.getCell('C5').value, '队伍'); assert.equal(sheet.getCell('C6').value, '合成甲队');
  assert.equal(workbook.getWorksheet('队伍 PT').getCell('C6').value, 119.8);
  report.checks.push('cached-team-roster-and-team-PT');
  assert.match(html, /id="link-import"/); assert.match(html, /id="import-log"/); assert.match(html, /href="\/records"/); assert.ok(!html.includes('id="replays-fold"'));
  const recordPage = await fetch(`${origin}/records`); assert.equal(recordPage.status, 200); const recordHtml = await recordPage.text();
  assert.match(recordHtml, /id="record-from"/); assert.match(recordHtml, /id="record-to"/); assert.match(recordHtml, /id="record-player"/);
  assert.equal((await fetch(`${origin}/record-list.js`)).status, 200);
  assert.equal(workbook.getWorksheet('队伍 PT').getCell('A7').value, 2); assert.equal(workbook.getWorksheet('队伍 PT').getCell('D7').value, 239.6);
  report.checks.push('record-page-and-team-ranking-gap');
  const detail = await (await fetch(`${origin}/api/records/detail?contestId=196077&uuid=${ids[0]}`)).json();
  assert.equal(detail.roundCount, 1); assert.equal(detail.drawCount, 0); assert.equal(detail.players[0].winCount, 1);
  assert.equal(detail.scoreHistory.points.length, 2); assert.deepEqual(detail.scoreHistory.points[0].scores, [25000,25000,25000,25000]);
  assert.equal(detail.players[0].finalScore, 40000); assert.equal(detail.players[0].pt, 53.2);
  assert.match(await (await fetch(`${origin}/replay-details.js`)).text(), /打开牌谱/);
  report.checks.push('cached-replay-detail-counts-and-score-history');
  const metricSource = await (await fetch(`${origin}/metrics.js`)).text();
  assert.ok(!metricSource.includes('点击列名切换升序或降序')); assert.ok(!metricSource.includes("metric('averagePt'"));
  await writeFile(path.join(testRoot, 'packaged-export.xlsx'), bytes);
  await post('/api/records/delete', { contestId: 196077, uuid: ids[0], confirmed: true });
  assert.equal((await state()).summary.gameCount, 1);
  await post('/api/records/restore', { contestId: 196077, batchId: (await state()).trash[0].id });
  assert.equal((await state()).summary.gameCount, 2);
  await post('/api/records/clear', { contestId: 196077, confirmed: true });
  assert.equal((await state()).summary.gameCount, 0);
  await post('/api/records/restore', { contestId: 196077, batchId: (await state()).trash[0].id });
  assert.equal((await state()).summary.gameCount, 2);
  report.checks.push('contest-selection-survives-restart', 'cached-replay-analysis-in-asar', 'tournament-pt-and-compact-interface', 'real-excel-export', 'delete-restore-clear-in-packaged-app');
  await quit();
  current = await launch(firstUser);
  assert.equal(current.summary.gameCount, 2); assert.equal(current.contest.contest_id, 196077); assert.equal(current.teams[0].totalPt, 119.8);
  report.checks.push('records-and-recovery-survive-portable-extraction-and-restart');
  await quit();
  current = await launch(secondUser);
  assert.equal(current.summary.gameCount, 0); assert.equal(current.recordCount, 0);
  assert.equal(current.trash.length, 0); assert.equal(current.session.ready, false); assert.equal(current.teams.length, 0);
  report.checks.push('independent-user-does-not-inherit-first-user-data');
  if (process.argv.includes('--keep-preview')) {
    await writeFile(path.join(root, '.local', 'packaged-preview-runtime.json'), JSON.stringify({ url: origin, dataDirectory: secondUser }));
    console.log('空白发行版预览已保留，验证后通过 /api/quit 关闭。');
    child.stdout.destroy(); child.stderr.destroy(); child.unref(); child = null;
  } else await quit();
  report.completedAt = new Date().toISOString(); report.passed = true;
  await writeFile(path.join(root, 'dist', 'smoke-verification.json'), JSON.stringify(report, null, 2));
  console.log(`实际 exe 验证通过：${report.checks.length} 项检查。`);
} finally {
  if (child && child.exitCode === null && origin) await quit().catch(() => {});
}
