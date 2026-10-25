// Building renderer. Every building is generated procedurally from its
// abstract facts (kind, footprint, floors, seed, condition, construction
// progress, hosted units) as clean low-poly geometry with baked vertex
// colors. All parts of one building are written straight into a few vertex
// buffers (no temporary meshes, no MergeMeshes): one opaque mesh, one mesh
// for every lit surface (windows, lamps, screens, crown lights; their
// lighting state comes from a tiny texture, see WS in buildingGeo.ts), and a
// few small ones for clear glass and firm signs. Towers live in towers.ts,
// the shared context and yard props in buildingCtx.ts, interiors in
// interiors.ts. Far away, buildings become merged boxes (buildingFar.ts).
//
// Local space: front = +Z (toward the street), right = +X, ground at y = 0,
// centered on the building (same convention as sim/layout.ts).

import {
  Color3, DynamicTexture, Matrix, Mesh, Quaternion, RawTexture, Scene, ShadowGenerator, StandardMaterial, Texture, Vector3,
  FresnelParameters, type Material, type PickingInfo,
} from '@babylonjs/core';
import {
  C, GLASS_DAY, GLOW_BULB, GLOW_RED, Geo, P, TAU, WIN_BASE, WIN_STATES, WS, Xf,
  clamp01, hsl, hx, lerp, mix, shade,
} from './buildingGeo';
import { BUILDINGS, invTotal, materialsFor } from '../sim/goods';
import { FLOOR_H, stationsOf } from '../sim/layout';
import { hash2 } from '../sim/rng';
import type { Building, BuildingKind, Good } from '../sim/types';
import { FarLayer, farModel, type FarModel } from './buildingFar';
import {
  Ctx, bench, car, fence, gableRoof, gambrelRoof, highWindows, hipRoof, flatRoof, chimney,
  lamp, lattice, logPile, lotFence, lotGround, pallet, parking, pile, planter, plankStack, rollDoor, smallCrane, towerCrane,
  tree, truck, bush, type BuildingLook, type HostedUnit, type SignStyle,
} from './buildingCtx';
import { interior } from './interiors';
import { PropLib, PropList, type PropMat } from './props';
import { roofClutter, siteExtras, streetBits } from './propsExterior';
import {
  adco, brickworks, carplant, cementworks, claypit, depot, electronics, foodplant, furniturePlant, glassworks, lumberyard, sawmill, steelmill, textile, workshop,
} from './industry';
import { house, restaurant, store } from './lowrise';
import { apartments, bankBlock, officeBlock } from './midrise';
import { isTowerKind, tower, towerBeacons, towerPlan, towerRuin, towerSite } from './towers';

export type { BuildingLook, HostedUnit } from './buildingCtx';


// ======================================================= kinds: homes

/** People standing in a building are this high above its ground (the trailer's floor is up on blocks). */
export function standHeight(b: Pick<Building, 'kind'>): number {
  return b.kind === 'trailer' ? TRAILER_FLOOR : 0.12;
}
const TRAILER_FLOOR = 0.62;

/**
 * A single-wide mobile home on blocks: vinyl siding with a stripe, skirting, a low metal roof, wooden
 * steps to the door under an aluminium awning, a window AC unit, a propane tank, maybe a carport.
 */
function trailer(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const W = Math.min(4.3, b.w - 0.5), D = Math.min(14.2, b.d - 0.6), Y = TRAILER_FLOOR, H = 2.55;
  const r = (k: number) => c.r(k);
  const sidingC = c.pick([hx('#f2efe6'), hx('#e8dcc4'), hx('#cfe0e3'), hx('#d9e4c8'), hx('#c9c4b8'), hx('#efe0c8'), hx('#dde3e8')], 1);
  const stripeC = c.pick([hx('#7a4a32'), hx('#3d5b8a'), hx('#7a2e2a'), hx('#4f6b3a'), hx('#8a7a5a')], 2);
  const skirtC = c.pick([hx('#c9c4b8'), hx('#9aa0a6'), hx('#e6e2d8'), hx('#a89a80')], 3);
  const roofC = hx('#c9ccd0');
  c.body = { cx: 0, cz: 0, w: W, d: D, storey: H, floors: 1, floor: hx('#a88a66'), base: Y + 0.1 };
  // a worn lawn with dirt patches and a gravel pad
  lotGround(c, 'lawn');
  for (let k = 0; k < 4; k++) g.box((r(10 + k) - 0.5) * (c.lw - 4), 0.05, (r(20 + k) - 0.5) * (c.ld - 4), 1.5 + r(30 + k) * 2.5, 0.015, 1.2 + r(40 + k) * 2, C.dirt, r(50 + k), false);
  g.box(0, 0.05, 0, W + 2.4, 0.02, D + 2, C.gravel, 0, false);
  // blocks and skirting (a few panels missing on shabby ones)
  const worn = b.condition < 0.6;
  c.sides(0, 0, W, D, (_s, len) => {
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i < n; i++) {
      if (worn && hash2(b.seed, 60 + i + len * 3) < 0.2) continue;
      g.box(-len / 2 + (i + 0.5) * (len / n), 0.05, -0.04, len / n - 0.04, Y - 0.05, 0.05, shade(skirtC, 0.92 + hash2(b.seed, 80 + i) * 0.1), 0, false);
    }
  });
  g.box(0, 0.05, 0, W - 0.3, Y - 0.06, D - 0.3, hx('#3a3530'));
  // the box: siding with a horizontal stripe, a low roof
  c.wall.box(0, Y, 0, W, H, D, sidingC);
  if (!c.cut) {
    c.sides(0, 0, W, D, (_s, len) => {
      for (let y = Y + 0.18; y < Y + H - 0.1; y += 0.2) g.box(0, y, 0.005, len, 0.015, 0.02, shade(sidingC, 0.9), 0, false);
      g.box(0, Y + 1.0, 0.02, len, 0.22, 0.03, stripeC, 0, false);
      g.box(0, Y + 1.3, 0.02, len, 0.06, 0.03, shade(stripeC, 1.3), 0, false);
    });
    g.slab([-W / 2 - 0.2, Y + H, D / 2 + 0.15, 0, Y + H + 0.32, D / 2 + 0.15, 0, Y + H + 0.32, -D / 2 - 0.15, -W / 2 - 0.2, Y + H, -D / 2 - 0.15], 0.06, roofC, -0.3, 1, 0, shade(roofC, 0.7));
    g.slab([0, Y + H + 0.32, D / 2 + 0.15, W / 2 + 0.2, Y + H, D / 2 + 0.15, W / 2 + 0.2, Y + H, -D / 2 - 0.15, 0, Y + H + 0.32, -D / 2 - 0.15], 0.06, roofC, 0.3, 1, 0, shade(roofC, 0.7));
    for (const sz of [-1, 1]) g.tri(-W / 2, Y + H, sz * D / 2, W / 2, Y + H, sz * D / 2, 0, Y + H + 0.3, sz * D / 2, sidingC, 0, 0, sz);
    // the tow hitch at the front end
    g.beam(-0.9, 0.45, D / 2, 0, 0.42, D / 2 + 1.5, 0.12, C.iron);
    g.beam(0.9, 0.45, D / 2, 0, 0.42, D / 2 + 1.5, 0.12, C.iron);
    g.box(0, 0.05, D / 2 + 1.45, 0.12, 0.42, 0.12, C.iron);
  }
  // windows along both sides and the ends; the door on the right side
  const doorZ = D / 2 - 3.6;
  c.sides(0, 0, W, D, (s, len) => {
    if (s === 0 || s === 2) {
      c.window(0, Y + 0.95, 1.5, 0.9, 'res', hx('#c9ccd0'), { sill: false });
      return;
    }
    const n = 5;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + 1.0 + (i / (n - 1)) * (len - 2);
      const local = s === 1 ? -u : u; // z of this spot (side 1 runs back to front)
      if (s === 1 && Math.abs(local - doorZ) < 1.0) continue;
      c.window(u, Y + 0.9, i === 2 ? 0.6 : 1.0, i === 2 ? 0.5 : 0.95, 'res', hx('#c9ccd0'), { sill: false });
    }
    if (s === 1) {
      const u = -doorZ;
      c.door(u, 0.85, 2.0, hx('#f2efe6'), hx('#c9ccd0'), Y);
      // wooden steps and a little deck with a rail, an aluminium awning
      if (!c.cut) {
        g.box(u, 0.05, 0.8, 1.8, Y - 0.05, 1.5, C.woodLight);
        for (let k = 0; k < 3; k++) g.box(u, 0.05, 1.7 + k * 0.28, 1.0, Y * (1 - (k + 1) / 4), 0.3, shade(C.woodLight, 0.92));
        for (const sx of [-0.85, 0.85]) g.box(u + sx, Y, 1.45, 0.06, 0.9, 0.06, C.woodLight);
        g.box(u, Y + 0.9, 1.45, 1.76, 0.06, 0.08, C.woodLight);
        g.slab([u - 1.1, Y + 2.35, 1.5, u + 1.1, Y + 2.35, 1.5, u + 1.1, Y + 2.55, 0.02, u - 1.1, Y + 2.55, 0.02], 0.04, hx('#e8e8e4'), 0, 1, 0.5, hx('#b9bec2'));
        for (const sx of [-1.0, 1.0]) g.box(u + sx, Y, 1.45, 0.05, 2.35, 0.05, hx('#e8e8e4'), 0, false);
        c.glow.box(u + 0.6, Y + 2.1, 0.08, 0.14, 0.18, 0.1, GLOW_BULB);
        // a window AC unit and a propane tank on the other end
        g.box(-u + 1.0 * (doorZ > 0 ? -1 : 1), Y + 0.8, 0.3, 0.7, 0.45, 0.6, hx('#e6e6e2'));
      }
    }
  });
  // propane tank (a horizontal white cylinder) by the back end, or two upright bottles
  if (r(5) < 0.6) {
    g.tube(W / 2 + 0.9, 0.55, -D / 2 + 1.2, W / 2 + 0.9, 0.55, -D / 2 + 2.8, 0.42, 10, hx('#f2f2ee'), true, 0.42, hx('#e6e6e2'));
    for (const z of [-D / 2 + 1.5, -D / 2 + 2.5]) g.box(W / 2 + 0.9, 0.05, z, 0.5, 0.15, 0.2, C.concrete);
  } else for (let k = 0; k < 2; k++) g.cyl(W / 2 + 0.35, 0.05, -D / 2 + 1 + k * 0.45, 0.17, 0.17, 1.2, 8, hx('#e8e8e4'));
  // a carport with a car, or a pickup on the gravel
  const side = c.lw / 2 - W / 2;
  const carX = W / 2 + Math.min(side - 1.8, 4.2);
  if (side > 4) {
    if (r(6) < 0.45) {
      const roof = hx('#b9bec2');
      for (const [sx, sz] of [[-1.5, -2.8], [1.5, -2.8], [1.5, 2.8], [-1.5, 2.8]]) g.box(carX + sx, 0.05, D / 2 - 4 + sz, 0.1, 2.4, 0.1, roof);
      g.slab([carX - 1.7, 2.5, D / 2 - 1, carX + 1.7, 2.6, D / 2 - 1, carX + 1.7, 2.6, D / 2 - 7, carX - 1.7, 2.5, D / 2 - 7], 0.05, roof, 0, 1, 0, shade(roof, 0.75));
    }
    car(c, carX, D / 2 - 4, Math.PI + (r(7) - 0.5) * 0.1, c.pick(P.cars, 8));
  }
  // yard bits: plastic chairs, a grill, a clothesline, a dish on the roof
  if (!c.cut) {
    for (let k = 0; k < 2; k++) g.box(-W / 2 - 1.4 - k * 0.7, 0.05, D / 2 - 2 + k * 0.3, 0.5, 0.45, 0.5, C.white, 0, false);
    if (r(9) < 0.6) { g.cyl(-W / 2 - 1.6, 0.05, -1, 0.04, 0.04, 0.8, 4, C.iron); g.blob(-W / 2 - 1.6, 0.85, -1, 0.3, 0.2, 0.3, C.black, 8, 3); }
    if (r(11) < 0.5) {
      for (const z of [-4, 0]) g.box(-W / 2 - 2.6, 0.05, z - 1, 0.08, 1.8, 0.08, C.metal);
      g.box(-W / 2 - 2.6, 1.8, -3, 0.02, 0.02, 4, C.white, 0, false);
      for (let k = 0; k < 4; k++) g.box(-W / 2 - 2.6, 1.3, -4.5 + k * 0.9, 0.02, 0.5, 0.6, P.fabrics[(k + Math.floor(r(12) * 5)) % P.fabrics.length], 0, false);
    }
    if (r(13) < 0.55) { g.box(W / 2 - 0.6, Y + H + 0.15, -D / 4, 0.06, 0.6, 0.06, C.iron); g.tube(W / 2 - 0.6, Y + H + 0.7, -D / 4, W / 2 - 0.4, Y + H + 0.85, -D / 4 + 0.3, 0.35, 8, C.white, true, 0.05); }
  }
  if (c.r(14) < 0.6) tree(c, -c.lw / 2 + 2.2, -c.ld / 2 + 2.6, 1.0 + c.r(15) * 0.4, 1);
  if (c.lw > 14 && c.r(16) < 0.5) fence(c, -c.lw / 2 + 0.6, c.ld / 2 - 0.6, -1.5, c.ld / 2 - 0.6, 'chain');
  if (c.near) streetBits(c, W / 2 + 0.8, D / 2 + 0.5, 0, 9, ['bins']);
}

// ==================================================== kinds: service

function dealer(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const bw = b.w - 0.6, bd = b.d - 0.6, H = 5.0;
  const sd = bd * 0.74; // showroom depth (front part)
  const sz = bd / 2 - sd / 2; // showroom center z
  const frame = c.r(1) < 0.5 ? C.steel : C.dark;
  const backC = c.pick(P.indWalls, 2);
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: FLOOR_H, floors: 1, floor: C.tile, base: 0.19 };
  lotGround(c, 'paved');
  // service garage at the back
  const gd = bd - sd;
  c.wall.box(0, 0, -bd / 2 + gd / 2, bw, H - 0.6, gd, backC);
  // showroom: clear glass box
  g.box(0, 0, sz, bw, 0.18, sd, C.tile);
  if (!c.cut) {
    c.clear.box(0, 0.18, sz + 0.02, bw - 0.1, H - 0.3, sd - 0.04, hx('#a9c6d6'));
    // mullions
    for (let i = 0; i <= 6; i++) g.box(-bw / 2 + (i / 6) * bw, 0.18, bd / 2, 0.1, H - 0.3, 0.1, frame, 0, false);
    for (let i = 1; i < 4; i++) for (const sx of [-1, 1]) g.box(sx * bw / 2, 0.18, bd / 2 - (i / 4) * sd, 0.1, H - 0.3, 0.1, frame, 0, false);
    // roof + fascia in brand color
    g.box(0, H - 0.15, 0, bw + 0.6, 0.2, bd + 0.6, C.steel, 0, true);
    g.box(0, H - 0.6, bd / 2 + 0.3, bw + 0.6, 1.1, 0.12, c.brand);
    for (const sx of [-1, 1]) g.box(sx * (bw / 2 + 0.3), H - 0.6, 0, 0.12, 1.1, bd + 0.6, c.brand);
    // ceiling lights (visible through the glass)
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) c.glow.box(-bw / 3 + i * bw / 3, H - 0.4, sz - sd / 4 + k * sd / 2, 1.4, 0.06, 0.3, GLOW_BULB);
    // roll-up doors on the side of the garage
    c.sides(0, -bd / 2 + gd / 2, bw, gd, () => rollDoor(c, 0, 0, Math.min(3.2, gd - 1), 3.0, C.steel), [1]);
    c.sides(0, -bd / 2 + gd / 2, bw, gd, () => c.door(0, 1.0, 2.1, C.dark, C.dark), [3]);
  }
  // name on the fascia
  c.t.push(0, 0, bd / 2 + 0.37, 0);
  c.sign(c.look.firmName, 0, H - 0.5, Math.min(bw - 3, 9), 0.9, 0);
  c.t.pop();
  // pylon sign at the street
  const px = bw / 2 - 0.5, pz = c.ld / 2 - 1.2;
  g.box(px, 0.05, pz, 0.35, 5.2, 0.35, C.steel);
  g.box(px, 4.4, pz, 3.6, 1.5, 0.4, c.brandDark);
  c.t.push(px, 0, pz + 0.2, 0);
  c.sign(c.look.firmName, 0, 4.55, 3.2, 1.0, 0);
  c.t.pop();
  c.t.push(px, 0, pz - 0.2, Math.PI);
  c.sign(c.look.firmName, 0, 4.55, 3.2, 1.0, 0);
  c.t.pop();
  // bunting flags along the front
  for (let i = 0; i < 10; i++) {
    const x = -bw / 2 + 0.5 + (i / 9) * (bw - 1);
    g.tri(x - 0.22, 3.2, c.ld / 2 - 0.6, x + 0.22, 3.2, c.ld / 2 - 0.6, x, 2.75, c.ld / 2 - 0.6, P.goods[(i + Math.floor(c.r(4) * 5)) % P.goods.length], 0, 0, 1);
  }
  g.box(0, 3.2, c.ld / 2 - 0.6, bw - 1, 0.02, 0.02, C.iron, 0, false);
  for (const sx of [-1, 1]) g.cyl(sx * (bw / 2 - 0.5), 0.05, c.ld / 2 - 0.6, 0.05, 0.05, 3.3, 4, C.iron);
  // display cars next to the layout's showroom spots (where customers stand):
  // outside on the front lot, inside on platforms
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'showroom') return;
    c.t.push(s.lx, 0, s.lz, s.facing);
    if (s.outside) {
      if (s.lz - 0.8 + 2.2 <= c.ld / 2) {
        g.box(1.6, 0.05, -0.8, 2.3, 0.1, 4.6, C.stoneLight);
        car(c, 1.6, -0.8, 0, c.pick(P.cars, 600 + i), 0.15);
      }
    } else {
      g.box(2.6, 0.18, 0, 4.7, 0.14, 2.4, hx('#e6e6e6'));
      car(c, 2.6, 0, Math.PI / 2, c.pick(P.cars, 600 + i), 0.32);
    }
    c.t.pop();
  });
}

// ==================================================== kinds: industry

