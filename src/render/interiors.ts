// Interiors of opened-up buildings: floor slabs, the furniture at every
// station of the layout (desks, counters, stoves, tables, machines, shelves,
// beds, sofas), and per-kind extras (flat partitions, kitchenettes, an office
// core, depot racks). Close to the camera the stations are furnished with the
// detailed props of propsInterior.ts instead. Towers furnish one floor at a
// time (`furnish`), shops and office suites in their own frame.

import { Color3 } from '@babylonjs/core';
import { BUILDINGS } from '../sim/goods';
import { FLOOR_H, stationsOf, type Station } from '../sim/layout';
import { hash2 } from '../sim/rng';
import type { BuildingKind } from '../sim/types';
import { C, GLOW_ORANGE, GLOW_SCREEN, Geo, P, TAU, hx, shade } from './buildingGeo';
import { Ctx, barrel, car, crate } from './buildingCtx';
import { needsDetail, roomDetail, stationDetail } from './propsInterior';

function chair(g: Geo, z: number, col: Color3, office = false): void {
  if (office) {
    g.cyl(0, 0.0, z, 0.3, 0.3, 0.06, 5, C.dark);
    g.cyl(0, 0.06, z, 0.04, 0.04, 0.38, 4, C.dark);
    g.box(0, 0.44, z, 0.5, 0.08, 0.48, col);
    g.box(0, 0.52, z - 0.24, 0.48, 0.55, 0.07, col);
    return;
  }
  for (const [sx, sz] of [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]]) g.box(sx, 0, z + sz, 0.05, 0.44, 0.05, col, 0, false);
  g.box(0, 0.44, z, 0.46, 0.05, 0.46, col);
  g.box(0, 0.49, z - 0.21, 0.46, 0.5, 0.05, col);
}

const OFFICE_LIKE = new Set<BuildingKind>(['office', 'dealer', 'bank', 'netco', 'adco', 'studio', 'suite']);

