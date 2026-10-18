const SUPPORTED = new Set(['RecordNewRound', 'RecordDealTile', 'RecordDiscardTile', 'RecordChiPengGang', 'RecordAnGangAddGang', 'RecordHule', 'RecordNoTile', 'RecordLiuJu']);
const rate = (count, total) => total ? count / total : null;
export const PLAYER_COUNTERS = ['games', 'rounds', 'firsts', 'seconds', 'thirds', 'fourths', 'rankSum', 'wins', 'dealIns', 'riichiRounds', 'openRounds', 'tsumoWins', 'ronWins', 'damatenWins', 'drawRounds', 'abortiveDrawRounds', 'tenpaiDraws', 'tenpaiObservedDraws', 'winPoints', 'dealInPoints', 'dealInObserved', 'winTurnSum', 'ptRawSum', 'ptObservedGames'];
const seatNumber = (value) => {
  if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('牌谱包含无效座位');
  return value;
};

export function playerMetrics(player) {
  return {
    ...player,
    totalPt: player.ptObservedGames === player.games ? player.ptRawSum / 1000 : null,
    averagePt: player.ptObservedGames === player.games ? rate(player.ptRawSum, player.games * 1000) : null,
    winRate: rate(player.wins, player.rounds),
    dealInRate: rate(player.dealIns, player.rounds),
    riichiRate: rate(player.riichiRounds, player.rounds),
    openRate: rate(player.openRounds, player.rounds),
    firstRate: rate(player.firsts, player.games),
    secondRate: rate(player.seconds, player.games),
    thirdRate: rate(player.thirds, player.games),
    fourthRate: rate(player.fourths, player.games),
    tsumoRate: rate(player.tsumoWins, player.wins),
    damatenRate: rate(player.damatenWins, player.wins),
    drawRate: rate(player.drawRounds, player.rounds),
    tenpaiRate: player.tenpaiObservedDraws === player.drawRounds ? rate(player.tenpaiDraws, player.drawRounds) : null,
    averageRank: rate(player.rankSum, player.games),
    averageWinPoints: rate(player.winPoints, player.wins),
    averageDealInPoints: player.dealInObserved === player.dealIns ? rate(player.dealInPoints, player.dealIns) : null,
    averageWinTurn: rate(player.winTurnSum, player.wins),
  };
}

