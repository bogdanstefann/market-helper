/* Item-market sales: fetch from WarEra, cache per item in IndexedDB. */
import { trpc, sleep, REQUEST_GAP_MS } from './api.js';
import { dbGet, dbSet, dbKeys } from './cache.js';

const BACKFILL_DAYS = 14;        // how far back the first load of an item goes
const BACKFILL_MAX_PAGES = 10;   // 10 x 100 sales per item at most
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

const memory = new Map(); // code -> { txs: Map<id, tx>, updatedAt }

async function loadItemCache(code) {
  if (memory.has(code)) return memory.get(code);
  const saved = await dbGet(`tx:${code}`);
  const entry = { txs: new Map(), updatedAt: saved?.updatedAt || 0 };
  for (const t of saved?.txs || []) entry.txs.set(t.id, t);
  memory.set(code, entry);
  return entry;
}

/** Cached sales of an item, newest first (no network). */
export async function getTransactions(code) {
  const entry = await loadItemCache(code);
  return [...entry.txs.values()].sort((a, b) => b.ts - a.ts);
}

/**
 * Fetches new sales of one item. First time: walks back up to BACKFILL_DAYS /
 * BACKFILL_MAX_PAGES. Afterwards: stops at the first sale already cached.
 * Returns the number of new rows.
 */
export async function syncItem(code, key, onProgress) {
  const entry = await loadItemCache(code);
  const backfill = entry.txs.size === 0;
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
  const maxPages = backfill ? BACKFILL_MAX_PAGES : 3;
  let cursor, added = 0;
  for (let page = 0; page < maxPages; page++) {
    const input = { limit: 100, transactionType: 'itemMarket', itemCode: code };
    if (cursor) input.cursor = cursor;
    const data = await trpc('transaction.getPaginatedTransactions', input, key);
    let sawKnown = false;
    for (const raw of data.items) {
      const t = normalize(raw);
      if (entry.txs.has(t.id)) { sawKnown = true; continue; }
      entry.txs.set(t.id, t); added++;
    }
    onProgress?.({ page: page + 1, maxPages, added });
    const oldest = data.items.at(-1);
    const tooOld = oldest && Date.parse(oldest.createdAt) < cutoff;
    if (!data.nextCursor || tooOld || (!backfill && sawKnown)) break;
    cursor = data.nextCursor;
    await sleep(REQUEST_GAP_MS);
  }
  const prune = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const [id, t] of entry.txs) if (t.ts < prune) entry.txs.delete(id);
  entry.updatedAt = Date.now();
  await dbSet(`tx:${code}`, { txs: [...entry.txs.values()], updatedAt: entry.updatedAt });
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

