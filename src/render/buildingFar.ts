// Far level of detail for buildings: a few boxes, prisms and roof shapes per
// building with a tiling window texture (lit windows come from an emissive
// twin of the texture at night, scaled by the hour). Office towers get a
// curtain-wall texture (vacant floors a mostly dark twin), residential
// towers a balcony-band texture, crowns and spires a light strip glowing in
// its own color. Far buildings are merged into spatial chunks, so a whole
// district is a handful of draw calls instead of thousands.

import {
  Color3, DynamicTexture, FresnelParameters, Mesh, StandardMaterial, Texture, VertexData, type BaseTexture, type PickingInfo, type Scene,
} from '@babylonjs/core';
import { BUILDINGS } from '../sim/goods';
import { FLOOR_H } from '../sim/layout';
import { hash2 } from '../sim/rng';
import type { Building } from '../sim/types';
import { C, Geo, P, Xf, clamp01, hsl, hx, mix, shade } from './buildingGeo';
import type { BuildingLook, HostedUnit } from './buildingCtx';
import { hallLook } from './industry';
import { aptLook, officeLook } from './midrise';
import { isTowerKind, offsetOutline, outline, towerHeight, towerPlan, type TowerPlan } from './towers';

const rectPts = (w: number, d: number, cz: number): number[] => [-w / 2, cz + d / 2, w / 2, cz + d / 2, w / 2, cz - d / 2, -w / 2, cz - d / 2];

export type FarStyle = 'res' | 'off' | 'ind' | 'glass' | 'glassV' | 'tower' | 'lamp';
const STYLES: FarStyle[] = ['res', 'off', 'ind', 'glass', 'glassV', 'tower', 'lamp'];

interface Part { p: Float32Array; n: Float32Array; c: Float32Array; uv: Float32Array; i: Uint32Array; verts: number }
export interface FarModel { parts: Partial<Record<FarStyle, Part>> }

/** UV of a plain wall texel (no window, never lit): roofs, ground, props. */
const PU = 0.004;
const CELLS = 8; // window cells per texture side

// ------------------------------------------------------------ geometry

class FarWriter {
  t = new Xf();
  /** The lot's ground is drawn elsewhere (laid on the countryside's terrain, see fields.ts): no slab. */
  noGround = false;
  g: Record<FarStyle, Geo>;
  uOff: number;
  vOff: number;
  constructor(readonly b: Building) {
    this.g = { res: new Geo(this.t, true), off: new Geo(this.t, true), ind: new Geo(this.t, true), glass: new Geo(this.t, true), glassV: new Geo(this.t, true), tower: new Geo(this.t, true), lamp: new Geo(this.t, true) };
    const wear = clamp01(1 - b.condition) * (b.ruined ? 0.3 : 1);
    for (const s of STYLES) this.g[s].wear = wear;
    this.uOff = Math.floor(hash2(b.seed, 77) * CELLS);
    this.vOff = Math.floor(hash2(b.seed, 78) * CELLS);
  }

  /** Plain (windowless) polygon. */
  plain(pts: number[], col: Color3, hx_: number, hy: number, hz: number): void {
    const uv: number[] = [];
    for (let k = 0; k < pts.length / 3; k++) uv.push(PU, PU);
    this.g.res.poly(pts, col, hx_, hy, hz, uv);
  }

  /** Box with windowed walls (style) or plain walls (style null) and a flat top of color `top`. */
  box(cx: number, cz: number, w: number, d: number, y0: number, h: number, wall: Color3, top: Color3 | null, style: FarStyle | null, bay = 3, floorH = FLOOR_H, winFrom = 0): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const walls: [number, number, number, number, number, number][] = [
      [x0, z1, x1, z1, 0, 1], [x1, z1, x1, z0, 1, 0], [x1, z0, x0, z0, 0, -1], [x0, z0, x0, z1, -1, 0],
    ];
    let u = this.uOff;
    for (const [ax, az, bx, bz, nx, nz] of walls) {
      const len = Math.hypot(bx - ax, bz - az);
      const pts = [ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az];
      if (!style) { this.plain(pts, wall, nx, 0, nz); continue; }
      const g = this.g[style];
      // a plain band below the first window row (shop fronts, plinths)
      if (winFrom > 0.01) {
        g.poly([ax, y0, az, bx, y0, bz, bx, y0 + winFrom, bz, ax, y0 + winFrom, az], wall, nx, 0, nz, [PU, PU, PU, PU, PU, PU, PU, PU]);
      }
      const ya = y0 + winFrom;
      const u0 = u, u1 = u + Math.max(1, Math.round(len / bay));
      const v0 = this.vOff, v1 = this.vOff + (y1 - ya) / floorH;
      // u runs right-to-left as seen from outside (Babylon is left-handed)
      g.poly([ax, ya, az, bx, ya, bz, bx, y1, bz, ax, y1, az], wall, nx, 0, nz, [u1 / CELLS, v0 / CELLS, u0 / CELLS, v0 / CELLS, u0 / CELLS, v1 / CELLS, u1 / CELLS, v1 / CELLS]);
      u = u1;
    }
    if (top) this.plain([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], top, 0, 1, 0);
  }

  /** Gable roof, ridge along X (or Z), on a w x d base at height y. */
  gable(cx: number, cz: number, w: number, d: number, y: number, h: number, roofC: Color3, endC: Color3, alongZ = false, over = 0.35): void {
    if (alongZ) {
      this.t.push(cx, 0, cz, Math.PI / 2);
      this.gable(0, 0, d, w, y, h, roofC, endC, false, over);
      this.t.pop();
      return;
    }
    const ex = w / 2 + over * 0.5, ez = d / 2 + over;
    const drop = (over * h) / (d / 2);
    this.plain([cx - ex, y - drop, cz + ez, cx + ex, y - drop, cz + ez, cx + ex, y + h, cz, cx - ex, y + h, cz], roofC, 0, 1, 1);
    this.plain([cx + ex, y - drop, cz - ez, cx - ex, y - drop, cz - ez, cx - ex, y + h, cz, cx + ex, y + h, cz], shade(roofC, 0.92), 0, 1, -1);
    for (const sx of [-1, 1]) this.plain([cx + sx * w / 2, y, cz + d / 2, cx + sx * w / 2, y, cz - d / 2, cx + sx * w / 2, y + h, cz], endC, sx, 0, 0);
  }

  /** Hip roof (pyramid-ish). */
  hip(cx: number, cz: number, w: number, d: number, y: number, h: number, roofC: Color3, over = 0.35): void {
    const ex = w / 2 + over, ez = d / 2 + over, rx = Math.max(0, (w - d) / 2), rz = Math.max(0, (d - w) / 2);
    this.plain([cx - ex, y, cz + ez, cx + ex, y, cz + ez, cx + rx, y + h, cz + rz, cx - rx, y + h, cz + rz], roofC, 0, 1, 1);
    this.plain([cx + ex, y, cz - ez, cx - ex, y, cz - ez, cx - rx, y + h, cz - rz, cx + rx, y + h, cz - rz], shade(roofC, 0.92), 0, 1, -1);
    this.plain([cx + ex, y, cz + ez, cx + ex, y, cz - ez, cx + rx, y + h, cz - rz, cx + rx, y + h, cz + rz], shade(roofC, 0.96), 1, 1, 0);
    this.plain([cx - ex, y, cz - ez, cx - ex, y, cz + ez, cx - rx, y + h, cz + rz, cx - rx, y + h, cz - rz], shade(roofC, 0.96), -1, 1, 0);
  }

  /**
   * Windowed walls along a closed outline (tower-local x, z pairs) from y0 to y1. The texture's rows are
   * floors counted from the ground (so stacked bands line up), its columns bays of `bay` meters.
   */
  walls(pts: number[], y0: number, y1: number, wall: Color3, style: FarStyle, bay = 3, floorH = FLOOR_H): void {
    const g = this.g[style];
    const n = pts.length / 2;
    let u = this.uOff;
    const v0 = this.vOff + y0 / floorH, v1 = this.vOff + y1 / floorH;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const u1 = u + Math.max(1, Math.round(len / bay));
      g.poly([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], wall, -(bz - az), 0, bx - ax, [u1 / CELLS, v0 / CELLS, u / CELLS, v0 / CELLS, u / CELLS, v1 / CELLS, u1 / CELLS, v1 / CELLS]);
      u = u1;
    }
  }

  /** A plain prism over an outline (walls and a flat top). */
  prism(pts: number[], y0: number, y1: number, wall: Color3, top: Color3 | null): void {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
      this.plain([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], wall, -(bz - az), 0, bx - ax);
    }
    if (top) this.cap(pts, y1, top);
  }

  /** A flat polygon over an outline at height y. */
  cap(pts: number[], y: number, col: Color3, style: FarStyle = 'res'): void {
    const p3: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i < pts.length; i += 2) { p3.push(pts[i], y, pts[i + 1]); uv.push(PU, PU); }
    this.g[style].poly(p3, col, 0, 1, 0, uv);
  }

  /** A strip of light around an outline (crowns), glowing in its own color at night. */
  lampBand(pts: number[], y0: number, y1: number, col: Color3): void {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
      this.g.lamp.poly([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], col, -(bz - az), 0, bx - ax, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    }
  }

  /** Lot ground: a slab that reaches below the terrain on slopes. */
  ground(lw: number, ld: number, col: Color3): void {
    if (this.noGround) return;
    this.box(0, 0, lw - 0.1, ld - 0.1, -1.4, 1.45, shade(col, 0.85), col, null);
  }

  flat(cx: number, cz: number, w: number, d: number, y: number, col: Color3): void {
    this.plain([cx - w / 2, y, cz + d / 2, cx + w / 2, y, cz + d / 2, cx + w / 2, y, cz - d / 2, cx - w / 2, y, cz - d / 2], col, 0, 1, 0);
  }

  tree(x: number, z: number, s: number, k: number): void {
    const col = [C.leaf, C.leafDark, C.leafLight, C.conifer][Math.floor(hash2(this.b.seed, 310 + k) * 4)];
    this.box(x, z, 2.4 * s, 2.4 * s, 1.2 * s, 2.6 * s, col, shade(col, 1.1), null);
  }
}

