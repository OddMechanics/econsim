// Close-up interiors: when a building is cut open and the camera is near, each
// station gets furnished in detail (monitors, keyboards, mugs, papers, plates
// with food, glasses, pots on the stove, products on shelves, pillows, TVs...)
// and every room gets the things that aren't stations (kitchens, bookshelves,
// plants, pictures, a bank vault, a council chamber, a TV set, a server room).
// Everything is derived from the building's seed, so it never changes.

import { Color3 } from '@babylonjs/core';
import { FLOOR_H, stationsOf, type Station } from '../sim/layout';
import { hash2 } from '../sim/rng';
import { C, P as PAL, hx, mix, shade } from './buildingGeo';
import { PC, type Host } from './props';

const pick = <T>(arr: readonly T[], h: number): T => arr[Math.floor(h * arr.length) % arr.length];
const PI = Math.PI;

const SCREEN_CODE = hx('#24324a');
const NEW_STATION_KINDS = new Set(['stage', 'podium', 'camera', 'server', 'seat']);

/** Station kinds that have no basic furniture: they are always drawn with the detailed version. */
export function needsDetail(kind: string): boolean { return NEW_STATION_KINDS.has(kind); }

/** Furnish one station in detail (in the station frame: the person is at the origin facing +Z). */
export function stationDetail(h: Host, s: Station, i: number, tables: Set<string>): boolean {
  switch (s.kind) {
    case 'desk': desk(h, s, i); return true;
    case 'counter': counter(h, s, i); return true;
    case 'stove': stove(h, i); return true;
    case 'table': table(h, s, i, tables); return true;
    case 'machine': machine(h, i); return true;
    case 'shelf': shelf(h, i); return true;
    case 'bed': bed(h, i); return true;
    case 'sofa': sofa(h, i); return true;
    case 'stage': stage(h, i); return true;
    case 'podium': podium(h, s, i); return true;
    case 'camera': camera(h, i); return true;
    case 'server': server(h, i); return true;
    case 'seat': seat(h, i); return true;
    default: return false;
  }
}

function rnd(h: Host, i: number): (k: number) => number {
  return (k: number) => hash2(h.b.seed, 20000 + i * 53 + k);
}

// ------------------------------------------------------------ desks

function desk(h: Host, s: Station, i: number): void {
  const g = h.solid, P = h.props, t = h.t, kind = h.b.kind;
  const r = rnd(h, i);
  const home = kind === 'house' || kind === 'apartments' || kind === 'tower' || kind === 'trailer';
  const council = kind === 'cityhall' && s.role === 'official';
  const topC = home ? pick(PC.woods, r(1)) : council ? hx('#5a3d28') : pick([hx('#dcd7cb'), hx('#e8e6e0'), hx('#c9b79a'), hx('#f0efe9')], r(1));
  const legC = home ? shade(topC, 0.78) : council ? hx('#3f2a1c') : hx('#8d949a');
  const W = council ? 1.3 : home ? 1.2 : 1.4, D = council ? 0.62 : 0.7, zc = 0.62, top = 0.755;
  g.box(0, 0.72, zc, W, 0.035, D, topC);
  if (council) {
    g.box(0, 0, zc + D / 2 - 0.04, W, 0.72, 0.05, legC);
    for (const sx of [-1, 1]) g.box(sx * (W / 2 - 0.03), 0, zc, 0.05, 0.72, D - 0.05, legC);
  } else {
    for (const sx of [-1, 1]) g.box(sx * (W / 2 - 0.03), 0, zc, 0.04, 0.72, D - 0.04, legC, 0, false);
    if (!home) {
      g.box(0, 0.3, zc + D / 2 - 0.04, W - 0.1, 0.38, 0.02, legC, 0, false);
      g.box(W / 2 - 0.28, 0, zc, 0.4, 0.6, D - 0.12, legC);
      for (let k = 0; k < 3; k++) g.box(W / 2 - 0.28, 0.1 + k * 0.18, zc - D / 2 + 0.055, 0.32, 0.005, 0.006, shade(legC, 0.7), 0, false);
    }
  }
  if (council) {
    P.add('namePlate', t, 0, top, zc + 0.24, 0, 1, 1, 1);
    P.add('mic', t, 0.3, top, zc + 0.16, -0.25);
    for (let k = 0; k < 2; k++) P.add('box', t, -0.2 + k * 0.03, top + k * 0.004, zc - 0.05, (r(3 + k) - 0.5) * 0.4, 0.21, 0.003, 0.297, k ? C.white : PC.cream);
    P.add('glassCup', t, -0.48, top, zc + 0.1, 0, 0.07, 0.11, 0.07);
    P.add('box', t, 0.18, top, zc - 0.1, 0.1, 0.24, 0.015, 0.32, hx('#2d3e5c'));
    P.add('chairArm', t, 0, 0, -0.08, (r(6) - 0.5) * 0.3, 0.9, 0.95, 0.9, hx('#6b2a2a'));
    return;
  }
  // screens
  if (home && r(40) < 0.6) {
    t.push(0.05, top, zc - 0.02, PI + (r(41) - 0.5) * 0.3);
    P.add('laptop', t, 0, 0, 0, 0, 1, 1, 1, r(42) < 0.5 ? hx('#c9cdd1') : hx('#3a3d42'));
    P.add('laptopScreen', t, 0, 0, 0, 0, 1, 1, 1, pick(PC.screens, r(43)));
    t.pop();
  } else {
    const dual = kind === 'netco' ? r(2) < 0.75 : kind === 'studio' ? r(2) < 0.45 : home ? false : r(2) < 0.22;
    const scr = kind === 'netco' && r(3) < 0.6 ? SCREEN_CODE : pick(PC.screens, r(4));
    const mons: [number, number][] = dual ? [[-0.31, 0.2], [0.31, -0.2]] : [[0, 0]];
    for (const [mx, yaw] of mons) {
      t.push(mx, top, zc + 0.26, PI + yaw);
      P.add('monitor', t, 0, 0, 0);
      P.add('screen', t, 0, 0.14, 0.002, 0, 0.56, 0.32, 1, mx > 0 ? pick(PC.screens, r(5)) : scr);
      t.pop();
    }
    const kb = r(7) < 0.6 ? hx('#2a2c30') : hx('#e8e8e4');
    P.add('keyboard', t, 0, top, zc - 0.15, (r(6) - 0.5) * 0.12, 1, 1, 1, kb);
    P.add('dome', t, 0.34, top, zc - 0.12, (r(8) - 0.5) * 0.5, 0.06, 0.035, 0.1, kb);
  }
  if (r(9) < 0.75) P.add('mug', t, r(10) < 0.5 ? -0.55 : 0.56, top, zc - 0.08 + r(11) * 0.2, r(12) * 6, 1, 1, 1, pick(PC.mugs, r(13)));
  if (r(14) < 0.8) {
    const n = 1 + Math.floor(r(15) * 3);
    for (let k = 0; k < n; k++) P.add('box', t, -0.38 + r(16 + k) * 0.08, top + k * 0.004, zc - 0.02 + r(19 + k) * 0.1, (r(22 + k) - 0.5) * 0.7, 0.21, 0.003, 0.297, k % 2 ? PC.cream : C.white);
  }
  if (home && r(44) < 0.7) {
    const n = 2 + Math.floor(r(45) * 3);
    for (let k = 0; k < n; k++) P.add('book', t, -0.42, top + k * 0.035, zc + 0.2, (r(46 + k) - 0.5) * 0.3, 0.17, 0.033, 0.24, pick(PC.books, r(50 + k)));
  }
  if (r(25) < 0.35 && !home) P.add('binder', t, -0.62, top, zc + 0.22, PI / 2, 1, 1, 1, pick(PC.books, r(26)));
  if (r(27) < (home ? 0.6 : 0.3)) {
    t.push(-0.5, top, zc + 0.18, 0.5 + r(28) * 0.5);
    P.add('deskLamp', t, 0, 0, 0, 0, 1, 1, 1, pick([hx('#2a2c30'), C.white, hx('#c0392b'), hx('#2e86c1'), hx('#e8b631')], r(29)));
    P.add('glowBall', t, 0, 0.31, 0.18, 0, 0.07, 0.035, 0.07);
    t.pop();
  }
  if (r(30) < 0.3 && !home) P.add('phone', t, 0.56, top, zc + 0.18, -0.4 - r(31) * 0.3);
  if (r(32) < 0.25) P.add('plantPot', t, 0.6, top, zc + 0.26, r(33) * 6);
  if (r(34) < 0.3) P.add('box', t, 0.4, top, zc + 0.3, 0.25 + r(35) * 0.4, 0.12, 0.16, 0.015, pick([hx('#2a2c30'), hx('#c9a13b'), C.white, hx('#8a5a3a')], r(36)));
  if (home) P.add('chairWood', t, 0, 0, -0.02, (r(37) - 0.5) * 0.3, 1, 1, 1, pick(PC.woods, r(38)));
  else P.add('chairOffice', t, 0, 0, 0.02, (r(37) - 0.5) * 0.6, 1, 1, 1, kind === 'netco' ? pick([hx('#e2475a'), hx('#2e86c1'), hx('#3a3d42'), hx('#f1c40f')], r(38)) : pick(PC.upholstery, r(38)));
  if (r(39) < 0.4 && !home) P.add('litterBin', t, -0.52, 0, zc + 0.12, 0, 0.55, 0.42, 0.55, hx('#6a6e72'));
}

// ------------------------------------------------------------ counters

