// Farm buildings on the countryside's big field lots, and farmhouses.
//
// A farm on a field lot is its farmyard (farmLayout.ts): the field renderer
// lays the yard's gravel and the crops or pasture on the unleveled ground,
// and this draws what stands in the yard, each piece set on the ground where
// it stands (look.terrain). Each kind looks like what it is:
//   grain farm: a red gambrel barn, corrugated grain bins, a stack of straw bales;
//   vegetable farm: a packing shed, plastic polytunnels, crates of produce;
//   dairy farm: a milking parlor with a milk tank, an open-sided cow barn,
//     blue silage silos and white-wrapped silage bales;
//   livestock farm: a timber barn, a rail corral with a water trough, a hay
//     shed full of round bales, a small feed silo.
// (The tractor is a model placed by the field renderer at tractorSpot.)
// Farms on city-sized rural lots keep the older compact farmstead (buildings.ts).
//
// The farmhouse: a traditional two-storey farmhouse with clapboard or brick
// walls, a steep roof, a deep front porch, a vegetable garden, a shed and a
// pickup in the drive.

import { Color3 } from '@babylonjs/core';
import { FLOOR_H } from '../sim/layout';
import { hash2 } from '../sim/rng';
import type { Building } from '../sim/types';
import { C, GLASS_DAY, GLOW_BULB, P, hx, mix, shade } from './buildingGeo';
import { Ctx, barrelRoof, chimney, crate, fence, gableRoof, gambrelRoof, pallet, rollDoor, tree } from './buildingCtx';
import { yardRect } from './farmLayout';
import { modernHall } from './industry';

/** Height of the drawn ground at a local point, relative to the building's ground (0 when unknown). */
function gy(c: Ctx, x: number, z: number): number {
  const t = c.look.terrain;
  if (!t) return 0;
  const b = c.b;
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle), rx = Math.sin(b.angle), ry = -Math.cos(b.angle);
  return t(b.x + rx * x + fx * z, b.y + ry * x + fy * z) - c.look.ground;
}

