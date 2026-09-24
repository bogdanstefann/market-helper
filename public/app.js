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
  heatPct: Number(localStorage.getItem('heatPct')) || 90,
  excludeQuick: localStorage.getItem('excludeQuick') !== '0',
  quickSecs: Number(localStorage.getItem('quickSecs')) || 60,
  battles: [], battleStatus: {}, countries: {},
  bigM: Number(localStorage.getItem('bigM')) || 20,
  battlesOn: localStorage.getItem('battlesOn') === '1',
  timelineCharts: null,
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

// ---- API key -------------------------------------------------------------
const KEY_STORAGE = 'warera_api_key';
const getKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
const setKey = k => { try { if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE); } catch {} };

/** Registers the stored key with the server (needed after a server restart, the pool is in memory). */
async function registerKey(key) {
  const r = await fetch('/api/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  const body = await r.json().catch(() => ({}));
  return body.ok ? { ok: true } : { ok: false, error: body.error || `HTTP ${r.status}` };
}

let keyPromise = null;
function askForKey(message) {
  const overlay = $('#keyOverlay'), err = $('#keyError'), input = $('#keyInput');
  err.textContent = message || ''; err.hidden = !message;
  input.value = '';
  overlay.hidden = false;
  input.focus();
  if (!keyPromise) keyPromise = new Promise(resolve => { overlay._resolve = resolve; });
  return keyPromise;
}

$('#keyForm').onsubmit = async e => {
  e.preventDefault();
  const key = $('#keyInput').value.trim();
  const btn = $('#keySave'), err = $('#keyError');
  btn.disabled = true; err.hidden = true;
  const r = await registerKey(key).catch(ex => ({ ok: false, error: ex.message }));
  btn.disabled = false;
  if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
  setKey(key);
  $('#keyOverlay').hidden = true;
  const resolve = $('#keyOverlay')._resolve; keyPromise = null;
  if (resolve) resolve(key);
};
$('#keyShow').onchange = e => { $('#keyInput').type = e.target.checked ? 'text' : 'password'; };
$('#changeKey').onclick = () => askForKey('');

/** fetch() for our API: sends the key, re-registers it after a server restart, asks for a new one if rejected. */
async function api(path, retried = false) {
  let key = getKey();
  if (!key) key = await askForKey('');
  const r = await fetch(path, { headers: { 'x-api-key': key } });
  if (r.status !== 401) return r.json();
  if (!retried) {
    const reg = await registerKey(key).catch(ex => ({ ok: false, error: ex.message }));
    if (reg.ok) return api(path, true);
    setKey('');
    await askForKey(reg.error === 'WarEra rejected this API key' ? 'Your saved API key was rejected, please enter a valid one.' : reg.error);
    return api(path, true);
  }
  throw new Error('API key rejected');
}

// ---- data ---------------------------------------------------------------
async function loadItems() {
  const r = await api('/api/items');
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
  const [r, b] = await Promise.all([
    api(`/api/transactions?code=${code()}`),
    state.battlesOn ? api('/api/battles') : null,
  ]);
  state.txs = r.transactions;
  if (b) {
    state.battles = b.battles;
    state.battleStatus = b.status;
    state.countries = b.countries || {};
    tagBattles(state.txs);
  }
  renderStatus(r.status);
  render();
}

async function setBattlesOn(on) {
  state.battlesOn = on;
  localStorage.setItem('battlesOn', on ? '1' : '0');
  if (on) {
    $('#battleEnable').disabled = true;
    await loadTransactions();
    $('#battleEnable').disabled = false;
  } else {
    state.battles = []; state.battleStatus = {};
    for (const t of state.txs) { delete t.big; delete t.small; }
    render();
  }
}

// ---- battle tagging ----------------------------------------------------------
/** A battle is "big" when its biggest round reached the configured damage threshold. */
const isBigBattle = b => b.maxRound >= state.bigM * 1e6;

/** For each sale, count the small and big battles that were active at that moment. */
function tagBattles(txs) {
  const bs = state.battles;
  for (const t of txs) {
    let big = 0, small = 0;
    for (const b of bs) {
      if (b.start <= t.ts && (b.end == null || b.end >= t.ts)) { if (isBigBattle(b)) big++; else small++; }
    }
    t.big = big; t.small = small;
  }
}
/** Quartiles of "big battles active" over the cached sales; used for the load buckets and symbol colour. */
function battleLoadThresholds() {
  const v = state.txs.map(t => t.big).sort((a, b) => a - b);
  if (!v.length) return { p25: 0, p75: 0, max: 0 };
  return { p25: v[Math.floor(v.length * 0.25)], p75: v[Math.floor(v.length * 0.75)], max: v[v.length - 1] };
}
function battleLevel(t) {
  const th = battleLoadThresholds();
  return t.big >= th.p75 && th.p75 > th.p25 ? 'busy' : t.big <= th.p25 ? 'calm' : 'normal';
}
function isQuick(t) { return t.offerTs != null && t.ts - t.offerTs < state.quickSecs * 1000; }
/** Base list after the quick-sale exclusion; everything else derives from it. */
function baseTxs() { return state.excludeQuick ? state.txs.filter(t => !isQuick(t)) : state.txs; }
function battleSymbol(t) {
  if (t.big === 0 && t.small === 0) return '';
  const th = battleLoadThresholds();
  // grey at/below the calm threshold, full red at the busiest moment seen
  const k = th.max > th.p25 ? Math.min(1, Math.max(0, (t.big - th.p25) / (th.max - th.p25))) : 0;
  const c = mix([107, 110, 106], [230, 103, 103], k);
  return `<span class="bsym" style="background:${c}" title="${battleText(t)}">!</span>`;
}
function battleText(t) {
  return t.big > 0 ? `${t.big} big + ${t.small} small battles active` : t.small > 0 ? `${t.small} small battles active` : 'no battles active';
}
function mix(a, b, k) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; }