function farm(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'meadow');
  const W = b.w, D = b.d;
  // fields fill the lot behind the farmstead (and beside it on big lots)
  const crops: Color3[] = [C.wheat, C.corn, C.veg, C.soil, C.canola];
  const field = (x0: number, x1: number, z0: number, z1: number, k: number) => {
    if (x1 - x0 < 1.5 || z1 - z0 < 1.5) return;
    const crop = Math.floor(hash2(b.seed, 20 + k) * crops.length);
    const col = crops[crop];
    const zc = (z0 + z1) / 2, dz = z1 - z0;
    g.box((x0 + x1) / 2, 0.05, zc, x1 - x0, 0.04, dz, shade(C.soil, crop === 3 ? 1.1 : 1.05), 0, false);
    const rows = Math.max(1, Math.floor((x1 - x0) / 1.3));
    const hgt = crop === 1 ? 1.3 : crop === 3 ? 0.18 : crop === 2 ? 0.35 : crop === 4 ? 0.7 : 0.6;
    for (let r = 0; r < rows; r++) {
      const x = x0 + ((r + 0.5) / rows) * (x1 - x0);
      const rc = mix(col, C.white, hash2(b.seed, 100 + k * 50 + r) * 0.06);
      g.box(x, 0.05, zc, crop === 3 ? 0.5 : 0.8, hgt, dz - 0.4, crop === 3 ? shade(C.soil, 0.85) : rc, 0, false);
      if (crop === 1) g.box(x, 0.05 + hgt, zc, 0.5, 0.18, dz - 0.6, C.wheat, 0, false);
      if (crop === 4) g.box(x, 0.05 + hgt, zc, 0.9, 0.1, dz - 0.4, shade(C.canola, 1.1), 0, false);
    }
  };
  const fz0 = -c.ld / 2 + 1.0, fz1 = Math.min(-D / 2 - 2.0, c.ld / 2 - 4);
  const fx0 = -c.lw / 2 + 1.0, fx1 = c.lw / 2 - 1.0;
  if (fz1 - fz0 > 2) {
    const patches = 2 + Math.floor(c.r(1) * 2);
    for (let p = 0; p < patches; p++) field(lerp(fx0, fx1, p / patches) + 0.6, lerp(fx0, fx1, (p + 1) / patches) - 0.6, fz0, fz1, p);
    // field fence with a gate behind the barn
    fence(c, fx0 - 0.4, fz1 + 0.6, 1.0, fz1 + 0.6, 'rail', C.woodLight);
    fence(c, 4.0, fz1 + 0.6, fx1 + 0.4, fz1 + 0.6, 'rail', C.woodLight);
    fence(c, fx0 - 0.4, fz1 + 0.6, fx0 - 0.4, fz0 - 0.4, 'rail', C.woodLight);
    fence(c, fx1 + 0.4, fz1 + 0.6, fx1 + 0.4, fz0 - 0.4, 'rail', C.woodLight);
    fence(c, fx0 - 0.4, fz0 - 0.4, fx1 + 0.4, fz0 - 0.4, 'rail', C.woodLight);
  }
  const sideX = W / 2 + 6;
  if (c.lw / 2 - 1 - sideX > 5) {
    field(sideX, fx1, fz1 + 1.6, c.ld / 2 - 3, 7);
    field(fx0, -sideX, fz1 + 1.6, c.ld / 2 - 3, 8);
  }
  // barn (gable faces the street)
  const red = mix(hx('#a8463a'), hx('#8a3a30'), c.r(2));
  const barnW = Math.min(7.5, W * 0.52), barnD = D - 0.6, bx = W / 2 - barnW / 2 - 0.2;
  c.body = { cx: bx, cz: 0, w: barnW, d: barnD, storey: 4.2, floors: 1, floor: C.dirt };
  c.wall.box(bx, 0, 0, barnW, 4.2, barnD, red);
  gambrelRoof(c, bx, 4.2, 0, barnW, barnD, 3.4, c.r(3) < 0.5 ? hx('#4f4a48') : hx('#7a3b2e'), red);
  if (!c.cut) {
    c.t.push(bx, 0, barnD / 2, 0);
    g.box(0, 0, 0.03, 3.4, 3.5, 0.08, shade(red, 0.85), 0, false);
    g.box(0, 0, 0.08, 3.6, 0.15, 0.04, C.white, 0, false);
    g.box(0, 3.4, 0.08, 3.6, 0.15, 0.04, C.white, 0, false);
    for (const sx of [-1.75, 0, 1.75]) g.box(sx, 0, 0.08, 0.15, 3.5, 0.04, C.white, 0, false);
    g.beam(-1.7, 0.1, 0.1, -0.05, 3.4, 0.1, 0.12, C.white);
    g.beam(-0.05, 0.1, 0.1, -1.7, 3.4, 0.1, 0.12, C.white);
    g.beam(0.05, 0.1, 0.1, 1.7, 3.4, 0.1, 0.12, C.white);
    g.beam(1.7, 0.1, 0.1, 0.05, 3.4, 0.1, 0.12, C.white);
    g.box(0, 4.9, 0.05, 1.2, 1.2, 0.06, shade(red, 0.8), 0, false);
    g.box(0, 4.9, 0.09, 1.35, 0.1, 0.03, C.white, 0, false);
    c.t.pop();
  }
  // silo
  const sx = W / 2 + 1.4, sz = -D / 2 + 1.8;
  const siloC = c.r(4) < 0.5 ? hx('#c9c4b8') : hx('#5a7f9f');
  g.cyl(sx, 0.05, sz, 1.6, 1.6, 9.5, 12, siloC);
  for (let k = 1; k < 5; k++) g.cyl(sx, 0.05 + k * 1.9, sz, 1.63, 1.63, 0.1, 12, shade(siloC, 0.85), 0, false);
  g.blob(sx, 9.55, sz, 1.62, 1.3, 1.62, c.r(5) < 0.5 ? C.steel : hx('#a8463a'), 12, 6, true);
  // farmhouse
  const hw = Math.min(4.8, W - barnW - 2.0), hd = Math.min(5.2, D - 1.5), hx_ = -W / 2 + hw / 2 + 0.2, hz = 0.2;
  const fhC = c.pick(P.houseWalls, 6);
  c.wall.box(hx_, 0, hz - 0.5, hw, 3.0, hd, fhC);
  gableRoof(c, hx_, 3.0, hz - 0.5, hw, hd, 2.0, c.pick(P.roofs, 7), fhC, 0.4);
  chimney(c, hx_ - hw * 0.25, 3.0, hz - 1.2, 0.6, 2.4, C.stone);
  c.sides(hx_, hz - 0.5, hw, hd, (s, len) => {
    if (s === 0) { c.door(0, 0.95, 2.1, c.pick(P.doors, 8)); for (const u of [-len * 0.3, len * 0.3]) c.window(u, 1.0, 0.9, 1.1, 'res', C.trim, { cross: true }); }
    else c.window(0, 1.0, 0.9, 1.1, 'res', C.trim, { cross: true });
  });
  if (!c.cut) {
    g.box(hx_, 0, hz - 0.5 + hd / 2 + 0.7, hw - 0.6, 0.25, 1.4, C.woodLight);
    for (const px of [-1, 1]) g.box(hx_ + px * (hw / 2 - 0.5), 0.25, hz - 0.5 + hd / 2 + 1.3, 0.12, 2.2, 0.12, C.woodLight);
    g.slab([hx_ - hw / 2 + 0.2, 2.45, hz - 0.5 + hd / 2 + 1.5, hx_ + hw / 2 - 0.2, 2.45, hz - 0.5 + hd / 2 + 1.5, hx_ + hw / 2 - 0.2, 2.8, hz - 0.5 + hd / 2, hx_ - hw / 2 + 0.2, 2.8, hz - 0.5 + hd / 2], 0.1, c.pick(P.roofs, 7), 0, 1, 0.3);
  }
  // hay bales, tractor, driveway
  g.box(bx, 0.05, (D / 2 + c.ld / 2) / 2, 3.2, 0.03, c.ld / 2 - D / 2, C.dirt, 0, false);
  for (let k = 0; k < 4; k++) {
    const x = W / 2 + 1.1 + (k % 2) * 1.35, z = 0.2 + Math.floor(k / 2) * 1.6;
    g.tube(x - 0.6, 0.65, z, x + 0.6, 0.65, z, 0.65, 9, C.wheat, true, 0.65, shade(C.wheat, 0.85));
  }
  if (c.r(9) < 0.7) {
    const tx = bx + 0.5, tz = D / 2 + 3.2;
    c.t.push(tx, 0.05, tz, 0.4);
    const tc = c.r(10) < 0.5 ? hx('#c0392b') : hx('#3f8a3a');
    g.box(0, 0.6, 0.3, 1.0, 0.8, 2.0, tc);
    g.box(0, 1.4, -0.3, 1.1, 1.1, 1.0, GLASS_DAY);
    g.box(0, 2.5, -0.3, 1.25, 0.08, 1.15, tc);
    g.cyl(0.25, 1.4, 1.0, 0.07, 0.07, 0.8, 5, C.iron);
    g.tube(-0.75, 0.75, -0.5, -0.45, 0.75, -0.5, 0.75, 9, C.tire, true, 0.75, C.yellow);
    g.tube(0.45, 0.75, -0.5, 0.75, 0.75, -0.5, 0.75, 9, C.tire, true, 0.75, C.yellow);
    g.tube(-0.6, 0.4, 1.0, -0.4, 0.4, 1.0, 0.4, 8, C.tire, true, 0.4, C.yellow);
    g.tube(0.4, 0.4, 1.0, 0.6, 0.4, 1.0, 0.4, 8, C.tire, true, 0.4, C.yellow);
    c.t.pop();
  }
  // vegetable garden + trees by the house
  const gz = hz + hd / 2 + 2.6;
  if (gz < c.ld / 2 - 1.5) for (let i = 0; i < 3; i++) g.box(hx_ - 1.2 + i * 1.2, 0.05, gz, 0.8, 0.22, 2.0, C.veg);
  tree(c, -W / 2 - 2.5, -1, 1.2, 1);
  tree(c, -W / 2 - 1.2, D / 2 + 3, 1.0, 2);
  // field workers' spots: nothing extra (the fields are the station)
}

function quarry(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'clay');
  const W = b.w, D = b.d;
  // a terraced, U-shaped pit face around the back and sides (tallest at the lot edge)
  const bands = [hx('#c98a5a'), hx('#d2b48a'), hx('#a89a88'), hx('#bf7f52'), hx('#b9a58a')];
  const back = -c.ld / 2 + 0.3, front = -D / 2 - 4.6; // keep the workers' face clear
  const stepB = Math.min(3.0, Math.max(0.7, (front - back) / 4));
  const sideRoom = c.lw / 2 - 0.3 - (W / 2 + 1.0);
  const stepS = Math.min(3.0, Math.max(0.6, sideRoom / 4));
  const sideFront = Math.min(c.ld / 2 - 4, D / 2 + 2);
  const lvlH = 1.5;
  g.box(0, 0.05, (back + sideFront) / 2, c.lw - 1, 0.03, sideFront - back, hx('#a88d6c'), 0, false);
  let seg = 0;
  for (let j = 4; j >= 1; j--) {
    const reach = (5 - j);
    const col = bands[j % bands.length];
    // back band, in rocky chunks
    const zIn = back + reach * stepB;
    for (let x = -c.lw / 2 + 0.3; x < c.lw / 2 - 0.3; x += 3) {
      const w = Math.min(3, c.lw / 2 - 0.3 - x);
      const jz = (hash2(b.seed, 3100 + seg) - 0.5) * stepB * 0.5, jh = (hash2(b.seed, 3200 + seg++) - 0.5) * 0.5;
      const z1 = zIn + jz;
      g.box(x + w / 2, 0.05, (back + z1) / 2, w + 0.05, j * lvlH + jh, z1 - back, mix(col, C.white, jh * 0.2 + 0.05));
    }
    // side bands
    for (const sx of [-1, 1]) {
      const xIn = c.lw / 2 - 0.3 - reach * stepS;
      for (let z = back; z < sideFront; z += 3) {
        const d = Math.min(3, sideFront - z);
        const jx = (hash2(b.seed, 3300 + seg) - 0.5) * stepS * 0.5, jh = (hash2(b.seed, 3400 + seg++) - 0.5) * 0.5;
        const taper = clamp01((sideFront - z) / 8);
        const w = (c.lw / 2 - 0.3) - (xIn + jx);
        g.box(sx * (c.lw / 2 - 0.3 - w / 2), 0.05, z + d / 2, w, Math.max(0.3, (j * lvlH + jh) * (0.35 + 0.65 * taper)), d + 0.05, mix(col, C.white, jh * 0.2 + 0.05));
      }
    }
  }
  // loose rocks on the pit floor
  for (let k = 0; k < 10; k++) {
    const x = (c.r(3500 + k) - 0.5) * (c.lw - 2 * (4 * stepS + 2)), z = lerp(back + 4 * stepB + 1, front, c.r(3510 + k));
    g.blob(x, 0.05, z, 0.5 + c.r(3520 + k) * 0.6, 0.4 + c.r(3530 + k) * 0.4, 0.5, bands[k % bands.length], 5, 3, true, k);
  }
  // haul track to the street
  g.box(-W / 2 - 1.2, 0.05, (D / 2 + c.ld / 2) / 2, 3.2, 0.035, c.ld / 2 - D / 2, hx('#a88d6c'), 0, false);
  // cut stone blocks
  for (let k = 0; k < 6; k++) {
    const x = W / 2 - 1.2 - (k % 3) * 1.2, z = D / 2 - 1.5 - Math.floor(k / 3) * 1.2;
    g.box(x, 0.05, z, 1.0, 0.8, 1.0, k % 2 ? C.stoneLight : hx('#d2b48a'), c.r(70 + k) * 0.3);
    if (k < 3) g.box(x, 0.85, z, 0.9, 0.7, 0.9, hx('#c8b9a0'), c.r(80 + k) * 0.4);
  }
  // site office container + conveyor + derrick
  const ox = -W / 2 + 2, oz = D / 2 - 2;
  c.body = { cx: ox, cz: oz, w: 3.0, d: 2.4, storey: 2.6, floors: 1, floor: C.concrete };
  c.wall.box(ox, 0.05, oz, 3.0, 2.6, 2.4, hx('#e0dccf'));
  if (!c.cut) {
    g.box(ox, 2.65, oz, 3.1, 0.1, 2.5, C.orange);
    c.sides(ox, oz, 3.0, 2.4, (s) => { if (s === 0) { c.door(-0.7, 0.9, 2.0, C.orange, C.dark, 0.05); c.window(0.6, 1.1, 0.9, 0.8, 'res', C.dark, { sill: false }); } }, [0]);
  }
  c.t.push(ox, 0, oz + 1.2, 0);
  c.sign(c.look.firmName, 0, 2.95, 2.6, 0.5, 0.02);
  c.t.pop();
  // conveyor feeding a gravel pile
  g.beam(-1, 0.4, front + 1.0, 1.5, 3.2, D / 2 - 4, 0.45, C.dark);
  g.box(-1, 0.05, front + 1.0, 0.2, 0.5, 0.2, C.iron);
  g.box(0.25, 0.05, (front + 1 + D / 2 - 4) / 2, 0.2, 1.8, 0.2, C.iron);
  pile(c, 1.8, D / 2 - 3.2, 1.8, 1.6, hx('#b5a48c'));
  // derrick crane
  const dx = -W / 2 + 1.5, dz = front + 1.5;
  g.cyl(dx, 0.05, dz, 0.18, 0.14, 6.5, 6, C.woodDark);
  g.beam(dx, 1.0, dz, dx + 3.5, 5.6, dz - 1.5, 0.18, C.woodDark);
  g.box(dx + 3.5, 1.8, dz - 1.5, 0.03, 3.8, 0.03, C.iron, 0, false);
  g.box(dx + 3.5, 1.0, dz - 1.5, 0.9, 0.8, 0.9, C.stoneLight);
  // quarriers' spots: stone blocks + picks
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'outdoor') return;
    g.box(s.lx, 0.05, s.lz - 0.6, 0.8, 0.6, 0.7, bands[i % 4], 0.2 * i);
    g.beam(s.lx + 0.5, 0.05, s.lz - 0.1, s.lx + 0.7, 0.8, s.lz - 0.3, 0.05, C.woodLight);
    g.box(s.lx + 0.72, 0.75, s.lz - 0.3, 0.5, 0.06, 0.06, C.steel);
  });
  // wheelbarrow
  g.box(W / 2 - 3.5, 0.4, D / 2 - 3.5, 0.7, 0.35, 1.0, C.orange);
  g.tube(W / 2 - 3.55, 0.2, D / 2 - 3.0, W / 2 - 3.45, 0.2, D / 2 - 3.0, 0.2, 6, C.tire);
}

