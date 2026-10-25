// What people do on the Net besides reading and posting (media.ts): shop,
// order food, work gigs, take rides, back new businesses.
//
// - Shopping: outside online retailers sell anything (the wider Net),
//   delivered the next day by a van from outside. Local stores sell online
//   too: through their own web shop (if they have a website) or a local
//   marketplace site, which takes a commission and sells "sponsored" spots.
//   Local orders are carried by logistics companies, gig couriers, or
//   (after a few hours) an outside courier.
// - Food delivery: an app's couriers bring restaurant meals. The app takes a
//   commission from the restaurant and part of the delivery fee.
// - Ride-hailing: people without a car pay for a ride; gig drivers earn the
//   fare, the app takes a cut. (The passenger rides in an app-branded car.)
// - Gigs: anyone with a phone can deliver (on foot or by car); people with a
//   car can drive for a ride app. Paid per job, no boss, no shifts.
// - Payments: a payments app takes a small fee on what's paid through it.
// - Crowdfunding: someone short of money to start a business asks the
//   crowd; backers chip in; the site keeps a share if the goal is reached.

import { MOVE, ONLINE, OUTSIDE } from './config';
import { addCash, cashOf, hourOf, log, nameOf, newId, type Ctx } from './ctx';
import { BUILDINGS, emptyInv, GOOD } from './goods';
import { recordSale } from './firms';
import { collectSalesTax } from './government';
import { createShipment, deliverShipment, driveMinute, finishIfEmpty, loadShipment, nextShippingTime, parkAt, removeVehicle, shipmentWeight, startDrive, VAN_CAPACITY } from './logistics';
import { borrow } from './finance';
import { doorOf } from './layout';
import { curbSpot, route } from './roads';
import { exitBuilding, leaveSeat, walkMinute } from './tasks';
import { GATE, type Building, type Firm, type Good, type Person, type Shipment, type SiteKind, type Step, type Vehicle } from './types';
import { tally } from './stats';

type StepResult = 'wait' | 'instant' | 'minute';

export function isOnline(p: Person): boolean {
  return (p.durables.phone ?? 0) > 0 || (p.durables.computers ?? 0) > 0;
}

/** The most-used site of a kind (cached per minute). */
const siteCache = new WeakMap<object, { t: number; m: Map<SiteKind, Firm | undefined> }>();
export function siteOf(ctx: Ctx, kind: SiteKind): Firm | undefined {
  let c = siteCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, m: new Map() }; siteCache.set(ctx.s, c); }
  if (c.m.has(kind)) return c.m.get(kind);
  let best: Firm | undefined;
  for (const f of ctx.s.firms) if (!f.closed && f.site?.kind === kind && (!best || f.site.users > best.site!.users)) best = f;
  c.m.set(kind, best);
  return best;
}

/** What an outside online retailer charges for a good (delivered price excludes the fee). */
export function outsideRetailPrice(_ctx: Ctx, g: Good): number {
  return (OUTSIDE.prices[g] ?? GOOD[g].laborGuess * 2) * (g === 'cars' ? 1.25 : ONLINE.retailMarkup);
}

/** Local stores that sell a good online with at least `qty` in stock: through their own web shop, or the marketplace. */
const storeCache = new WeakMap<object, { t: number; list: Building[] }>();
export function onlineStores(ctx: Ctx, g: Good, qty: number): { b: Building; f: Firm; via: number }[] {
  const market = siteOf(ctx, 'shop');
  const out: { b: Building; f: Firm; via: number }[] = [];
  let c = storeCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, list: ctx.s.buildings.filter((b) => b.kind === 'store' && b.built && !b.ruined) }; storeCache.set(ctx.s, c); }
  for (const b of c.list) {
    if (b.store[g] < qty) continue;
    const f = ctx.fById.get(b.firm);
    if (!f || f.closed || !f.prices[g]) continue;
    if (market) out.push({ b, f, via: market.id });
    else if (f.webshop || f.website) out.push({ b, f, via: -1 });
  }
  return out;
}

