/* Slot (Weapon, Helmet, …) and rarity buttons. */
import { SLOTS, RARITIES } from '../../config/items.js';
import { state, codeFor } from '../../store/state.js';
import { $, cap } from '../../lib/format.js';

let onSelect = () => {};
export function init(handlers) { onSelect = handlers.onSelect; }

export function render() {
  const slots = $('#slots');
  slots.innerHTML = '';
  for (const [slot, def] of Object.entries(SLOTS)) {
    const b = document.createElement('button');
    b.className = 'item-btn' + (slot === state.slot ? ' active' : '');
    b.style.setProperty('--r', `var(--r-${state.rarity})`);
    b.innerHTML = `<span class="tag"></span>${def.label}`;
    b.onclick = () => onSelect(slot, state.rarity);
    slots.appendChild(b);
  }
  const rar = $('#rarities');
  rar.innerHTML = '';
  for (const r of RARITIES) {
    const b = document.createElement('button');
    b.className = `item-btn ${r}` + (r === state.rarity ? ' active' : '');
    b.innerHTML = `<span class="tag"></span>${cap(r)} <span class="count">${state.counts[codeFor(state.slot, r)] || 0}</span>`;
    b.onclick = () => onSelect(state.slot, r);
    rar.appendChild(b);
  }
}