function mine(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const W = b.w, D = b.d;
  const big = c.lw > W + 24;
  lotGround(c, big ? 'meadow' : 'gravel');
  if (big) {
    // gravel work yard around the pithead, meadow elsewhere
    const x0 = -Math.min(c.lw / 2 - 1, W / 2 + 9), x1 = Math.min(c.lw / 2 - 1, W / 2 + 11);
    const z0 = Math.max(-c.ld / 2 + 1, -D / 2 - 9), z1 = c.ld / 2 - 0.5;
    c.solid.box((x0 + x1) / 2, 0.05, (z0 + z1) / 2, x1 - x0, 0.03, z1 - z0, C.gravel, 0, false);
    for (let k = 0; k < 6; k++) tree(c, (c.r(3600 + k) < 0.5 ? -1 : 1) * (c.lw / 2 - 2 - c.r(3610 + k) * 6), -c.ld / 2 + 3 + c.r(3620 + k) * (c.ld - 8), 1 + c.r(3630 + k) * 0.4, 60 + k);
  }
  const frameC = c.r(1) < 0.5 ? hx('#8a2f28') : hx('#5d6670');
  // headframe
  const hx0 = 1.5, hz0 = -1.0, top = 13;
  c.body = { cx: -W / 2 + 3.2, cz: D / 2 - 2.8, w: 5.2, d: 4.6, storey: 4.2, floors: 1, floor: C.concrete };
  g.box(hx0, 0.05, hz0, 3.2, 0.6, 3.2, C.concrete);
  g.box(hx0, 0.62, hz0, 2.0, 0.02, 2.0, C.black, 0, false);
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) g.beam(hx0 + sx * 1.9, 0.5, hz0 + sz * 1.9, hx0 + sx * 0.8, top, hz0 + sz * 0.8, 0.28, frameC);
  for (let lv = 1; lv <= 4; lv++) {
    const y = 0.5 + (lv / 4.4) * (top - 0.5), s = lerp(1.9, 0.8, y / top);
    g.box(hx0, y, hz0 + s, s * 2, 0.16, 0.16, frameC, 0, false);
    g.box(hx0, y, hz0 - s, s * 2, 0.16, 0.16, frameC, 0, false);
    g.box(hx0 + s, y, hz0, 0.16, 0.16, s * 2, frameC, 0, false);
    g.box(hx0 - s, y, hz0, 0.16, 0.16, s * 2, frameC, 0, false);
  }
  for (const sz of [-1, 1]) {
    g.beam(hx0 - 1.9, 0.5, hz0 + sz * 1.9, hx0 + 1.4, top * 0.45, hz0 + sz * 1.4, 0.12, frameC);
    g.beam(hx0 + 1.9, 0.5, hz0 + sz * 1.9, hx0 - 1.4, top * 0.45, hz0 + sz * 1.4, 0.12, frameC);
  }
  g.box(hx0, top, hz0, 2.2, 0.3, 2.2, frameC);
  for (const wz of [-0.45, 0.45]) {
    g.tube(hx0 - 0.06, top + 1.1, hz0 + wz, hx0 + 0.06, top + 1.1, hz0 + wz, 1.05, 12, C.dark, true, 1.05, C.steel);
    g.box(hx0, top + 0.3, hz0 + wz, 0.2, 0.8, 0.2, frameC);
  }
  // back strut toward the hoist house + cables
  const hhx = -W / 2 + 3.2, hhz = D / 2 - 2.8;
  g.beam(hx0, top - 0.5, hz0, (hx0 + hhx) / 2, 0.05, (hz0 + hhz) / 2, 0.3, frameC);
  g.beam(hx0, top + 1.1, hz0 + 0.45, hhx + 1.5, 3.4, hhz - 1.5, 0.04, C.iron);
  g.beam(hx0, top + 1.1, hz0 - 0.45, hhx + 1.5, 3.2, hhz - 1.5, 0.04, C.iron);
  c.glow.box(hx0, top + 0.3, hz0 + 1.1, 0.25, 0.25, 0.25, GLOW_RED);
  // hoist house
  const houseC = c.r(2) < 0.5 ? c.pick(P.bricks, 3) : c.pick(P.indWalls, 4);
  c.wall.box(hhx, 0, hhz, 5.2, 4.2, 4.6, houseC);
  gableRoof(c, hhx, 4.2, hhz, 5.2, 4.6, 1.6, c.pick(P.indRoofs, 5), houseC, 0.35);
  chimney(c, hhx - 1.6, 4.2, hhz - 0.8, 0.6, 3.0, C.stone);
  c.sides(hhx, hhz, 5.2, 4.6, (s, len) => {
    if (s === 0) { c.door(-1.2, 1.1, 2.3, C.dark, C.dark); c.window(1.0, 1.2, 1.2, 1.4, 'ind', C.dark, { cross: true }); }
    else highWindows(c, len, 1.4, 1.3, 2.2);
  });
  c.t.push(hhx, 0, hhz + 2.3, 0);
  c.sign(c.look.firmName, 0, 3.2, 3.6, 0.6, 0.02);
  c.t.pop();
  // rails + ore carts
  const rz = hz0 + 2.6;
  for (let x = hx0 - 0.5; x < c.lw / 2 - 1; x += 0.7) g.box(x, 0.05, rz, 0.18, 0.06, 1.3, C.woodDark, 0, false);
  for (const o of [-0.45, 0.45]) g.box((hx0 - 0.5 + c.lw / 2 - 1) / 2, 0.11, rz + o, c.lw / 2 - 1 - hx0 + 0.5, 0.08, 0.06, C.steel, 0, false);
  for (let k = 0; k < 2; k++) {
    const x = hx0 + 2.2 + k * 2.0;
    g.cyl(x, 0.35, rz, 0.85, 1.0, 0.9, 4, hx('#5a5f66'), Math.PI / 4);
    g.blob(x, 1.2, rz, 0.65, 0.35, 0.55, C.ore, 6, 4, true);
    for (const wx of [-0.4, 0.4]) g.tube(x + wx, 0.25, rz - 0.55, x + wx, 0.25, rz + 0.55, 0.2, 6, C.iron);
  }
  pile(c, c.lw / 2 - 2.5, rz + 2.5, 2.0, 1.5, C.ore);
  // ore bin over the track end
  const obx = Math.min(c.lw / 2 - 3, hx0 + 7.5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(obx + sx * 1.2, 0.05, rz + sz * 1.0, 0.25, 3.0, 0.25, C.woodDark);
  g.cyl(obx, 3.0, rz, 1.0, 2.0, 2.0, 4, frameC, Math.PI / 4);
  g.box(obx, 5.0, rz, 2.9, 0.12, 2.9, shade(frameC, 0.8));
  g.beam(obx + 0.8, 3.2, rz, obx + 2.0, 1.6, rz, 0.4, C.metal);
  // a spoil heap or a hill with a tunnel mouth at the back
  const room = c.ld / 2 - D / 2 - 4.5;
  if (room > 7) {
    const rzh = Math.min(10, room / 2), rx = Math.min(c.lw * 0.38, 18), hz = -c.ld / 2 + rzh + 0.5, hh = Math.min(9, rx * 0.55);
    g.blob(-c.lw * 0.1, 0.0, hz, rx, hh, rzh, hx('#7d8a5a'), 12, 6, true, 0.4);
    g.blob(-c.lw * 0.1 + rx * 0.3, 0.0, hz - rzh * 0.2, rx * 0.6, hh * 1.15, rzh * 0.7, hx('#6f7d50'), 10, 6, true, 1.1);
    // adit (tunnel mouth) with timber frame and rails out to the yard
    const ax = -c.lw * 0.1 - rx * 0.25, az = hz + rzh * 0.92;
    g.box(ax, 0.05, az - 0.3, 3.4, 3.2, 1.6, hx('#5e5a52'));
    g.box(ax, 0.05, az + 0.51, 2.2, 2.5, 0.02, C.black, 0, false);
    for (const sx of [-1.25, 1.25]) g.box(ax + sx, 0.05, az + 0.55, 0.3, 2.7, 0.3, C.woodDark);
    g.box(ax, 2.75, az + 0.55, 3.0, 0.35, 0.35, C.woodDark);
    c.glow.box(ax + 1.6, 2.9, az + 0.7, 0.2, 0.2, 0.2, GLOW_BULB);
    for (let z = az + 0.6; z < rz; z += 0.7) g.box(ax, 0.05, z, 1.3, 0.06, 0.18, C.woodDark, 0, false);
    for (const o of [-0.45, 0.45]) g.box(ax + o, 0.11, (az + 0.6 + rz) / 2, 0.06, 0.08, rz - az - 0.6, C.steel, 0, false);
    pile(c, c.lw / 2 - Math.min(6, c.lw * 0.15), hz + rzh * 0.3, Math.min(5, c.lw * 0.1), 3.0, hx('#6f6a63'));
  } else {
    pile(c, -c.lw / 2 + 3, -c.ld / 2 + 3, 3.2, 2.6, hx('#6f6a63'));
  }
  // pit props / timber for the shafts
  plankStack(c, c.lw / 2 - 2.5, D / 2 + 1.5 < c.ld / 2 - 2 ? D / 2 + 1.5 : -D / 2, 0, 3.5, 1.3, 4, C.woodDark);
  // miners' spots
  stationsOf(b).forEach((s) => {
    if (s.kind !== 'outdoor') return;
    g.blob(s.lx, 0.05, s.lz - 0.7, 0.55, 0.4, 0.45, C.ore, 6, 4, true);
    g.beam(s.lx + 0.5, 0.05, s.lz - 0.2, s.lx + 0.6, 0.85, s.lz - 0.35, 0.05, C.woodLight);
    g.box(s.lx + 0.62, 0.8, s.lz - 0.35, 0.5, 0.06, 0.06, C.steel);
  });
  lamp(c, -1.5, D / 2 + 0.5, 4.5, 0);
  lamp(c, c.lw / 2 - 1.5, -1, 4.5, -Math.PI / 2);
}

function constructionYard(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'gravel');
  lotFence(c, 'chain', [[0, 5]], 0.35);
  const W = b.w, D = b.d;
  // site office: stacked containers
  const cc = c.pick([C.yellow, hx('#3a6ea5'), C.white, C.orange], 1);
  const ox = -W / 2 + 3.2, oz = D / 2 - 1.8;
  c.body = { cx: ox, cz: oz, w: 6, d: 2.5, storey: 2.6, floors: 1, floor: C.floorWood };
  const box2 = (y: number, col: Color3) => {
    c.wall.box(ox, y, oz, 6.0, 2.6, 2.5, col);
    if (!c.cut) for (let u = -2.7; u <= 2.7; u += 0.45) g.box(ox + u, y + 0.1, oz + 1.26, 0.06, 2.4, 0.03, shade(col, 0.85), 0, false);
  };
  box2(0.05, cc);
  const two = c.r(2) < 0.6;
  if (two) {
    box2(2.65, c.r(3) < 0.5 ? C.white : shade(cc, 0.9));
    if (!c.cut) {
      g.beam(ox + 3.4, 0.05, oz + 0.2, ox + 3.4, 2.6, oz - 1.3, 0.25, C.iron);
      g.box(ox + 3.4, 2.6, oz - 1.0, 1.0, 0.08, 1.2, C.iron);
    }
  }
  c.sides(ox, oz, 6, 2.5, (s) => {
    if (s !== 0) return;
    c.door(-1.8, 0.9, 2.1, C.dark, C.dark, 0.05);
    c.window(0.4, 1.0, 1.4, 0.9, 'res', C.dark, { sill: false });
    c.window(2.0, 1.0, 1.0, 0.9, 'res', C.dark, { sill: false });
    if (two) { c.window(-1.0, 3.6, 1.4, 0.9, 'res', C.dark, { sill: false }); c.window(1.4, 3.6, 1.4, 0.9, 'res', C.dark, { sill: false }); }
  });
  c.t.push(ox, 0, oz + 1.25, 0);
  c.sign(c.look.firmName, 0, two ? 5.35 : 2.75, 4.6, 0.7, 0.02);
  c.t.pop();
  // open storage shed at the back right
  const sx = W / 2 - 3, sz = -D / 2 + 2.5;
  for (const [px, pz] of [[-2.5, -1.5], [2.5, -1.5], [2.5, 1.5], [-2.5, 1.5]]) g.box(sx + px, 0.05, sz + pz, 0.2, 3.2, 0.2, C.iron);
  if (!c.cut) g.slab([sx - 3, 3.3, sz + 1.8, sx + 3, 3.3, sz + 1.8, sx + 3, 3.8, sz - 1.8, sx - 3, 3.8, sz - 1.8], 0.1, c.pick(P.indRoofs, 4), 0, 1, 0.3);
  plankStack(c, sx - 1.2, sz, 0, 3, 1.1, 5);
  plankStack(c, sx + 1.2, sz, 0, 3, 1.1, 3, C.woodLight);
  // materials
  for (let k = 0; k < 4; k++) pallet(c, -W / 2 + 1.2 + k * 1.5, -D / 2 + 1.5, 0, C.brickRed, 0.8);
  for (let k = 0; k < 5; k++) g.box(0.5, 0.05 + k * 0.32, D / 2 - 5 + (k % 2) * 0.1, 6, 0.3, 0.3, hx('#7d858c'));
  for (let k = 0; k < 3; k++) g.tube(2.6 + k * 1.15, 0.6, -0.6, 2.6 + k * 1.15, 0.6, 1.4, 0.55, 10, C.concrete, true, 0.55, shade(C.concrete, 0.8));
  pile(c, -1.5, -0.8, 1.8, 1.3, C.sand);
  pile(c, -4.5, -1.0, 1.4, 1.0, C.gravel);
  // cement mixer
  const mx = 1.5, mz = D / 2 - 2.4;
  g.box(mx, 0.05, mz, 1.0, 0.7, 0.9, C.orange);
  g.tube(mx - 0.1, 0.9, mz - 0.1, mx + 0.4, 1.6, mz + 0.4, 0.55, 8, C.orange, true, 0.3, C.dark);
  // small tower crane
  smallCrane(c, -W / 2 + 1.6, -D / 2 + 4.5, 10, 9, 2.1 + c.r(5) * 0.8);
  // builders' spots out back
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'outdoor') return;
    if (Math.abs(s.lz) > c.ld / 2 - 0.5) return;
    const x = s.lx, z = s.lz - 0.7;
    if (i % 2) {
      g.box(x - 0.5, 0.05, z, 0.08, 0.75, 0.6, C.woodLight);
      g.box(x + 0.5, 0.05, z, 0.08, 0.75, 0.6, C.woodLight);
      g.box(x, 0.8, z, 1.6, 0.06, 0.25, C.planks);
    } else {
      g.box(x, 0.35, z, 0.6, 0.3, 0.9, C.orange);
      g.tube(x - 0.05, 0.2, z + 0.5, x + 0.05, 0.2, z + 0.5, 0.2, 6, C.tire);
    }
  });
  for (let k = 0; k < 3; k++) g.cyl(W / 2 - 0.8 - k * 0.6, 0.05, D / 2 + 0.6, 0.18, 0.03, 0.55, 6, C.orange);
}

/** A public plaza: paving, trees in planters, benches, a fountain or a statue, a speaker's stage at the back. */
function plaza(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'plaza');
  const W = b.w, D = b.d;
  const pave = hx('#e2d8c6'), band = hx('#c9bca4'), line = hx('#cfc3ad');
  g.box(0, 0.05, 0, W, 0.03, D, band, 0, false);
  g.box(0, 0.08, 0, W - 2.4, 0.03, D - 2.4, pave, 0, false);
  for (let x = -W / 2 + 3; x < W / 2 - 2; x += 3) g.box(x, 0.11, 0, 0.1, 0.006, D - 2.6, line, 0, false);
  for (let z = -D / 2 + 3; z < D / 2 - 2; z += 3) g.box(0, 0.11, z, W - 2.6, 0.006, 0.1, line, 0, false);
  // centerpiece toward the front: a fountain or a statue on a plinth
  const fz = D / 2 - 6.8;
  if (c.r(1) < 0.6) {
    g.cyl(0, 0.05, fz, 2.7, 2.7, 0.55, 16, C.stoneLight);
    g.cyl(0, 0.6, fz, 2.8, 2.8, 0.1, 16, shade(C.stoneLight, 0.9), 0, false);
    c.glass.cyl(0, 0.05, fz, 2.4, 2.4, 0.47, 16, C.water);
    g.cyl(0, 0.45, fz, 0.4, 0.32, 1.3, 8, C.stoneLight);
    g.cyl(0, 1.75, fz, 0.32, 1.1, 0.3, 12, C.stoneLight);
    c.glass.cyl(0, 1.8, fz, 1.0, 1.0, 0.26, 12, C.water);
    c.glass.cyl(0, 2.05, fz, 0.08, 0.05, 0.8, 6, mix(C.water, C.white, 0.4));
    c.glass.blob(0, 2.8, fz, 0.25, 0.18, 0.25, mix(C.water, C.white, 0.5), 6, 4);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; c.glass.tube(Math.cos(a) * 0.95, 2.0, fz + Math.sin(a) * 0.95, Math.cos(a) * 1.9, 0.55, fz + Math.sin(a) * 1.9, 0.05, 4, mix(C.water, C.white, 0.4)); }
  } else {
    const bronze = hx('#5f7a6a');
    g.box(0, 0.05, fz, 2.6, 0.4, 2.6, C.stone);
    g.box(0, 0.45, fz, 1.6, 2.0, 1.6, C.stoneLight);
    g.box(0, 2.45, fz, 1.9, 0.2, 1.9, C.stone);
    // a figure with a raised arm
    g.box(0, 2.65, fz, 0.7, 0.2, 0.5, bronze);
    for (const sx of [-0.15, 0.15]) g.box(sx, 2.85, fz, 0.2, 0.9, 0.25, bronze);
    g.box(0, 3.7, fz, 0.6, 0.85, 0.32, bronze);
    g.blob(0, 4.75, fz, 0.17, 0.2, 0.17, bronze, 6, 4);
    g.beam(-0.3, 4.4, fz, -0.6, 5.2, fz + 0.2, 0.13, bronze);
    g.beam(0.3, 4.45, fz, 0.42, 3.75, fz + 0.15, 0.12, bronze);
    c.t.push(0, 0, fz + 0.81, 0);
    g.box(0, 1.0, 0.0, 1.0, 0.45, 0.04, hx('#a08a50'), 0, false);
    c.t.pop();
  }
  // trees in planters along the sides, lamps in the corners
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    const z = -D / 2 + 4 + k * ((D - 8) / 3);
    planter(c, sx * (W / 2 - 1.4), z, 1.3, 1.3, true, 20 + k + (sx > 0 ? 10 : 0));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) lamp(c, sx * (W / 2 - 0.8), sz * (D / 2 - 0.8), 4.4, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
  // the speaker's stage at the back (-Z): a low platform, a backdrop with flags, a lectern
  const st = stationsOf(b).find((s) => s.kind === 'stage');
  const sx0 = st?.lx ?? 0, sz0 = st?.lz ?? -D / 2 + 3;
  g.box(sx0, 0.05, sz0 - 0.6, 7.5, 0.07, 4.2, hx('#b9ab94'));
  g.box(sx0, 0.05, sz0 + 1.45, 7.6, 0.075, 0.1, C.stone, 0, false);
  g.box(sx0, 0.05, sz0 - 2.5, 7.0, 3.4, 0.3, C.stoneLight);
  g.box(sx0, 3.45, sz0 - 2.5, 7.3, 0.2, 0.45, C.stone);
  c.t.push(sx0, 0, sz0 - 2.34, 0);
  g.box(0, 0.6, 0, 5.4, 2.4, 0.03, c.brand, 0, false);
  g.box(0, 0.75, 0.02, 4.8, 0.12, 0.02, C.white, 0, false);
  g.box(0, 2.75, 0.02, 4.8, 0.12, 0.02, C.white, 0, false);
  c.t.pop();
  for (const fx of [-3.2, 3.2]) {
    g.cyl(sx0 + fx, 0.12, sz0 - 1.8, 0.18, 0.18, 0.06, 8, C.dark);
    g.cyl(sx0 + fx, 0.12, sz0 - 1.8, 0.03, 0.03, 3.0, 5, hx('#c9a13b'));
    g.box(sx0 + fx + (fx < 0 ? 0.42 : -0.42), 2.1, sz0 - 1.8, 0.8, 1.0, 0.03, fx < 0 ? c.brand : C.white, 0, false);
    // PA speakers on stands
    g.box(sx0 + fx * 1.15, 0.12, sz0 + 0.6, 0.06, 1.6, 0.06, C.dark, 0, false);
    g.box(sx0 + fx * 1.15, 1.7, sz0 + 0.6, 0.45, 0.7, 0.4, C.dark);
  }
  c.t.push(sx0, 0.12, sz0, st?.facing ?? 0);
  g.box(0, 0, 0.62, 0.7, 0.05, 0.5, C.woodDark);
  g.poly([-0.3, 0.05, 0.82, 0.3, 0.05, 0.82, 0.34, 1.05, 0.86, -0.34, 1.05, 0.86], C.woodDark, 0, 0, 1);
  g.poly([0.3, 0.05, 0.42, -0.3, 0.05, 0.42, -0.34, 1.05, 0.48, 0.34, 1.05, 0.48], shade(C.woodDark, 0.85), 0, 0, -1);
  g.poly([0.3, 0.05, 0.82, 0.3, 0.05, 0.42, 0.34, 1.05, 0.48, 0.34, 1.05, 0.86], shade(C.woodDark, 0.9), 1, 0, 0);
  g.poly([-0.3, 0.05, 0.42, -0.3, 0.05, 0.82, -0.34, 1.05, 0.86, -0.34, 1.05, 0.48], shade(C.woodDark, 0.9), -1, 0, 0);
  g.slab([-0.37, 1.05, 0.9, 0.37, 1.05, 0.9, 0.37, 1.17, 0.44, -0.37, 1.17, 0.44], 0.03, C.woodDark, 0, 1, -0.3);
  g.box(0, 0.5, 0.875, 0.4, 0.28, 0.02, c.brand, 0, false);
  g.beam(0.12, 1.17, 0.62, 0.12, 1.45, 0.48, 0.015, C.dark);
  c.t.pop();
  // benches from the layout, bins beside some
  stationsOf(b).forEach((s, i) => {
    if (s.kind !== 'bench') return;
    bench(c, s.lx, s.lz, s.facing, 1.8);
    if (i % 3 === 0) {
      c.t.push(s.lx, 0.05, s.lz, s.facing);
      g.cyl(1.2, 0, -0.1, 0.22, 0.24, 0.85, 8, hx('#3f4a44'));
      c.t.pop();
    }
  });
}

