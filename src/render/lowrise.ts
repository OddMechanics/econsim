// Low-rise buildings in a contemporary style: suburban houses (a flat-roofed
// modern box with a cantilevered upper floor, a modern farmhouse with a black
// metal gable, a neo-traditional house), stores (big glazing behind slim
// frames, a fascia or a canopy with the name, an upper floor of offices or
// flats) and restaurants (floor-to-ceiling windows, a terrace with umbrellas
// or a pergola). Close to the camera shop windows turn clear and the shop
// behind them is furnished (shopRoom), also for the shops in tower podiums.

import { Color3 } from '@babylonjs/core';
import { FLOOR_H, stationsOf, type Station } from '../sim/layout';
import { hash2 } from '../sim/rng';
import { C, GLOW_BULB, Geo, P, WS, hx, lerp, mix, shade } from './buildingGeo';
import {
  Ctx, GLASS_SHOP, bench, car, chimney, gableRoof, hipRoof, lotFence, lotGround, parking, planter, tree,
} from './buildingCtx';
import { furnish } from './interiors';
import { cafeSetting, roofClutter, streetBits } from './propsExterior';
import { PC } from './props';

const FH = FLOOR_H;

// ============================================================= shop rooms

/**
 * The inside of a shop seen through its window (current frame: the shop's center, front at +d/2):
 * floor, walls, ceiling with downlights, and the furnished stations. Lit from inside at night.
 */
export function shopRoom(c: Ctx, w: number, d: number, stations: Station[] | null, floorC: Color3, wallC: Color3): void {
  const g = c.inside;
  const h = 2.95;
  g.box(0, 0.0, 0, w - 0.1, 0.15, d - 0.1, floorC);
  g.quad(w / 2 - 0.05, 0.15, -d / 2 + 0.05, -w / 2 + 0.05, 0.15, -d / 2 + 0.05, -w / 2 + 0.05, h, -d / 2 + 0.05, w / 2 - 0.05, h, -d / 2 + 0.05, wallC, 0, 0, 1);
  g.quad(-w / 2 + 0.05, 0.15, -d / 2, -w / 2 + 0.05, 0.15, d / 2, -w / 2 + 0.05, h, d / 2, -w / 2 + 0.05, h, -d / 2, shade(wallC, 0.92), 1, 0, 0);
  g.quad(w / 2 - 0.05, 0.15, d / 2, w / 2 - 0.05, 0.15, -d / 2, w / 2 - 0.05, h, -d / 2, w / 2 - 0.05, h, d / 2, shade(wallC, 0.92), -1, 0, 0);
  g.quad(-w / 2, h, d / 2, w / 2, h, d / 2, w / 2, h, -d / 2, -w / 2, h, -d / 2, hx('#e8e6e0'), 0, -1, 0);
  for (let i = 0; i < Math.max(1, Math.floor(w / 2.2)); i++) for (let k = 0; k < Math.max(1, Math.floor(d / 2.6)); k++) {
    c.lit(WS.shop).quad(-w / 2 + 1.1 + i * 2.2 - 0.2, h - 0.01, -d / 2 + 1.3 + k * 2.6 + 0.2, -w / 2 + 1.1 + i * 2.2 + 0.2, h - 0.01, -d / 2 + 1.3 + k * 2.6 + 0.2, -w / 2 + 1.1 + i * 2.2 + 0.2, h - 0.01, -d / 2 + 1.3 + k * 2.6 - 0.2, -w / 2 + 1.1 + i * 2.2 - 0.2, h - 0.01, -d / 2 + 1.3 + k * 2.6 - 0.2, hx('#fff6e0'), 0, -1, 0);
  }
  if (stations) {
    const solid = c.solid;
    c.solid = c.inside;
    furnish(c, stations.filter((s) => s.floor === (stations[0]?.floor ?? 0)), () => 0.15);
    c.solid = solid;
  }
}

/** A building's walls and roof as a box, optionally without its front face (to see into the shop through clear glass). */
export function shell(g: Geo, x: number, z: number, w: number, h: number, d: number, col: Color3, front: boolean): void {
  const a = x - w / 2, b = x + w / 2, f = z + d / 2, k = z - d / 2;
  if (front) g.quad(a, 0, f, b, 0, f, b, h, f, a, h, f, col, 0, 0, 1);
  g.quad(b, 0, k, a, 0, k, a, h, k, b, h, k, col, 0, 0, -1);
  g.quad(b, 0, f, b, 0, k, b, h, k, b, h, f, col, 1, 0, 0);
  g.quad(a, 0, k, a, 0, f, a, h, f, a, h, k, col, -1, 0, 0);
  g.quad(a, h, f, b, h, f, b, h, k, a, h, k, col, 0, 1, 0);
}

