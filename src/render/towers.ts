// Towers: residential high-rises and office towers. A tower is a podium
// (shops and the lobby on the street, the hosted shop units drawn into it),
// a shaft of one or more segments (floor plates with a corner treatment,
// tapering or twisting), a facade system (curtain wall with mullions and
// spandrels, fins, ribbon bands, an exposed frame, a diagrid; or balconies:
// wrap-around, undulating, staggered, punched walls, fins, all glass) and a
// crown (mechanical penthouse, sloped glass top, setback tiers, fins rising
// past the roof, a halo; roof terraces with a pool for flats), with a spire
// and aviation lights on the tallest.
//
// Everything is derived from the seed and floor count (`towerPlan`), so the
// far model (buildingFar.ts), construction sites and beacons share the same
// massing. Floor heights are FLOOR_H throughout (people stand on floor k at
// k * FLOOR_H). Office floors keep a full plate (leased suites are the whole
// floor), flats need a plate of at least ~14.5 m for their ring of units.

import { Color3 } from '@babylonjs/core';
import { BUILDINGS } from '../sim/goods';
import { FLOOR_H, stationsOf } from '../sim/layout';
import { hash2 } from '../sim/rng';
import type { Building } from '../sim/types';
import { C, GLOW_BULB, TAU, WS, clamp01, hx, mix, shade, type WinState } from './buildingGeo';
import { Ctx, GLASS_RES, GLASS_SHOP, bench, fence, lamp, lotGround, pallet, planter, tree, type HostedUnit } from './buildingCtx';
import {
  band, bounds, coreFill, diag, eachEdge, fin, flatPoly, offsetOutline, outline, paneRow, parapet, prism, ringSlab, slantFin, subdivide,
  type Corner, type Seg,
} from './facades';

export { offsetOutline, outline, type Corner, type Seg } from './facades';
import { furnish, ringPartitions } from './interiors';
import { shell, shopRoom } from './lowrise';
import { roofClutter, streetBits } from './propsExterior';

const FH = FLOOR_H;

// ================================================================== plan

export type OffStyle = 'grid' | 'flush' | 'fins' | 'bands' | 'frame' | 'diagrid';
export type ResStyle = 'balcony' | 'wave' | 'offset' | 'punched' | 'fins' | 'glass' | 'twist';
export type Crown = 'flat' | 'slope' | 'stepped' | 'fins' | 'ring' | 'terrace' | 'penthouse' | 'canopy' | 'lantern';

export interface TowerPlan {
  res: boolean;
  floors: number;
  H: number; // roof of the top floor
  pw: number; pd: number; // podium footprint
  segs: Seg[];
  style: OffStyle | ResStyle;
  bay: number;
  crown: Crown;
  crownH: number; // crown height above H
  spire: number; // spire height above the crown (0 = none)
  tint: Color3; frame: Color3; span: Color3; stone: Color3; slab: Color3; panel: Color3; rail: Color3; light: Color3;
  name: string;
  num: number; // street number over the lobby
  /** Night lighting of an office tower's top: the top floors' spandrels washed with light, LED lines up the corners, or none. */
  glow: 'wash' | 'corners' | 'none';
}

export const pickW = <T>(items: readonly T[], weights: readonly number[], h: number): T => {
  let sum = 0;
  for (const w of weights) sum += w;
  let x = h * sum;
  for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
};

export const GLASS_FAMILIES: [string[], number][] = [
  [['#4f7896', '#5a7fa6', '#46708e', '#6a8fb0'], 30], // blue
  [['#8d9aa5', '#9aa6ae', '#7f8c96'], 18], // silver
  [['#4f8a86', '#5f8f80', '#457d78'], 13], // green
  [['#2f3a44', '#283039', '#353c45'], 16], // dark
  [['#6e5a48', '#5d4c3e', '#7a6250'], 10], // bronze
  [['#3f7f8f', '#4a8a98'], 13], // teal
];
export const FRAMES = ['#c9ccd0', '#ecebe6', '#26292d', '#4a3f35', '#7d8287', '#b9bec2'];
export const STONES = ['#4a4c50', '#a7a39b', '#d8cfbd', '#2a2b2e', '#d9c9ab', '#7a4a40', '#8c8a85'];
const PANELS = ['#f2f0ea', '#d9dcdc', '#b9b4aa', '#3a3d42', '#c86a4a', '#b98a5e', '#e6dccb', '#8e9aa0'];
const LIGHTS = ['#ffffff', '#cfe6ff', '#ffe6b0', '#9fd8ff', '#ffd0f0', '#b0ffd8'];
const RES_NAMES = ['The Meridian', 'Aurora', 'The Linden', 'Harbourview', 'One Park Place', 'The Wellington', 'Skyline', 'The Ashby', 'Vista',
  'The Mercer', 'Riverstone', 'The Belvedere', 'Parkside', 'The Sterling', 'Lumina', 'The Halcyon', 'Crescent', 'The Kensington', 'Arbor',
  'The Monarch', 'Solaris', 'The Edison', 'Horizon', 'Maple House', 'The Grand', 'Cityplace', 'The Ellis', 'Nova'];
const OFF_SUFFIX = ['Tower', 'Centre', 'Place', 'Plaza', 'Tower', 'House'];
const OFF_NAMES = ['Commerce', 'Exchange', 'Meridian', 'Bay', 'Harbour', 'Union', 'Granite', 'Capital', 'Pacific', 'Atlas', 'Summit', 'Liberty'];

const plans = new Map<string, TowerPlan>();

export function isTowerKind(kind: string): boolean { return kind === 'tower' || kind === 'officetower'; }

/** The massing and look of a tower (cached; the same for detail, far boxes, sites and beacons). */
export function towerPlan(b: Pick<Building, 'kind' | 'seed' | 'floors' | 'w' | 'd'>, firmName?: string): TowerPlan {
  const key = `${b.kind}|${b.seed}|${b.floors}|${b.w}|${b.d}|${firmName ?? ''}`;
  let p = plans.get(key);
  if (p) return p;
  const r = (k: number) => hash2(b.seed, 41000 + k);
  const res = b.kind === 'tower';
  const F = Math.max(2, b.floors);
  const H = F * FH;
  const pw = b.w - 0.3, pd = b.d - 0.3;
  const fam = pickW(GLASS_FAMILIES.map((g) => g[0]), GLASS_FAMILIES.map((g) => g[1]), r(1));
  const tint = hx(fam[Math.floor(r(2) * fam.length) % fam.length]);
  const frame = hx(FRAMES[Math.floor(r(3) * FRAMES.length)]);
  const stone = hx(STONES[Math.floor(r(4) * STONES.length)]);
  const panel = hx(PANELS[Math.floor(r(5) * PANELS.length)]);
  const light = hx(LIGHTS[Math.floor(r(6) * LIGHTS.length)]);
  const segs: Seg[] = [];
  let style: OffStyle | ResStyle, crown: Crown, crownH: number, bay: number;
  let spire = 0;
  if (!res) {
    const plate = Math.min(b.w, b.d) - 0.5;
    style = pickW<OffStyle>(['grid', 'flush', 'fins', 'bands', 'frame', 'diagrid'], [28, 20, 18, 12, 12, F >= 28 ? 14 : 0], r(10));
    const corner = pickW<Corner>(['sq', 'chamfer', 'notch', 'round'], style === 'frame' || style === 'diagrid' ? [1, 0, 0, 0] : [45, 20, 15, 20], r(11));
    const cr = corner === 'chamfer' ? 1.4 : corner === 'notch' ? 1.1 : corner === 'round' ? 2.4 : 0;
    const taper = F >= 26 && style !== 'frame' && r(12) < 0.45 ? 1.1 : 0;
    segs.push({ f0: 1, f1: F, w0: plate, d0: plate, w1: plate - taper, d1: plate - taper, cx: 0, cz: 0, corner, cr, twist: 0, balc: 0 });
    bay = style === 'bands' ? 1.8 : style === 'frame' ? 1.55 : 1.5;
    crown = pickW<Crown>(['flat', 'slope', 'stepped', 'fins', 'ring'], [30, 20, 22, style === 'fins' || style === 'grid' ? 16 : 0, 12], r(13));
    crownH = crown === 'flat' ? 5.5 : crown === 'slope' ? plate * 0.36 : crown === 'stepped' ? 9 : crown === 'fins' ? 8 : 5;
    if (F >= 55) spire = r(14) < 0.75 ? 26 + r(15) * 28 : 0;
    else if (F >= 40) spire = r(14) < 0.4 ? 16 + r(15) * 16 : 0;
  } else {
    style = pickW<ResStyle>(['balcony', 'wave', 'offset', 'punched', 'fins', 'glass', 'twist'], [24, 14, 14, 12, 12, 12, F >= 18 ? 12 : 0], r(10));
    bay = 1.6;
    const deep = style === 'balcony' || style === 'wave' || style === 'offset';
    const pwP = style === 'twist' ? 15.2 : deep ? 14.8 : style === 'glass' ? 15.4 : 15.8;
    const pdP = style === 'twist' ? 15.2 : deep ? 14.6 : style === 'glass' ? 15.0 : 15.4;
    const corner: Corner = style === 'twist' ? 'round' : style === 'balcony' || style === 'glass' ? (r(11) < 0.45 ? 'round' : 'sq') : style === 'punched' && r(11) < 0.4 ? 'chamfer' : 'sq';
    const cr = style === 'twist' ? 7.6 : corner === 'round' ? 1.6 + r(16) * 1.0 : corner === 'chamfer' ? 1.2 : 0;
    const balc = deep ? 1.45 : style === 'twist' ? 1.4 : 0;
    // setback: the top floors as a slimmer glass box without balconies (a roof terrace at the step)
    const step = F >= 22 && deep && r(12) < 0.45 ? Math.round(F * (0.72 + r(17) * 0.12)) : F;
    segs.push({ f0: 1, f1: step, w0: pwP, d0: pdP, w1: pwP, d1: pdP, cx: 0, cz: 0, corner, cr, twist: style === 'twist' ? (Math.PI / 2 + r(18) * Math.PI / 2) / F * (r(19) < 0.5 ? 1 : -1) : 0, balc });
    if (step < F) segs.push({ f0: step, f1: F, w0: 14.6, d0: 14.6, w1: 14.6, d1: 14.6, cx: 0, cz: 0, corner, cr: Math.min(cr, 1.6), twist: 0, balc: 0 });
    crown = pickW<Crown>(['terrace', 'penthouse', 'canopy', 'lantern'], [34, 24, 24, 18], r(13));
    crownH = crown === 'terrace' ? 3.4 : crown === 'penthouse' ? FH + 1.2 : crown === 'canopy' ? 4.2 : 4.6;
    if (F >= 50 && r(14) < 0.35) spire = 12 + r(15) * 10;
  }
  const span = style === 'bands' ? panel : mix(tint, C.black, 0.42);
  const slab = res ? hx(['#f2f0ea', '#e2e2de', '#c9c8c2', '#3a3d42', '#f4efe2'][Math.floor(r(7) * 5)]) : shade(frame, 0.9);
  const rail = hx(['#9fc2d2', '#b8cdd6', '#8fb0bf', '#c9d6dc'][Math.floor(r(8) * 4)]);
  let name: string;
  if (res) name = RES_NAMES[Math.floor(r(20) * RES_NAMES.length)];
  else {
    const base = firmName ? firmName.split(/[\s&]+/)[0] : OFF_NAMES[Math.floor(r(20) * OFF_NAMES.length)];
    name = `${base} ${OFF_SUFFIX[Math.floor(r(21) * OFF_SUFFIX.length)]}`;
  }
  const num = (1 + Math.floor(r(22) * 9)) * (r(23) < 0.5 ? 100 : 10) + (r(24) < 0.3 ? 1 : 0) * 5;
  const glow = res ? 'none' : pickW(['wash', 'corners', 'none'] as const, [38, 24, 38], r(25));
  p = { res, floors: F, H, pw, pd, segs, style, bay, crown, crownH, spire, tint, frame, span, stone, slab, panel, rail, light, name, num, glow };
  plans.set(key, p);
  if (plans.size > 4000) plans.clear();
  return p;
}