/** The lowest ground under a footprint (corners and center), relative to the building's ground. */
function lowest(c: Ctx, x: number, z: number, w: number, d: number): number {
  let m = gy(c, x, z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m = Math.min(m, gy(c, x + sx * w / 2, z + sz * d / 2));
  return m;
}

/** A concrete foundation under a footprint, down into the ground (so no corner floats on a slope). */
function foundation(c: Ctx, x: number, z: number, w: number, d: number, top = 0.08): void {
  const bottom = Math.min(-0.3, lowest(c, x, z, w, d) - 0.3);
  c.solid.box(x, bottom, z, w, top - bottom, d, hx('#9d998f'));
}

/** The highest ground under a footprint, relative to the building's ground. */
function highest(c: Ctx, x: number, z: number, w: number, d: number): number {
  let m = gy(c, x, z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) m = Math.max(m, gy(c, x + sx * w / 2, z + sz * d / 2));
  return m;
}

/** A concrete pad under a footprint, its top just above the highest ground there; returns the top's height. */
function pad(c: Ctx, x: number, z: number, w: number, d: number, col = hx('#a9a59c')): number {
  const top = highest(c, x, z, w, d) + 0.15, bottom = lowest(c, x, z, w, d) - 0.3;
  c.solid.box(x, bottom, z, w, top - bottom, d, col);
  return top;
}

/** Draw `fn` with its ground at the drawn ground under (x, z) (a box at y = 0.05 then stands on it). */
function at(c: Ctx, x: number, z: number, rot: number, fn: () => void): void {
  c.t.push(x, gy(c, x, z), z, rot);
  fn();
  c.t.pop();
}

/** A corrugated steel grain bin with a conical roof (local origin at its foot). */
function grainBin(c: Ctx, r: number, h: number): void {
  const g = c.solid;
  const steel = hx('#c4c8cc');
  g.cyl(0, -0.4, 0, r + 0.15, r + 0.15, 0.6, 14, hx('#9d998f'));
  g.cyl(0, 0.2, 0, r, r, h, 14, steel);
  for (let k = 1; k < Math.floor(h / 0.8); k++) g.cyl(0, 0.2 + k * 0.8, 0, r + 0.02, r + 0.02, 0.05, 14, shade(steel, 0.86), 0, false);
  g.cyl(0, 0.2 + h, 0, r + 0.1, 0.35, r * 0.55, 14, shade(steel, 1.05));
  g.cyl(0, 0.2 + h + r * 0.55, 0, 0.4, 0.4, 0.4, 8, shade(steel, 0.9));
  // ladder and the auger to the top
  g.box(r + 0.12, 0.2, 0, 0.06, h, 0.45, C.iron, 0, false);
  g.beam(r + 2.4, 0.3, 1.2, 0.3, h + r * 0.5, 0.3, 0.3, hx('#8d949a'));
}

/** A round bale lying on its side (local origin at its foot): straw, hay, or wrapped in plastic. */
function roundBale(c: Ctx, x: number, z: number, rot: number, col: Color3): void {
  c.t.push(x, 0, z, rot);
  c.solid.tube(-0.6, 0.72, 0, 0.6, 0.72, 0, 0.72, 10, col, true, 0.72, shade(col, 0.88));
  c.t.pop();
}

/** A tall silage silo with a dome (local origin at its foot). */
function towerSilo(c: Ctx, r: number, h: number, col: Color3): void {
  const g = c.solid;
  g.cyl(0, -0.4, 0, r + 0.2, r + 0.2, 0.6, 14, hx('#9d998f'));
  g.cyl(0, 0.2, 0, r, r, h, 14, col);
  for (let k = 1; k < 5; k++) g.cyl(0, 0.2 + (k / 5) * h, 0, r + 0.02, r + 0.02, 0.1, 14, shade(col, 0.8), 0, false);
  g.blob(0, 0.2 + h, 0, r + 0.02, r * 0.55, r + 0.02, shade(col, 1.08), 14, 6, true);
  g.box(r + 0.12, 0.2, 0, 0.08, h + 0.5, 0.5, C.iron, 0, false);
}

/** A farm sign by the drive at the lane: the farm's name on a board between two posts. */
function farmSign(c: Ctx, x: number, z: number): void {
  if (!c.look.firmName) return;
  at(c, x, z, 0, () => {
    const g = c.solid;
    for (const sx of [-1.3, 1.3]) g.box(sx, 0.05, 0, 0.14, 2.2, 0.14, C.woodDark);
    g.box(0, 1.25, -0.04, 2.9, 0.9, 0.08, C.woodLight);
    c.t.push(0, 0, 0.01, 0);
    c.sign(c.look.firmName, 0, 1.35, 2.5, 0.7, 0.02, null, 'carved');
    c.t.pop();
  });
}

/** The yard around the building (in its frame), its trees, the sign and a drive mark; returns the yard. */
function yard(c: Ctx): { hw: number; z0: number; z1: number } {
  const { b } = c;
  const y = yardRect(b.w, b.d, c.ld, c.look.lotZ ?? 0);
  // trees at the back corners of the yard
  for (const [k, sx] of [[1, -1], [2, 1]]) {
    const tx = sx * (y.hw - 1.8), tz = y.z0 + 1.8;
    tree(c, tx, tz, 1.4 + c.r(400 + k) * 0.5, 40 + k, gy(c, tx, tz) + 0.05, c.r(410 + k) < 0.3 ? 'conifer' : 'leafy');
  }
  farmSign(c, y.hw - 3.5, y.z1 - 1.5);
  return y;
}

// ======================================================== farm kinds

/** Grain farm: a red gambrel barn, grain bins, straw bales. */
function grainFarm(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const y = yard(c);
  const red = mix(hx('#a8463a'), hx('#8a3a30'), c.r(2));
  const bw = b.w - 0.6, bd = b.d - 0.6;
  foundation(c, 0, 0, bw + 0.4, bd + 0.4);
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: 4.6, floors: 1, floor: hx('#9a9286'), base: 0.12 };
  c.wall.box(0, 0.08, 0, bw, 4.5, bd, red);
  gambrelRoof(c, 0, 4.58, 0, bw, bd, 3.8, c.r(3) < 0.5 ? hx('#4f4a48') : hx('#6f7478'), red);
  if (!c.cut) {
    // big sliding doors with white trim and an X brace, a hay loft door above
    c.t.push(0, 0, bd / 2, 0);
    const dw = Math.min(5, bw * 0.45);
    g.box(0, 0.08, 0.03, dw, 3.9, 0.08, shade(red, 0.85), 0, false);
    for (const yy of [0.08, 3.9]) g.box(0, yy, 0.08, dw + 0.2, 0.16, 0.04, C.white, 0, false);
    for (const sx of [-dw / 2, 0, dw / 2]) g.box(sx, 0.08, 0.08, 0.16, 3.95, 0.04, C.white, 0, false);
    g.beam(-dw / 2, 0.2, 0.1, 0, 3.9, 0.1, 0.12, C.white);
    g.beam(dw / 2, 0.2, 0.1, 0, 3.9, 0.1, 0.12, C.white);
    g.box(0, 5.2, 0.05, 1.4, 1.3, 0.06, shade(red, 0.8), 0, false);
    g.box(0, 5.15, 0.09, 1.6, 0.1, 0.03, C.white, 0, false);
    c.t.pop();
    c.sides(0, 0, bw, bd, (_s, len) => { for (let k = 1; k < 3; k++) c.window(-len / 2 + (k * len) / 3, 2.4, 0.9, 0.9, 'ind', C.white, { cross: true, sill: false }); }, [1, 3]);
  }
  // grain bins along the right side of the yard
  const n = 2 + (c.r(4) < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const x = bw / 2 + 5.2, z = bd / 2 - 3 - k * 6.4;
    at(c, x, z, 0, () => grainBin(c, 2.6, 6.5 + (k % 2) * 1.2));
  }
  // straw bales stacked behind the barn
  const sx = -bw / 4, sz = -bd / 2 - 5;
  at(c, sx, sz, 0.1, () => {
    for (let l = 0; l < 3; l++) for (let k = 0; k < 6 - l * 2; k++) g.box(-2.4 + l * 0.8 + k * 0.82, 0.05 + l * 0.5, 0, 0.8, 0.5, 1.2, shade(hx('#d9c27a'), 0.94 + ((k + l) % 3) * 0.04));
  });
  // a few round bales by the field gate
  for (let k = 0; k < 3; k++) {
    const x = -y.hw + 5 + k * 1.7, z = y.z0 + 7;
    at(c, x, z, 0, () => roundBale(c, 0, 0, Math.PI / 2, hx('#d4b867')));
  }
}