/** Shop glazing in the current wall frame: clear (with the room behind) close up, lit panes farther away. */
function glazing(c: Ctx, x0: number, x1: number, y0: number, y1: number, z: number, frame: Color3, clear: boolean, vacant = false): void {
  const g = c.solid;
  const n = Math.max(1, Math.round((x1 - x0) / 1.8));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w + 0.03, b = x0 + (i + 1) * w - 0.03;
    if (clear && !vacant) c.clear.quad(a, y0, z, b, y0, z, b, y1, z, a, y1, z, hx('#b9d0dc'), 0, 0, 1);
    else c.lit(vacant ? WS.dark : WS.shop).quad(a, y0, z, b, y0, z, b, y1, z, a, y1, z, vacant ? mix(hx('#d8cdb5'), C.white, hash2(c.b.seed, 600 + i) * 0.4) : GLASS_SHOP, 0, 0, 1);
  }
  for (let i = 0; i <= n; i++) g.box(x0 + i * w, y0 - 0.05, z - 0.02, 0.07, y1 - y0 + 0.1, 0.07, frame, 0, false);
  g.box((x0 + x1) / 2, y1, z - 0.02, x1 - x0, 0.09, 0.08, frame, 0, false);
  g.box((x0 + x1) / 2, y0 - 0.12, z - 0.02, x1 - x0 + 0.1, 0.12, 0.1, shade(frame, 0.85), 0, false);
}

// ================================================================= houses

const RENDER_C = ['#f2f0ea', '#e8e2d4', '#dfe4e2', '#efe6d2', '#e6ded4', '#d9dcdc'];
const WOOD_C = ['#a87a52', '#8a6a4a', '#c49a66', '#6e5a48', '#b98a5e'];
const DARK_C = ['#2a2c30', '#3a3d42', '#4a4f55', '#5d6670'];
const SIDING_C = ['#f2f0ea', '#e8e4dc', '#cfd6d8', '#3a3d42', '#d9cfbd', '#8e9aa0', '#c9d4c0', '#e6ded4'];

/** A suburban house: a modern box, a modern farmhouse or a neo-traditional house. */
export function house(c: Ctx): void {
  const v = c.r(1);
  if (v < 0.36) modernHouse(c);
  else if (v < 0.68) farmhouse(c);
  else neoHouse(c);
}

/** Lawn, a driveway with a car, a path, a low hedge or a fence, trees, bins: the yard every house gets. */
function houseYard(c: Ctx, bw: number, bd: number, cz: number, doorX: number, driveSide: number): void {
  const g = c.solid;
  lotGround(c, 'lawn');
  const front = cz + bd / 2;
  g.box(doorX, 0.05, (front + c.ld / 2) / 2, 1.2, 0.03, c.ld / 2 - front, hx('#c8c1b4'), 0, false);
  const dx = driveSide * (bw / 2 + 1.9);
  const drive = c.lw - bw > 6.5;
  if (drive) {
    g.box(dx, 0.05, (c.ld / 2 + cz - bd / 2 + 2) / 2, 3.0, 0.035, c.ld / 2 - (cz - bd / 2 + 2), hx('#b4b0a6'), 0, false);
    if (c.r(21) < 0.75) car(c, dx, cz + 1.5, 0, c.pick(P.cars, 22), 0.09);
  }
  const fs = c.r(17);
  const gaps: [number, number][] = drive ? [[doorX, 1.6], [dx, 3.4]] : [[doorX, 1.6]];
  if (fs < 0.18) lotFence(c, 'hedge', gaps, 0.5);
  else if (fs < 0.36) lotFence(c, 'rail', gaps, 0.4, hx('#3a3d42'));
  else if (fs < 0.44) lotFence(c, 'picket', gaps, 0.4, C.white);
  const tx = -driveSide * (c.lw / 2 - 2.2);
  tree(c, tx, c.ld / 2 - 3.0, 0.9 + c.r(24) * 0.4, 1, 0.05, 'leafy');
  if (c.r(25) < 0.75) tree(c, -tx * 0.9, -c.ld / 2 + 2.6, 1.0 + c.r(26) * 0.4, 2);
  for (let i = 0; i < 5; i++) {
    const u = -bw / 2 + 0.5 + (i / 4) * (bw - 1);
    if (Math.abs(u - doorX) < 1.0) continue;
    g.blob(u, 0.25, front + 0.5, 0.36, 0.3, 0.32, i % 2 ? C.leaf : C.leafDark, 5, 3);
  }
  // the mailbox and the bins
  g.box(doorX + 1.2, 0.05, c.ld / 2 - 0.9, 0.08, 1.05, 0.08, C.dark);
  g.box(doorX + 1.2, 1.05, c.ld / 2 - 0.9, 0.3, 0.26, 0.45, c.pick([C.dark, hx('#2f4f3e'), C.white], 19));
  if (c.near) {
    streetBits(c, drive ? dx + driveSide * 1.8 : -doorX - 2, front - 0.6, Math.PI / 2, 11, ['bins']);
    // a patio with furniture behind
    const yz = cz - bd / 2 - 1.8;
    if (c.ld / 2 + cz - bd / 2 > 3.5) {
      g.box(0, 0.05, yz, 4.4, 0.06, 2.6, hx('#c8c1b4'), 0, false);
      c.props.add('bistroTable', c.t, -0.8, 0.1, yz, 0, 1.2, 1, 1.2, C.white);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + c.r(30); c.props.add('chairBistro', c.t, -0.8 + Math.sin(a) * 0.75, 0.1, yz + Math.cos(a) * 0.75, a + Math.PI, 1, 1, 1, c.pick(PC.fabric, 31)); }
      if (c.r(32) < 0.6) c.props.add('umbrella', c.t, -0.8, 0.1, yz, 0, 1, 1, 1, c.pick(PC.fabric, 33));
      cafeSetting(c, -0.8, 0.88, yz, 90);
    }
  }
}

