// A shift at work, minute by minute. What happens depends on the role:
// factory workers and farmhands make things at their station, loggers,
// quarry workers and miners walk out to the resource and carry loads back,
// drivers pick up shipments in trucks, builders go to their company's
// construction sites, cooks and waiters run the kitchen, cashiers the
// register, and office staff type away at computers.

import { GATHER, SERVICE_EXPORTS } from './config';
import { dayOf, type Ctx } from './ctx';
import { BUILDINGS, emptyInv, GOOD } from './goods';
import { buildMinute, deliveredFraction, farmFertility } from './buildings';
import { efficiency } from './firms';
import { payShift, staffAt } from './jobs';
import { stationsOf, toWorld } from './layout';
import { deliverShipment, driveMinute, finishIfEmpty, loadShipment, parkAt, payFreight, startDrive, TRUCK_CAPACITY, logDelivery } from './logistics';
import { route } from './roads';
import { yieldMultiplier, type YieldKind } from './scenarios';
import { workTogether } from './social';
import { capacityLeft, clock, leaveSeat, peopleInside, takeSeat, walkMinute, wearTool } from './tasks';
import { nextPavingJob, paveMinute, pavingFront, referenceWage } from './government';
import { addCash } from './ctx';
import { ROLE } from './goods';
import type { Building, Contract, Firm, Good, Person, Role, Step } from './types';
import { findResource, resourceArray, workSpot, wildPath } from './world';

type StepResult = 'wait' | 'instant' | 'minute';

export function workMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'work' | 'ownWork' }>): StepResult {
  const task = p.task!;
  let c: Contract | undefined, site: Building | undefined, role: Role;
  if (step.k === 'work') {
    c = ctx.cById.get(step.contract);
    site = c ? ctx.bById.get(c.site) : undefined;
    role = c?.role ?? 'worker';
  } else {
    site = ctx.bById.get(step.bid);
    role = site ? BUILDINGS[site.kind].jobs[0]?.role ?? 'worker' : 'worker';
  }
  if (!site || !site.built || site.ruined || (step.k === 'work' && !c)) return finish(ctx, p, c, site);
  // the employer (government staff work out of buildings the government doesn't run, like the trading post)
  const f = ctx.fById.get(c?.firm ?? site.firm) ?? ctx.fById.get(site.firm);
  const mem = (task.mem ??= {});
  const midTrip = (mem.phase ?? 0) > 0;
  if ((ctx.s.tick >= step.until && !midTrip) || ctx.s.tick >= step.until + 120) return finish(ctx, p, c, site);
  const dt = clock.dt;
  task.elapsed += dt;
  mem.worked = (mem.worked ?? 0) + dt;
  p.skills[role] = (p.skills[role] ?? 0) + dt / 60;
  if (Math.floor(task.elapsed / 60) > Math.floor((task.elapsed - dt) / 60)) meetColleagues(ctx, p, site);
  const def = BUILDINGS[site.kind];
  if (def.gathers) gatherWork(ctx, p, site, f, role, mem);
  else if (role === 'driver') driverWork(ctx, p, site, f, mem);
  else if (role === 'builder') builderWork(ctx, p, site, f, mem);
  else if (role === 'officer') patrolWork(ctx, p, site, mem);
  else stationWork(ctx, p, site, f, role, c, mem);
  return 'wait';
}

function finish(ctx: Ctx, p: Person, c: Contract | undefined, site: Building | undefined): StepResult {
  const task = p.task!;
  if (c && site) {
    const def = BUILDINGS[site.kind];
    const shiftMins = (def.hours[1] - def.hours[0]) * 60;
    payShift(ctx, c, Math.min(1, (task.mem?.worked ?? 0) / shiftMins));
    c.lastShiftDay = dayOf(ctx.s.tick);
  }
  // park the truck if they were out in one
  if (p.driving >= 0) {
    const v = ctx.vById.get(p.driving);
    if (v) parkAt(ctx, p, v, site);
  }
  leaveSeat(ctx, p);
  p.pose = 'stand';
  return 'instant';
}

