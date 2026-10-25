// Trees in the countryside's woods and boulders on its rocky outcrops, and the
// level of detail for all trees (the city square's too).
//
// The city's square draws its nature per tile from the world's stocks (see
// terrain.ts placeNature); out here nothing is stored, so the woods come from
// the same formulas the sim uses (`kindAt`): a jittered 5 m lattice, as dense
// as the square's woods along its edge (so they carry on across the border),
// thinning to bigger, sparser trees over the first ~500 m. Trees keep off
// roads and off lots someone has built on (a farm clears its fields).
//
// Level of detail (TreeLod): the map is cut into 250 m cells, each keeping
// its tree instances (a matrix and a tint each, per species). Cells near the
// camera draw the detailed tree templates; all others draw two small
// stand-ins (6 and 10 triangles), whose buffers hold every tree with the near
// cells' ranges zeroed out, so a cell switching detail is a small partial
// buffer update. Countryside cells are rebuilt only when the roads or built
// lots inside them change.

import { BoundingInfo, Color3, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexData } from '@babylonjs/core';
import { MAP } from '../sim/config';
import { hash2 } from '../sim/rng';
import type { Lot, RoadNode, Roads, TileKind, World } from '../sim/types';
import { beyondGrid, fbm, inGrid, onLand } from '../sim/world';
import { Buf, makeTemplate, merge, paint, pushTilt, pushYaw, rgb, smoothstep } from './natureKit';

/** Cell size of the level of detail (m); the city's square (0..2000) is 8 x 8 of them. */
export const LOD_CELL = 250;
const CELL = LOD_CELL;
const NC = Math.ceil((MAP.max - MAP.min) / CELL);
const LATTICE = 5; // tree lattice spacing (m), as the square's 4 trees per 10 m tile
const ROCK_LATTICE = 7;
const BLOCK = 25; // coarse pre-test of the ground kind
/** Detailed trees within this distance of the camera (m); hysteresis to the second value. */
const NEAR_IN = 400, NEAR_OUT = 480;

/** Species of the tree templates: conifer, oak, birch. */
export const SPECIES = 3;

function prepMesh(m: Mesh, mat: StandardMaterial, shadows: ShadowGenerator | null, cast: boolean, receive: boolean): Mesh {
  m.material = mat;
  m.isPickable = false;
  m.receiveShadows = receive;
  m.isVisible = false;
  m.freezeWorldMatrix();
  m.doNotSyncBoundingInfo = true;
  m.setBoundingInfo(new BoundingInfo(new Vector3(MAP.min, -20, MAP.min), new Vector3(MAP.max, 140, MAP.max)));
  if (cast && shadows) shadows.addShadowCaster(m);
  return m;
}

/**
 * Far stand-ins, sized like the detailed templates: a five-sided cone for the
 * conifers, a five-sided double cone (its lower tip reads as the trunk) for
 * the broadleaf trees.
 */
function farTemplate(scene: Scene, kind: 'con' | 'broad'): Mesh {
  if (kind === 'con') {
    const c = MeshBuilder.CreateCylinder('c', { diameterTop: 0, diameterBottom: 3.5, height: 6.9, tessellation: 5, cap: Mesh.NO_CAP }, scene);
    c.position.y = 0.6 + 3.45;
    c.bakeCurrentTransformIntoVertices();
    return merge([paint(c, rgb('#33653a'))], 'coniferFar', false);
  }
  // 5-sided bipyramid: bottom tip 1.4, rim 4.5 (radius 2.3), top 6.7
  const pos: number[] = [0, 1.4, 0, 0, 6.7, 0];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; pos.push(Math.cos(a) * 2.3, 4.5, Math.sin(a) * 2.3); }
  const idx: number[] = [];
  for (let k = 0; k < 5; k++) { const a = 2 + k, b = 2 + ((k + 1) % 5); idx.push(1, b, a, 0, a, b); }
  const m = new Mesh('broadFar', scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = [];
  VertexData.ComputeNormals(pos, idx, vd.normals);
  vd.applyToMesh(m);
  return paint(m, rgb('#558f3d'));
}

/** A cell's level of detail: detailed trees, stand-ins that cast shadows (in the shadowed area), stand-ins that don't. */
const enum Lod { Near = 0, Shadowed = 1, Far = 2 }