const countryName = id => state.countries[id]?.name || (id ? 'Unknown' : '–');
const fmtM = n => `${(n / 1e6).toFixed(1)} M`;
/** Battles active at a moment, biggest first. */
function battlesAt(ts) {
  return state.battles
    .filter(b => b.start <= ts && (b.end == null || b.end >= ts))
    .sort((a, b) => b.maxRound - a.maxRound);
}
function battleListHtml(ts, limit = 10) {
  const list = battlesAt(ts);
  if (!list.length) return '<div class="row"><span>No battles active</span></div>';
  const rows = list.slice(0, limit).map(b => {
    const big = isBigBattle(b);
    return `<div class="row brow"><span><span class="bsym ${big ? 'big' : 'small'}">!</span> ${countryName(b.attacker)} → ${countryName(b.defender)} <span class="muted">${b.type}</span></span><b>${fmtM(b.maxRound)}</b></div>`;
  });
  if (list.length > limit) rows.push(`<div class="row"><span class="muted">+ ${list.length - limit} more</span></div>`);
  return rows.join('');
}

/** Hover tooltip on the battle symbols in the sales table: lists the battles active at that sale. */
function attachBattleTooltip() {
  const tbody = $('#table tbody'), tip = $('#battleTip');
  tbody.onmouseover = e => {
    const sym = e.target.closest('.bsym');
    if (!sym) return;
    const tr = sym.closest('tr');
    const t = state.txs.find(x => x.id === tr?.dataset.id);
    if (!t) return;
    if (sym.classList.contains('quick')) {
      const secs = Math.max(0, Math.round((t.ts - t.offerTs) / 1000));
      const delay = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
      tip.innerHTML = `<div class="t">⚡ Quick sale</div>
        <div class="row"><span>Listed</span><b>${fmtDate(t.offerTs)}</b></div>
        <div class="row"><span>Bought</span><b>${fmtDate(t.ts)}</b></div>
        <div class="row"><span>Time on the market</span><b>${delay}</b></div>
        <div class="row" style="max-width:300px;white-space:normal;margin-top:4px"><span>Bought within ${state.quickSecs} s of listing, so it was probably a pre-arranged deal between two players rather than an open market price. These sales are hidden when "exclude sold within" is ticked.</span></div>`;
    } else {
      if (!state.battlesOn) return;
      tip.innerHTML = `<div class="t">${fmtDate(t.ts)} · ${battleText(t)}</div>${battleListHtml(t.ts)}`;
    }
    tip.hidden = false;
    place(e);
  };
  tbody.onmousemove = e => { if (!tip.hidden) place(e); };
  tbody.onmouseleave = () => { tip.hidden = true; };
  function place(e) {
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - pad;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  }
}

