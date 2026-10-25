// The countryside around the city: the 2 km of farmland, farmsteads and
// villages between the city's square and the edge of the map.
//
// It's laid out once, when the world begins (or the first time an older city
// is loaded): Route 9 carries on to the edge of the map, country lanes about
// a kilometre apart cross the farmland, and along them lie the farms (a
// farmhouse by the lane, the fields behind it). A few villages sit at
// crossroads, each with a shop, a pub and houses. Some of the farms are worked
// by farm families from the start; the rest of the land is the Territory's,
// for sale to anyone who wants to farm it.
//
// The people out here live a simpler life, and are a simpler program (see
// decideCountry in ai.ts): fewer choices, a handful of places they know,
// updated less often. That's what lets the countryside hold many more people
// than the same number of city people would cost.

import { COUNTRY, MAP, MINUTES_PER_DAY, POPULATION, WAGES } from './config';
import { log, type Ctx } from './ctx';
import { BUILDINGS, ROLE } from './goods';
import { createBuilding } from './buildings';
import { establishFirm } from './firms';
import { moveIn, moveOut } from './housing';
import { hire, postJob } from './jobs';
import { cityName } from './names';
import { createPerson } from './people';
import { hash2 } from './rng';
import { addEdge, addLotAt, addNode, layHighway, nodeNear, roadFits } from './roads';
import { beyondGrid, fertilityAt, inGrid, kindAt, mapSize, onLand } from './world';
import type { Building, BuildingKind, Lot, Person, RoadEdge, RoadNode } from './types';

/** Is this place out in the countryside (beyond the city's square)? */
export function inCountry(ctx: Ctx, x: number, y: number): boolean {
  return !inGrid(ctx.s.world, x, y);
}

/** Do they live the countryside's simpler life? (Everyone whose home is out there.) */
export function isRural(ctx: Ctx, p: Person): boolean {
  const h = ctx.bById.get(p.home);
  return !!h && !inGrid(ctx.s.world, h.x, h.y);
}

const LANES = ['Mill', 'Oak', 'Hollow', 'Brook', 'Meadow', 'Orchard', 'Barley', 'Clover', 'Willow', 'Hawthorn', 'Fox', 'Heron',
  'Stone', 'Chapel', 'Elm', 'Ridge', 'Kiln', 'Linden', 'Ash', 'Bramble', 'Hay', 'Sheep', 'Pond', 'Beech', 'Furrow', 'Lark', 'Thistle', 'Copper'];

function laneName(i: number): string {
  return `${LANES[i % LANES.length]} ${i < LANES.length ? 'Lane' : 'Road'}`;
}

interface Village { name: string; node: RoadNode; lots: Lot[] }
interface Farmstead { house: Lot; field: Lot }

/** Lay out the countryside (once). */
export function generateCountryside(ctx: Ctx): void {
  const s = ctx.s;
  if (s.data?.country) return;
  s.world.seed ??= s.seed;
  extendHighway(ctx);
  layLanes(ctx);
  const villages = placeVillages(ctx);
  const steads = divideFarmland(ctx);
  const n = settle(ctx, villages, steads);
  s.data = { ...(s.data ?? {}), country: 1 };
  log(ctx, 'event', `Around the city lies farm country: ${n.farms} working farms and the villages of ${villages.map((v) => v.name).join(', ')}, ${n.people} people in all. Route 9 runs on through the fields to the rest of the world.`);
}

// ------------------------------------------------------------------ roads

