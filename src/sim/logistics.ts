// Getting goods from A to B. Every trade or order that isn't carried away by
// hand creates a shipment:
//  - between local companies (and to people's homes for online orders):
//    logistics companies' drivers pick them up in trucks, gig couriers take
//    small ones, and a courier from outside takes what nobody local took
//    for a while (for a fee that leaves the city);
//  - from outside suppliers: their own truck drives in from the highway,
//    unloads, and drives back out;
//  - to outside buyers: their truck comes to load the goods.
// Outside trucks and vans are real vehicles on the city's roads (their
// drivers aren't residents).

import { CARRY_CAPACITY, MOVE, OUTSIDE } from './config';
import { addCash, cashOf, log, newId, nameOf, type Ctx } from './ctx';
import { addInv, DURABLES, EDIBLE, emptyInv, GOOD, invTotal, invWeight } from './goods';
import { doorOf } from './layout';
import { curbSpot, route } from './roads';
import { checkFinished, finishBuilding } from './buildings';
import { GATE, GOODS, type Building, type Inventory, type Person, type Shipment, type Vehicle } from './types';

export const TRUCK_CAPACITY = 240; // weight units
export const VAN_CAPACITY = 60;

export function createShipment(ctx: Ctx, client: number, from: number, to: number, goods: Inventory, carrier = -1, extra: Partial<Shipment> = {}): Shipment {
  // merge into an open shipment on the same route (not home deliveries: each order is its own parcel)
  if (!extra.recipient) {
    const same = ctx.s.shipments.find((s) => s.status === 'open' && s.client === client && s.from === from && s.to === to && s.carrier === carrier && !s.recipient);
    if (same && invWeight(same.goods) + invWeight(goods) <= TRUCK_CAPACITY) {
      addInv(same.goods, goods);
      return same;
    }
  }
  const sh: Shipment = { id: newId(ctx), client, from, to, goods: { ...goods }, price: 0, carrier, driver: -1, status: 'open', created: ctx.s.tick, ...extra };
  // outside suppliers ship the next morning (orders placed in the evening go out after the night)
  if (carrier === OUTSIDE.id && from === GATE && sh.after === undefined) sh.after = nextShippingTime(ctx.s.tick, OUTSIDE.leadHours);
  ctx.s.shipments.push(sh);
  return sh;
}

/** The first daytime minute (6:00–19:00) at least `hours` from now. */
export function nextShippingTime(tick: number, hours: number): number {
  let t = tick + hours * 60;
  const m = t % 1440;
  if (m < 6 * 60) t += 6 * 60 - m;
  else if (m >= 21 * 60) t += 1440 - m + 6 * 60;
  return t;
}

/**
 * Hourly: local shipments nobody has picked up for a few hours are taken by a
 * courier from outside the city (for a steep fee), so the city never grinds
 * to a halt for lack of a logistics company.
 */
export function outsideCouriers(ctx: Ctx): void {
  for (const sh of ctx.s.shipments) {
    if (sh.status !== 'open' || sh.carrier >= 0 || sh.carrier === OUTSIDE.id) continue;
    if (sh.meal) continue; // food deliveries are for the app's couriers only
    if (ctx.s.tick - sh.created < OUTSIDE.courierAfterHours * 60) continue;
    const fee = 4 + 0.06 * Math.max(10, shipmentWeight(sh)) * Math.max(0.4, distanceOf(ctx, sh.from, sh.to) / 1000) * 10;
    const paid = Math.min(fee, Math.max(0, cashOf(ctx, sh.client)));
    addCash(ctx, sh.client, -paid); // the money leaves the city
    sh.carrier = OUTSIDE.id;
  }
}

export function shipmentWeight(sh: Shipment): number {
  return invWeight(sh.goods);
}

