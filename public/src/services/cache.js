/* Minimal IndexedDB key/value store; every function fails soft (private mode, quota). */
const DB_NAME = 'warera-market-helper', STORE = 'cache';
let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
export async function dbGet(key) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  } catch { return undefined; }
}
export async function dbSet(key, value) {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch { /* private mode or quota: keep going without persistence */ }
}
export async function dbKeys() {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).getAllKeys();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  } catch { return []; }
}

