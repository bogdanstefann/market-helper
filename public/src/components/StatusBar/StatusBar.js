/* The "Updated … / loading …" line in the header. */
import { $, fmtDate } from '../../lib/format.js';

export function render(sync) {
  const el = $('#status');
  if (sync.lastError) { el.textContent = `Sync error: ${sync.lastError}`; el.className = 'status err'; return; }
  el.className = 'status';
  if (sync.note) el.textContent = sync.note;
  else if (sync.running) el.textContent = 'Checking for new sales…';
  else if (sync.lastSync) {
    const h = sync.history;
    const hist = !h ? '' : h.complete
      ? ` · full ${h.days}-day history (${h.count} sales)`
      : ` · ${h.count} sales back to ${h.oldest ? fmtDate(h.oldest) : '…'}, still loading older ones`;
    el.textContent = `Updated ${fmtDate(sync.lastSync)} · refreshes every 60s${hist}`;
  }
  else el.textContent = 'Loading…';
}
