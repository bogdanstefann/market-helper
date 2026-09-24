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
  renderTable(matched, hasFilter);
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
$('#showAll').checked = state.showAll;
$('#showAll').onchange = e => { state.showAll = e.target.checked; localStorage.setItem('showAll', state.showAll ? '1' : '0'); render(); };

(async () => {
  await loadItems();
  renderStatInputs();
  await loadTransactions();
  state.timer = setInterval(async () => { await loadItems(); await loadTransactions(); }, 60_000);
})();
