// Terrain, water, the land beyond the map edge, and nature (trees, rocks, ore
// outcrops, berry bushes, clay mounds).
//
// The ground is one smooth mesh with shared vertices (2 per tile side) whose
// heights come straight from `heightAt`, so people and buildings placed with
// the same function sit exactly on it. Colors are blended per vertex from the
// tile data sampled through a low-frequency domain warp, so tile borders never
// show as a grid. Nature is drawn with thin instances at jittered positions.

import {
  BoundingInfo, Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexBuffer, VertexData,
} from '@babylonjs/core';
import { hash2 } from '../sim/rng';
import type { World } from '../sim/types';
import { fbm, heightAt, STONE_CAP, tileOf, WOOD_CAP } from '../sim/world';

/** Y of the water surface (water tiles sit at -1.5). */
export const WATER_LEVEL = -0.4;
/** Ground vertices per tile side. */
const RES = 2;

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const PAL = {
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

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mix(out: RGB, c: RGB, t: number): void {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
}

// ---------------------------------------------------------------- templates

function paint(m: Mesh, c: RGB): Mesh {
  const n = m.getTotalVertices();
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, a);
  return m;
}

function cone(scene: Scene, dBottom: number, dTop: number, h: number, tess: number, y: number, c: RGB): Mesh {
  const m = MeshBuilder.CreateCylinder('c', { diameterBottom: dBottom, diameterTop: dTop, height: h, tessellation: tess }, scene);
  m.position.y = y + h / 2;
  m.bakeCurrentTransformIntoVertices();
  return paint(m, c);
}

/** A lumpy icosphere: radius r, stretched by (sx, sy, sz), vertices pushed in/out by `jitter`. */
function blob(scene: Scene, r: number, sub: number, pos: [number, number, number], scale: [number, number, number], jitter: number, seed: number, c: RGB, floorY = -Infinity): Mesh {
  // (Babylon reads subdivisions: 0 as "default 4": a tiny berry would get ~960 vertices; sub 0 means an octahedron here)
  const m = sub <= 0
    ? MeshBuilder.CreatePolyhedron('b', { type: 1, size: r * 0.75 }, scene)
    : MeshBuilder.CreateIcoSphere('b', { radius: r, subdivisions: sub, flat: false }, scene);
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < p.length; i += 3) {
    // shared positions must move together: hash the rounded position
    const k = hash2(Math.round(p[i] * 1000), Math.round(p[i + 1] * 1000) * 7 + Math.round(p[i + 2] * 1000), seed);
    const f = 1 + (k - 0.5) * 2 * jitter;
    p[i] = p[i] * f * scale[0] + pos[0];
    p[i + 1] = Math.max(floorY, p[i + 1] * f * scale[1]) + pos[1];
    p[i + 2] = p[i + 2] * f * scale[2] + pos[2];
  }
  m.setVerticesData(VertexBuffer.PositionKind, p);
  const nrm = new Float32Array(p.length);
  VertexData.ComputeNormals(p, m.getIndices()!, nrm);
  m.setVerticesData(VertexBuffer.NormalKind, nrm);
  return paint(m, c);
}

function merge(parts: Mesh[], name: string, flat = true): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  if (flat) m.convertToFlatShadedMesh();
  return m;
}

type NatureId = 'conifer' | 'oak' | 'birch' | 'stump' | 'rock' | 'ore' | 'bush' | 'mound';

