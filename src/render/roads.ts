// Roads: asphalt ribbons that follow the terrain, raised sidewalks with curbs
// (gravel shoulders on country roads), filled intersections with rounded curb
// corners, lane markings and crosswalks, streetlights that glow at night,
// street furniture, traffic lights at avenue crossings, and the lot-ownership
// overlay.
//
// Streets have to be built. A newly laid-out street (`built === false`) is a
// graded dirt track: compacted earth with wheel ruts and gravel edges, no
// curbs, sidewalks or lamps. While it's being paved, the first `progress` of
// its length (from end a) is fresh dark asphalt without markings; an active
// road crew shows up as a paver and a roller at the paving front, cones,
// barriers and road-works signs. Streets the government has scheduled for
// paving are staked out with survey stakes. Once paved, the street gets
// curbs, sidewalks, markings, lamps and furniture.
//
// Geometry is generated per 250 m chunk into a few merged meshes (asphalt and
// dirt, sidewalks, markings). On `sync` every junction is recomputed (cheap),
// each chunk gets a signature of everything its geometry depends on, and only
// chunks whose signature changed are rebuilt. Paving fronts are quantized to
// 2 m so a crew's progress rebuilds one chunk now and then. Lamps and
// furniture come from `src/sim/street.ts` (the simulation uses the same
// spots, e.g. for flyers on lamp poles) and are thin instances; small items
// are only instanced near the camera. Night glow is emissive heads plus
// additive light pools (no real lights).

import {
  Color3, Constants, DynamicTexture, FresnelParameters, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, VertexData,
} from '@babylonjs/core';
import type { Camera, Nullable, Observer } from '@babylonjs/core';
import { hash2 } from '../sim/rng';
import { roughRoad, shoulderOf, streetFurniture, streetLamps, type FurnitureKind, type FurnitureSpot, type LampSpot } from '../sim/street';
import type { Lot, RoadEdge, RoadNode, Roads, World } from '../sim/types';
import { heightAt } from '../sim/world';

const LIFT = 0.1; // asphalt above the terrain
const MARK = 0.135; // markings above the terrain
const CURB = 0.15; // sidewalk top above the asphalt
/** Surface heights above `heightAt` (for placing people and vehicles on roads). Dirt tracks are at about `dirt`. */
export const ROAD_SURFACE = { asphalt: LIFT, sidewalk: LIFT + CURB, dirt: LIFT } as const;
const FINE = 3.5; // terrain probe spacing along a road
const TOL = 0.025; // allowed deviation from the terrain between road vertices (m)
const MAX_RUN = 36; // longest unsubdivided road segment
const CHUNK = 250; // meters
const PAVE_STEP = 2; // paving fronts are drawn in steps of this many meters
const NEAR_SMALL = 300; // benches, bins, hydrants, shelters: instanced within this distance of the camera (m)
const NEAR_TREES = 750;
const SIGNAL_CYCLE = 26; // seconds for a full traffic-light cycle
const SURF_CELL = 32; // grid cell for surfaceAt (m)
const OFF_ROAD = 0.03; // people off the roads stand this high above heightAt
const REBUILD_BUDGET = 6; // ms per sync for re-building changed chunks (new chunks are always built)

type RGBA = [number, number, number, number];

// ------------------------------------------------------------- geometry buffer

class Geom {
  p = new Float32Array(3 * 2048);
  n = new Float32Array(3 * 2048);
  c = new Float32Array(4 * 2048);
  i = new Uint32Array(6 * 2048);
  nv = 0;
  ni = 0;

  reset(): this {
    this.nv = 0;
    this.ni = 0;
    return this;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: RGBA): number {
    if ((this.nv + 1) * 3 > this.p.length) {
      const grow = <T extends Float32Array>(a: T, k: number): T => { const b = new Float32Array(a.length * 2) as T; b.set(a.subarray(0, this.nv * k)); return b; };
      this.p = grow(this.p, 3); this.n = grow(this.n, 3); this.c = grow(this.c, 4);
    }
    const k = this.nv, p = this.p, n = this.n, c = this.c;
    p[k * 3] = x; p[k * 3 + 1] = y; p[k * 3 + 2] = z;
    n[k * 3] = nx; n[k * 3 + 1] = ny; n[k * 3 + 2] = nz;
    c[k * 4] = col[0]; c[k * 4 + 1] = col[1]; c[k * 4 + 2] = col[2]; c[k * 4 + 3] = col[3];
    return this.nv++;
  }

  private tri(a: number, b: number, c: number): void {
    if (this.ni + 3 > this.i.length) {
      const b2 = new Uint32Array(this.i.length * 2);
      b2.set(this.i.subarray(0, this.ni));
      this.i = b2;
    }
    this.i[this.ni++] = a; this.i[this.ni++] = b; this.i[this.ni++] = c;
  }

  /** A triangle facing up (front faces point +Y; winding fixed automatically). */
  up(a: number, b: number, c: number): void {
    const p = this.p;
    const area = (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]);
    if (Math.abs(area) < 1e-7) return;
    if (area > 0) this.tri(a, b, c); else this.tri(a, c, b);
  }

  /** A triangle whose front faces direction f. Babylon's face normal is (p1-p2) x (p3-p2). */
  face(a: number, b: number, c: number, fx: number, fy: number, fz: number): void {
    const p = this.p;
    const ux = p[a * 3] - p[b * 3], uy = p[a * 3 + 1] - p[b * 3 + 1], uz = p[a * 3 + 2] - p[b * 3 + 2];
    const vx = p[c * 3] - p[b * 3], vy = p[c * 3 + 1] - p[b * 3 + 1], vz = p[c * 3 + 2] - p[b * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const d = nx * fx + ny * fy + nz * fz;
    if (Math.abs(d) < 1e-9) return;
    if (d > 0) this.tri(a, b, c); else this.tri(a, c, b);
  }

  quadUp(a: number, b: number, c: number, d: number): void {
    this.up(a, b, c);
    this.up(a, c, d);
  }

  quadFace(a: number, b: number, c: number, d: number, fx: number, fy: number, fz: number): void {
    this.face(a, b, c, fx, fy, fz);
    this.face(a, c, d, fx, fy, fz);
  }

  vertexData(): VertexData {
    const vd = new VertexData();
    vd.positions = this.p.slice(0, this.nv * 3);
    vd.normals = this.n.slice(0, this.nv * 3);
    vd.colors = this.c.slice(0, this.nv * 4);
    vd.indices = this.i.slice(0, this.ni);
    return vd;
  }
}

/** Small props: boxes, cylinders, blobs and flat panels with vertex colors (local space, Y up). */
class Kit extends Geom {
  /** Box centered at (cx, cy, cz), rotated by rz about Z, then ry about Y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: RGBA, ry = 0, rz = 0): void {
    const cr = Math.cos(rz), sr = Math.sin(rz), cY = Math.cos(ry), sY = Math.sin(ry);
    const tf = (x: number, y: number, z: number): [number, number, number] => {
      const x1 = x * cr - y * sr, y1 = x * sr + y * cr;
      return [x1 * cY + z * sY, y1, -x1 * sY + z * cY];
    };
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // face normal and its two tangents
    const faces: [number[], number[], number[]][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
    ];
    for (const [f, t1, t2] of faces) {
      const [nx, ny, nz] = tf(f[0], f[1], f[2]);
      const idx: number[] = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [x, y, z] = tf((f[0] + t1[0] * a + t2[0] * b) * hx, (f[1] + t1[1] * a + t2[1] * b) * hy, (f[2] + t1[2] * a + t2[2] * b) * hz);
        idx.push(this.v(cx + x, cy + y, cz + z, nx, ny, nz, col));
      }
      this.quadFace(idx[0], idx[1], idx[2], idx[3], nx, ny, nz);
    }
  }

  /** Cylinder (or cone) from y = cy up by h along Y, or centered at cz along Z when axis = 'z'. */
  cyl(cx: number, cy: number, cz: number, r0: number, r1: number, h: number, n: number, col: RGBA, axis: 'y' | 'z' = 'y'): void {
    const P = (a: number, r: number, t: number): [number, number, number] => axis === 'y'
      ? [cx + Math.cos(a) * r, cy + t * h, cz + Math.sin(a) * r]
      : [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz - h / 2 + t * h];
    const N = (a: number): [number, number, number] => axis === 'y' ? [Math.cos(a), (r0 - r1) / h, Math.sin(a)] : [Math.cos(a), Math.sin(a), (r0 - r1) / h];
    const ring0: number[] = [], ring1: number[] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const [nx, ny, nz] = N(a);
      ring0.push(this.v(...P(a, r0, 0), nx, ny, nz, col));
      ring1.push(this.v(...P(a, r1, 1), nx, ny, nz, col));
    }
    for (let k = 0; k < n; k++) {
      const am = ((k + 0.5) / n) * Math.PI * 2;
      const [fx, fy, fz] = N(am);
      this.quadFace(ring0[k], ring0[k + 1], ring1[k + 1], ring1[k], fx, fy, fz);
    }
    for (const [r, t, s] of [[r0, 0, -1], [r1, 1, 1]] as const) {
      if (r < 0.005) continue;
      const nrm: [number, number, number] = axis === 'y' ? [0, s, 0] : [0, 0, s];
      const c = this.v(...P(0, 0, t), ...nrm, col);
      const ring: number[] = [];
      for (let k = 0; k <= n; k++) ring.push(this.v(...P((k / n) * Math.PI * 2, r, t), ...nrm, col));
      for (let k = 0; k < n; k++) this.face(c, ring[k], ring[k + 1], ...nrm);
    }
  }

  /** Low-poly ellipsoid. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: RGBA, seg = 7, rings = 5): void {
    const idx: number[][] = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      const row: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI * 2;
        const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
        row.push(this.v(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz, col));
      }
      idx.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let k = 0; k < seg; k++) {
        const phi = ((j + 0.5) / rings) * Math.PI, th = ((k + 0.5) / seg) * Math.PI * 2;
        const fx = Math.sin(phi) * Math.cos(th), fy = Math.cos(phi), fz = Math.sin(phi) * Math.sin(th);
        this.quadFace(idx[j][k], idx[j][k + 1], idx[j + 1][k + 1], idx[j + 1][k], fx, fy, fz);
      }
    }
  }

  /** Flat convex panel in the local Y/Z plane at x, `t` thick, outline [z, y] points (two-sided). */
  panel(x: number, t: number, pts: [number, number][], col: RGBA, back: RGBA = col): void {
    for (const s of [1, -1]) {
      const c = s === 1 ? col : back;
      const idx = pts.map(([z, y]) => this.v(x + (s * t) / 2, y, z, s, 0, 0, c));
      for (let k = 1; k + 1 < idx.length; k++) this.face(idx[0], idx[k], idx[k + 1], s, 0, 0);
    }
    for (let k = 0; k < pts.length; k++) {
      const [z0, y0] = pts[k], [z1, y1] = pts[(k + 1) % pts.length];
      const ez = z1 - z0, ey = y1 - y0, l = Math.hypot(ez, ey) || 1;
      const nz = ey / l, ny = -ez / l; // outward for counter-clockwise outlines; face() fixes winding anyway
      const a = this.v(x - t / 2, y0, z0, 0, ny, nz, back), b = this.v(x + t / 2, y0, z0, 0, ny, nz, back);
      const c = this.v(x + t / 2, y1, z1, 0, ny, nz, back), d = this.v(x - t / 2, y1, z1, 0, ny, nz, back);
      this.quadFace(a, b, c, d, 0, ny, nz);
    }
  }
}

