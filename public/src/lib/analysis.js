/*
 * Pure logic over sales and battles: filtering, scoring, aggregation.
 * Nothing here touches the DOM.
 */
import { state, item, firstWeight } from '../store/state.js';
import { statLabel } from './format.js';

// ---- filters ----
export function matches(t) {
  for (const [k, want] of Object.entries(state.minStats)) {
    const have = t.skills[k];
    if (typeof have !== 'number') return false;
    if (state.mode === 'min' && have < want) return false;
    if (state.mode === 'near' && Math.abs(have - want) > Math.max(1, want * 0.05)) return false;
  }
  return true;
}
export const inPeriod = t => !state.days || t.ts >= Date.now() - state.days * 86_400_000;
export const hasFilter = () => Object.keys(state.minStats).length > 0;

/** A "quick sale" was bought within quickSecs of being listed: probably a pre-arranged deal. */
export const isQuick = t => t.offerTs != null && t.ts - t.offerTs < state.quickSecs * 1000;
/** Base list after the quick-sale exclusion; everything else derives from it. */
export const baseTxs = () => (state.excludeQuick ? state.txs.filter(t => !isQuick(t)) : state.txs);

/** The lists every component renders from. */
export function currentView() {
  const base = baseTxs();
  const period = base.filter(inPeriod);
  const matched = period.filter(matches);
  // quick sales that would have been in the period but are excluded
  const excludedQuick = state.excludeQuick ? state.txs.filter(t => isQuick(t) && inPeriod(t)).length : 0;
  return { base, period, matched, hasFilter: hasFilter(), excludedQuick };
}

// ---- scoring ----
/**
 * Points of an item. Single-stat equipment: the raw stat value.
 * Multi-stat weapons: 100 × Σ weight_i × value_i / maxPossible_i, so a weapon
 * with every stat at its maximum scores 100 regardless of the weights.
 */
export function points(t) {
  const it = item();
  if (it.stats.length === 1) return t.skills[it.stats[0]] || 0;
  const w = firstWeight() / 100;
  const weights = [w, 1 - w];
  return 100 * it.stats.reduce((sum, k, i) => sum + weights[i] * ((t.skills[k] || 0) / it.ranges[k][1]), 0);
}
export function pricePerPoint(t) {
  const p = points(t);
  return p > 0 ? t.price / p : Infinity;
}
export const statsText = t => item().stats.map(k => `${statLabel(k)} ${t.skills[k] ?? '–'}`).join(', ');

/** Lowest and median price per stat value, smoothed over ±window neighbouring values. */
export function aggregateByStat(list, key, window = 1) {
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
    for (const nx of xs) if (Math.abs(nx - x) <= window) prices.push(...byX.get(nx));
    prices.sort((a, b) => a - b);
    floor.push({ x, y: prices[0] });
    median.push({ x, y: prices[Math.floor(prices.length / 2)] });
  }
  return { floor, median };
}

// ---- battles ----
/** A battle is "big" when its biggest round reached the configured damage threshold. */
export const isBigBattle = b => b.maxRound >= state.bigM * 1e6;
export const activeAt = (b, ts) => b.start <= ts && (b.end == null || b.end >= ts);

/** For each sale, count the small and big battles that were active at that moment. */
export function tagBattles(txs) {
  for (const t of txs) {
    let big = 0, small = 0;
    for (const b of state.battles) if (activeAt(b, t.ts)) { if (isBigBattle(b)) big++; else small++; }
    t.big = big; t.small = small;
  }
}
/** Battles active at a moment, biggest first. */
export const battlesAt = ts => state.battles.filter(b => activeAt(b, ts)).sort((a, b) => b.maxRound - a.maxRound);

/** Quartiles of "big battles active" over the cached sales; used for the load buckets and symbol colour. */
export function battleLoadThresholds() {
  const v = state.txs.map(t => t.big).sort((a, b) => a - b);
  if (!v.length) return { p25: 0, p75: 0, max: 0 };
  return { p25: v[Math.floor(v.length * 0.25)], p75: v[Math.floor(v.length * 0.75)], max: v[v.length - 1] };
}
export function battleLevel(t) {
  const th = battleLoadThresholds();
  return t.big >= th.p75 && th.p75 > th.p25 ? 'busy' : t.big <= th.p25 ? 'calm' : 'normal';
}
/** 0 at/below the calm threshold, 1 at the busiest moment seen. */
export function battleLoad(t) {
  const th = battleLoadThresholds();
  return th.max > th.p25 ? Math.min(1, Math.max(0, (t.big - th.p25) / (th.max - th.p25))) : 0;
}
export const battleText = t => t.big > 0 ? `${t.big} big + ${t.small} small battles active`
  : t.small > 0 ? `${t.small} small battles active` : 'no battles active';