/** A park: lawn, an oval path, trees, benches, and a pond, a gazebo or a playground in the middle. */
function park(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'lawn');
  const W = b.w, D = b.d;
  const rx = (W - 2) / 3 - 1.3, rz = (D - 2) / 3 - 1.3; // path ring just inside the benches
  const path = hx('#cdbb98'), edge = hx('#a99a7c');
  const ringPts = 36, pw = 1.9;
  for (let k = 0; k < ringPts; k++) {
    const a0 = (k / ringPts) * TAU, a1 = ((k + 1) / ringPts) * TAU;
    const p = (a: number, r: number) => [Math.cos(a) * (rx + r), 0.075, Math.sin(a) * (rz + r)];
    const A = p(a0, -pw / 2), B = p(a1, -pw / 2), Cc = p(a1, pw / 2), Dd = p(a0, pw / 2);
    g.poly([...A, ...Dd, ...Cc, ...B], path, 0, 1, 0);
  }
  // paths out to the edges (front entrance, sides)
  g.box(0, 0.05, (rz + c.ld / 2) / 2, 2.4, 0.03, c.ld / 2 - rz, path, 0, false);
  g.box(-(rx + c.lw / 2) / 2, 0.05, 0, c.lw / 2 - rx, 0.03, 1.8, path, 0, false);
  g.box((rx + c.lw / 2) / 2, 0.05, 0, c.lw / 2 - rx, 0.03, 1.8, path, 0, false);
  g.box(0, 0.05, c.ld / 2 - 0.5, 3.0, 0.035, 1.0, edge, 0, false);
  // centerpiece
  const feature = c.r(1) < 0.5 ? 'pond' : c.r(1) < 0.78 ? 'gazebo' : 'playground';
  const inR = Math.min(rx, rz) - 2.2;
  if (feature === 'pond') {
    const px = inR * 0.95, pz = inR * 0.75;
    const ell: number[] = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; ell.push(Math.cos(a) * px, 0.085, Math.sin(a) * pz); }
    c.glass.poly(ell, C.water, 0, 1, 0);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * TAU;
      g.blob(Math.cos(a) * (px + 0.15), 0.05, Math.sin(a) * (pz + 0.15), 0.42, 0.2, 0.35, k % 2 ? C.stone : C.stoneLight, 5, 3, true, k);
    }
    for (let k = 0; k < 6; k++) { const a = c.r(40 + k) * TAU; g.cyl(Math.cos(a) * px * 0.8, 0.05, Math.sin(a) * pz * 0.75, 0.05, 0.02, 0.9, 4, C.leafDark); }
    // a couple of ducks
    for (let k = 0; k < 2; k++) {
      const x = (c.r(50 + k) - 0.5) * px, z = (c.r(52 + k) - 0.5) * pz;
      g.blob(x, 0.1, z, 0.16, 0.1, 0.24, k ? C.white : hx('#7a6a4a'), 6, 3);
      g.blob(x, 0.24, z + 0.16, 0.07, 0.08, 0.07, k ? C.white : hx('#2f5e3a'), 5, 3);
      g.box(x, 0.22, z + 0.25, 0.04, 0.03, 0.07, C.orange, 0, false);
    }
  } else if (feature === 'gazebo') {
    const R = Math.min(3.4, inR);
    g.cyl(0, 0.05, 0, R + 0.3, R + 0.3, 0.35, 8, C.stoneLight, Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      g.box(Math.cos(a) * R, 0.4, Math.sin(a) * R, 0.18, 2.6, 0.18, C.white);
      if (k !== 2) g.box(Math.cos(a + Math.PI / 8) * R * 0.95, 0.4, Math.sin(a + Math.PI / 8) * R * 0.95, 0.06, 0.8, R * 0.72, C.white, -(a + Math.PI / 8) + Math.PI / 2);
    }
    g.cyl(0, 3.0, 0, R + 0.5, R + 0.5, 0.2, 8, C.white, Math.PI / 8);
    g.cyl(0, 3.2, 0, R + 0.5, 0.15, 1.8, 8, hx('#4f6e5a'), Math.PI / 8);
    g.cyl(0, 5.0, 0, 0.1, 0.02, 0.6, 4, C.yellow);
  } else {
    // playground: sandbox, swings, a slide
    g.box(-2.2, 0.05, 0, 3.4, 0.25, 3.4, C.woodLight);
    g.box(-2.2, 0.06, 0, 3.0, 0.25, 3.0, C.sand);
    const sw = hx('#c0392b');
    for (const sz of [-1.2, 1.2]) { g.beam(1.2, 0.05, sz - 0.6, 2.2, 2.4, sz, 0.1, sw); g.beam(3.2, 0.05, sz - 0.6, 2.2, 2.4, sz, 0.1, sw); g.beam(1.2, 0.05, sz + 0.6, 2.2, 2.4, sz, 0.1, sw); g.beam(3.2, 0.05, sz + 0.6, 2.2, 2.4, sz, 0.1, sw); }
    g.box(2.2, 2.35, 0, 0.12, 0.12, 2.6, sw);
    for (const sz of [-0.6, 0.6]) { g.box(2.2, 0.55, sz, 0.45, 0.05, 0.2, C.dark); g.box(2.2, 0.6, sz - 0.08, 0.02, 1.75, 0.02, C.metal, 0, false); g.box(2.2, 0.6, sz + 0.08, 0.02, 1.75, 0.02, C.metal, 0, false); }
    g.box(0, 0.05, -inR + 1.2, 1.0, 1.6, 1.0, hx('#2e86c1'));
    g.slab([-0.35, 1.65, -inR + 1.7, 0.35, 1.65, -inR + 1.7, 0.35, 0.1, -inR + 4.0, -0.35, 0.1, -inR + 4.0], 0.06, C.yellow, 0, 1, 0.5);
    g.box(0, 0.05, -inR + 0.55, 0.6, 1.6, 0.06, C.metal, 0, false);
  }
  // trees around, kept off the paths, benches and standing spots
  const spots = stationsOf(b);
  const clear = (x: number, z: number) => {
    const e = Math.hypot(x / rx, z / rz);
    if (e > 0.72 && e < 1.32) return false;
    if (Math.abs(x) < 2.2 && z > 0) return false;
    if (Math.abs(z) < 1.8 && Math.abs(x) > rx) return false;
    if (e < (feature === 'pond' ? 0.85 : 0.7)) return false;
    for (const s of spots) if (Math.hypot(s.lx - x, s.lz - z) < 2.2) return false;
    return Math.abs(x) < c.lw / 2 - 1.2 && Math.abs(z) < c.ld / 2 - 1.2;
  };
  let n = 0;
  for (let k = 0; k < 60 && n < 16; k++) {
    const x = (c.r(100 + k) - 0.5) * (c.lw - 2), z = (c.r(200 + k) - 0.5) * (c.ld - 2);
    if (!clear(x, z)) continue;
    tree(c, x, z, 0.9 + c.r(300 + k) * 0.6, 60 + k);
    n++;
  }
  for (let k = 0; k < 8; k++) {
    const x = (c.r(400 + k) - 0.5) * (c.lw - 3), z = (c.r(500 + k) - 0.5) * (c.ld - 3);
    if (clear(x, z)) bush(c, x, z, 0.9 + c.r(600 + k) * 0.5, k % 3 ? C.leafDark : C.leaf);
  }
  // flower beds by the entrance
  for (const sx of [-1, 1]) {
    g.box(sx * 2.6, 0.05, c.ld / 2 - 2.6, 1.6, 0.2, 2.4, C.soil);
    for (let k = 0; k < 6; k++) g.blob(sx * 2.6 + ((k % 2) - 0.5) * 0.7, 0.3, c.ld / 2 - 3.5 + Math.floor(k / 2) * 0.8, 0.25, 0.2, 0.25, [C.flowerPink, C.yellow, C.red, C.white][(k + (sx > 0 ? 1 : 0)) % 4], 5, 3);
  }
  // benches from the layout; lamps along the ring
  for (const s of spots) if (s.kind === 'bench') bench(c, s.lx, s.lz, s.facing, 1.8);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.5;
    lamp(c, Math.cos(a) * (rx + pw / 2 + 0.4), Math.sin(a) * (rz + pw / 2 + 0.4), 4.0, -a - Math.PI / 2);
  }
  // entrance sign
  for (const sx of [-1.6, 1.6]) g.box(sx, 0.05, c.ld / 2 - 0.9, 0.35, 1.6, 0.35, C.stone);
  c.t.push(0, 0, c.ld / 2 - 0.7, 0);
  c.sign(c.look.firmName ?? 'City Park', 0, 1.7, 3.0, 0.55, 0.0, hx('#2f5e3a'));
  c.t.pop();
}

// ============================================== construction + ruins

const TIMBER_KINDS = new Set<BuildingKind>(['house', 'farm', 'lumberyard', 'quarry', 'claypit', 'mine', 'yard']);
const totals = new Map<string, number>();
function materialTotal(kind: BuildingKind, floors: number): number {
  const key = kind + floors;
  let t = totals.get(key);
  if (t === undefined) { t = invTotal(materialsFor(kind, floors)); totals.set(key, t); }
  return t;
}

function progressOf(b: Building): number {
  return clamp01(b.workDone / Math.max(1, b.workNeeded));
}

function deliveredOf(b: Building): number {
  const total = materialTotal(b.kind, b.floors);
  return total > 0 ? clamp01(1 - invTotal(b.needed) / total) : 1;
}

function site(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const p = progressOf(b);
  const delivered = deliveredOf(b);
  const def = BUILDINGS[b.kind];
  const multi = def.category === 'home' || b.kind === 'office' || b.kind === 'store' || b.kind === 'textile' || b.kind === 'electronics';
  const floors = multi ? Math.max(1, b.floors) : 1;
  const storey = multi ? FLOOR_H : def.category === 'industry' ? 5.5 : 4.0;
  const H = floors * storey;
  const W = Math.max(3, b.w - 0.8), D = Math.max(3, b.d - 0.8);
  const timber = TIMBER_KINDS.has(b.kind);
  const colC = timber ? C.woodLight : C.concrete;
  lotGround(c, 'dirt');
  // stakes & strings while nothing is built yet
  if (p < 0.03) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * W / 2, 0.05, sz * D / 2, 0.1, 0.8, 0.1, C.woodLight);
    for (const s of [-1, 1]) {
      g.box(0, 0.75, s * D / 2, W, 0.02, 0.02, C.white, 0, false);
      g.box(s * W / 2, 0.75, 0, 0.02, 0.02, D, C.white, 0, false);
    }
    g.box(0, -0.4, 0, W - 0.6, 0.47, D - 0.6, shade(C.dirt, 0.8), 0, false);
  } else {
    g.box(0, 0, 0, W + 0.3, 0.35, D + 0.3, C.concrete);
  }
  const top = p * H; // current height of the structure
  c.body = { cx: 0, cz: 0, w: W, d: D, storey, floors, floor: C.concrete };
  if (p >= 0.03) {
    // columns on a grid
    const nx = Math.max(1, Math.round(W / 3.6)), nz = Math.max(1, Math.round(D / 3.6));
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const edge = i === 0 || k === 0 || i === nx || k === nz;
      if (!edge && (i + k) % 2) continue;
      const x = -W / 2 + (i / nx) * W, z = -D / 2 + (k / nz) * D;
      const h = Math.max(0.3, top - 0.35 - (edge ? 0 : 0.4) - hash2(b.seed, 900 + i * 7 + k) * (top % storey) * 0.6);
      g.box(x, 0.35, z, timber ? 0.18 : 0.32, h, timber ? 0.18 : 0.32, colC);
    }
    // finished slabs and walled-in lower floors
    const done = Math.floor(top / storey + 0.001);
    const wallC = timber ? C.planks : b.kind === 'office' ? hx('#9aa3ab') : hx('#b8a690');
    for (let f = 1; f <= done; f++) {
      const y = f * storey;
      if (f < floors || !timber) g.box(0, y - 0.25, 0, W + 0.1, 0.25, D + 0.1, timber ? C.woodLight : C.concrete);
      if (f < done || p > 0.95) {
        // walls with openings
        c.sides(0, 0, W, D, (s, len) => {
          const n = Math.max(2, Math.round(len / 1.8));
          for (let i = 0; i < n; i++) {
            if (hash2(b.seed, 1000 + f * 31 + s * 7 + i) < 0.35) continue;
            const u = -len / 2 + (i + 0.5) * (len / n);
            g.box(u, (f - 1) * storey + 0.35, -0.12, len / n - 0.05, storey - 0.6, 0.2, wallC);
          }
        });
      }
    }
    if (timber && p > 0.8) {
      // roof trusses
      const n = Math.max(2, Math.round(W / 1.2));
      for (let i = 0; i <= n; i++) {
        const x = -W / 2 + (i / n) * W;
        g.beam(x, H, D / 2, x, H + 2.0, 0, 0.12, C.woodLight);
        g.beam(x, H, -D / 2, x, H + 2.0, 0, 0.12, C.woodLight);
      }
      g.box(0, H + 1.9, 0, W, 0.14, 0.14, C.woodLight);
    }
    // scaffolding
    if (H > 3 && p < 0.98) {
      const sh = Math.min(top + 1.0, H + 1.0);
      const off = 0.9;
      c.sides(0, 0, W + off * 2, D + off * 2, (_s, len) => {
        const n = Math.max(1, Math.round(len / 2.5));
        for (let i = 0; i <= n; i++) {
          const u = -len / 2 + (i / n) * len;
          g.box(u, 0.05, -0.05, 0.07, sh, 0.07, C.metal, 0, false);
          g.box(u, 0.05, -0.75, 0.07, sh, 0.07, C.metal, 0, false);
        }
        for (let y = 2.0; y < sh; y += 2.0) {
          g.box(0, y, -0.4, len, 0.06, 0.75, C.planks, 0, true);
          g.box(0, y + 1.0, -0.02, len, 0.05, 0.05, C.orange, 0, false);
        }
        for (let i = 0; i < n; i += 2) {
          const u0 = -len / 2 + (i / n) * len, u1 = -len / 2 + ((i + 1) / n) * len;
          g.beam(u0, 0.1, 0, u1, Math.min(sh, 4.0), 0, 0.04, C.metal);
        }
      });
    }
  }
  // tower crane for tall buildings
  if (floors >= 3) {
    const jib = Math.max(W, D) + 6;
    towerCrane(c, -W / 2 - 2.6, -D / 2 - 2.6, H + 8, jib, Math.PI * 0.25 + c.r(5) * 1.2);
  }
  // material piles
  const mats = materialsFor(b.kind, b.floors);
  const left = clamp01(delivered - p * 0.85);
  const goodsCols: Partial<Record<Good, Color3>> = { planks: C.planks, bricks: C.brickRed, steel: hx('#7d858c'), wood: C.log, stone: C.stoneLight, furniture: hx('#d8cfb8'), computers: hx('#3a6ea5'), clay: C.clay };
  let k = 0;
  const pileX = W / 2 + 1.6 < c.lw / 2 - 0.8 ? W / 2 + 1.6 : W / 2 - 1.0;
  for (const good of Object.keys(goodsCols) as Good[]) {
    if (!(mats[good] > 0)) continue;
    const z = -D / 2 + 1.2 + k * 1.9;
    if (z > c.ld / 2 - 1) break;
    const amt = 0.25 + left * 0.75;
    const col = goodsCols[good]!;
    if (good === 'planks') plankStack(c, pileX, z, 0, 2.6, 1.1, Math.max(1, Math.round(amt * 5)));
    else if (good === 'wood') logPile(c, pileX, z, 0, 2.6, Math.max(1, Math.round(amt * 3)), 0.25);
    else if (good === 'steel') for (let i = 0; i < Math.max(1, Math.round(amt * 5)); i++) g.box(pileX, 0.05 + i * 0.22, z, 0.9, 0.2, 3.0, col);
    else if (good === 'stone' || good === 'clay') pile(c, pileX, z, 0.9, 0.4 + amt * 0.6, col);
    else pallet(c, pileX, z, 0, col, 0.3 + amt * 0.8);
    k++;
  }
  // a cement mixer, a portable toilet and a sign
  if (!timber) {
    g.box(-W / 2 + 0.5, 0.05, D / 2 + 1.5, 0.9, 0.6, 0.8, C.orange);
    g.tube(-W / 2 + 0.4, 0.8, D / 2 + 1.4, -W / 2 + 0.8, 1.4, D / 2 + 1.9, 0.45, 8, C.orange, true, 0.25, C.dark);
  }
  if (H > 4) {
    g.box(-c.lw / 2 + 1.2, 0.05, -c.ld / 2 + 1.2, 1.2, 2.3, 1.2, hx('#2e6da4'));
    g.box(-c.lw / 2 + 1.2, 2.35, -c.ld / 2 + 1.2, 1.3, 0.08, 1.3, C.white);
  }
  // hoarding along the front with a gate
  if (c.ld / 2 - D / 2 > 2) {
    fence(c, -c.lw / 2 + 0.5, c.ld / 2 - 0.6, -2.5, c.ld / 2 - 0.6, 'hoarding');
    fence(c, 2.5, c.ld / 2 - 0.6, c.lw / 2 - 0.5, c.ld / 2 - 0.6, 'hoarding');
    c.t.push(0, 0, c.ld / 2 - 0.5, 0);
    c.sign(c.look.firmName, -c.lw / 4 - 1, 0.9, Math.min(4, c.lw / 2 - 3), 0.9, 0.05, hx('#2e6da4'));
    c.t.pop();
  }
  for (let i = 0; i < 3; i++) g.cyl(-1.5 + i * 1.5, 0.05, c.ld / 2 - 1.4, 0.18, 0.03, 0.55, 6, C.orange);
  if (c.near && p >= 0.03) siteExtras(c, W, D, H, top, timber);
}

function ruin(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'dirt');
  const W = Math.max(3, b.w - 1), D = Math.max(3, b.d - 1);
  const def = BUILDINGS[b.kind];
  const wallC = def.category === 'home' ? c.pick(P.houseWalls, 1) : def.category === 'industry' ? c.pick(P.indWalls, 1) : c.pick(P.plaster, 1);
  const cols = [shade(wallC, 0.75), C.rubble, shade(C.rubble, 0.8), c.pick(P.bricks, 2), shade(C.woodDark, 0.8), C.concrete];
  // foundation + jagged wall stubs
  g.box(0, 0, 0, W + 0.2, 0.3, D + 0.2, shade(C.concrete, 0.85));
  c.sides(0, 0, W, D, (s, len) => {
    const n = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i < n; i++) {
      const hgt = hash2(b.seed, 1200 + s * 40 + i);
      if (hgt < 0.3) continue;
      const u = -len / 2 + (i + 0.5) * (len / n);
      g.box(u, 0.3, -0.15, len / n + 0.02, 0.2 + hgt * hgt * 2.2, 0.28, shade(wallC, 0.7 + hgt * 0.2));
    }
  });
  // debris mounds + scattered pieces
  const mounds = 3 + Math.floor(c.r(3) * 3);
  for (let i = 0; i < mounds; i++) {
    const mx = (c.r(1300 + i) - 0.5) * W * 0.6, mz = (c.r(1310 + i) - 0.5) * D * 0.6;
    const r = Math.min(W, D) * (0.12 + c.r(1320 + i) * 0.12);
    g.blob(mx, 0.2, mz, r, 0.35 + c.r(1330 + i) * 0.7, r * (0.7 + c.r(1340 + i) * 0.5), mix(cols[i % cols.length], C.rubble, 0.5), 6, 4, true, i * 1.3);
  }
  const n = Math.round((W * D) / 5);
  for (let i = 0; i < n; i++) {
    const x = (hash2(b.seed, 1400 + i) - 0.5) * W * 1.1, z = (hash2(b.seed, 1500 + i) - 0.5) * D * 1.1;
    const s = 0.3 + hash2(b.seed, 1600 + i) * 0.9;
    g.box(x, 0.05 + hash2(b.seed, 1650 + i) * 0.3, z, s, s * 0.45, s * 0.8, cols[i % cols.length], hash2(b.seed, 1700 + i) * 3);
  }
  // charred beams
  for (let i = 0; i < 4; i++) {
    const x = (c.r(1800 + i) - 0.5) * W * 0.8, z = (c.r(1810 + i) - 0.5) * D * 0.8, a = c.r(1820 + i) * TAU;
    g.beam(x, 0.2, z, x + Math.cos(a) * 2.6, 0.2 + c.r(1830 + i) * 1.2, z + Math.sin(a) * 2.6, 0.2, hx('#3a2f28'));
  }
  // weeds
  for (let i = 0; i < 8; i++) bush(c, (c.r(1900 + i) - 0.5) * (c.lw - 2), (c.r(1910 + i) - 0.5) * (c.ld - 2), 0.6 + c.r(1920 + i) * 0.6, i % 2 ? C.leaf : hx('#7d8a4a'));
}

/** A waving flag on a pole top (current frame): field in `col` with a white band, hoisted at (x, y, z). */
function flag(c: Ctx, x: number, y: number, z: number, w: number, h: number, col: Color3, k: number): void {
  const g = c.solid;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const x0 = x + (i / segs) * w, x1 = x + ((i + 1) / segs) * w;
    const z0 = z + Math.sin(i * 1.3 + k) * 0.12, z1 = z + Math.sin((i + 1) * 1.3 + k) * 0.12;
    const dy0 = -i * 0.03, dy1 = -(i + 1) * 0.03;
    const band = i >= 1 && i <= 1 ? null : null;
    void band;
    // three horizontal stripes: color, white, color
    for (const [a, b2, cc] of [[0, 0.36, col], [0.36, 0.64, C.white], [0.64, 1, col]] as const) {
      g.poly([x0, y - h + a * h + dy0, z0, x1, y - h + a * h + dy1, z1, x1, y - h + b2 * h + dy1, z1, x0, y - h + b2 * h + dy0, z0], cc, 0, 0, 1);
      g.poly([x1, y - h + a * h + dy1, z1, x0, y - h + a * h + dy0, z0, x0, y - h + b2 * h + dy0, z0, x1, y - h + b2 * h + dy1, z1], cc, 0, 0, -1);
    }
  }
}

