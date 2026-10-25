// Generation context for the building renderer: one Ctx per building build
// holds the transform stack, the vertex buffers (solid, lit surfaces, clear
// glass, cutaway ghost walls, interior), the sign parts and the prop lists,
// plus the shared low-level pieces every kind uses (windows, doors, signs,
// yard props, roofs, fences, cranes).
//
// Local space: front = +Z (toward the street), right = +X, ground at y = 0,
// centered on the building (same convention as sim/layout.ts).

import { Color3 } from '@babylonjs/core';
import {
  C, GLASS_DAY, GLOW_BULB, Geo, Lit, P, WIN_BASE, WS, Xf,
  clamp01, hsl, hx, shade, type Body, type WinState,
} from './buildingGeo';
import { hash2 } from '../sim/rng';
import type { Building } from '../sim/types';
import { PropList, type Host } from './props';
import { dressWindow, doorExtras, officeBlind, windowExtras } from './propsExterior';

export interface BuildingLook {
  lotW: number; lotD: number; // lot size (yard drawing)
  ground: number; // Babylon Y of the ground at the building
  firmName?: string; // sign text, if operated by a firm
  firmHue?: number; // 0..1 brand color
  ownerColor?: Color3 | null; // ownership overlay marker
  /** TV studios: the "ON AIR" light is lit while a broadcast is running. */
  live?: boolean;
  /** The lot center's local z (the building stands toward the lot's front: usually negative). */
  lotZ?: number;
  /**
   * The lot's ground is drawn by the field renderer, laid on the terrain (countryside farms and farmhouses,
   * whose lots aren't leveled): don't draw a flat lot slab.
   */
  draped?: boolean;
  /** Height of the drawn ground at a world point (sim x, y), for things standing around on unleveled ground. */
  terrain?: (x: number, y: number) => number;
  /** Bend the building to meet the unleveled ground under it (settle.ts). */
  settle?: boolean;
}

/** A unit inside a tower (a shop on the ground floor, a leased office floor), in the tower's local frame. */
export interface HostedUnit {
  b: Building;
  look: BuildingLook;
  /** Center of the unit in the tower's local frame. */
  lx: number; lz: number;
  level: number;
}

export type PaneKind = 'res' | 'shop' | 'ind' | 'off' | 'lobby' | 'none';

/**
 * Sign looks: brand color panel, carved stone lettering, a lit / unlit "ON AIR" box, a "FOR LEASE" board, metal letters on stone,
 * a hospital's white "H" on blue, a medical practice's name beside a heart pictogram, a red "EMERGENCY" band.
 * (Never a red cross: it's a protected emblem.)
 */
export type SignStyle = 'brand' | 'carved' | 'onair' | 'offair' | 'lease' | 'metal' | 'hospital' | 'medical' | 'emergency';
export interface SignPart { geo: Geo; text: string; hue: number; aspect: number; style: SignStyle; owner: number }

/** Part of a mesh (a range of its triangles) that picks as another building: a shop in a tower's podium. */
export interface Mark { id: number; from: Map<Geo, number>; to: Map<Geo, number> }

/** Residential glass: neutral dark grey (it shows the sky reflection), lit warm at night. */
export const GLASS_RES = hx('#3f4247');
/** Shop windows by day. */
export const GLASS_SHOP = hx('#454b52');

/** Everything needed while generating one building. */
export class Ctx implements Host {
  t: Xf;
  /** Prop instances (only filled when `near` or `closeUp`). */
  props: PropList;
  /** Props inside a cut-open building (room light at night). */
  insideProps: PropList;
  /** Interior geometry of a cut-open building and shop interiors seen through glass (room light at night). */
  inside: Geo;
  solid: Geo; clear: Geo; ghost: Geo;
  /** Windows, lamps, screens, crown lights: one buffer, lighting state per surface (see WS). */
  win: Geo;
  /** Lamps, furnace mouths, LED strips: glow in their own color at night. */
  warm: Geo;
  glow: Geo;
  /** Glossy unlit surfaces that reflect the sky: solar panels, water, dark glass. */
  glass: Geo;
  /** Always-lit surfaces: screens, LED panels, the ON AIR box. */
  screen: Geo;
  signs: Map<string, SignPart>;
  marks: Mark[];
  lw: number; ld: number;
  hue: number; brand: Color3; brandDark: Color3;
  body: Body | null = null;
  officeTint: Color3 = P.officeGlass[0];
  /** Chance a residential window belongs to a lived-in flat (towers use the actual occupancy). */
  litRes = 0.7;
  litInd = 0.35;
  litOff = 0.85;
  /** Units hosted by this building (tower shops and office floors). */
  units: HostedUnit[] = [];
  /** Towers: the floor opened up in cutaway (-1 = the whole building is opened). */
  cutLevel = -1;
  /** Sign texts of this build that belong to a hosted unit (picking). */
  signOwner = -1;
  private views: Map<string, Lit>;
  private counter: { n: number };