/** Overall height of a tower (roof, crown and spire). */
export function towerHeight(p: TowerPlan): number { return p.H + p.crownH + p.spire; }

// ============================================================== context

/** Per-floor facts of a tower: how much each floor is in use (lit at night) and who leases it. */
export interface Floors {
  use: (f: number, angle: number) => number;
  suiteOf: Map<number, HostedUnit>;
}

/** Which flat of a floor a window at `angle` (around the plate's center) belongs to, and whether it's lived in. */
export function flatUse(c: Ctx, per: number, first: number, cz = 0): (f: number, angle: number) => number {
  const occ = c.litRes;
  void cz;
  return (f, angle) => {
    let a = (angle - 0.2) / TAU;
    a -= Math.floor(a);
    const u = Math.round(a * per - 0.5 + per) % per;
    const idx = (f - first) * per + u;
    return hash2(c.b.seed, 500 + idx) < occ ? 0.88 : 0;
  };
}

export function floorsOf(c: Ctx, p: TowerPlan): Floors {
  const suiteOf = new Map<number, HostedUnit>();
  for (const u of c.units) if (u.level > 0) suiteOf.set(u.level, u);
  if (!p.res) {
    const hasSuites = suiteOf.size > 0;
    return {
      suiteOf,
      use: (f) => {
        if (!hasSuites) return c.litOff;
        const s = suiteOf.get(f);
        return !s || s.b.kind === 'suite' ? 0 : c.litOff;
      },
    };
  }
  // flats: a ring of units per floor; which ones are lived in follows the (coarse) occupancy
  return { suiteOf, use: flatUse(c, BUILDINGS.tower.unitsPerFloor, 1) };
}

// ======================================================== office shaft

export function officeShaft(c: Ctx, p: TowerPlan, s: Seg, fl: Floors, top: number): void {
  if (c.cut) return; // an opened mid-rise office: its ghost walls show instead
  const g = c.solid;
  const style = p.style as OffStyle;
  const constant = s.w0 === s.w1 && s.d0 === s.d1 && s.twist === 0;
  const sp = style === 'grid' ? 0.85 : style === 'flush' ? 0.62 : style === 'fins' ? 0.7 : style === 'bands' ? 1.2 : style === 'frame' ? 0.75 : 0.55;
  const f1 = Math.min(s.f1, top);
  const tintAt = (f: number, i: number) => {
    // a soft gradient up the tower (reflecting more sky higher up) and per-pane variation
    const k = 0.62 + 0.14 * (f / p.floors) + (hash2(c.b.seed, 9100 + f * 37 + i) - 0.5) * 0.06;
    return shade(p.tint, k);
  };
  const spanGlass = shade(p.tint, 0.42);
  let pts = outline(s, s.f0);
  // bays per edge, fixed for the segment (tapering plates keep their mullion lines)
  const bays: number[] = [];
  eachEdge(c, pts, (len, i) => { bays[i] = Math.max(1, Math.round(len / p.bay)); });
  for (let f = s.f0; f < f1; f++) {
    if (!constant) pts = outline(s, f);
    const y0 = f * FH;
    const use = fl.use(f, 0);
    // a floor is mostly lit (or dark) as a whole: people work there or not
    const floorState = c.paneState('off', c.nextPane(), use);
    eachEdge(c, pts, (len, ei) => {
      const n = bays[ei] ?? Math.max(1, Math.round(len / p.bay));
      const states: WinState[] = [];
      for (let i = 0; i < n; i++) states.push(hash2(c.b.seed, 9300 + f * 41 + ei * 7 + i) < 0.84 ? floorState : c.paneState('off', c.nextPane(), use));
      // spandrel: dark glass (flush, grid, diagrid) or a solid panel band
      if (p.glow === 'wash' && f >= p.floors - 2) c.lit(WS.crown, 1.2).quad(-len / 2, y0, 0.02, len / 2, y0, 0.02, len / 2, y0 + sp, 0.02, -len / 2, y0 + sp, 0.02, p.light, 0, 0, 1);
      else if (style === 'flush' || style === 'grid' || style === 'diagrid') c.lit(WS.dark).quad(-len / 2, y0, 0, len / 2, y0, 0, len / 2, y0 + sp, 0, -len / 2, y0 + sp, 0, spanGlass, 0, 0, 1);
      else if (style === 'bands') band(g, -len / 2 - 0.05, len / 2 + 0.05, y0, y0 + sp, 0.14, p.panel);
      else if (style === 'frame') band(g, -len / 2, len / 2, y0 - 0.1, y0 + sp, 0.38, p.panel);
      else g.quad(-len / 2, y0, 0.01, len / 2, y0, 0.01, len / 2, y0 + sp, 0.01, -len / 2, y0 + sp, 0.01, p.span, 0, 0, 1);
      paneRow(c, -len / 2, len / 2, n, y0 + sp, y0 + FH, 0, states, (i) => tintAt(f, i));
    });
  }
  if (f1 <= s.f0) return;
  if (p.glow === 'corners' && f1 === s.f1) {
    // LED lines up the corners of the top third, glowing at night
    const top = outline(s, f1), yb = Math.max(s.f0, f1 - Math.round(p.floors / 3)) * FH;
    const n = top.length / 2;
    for (let i = 0; i < n; i++) {
      const pi = (i + n - 1) % n, ni = (i + 1) % n;
      const ex = top[ni * 2] - top[pi * 2], ez = top[ni * 2 + 1] - top[pi * 2 + 1];
      slantFin(c.lit(WS.crown, 1.6), top[i * 2], yb, top[i * 2 + 1], top[i * 2], f1 * FH, top[i * 2 + 1], ex, ez, 0.16, 0.06, p.light);
    }
  }
  if (!constant) {
    // tapering plates: each mullion is one slanted line from the bottom plate to the top one
    const a = outline(s, s.f0), z = outline(s, f1);
    const n = a.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, nb = bays[i] ?? 1;
      for (let k = 0; k <= nb; k++) {
        const t = k / nb;
        slantFin(g, a[i * 2] + (a[j * 2] - a[i * 2]) * t, s.f0 * FH, a[i * 2 + 1] + (a[j * 2 + 1] - a[i * 2 + 1]) * t,
          z[i * 2] + (z[j * 2] - z[i * 2]) * t, f1 * FH, z[i * 2 + 1] + (z[j * 2 + 1] - z[i * 2 + 1]) * t,
          a[j * 2] - a[i * 2], a[j * 2 + 1] - a[i * 2 + 1], style === 'fins' ? 0.12 : 0.07, style === 'fins' ? (k % 3 === 0 ? 0.8 : 0.45) : style === 'flush' || style === 'diagrid' ? 0.01 : 0.12,
          style === 'flush' || style === 'diagrid' ? shade(p.tint, 0.55) : p.frame);
      }
    }
    return;
  }
  // mullions / fins / columns spanning the whole segment
  const yb = s.f0 * FH, yt = f1 * FH;
  eachEdge(c, pts, (len) => {
    const n = Math.max(1, Math.round(len / p.bay));
    for (let i = 0; i <= n; i++) {
      const x = -len / 2 + (i / n) * len;
      if (style === 'grid') fin(g, x, yb, yt, 0.08, 0.14, p.frame);
      else if (style === 'flush') fin(g, x, yb, yt, 0.035, 0.01, shade(p.tint, 0.55));
      else if (style === 'fins') fin(g, x, yb, yt + (p.crown === 'fins' ? p.crownH : 0), 0.12, i % 3 === 0 ? 0.85 : 0.5, p.frame);
      else if (style === 'bands') fin(g, x, yb, yt, 0.05, 0.05, p.frame);
      else if (style === 'frame') { if (i % 2 === 0) fin(g, x, yb - 0.1, yt, 0.6, 0.42, p.panel); else fin(g, x, yb, yt, 0.06, 0.08, p.frame); }
      else if (style === 'diagrid') fin(g, x, yb, yt, 0.03, 0.01, shade(p.tint, 0.5));
    }
    if (style === 'diagrid' && len > 6) {
      // diagonal steel braces over 4-floor modules, with ring beams at the joints
      const mod = 4 * FH, cols = Math.max(2, Math.round(len / 6));
      const cw = len / cols;
      for (let y = yb; y + mod <= yt + 0.01; y += mod) {
        for (let k = 0; k < cols; k++) {
          const xa = -len / 2 + k * cw, xb = xa + cw;
          diag(g, xa, y, xb, y + mod, 0.36, 0.22, p.frame);
          diag(g, xb, y, xa, y + mod, 0.36, 0.22, p.frame);
        }
        band(g, -len / 2, len / 2, y + mod - 0.15, y + mod + 0.15, 0.3, p.frame);
      }
    }
  });
}

// =================================================== residential shaft