/** Route 9 carries on from the edge of the city's square to the edge of the map. */
function extendHighway(ctx: Ctx): void {
  const s = ctx.s;
  const far: { x: number; y: number }[] = [];
  // its ends (and the ends of Main Street where the highway never got out of town)
  const isEnd = (n: RoadNode, name: string) => n.edges.length === 1 && ctx.edgeById.get(n.edges[0])?.name === name;
  const ends = s.roads.nodes.filter((n) => isEnd(n, 'Route 9') || isEnd(n, 'Main Street'));
  for (const n of ends) {
    // stuck right away (a lake at the edge of the square)? branch off a little further back instead
    let from: RoadNode | undefined = n, back: RoadNode | undefined;
    for (let k = 0; k < 5 && from; k++) {
      const e = ctx.edgeById.get(from.edges.find((id) => { const x = ctx.edgeById.get(id)!; return (x.a === from!.id ? x.b : x.a) !== back?.id; }) ?? -1);
      const o: RoadNode | undefined = e ? ctx.nodeById.get(e.a === from.id ? e.b : e.a) : undefined;
      const ref = k === 0 ? o : back;
      if (!ref) break;
      const dir = Math.atan2(n.y - ref.y, n.x - ref.x);
      const c = Math.cos(dir), sn = Math.sin(dir), lo = MAP.min + 30, hi = MAP.max - 30;
      const t = Math.min(c > 0 ? (hi - from.x) / c : c < 0 ? (lo - from.x) / c : Infinity, sn > 0 ? (hi - from.y) / sn : sn < 0 ? (lo - from.y) / sn : Infinity);
      const end = layHighway(ctx, from, from.x + c * t, from.y + sn * t);
      if (end !== from) { if (!onLand(end.x, end.y, 300)) far.push({ x: end.x, y: end.y }); break; }
      back = from;
      from = o;
    }
  }
  if (far.length) s.farGates = far;
}

/**
 * Country lanes on a loose grid about a kilometre apart (jittered, with a
 * bend or two and a few gaps), joined to the highway and to the ends of the
 * city's planned country roads.
 */
function layLanes(ctx: Ctx): void {
  const s = ctx.s, w = s.world, seed = s.seed;
  const S = mapSize(w), L = COUNTRY.laneSpacing;
  const nearCity = (x: number, y: number, m: number) => x > -m && y > -m && x < S + m && y < S + m;
  const xs: number[] = [];
  for (let x = MAP.min + 350; x <= MAP.max - 349; x += L) xs.push(x);
  const N = xs.length;
  const pt: ([number, number] | null)[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = xs[i] + (hash2(i, j, seed + 301) - 0.5) * 320, y = xs[j] + (hash2(i, j, seed + 302) - 0.5) * 320;
      pt.push(nearCity(x, y, 170) || !onLand(x, y, 120) || kindAt(w, x, y) === 'water' ? null : [x, y]);
    }
  }
  const made = new Map<number, RoadNode>();
  const nodeAt = (k: number): RoadNode => {
    let n = made.get(k);
    if (!n) { const [x, y] = pt[k]!; n = nodeNear(ctx, x, y, 3) ?? addNode(ctx, x, y); made.set(k, n); }
    return n;
  };
  let names = 0;
  const lay = (way: [number, number][], from: RoadNode | undefined, to: RoadNode | undefined, name: string, start: () => RoadNode, end: () => RoadNode): boolean => {
    for (let k = 0; k + 1 < way.length; k++) {
      const [ax, ay] = way[k], [bx, by] = way[k + 1];
      for (let f = 0; f <= 1; f += 0.1) if (nearCity(ax + (bx - ax) * f, ay + (by - ay) * f, 110) && !(k === way.length - 2 && to && f > 0.8)) return false;
      const ignore: number[] = [];
      if (k === 0 && from) ignore.push(from.id);
      if (k === way.length - 2 && to) ignore.push(to.id);
      if (!roadFits(ctx, ax, ay, bx, by, 'country', ignore)) return false;
    }
    let prev = start();
    for (let k = 1; k < way.length; k++) {
      const n = k === way.length - 1 ? end() : addNode(ctx, way[k][0], way[k][1]);
      addEdge(ctx, prev, n, 'country', true, name);
      prev = n;
    }
    return true;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const a = j * N + i, i2 = i + di, j2 = j + dj;
        if (i2 >= N || j2 >= N) continue;
        const b = j2 * N + i2;
        if (!pt[a] || !pt[b] || hash2(a, b, seed + 303) < 0.12) continue;
        const [ax, ay] = pt[a]!, [bx, by] = pt[b]!;
        const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
        const way: [number, number][] = [[ax, ay]];
        for (const f of [1 / 3, 2 / 3]) {
          const o = (hash2(a * 3 + Math.round(f * 3), b, seed + 304) - 0.5) * 70;
          way.push([ax + (bx - ax) * f + nx * o, ay + (by - ay) * f + ny * o]);
        }
        way.push([bx, by]);
        if (lay(way, made.get(a), made.get(b), laneName(names), () => nodeAt(a), () => nodeAt(b))) names++;
      }
    }
  }
  // where the lanes come close to the highway, they join it
  const highway = s.roads.nodes.filter((n) => !inGrid(w, n.x, n.y) && n.edges.some((id) => ctx.edgeById.get(id)?.name === 'Route 9'));
  for (const n of made.values()) {
    const best = highway.map((h) => ({ h, d: Math.hypot(h.x - n.x, h.y - n.y) })).filter((c) => c.d < 700).sort((p, q) => p.d - q.d)[0];
    if (!best) continue;
    const name = ctx.edgeById.get(n.edges[0] ?? -1)?.name ?? laneName(names++);
    lay([[n.x, n.y], [best.h.x, best.h.y]], n, best.h, name, () => n, () => best.h);
  }
  // the ends of the city's planned country roads: a lane waits there for the city to reach it
  const ends = new Map<string, { x: number; y: number; d: number }>();
  for (const pr of s.roads.plan) {
    if (pr.kind !== 'country' || !pr.name) continue;
    const d = Math.hypot(pr.bx - s.center.x, pr.by - s.center.y);
    if (d > (ends.get(pr.name)?.d ?? 0)) ends.set(pr.name, { x: pr.bx, y: pr.by, d });
  }
  const lattice = [...made.values()];
  for (const [name, e] of ends) {
    const best = lattice.map((n) => ({ n, d: Math.hypot(n.x - e.x, n.y - e.y) })).filter((c) => c.d < 1100).sort((p, q) => p.d - q.d)[0];
    if (!best) continue;
    const stub = nodeNear(ctx, e.x, e.y, 3);
    if (!roadFits(ctx, best.n.x, best.n.y, e.x, e.y, 'country', stub ? [best.n.id, stub.id] : [best.n.id])) continue;
    addEdge(ctx, best.n, stub ?? addNode(ctx, e.x, e.y), 'country', true, name);
  }
  joinUp(ctx, lattice, names);
  pruneUnreached(ctx);
}

