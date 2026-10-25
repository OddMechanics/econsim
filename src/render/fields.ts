// The countryside's farms on the ground: crops and pastures, farmyards and
// farmhouse lawns laid on the terrain, rail fences round the pastures with
// cows or sheep in them, hedgerows along the crop fields, a tractor in each
// farmyard (and, with the same model library, ambulances in the hospitals'
// bays).
//
// A farm on a big field lot stands in a farmyard by the lane (farmLayout.ts);
// the rest of its lot is the field. Fields, yards and lawns are cut out of the
// outer ground mesh's own triangles (clipped to rectangles), so they lie
// exactly on the drawn ground, a few centimetres up and with a depth offset:
// no gaps, no z-fighting. (Countryside lots aren't leveled, which is why the
// farm and farmhouse builders leave their lot ground to this.) What grows
// there decides the look:
//   grain: ripe wheat or barley (a 0.8 m deep crop with its edge showing),
//          a young green crop, or stubble after the harvest;
//   vegetables: rows of leafy or dark green plants on brown soil;
//   dairy and livestock: fenced pasture with a herd of cows (dairy), or a
//          flock of sheep or red-brown beef cattle (livestock).
// The textures are painted procedurally (tiling rows, tramlines, grass, with
// a low-frequency tint so the repeats don't show); the cows, sheep, tractors,
// ambulances, fence sections and hedge bushes are CC0 models
// (countryModels.ts). Those are only drawn near the camera (fences within
// 450 m, hedges 700 m, the rest 900 m): thin rails far away would shimmer.

import {
  BoundingInfo, Color3, DynamicTexture, Mesh, Scene, ShadowGenerator, StandardMaterial, Texture, Vector3, VertexData,
} from '@babylonjs/core';
import { MAP } from '../sim/config';
import { hash2 } from '../sim/rng';
import type { Building, Lot, World } from '../sim/types';
import { fbm, heightAt, inGrid } from '../sim/world';
import { ambulanceSpots } from './health';
import { farmhouseDrive } from './farms';
import { countryModels, modelMesh, type CountryModel } from './countryModels';
import { FARM_KINDS, drapedLot, tractorSpot, yardRect } from './farmLayout';
import { Buf, pushYaw } from './natureKit';
import type { SurfaceIndex } from './terrain';

type Look = 'wheat' | 'barley' | 'young' | 'stubble' | 'plowed' | 'veg' | 'vegDark' | 'pasture' | 'gravel' | 'dirt' | 'lawn';
const LOOKS: Look[] = ['wheat', 'barley', 'young', 'stubble', 'plowed', 'veg', 'vegDark', 'pasture', 'gravel', 'dirt', 'lawn'];

interface LookDef {
  /** Texture tile size (m) across and along the rows. */
  tile: number;
  /** Height of a standing crop (0: flat). */
  height: number;
  /** Color of the crop's edge (stalks). */
  edge: string;
}
const LOOK: Record<Look, LookDef> = {
  wheat: { tile: 24, height: 0.8, edge: '#b08c3a' },
  barley: { tile: 24, height: 0.7, edge: '#b5a466' },
  young: { tile: 24, height: 0.22, edge: '#55803a' },
  stubble: { tile: 24, height: 0, edge: '' },
  plowed: { tile: 8, height: 0, edge: '' },
  veg: { tile: 12, height: 0, edge: '' },
  vegDark: { tile: 12, height: 0, edge: '' },
  pasture: { tile: 32, height: 0, edge: '' },
  gravel: { tile: 10, height: 0, edge: '' },
  dirt: { tile: 10, height: 0, edge: '' },
  lawn: { tile: 12, height: 0, edge: '' },
};

/** Flat fields sit this high above the ground (plus a depth offset). */
const LIFT = 0.05;
/** Headland between a field and its lot's edges, and the gap to the farmyard (m). */
const MARGIN = 2.5, GAP = 2;
/** Fences, animals and tractors of farms within this distance of the camera (m). */
const NEAR = 900;

type Rect = [number, number, number, number];

/** Rectangles [u0, u1, v0, v1] minus a hole, as up to 4 rectangles each. */
function subtract(rs: Rect[], hole: Rect): Rect[] {
  const [hu0, hu1, hv0, hv1] = hole;
  const out: Rect[] = [];
  const add = (a: number, b: number, c: number, e: number) => { if (b - a > 0.3 && e - c > 0.3) out.push([a, b, c, e]); };
  for (const r of rs) {
    const [u0, u1, v0, v1] = r;
    if (hu0 >= u1 || hu1 <= u0 || hv0 >= v1 || hv1 <= v0) { out.push(r); continue; }
    add(Math.max(u0, hu1), u1, v0, v1);
    add(u0, Math.min(u1, hu0), v0, v1);
    add(Math.max(u0, hu0), Math.min(u1, hu1), v0, Math.min(v1, hv0));
    add(Math.max(u0, hu0), Math.min(u1, hu1), Math.max(v0, hv1), v1);
  }
  return out;
}