/** Seat of a government: a classical stone hall with steps, a portico, a clock tower or a dome, and flags. */
function cityhall(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(2, b.floors);
  lotGround(c, 'paved');
  const bw = b.w - 1.2, bd = b.d - 3.2, cz = -1.0, front = cz + bd / 2;
  const chamberH = 5.0;
  const H = (fl - 1) * FLOOR_H + chamberH;
  const stone = c.pick([hx('#e6dfcf'), hx('#d9cfbb'), hx('#ece6da')], 1);
  const trim = shade(stone, 0.88), dark = shade(stone, 0.72);
  const copper = hx('#5f8a78');
  c.body = { cx: 0, cz, w: bw, d: bd, storey: FLOOR_H, floors: fl, floor: hx('#b9a27a'), base: 0.15 };
  // plinth band around the walls (kept off the floor so the opened-up rooms aren't buried)
  c.sides(0, cz, bw, bd, (_s, len) => g.box(0, 0, 0.05, len + 0.5, 0.6, 0.3, dark));
  c.wall.box(0, 0, cz, bw, H, bd, stone);
  const pw = Math.min(bw * 0.5, 10.5), pd = 2.6, zf = front + pd;
  if (!c.cut) {
    for (let k = 1; k < 6; k++) g.box(0, 0.6 + k * 0.45, cz, bw + 0.06, 0.05, bd + 0.06, trim, 0, false);
    for (let f = 1; f < fl; f++) g.box(0, f * FLOOR_H - 0.12, cz, bw + 0.16, 0.22, bd + 0.16, trim, 0, false);
    g.box(0, H - 0.55, cz, bw + 0.5, 0.55, bd + 0.5, trim, 0, true);
    g.box(0, H, cz, bw + 0.24, 0.12, bd + 0.24, dark);
    // balustrade around the roof
    c.sides(0, cz, bw, bd, (_s, len) => {
      g.box(0, H + 0.12, -0.15, len, 0.12, 0.3, trim);
      g.box(0, H + 0.85, -0.15, len + 0.1, 0.12, 0.34, trim);
      for (let u = -len / 2 + 0.25; u < len / 2; u += 0.42) g.cyl(u, H + 0.24, -0.15, 0.08, 0.06, 0.61, 6, stone);
    });
  }
  // tall arched windows between pilasters; doors behind the portico
  c.sides(0, cz, bw, bd, (s, len) => {
    const n = Math.max(3, Math.floor(len / 2.6));
    for (let f = 0; f < fl; f++) {
      const topF = f === fl - 1;
      const y0 = f * FLOOR_H + (f === 0 ? 1.15 : 0.9);
      const wh = topF ? chamberH - 1.7 : 1.85;
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (i + 0.5) * (len / n);
        if (s === 0 && Math.abs(u) < pw / 2 + 0.4 && f < fl - 1) continue;
        c.window(u, y0, 1.1, wh, 'res', C.white, { cross: true, arch: true });
      }
      if (!c.cut && f > 0) for (let i = 0; i <= n; i++) g.box(-len / 2 + i * (len / n), f * FLOOR_H + 0.1, 0.04, 0.4, (topF ? chamberH : FLOOR_H) - 0.3, 0.12, trim, 0, false);
    }
    if (s === 0) for (const u of [-pw / 3, 0, pw / 3]) c.door(u, 1.3, 3.0, C.woodDark, trim, 0.6);
    if (s === 2) c.door(0, 1.2, 2.4, C.woodDark, trim, 0.15);
  });
  // portico: platform, steps, columns, entablature with the carved name, pediment
  g.box(0, 0, front + pd / 2, pw + 1.2, 0.6, pd, stone);
  for (let k = 0; k < 3; k++) g.box(0, 0, zf + 0.18 + k * 0.36, pw + 1.6 + k * 0.5, 0.45 - k * 0.15, 0.36, k % 2 ? stone : trim);
  const cols = 6, colTop = H - 1.35;
  for (let i = 0; i < cols; i++) {
    const x = -pw / 2 + 0.4 + (i * (pw - 0.8)) / (cols - 1);
    g.box(x, 0.6, zf - 0.45, 0.78, 0.25, 0.78, trim);
    g.cyl(x, 0.85, zf - 0.45, 0.33, 0.28, colTop - 1.1, 12, C.white);
    g.box(x, colTop - 0.25, zf - 0.45, 0.82, 0.25, 0.82, trim);
  }
  g.box(0, colTop, front + pd / 2, pw + 0.8, 1.35 - 0.55 + 0.55, pd + 0.1, stone);
  g.box(0, colTop + 0.1, zf + 0.06, pw + 0.9, 0.12, 0.08, trim, 0, false);
  if (!c.cut) {
    c.t.push(0, 0, zf + 0.1, 0);
    c.sign(c.look.firmName ?? 'City Hall', 0, colTop + 0.28, Math.min(pw - 0.6, 9.5), 0.62, -0.09, undefined, 'carved');
    c.t.pop();
    const pb = H, pa = H + Math.min(2.2, pw * 0.18);
    g.poly([-pw / 2 - 0.45, pb, zf + 0.05, pw / 2 + 0.45, pb, zf + 0.05, 0, pa, zf + 0.05], stone, 0, 0, 1);
    g.slab([-pw / 2 - 0.6, pb - 0.05, zf + 0.25, 0, pa + 0.08, zf + 0.25, 0, pa + 0.08, front - 0.2, -pw / 2 - 0.6, pb - 0.05, front - 0.2], 0.15, copper, -0.5, 1, 0, shade(copper, 0.7));
    g.slab([0, pa + 0.08, zf + 0.25, pw / 2 + 0.6, pb - 0.05, zf + 0.25, pw / 2 + 0.6, pb - 0.05, front - 0.2, 0, pa + 0.08, front - 0.2], 0.15, copper, 0.5, 1, 0, shade(copper, 0.7));
    g.tube(0, pb + (pa - pb) * 0.38, zf + 0.06, 0, pb + (pa - pb) * 0.38, zf + 0.14, 0.42, 14, c.brand, true, 0.42, c.brand);
    g.tube(0, pb + (pa - pb) * 0.38, zf + 0.13, 0, pb + (pa - pb) * 0.38, zf + 0.17, 0.25, 10, hx('#e0b850'));
  }
  // clock tower or dome on the roof
  const tz = cz - 0.6;
  if (!c.cut) {
    if (c.r(4) < 0.55) {
      const tw = 3.6, th = 5.2;
      g.box(0, H, tz, tw, th, tw, stone);
      g.box(0, H + th, tz, tw + 0.4, 0.3, tw + 0.4, trim);
      for (let k = 0; k < 4; k++) {
        c.t.push(0, 0, tz, (k * Math.PI) / 2);
        g.tube(0, H + 3.4, tw / 2, 0, H + 3.4, tw / 2 + 0.06, 1.05, 18, trim, true, 1.05, trim);
        g.tube(0, H + 3.4, tw / 2 + 0.05, 0, H + 3.4, tw / 2 + 0.1, 0.92, 18, hx('#f7f3e8'), true, 0.92, hx('#f7f3e8'));
        for (let m = 0; m < 12; m++) { const a = (m / 12) * TAU; g.box(Math.sin(a) * 0.8, H + 3.4 + Math.cos(a) * 0.8 - 0.04, tw / 2 + 0.11, 0.05, 0.08, 0.01, C.black, 0, false); }
        g.beam(0, H + 3.4, tw / 2 + 0.13, 0.3, H + 3.95, tw / 2 + 0.13, 0.05, C.black);
        g.beam(0, H + 3.4, tw / 2 + 0.14, 0.62, H + 3.25, tw / 2 + 0.14, 0.04, C.black);
        c.glow.box(0, H + 1.1, tw / 2 + 0.02, 0.7, 1.2, 0.04, GLOW_BULB);
        g.box(0, H + 1.0, tw / 2 + 0.03, 0.9, 1.4, 0.04, dark, 0, false);
        c.t.pop();
      }
      g.box(0, H + th + 0.3, tz, 2.4, 1.8, 2.4, stone);
      for (let k = 0; k < 4; k++) { c.t.push(0, 0, tz, (k * Math.PI) / 2); g.box(0, H + th + 0.55, 1.21, 0.9, 1.2, 0.02, C.dark, 0, false); c.t.pop(); }
      hipRoof(c, 0, H + th + 2.1, tz, 2.4, 2.4, 2.4, copper, 0.25);
      g.cyl(0, H + th + 4.5, tz, 0.06, 0.02, 1.4, 4, hx('#e0b850'));
    } else {
      g.cyl(0, H, tz, 3.2, 3.2, 0.5, 16, trim);
      g.cyl(0, H + 0.5, tz, 3.0, 3.0, 2.2, 16, stone);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        c.t.push(Math.cos(a) * 3.0, 0, tz + Math.sin(a) * 3.0, Math.PI / 2 - a);
        g.box(0, H + 0.9, 0.01, 0.6, 1.3, 0.04, C.dark, 0, false);
        c.t.pop();
      }
      g.cyl(0, H + 2.7, tz, 3.15, 3.15, 0.25, 16, trim);
      g.blob(0, H + 2.95, tz, 3.0, 3.3, 3.0, copper, 16, 8, true);
      g.cyl(0, H + 6.1, tz, 0.7, 0.7, 1.1, 8, stone);
      g.blob(0, H + 7.2, tz, 0.8, 0.8, 0.8, copper, 8, 4, true);
      g.cyl(0, H + 7.9, tz, 0.06, 0.02, 1.3, 4, hx('#e0b850'));
    }
  }
  // flagpole in front with the government's colors, lamps by the steps
  const fx = -Math.min(c.lw / 2 - 1.2, pw / 2 + 3.2), fzp = Math.min(c.ld / 2 - 1.2, zf + 1.6);
  g.cyl(fx, 0.05, fzp, 0.35, 0.35, 0.25, 8, dark);
  g.cyl(fx, 0.3, fzp, 0.08, 0.05, 11.5, 6, C.steel);
  g.blob(fx, 11.85, fzp, 0.12, 0.12, 0.12, hx('#e0b850'), 5, 3);
  flag(c, fx + 0.05, 11.6, fzp, 2.6, 1.6, c.brand, c.r(5) * 6);
  for (const sx of [-1, 1]) lamp(c, sx * (pw / 2 + 1.3), Math.min(c.ld / 2 - 0.8, zf + 0.9), 3.6, Math.PI);
  for (const sx of [-1, 1]) planter(c, sx * (bw / 2 - 0.8), Math.min(c.ld / 2 - 1.2, front + 1.6), 1.6, 1.0, false, 30 + sx);
  if (c.near) {
    roofClutter(c, -bw / 2 + 3, cz, 5, bd - 2, H + 0.12, [], 1, { vents: 3, ac: 2 });
    roofClutter(c, bw / 2 - 3, cz, 5, bd - 2, H + 0.12, [], 2, { vents: 2, ac: 2, antenna: true });
    streetBits(c, pw / 2 + 2.6, Math.min(c.ld / 2 - 0.8, zf + 1.4), 0, 1, ['litter']);
    for (const sx of [-1, 1]) bench(c, sx * (pw / 2 + 3.4), Math.min(c.ld / 2 - 1.3, zf + 0.4), Math.PI, 1.8);
  }
}

/** TV station: a windowless sound stage at the back with an antenna mast and dishes, a glass newsroom in front. */
function studio(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(1, b.floors);
  lotGround(c, 'paved');
  const bw = b.w - 0.6, bd = b.d - 0.6;
  const split = -1.2; // sound stage behind, newsroom in front
  const hallC = c.pick([hx('#3f454d'), hx('#5a5f66'), hx('#2f3a46')], 1);
  const frameC = c.pick([hx('#e8eaec'), hx('#2a2e33')], 2);
  c.officeTint = mix(hx('#4f7896'), hallC, 0.25);
  const Hf = Math.max(fl * FLOOR_H, 3.6), Hb = Math.max(5.6, fl === 1 ? 5.6 : 6.4);
  const dB = split + bd / 2, czB = (split - bd / 2) / 2, dF = bd / 2 - split, czF = (split + bd / 2) / 2;
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: FLOOR_H, floors: fl, floor: hx('#45484d'), base: 0.15, upper: { cz: czF, d: dF } };
  g.box(0, 0, 0, bw + 0.3, 0.1, bd + 0.3, C.concrete);
  c.wall.box(0, 0.1, czB, bw, Hb - 0.1, dB, hallC);
  c.wall.box(0, 0.1, czF, bw, Hf - 0.1, dF, mix(c.officeTint, C.dark, 0.6));
  if (!c.cut) {
    // ribbed cladding on the sound stage
    c.sides(0, czB, bw, dB, (_s, len) => { for (let u = -len / 2 + 0.5; u < len / 2; u += 0.9) g.box(u, 0.15, 0.02, 0.12, Hb - 0.3, 0.07, shade(hallC, 0.82), 0, false); }, [1, 2, 3]);
    g.box(0, Hb - 0.4, czB, bw + 0.1, 0.4, dB + 0.1, shade(hallC, 0.75), 0, true);
    c.sides(0, czB, bw, dB, () => rollDoor(c, 0, 0.15, 3.6, 3.8, shade(hallC, 1.2)), [1]);
    c.sides(0, czB, bw, dB, () => c.door(1.5, 1.0, 2.2, C.dark, C.dark, 0.15), [3]);
  }
  // newsroom: glass curtain wall
  c.sides(0, czF, bw, dF, (s, len) => {
    if (s === 2) return;
    const n = Math.max(2, Math.round(len / 1.6));
    const pw = len / n;
    const scr = s === 0 && fl >= 2;
    for (let f = 0; f < fl; f++) {
      const y0 = f * FLOOR_H;
      if (f === 0 && s === 0) continue;
      if (!c.cut) g.box(0, y0 + 0.1, 0.02, len + 0.04, 0.3, 0.1, frameC, 0, false);
      for (let i = 0; i < n; i++) {
        if (scr && -len / 2 + (i + 1) * pw > len / 2 - 4.6) continue;
        c.pane(-len / 2 + i * pw + 0.03, y0 + 0.4, -len / 2 + (i + 1) * pw - 0.03, y0 + FLOOR_H - 0.02, 0.05, 'off');
      }
    }
    if (scr && !c.cut) {
      // a big video screen on the newsroom front: picture, lower-third band, channel bug
      const x0 = len / 2 - 4.5, x1 = len / 2 - 0.35, y0 = FLOOR_H + 0.25, y1 = fl * FLOOR_H - 0.2;
      g.box((x0 + x1) / 2, y0 - 0.15, 0.08, x1 - x0 + 0.3, y1 - y0 + 0.3, 0.16, C.dark);
      c.screen.rect(x0, y0, x1, y1, 0.165, mix(c.brand, hx('#9fd0ff'), 0.55));
      c.screen.rect(x0, y0 + (y1 - y0) * 0.12, x1 - (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.24, 0.17, shade(c.brand, 0.75));
      c.screen.rect(x1 - 0.75, y1 - 0.55, x1 - 0.2, y1 - 0.15, 0.17, C.white);
      c.screen.rect(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.35, x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.85, 0.168, hx('#f0d8b8'));
    }
    if (!c.cut) for (let i = 0; i <= n; i++) g.box(-len / 2 + i * pw, 0.1, 0.07, 0.07, Hf - 0.1, 0.1, frameC, 0, false);
    if (s === 0) {
      const ln = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i < ln; i++) {
        const x0 = -len / 2 + 0.3 + (i / ln) * (len - 0.6), x1 = -len / 2 + 0.3 + ((i + 1) / ln) * (len - 0.6);
        if (Math.abs((x0 + x1) / 2) < 1.4) continue;
        c.pane(x0 + 0.04, 0.2, x1 - 0.04, FLOOR_H - 0.3, 0.05, 'shop');
      }
      c.door(0, 2.2, 2.6, C.dark, C.dark, 0.15, true);
      if (!c.cut) {
        g.box(0, 2.95, 1.3, 5.0, 0.2, 2.6, frameC, 0, true);
        c.glow.box(0, 2.9, 1.3, 4.2, 0.05, 2.0, GLOW_BULB);
        g.box(0, 0, 1.0, 4.4, 0.15, 2.0, C.stoneLight);
      }
      // the ON AIR light by the door
      c.sign('ON AIR', 2.4, 2.25, 1.3, 0.42, 0.04, C.dark, c.look.live ? 'onair' : 'offair');
    }
  });
  // roofs, the channel sign, mast and dishes
  flatRoof(c, 0, Hb, czB, bw, dB, hx('#6a6e72'), shade(hallC, 0.8), 0.5, 0.25);
  flatRoof(c, 0, Hf, czF, bw, dF, hx('#7d7f82'), frameC, 0.7, 0.25);
  if (!c.cut) {
    const signY = Hf + 0.15, sw = Math.min(bw - 3.5, 9);
    c.t.push(0, 0, bd / 2 + 0.05, 0);
    c.sign(c.look.firmName, 0.9, signY, sw, 1.1, 0.04);
    // round channel logo beside the name
    g.tube(-sw / 2 - 0.35, signY + 0.55, 0.05, -sw / 2 - 0.35, signY + 0.55, 0.2, 0.75, 16, C.white, true, 0.75, C.white);
    c.screen.poly(Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * TAU; return [-sw / 2 - 0.35 + Math.cos(a) * 0.62, signY + 0.55 + Math.sin(a) * 0.62, 0.205]; }).flat(), c.brand, 0, 0, 1);
    c.screen.poly([-sw / 2 - 0.55, signY + 0.25, 0.21, -sw / 2 - 0.05, signY + 0.55, 0.21, -sw / 2 - 0.55, signY + 0.85, 0.21], C.white, 0, 0, 1);
    c.t.pop();
    if (Hb > Hf + 1.2) {
      // video wall on the sound stage, above the newsroom roof
      c.t.push(0, 0, split + 0.05, 0);
      g.box(0, Hf + 0.9, 0, Math.min(bw - 3, 8), Hb - Hf - 1.2, 0.15, C.dark);
      c.screen.rect(-Math.min(bw - 3, 8) / 2 + 0.15, Hf + 1.0, Math.min(bw - 3, 8) / 2 - 0.15, Hb - 0.4, 0.08, mix(c.brand, hx('#9fd0ff'), 0.45));
      c.t.pop();
    }
    const mx = -bw * 0.28, mz = czB - dB * 0.15, mh = 14 + fl * 2;
    g.box(mx, Hb, mz, 2.0, 0.4, 2.0, C.concrete);
    lattice(c, mx, mz, 1.0, Hb + 0.4, Hb + mh, hx('#c8382f'));
    for (let k = 1; k <= 3; k++) c.glow.box(mx + 0.55, Hb + mh * (k / 3) - 0.2, mz, 0.22, 0.22, 0.22, GLOW_RED);
    g.cyl(mx, Hb + mh, mz, 0.06, 0.02, 3.0, 4, C.steel);
    for (let k = 0; k < 3; k++) {
      const a = k * 1.3 + c.r(6) * 2;
      const dx = bw * 0.12 + k * 2.2, dz = czB + dB * 0.18;
      g.box(dx, Hb, dz, 0.9, 0.3, 0.9, C.concrete);
      g.box(dx, Hb + 0.3, dz, 0.15, 1.1, 0.15, C.steel);
      const ax = Math.sin(a) * 0.5, az = Math.cos(a) * 0.5;
      g.tube(dx, Hb + 1.5, dz, dx + ax * 0.5, Hb + 1.9, dz + az * 0.5, 0.15, 12, C.white, true, 1.05 - k * 0.15, hx('#ecebe6'));
      g.beam(dx + ax * 0.4, Hb + 1.8, dz + az * 0.4, dx + ax * 1.6, Hb + 2.5, dz + az * 1.6, 0.04, C.steel);
    }
  }
  // outside-broadcast van at the side, planters at the door
  const side = (c.lw - bw) / 2;
  if (side > 3.3) {
    truck(c, (c.r(7) < 0.5 ? -1 : 1) * (bw / 2 + side / 2), czB + 0.5, Math.PI, C.white, mix(c.brand, C.white, 0.15));
  }
  const fy = c.ld / 2 - bd / 2;
  if (fy > 2.5) for (const sx of [-1, 1]) planter(c, sx * (bw / 2 - 1.5), bd / 2 + 1.5, 1.8, 0.8, false, 40 + sx);
  if (c.near) {
    roofClutter(c, 0, czF, bw, dF, Hf + 0.08, [[0.9, bd / 2 - 0.6, 5, 0.6]], 3, { ac: 2, vents: 2, hatch: true });
    roofClutter(c, 0, czB, bw, dB, Hb + 0.08, [[-bw * 0.28, czB - dB * 0.15, 1.3, 1.3], [bw * 0.12 + 2.2, czB + dB * 0.18, 3.4, 1.2]], 4, { ac: 2, vents: 3 });
    streetBits(c, -bw / 2 + 0.8, bd / 2 + 2.4, 0, 2, ['bikes']);
    streetBits(c, bw / 2 - 4.5, bd / 2 + 2.6, 0, 3, ['bollards']);
  }
}