/** Deliveries on their way to someone (online orders). Indexed per minute. */
const parcelCache = new WeakMap<object, { t: number; n: number; m: Map<number, Shipment[]> }>();
const NONE: Shipment[] = [];
export function pendingDeliveries(ctx: Ctx, p: Person): Shipment[] {
  let c = parcelCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick || c.n !== ctx.s.shipments.length) {
    c = { t: ctx.s.tick, n: ctx.s.shipments.length, m: new Map() };
    for (const s of ctx.s.shipments) {
      if (s.recipient === undefined) continue;
      const arr = c.m.get(s.recipient);
      if (arr) arr.push(s); else c.m.set(s.recipient, [s]);
    }
    parcelCache.set(ctx.s, c);
  }
  return c.m.get(p.id) ?? NONE;
}

/** A payment made online: the payments app (if they use one) takes a small fee from the one being paid. */
function paymentFee(ctx: Ctx, p: Person, payee: number, amount: number): void {
  const app = siteOf(ctx, 'pay');
  if (!app || !p.pol.sites.includes(app.id) || amount <= 0) return;
  const fee = amount * (app.site!.fee ?? 0.015);
  if (cashOf(ctx, payee) < fee || payee === OUTSIDE.id) return;
  addCash(ctx, payee, -fee);
  addCash(ctx, app.id, fee);
  app.site!.volume = (app.site!.volume ?? 0) + amount;
}

/** The 'order' step: pay, and a delivery is on its way. */
export function placeOrder(ctx: Ctx, p: Person, step: Extract<Step, { k: 'order' }>): void {
  const home = ctx.bById.get(p.home);
  if (step.meal) { ctx.s.counters.orders = (ctx.s.counters.orders ?? 0) + 1; orderMeal(ctx, p, step, home); return; }
  if (!home) return;
  ctx.s.counters.orders = (ctx.s.counters.orders ?? 0) + 1;
  const goods = emptyInv();
  goods[step.good] = step.qty;
  if (step.seller === OUTSIDE.id) {
    const total = step.price * step.qty + ONLINE.deliveryFee;
    if (cashOf(ctx, p.id) < total && step.good === 'cars') borrow(ctx, p.id, total * 1.05 - cashOf(ctx, p.id), 90, 'a car');
    if (cashOf(ctx, p.id) < total) { p.activity = 'card declined'; return; }
    addCash(ctx, p.id, -total); // the money leaves the city
    tally(ctx, 'spend:' + step.good, step.price * step.qty);
    tally(ctx, 'spend:online', total);
    tally(ctx, 'imports', total);
    createShipment(ctx, p.id, GATE, home.id, goods, OUTSIDE.id, { recipient: p.id, device: step.device, after: nextShippingTime(ctx.s.tick, ONLINE.leadHours) });
    p.activity = `ordered ${step.good === 'cars' ? 'a car' : GOOD[step.good].label} online`;
    if (step.good === 'cars') log(ctx, 'buy', `${p.name} ordered a car online; it's coming on a truck.`, { who: p.id });
    return;
  }
  const f = ctx.fById.get(step.seller);
  const store = f?.sites.map((id) => ctx.bById.get(id)).find((b): b is Building => !!b && b.kind === 'store' && b.built && b.store[step.good] >= step.qty);
  if (!f || !store) return;
  const price = f.prices[step.good] ?? step.price;
  const total = price * step.qty;
  if (cashOf(ctx, p.id) < total + ONLINE.localDeliveryFee) return;
  addCash(ctx, p.id, -total);
  tally(ctx, 'spend:' + step.good, total);
  tally(ctx, 'spend:online', total);
  // the marketplace's commission comes out of the store's takings
  const market = ctx.fById.get(step.via);
  const commission = market ? total * (market.site?.fee ?? 0.08) : 0;
  addCash(ctx, f.id, total - commission);
  if (market) { addCash(ctx, market.id, commission); market.site!.volume = (market.site!.volume ?? 0) + total; }
  paymentFee(ctx, p, f.id, total);
  collectSalesTax(ctx, store, f.id, total);
  store.store[step.good] -= step.qty;
  recordSale(f, step.good, step.qty);
  recordSale(f, 'online', 1);
  createShipment(ctx, p.id, store.id, home.id, goods, -1, { recipient: p.id, device: step.device, price: ONLINE.localDeliveryFee, app: siteOf(ctx, 'delivery')?.id });
  p.activity = `ordered from ${f.name} online`;
}

