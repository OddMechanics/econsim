// Advertisements: posters on walls (pasted, or in lit frames; free-standing
// city-light panels on the sidewalk), billboards (on steel legs or rooftop
// frames, with an owner plate when an outdoor advertising company rents them
// out), flyers taped to street lamps, fabric banners on facades, round
// advertising columns, and big LED screens on downtown facades that rotate
// through several ads. Designs are painted once into DynamicTextures by
// adArt.ts and shared by sponsor, headline, tagline, hue and format; only ads
// near the camera get a high-resolution texture. Faces are thin instances
// (one draw call per design and resolution); the steel, frames and column
// bodies are merged per area. Each screen has its own two quads (so it can
// slide from one ad to the next) and switches textures, never repaints them.

import {
  Color3, Constants, DynamicTexture, GlowLayer, Mesh, StandardMaterial, Texture, VertexBuffer, VertexData, type PickingInfo, type Scene,
  type ShadowGenerator,
} from '@babylonjs/core';
import type { AdPlacement, World } from '../sim/types';
import { heightAt } from '../sim/world';
import { Geo, WARM, Xf, clamp01, hsl, hx, mix } from './buildingGeo';
import { C } from './buildingGeo';
import { TICKER_BAND, TICKER_LOGO, hashStr, paintAd, paintPlate, paintTicker, rnd, type OwnerInfo } from './adArt';

export type { OwnerInfo } from './adArt';

type Kind = AdPlacement['kind'];
type Tier = 0 | 1 | 2; // hidden, low-res, high-res

/** Distances (m) for switching texture resolution / visibility per kind: [hiIn, hiOut, showIn, showOut]. */
const RANGES: Record<Kind, [number, number, number, number]> = {
  screen: [300, 360, 5000, 5500],
  billboard: [260, 320, 4000, 4500],
  banner: [200, 240, 2500, 2800],
  column: [100, 130, 1100, 1200],
  poster: [110, 140, 900, 1000],
  flyer: [32, 42, 160, 190],
};
/** Texture size (px, long side): [near, far]. */
const TEX: Record<Kind, [number, number]> = {
  screen: [512, 160], billboard: [512, 160], banner: [384, 112], column: [384, 96], poster: [384, 96], flyer: [256, 64],
};
/** How far the face sits in front of the given center (wall clearance). */
const FACE_OFF: Record<Kind, number> = { billboard: 0, banner: 0.18, poster: 0.03, flyer: 0, screen: 0.46, column: 0 };
const POLE_R = 0.105; // flyers wrap around a lamp pole of about this radius
const CHUNK = 256;
/** Screens: seconds per ad, length of the slide between two ads, distance within which they animate. */
const SLOT_SEC = 8;
const SLIDE_SEC = 0.6;
const ANIM_DIST = 280;
/** Share of a column's circumference covered by its ads (the rest are gaps). */
const COL_COVER = 0.94;
/** Screens' light spill reaches this far beyond the cabinet (fraction of its size, each side). */
const HALO_PAD = 0.4;

interface Entry {
  ad: AdPlacement;
  snap: AdPlacement; // copy of the fields as last built
  design: string;
  tier: Tier;
  group: string | null;
  chunk: string;
  gy: number; // ground height
  seen: number;
  screen: string | null; // physical screen this ad runs on
  plate: string | null; // owner plate (billboards of ad companies)
}

interface Tex { tex: DynamicTexture; mat: StandardMaterial }

interface Design {
  key: string;
  kind: Kind;
  ad: AdPlacement; // a representative (for painting)
  owner: OwnerInfo | null;
  aspect: number;
  hi: Tex | null;
  lo: Tex | null;
  ticker: DynamicTexture | null; // scrolling strip (screen designs with a ticker band)
  band: boolean;
  avg: Color3 | null; // average color (screens: tints the light they spill on the facade)
  users: number;
  want: number; // users wanting the high-res texture this frame
  hiIdle: number; // seconds without high-res users
  groups: Set<string>;
}

interface Group { mesh: Mesh; ids: number[]; dirty: boolean; design: string; tier: Tier; slots: number }

interface Chunk { solid: Mesh | null; lamps: Mesh | null; dirty: boolean }

interface Screen {
  key: string;
  ref: AdPlacement;
  gy: number;
  chunk: string;
  slots: (Entry | undefined)[];
  n: number;
  phase: number;
  tier: Tier;
  dist: number;
  cur: number;
  prev: number; // slot sliding out, -1 = none
  t0: number;
  full: boolean; // quad A covers the whole face
  a: Mesh; b: Mesh; t: Mesh; halo: Mesh;
  matA: StandardMaterial; matB: StandardMaterial; matT: StandardMaterial; matH: StandardMaterial;
  posA: Float32Array; uvA: Float32Array; posB: Float32Array; uvB: Float32Array;
  plate: string | null;
}

interface Plate { key: string; name: string; hue: number; tex: DynamicTexture | null; mat: StandardMaterial | null; mesh: Mesh | null; ids: number[]; dirty: boolean }

function sameAd(a: AdPlacement, b: AdPlacement): boolean {
  return a.kind === b.kind && a.x === b.x && a.y === b.y && a.z === b.z && a.angle === b.angle && a.w === b.w && a.h === b.h
    && a.building === b.building && a.headline === b.headline && a.tagline === b.tagline && a.hue === b.hue && a.topic === b.topic
    && a.sponsor === b.sponsor && a.owner === b.owner && a.slot === b.slot && a.slots === b.slots;
}

/** Width and height of the printed face (a column's ad is an arc of its circumference). */
function faceDims(a: AdPlacement): [number, number] {
  if (a.kind === 'column') return [(Math.PI * a.w / Math.max(1, a.slots ?? 1)) * COL_COVER, a.h];
  return [a.w, a.h];
}