/** Vegetable farm: a packing shed, polytunnels, crates of produce. */
function vegFarm(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const y = yard(c);
  foundation(c, 0, 0, b.w, b.d);
  modernHall(c, { H: 5.0, wall: hx(['#e9ece8', '#dfe6dc', '#e6e2d8'][Math.floor(c.r(1) * 3)]), roof: 'low', doors: 2, doorW: 3.0, office: false, accent: hx('#4f8a3e'), ribs: 'v' });
  c.t.push(0, 0, b.d / 2 - 0.3, 0);
  c.sign(c.look.firmName, b.w * 0.2, 4.2, Math.min(b.w * 0.4, 6), 0.7, 0.02, null);
  c.t.pop();
  // polytunnels on the right side of the yard, running back from the front
  const x0 = b.w / 2 + 3, avail = y.hw - 1.5 - x0;
  const tw = 5.6, nt = Math.max(1, Math.min(3, Math.floor((avail + 1.2) / (tw + 1.2))));
  const len = Math.min(24, y.z1 - 3 - (y.z0 + 2));
  for (let k = 0; k < nt; k++) {
    const x = x0 + tw / 2 + k * (tw + 1.2), z = y.z1 - 3 - len / 2;
    const top = pad(c, x, z, tw + 0.3, len + 0.3, hx('#8a7a62'));
    c.t.push(x, top, z, 0);
    // hoops covered with milky plastic, crops inside
    if (!c.cut) {
      c.t.push(0, 0, 0, Math.PI / 2);
      barrelRoof(c, 0, 0.6, 0, len, tw, 2.6, hx('#e8ece6'), hx('#dfe5dc'), 9);
      c.t.pop();
      g.box(0, 0, 0, tw, 0.6, len, hx('#e2e6e0'));
      for (let i = 0; i < 3; i++) g.box(-tw / 2 + 1 + i * 1.8, 0.0, 0, 0.9, 0.35, len - 1.4, i % 2 ? C.veg : hx('#6fa24a'), 0, false);
      c.t.push(0, 0, len / 2 + 0.02, 0);
      c.door(0, 1.4, 2.0, hx('#cfd6cc'), C.steel, 0, false);
      c.t.pop();
    }
    c.t.pop();
  }
  // crates of produce on pallets by the shed's doors
  for (let k = 0; k < 4; k++) {
    const x = -b.w / 2 + 1.5 + k * 1.5, z = b.d / 2 + 2.2;
    at(c, x, z, 0, () => {
      pallet(c, 0, 0, 0, hx('#b98f5e'), 0.05, 1.2);
      for (let l = 0; l < 2 + (k % 2); l++) crate(c, 0, 0.25 + l * 0.42, 0, 0.5, [hx('#c0392b'), hx('#e67e22'), hx('#6fa24a'), hx('#8e5a3a')][(k + l) % 4]);
    });
  }
}