function orderMeal(ctx: Ctx, p: Person, step: Extract<Step, { k: 'order' }>, home: Building | undefined): void {
  const f = ctx.fById.get(step.seller);
  const app = ctx.fById.get(step.via);
  if (!f || !app?.site) return;
  // the nearest of their kitchens that can cook it
  let rest: Building | undefined, bd = Infinity;
  for (const id of f.sites) {
    const b = ctx.bById.get(id);
    if (!b || b.kind !== 'restaurant' || !b.built || b.store.groceries < 1.2) continue;
    const d = Math.hypot(b.x - (home?.x ?? p.x), b.y - (home?.y ?? p.y));
    if (d < bd) { bd = d; rest = b; }
  }
  const price = f.prices.meal ?? step.price;
  if (!rest || cashOf(ctx, p.id) < price + ONLINE.mealDeliveryFee) return;
  addCash(ctx, p.id, -(price + ONLINE.mealDeliveryFee));
  tally(ctx, 'spend:meal', price + ONLINE.mealDeliveryFee);
  tally(ctx, 'spend:online', price + ONLINE.mealDeliveryFee);
  const commission = price * (app.site.fee ?? 0.18);
  addCash(ctx, f.id, price - commission);
  // the app holds the delivery fee until a courier delivers (then pays them most of it)
  addCash(ctx, app.id, commission + ONLINE.mealDeliveryFee);
  app.site.volume = (app.site.volume ?? 0) + price;
  collectSalesTax(ctx, rest, f.id, price);
  rest.store.groceries -= 1.2;
  recordSale(f, 'meal', 1);
  recordSale(f, 'online', 1);
  // delivered home, or (no home) to the building they're in or the restaurant's door for pickup
  const dest = home?.id ?? (p.inside >= 0 ? p.inside : rest.id);
  createShipment(ctx, p.id, rest.id, dest, emptyInv(), -1, { recipient: p.id, meal: true, app: app.id, price: ONLINE.mealDeliveryFee * 0.8 });
  p.activity = `ordered dinner from ${f.name}`;
}

// ------------------------------------------------------------------ gigs

/** Couriers and drivers on an app right now (cached per minute). */
const appCache = new WeakMap<object, { t: number; m: Map<number, Person[]> }>();
/** How many are working on each app (for the earnings people expect; recounted every 10 minutes). */
const countCache = new WeakMap<object, { t: number; m: Map<number, number> }>();
function onAppCount(ctx: Ctx, app: number): number {
  let c = countCache.get(ctx.s);
  if (!c || ctx.s.tick - c.t >= 10 || ctx.s.tick < c.t) {
    c = { t: ctx.s.tick, m: new Map() };
    for (const q of ctx.s.people) {
      const st = q.task?.steps[q.task.i];
      if (st?.k === 'gig') c.m.set(st.app, (c.m.get(st.app) ?? 0) + 1);
    }
    countCache.set(ctx.s, c);
  }
  return c.m.get(app) ?? 0;
}

function onApp(ctx: Ctx, app: number): Person[] {
  let c = appCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) {
    c = { t: ctx.s.tick, m: new Map() };
    for (const q of ctx.s.people) {
      const st = q.task?.steps[q.task.i];
      if (st?.k !== 'gig') continue;
      const arr = c.m.get(st.app);
      if (arr) arr.push(q); else c.m.set(st.app, [q]);
    }
    appCache.set(ctx.s, c);
  }
  return c.m.get(app) ?? [];
}