/** A rectangle minus a building's footprint (centered at ub, vb in the lot frame, w across, d deep, plus a margin). */
function around(r: Rect, ub: number, vb: number, w: number, d: number): Rect[] {
  return subtract([r], [ub - d / 2 - 0.4, ub + d / 2 + 0.4, vb - w / 2 - 0.4, vb + w / 2 + 0.4]);
}

interface Farm {
  key: string;
  lot: Lot;
  b: Building;
  look: Look;
  /** Lot frame: center, front (F) and right (R) unit vectors. */
  lx: number; ly: number; fx: number; fy: number;
  /** Field rectangles in the lot frame: [u0, u1, v0, v1] (u along F, v along R). */
  rects: [number, number, number, number][];
  /** Farmyard in the lot frame. */
  yard: [number, number, number, number];
  /** The yard's ground (gravel, dirt; a farmhouse's lawn) in the lot frame, and its look; a farmhouse's gravel drive. */
  yardRects: [number, number, number, number][];
  yardLook: Look;
  driveRects: Rect[];
  cx: number; cy: number; radius: number;
}

/** A vertex while clipping: world x, height, world y, normal, lot u, v, and which rectangle sides it lies on. */
type CV = [number, number, number, number, number, number, number, number, number];

class DecalGeo {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: [number, number, number]): number {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0], c[1], c[2], 1);
    return this.pos.length / 3 - 1;
  }
  get empty(): boolean { return this.idx.length === 0; }
  toMesh(name: string, scene: Scene, uvs: boolean): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.normals = this.nrm; vd.colors = this.col; vd.indices = this.idx;
    if (uvs) vd.uvs = this.uv;
    vd.applyToMesh(m);
    return m;
  }
}

function hexRGB(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ------------------------------------------------------------ textures

/** A tiling texture painted on a canvas: `draw` gets the context, its size in px and px per metre. */
function paintTexture(scene: Scene, name: string, tile: number, seed: number, draw: (g: CanvasRenderingContext2D, S: number, ppm: number, rnd: (k: number) => number) => void): Texture {
  const S = 512;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  let n = 0;
  const rnd = (k: number) => hash2(n++, k, seed);
  draw(g, S, S / tile, rnd);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Speckles: `count` small strokes of the colors given, at low alpha (streaks run along the rows: vertical). */
function speckle(g: CanvasRenderingContext2D, S: number, rnd: (k: number) => number, count: number, colors: string[], w: number, h: number, alpha: number): void {
  g.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd(1) * colors.length)];
    const x = rnd(2) * S, y = rnd(3) * S, ww = w * (0.6 + rnd(4) * 0.8), hh = h * (0.6 + rnd(5) * 0.8);
    // (again one tile up/left, so what runs over an edge comes in on the other side)
    for (const ox of [0, -S]) for (const oy of [0, -S]) g.fillRect(x + ox, y + oy, ww, hh);
  }
  g.globalAlpha = 1;
}

