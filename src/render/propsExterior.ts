// Fine exterior detail for buildings close to the camera: curtains and blinds
// behind the glass, flower boxes, window AC units, balcony furniture, rooftop
// clutter, door mats, bins, bike racks, café table settings and construction
// site odds and ends. Flat things (curtains) go into the building's own
// buffers; anything with volume is a thin-instanced prop.

import { Color3 } from '@babylonjs/core';
import { hash2 } from '../sim/rng';
import { C, Geo, hx, mix, shade } from './buildingGeo';
import { PC, type Host } from './props';

const pickOf = <T>(arr: readonly T[], h: number): T => arr[Math.floor(h * arr.length) % arr.length];

/** Curtains, roller blinds or venetian blinds behind a residential pane (current wall frame, glass at depth z). */
export function dressWindow(h: Host, x0: number, y0: number, x1: number, y1: number, z: number, geo: Geo, n: number, lit: boolean): void {
  const s = h.b.seed;
  const k = hash2(s, 12000 + n);
  const w = x1 - x0, hh = y1 - y0;
  if (w < 0.35 || hh < 0.4) return;
  // the same household usually has the same curtains: color by floor band + side
  const col = pickOf(PC.curtains, hash2(s, 12500 + Math.floor(n / 3)));
  const zc = z + 0.004;
  const c = lit ? mix(col, hx('#fff1d8'), 0.15) : shade(col, 0.82);
  if (k < 0.36) {
    // two side curtains with a valance
    const cw = w * (0.2 + hash2(s, 12100 + n) * 0.14);
    geo.rect(x0, y0, x0 + cw, y1, zc, c);
    geo.rect(x1 - cw, y0, x1, y1, zc, c);
    geo.rect(x0, y1 - hh * 0.1, x1, y1, zc + 0.001, shade(c, 0.88));
    // folds
    for (const xx of [x0 + cw * 0.5, x1 - cw * 0.5]) geo.rect(xx - 0.012, y0, xx + 0.012, y1 - hh * 0.1, zc + 0.001, shade(c, 0.78));
  } else if (k < 0.56) {
    // roller blind partly down
    const down = 0.2 + hash2(s, 12200 + n) * 0.55;
    geo.rect(x0, y1 - hh * down, x1, y1, zc, mix(c, C.white, 0.35));
    geo.rect(x0, y1 - hh * down - 0.03, x1, y1 - hh * down, zc + 0.001, shade(c, 0.6));
  } else if (k < 0.7) {
    // venetian blinds
    const down = 0.5 + hash2(s, 12300 + n) * 0.5;
    const bc = mix(hx('#e8e4da'), c, 0.25);
    const slats = Math.max(4, Math.round((hh * down) / 0.07));
    for (let i = 0; i < slats; i++) {
      const yy = y1 - (i + 1) * ((hh * down) / slats);
      geo.rect(x0 + 0.01, yy, x1 - 0.01, yy + (hh * down) / slats * 0.62, zc, bc);
    }
  } else if (k < 0.8) {
    // one curtain gathered to a side, a plant on the sill
    const left = hash2(s, 12400 + n) < 0.5;
    const cw = w * 0.42;
    if (left) geo.rect(x0, y0, x0 + cw, y1, zc, c); else geo.rect(x1 - cw, y0, x1, y1, zc, c);
  }
}

/** Office blinds: some panes have them part way down. */
export function officeBlind(h: Host, x0: number, y0: number, x1: number, y1: number, z: number, geo: Geo, n: number, lit: boolean): void {
  const k = hash2(h.b.seed, 13000 + n);
  if (k > 0.34) return;
  const hh = y1 - y0;
  const down = 0.15 + hash2(h.b.seed, 13100 + Math.floor(n / 4)) * 0.5;
  const col = lit ? new Color3(1, 1, 0.96) : hx('#c9ccc8');
  const yb = y1 - hh * down;
  geo.rect(x0 + 0.02, yb, x1 - 0.02, y1 - 0.02, z + 0.004, col);
  const line = lit ? new Color3(0.85, 0.85, 0.82) : hx('#a9aca8');
  for (let yy = y1 - 0.12; yy > yb + 0.04; yy -= 0.12) geo.rect(x0 + 0.02, yy, x1 - 0.02, yy + 0.015, z + 0.005, line);
  geo.rect(x0 + 0.02, yb - 0.025, x1 - 0.02, yb, z + 0.005, shade(line, 0.7));
}

