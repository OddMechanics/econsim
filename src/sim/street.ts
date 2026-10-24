// Street furniture layout: where the street lamps, benches, bins, hydrants,
// bus stops and street trees stand along the paved streets. Pure and
// deterministic (no rendering), so the simulation and the renderer agree on
// every spot: a flyer taped to a lamp is drawn on that lamp's pole, and a
// person sitting on a bench sits where the bench is drawn.
//
// Only paved town streets (built !== false, not country roads) get lamps and
// furniture; dirt tracks wait until they're paved. Spots keep clear of
// intersections: the curb corner at a junction is a fillet tangent to both
// roads (the renderer draws it the same way), so each side of a street starts
// a little past where that fillet ends, and nothing stands where a merging
// road's band would be.
//
// Results are cached per `roads.ver`, so calling these every tick is cheap.

import { hash2 } from './rng';
import { sidewalkOf } from './roads';
import type { RoadEdge, RoadNode, Roads, Zone } from './types';

/** Facing: `dir` is the direction (atan2 in sim x/y) from the spot toward the road's centerline. */
export interface LampSpot {
  x: number;
  y: number;
  /** Direction toward the road (radians, sim x/y plane). */
  dir: number;
  edge: number;
  /** 1 = left of the edge's a→b direction, -1 = right. */
  side: 1 | -1;
  /** Distance from node a along the edge (m). */
  s: number;
}

export type FurnitureKind = 'bench' | 'bin' | 'hydrant' | 'busstop' | 'tree';

export interface FurnitureSpot extends LampSpot {
  kind: FurnitureKind;
  /** Street trees in dense zones stand in a cast-iron grate (render detail). */
  grate?: boolean;
}

/** Distance of lamp poles from the road's centerline beyond the asphalt edge (m). */
export const LAMP_INSET = 0.5;
const LAMP_SPACING = 30;

/** Roads without curbs or sidewalks: country roads and unpaved (dirt) tracks. */
export function roughRoad(e: Pick<RoadEdge, 'kind' | 'built'>): boolean {
  return e.kind === 'country' || e.built === false;
}

/** Shoulder/sidewalk width the renderer uses next to the road surface. */
export function shoulderOf(e: Pick<RoadEdge, 'kind' | 'built'>): number {
  return e.kind === 'country' ? sidewalkOf('country') : e.built === false ? 0.9 : sidewalkOf(e.kind);
}

/** A paved town street (has sidewalks, lamps and furniture). */
export function pavedStreet(e: Pick<RoadEdge, 'kind' | 'built'>): boolean {
  return e.kind !== 'country' && e.built !== false;
}

interface EdgeLayout { key: number; lamps: LampSpot[]; furniture: FurnitureSpot[] }
interface Layout { ver: number; lamps: LampSpot[]; furniture: FurnitureSpot[]; edges: Map<number, EdgeLayout> }
const cache = new WeakMap<Roads, Layout>();

/** Street lamp positions on paved streets (cached by `roads.ver`). */
export function streetLamps(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>): LampSpot[] {
  return layout(roads, nodeById, edgeById).lamps;
}

/** Benches, bins, hydrants, bus stops and street trees on paved streets (cached by `roads.ver`). */
export function streetFurniture(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>): FurnitureSpot[] {
  return layout(roads, nodeById, edgeById).furniture;
}