interface LodCell { x0: number; y0: number; trees: Buf[]; lod: Lod; farAt: [number, number] }

/**
 * Tree instances by 250 m cell, drawn in detail near the camera and as
 * stand-ins elsewhere (see the file comment). Stand-ins only cast shadows in
 * cells the shadow map covers.
 */
export class TreeLod {
  private readonly cells = new Map<number, LodCell>();
  private readonly near: Mesh[] = [];
  /** Stand-ins: [casting, not casting][conifer, broadleaf]. */
  private readonly far: Mesh[][] = [[], []];
  private readonly mats: StandardMaterial[] = [];
  /** The non-casting stand-ins' buffers (every tree, zeros where a cell is drawn otherwise); [1][conifer | broadleaf]. */
  private farData: { m: Float32Array; c: Float32Array; n: number }[][] = [[], []];
  private dirty = false;
  private camKey = '';
  /** Trees in all, and drawn in detail. */
  trees = 0;
  nearTrees = 0;
  /** Testing: draw every tree in detail (as before the level of detail existed). */
  allNear = false;

  constructor(scene: Scene, private readonly shadows: ShadowGenerator | null, name: string, private readonly nearMax: number) {
    const mat = (n: string): StandardMaterial => {
      const m = new StandardMaterial(n, scene);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      this.mats.push(m);
      return m;
    };
    for (const id of ['conifer', 'oak', 'birch'] as const) this.near.push(prepMesh(makeTemplate(scene, id), mat(`${name}-${id}`), shadows, true, true));
    const farMat = mat(`${name}-far`);
    // (stand-ins don't receive shadows)
    for (const cast of [true, false]) {
      const set = this.far[cast ? 0 : 1];
      set.push(prepMesh(farTemplate(scene, 'con'), farMat, shadows, cast, false), prepMesh(farTemplate(scene, 'broad'), farMat, shadows, cast, false));
    }
  }

  /** Replace a cell's trees (per species buffers; they're kept, don't reuse them). */
  put(key: number, x0: number, y0: number, trees: Buf[]): void {
    const old = this.cells.get(key);
    this.cells.set(key, { x0, y0, trees, lod: old?.lod ?? Lod.Far, farAt: [0, 0] });
    this.dirty = true;
  }

  remove(key: number): void {
    if (this.cells.delete(key)) this.dirty = true;
  }

  clear(): void {
    this.cells.clear();
    this.dirty = true;
  }

  /** Apply `put`/`remove` calls (lays the far buffers out again). */
  commit(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const counts = [0, 0];
    for (const c of this.cells.values()) {
      c.farAt = [counts[0], counts[1]];
      counts[0] += c.trees[0].n;
      counts[1] += c.trees[1].n + c.trees[2].n;
    }
    this.trees = counts[0] + counts[1];
    this.farData[1] = counts.map((n) => ({ m: new Float32Array(Math.max(1, n) * 16), c: new Float32Array(Math.max(1, n) * 4), n }));
    for (const c of this.cells.values()) this.writeFar(c, false);
    for (let k = 0; k < 2; k++) {
      const f = this.farData[1][k], m = this.far[1][k];
      m.isVisible = f.n > 0;
      if (!f.n) continue;
      m.thinInstanceSetBuffer('matrix', f.m, 16, false);
      m.thinInstanceSetBuffer('color', f.c, 4, false);
    }
    this.fillCast();
    this.fillNear();
  }

