/* Colour helpers used by the charts, heatmap and battle symbols. */
export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
export function hexA(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const GREY = [107, 110, 106], RED = [230, 103, 103], BLUE = [57, 135, 229], SURFACE = [34, 38, 43], MID = [56, 56, 53];
/** grey -> red, k in 0..1 (battle load) */
export const loadColor = k => mix(GREY, RED, k);
/** sequential blue ramp (surface -> series blue), t in 0..1 */
export const seqColor = t => mix(SURFACE, BLUE, 0.15 + 0.85 * Math.min(1, Math.max(0, t)));
/** diverging blue (cheap) -> grey -> red (expensive), t in -1..1 */
export const divColor = t => mix(MID, t < 0 ? BLUE : RED, Math.min(1, Math.abs(t)));