export function analyzeGame(head, records) {
  if (!head?.uuid) throw new Error('缺少牌谱的选手与结果信息');
  const accounts = [...(head.accounts || []), ...(head.robots || [])];
  const bySeat = new Map(accounts.map((account) => [seatNumber(account.seat ?? 0), account]));
  if (bySeat.size !== 4) throw new Error('目前只支持选手资料齐全的四人麻将牌谱');
  const results = head.result?.players || [];
  if (results.length !== 4 || new Set(results.map((player) => seatNumber(player.seat ?? 0))).size !== 4) {
    throw new Error('牌谱缺少四位选手的最终结果');
  }
  const ranking = [...results].sort((a, b) => b.part_point_1 - a.part_point_1 || (a.seat ?? 0) - (b.seat ?? 0));
  const players = [0, 1, 2, 3].map((seat) => {
    const account = bySeat.get(seat);
    const accountId = account.account_id || null;
    const rank = ranking.findIndex((result) => (result.seat ?? 0) === seat) + 1;
    const result = results.find((result) => (result.seat ?? 0) === seat);
    const hasPt = Number.isSafeInteger(result.total_point);
    return {
      key: accountId ? String(accountId) : `robot:${head.uuid}:${seat}`,
      accountId, nickname: account.nickname || `电脑 ${seat + 1}`, seat,
      ...Object.fromEntries(PLAYER_COUNTERS.map((key) => [key, 0])),
      games: 1, firsts: Number(rank === 1), seconds: Number(rank === 2), thirds: Number(rank === 3), fourths: Number(rank === 4), rankSum: rank,
      finalScore: result.part_point_1,
      ptRawSum: hasPt ? result.total_point : 0, ptObservedGames: Number(hasPt),
    };
  });
  const rounds = [];
  let current = null;
  const finish = (outcome) => {
    if (!current || current.complete) throw new Error('牌谱的局结束顺序不完整');
    current.outcome = outcome;
    current.complete = true;
    for (const player of players) {
      player.rounds++;
      if (current.riichiSeats.has(player.seat)) player.riichiRounds++;
      if (current.openSeats.has(player.seat)) player.openRounds++;
    }
    rounds.push({
      wind: current.wind, number: current.number, honba: current.honba, outcome,
      winners: [...current.winners], dealInSeats: [...current.dealInSeats],
      riichiSeats: [...current.riichiSeats], openSeats: [...current.openSeats],
    });
  };
  for (const { name, data } of records) {
    if (!SUPPORTED.has(name)) throw new Error(`暂不支持此规则中的 ${name} 事件`);
    if (name === 'RecordNewRound') {
      if (current && !current.complete) throw new Error('牌谱中存在未结束的局，不能生成完整统计');
      if (data.scores.length !== 4) throw new Error('目前只支持四人麻将');
      if (data.opens?.some((entry) => entry.tiles?.length || entry.count?.some((count) => count > 0))) throw new Error('暂不支持开局公开手牌的特殊规则');
      current = {
        wind: data.chang, number: data.ju, honba: data.ben, complete: false,
        riichiSeats: new Set(), openSeats: new Set(), winners: new Set(), dealInSeats: new Set(), lastDiscardSeat: null, discardCount: 0,
      };
      continue;
    }
    if (!current || current.complete) throw new Error('牌谱事件位于有效局范围之外');
    switch (name) {
      case 'RecordDiscardTile':
        current.discardCount++;
        current.lastDiscardSeat = seatNumber(data.seat);
        if (data.is_liqi || data.is_wliqi) current.riichiSeats.add(data.seat);
        break;
      case 'RecordChiPengGang':
        current.openSeats.add(seatNumber(data.seat));
        break;
      case 'RecordAnGangAddGang':
        current.lastDiscardSeat = seatNumber(data.seat); // Robbing a kan uses its declarer.
        break;
      case 'RecordHule': {
        if (!data.hules?.length) throw new Error('和牌事件缺少和牌选手');
        for (const win of data.hules) {
          const seat = seatNumber(win.seat);
          if (current.winners.has(seat)) throw new Error('同一局出现重复和牌结果');
          current.winners.add(seat);
          const winner = players[seat];
          winner.wins++;
          winner.winTurnSum += current.discardCount / 4 + 1;
          if (!current.openSeats.has(seat) && !current.riichiSeats.has(seat) && !win.liqi) winner.damatenWins++;
          if (win.zimo) winner.tsumoWins++;
          else {
            winner.ronWins++;
            if (current.lastDiscardSeat === null || current.lastDiscardSeat === seat) throw new Error('无法确定本局放铳选手');
            current.dealInSeats.add(current.lastDiscardSeat);
          }
          // The record supplies hand points; no independent scoring assumptions.
          winner.winPoints += win.dadian || (win.zimo
            ? (win.qinjia ? 3 * win.point_zimo_xian : win.point_zimo_qin + 2 * win.point_zimo_xian)
            : win.point_rong) || 0;
        }
        for (const seat of current.dealInSeats) {
          const player = players[seat];
          player.dealIns++;
          if (data.delta_scores?.length === 4 && Number.isFinite(data.delta_scores[seat]) && data.delta_scores[seat] <= 0) {
            player.dealInPoints -= data.delta_scores[seat];
            player.dealInObserved++;
          }
        }
        finish('win');
        break;
      }
      case 'RecordNoTile':
        for (const player of players) {
          player.drawRounds++;
          if (data.players?.length === 4 && typeof data.players[player.seat]?.tingpai === 'boolean') {
            player.tenpaiObservedDraws++;
            if (data.players[player.seat].tingpai) player.tenpaiDraws++;
          }
        }
        finish(data.liujumanguan ? 'nagashi' : 'draw'); break;
      case 'RecordLiuJu':
        for (const player of players) player.abortiveDrawRounds++;
        finish('abortive-draw'); break;
    }
  }
  if (!rounds.length || !current?.complete) throw new Error('牌谱内容不完整，不能生成选手统计');
  return {
    statisticsVersion: 3,
    uuid: head.uuid, startTime: head.start_time, endTime: head.end_time,
    contestUid: head.config?.meta?.contest_uid || null,
    roundCount: rounds.length, players: players.map(playerMetrics), rounds,
    methodology: {
      denominator: '实际完成局数，包含连庄、荒牌和途中流局',
      dealIn: '按放铳局计数，一炮多响只计一次，自摸支付和包牌支付不计放铳',
      riichi: '按立直宣言局计数，包含宣言牌被荣和的情况',
      open: '发生过吃、碰或大明杠的局；暗杠不计副露',
      winPoints: '优先使用牌谱给出的打点字段，否则使用荣和点或自摸支付合计',
      ties: '最终点数相同时按起始座位顺序确定顺位',
      pt: '本场 PT 直接读取雀魂结算分 total_point / 1000；累计及平均 PT 仅按本机已导入牌谱计算，不含赛事额外修正分或最佳若干场规则；缺少任何场次结算分时不显示完整累计值',
      tsumo: '自摸和牌次数 / 和牌次数',
      damaten: '门清且未立直的和牌次数 / 和牌次数，包含门清自摸',
      draw: '荒牌流局次数 / 参与局数；途中流局另计，流局满贯仍按荒牌流局事件计数',
      tenpai: '荒牌时听牌次数 / 荒牌流局次数；没有荒牌或听牌信息不全时不显示比率',
      dealInPoints: '按放铳实际支付计点，含本场、不含供托；一炮多响合并，自摸支付与其他人的包牌支付不计入',
      winTurn: '各次和牌时全桌累计舍牌数 / 4 + 1，再对和牌次数取平均',
    },
  };
}

export function aggregateGames(games) {
  const unique = new Map(games.map((game) => [game.uuid, game]));
  const players = new Map();
  const counters = PLAYER_COUNTERS;
  for (const game of [...unique.values()].sort((a, b) => (a.startTime || 0) - (b.startTime || 0))) {
    for (const player of game.players) {
      if (!players.has(player.key)) {
        players.set(player.key, { key: player.key, accountId: player.accountId, nickname: player.nickname, ...Object.fromEntries(counters.map((key) => [key, 0])) });
      }
      const total = players.get(player.key);
      total.nickname = player.nickname;
      for (const counter of counters) total[counter] += player[counter] ?? 0;
    }
  }
  return {
    gameCount: unique.size,
    roundCount: [...unique.values()].reduce((total, game) => total + game.roundCount, 0),
    players: [...players.values()].map(playerMetrics).sort((a, b) => a.averageRank - b.averageRank || b.winRate - a.winRate),
  };
}