  /**
   * near: the camera is close, add fine exterior detail (curtains, flower boxes, rooftop units...).
   * closeUp: the building is cut open and the camera is close: furnish the interior with small props.
   * share: build into another context's buffers (a hosted unit drawn as part of its tower).
   */
  constructor(readonly b: Building, readonly look: BuildingLook, readonly cut: boolean, readonly near = false, readonly closeUp = false, share?: Ctx) {
    if (share) {
      this.t = share.t;
      this.props = share.props; this.insideProps = share.insideProps;
      this.inside = share.inside; this.solid = share.solid; this.clear = share.clear; this.ghost = share.ghost; this.win = share.win;
      this.signs = share.signs; this.marks = share.marks;
      this.views = share.views; this.counter = share.counter;
      this.lw = share.lw; this.ld = share.ld;
      this.cutLevel = share.cutLevel;
    } else {
      this.t = new Xf();
      this.props = new PropList(b.x, look.ground, b.y, Math.PI / 2 - b.angle);
      this.insideProps = new PropList(b.x, look.ground, b.y, Math.PI / 2 - b.angle, true);
      this.inside = new Geo(this.t);
      this.solid = new Geo(this.t); this.clear = new Geo(this.t); this.ghost = new Geo(this.t);
      this.win = new Geo(this.t, true);
      this.signs = new Map();
      this.marks = [];
      this.views = new Map();
      this.counter = { n: 0 };
      const wear = clamp01(1 - b.condition) * (b.ruined ? 0.3 : 1);
      this.solid.wear = wear; this.ghost.wear = wear; this.inside.wear = wear * 0.5;
      this.lw = Math.max(look.lotW || 0, b.w + 1);
      this.ld = Math.max(look.lotD || 0, b.d + 1);
    }
    // lamps: their color dimmed by day (an unlit bulb), glowing at night
    this.warm = this.lit(WS.lamp, 1.6);
    this.glow = this.warm;
    this.glass = this.lit(WS.dark);
    this.screen = this.lit(WS.screen);
    this.hue = look.firmHue ?? hash2(b.seed, 991);
    this.brand = hsl(this.hue, 0.62, 0.48);
    this.brandDark = hsl(this.hue, 0.55, 0.3);
  }

  r(k: number): number { return hash2(this.b.seed, k); }
  pick<T>(arr: readonly T[], k: number): T { return arr[Math.floor(this.r(k) * arr.length) % arr.length]; }
  /** Walls go to the transparent ghost mesh in cutaway mode. */
  get wall(): Geo { return this.cut ? this.ghost : this.solid; }

  /** A view of the lit-surface buffer in one lighting state (gain < 1/WIN_BASE: darker by day, e.g. curtains behind glass). */
  lit(state: WinState | number, gain = 1 / WIN_BASE): Lit {
    const key = `${state}|${gain}`;
    let v = this.views.get(key);
    if (!v) { v = new Lit(this.win, state, gain); this.views.set(key, v); }
    return v;
  }

  /** A running window number (deterministic per build: picks each pane's lighting state). */
  nextPane(): number { return this.counter.n++; }

  /** Start a part of the building that picks as building `id` (until `endMark`). */
  mark(id: number): void {
    const from = new Map<Geo, number>();
    for (const g of [this.solid, this.win, this.clear, this.inside]) from.set(g, g.tris);
    this.marks.push({ id, from, to: new Map() });
  }

  endMark(): void {
    const m = this.marks[this.marks.length - 1];
    if (!m || m.to.size) return;
    for (const g of [this.solid, this.win, this.clear, this.inside]) m.to.set(g, g.tris);
  }

  /** Run `fn` in the frame of each wall of a W x D body centered at (cx, cz): local +Z = outward, x along the wall. */
  sides(cx: number, cz: number, W: number, D: number, fn: (side: number, len: number) => void, only?: number[]): void {
    for (let s = 0; s < 4; s++) {
      if (only && !only.includes(s)) continue;
      const ox = s === 1 ? cx + W / 2 : s === 3 ? cx - W / 2 : cx;
      const oz = s === 0 ? cz + D / 2 : s === 2 ? cz - D / 2 : cz;
      const rot = s === 0 ? 0 : s === 1 ? Math.PI / 2 : s === 2 ? Math.PI : -Math.PI / 2;
      this.t.push(ox, 0, oz, rot);
      fn(s, s % 2 === 0 ? W : D);
      this.t.pop();
    }
  }

  /**
   * Lighting state of a window: `use` = chance the room behind it is in use (a lived-in flat, a
   * leased office floor). Flats and offices light up and go dark at different hours.
   */
  paneState(kind: PaneKind, n: number, use?: number): WinState {
    const s = this.b.seed;
    const h = hash2(s, 7000 + n), k = hash2(s, 7600 + n);
    switch (kind) {
      case 'shop': return WS.shop;
      case 'lobby': return WS.lobby;
      case 'none': return WS.dark;
      case 'res': {
        if (h >= (use ?? this.litRes)) return WS.dark;
        return k < 0.38 ? WS.resA : k < 0.6 ? WS.resB : k < 0.78 ? WS.resC : k < 0.84 ? WS.resAll : k < 0.92 ? WS.tv : WS.dark;
      }
      case 'off': {
        if (h >= (use ?? this.litOff)) return k < 0.05 ? WS.security : WS.dark;
        return k < 0.45 ? WS.offA : k < 0.72 ? WS.offB : k < 0.84 ? WS.offAll : WS.dark;
      }
      case 'ind': return h < (use ?? this.litInd) ? (k < 0.6 ? WS.offA : WS.offB) : WS.dark;
    }
    return WS.dark;
  }