/** The nearest lamp to a point (linear scan; fine for occasional queries). */
export function nearestLamp(lamps: LampSpot[], x: number, y: number): LampSpot | undefined {
  let best: LampSpot | undefined, bd = Infinity;
  for (const l of lamps) {
    const d = (l.x - x) ** 2 + (l.y - y) ** 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

// ------------------------------------------------------------------ layout

const DENSITY: Record<Zone, number> = { core: 4, urban: 3, suburb: 2, industrial: 1, rural: 0 };

/**
 * Lay out every paved street. Each street's spots depend only on its own
 * geometry, zone and the roads at its two ends, so they're cached per edge
 * under a hash of exactly that; a version bump from paving progress or new
 * lots elsewhere recomputes nothing and returns the same arrays.
 */
function layout(roads: Roads, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>): Layout {
  const hit = cache.get(roads);
  if (hit && hit.ver === roads.ver) return hit;
  // zone of each street: the densest zone of the lots along it
  const zoneOf = new Map<number, Zone>();
  for (const l of roads.lots) {
    const z = zoneOf.get(l.edge);
    if (!z || DENSITY[l.zone] > DENSITY[z]) zoneOf.set(l.edge, l.zone);
  }
  const prev = hit?.edges;
  const edges = new Map<number, EdgeLayout>();
  let changed = !prev;
  for (const e of roads.edges) {
    if (!pavedStreet(e)) continue;
    const A = nodeById.get(e.a), B = nodeById.get(e.b);
    if (!A || !B) continue;
    const zone = zoneOf.get(e.id) ?? (e.kind === 'avenue' ? 'urban' : 'suburb');
    const key = edgeKey(e, A, B, zone, nodeById, edgeById);
    const old = prev?.get(e.id);
    if (old && old.key === key) { edges.set(e.id, old); continue; }
    changed = true;
    const el: EdgeLayout = { key, lamps: [], furniture: [] };
    layoutEdge(e, A, B, zone, nodeById, edgeById, el.lamps, el.furniture);
    edges.set(e.id, el);
  }
  if (prev && prev.size !== edges.size) changed = true;
  if (hit && !changed) {
    hit.ver = roads.ver;
    hit.edges = edges;
    return hit;
  }
  const lamps: LampSpot[] = [], furniture: FurnitureSpot[] = [];
  for (const el of edges.values()) {
    for (const l of el.lamps) lamps.push(l);
    for (const f of el.furniture) furniture.push(f);
  }
  const out = { ver: roads.ver, lamps, furniture, edges };
  cache.set(roads, out);
  return out;
}

const KIND_CODE = { avenue: 1, street: 2, country: 3 } as const;

/** Hash of everything a street's layout depends on (its geometry and zone, and the roads at both ends). */
function edgeKey(e: RoadEdge, A: RoadNode, B: RoadNode, zone: Zone, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193); h ^= h >>> 13; };
  const pos = (n: RoadNode) => { mix(Math.round(n.x * 256)); mix(Math.round(n.y * 256)); };
  mix(e.id); mix(KIND_CODE[e.kind]); mix(Math.round(e.width * 100)); mix(DENSITY[zone]); mix(Math.round(e.len * 256));
  pos(A); pos(B);
  for (const n of [A, B]) {
    for (const id of n.edges) {
      if (id === e.id) continue;
      const o = edgeById.get(id);
      if (!o) continue;
      const far = nodeById.get(o.a === n.id ? o.b : o.a);
      mix(id); mix(KIND_CODE[o.kind]); mix(Math.round(o.width * 100)); mix(o.built === false ? 1 : 0); mix(Math.round(o.len * 256));
      if (far) pos(far);
    }
    mix(-1);
  }
  return h;
}

/** Other roads at a node, as directions away from it. */
interface Nb { e: RoadEdge; ang: number; hw: number; sw: number; rough: boolean; ax: number; ay: number; bx: number; by: number }

function neighbors(node: RoadNode, self: RoadEdge, nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>): Nb[] {
  const out: Nb[] = [];
  for (const id of node.edges) {
    if (id === self.id) continue;
    const o = edgeById.get(id);
    if (!o || o.a === o.b) continue;
    const far = nodeById.get(o.a === node.id ? o.b : o.a);
    if (!far || Math.hypot(far.x - node.x, far.y - node.y) < 0.5) continue;
    out.push({
      e: o, ang: Math.atan2(far.y - node.y, far.x - node.x), hw: o.width / 2, sw: shoulderOf(o), rough: roughRoad(o),
      ax: node.x, ay: node.y, bx: far.x, by: far.y,
    });
  }
  return out;
}

/**
 * How far from `node` each side of an edge stays clear of the junction:
 * [left of the arm, right of the arm] as seen leaving the node. Mirrors the
 * renderer's curb fillets (radius 4.5 m, or 5.5 m next to a rough road).
 */
