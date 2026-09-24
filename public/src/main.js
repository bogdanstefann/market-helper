/*
 * Entry point: loads what is cached, asks for the API key, syncs with WarEra
 * every minute and re-renders the components. Components never talk to each
 * other directly; they call back here and this file calls render().
 */
import { state, restoreSelection, saveSelection, code, setting } from './store/state.js';
import { ApiKeyError } from './services/api.js';
import { getTransactions, syncItem, cachedCounts } from './services/market.js';
import { getBattles, syncBattles, getCountries } from './services/battles.js';
import { currentView, matches, tagBattles } from './lib/analysis.js';
import * as ApiKey from './components/ApiKey/ApiKey.js';
import * as StatusBar from './components/StatusBar/StatusBar.js';
import * as ItemSelector from './components/ItemSelector/ItemSelector.js';
import * as Filters from './components/Filters/Filters.js';
import * as SummaryTiles from './components/SummaryTiles/SummaryTiles.js';
import * as PriceChart from './components/PriceChart/PriceChart.js';
import * as Heatmap from './components/Heatmap/Heatmap.js';
import * as Battles from './components/Battles/Battles.js';
import * as SalesTable from './components/SalesTable/SalesTable.js';

const sync = { running: false, lastSync: null, lastError: null, note: '' };
const status = () => StatusBar.render(sync);

// ---- render ----
function render() {
  const view = currentView();
  Filters.renderQuickHint();
  SummaryTiles.render(view);
  PriceChart.render(view);
  Heatmap.render(view.base.filter(matches), view.hasFilter);
  Battles.render(view);
  SalesTable.render(view);
}

// ---- data flow ----
async function selectItem(slot, rarity) {
  state.slot = slot; state.rarity = rarity;
  saveSelection();
  state.minStats = {};
  ItemSelector.render();
  Filters.renderStatInputs();
  await loadTransactions();
}

/** Shows what is cached right away, then fetches what is new. */
async function loadTransactions() {
  const c = code();
  state.txs = await getTransactions(c);
  if (state.battlesOn) {
    state.battles = await getBattles();
    state.countries = await getCountries();
    tagBattles(state.txs);
  }
  render();
  await refresh();
}

async function refresh() {
  if (sync.running) return;
  sync.running = true;
  status();
  const c = code();
  try {
    const key = await ApiKey.requireKey();
    const first = state.txs.length === 0;
    await syncItem(c, key, p => { if (first) { sync.note = `loading history, page ${p.page} of ${p.maxPages}…`; status(); } });
    if (c === code()) {
      state.txs = await getTransactions(c);
      if (state.battlesOn && state.battles.length) tagBattles(state.txs);
      render();
    }
    if (state.battlesOn) {
      const noBattles = state.battles.length === 0;
      await syncBattles(key, p => { if (noBattles) { sync.note = `loading battles, page ${p.page} of ${p.maxPages}…`; status(); } });
      state.battles = await getBattles();
      state.countries = await getCountries();
    }
    sync.note = ''; sync.lastSync = Date.now(); sync.lastError = null;
    if (c === code()) {
      state.txs = await getTransactions(c);
      if (state.battlesOn) tagBattles(state.txs);
      state.counts = await cachedCounts();
      ItemSelector.render();
      render();
    }
  } catch (err) {
    if (err instanceof ApiKeyError) {
      ApiKey.clearKey();
      sync.running = false;
      await ApiKey.askForKey('Your saved API key was rejected, please enter a valid one.');
      return refresh();
    }
    sync.lastError = err.message; sync.note = '';
  } finally {
    sync.running = false;
    status();
  }
}

async function toggleBattles(on) {
  setting('battlesOn', on ? '1' : '0');
  state.battlesOn = on;
  if (on) {
    document.querySelector('#battleEnable').disabled = true;
    await loadTransactions();
    document.querySelector('#battleEnable').disabled = false;
  } else {
    state.battles = [];
    for (const t of state.txs) { delete t.big; delete t.small; }
    render();
  }
}

// ---- boot ----
ApiKey.init();
ItemSelector.init({ onSelect: selectItem });
Filters.init({ onChange: render });
PriceChart.init({ onChange: render });
Heatmap.init({ onChange: render });
Battles.init({ onToggle: toggleBattles, onThreshold: () => { tagBattles(state.txs); render(); } });
SalesTable.init();

(async () => {
  restoreSelection();
  state.counts = await cachedCounts();
  ItemSelector.render();
  Filters.renderStatInputs();
  await ApiKey.requireKey();
  await loadTransactions();
  setInterval(refresh, 60_000);
})();