export function resShaft(c: Ctx, p: TowerPlan, s: Seg, fl: Floors, top: number): void {
  const g = c.solid;
  const style = s.balc > 0 || p.style === 'twist' ? (p.style as ResStyle) : s.f0 > 1 ? 'glass' : (p.style as ResStyle);
  const constant = s.w0 === s.w1 && s.d0 === s.d1 && s.twist === 0;
  const f1 = Math.min(s.f1, top);
  const glassDark = mix(GLASS_RES, p.tint, 0.25);
  const slabC = p.slab, under = shade(p.slab, 0.78);
  const railC = p.rail;
  let pts = outline(s, s.f0);
  // which bays are opaque panels (between flats), per edge
  const opaque = (i: number, k: number, n: number) => {
    if (style === 'punched') return k % 2 === 1 || k === 0 || k === n - 1;
    if (style === 'glass' || style === 'twist') return false;
    return n > 3 && hash2(c.b.seed, 4400 + i * 13 + k) < (style === 'fins' ? 0.12 : 0.22);
  };
  const ring = (style === 'balcony' || style === 'wave' || style === 'twist') && s.balc > 0;
  for (let f = s.f0; f < f1; f++) {
    if (!constant) pts = outline(s, f);
    const y0 = f * FH;
    // glass (and panel) walls of the floor (not when the building is opened up: its ghost walls show)
    if (!c.cut) eachEdge(c, pts, (len, i, ax, az, dx, dz) => {
      const n = Math.max(1, Math.round(len / p.bay));
      const bw = len / n;
      const states: number[] = [];
      for (let k = 0; k < n; k++) {
        const u = -len / 2 + (k + 0.5) * bw;
        const px = ax + dx * (u + len / 2), pz = az + dz * (u + len / 2);
        states.push(opaque(i, k, n) ? -1 : c.paneState('res', c.nextPane(), fl.use(f, Math.atan2(pz, px))));
      }
      const yb = y0 + 0.22, yt = y0 + FH - 0.04;
      let k = 0;
      while (k < n) {
        let j = k + 1;
        while (j < n && states[j] === states[k]) j++;
        const xa = -len / 2 + k * bw, xb = -len / 2 + j * bw;
        if (states[k] === -1) g.quad(xa, y0, 0.02, xb, y0, 0.02, xb, y0 + FH, 0.02, xa, y0 + FH, 0.02, p.panel, 0, 0, 1);
        else c.lit(states[k]).quad(xa, yb, 0, xb, yb, 0, xb, yt, 0, xa, yt, 0, shade(glassDark, 0.95 + hash2(c.b.seed, 4600 + f * 7 + i) * 0.12), 0, 0, 1);
        k = j;
      }
      // slab edge (hidden inside the balcony slab when there is one all around)
      if (!ring) g.quad(-len / 2, y0 - 0.06, 0.03, len / 2, y0 - 0.06, 0.03, len / 2, yb, 0.03, -len / 2, yb, 0.03, slabC, 0, 0, 1);
      // staggered balconies: a box on alternating halves of each edge
      if (style === 'offset' && len > 5) {
        const half = (f + i) % 2;
        const xa = half ? 0.2 : -len / 2 + 0.6, xb = half ? len / 2 - 0.6 : -0.2;
        g.box((xa + xb) / 2, y0 - 0.08, s.balc / 2, xb - xa, 0.26, s.balc, slabC);
        c.clear.quad(xa, y0 + 0.18, s.balc, xb, y0 + 0.18, s.balc, xb, y0 + 1.15, s.balc, xa, y0 + 1.15, s.balc, railC, 0, 0, 1);
        for (const ex of [xa, xb]) c.clear.quad(ex, y0 + 0.18, 0, ex, y0 + 0.18, s.balc, ex, y0 + 1.15, s.balc, ex, y0 + 1.15, 0, railC, ex < 0 ? -1 : 1, 0, 0);
        g.box((xa + xb) / 2, y0 + 1.15, s.balc - 0.03, xb - xa, 0.05, 0.06, p.frame, 0, false);
        if (c.near && f < 8) balconySet(c, (xa + xb) / 2, y0 + 0.18, f * 7 + i);
      }
    });
    // projecting balconies around the plate
    if (ring) {
      let outer: number[];
      let inner = pts;
      if (style === 'twist') {
        // an oval slab, turned a little more every floor, around the round plate
        outer = [];
        const n = pts.length / 2;
        const a = s.twist * (f - s.f0);
        for (let i = 0; i < n; i++) {
          const x = pts[i * 2], z = pts[i * 2 + 1];
          const ang = Math.atan2(z, x) - a;
          const rr = 1 / Math.sqrt((Math.cos(ang) ** 2) / (9.2 ** 2) + (Math.sin(ang) ** 2) / (7.9 ** 2));
          const k = Math.max(rr, Math.hypot(x, z) + 0.05) / Math.hypot(x, z);
          outer.push(x * k, z * k);
        }
      } else if (style === 'wave') {
        const ph = hash2(c.b.seed, 4700) * TAU;
        inner = subdivide(pts, 4.6);
        outer = offsetOutline(inner, (i) => s.balc * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ph + i * 0.9 + f * 0.38))));
      } else outer = offsetOutline(pts, s.balc);
      // (the undersides only low down, where they're seen from the street)
      ringSlab(g, inner, outer, y0 - 0.08, y0 + 0.18, slabC, f < 14 ? under : null);
      // glass railing and a slim top rail along the outer edge
      const n = outer.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = outer[i * 2], az = outer[i * 2 + 1], bx = outer[j * 2], bz = outer[j * 2 + 1];
        if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
        c.clear.quad(ax, y0 + 0.18, az, bx, y0 + 0.18, bz, bx, y0 + 1.12, bz, ax, y0 + 1.12, az, railC, -(bz - az), 0, bx - ax);
        if (Math.hypot(bx - ax, bz - az) > 1.6) g.quad(ax, y0 + 1.1, az, bx, y0 + 1.1, bz, bx, y0 + 1.16, bz, ax, y0 + 1.16, az, p.frame, -(bz - az), 0, bx - ax);
      }
      if (c.near && f < 6) {
        eachEdge(c, pts, (len, i) => {
          if (len < 4) return;
          c.t.push(0, 0, 0.0, 0);
          balconySet(c, (hash2(c.b.seed, 4800 + f * 11 + i) - 0.5) * (len - 3), y0 + 0.18, f * 5 + i);
          c.t.pop();
        });
      }
    }
    if (style === 'glass' || style === 'punched' || style === 'fins') {
      // slab edge bands proud of the glass
      eachEdge(c, pts, (len) => band(g, -len / 2 - 0.08, len / 2 + 0.08, y0 - 0.1, y0 + 0.24, style === 'glass' ? 0.16 : 0.1, slabC));
    }
  }
  if (!constant || f1 <= s.f0) return;
  const yb = s.f0 * FH, yt = f1 * FH;
  eachEdge(c, pts, (len, i) => {
    const n = Math.max(1, Math.round(len / p.bay));
    for (let q = 0; q <= n; q++) {
      const x = -len / 2 + (q / n) * len;
      if (style === 'fins' && q % 2 === 0) fin(g, x, yb - 0.1, yt + 0.3, 0.22, 0.75, p.panel);
      else fin(g, x, yb, yt, 0.06, 0.06, p.frame);
    }
    if (style === 'fins') {
      // recessed balconies between the fins: glass railings every other floor
      for (let f = s.f0; f < f1; f += 2) {
        const y0 = f * FH;
        c.clear.quad(-len / 2, y0 + 0.24, 0.7, len / 2, y0 + 0.24, 0.7, len / 2, y0 + 1.12, 0.7, -len / 2, y0 + 1.12, 0.7, railC, 0, 0, 1);
      }
    }
    void i;
  });
}

/** Balcony furniture (props) in the current edge frame; balcony floor at y, out to +Z. */
function balconySet(c: Ctx, u: number, y: number, k: number): void {
  const P = c.props, t = c.t;
  const r = (j: number) => hash2(c.b.seed, 15500 + k * 17 + j);
  const v = r(0);
  if (v < 0.35) {
    P.add('bistroTable', t, u, y, 0.75, 0, 0.75, 1, 0.75);
    P.add('chairBistro', t, u - 0.6, y, 0.7, Math.PI / 2, 1, 1, 1, c.pick([C.white, C.dark, hx('#c0392b')], 15500 + k));
    if (r(1) < 0.6) P.add('chairBistro', t, u + 0.6, y, 0.7, -Math.PI / 2, 1, 1, 1, c.pick([C.white, C.dark], 15600 + k));
  } else if (v < 0.55) {
    P.add('plantBush', t, u, y, 0.8, r(2) * 6, 0.8, 0.8, 0.8);
    P.add('plantPot', t, u + 0.7, y, 0.9, r(3) * 6, 2, 2, 2);
  } else if (v < 0.65) {
    P.add('chairArm', t, u, y, 0.7, Math.PI + 0.3, 0.8, 0.8, 0.8, c.pick([hx('#3d4f6b'), hx('#7a6a5a'), C.white], 15700 + k));
  }
}

// ================================================================ podium

/** Where the shops and the lobby are along the podium front. */
function frontage(p: TowerPlan, units: HostedUnit[]): { shops: { u: HostedUnit; x0: number; x1: number }[]; lobby: [number, number] } {
  const hw = p.pw / 2 - 0.25;
  const shops = units.filter((u) => u.level === 0).map((u) => ({ u, x0: Math.max(-hw, u.lx - u.b.w / 2 + 0.12), x1: Math.min(hw, u.lx + u.b.w / 2 - 0.12) }))
    .filter((s) => s.x1 - s.x0 > 2).sort((a, b) => a.x0 - b.x0);
  // the lobby: the widest gap between the shops (the middle strip in the sim's layout)
  const edges = [-hw, ...shops.flatMap((s) => [s.x0, s.x1]), hw];
  let best: [number, number] = [-3, 3], bw = 0;
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    if (b - a > bw) { bw = b - a; best = [a, b]; }
  }
  if (bw > 9) best = [(best[0] + best[1]) / 2 - 4.5, (best[0] + best[1]) / 2 + 4.5];
  return { shops, lobby: best };
}

