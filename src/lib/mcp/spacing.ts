/** Spacing-scale checks for the agent (MCP check_spacing_scale). */

export interface Scale {
  /** Multiples of this many px are on the scale (default 4). */
  base?: number;
  /** Or an explicit list of allowed px values (design tokens). */
  values?: number[];
}

/** `12px` → 12; anything else (auto, normal, %, calc) → null. */
export function px(v: string): number | null {
  const m = /^(-?\d*\.?\d+)px$/.exec(v.trim());
  return m ? parseFloat(m[1]!) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The closest value of the scale to `v` (by absolute size; a negative margin is judged by its size). */
export function nearestOnScale(v: number, scale: Scale): number {
  const a = Math.abs(v);
  if (scale.values?.length)
    return scale.values.reduce((best, c) => (Math.abs(c - a) < Math.abs(best - a) ? c : best));
  const base = scale.base ?? 4;
  return round2(Math.round(a / base) * base);
}

export function onScale(v: number, scale: Scale, tolerance: number): boolean {
  return Math.abs(Math.abs(v) - nearestOnScale(v, scale)) <= tolerance;
}

export interface Offender {
  value: number;
  count: number;
  nearest: number;
  properties: string[];
}

/** Group off-scale readings by value, most used first. */
export function groupOffenders(
  readings: { value: number; property: string }[],
  scale: Scale,
  tolerance: number,
): Offender[] {
  const by = new Map<number, Offender>();
  for (const { value, property } of readings) {
    if (onScale(value, scale, tolerance)) continue;
    const v = round2(value);
    const o = by.get(v) ?? {
      value: v,
      count: 0,
      nearest: nearestOnScale(v, scale),
      properties: [],
    };
    o.count++;
    if (!o.properties.includes(property)) o.properties.push(property);
    by.set(v, o);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.value - b.value);
}
