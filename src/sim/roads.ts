// The road network and the lots along it.
//
// The city is not a tile grid: roads are a graph of nodes and straight
// segments with slightly irregular angles, and land is divided into lots
// along both sides of every road.
//
// Nothing here happens by itself. At the start there is only the regional
// highway, built by the outside world, and an old cart track around the
// market clearing. A government lays out streets from its street plan when
// its council decides to (layoutRoads): each one starts as a surveyed dirt
// track, and the lots along it belong to that government (or to the
// Territory outside any claim) until they are sold. Paving a street is a
// separate public-works project (see government.ts).

import { LOT_SIZE, ROAD, ZONES } from './config';
import { newId, TERRITORY, type Ctx } from './ctx';
import type { Lot, PlannedRoad, RoadEdge, RoadKind, RoadNode, Zone } from './types';
import { hash2 } from './rng';
import { streetName } from './names';
import { lineClear, mapSize, tileOf, useTile, walkable, wildPath } from './world';

export function sidewalkOf(kind: RoadKind): number {
  return kind === 'country' ? 0.6 : ROAD.sidewalk;
}

/** Distance from a road's centerline to the outer edge of its sidewalk. */
export function halfSpan(e: Pick<RoadEdge, 'width' | 'kind'>): number {
  return e.width / 2 + sidewalkOf(e.kind);
}

// ------------------------------------------------------------ geometry utils

interface OBB { cx: number; cy: number; ux: number; uy: number; hw: number; hd: number } // u = width axis

function obb(cx: number, cy: number, angle: number, w: number, d: number): OBB {
  // `angle` is the facing direction (depth axis); width runs perpendicular
  return { cx, cy, ux: Math.sin(angle), uy: -Math.cos(angle), hw: w / 2, hd: d / 2 };
}

function obbOverlap(a: OBB, b: OBB, pad = 0): boolean {
  const axes: [number, number][] = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [ax, ay] of axes) {
    const ra = a.hw * Math.abs(a.ux * ax + a.uy * ay) + a.hd * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hd * Math.abs(-b.uy * ax + b.ux * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb + pad) return false;
  }
  return true;
}

function edgeBox(ctx: Ctx, e: RoadEdge, extra = 0): OBB {
  const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  // depth axis along the road
  return obb((a.x + b.x) / 2, (a.y + b.y) / 2, ang, (halfSpan(e) + extra) * 2, e.len);
}

function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number; x: number; y: number } {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  const x = ax + vx * t, y = ay + vy * t;
  return { d: Math.hypot(px - x, py - y), t, x, y };
}

// -------------------------------------------------------------- spatial index

/** Set by government.ts: who owns new land at a point, what it sells for, and whether an owner is public. */
export const landHooks = {
  ownerAt: (_ctx: Ctx, _x: number, _y: number): number => TERRITORY.id,
  priceOf: (_ctx: Ctx, _lot: Lot): number => 30,
  isPublic: (_ctx: Ctx, owner: number): boolean => owner < 0,
};

const CELL = 60;
interface Index { ver: number; lots: Map<number, number[]>; edges: Map<number, number[]>; adj: Map<number, { to: number; edge: number; cost: number; dirt: boolean }[]> }
const indexes = new WeakMap<object, Index>();

function cellKey(cx: number, cy: number): number {
  return cx * 100000 + cy;
}

function cellsAround(x: number, y: number, r: number): number[] {
  const out: number[] = [];
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) out.push(cellKey(cx, cy));
  }
  return out;
}

function index(ctx: Ctx): Index {
  const roads = ctx.s.roads;
  let ix = indexes.get(roads);
  if (ix && ix.ver === roads.ver) return ix;
  const fresh: Index = { ver: roads.ver, lots: new Map(), edges: new Map(), adj: new Map() };
  for (const l of roads.lots) indexLot(fresh, l);
  for (const e of roads.edges) indexEdge(ctx, fresh, e);
  indexes.set(roads, fresh);
  ix = fresh;
  return ix;
}

/** Keep a current index current after adding a lot or edge (avoids full rebuilds). */
function indexAdd(ctx: Ctx, add: (ix: Index) => void): void {
  const roads = ctx.s.roads;
  const ix = indexes.get(roads);
  const was = roads.ver;
  roads.ver++;
  if (ix && ix.ver === was) {
    add(ix);
    ix.ver = roads.ver;
  }
}

function putCell(m: Map<number, number[]>, k: number, id: number): void {
  const arr = m.get(k);
  if (arr) arr.push(id); else m.set(k, [id]);
}

function indexLot(ix: Index, l: Lot): void {
  for (const k of cellsAround(l.x, l.y, Math.hypot(l.w, l.d) / 2)) putCell(ix.lots, k, l.id);
}

function indexEdge(ctx: Ctx, ix: Index, e: RoadEdge): void {
  const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
  const steps = Math.max(1, Math.ceil(e.len / (CELL / 2)));
  const seen = new Set<number>();
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    for (const k of cellsAround(x, y, halfSpan(e) + 2)) if (!seen.has(k)) { seen.add(k); putCell(ix.edges, k, e.id); }
  }
  const cost = e.len * (e.kind === 'country' ? 1.05 : 1);
  const dirt = e.built === false;
  if (!ix.adj.has(e.a)) ix.adj.set(e.a, []);
  if (!ix.adj.has(e.b)) ix.adj.set(e.b, []);
  ix.adj.get(e.a)!.push({ to: e.b, edge: e.id, cost, dirt });
  ix.adj.get(e.b)!.push({ to: e.a, edge: e.id, cost, dirt });
}