/** Simple furniture for one station (station frame: the person at the origin facing +Z). */
function furniture(c: Ctx, s: Station, i: number, tables: Set<string>): void {
  const g = c.solid;
  const kind = c.b.kind;
  switch (s.kind) {
    case 'desk': {
      const office = OFFICE_LIKE.has(kind);
      const top = office ? hx('#dcd7cb') : C.woodLight;
      g.box(0, 0.7, 0.62, 1.4, 0.05, 0.7, top);
      for (const sx of [-0.66, 0.66]) g.box(sx, 0, 0.62, 0.05, 0.7, 0.66, office ? C.metal : C.wood, 0, false);
      g.box(0, 0.75, 0.86, 0.1, 0.14, 0.1, C.dark);
      g.box(0, 0.88, 0.88, 0.62, 0.38, 0.04, C.dark);
      c.screen.poly([-0.28, 0.9, 0.858, 0.28, 0.9, 0.858, 0.28, 1.24, 0.858, -0.28, 1.24, 0.858], GLOW_SCREEN, 0, 0, -1);
      g.box(0, 0.75, 0.5, 0.46, 0.02, 0.16, hx('#d0d0d0'));
      if (i % 3 === 0) g.cyl(0.55, 0.75, 0.75, 0.05, 0.05, 0.1, 6, C.white);
      if (i % 4 === 1) { g.cyl(-0.58, 0.75, 0.8, 0.09, 0.07, 0.16, 6, C.brickRed); g.blob(-0.58, 1.02, 0.8, 0.16, 0.16, 0.16, C.leaf, 5, 3); }
      chair(g, 0.05, office ? C.dark : C.wood, office);
      break;
    }
    case 'counter': {
      const col = OFFICE_LIKE.has(kind) || kind === 'tower' || kind === 'officetower' ? hx('#e6e2d8') : c.brand;
      g.box(0, 0, 0.65, 2.0, 1.0, 0.6, col);
      g.box(0, 1.0, 0.65, 2.06, 0.05, 0.68, C.white);
      g.box(0.45, 1.05, 0.6, 0.38, 0.12, 0.32, C.dark);
      c.screen.box(0.45, 1.17, 0.72, 0.32, 0.2, 0.04, OFFICE_LIKE.has(kind) ? GLOW_SCREEN : new Color3(0.5, 1.0, 0.6));
      if (kind === 'store') for (let k = 0; k < 3; k++) crate(c, -0.6 + k * 0.25, 1.05, 0.6, 0.18, P.goods[(i + k) % P.goods.length]);
      break;
    }
    case 'stove': {
      g.box(0, 0, 0.55, 0.9, 0.9, 0.7, C.steel);
      g.box(0, 0.9, 0.55, 0.9, 0.04, 0.7, C.dark);
      g.cyl(-0.2, 0.94, 0.45, 0.16, 0.16, 0.22, 8, C.steel);
      g.cyl(0.22, 0.94, 0.62, 0.18, 0.15, 0.1, 8, C.iron);
      c.glow.box(0.22, 0.91, 0.62, 0.3, 0.03, 0.3, GLOW_ORANGE);
      g.box(0, 1.9, 0.6, 1.0, 0.5, 0.8, C.steel);
      g.box(1.0, 0, 0.55, 1.0, 0.9, 0.7, C.white);
      g.box(1.0, 0.9, 0.55, 1.0, 0.04, 0.7, C.steel);
      break;
    }
    case 'table': {
      if (s.role === 'waiter') {
        g.box(0, 0, 0.55, 1.2, 0.95, 0.5, C.woodDark);
        for (let k = 0; k < 3; k++) g.cyl(-0.35 + k * 0.35, 0.95, 0.55, 0.13, 0.13, 0.04 + k * 0.02, 8, C.white);
        break;
      }
      chair(g, -0.05, C.woodDark);
      const tx = s.lx + Math.sin(s.facing) * 0.7, tz = s.lz + Math.cos(s.facing) * 0.7;
      const key = `${Math.round(tx * 2)}|${Math.round(tz * 2)}|${s.floor}`;
      if (!tables.has(key)) {
        tables.add(key);
        g.cyl(0, 0, 0.7, 0.07, 0.07, 0.72, 5, C.iron);
        g.cyl(0, 0, 0.7, 0.3, 0.3, 0.04, 6, C.iron);
        g.cyl(0, 0.72, 0.7, 0.5, 0.5, 0.04, 10, C.white);
        g.cyl(0, 0.76, 0.42, 0.13, 0.13, 0.015, 8, hx('#fbfbf8'));
        g.cyl(0, 0.76, 0.98, 0.13, 0.13, 0.015, 8, hx('#fbfbf8'));
        g.cyl(0.18, 0.76, 0.7, 0.04, 0.04, 0.14, 6, c.brand);
      }
      break;
    }
    case 'machine': {
      const mc: Partial<Record<BuildingKind, Color3>> = {
        sawmill: hx('#5f8a5a'), brickworks: hx('#8a6a52'), steelmill: hx('#5b5f66'), foodplant: hx('#c9ced3'), cementworks: hx('#9a9690'),
        glassworks: hx('#5f7f8f'), workshop: hx('#4f7a8a'), furniture: C.woodLight, textile: hx('#8a7a5a'), electronics: hx('#e8e8e4'), carplant: C.orange,
        adco: hx('#3a6ea5'),
      };
      const col = mc[kind] ?? hx('#6a7f8f');
      if (kind === 'carplant') {
        g.box(0, 0, 1.2, 0.8, 0.5, 0.8, C.dark);
        g.beam(0, 0.5, 1.2, 0.2, 1.8, 1.5, 0.3, col);
        g.beam(0.2, 1.8, 1.5, 0.7, 1.4, 2.2, 0.22, col);
        g.box(0.75, 1.15, 2.25, 0.2, 0.3, 0.2, C.dark);
        g.box(0, 0, 3.1, 6.0, 0.25, 1.6, C.dark);
        car(c, 0, 3.1, Math.PI / 2, P.cars[(i * 3 + 1) % P.cars.length], 0.25);
        break;
      }
      if (kind === 'textile') {
        g.box(0, 0, 1.0, 1.8, 0.9, 1.1, col);
        for (let k = 0; k < 4; k++) g.tube(-0.75 + k * 0.5, 1.1, 0.7, -0.75 + k * 0.5, 1.1, 1.3, 0.12, 6, P.fabrics[(i + k) % P.fabrics.length]);
        g.box(0, 0.9, 1.0, 1.8, 0.05, 0.3, C.white);
        break;
      }
      if (kind === 'electronics') {
        g.box(0, 0.75, 0.8, 1.6, 0.05, 0.8, C.white);
        for (const sx of [-0.7, 0.7]) g.box(sx, 0, 0.8, 0.06, 0.75, 0.7, C.steel, 0, false);
        g.box(0, 0.8, 1.05, 0.5, 0.35, 0.05, C.dark);
        c.screen.poly([-0.22, 0.83, 1.02, 0.22, 0.83, 1.02, 0.22, 1.12, 1.02, -0.22, 1.12, 1.02], GLOW_SCREEN, 0, 0, -1);
        for (let k = 0; k < 3; k++) g.box(-0.5 + k * 0.25, 0.8, 0.7, 0.18, 0.03, 0.12, hx('#2f7a3a'));
        chair(g, 0.05, hx('#3a6ea5'), true);
        break;
      }
      if (kind === 'adco') {
        // the installers' bench: a rolled-up poster, paste buckets, a cutting table
        g.box(0, 0.8, 1.0, 2.2, 0.06, 1.0, C.woodLight);
        for (const sx of [-1.0, 1.0]) g.box(sx, 0, 1.0, 0.08, 0.8, 0.9, C.metal, 0, false);
        g.tube(-0.8, 0.95, 0.8, 0.8, 0.95, 0.8, 0.09, 8, P.goods[i % P.goods.length]);
        g.box(0.3, 0.86, 1.2, 1.1, 0.01, 0.7, hx('#f4f1ea'));
        g.cyl(-1.4, 0, 0.6, 0.16, 0.15, 0.38, 8, C.white);
        break;
      }
      g.box(0, 0, 1.0, 1.6, 1.1, 1.2, col);
      g.box(0, 1.1, 1.0, 1.4, 0.06, 1.0, shade(col, 0.8));
      g.box(0.45, 1.16, 1.2, 0.4, 0.5, 0.4, shade(col, 0.85));
      g.box(-0.8, 0.7, 0.7, 0.04, 0.3, 0.3, C.dark);
      c.screen.box(-0.83, 0.85, 0.7, 0.02, 0.08, 0.08, kind === 'steelmill' || kind === 'glassworks' ? GLOW_ORANGE : new Color3(0.4, 1, 0.5));
      if (kind === 'sawmill' || kind === 'furniture') g.tube(-0.2, 1.3, 1.0, -0.2, 1.3, 1.05, 0.35, 12, C.steel);
      if (kind === 'steelmill' || kind === 'glassworks') c.glow.cyl(0, 1.16, 1.0, 0.35, 0.35, 0.05, 8, GLOW_ORANGE);
      crate(c, 1.2, 0, 1.2, 0.6, kind === 'brickworks' ? C.brickRed : C.woodLight);
      break;
    }
    case 'shelf': {
      const z = 0.85;
      for (const sx of [-1.2, 1.2]) g.box(sx, 0, z, 0.06, 1.9, 0.5, C.metal);
      g.box(0, 0, z - 0.24, 2.4, 1.9, 0.03, C.shelf, 0, false);
      for (let l = 0; l < 4; l++) {
        const y = 0.12 + l * 0.45;
        g.box(0, y, z, 2.36, 0.04, 0.5, C.shelf);
        let x = -1.1;
        let k = 0;
        while (x < 1.05) {
          const w = 0.22 + hash2(c.b.seed, 2000 + i * 50 + l * 10 + k) * 0.22;
          const h = 0.15 + hash2(c.b.seed, 2100 + i * 50 + l * 10 + k) * 0.22;
          if (x + w > 1.15) break;
          g.box(x + w / 2, y + 0.04, z, w - 0.03, h, 0.36, P.goods[Math.floor(hash2(c.b.seed, 2200 + i * 50 + l * 10 + k) * P.goods.length)], 0, false);
          x += w;
          k++;
        }
      }
      break;
    }
    case 'bed': {
      g.box(0, 0, 0, 1.5, 0.32, 2.1, C.wood);
      g.box(0, 0.32, 0.02, 1.4, 0.18, 2.0, hx('#f2efe8'));
      g.box(0, 0.48, 0.3, 1.44, 0.07, 1.4, P.fabrics[(i + Math.floor(c.r(2300) * 5)) % P.fabrics.length]);
      g.box(0, 0.5, -0.72, 1.1, 0.13, 0.36, C.white);
      g.box(0, 0, -1.07, 1.5, 0.95, 0.08, C.woodDark);
      g.box(1.05, 0, -0.8, 0.45, 0.5, 0.4, C.woodLight);
      c.glow.cyl(1.05, 0.5, -0.8, 0.1, 0.06, 0.25, 6, hx('#ffe9b0'));
      break;
    }
    case 'sofa': {
      const col = P.fabrics[(i * 2 + Math.floor(c.r(2310) * 7)) % P.fabrics.length];
      g.box(0, 0.0, 1.0, 2.6, 0.015, 1.9, shade(P.fabrics[(i + 3) % P.fabrics.length], 0.9), 0, false);
      g.box(0, 0.08, 0, 1.9, 0.34, 0.85, col);
      g.box(0, 0.08, -0.34, 1.9, 0.75, 0.2, shade(col, 0.9));
      for (const sx of [-0.88, 0.88]) g.box(sx, 0.08, 0, 0.16, 0.55, 0.85, shade(col, 0.9));
      g.box(0, 0, 1.0, 0.9, 0.4, 0.5, C.woodLight);
      g.box(0, 0, 2.0, 1.2, 0.5, 0.35, C.woodDark);
      g.box(0, 0.5, 2.05, 1.0, 0.6, 0.05, C.dark);
      c.screen.poly([-0.45, 0.53, 2.02, 0.45, 0.53, 2.02, 0.45, 1.07, 2.02, -0.45, 1.07, 2.02], GLOW_SCREEN, 0, 0, -1);
      break;
    }
    default:
      break;
  }
}