  /**
   * Detail near the camera, stand-ins elsewhere; stand-ins cast shadows only
   * within `shadowR` of `target` (the shadow map's area; 0 when shadows are off).
   */
  update(cam: Vector3, target: Vector3, shadowR: number, force = false): void {
    if (!this.cells.size) return;
    const key = `${Math.round(cam.x / 15)},${Math.round(cam.y / 15)},${Math.round(cam.z / 15)}|${Math.round(target.x / 40)},${Math.round(target.z / 40)},${Math.round(shadowR / 40)}`;
    if (key === this.camKey && !force) return;
    this.camKey = key;
    // nearest cells first, within the radius (hysteresis), up to the budget
    const cand: { c: LodCell; d: number }[] = [];
    for (const c of this.cells.values()) {
      const dx = Math.max(c.x0 - cam.x, 0, cam.x - (c.x0 + CELL)), dz = Math.max(c.y0 - cam.z, 0, cam.z - (c.y0 + CELL));
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - 15));
      if (this.allNear || d < (c.lod === Lod.Near ? NEAR_OUT : NEAR_IN)) cand.push({ c, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const near = new Set<LodCell>();
    let n = 0;
    for (const { c } of cand) {
      const cn = c.trees[0].n + c.trees[1].n + c.trees[2].n;
      if (n + cn > this.nearMax && near.size && !this.allNear) break;
      near.add(c);
      n += cn;
    }
    let changed = false, shadowed = false;
    for (const c of this.cells.values()) {
      let lod = Lod.Far;
      if (near.has(c)) lod = Lod.Near;
      else if (shadowR > 0) {
        const dx = Math.max(c.x0 - target.x, 0, target.x - (c.x0 + CELL)), dz = Math.max(c.y0 - target.z, 0, target.z - (c.y0 + CELL));
        if (Math.hypot(dx, dz) < shadowR + 40) lod = Lod.Shadowed;
      }
      if (lod === c.lod) continue;
      const was = c.lod;
      c.lod = lod;
      if ((was === Lod.Far) !== (lod === Lod.Far)) this.writeFar(c, true);
      if (was === Lod.Near || lod === Lod.Near) changed = true;
      if (was === Lod.Shadowed || lod === Lod.Shadowed) shadowed = true;
    }
    if (changed) this.fillNear();
    if (shadowed) this.fillCast();
  }

  dispose(): void {
    for (const m of [...this.near, ...this.far[0], ...this.far[1]]) {
      this.shadows?.removeShadowCaster(m);
      m.dispose();
    }
    for (const m of this.mats) m.dispose();
  }

  /**
   * Write a cell's ranges of the (full-layout) non-casting stand-in buffers:
   * its trees while it's far, nothing (zero matrices) otherwise.
   */
  private writeFar(c: LodCell, upload: boolean): void {
    const parts: [number, Buf[]][] = [[0, [c.trees[0]]], [1, [c.trees[1], c.trees[2]]]];
    const show = c.lod === Lod.Far;
    for (const [k, bufs] of parts) {
      const f = this.farData[1][k];
      if (!f) continue;
      let at = c.farAt[k];
      const from = at;
      for (const b of bufs) {
        if (!show) f.m.fill(0, at * 16, (at + b.n) * 16);
        else {
          f.m.set(b.m.subarray(0, b.n * 16), at * 16);
          f.c.set(b.c.subarray(0, b.n * 4), at * 4);
        }
        at += b.n;
      }
      if (upload && at > from && f.n) {
        this.far[1][k].thinInstancePartialBufferUpdate('matrix', f.m.subarray(from * 16, at * 16), from * 16);
        if (show) this.far[1][k].thinInstancePartialBufferUpdate('color', f.c.subarray(from * 4, at * 4), from * 4);
      }
    }
  }

  /** The casting stand-ins: the trees of the shadowed cells, packed (a few thousand). */
  private fillCast(): void {
    for (let k = 0; k < 2; k++) {
      const species = k === 0 ? [0] : [1, 2];
      let n = 0;
      for (const c of this.cells.values()) if (c.lod === Lod.Shadowed) for (const sp of species) n += c.trees[sp].n;
      const mesh = this.far[0][k];
      mesh.isVisible = n > 0;
      if (!n) continue;
      const m = new Float32Array(n * 16), col = new Float32Array(n * 4);
      let at = 0;
      for (const c of this.cells.values()) {
        if (c.lod !== Lod.Shadowed) continue;
        for (const sp of species) {
          const b = c.trees[sp];
          m.set(b.m.subarray(0, b.n * 16), at * 16);
          col.set(b.c.subarray(0, b.n * 4), at * 4);
          at += b.n;
        }
      }
      mesh.thinInstanceSetBuffer('matrix', m, 16, true);
      mesh.thinInstanceSetBuffer('color', col, 4, true);
    }
  }

  /** Detailed trees of the near cells. */
  private fillNear(): void {
    let total = 0;
    for (let sp = 0; sp < SPECIES; sp++) {
      let n = 0;
      for (const c of this.cells.values()) if (c.lod === Lod.Near) n += c.trees[sp].n;
      const mesh = this.near[sp];
      mesh.isVisible = n > 0;
      total += n;
      if (!n) continue;
      const m = new Float32Array(n * 16), col = new Float32Array(n * 4);
      let at = 0;
      for (const c of this.cells.values()) {
        if (c.lod !== Lod.Near) continue;
        const b = c.trees[sp];
        m.set(b.m.subarray(0, b.n * 16), at * 16);
        col.set(b.c.subarray(0, b.n * 4), at * 4);
        at += b.n;
      }
      mesh.thinInstanceSetBuffer('matrix', m, 16, true);
      mesh.thinInstanceSetBuffer('color', col, 4, true);
    }
    this.nearTrees = total;
  }
}

// ------------------------------------------------------------ countryside

/** A road segment to keep clear of: a→b and the clearance from its centerline. */
interface Seg { ax: number; ay: number; bx: number; by: number; r: number; id: number }
/** A built lot to keep clear of. */
interface Clear { x: number; y: number; c: number; s: number; hd: number; hw: number; id: number }
interface Cell { sig: string; rocks: Buf; built: boolean }

function distSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / l2)) : 0;
  return Math.hypot(px - s.ax - dx * t, py - s.ay - dy * t);
}