/** A flat-roofed modern house: a white rendered box, a dark or wooden upper floor sliding out over the door, big windows. */
function modernHouse(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  const bw = b.w - 1.4, bd = b.d - 2.2, cz = -0.6, front = cz + bd / 2;
  const render = hx(RENDER_C[Math.floor(c.r(2) * RENDER_C.length)]);
  const upperC = c.r(3) < 0.5 ? hx(WOOD_C[Math.floor(c.r(4) * WOOD_C.length)]) : hx(DARK_C[Math.floor(c.r(4) * DARK_C.length)]);
  const frame = hx(DARK_C[Math.floor(c.r(5) * DARK_C.length)]);
  const flip = c.r(6) < 0.5 ? -1 : 1;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FH, floors: fl, floor: C.floorWood, base: 0.2 };
  const doorX = flip * bw * 0.28;
  houseYard(c, bw, bd, cz, doorX, -flip);
  g.box(0, 0, cz, bw + 0.2, 0.2, bd + 0.2, hx('#a9a59c'));
  // ground floor box
  c.wall.box(0, 0.2, cz, bw, FH - 0.2, bd, render);
  // upper floor: offset toward the door side, cantilevering over the entrance
  const uw = bw * 0.78, ux = flip * bw * 0.11, ud = bd + (fl > 1 ? 0.9 : 0);
  if (fl > 1) {
    c.wall.box(ux, FH, cz + 0.45, uw, FH, ud, upperC);
    if (!c.cut && upperC !== render) {
      // vertical boards on a wooden upper floor
      c.sides(ux, cz + 0.45, uw, ud, (_s, len) => { for (let x = -len / 2 + 0.15; x < len / 2; x += 0.3) g.quad(x - 0.02, FH + 0.05, 0.01, x + 0.02, FH + 0.05, 0.01, x + 0.02, 2 * FH - 0.05, 0.01, x - 0.02, 2 * FH - 0.05, 0.01, shade(upperC, 0.85), 0, 0, 1); });
    }
  }
  const H = fl * FH;
  // flat roofs with a thin dark coping
  if (!c.cut) {
    g.box(0, FH - 0.02, cz, bw + 0.3, 0.22, bd + 0.3, frame);
    if (fl > 1) g.box(ux, H - 0.02, cz + 0.45, uw + 0.3, 0.22, ud + 0.3, frame);
  }
  // windows: a big glazed wall on the garden side, tall slots, a corner window upstairs
  c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 0) {
      c.door(doorX, 1.1, 2.3, hx(WOOD_C[Math.floor(c.r(7) * WOOD_C.length)]), frame, 0.2);
      c.window(-doorX * 0.9, 0.5, Math.min(2.6, len * 0.3), 2.2, 'res', frame, { sill: false });
      c.window(doorX + flip * 1.0, 1.0, 0.45, 1.6, 'res', frame, { sill: false });
    } else if (s === 2) {
      c.window(0, 0.3, Math.min(len - 1.6, 5.2), 2.4, 'res', frame, { sill: false });
    } else c.window(0, 1.0, 1.4, 1.2, 'res', frame, { sill: false });
  });
  if (fl > 1) c.sides(ux, cz + 0.45, uw, ud, (s, len) => {
    if (s === 0) { c.t.push(0, FH, 0, 0); c.window(-len * 0.18, 0.7, Math.min(3, len * 0.45), 1.6, 'res', frame, { sill: false }); c.t.pop(); }
    else { c.t.push(0, FH, 0, 0); c.window(0, 0.9, Math.min(1.6, len * 0.4), 1.3, 'res', frame, { sill: false }); c.t.pop(); }
  });
  // a little canopy light by the door, solar panels on the roof
  if (!c.cut) {
    c.warm.box(doorX + 0.8, 2.4, front + 0.06, 0.12, 0.2, 0.08, GLOW_BULB);
    if (c.r(8) < 0.5) for (let k = 0; k < 3; k++) c.glass.slab([ux - uw / 2 + 0.6 + k * 1.3, H + 0.3, cz + 0.4, ux - uw / 2 + 1.7 + k * 1.3, H + 0.3, cz + 0.4, ux - uw / 2 + 1.7 + k * 1.3, H + 0.65, cz - 0.9, ux - uw / 2 + 0.6 + k * 1.3, H + 0.65, cz - 0.9], 0.04, hx('#2a3f66'), 0, 1, 0.4, C.steel);
  }
}

