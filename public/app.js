const STAT_LABELS = {
  attack: 'Attack', criticalChance: 'Critical chance', criticalDamages: 'Critical damages',
  armor: 'Armor', precision: 'Precision', dodge: 'Dodge',
};
const fmtMoney = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 3 : 2 });
const fmtDate = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const $ = s => document.querySelector(s);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const state = {
  items: {}, slots: {}, rarities: [], counts: {},
  slot: null, rarity: null, txs: [],
  minStats: {}, days: 7, mode: 'min',
  weights: loadWeights(),
  showAll: localStorage.getItem('showAll') !== '0',
  heatMode: localStorage.getItem('heatMode') || 'count',
  sortKey: 'price', sortAsc: true,
  chart: null, timer: null,
};

function loadWeights() {
  try { return JSON.parse(localStorage.getItem('weights')) || {}; } catch { return {}; }
}
function saveWeights() { localStorage.setItem('weights', JSON.stringify(state.weights)); }
/** Weight (0-100) of the first stat for a multi-stat slot; the second stat gets the rest. */
function firstWeight() {
  const it = item();
  return state.weights[it.slot] ?? 40;
}

const code = () => state.slots[state.slot]?.codes?.[state.rarity] ?? `${state.slot}${state.rarities.indexOf(state.rarity) + 1}`;
const item = () => state.items[code()];
const primaryStat = () => item().stats[0];

// ---- data ---------------------------------------------------------------
async function loadItems() {
  const r = await fetch('/api/items').then(r => r.json());
  Object.assign(state, { items: r.items, slots: r.slots, rarities: r.rarities, counts: r.counts });
  renderStatus(r.status);
  if (!state.slot) {
    const saved = localStorage.getItem('slot');
    state.slot = saved in r.slots ? saved : Object.keys(r.slots)[0];
    const savedR = localStorage.getItem('rarity');
    state.rarity = r.rarities.includes(savedR) ? savedR : 'mythic';
  }
  renderSelectors();
}

async function loadTransactions() {
  const r = await fetch(`/api/transactions?code=${code()}`).then(r => r.json());
  state.txs = r.transactions;
  renderStatus(r.status);
  render();
}

function renderStatus(s) {
  const el = $('#status');
  if (s.lastError) { el.textContent = `Sync error: ${s.lastError}`; el.className = 'status err'; return; }
  el.className = 'status';
  el.textContent = s.lastSync ? `Updated ${fmtDate(s.lastSync)} · refreshes every 60s` : 'Syncing…';
}

// ---- controls -----------------------------------------------------------
function selectItem(slot, rarity) {
  state.slot = slot; state.rarity = rarity;
  localStorage.setItem('slot', slot); localStorage.setItem('rarity', rarity);
  state.minStats = {};
  renderSelectors();
  renderStatInputs();
  loadTransactions();
}

function renderSelectors() {
  const slots = $('#slots');
  slots.innerHTML = '';
  for (const [slot, def] of Object.entries(state.slots)) {
    const b = document.createElement('button');
    b.className = 'item-btn' + (slot === state.slot ? ' active' : '');
    b.style.setProperty('--r', `var(--r-${state.rarity})`);
    b.innerHTML = `<span class="tag"></span>${def.label}`;
    b.onclick = () => selectItem(slot, state.rarity);
    slots.appendChild(b);
  }
  const rar = $('#rarities');
  rar.innerHTML = '';
  for (const r of state.rarities) {
    const c = state.slots[state.slot].codes?.[r] ?? `${state.slot}${state.rarities.indexOf(r) + 1}`;
    const b = document.createElement('button');
    b.className = `item-btn ${r}` + (r === state.rarity ? ' active' : '');
    b.innerHTML = `<span class="tag"></span>${cap(r)} <span class="count">${state.counts[c] || 0}</span>`;
    b.onclick = () => selectItem(state.slot, r);
    rar.appendChild(b);
  }
}

function renderStatInputs() {
  const box = $('#statInputs');
  box.innerHTML = '';
  const it = item();
  for (const key of it.stats) {
    const [lo, hi] = it.ranges[key];
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = `<span>Min ${STAT_LABELS[key] || key}</span>
      <input type="number" inputmode="numeric" min="${lo}" max="${hi}" placeholder="${lo}–${hi}" value="${state.minStats[key] ?? ''}">
      <span class="hint">possible: ${lo} – ${hi}</span>`;
    const input = wrap.querySelector('input');
    input.oninput = () => {
      const v = input.value.trim();
      if (v === '') delete state.minStats[key]; else state.minStats[key] = Number(v);
      render();
    };
    box.appendChild(wrap);
  }
  const formula = $('#formula');
  formula.innerHTML = '';
  if (it.stats.length > 1) formula.appendChild(renderWeightControl(it));
}