// ------------------------------------------------------------ per kind


/** Build the far model of a building (world space). */
export function farModel(b: Building, look: BuildingLook, units: HostedUnit[] = [], occ = 1): FarModel {
  const f = new FarWriter(b);
  f.noGround = !!look.draped;
  f.t.push(b.x, look.ground, b.y, Math.PI / 2 - b.angle);
  const r = (k: number) => hash2(b.seed, k);
  const pick = <T>(arr: readonly T[], k: number): T => arr[Math.floor(r(k) * arr.length) % arr.length];
  const lw = Math.max(look.lotW || 0, b.w + 1), ld = Math.max(look.lotD || 0, b.d + 1);
  const brand = hsl(look.firmHue ?? hash2(b.seed, 991), 0.62, 0.48);
  const fl = Math.max(1, b.floors);
  const def = BUILDINGS[b.kind];
  const lawn = hsl(0.26 + r(60) * 0.04, 0.36, 0.42 + r(61) * 0.05);

  if (isTowerKind(b.kind)) {
    towerFar(f, b, look, units, occ, lw, ld);
    return finish(f);
  }
  if (b.host !== undefined && b.host >= 0) return finish(f); // shops and office floors: part of their tower
  if (b.ruined) {
    f.ground(lw, ld, C.dirt);
    f.box(0, 0, b.w - 1, b.d - 1, 0, 0.7, C.rubble, shade(C.rubble, 0.9), null);
    return finish(f);
  }
  if (!b.built) {
    f.ground(lw, ld, C.dirt);
    const p = clamp01(b.workDone / Math.max(1, b.workNeeded));
    const multi = def.category === 'home' || b.kind === 'office' || b.kind === 'store' || b.kind === 'textile' || b.kind === 'electronics' || b.kind === 'netco' || b.kind === 'studio' || b.kind === 'cityhall';
    const floors = multi ? fl : 1;
    const storey = multi ? FLOOR_H : def.category === 'industry' ? 5.5 : 4.0;
    const W = Math.max(3, b.w - 0.8), D = Math.max(3, b.d - 0.8);
    f.box(0, 0, W + 0.3, D + 0.3, 0, 0.35, C.concrete, C.concrete, null);
    if (p >= 0.03) f.box(0, 0, W, D, 0.35, Math.max(0.3, p * floors * storey - 0.35), hx('#b8a690'), C.concrete, 'ind', 1.8, storey);
    if (floors >= 3) {
      const H = floors * storey + 8;
      f.box(-W / 2 - 2.6, -D / 2 - 2.6, 1.5, 1.5, 0, H, C.yellow, C.yellow, null);
      f.t.push(-W / 2 - 2.6, 0, -D / 2 - 2.6, Math.PI * 0.25 + r(5) * 1.2);
      f.box(0, (Math.max(W, D) + 6) / 2 - 1, 1.0, Math.max(W, D) + 8, H, 0.5, C.yellow, C.yellow, null);
      f.t.pop();
    }
    return finish(f);
  }

  switch (b.kind) {
    case 'plaza': {
      f.ground(lw, ld, C.plaza);
      f.flat(0, 0, b.w - 2.4, b.d - 2.4, 0.11, hx('#e2d8c6'));
      f.box(0, -b.d / 2 + 0.5, 7, 0.3, 0, 3.4, C.stoneLight, C.stone, null);
      f.box(0, b.d / 2 - 6.8, 5.4, 5.4, 0, 0.6, C.stoneLight, C.water, null);
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) f.tree(sx * (b.w / 2 - 1.4), -b.d / 2 + 4 + k * ((b.d - 8) / 3), 0.8, k);
      break;
    }
    case 'park': {
      f.ground(lw, ld, lawn);
      const rx = (b.w - 2) / 3 - 1.3, rz = (b.d - 2) / 3 - 1.3;
      f.flat(0, 0, rx * 2 + 1.9, rz * 2 + 1.9, 0.07, hx('#cdbb98'));
      f.flat(0, 0, rx * 2 - 1.9, rz * 2 - 1.9, 0.075, lawn);
      if (r(1) < 0.5) f.flat(0, 0, (Math.min(rx, rz) - 2.2) * 1.8, (Math.min(rx, rz) - 2.2) * 1.4, 0.085, C.water);
      for (let k = 0; k < 10; k++) {
        const x = (r(100 + k) - 0.5) * (lw - 4), z = (r(200 + k) - 0.5) * (ld - 4);
        const e = Math.hypot(x / rx, z / rz);
        if (e > 0.72 && e < 1.32) continue;
        if (e < 0.85) continue;
        f.tree(x, z, 1.0 + r(300 + k) * 0.5, k);
      }
      break;
    }
    case 'trailer': {
      f.ground(lw, ld, lawn);
      const body = pick([hx('#f2efe6'), hx('#e8dcc4'), hx('#cfe0e3'), hx('#d9e4c8'), hx('#c9c4b8')], 1);
      f.box(0, 0, 4.4, 14.2, 0, 0.7, shade(body, 0.75), null, null);
      f.box(0, 0, 4.3, 14, 0.7, 2.5, body, null, 'res', 2.4, 2.6);
      f.gable(0, 0, 4.3, 14, 3.2, 0.35, hx('#b9bec2'), body, true, 0.15);
      break;
    }
    case 'house': {
      f.ground(lw, ld, lawn);
      const v = r(1), H = fl * FLOOR_H;
      if (v < 0.36) {
        // modern box: a rendered ground floor, an offset upper floor, flat roofs
        const bw = b.w - 1.4, bd = b.d - 2.2, cz = -0.6, flip = r(6) < 0.5 ? -1 : 1;
        const render = hx(['#f2f0ea', '#e8e2d4', '#dfe4e2', '#efe6d2', '#e6ded4', '#d9dcdc'][Math.floor(r(2) * 6)]);
        f.box(0, cz, bw, bd, 0, FLOOR_H, render, hx('#3a3d42'), 'res', 2.9);
        if (fl > 1) f.box(flip * bw * 0.11, cz + 0.45, bw * 0.78, bd + 0.9, FLOOR_H, FLOOR_H, r(3) < 0.5 ? hx('#a87a52') : hx('#3a3d42'), hx('#3a3d42'), 'res', 2.9);
      } else if (v < 0.68) {
        // modern farmhouse: light siding, a steep dark gable
        const bw = b.w - 1.6, bd = b.d - 2.4, cz = -0.5;
        const siding = hx(['#f2f0ea', '#e8e4dc', '#cfd6d8', '#3a3d42', '#d9cfbd', '#8e9aa0', '#c9d4c0', '#e6ded4'][Math.floor(r(2) * 8)]);
        const along = r(9) < 0.5;
        f.box(0, cz, bw, bd, 0, H, siding, null, 'res', 2.9);
        f.gable(0, cz, bw, bd, H, (along ? bd : bw) * 0.42, hx(['#2a2c30', '#3a3d42', '#4a4f55', '#5d4c3e'][Math.floor(r(3) * 4)]), siding, along, 0.3);
      } else {
        const bw = b.w - 1.4, bd = b.d - 2.2, cz = -0.6;
        const wc = r(13) < 0.3 ? pick(P.bricks, 14) : hx(['#f2f0ea', '#e8e4dc', '#cfd6d8', '#3a3d42', '#d9cfbd', '#8e9aa0', '#c9d4c0', '#e6ded4'][Math.floor(r(2) * 8)]);
        const roofC = hx(['#3a3d42', '#5d6770', '#47535c', '#6e5a48', '#4a4f55'][Math.floor(r(3) * 5)]);
        f.box(0, cz, bw, bd, 0, H, wc, null, 'res', 2.9);
        if (r(5) < 0.5) f.hip(0, cz, bw, bd, H, 2.1, roofC, 0.45);
        else f.gable(0, cz, bw, bd, H, 2.3, roofC, wc, r(9) < 0.5, 0.45);
      }
      if (r(25) < 0.75) f.tree(-(lw / 2 - 2.2), -ld / 2 + 2.6, 1.0, 2);
      f.tree((r(23) < 0.5 ? -1 : 1) * (lw / 2 - 2.2), ld / 2 - 3.0, 0.9, 1);
      break;
    }
    case 'apartments': {
      f.ground(lw, ld, C.paving);
      const W = b.w - 2.0, D = b.d - 2.6, cz = -0.3, H = fl * FLOOR_H;
      const { style, wall } = aptLook(b.seed);
      if (style === 'balcony') f.walls(rectPts(W + 1.6, D + 1.6, cz), FLOOR_H, H, hx('#f2f0ea'), 'tower', 1.6, FLOOR_H);
      else f.walls(rectPts(W, D, cz), FLOOR_H, H, wall, 'res', 1.7, FLOOR_H);
      f.walls(rectPts(W, D, cz), 0, FLOOR_H, mix(wall, hx('#4a4c50'), 0.5), 'res', 1.7, FLOOR_H);
      f.prism(rectPts(W, D, cz), H, H + 0.8, wall, hx('#8d8f92'));
      f.box(W * 0.18, cz - D * 0.16, 3.0, 3.4, H, 2.8, shade(wall, 0.92), shade(wall, 0.8), null);
      break;
    }
    case 'office': case 'adco': {
      f.ground(lw, ld, C.paving);
      if (b.kind === 'adco') {
        const W = b.w * 0.6, D = b.d - 1.0, ox = -b.w / 2 + W / 2 + 0.3;
        f.box(ox, 0, W, D, 0, fl * FLOOR_H, hx('#5d6670'), hx('#8d8f92'), 'off', 1.6);
        f.box(b.w / 2 - 2.5, ld / 2 - 1.2, 5.2, 0.3, 5.0, 2.6, brand, brand, null);
        break;
      }
      const { tint, frame } = officeLook(b.seed);
      const W = b.w - 0.8, D = b.d - 0.8, H = fl * FLOOR_H;
      f.walls(rectPts(W, D, 0), FLOOR_H, H, tint, 'glass', 1.5, FLOOR_H);
      f.walls(rectPts(W - 0.6, D - 0.6, 0), 0, FLOOR_H, mix(tint, C.white, 0.3), 'off', 2.6, FLOOR_H);
      f.prism(rectPts(W, D, 0), H, H + 1.0, shade(frame, 0.95), hx('#7d7f82'));
      f.box(-W * 0.15, -D * 0.1, W * 0.38, D * 0.4, H, 2.6, hx('#9a9c9e'), hx('#8d8f92'), null);
      break;
    }
    case 'bank': {
      f.ground(lw, ld, C.paving);
      const W = b.w - 0.8, D = b.d - 0.8, H = fl * FLOOR_H;
      const stone = hx(['#d8cfbd', '#e6e2d8', '#a7a39b', '#4a4c50', '#d9c9ab'][Math.floor(hash2(b.seed, 881) * 5)]);
      f.walls(rectPts(W, D, 0), 0, H, stone, 'off', 2.2, FLOOR_H);
      f.prism(rectPts(W + 0.4, D + 0.4, 0), H - 0.25, H + 0.9, stone, hx('#7d7f82'));
      break;
    }
    case 'netco': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 0.8, bd = b.d - 0.8, H = fl * FLOOR_H;
      const tint = mix(hx('#5a8fb0'), hx('#9fc4d8'), r(2) * 0.4);
      f.walls(rectPts(bw, bd, 0), 0, H, tint, 'glass', 1.25, FLOOR_H);
      f.cap(rectPts(bw, bd, 0), H, hx('#8a8a86'));
      f.box(bw / 2 + 0.12, bd / 2 - 1.6, 0.24, 3.2, 0, H + 3.5, brand, brand, null);
      f.lampBand(rectPts(bw + 0.1, bd + 0.1, 0), H - 0.1, H, brand);
      break;
    }
    case 'cityhall': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 1.2, bd = b.d - 3.2, cz = -1.0, H = (fl - 1) * FLOOR_H + 5.0;
      const stone = pick([hx('#e6dfcf'), hx('#d9cfbb'), hx('#ece6da')], 1);
      f.box(0, cz, bw, bd, 0, H, stone, hx('#8c8a85'), 'res', 2.6, FLOOR_H, 0.9);
      f.box(0, cz + bd / 2 + 1.3, Math.min(bw * 0.5, 9), 2.6, 0, H - 0.4, C.white, C.white, null);
      f.gable(0, cz + bd / 2 + 1.3, Math.min(bw * 0.5, 9), 2.6, H - 0.4, 1.6, stone, stone, true, 0.2);
      f.box(0, cz - 0.5, 3.6, 3.6, H, 5.0, stone, null, null);
      f.hip(0, cz - 0.5, 3.6, 3.6, H + 5.0, 2.6, hx('#5f7f72'), 0.2);
      break;
    }
    case 'studio': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 0.6, bd = b.d - 0.6, H = Math.max(fl * FLOOR_H, 3.6);
      const hallC = pick([hx('#3f454d'), hx('#5a5f66'), hx('#2f3a46')], 1);
      f.box(0, -bd / 4, bw, bd / 2, 0, Math.max(6.4, H), hallC, hx('#6a6e72'), null);
      f.box(0, bd / 4, bw, bd / 2, 0, H, mix(hx('#4f7896'), hallC, 0.3), hx('#7d7f82'), 'off', 1.6);
      f.box(-bw * 0.25, -bd / 4, 0.6, 0.6, Math.max(6.4, H), 12, C.metal, C.metal, null);
      break;
    }
    case 'store': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 0.6, bd = b.d - 1.0, cz = -0.3, H = fl * FLOOR_H + (fl === 1 ? 1.0 : 0.3);
      const v = Math.floor(hash2(b.seed, 901) * 3);
      const wallC = v === 2 ? pick(P.bricks, 902) : hx(['#e8e4dc', '#3a3d42', '#d9dcdc', '#c8c1b4', '#f2f0ea', '#5d6670'][Math.floor(hash2(b.seed, 903) * 6)]);
      f.box(0, cz, bw, bd, 0, H, wallC, hx('#8d8f92'), fl > 1 ? 'off' : null, 3.0, FLOOR_H, FLOOR_H);
      f.walls([-bw / 2 + 0.35, cz + bd / 2 + 0.05, bw / 2 - 0.35, cz + bd / 2 + 0.05, bw / 2 - 0.35, cz + bd / 2 + 0.04, -bw / 2 + 0.35, cz + bd / 2 + 0.04], 0.35, 2.75, hx('#c9d2da'), 'off', 1.8, 2.6);
      f.box(0, cz + bd / 2 + 0.1, bw, 0.2, 2.85, 0.9, brand, brand, null);
      break;
    }
    case 'restaurant': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 0.6, bd = b.d - 0.8, H = 3.8;
      const wallC = hx(['#e8e4dc', '#3a3d42', '#c86a4a', '#d9cfbd', '#2f4f3e', '#f2f0ea'][Math.floor(hash2(b.seed, 951) * 6)]);
      f.box(0, 0, bw, bd, 0, H, wallC, hx('#3a3d42'), null);
      f.walls([-bw / 2 + 0.35, bd / 2 + 0.05, bw / 2 - 0.35, bd / 2 + 0.05, bw / 2 - 0.35, bd / 2 + 0.04, -bw / 2 + 0.35, bd / 2 + 0.04], 0.25, 2.9, hx('#c9d2da'), 'off', 1.8, 2.8);
      f.box(0, bd / 2 + 0.1, bw, 0.25, 3.0, 0.8, hx('#3a3d42'), hx('#3a3d42'), null);
      break;
    }
    case 'dealer': {
      f.ground(lw, ld, C.paving);
      const bw = b.w - 0.6, bd = b.d - 0.6;
      f.box(0, 0, bw, bd, 0, 5.0, hx('#a9c6d6'), C.steel, 'off', 2.2, 5.0);
      f.box(0, bd / 2 + 0.3, bw + 0.6, 0.12, 3.9, 1.1, brand, brand, null);
      break;
    }
    case 'farm': case 'vegfarm': case 'dairyfarm': case 'ranch': {
      if (look.draped) {
        // a farmyard on a countryside field lot (farms.ts): the main building and its biggest neighbors
        const bw = b.w - 0.6, bd = b.d - 0.6;
        if (b.kind === 'farm') {
          const red = mix(hx('#a8463a'), hx('#8a3a30'), r(2));
          f.box(0, 0, bw, bd, 0, 4.5, red, null, null);
          f.gable(0, 0, bw, bd, 4.5, 3.6, r(3) < 0.5 ? hx('#4f4a48') : hx('#6f7478'), red, true, 0.3);
          for (let k = 0; k < 2; k++) f.box(bw / 2 + 5.2, bd / 2 - 3 - k * 6.4, 5.0, 5.0, 0, 7.5, hx('#c4c8cc'), hx('#d0d4d8'), null);
        } else if (b.kind === 'vegfarm') {
          f.box(0, 0, bw, bd, 0, 5.0, hx('#e6e9e4'), hx('#8d8f92'), 'ind', 3);
          f.box(b.w / 2 + 5.8, b.d / 2 - 6, 5.6, 18, 0, 2.6, hx('#e8ece6'), hx('#e8ece6'), null);
        } else if (b.kind === 'dairyfarm') {
          f.box(0, 0, bw, bd, 0, 3.5, hx('#f2f0ea'), null, 'ind', 3);
          f.gable(0, 0, bw, bd, 3.5, 1.6, hx('#6f7478'), hx('#f2f0ea'), false, 0.5);
          f.box(-bw / 2 + 2.5, -bd / 2 - 6.5, 5.4, 5.4, 0, 14, hx('#2f4f7a'), hx('#3d6090'), null);
          f.box(bw / 2 + 9, b.d / 2 - 8, 13, 22, 0.15, 3.6, hx('#c9ccd0'), hx('#8a9096'), null);
        } else {
          const wood = mix(hx('#7a5236'), hx('#8a4a34'), r(2));
          f.box(0, 0, bw, bd, 0, 4.1, wood, null, null);
          f.gable(0, 0, bw, bd, 4.1, 2.6, hx('#5a5f63'), wood, true, 0.5);
          f.box(-bw / 2 + 4, -bd / 2 - 6, 9, 7, 0, 5.4, hx('#c9b066'), hx('#6f7478'), null);
        }
        break;
      }
      f.ground(lw, ld, hsl(0.24, 0.32, 0.45));
      const crops = [C.wheat, C.corn, C.veg, C.soil, C.canola];
      const fz0 = -ld / 2 + 1.0, fz1 = Math.min(-b.d / 2 - 2.0, ld / 2 - 4);
      if (fz1 - fz0 > 2) {
        const patches = 2 + Math.floor(r(1) * 2);
        for (let p = 0; p < patches; p++) {
          const x0 = -lw / 2 + 1.6 + (p / patches) * (lw - 2), x1 = -lw / 2 + 0.4 + ((p + 1) / patches) * (lw - 2);
          f.flat((x0 + x1) / 2, (fz0 + fz1) / 2, x1 - x0, fz1 - fz0, 0.4, crops[Math.floor(hash2(b.seed, 20 + p) * crops.length)]);
        }
      }
      const barnW = Math.min(7.5, b.w * 0.52), bx = b.w / 2 - barnW / 2 - 0.2;
      const red = mix(hx('#a8463a'), hx('#8a3a30'), r(2));
      f.box(bx, 0, barnW, b.d - 0.6, 0, 4.2, red, null, null);
      f.gable(bx, 0, barnW, b.d - 0.6, 4.2, 3.4, r(3) < 0.5 ? hx('#4f4a48') : hx('#7a3b2e'), red, true, 0.3);
      f.box(b.w / 2 + 1.4, -b.d / 2 + 1.8, 3.0, 3.0, 0, 10.5, r(4) < 0.5 ? hx('#c9c4b8') : hx('#5a7f9f'), C.steel, null);
      const hw = Math.min(4.8, b.w - barnW - 2.0), hd = Math.min(5.2, b.d - 1.5), hx_ = -b.w / 2 + hw / 2 + 0.2;
      const fhC = pick(P.houseWalls, 6);
      f.box(hx_, -0.3, hw, hd, 0, 3.0, fhC, null, 'res', 2.4);
      f.gable(hx_, -0.3, hw, hd, 3.0, 2.0, pick(P.roofs, 7), fhC, false, 0.4);
      break;
    }
    case 'clinic': {
      f.ground(lw, ld, C.paving);
      const W = b.w - 1.2, D = b.d - 1.6, H = fl * FLOOR_H + 0.3;
      f.box(0, -0.3, W, D, 0, H, hx('#f2f1ec'), hx('#e9e7e2'), 'off', 2.6);
      f.box(W / 2 - 2.8, -0.3 + D / 2 + 1.2, 5.0, 2.4, 2.85, 0.25, hx('#e9e7e2'), hx('#12827f'), null);
      break;
    }
    case 'hospital': {
      f.ground(lw, ld, C.paving);
      const W = b.w - 0.8, D = b.d - 0.8, H = Math.max(2, fl) * FLOOR_H;
      f.walls(rectPts(W, D, 0), 0, H, hx('#eef0f0'), 'off', 1.6, FLOOR_H);
      f.prism(rectPts(W, D, 0), H, H + 0.9, hx('#e2e4e4'), hx('#8d8f92'));
      f.box(W * 0.2, -D * 0.15, W * 0.3, D * 0.35, H, 3.0, hx('#d9dcdc'), hx('#8d8f92'), null);
      f.box(0, D / 2 - 0.5, 3.4, 0.3, H + 1.1, 3.4, hx('#1f5fae'), hx('#1f5fae'), null);
      break;
    }
    case 'bakery': {
      f.ground(lw, ld, C.paving);
      const W = b.w - 0.8, D = b.d - 1.2, brick = pick(P.bricks, 1);
      f.box(0, -0.4, W, D, 0, 5.2, brick, null, 'ind', 2.2);
      f.gable(0, -0.4, W, D, 5.2, 1.8, hx('#5d6770'), brick, false, 0.4);
      f.box(W / 2 + 1.4, -0.4 - D / 2 + 2.2, 2.1, 2.1, 0, 7.9, hx('#eeeeea'), hx('#dcdcd8'), null);
      break;
    }
    case 'farmhouse': {
      // a traditional farmhouse (farms.ts)
      f.ground(lw, ld, lawn);
      const bw = b.w - 1.6, bd = b.d - 3.0, cz = -0.9, H = fl * FLOOR_H;
      const brick = r(2) < 0.25;
      const wall = brick ? pick(P.bricks, 3) : hx(['#f4f1ea', '#efe6d0', '#e3e8e6', '#f1e4cc', '#dfe3d0'][Math.floor(r(3) * 5)]);
      const roofC = hx(['#5d6770', '#4a4f55', '#7b4b3a', '#6c5a48', '#3f4f5a'][Math.floor(r(5) * 5)]);
      f.box(0, cz, bw, bd, 0, H + 0.45, wall, null, 'res', 2.6);
      f.gable(0, cz, bw, bd, H + 0.45, bd * 0.55, roofC, wall, false, 0.45);
      f.box(0, cz + bd / 2 + 1.2, bw + 0.4, 2.4, 0, 0.45, C.woodLight, roofC, null);
      f.tree(-(r(9) < 0.5 ? 1 : -1) * (bw / 2 + 4.5), cz + bd / 2 + 3.9, 1.8, 3);
      break;
    }
    case 'lumberyard': {
      f.ground(lw, ld, C.dirt);
      f.box(b.w / 2 - 3.2, b.d / 2 - 1.8, 6, 2.5, 0.05, 2.6, hx('#3f6b4a'), hx('#3f6b4a'), 'ind', 1.6, 2.6);
      for (let k = 0; k < 3; k++) f.box(k === 2 ? b.w / 2 - 3 : -b.w / 2 + 3, k === 1 ? b.d / 2 - 2.5 : -b.d / 2 + 2.5, 2.4, 6, 0, 1.8, C.log, C.logEnd, null);
      for (let x = -lw / 2 + 2; x < lw / 2 - 1; x += 4.5) f.tree(x, -ld / 2 + 2, 1.1, Math.round(x));
      break;
    }
    case 'claypit': {
      f.ground(lw, ld, hx('#9a8a72'));
      f.box(0, -ld / 4, lw - 2, ld / 2, -2.6, 2.6, hx('#8a7a66'), hx('#7d7060'), null);
      f.box(-b.w / 2 + 2, b.d / 2 - 2, 6, 2.4, 0, 2.6, hx('#e0dccf'), C.orange, null);
      break;
    }
    case 'cementworks': {
      f.ground(lw, ld, C.gravel);
      f.box(b.w / 2 - 4, -1, 4.4, 4.4, 5.2, 6.2, hx('#c9c6be'), brand, null);
      for (let k = 0; k < 3; k++) f.box(b.w / 2 - 9 - k * 3.1, -3.2, 2.7, 2.7, 2.6, 11, k % 2 ? hx('#c9c6be') : hx('#b5b0a5'), hx('#b5b0a5'), null);
      f.box(-b.w / 2 + 3.5, b.d / 2 - 2.5, 6, 4.4, 0, 3.4, hx('#e6e2d8'), brand, 'off', 1.5);
      break;
    }
    case 'quarry': {
      f.ground(lw, ld, hx('#b49a78'));
      const back = -ld / 2 + 0.3;
      for (let j = 1; j <= 3; j++) f.box(0, back + (4 - j) * 1.6, lw - 1 - (4 - j) * 3, (4 - j) * 3.2, 0, j * 1.5, [hx('#c98a5a'), hx('#d2b48a'), hx('#a89a88')][j - 1], null, null);
      f.box(-b.w / 2 + 2, b.d / 2 - 2, 3.0, 2.4, 0, 2.6, hx('#e0dccf'), C.orange, null);
      break;
    }
    case 'mine': {
      f.ground(lw, ld, lw > b.w + 24 ? hsl(0.24, 0.32, 0.45) : C.gravel);
      const frameC = r(1) < 0.5 ? hx('#8a2f28') : hx('#5d6670');
      f.box(1.5, -1.0, 2.2, 2.2, 0, 14, frameC, frameC, null);
      const houseC = r(2) < 0.5 ? pick(P.bricks, 3) : pick(P.indWalls, 4);
      f.box(-b.w / 2 + 3.2, b.d / 2 - 2.8, 5.2, 4.6, 0, 4.2, houseC, null, 'ind', 2.2, 4.2);
      f.gable(-b.w / 2 + 3.2, b.d / 2 - 2.8, 5.2, 4.6, 4.2, 1.6, pick(P.indRoofs, 5), houseC, false);
      f.box(-lw * 0.1, -ld / 2 + 6, Math.min(lw * 0.6, 30), 10, 0, 5, hx('#7d8a5a'), hx('#6f7d50'), null);
      break;
    }
    case 'yard': {
      f.ground(lw, ld, C.gravel);
      const cc = pick([C.yellow, hx('#3a6ea5'), C.white, C.orange], 1);
      f.box(-b.w / 2 + 3.2, b.d / 2 - 1.8, 6, 2.5, 0.05, r(2) < 0.6 ? 5.2 : 2.6, cc, shade(cc, 0.9), 'ind', 1.6, 2.6);
      f.box(-b.w / 2 + 1.6, -b.d / 2 + 4.5, 1.1, 1.1, 0, 10, C.yellow, C.yellow, null);
      f.box(b.w / 2 - 3, -b.d / 2 + 2.5, 6, 3.6, 3.3, 0.5, pick(P.indRoofs, 4), pick(P.indRoofs, 4), null);
      for (let k = 0; k < 3; k++) f.box(-b.w / 2 + 1.2 + k * 1.5, -b.d / 2 + 1.5, 1.2, 1.2, 0, 1.0, C.brickRed, C.brickRed, null);
      break;
    }
    default: {
      // modern metal-clad halls
      const look = hallLook(b.kind, b.seed, fl);
      f.ground(lw, ld, b.kind === 'foodplant' || b.kind === 'carplant' || b.kind === 'depot' || b.kind === 'glassworks' || b.kind === 'electronics' || b.kind === 'textile' ? C.paving : C.gravel);
      const bw = b.w - 0.6, bd = b.kind === 'depot' ? b.d - 2.4 : b.d - 0.6, cz = b.kind === 'depot' ? -0.9 : 0;
      f.box(0, cz, bw, bd, 0, look.H, look.wall, hx('#8d8f92'), 'ind', 2.6, Math.max(4, look.H / Math.max(1, look.storeys)));
      f.lampBand(rectPts(bw + 0.04, bd + 0.04, cz), look.H - 0.75, look.H - 0.35, brand);
      if (look.office) f.box(bw / 2 - Math.min(7, bw * 0.38) / 2, cz + bd / 2 + 1.7, Math.min(7, bw * 0.38), 4.2, 0, 6.6, hx('#2f3a44'), shade(look.wall, 0.8), 'off', 1.4);
      if (b.kind === 'brickworks') f.box(bw / 2 - 1.5, cz - bd / 2 - 1.0, 1.4, 1.4, 0, 20, hx('#b9bec2'), C.black, null);
      if (b.kind === 'steelmill') {
        f.box(bw / 2 - bw * 0.225 - 0.5, cz - bd / 4 + 0.5, bw * 0.45, bd * 0.5, look.H, 6.9, shade(look.wall, 0.9), hx('#2f3338'), null);
        f.box(-bw / 2 + 2, cz - bd / 2 - 4.9, 1.5, 1.5, 0, 24, hx('#b9bec2'), C.black, null);
      }
      if (b.kind === 'glassworks') {
        f.box(-bw / 2 + bw * 0.18, cz - bd / 2 + bd * 0.275, bw * 0.36, bd * 0.55, look.H, 4.0, shade(look.wall, 0.85), shade(look.wall, 0.7), null);
        f.box(-bw / 2 + bw * 0.11, cz - bd / 2 + bd * 0.17, 1.6, 1.6, 0, 26, hx('#b9bec2'), C.black, null);
      }
      if (b.kind === 'carplant') f.box(-bw * 0.2, cz - bd * 0.15, bw * 0.4, bd * 0.4, look.H, 4, hx('#b9c2c9'), hx('#8d8f92'), null);
      if (b.kind === 'foodplant' || b.kind === 'sawmill') f.box(-bw / 2 - 2, cz - bd / 2 + 1.6, 2.8, 2.8, 0, b.kind === 'sawmill' ? 9.2 : 10.6, C.steel, C.steel, null);
      if (b.kind === 'dairyplant') for (let k = 0; k < 3; k++) f.box(-bw / 2 - 2, cz - bd / 2 + 2 + k * 3.6, 2.8, 2.8, 0, 11.6, hx('#d6dadd'), hx('#e2e5e7'), null);
      break;
    }
  }
  return finish(f);
}

