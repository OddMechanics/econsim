// Modern mid-rise buildings: apartment blocks (3-10 floors: wrap-around
// balconies, brick with recessed loggias, render with ribbon windows,
// fibre-cement panels with colored accents, an exposed concrete frame),
// company offices (glass curtain walls, fins, bands, a frame) and banks
// (stone and glass, a portal with the name in metal letters). They share the
// facade machinery of the towers (facades.ts, towers.ts).

import { Color3 } from '@babylonjs/core';
import { BUILDINGS } from '../sim/goods';
import { FLOOR_H } from '../sim/layout';
import { hash2 } from '../sim/rng';
import { C, GLOW_BULB, P, WS, hx, mix, shade, type WinState } from './buildingGeo';
import { Ctx, GLASS_RES, GLASS_SHOP, bench, car, lamp, lotGround, parking, planter, tree } from './buildingCtx';
import { band, eachEdge, fin, flatPoly, outline, paneRow, parapet, type Seg } from './facades';
import { roofClutter, streetBits } from './propsExterior';
import { FRAMES, GLASS_FAMILIES, STONES, flatUse, officeShaft, pickW, resShaft, type Floors, type TowerPlan } from './towers';

const FH = FLOOR_H;

/** A rectangular plate segment. */
function rectSeg(f0: number, f1: number, w: number, d: number, cz = 0, balc = 0, corner: Seg['corner'] = 'sq', cr = 0): Seg {
  return { f0, f1, w0: w, d0: d, w1: w, d1: d, cx: 0, cz, corner, cr, twist: 0, balc };
}

/** A minimal tower plan for the shared shaft functions. */
function plan(over: Partial<TowerPlan> & Pick<TowerPlan, 'style' | 'floors'>): TowerPlan {
  return {
    res: true, H: over.floors * FH, pw: 0, pd: 0, segs: [], bay: 1.6, crown: 'flat', crownH: 0, spire: 0,
    tint: hx('#4f7896'), frame: hx('#3a3d42'), span: hx('#2f3a44'), stone: hx('#8c8a85'), slab: C.white, panel: hx('#d9dcdc'),
    rail: hx('#9fc2d2'), light: C.white, name: '', num: 1, glow: 'none', ...over,
  };
}

// ============================================================ apartments

export type AptStyle = 'balcony' | 'loggia' | 'ribbon' | 'panel' | 'frame';
const BRICKS = ['#8a3f30', '#a85a3e', '#6a4a3c', '#c9b58a', '#e8e2d4', '#4a4a4c', '#9c6a52'];
const RENDERS = ['#f2f0ea', '#e8e2d4', '#d9dcdc', '#efe6d2', '#e6ded4', '#dfe4e2'];
const CLAD = ['#d9dcdc', '#b9bec2', '#5a5f66', '#3a3d42', '#c8c1b4', '#8e9aa0', '#e8e4dc'];
const ACCENTS = ['#e8b631', '#d9533a', '#3f8f8a', '#7aa84e', '#5a7fb5', '#c86a8a', '#e07b2e', '#b98a5e'];

/**
 * A modern mid-rise apartment block: a 15 x 15 m plate (the flats in a ring around the core), one of
 * five facade systems, an entrance with a canopy, a flat roof with a stair house and solar panels.
 */
/** Facade system and wall color of an apartment block (shared with its far model). */
export function aptLook(seed: number): { style: AptStyle; wall: Color3 } {
  const r = (k: number) => hash2(seed, 800 + k);
  const style = pickW<AptStyle>(['balcony', 'loggia', 'ribbon', 'panel', 'frame'], [26, 22, 18, 20, 14], r(1));
  const wall = hx(style === 'loggia' ? BRICKS[Math.floor(r(2) * BRICKS.length)] : style === 'ribbon' ? RENDERS[Math.floor(r(2) * RENDERS.length)]
    : style === 'panel' ? CLAD[Math.floor(r(2) * CLAD.length)] : style === 'frame' ? ['#e8e4dc', '#cfcac0', '#f2f0ea', '#b9b4aa'][Math.floor(r(2) * 4)] : RENDERS[Math.floor(r(2) * RENDERS.length)]);
  return { style, wall };
}

