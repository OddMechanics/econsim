// Modern industry: insulated metal-clad halls on a concrete plinth with
// ribbon windows, sectional doors, truck docks and a glazed office annex
// (modernHall), and every industrial kind built from it with its own plant:
// a sawmill with a log deck and a dust cyclone, a brickworks with a tunnel
// kiln, a cement and concrete plant with silos, a batching tower and mixer
// trucks, a glassworks with a float line and glass racks, an electric-arc
// steel mill, food, tool, furniture, clothing, electronics and car plants, a
// logistics depot, a clay pit, a logging yard and an outdoor advertising
// company with its billboard yard.

import { Color3 } from '@babylonjs/core';
import { FLOOR_H, stationsOf } from '../sim/layout';
import { hash2 } from '../sim/rng';
import { C, GLOW_BULB, GLOW_ORANGE, P, hx, lerp, mix, shade } from './buildingGeo';
import {
  Ctx, barrelRoof, car, crate, fence, flatRoof, lamp, logPile, lotFence, lotGround, pallet, pile, plankStack, sawRoof, stack, tree, truck,
} from './buildingCtx';
import { hallExtras, streetBits } from './propsExterior';

const METALS = ['#dfe3e6', '#c9ced3', '#b9c2c9', '#9aa4ab', '#5d6670', '#3f454d', '#e6e2d8', '#8e9aa0'];

/** Wall color, height and annex of each kind's hall (shared with the far models). */
export function hallLook(kind: string, seed: number, floors: number): { wall: Color3; H: number; office: boolean; storeys: number } {
  const r1 = hash2(seed, 1);
  const pick = (a: string[]) => hx(a[Math.floor(r1 * a.length) % a.length]);
  switch (kind) {
    case 'sawmill': return { wall: pick(['#5f6f5a', '#6e5a48', '#8a8f86', '#4f5f6a']), H: 6.4, office: hash2(seed, 2) < 0.5, storeys: 1 };
    case 'brickworks': return { wall: pick(['#b9c2c9', '#c9b8a6', '#8e9aa0', '#a87a62']), H: 6.0, office: true, storeys: 1 };
    case 'glassworks': return { wall: pick(['#e6e2d8', '#dfe3e6', '#c9ced3']), H: 5.6, office: true, storeys: 1 };
    case 'steelmill': return { wall: pick(['#4a525a', '#5d6670', '#3f454d']), H: 8.0, office: hash2(seed, 2) < 0.5, storeys: 1 };
    case 'foodplant': return { wall: pick(['#f2f0ea', '#e6e9ec', '#dfe6e8']), H: 6.6, office: true, storeys: 1 };
    case 'furniture': return { wall: hx('#3f454d'), H: 6.0, office: true, storeys: 1 };
    case 'textile': return { wall: pick(['#e6e2d8', '#dfe3e6', '#c9ced3', '#d9d2c4']), H: Math.max(1, floors) * 4.2, office: true, storeys: Math.max(1, floors) };
    case 'electronics': return { wall: hx('#f2f2ee'), H: Math.max(1, floors) * 4.0, office: true, storeys: Math.max(1, floors) };
    case 'carplant': return { wall: pick(['#dfe3e6', '#c9ced3', '#e6e2d8']), H: 9.0, office: true, storeys: 1 };
    case 'dairyplant': return { wall: hx('#f4f5f3'), H: 7.0, office: true, storeys: 1 };
    case 'meatplant': return { wall: hx('#d9dcdc'), H: 6.4, office: true, storeys: 1 };
    case 'depot': return { wall: pick(['#c9c2b0', '#7d8fa0', '#dfe3e6', '#9aa88f', '#5d6670']), H: 7.0, office: false, storeys: 1 };
    default: return { wall: hx(METALS[Math.floor(hash2(seed, 701) * METALS.length)]), H: 5.6, office: false, storeys: 1 };
  }
}

export interface Hall { bw: number; bd: number; cz: number; H: number; front: number; doorTop: number; doorW: number }

interface HallOpts {
  H: number;
  wall?: Color3;
  accent?: Color3 | null;
  roof?: 'flat' | 'low' | 'saw' | 'curve';
  ribs?: 'v' | 'h';
  doors?: number; // sectional doors on the front
  doorW?: number;
  docks?: number; // truck docks on the right side
  office?: boolean; // a glazed office annex at a front corner
  bw?: number; bd?: number; cz?: number;
  floor?: Color3;
  windows?: boolean;
  storeys?: number;
}