/** The nodes reachable by road from Main Street. */
function reached(ctx: Ctx): Set<number> {
  const start = ctx.s.roads.nodes.find((n) => n.edges.some((id) => ctx.edgeById.get(id)?.name === 'Main Street'));
  const seen = new Set<number>();
  if (!start) return seen;
  seen.add(start.id);
  const queue = [start];
  while (queue.length) {
    const n = queue.pop()!;
    for (const id of n.edges) {
      const e = ctx.edgeById.get(id)!;
      const o = e.a === n.id ? e.b : e.a;
      if (!seen.has(o)) { seen.add(o); queue.push(ctx.nodeById.get(o)!); }
    }
  }
  return seen;
}

/** Stretches of lanes with no way to town get a lane to the nearest road that has one. */
function joinUp(ctx: Ctx, lattice: RoadNode[], names: number): void {
  for (let round = 0; round < 12; round++) {
    const seen = reached(ctx);
    const cut = lattice.filter((n) => !seen.has(n.id) && n.edges.length);
    if (!cut.length) return;
    const linked = ctx.s.roads.nodes.filter((n) => seen.has(n.id) && !inGrid(ctx.s.world, n.x, n.y));
    let best: { a: RoadNode; b: RoadNode; d: number } | null = null;
    for (const a of cut) for (const b of linked) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 1500 && (!best || d < best.d) && roadFits(ctx, a.x, a.y, b.x, b.y, 'country', [a.id, b.id])) best = { a, b, d };
    }
    if (!best) return;
    addEdge(ctx, best.a, best.b, 'country', true, laneName(names + round));
  }
}

/** Lanes that ended up cut off from everything (no way to the highway) are dropped. */
function pruneUnreached(ctx: Ctx): void {
  const s = ctx.s;
  const seen = reached(ctx);
  if (!seen.size) return;
  const drop = new Set(s.roads.edges.filter((e) => !seen.has(e.a) && !inGrid(s.world, ctx.nodeById.get(e.a)!.x, ctx.nodeById.get(e.a)!.y)).map((e) => e.id));
  if (!drop.size) return;
  s.roads.edges = s.roads.edges.filter((e) => !drop.has(e.id));
  for (const id of drop) ctx.edgeById.delete(id);
  for (const n of s.roads.nodes) n.edges = n.edges.filter((id) => !drop.has(id));
  const gone = new Set(s.roads.nodes.filter((n) => !n.edges.length && !seen.has(n.id)).map((n) => n.id));
  s.roads.nodes = s.roads.nodes.filter((n) => !gone.has(n.id));
  for (const id of gone) ctx.nodeById.delete(id);
  s.roads.ver++;
}

