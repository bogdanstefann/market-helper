/* Sortable table of the matching sales, with the ⚡ and battle `!` marks and their hover tooltip. */
import { state, item, primaryStat } from '../../store/state.js';
import { $, fmtMoney, fmtDate, statLabel } from '../../lib/format.js';
import { points, pricePerPoint, isQuick, battleText } from '../../lib/analysis.js';
import { battleSymbol, battleListHtml } from '../Battles/Battles.js';

const PAGE = 300;
let lastView = null;

export function init() { attachTooltip(); }

export function render(view) {
  lastView = view;
  const { matched } = view;
  const it = item();
  const cols = [
    { key: 'ts', label: 'Date' },
    { key: 'price', label: 'Price', num: true },
    ...it.stats.map(k => ({ key: `s:${k}`, label: statLabel(k), num: true })),
    ...(it.stats.length > 1 ? [{ key: 'pts', label: 'Points', num: true }] : []),
    { key: 'ppp', label: it.stats.length === 1 ? `Price / ${statLabel(primaryStat()).toLowerCase()}` : 'Price / point', num: true },
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
    render(lastView);
  });

  const tbody = $('#table tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No sales with these stats in the selected period. Try lower values or a longer period.</td></tr>`;
  } else {
    tbody.innerHTML = rows.slice(0, PAGE).map(t => `<tr class="${t.id === bestId ? 'best' : ''}" data-id="${t.id}">${cols.map(c => {
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
  $('#tableInfo').textContent = rows.length ? `${rows.length} sales${rows.length > PAGE ? `, showing ${PAGE}` : ''} · ★ = lowest price` : '';
}

/** Hover on ⚡ explains the quick sale; hover on `!` lists the battles active at that sale. */
function attachTooltip() {
  const tbody = $('#table tbody'), tip = $('#battleTip');
  tbody.onmouseover = e => {
    const sym = e.target.closest('.bsym');
    if (!sym) { tip.hidden = true; return; }
    const t = state.txs.find(x => x.id === sym.closest('tr')?.dataset.id);
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
  tbody.onmouseout = e => { if (e.target.closest('.bsym') && !e.relatedTarget?.closest?.('.bsym')) tip.hidden = true; };
  tbody.onmouseleave = () => { tip.hidden = true; };
  function place(e) {
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - pad;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  }
}
