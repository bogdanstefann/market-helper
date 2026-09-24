/* Battles and countries: fetch from WarEra, cache in IndexedDB. */
import { trpc, sleep, REQUEST_GAP_MS } from './api.js';
import { dbGet, dbSet } from './cache.js';

const BACKFILL_DAYS = 14;
const MAX_AGE_DAYS = 30;

function normalizeBattle(b) {
  const rounds = (b.roundsHistory || []).filter(r => r && typeof r === 'object')
    .map(r => (r.attackerDamages || 0) + (r.defenderDamages || 0));
  const cr = b.currentRound;
  if (cr && typeof cr === 'object' && cr.attacker && (!cr.endedAt || rounds.length < (cr.number || 0))) {
    rounds.push((cr.attacker.damages || 0) + (cr.defender?.damages || 0));
  }
  return {
    id: b._id, start: Date.parse(b.createdAt), end: b.endedAt ? Date.parse(b.endedAt) : null,
    active: !!b.isActive, big: !!b.isBigBattle, rounds, maxRound: rounds.length ? Math.max(...rounds) : 0,
    type: b.type, attacker: b.attacker?.country ?? null, defender: b.defender?.country ?? null,
    damages: (b.attacker?.damages || 0) + (b.defender?.damages || 0), wonBy: b.wonBy ?? null,
  };
}

let battleMem = null; // { map: Map<id, battle>, updatedAt }
async function loadBattleCache() {
  if (battleMem) return battleMem;
  const saved = await dbGet('battles');
  battleMem = { map: new Map(), updatedAt: saved?.updatedAt || 0 };
  for (const b of saved?.battles || []) battleMem.map.set(b.id, b);
  return battleMem;
}

export async function getBattles() {
  const m = await loadBattleCache();
  return [...m.map.values()].sort((a, b) => b.start - a.start);
}

/** Active battles every time, plus recently ended ones; first time walks back BACKFILL_DAYS. */
export async function syncBattles(key, onProgress) {
  const m = await loadBattleCache();
  const backfill = m.map.size === 0;
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
  const seenActive = new Set();
  let cursor;
  for (let page = 0; page < 3; page++) {
    const input = { limit: 100, isActive: true };
    if (cursor) input.cursor = cursor;
    const data = await trpc('battle.getBattles', input, key);
    for (const raw of data.items) { const b = normalizeBattle(raw); m.map.set(b.id, b); seenActive.add(b.id); }
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
    await sleep(REQUEST_GAP_MS);
  }
  cursor = undefined;
  const maxPages = backfill ? 12 : 1;
  for (let page = 0; page < maxPages; page++) {
    const input = { limit: 100, isActive: false };
    if (cursor) input.cursor = cursor;
    await sleep(REQUEST_GAP_MS);
    const data = await trpc('battle.getBattles', input, key);
    let sawKnownEnded = false;
    for (const raw of data.items) {
      const b = normalizeBattle(raw);
      const prev = m.map.get(b.id);
      if (prev && prev.end) sawKnownEnded = true;
      m.map.set(b.id, b);
    }
    onProgress?.({ page: page + 1, maxPages });
    const oldest = data.items.at(-1);
    if (!data.nextCursor || (oldest && Date.parse(oldest.createdAt) < cutoff) || (!backfill && sawKnownEnded)) break;
    cursor = data.nextCursor;
  }
  for (const b of m.map.values()) if (b.active && !seenActive.has(b.id) && !b.end) { b.active = false; b.end = Date.now(); }
  const prune = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const [id, b] of m.map) if (b.end && b.end < prune) m.map.delete(id);
  m.updatedAt = Date.now();
  await dbSet('battles', { battles: [...m.map.values()], updatedAt: m.updatedAt });
  return m.map.size;
}

// ---- countries ----
export async function getCountries() {
  const saved = await dbGet('countries');
  if (saved && Date.now() - saved.updatedAt < 86_400_000) return saved.map;
  try {
    const data = await trpc('country.getAllCountries', {}, null);
    const map = {};
    for (const c of data) map[c._id] = { name: c.name, code: c.code };
    await dbSet('countries', { map, updatedAt: Date.now() });
    return map;
  } catch {
    return saved?.map || {};
  }
}