/** A modern farmhouse: white board-and-batten (or dark siding), a steep black metal gable, black window frames, a porch. */
function farmhouse(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  const bw = b.w - 1.6, bd = b.d - 2.4, cz = -0.5, front = cz + bd / 2, H = fl * FH;
  const siding = hx(SIDING_C[Math.floor(c.r(2) * SIDING_C.length)]);
  const dark = siding.r + siding.g + siding.b < 1.2;
  const roofC = hx(['#2a2c30', '#3a3d42', '#4a4f55', '#5d4c3e'][Math.floor(c.r(3) * 4)]);
  const frame = dark ? hx('#e8e4dc') : hx('#26292d');
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FH, floors: fl, floor: C.floorWood, base: 0.3 };
  const doorX = (c.r(6) < 0.5 ? -1 : 1) * bw * 0.18;
  houseYard(c, bw, bd, cz, doorX, doorX < 0 ? 1 : -1);
  g.box(0, 0, cz, bw + 0.25, 0.3, bd + 0.25, hx('#8e8a82'));
  c.wall.box(0, 0.3, cz, bw, H - 0.3, bd, siding);
  if (!c.cut) c.sides(0, cz, bw, bd, (_s, len) => { for (let x = -len / 2 + 0.2; x < len / 2; x += 0.4) g.quad(x - 0.025, 0.32, 0.012, x + 0.025, 0.32, 0.012, x + 0.025, H - 0.05, 0.012, x - 0.025, H - 0.05, 0.012, shade(siding, 0.9), 0, 0, 1); });
  // steep gable along X (ends at the sides), or along Z (a gable to the street)
  const along = c.r(9) < 0.5;
  const rh = (along ? bd : bw) * 0.42;
  gableRoof(c, 0, H, cz, bw, bd, rh, roofC, siding, 0.3, along);
  if (!c.cut && c.r(10) < 0.6) chimney(c, bw * 0.25, H, cz - bd * 0.15, 0.7, rh + 0.8, hx('#3a3d42'));
  c.sides(0, cz, bw, bd, (s, len) => {
    for (let f = 0; f < fl; f++) {
      const y = f * FH + 0.95;
      const us = s === 0 ? (f === 0 ? [-bw * 0.33, bw * 0.33].filter((u) => Math.abs(u - doorX) > 1.2) : [-bw / 3, 0, bw / 3]) : len > 6 ? [-len / 4, len / 4] : [0];
      for (const u of us) c.window(u, y, 1.0, 1.55, 'res', frame, { cross: true, sill: false });
    }
    if (s === 0) c.door(doorX, 1.0, 2.25, hx(['#2a2c30', '#7a2e2a', '#2f4f3e', '#c49a66'][Math.floor(c.r(7) * 4)]), frame, 0.3, false);
  });
  if (along && !c.cut) {
    c.t.push(0, 0, front + 0.01, 0);
    c.window(0, H + rh * 0.25, 0.9, 0.9, 'res', frame, { sill: false });
    c.t.pop();
  }
  // a porch across part of the front: black posts, a metal roof
  const pw = Math.min(bw - 0.4, 3.6 + c.r(15) * 2), pd = 1.8, pc = Math.max(-bw / 2 + pw / 2, Math.min(bw / 2 - pw / 2, doorX));
  g.box(pc, 0, front + pd / 2, pw, 0.3, pd, hx('#8a7a66'));
  for (const sx of [-1, 1]) g.box(pc + sx * (pw / 2 - 0.12), 0.3, front + pd - 0.12, 0.14, 2.4, 0.14, frame);
  if (!c.cut) {
    g.slab([pc - pw / 2 - 0.2, 2.75, front + pd + 0.25, pc + pw / 2 + 0.2, 2.75, front + pd + 0.25, pc + pw / 2 + 0.2, 3.05, front, pc - pw / 2 - 0.2, 3.05, front], 0.1, roofC, 0, 1, 0.3, shade(roofC, 0.7));
    c.warm.box(doorX + 0.7, 2.2, front + 0.08, 0.16, 0.24, 0.12, GLOW_BULB);
    if (c.near) for (const sx of [-1, 1]) {
      const x = pc + sx * (pw / 2 - 0.5);
      if (Math.abs(x - doorX) > 0.8) c.props.add('chairWood', c.t, x, 0.3, front + pd * 0.5, (c.r(40 + sx) - 0.5) * 0.5, 1, 1, 1, PC.woods[2]);
    }
  }
}