function finish(f: FarWriter): FarModel {
  const parts: Partial<Record<FarStyle, Part>> = {};
  for (const s of STYLES) {
    const g = f.g[s];
    if (g.empty) continue;
    parts[s] = { p: g.p.slice(), n: g.n.slice(), c: g.c.slice(), uv: g.uv.slice(), i: g.i.slice(), verts: g.verts };
    g.release();
  }
  return { parts };
}

// ------------------------------------------------------------ textures

function facadeTextures(scene: Scene, style: FarStyle): { diffuse: DynamicTexture; lit: DynamicTexture } {
  const S = 256, cell = S / CELLS;
  const mk = (name: string) => {
    const t = new DynamicTexture(`far-${style}-${name}`, { width: S, height: S }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    return t;
  };
  const diffuse = mk('d'), lit = mk('e');
  const d = diffuse.getContext() as unknown as CanvasRenderingContext2D;
  const e = lit.getContext() as unknown as CanvasRenderingContext2D;
  d.fillStyle = '#ffffff';
  d.fillRect(0, 0, S, S);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, S, S);
  const rgb = (r: number, g: number, b: number, k: number) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  if (style === 'glass' || style === 'glassV') {
    // a curtain wall: one cell = one bay x one floor; spandrel at the bottom, thin mullions, whole floors lit
    for (let j = 0; j < CELLS; j++) {
      const rowP = style === 'glassV' ? 0.04 : [0.92, 0.75, 0.55, 0.88, 0.3, 0.8, 0.65, 0.12][j];
      for (let i = 0; i < CELLS; i++) {
        const x0 = i * cell, y0 = j * cell;
        // (canvas y grows downward: the cell's bottom is at y0 + cell)
        d.fillStyle = '#b7bfc6';
        d.fillRect(x0, y0, cell, cell * 0.72);
        d.fillStyle = '#6d757c';
        d.fillRect(x0, y0 + cell * 0.72, cell, cell * 0.28);
        d.fillStyle = '#e4e8ec';
        d.fillRect(x0, y0, 1.2, cell);
        const h = hash2(i * 31 + j * 7 + (style === 'glassV' ? 3000 : 4000), 4242);
        if (h < rowP) {
          const k = 0.7 + 0.3 * hash2(i + 5, j + 9);
          e.fillStyle = rgb(215, 232, 255, k);
          e.fillRect(x0 + 1.5, y0 + 1, cell - 2, cell * 0.7);
        }
      }
    }
  } else if (style === 'tower') {
    // flats behind balconies: a light slab band, dark glass, warm lit rooms
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      const x0 = i * cell, y0 = j * cell;
      d.fillStyle = '#4a5560';
      d.fillRect(x0, y0, cell, cell * 0.84);
      d.fillStyle = '#7a8590';
      d.fillRect(x0, y0 + cell * 0.55, cell, cell * 0.06);
      d.fillStyle = '#f2f0ea';
      d.fillRect(x0, y0 + cell * 0.84, cell, cell * 0.16);
      d.fillStyle = '#9aa6ae';
      d.fillRect(x0, y0, 1.2, cell * 0.84);
      const h = hash2(i * 31 + j * 7 + 5000, 4242);
      if (h < 0.38) {
        const k = 0.65 + 0.35 * hash2(i + 11, j + 17);
        e.fillStyle = rgb(255, 196, 110, k);
        e.fillRect(x0 + 1.5, y0 + 1, cell - 2, cell * 0.82);
      }
    }
  } else if (style === 'lamp') {
    // a light strip: plain; the vertex color is the light
  } else {
    // window rectangle inside a cell (canvas y grows downward; v = 0 is the bottom of a cell)
    const win = style === 'res' ? [0.24, 0.17, 0.76, 0.66] : style === 'off' ? [0.04, 0.0, 0.96, 0.86] : [0.12, 0.08, 0.88, 0.36];
    const glass = style === 'off' ? '#7f8e9c' : '#3a4048';
    const litP = style === 'res' ? 0.42 : style === 'off' ? 0.36 : 0.22;
    for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
      const x0 = i * cell + win[0] * cell, x1 = i * cell + win[2] * cell;
      const y0 = j * cell + win[1] * cell, y1 = j * cell + win[3] * cell;
      if (style === 'res') { d.fillStyle = '#d8d4cc'; d.fillRect(x0 - 1.5, y0 - 1.5, x1 - x0 + 3, y1 - y0 + 4); }
      d.fillStyle = glass;
      d.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (style === 'off') { d.fillStyle = '#c9d2da'; d.fillRect(x0, y0 + (y1 - y0) * 0.5, x1 - x0, 1); }
      const h = hash2(i * 31 + j * 7 + (style === 'off' ? 1000 : style === 'ind' ? 2000 : 0), 4242);
      if (h < litP) {
        const k = 0.65 + 0.35 * hash2(i + 11, j + 17);
        e.fillStyle = style === 'off' ? rgb(205, 225, 250, k) : rgb(255, 196, 110, k);
        e.fillRect(x0, y0, x1 - x0, y1 - y0);
        if (style === 'res' && h < litP * 0.35) { e.fillStyle = 'rgba(0,0,0,0.45)'; e.fillRect(x0, y0, (x1 - x0) * 0.3, y1 - y0); e.fillRect(x1 - (x1 - x0) * 0.3, y0, (x1 - x0) * 0.3, y1 - y0); }
      }
    }
  }
  // the plain wall texel (PU) stays white and unlit in every style
  d.fillStyle = '#ffffff';
  d.fillRect(0, S - 3, 3, 3);
  e.fillStyle = '#000000';
  e.fillRect(0, S - 3, 3, 3);
  diffuse.update(true);
  lit.update(true);
  return { diffuse, lit };
}