/** Internet company: a sleek glass tower with a brand-colored fin, glowing edge lines and a roof terrace. */
function netco(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  const fl = Math.max(2, b.floors);
  const bw = b.w - 0.8, bd = b.d - 0.8, H = fl * FLOOR_H;
  c.officeTint = mix(hx('#5a8fb0'), hx('#a8cfe0'), c.r(2) * 0.5);
  const frameC = c.pick([hx('#e8eaec'), hx('#2a2e33'), hx('#c9ccd0')], 3);
  c.body = { cx: 0, cz: 0, w: bw, d: bd, storey: FLOOR_H, floors: fl, floor: hx('#d8d6d0') };
  lotGround(c, 'paved');
  c.wall.box(0, 0, 0, bw - 0.1, H, bd - 0.1, mix(c.officeTint, C.dark, 0.55));
  c.sides(0, 0, bw, bd, (s, len) => {
    const n = Math.max(3, Math.round(len / 1.25));
    const pw = len / n;
    for (let f = 0; f < fl; f++) {
      const y0 = f * FLOOR_H;
      if (f === 0 && s === 0) continue;
      if (!c.cut) g.box(0, y0, 0.02, len + 0.04, 0.14, 0.09, frameC, 0, false);
      for (let i = 0; i < n; i++) c.pane(-len / 2 + i * pw + 0.02, y0 + 0.14, -len / 2 + (i + 1) * pw - 0.02, y0 + FLOOR_H - 0.01, 0.05, 'off');
    }
    if (!c.cut) for (let i = 0; i <= n; i += 2) g.box(-len / 2 + i * pw, 0, 0.07, 0.05, H, 0.07, frameC, 0, false);
    if (s === 0) {
      // recessed glass lobby behind slim columns
      c.door(0, 2.4, 2.8, C.dark, C.dark, 0.0, true);
      const ln = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i < ln; i++) {
        const x0 = -len / 2 + 0.2 + (i / ln) * (len - 0.4), x1 = -len / 2 + 0.2 + ((i + 1) / ln) * (len - 0.4);
        if (Math.abs((x0 + x1) / 2) < 1.5) continue;
        c.pane(x0 + 0.03, 0.05, x1 - 0.03, FLOOR_H - 0.2, 0.05, 'shop');
      }
      if (!c.cut) {
        for (let i = 0; i <= 4; i++) g.cyl(-len / 2 + 0.6 + (i / 4) * (len - 1.2), 0, 0.9, 0.14, 0.14, FLOOR_H, 10, frameC);
        g.box(0, FLOOR_H - 0.2, 0.8, len + 0.2, 0.25, 1.8, frameC, 0, true);
        c.screen.box(0, FLOOR_H - 0.22, 1.71, len, 0.04, 0.02, c.brand);
      }
    }
  });
  if (!c.cut) {
    // glowing brand line along the crown and a fin rising above the roof at one corner
    c.sides(0, 0, bw, bd, (_s, len) => c.screen.box(0, H - 0.06, 0.1, len + 0.1, 0.05, 0.03, c.brand));
    const fx = (c.r(4) < 0.5 ? -1 : 1) * (bw / 2 + 0.12);
    g.box(fx, 0, bd / 2 - 1.6, 0.24, H + 3.5, 3.2, c.brand);
    g.box(fx, H + 3.5, bd / 2 - 1.6, 0.3, 0.1, 3.3, shade(c.brand, 0.8));
    // roof terrace: decking, glass railing, planters with small trees
    g.box(0, H, 0, bw - 0.05, 0.1, bd - 0.05, hx('#8a8a86'), 0, false);
    g.box(bw * 0.12, H + 0.1, bd * 0.12, bw * 0.55, 0.06, bd * 0.5, C.woodLight, 0, false);
    c.clear.box(0, H + 0.1, bd / 2 - 0.05, bw, 1.1, 0.04, hx('#b9d6e6'));
    c.clear.box(0, H + 0.1, -bd / 2 + 0.05, bw, 1.1, 0.04, hx('#b9d6e6'));
    c.clear.box(bw / 2 - 0.05, H + 0.1, 0, 0.04, 1.1, bd, hx('#b9d6e6'));
    c.clear.box(-bw / 2 + 0.05, H + 0.1, 0, 0.04, 1.1, bd, hx('#b9d6e6'));
    for (const sx of [-1, 1]) g.box(0, H + 1.2, sx * (bd / 2 - 0.05), bw, 0.05, 0.08, frameC, 0, false);
    for (const sx of [-1, 1]) g.box(sx * (bw / 2 - 0.05), H + 1.2, 0, 0.08, 0.05, bd, frameC, 0, false);
    for (let k = 0; k < 3; k++) planter(c, -bw / 2 + 1.4, -bd / 2 + 2 + k * ((bd - 4) / 2), 1.2, 1.2, true, 50 + k);
    c.t.push(0, H + 0.1, 0, 0);
    for (let k = 0; k < 3; k++) planter(c, bw / 2 - 1.4 - k * 2.0, -bd / 2 + 1.2, 1.6, 0.8, false, 60 + k);
    c.t.pop();
    g.box(-bw * 0.2, H, -bd * 0.05, 3.0, 2.8, 2.6, shade(frameC, 0.92));
    c.t.push(0, 0, bd / 2 + 0.1, 0);
    c.sign(c.look.firmName, 0, H - 1.4, Math.min(bw - 3, 8.5), 0.9, 0.04);
    c.t.pop();
  }
  const fy = c.ld / 2 - bd / 2;
  if (fy > 3) {
    planter(c, -bw / 2 + 1.4, bd / 2 + Math.min(2.4, fy - 1), 2.2, 0.9, true, 1);
    planter(c, bw / 2 - 1.4, bd / 2 + Math.min(2.4, fy - 1), 2.2, 0.9, true, 2);
  }
  const by = c.ld / 2 - bd / 2;
  if (by > 5.5) parking(c, 0, -bd / 2 - by / 2, Math.floor((c.lw - 2) / 2.6), Math.PI, 0.6);
  if (c.near) {
    roofClutter(c, -bw * 0.2, -bd * 0.05, 3.0, 2.6, H + 2.8, [], 5, { ac: 1, vents: 1, antenna: true });
    roofClutter(c, -bw * 0.25, -bd * 0.25, bw * 0.4, bd * 0.4, H + 0.1, [[-bw * 0.2, -bd * 0.05, 1.6, 1.4]], 6, { ac: 2 });
    if (!c.cut) {
      for (let k = 0; k < 4; k++) c.props.add('chairBistro', c.t, bw * 0.05 + (k % 2) * 1.1, H + 0.16, bd * 0.1 + Math.floor(k / 2) * 1.4, k * 1.7, 1, 1, 1, c.brand);
      c.props.add('bistroTable', c.t, bw * 0.05 + 0.55, H + 0.16, bd * 0.1 + 0.7, 0, 1, 1, 1, C.white);
    }
    streetBits(c, -bw / 2 + 0.6, bd / 2 + 1.0, 0, 4, ['bikes', 'litter']);
  }
}


// ================================================================ dispatch

const BUILDERS: Record<BuildingKind, (c: Ctx) => void> = {
  plaza, park, trailer, house, farmhouse: house, apartments, tower, officetower: tower,
  farm, lumberyard, quarry, claypit, mine,
  sawmill, brickworks, steelmill, cementworks, glassworks, foodplant,
  // (new farm and food-plant kinds use the farm and food-plant looks until they get their own)
  vegfarm: farm, dairyfarm: farm, ranch: farm, bakery: foodplant, dairyplant: foodplant, meatplant: foodplant,
  workshop, furniture: furniturePlant, textile, electronics, carplant,
  store, dealer, restaurant, office: officeBlock, depot, yard: constructionYard, bank: bankBlock, adco,
  clinic: officeBlock, hospital: officeBlock, // (placeholders until they get their own looks)
  cityhall, studio, netco,
  shopfront: () => {}, suite: () => {}, // drawn by their tower
};

function generate(c: Ctx): void {
  const b = c.b;
  const towerKind = isTowerKind(b.kind);
  if (b.ruined) (towerKind ? towerRuin : ruin)(c);
  else if (!b.built) {
    if (towerKind) towerSite(c, towerPlan(b, c.look.firmName), progressOf(b), deliveredOf(b));
    else site(c);
  } else {
    (BUILDERS[b.kind] ?? officeBlock)(c); // (a kind added to the sim later shows as an office until it gets a model)
    if (c.cut) {
      // the furnishing goes to its own buffers, lit from inside at night
      const solid = c.solid, props = c.props;
      c.solid = c.inside;
      c.props = c.insideProps;
      interior(c);
      c.solid = solid;
      c.props = props;
    }
  }
}

/** Shops and leased office floors live inside a tower: drawn by it, never on their own. */
export function isHosted(b: Building): boolean {
  return b.host !== undefined && b.host >= 0;
}

// ================================================================ renderer

/**
 * Level-of-detail distances (meters from the camera to the building, minus half its size).
 * Each pair is (switch in, switch back) so buildings don't flicker between levels.
 */
export const LOD = {
  nearIn: 135, nearOut: 165, // fine exterior detail (curtains, rooftop units, balcony furniture)
  farIn: 720, farOut: 640, // merged boxes with a window texture
  closeIn: 110, closeOut: 140, // a cut-open building gets cups, plates, books...
};

/** Ambient "room light" added to the inside of an opened building at night. */
const ROOM_LIGHT = new Color3(0.42, 0.36, 0.27);

/** 0 = far boxes, 1 = normal, 2 = near detail. */
type Lod = 0 | 1 | 2;

/** Facts beyond the building itself that change what it looks like (hosted units, the open floor, occupancy). */
interface Extra { units: number; level: number; occ: number }

interface Sig extends Extra {
  ver: number; cond: number; built: boolean; ruined: boolean; floors: number; prog: number;
  name: string; hue: number; lotW: number; lotD: number; ground: number; live: boolean;
  x: number; y: number; angle: number; w: number; d: number; kind: BuildingKind; cut: boolean;
}

/** A sign of a shown building: its mesh, and the texture it needs (made the first time it's shown). */
interface SignShown { mesh: Mesh; key: string; text: string; hue: number; aspect: number; style: SignStyle; acquired: boolean; want: boolean; gone: boolean }

/** Sign text is drawn only this close (meters, in / out); farther away the sign is its colored panel. */
const SIGN_DIST = { in: 230, out: 260 };

interface Entry {
  b: Building;
  look: BuildingLook;
  meshes: Mesh[];
  signs: SignShown[];
  signsOn: boolean;
  sig: Sig | null;
  seen: number;
  owner: number; // owner color key for the overlay (-1 = none)
  ownerAt: number; // placement fingerprint of the overlay marker
  lod: Lod | -1; // what is shown (-1 = nothing yet)
  want: Lod;
  close: boolean; // interior props shown
  wantClose: boolean;
  dist: number;
  chunk: string | null; // far chunk holding this building (lod 0)
  props: PropList | null;
  inside: PropList | null; // props inside the opened building
  /** The previously shown detailed level, kept (disabled) so switching back is instant. */
  stash: Shown | null;
  /** Cached far model and the state it was built for. */
  farCache: { sig: Sig; model: FarModel } | null;
  /** Hosted units (towers), refreshed every sync. */
  units: HostedUnit[];
  extra: Extra;
}

/** One built detailed representation of a building. */
interface Shown { lod: Lod; sig: Sig; meshes: Mesh[]; signs: SignShown[]; props: PropList | null; inside: PropList | null }

interface SignMat { mat: StandardMaterial; tex: DynamicTexture; refs: number; style: SignStyle }

function progKey(b: Building): number {
  if (b.built || b.ruined) return -1;
  return Math.round(progressOf(b) * 20) + 100 * Math.round(deliveredOf(b) * 4);
}

function sigOf(b: Building, look: BuildingLook, cut: boolean, x: Extra): Sig {
  return {
    ver: b.ver, cond: Math.round(b.condition * 10), built: b.built, ruined: b.ruined, floors: b.floors, prog: progKey(b),
    name: look.firmName ?? '', hue: look.firmHue === undefined ? -1 : Math.round(look.firmHue * 100),
    lotW: Math.round((look.lotW || 0) * 10), lotD: Math.round((look.lotD || 0) * 10), ground: Math.round(look.ground * 20), live: !!look.live,
    x: b.x, y: b.y, angle: b.angle, w: b.w, d: b.d, kind: b.kind, cut, units: x.units, level: x.level, occ: x.occ,
  };
}

/** Cheap per-frame check (no allocation) whether a building still matches what was built. */
function sigMatches(a: Sig, b: Building, look: BuildingLook, cut: boolean, x: Extra): boolean {
  return a.ver === b.ver && a.built === b.built && a.ruined === b.ruined && a.floors === b.floors
    && a.cond === Math.round(b.condition * 10) && a.x === b.x && a.y === b.y && a.angle === b.angle
    && a.w === b.w && a.d === b.d && a.kind === b.kind && a.cut === cut && a.live === !!look.live
    && a.name === (look.firmName ?? '') && a.hue === (look.firmHue === undefined ? -1 : Math.round(look.firmHue * 100))
    && a.lotW === Math.round((look.lotW || 0) * 10) && a.lotD === Math.round((look.lotD || 0) * 10)
    && a.ground === Math.round(look.ground * 20) && a.prog === progKey(b)
    && a.units === x.units && a.level === x.level && a.occ === x.occ;
}

const KIND_IDS = new Map<string, number>();
function kindId(k: string): number {
  let v = KIND_IDS.get(k);
  if (v === undefined) { v = KIND_IDS.size + 1; KIND_IDS.set(k, v); }
  return v;
}
function strHash(s: string | undefined): number {
  if (!s) return 0;
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Fingerprint of a tower's hosted units (who leases what). */
function unitsKey(units: HostedUnit[]): number {
  let h = units.length;
  for (const u of units) {
    h = (h * 33 + u.b.id) | 0;
    h = (h * 33 + kindId(u.b.kind)) | 0;
    h = (h * 33 + strHash(u.look.firmName)) | 0;
    h = (h * 33 + Math.round((u.look.firmHue ?? -1) * 100)) | 0;
  }
  return h;
}

/** Share of a home's units that are lived in, in steps of 10% (so a tower isn't rebuilt for every move). */
function occupancy(b: Building): number {
  const n = b.units?.length ?? 0;
  if (!n) return BUILDINGS[b.kind]?.category === 'home' ? 0 : 10;
  let k = 0;
  for (const u of b.units) if (u.tenant >= 0) k++;
  return Math.round((k / n) * 10);
}

function drawSignTexture(tex: DynamicTexture, text: string, hue: number, style: SignStyle): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const { width: W, height: H } = tex.getSize();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fit = (label: string, font: (s: number) => string, frac: number, maxW = 0.9) => {
    let size = Math.floor(H * frac);
    ctx.font = font(size);
    while (ctx.measureText(label).width > W * maxW && size > 8) { size -= 2; ctx.font = font(size); }
    return size;
  };
  if (style === 'carved') {
    // incised capitals on a stone frieze
    ctx.fillStyle = '#e4dccb';
    ctx.fillRect(0, 0, W, H);
    const label = text.toUpperCase();
    fit(label, (s) => `600 ${s}px Georgia, "Times New Roman", serif`, 0.62, 0.92);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(label, W / 2 + 1.5, H / 2 + 2.5);
    ctx.fillStyle = '#4a4336';
    ctx.fillText(label, W / 2, H / 2 + 1);
    tex.update(true);
    return;
  }
  if (style === 'metal') {
    // brushed-steel letters on dark stone (a tower's name over the lobby)
    ctx.fillStyle = '#26282b';
    ctx.fillRect(0, 0, W, H);
    const label = text.toUpperCase();
    const size = fit(label, (s) => `500 ${s}px "Avenir Next", "Helvetica Neue", Arial, sans-serif`, 0.62, 0.9);
    const grad = ctx.createLinearGradient(0, H / 2 - size / 2, 0, H / 2 + size / 2);
    grad.addColorStop(0, '#f4f4f2'); grad.addColorStop(0.5, '#b9bcc0'); grad.addColorStop(1, '#e8e8e6');
    ctx.fillStyle = grad;
    ctx.fillText(label, W / 2, H / 2 + size * 0.04);
    tex.update(true);
    return;
  }
  if (style === 'lease') {
    // a realtor's board: red band, white lettering
    ctx.fillStyle = '#f7f5f0';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c8262c';
    ctx.fillRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
    const size = fit(text, (s) => `800 ${s}px "Arial Black", "Helvetica Neue", Arial, sans-serif`, 0.58, 0.86);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, W / 2, H / 2 + size * 0.05);
    tex.update(true);
    return;
  }
  if (style === 'onair' || style === 'offair') {
    const on = style === 'onair';
    ctx.fillStyle = on ? '#e3241b' : '#3a2422';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = on ? '#ffd0c8' : '#5a3a36';
    ctx.lineWidth = H * 0.07;
    ctx.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
    ctx.font = `bold ${Math.floor(H * 0.55)}px "Trebuchet MS", "Avenir Next", sans-serif`;
    ctx.fillStyle = on ? '#fff6f0' : '#7a5a56';
    ctx.fillText(text, W / 2, H / 2 + H * 0.03);
    tex.update(true);
    return;
  }
  const bg = hsl(hue, 0.6, 0.36), edge = hsl(hue, 0.55, 0.62);
  ctx.fillStyle = bg.toHexString();
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = edge.toHexString();
  ctx.lineWidth = Math.max(3, H * 0.06);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2);
  const size = fit(text, (s) => `bold ${s}px "Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif`, 0.6, 0.86);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText(text, W / 2 + size * 0.04, H / 2 + size * 0.08);
  ctx.fillStyle = '#fff8e6';
  ctx.fillText(text, W / 2, H / 2 + size * 0.04);
  tex.update(true);
}

/**
 * The sky and city reflected in glass (an equirectangular picture: sky and clouds above, a band of
 * distant towers at the horizon, dark streets below). One for day, one for night.
 */