export class CountryNature {
  private world: World | null = null;
  private seed = 0;
  private readonly cells = new Map<number, Cell>();
  private readonly lod: TreeLod;
  private readonly rockMesh: Mesh;
  private readonly rockMat: StandardMaterial;
  private obstacleKey = '';
  /** Last build: cells, trees, rocks and how long the first one took (ms); trees drawn in detail. */
  stats = { cells: 0, trees: 0, rocks: 0, buildMs: 0, near: 0 };

  constructor(
    scene: Scene, private readonly shadows: ShadowGenerator | null,
    /** Height of the drawn ground, and what grows there (see TerrainRenderer.groundY / natureKind). */
    private readonly groundY: (x: number, y: number) => number, private readonly kindOf: (x: number, y: number) => TileKind,
  ) {
    this.lod = new TreeLod(scene, shadows, 'cn', 7000);
    this.rockMat = new StandardMaterial('cn-rock', scene);
    this.rockMat.specularColor = new Color3(0.04, 0.04, 0.04);
    this.rockMesh = prepMesh(makeTemplate(scene, 'rock'), this.rockMat, shadows, true, true);
  }

  /** A different world (new game / loaded save): everything is rebuilt on the next sync. */
  setWorld(world: World, seed: number): void {
    this.world = world;
    this.seed = seed;
    this.cells.clear();
    this.lod.clear();
    this.lod.commit();
    this.obstacleKey = '';
    this.rockMesh.isVisible = false;
  }