function renderStatus(s) {
  const el = $('#status');
  if (!s) return;
  if (s.lastError) { el.textContent = `Sync error: ${s.lastError}`; el.className = 'status err'; return; }
  el.className = 'status';
  el.textContent = s.lastSync ? `Updated ${fmtDate(s.lastSync)} · refreshes every 60s${s.keys ? ` · ${s.keys} key${s.keys === 1 ? '' : 's'} in pool` : ''}` : 'Syncing…';
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
  const base = baseTxs();
  const quickCount = state.txs.length - base.length;
  $('#quickHint').textContent = state.excludeQuick
    ? `${quickCount} of ${state.txs.length} excluded (< ${state.quickSecs} s on the market)`
    : `${state.txs.filter(isQuick).length} quick sales included, marked ⚡`;
  const period = base.filter(inPeriod);
  const matched = period.filter(matches);
  const hasFilter = Object.keys(state.minStats).length > 0;
  renderTiles(period, matched, hasFilter);
  renderChart(period, matched, hasFilter);
  renderHeatmap(base.filter(matches), hasFilter);
  $('#battleOff').hidden = state.battlesOn;
  $('#battleOn').hidden = !state.battlesOn;
  if (state.battlesOn) renderBattles(matched, hasFilter);
  renderTable(matched, hasFilter);
}

// ---- weekday x hour heatmap ------------------------------------------------
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayIdx = d => (d.getDay() + 6) % 7; // Monday = 0

function renderHeatmap(list, hasFilter) {
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
  const MIN_N = 3;

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
      if (mode === 'count') {
        if (c.n) bg = seqColor(c.n / maxN);
      } else if (c.n >= MIN_N) {
        bg = divColor(c.rel / maxRel);
      } else if (c.n) {
        cls += ' few';
      }
      if (d === nowD && h === nowH) cls += ' now';
      html += `<div class="${cls}" style="${bg ? `background:${bg}` : ''}" data-d="${d}" data-h="${h}"></div>`;
    }
  }
  $('#heat').innerHTML = html;
  attachHeatTooltip(stats, cells, overallMedian, bigCells);

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
    : `<span class="heat-legend"><span>cheaper (−${(maxRel * 100).toFixed(1)}%)</span><span class="bar" style="background:linear-gradient(90deg,${divColor(-1)},${divColor(0)},${divColor(1)})"></span><span>pricier (+${(maxRel * 100).toFixed(1)}%)</span> · scale capped at P${state.heatPct} of deviations · hatched = under ${MIN_N} sales</span>`;
  $('#heatNote').innerHTML = `${legend}<br>Based on all ${list.length} cached sales${hasFilter ? ' matching your stats' : ''} (the period filter is not applied). Times are in your local time zone. The outlined cell is right now.`;
}