function podium(c: Ctx, p: TowerPlan, cut0: boolean): void {
  const g = c.solid;
  const pw = p.pw, pd = p.pd;
  const { shops, lobby } = frontage(p, c.units);
  const stone = p.stone, stoneD = shade(stone, 0.82);
  // the body: a stone box; the front is mostly glass (drawn over it)
  if (!cut0) {
    // (no front face: shop windows, the lobby recess and stone piers cover the front, and close up you see into the shops)
    shell(g, 0, 0, pw - 0.1, FH, pd - 0.1, stoneD, false);
    // plinth and a cornice band at the first floor line
    c.sides(0, 0, pw, pd, (_s, len) => {
      g.box(0, 0, 0.0, len + 0.1, 0.12, 0.12, shade(stone, 0.7), 0, false);
      band(g, -len / 2 - 0.05, len / 2 + 0.05, FH - 0.08, FH + 0.06, 0.14, stone);
    });
  } else {
    // opened up: the floor slab and see-through walls
    c.ghost.box(0, 0, 0, pw - 0.1, FH - 0.05, pd - 0.1, stone);
  }
  // podium roof where the shaft is narrower (a green roof with a railing)
  const base = p.segs[0];
  const plate = outline(base, base.f0);
  const [bx0, bz0, bx1, bz1] = bounds(base.balc > 0 ? offsetOutline(plate, base.balc) : plate);
  if (!cut0 && (bx1 - bx0 < pw - 1.2 || bz1 - bz0 < pd - 1.2)) {
    g.box(0, FH, 0, pw - 0.1, 0.06, pd - 0.1, hx('#8d9a7a'), 0, false);
    c.sides(0, 0, pw, pd, (_s, len) => {
      c.clear.quad(-len / 2, FH + 0.04, -0.12, len / 2, FH + 0.04, -0.12, len / 2, FH + 1.05, -0.12, -len / 2, FH + 1.05, -0.12, p.rail, 0, 0, 1);
      g.box(0, FH + 1.05, -0.12, len, 0.05, 0.06, p.frame, 0, false);
    });
    for (let k = 0; k < 4; k++) {
      const x = (k % 2 ? 1 : -1) * (pw / 2 - 1.1), z = (k < 2 ? 1 : -1) * (pd / 2 - 1.1);
      if (Math.abs(x) > (bx1 - bx0) / 2 + 0.8 || Math.abs(z) > (bz1 - bz0) / 2 + 0.8) planter(c, x, z, 1.2, 1.2, true, 60 + k);
    }
  }
  if (cut0) return;
  // front: piers between the shops and the lobby
  c.t.push(0, 0, pd / 2, 0);
  const used: [number, number][] = [...shops.map((s) => [s.x0, s.x1] as [number, number]), lobby].sort((a, b) => a[0] - b[0]);
  let x = -pw / 2;
  for (const [a, b] of used) {
    if (a - x > 0.05) band(g, x, a, 0, FH - 0.3, 0.16, stone);
    x = Math.max(x, b);
  }
  if (pw / 2 - x > 0.05) band(g, x, pw / 2, 0, FH - 0.3, 0.16, stone);
  for (const s of shops) {
    const uc = new Ctx(s.u.b, s.u.look, false, c.near, c.closeUp, c);
    uc.signOwner = s.u.b.id;
    c.mark(s.u.b.id);
    shopFront(uc, p, s.x0, s.x1, s.u, c.ld / 2 - pd / 2);
    if (c.near && s.u.b.kind !== 'shopfront') {
      // the shop itself, seen through the clear glass
      c.t.push(s.u.lx, 0, s.u.lz - pd / 2, 0);
      shopRoom(uc, s.u.b.w - 0.2, s.u.b.d - 0.3, stationsOf(s.u.b), s.u.b.kind === 'restaurant' ? C.floorWood : C.tile, mix(uc.brand, C.white, 0.75));
      c.t.pop();
    } else if (c.near) {
      // an empty shop: bare floor and walls behind the paper
      c.t.push(s.u.lx, 0, s.u.lz - pd / 2, 0);
      shopRoom(uc, s.u.b.w - 0.2, s.u.b.d - 0.3, null, hx('#9a958c'), hx('#d8d2c4'));
      c.t.pop();
    }
    c.endMark();
  }
  lobbyFront(c, p, lobby[0], lobby[1]);
  c.t.pop();
  // sides: the corner shops' side windows, otherwise stone with a service door
  c.sides(0, 0, pw, pd, (side, len) => {
    if (side === 0) return;
    if (side === 2) {
      // back: the garage entrance and a loading door
      const gx = (hash2(c.b.seed, 4900) - 0.5) * (len - 8);
      g.box(gx, 0, 0.02, 4.2, 2.7, 0.06, C.black, 0, false);
      band(g, gx - 2.3, gx + 2.3, 2.7, 3.0, 0.2, stoneD);
      c.lit(WS.lobby).box(gx, 2.45, 0.1, 3.6, 0.06, 0.1, hx('#fff2d0'));
      c.sign('P', gx + 2.9, 1.9, 0.7, 0.7, 0.04, null);
      c.door(gx - 4.6, 1.1, 2.2, C.dark, C.dark);
      c.warm.box(gx - 4.6, 2.5, 0.12, 0.3, 0.12, 0.12, GLOW_BULB);
      return;
    }
    const sx = side === 1 ? 1 : -1;
    const corner = shops.find((s) => (sx > 0 ? s.x1 > pw / 2 - 0.6 : s.x0 < -pw / 2 + 0.6));
    // in this frame +x runs from the front corner to the back corner on side 1, the other way on side 3
    const toFront = (d: number) => (side === 1 ? -len / 2 + d : len / 2 - d);
    if (corner) {
      const deep = Math.min(corner.u.b.d - 0.8, len * 0.5);
      const a = toFront(0.4), b = toFront(deep);
      const uc = new Ctx(corner.u.b, corner.u.look, false, c.near, c.closeUp, c);
      c.mark(corner.u.b.id);
      shopGlass(uc, Math.min(a, b), Math.max(a, b), corner.u);
      c.endMark();
    }
    c.door(toFront(len * 0.72), 1.0, 2.2, C.dark, C.dark);
  });
  // canopy over the lobby
  c.t.push(0, 0, pd / 2, 0);
  const lw = lobby[1] - lobby[0], lc = (lobby[0] + lobby[1]) / 2;
  if (p.res) {
    g.box(lc, 2.95, 1.1, lw + 1.2, 0.22, 2.2, p.frame, 0, true);
    for (let k = 0; k < 4; k++) c.warm.box(lc - lw / 2 + (k + 0.5) * (lw / 4), 2.92, 1.4, 0.18, 0.03, 0.18, GLOW_BULB);
  } else {
    c.clear.box(lc, 3.0, 1.3, lw + 1.8, 0.05, 2.6, p.rail);
    for (const sx of [-1, 1]) g.box(lc + sx * (lw / 2 + 0.5), 2.95, 1.3, 0.1, 0.1, 2.6, p.frame, 0, false);
    g.box(lc, 2.95, 2.55, lw + 1.8, 0.1, 0.1, p.frame, 0, false);
  }
  c.t.pop();
}

/** Glass of a shop unit (current wall frame, x0..x1), lit or papered over by its state. */
function shopGlass(uc: Ctx, x0: number, x1: number, u: HostedUnit, door?: number): void {
  const g = uc.solid;
  const vacant = u.b.kind === 'shopfront';
  // close up the glass is clear and the shop is seen behind it (shopRoom); farther away the panes glow
  const clear = uc.near && !vacant;
  const pane = (a: number, y0: number, b: number, y1: number, z: number) => {
    if (clear) uc.clear.quad(a, y0, z, b, y0, z, b, y1, z, a, y1, z, hx('#b9d0dc'), 0, 0, 1);
    else uc.lit(vacant ? WS.dark : WS.shop).quad(a, y0, z, b, y0, z, b, y1, z, a, y1, z, GLASS_SHOP, 0, 0, 1);
  };
  const frame = vacant ? hx('#5a5f66') : uc.pick([C.dark, hx('#2a2c30'), C.steel, uc.brandDark], 50);
  const n = Math.max(1, Math.round((x1 - x0) / 1.7));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w + 0.04, b = x0 + (i + 1) * w - 0.04;
    if (door !== undefined && door > a - 0.2 && door < b + 0.2) {
      // the door: glass in a frame
      pane(door - 0.55, 0.05, door + 0.55, 2.35, 0.08);
      g.box(door, 0.0, 0.06, 1.3, 2.45, 0.04, frame, 0, false);
      g.box(door, 2.35, 0.08, 1.3, 0.25, 0.06, frame, 0, false);
      for (const ex of [door - 0.62, door + 0.62]) g.box(ex, 0.0, 0.08, 0.1, 2.6, 0.06, frame, 0, false);
      if (door - 0.7 - a > 0.3) pane(a, 0.15, door - 0.7, 2.55, 0.06);
      if (b - door - 0.7 > 0.3) pane(door + 0.7, 0.15, b, 2.55, 0.06);
      continue;
    }
    if (vacant) {
      // papered over, with a strip of dark glass above
      const paper = mix(hx('#d8cdb5'), C.white, hash2(u.b.seed, 600 + i) * 0.4);
      uc.lit(WS.dark).quad(a, 0.15, 0.06, b, 0.15, 0.06, b, 1.95, 0.06, a, 1.95, 0.06, paper, 0, 0, 1);
      uc.lit(WS.dark).quad(a, 1.95, 0.06, b, 1.95, 0.06, b, 2.55, 0.06, a, 2.55, 0.06, GLASS_SHOP, 0, 0, 1);
    } else pane(a, 0.15, b, 2.55, 0.06);
  }
  for (let i = 0; i <= n; i++) g.box(x0 + i * w, 0.1, 0.06, 0.07, 2.5, 0.06, frame, 0, false);
  g.box((x0 + x1) / 2, 0.05, 0.05, x1 - x0, 0.12, 0.1, shade(frame, 0.8), 0, false);
  g.box((x0 + x1) / 2, 2.55, 0.06, x1 - x0, 0.08, 0.08, frame, 0, false);
}

/** A shop in the podium (current frame: the podium front, x along it). `yard` = room in front of the facade. */
function shopFront(uc: Ctx, p: TowerPlan, x0: number, x1: number, u: HostedUnit, yard: number): void {
  const g = uc.solid;
  const kind = u.b.kind;
  const vacant = kind === 'shopfront';
  const w = x1 - x0, xc = (x0 + x1) / 2;
  const door = xc + (u.lx < 0 ? 1 : -1) * (w / 2 - 1.1);
  shopGlass(uc, x0, x1, u, door);
  // fascia band with the name
  const fasciaC = vacant ? shade(p.stone, 0.9) : kind === 'bank' ? shade(p.stone, 1.05) : uc.brandDark;
  band(g, x0, x1, 2.62, 3.12, 0.12, fasciaC);
  if (vacant) {
    uc.sign('FOR LEASE', xc, 1.15, Math.min(2.4, w * 0.45), 0.6, 0.075, null, 'lease');
    uc.sign('AVAILABLE', xc, 2.7, Math.min(w - 1.2, 3.6), 0.34, 0.13, null, 'lease');
    return;
  }
  const name = u.look.firmName;
  if (kind === 'restaurant') {
    // a fabric awning in the brand color, tables out front
    const ad = Math.min(1.5, Math.max(0.6, yard - 0.4));
    const stripes = Math.max(4, Math.round(w / 0.6));
    for (let i = 0; i < stripes; i++) {
      const a = x0 + 0.15 + (i / stripes) * (w - 0.3), b = x0 + 0.15 + ((i + 1) / stripes) * (w - 0.3);
      const col = uc.r(51) < 0.5 && i % 2 ? C.white : uc.brand;
      g.slab([a, 2.3, ad, b, 2.3, ad, b, 2.62, 0.08, a, 2.62, 0.08], 0.04, col, 0, 1, 0.5, shade(col, 0.7));
      g.box((a + b) / 2, 2.05, ad, b - a, 0.25, 0.03, col, 0, false);
    }
    uc.sign(name, xc, 2.7, Math.min(w - 0.8, 5.5), 0.38, 0.16, null);
    if (yard > 1.4) {
      for (let k = 0; k < Math.floor((w - 1) / 2.2); k++) {
        const tx = x0 + 1.2 + k * 2.2;
        if (Math.abs(tx - door) < 1.0) continue;
        g.cyl(tx, 0.0, 0.85, 0.05, 0.05, 0.72, 5, C.iron);
        g.cyl(tx, 0.72, 0.85, 0.36, 0.36, 0.04, 10, C.white);
        if (uc.near) {
          for (const sx of [-0.55, 0.55]) uc.props.add('chairBistro', uc.t, tx + sx, 0, 0.85, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 1, 1, 1, uc.brandDark);
        } else for (const sx of [-0.55, 0.55]) g.box(tx + sx, 0, 0.85, 0.4, 0.45, 0.4, C.iron, 0, false);
      }
    }
    return;
  }
  if (kind === 'bank') {
    // a stone portal and the logo panel
    for (const ex of [x0, x1]) band(g, ex - 0.25, ex + 0.25, 0, 3.12, 0.3, shade(p.stone, 1.1));
    uc.sign(name, xc, 2.7, Math.min(w - 1.2, 5.5), 0.36, 0.16, null);
    g.box(x0 + 0.9, 0.9, 0.12, 0.7, 1.0, 0.08, hx('#5d6670'));
    uc.screen.box(x0 + 0.9, 1.45, 0.17, 0.32, 0.22, 0.02, hx('#9fd0ff'));
    return;
  }
  if (kind === 'clinic') {
    // a doctors' practice: its name beside the heart pictogram on a white panel (health.ts)
    uc.sign(name ?? 'Clinic', xc, 2.68, Math.min(w - 0.8, 5.5), 0.4, 0.16, null, 'medical');
    return;
  }
  // a store: a slim metal canopy and the name on the fascia
  if (uc.r(52) < 0.6) g.box(xc, 2.55, Math.min(1.1, yard - 0.3) / 2 + 0.06, w - 0.2, 0.08, Math.min(1.1, yard - 0.3), C.dark, 0, true);
  uc.sign(name, xc, 2.68, Math.min(w - 0.8, 5.5), 0.4, 0.16, null);
  if (uc.near) streetBits(uc, door + (u.lx < 0 ? -1.6 : 1.0), 0.8, 0, 3, ['board']);
}