export function apartments(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const F = Math.max(1, b.floors), H = F * FH;
  const r = (k: number) => c.r(800 + k);
  const { style, wall: wallC } = aptLook(b.seed);
  const W = b.w - 2.0, D = b.d - 2.6, cz = -0.3;
  const front = cz + D / 2;
  const accent = hx(ACCENTS[Math.floor(r(3) * ACCENTS.length)]);
  const frame = hx(['#2a2c30', '#3a3d42', '#f2f0ea', '#7d8287', '#4a3f35'][Math.floor(r(4) * 5)]);
  const baseC = style === 'loggia' ? shade(wallC, 0.75) : mix(wallC, hx('#4a4c50'), 0.55);
  const glassC = mix(GLASS_RES, hx('#4f7896'), 0.15);
  const per = BUILDINGS.apartments.unitsPerFloor;
  const use = flatUse(c, per, 0);
  c.body = { cx: 0, cz, w: W, d: D, storey: FH, floors: F, floor: C.floorWood, base: 0.15 };
  lotGround(c, 'paved');
  const seg = rectSeg(0, F, W, D, cz, style === 'balcony' ? 1.25 : 0);
  const pts = outline(seg, 0);
  // the inner volume (shadows; set back where loggias and frames cut in)
  const inset = style === 'loggia' || style === 'frame' ? 1.4 : 0.35;
  c.wall.box(0, 0, cz, W - inset * 2, H, D - inset * 2, shade(wallC, 0.6));
  if (style === 'balcony') {
    // flats behind glass with wrap-around balconies (the towers' facade, low-rise)
    const p = plan({ style: 'balcony', floors: F, slab: hx(['#f2f0ea', '#e2e2de', '#3a3d42', '#c9c8c2'][Math.floor(r(5) * 4)]), panel: c.r(806) < 0.5 ? accent : wallC, frame, rail: hx('#a9c4d0'), tint: hx('#4f7896') });
    const fl: Floors = { use, suiteOf: new Map() };
    resShaft(c, p, rectSeg(1, F, W, D, cz, 1.25), fl, F);
  } else {
    for (let f = 1; f < F; f++) aptFloor(c, style, pts, f, wallC, accent, frame, glassC, use);
  }
  // the ground floor: a darker plinth, windows, the entrance in the middle of the front
  groundFloor(c, pts, style, baseC, frame, glassC, use, W);
  // roof: parapet, membrane, a stair house, solar panels or a roof terrace
  const roofC = hx('#8d8f92');
  parapet(g, pts, H, style === 'balcony' ? 0.5 : 0.8, style === 'frame' || style === 'balcony' ? shade(wallC, 1.02) : wallC, roofC);
  if (style === 'balcony') {
    // the top floor's balcony ring becomes a roof over the last balconies
    flatPoly(g, pts, H + 0.02, roofC);
  }
  const sx = W * 0.18, sz = cz - D * 0.16;
  g.box(sx, H, sz, 3.0, 2.8, 3.4, shade(wallC, 0.92));
  g.box(sx, H + 2.8, sz, 3.2, 0.15, 3.6, shade(wallC, 0.8));
  g.box(sx, H, sz + 1.71, 0.9, 2.1, 0.04, frame, 0, false);
  if (r(7) < 0.55) {
    // solar panels in rows facing the front
    for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) {
      const x = -W / 2 + 2.2 + k * 2.4, z = cz + D / 2 - 2.4 - j * 2.2;
      c.glass.slab([x - 1.0, H + 0.35, z + 0.6, x + 1.0, H + 0.35, z + 0.6, x + 1.0, H + 0.95, z - 0.5, x - 1.0, H + 0.95, z - 0.5], 0.04, hx('#2a3f66'), 0, 1, 0.4, C.steel);
    }
  } else if (r(8) < 0.6) {
    // a roof terrace with planters and a glass railing
    g.box(-W * 0.2, H + 0.08, cz + D * 0.15, W * 0.45, 0.06, D * 0.45, hx('#a88a66'), 0, false);
    for (let k = 0; k < 3; k++) planter(c, -W / 2 + 1.4 + k * 2.2, cz + D / 2 - 1.2, 1.2, 0.8, k === 1, 90 + k);
  }
  if (c.near && !c.cut) roofClutter(c, 0, cz, W, D, H + 0.08, [[sx, sz, 1.8, 2.0], [-W * 0.2, cz + D * 0.15, W * 0.25, D * 0.25]], 1, { ac: 2, vents: 3, antenna: r(9) < 0.4 });
  // the yard: a path, planters and shrubs, trees at the sides, parking or a garden behind
  const fy = c.ld / 2 - front;
  g.box(0, 0.05, front + fy / 2, 2.2, 0.02, fy, hx('#c8c1b4'), 0, false);
  if (fy > 2.2) {
    planter(c, -2.6, front + Math.min(fy - 1, 1.4), 1.8, 0.9, false, 1);
    planter(c, 2.6, front + Math.min(fy - 1, 1.4), 1.8, 0.9, false, 2);
    for (const sx2 of [-1, 1]) for (let k = 0; k < 3; k++) c.solid.blob(sx2 * (W / 2 - 0.8 - k * 1.1), 0.35, front + 0.9, 0.5, 0.4, 0.45, k % 2 ? C.leaf : C.leafDark, 6, 3);
  }
  if (fy > 4.5 && r(10) < 0.6) bench(c, W / 2 - 2.2, c.ld / 2 - 1.2, 0, 1.6);
  const side = (c.lw - W) / 2;
  if (side > 2.2) { tree(c, -W / 2 - side / 2, front - 1.2, 0.85, 3); tree(c, W / 2 + side / 2, cz - D / 3, 0.85, 4); }
  const by = c.ld / 2 + cz - D / 2;
  if (by > 5.5) parking(c, 0, cz - D / 2 - by / 2, Math.floor((c.lw - 2) / 2.6), Math.PI, 0.55);
  else if (by > 2.5) for (let k = 0; k < 4; k++) c.solid.blob(-W / 2 + 1.5 + k * 3.6, 0.4, cz - D / 2 - by / 2, 0.8, 0.5, 0.6, C.leaf, 6, 3);
  if (c.near) {
    streetBits(c, W / 2 - 3.0, front + 1.3, 0, 1, ['bikes']);
    streetBits(c, -W / 2 + 0.6, cz - D / 2 - 0.8, Math.PI, 2, ['bins']);
  }
}

