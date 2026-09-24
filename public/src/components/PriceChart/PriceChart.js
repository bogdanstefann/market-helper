/* Scatter of price vs. the primary stat, with lowest/median lines and the target marker. */
import { state, item, primaryStat, setting } from '../../store/state.js';
import { $, fmtMoney, fmtDate, statLabel } from '../../lib/format.js';
import { cssVar, hexA, mix } from '../../lib/colors.js';
import { aggregateByStat, statsText, isQuick, battleText } from '../../lib/analysis.js';

let chart = null;
let onChange = () => {};

export function init(handlers) {
  onChange = handlers.onChange;
  $('#showAll').checked = state.showAll;
  $('#showAll').onchange = e => { setting('showAll', e.target.checked ? '1' : '0'); state.showAll = e.target.checked; onChange(); };
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
  return { key, lo, hi, color: t => mix(LIGHT, DARK, k(t)) };
}

export function render({ period, matched, hasFilter }) {
  const key = primaryStat();
  const scale = colorScale();
  $('#chartTitle').textContent = `Price vs. ${statLabel(key)}`;
  $('#legendSize').innerHTML = scale
    ? `<span class="ramp-legend">${statLabel(scale.key).toLowerCase()} ${scale.lo} <i class="ramp" style="background:linear-gradient(90deg, ${mix(LIGHT, DARK, 0)}, ${mix(LIGHT, DARK, 1)})"></i> ${scale.hi}</span>`
    : '';
  const matchedIds = new Set(matched.map(t => t.id));
  const pt = t => ({ x: t.skills[key] ?? 0, y: t.price, t });
  const showAll = state.showAll || !hasFilter;
  const others = showAll ? period.filter(t => !matchedIds.has(t.id)).map(pt) : [];
  const hits = matched.map(pt);
  const { floor, median } = aggregateByStat(showAll ? period : matched, key);
  $('#legendOther').style.display = $('#legendOtherText').style.display = showAll ? '' : 'none';

  const datasets = [
    { type: 'line', label: 'Lowest price', data: floor, borderColor: cssVar('--line-floor'), borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 0 },
    { type: 'line', label: 'Median price', data: median, borderColor: cssVar('--line-median'), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 1 },
    { type: 'scatter', label: hasFilter ? 'Match the filter' : 'Sales', data: hits,
      backgroundColor: scale ? (ctx => ctx.raw ? scale.color(ctx.raw.t) : cssVar('--series-2')) : hexA(cssVar(hasFilter ? '--series-2' : '--series-1'), 0.85),
      pointRadius: hasFilter ? 5 : 3.5, pointHoverRadius: 8, order: 2 },
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
    plugins: [targetLinePlugin()],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 14 } },
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        targetLine: { x: target },
        tooltip: {
          filter: i => i.raw.t,
          callbacks: {
            title: items => items.map(i => fmtDate(i.raw.t.ts)).join(''),
            label: i => {
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
      ctx.fillText(`min ${opts.x}`, x, chartArea.top - 4);
      ctx.restore();
    },
  };
}
