/* Scatter of price vs. the primary stat, with lowest/median lines and the target marker. */
import { state, item, primaryStat, setting } from '../../store/state.js';
import { $, fmtMoney, fmtDate, statLabel } from '../../lib/format.js';
import { cssVar, hexA, mix } from '../../lib/colors.js';
import { aggregateByStat, statsText, isQuick, battleText, statMode } from '../../lib/analysis.js';

let chart = null;
let onChange = () => {};

export function init(handlers) {
  onChange = handlers.onChange;
  $('#showAll').checked = state.showAll;
  $('#showAll').onchange = e => { setting('showAll', e.target.checked ? '1' : '0'); state.showAll = e.target.checked; onChange(); };
  $('#chartOpts').querySelectorAll('input[data-opt]').forEach(cb => {
    cb.checked = !!state.chartOpts[cb.dataset.opt];
    cb.onchange = () => { state.chartOpts[cb.dataset.opt] = cb.checked; setting('chartOpts', state.chartOpts); onChange(); };
  });
}

/**
 * For two-stat items the second stat (critical chance) sets the colour of the
 * matching points: light at the filter's minimum (or the item's minimum),
 * dark at the item's maximum. One hue, light -> dark.
 */
const LIGHT = [253, 224, 200], DARK = [179, 53, 10];
function colorScale() {
  const it = item();
  if (it.stats.length < 2) return null;
  const key = it.stats[1];
  const [itemLo, hi] = it.ranges[key];
  const lo = Math.min(hi, Math.max(itemLo, state.minStats[key] ?? itemLo));
  const k = t => { const v = t.skills[key]; return typeof v !== 'number' || hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo))); };
  const colorAt = v => mix(LIGHT, DARK, hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
  return { key, lo, hi, color: t => mix(LIGHT, DARK, k(t)), colorAt };
}

/** One median-price line per value of the second stat, so equal-crit sales can be followed across attack. */
function levelLines(matched, primary, scale) {
  const lines = [];
  for (let v = scale.lo; v <= scale.hi; v++) {
    const list = matched.filter(t => t.skills[scale.key] === v);
    if (list.length < 3) continue;
    const { median } = aggregateByStat(list, primary, 2);
    const data = median.map(pt => ({ ...pt, level: v, n: list.length }));
    lines.push({ type: 'line', label: `${statLabel(scale.key)} ${v}`, data, borderColor: scale.colorAt(v), borderWidth: 1.5, pointRadius: 0, pointHitRadius: 8, tension: 0.3, order: 1, level: v });
  }
  return lines;
}

/** Writes the level value at the right end of each level line. */
function endLabelsPlugin() {
  return {
    id: 'endLabels',
    afterDatasetsDraw(c) {
      const { ctx, chartArea } = c;
      ctx.save();
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      const used = [];
      c.data.datasets.forEach((ds, i) => {
        if (ds.level == null || !ds.data.length) return;
        const meta = c.getDatasetMeta(i);
        const last = meta.data[meta.data.length - 1];
        if (!last) return;
        let y = last.y;
        for (const u of used) if (Math.abs(u - y) < 12) y = u + 12; // nudge overlapping labels apart
        used.push(y);
        const x = Math.min(last.x + 6, chartArea.right + 4);
        ctx.fillStyle = ds.borderColor;
        ctx.fillText(String(ds.level), x, y);
      });
      ctx.restore();
    },
  };
}