/** One upper floor of an apartment block in one of the walled facade systems. */
function aptFloor(c: Ctx, style: AptStyle, pts: number[], f: number, wallC: Color3, accent: Color3, frame: Color3, glassC: Color3, use: (f: number, a: number) => number): void {
  if (c.cut) return;
  const g = c.solid;
  const y0 = f * FH;
  eachEdge(c, pts, (len, i, ax, az, dx, dz) => {
    const longSide = i % 2 === 0;
    const n = Math.max(2, Math.round(len / 1.7));
    const bw = len / n;
    const ang = (k: number) => { const u = (k + 0.5) * bw; return Math.atan2(az + dz * u, ax + dx * u); };
    if (style === 'ribbon') {
      // a solid band, then a continuous ribbon of glass with slim mullions
      band(g, -len / 2 - 0.04, len / 2 + 0.04, y0 - 0.05, y0 + 1.0, 0.06, wallC);
      const states: WinState[] = [];
      for (let k = 0; k < n; k++) states.push(c.paneState('res', c.nextPane(), use(f, ang(k))));
      paneRow(c, -len / 2, len / 2, n, y0 + 1.0, y0 + FH - 0.05, 0, states, () => glassC);
      for (let k = 1; k < n; k++) g.quad(-len / 2 + k * bw - 0.03, y0 + 1.0, 0.02, -len / 2 + k * bw + 0.03, y0 + 1.0, 0.02, -len / 2 + k * bw + 0.03, y0 + FH - 0.05, 0.02, -len / 2 + k * bw - 0.03, y0 + FH - 0.05, 0.02, frame, 0, 0, 1);
      g.quad(-len / 2, y0 + FH - 0.08, 0.03, len / 2, y0 + FH - 0.08, 0.03, len / 2, y0 + FH, 0.03, -len / 2, y0 + FH, 0.03, shade(wallC, 0.85), 0, 0, 1);
      return;
    }
    if (style === 'frame') {
      // glass set back behind a concrete grid; every other bay a balcony in the frame
      const states: WinState[] = [];
      for (let k = 0; k < n; k++) states.push(c.paneState('res', c.nextPane(), use(f, ang(k))));
      paneRow(c, -len / 2, len / 2, n, y0 + 0.1, y0 + FH, -1.3, states, () => glassC);
      band(g, -len / 2, len / 2, y0 - 0.15, y0 + 0.3, 0.05, wallC);
      g.quad(-len / 2, y0 + 0.3, -1.3, len / 2, y0 + 0.3, -1.3, len / 2, y0 + 0.3, 0.05, -len / 2, y0 + 0.3, 0.05, shade(wallC, 0.95), 0, 1, 0);
      g.quad(-len / 2, y0 + FH - 0.15, 0.05, len / 2, y0 + FH - 0.15, 0.05, len / 2, y0 + FH - 0.15, -1.3, -len / 2, y0 + FH - 0.15, -1.3, shade(wallC, 0.75), 0, -1, 0);
      for (let k = 0; k < n; k += 2) {
        if (hash2(c.b.seed, 870 + f * 13 + i * 5 + k) < 0.5) continue;
        c.clear.quad(-len / 2 + k * bw, y0 + 0.3, 0.02, -len / 2 + (k + 2) * bw, y0 + 0.3, 0.02, -len / 2 + (k + 2) * bw, y0 + 1.25, 0.02, -len / 2 + k * bw, y0 + 1.25, 0.02, hx('#a9c4d0'), 0, 0, 1);
        g.box(-len / 2 + (k + 1) * bw, y0 + 1.22, 0.02, 2 * bw, 0.05, 0.06, frame, 0, false);
      }
      return;
    }
    // walled facades: brick with loggias, or cladding with windows of varying widths and accent panels
    const loggiaAt = (k: number) => style === 'loggia' && longSide && (k % 3 === 1) && n > 4;
    for (let k = 0; k < n; k++) {
      const x0 = -len / 2 + k * bw, x1 = x0 + bw;
      const h = hash2(c.b.seed, 880 + f * 17 + i * 7 + k);
      if (loggiaAt(k)) {
        // a recessed loggia: dark reveals, the door and window at the back, a railing at the face
        const dep = 1.25;
        g.quad(x0, y0, 0, x0, y0, -dep, x0, y0 + FH, -dep, x0, y0 + FH, 0, shade(wallC, 0.7), 1, 0, 0);
        g.quad(x1, y0, -dep, x1, y0, 0, x1, y0 + FH, 0, x1, y0 + FH, -dep, shade(wallC, 0.7), -1, 0, 0);
        g.quad(x0, y0 + FH - 0.05, 0, x1, y0 + FH - 0.05, 0, x1, y0 + FH - 0.05, -dep, x0, y0 + FH - 0.05, -dep, shade(wallC, 0.6), 0, -1, 0);
        g.quad(x0, y0 + 0.02, -dep, x1, y0 + 0.02, -dep, x1, y0 + 0.02, 0, x0, y0 + 0.02, 0, hx('#8a8580'), 0, 1, 0);
        c.lit(c.paneState('res', c.nextPane(), use(f, (ang(k))))).quad(x0 + 0.1, y0 + 0.1, -dep, x1 - 0.1, y0 + 0.1, -dep, x1 - 0.1, y0 + FH - 0.25, -dep, x0 + 0.1, y0 + FH - 0.25, -dep, glassC, 0, 0, 1);
        g.box((x0 + x1) / 2, y0 + 0.02, -0.02, bw, 1.1, 0.04, shade(wallC, 0.85), 0, false);
        if (c.near && f < 8 && h < 0.5) c.props.add(h < 0.25 ? 'plantBush' : 'chairBistro', c.t, (x0 + x1) / 2 + 0.3, y0 + 0.05, -0.7, h * 9, 0.8, 0.8, 0.8, accent);
        continue;
      }
      const winW = style === 'panel' ? Math.min(bw - 0.3, 0.9 + hash2(c.b.seed, 890 + i * 7 + k + (f % 2) * 3) * 0.9) : Math.min(bw - 0.45, 1.25);
      const sill = style === 'panel' && h < 0.4 ? 0.1 : 0.55;
      const top = FH - 0.35;
      const wx = (x0 + x1) / 2 + (style === 'panel' ? (h - 0.5) * (bw - winW - 0.2) : 0);
      // the wall around the window
      const wc = style === 'panel' && h > 0.82 ? accent : wallC;
      g.quad(x0, y0, 0, wx - winW / 2, y0, 0, wx - winW / 2, y0 + FH, 0, x0, y0 + FH, 0, wc, 0, 0, 1);
      g.quad(wx + winW / 2, y0, 0, x1, y0, 0, x1, y0 + FH, 0, wx + winW / 2, y0 + FH, 0, wallC, 0, 0, 1);
      g.quad(wx - winW / 2, y0, 0, wx + winW / 2, y0, 0, wx + winW / 2, y0 + sill, 0, wx - winW / 2, y0 + sill, 0, wallC, 0, 0, 1);
      g.quad(wx - winW / 2, y0 + top, 0, wx + winW / 2, y0 + top, 0, wx + winW / 2, y0 + FH, 0, wx - winW / 2, y0 + FH, 0, wallC, 0, 0, 1);
      // the window, set back in its reveal, with a frame and a sill
      const z = -0.14;
      c.lit(c.paneState('res', c.nextPane(), use(f, ang(k)))).quad(wx - winW / 2, y0 + sill, z, wx + winW / 2, y0 + sill, z, wx + winW / 2, y0 + top, z, wx - winW / 2, y0 + top, z, glassC, 0, 0, 1);
      g.quad(wx - winW / 2, y0 + sill, 0, wx - winW / 2, y0 + sill, z, wx - winW / 2, y0 + top, z, wx - winW / 2, y0 + top, 0, shade(wallC, 0.78), 1, 0, 0);
      g.quad(wx + winW / 2, y0 + sill, z, wx + winW / 2, y0 + sill, 0, wx + winW / 2, y0 + top, 0, wx + winW / 2, y0 + top, z, shade(wallC, 0.78), -1, 0, 0);
      g.quad(wx - winW / 2, y0 + top, 0, wx + winW / 2, y0 + top, 0, wx + winW / 2, y0 + top, z, wx - winW / 2, y0 + top, z, shade(wallC, 0.6), 0, -1, 0);
      g.box(wx, y0 + sill - 0.06, 0.0, winW + 0.1, 0.06, 0.12, style === 'loggia' ? hx('#d8d2c4') : frame, 0, false);
      g.quad(wx - 0.02, y0 + sill, z + 0.01, wx + 0.02, y0 + sill, z + 0.01, wx + 0.02, y0 + top, z + 0.01, wx - 0.02, y0 + top, z + 0.01, frame, 0, 0, 1);
      if (style === 'panel' && longSide && f % 2 === 1 && h < 0.3 && winW > 1.2) {
        // a small projecting balcony in front of a tall window
        g.box(wx, y0 - 0.05, 0.55, winW + 0.8, 0.2, 1.1, shade(wallC, 1.05));
        c.clear.quad(wx - winW / 2 - 0.4, y0 + 0.15, 1.1, wx + winW / 2 + 0.4, y0 + 0.15, 1.1, wx + winW / 2 + 0.4, y0 + 1.1, 1.1, wx - winW / 2 - 0.4, y0 + 1.1, 1.1, hx('#a9c4d0'), 0, 0, 1);
        g.box(wx, y0 + 1.08, 1.08, winW + 0.8, 0.05, 0.05, frame, 0, false);
      }
    }
    // a floor line
    if (style === 'loggia' && f % 2 === 0) band(g, -len / 2, len / 2, y0 - 0.06, y0 + 0.06, 0.04, shade(wallC, 0.82));
  });
}