function setbacks(ang: number, e: RoadEdge, nbs: Nb[]): [number, number] {
  if (!nbs.length) return [2, 2]; // dead end
  const hw = e.width / 2, sw = shoulderOf(e), rough = roughRoad(e);
  const maxT = Math.min(e.len * 0.45, 45);
  const corner = (o: Nb, alpha: number): number => {
    // alpha: angle from this arm to the neighbor, measured toward the side in question (0..2pi)
    if (alpha >= Math.PI - 0.02) return 1.5; // curbs diverge: the sidewalk runs around the corner
    const s = Math.sin(alpha), c = Math.cos(alpha);
    const R0 = rough && o.rough ? 7 : rough || o.rough ? 5.5 : 4.5;
    const oMax = Math.min(o.e.len * 0.45, 45);
    for (const R of [R0, R0 * 0.6, Math.max(sw, o.sw) + 0.5]) {
      const oa = hw + R, ob = o.hw + R;
      const t = (oa * c + ob) / s; // foot of the fillet on this arm
      const u = (ob * c + oa) / s; // ... on the neighbor
      if (t < 0 || u < 0) break;
      if (t <= maxT && u <= oMax) return t + 2;
    }
    // merging at a sharp angle: clear once the two sidewalks have separated
    return ((hw + sw) * c + o.hw + o.sw) / s + 2;
  };
  let left = 1.5, right = 1.5;
  for (const o of nbs) {
    let ccw = o.ang - ang;
    while (ccw <= 0) ccw += Math.PI * 2;
    while (ccw > Math.PI * 2) ccw -= Math.PI * 2;
    left = Math.max(left, corner(o, ccw));
    right = Math.max(right, corner(o, Math.PI * 2 - ccw));
  }
  return [Math.min(left, e.len), Math.min(right, e.len)];
}

/** Distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

function layoutEdge(
  e: RoadEdge, A: RoadNode, B: RoadNode, zone: Zone,
  nodeById: Map<number, RoadNode>, edgeById: Map<number, RoadEdge>,
  lamps: LampSpot[], furniture: FurnitureSpot[],
): void {
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (len < 6) return;
  const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len, nx = -uy, ny = ux;
  const hw = e.width / 2, sw = shoulderOf(e);
  const nbA = neighbors(A, e, nodeById, edgeById), nbB = neighbors(B, e, nodeById, edgeById);
  const [aL, aR] = setbacks(Math.atan2(uy, ux), e, nbA);
  const [bL, bR] = setbacks(Math.atan2(-uy, -ux), e, nbB);
  // usable range per side (side 1 = left of a→b: the arm's left at A, its right at B)
  const range = (side: number): [number, number] => side === 1 ? [aL, len - bR] : [aR, len - bL];
  const others = [...nbA, ...nbB];
  const taken: { s: number; side: number; r: number }[] = [];
  const free = (s: number, side: number, off: number, r: number): boolean => {
    const [s0, s1] = range(side);
    if (s - r < s0 || s + r > s1) return false;
    const x = A.x + ux * s + nx * side * off, y = A.y + uy * s + ny * side * off;
    for (const o of others) if (segDist(x, y, o.ax, o.ay, o.bx, o.by) < o.hw + o.sw + 0.6 + r * 0.5) return false;
    for (const t of taken) if (t.side === side && Math.abs(t.s - s) < t.r + r) return false;
    return true;
  };
  const spot = (s: number, side: 1 | -1, off: number) => ({
    x: A.x + ux * s + nx * side * off, y: A.y + uy * s + ny * side * off,
    dir: Math.atan2(-ny * side, -nx * side), edge: e.id, side, s,
  });
  const h = (k: number, salt: number) => hash2(e.id, k, salt);

  // ---- lamps: evenly spaced, alternating sides
  const lampOff = hw + LAMP_INSET;
  const s0 = Math.min(range(1)[0], range(-1)[0]), s1 = Math.max(range(1)[1], range(-1)[1]);
  const L = s1 - s0;
  if (L >= 2) {
    const count = Math.max(1, Math.round(L / LAMP_SPACING));
    for (let k = 0; k < count; k++) {
      const s = s0 + ((k + 0.5) * L) / count;
      let side: 1 | -1 = (k + e.id) & 1 ? 1 : -1;
      if (!free(s, side, lampOff, 0.3)) side = side === 1 ? -1 : 1;
      if (!free(s, side, lampOff, 0.3)) continue;
      lamps.push(spot(s, side, lampOff));
      taken.push({ s, side, r: 1.2 });
    }
  }

  const dense = zone === 'core' || zone === 'urban';
  const put = (kind: FurnitureKind, s: number, side: 1 | -1, off: number, r: number, extra?: Partial<FurnitureSpot>): boolean => {
    if (!free(s, side, off, r)) return false;
    furniture.push({ kind, ...spot(s, side, off), ...extra });
    taken.push({ s, side, r });
    return true;
  };
  const back = hw + sw - 0.55; // back of the sidewalk (benches, shelters face the road)

  // ---- bus stop: on avenues and some busy streets, mid-block
  const busChance = e.kind === 'avenue' ? (zone === 'industrial' ? 0.3 : 0.6) : dense ? 0.12 : zone === 'suburb' ? 0.06 : 0;
  if (len > 40 && h(0, 11) < busChance) {
    const side: 1 | -1 = h(1, 11) < 0.5 ? 1 : -1;
    const mid = len * (0.4 + 0.2 * h(2, 11));
    for (const s of [mid, mid + 6, mid - 6, mid + 12]) {
      if (put('busstop', s, side, hw + sw - 0.8, 2.3)) {
        put('bin', s + 2.9, side, back + 0.1, 0.4);
        break;
      }
    }
  }

  // ---- hydrant: one per street, near an end
  if (zone !== 'rural' && len > 14) {
    const side: 1 | -1 = h(3, 12) < 0.5 ? 1 : -1;
    const [r0, r1] = range(side);
    const fromA = h(4, 12) < 0.5;
    for (let k = 0; k < 4; k++) {
      const s = fromA ? r0 + 1.5 + k * 2 : r1 - 1.5 - k * 2;
      if (put('hydrant', s, side, hw + 0.35, 0.35)) break;
    }
  }

  // ---- benches (with a bin) in dense zones, the odd one in suburbs
  const benchEvery = zone === 'core' ? 34 : zone === 'urban' ? 48 : 0;
  if (benchEvery > 0 && len > 20) {
    for (const side of [1, -1] as const) {
      const [r0, r1] = range(side);
      const n = Math.floor((r1 - r0) / benchEvery);
      for (let k = 0; k < n; k++) {
        if (h(10 + k, side === 1 ? 13 : 14) < 0.25) continue;
        const s = r0 + (k + 0.5 + (h(30 + k, side === 1 ? 15 : 16) - 0.5) * 0.4) * ((r1 - r0) / n);
        if (put('bench', s, side, back, 1.0)) {
          if (h(50 + k, 17) < 0.7) put('bin', s + 1.6, side, back + 0.05, 0.35);
        }
      }
    }
  } else if (zone === 'suburb' && len > 30 && h(5, 18) < 0.25) {
    const side: 1 | -1 = h(6, 18) < 0.5 ? 1 : -1;
    const [r0, r1] = range(side);
    put('bench', (r0 + r1) / 2, side, back, 1.0);
  }

  // ---- street trees near the curb, between lamps
  const treeEvery = zone === 'core' ? 11 : zone === 'urban' ? 12 : zone === 'suburb' ? 15 : 0;
  if (treeEvery > 0) {
    const treeOff = hw + (dense ? 1.0 : 1.1);
    const skip = zone === 'suburb' ? 0.35 : 0.12;
    for (const side of [1, -1] as const) {
      const [r0, r1] = range(side);
      const span = r1 - r0 - 8; // clear of the crosswalks
      if (span < 2) continue;
      const n = Math.max(1, Math.floor(span / treeEvery));
      for (let k = 0; k <= n; k++) {
        if (h(100 + k, side === 1 ? 19 : 20) < skip) continue;
        const s = r0 + 4 + (k * span) / Math.max(1, n);
        put('tree', s, side, treeOff, 1.6, { grate: dense });
      }
    }
  }
}