function nearbyIds(m: Map<number, number[]>, x: number, y: number, r: number): Set<number> {
  const out = new Set<number>();
  for (const k of cellsAround(x, y, r)) for (const id of m.get(k) ?? []) out.add(id);
  return out;
}

// -------------------------------------------------------------------- zones

export interface CityFrame { cx: number; cy: number; industrialAngle: number }

export function cityFrame(ctx: Ctx): CityFrame {
  const size = mapSize(ctx.s.world);
  return { cx: ctx.s.center?.x ?? size / 2, cy: ctx.s.center?.y ?? size / 2, industrialAngle: (ctx.s.seed % 628) / 100 };
}

/** How far downtown, the inner city and the suburbs reach: they grow with the city. */
export function zoneRadii(ctx: Ctx): { core: number; urban: number; suburb: number } {
  const pop = ctx.s.people.length;
  return { core: ZONES.core + Math.min(250, pop / 10), urban: ZONES.urban + Math.min(400, pop / 6), suburb: ZONES.suburb + Math.min(450, pop / 5) };
}

export function zoneAt(ctx: Ctx, x: number, y: number): Zone {
  const f = cityFrame(ctx);
  const r = zoneRadii(ctx);
  const d = Math.hypot(x - f.cx, y - f.cy);
  const ang = Math.atan2(y - f.cy, x - f.cx);
  let da = Math.abs(ang - f.industrialAngle) % (Math.PI * 2);
  if (da > Math.PI) da = Math.PI * 2 - da;
  if (da < 0.75 && d > r.core + 40 && d < r.suburb + 120) return 'industrial';
  if (d < r.core) return 'core';
  if (d < r.urban) return 'urban';
  if (d < r.suburb) return 'suburb';
  return 'rural';
}

const DENSER: Record<Zone, number> = { rural: 0, industrial: 1, suburb: 1, urban: 2, core: 3 };
/**
 * Daily: as the city grows, land near the center is rezoned denser (farmland
 * becomes suburb, suburbs the inner city, the inner city downtown), so taller
 * buildings may go up there. What already stands stays.
 */
export function rezone(ctx: Ctx): void {
  for (const l of ctx.s.roads.lots) {
    const z = zoneAt(ctx, l.x, l.y);
    if (z !== l.zone && DENSER[z] > DENSER[l.zone] && z !== 'industrial' && l.zone !== 'industrial') { l.zone = z; ctx.s.roads.ver++; }
  }
}

// ---------------------------------------------------------------- building

function addNode(ctx: Ctx, x: number, y: number): RoadNode {
  const n: RoadNode = { id: newId(ctx), x, y, edges: [] };
  ctx.s.roads.nodes.push(n);
  ctx.nodeById.set(n.id, n);
  return n;
}

function addEdge(ctx: Ctx, a: RoadNode, b: RoadNode, kind: RoadKind, built = false, name?: string): RoadEdge {
  const width = kind === 'avenue' ? ROAD.avenue : kind === 'street' ? ROAD.street : ROAD.country;
  const e: RoadEdge = { id: newId(ctx), a: a.id, b: b.id, kind, width, len: Math.hypot(b.x - a.x, b.y - a.y) };
  if (!built) { e.built = false; e.progress = 0; }
  if (name) e.name = name;
  ctx.s.roads.edges.push(e);
  ctx.edgeById.set(e.id, e);
  a.edges.push(e.id);
  b.edges.push(e.id);
  indexAdd(ctx, (ix) => indexEdge(ctx, ix, e));
  // clear nature under the road
  const w = ctx.s.world;
  const steps = Math.ceil(e.len / (w.tile / 2));
  const nx = -(b.y - a.y) / e.len, ny = (b.x - a.x) / e.len;
  const span = halfSpan(e) + 1;
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    for (let o = -span; o <= span; o += w.tile / 2) useTile(w, tileOf(w, x + nx * o, y + ny * o));
  }
  return e;
}

/** Is a straight road from (ax,ay) to (bx,by) possible? */
function roadFits(ctx: Ctx, ax: number, ay: number, bx: number, by: number, kind: RoadKind, ignoreNodes: number[]): boolean {
  const w = ctx.s.world;
  const size = mapSize(w);
  const margin = 30;
  if (bx < margin || by < margin || bx > size - margin || by > size - margin) return false;
  const len = Math.hypot(bx - ax, by - ay);
  for (let s = 0; s <= len; s += 6) {
    const x = ax + ((bx - ax) * s) / len, y = ay + ((by - ay) * s) / len;
    const t = tileOf(w, x, y);
    if (w.kind[t] === 'water' || (w.kind[t] === 'rock' && kind !== 'country')) return false;
  }
  if (!walkable(w, bx, by)) return false;
  const ix = index(ctx);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  // crossing or crowding other roads
  for (const id of nearbyIds(ix.edges, mx, my, len / 2 + 30)) {
    const e = ctx.edgeById.get(id)!;
    const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
    if (ignoreNodes.includes(e.a) || ignoreNodes.includes(e.b)) continue;
    if (segIntersect(ax, ay, bx, by, a.x, a.y, b.x, b.y)) return false;
    // stay clear of other roads' endpoints (near-misses look broken)
    if (pointSegDist(a.x, a.y, ax, ay, bx, by).d < 14 || pointSegDist(b.x, b.y, ax, ay, bx, by).d < 14) return false;
    if (pointSegDist(bx, by, a.x, a.y, b.x, b.y).d < 16) return false;
  }
  // must not run through lots that are taken
  const width = kind === 'avenue' ? ROAD.avenue : kind === 'street' ? ROAD.street : ROAD.country;
  const box = obb(mx, my, Math.atan2(by - ay, bx - ax), width + 2 * sidewalkOf(kind), len);
  for (const id of nearbyIds(ix.lots, mx, my, len / 2 + 40)) {
    const l = ctx.lotById.get(id)!;
    if (l.owner < 0 && l.building < 0) continue;
    if (obbOverlap(box, obb(l.x, l.y, l.angle, l.w, l.d), -0.5)) return false;
  }
  return true;
}