  /** A glass pane in the current wall frame (facing +Z); lit at night depending on its kind. */
  pane(x0: number, y0: number, x1: number, y1: number, z: number, kind: PaneKind, use?: number): void {
    if (this.cut) return;
    const n = this.counter.n++;
    const state = this.paneState(kind, n, use);
    const pts = [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
    if (kind === 'off') {
      const tint = shade(this.officeTint, 0.94 + hash2(this.b.seed, 9000 + n) * 0.12);
      this.lit(state).poly(pts, tint, 0, 0, 1);
      if (this.near) officeBlind(this, x0, y0, x1, y1, z, this.lit(state, 1.6), n, state !== WS.dark);
      return;
    }
    this.lit(state).poly(pts, kind === 'shop' || kind === 'lobby' ? GLASS_SHOP : GLASS_RES, 0, 0, 1);
    if (this.near && kind === 'res') dressWindow(this, x0, y0, x1, y1, z, this.lit(state, 1.6), n, state !== WS.dark);
  }

  /** A framed window in the current wall frame. y = sill height. */
  window(x: number, y: number, w: number, h: number, kind: PaneKind, frame: Color3, opts: { cross?: boolean; sill?: boolean; shutters?: Color3 | null; arch?: boolean; use?: number } = {}): void {
    if (this.cut) return;
    const g = this.solid;
    g.box(x, y - 0.08, 0.02, w + 0.16, h + 0.16, 0.08, frame, 0, false);
    this.pane(x - w / 2, y, x + w / 2, y + h, 0.065, kind, opts.use);
    if (opts.cross) {
      // muntins as flat strips on the glass
      g.quad(x - 0.03, y, 0.075, x + 0.03, y, 0.075, x + 0.03, y + h, 0.075, x - 0.03, y + h, 0.075, frame, 0, 0, 1);
      g.quad(x - w / 2, y + h * 0.55 - 0.03, 0.076, x + w / 2, y + h * 0.55 - 0.03, 0.076, x + w / 2, y + h * 0.55 + 0.03, 0.076, x - w / 2, y + h * 0.55 + 0.03, 0.076, frame, 0, 0, 1);
    }
    if (opts.sill !== false) g.box(x, y - 0.14, 0.08, w + 0.32, 0.08, 0.2, frame);
    if (opts.arch) g.box(x, y + h + 0.06, 0.06, w + 0.36, 0.18, 0.12, frame);
    if (this.near) windowExtras(this, x, y, w, h, kind, frame, opts.sill !== false);
    if (opts.shutters) {
      g.box(x - w / 2 - 0.3, y, 0.06, 0.42, h, 0.05, opts.shutters, 0, false);
      g.box(x + w / 2 + 0.3, y, 0.06, 0.42, h, 0.05, opts.shutters, 0, false);
    }
  }

  /** A sign board in the current frame, facing +Z, centered at (x, y + h/2, z). */
  sign(text: string | undefined, x: number, y: number, w: number, h: number, z = 0.02, back?: Color3 | null, style: SignStyle = 'brand'): void {
    if (this.cut) return; // signs would float in front of the opened-up rooms
    if (style !== 'carved' && style !== 'metal' && back !== null) this.solid.box(x, y - 0.06, z + 0.05, w + 0.14, h + 0.12, 0.1, back ?? this.brandDark);
    const zf = z + (back === null ? 0.01 : 0.105);
    if (!text) {
      this.solid.quad(x - w / 2, y, zf, x + w / 2, y, zf, x + w / 2, y + h, zf, x - w / 2, y + h, zf, this.brand, 0, 0, 1);
      return;
    }
    const aspect = Math.max(1, Math.min(8, Math.round((w / h) * 2) / 2));
    const hueKey = Math.round(this.hue * 100) / 100;
    const key = `${text}|${hueKey}|${aspect}|${style}`;
    let s = this.signs.get(key);
    if (!s) { s = { geo: new Geo(this.t, true), text, hue: hueKey, aspect, style, owner: this.signOwner }; this.signs.set(key, s); }
    else if (s.owner !== this.signOwner) s.owner = -1;
    s.geo.poly([x - w / 2, y, zf, x + w / 2, y, zf, x + w / 2, y + h, zf, x - w / 2, y + h, zf], C.white, 0, 0, 1, [1, 0, 0, 0, 0, 1, 1, 1]);
  }

  /** A door in the current wall frame (bottom at y). */
  door(x: number, w: number, h: number, col: Color3, frame: Color3 = C.trim, y = 0, glassDoor = false): void {
    if (this.cut) return;
    const g = this.solid;
    g.box(x, y, 0.02, w + 0.24, h + 0.12, 0.08, frame, 0, false);
    if (this.near) doorExtras(this, x, w, h, y, glassDoor);
    if (glassDoor) {
      this.pane(x - w / 2, y, x + w / 2, y + h, 0.07, 'lobby');
      g.box(x, y, 0.08, 0.06, h, 0.03, frame, 0, false);
    } else {
      g.box(x, y, 0.06, w, h, 0.04, col, 0, false);
      g.box(x, y + h * 0.55, 0.1, w * 0.7, 0.04, 0.02, shade(col, 0.8), 0, false);
      g.box(x + w * 0.36, y + h * 0.47, 0.11, 0.07, 0.07, 0.05, C.yellow, 0, false);
    }
  }
}

// ============================================================ yard props

export function tree(c: Ctx, x: number, z: number, s: number, k: number, y = 0.05, force?: 'conifer' | 'leafy'): void {
  const g = c.solid;
  const kind = force === 'conifer' ? 0.1 * hash2(c.b.seed, 300 + k) : force === 'leafy' ? 0.3 + 0.7 * hash2(c.b.seed, 300 + k) : hash2(c.b.seed, 300 + k);
  const green = [C.leaf, C.leafDark, C.leafLight, hx('#5b9442')][Math.floor(hash2(c.b.seed, 310 + k) * 4)];
  if (kind < 0.3) {
    g.cyl(x, y, z, 0.16 * s, 0.12 * s, 1.0 * s, 5, C.trunk);
    g.cyl(x, y + 0.7 * s, z, 1.3 * s, 0, 2.2 * s, 7, C.conifer);
    g.cyl(x, y + 1.7 * s, z, 1.0 * s, 0, 1.9 * s, 7, shade(C.conifer, 1.12));
    g.cyl(x, y + 2.6 * s, z, 0.65 * s, 0, 1.5 * s, 7, shade(C.conifer, 1.22));
  } else {
    g.cyl(x, y, z, 0.17 * s, 0.13 * s, 1.6 * s, 5, C.trunk);
    g.blob(x, y + 2.3 * s, z, 1.35 * s, 1.15 * s, 1.35 * s, green, 7, 4, false, kind * 3);
    g.blob(x + 0.5 * s, y + 2.9 * s, z - 0.3 * s, 0.85 * s, 0.75 * s, 0.85 * s, shade(green, 1.1), 6, 4, false, kind * 5);
  }
}

export function bush(c: Ctx, x: number, z: number, s: number, col: Color3 = C.leafDark): void {
  c.solid.blob(x, 0.05 + 0.35 * s, z, 0.6 * s, 0.45 * s, 0.6 * s, col, 6, 3);
}

export function lamp(c: Ctx, x: number, z: number, h = 4.2, rot = 0): void {
  const g = c.solid;
  g.cyl(x, 0.05, z, 0.14, 0.14, 0.4, 6, C.iron);
  g.cyl(x, 0.45, z, 0.07, 0.06, h - 0.45, 5, C.iron);
  c.t.push(x, 0, z, rot);
  g.box(0, h - 0.1, 0.25, 0.08, 0.08, 0.6, C.iron);
  g.box(0, h - 0.22, 0.55, 0.5, 0.14, 0.5, C.iron, 0, true);
  c.glow.box(0, h - 0.62, 0.55, 0.36, 0.4, 0.36, GLOW_BULB, 0, true);
  c.t.pop();
}

export function bench(c: Ctx, x: number, z: number, rot: number, len = 1.6): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  for (const sx of [-len / 2 + 0.12, len / 2 - 0.12]) {
    g.box(sx, 0, 0, 0.08, 0.45, 0.45, C.iron);
    g.box(sx, 0.45, -0.21, 0.08, 0.45, 0.06, C.iron);
  }
  for (let i = 0; i < 3; i++) g.box(0, 0.42, -0.15 + i * 0.15, len, 0.04, 0.12, C.woodLight);
  for (let i = 0; i < 2; i++) g.box(0, 0.6 + i * 0.16, -0.22, len, 0.11, 0.04, C.woodLight);
  c.t.pop();
}