// ------------------------------------------------------------ chunks

const CHUNK = 192;

interface Chunk {
  members: Map<number, FarModel>;
  meshes: Mesh[];
  pick: Map<Mesh, { starts: number[]; ids: number[] }>;
}

/** Merged far-LOD meshes per spatial chunk. */
export class FarLayer {
  private chunks = new Map<string, Chunk>();
  private dirty = new Set<string>();
  private mats: Record<FarStyle, StandardMaterial>;
  private textures: DynamicTexture[] = [];
  /** Vertices currently in far chunks (debugging). */
  verts = 0;

  private night = 0;
  private hour = 21;

  /** `sky`: what glass reflects (an equirectangular texture), for the curtain walls. */
  constructor(private scene: Scene, sky?: BaseTexture) {
    const mats = {} as Record<FarStyle, StandardMaterial>;
    for (const s of STYLES) {
      const m = new StandardMaterial(`bld-far-${s}`, scene);
      if (s === 'lamp') {
        // light strips: their vertex color, glowing at night
        m.diffuseColor = new Color3(0.3, 0.3, 0.3);
        m.specularColor = new Color3(0, 0, 0);
        mats[s] = m;
        continue;
      }
      const { diffuse, lit } = facadeTextures(scene, s);
      this.textures.push(diffuse, lit);
      m.diffuseTexture = diffuse;
      m.emissiveTexture = lit;
      m.useEmissiveAsIllumination = true;
      const glassy = s === 'off' || s === 'glass' || s === 'glassV';
      m.specularColor = new Color3(glassy ? 0.3 : 0.03, glassy ? 0.3 : 0.03, glassy ? 0.3 : 0.03);
      m.specularPower = 32;
      if (sky && (glassy || s === 'tower')) {
        m.reflectionTexture = sky;
        m.reflectionFresnelParameters = new FresnelParameters({ bias: 0.08, power: 1.6, leftColor: new Color3(0.8, 0.8, 0.8), rightColor: new Color3(s === 'tower' ? 0.05 : 0.14, s === 'tower' ? 0.05 : 0.14, s === 'tower' ? 0.05 : 0.14) });
      }
      lit.level = 0;
      mats[s] = m;
    }
    this.mats = mats;
  }

