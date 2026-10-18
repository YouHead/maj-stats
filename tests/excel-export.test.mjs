import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { analyzeGame, aggregateGames } from '../src/statistics.mjs';
import { METRICS } from '../src/metrics.mjs';
import { createExcelExport } from '../src/excel-export.mjs';
import { createServer } from '../src/server.mjs';

const game = analyzeGame({
  uuid: '260101-00000001-0000-4000-8000-000000000007',
  accounts: [0, 1, 2, 3].map((seat) => ({ seat, account_id: seat + 1, nickname: seat === 0 ? '=1+1' : `Player ${seat + 1}` })),
  result: { players: [0, 1, 2, 3].map((seat) => ({ seat, part_point_1: 40000 - seat * 10000, total_point: [45000, 0, -10000, -35000][seat] })) },
}, [
  { name: 'RecordNewRound', data: { scores: [25000, 25000, 25000, 25000] } },
  { name: 'RecordDiscardTile', data: { seat: 3 } },
  { name: 'RecordHule', data: { hules: [{ seat: 0, point_rong: 1000 }], delta_scores: [1000, 0, 0, -1000] } },
]);
const state = { summary: aggregateGames([game]), games: [{ uuid: game.uuid, startTime: game.startTime, players: game.players.map((player) => ({ ...player, ptRaw: player.ptRawSum })) }], contest: { contest_id: 196077 }, sync: { listedAt: '2026-10-18T02:40:48Z', importedCount: 1, listedCount: 1, allImported: true } };

test('exports a real workbook with numeric metrics, all counters, definitions, frozen names and safe text', async () => {
  const bytes = await createExcelExport(state, { sortKey: 'winRate', direction: 'desc' });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['选手统计', '队伍 PT', '原始计数', '统计口径', '逐场 PT']);
  const sheet = workbook.getWorksheet('选手统计');
  assert.equal(sheet.getCell('A6').value, '=1+1');
  assert.equal(sheet.getCell('A6').type, ExcelJS.ValueType.String);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].xSplit, 3); assert.equal(sheet.views[0].ySplit, 5);
  assert.equal(sheet.rowCount, 9);
  assert.ok(sheet.autoFilter);
  const winner = state.summary.players.find((player) => player.accountId === 1);
  METRICS.forEach((item, index) => {
    assert.equal(sheet.getCell(5, index + 4).value, item.label);
    assert.equal(sheet.getCell(6, index + 4).value, winner[item.key]);
    if (item.type === 'percent') assert.equal(sheet.getCell(6, index + 4).numFmt, '0.00%');
  });
  assert.match(JSON.stringify(sheet.getCell(5, METRICS.findIndex((item) => item.key === 'tsumoRate') + 4).note), /自摸局数/);
  assert.equal(workbook.getWorksheet('原始计数').getCell('A6').value, '=1+1');
  assert.match(sheet.getCell('A3').value, /本次查询全部完成/);
  const ptColumn = METRICS.findIndex((item) => item.key === 'totalPt') + 4;
  assert.equal(sheet.getCell(6, ptColumn).value, 45); assert.equal(sheet.getCell(6, ptColumn).numFmt, '0.0;[Red]-0.0;0.0');
  const individual = workbook.getWorksheet('逐场 PT');
  assert.equal(individual.rowCount, 9); assert.equal(individual.views[0].xSplit, 2);
  assert.equal(individual.getCell('A6').value, '=1+1'); assert.equal(individual.getCell('F6').value, 45000); assert.equal(individual.getCell('G6').value, 45);
  assert.equal(individual.getCell('G7').value, 0); assert.equal(individual.getCell('G8').value, -10);
  assert.equal(individual.getCell('G8').numFmt, '0.0;[Red]-0.0;0.0');
});

test('defaults Excel to PT descending, places games after PT and excludes average PT', async () => {
  const players = state.summary.players.map((player) => ({ ...player, totalPt: { 1: -1, 2: 45, 3: 0, 4: -2 }[player.accountId] }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createExcelExport({ ...state, summary: { ...state.summary, players } }));
  const sheet = workbook.getWorksheet('选手统计');
  assert.deepEqual([sheet.getCell('D5').value, sheet.getCell('E5').value], ['PT', '对局数']);
  assert.ok(!sheet.getRow(5).values.includes('平均 PT'));
  assert.deepEqual([6, 7, 8, 9].map((row) => sheet.getCell(row, 2).value), ['2', '3', '1', '4']);
  assert.equal(sheet.getCell('D8').value, -1);
  assert.equal(sheet.getCell('D8').numFmt, '0.0;[Red]-0.0;0.0');
});

test('marks partial coverage and refuses empty exports or unknown sort keys', async () => {
  const bytes = await createExcelExport({ ...state, sync: { ...state.sync, listedCount: 2, allImported: false } });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.match(workbook.getWorksheet('选手统计').getCell('A3').value, /尚未全部完成/);
  await assert.rejects(createExcelExport({ summary: { players: [] } }), /先导入/);
  await assert.rejects(createExcelExport(state, { sortKey: 'invalid' }), /不正确/);
});

test('downloads Excel over the local endpoint and serves the shared browser metric definitions', async (context) => {
  const { server, origin } = await createServer({ session: { status: () => ({}) }, store: { state: () => state } });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`${origin}/api/export.xlsx?sort=winRate&direction=desc`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml.sheet/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.getWorksheet('选手统计').rowCount, 9);
  const definitions = await fetch(`${origin}/metrics.js`);
  assert.equal(definitions.status, 200); assert.match(await definitions.text(), /自摸局数/);
  assert.equal((await fetch(`${origin}/api/export.xlsx?sort=invalid`)).status, 400);
});