/** Dairy farm: milking parlor and dairy, an open-sided cow barn, silage silos, wrapped bales. */
function dairyFarm(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const y = yard(c);
  const wall = hx(['#f2f0ea', '#e9e6dc'][Math.floor(c.r(1) * 2)]);
  const bw = b.w - 0.6, bd = b.d - 0.6;
  foundation(c, 0, 0, bw + 0.4, bd + 0.4);
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: 3.6, floors: 1, floor: C.tile, base: 0.12 };
  c.wall.box(0, 0.08, 0, bw, 3.5, bd, wall);
  gableRoof(c, 0, 3.58, 0, bw, bd, 1.6, hx('#6f7478'), wall, 0.5);
  if (!c.cut) {
    c.sides(0, 0, bw, bd, (s, len) => {
      if (s === 0) {
        rollDoor(c, -len * 0.22, 0.08, 3.0, 2.8, C.steel);
        c.door(len * 0.2, 1.0, 2.1, hx('#2d5c8a'), C.white, 0.08);
        c.window(len * 0.36, 1.2, 1.0, 0.9, 'ind', C.white, { sill: false });
      } else {
        for (let k = 1; k < Math.max(2, Math.round(len / 3)); k++) c.window(-len / 2 + (k * len) / Math.max(2, Math.round(len / 3)), 2.0, 1.2, 0.7, 'ind', C.white, { sill: false });
      }
    });
    // the farm's sign on the gable
    c.t.push(0, 0, bd / 2 + 0.03, 0);
    c.sign(c.look.firmName, 0, 3.9, Math.min(bw * 0.6, 6), 0.6, 0.02, null);
    c.t.pop();
  }
  // the stainless milk tank on its pad by the left side (the milk truck comes for it)
  at(c, -bw / 2 - 2.2, -bd / 4, 0, () => {
    g.box(0, 0.05, 0, 2.4, 0.15, 3.6, C.concrete);
    for (const sz of [-1.1, 1.1]) g.box(0, 0.2, sz, 1.2, 0.6, 0.15, C.steel);
    g.tube(0, 1.55, -1.5, 0, 1.55, 1.5, 0.95, 12, hx('#d6dadd'), true, 0.95, hx('#c4c8cc'));
  });
  // the free-stall cow barn: an open-sided shed with a low roof, along the right side of the yard
  const sw = Math.min(14, y.hw - bw / 2 - 3), sx = bw / 2 + 2 + sw / 2;
  const sl = Math.min(26, y.z1 - 2 - (y.z0 + 5)), sz = y.z1 - 2 - sl / 2;
  if (sw > 6) {
    const top = pad(c, sx, sz, sw, sl);
    c.t.push(sx, top - 0.15, sz, 0);
    for (let k = 0; k <= Math.round(sl / 4.5); k++) {
      const z = -sl / 2 + (k * sl) / Math.round(sl / 4.5);
      for (const px of [-sw / 2 + 0.2, sw / 2 - 0.2]) g.box(px, 0.15, z, 0.2, 3.4, 0.2, C.steel);
      g.box(0, 3.5, z, sw, 0.18, 0.15, C.steel);
    }
    // low walls, curtains on the sides, a feed fence down the middle
    for (const px of [-sw / 2 + 0.15, sw / 2 - 0.15]) {
      g.box(px, 0.15, 0, 0.18, 1.1, sl, hx('#b9b5ab'));
      g.box(px, 1.25, 0, 0.06, 1.2, sl, hx('#3f6b4a'), 0, false);
    }
    g.box(0, 0.15, 0, 0.1, 1.2, sl - 1, C.steel, 0, false);
    gableRoof(c, 0, 3.65, 0, sw, sl, 1.3, hx('#8a9096'), hx('#c9ccd0'), 0.6, true);
    c.t.pop();
  }
  // blue silage silos behind the parlor
  for (let k = 0; k < 2; k++) {
    const x = -bw / 2 + 2.5 + k * 6.5, z = -bd / 2 - 6.5;
    at(c, x, z, 0, () => towerSilo(c, 2.7, 13 + k * 2, hx('#2f4f7a')));
  }
  // white-wrapped silage bales in a row
  for (let k = 0; k < 5; k++) {
    const x = -y.hw + 3.5, z = y.z0 + 5.5 + k * 1.6;
    at(c, x, z, 0, () => roundBale(c, 0, 0, 0, hx('#eef0ec')));
  }
}