/** A metal-clad production hall over the footprint. */
export function modernHall(c: Ctx, o: HallOpts): Hall {
  const { b } = c;
  const g = c.solid;
  const bw = o.bw ?? b.w - 0.6, bd = o.bd ?? b.d - 0.6, cz = o.cz ?? 0, H = o.H;
  const wall = o.wall ?? hx(METALS[Math.floor(c.r(701) * METALS.length)]);
  const accent = o.accent === undefined ? c.brand : o.accent;
  const storeys = o.storeys ?? 1;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: storeys > 1 ? H / storeys : FLOOR_H, floors: storeys, floor: o.floor ?? C.concrete, base: 0.26 };
  // plinth and walls
  g.box(0, 0, cz, bw + 0.2, 0.6, bd + 0.2, hx('#a9a59c'));
  c.wall.box(0, 0.55, cz, bw, H - 0.55, bd, wall);
  const doorW = o.doorW ?? Math.min(4.2, bw * 0.24);
  const doorH = Math.min(H - 1.2, 4.8);
  const nd = o.doors ?? 1;
  const doorXs: number[] = [];
  for (let k = 0; k < nd; k++) doorXs.push(nd === 1 ? -bw * 0.12 : -bw / 2 + (k + 0.6) * (bw * 0.7 / nd));
  const officeX = bw / 2 - 3.3;
  if (!c.cut) {
    c.sides(0, cz, bw, bd, (s, len) => {
      // cladding: vertical ribs or horizontal panel joints
      if (o.ribs === 'h') for (let y = 1.6; y < H - 0.2; y += 1.0) g.quad(-len / 2, y, 0.01, len / 2, y, 0.01, len / 2, y + 0.04, 0.01, -len / 2, y + 0.04, 0.01, shade(wall, 0.84), 0, 0, 1);
      else for (let x = -len / 2 + 0.6; x < len / 2 - 0.3; x += 0.9) g.quad(x - 0.04, 0.6, 0.012, x + 0.04, 0.6, 0.012, x + 0.04, H - 0.05, 0.012, x - 0.04, H - 0.05, 0.012, shade(wall, 0.86), 0, 0, 1);
      // a band of brand color under the eaves
      if (accent) g.quad(-len / 2, H - 0.75, 0.02, len / 2, H - 0.75, 0.02, len / 2, H - 0.35, 0.02, -len / 2, H - 0.35, 0.02, accent, 0, 0, 1);
      // ribbon windows high up (lit when a shift works late)
      if (o.windows !== false && (s === 1 || s === 3 || s === 2)) {
        const n = Math.max(1, Math.floor((len - 2) / 3));
        for (let k = 0; k < n; k++) {
          const x0 = -len / 2 + 1 + k * ((len - 2) / n);
          c.pane(x0 + 0.06, H - 2.0, x0 + (len - 2) / n - 0.06, H - 1.05, 0.03, 'ind');
        }
        g.quad(-len / 2 + 0.9, H - 2.06, 0.04, len / 2 - 0.9, H - 2.06, 0.04, len / 2 - 0.9, H - 2.0, 0.04, -len / 2 + 0.9, H - 2.0, 0.04, C.dark, 0, 0, 1);
      }
    });
  }
  // front: sectional doors and a door; docks on the right side
  c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 0) {
      for (const x of doorXs) sectionalDoor(c, x, 0.6, doorW, doorH, shade(wall, 0.9));
      c.door(o.office ? officeX - 3.6 : len * 0.36, 1.0, 2.2, C.dark, C.dark, 0.6);
    } else if (s === 1 && (o.docks ?? 0) > 0) {
      const n = o.docks!;
      for (let k = 0; k < n; k++) {
        const x = -len / 2 + (k + 0.5) * (len / n);
        sectionalDoor(c, x, 1.2, 2.9, 3.0, shade(wall, 0.88));
        if (!c.cut) {
          g.box(x, 0, 0.6, 3.6, 1.2, 1.2, hx('#8d8a84'));
          for (const sx of [-1.6, 1.6]) g.box(x + sx, 1.0, 1.25, 0.25, 0.45, 0.15, C.black);
          g.box(x, 4.5, 0.08, 3.5, 0.3, 0.16, C.black, 0, false);
        }
      }
      if (!c.cut) g.box(0, 4.6, 1.1, len - 1, 0.12, 2.2, shade(wall, 0.8), 0, true);
    } else if (s === 2) {
      c.door(len * 0.3, 1.0, 2.2, C.dark, C.dark, 0.6);
    }
  });
  // roof
  if (o.roof === 'saw') sawRoof(c, 0, H, cz, bw, bd, Math.max(2, Math.round(bd / 5)), 1.6, hx('#7d8287'), wall);
  else if (o.roof === 'curve') barrelRoof(c, 0, H, cz, bw, bd, Math.min(2.4, bd * 0.12), hx('#8a9096'), wall);
  else if (!c.cut) {
    flatRoof(c, 0, H, cz, bw, bd, hx('#8d8f92'), shade(wall, 0.9), 0.55, 0.2);
    // rows of skylights and roof fans
    const rows = Math.max(1, Math.floor((bd - 4) / 4.5));
    for (let rI = 0; rI < rows; rI++) {
      const z = cz - bd / 2 + 2.5 + rI * ((bd - 5) / Math.max(1, rows - 1 || 1));
      g.box(0, H + 0.08, z, bw * 0.7, 0.35, 1.0, hx('#c9ccd0'));
      c.lit(c.paneState('ind', c.nextPane(), 0.5)).box(0, H + 0.43, z, bw * 0.68, 0.04, 0.9, hx('#9fb6c4'));
    }
    for (let k = 0; k < 3; k++) {
      const x = -bw / 2 + 2 + k * ((bw - 4) / 2);
      g.cyl(x, H + 0.08, cz + bd * 0.3, 0.45, 0.45, 0.7, 8, C.steel);
      g.cyl(x, H + 0.78, cz + bd * 0.3, 0.6, 0.6, 0.08, 8, C.dark);
    }
  }
  // the office annex: two floors of glass and panels at a front corner, the sign on top
  let front = cz + bd / 2;
  if (o.office) {
    const ow = Math.min(7, bw * 0.38), od = 4.2, oh = 6.6, ox = bw / 2 - ow / 2, oz = cz + bd / 2 + od / 2 - 0.4;
    g.box(ox, 0, oz, ow + 0.1, 0.2, od + 0.1, hx('#a9a59c'));
    c.wall.box(ox, 0.2, oz, ow, oh - 0.2, od, hx('#2f3a44'));
    if (!c.cut) {
      c.sides(ox, oz, ow, od, (s, len) => {
        if (s === 2) return;
        for (let f = 0; f < 2; f++) {
          const y0 = 0.25 + f * 3.2;
          const n = Math.max(2, Math.round(len / 1.4));
          for (let k = 0; k < n; k++) {
            const x0 = -len / 2 + k * (len / n);
            if (s === 0 && f === 0 && k === Math.floor(n / 2)) continue;
            c.pane(x0 + 0.04, y0 + 0.6, x0 + len / n - 0.04, y0 + 3.0, 0.03, 'off', 0.8);
          }
          g.quad(-len / 2, y0, 0.04, len / 2, y0, 0.04, len / 2, y0 + 0.6, 0.04, -len / 2, y0 + 0.6, 0.04, shade(wall, 0.95), 0, 0, 1);
        }
        for (let k = 0; k <= Math.round(len / 1.4); k++) g.box(-len / 2 + k * (len / Math.max(1, Math.round(len / 1.4))), 0.2, 0.05, 0.06, oh - 0.2, 0.06, C.dark, 0, false);
        if (s === 0) c.door(0, 1.4, 2.4, C.dark, C.dark, 0.25, true);
      });
      g.box(ox, oh, oz, ow + 0.3, 0.35, od + 0.3, shade(wall, 0.8));
      g.box(ox, 2.95, oz + od / 2 + 0.7, 2.4, 0.15, 1.4, C.dark, 0, true);
    }
    c.t.push(ox, 0, oz + od / 2 + 0.06, 0);
    c.sign(c.look.firmName, 0, oh - 1.0, Math.min(ow - 0.6, 6), 0.7, 0.02, null);
    c.t.pop();
    front = oz + od / 2;
  }
  if (c.near) hallExtras(c, bw, bd, cz, H, o.roof === 'flat' || !o.roof ? 'flat' : 'other');
  return { bw, bd, cz, H, front, doorTop: 0.6 + doorH, doorW };
}

/** A sectional (roll-up) door with a frame and panel lines (current wall frame). */
function sectionalDoor(c: Ctx, x: number, y: number, w: number, h: number, col: Color3): void {
  if (c.cut) return;
  const g = c.solid;
  g.box(x, y, 0.02, w + 0.3, h + 0.2, 0.08, C.dark, 0, false);
  g.box(x, y, 0.07, w, h, 0.03, col, 0, false);
  for (let k = 1; k < Math.floor(h / 0.55); k++) g.box(x, y + k * 0.55, 0.095, w, 0.03, 0.02, shade(col, 0.8), 0, false);
  if (h > 2.8) for (let k = 0; k < 4; k++) c.pane(x - w / 2 + 0.25 + k * ((w - 0.5) / 4), y + h * 0.62, x - w / 2 + 0.25 + (k + 1) * ((w - 0.5) / 4) - 0.1, y + h * 0.62 + 0.4, 0.1, 'ind');
}

/** The company sign over the main doors (or the office annex has it). */
function hallSign(c: Ctx, h: Hall, office: boolean): void {
  if (office) return;
  c.t.push(0, 0, h.cz + h.bd / 2, 0);
  c.sign(c.look.firmName, 0, Math.min(h.H - 1.0, h.doorTop + 0.35), Math.min(h.bw * 0.45, 8), 0.8, 0.02, null);
  c.t.pop();
}

/** A tall cylindrical silo on legs (or on the ground), with a cone hopper, a ladder cage and a roof walkway. */
function silo(c: Ctx, x: number, z: number, r: number, h: number, col: Color3, legs = 0): void {
  const g = c.solid;
  if (legs > 0) {
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; g.box(x + Math.cos(a) * r * 0.8, 0.05, z + Math.sin(a) * r * 0.8, 0.25, legs + 0.2, 0.25, C.metal); }
    g.cyl(x, legs - r * 0.9, z, 0.3, r, r * 0.9, 12, shade(col, 0.9));
  }
  g.cyl(x, legs, z, r, r, h, 12, col);
  g.cyl(x, legs + h, z, r, r * 0.25, r * 0.4, 12, shade(col, 0.92));
  for (let k = 1; k < 4; k++) g.cyl(x, legs + (k / 4) * h, z, r + 0.02, r + 0.02, 0.08, 12, shade(col, 0.82), 0, false);
  g.box(x + r + 0.15, Math.max(0.05, legs - 0.5), z, 0.08, h + 0.5 + Math.min(legs, 0.5), 0.5, C.iron, 0, false);
}