/** A neo-traditional suburban house: siding or brick, a hip or gable roof, a garage door, a covered entry. */
function neoHouse(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  const bw = b.w - 1.4, bd = b.d - 2.2, cz = -0.6, front = cz + bd / 2, H = fl * FH;
  const brick = c.r(13) < 0.3;
  const wallC = brick ? c.pick(P.bricks, 14) : hx(SIDING_C[Math.floor(c.r(2) * SIDING_C.length)]);
  const roofC = hx(['#3a3d42', '#5d6770', '#47535c', '#6e5a48', '#4a4f55'][Math.floor(c.r(3) * 5)]);
  const trim = C.white;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FH, floors: fl, floor: C.floorWood, base: 0.3 };
  const garageX = (c.r(6) < 0.5 ? -1 : 1) * bw * 0.25;
  const doorX = -garageX * 0.9;
  houseYard(c, bw, bd, cz, doorX, Math.sign(garageX));
  g.box(0, 0, cz, bw + 0.25, 0.3, bd + 0.25, C.stone);
  c.wall.box(0, 0.3, cz, bw, H - 0.3, bd, wallC);
  if (!c.cut && !brick) c.sides(0, cz, bw, bd, (_s, len) => { for (let y = 0.6; y < H - 0.2; y += 0.3) g.quad(-len / 2, y, 0.01, len / 2, y, 0.01, len / 2, y + 0.03, 0.01, -len / 2, y + 0.03, 0.01, shade(wallC, 0.9), 0, 0, 1); });
  if (c.r(5) < 0.5) hipRoof(c, 0, H, cz, bw, bd, 2.1, roofC, 0.45);
  else gableRoof(c, 0, H, cz, bw, bd, 2.3, roofC, wallC, 0.45, c.r(9) < 0.5);
  c.sides(0, cz, bw, bd, (s, len) => {
    for (let f = 0; f < fl; f++) {
      const y = f * FH + 1.0;
      let us: number[];
      if (s === 0) us = f === 0 ? [doorX + (doorX < 0 ? -1.4 : 1.4)].filter((u) => Math.abs(u) < bw / 2 - 0.8) : [-bw / 3, 0, bw / 3];
      else us = len > 6 ? [-len / 4, len / 4] : [0];
      for (const u of us) c.window(u, y, 1.1, 1.35, 'res', trim, { cross: true });
    }
    if (s === 0) {
      c.door(doorX, 1.0, 2.2, hx(['#2d3e5c', '#7a2e2a', '#2f4f3e', '#3a3d42'][Math.floor(c.r(7) * 4)]), trim, 0.3);
      // the garage door
      if (!c.cut) {
        g.box(garageX, 0.3, 0.02, 2.8, 2.2, 0.06, trim, 0, false);
        g.box(garageX, 0.32, 0.06, 2.6, 2.1, 0.04, hx('#e8e4dc'), 0, false);
        for (let k = 1; k < 4; k++) g.box(garageX, 0.32 + k * 0.52, 0.09, 2.6, 0.03, 0.02, hx('#c9c4b8'), 0, false);
      }
    }
  });
  // a covered entry
  if (!c.cut) {
    g.box(doorX, 0, front + 0.6, 2.0, 0.3, 1.2, hx('#c8c1b4'));
    for (const sx of [-0.9, 0.9]) g.box(doorX + sx, 0.3, front + 1.1, 0.16, 2.4, 0.16, trim);
    gableRoof(c, doorX, 2.7, front + 0.6, 2.2, 1.4, 0.7, roofC, wallC, 0.15, true);
    c.warm.box(doorX + 0.7, 2.15, front + 0.08, 0.16, 0.24, 0.12, GLOW_BULB);
  }
}