// ------------------------------------------------------------------ helpers

let NX = 0, NY = 1, NZ = 0;
/** Height gradients at tile centers, per world (heights never change after generation). */
const gradCache = new WeakMap<World, Float32Array>();
function gradients(w: World): Float32Array {
  let g = gradCache.get(w);
  if (g) return g;
  const n = w.size, H = w.height;
  const h = (x: number, y: number) => Math.max(-1.5, H[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]);
  g = new Float32Array(n * n * 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g[(y * n + x) * 2] = (h(x + 1, y) - h(x - 1, y)) / (2 * w.tile);
      g[(y * n + x) * 2 + 1] = (h(x, y + 1) - h(x, y - 1)) / (2 * w.tile);
    }
  }
  gradCache.set(w, g);
  return g;
}

/** Smooth terrain normal at a point (into NX, NY, NZ); only for shading, positions use heightAt. */
function normalAt(w: World, x: number, y: number): void {
  const n = w.size, g = gradients(w);
  const fx = Math.min(n - 1.001, Math.max(0, x / w.tile - 0.5)), fy = Math.min(n - 1.001, Math.max(0, y / w.tile - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const i = (y0 * n + x0) * 2, j = i + n * 2;
  const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
  const gx = g[i] * w00 + g[i + 2] * w10 + g[j] * w01 + g[j + 2] * w11;
  const gz = g[i + 1] * w00 + g[i + 3] * w10 + g[j + 1] * w01 + g[j + 3] * w11;
  const l = Math.sqrt(gx * gx + 1 + gz * gz);
  NX = -gx / l; NY = 1 / l; NZ = -gz / l;
}

/** Smooth, cheap position-based variation in 0..1 (same at the same spot, so overlapping pieces match). */
function wobble(x: number, y: number): number {
  return 0.5 + 0.25 * (Math.sin(x * 0.071 + y * 0.033) + Math.sin(x * 0.029 - y * 0.063 + 1.7));
}

const COL = {
  asphalt: [0.27, 0.275, 0.29, 1] as RGBA,
  fresh: [0.15, 0.155, 0.165, 1] as RGBA, // just-laid asphalt
  country: [0.39, 0.375, 0.35, 1] as RGBA,
  dirt: [0.56, 0.47, 0.35, 1] as RGBA, // graded, compacted earth
  walk: [0.7, 0.68, 0.64, 1] as RGBA,
  curb: [0.8, 0.79, 0.75, 1] as RGBA,
  skirt: [0.56, 0.54, 0.5, 1] as RGBA,
  gravel: [0.52, 0.48, 0.4, 1] as RGBA,
  white: [0.9, 0.9, 0.86, 1] as RGBA,
  yellow: [0.88, 0.72, 0.28, 1] as RGBA,
};

const tmpC: RGBA = [0, 0, 0, 1];
function asphaltAt(x: number, y: number, country: boolean): RGBA {
  const base = country ? COL.country : COL.asphalt;
  const k = 0.92 + 0.14 * wobble(x, y);
  tmpC[0] = base[0] * k; tmpC[1] = base[1] * k; tmpC[2] = base[2] * k; tmpC[3] = 1;
  return tmpC;
}

function freshAt(x: number, y: number): RGBA {
  const k = 0.95 + 0.08 * wobble(x * 2.3, y * 2.3);
  tmpC[0] = COL.fresh[0] * k; tmpC[1] = COL.fresh[1] * k; tmpC[2] = COL.fresh[2] * k; tmpC[3] = 1;
  return tmpC;
}

/** Dirt: patchy compacted earth; `k` darkens (wheel ruts) or lightens (crown). */
function dirtAt(x: number, y: number, k = 1): RGBA {
  const m = k * (0.86 + 0.2 * wobble(x * 1.9, y * 1.9) + 0.06 * Math.sin(x * 0.9 + y * 1.3));
  const g = 0.5 + 0.5 * Math.sin(x * 0.23 - y * 0.19); // gravelly (grayer) patches
  tmpC[0] = (COL.dirt[0] - 0.04 * g) * m; tmpC[1] = (COL.dirt[1] - 0.01 * g) * m; tmpC[2] = (COL.dirt[2] + 0.03 * g) * m; tmpC[3] = 1;
  return tmpC;
}

function lerpCol(a: RGBA, b: RGBA, t: number, k = 1): RGBA {
  tmpC[0] = (a[0] + (b[0] - a[0]) * t) * k;
  tmpC[1] = (a[1] + (b[1] - a[1]) * t) * k;
  tmpC[2] = (a[2] + (b[2] - a[2]) * t) * k;
  tmpC[3] = 1;
  return tmpC;
}

/** Cross-section offsets of an asphalt ribbon (symmetric). */
function crossOffsets(e: RoadEdge): number[] {
  const h = e.width / 2;
  return e.kind === 'avenue' ? [-h, -h / 2, 0, h / 2, h] : [-h, 0, h];
}

/** Cross-section of a dirt track: offsets, color factors (ruts darker, crown lighter) and height offsets. */
interface DirtProfile { o: number[]; k: number[]; dh: number[] }
const dirtProfiles = new Map<number, DirtProfile>();
function dirtProfile(hw: number): DirtProfile {
  let p = dirtProfiles.get(hw);
  if (p) return p;
  const half: [number, number, number][] = [[-hw, 0.93, 0]];
  const lane = -hw / 2;
  for (const [o, k, dh] of [[lane - 1.25, 1.0, 0.012], [lane - 0.85, 0.8, -0.012], [lane - 0.45, 1.0, 0.014],
    [lane + 0.45, 1.01, 0.016], [lane + 0.85, 0.82, -0.008], [lane + 1.25, 1.03, 0.022]] as const) {
    if (o > -hw + 0.12 && o < -0.12) half.push([o, k, dh]);
  }
  const all = [...half, [0, 1.05, 0.032] as [number, number, number], ...half.slice().reverse().map(([o, k, dh]) => [-o, k, dh] as [number, number, number])];
  p = { o: all.map((v) => v[0]), k: all.map((v) => v[1]), dh: all.map((v) => v[2]) };
  dirtProfiles.set(hw, p);
  return p;
}

/** Paved length of an edge from end a, in PAVE_STEP steps (the full length when built). */
function paveLen(e: RoadEdge, len: number): number {
  if (e.built !== false) return len;
  const p = Math.min(1, Math.max(0, e.progress ?? 0));
  return Math.floor((p * len) / PAVE_STEP + 1e-6) * PAVE_STEP;
}

let probe = new Float32Array(256);

/**
 * Where to put cross-sections along an edge: the terrain is probed every few
 * meters on the centerline and both outer edges, and runs are merged while
 * straight lines stay within TOL of it (flat town land needs few vertices).
 */
function stations(w: World, ax: number, ay: number, ux: number, uy: number, len: number, half: number): number[] {
  const n = Math.max(1, Math.ceil(len / FINE));
  if (probe.length < (n + 1) * 3) probe = new Float32Array((n + 1) * 6);
  const nx = -uy, ny = ux;
  for (let k = 0; k <= n; k++) {
    const s = (len * k) / n;
    for (let l = 0; l < 3; l++) {
      const o = (l - 1) * half;
      probe[k * 3 + l] = heightAt(w, ax + ux * s + nx * o, ay + uy * s + ny * o);
    }
  }
  const fits = (i: number, j: number) => {
    for (let k = i + 1; k < j; k++) {
      const f = (k - i) / (j - i);
      for (let l = 0; l < 3; l++) {
        if (Math.abs(probe[k * 3 + l] - (probe[i * 3 + l] * (1 - f) + probe[j * 3 + l] * f)) > TOL) return false;
      }
    }
    return true;
  };
  const out = [0];
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && ((j + 1 - i) * len) / n <= MAX_RUN && fits(i, j + 1)) j++;
    out.push((len * j) / n);
    i = j;
  }
  return out;
}

/** The stations strictly inside (a, b), with a and b as the ends. */
function between(st: number[], a: number, b: number): number[] {
  const out = [a];
  for (const s of st) if (s > a + 0.6 && s < b - 0.6) out.push(s);
  out.push(b);
  return out;
}

// ---------------------------------------------------------------- junctions

/** One road leaving a node. Directions point away from the node. */
interface Arm {
  e: RoadEdge;
  atA: boolean;
  dx: number;
  dy: number;
  ang: number;
  hw: number;
  sw: number;
  raise: number;
  country: boolean; // country road (lighter asphalt)
  rough: boolean; // no curbs or sidewalks (country road or dirt track)
  here: boolean; // the road is paved where it meets this node
  tl: number; // where the asphalt's left edge leaves the junction area (distance from the node)
  tr: number; // ... right edge
  wl: number; // where the left sidewalk starts
  wr: number; // ... right sidewalk
  T: number; // where the arm's own asphalt ribbon starts
  acute: boolean; // merges with a neighbor at a very sharp angle (no crosswalk)
}

/** A point on the curb line; (ox, oy) points from the road toward the sidewalk. */
interface CurbPt { x: number; y: number; ox: number; oy: number; sw: number; raise: number }

interface Junction {
  node: RoadNode;
  arms: Arm[];
  corners: CurbPt[][]; // corners[k]: from arm k's left curb to arm k+1's right curb
}