/** The lobby (current frame: the podium front). */
function lobbyFront(c: Ctx, p: TowerPlan, x0: number, x1: number): void {
  const g = c.solid;
  const w = x1 - x0, xc = (x0 + x1) / 2;
  // a recess: glass set back 0.6, stone reveals
  const n = Math.max(2, Math.round(w / 1.6));
  for (let i = 0; i < n; i++) {
    const a = x0 + (i / n) * w + 0.03, b = x0 + ((i + 1) / n) * w - 0.03;
    if (Math.abs((a + b) / 2 - xc) < 1.3) continue;
    c.lit(WS.lobby).quad(a, 0.08, -0.6, b, 0.08, -0.6, b, 2.85, -0.6, a, 2.85, -0.6, GLASS_SHOP, 0, 0, 1);
  }
  for (let i = 0; i <= n; i++) g.box(x0 + (i / n) * w, 0.05, -0.6, 0.06, 2.85, 0.06, p.frame, 0, false);
  g.box(xc, 2.85, -0.6, w, 0.12, 0.08, p.frame, 0, false);
  g.box(xc, 0, -0.3, w, 0.05, 0.6, shade(p.stone, 1.15), 0, false);
  for (const ex of [x0, x1]) g.quad(ex, 0, -0.6, ex, 0, 0, ex, FH - 0.3, 0, ex, FH - 0.3, -0.6, shade(p.stone, 0.9), ex < xc ? 1 : -1, 0, 0);
  g.quad(x0, FH - 0.3, -0.6, x1, FH - 0.3, -0.6, x1, FH - 0.3, 0, x0, FH - 0.3, 0, shade(p.stone, 0.75), 0, -1, 0);
  // a revolving door (offices) or double doors
  if (!p.res && w > 4) {
    c.clear.cyl(xc, 0.05, -0.55, 1.2, 1.2, 2.4, 12, p.rail, 0, false);
    g.cyl(xc, 2.45, -0.55, 1.28, 1.28, 0.3, 12, p.frame);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; g.box(xc + Math.cos(a) * 0.55, 0.05, -0.55 + Math.sin(a) * 0.55, 0.04, 2.4, 1.1, p.frame, -a, false); }
  } else c.door(xc, 2.2, 2.6, C.dark, p.frame, 0, true);
  c.lit(WS.lobby).box(xc, 2.9, -0.3, w - 0.4, 0.03, 0.4, hx('#fff6e0'));
  // the name and the street number
  c.sign(p.name, xc, 3.02, Math.min(w + 1, 7.5), 0.42, p.res ? 2.2 : 2.6, null, 'metal');
  c.sign(String(p.num), x0 - 0.35, 1.6, 0.5, 0.36, 0.17, null, 'metal');
  if (c.near) {
    c.props.add('plantFloor', c.t, x0 + 0.5, 0, 0.6, 0.4, 1.2, 1.2, 1.2);
    c.props.add('plantFloor', c.t, x1 - 0.5, 0, 0.6, 1.2, 1.2, 1.2, 1.2);
  }
}

// ================================================================= crown

function officeCrown(c: Ctx, p: TowerPlan, s: Seg, sign: string | undefined): void {
  const g = c.solid;
  const H = s.f1 * FH;
  const pts = outline(s, s.f1);
  const [x0, z0, x1, z1] = bounds(pts);
  const w = x1 - x0, d = z1 - z0;
  const roofC = hx('#7d7f82');
  const crownLit = c.lit(WS.crown, 1.6);
  switch (p.crown) {
    case 'flat': {
      parapet(g, pts, H, 1.3, shade(p.frame, 0.95), roofC);
      // set-back mechanical penthouse with louvers
      const mw = w * 0.62, md = d * 0.55;
      g.box(0, H, -d * 0.08, mw, 4.2, md, shade(p.span, 1.1));
      c.sides(0, -d * 0.08, mw, md, (_s, len) => { for (let y = H + 0.4; y < H + 3.9; y += 0.35) g.box(0, y, 0.03, len - 0.2, 0.08, 0.06, shade(p.frame, 0.85), 0, false); });
      // window-washing crane (BMU)
      g.box(w * 0.2, H + 4.2, -d * 0.08, 1.2, 1.4, 1.2, C.white);
      g.box(w * 0.2, H + 5.4, -d * 0.08 + 2.8, 0.5, 0.4, 6.5, C.white);
      eachEdge(c, offsetOutline(pts, 0.03), (len) => crownLit.box(0, H + 1.0, 0, len, 0.22, 0.04, p.light, 0, false));
      break;
    }
    case 'slope': {
      // a sloped glass top rising toward the back
      const hh = p.crownH;
      parapet(g, pts, H, 0.6, shade(p.frame, 0.95), roofC);
      const pts3 = (y: (z: number) => number) => { const o: number[] = []; for (let i = 0; i < pts.length; i += 2) o.push(pts[i], y(pts[i + 1]), pts[i + 1]); return o; };
      const yAt = (z: number) => H + 0.6 + hh * clamp01((z1 - z) / d);
      c.lit(WS.dark).poly(pts3(yAt), shade(p.tint, 1.1), 0, 1, 0.6);
      // the walls under the slope
      const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
        c.lit(WS.dark).poly([ax, H + 0.6, az, bx, H + 0.6, bz, bx, yAt(bz), bz, ax, yAt(az), az], shade(p.tint, 0.9), -(bz - az), 0, bx - ax);
      }
      // ribs on the slope, lit at night
      for (let k = 0; k <= 6; k++) {
        const x = x0 + (k / 6) * w;
        crownLit.beam(x, yAt(z1) + 0.05, z1, x, yAt(z0) + 0.05, z0, 0.12, p.light);
      }
      g.box(0, H + 0.6, 0, w * 0.5, Math.max(1, hh * 0.4), d * 0.4, shade(p.span, 1.1));
      break;
    }
    case 'stepped': {
      // three tiers, each lit along its top edge
      parapet(g, pts, H, 0.4, shade(p.frame, 0.95), roofC);
      let y = H;
      for (let k = 0; k < 3; k++) {
        const inset = 1.2 + k * 1.5;
        const tpts = offsetOutline(pts, -inset);
        const th = 3.0 - k * 0.4;
        prism(c.lit(k === 2 ? WS.offAll : WS.dark), tpts, y, y + th, shade(p.tint, 1.05 + k * 0.05), false, true);
        prism(g, tpts, y + th - 0.25, y + th, shade(p.frame, 0.95), true, true);
        const yy = y;
        eachEdge(c, tpts, (len) => crownLit.box(0, yy + th - 0.35, 0.02, len, 0.08, 0.04, p.light, 0, false));
        y += th;
      }
      break;
    }
    case 'fins': {
      // the facade fins run on past the roof: an open screen, uplit at night
      parapet(g, pts, H, 0.8, shade(p.frame, 0.9), roofC);
      g.box(0, H, 0, w * 0.55, 3.6, d * 0.5, shade(p.span, 1.1));
      eachEdge(c, pts, (len) => crownLit.box(0, H + 0.82, 0.3, len - 0.4, 0.06, 0.4, p.light, 0, false));
      break;
    }
    case 'ring': {
      // a cantilevered halo above the roof
      parapet(g, pts, H, 1.0, shade(p.frame, 0.95), roofC);
      g.box(0, H, 0, w * 0.5, 3.4, d * 0.5, shade(p.span, 1.1));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * (w / 2 - 1), H + 1, sz * (d / 2 - 1), 0.4, p.crownH - 1, 0.4, p.frame);
      const ring = offsetOutline(pts, 0.8), inner = offsetOutline(pts, -1.2);
      ringSlab(g, inner, ring, H + p.crownH - 0.6, H + p.crownH, p.frame, shade(p.frame, 0.7));
      eachEdge(c, ring, (len) => crownLit.box(0, H + p.crownH - 0.55, 0.02, len, 0.45, 0.03, p.light, 0, false));
      break;
    }
    default: break;
  }
  // the biggest tenant's name near the top, front and back
  if (sign) {
    for (const back of [false, true]) {
      c.t.push(0, 0, back ? z0 : z1, back ? Math.PI : 0);
      const sy = p.crown === 'slope' ? H + 0.05 : p.crown === 'flat' ? H + 0.15 : H - FH + 0.5;
      c.sign(sign, 0, sy, Math.min(w - 2.5, 11), Math.min(1.1, w / 10), 0.08, null);
      c.t.pop();
    }
  }
  if (p.spire > 0) spireOn(c, p, H + p.crownH);
}

function spireOn(c: Ctx, p: TowerPlan, y: number): void {
  const g = c.solid;
  g.cyl(0, y, 0, 1.6, 1.2, 2.5, 8, shade(p.frame, 0.9));
  g.cyl(0, y + 2.5, 0, 0.9, 0.35, p.spire * 0.55, 8, C.steel);
  g.cyl(0, y + 2.5 + p.spire * 0.55, 0, 0.3, 0.06, p.spire * 0.45, 6, C.steel);
  c.lit(WS.crown, 1.6).cyl(0, y + 2.4, 0, 1.25, 1.25, 0.12, 8, p.light, 0, false);
}