/** The ground floor of an apartment block: a plinth, windows, the entrance with a canopy, mailboxes, a lamp. */
function groundFloor(c: Ctx, pts: number[], style: AptStyle, baseC: Color3, frame: Color3, glassC: Color3, use: (f: number, a: number) => number, W: number): void {
  if (c.cut) return;
  const g = c.solid;
  eachEdge(c, pts, (len, i, ax, az, dx, dz) => {
    const n = Math.max(2, Math.round(len / 1.7));
    const bw = len / n;
    for (let k = 0; k < n; k++) {
      const x0 = -len / 2 + k * bw, x1 = x0 + bw, xc = (x0 + x1) / 2;
      if (i === 0 && Math.abs(xc) < 1.6) continue; // the entrance
      const u = (k + 0.5) * bw;
      const st = c.paneState('res', c.nextPane(), use(0, Math.atan2(az + dz * u, ax + dx * u)));
      const ww = Math.min(bw - 0.4, 1.3);
      g.quad(x0, 0, 0, xc - ww / 2, 0, 0, xc - ww / 2, FH, 0, x0, FH, 0, baseC, 0, 0, 1);
      g.quad(xc + ww / 2, 0, 0, x1, 0, 0, x1, FH, 0, xc + ww / 2, FH, 0, baseC, 0, 0, 1);
      g.quad(xc - ww / 2, 0, 0, xc + ww / 2, 0, 0, xc + ww / 2, 0.8, 0, xc - ww / 2, 0.8, 0, baseC, 0, 0, 1);
      g.quad(xc - ww / 2, FH - 0.35, 0, xc + ww / 2, FH - 0.35, 0, xc + ww / 2, FH, 0, xc - ww / 2, FH, 0, baseC, 0, 0, 1);
      c.lit(st).quad(xc - ww / 2, 0.8, -0.1, xc + ww / 2, 0.8, -0.1, xc + ww / 2, FH - 0.35, -0.1, xc - ww / 2, FH - 0.35, -0.1, glassC, 0, 0, 1);
      g.box(xc, 0.74, 0, ww + 0.1, 0.06, 0.1, frame, 0, false);
    }
    if (i !== 0) return;
    // the entrance: a recessed glass door, a canopy, the house number, mailboxes, lights
    g.quad(-1.6, 0, -0.9, 1.6, 0, -0.9, 1.6, 0.0, 0, -1.6, 0.0, 0, hx('#bdb8ae'), 0, 1, 0);
    for (const ex of [-1.6, 1.6]) g.quad(ex, 0, -0.9, ex, 0, 0, ex, FH, 0, ex, FH, -0.9, shade(baseC, 0.9), ex < 0 ? 1 : -1, 0, 0);
    g.quad(-1.6, FH - 0.2, 0, 1.6, FH - 0.2, 0, 1.6, FH - 0.2, -0.9, -1.6, FH - 0.2, -0.9, shade(baseC, 0.7), 0, -1, 0);
    c.lit(WS.lobby).quad(-1.55, 0.05, -0.9, 1.55, 0.05, -0.9, 1.55, FH - 0.25, -0.9, -1.55, FH - 0.25, -0.9, GLASS_SHOP, 0, 0, 1);
    for (const x of [-1.55, 0, 1.55]) g.box(x, 0.05, -0.88, 0.07, FH - 0.3, 0.06, frame, 0, false);
    g.box(0, 2.25, -0.86, 3.1, 0.07, 0.06, frame, 0, false);
    g.box(0, FH - 0.2, 0.75, 4.2, 0.18, 1.6, style === 'frame' ? shade(baseC, 1.4) : frame, 0, true);
    for (const sx of [-1.2, 1.2]) c.warm.box(sx, FH - 0.24, 0.9, 0.2, 0.04, 0.2, GLOW_BULB);
    c.sign(String(10 + Math.floor(hash2(c.b.seed, 99) * 180)), 2.2, 2.2, 0.45, 0.32, 0.02, null, 'metal');
    if (c.near) {
      c.props.add('mailboxBank', c.t, -2.3, 0.75, 0.1, 0, 0.7, 1, 1, c.pick([hx('#8d949a'), hx('#5a6b4a'), hx('#3a3d42')], 98));
      c.props.add('intercom', c.t, 1.75, 1.15, 0.02, 0);
    }
    void W;
  });
}