function lookTexture(scene: Scene, look: Look): Texture {
  const def = LOOK[look];
  return paintTexture(scene, 'field-' + look, def.tile, 37 + LOOKS.indexOf(look), (g, S, ppm, rnd) => {
    const fill = (c: string) => { g.fillStyle = c; g.fillRect(0, 0, S, S); };
    const stripes = (period: number, width: number, color: string, alpha: number, off = 0) => {
      g.globalAlpha = alpha;
      g.fillStyle = color;
      for (let x = off; x < S; x += period) g.fillRect(x, 0, width, S);
      g.globalAlpha = 1;
    };
    const tramlines = (color: string, alpha: number) => {
      // two wheel tracks 1.8 m apart, every 24 m (one pair per tile)
      g.globalAlpha = alpha;
      g.fillStyle = color;
      for (const c of [S / 2 - 0.9 * ppm, S / 2 + 0.9 * ppm]) g.fillRect(c - 0.22 * ppm, 0, 0.44 * ppm, S);
      g.globalAlpha = 1;
    };
    switch (look) {
      case 'wheat':
        fill('#d2ad55');
        speckle(g, S, rnd, 2600, ['#e2c46e', '#bf9a45', '#d9b862', '#c9a04a'], 2, 9, 0.5);
        stripes(5, 1, '#9c7c34', 0.16);
        tramlines('#a08038', 0.75);
        break;
      case 'barley':
        fill('#d8c88c');
        speckle(g, S, rnd, 2600, ['#e6d8a2', '#c8b676', '#ddd09a', '#cbbd80'], 2, 8, 0.5);
        stripes(5, 1, '#a99a62', 0.16);
        tramlines('#a49668', 0.7);
        break;
      case 'young':
        fill('#7ba646');
        speckle(g, S, rnd, 2200, ['#8cb752', '#6a963c', '#93bb5a', '#77a043'], 2, 8, 0.45);
        stripes(5, 2, '#5d8836', 0.35);
        stripes(5, 1, '#7d6a48', 0.12, 3);
        tramlines('#7a6a4a', 0.7);
        break;
      case 'stubble':
        fill('#cfbd85');
        speckle(g, S, rnd, 2600, ['#dccd9a', '#bca970', '#d6c690', '#a89a6a'], 2, 6, 0.5);
        stripes(3, 1, '#a8955f', 0.25);
        // straw windrows left by the combine, every 6 m
        g.globalAlpha = 0.55;
        g.fillStyle = '#e4d6a4';
        for (let x = 0.4 * ppm; x < S; x += 6 * ppm) g.fillRect(x, 0, 0.9 * ppm, S);
        g.globalAlpha = 1;
        break;
      case 'plowed':
        fill('#6b5034');
        stripes(0.4 * ppm, 0.17 * ppm, '#54402a', 0.8);
        stripes(0.4 * ppm, 0.08 * ppm, '#836445', 0.6, 0.25 * ppm);
        speckle(g, S, rnd, 1200, ['#5c452d', '#7a5d40'], 3, 3, 0.4);
        break;
      case 'veg':
      case 'vegDark': {
        fill('#6e5236');
        speckle(g, S, rnd, 1500, ['#5e4630', '#806246', '#765a3c'], 3, 3, 0.45);
        const leaf = look === 'veg' ? ['#79ad44', '#8cbf52', '#6a9c3c', '#9cc65e'] : ['#3d6a2e', '#4a7a35', '#335e28', '#56853c'];
        const period = 1.5 * ppm;
        for (let r = 0; r < Math.round(S / period); r++) {
          const cx = (r + 0.5) * period;
          // soil ridge under the row
          g.fillStyle = '#7d5f40';
          g.globalAlpha = 0.6;
          g.fillRect(cx - 0.42 * ppm, 0, 0.84 * ppm, S);
          g.globalAlpha = 1;
          const step = (look === 'veg' ? 0.42 : 0.3) * ppm;
          for (let y = 0; y < S + step; y += step) {
            const rr = (look === 'veg' ? 0.26 : 0.32) * ppm * (0.8 + rnd(6) * 0.4);
            const x = cx + (rnd(7) - 0.5) * 0.12 * ppm;
            g.fillStyle = leaf[Math.floor(rnd(8) * leaf.length)];
            g.beginPath();
            g.arc(x, y % S, rr, 0, Math.PI * 2);
            g.fill();
            if (y + rr > S) { g.beginPath(); g.arc(x, y % S - S, rr, 0, Math.PI * 2); g.fill(); }
          }
        }
        break;
      }
      case 'gravel':
        fill('#a7a091');
        speckle(g, S, rnd, 9000, ['#8f897b', '#bdb6a6', '#9a9384', '#c8c1b1', '#7f796c'], 2, 2, 0.6);
        for (let i = 0; i < 40; i++) {
          g.globalAlpha = 0.08; g.fillStyle = rnd(15) < 0.5 ? '#8a8476' : '#b4ad9d';
          const x = rnd(16) * S, y = rnd(17) * S, r = (0.6 + rnd(18) * 1.6) * ppm;
          for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill(); }
        }
        g.globalAlpha = 1;
        break;
      case 'dirt':
        fill('#8f7a5a');
        for (let i = 0; i < 60; i++) {
          g.globalAlpha = 0.12; g.fillStyle = rnd(15) < 0.5 ? '#7a6548' : '#a08a68';
          const x = rnd(16) * S, y = rnd(17) * S, r = (0.5 + rnd(18) * 2) * ppm;
          for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill(); }
        }
        g.globalAlpha = 1;
        speckle(g, S, rnd, 5000, ['#7c6849', '#9c8665', '#6f5c40', '#a9936f', '#7f8a52'], 2, 2, 0.5);
        break;
      case 'lawn':
        fill('#6c9a48');
        // mowing stripes 1.5 m wide
        g.globalAlpha = 0.1; g.fillStyle = '#8ab45c';
        for (let x = 0; x < S; x += 3 * ppm) g.fillRect(x, 0, 1.5 * ppm, S);
        g.globalAlpha = 1;
        speckle(g, S, rnd, 4000, ['#5f8c3e', '#7aa852', '#689545', '#82ae58'], 2, 2, 0.45);
        break;
      case 'pasture':
        fill('#68a043');
        for (let i = 0; i < 260; i++) {
          g.globalAlpha = 0.12 + rnd(9) * 0.12;
          g.fillStyle = rnd(10) < 0.5 ? '#7fb44f' : '#558a36';
          const x = rnd(11) * S, y = rnd(12) * S, r = (0.5 + rnd(13) * 2.5) * ppm;
          for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.6 + rnd(14) * 0.6), 0, 0, Math.PI * 2); g.fill(); }
        }
        g.globalAlpha = 1;
        speckle(g, S, rnd, 3000, ['#5a9038', '#7ab04c', '#4e8032', '#86b955'], 2, 2, 0.5);
        break;
    }
  });
}

// ------------------------------------------------------------ clipping

/** Clip a polygon to one side of a line in the lot frame (axis 6 = u, 7 = v; keep coord*sign >= bound*sign). */
function clipSide(poly: CV[], axis: 6 | 7, bound: number, sign: number, bit: number): CV[] {
  const out: CV[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      const p = a.map((va, k) => va + (b[k] - va) * t) as CV;
      p[axis] = bound;
      p[8] = (a[8] & b[8]) | bit;
      out.push(p);
    }
  }
  return out;
}