function renderWeightControl(it) {
  const [a, b] = it.stats;
  const wrap = document.createElement('label');
  wrap.className = 'field weight';
  const w = firstWeight();
  wrap.innerHTML = `<span>Point formula</span>
    <input type="range" min="0" max="100" step="5" value="${w}">
    <span class="hint"></span>`;
  const input = wrap.querySelector('input');
  const hint = wrap.querySelector('.hint');
  const update = () => {
    const v = Number(input.value);
    hint.textContent = `${STAT_LABELS[a]} ${v}% · ${STAT_LABELS[b]} ${100 - v}% · point = 100 × (${v}% × ${STAT_LABELS[a].toLowerCase()}/${it.ranges[a][1]} + ${100 - v}% × ${STAT_LABELS[b].toLowerCase()}/${it.ranges[b][1]})`;
  };
  update();
  input.oninput = () => { state.weights[it.slot] = Number(input.value); saveWeights(); update(); render(); };
  return wrap;
}

// ---- filtering ----------------------------------------------------------
function matches(t) {
  for (const [k, want] of Object.entries(state.minStats)) {
    const have = t.skills[k];
    if (typeof have !== 'number') return false;
    if (state.mode === 'min' && have < want) return false;
    if (state.mode === 'near' && Math.abs(have - want) > Math.max(1, want * 0.05)) return false;
  }
  return true;
}

function inPeriod(t) {
  if (!state.days) return true;
  return t.ts >= Date.now() - state.days * 86_400_000;
}

/**
 * Points of an item. Single-stat equipment: the raw stat value.
 * Multi-stat weapons: 100 × Σ weight_i × value_i / maxPossible_i, so a weapon
 * with every stat at its maximum scores 100 regardless of the weights.
 */
function points(t) {
  const it = item();
  if (it.stats.length === 1) return t.skills[it.stats[0]] || 0;
  const w = firstWeight() / 100;
  const weights = [w, 1 - w];
  return 100 * it.stats.reduce((sum, k, i) => sum + weights[i] * ((t.skills[k] || 0) / it.ranges[k][1]), 0);
}

function pricePerPoint(t) {
  const p = points(t);
  return p > 0 ? t.price / p : Infinity;
}

// ---- render -------------------------------------------------------------
function render() {
  if (!$('#statInputs').children.length) renderStatInputs();
  const period = state.txs.filter(inPeriod);
  const matched = period.filter(matches);
  const hasFilter = Object.keys(state.minStats).length > 0;
  renderTiles(period, matched, hasFilter);
  renderChart(period, matched, hasFilter);
  renderHeatmap(state.txs.filter(matches), hasFilter);
  renderTable(matched, hasFilter);
}

// ---- weekday x hour heatmap ------------------------------------------------
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayIdx = d => (d.getDay() + 6) % 7; // Monday = 0