/** Livestock farm: a timber barn, a corral with a water trough, a hay shed with round bales, a feed silo. */
function ranchFarm(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const y = yard(c);
  const wood = mix(hx('#7a5236'), hx('#8a4a34'), c.r(2));
  const bw = b.w - 0.6, bd = b.d - 0.6;
  foundation(c, 0, 0, bw + 0.4, bd + 0.4);
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: 4.2, floors: 1, floor: hx('#8a7a62'), base: 0.12 };
  c.wall.box(0, 0.08, 0, bw, 4.1, bd, wood);
  gableRoof(c, 0, 4.18, 0, bw, bd, 2.6, hx('#5a5f63'), wood, 0.5, true);
  if (!c.cut) {
    // vertical boards, two big doors on the gable end, a loft opening
    c.sides(0, 0, bw, bd, (_s, len) => { for (let x = -len / 2 + 0.3; x < len / 2; x += 0.6) g.quad(x - 0.03, 0.1, 0.012, x + 0.03, 0.1, 0.012, x + 0.03, 4.1, 0.012, x - 0.03, 4.1, 0.012, shade(wood, 0.82), 0, 0, 1); });
    c.t.push(0, 0, bd / 2, 0);
    for (const sx of [-1, 1]) g.box(sx * 1.4, 0.08, 0.04, 2.6, 3.4, 0.08, shade(wood, 1.15), 0, false);
    g.beam(-2.6, 0.2, 0.1, -0.2, 3.3, 0.1, 0.12, shade(wood, 0.7));
    g.beam(2.6, 0.2, 0.1, 0.2, 3.3, 0.1, 0.12, shade(wood, 0.7));
    g.box(0, 4.6, 0.04, 1.2, 1.0, 0.06, C.woodDark, 0, false);
    c.sign(c.look.firmName, 0, 3.75, Math.min(bw * 0.6, 5), 0.5, 0.06, null, 'carved');
    c.t.pop();
  }
  // a rail corral with a water trough on the right
  const cw = Math.min(16, y.hw - bw / 2 - 3), cx = bw / 2 + 2.5 + cw / 2;
  const cl = Math.min(18, y.z1 - 3 - (y.z0 + 5)), cz = y.z1 - 3 - cl / 2;
  if (cw > 6) {
    const pts: [number, number][] = [[cx - cw / 2, cz + cl / 2], [cx + cw / 2, cz + cl / 2], [cx + cw / 2, cz - cl / 2], [cx - cw / 2, cz - cl / 2]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % 4];
      // (a gate gap on the side toward the barn)
      if (k === 3) {
        const mz = (az + bz) / 2;
        at(c, ax, (az + mz - 1.6) / 2, 0, () => fence(c, 0, (mz - 1.6 - az) / 2, 0, -(mz - 1.6 - az) / 2, 'rail', C.woodLight));
        at(c, ax, (mz + 1.6 + bz) / 2, 0, () => fence(c, 0, (bz - mz - 1.6) / 2, 0, -(bz - mz - 1.6) / 2, 'rail', C.woodLight));
        continue;
      }
      at(c, (ax + bx) / 2, (az + bz) / 2, 0, () => fence(c, (ax - bx) / 2, (az - bz) / 2, (bx - ax) / 2, (bz - az) / 2, 'rail', C.woodLight));
    }
    at(c, cx + cw / 4, cz, 0, () => {
      g.box(0, 0.05, 0, 0.9, 0.55, 2.6, hx('#8d949a'));
      g.box(0, 0.5, 0, 0.75, 0.04, 2.45, C.water, 0, false);
    });
  }
  // the hay shed: a pole barn roof over stacked round bales, behind the barn
  const hx_ = -bw / 2 + 4, hz = -bd / 2 - 6;
  const ht = pad(c, hx_, hz, 9.2, 7.2, hx('#9a8f7a'));
  c.t.push(hx_, ht - 0.05, hz, 0);
  for (const [px, pz] of [[-4.3, -3.3], [4.3, -3.3], [4.3, 3.3], [-4.3, 3.3]]) g.box(px, -0.3, pz, 0.25, 5.0, 0.25, C.woodDark);
  if (!c.cut) gableRoof(c, 0, 4.7, 0, 9, 7, 1.2, hx('#6f7478'), C.woodDark, 0.4);
  for (let l = 0; l < 2; l++) for (let k = 0; k < 5 - l; k++) for (const zz of [-1.6, 1.6]) {
    c.t.push(-3 + k * 1.5 + l * 0.75, l * 1.3, zz, 0);
    roundBale(c, 0, 0, Math.PI / 2, hx('#c9b066'));
    c.t.pop();
  }
  c.t.pop();
  // a feed silo on legs by the barn
  at(c, bw / 2 + 1.6, -bd / 2 + 1.2, 0, () => {
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; g.box(Math.cos(a) * 0.9, -0.2, Math.sin(a) * 0.9, 0.16, 2.4, 0.16, C.metal); }
    g.cyl(0, 1.0, 0, 0.25, 1.2, 1.2, 10, C.steel);
    g.cyl(0, 2.2, 0, 1.2, 1.2, 3.2, 10, C.steel);
    g.cyl(0, 5.4, 0, 1.2, 0.2, 0.7, 10, shade(C.steel, 1.05));
  });
  // loose round bales in the yard
  for (let k = 0; k < 3; k++) {
    const x = -y.hw + 5 + k * 1.8, z = y.z0 + 5;
    at(c, x, z, 0, () => roundBale(c, 0, 0, Math.PI / 2, hx('#c9b066')));
  }
}