function resCrown(c: Ctx, p: TowerPlan, s: Seg): void {
  const g = c.solid;
  const H = s.f1 * FH;
  const pts = outline(s, s.f1);
  const [x0, z0, x1, z1] = bounds(pts);
  const w = x1 - x0, d = z1 - z0;
  const deck = hx('#a88a66'), tile = hx('#d8d4cc');
  prism(g, pts, H - 0.05, H + 0.25, p.slab);
  switch (p.crown) {
    case 'terrace': {
      // a roof deck with a pool, glass railing, a pergola and planters
      flatPoly(g, offsetOutline(pts, -0.3), H + 0.27, tile);
      const pw_ = w * 0.42, pd_ = d * 0.28;
      for (const [ox, oz, ow, od] of [[0, (pd_ + 0.3) / 2, pw_ + 0.6, 0.3], [0, -(pd_ + 0.3) / 2, pw_ + 0.6, 0.3], [(pw_ + 0.3) / 2, 0, 0.3, pd_], [-(pw_ + 0.3) / 2, 0, 0.3, pd_]]) g.box(-w * 0.12 + ox, H + 0.25, d * 0.12 + oz, ow, 0.16, od, C.white);
      c.glass.quad(-w * 0.12 - pw_ / 2, H + 0.36, d * 0.12 + pd_ / 2, -w * 0.12 + pw_ / 2, H + 0.36, d * 0.12 + pd_ / 2, -w * 0.12 + pw_ / 2, H + 0.36, d * 0.12 - pd_ / 2, -w * 0.12 - pw_ / 2, H + 0.36, d * 0.12 - pd_ / 2, hx('#3fb0d0'), 0, 1, 0);
      c.warm.box(-w * 0.12, H + 0.3, d * 0.12 - pd_ / 2 - 0.05, pw_ * 0.8, 0.04, 0.04, hx('#7fe0ff'));
      g.box(w * 0.22, H + 0.27, d * 0.18, w * 0.3, 0.06, d * 0.3, deck, 0, false);
      for (let k = 0; k < 4; k++) g.box(w * 0.22 + (k - 1.5) * (w * 0.09), H + 0.27, d * 0.18 + d * 0.15, 0.12, 2.6, 0.12, C.dark);
      for (let k = 0; k < 7; k++) g.box(w * 0.22, H + 2.85, d * 0.18 + d * 0.15 - k * 0.5, w * 0.32, 0.08, 0.12, deck);
      g.box(-w * 0.05, H + 0.27, -d * 0.22, w * 0.5, 3.2, d * 0.32, shade(p.panel, 0.95));
      eachEdge(c, pts, (len) => {
        c.clear.quad(-len / 2, H + 0.25, -0.15, len / 2, H + 0.25, -0.15, len / 2, H + 1.4, -0.15, -len / 2, H + 1.4, -0.15, p.rail, 0, 0, 1);
      });
      for (let k = 0; k < 3; k++) planter(c, x1 - 1.2, z0 + 1.5 + k * 2.2, 1.1, 1.1, true, 70 + k);
      if (c.near) {
        for (let k = 0; k < 4; k++) c.props.add('chairArm', c.t, -w * 0.12 - pw_ / 2 + 0.6 + k * 1.1, H + 0.3, d * 0.12 + pd_ / 2 + 0.9, Math.PI, 0.9, 0.7, 1.3, C.white);
        for (let k = 0; k < 2; k++) c.props.add('umbrella', c.t, -w * 0.12 - pw_ / 2 + 1.2 + k * 2.2, H + 0.3, d * 0.12 + pd_ / 2 + 1.6, 0, 1, 1, 1, c.pick([C.white, hx('#e8dcc4')], 72));
      }
      break;
    }
    case 'penthouse': {
      // a set-back glass penthouse under a floating roof
      const pp = offsetOutline(pts, -1.6);
      flatPoly(g, pts, H + 0.27, tile);
      prism(c.lit(WS.resB), pp, H + 0.25, H + FH, mix(GLASS_RES, p.tint, 0.3), false, true);
      prism(g, offsetOutline(pts, 0.3), H + FH, H + FH + 0.4, p.slab, true, true, true);
      eachEdge(c, pts, (len) => c.clear.quad(-len / 2, H + 0.25, -0.1, len / 2, H + 0.25, -0.1, len / 2, H + 1.3, -0.1, -len / 2, H + 1.3, -0.1, p.rail, 0, 0, 1));
      break;
    }
    case 'canopy': {
      // an open frame: a thin roof plane on columns over the terrace, lit from below
      flatPoly(g, offsetOutline(pts, -0.3), H + 0.27, tile);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * (w / 2 - 0.5), H + 0.25, sz * (d / 2 - 0.5), 0.35, 3.8, 0.35, p.frame);
      prism(g, offsetOutline(pts, 0.4), H + 4.05, H + 4.3, p.slab, true, true, true);
      eachEdge(c, offsetOutline(pts, 0.4), (len) => c.lit(WS.crown, 1.6).box(0, H + 3.98, -0.1, len - 0.2, 0.05, 0.05, p.light, 0, false));
      g.box(0, H + 0.25, -d * 0.15, w * 0.45, 3.0, d * 0.35, shade(p.panel, 0.95));
      break;
    }
    case 'lantern': {
      // a lit glass box on top (the residents' lounge)
      flatPoly(g, pts, H + 0.27, tile);
      const lp = offsetOutline(pts, -2.4);
      prism(c.lit(WS.lobby), lp, H + 0.25, H + 4.2, mix(GLASS_SHOP, p.tint, 0.3), false, true);
      prism(g, offsetOutline(lp, 0.25), H + 4.2, H + 4.6, p.slab, true, true, true);
      eachEdge(c, offsetOutline(lp, 0.25), (len) => c.lit(WS.crown, 1.6).box(0, H + 4.25, 0.02, len, 0.06, 0.03, p.light, 0, false));
      break;
    }
    default: break;
  }
  if (c.near && p.crown !== 'lantern') roofClutter(c, 0, 0, w, d, H + 0.27, [[-w * 0.12, d * 0.12, w * 0.25, d * 0.18], [w * 0.22, d * 0.18, w * 0.2, d * 0.25]], 8, { ac: 2, vents: 2 });
  if (p.spire > 0) spireOn(c, p, H + p.crownH);
}

/** A setback terrace on top of a lower segment where the next one is slimmer. */
function setbackTerrace(c: Ctx, p: TowerPlan, lower: Seg, upper: Seg): void {
  const g = c.solid;
  const y = lower.f1 * FH;
  const lo = lower.balc > 0 ? offsetOutline(outline(lower, lower.f1 - 1), lower.balc) : outline(lower, lower.f1 - 1);
  prism(g, lo, y - 0.08, y + 0.2, p.slab);
  eachEdge(c, lo, (len) => c.clear.quad(-len / 2, y + 0.2, -0.05, len / 2, y + 0.2, -0.05, len / 2, y + 1.25, -0.05, -len / 2, y + 1.25, -0.05, p.rail, 0, 0, 1));
  const up = outline(upper, upper.f0);
  const [ux0, uz0, ux1, uz1] = bounds(up);
  const [lx0, lz0, lx1, lz1] = bounds(lo);
  if (lz1 - uz1 > 1.6) for (let k = 0; k < 3; k++) planter(c, ux0 + (k + 0.5) * ((ux1 - ux0) / 3), (uz1 + lz1) / 2, 1.4, 0.8, k === 1, 80 + k);
  void lx0; void lx1; void lz0; void uz0;
}

// ================================================================= tower

/** The most frequent tenant name among a tower's leased office floors (for the crown sign). */
function biggestTenant(units: HostedUnit[]): string | undefined {
  const n = new Map<string, number>();
  for (const u of units) if (u.level > 0 && u.b.kind !== 'suite' && u.look.firmName) n.set(u.look.firmName, (n.get(u.look.firmName) ?? 0) + 1);
  let best: string | undefined, bn = 1;
  for (const [k, v] of n) if (v > bn || (v === bn && best === undefined && v >= 2)) { best = k; bn = v; }
  return best;
}

/** A finished tower (`kind` tower or officetower). */
export function tower(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const p = towerPlan(b, c.look.firmName);
  const F = p.floors;
  const cutF = c.cutLevel;
  lotGround(c, 'paved');
  // forecourt paving, trees in grates at the curb
  const yard = c.ld / 2 - p.pd / 2;
  if (yard > 1.2) {
    g.box(0, 0.05, p.pd / 2 + yard / 2, c.lw - 0.2, 0.02, yard, hx('#bdb8ae'), 0, false);
    for (const sx of [-1, 1]) if (c.lw > 14) { tree(c, sx * (c.lw / 2 - 1.6), c.ld / 2 - 0.9, 0.7, 5 + sx, 0.05, 'leafy'); g.box(sx * (c.lw / 2 - 1.6), 0.06, c.ld / 2 - 0.9, 1.2, 0.02, 1.2, C.iron, 0, false); }
  }
  const fl = floorsOf(c, p);
  const top = cutF >= 0 ? Math.max(1, cutF) : F;
  // podium (floor 0)
  podium(c, p, cutF === 0);
  // a solid core inside the glass (shadows, and nothing to see through gaps)
  for (const s of p.segs) {
    const f1 = Math.min(s.f1, top);
    if (f1 <= s.f0) continue;
    coreFill(g, s, s.f0 * FH - 0.1, f1 * FH, hx('#3a3f45'));
    if (p.res) resShaft(c, p, s, fl, top);
    else officeShaft(c, p, s, fl, top);
  }
  if (cutF < 0) {
    for (let i = 0; i + 1 < p.segs.length; i++) setbackTerrace(c, p, p.segs[i], p.segs[i + 1]);
    const last = p.segs[p.segs.length - 1];
    if (p.res) resCrown(c, p, last);
    else officeCrown(c, p, last, biggestTenant(c.units) ?? (c.look.firmName ? p.name : undefined));
  } else openFloor(c, p, cutF, fl);
  // street furniture
  if (c.near && cutF !== 0) {
    streetBits(c, -p.pw / 2 + 0.8, c.ld / 2 - 0.7, 0, 1, ['bikes']);
    streetBits(c, p.pw / 2 - 3.2, c.ld / 2 - 0.7, 0, 2, ['bollards']);
  }
  if (yard > 2.4) for (const sx of [-1, 1]) bench(c, sx * (p.pw / 2 - 3.5), p.pd / 2 + yard - 0.9, 0, 1.8);
  lamp(c, p.pw / 2 - 0.6, c.ld / 2 - 0.6, 4.4, Math.PI);
}

/**
 * The opened-up floor F: its slab, see-through walls, the core and partitions, and the furnished
 * stations (the tower's flats, or the office suite / shops leased on that floor); everything above
 * is a faint ghost of the tower.
 */
function openFloor(c: Ctx, p: TowerPlan, F: number, fl: Floors): void {
  const y = F * FH;
  const seg = p.segs.find((s) => F >= s.f0 && F < s.f1) ?? p.segs[0];
  const pts = F === 0 ? [-p.pw / 2, p.pd / 2, p.pw / 2, p.pd / 2, p.pw / 2, -p.pd / 2, -p.pw / 2, -p.pd / 2] : outline(seg, F);
  // see-through walls of the open floor
  eachEdge(c, pts, (len) => c.ghost.box(0, y + 0.1, -0.06, len, FH - 0.15, 0.12, hx('#cfd8de')));
  // the slab and the floor surface (furniture sits on +0.15)
  const solid = c.solid;
  c.solid = c.inside;
  prism(c.inside, pts, y - 0.25, y + 0.15, p.res ? hx('#b78b5c') : hx('#8c97a3'), true, true);
  if (F > 0 && seg.balc > 0 && p.style !== 'punched') {
    const outer = offsetOutline(pts, seg.balc);
    ringSlab(c.inside, pts, outer, y - 0.08, y + 0.18, p.slab, shade(p.slab, 0.8));
  }
  // what's on this floor
  const tables = new Set<string>();
  const sy = (s: { floor: number }) => s.floor * FH + 0.15;
  if (F === 0) {
    // the lobby (the tower's own stations) and the shops (their own frames)
    furnish(c, stationsOf(c.b).filter((s) => s.floor === 0), sy, tables);
    for (const u of c.units) {
      if (u.level !== 0) continue;
      const uc = new Ctx(u.b, u.look, true, c.near, c.closeUp, c);
      uc.solid = c.inside;
      c.mark(u.b.id);
      c.t.push(u.lx, 0, u.lz, 0);
      c.inside.box(0, 0.15, -u.b.d / 2 + 0.06, u.b.w - 0.2, FH - 0.3, 0.12, hx('#d8d2c4'));
      furnish(uc, stationsOf(u.b), sy, tables);
      c.t.pop();
      c.endMark();
    }
    coreBox(c, p, F, stationsOf(c.b).filter((s) => s.floor === 0), -p.pd * 0.2);
  } else if (p.res) {
    furnish(c, stationsOf(c.b).filter((s) => s.floor === F), sy, tables);
    const [x0, z0, x1, z1] = bounds(pts);
    ringPartitions(c, BUILDINGS.tower.unitsPerFloor, y + 0.15, (x1 - x0) / 2, (z1 - z0) / 2, 3.6);
  } else {
    const suite = fl.suiteOf.get(F);
    const st = suite ? stationsOf(suite.b) : [];
    if (suite) {
      c.mark(suite.b.id);
      const uc = new Ctx(suite.b, suite.look, true, c.near, c.closeUp, c);
      uc.solid = c.inside;
      c.t.push(suite.lx, 0, suite.lz, 0);
      furnish(uc, st, sy, tables);
      if (suite.b.kind === 'suite') vacantFloor(c, suite.b.seed, y);
      else officeFill(uc, st, y);
      c.t.pop();
      c.endMark();
    } else vacantFloor(c, c.b.seed + F, y);
    coreBox(c, p, F, st.map((s) => ({ ...s, lx: s.lx + (suite?.lx ?? 0), lz: s.lz + (suite?.lz ?? 0) })), 0);
  }
  c.solid = solid;
  // the rest of the tower above: a faint ghost
  for (const s of p.segs) {
    const f0 = Math.max(s.f0, F + 1);
    if (f0 >= s.f1) continue;
    const sp = outline(s, f0);
    const [x0, z0, x1, z1] = bounds(sp);
    c.ghost.box((x0 + x1) / 2, f0 * FH, (z0 + z1) / 2, x1 - x0, (s.f1 - f0) * FH, z1 - z0, p.res ? hx('#e6e2da') : p.tint);
  }
  if (F < p.floors) c.ghost.box(0, p.H, 0, p.segs[p.segs.length - 1].w1 * 0.6, p.crownH, p.segs[p.segs.length - 1].d1 * 0.6, hx('#d0d4d8'));
}

