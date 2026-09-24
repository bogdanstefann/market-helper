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

// ---- API keys -----------------------------------------------------------
// Every visitor brings their own WarEra API key (validated once, kept only in
// memory, never written to disk). The poller rotates through the keys of the
// people who opened the page; WARERA_API_KEY in .env is an optional extra seed.
/** @type {Map<string, { addedAt: number, lastUsed: number, failures: number }>} */
const keyPool = new Map();
if (API_KEY) keyPool.set(API_KEY, { addedAt: Date.now(), lastUsed: 0, failures: 0 });
let keyCursor = 0;

function pickKey() {
  const keys = [...keyPool.keys()];
  if (!keys.length) return null;
  keyCursor = (keyCursor + 1) % keys.length;
  return keys[keyCursor];
}

const isValidKeyShape = k => typeof k === 'string' && /^wae_[a-f0-9]{32,}$/i.test(k);

/** Checks a key against an endpoint that needs a token; true when the API accepts it. */
async function validateKey(key) {
  const url = `${API_BASE}/transaction.getPaginatedTransactions?input=${encodeURIComponent(JSON.stringify({ limit: 1, transactionType: 'itemMarket', itemCode: 'jet' }))}`;
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`WarEra API answered HTTP ${res.status}`);
  return true;
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
/** @type {Map<string, any>} battle id -> battle */
const battles = new Map();
const BATTLES_FILE = path.join(__dirname, 'data', 'battles.json');
let battlesBackfilled = false;
const status = { lastSync: null, lastError: null, syncing: false, perItem: {}, battles: { count: 0, lastSync: null, lastError: null } };

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const t of raw) store.set(t.id, t);
    console.log(`Loaded ${store.size} transactions from cache.`);
  } catch { /* no cache yet */ }
  try {
    const raw = JSON.parse(fs.readFileSync(BATTLES_FILE, 'utf8'));
    for (const b of raw) battles.set(b.id, b);
    battlesBackfilled = battles.size > 0;
    console.log(`Loaded ${battles.size} battles from cache.`);
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
  for (const [id, b] of battles) if (b.end && b.end < cutoff) battles.delete(id);
}

function saveBattles() {
  fs.mkdirSync(path.dirname(BATTLES_FILE), { recursive: true });
  fs.writeFileSync(BATTLES_FILE, JSON.stringify([...battles.values()]));
}

// ---- WarEra API ---------------------------------------------------------
async function trpc(proc, input) {
  const key = pickKey();
  if (!key) throw new Error('No API key available: open the page and enter yours');
  const url = `${API_BASE}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    keyPool.delete(key); // revoked key: drop it and let the next call use another one
    throw new Error(`${proc}: an API key was rejected and removed from the pool`);
  }
  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`;
    throw new Error(`${proc}: ${msg}`);
  }
  const entry = keyPool.get(key);
  if (entry) entry.lastUsed = Date.now();
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

function normalizeBattle(b) {
  // damage per round (attacker + defender): finished rounds from roundsHistory, plus the live round
  const rounds = (b.roundsHistory || [])
    .filter(r => r && typeof r === 'object')
    .map(r => (r.attackerDamages || 0) + (r.defenderDamages || 0));
  const cr = b.currentRound;
  if (cr && typeof cr === 'object' && cr.attacker && (!cr.endedAt || rounds.length < (cr.number || 0))) {
    rounds.push((cr.attacker.damages || 0) + (cr.defender?.damages || 0));
  }
  return {
    id: b._id,
    start: Date.parse(b.createdAt),
    end: b.endedAt ? Date.parse(b.endedAt) : null,
    active: !!b.isActive,
    big: !!b.isBigBattle,
    rounds,
    maxRound: rounds.length ? Math.max(...rounds) : 0,
    type: b.type,
    attacker: b.attacker?.country ?? null,
    defender: b.defender?.country ?? null,
    damages: (b.attacker?.damages || 0) + (b.defender?.damages || 0),
    wonBy: b.wonBy ?? null,
  };
}

