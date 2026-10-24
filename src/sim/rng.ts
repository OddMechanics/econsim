// Seeded, serializable random number generator (sfc32). The four-number state
// lives inside SimState so a saved world continues with the exact same
// sequence of random events.

export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  const s: RngState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  for (let i = 0; i < 15; i++) nextFloat(s);
  return s;
}

export function nextFloat(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return (t >>> 0) / 4294967296;
}

export class Rng {
  constructor(public s: RngState) {}
  next(): number { return nextFloat(this.s); }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  int(lo: number, hiExclusive: number): number { return Math.floor(this.range(lo, hiExclusive)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Roughly normal (sum of three uniforms), clamped to [0, 1]. */
  trait(mean = 0.5, spread = 0.22): number {
    const n = (this.next() + this.next() + this.next() - 1.5) / 1.5; // ~[-1, 1]
    return Math.min(1, Math.max(0, mean + n * spread * 1.8));
  }
}

/** Stateless hash for deterministic per-object detail (e.g. visuals). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