/** Posters that hang in a lit frame (election posters are pasted straight onto the wall). */
const framed = (a: AdPlacement) => a.kind === 'poster' && a.topic !== 'campaign';
const faceOff = (a: AdPlacement) => (a.kind === 'poster' ? (a.building < 0 ? 0.1 : framed(a) ? 0.045 : 0.03) : FACE_OFF[a.kind]);
const screenKey = (a: AdPlacement) => `${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)},${a.angle.toFixed(3)},${a.w.toFixed(2)},${a.h.toFixed(2)}`;
const columnKey = (a: AdPlacement) => `${a.x.toFixed(2)},${a.y.toFixed(2)}`;
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Average color of a painted canvas, scaled so its brightest channel is 1 (a light's tint). */
function averageColor(ctx: CanvasRenderingContext2D, W: number, H: number): Color3 {
  const d = ctx.getImageData(0, 0, W, H).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const m = Math.max(r, g, b, 1);
  return new Color3(0.25 + (0.75 * r) / m, 0.25 + (0.75 * g) / m, 0.25 + (0.75 * b) / m);
}

// ------------------------------------------------------------ face templates

function faceGeo(kind: Kind, slots = 1): Geo {
  const g = new Geo(new Xf(), true);
  const W = C.white;
  if (kind === 'flyer') {
    // wraps around a pole whose axis is POLE_R behind the face center (built for a 0.3 m wide sheet)
    const n = 8, w0 = 0.3;
    for (let i = 0; i < n; i++) {
      const p = (k: number): [number, number] => { const th = ((-0.5 + k / n) * w0) / POLE_R; return [(POLE_R * Math.sin(th)) / w0, POLE_R * (Math.cos(th) - 1)]; };
      const [x0, z0] = p(i), [x1, z1] = p(i + 1);
      const u0 = 1 - i / n, u1 = 1 - (i + 1) / n;
      g.poly([x0, -0.5, z0, x1, -0.5, z1, x1, 0.5, z1, x0, 0.5, z0], W, (x0 + x1) / 2, 0, 1 + (z0 + z1) * 4, [u0, 0, u1, 0, u1, 1, u0, 1]);
    }
    return g;
  }
  if (kind === 'column') {
    // an arc of a unit-diameter cylinder around the origin, centered on +Z (scaled by the column diameter)
    const span = (Math.PI * 2 / Math.max(1, slots)) * COL_COVER;
    const n = Math.max(4, Math.round(span / 0.16));
    for (let i = 0; i < n; i++) {
      const t0 = -span / 2 + (i / n) * span, t1 = -span / 2 + ((i + 1) / n) * span;
      const x0 = 0.5 * Math.sin(t0), z0 = 0.5 * Math.cos(t0), x1 = 0.5 * Math.sin(t1), z1 = 0.5 * Math.cos(t1);
      const u0 = i / n, u1 = (i + 1) / n; // u = 0 at -span/2 (the viewer's right is -x) ... flipped below
      g.poly([x0, -0.5, z0, x1, -0.5, z1, x1, 0.5, z1, x0, 0.5, z0], W, (x0 + x1) / 2, 0, (z0 + z1) / 2, [1 - u0, 0, 1 - u1, 0, 1 - u1, 1, 1 - u0, 1]);
    }
    return g;
  }
  if (kind === 'banner') {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = -0.5 + i / n, x1 = -0.5 + (i + 1) / n;
      const z0 = Math.sin((i / n) * Math.PI * 3) * 0.05, z1 = Math.sin(((i + 1) / n) * Math.PI * 3) * 0.05;
      g.poly([x0, -0.5, z0, x1, -0.5, z1, x1, 0.5, z1, x0, 0.5, z0], W, 0, 0, 1, [0.5 - x0, 0, 0.5 - x1, 0, 0.5 - x1, 1, 0.5 - x0, 1]);
    }
    return g;
  }
  g.poly([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], W, 0, 0, 1, [1, 0, 0, 0, 0, 1, 1, 1]);
  return g;
}

/** A unit quad facing +Z with updatable positions and UVs (screens). */
function quadMesh(name: string, scene: Scene): { mesh: Mesh; pos: Float32Array; uv: Float32Array } {
  const mesh = new Mesh(name, scene);
  const pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const uv = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = uv;
  vd.indices = [0, 2, 1, 0, 3, 2];
  vd.applyToMesh(mesh, true);
  return { mesh, pos, uv };
}

/** Viewer-space span q0..q1 (0 = left edge as seen from the front) showing texture u0..u1. */
function setSpan(pos: Float32Array, uv: Float32Array, q0: number, q1: number, u0: number, u1: number, y0 = -0.5, y1 = 0.5): void {
  const xl = 0.5 - q1, xr = 0.5 - q0; // local x of the right-hand (q1) and left-hand (q0) sides
  pos[0] = xl; pos[1] = y0; pos[3] = xr; pos[4] = y0; pos[6] = xr; pos[7] = y1; pos[9] = xl; pos[10] = y1;
  uv[0] = u1; uv[2] = u0; uv[4] = u0; uv[6] = u1;
}

// ------------------------------------------------------------ renderer

export class AdRenderer {
  /** Time budget per sync for painting new textures (ms). */
  paintBudgetMs = 4;
  private entries = new Map<number, Entry>();
  private designs = new Map<string, Design>();
  private groups = new Map<string, Group>();
  private chunks = new Map<string, Chunk>();
  private screens = new Map<string, Screen>();
  private plates = new Map<string, Plate>();
  private placeholders = new Map<number, StandardMaterial>();
  private haloTex: DynamicTexture | null = null;
  private frame = 0;
  private night = 0;
  private nightApplied = -1;
  private lastT = -1;
  private solidMat: StandardMaterial;
  private lampMat: StandardMaterial;
  private world: World | null = null;
  /** Optional: ground height under a building (so wall ads match the building's own ground). */
  groundOf: ((buildingId: number) => number | undefined) | null = null;
  /** Optional: who owns an ad space (for "advertise here" and the owner plates of ad companies). */
  ownerInfo: ((id: number) => OwnerInfo | null) | null = null;

  constructor(private scene: Scene, private shadows: ShadowGenerator | null) {
    this.solidMat = new StandardMaterial('ad-solid', scene);
    this.solidMat.specularColor = new Color3(0.1, 0.1, 0.1);
    this.lampMat = new StandardMaterial('ad-lamp', scene);
    this.lampMat.specularColor = new Color3(0.2, 0.2, 0.2);
    this.lampMat.useEmissiveAsIllumination = true;
    this.setNight(0);
  }

  /** `timeSec`: seconds for screen rotation (defaults to wall-clock time). */
  sync(ads: AdPlacement[], world: World, camX: number, camZ: number, timeSec?: number): void {
    const frame = ++this.frame;
    const now = timeSec ?? performance.now() / 1000;
    const dt = this.lastT < 0 ? 0 : Math.min(1, Math.max(0, now - this.lastT));
    this.lastT = now;
    this.world = world;
    const cam = this.scene.activeCamera;
    const cy = cam ? cam.globalPosition.y : 60;
    const cx = cam ? cam.globalPosition.x : camX, cz = cam ? cam.globalPosition.z : camZ;
    for (const ad of ads) {
      let e = this.entries.get(ad.id);
      if (e && !sameAd(e.snap, ad)) { this.remove(e); e = undefined; }
      if (!e) e = this.add(ad);
      e.ad = ad;
      e.seen = frame;
      if (e.screen) continue; // tiers per physical screen, below
      const dx = ad.x - cx, dy = e.gy + ad.z - cy, dz = ad.y - cz;
      const t = this.tierAt(Math.sqrt(dx * dx + dy * dy + dz * dz), ad.kind, e.tier);
      if (t !== e.tier) this.setTier(e, t);
    }
    for (const e of this.entries.values()) if (e.seen !== frame) this.remove(e);

    // screens: tier by distance, which ad is up, slides between ads
    for (const d of this.designs.values()) d.want = 0;
    for (const e of this.entries.values()) if (e.tier === 2 && !e.screen) this.designs.get(e.design)!.want++;
    for (const sc of this.screens.values()) {
      const a = sc.ref;
      const dx = a.x - cx, dy = sc.gy + a.z - cy, dz = a.y - cz;
      sc.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const t = this.tierAt(sc.dist, 'screen', sc.tier);
      if (t !== sc.tier) {
        sc.tier = t;
        for (const m of [sc.a, sc.b, sc.t, sc.halo]) m.setEnabled(false);
        if (sc.plate) this.markPlate(sc.plate);
      }
      if (sc.tier === 0) continue;
      const cur = this.slotAt(sc, now);
      if (sc.tier === 2 && cur >= 0) {
        this.designs.get(sc.slots[cur]!.design)!.want++;
        const next = this.slotAt(sc, now + SLOT_SEC);
        if (next >= 0 && next !== cur) this.designs.get(sc.slots[next]!.design)!.want++;
      }
    }

    // textures: paint what's missing within the time budget (nearest demand first is implicit), drop idle high-res ones
    const t0 = performance.now();
    for (const d of this.designs.values()) {
      if (!d.lo && d.users > 0 && performance.now() - t0 < this.paintBudgetMs) {
        d.lo = this.makeTexture(d, false);
        this.refreshGroups(d);
      }
      if (d.want > 0) {
        d.hiIdle = 0;
        if (!d.hi && performance.now() - t0 < this.paintBudgetMs) {
          d.hi = this.makeTexture(d, true);
          if (d.band) d.ticker = this.makeTicker(d);
          this.refreshGroups(d);
        }
      } else if (d.hi && (d.hiIdle += dt) > (d.kind === 'screen' ? 20 : 5)) {
        d.hi.tex.dispose(); d.hi.mat.dispose(); d.hi = null;
        d.ticker?.dispose(); d.ticker = null;
        this.refreshGroups(d);
      }
    }
    for (const sc of this.screens.values()) if (sc.tier > 0) this.updateScreen(sc, now);
    for (const d of this.designs.values()) if (d.ticker) d.ticker.uOffset = (now * 0.035) % 1;

    for (const [key, g] of this.groups) if (g.dirty) this.flushGroup(key, g);
    for (const [key, ch] of this.chunks) if (ch.dirty) this.flushChunk(key, ch);
    for (const p of this.plates.values()) if (p.dirty) this.flushPlate(p);
  }

