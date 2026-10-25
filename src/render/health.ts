// Health care buildings: the clinic (a doctors' practice) and the hospital.
//
// Clinic: a small modern practice, one or two storeys of white render with a
// timber-clad entrance bay, big windows with blinds, a deep canopy over the
// door with the practice's sign (its name beside a heart pictogram), a ramp,
// a couple of parking spaces with an accessible one.
//
// Hospital: a multi-storey block on a podium. The main entrance has a glazed
// lobby under a canopy with the hospital's name; the emergency department has
// a drive-in ambulance bay cut into the front-left corner of the ground floor
// (ambulances, models drawn by the field renderer, park there: see
// ambulanceSpots), with a red EMERGENCY band over it. Blue "H" signs mark the
// building on its roof and at the bay. (No red cross anywhere: it's a
// protected emblem.)

import { Color3 } from '@babylonjs/core';
import { FLOOR_H } from '../sim/layout';
import type { Building } from '../sim/types';
import { C, GLOW_BULB, WS, hx, shade } from './buildingGeo';
import { Ctx, GLASS_SHOP, bench, lamp, lotGround, parking, planter, tree } from './buildingCtx';

const FH = FLOOR_H;

/** The hospital's ambulance bay (front-left corner of the ground floor), in the building's local frame. */
function bayOf(w: number, d: number): { x0: number; x1: number; z0: number; z1: number } {
  const W = w - 0.8, D = d - 0.8;
  const bw = Math.min(9, W * 0.3), bd = Math.min(8, D * 0.38);
  return { x0: -W / 2, x1: -W / 2 + bw, z0: D / 2 - bd, z1: D / 2 };
}

/** Where ambulances stand at a hospital (local x, z, yaw: nose toward the street), one or two by its size. */
export function ambulanceSpots(b: Pick<Building, 'w' | 'd' | 'floors'>): { x: number; z: number; yaw: number }[] {
  const bay = bayOf(b.w, b.d);
  const cz = (bay.z0 + bay.z1) / 2 + 0.3;
  if (bay.x1 - bay.x0 < 7) return [{ x: (bay.x0 + bay.x1) / 2, z: cz, yaw: 0 }];
  return [{ x: bay.x0 + (bay.x1 - bay.x0) * 0.3, z: cz, yaw: 0 }, { x: bay.x0 + (bay.x1 - bay.x0) * 0.72, z: cz, yaw: 0 }];
}

/** A row of windows along the current wall frame (ribbon panes with mullions) between y0 and y1. */
function ribbon(c: Ctx, len: number, y0: number, y1: number, bay: number, kind: 'off' | 'res' | 'lobby', frame: Color3, skip?: (u: number) => boolean): void {
  const g = c.solid;
  const n = Math.max(1, Math.round(len / bay));
  const w = len / n;
  for (let k = 0; k < n; k++) {
    const x0 = -len / 2 + k * w;
    if (skip?.(x0 + w / 2)) continue;
    c.pane(x0 + 0.06, y0, x0 + w - 0.06, y1, 0.03, kind);
    g.box(x0, y0, 0.04, 0.08, y1 - y0, 0.06, frame, 0, false);
  }
  g.box(len / 2, y0, 0.04, 0.08, y1 - y0, 0.06, frame, 0, false);
}

// ================================================================ clinic