function meetColleagues(ctx: Ctx, p: Person, site: Building): void {
  for (const o of peopleInside(ctx, site.id)) {
    if (o === p || o.inside !== site.id || !o.task) continue;
    const st = o.task.steps[o.task.i];
    if (st?.k === 'work' || st?.k === 'ownWork') { workTogether(ctx, p, o); return; }
  }
}

/** Index of a worker's station among the stations for their role. */
function stationFor(ctx: Ctx, site: Building, role: Role, c: Contract | undefined): number {
  const all = stationsOf(site);
  const mine: number[] = [];
  all.forEach((s, i) => { if (s.role === role) mine.push(i); });
  if (!mine.length) return -1;
  if (!c) return mine[mine.length - 1]; // owners take the last one
  const colleagues = staffAt(ctx, site.id, role).sort((a, b) => a.start - b.start);
  const k = Math.max(0, colleagues.findIndex((x) => x.id === c.id));
  return mine[k % mine.length];
}

// --------------------------------------------------------------- stations

function stationWork(ctx: Ctx, p: Person, site: Building, f: Firm | undefined, role: Role, c: Contract | undefined, mem: Record<string, number>): void {
  if (!mem.seated || p.inside !== site.id) {
    const idx = stationFor(ctx, site, role, c);
    if (idx >= 0) takeSeat(ctx, p, site, idx);
    else { p.inside = site.id; }
    mem.seated = 1;
  }
  const def = BUILDINGS[site.kind];
  const label = BUILDINGS[site.kind].label.toLowerCase();
  switch (role) {
    case 'cashier':
      p.pose = 'stand';
      p.activity = site.kind === 'dealer' ? 'selling cars' : 'working the register';
      return;
    case 'cook':
      p.pose = 'cook';
      p.activity = 'cooking';
      return;
    case 'waiter': {
      p.pose = 'serve';
      p.activity = 'waiting tables';
      // walk between the tables now and then
      if ((mem.worked ?? 0) % 7 === 0) {
        const tables = stationsOf(site).filter((s) => s.kind === 'table' && s.role === undefined);
        const t = tables[Math.floor(ctx.rng.next() * tables.length)];
        if (t) {
          const [x, y] = toWorld(site, t.lx + 0.8, t.lz);
          p.heading = Math.atan2(y - p.y, x - p.x);
          p.x = x;
          p.y = y;
        }
      }
      return;
    }
    case 'clerk':
    case 'manager':
    case 'civil':
    case 'journalist':
    case 'programmer':
    case 'sales':
      if (f && (site.kind === 'office' || site.kind === 'netco') && role !== 'sales') billClients(ctx, f, role);
      p.pose = role === 'sales' ? 'talk' : 'type';
      p.activity = role === 'manager' ? 'managing (at the computer)' : role === 'civil' ? 'processing paperwork at city hall'
        : role === 'journalist' ? 'writing a story' : role === 'programmer' ? `coding ${f?.site?.name ?? 'software'}` : 'working at a computer';
      return;
    case 'presenter': {
      const live = f?.channel && f.channel.onAir >= 0;
      p.pose = live ? 'talk' : 'sit';
      p.activity = live ? `presenting on ${f!.channel!.name}` : 'preparing the next show';
      return;
    }
  }
  if (def.recipe) {
    const ok = produceMinute(ctx, p, site, f);
    p.pose = ok ? (role === 'farmhand' ? 'gather' : 'manual') : 'stand';
    p.activity = ok ? (role === 'farmhand' ? 'working the fields' : `working at the ${label}`) : 'waiting for materials';
  } else {
    p.pose = 'stand';
    p.activity = `at the ${label}`;
  }
}