export function planter(c: Ctx, x: number, z: number, w: number, d: number, withTree: boolean, k: number): void {
  c.solid.box(x, 0.05, z, w, 0.55, d, C.concrete);
  c.solid.box(x, 0.6, z, w - 0.16, 0.04, d - 0.16, C.soil);
  if (withTree) tree(c, x, z, 0.75, k, 0.6);
  else {
    for (let i = 0; i < Math.max(1, Math.round(w / 0.8)); i++) {
      c.solid.blob(x - w / 2 + 0.4 + i * 0.8, 0.82, z, 0.38, 0.3, Math.min(0.38, d / 2 - 0.05), i % 2 ? C.leaf : C.leafLight, 5, 3);
    }
  }
}

export type FenceStyle = 'picket' | 'rail' | 'hedge' | 'chain' | 'stone' | 'hoarding';

export function fence(c: Ctx, x0: number, z0: number, x1: number, z1: number, style: FenceStyle, col?: Color3): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.3) return;
  const rot = Math.atan2(x1 - x0, z1 - z0); // local +Z along the fence
  const g = c.solid;
  c.t.push((x0 + x1) / 2, 0.05, (z0 + z1) / 2, rot);
  if (style === 'hedge') {
    g.box(0, 0, 0, 0.7, 1.0, len, col ?? C.leafDark);
    g.box(0, 1.0, 0, 0.6, 0.12, len - 0.1, shade(col ?? C.leafDark, 1.12));
  } else if (style === 'stone') {
    g.box(0, 0, 0, 0.45, 0.7, len, col ?? C.stoneLight);
    g.box(0, 0.7, 0, 0.55, 0.1, len, shade(col ?? C.stoneLight, 0.9));
  } else if (style === 'hoarding') {
    g.box(0, 0, 0, 0.08, 2.0, len, col ?? hx('#d9d2c2'));
    for (let p = -len / 2; p <= len / 2 + 0.01; p += 2.5) g.box(0.08, 0, p, 0.08, 2.05, 0.08, C.wood);
  } else {
    const n = Math.max(1, Math.round(len / (style === 'picket' ? 0.25 : 2.2)));
    const postC = col ?? (style === 'picket' ? C.white : style === 'chain' ? C.metal : C.wood);
    if (style === 'picket') {
      const m = Math.max(1, Math.round(len / 0.4));
      for (let i = 0; i <= m; i++) {
        const z = -len / 2 + (i / m) * len;
        for (const sx of [-0.03, 0.03]) g.poly([sx, 0, z - 0.05, sx, 0, z + 0.05, sx, 0.82, z + 0.05, sx, 0.92, z, sx, 0.82, z - 0.05], postC, sx, 0, 0);
      }
      g.box(0, 0.25, 0, 0.04, 0.07, len, postC, 0, false);
      g.box(0, 0.62, 0, 0.04, 0.07, len, postC, 0, false);
    } else if (style === 'rail') {
      for (let i = 0; i <= n; i++) g.box(0, 0, -len / 2 + (i / n) * len, 0.12, 1.05, 0.12, postC, 0, false);
      g.box(0, 0.45, 0, 0.06, 0.1, len, postC, 0, false);
      g.box(0, 0.85, 0, 0.06, 0.1, len, postC, 0, false);
    } else {
      for (let i = 0; i <= n; i++) g.cyl(0, 0, -len / 2 + (i / n) * len, 0.04, 0.04, 2.0, 4, postC, 0, false);
      g.box(0, 1.94, 0, 0.05, 0.05, len, postC, 0, false);
      g.box(0, 0.1, 0, 0.03, 0.03, len, postC, 0, false);
      // the wire mesh: see-through
      c.clear.box(0, 0.12, 0, 0.012, 1.82, len, hx('#7f878e'), 0, false);
    }
  }
  c.t.pop();
}