/** Lifts and stairs in the middle of an open floor, placed where no station is. */
function coreBox(c: Ctx, p: TowerPlan, F: number, st: { lx: number; lz: number }[], cz0: number): void {
  const y = F * FH + 0.15;
  const tries: [number, number, number, number][] = [[0, cz0, 4.4, 3.6], [0, cz0 - 2, 4.0, 3.0], [0, -5.5, 4.4, 2.6], [-5, -5, 3.0, 3.0], [5, -5, 3.0, 3.0]];
  for (const [x, z, w, d] of tries) {
    if (st.some((s) => Math.abs(s.lx - x) < w / 2 + 0.9 && Math.abs(s.lz - z) < d / 2 + 0.9)) continue;
    c.inside.box(x, y, z, w, FH - 0.2, d, hx('#a9a59c'));
    // lift doors on its front
    for (let k = 0; k < 2; k++) c.inside.box(x - w / 4 + k * (w / 2), y, z + d / 2 + 0.01, 1.0, 2.2, 0.03, C.steel, 0, false);
    void p;
    return;
  }
}

/**
 * The rest of a leased office floor (suite frame): a glass meeting room with a table in a free corner,
 * a printer and a kitchenette, plants, a reception desk with the tenant's colors.
 */
function officeFill(c: Ctx, st: { lx: number; lz: number }[], y: number): void {
  const g = c.solid;
  const free = (x: number, z: number, r: number) => !st.some((s) => Math.abs(s.lx - x) < r && Math.abs(s.lz - z) < r);
  const y0 = y + 0.15;
  for (const [x, z] of [[-5.6, -5.4], [5.6, -5.4], [-5.6, 5.0], [5.6, 5.0]]) {
    if (!free(x, z, 2.6)) continue;
    // the meeting room
    g.box(x, y0, z, 2.4, 0.04, 1.1, C.woodLight);
    g.box(x, y0, z, 2.3, 0.72, 0.9, C.woodLight);
    for (let k = 0; k < 3; k++) for (const sz of [-0.85, 0.85]) {
      if (c.closeUp) c.props.add('chairOffice', c.t, x - 0.8 + k * 0.8, y0, z + sz, sz > 0 ? Math.PI : 0, 1, 1, 1, c.brandDark);
      else g.box(x - 0.8 + k * 0.8, y0, z + sz, 0.45, 0.85, 0.45, C.dark, 0, false);
    }
    c.clear.box(x, y0, z + (z > 0 ? -1.6 : 1.6), 4.0, 2.6, 0.04, hx('#b9d0dc'));
    c.clear.box(x + (x > 0 ? -2.0 : 2.0), y0, z, 0.04, 2.6, 3.2, hx('#b9d0dc'));
    c.screen.box(x, y0 + 1.2, z + (z > 0 ? 1.45 : -1.45), 1.6, 0.9, 0.05, hx('#9fd0ff'));
    break;
  }
  for (const [x, z] of [[-7.2, 0], [7.2, 0], [0, 7.2], [0, -7.2]]) if (free(x, z, 1.0)) { g.cyl(x, y0, z, 0.3, 0.24, 0.5, 8, C.white); g.blob(x, y0 + 0.95, z, 0.45, 0.55, 0.45, C.leaf, 6, 3); }
  if (free(-3, 7, 1.4)) { g.box(-3, y0, 7, 2.4, 0.9, 0.6, C.white); g.box(-3, y0 + 0.9, 7, 2.42, 0.04, 0.62, hx('#5a5f66')); g.box(-1.6, y0, 7, 0.6, 1.8, 0.6, C.steel); }
  if (free(3, 7, 1.0)) g.box(3, y0, 7, 1.2, 1.1, 0.7, hx('#e8e8e4'));
}

/** An empty office floor for lease: bare carpet, stacked chairs, a "for lease" stand. */
function vacantFloor(c: Ctx, seed: number, y: number): void {
  const g = c.inside;
  const r = (k: number) => hash2(seed, 4950 + k);
  for (let k = 0; k < 3; k++) {
    const x = (r(k) - 0.5) * 10, z = (r(k + 5) - 0.5) * 10;
    for (let j = 0; j < 4; j++) g.box(x, y + 0.15 + j * 0.12, z, 0.5, 0.06, 0.5, C.dark);
  }
  g.box(r(9) * 4 - 2, y + 0.15, 4, 0.9, 1.4, 0.06, C.white);
}

// =========================================================== construction

/**
 * A tower going up: a concrete core climbing ahead of the floor slabs, columns, the top floors
 * wrapped in a climbing safety screen, the curtain wall following a few floors behind, tower
 * crane(s) and a hoist, and a hoarding along the street.
 */
export function towerSite(c: Ctx, p: TowerPlan, progress: number, delivered: number): void {
  const { b } = c;
  const g = c.solid;
  const F = p.floors;
  lotGround(c, 'dirt');
  const H = p.H;
  const prog = clamp01(progress);
  // excavation and foundations first (the first 6%)
  const dig = clamp01(prog / 0.06);
  const pw = p.pw, pd = p.pd;
  if (prog < 0.06) {
    g.box(0, -2.4 * dig - 0.02, 0, pw - 0.4, 0.08, pd - 0.4, shade(C.dirt, 0.75), 0, false);
    c.sides(0, 0, pw - 0.4, pd - 0.4, (_s, len) => g.box(0, -2.4 * dig, -0.1, len, 2.4 * dig + 0.05, 0.2, hx('#7d756a'), 0, false));
    excavator(c, pw * 0.15, -pd * 0.1, c.r(31) * 6);
  }
  const slabsDone = prog < 0.06 ? 0 : Math.min(F, Math.floor(((prog - 0.06) / 0.86) * F + 0.001));
  const coreTop = prog < 0.06 ? 0 : Math.min(H + 4, (slabsDone + 3) * FH);
  const facadeTo = Math.max(0, slabsDone - 6);
  const conc = hx('#b9b5ac'), concD = hx('#9d998f');
  // the podium is built with the first slabs
  if (slabsDone >= 1) {
    g.box(0, 0, 0, pw - 0.2, FH, pd - 0.2, slabsDone > 6 ? shade(p.stone, 0.85) : conc);
  }
  // the core
  if (coreTop > 0) {
    g.box(0, 0, -1, 5.6, coreTop, 5.0, concD);
    // climbing formwork on top of the core
    g.box(0, coreTop, -1, 6.4, 2.4, 5.8, hx('#d9a43a'));
    for (const sx of [-1, 1]) g.box(sx * 3.3, coreTop - 0.8, -1, 0.1, 3.2, 6.0, C.iron, 0, false);
  }
  const seg = p.segs[0];
  for (let f = Math.max(1, facadeTo); f <= slabsDone; f++) {
    const s = p.segs.find((q) => f >= q.f0 && f < q.f1) ?? p.segs[p.segs.length - 1];
    const pts = outline(s, Math.min(f, s.f1 - 1));
    const y = f * FH;
    prism(g, pts, y - 0.28, y, conc, true, true, true);
    if (s.balc > 0 && f < F) ringSlab(g, pts, offsetOutline(pts, s.balc), y - 0.08, y + 0.18, conc, concD);
    // columns between this slab and the one below (the edge ones)
    if (f > facadeTo) {
      const n = pts.length / 2;
      for (let i = 0; i < n; i += Math.max(1, Math.round(n / 6))) g.box(pts[i * 2] * 0.93, y - FH, pts[i * 2 + 1] * 0.93, 0.5, FH - 0.28, 0.5, concD);
      for (const [sx, sz] of [[-0.25, -0.25], [0.25, 0.25]]) g.box(sx * pw, y - FH, sz * pd, 0.55, FH - 0.28, 0.55, concD);
    }
  }
  // the facade follows below the working floors
  if (facadeTo > 1) {
    const savedCut = c.cutLevel;
    c.cutLevel = -1;
    const fl: Floors = { use: () => 0, suiteOf: new Map() };
    for (const s of p.segs) {
      const f1 = Math.min(s.f1, facadeTo);
      if (f1 <= s.f0) continue;
      if (p.res) resShaft(c, p, { ...s }, fl, f1);
      else officeShaft(c, p, { ...s }, fl, f1);
    }
    c.cutLevel = savedCut;
  }
  // the climbing safety screen around the top 3 working floors (with the builder's name)
  if (slabsDone >= 2 && slabsDone < F) {
    const s = p.segs.find((q) => slabsDone >= q.f0 && slabsDone < q.f1) ?? seg;
    const pts = offsetOutline(outline(s, slabsDone), (s.balc > 0 ? s.balc : 0) + 0.5);
    const y0 = Math.max(FH, (slabsDone - 2) * FH), y1 = (slabsDone + 1) * FH + 0.6;
    const screenC = c.pick([hx('#e8b631'), hx('#f2f0ea'), hx('#2e6da4'), hx('#d9533a')], 32);
    eachEdge(c, pts, (len, i) => {
      g.quad(-len / 2, y0, 0, len / 2, y0, 0, len / 2, y1, 0, -len / 2, y1, 0, screenC, 0, 0, 1);
      g.quad(len / 2, y0, -0.05, -len / 2, y0, -0.05, -len / 2, y1, -0.05, len / 2, y1, -0.05, shade(screenC, 0.7), 0, 0, -1);
      for (let x = -len / 2; x <= len / 2 + 0.01; x += 2.4) g.box(x, y0, 0.05, 0.08, y1 - y0, 0.1, C.iron, 0, false);
      if (i === 0 && len > 8) c.sign(c.look.firmName ?? 'BUILDING', 0, (y0 + y1) / 2 - 0.7, Math.min(len - 2, 9), 1.4, 0.08, null);
    });
  } else if (slabsDone >= 1 && slabsDone < F) {
    // safety netting on the open edges of the first floors
    c.sides(0, 0, pw + 0.6, pd + 0.6, (_s, len) => c.clear.quad(-len / 2, FH, 0, len / 2, FH, 0, len / 2, (slabsDone + 1) * FH, 0, -len / 2, (slabsDone + 1) * FH, 0, hx('#3f8f5a'), 0, 0, 1));
  }
  // a construction hoist on the front face
  if (slabsDone >= 3) {
    const hx_ = pw * 0.28, hz = pd / 2 + 0.9;
    const ht = Math.min(coreTop, slabsDone * FH + 2);
    g.box(hx_, 0, hz, 0.6, ht, 0.6, C.yellow);
    const cy = (hash2(b.seed, Math.floor(prog * 50)) * 0.8 + 0.1) * ht;
    g.box(hx_ + 1.2, cy, hz, 1.6, 2.4, 1.4, hx('#dfe3e6'));
  }
  // tower crane(s): one on the core, a second at a corner for big towers
  if (prog >= 0.04) {
    const craneTop = Math.max(18, coreTop + 14);
    const jib = Math.max(p.pw, p.pd) + 22;
    climbingCrane(c, 0, -1, craneTop, jib, Math.PI * 0.2 + c.r(5) * 1.4, 0);
    if (F >= 35 && prog > 0.12) climbingCrane(c, -pw / 2 + 1.6, pd / 2 - 1.6, Math.max(18, coreTop + 4), jib * 0.75, -Math.PI * 0.6 + c.r(6), 1);
  }
  // hoarding along the street with a gate, materials inside, a mixer truck at the gate
  const hz = c.ld / 2 - 0.5;
  fence(c, -c.lw / 2 + 0.4, hz, -2.8, hz, 'hoarding', hx('#2f4a5a'));
  fence(c, 2.8, hz, c.lw / 2 - 0.4, hz, 'hoarding', hx('#2f4a5a'));
  fence(c, -c.lw / 2 + 0.4, hz, -c.lw / 2 + 0.4, -c.ld / 2 + 0.4, 'hoarding', hx('#2f4a5a'));
  fence(c, c.lw / 2 - 0.4, hz, c.lw / 2 - 0.4, -c.ld / 2 + 0.4, 'hoarding', hx('#2f4a5a'));
  c.t.push(-c.lw / 4 - 1.2, 0, hz + 0.06, 0);
  c.sign(p.name.toUpperCase(), 0, 0.5, Math.min(c.lw / 2 - 3, 6.5), 1.1, 0.0, null);
  c.t.pop();
  c.t.push(c.lw / 4 + 1.2, 0, hz + 0.06, 0);
  c.sign(c.look.firmName ?? 'Coming soon', 0, 0.8, Math.min(c.lw / 2 - 3, 5.5), 0.7, 0.0, null);
  c.t.pop();
  const left = clamp01(delivered - prog * 0.85);
  for (let k = 0; k < 3; k++) pallet(c, -pw / 2 + 1.5 + k * 1.5, pd / 2 - 1.0, 0, k === 1 ? hx('#7d858c') : hx('#c9c4b8'), 0.3 + left * 0.8);
  for (let k = 0; k < Math.max(1, Math.round(left * 5)); k++) g.box(pw / 2 - 1.5, 0.05 + k * 0.22, 0, 0.9, 0.2, 5.0, hx('#7a4a32'));
  if (c.near && prog >= 0.03) {
    for (let i = 0; i < 2; i++) c.props.add('siteLight', c.t, (i ? 1 : -1) * (pw / 2 - 1), 0.05, pd / 2 - 0.5, i ? -0.6 : 0.6);
    for (let i = 0; i < 4; i++) c.props.add('trafficCone', c.t, -1.8 + i * 1.2, 0.05, c.ld / 2 - 1.1, c.r(40 + i));
    c.props.add('skip', c.t, pw / 2 - 2.0, 0.05, -pd / 2 + 1.5, Math.PI / 2, 0.9, 0.9, 0.9, C.yellow);
  }
}

