import ExcelJS from 'exceljs';
import { METRICS, DEFAULT_SORT, sortPlayers } from './metrics.mjs';
import { PLAYER_COUNTERS } from './statistics.mjs';
import { rankTeams } from './team-ranking.mjs';

const GREEN = '245D46';
const labels = {
  games: '对局数', rounds: '小局数', firsts: '一位次数', seconds: '二位次数', thirds: '三位次数', fourths: '四位次数', rankSum: '顺位合计',
  wins: '和牌次数', dealIns: '放铳局数', riichiRounds: '立直宣言局数', openRounds: '副露局数', tsumoWins: '自摸次数', ronWins: '荣和次数',
  damatenWins: '默胡次数', drawRounds: '荒牌流局次数', abortiveDrawRounds: '途中流局次数', tenpaiDraws: '荒牌听牌次数', tenpaiObservedDraws: '听牌信息已知的荒牌次数',
  winPoints: '和牌打点合计', dealInPoints: '放铳支付合计', dealInObserved: '支付信息已知的放铳局数', winTurnSum: '和牌巡数合计',
  ptRawSum: '结算分合计（原始）', ptObservedGames: '结算分已知的对局数',
};
function setup(sheet, columns, title, subtitle, scope) {
  sheet.columns = columns.map(({ header, width = 15 }) => ({ header, width }));
  // Replace the library's row-one column headers with an explicit title block.
  sheet.getRow(1).values = [];
  for (let row = 1; row <= 4; row++) sheet.mergeCells(row, 1, row, columns.length);
  [title, subtitle, scope, '空白表示分母为 0 或必要明细不全；百分比为数值，可在 Excel 中继续排序。'].forEach((text, index) => { sheet.getCell(index + 1, 1).value = text; });
  sheet.getRow(1).height = 32;
  sheet.getRow(1).font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  for (let row = 2; row <= 4; row++) { sheet.getRow(row).height = 24; sheet.getRow(row).font = { name: 'Microsoft YaHei', size: 11, color: { argb: row === 3 ? GREEN : '65766A' } }; }
  sheet.getRow(5).values = columns.map((column) => column.header);
  sheet.getRow(5).height = 30;
  sheet.getRow(5).font = { name: 'Microsoft YaHei', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  sheet.getRow(5).alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 5, activeCell: 'C6' }];
  sheet.properties.defaultRowHeight = 23;
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5', printTitlesColumn: 'A:B' };
}
function addRow(sheet, values) {
  const row = sheet.addRow(values);
  row.font = { name: 'Microsoft YaHei', size: 11, color: { argb: '24352E' } };
  row.alignment = { vertical: 'middle' };
  row.height = 25;
  if (row.number % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F7F3' } };
  row.getCell(1).font = { ...row.font, bold: true };
  return row;
}

export async function createExcelExport(state, { sortKey = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction } = {}) {
  if (!state.summary.players.length) throw new Error('请先导入牌谱，再导出 Excel');
  const players = sortPlayers(state.summary.players, sortKey, direction);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '雀赛统计';
  workbook.created = new Date();
  const contestId = state.contest?.contest_id || '未指定';
  const title = `雀魂比赛 ${contestId} · 选手统计`;
  const source = `来源：本机已导入的雀魂牌谱；列表查询时间 ${state.sync?.listedAt ? new Date(state.sync.listedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未查询比赛列表'}`;
  const coverage = `${state.summary.gameCount} 份牌谱 · ${state.summary.roundCount} 局 · ${players.length} 位选手；${state.sync ? `列表覆盖 ${state.sync.importedCount} / ${state.sync.listedCount} 份，${state.sync.allImported ? '本次查询全部完成' : '尚未全部完成'}` : '仅含已导入牌谱'}`;
  const summary = workbook.addWorksheet('选手统计');
  const columns = [{ header: '选手', width: 23 }, { header: '账号 ID', width: 15 }, { header: '队伍', width: 23 }, ...METRICS.map((item) => ({ header: item.label, width: item.type === 'integer' ? 11 : 13 }))];
  setup(summary, columns, title, state.contest?.contest_name || '按账号 ID 汇总，按牌谱 UUID 去重', coverage);
  summary.views = [{ state: 'frozen', xSplit: 3, ySplit: 5, activeCell: 'D6' }];
  summary.pageSetup.printTitlesColumn = 'A:C';
  for (const player of players) {
    const row = addRow(summary, [player.nickname, player.accountId ? String(player.accountId) : '', player.teamName || '', ...METRICS.map((item) => Number.isFinite(player[item.key]) ? player[item.key] : null)]);
    METRICS.forEach((item, index) => { row.getCell(index + 4).numFmt = item.type === 'percent' ? '0.00%' : item.type === 'decimal' ? '0.000' : item.type === 'pt' ? '0.0;[Red]-0.0;0.0' : '#,##0'; });
    const detailColumn = METRICS.findIndex((item) => item.key === 'rounds') + 4;
    row.getCell(detailColumn).border = { left: { style: 'medium', color: { argb: 'C4D1C5' } } };
  }
  METRICS.forEach((item, index) => { if (item.type !== 'pt') summary.getCell(5, index + 4).note = item.description; });
  summary.autoFilter = { from: { row: 5, column: 1 }, to: { row: players.length + 5, column: columns.length } };
  const teams = workbook.addWorksheet('队伍 PT');
  setup(teams, [{ header: '序号', width: 9 }, { header: '队伍', width: 30 }, { header: 'PT', width: 16 }, { header: '与上位之差', width: 18 }], `比赛 ${contestId} · 队伍 PT`, 'PT 为队伍成员已导入牌谱的结算 PT 之和；与上位之差 = 上一名 PT - 本队 PT。', coverage);
  teams.views = [{ state: 'frozen', xSplit: 2, ySplit: 5, activeCell: 'C6' }];
  const rankedTeams = rankTeams(state.teams || []);
  for (const team of rankedTeams) {
    const row = addRow(teams, [team.rank, team.name, team.totalPt, team.gapToPrevious]);
    row.getCell(3).numFmt = '0.0;[Red]-0.0;0.0';
    row.getCell(4).numFmt = '0.0';
  }
  if (state.teams?.length) teams.autoFilter = { from: { row: 5, column: 1 }, to: { row: teams.rowCount, column: 4 } };
  else addRow(teams, [null, '尚无队伍名单，请在软件中同步队伍', null, null]);
  const counts = workbook.addWorksheet('原始计数');
  setup(counts, [{ header: '选手', width: 25 }, { header: '账号 ID', width: 17 }, ...PLAYER_COUNTERS.map((key) => ({ header: labels[key], width: key.includes('Observed') ? 25 : 18 }))], '逐选手累计计数', source, coverage);
  for (const player of players) {
    const row = addRow(counts, [player.nickname, player.accountId ? String(player.accountId) : '', ...PLAYER_COUNTERS.map((key) => player[key])]);
    PLAYER_COUNTERS.forEach((key, index) => { row.getCell(index + 3).numFmt = key === 'winTurnSum' ? '0.000' : '#,##0'; });
  }
  counts.autoFilter = { from: { row: 5, column: 1 }, to: { row: players.length + 5, column: PLAYER_COUNTERS.length + 2 } };
  const definitions = workbook.addWorksheet('统计口径');
  setup(definitions, [{ header: '指标', width: 22 }, { header: '定义', width: 115 }], '指标定义与数据范围', '与软件使用同一份指标定义', coverage);
  definitions.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, activeCell: 'B6' }];
  for (const item of METRICS) {
    const row = addRow(definitions, [item.label, item.description]);
    row.height = 45; row.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  }
  addRow(definitions, ['途中流局', '不计入荒牌流局率、流听率的分子；计入参与局数。原始计数单独保留途中流局次数。']).height = 45;
  addRow(definitions, ['范围与精度', '始终导出全部选手和全部指标；保持选择的排序，不受界面昵称筛选或宏观/详细开关影响。指标保存完整数值精度，单元格格式负责显示舍入。']).height = 45;
  definitions.getColumn(2).alignment = { wrapText: true, vertical: 'middle' };
  const individual = workbook.addWorksheet('逐场 PT');
  setup(individual, [{ header: '选手', width: 25 }, { header: '账号 ID', width: 17 }, { header: '对局时间', width: 24 }, { header: '牌谱 UUID', width: 51 }, { header: '终局点数', width: 16 }, { header: '雀魂结算分（原始）', width: 25 }, { header: '本场 PT', width: 16 }], '逐场结算 PT', source, coverage);
  for (const game of [...(state.games || [])].sort((a, b) => (a.startTime || 0) - (b.startTime || 0))) {
    for (const player of game.players) {
      const raw = Number.isSafeInteger(player.ptRaw) ? player.ptRaw : null;
      const row = addRow(individual, [player.nickname, player.accountId ? String(player.accountId) : '', game.startTime ? new Date(game.startTime * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '', game.uuid, Number.isFinite(player.finalScore) ? player.finalScore : null, raw, raw === null ? null : raw / 1000]);
      row.getCell(7).numFmt = '0.0;[Red]-0.0;0.0';
    }
  }
  individual.autoFilter = { from: { row: 5, column: 1 }, to: { row: individual.rowCount, column: 7 } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
