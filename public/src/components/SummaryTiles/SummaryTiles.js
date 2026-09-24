/* The five summary tiles: lowest, median, last sale, best price per point, count. */
import { state, item, primaryStat } from '../../store/state.js';
import { $, fmtMoney, fmtDate, median, statLabel } from '../../lib/format.js';
import { points, pricePerPoint, statsText } from '../../lib/analysis.js';

export function render({ period, matched, hasFilter }) {
  const prices = matched.map(t => t.price);
  const min = prices.length ? Math.min(...prices) : null;
  const med = median(prices);
  const last = matched.length ? matched.reduce((a, b) => (a.ts > b.ts ? a : b)) : null;
  const best = matched.reduce((b, t) => (Number.isFinite(pricePerPoint(t)) && (!b || pricePerPoint(t) < pricePerPoint(b)) ? t : b), null);
  const it = item();
  const pk = it.stats.length === 1 ? `${statLabel(primaryStat()).toLowerCase()} point` : 'point';
  const tiles = [
    { k: hasFilter ? 'Best price (with your stats)' : 'Lowest price', v: min != null ? fmtMoney(min) : '–', d: min != null ? `out of ${matched.length} sales` : 'no matching sales', cls: 'best' },
    { k: 'Median price', v: med != null ? fmtMoney(med) : '–', d: 'half of the sales were below' },
    { k: 'Last sale', v: last ? fmtMoney(last.price) : '–', d: last ? `${fmtDate(last.ts)} · ${statsText(last)}` : '' },
    { k: `Best price per ${pk}`, v: best ? fmtMoney(pricePerPoint(best)) : '–', d: best ? `${fmtMoney(best.price)} for ${statsText(best)}${it.stats.length > 1 ? ` (${points(best).toFixed(1)} pts)` : ''}` : '' },
    { k: 'Sales in period', v: period.length, d: hasFilter ? `${matched.length} match` : 'all' },
  ];
  $('#tiles').innerHTML = tiles.map(t => `<div class="tile ${t.cls || ''}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join('');
}