/** A climbing tower crane (luffing for the second): mast from the ground (or core), jib, counter-jib, red lights. */
function climbingCrane(c: Ctx, x: number, z: number, h: number, jib: number, rot: number, k: number): void {
  const g = c.solid;
  const Y = k ? hx('#e05a2e') : C.yellow;
  // mast: four chords and bracing, every 2.4 m
  const s = 1.7, hh = s / 2;
  for (const [dx, dz] of [[-hh, -hh], [hh, -hh], [hh, hh], [-hh, hh]]) g.box(x + dx, 0, z + dz, 0.16, h, 0.16, Y, 0, false);
  for (let y = 0; y < h - 0.5; y += 2.4) {
    g.beam(x - hh, y, z + hh, x + hh, y + 2.4, z + hh, 0.07, Y);
    g.beam(x + hh, y, z - hh, x - hh, y + 2.4, z - hh, 0.07, Y);
    g.beam(x - hh, y, z - hh, x - hh, y + 2.4, z + hh, 0.07, Y);
    g.beam(x + hh, y, z + hh, x + hh, y + 2.4, z - hh, 0.07, Y);
  }
  c.t.push(x, h, z, rot);
  g.box(0, 0, 0, 2.2, 0.6, 2.2, Y);
  g.box(1.1, 0.6, 0.6, 1.4, 1.5, 1.6, Y);
  c.warm.box(1.1, 1.1, 1.41, 1.2, 0.8, 0.02, hx('#7f8e9c'));
  if (k === 0) {
    // a hammerhead jib with a trolley and a hook
    g.box(0, 0.6, jib / 2, 1.2, 0.2, jib, Y, 0, true);
    g.box(0, 1.6, jib / 2 - 1, 0.14, 0.14, jib - 2, Y);
    for (let q = 0; q < jib - 2; q += 2.2) g.beam(0, 0.8, q, 0, 1.6, q + 1.1, 0.07, Y);
    g.box(0, 0.6, -5, 1.2, 0.35, 10, Y);
    g.box(0, 0.0, -8.5, 2.0, 1.8, 2.4, hx('#9d998f'));
    g.box(0, 0.6, 0, 0.6, 5.2, 0.6, Y);
    g.beam(0, 5.8, 0, 0, 1.6, jib * 0.95, 0.06, C.iron);
    g.beam(0, 5.8, 0, 0, 0.9, -9.5, 0.06, C.iron);
    const hz = jib * (0.4 + 0.45 * c.r(77));
    g.box(0, 0.35, hz, 0.9, 0.3, 0.9, C.iron);
    const drop = h * (0.25 + 0.5 * c.r(78));
    g.box(0, 0.35 - drop, hz, 0.03, drop, 0.03, C.iron, 0, false);
    g.box(0, 0.35 - drop - 0.5, hz, 0.5, 0.5, 0.4, C.red);
    if (c.r(79) < 0.6) g.box(0, 0.35 - drop - 1.6, hz, 1.2, 0.9, 3.0, hx('#7a4a32'));
    c.lit(WS.crown, 1.6).box(0, 0.85, jib - 0.3, 0.3, 0.3, 0.3, hx('#ff2a1a'));
    c.lit(WS.crown, 1.6).box(0, 6.0, 0, 0.3, 0.3, 0.3, hx('#ff2a1a'));
  } else {
    // a luffing jib raised at an angle
    const a = 0.75 + c.r(80) * 0.35;
    const tx = 0, ty = 0.8 + Math.sin(a) * jib, tz = Math.cos(a) * jib;
    g.beam(0, 0.8, 0.4, tx, ty, tz, 0.55, Y);
    g.box(0, 0.6, -3, 1.2, 0.5, 6, Y);
    g.box(0, 0.0, -5.2, 1.8, 1.6, 2.0, hx('#9d998f'));
    g.beam(0, 0.6, -0.2, 0, 4.5, -0.6, 0.4, Y);
    g.beam(0, 4.5, -0.6, tx, ty, tz, 0.04, C.iron);
    g.box(tx, ty - h * 0.4, tz, 0.03, h * 0.4, 0.03, C.iron, 0, false);
    c.lit(WS.crown, 1.6).box(tx, ty + 0.2, tz, 0.3, 0.3, 0.3, hx('#ff2a1a'));
  }
  c.t.pop();
}

function excavator(c: Ctx, x: number, z: number, rot: number): void {
  const g = c.solid;
  c.t.push(x, 0, z, rot);
  g.box(0, -1.9, 0, 2.6, 0.7, 3.6, C.dark);
  g.box(0, -1.2, 0.2, 2.4, 1.1, 2.6, C.yellow);
  g.box(-0.6, -0.1, 0.6, 1.0, 1.2, 1.2, C.yellow);
  c.glass.box(-0.6, 0.2, 1.21, 0.8, 0.7, 0.02, hx('#3a4652'));
  g.beam(0.5, -0.6, 1.2, 0.5, 1.6, 3.6, 0.35, C.yellow);
  g.beam(0.5, 1.6, 3.6, 0.5, -1.2, 5.0, 0.3, C.yellow);
  g.box(0.5, -1.9, 5.0, 1.0, 0.8, 0.8, C.iron);
  c.t.pop();
}

// =================================================================== ruin

/** An abandoned tower: dark windows (some broken), the podium boarded up, a fence. */
export function towerRuin(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const p = towerPlan(b);
  lotGround(c, 'paved');
  const fl: Floors = { use: () => 0, suiteOf: new Map() };
  g.box(0, 0, 0, p.pw - 0.1, FH, p.pd - 0.1, shade(p.stone, 0.6));
  // plywood over the podium glass, graffiti dabs
  c.sides(0, 0, p.pw, p.pd, (_s, len) => {
    for (let x = -len / 2 + 0.6; x < len / 2 - 0.6; x += 1.25) {
      const k = hash2(b.seed, 5200 + Math.round(x * 10));
      g.box(x + 0.6, 0.1, 0.05, 1.18, 2.5, 0.04, mix(hx('#c9a878'), hx('#8a7a5a'), k), 0, false);
      if (k < 0.35) g.box(x + 0.6, 0.5 + k * 2, 0.08, 0.8, 0.5, 0.01, [hx('#d9533a'), hx('#3a8ad9'), hx('#3fbf6a'), hx('#e8c040')][Math.floor(k * 11) % 4], 0, false);
    }
  });
  for (const s of p.segs) {
    coreFill(g, s, s.f0 * FH - 0.1, s.f1 * FH, hx('#2a2c30'));
    if (p.res) resShaft(c, p, s, fl, p.floors);
    else officeShaft(c, p, s, fl, p.floors);
  }
  const last = p.segs[p.segs.length - 1];
  const pts = outline(last, last.f1);
  prism(g, pts, p.H, p.H + 1.0, shade(p.frame, 0.7));
  // a few blown-out windows: black holes
  for (let k = 0; k < 14; k++) {
    const f = 1 + Math.floor(hash2(b.seed, 5300 + k) * (p.floors - 1));
    const s = p.segs.find((q) => f >= q.f0 && f < q.f1) ?? last;
    const o = outline(s, f);
    const n = o.length / 2, i = Math.floor(hash2(b.seed, 5400 + k) * n);
    const ax = o[i * 2], az = o[i * 2 + 1], bx = o[((i + 1) % n) * 2], bz = o[((i + 1) % n) * 2 + 1];
    const t = 0.2 + hash2(b.seed, 5500 + k) * 0.6;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2) continue;
    c.t.push(ax + (bx - ax) * t, 0, az + (bz - az) * t, Math.atan2(-(bz - az) / len, (bx - ax) / len));
    g.quad(-0.7, f * FH + 0.8, 0.06, 0.7, f * FH + 0.8, 0.06, 0.7, f * FH + 2.9, 0.06, -0.7, f * FH + 2.9, 0.06, C.black, 0, 0, 1);
    c.t.pop();
  }
  // a chain-link fence around
  fence(c, -c.lw / 2 + 0.5, c.ld / 2 - 0.5, c.lw / 2 - 0.5, c.ld / 2 - 0.5, 'chain');
}

// ================================================================ beacons

/** Aviation obstruction lights of a finished tower (tower-local x, y, z), none for shorter ones. */
export function towerBeacons(b: Building, firmName?: string): number[] {
  const p = towerPlan(b, firmName);
  const top = p.H + p.crownH;
  if (top < 45) return [];
  const last = p.segs[p.segs.length - 1];
  const [x0, z0, x1, z1] = bounds(outline(last, last.f1));
  const out: number[] = [];
  const y = p.crown === 'slope' ? p.H + 0.8 : top + 0.3;
  for (const [x, z] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x1 - 0.4, z1 - 0.4], [x0 + 0.4, z1 - 0.4]]) out.push(x, p.crown === 'slope' ? p.H + 0.8 + p.crownH * clamp01((z1 - z) / (z1 - z0)) : y, z);
  if (p.spire > 0) out.push(0, top + p.spire + 2.6, 0);
  if (top > 150) for (const [x, z] of [[x0, z0], [x1, z1]]) out.push(x, top * 0.5, z);
  return out;
}