function counter(h: Host, s: Station, i: number): void {
  const g = h.solid, P = h.props, t = h.t, kind = h.b.kind;
  const r = rnd(h, i);
  if (kind === 'store' || (kind === 'dealer' && s.role === 'cashier')) {
    const col = kind === 'store' ? h.brand : hx('#e6e2d8');
    g.box(0, 0, 0.65, 2.0, 1.0, 0.6, col);
    g.box(0, 1.0, 0.65, 2.06, 0.05, 0.68, C.white);
    g.box(0, 0.06, 0.951, 1.9, 0.86, 0.01, shade(col, 0.85), 0, false);
    // register (screen toward the cashier), card terminal toward the customer, a belt with goods
    t.push(0.5, 1.05, 0.62, PI);
    P.add('cashRegister', t, 0, 0, 0);
    P.add('screen', t, 0, 0.31, -0.108, 0, 0.22, 0.12, 1, hx('#bfe8c8'));
    t.pop();
    P.add('cardTerminal', t, 0.05, 1.05, 0.86, 0.3);
    if (kind === 'store') {
      g.box(-0.5, 1.05, 0.65, 0.9, 0.012, 0.42, C.dark);
      for (let k = 0; k < 3; k++) P.add(k === 1 ? 'cyl' : 'box', t, -0.75 + k * 0.22, 1.062, 0.62 + (k % 2) * 0.08, r(k) * 2, 0.12, 0.08 + r(3 + k) * 0.14, 0.09, pick(PAL.goods, r(6 + k)));
      // impulse rack on the customer side
      g.box(-0.6, 0, 1.12, 0.7, 1.1, 0.25, C.metal, 0, false);
      for (let l = 0; l < 3; l++) for (let k = 0; k < 4; k++) P.add('box', t, -0.85 + k * 0.17, 0.25 + l * 0.32, 1.17, 0, 0.13, 0.17, 0.05, pick(PAL.goods, r(20 + l * 4 + k)));
      P.add('box', t, 0.85, 1.05, 0.55, 0, 0.3, 0.12, 0.2, hx('#e8dcc4'));
    } else {
      P.add('box', t, -0.5, 1.05, 0.7, 0.2, 0.21, 0.01, 0.3, pick(PAL.cars, r(9)));
    }
    return;
  }
  // reception: the visitor stands here, the receptionist behind the counter
  const stone = kind === 'bank' || kind === 'cityhall' ? hx('#d9cfbb') : hx('#e6e2d8');
  g.box(0, 0, 0.65, 2.2, 1.05, 0.6, stone);
  g.box(0, 1.05, 0.62, 2.3, 0.05, 0.72, kind === 'bank' || kind === 'cityhall' ? hx('#5a3d28') : C.white);
  g.box(0, 0.1, 0.341, 2.1, 0.06, 0.01, h.brand, 0, false);
  t.push(0.4, 1.1, 0.75, 0);
  P.add('monitor', t, 0, 0, 0);
  P.add('screen', t, 0, 0.14, 0.002, 0, 0.56, 0.32, 1, pick(PC.screens, r(1)));
  t.pop();
  P.add('keyboard', t, 0.4, 1.1, 0.88, PI, 1, 1, 1, hx('#2a2c30'));
  P.add('dome', t, -0.25, 1.1, 0.45, 0, 0.08, 0.05, 0.08, hx('#c9a13b'));
  P.add('box', t, -0.6, 1.1, 0.55, 0.15, 0.22, 0.25, 0.08, h.brand);
  P.add('plantPot', t, -0.95, 1.1, 0.7, r(2) * 6, 1.2, 1.2, 1.2);
  if (kind === 'bank') {
    h.clear.box(0, 1.1, 0.62, 2.2, 0.75, 0.02, hx('#b9d6e6'));
    h.solid.box(0, 1.85, 0.62, 2.3, 0.05, 0.08, C.metal);
    h.solid.box(0, 1.1, 0.62, 0.4, 0.06, 0.1, C.metal);
  }
  if (kind === 'cityhall') {
    P.add('flagStand', t, 1.4, 0, 0.8, 0, 0.7, 0.75, 0.7);
    P.add('flagCloth', t, 1.4, 0, 0.8, 0.4, 0.7, 0.75, 0.7, h.brand);
    t.push(-1.4, 0, 0.9, 0);
    g.box(0, 0, 0, 0.06, 1.7, 0.06, C.metal);
    g.box(0, 1.7, 0, 0.5, 0.3, 0.06, C.dark);
    P.add('screen', t, 0, 1.72, 0.035, 0, 0.44, 0.24, 1, hx('#ff6040'));
    t.pop();
  }
}

// ------------------------------------------------------------ kitchens

function stove(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t;
  const r = rnd(h, i);
  g.box(0, 0, 0.55, 0.9, 0.9, 0.7, C.steel);
  g.box(0, 0.9, 0.55, 0.9, 0.04, 0.7, C.dark);
  g.box(0, 0.12, 0.199, 0.7, 0.5, 0.01, C.dark, 0, false);
  g.box(0, 0.66, 0.195, 0.6, 0.03, 0.03, C.metal, 0, false);
  for (let k = 0; k < 4; k++) g.box(-0.3 + k * 0.2, 0.78, 0.196, 0.06, 0.06, 0.03, C.iron, 0, false);
  // pots and pans on the burners; a flame under the pan
  P.add('pot', t, -0.2, 0.94, 0.68, r(1) * 6);
  P.add('pan', t, 0.2, 0.94, 0.42, PI + (r(2) - 0.5) * 0.6);
  h.warm.box(0.2, 0.92, 0.42, 0.26, 0.02, 0.26, hx('#ff8a30'));
  if (r(3) < 0.6) P.add('pot', t, 0.22, 0.94, 0.72, r(4) * 6, 0.8, 0.9, 0.8);
  P.add('hood', t, 0, 1.75, 0.6, 0, 1.0, 0.8, 0.9);
  // prep counter beside the stove: board, knife, vegetables, a bowl
  g.box(1.0, 0, 0.55, 1.0, 0.9, 0.7, C.white);
  g.box(1.0, 0.9, 0.55, 1.02, 0.04, 0.72, C.steel);
  P.add('cuttingBoard', t, 0.95, 0.94, 0.48, (r(5) - 0.5) * 0.4);
  const veg = [hx('#d0342c'), hx('#e07b2e'), hx('#6fa24a'), hx('#e8d88a'), hx('#7a3b6e')];
  for (let k = 0; k < 4; k++) P.add('ball', t, 1.25 + (k % 2) * 0.1, 0.94, 0.68 + Math.floor(k / 2) * 0.1, 0, 0.08, 0.07, 0.08, pick(veg, r(6 + k)));
  P.add('disc', t, 0.72, 0.94, 0.72, 0, 0.24, 0.08, 0.24, C.white);
  // wall shelf with jars, bottles and plates
  g.box(0.5, 1.5, 0.82, 1.9, 0.03, 0.26, C.steel);
  for (let k = 0; k < 6; k++) P.add(k % 3 === 2 ? 'bottle' : 'cyl', t, -0.3 + k * 0.28, 1.53, 0.82, 0, k % 3 === 2 ? 0.8 : 0.09, k % 3 === 2 ? 0.8 : 0.14, k % 3 === 2 ? 0.8 : 0.09, pick([hx('#c9a13b'), hx('#8a3f30'), hx('#e8dcc4'), hx('#5a7a3a'), hx('#2f4f3e')], r(12 + k)));
  for (let k = 0; k < 5; k++) P.add('plate', t, 1.3, 1.53 + k * 0.018, 0.82, 0, 0.9, 1, 0.9);
  // utensil rail
  g.box(0, 1.35, 0.9, 0.8, 0.02, 0.02, C.metal, 0, false);
  for (let k = 0; k < 4; k++) P.add('box', t, -0.3 + k * 0.2, 1.08, 0.9, 0, 0.03, 0.27, 0.01, C.steel);
}

// ------------------------------------------------------------ dining

function table(h: Host, s: Station, i: number, tables: Set<string>): void {
  const g = h.solid, P = h.props, t = h.t;
  const r = rnd(h, i);
  if (s.role === 'waiter') {
    // service station: stacked plates, glasses, a coffee machine, menus
    g.box(0, 0, 0.55, 1.4, 0.95, 0.5, C.woodDark);
    g.box(0, 0.95, 0.55, 1.44, 0.04, 0.54, hx('#3a2a1c'));
    for (let k = 0; k < 8; k++) P.add('plate', t, -0.45, 0.99 + k * 0.017, 0.55, 0);
    for (let k = 0; k < 6; k++) P.add(k % 2 ? 'wineGlass' : 'glassCup', t, -0.1 + (k % 3) * 0.1, 0.99, 0.48 + Math.floor(k / 3) * 0.12, 0, k % 2 ? 1 : 0.07, k % 2 ? 1 : 0.11, k % 2 ? 1 : 0.07);
    P.add('coffeeMachine', t, 0.42, 0.99, 0.58, PI);
    for (let k = 0; k < 4; k++) P.add('box', t, 0.15, 0.99 + k * 0.012, 0.65, 0.1, 0.22, 0.01, 0.32, h.brandDark);
    P.add('disc', t, 0.05, 0.99, 0.4, 0, 0.36, 0.015, 0.36, hx('#8d949a'));
    return;
  }
  P.add('chairWood', t, 0, 0, -0.08, (r(1) - 0.5) * 0.25, 1, 1, 1, h.brand.r + h.brand.g > 1.1 ? PC.woods[2] : pick(PC.woods, hash2(h.b.seed, 777)));
  const tx = s.lx + Math.sin(s.facing) * 0.7, tz = s.lz + Math.cos(s.facing) * 0.7;
  const key = `${Math.round(tx * 2)}|${Math.round(tz * 2)}|${s.floor}`;
  const top = 0.765;
  if (!tables.has(key)) {
    tables.add(key);
    const cloth = hash2(h.b.seed, 778) < 0.6;
    g.cyl(0, 0, 0.7, 0.07, 0.07, 0.72, 6, C.iron);
    g.cyl(0, 0, 0.7, 0.3, 0.3, 0.04, 8, C.iron);
    if (cloth) {
      g.cyl(0, 0.52, 0.7, 0.56, 0.54, 0.23, 14, hx('#f6f3ec'), 0, false);
      g.cyl(0, 0.745, 0.7, 0.54, 0.54, 0.02, 14, hx('#fbfaf6'));
    } else g.cyl(0, 0.72, 0.7, 0.5, 0.5, 0.045, 12, pick(PC.woods, hash2(h.b.seed, 779)));
    // centerpiece, salt and pepper, menus
    const cp = r(2);
    if (cp < 0.45) { P.add('vase', t, 0, top, 0.7, 0, 0.8, 0.8, 0.8, pick([C.white, hx('#2e86c1'), hx('#c9a13b'), hx('#3f8a3a')], r(3))); P.add('bouquet', t, 0, top, 0.7, r(4) * 6, 0.65, 0.65, 0.65); }
    else if (cp < 0.8) { P.add('candle', t, 0, top, 0.7, 0, 1, 1, 1, PC.cream); P.add('flame', t, 0, top + 0.112, 0.7, 0); }
    P.add('cyl', t, 0.07, top, 0.78, 0, 0.03, 0.07, 0.03, C.white);
    P.add('cyl', t, 0.12, top, 0.78, 0, 0.03, 0.07, 0.03, hx('#3a3530'));
    if (r(5) < 0.3) P.add('box', t, -0.25, top, 0.72, 0.3, 0.2, 0.012, 0.28, h.brandDark);
  }
  // this seat's place setting
  const w = r(6);
  if (w < 0.85) {
    P.add('plate', t, 0, top, 0.42, 0);
    if (w < 0.6) P.add(pick(['foodA', 'foodB', 'foodC', 'foodD'] as const, r(7)), t, 0, top, 0.42, r(8) * 6);
    P.add('cutlery', t, 0, top, 0.42, 0);
    if (r(9) < 0.6) P.add('wineGlass', t, 0.2, top, 0.6, 0);
    else P.add('glassCup', t, 0.2, top, 0.6, 0, 0.065, 0.11, 0.065);
    if (r(10) < 0.35) P.add('mug', t, -0.22, top, 0.58, r(11) * 6, 0.85, 0.85, 0.85, C.white);
    P.add('box', t, -0.22, top, 0.38, 0.1, 0.12, 0.01, 0.12, r(12) < 0.5 ? C.white : h.brand);
  } else {
    P.add('box', t, 0, top, 0.45, (r(13) - 0.5) * 0.3, 0.22, 0.012, 0.3, h.brandDark);
  }
}