  setNight(level: number): void {
    const n = clamp01(level);
    if (Math.abs(n - this.nightApplied) < 0.002) return; // called every frame; only act on changes
    this.nightApplied = n;
    this.night = n;
    this.lampMat.emissiveColor = WARM.scale(n * 1.1);
    for (const d of this.designs.values()) {
      for (const t of [d.hi, d.lo]) if (t) { if (d.kind === 'screen') t.tex.level = this.screenLevel(); else t.mat.emissiveColor = this.glowOf(d); }
      if (d.ticker) d.ticker.level = this.screenLevel();
    }
    for (const p of this.plates.values()) if (p.mat) p.mat.emissiveColor = this.plateGlow();
    for (const m of this.placeholders.values()) m.emissiveColor = new Color3(0.1 + n * 0.3, 0.1 + n * 0.3, 0.1 + n * 0.3);
  }

  pickedId(pick: PickingInfo): number {
    if (!pick || !pick.hit || !pick.pickedMesh) return -1;
    const md = pick.pickedMesh.metadata as { kind?: string; group?: string; screen?: string; plate?: string } | null;
    if (!md || md.kind !== 'ad') return -1;
    if (md.screen) {
      const sc = this.screens.get(md.screen);
      return sc && sc.cur >= 0 ? sc.slots[sc.cur]?.ad.id ?? -1 : -1;
    }
    if (md.plate) return this.plates.get(md.plate)?.ids[pick.thinInstanceIndex] ?? -1;
    if (!md.group) return -1;
    const g = this.groups.get(md.group);
    if (!g) return -1;
    return g.ids[pick.thinInstanceIndex] ?? -1;
  }

  /** Counts for debugging. */
  stats(): { ads: number; designs: number; loTextures: number; hiTextures: number; groups: number; chunks: number; screens: number; plates: number } {
    let hi = 0, lo = 0;
    for (const d of this.designs.values()) { if (d.hi) hi++; if (d.lo) lo++; }
    return { ads: this.entries.size, designs: this.designs.size, loTextures: lo, hiTextures: hi, groups: this.groups.size, chunks: this.chunks.size, screens: this.screens.size, plates: this.plates.size };
  }

  dispose(): void {
    for (const g of this.groups.values()) g.mesh.dispose(false, false);
    this.groups.clear();
    for (const ch of this.chunks.values()) { ch.solid?.dispose(false, false); ch.lamps?.dispose(false, false); }
    this.chunks.clear();
    for (const sc of this.screens.values()) this.disposeScreen(sc);
    this.screens.clear();
    for (const p of this.plates.values()) { p.mesh?.dispose(false, false); p.tex?.dispose(); p.mat?.dispose(); }
    this.plates.clear();
    for (const d of this.designs.values()) this.disposeDesign(d);
    this.designs.clear();
    for (const m of this.placeholders.values()) m.dispose();
    this.placeholders.clear();
    this.haloTex?.dispose();
    this.haloTex = null;
    this.entries.clear();
    this.solidMat.dispose();
    this.lampMat.dispose();
  }

  // ------------------------------------------------------------ private

  private tierAt(d: number, kind: Kind, cur: Tier): Tier {
    const [hiIn, hiOut, showIn, showOut] = RANGES[kind];
    if (d > (cur > 0 ? showOut : showIn)) return 0;
    if (d < (cur === 2 ? hiOut : hiIn)) return 2;
    return 1;
  }

  private add(ad: AdPlacement): Entry {
    const w = this.world;
    let gy = this.groundOf && ad.building >= 0 ? this.groundOf(ad.building) : undefined;
    if (gy === undefined) gy = w ? heightAt(w, ad.x, ad.y) : 0;
    const owner = ad.owner !== undefined && ad.owner >= 0 && this.ownerInfo ? this.ownerInfo(ad.owner) : null;
    const [fw, fh] = faceDims(ad);
    const aspect = fw / Math.max(0.05, fh);
    const vacant = ad.sponsor === -1;
    const key = vacant
      ? `${ad.kind}|vacant|${owner?.name ?? ''}|${Math.round((owner?.hue ?? 0) * 100)}|${Math.round(aspect * 4) / 4}`
      : `${ad.kind}|${ad.sponsor}|${ad.headline}|${ad.tagline}|${Math.round(ad.hue * 100)}|${ad.topic}|${Math.round(aspect * 4) / 4}`;
    let d = this.designs.get(key);
    if (!d) {
      d = {
        key, kind: ad.kind, ad, owner, aspect, hi: null, lo: null, ticker: null, avg: null, users: 0, want: 0, hiIdle: 0, groups: new Set(),
        band: ad.kind === 'screen' && !vacant && ad.topic === 'product',
      };
      this.designs.set(key, d);
    }
    d.users++;
    const chunk = `${Math.floor(ad.x / CHUNK)},${Math.floor(ad.y / CHUNK)}`;
    let plate: string | null = null;
    if ((ad.kind === 'billboard' || ad.kind === 'screen') && owner?.adco) {
      plate = `${owner.name}|${Math.round((owner.hue ?? 0) * 100)}`;
      if (!this.plates.has(plate)) this.plates.set(plate, { key: plate, name: owner.name, hue: owner.hue ?? 0.6, tex: null, mat: null, mesh: null, ids: [], dirty: true });
    }
    const e: Entry = { ad, snap: { ...ad }, design: key, tier: 0, group: null, chunk, gy, seen: this.frame, screen: null, plate: ad.kind === 'screen' ? null : plate };
    this.entries.set(ad.id, e);
    if (ad.kind === 'screen') {
      const sk = screenKey(ad);
      let sc = this.screens.get(sk);
      if (!sc) {
        sc = this.makeScreen(sk, ad, gy, chunk);
        this.screens.set(sk, sc);
        this.markChunk(chunk);
      }
      const n = Math.max(1, ad.slots ?? 1);
      sc.n = Math.max(sc.n, n);
      sc.slots[(ad.slot ?? 0) % sc.n] = e;
      if (plate) sc.plate = plate;
      if (sc.plate) this.markPlate(sc.plate);
      e.screen = sk;
    } else {
      this.markChunk(chunk);
    }
    if (e.plate) this.markPlate(e.plate);
    return e;
  }