/** Deliveries a courier for this app could take (meals ordered through it, and small parcels nobody carries). */
function gigJobs(ctx: Ctx, app: Firm, p: Person): Shipment[] {
  const out: Shipment[] = [];
  const cap = p.car >= 0 ? VAN_CAPACITY : 25;
  for (const s of ctx.s.shipments) {
    if (s.status !== 'open' || s.carrier >= 0 || s.carrier === OUTSIDE.id || s.from === GATE || s.to === GATE) continue;
    if (s.meal ? s.app !== app.id : !s.recipient || shipmentWeight(s) > cap) continue;
    out.push(s);
  }
  return out;
}

/** How many deliveries are waiting on an app for someone with (or without) a car. Counted once a minute. */
const waitingCache = new WeakMap<object, { t: number; m: Map<string, number> }>();
function waitingGigs(ctx: Ctx, app: Firm, p: Person): number {
  let c = waitingCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, m: new Map() }; waitingCache.set(ctx.s, c); }
  const key = `${app.id}:${p.car >= 0 ? 1 : 0}`;
  let n = c.m.get(key);
  if (n === undefined) { n = gigJobs(ctx, app, p).length; c.m.set(key, n); }
  return n;
}

/** What someone expects to earn per hour on an app (from how much work is waiting and how many others are on it). */
export function gigOutlook(ctx: Ctx, app: Firm, p: Person): number {
  const others = onAppCount(ctx, app.id);
  if (app.site!.kind === 'rides') {
    // rides wanted: what was taken lately, or (a new app) a guess from how many of its users have no car
    const guess = app.site!.users * 0.05;
    const perDay = Math.max(ctx.s.data?.['rides:' + app.id] ?? 0, guess);
    const fare = 4;
    return Math.min(4, (perDay / 14) / (others + 1)) * fare * 0.75;
  }
  const waiting = waitingGigs(ctx, app, p);
  const perDay = ctx.s.data?.['gigs:' + app.id] ?? 0;
  return Math.min(3, (waiting + perDay / 14) / (others + 1)) * 2.2;
}