/** One minute of production at a site. Returns false if inputs ran out. */
export function produceMinute(ctx: Ctx, worker: Person, b: Building, f: Firm | undefined): boolean {
  const def = BUILDINGS[b.kind];
  const r = def.recipe!;
  const tool = worker.inv.tools > 0;
  const role = def.jobs[0]?.role ?? 'worker';
  const skill = 1 + Math.min(0.4, (worker.skills[role] ?? 0) / 500);
  let rate = (clock.dt / 60) * (tool ? r.toolBoost : 1) * skill * (f ? efficiency(ctx, f) : 1);
  if (b.kind === 'farm') rate *= farmFertility(ctx, b) * yieldMultiplier(ctx, 'farm');
  for (const [g, q] of Object.entries(r.inputs)) if (b.store[g as Good] < q! * rate) return false;
  for (const [g, q] of Object.entries(r.inputs)) b.store[g as Good] -= q! * rate;
  for (const [g, q] of Object.entries(r.outputs)) b.store[g as Good] += q! * rate;
  if (tool) wearTool(worker, 1 / 60);
  return true;
}

/**
 * Office work sold outside the city: consulting, accounting, legal work,
 * design, software. Every minute an office worker or programmer works, the
 * firm bills its clients elsewhere (money flows into the city, like goods
 * exports). How much the world buys at full price grows with the city
 * (SERVICE_EXPORTS); when the city's offices did more than that yesterday,
 * every firm's hours earn proportionally less today (the price falls for
 * everyone, not just whoever bills last).
 */
/** What the world buys at full price in one of the two markets each day. */
export function serviceDemand(ctx: Ctx): number {
  return SERVICE_EXPORTS.base + ctx.s.people.length * SERVICE_EXPORTS.perPerson;
}

/** The two markets: software ('Soft') for programmers, professional services ('Pro') for everyone else. */
export function serviceMarket(role: Role): 'Soft' | 'Pro' {
  return role === 'programmer' ? 'Soft' : 'Pro';
}

/** Today's price level in a market (1 = full price; less when the city sold more than the world wanted yesterday). */
export function serviceRate(ctx: Ctx, market: 'Soft' | 'Pro'): number {
  return ctx.s.data?.['svcMult' + market] ?? 1;
}

function billClients(ctx: Ctx, f: Firm, role: Role): void {
  const day = Math.floor(ctx.s.tick / 1440);
  const d = (ctx.s.data ??= {});
  if (d.svcDay !== day) {
    // a new day: yesterday's work at full price against what the world wants sets today's rates (smoothed)
    for (const m of ['Soft', 'Pro']) {
      const full = d['svcFull' + m] ?? 0;
      const target = full > serviceDemand(ctx) ? serviceDemand(ctx) / full : 1;
      d['svcMult' + m] = 0.5 * (d['svcMult' + m] ?? 1) + 0.5 * target;
      d['svcFull' + m] = 0;
    }
    d.svcDay = day; d.svcToday = 0;
  }
  const m = serviceMarket(role);
  // professional services bill clients well over what they pay their people (that's why firms want more desks)
  const full = ((referenceWage(ctx) * ROLE[role].pay * 1.7) / 480) * clock.dt * (0.6 + 0.8 * f.reputation) * (f.site ? 0.6 + f.site.quality : 1);
  const rate = full * (d['svcMult' + m] ?? 1);
  addCash(ctx, f.id, rate);
  d.svcToday += rate;
  d['svcFull' + m] = (d['svcFull' + m] ?? 0) + full;
  f.sales.billed = (f.sales.billed ?? 0) + rate;
}

// -------------------------------------------------------------- gatherers

const GATHER_LABEL: Record<string, string> = { wood: 'logging in the forest', clay: 'digging clay', stone: 'cutting stone', ore: 'mining ore' };