// ================================================================ offices

/** Facade system and colors of a company office (shared with its far model). */
export function officeLook(seed: number): { style: 'grid' | 'flush' | 'fins' | 'bands' | 'frame'; tint: Color3; frame: Color3; stone: Color3; panel: Color3 } {
  const r = (k: number) => hash2(seed, 860 + k);
  const style = pickW(['grid', 'flush', 'fins', 'bands', 'frame'] as const, [24, 22, 20, 18, 16], r(1));
  const fam = pickW(GLASS_FAMILIES.map((x) => x[0]), GLASS_FAMILIES.map((x) => x[1]), r(2));
  return {
    style, tint: hx(fam[Math.floor(r(3) * fam.length) % fam.length]), frame: hx(FRAMES[Math.floor(r(4) * FRAMES.length)]),
    stone: hx(STONES[Math.floor(r(5) * STONES.length)]), panel: hx(['#e8e4dc', '#d9dcdc', '#b9b4aa', '#f2f0ea', '#8e9aa0'][Math.floor(r(6) * 5)]),
  };
}

/**
 * A company office (2-12 floors): a lobby behind stone piers on the street, a glass curtain wall (or
 * fins, bands, an exposed frame) above, a crown with the company's name, flag poles and planters.
 */
export function officeBlock(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const F = Math.max(1, b.floors), H = F * FH;
  const { style, tint, frame, stone, panel } = officeLook(b.seed);
  const W = b.w - 0.8, D = b.d - 0.8;
  const occupied = !!c.look.firmName;
  c.body = { cx: 0, cz: 0, w: W, d: D, storey: FH, floors: F, floor: C.carpet };
  c.officeTint = tint;
  lotGround(c, 'paved');
  const p = plan({ res: false, style, floors: F, tint, frame, span: style === 'bands' ? panel : mix(tint, C.black, 0.42), panel, bay: style === 'bands' ? 1.8 : 1.5, crown: 'flat' });
  const seg = rectSeg(1, F, W, D);
  const fl: Floors = { use: () => (occupied ? c.litOff : 0.04), suiteOf: new Map() };
  c.wall.box(0, 0, 0, W - 1.0, H, D - 1.0, hx('#3a3f45'));
  if (F > 1) officeShaft(c, p, seg, fl, F);
  // the lobby floor: stone piers, glass, a canopy over the door
  const pts = outline(rectSeg(0, 1, W, D), 0);
  if (!c.cut) eachEdge(c, pts, (len, i) => {
    const n = Math.max(2, Math.round(len / 2.6));
    const bw = len / n;
    for (let k = 0; k < n; k++) {
      const x0 = -len / 2 + k * bw;
      if (i === 0 && Math.abs(x0 + bw / 2) < 1.4) continue;
      c.lit(i === 0 ? WS.lobby : c.paneState('off', c.nextPane(), occupied ? 0.9 : 0.05)).quad(x0 + 0.25, 0.1, -0.3, x0 + bw - 0.25, 0.1, -0.3, x0 + bw - 0.25, FH - 0.35, -0.3, x0 + 0.25, FH - 0.35, -0.3, i === 0 ? GLASS_SHOP : shade(tint, 0.6), 0, 0, 1);
    }
    for (let k = 0; k <= n; k++) fin(g, -len / 2 + k * bw, 0, FH, 0.5, 0.05, stone, -0.3);
    band(g, -len / 2, len / 2, FH - 0.35, FH, 0.05, stone, -0.3);
    if (i !== 0) return;
    c.door(0, 2.2, 2.6, C.dark, frame, 0, true);
    g.box(0, 2.95, 1.2, 4.8, 0.2, 2.6, frame, 0, true);
    c.warm.box(0, 2.9, 1.2, 4.0, 0.04, 2.0, GLOW_BULB);
    if (F < 4) c.sign(c.look.firmName, 0, 3.18, Math.min(len - 2, 6.5), 0.6, 2.45, null);
  });
  // crown: parapet, a mechanical box, the name on the front for taller offices
  parapet(g, outline(seg, F), H, 1.0, shade(frame, 0.95), hx('#7d7f82'));
  g.box(-W * 0.15, H, -D * 0.1, W * 0.38, 2.6, D * 0.4, shade(stone, 1.05));
  if (F >= 4) {
    c.t.push(0, 0, D / 2 + 0.05, 0);
    c.sign(c.look.firmName, 0, H + 0.1, Math.min(W - 2, 9), 0.8, 0.02, null);
    c.t.pop();
  }
  if (F >= 6) {
    eachEdge(c, outline(seg, F), (len) => c.lit(WS.crown, 1.6).box(0, H + 0.75, 0.03, len, 0.2, 0.04, hx('#cfe6ff'), 0, false));
    g.cyl(-W * 0.15, H + 2.6, -D * 0.1, 0.12, 0.05, 4 + F * 0.4, 5, C.steel);
    c.lit(WS.blink).box(-W * 0.15, H + 6.6 + F * 0.4, -D * 0.1, 0.25, 0.25, 0.25, hx('#ff2a1a'));
  }
  officeYard(c, W, D, F);
}