/** The 'gig' step: a session on a delivery or ride app. */
export function gigMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'gig' }>): StepResult {
  const task = p.task!;
  const app = ctx.fById.get(step.app);
  const mem = (task.mem ??= {});
  if (!app?.site || app.closed) return endGig(ctx, p, mem);
  task.elapsed++;
  const busy = (mem.phase ?? 0) > 0;
  if (task.elapsed > step.mins && !busy) return endGig(ctx, p, mem);
  if (task.elapsed > step.mins + 90) return endGig(ctx, p, mem);
  p.gig ??= { app: app.id, earned: 0, jobs: 0 };
  p.gig.app = app.id;
  if (app.site.kind === 'rides') return cruise(ctx, p, app, mem);
  const moving = () => {
    if (p.driving >= 0) { const v = ctx.vById.get(p.driving); if (v) { p.pose = 'drive'; return driveMinute(ctx, p, v); } p.driving = -1; }
    return walkMinute(p);
  };
  const phase = mem.phase ?? 0;
  if (phase === 0) {
    p.pose = 'phone';
    p.activity = `waiting for a delivery job on ${app.site.name}`;
    if (task.elapsed % 3) return 'wait';
    // the nearest job within reach
    const reach = p.car >= 0 ? 4000 : 1500;
    let best: Shipment | undefined, bd = Infinity;
    for (const s of gigJobs(ctx, app, p)) {
      const from = ctx.bById.get(s.from);
      if (!from) continue;
      const d = Math.hypot(from.x - p.x, from.y - p.y);
      if (d < bd && d < reach) { bd = d; best = s; }
    }
    if (!best) return 'wait';
    best.carrier = app.id;
    best.driver = p.id;
    best.status = 'assigned';
    mem.sh = best.id;
    leaveSeat(ctx, p);
    p.inside = -1;
    const [fx, fy] = doorOf(ctx.bById.get(best.from)!);
    const car = ctx.vById.get(p.car);
    if (car && car.driver < 0 && Math.hypot(car.x - p.x, car.y - p.y) < 40) startDrive(ctx, p, car, fx, fy);
    else p.path = route(ctx, p.x, p.y, fx, fy, 'walk');
    mem.phase = 1;
    return 'wait';
  }
  const sh = ctx.s.shipments.find((x) => x.id === mem.sh);
  if (!sh) { mem.phase = 0; return 'wait'; }
  if (phase === 1) {
    p.activity = sh.meal ? `picking up a meal (${app.site.name})` : `picking up a parcel (${app.site.name})`;
    if (!moving()) return 'wait';
    const goods = loadShipment(ctx, sh, 999);
    for (const g of Object.keys(goods) as Good[]) mem['g_' + g] = goods[g];
    sh.status = 'loaded';
    const to = ctx.bById.get(sh.to);
    if (!to) { mem.phase = 0; return 'wait'; }
    const [tx, ty] = doorOf(to);
    const v = ctx.vById.get(p.driving);
    if (v) v.path = route(ctx, v.x, v.y, tx, ty, 'drive');
    else p.path = route(ctx, p.x, p.y, tx, ty, 'walk');
    mem.phase = 2;
    return 'wait';
  }
  // phase 2: on the way to the customer
  p.activity = `delivering ${sh.meal ? 'a meal' : 'a parcel'} for ${app.site.name}`;
  if (!moving()) return 'wait';
  const goods = emptyInv();
  for (const g of Object.keys(goods) as Good[]) { goods[g] = mem['g_' + g] ?? 0; mem['g_' + g] = 0; }
  deliverShipment(ctx, sh, goods);
  // pay: meals from the fee the app holds; parcels from the customer's delivery fee (the app keeps a fifth)
  const fee = sh.price || 2;
  const earned = sh.meal ? Math.min(fee, Math.max(0, cashOf(ctx, app.id))) : Math.min(fee, Math.max(0, cashOf(ctx, sh.client)));
  addCash(ctx, sh.meal ? app.id : sh.client, -earned);
  addCash(ctx, p.id, earned * (sh.meal ? 1 : 0.8));
  if (!sh.meal) addCash(ctx, app.id, earned * 0.2);
  // a tip now and then
  const customer = ctx.byId.get(sh.recipient ?? -1);
  if (customer && customer.money > 50 && ctx.rng.chance(0.3)) { const tip = 0.5 + ctx.rng.next(); addCash(ctx, customer.id, -tip); addCash(ctx, p.id, tip); }
  sh.status = 'done';
  sh.goods = emptyInv();
  ctx.s.shipments = ctx.s.shipments.filter((x) => x !== sh);
  p.gig.earned += earned;
  p.gig.jobs++;
  ctx.s.counters.gigs = (ctx.s.counters.gigs ?? 0) + 1;
  ctx.s.data = { ...(ctx.s.data ?? {}), ['gigs:' + app.id]: (ctx.s.data?.['gigs:' + app.id] ?? 0) + 1 };
  mem.phase = 0;
  mem.sh = -1;
  return 'wait';
}

function endGig(ctx: Ctx, p: Person, mem: Record<string, number>): StepResult {
  const sh = ctx.s.shipments.find((x) => x.id === mem.sh);
  if (sh && sh.status !== 'done') finishIfEmpty(ctx, sh);
  if (p.driving >= 0) {
    const v = ctx.vById.get(p.driving);
    if (v) parkAt(ctx, p, v, ctx.bById.get(p.home));
  }
  p.pose = 'stand';
  return 'instant';
}