function gatherWork(ctx: Ctx, p: Person, site: Building, f: Firm | undefined, role: Role, mem: Record<string, number>): void {
  const def = BUILDINGS[site.kind];
  // quarry workers alternate between clay and stone
  const res = (site.kind === 'quarry' && p.id % 2 === 0 ? 'stone' : def.gathers!) as 'wood' | 'clay' | 'stone' | 'ore';
  const w = ctx.s.world;
  const phase = mem.phase ?? 0;
  if (phase === 0) {
    const tile = findResource(w, res, site.x, site.y, 2, ctx.rng, 55, ctx.s.tick);
    if (tile < 0) { p.activity = 'no resources nearby'; p.pose = 'stand'; return; }
    leaveSeat(ctx, p);
    const [x, y] = workSpot(w, tile);
    if (p.inside >= 0) { p.inside = -1; }
    p.path = wildPath(w, p.x, p.y, x, y);
    mem.tile = tile;
    mem.phase = 1;
    mem.load = 0;
    return;
  }
  if (phase === 1) {
    p.activity = `heading out (${GATHER_LABEL[res]})`;
    if (walkMinute(p)) mem.phase = 2;
    return;
  }
  if (phase === 2) {
    const arr = resourceArray(w, res);
    const tool = p.inv.tools > 0;
    const skill = 1 + Math.min(0.4, (p.skills[role] ?? 0) / 500);
    const amount = (GATHER[res] / 60) * (tool ? GATHER.toolBoost : 1) * skill * (f ? efficiency(ctx, f) : 1) * yieldMultiplier(ctx, res as YieldKind);
    p.pose = 'manual';
    p.activity = GATHER_LABEL[res];
    // (a loader and a truck: they bring back a load at a time)
    const full = (mem.load ?? 0) >= 40;
    if (arr[mem.tile] < amount || full) {
      p.path = route(ctx, p.x, p.y, site.x, site.y, 'walk');
      mem.phase = 3;
      return;
    }
    arr[mem.tile] -= amount;
    p.inv[res] += amount;
    mem.load = (mem.load ?? 0) + amount;
    if (tool) wearTool(p, 1 / 60);
    if ((mem.worked ?? 0) % 30 === 0) w.ver++;
    return;
  }
  // phase 3: carrying the load back
  p.activity = `hauling ${res} back`;
  if (walkMinute(p)) {
    const q = Math.floor(p.inv[res]);
    site.store[res] += q;
    p.inv[res] -= q;
    p.inside = site.id;
    mem.phase = 0;
  }
}

// ----------------------------------------------------------------- drivers

