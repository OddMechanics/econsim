// Food plants that turn the farms' goods into food (besides the generic food
// factory in industry.ts):
//   bakery: a brick bakehouse with a shop window under a striped awning, the
//     oven's steel flue, a flour silo with its fill pipe, a bread van;
//   dairy: a clean white plant with a glazed front, a row of tall stainless
//     milk silos joined by a pipe bridge, a milk tanker at the intake;
//   meat plant: a windowless insulated-panel hall with sealed refrigerated
//     docks, condensers on the roof, a reefer truck at a dock, a livestock
//     trailer at the holding pen behind.

import { Color3 } from '@babylonjs/core';
import { C, GLASS_DAY, GLOW_ORANGE, P, WS, hx, mix, shade } from './buildingGeo';
import { Ctx, GLASS_SHOP, crate, fence, gableRoof, highWindows, lotGround, pallet, rollDoor } from './buildingCtx';
import { modernHall } from './industry';

/** A box truck (local origin at its foot, nose toward +z): a cab and a body; `reefer` adds a fridge unit on the body's front. */
function boxTruck(c: Ctx, x: number, z: number, rot: number, cab: Color3, body: Color3, reefer: boolean, len = 6.4): void {
  const g = c.solid;
  c.t.push(x, 0.05, z, rot);
  g.box(0, 0.55, len / 2 - 1.0, 2.3, 1.85, 1.9, cab);
  g.box(0, 1.55, len / 2 - 0.06, 2.1, 0.7, 0.04, GLASS_DAY, 0, false);
  g.box(0, 0.6, -0.9, 2.45, 2.5, len - 2.2, body);
  if (reefer) {
    g.box(0, 2.1, len / 2 - 2.0, 1.6, 0.9, 0.35, hx('#d9dcdc'));
    g.box(0, 2.3, len / 2 - 1.8, 1.1, 0.5, 0.04, C.dark, 0, false);
  }
  g.box(0, 0.35, 0, 1.0, 0.3, len - 0.4, C.iron);
  for (const wz of [len / 2 - 1.0, -len / 2 + 1.6, -len / 2 + 2.6]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.45, wz, wx + 0.15, 0.45, wz, 0.45, 8, C.tire, true, 0.45, C.steel);
  c.t.pop();
}

/** A tall stainless silo with a domed top (local origin at its foot). */
function steelSilo(c: Ctx, x: number, z: number, r: number, h: number): void {
  const g = c.solid;
  g.cyl(x, 0.05, z, r + 0.15, r + 0.15, 0.4, 12, C.concrete);
  g.cyl(x, 0.45, z, r, r, h, 12, hx('#d6dadd'));
  for (let k = 1; k < 4; k++) g.cyl(x, 0.45 + (k / 4) * h, z, r + 0.02, r + 0.02, 0.06, 12, hx('#b9bec2'), 0, false);
  g.blob(x, 0.45 + h, z, r + 0.01, r * 0.45, r + 0.01, hx('#e2e5e7'), 12, 6, true);
  g.box(x + r + 0.1, 0.45, z, 0.06, h, 0.4, C.iron, 0, false);
}

// ================================================================ bakery