  /** Swap what the glass reflects (day / night sky). */
  setSky(sky: BaseTexture): void {
    for (const s of ['off', 'glass', 'glassV', 'tower'] as FarStyle[]) if (this.mats[s].reflectionTexture) this.mats[s].reflectionTexture = sky;
  }

  static keyOf(x: number, z: number): string { return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`; }

  /** Put (or replace) a building's far model in the chunk `key`; null removes it. */
  set(id: number, key: string, model: FarModel | null): void {
    let ch = this.chunks.get(key);
    if (!model) {
      if (ch && ch.members.delete(id)) this.dirty.add(key);
      return;
    }
    if (!ch) { ch = { members: new Map(), meshes: [], pick: new Map() }; this.chunks.set(key, ch); }
    ch.members.set(id, model);
    this.dirty.add(key);
  }

  setNight(n: number): void {
    this.night = clamp01(n);
    this.applyLight();
  }

  /** Time of day: offices empty out in the evening, flats go dark after midnight. */
  setHour(h: number): void {
    this.hour = h;
    this.applyLight();
  }

  private applyLight(): void {
    const n = this.night, h = this.hour;
    const on = (a: number, b: number): number => {
      const len = (b - a + 24) % 24, x = (h - a + 24) % 24;
      return x > len ? 0 : clamp01(x / 0.5) * clamp01((len - x) / 0.5);
    };
    const office = 0.25 + 0.75 * on(6.5, 23), homes = 0.3 + 0.7 * on(16, 23.5);
    for (const s of STYLES) {
      const m = this.mats[s];
      if (s === 'lamp') { m.emissiveColor = new Color3(n, n, n); continue; }
      const t = m.emissiveTexture;
      // brighter than the near windows: mipmapping averages each lit window with its dark wall
      const k = s === 'off' || s === 'glass' ? 1.7 * office : s === 'glassV' ? 1.4 : s === 'ind' ? 1.9 * office : s === 'tower' ? 1.45 * homes : 1.9 * homes;
      if (t) t.level = n * k;
      m.emissiveColor = new Color3(0.04, 0.06, 0.09).scale(1 - n);
    }
  }

  flush(): void {
    for (const key of this.dirty) this.rebuild(key);
    this.dirty.clear();
  }

  pickedId(pick: PickingInfo): number {
    const mesh = pick.pickedMesh as Mesh | null;
    const md = mesh?.metadata as { kind?: string; far?: string } | null;
    if (!mesh || !md || md.kind !== 'building' || md.far === undefined) return -1;
    const info = this.chunks.get(md.far)?.pick.get(mesh);
    if (!info) return -1;
    const face = pick.faceId;
    let lo = 0, hi = info.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (info.starts[mid] <= face) lo = mid; else hi = mid - 1;
    }
    return info.ids[lo] ?? -1;
  }

  get drawMeshes(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.meshes.length;
    return n;
  }

  dispose(): void {
    for (const c of this.chunks.values()) for (const m of c.meshes) m.dispose(false, false);
    this.chunks.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const t of this.textures) t.dispose();
  }

  private rebuild(key: string): void {
    const ch = this.chunks.get(key);
    if (!ch) return;
    for (const m of ch.meshes) { this.verts -= m.getTotalVertices(); m.dispose(false, false); }
    ch.meshes = [];
    ch.pick.clear();
    if (ch.members.size === 0) { this.chunks.delete(key); return; }
    for (const s of STYLES) {
      let nv = 0, ni = 0;
      for (const m of ch.members.values()) { const p = m.parts[s]; if (p) { nv += p.verts; ni += p.i.length; } }
      if (nv === 0) continue;
      const P_ = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cc = new Float32Array(nv * 4), UV = new Float32Array(nv * 2);
      const I = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni);
      const starts: number[] = [], ids: number[] = [];
      let ov = 0, oi = 0;
      for (const [id, m] of ch.members) {
        const p = m.parts[s];
        if (!p) continue;
        starts.push(oi / 3);
        ids.push(id);
        P_.set(p.p, ov * 3); N.set(p.n, ov * 3); Cc.set(p.c, ov * 4); UV.set(p.uv, ov * 2);
        for (let k = 0; k < p.i.length; k++) I[oi + k] = p.i[k] + ov;
        ov += p.verts;
        oi += p.i.length;
      }
      const mesh = new Mesh(`bldfar-${key}-${s}`, this.scene);
      const vd = new VertexData();
      vd.positions = P_; vd.normals = N; vd.colors = Cc; vd.uvs = UV; vd.indices = I;
      vd.applyToMesh(mesh, false);
      mesh.material = this.mats[s];
      mesh.isPickable = true;
      mesh.receiveShadows = false;
      mesh.metadata = { kind: 'building', far: key };
      mesh.freezeWorldMatrix();
      ch.meshes.push(mesh);
      ch.pick.set(mesh, { starts, ids });
      this.verts += nv;
    }
  }
}

// ------------------------------------------------------------ towers

const FH = FLOOR_H;

/** A tower far away: podium, shaft bands (vacant office floors dark), crown, lit crown strips, spire. */
function towerFar(f: FarWriter, b: Building, look: BuildingLook, units: HostedUnit[], occ: number, lw: number, ld: number): void {
  const p = towerPlan(b, look.firmName);
  f.ground(lw, ld, C.paving);
  const rect = (w: number, d: number): number[] => [-w / 2, d / 2, w / 2, d / 2, w / 2, -d / 2, -w / 2, -d / 2];
  if (b.ruined) {
    f.prism(rect(p.pw, p.pd), 0, FH, shade(p.stone, 0.6), null);
    for (const s of p.segs) f.walls(outline(s, s.f0), s.f0 * FH, s.f1 * FH, shade(p.tint, 0.5), 'ind', p.bay, FH);
    f.cap(outline(p.segs[p.segs.length - 1], p.floors), p.H, hx('#5a5c60'));
    return;
  }
  if (!b.built) {
    towerSiteFar(f, b, p, lw, ld);
    return;
  }
  f.walls(rect(p.pw, p.pd), 0, FH, mix(p.stone, hx('#8a96a0'), 0.4), 'off', 2.0, FH);
  f.cap(rect(p.pw, p.pd), FH, shade(p.stone, 0.8));
  const leased = new Map<number, boolean>();
  for (const u of units) if (u.level > 0) leased.set(u.level, u.b.kind !== 'suite');
  for (const s of p.segs) {
    if (p.res) {
      const twist = s.twist !== 0;
      const bands = twist ? 4 : 1;
      for (let k = 0; k < bands; k++) {
        const f0 = s.f0 + Math.round(((s.f1 - s.f0) * k) / bands), f1 = s.f0 + Math.round(((s.f1 - s.f0) * (k + 1)) / bands);
        const mid = Math.round((f0 + f1) / 2);
        const pts = s.balc > 0 ? offsetOutline(outline(s, mid), s.balc * 0.7) : outline(s, mid);
        f.walls(pts, f0 * FH, f1 * FH, p.slab, 'tower', p.bay, FH);
      }
      continue;
    }
    // office floors in runs of leased / vacant
    let f0 = s.f0;
    while (f0 < s.f1) {
      const st = units.length ? leased.get(f0) ?? false : true;
      let f1 = f0 + 1;
      while (f1 < s.f1 && (units.length ? leased.get(f1) ?? false : true) === st) f1++;
      f.walls(outline(s, Math.round((f0 + f1) / 2)), f0 * FH, f1 * FH, p.tint, st ? 'glass' : 'glassV', p.bay, FH);
      f0 = f1;
    }
  }
  void occ;
  // crown
  const last = p.segs[p.segs.length - 1];
  const top = outline(last, last.f1);
  const H = p.H;
  if (p.res) {
    f.prism(top, H, H + 0.3, p.slab, hx('#cfcac0'));
    if (p.crown === 'penthouse' || p.crown === 'lantern') {
      const pp = offsetOutline(top, p.crown === 'lantern' ? -2.4 : -1.6);
      f.walls(pp, H + 0.3, H + p.crownH - 0.4, mix(p.tint, C.white, 0.3), p.crown === 'lantern' ? 'glass' : 'tower', 1.6, FH);
      f.prism(offsetOutline(pp, 0.3), H + p.crownH - 0.4, H + p.crownH, p.slab, p.slab);
      f.lampBand(offsetOutline(pp, 0.32), H + p.crownH - 0.42, H + p.crownH - 0.3, p.light);
    } else if (p.crown === 'canopy') {
      f.prism(offsetOutline(top, 0.4), H + 4.05, H + 4.3, p.slab, p.slab);
      f.lampBand(offsetOutline(top, 0.42), H + 3.95, H + 4.05, p.light);
    }
  } else {
    if (p.crown === 'slope') {
      f.prism(top, H, H + 0.6, shade(p.frame, 0.9), null);
      let z0 = 1e9, z1 = -1e9;
      for (let i = 1; i < top.length; i += 2) { z0 = Math.min(z0, top[i]); z1 = Math.max(z1, top[i]); }
      const yAt = (z: number) => H + 0.6 + p.crownH * clamp01((z1 - z) / (z1 - z0));
      const p3: number[] = [], uv: number[] = [];
      for (let i = 0; i < top.length; i += 2) { p3.push(top[i], yAt(top[i + 1]), top[i + 1]); uv.push(PU, PU); }
      f.g.glass.poly(p3, shade(p.tint, 1.1), 0, 1, 0.6, uv);
      const n = top.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = top[i * 2], az = top[i * 2 + 1], bx = top[j * 2], bz = top[j * 2 + 1];
        f.g.glass.poly([ax, H + 0.6, az, bx, H + 0.6, bz, bx, yAt(bz), bz, ax, yAt(az), az], shade(p.tint, 0.9), -(bz - az), 0, bx - ax, [PU, PU, PU, PU, PU, PU, PU, PU]);
      }
      f.lampBand(top, H + 0.45, H + 0.6, p.light);
    } else if (p.crown === 'stepped') {
      let y = H;
      for (let k = 0; k < 3; k++) {
        const tp = offsetOutline(top, -(1.2 + k * 1.5));
        const th = 3.0 - k * 0.4;
        f.walls(tp, y, y + th, shade(p.tint, 1.05), 'glassV', p.bay, FH);
        f.cap(tp, y + th, shade(p.frame, 0.9));
        f.lampBand(offsetOutline(tp, 0.03), y + th - 0.4, y + th - 0.25, p.light);
        y += th;
      }
    } else {
      f.prism(top, H, H + 1.2, shade(p.frame, 0.92), hx('#7d7f82'));
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < top.length; i += 2) { x0 = Math.min(x0, top[i]); x1 = Math.max(x1, top[i]); z0 = Math.min(z0, top[i + 1]); z1 = Math.max(z1, top[i + 1]); }
      f.box(0, -(z1 - z0) * 0.08, (x1 - x0) * 0.6, (z1 - z0) * 0.55, H, Math.min(4.2, p.crownH), shade(p.span, 1.1), shade(p.span, 0.9), null);
      if (p.crown === 'ring') {
        f.prism(offsetOutline(top, 0.8), H + p.crownH - 0.6, H + p.crownH, p.frame, p.frame);
        f.lampBand(offsetOutline(top, 0.82), H + p.crownH - 0.55, H + p.crownH - 0.1, p.light);
      } else f.lampBand(offsetOutline(top, 0.02), H + 1.0, H + 1.2, p.light);
    }
  }
  // night glow of the top: the top floors washed with light, or LED lines up the corners
  if (p.glow === 'wash') for (let k = p.floors - 2; k < p.floors; k++) f.lampBand(offsetOutline(outline(last, k), 0.04), k * FH, k * FH + 0.8, p.light);
  else if (p.glow === 'corners') {
    const yb = Math.max(last.f0, p.floors - Math.round(p.floors / 3)) * FH;
    for (let i = 0; i < top.length; i += 2) f.lampBand([top[i] - 0.1, top[i + 1] + 0.1, top[i] + 0.1, top[i + 1] + 0.1, top[i] + 0.1, top[i + 1] - 0.1, top[i] - 0.1, top[i + 1] - 0.1], yb, p.H, p.light);
  }
  if (p.spire > 0) {
    const y = H + p.crownH;
    f.box(0, 0, 2.6, 2.6, y, 2.5, shade(p.frame, 0.9), null, null);
    f.box(0, 0, 0.9, 0.9, y + 2.5, p.spire, C.steel, C.steel, null);
    f.lampBand(rect(2.7, 2.7), y + 2.3, y + 2.5, p.light);
  }
  void towerHeight;
}

/** A tower under construction, far away: the core, the slabs so far, the cladding below, a crane. */
function towerSiteFar(f: FarWriter, b: Building, p: TowerPlan, lw: number, ld: number): void {
  f.ground(lw, ld, C.dirt);
  const prog = clamp01(b.workDone / Math.max(1, b.workNeeded));
  if (prog < 0.06) return;
  const done = Math.min(p.floors, Math.floor(((prog - 0.06) / 0.86) * p.floors + 0.001));
  const coreTop = Math.min(p.H + 4, (done + 3) * FH);
  f.box(0, -1, 5.6, 5.0, 0, coreTop, hx('#9d998f'), hx('#d9a43a'), null);
  const s = p.segs[0];
  const pts = outline(s, s.f0);
  const clad = Math.max(0, done - 6);
  if (clad > 1) f.walls(pts, FH, clad * FH, p.res ? p.slab : p.tint, p.res ? 'tower' : 'glassV', p.bay, FH);
  if (done > clad) f.walls(pts, Math.max(FH, clad * FH), done * FH, hx('#b9b5ac'), 'ind', 3.6, FH);
  f.cap(pts, done * FH, hx('#b9b5ac'));
  const craneTop = Math.max(18, coreTop + 14), jib = Math.max(p.pw, p.pd) + 22;
  f.box(0, -1, 1.7, 1.7, 0, craneTop, C.yellow, C.yellow, null);
  f.t.push(0, 0, -1, Math.PI * 0.2 + hash2(b.seed, 5) * 1.4);
  f.box(0, jib / 2 - 5, 1.2, jib + 10, craneTop, 0.9, C.yellow, C.yellow, null);
  f.t.pop();
}