/** An inclined belt conveyor in a truss, on legs. */
function conveyor(c: Ctx, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w = 0.9, col = hx('#7d858c')): void {
  const g = c.solid;
  g.beam(ax, ay, az, bx, by, bz, w, col);
  g.beam(ax, ay + 0.5, az, bx, by + 0.5, bz, 0.2, shade(col, 0.8));
  const n = Math.max(1, Math.floor(Math.hypot(bx - ax, bz - az) / 6));
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1);
    g.box(lerp(ax, bx, t), 0.05, lerp(az, bz, t), 0.25, lerp(ay, by, t) - 0.3, 0.25, C.iron);
  }
}

/** A concrete mixer truck (drum toward the back). */
function mixerTruck(c: Ctx, x: number, z: number, rot: number, col: Color3, drum: Color3): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  g.box(0, 0.5, 2.6, 2.3, 1.9, 1.8, col);
  g.box(0, 1.6, 3.52, 2.1, 0.7, 0.04, hx('#3a4652'), 0, false);
  g.box(0, 0.35, 0, 1.0, 0.4, 7.2, C.iron);
  g.tube(0, 1.6, 1.4, 0, 2.3, -2.6, 1.15, 10, drum, true, 0.7, shade(drum, 0.8));
  g.box(0, 0.75, -3.1, 0.8, 1.6, 0.8, shade(col, 0.8));
  for (const wz of [2.6, -0.8, -2.4]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.16, 0.48, wz, wx + 0.16, 0.48, wz, 0.48, 8, C.tire, true, 0.48, C.steel);
  c.t.pop();
}

/** A wheel loader with its bucket down. */
function loader(c: Ctx, x: number, z: number, rot: number, col = C.yellow): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  g.box(0, 0.7, -0.6, 2.2, 1.2, 3.0, col);
  g.box(0, 1.9, -0.4, 1.6, 1.5, 1.6, col);
  c.glass.box(0, 2.0, 0.42, 1.4, 1.1, 0.03, hx('#3a4652'));
  for (const sx of [-0.85, 0.85]) g.beam(sx, 1.2, 0.8, sx, 0.7, 2.6, 0.22, col);
  g.box(0, 0.15, 2.9, 2.6, 0.9, 1.0, shade(col, 0.8));
  for (const wz of [1.0, -1.6]) for (const wx of [-1.15, 1.15]) g.tube(wx - 0.25, 0.75, wz, wx + 0.25, 0.75, wz, 0.75, 9, C.tire, true, 0.75, shade(col, 0.8));
  c.t.pop();
}

/** An open-sided steel shed on posts (storage under a roof). */
function shed(c: Ctx, x: number, z: number, w: number, d: number, h: number, col: Color3): void {
  const g = c.solid;
  for (const sx of [-1, 1]) for (let k = 0; k <= Math.max(1, Math.round(d / 4)); k++) g.box(x + sx * (w / 2 - 0.15), 0.05, z - d / 2 + 0.15 + k * ((d - 0.3) / Math.max(1, Math.round(d / 4))), 0.25, h, 0.25, C.metal);
  if (!c.cut) g.slab([x - w / 2 - 0.3, h, z + d / 2 + 0.3, x + w / 2 + 0.3, h, z + d / 2 + 0.3, x + w / 2 + 0.3, h + 0.5, z - d / 2 - 0.3, x - w / 2 - 0.3, h + 0.5, z - d / 2 - 0.3], 0.12, col, 0, 1, 0.2, shade(col, 0.7));
}

/** Yard lights, a chain-link fence with a gate, staff parking. */
function yardFence(c: Ctx, gateW = 7): void {
  lotFence(c, 'chain', [[0, gateW]], 0.35);
  lamp(c, -c.lw / 2 + 1.2, c.ld / 2 - 1.2, 6, Math.PI / 4);
  lamp(c, c.lw / 2 - 1.2, -c.ld / 2 + 1.2, 6, -Math.PI * 0.75);
}

// =================================================================== kinds

export function sawmill(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'gravel');
  const wall = hx(['#5f6f5a', '#6e5a48', '#8a8f86', '#4f5f6a'][Math.floor(c.r(1) * 4)]);
  const h = modernHall(c, { H: 6.4, wall, roof: 'low', doors: 1, doorW: 4.6, office: c.r(2) < 0.5, floor: C.sand });
  hallSign(c, h, false);
  const { bw, bd, cz } = h;
  const side = (c.lw - bw) / 2;
  // the log deck and an infeed conveyor, a debarker
  if (side > 2.5) {
    const lx = bw / 2 + Math.min(3, side - 0.8);
    logPile(c, lx, cz - 1, 0, Math.min(8, bd - 2), 4, 0.36);
    conveyor(c, lx - 0.5, 1.2, cz + bd / 2 - 1.5, bw / 2 - 0.2, 2.6, cz + bd / 2 - 1.5, 1.0);
  }
  // the dust cyclone and a sawdust silo
  const sx = -bw / 2 + 2.2, sz = cz - bd / 2 - 1.8;
  silo(c, sx, sz, 1.4, 6, hx('#c9ced3'), 3.2);
  g.cyl(sx + 2.4, 6.4, sz, 0.9, 0.3, 2.2, 10, C.steel);
  g.cyl(sx + 2.4, 8.6, sz, 0.9, 0.9, 1.2, 10, C.steel);
  g.tube(sx + 2.4, 9.6, sz, -bw / 2 + 3.5, 6.4, cz - bd / 4, 0.35, 8, C.steel);
  // stacked lumber under a shed in front
  const fy = c.ld / 2 - (cz + bd / 2);
  if (fy > 4) {
    shed(c, -bw * 0.18, cz + bd / 2 + fy / 2, bw * 0.55, Math.min(fy - 1, 5), 3.6, hx('#7d8287'));
    for (let k = 0; k < 3; k++) plankStack(c, -bw * 0.18 - bw * 0.18 + k * bw * 0.18, cz + bd / 2 + fy / 2, 0, Math.min(fy - 2, 3.4), 1.2, 4 + (k % 2) * 2);
  }
  pile(c, -bw / 2 - 1.2, cz - bd / 2 - 3.5, 1.8, 1.4, C.sand);
  if (side > 4) loader(c, -bw / 2 - side / 2, cz + 2, Math.PI / 2 + 0.3, C.yellow);
  yardFence(c);
}

export function brickworks(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'gravel');
  const wall = hx(['#b9c2c9', '#c9b8a6', '#8e9aa0', '#a87a62'][Math.floor(c.r(1) * 4)]);
  const h = modernHall(c, { H: 6.0, wall, roof: 'low', doors: 1, office: true, docks: 2 });
  const { bw, bd, cz } = h;
  // the tunnel kiln: a long low block along the back with a steel stack
  const kd = 3.2, kz = cz - bd / 2 - kd / 2 - 0.4;
  if (c.ld / 2 + kz - kd / 2 > 0) {
    g.box(0, 0.05, kz, bw - 1, 3.4, kd, hx('#7a5a4a'));
    g.box(0, 3.45, kz, bw - 0.6, 0.35, kd + 0.4, hx('#5d4c3e'));
    for (let k = 0; k < 6; k++) g.box(-bw / 2 + 2 + k * ((bw - 4) / 5), 3.8, kz, 0.6, 0.8, 0.6, C.metal);
    c.glow.box(bw / 2 - 0.4, 0.4, kz, 0.05, 1.4, 1.6, GLOW_ORANGE);
  }
  stack(c, bw / 2 - 1.5, cz - bd / 2 - 1.0, 0.7, 20, hx('#b9bec2'), C.red);
  // clay under an open shed, a conveyor into the hall
  const side = (c.lw - bw) / 2;
  if (side > 3) {
    shed(c, -bw / 2 - side / 2, cz, side - 0.8, bd * 0.6, 4.2, hx('#7d8287'));
    pile(c, -bw / 2 - side / 2, cz, Math.min(side / 2 - 0.6, 2.4), 1.6, C.clay);
    conveyor(c, -bw / 2 - side / 2, 1.0, cz + 1.5, -bw / 2 + 0.2, 3.4, cz + 1.5, 0.8);
  }
  // pallets of bricks wrapped in plastic, a forklift
  const fy = c.ld / 2 - h.front;
  for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) {
    const z = h.front + 1.0 + k * 1.5;
    if (z > c.ld / 2 - 0.8 || fy < 2) continue;
    pallet(c, -bw / 2 + 1.0 + i * 1.5, z, 0, C.brickRed, 0.9);
    g.box(-bw / 2 + 1.0 + i * 1.5, 0.2, z, 1.16, 0.95, 1.16, mix(C.brickRed, C.white, 0.3), 0, false);
  }
  if (c.near) c.props.add('forklift', c.t, -bw / 2 + 3, 0.05, h.front + 3.6, 0.6);
  yardFence(c);
}