// --------------------------------------------------------------- villages

/** A few villages at country crossroads, far apart: a couple of short streets of small lots. */
function placeVillages(ctx: Ctx): Village[] {
  const s = ctx.s, w = s.world;
  const away = (n: RoadNode) => beyondGrid(w, n.x, n.y);
  const cands = s.roads.nodes.filter((n) => n.edges.length >= 3 && away(n) > 550 && onLand(n.x, n.y, 300));
  const picked: RoadNode[] = [];
  for (let k = 0; k < COUNTRY.villages && cands.length; k++) {
    // as far from the others (and the city) as possible, a little randomness
    let best: RoadNode | undefined, bs = -Infinity;
    for (const c of cands) {
      if (picked.includes(c)) continue;
      const others = picked.length ? Math.min(...picked.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) : 2000;
      const hw = c.edges.some((id) => ctx.edgeById.get(id)?.name === 'Route 9') ? 400 : 0;
      const sc = Math.min(others, 2600) + hw - away(c) * 0.3 + hash2(c.id, k, s.seed + 311) * 300;
      if (sc > bs) { bs = sc; best = c; }
    }
    if (!best) break;
    picked.push(best);
  }
  const out: Village[] = [];
  for (const node of picked) {
    const name = cityName(ctx.rng);
    const v: Village = { name, node, lots: [] };
    // two short village streets, into the widest gaps between the roads already there
    const dirs = node.edges.map((id) => { const e = ctx.edgeById.get(id)!; const o = ctx.nodeById.get(e.a === node.id ? e.b : e.a)!; return Math.atan2(o.y - node.y, o.x - node.x); }).sort((p, q) => p - q);
    const gaps = dirs.map((d, i) => { const nx = i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + Math.PI * 2; return { mid: (d + nx) / 2, size: nx - d }; }).sort((p, q) => q.size - p.size);
    const streets: RoadEdge[] = [];
    for (const g of gaps.slice(0, 2)) {
      if (g.size < 1.1) continue;
      const len = 150 + ctx.rng.next() * 30;
      const x = node.x + Math.cos(g.mid) * len, y = node.y + Math.sin(g.mid) * len;
      if (!onLand(x, y, 40) || !roadFits(ctx, node.x, node.y, x, y, 'street', [node.id])) continue;
      const end = addNode(ctx, x, y);
      streets.push(addEdge(ctx, node, end, 'street', true, streets.length ? 'Church Lane' : `${name} Street`));
    }
    // small lots along the village streets and the first stretch of each road out of the village
    const along = (e: RoadEdge, fromNode: boolean, reach: number) => {
      const fromA = e.a === node.id;
      for (const side of [1, -1] as const) {
        for (let pos = 14; pos + 10 < Math.min(reach, e.len - 12); pos += 21.5) {
          const t = fromA === fromNode ? pos + 10 : e.len - pos - 10;
          const lot = addLotAt(ctx, e, side, t, 20, 28, 'suburb', (x, y) => !inGrid(w, x, y));
          if (lot) v.lots.push(lot);
        }
      }
    };
    for (const e of streets) along(e, true, e.len);
    for (const id of node.edges) { const e = ctx.edgeById.get(id)!; if (!streets.includes(e)) along(e, true, 190); }
    v.lots.sort((p, q) => Math.hypot(p.x - node.x, p.y - node.y) - Math.hypot(q.x - node.x, q.y - node.y));
    out.push(v);
  }
  return out;
}

// --------------------------------------------------------------- farmland