export class FieldRenderer {
  private farms: Farm[] = [];
  private key = '';
  private surface: SurfaceIndex | null = null;
  private readonly mats = new Map<Look, StandardMaterial>();
  private readonly edgeMat: StandardMaterial;
  private meshes: Mesh[] = [];
  /** Models (once loaded) and their per-farm instances. */
  private models: Map<string, Mesh> | null = null;
  private readonly modelMat: StandardMaterial;
  /** Model instances per site (a farm, a hospital), shown when the site is near the camera. */
  private perSite = new Map<string, { x: number; y: number; r: number; models: Map<CountryModel, Buf> }>();
  private siteKey = '';
  private nearKey = '';
  /** Fields drawn, and the time the last rebuild took (ms). */
  stats = { fields: 0, buildMs: 0, near: 0 };

  constructor(private readonly scene: Scene, private readonly shadows: ShadowGenerator | null) {
    for (const look of LOOKS) {
      const m = new StandardMaterial('fieldMat-' + look, scene);
      m.diffuseTexture = lookTexture(scene, look);
      m.specularColor = new Color3(0.02, 0.02, 0.02);
      // flat fields: lifted a little and drawn in front of the ground they're cut from
      if (!LOOK[look].height) { m.zOffset = -1; m.zOffsetUnits = -2; }
      this.mats.set(look, m);
    }
    this.edgeMat = new StandardMaterial('fieldEdgeMat', scene);
    this.edgeMat.specularColor = new Color3(0.02, 0.02, 0.02);
    this.modelMat = new StandardMaterial('countryModelMat', scene);
    this.modelMat.specularColor = new Color3(0.08, 0.08, 0.08);
    void countryModels(scene).then((vds) => {
      if (this.disposed) return;
      const out = new Map<string, Mesh>();
      for (const [name, vd] of vds) {
        const m = modelMesh(scene, vd, 'country-' + name);
        m.material = this.modelMat;
        m.receiveShadows = true;
        m.doNotSyncBoundingInfo = true;
        m.setBoundingInfo(new BoundingInfo(new Vector3(MAP.min - 100, -20, MAP.min - 100), new Vector3(MAP.max + 100, 60, MAP.max + 100)));
        if (shadows && name !== 'fence') shadows.addShadowCaster(m);
        out.set(name, m);
      }
      this.models = out;
      this.nearKey = '';
    });
  }

  private disposed = false;

  /** The farms on the countryside's field lots (call every few seconds; rebuilds when they change). */
  sync(buildings: Building[], lotById: Map<number, Lot>, surface: SurfaceIndex | null, world: World): void {
    if (!surface) return;
    this.syncAmbulances(buildings, world);
    const list: Farm[] = [];
    for (const b of buildings) {
      if (b.kind !== 'farmhouse' && !FARM_KINDS.has(b.kind)) continue;
      const lot = lotById.get(b.lot);
      if (!lot || !drapedLot(b.kind, lot.w, lot.d, !inGrid(world, lot.x, lot.y))) continue;
      list.push(b.kind === 'farmhouse' ? this.houseOf(b, lot) : this.farmOf(b, lot, this.lookOf(b, lot)));
    }
    const key = list.map((f) => f.key).join(';');
    if (key === this.key && surface === this.surface) return;
    this.key = key;
    this.surface = surface;
    this.farms = list;
    const t0 = performance.now();
    this.rebuild();
    this.stats.fields = list.length;
    this.stats.buildMs = performance.now() - t0;
  }

  /**
   * Fences, animals and tractors near the camera (fence sections within 450 m,
   * the rest within 900 m: thin rails farther away would only shimmer).
   */
  update(cam: Vector3): void {
    if (!this.models) return;
    const key = `${Math.round(cam.x / 40)},${Math.round(cam.y / 40)},${Math.round(cam.z / 40)}|${this.key}|${this.siteKey}`;
    if (key === this.nearKey) return;
    this.nearKey = key;
    const all = new Map<CountryModel, Buf>();
    let near = 0;
    for (const site of this.perSite.values()) {
      if (Math.hypot(site.x - cam.x, site.y - cam.z, Math.max(0, cam.y - 30)) - site.r > NEAR) continue;
      near++;
      for (const [model, b] of site.models) {
        const reach = model === 'fence' ? 450 : model === 'hedge' ? 700 : 900;
        let acc = all.get(model);
        if (!acc) { acc = new Buf(); all.set(model, acc); }
        for (let i = 0; i < b.n; i++) {
          const o = i * 16;
          if (Math.hypot(b.m[o + 12] - cam.x, b.m[o + 13] - cam.y, b.m[o + 14] - cam.z) > reach) continue;
          const k = acc.next();
          acc.m.set(b.m.subarray(o, o + 16), k * 16);
          acc.c.set(b.c.subarray(i * 4, i * 4 + 4), k * 4);
        }
      }
    }
    for (const [name, mesh] of this.models) {
      const b = all.get(name as CountryModel);
      mesh.isVisible = !!b && b.n > 0;
      if (!b || !b.n) continue;
      mesh.thinInstanceSetBuffer('matrix', b.m.slice(0, b.n * 16), 16, true);
      mesh.thinInstanceSetBuffer('color', b.c.slice(0, b.n * 4), 4, true);
    }
    this.stats.near = near;
  }

