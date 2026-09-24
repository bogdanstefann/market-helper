/*
 * Shared application state plus the helpers that read it. Settings the user
 * can change are persisted in localStorage through `setting()`.
 */
import { ITEMS, SLOTS, RARITIES } from '../config/items.js';

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* private mode */ } },
};

export const state = {
  // selection
  slot: null, rarity: null,
  minStats: {}, days: 7,
  statModes: JSON.parse(store.get('statModes', '{}') || '{}'), // stat -> 'min' | 'exact' | 'near'
  nearPct: Number(store.get('nearPct', 5)) || 5,
  // persisted settings
  weights: JSON.parse(store.get('weights', '{}') || '{}'),
  showAll: store.get('showAll', '1') !== '0',
  heatMode: store.get('heatMode', 'count'),
  heatPct: Number(store.get('heatPct', 90)) || 90,
  excludeQuick: store.get('excludeQuick', '1') !== '0',
  quickSecs: Number(store.get('quickSecs', 60)) || 60,
  bigM: Number(store.get('bigM', 20)) || 20,
  battlesOn: store.get('battlesOn', '0') === '1',
  chartOpts: { floor: true, median: true, levels: false, colorBy: true, ...JSON.parse(store.get('chartOpts', '{}') || '{}') },
  // data
  txs: [], counts: {}, battles: [], countries: {},
  // table sort
  sortKey: 'price', sortAsc: true,
};

/** Update a persisted setting: state[key] = value, and remember it. */
export function setting(key, value) {
  state[key] = value;
  store.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
}

export function restoreSelection() {
  const slot = store.get('slot', '');
  state.slot = slot in SLOTS ? slot : Object.keys(SLOTS)[0];
  const rarity = store.get('rarity', '');
  state.rarity = RARITIES.includes(rarity) ? rarity : 'mythic';
}
export function saveSelection() { store.set('slot', state.slot); store.set('rarity', state.rarity); }

/** Item code for a slot + rarity (weapons have named codes, equipment is slot + tier). */
export const codeFor = (slot, rarity) => SLOTS[slot].codes?.[rarity] ?? `${slot}${RARITIES.indexOf(rarity) + 1}`;
export const code = () => codeFor(state.slot, state.rarity);
export const item = () => ITEMS[code()];
export const primaryStat = () => item().stats[0];
/** Weight (0-100) of the first stat for a multi-stat slot; the second stat gets the rest. */
export const firstWeight = () => state.weights[item().slot] ?? 40;