function renderHeatmap(list, hasFilter) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  for (const t of list) {
    const d = new Date(t.ts);
    cells[dayIdx(d)][d.getHours()].push(t.price);
  }
  const allPrices = list.map(t => t.price).sort((a, b) => a - b);
  const overallMedian = allPrices.length ? allPrices[Math.floor(allPrices.length / 2)] : 0;
  const mode = state.heatMode;
  const MIN_N = 3;

  const stats = cells.map(row => row.map(prices => {
    const n = prices.length;
    if (!n) return { n, median: null, rel: null };
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(n / 2)];
    return { n, median, rel: overallMedian ? median / overallMedian - 1 : null };
  }));

  const maxN = Math.max(1, ...stats.flat().map(c => c.n));
  // colour scale capped at the 90th percentile of deviations so one outlier does not flatten the map
  const rels = stats.flat().filter(c => c.n >= MIN_N && c.rel != null).map(c => Math.abs(c.rel)).sort((a, b) => a - b);
  const maxRel = Math.max(0.05, rels.length ? rels[Math.floor(rels.length * 0.9)] : 0);

  const now = new Date();
  const nowD = dayIdx(now), nowH = now.getHours();
  let html = '<div class="hd"></div>' + Array.from({ length: 24 }, (_, h) => `<div class="hd">${h % 3 === 0 ? h : ''}</div>`).join('');
  for (let d = 0; d < 7; d++) {
    html += `<div class="rl">${DAYS[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = stats[d][h];
      let bg = '', cls = 'cell';
      if (mode === 'count') {
        if (c.n) bg = seqColor(c.n / maxN);
      } else if (c.n >= MIN_N) {
        bg = divColor(c.rel / maxRel);
      } else if (c.n) {
        cls += ' few';
      }
      if (d === nowD && h === nowH) cls += ' now';
      const tip = c.n
        ? `${DAYS[d]} ${pad(h)}:00–${pad(h)}:59 · ${c.n} sale${c.n === 1 ? '' : 's'} · median ${fmtMoney(c.median)} (${fmtPct(c.rel)} vs. overall)`
        : `${DAYS[d]} ${pad(h)}:00 · no sales`;
      html += `<div class="${cls}" style="${bg ? `background:${bg}` : ''}" title="${tip}"></div>`;
    }
  }
  $('#heat').innerHTML = html;

  // summary
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
  const cellsWithData = stats.flat().filter(c => c.n >= MIN_N && c.rel != null);
  const cheapCell = cellsWithData.length ? cellsWithData.reduce((a, b) => (b.rel < a.rel ? b : a)) : null;
  const cheapPos = cheapCell ? findCell(stats, cheapCell) : null;

  const parts = [];
  if (list.length) {
    parts.push(`Busiest: <b>${DAYS[busiestDay]}</b> (${byDay[busiestDay]} sales) and <b>${pad(busiestHour)}:00</b> (${byHour[busiestHour]} sales).`);
    if (cheapest && dearest && cheapest.h !== dearest.h) {
      parts.push(`Cheapest hour: <b>${pad(cheapest.h)}:00</b> (median ${fmtMoney(cheapest.m)}), most expensive: <b>${pad(dearest.h)}:00</b> (median ${fmtMoney(dearest.m)}).`);
    }
    if (cheapPos) parts.push(`Cheapest slot: <b>${DAYS[cheapPos.d]} ${pad(cheapPos.h)}:00</b>, ${fmtPct(cheapCell.rel)} vs. the overall median of ${fmtMoney(overallMedian)}.`);
  }
  $('#heatSummary').innerHTML = parts.join(' ') || 'No sales to analyse.';

  const legend = mode === 'count'
    ? `<span class="heat-legend"><span>fewer</span><span class="bar" style="background:linear-gradient(90deg,${seqColor(0.05)},${seqColor(1)})"></span><span>more sales</span></span>`
    : `<span class="heat-legend"><span>cheaper (−${Math.round(maxRel * 100)}%)</span><span class="bar" style="background:linear-gradient(90deg,${divColor(-1)},${divColor(0)},${divColor(1)})"></span><span>pricier (+${Math.round(maxRel * 100)}%)</span> · hatched = under ${MIN_N} sales</span>`;
  $('#heatNote').innerHTML = `${legend}<br>Based on all ${list.length} cached sales${hasFilter ? ' matching your stats' : ''} (the period filter is not applied). Times are in your local time zone. The outlined cell is right now.`;
}

function findCell(stats, target) {
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (stats[d][h] === target) return { d, h };
  return null;
}
const pad = n => String(n).padStart(2, '0');
const fmtPct = r => r == null ? '–' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`;
// sequential blue ramp (surface -> series blue), t in 0..1
function seqColor(t) {
  const a = [34, 38, 43], b = [57, 135, 229];
  const k = 0.15 + 0.85 * Math.min(1, Math.max(0, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}
// diverging blue (cheap) -> gray -> red (expensive), t in -1..1
function divColor(t) {
  const mid = [56, 56, 53], blue = [57, 135, 229], red = [230, 103, 103];
  const k = Math.min(1, Math.abs(t));
  const to = t < 0 ? blue : red;
  return `rgb(${mid.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',')})`;
}

function statsText(t) {
  return item().stats.map(k => `${STAT_LABELS[k] || k} ${t.skills[k] ?? '–'}`).join(', ');
}

function renderTiles(period, matched, hasFilter) {
  const box = $('#tiles');
  const prices = matched.map(t => t.price).sort((a, b) => a - b);
  const min = prices[0];
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const last = matched.length ? matched.reduce((a, b) => (a.ts > b.ts ? a : b)) : null;
  const best = matched.reduce((b, t) => (Number.isFinite(pricePerPoint(t)) && (!b || pricePerPoint(t) < pricePerPoint(b)) ? t : b), null);
  const it = item();
  const pk = it.stats.length === 1 ? `${STAT_LABELS[primaryStat()].toLowerCase()} point` : 'point';
  const tiles = [
    { k: hasFilter ? 'Best price (with your stats)' : 'Lowest price', v: min != null ? fmtMoney(min) : '–', d: min != null ? `out of ${matched.length} sales` : 'no matching sales', cls: 'best' },
    { k: 'Median price', v: median != null ? fmtMoney(median) : '–', d: 'half of the sales were below' },
    { k: 'Last sale', v: last ? fmtMoney(last.price) : '–', d: last ? `${fmtDate(last.ts)} · ${statsText(last)}` : '' },
    { k: `Best price per ${pk}`, v: best ? fmtMoney(pricePerPoint(best)) : '–', d: best ? `${fmtMoney(best.price)} for ${statsText(best)}${it.stats.length > 1 ? ` (${points(best).toFixed(1)} pts)` : ''}` : '' },
    { k: 'Sales in period', v: period.length, d: hasFilter ? `${matched.length} match` : 'all' },
  ];
  box.innerHTML = tiles.map(t => `<div class="tile ${t.cls || ''}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join('');
}

function renderChart(period, matched, hasFilter) {
  const key = primaryStat();
  $('#chartTitle').textContent = `Price vs. ${STAT_LABELS[key] || key}`;
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(name).trim();
  const matchedIds = new Set(matched.map(t => t.id));
  const pt = t => ({ x: t.skills[key] ?? 0, y: t.price, t });
  const showAll = state.showAll || !hasFilter;
  const others = showAll ? period.filter(t => !matchedIds.has(t.id)).map(pt) : [];
  const hits = matched.map(pt);
  const { floor, median } = aggregateByStat(showAll ? period : matched, key);
  $('#legendOther').style.display = $('#legendOtherText').style.display = showAll ? '' : 'none';

  const datasets = [
    { type: 'line', label: 'Lowest price', data: floor, borderColor: color('--line-floor'), borderWidth: 2, pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 0 },
    { type: 'line', label: 'Median price', data: median, borderColor: color('--line-median'), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0, tension: 0.25, order: 1 },
    { type: 'scatter', label: hasFilter ? 'Match the filter' : 'Sales', data: hits, backgroundColor: hexA(color(hasFilter ? '--series-2' : '--series-1'), 0.85), pointRadius: hasFilter ? 5 : 3, pointHoverRadius: 8, order: 2 },
    { type: 'scatter', label: 'Other sales', data: others, backgroundColor: hexA(color('--series-1'), 0.22), pointRadius: 2.5, pointHoverRadius: 6, order: 3 },
  ];

  const target = state.minStats[key];
  if (state.chart) {
    state.chart.data.datasets = datasets;
    state.chart.options.scales.x.title.text = STAT_LABELS[key] || key;
    state.chart.options.plugins.targetLine.x = target;
    state.chart.update();
    return;
  }

  const grid = color('--border');
  const text = color('--text-2');
  const targetLine = {
    id: 'targetLine',
    afterDatasetsDraw(chart, _args, opts) {
      if (opts.x == null) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(opts.x);
      if (x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = color('--series-2');
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.fillStyle = color('--series-2');
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`min ${opts.x}`, x, chartArea.top - 4);
      ctx.restore();
    },
  };

  state.chart = new Chart($('#chart'), {
    data: { datasets },
    plugins: [targetLine],
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
            label: i => ` ${fmtMoney(i.raw.y)} · ${statsText(i.raw.t)}`,
          },
        },
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: STAT_LABELS[key] || key, color: text }, grid: { color: grid }, ticks: { color: text, precision: 0 } },
        y: { type: 'linear', title: { display: true, text: 'Price', color: text }, grid: { color: grid }, ticks: { color: text } },
      },
    },
  });
}

/** Lowest and median price per stat value, smoothed over ±1 neighbouring values. */
function aggregateByStat(list, key) {
  const byX = new Map();
  for (const t of list) {
    const x = t.skills[key];
    if (typeof x !== 'number') continue;
    if (!byX.has(x)) byX.set(x, []);
    byX.get(x).push(t.price);
  }
  const xs = [...byX.keys()].sort((a, b) => a - b);
  const floor = [], median = [];
  for (const x of xs) {
    const prices = [];
    for (const nx of xs) if (Math.abs(nx - x) <= 1) prices.push(...byX.get(nx));
    prices.sort((a, b) => a - b);
    floor.push({ x, y: prices[0] });
    median.push({ x, y: prices[Math.floor(prices.length / 2)] });
  }
  return { floor, median };
}

function hexA(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function renderTable(matched, hasFilter) {
  const it = item();
  const cols = [
    { key: 'ts', label: 'Date' },
    { key: 'price', label: 'Price', num: true },
    ...it.stats.map(k => ({ key: `s:${k}`, label: STAT_LABELS[k] || k, num: true })),
    ...(it.stats.length > 1 ? [{ key: 'pts', label: 'Points', num: true }] : []),
    { key: 'ppp', label: it.stats.length === 1 ? `Price / ${STAT_LABELS[primaryStat()].toLowerCase()}` : 'Price / point', num: true },
    { key: 'state', label: 'Condition', num: true },
  ];
  const val = (t, key) => key === 'ppp' ? pricePerPoint(t)
    : key === 'pts' ? points(t)
    : key.startsWith('s:') ? (t.skills[key.slice(2)] ?? -Infinity) : t[key];

  const rows = [...matched].sort((a, b) => {
    const d = val(a, state.sortKey) - val(b, state.sortKey);
    return state.sortAsc ? d : -d;
  });
  const bestId = rows.length ? rows.reduce((a, b) => (a.price < b.price ? a : b)).id : null;

  $('#table thead').innerHTML = `<tr>${cols.map(c =>
    `<th data-key="${c.key}" class="${c.num ? 'num' : ''} ${c.key === state.sortKey ? 'sorted' + (state.sortAsc ? ' asc' : '') : ''}">${c.label}</th>`).join('')}</tr>`;
  $('#table thead').querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.key;
    if (state.sortKey === k) state.sortAsc = !state.sortAsc; else { state.sortKey = k; state.sortAsc = k !== 'ts'; }
    renderTable(matched, hasFilter);
  });

  const tbody = $('#table tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No sales with these stats in the selected period. Try lower values or a longer period.</td></tr>`;
  } else {
    tbody.innerHTML = rows.slice(0, 300).map(t => `<tr class="${t.id === bestId ? 'best' : ''}">${cols.map(c => {
      const v = val(t, c.key);
      let text;
      if (c.key === 'ts') text = fmtDate(t.ts);
      else if (c.key === 'price') text = fmtMoney(t.price);
      else if (c.key === 'ppp') text = Number.isFinite(v) ? fmtMoney(v) : '–';
      else if (c.key === 'pts') text = v.toFixed(1);
      else if (c.key === 'state') text = t.state != null ? `${t.state}/${t.maxState}` : '–';
      else text = Number.isFinite(v) ? v : '–';
      return `<td class="${c.num ? 'num' : ''}">${text}</td>`;
    }).join('')}</tr>`).join('');
  }
  $('#tableInfo').textContent = rows.length ? `${rows.length} sales${rows.length > 300 ? ', showing 300' : ''} · ★ = lowest price` : '';
}

// ---- init ---------------------------------------------------------------
$('#days').onchange = e => { state.days = Number(e.target.value); render(); };
$('#mode').onchange = e => { state.mode = e.target.value; render(); };
$('#heatMode').querySelectorAll('button').forEach(b => {
  b.classList.toggle('active', b.dataset.mode === state.heatMode);
  b.onclick = () => {
    state.heatMode = b.dataset.mode; localStorage.setItem('heatMode', state.heatMode);
    $('#heatMode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    render();
  };
});
$('#showAll').checked = state.showAll;
$('#showAll').onchange = e => { state.showAll = e.target.checked; localStorage.setItem('showAll', state.showAll ? '1' : '0'); render(); };

(async () => {
  await loadItems();
  renderStatInputs();
  await loadTransactions();
  state.timer = setInterval(async () => { await loadItems(); await loadTransactions(); }, 60_000);
})();
