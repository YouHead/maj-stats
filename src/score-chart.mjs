export function scoreChartScale(points) {
  const values = points.flatMap((point) => point.scores).filter(Number.isFinite);
  if (!values.length) return null;
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = Math.max(10000, high - low);
  const rough = span * 1.12 / 6, unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * unit >= rough) * unit;
  const min = low < 0 ? Math.floor((low - span * 0.06) / step) * step : 0;
  const max = Math.max(min + step, Math.ceil((high + span * 0.06) / step) * step);
  const ticks = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(value === 0 ? 0 : value);
  return { min, max, ticks };
}