/** Farmsteads along every country road out here: a farmhouse lot by the lane, a big field lot beside it. */
function divideFarmland(ctx: Ctx): Farmstead[] {
  const s = ctx.s, w = s.world;
  const out: Farmstead[] = [];
  const outside = (x: number, y: number) => !inGrid(w, x, y) && onLand(x, y, 15);
  const [f0, f1] = COUNTRY.fieldFrontage, [d0, d1] = COUNTRY.fieldDepth;
  for (const e of s.roads.edges.slice()) {
    if (e.kind !== 'country') continue;
    const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
    if (inGrid(w, (a.x + b.x) / 2, (a.y + b.y) / 2)) continue;
    for (const side of [1, -1] as const) {
      let pos = 22;
      while (pos + 60 < e.len - 20) {
        const house = addLotAt(ctx, e, side, pos + 19, 38, 44, 'rural', outside);
        if (!house) { pos += 16; continue; }
        pos += 38 + 2;
        const fw = Math.min(f0 + (f1 - f0) * hash2(house.id, 1, s.seed + 321), e.len - 20 - pos);
        if (fw < 110) break;
        const fd = d0 + (d1 - d0) * hash2(house.id, 2, s.seed + 322);
        const field = addLotAt(ctx, e, side, pos + fw / 2, fw, fd, 'rural', outside);
        if (field) out.push({ house, field });
        pos += fw + 4;
      }
    }
  }
  return out;
}

// --------------------------------------------------------------- people

/** What a field is best for, from its soil (and a share of each kind across the country). */
function farmKindFor(ctx: Ctx, field: Lot, r: number): BuildingKind {
  const soil = fertilityAt(ctx.s.world, field.x, field.y);
  const k = COUNTRY.kinds;
  // fruit and vegetables want the best soil; cattle make do with the poorer pasture
  const wts: [BuildingKind, number][] = [
    ['farm', k.farm * (0.6 + soil)], ['vegfarm', k.vegfarm * Math.max(0.1, soil * 2 - 0.6)],
    ['dairyfarm', k.dairyfarm * (1.6 - soil)], ['ranch', k.ranch * (1.6 - soil)],
  ];
  let t = r * wts.reduce((s, x) => s + x[1], 0);
  for (const [kind, wt] of wts) if ((t -= wt) <= 0) return kind;
  return 'farm';
}

/** A countryside person: a little more settled, a little less online than the city's. */
function local(ctx: Ctx, x: number, y: number, money: number): Person {
  const p = createPerson(ctx, x, y, money, 8);
  p.origin = 'the countryside here';
  p.pantry.groceries = 6;
  p.pantry.bread = 2;
  p.pantry.produce = 2;
  p.durables.tv = ctx.rng.range(100, 600);
  p.durables.furniture = ctx.rng.range(100, 500);
  return p;
}

/** Someone moves into a free unit of a home (no rent: their own, or family, or lodging with the farm). */
function lodge(ctx: Ctx, p: Person, b: Building): boolean {
  const u = b.units.findIndex((x) => x.tenant < 0);
  if (u < 0) return false;
  moveIn(ctx, p, b, u);
  p.x = p.px = b.x;
  p.y = p.py = b.y;
  p.inside = b.id;
  return true;
}