/** Cement and concrete plant: cement silos, a batching tower fed by a conveyor from aggregate bays, mixer trucks. */
export function cementworks(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'gravel');
  const W = b.w, D = b.d;
  const grey = hx('#c9c6be'), dust = hx('#b5b0a5');
  // the control room and lab: a small two-floor block at the front
  const ox = -W / 2 + 3.5, oz = D / 2 - 2.5;
  c.body = { cx: ox, cz: oz, w: 6, d: 4.4, storey: FLOOR_H, floors: 1, floor: C.concrete };
  c.wall.box(ox, 0, oz, 6, 3.4, 4.4, hx('#e6e2d8'));
  if (!c.cut) {
    c.sides(ox, oz, 6, 4.4, (s, len) => {
      if (s === 0) { c.door(-1.8, 1.0, 2.2, C.dark, C.dark); for (const u of [0.2, 1.8]) c.window(u, 1.0, 1.3, 1.3, 'off', C.dark, { sill: false }); }
      else if (s !== 2) c.window(0, 1.0, Math.min(2, len - 1), 1.2, 'off', C.dark, { sill: false });
    });
    g.box(ox, 3.4, oz, 6.3, 0.3, 4.7, c.brand);
  }
  c.t.push(ox, 0, oz + 2.2, 0);
  c.sign(c.look.firmName, 0, 2.55, 4.6, 0.65, 0.04, null);
  c.t.pop();
  // the batching tower: a clad box on a steel frame with the mixer underneath (trucks drive in)
  const tx = W / 2 - 4, tz = -1.0;
  for (const [sx, sz] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) g.box(tx + sx, 0.05, tz + sz, 0.35, 5.2, 0.35, C.metal);
  g.box(tx, 5.2, tz, 4.4, 6.0, 4.4, grey);
  g.box(tx, 11.2, tz, 4.8, 0.35, 4.8, c.brand);
  g.cyl(tx, 3.4, tz, 1.1, 0.4, 1.8, 10, C.steel);
  g.box(tx, 0.06, tz, 3.8, 0.02, 4.6, hx('#8a8580'), 0, false);
  // cement silos beside it, piped to the tower
  for (let k = 0; k < 3; k++) {
    const sx = tx - 5 - k * 3.1, sz = tz - 2.2;
    silo(c, sx, sz, 1.35, 11, k % 2 ? grey : dust, 2.6);
    g.beam(sx, 13.6, sz, tx - 2.2, 10.8, tz - 1, 0.25, C.steel);
  }
  // aggregate bays (concrete walls) with sand and gravel, an inclined conveyor up to the tower
  const bx0 = -W / 2 + 1.5, bz = -D / 2 + 3.2;
  for (let k = 0; k <= 3; k++) g.box(bx0 + k * 3.4, 0.05, bz, 0.4, 2.2, 4.4, hx('#9d998f'));
  g.box(bx0 + 5.1, 0.05, bz - 2.2, 10.6, 2.2, 0.4, hx('#9d998f'));
  const agg = [C.sand, hx('#8a857c'), hx('#a59a88')];
  for (let k = 0; k < 3; k++) pile(c, bx0 + 1.7 + k * 3.4, bz + 0.3, 1.4, 1.5 + (k % 2) * 0.4, agg[k]);
  conveyor(c, bx0 + 5.1, 0.8, bz + 2.8, tx - 2.2, 10.6, tz, 0.9);
  // mixer trucks: one under the tower, one waiting, one leaving
  const drum = c.pick([hx('#f2f0ea'), hx('#e8b631'), hx('#d9533a'), c.brand], 3);
  mixerTruck(c, tx, tz + 0.5, Math.PI, hx('#3a3d42'), drum);
  if (c.ld / 2 - D / 2 > 1) mixerTruck(c, tx - 4.6, D / 2 + 1.6, Math.PI / 2, hx('#e6e2d8'), drum);
  if (c.lw > W + 4) mixerTruck(c, W / 2 + 1.5, -D / 2 + 3, 0, hx('#3a3d42'), drum);
  loader(c, bx0 + 5, bz + 4.6, Math.PI + 0.4);
  // cement dust on everything near the plant
  g.box(tx - 3, 0.055, tz, 14, 0.01, 10, mix(C.gravel, C.white, 0.25), 0, false);
  stationsOf(b).forEach((s) => {
    if (s.kind !== 'machine') return;
    g.box(s.lx, 0.05, s.lz + 1.0, 1.4, 1.2, 1.0, hx('#8d949a'));
  });
  if (c.near) c.props.add('trafficCone', c.t, tx + 2.6, 0.05, tz + 3.4, 0);
  yardFence(c, 8);
}

/** Glassworks: a long float-glass hall, a taller furnace house with a stack and glowing vents, a batch house, racks of glass. */
export function glassworks(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const wall = hx(['#e6e2d8', '#dfe3e6', '#c9ced3'][Math.floor(c.r(1) * 3)]);
  const h = modernHall(c, { H: 5.6, wall, roof: 'low', doors: 1, office: true, docks: 2, accent: c.brand });
  const { bw, bd, cz } = h;
  // the furnace house: a taller block at the back-left, a stack, glowing vents along its side
  const fw = bw * 0.36, fd = bd * 0.55, fx = -bw / 2 + fw / 2, fz = cz - bd / 2 + fd / 2;
  g.box(fx, 5.5, fz, fw, 4.0, fd, shade(wall, 0.85));
  g.box(fx, 9.5, fz, fw + 0.3, 0.3, fd + 0.3, shade(wall, 0.7));
  stack(c, fx - fw * 0.2, fz - fd * 0.2, 0.8, 26, hx('#b9bec2'), c.brand);
  c.t.push(fx - fw / 2, 0, fz, -Math.PI / 2);
  for (let k = 0; k < 3; k++) c.glow.box(-fd / 3 + k * (fd / 3), 6.4, 0.06, 1.2, 0.5, 0.04, GLOW_ORANGE);
  c.t.pop();
  // the batch house with silos (sand, soda ash, limestone, cullet)
  const side = (c.lw - bw) / 2;
  if (side > 3) for (let k = 0; k < 3; k++) silo(c, -bw / 2 - Math.min(side - 1.6, 2.2), cz - bd / 2 + 2 + k * 2.9, 1.2, 8, k === 1 ? hx('#e8e4dc') : C.steel, 1.5);
  // A-frame racks of glass sheets in the yard (they reflect the sky)
  const fy = c.ld / 2 - h.front;
  if (fy > 2.5) for (let k = 0; k < 3; k++) {
    const x = -bw / 2 + 2.2 + k * 3.2, z = h.front + Math.min(fy - 1.2, 2.0);
    g.box(x, 0.05, z, 2.4, 0.2, 1.2, C.metal);
    g.beam(x - 1.1, 0.25, z, x, 2.0, z, 0.08, C.metal);
    g.beam(x + 1.1, 0.25, z, x, 2.0, z, 0.08, C.metal);
    for (const sz of [-0.25, -0.15, 0.15, 0.25]) c.glass.slab([x - 1.15, 0.25, z + sz * 2, x + 1.15, 0.25, z + sz * 2, x + 1.15, 1.9, z + sz * 0.6, x - 1.15, 1.9, z + sz * 0.6], 0.02, hx('#8fb8c0'), 0, 0.3, sz);
  }
  if (c.lw > bw + 6) truck(c, bw / 2 + side / 2, cz - 2, Math.PI, hx('#3a3d42'), hx('#dfe3e6'));
  yardFence(c);
  void b;
}

