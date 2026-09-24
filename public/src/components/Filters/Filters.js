/*
 * Stat minimums, point-formula slider, period, match mode, quick-sale
 * exclusion. Calls onChange() after every change; the app re-renders.
 */
import { state, item, setting, firstWeight } from '../../store/state.js';
import { $, statLabel } from '../../lib/format.js';
import { isQuick, baseTxs } from '../../lib/analysis.js';

let onChange = () => {};

export function init(handlers) {
  onChange = handlers.onChange;
  $('#days').onchange = e => { state.days = Number(e.target.value); onChange(); };
  $('#mode').onchange = e => { state.mode = e.target.value; renderStatInputs(); onChange(); };
  $('#excludeQuick').checked = state.excludeQuick;
  $('#excludeQuick').onchange = e => { setting('excludeQuick', e.target.checked ? '1' : '0'); state.excludeQuick = e.target.checked; onChange(); };
  $('#quickSecs').value = String(state.quickSecs);
  $('#quickSecs').onchange = e => { setting('quickSecs', Number(e.target.value)); onChange(); };
}

/** Rebuilds the stat inputs for the selected item (call after the item changes). */
export function renderStatInputs() {
  const box = $('#statInputs');
  box.innerHTML = '';
  const it = item();
  for (const key of it.stats) {
    const [lo, hi] = it.ranges[key];
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const label = state.mode === 'exact' ? `${statLabel(key)} (exact)` : state.mode === 'near' ? `${statLabel(key)} (±5%)` : `Min ${statLabel(key)}`;
    wrap.innerHTML = `<span>${label}</span>
      <input type="number" inputmode="numeric" min="${lo}" max="${hi}" placeholder="${lo}–${hi}" value="${state.minStats[key] ?? ''}">
      <span class="hint">possible: ${lo} – ${hi}</span>`;
    const input = wrap.querySelector('input');
    input.oninput = () => {
      const v = input.value.trim();
      if (v === '') delete state.minStats[key]; else state.minStats[key] = Number(v);
      onChange();
    };
    box.appendChild(wrap);
  }
  const formula = $('#formula');
  formula.innerHTML = '';
  if (it.stats.length > 1) formula.appendChild(weightControl(it));
}

function weightControl(it) {
  const [a, b] = it.stats;
  const wrap = document.createElement('label');
  wrap.className = 'field weight';
  wrap.innerHTML = `<span>Point formula</span>
    <input type="range" min="0" max="100" step="5" value="${firstWeight()}">
    <span class="hint"></span>`;
  const input = wrap.querySelector('input');
  const hint = wrap.querySelector('.hint');
  const update = () => {
    const v = Number(input.value);
    hint.textContent = `${statLabel(a)} ${v}% · ${statLabel(b)} ${100 - v}% · point = 100 × (${v}% × ${statLabel(a).toLowerCase()}/${it.ranges[a][1]} + ${100 - v}% × ${statLabel(b).toLowerCase()}/${it.ranges[b][1]})`;
  };
  update();
  input.oninput = () => {
    state.weights[it.slot] = Number(input.value);
    setting('weights', state.weights);
    update(); onChange();
  };
  return wrap;
}

/** The "N of M excluded" line under the quick-sales control. */
export function renderQuickHint() {
  const base = baseTxs();
  $('#quickHint').textContent = state.excludeQuick
    ? `${state.txs.length - base.length} of ${state.txs.length} excluded (< ${state.quickSecs} s on the market)`
    : `${state.txs.filter(isQuick).length} quick sales included, marked ⚡`;
}