function officeYard(c: Ctx, W: number, D: number, F: number): void {
  const g = c.solid;
  const front = D / 2, fy = c.ld / 2 - front;
  if (fy > 3) {
    planter(c, -W / 2 + 1.4, front + Math.min(2.0, fy - 1), 1.8, 1.0, true, 1);
    planter(c, W / 2 - 1.4, front + Math.min(2.0, fy - 1), 1.8, 1.0, true, 2);
  }
  if (fy > 4 && c.r(869) < 0.6) {
    for (let k = 0; k < 3; k++) {
      const fx = -1.5 + k * 1.5;
      g.cyl(fx, 0.05, c.ld / 2 - 1.6, 0.05, 0.04, 6.5, 5, C.steel);
      g.box(fx + 0.55, 5.5, c.ld / 2 - 1.6, 1.1, 0.7, 0.03, k === 1 ? c.brand : [C.red, C.white, hx('#2e86c1')][Math.floor(c.r(870 + k) * 3)], 0, false);
    }
  }
  const by = c.ld / 2 - D / 2;
  if (by > 5.5) parking(c, 0, -D / 2 - by / 2, Math.floor((c.lw - 2) / 2.6), Math.PI, 0.7);
  if (c.near) {
    if (!c.cut) roofClutter(c, 0, 0, W, D, F * FH + 0.1, [[-W * 0.15, -D * 0.1, W * 0.2, D * 0.21]], 2, { vents: 3, ac: 2, skylights: 1 });
    if (fy > 3) streetBits(c, W / 2 - 3.6, c.ld / 2 - 1.0, 0, 3, ['bollards']);
    streetBits(c, -W / 2 + 0.4, D / 2 + 1.2, 0, 4, ['bikes', 'litter']);
  }
  lamp(c, W / 2 + 0.6, c.ld / 2 - 0.8, 4.4, Math.PI);
}