function makeJunction(node: RoadNode, edgeById: Map<number, RoadEdge>, nodeById: Map<number, RoadNode>): Junction | null {
  const arms: Arm[] = [];
  for (const id of node.edges) {
    const e = edgeById.get(id);
    if (!e || e.a === e.b) continue;
    const o = nodeById.get(e.a === node.id ? e.b : e.a);
    if (!o) continue;
    const dx = o.x - node.x, dy = o.y - node.y, l = Math.hypot(dx, dy);
    if (l < 0.5) continue;
    const rough = roughRoad(e), atA = e.a === node.id;
    const pl = paveLen(e, e.len);
    arms.push({
      e, atA, dx: dx / l, dy: dy / l, ang: Math.atan2(dy, dx), hw: e.width / 2, sw: shoulderOf(e),
      raise: rough ? 0 : CURB, country: e.kind === 'country', rough,
      here: e.built !== false || (atA ? pl > 0 : pl >= e.len - 0.01),
      tl: 0, tr: 0, wl: 0, wr: 0, T: 0, acute: false,
    });
  }
  if (!arms.length) return null;
  arms.sort((a, b) => a.ang - b.ang);
  const m = arms.length;
  const px = node.x, py = node.y;
  const corners: CurbPt[][] = [];
  const STEP = Math.PI / 12;
  for (let k = 0; k < m; k++) {
    const A = arms[k], B = arms[(k + 1) % m];
    let alpha = m === 1 ? Math.PI * 2 : B.ang - A.ang;
    if (alpha <= 0) alpha += Math.PI * 2;
    const pts: CurbPt[] = [];
    let built = false;
    if (alpha < Math.PI - 0.02) {
      // the curbs converge: round the corner with a fillet tangent to both
      const nAx = -A.dy, nAy = A.dx, nBx = -B.dy, nBy = B.dx;
      const cr = A.dx * B.dy - A.dy * B.dx;
      const maxA = Math.min(A.e.len * 0.45, 45), maxB = Math.min(B.e.len * 0.45, 45);
      // (src/sim/street.ts mirrors these radii to keep lamps off the corners)
      const R0 = A.rough && B.rough ? 7 : A.rough || B.rough ? 5.5 : 4.5;
      const Rs = [R0, R0 * 0.6, Math.max(A.sw, B.sw) + 0.5];
      // where the line offset `oa` left of A meets the line offset `ob` right of B
      const meet = (oa: number, ob: number): [number, number] => {
        const Dx = -nBx * ob - nAx * oa, Dy = -nBy * ob - nAy * oa;
        return [(Dx * B.dy - Dy * B.dx) / cr, (Dx * A.dy - Dy * A.dx) / cr];
      };
      for (let r = 0; r < Rs.length && !built; r++) {
        const R = Rs[r];
        const [t, s] = meet(A.hw + R, B.hw + R);
        if (!(t >= 0 && s >= 0)) break; // odd widths at a shallow bend: fall back to the open case
        if (t > maxA || s > maxB) continue;
        const Ox = px + nAx * (A.hw + R) + A.dx * t, Oy = py + nAy * (A.hw + R) + A.dy * t;
        const x1 = px + nAx * A.hw + A.dx * t, y1 = py + nAy * A.hw + A.dy * t;
        const x2 = px - nBx * B.hw + B.dx * s, y2 = py - nBy * B.hw + B.dy * s;
        const f1 = Math.atan2(y1 - Oy, x1 - Ox);
        let delta = Math.atan2(y2 - Oy, x2 - Ox) - f1;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta <= -Math.PI) delta += Math.PI * 2;
        const ns = Math.max(2, Math.ceil(Math.abs(delta) / STEP));
        for (let j = 0; j <= ns; j++) {
          const f = j / ns, phi = f1 + delta * f;
          const c = Math.cos(phi), sn = Math.sin(phi);
          pts.push({ x: Ox + R * c, y: Oy + R * sn, ox: -c, oy: -sn, sw: A.sw + (B.sw - A.sw) * f, raise: A.raise + (B.raise - A.raise) * f });
        }
        A.tl = Math.max(A.tl, t); A.wl = Math.max(A.wl, t);
        B.tr = Math.max(B.tr, s); B.wr = Math.max(B.wr, s);
        built = true;
      }
      if (!built) {
        const [tc, sc] = meet(A.hw, B.hw);
        if (tc >= 0 && sc >= 0) {
          built = true;
          if (tc <= maxA && sc <= maxB) {
            // sharp but short: a plain corner where the curbs meet
            pts.push({ x: px + nAx * A.hw + A.dx * tc, y: py + nAy * A.hw + A.dy * tc, ox: 0, oy: 0, sw: 0, raise: 0 });
            A.tl = Math.max(A.tl, tc); A.wl = Math.max(A.wl, tc);
            B.tr = Math.max(B.tr, sc); B.wr = Math.max(B.wr, sc);
          } else {
            // roads merging at a very sharp angle: the asphalt simply overlaps
            // and the inner sidewalks begin where the roads have separated
            const [tg, sg] = meet(A.hw + A.sw, B.hw + B.sw);
            A.wl = Math.max(A.wl, tg); B.wr = Math.max(B.wr, sg);
            A.acute = B.acute = true;
          }
        }
      }
    }
    if (!built) {
      // the curbs diverge (outside of a bend, a T's straight side, a dead end): arc around the node
      const a1 = A.ang + Math.PI / 2;
      const sweep = m === 1 ? Math.PI : Math.max(0, alpha - Math.PI);
      const ns = Math.max(1, Math.ceil(sweep / STEP));
      for (let j = 0; j <= ns; j++) {
        const f = j / ns, phi = a1 + sweep * f;
        const c = Math.cos(phi), sn = Math.sin(phi);
        const r = A.hw + (B.hw - A.hw) * f;
        pts.push({ x: px + r * c, y: py + r * sn, ox: c, oy: sn, sw: A.sw + (B.sw - A.sw) * f, raise: A.raise + (B.raise - A.raise) * f });
      }
    }
    corners.push(pts);
  }
  for (const a of arms) a.T = Math.max(a.tl, a.tr);
  return { node, arms, corners };
}

// ------------------------------------------------------------ mesh builders

interface Geoms { road: Geom; walk: Geom; mark: Geom }

/**
 * A sidewalk (or shoulder) band along a curb line: curb face, top, outer
 * skirt. Without a curb (raise 0) it's a gravel shoulder sloping down to
 * the ground.
 */
function band(g: Geom, w: World, pts: CurbPt[]): void {
  if (pts.length < 2) return;
  let prev = -1, prevHasCurb = false;
  let pox = 0, poy = 0;
  for (let k = 0; k < pts.length; k++) {
    const q = pts[k];
    const hc = heightAt(w, q.x, q.y);
    const xo = q.x + q.ox * q.sw, yo = q.y + q.oy * q.sw;
    const ho = heightAt(w, xo, yo);
    const t = Math.min(1, q.raise / CURB);
    const road = hc + LIFT, top = road + q.raise, topO = ho + 0.03 + t * (LIFT - 0.03) + q.raise;
    const k2 = 0.95 + 0.08 * wobble(q.x * 3, q.y * 3);
    const hasCurb = q.raise > 0.02;
    const base = g.nv;
    g.v(q.x, road, q.y, -q.ox, 0, -q.oy, lerpCol(COL.gravel, COL.curb, t, k2));
    g.v(q.x, top, q.y, -q.ox, 0, -q.oy, lerpCol(COL.gravel, COL.curb, t, k2));
    g.v(q.x, top, q.y, 0, 1, 0, lerpCol(COL.gravel, COL.walk, t, k2));
    g.v(xo, topO, yo, q.ox * 0.4, 0.92, q.oy * 0.4, lerpCol(COL.gravel, COL.walk, t, k2 * 0.97));
    g.v(xo, ho - 0.25, yo, q.ox, 0, q.oy, lerpCol(COL.gravel, COL.skirt, t, k2));
    if (prev >= 0) {
      const fx = (q.ox + pox) / 2, fy = (q.oy + poy) / 2;
      if (hasCurb || prevHasCurb) g.quadFace(prev, prev + 1, base + 1, base, -fx, 0, -fy);
      g.quadUp(prev + 2, prev + 3, base + 3, base + 2);
      g.quadFace(prev + 3, prev + 4, base + 4, base + 3, fx, 0, fy);
    }
    prev = base;
    prevHasCurb = hasCurb;
    pox = q.ox; poy = q.oy;
  }
}

function buildJunction(j: Junction, w: World, G: Geoms): void {
  const P = j.node, m = j.arms.length;
  // asphalt if any road is paved up to here (a paved crossing, or where paving
  // of a track started), otherwise a dirt crossing
  const paved = j.arms.some((a) => a.here);
  const town = j.arms.some((a) => a.here && !a.country);
  // boundary of the road surface, counter-clockwise
  const bx: number[] = [], by: number[] = [];
  const add = (x: number, y: number) => {
    const n = bx.length;
    if (n && Math.abs(bx[n - 1] - x) < 1e-3 && Math.abs(by[n - 1] - y) < 1e-3) return;
    bx.push(x); by.push(y);
  };
  for (let k = 0; k < m; k++) {
    const a = j.arms[k];
    const lx = -a.dy, ly = a.dx;
    const ex = P.x + a.dx * a.T, ey = P.y + a.dy * a.T;
    for (const o of crossOffsets(a.e)) add(ex + lx * o, ey + ly * o);
    for (const q of j.corners[k]) add(q.x, q.y);
  }
  if (bx.length > 1 && Math.abs(bx[0] - bx[bx.length - 1]) < 1e-3 && Math.abs(by[0] - by[by.length - 1]) < 1e-3) { bx.pop(); by.pop(); }
  const nb = bx.length;
  if (nb >= 3) {
    let cx = P.x, cy = P.y;
    if (m === 1) { cx -= j.arms[0].dx * j.arms[0].hw * 0.4; cy -= j.arms[0].dy * j.arms[0].hw * 0.4; }
    let far = 0;
    for (let i = 0; i < nb; i++) far = Math.max(far, Math.hypot(bx[i] - cx, by[i] - cy));
    const g = G.road;
    const vert = (x: number, y: number) => {
      normalAt(w, x, y);
      return g.v(x, heightAt(w, x, y) + LIFT, y, NX, NY, NZ, paved ? asphaltAt(x, y, !town) : dirtAt(x, y));
    };
    const c = vert(cx, cy);
    const ring = far > 12;
    const B: number[] = [], Mid: number[] = [];
    for (let i = 0; i < nb; i++) {
      B.push(vert(bx[i], by[i]));
      if (ring) Mid.push(vert((bx[i] + cx) / 2, (by[i] + cy) / 2));
    }
    for (let i = 0; i < nb; i++) {
      const i2 = (i + 1) % nb;
      if (ring) {
        g.up(c, Mid[i], Mid[i2]);
        g.quadUp(Mid[i], B[i], B[i2], Mid[i2]);
      } else g.up(c, B[i], B[i2]);
    }
  }
  for (const pts of j.corners) band(G.walk, w, pts);
}

interface EdgeEnds { a: Arm; b: Arm; degA: number; degB: number }