/** Flower boxes, window AC units, transom bars (current wall frame, window centered at x, sill at y). */
export function windowExtras(h: Host, x: number, y: number, w: number, hh: number, kind: string, frame: Color3, sill: boolean): void {
  if (kind !== 'res') return;
  const kindB = h.b.kind;
  const n = Math.round(x * 13.7 + y * 31.3);
  const k = hash2(h.b.seed, 14000 + n);
  const homes = kindB === 'house' || kindB === 'apartments' || kindB === 'store' || kindB === 'trailer' || kindB === 'farm';
  // inner frame: a slim transom bar and side jambs
  h.solid.rect(x - w / 2, y + hh * 0.72, x + w / 2, y + hh * 0.72 + 0.045, 0.072, frame);
  if (!homes || !sill) return;
  if (k < (kindB === 'house' ? 0.4 : 0.22) && y > 0.5) {
    const flower = pickOf(PC.flowers, hash2(h.b.seed, 14100 + n));
    const boxC = pickOf([hx('#8a5a3a'), hx('#c9b89a'), hx('#5a6b4a'), hx('#b5603f'), hx('#ecebe6')], hash2(h.b.seed, 14200 + n));
    const sw = Math.min(1.4, w + 0.1);
    h.props.add('flowerBox', h.t, x, y - 0.32, 0.2, 0, sw, 1, 1, boxC);
    h.props.add('flowerLeaves', h.t, x, y - 0.32, 0.2, 0, sw, 1, 1);
    h.props.add('flowerHeads', h.t, x, y - 0.32, 0.2, 0, sw, 1, 1, flower);
  } else if (kindB === 'apartments' && k > 0.88 && y > 2) {
    h.props.add('acWall', h.t, x + w * 0.18, y - 0.55, 0.26, 0, 1, 1, 1, hx('#e6e6e2'));
  }
}

/** Door mats, push bars, house numbers. */
export function doorExtras(h: Host, x: number, w: number, hh: number, y: number, glass: boolean): void {
  const g = h.solid;
  g.box(x, Math.max(0, y) + 0.005, 0.5, Math.min(1.4, w + 0.2), 0.02, 0.6, hx('#3a3530'), 0, false);
  if (glass) {
    g.box(x, y + 1.0, 0.11, w * 0.8, 0.04, 0.04, hx('#c9cdd1'), 0, false);
    // opening hours sticker
    if (h.b.kind === 'store' || h.b.kind === 'restaurant') g.rect(x + w * 0.18, y + 1.35, x + w * 0.38, y + 1.6, 0.09, C.white);
  } else {
    g.box(x + w / 2 + 0.3, y + hh * 0.75, 0.04, 0.18, 0.12, 0.02, hx('#c9a13b'), 0, false);
  }
}

/** Balcony furniture (current wall frame; balcony floor at y, centered at u, depth 0.1..1.2). */
export function balconyProps(h: Host, u: number, y: number, k: number): void {
  const r = (j: number) => hash2(h.b.seed, 15000 + k * 17 + j);
  const P = h.props, t = h.t;
  const kind = r(0);
  if (kind < 0.38) {
    // bistro set
    P.add('bistroTable', t, u + 0.35, y, 0.68, 0, 0.75, 1, 0.75, pickOf(PC.bins, r(1)));
    P.add('chairBistro', t, u - 0.25, y, 0.62, Math.PI / 2 + (r(2) - 0.5) * 0.4, 1, 1, 1, pickOf(PC.fabric, r(3)));
    if (r(4) < 0.6) P.add('chairBistro', t, u + 0.95, y, 0.62, -Math.PI / 2 + (r(5) - 0.5) * 0.4, 1, 1, 1, pickOf(PC.fabric, r(3)));
    if (r(6) < 0.5) P.add('mug', t, u + 0.4, y + 0.73, 0.7, r(7) * 6, 1, 1, 1, pickOf(PC.mugs, r(8)));
  } else if (kind < 0.58) {
    P.add('chairArm', t, u - 0.4, y, 0.6, Math.PI + (r(2) - 0.5) * 0.5, 0.8, 0.8, 0.8, pickOf(PC.fabric, r(3)));
    P.add('plantBush', t, u + 0.8, y, 0.65, r(4) * 6, 0.8, 0.8, 0.8);
  } else if (kind < 0.7) {
    P.add('laundry', t, u, y, 0.62, (r(2) - 0.5) * 0.2, 0.9, 1, 0.8);
  } else if (kind < 0.78) {
    P.add('bike', t, u + 0.2, y, 0.85, Math.PI / 2, 1, 1, 1, pickOf(PC.mugs, r(2)));
  }
  // pots along the railing
  const pots = Math.floor(r(9) * 3.2);
  for (let i = 0; i < pots; i++) {
    const px = u - 1.05 + i * 0.32;
    P.add(r(10 + i) < 0.5 ? 'plantPot' : 'plantBush', t, px, y, 1.0, r(20 + i) * 6, r(10 + i) < 0.5 ? 2.2 : 0.55, r(10 + i) < 0.5 ? 2.2 : 0.55, r(10 + i) < 0.5 ? 2.2 : 0.55);
  }
  if (r(30) < 0.12) P.add('satDish', t, u - 1.1, y + 0.95, 1.0, 0.4, 0.9, 0.9, 0.9);
}