  /** Ambulances parked in the hospitals' bays. */
  private syncAmbulances(buildings: Building[], world: World): void {
    const hs = buildings.filter((b) => b.kind === 'hospital' && b.built && !b.ruined);
    const key = hs.map((b) => `${b.id}:${Math.round(b.x)},${Math.round(b.y)},${b.w},${b.d}`).join(';');
    if (key === this.siteKey) return;
    this.siteKey = key;
    for (const k of [...this.perSite.keys()]) if (k.startsWith('amb:')) this.perSite.delete(k);
    for (const b of hs) {
      const buf = new Buf();
      const fx = Math.cos(b.angle), fy = Math.sin(b.angle), rx = Math.sin(b.angle), ry = -Math.cos(b.angle);
      // (on the bay's floor: the building's ground plus its plinth)
      const y = heightAt(world, b.x, b.y) + 0.2;
      ambulanceSpots(b).forEach((sp, i) => {
        if (i > 0 && hash2(b.id, 5, 4420) < 0.4) return; // (one is out on a call)
        const x = b.x + rx * sp.x + fx * sp.z, z = b.y + ry * sp.x + fy * sp.z;
        pushYaw(buf, x, y, z, 1, 1, Math.atan2(fx, fy) + sp.yaw, 1, 1, 1);
      });
      this.perSite.set(`amb:${b.id}`, { x: b.x, y: b.y, r: 30, models: new Map([['ambulance', buf]]) });
    }
    this.nearKey = '';
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    for (const m of this.mats.values()) { m.diffuseTexture?.dispose(); m.dispose(); }
    this.edgeMat.dispose();
    if (this.models) for (const m of this.models.values()) { this.shadows?.removeShadowCaster(m); m.dispose(); }
    this.modelMat.dispose();
  }

  // ------------------------------------------------------------ farms

  private lookOf(b: Building, lot: Lot): Look {
    if (!b.built || b.ruined) return 'plowed';
    const r = hash2(lot.id, 7, 4401);
    switch (b.kind) {
      case 'farm': return r < 0.4 ? 'wheat' : r < 0.6 ? 'barley' : r < 0.85 ? 'young' : 'stubble';
      case 'vegfarm': return r < 0.55 ? 'veg' : 'vegDark';
      default: return 'pasture';
    }
  }

  private farmOf(b: Building, lot: Lot, look: Look): Farm {
    const fx = Math.cos(lot.angle), fy = Math.sin(lot.angle), rx = Math.sin(lot.angle), ry = -Math.cos(lot.angle);
    const ub = (b.x - lot.x) * fx + (b.y - lot.y) * fy, vb = (b.x - lot.x) * rx + (b.y - lot.y) * ry;
    const yr = yardRect(b.w, b.d, lot.d, -ub);
    const yu0 = yr.z0 + ub, yv0 = vb - yr.hw, yv1 = vb + yr.hw;
    const u0 = -lot.d / 2 + MARGIN, u1 = lot.d / 2 - MARGIN, v0 = -lot.w / 2 + MARGIN, v1 = lot.w / 2 - MARGIN;
    const rects: Farm['rects'] = [];
    if (yu0 - GAP - u0 > 4) rects.push([u0, yu0 - GAP, v0, v1]);
    if (yv0 - GAP - v0 > 4) rects.push([Math.max(u0, yu0 - GAP), u1, v0, yv0 - GAP]);
    if (v1 - (yv1 + GAP) > 4) rects.push([Math.max(u0, yu0 - GAP), u1, yv1 + GAP, v1]);
    const yardRects = around([yu0, lot.d / 2 - 0.6, Math.max(-lot.w / 2 + 0.6, yv0), Math.min(lot.w / 2 - 0.6, yv1)], ub, vb, b.w, b.d);
    return {
      key: `${lot.id}:${b.id}:${look}:${Math.round(b.x)},${Math.round(b.y)}`, lot, b, look,
      lx: lot.x, ly: lot.y, fx, fy, rects, yard: [yu0, lot.d / 2, yv0, yv1], yardRects,
      yardLook: b.kind === 'dairyfarm' || b.kind === 'ranch' ? 'dirt' : 'gravel', driveRects: [],
      cx: lot.x, cy: lot.y, radius: Math.hypot(lot.w, lot.d) / 2,
    };
  }

  /** A farmhouse out in the countryside: its lot is lawn (around the house). */
  private houseOf(b: Building, lot: Lot): Farm {
    const fx = Math.cos(lot.angle), fy = Math.sin(lot.angle), rx = Math.sin(lot.angle), ry = -Math.cos(lot.angle);
    const ub = (b.x - lot.x) * fx + (b.y - lot.y) * fy, vb = (b.x - lot.x) * rx + (b.y - lot.y) * ry;
    // the drive: building-local x across, from z0 to the lot's front (the lot frame's u = local z + ub, v = local x + vb)
    const dr = farmhouseDrive(b);
    const drive: Rect = [dr.z0 + ub, lot.d / 2 - 0.5, vb + dr.x - dr.w / 2, vb + dr.x + dr.w / 2];
    const yardRects = subtract(around([-lot.d / 2 + 0.5, lot.d / 2 - 0.5, -lot.w / 2 + 0.5, lot.w / 2 - 0.5], ub, vb, b.w, b.d + 1), drive);
    return {
      key: `h${lot.id}:${b.id}:${Math.round(b.x)},${Math.round(b.y)}`, lot, b, look: 'lawn',
      lx: lot.x, ly: lot.y, fx, fy, rects: [], yard: [0, 0, 0, 0], yardRects, yardLook: 'lawn', driveRects: [drive],
      cx: lot.x, cy: lot.y, radius: Math.hypot(lot.w, lot.d) / 2,
    };
  }