function buildEdge(e: RoadEdge, A: RoadNode, Bn: RoadNode, ends: EdgeEnds, w: World, G: Geoms): void {
  const len = Math.hypot(Bn.x - A.x, Bn.y - A.y);
  if (len < 0.5) return;
  const ux = (Bn.x - A.x) / len, uy = (Bn.y - A.y) / len;
  const nx = -uy, ny = ux;
  const hw = e.width / 2;
  const country = e.kind === 'country';
  const paved = e.built !== false;
  const at = (s: number, o: number): [number, number] => [A.x + ux * s + nx * o, A.y + uy * s + ny * o];
  const s0 = ends.a.T, s1 = len - ends.b.T;
  const sw = shoulderOf(e);
  const st = stations(w, A.x, A.y, ux, uy, len, hw + sw);

  // ---- road surface: asphalt; on a track the paved part from end a, then dirt
  const ribbon = (sa: number, sb: number, xs: number[], col: (x: number, y: number, q: number) => RGBA, dh?: number[]) => {
    if (sb - sa <= 0.05) return;
    const g = G.road;
    let prev = -1;
    for (const s of between(st, sa, sb)) {
      const base = g.nv;
      for (let q = 0; q < xs.length; q++) {
        const [x, y] = at(s, xs[q]);
        normalAt(w, x, y);
        g.v(x, heightAt(w, x, y) + LIFT + (dh ? dh[q] : 0), y, NX, NY, NZ, col(x, y, q));
      }
      if (prev >= 0) for (let q = 0; q + 1 < xs.length; q++) g.quadUp(prev + q, prev + q + 1, base + q + 1, base + q);
      prev = base;
    }
  };
  if (paved) ribbon(s0, s1, crossOffsets(e), (x, y) => asphaltAt(x, y, country));
  else {
    const sp = Math.min(s1, Math.max(s0, paveLen(e, len)));
    ribbon(s0, sp, crossOffsets(e), (x, y) => freshAt(x, y));
    const prof = dirtProfile(hw);
    ribbon(sp, s1, prof.o, (x, y, q) => dirtAt(x, y, prof.k[q]), prof.dh);
  }

  // ---- sidewalks / shoulders
  const raise = roughRoad(e) ? 0 : CURB;
  for (const side of [1, -1]) {
    const start = side === 1 ? ends.a.wl : ends.a.wr;
    const end = len - (side === 1 ? ends.b.wr : ends.b.wl);
    if (end - start < 0.05) continue;
    const pts: CurbPt[] = [];
    for (const s of between(st, start, end)) {
      const [x, y] = at(s, side * hw);
      pts.push({ x, y, ox: nx * side, oy: ny * side, sw, raise });
    }
    band(G.walk, w, pts);
  }

  // ---- markings (only once the street is finished)
  if (country || !paved || s1 - s0 < 4) return;
  const g = G.mark;
  const quad = (sa: number, sb: number, oa: number, ob: number, col: RGBA) => {
    const corners = [at(sa, oa), at(sb, oa), at(sb, ob), at(sa, ob)];
    const idx = corners.map(([x, y]) => g.v(x, heightAt(w, x, y) + MARK, y, 0, 1, 0, col));
    g.quadUp(idx[0], idx[1], idx[2], idx[3]);
  };
  const strip = (sa: number, sb: number, oa: number, ob: number, col: RGBA) => {
    const ss = between(st, sa, sb);
    for (let k = 0; k + 1 < ss.length; k++) quad(ss[k], ss[k + 1], oa, ob, col);
  };
  const cwA = ends.degA >= 3 && !ends.a.acute && s1 - s0 > 10, cwB = ends.degB >= 3 && !ends.b.acute && s1 - s0 > 10;
  const m0 = s0 + (cwA ? 5 : 1.2), m1 = s1 - (cwB ? 5 : 1.2);
  if (m1 - m0 > 1) {
    if (e.kind === 'avenue') {
      strip(m0, m1, -0.3, -0.17, COL.yellow);
      strip(m0, m1, 0.17, 0.3, COL.yellow);
      for (const lane of [-hw / 2, hw / 2]) {
        for (let s = m0 + 1; s + 3 <= m1; s += 9) quad(s, s + 3, lane - 0.06, lane + 0.06, COL.white);
      }
    } else {
      const L = m1 - m0;
      const n = Math.max(1, Math.round((L + 5) / 8)); // 3 m dashes, ~5 m gaps, centered
      const period = (L + 5) / n;
      for (let k = 0; k < n; k++) {
        const s = m0 + k * period;
        quad(s, Math.min(m1, s + 3), -0.07, 0.07, COL.white);
      }
    }
  }
  // zebra crossings next to intersections, with a stop line
  const zebra = (sa: number, sb: number) => {
    const span = 2 * hw - 1.2;
    const n = Math.max(1, Math.floor((span + 0.55) / 1.1));
    const o0 = -((n - 1) * 1.1 + 0.55) / 2;
    for (let k = 0; k < n; k++) quad(sa, sb, o0 + k * 1.1, o0 + k * 1.1 + 0.55, COL.white);
  };
  if (cwA) { zebra(s0 + 0.8, s0 + 3.8); quad(s0 + 4.3, s0 + 4.65, 0, hw - 0.3, COL.white); }
  if (cwB) { zebra(s1 - 3.8, s1 - 0.8); quad(s1 - 4.65, s1 - 4.3, -(hw - 0.3), 0, COL.white); }
}

// -------------------------------------------------------------- prop models

const PC = {
  wood: [0.52, 0.36, 0.22, 1] as RGBA,
  metal: [0.2, 0.21, 0.22, 1] as RGBA,
  steel: [0.5, 0.52, 0.54, 1] as RGBA,
  binGreen: [0.16, 0.27, 0.19, 1] as RGBA,
  red: [0.78, 0.12, 0.1, 1] as RGBA,
  glass: [0.68, 0.79, 0.83, 1] as RGBA,
  roofBlue: [0.22, 0.26, 0.31, 1] as RGBA,
  poster: [0.92, 0.74, 0.32, 1] as RGBA,
  signBlue: [0.14, 0.4, 0.72, 1] as RGBA,
  trunk: [0.34, 0.25, 0.17, 1] as RGBA,
  leaf: [0.29, 0.45, 0.21, 1] as RGBA,
  leafLight: [0.37, 0.53, 0.25, 1] as RGBA,
  iron: [0.13, 0.13, 0.13, 1] as RGBA,
  soil: [0.27, 0.2, 0.14, 1] as RGBA,
  orange: [0.98, 0.42, 0.06, 1] as RGBA,
  white: [0.94, 0.94, 0.92, 1] as RGBA,
  stripe: [0.85, 0.12, 0.1, 1] as RGBA,
  black: [0.08, 0.08, 0.09, 1] as RGBA,
  yellow: [0.93, 0.7, 0.08, 1] as RGBA,
  darkGlass: [0.14, 0.18, 0.22, 1] as RGBA,
  rubber: [0.1, 0.1, 0.1, 1] as RGBA,
  stake: [0.72, 0.6, 0.42, 1] as RGBA,
  flag: [1.0, 0.25, 0.45, 1] as RGBA,
  housing: [0.1, 0.11, 0.1, 1] as RGBA,
  unlit: [0.16, 0.15, 0.14, 1] as RGBA,
};

/** Model builders. Local frame: +X = toward the road (furniture) or forward (machines), Y up. */
const MODELS: Record<string, (k: Kit) => void> = {
  bench: (k) => {
    k.box(0.02, 0.45, 0, 0.44, 0.05, 1.8, PC.wood);
    k.box(-0.21, 0.78, 0, 0.05, 0.34, 1.8, PC.wood, 0, -0.18);
    for (const z of [-0.72, 0.72]) {
      k.box(0, 0.22, z, 0.4, 0.44, 0.06, PC.metal);
      k.box(-0.18, 0.62, z, 0.06, 0.4, 0.06, PC.metal, 0, -0.18);
    }
  },
  bin: (k) => {
    k.cyl(0, 0, 0, 0.24, 0.26, 0.86, 9, PC.binGreen);
    k.cyl(0, 0.86, 0, 0.28, 0.28, 0.06, 9, PC.metal);
    k.box(0.27, 0.6, 0, 0.03, 0.18, 0.2, PC.white);
  },
  hydrant: (k) => {
    k.cyl(0, 0, 0, 0.15, 0.15, 0.06, 6, PC.red);
    k.cyl(0, 0.06, 0, 0.11, 0.1, 0.52, 6, PC.red);
    k.blob(0, 0.6, 0, 0.11, 0.1, 0.11, PC.red, 5, 3);
    k.box(0.14, 0.38, 0, 0.12, 0.1, 0.1, PC.steel);
    k.box(0, 0.38, 0, 0.07, 0.07, 0.36, PC.red);
  },
  shelter: (k) => {
    k.box(0, 2.45, 0, 1.6, 0.09, 3.7, PC.roofBlue);
    k.box(-0.68, 1.27, 0, 0.04, 2.0, 3.45, PC.glass);
    k.box(-0.2, 1.27, 1.74, 0.9, 2.0, 0.04, PC.glass);
    k.box(-0.2, 1.22, -1.74, 0.95, 1.85, 0.1, PC.poster);
    for (const [x, z] of [[-0.72, -1.78], [-0.72, 1.78], [0.3, -1.78], [0.3, 1.78]]) k.box(x, 1.2, z, 0.07, 2.4, 0.07, PC.metal);
    k.box(-0.45, 0.46, 0, 0.36, 0.05, 2.6, PC.wood);
    for (const z of [-1.1, 1.1]) k.box(-0.45, 0.22, z, 0.3, 0.44, 0.05, PC.metal);
    // the stop sign on its own pole, at the curb
    k.box(0.75, 1.45, 2.35, 0.07, 2.9, 0.07, PC.metal);
    k.box(0.75, 2.7, 2.35, 0.05, 0.42, 0.42, PC.signBlue);
    k.box(0.76, 2.38, 2.35, 0.05, 0.16, 0.42, PC.white);
  },
  tree: (k) => {
    k.cyl(0, -0.05, 0, 0.13, 0.09, 2.7, 6, PC.trunk);
    k.blob(0, 3.75, 0, 1.55, 1.45, 1.55, PC.leaf, 8, 5);
    k.blob(0.35, 4.55, -0.25, 1.05, 0.95, 1.05, PC.leafLight, 7, 4);
    k.blob(-0.6, 3.6, 0.5, 0.9, 0.85, 0.9, PC.leafLight, 6, 4);
  },
  grate: (k) => {
    k.box(0, 0.012, 0, 1.3, 0.025, 1.3, PC.iron);
    k.box(0, 0.02, 0, 0.5, 0.03, 0.5, PC.soil);
  },
  cone: (k) => {
    k.box(0, 0.02, 0, 0.42, 0.04, 0.42, PC.black);
    k.cyl(0, 0.04, 0, 0.17, 0.03, 0.68, 8, PC.orange);
    k.cyl(0, 0.3, 0, 0.122, 0.092, 0.14, 8, PC.white);
  },
  barrier: (k) => {
    for (const z of [-0.85, 0.85]) {
      k.box(0.18, 0.5, z, 0.06, 1.02, 0.06, PC.white, 0, 0.32);
      k.box(-0.18, 0.5, z, 0.06, 1.02, 0.06, PC.white, 0, -0.32);
    }
    for (const y of [0.92, 0.55]) {
      for (let i = 0; i < 6; i++) k.box(0, y, -0.9 + 0.15 + i * 0.3, 0.05, 0.22, 0.3, i % 2 ? PC.white : PC.stripe);
    }
    k.blob(0, 1.12, -0.85, 0.07, 0.07, 0.07, PC.orange, 5, 3);
  },
  sign: (k) => {
    k.box(0, 0.75, 0, 0.06, 1.5, 0.06, PC.steel);
    k.box(0, 0.03, 0, 0.5, 0.06, 0.5, PC.black);
    k.panel(0.05, 0.03, [[0, 1.3], [0.42, 1.72], [0, 2.14], [-0.42, 1.72]], PC.orange, PC.steel);
    k.panel(0.075, 0.01, [[-0.03, 1.5], [0.13, 1.5], [0.13, 1.92], [-0.03, 1.92]], PC.black, PC.black);
    k.panel(0.075, 0.01, [[-0.2, 1.5], [-0.09, 1.5], [-0.12, 1.72], [-0.2, 1.72]], PC.black, PC.black);
  },
  roller: (k) => {
    k.cyl(1.25, 0.62, 0, 0.62, 0.62, 1.7, 12, PC.steel, 'z');
    k.cyl(-1.25, 0.62, 0, 0.62, 0.62, 1.7, 12, PC.steel, 'z');
    k.box(1.25, 1.18, 0, 1.3, 0.12, 1.85, PC.yellow);
    k.box(-1.25, 1.18, 0, 1.3, 0.12, 1.85, PC.yellow);
    k.box(0, 0.95, 0, 1.4, 0.95, 1.3, PC.yellow);
    k.box(-0.2, 1.5, 0, 0.9, 0.12, 1.2, PC.metal);
    for (const [x, z] of [[-0.6, -0.55], [-0.6, 0.55], [0.2, -0.55], [0.2, 0.55]]) k.box(x, 2.0, z, 0.06, 1.0, 0.06, PC.metal);
    k.box(-0.2, 2.5, 0, 1.0, 0.07, 1.3, PC.yellow);
    k.box(-0.35, 1.75, 0, 0.35, 0.45, 0.5, PC.black);
    k.blob(-0.2, 2.58, 0.4, 0.08, 0.08, 0.08, PC.orange, 5, 3);
  },
  paver: (k) => {
    for (const z of [-1.05, 1.05]) k.box(0.1, 0.33, z, 2.6, 0.62, 0.5, PC.rubber);
    k.box(0.1, 0.95, 0, 2.4, 0.75, 2.2, PC.yellow);
    k.box(1.65, 0.95, 0, 0.9, 0.7, 2.9, PC.darkGlass);
    k.box(1.65, 1.32, 0, 0.95, 0.06, 3.0, PC.yellow);
    k.box(-1.45, 0.28, 0, 0.5, 0.36, 3.3, PC.metal);
    k.box(-1.3, 0.62, 0, 0.3, 0.3, 3.3, PC.yellow);
    k.box(-0.35, 1.55, 0, 0.8, 0.5, 1.1, PC.metal);
    for (const [x, z] of [[-0.9, -0.85], [-0.9, 0.85], [0.3, -0.85], [0.3, 0.85]]) k.box(x, 2.0, z, 0.06, 1.3, 0.06, PC.metal);
    k.box(-0.3, 2.65, 0, 1.5, 0.07, 1.95, PC.yellow);
    k.blob(-0.3, 2.74, 0.7, 0.09, 0.09, 0.09, PC.orange, 5, 3);
  },
  excavator: (k) => {
    for (const z of [-1.0, 1.0]) k.box(0, 0.36, z, 3.3, 0.72, 0.62, PC.rubber);
    k.box(0, 0.8, 0, 1.4, 0.2, 1.4, PC.metal);
    k.box(-0.35, 1.3, 0, 2.6, 0.85, 2.1, PC.yellow);
    k.box(0.45, 2.05, 0.55, 1.0, 1.15, 0.9, PC.yellow);
    k.box(0.6, 2.15, 0.55, 0.75, 0.75, 0.92, PC.darkGlass);
    k.box(-1.45, 1.45, 0, 0.5, 0.9, 2.0, PC.metal);
    // boom up and forward, stick down to the bucket
    k.box(1.75, 2.45, -0.25, 2.9, 0.38, 0.38, PC.yellow, 0, 0.62);
    k.box(3.15, 2.0, -0.25, 0.3, 2.1, 0.3, PC.yellow, 0, -0.25);
    k.box(3.45, 0.85, -0.25, 0.75, 0.6, 0.9, PC.metal, 0, 0.4);
  },
  stake: (k) => {
    k.box(0, 0.35, 0, 0.05, 0.7, 0.05, PC.stake);
    k.box(0, 0.64, 0.1, 0.01, 0.1, 0.2, PC.flag);
  },
  signal: (k) => {
    k.box(0, 1.8, 0, 0.13, 3.6, 0.13, PC.housing);
    k.box(0, 0.05, 0, 0.35, 0.1, 0.35, PC.housing);
    k.box(0.12, 3.15, 0, 0.26, 0.9, 0.34, PC.housing);
    for (const y of [3.43, 3.15, 2.87]) {
      k.box(0.26, y, 0, 0.03, 0.2, 0.2, PC.unlit);
      k.box(0.32, y + 0.11, 0, 0.12, 0.02, 0.24, PC.housing);
    }
    k.box(-0.08, 1.2, 0, 0.12, 0.3, 0.22, PC.housing); // push-button box
  },
};