export function clinic(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const F = Math.max(1, b.floors);
  const W = b.w - 1.2, D = b.d - 1.6, cz = -0.3, front = cz + D / 2, H = F * FH + 0.3;
  const render = hx(['#f4f3ef', '#eef0ee', '#f2efe8'][Math.floor(c.r(1) * 3)]);
  const wood = hx(['#b98a5e', '#a87a52', '#c49a66'][Math.floor(c.r(2) * 3)]);
  const frame = hx('#3a3f45');
  lotGround(c, 'paved');
  c.body = { cx: 0, cz, w: W, d: D, storey: FH, floors: F, floor: hx('#e6e2da'), base: 0.3 };
  g.box(0, 0, cz, W + 0.3, 0.3, D + 0.3, hx('#a9a59c'));
  c.wall.box(0, 0.3, cz, W, H - 0.3, D, render);
  // a flat roof with a thin overhanging edge
  if (!c.cut) {
    g.box(0, H, cz, W + 0.8, 0.28, D + 0.8, hx('#e9e7e2'), 0, true);
    g.box(0, H + 0.28, cz, W + 0.5, 0.05, D + 0.5, hx('#8d8f92'), 0, false);
  }
  // the timber-clad entrance bay on the right, windows with blinds elsewhere
  const doorX = W / 2 - 2.2;
  c.sides(0, cz, W, D, (s, len) => {
    for (let f = 0; f < F; f++) {
      const y = 0.3 + f * FH;
      const n = Math.max(1, Math.floor(len / 2.6));
      for (let k = 0; k < n; k++) {
        const u = -len / 2 + (k + 0.5) * (len / n);
        if (s === 0 && f === 0 && u > doorX - 2.4) continue;
        c.window(u, y + 0.75, 1.8, 1.6, 'off', frame, { sill: false });
      }
    }
    if (s === 0) {
      if (!c.cut) for (let x = doorX - 2.2; x < len / 2 - 0.05; x += 0.25) g.box(x + 0.1, 0.3, 0.03, 0.16, H - 0.3, 0.05, shade(wood, 0.9 + (Math.round(x * 4) % 3) * 0.06), 0, false);
      c.door(doorX, 1.8, 2.3, frame, frame, 0.3, true);
      c.lit(WS.lobby).quad(doorX - 2.0, 0.4, 0.06, doorX - 1.0, 0.4, 0.06, doorX - 1.0, 2.6, 0.06, doorX - 2.0, 2.6, 0.06, GLASS_SHOP, 0, 0, 1);
    }
  });
  // canopy over the door with the practice's sign along its front edge
  const sw = Math.min(5.5, W * 0.45);
  if (!c.cut) {
    g.box(doorX - 0.6, 2.85, front + 1.2, sw, 0.25, 2.4, hx('#e9e7e2'), 0, true);
    for (const sx of [-sw / 2 + 0.2, sw / 2 - 0.2]) g.box(doorX - 0.6 + sx, 0.3, front + 2.25, 0.12, 2.55, 0.12, frame);
    c.warm.box(doorX, 2.8, front + 1.2, 1.2, 0.04, 0.5, GLOW_BULB);
    // a ramp and the steps
    g.box(doorX - 2.6, 0.05, front + 1.2, 1.5, 0.25, 2.4, hx('#c8c1b4'));
  }
  c.t.push(doorX - 0.6, 0, front + 2.42, 0);
  c.sign(c.look.firmName ?? 'Clinic', 0, 2.88, sw - 0.3, 0.6, 0.02, null, 'medical');
  c.t.pop();
  // a free-standing sign by the path for passers-by
  if (c.ld / 2 - front > 3.2) {
    const px = -W / 2 + 1.2, pz = c.ld / 2 - 1.2;
    g.box(px, 0.05, pz, 0.2, 1.4, 0.2, frame);
    c.t.push(px, 0, pz, 0);
    g.box(0, 1.4, 0, 2.4, 0.8, 0.12, hx('#f7f8f6'));
    c.sign(c.look.firmName ?? 'Clinic', 0, 1.45, 2.2, 0.7, 0.07, null, 'medical');
    c.t.pop();
    planter(c, -W / 2 + 3.6, pz, 1.6, 0.9, false, 3);
  }
  // parking behind (an accessible space with its blue marking)
  const by = c.ld / 2 + cz - D / 2;
  if (by > 5.5) {
    parking(c, 0, -D / 2 + cz - by / 2, Math.floor((c.lw - 2) / 2.6), Math.PI, 0.5);
    g.box(-c.lw / 2 + 2.5, 0.07, -D / 2 + cz - by / 2, 1.4, 0.01, 1.4, hx('#2b5fa8'), 0, false);
  }
  tree(c, W / 2 + Math.min(1.8, (c.lw - W) / 2 - 0.4), -D / 2 + 1.5, 0.9, 1, 0.05, 'leafy');
  if (c.near) bench(c, -W / 2 + 1.5, front + 1.6, Math.PI, 1.6);
}