/** Rooftop clutter on a flat roof (building-local frame). `avoid` = [x, z, halfW, halfD] rectangles. */
export function roofClutter(h: Host, cx: number, cz: number, w: number, d: number, y: number, avoid: number[][], k0: number, opts: { ac?: number; vents?: number; antenna?: boolean; dishes?: number; skylights?: number; hatch?: boolean } = {}): void {
  if (h.cut) return; // no roof on an opened building
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 16000 + k0 * 101 + j);
  const used: number[][] = avoid.map((a) => a.slice());
  const free = (x: number, z: number, hw: number, hd: number) => {
    if (Math.abs(x - cx) + hw > w / 2 - 0.6 || Math.abs(z - cz) + hd > d / 2 - 0.6) return false;
    for (const [ax, az, aw, ad] of used) if (Math.abs(x - ax) < aw + hw + 0.3 && Math.abs(z - az) < ad + hd + 0.3) return false;
    return true;
  };
  const place = (hw: number, hd: number, j: number): [number, number] | null => {
    for (let tries = 0; tries < 14; tries++) {
      const x = cx + (r(j * 7 + tries) - 0.5) * (w - 1.6), z = cz + (r(j * 7 + tries + 500) - 0.5) * (d - 1.6);
      if (free(x, z, hw, hd)) { used.push([x, z, hw, hd]); return [x, z]; }
    }
    return null;
  };
  const acC = pickOf([hx('#d8dad6'), hx('#c9ccc8'), hx('#e6e4dc'), hx('#b9bec2')], r(1));
  for (let i = 0; i < (opts.ac ?? 0); i++) {
    const p = place(0.7, 0.55, 10 + i);
    if (p) P.add('acUnit', t, p[0], y, p[1], Math.floor(r(40 + i) * 4) * (Math.PI / 2), 1, 1, 1, acC);
  }
  for (let i = 0; i < (opts.vents ?? 0); i++) {
    const big = r(60 + i) < 0.4;
    const p = place(big ? 0.5 : 0.2, big ? 0.5 : 0.2, 30 + i);
    if (p) P.add(big ? 'ventBox' : r(70 + i) < 0.5 ? 'ventPipe' : 'turbineVent', t, p[0], y, p[1], r(80 + i) * 3, 1, 1, 1, big ? acC : null);
  }
  for (let i = 0; i < (opts.skylights ?? 0); i++) {
    const p = place(0.65, 0.65, 50 + i);
    if (p) P.add('skylight', t, p[0], y, p[1], 0);
  }
  if (opts.hatch) { const p = place(0.5, 0.5, 70); if (p) P.add('roofHatch', t, p[0], y, p[1], 0, 1, 1, 1, acC); }
  if (opts.antenna) { const p = place(0.3, 0.3, 80); if (p) P.add('antenna', t, p[0], y, p[1], r(90) * 3); }
  for (let i = 0; i < (opts.dishes ?? 0); i++) {
    const p = place(0.4, 0.4, 90 + i);
    if (p) P.add('satDish', t, p[0], y, p[1], r(95 + i) * Math.PI * 2, 1.2, 1.2, 1.2);
  }
}