function driverWork(ctx: Ctx, p: Person, depot: Building, f: Firm | undefined, mem: Record<string, number>): void {
  if (!f) return;
  const phase = mem.phase ?? 0;
  const sh = ctx.s.shipments.find((x) => x.id === mem.sh);
  if (phase === 0) {
    // pick the open shipment whose pickup is closest
    let best = -1, bestD = Infinity;
    for (const s of ctx.s.shipments) {
      // (outside companies' trucks carry imports and exports themselves)
      if (s.status !== 'open' || s.carrier !== -1 || s.from < 0 || s.to < 0 || s.meal) continue;
      const from = ctx.bById.get(s.from);
      if (!from) continue;
      const d = Math.hypot(from.x - p.x, from.y - p.y);
      if (d < bestD) { bestD = d; best = s.id; }
    }
    const job = ctx.s.shipments.find((x) => x.id === best);
    if (!job) {
      if (p.inside !== depot.id || p.seat < 0) {
        const bay = stationsOf(depot).findIndex((s) => s.kind === 'bay');
        if (bay >= 0) takeSeat(ctx, p, depot, bay);
      }
      p.pose = 'stand';
      p.activity = 'waiting for deliveries';
      return;
    }
    job.carrier = f.id;
    job.driver = p.id;
    job.status = 'assigned';
    mem.sh = job.id;
    const truck = ctx.s.vehicles.find((v) => v.owner === f.id && v.kind === 'truck' && v.driver < 0 && (v.parkedAt === depot.id || Math.hypot(v.x - p.x, v.y - p.y) < 30));
    leaveSeat(ctx, p);
    p.inside = -1;
    const from = ctx.bById.get(job.from)!;
    if (truck) startDrive(ctx, p, truck, from.x, from.y);
    else p.path = route(ctx, p.x, p.y, from.x, from.y, 'walk');
    mem.phase = 1;
    return;
  }
  if (!sh && phase !== 4) { mem.phase = 4; returnToDepot(ctx, p, depot); return; }
  const moving = () => {
    if (p.driving >= 0) {
      const v = ctx.vById.get(p.driving)!;
      p.pose = 'drive';
      return driveMinute(ctx, p, v);
    }
    return walkMinute(p);
  };
  if (phase === 1 && sh) {
    p.activity = `driving to pick up ${describe(sh.goods)}`;
    if (moving()) {
      const cap = p.driving >= 0 ? TRUCK_CAPACITY : capacityLeft(p);
      const goods = loadShipment(ctx, sh, cap);
      const v = ctx.vById.get(p.driving);
      for (const g of Object.keys(goods) as Good[]) {
        if (v) v.cargo[g] += goods[g];
        else p.inv[g] += goods[g];
      }
      sh.status = 'loaded';
      const to = ctx.bById.get(sh.to);
      if (!to) { mem.phase = 4; return; }
      if (v) v.path = route(ctx, v.x, v.y, to.x, to.y, 'drive');
      else p.path = route(ctx, p.x, p.y, to.x, to.y, 'walk');
      mem.phase = 3;
    }
    return;
  }
  if (phase === 3 && sh) {
    p.activity = `delivering ${describe(sh.goods)} to ${ctx.bById.get(sh.to) ? BUILDINGS[ctx.bById.get(sh.to)!.kind].label.toLowerCase() : 'a customer'}`;
    if (moving()) {
      const v = ctx.vById.get(p.driving);
      const goods = emptyInv();
      for (const g of Object.keys(goods) as Good[]) {
        if (v) { goods[g] = v.cargo[g]; v.cargo[g] = 0; }
        else if (g !== 'tools') { goods[g] = p.inv[g]; p.inv[g] = 0; }
      }
      deliverShipment(ctx, sh, goods);
      payFreight(ctx, sh, f.id);
      f.sales.freight = (f.sales.freight ?? 0) + 1;
      logDelivery(ctx, f.id, sh);
      finishIfEmpty(ctx, sh);
      mem.sh = -1;
      mem.phase = 0; // look for the next job from here
      // if nothing is waiting, head back to the depot
      if (!ctx.s.shipments.some((s) => s.status === 'open' && s.carrier < 0)) { mem.phase = 4; returnToDepot(ctx, p, depot); }
    }
    return;
  }
  if (phase === 4) {
    p.activity = 'heading back to the depot';
    if (moving()) {
      if (p.driving >= 0) parkAt(ctx, p, ctx.vById.get(p.driving)!, depot);
      p.inside = depot.id;
      mem.phase = 0;
    }
  }
}

function returnToDepot(ctx: Ctx, p: Person, depot: Building): void {
  if (p.driving >= 0) {
    const v = ctx.vById.get(p.driving)!;
    v.path = route(ctx, v.x, v.y, depot.x, depot.y, 'drive');
  } else p.path = route(ctx, p.x, p.y, depot.x, depot.y, 'walk');
}

function describe(goods: Record<Good, number>): string {
  const top = (Object.keys(goods) as Good[]).filter((g) => goods[g] >= 1).sort((a, b) => goods[b] - goods[a])[0];
  return top ? `${Math.floor(goods[top])} ${GOOD[top].label}` : 'a load';
}

// ---------------------------------------------------------------- builders