/** Lit traffic-light lenses (emissive), heights matching the 'signal' model. */
const LENS_Y = { red: 3.43, amber: 3.15, green: 2.87 } as const;

// ------------------------------------------------------------------ renderer

interface Chunk { sig: string; meshes: (Mesh | null)[] }
interface Group { js: Junction[]; es: RoadEdge[]; sig: string[] }

export interface RoadStats {
  ms: number; chunks: number; rebuilt: number; edges: number; lamps: number; vertices: number;
  /** Street furniture spots (all), instanced near the camera, road-crew props, traffic lights, unpaved edges. */
  furniture: number; nearFurniture: number; works: number; signals: number; dirt: number;
}

type FurnModel = 'bench' | 'bin' | 'hydrant' | 'shelter' | 'tree' | 'grate';
const FURN_MODEL: Record<FurnitureKind, FurnModel> = { bench: 'bench', bin: 'bin', hydrant: 'hydrant', busstop: 'shelter', tree: 'tree' };
const WORK_MODELS = ['cone', 'barrier', 'sign', 'roller', 'paver', 'excavator', 'stake'] as const;
type WorkModel = typeof WORK_MODELS[number];
const SIGNAL_LENSES = ['redA', 'amberA', 'greenA', 'redB', 'amberB', 'greenB'] as const;

/** Write a transform: local X -> (fx, 0, fz), Y up, Z = X x Y, uniform scale s, at (x, h, y). */
function pushMat(out: number[], x: number, h: number, y: number, fx: number, fz: number, s = 1, sy = s): void {
  out.push(fx * s, 0, fz * s, 0, 0, sy, 0, 0, -fz * s, 0, fx * s, 0, x, h, y, 1);
}