/** A ride-app driver cruises the busy streets waiting for fares (fares are paid when someone takes a ride). */
function cruise(ctx: Ctx, p: Person, app: Firm, mem: Record<string, number>): StepResult {
  const car = ctx.vById.get(p.car);
  if (!car) return endGig(ctx, p, mem);
  if (p.driving < 0) {
    // the car is parked down the street or at work: walk to it first (too far, or someone else has it: not today)
    const toCar = Math.hypot(car.x - p.x, car.y - p.y);
    if (toCar > 40) {
      if (toCar > 1500 || car.driver >= 0) { p.activity = 'no car nearby'; p.cooldown.gig = ctx.s.tick + 240; return endGig(ctx, p, mem); }
      if (!p.path.length) { exitBuilding(ctx, p); p.path = route(ctx, p.x, p.y, car.x, car.y, 'walk'); }
      p.activity = 'walking to their car';
      if (!walkMinute(p)) return 'wait';
      p.x = car.x; p.y = car.y;
    }
    leaveSeat(ctx, p);
    startDrive(ctx, p, car, ctx.s.center.x, ctx.s.center.y);
  }
  p.pose = 'drive';
  p.activity = `driving for ${app.site!.name} (${(p.gig?.jobs ?? 0)} rides so far)`;
  if (driveMinute(ctx, p, car)) {
    // somewhere busy next: a random business within a couple of km
    const all = ctx.s.buildings;
    let t: Building | undefined;
    for (let i = 0; i < 12 && !t; i++) {
      const b = all[Math.floor(ctx.rng.next() * all.length)];
      if (b.built && b.firm >= 0 && Math.hypot(b.x - car.x, b.y - car.y) < 2000) t = b;
    }
    if (t) { const [x, y] = doorOf(t); car.path = route(ctx, car.x, car.y, x, y, 'drive'); }
  }
  return 'wait';
}

/**
 * Someone wants a ride (no car, far to go, an app on their phone): an app
 * car takes them. The fare goes to the nearest driver on the app (most of
 * it) and the app. Returns the car they ride in, or null (no driver free).
 */
export function hailRide(ctx: Ctx, p: Person, tx: number, ty: number): Vehicle | null {
  const app = siteOf(ctx, 'rides');
  if (!app || !p.pol.sites.includes(app.id)) return null;
  const drivers = onApp(ctx, app.id);
  if (!drivers.length) return null;
  const d = Math.hypot(tx - p.x, ty - p.y);
  const fare = 2 + (d / 1000) * 2.5;
  if (cashOf(ctx, p.id) < fare) return null;
  const driver = drivers.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
  addCash(ctx, p.id, -fare);
  addCash(ctx, driver.id, fare * 0.75);
  addCash(ctx, app.id, fare * 0.25);
  paymentFee(ctx, p, app.id, fare);
  driver.gig ??= { app: app.id, earned: 0, jobs: 0 };
  driver.gig.earned += fare * 0.75;
  driver.gig.jobs++;
  app.site!.volume = (app.site!.volume ?? 0) + fare;
  ctx.s.counters.rides = (ctx.s.counters.rides ?? 0) + 1;
  ctx.s.data = { ...(ctx.s.data ?? {}), ['rides:' + app.id]: (ctx.s.data?.['rides:' + app.id] ?? 0) + 1 };
  // the ride: an app car picks them up at the curb nearest to them
  const at = curbSpot(ctx, p.x, p.y, 0) ?? { x: p.x, y: p.y, heading: 0 };
  const v: Vehicle = {
    id: newId(ctx), kind: 'car', owner: app.id, x: at.x, y: at.y, px: at.x, py: at.y, heading: at.heading,
    path: route(ctx, at.x, at.y, tx, ty, 'drive'), driver: p.id, parkedAt: -1, cargo: emptyInv(), hue: app.site!.color, bought: ctx.s.tick, brand: app.site!.name,
  };
  ctx.s.vehicles.push(v);
  ctx.vById.set(v.id, v);
  leaveSeat(ctx, p);
  p.inside = -1;
  p.driving = v.id;
  return v;
}

/** At the end of a ride the app car drops them off and drives away (it's gone). */
export function endRide(ctx: Ctx, p: Person, v: Vehicle): void {
  p.driving = -1;
  removeVehicle(ctx, v);
}

/** A car is an app car (not theirs) they're riding in. */
export function isRide(ctx: Ctx, p: Person, v: Vehicle): boolean {
  return v.id !== p.car && ctx.fById.get(v.owner)?.site?.kind === 'rides';
}