function attachHeatTooltip(stats, cells, overallMedian, bigCells) {
  const heat = $('#heat'), tip = $('#heatTip'), wrap = heat.parentElement;
  heat.onmouseover = e => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const d = Number(cell.dataset.d), h = Number(cell.dataset.h);
    const c = stats[d][h];
    const prices = cells[d][h];
    let body = `<div class="t">${DAYS[d]} ${pad(h)}:00–${pad(h)}:59</div>`;
    if (!c.n) {
      body += `<div class="row"><span>Sales</span><b>0</b></div>`;
    } else {
      const sorted = [...prices].sort((a, b) => a - b);
      const relCls = c.rel < 0 ? 'cheap' : c.rel > 0 ? 'dear' : '';
      body += `<div class="row"><span>Sales</span><b>${c.n}</b></div>
        <div class="row"><span>Median</span><b>${fmtMoney(c.median)}</b></div>
        <div class="row"><span>vs. overall median</span><b class="${relCls}">${fmtPct(c.rel)}</b></div>
        <div class="row"><span>Lowest</span><b>${fmtMoney(sorted[0])}</b></div>
        <div class="row"><span>Highest</span><b>${fmtMoney(sorted[sorted.length - 1])}</b></div>
        ${state.battlesOn ? `<div class="row"><span>During a big battle</span><b>${Math.round(100 * bigCells[d][h] / c.n)}% of sales</b></div>` : ''}`;
      if (c.n < 3) body += `<div class="row"><span>too few sales to colour</span></div>`;
    }
    tip.innerHTML = body;
    tip.hidden = false;
    positionTip(e);
  };
  heat.onmousemove = positionTip;
  heat.onmouseleave = () => { tip.hidden = true; };
  function positionTip(e) {
    if (tip.hidden) return;
    const r = wrap.getBoundingClientRect();
    let x = e.clientX - r.left + wrap.scrollLeft + 14;
    let y = e.clientY - r.top + 14;
    if (x + tip.offsetWidth > wrap.scrollLeft + wrap.clientWidth) x = e.clientX - r.left + wrap.scrollLeft - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > wrap.clientHeight) y = e.clientY - r.top - tip.offsetHeight - 14;
    tip.style.left = `${x}px`; tip.style.top = `${Math.max(0, y)}px`;
  }
}