// ------------------------------------------------------------ factories

const MACHINE_C: Record<string, string> = {
  sawmill: '#5f8a5a', brickworks: '#8a6a52', steelmill: '#5b5f66', foodplant: '#c9ced3',
  workshop: '#4f7a8a', furniture: '#b98f5e', textile: '#8a7a5a', electronics: '#e8e8e4', carplant: '#e07b2e',
};

function machine(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t, kind = h.b.kind;
  const r = rnd(h, i);
  const col = hx(MACHINE_C[kind] ?? '#6a7f8f');
  // floor safety markings around the work area
  const Y = hx('#e8b631');
  for (const [x, z, w, d] of [[0, -0.35, 2.4, 0.06], [0, 2.3, 2.4, 0.06], [-1.2, 0.98, 0.06, 2.7], [1.2, 0.98, 0.06, 2.7]]) g.box(x, 0.003, z, w, 0.006, d, Y, 0, false);
  if (kind === 'carplant') {
    g.box(0, 0, 1.2, 0.8, 0.5, 0.8, C.dark);
    g.beam(0, 0.5, 1.2, 0.2, 1.8, 1.5, 0.3, col);
    g.beam(0.2, 1.8, 1.5, 0.7, 1.4, 2.2, 0.22, col);
    g.box(0.75, 1.15, 2.25, 0.2, 0.3, 0.2, C.dark);
    P.add('ledOn', t, 0, 0.42, 1.61, 0, 0.05, 0.05, 0.02, hx('#40ff60'));
    P.add('toolbox', t, -1.0, 0, 0.2, 0.4, 1, 1, 1, hx('#c0392b'));
    for (let k = 0; k < 3; k++) P.add('crate', t, -1.6, 0, 1.0 + k * 0.7, 0, 0.6, 0.6, 0.6, C.steel);
    return;
  }
  if (kind === 'textile') {
    g.box(0, 0, 1.0, 1.8, 0.9, 1.1, col);
    for (let k = 0; k < 4; k++) g.tube(-0.75 + k * 0.5, 1.1, 0.7, -0.75 + k * 0.5, 1.1, 1.3, 0.12, 6, PC.fabric[(i + k) % PC.fabric.length]);
    g.box(0, 0.9, 1.0, 1.8, 0.05, 0.3, C.white);
    for (let k = 0; k < 6; k++) g.box(-0.8 + k * 0.32, 0.92, 1.45, 0.01, 0.9, 0.01, C.white, 0, false);
    for (let k = 0; k < 3; k++) P.add('cyl', t, 1.25, 0.05 + k * 0.3, 1.0, 0, 0.26, 0.9, 0.26, pick(PC.fabric, r(k)));
    P.add('stool', t, 0, 0, -0.05, 0, 1, 1, 1, PC.wood);
    return;
  }
  if (kind === 'electronics') {
    g.box(0, 0.75, 0.8, 1.6, 0.05, 0.8, C.white);
    for (const sx of [-0.7, 0.7]) g.box(sx, 0, 0.8, 0.06, 0.75, 0.7, C.steel, 0, false);
    t.push(0, 0.8, 1.05, PI);
    P.add('monitor', t, 0, 0, 0, 0, 0.85, 0.85, 0.85);
    P.add('screen', t, 0, 0.12, 0.002, 0, 0.48, 0.27, 1, pick(PC.screens, r(1)));
    t.pop();
    for (let k = 0; k < 4; k++) P.add('box', t, -0.55 + k * 0.2, 0.8, 0.62 + (k % 2) * 0.06, (r(2 + k) - 0.5) * 0.3, 0.14, 0.012, 0.1, hx('#2f7a3a'));
    for (let k = 0; k < 6; k++) P.add('box', t, 0.35 + (k % 3) * 0.13, 0.8, 0.92 + Math.floor(k / 3) * 0.1, 0, 0.11, 0.05, 0.08, pick([hx('#c0392b'), hx('#2e86c1'), hx('#f1c40f'), hx('#27ae60')], r(10 + k)));
    t.push(-0.6, 0.8, 0.95, 0.6);
    P.add('deskLamp', t, 0, 0, 0, 0, 1, 1, 1, C.white);
    P.add('glowBall', t, 0, 0.31, 0.18, 0, 0.07, 0.035, 0.07);
    t.pop();
    P.add('box', t, 0.62, 0.8, 0.6, 0.4, 0.12, 0.06, 0.1, hx('#d35400'));
    P.add('chairOffice', t, 0, 0, 0.05, 0, 1, 1, 1, hx('#3a6ea5'));
    return;
  }
  // a generic machine: body, hopper, control panel with lit buttons and a screen, pipes to the ceiling
  g.box(0, 0, 1.0, 1.6, 1.1, 1.2, col);
  g.box(0, 1.1, 1.0, 1.4, 0.06, 1.0, shade(col, 0.8));
  g.box(0.45, 1.16, 1.2, 0.4, 0.5, 0.4, shade(col, 0.85));
  g.cyl(0.45, 1.66, 1.2, 0.3, 0.12, 0.35, 4, shade(col, 0.75), PI / 4);
  for (const sx of [-0.5, 0.2]) g.cyl(sx, 1.16, 1.3, 0.07, 0.07, 3.0, 6, C.metal);
  g.box(-0.6, 0.55, 0.38, 0.4, 0.45, 0.06, C.dark);
  P.add('screen', t, -0.6, 0.72, 0.348, PI, 0.24, 0.14, 1, kind === 'steelmill' ? hx('#ffb080') : hx('#9fd0ff'));
  for (let k = 0; k < 3; k++) P.add(k === 1 ? 'ledA' : 'ledOn', t, -0.72 + k * 0.12, 0.6, 0.345, 0, 0.04, 0.04, 0.015, k === 0 ? hx('#40ff60') : k === 1 ? hx('#ffb030') : hx('#ff3020'));
  g.tube(0.82, 0.6, 1.0, 0.92, 0.6, 1.0, 0.12, 10, C.white, true, 0.12, C.white);
  if (kind === 'sawmill' || kind === 'furniture') {
    g.tube(-0.2, 1.3, 1.0, -0.2, 1.3, 1.05, 0.35, 12, C.steel);
    for (let k = 0; k < 4; k++) P.add('box', t, -1.55, 0.05 + k * 0.1, 1.0, 0, 0.25, 0.08, 2.0, k % 2 ? C.planks : shade(C.planks, 0.92));
    P.add('dome', t, 0.4, 0, 2.0, 0, 0.8, 0.2, 0.6, C.sand);
  } else if (kind === 'brickworks') {
    g.box(0, 0.75, 2.2, 0.5, 0.06, 1.6, C.dark);
    for (let k = 0; k < 5; k++) P.add('box', t, 0, 0.81, 1.6 + k * 0.3, 0, 0.22, 0.07, 0.1, C.brickRed);
    for (let k = 0; k < 2; k++) P.add('pallet', t, 1.5, 0, 0.6 + k * 1.3, 0, 0.8, 1, 0.8);
  } else if (kind === 'steelmill') {
    h.warm.cyl(0, 1.16, 1.0, 0.35, 0.35, 0.05, 8, hx('#ff8a30'));
    for (let k = 0; k < 4; k++) P.add('glowBox', t, 1.45, 0.05 + (k % 2) * 0.16, 0.6 + Math.floor(k / 2) * 0.35, 0, 0.6, 0.15, 0.25, hx('#ff9a50'));
  } else if (kind === 'foodplant') {
    g.cyl(-1.4, 0, 1.0, 0.45, 0.45, 1.8, 10, C.steel);
    g.box(0, 0.8, 2.25, 2.0, 0.06, 0.5, C.dark);
    for (let k = 0; k < 5; k++) P.add('box', t, -0.8 + k * 0.4, 0.86, 2.25, 0, 0.24, 0.16, 0.2, h.brand);
  } else if (kind === 'workshop') {
    P.add('toolboard', t, -1.4, 0.9, 1.6, PI / 2);
    P.add('workbench', t, 1.6, 0, 0.9, -PI / 2);
  }
  P.add('toolbox', t, 0.9, 0, 0.1, 0.5 + r(1), 1, 1, 1, pick([hx('#c0392b'), hx('#2e6da4'), hx('#e8b631')], r(2)));
  if (r(3) < 0.6) P.add('crate', t, 1.35, 0, 1.6, r(4) * 0.4, 0.6, 0.6, 0.6, C.woodLight);
  if (r(5) < 0.3) P.add('extinguisher', t, -1.3, 0, -0.2, 0);
}

