/* Item-market sales: fetch from WarEra, cache per item in IndexedDB. */
import { trpc, sleep, REQUEST_GAP_MS } from './api.js';
import { dbGet, dbSet, dbKeys } from './cache.js';

const HISTORY_DAYS = 14;         // how far back we eventually want every sale
const FIRST_LOAD_PAGES = 10;     // the first load of an item stops here (10 x 100 sales) so the page shows up fast
const BACKFILL_PAGES_PER_TICK = 5; // older pages fetched on each later sync until HISTORY_DAYS is covered
const NEW_PAGES_MAX = 60;        // safety cap when catching up after the page was closed for a while
const MAX_AGE_DAYS = 30;         // older cached rows are dropped

function normalize(tx) {
  return {
    id: tx._id, code: tx.itemCode, price: tx.money,
    ts: Date.parse(tx.createdAt),
    offerTs: tx.offerCreatedAt ? Date.parse(tx.offerCreatedAt) : null,
    skills: tx.item?.skills || {},
    state: tx.item?.state ?? null, maxState: tx.item?.maxState ?? null,
    sellerId: tx.sellerId, buyerId: tx.buyerId,
  };
}

const memory = new Map(); // code -> { txs: Map<id, tx>, updatedAt, olderCursor, complete }

async function loadItemCache(code) {
  if (memory.has(code)) return memory.get(code);
  const saved = await dbGet(`tx:${code}`);
  const entry = { txs: new Map(), updatedAt: saved?.updatedAt || 0, olderCursor: saved?.olderCursor || null, complete: !!saved?.complete };
  for (const t of saved?.txs || []) entry.txs.set(t.id, t);
  memory.set(code, entry);
  return entry;
}

async function saveItemCache(code, entry) {
  entry.updatedAt = Date.now();
  await dbSet(`tx:${code}`, { txs: [...entry.txs.values()], updatedAt: entry.updatedAt, olderCursor: entry.olderCursor, complete: entry.complete });
}

/** Cached sales of an item, newest first (no network). */
export async function getTransactions(code) {
  const entry = await loadItemCache(code);
  return [...entry.txs.values()].sort((a, b) => b.ts - a.ts);
}

/** How far back the cache of an item goes, and whether the HISTORY_DAYS window is fully covered. */
export async function historyStatus(code) {
  const entry = await loadItemCache(code);
  let oldest = null;
  for (const t of entry.txs.values()) if (oldest == null || t.ts < oldest) oldest = t.ts;
  return { count: entry.txs.size, oldest, complete: entry.complete, days: HISTORY_DAYS };
}

async function fetchPage(code, key, cursor) {
  const input = { limit: 100, transactionType: 'itemMarket', itemCode: code };
  if (cursor) input.cursor = cursor;
  const data = await trpc('transaction.getPaginatedTransactions', input, key);
  await sleep(REQUEST_GAP_MS);
  return data;
}

/**
 * Syncs one item in two passes and returns the number of new rows.
 *  1. Newest first, until a cached sale shows up (or the history window ends).
 *     On the very first load this pass stops after FIRST_LOAD_PAGES and keeps
 *     the cursor, so the page renders quickly.
 *  2. Older pages from that cursor, a few per call, until every sale in the
 *     last HISTORY_DAYS is cached (entry.complete).
 */
export async function syncItem(code, key, onProgress) {
  const entry = await loadItemCache(code);
  const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
  const firstLoad = entry.txs.size === 0;
  let added = 0;

  // pass 1: new sales
  let cursor;
  const maxPages = firstLoad ? FIRST_LOAD_PAGES : NEW_PAGES_MAX;
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(code, key, cursor);
    let sawKnown = false;
    for (const raw of data.items) {
      const t = normalize(raw);
      if (entry.txs.has(t.id)) { sawKnown = true; continue; }
      entry.txs.set(t.id, t); added++;
    }
    onProgress?.({ phase: 'new', page: page + 1, maxPages: firstLoad ? FIRST_LOAD_PAGES : null, added });
    const oldest = data.items.at(-1);
    const reachedWindowEnd = !data.nextCursor || (oldest && Date.parse(oldest.createdAt) < cutoff);
    if (reachedWindowEnd) { entry.complete = true; entry.olderCursor = null; break; }
    if (!firstLoad && sawKnown) break;
    cursor = data.nextCursor;
    if (firstLoad && page === FIRST_LOAD_PAGES - 1) { entry.olderCursor = cursor; entry.complete = false; }
  }

  // pass 2: older sales, a few pages per call. Without a saved cursor (cache
  // from an older version) it starts from the top and skips what is cached.
  if (!entry.complete) {
    for (let page = 0; page < BACKFILL_PAGES_PER_TICK; page++) {
      const data = await fetchPage(code, key, entry.olderCursor || undefined);
      for (const raw of data.items) {
        const t = normalize(raw);
        if (!entry.txs.has(t.id)) { entry.txs.set(t.id, t); added++; }
      }
      const oldest = data.items.at(-1);
      onProgress?.({ phase: 'older', added, oldest: oldest ? Date.parse(oldest.createdAt) : null });
      if (!data.nextCursor || (oldest && Date.parse(oldest.createdAt) < cutoff)) { entry.complete = true; entry.olderCursor = null; break; }
      entry.olderCursor = data.nextCursor;
    }
  }

  const prune = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const [id, t] of entry.txs) if (t.ts < prune) entry.txs.delete(id);
  await saveItemCache(code, entry);
  return added;
}

/** Number of cached sales per item code (for the rarity buttons). */
export async function cachedCounts() {
  const counts = {};
  for (const k of await dbKeys()) {
    if (typeof k !== 'string' || !k.startsWith('tx:')) continue;
    const code = k.slice(3);
    const entry = await loadItemCache(code);
    counts[code] = entry.txs.size;
  }
  for (const [code, entry] of memory) counts[code] = entry.txs.size;
  return counts;
}

