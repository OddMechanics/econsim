// Terrain, water, the land beyond the city's square, and the square's nature
// (trees, rocks, ore outcrops, berry bushes, clay mounds).
//
// The ground is one smooth mesh with shared vertices (2 per tile side) whose
// heights come straight from `heightAt`, so people and buildings placed with
// the same function sit exactly on it. Colors are blended per vertex from the
// tile data sampled through a low-frequency domain warp, so tile borders never
// show as a grid. Nature is drawn with thin instances at jittered positions,
// rebuilt per 250 m cell when its tiles change; the trees go through the
// level of detail (TreeLod in countryNature.ts).
//
// Around the square, rings of vertices run out to the map's edge and on to
// the horizon (buildOuter). They're colored by the same recipe from the same
// noise (landColors), with the sim's countryside formulas for the woods, rock
// and soil, so the two meet without a seam; rocky ground on the square's edge
// carries on a little past it (natureKind). The countryside's trees and
// boulders are in countryNature.ts, its fields in fields.ts; both sit on the
// drawn surface through SurfaceIndex / groundY.

import {
  BoundingInfo, Color3, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexBuffer, VertexData,
} from '@babylonjs/core';
import { hash2 } from '../sim/rng';
import type { TileKind, World } from '../sim/types';
import { MAP } from '../sim/config';
import { fbm, fertilityAt, heightAt, kindAt, onLand, STONE_CAP, tileOf, WOOD_CAP } from '../sim/world';
import { TreeLod } from './countryNature';
import { Buf, makeTemplate, mix, pushTilt, pushYaw, rgb, setInstances, smoothstep, type NatureId, type RGB } from './natureKit';
export { rgb, smoothstep, mix, type RGB } from './natureKit';

/** Y of the water surface (water tiles sit at -1.5). */
export const WATER_LEVEL = -0.4;
/** Ground vertices per tile side. */
const RES = 2;


export const PAL = {
  dry: rgb('#a7a65c'),
  lush: rgb('#538a3a'),
  meadow: rgb('#6f9a3e'),
  forest: rgb('#3a5527'),
  forestLitter: rgb('#4f4a2a'),
  rock: rgb('#8e8a82'),
  rockDark: rgb('#686460'),
  rust: rgb('#9c5a36'),
  clay: rgb('#9a5d3c'),
  sand: rgb('#cdbf8e'),
  wetSand: rgb('#9c8f6c'),
  deep: rgb('#34504a'),
  trampled: rgb('#8e9161'),
  outer: rgb('#7a9256'),
  outerDark: rgb('#62794a'),
};



/** Templates drawn here (the trees go through the level of detail, see TreeLod). */
const NATURE: NatureId[] = ['stump', 'rock', 'ore', 'bush', 'mound'];
/** Tiles per side of a nature cell (= LOD_CELL m). */
const NAT_CELL = 25;
const CASTS: Record<NatureId, boolean> = { conifer: true, oak: true, birch: true, stump: false, rock: true, ore: true, bush: true, mound: false };

// ------------------------------------------------------------ surface index

const SURF_CELL = 25;

/**
 * The outer ground mesh's triangles binned on a 25 m grid, so anything laid
 * on the countryside (trees, field crops, fences, animals) can sit exactly on
 * the drawn surface instead of on `heightAt`, which the coarse mesh only
 * follows at its vertices (between them it can be ~0.2 m off).
 */
export class SurfaceIndex {
  private readonly nx: number;
  private readonly start: Uint32Array;
  private readonly tris: Uint32Array;