export function distanceOf(ctx: Ctx, from: number, to: number): number {
  const a = placeOf(ctx, from), b = placeOf(ctx, to);
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Where a shipment end is: a building's door, or the nearest highway gate. */
function placeOf(ctx: Ctx, id: number, near?: { x: number; y: number }): { x: number; y: number } | undefined {
  if (id === GATE) return gateNear(ctx, near?.x ?? ctx.s.center.x, near?.y ?? ctx.s.center.y);
  const b = ctx.bById.get(id);
  if (!b) return undefined;
  const [x, y] = doorOf(b);
  return { x, y };
}

export function gateNear(ctx: Ctx, x: number, y: number): { x: number; y: number } {
  const gates = ctx.s.farGates?.length ? ctx.s.farGates : ctx.s.gates;
  let best = gates[0] ?? { x: 0, y: 0 }, bd = Infinity;
  for (const g of gates) { const d = Math.hypot(g.x - x, g.y - y); if (d < bd) { bd = d; best = g; } }
  return best;
}

/** What a carrier charges for a shipment. */
export function freightPrice(ctx: Ctx, carrier: number, sh: Shipment): number {
  const f = ctx.fById.get(carrier);
  const rate = f?.prices.freight ?? 0.02;
  const km = Math.max(0.4, distanceOf(ctx, sh.from, sh.to) / 1000);
  return 2 + rate * Math.max(10, shipmentWeight(sh)) * km * 10;
}

/**
 * Goods arrive: into the destination's store, a construction site's needs,
 * or (online orders) a person's pantry and possessions.
 */
export function deliverShipment(ctx: Ctx, sh: Shipment, goods: Inventory): void {
  const p = sh.recipient !== undefined ? ctx.byId.get(sh.recipient) : undefined;
  if (p) { receive(ctx, p, sh, goods); return; }
  if (sh.to === GATE) return; // exported
  const dest = ctx.bById.get(sh.to);
  if (!dest || dest.ruined) {
    // nowhere to put it: back to whoever bought it, if it's a company with a site
    const f = ctx.fById.get(sh.client);
    const home = f ? ctx.bById.get(f.sites[0]) : undefined;
    if (home && !home.ruined) addInv(home.store, goods);
  } else if (!dest.built && dest.kind === 'trailer') {
    // a trailer home arrives on its truck and is set up on the lot
    finishBuilding(ctx, dest);
  } else if (!dest.built) {
    // a construction site: count toward its needs, keep the rest in its store
    for (const g of GOODS) {
      const use = Math.min(dest.needed[g], goods[g]);
      dest.needed[g] -= use;
      dest.store[g] += goods[g] - use;
    }
    dest.lastProgress = ctx.s.tick;
    dest.ver++;
    checkFinished(ctx, dest);
  } else {
    addInv(dest.store, goods);
  }
}

/** A parcel at the door: food into the pantry, a meal eaten, things put to use. */
function receive(ctx: Ctx, p: Person, sh: Shipment, goods: Inventory): void {
  if (sh.meal) {
    p.needs.food = Math.min(100, p.needs.food + 45);
    p.needs.fun = Math.min(100, p.needs.fun + 10);
    return;
  }
  for (const g of GOODS) {
    const q = goods[g];
    if (q <= 0) continue;
    if (g === 'computers' && sh.device) {
      const first = (p.durables[sh.device] ?? 0) <= 0;
      p.durables[sh.device] = (p.durables[sh.device] ?? 0) + (sh.device === 'phone' ? 300 : 700) * q;
      if (first) log(ctx, 'buy', `${p.name}'s new ${sh.device === 'tv' ? 'TV' : 'phone'} was delivered.`, { who: p.id });
    } else if (g === 'cars') {
      carDelivered(ctx, p, sh.from === GATE ? OUTSIDE.id : ctx.bById.get(sh.from)?.firm ?? OUTSIDE.id);
    } else if (DURABLES.includes(g) && g !== 'tools') {
      p.durables[g] = (p.durables[g] ?? 0) + (GOOD[g].lifeDays ?? 30) * q;
    } else if (EDIBLE.includes(g)) {
      p.pantry[g] += q;
    } else {
      p.inv[g] += q;
    }
  }
}

/** Take goods out of a shipment's source into a vehicle or someone's hands. Returns what was taken. */
export function loadShipment(_ctx: Ctx, sh: Shipment, capacity: number): Inventory {
  const taken = emptyInv();
  let room = capacity;
  for (const g of GOODS) {
    if (sh.goods[g] <= 0) continue;
    const wt = GOOD[g].weight || 1;
    const q = Math.min(sh.goods[g], Math.floor(room / wt + 1e-9));
    if (q <= 0) continue;
    taken[g] = q;
    sh.goods[g] -= q;
    room -= q * wt;
  }
  return taken;
}

export function finishIfEmpty(ctx: Ctx, sh: Shipment): void {
  if (invTotal(sh.goods) < 1e-6 && !sh.meal) {
    sh.status = 'done';
    ctx.s.shipments = ctx.s.shipments.filter((x) => x !== sh);
  } else {
    sh.status = 'open';
    if (sh.carrier !== OUTSIDE.id) sh.carrier = -1;
    sh.driver = -1;
  }
}

/** Pay the carrier on delivery (the client pays what it can). */
export function payFreight(ctx: Ctx, sh: Shipment, carrier: number): void {
  const due = sh.price > 0 ? sh.price : freightPrice(ctx, carrier, sh);
  const paid = Math.min(due, Math.max(0, cashOf(ctx, sh.client)));
  addCash(ctx, sh.client, -paid);
  addCash(ctx, carrier, paid);
}

/** Is any logistics company in business? */
export function carriersExist(ctx: Ctx): boolean {
  return ctx.s.buildings.some((b) => b.kind === 'depot' && b.built && !b.ruined && b.firm >= 0);
}

// ----------------------------------------------------------- outside fleet

/** Brands of the outside companies whose trucks and vans come to the city. */
const FLEETS = [
  { brand: 'Interstate Freight', hue: 0.58, kind: 'truck' as const },
  { brand: 'Continental Haulage', hue: 0.02, kind: 'truck' as const },
  { brand: 'Northline Logistics', hue: 0.33, kind: 'truck' as const },
  { brand: 'Parcelo', hue: 0.09, kind: 'van' as const },
  { brand: 'QuickShip', hue: 0.75, kind: 'van' as const },
];
/** Outside online retailers (their vans bring people's orders). */
export const RETAILERS = ['MegaMart', 'ShopAll', 'Bazaar.com'];

/**
 * Hourly: outside trucks set off for the shipments due (imports arriving,
 * exports to be collected, local deliveries handed to an outside courier).
 */
export function dispatchOutside(ctx: Ctx): void {
  const h = Math.floor((ctx.s.tick % 1440) / 60);
  if (h < 6 || h >= 22) return;
  for (const sh of ctx.s.shipments) {
    if (sh.carrier !== OUTSIDE.id || sh.status !== 'open') continue;
    if (sh.after !== undefined && sh.after > ctx.s.tick) continue;
    const parcel = !!sh.recipient || shipmentWeight(sh) <= VAN_CAPACITY;
    const fleet = parcel ? FLEETS.filter((f) => f.kind === 'van') : FLEETS.filter((f) => f.kind === 'truck');
    const pick = fleet[(sh.id * 7) % fleet.length];
    const brand = sh.recipient !== undefined && sh.from === GATE ? RETAILERS[sh.id % RETAILERS.length] : pick.brand;
    // the route: in from the highway, the stops, back out
    const stops = sh.from === GATE ? [sh.to] : sh.to === GATE ? [sh.from] : [sh.from, sh.to];
    const first = placeOf(ctx, stops[0]);
    if (!first) { sh.status = 'done'; continue; }
    const gate = gateNear(ctx, first.x, first.y);
    const v: Vehicle = {
      id: newId(ctx), kind: parcel ? 'van' : 'truck', owner: OUTSIDE.id, x: gate.x, y: gate.y, px: gate.x, py: gate.y,
      heading: Math.atan2(first.y - gate.y, first.x - gate.x), path: route(ctx, gate.x, gate.y, first.x, first.y, 'drive'),
      driver: -1, parkedAt: -1, cargo: emptyInv(), hue: pick.hue, bought: ctx.s.tick, brand,
      trip: { shipment: sh.id, to: stops[0], phase: 'in', until: 0, stops: [...stops, GATE], i: 0 },
    };
    ctx.s.vehicles.push(v);
    ctx.vById.set(v.id, v);
    sh.status = 'assigned';
    // imports ride in the truck from the start
    if (sh.from === GATE) { addInv(v.cargo, sh.goods); for (const g of GOODS) sh.goods[g] = 0; sh.status = 'loaded'; }
  }
}

/** Every minute: outside trucks and vans drive, stop, load or unload, and leave. */
export function outsideTrafficMinute(ctx: Ctx): void {
  for (const v of ctx.s.vehicles.slice()) {
    const trip = v.trip;
    if (!trip) continue;
    if (trip.phase === 'stop') {
      if (ctx.s.tick < trip.until) continue;
      arriveAt(ctx, v, trip.stops![trip.i]);
      trip.i++;
      const next = trip.stops![trip.i];
      const to = placeOf(ctx, next, v);
      if (!to) { removeVehicle(ctx, v); continue; }
      v.path = route(ctx, v.x, v.y, to.x, to.y, 'drive');
      v.parkedAt = -1;
      trip.to = next;
      trip.phase = next === GATE ? 'out' : 'in';
      continue;
    }
    if (!moveVehicle(v, v.kind === 'truck' ? MOVE.truck : MOVE.car * 0.85)) continue;
    // out at the highway: exports are handed over to the buyer; the truck is gone
    if (trip.phase === 'out') { arriveAt(ctx, v, GATE); removeVehicle(ctx, v); continue; }
    // at a stop: a few minutes to load or unload
    trip.phase = 'stop';
    trip.until = ctx.s.tick + (v.kind === 'van' ? 4 : 15);
    const b = ctx.bById.get(trip.to);
    if (b) v.parkedAt = b.id;
  }
}

/** Loading or unloading at a stop. */
function arriveAt(ctx: Ctx, v: Vehicle, stop: number): void {
  const sh = ctx.s.shipments.find((s) => s.id === v.trip!.shipment);
  if (!sh) return;
  if (stop === sh.from && sh.from !== GATE) {
    addInv(v.cargo, sh.goods);
    for (const g of GOODS) sh.goods[g] = 0;
    sh.status = 'loaded';
    return;
  }
  if (stop === sh.to || (sh.to === GATE && stop === GATE)) {
    deliverShipment(ctx, sh, { ...v.cargo });
    for (const g of GOODS) v.cargo[g] = 0;
    sh.status = 'done';
    ctx.s.shipments = ctx.s.shipments.filter((x) => x !== sh);
  }
}

/** Move a vehicle along its path at `speed` m/min. Returns true when the path is used up. */
export function moveVehicle(v: Vehicle, speed: number): boolean {
  let budget = speed;
  while (budget > 0 && v.path.length) {
    const tx = v.path[0], ty = v.path[1];
    const d = Math.hypot(tx - v.x, ty - v.y);
    if (d > 0.01) v.heading = Math.atan2(ty - v.y, tx - v.x);
    if (d <= budget) {
      v.x = tx; v.y = ty; budget -= d;
      v.path.splice(0, 2);
    } else {
      v.x += ((tx - v.x) / d) * budget;
      v.y += ((ty - v.y) / d) * budget;
      budget = 0;
    }
  }
  return v.path.length === 0;
}

// ----------------------------------------------------------------- vehicles

export function createVehicle(ctx: Ctx, kind: Vehicle['kind'], owner: number, at: Building, hue: number): Vehicle {
  const spot = parkingSpot(ctx, at, ctx.s.vehicles.filter((v) => v.parkedAt === at.id).length);
  const [x, y] = spot;
  const v: Vehicle = { id: newId(ctx), kind, owner, x, y, px: x, py: y, heading: spot[2], path: [], driver: -1, parkedAt: at.id, cargo: emptyInv(), hue, bought: ctx.s.tick };
  ctx.s.vehicles.push(v);
  ctx.vById.set(v.id, v);
  return v;
}

/** A new car for a person (bought from a dealer's stock or ordered from outside), at their home. */
export function carDelivered(ctx: Ctx, p: Person, seller: number): void {
  const at = ctx.bById.get(p.home) ?? ctx.bById.get(ctx.s.buildings.find((b) => b.kind === 'dealer')?.id ?? -1);
  if (!at) { addCash(ctx, p.id, 200); return; }
  const v = createVehicle(ctx, 'car', p.id, at, ctx.rng.next());
  if (p.car >= 0) { const old = ctx.vById.get(p.car); if (old) removeVehicle(ctx, old); }
  p.car = v.id;
  log(ctx, 'buy', `${p.name} got a new car from ${nameOf(ctx, seller)}! It was delivered to their door.`, { who: p.id, firm: seller });
}

export function removeVehicle(ctx: Ctx, v: Vehicle): void {
  ctx.s.vehicles = ctx.s.vehicles.filter((x) => x !== v);
  ctx.vById.delete(v.id);
  if (v.owner === OUTSIDE.id) return;
  for (const p of ctx.s.people) {
    if (p.car === v.id) p.car = -1;
    if (p.driving === v.id) p.driving = -1;
  }
}

/**
 * Where the n-th vehicle parks at a building, with the direction it faces:
 * a depot's or yard's trucks in their own yard; everyone else at the curb in
 * front (the first ten), then in the underground garage (out of sight).
 */
export function parkingSpot(ctx: Ctx, b: Building, n: number): [number, number, number] {
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  const rx = Math.sin(b.angle), ry = -Math.cos(b.angle);
  if ((b.kind === 'depot' || b.kind === 'yard') && n < 8) {
    // in the yard behind, side by side
    const across = ((n % 4) - 1.5) * 4;
    const back = -b.d / 2 - 4 - Math.floor(n / 4) * 8;
    return [b.x + rx * across + fx * back, b.y + ry * across + fy * back, b.angle];
  }
  if (n < 10) {
    const [dx, dy] = doorOf(b);
    const c = curbSpot(ctx, dx, dy, n);
    if (c) return [c.x, c.y, c.heading];
  }
  return [b.x, b.y, b.angle + Math.PI / 2];
}

/** Start driving vehicle `v` with person `p` to building `to` (or a point). */
export function startDrive(ctx: Ctx, p: Person, v: Vehicle, tx: number, ty: number): void {
  v.driver = p.id;
  v.parkedAt = -1;
  v.path = route(ctx, v.x, v.y, tx, ty, 'drive');
  p.driving = v.id;
  p.inside = -1;
  p.seat = -1;
  p.x = v.x;
  p.y = v.y;
}

/** One minute of driving. Returns true on arrival. */
export function driveMinute(_ctx: Ctx, p: Person, v: Vehicle): boolean {
  const done = moveVehicle(v, v.kind === 'truck' ? MOVE.truck : MOVE.car);
  p.x = v.x;
  p.y = v.y;
  p.heading = v.heading;
  return done;
}

export function parkAt(ctx: Ctx, p: Person, v: Vehicle, b: Building | undefined): void {
  v.driver = -1;
  p.driving = -1;
  if (b) {
    const n = ctx.s.vehicles.filter((o) => o.parkedAt === b.id && o !== v).length;
    const [x, y, heading] = parkingSpot(ctx, b, n);
    v.x = x; v.y = y;
    v.parkedAt = b.id;
    v.heading = heading;
    const [dx, dy] = doorOf(b);
    p.x = dx; p.y = dy;
  }
}

export function weightCapacity(p: Person): number {
  return CARRY_CAPACITY - invWeight(p.inv);
}

export function describeShipment(ctx: Ctx, sh: Shipment): string {
  if (sh.meal) return `a meal for ${nameOf(ctx, sh.recipient ?? sh.client)}`;
  const what = GOODS.filter((g) => sh.goods[g] >= 1).map((g) => `${Math.floor(sh.goods[g])} ${GOOD[g].label}`).join(', ');
  return `${what || 'goods'} for ${nameOf(ctx, sh.recipient ?? sh.client)}`;
}

export function logDelivery(ctx: Ctx, carrier: number, sh: Shipment): void {
  if (ctx.rng.chance(0.03)) log(ctx, 'business', `${nameOf(ctx, carrier)} delivered ${describeShipment(ctx, sh)}.`, { firm: carrier });
}