/**
 * With no shipping company in town, builders carry materials to their
 * company's sites themselves. Returns true if they set off to fetch some.
 */
function fetchForSites(ctx: Ctx, p: Person, f: Firm, mem: Record<string, number>): boolean {
  if (ctx.s.buildings.some((b) => b.kind === 'depot' && b.built && !b.ruined && b.firm >= 0)) return false;
  const sh = ctx.s.shipments.find((s) => s.status === 'open' && s.carrier === -1 && s.from >= 0 && ctx.bById.get(s.to)?.builder === f.id);
  const from = sh ? ctx.bById.get(sh.from) : undefined;
  if (!sh || !from) return false;
  sh.carrier = f.id;
  sh.driver = p.id;
  sh.status = 'assigned';
  leaveSeat(ctx, p);
  p.inside = -1;
  p.path = route(ctx, p.x, p.y, from.x, from.y, 'walk');
  mem.sh = sh.id;
  mem.phase = 10;
  return true;
}

/** Phases 10 (walk to pickup), 11 (carry to the site). */
function haulMinute(ctx: Ctx, p: Person, mem: Record<string, number>): void {
  const sh = ctx.s.shipments.find((s) => s.id === mem.sh);
  if (!sh) { mem.phase = 0; return; }
  if (mem.phase === 10) {
    p.activity = 'fetching building materials';
    if (!walkMinute(p)) return;
    const goods = loadShipment(ctx, sh, capacityLeft(p));
    for (const g of Object.keys(goods) as Good[]) { p.inv[g] += goods[g]; mem['g_' + g] = goods[g]; }
    const to = ctx.bById.get(sh.to);
    if (!to) { mem.phase = 0; return; }
    p.path = route(ctx, p.x, p.y, to.x, to.y, 'walk');
    mem.phase = 11;
    return;
  }
  p.activity = 'carrying building materials';
  if (!walkMinute(p)) return;
  const goods = emptyInv();
  for (const g of Object.keys(goods) as Good[]) {
    const q = Math.min(p.inv[g], mem['g_' + g] ?? 0);
    goods[g] = q;
    p.inv[g] -= q;
    mem['g_' + g] = 0;
  }
  deliverShipment(ctx, sh, goods);
  finishIfEmpty(ctx, sh);
  mem.phase = 0;
}

/** Phases 20 (walk to the paving front) and 21 (paving, following the front along the street). */
function paveWork(ctx: Ctx, p: Person, f: Firm, mem: Record<string, number>): void {
  const g = ctx.govOfFirm.get(f.id);
  const e = ctx.edgeById.get(mem.road);
  if (!g || !e || e.built !== false || !e.paving) { mem.phase = 0; return; }
  if (mem.phase === 20) {
    p.activity = `walking to the road works on ${e.name ?? 'a street'}`;
    if (walkMinute(p)) mem.phase = 21;
    return;
  }
  const front = pavingFront(ctx, e);
  // stay with the front as it moves
  const side = ((p.id % 3) - 1) * 1.6;
  const tx = front.x - Math.sin(front.dir) * side + Math.cos(front.dir) * 1.5, ty = front.y + Math.cos(front.dir) * side + Math.sin(front.dir) * 1.5;
  if (Math.hypot(tx - p.x, ty - p.y) > 2.5) { p.x += (tx - p.x) * 0.5; p.y += (ty - p.y) * 0.5; }
  p.heading = front.dir + Math.PI;
  if (paveMinute(ctx, g, e, p)) {
    p.pose = 'build';
    p.activity = `paving ${e.name ?? 'a street'} (${Math.round((e.progress ?? 1) * 100)}%)`;
  } else {
    p.pose = 'stand';
    p.activity = 'waiting for stone at the road works';
    if (ctx.rng.chance(0.02)) mem.phase = 0;
  }
}

