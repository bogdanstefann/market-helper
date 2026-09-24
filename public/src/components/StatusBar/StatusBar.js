/*
 * The single sync status strip above the tiles. Always rendered with the same
 * layout so the page does not jump; only icon, text and bar change.
 */
import { $, fmtDate } from '../../lib/format.js';

const fmtTime = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function render(sync) {
  const strip = $('#syncStrip'), text = $('#syncText'), meta = $('#syncMeta'), fill = $('#syncFill');
  const h = sync.history;
  fill.classList.remove('indeterminate');

  if (sync.lastError) {
    strip.dataset.state = 'error';
    text.textContent = `Sync error: ${sync.lastError}`;
    meta.textContent = 'retrying in a minute';
    fill.style.width = '100%';
    return;
  }

  if (sync.firstLoad) { // no sales cached yet for this item
    strip.dataset.state = 'busy';
    text.innerHTML = `Loading recent sales${sync.page ? `: <b>page ${sync.page} of ${sync.pages}</b>` : '…'}`;
    meta.textContent = '';
    fill.classList.add('indeterminate');
    return;
  }

  if (h && !h.complete) { // older sales still being fetched
    const covered = Math.min(h.days, Math.max(0, (Date.now() - h.oldest) / 86_400_000));
    const pct = Math.round(100 * covered / h.days);
    strip.dataset.state = 'busy';
    text.innerHTML = `Loading older sales: <b>${covered.toFixed(1)} of ${h.days} days</b> covered, back to <b>${fmtDate(h.oldest)}</b> · ${h.count} sales so far`;
    meta.textContent = `${pct}%`;
    fill.style.width = `${pct}%`;
    return;
  }

  // complete history: idle, or a quiet check for new sales
  strip.dataset.state = sync.running ? 'checking' : 'idle';
  text.innerHTML = h ? `Full <b>${h.days}-day</b> history · <b>${h.count}</b> sales cached in this browser` : 'Ready';
  meta.textContent = sync.running ? 'checking for new sales…' : sync.lastSync ? `updated ${fmtTime(sync.lastSync)} · checks every minute` : '';
  fill.style.width = '100%';
}
