const vector = (value) => Array.isArray(value) && value.length === 4 && value.every(Number.isSafeInteger) ? [...value] : null;
const equalScores = (a, b) => a && b && a.every((value, seat) => value === b[seat]);
const sumScores = (old, delta) => {
  const before = vector(old), change = vector(delta);
  return before && change ? vector(before.map((value, seat) => value + change[seat])) : null;
};
const roundLabel = ({ wind, number, honba }) => `${['东', '南', '西', '北'][wind] || `第${wind + 1}风`}${number + 1}${honba ? `·${honba}本场` : ''}`;

export function buildScoreHistory(players, records) {
  const rounds = [];
  let current;
  for (const { name, data } of records) {
    const acceptedRiichi = data.liqi;
    if (current?.liveScores && acceptedRiichi && !acceptedRiichi.failed && Number.isInteger(acceptedRiichi.seat) && acceptedRiichi.seat >= 0 && acceptedRiichi.seat < 4 && Number.isSafeInteger(acceptedRiichi.score)) current.liveScores[acceptedRiichi.seat] = acceptedRiichi.score;
    if (name === 'RecordNewRound') {
      current = { wind: data.chang ?? 0, number: data.ju ?? 0, honba: data.ben ?? 0, startScores: vector(data.scores), liveScores: vector(data.scores), endScores: null, outcome: '' };
      rounds.push(current);
    } else if (current && ['RecordHule', 'RecordNoTile', 'RecordLiuJu'].includes(name)) {
      if (name === 'RecordHule') { current.outcome = 'win'; current.endScores = vector(data.scores) || sumScores(data.old_scores, data.delta_scores); }
      if (name === 'RecordNoTile') {
        current.outcome = data.liujumanguan ? 'nagashi' : 'draw';
        // Multiple nagashi winners can use shared or successive bases. Prefer
        // the next actual opening (or final settlement) instead of guessing.
        if (data.scores?.length === 1) {
          const score = data.scores[0];
          current.endScores = sumScores(score.old_scores, score.delta_scores);
          const tenpai = data.players?.map((player) => player.tingpai);
          const noTransfer = !data.liujumanguan && tenpai?.length === 4 && tenpai.every((value) => value === true);
          if (!current.endScores && score.delta_scores?.length === 0 && noTransfer) current.endScores = vector(score.old_scores);
        }
      }
      if (name === 'RecordLiuJu') { current.outcome = 'abortive-draw'; current.endScores = current.liveScores; }
    }
  }
  const finalScores = vector([0, 1, 2, 3].map((seat) => players.find((player) => player.seat === seat)?.finalScore));
  const points = [];
  const add = (point) => points.push({ ...point, scores: point.scores || [null, null, null, null] });
  if (!rounds.length) return { points, complete: false };
  add({ label: '开局', phase: 'opening', roundIndex: 0, scores: rounds[0].startScores });
  rounds.forEach((round, index) => {
    const previous = points.at(-1).scores;
    if (index && vector(previous) && round.startScores && !equalScores(previous, round.startScores)) {
      add({ label: `${roundLabel(round)}开局`, phase: 'adjustment', roundIndex: index + 1, scores: round.startScores });
    }
    const fallback = rounds[index + 1]?.startScores || (index === rounds.length - 1 ? finalScores : null);
    add({ label: roundLabel(round), phase: 'round-end', roundIndex: index + 1, outcome: round.outcome, scores: round.endScores || fallback });
  });
  if (finalScores && !equalScores(points.at(-1).scores, finalScores)) add({ label: '终局结算', phase: 'settlement', roundIndex: rounds.length, scores: finalScores });
  return { points, complete: points.every((point) => Boolean(vector(point.scores))) };
}

export function buildReplayDetails(game, records) {
  return {
    uuid: game.uuid, startTime: game.startTime, endTime: game.endTime, roundCount: game.roundCount,
    drawCount: game.rounds.filter((round) => ['draw', 'nagashi'].includes(round.outcome)).length,
    abortiveDrawCount: game.rounds.filter((round) => round.outcome === 'abortive-draw').length,
    players: game.players.map(({ accountId, nickname, seat, rankSum, finalScore, totalPt, riichiRounds, wins, dealIns }) => ({ accountId, nickname, seat, rank: rankSum, finalScore, pt: totalPt, riichiCount: riichiRounds, winCount: wins, dealInCount: dealIns })).sort((a, b) => a.rank - b.rank),
    scoreHistory: buildScoreHistory(game.players, records),
  };
}