/** Farm families on some of the farms; villagers, a shop and a pub in each village. */
function settle(ctx: Ctx, villages: Village[], steads: Farmstead[]): { farms: number; people: number } {
  const s = ctx.s, rng = ctx.rng;
  const before = s.people.length;
  const wage = Math.round(WAGES.reference * ROLE.farmhand.pay);
  // the farms that are worked: more of them near the villages and the highway
  const near = (l: Lot) => Math.min(...villages.map((v) => Math.hypot(v.node.x - l.x, v.node.y - l.y)), 4000);
  const ranked = steads.map((f) => ({ f, k: near(f.field) + rng.next() * 900 })).sort((p, q) => p.k - q.k);
  const want = Math.round(steads.length * COUNTRY.farmShare);
  const farms: Building[] = [];
  for (const { f } of ranked.slice(0, want)) {
    const farmer = local(ctx, f.house.x, f.house.y, Math.round(300 + 1300 * Math.pow(rng.next(), 1.5)));
    f.house.owner = farmer.id;
    f.house.forSale = 0;
    const home = createBuilding(ctx, 'farmhouse', f.house, farmer.id, 2, true);
    home.condition = rng.range(0.6, 0.95);
    lodge(ctx, farmer, home);
    f.field.owner = farmer.id;
    const kind = farmKindFor(ctx, f.field, rng.next());
    const firm = establishFirm(ctx, farmer, kind, f.field, Math.round(250 + 450 * rng.next()));
    const site = ctx.bById.get(firm.sites[0])!;
    farms.push(site);
    farmer.inv.tools = 1;
    farmer.skills.farmhand = 300 + rng.next() * 1500;
    // family working the farm with them (and sometimes a hired hand), living in the farmhouse
    const family = 1 + (rng.chance(0.45) ? 1 : 0);
    for (let k = 0; k < family; k++) {
      const q = local(ctx, home.x, home.y, Math.round(40 + 250 * rng.next()));
      if (!lodge(ctx, q, home)) break;
      q.inv.tools = 1;
      q.skills.farmhand = 100 + rng.next() * 900;
      hire(ctx, postJob(ctx, firm, site.id, 'farmhand', wage), q);
    }
    // grain for the livestock to start with
    if (kind === 'ranch') site.store.crops = 30;
  }
  // villages: a shop, a pub, and houses (farmhands, a few retired people)
  for (const v of villages) {
    const lots = v.lots.slice();
    const take = () => lots.shift();
    const shopLot = take();
    if (shopLot) {
      const owner = local(ctx, shopLot.x, shopLot.y, Math.round(500 + 900 * rng.next()));
      const shop = establishFirm(ctx, owner, 'store', shopLot, 400);
      const b = ctx.bById.get(shop.sites[0])!;
      Object.assign(b.store, { groceries: 40, bread: 12, produce: 12, dairy: 10, meat: 8, clothes: 4, tools: 4 });
      villageHome(ctx, owner, take());
    }
    const pubLot = take();
    if (pubLot) {
      const owner = local(ctx, pubLot.x, pubLot.y, Math.round(400 + 800 * rng.next()));
      const pub = establishFirm(ctx, owner, 'restaurant', pubLot, 300);
      pub.name = `The ${['Plough', 'Wheatsheaf', 'Red Lion', 'Crown', 'Barley Mow', 'Coach House', 'Old Mill', 'Fox and Hounds'][Math.floor(rng.next() * 8)]}`;
      const b = ctx.bById.get(pub.sites[0])!;
      Object.assign(b.store, { meat: 6, produce: 6, bread: 6, groceries: 6 });
      villageHome(ctx, owner, take());
    }
    for (let k = 0; k < COUNTRY.villageHouses; k++) {
      const lot = take();
      if (!lot) break;
      const retired = rng.chance(0.25);
      const p = local(ctx, lot.x, lot.y, retired ? Math.round(2500 + 4000 * rng.next()) : Math.round(80 + 400 * rng.next()));
      if (retired) p.born -= 25 * 365 * MINUTES_PER_DAY;
      villageHome(ctx, p, lot);
      if (retired) continue;
      // works on a farm near the village
      const farm = farms.filter((b) => (ctx.fById.get(b.firm)?.sites.length ?? 0) > 0 && staffCount(ctx, b) < BUILDINGS[b.kind].jobs[0].slots)
        .sort((a, b) => Math.hypot(a.x - lot.x, a.y - lot.y) - Math.hypot(b.x - lot.x, b.y - lot.y))[0];
      if (!farm) continue;
      p.inv.tools = 1;
      hire(ctx, postJob(ctx, ctx.fById.get(farm.firm)!, farm.id, 'farmhand', wage), p);
    }
  }
  return { farms: farms.length, people: s.people.length - before };
}

function staffCount(ctx: Ctx, b: Building): number {
  let n = 0;
  for (const c of ctx.s.contracts) if (c.site === b.id) n++;
  return n;
}

/** A villager's own house on a village lot. */
function villageHome(ctx: Ctx, p: Person, lot: Lot | undefined): void {
  if (!lot) return;
  lot.owner = p.id;
  lot.forSale = 0;
  const home = createBuilding(ctx, 'house', lot, p.id, ctx.rng.chance(0.5) ? 2 : 1, true);
  home.condition = ctx.rng.range(0.55, 0.95);
  lodge(ctx, p, home);
}

// ------------------------------------------------------------------- daily

/**
 * Daily, for the countryside: farm families eat some of what they grow, farm
 * workers without a decent home lodge at the farm, people out of work for
 * long go to the city, and farms with work to offer draw people from outside.
 */