/**
 * A bank: stone and glass. One floor: a glass pavilion under a deep stone frame. Taller: a stone-clad
 * block with tall windows and a two-story glass portal with the name in metal letters.
 */
export function bankBlock(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const F = Math.max(1, b.floors), H = F * FH;
  const r = (k: number) => c.r(880 + k);
  const stone = hx(['#d8cfbd', '#e6e2d8', '#a7a39b', '#4a4c50', '#d9c9ab'][Math.floor(r(1) * 5)]);
  const stoneD = shade(stone, 0.82);
  const tint = hx(['#3f5a6a', '#2f3a44', '#4f6b7a', '#5d4c3e'][Math.floor(r(2) * 4)]);
  const frame = hx(['#26292d', '#b9bec2', '#4a3f35'][Math.floor(r(3) * 3)]);
  const W = b.w - 0.8, D = b.d - 0.8;
  c.body = { cx: 0, cz: 0, w: W, d: D, storey: FH, floors: F, floor: hx('#d8d0c0') };
  c.officeTint = tint;
  lotGround(c, 'paved');
  const occupied = !!c.look.firmName;
  c.wall.box(0, 0, 0, W - 0.6, H, D - 0.6, stoneD);
  const pts = outline(rectSeg(0, F, W, D), 0);
  // stone piers and floor bands, tall windows between them
  if (!c.cut) eachEdge(c, pts, (len, i) => {
    const n = Math.max(3, Math.round(len / 2.2));
    const bw = len / n;
    for (let f = 0; f < F; f++) {
      const y0 = f * FH;
      for (let k = 0; k < n; k++) {
        const x0 = -len / 2 + k * bw, xc = x0 + bw / 2;
        if (i === 0 && f < Math.min(2, F) && Math.abs(xc) < 2.4) continue; // the portal
        const st = f === 0 && i === 0 ? WS.lobby : c.paneState('off', c.nextPane(), occupied ? 0.9 : 0.05);
        c.lit(st).quad(x0 + 0.3, y0 + 0.25, -0.25, x0 + bw - 0.3, y0 + 0.25, -0.25, x0 + bw - 0.3, y0 + FH - 0.3, -0.25, x0 + 0.3, y0 + FH - 0.3, -0.25, shade(tint, 0.7), 0, 0, 1);
      }
      band(g, -len / 2, len / 2, y0 + FH - 0.3, y0 + FH + 0.0, 0.0, stone, 0);
      band(g, -len / 2, len / 2, y0, y0 + 0.25, 0.0, stone, 0);
    }
    for (let k = 0; k <= n; k++) {
      const x = -len / 2 + k * bw;
      if (i === 0 && Math.abs(x) < 2.3) continue;
      fin(g, x, 0, H, 0.6, 0.0, stone, 0);
      g.quad(x - 0.3, 0, 0, x - 0.3, 0, -0.25, x - 0.3, H, -0.25, x - 0.3, H, 0, stoneD, -1, 0, 0);
      g.quad(x + 0.3, 0, -0.25, x + 0.3, 0, 0, x + 0.3, H, 0, x + 0.3, H, -0.25, stoneD, 1, 0, 0);
    }
    if (i !== 0) return;
    // the portal: a deep stone frame around a tall glass entrance, the name above
    const ph = Math.min(2, F) * FH - 0.3;
    c.lit(WS.lobby).quad(-2.2, 0.05, -0.6, 2.2, 0.05, -0.6, 2.2, ph, -0.6, -2.2, ph, -0.6, GLASS_SHOP, 0, 0, 1);
    for (const x of [-1.1, 0, 1.1]) g.box(x, 0.05, -0.58, 0.06, ph, 0.06, frame, 0, false);
    for (const ex of [-2.3, 2.3]) { g.box(ex, 0, 0, 0.6, ph + 0.4, 1.2, stone); }
    g.box(0, ph, 0, 5.2, 0.6, 1.2, stone);
    c.door(0, 2.0, 2.5, C.dark, frame, 0, true);
    c.t.push(0, 0, 0.62, 0);
    c.sign(c.look.firmName, 0, ph + 0.1, 4.2, 0.4, 0, null, 'metal');
    c.t.pop();
    g.box(3.4, 0.9, 0.06, 0.75, 1.1, 0.1, hx('#5d6670'));
    c.screen.box(3.4, 1.5, 0.12, 0.34, 0.24, 0.02, hx('#9fd0ff'));
    c.warm.box(3.4, 2.15, 0.14, 0.75, 0.1, 0.06, c.brand);
  });
  // a cornice and the roof
  parapet(g, pts, H, 0.9, stone, hx('#7d7f82'));
  g.box(0, H - 0.25, 0, W + 0.4, 0.25, D + 0.4, stone);
  if (F >= 3) {
    c.t.push(0, 0, D / 2 + 0.25, 0);
    c.sign(c.look.firmName, 0, H + 0.05, Math.min(W - 3, 8), 0.75, 0.02, null);
    c.t.pop();
  }
  officeYard(c, W, D, F);
  if (c.near) c.props.add('atm', c.t, W / 2 - 0.9, 0, D / 2 + 0.35, 0);
  void car; void P;
}
