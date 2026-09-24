/* The "Updated … / loading …" line in the header. */
import { $, fmtDate } from '../../lib/format.js';

export function render(sync) {
  renderBanner(sync);
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
    const cadence = h && !h.complete ? 'catching up every few seconds' : 'refreshes every 60s';
    el.textContent = `Updated ${fmtDate(sync.lastSync)} · ${cadence}${hist}`;
  }
  else el.textContent = 'Loading…';
}

/** Progress banner above the tiles while older sales are still being fetched. */
function renderBanner(sync) {
  const h = sync.history;
  const banner = $('#historyBanner');
  if (!h || h.complete) { banner.hidden = true; return; }
  const covered = Math.min(h.days, Math.max(0, (Date.now() - h.oldest) / 86_400_000));
  const pct = Math.round(100 * covered / h.days);
  banner.hidden = false;
  $('#historyText').innerHTML = `Loading older sales: <b>${covered.toFixed(1)} of ${h.days} days</b> covered, back to <b>${fmtDate(h.oldest)}</b> (${h.count} sales so far)`;
  $('#historyPct').textContent = `${pct}%`;
  $('#historyFill').style.width = `${pct}%`;
}