  private remove(e: Entry): void {
    this.setTier(e, 0);
    this.entries.delete(e.ad.id);
    if (e.plate) this.markPlate(e.plate);
    if (e.screen) {
      const sc = this.screens.get(e.screen);
      if (sc) {
        const i = sc.slots.indexOf(e);
        if (i >= 0) sc.slots[i] = undefined;
        if (sc.plate) this.markPlate(sc.plate);
        if (!sc.slots.some((x) => x)) {
          this.disposeScreen(sc);
          this.screens.delete(sc.key);
          this.markChunk(sc.chunk);
        }
      }
    } else {
      this.markChunk(e.chunk);
    }
    const d = this.designs.get(e.design);
    if (d && --d.users <= 0) {
      this.disposeDesign(d);
      this.designs.delete(d.key);
    }
  }

  private disposeDesign(d: Design): void {
    for (const t of [d.hi, d.lo]) if (t) { t.tex.dispose(); t.mat.dispose(); }
    d.ticker?.dispose();
    d.hi = d.lo = null;
    d.ticker = null;
  }

  private setTier(e: Entry, t: Tier): void {
    if (e.screen) { e.tier = t; return; }
    if (e.group) { const g = this.groups.get(e.group); if (g) g.dirty = true; }
    if ((e.tier > 0) !== (t > 0) && e.plate) this.markPlate(e.plate);
    e.tier = t;
    const slots = e.ad.kind === 'column' ? Math.max(1, e.ad.slots ?? 1) : 1;
    e.group = t > 0 ? `${e.design}#${t}#${slots}` : null;
    if (e.group) {
      let g = this.groups.get(e.group);
      const d = this.designs.get(e.design);
      if (!g) {
        const mesh = faceGeo(e.ad.kind, slots).toMesh(`ad-${e.group}`, this.scene, false);
        mesh.isPickable = true;
        mesh.thinInstanceEnablePicking = true;
        mesh.receiveShadows = true;
        mesh.metadata = { kind: 'ad', group: e.group };
        if (d) { mesh.material = this.matFor(d, t); d.groups.add(e.group); }
        this.noGlow(mesh);
        g = { mesh, ids: [], dirty: true, design: e.design, tier: t, slots };
        this.groups.set(e.group, g);
      }
      g.dirty = true;
    }
  }

  private noGlow(mesh: Mesh): void {
    for (const l of this.scene.effectLayers) if (l instanceof GlowLayer) l.addExcludedMesh(mesh);
  }

  private flushGroup(key: string, g: Group): void {
    g.dirty = false;
    const list: Entry[] = [];
    for (const e of this.entries.values()) if (e.group === key) list.push(e);
    const d = this.designs.get(g.design);
    if (list.length === 0) {
      g.mesh.dispose(false, false);
      this.groups.delete(key);
      d?.groups.delete(key);
      return;
    }
    let n = 0;
    for (const e of list) n += e.ad.kind === 'poster' && e.ad.building < 0 ? 2 : 1;
    const m = new Float32Array(n * 16);
    g.ids = [];
    let i = 0;
    for (const e of list) {
      const a = e.ad;
      const y = e.gy + a.z;
      const twin = a.kind === 'poster' && a.building < 0; // free-standing panel: the same ad on both sides
      for (let k = 0; k < (twin ? 2 : 1); k++) {
        let ang = a.angle + (k ? Math.PI : 0);
        let x = a.x, z = a.y, sx = a.w, sz = 1;
        if (a.kind === 'column') {
          ang = a.angle + ((a.slot ?? 0) / Math.max(1, a.slots ?? 1)) * Math.PI * 2;
          sz = a.w;
        } else {
          const off = faceOff(a);
          x += Math.cos(ang) * off; z += Math.sin(ang) * off;
        }
        const th = Math.PI / 2 - ang;
        const c = Math.cos(th), s = Math.sin(th);
        m.set([sx * c, 0, -sx * s, 0, 0, a.h, 0, 0, sz * s, 0, sz * c, 0, x, y, z, 1], i * 16);
        g.ids.push(a.id);
        i++;
      }
    }
    g.mesh.thinInstanceSetBuffer('matrix', m, 16, true);
    if (d) g.mesh.material = this.matFor(d, g.tier);
  }

  private matFor(d: Design, tier: Tier): StandardMaterial {
    if (tier === 2 && d.hi) return d.hi.mat;
    if (d.lo) return d.lo.mat;
    return this.placeholder(d.ad.sponsor === -1 ? -1 : d.ad.hue);
  }

  private refreshGroups(d: Design): void {
    for (const k of d.groups) { const g = this.groups.get(k); if (g) g.mesh.material = this.matFor(d, g.tier); }
  }

  /** Flat stand-in (brand color) while a design waits for its texture. */
  private placeholder(hue: number): StandardMaterial {
    const k = hue < 0 ? -1 : Math.round(hue * 24) % 24;
    let m = this.placeholders.get(k);
    if (!m) {
      m = new StandardMaterial(`ad-wait-${k}`, this.scene);
      m.diffuseColor = k < 0 ? hx('#e4e2dc') : hsl(k / 24, 0.55, 0.55);
      m.specularColor = Color3.Black();
      const n = 0.1 + this.night * 0.3;
      m.emissiveColor = new Color3(n, n, n);
      this.placeholders.set(k, m);
    }
    return m;
  }

  /** Self-illumination of printed faces: a touch by day (so colors pop), lit boards and frames glow at night. */
  private glowOf(d: Design): Color3 {
    const n = this.night;
    const k = d.kind === 'billboard' ? 0.14 + n * 0.68
      : d.kind === 'column' ? 0.12 + n * 0.7
      : d.kind === 'banner' ? 0.1 + n * 0.22
      : d.kind === 'poster' ? (framed(d.ad) ? 0.12 + n * 0.66 : 0.08 + n * 0.14)
      : 0.08 + n * 0.12;
    return new Color3(k, k, k);
  }

  private plateGlow(): Color3 {
    const k = 0.12 + this.night * 0.5;
    return new Color3(k, k, k);
  }

  /** LED screens: brightness of the emissive texture (they barely care about daylight). */
  private screenLevel(): number {
    return 0.95 - this.night * 0.12;
  }