  private rebuild(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    for (const k of [...this.perSite.keys()]) if (!k.startsWith('amb:')) this.perSite.delete(k);
    this.nearKey = '';
    const tops = new Map<Look, DecalGeo>();
    const edges = new DecalGeo();
    for (const f of this.farms) {
      let g = tops.get(f.look);
      if (!g) { g = new DecalGeo(); tops.set(f.look, g); }
      const tint = 0.93 + 0.12 * hash2(f.lot.id, 3, 4402);
      const c: [number, number, number] = [tint * (1 + (hash2(f.lot.id, 4, 4402) - 0.5) * 0.06), tint, tint * (1 - (hash2(f.lot.id, 4, 4402) - 0.5) * 0.06)];
      for (const r of f.rects) this.decal(f, f.look, r, g, edges, c);
      let yg = tops.get(f.yardLook);
      if (!yg) { yg = new DecalGeo(); tops.set(f.yardLook, yg); }
      for (const r of f.yardRects) this.decal(f, f.yardLook, r, yg, edges, c);
      if (f.driveRects.length) {
        let dg = tops.get('gravel');
        if (!dg) { dg = new DecalGeo(); tops.set('gravel', dg); }
        for (const r of f.driveRects) this.decal(f, 'gravel', r, dg, edges, c);
      }
      if (f.b.kind !== 'farmhouse') this.extras(f);
    }
    for (const [look, g] of tops) {
      if (g.empty) continue;
      const m = g.toMesh('field-' + look, this.scene, true);
      m.material = this.mats.get(look)!;
      this.prep(m);
      this.meshes.push(m);
    }
    if (!edges.empty) {
      const m = edges.toMesh('field-edges', this.scene, false);
      m.material = this.edgeMat;
      this.prep(m);
      this.meshes.push(m);
    }
  }

  private prep(m: Mesh): void {
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
  }