/** A lot a new road may run over: empty and publicly owned. */
function clearable(ctx: Ctx, l: Lot): boolean {
  return l.building < 0 && landHooks.isPublic(ctx, l.owner);
}

/** Remove empty public lots that a new road runs over. */
function clearLotsUnder(ctx: Ctx, e: RoadEdge): void {
  const box = edgeBox(ctx, e, 0.5);
  const ix = index(ctx);
  const hit = new Set<number>();
  for (const id of nearbyIds(ix.lots, box.cx, box.cy, e.len / 2 + 40)) {
    const l = ctx.lotById.get(id)!;
    if (clearable(ctx, l) && obbOverlap(box, obb(l.x, l.y, l.angle, l.w, l.d))) hit.add(l.id);
  }
  if (!hit.size) return;
  ctx.s.roads.lots = ctx.s.roads.lots.filter((l) => !hit.has(l.id));
  for (const id of hit) ctx.lotById.delete(id);
  ctx.s.roads.ver++;
}

export const lotFail = { terrain: 0, lot: 0, edge: 0, ok: 0 };
function lotFits(ctx: Ctx, box: OBB, ownEdge: number): boolean {
  const w = ctx.s.world;
  const size = mapSize(w);
  // terrain: corners, edge midpoints and center must be usable land
  for (const [sx, sy] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = box.cx + box.ux * box.hw * sx * 0.95 + -box.uy * box.hd * sy * 0.95;
    const y = box.cy + box.uy * box.hw * sx * 0.95 + box.ux * box.hd * sy * 0.95;
    if (x < 10 || y < 10 || x > size - 10 || y > size - 10) return false;
    const t = tileOf(w, x, y);
    if (w.kind[t] === 'water' || w.kind[t] === 'rock') { lotFail.terrain++; return false; }
  }
  const ix = index(ctx);
  const r = Math.hypot(box.hw, box.hd) + 40;
  for (const id of nearbyIds(ix.lots, box.cx, box.cy, r)) {
    const l = ctx.lotById.get(id)!;
    if (obbOverlap(box, obb(l.x, l.y, l.angle, l.w, l.d), ROAD.lotGap / 2)) { lotFail.lot++; return false; }
  }
  for (const id of nearbyIds(ix.edges, box.cx, box.cy, r)) {
    const e = ctx.edgeById.get(id)!;
    if (obbOverlap(box, edgeBox(ctx, e), id === ownEdge ? -0.3 : 0.3)) { lotFail.edge++; return false; }
  }
  lotFail.ok++;
  return true;
}

/** Divide both sides of a road into lots. */
function makeLots(ctx: Ctx, e: RoadEdge): number {
  const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
  const dx = (b.x - a.x) / e.len, dy = (b.y - a.y) / e.len;
  let made = 0;
  for (const side of [1, -1] as const) {
    const nx = -dy * side, ny = dx * side; // outward normal on this side
    let pos = 9;
    while (pos < e.len - 9) {
      const px = a.x + dx * pos, py = a.y + dy * pos;
      const zone = zoneAt(ctx, px + nx * 20, py + ny * 20);
      const [lw, ld] = LOT_SIZE[zone];
      if (pos + lw > e.len - 9) break;
      const along = pos + lw / 2;
      const setback = halfSpan(e) + 0.6;
      const angle = Math.atan2(-ny, -nx);
      // shallow blocks get shallower lots
      let depth = 0, cx = 0, cy = 0;
      for (const d of [ld, ld * 0.75, ld * 0.55]) {
        if (d < 12) break;
        const x = a.x + dx * along + nx * (setback + d / 2), y = a.y + dy * along + ny * (setback + d / 2);
        if (lotFits(ctx, obb(x, y, angle, lw, d), e.id)) { depth = d; cx = x; cy = y; break; }
      }
      if (depth > 0) {
        const lot: Lot = { id: newId(ctx), edge: e.id, side, t: along / e.len, x: cx, y: cy, angle, w: lw, d: depth, zone, owner: landHooks.ownerAt(ctx, cx, cy), building: -1, forSale: 0 };
        lot.forSale = landHooks.priceOf(ctx, lot);
        ctx.s.roads.lots.push(lot);
        ctx.lotById.set(lot.id, lot);
        indexAdd(ctx, (ix) => indexLot(ix, lot));
        made++;
        pos += lw + ROAD.lotGap;
      } else pos += 6;
    }
  }
  return made;
}

/**
 * The town's master plan: an irregular grid of streets aligned with the four
 * avenues out of the square (block sizes vary, corners are jittered), plus
 * country roads reaching out to farmland. Streets are only built once the
 * city grows to them (see growRoads).
 */