/** Fence around the lot with gaps in the front ([x, width] pairs). */
export function lotFence(c: Ctx, style: FenceStyle, gaps: [number, number][], inset = 0.4, col?: Color3, back = true): void {
  const hw = c.lw / 2 - inset, hd = c.ld / 2 - inset;
  let x = -hw;
  for (const [gx, gw] of [...gaps].sort((a, b) => a[0] - b[0])) {
    fence(c, x, hd, gx - gw / 2, hd, style, col);
    x = gx + gw / 2;
  }
  fence(c, x, hd, hw, hd, style, col);
  fence(c, -hw, hd, -hw, -hd, style, col);
  fence(c, hw, hd, hw, -hd, style, col);
  if (back) fence(c, -hw, -hd, hw, -hd, style, col);
}

export function car(c: Ctx, x: number, z: number, rot: number, col: Color3, y = 0.05): void {
  const g = c.solid;
  c.t.push(x, y, z, rot);
  g.box(0, 0.26, 0, 1.76, 0.6, 4.1, col);
  g.box(0, 0.86, -0.25, 1.56, 0.5, 2.15, GLASS_DAY);
  g.box(0, 1.34, -0.28, 1.6, 0.08, 1.95, col);
  g.box(0, 0.86, 0.82, 1.6, 0.06, 0.06, col);
  for (const sx of [-0.62, 0.62]) {
    g.box(sx, 0.55, 2.05, 0.36, 0.14, 0.04, hx('#fff6d8'), 0, false);
    g.box(sx, 0.62, -2.05, 0.34, 0.12, 0.04, hx('#c0392b'), 0, false);
  }
  for (const [wx, wz] of [[-0.84, 1.3], [0.84, 1.3], [-0.84, -1.3], [0.84, -1.3]]) {
    g.tube(wx - 0.12, 0.33, wz, wx + 0.12, 0.33, wz, 0.33, 8, C.tire, true, 0.33, C.steel);
  }
  c.t.pop();
}

export function truck(c: Ctx, x: number, z: number, rot: number, col: Color3, cargo: Color3 = C.white): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  g.box(0, 0.5, 2.4, 2.3, 1.9, 1.9, col);
  g.box(0, 1.6, 3.36, 2.1, 0.7, 0.04, GLASS_DAY, 0, false);
  g.box(0, 0.6, -1.2, 2.4, 2.5, 5.4, cargo);
  g.box(0, 0.35, 0, 1.0, 0.3, 7.0, C.iron);
  for (const wz of [2.4, -0.6, -2.4]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.45, wz, wx + 0.15, 0.45, wz, 0.45, 8, C.tire, true, 0.45, C.steel);
  c.t.pop();
}

export function crate(c: Ctx, x: number, y: number, z: number, s: number, col: Color3, rot = 0): void {
  c.solid.box(x, y, z, s, s * 0.8, s, col, rot);
  c.solid.box(x, y + s * 0.8, z, s * 1.02, 0.04, s * 0.2, shade(col, 0.8), rot);
}

export function barrel(c: Ctx, x: number, z: number, col: Color3): void {
  c.solid.cyl(x, 0.05, z, 0.3, 0.3, 0.9, 8, col, 0, true, shade(col, 0.8));
  c.solid.cyl(x, 0.35, z, 0.31, 0.31, 0.06, 8, shade(col, 0.7), 0, false);
}

export function pallet(c: Ctx, x: number, z: number, rot: number, load: Color3, h = 0.9, w = 1.2): void {
  c.solid.box(x, 0.05, z, w, 0.15, w, C.woodLight, rot);
  c.solid.box(x, 0.2, z, w * 0.94, h, w * 0.94, load, rot);
  // brick courses
  if (h > 0.3) c.solid.box(x, 0.2 + h * 0.5, z, w * 0.96, 0.04, w * 0.96, shade(load, 0.82), rot);
}

export function plankStack(c: Ctx, x: number, z: number, rot: number, len: number, w: number, layers: number, col = C.planks): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  for (let l = 0; l < layers; l++) {
    g.box(0, l * 0.24, 0, w, 0.18, len, l % 2 ? col : shade(col, 0.93));
    if (l < layers - 1) for (const sz of [-len / 2 + 0.3, 0, len / 2 - 0.3]) g.box(0, l * 0.24 + 0.18, sz, w, 0.06, 0.1, C.woodDark);
  }
  c.t.pop();
}

export function logPile(c: Ctx, x: number, z: number, rot: number, len: number, base: number, r = 0.3): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  for (let row = 0; row < base; row++) {
    const n = base - row;
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * r * 2.02;
      const ly = r + row * r * 1.72;
      g.tube(lx, ly, -len / 2, lx, ly, len / 2, r * (0.92 + 0.12 * hash2(c.b.seed, row * 13 + i)), 7, C.log, true, r, C.logEnd);
    }
  }
  c.t.pop();
}