// ------------------------------------------------------------ stores

const RETAIL = ['groceries', 'crops', 'fish', 'clothes', 'furniture', 'tools', 'computers', 'phones', 'tvs'];

function storeGoods(h: Host): string[] {
  const inv = (h.b.store ?? {}) as Record<string, number>;
  const list = Object.entries(inv).filter(([g, q]) => q > 0 && RETAIL.includes(g)).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  if (list.length === 0) list.push(pick(['groceries', 'groceries', 'clothes', 'tools', 'computers', 'furniture'], hash2(h.b.seed, 21000)));
  return list;
}

function shelf(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t;
  const r = rnd(h, i);
  const goods = storeGoods(h);
  const good = goods[i % goods.length];
  const z = 0.85;
  for (const sx of [-1.2, 1.2]) g.box(sx, 0, z, 0.06, 1.9, 0.5, C.metal);
  g.box(0, 0, z - 0.24, 2.4, 1.9, 0.03, C.shelf, 0, false);
  g.box(0, 1.92, z - 0.2, 2.4, 0.3, 0.04, h.brand);
  const zf = z - 0.03;
  for (let l = 0; l < 4; l++) {
    const y = 0.12 + l * 0.45;
    g.box(0, y, z, 2.36, 0.04, 0.5, C.shelf);
    g.box(0, y - 0.03, z + 0.25, 2.36, 0.06, 0.01, l % 2 ? hx('#f4d03f') : C.white, 0, false);
    const yb = y + 0.04;
    let x = -1.1, k = 0;
    while (x < 1.05 && k < 14) {
      const q = (j: number) => r(100 + l * 40 + k * 3 + j);
      if (good === 'groceries') {
        const type = q(0);
        if (type < 0.45) { const w = 0.16 + q(1) * 0.1, hh = 0.22 + q(2) * 0.12; P.add('box', t, x + w / 2, yb, zf, 0, w - 0.02, hh, 0.07 + q(3) * 0.05, pick(PAL.goods, q(4))); for (let d = 1; d < 3; d++) P.add('box', t, x + w / 2, yb, zf - d * 0.11, 0, w - 0.02, hh, 0.07, pick(PAL.goods, q(4))); x += w; }
        else if (type < 0.75) { const c = pick(PAL.goods, q(5)); for (let d = 0; d < 3; d++) for (let e = 0; e < 2; e++) P.add('cyl', t, x + 0.05 + e * 0.1, yb, zf - d * 0.1, 0, 0.08, 0.12, 0.08, c); x += 0.21; }
        else { const c = pick([hx('#2f5e3a'), hx('#8a3f30'), hx('#e8dcc4'), hx('#c9a13b')], q(6)); for (let e = 0; e < 3; e++) P.add('bottle', t, x + 0.05 + e * 0.08, yb, zf - 0.05, 0, 0.9, 0.9, 0.9, c); x += 0.26; }
      } else if (good === 'crops' || good === 'fish') {
        P.add('crate', t, x + 0.2, yb, zf - 0.08, 0, 0.36, 0.18, 0.36, C.woodLight);
        const fc = good === 'fish' ? hx('#9fb4c4') : pick([hx('#d0342c'), hx('#e07b2e'), hx('#6fa24a'), hx('#f1c40f'), hx('#7a3b6e')], q(0));
        for (let e = 0; e < 6; e++) P.add('ball', t, x + 0.08 + (e % 3) * 0.12, yb + 0.13, zf - 0.16 + Math.floor(e / 3) * 0.14, q(1) * 6, good === 'fish' ? 0.07 : 0.1, good === 'fish' ? 0.05 : 0.09, good === 'fish' ? 0.22 : 0.1, fc);
        x += 0.42;
      } else if (good === 'clothes') {
        const c = pick(PC.fabric, q(0));
        for (let e = 0; e < 3 + Math.floor(q(1) * 3); e++) P.add('box', t, x + 0.14, yb + e * 0.045, zf - 0.08, (q(2 + e) - 0.5) * 0.15, 0.26, 0.04, 0.3, shade(c, 0.9 + (e % 2) * 0.1));
        x += 0.32;
      } else if (good === 'tools') {
        const type = q(0);
        if (type < 0.5) { P.add('toolbox', t, x + 0.26, yb, zf - 0.08, 0, 1, 1, 1, pick([hx('#c0392b'), hx('#e8b631'), hx('#2e6da4'), hx('#27ae60')], q(1))); x += 0.54; }
        else { P.add('box', t, x + 0.12, yb, zf - 0.06, 0, 0.2, 0.26, 0.24, pick([hx('#e07b2e'), hx('#3a3d42'), hx('#c9b48a')], q(2))); x += 0.24; }
      } else if (good === 'computers' || good === 'phones' || good === 'tvs') {
        if (l === 3 && good !== 'phones') {
          t.push(x + 0.3, yb, zf - 0.12, PI);
          P.add(good === 'tvs' ? 'tv' : 'monitor', t, 0, 0, 0, 0, good === 'tvs' ? 0.55 : 0.9, good === 'tvs' ? 0.55 : 0.9, good === 'tvs' ? 0.55 : 0.9);
          if (good === 'tvs') P.add('screen', t, 0, 0.045, -0.006, 0, 0.6, 0.35, 1, pick(PC.screens, q(0)));
          else P.add('screen', t, 0, 0.126, 0.002, 0, 0.5, 0.29, 1, pick(PC.screens, q(0)));
          t.pop();
          x += 0.62;
        } else {
          const w = good === 'phones' ? 0.12 : 0.36;
          P.add('box', t, x + w / 2, yb, zf - 0.1, 0, w - 0.03, good === 'phones' ? 0.04 : 0.3, good === 'phones' ? 0.18 : 0.38, pick([hx('#e8e8e4'), hx('#2a2c30'), hx('#c9cdd1'), h.brand], q(1)));
          x += w;
        }
      } else {
        // furniture store: lamps, vases, cushions and frames
        const type = q(0);
        if (type < 0.3) { P.add('tableLamp', t, x + 0.16, yb, zf - 0.1, 0, 1, 1, 1, pick(PC.fabric, q(1))); x += 0.34; }
        else if (type < 0.6) { P.add('cushion', t, x + 0.2, yb, zf - 0.1, 0, 1, 1, 1, pick(PC.fabric, q(2))); x += 0.42; }
        else { P.add('vase', t, x + 0.1, yb, zf - 0.08, 0, 1.4, 1.4, 1.4, pick(PC.mugs, q(3))); x += 0.22; }
      }
      x += 0.02;
      k++;
    }
  }
}

// ------------------------------------------------------------ homes

function bed(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t;
  const r = rnd(h, i);
  const frame = pick(PC.woods, r(1));
  const cover = pick(PC.fabric, r(2));
  g.box(0, 0, 0, 1.5, 0.3, 2.1, frame);
  g.box(0, 0.3, 0.02, 1.42, 0.2, 2.02, hx('#f2efe8'));
  g.box(0, 0.48, 0.32, 1.46, 0.07, 1.42, cover);
  g.box(0, 0.12, 1.04, 1.46, 0.43, 0.012, cover, 0, false);
  for (const sx of [-0.735, 0.735]) g.box(sx, 0.12, 0.32, 0.012, 0.43, 1.42, cover, 0, false);
  g.box(0, 0.55, -0.37, 1.46, 0.03, 0.14, shade(cover, 0.85));
  g.box(0, 0, -1.07, 1.52, 1.0, 0.08, shade(frame, 0.85));
  for (const sx of [-0.36, 0.36]) P.add('pillow', t, sx, 0.49, -0.75, (r(3) - 0.5) * 0.2, 1, 1, 1, r(4) < 0.5 ? C.white : mix(cover, C.white, 0.6));
  if (r(5) < 0.5) P.add('box', t, 0, 0.55, 0.78, (r(6) - 0.5) * 0.1, 1.3, 0.04, 0.42, pick(PC.fabric, r(7)));
  // nightstands with a lamp, a book, a clock
  for (const sx of r(8) < 0.5 ? [1] : [-1, 1]) {
    P.add('nightstand', t, sx * 1.05, 0, -0.8, 0, 1, 1, 1, frame);
    P.add('tableLamp', t, sx * 1.05, 0.54, -0.86, 0, 0.9, 0.9, 0.9, pick(PC.mugs, r(9)));
    P.add('glowBall', t, sx * 1.05, 0.72, -0.86, 0, 0.11, 0.1, 0.11);
    if (r(10 + sx) < 0.6) P.add('book', t, sx * 1.05 - 0.08, 0.54, -0.68, r(12) * 2, 0.15, 0.03, 0.22, pick(PC.books, r(13)));
    if (sx > 0 && r(14) < 0.5) { P.add('box', t, 1.18, 0.54, -0.7, -0.3, 0.1, 0.06, 0.05, hx('#2a2c30')); P.add('screen', t, 1.18, 0.555, -0.674, -0.3, 0.07, 0.03, 1, hx('#ff6040')); }
  }
  P.add('rug', t, -1.2, 0, 0.1, 0, 0.8, 1, 1.5, pick(PC.fabric, r(15)));
  if (r(16) < 0.6) for (const sx of [-0.08, 0.08]) P.add('box', t, -1.05 + sx, 0.013, 0.55, 0.2, 0.09, 0.04, 0.24, pick(PC.fabric, r(17)));
}