function makePlan(ctx: Ctx, cx: number, cy: number, rot: number): void {
  const plan = ctx.s.roads.plan;
  const w = ctx.s.world;
  const size = mapSize(w);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const at = (u: number, v: number): [number, number] => [cx + u * cos - v * sin, cy + u * sin + v * cos];
  // uneven spacing: each grid line sits at its own distance
  const lines = (n: number, base: number) => {
    const out = [0];
    let pos = 0;
    for (let i = 1; i <= n; i++) { pos += base * (0.8 + 0.4 * hash2(i, n, ctx.s.seed)); out.push(pos); }
    return out;
  };
  const N = 9;
  const us = lines(N, 86), vs = lines(N, 74);
  const U = [...us.slice(1).map((x) => -x).reverse(), ...us];
  const V = [...vs.slice(1).map((x) => -x).reverse(), ...vs];
  const node = (i: number, j: number): [number, number] | null => {
    let u = U[i], v = V[j];
    const onAxis = U[i] === 0 || V[j] === 0;
    const jit = onAxis ? 2 : 7;
    u += (hash2(i, j, ctx.s.seed + 1) - 0.5) * 2 * jit;
    v += (hash2(i, j, ctx.s.seed + 2) - 0.5) * 2 * jit;
    return at(u, v);
  };
  const ok = (a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s2 = 0; s2 <= len; s2 += 6) {
      const x = a[0] + ((b[0] - a[0]) * s2) / len, y = a[1] + ((b[1] - a[1]) * s2) / len;
      if (x < 30 || y < 30 || x > size - 30 || y > size - 30) return false;
      const t = tileOf(w, x, y);
      if (w.kind[t] === 'water' || w.kind[t] === 'rock') return false;
    }
    return true;
  };
  const maxR = 640;
  for (let i = 0; i < U.length; i++) {
    for (let j = 0; j < V.length; j++) {
      const a = node(i, j);
      if (!a) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= U.length || j + dj >= V.length) continue;
        const b = node(i + di, j + dj);
        if (!b) continue;
        const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
        const r = Math.hypot(mx, my);
        if (r > maxR) continue;
        // the outer suburbs get a few dead ends and gaps, like real towns
        if (r > 380 && hash2(i * 3 + di, j * 3 + dj, ctx.s.seed + 9) < 0.12) continue;
        if (!ok(a, b)) continue;
        const axis = (dj === 0 && V[j] === 0) || (di === 0 && U[i] === 0);
        const major = (dj === 0 && j % 4 === 0) || (di === 0 && i % 4 === 0);
        // lines of constant v run along u (numbered streets); constant u: named avenues
        const name = dj === 0 ? streetName('u', j - (V.length - 1) / 2, major) : streetName('v', i - (U.length - 1) / 2, major);
        plan.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], kind: axis || major ? 'avenue' : 'street', done: false, name });
      }
    }
  }
  // country roads: out along the avenues and a few more directions
  for (let k = 0; k < 8; k++) {
    const ang = rot + (k * Math.PI) / 4 + (k % 2 ? (hash2(k, 5, ctx.s.seed) - 0.5) * 0.4 : 0);
    let px = cx + Math.cos(ang) * (maxR - 40), py = cy + Math.sin(ang) * (maxR - 40);
    let dir = ang;
    for (let step = 0; step < 12; step++) {
      dir += (hash2(k, step, ctx.s.seed + 4) - 0.5) * 0.35;
      const nx = px + Math.cos(dir) * 130, ny = py + Math.sin(dir) * 130;
      if (!ok([px, py], [nx, ny])) break;
      plan.push({ ax: px, ay: py, bx: nx, by: ny, kind: 'country', done: false, name: `${['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][k]} Road` });
      px = nx; py = ny;
    }
  }
}

function nodeNear(ctx: Ctx, x: number, y: number, r: number): RoadNode | undefined {
  for (const n of ctx.s.roads.nodes) if (Math.abs(n.x - x) < r && Math.abs(n.y - y) < r && Math.hypot(n.x - x, n.y - y) < r) return n;
  return undefined;
}

/** Build one planned road (if it connects to what's built). Returns lots created, or -1 if not possible. */
function activate(ctx: Ctx, pr: PlannedRoad): number {
  const a = nodeNear(ctx, pr.ax, pr.ay, 3), b = nodeNear(ctx, pr.bx, pr.by, 3);
  if (!a && !b) return -1;
  if (a && b && a.edges.some((id) => { const e = ctx.edgeById.get(id)!; return e.a === b.id || e.b === b.id; })) { pr.done = true; return 0; }
  // lots in the way that are already taken block the road for now
  const len = Math.hypot(pr.bx - pr.ax, pr.by - pr.ay);
  const box = obb((pr.ax + pr.bx) / 2, (pr.ay + pr.by) / 2, Math.atan2(pr.by - pr.ay, pr.bx - pr.ax), (pr.kind === 'avenue' ? ROAD.avenue : ROAD.street) + 2 * sidewalkOf(pr.kind), len);
  const ix = index(ctx);
  for (const id of nearbyIds(ix.lots, box.cx, box.cy, len / 2 + 40)) {
    const l = ctx.lotById.get(id)!;
    if (!clearable(ctx, l) && obbOverlap(box, obb(l.x, l.y, l.angle, l.w, l.d), -0.5)) return -1;
  }
  const na = a ?? addNode(ctx, pr.ax, pr.ay);
  const nb = b ?? addNode(ctx, pr.bx, pr.by);
  const e = addEdge(ctx, na, nb, pr.kind, false, pr.name);
  pr.done = true;
  clearLotsUnder(ctx, e);
  return makeLots(ctx, e);
}

/**
 * What exists before anyone arrives: the regional highway, built by the
 * outside world, running across the map. In town it's the line a street plan
 * would call Main Street. Also drafts that street plan (a government may
 * adopt it or not). Lots along the highway are made by the caller once the
 * land has owners.
 */