export function pile(c: Ctx, x: number, z: number, r: number, h: number, col: Color3): void {
  c.solid.blob(x, 0.05, z, r, h, r * 0.9, col, 7, 4, true, x * 0.7);
}

export function parking(c: Ctx, x: number, z: number, n: number, rot: number, cars: number): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  const w = n * 2.6;
  g.box(0, 0, 0, w + 0.4, 0.035, 5.2, C.asphalt, 0, false);
  for (let i = 0; i <= n; i++) g.box(-w / 2 + i * 2.6, 0.02, 0.2, 0.1, 0.04, 4.4, C.white, 0, false);
  for (let i = 0; i < n; i++) {
    if (hash2(c.b.seed, 400 + i) < cars) car(c, -w / 2 + 1.3 + i * 2.6, 0.3, (hash2(c.b.seed, 410 + i) < 0.5 ? 0 : Math.PI) + (hash2(c.b.seed, 415 + i) - 0.5) * 0.08, c.pick(P.cars, 420 + i), 0);
  }
  c.t.pop();
}

/** Simple lattice mast (crane / tower) between y0 and y1. */
export function lattice(c: Ctx, x: number, z: number, s: number, y0: number, y1: number, col: Color3): void {
  const g = c.solid;
  const h = s / 2;
  for (const [dx, dz] of [[-h, -h], [h, -h], [h, h], [-h, h]]) g.box(x + dx, y0, z + dz, 0.12, y1 - y0, 0.12, col, 0, false);
  const step = s * 1.2;
  for (let y = y0; y < y1 - 0.1; y += step) {
    const y2 = Math.min(y1, y + step);
    g.box(x, y, z - h, s, 0.08, 0.08, col, 0, false);
    g.box(x, y, z + h, s, 0.08, 0.08, col, 0, false);
    g.box(x - h, y, z, 0.08, 0.08, s, col, 0, false);
    g.box(x + h, y, z, 0.08, 0.08, s, col, 0, false);
    g.beam(x - h, y, z + h, x + h, y2, z + h, 0.06, col);
    g.beam(x + h, y, z - h, x - h, y2, z - h, 0.06, col);
    g.beam(x - h, y, z - h, x - h, y2, z + h, 0.06, col);
    g.beam(x + h, y, z + h, x + h, y2, z - h, 0.06, col);
  }
}

export function towerCrane(c: Ctx, x: number, z: number, h: number, jib: number, rot: number): void {
  const g = c.solid;
  const Y = C.yellow;
  g.box(x, 0.05, z, 3.2, 0.8, 3.2, C.concrete);
  lattice(c, x, z, 1.5, 0.85, h, Y);
  c.t.push(x, h, z, rot);
  g.box(0, 0, 0, 1.8, 0.4, 1.8, Y); // slewing unit
  g.box(0.9, 0.4, 0.4, 1.3, 1.3, 1.4, Y); // cab
  c.glow.box(0.9, 0.85, 1.11, 1.1, 0.7, 0.02, GLASS_DAY);
  // jib along +Z, counter-jib along -Z
  g.box(0, 0.4, jib / 2, 1.0, 0.18, jib, Y, 0, true);
  g.box(0, 1.25, jib / 2, 0.12, 0.12, jib, Y);
  for (let k = 0; k < jib; k += 2) g.beam(0, 0.55, k, 0, 1.25, k + 1, 0.06, Y);
  g.box(0, 0.4, -3.5, 1.0, 0.3, 7, Y);
  g.box(0, 0.05, -6.0, 1.6, 1.4, 1.8, C.concrete);
  g.box(0, 0.4, 0, 0.5, 4.2, 0.5, Y); // tower top
  g.beam(0, 4.5, 0, 0, 1.3, jib * 0.95, 0.05, C.iron);
  g.beam(0, 4.5, 0, 0, 0.7, -6.5, 0.05, C.iron);
  // trolley + hook
  const hz = jib * (0.45 + 0.4 * c.r(77));
  g.box(0, 0.12, hz, 0.8, 0.3, 0.8, C.iron);
  const hookY = -(h * (0.35 + 0.35 * c.r(78)));
  g.box(0, hookY, hz, 0.03, -hookY, 0.03, C.iron, 0, false);
  g.box(0, hookY - 0.4, hz, 0.4, 0.4, 0.3, C.red);
  c.t.pop();
}

export function smallCrane(c: Ctx, x: number, z: number, h: number, jib: number, rot: number): void {
  const g = c.solid;
  g.box(x, 0.05, z, 2.2, 0.6, 2.2, C.concrete);
  lattice(c, x, z, 1.1, 0.65, h, C.yellow);
  c.t.push(x, h, z, rot);
  g.box(0, 0, 0, 1.3, 0.35, 1.3, C.yellow);
  g.box(0, 0.35, jib / 2, 0.7, 0.5, jib, C.yellow, 0, true);
  g.box(0, 0.35, -2.2, 0.8, 0.4, 3.2, C.yellow);
  g.box(0, 0.05, -3.3, 1.2, 1.0, 1.0, C.concrete);
  g.box(0.75, 0.35, 0.3, 0.9, 1.0, 1.0, C.yellow);
  const hz = jib * 0.7;
  g.box(0, -h * 0.5, hz, 0.03, h * 0.5 + 0.35, 0.03, C.iron, 0, false);
  g.box(0, -h * 0.5 - 0.45, hz, 0.8, 0.45, 2.6, C.planks, 0.3);
  c.t.pop();
}