function sofa(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t;
  const r = rnd(h, i);
  const col = pick(PC.fabric, r(1));
  P.add('rug', t, 0, 0, 1.0, 0, 2.6, 1, 1.9, pick(PC.fabric, r(2)));
  g.box(0, 0.08, 0, 1.9, 0.3, 0.85, col);
  for (const sx of [-0.45, 0.45]) g.box(sx, 0.38, 0.06, 0.88, 0.08, 0.7, shade(col, 1.06));
  g.box(0, 0.08, -0.34, 1.9, 0.75, 0.2, shade(col, 0.9));
  for (const sx of [-0.88, 0.88]) g.box(sx, 0.08, 0, 0.16, 0.55, 0.85, shade(col, 0.9));
  for (const [sx, sz] of [[-0.85, -0.35], [0.85, -0.35], [0.85, 0.35], [-0.85, 0.35]]) g.box(sx, 0, sz, 0.06, 0.08, 0.06, C.woodDark);
  const cushions = 1 + Math.floor(r(3) * 3);
  for (let k = 0; k < cushions; k++) P.add('cushion', t, -0.6 + k * 0.6, 0.42, -0.16, (r(4 + k) - 0.5) * 0.4, 1, 1, 1, pick(PC.fabric, r(7 + k)));
  if (r(10) < 0.4) P.add('box', t, 0.75, 0.62, 0.05, 0.1, 0.24, 0.06, 0.7, pick(PC.fabric, r(11)));
  // coffee table with a mug, a magazine, the remote
  P.add('coffeeTable', t, 0, 0, 1.0, 0, 1, 1, 1, pick(PC.woods, r(12)));
  if (r(13) < 0.8) P.add('mug', t, -0.25, 0.41, 0.95, r(14) * 6, 1, 1, 1, pick(PC.mugs, r(15)));
  if (r(16) < 0.6) P.add('box', t, 0.15, 0.41, 1.02, 0.4, 0.22, 0.01, 0.3, pick(PC.books, r(17)));
  P.add('remote', t, 0.32, 0.41, 0.9, (r(18) - 0.5) * 0.8);
  if (r(19) < 0.4) P.add('disc', t, -0.05, 0.41, 1.12, 0, 0.2, 0.05, 0.2, pick(PC.mugs, r(20)));
  // TV on a stand facing the sofa
  g.box(0, 0, 2.0, 1.4, 0.5, 0.4, pick([C.woodDark, hx('#2a2c30'), C.white, C.woodLight], r(21)));
  g.box(0, 0.2, 1.799, 1.3, 0.02, 0.01, shade(C.woodDark, 0.7), 0, false);
  t.push(0, 0.5, 2.02, PI);
  P.add('tv', t, 0, 0, 0);
  P.add('screen', t, 0, 0.1, -0.051, 0, 1.06, 0.6, 1, pick([hx('#9fd0ff'), hx('#bfe8c8'), hx('#f0d8a8'), hx('#c8b8f0'), hx('#2b3b55')], r(22)));
  t.pop();
  if (r(23) < 0.5) P.add('box', t, 0.55, 0.5, 2.0, 0, 0.2, 0.06, 0.18, hx('#2a2c30'));
  // a floor lamp at one end, a plant at the other
  P.add('floorLamp', t, 1.25, 0, -0.2, 0, 1, 1, 1, pick([C.white, PC.cream, hx('#e8c56a')], r(24)));
  P.add('glowBall', t, 1.25, 1.35, -0.2, 0, 0.22, 0.12, 0.22);
  if (r(25) < 0.7) P.add(r(26) < 0.5 ? 'plantFloor' : 'plantBush', t, -1.3, 0, -0.15, r(27) * 6, 0.9, 0.9, 0.9);
}

// ------------------------------------------------------------ TV and civic

function stage(h: Host, i: number): void {
  // presenter seat at the news desk (the desk itself is part of the set)
  const P = h.props, t = h.t;
  const r = rnd(h, i);
  P.add('chairOffice', t, 0, 0, -0.02, (r(1) - 0.5) * 0.2, 1, 1.05, 1, hx('#2a2c30'));
  const top = 0.78;
  for (let k = 0; k < 2; k++) P.add('box', t, -0.1 + k * 0.02, top + k * 0.004, 0.5, (r(2 + k) - 0.5) * 0.3, 0.21, 0.003, 0.297, C.white);
  P.add('mug', t, 0.35, top, 0.55, r(4) * 6, 1, 1, 1, h.brand);
  t.push(-0.4, top, 0.62, PI + 0.3);
  P.add('laptop', t, 0, 0, 0, 0, 1, 1, 1, hx('#c9cdd1'));
  P.add('laptopScreen', t, 0, 0, 0, 0, 1, 1, 1, hx('#9fd0ff'));
  t.pop();
}

function podium(h: Host, s: Station, i: number): void {
  const P = h.props, t = h.t;
  const r = rnd(h, i);
  const civic = h.b.kind === 'cityhall' || h.b.kind === 'plaza';
  P.add('lectern', t, 0, 0, 0.5, 0, 1, 1, 1, civic ? hx('#7a5232') : h.brand);
  P.add('mic', t, 0.12, 1.12, 0.52, 0);
  P.add('box', t, -0.08, 1.12, 0.45, (r(1) - 0.5) * 0.2, 0.21, 0.004, 0.297, C.white);
  if (!civic) P.add('glassCup', t, 0.25, 1.12, 0.6, 0, 0.065, 0.1, 0.065);
  void s;
}

function camera(h: Host, i: number): void {
  const g = h.solid, P = h.props, t = h.t;
  P.add('tvCamera', t, 0, 0, 0.55, 0);
  if (h.look.live) P.add('cameraTally', t, 0, 1.47, 0.6, 0, 1, 1, 1, hx('#ff2010'));
  // cable snaking back over the floor
  g.box(0.15, 0.005, 0.0, 0.03, 0.01, 1.0, C.dark, 0, false);
  g.box(0.5, 0.005, -0.5, 0.7, 0.01, 0.03, C.dark, 0, false);
  void i;
}

function server(h: Host, i: number): void {
  const P = h.props, t = h.t;
  const r = rnd(h, i);
  t.push(0, 0, 0.75, PI);
  P.add('serverRack', t, 0, 0, 0);
  const cols = [hx('#40ff60'), hx('#40ff60'), hx('#ffb030'), hx('#3fa0ff')];
  for (let row = 0; row < 14; row++) {
    if (row % 3 === 0) continue;
    for (let k = 0; k < 3; k++) {
      const q = r(row * 5 + k);
      const name = q < 0.35 ? 'ledA' : q < 0.6 ? 'ledB' : 'ledOn';
      P.add(name, t, 0.14 + k * 0.045, 0.16 + row * 0.13, 0.51, 0, 0.018, 0.018, 0.01, pick(cols, r(row * 5 + k + 100)));
    }
  }
  P.add('screen', t, -0.12, 0.92, 0.512, 0, 0.22, 0.12, 1, hx('#3fa0ff'));
  t.pop();
}

function seat(h: Host, i: number): void {
  const r = rnd(h, i);
  const col = h.b.kind === 'cityhall' ? hx('#7a2a2a') : h.b.kind === 'studio' ? hx('#2d3e5c') : pick(PC.upholstery, r(1));
  h.props.add('seatTheater', h.t, 0, 0, 0.05, 0, 1, 1, 1, col);
}

// ================================================================ rooms

/** Things that aren't stations: kitchens, bookshelves, plants, pictures, vaults, sets... (building-local frame). */
export function roomDetail(h: Host): void {
  const body = h.body;
  if (!body) return;
  switch (h.b.kind) {
    case 'apartments': apartmentRooms(h); break;
    case 'house': houseRooms(h); break;
    case 'trailer': trailerRoom(h); break;
    case 'office': case 'bank': case 'netco': officeRooms(h); break;
    case 'cityhall': cityhallRooms(h); break;
    case 'studio': studioSet(h); break;
    case 'restaurant': restaurantRoom(h); break;
    case 'store': storeRoom(h); break;
    default:
      if (['sawmill', 'brickworks', 'steelmill', 'foodplant', 'workshop', 'furniture', 'textile', 'electronics', 'carplant', 'depot'].includes(h.b.kind)) factoryRoom(h);
  }
}

function floorY(h: Host, f: number): number {
  const b = h.body!;
  return f === 0 ? Math.max(0.15, b.base ?? 0.15) : f * FLOOR_H + 0.15;
}

/** A kitchen run of base units against a wall (frame: wall at local z = 0, room toward +Z, run along +X from x0). */
function kitchenRun(h: Host, x0: number, n: number, k: number, fridge = true): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 22000 + k * 41 + j);
  const front = pick([C.white, hx('#e8e0cf'), hx('#5a6b7a'), hx('#7a8a6a'), hx('#c9b79a'), hx('#3a3d42')], r(1));
  const order = ['sink', 'stoveHome', 'counterUnit', 'counterUnit'] as const;
  let x = x0;
  for (let u = 0; u < n; u++) {
    const what = order[u % order.length];
    const w = what === 'sink' ? 0.8 : 0.6;
    P.add(what, t, x + w / 2, 0, 0.32, 0, 1, 1, 1, what === 'stoveHome' ? C.white : front);
    if (u < n) P.add('wallCabinet', t, x + w / 2, 1.45, 0.18, 0, w / 0.6, 1, 1, front);
    x += w;
  }
  // appliances on the counter
  P.add('kettle', t, x0 + 1.6, 0.915, 0.3, r(2) * 6, 1, 1, 1, pick([C.white, hx('#c0392b'), C.steel, hx('#2a2c30')], r(3)));
  if (r(4) < 0.7) P.add('microwave', t, x - 0.35, 0.915, 0.36, 0, 1, 1, 1, pick([C.white, hx('#3a3d42'), C.steel], r(5)));
  if (r(6) < 0.5) P.add('toaster', t, x0 + 1.9, 0.915, 0.36, 0, 1, 1, 1, C.steel);
  P.add('cuttingBoard', t, x0 + 1.05, 0.915, 0.4, (r(7) - 0.5) * 0.3, 0.8, 1, 0.8);
  for (let j = 0; j < 3; j++) P.add('cyl', t, x0 + 1.25 + j * 0.1, 0.915, 0.15, 0, 0.08, 0.14 + j * 0.02, 0.08, pick([hx('#c9a13b'), hx('#8a3f30'), hx('#e8dcc4')], r(8 + j)));
  if (fridge) P.add('fridge', t, x + 0.38, 0, 0.36, 0, 1, 1, 1, pick([C.white, C.steel, hx('#e8e0cf'), hx('#2a2c30')], r(12)));
}

