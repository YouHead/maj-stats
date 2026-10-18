/** Rank against PT descending even when the UI reverses its display order. */
export function rankTeams(teams) {
  const ordered = [...teams].sort((a, b) => Number(!Number.isFinite(a.totalPt)) - Number(!Number.isFinite(b.totalPt)) || (b.totalPt ?? 0) - (a.totalPt ?? 0) || a.id - b.id);
  return ordered.map((team, index) => {
    const previous = ordered[index - 1];
    const gapToPrevious = Number.isFinite(team.totalPt) && Number.isFinite(previous?.totalPt)
      ? (Math.round(previous.totalPt * 1000) - Math.round(team.totalPt * 1000)) / 1000 : null;
    return { ...team, rank: index + 1, gapToPrevious };
  });
}
