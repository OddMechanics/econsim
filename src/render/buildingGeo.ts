// Shared low-poly geometry writer and palette for the building, prop and ad
// renderers: a transform stack (translation + yaw), a vertex-color polygon
// writer that emits straight into flat arrays, and the color tables.

import { Color3, Mesh, Scene, VertexData } from '@babylonjs/core';

// ================================================================== colors

export const hx = (s: string): Color3 => Color3.FromHexString(s);

export function hsl(h: number, s: number, l: number): Color3 {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return new Color3(f(0), f(8), f(4));
}

export function mix(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}
export const shade = (c: Color3, k: number): Color3 => new Color3(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const TAU = Math.PI * 2;

export const P = {
  houseWalls: ['#f1e7d3', '#cfe0e3', '#d9e4c8', '#f3dcae', '#efc9b5', '#e7e1d6', '#c9d4e6', '#f0d7d7', '#dcc7a6', '#bfd5c4'].map(hx),
  roofs: ['#a24b36', '#8c4632', '#5d6770', '#47535c', '#7b4b3a', '#9e6a3c', '#3f4f5a', '#6c7a55', '#b5603f'].map(hx),
  doors: ['#7a2e2a', '#2f4f3e', '#2d3e5c', '#6b4a2e', '#a33d2f', '#3d5b6b', '#c9a13b'].map(hx),
  accents: ['#2f4f3e', '#2d3e5c', '#7a2e2a', '#5b6b3a', '#3d5b6b', '#6b4a2e', '#f4f1ea'].map(hx),
  bricks: ['#9c4a35', '#a85a3e', '#8a3f30', '#b0664a', '#7f4a3a', '#a0503c'].map(hx),
  plaster: ['#efe6d2', '#e8d9b8', '#dfe6e0', '#e9d2c0', '#d8dde3', '#f0dcb4', '#e6cfa8', '#d7c9b8', '#c8d3c0'].map(hx),
  officeGlass: ['#4f7896', '#3f6f80', '#5a7fa6', '#46607a', '#6a8a9c', '#557a8a', '#5d6f88'].map(hx),
  struct: ['#ecebe6', '#c9ccd0', '#3f454d', '#d8d2c4', '#a9b0b8'].map(hx),
  indWalls: ['#b8b2a6', '#9aa3a8', '#c4b79c', '#8f9a8a', '#a7a29a', '#b0a493', '#9fa9b4'].map(hx),
  indRoofs: ['#6f767c', '#5b636a', '#7d6a5a', '#8a8f94', '#6a5f58'].map(hx),
  cars: ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#ecf0f1', '#34495e', '#8e44ad', '#e67e22', '#7f8c8d', '#16a085', '#1c2833'].map(hx),
  goods: ['#e74c3c', '#f39c12', '#f1c40f', '#27ae60', '#3498db', '#9b59b6', '#ecf0f1', '#e67e22', '#1abc9c', '#d35400', '#c0392b', '#2980b9'].map(hx),
  fabrics: ['#7a8fb5', '#b5523a', '#d9a441', '#5f8a5a', '#8e6aa8', '#c96a8a', '#e8e0cf'].map(hx),
};

export const C = {
  white: hx('#f4f1ea'), trim: hx('#f2eee6'), cream: hx('#efe4cc'),
  lawn: hx('#6f9a4c'), paving: hx('#bdb8ae'), asphalt: hx('#55585c'), gravel: hx('#a59f92'), dirt: hx('#9b8463'),
  sand: hx('#cdb68a'), concrete: hx('#aaa69e'), stone: hx('#8e8a82'), stoneLight: hx('#c8c1b4'), plaza: hx('#d9cdb8'),
  wood: hx('#8a6440'), woodLight: hx('#b98f5e'), woodDark: hx('#5e4630'), planks: hx('#c9a26b'), log: hx('#7a5532'),
  logEnd: hx('#d2ae7a'), metal: hx('#8d949a'), steel: hx('#b9bec2'), dark: hx('#3a3d42'), iron: hx('#2b2e32'),
  tire: hx('#1f2124'), yellow: hx('#e8b631'), orange: hx('#e07b2e'), red: hx('#b8382f'), glass: hx('#2e3a45'),
  leaf: hx('#4f8a3e'), leafDark: hx('#3d6e33'), leafLight: hx('#7aa84e'), conifer: hx('#2f5e3a'), trunk: hx('#6b4a2e'),
  thatch: hx('#c2a35e'), thatchDark: hx('#a08446'), mud: hx('#a07a52'), brickRed: hx('#b5523a'), clay: hx('#c98a5a'),
  ore: hx('#8a5a40'), coal: hx('#2c2a29'), water: hx('#4a8fb5'), rubble: hx('#7d756a'), soil: hx('#7a5a3c'),
  carpet: hx('#8c97a3'), tile: hx('#e3ddd2'), floorWood: hx('#b78b5c'), shelf: hx('#e9e5dc'), black: hx('#1d1f22'),
  wheat: hx('#d8b94a'), corn: hx('#6f9a3a'), veg: hx('#4e7f3a'), canola: hx('#e3cf3c'), flowerPink: hx('#e58fb0'),
};

/** Day color of an (unlit) window; lit windows look the same by day. */
export const GLASS_DAY = hx('#2e3a45');
export const GLASS_WARMER = hx('#4a4540'); // some lit windows have curtains (a bit lighter by day)
export const OFFICE_BASE = new Color3(0.75, 0.82, 0.9); // diffuse of lit office panes (vertex color = tint / base)
export const WARM = new Color3(1.0, 0.8, 0.46);
export const COOL = new Color3(0.86, 0.93, 1.0);
export const GLOW_ORANGE = new Color3(1.0, 0.5, 0.16);
export const GLOW_BULB = new Color3(1.0, 0.93, 0.72);
export const GLOW_SCREEN = new Color3(0.55, 0.8, 1.0);
export const GLOW_RED = new Color3(1.0, 0.18, 0.12);

// =============================================================== geometry

/** Shared transform stack (translation + rotation about Y) for all buffers of a building. */
export class Xf {
  ox = 0; oy = 0; oz = 0; a = 0; cs = 1; sn = 0;
  private st: number[] = [];
  /** Move the origin to local (x, y, z) and turn by `rot`: afterwards local +Z points along (sin rot, cos rot). */
  push(x: number, y: number, z: number, rot = 0): void {
    this.st.push(this.ox, this.oy, this.oz, this.a);
    const nx = this.ox + x * this.cs + z * this.sn;
    const nz = this.oz - x * this.sn + z * this.cs;
    this.ox = nx; this.oy += y; this.oz = nz; this.a += rot;
    this.cs = Math.cos(this.a); this.sn = Math.sin(this.a);
  }
  pop(): void {
    this.a = this.st.pop()!; this.oz = this.st.pop()!; this.oy = this.st.pop()!; this.ox = this.st.pop()!;
    this.cs = Math.cos(this.a); this.sn = Math.sin(this.a);
  }
}

/**
 * Babylon (left-handed) treats a triangle as front-facing when the standard
 * cross product (p1 - p0) x (p2 - p0) points AWAY from the viewer, so the
 * polygon writer reverses the Newell (right-hand) order.
 */
export const REVERSE = true;
export const DIRT = new Color3(0.42, 0.39, 0.34);

/** Growable scratch buffers for a Geo; recycled after a mesh is made (keeps garbage, and GC pauses, down). */
interface Store { p: Float32Array; n: Float32Array; c: Float32Array; uv: Float32Array; i: Uint32Array }
const POOL: Store[] = [];
const takeStore = (): Store => POOL.pop() ?? { p: new Float32Array(768), n: new Float32Array(768), c: new Float32Array(1024), uv: new Float32Array(512), i: new Uint32Array(1536) };
const giveStore = (st: Store): void => { if (POOL.length < 12 && st.p.length <= 3 * 131072) POOL.push(st); };
const growF = (a: Float32Array, need: number): Float32Array => { if (need <= a.length) return a; let n = a.length * 2; while (n < need) n *= 2; const b = new Float32Array(n); b.set(a); return b; };
const growI = (a: Uint32Array, need: number): Uint32Array => { if (need <= a.length) return a; let n = a.length * 2; while (n < need) n *= 2; const b = new Uint32Array(n); b.set(a); return b; };

export class Geo {
  private s: Store | null = null;
  private nv = 0;
  private ni = 0;
  /** 0..1 weathering: greys and dirties every color written. */
  wear = 0;
  constructor(readonly t: Xf, readonly withUV = false) {}
  get empty(): boolean { return this.ni === 0; }
  get verts(): number { return this.nv; }
  /** Triangles written so far (face ids of the finished mesh, for picking parts of a building). */
  get tris(): number { return this.ni / 3; }
  /** Views of the written data (valid until the next write or `release`). */
  get p(): Float32Array { return this.s ? this.s.p.subarray(0, this.nv * 3) : new Float32Array(0); }
  get n(): Float32Array { return this.s ? this.s.n.subarray(0, this.nv * 3) : new Float32Array(0); }
  get c(): Float32Array { return this.s ? this.s.c.subarray(0, this.nv * 4) : new Float32Array(0); }
  get uv(): Float32Array { return this.s ? this.s.uv.subarray(0, this.nv * 2) : new Float32Array(0); }
  get i(): Uint32Array { return this.s ? this.s.i.subarray(0, this.ni) : new Uint32Array(0); }

  /** Hand the scratch buffers back (the Geo is empty afterwards). */
  release(): void {
    if (this.s) giveStore(this.s);
    this.s = null;
    this.nv = this.ni = 0;
  }

  /** Flat rectangle facing +Z in the current frame, at depth z. */
  rect(x0: number, y0: number, x1: number, y1: number, z: number, col: Color3): void {
    this.poly([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], col, 0, 0, 1);
  }

  /** Convex planar polygon (flat xyz list) in the current frame; (hx, hy, hz) = rough outward direction. */
  poly(pts: number[], col: Color3, hx_: number, hy: number, hz: number, uvs?: number[]): void {
    const k = pts.length / 3;
    let nx = 0, ny = 0, nz = 0;
    for (let a = 0; a < k; a++) {
      const b = a + 1 === k ? 0 : a + 1;
      const ax = pts[a * 3], ay = pts[a * 3 + 1], az = pts[a * 3 + 2];
      const bx = pts[b * 3], by = pts[b * 3 + 1], bz = pts[b * 3 + 2];
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    let rev = false;
    if (nx * hx_ + ny * hy + nz * hz < 0) { nx = -nx; ny = -ny; nz = -nz; rev = true; }
    const t = this.t;
    const base = this.nv;
    const st = this.s ?? (this.s = takeStore());
    const nt = (k - 2) * 3;
    if ((base + k) * 3 > st.p.length) {
      st.p = growF(st.p, (base + k) * 3); st.n = growF(st.n, (base + k) * 3); st.c = growF(st.c, (base + k) * 4);
      if (this.withUV) st.uv = growF(st.uv, (base + k) * 2);
    }
    if (this.withUV && (base + k) * 2 > st.uv.length) st.uv = growF(st.uv, (base + k) * 2);
    if (this.ni + nt > st.i.length) st.i = growI(st.i, this.ni + nt);
    let r = col.r, g = col.g, bl = col.b;
    if (this.wear > 0.01) {
      const w = this.wear, l = 0.3 * r + 0.59 * g + 0.11 * bl;
      r = lerp(lerp(r, l, w * 0.55), DIRT.r, w * 0.3);
      g = lerp(lerp(g, l, w * 0.55), DIRT.g, w * 0.3);
      bl = lerp(lerp(bl, l, w * 0.55), DIRT.b, w * 0.3);
    }
    const NX = nx * t.cs + nz * t.sn, NZ = -nx * t.sn + nz * t.cs;
    const P = st.p, N = st.n, Cc = st.c, UV = st.uv;
    for (let a = 0; a < k; a++) {
      const x = pts[a * 3], y = pts[a * 3 + 1], z = pts[a * 3 + 2];
      const o = (base + a) * 3, q = (base + a) * 4;
      P[o] = t.ox + x * t.cs + z * t.sn; P[o + 1] = t.oy + y; P[o + 2] = t.oz - x * t.sn + z * t.cs;
      N[o] = NX; N[o + 1] = ny; N[o + 2] = NZ;
      Cc[q] = r; Cc[q + 1] = g; Cc[q + 2] = bl; Cc[q + 3] = 1;
      if (this.withUV) { const u = (base + a) * 2; UV[u] = uvs ? uvs[a * 2] : 0; UV[u + 1] = uvs ? uvs[a * 2 + 1] : 0; }
    }
    this.nv += k;
    const I = st.i;
    let ii = this.ni;
    const flip = REVERSE !== rev;
    for (let a = 1; a < k - 1; a++) {
      if (flip) { I[ii++] = base; I[ii++] = base + a + 1; I[ii++] = base + a; }
      else { I[ii++] = base; I[ii++] = base + a; I[ii++] = base + a + 1; }
    }
    this.ni = ii;
  }

  quad(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number, col: Color3, hx_: number, hy: number, hz: number): void {
    this.poly([x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3], col, hx_, hy, hz);
  }

  tri(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
    col: Color3, hx_: number, hy: number, hz: number): void {
    this.poly([x0, y0, z0, x1, y1, z1, x2, y2, z2], col, hx_, hy, hz);
  }

  /** Axis-aligned box: center x/z, bottom at y. The bottom face is skipped unless asked for (rarely visible). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, col: Color3, rot = 0, bottom = false): void {
    if (rot !== 0) {
      this.t.push(x, 0, z, rot);
      this.box(0, y, 0, w, h, d, col, 0, bottom);
      this.t.pop();
      return;
    }
    const a = x - w / 2, b = x + w / 2, y1 = y + h, f = z + d / 2, k = z - d / 2;
    this.quad(a, y, f, b, y, f, b, y1, f, a, y1, f, col, 0, 0, 1);
    this.quad(b, y, k, a, y, k, a, y1, k, b, y1, k, col, 0, 0, -1);
    this.quad(b, y, f, b, y, k, b, y1, k, b, y1, f, col, 1, 0, 0);
    this.quad(a, y, k, a, y, f, a, y1, f, a, y1, k, col, -1, 0, 0);
    this.quad(a, y1, f, b, y1, f, b, y1, k, a, y1, k, col, 0, 1, 0);
    if (bottom) this.quad(a, y, k, b, y, k, b, y, f, a, y, f, col, 0, -1, 0);
  }

  /** Vertical (truncated) cylinder / cone, flat shaded. */
  cyl(x: number, y: number, z: number, rb: number, rt: number, h: number, seg: number, col: Color3, rot = 0, caps = true, capCol?: Color3): void {
    for (let s = 0; s < seg; s++) {
      const a0 = rot + (s / seg) * TAU, a1 = rot + ((s + 1) / seg) * TAU, am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const hxm = Math.cos(am), hzm = Math.sin(am);
      if (rt > 0.0001) this.quad(x + c0 * rb, y, z + s0 * rb, x + c1 * rb, y, z + s1 * rb, x + c1 * rt, y + h, z + s1 * rt, x + c0 * rt, y + h, z + s0 * rt, col, hxm, 0.2, hzm);
      else this.tri(x + c0 * rb, y, z + s0 * rb, x + c1 * rb, y, z + s1 * rb, x, y + h, z, col, hxm, 0.3, hzm);
    }
    if (!caps) return;
    if (rt > 0.0001) {
      const top: number[] = [];
      for (let s = 0; s < seg; s++) { const a = rot + (s / seg) * TAU; top.push(x + Math.cos(a) * rt, y + h, z + Math.sin(a) * rt); }
      this.poly(top, capCol ?? col, 0, 1, 0);
    }
    if (rb > 0.0001 && y > 0.06) {
      const bot: number[] = [];
      for (let s = 0; s < seg; s++) { const a = rot + (s / seg) * TAU; bot.push(x + Math.cos(a) * rb, y, z + Math.sin(a) * rb); }
      this.poly(bot, col, 0, -1, 0);
    }
  }

  /** Cylinder between two points (any orientation). r2 = radius at b. */
  tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg: number, col: Color3, caps = true, r2 = r, capCol?: Color3): void {
    let ux = bx - ax, uy = by - ay, uz = bz - az;
    const len = Math.hypot(ux, uy, uz);
    if (len < 1e-6) return;
    ux /= len; uy /= len; uz /= len;
    // perpendicular basis
    let hx_ = 0, hy = 1, hz = 0;
    if (Math.abs(uy) > 0.9) { hx_ = 1; hy = 0; }
    let vx = uy * hz - uz * hy, vy = uz * hx_ - ux * hz, vz = ux * hy - uy * hx_;
    const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    const ra: number[] = [], rb: number[] = [];
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * TAU + Math.PI / seg;
      const dx = vx * Math.cos(a) + wx * Math.sin(a), dy = vy * Math.cos(a) + wy * Math.sin(a), dz = vz * Math.cos(a) + wz * Math.sin(a);
      ra.push(ax + dx * r, ay + dy * r, az + dz * r);
      rb.push(bx + dx * r2, by + dy * r2, bz + dz * r2);
    }
    for (let s = 0; s < seg; s++) {
      const q = (s + 1) % seg;
      const mx = (ra[s * 3] + ra[q * 3]) / 2 - ax, my = (ra[s * 3 + 1] + ra[q * 3 + 1]) / 2 - ay, mz = (ra[s * 3 + 2] + ra[q * 3 + 2]) / 2 - az;
      this.quad(ra[s * 3], ra[s * 3 + 1], ra[s * 3 + 2], ra[q * 3], ra[q * 3 + 1], ra[q * 3 + 2],
        rb[q * 3], rb[q * 3 + 1], rb[q * 3 + 2], rb[s * 3], rb[s * 3 + 1], rb[s * 3 + 2], col, mx, my, mz);
    }
    if (caps) {
      this.poly(ra, capCol ?? col, -ux, -uy, -uz);
      this.poly(rb, capCol ?? col, ux, uy, uz);
    }
  }

  /** Square-section beam between two points. */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, col: Color3): void {
    this.tube(ax, ay, az, bx, by, bz, t * 0.7071, 4, col, true);
  }

  /** Low-poly ellipsoid (flat shaded). `top` = only the upper half (domes). */
  blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, col: Color3, seg = 7, rings = 4, top = false, rot = 0.3): void {
    const r0 = top ? Math.floor(rings / 2) : 0;
    const pt = (i: number, j: number): [number, number, number] => {
      const phi = -Math.PI / 2 + (i / rings) * Math.PI;
      const th = rot + (j / seg) * TAU;
      return [x + Math.cos(phi) * Math.cos(th) * rx, y + Math.sin(phi) * ry, z + Math.cos(phi) * Math.sin(th) * rz];
    };
    for (let i = r0; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
        const mx = (a[0] + c[0]) / 2 - x, my = (a[1] + c[1]) / 2 - y, mz = (a[2] + c[2]) / 2 - z;
        if (i === 0) this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col, mx, my, mz);
        else if (i === rings - 1) this.tri(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2], col, mx, my, mz);
        else this.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], col, mx, my, mz);
      }
    }
  }

  /** A thin slab whose top surface is the given quad, extruded `th` against `up`. */
  slab(pts: number[], th: number, col: Color3, ux = 0, uy = 1, uz = 0, under?: Color3): void {
    // normal of the top face, oriented toward `up`
    const ax = pts[3] - pts[0], ay = pts[4] - pts[1], az = pts[5] - pts[2];
    const bx = pts[9] - pts[0], by = pts[10] - pts[1], bz = pts[11] - pts[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * ux + ny * uy + nz * uz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const bot: number[] = [];
    for (let k = 0; k < 4; k++) bot.push(pts[k * 3] - nx * th, pts[k * 3 + 1] - ny * th, pts[k * 3 + 2] - nz * th);
    this.poly(pts, col, nx, ny, nz);
    this.poly(bot, under ?? col, -nx, -ny, -nz);
    const cx = (pts[0] + pts[3] + pts[6] + pts[9]) / 4, cy = (pts[1] + pts[4] + pts[7] + pts[10]) / 4, cz = (pts[2] + pts[5] + pts[8] + pts[11]) / 4;
    for (let k = 0; k < 4; k++) {
      const q = (k + 1) % 4;
      const mx = (pts[k * 3] + pts[q * 3]) / 2 - cx, my = (pts[k * 3 + 1] + pts[q * 3 + 1]) / 2 - cy, mz = (pts[k * 3 + 2] + pts[q * 3 + 2]) / 2 - cz;
      this.quad(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], pts[q * 3], pts[q * 3 + 1], pts[q * 3 + 2],
        bot[q * 3], bot[q * 3 + 1], bot[q * 3 + 2], bot[k * 3], bot[k * 3 + 1], bot[k * 3 + 2], col, mx, my, mz);
    }
  }

  /** Make a mesh from what was written (exact-size copies), then recycle the scratch buffers. */
  toMesh(name: string, scene: Scene, colors = true): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    const st = this.s;
    if (st) {
      const nv = this.nv, ni = this.ni;
      vd.positions = st.p.slice(0, nv * 3);
      vd.normals = st.n.slice(0, nv * 3);
      if (colors) vd.colors = st.c.slice(0, nv * 4);
      if (this.withUV) vd.uvs = st.uv.slice(0, nv * 2);
      vd.indices = nv > 65000 ? st.i.slice(0, ni) : new Uint16Array(st.i.subarray(0, ni));
      vd.applyToMesh(m, false);
    }
    this.release();
    return m;
  }
}