  /**
   * Keep the woods clear of the roads and the built-on lots (call every few
   * seconds; cells whose obstacles changed are rebuilt).
   */
  sync(roads: Roads, nodeById: Map<number, RoadNode>, lots: Lot[]): void {
    const w = this.world;
    if (!w) return;
    let lotSum = 0, lotN = 0;
    for (const l of lots) if (l.building >= 0) { lotSum += l.id * 7 + l.building; lotN++; }
    const key = `${roads.ver}|${roads.edges.length}|${lotN}|${lotSum}`;
    if (key === this.obstacleKey) return;
    this.obstacleKey = key;
    const t0 = performance.now();
    const fresh = !this.cells.size;
    // obstacles outside the square
    const segs: Seg[] = [];
    for (const e of roads.edges) {
      const a = nodeById.get(e.a), b = nodeById.get(e.b);
      if (!a || !b) continue;
      if (inGrid(w, a.x, a.y) && inGrid(w, b.x, b.y)) continue;
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, r: e.width / 2 + 5.5, id: e.id });
    }
    const clears: Clear[] = [];
    const S = w.size * w.tile;
    for (const l of lots) {
      if (l.building < 0) continue;
      const r = Math.hypot(l.w, l.d) / 2;
      if (l.x - r > 0 && l.y - r > 0 && l.x + r < S && l.y + r < S) continue; // well inside the square
      clears.push({ x: l.x, y: l.y, c: Math.cos(l.angle), s: Math.sin(l.angle), hd: l.d / 2 + 3, hw: l.w / 2 + 3, id: l.id });
    }
    // which obstacles touch which cell
    const segIn = new Map<number, Seg[]>(), lotIn = new Map<number, Clear[]>();
    const bin = <T>(map: Map<number, T[]>, x0: number, y0: number, x1: number, y1: number, item: T) => {
      const i0 = Math.max(0, Math.floor((x0 - MAP.min) / CELL)), i1 = Math.min(NC - 1, Math.floor((x1 - MAP.min) / CELL));
      const j0 = Math.max(0, Math.floor((y0 - MAP.min) / CELL)), j1 = Math.min(NC - 1, Math.floor((y1 - MAP.min) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * NC + i;
        const arr = map.get(k);
        if (arr) arr.push(item); else map.set(k, [item]);
      }
    };
    for (const s of segs) bin(segIn, Math.min(s.ax, s.bx) - s.r - 4, Math.min(s.ay, s.by) - s.r - 4, Math.max(s.ax, s.bx) + s.r + 4, Math.max(s.ay, s.by) + s.r + 4, s);
    for (const c of clears) { const r = Math.hypot(c.hd, c.hw) + 4; bin(lotIn, c.x - r, c.y - r, c.x + r, c.y + r, c); }
    let rebuilt = 0;
    for (let j = 0; j < NC; j++) {
      for (let i = 0; i < NC; i++) {
        const k = j * NC + i;
        const x0 = MAP.min + i * CELL, y0 = MAP.min + j * CELL;
        // cells on the city's square: its own nature (terrain.ts)
        if (inGrid(w, x0 + 1, y0 + 1) && inGrid(w, x0 + CELL - 1, y0 + CELL - 1)) continue;
        const sg = segIn.get(k), lt = lotIn.get(k);
        const sig = (sg ? sg.map((s) => `${s.id}:${Math.round(s.ax)},${Math.round(s.ay)},${Math.round(s.bx)},${Math.round(s.by)}`).join(';') : '') + '|' + (lt ? lt.map((c) => c.id).join(',') : '');
        let cell = this.cells.get(k);
        if (!cell) { cell = { sig: '', rocks: new Buf(), built: false }; this.cells.set(k, cell); }
        if (cell.sig === sig && cell.built) continue;
        cell.sig = sig;
        const trees = [new Buf(), new Buf(), new Buf()];
        cell.rocks = new Buf();
        cell.built = true;
        this.buildCell(x0, y0, trees, cell.rocks, sg ?? [], lt ?? []);
        if (trees[0].n + trees[1].n + trees[2].n) this.lod.put(k, x0, y0, trees); else this.lod.remove(k);
        rebuilt++;
      }
    }
    if (!rebuilt) return;
    this.lod.commit();
    // rocks: one static buffer
    const rb = new Buf();
    for (const c of this.cells.values()) {
      for (let i = 0; i < c.rocks.n; i++) {
        const k = rb.next();
        rb.m.set(c.rocks.m.subarray(i * 16, i * 16 + 16), k * 16);
        rb.c.set(c.rocks.c.subarray(i * 4, i * 4 + 4), k * 4);
      }
    }
    this.rockMesh.isVisible = rb.n > 0;
    if (rb.n) {
      this.rockMesh.thinInstanceSetBuffer('matrix', rb.m.slice(0, rb.n * 16), 16, true);
      this.rockMesh.thinInstanceSetBuffer('color', rb.c.slice(0, rb.n * 4), 4, true);
    }
    this.stats.cells = this.cells.size;
    this.stats.trees = this.lod.trees;
    this.stats.rocks = rb.n;
    if (fresh) this.stats.buildMs = performance.now() - t0;
  }

  /** Detail near the camera, stand-ins elsewhere (see TreeLod.update). */
  update(cam: Vector3, target: Vector3, shadowR: number): void {
    this.lod.update(cam, target, shadowR);
    this.stats.near = this.lod.nearTrees;
  }

  dispose(): void {
    this.lod.dispose();
    this.shadows?.removeShadowCaster(this.rockMesh);
    this.rockMesh.dispose();
    this.rockMat.dispose();
  }

  // ---------------------------------------------------------------- build

  private buildCell(x0: number, y0: number, trees: Buf[], rocks: Buf, segs: Seg[], clears: Clear[]): void {
    const w = this.world!;
    const s = this.seed;
    const blocked = (x: number, y: number, extra: number): boolean => {
      for (const sg of segs) if (distSeg(x, y, sg) < sg.r + extra) return true;
      for (const c of clears) {
        const dx = x - c.x, dy = y - c.y;
        if (Math.abs(dx * c.c + dy * c.s) < c.hd + extra && Math.abs(-dx * c.s + dy * c.c) < c.hw + extra) return true;
      }
      return false;
    };
    for (let by = 0; by < CELL; by += BLOCK) {
      for (let bx = 0; bx < CELL; bx += BLOCK) {
        const X = x0 + bx, Y = y0 + by;
        // a quick look at the block: skip open grass
        let any = false;
        for (const [ox, oy] of [[0, 0], [BLOCK, 0], [0, BLOCK], [BLOCK, BLOCK], [BLOCK / 2, BLOCK / 2]]) {
          const k = this.kindOf(X + ox, Y + oy);
          if (k === 'forest' || k === 'rock') { any = true; break; }
        }
        if (!any) continue;
        // trees on the 5 m lattice
        for (let v = 0; v < BLOCK / LATTICE; v++) {
          for (let u = 0; u < BLOCK / LATTICE; u++) {
            const ix = X / LATTICE + u, iy = Y / LATTICE + v;
            const H = (k: number) => hash2(ix, iy, s + 900 + k);
            const x = (ix + 0.08 + 0.84 * H(1)) * LATTICE, y = (iy + 0.08 + 0.84 * H(2)) * LATTICE;
            if (inGrid(w, x, y) || !onLand(x, y, 3)) continue;
            if (this.kindOf(x, y) !== 'forest') continue;
            const d = beyondGrid(w, x, y);
            // as dense as the square's woods at its edge, sparser (but bigger) trees farther out
            const far = smoothstep(60, 520, d);
            if (H(3) > 0.86 - 0.5 * far) continue;
            const big = 1 + 0.8 * far;
            if (blocked(x, y, 1.5 * big)) continue;
            const mood = fbm(x / 90, y / 90, s + 71, 2) + (H(4) - 0.5) * 0.25;
            const gy = this.groundY(x, y);
            const vv = mood + (H(5) - 0.5) * 0.3 + (gy > 4.5 ? 0.15 : 0);
            const sp = H(6) < 0.12 && vv < 0.6 ? 2 : vv > 0.52 ? 0 : 1;
            const size = (0.82 + 0.36 * H(7)) * big;
            const tint = 0.86 + 0.26 * H(8), warm = (H(9) - 0.5) * 0.12;
            pushYaw(trees[sp], x, gy - 0.25, y, size, size * (0.9 + 0.25 * H(10)), H(11) * 6.283, tint * (1 + warm), tint, tint * (1 - warm));
          }
        }
        // boulders on the outcrops
        for (let iy = Math.ceil(Y / ROCK_LATTICE); iy * ROCK_LATTICE < Y + BLOCK; iy++) {
          for (let ix = Math.ceil(X / ROCK_LATTICE); ix * ROCK_LATTICE < X + BLOCK; ix++) {
            const H = (k: number) => hash2(ix, iy, s + 950 + k);
            const x = (ix + 0.1 + 0.8 * H(1)) * ROCK_LATTICE, y = (iy + 0.1 + 0.8 * H(2)) * ROCK_LATTICE;
            if (inGrid(w, x, y) || !onLand(x, y, 3) || this.kindOf(x, y) !== 'rock') continue;
            if (H(3) > 0.8 || blocked(x, y, 2)) continue;
            const frac = 0.65 + 0.35 * H(4);
            const sz = (0.5 + 1.6 * frac) * (H(5) < 0.4 ? 1.3 : 0.55 + 0.6 * H(6));
            const g = 0.5 + 0.13 * H(7), warm = (H(8) - 0.5) * 0.05;
            const sy = sz * (0.55 + 0.4 * H(9));
            pushTilt(rocks, x, this.groundY(x, y) - sy * 0.15, y, sz * (0.85 + 0.4 * H(10)), sy, sz * (0.85 + 0.4 * H(11)),
              H(12) * 6.283, (H(13) - 0.5) * 0.4, (H(14) - 0.5) * 0.4, g + warm, g, g - warm);
          }
        }
      }
    }
  }
}
