// Buildings on unleveled ground (countryside lots: the sim only levels lots
// on the city's grid). Their lot ground is laid on the terrain by the field
// renderer; the building itself is bent to meet it: every vertex moves up or
// down by how far the drawn ground under it lies from the building's ground,
// fully at ground level, fading out over the first storey. So paths, yard
// bits and parked cars sit on the slope, walls and plinths reach down to the
// ground on the low side (or start at it on the high side), and the roof
// stays level. It's one smooth field applied to every part alike, so
// surfaces that were apart stay apart (no new z-fighting).

/** Height (local) up to which a building follows the ground; above it nothing moves. */
const FADE = 4;
/** Ground-level parts end up this much above the drawn ground (the lot ground is laid at +0.05, their own bits sit 0.05 up). */
const LIFT = 0.05;
const CELL = 4;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** How much of the ground's offset a point at local height `y` follows (1 at the ground, 0 from FADE up). */
export function settleWeight(y: number): number {
  return 1 - smooth((y - 0.12) / (FADE - 0.12));
}
export const SETTLE_LIFT = LIFT;

export class Settle {
  private readonly n: number;
  private readonly r: number;
  private readonly d: Float32Array;
  private readonly cs: number;
  private readonly sn: number;

  /**
   * The building at (bx, by), facing `angle`, with its ground at `ground`; `terrain` gives the drawn
   * ground's height at a world point; `reach` = how far from the building parts may lie (m).
   */
  constructor(private readonly bx: number, private readonly by: number, angle: number, private readonly ground: number, private readonly terrain: (x: number, y: number) => number, reach: number) {
    const rot = Math.PI / 2 - angle;
    this.cs = Math.cos(rot);
    this.sn = Math.sin(rot);
    this.r = Math.min(90, Math.ceil(reach / CELL) * CELL);
    const n = (this.n = (2 * this.r) / CELL + 1);
    this.d = new Float32Array(n * n);
    // the ground's offset on a grid over the building's surroundings (the drawn ground is linear over ~20 m triangles)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = -this.r + i * CELL, lz = -this.r + j * CELL;
        const wx = bx + lx * this.cs + lz * this.sn, wz = by - lx * this.sn + lz * this.cs;
        this.d[j * n + i] = terrain(wx, wz) - ground + LIFT;
      }
    }
  }

  /** Vertical offset for a local point (x, y, z). */
  dy(x: number, y: number, z: number): number {
    const w = settleWeight(y);
    if (w <= 0) return 0;
    const n = this.n;
    const fx = Math.min(n - 1.001, Math.max(0, (x + this.r) / CELL)), fz = Math.min(n - 1.001, Math.max(0, (z + this.r) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const d = this.d;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    return w * ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v);
  }

  /**
   * Bend positions given in the building's local frame (x, y, z triples), in place. The ground's offset is
   * looked up exactly at each vertex (shared corners once), so small things lie on the drawn ground itself.
   */
  apply(p: Float32Array): void {
    const memo = this.memo;
    for (let k = 0; k < p.length; k += 3) {
      const y = p[k + 1];
      const w = settleWeight(y);
      if (w <= 0) continue;
      const x = p[k], z = p[k + 2];
      const key = Math.round(x * 100) * 100003 + Math.round(z * 100);
      let d = memo.get(key);
      if (d === undefined) {
        d = this.terrain(this.bx + x * this.cs + z * this.sn, this.by - x * this.sn + z * this.cs) - this.ground + LIFT;
        memo.set(key, d);
      }
      p[k + 1] = y + w * d;
    }
  }

  private readonly memo = new Map<number, number>();

  /** Bend world-space positions (the building's ground at `ground`), in place. */
  applyWorld(p: Float32Array, ground: number): void {
    for (let k = 0; k < p.length; k += 3) {
      const y = p[k + 1] - ground;
      if (y >= FADE) continue;
      const dx = p[k] - this.bx, dz = p[k + 2] - this.by;
      // (world -> local: the inverse of the building's yaw)
      const lx = dx * this.cs - dz * this.sn, lz = dx * this.sn + dz * this.cs;
      p[k + 1] += this.dy(lx, y, lz);
    }
  }

  /** Offset for a world point at local height `y` (props, people). */
  dyWorld(wx: number, y: number, wz: number): number {
    const dx = wx - this.bx, dz = wz - this.by;
    return this.dy(dx * this.cs - dz * this.sn, y, dx * this.sn + dz * this.cs);
  }
}