/** A farm on a countryside field lot: its farmyard by kind. */
export function farmyard(c: Ctx): void {
  switch (c.b.kind) {
    case 'vegfarm': vegFarm(c); break;
    case 'dairyfarm': dairyFarm(c); break;
    case 'ranch': ranchFarm(c); break;
    default: grainFarm(c);
  }
}

// ======================================================== farmhouse

/**
 * A traditional farmhouse: two storeys of clapboard (or brick) under a steep
 * roof, a deep porch across the front, a chimney; a gravel drive with a
 * pickup, a vegetable garden, a shed, a big shade tree, a clothesline.
 */
/** A farmhouse's gravel drive (building-local: center x, from z0 to the lot's front, width), see farmhouse(). */
export function farmhouseDrive(b: Pick<Building, 'w' | 'd' | 'seed'>): { x: number; z0: number; w: number } {
  const bw = b.w - 1.6, bd = b.d - 3.0, cz = -0.9;
  const side = hash2(b.seed, 9) < 0.5 ? 1 : -1;
  return { x: side * (bw / 2 + 3.2), z0: cz + bd / 2 + 1, w: 3.2 };
}

export function farmhouse(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  const bw = b.w - 1.6, bd = b.d - 3.0, cz = -0.9, front = cz + bd / 2, H = fl * FLOOR_H;
  const brick = c.r(2) < 0.25;
  const wall = brick ? c.pick(P.bricks, 3) : hx(['#f4f1ea', '#efe6d0', '#e3e8e6', '#f1e4cc', '#dfe3d0'][Math.floor(c.r(3) * 5)]);
  const trim = brick ? hx('#efe9dc') : hx(['#f8f6f0', '#3d5b4a', '#7a2e2a', '#2d3e5c'][Math.floor(c.r(4) * 4)]);
  const roofC = hx(['#5d6770', '#4a4f55', '#7b4b3a', '#6c5a48', '#3f4f5a'][Math.floor(c.r(5) * 5)]);
  const draped = !!c.look.draped;
  if (!draped) {
    // (in town or on a leveled lot: a lawn slab like other houses)
    g.box(0, -1.4, 0, c.lw - 0.1, 1.45, c.ld - 0.1, hx('#6f9a4c'));
  }
  foundation(c, 0, cz, bw + 0.5, bd + 0.5, 0.45);
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FLOOR_H, floors: fl, floor: C.floorWood, base: 0.5 };
  c.wall.box(0, 0.45, cz, bw, H - 0.45, bd, wall);
  if (!c.cut) {
    c.sides(0, cz, bw, bd, (_s, len) => {
      if (brick) for (let y = 0.9; y < H; y += 0.9) g.quad(-len / 2, y, 0.012, len / 2, y, 0.012, len / 2, y + 0.03, 0.012, -len / 2, y + 0.03, 0.012, shade(wall, 0.85), 0, 0, 1);
      else for (let y = 0.65; y < H; y += 0.24) g.quad(-len / 2, y, 0.012, len / 2, y, 0.012, len / 2, y + 0.035, 0.012, -len / 2, y + 0.035, 0.012, shade(wall, 0.88), 0, 0, 1);
      for (const sx of [-len / 2, len / 2]) g.box(sx, 0.45, 0.02, 0.18, H - 0.45, 0.06, trim, 0, false);
    });
  }
  // a steep gable roof (ridge along the front), a central cross gable over the door
  const rh = bd * 0.55;
  gableRoof(c, 0, H, cz, bw, bd, rh, roofC, wall, 0.45);
  if (!c.cut) {
    c.t.push(0, 0, front, 0);
    g.tri(-1.6, H + 0.05, 0.02, 1.6, H + 0.05, 0.02, 0, H + 1.9, 0.02, wall, 0, 0, 1);
    g.slab([-1.9, H - 0.1, 0.4, 0, H + 2.05, 0.4, 0, H + 2.05, -1.2, -1.9, H - 0.1, -1.2], 0.1, roofC, -1, 1, 0);
    g.slab([0, H + 2.05, 0.4, 1.9, H - 0.1, 0.4, 1.9, H - 0.1, -1.2, 0, H + 2.05, -1.2], 0.1, roofC, 1, 1, 0);
    c.window(0, H + 0.35, 0.7, 0.9, 'res', trim, { sill: false });
    c.t.pop();
    chimney(c, -bw * 0.3, H, cz, 0.8, rh + 0.9, brick ? shade(wall, 0.9) : hx('#8a5a44'));
  }
  // windows (shutters on clapboard), the front door
  const shutters = !brick && c.r(6) < 0.6 ? hx(['#2f4f3e', '#3a3d42', '#7a2e2a', '#2d3e5c'][Math.floor(c.r(7) * 4)]) : null;
  c.sides(0, cz, bw, bd, (s, len) => {
    for (let f = 0; f < fl; f++) {
      const yy = f * FLOOR_H + 1.15;
      const us = s === 0 ? (f === 0 ? [-bw * 0.32, bw * 0.32] : [-bw * 0.32, 0, bw * 0.32]) : len > 6 ? [-len / 4, len / 4] : [0];
      for (const u of us) c.window(u, yy, 0.95, 1.45, 'res', trim, { cross: true, sill: true, shutters });
    }
    if (s === 0) c.door(0, 1.0, 2.25, c.pick(P.doors, 8), trim, 0.45, false);
  });
  // the porch: a deck across the front, posts, a low-pitched roof, chairs
  const pd = 2.4;
  if (!c.cut) {
    g.box(0, 0, front + pd / 2, bw + 0.4, 0.45, pd, C.woodLight);
    for (let k = 0; k < 3; k++) g.box(0, 0, front + pd + 0.2 + k * 0.28, 1.6, 0.45 - (k + 1) * 0.13, 0.3, shade(C.woodLight, 0.92));
    for (let k = 0; k <= 4; k++) g.box(-bw / 2 + 0.1 + (k * (bw - 0.2)) / 4, 0.45, front + pd - 0.15, 0.16, 2.35, 0.16, trim);
    g.box(-bw / 4 - 0.6, 1.25, front + pd - 0.15, bw / 2 - 1.6, 0.06, 0.08, trim, 0, false);
    g.box(bw / 4 + 0.6, 1.25, front + pd - 0.15, bw / 2 - 1.6, 0.06, 0.08, trim, 0, false);
    g.slab([-bw / 2 - 0.3, 2.8, front + pd + 0.3, bw / 2 + 0.3, 2.8, front + pd + 0.3, bw / 2 + 0.3, 3.25, front, -bw / 2 - 0.3, 3.25, front], 0.1, roofC, 0, 1, 0.3, shade(roofC, 0.7));
    c.warm.box(0.9, 2.45, front + 0.08, 0.16, 0.24, 0.12, GLOW_BULB);
    for (const sx of [-bw * 0.32, bw * 0.32]) {
      g.box(sx, 0.45, front + 1.2, 0.6, 0.45, 0.6, C.white);
      g.box(sx, 0.9, front + 0.95, 0.6, 0.55, 0.08, C.white);
    }
  }
  // the yard, each piece on the ground where it stands
  const dx = farmhouseDrive(b).x, side = Math.sign(dx);
  // (the gravel drive from the lane is laid on the ground by the field renderer: farmhouseDrive)
  if (!draped) g.box(dx, 0.05, (front + 1 + c.ld / 2 + (c.look.lotZ ?? 0)) / 2, 3.0, 0.03, c.ld / 2 + (c.look.lotZ ?? 0) - front - 1, C.gravel, 0, false);
  // a pickup on the drive
  at(c, dx, front + 2.5, Math.PI + (c.r(10) - 0.5) * 0.2, () => {
    const col = c.pick([hx('#7a2e2a'), hx('#2d3e5c'), hx('#ecf0f1'), hx('#34495e'), hx('#5b6b3a')], 11);
    g.box(0, 0.45, 0.3, 1.9, 0.8, 5.0, col);
    g.box(0, 1.25, 0.9, 1.75, 0.65, 1.7, GLASS_DAY);
    g.box(0, 1.9, 0.9, 1.8, 0.08, 1.6, col);
    g.box(0, 1.25, -0.6, 1.9, 0.12, 2.5, shade(col, 0.8), 0, false);
    for (const [wx, wz] of [[-0.9, 1.7], [0.9, 1.7], [-0.9, -1.4], [0.9, -1.4]]) g.tube(wx - 0.15, 0.4, wz, wx + 0.15, 0.4, wz, 0.4, 8, C.tire, true, 0.4, C.steel);
  });
  // vegetable garden behind the house, a shed, a shade tree, a clothesline
  const gx = -side * (bw / 4), gz = cz - bd / 2 - 6;
  const gt = pad(c, gx, gz, 8.2, 6.8, hx('#6e5236'));
  c.t.push(gx, gt - 0.05, gz, 0);
  for (let k = 0; k < 5; k++) g.box(-3 + k * 1.5, 0.05, 0, 0.9, 0.22, 6, k % 2 ? C.veg : hx('#6fa24a'), 0, false);
  fence(c, -4, 3.5, 4, 3.5, 'picket', C.white);
  c.t.pop();
  const shx = side * (bw / 2 + 4), shz = cz - bd / 2 - 4;
  at(c, shx, shz, 0, () => {
    foundation(c, 0, 0, 4.2, 3.4);
    g.box(0, 0.05, 0, 4, 2.4, 3.2, shade(C.wood, 1.1));
    gableRoof(c, 0, 2.45, 0, 4, 3.2, 1.0, roofC, shade(C.wood, 1.1), 0.25);
    c.t.push(0, 0, 1.6, 0);
    c.door(0, 1.6, 2.0, C.woodDark, C.woodDark, 0.05);
    c.t.pop();
  });
  const tx = -side * (bw / 2 + 4.5), tz = front + 3;
  tree(c, tx, tz, 2.0 + c.r(12) * 0.5, 50, gy(c, tx, tz) + 0.05, 'leafy');
  if (c.r(13) < 0.7) {
    const lx = -side * (bw / 2 + 2.5), lz = cz - bd / 2 - 2;
    at(c, lx, lz, 0, () => {
      for (const z of [-2.5, 2.5]) g.box(0, 0.05, z, 0.08, 1.9, 0.08, C.metal);
      g.box(0, 1.9, 0, 0.02, 0.02, 5, C.white, 0, false);
      for (let k = 0; k < 4; k++) g.box(0, 1.4, -1.8 + k * 1.1, 0.02, 0.5, 0.7, P.fabrics[(k + Math.floor(c.r(14) * 5)) % P.fabrics.length], 0, false);
    });
  }
}