/** Daily: app statistics roll over (yesterday's counts become the guide for today). */
export function appsDaily(ctx: Ctx): void {
  const d = ctx.s.data;
  if (!d) return;
  for (const k of Object.keys(d)) if (k.startsWith('gigs:') || k.startsWith('rides:')) d[k] *= 0.5;
  void hourOf;
  void MOVE;
  void BUILDINGS;
}

// ------------------------------------------------------------- crowdfunding

/** Start a crowdfunding campaign for a business (the 'crowdfund' step). */
export function launchCrowdfund(ctx: Ctx, p: Person, kind: Building['kind'], goal: number): void {
  const site = siteOf(ctx, 'crowd');
  if (!site) return;
  ctx.s.crowdfunds ??= [];
  if (ctx.s.crowdfunds.some((c) => c.founder === p.id && c.status === 'open')) return;
  const title = `${p.name.split(' ')[0]}'s ${BUILDINGS[kind].label.toLowerCase()}`;
  ctx.s.crowdfunds.push({ id: newId(ctx), founder: p.id, kind, title, goal: Math.round(goal), raised: 0, backers: [], site: site.id, start: ctx.s.tick, deadline: ctx.s.tick + 10 * 1440, status: 'open' });
  log(ctx, 'business', `${p.name} launched a crowdfunding campaign on ${site.site!.name}: "${title}" (goal ${Math.round(goal)}).`, { who: p.id, firm: site.id });
}

/** Someone browsing the crowdfunding site may back a campaign (more likely if they know the founder). */
export function maybeBack(ctx: Ctx, p: Person): void {
  const open = (ctx.s.crowdfunds ?? []).filter((c) => c.status === 'open' && c.founder !== p.id);
  if (!open.length || p.money < 120) return;
  const c = open[Math.floor(ctx.rng.next() * open.length)];
  const friend = p.rel[c.founder]?.trust ?? 0;
  const chance = 0.12 + 0.3 * friend + 0.15 * p.traits.curiosity + 0.08 * p.traits.agreeable;
  if (!ctx.rng.chance(chance)) return;
  // the well-off give more (and some back it as an investment in the city)
  const amount = Math.min(p.money * 0.08, 8 + ctx.rng.next() * 50 * (0.5 + friend) + p.money * 0.015 * p.traits.risk);
  addCash(ctx, p.id, -amount);
  c.raised += amount;
  const prev = c.backers.find((b) => b.who === p.id);
  if (prev) prev.amount += amount; else c.backers.push({ who: p.id, amount });
}

/** Daily: campaigns that reached their goal pay out (minus the site's cut); expired ones refund their backers. */
export function crowdDaily(ctx: Ctx): void {
  for (const c of ctx.s.crowdfunds ?? []) {
    if (c.status !== 'open') continue;
    const founder = ctx.byId.get(c.founder);
    const site = ctx.fById.get(c.site);
    if (c.raised >= c.goal && founder) {
      const cut = c.raised * (site?.site?.fee ?? 0.05);
      if (site) addCash(ctx, site.id, cut);
      addCash(ctx, founder.id, c.raised - cut);
      c.status = 'funded';
      delete founder.cooldown['found:' + c.kind];
      founder.cooldown.bizcheck = 0;
      log(ctx, 'business', `"${c.title}" was funded: ${c.backers.length} backers raised ${c.raised.toFixed(0)} on ${nameOf(ctx, c.site)}.`, { who: founder.id });
    } else if (ctx.s.tick > c.deadline || !founder) {
      for (const b of c.backers) addCash(ctx, b.who, b.amount);
      c.status = 'failed';
      if (founder) log(ctx, 'business', `"${c.title}" didn't reach its goal; the backers got their money back.`, { who: founder.id });
    }
  }
  if (ctx.s.crowdfunds && ctx.s.crowdfunds.length > 60) ctx.s.crowdfunds = ctx.s.crowdfunds.filter((c) => c.status === 'open' || ctx.s.tick - c.deadline < 20 * 1440);
}