/** An electric-arc steel mill: a tall dark melt shop with a fume duct and baghouse, a rolling mill hall, a scrap yard. */
export function steelmill(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'gravel');
  const wall = hx(['#4a525a', '#5d6670', '#3f454d'][Math.floor(c.r(1) * 3)]);
  const h = modernHall(c, { H: 8.0, wall, roof: 'low', doors: 1, doorW: 5, office: c.r(2) < 0.5, accent: hx('#c0582f'), ribs: 'v' });
  hallSign(c, h, false);
  const { bw, bd, cz } = h;
  // molten glow behind the big door
  if (!c.cut) {
    c.t.push(0, 0, cz + bd / 2, 0);
    c.glow.box(-bw * 0.12, 0.62, 0.11, 4.2, 2.0, 0.02, GLOW_ORANGE);
    c.t.pop();
  }
  // the melt shop rising above the hall at the back, the fume duct to a baghouse, stacks
  const mw = bw * 0.45, md = bd * 0.5, mx = bw / 2 - mw / 2 - 0.5, mz = cz - bd / 2 + md / 2 + 0.5;
  g.box(mx, 8.0, mz, mw, 6.5, md, shade(wall, 0.9));
  g.box(mx, 14.5, mz, mw + 0.4, 0.4, md + 0.4, hx('#2f3338'));
  for (let k = 0; k < 4; k++) g.box(mx - mw / 2 + 1 + k * ((mw - 2) / 3), 14.9, mz, 1.0, 1.2, 1.0, C.metal);
  const bx = -bw / 2 + 2.5, bz = cz - bd / 2 - 2.6;
  g.tube(mx, 13.5, mz - md / 2, bx + 1.5, 13.5, bz, 0.9, 10, hx('#8d949a'));
  g.box(bx, 0.05, bz, 4.2, 9, 3.0, hx('#9aa4ab'));
  for (let k = 0; k < 4; k++) g.box(bx - 1.6 + k * 1.07, 0.05, bz + 1.7, 0.6, 1.6, 0.6, hx('#7d858c'));
  stack(c, bx - 0.5, bz - 2.3, 0.75, 24, hx('#b9bec2'), C.red);
  stack(c, bx + 1.6, bz - 2.3, 0.6, 20, hx('#b9bec2'), C.white);
  c.glow.box(mx + mw / 2 + 0.03, 9.5, mz, 0.04, 1.6, 2.4, GLOW_ORANGE);
  // the scrap yard with a material-handling crane
  const side = (c.lw - bw) / 2;
  if (side > 3.5) {
    const sx = -bw / 2 - side / 2;
    pile(c, sx, cz, Math.min(side / 2, 3), 2.2, hx('#6a5a4e'));
    pile(c, sx, cz + 4, Math.min(side / 2, 2.4), 1.6, hx('#5a5048'));
    g.box(sx, 0.05, cz - 4, 2.4, 1.2, 3.4, C.dark);
    g.beam(sx, 1.6, cz - 4, sx + 1.5, 7.5, cz - 1, 0.35, C.yellow);
    g.beam(sx + 1.5, 7.5, cz - 1, sx + 1.5, 3.5, cz + 1, 0.04, C.iron);
    g.blob(sx + 1.5, 3.0, cz + 1, 0.7, 0.4, 0.7, C.iron, 6, 3);
  }
  yardFence(c, 8);
}

export function foodplant(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'paved');
  const wall = hx(['#f2f0ea', '#e6e9ec', '#dfe6e8'][Math.floor(c.r(1) * 3)]);
  const h = modernHall(c, { H: 6.6, wall, roof: 'flat', doors: 0, docks: 3, office: true, accent: c.brand, ribs: 'h', floor: C.tile });
  const { bw, bd, cz } = h;
  // stainless tanks and silos along the side
  const side = (c.lw - bw) / 2;
  const sx = side > 3.6 ? -bw / 2 - Math.min(side - 1.8, 2.2) : -bw / 2 + 1.8;
  for (let k = 0; k < 3; k++) {
    const z = side > 3.6 ? cz - bd / 2 + 1.6 + k * 3.3 : cz - bd / 2 - 2.2;
    const x = side > 3.6 ? sx : sx + k * 3.3;
    silo(c, x, z, 1.4, 9, C.steel, 1.6);
  }
  for (let k = 0; k < 4; k++) g.cyl(-bw / 4 + k * 1.6, 6.6, cz - bd * 0.25, 0.6, 0.6, 1.8, 10, C.steel);
  // a refrigerated truck at a dock
  if (side > 3.3) truck(c, bw / 2 + side / 2, cz - 1, Math.PI, c.brand, C.white);
  for (let k = 0; k < 3; k++) crate(c, -bw / 2 + 1 + k * 0.9, 0.05, h.front + 1.0, 0.8, P.goods[(k + 2) % P.goods.length]);
}

export function workshop(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'gravel');
  const h = modernHall(c, { H: 5.6, roof: 'saw', doors: 2, doorW: 3.4, office: false, ribs: 'v' });
  hallSign(c, h, false);
  const { bw, bd, cz } = h;
  // steel stock racks and barrels in the yard
  const fy = c.ld / 2 - (cz + bd / 2);
  if (fy > 2) {
    const rz = cz + bd / 2 + Math.min(fy - 1, 2.0);
    for (const x of [-bw / 2 + 1, -bw / 2 + 3.4]) g.box(x, 0.05, rz, 0.15, 1.0, 1.0, C.iron);
    for (let k = 0; k < 6; k++) g.tube(-bw / 2 + 0.5, 1.08 + (k % 2) * 0.12, rz - 0.3 + k * 0.1, -bw / 2 + 3.9, 1.08 + (k % 2) * 0.12, rz - 0.3 + k * 0.1, 0.05, 5, C.steel);
  }
  void tree;
}

export function furniturePlant(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'gravel');
  const wood = hx(['#a87a52', '#8a6a4a', '#c49a66'][Math.floor(c.r(1) * 3)]);
  const h = modernHall(c, { H: 6.0, wall: hx('#3f454d'), roof: 'low', doors: 1, docks: 2, office: true, accent: null, ribs: 'v' });
  const { bw, bd, cz } = h;
  // timber cladding on the front, a dust extraction duct and cyclone
  if (!c.cut) {
    c.t.push(0, 0, cz + bd / 2 + 0.03, 0);
    for (let x = -bw / 2 + 0.2; x < bw / 2 - 7.2; x += 0.3) g.quad(x, 0.6, 0.0, x + 0.26, 0.6, 0.0, x + 0.26, 6.0, 0.0, x, 6.0, 0.0, shade(wood, 0.9 + hash2(c.b.seed, Math.round(x * 10)) * 0.2), 0, 0, 1);
    c.t.pop();
  }
  g.cyl(-bw / 2 + 2, 6.0, cz - bd / 2 - 1.6, 1.0, 0.3, 2.4, 10, C.steel);
  g.cyl(-bw / 2 + 2, 8.4, cz - bd / 2 - 1.6, 1.0, 1.0, 1.4, 10, C.steel);
  g.tube(-bw / 2 + 2, 9.4, cz - bd / 2 - 1.6, -bw / 2 + 4, 6.0, cz - bd / 4, 0.35, 8, C.steel);
  const fy = c.ld / 2 - h.front;
  if (fy > 2) {
    plankStack(c, -bw / 2 + 1.5, h.front + Math.min(fy - 1, 2.2), Math.PI / 2, 3.0, 1.0, 5);
    for (let k = 0; k < 3; k++) crate(c, -bw / 2 + 4 + k * 1.1, 0.05, h.front + 1.2, 1.0, hx('#d8cfb8'));
  }
}

