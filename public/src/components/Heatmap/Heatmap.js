/* Weekday × hour heatmap of sales count or relative median price, with hover tooltip. */
import { state, setting } from '../../store/state.js';
import { $, pad, fmtMoney, fmtPct } from '../../lib/format.js';
import { seqColor, divColor } from '../../lib/colors.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayIdx = d => (d.getDay() + 6) % 7; // Monday = 0
const MIN_N = 3; // cells with fewer sales are not coloured in price mode

let onChange = () => {};

export function init(handlers) {
  onChange = handlers.onChange;
  segmented('#heatMode', 'mode', state.heatMode, v => { setting('heatMode', v); });
  segmented('#heatScale', 'p', String(state.heatPct), v => { setting('heatPct', Number(v)); });
}

function segmented(sel, attr, current, apply) {
  const buttons = $(sel).querySelectorAll('button');
  buttons.forEach(b => {
    b.classList.toggle('active', b.dataset[attr] === current);
    b.onclick = () => {
      apply(b.dataset[attr]);
      buttons.forEach(x => x.classList.toggle('active', x === b));
      onChange();
    };
  });
}

/** `list` is every cached sale matching the stat filter (period filter not applied). */
export function render(list, hasFilter) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  const bigCells = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of list) {
    const d = new Date(t.ts);
    cells[dayIdx(d)][d.getHours()].push(t.price);
    if (t.big > 0) bigCells[dayIdx(d)][d.getHours()]++;
  }
  const allPrices = list.map(t => t.price).sort((a, b) => a - b);
  const overallMedian = allPrices.length ? allPrices[Math.floor(allPrices.length / 2)] : 0;
  const mode = state.heatMode;

  const stats = cells.map(row => row.map(prices => {
    const n = prices.length;
    if (!n) return { n, median: null, rel: null };
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    return { n, median, rel: overallMedian ? median / overallMedian - 1 : null };
  }));

  const maxN = Math.max(1, ...stats.flat().map(c => c.n));
  // colour scale capped at a chosen percentile of deviations so outliers do not flatten the map
  const rels = stats.flat().filter(c => c.n >= MIN_N && c.rel != null).map(c => Math.abs(c.rel)).sort((a, b) => a - b);
  const idx = Math.min(rels.length - 1, Math.floor(rels.length * state.heatPct / 100));
  const maxRel = Math.max(0.01, rels.length ? rels[idx] : 0);
  $('#heatScale').classList.toggle('hidden', mode !== 'price');

  const now = new Date();
  const nowD = dayIdx(now), nowH = now.getHours();
  let html = '<div class="hd"></div>' + Array.from({ length: 24 }, (_, h) => `<div class="hd">${h % 3 === 0 ? h : ''}</div>`).join('');
  for (let d = 0; d < 7; d++) {
    html += `<div class="rl">${DAYS[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = stats[d][h];
      let bg = '', cls = 'cell';
      if (mode === 'count') { if (c.n) bg = seqColor(c.n / maxN); }
      else if (c.n >= MIN_N) bg = divColor(c.rel / maxRel);
      else if (c.n) cls += ' few';
      if (d === nowD && h === nowH) cls += ' now';
      html += `<div class="${cls}" style="${bg ? `background:${bg}` : ''}" data-d="${d}" data-h="${h}"></div>`;
    }
  }
  $('#heat').innerHTML = html;
  attachTooltip(stats, cells, bigCells);
  renderSummary(list, stats, cells, overallMedian);

  const legend = mode === 'count'
    ? `<span class="heat-legend"><span>fewer</span><span class="bar" style="background:linear-gradient(90deg,${seqColor(0.05)},${seqColor(1)})"></span><span>more sales</span></span>`
    : `<span class="heat-legend"><span>cheaper (−${(maxRel * 100).toFixed(1)}%)</span><span class="bar" style="background:linear-gradient(90deg,${divColor(-1)},${divColor(0)},${divColor(1)})"></span><span>pricier (+${(maxRel * 100).toFixed(1)}%)</span> · scale capped at P${state.heatPct} of deviations · hatched = under ${MIN_N} sales</span>`;
  $('#heatNote').innerHTML = `${legend}<br>Based on all ${list.length} cached sales${hasFilter ? ' matching your stats' : ''} (the period filter is not applied). Times are in your local time zone. The outlined cell is right now.`;
}

function renderSummary(list, stats, cells, overallMedian) {
  const byDay = DAYS.map((_, d) => stats[d].reduce((s, c) => s + c.n, 0));
  const byHour = Array.from({ length: 24 }, (_, h) => stats.reduce((s, row) => s + row[h].n, 0));
  const hourMedians = Array.from({ length: 24 }, (_, h) => {
    const p = [];
    for (let d = 0; d < 7; d++) p.push(...cells[d][h]);
    p.sort((a, b) => a - b);
    return p.length >= MIN_N ? p[Math.floor(p.length / 2)] : null;
  });
  const busiestDay = byDay.indexOf(Math.max(...byDay));
  const busiestHour = byHour.indexOf(Math.max(...byHour));
  const priced = hourMedians.map((m, h) => ({ m, h })).filter(x => x.m != null);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.m < a.m ? b : a)) : null;
  const dearest = priced.length ? priced.reduce((a, b) => (b.m > a.m ? b : a)) : null;
  let cheapCell = null, cheapPos = null;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const c = stats[d][h];
    if (c.n >= MIN_N && c.rel != null && (!cheapCell || c.rel < cheapCell.rel)) { cheapCell = c; cheapPos = { d, h }; }
  }
  const parts = [];
  if (list.length) {
    parts.push(`Busiest: <b>${DAYS[busiestDay]}</b> (${byDay[busiestDay]} sales) and <b>${pad(busiestHour)}:00</b> (${byHour[busiestHour]} sales).`);
    if (cheapest && dearest && cheapest.h !== dearest.h) {
      parts.push(`Cheapest hour: <b>${pad(cheapest.h)}:00</b> (median ${fmtMoney(cheapest.m)}), most expensive: <b>${pad(dearest.h)}:00</b> (median ${fmtMoney(dearest.m)}).`);
    }
    if (cheapPos) parts.push(`Cheapest slot: <b>${DAYS[cheapPos.d]} ${pad(cheapPos.h)}:00</b>, ${fmtPct(cheapCell.rel)} vs. the overall median of ${fmtMoney(overallMedian)}.`);
  }
  $('#heatSummary').innerHTML = parts.join(' ') || 'No sales to analyse.';
}

function attachTooltip(stats, cells, bigCells) {
  const heat = $('#heat'), tip = $('#heatTip'), wrap = heat.parentElement;
  heat.onmouseover = e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const d = Number(cell.dataset.d), h = Number(cell.dataset.h);
    const c = stats[d][h];
    let body = `<div class="t">${DAYS[d]} ${pad(h)}:00–${pad(h)}:59</div>`;
    if (!c.n) {
      body += `<div class="row"><span>Sales</span><b>0</b></div>`;
    } else {
      const sorted = [...cells[d][h]].sort((a, b) => a - b);
      const relCls = c.rel < 0 ? 'cheap' : c.rel > 0 ? 'dear' : '';
      body += `<div class="row"><span>Sales</span><b>${c.n}</b></div>
        <div class="row"><span>Median</span><b>${fmtMoney(c.median)}</b></div>
        <div class="row"><span>vs. overall median</span><b class="${relCls}">${fmtPct(c.rel)}</b></div>
        <div class="row"><span>Lowest</span><b>${fmtMoney(sorted[0])}</b></div>
        <div class="row"><span>Highest</span><b>${fmtMoney(sorted[sorted.length - 1])}</b></div>
        ${state.battlesOn ? `<div class="row"><span>During a big battle</span><b>${Math.round(100 * bigCells[d][h] / c.n)}% of sales</b></div>` : ''}`;
      if (c.n < MIN_N) body += `<div class="row"><span>too few sales to colour</span></div>`;
    }
    tip.innerHTML = body;
    tip.hidden = false;
    position(e);
  };
  heat.onmousemove = position;
  heat.onmouseleave = () => { tip.hidden = true; };
  function position(e) {
    if (tip.hidden) return;
    const r = wrap.getBoundingClientRect();
    let x = e.clientX - r.left + wrap.scrollLeft + 14;
    let y = e.clientY - r.top + 14;
    if (x + tip.offsetWidth > wrap.scrollLeft + wrap.clientWidth) x = e.clientX - r.left + wrap.scrollLeft - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > wrap.clientHeight) y = e.clientY - r.top - tip.offsetHeight - 14;
    tip.style.left = `${x}px`; tip.style.top = `${Math.max(0, y)}px`;
  }
}