// ================================================================= stores

/**
 * A store: full-width glazing behind slim frames on the front (and round the corner), a fascia or a
 * canopy with the name, side walls of brick, render or panels, an upper floor of offices or flats.
 */
export function store(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  const bw = b.w - 0.6, bd = b.d - 1.0, cz = -0.3, H = fl * FH + (fl === 1 ? 1.0 : 0.3);
  const r = (k: number) => c.r(900 + k);
  const variant = Math.floor(r(1) * 3); // 0 fascia, 1 canopy, 2 brick base with black frames
  const wallC = variant === 2 ? c.pick(P.bricks, 902) : hx(['#e8e4dc', '#3a3d42', '#d9dcdc', '#c8c1b4', '#f2f0ea', '#5d6670'][Math.floor(r(3) * 6)]);
  const frame = variant === 2 || r(4) < 0.5 ? hx('#26292d') : hx('#b9bec2');
  const front = cz + bd / 2;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FH, floors: fl, floor: C.tile };
  lotGround(c, 'paved');
  const near = c.near && !c.cut;
  // the body: walls drawn face by face so the front can be glass (the shop seen inside, close up)
  if (c.cut) c.ghost.box(0, 0, cz, bw, H, bd, wallC);
  else shell(g, 0, cz, bw, H, bd, wallC, !near);
  const doorX = r(5) < 0.5 ? 0 : (r(6) < 0.5 ? -1 : 1) * bw * 0.28;
  c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 0) {
      // the shop window: glass from the plinth to the fascia, a glass door
      const gx0 = -len / 2 + 0.35, gx1 = len / 2 - 0.35;
      if (near) {
        c.t.push(0, 0, 0.04, 0);
        glazing(c, gx0, doorX - 0.8, 0.35, 2.75, 0.02, frame, true);
        glazing(c, doorX + 0.8, gx1, 0.35, 2.75, 0.02, frame, true);
        c.t.pop();
      } else {
        glazing(c, gx0, doorX - 0.8, 0.35, 2.75, 0.06, frame, false);
        glazing(c, doorX + 0.8, gx1, 0.35, 2.75, 0.06, frame, false);
      }
      c.door(doorX, 1.4, 2.6, frame, frame, 0.05, true);
      // the fascia band (or a canopy) with the name in lit letters
      const sw = Math.min(len - 1.4, 8.5);
      if (variant === 1) {
        g.box(0, 2.9, 0.75, len + 0.4, 0.22, 1.5, frame, 0, true);
        for (let k = 0; k < 4; k++) c.warm.box(-len / 2 + (k + 0.5) * (len / 4), 2.87, 0.9, 0.16, 0.03, 0.16, GLOW_BULB);
        c.sign(c.look.firmName, 0, 3.2, sw, 0.62, 0.05, null);
      } else {
        g.box(0, 2.85, 0.02, len, 0.9, 0.14, variant === 2 ? hx('#26292d') : shade(wallC, 0.85), 0, false);
        c.sign(c.look.firmName, 0, 2.97, sw, 0.62, 0.12, null);
      }
      for (let f = 1; f < fl; f++) {
        // upper floor: a ribbon of windows
        c.t.push(0, f * FH, 0, 0);
        for (let k = 0; k < 4; k++) c.window(-len / 2 + (k + 0.5) * (len / 4), 0.9, len / 4 - 0.6, 1.5, 'off', frame, { sill: false, use: 0.6 });
        c.t.pop();
      }
    } else if (s === 1 || s === 3) {
      // round the corner: one more window
      c.window(s === 1 ? -len / 2 + 1.7 : len / 2 - 1.7, 0.6, 2.2, 2.0, 'shop', frame, { sill: false });
      for (let f = 1; f < fl; f++) { c.t.push(0, f * FH, 0, 0); c.window(0, 0.9, 1.2, 1.4, 'off', frame, { sill: false, use: 0.6 }); c.t.pop(); }
    } else c.door(len / 4, 1.0, 2.1, C.dark, C.dark);
  });
  if (!c.cut) {
    g.box(0, H, cz, bw + 0.08, 0.1, bd + 0.08, shade(wallC, 0.8), 0, false);
    g.box(0, H - 0.02, cz, bw - 0.4, 0.05, bd - 0.4, hx('#8d8f92'), 0, false);
    g.box(bw * 0.2, H, cz - bd * 0.2, 1.6, 1.0, 1.4, C.steel);
  }
  if (near) {
    c.t.push(0, 0, cz + 0.35, 0);
    shopRoom(c, bw - 0.3, bd - 0.8, stationsOf(b).map((s) => ({ ...s, lz: s.lz - (cz + 0.35) })), C.tile, hx('#f2f0ea'));
    c.t.pop();
  }
  // yard: parking in front on big lots, a bench and a planter, a dumpster behind
  const fy = c.ld / 2 - front;
  if (fy > 6.5) parking(c, 0, front + 1.6 + (fy - 1.6) / 2, Math.floor((c.lw - 4) / 2.6), 0, 0.5);
  else if (c.ld / 2 + cz - bd / 2 > 5.5) parking(c, 0, (cz - bd / 2 - c.ld / 2) / 2, Math.floor((c.lw - 2) / 2.6), Math.PI, 0.4);
  if (fy > 2.2) {
    bench(c, doorX < 0 ? bw / 2 - 1.8 : -bw / 2 + 1.8, front + 1.6, 0);
    planter(c, doorX < 0 ? bw / 2 - 3.6 : -bw / 2 + 3.6, front + 1.6, 1.2, 0.7, false, 3);
  }
  const by = c.ld / 2 + cz - bd / 2;
  if (by > 2) g.box(bw / 2 - 1.6, 0.05, cz - bd / 2 - 1.1, 1.8, 1.2, 1.1, hx('#3f6b4a'));
  if (c.near) {
    if (!c.cut) roofClutter(c, 0, cz, bw, bd, H + 0.08, [[bw * 0.2, cz - bd * 0.2, 0.8, 0.7]], 3, { ac: 1, vents: 2 });
    if (fy > 1.4) streetBits(c, doorX + 1.4, front + 0.9, 0, 5, ['board']);
    if (by > 2) streetBits(c, -bw / 2 + 0.8, cz - bd / 2 - 0.9, Math.PI, 6, ['bins']);
  }
}