function makeTemplate(scene: Scene, id: NatureId): Mesh {
  const bark = rgb('#6a4a2f');
  switch (id) {
    case 'conifer':
      return merge([
        cone(scene, 0.38, 0.24, 1.9, 5, 0, bark),
        cone(scene, 3.7, 0, 3.6, 7, 1.2, rgb('#2f5d34')),
        cone(scene, 2.9, 0, 3.0, 7, 3.0, rgb('#33653a')),
        cone(scene, 2.0, 0, 2.6, 7, 4.8, rgb('#3a6e40')),
      ], 'conifer');
    case 'oak':
      return merge([
        cone(scene, 0.5, 0.32, 3.2, 6, 0, bark),
        blob(scene, 2.3, 1, [0, 4.6, 0], [1, 0.85, 1], 0.18, 11, rgb('#4f8a39')),
        blob(scene, 1.6, 1, [1.2, 3.9, 0.5], [1, 0.85, 1], 0.2, 12, rgb('#5a9440')),
      ], 'oak');
    case 'birch':
      return merge([
        cone(scene, 0.28, 0.16, 5.2, 6, 0, rgb('#e4e0d6')),
        blob(scene, 1.35, 1, [0, 5.4, 0], [1, 1.7, 1], 0.22, 13, rgb('#86ad4c')),
      ], 'birch');
    case 'stump':
      return merge([cone(scene, 0.55, 0.45, 0.5, 7, -0.05, rgb('#7a5a3a'))], 'stump');
    case 'rock':
      return merge([blob(scene, 1, 1, [0, 0, 0], [1, 1, 1], 0.3, 21, rgb('#ffffff'), -0.35)], 'rock');
    case 'ore':
      return merge([
        blob(scene, 1, 1, [0, 0, 0], [0.9, 1.2, 0.9], 0.28, 31, rgb('#ffffff'), -0.4),
        blob(scene, 0.55, 1, [0.75, 0, 0.35], [1, 1.4, 1], 0.3, 32, rgb('#c9c2bb'), -0.3),
      ], 'ore');
    case 'bush': {
      const parts = [blob(scene, 0.85, 1, [0, 0.45, 0], [1, 0.75, 1], 0.22, 41, rgb('#3f7a35'), -0.1)];
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4, h = 0.25 + 0.5 * hash2(k, 1, 43);
        const rr = 0.8 * Math.sqrt(1 - h * h * 0.6);
        parts.push(blob(scene, 0.1, 0, [Math.cos(a) * rr, 0.45 + h * 0.6, Math.sin(a) * rr], [1, 1, 1], 0.1, 44 + k, k % 3 ? rgb('#b3263a') : rgb('#5a2a6a')));
      }
      return merge(parts, 'bush');
    }
    case 'mound':
      return merge([
        blob(scene, 1, 1, [0, 0, 0], [1, 0.38, 1], 0.2, 51, rgb('#ffffff'), -0.05),
        blob(scene, 0.6, 1, [0.9, 0, 0.4], [1, 0.35, 1], 0.25, 52, rgb('#e6ddd5'), -0.05),
      ], 'mound');
  }
}

const NATURE: NatureId[] = ['conifer', 'oak', 'birch', 'stump', 'rock', 'ore', 'bush', 'mound'];
const CASTS: Record<NatureId, boolean> = { conifer: true, oak: true, birch: true, stump: false, rock: true, ore: true, bush: true, mound: false };

/** Growable instance buffers (matrix + color). */
class Buf {
  m = new Float32Array(16 * 256);
  c = new Float32Array(4 * 256);
  n = 0;
  next(): number {
    if ((this.n + 1) * 16 > this.m.length) {
      const m = new Float32Array(this.m.length * 2), c = new Float32Array(this.c.length * 2);
      m.set(this.m); c.set(this.c);
      this.m = m; this.c = c;
    }
    return this.n++;
  }
}

const tmpM = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

function pushYaw(b: Buf, x: number, y: number, z: number, s: number, sy: number, yaw: number, r: number, g: number, bl: number): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const i = b.next(), m = b.m, o = i * 16;
  m[o] = s * c; m[o + 1] = 0; m[o + 2] = -s * sn; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = s * sn; m[o + 9] = 0; m[o + 10] = s * c; m[o + 11] = 0;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
  b.c[i * 4] = r; b.c[i * 4 + 1] = g; b.c[i * 4 + 2] = bl; b.c[i * 4 + 3] = 1;
}

function pushTilt(b: Buf, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, roll: number, r: number, g: number, bl: number): void {
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, tmpQ);
  tmpS.set(sx, sy, sz);
  tmpP.set(x, y, z);
  Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
  const i = b.next();
  b.m.set(tmpM.m, i * 16);
  b.c[i * 4] = r; b.c[i * 4 + 1] = g; b.c[i * 4 + 2] = bl; b.c[i * 4 + 3] = 1;
}

