/* Small formatting and colour helpers shared by the components. */
export const $ = s => document.querySelector(s);
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const pad = n => String(n).padStart(2, '0');

export const STAT_LABELS = {
  attack: 'Attack', criticalChance: 'Critical chance', criticalDamages: 'Critical damages',
  armor: 'Armor', precision: 'Precision', dodge: 'Dodge',
};
export const statLabel = k => STAT_LABELS[k] || k;

export const fmtMoney = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 3 : 2 });
export const fmtDate = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtPct = r => r == null ? '–' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`;
export const fmtM = n => `${(n / 1e6).toFixed(1)} M`;

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