// ---- battles section ---------------------------------------------------------
function renderBattles(matched, hasFilter) {
  const st = state.battleStatus || {};
  const nBig = state.battles.filter(isBigBattle).length;
  $('#battleStatus').textContent = st.lastError ? `Battle sync error: ${st.lastError}` : st.count ? `${st.count} battles cached · ${nBig} big at ≥ ${state.bigM} M` : 'no battle data yet';

  const th = battleLoadThresholds();
  const groups = { calm: [], normal: [], busy: [] };
  for (const t of matched) groups[battleLevel(t)].push(t);
  const all = matched.map(t => t.price).sort((a, b) => a - b);
  const overall = all.length ? all[Math.floor(all.length / 2)] : 0;
  const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const rows = [
    [`Calm: ≤ ${th.p25} big battles active`, groups.calm, '<span class="bsym small">!</span>'],
    [`Normal: ${th.p25 + 1}–${Math.max(th.p25 + 1, th.p75 - 1)} big battles`, groups.normal, `<span class="bsym" style="background:${mix([107, 110, 106], [230, 103, 103], 0.5)}">!</span>`],
    [`Busy: ≥ ${th.p75} big battles active`, groups.busy, '<span class="bsym big">!</span>'],
  ];
  $('#battleTable tbody').innerHTML = rows.map(([label, list, sym]) => {
    const m = med(list.map(t => t.price));
    const ppp = med(list.map(pricePerPoint).filter(Number.isFinite));
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
  const price = buckets.map((b, i) => {
    const s = [...b].sort((a, c) => a - c);
    return { x: start + i * 3_600_000, y: s.length ? s[Math.floor(s.length / 2)] : null, n: s.length };
  });
  const bigCount = Array.from({ length: HOURS }, (_, i) => {
    const t = start + i * 3_600_000 + 1_800_000;
    return { x: start + i * 3_600_000, y: state.battles.filter(b => isBigBattle(b) && b.start <= t && (b.end == null || b.end >= t)).length };
  });

  const css = getComputedStyle(document.documentElement);
  const color = n => css.getPropertyValue(n).trim();
  const grid = color('--border'), text = color('--text-2');
  const xScale = { type: 'linear', min: start, max: end, grid: { color: grid }, ticks: { color: text, maxTicksLimit: 8, callback: v => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit' }) } };
  const common = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } } };

  if (!state.timelineCharts) {
    state.timelineCharts = {
      price: new Chart($('#priceTimeline'), {
        type: 'line',
        data: { datasets: [{ data: price, borderColor: color('--line-median'), borderWidth: 2, borderDash: [6, 4], pointRadius: 2, pointBackgroundColor: color('--line-median'), spanGaps: true }] },
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
    return;
  }
  const { price: pc, battles: bc } = state.timelineCharts;
  pc.data.datasets[0].data = price; Object.assign(pc.options.scales.x, { min: start, max: end }); pc.update();
  bc.data.datasets[0].data = bigCount; Object.assign(bc.options.scales.x, { min: start, max: end }); bc.update();
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
            label: i => {
              const lines = [` ${fmtMoney(i.raw.y)} · ${statsText(i.raw.t)}${isQuick(i.raw.t) ? ' · quick sale' : ''}`];
              if (state.battlesOn) lines.push(` ${battleText(i.raw.t)}`);
              return lines;
            },
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
    ...(state.battlesOn ? [{ key: 'battle', label: 'Battle', num: true }] : []),
  ];
  const val = (t, key) => key === 'ppp' ? pricePerPoint(t)
    : key === 'pts' ? points(t)
    : key === 'battle' ? t.big * 100 + t.small
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
    tbody.innerHTML = rows.slice(0, 300).map(t => `<tr class="${t.id === bestId ? 'best' : ''}" data-ts="${t.ts}" data-id="${t.id}">${cols.map(c => {
      const v = val(t, c.key);
      let text;
      if (c.key === 'ts') text = fmtDate(t.ts);
      else if (c.key === 'price') text = fmtMoney(t.price);
      else if (c.key === 'ppp') text = Number.isFinite(v) ? fmtMoney(v) : '–';
      else if (c.key === 'pts') text = v.toFixed(1);
      else if (c.key === 'battle') text = battleSymbol(t);
      else if (c.key === 'state') text = t.state != null ? `${t.state}/${t.maxState}` : '–';
      else text = Number.isFinite(v) ? v : '–';
      if (c.key === 'ts' && isQuick(t)) text += ' <span class="bsym quick">⚡</span>';
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
$('#heatScale').querySelectorAll('button').forEach(b => {
  b.classList.toggle('active', Number(b.dataset.p) === state.heatPct);
  b.onclick = () => {
    state.heatPct = Number(b.dataset.p); localStorage.setItem('heatPct', state.heatPct);
    $('#heatScale').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    render();
  };
});
attachBattleTooltip();
$('#battleEnable').onclick = () => setBattlesOn(true);
$('#battleDisable').onclick = () => setBattlesOn(false);
$('#bigM').value = String(state.bigM);
$('#bigM').onchange = e => {
  const v = Number(e.target.value);
  if (!(v > 0)) return;
  state.bigM = v; localStorage.setItem('bigM', v);
  tagBattles(state.txs); render();
};
$('#excludeQuick').checked = state.excludeQuick;
$('#excludeQuick').onchange = e => { state.excludeQuick = e.target.checked; localStorage.setItem('excludeQuick', state.excludeQuick ? '1' : '0'); render(); };
$('#quickSecs').value = String(state.quickSecs);
$('#quickSecs').onchange = e => { state.quickSecs = Number(e.target.value); localStorage.setItem('quickSecs', state.quickSecs); render(); };
$('#showAll').checked = state.showAll;
$('#showAll').onchange = e => { state.showAll = e.target.checked; localStorage.setItem('showAll', state.showAll ? '1' : '0'); render(); };

(async () => {
  await loadItems();
  renderStatInputs();
  await loadTransactions();
  state.timer = setInterval(async () => { await loadItems(); await loadTransactions(); }, 60_000);
})();