/** A dining table with chairs (and a plate or a bowl of fruit), building-local. */
function dining(h: Host, x: number, y: number, z: number, rot: number, k: number): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 23000 + k * 37 + j);
  const wood = pick(PC.woods, r(1));
  t.push(x, y, z, rot);
  P.add('tableDining', t, 0, 0, 0, 0, 1, 1, 1, wood);
  const chairC = r(2) < 0.5 ? wood : pick([C.white, hx('#2a2c30'), hx('#c0392b'), hx('#2e86c1')], r(3));
  for (const [cx, cz, a] of [[-0.32, -0.68, 0], [0.32, -0.68, 0], [-0.32, 0.68, PI], [0.32, 0.68, PI]] as const) {
    if (r(4 + cx * 10 + cz) < 0.15) continue;
    P.add('chairWood', t, cx, 0, cz, a + (r(10 + cx + cz) - 0.5) * 0.3, 1, 1, 1, chairC);
  }
  const top = 0.765;
  if (r(20) < 0.6) {
    P.add('disc', t, 0, top, 0, 0, 0.3, 0.07, 0.3, pick([C.white, hx('#c9b79a'), hx('#5a6b7a')], r(21)));
    for (let j = 0; j < 4; j++) P.add('ball', t, -0.06 + (j % 2) * 0.1, top + 0.05, -0.04 + Math.floor(j / 2) * 0.08, 0, 0.09, 0.08, 0.09, pick([hx('#d0342c'), hx('#f1c40f'), hx('#6fa24a'), hx('#e07b2e')], r(22 + j)));
  } else {
    P.add('plate', t, -0.3, top, -0.2, 0);
    P.add('cutlery', t, -0.3, top, -0.2, 0, 0.8, 1, 0.8);
    P.add('glassCup', t, -0.1, top, -0.25, 0, 0.065, 0.11, 0.065);
  }
  if (r(30) < 0.4) P.add('box', t, 0.35, top, 0.15, r(31), 0.22, 0.01, 0.3, pick(PC.books, r(32)));
  t.pop();
}

/** A bookshelf full of books (building-local, back against a wall, facing rot). */
function bookshelf(h: Host, x: number, y: number, z: number, rot: number, k: number): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 24000 + k * 53 + j);
  t.push(x, y, z, rot);
  P.add('bookshelf', t, 0, 0, 0, 0, 1, 1, 1, pick(PC.woods, r(1)));
  const rows = ['bookRowA', 'bookRowB', 'bookRowC'] as const;
  for (let l = 0; l < 5; l++) {
    const yb = l * 0.37 + 0.025;
    const q = r(10 + l);
    if (q < 0.08) continue; // an empty shelf
    const full = q > 0.3;
    const sx = full ? 1 : 0.45 + r(20 + l) * 0.3;
    // mirror some rows so the pattern repeats less
    P.add(rows[Math.floor(r(30 + l) * 3) % 3], t, full ? 0 : -0.42 * (1 - sx), yb, 0.0, r(40 + l) < 0.5 ? 0 : Math.PI, sx, 0.95 + r(50 + l) * 0.1, 1, l % 2 ? undefined : new Color3(0.92, 0.92, 0.92));
    if (!full && r(60 + l) < 0.6) P.add(r(70 + l) < 0.5 ? 'plantPot' : 'vase', t, 0.28, yb, 0.02, r(201 + l) * 6, 1, 1, 1, pick(PC.mugs, r(80 + l)));
  }
  t.pop();
}

function picture(h: Host, x: number, y: number, z: number, rot: number, k: number, w = 0.7, hh = 0.5): void {
  const r = hash2(h.b.seed, 25000 + k);
  h.props.add('picture', h.t, x, y, z, rot, w, hh, 1, mix(C.white, pick(PC.fabric, r), 0.35));
}

function apartmentRooms(h: Host): void {
  const body = h.body!, b = h.b;
  const iw = b.w - 2, id = b.d - 2;
  const P = h.props, t = h.t;
  const bw = body.w, bd = body.d, bcz = body.cz;
  for (let f = 0; f < body.floors; f++) {
    const y = floorY(h, f);
    for (let u = 0; u < 4; u++) {
      const qx = u % 2 ? 1 : -1, qz = u < 2 ? 1 : -1;
      const cx = (qx * iw) / 4, cz = (qz * id) / 4;
      const k = f * 4 + u;
      const r = (j: number) => hash2(b.seed, 26000 + k * 29 + j);
      // kitchen along the outer wall (front or back)
      const wallZ = qz > 0 ? bcz + bd / 2 - 0.12 : bcz - bd / 2 + 0.12;
      t.push(cx + qx * 0.6, y, wallZ, qz > 0 ? PI : 0);
      kitchenRun(h, qz > 0 ? (qx > 0 ? -2.6 : -0.6) - 0.2 : (qx > 0 ? -0.4 : -2.4), 3, k, true);
      t.pop();
      // dining, bookshelf, wardrobe, plants, pictures
      dining(h, cx + qx * 1.5, y, cz + qz * 1.1, (r(1) - 0.5) * 0.2, k);
      bookshelf(h, cx - qx * 2.4, y, bcz + qz * 0.28, qz > 0 ? 0 : PI, k);
      P.add('wardrobe', t, qx * 0.47, y, cz + qz * 1.2, qx < 0 ? -PI / 2 : PI / 2, 1, 1, 1, pick(PC.woods, r(2)));
      P.add(r(3) < 0.5 ? 'plantFloor' : 'plantBush', t, cx + qx * 3.35, y, cz - qz * 2.9, r(4) * 6);
      if (r(5) < 0.6) P.add('plantFloor', t, qx * 0.45, y, cz + qz * 2.9, r(6) * 6, 0.85, 0.85, 0.85);
      const outerX = qx * (bw / 2 - 0.1);
      picture(h, outerX, y + 1.25, cz - qz * 1.0, qx < 0 ? PI / 2 : -PI / 2, k * 3, 0.8, 0.6);
      picture(h, cx + qx * 1.0, y + 1.45, bcz + qz * 0.09, qz > 0 ? 0 : PI, k * 3 + 1, 0.6, 0.45);
      if (r(7) < 0.5) P.add('wallClock', t, cx + qx * 2.6, y + 2.2, bcz + qz * 0.09, qz > 0 ? 0 : PI);
      P.add('rug', t, cx + qx * 1.5, y, cz + qz * 1.1, 0, 1.9, 1, 1.4, pick(PC.fabric, r(8)));
    }
  }
}

function houseRooms(h: Host): void {
  const body = h.body!;
  const P = h.props, t = h.t;
  const bw = body.w, bd = body.d, cz = body.cz;
  for (let f = 0; f < body.floors; f++) {
    const y = floorY(h, f);
    const r = (j: number) => hash2(h.b.seed, 27000 + f * 31 + j);
    if (f === 0) {
      // kitchen along the left wall, toward the front
      t.push(-bw / 2 + 0.1, y, cz + bd / 2 - 0.25, PI / 2);
      kitchenRun(h, 0.0, 3, 100 + f, false);
      t.pop();
      t.push(-bw / 2 + 0.1, y, cz + bd / 2 - 0.25, PI / 2);
      P.add('fridge', t, -0.45, 0, 0.36, 0, 1, 1, 1, pick([C.white, C.steel], r(1)));
      t.pop();
      dining(h, -1.6, y, cz + 1.9, (r(2) - 0.5) * 0.2, 200 + f);
    } else {
      P.add('plantFloor', t, -bw / 2 + 0.5, y, cz + bd / 2 - 0.5, r(3) * 6);
      P.add('chairArm', t, -bw / 2 + 1.1, y, cz + bd / 2 - 1.4, PI * 0.8, 1, 1, 1, pick(PC.fabric, r(4)));
    }
    bookshelf(h, -0.1, y, cz - bd / 2 + 0.25, 0, 300 + f);
    P.add('wardrobe', t, -bw / 2 + 0.42, y, cz - bd / 2 + 1.6, PI / 2, 1, 1, 1, pick(PC.woods, r(5)));
    P.add(r(6) < 0.5 ? 'plantFloor' : 'plantBush', t, bw / 2 - 0.45, y, cz + bd / 2 - 0.45, r(7) * 6);
    picture(h, bw / 2 - 0.08, y + 1.4, cz + 0.6, -PI / 2, 400 + f, 0.9, 0.6);
    picture(h, 2.0, y + 1.5, cz - bd / 2 + 0.08, 0, 410 + f, 0.6, 0.45);
    if (r(8) < 0.6) P.add('wallClock', t, -bw / 2 + 0.08, y + 2.2, cz + 0.2, PI / 2);
  }
}

function trailerRoom(h: Host): void {
  const P = h.props, t = h.t;
  P.add('stool', t, 0.3, 0.05, 0.9, 0, 1, 1, 1, PC.wood);
  P.add('pot', t, 1.25, 0.05, 0.85, 0, 1, 1, 1, hx('#3a3530'));
  P.add('crate', t, -1.0, 0.05, 0.6, 0.3, 0.6, 0.5, 0.5, hx('#8a6a4a'));
  P.add('bucket', t, -0.6, 0.05, 1.1, 0, 1, 1, 1, hx('#8a6a4a'));
}