/** Clothing factory: a two-floor block with ribbon windows and a colored stripe, docks and a glass office front. */
export function textile(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const fl = Math.max(1, b.floors);
  const H = fl * 4.2;
  const wall = hx(['#e6e2d8', '#dfe3e6', '#c9ced3', '#d9d2c4'][Math.floor(c.r(1) * 4)]);
  const h = modernHall(c, { H, wall, roof: 'flat', doors: 0, docks: 2, office: true, accent: c.brand, ribs: 'h', storeys: fl, windows: false });
  const { bw, bd, cz } = h;
  // ribbon windows on every floor
  if (!c.cut) c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 1) return;
    for (let f = 0; f < fl; f++) {
      const y = f * 4.2 + 1.6;
      const n = Math.max(1, Math.floor(len / 2.2));
      for (let k = 0; k < n; k++) {
        const x0 = -len / 2 + 0.5 + k * ((len - 1) / n);
        if (s === 0 && f === 0 && x0 > bw / 2 - 8) continue;
        c.pane(x0 + 0.05, y, x0 + (len - 1) / n - 0.05, y + 1.5, 0.03, 'ind', 0.6);
      }
      g.quad(-len / 2 + 0.4, y - 0.08, 0.04, len / 2 - 0.4, y - 0.08, 0.04, len / 2 - 0.4, y, 0.04, -len / 2 + 0.4, y, 0.04, C.dark, 0, 0, 1);
    }
  });
  // bolts of cloth on pallets by the docks
  const side = (c.lw - bw) / 2;
  if (side > 2) for (let k = 0; k < 4; k++) {
    const x = bw / 2 + Math.min(side - 0.8, 1.2), z = cz - bd / 2 + 1.5 + k * 1.5;
    g.box(x, 0.05, z, 1.2, 0.15, 1.2, C.woodLight);
    for (let j = 0; j < 3; j++) g.tube(x - 0.3 + (j % 2) * 0.6, 0.42 + Math.floor(j / 2) * 0.5, z - 0.55, x - 0.3 + (j % 2) * 0.6, 0.42 + Math.floor(j / 2) * 0.5, z + 0.55, 0.26, 8, P.fabrics[(k * 3 + j) % P.fabrics.length]);
  }
}

export function electronics(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const fl = Math.max(1, b.floors);
  const H = fl * 4.0;
  const h = modernHall(c, { H, wall: hx('#f2f2ee'), roof: 'flat', doors: 0, docks: 2, office: true, accent: c.brand, ribs: 'h', storeys: fl, floor: C.tile, windows: false });
  const { bw, bd, cz } = h;
  if (!c.cut) c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 1) return;
    for (let f = 0; f < fl; f++) {
      const y0 = f * 4.0 + 1.3;
      c.pane(-len / 2 + 0.8, y0, s === 0 && f === 0 ? bw / 2 - 8 : len / 2 - 0.8, y0 + 1.5, 0.04, 'off', 0.7);
      g.quad(-len / 2 + 0.8, y0 - 0.1, 0.05, len / 2 - 0.8, y0 - 0.1, 0.05, len / 2 - 0.8, y0, 0.05, -len / 2 + 0.8, y0, 0.05, C.steel, 0, 0, 1);
    }
  });
  // solar panels on the roof, HVAC units
  if (!c.cut) {
    const rows = Math.max(1, Math.floor((bd - 3) / 2.2));
    for (let r = 0; r < rows; r++) for (let k = 0; k < 3; k++) {
      const x = -bw / 2 + 2 + k * ((bw - 4) / 3) + (bw - 4) / 6, z = cz - bd / 2 + 1.6 + r * 2.2;
      const pw = (bw - 4) / 3 - 0.4;
      c.glass.slab([x - pw / 2, H + 0.6, z + 0.7, x + pw / 2, H + 0.6, z + 0.7, x + pw / 2, H + 1.2, z - 0.6, x - pw / 2, H + 1.2, z - 0.6], 0.05, hx('#2a3f66'), 0, 1, 0.4, C.steel);
    }
  }
  const by = c.ld / 2 - bd / 2;
  void by;
}

export function carplant(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const h = modernHall(c, { H: 9.0, wall: hx(['#dfe3e6', '#c9ced3', '#e6e2d8'][Math.floor(c.r(1) * 3)]), roof: 'flat', doors: 2, doorW: 5, docks: 3, office: true, accent: c.brand, ribs: 'v' });
  const { bw, bd, cz } = h;
  // the paint shop: a tall block on the roof with stacks
  g.box(-bw * 0.2, 9.0, cz - bd * 0.15, bw * 0.4, 4.0, bd * 0.4, hx('#b9c2c9'));
  for (let k = 0; k < 3; k++) stack(c, -bw * 0.32 + k * 2.2, cz - bd * 0.15, 0.45, 9, hx('#c9ced3'), null, 13);
  // new cars lined up in the yard
  const fy = c.ld / 2 - h.front, by = c.ld / 2 - (bd / 2 - cz);
  const rowCars = (z: number, rot: number) => {
    const n = Math.floor((c.lw - 2) / 2.5);
    for (let i = 0; i < n; i++) if (hash2(b.seed, 700 + i + Math.round(z) * 31) < 0.8) car(c, -((n - 1) * 2.5) / 2 + i * 2.5, z, rot, c.pick(P.cars, 720 + i + Math.round(z)), 0.05);
  };
  if (fy > 4.9) rowCars(h.front + fy / 2 + 0.2, 0);
  if (by > 5.5) rowCars(cz - bd / 2 - by + 2.8, Math.PI);
}