/**
 * Battles: active ones every poll (their damage totals move), plus the most
 * recently ended ones so an active battle gets its end time. Backfill walks the
 * ended list back to BACKFILL_DAYS.
 */
async function syncBattles({ backfill }) {
  try {
    const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
    const seenActive = new Set();
    let cursor;
    for (let page = 0; page < 3; page++) {
      const input = { limit: 100, isActive: true };
      if (cursor) input.cursor = cursor;
      const data = await trpc('battle.getBattles', input);
      await sleep(REQUEST_GAP_MS);
      for (const raw of data.items) { const b = normalizeBattle(raw); battles.set(b.id, b); seenActive.add(b.id); }
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
    }
    cursor = undefined;
    const maxPages = backfill ? 12 : 1;
    for (let page = 0; page < maxPages; page++) {
      const input = { limit: 100, isActive: false };
      if (cursor) input.cursor = cursor;
      const data = await trpc('battle.getBattles', input);
      await sleep(REQUEST_GAP_MS);
      let sawKnownEnded = false;
      for (const raw of data.items) {
        const b = normalizeBattle(raw);
        const prev = battles.get(b.id);
        if (prev && prev.end) sawKnownEnded = true;
        battles.set(b.id, b);
      }
      const oldest = data.items.at(-1);
      if (!data.nextCursor || (oldest && Date.parse(oldest.createdAt) < cutoff) || (!backfill && sawKnownEnded)) break;
      cursor = data.nextCursor;
    }
    // anything we thought active but no longer listed as active and not refreshed as ended: mark stale-ended
    for (const b of battles.values()) if (b.active && !seenActive.has(b.id) && !b.end) { b.active = false; b.end = Date.now(); }
    status.battles = { count: battles.size, lastSync: Date.now(), lastError: null };
    saveBattles();
  } catch (err) {
    status.battles.lastError = err.message;
    console.error('[battles] error:', err.message);
  }
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
    await syncBattles({ backfill: !battlesBackfilled });
    battlesBackfilled = true;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 4096) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Register / validate a visitor's key. Never logged, never persisted.
  if (url.pathname === '/api/key' && req.method === 'POST') {
    let key;
    try { key = JSON.parse(await readBody(req)).key?.trim(); } catch { return json(res, 400, { ok: false, error: 'Invalid request' }); }
    if (!isValidKeyShape(key)) return json(res, 400, { ok: false, error: 'That does not look like a WarEra API key (expected wae_…)' });
    if (keyPool.has(key)) return json(res, 200, { ok: true });
    try {
      if (!(await validateKey(key))) return json(res, 401, { ok: false, error: 'WarEra rejected this API key' });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message });
    }
    keyPool.set(key, { addedAt: Date.now(), lastUsed: 0, failures: 0 });
    console.log(`[keys] new key registered (${keyPool.size} in pool)`);
    status.lastError = null;
    if (!status.syncing) syncAll();
    return json(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/')) {
    const key = req.headers['x-api-key'];
    if (!key || !keyPool.has(key)) return json(res, 401, { error: 'API key required' });
  }

  if (url.pathname === '/api/items') {
    const counts = {};
    for (const t of store.values()) counts[t.code] = (counts[t.code] || 0) + 1;
    return json(res, 200, { items: ITEMS, slots: SLOTS, rarities: RARITIES, counts, status: { ...status, keys: keyPool.size } });
  }

  if (url.pathname === '/api/transactions') {
    const code = url.searchParams.get('code');
    if (!ITEMS[code]) return json(res, 400, { error: 'unknown item' });
    const list = [...store.values()].filter(t => t.code === code).sort((a, b) => b.ts - a.ts);
    return json(res, 200, { code, transactions: list, status });
  }

  if (url.pathname === '/api/battles') {
    return json(res, 200, { battles: [...battles.values()].sort((a, b) => b.start - a.start), status: status.battles });
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