export function render({ period, matched, hasFilter }) {
  const key = primaryStat();
  const opts = state.chartOpts;
  const twoStat = colorScale();
  const scale = twoStat && opts.colorBy ? twoStat : null;
  const levels = twoStat && opts.levels ? twoStat : null;
  $('#chartTitle').textContent = `Price vs. ${statLabel(key)}`;
  $('#optLevels').hidden = $('#optColor').hidden = !twoStat;
  if (twoStat) document.querySelectorAll('.opt-stat2').forEach(el => { el.textContent = statLabel(twoStat.key).toLowerCase(); });
  $('#legendSize').innerHTML = scale
    ? `<span class="ramp-legend">${scale.lo} <i class="ramp" style="background:linear-gradient(90deg, ${mix(LIGHT, DARK, 0)}, ${mix(LIGHT, DARK, 1)})"></i> ${scale.hi}</span>`
    : '';
  const matchedIds = new Set(matched.map(t => t.id));
  const pt = t => ({ x: t.skills[key] ?? 0, y: t.price, t });
  const showAll = state.showAll || !hasFilter;
  const others = showAll ? period.filter(t => !matchedIds.has(t.id)).map(pt) : [];
  const hits = matched.map(pt);
  const { floor, median } = aggregateByStat(showAll ? period : matched, key);
  $('#legendOther').style.display = $('#legendOtherText').style.display = showAll ? '' : 'none';

  const datasets = [
    ...(opts.floor ? [{ type: 'line', label: 'Lowest price', data: floor, borderColor: cssVar('--line-floor'), borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 0 }] : []),
    ...(opts.median ? [{ type: 'line', label: 'Median price', data: median, borderColor: cssVar('--line-median'), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 1 }] : []),
    ...(levels ? levelLines(matched, key, levels) : []),
    { type: 'scatter', label: hasFilter ? 'Match the filter' : 'Sales', data: hits,
      backgroundColor: scale ? (ctx => ctx.raw ? scale.color(ctx.raw.t) : cssVar('--series-2')) : hexA(cssVar(hasFilter ? '--series-2' : '--series-1'), 0.85),
      pointRadius: hasFilter ? 4.5 : 3.5, pointHoverRadius: 8, order: 2 },
    { type: 'scatter', label: 'Other sales', data: others, backgroundColor: hexA(cssVar('--series-1'), 0.22), pointRadius: 2.5, pointHoverRadius: 6, order: 3 },
  ];
  const target = state.minStats[key];

  if (chart) {
    chart.data.datasets = datasets;
    chart.options.scales.x.title.text = statLabel(key);
    chart.options.plugins.targetLine.x = target;
    chart.update();
    return;
  }
  chart = new Chart($('#chart'), {
    data: { datasets },
    plugins: [targetLinePlugin(), endLabelsPlugin()],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 14, right: 22 } },
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        targetLine: { x: target },
        tooltip: {
          filter: i => i.raw.t || i.raw.level != null,
          callbacks: {
            title: items => items.map(i => i.raw.t ? fmtDate(i.raw.t.ts) : `${statLabel(key)} ${i.raw.x}`).join(''),
            label: i => {
              if (i.raw.level != null) return ` ${i.dataset.label}: median ${fmtMoney(i.raw.y)} (${i.raw.n} sales)`;
              const lines = [` ${fmtMoney(i.raw.y)} · ${statsText(i.raw.t)}${isQuick(i.raw.t) ? ' · quick sale' : ''}`];
              if (state.battlesOn) lines.push(` ${battleText(i.raw.t)}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: statLabel(key), color: cssVar('--text-2') }, grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text-2'), precision: 0 } },
        y: { type: 'linear', title: { display: true, text: 'Price', color: cssVar('--text-2') }, grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text-2') } },
      },
    },
  });
}

/** Dashed vertical line at the minimum stat the user typed. */
function targetLinePlugin() {
  return {
    id: 'targetLine',
    afterDatasetsDraw(c, _args, opts) {
      if (opts.x == null) return;
      const { ctx, chartArea, scales } = c;
      const x = scales.x.getPixelForValue(opts.x);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = cssVar('--series-2');
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.fillStyle = cssVar('--series-2');
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      const sym = { min: '≥', exact: '=', near: '±' }[statMode(primaryStat())] || '≥';
      ctx.fillText(`${sym} ${opts.x}`, x, chartArea.top - 4);
      ctx.restore();
    },
  };
}