/** A trash bin / litter bin / bike rack / bollards group at the curb (building-local frame). */
export function streetBits(h: Host, x: number, z: number, rot: number, k: number, what: ('bins' | 'litter' | 'bikes' | 'bollards' | 'hydrant' | 'board')[]): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 17000 + k * 31 + j);
  t.push(x, 0.05, z, rot);
  let u = 0;
  for (const w of what) {
    if (w === 'bins') {
      const n = 1 + Math.floor(r(1) * 3);
      for (let i = 0; i < n; i++) P.add('trashBin', t, u + i * 0.75, 0, 0, 0, 1, 1, 1, pickOf(PC.bins, r(2 + i)));
      u += n * 0.75 + 0.5;
    } else if (w === 'litter') { P.add('litterBin', t, u, 0, 0, 0, 1, 1, 1, hx('#3f4a44')); u += 0.9; }
    else if (w === 'bikes') {
      P.add('bikeRack', t, u + 1.0, 0, 0, 0);
      for (let i = 0; i < 4; i++) if (r(10 + i) < 0.55) P.add('bike', t, u + 0.1 + i * 0.6, 0, 0, Math.PI / 2 + (r(20 + i) - 0.5) * 0.15, 1, 1, 1, pickOf(PC.mugs, r(30 + i)));
      u += 2.6;
    } else if (w === 'bollards') { for (let i = 0; i < 3; i++) P.add('bollard', t, u + i * 1.3, 0, 0, 0, 1, 1, 1, hx('#3a3d42')); u += 4; }
    else if (w === 'hydrant') { P.add('hydrant', t, u, 0, 0, 0); u += 0.8; }
    else if (w === 'board') { P.add('sandwichBoard', t, u, 0, 0, (r(40) - 0.5) * 0.6); u += 1; }
  }
  t.pop();
}

/** Plates, cups and glasses on an outdoor café table (table top at y, centered at x, z; building-local). */
export function cafeSetting(h: Host, x: number, y: number, z: number, k: number): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 18000 + k * 23 + j);
  for (const side of [-1, 1]) {
    const a = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    const px = x + side * 0.24;
    if (r(side + 2) < 0.7) {
      P.add('plate', t, px, y, z, a, 0.75, 1, 0.75);
      if (r(side + 4) < 0.6) P.add(r(side + 6) < 0.5 ? 'foodC' : 'foodB', t, px, y, z, a, 0.75, 1, 0.75);
    }
    if (r(side + 8) < 0.8) P.add('mug', t, px - side * 0.02, y, z + 0.18, r(side + 10) * 6, 0.9, 0.9, 0.9, C.white);
    if (r(side + 12) < 0.5) P.add('glassCup', t, px, y, z - 0.17, 0, 0.065, 0.12, 0.065);
  }
  if (r(20) < 0.5) P.add('vase', t, x, y, z, 0, 0.8, 0.8, 0.8, pickOf(PC.mugs, r(21)));
}

/** Construction-site odds and ends (building-local; W x D structure footprint). */
export function siteExtras(h: Host, W: number, D: number, H: number, top: number, timber: boolean): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 19000 + j);
  const lw = Math.max(h.look.lotW || 0, h.b.w + 1), ld = Math.max(h.look.lotD || 0, h.b.d + 1);
  // safety netting on the scaffold faces of tall sites
  if (H > 3 && top > 2.5 && !timber) {
    const off = 0.9 + 0.8;
    const hgt = Math.min(top + 1.0, H + 1.0);
    for (const [x, z, rot, len] of [[0, D / 2 + off, 0, W + 2 * off], [W / 2 + off, 0, Math.PI / 2, D + 2 * off], [-W / 2 - off, 0, -Math.PI / 2, D + 2 * off]] as const) {
      P.add('netting', t, x, 2.0, z, rot, len, hgt - 2.0, 1);
    }
  }
  // ladders against the scaffold, a wheelbarrow, buckets, hard hats, rebar, a skip, a generator, site lights
  if (top > 1.5) P.add('ladder', t, W / 2 + 1.2, 0.05, D / 4, Math.PI / 2, 1, Math.min(1, (top + 1) / 3), 1);
  P.add('wheelbarrow', t, -W / 2 - 1.2, 0.05, D / 2 + 1.0, r(1) * 6, 1, 1, 1, pickOf([hx('#2e6da4'), C.orange, hx('#3f8a3a')], r(2)));
  for (let i = 0; i < 3; i++) P.add('bucket', t, -W / 2 - 0.4 + i * 0.35, 0.05, D / 2 + 1.6 + (i % 2) * 0.3, 0, 1, 1, 1, pickOf([C.orange, C.white, hx('#2b2e32')], r(3 + i)));
  if (!timber) {
    P.add('rebar', t, W / 2 + 1.8, 0.05, -D / 4, 0, 1, 1, Math.min(1, D / 4.5));
    P.add('generator', t, -W / 2 - 1.4, 0.05, -D / 2 + 0.6, Math.PI / 2, 1, 1, 1, C.yellow);
  }
  const sx = lw / 2 - 2.2, sz = -ld / 2 + 2.2;
  if (lw > W + 6 && ld > D + 6) P.add('skip', t, sx, 0.05, sz, Math.PI / 2, 0.9, 0.9, 0.9, pickOf([C.yellow, hx('#2e6da4'), C.orange], r(10)));
  // a trestle with hard hats and a cooler by the gate
  const tz = ld / 2 - 2.0;
  h.solid.box(lw / 4, 0.05, tz, 1.4, 0.75, 0.05, C.woodLight);
  h.solid.box(lw / 4, 0.8, tz, 1.6, 0.04, 0.6, C.planks);
  for (let i = 0; i < 3; i++) P.add('hardhat', t, lw / 4 - 0.5 + i * 0.45, 0.84, tz + (i % 2) * 0.1, r(20 + i), 1, 1, 1, pickOf([C.yellow, C.orange, C.white, hx('#2e6da4')], r(24 + i)));
  P.add('box', t, lw / 4 + 0.6, 0.84, tz, 0.2, 0.35, 0.3, 0.25, hx('#c0392b'));
  for (let i = 0; i < 2; i++) P.add('siteLight', t, (i ? 1 : -1) * (W / 2 + 2.2), 0.05, D / 2 + 1.6, i ? -0.6 : 0.6);
  for (let i = 0; i < 4; i++) P.add('trafficCone', t, -1.8 + i * 1.2, 0.05, ld / 2 - 1.1, r(30 + i));
}

