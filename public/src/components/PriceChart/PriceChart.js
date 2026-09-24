/* Scatter of price vs. the primary stat, with lowest/median lines and the target marker. */
import { state, primaryStat, setting } from '../../store/state.js';
import { $, fmtMoney, fmtDate, statLabel } from '../../lib/format.js';
import { cssVar, hexA } from '../../lib/colors.js';
import { aggregateByStat, statsText, isQuick, battleText } from '../../lib/analysis.js';

let chart = null;
let onChange = () => {};

export function init(handlers) {
  onChange = handlers.onChange;
  $('#showAll').checked = state.showAll;
  $('#showAll').onchange = e => { setting('showAll', e.target.checked ? '1' : '0'); state.showAll = e.target.checked; onChange(); };
}

export function render({ period, matched, hasFilter }) {
  const key = primaryStat();
  $('#chartTitle').textContent = `Price vs. ${statLabel(key)}`;
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
    { type: 'scatter', label: hasFilter ? 'Match the filter' : 'Sales', data: hits, backgroundColor: hexA(cssVar(hasFilter ? '--series-2' : '--series-1'), 0.85), pointRadius: hasFilter ? 5 : 3, pointHoverRadius: 8, order: 2 },
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