  constructor(readonly pos: Float32Array, readonly idx: Uint32Array, readonly x0: number, readonly x1: number, readonly nrm: Float32Array | null = null) {
    const nx = Math.ceil((x1 - x0) / SURF_CELL);
    this.nx = nx;
    const count = new Uint32Array(nx * nx + 1);
    const T = idx.length / 3;
    const bounds = (t: number): [number, number, number, number] | null => {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const minX = Math.min(pos[a], pos[b], pos[c]), maxX = Math.max(pos[a], pos[b], pos[c]);
      const minY = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), maxY = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
      if (maxX < x0 || maxY < x0 || minX > x1 || minY > x1) return null;
      return [Math.max(0, Math.floor((minX - x0) / SURF_CELL)), Math.max(0, Math.floor((minY - x0) / SURF_CELL)),
        Math.min(nx - 1, Math.floor((maxX - x0) / SURF_CELL)), Math.min(nx - 1, Math.floor((maxY - x0) / SURF_CELL))];
    };
    for (let t = 0; t < T; t++) {
      const bb = bounds(t);
      if (!bb) continue;
      for (let j = bb[1]; j <= bb[3]; j++) for (let i = bb[0]; i <= bb[2]; i++) count[j * nx + i + 1]++;
    }
    for (let k = 1; k < count.length; k++) count[k] += count[k - 1];
    this.start = count.slice();
    const fill = count.slice();
    this.tris = new Uint32Array(count[count.length - 1]);
    for (let t = 0; t < T; t++) {
      const bb = bounds(t);
      if (!bb) continue;
      for (let j = bb[1]; j <= bb[3]; j++) for (let i = bb[0]; i <= bb[2]; i++) this.tris[fill[j * nx + i]++] = t;
    }
  }

  /** Height of the drawn surface at (x, y), or NaN outside it. */
  heightAt(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / SURF_CELL), j = Math.floor((y - this.x0) / SURF_CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nx) return NaN;
    const c = j * this.nx + i, pos = this.pos, idx = this.idx;
    for (let k = this.start[c]; k < this.start[c + 1]; k++) {
      const t = this.tris[k];
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, d = idx[t * 3 + 2] * 3;
      const ax = pos[a], ay = pos[a + 2], bx = pos[b] - ax, by = pos[b + 2] - ay, cx = pos[d] - ax, cy = pos[d + 2] - ay;
      const den = bx * cy - by * cx;
      if (Math.abs(den) < 1e-9) continue;
      const px = x - ax, py = y - ay;
      const u = (px * cy - py * cx) / den, v = (bx * py - by * px) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      return pos[a + 1] + (pos[b + 1] - pos[a + 1]) * u + (pos[d + 1] - pos[a + 1]) * v;
    }
    return NaN;
  }

  /** Triangles that may overlap the box (each listed once per call, via `seen` stamps). */
  trianglesIn(minX: number, minY: number, maxX: number, maxY: number, out: number[]): number[] {
    out.length = 0;
    const i0 = Math.max(0, Math.floor((minX - this.x0) / SURF_CELL)), i1 = Math.min(this.nx - 1, Math.floor((maxX - this.x0) / SURF_CELL));
    const j0 = Math.max(0, Math.floor((minY - this.x0) / SURF_CELL)), j1 = Math.min(this.nx - 1, Math.floor((maxY - this.x0) / SURF_CELL));
    const seen = new Set<number>();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nx + i;
      for (let k = this.start[c]; k < this.start[c + 1]; k++) {
        const t = this.tris[k];
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ renderer

export class TerrainRenderer {
  private world!: World;
  private ground: Mesh | null = null;
  private water: Mesh | null = null;
  private outer: Mesh | null = null;
  private readonly groundMat: StandardMaterial;
  private readonly waterMat: StandardMaterial;
  private readonly outerMat: StandardMaterial;
  private readonly nature = new Map<NatureId, Mesh>();
  private readonly natureMats: StandardMaterial[] = [];
  // per ground vertex
  private M = 0;
  private hv = new Float32Array(0);
  private ny = new Float32Array(0);
  private noise = new Float32Array(0); // 5 per vertex: warp x, warp y, large, mid, fine
  private col = new Float32Array(0);
  // per tile
  private sig = new Uint16Array(0);
  private natSig = new Uint32Array(0); // quantized nature state per tile (skip re-instancing when unchanged)
  /** Small nature instances per cell (re-instanced only where tiles changed). */
  private natCell = new Map<number, Map<NatureId, Buf>>();
  private natCells = 8;
  /** The square's trees: detailed near the camera, stand-ins farther away. */
  private readonly treeLod: TreeLod;
  private fForest = new Float32Array(0);
  private fRock = new Float32Array(0);
  private fOre = new Float32Array(0);
  private fClay = new Float32Array(0);
  private fUsed = new Float32Array(0);
  private fFert = new Float32Array(0);
  private seed = 0;
  /** The seed of the ground's noise (nature out in the countryside uses the same). */
  get noiseSeed(): number { return this.seed; }
  /** The world's height version the ground mesh was built for (the renderer calls in at most every 2 seconds). */
  private hver = 0;
  /** The outer ground's triangles (for laying things exactly on it). */
  surface: SurfaceIndex | null = null;

  /**
   * Height of the drawn ground at (x, y): on the city's grid the exact
   * triangle of the ground mesh, outside it the outer mesh's (falls back to
   * `heightAt` beyond the map).
   */
  groundY(x: number, y: number): number {
    const w = this.world, M = this.M, step = w.tile / RES;
    const S = w.size * w.tile;
    if (x >= 0 && y >= 0 && x <= S && y <= S && M > 1) {
      const fx = Math.min(M - 1.0001, x / step), fy = Math.min(M - 1.0001, y / step);
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      const hv = this.hv;
      const a = hv[j * M + i], b = hv[j * M + i + 1], c = hv[(j + 1) * M + i + 1], d = hv[(j + 1) * M + i];
      // the same diagonal buildGround picked
      if (Math.abs(a - c) <= Math.abs(b - d)) return u >= v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;
      return u + v <= 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
    }
    const h = this.surface ? this.surface.heightAt(x, y) : NaN;
    return Number.isNaN(h) ? heightAt(w, x, y) : h;
  }

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator | null, world: World) {
    this.groundMat = new StandardMaterial('terrainMat', scene);
    this.groundMat.specularColor = new Color3(0.035, 0.035, 0.03);

    this.waterMat = new StandardMaterial('waterMat', scene);
    this.waterMat.diffuseColor = Color3.FromHexString('#2a5f86');
    this.waterMat.emissiveColor = Color3.FromHexString('#081a29');
    this.waterMat.specularColor = new Color3(0.45, 0.45, 0.42);
    this.waterMat.specularPower = 90;
    this.waterMat.alpha = 0.78;

    this.outerMat = new StandardMaterial('outerMat', scene);
    this.outerMat.specularColor = Color3.Black();

    for (const id of NATURE) {
      const m = makeTemplate(scene, id);
      const mat = new StandardMaterial('nat-' + id, scene);
      mat.specularColor = new Color3(0.04, 0.04, 0.04);
      m.material = mat;
      m.isPickable = false;
      m.receiveShadows = true;
      m.isVisible = false;
      m.freezeWorldMatrix();
      m.doNotSyncBoundingInfo = true; // bounds are set to the whole map in setWorld
      if (shadows && CASTS[id]) shadows.addShadowCaster(m);
      this.nature.set(id, m);
      this.natureMats.push(mat);
    }
    this.treeLod = new TreeLod(scene, shadows, 'gt', 9000);
    this.setWorld(world);
  }

  /** Replace everything for a different world (new game / loaded save). */
  setWorld(world: World): void {
    this.disposeGround();
    this.world = world;
    const S = world.size * world.tile;
    for (const m of this.nature.values()) m.setBoundingInfo(new BoundingInfo(new Vector3(-10, -5, -10), new Vector3(S + 10, 40, S + 10)));
    this.seed = Math.floor(hash2(world.size, Math.round(world.height[(world.size * world.size) >> 1] * 1000), 5) * 100000);
    this.natCells = Math.ceil(world.size / NAT_CELL);
    this.natCell.clear();
    this.treeLod.clear();
    this.buildGround();
    this.buildOuter();
    this.buildWater();
    this.updateNature(world);
  }

  /** Re-instance nature from the world's resource stocks (and recolor tiles whose kind/use changed). */
  updateNature(world: World): void {
    if (world !== this.world) { this.setWorld(world); return; }
    this.refreshHeights();
    this.refreshColors();
    this.placeNature();
  }

  /** Building sites leveled the ground: move the ground vertices to match. */
  private refreshHeights(): void {
    const w = this.world;
    if (!this.ground || (w.hver ?? 0) === this.hver) return;
    this.hver = w.hver ?? 0;
    const M = this.M, step = w.tile / RES;
    const pos = this.ground.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
    const nrm = this.ground.getVerticesData(VertexBuffer.NormalKind) as Float32Array;
    if (!pos || !nrm) return;
    const hv = this.hv, ny = this.ny;
    let moved = false;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const v = j * M + i, h = heightAt(w, i * step, j * step);
      if (Math.abs(h - hv[v]) > 1e-4) { hv[v] = h; pos[v * 3 + 1] = h; moved = true; }
    }
    if (!moved) return;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const v = j * M + i;
      const hl = hv[j * M + Math.max(0, i - 1)], hr = hv[j * M + Math.min(M - 1, i + 1)];
      const hd = hv[Math.max(0, j - 1) * M + i], hu = hv[Math.min(M - 1, j + 1) * M + i];
      const gx = (hr - hl) / (step * ((i > 0 && i < M - 1) ? 2 : 1));
      const gz = (hu - hd) / (step * ((j > 0 && j < M - 1) ? 2 : 1));
      const len = Math.hypot(gx, 1, gz);
      nrm[v * 3] = -gx / len; nrm[v * 3 + 1] = 1 / len; nrm[v * 3 + 2] = -gz / len;
      ny[v] = 1 / len;
    }
    this.ground.updateVerticesData(VertexBuffer.PositionKind, pos);
    this.ground.updateVerticesData(VertexBuffer.NormalKind, nrm);
    this.ground.refreshBoundingInfo();
  }

  dispose(): void {
    this.disposeGround();
    for (const m of this.nature.values()) {
      this.shadows?.removeShadowCaster(m);
      m.dispose();
    }
    this.nature.clear();
    for (const m of this.natureMats) m.dispose();
    this.treeLod.dispose();
    this.groundMat.dispose();
    this.waterMat.dispose();
    this.outerMat.dispose();
  }

  private disposeGround(): void {
    this.ground?.dispose();
    this.water?.dispose();
    this.outer?.dispose();
    this.ground = this.water = this.outer = null;
  }

  // ------------------------------------------------------------- ground

  private buildGround(): void {
    const w = this.world;
    const n = w.size, T = w.tile;
    const M = n * RES + 1;
    const step = T / RES;
    this.M = M;
    const V = M * M;
    const hv = new Float32Array(V);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) hv[j * M + i] = heightAt(w, i * step, j * step);
    }
    const pos = new Float32Array(V * 3);
    const nrm = new Float32Array(V * 3);
    const ny = new Float32Array(V);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const v = j * M + i;
        pos[v * 3] = i * step;
        pos[v * 3 + 1] = hv[v];
        pos[v * 3 + 2] = j * step;
        const hl = hv[j * M + Math.max(0, i - 1)], hr = hv[j * M + Math.min(M - 1, i + 1)];
        const hd = hv[Math.max(0, j - 1) * M + i], hu = hv[Math.min(M - 1, j + 1) * M + i];
        const gx = (hr - hl) / (step * ((i > 0 && i < M - 1) ? 2 : 1));
        const gz = (hu - hd) / (step * ((j > 0 && j < M - 1) ? 2 : 1));
        const len = Math.hypot(gx, 1, gz);
        nrm[v * 3] = -gx / len; nrm[v * 3 + 1] = 1 / len; nrm[v * 3 + 2] = -gz / len;
        ny[v] = 1 / len;
      }
    }
    const idx = new Uint32Array((M - 1) * (M - 1) * 6);
    let k = 0;
    for (let j = 0; j < M - 1; j++) {
      for (let i = 0; i < M - 1; i++) {
        const a = j * M + i, b = a + 1, c = a + M + 1, d = a + M;
        // split along the diagonal that follows the surface better
        if (Math.abs(hv[a] - hv[c]) <= Math.abs(hv[b] - hv[d])) {
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = a; idx[k++] = d; idx[k++] = c;
        } else {
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
          idx[k++] = b; idx[k++] = d; idx[k++] = c;
        }
      }
    }
    // fix winding: front faces must point up (Babylon's normal = (p1-p2) x (p3-p2))
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const area = (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[a * 3 + 2]) - (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[a * 3]);
      if (area < 0) { idx[t + 1] = c; idx[t + 2] = b; }
    }
    // cached per-vertex noise: domain warp + three bands of variation
    const noise = new Float32Array(V * 5);
    const s = this.seed;
    for (let v = 0; v < V; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 2];
      noise[v * 5] = (fbm(x / 70, y / 70, s + 1, 3) - 0.5) * 26;
      noise[v * 5 + 1] = (fbm(x / 70, y / 70, s + 2, 3) - 0.5) * 26;
      noise[v * 5 + 2] = fbm(x / 160, y / 160, s + 3, 2);
      noise[v * 5 + 3] = fbm(x / 34, y / 34, s + 4, 3);
      noise[v * 5 + 4] = fbm(x / 7, y / 7, s + 5, 2);
    }
    this.hv = hv;
    this.ny = ny;
    this.noise = noise;
    this.col = new Float32Array(V * 4);
    this.sig = new Uint16Array(n * n).fill(0xffff);
    this.natSig = new Uint32Array(n * n).fill(0xffffffff);
    this.fForest = new Float32Array(n * n);
    this.fRock = new Float32Array(n * n);
    this.fOre = new Float32Array(n * n);
    this.fClay = new Float32Array(n * n);
    this.fUsed = new Float32Array(n * n);
    this.fFert = new Float32Array(n * n);
    this.updateTileFields();
    this.colorRange(0, 0, M - 1, M - 1);

    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.indices = idx;
    vd.colors = this.col;
    const g = new Mesh('terrain', this.scene);
    vd.applyToMesh(g, true);
    g.material = this.groundMat;
    g.receiveShadows = true;
    g.isPickable = true;
    g.metadata = { kind: 'terrain' };
    g.freezeWorldMatrix();
    this.ground = g;
    this.hver = w.hver ?? 0;
  }

  /** Copy the tile data the colors depend on; returns the tiles whose look changed. */
  private updateTileFields(): number[] {
    const w = this.world;
    const n = w.size, N = n * n;
    const changed: number[] = [];
    for (let i = 0; i < N; i++) {
      const k = w.kind[i];
      const kc = k === 'grass' ? 0 : k === 'forest' ? 1 : k === 'rock' ? 2 : 3;
      // forest floor only where trees actually stand (thinner near roads/lots, lighter where cut)
      let near = 0;
      if (kc === 1) {
        const x = i % n, y = (i - x) / n;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < n && yy < n && w.used[yy * n + xx]) { near = 1; break; }
          }
        }
      }
      const wb = kc === 1 ? Math.min(4, Math.floor((w.wood[i] / WOOD_CAP) * 5)) : 0;
      const sg = kc | (w.used[i] ? 4 : 0) | (w.clayCap[i] > 0 || w.clay[i] > 0 ? 8 : 0) | (w.oreCap[i] > 0 ? 16 : 0) | (near << 5) | (wb << 6);
      if (sg === this.sig[i]) continue;
      this.sig[i] = sg;
      changed.push(i);
      this.fForest[i] = kc === 1 ? (near ? 0.3 : 1) * (0.3 + 0.7 * Math.min(1, wb / 3)) : 0;
      this.fRock[i] = kc === 2 ? 1 : 0;
      this.fOre[i] = w.oreCap[i] > 0 ? 1 : 0;
      this.fClay[i] = sg & 8 ? 1 : 0;
      this.fUsed[i] = w.used[i] ? 1 : 0;
      this.fFert[i] = w.fertility[i];
    }
    return changed;
  }

  private refreshColors(): void {
    const changed = this.updateTileFields();
    if (!changed.length || !this.ground) return;
    const M = this.M;
    if (changed.length > 3000) this.colorRange(0, 0, M - 1, M - 1);
    else {
      const n = this.world.size;
      for (const t of changed) {
        const tx = t % n, ty = Math.floor(t / n);
        // a tile reaches vertices up to ~2 tiles away (bilinear sampling + warp)
        this.colorRange((tx - 3) * RES, (ty - 3) * RES, (tx + 4) * RES, (ty + 4) * RES);
      }
    }
    this.ground.updateVerticesData(VertexBuffer.ColorKind, this.col);
  }

  /** Recompute vertex colors in a grid rectangle (inclusive). */
  private colorRange(i0: number, j0: number, i1: number, j1: number): void {
    const M = this.M, w = this.world, n = w.size, T = w.tile, step = T / RES;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(M - 1, i1); j1 = Math.min(M - 1, j1);
    const c: RGB = [0, 0, 0];
    const { fForest, fRock, fOre, fClay, fUsed, fFert, hv, ny, noise, col } = this;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = j * M + i;
        const h = hv[v];
        const nA = noise[v * 5 + 2], nB = noise[v * 5 + 3], nC = noise[v * 5 + 4];
        // bilinear sample of the tile fields at a warped position
        const fx = Math.min(n - 1.001, Math.max(0, (i * step + noise[v * 5]) / T - 0.5));
        const fy = Math.min(n - 1.001, Math.max(0, (j * step + noise[v * 5 + 1]) / T - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        const t00 = y0 * n + x0, t10 = t00 + 1, t01 = t00 + n, t11 = t01 + 1;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
        const S = (f: Float32Array) => f[t00] * w00 + f[t10] * w10 + f[t01] * w01 + f[t11] * w11;
        const forest = S(fForest), rock = S(fRock), ore = S(fOre), clay = S(fClay), used = S(fUsed), fert = S(fFert);

        // grass: dry yellow-green .. lush green, mottled
        const lushT = smoothstep(0.05, 0.85, fert + (nB - 0.5) * 0.45);
        c[0] = PAL.dry[0]; c[1] = PAL.dry[1]; c[2] = PAL.dry[2];
        mix(c, PAL.lush, lushT);
        mix(c, PAL.meadow, smoothstep(0.45, 0.75, nA) * 0.35);
        // forest floor
        const fo = smoothstep(0.2, 0.75, forest + (nB - 0.5) * 0.3);
        if (fo > 0) {
          const floor: RGB = [PAL.forest[0], PAL.forest[1], PAL.forest[2]];
          mix(floor, PAL.forestLitter, nC * 0.6);
          mix(c, floor, fo);
        }
        // trampled ground around roads and lots
        if (used > 0) mix(c, PAL.trampled, used * 0.3);
        // bare rock on rock tiles and steep slopes
        const steep = smoothstep(0.93, 0.8, ny[v]);
        const rk = Math.max(smoothstep(0.25, 0.7, rock + (nB - 0.5) * 0.35), steep * 0.85);
        if (rk > 0) {
          const r: RGB = [PAL.rockDark[0], PAL.rockDark[1], PAL.rockDark[2]];
          mix(r, PAL.rock, Math.min(1, nC * 1.2 + (nA - 0.5) * 0.4));
          mix(c, r, rk);
        }
        // rusty stain around ore
        if (ore > 0) mix(c, PAL.rust, smoothstep(0.1, 0.8, ore) * (0.25 + 0.35 * nB));
        // clay banks
        if (clay > 0) mix(c, PAL.clay, smoothstep(0.2, 0.7, clay + (nB - 0.5) * 0.5) * 0.85);
        // beaches and the lake bed
        if (h < 0.8) {
          const sand = 1 - smoothstep(0.05, 0.75, h + (nB - 0.5) * 0.5);
          mix(c, PAL.sand, sand * (1 - rk * 0.6));
          if (h < WATER_LEVEL + 0.15) mix(c, PAL.wetSand, smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL - 0.2, h));
          if (h < WATER_LEVEL - 0.2) mix(c, PAL.deep, smoothstep(WATER_LEVEL - 0.2, -1.45, h));
        }
        const b = 0.9 + 0.18 * nC;
        col[v * 4] = c[0] * b;
        col[v * 4 + 1] = c[1] * b;
        col[v * 4 + 2] = c[2] * b;
        col[v * 4 + 3] = 1;
      }
    }
  }

  // ---------------------------------------------------- outside the grid

  /** Per outer vertex: its ground color before the fields are painted in (r, g, b). */
  private outerLand: Float32Array = new Float32Array(0);

  private buildOuter(): void {
    const M = this.M, w = this.world, step = w.tile / RES;
    const S = w.size * w.tile;
    // corner fans: fine enough that far out (2 km from the corner) the steps are still ~30 m apart
    const K = 96;
    const loop: { v: number; dx: number; dy: number; corner: number }[] = [];
    const corner = (i: number, j: number, a0: number) => {
      for (let k = 0; k <= K; k++) {
        const a = a0 + (k / K) * (Math.PI / 2);
        loop.push({ v: j * M + i, dx: Math.cos(a), dy: Math.sin(a), corner: k === 0 || k === K ? -1 : k });
      }
    };
    corner(0, 0, Math.PI);
    for (let i = 1; i < M - 1; i++) loop.push({ v: i, dx: 0, dy: -1, corner: 0 });
    corner(M - 1, 0, -Math.PI / 2);
    for (let j = 1; j < M - 1; j++) loop.push({ v: j * M + M - 1, dx: 1, dy: 0, corner: 0 });
    corner(M - 1, M - 1, 0);
    for (let i = M - 2; i >= 1; i--) loop.push({ v: (M - 1) * M + i, dx: 0, dy: 1, corner: 0 });
    corner(0, M - 1, Math.PI / 2);
    for (let j = M - 2; j >= 1; j--) loop.push({ v: j * M, dx: -1, dy: 0, corner: 0 });

    // rings out from the city's edge: fine across the countryside (to the map's edge), then a few to the horizon
    const reach = Math.max(MAP.max - S, -MAP.min);
    const D: number[] = [0, 5, 10, 16, 24, 32, 42, 54, 68, 84, 100];
    for (let d = 120; d < reach + 60; d += 20) D.push(d);
    D.push(reach + 60, reach + 300, reach + 800, reach + 1600, reach + 2800, reach + 4500);
    const L = loop.length, R = D.length;
    // each ring keeps the loop entries that space its vertices ~5 m near the city, ~20 m across the fields, coarser on the horizon
    const rings: number[][] = [];
    for (let r = 0; r < R; r++) {
      const d = D[r];
      const stride = d < 60 ? 1 : d < 300 ? 2 : d < reach + 100 ? 4 : Math.min(64, 8 << Math.min(3, Math.floor((d - reach) / 900)));
      const arc = ((Math.PI / 2) * Math.max(1, d)) / K; // metres between corner steps at this distance
      const cs = Math.max(1, Math.min(32, Math.round((stride * 5) / arc)));
      rings.push(loop.map((_, e) => e).filter((e) => {
        const c = loop[e].corner;
        return c === -1 || (c === 0 ? e % stride === 0 : c % cs === 0);
      }));
    }
    const total = rings.reduce((a2, ring) => a2 + ring.length, 0);
    const pos = new Float32Array(total * 3);
    const base = new Float32Array(total * 4);
    const ringStart: number[] = [];
    let vi = 0;
    for (let r = 0; r < R; r++) {
      ringStart.push(vi);
      const d = D[r];
      for (const e of rings[r]) {
        const { v, dx, dy } = loop[e];
        const bx = (v % M) * step, by = Math.floor(v / M) * step;
        const x = bx + dx * d, y = by + dy * d;
        pos[vi * 3] = x;
        pos[vi * 3 + 1] = r === 0 ? this.hv[v] : heightAt(w, x, y);
        pos[vi * 3 + 2] = y;
        // the color of the city-edge vertex it radiates from (the first few metres blend from it)
        base[vi * 4] = this.col[v * 4];
        base[vi * 4 + 1] = this.col[v * 4 + 1];
        base[vi * 4 + 2] = this.col[v * 4 + 2];
        base[vi * 4 + 3] = d;
        vi++;
      }
    }
    const idx: number[] = [];
    const up = (a: number, b: number, c: number) => {
      const area = (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[a * 3 + 2]) - (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[a * 3]);
      if (Math.abs(area) < 1e-9) return;
      if (area > 0) idx.push(a, b, c); else idx.push(a, c, b);
    };
    // zip neighboring rings together (both are ordered along the loop)
    for (let r = 0; r < R - 1; r++) {
      const A = rings[r], B = rings[r + 1], na = A.length, nb = B.length;
      const ea = (i: number) => (i < na ? A[i] : A[i - na] + L);
      const eb = (j: number) => (j < nb ? B[j] : B[j - nb] + L);
      const va = (i: number) => ringStart[r] + (i % na), vb = (j: number) => ringStart[r + 1] + (j % nb);
      let i = 0, j = 0;
      while (i < na || j < nb) {
        if (i < na && (j >= nb || ea(i + 1) <= eb(j + 1))) { up(va(i), va(i + 1), vb(j)); i++; }
        else { up(va(i), vb(j + 1), vb(j)); j++; }
      }
    }
    const nrm = new Float32Array(pos.length);
    VertexData.ComputeNormals(pos, idx, nrm);
    // match the map's normals along the seam
    const gn = this.ground!.getVerticesData(VertexBuffer.NormalKind)!;
    for (let k = 0; k < rings[0].length; k++) {
      const v = loop[rings[0][k]].v;
      nrm[k * 3] = gn[v * 3]; nrm[k * 3 + 1] = gn[v * 3 + 1]; nrm[k * 3 + 2] = gn[v * 3 + 2];
    }
    this.surface = new SurfaceIndex(pos, Uint32Array.from(idx), MAP.min - 100, MAP.max + 100, nrm);
    this.outerLand = this.landColors(pos, nrm, base);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.colors = this.colorOuter(pos, false);
    const m = new Mesh('outerGround', this.scene);
    vd.applyToMesh(m, true);
    m.material = this.outerMat;
    m.isPickable = true;
    m.metadata = { kind: 'terrain' };
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    this.outer = m;
  }

  /**
   * What the ground is, for drawing: the sim's `kindAt`, except that rocky
   * ground at the city square's edge carries on a ragged 25-135 m past it
   * (the square also has rock on high ground, which the countryside's formula
   * doesn't know), so outcrops end naturally instead of at the border.
   */
  natureKind(x: number, y: number): TileKind {
    const w = this.world, T = w.tile, S = w.size * T;
    if (x >= 0 && y >= 0 && x < S && y < S) return w.kind[tileOf(w, x, y)];
    const bx = Math.min(S - T / 2, Math.max(T / 2, x)), by = Math.min(S - T / 2, Math.max(T / 2, y));
    const d = Math.hypot(x - bx, y - by) - T / 2;
    if (d < 140 && w.kind[tileOf(w, bx, by)] === 'rock' && d < 25 + 110 * fbm(x / 60, y / 60, this.seed + 81, 2)) return 'rock';
    return kindAt(w, x, y);
  }

  /**
   * The ground's colors beyond the city's square, by the same recipe as on it
   * (grass by soil, forest floor, bare rock and steep slopes, beaches), from
   * the same noise, so the two meet without a seam; the first metres blend
   * from the square's edge colors.
   */
  private landColors(pos: Float32Array, nrm: Float32Array, base: Float32Array): Float32Array {
    const w = this.world, s = this.seed, T = w.tile;
    const n = pos.length / 3;
    const out = new Float32Array(n * 3);
    const c: RGB = [0, 0, 0], floor: RGB = [0, 0, 0], r: RGB = [0, 0, 0];
    for (let vi = 0; vi < n; vi++) {
      const x = pos[vi * 3], h = pos[vi * 3 + 1], y = pos[vi * 3 + 2], d = base[vi * 4 + 3];
      const nA = fbm(x / 160, y / 160, s + 3, 2), nB = fbm(x / 34, y / 34, s + 4, 3);
      // (the finest mottling only where the vertices are close enough to show it)
      const nC = 0.5 + (fbm(x / 7, y / 7, s + 5, 2) - 0.5) * (1 - smoothstep(30, 110, d));
      // forest and rock at a warped point, bilinear over a 10 m lattice (like the square's tiles)
      const px = x + (fbm(x / 70, y / 70, s + 1, 3) - 0.5) * 26, py = y + (fbm(x / 70, y / 70, s + 2, 3) - 0.5) * 26;
      const fx = px / T - 0.5, fy = py / T - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      let forest = 0, rock = 0;
      const land = onLand(px, py) ? 1 : 0;
      if (land) {
        for (let k = 0; k < 4; k++) {
          const ox = k & 1, oy = k >> 1;
          const wt = (ox ? ax : 1 - ax) * (oy ? ay : 1 - ay);
          const kd = this.natureKind((x0 + ox + 0.5) * T, (y0 + oy + 0.5) * T);
          if (kd === 'forest') forest += wt; else if (kd === 'rock') rock += wt;
        }
      }
      // (the countryside's soil formula runs a little richer than the square's: match its look)
      const fert = fertilityAt(w, px, py) - 0.12;
      const lushT = smoothstep(0.05, 0.85, fert + (nB - 0.5) * 0.45);
      c[0] = PAL.dry[0]; c[1] = PAL.dry[1]; c[2] = PAL.dry[2];
      mix(c, PAL.lush, lushT);
      mix(c, PAL.meadow, smoothstep(0.45, 0.75, nA) * 0.35);
      const fo = smoothstep(0.2, 0.75, forest + (nB - 0.5) * 0.3);
      if (fo > 0) {
        floor[0] = PAL.forest[0]; floor[1] = PAL.forest[1]; floor[2] = PAL.forest[2];
        mix(floor, PAL.forestLitter, nC * 0.6);
        mix(c, floor, fo);
      }
      const steep = smoothstep(0.93, 0.8, nrm[vi * 3 + 1]);
      const rk = Math.max(smoothstep(0.25, 0.7, rock + (nB - 0.5) * 0.35), steep * 0.85);
      if (rk > 0) {
        r[0] = PAL.rockDark[0]; r[1] = PAL.rockDark[1]; r[2] = PAL.rockDark[2];
        mix(r, PAL.rock, Math.min(1, nC * 1.2 + (nA - 0.5) * 0.4));
        mix(c, r, rk);
      }
      if (h < 0.8) {
        const sand = 1 - smoothstep(0.05, 0.75, h + (nB - 0.5) * 0.5);
        mix(c, PAL.sand, sand * (1 - rk * 0.6));
        if (h < WATER_LEVEL + 0.15) mix(c, PAL.wetSand, smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL - 0.2, h));
        if (h < WATER_LEVEL - 0.2) mix(c, PAL.deep, smoothstep(WATER_LEVEL - 0.2, -1.45, h));
      }
      const b = 0.9 + 0.18 * nC;
      const e = smoothstep(0, 30, d);
      for (let k = 0; k < 3; k++) out[vi * 3 + k] = base[vi * 4 + k] + (c[k] * b - base[vi * 4 + k]) * e;
    }
    return out;
  }

  /**
   * Colors of the land beyond the city (see landColors). The farms' crops,
   * pastures and yards are laid on top of it (fields.ts).
   */
  private colorOuter(pos: Float32Array, apply: boolean): Float32Array {
    const land = this.outerLand;
    const n = pos.length / 3;
    const cols = new Float32Array(n * 4);
    for (let vi = 0; vi < n; vi++) {
      cols[vi * 4] = land[vi * 3]; cols[vi * 4 + 1] = land[vi * 3 + 1]; cols[vi * 4 + 2] = land[vi * 3 + 2]; cols[vi * 4 + 3] = 1;
    }
    if (apply && this.outer) this.outer.updateVerticesData(VertexBuffer.ColorKind, cols);
    return cols;
  }

  private buildWater(): void {
    const S = this.world.size * this.world.tile;
    const m = MeshBuilder.CreateGround('water', { width: S + 1400, height: S + 1400 }, this.scene);
    m.position.set(S / 2, WATER_LEVEL, S / 2);
    m.material = this.waterMat;
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    this.water = m;
  }

  // -------------------------------------------------------------- nature

  /**
   * Visible stock levels per tile. Instances are a pure function of these, so
   * when none changed (most world.ver bumps) nothing is re-instanced.
   */
  private natureLevels(): Set<number> {
    const w = this.world, n = w.size, N = n * n;
    const dirty = new Set<number>();
    const q = (v: number, cap: number, levels: number) => Math.min(levels, Math.ceil((v / cap) * levels - 1e-6));
    for (let i = 0; i < N; i++) {
      const sg = (w.used[i] ? 1 : 0) | (q(w.wood[i], WOOD_CAP, 20) << 1) | (q(w.stone[i], STONE_CAP, 8) << 6)
        | (q(w.ore[i], Math.max(1, w.oreCap[i]), 8) << 10) | (q(w.forage[i], Math.max(1, w.forageCap[i]), 8) << 14)
        | (q(w.clay[i], Math.max(1, w.clayCap[i]), 8) << 18) | ((w.kind[i] === 'forest' ? 1 : 0) << 22);
      if (sg === this.natSig[i]) continue;
      this.natSig[i] = sg;
      // the cells of this tile and its neighbors (a used tile keeps nature off the tiles around it)
      const x = i % n, y = (i - x) / n;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) dirty.add(Math.floor(yy / NAT_CELL) * this.natCells + Math.floor(xx / NAT_CELL));
      }
    }
    return dirty;
  }

  /**
   * Instance the nature of the cells whose tiles changed (trees go to the
   * level-of-detail manager, the small things into one buffer per template).
   */
  private placeNature(): void {
    const dirty = this.natureLevels();
    if (!dirty.size) return;
    const w = this.world;
    const n = w.size, T = w.tile;
    const s = this.seed;
    const used = w.used;
    const sig = this.natSig;
    // keep nature off roads: the sim only marks the tiles under a road's
    // centerline, so also look a few meters around each instance (only tiles
    // next to a used tile need the check: the radius is below a tile)
    const nearUsed = (i: number): boolean => {
      const x = i % n, y = (i - x) / n;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n && used[yy * n + xx]) return true;
        }
      }
      return false;
    };
    let nearTile = false;
    const clear = (x: number, y: number, r: number): boolean => {
      if (!nearTile) return true;
      if (used[tileOf(w, x, y)]) return false;
      for (let k = 0; k < 8; k++) {
        const a = k * (Math.PI / 4);
        if (used[tileOf(w, x + Math.cos(a) * r, y + Math.sin(a) * r)]) return false;
      }
      return true;
    };
    for (const cell of dirty) {
      const cx = cell % this.natCells, cy = Math.floor(cell / this.natCells);
      const bufs = new Map<NatureId, Buf>();
      for (const id of NATURE) bufs.set(id, new Buf());
      const trees = [new Buf(), new Buf(), new Buf()];
      const B = (id: NatureId) => id === 'conifer' ? trees[0] : id === 'oak' ? trees[1] : id === 'birch' ? trees[2] : bufs.get(id)!;
      for (let ty = cy * NAT_CELL; ty < Math.min(n, (cy + 1) * NAT_CELL); ty++) {
        for (let tx = cx * NAT_CELL; tx < Math.min(n, (cx + 1) * NAT_CELL); tx++) {
          const i = ty * n + tx;
          if (used[i]) continue;
          const kind = w.kind[i];
          if (kind === 'water') continue;
          nearTile = nearUsed(i);
          const H = (k: number) => hash2(tx, ty, s + k);
          const lv = sig[i];

          // ---- trees
          const wood = w.wood[i];
          if (wood > 0 || kind === 'forest') {
            const frac = ((lv >> 1) & 31) / 20;
            const mood = fbm(tx / 9, ty / 9, s + 71, 2) + (H(1) - 0.5) * 0.25; // stands of one kind
            const high = w.height[i];
            for (let k = 0; k < 4; k++) {
              const th = k * 0.22;
              const sx = k & 1, sy = k >> 1;
              const x = (tx + (sx + 0.08 + 0.84 * H(10 + k)) / 2) * T;
              const y = (ty + (sy + 0.08 + 0.84 * H(20 + k)) / 2) * T;
              if (frac > th + 0.015) {
                if (!clear(x, y, 6.5)) continue;
                const grow = Math.min(1, Math.max(0.2, (frac - th) / 0.4));
                const size = (0.42 + 0.58 * grow) * (0.82 + 0.36 * H(30 + k));
                const v = mood + (H(40 + k) - 0.5) * 0.3 + (high > 4.5 ? 0.15 : 0);
                const id: NatureId = H(50 + k) < 0.12 && v < 0.6 ? 'birch' : v > 0.52 ? 'conifer' : 'oak';
                const tint = 0.86 + 0.26 * H(60 + k);
                const warm = (H(70 + k) - 0.5) * 0.12;
                pushYaw(B(id), x, heightAt(w, x, y) - 0.15, y, size, size * (0.9 + 0.25 * H(80 + k)), H(90 + k) * 6.283,
                  tint * (1 + warm), tint, tint * (1 - warm));
              } else if (kind === 'forest' && frac < 0.5 && H(95 + k) < 0.7 && clear(x, y, 4)) {
                const sz = 0.8 + 0.5 * H(30 + k);
                pushYaw(B('stump'), x, heightAt(w, x, y), y, sz, sz * (0.7 + 0.6 * H(31 + k)), H(90 + k) * 6.283, 1, 1, 1);
              }
            }
          }

          // ---- rocks and ore
          if (kind === 'rock') {
            const frac = ((lv >> 6) & 15) / 8;
            const hasOre = w.oreCap[i] > 0 && w.ore[i] > 2;
            const count = frac < 0.03 ? 0 : 1 + Math.floor(frac * 1.6 + H(100) * 0.8) - (hasOre ? 1 : 0);
            for (let k = 0; k < count; k++) {
              const x = (tx + 0.1 + 0.8 * H(110 + k)) * T, y = (ty + 0.1 + 0.8 * H(120 + k)) * T;
              if (!clear(x, y, 4)) continue;
              const sz = (0.5 + 1.6 * frac) * (k === 0 ? 1.3 : 0.55 + 0.6 * H(130 + k));
              const g = 0.5 + 0.13 * H(140 + k), warm = (H(150 + k) - 0.5) * 0.05;
              const sy = sz * (0.55 + 0.4 * H(160 + k));
              pushTilt(B('rock'), x, heightAt(w, x, y) - sy * 0.15, y, sz * (0.85 + 0.4 * H(170 + k)), sy, sz * (0.85 + 0.4 * H(180 + k)),
                H(190 + k) * 6.283, (H(200 + k) - 0.5) * 0.4, (H(210 + k) - 0.5) * 0.4, g + warm, g, g - warm);
            }
            if (hasOre) {
              const of = ((lv >> 10) & 15) / 8;
              const oc = 1 + Math.floor(of * 1.4 + H(220) * 0.7);
              for (let k = 0; k < oc; k++) {
                const x = (tx + 0.12 + 0.76 * H(230 + k)) * T, y = (ty + 0.12 + 0.76 * H(240 + k)) * T;
                if (!clear(x, y, 4)) continue;
                const sz = (0.55 + 0.9 * of) * (0.8 + 0.5 * H(250 + k));
                const r = 0.56 + 0.1 * H(260 + k);
                pushTilt(B('ore'), x, heightAt(w, x, y) - sz * 0.1, y, sz, sz * (0.8 + 0.4 * H(270 + k)), sz,
                  H(280 + k) * 6.283, (H(290 + k) - 0.5) * 0.5, (H(300 + k) - 0.5) * 0.5, r, r * 0.62, r * 0.47);
              }
            }
          }

          // ---- berry bushes
          if (w.forage[i] > 0.5) {
            const f = ((lv >> 14) & 15) / 8;
            const cx = (tx + 0.25 + 0.5 * H(310)) * T, cy = (ty + 0.25 + 0.5 * H(320)) * T;
            const cnt = 1 + (H(330) < 0.6 ? 1 : 0) + (f > 0.6 ? 1 : 0);
            for (let k = 0; k < cnt; k++) {
              const a = H(340 + k) * 6.283, d = k === 0 ? 0 : 1.2 + 1.2 * H(350 + k);
              const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
              if (!clear(x, y, 3)) continue;
              const sz = (0.55 + 0.5 * f) * (0.8 + 0.4 * H(360 + k));
              const g = 0.85 + 0.25 * H(370 + k);
              pushYaw(B('bush'), x, heightAt(w, x, y) - 0.05, y, sz, sz * (0.85 + 0.3 * H(380 + k)), H(390 + k) * 6.283, g, g, g);
            }
          }

          // ---- clay mounds
          if (w.clayCap[i] > 0 && w.clay[i] > 1) {
            const f = ((lv >> 18) & 15) / 8;
            const cnt = 1 + (H(400) < 0.5 ? 1 : 0);
            for (let k = 0; k < cnt; k++) {
              const x = (tx + 0.15 + 0.7 * H(410 + k)) * T, y = (ty + 0.15 + 0.7 * H(420 + k)) * T;
              if (!clear(x, y, 3)) continue;
              const sz = (0.7 + 0.9 * f) * (0.8 + 0.4 * H(430 + k));
              const r = 0.6 + 0.08 * H(440 + k);
              pushYaw(B('mound'), x, heightAt(w, x, y) - 0.05, y, sz, sz * (0.8 + 0.4 * f), H(450 + k) * 6.283, r, r * 0.62, r * 0.42);
            }
          }
        }
      }
      this.natCell.set(cell, bufs);
      if (trees[0].n + trees[1].n + trees[2].n) this.treeLod.put(cell, cx * NAT_CELL * T, cy * NAT_CELL * T, trees);
      else this.treeLod.remove(cell);
    }
    this.treeLod.commit();
    // the small things: every cell's instances in one buffer per template
    for (const id of NATURE) {
      const all = new Buf();
      for (const bufs of this.natCell.values()) {
        const b = bufs.get(id)!;
        for (let k = 0; k < b.n; k++) {
          const j = all.next();
          all.m.set(b.m.subarray(k * 16, k * 16 + 16), j * 16);
          all.c.set(b.c.subarray(k * 4, k * 4 + 4), j * 4);
        }
      }
      setInstances(this.nature.get(id)!, all);
    }
  }

  /** Trees in detail near the camera, as stand-ins farther away (call every frame; see TreeLod.update). */
  updateView(cam: Vector3, target: Vector3, shadowR: number): void {
    this.treeLod.update(cam, target, shadowR);
  }
}