function officeRooms(h: Host): void {
  const body = h.body!, b = h.b;
  const P = h.props, t = h.t;
  const bw = body.w, bd = body.d;
  const back = body.cz - bd / 2 + 0.12, front = body.cz + bd / 2 - 0.12;
  for (let f = 0; f < body.floors; f++) {
    const y = floorY(h, f);
    const r = (j: number) => hash2(b.seed, 28000 + f * 37 + j);
    // along the back wall: filing cabinets, a printer, a water cooler, a coffee corner
    for (let k = 0; k < 3; k++) P.add('filingCabinet', t, body.cx - 2.0 - k * 0.5, y, back + 0.3, 0, 1, 1, 1, pick([hx('#8d949a'), hx('#c9ccd0'), hx('#3a3d42')], r(1)));
    P.add('printer', t, body.cx + 2.1, y, back + 0.3, 0, 1, 1, 1, hx('#e8e8e4'));
    P.add('waterCooler', t, body.cx + 2.8, y, back + 0.25, 0);
    P.add('coolerJug', t, body.cx + 2.8, y, back + 0.25, 0);
    if (b.kind === 'netco' || r(2) < 0.5) {
      h.solid.box(bw / 2 - 1.0, y, back + 0.35, 1.2, 0.9, 0.6, C.white);
      P.add('coffeeMachine', t, bw / 2 - 1.2, y + 0.9, back + 0.35, 0);
      for (let k = 0; k < 3; k++) P.add('mug', t, bw / 2 - 0.75 + k * 0.1, y + 0.9, back + 0.45, k, 0.9, 0.9, 0.9, pick(PC.mugs, r(3 + k)));
    }
    P.add('wallClock', t, body.cx + 1.0, y + 2.4, back + 0.02, 0);
    picture(h, body.cx - 3.6, y + 1.5, back + 0.02, 0, 500 + f, 1.1, 0.7);
    P.add('whiteboard', t, bw / 2 - 0.06, y + 1.0, body.cz + 0.5, -PI / 2);
    for (const [px, pz] of [[-bw / 2 + 0.45, front - 0.45], [bw / 2 - 0.45, front - 0.45], [-bw / 2 + 0.45, back + 0.45]]) P.add(r(px + pz) < 0.5 ? 'plantFloor' : 'plantBush', t, px, y, pz, r(10 + f) * 6);
    if (b.kind === 'netco') {
      // lounge corner: beanbags, a low table
      if (f > 0) {
        for (let k = 0; k < 3; k++) P.add('beanBag', t, bw / 2 - 1.1 - (k % 2) * 0.9, y, front - 1.2 - Math.floor(k / 2) * 0.9, r(20 + k) * 6, 1, 1, 1, pick([hx('#e2475a'), hx('#f1c40f'), hx('#2e86c1'), hx('#27ae60'), hx('#8e44ad')], r(23 + k)));
        P.add('coffeeTable', t, bw / 2 - 1.6, y, front - 1.9, 0.3, 0.7, 0.8, 0.8, C.white);
      }
      if (f === body.floors - 1 && body.floors >= 3) {
        // ping-pong table
        t.push(bw / 2 - 1.6, y, body.cz - 1.8, PI / 2);
        h.solid.box(0, 0.7, 0, 2.7, 0.05, 1.5, hx('#2f6b4a'));
        h.solid.box(0, 0.75, 0, 0.02, 0.15, 1.6, C.white);
        h.solid.box(0, 0.752, 0, 2.7, 0.002, 0.02, C.white, 0, false);
        for (const [sx, sz] of [[-1.2, -0.6], [1.2, -0.6], [1.2, 0.6], [-1.2, 0.6]]) h.solid.box(sx, y * 0, sz, 0.05, 0.7, 0.05, C.dark);
        t.pop();
      }
      if (f === 0) {
        // glass partition around the server racks
        const sx = bw / 2 - 2.5, z0 = body.cz - bd / 2 + 0.6, z1 = z0 + 5.6;
        h.clear.box(sx, y, (z0 + z1) / 2 + 0.5, 0.03, 2.8, z1 - z0 - 1.0, hx('#b9d6e6'));
        h.solid.box(sx, y + 2.8, (z0 + z1) / 2, 0.08, 0.08, z1 - z0, C.metal);
        h.clear.box((sx + bw / 2) / 2, y, z1, bw / 2 - sx, 2.8, 0.03, hx('#b9d6e6'));
        h.solid.box((sx + bw / 2) / 2, y + 2.6, (z0 + z1) / 2 - 0.4, bw / 2 - sx - 0.4, 0.06, z1 - z0 - 1.6, hx('#5a5f66'));
      }
    }
  }
  if (b.kind === 'bank') bankVault(h);
}

function bankVault(h: Host): void {
  const body = h.body!;
  const g = h.solid, P = h.props, t = h.t;
  const y = floorY(h, 0);
  const back = body.cz - body.d / 2 + 0.12;
  const vx = body.cx - body.w / 2 + 2.4;
  t.push(vx, y, back, 0);
  // the round vault door, half open, with its wheel and bolts
  g.box(0, 0, 0.1, 2.6, 2.6, 0.2, hx('#6a6e72'));
  g.tube(0, 1.25, 0.2, 0, 1.25, 0.24, 1.05, 18, hx('#3a3d42'));
  t.push(0.95, 0, 0.3, -1.1);
  g.tube(-0.95, 1.25, 0.0, -0.95, 1.25, 0.42, 1.0, 18, hx('#b9bec2'), true, 1.0, hx('#c9cdd1'));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.beam(-0.95, 1.25, 0.44, -0.95 + Math.cos(a) * 0.38, 1.25 + Math.sin(a) * 0.38, 0.44, 0.04, hx('#8d949a')); }
  g.tube(-0.95, 1.25, 0.42, -0.95, 1.25, 0.5, 0.1, 8, hx('#8d949a'));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.tube(-0.95 + Math.cos(a) * 0.85, 1.25 + Math.sin(a) * 0.85, 0.42, -0.95 + Math.cos(a) * 0.85, 1.25 + Math.sin(a) * 0.85, 0.46, 0.06, 6, hx('#c9cdd1')); }
  t.pop();
  // gold bars and cash stacks just inside
  for (let k = 0; k < 6; k++) P.add('box', t, -0.3 + (k % 3) * 0.22, 0.02 + Math.floor(k / 3) * 0.06, 0.35, 0, 0.18, 0.055, 0.08, hx('#e0b850'));
  t.pop();
  // safe deposit wall next to it
  t.push(vx + 2.6, y, back + 0.03, 0);
  g.box(0, 0.2, 0, 2.0, 2.0, 0.06, hx('#8d949a'));
  for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) g.rect(-0.95 + k * 0.24 + 0.01, 0.25 + r * 0.24, -0.95 + k * 0.24 + 0.22, 0.25 + r * 0.24 + 0.21, 0.035, (r + k) % 3 ? hx('#a9b0b8') : hx('#b9c0c8'));
  t.pop();
  // queue stanchions in front of the counter
  const st = stationsOf(h.b).find((s) => s.kind === 'counter');
  if (st) {
    for (let k = 0; k < 3; k++) for (const sx of [-0.8, 0.8]) P.add('stanchion', t, st.lx + sx, y, st.lz - 1.0 - k * 0.8, 0);
    for (let k = 0; k < 2; k++) for (const sx of [-0.8, 0.8]) P.add('box', t, st.lx + sx, y + 0.82, st.lz - 1.4 - k * 0.8, 0, 0.02, 0.04, 0.8, hx('#8a1f2a'));
  }
}

function cityhallRooms(h: Host): void {
  const body = h.body!, b = h.b;
  const g = h.solid, P = h.props, t = h.t;
  const top = body.floors - 1;
  const y = floorY(h, top);
  const back = body.cz - body.d / 2 + 0.12;
  const iw = b.w - 2, id = b.d - 2;
  // council chamber: emblem and flags behind the podium, a carpet, a gallery rail, portraits
  t.push(0, y, back, 0);
  g.tube(0, 2.6, 0.02, 0, 2.6, 0.08, 0.95, 20, hx('#c9a13b'));
  g.tube(0, 2.6, 0.08, 0, 2.6, 0.1, 0.8, 20, h.brand);
  g.poly([0, 3.15, 0.105, 0.22, 2.55, 0.105, -0.22, 2.55, 0.105], hx('#f4f1ea'), 0, 0, 1);
  g.box(0, 2.0, 0.1, 0.5, 0.3, 0.02, hx('#f4f1ea'));
  t.pop();
  for (const sx of [-1.6, 1.6]) {
    P.add('flagStand', t, sx, y, back + 0.5, 0);
    P.add('flagCloth', t, sx, y, back + 0.5, sx < 0 ? 0.3 : PI - 0.3, 1, 1, 1, sx < 0 ? h.brand : C.white);
  }
  P.add('rug', t, 0, y, -id / 2 + 1.5 + (id / 2 - 1) * 0.45, 0, iw - 4, 1, id / 2, mix(h.brand, hx('#5a1a1a'), 0.4));
  const railZ = id / 2 - 2 - 1.4 - 0.75;
  for (const side of [-1, 1]) {
    const x0 = side * 1.0, x1 = side * (iw / 2 - 0.6);
    g.box((x0 + x1) / 2, y + 0.95, railZ, Math.abs(x1 - x0), 0.06, 0.08, hx('#5a3d28'));
    for (let k = 0; k <= 6; k++) g.box(x0 + (x1 - x0) * (k / 6), y, railZ, 0.05, 0.95, 0.05, hx('#5a3d28'));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) picture(h, sx * (body.w / 2 - 0.08), y + 1.6, back + 2.5 + k * 3.0, sx < 0 ? PI / 2 : -PI / 2, 600 + k + (sx > 0 ? 5 : 0), 0.8, 1.0);
  P.add('wallClock', t, body.w / 2 - 0.08, y + 2.8, 0.5, -PI / 2, 1.4, 1.4, 1.4);
  // ground floor: waiting chairs, plants, a notice board
  const y0 = floorY(h, 0);
  const front = body.cz + body.d / 2 - 0.12;
  for (let k = 0; k < 4; k++) P.add('chairWood', t, -body.w / 2 + 1.0 + k * 0.55, y0, front - 0.6, PI, 1, 1, 1, hx('#5a3d28'));
  P.add('plantFloor', t, body.w / 2 - 0.5, y0, front - 0.5, 1);
  t.push(-body.w / 2 + 0.06, y0, body.cz, PI / 2);
  g.box(0, 1.1, 0, 1.6, 1.0, 0.04, hx('#a07a52'));
  for (let k = 0; k < 6; k++) g.rect(-0.7 + (k % 3) * 0.48, 1.18 + Math.floor(k / 3) * 0.45, -0.7 + (k % 3) * 0.48 + 0.36, 1.18 + Math.floor(k / 3) * 0.45 + 0.34, 0.025, k % 2 ? C.white : hx('#f4e8a0'));
  t.pop();
  // middle floors: meeting rooms
  for (let f = 1; f < top; f++) {
    const yf = floorY(h, f);
    for (let m = 0; m < 2; m++) {
      const mx = (m ? 1 : -1) * body.w / 4, mz = body.cz;
      P.add('tableDining', t, mx, yf, mz, 0, 2.2, 1, 1.6, hx('#5a3d28'));
      for (let k = 0; k < 6; k++) P.add('chairOffice', t, mx - 0.9 + (k % 3) * 0.9, yf, mz + (k < 3 ? -0.95 : 0.95), k < 3 ? 0 : PI, 1, 1, 1, hx('#3a3d42'));
      for (let k = 0; k < 3; k++) P.add('box', t, mx - 0.5 + k * 0.5, yf + 0.765, mz, k, 0.21, 0.004, 0.297, C.white);
    }
    for (let k = 0; k < 4; k++) P.add('filingCabinet', t, -body.w / 2 + 0.5 + k * 0.5, yf, back + 0.3, 0, 1, 1, 1, hx('#8d949a'));
    P.add('plantFloor', t, body.w / 2 - 0.5, yf, back + 0.5, f);
  }
}