const SKIP = new Set(['stall', 'bench', 'showroom', 'bay', 'outdoor', 'field', 'site', 'spot']);

/**
 * Furnish stations (building-local frame of `c`): simple furniture, or the detailed props when
 * close up. `y(s)` = height of the floor surface the station is on.
 */
export function furnish(c: Ctx, stations: Station[], y: (s: Station) => number, tables = new Set<string>()): void {
  stations.forEach((s, i) => {
    if (s.outside || SKIP.has(s.kind)) return;
    c.t.push(s.lx, y(s), s.lz, s.facing);
    if (!((c.closeUp || needsDetail(s.kind)) && stationDetail(c, s, i, tables))) furniture(c, s, i, tables);
    c.t.pop();
  });
}

function planterIn(c: Ctx, x: number, y: number, z: number): void {
  c.solid.cyl(x, y, z, 0.25, 0.2, 0.45, 6, C.white);
  c.solid.blob(x, y + 0.75, z, 0.35, 0.4, 0.35, C.leaf, 5, 3);
}

/** Thin see-through partitions between the flats of a floor arranged in a ring around a core (apartments, towers). */
export function ringPartitions(c: Ctx, per: number, y: number, rx: number, rz: number, core: number): void {
  for (let u = 0; u < per; u++) {
    const a = (u / per) * TAU + 0.2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // from the core out to the facade (the ellipse through the plate's edges)
    const r0 = core * 0.75, r1 = 1 / Math.sqrt((ca * ca) / (rx * rx) + (sa * sa) / (rz * rz)) - 0.1;
    const len = r1 - r0;
    if (len < 0.5) continue;
    c.t.push(ca * (r0 + len / 2), y, sa * (r0 + len / 2), Math.PI / 2 - a);
    c.ghost.box(0, 0, 0, 0.12, FLOOR_H - 0.2, len, C.white);
    c.t.pop();
  }
  c.solid.box(0, y, 0, core, FLOOR_H - 0.2, core, hx('#a9a59c'));
}