/**
 * Thin instances with zero instances would draw the template once with a
 * broken instance-color buffer, so empty meshes are hidden instead.
 */
function setInstances(mesh: Mesh, b: Buf): void {
  mesh.isVisible = b.n > 0;
  if (b.n === 0) return;
  mesh.thinInstanceSetBuffer('matrix', b.m.slice(0, b.n * 16), 16, true);
  mesh.thinInstanceSetBuffer('color', b.c.slice(0, b.n * 4), 4, true);
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
  private fForest = new Float32Array(0);
  private fRock = new Float32Array(0);
  private fOre = new Float32Array(0);
  private fClay = new Float32Array(0);
  private fUsed = new Float32Array(0);
  private fFert = new Float32Array(0);
  private seed = 0;
  /** The world's height version the ground mesh was built for (the renderer calls in at most every 2 seconds). */
  private hver = 0;

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
    this.setWorld(world);
  }

  /** Replace everything for a different world (new game / loaded save). */
  setWorld(world: World): void {
    this.disposeGround();
    this.world = world;
    const S = world.size * world.tile;
    for (const m of this.nature.values()) m.setBoundingInfo(new BoundingInfo(new Vector3(-10, -5, -10), new Vector3(S + 10, 40, S + 10)));
    this.seed = Math.floor(hash2(world.size, Math.round(world.height[(world.size * world.size) >> 1] * 1000), 5) * 100000);
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

  // ---------------------------------------------------- outside the map

  private buildOuter(): void {
    const M = this.M, w = this.world, step = w.tile / RES;
    const K = 5; // corner fan steps
    const loop: { v: number; dx: number; dy: number; corner: boolean }[] = [];
    const corner = (i: number, j: number, a0: number) => {
      for (let k = 0; k <= K; k++) {
        const a = a0 + (k / K) * (Math.PI / 2);
        loop.push({ v: j * M + i, dx: Math.cos(a), dy: Math.sin(a), corner: true });
      }
    };
    corner(0, 0, Math.PI);
    for (let i = 1; i < M - 1; i++) loop.push({ v: i, dx: 0, dy: -1, corner: false });
    corner(M - 1, 0, -Math.PI / 2);
    for (let j = 1; j < M - 1; j++) loop.push({ v: j * M + M - 1, dx: 1, dy: 0, corner: false });
    corner(M - 1, M - 1, 0);
    for (let i = M - 2; i >= 1; i--) loop.push({ v: (M - 1) * M + i, dx: 0, dy: 1, corner: false });
    corner(0, M - 1, Math.PI / 2);
    for (let j = M - 2; j >= 1; j--) loop.push({ v: j * M, dx: -1, dy: 0, corner: false });

    const D = [0, 18, 50, 120, 260, 520, 1000, 1800, 3000, 4800];
    const L = loop.length, R = D.length;
    // a blurred copy of the border (height and color): the outer land continues
    // its general look, not every tree and rock on the edge (which would streak)
    const W = 14;
    const sh = new Float32Array(L), sc = new Float32Array(L * 3);
    for (let e = 0; e < L; e++) {
      let h = 0, r = 0, g = 0, b = 0;
      for (let k = -W; k <= W; k++) {
        const v = loop[(e + k + L) % L].v;
        h += this.hv[v]; r += this.col[v * 4]; g += this.col[v * 4 + 1]; b += this.col[v * 4 + 2];
      }
      const f = 1 / (2 * W + 1);
      sh[e] = h * f; sc[e * 3] = r * f; sc[e * 3 + 1] = g * f; sc[e * 3 + 2] = b * f;
    }
    // each ring keeps fewer loop entries the farther out it is (corners always),
    // so triangles stay roughly square instead of long radial slivers
    const rings: number[][] = [];
    for (let r = 0; r < R; r++) {
      const stride = r <= 1 ? 1 : Math.min(64, 1 << (r - 1));
      rings.push(loop.map((_, e) => e).filter((e) => e % stride === 0 || loop[e].corner));
    }
    const total = rings.reduce((a2, ring) => a2 + ring.length, 0);
    const pos = new Float32Array(total * 3);
    const cols = new Float32Array(total * 4);
    const base: number[] = [];
    const s = this.seed;
    let vi = 0;
    for (let r = 0; r < R; r++) {
      base.push(vi);
      const d = D[r];
      for (const e of rings[r]) {
        const { v, dx, dy } = loop[e];
        const bx = (v % M) * step, by = Math.floor(v / M) * step;
        const x = bx + dx * d, y = by + dy * d;
        const ground = 1.2 + 3.5 * fbm(x / 200, y / 200, s + 61, 3);
        const hills = 120 * Math.max(0, fbm(x / 1100, y / 1100, s + 62, 3) - 0.38) * smoothstep(200, 2200, d);
        const h0 = r === 0 ? this.hv[v] : sh[e];
        const blend = smoothstep(0, 160, d), cblend = smoothstep(0, 110, d);
        pos[vi * 3] = x;
        pos[vi * 3 + 1] = h0 + (ground + hills - h0) * blend;
        pos[vi * 3 + 2] = y;
        const c: RGB = [PAL.outer[0], PAL.outer[1], PAL.outer[2]];
        mix(c, PAL.outerDark, smoothstep(0.4, 0.65, fbm(x / 260, y / 260, s + 63, 3)));
        const b0 = r === 0 ? this.col[v * 4] : sc[e * 3], b1 = r === 0 ? this.col[v * 4 + 1] : sc[e * 3 + 1], b2 = r === 0 ? this.col[v * 4 + 2] : sc[e * 3 + 2];
        cols[vi * 4] = b0 + (c[0] - b0) * cblend;
        cols[vi * 4 + 1] = b1 + (c[1] - b1) * cblend;
        cols[vi * 4 + 2] = b2 + (c[2] - b2) * cblend;
        cols[vi * 4 + 3] = 1;
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
      const va = (i: number) => base[r] + (i % na), vb = (j: number) => base[r + 1] + (j % nb);
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
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.colors = cols;
    const m = new Mesh('outerGround', this.scene);
    vd.applyToMesh(m, false);
    m.material = this.outerMat;
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    this.outer = m;
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
  private natureLevels(): boolean {
    const w = this.world, N = w.size * w.size;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const q = (v: number, cap: number, levels: number) => Math.min(levels, Math.ceil((v / cap) * levels - 1e-6));
      const sg = (w.used[i] ? 1 : 0) | (q(w.wood[i], WOOD_CAP, 20) << 1) | (q(w.stone[i], STONE_CAP, 8) << 6)
        | (q(w.ore[i], Math.max(1, w.oreCap[i]), 8) << 10) | (q(w.forage[i], Math.max(1, w.forageCap[i]), 8) << 14)
        | (q(w.clay[i], Math.max(1, w.clayCap[i]), 8) << 18) | ((w.kind[i] === 'forest' ? 1 : 0) << 22);
      if (sg !== this.natSig[i]) { this.natSig[i] = sg; changed = true; }
    }
    return changed;
  }

  private placeNature(): void {
    if (!this.natureLevels()) return;
    const w = this.world;
    const n = w.size, T = w.tile;
    const bufs = new Map<NatureId, Buf>();
    for (const id of NATURE) bufs.set(id, new Buf());
    const B = (id: NatureId) => bufs.get(id)!;
    const s = this.seed;
    const used = w.used;
    const sig = this.natSig;
    // keep nature off roads: the sim only marks the tiles under a road's
    // centerline, so also look a few meters around each instance (only tiles
    // next to a used tile need the check: the radius is below a tile)
    const near = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      if (!used[i]) continue;
      const x = i % n, y = (i - x) / n;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) near[yy * n + xx] = 1;
        }
      }
    }
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
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const i = ty * n + tx;
        if (used[i]) continue;
        const kind = w.kind[i];
        if (kind === 'water') continue;
        nearTile = near[i] === 1;
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
    for (const id of NATURE) setInstances(this.nature.get(id)!, B(id));
  }
}