// ========================================================== lit surfaces

/**
 * Windows, lamps, screens and crown lights of a building all go into ONE
 * buffer drawn with one material (one draw call). Each surface picks a
 * lighting state through its UV: the material's emissive texture is a row of
 * texels, one per state, rewritten as the hour and the night level change
 * (offices empty out in the evening, flats light up, then most go dark late).
 * The material's diffuse is dark (WIN_BASE) and vertex colors are scaled up
 * by 1/WIN_BASE, so by day a surface shows its own color, and at night the
 * emissive state (multiplied by the vertex color) makes it glow.
 */
export const WIN_STATES = 16;
export const WS = {
  dark: 0, // never lit (empty rooms, papered shop windows, solar panels, water)
  resA: 1, // flat: lit in the evening until ~23:00
  resB: 2, // flat: night owls, until ~1:30
  resC: 3, // flat: early evening and early morning (families with kids)
  resAll: 4, // flat: a night light, lit all night
  offA: 5, // office: until ~20:00
  offB: 6, // office: overtime, until ~23:00
  offAll: 7, // office: cleaners and server rooms, all night
  shop: 8, // shop windows: bright until closing, then display lights
  lobby: 9, // lobbies, stairwells, garage entrances: all night
  lamp: 10, // lamps, signs' halos, LED strips: their own color, at night
  screen: 11, // screens: their own color, day and night
  crown: 12, // floodlit crowns and spires: own color, a bit brighter
  security: 13, // vacant floors: a few dim lights all night
  tv: 14, // a flat lit by the TV: flickering blue
  blink: 15, // indicator LEDs / beacons: blinking
} as const;
export type WinState = (typeof WS)[keyof typeof WS];
/** Diffuse of the lit-surface material; vertex colors are divided by it. */
export const WIN_BASE = 0.25;