/** Police officers walk the streets of the city. */
function patrolWork(ctx: Ctx, p: Person, base: Building, mem: Record<string, number>): void {
  if (p.inside >= 0) { leaveSeat(ctx, p); p.inside = -1; }
  p.activity = 'on patrol';
  if (!p.path.length) {
    // the next stretch: somewhere busy within half a kilometer of the station
    const busy = ctx.s.buildings.filter((b) => b.built && !b.ruined && b.firm >= 0 && Math.hypot(b.x - base.x, b.y - base.y) < 500);
    const t = busy[Math.floor(ctx.rng.next() * busy.length)] ?? base;
    const [dx, dy] = [t.x + ctx.rng.range(-10, 10), t.y + ctx.rng.range(-10, 10)];
    p.path = route(ctx, p.x, p.y, dx, dy, 'walk');
    mem.legs = (mem.legs ?? 0) + 1;
    if (!p.path.length) { p.pose = 'stand'; return; }
  }
  walkMinute(p);
  p.pose = 'walk';
}

function builderWork(ctx: Ctx, p: Person, yard: Building, f: Firm | undefined, mem: Record<string, number>): void {
  if (!f) return;
  const phase = mem.phase ?? 0;
  if (phase === 0) {
    // the nearest site of ours where work can go on
    let best: Building | undefined, bestD = Infinity;
    for (const b of ctx.s.buildings) {
      if (b.builder !== f.id || b.built || b.ruined) continue;
      if (b.workDone >= b.workNeeded * Math.min(1, deliveredFraction(b) + 0.15) - 1) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best && fetchForSites(ctx, p, f, mem)) return;
    // a government's road crew paves streets when there's no building to put up
    const g = ctx.govOfFirm.get(f.id);
    const road = !best && g ? nextPavingJob(ctx, g, p) : undefined;
    if (road) {
      leaveSeat(ctx, p);
      p.inside = -1;
      const front = pavingFront(ctx, road);
      const side = ((p.id % 3) - 1) * 1.6;
      p.path = route(ctx, p.x, p.y, front.x - Math.sin(front.dir) * side, front.y + Math.cos(front.dir) * side, 'walk');
      mem.road = road.id;
      mem.phase = 20;
      return;
    }
    if (!best) {
      if (p.inside !== yard.id || p.seat < 0) {
        const idx = stationsOf(yard).findIndex((s) => s.role === 'builder');
        if (idx >= 0) takeSeat(ctx, p, yard, idx);
      }
      p.pose = 'stand';
      p.activity = 'waiting for materials at the yard';
      return;
    }
    leaveSeat(ctx, p);
    p.inside = -1;
    const a = ((p.id * 2654435761) % 1000) / 1000 * Math.PI * 2;
    const r = Math.max(best.w, best.d) / 2 + 1.5;
    p.path = route(ctx, p.x, p.y, best.x + Math.cos(a) * r, best.y + Math.sin(a) * r, 'walk');
    mem.site = best.id;
    mem.phase = 1;
    return;
  }
  if (phase >= 20) { paveWork(ctx, p, f, mem); return; }
  if (phase >= 10) { haulMinute(ctx, p, mem); return; }
  const site = ctx.bById.get(mem.site);
  if (!site || site.built || site.ruined) { mem.phase = 0; return; }
  if (phase === 1) {
    p.activity = `walking to a ${BUILDINGS[site.kind].label.toLowerCase()} site`;
    if (walkMinute(p)) {
      p.heading = Math.atan2(site.y - p.y, site.x - p.x);
      mem.phase = 2;
    }
    return;
  }
  p.pose = 'build';
  p.activity = `building a ${BUILDINGS[site.kind].label.toLowerCase()} for ${ctx.fById.get(site.owner)?.name ?? ctx.byId.get(site.owner)?.name ?? 'a client'}`;
  const before = site.workDone;
  const done = buildMinute(ctx, site, p);
  if (done || site.workDone === before) mem.phase = 0;
}
