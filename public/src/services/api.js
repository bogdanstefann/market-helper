/* Calls to the WarEra tRPC API, made straight from the browser (CORS is open). */
const API_BASE = 'https://api2.warera.io/trpc';
export const REQUEST_GAP_MS = 120;      // pause between calls (limit is 500/min per key)
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ApiKeyError extends Error {}

export async function trpc(proc, input, key) {
  const url = `${API_BASE}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: key ? { 'x-api-key': key } : {} });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new ApiKeyError(body.error?.message || 'WarEra rejected the API key');
  if (!res.ok || body.error) throw new Error(`${proc}: ${body.error?.message || `HTTP ${res.status}`}`);
  return body.result.data;
}

export const isValidKeyShape = k => typeof k === 'string' && /^wae_[a-f0-9]{32,}$/i.test(k);

/** Resolves true when WarEra accepts the key, false when it rejects it; throws on network trouble. */
export async function validateKey(key) {
  try {
    await trpc('transaction.getPaginatedTransactions', { limit: 1, transactionType: 'itemMarket', itemCode: 'jet' }, key);
    return true;
  } catch (err) {
    if (err instanceof ApiKeyError) return false;
    throw err;
  }
}