export class RoadRenderer {
  private world: World | null = null;
  private ver = -1;
  private hash = 0;
  private readonly chunks = new Map<number, Chunk>();
  private readonly mats: StandardMaterial[];
  private readonly poles: Mesh;
  private readonly heads: Mesh;
  private readonly halos: Mesh;
  private readonly pools: Mesh;
  private readonly poleMat: StandardMaterial;
  private readonly headMat: StandardMaterial;
  private readonly haloMat: StandardMaterial;
  private readonly poolMat: StandardMaterial;
  private readonly poolTex: DynamicTexture;
  private readonly lotMat: StandardMaterial;
  private readonly propMat: StandardMaterial;
  private readonly lensMats: Record<'red' | 'amber' | 'green', StandardMaterial>;
  private readonly models = new Map<string, Mesh>();
  private lotMesh: Mesh | null = null;
  private pendingLots: { lots: Lot[]; colorOf: (lot: Lot) => Color3 | null } | null = null;
  private readonly geoms: Geoms = { road: new Geom(), walk: new Geom(), mark: new Geom() };
  private night = 0;
  private lampCount = 0;
  private lampSrc: LampSpot[] | null = null;
  private lampWorld: World | null = null;
  /** Paved length (quantized) of each unpaved edge at the last geometry sync. */
  private readonly paveQ = new Map<number, number>();
  /** Road bands for `surfaceAt`: per edge ax, ay, bx, by, half width, shoulder, curb (1/0), unused. */
  private surf = new Float32Array(0);
  private surfGrid = new Map<number, number[]>();
  /** Changed chunks not rebuilt yet (time budget), with what's needed to build them. */
  private readonly pending = new Map<number, { g: Group; sig: string }>();
  private pendingCtx: { ends: Map<number, EdgeEnds>; nodeById: Map<number, RoadNode>; world: World } | null = null;
  private worksSig = '';
  private worksWorld: World | null = null;
  private worksCount = 0;
  // street furniture: world matrices and ground positions per model, filtered by distance to the camera
  private furnSrc: FurnitureSpot[] | null = null;
  private furnWorld: World | null = null;
  private furn = new Map<FurnModel, { pos: Float32Array; mats: Float32Array; n: number }>();
  private nearAt = { x: NaN, y: NaN, high: false };
  private nearCount = 0;
  private signalCount = 0;
  private signalPhase = -1;
  private readonly observer: Nullable<Observer<Scene>>;
  /** Timing and size of the last `sync` that did work. */
  stats: RoadStats = { ms: 0, chunks: 0, rebuilt: 0, edges: 0, lamps: 0, vertices: 0, furniture: 0, nearFurniture: 0, works: 0, signals: 0, dirt: 0 };

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator | null) {
    const mk = (name: string, zOffset: number, spec = 0.05) => {
      const m = new StandardMaterial(name, scene);
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = 24;
      m.zOffset = zOffset;
      m.zOffsetUnits = zOffset * 2;
      return m;
    };
    this.mats = [mk('roadAsphalt', -1, 0.07), mk('roadWalk', -0.5), mk('roadMarks', -2, 0.1)];

    // ---- streetlights: pole + arm, head, halo, light pool
    const pole = MeshBuilder.CreateCylinder('lampPole', { height: 6.6, diameterTop: 0.12, diameterBottom: 0.2, tessellation: 6 }, scene);
    pole.position.y = 3.3;
    pole.bakeCurrentTransformIntoVertices();
    const arm = MeshBuilder.CreateBox('lampArm', { width: 1.6, height: 0.08, depth: 0.08 }, scene);
    arm.position.set(0.75, 6.5, 0);
    arm.rotation.z = 0.08;
    arm.bakeCurrentTransformIntoVertices();
    this.poles = Mesh.MergeMeshes([pole, arm], true, true)!;
    this.poles.name = 'lampPoles';
    this.poleMat = new StandardMaterial('lampPoleMat', scene);
    this.poleMat.diffuseColor = new Color3(0.26, 0.27, 0.29);
    this.poleMat.specularColor = new Color3(0.25, 0.25, 0.25);
    this.poles.material = this.poleMat;

    this.heads = MeshBuilder.CreateBox('lampHeads', { width: 0.62, height: 0.16, depth: 0.32 }, scene);
    this.heads.position.set(1.5, 6.5, 0);
    this.heads.bakeCurrentTransformIntoVertices();
    this.headMat = new StandardMaterial('lampHeadMat', scene);
    this.headMat.diffuseColor = new Color3(0.55, 0.55, 0.52);
    this.headMat.specularColor = new Color3(0.3, 0.3, 0.3);
    this.heads.material = this.headMat;

    this.halos = MeshBuilder.CreateSphere('lampHalos', { diameter: 1.25, segments: 10 }, scene);
    this.halos.position.set(1.5, 6.3, 0);
    this.halos.bakeCurrentTransformIntoVertices();
    this.haloMat = new StandardMaterial('lampHaloMat', scene);
    this.haloMat.disableLighting = true;
    this.haloMat.diffuseColor = Color3.Black();
    this.haloMat.emissiveColor = new Color3(1, 0.78, 0.48);
    this.haloMat.emissiveFresnelParameters = new FresnelParameters({ leftColor: Color3.White(), rightColor: Color3.Black(), bias: 0, power: 2.4 });
    this.haloMat.alphaMode = Constants.ALPHA_ADD;
    this.haloMat.disableDepthWrite = true;
    this.haloMat.fogEnabled = false;
    this.halos.material = this.haloMat;

    this.pools = MeshBuilder.CreateGround('lampPools', { width: 1, height: 1 }, scene);
    this.poolTex = new DynamicTexture('lampPoolTex', { width: 128, height: 128 }, scene, true);
    const ctx = this.poolTex.getContext();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
    grad.addColorStop(0, 'rgb(255,214,150)');
    grad.addColorStop(0.35, 'rgb(190,150,95)');
    grad.addColorStop(0.7, 'rgb(70,52,30)');
    grad.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.poolTex.update();
    this.poolMat = new StandardMaterial('lampPoolMat', scene);
    this.poolMat.disableLighting = true;
    this.poolMat.diffuseColor = Color3.Black();
    this.poolMat.specularColor = Color3.Black();
    this.poolMat.emissiveColor = Color3.Black();
    this.poolMat.emissiveTexture = this.poolTex;
    this.poolMat.alphaMode = Constants.ALPHA_ADD;
    this.poolMat.disableDepthWrite = true;
    this.poolMat.fogEnabled = false;
    this.poolMat.zOffset = -4;
    this.pools.material = this.poolMat;

    for (const m of [this.poles, this.heads, this.halos, this.pools]) {
      m.isPickable = false;
      m.isVisible = false;
      m.freezeWorldMatrix();
    }
    this.poles.receiveShadows = true;
    shadows?.addShadowCaster(this.poles);

    // ---- street furniture, road-crew props, traffic lights (thin instances of vertex-colored models)
    this.propMat = new StandardMaterial('streetPropMat', scene);
    this.propMat.specularColor = new Color3(0.08, 0.08, 0.08);
    this.propMat.specularPower = 32;
    const casts = new Set(['tree', 'shelter', 'bench', 'roller', 'paver', 'excavator', 'barrier', 'signal', 'sign']);
    for (const [name, build] of Object.entries(MODELS)) {
      const k = new Kit();
      build(k);
      const m = new Mesh('street-' + name, scene);
      k.vertexData().applyToMesh(m, false);
      m.material = this.propMat;
      m.isPickable = false;
      m.isVisible = false;
      m.receiveShadows = true;
      m.freezeWorldMatrix();
      if (casts.has(name)) shadows?.addShadowCaster(m);
      this.models.set(name, m);
    }
    const lens = (name: string, c: Color3) => {
      const mat = new StandardMaterial('signalLens-' + name, scene);
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.emissiveColor = c;
      return mat;
    };
    this.lensMats = { red: lens('red', new Color3(1, 0.12, 0.08)), amber: lens('amber', new Color3(1, 0.62, 0.05)), green: lens('green', new Color3(0.2, 1, 0.45)) };
    for (const name of SIGNAL_LENSES) {
      const m = MeshBuilder.CreateBox('signal-' + name, { width: 0.035, height: 0.19, depth: 0.19 }, scene);
      const color = name.slice(0, -1) as 'red' | 'amber' | 'green';
      m.position.set(0.28, LENS_Y[color], 0);
      m.bakeCurrentTransformIntoVertices();
      m.material = this.lensMats[color];
      m.isPickable = false;
      m.isVisible = false;
      m.freezeWorldMatrix();
      this.models.set(name, m);
    }
    this.observer = scene.onBeforeRenderObservable.add(() => this.frame());

    this.lotMat = new StandardMaterial('lotOverlayMat', scene);
    this.lotMat.disableLighting = true;
    this.lotMat.diffuseColor = Color3.Black();
    this.lotMat.specularColor = Color3.Black();
    this.lotMat.emissiveColor = Color3.White();
    this.lotMat.backFaceCulling = false;
    this.lotMat.disableDepthWrite = true;
    this.lotMat.zOffset = -3;
    this.lotMat.zOffsetUnits = -6;
    this.setNight(0);
  }

  /**
   * Rebuild road meshes if `roads.ver` changed (only chunks whose geometry
   * changed are regenerated). Also follows paving fronts and road crews, which
   * may change without a version bump; call it every frame or every few
   * hundred milliseconds.
   */
  sync(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>, world: World): void {
    if (world === this.world) {
      // nothing to redraw unless the network's shape, a street's state or a paving front changed
      // (version bumps also come from new lots or crews' progress between drawing steps)
      const same = roads.ver === this.ver ? !this.paveChanged(roads) : this.netHash(roads) === this.hash;
      if (same) {
        this.ver = roads.ver;
        if (this.pending.size) this.flushPending();
        this.syncWorks(roads, nodeById, world);
        return;
      }
    }
    const t0 = performance.now();
    this.hash = this.netHash(roads);
    if (world !== this.world) {
      for (const c of this.chunks.values()) for (const m of c.meshes) m?.dispose();
      this.chunks.clear();
      this.world = world;
    }
    this.ver = roads.ver;

    // every junction (corners and trims), then trims are fitted to each edge's length
    const juncs = new Map<number, Junction>();
    for (const nd of roads.nodes) {
      if (!nd.edges.length) continue;
      const j = makeJunction(nd, edgeById, nodeById);
      if (j) juncs.set(nd.id, j);
    }
    const ends = new Map<number, EdgeEnds>();
    for (const e of roads.edges) {
      const ja = juncs.get(e.a), jb = juncs.get(e.b);
      const a = ja?.arms.find((x) => x.e.id === e.id && x.atA);
      const b = jb?.arms.find((x) => x.e.id === e.id && !x.atA);
      if (!a || !b || !ja || !jb) continue;
      const lim = Math.max(0, e.len - 0.5);
      if (a.T + b.T > lim) {
        const f = lim / (a.T + b.T);
        a.T *= f; b.T *= f;
      }
      ends.set(e.id, { a, b, degA: ja.arms.length, degB: jb.arms.length });
    }

    // group into chunks, with a signature of everything the geometry depends on
    const r = (v: number) => Math.round(v * 1000);
    const groups = new Map<number, Group>();
    const group = (x: number, y: number) => {
      const key = Math.floor(x / CHUNK) * 1000 + Math.floor(y / CHUNK);
      let g = groups.get(key);
      if (!g) { g = { js: [], es: [], sig: [] }; groups.set(key, g); }
      return g;
    };
    for (const j of juncs.values()) {
      const g = group(j.node.x, j.node.y);
      g.js.push(j);
      let s = `n${j.node.id}@${r(j.node.x)},${r(j.node.y)}`;
      for (const a of j.arms) s += `|${a.e.id}${a.e.kind[0]}${a.e.width}${+a.here}${+a.rough},${r(a.ang)},${r(a.T)},${r(a.tl)},${r(a.tr)},${r(a.wl)},${r(a.wr)}`;
      g.sig.push(s);
    }
    this.paveQ.clear();
    let dirt = 0;
    for (const e of roads.edges) {
      const en = ends.get(e.id);
      const A = nodeById.get(e.a), B = nodeById.get(e.b);
      if (!en || !A || !B) continue;
      const g = group((A.x + B.x) / 2, (A.y + B.y) / 2);
      g.es.push(e);
      let state = 'P';
      if (e.built === false) {
        const q = paveLen(e, e.len);
        this.paveQ.set(e.id, q);
        state = `D${q}`;
        dirt++;
      }
      g.sig.push(`e${e.id}${e.kind[0]}${e.width}${state}@${r(A.x)},${r(A.y)},${r(B.x)},${r(B.y)}|${r(en.a.T)},${r(en.a.wl)},${r(en.a.wr)},${en.degA}${+en.a.acute}${+en.a.here}|${r(en.b.T)},${r(en.b.wl)},${r(en.b.wr)},${en.degB}${+en.b.acute}${+en.b.here}`);
    }

    // new chunks are built right away; changed ones nearest to the camera first, within a time budget
    // (the rest follow on the next syncs)
    this.pending.clear();
    this.pendingCtx = { ends, nodeById, world };
    let rebuilt = 0;
    const changed: { key: number; g: Group; sig: string; d: number }[] = [];
    const focus = this.focus();
    for (const [key, g] of groups) {
      const sig = g.sig.join('#');
      const chunk = this.chunks.get(key);
      if (chunk && chunk.sig === sig) continue;
      if (!chunk) { this.buildChunk(key, g, sig); rebuilt++; continue; }
      const cx = (Math.floor(key / 1000) + 0.5) * CHUNK, cy = ((key % 1000) + 0.5) * CHUNK;
      changed.push({ key, g, sig, d: Math.hypot(cx - focus[0], cy - focus[1]) });
    }
    changed.sort((a, b) => a.d - b.d);
    const tb = performance.now();
    for (const c of changed) {
      if (rebuilt > 0 && performance.now() - tb > REBUILD_BUDGET) { this.pending.set(c.key, { g: c.g, sig: c.sig }); continue; }
      this.buildChunk(c.key, c.g, c.sig);
      rebuilt++;
    }
    for (const [key, c] of this.chunks) {
      if (groups.has(key)) continue;
      for (const m of c.meshes) m?.dispose();
      this.chunks.delete(key);
    }
    this.indexSurfaces(roads, nodeById);
    if (rebuilt) this.placeSignals(juncs, world);
    this.placeLamps(roads, nodeById, edgeById, world);
    this.placeFurniture(roads, nodeById, edgeById, world);
    this.syncWorks(roads, nodeById, world);
    if (this.pendingLots) {
      const p = this.pendingLots;
      this.pendingLots = null;
      this.setLotOverlay(p.lots, p.colorOf);
    }
    let vertices = 0;
    for (const c of this.chunks.values()) for (const m of c.meshes) vertices += m ? m.getTotalVertices() : 0;
    this.stats = {
      ms: performance.now() - t0, chunks: this.chunks.size, rebuilt, edges: roads.edges.length, lamps: this.lampCount, vertices,
      furniture: this.furnSrc?.length ?? 0, nearFurniture: this.nearCount, works: this.worksCount, signals: this.signalCount, dirt,
    };
  }

  /**
   * Hash of everything road geometry, lamps and furniture depend on: nodes,
   * edges with their kind, width, state and drawn paving front, and lot zones.
   */
  private netHash(roads: Roads): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193); h ^= h >>> 13; };
    for (const n of roads.nodes) { mix(n.id); mix(Math.round(n.x * 256)); mix(Math.round(n.y * 256)); mix(n.edges.length); }
    for (const e of roads.edges) {
      mix(e.id); mix(e.a); mix(e.b); mix(e.kind.charCodeAt(0)); mix(Math.round(e.width * 100));
      mix(e.built === false ? 1 + paveLen(e, e.len) * 8 : 0);
    }
    for (const l of roads.lots) { mix(l.edge); mix(l.zone.charCodeAt(0)); }
    return h;
  }

  /**
   * Height of the walkable surface above `heightAt` at a point: sidewalk top
   * next to paved town streets, the road surface on asphalt and dirt tracks
   * (and their junctions), a little above the ground elsewhere. For placing
   * people (vehicles use ROAD_SURFACE.asphalt). Cheap: a grid lookup.
   */
  surfaceAt(x: number, y: number): number {
    const ids = this.surfGrid.get(Math.floor(x / SURF_CELL) * 4096 + Math.floor(y / SURF_CELL));
    if (!ids) return OFF_ROAD;
    const S = this.surf;
    let best = OFF_ROAD;
    for (const i of ids) {
      const o = i * 8;
      const ax = S[o], ay = S[o + 1], dx = S[o + 2] - ax, dy = S[o + 3] - ay, hw = S[o + 4], sw = S[o + 5], curb = S[o + 6];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      // past the ends, the junction area (about as wide as the road) is road surface too
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (d <= hw) return LIFT;
      if (d <= hw + sw) best = Math.max(best, curb ? LIFT + CURB : LIFT - (LIFT - OFF_ROAD) * ((d - hw) / sw));
    }
    return best;
  }

  private indexSurfaces(roads: Roads, nodeById: Map<number, RoadNode>): void {
    const S = new Float32Array(roads.edges.length * 8);
    const grid = new Map<number, number[]>();
    let n = 0;
    for (const e of roads.edges) {
      const A = nodeById.get(e.a), B = nodeById.get(e.b);
      if (!A || !B) continue;
      const hw = e.width / 2, sw = shoulderOf(e), pad = hw + sw;
      const o = n * 8;
      S[o] = A.x; S[o + 1] = A.y; S[o + 2] = B.x; S[o + 3] = B.y; S[o + 4] = hw; S[o + 5] = sw; S[o + 6] = roughRoad(e) ? 0 : 1;
      const x0 = Math.floor((Math.min(A.x, B.x) - pad) / SURF_CELL), x1 = Math.floor((Math.max(A.x, B.x) + pad) / SURF_CELL);
      const y0 = Math.floor((Math.min(A.y, B.y) - pad) / SURF_CELL), y1 = Math.floor((Math.max(A.y, B.y) + pad) / SURF_CELL);
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          // only cells the road's band actually crosses
          const mx = (cx + 0.5) * SURF_CELL, my = (cy + 0.5) * SURF_CELL;
          const dist = Math.abs((mx - A.x) * (B.y - A.y) - (my - A.y) * (B.x - A.x)) / len;
          if (dist > pad + SURF_CELL * 0.71) continue;
          const key = cx * 4096 + cy;
          let list = grid.get(key);
          if (!list) { list = []; grid.set(key, list); }
          list.push(n);
        }
      }
      n++;
    }
    this.surf = S;
    this.surfGrid = grid;
  }

  /** Rebuild one chunk's meshes from its junctions and edges. */
  private buildChunk(key: number, g: Group, sig: string): void {
    const { ends, nodeById, world } = this.pendingCtx!;
    let chunk = this.chunks.get(key);
    if (!chunk) { chunk = { sig, meshes: [null, null, null] }; this.chunks.set(key, chunk); }
    chunk.sig = sig;
    const G = this.geoms;
    G.road.reset(); G.walk.reset(); G.mark.reset();
    for (const j of g.js) buildJunction(j, world, G);
    for (const e of g.es) buildEdge(e, nodeById.get(e.a)!, nodeById.get(e.b)!, ends.get(e.id)!, world, G);
    [G.road, G.walk, G.mark].forEach((geom, slot) => this.apply(chunk!, slot, geom, key));
  }

  /** Chunks left over from the last sync's time budget, nearest first. */
  private flushPending(): void {
    const t0 = performance.now();
    const focus = this.focus();
    const list = [...this.pending].map(([key, p]) => ({ key, p, d: Math.hypot((Math.floor(key / 1000) + 0.5) * CHUNK - focus[0], ((key % 1000) + 0.5) * CHUNK - focus[1]) }))
      .sort((a, b) => a.d - b.d);
    let n = 0;
    for (const { key, p } of list) {
      if (n > 0 && performance.now() - t0 > REBUILD_BUDGET) break;
      this.buildChunk(key, p.g, p.sig);
      this.pending.delete(key);
      n++;
    }
    this.stats.rebuilt = n;
    this.stats.ms = performance.now() - t0;
  }

  /** Ground point the camera looks at (or stands on). */
  private focus(): [number, number] {
    const cam = this.scene.activeCamera;
    if (!cam) return [0, 0];
    const t = (cam as Camera & { getTarget?: () => { x: number; z: number } }).getTarget?.();
    return t ? [t.x, t.z] : [cam.globalPosition.x, cam.globalPosition.z];
  }

  /** Did any paving front move by a drawing step since the last geometry sync? */
  private paveChanged(roads: Roads): boolean {
    for (const e of roads.edges) {
      if (e.built !== false) continue;
      const q = this.paveQ.get(e.id);
      if (q === undefined || q !== paveLen(e, e.len)) return true;
    }
    return false;
  }

  private apply(chunk: Chunk, slot: number, g: Geom, key: number): void {
    let m = chunk.meshes[slot];
    if (g.ni === 0) {
      m?.dispose();
      chunk.meshes[slot] = null;
      return;
    }
    if (!m) {
      m = new Mesh(['roads', 'walks', 'marks'][slot] + '-' + key, this.scene);
      m.material = this.mats[slot];
      m.isPickable = false;
      m.receiveShadows = true;
      m.freezeWorldMatrix();
      chunk.meshes[slot] = m;
    }
    g.vertexData().applyToMesh(m, false);
  }

  private setInstances(m: Mesh, data: number[] | Float32Array): void {
    const n = data.length / 16;
    m.isVisible = n > 0;
    if (n) m.thinInstanceSetBuffer('matrix', data instanceof Float32Array ? data : new Float32Array(data), 16, true);
    else if (m.thinInstanceCount) m.thinInstanceCount = 0;
  }

  /** Streetlights where `streetLamps` says (the simulation uses the same spots). */
  private placeLamps(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>, w: World): void {
    const src = streetLamps(roads, nodeById, edgeById);
    if (src === this.lampSrc && w === this.lampWorld) return;
    this.lampSrc = src;
    this.lampWorld = w;
    const lamp: number[] = [], pool: number[] = [];
    for (const l of src) {
      const e = edgeById.get(l.edge);
      const scale = e?.kind === 'avenue' ? 1.15 : 1;
      const gx = Math.cos(l.dir), gz = Math.sin(l.dir); // toward the road
      const h = heightAt(w, l.x, l.y) + LIFT + CURB;
      pushMat(lamp, l.x, h, l.y, gx, gz, scale);
      // light pool under the head, tilted to the ground
      const px = l.x + gx * 1.5 * scale, py = l.y + gz * 1.5 * scale;
      normalAt(w, px, py);
      const d = gx * NX + gz * NZ;
      let ax = gx - d * NX, ay = -d * NY, az = gz - d * NZ;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      const cx = ay * NZ - az * NY, cy = az * NX - ax * NZ, cz = ax * NY - ay * NX; // a x n
      const S = 15 * scale;
      pool.push(ax * S, ay * S, az * S, 0, NX, NY, NZ, 0, cx * S, cy * S, cz * S, 0, px, heightAt(w, px, py) + LIFT + CURB + 0.06, py, 1);
    }
    this.lampCount = lamp.length / 16;
    this.setInstances(this.poles, lamp);
    this.setInstances(this.heads, lamp);
    this.setInstances(this.halos, lamp);
    this.setInstances(this.pools, pool);
    this.setNight(this.night);
  }

  /** Benches, bins, hydrants, bus shelters and trees from `streetFurniture`; instanced near the camera in `frame`. */
  private placeFurniture(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>, w: World): void {
    const src = streetFurniture(roads, nodeById, edgeById);
    if (src === this.furnSrc && w === this.furnWorld) return;
    this.furnSrc = src;
    this.furnWorld = w;
    const lists = new Map<FurnModel, { pos: number[]; mats: number[] }>();
    const list = (m: FurnModel) => {
      let l = lists.get(m);
      if (!l) { l = { pos: [], mats: [] }; lists.set(m, l); }
      return l;
    };
    for (const f of src) {
      const model = FURN_MODEL[f.kind];
      const h = heightAt(w, f.x, f.y) + LIFT + CURB;
      const l = list(model);
      l.pos.push(f.x, f.y);
      if (f.kind === 'tree') {
        const r = hash2(Math.round(f.x * 10), Math.round(f.y * 10), 7);
        const a = r * Math.PI * 2, s = 0.85 + 0.35 * hash2(Math.round(f.x * 10), Math.round(f.y * 10), 8);
        pushMat(l.mats, f.x, h, f.y, Math.cos(a), Math.sin(a), s);
        if (f.grate) {
          const g = list('grate');
          g.pos.push(f.x, f.y);
          pushMat(g.mats, f.x, h, f.y, Math.cos(f.dir), Math.sin(f.dir));
        }
      } else pushMat(l.mats, f.x, h, f.y, Math.cos(f.dir), Math.sin(f.dir));
    }
    this.furn.clear();
    for (const [m, l] of lists) this.furn.set(m, { pos: new Float32Array(l.pos), mats: new Float32Array(l.mats), n: l.pos.length / 2 });
    for (const m of ['bench', 'bin', 'hydrant', 'shelter', 'tree', 'grate'] as FurnModel[]) if (!this.furn.has(m)) this.setInstances(this.models.get(m)!, []);
    this.nearAt.x = NaN; // re-filter on the next frame
  }

  /** Per frame: re-filter furniture around the camera when it moved, and cycle the traffic lights. */
  private frame(): void {
    const cam = this.scene.activeCamera;
    if (cam && this.furn.size) {
      const p = cam.globalPosition;
      const [fx, fy] = this.focus();
      const ground = this.world ? heightAt(this.world, p.x, p.z) : 0;
      const high = p.y - ground > 900;
      if (high !== this.nearAt.high || !(Math.hypot(fx - this.nearAt.x, fy - this.nearAt.y) < 40)) {
        this.nearAt = { x: fx, y: fy, high };
        this.filterFurniture(fx, fy, p.x, p.z, high);
      }
    }
    if (this.signalCount) {
      const t = (performance.now() / 1000) % SIGNAL_CYCLE, half = SIGNAL_CYCLE / 2;
      // A green, A amber, (all red), B green, B amber, (all red)
      const phase = t < half - 4 ? 0 : t < half - 1 ? 1 : t < half ? 2 : t < SIGNAL_CYCLE - 4 ? 3 : t < SIGNAL_CYCLE - 1 ? 4 : 5;
      if (phase !== this.signalPhase) {
        this.signalPhase = phase;
        const on = (name: string, v: boolean) => this.models.get(name)!.setEnabled(v);
        on('greenA', phase === 0); on('amberA', phase === 1); on('redA', phase >= 2);
        on('greenB', phase === 3); on('amberB', phase === 4); on('redB', phase <= 2 || phase === 5);
      }
    }
  }

  private filterFurniture(fx: number, fy: number, cx: number, cy: number, high: boolean): void {
    let count = 0;
    for (const [model, f] of this.furn) {
      const lim = model === 'tree' ? NEAR_TREES : model === 'shelter' ? NEAR_SMALL * 1.4 : NEAR_SMALL;
      const out: number[] = [];
      if (!high || model === 'tree') {
        const l2 = lim * lim;
        for (let i = 0; i < f.n; i++) {
          const x = f.pos[i * 2], y = f.pos[i * 2 + 1];
          if ((x - fx) ** 2 + (y - fy) ** 2 > l2 && (x - cx) ** 2 + (y - cy) ** 2 > l2) continue;
          for (let k = 0; k < 16; k++) out.push(f.mats[i * 16 + k]);
        }
      }
      count += out.length / 16;
      this.setInstances(this.models.get(model)!, out);
    }
    this.nearCount = count;
    this.stats.nearFurniture = count;
  }

  /**
   * Road crews and survey stakes: a paver and a roller at the paving front of
   * edges being worked on, cones, barriers and road-works signs around it;
   * stakes along streets scheduled for paving. Rebuilt only when it changes.
   */
  private syncWorks(roads: Roads, nodeById: Map<number, RoadNode>, w: World): void {
    let sig = '';
    for (const e of roads.edges) {
      if (e.built !== false || (!e.active && !e.paving)) continue;
      sig += `${e.id}${e.active ? 'a' : ''}${e.paving ? 'p' : ''}${Math.round((e.progress ?? 0) * e.len * 2)},`;
    }
    if (sig === this.worksSig && w === this.worksWorld) return;
    this.worksSig = sig;
    this.worksWorld = w;
    const out = new Map<WorkModel, number[]>(WORK_MODELS.map((m) => [m, []]));
    for (const e of roads.edges) {
      if (e.built !== false || (!e.active && !e.paving)) continue;
      const A = nodeById.get(e.a), B = nodeById.get(e.b);
      if (!A || !B) continue;
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      if (len < 4) continue;
      const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len, nx = -uy, ny = ux;
      const hw = e.width / 2;
      // keep out of the crossings at either end (roughly where the junction areas are)
      const margin = Math.min(8, len * 0.2);
      const put = (m: WorkModel, s: number, o: number, fx: number, fz: number, scale = 1, lift = 0) => {
        if (s < margin || s > len - margin) return;
        const x = A.x + ux * s + nx * o, y = A.y + uy * s + ny * o;
        pushMat(out.get(m)!, x, heightAt(w, x, y) + LIFT + lift, y, fx, fz, scale);
      };
      const front = Math.min(1, Math.max(0, e.progress ?? 0)) * len;
      if (e.paving) {
        // survey stakes along both edges of the part still to pave
        for (let s = Math.max(front + 3, 2); s < len - 2; s += 9) {
          put('stake', s, hw + 0.35, ux, uy);
          put('stake', s + 4.5, -(hw + 0.35), ux, uy);
        }
      }
      if (!e.active) continue;
      const side = hash2(e.id, 3, 5) < 0.5 ? 1 : -1; // the lane the machines work in
      const lane = (side * hw) / 2;
      put('paver', front + 1.8, lane, ux, uy);
      put('roller', front - 7 - 2 * hash2(e.id, 4, 5), lane * 0.8, -ux, -uy);
      // cones along the middle of the road around the work zone, closing the lane
      for (let s = front - 16; s <= front + 8; s += 3) put('cone', s, side * 0.4, ux, uy);
      for (let k = 1; k <= 3; k++) put('cone', front + 8 + k * 1.5, side * (0.4 + k * (hw - 1.2) / 3), ux, uy);
      put('barrier', front + 13, lane, ux, uy);
      put('barrier', front - 19, lane, -ux, -uy);
      // road-works signs facing the traffic coming from either end
      put('sign', front - 26, side * (hw + 0.6), -ux, -uy);
      put('sign', front + 22, -side * (hw + 0.6), ux, uy);
      if (len > 40 && hash2(e.id, 6, 5) < 0.6) {
        // an excavator grading the shoulder ahead of the paver
        const a = Math.atan2(uy, ux) + side * 0.5;
        put('excavator', front + 18, side * (hw + 1.6), Math.cos(a), Math.sin(a), 1, 0.02 - LIFT);
      }
    }
    let n = 0;
    for (const [m, data] of out) {
      this.setInstances(this.models.get(m)!, data);
      n += data.length / 16;
    }
    this.worksCount = n;
    this.stats.works = n;
  }

  /** Traffic lights at crossings of finished town streets where an avenue is involved. */
  private placeSignals(juncs: Map<number, Junction>, w: World): void {
    const poles: number[] = [];
    const lens: Record<'A' | 'B', number[]> = { A: [], B: [] };
    for (const j of juncs.values()) {
      const arms = j.arms;
      if (arms.length < 3 || !arms.some((a) => a.e.kind === 'avenue')) continue;
      if (arms.some((a) => a.rough || !a.here)) continue;
      const ref = arms[0].ang;
      for (const a of arms) {
        // one signal per approach, on the corner to the approaching driver's right, facing them
        const lx = -a.dy, ly = a.dx;
        const s = Math.max(a.wl, a.T) + 1.2, o = a.hw + 0.55;
        const x = j.node.x + a.dx * s + lx * o, y = j.node.y + a.dy * s + ly * o;
        const h = heightAt(w, x, y) + LIFT + CURB;
        pushMat(poles, x, h, y, a.dx, a.dy);
        let d = Math.abs(a.ang - ref) % Math.PI;
        if (d > Math.PI / 2) d = Math.PI - d;
        pushMat(d < Math.PI / 4 ? lens.A : lens.B, x, h, y, a.dx, a.dy);
      }
    }
    this.signalCount = poles.length / 16;
    this.setInstances(this.models.get('signal')!, poles);
    for (const name of SIGNAL_LENSES) this.setInstances(this.models.get(name)!, lens[name.endsWith('A') ? 'A' : 'B']);
    this.signalPhase = -1;
  }

  /** 0 day .. 1 night: streetlight heads glow, halos and light pools fade in. */
  setNight(level: number): void {
    this.night = Math.min(1, Math.max(0, level));
    const l = this.night;
    this.headMat.emissiveColor = new Color3(1, 0.82, 0.55).scale(Math.min(1, l * 1.3));
    this.haloMat.alpha = 0.5 * l;
    this.poolMat.alpha = 0.6 * l;
    const on = l > 0.02 && this.lampCount > 0;
    this.halos.setEnabled(on);
    this.pools.setEnabled(on);
  }

  /** Ownership overlay: tint owned lots (null = overlay off). Call again when ownership or lots change. */
  setLotOverlay(lots: Lot[] | null, colorOf: (lot: Lot) => Color3 | null): void {
    if (!lots) {
      this.pendingLots = null;
      this.lotMesh?.setEnabled(false);
      return;
    }
    const w = this.world;
    if (!w) { this.pendingLots = { lots, colorOf }; return; }
    const g = new Geom();
    const col: RGBA = [0, 0, 0, 0];
    for (const lot of lots) {
      const c = colorOf(lot);
      if (!c) continue;
      const fx = Math.cos(lot.angle), fy = Math.sin(lot.angle); // depth axis (toward the road)
      const ux = Math.sin(lot.angle), uy = -Math.cos(lot.angle); // width axis
      // point at (a, b) in lot space: a across the width, b along the depth, both -0.5..0.5
      const vert = (a: number, b: number, inset: number, alpha: number) => {
        const hw = lot.w / 2 - inset, hd = lot.d / 2 - inset;
        const x = lot.x + ux * a * 2 * hw + fx * b * 2 * hd, y = lot.y + uy * a * 2 * hw + fy * b * 2 * hd;
        col[0] = c.r; col[1] = c.g; col[2] = c.b; col[3] = alpha;
        return g.v(x, heightAt(w, x, y) + 0.22, y, 0, 1, 0, col);
      };
      const na = Math.max(1, Math.ceil(lot.w / 9)), nb = Math.max(1, Math.ceil(lot.d / 9));
      // translucent fill
      const grid: number[] = [];
      for (let jb = 0; jb <= nb; jb++) for (let ja = 0; ja <= na; ja++) grid.push(vert(ja / na - 0.5, jb / nb - 0.5, 1.1, 0.3));
      for (let jb = 0; jb < nb; jb++) {
        for (let ja = 0; ja < na; ja++) {
          const i0 = jb * (na + 1) + ja;
          g.quadUp(grid[i0], grid[i0 + 1], grid[i0 + na + 2], grid[i0 + na + 1]);
        }
      }
      // stronger outline
      const ring: [number, number][] = [];
      for (let k = 0; k < na; k++) ring.push([k / na - 0.5, -0.5]);
      for (let k = 0; k < nb; k++) ring.push([0.5, k / nb - 0.5]);
      for (let k = na; k > 0; k--) ring.push([k / na - 0.5, 0.5]);
      for (let k = nb; k > 0; k--) ring.push([-0.5, k / nb - 0.5]);
      const outer = ring.map(([a, b]) => vert(a, b, 0.3, 0.85));
      const inner = ring.map(([a, b]) => vert(a, b, 1.1, 0.85));
      for (let k = 0; k < ring.length; k++) {
        const k2 = (k + 1) % ring.length;
        g.quadUp(outer[k], outer[k2], inner[k2], inner[k]);
      }
    }
    if (!this.lotMesh) {
      this.lotMesh = new Mesh('lotOverlay', this.scene);
      this.lotMesh.material = this.lotMat;
      this.lotMesh.isPickable = false;
      this.lotMesh.hasVertexAlpha = true;
      this.lotMesh.freezeWorldMatrix();
    }
    if (g.ni === 0) { this.lotMesh.setEnabled(false); return; }
    g.vertexData().applyToMesh(this.lotMesh, false);
    this.lotMesh.setEnabled(true);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const c of this.chunks.values()) for (const m of c.meshes) m?.dispose();
    this.chunks.clear();
    this.shadows?.removeShadowCaster(this.poles);
    for (const m of [this.poles, this.heads, this.halos, this.pools]) m.dispose();
    for (const m of this.models.values()) {
      this.shadows?.removeShadowCaster(m);
      m.dispose();
    }
    this.models.clear();
    this.lotMesh?.dispose();
    this.lotMesh = null;
    for (const m of this.mats) m.dispose();
    for (const m of Object.values(this.lensMats)) m.dispose();
    this.propMat.dispose();
    this.poleMat.dispose();
    this.headMat.dispose();
    this.haloMat.dispose();
    this.poolMat.dispose();
    this.poolTex.dispose();
    this.lotMat.dispose();
    this.world = null;
    this.ver = -1;
  }
}