/**
 * A restaurant: floor-to-ceiling windows, a flat roof with a timber or black fascia carrying the
 * name, a terrace out front with umbrellas or a pergola, string lights.
 */
export function restaurant(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const bw = b.w - 0.6, bd = b.d - 0.8, cz = 0, H = 3.8;
  const r = (k: number) => c.r(950 + k);
  const wallC = hx(['#e8e4dc', '#3a3d42', '#c86a4a', '#d9cfbd', '#2f4f3e', '#f2f0ea'][Math.floor(r(1) * 6)]);
  const wood = hx(WOOD_C[Math.floor(r(2) * WOOD_C.length)]);
  const frame = hx('#26292d');
  const front = cz + bd / 2, fy = c.ld / 2 - front;
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FLOOR_H, floors: 1, floor: C.floorWood };
  lotGround(c, 'paved');
  const near = c.near && !c.cut;
  if (fy > 1) g.box(0, 0.05, front + (fy - 1.2) / 2, bw, 0.03, fy - 1.2, r(3) < 0.5 ? hx('#c98c66') : hx('#a89a88'), 0, false);
  if (c.cut) c.ghost.box(0, 0, cz, bw, H, bd, wallC);
  else shell(g, 0, cz, bw, H, bd, wallC, !near);
  const doorX = (r(6) < 0.5 ? -1 : 1) * bw * 0.3;
  c.sides(0, cz, bw, bd, (s, len) => {
    if (s === 0) {
      if (near) {
        c.t.push(0, 0, 0.04, 0);
        glazing(c, -len / 2 + 0.35, doorX - 0.75, 0.25, 2.9, 0.02, frame, true);
        glazing(c, doorX + 0.75, len / 2 - 0.35, 0.25, 2.9, 0.02, frame, true);
        c.t.pop();
      } else {
        glazing(c, -len / 2 + 0.35, doorX - 0.75, 0.25, 2.9, 0.06, frame, false);
        glazing(c, doorX + 0.75, len / 2 - 0.35, 0.25, 2.9, 0.06, frame, false);
      }
      c.door(doorX, 1.3, 2.6, wood, frame, 0.0, true);
      // the fascia with the name
      g.box(0, 3.0, 0.03, len + 0.2, 0.8, 0.22, r(4) < 0.5 ? wood : frame, 0, false);
      c.sign(c.look.firmName, 0, 3.07, Math.min(len - 2.4, 6.5), 0.62, 0.24, null);
      c.warm.box(doorX - 0.95, 2.2, 0.12, 0.16, 0.26, 0.14, GLOW_BULB);
      c.warm.box(doorX + 0.95, 2.2, 0.12, 0.16, 0.26, 0.14, GLOW_BULB);
    } else if (s === 2) {
      c.door(-len / 4, 1.0, 2.1, C.dark, C.dark);
      if (!c.cut) g.box(len / 4, 2.6, 0.3, 1.2, 0.6, 0.6, C.steel);
    } else {
      for (const u of [-len / 4, len / 4]) c.window(u, 0.8, 1.6, 1.8, 'shop', frame, { sill: false });
    }
  });
  if (!c.cut) {
    g.box(0, H, cz, bw + 0.3, 0.15, bd + 0.3, frame, 0, true);
    g.cyl(bw * 0.3, H + 0.15, cz - bd * 0.25, 0.25, 0.25, 2.0, 7, C.steel);
    g.box(-bw * 0.25, H + 0.15, cz - bd * 0.2, 1.4, 0.9, 1.2, C.steel);
  }
  if (near) shopRoom(c, bw - 0.3, bd - 0.3, stationsOf(b), C.floorWood, mix(wallC, C.white, 0.6));
  // the terrace: tables with umbrellas, or under a pergola; planters at the edge; string lights
  if (fy > 3) {
    const pergola = r(7) < 0.4;
    const n = Math.max(1, Math.min(4, Math.floor((bw - 1) / 3.2)));
    const tz = front + Math.min(fy - 1.6, 2.2);
    if (pergola) {
      for (const sx of [-1, 1]) for (const z of [front + 0.3, tz + 1.0]) g.box(sx * (bw / 2 - 0.4), 0.05, z, 0.18, 2.9, 0.18, wood);
      for (let k = 0; k < 9; k++) g.box(-bw / 2 + 0.5 + k * ((bw - 1) / 8), 2.95, (front + tz + 1.0) / 2, 0.1, 0.18, tz + 1.0 - front, wood);
    }
    for (let i = 0; i < n; i++) {
      const tx = -bw / 2 + 1.8 + (i / Math.max(1, n - 1)) * (bw - 3.6) * (n > 1 ? 1 : 0);
      if (Math.abs(tx - doorX) < 1.2) continue;
      g.cyl(tx, 0.05, tz, 0.06, 0.06, 0.72, 5, C.iron);
      g.cyl(tx, 0.75, tz, 0.5, 0.5, 0.05, 10, C.white);
      for (const sx of [-0.75, 0.75]) {
        if (c.near) c.props.add('chairBistro', c.t, tx + sx, 0.05, tz, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 1, 1, 1, c.brandDark);
        else g.box(tx + sx, 0.05, tz, 0.42, 0.45, 0.42, C.iron, 0, false);
      }
      if (!pergola) {
        g.cyl(tx, 0.8, tz, 0.04, 0.04, 1.6, 4, C.woodLight);
        const uc = i % 2 ? C.white : c.brand;
        g.cyl(tx, 2.2, tz, 1.25, 0.05, 0.5, 8, uc, 0.2, true, shade(uc, 0.7));
      }
      if (c.near) cafeSetting(c, tx, 0.8, tz, i);
    }
    planter(c, -bw / 2 + 0.6, c.ld / 2 - 1.0, 1.0, 0.6, false, 5);
    planter(c, bw / 2 - 0.6, c.ld / 2 - 1.0, 1.0, 0.6, false, 6);
    if (r(8) < 0.7) {
      for (const sx of [-1, 1]) g.cyl(sx * (bw / 2 - 0.3), 0.05, c.ld / 2 - 1.6, 0.05, 0.05, 2.9, 4, C.iron);
      const lz = c.ld / 2 - 1.6;
      for (let k = 0; k < 9; k++) {
        const t = k / 8, x = lerp(-bw / 2 + 0.3, bw / 2 - 0.3, t), sag = Math.sin(t * Math.PI) * 0.5;
        c.glow.box(x, 2.8 - sag, lz, 0.12, 0.14, 0.12, GLOW_BULB);
        if (k < 8) {
          const t2 = (k + 1) / 8, x2 = lerp(-bw / 2 + 0.3, bw / 2 - 0.3, t2), sag2 = Math.sin(t2 * Math.PI) * 0.5;
          g.beam(x, 2.95 - sag, lz, x2, 2.95 - sag2, lz, 0.025, C.iron);
        }
      }
    }
  }
  if (c.near) {
    if (fy > 1.2) streetBits(c, doorX + (doorX < 0 ? 1.2 : -1.6), front + 0.8, 0, 7, ['board']);
    if (!c.cut) roofClutter(c, 0, cz, bw, bd, H + 0.15, [[bw * 0.3, cz - bd * 0.25, 0.4, 0.4], [-bw * 0.25, cz - bd * 0.2, 0.8, 0.7]], 4, { vents: 2, ac: 1 });
  }
}