export function initRoads(ctx: Ctx, cx: number, cy: number): void {
  const rot = ctx.rng.range(-0.3, 0.3);
  makePlan(ctx, cx, cy, rot);
  // Main Street segments of the plan exist already: they're the highway
  const main = ctx.s.roads.plan.filter((pr) => pr.name === 'Main Street')
    .sort((a, b) => ((a.ax + a.bx) - (b.ax + b.bx)) * Math.cos(rot) + ((a.ay + a.by) - (b.ay + b.by)) * Math.sin(rot));
  let first: RoadNode | undefined, last: RoadNode | undefined;
  for (const pr of main) {
    if (Math.hypot((pr.ax + pr.bx) / 2 - cx, (pr.ay + pr.by) / 2 - cy) > 360) continue;
    const a = nodeNear(ctx, pr.ax, pr.ay, 3) ?? addNode(ctx, pr.ax, pr.ay);
    const b = nodeNear(ctx, pr.bx, pr.by, 3) ?? addNode(ctx, pr.bx, pr.by);
    addEdge(ctx, a, b, 'avenue', true, 'Main Street');
    pr.done = true;
    first ??= a;
    last = b;
  }
  if (!first || !last) {
    first = addNode(ctx, cx - Math.cos(rot) * 60, cy - Math.sin(rot) * 60);
    last = addNode(ctx, cx + Math.cos(rot) * 60, cy + Math.sin(rot) * 60);
    addEdge(ctx, first, last, 'avenue', true, 'Main Street');
  }
  // beyond town it carries on as a country highway to the edge of the map
  const size = mapSize(ctx.s.world);
  for (const [mid, dir, side] of [[last, rot, 1], [first, rot + Math.PI, 2]] as const) {
    let px = mid.x, py = mid.y;
    let prev = mid;
    for (let step = 0; step < 14; step++) {
      const ang = dir + (hash2(step, side, ctx.s.seed + 77) - 0.5) * 0.25;
      const nx = px + Math.cos(ang) * 130, ny = py + Math.sin(ang) * 130;
      if (nx < 40 || ny < 40 || nx > size - 40 || ny > size - 40) break;
      if (!roadFits(ctx, px, py, nx, ny, 'country', [prev.id])) break;
      const n = addNode(ctx, nx, ny);
      addEdge(ctx, prev, n, step < 2 ? 'avenue' : 'country', true, 'Route 9');
      prev = n; px = nx; py = ny;
    }
  }
}

/** Divide every road that has no lots yet (after land has owners). */
export function makeAllLots(ctx: Ctx): void {
  const has = new Set(ctx.s.roads.lots.map((l) => l.edge));
  for (const e of ctx.s.roads.edges.slice()) if (!has.has(e.id)) makeLots(ctx, e);
}

/** Lay out (survey) up to `n` streets from the plan where land of a zone is wanted (or around a town's center). Returns lots created. */
export function layoutRoads(ctx: Ctx, want: Zone, n: number, around?: { x: number; y: number }): number {
  return growRoads(ctx, want, 30, n, around);
}

function edgeDirsAt(ctx: Ctx, n: RoadNode): number[] {
  return n.edges.map((id) => {
    const e = ctx.edgeById.get(id)!;
    const o = ctx.nodeById.get(e.a === n.id ? e.b : e.a)!;
    return Math.atan2(o.y - n.y, o.x - n.x);
  });
}

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/**
 * Extend the network so more lots of `want` exist. Tries a number of random
 * extensions from existing intersections; returns how many new lots appeared.
 */
