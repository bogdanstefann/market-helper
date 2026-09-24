import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- config -------------------------------------------------------------
loadDotEnv(path.join(__dirname, '.env'));
const API_KEY = process.env.WARERA_API_KEY;
const PORT = Number(process.env.PORT || 3777);
const API_BASE = 'https://api2.warera.io/trpc';
const DATA_FILE = path.join(__dirname, 'data', 'transactions.json');
const POLL_MS = 60_000;          // how often to poll for new transactions
const BACKFILL_DAYS = 14;        // how much history to backfill on first start
const BACKFILL_MAX_PAGES = 10;   // max 10 x 100 transactions per item on backfill
const REQUEST_GAP_MS = 120;      // pause between API calls (limit is 500/min)
const MAX_AGE_DAYS = 30;         // older transactions are pruned from the cache

if (!API_KEY) {
  console.error('Missing WARERA_API_KEY (set it in .env).');
  process.exit(1);
}

// Item slots x rarities. Stat ranges come from gameConfig.getGameConfig (dynamicStats).
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const SLOTS = {
  weapon: { label: 'Weapon', stats: ['attack', 'criticalChance'],
    codes: { common: 'knife', uncommon: 'gun', rare: 'rifle', epic: 'sniper', legendary: 'tank', mythic: 'jet' },
    ranges: { knife: { attack: [21, 40], criticalChance: [1, 5] }, gun: { attack: [51, 60], criticalChance: [6, 10] },
      rifle: { attack: [71, 90], criticalChance: [11, 15] }, sniper: { attack: [101, 130], criticalChance: [16, 20] },
      tank: { attack: [141, 170], criticalChance: [26, 35] }, jet: { attack: [221, 300], criticalChance: [41, 50] } } },
  helmet: { label: 'Helmet', stats: ['criticalDamages'], ranges: { criticalDamages: [[1, 15], [16, 30], [31, 50], [71, 90], [91, 110], [121, 150]] } },
  chest:  { label: 'Chest',  stats: ['armor'],     ranges: { armor: [[1, 5], [6, 10], [11, 15], [21, 30], [36, 50], [56, 70]] } },
  pants:  { label: 'Pants',  stats: ['armor'],     ranges: { armor: [[1, 5], [6, 10], [11, 15], [21, 30], [36, 50], [56, 70]] } },
  gloves: { label: 'Gloves', stats: ['precision'], ranges: { precision: [[1, 5], [6, 10], [11, 15], [21, 25], [31, 40], [51, 60]] } },
  boots:  { label: 'Boots',  stats: ['dodge'],     ranges: { dodge: [[1, 5], [6, 10], [11, 15], [21, 25], [31, 40], [51, 60]] } },
};

/** code -> { slot, rarity, label, stats, ranges: { stat: [min, max] } } */
export const ITEMS = {};
for (const [slot, def] of Object.entries(SLOTS)) {
  RARITIES.forEach((rarity, i) => {
    const code = def.codes ? def.codes[rarity] : `${slot}${i + 1}`;
    const ranges = {};
    for (const stat of def.stats) ranges[stat] = def.codes ? def.ranges[code][stat] : def.ranges[stat][i];
    ITEMS[code] = { code, slot, rarity, label: def.label, stats: def.stats, ranges };
  });
}

// ---- storage ------------------------------------------------------------
/** @type {Map<string, any>} id -> transaction */
const store = new Map();
const status = { lastSync: null, lastError: null, syncing: false, perItem: {} };

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const t of raw) store.set(t.id, t);
    console.log(`Loaded ${store.size} transactions from cache.`);
  } catch { /* no cache yet */ }
}

let saveTimer = null;
function saveStoreSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify([...store.values()]));
  }, 500);
}

function pruneOld() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const [id, t] of store) if (t.ts < cutoff) store.delete(id);
}

// ---- WarEra API ---------------------------------------------------------
async function trpc(proc, input) {
  const url = `${API_BASE}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`;
    throw new Error(`${proc}: ${msg}`);
  }
  return body.result.data;
}

function normalize(tx) {
  return {
    id: tx._id,
    code: tx.itemCode,
    price: tx.money,
    ts: Date.parse(tx.createdAt),
    offerTs: tx.offerCreatedAt ? Date.parse(tx.offerCreatedAt) : null,
    skills: tx.item?.skills || {},
    state: tx.item?.state ?? null,
    maxState: tx.item?.maxState ?? null,
    sellerId: tx.sellerId,
    buyerId: tx.buyerId,
  };
}

/**
 * Fetches transactions for one item. Stops at the first already-known one
 * (poll) or when the page / age limit is hit (backfill).
 */
async function syncItem(code, { backfill }) {
  let cursor;
  let added = 0;
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
  const maxPages = backfill ? BACKFILL_MAX_PAGES : 3;

  for (let page = 0; page < maxPages; page++) {
    const input = { limit: 100, transactionType: 'itemMarket', itemCode: code };
    if (cursor) input.cursor = cursor;
    const data = await trpc('transaction.getPaginatedTransactions', input);
    await sleep(REQUEST_GAP_MS);
    let sawKnown = false;
    for (const raw of data.items) {
      const t = normalize(raw);
      if (store.has(t.id)) { sawKnown = true; continue; }
      store.set(t.id, t);
      added++;
    }
    const oldest = data.items.at(-1);
    const tooOld = oldest && Date.parse(oldest.createdAt) < cutoff;
    if (!data.nextCursor || tooOld || (!backfill && sawKnown)) break;
    cursor = data.nextCursor;
  }
  status.perItem[code] = { added, at: Date.now() };
  return added;
}

async function syncAll({ backfill = false } = {}) {
  if (status.syncing) return;
  status.syncing = true;
  try {
    let total = 0;
    for (const code of Object.keys(ITEMS)) {
      total += await syncItem(code, { backfill });
      if (backfill) console.log(`[backfill] ${code}: ${store.size} total`);
    }
    pruneOld();
    if (total) saveStoreSoon();
    status.lastSync = Date.now();
    status.lastError = null;
    console.log(`[sync] +${total} transactions (total ${store.size})`);
  } catch (err) {
    status.lastError = err.message;
    console.error('[sync] error:', err.message);
  } finally {
    status.syncing = false;
  }
}

// ---- HTTP ---------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/items') {
    const counts = {};
    for (const t of store.values()) counts[t.code] = (counts[t.code] || 0) + 1;
    return json(res, 200, { items: ITEMS, slots: SLOTS, rarities: RARITIES, counts, status });
  }

  if (url.pathname === '/api/transactions') {
    const code = url.searchParams.get('code');
    if (!ITEMS[code]) return json(res, 400, { error: 'unknown item' });
    const list = [...store.values()].filter(t => t.code === code).sort((a, b) => b.ts - a.ts);
    return json(res, 200, { code, transactions: list, status });
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    syncAll();
    return json(res, 202, { ok: true });
  }

  // static
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(__dirname, 'public', file);
  if (!full.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
});

loadStore();
server.listen(PORT, () => {
  console.log(`WarEra market helper: http://localhost:${PORT}`);
  const cached = new Set([...store.values()].map(t => t.code));
  const backfill = Object.keys(ITEMS).some(c => !cached.has(c));
  syncAll({ backfill }).then(() => setInterval(syncAll, POLL_MS));
});

// ---- helpers ------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadDotEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
}