function studioSet(h: Host): void {
  const body = h.body!, b = h.b;
  const g = h.solid, P = h.props, t = h.t;
  const id = b.d - 2;
  const y = floorY(h, 0);
  const stages = stationsOf(b).filter((s) => s.kind === 'stage');
  const sz = stages[0]?.lz ?? -id / 2 + 3;
  const back = body.cz - body.d / 2 + 0.12;
  // news desk in front of the presenters
  const dz = sz + 0.62;
  g.box(0, y, dz, 6.4, 0.78, 0.7, hx('#e8e8e4'));
  g.box(0, y + 0.78, dz - 0.02, 6.6, 0.04, 0.82, hx('#2a2c30'));
  g.box(0, y + 0.1, dz + 0.351, 6.2, 0.22, 0.01, h.brand, 0, false);
  for (const sx of [-3.3, 3.3]) g.cyl(sx, y, dz, 0.42, 0.42, 0.82, 10, hx('#e8e8e4'));
  P.add('screen', t, 0, y + 0.38, dz + 0.356, 0, 1.6, 0.3, 1, mix(h.brand, C.white, 0.4));
  // video wall behind the desk
  t.push(0, y, back + 0.05, 0);
  g.box(0, 0.4, 0, 7.4, 2.5, 0.12, hx('#1d1f22'));
  const tints = [mix(h.brand, C.white, 0.2), hx('#2b4a7a'), hx('#9fd0ff'), mix(h.brand, hx('#1d2a4a'), 0.5), hx('#c8e0ff'), hx('#3a6ea5')];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) P.add('screen', t, -2.7 + k * 1.8, 0.47 + r * 1.2, 0.065, 0, 1.74, 1.14, 1, tints[(r * 4 + k + Math.floor(hash2(b.seed, 3) * 6)) % tints.length]);
  t.pop();
  // lighting truss over the set with spots aimed at the desk
  const ty = Math.min(body.storey * (body.floors > 1 ? 1 : 1), 3.0) + y - 0.15;
  const trussY = Math.max(ty, y + 2.75);
  for (const tz of [sz + 2.6, sz - 1.4]) P.add('truss', t, 0, trussY, tz, 0, 7.0, 1, 1);
  for (let k = 0; k < 5; k++) {
    const x = -2.8 + k * 1.4;
    t.push(x, trussY, sz + 2.6, PI + (x < 0 ? 0.25 : -0.25) * Math.abs(x) / 2.8);
    P.add('studioLight', t, 0, 0, 0);
    P.add('spotLens', t, 0, 0, 0);
    t.pop();
  }
  for (const sx of [-1, 1]) {
    t.push(sx * 4.6, y, sz + 1.4, sx < 0 ? PI * 0.8 : -PI * 0.8);
    P.add('softbox', t, 0, 0, 0);
    P.add('softboxFace', t, 0, 0, 0);
    t.pop();
  }
  // tape marks on the floor
  for (const s of stationsOf(b)) if (s.kind === 'camera') {
    g.box(s.lx, y + 0.003, s.lz, 0.5, 0.004, 0.05, hx('#e8b631'), 0, false);
    g.box(s.lx, y + 0.003, s.lz, 0.05, 0.004, 0.5, hx('#e8b631'), 0, false);
  }
  // upper floors: the newsroom gets the usual office odds and ends
  for (let f = 1; f < body.floors; f++) {
    const yf = floorY(h, f);
    P.add('waterCooler', t, body.w / 2 - 0.6, yf, (body.upper?.cz ?? 0) + (body.upper?.d ?? body.d) / 2 - 0.5, PI);
    P.add('coolerJug', t, body.w / 2 - 0.6, yf, (body.upper?.cz ?? 0) + (body.upper?.d ?? body.d) / 2 - 0.5, PI);
    P.add('plantFloor', t, -body.w / 2 + 0.5, yf, (body.upper?.cz ?? 0) + (body.upper?.d ?? body.d) / 2 - 0.5, f);
    for (let k = 0; k < 3; k++) P.add('filingCabinet', t, -body.w / 2 + 0.5, yf, (body.upper?.cz ?? 0) - k * 0.5, PI / 2, 1, 1, 1, hx('#8d949a'));
  }
}

function restaurantRoom(h: Host): void {
  const body = h.body!;
  const P = h.props, t = h.t;
  const y = floorY(h, 0);
  const front = body.cz + body.d / 2 - 0.1;
  for (let k = 0; k < 3; k++) picture(h, -body.w / 2 + 0.08, y + 1.6, body.cz - 1 + k * 2.2, PI / 2, 700 + k, 0.7, 0.5);
  for (const sx of [-1, 1]) P.add('plantBush', t, sx * (body.w / 2 - 0.5), y, front - 0.5, sx);
  // coat rack by the door
  t.push(body.w / 2 - 0.5, y, front - 1.4, 0);
  h.solid.cyl(0, 0, 0, 0.2, 0.2, 0.03, 8, C.woodDark);
  h.solid.cyl(0, 0.03, 0, 0.025, 0.025, 1.75, 5, C.woodDark);
  P.add('box', t, 0.12, 1.15, 0, 0.3, 0.12, 0.6, 0.2, pick(PC.fabric, hash2(h.b.seed, 701)));
  t.pop();
}

function storeRoom(h: Host): void {
  const body = h.body!;
  const P = h.props, t = h.t;
  const y = floorY(h, 0);
  const front = body.cz + body.d / 2 - 0.12;
  // a stack of baskets and a few shopping carts by the door
  for (let k = 0; k < 4; k++) P.add('box', t, -body.w / 2 + 0.6, y + k * 0.12, front - 0.6, 0, 0.4, 0.12, 0.3, h.brand);
  for (let k = 0; k < 3; k++) {
    t.push(-body.w / 2 + 1.5 + k * 0.25, y, front - 0.8, 0);
    h.solid.box(0, 0.35, 0, 0.5, 0.45, 0.8, C.metal, 0, false);
    h.solid.box(0, 0.08, 0, 0.45, 0.04, 0.75, C.metal, 0, false);
    for (const [sx, sz] of [[-0.2, -0.35], [0.2, -0.35], [0.2, 0.35], [-0.2, 0.35]]) h.solid.box(sx, 0, sz, 0.04, 0.08, 0.04, C.dark);
    t.pop();
  }
  // hanging category signs
  for (let k = 0; k < 3; k++) {
    h.solid.box(-body.w / 4 + k * (body.w / 4), y + 2.55, body.cz - 1.0, 0.01, 0.4, 0.01, C.metal, 0, false);
    h.solid.box(-body.w / 4 + k * (body.w / 4), y + 2.25, body.cz - 1.0, 1.2, 0.32, 0.03, k % 2 ? h.brand : C.white);
  }
}

function factoryRoom(h: Host): void {
  const body = h.body!;
  const P = h.props, t = h.t;
  const y = floorY(h, 0);
  const r = (j: number) => hash2(h.b.seed, 29000 + j);
  const back = body.cz - body.d / 2 + 0.2;
  // pallets and barrels along the back wall, an extinguisher by the door, a workbench
  for (let k = 0; k < 4; k++) {
    const x = -body.w / 2 + 1.0 + k * 1.35;
    P.add('pallet', t, x, y, back + 0.7, 0);
    if (r(k) < 0.7) P.add('crate', t, x, y + 0.13, back + 0.7, r(10 + k) * 0.3, 0.9, 0.7 + r(20 + k) * 0.4, 0.9, pick([C.woodLight, hx('#c9b48a'), hx('#8a9aa8')], r(30 + k)));
  }
  for (let k = 0; k < 3; k++) P.add('barrel', t, body.w / 2 - 0.5, y, back + 0.5 + k * 0.65, 0, 1, 1, 1, pick([hx('#2e6da4'), hx('#c0392b'), hx('#3f6b4a')], r(40 + k)));
  P.add('extinguisher', t, body.w / 2 - 0.25, y, body.cz + body.d / 2 - 1.2, 0);
  P.add('toolboard', t, -body.w / 2 + 0.05, y + 0.9, body.cz - 1.0, PI / 2);
  P.add('workbench', t, -body.w / 2 + 0.5, y, body.cz - 1.0, PI / 2);
  if (body.w > 12 && r(50) < 0.6) P.add('forklift', t, body.w / 2 - 1.5, y, body.cz + body.d / 2 - 2.5, PI + 0.3);
}