export function growRoads(ctx: Ctx, want: Zone, attempts = 60, maxBuilt = 4, around?: { x: number; y: number }): number {
  // a smaller town grows around its own center (no street plan, just extensions from its own streets)
  const f = around ? { ...cityFrame(ctx), cx: around.x, cy: around.y } : cityFrame(ctx);
  const nodes = around ? ctx.s.roads.nodes.filter((n) => Math.hypot(n.x - around.x, n.y - around.y) < 320) : ctx.s.roads.nodes;
  if (!nodes.length) return 0;
  const target = around ? (want === 'rural' ? 220 : want === 'suburb' ? 150 : 80) : want === 'core' ? ZONES.core * 0.6 : want === 'urban' ? (ZONES.core + ZONES.urban) / 2
    : want === 'suburb' ? (ZONES.urban + ZONES.suburb) / 2 : want === 'industrial' ? ZONES.urban : ZONES.suburb + 120;
  let made = 0;
  // build the planned streets closest to where this kind of land is wanted
  const plan = around ? [] : ctx.s.roads.plan.filter((pr) => !pr.done && (want === 'rural' ? pr.kind === 'country' : pr.kind !== 'country'));
  const scored = plan.map((pr) => {
    const mx = (pr.ax + pr.bx) / 2, my = (pr.ay + pr.by) / 2;
    let score = Math.abs(Math.hypot(mx - f.cx, my - f.cy) - target) + Math.hypot(mx - f.cx, my - f.cy) * 0.3;
    if (want === 'industrial') score += angDiff(Math.atan2(my - f.cy, mx - f.cx), f.industrialAngle) * 300;
    if (want === 'rural') score = Math.hypot(mx - f.cx, my - f.cy);
    return { pr, score };
  }).sort((a, b) => a.score - b.score);
  let built = 0;
  for (const { pr } of scored) {
    if (built >= maxBuilt) break;
    const n = activate(ctx, pr);
    if (n >= 0) { built++; made += n; }
  }
  if (built > 0) return made;
  // nothing planned is reachable: improvise (side streets, extensions)
  if (want !== 'rural' && !around) {
    for (let k = 0; k < 6 && made < 4; k++) made += splitAndBranch(ctx, f, target);
  }
  for (let k = 0; k < attempts && made < 6; k++) {
    // prefer intersections near the distance band where that zone lives
    let n: RoadNode | undefined, best = Infinity;
    for (let j = 0; j < 8; j++) {
      const c = nodes[Math.floor(ctx.rng.next() * nodes.length)];
      if (c.edges.length >= 4) continue;
      let score = Math.abs(Math.hypot(c.x - f.cx, c.y - f.cy) - target) + ctx.rng.next() * 60;
      if (want === 'industrial') {
        const da = angDiff(Math.atan2(c.y - f.cy, c.x - f.cx), f.industrialAngle);
        score += da * 200;
      }
      if (score < best) { best = score; n = c; }
    }
    if (!n) continue;
    const dirs = edgeDirsAt(ctx, n);
    const base = dirs[Math.floor(ctx.rng.next() * dirs.length)] ?? 0;
    const options = [base + Math.PI, base + Math.PI / 2, base - Math.PI / 2];
    const ang0 = options[Math.floor(ctx.rng.next() * options.length)];
    if (dirs.some((d) => angDiff(d, ang0) < 0.7)) continue;
    const rural = want === 'rural';
    const ang = ang0 + ctx.rng.range(-1, 1) * (rural ? 0.22 : 0.07);
    const len = rural ? ctx.rng.range(110, 150) : ROAD.block * ctx.rng.range(0.85, 1.15);
    let ex = n.x + Math.cos(ang) * len, ey = n.y + Math.sin(ang) * len;
    // continuing straight out of an avenue keeps it an avenue
    const straightFrom = n.edges.map((id) => ctx.edgeById.get(id)!).find((e, i) => angDiff(dirs[i], ang0 + Math.PI) < 0.3 && e.kind === 'avenue');
    let kind: RoadKind = rural ? 'country' : straightFrom ? 'avenue' : 'street';
    if (zoneAt(ctx, ex, ey) === 'rural' && !straightFrom) kind = 'country';
    // join an existing intersection if one is close to where this would end
    let join: RoadNode | undefined;
    for (const o of nodes) {
      if (o.id === n.id || o.edges.length >= 4) continue;
      if (Math.hypot(o.x - ex, o.y - ey) < 24 && !o.edges.some((id) => { const e = ctx.edgeById.get(id)!; return e.a === n!.id || e.b === n!.id; })) {
        // only join where the new road meets the others at a sensible angle
        const back = Math.atan2(n.y - o.y, n.x - o.x);
        if (edgeDirsAt(ctx, o).some((d) => angDiff(d, back) < 0.7)) continue;
        join = o;
        break;
      }
    }
    if (join) { ex = join.x; ey = join.y; }
    if (!roadFits(ctx, n.x, n.y, ex, ey, kind, join ? [n.id, join.id] : [n.id])) continue;
    const end = join ?? addNode(ctx, ex, ey);
    const e = addEdge(ctx, n, end, kind, false);
    clearLotsUnder(ctx, e);
    made += makeLots(ctx, e);
  }
  return made;
}

/** Split a long street at its middle and grow a perpendicular side street from there. */
function splitAndBranch(ctx: Ctx, f: CityFrame, target: number): number {
  const edges = ctx.s.roads.edges;
  let e: RoadEdge | undefined, best = Infinity;
  for (let j = 0; j < 10; j++) {
    const c = edges[Math.floor(ctx.rng.next() * edges.length)];
    if (c.kind === 'country' || c.len < 110) continue;
    const a = ctx.nodeById.get(c.a)!, b = ctx.nodeById.get(c.b)!;
    const score = Math.abs(Math.hypot((a.x + b.x) / 2 - f.cx, (a.y + b.y) / 2 - f.cy) - target) + ctx.rng.next() * 50;
    if (score < best) { best = score; e = c; }
  }
  if (!e) return 0;
  const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  const side = ctx.rng.chance(0.5) ? 1 : -1;
  const ang = dir + side * Math.PI / 2 + ctx.rng.range(-0.06, 0.06);
  const len = ROAD.block * ctx.rng.range(0.85, 1.1);
  const ex = mx + Math.cos(ang) * len, ey = my + Math.sin(ang) * len;
  if (!roadFits(ctx, mx, my, ex, ey, 'street', [e.a, e.b])) return 0;
  // the new road must not run through anything already built at its start
  const box = obb((mx + ex) / 2, (my + ey) / 2, ang, ROAD.street + 2 * ROAD.sidewalk, len);
  const ix = index(ctx);
  for (const id of nearbyIds(ix.lots, mx, my, len)) {
    const l = ctx.lotById.get(id)!;
    if (!clearable(ctx, l) && obbOverlap(box, obb(l.x, l.y, l.angle, l.w, l.d), -0.5)) return 0;
  }
  // split the old edge into two at the middle
  const m = addNode(ctx, mx, my);
  ctx.s.roads.edges = ctx.s.roads.edges.filter((x) => x !== e);
  ctx.edgeById.delete(e.id);
  a.edges = a.edges.filter((id) => id !== e!.id);
  b.edges = b.edges.filter((id) => id !== e!.id);
  ctx.s.roads.ver++;
  indexes.delete(ctx.s.roads);
  // the two halves keep the old road's state (a paved street stays paved)
  const h1 = addEdge(ctx, a, m, e.kind, e.built !== false, e.name);
  const h2 = addEdge(ctx, m, b, e.kind, e.built !== false, e.name);
  if (e.built === false) {
    h1.progress = Math.min(1, (e.progress ?? 0) * 2);
    h2.progress = Math.max(0, (e.progress ?? 0) * 2 - 1);
    h1.paving = h2.paving = e.paving;
  }
  // lots that were on the old edge now belong to whichever half they face
  for (const l of ctx.s.roads.lots) {
    if (l.edge !== e.id) continue;
    if (l.t < 0.5) { l.edge = h1.id; l.t = l.t * 2; } else { l.edge = h2.id; l.t = l.t * 2 - 1; }
  }
  const end = addNode(ctx, ex, ey);
  const ne = addEdge(ctx, m, end, 'street', false);
  clearLotsUnder(ctx, ne);
  return makeLots(ctx, ne) + 1;
}