/** Industrial yard clutter around a hall (building-local; hall bw x bd at cz). */
export function hallExtras(h: Host, bw: number, bd: number, cz: number, H: number, roof: 'flat' | 'gable' | 'other'): void {
  const P = h.props, t = h.t;
  const r = (j: number) => hash2(h.b.seed, 19500 + j);
  const lw = Math.max(h.look.lotW || 0, h.b.w + 1), ld = Math.max(h.look.lotD || 0, h.b.d + 1);
  const side = (lw - bw) / 2, back = (ld / 2 + cz - bd / 2);
  // pipes and an electrical box on the side wall, gas cylinders, a hydrant
  t.push(bw / 2, 0, cz, Math.PI / 2);
  P.add('elecBox', t, -bd * 0.3, 0.3, 0.16, 0, 1, 1, 1, hx('#b9bec2'));
  P.add('pipeRun', t, -bd * 0.3 + 0.7, 0.2, 0.15, 0, 1, H - 0.4, 1, hx('#8d949a'));
  P.add('pipeRun', t, -bd * 0.3 + 0.95, 0.2, 0.15, 0, 0.8, H - 0.6, 0.8, hx('#c0392b'));
  t.pop();
  if (side > 1.6) for (let i = 0; i < 4; i++) P.add('gasCylinder', t, bw / 2 + 0.45 + (i % 2) * 0.3, 0.05, cz + bd * 0.2 + Math.floor(i / 2) * 0.3, 0, 1, 1, 1, pickOf([hx('#2e6da4'), hx('#3f8a3a'), C.orange, hx('#8d949a')], r(i)));
  if (side > 3.5 && r(10) < 0.7) P.add('forklift', t, -bw / 2 - side / 2, 0.05, cz + bd * 0.1, Math.PI / 2 + (r(11) - 0.5) * 0.5);
  if (back > 2.5) {
    for (let i = 0; i < 3; i++) P.add('pallet', t, -bw / 2 + 1.2 + i * 1.4, 0.05, cz - bd / 2 - 1.2, (r(20 + i) - 0.5) * 0.2);
    for (let i = 0; i < 2; i++) P.add('barrel', t, bw / 2 - 1 - i * 0.7, 0.05, cz - bd / 2 - 1.0, 0, 1, 1, 1, pickOf([hx('#2e6da4'), C.red, hx('#3f6b4a')], r(30 + i)));
  }
  P.add('hydrant', t, bw / 2 + 0.8, 0.05, cz + bd / 2 + 1.2, 0);
  if (roof === 'flat') roofClutter(h, 0, cz, bw, bd, H + 0.08, [], 7, { vents: 4 + Math.floor(r(40) * 3), ac: 1 + Math.floor(r(41) * 2) });
  else if (roof === 'gable' && !h.cut) {
    // ridge vents on pitched roofs
    for (let i = 0; i < 3; i++) P.add('turbineVent', t, -bw / 3 + i * bw / 3, H + Math.min(3.2, bd * 0.2) - 0.25, cz, 0, 1.2, 1.2, 1.2);
  }
}