/** A logistics depot: a wide hall with truck bays along the front, the depot's trucks, a yard. */
export function depot(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const wall = hx(['#c9c2b0', '#7d8fa0', '#dfe3e6', '#9aa88f', '#5d6670'][Math.floor(c.r(1) * 5)]);
  const bw = b.w - 0.6, bd = b.d - 2.4, cz = -0.9, H = 7.0;
  const front = cz + bd / 2;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FLOOR_H, floors: 1, floor: C.concrete };
  g.box(0, 0, front + 0.75, bw, 1.1, 1.5, hx('#a9a59c'));
  c.wall.box(0, 0, cz, bw, H, bd, wall);
  if (!c.cut) {
    c.sides(0, cz, bw, bd, (_s, len) => { for (let x = -len / 2 + 0.6; x < len / 2 - 0.3; x += 0.9) g.quad(x - 0.04, 1.2, 0.012, x + 0.04, 1.2, 0.012, x + 0.04, H - 0.05, 0.012, x - 0.04, H - 0.05, 0.012, shade(wall, 0.86), 0, 0, 1); }, [1, 2, 3]);
    g.box(0, H - 0.9, cz, bw + 0.06, 0.6, bd + 0.06, c.brand, 0, false);
  }
  const bays = stationsOf(b).filter((s) => s.kind === 'bay');
  c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 0) {
      for (const st of bays) {
        sectionalDoor(c, st.lx, 1.1, 2.9, 3.1, shade(wall, 0.85));
        if (!c.cut) {
          g.box(st.lx, 4.25, 0.08, 3.4, 0.3, 0.16, C.black, 0, false);
          for (const sx of [-1.55, 1.55]) g.box(st.lx + sx, 1.0, 1.55, 0.25, 0.5, 0.15, C.black);
          c.glow.box(st.lx + 1.75, 4.3, 0.15, 0.25, 0.2, 0.2, GLOW_BULB);
        }
      }
      c.sign(c.look.firmName, 0, H - 1.95, Math.min(len - 3, 8), 0.8, 0.04, null);
      if (!c.cut) g.box(0, 4.6, 1.4, len - 0.5, 0.15, 2.8, shade(wall, 0.8), 0, true);
    } else if (s === 3) {
      c.door(0, 1.0, 2.1, C.dark, C.dark);
      for (let k = 0; k < 3; k++) c.pane(-len / 2 + 1 + k * 2.2, 1.2, -len / 2 + 2.8 + k * 2.2, 2.4, 0.03, 'off', 0.7);
    }
  });
  flatRoof(c, 0, H, cz, bw, bd, hx('#8d8f92'), shade(wall, 0.9), 0.5);
  for (const st of bays) for (const sx of [-1.6, 1.6]) g.box(st.lx + sx, 0.05, front + 1.5 + 3, 0.15, 0.03, 6, C.yellow, 0, false);
  const side = (c.lw - bw) / 2;
  if (side > 3.3 && c.r(4) < 0.7) truck(c, (c.r(5) < 0.5 ? -1 : 1) * (bw / 2 + side / 2), cz - 1, Math.PI, c.brand, C.white);
  for (let k = 0; k < 3; k++) pallet(c, -bw / 2 + 1 + k * 1.4, cz - bd / 2 - 1.2, 0, hx('#c9b48a'), 0.7);
  if (c.near) hallExtras(c, bw, bd, cz, H, 'flat');
}

/** A clay pit: a terraced excavation with wet grey-brown clay, a pond at the bottom, an excavator, a dumper, a site cabin. */
export function claypit(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'clay');
  const W = b.w, D = b.d;
  const clays = [hx('#9a8a72'), hx('#8a7a66'), hx('#a8987e'), hx('#7d7060'), hx('#b0a088')];
  // terraces stepping down toward a pond at the back
  const back = -c.ld / 2 + 0.5, front = -D / 2 - 2.5;
  const steps = 4;
  for (let j = 0; j < steps; j++) {
    const z0 = back + (j * (front - back)) / steps, z1 = back + ((j + 1) * (front - back)) / steps;
    const inset = j * 1.6;
    g.box(0, -0.6 - j * 0.9, (z0 + front) / 2, c.lw - 1 - inset * 2, 0.6 + 0.05, front - z0, clays[j % clays.length]);
    g.box(0, -0.6 - j * 0.9 + 0.6, z1 - 0.05, c.lw - 1 - inset * 2, 0.02, 0.15, shade(clays[j % clays.length], 0.8), 0, false);
  }
  // the pond in the bottom
  const pw = c.lw * 0.45, pz = back + 3.5;
  c.glass.box(0, -0.6 - (steps - 1) * 0.9 + 0.62, pz, pw, 0.02, Math.min(5, (front - back) * 0.3), hx('#6f7f72'));
  // clay heaps, an excavator, a dumper truck on the ramp
  pile(c, W / 2 - 2, D / 2 - 2.5, 2.0, 1.6, clays[2]);
  pile(c, W / 2 - 4.5, D / 2 - 1.8, 1.4, 1.1, clays[0]);
  g.box(-W / 2 + 1.5, 0.05, (D / 2 + c.ld / 2) / 2, 3.4, 0.03, c.ld / 2 - D / 2, hx('#8a7a66'), 0, false);
  const ex = (c.r(3) - 0.5) * W * 0.4, ez = front - 3;
  c.t.push(ex, -1.2, ez, c.r(4) * 6);
  g.box(0, 0, 0, 2.6, 0.7, 3.6, C.dark);
  g.box(0, 0.7, 0.2, 2.4, 1.1, 2.6, C.yellow);
  g.box(-0.6, 1.8, 0.6, 1.0, 1.2, 1.2, C.yellow);
  c.glass.box(-0.6, 2.1, 1.21, 0.8, 0.7, 0.02, hx('#3a4652'));
  g.beam(0.5, 1.3, 1.2, 0.5, 3.4, 3.4, 0.35, C.yellow);
  g.beam(0.5, 3.4, 3.4, 0.5, 0.6, 4.6, 0.3, C.yellow);
  g.box(0.5, 0.2, 4.6, 1.0, 0.7, 0.8, C.iron);
  c.t.pop();
  c.t.push(W / 2 - 1.8, 0.05, -1, Math.PI * 0.9);
  g.box(0, 0.6, 1.8, 2.2, 1.6, 1.4, C.yellow);
  g.slab([-1.2, 1.2, 0.9, 1.2, 1.2, 0.9, 1.2, 2.2, -2.0, -1.2, 2.2, -2.0], 0.2, hx('#9a8a72'), 0, 1, 0);
  g.box(0, 0.5, -0.6, 2.4, 0.9, 3.4, C.yellow);
  for (const wz of [1.6, -1.4]) for (const wx of [-1.1, 1.1]) g.tube(wx - 0.3, 0.65, wz, wx + 0.3, 0.65, wz, 0.65, 9, C.tire, true, 0.65, C.dark);
  c.t.pop();
  // the site cabin with the sign
  const ox = -W / 2 + 2, oz = D / 2 - 2;
  c.body = { cx: ox, cz: oz, w: 6, d: 2.4, storey: 2.6, floors: 1, floor: C.concrete };
  c.wall.box(ox, 0.05, oz, 6, 2.6, 2.4, hx('#e0dccf'));
  if (!c.cut) {
    g.box(ox, 2.65, oz, 6.1, 0.1, 2.5, C.orange);
    c.sides(ox, oz, 6, 2.4, (s) => { if (s === 0) { c.door(-2.0, 0.9, 2.0, C.orange, C.dark, 0.05); c.window(0.3, 1.1, 1.2, 0.8, 'off', C.dark, { sill: false }); c.window(1.9, 1.1, 1.0, 0.8, 'off', C.dark, { sill: false }); } }, [0]);
  }
  c.t.push(ox, 0, oz + 1.2, 0);
  c.sign(c.look.firmName, 0, 2.95, 3.4, 0.55, 0.02, null);
  c.t.pop();
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'outdoor') return;
    g.blob(s.lx, 0.05, s.lz - 0.7, 0.55, 0.35, 0.45, clays[i % clays.length], 6, 4, true);
    g.beam(s.lx + 0.5, 0.05, s.lz - 0.2, s.lx + 0.6, 0.85, s.lz - 0.35, 0.05, C.woodLight);
  });
  fence(c, -c.lw / 2 + 0.5, c.ld / 2 - 0.5, -W / 2 - 0.5, c.ld / 2 - 0.5, 'chain');
}