/** The opened-up interior of a (non-tower) building: slabs, per-kind extras, furnished stations. */
export function interior(c: Ctx): void {
  const body = c.body;
  const g = c.solid;
  if (body) {
    for (let f = 0; f < body.floors; f++) {
      const top = f === 0 ? Math.max(0.15, body.base ?? 0.15) : f * body.storey + 0.15;
      const zc = f > 0 && body.upper ? body.upper.cz : body.cz, dd = f > 0 && body.upper ? body.upper.d : body.d;
      g.box(body.cx, top - 0.2, zc, body.w - 0.15, 0.2, dd - 0.15, f % 2 ? shade(body.floor, 0.95) : body.floor);
      if (f > 0) g.box(body.cx, top - 0.2, zc, body.w - 0.05, 0.08, dd - 0.05, C.dark, 0, false);
    }
  }
  const kind = c.b.kind;
  if (kind === 'apartments' && body) {
    const per = BUILDINGS.apartments.unitsPerFloor;
    for (let f = 0; f < body.floors; f++) ringPartitions(c, per, f * FLOOR_H + 0.15, body.w / 2, body.d / 2, 3.2);
  }
  if (kind === 'house' && body && !c.closeUp) {
    for (let f = 0; f < body.floors; f++) {
      const y = f === 0 ? body.base ?? 0.15 : f * FLOOR_H + 0.15;
      g.box(body.cx - body.w / 2 + 0.5, y, body.cz + body.d / 2 - 1.6, 0.6, 0.9, 2.2, C.white);
      g.box(body.cx - body.w / 2 + 0.5, y + 0.9, body.cz + body.d / 2 - 1.6, 0.62, 0.04, 2.22, C.stone);
    }
  }
  if (kind === 'office' && body) {
    for (let f = 0; f < body.floors; f++) {
      g.box(body.cx, f * FLOOR_H + 0.15, body.cz - body.d / 2 + 1.0, 2.6, FLOOR_H - 0.2, 1.4, hx('#9aa0a6'));
      if (f > 0) for (const sx of [-1, 1]) planterIn(c, sx * (body.w / 2 - 0.8), f * FLOOR_H + 0.15, body.cz + body.d / 2 - 0.8);
    }
  }
  if (kind === 'depot' && body) {
    for (let r = 0; r < 2; r++) {
      const z = body.cz - body.d / 2 + 1.2 + r * 2.6;
      for (let k = 0; k < 3; k++) {
        const x = -body.w / 2 + 2.5 + k * ((body.w - 5) / 2);
        for (let l = 0; l < 3; l++) g.box(x, 0.15 + l * 1.4, z, 3.2, 0.08, 1.0, C.orange);
        for (const sx of [-1.55, 1.55]) g.box(x + sx, 0.15, z, 0.08, 4.0, 1.0, hx('#3a6ea5'), 0, false);
        for (let l = 0; l < 3; l++) for (let m = 0; m < 2; m++) crate(c, x - 0.75 + m * 1.5, 0.23 + l * 1.4, z, 0.9, hx('#c9b48a'));
      }
    }
  }
  if (kind === 'trailer' && body) {
    // a kitchenette along one long side, a table by the window
    g.box(body.cx - body.w / 2 + 0.35, 0.75, body.cz + 0.5, 0.6, 0.9, 2.4, C.white);
    g.box(body.cx - body.w / 2 + 0.35, 1.65, body.cz + 0.5, 0.62, 0.04, 2.42, hx('#b9a27a'));
    barrel(c, body.cx + body.w / 2 - 0.5, body.cz + 1.6, hx('#8a6a4a'));
  }
  const storey = kind === 'apartments' || kind === 'house' || kind === 'office' ? FLOOR_H : body?.storey ?? FLOOR_H;
  furnish(c, stationsOf(c.b), (s) => (s.floor === 0 ? Math.max(0.15, body?.base ?? 0.15) : s.floor * storey + 0.15));
  if (c.closeUp) roomDetail(c);
}