// ----------------------------------------------------------------- queries

export function lotDoor(l: Lot): [number, number] {
  return [l.x + Math.cos(l.angle) * l.d / 2, l.y + Math.sin(l.angle) * l.d / 2];
}

export function nearestRoadPoint(ctx: Ctx, x: number, y: number, maxR = 400): { edge: RoadEdge; t: number; x: number; y: number; d: number } | null {
  const ix = index(ctx);
  let best: { edge: RoadEdge; t: number; x: number; y: number; d: number } | null = null;
  for (let r = 60; r <= maxR * 2; r *= 2) {
    for (const id of nearbyIds(ix.edges, x, y, r)) {
      const e = ctx.edgeById.get(id)!;
      const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
      const q = pointSegDist(x, y, a.x, a.y, b.x, b.y);
      if (!best || q.d < best.d) best = { edge: e, t: q.t, x: q.x, y: q.y, d: q.d };
    }
    if (best && best.d < r) break;
  }
  return best && best.d <= maxR ? best : null;
}

const routeCaches = new WeakMap<object, { ver: number; m: Map<string, number[] | null> }>();
function routeCache(ctx: Ctx): Map<string, number[] | null> {
  let c = routeCaches.get(ctx.s);
  if (!c || c.ver !== ctx.s.roads.ver) { c = { ver: ctx.s.roads.ver, m: new Map() }; routeCaches.set(ctx.s, c); }
  return c.m;
}

function astar(ctx: Ctx, starts: { node: number; cost: number }[], goals: Map<number, number>, gx: number, gy: number, mode: 'walk' | 'drive' = 'walk'): number[] | null {
  const dirtCost = mode === 'drive' ? 1.8 : 1.05; // cars crawl on dirt tracks
  const ix = index(ctx);
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const open: { n: number; f: number }[] = [];
  const push = (n: number, f: number) => {
    open.push({ n, f });
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p].f <= f) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < open.length && open[l].f < open[m].f) m = l;
        if (r < open.length && open[r].f < open[m].f) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (id: number) => { const n = ctx.nodeById.get(id)!; return Math.hypot(n.x - gx, n.y - gy); };
  for (const s of starts) { g.set(s.node, s.cost); prev.set(s.node, -1); push(s.node, s.cost + h(s.node)); }
  let bestGoal = -1, bestCost = Infinity;
  while (open.length) {
    const { n, f } = pop();
    if (f >= bestCost) break;
    const gn = g.get(n)!;
    if (goals.has(n) && gn + goals.get(n)! < bestCost) { bestCost = gn + goals.get(n)!; bestGoal = n; }
    for (const nb of ix.adj.get(n) ?? []) {
      const ng = gn + (nb.dirt ? nb.cost * dirtCost : nb.cost);
      if (ng < (g.get(nb.to) ?? Infinity)) {
        g.set(nb.to, ng);
        prev.set(nb.to, n);
        push(nb.to, ng + h(nb.to));
      }
    }
  }
  if (bestGoal < 0) return null;
  const out: number[] = [];
  for (let c = bestGoal; c !== -1; c = prev.get(c) ?? -1) out.push(c);
  return out.reverse();
}

/**
 * A route between two points along the roads. Walkers keep to the sidewalk
 * on their right; drivers to the right lane. Returns waypoints [x,y,...]
 * not including the start.
 */