const UV_CACHE: number[][][] = [];
function stateUVs(state: number, k: number): number[] {
  const row = (UV_CACHE[state] ??= []);
  let uv = row[k];
  if (!uv) {
    uv = [];
    const u = (state + 0.5) / WIN_STATES;
    for (let i = 0; i < k; i++) uv.push(u, 0.5);
    row[k] = uv;
  }
  return uv;
}

/**
 * A view of the lit-surface buffer with a fixed lighting state: write boxes,
 * cylinders, polygons... through it as through any Geo. `gain` scales the
 * vertex color (1 = shows its color by day; curtains behind glass use less).
 */
export class Lit extends Geo {
  private tmp = new Color3();
  constructor(readonly dst: Geo, readonly state: number, readonly gain = 1 / WIN_BASE) { super(dst.t, false); }
  override get empty(): boolean { return true; }
  override poly(pts: number[], col: Color3, hx_: number, hy: number, hz: number): void {
    const k = this.gain;
    this.tmp.set(col.r * k, col.g * k, col.b * k);
    this.dst.poly(pts, this.tmp, hx_, hy, hz, stateUVs(this.state, pts.length / 3));
  }
}

/** The main interior volume of a building (cutaway slabs, room layout). `base` = height of the ground-floor surface. */
export interface Body {
  cx: number; cz: number; w: number; d: number; storey: number; floors: number; floor: Color3; base?: number;
  /** Upper floors cover only this depth band (e.g. a TV studio's newsroom over a tall sound stage). */
  upper?: { cz: number; d: number };
}