/** A logging company's yard: log decks, a portable site office, a log truck and a forwarder, the forest edge behind. */
export function lumberyard(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'dirt');
  g.box(0, 0.05, 0, b.w + 3, 0.03, b.d + 2, C.gravel, 0, false);
  const W = b.w, D = b.d;
  // the office: two stacked portable cabins with a stair
  const ox = W / 2 - 3.2, oz = D / 2 - 1.8;
  c.body = { cx: ox, cz: oz, w: 6, d: 2.5, storey: 2.6, floors: 1, floor: C.floorWood };
  const cabin = (y: number, col: Color3) => {
    c.wall.box(ox, y, oz, 6, 2.6, 2.5, col);
    if (!c.cut) for (let u = -2.7; u <= 2.7; u += 0.45) g.box(ox + u, y + 0.1, oz + 1.26, 0.06, 2.4, 0.03, shade(col, 0.85), 0, false);
  };
  const cc = c.pick([hx('#3f6b4a'), hx('#e0dccf'), hx('#5a6b7a')], 1);
  cabin(0.05, cc);
  c.sides(ox, oz, 6, 2.5, (s) => {
    if (s !== 0) return;
    c.door(-1.8, 0.9, 2.1, C.dark, C.dark, 0.05);
    c.window(0.4, 1.0, 1.4, 0.9, 'off', C.dark, { sill: false });
    c.window(2.0, 1.0, 1.0, 0.9, 'off', C.dark, { sill: false });
  });
  c.t.push(ox, 0, oz + 1.25, 0);
  c.sign(c.look.firmName, 0, 2.75, 4.6, 0.6, 0.02, null);
  c.t.pop();
  // log decks
  logPile(c, -W / 2 + 3, -D / 2 + 2.5, 0, 6, 4, 0.34);
  logPile(c, -W / 2 + 3, D / 2 - 2.5, 0, 6, 3, 0.3);
  logPile(c, W / 2 - 3, -D / 2 + 2.5, 0, 5, 4, 0.32);
  // a log truck with a crane, a forwarder
  c.t.push(1, 0.05, 0, 0);
  g.box(0, 0.5, 3.2, 2.3, 1.9, 1.9, c.pick([hx('#c0392b'), hx('#2e6da4'), hx('#3a3d42')], 2));
  g.box(0, 1.6, 4.16, 2.1, 0.7, 0.04, hx('#3a4652'), 0, false);
  g.box(0, 0.35, -0.5, 1.0, 0.3, 8.6, C.iron);
  for (const z of [1.2, -1.8, -4.2]) { g.box(-1.1, 0.6, z, 0.12, 1.8, 0.12, C.iron); g.box(1.1, 0.6, z, 0.12, 1.8, 0.12, C.iron); }
  for (let k = 0; k < 3; k++) for (let j = 0; j < 4 - k; j++) g.tube(-0.75 + j * 0.5 + k * 0.25, 1.0 + k * 0.45, -4.6, -0.75 + j * 0.5 + k * 0.25, 1.0 + k * 0.45, 1.6, 0.24, 7, C.log, true, 0.24, C.logEnd);
  for (const wz of [3.2, 0, -2.6, -3.8]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.45, wz, wx + 0.15, 0.45, wz, 0.45, 8, C.tire, true, 0.45, C.steel);
  c.t.pop();
  // workers' spots: chainsaws on stumps
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'outdoor') return;
    const x = s.lx, z = s.lz + 0.8;
    g.cyl(x, 0.05, z, 0.35, 0.38, 0.5, 7, C.log, i, true, C.logEnd);
    g.box(x, 0.55, z, 0.5, 0.2, 0.18, C.orange);
  });
  for (let x = -c.lw / 2 + 1.8; x < c.lw / 2 - 1; x += 3.2 + c.r(70 + Math.round(x)) * 1.5) {
    tree(c, x, -c.ld / 2 + 1.6 + c.r(80 + Math.round(x)) * 1.2, 1.0 + c.r(90 + Math.round(x)) * 0.5, 40 + Math.round(x), 0.05, 'conifer');
  }
}

/**
 * An outdoor advertising company: a small office, and a yard with billboard panels stacked against a
 * rack, rolls of posters, a boom-lift truck, and a sample billboard on a pole showing an ad.
 */
export function adco(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const fl = Math.max(1, b.floors);
  const W = b.w * 0.6, D = b.d - 1.0, H = fl * FLOOR_H, ox = -b.w / 2 + W / 2 + 0.3;
  c.body = { cx: ox, cz: 0, w: W, d: D, storey: FLOOR_H, floors: fl, floor: C.carpet };
  const wall = hx(['#3a3d42', '#e6e2d8', '#5d6670'][Math.floor(c.r(1) * 3)]);
  c.wall.box(ox, 0, 0, W, H, D, wall);
  c.sides(ox, 0, W, D, (s, len) => {
    for (let f = 0; f < fl; f++) {
      const n = Math.max(2, Math.round(len / 1.6));
      for (let k = 0; k < n; k++) {
        const x0 = -len / 2 + k * (len / n);
        if (s === 0 && f === 0 && k === Math.floor(n / 2)) continue;
        if (s === 2) continue;
        c.pane(x0 + 0.08, f * FLOOR_H + 0.5, x0 + len / n - 0.08, f * FLOOR_H + 2.9, 0.03, 'off', 0.85);
      }
    }
    if (s === 0) c.door(0, 1.2, 2.4, C.dark, C.dark, 0, true);
  });
  flatRoof(c, ox, H, 0, W, D, hx('#8d8f92'), shade(wall, 0.9), 0.5);
  c.t.push(ox, 0, D / 2 + 0.05, 0);
  c.sign(c.look.firmName, 0, H - 0.9, Math.min(W - 1, 6), 0.65, 0.02, null);
  c.t.pop();
  // the yard: panels in a rack, poster rolls, the boom-lift truck
  const yx = b.w / 2 - (b.w - W) / 2 + 0.3;
  for (let k = 0; k < 4; k++) {
    const z = -D / 2 + 1.5 + k * 0.4;
    g.box(yx, 0.05, z, 3.8, 2.2, 0.08, k % 2 ? C.white : hsl2(c.hue + k * 0.17));
  }
  g.box(yx, 0.05, -D / 2 + 2.2, 4.0, 2.5, 0.12, C.iron, 0, false);
  for (let k = 0; k < 6; k++) g.tube(yx - 1.4 + (k % 3) * 0.5, 0.2 + Math.floor(k / 3) * 0.4, -D / 2 + 4.2, yx - 1.4 + (k % 3) * 0.5, 0.2 + Math.floor(k / 3) * 0.4, -D / 2 + 5.4, 0.18, 8, P.goods[(k * 3) % P.goods.length]);
  c.t.push(yx, 0.05, 1.5, 0);
  g.box(0, 0.5, 2.2, 2.2, 1.9, 1.8, C.white);
  g.box(0, 1.6, 3.12, 2.0, 0.7, 0.04, hx('#3a4652'), 0, false);
  g.box(0, 0.35, -0.6, 1.0, 0.3, 5.6, C.iron);
  g.box(0, 0.7, -0.8, 2.3, 0.4, 4.0, c.brand);
  g.beam(0, 1.2, -1.5, 0, 4.6, 1.0, 0.3, C.yellow);
  g.box(0, 4.6, 1.2, 1.4, 1.0, 1.0, C.yellow);
  for (const wz of [2.2, -1.2, -2.4]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.42, wz, wx + 0.15, 0.42, wz, 0.42, 8, C.tire, true, 0.42, C.steel);
  c.t.pop();
  // the sample billboard by the street (lit at night)
  const bx = b.w / 2 - 2.5, bz = c.ld / 2 - 1.2;
  g.box(bx, 0.05, bz, 0.4, 5.2, 0.4, C.metal);
  g.box(bx, 5.0, bz, 5.2, 2.6, 0.3, C.dark);
  c.t.push(bx, 0, bz + 0.16, 0);
  c.sign(c.look.firmName ? `${c.look.firmName}: your ad here` : 'Your ad here', 0, 5.15, 4.9, 2.2, 0.0, null);
  c.t.pop();
  for (const sx of [-1.6, 1.6]) c.warm.box(bx + sx, 7.7, bz + 0.5, 0.3, 0.12, 0.3, GLOW_BULB);
  if (c.near) streetBits(c, ox - W / 2 + 1, D / 2 + 1, 0, 3, ['bikes']);
}

function hsl2(h: number): Color3 {
  const c = Color3.FromHSV(((h % 1) + 1) % 1 * 360, 0.6, 0.85);
  return c;
}