export function route(ctx: Ctx, ax: number, ay: number, bx: number, by: number, mode: 'walk' | 'drive'): number[] {
  const w = ctx.s.world;
  const direct = Math.hypot(bx - ax, by - ay);
  if (direct < 35 && lineClear(w, ax, ay, bx, by)) return [bx, by];
  const ra = nearestRoadPoint(ctx, ax, ay), rb = nearestRoadPoint(ctx, bx, by);
  if (!ra || !rb || (mode === 'walk' && ra.d + rb.d > direct * 0.9)) return wildPath(w, ax, ay, bx, by);
  // centerline points
  const center: { x: number; y: number; e: RoadEdge }[] = [];
  if (ra.edge.id === rb.edge.id) {
    center.push({ x: ra.x, y: ra.y, e: ra.edge }, { x: rb.x, y: rb.y, e: rb.edge });
  } else {
    const ea = ra.edge, eb = rb.edge;
    const na = ctx.nodeById.get(ea.a)!, nb = ctx.nodeById.get(ea.b)!;
    const starts = [
      { node: na.id, cost: Math.hypot(na.x - ra.x, na.y - ra.y) },
      { node: nb.id, cost: Math.hypot(nb.x - ra.x, nb.y - ra.y) },
    ];
    const ga = ctx.nodeById.get(eb.a)!, gb = ctx.nodeById.get(eb.b)!;
    const goals = new Map([[ga.id, Math.hypot(ga.x - rb.x, ga.y - rb.y)], [gb.id, Math.hypot(gb.x - rb.x, gb.y - rb.y)]]);
    // the way between two streets is looked up once and remembered (until the roads change)
    const cache = routeCache(ctx);
    const key = (mode === 'drive' ? 'd' : 'w') + ea.id + ':' + eb.id;
    let found = cache.get(key);
    if (found === undefined) {
      found = astar(ctx, starts, goals, rb.x, rb.y, mode);
      if (cache.size > 40000) cache.clear();
      cache.set(key, found);
    }
    if (!found) return wildPath(w, ax, ay, bx, by);
    // a remembered way may start (or end) at the far end of this street: don't walk there and back
    let nodes = found;
    if (nodes.length >= 2 && (nodes[1] === ea.a || nodes[1] === ea.b) && (nodes[0] === ea.a || nodes[0] === ea.b)) nodes = nodes.slice(1);
    const nl = nodes.length;
    if (nl >= 2 && (nodes[nl - 2] === eb.a || nodes[nl - 2] === eb.b) && (nodes[nl - 1] === eb.a || nodes[nl - 1] === eb.b)) nodes = nodes.slice(0, -1);
    center.push({ x: ra.x, y: ra.y, e: ea });
    for (let i = 0; i < nodes.length; i++) {
      const n = ctx.nodeById.get(nodes[i])!;
      let e = ea;
      if (i + 1 < nodes.length) {
        const nid = nodes[i + 1];
        e = n.edges.map((id) => ctx.edgeById.get(id)!).find((x) => x.a === nid || x.b === nid) ?? ea;
      } else e = eb;
      center.push({ x: n.x, y: n.y, e });
    }
    center.push({ x: rb.x, y: rb.y, e: eb });
  }
  // offset to the right of the direction of travel
  const pts: number[] = [];
  for (let i = 0; i + 1 < center.length; i++) {
    const p = center[i], q = center[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 0.5) continue;
    const dx = (q.x - p.x) / len, dy = (q.y - p.y) / len;
    const off = mode === 'walk' ? p.e.width / 2 + sidewalkOf(p.e.kind) * 0.55 : p.e.width / 4;
    const rx = dy * off, ry = -dx * off; // right-hand side
    pts.push(p.x + rx, p.y + ry, q.x + rx, q.y + ry);
  }
  // cars stop at the curb on the destination's side (the driver walks the last bit); people walk to the door
  if (mode === 'drive') {
    const c = curbAt(rb.edge, rb.x, rb.y, bx, by);
    pts.push(c.x, c.y);
  } else pts.push(bx, by);
  return pts;
}

/** A point at the curb of road edge `e` near (x, y) on the side facing (tx, ty): where a car pulls over. */
function curbAt(e: RoadEdge, x: number, y: number, tx: number, ty: number): { x: number; y: number } {
  const off = Math.max(1.2, e.width / 2 - 1.3);
  const nx = tx - x, ny = ty - y, n = Math.hypot(nx, ny) || 1;
  return { x: x + (nx / n) * off, y: y + (ny / n) * off };
}

/**
 * Where a car parks for a building: at the curb in front of it, the n-th car
 * a few metres further along the street (facing along the street).
 */
export function curbSpot(ctx: Ctx, tx: number, ty: number, n: number): { x: number; y: number; heading: number } | null {
  const r = nearestRoadPoint(ctx, tx, ty, 120);
  if (!r) return null;
  const a = ctx.nodeById.get(r.edge.a)!, b = ctx.nodeById.get(r.edge.b)!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  // spread along the street, staying off the ends of the block
  const along = ((n % 2 ? 1 : -1) * Math.ceil(n / 2)) * 6;
  const t = Math.max(6, Math.min(len - 6, r.t * len + along));
  const px = a.x + ux * t, py = a.y + uy * t;
  const c = curbAt(r.edge, px, py, tx, ty);
  return { x: c.x, y: c.y, heading: Math.atan2(uy, ux) };
}

/** Lots for sale by zone, recomputed at most once per minute. */
const saleCache = new WeakMap<object, { t: number; n: number; byZone: Map<Zone, Lot[]> }>();

/** Empty lots of some zones that their owners (the government, the Territory or anyone) are selling. */
export function lotsForSale(ctx: Ctx, zones: Zone[]): Lot[] {
  let c = saleCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick || c.n !== ctx.s.roads.lots.length) {
    const byZone = new Map<Zone, Lot[]>();
    for (const l of ctx.s.roads.lots) {
      if (l.building >= 0 || l.forSale <= 0) continue;
      const a = byZone.get(l.zone);
      if (a) a.push(l); else byZone.set(l.zone, [l]);
    }
    c = { t: ctx.s.tick, n: ctx.s.roads.lots.length, byZone };
    saleCache.set(ctx.s, c);
  }
  // a lot bought this minute isn't for sale anymore
  const out: Lot[] = [];
  for (const z of zones) for (const l of c.byZone.get(z) ?? []) if (l.building < 0 && l.forSale > 0) out.push(l);
  return out;
}

/** Mark the road network as changed so the index and renderer pick it up. */
export function touchRoads(ctx: Ctx): void {
  ctx.s.roads.ver++;
  indexes.delete(ctx.s.roads);
}

export function markLotUsed(ctx: Ctx, l: Lot): void {
  const w = ctx.s.world;
  const r = Math.hypot(l.w, l.d) / 2;
  for (let x = l.x - r; x <= l.x + r; x += w.tile / 2) {
    for (let y = l.y - r; y <= l.y + r; y += w.tile / 2) {
      // only tiles inside the lot rectangle
      const dx = x - l.x, dy = y - l.y;
      const along = dx * Math.cos(l.angle) + dy * Math.sin(l.angle);
      const across = dx * Math.sin(l.angle) - dy * Math.cos(l.angle);
      if (Math.abs(along) <= l.d / 2 && Math.abs(across) <= l.w / 2) useTile(w, tileOf(w, x, y));
    }
  }
}