export function bakery(c: Ctx): void {
  const { b } = c;
  const g = c.solid;
  lotGround(c, 'paved');
  const brick = c.pick(P.bricks, 1);
  const W = b.w - 0.8, D = b.d - 1.2, cz = -0.4, front = cz + D / 2, H = 5.2;
  const frame = hx('#2f3338');
  const awning = c.brand;
  c.body = { cx: 0, cz, w: W, d: D, storey: H, floors: 1, floor: C.tile, base: 0.25 };
  g.box(0, 0, cz, W + 0.3, 0.25, D + 0.3, hx('#8e8a82'));
  c.wall.box(0, 0.25, cz, W, H - 0.25, D, brick);
  gableRoof(c, 0, H, cz, W, D, 1.8, hx('#5d6770'), brick, 0.4);
  if (!c.cut) {
    c.sides(0, cz, W, D, (s, len) => {
      // a soldier course under the eaves
      g.quad(-len / 2, H - 0.45, 0.015, len / 2, H - 0.45, 0.015, len / 2, H - 0.3, 0.015, -len / 2, H - 0.3, 0.015, shade(brick, 0.82), 0, 0, 1);
      if (s === 0) {
        // the shop: a big window and a glass door on the left, the delivery door on the right
        const sx0 = -len / 2 + 0.8, sx1 = -0.4;
        for (let k = 0; k < 3; k++) {
          const a = sx0 + (k * (sx1 - sx0)) / 3, bb = sx0 + ((k + 1) * (sx1 - sx0)) / 3;
          if (k === 2) continue;
          c.lit(WS.shop).quad(a + 0.05, 0.75, 0.04, bb - 0.05, 0.75, 0.04, bb - 0.05, 2.8, 0.04, a + 0.05, 2.8, 0.04, GLASS_SHOP, 0, 0, 1);
          g.box(a, 0.7, 0.05, 0.08, 2.15, 0.06, frame, 0, false);
        }
        c.door(sx0 + ((2.5) * (sx1 - sx0)) / 3, 1.1, 2.4, frame, frame, 0.25, true);
        g.box((sx0 + sx1) / 2, 0.25, 0.08, sx1 - sx0 + 0.2, 0.5, 0.12, shade(brick, 0.8));
        rollDoor(c, len / 4 + 0.6, 0.25, 3.0, 3.0, C.steel);
        // the striped awning over the shop window
        const aw = sx1 - sx0 + 0.6;
        for (let k = 0; k < Math.round(aw / 0.45); k++) {
          const x = sx0 - 0.3 + (k + 0.5) * (aw / Math.round(aw / 0.45));
          g.slab([x - aw / Math.round(aw / 0.45) / 2, 3.35, 0.05, x + aw / Math.round(aw / 0.45) / 2, 3.35, 0.05, x + aw / Math.round(aw / 0.45) / 2, 2.95, 1.2, x - aw / Math.round(aw / 0.45) / 2, 2.95, 1.2], 0.04, k % 2 ? C.white : awning, 0, 1, 0.3);
        }
      } else if (s !== 2) {
        // warm-lit high windows: the ovens inside
        highWindows(c, len - 1, 3.0, 1.0, 2.2);
      }
    });
    // the bakery's warm glow from the oven room
    c.warm.box(-W / 4, 3.4, cz - D / 2 - 0.02, 1.0, 0.6, 0.04, GLOW_ORANGE);
  }
  c.t.push(0, 0, front + 0.05, 0);
  c.sign(c.look.firmName, -W / 4 + 0.2, 3.65, Math.min(W * 0.48, 6), 0.75, 0.02, null);
  c.t.pop();
  // the oven's flue up through the roof
  g.cyl(W / 4, H - 0.5, cz - D / 4, 0.32, 0.3, 4.2, 8, C.steel);
  g.cyl(W / 4, H + 3.7, cz - D / 4, 0.45, 0.45, 0.2, 8, C.dark);
  // the flour silo on legs at the side, its fill pipe to the roof
  const side = (c.lw - W) / 2;
  const fx = side > 3.2 ? W / 2 + Math.min(side - 1.2, 1.8) : W / 2 - 1.6, fz = cz - D / 2 + (side > 3.2 ? 2.2 : -1.6);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; g.box(fx + Math.cos(a) * 0.75, 0.05, fz + Math.sin(a) * 0.75, 0.14, 2.3, 0.14, C.metal); }
  g.cyl(fx, 1.2, fz, 0.2, 1.05, 1.1, 10, hx('#e8e8e4'));
  g.cyl(fx, 2.3, fz, 1.05, 1.05, 5.0, 10, hx('#eeeeea'));
  g.cyl(fx, 7.3, fz, 1.05, 0.15, 0.6, 10, hx('#dcdcd8'));
  g.tube(fx, 7.2, fz, side > 3.2 ? W / 2 - 0.3 : fx - 1.4, H + 0.8, fz + 1.2, 0.09, 6, C.steel);
  // the bread van at the delivery door
  if (c.ld / 2 - front > 3.6) boxTruck(c, W / 4 + 0.6, front + 3.4, Math.PI / 2, C.white, mix(C.white, awning, 0.15), false, 5.2);
  for (let k = 0; k < 3; k++) crate(c, W / 2 - 0.8 - k * 0.7, 0.05, front + 0.9, 0.55, hx('#c49a66'));
}

// ============================================================ dairy plant