// ============================================================== hospital

export function hospital(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const F = Math.max(2, b.floors);
  const W = b.w - 0.8, D = b.d - 0.8, H = F * FH;
  const wall = hx(['#eef0f0', '#f2f1ec', '#e9eef0'][Math.floor(c.r(1) * 3)]);
  const accent = hx(['#2f7f9a', '#3a6ea8', '#2c8a7a'][Math.floor(c.r(2) * 3)]);
  const frame = hx('#4a5058');
  const bay = bayOf(b.w, b.d);
  lotGround(c, 'paved');
  c.body = { cx: 0, cz: 0, w: W, d: D, storey: FH, floors: F, floor: C.tile, base: 0.2 };
  // ground floor (around the ambulance bay), the upper floors over all of it
  g.box(0, 0, 0, W + 0.3, 0.2, D + 0.3, hx('#a9a59c'));
  c.wall.box((bay.x1 + W / 2) / 2, 0.2, 0, W / 2 - bay.x1, FH - 0.2, D, shade(wall, 0.96));
  c.wall.box((bay.x0 + bay.x1) / 2, 0.2, (bay.z0 - D / 2) / 2, bay.x1 - bay.x0, FH - 0.2, bay.z0 + D / 2, shade(wall, 0.96));
  c.wall.box(0, FH, 0, W, H - FH, D, wall, 0, true);
  if (!c.cut) {
    // floor bands in the hospital's color, ribbon windows on every upper floor
    c.sides(0, 0, W, D, (_s, len) => {
      for (let f = 1; f < F; f++) {
        const y = f * FH;
        g.box(0, y - 0.05, 0.02, len, 0.3, 0.05, accent, 0, false);
        ribbon(c, len - 0.6, y + 0.85, y + 2.6, 1.6, 'off', frame);
      }
    });
    // the bay: dark ceiling with lights, a pillar at its open corner
    g.box(bay.x1 - 0.3, 0.2, bay.z1 - 0.3, 0.5, FH - 0.2, 0.5, shade(wall, 0.9));
    for (let k = 0; k < 2; k++) c.warm.box(bay.x0 + (bay.x1 - bay.x0) * (0.3 + k * 0.42), FH - 0.08, (bay.z0 + bay.z1) / 2, 1.4, 0.05, 0.4, GLOW_BULB);
    g.quad(bay.x0 + 0.05, 0.21, bay.z0 + 0.01, bay.x1, 0.21, bay.z0 + 0.01, bay.x1, FH - 0.1, bay.z0 + 0.01, bay.x0 + 0.05, FH - 0.1, bay.z0 + 0.01, hx('#d9dcdc'), 0, 0, 1);
    // sliding doors into the emergency room at the back of the bay
    c.lit(WS.lobby).quad((bay.x0 + bay.x1) / 2 - 1.2, 0.25, bay.z0 + 0.03, (bay.x0 + bay.x1) / 2 + 1.2, 0.25, bay.z0 + 0.03, (bay.x0 + bay.x1) / 2 + 1.2, 2.6, bay.z0 + 0.03, (bay.x0 + bay.x1) / 2 - 1.2, 2.6, bay.z0 + 0.03, GLASS_SHOP, 0, 0, 1);
    // yellow bay markings on the paving
    for (const x of [bay.x0 + 0.3, bay.x1 - 0.6]) g.box(x, 0.21, (bay.z0 + bay.z1) / 2, 0.12, 0.01, bay.z1 - bay.z0 - 0.6, C.yellow, 0, false);
  }
  // the bay's EMERGENCY band and a small H beside it
  c.t.push((bay.x0 + bay.x1) / 2, 0, bay.z1 + 0.12, 0);
  c.sign('Emergency', -0.6, FH + 0.15, Math.min(6, bay.x1 - bay.x0 - 1.8), 0.7, 0.02, null, 'emergency');
  c.sign('H', (bay.x1 - bay.x0) / 2 - 0.7, FH + 0.05, 0.9, 0.9, 0.02, null, 'hospital');
  c.t.pop();
  // the main entrance: a glazed lobby across the middle of the front, a canopy with the name
  const ex = (bay.x1 + W / 2) / 2, ew = Math.min(12, W / 2 - bay.x1 - 2);
  c.t.push(0, 0, D / 2, 0);
  if (!c.cut) {
    for (let k = 0; k < Math.round(ew / 1.5); k++) {
      const x0 = ex - ew / 2 + k * (ew / Math.round(ew / 1.5));
      c.lit(WS.lobby).quad(x0 + 0.05, 0.25, 0.04, x0 + ew / Math.round(ew / 1.5) - 0.05, 0.25, 0.04, x0 + ew / Math.round(ew / 1.5) - 0.05, FH - 0.3, 0.04, x0 + 0.05, FH - 0.3, 0.04, GLASS_SHOP, 0, 0, 1);
      g.box(x0, 0.2, 0.05, 0.08, FH - 0.4, 0.06, frame, 0, false);
    }
    c.door(ex, 2.4, 2.6, frame, frame, 0.2, true);
    g.box(ex, FH - 0.2, 1.6, ew + 1.0, 0.3, 3.2, hx('#e9e7e2'), 0, true);
    for (const sx of [-1, 1]) g.box(ex + sx * (ew / 2 + 0.2), 0.2, 3.0, 0.25, FH - 0.4, 0.25, frame);
    c.warm.box(ex, FH - 0.24, 1.6, ew, 0.04, 2.6, GLOW_BULB);
    // windows on the rest of the ground floor front
    ribbon(c, W / 2 - (ex + ew / 2) - 0.8, 0.9, 2.6, 1.6, 'off', frame);
  }
  c.sign(c.look.firmName ?? 'Hospital', ex, FH + 0.15, Math.min(ew, 9), 0.75, 3.26, null);
  c.t.pop();
  // the roof: a parapet, a plant room, the big H sign facing the street
  if (!c.cut) {
    g.box(0, H, 0, W + 0.2, 0.9, D + 0.2, shade(wall, 0.92), 0, false);
    g.box(0, H, 0, W - 0.4, 0.15, D - 0.4, hx('#8d8f92'), 0, false);
    g.box(W * 0.2, H, -D * 0.15, W * 0.3, 3.0, D * 0.35, shade(wall, 0.85));
    for (let k = 0; k < 3; k++) g.cyl(-W * 0.25 + k * 2.2, H + 0.15, -D * 0.2, 0.7, 0.7, 1.1, 8, C.steel);
    // the H on its frame at the roof edge
    g.box(0, H + 0.9, D / 2 - 0.6, 0.15, 3.4, 0.15, C.iron);
    g.box(0, H + 1.1, D / 2 - 0.5, 3.4, 3.4, 0.2, hx('#1a4f90'));
  }
  c.t.push(0, 0, D / 2 - 0.39, 0);
  c.sign('H', 0, H + 1.25, 3.1, 3.1, 0.02, null, 'hospital');
  c.t.pop();
  // beds lit at night on the ward floors are part of the lit windows; a lamp, planters and benches out front
  const fy = c.ld / 2 - D / 2;
  if (fy > 2.4) {
    planter(c, W / 2 - 2, D / 2 + Math.min(1.6, fy - 0.8), 2.4, 1.0, true, 1);
    if (c.near) bench(c, W / 2 - 5, D / 2 + Math.min(1.6, fy - 0.8), Math.PI, 1.8);
  }
  lamp(c, W / 2 + 0.2, c.ld / 2 - 0.6, 4.6, Math.PI);
}