  private makeTexture(d: Design, hi: boolean): Tex {
    const long = TEX[d.kind][hi ? 0 : 1];
    const a = d.aspect;
    const W = Math.max(8, Math.round((a >= 1 ? long : long * a) / 4) * 4), H = Math.max(8, Math.round((a >= 1 ? long / a : long) / 4) * 4);
    const tex = new DynamicTexture(`adtex:${d.key}:${hi ? 'hi' : 'lo'}`, { width: W, height: H }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = hi ? 8 : 4;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    paintAd(ctx, W, H, d.ad, { owner: d.owner, screen: d.kind === 'screen' });
    const alpha = d.kind === 'flyer' || (d.kind === 'poster' && !framed(d.ad));
    tex.hasAlpha = alpha;
    tex.update(true);
    const mat = new StandardMaterial(`admat:${d.key}:${hi ? 'hi' : 'lo'}`, this.scene);
    if (d.kind === 'screen') {
      if (!d.avg) d.avg = averageColor(ctx, W, H);
      tex.level = this.screenLevel();
      mat.emissiveTexture = tex;
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      return { tex, mat };
    }
    mat.diffuseTexture = tex;
    mat.specularColor = d.kind === 'billboard' || d.kind === 'column' || framed(d.ad) ? new Color3(0.1, 0.1, 0.1) : new Color3(0.03, 0.03, 0.03);
    mat.emissiveColor = this.glowOf(d);
    if (d.kind === 'poster' || d.kind === 'flyer' || d.kind === 'column') mat.zOffset = -2;
    if (d.kind === 'banner') mat.backFaceCulling = false;
    return { tex, mat };
  }

  private makeTicker(d: Design): DynamicTexture {
    const tex = new DynamicTexture(`adtick:${d.key}`, { width: 1024, height: 64 }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    paintTicker(tex.getContext() as unknown as CanvasRenderingContext2D, 1024, 64, d.ad);
    tex.update(true);
    tex.level = this.screenLevel();
    return tex;
  }

  // ------------------------------------------------------------ screens

  private makeScreen(key: string, ad: AdPlacement, gy: number, chunk: string): Screen {
    const qa = quadMesh(`adscreen-a-${key}`, this.scene), qb = quadMesh(`adscreen-b-${key}`, this.scene), qt = quadMesh(`adscreen-t-${key}`, this.scene);
    const qh = quadMesh(`adscreen-h-${key}`, this.scene);
    const mat = (name: string) => {
      const m = new StandardMaterial(name, this.scene);
      m.disableLighting = true;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      return m;
    };
    const sc: Screen = {
      key, ref: ad, gy, chunk, slots: [], n: 1, phase: hashStr(key) * SLOT_SEC * 3, tier: 0, dist: 1e9, cur: -1, prev: -1, t0: 0, full: true,
      a: qa.mesh, b: qb.mesh, t: qt.mesh, halo: qh.mesh,
      matA: mat(`adscreen-ma-${key}`), matB: mat(`adscreen-mb-${key}`), matT: mat(`adscreen-mt-${key}`), matH: mat(`adscreen-mh-${key}`),
      posA: qa.pos, uvA: qa.uv, posB: qb.pos, uvB: qb.uv, plate: null,
    };
    sc.matT.zOffset = -1;
    const th = Math.PI / 2 - ad.angle, off = FACE_OFF.screen;
    const x = ad.x + Math.cos(ad.angle) * off, z = ad.y + Math.sin(ad.angle) * off;
    for (const [m, mt] of [[sc.a, sc.matA], [sc.b, sc.matB], [sc.t, sc.matT]] as [Mesh, StandardMaterial][]) {
      m.position.set(x, gy + ad.z, z);
      m.rotation.y = th;
      m.scaling.set(ad.w, ad.h, 1);
      m.material = mt;
      m.isPickable = true;
      m.metadata = { kind: 'ad', screen: key };
      m.setEnabled(false);
      m.freezeWorldMatrix();
      this.noGlow(m); // their own light spill (below) instead of the glow layer, which washes out the content
    }
    // light spilled on the facade around the screen at night: additive, tinted by the ad on air
    const bz = bezelOf(ad), hw = (ad.w + bz * 2) * (1 + HALO_PAD * 2), hh = (ad.h + bz * 2) * (1 + HALO_PAD * 2);
    const h = sc.halo, mh = sc.matH;
    h.position.set(ad.x + Math.cos(ad.angle) * 0.07, gy + ad.z, ad.y + Math.sin(ad.angle) * 0.07);
    h.rotation.y = th;
    h.scaling.set(hw, hh, 1);
    h.material = mh;
    h.isPickable = false;
    h.applyFog = false;
    h.setEnabled(false);
    h.freezeWorldMatrix();
    this.noGlow(h);
    mh.diffuseTexture = this.halo();
    mh.alphaMode = Constants.ALPHA_ADD;
    mh.transparencyMode = 2; // alpha blend
    mh.disableDepthWrite = true;
    mh.zOffset = -4;
    // the ticker strip sits over the band at the bottom of the design, right of its logo block
    const pt = new Float32Array(12), ut = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
    const bandAspect = ((1 - TICKER_LOGO) * ad.w) / (TICKER_BAND * ad.h);
    setSpan(pt, ut, TICKER_LOGO, 1, 0, bandAspect / 16, -0.5, -0.5 + TICKER_BAND * 0.93);
    for (let k = 0; k < 4; k++) pt[k * 3 + 2] = 0.004;
    sc.t.updateVerticesData(VertexBuffer.PositionKind, pt);
    sc.t.updateVerticesData(VertexBuffer.UVKind, ut);
    return sc;
  }

  private disposeScreen(sc: Screen): void {
    for (const m of [sc.a, sc.b, sc.t, sc.halo]) m.dispose(false, false);
    for (const m of [sc.matA, sc.matB, sc.matT, sc.matH]) m.dispose();
  }

  /** Shared falloff texture of the screens' light spill: full inside the cabinet's rectangle, fading outward. */
  private halo(): DynamicTexture {
    if (this.haloTex) return this.haloTex;
    const S = 128;
    const tex = new DynamicTexture('adscreen-halo', { width: S, height: S }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const img = ctx.createImageData(S, S);
    const inner = HALO_PAD / (1 + HALO_PAD * 2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S, v = (y + 0.5) / S;
        const dx = Math.max(0, inner - u, u - (1 - inner)) / inner, dy = Math.max(0, inner - v, v - (1 - inner)) / inner;
        const k = Math.max(0, 1 - Math.hypot(dx, dy));
        const c = Math.round(255 * k * k);
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = c;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update(true);
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.haloTex = tex;
    return tex;
  }

  /** The slot on air at time t (skipping empty slots), -1 if none. */
  private slotAt(sc: Screen, t: number): number {
    let s = Math.floor((t + sc.phase) / SLOT_SEC) % sc.n;
    for (let k = 0; k < sc.n; k++) {
      if (sc.slots[s]) return s;
      s = (s + 1) % sc.n;
    }
    return -1;
  }

  /** Best texture available for a slot (high-res near the camera). */
  private slotTex(sc: Screen, slot: number): DynamicTexture | null {
    const e = sc.slots[slot];
    const d = e && this.designs.get(e.design);
    if (!d) return null;
    return (sc.tier === 2 && d.hi ? d.hi.tex : d.lo?.tex) ?? d.hi?.tex ?? null;
  }

  private setScreenTex(m: StandardMaterial, tex: DynamicTexture | null, hue: number): void {
    if (m.emissiveTexture !== tex) m.emissiveTexture = tex;
    if (!tex) m.emissiveColor = hsl(hue, 0.5, 0.3);
    else if (m.emissiveColor.r !== 0) m.emissiveColor = Color3.Black();
  }

  private updateScreen(sc: Screen, now: number): void {
    const s = this.slotAt(sc, now);
    if (s < 0) { for (const m of [sc.a, sc.b, sc.t, sc.halo]) m.setEnabled(false); return; }
    const near = sc.dist < ANIM_DIST;
    // light spill at night, tinted by the ad on air
    const lit = this.night > 0.04;
    sc.halo.setEnabled(lit);
    if (lit) {
      const avg = this.designs.get(sc.slots[s]!.design)?.avg;
      const k = this.night * 0.5;
      if (avg) sc.matH.emissiveColor.set(avg.r * k, avg.g * k, avg.b * k);
      else sc.matH.emissiveColor.set(k * 0.6, k * 0.6, k * 0.6);
    }
    if (s !== sc.cur) {
      sc.prev = near && sc.cur >= 0 && sc.slots[sc.cur] ? sc.cur : -1;
      sc.t0 = now;
      sc.cur = s;
    }
    const hue = sc.slots[s]!.ad.hue;
    if (sc.prev >= 0 && sc.slots[sc.prev]) {
      const k = (now - sc.t0) / SLIDE_SEC;
      if (k >= 1 || k < 0) sc.prev = -1;
      else {
        // push: the old ad slides out to the left as the new one comes in from the right
        const e = ease(k);
        setSpan(sc.posA, sc.uvA, 0, 1 - e, e, 1);
        setSpan(sc.posB, sc.uvB, 1 - e, 1, 0, e);
        sc.a.updateVerticesData(VertexBuffer.PositionKind, sc.posA);
        sc.a.updateVerticesData(VertexBuffer.UVKind, sc.uvA);
        sc.b.updateVerticesData(VertexBuffer.PositionKind, sc.posB);
        sc.b.updateVerticesData(VertexBuffer.UVKind, sc.uvB);
        sc.full = false;
        this.setScreenTex(sc.matA, this.slotTex(sc, sc.prev), sc.slots[sc.prev]!.ad.hue);
        this.setScreenTex(sc.matB, this.slotTex(sc, s), hue);
        sc.a.setEnabled(true);
        sc.b.setEnabled(true);
        sc.t.setEnabled(false);
        return;
      }
    }
    if (!sc.full) {
      setSpan(sc.posA, sc.uvA, 0, 1, 0, 1);
      sc.a.updateVerticesData(VertexBuffer.PositionKind, sc.posA);
      sc.a.updateVerticesData(VertexBuffer.UVKind, sc.uvA);
      sc.full = true;
    }
    this.setScreenTex(sc.matA, this.slotTex(sc, s), hue);
    sc.a.setEnabled(true);
    sc.b.setEnabled(false);
    const d = this.designs.get(sc.slots[s]!.design);
    const tick = near && sc.tier === 2 && !!d?.band && !!d.ticker && !!d.hi;
    if (tick && sc.matT.emissiveTexture !== d!.ticker) sc.matT.emissiveTexture = d!.ticker;
    sc.t.setEnabled(tick);
  }

  // ------------------------------------------------------------ plates

  private markPlate(key: string): void {
    const p = this.plates.get(key);
    if (p) p.dirty = true;
  }

  private flushPlate(p: Plate): void {
    p.dirty = false;
    const mats: number[] = [];
    const ids: number[] = [];
    const put = (a: AdPlacement, gy: number, lx: number, ly: number, lz: number, w: number, h: number) => {
      const th = Math.PI / 2 - a.angle, c = Math.cos(th), s = Math.sin(th);
      // local (lx, ly, lz) in the ad's frame: x -> (c, -s), z -> (s, c)
      const x = a.x + c * lx + s * lz, z = a.y - s * lx + c * lz;
      mats.push(w * c, 0, -w * s, 0, 0, h, 0, 0, s, 0, c, 0, x, gy + ly, z, 1);
      ids.push(a.id);
    };
    for (const e of this.entries.values()) {
      if (e.plate !== p.key || e.tier === 0) continue;
      const a = e.ad, ph = Math.min(0.42, Math.max(0.26, a.h * 0.11)), pw = ph * 4.6;
      put(a, e.gy, 0, a.z - a.h / 2 - 0.07, 0.062, pw, ph);
    }
    for (const sc of this.screens.values()) {
      if (sc.plate !== p.key || sc.tier === 0) continue;
      // the operator's logo on the bottom bezel, at the right-hand corner (local -x is the viewer's right)
      const a = sc.ref, bz = bezelOf(a), ph = bz * 0.8, pw = ph * 4.6;
      put(a, sc.gy, -a.w / 2 + pw / 2 + 0.15, a.z - a.h / 2 - bz / 2, FACE_OFF.screen + 0.045, pw, ph);
    }
    if (!ids.length) {
      p.mesh?.dispose(false, false); p.mesh = null;
      p.tex?.dispose(); p.tex = null;
      p.mat?.dispose(); p.mat = null;
      p.ids = [];
      return;
    }
    if (!p.mat) {
      const tex = new DynamicTexture(`adplate:${p.key}`, { width: 256, height: 56 }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = 4;
      paintPlate(tex.getContext() as unknown as CanvasRenderingContext2D, 256, 56, p.name, p.hue);
      tex.update(true);
      const mat = new StandardMaterial(`adplatemat:${p.key}`, this.scene);
      mat.diffuseTexture = tex;
      mat.specularColor = new Color3(0.15, 0.15, 0.15);
      mat.emissiveColor = this.plateGlow();
      mat.zOffset = -2;
      p.tex = tex; p.mat = mat;
    }
    if (!p.mesh) {
      p.mesh = faceGeo('billboard').toMesh(`adplate-${p.key}`, this.scene, false);
      p.mesh.material = p.mat;
      p.mesh.isPickable = true;
      p.mesh.thinInstanceEnablePicking = true;
      p.mesh.receiveShadows = true;
      p.mesh.metadata = { kind: 'ad', plate: p.key };
      this.noGlow(p.mesh);
    }
    p.ids = ids;
    p.mesh.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
  }

  // ------------------------------------------------------------ frames

  private markChunk(key: string): void {
    let ch = this.chunks.get(key);
    if (!ch) { ch = { solid: null, lamps: null, dirty: true }; this.chunks.set(key, ch); }
    ch.dirty = true;
  }

  /** Steel, frames, catwalks, lamps, screen housings, column bodies, rods and tape for every ad in one area. */
  private flushChunk(key: string, ch: Chunk): void {
    ch.dirty = false;
    for (const m of [ch.solid, ch.lamps]) if (m) { if (this.shadows) this.shadows.removeShadowCaster(m, false); m.dispose(false, false); }
    ch.solid = ch.lamps = null;
    const t = new Xf();
    const g = new Geo(t), lamps = new Geo(t);
    let any = false;
    const columns = new Set<string>();
    for (const e of this.entries.values()) {
      if (e.chunk !== key || e.screen) continue;
      any = true;
      const a = e.ad;
      if (a.kind === 'column') {
        const ck = columnKey(a);
        if (columns.has(ck)) continue;
        columns.add(ck);
      }
      t.push(a.x, e.gy, a.y, Math.PI / 2 - a.angle);
      if (a.kind === 'billboard') billboardFrame(g, lamps, a, a.building < 0);
      else if (a.kind === 'banner') bannerRig(g, a);
      else if (a.kind === 'flyer') flyerBits(g, a);
      else if (a.kind === 'column') columnBody(g, lamps, a);
      else if (a.kind === 'poster') posterFrame(g, lamps, a);
      t.pop();
    }
    for (const sc of this.screens.values()) {
      if (sc.chunk !== key) continue;
      any = true;
      const a = sc.ref;
      t.push(a.x, sc.gy, a.y, Math.PI / 2 - a.angle);
      screenHousing(g, a);
      t.pop();
    }
    if (!any) { this.chunks.delete(key); return; }
    if (!g.empty) {
      ch.solid = g.toMesh(`adframes-${key}`, this.scene);
      ch.solid.material = this.solidMat;
      ch.solid.isPickable = false;
      ch.solid.receiveShadows = true;
      ch.solid.freezeWorldMatrix();
      if (this.shadows) this.shadows.addShadowCaster(ch.solid, false);
    }
    if (!lamps.empty) {
      ch.lamps = lamps.toMesh(`adlamps-${key}`, this.scene);
      ch.lamps.material = this.lampMat;
      ch.lamps.isPickable = false;
      ch.lamps.freezeWorldMatrix();
    }
  }
}

// ------------------------------------------------------------ structures (local frame: ground at y = 0, face center at (0, z, 0) facing +Z)

const STEEL = hx('#7d858c'), DARKF = hx('#2b2e32'), GRATE = hx('#5a5f66'), CONC = hx('#a9a59c'), BEZEL = hx('#16181b'), ALU = hx('#b9bec3');

const bezelOf = (a: AdPlacement) => Math.max(0.16, Math.min(0.35, Math.min(a.w, a.h) * 0.035));

function screenHousing(g: Geo, a: AdPlacement): void {
  const W = a.w, H = a.h, zc = a.z, d = FACE_OFF.screen, b = bezelOf(a);
  const bot = zc - H / 2, top = zc + H / 2;
  // cabinet from the wall to just behind the LED face, a bezel lip around it, a thin rain cap on top
  g.box(0, bot - b, (d - 0.02) / 2 - 0.02, W + b * 2, H + b * 2, d + 0.02, mix(BEZEL, STEEL, 0.25));
  for (const [x, y, w, h] of [[0, top, W + b * 2, b], [0, bot - b, W + b * 2, b], [-W / 2 - b / 2, bot, b, H], [W / 2 + b / 2, bot, b, H]]) g.box(x, y, d, w, h, 0.08, BEZEL);
  g.box(0, top + b, d / 2, W + b * 2 + 0.1, 0.07, d + 0.16, DARKF);
  // service brackets under the cabinet
  for (const x of [-W * 0.25, W * 0.25]) g.box(x, bot - b - 0.25, d / 2 - 0.05, 0.12, 0.25, d - 0.1, STEEL);
}

function billboardFrame(g: Geo, lamps: Geo, a: AdPlacement, free: boolean): void {
  const W = a.w, H = a.h, zc = a.z;
  const bot = zc - H / 2, top = zc + H / 2;
  // back panel + a lip around the face
  g.box(0, bot - 0.18, -0.22, W + 0.36, H + 0.36, 0.34, DARKF);
  for (const [x, y, w, h] of [[0, top, W + 0.36, 0.14], [0, bot - 0.14, W + 0.36, 0.14], [-W / 2 - 0.11, bot, 0.14, H], [W / 2 + 0.11, bot, 0.14, H]]) g.box(x, y, 0.0, w, h, 0.1, DARKF);
  // bracing behind
  for (const fy of [0.25, 0.75]) g.box(0, bot + H * fy, -0.5, W, 0.12, 0.12, STEEL);
  const legs = free ? (W > 7 ? [-W * 0.28, W * 0.28] : [0]) : (W > 6 ? [-W * 0.36, 0, W * 0.36] : [-W * 0.3, W * 0.3]);
  for (const x of legs) {
    if (free) {
      g.cyl(x, 0, -0.6, 0.7, 0.7, 0.35, 10, CONC);
      g.cyl(x, 0.35, -0.6, 0.34, 0.28, bot - 0.2, 10, STEEL);
      g.beam(x, bot - 0.1, -0.6, x - W * 0.2, bot + H * 0.5, -0.45, 0.12, STEEL);
      g.beam(x, bot - 0.1, -0.6, x + W * 0.2, bot + H * 0.5, -0.45, 0.12, STEEL);
      // a ladder up the leg
      if (x === legs[0]) {
        for (const sx of [-0.2, 0.2]) g.box(x + sx, 0.4, -1.0, 0.04, bot - 0.5, 0.04, STEEL, 0, false);
        for (let y = 0.7; y < bot - 0.2; y += 0.35) g.box(x, y, -1.0, 0.4, 0.03, 0.03, STEEL, 0, false);
      }
    } else {
      // rooftop frame: posts down to the roof and back braces
      g.box(x, bot - 2.6, -0.45, 0.16, 2.6 + H * 0.9, 0.16, STEEL);
      g.beam(x, bot + H * 0.6, -0.45, x, bot - 2.6, -2.6, 0.12, STEEL);
      g.box(x, bot - 2.6, -1.5, 0.4, 0.12, 2.6, STEEL);
    }
  }
  // catwalk with a railing (free-standing boards)
  if (free) {
    g.box(0, bot - 0.32, 0.5, W + 0.4, 0.06, 0.95, GRATE);
    for (let x = -W / 2; x <= W / 2 + 0.01; x += W / Math.max(2, Math.round(W / 2))) g.box(x, bot - 0.26, 0.95, 0.04, 1.0, 0.04, STEEL, 0, false);
    g.box(0, bot + 0.72, 0.95, W + 0.4, 0.05, 0.05, STEEL, 0, false);
    for (const x of legs) g.beam(x, bot - 0.32, 0.0, x, bot - 1.4, -0.55, 0.1, STEEL);
  }
  // lamps on arms over the top edge, shining down on the face
  const n = Math.max(2, Math.round(W / 3));
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + ((i + 0.5) / n) * W;
    g.beam(x, top + 0.05, -0.15, x, top + 0.5, 0.85, 0.06, STEEL);
    g.box(x, top + 0.38, 0.9, 0.42, 0.16, 0.3, DARKF);
    lamps.box(x, top + 0.33, 0.9, 0.34, 0.05, 0.24, hx('#fff2cc'), 0, true);
  }
}

/** Lit aluminium frame for framed posters; a city-light panel on a foot for free-standing ones. */
function posterFrame(g: Geo, lamps: Geo, a: AdPlacement): void {
  if (!framed(a) && a.building >= 0) return;
  const W = a.w, H = a.h, zc = a.z, bot = zc - H / 2, top = zc + H / 2, f = 0.06;
  if (a.building < 0) {
    // double-sided panel: housing, frame on both faces, a foot and a lit top edge
    const d = 0.16;
    g.box(0, bot - f, 0, W + f * 2, H + f * 2, d, hx('#3d4248'));
    for (const s of [-1, 1]) {
      for (const [x, y, w, h] of [[0, top, W + f * 2, f], [0, bot - f, W + f * 2, f], [-W / 2 - f / 2, bot, f, H], [W / 2 + f / 2, bot, f, H]]) g.box(x, y, s * (d / 2 + 0.01), w, h, 0.03, ALU);
    }
    g.box(0, 0, 0, Math.min(0.5, W * 0.4), bot - f, d * 0.8, hx('#3d4248'));
    g.box(0, 0, 0, W * 0.7, 0.06, d + 0.24, hx('#2e3236'));
    lamps.box(0, top + f, 0, W * 0.9, 0.025, d * 0.6, hx('#fff2cc'));
    return;
  }
  const z = faceOff(a);
  g.box(0, bot - f, z / 2 - 0.01, W + f * 2, H + f * 2, z - 0.005, hx('#4a4f55'));
  for (const [x, y, w, h] of [[0, top, W + f * 2, f], [0, bot - f, W + f * 2, f], [-W / 2 - f / 2, bot, f, H], [W / 2 + f / 2, bot, f, H]]) g.box(x, y, z, w, h, 0.03, ALU);
}

/** A round advertising column: classic (green, dome cap and finial) or modern (steel, lit top ring). */
function columnBody(g: Geo, lamps: Geo, a: AdPlacement): void {
  const r = a.w / 2, bot = a.z - a.h / 2, top = a.z + a.h / 2;
  const seed = hashStr(columnKey(a));
  const classic = rnd(seed, 1) < 0.6;
  const body = r - 0.012;
  if (classic) {
    const green = hx(rnd(seed, 2) < 0.7 ? '#3f6a52' : '#5d646c'), trim = mix(green, hx('#d8d0b8'), 0.3);
    g.cyl(0, 0, 0, r + 0.1, r + 0.08, 0.14, 20, green);
    g.cyl(0, 0.14, 0, r + 0.04, r + 0.03, 0.1, 20, trim);
    g.cyl(0, 0.24, 0, body, body, top - 0.24 + 0.02, 22, green, 0, false);
    g.cyl(0, bot - 0.07, 0, r + 0.025, r + 0.025, 0.06, 22, trim);
    g.cyl(0, top + 0.01, 0, r + 0.03, r + 0.05, 0.08, 22, trim);
    g.cyl(0, top + 0.09, 0, r + 0.05, r + 0.13, 0.1, 22, green);
    g.blob(0, top + 0.19, 0, r + 0.12, 0.34, r + 0.12, green, 16, 6, true);
    g.cyl(0, top + 0.5, 0, 0.07, 0.07, 0.06, 8, hx('#b59a52'));
    g.cyl(0, top + 0.56, 0, 0.05, 0, 0.26, 8, hx('#b59a52'));
    // a little lamp under the cornice lights the ads at night
    lamps.cyl(0, top + 0.06, 0, r + 0.035, r + 0.035, 0.03, 22, hx('#fff2cc'), 0, false);
  } else {
    const steel = hx('#6a727b'), light = hx('#d5dade');
    g.cyl(0, 0, 0, r + 0.04, r + 0.04, 0.08, 22, hx('#2e3236'));
    g.cyl(0, 0.08, 0, body, body, top + 0.02 - 0.08, 22, steel, 0, false);
    g.cyl(0, bot - 0.06, 0, r + 0.02, r + 0.02, 0.05, 22, light);
    g.cyl(0, top + 0.02, 0, r + 0.02, r + 0.02, 0.05, 22, light);
    g.cyl(0, top + 0.12, 0, r + 0.06, r + 0.06, 0.14, 22, steel);
    lamps.cyl(0, top + 0.07, 0, r + 0.03, r + 0.03, 0.05, 22, hx('#e8f4ff'), 0, false);
  }
}

function bannerRig(g: Geo, a: AdPlacement): void {
  const W = a.w, H = a.h, zc = a.z, off = FACE_OFF.banner;
  const bot = zc - H / 2, top = zc + H / 2;
  g.tube(-W / 2 - 0.08, top + 0.03, off, W / 2 + 0.08, top + 0.03, off, 0.035, 6, STEEL);
  g.tube(-W / 2 - 0.05, bot - 0.03, off, W / 2 + 0.05, bot - 0.03, off, 0.03, 6, STEEL);
  for (const sx of [-1, 1]) {
    g.beam(sx * (W / 2 - 0.05), top + 0.03, 0.0, sx * (W / 2 - 0.05), top + 0.03, off, 0.04, STEEL);
    g.box(sx * (W / 2 - 0.05), top - 0.05, 0.01, 0.12, 0.16, 0.03, STEEL);
    g.beam(sx * (W / 2 - 0.05), bot - 0.03, off, sx * (W / 2 + 0.2), bot - 0.4, 0.01, 0.012, hx('#d8d2c4'));
  }
}

function flyerBits(g: Geo, a: AdPlacement): void {
  const W = a.w, H = a.h, zc = a.z;
  const seed = a.id * 0.137 + a.sponsor * 0.011;
  const wrap = (u: number, r: number): [number, number] => { const th = (u * W) / r; return [r * Math.sin(th), r * (Math.cos(th) - 1) - (POLE_R - r)]; };
  // older flyers underneath, partly torn away
  const old = Math.floor(rnd(seed, 1) * 3);
  for (let k = 0; k < old; k++) {
    const r = POLE_R - 0.004 * (k + 1);
    const dy = (rnd(seed, 10 + k) - 0.5) * 0.18, du = (rnd(seed, 20 + k) - 0.5) * 0.3;
    const col = mix(hsl(rnd(seed, 30 + k), 0.4, 0.75), C.white, 0.35);
    const torn = 0.3 + rnd(seed, 40 + k) * 0.6; // fraction of height left
    const n = 6;
    for (let i = 0; i < n; i++) {
      const u0 = -0.5 + i / n + du, u1 = -0.5 + (i + 1) / n + du;
      const [x0, z0] = wrap(u0, r), [x1, z1] = wrap(u1, r);
      const yt = zc + H / 2 + dy, yb0 = yt - H * (torn + rnd(seed, 50 + k * 10 + i) * 0.15), yb1 = yt - H * (torn + rnd(seed, 51 + k * 10 + i) * 0.15);
      g.poly([x0, yb0, z0, x1, yb1, z1, x1, yt, z1, x0, yt, z0], col, (x0 + x1) / 2, 0, 1 + (z0 + z1) * 4);
    }
  }
  // tape strips at the top corners (and sometimes the bottom)
  const tape = hx('#e8e2cf');
  for (const u of [-0.42, 0.42]) {
    const [x, z] = wrap(u, POLE_R + 0.002);
    g.poly([x - 0.035, zc + H / 2 - 0.03, z + 0.001, x + 0.035, zc + H / 2 - 0.03, z + 0.001, x + 0.035, zc + H / 2 + 0.035, z, x - 0.035, zc + H / 2 + 0.035, z], tape, x, 0, 1);
  }
  if (rnd(seed, 60) < 0.6) {
    const [x, z] = wrap(0, POLE_R + 0.002);
    g.poly([x - 0.05, zc - H / 2 - 0.02, z, x + 0.05, zc - H / 2 - 0.02, z, x + 0.05, zc - H / 2 + 0.03, z + 0.001, x - 0.05, zc - H / 2 + 0.03, z + 0.001], tape, 0, 0, 1);
  }
}
