/* The "Updated … / loading …" line in the header. */
import { $, fmtDate } from '../../lib/format.js';

export function render(sync) {
  const el = $('#status');
  if (sync.lastError) { el.textContent = `Sync error: ${sync.lastError}`; el.className = 'status err'; return; }
  el.className = 'status';
  if (sync.note) el.textContent = sync.note;
  else if (sync.running) el.textContent = 'Checking for new sales…';
  else if (sync.lastSync) el.textContent = `Updated ${fmtDate(sync.lastSync)} · refreshes every 60s · cached in this browser`;
  else el.textContent = 'Loading…';
}