export function dairyplant(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'paved');
  const h = modernHall(c, { H: 7.0, wall: hx('#f4f5f3'), roof: 'flat', doors: 1, docks: 2, office: true, accent: hx('#2f6db5'), ribs: 'h', floor: C.tile });
  const { bw, bd, cz } = h;
  // a row of tall milk silos along the side (or behind), joined by a pipe bridge
  const side = (c.lw - bw) / 2;
  const alongSide = side > 3.4;
  const r = alongSide ? Math.min(1.5, side / 2 - 0.3) : 1.4;
  const xs: [number, number][] = [];
  for (let k = 0; k < 3; k++) {
    const x = alongSide ? -bw / 2 - side / 2 : -bw / 2 + 2 + k * (2 * r + 0.8);
    const z = alongSide ? cz - bd / 2 + 2 + k * (2 * r + 0.8) : cz - bd / 2 - r - 0.8;
    if (!alongSide && c.ld / 2 + cz - bd / 2 < 2 * r + 1.2) break;
    steelSilo(c, x, z, r, 11 + (k % 2) * 1.2);
    xs.push([x, z]);
  }
  if (xs.length > 1) {
    const [ax, az] = xs[0], [bx, bz] = xs[xs.length - 1];
    g.tube(ax, 9.5, az, bx, 9.5, bz, 0.2, 6, C.steel);
    g.tube(bx, 9.5, bz, alongSide ? -bw / 2 + 0.2 : bx, 7.2, alongSide ? bz : cz - bd / 2 + 0.2, 0.2, 6, C.steel);
  }
  // the milk tanker at the intake (a stainless tank on a trailer behind the cab)
  if (side > 3.2) {
    const tx = bw / 2 + side / 2, tz = cz - 0.5;
    c.t.push(tx, 0.05, tz, Math.PI);
    g.box(0, 0.55, 3.6, 2.3, 1.9, 1.9, hx('#2f6db5'));
    g.box(0, 1.6, 4.56, 2.1, 0.7, 0.04, GLASS_DAY, 0, false);
    g.tube(0, 1.75, 2.3, 0, 1.75, -4.2, 1.05, 12, hx('#d6dadd'), true, 1.05, hx('#c4c8cc'));
    g.box(0, 0.35, -0.5, 1.0, 0.3, 8.4, C.iron);
    for (const wz of [3.6, -2.8, -3.8]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.45, wz, wx + 0.15, 0.45, wz, 0.45, 8, C.tire, true, 0.45, C.steel);
    c.t.pop();
  }
  // a crate stack of milk at the front
  for (let k = 0; k < 2; k++) pallet(c, -bw / 2 + 1.2 + k * 1.4, h.front + 1.0, 0, hx('#e8eef4'), 0.9, 1.1);
}

// ============================================================= meat plant

export function meatplant(c: Ctx): void {
  const g = c.solid;
  lotGround(c, 'paved');
  const h = modernHall(c, { H: 6.4, wall: hx('#d9dcdc'), roof: 'flat', doors: 0, docks: 3, office: true, accent: hx('#8a2f2a'), ribs: 'v', floor: C.tile, windows: false });
  const { bw, bd, cz, H } = h;
  // dock seals (black hoods) on the docks, condensers on the roof
  if (!c.cut) {
    c.sides(0, cz, bw, bd, (_s, len) => {
      for (let k = 0; k < 3; k++) {
        const x = -len / 2 + (k + 0.5) * (len / 3);
        g.box(x, 1.0, 0.12, 3.4, 3.6, 0.35, hx('#24262a'), 0, false);
      }
    }, [1]);
    for (let k = 0; k < 3; k++) {
      const x = -bw / 4 + k * 2.4, z = cz - bd * 0.25;
      g.box(x, H + 0.1, z, 2.0, 1.2, 1.1, hx('#c9ccd0'));
      for (const sx of [-0.5, 0.5]) g.cyl(x + sx, H + 1.3, z, 0.42, 0.42, 0.06, 10, C.dark, 0, false);
    }
  }
  // a reefer truck backed up to a dock
  const side = (c.lw - bw) / 2;
  // (nose out, backed up to the dock if there's room; else parked along the wall)
  if (side > 3.2) boxTruck(c, bw / 2 + side / 2, cz - bd / 6, side > 7.8 ? Math.PI / 2 : Math.PI, C.white, hx('#f2f2ee'), true, 7.2);
  // behind: a holding pen with a rail fence and a livestock trailer
  const back = c.ld / 2 + cz - bd / 2;
  if (back > 4.5) {
    const pz = cz - bd / 2 - Math.min(back - 1, 6) / 2, pd = Math.min(back - 1, 6), pw = Math.min(bw * 0.5, 9), px = -bw / 4;
    g.box(px, 0.05, pz, pw, 0.06, pd, hx('#8f8a80'), 0, false);
    fence(c, px - pw / 2, pz - pd / 2, px + pw / 2, pz - pd / 2, 'rail', C.metal);
    fence(c, px - pw / 2, pz - pd / 2, px - pw / 2, pz + pd / 2, 'rail', C.metal);
    fence(c, px + pw / 2, pz - pd / 2, px + pw / 2, pz + pd / 2, 'rail', C.metal);
    if (back > 6) {
      c.t.push(bw / 4 + 1, 0.05, pz, Math.PI / 2);
      g.box(0, 0.7, 0, 2.4, 2.4, 6.5, hx('#b9bec2'));
      for (let k = 0; k < 6; k++) g.box(0, 1.2 + (k % 2) * 0.6, -2.6 + k * 1.0, 2.46, 0.12, 0.6, C.dark, 0, false);
      for (const wz of [-1.8, -0.8]) for (const wx of [-1.0, 1.0]) g.tube(wx - 0.15, 0.4, wz, wx + 0.15, 0.4, wz, 0.4, 8, C.tire, true, 0.4, C.steel);
      c.t.pop();
    }
  }
}
