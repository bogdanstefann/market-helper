/*
 * API key overlay. The key lives only in this browser's localStorage; the page
 * validates it against WarEra before accepting it.
 */
import { $ } from '../../lib/format.js';
import { validateKey, isValidKeyShape } from '../../services/api.js';

const KEY_STORAGE = 'warera_api_key';
export const getKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
export const clearKey = () => { try { localStorage.removeItem(KEY_STORAGE); } catch {} };
const setKey = k => { try { localStorage.setItem(KEY_STORAGE, k); } catch {} };

let pending = null; // { promise, resolve } while the overlay is open

/** Opens the overlay and resolves with the key once a valid one is saved. */
export function askForKey(message = '') {
  const overlay = $('#keyOverlay'), err = $('#keyError'), input = $('#keyInput');
  err.textContent = message; err.hidden = !message;
  input.value = '';
  overlay.hidden = false;
  input.focus();
  if (!pending) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    pending = { promise, resolve };
  }
  return pending.promise;
}

/** The saved key, or the one the visitor enters now. */
export const requireKey = () => getKey() || askForKey();

export function init() {
  $('#keyForm').onsubmit = async e => {
    e.preventDefault();
    const key = $('#keyInput').value.trim();
    const btn = $('#keySave'), err = $('#keyError');
    const fail = msg => { err.textContent = msg; err.hidden = false; btn.disabled = false; };
    if (!isValidKeyShape(key)) return fail('That does not look like a WarEra API key (expected wae_…)');
    btn.disabled = true; err.hidden = true;
    let ok;
    try { ok = await validateKey(key); } catch (ex) { return fail(`Could not reach the WarEra API: ${ex.message}`); }
    if (!ok) return fail('WarEra rejected this API key');
    btn.disabled = false;
    setKey(key);
    $('#keyOverlay').hidden = true;
    const p = pending; pending = null;
    p?.resolve(key);
  };
  $('#keyShow').onchange = e => { $('#keyInput').type = e.target.checked ? 'text' : 'password'; };
  $('#changeKey').onclick = () => askForKey();
}