// ============================================================ lot ground

export type Ground = 'lawn' | 'paved' | 'gravel' | 'dirt' | 'plaza' | 'clay' | 'meadow';

export function lotGround(c: Ctx, kind: Ground): void {
  if (c.look.draped) return; // (laid on the terrain by the field renderer)
  const col = kind === 'lawn' ? hsl(0.26 + c.r(60) * 0.04, 0.36, 0.42 + c.r(61) * 0.05)
    : kind === 'meadow' ? hsl(0.24, 0.32, 0.45)
    : kind === 'paved' ? C.paving : kind === 'gravel' ? C.gravel : kind === 'dirt' ? C.dirt : kind === 'clay' ? hx('#b49a78') : C.plaza;
  c.solid.box(0, -1.4, 0, c.lw - 0.1, 1.45, c.ld - 0.1, col);
  if (kind === 'paved' || kind === 'plaza') {
    // curb + sidewalk strip at the front
    c.solid.box(0, 0.05, c.ld / 2 - 0.8, c.lw - 0.1, 0.03, 1.5, shade(col, 1.06), 0, false);
  }
}

// ============================================================== roofs

/** Gable roof with the ridge along local X; ends (triangles) go to `ends`. */
export function gableRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, h: number, roofC: Color3, endC: Color3, over = 0.4, alongZ = false): void {
  if (c.cut) return;
  if (alongZ) {
    c.t.push(cx, 0, cz, Math.PI / 2);
    gableRoof(c, 0, y, 0, d, w, h, roofC, endC, over, false);
    c.t.pop();
    return;
  }
  const g = c.solid;
  const ex = w / 2 + over * 0.6, ez = d / 2 + over, drop = (over * h) / (d / 2);
  const under = shade(roofC, 0.7);
  g.slab([cx - ex, y - drop, cz + ez, cx + ex, y - drop, cz + ez, cx + ex, y + h + 0.02, cz, cx - ex, y + h + 0.02, cz], 0.14, roofC, 0, 1, 0.3, under);
  g.slab([cx + ex, y - drop, cz - ez, cx - ex, y - drop, cz - ez, cx - ex, y + h + 0.02, cz, cx + ex, y + h + 0.02, cz], 0.14, roofC, 0, 1, -0.3, under);
  g.box(cx, y + h - 0.02, cz, ex * 2 + 0.04, 0.14, 0.24, shade(roofC, 0.85));
  for (const sx of [-1, 1]) g.tri(cx + sx * w / 2, y, cz + d / 2, cx + sx * w / 2, y, cz - d / 2, cx + sx * w / 2, y + h, cz, endC, sx, 0, 0);
}

export function hipRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, h: number, roofC: Color3, over = 0.4): void {
  if (c.cut) return;
  if (d > w) {
    c.t.push(cx, 0, cz, Math.PI / 2);
    hipRoof(c, 0, y, 0, d, w, h, roofC, over);
    c.t.pop();
    return;
  }
  const g = c.solid;
  const ex = w / 2 + over, ez = d / 2 + over, rx = Math.max(0, (w - d) / 2), drop = (over * h) / (d / 2), yb = y - drop, yt = y + h;
  g.quad(cx - ex, yb, cz + ez, cx + ex, yb, cz + ez, cx + rx, yt, cz, cx - rx, yt, cz, roofC, 0, 1, 1);
  g.quad(cx + ex, yb, cz - ez, cx - ex, yb, cz - ez, cx - rx, yt, cz, cx + rx, yt, cz, roofC, 0, 1, -1);
  g.tri(cx + ex, yb, cz + ez, cx + ex, yb, cz - ez, cx + rx, yt, cz, shade(roofC, 0.95), 1, 1, 0);
  g.tri(cx - ex, yb, cz - ez, cx - ex, yb, cz + ez, cx - rx, yt, cz, shade(roofC, 0.95), -1, 1, 0);
  g.box(cx, yb - 0.12, cz, ex * 2, 0.12, ez * 2, shade(roofC, 0.75));
}

/** Flat roof with a parapet. */
export function flatRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, roofC: Color3, parC: Color3, ph = 0.7, pt = 0.25): void {
  if (c.cut) return;
  const g = c.solid;
  g.box(cx, y, cz, w - 0.05, 0.08, d - 0.05, roofC, 0, false);
  g.box(cx, y, cz + d / 2 - pt / 2, w + 0.06, ph, pt, parC);
  g.box(cx, y, cz - d / 2 + pt / 2, w + 0.06, ph, pt, parC);
  g.box(cx - w / 2 + pt / 2, y, cz, pt, ph, d, parC);
  g.box(cx + w / 2 - pt / 2, y, cz, pt, ph, d, parC);
  g.box(cx, y + ph, cz + d / 2 - pt / 2, w + 0.14, 0.08, pt + 0.1, shade(parC, 0.85), 0, false);
  g.box(cx, y + ph, cz - d / 2 + pt / 2, w + 0.14, 0.08, pt + 0.1, shade(parC, 0.85), 0, false);
}