export function countryDaily(ctx: Ctx): void {
  const s = ctx.s;
  if (!s.data?.country) return;
  for (const p of s.people) {
    const rural = isRural(ctx, p);
    const c = ctx.cById.get(p.job);
    const site = c ? ctx.bById.get(c.site) : undefined;
    // a farm worker living rough or far away lodges at the farm, if there's room
    if (site && c!.role === 'farmhand' && inCountry(ctx, site.x, site.y)) {
      const home = ctx.bById.get(p.home);
      const far = !home || Math.hypot(home.x - site.x, home.y - site.y) > 1500 || home.kind === 'trailer';
      if (far) {
        const lodging = farmhouseOf(ctx, site);
        if (lodging && lodging.units.some((u) => u.tenant < 0) && lodging.id !== p.home) {
          const old = home;
          if (old && (old.kind === 'apartments' || old.kind === 'tower')) moveOut(ctx, p);
          lodge(ctx, p, lodging);
          log(ctx, 'home', `${p.name} moved into the farmhouse at ${ctx.fById.get(site.firm)?.name ?? 'the farm'} they work on.`, { who: p.id, bid: lodging.id });
        }
      }
    }
    if (!rural) continue;
    // the family's own vegetables
    for (const fid of p.firms) {
      const f = ctx.fById.get(fid);
      const farm = f && !f.closed ? ctx.bById.get(f.sites[0]) : undefined;
      if (farm?.kind !== 'vegfarm') continue;
      const home = ctx.bById.get(p.home);
      if (!home) continue;
      for (const u of home.units) {
        const q = ctx.byId.get(u.tenant);
        if (!q || q.pantry.produce >= 4 || farm.store.produce < 2) continue;
        farm.store.produce -= 2;
        q.pantry.produce += 2;
      }
    }
    // out of work for long out here: off to the city to look for work
    const idle = p.job < 0 && !p.firms.length && p.money < 60 * WAGES.reference;
    p.cooldown.jobless = idle ? (p.cooldown.jobless ?? 0) + 1 : 0;
    if (idle && (p.cooldown.jobless ?? 0) >= COUNTRY.joblessDays) {
      const home = ctx.bById.get(p.home);
      if (home && home.owner !== p.id) {
        moveOut(ctx, p);
        p.cooldown.jobless = 0;
        log(ctx, 'arrival', `${p.name} found no work in the countryside and set off for the city.`, { who: p.id });
      }
    }
  }
  countryArrivals(ctx);
}

/** The farmhouse that goes with a farm: the farm owner's home next to the fields. */
function farmhouseOf(ctx: Ctx, farm: Building): Building | undefined {
  const f = ctx.fById.get(farm.firm);
  const owner = f ? ctx.byId.get(f.owner) : undefined;
  const home = owner ? ctx.bById.get(owner.home) : undefined;
  if (home?.kind === 'farmhouse') return home;
  // (or any farmhouse right by the fields)
  return ctx.s.buildings.find((b) => b.kind === 'farmhouse' && b.built && Math.hypot(b.x - farm.x, b.y - farm.y) < 200);
}

/**
 * Farm work draws people from outside: for open farmhand jobs with room in the
 * farmhouse, now and then someone comes for it (room and board), outside the
 * city's own arrivals.
 */
function countryArrivals(ctx: Ctx): void {
  const s = ctx.s;
  for (const post of s.postings.slice()) {
    if (post.role !== 'farmhand') continue;
    const site = ctx.bById.get(post.site);
    if (!site || !inCountry(ctx, site.x, site.y) || !ctx.rng.chance(0.25)) continue;
    const lodging = farmhouseOf(ctx, site);
    if (!lodging || !lodging.units.some((u) => u.tenant < 0)) continue;
    const p = local(ctx, lodging.x, lodging.y, Math.round(POPULATION.newcomerMoney[0] + 200 * ctx.rng.next()));
    p.origin = 'a farm elsewhere';
    p.inv.tools = 1;
    lodge(ctx, p, lodging);
    s.counters.arrivals++;
    hire(ctx, post, p);
    log(ctx, 'arrival', `${p.name} came to work on ${ctx.fById.get(site.firm)?.name ?? 'a farm'}, with room and board in the farmhouse.`, { who: p.id, bid: site.id });
  }
}