function skyTexture(scene: Scene, night: boolean): DynamicTexture {
  const W = 512, H = 256;
  const tex = new DynamicTexture(night ? 'sky-reflect-night' : 'sky-reflect-day', { width: W, height: H }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.coordinatesMode = Texture.EQUIRECTANGULAR_MODE;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const hz = H / 2;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  if (night) { sky.addColorStop(0, '#05070d'); sky.addColorStop(1, '#1b2436'); }
  else { sky.addColorStop(0, '#3a6fb5'); sky.addColorStop(0.55, '#79a6d8'); sky.addColorStop(0.9, '#bcd5ec'); sky.addColorStop(1, '#e2edf5'); }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hz);
  const rnd = (k: number) => hash2(k, night ? 77 : 33);
  if (!night) {
    // soft clouds
    for (let k = 0; k < 26; k++) {
      const x = rnd(k) * W, y = 18 + rnd(k + 50) * (hz - 50), r = 10 + rnd(k + 100) * 26;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r * 2.2, r, 0, 0, TAU); ctx.fill();
    }
  }
  // ground below the horizon
  const ground = ctx.createLinearGradient(0, hz, 0, H);
  if (night) { ground.addColorStop(0, '#141820'); ground.addColorStop(1, '#07080a'); }
  else { ground.addColorStop(0, '#5d646c'); ground.addColorStop(1, '#2c3035'); }
  ctx.fillStyle = ground;
  ctx.fillRect(0, hz, W, H - hz);
  // a band of distant buildings along the horizon, with lit windows at night
  let x = 0, k = 0;
  while (x < W) {
    const w = 5 + rnd(200 + k) * 14, h = 2 + rnd(300 + k) ** 3 * 20;
    const shadeV = night ? 18 + rnd(400 + k) * 18 : 105 + rnd(400 + k) * 70;
    ctx.fillStyle = night ? `rgb(${shadeV},${shadeV + 4},${shadeV + 12})` : `rgb(${shadeV - 18},${shadeV - 2},${shadeV + 22})`;
    ctx.fillRect(x, hz - h, w, h + 2);
    if (night) {
      for (let wy = hz - h + 2; wy < hz - 1; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        if (hash2(Math.round(wx * 7 + wy), k) < 0.35) { ctx.fillStyle = hash2(wx, wy) < 0.5 ? '#ffd890' : '#cfe0ff'; ctx.fillRect(wx, wy, 1, 1); }
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, hz - h, 1.5, h);
    }
    x += w + rnd(500 + k) * 4;
    k++;
  }
  tex.update(true);
  return tex;
}

export interface BuildingStats {
  far: number; normal: number; near: number; backlog: number; farVerts: number; farMeshes: number; props: number; rebuildMs: number;
  /** Slowest single rebuild since `resetStats()`: building id, level, close-up, milliseconds. */
  slowest: { id: number; lod: number; close: boolean; ms: number; detail?: unknown } | null;
  /** Most time spent in one sync on rebuilding + merging since `resetStats()`. */
  maxFrameMs: number;
  beacons: number;
}

/** Picking ranges of a mesh: [first triangle, end triangle, building id]. */
type Parts = [number, number, number][];

export class BuildingRenderer {
  /**
   * Time budget per `sync` call for (re)building meshes, in milliseconds. The first job of a frame always
   * runs, and merging buffers comes after, so frames land at about 4 ms at most.
   */
  budgetMs = 3.5;
  /** Force one level of detail for every building (tests); null = by distance. */
  forceLod: Lod | null = null;
  /** How many building rebuilds happened so far (debugging / tests). */
  rebuilds = 0;

  private entries = new Map<number, Entry>();
  private pending = new Set<number>();
  private frame = 0;
  private night = 0;
  private hour = 21;
  private lightSet = false;
  private cutId: number | null = null;
  /** The building drawn opened up for `cutId` (its tower, for a hosted unit) and the open floor (-1 = all). */
  private cutHost: number | null = null;
  /** Hosted units by tower id (refreshed every sync), and all hosted ids (picking). */
  private unitsByHost = new Map<number, HostedUnit[]>();
  private unitIds = new Map<number, Building>();
  private signMats = new Map<string, SignMat>();
  private mats: {
    solid: StandardMaterial; win: StandardMaterial; warm: StandardMaterial; clear: StandardMaterial; ghost: StandardMaterial; owner: StandardMaterial;
    screen: StandardMaterial; ledA: StandardMaterial; ledB: StandardMaterial; inside: StandardMaterial; beacon: StandardMaterial;
  };
  private winTex: RawTexture;
  private winData = new Uint8Array(WIN_STATES * 4);
  private winKey = '';
  private skyDay: DynamicTexture;
  private skyNight: DynamicTexture;
  private far: FarLayer;
  private props: PropLib;
  private ownerPole: Mesh | null = null;
  private ownerFlag: Mesh | null = null;
  private ownerEdge: Mesh | null = null;
  private ownersDirty = false;
  /** Aviation lights of tall towers (world positions per building), drawn as one thin-instanced mesh. */
  private beacons = new Map<number, number[]>();
  private beaconMesh: Mesh | null = null;
  private beaconsDirty = false;
  private lastRebuildMs = 0;
  private slowest: BuildingStats['slowest'] = null;
  private maxFrameMs = 0;
  private farFlushMs = 0;
  /** Where the time went in the worst frame since `resetStats()` (debugging). */
  worstFrame: { pending: number; far: number; props: number; slowest: number } | null = null;
  /** Timing of the last detailed rebuild (debugging). */
  lastBreakdown: { gen: number; mesh: number; swap: number; verts: number; props: number } | null = null;

  constructor(private scene: Scene, private shadows: ShadowGenerator | null) {
    const mk = (name: string, spec = 0.04, power = 16): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = power;
      return m;
    };
    this.skyDay = skyTexture(scene, false);
    this.skyNight = skyTexture(scene, true);
    const solid = mk('bld-solid');
    // every lit surface: windows, lamps, screens, crown lights (lighting state per texel of winTex)
    const win = mk('bld-win', 0.5, 64);
    win.diffuseColor = new Color3(WIN_BASE, WIN_BASE, WIN_BASE);
    this.winTex = RawTexture.CreateRGBATexture(this.winData, WIN_STATES, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    this.winTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.winTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    win.emissiveTexture = this.winTex;
    // (the glow layer multiplies the emissive texture by emissiveColor * emissiveIntensity: lit surfaces glow,
    // while the tiny emissiveColor adds next to nothing to the picture itself)
    win.emissiveColor = new Color3(0.004, 0.004, 0.004);
    (win as unknown as { emissiveIntensity: number }).emissiveIntensity = 150;
    win.reflectionTexture = this.skyDay;
    win.reflectionFresnelParameters = new FresnelParameters({ bias: 0.1, power: 1.5, leftColor: new Color3(1, 1, 1), rightColor: new Color3(0.24, 0.24, 0.24) });
    // lamps and furnace mouths of props (thin instances): glow on top of their colors at night
    const warm = mk('bld-warm', 0.3, 40);
    warm.useEmissiveAsIllumination = true;
    const clear = mk('bld-clear', 0.7, 64);
    clear.alpha = 0.3;
    clear.reflectionTexture = this.skyDay;
    clear.reflectionFresnelParameters = new FresnelParameters({ bias: 0.1, power: 1.6, leftColor: new Color3(0.9, 0.9, 0.9), rightColor: new Color3(0.12, 0.12, 0.12) });
    const ghost = mk('bld-ghost', 0);
    ghost.alpha = 0.16;
    ghost.backFaceCulling = false;
    ghost.disableDepthWrite = true;
    const owner = mk('bld-owner', 0.05);
    const inside = mk('bld-inside');
    // screens and indicator LEDs are lit by day too (their vertex colors are the picture)
    const screen = mk('bld-screen', 0.3, 64);
    screen.diffuseColor = new Color3(0.12, 0.12, 0.12);
    const ledA = mk('bld-ledA', 0);
    ledA.diffuseColor = new Color3(0.1, 0.1, 0.1);
    const ledB = mk('bld-ledB', 0);
    ledB.diffuseColor = new Color3(0.1, 0.1, 0.1);
    const beacon = mk('bld-beacon', 0);
    beacon.diffuseColor = new Color3(0.5, 0.06, 0.04);
    this.mats = { solid, win, warm, clear, ghost, owner, screen, ledA, ledB, inside, beacon };
    this.far = new FarLayer(scene, this.skyDay);
    const pm: Record<PropMat, StandardMaterial> = { solid, warm, screen, ledA, ledB, clear };
    this.props = new PropLib(scene, shadows, pm, inside);
    this.setNight(0);
  }

  // ------------------------------------------------------------- public

