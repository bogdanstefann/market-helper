/*
 * Opt-in battle analysis: threshold control, calm/normal/busy comparison
 * table, two hourly timelines, and the helpers other components use to show
 * battle symbols and lists.
 */
import { state, setting } from '../../store/state.js';
import { $, fmtMoney, fmtDate, fmtPct, fmtM, median } from '../../lib/format.js';
import { cssVar, loadColor } from '../../lib/colors.js';
import { isBigBattle, activeAt, battlesAt, battleLoadThresholds, battleLevel, battleLoad, battleText, pricePerPoint } from '../../lib/analysis.js';

let charts = null;
let handlers = { onToggle: () => {}, onThreshold: () => {} };

export function init(h) {
  handlers = h;
  $('#battleEnable').onclick = () => handlers.onToggle(true);
  $('#battleDisable').onclick = () => handlers.onToggle(false);
  $('#bigM').value = String(state.bigM);
  $('#bigM').onchange = e => {
    const v = Number(e.target.value);
    if (!(v > 0)) return;
    setting('bigM', v);
    handlers.onThreshold();
  };
}

// ---- pieces reused by other components ----
export const countryName = id => state.countries[id]?.name || (id ? 'Unknown' : '–');

/** The `!` symbol for a sale, grey (calm) to red (busiest moment seen). */
export function battleSymbol(t) {
  if (t.big === 0 && t.small === 0) return '';
  return `<span class="bsym" style="background:${loadColor(battleLoad(t))}" title="${battleText(t)}">!</span>`;
}

/** Tooltip body listing the battles active at a moment, biggest first. */
export function battleListHtml(ts, limit = 10) {
  const list = battlesAt(ts);
  if (!list.length) return '<div class="row"><span>No battles active</span></div>';
  const rows = list.slice(0, limit).map(b =>
    `<div class="row brow"><span><span class="bsym ${isBigBattle(b) ? 'big' : 'small'}">!</span> ${countryName(b.attacker)} → ${countryName(b.defender)} <span class="muted">${b.type}</span></span><b>${fmtM(b.maxRound)}</b></div>`);
  if (list.length > limit) rows.push(`<div class="row"><span class="muted">+ ${list.length - limit} more</span></div>`);
  return rows.join('');
}

// ---- section ----
export function render({ matched }) {
  $('#battleOff').hidden = state.battlesOn;
  $('#battleOn').hidden = !state.battlesOn;
  if (!state.battlesOn) return;

  const nBig = state.battles.filter(isBigBattle).length;
  $('#battleStatus').textContent = state.battles.length ? `${state.battles.length} battles cached · ${nBig} big at ≥ ${state.bigM} M` : 'loading battles…';

  const th = battleLoadThresholds();
  const groups = { calm: [], normal: [], busy: [] };
  for (const t of matched) groups[battleLevel(t)].push(t);
  const overall = median(matched.map(t => t.price)) || 0;
  const rows = [
    [`Calm: ≤ ${th.p25} big battles active`, groups.calm, '<span class="bsym small">!</span>'],
    [`Normal: ${th.p25 + 1}–${Math.max(th.p25 + 1, th.p75 - 1)} big battles`, groups.normal, `<span class="bsym" style="background:${loadColor(0.5)}">!</span>`],
    [`Busy: ≥ ${th.p75} big battles active`, groups.busy, '<span class="bsym big">!</span>'],
  ];
  $('#battleTable tbody').innerHTML = rows.map(([label, list, sym]) => {
    const m = median(list.map(t => t.price));
    const ppp = median(list.map(pricePerPoint).filter(Number.isFinite));
    const rel = m != null && overall ? m / overall - 1 : null;
    return `<tr><td>${sym} ${label}</td><td class="num">${list.length}</td><td class="num">${matched.length ? Math.round(100 * list.length / matched.length) : 0}%</td>
      <td class="num">${m != null ? fmtMoney(m) : '–'}</td><td class="num ${rel > 0 ? 'dear' : rel < 0 ? 'cheap' : ''}">${fmtPct(rel)}</td>
      <td class="num">${list.length ? fmtMoney(Math.min(...list.map(t => t.price))) : '–'}</td><td class="num">${ppp != null ? fmtMoney(ppp) : '–'}</td></tr>`;
  }).join('');

  renderTimelines(matched);
}

/** Two stacked hourly charts: median sale price, and big battles active. */
function renderTimelines(matched) {
  const HOURS = Math.min(24 * (state.days || 14), 24 * 14);
  const end = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
  const start = end - HOURS * 3_600_000;
  const buckets = Array.from({ length: HOURS }, () => []);
  for (const t of matched) {
    const i = Math.floor((t.ts - start) / 3_600_000);
    if (i >= 0 && i < HOURS) buckets[i].push(t.price);
  }
  const price = buckets.map((b, i) => ({ x: start + i * 3_600_000, y: median(b), n: b.length }));
  const bigCount = Array.from({ length: HOURS }, (_, i) => {
    const mid = start + i * 3_600_000 + 1_800_000;
    return { x: start + i * 3_600_000, y: state.battles.filter(b => isBigBattle(b) && activeAt(b, mid)).length };
  });

  if (charts) {
    charts.price.data.datasets[0].data = price; Object.assign(charts.price.options.scales.x, { min: start, max: end }); charts.price.update();
    charts.battles.data.datasets[0].data = bigCount; Object.assign(charts.battles.options.scales.x, { min: start, max: end }); charts.battles.update();
    return;
  }
  const grid = cssVar('--border'), text = cssVar('--text-2');
  const xScale = { type: 'linear', min: start, max: end, grid: { color: grid }, ticks: { color: text, maxTicksLimit: 8, callback: v => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit' }) } };
  const common = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } };
  charts = {
    price: new Chart($('#priceTimeline'), {
      type: 'line',
      data: { datasets: [{ data: price, borderColor: cssVar('--line-median'), borderWidth: 2, borderDash: [6, 4], pointRadius: 2, pointBackgroundColor: cssVar('--line-median'), spanGaps: true }] },
      options: { ...common, plugins: { ...common.plugins, tooltip: { callbacks: { title: i => fmtDate(i[0].raw.x), label: i => ` median ${fmtMoney(i.raw.y)} from ${i.raw.n} sale${i.raw.n === 1 ? '' : 's'}` } } },
        scales: { x: xScale, y: { title: { display: true, text: 'Median price', color: text }, grid: { color: grid }, ticks: { color: text } } } },
    }),
    battles: new Chart($('#battleTimeline'), {
      type: 'bar',
      data: { datasets: [{ data: bigCount, backgroundColor: 'rgba(230,103,103,.55)', barPercentage: 1, categoryPercentage: 1 }] },
      options: { ...common, plugins: { ...common.plugins, tooltip: { callbacks: {
        title: i => fmtDate(i[0].raw.x),
        label: i => ` ${i.raw.y} big battle${i.raw.y === 1 ? '' : 's'} active`,
        afterBody: i => battlesAt(i[0].raw.x + 1_800_000).filter(isBigBattle).slice(0, 8).map(b => ` ${countryName(b.attacker)} → ${countryName(b.defender)} · ${fmtM(b.maxRound)}`),
      } } },
        scales: { x: xScale, y: { beginAtZero: true, title: { display: true, text: 'Big battles', color: text }, grid: { color: grid }, ticks: { color: text, precision: 0 } } } },
    }),
  };
}