  /** One field rectangle: the ground's triangles clipped to it, lifted (a standing crop gets its top and its edge). */
  private decal(f: Farm, look: Look, r: [number, number, number, number], g: DecalGeo, edges: DecalGeo, tint: [number, number, number]): void {
    const surf = this.surface!;
    const def = LOOK[look];
    const [u0, u1, v0, v1] = r;
    const rx = f.fy, ry = -f.fx; // right = (sin a, -cos a)
    const wx = (u: number, v: number) => f.lx + f.fx * u + rx * v;
    const wy = (u: number, v: number) => f.ly + f.fy * u + ry * v;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
      const x = wx(u, v), y = wy(u, v);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const tris = surf.trianglesIn(minX, minY, maxX, maxY, []);
    const pos = surf.pos, idx = surf.idx, nrm = surf.nrm;
    const H = def.height, lift = H > 0 ? H : LIFT;
    const edgeC = H > 0 ? hexRGB(def.edge) : null;
    const tile = def.tile;
    const vt: [number, number, number] = [1, 1, 1];
    for (const t of tris) {
      let poly: CV[] = [];
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k];
        const x = pos[vi * 3], h = pos[vi * 3 + 1], y = pos[vi * 3 + 2];
        const du = x - f.lx, dv = y - f.ly;
        poly.push([x, h, y, nrm ? nrm[vi * 3] : 0, nrm ? nrm[vi * 3 + 1] : 1, nrm ? nrm[vi * 3 + 2] : 0, du * f.fx + dv * f.fy, du * rx + dv * ry, 0]);
      }
      // quick reject
      if (poly.every((p) => p[6] < u0) || poly.every((p) => p[6] > u1) || poly.every((p) => p[7] < v0) || poly.every((p) => p[7] > v1)) continue;
      poly = clipSide(poly, 6, u0, 1, 1);
      if (poly.length >= 3) poly = clipSide(poly, 6, u1, -1, 2);
      if (poly.length >= 3) poly = clipSide(poly, 7, v0, 1, 4);
      if (poly.length >= 3) poly = clipSide(poly, 7, v1, -1, 8);
      if (poly.length < 3) continue;
      const base = g.pos.length / 3;
      for (const p of poly) {
        // wetter and drier patches, so the texture's repeats don't show
        const k = 0.9 + 0.16 * fbm(p[0] / 70, p[2] / 70, 4403, 2);
        vt[0] = tint[0] * k; vt[1] = tint[1] * k; vt[2] = tint[2] * k;
        g.vert(p[0], p[1] + lift, p[2], p[3], p[4], p[5], p[7] / tile, p[6] / tile, vt);
      }
      for (let k = 1; k + 1 < poly.length; k++) {
        const a = poly[0], b = poly[k], c = poly[k + 1];
        const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
        if (Math.abs(area) < 1e-8) continue;
        if (area > 0) g.idx.push(base, base + k, base + k + 1); else g.idx.push(base, base + k + 1, base + k);
      }
      // a standing crop's edge along the rectangle's sides
      if (!edgeC) continue;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const side = a[8] & b[8];
        if (!side) continue;
        // outward: -F for u0, +F for u1, -R for v0, +R for v1
        const ox = side & 1 ? -f.fx : side & 2 ? f.fx : side & 4 ? -rx : rx;
        const oy = side & 1 ? -f.fy : side & 2 ? f.fy : side & 4 ? -ry : ry;
        const shade = 0.9 + 0.1 * Math.abs(ox);
        const ec: [number, number, number] = [edgeC[0] * shade * tint[0], edgeC[1] * shade * tint[1], edgeC[2] * shade * tint[2]];
        const i0 = edges.vert(a[0], a[1] - 0.05, a[2], ox, 0, oy, 0, 0, ec);
        const i1 = edges.vert(b[0], b[1] - 0.05, b[2], ox, 0, oy, 0, 0, ec);
        const i2 = edges.vert(b[0], b[1] + H, b[2], ox, 0, oy, 0, 0, ec);
        const i3 = edges.vert(a[0], a[1] + H, a[2], ox, 0, oy, 0, 0, ec);
        // Babylon's front face normal is (p1 - p2) x (p3 - p2): keep it pointing outward
        const ax = a[0] - b[0], az = a[2] - b[2]; // p1 - p2 (bottom a - bottom b), p3 - p2 = up
        const nx = -az * 1, nz = ax * 1; // (ax, 0, az) x (0, 1, 0) = (-az, 0, ax)
        if (nx * ox + nz * oy >= 0) edges.idx.push(i0, i1, i2, i0, i2, i3); else edges.idx.push(i1, i0, i3, i1, i3, i2);
      }
    }
  }

  /** The farm's fence, animals and tractor (instances, shown when the farm is near the camera). */
  private extras(f: Farm): void {
    const per = new Map<CountryModel, Buf>();
    const buf = (m: CountryModel) => { let b = per.get(m); if (!b) { b = new Buf(); per.set(m, b); } return b; };
    const surf = this.surface!;
    const rx = f.fy, ry = -f.fx;
    const wx = (u: number, v: number) => f.lx + f.fx * u + rx * v;
    const wy = (u: number, v: number) => f.ly + f.fy * u + ry * v;
    const ground = (x: number, y: number) => { const h = surf.heightAt(x, y); return Number.isNaN(h) ? 0 : h; };
    const H = (k: number) => hash2(f.lot.id, k, 4410);
    const b = f.b;
    if (b.built && !b.ruined) {
      // the tractor in the yard (most farms)
      if (H(1) < 0.85) {
        const sp = tractorSpot(b.w, b.d);
        const bfx = Math.cos(b.angle), bfy = Math.sin(b.angle), brx = Math.sin(b.angle), bry = -Math.cos(b.angle);
        const x = b.x + brx * sp.x + bfx * sp.z, y = b.y + bry * sp.x + bfy * sp.z;
        const yaw = Math.atan2(bfx, bfy) + sp.yaw + (H(2) - 0.5) * 0.3;
        const tc = H(3);
        // red, green or blue paint (the model's white parts take the tint)
        const col = tc < 0.4 ? [1, 0.55, 0.5] : tc < 0.75 ? [0.62, 0.95, 0.55] : [0.6, 0.72, 1];
        pushYaw(buf('tractor'), x, ground(x, y) + 0.02, y, 1, 1, yaw, col[0], col[1], col[2]);
      }
    }
    if (f.look !== 'pasture' && f.rects.length) {
      // hedgerows along the lane and down the sides of a crop field (gaps for the gates)
      const i = 1.3;
      const [, , yv0, yv1] = f.yard;
      const U0 = -f.lot.d / 2 + i, U1 = f.lot.d / 2 - i, V0 = -f.lot.w / 2 + i, V1 = f.lot.w / 2 - i;
      const lines: [number, number, number, number][] = [[U1, V0, U1, yv0 - 3], [U1, yv1 + 3, U1, V1], [U1, V0, U0, V0], [U1, V1, U0, V1]];
      lines.forEach(([au, av, bu, bv], li) => {
        const len = Math.hypot(bu - au, bv - av);
        const n = Math.floor(len / 1.9);
        for (let k = 0; k <= n; k++) {
          const t = n ? k / n : 0;
          // a gap now and then (a gate, a dead bush)
          if (H(500 + li * 997 + Math.floor(k / 6)) < 0.08) continue;
          const u = au + (bu - au) * t + (H(600 + li * 997 + k) - 0.5) * 0.5, v = av + (bv - av) * t;
          const x = wx(u, v), y = wy(u, v);
          const s = 0.85 + 0.4 * H(700 + li * 997 + k), tone = 0.85 + 0.25 * H(800 + li * 997 + k);
          pushYaw(buf('hedge'), x, ground(x, y) - 0.1, y, s, s * (0.85 + 0.35 * H(900 + li * 997 + k)), H(1000 + li * 997 + k) * 6.283, tone, tone * (0.97 + 0.06 * H(1100 + k)), tone * 0.95);
        }
      });
    }
    if (f.look === 'pasture') {
      // a rail fence round the pasture (around the farmyard at the front), a gate behind the yard
      const i = 1.2;
      const [yu0, , yv0, yv1] = f.yard;
      const U0 = -f.lot.d / 2 + i, U1 = f.lot.d / 2 - i, V0 = -f.lot.w / 2 + i, V1 = f.lot.w / 2 - i;
      const yb = yu0 - GAP / 2, ya = Math.max(V0, yv0 - GAP / 2), yc = Math.min(V1, yv1 + GAP / 2);
      const path: [number, number][] = [[U1, ya], [U1, V0], [U0, V0], [U0, V1], [U1, V1], [U1, yc], [yb, yc], [yb, ya], [U1, ya]];
      const gateAt = (ya + yc) / 2;
      for (let k = 0; k + 1 < path.length; k++) {
        const [au, av] = path[k], [bu, bv] = path[k + 1];
        const len = Math.hypot(bu - au, bv - av);
        if (len < 1) continue;
        const n = Math.max(1, Math.round(len / 3));
        for (let s = 0; s < n; s++) {
          const t0 = s / n, t1 = (s + 1) / n;
          const pu0 = au + (bu - au) * t0, pv0 = av + (bv - av) * t0, pu1 = au + (bu - au) * t1, pv1 = av + (bv - av) * t1;
          // the gate: leave the section behind the yard's middle open
          if (k === 6 && Math.abs((pv0 + pv1) / 2 - gateAt) < 2) continue;
          const x0 = wx(pu0, pv0), y0 = wy(pu0, pv0), x1 = wx(pu1, pv1), y1 = wy(pu1, pv1);
          this.fenceSpan(buf('fence'), x0, y0, ground(x0, y0), x1, y1, ground(x1, y1));
        }
      }
      // the herd: dairy cows, or a flock of sheep / beef cattle on a livestock farm
      if (b.built && !b.ruined && f.rects.length) {
        const sheep = b.kind === 'ranch' && H(10) < 0.65;
        const model: CountryModel = sheep ? 'sheep' : 'cow';
        const count = sheep ? 14 + Math.floor(H(11) * 12) : 7 + Math.floor(H(11) * 7);
        const back = f.rects[0];
        const cu = back[0] + 25 + (back[1] - back[0] - 50) * H(12), cv = back[2] + 25 + (back[3] - back[2] - 50) * H(13);
        const spread = sheep ? 16 : 22;
        const heading = H(14) * Math.PI * 2;
        const beef = b.kind === 'ranch';
        const placed: [number, number][] = [];
        for (let a = 0; a < count * 4 && placed.length < count; a++) {
          const ang = H(20 + a) * Math.PI * 2, rr = spread * Math.sqrt(H(60 + a));
          const u = cu + Math.cos(ang) * rr, v = cv + Math.sin(ang) * rr;
          if (u < back[0] + 4 || u > back[1] - 4 || v < back[2] + 4 || v > back[3] - 4) continue;
          if (placed.some(([pu, pv]) => Math.hypot(pu - u, pv - v) < (sheep ? 2 : 3.2))) continue;
          placed.push([u, v]);
          const x = wx(u, v), y = wy(u, v);
          const yaw = Math.atan2(f.fx, f.fy) + heading + (H(100 + a) - 0.5) * 1.6;
          const s = (sheep ? 0.9 : 0.92) + H(140 + a) * 0.16;
          // beef cattle: red-brown (the model's white parts take the tint; the black stays black)
          const c = sheep ? [1, 1, 1] : beef ? [0.62, 0.36, 0.22] : [1, 1, 1];
          const tone = 0.92 + 0.12 * H(180 + a);
          pushYaw(buf(model), x, ground(x, y), y, s, s, yaw, c[0] * tone, c[1] * tone, c[2] * tone);
        }
      }
    }
    this.perSite.set(f.key, { x: f.cx, y: f.cy, r: f.radius, models: per });
  }

  /** A fence section from (x0, y0) to (x1, y1): sheared so the posts stay upright on a slope. */
  private fenceSpan(b: Buf, x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): void {
    const dx = x1 - x0, dz = y1 - y0, dh = h1 - h0;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    const k = b.next(), m = b.m, o = k * 16;
    const s = 1 / 3; // the section is 3 m long
    // local x (the rails) -> the span, y -> up, z -> across
    m[o] = dx * s; m[o + 1] = dh * s; m[o + 2] = dz * s; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = -dz / len; m[o + 9] = 0; m[o + 10] = dx / len; m[o + 11] = 0;
    m[o + 12] = (x0 + x1) / 2; m[o + 13] = (h0 + h1) / 2 - 0.03; m[o + 14] = (y0 + y1) / 2; m[o + 15] = 1;
    // weathered wood (the model's light timber, darkened)
    b.c[k * 4] = 0.66; b.c[k * 4 + 1] = 0.58; b.c[k * 4 + 2] = 0.5; b.c[k * 4 + 3] = 1;
  }
}
