const counts = new Map();

/** Record a user-timing measure. The browser's buffer has no limit, so empty it after 100 entries.
 * @param {{name:string,start:number}} options */
export function recordMeasure({ name, start }) {
  performance.measure(name, { start, end: performance.now() });
  const count = (counts.get(name) || 0) + 1;
  if (count > 100) performance.clearMeasures(name);
  counts.set(name, count > 100 ? 0 : count);
}