/** Sawtooth roof: teeth along Z with glazing facing the front (+Z). */
export function sawRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, teeth: number, h: number, roofC: Color3, endC: Color3): void {
  if (c.cut) return;
  const g = c.solid;
  const td = d / teeth;
  for (let i = 0; i < teeth; i++) {
    const z0 = cz - d / 2 + i * td, z1 = z0 + td;
    g.slab([cx - w / 2 - 0.2, y, z0, cx + w / 2 + 0.2, y, z0, cx + w / 2 + 0.2, y + h, z1 - 0.05, cx - w / 2 - 0.2, y + h, z1 - 0.05], 0.12, roofC, 0, 1, -0.4, shade(roofC, 0.7));
    // glazing
    const n = Math.max(1, Math.floor(w / 2.2));
    c.t.push(0, 0, z1 - 0.05, 0);
    for (let k = 0; k < n; k++) {
      const x0 = cx - w / 2 + (k / n) * w + 0.08, x1 = cx - w / 2 + ((k + 1) / n) * w - 0.08;
      c.pane(x0, y + 0.08, x1, y + h - 0.16, 0, 'ind');
    }
    c.t.pop();
    g.box(cx, y, z1 - 0.13, w, h, 0.06, shade(endC, 0.8), 0, false);
    for (const sx of [-1, 1]) g.tri(cx + sx * w / 2, y, z0, cx + sx * w / 2, y, z1, cx + sx * w / 2, y + h, z1, endC, sx, 0, 0);
  }
}

/** Barrel (vaulted) roof along X. */
export function barrelRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, h: number, roofC: Color3, endC: Color3, seg = 8): void {
  if (c.cut) return;
  const g = c.solid;
  const pt = (k: number): [number, number] => {
    const a = Math.PI - (k / seg) * Math.PI;
    return [cz + Math.cos(a) * (d / 2 + 0.2), y + Math.sin(a) * h];
  };
  const ex = w / 2 + 0.25;
  for (let k = 0; k < seg; k++) {
    const [z0, y0] = pt(k), [z1, y1] = pt(k + 1);
    g.slab([cx - ex, y0, z0, cx + ex, y0, z0, cx + ex, y1, z1, cx - ex, y1, z1], 0.12, k % 2 ? roofC : shade(roofC, 0.95), 0, 1, (z0 + z1) / 2 - cz, shade(roofC, 0.7));
  }
  for (const sx of [-1, 1]) {
    const pts: number[] = [];
    for (let k = 0; k <= seg; k++) { const [z, yy] = pt(k); pts.push(cx + sx * w / 2, yy, Math.max(cz - d / 2, Math.min(cz + d / 2, z))); }
    g.poly(pts, endC, sx, 0, 0);
  }
}

/** Gambrel (barn) roof with the ridge along Z. */
export function gambrelRoof(c: Ctx, cx: number, y: number, cz: number, w: number, d: number, h: number, roofC: Color3, endC: Color3): void {
  if (c.cut) return;
  const g = c.solid;
  const hw = w / 2 + 0.3, ez = d / 2 + 0.35;
  const prof: [number, number][] = [[-hw, y - 0.2], [-w * 0.32, y + h * 0.62], [0, y + h], [w * 0.32, y + h * 0.62], [hw, y - 0.2]];
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = prof[k], [x1, y1] = prof[k + 1];
    g.slab([x0 + cx, y0, cz + ez, x1 + cx, y1, cz + ez, x1 + cx, y1, cz - ez, x0 + cx, y0, cz - ez], 0.14, roofC, (x0 + x1) / 2, 1, 0, shade(roofC, 0.7));
  }
  for (const sz of [-1, 1]) {
    const pts = [cx - w / 2, y, cz + sz * d / 2, cx + w / 2, y, cz + sz * d / 2, cx + w * 0.3, y + h * 0.6, cz + sz * d / 2, cx, y + h - 0.05, cz + sz * d / 2, cx - w * 0.3, y + h * 0.6, cz + sz * d / 2];
    g.poly(pts, endC, 0, 0, sz);
  }
}

export function chimney(c: Ctx, x: number, y: number, z: number, w: number, h: number, col: Color3): void {
  if (c.cut) return;
  c.solid.box(x, y, z, w, h, w, col);
  c.solid.box(x, y + h, z, w + 0.15, 0.15, w + 0.15, shade(col, 0.8));
}

export function stack(c: Ctx, x: number, z: number, r: number, h: number, col: Color3, band: Color3 | null, y = 0.05): void {
  const g = c.solid;
  g.cyl(x, y, z, r * 1.25, r, h * 0.12, 10, shade(col, 0.9));
  g.cyl(x, y + h * 0.12, z, r, r * 0.82, h * 0.88, 10, col, 0, true, C.black);
  if (band) {
    g.cyl(x, y + h * 0.8, z, r * 0.88, r * 0.86, h * 0.06, 10, band, 0, false);
    g.cyl(x, y + h * 0.92, z, r * 0.85, r * 0.83, h * 0.05, 10, band, 0, false);
  }
}

export function rollDoor(c: Ctx, x: number, y: number, w: number, h: number, col: Color3): void {
  if (c.cut) return;
  const g = c.solid;
  g.box(x, y, 0.02, w + 0.3, h + 0.2, 0.1, C.dark, 0, false);
  g.box(x, y, 0.08, w, h, 0.04, col, 0, false);
  for (let k = 1; k < Math.floor(h / 0.4); k++) g.box(x, y + k * 0.4, 0.11, w, 0.04, 0.02, shade(col, 0.82), 0, false);
}

/** A strip of industrial windows high on a wall (current wall frame). */
export function highWindows(c: Ctx, len: number, y: number, h: number, spacing = 2.4, skip?: (u: number) => boolean): void {
  const n = Math.max(1, Math.floor(len / spacing));
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (i + 0.5) * (len / n);
    if (skip?.(u)) continue;
    c.window(u, y, Math.min(1.8, spacing * 0.7), h, 'ind', C.dark, { sill: false, cross: true });
  }
}