  sync(buildings: Building[], lookOf: (b: Building) => BuildingLook): void {
    const frame = ++this.frame;
    const cam = this.scene.activeCamera;
    const cp = cam ? cam.globalPosition : null;
    // hosted units first: they're drawn by their towers
    this.unitsByHost.clear();
    this.unitIds.clear();
    for (const b of buildings) {
      if (!isHosted(b)) continue;
      this.unitIds.set(b.id, b);
      let list = this.unitsByHost.get(b.host!);
      if (!list) { list = []; this.unitsByHost.set(b.host!, list); }
      list.push({ b, look: lookOf(b), lx: 0, lz: 0, level: b.level ?? 0 });
    }
    // what's opened up: a hosted unit opens its tower at the unit's floor
    const cutUnit = this.cutId !== null ? this.unitIds.get(this.cutId) : undefined;
    this.cutHost = cutUnit ? cutUnit.host! : this.cutId;
    let cutLevel = cutUnit ? cutUnit.level ?? 0 : -1;
    for (const b of buildings) {
      if (isHosted(b)) continue;
      const look = lookOf(b);
      let e = this.entries.get(b.id);
      if (!e) {
        e = { b, look, meshes: [], signs: [], signsOn: false, sig: null, seen: frame, owner: -1, ownerAt: 0, lod: -1, want: 1, close: false, wantClose: false, dist: 1e9, chunk: null, props: null, inside: null, stash: null, farCache: null, units: [], extra: { units: 0, level: -1, occ: 10 } };
        this.entries.set(b.id, e);
        this.pending.add(b.id);
      }
      e.b = b;
      e.look = look;
      e.seen = frame;
      const cut = this.cutHost === b.id;
      // hosted units in the tower's frame, in a stable order
      const units = this.unitsByHost.get(b.id);
      if (units) {
        units.sort((p, q) => (p.level - q.level) || (p.b.id - q.b.id));
        const fx = Math.cos(b.angle), fy = Math.sin(b.angle), rx = Math.sin(b.angle), ry = -Math.cos(b.angle);
        for (const u of units) {
          const dx = u.b.x - b.x, dy = u.b.y - b.y;
          u.lx = dx * rx + dy * ry;
          u.lz = dx * fx + dy * fy;
        }
      }
      e.units = units ?? [];
      if (cut && isTowerKind(b.kind) && !cutUnit) {
        // a tower opened on its own (a resident followed, or the tower selected): the floor the camera looks at
        const tgt = (cam as unknown as { target?: Vector3 } | null)?.target;
        cutLevel = tgt ? Math.max(0, Math.min(b.floors - 1, Math.round((tgt.y - look.ground - 0.6) / FLOOR_H))) : 0;
      }
      const ex = e.extra;
      ex.units = e.units.length ? unitsKey(e.units) : 0;
      ex.level = cut && isTowerKind(b.kind) ? cutLevel : -1;
      ex.occ = occupancy(b);
      if (cp) {
        const dx = b.x - cp.x, dy = look.ground + Math.min(b.floors * 1.6, 16) - cp.y, dz = b.y - cp.z;
        e.dist = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - Math.max(b.w, b.d) * 0.5);
      } else e.dist = 300;
      e.want = this.wantLod(e, cut);
      e.wantClose = cut && e.dist < (e.close ? LOD.closeOut : LOD.closeIn);
      const signsOn = e.lod >= 1 && e.dist < (e.signsOn ? SIGN_DIST.out : SIGN_DIST.in);
      if (signsOn !== e.signsOn) { e.signsOn = signsOn; this.showSigns(e.signs, signsOn); }
      if (!this.pending.has(b.id) && (e.lod !== e.want || e.close !== e.wantClose || !e.sig || !sigMatches(e.sig, b, look, cut, ex))) this.pending.add(b.id);
      const oc = look.ownerColor;
      const ok = oc ? Math.round(oc.r * 255) * 65536 + Math.round(oc.g * 255) * 256 + Math.round(oc.b * 255) : -1;
      if (ok !== e.owner) { e.owner = ok; this.ownersDirty = true; }
      if (ok >= 0) {
        const at = b.x * 7.31 + b.y * 13.17 + b.angle * 101.3 + look.lotW * 3.1 + look.lotD * 5.3 + look.ground * 17.9;
        if (at !== e.ownerAt) { e.ownerAt = at; this.ownersDirty = true; }
      }
    }
    for (const [id, e] of this.entries) {
      if (e.seen === frame) continue;
      this.disposeEntry(e);
      this.dropStash(e);
      if (e.chunk) this.far.set(id, e.chunk, null);
      this.entries.delete(id);
      this.pending.delete(id);
      if (this.beacons.delete(id)) this.beaconsDirty = true;
      if (e.owner >= 0) this.ownersDirty = true;
    }
    const t0 = performance.now();
    this.processPending();
    const tf = performance.now();
    this.far.flush();
    const tp = performance.now();
    this.farFlushMs = this.farFlushMs * 0.7 + (tp - tf) * 0.3;
    this.props.flush();
    this.drainSigns();
    const spent = performance.now() - t0;
    if (spent > this.maxFrameMs) {
      this.maxFrameMs = spent;
      this.worstFrame = { pending: +(tf - t0).toFixed(1), far: +(tp - tf).toFixed(1), props: +(performance.now() - tp).toFixed(1), slowest: this.slowest?.ms ?? 0 };
    }
    if (this.ownersDirty) { this.ownersDirty = false; this.rebuildOwners(); }
    if (this.beaconsDirty) { this.beaconsDirty = false; this.rebuildBeacons(); }
    // server LEDs and the TV-lit flats flicker, aviation lights blink
    const t = performance.now() / 1000;
    const a = (t * 1.7) % 1 < 0.55, bb = (t * 3.1 + 0.4) % 1 < 0.3;
    this.mats.ledA.emissiveColor.setAll(a ? 1 : 0.18);
    this.mats.ledB.emissiveColor.setAll(bb ? 1 : 0.18);
    const on = t % 1.5 < 0.55;
    this.mats.beacon.emissiveColor.set(on ? 1 : 0.12 + 0.1 * (1 - this.night), on ? 0.1 : 0.01, on ? 0.06 : 0.01);
    this.updateWinTex(t);
  }

  setNight(level: number): void {
    const n = clamp01(level);
    if (n === this.night && this.lightSet) return; // (the app calls this every frame)
    this.lightSet = true;
    this.night = n;
    const m = this.mats;
    const sky = new Color3(0.05, 0.08, 0.12).scale(1 - n);
    const tex = n > 0.55 ? this.skyNight : this.skyDay;
    for (const mat of [m.win, m.clear]) {
      if (mat.reflectionTexture !== tex) mat.reflectionTexture = tex;
    }
    tex.level = n > 0.55 ? 0.55 : 0.85 - n * 0.6;
    m.warm.emissiveColor = new Color3(1.0, 0.8, 0.46).scale(n * 0.95);
    m.clear.emissiveColor = new Color3(0.1, 0.13, 0.16).scale(1 - n * 0.5);
    m.screen.emissiveColor = new Color3(0.72, 0.72, 0.72).scale(1 - n).add(new Color3(0.95, 0.95, 0.95).scale(n));
    m.inside.emissiveColor = ROOM_LIGHT.scale(n);
    void sky;
    for (const s of this.signMats.values()) s.mat.emissiveColor = this.signGlow(s.style);
    this.far.setNight(n);
    this.updateWinTex(performance.now() / 1000);
  }

  /** Time of day (0..24): flats and offices light up and go dark at different hours. */
  setHour(hour: number): void {
    const h = ((hour % 24) + 24) % 24;
    if (Math.abs(h - this.hour) < 0.02) return; // (about a minute of game time)
    this.hour = h;
    this.far.setHour(this.hour);
    this.updateWinTex(performance.now() / 1000);
  }

  setCutaway(id: number | null): void {
    if (id === this.cutId) return;
    const prev = this.cutId;
    this.cutId = id;
    for (const bid of [prev, id]) {
      if (bid === null) continue;
      const host = this.unitIds.get(bid)?.host ?? bid;
      if (this.entries.has(host)) this.pending.add(host);
    }
  }

  pickedId(pick: PickingInfo): number {
    if (!pick || !pick.hit || !pick.pickedMesh) return -1;
    const md = pick.pickedMesh.metadata as { kind?: string; id?: number; far?: string; parts?: Parts } | null;
    if (!md || md.kind !== 'building') return -1;
    if (md.far !== undefined) {
      const id = this.far.pickedId(pick);
      return this.entries.has(id) ? id : -1;
    }
    if (md.parts) {
      const f = pick.faceId;
      for (const [a, z, id] of md.parts) if (f >= a && f < z && this.unitIds.has(id)) return id;
    }
    if (typeof md.id !== 'number') return -1;
    return this.entries.has(md.id) || this.unitIds.has(md.id) ? md.id : -1;
  }

  /** Number of buildings still waiting to be (re)built. */
  get backlog(): number { return this.pending.size + this.signQueue.length; }

  stats(): BuildingStats {
    let far = 0, normal = 0, near = 0, beacons = 0;
    for (const e of this.entries.values()) { if (e.lod === 0) far++; else if (e.lod === 1) normal++; else if (e.lod === 2) near++; }
    for (const v of this.beacons.values()) beacons += v.length / 3;
    const slowest = this.slowest;
    return { far, normal, near, backlog: this.pending.size, farVerts: this.far.verts, farMeshes: this.far.drawMeshes, props: this.props.instances, rebuildMs: +this.lastRebuildMs.toFixed(2), slowest, maxFrameMs: +this.maxFrameMs.toFixed(2), beacons };
  }

  resetStats(): void { this.slowest = null; this.maxFrameMs = 0; this.worstFrame = null; }

  dispose(): void {
    for (const e of this.entries.values()) { this.disposeEntry(e); this.dropStash(e); }
    this.entries.clear();
    this.pending.clear();
    for (const s of this.signMats.values()) { s.tex.dispose(); s.mat.dispose(); }
    this.signMats.clear();
    for (const m of [this.ownerPole, this.ownerFlag, this.ownerEdge, this.beaconMesh]) m?.dispose();
    this.ownerPole = this.ownerFlag = this.ownerEdge = this.beaconMesh = null;
    this.far.dispose();
    this.props.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.winTex.dispose();
    this.skyDay.dispose();
    this.skyNight.dispose();
  }

  // ------------------------------------------------------------ private

  /** Rewrite the lighting-state texels for the current hour and night level. */
  private updateWinTex(t: number): void {
    const n = this.night, h = this.hour;
    // 0..1 while the clock is between a and b (wrapping past midnight), with a half-hour fade
    const on = (a: number, b: number): number => {
      const len = (b - a + 24) % 24;
      const x = (h - a + 24) % 24;
      if (x > len) return 0;
      return clamp01(x / 0.5) * clamp01((len - x) / 0.5);
    };
    const flick = 0.75 + 0.25 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1);
    const blink = t % 1.2 < 0.4 ? 1 : 0.15;
    const W = [1.0, 0.76, 0.42], CO = [0.8, 0.9, 1.0];
    const s: number[][] = [];
    s[WS.dark] = [0, 0, 0];
    s[WS.resA] = W.map((v) => v * n * on(16.5, 23.2));
    s[WS.resB] = W.map((v) => v * 0.95 * n * on(16.5, 1.6));
    s[WS.resC] = W.map((v) => v * n * Math.max(on(16.5, 21.6), on(5.3, 8.2)));
    s[WS.resAll] = [0.95, 0.82, 0.58].map((v) => v * 0.85 * n);
    s[WS.offA] = CO.map((v) => v * n * on(6.5, 20.2));
    s[WS.offB] = CO.map((v) => v * n * on(6.5, 23.0));
    s[WS.offAll] = CO.map((v) => v * 0.92 * n);
    s[WS.shop] = [1.0, 0.9, 0.72].map((v) => v * n * (0.5 + 0.5 * on(7, 22)));
    s[WS.lobby] = [1.0, 0.94, 0.82].map((v) => v * n);
    s[WS.lamp] = [n, n, n];
    s[WS.screen] = [0.25, 0.25, 0.25];
    s[WS.crown] = [n, n, n];
    s[WS.security] = CO.map((v) => v * 0.4 * n);
    s[WS.tv] = [0.5, 0.62, 1.0].map((v) => v * n * on(18, 0.5) * flick);
    s[WS.blink] = [blink, blink * 0.9, blink * 0.9];
    const d = this.winData;
    let key = '';
    for (let i = 0; i < WIN_STATES; i++) {
      const c = s[i] ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round(clamp01(c[k]) * 255);
      d[i * 4 + 3] = 255;
      key += `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]};`;
    }
    if (key === this.winKey) return;
    this.winKey = key;
    this.winTex.update(d);
  }

  private wantLod(e: Entry, cut: boolean): Lod {
    if (cut) return 2;
    if (this.forceLod !== null) return this.forceLod;
    const d = e.dist, cur = e.lod;
    if (d < (cur === 2 ? LOD.nearOut : LOD.nearIn)) return 2;
    if (d > (cur === 0 ? LOD.farOut : LOD.farIn)) return 0;
    return 1;
  }

  /** Rebuild what's out of date, most important first, within the time budget. */
  private processPending(): void {
    if (this.pending.size === 0) { this.lastRebuildMs = 0; return; }
    const t0 = performance.now();
    const pr = (e: Entry): number => {
      if (e.b.id === this.cutHost) return -1e9;
      if (e.lod === -1) return -1e6 + e.dist; // show something everywhere first (far boxes are cheap)
      const changed = !e.sig || !sigMatches(e.sig, e.b, e.look, this.cutHost === e.b.id, e.extra);
      if (changed) return e.dist;
      if (e.want > e.lod) return 40 + e.dist; // more detail close by
      if (e.want === 0) return 400 + e.dist * 0.1; // cheap and saves draw calls
      return 4000 + e.dist; // less detail far away: whenever there's time
    };
    const ids = [...this.pending];
    const keys = new Map<number, number>();
    for (const id of ids) { const e = this.entries.get(id); keys.set(id, e ? pr(e) : 0); }
    if (ids.length > 1) ids.sort((a, b) => keys.get(a)! - keys.get(b)!);
    // keep some of the budget for merging the far chunks and prop buffers afterwards
    const budget = this.budgetMs - (this.props.pending ? 1 : 0.3) - Math.min(1.5, this.farFlushMs);
    let done = 0, farDone = 0;
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e) { this.pending.delete(id); continue; }
      const cut = this.cutHost === id;
      const first = e.lod === -1 && e.want !== 0 && !cut;
      const stale = e.lod !== e.want || e.close !== e.wantClose || !e.sig || !sigMatches(e.sig, e.b, e.look, cut, e.extra);
      if (!first && !stale) { this.pending.delete(id); continue; }
      const lod = first ? 0 : e.want;
      const close = !first && cut && e.wantClose;
      const est = this.estimate(e.b, lod, close) + (lod === 0 ? 0.06 : 0); // far boxes also cost a chunk merge
      const spent = performance.now() - t0;
      // the first job of a frame always runs; later ones only if they fit
      if (done > 0 && spent + est > budget) { if (spent > budget) break; continue; }
      if (lod === 0 && ++farDone > 40) continue;
      this.pending.delete(id);
      const t1 = performance.now();
      this.rebuild(e, lod);
      const ms = performance.now() - t1;
      this.learn(e.b, lod, close, ms);
      done++;
      if (first) this.pending.add(id); // far boxes now, the real thing when its turn comes
      else if (!this.slowest || ms > this.slowest.ms) this.slowest = { id, lod, close, ms: +ms.toFixed(2), detail: this.lastBreakdown };
      if (performance.now() - t0 > budget) break;
    }
    this.lastRebuildMs = performance.now() - t0;
  }

  /** Learned rebuild cost (ms per floor) by kind, level and close-up. */
  private costs = new Map<string, number>();

  private estimate(b: Building, lod: Lod, close: boolean): number {
    if (lod === 0) return 0.08;
    const k = this.costs.get(`${b.kind}|${lod}|${close ? 1 : 0}`);
    const fl = Math.max(1, b.floors);
    return k !== undefined ? k * fl : (lod === 2 ? 0.5 : 0.3) * fl + (close ? 0.35 * fl : 0) + 0.6;
  }

  private learn(b: Building, lod: Lod, close: boolean, ms: number): void {
    if (lod === 0) return;
    const key = `${b.kind}|${lod}|${close ? 1 : 0}`;
    const per = ms / Math.max(1, b.floors);
    const old = this.costs.get(key);
    this.costs.set(key, old === undefined ? per : old * 0.7 + per * 0.3);
  }

  /** Aviation lights of a tower (world positions), refreshed whenever the tower is rebuilt at any level. */
  private updateBeacons(e: Entry): void {
    const b = e.b;
    const had = this.beacons.has(b.id);
    if (!isTowerKind(b.kind) || !b.built || b.ruined) {
      if (had) { this.beacons.delete(b.id); this.beaconsDirty = true; }
      return;
    }
    const local = towerBeacons(b, e.look.firmName);
    if (!local.length) { if (had) { this.beacons.delete(b.id); this.beaconsDirty = true; } return; }
    const rot = Math.PI / 2 - b.angle, cs = Math.cos(rot), sn = Math.sin(rot);
    const out: number[] = [];
    for (let i = 0; i < local.length; i += 3) {
      const lx = local[i], ly = local[i + 1], lz = local[i + 2];
      out.push(b.x + lx * cs + lz * sn, e.look.ground + ly, b.y - lx * sn + lz * cs);
    }
    const old = this.beacons.get(b.id);
    if (!old || old.length !== out.length || old.some((v, i) => Math.abs(v - out[i]) > 0.01)) { this.beacons.set(b.id, out); this.beaconsDirty = true; }
  }

  private rebuildBeacons(): void {
    if (!this.beaconMesh) {
      const g = new Geo(new Xf());
      g.blob(0, -0.3, 0, 0.32, 0.32, 0.32, new Color3(1, 1, 1), 6, 4);
      this.beaconMesh = g.toMesh('bld-beacons', this.scene, false);
      this.beaconMesh.material = this.mats.beacon;
      this.beaconMesh.isPickable = false;
      this.beaconMesh.alwaysSelectAsActiveMesh = true;
      this.beaconMesh.doNotSyncBoundingInfo = true;
    }
    const m: number[] = [];
    for (const v of this.beacons.values()) for (let i = 0; i < v.length; i += 3) m.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[i], v[i + 1], v[i + 2], 1);
    this.beaconMesh.isVisible = m.length > 0;
    if (m.length) this.beaconMesh.thinInstanceSetBuffer('matrix', new Float32Array(m), 16, true);
  }

  private rebuild(e: Entry, lod: Lod): void {
    const b = e.b, look = e.look;
    const cut = this.cutHost === b.id;
    const towerKind = isTowerKind(b.kind);
    this.rebuilds++;
    this.updateBeacons(e);
    if (lod === 0) {
      const key = FarLayer.keyOf(b.x, b.y);
      if (e.chunk && e.chunk !== key) this.far.set(b.id, e.chunk, null);
      const model = e.farCache && sigMatches(e.farCache.sig, b, look, cut, e.extra) ? e.farCache.model : farModel(b, look, e.units, e.extra.occ / 10);
      e.farCache = { sig: sigOf(b, look, cut, e.extra), model };
      this.far.set(b.id, key, model);
      e.chunk = key;
      // keep the detailed look (disabled) for when the camera comes back; deleting hundreds of
      // GPU buffers at once makes the next buffer creation stall
      this.stashCurrent(e);
      e.lod = 0;
      e.close = false;
      e.sig = sigOf(b, look, cut, e.extra);
      return;
    }
    const close = cut && e.wantClose;
    if (e.stash && !sigMatches(e.stash.sig, b, look, false, e.extra)) this.dropStash(e); // outdated
    // switching back to the level shown just before? Swap it in instead of rebuilding
    const st = e.stash;
    if (st && st.lod === lod && !close && !cut && sigMatches(st.sig, b, look, false, e.extra)) {
      e.stash = null;
      this.stashed.delete(e);
      this.stashCurrent(e);
      for (const m of st.meshes) m.setEnabled(true);
      if (st.props) this.props.attach(st.props);
      if (st.inside) this.props.attach(st.inside);
      e.meshes = st.meshes; e.signs = st.signs; e.props = st.props; e.inside = st.inside;
      e.signsOn = e.dist < SIGN_DIST.in;
      this.showSigns(e.signs, e.signsOn);
      if (e.chunk) { this.far.set(b.id, e.chunk, null); e.chunk = null; }
      e.lod = lod;
      e.close = false;
      e.sig = st.sig;
      return;
    }
    const tg = performance.now();
    const c = new Ctx(b, look, cut && !towerKind, lod === 2, close);
    c.units = e.units;
    c.cutLevel = cut && towerKind ? e.extra.level : -1;
    c.litRes = e.extra.occ / 10;
    generate(c);
    const tGen = performance.now() - tg;
    const meshes: Mesh[] = [];
    const signs: SignShown[] = [];
    const rotY = Math.PI / 2 - b.angle;
    const add = (geo: Geo, mat: Material, tag: string, cast: boolean, pickable = true, colors = true, id = b.id): void => {
      if (geo.empty) return;
      // parts of the mesh that pick as hosted units (a shop in the podium)
      let parts: Parts | undefined;
      for (const mk of c.marks) {
        const a = mk.from.get(geo), z = mk.to.get(geo);
        if (a !== undefined && z !== undefined && z > a) (parts ??= []).push([a, z, mk.id]);
      }
      const m = geo.toMesh(`bld${b.id}-${tag}`, this.scene, colors);
      m.material = mat;
      if (tag === 'sign') { signs.push({ mesh: m, key: '', text: '', hue: 0, aspect: 1, style: 'brand', acquired: false, want: false, gone: false }); m.setEnabled(false); }
      else meshes.push(m);
      m.position.set(b.x, look.ground, b.y);
      m.rotation.y = rotY;
      m.receiveShadows = true;
      m.isPickable = pickable;
      m.metadata = parts ? { kind: 'building', id, parts } : { kind: 'building', id };
      m.freezeWorldMatrix();
      if (cast && this.shadows) this.shadows.addShadowCaster(m, false);
    };
    add(c.solid, this.mats.solid, 'solid', true);
    add(c.win, this.mats.win, 'win', false);
    add(c.clear, this.mats.clear, 'clear', false);
    add(c.ghost, this.mats.ghost, 'ghost', false, false);
    add(c.inside, this.mats.inside, 'inside', true);
    for (const [key, s] of c.signs) {
      if (s.geo.empty) continue;
      add(s.geo, this.mats.solid, 'sign', false, true, false, s.owner >= 0 ? s.owner : b.id);
      Object.assign(signs[signs.length - 1], { key, text: s.text, hue: s.hue, aspect: s.aspect, style: s.style });
    }
    const tMesh = performance.now() - tg - tGen;
    const td = performance.now();
    // after acquiring the new signs, so shared textures survive
    this.stashCurrent(e); // (the un-cut look is kept while a building is opened, so closing it is instant)
    if (e.chunk) { this.far.set(b.id, e.chunk, null); e.chunk = null; }
    e.meshes = meshes;
    e.signs = signs;
    e.signsOn = e.dist < SIGN_DIST.in;
    this.showSigns(signs, e.signsOn);
    if (c.props.count > 0) {
      e.props = c.props.finish();
      this.props.attach(e.props);
    }
    if (c.insideProps.count > 0) {
      e.inside = c.insideProps.finish();
      this.props.attach(e.inside);
    }
    this.lastBreakdown = { gen: +tGen.toFixed(2), mesh: +tMesh.toFixed(2), swap: +(performance.now() - td).toFixed(2), verts: meshes.reduce((n, m) => n + m.getTotalVertices(), 0), props: c.props.count + c.insideProps.count };
    e.lod = lod;
    e.close = close;
    e.sig = sigOf(b, look, cut, e.extra);
  }

  /** Entries with a stashed level, oldest first (capped to bound memory). */
  private stashed = new Set<Entry>();
  /** How many hidden detailed buildings to keep at most (the old renderer kept every building built). */
  stashCap = 320;

  /** Keep what is shown now (a clean detailed level) as the entry's stash; dispose anything else. */
  private stashCurrent(e: Entry): void {
    const ok = (e.lod === 1 || e.lod === 2) && !e.close && e.sig && !e.sig.cut && e.meshes.length > 0 && sigMatches(e.sig, e.b, e.look, false, e.extra);
    if (!ok) { this.disposeEntry(e); return; }
    this.dropStash(e);
    for (const m of e.meshes) m.setEnabled(false);
    this.showSigns(e.signs, false);
    this.props.detach(e.props);
    this.props.detach(e.inside);
    e.stash = { lod: e.lod as Lod, sig: e.sig!, meshes: e.meshes, signs: e.signs, props: e.props, inside: e.inside };
    e.meshes = []; e.signs = []; e.props = null; e.inside = null;
    this.stashed.add(e);
    if (this.stashed.size > this.stashCap) {
      const oldest = this.stashed.values().next().value as Entry;
      this.dropStash(oldest);
    }
  }

  private dropStash(e: Entry): void {
    const st = e.stash;
    this.stashed.delete(e);
    if (!st) return;
    e.stash = null;
    for (const m of st.meshes) {
      if (this.shadows) this.shadows.removeShadowCaster(m, false);
      m.dispose(false, false);
    }
    this.disposeSigns(st.signs);
  }

  private disposeEntry(e: Entry): void {
    for (const m of e.meshes) {
      if (this.shadows) this.shadows.removeShadowCaster(m, false);
      m.dispose(false, false);
    }
    e.meshes = [];
    this.disposeSigns(e.signs);
    e.signs = [];
    this.props.detach(e.props);
    e.props = null;
    this.props.detach(e.inside);
    e.inside = null;
  }

  /** Show or hide a building's sign text (the texture is made the first time a sign is shown). */
  private showSigns(signs: SignShown[], on: boolean): void {
    for (const s of signs) {
      s.want = on;
      if (on && !s.acquired) { this.signQueue.push(s); continue; }
      s.mesh.setEnabled(on);
    }
  }

  /** Signs waiting for their texture; a few are made per frame (drawing text into a new texture takes ~1 ms). */
  private signQueue: SignShown[] = [];

  private drainSigns(): void {
    let n = 0;
    while (this.signQueue.length && n < 4) {
      const s = this.signQueue.shift()!;
      if (s.gone || !s.want || s.acquired) { if (s.acquired && s.want && !s.gone) s.mesh.setEnabled(true); continue; }
      s.mesh.material = this.acquireSign(s.key, s.text, s.hue, s.aspect, s.style);
      s.acquired = true;
      s.mesh.setEnabled(true);
      n++;
    }
  }

  private disposeSigns(signs: SignShown[]): void {
    for (const s of signs) {
      s.gone = true;
      s.mesh.dispose(false, false);
      if (s.acquired) this.releaseSign(s.key);
    }
  }

  private signGlow(style: SignStyle): Color3 {
    if (style === 'onair') return new Color3(1, 1, 1);
    if (style === 'carved' || style === 'metal') { const k = 0.05 + this.night * 0.4; return new Color3(k, k, k); }
    if (style === 'lease') { const k = 0.06 + this.night * 0.25; return new Color3(k, k, k); }
    const k = 0.08 + this.night * 0.85;
    return new Color3(k, k, k);
  }

  private acquireSign(key: string, text: string, hue: number, aspect: number, style: SignStyle): StandardMaterial {
    let s = this.signMats.get(key);
    if (!s) {
      const w = 512, h = Math.max(64, Math.min(256, Math.round(w / aspect / 16) * 16));
      const tex = new DynamicTexture(`sign:${key}`, { width: w, height: h }, this.scene, true);
      tex.wrapU = Texture.CLAMP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = 8;
      drawSignTexture(tex, text, hue, style);
      const mat = new StandardMaterial(`signm:${key}`, this.scene);
      mat.diffuseTexture = tex;
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      s = { mat, tex, refs: 0, style };
      mat.emissiveColor = this.signGlow(style);
      this.signMats.set(key, s);
    }
    s.refs++;
    return s.mat;
  }

  private releaseSign(key: string): void {
    const s = this.signMats.get(key);
    if (!s) return;
    s.refs--;
    if (s.refs <= 0) {
      s.tex.dispose();
      s.mat.dispose();
      this.signMats.delete(key);
    }
  }

  /** Ownership overlay: thin-instanced flag poles + colored lot borders (no per-building rebuilds). */
  private rebuildOwners(): void {
    if (!this.ownerPole) {
      const t = new Xf();
      const pole = new Geo(t);
      pole.cyl(0, 0, 0, 0.07, 0.06, 5.2, 6, C.dark);
      pole.blob(0, 5.25, 0, 0.12, 0.12, 0.12, C.yellow, 5, 3);
      pole.cyl(0, 0, 0, 0.25, 0.25, 0.2, 6, C.concrete);
      this.ownerPole = pole.toMesh('owner-poles', this.scene);
      this.ownerPole.material = this.mats.solid;
      const flag = new Geo(t);
      flag.box(0.8, 4.2, 0, 1.5, 0.95, 0.05, C.white);
      this.ownerFlag = flag.toMesh('owner-flags', this.scene);
      this.ownerFlag.material = this.mats.owner;
      const edge = new Geo(t);
      edge.box(0, 0.0, 0, 1, 0.16, 0.3, C.white);
      this.ownerEdge = edge.toMesh('owner-edges', this.scene);
      this.ownerEdge.material = this.mats.owner;
      for (const m of [this.ownerPole, this.ownerFlag, this.ownerEdge]) {
        m.isPickable = false;
        m.receiveShadows = true;
        m.alwaysSelectAsActiveMesh = true;
        m.freezeWorldMatrix();
      }
      if (this.shadows) { this.shadows.addShadowCaster(this.ownerPole, false); this.shadows.addShadowCaster(this.ownerFlag, false); }
    }
    const pm: number[] = [], fm: number[] = [], fc: number[] = [], em: number[] = [], ec: number[] = [];
    const m = new Matrix();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const pos = new Vector3();
    const scl = new Vector3();
    const put = (arr: number[], mat: Matrix) => { mat.copyToArray(arr, arr.length); };
    for (const e of this.entries.values()) {
      if (e.owner < 0 || !e.look.ownerColor) continue;
      const b = e.b, look = e.look;
      const rot = Math.PI / 2 - b.angle;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const lw = Math.max(look.lotW || 0, b.w + 1), ld = Math.max(look.lotD || 0, b.d + 1);
      const wpt = (lx: number, lz: number, y: number) => pos.set(b.x + lx * cs + lz * sn, look.ground + y, b.y - lx * sn + lz * cs);
      const col = look.ownerColor!;
      Quaternion.RotationYawPitchRollToRef(rot, 0, 0, q);
      Matrix.ComposeToRef(one, q, wpt(-lw / 2 + 0.6, ld / 2 - 0.6, 0.05), m);
      put(pm, m); put(fm, m);
      fc.push(col.r, col.g, col.b, 1);
      const edges: [number, number, number, number][] = [[0, ld / 2 - 0.15, lw, 0], [0, -ld / 2 + 0.15, lw, 0], [-lw / 2 + 0.15, 0, ld, 1], [lw / 2 - 0.15, 0, ld, 1]];
      for (const [lx, lz, len, turn] of edges) {
        Quaternion.RotationYawPitchRollToRef(rot + (turn ? Math.PI / 2 : 0), 0, 0, q);
        scl.set(len, 1, 1);
        Matrix.ComposeToRef(scl, q, wpt(lx, lz, 0.04), m);
        put(em, m);
        ec.push(col.r, col.g, col.b, 1);
      }
    }
    const set = (mesh: Mesh, mats: number[], cols?: number[]) => {
      const n = mats.length / 16;
      mesh.isVisible = n > 0;
      if (n === 0) return;
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
      if (cols) mesh.thinInstanceSetBuffer('color', new Float32Array(cols), 4, true);
    };
    set(this.ownerPole!, pm);
    set(this.ownerFlag!, fm, fc);
    set(this.ownerEdge!, em, ec);
  }
}
