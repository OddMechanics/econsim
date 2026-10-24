// Carrying out the steps of a person's current task, one game minute at a
// time: walking on sidewalks, driving or riding, entering buildings and
// taking a seat, shopping, ordering online, eating out, gigs and day labor…
// (Shifts at work are in production.ts.)

import { CARRY_CAPACITY, MOVE, OUTSIDE } from './config';
import { addCash, cashOf, hourOf, log, pay, type Ctx } from './ctx';
import { BUILDINGS, chooseFloors, DURABLES, GOOD, invWeight, ROLE } from './goods';
import { buildMinute, checkFinished, createBuilding, deliveredFraction, findLot } from './buildings';
import { doorOf, stationsOf, toWorld, worldHeading } from './layout';
import { learnPrices } from './market';
import { foundFirm, foundFirmIn, buildCost, recordSale } from './firms';
import { borrow } from './finance';
import { applyFor } from './jobs';
import { moveIn } from './housing';
import { createShipment, createVehicle, deliverShipment, driveMinute, finishIfEmpty, loadShipment, nextShippingTime, parkAt, startDrive } from './logistics';
import { startConstruction } from './construction';
import { route, zoneAt } from './roads';
import { workMinute } from './production';
import { browseMinute, postOnline, watchMinute } from './media';
import { flyerAt } from './advertising';
import { castBallot } from './elections';
import { canvassMinute, speakMinute } from './civic';
import { bookSpend, collectSalesTax, referenceWage } from './government';
import { noteOfficeWanted, redevelop } from './development';
import { endRide, gigMinute, hailRide, isRide, launchCrowdfund, placeOrder } from './online';
import { BUILDINGS as DEFS } from './goods';
import { emptyInv } from './goods';
import { askAround, hiringSites, visitedPlace } from './places';
import { GATE, type Building, type Good, type Person, type Place, type SimState, type Step } from './types';

/**
 * How many game minutes the step being run covers. People who are just
 * sleeping, relaxing at home or working at their desk or machine are updated
 * every few minutes in one go (it's what makes a big city fast); everyone
 * else minute by minute.
 */
export const clock = { dt: 1 };

/** Is this person doing something steady that can be updated a few minutes at a time? */
export function steadyStep(ctx: Ctx, p: Person): boolean {
  const t = p.task;
  if (!t || t.elapsed === 0 || p.driving >= 0 || p.path.length || p.needs.food < 25 || p.needs.health < 50) return false;
  const st = t.steps[t.i];
  if (st.k === 'sleep') return p.sleeping;
  if (st.k === 'idle') return true;
  // scrolling, watching TV, sitting in an audience: nothing changes minute to minute
  if (st.k === 'browse' || st.k === 'phone' || st.k === 'watch') return t.elapsed > 2;
  if (st.k === 'attend') return t.elapsed > 0;
  if (st.k === 'work' || st.k === 'ownWork') {
    if (!t.mem?.seated || (t.mem.phase ?? 0) > 0) return false;
    const c = st.k === 'work' ? ctx.cById.get(st.contract) : undefined;
    const role = c?.role;
    return role !== 'driver' && role !== 'builder' && role !== 'officer' && role !== 'logger' && role !== 'quarrier' && role !== 'miner';
  }
  return false;
}

export function setTask(ctx: Ctx, p: Person, label: string, steps: Step[]): void {
  p.task = { label, steps, i: 0, elapsed: 0, started: ctx.s.tick };
  p.path = [];
  p.sleeping = false;
}

function nextStep(p: Person): void {
  if (!p.task) return;
  p.task.i++;
  p.task.elapsed = 0;
  p.path = [];
  if (p.task.i >= p.task.steps.length) p.task = null;
}

export function capacityLeft(p: Person): number {
  return CARRY_CAPACITY - invWeight(p.inv);
}

// ------------------------------------------------------------------ seats
// Which customer/resident spots are taken (runtime only; rebuilt after load).

const seatMaps = new WeakMap<SimState, Map<number, Set<number>>>();

function seatMap(ctx: Ctx): Map<number, Set<number>> {
  let m = seatMaps.get(ctx.s);
  if (!m) {
    m = new Map();
    for (const p of ctx.s.people) if (p.inside >= 0 && p.seat >= 0) {
      if (!m.has(p.inside)) m.set(p.inside, new Set());
      m.get(p.inside)!.add(p.seat);
    }
    seatMaps.set(ctx.s, m);
  }
  return m;
}

export function takeSeat(ctx: Ctx, p: Person, b: Building, index: number): void {
  leaveSeat(ctx, p);
  const st = stationsOf(b)[index];
  if (!st) return;
  const [x, y] = toWorld(b, st.lx, st.lz);
  p.x = p.px = x;
  p.y = p.py = y;
  p.heading = worldHeading(b, st.facing);
  p.inside = b.id;
  p.seat = index;
  const m = seatMap(ctx);
  if (!m.has(b.id)) m.set(b.id, new Set());
  m.get(b.id)!.add(index);
}

export function leaveSeat(ctx: Ctx, p: Person): void {
  if (p.inside >= 0 && p.seat >= 0) seatMap(ctx).get(p.inside)?.delete(p.seat);
  p.seat = -1;
}

/** A free customer spot of a kind in a building (index into stationsOf), or -1. */
export function freeSpot(ctx: Ctx, b: Building, kind?: string): number {
  const all = stationsOf(b);
  const taken = seatMap(ctx).get(b.id);
  const options: number[] = [];
  all.forEach((s, i) => {
    if (s.role === undefined && (kind === undefined || s.kind === kind) && !taken?.has(i)) options.push(i);
  });
  return options.length ? options[Math.floor(ctx.rng.next() * options.length)] : -1;
}

/** The resident spot (bed/sofa/desk) of a person's own unit. */
export function homeSpot(b: Building, unit: number, kind: string): number {
  const all = stationsOf(b);
  const i = all.findIndex((s) => s.unit === unit && s.kind === kind);
  return i >= 0 ? i : all.findIndex((s) => s.kind === kind);
}

export function exitBuilding(ctx: Ctx, p: Person): void {
  if (p.inside < 0) return;
  const b = ctx.bById.get(p.inside);
  leaveSeat(ctx, p);
  p.inside = -1;
  if (b) {
    const [x, y] = doorOf(b);
    p.x = p.px = x;
    p.y = p.py = y;
  }
}

function placeXY(ctx: Ctx, place: Place): { x: number; y: number; b?: Building } | null {
  if (place.t === 'pt') return { x: place.x, y: place.y };
  const b = ctx.bById.get(place.id);
  if (!b) return null;
  const [x, y] = doorOf(b);
  return { x, y, b };
}

/** Who is inside each building this minute (rebuilt once per minute). */
const insideCache = new WeakMap<object, { t: number; m: Map<number, Person[]> }>();
const EMPTY: Person[] = [];
export function peopleInside(ctx: Ctx, site: number): Person[] {
  let c = insideCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) {
    c = { t: ctx.s.tick, m: new Map() };
    for (const p of ctx.s.people) {
      if (p.inside < 0) continue;
      const arr = c.m.get(p.inside);
      if (arr) arr.push(p); else c.m.set(p.inside, [p]);
    }
    insideCache.set(ctx.s, c);
  }
  return c.m.get(site) ?? EMPTY;
}

/** Is someone in this role (or the owner) at work in this building right now? */
export function staffPresent(ctx: Ctx, site: number, role?: string): boolean {
  for (const p of peopleInside(ctx, site)) {
    if (p.inside !== site || !p.task) continue;
    const st = p.task.steps[p.task.i];
    if (st?.k === 'work') {
      const c = ctx.cById.get(st.contract);
      if (c && c.site === site && (!role || c.role === role)) return true;
    } else if (st?.k === 'ownWork' && st.bid === site) return true;
  }
  return false;
}

// --------------------------------------------------------------- movement

/** Walk one minute along p.path. Returns true when the path is used up. */
export function walkMinute(p: Person): boolean {
  let budget = invWeight(p.inv) > CARRY_CAPACITY / 2 ? MOVE.loaded : MOVE.walk;
  while (budget > 0 && p.path.length) {
    const tx = p.path[0], ty = p.path[1];
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > 0.01) p.heading = Math.atan2(ty - p.y, tx - p.x);
    if (d <= budget) {
      p.x = tx; p.y = ty; budget -= d;
      p.path.splice(0, 2);
    } else {
      p.x += ((tx - p.x) / d) * budget;
      p.y += ((ty - p.y) / d) * budget;
      budget = 0;
    }
  }
  p.pose = invWeight(p.inv) > 6 ? 'carry' : 'walk';
  return p.path.length === 0;
}

// ------------------------------------------------------------------ steps

/**
 * Advance a person's current step by one minute. Instant steps chain within
 * the same minute. Returns true if the person did physical work.
 */
export function runStep(ctx: Ctx, p: Person): boolean {
  for (let guard = 0; guard < 8 && p.task; guard++) {
    const step = p.task.steps[p.task.i];
    const r = execute(ctx, p, step);
    if (r === 'wait') return step.k === 'daylabor' || step.k === 'build' || step.k === 'work' || step.k === 'ownWork';
    nextStep(p);
    if (r === 'minute') return false;
  }
  return false;
}

type StepResult = 'wait' | 'instant' | 'minute';

function execute(ctx: Ctx, p: Person, step: Step): StepResult {
  const s = ctx.s;
  const task = p.task!;
  switch (step.k) {
    case 'go': {
      const dest = placeXY(ctx, step.to);
      if (!dest) return 'instant';
      if (p.driving >= 0) {
        const v = ctx.vById.get(p.driving);
        if (!v) { p.driving = -1; return 'wait'; }
        const ride = isRide(ctx, p, v);
        p.pose = 'drive';
        p.activity = ride ? `riding with ${v.brand ?? 'a ride app'}` : 'driving';
        if (driveMinute(ctx, p, v)) {
          if (ride) { endRide(ctx, p, v); if (dest.b) { const [dx, dy] = doorOf(dest.b); p.x = dx; p.y = dy; } }
          else parkAt(ctx, p, v, dest.b);
          if (dest.b) p.inside = dest.b.id;
          return 'minute';
        }
        return 'wait';
      }
      if (task.elapsed === 0 && p.path.length === 0) {
        if (dest.b && p.inside === dest.b.id) return 'instant';
        exitBuilding(ctx, p);
        if (Math.hypot(dest.x - p.x, dest.y - p.y) < 1) {
          if (dest.b) p.inside = dest.b.id;
          return 'instant';
        }
        // far to go and no car: a ride-hailing app
        if (step.ride && p.car < 0 && hailRide(ctx, p, dest.x, dest.y)) { task.elapsed = 1; return 'wait'; }
        const car = ctx.vById.get(p.car);
        const far = Math.hypot(dest.x - p.x, dest.y - p.y) > MOVE.driveIfFartherThan;
        if (car && car.driver < 0 && far) {
          const toCar = Math.hypot(car.x - p.x, car.y - p.y);
          if (toCar < 12) {
            startDrive(ctx, p, car, dest.x, dest.y);
            task.elapsed = 1;
            return 'wait';
          }
          if (toCar < 300) {
            task.mem = { ...(task.mem ?? {}), toCar: 1 };
            p.path = route(ctx, p.x, p.y, car.x, car.y, 'walk');
          }
        }
        if (p.path.length === 0) p.path = route(ctx, p.x, p.y, dest.x, dest.y, 'walk');
      }
      task.elapsed++;
      p.activity = 'walking';
      if (walkMinute(p)) {
        if (task.mem?.toCar) {
          task.mem.toCar = 0;
          const car = ctx.vById.get(p.car);
          if (car && car.driver < 0) {
            startDrive(ctx, p, car, dest.x, dest.y);
            return 'wait';
          }
          p.path = route(ctx, p.x, p.y, dest.x, dest.y, 'walk');
          return 'wait';
        }
        if (dest.b) p.inside = dest.b.id;
        return 'minute';
      }
      return 'wait';
    }
    case 'sleep': {
      const home = ctx.bById.get(p.home);
      if (task.elapsed === 0 && home && p.inside === home.id) {
        const bed = homeSpot(home, p.unit, 'bed');
        if (bed >= 0) takeSeat(ctx, p, home, bed);
      }
      p.sleeping = true;
      task.elapsed += clock.dt;
      p.activity = 'sleeping';
      p.pose = 'sleep';
      const h = hourOf(s.tick);
      const morning = h >= 6 && h < 12;
      const daytime = h >= 6 && h < 21;
      if ((morning && p.needs.energy > 80) || (p.needs.energy >= 99.5 && daytime) || task.elapsed > 11 * 60) {
        p.sleeping = false;
        return 'instant';
      }
      return 'wait';
    }
    case 'idle': {
      const home = ctx.bById.get(p.home);
      if (task.elapsed === 0 && home && p.inside === home.id) {
        const sofa = homeSpot(home, p.unit, 'sofa');
        if (sofa >= 0) takeSeat(ctx, p, home, sofa);
      }
      // officials at city hall take their desk in the chamber
      const hall = task.elapsed === 0 ? ctx.bById.get(p.inside) : undefined;
      if (hall && hall.kind === 'cityhall') {
        const taken = seatMap(ctx).get(hall.id);
        const desk = stationsOf(hall).findIndex((st, i) => st.role === 'official' && !taken?.has(i));
        if (desk >= 0) takeSeat(ctx, p, hall, desk);
      }
      task.elapsed += clock.dt;
      p.activity = step.label;
      p.pose = step.pose ?? (p.seat >= 0 ? 'sit' : 'stand');
      if (p.inside === p.home && p.home >= 0) p.needs.fun = Math.min(100, p.needs.fun + 0.15 * clock.dt);
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'chat': {
      const b = ctx.bById.get(p.inside);
      if (task.elapsed === 0 && b) {
        const spot = freeSpot(ctx, b, b.kind === 'park' || b.kind === 'plaza' ? 'bench' : undefined);
        if (spot >= 0) takeSeat(ctx, p, b, spot);
      }
      task.elapsed++;
      p.activity = 'hanging out';
      p.pose = p.saying ? 'talk' : p.seat >= 0 ? 'sit' : 'stand';
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'browse': {
      const home = ctx.bById.get(p.home);
      if (task.elapsed === 0 && home && p.inside === home.id) {
        const desk = homeSpot(home, p.unit, 'desk');
        if (desk >= 0) takeSeat(ctx, p, home, desk);
        learnPrices(ctx, p, 'online');
      }
      const from = task.elapsed;
      task.elapsed += clock.dt;
      p.activity = `on the Net (${browseMinute(ctx, p, task.elapsed, from)})`;
      p.pose = 'type';
      p.needs.fun = Math.min(100, p.needs.fun + 0.5 * clock.dt);
      p.needs.social = Math.min(100, p.needs.social + 0.15 * clock.dt);
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'phone': {
      const from = task.elapsed;
      task.elapsed += clock.dt;
      if (task.elapsed === 1 && p.inside >= 0) {
        const b = ctx.bById.get(p.inside);
        if (b && p.seat < 0) { const spot = freeSpot(ctx, b, b.id === p.home ? undefined : 'bench'); if (spot >= 0) takeSeat(ctx, p, b, spot); }
      }
      p.activity = `scrolling the Net on their phone (${browseMinute(ctx, p, task.elapsed, from)})`;
      p.pose = 'phone';
      p.needs.fun = Math.min(100, p.needs.fun + 0.4 * clock.dt);
      p.needs.social = Math.min(100, p.needs.social + 0.1 * clock.dt);
      if (task.elapsed === 2) learnPrices(ctx, p, 'online');
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'watch': {
      const home = ctx.bById.get(p.home);
      if (task.elapsed === 0 && home && p.inside === home.id) {
        const sofa = homeSpot(home, p.unit, 'sofa');
        if (sofa >= 0) takeSeat(ctx, p, home, sofa);
      }
      task.elapsed += clock.dt;
      const what = watchMinute(ctx, p, clock.dt);
      p.activity = what ? `watching ${what}` : 'watching TV (nothing on)';
      p.pose = 'watch';
      p.needs.fun = Math.min(100, p.needs.fun + (what ? 0.55 : 0.2) * clock.dt);
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'vote': {
      const e = s.elections.find((x) => x.id === step.election);
      const b = ctx.bById.get(p.inside);
      if (task.elapsed === 0 && b) { const spot = freeSpot(ctx, b, 'desk') >= 0 ? freeSpot(ctx, b, 'desk') : freeSpot(ctx, b, 'spot'); if (spot >= 0) takeSeat(ctx, p, b, spot); }
      task.elapsed++;
      p.activity = 'voting';
      p.pose = 'vote';
      if (task.elapsed < 5) return 'wait';
      if (e && e.status === 'voting') castBallot(ctx, e, p);
      return 'instant';
    }
    case 'attend':
    case 'speak': {
      const ev = s.events.find((x) => x.id === step.event);
      if (!ev || s.tick >= Math.min(step.until, ev.end)) {
        if (ev && p.pol.protesting === ev.id) p.pol.protesting = -1;
        return 'instant';
      }
      const b = ctx.bById.get(ev.place);
      if (task.elapsed === 0 && b) {
        if (!ev.attendees.includes(p.id)) ev.attendees.push(p.id);
        if (ev.kind === 'protest') p.pol.protesting = ev.id;
        const want = step.k === 'speak' ? (b.kind === 'studio' ? 'podium' : 'stage') : ev.kind === 'session' ? (holdsSeat(ctx, ev.polity, p) ? 'desk' : 'seat') : ev.kind === 'debate' ? 'podium' : 'spot';
        let spot = freeSpot(ctx, b, want);
        if (spot < 0 && step.k === 'speak') spot = stationsOf(b).findIndex((st) => st.kind === want);
        if (spot < 0) spot = freeSpot(ctx, b, 'spot');
        if (spot < 0) spot = freeSpot(ctx, b, 'bench');
        if (spot >= 0) takeSeat(ctx, p, b, spot);
        else { p.inside = b.id; standAround(p, b); }
      }
      task.elapsed += step.k === 'attend' ? clock.dt : 1;
      const live = s.tick >= ev.start;
      if (step.k === 'speak') {
        p.pose = live ? 'speech' : 'stand';
        p.activity = live ? `speaking at the ${ev.kind}` : `waiting to speak (${ev.title})`;
        if (live) speakMinute(ctx, p, ev, task.elapsed);
      } else {
        const seated = p.seat >= 0 && ['seat', 'desk', 'bench'].includes(stationsOf(b!)[p.seat]?.kind ?? '');
        p.pose = !live ? (seated ? 'sit' : 'stand') : ev.kind === 'protest' ? 'protest' : ev.kind === 'rally' && task.elapsed % 9 < 3 ? 'cheer' : seated ? 'sit' : 'stand';
        p.activity = ev.kind === 'protest' ? `protesting: ${ev.cause}` : ev.kind === 'session' ? `at the ${ev.title.toLowerCase()}` : `listening to ${ev.title.replace(/^[^:]*: /, '')}`;
        if (live && ev.kind === 'protest' && task.elapsed % 10 === 0 && ctx.rng.chance(0.4)) { p.saying = ev.cause ?? 'Enough!'; p.sayingUntil = s.tick + 3; }
      }
      p.needs.social = Math.min(100, p.needs.social + 0.2 * (step.k === 'attend' ? clock.dt : 1));
      return 'wait';
    }
    case 'canvass': {
      task.elapsed++;
      p.activity = step.candidate === p.id ? 'knocking on doors for their campaign' : `knocking on doors for ${ctx.byId.get(step.candidate)?.name ?? 'a candidate'}`;
      p.pose = p.saying ? 'talk' : 'walk';
      if (p.path.length) walkMinute(p);
      else if (task.elapsed % 10 === 1) {
        // on to the next few houses
        const homes = s.buildings.filter((b) => BUILDINGS[b.kind].category === 'home' && b.built && Math.hypot(b.x - p.x, b.y - p.y) < 160);
        const next = homes[Math.floor(ctx.rng.next() * homes.length)];
        if (next) { const [dx, dy] = doorOf(next); p.path = route(ctx, p.x, p.y, dx, dy, 'walk'); }
      }
      canvassMinute(ctx, p, step.candidate, task.elapsed);
      return task.elapsed >= step.mins ? 'instant' : 'wait';
    }
    case 'poster': {
      const sponsor = ctx.byId.get(step.ad);
      const firm = ctx.fById.get(step.ad);
      const party = ctx.partyById.get(sponsor?.pol.party ?? -1);
      const name = sponsor ? `VOTE ${(sponsor.name.split(' ')[1] ?? sponsor.name).toUpperCase()}` : firm?.name ?? 'Notice';
      const tag = sponsor ? (s.elections.flatMap((e) => e.candidates).find((c) => c.person === sponsor.id)?.slogan ?? '') : firm ? firm.slogan : '';
      flyerAt(ctx, p.x, p.y, step.ad, name, tag, party?.hue ?? firm?.hue ?? sponsor?.looks.shirt ?? 0, sponsor ? 'campaign' : 'product');
      p.activity = 'putting up flyers';
      p.pose = 'manual';
      return 'minute';
    }
    case 'build': {
      const b = ctx.bById.get(step.bid);
      task.elapsed++;
      if (!b || b.built || b.ruined || task.elapsed > step.mins) return 'instant';
      if (task.elapsed === 1) standAround(p, b);
      p.activity = `building a ${BUILDINGS[b.kind].label.toLowerCase()}`;
      p.pose = 'build';
      const before = b.workDone;
      const done = buildMinute(ctx, b, p);
      p.skills.builder = (p.skills.builder ?? 0) + 1 / 60;
      if (done || b.workDone === before) return 'instant';
      return 'wait';
    }
    case 'work':
    case 'ownWork':
      return workMinute(ctx, p, step);
    case 'look': {
      // help-wanted signs and "for rent" banners around here, and asking people in the street
      p.knownJobs = s.tick;
      p.knownHomes = s.tick;
      askAround(ctx, p, 'job', 3, (b) => hiringSites(ctx).has(b.id));
      askAround(ctx, p, 'home', 3, (b) => b.units.some((u) => u.tenant < 0));
      return 'instant';
    }
    case 'order':
      placeOrder(ctx, p, step);
      return 'instant';
    case 'gig':
      return gigMinute(ctx, p, step);
    case 'daylabor':
      return dayLaborMinute(ctx, p, step);
    case 'crowdfund':
      launchCrowdfund(ctx, p, step.kind, step.goal);
      return 'instant';
    case 'claim':
      p.cooldown.welfare = s.tick + 30 * 1440;
      return 'instant';
    case 'soup': {
      // a bowl of soup and some bread: the city pays for it out of its welfare budget
      const g = ctx.gById.get(step.polity);
      task.elapsed++;
      p.activity = 'eating at the soup kitchen';
      p.pose = 'eat';
      if (task.elapsed === 1 && g) {
        const b = ctx.bById.get(p.inside);
        if (b) { const spot = freeSpot(ctx, b, 'spot') >= 0 ? freeSpot(ctx, b, 'spot') : freeSpot(ctx, b); if (spot >= 0) takeSeat(ctx, p, b, spot); }
        const cost = 1.5;
        // the city pays when it pays welfare; otherwise a charity, funded by donations from the well-off
        if (g.policy.welfare > 0 && pay(ctx, g.firm, -2, cost, false) > 0) bookSpend(ctx, g, 'soup kitchen', cost);
        else {
          const donor = ctx.s.people.reduce((a, q) => (q.money > a.money ? q : a), p);
          if (donor === p || pay(ctx, donor.id, -2, cost, false) <= 0) { p.activity = 'the soup kitchen ran out of food'; return 'instant'; }
        }
        p.needs.food = Math.min(100, p.needs.food + 40);
      }
      return task.elapsed >= 30 ? 'instant' : 'wait';
    }
    case 'shop':
      return shopMinute(ctx, p, step);
    case 'eatOut':
      return eatOutMinute(ctx, p, step);
    case 'deliver': {
      const b = ctx.bById.get(step.bid);
      if (!b) return 'instant';
      if (!b.built) {
        for (const g of Object.keys(b.needed) as Good[]) {
          const q = Math.min(b.needed[g], Math.floor(p.inv[g] + 1e-6));
          if (q > 0) { b.needed[g] -= q; p.inv[g] -= q; b.ver++; b.lastProgress = s.tick; }
        }
        checkFinished(ctx, b);
      } else {
        // only what this place uses (not the worker's own lunch)
        const uses = Object.keys(BUILDINGS[b.kind].recipe?.inputs ?? {}) as Good[];
        for (const g of uses) {
          if (p.inv[g] < 1) continue;
          b.store[g] += Math.floor(p.inv[g]);
          p.inv[g] -= Math.floor(p.inv[g]);
        }
      }
      return 'instant';
    }
    case 'pickup': {
      const b = ctx.bById.get(step.bid);
      if (!b) return 'instant';
      const q = Math.min(step.qty, Math.floor(b.store[step.good]), Math.floor(capacityLeft(p) / Math.max(0.1, GOOD[step.good].weight)));
      if (q > 0) { b.store[step.good] -= q; p.inv[step.good] += q; }
      return 'instant';
    }
    case 'fetch': {
      const sh = s.shipments.find((x) => x.id === step.shipment);
      if (!sh || sh.status !== 'open') return 'instant';
      const taken = loadShipment(ctx, sh, capacityLeft(p));
      task.mem = { ...(task.mem ?? {}) };
      for (const g of Object.keys(taken) as Good[]) {
        if (taken[g] <= 0) continue;
        p.inv[g] += taken[g];
        task.mem['g_' + g] = (task.mem['g_' + g] ?? 0) + taken[g];
      }
      task.mem.shipment = sh.id;
      return 'instant';
    }
    case 'drop': {
      const sh = s.shipments.find((x) => x.id === step.shipment);
      const goods = {} as Record<Good, number>;
      for (const g of Object.keys(p.inv) as Good[]) {
        const q = Math.min(p.inv[g], task.mem?.['g_' + g] ?? 0);
        goods[g] = q;
        p.inv[g] -= q;
      }
      if (sh) {
        deliverShipment(ctx, sh, goods);
        finishIfEmpty(ctx, sh);
      }
      return 'instant';
    }
    case 'store': {
      if (p.inside !== p.home) return 'instant';
      p.pantry.groceries += p.inv.groceries;
      p.inv.groceries = 0;
      return 'instant';
    }
    case 'apply': {
      applyFor(ctx, p, step.posting);
      p.activity = 'applying for a job';
      return 'instant';
    }
    case 'rent': {
      const b = ctx.bById.get(step.bid);
      const u = b?.units[step.unit];
      if (!b || !u || u.tenant >= 0) { if (b) visitedPlace(ctx, p, b, 'home', false); return 'instant'; }
      moveIn(ctx, p, b, step.unit);
      p.inside = b.id;
      visitedPlace(ctx, p, b, 'home', true);
      return 'instant';
    }
    case 'plan': {
      // a project already under way (one that was finished or torn down doesn't count)
      const cur = ctx.bById.get(p.projectId);
      if (p.projectId >= 0 && (!cur || cur.built || cur.ruined)) p.projectId = -1;
      if (p.projectId >= 0 && step.kind !== 'trailer') { p.cooldown['plan:' + step.kind] = s.tick + 720; return 'instant'; }
      if (step.kind === 'trailer') { buyTrailer(ctx, p); return 'instant'; }
      // a mortgage for a house when savings fall short (the bank wants the land and the house as security)
      let loan = 0;
      if (step.kind === 'house') {
        const cost = buildCost(ctx, p, 'house', step.floors) * 1.3 + 60;
        if (p.money < cost * 1.1) loan = borrow(ctx, p.id, cost * 1.1 - p.money, 120, 'a house');
      }
      const lot = findLot(ctx, step.kind, { x: p.x, y: p.y }, p.id);
      if (!lot) { p.cooldown['plan:' + step.kind] = s.tick + 1440; return 'instant'; }
      const price = lot.owner === p.id ? 0 : lot.forSale;
      const b = createBuilding(ctx, step.kind, lot, p.id, step.floors, false);
      if (loan > 0) { const l = s.loans.find((x) => x.borrower === p.id && x.purpose === 'a house' && x.collateral === undefined); if (l) l.collateral = b.id; }
      startConstruction(ctx, p.id, b);
      p.projectId = b.id;
      log(ctx, 'build', `${p.name} bought a lot${price > 0 ? ` for ${price.toFixed(0)}` : ''} and is having a ${BUILDINGS[step.kind].label.toLowerCase()} built.`, { who: p.id, bid: b.id });
      return 'instant';
    }
    case 'found': {
      // a vacant shop or office floor: lease it and open there
      if (step.lease !== undefined) {
        const unit = ctx.bById.get(step.lease);
        if (!unit || unit.firm >= 0 || unit.ruined) { p.cooldown.bizcheck = 0; return 'instant'; }
        const invest = Math.min(p.money - 120, BUILDINGS[step.kind].minFunds + 120);
        if (invest <= 0) return 'instant';
        foundFirmIn(ctx, p, step.kind, unit, invest);
        return 'instant';
      }
      // a development on the site of an old building: buy it and tear it down first
      if (step.redevelop !== undefined && !redevelop(ctx, p.id, step.redevelop)) { p.cooldown.develop = s.tick + 2 * 1440; return 'instant'; }
      let lot = step.lot !== undefined ? ctx.lotById.get(step.lot) : undefined;
      if (lot && (lot.building >= 0 || (lot.owner !== p.id && lot.forSale <= 0))) lot = undefined;
      lot ??= findLot(ctx, step.kind, null, p.id) ?? undefined;
      if (!lot) {
        p.cooldown['found:' + step.kind] = s.tick + 1440;
        if (BUILDINGS[step.kind].leasable === 'suite') noteOfficeWanted(ctx);
        return 'instant';
      }
      let floors = step.floors ?? chooseFloors(step.kind, lot.zone, s.people.length, ctx.rng.next());
      const cap = maxFloorsAt(ctx, lot.x, lot.y);
      if (cap > 0) floors = Math.max(DEFS[step.kind].floors[0], Math.min(floors, cap));
      // the land and some working capital now; the building is paid as it goes up (with a construction loan)
      const needed = BUILDINGS[step.kind].minFunds + 40 + (lot.owner === p.id ? 0 : lot.forSale) + buildCost(ctx, p, step.kind, floors) * 0.45;
      // they keep enough to live on
      if (p.money - 120 < needed) borrow(ctx, p.id, needed - (p.money - 120), 90, `starting a ${BUILDINGS[step.kind].label.toLowerCase()}`);
      const invest = Math.min(p.money - 120, needed);
      if (invest <= 0) return 'instant';
      foundFirm(ctx, p, step.kind, lot, invest, floors);
      if (step.floors) p.cooldown.develop = s.tick + 5 * 1440;
      return 'instant';
    }
  }
}

/**
 * A trailer home: buy a lot (out of town, cheap) and a used trailer from a
 * dealer outside; a truck brings it the next day and it's set up on the lot.
 */
function buyTrailer(ctx: Ctx, p: Person): void {
  const s = ctx.s;
  const price = BUILDINGS.trailer.delivered ?? 170;
  const lot = findLot(ctx, 'trailer', { x: p.x, y: p.y }, p.id);
  if (!lot || cashOf(ctx, p.id) < price + (lot.owner === p.id ? 0 : lot.forSale)) { p.cooldown['plan:trailer'] = s.tick + 1440; return; }
  const b = createBuilding(ctx, 'trailer', lot, p.id, 1, false);
  addCash(ctx, p.id, -price); // the dealer is outside the city
  b.builder = -1;
  p.projectId = b.id;
  createShipment(ctx, p.id, GATE, b.id, emptyInv(), OUTSIDE.id, { after: nextShippingTime(s.tick, 10) });
  log(ctx, 'home', `${p.name} bought a used trailer home for ${price}; it will be delivered to their lot tomorrow.`, { who: p.id, bid: b.id });
}

/** Day labor on a construction site: a few hours of hauling and helping, paid in cash by the builder. */
function dayLaborMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'daylabor' }>): StepResult {
  const task = p.task!;
  const b = ctx.bById.get(step.bid);
  const crew = ctx.fById.get(b?.builder ?? -1);
  const mem = (task.mem ??= {});
  const stop = !b || b.built || b.ruined || !crew || task.elapsed >= step.mins
    || b.workDone >= b.workNeeded * Math.min(1, deliveredFraction(b) + 0.15) - 1;
  if (stop) {
    const hours = (mem.worked ?? 0) / 60;
    if (crew && hours > 0.2) {
      const pay = Math.min(cashOf(ctx, crew.id), referenceWage(ctx) * ROLE.builder.pay * 0.7 * hours / 8);
      addCash(ctx, crew.id, -pay);
      addCash(ctx, p.id, pay);
      ctx.s.counters.dayLabor = (ctx.s.counters.dayLabor ?? 0) + 1;
      p.activity = `got ${pay.toFixed(1)} for day labor`;
    }
    return 'instant';
  }
  if (task.elapsed === 0) standAround(p, b!);
  task.elapsed++;
  mem.worked = (mem.worked ?? 0) + 1;
  p.activity = `day labor on a ${BUILDINGS[b!.kind].label.toLowerCase()} site`;
  p.pose = task.elapsed % 20 < 12 ? 'carry' : 'build';
  buildMinute(ctx, b!, p);
  // a helper is half as quick as a trained builder
  b!.workDone -= 0.5;
  p.skills.builder = (p.skills.builder ?? 0) + 1 / 120;
  return 'wait';
}

/** Builders spread out around the site instead of standing on one spot. */
function standAround(p: Person, b: Building): void {
  const a = ((p.id * 2654435761) % 1000) / 1000 * Math.PI * 2;
  const r = Math.max(b.w, b.d) / 2 + 1.5;
  p.x = b.x + Math.cos(a) * r;
  p.y = b.y + Math.sin(a) * r;
  p.heading = Math.atan2(b.y - p.y, b.x - p.x);
}

export function wearTool(p: Person, hours: number): void {
  p.toolWear += hours;
  if (p.toolWear >= (GOOD.tools.lifeDays ?? 40) * 3) {
    p.toolWear = 0;
    p.inv.tools = Math.max(0, p.inv.tools - 1);
  }
}

// --------------------------------------------------------------- customers

function shopMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'shop' }>): StepResult {
  const b = ctx.bById.get(step.store);
  const task = p.task!;
  if (!b || !b.built || b.ruined) return 'instant';
  const f = ctx.fById.get(b.firm);
  if (!f) return 'instant';
  if (task.elapsed === 0) {
    const spot = freeSpot(ctx, b, b.kind === 'dealer' ? 'showroom' : 'shelf');
    if (spot >= 0) takeSeat(ctx, p, b, spot);
  }
  task.elapsed++;
  p.activity = `shopping at ${f.name}`;
  p.pose = 'stand';
  if (task.elapsed < 8) return 'wait';
  const kind = b.kind === 'dealer' ? 'car' : 'shop';
  // a wasted trip: they won't be back for a while, and think less of the place
  const letDown = (why: string) => { p.activity = why; p.cooldown['store:' + b.id] = ctx.s.tick + 240; visitedPlace(ctx, p, b, kind, false); return 'instant' as const; };
  // pay at the counter: someone has to be working
  if (!staffPresent(ctx, b.id)) {
    if (task.elapsed < 25) return 'wait';
    return letDown('nobody at the counter');
  }
  const price = f.prices[step.good] ?? Infinity;
  if (price > step.max) return letDown('too expensive');
  const qty = Math.min(step.qty, Math.floor(b.store[step.good]), Math.floor(cashOf(ctx, p.id) / price));
  if (qty < 1) return letDown(b.store[step.good] < 1 ? 'sold out' : 'not enough money');
  visitedPlace(ctx, p, b, kind, true);
  addCash(ctx, p.id, -qty * price);
  addCash(ctx, f.id, qty * price);
  collectSalesTax(ctx, b, f.id, qty * price);
  b.store[step.good] -= qty;
  recordSale(f, step.good, qty);
  p.prices[step.good] = { p: price / 1.1, t: ctx.s.tick, src: 'seen' };
  const g = step.good;
  if (g === 'cars') {
    const v = createVehicle(ctx, 'car', p.id, b, ctx.rng.next());
    p.car = v.id;
    log(ctx, 'buy', `${p.name} bought a car from ${f.name} for ${price.toFixed(0)}!`, { who: p.id, firm: f.id });
    postOnline(ctx, p, `Just bought a new car from ${f.name}! 🚗`);
  } else if (g === 'computers' && step.device) {
    // electronics bought as a phone or a TV
    const first = (p.durables[step.device] ?? 0) <= 0;
    p.durables[step.device] = (p.durables[step.device] ?? 0) + (step.device === 'phone' ? 300 : 700);
    if (first) log(ctx, 'buy', `${p.name} bought a ${step.device === 'tv' ? 'TV' : 'phone'} from ${f.name}.`, { who: p.id, firm: f.id });
    if (step.device === 'phone' && first) postOnline(ctx, p, 'New phone! Finally on the Net. 📱');
  } else if (DURABLES.includes(g) && g !== 'tools') {
    p.durables[g] = (p.durables[g] ?? 0) + (GOOD[g].lifeDays ?? 30) * qty;
    if (g === 'computers') {
      log(ctx, 'buy', `${p.name} bought a computer and is now online.`, { who: p.id, firm: f.id });
      postOnline(ctx, p, 'Hello, Net! Finally got a computer.');
    }
  } else {
    p.inv[g] += qty;
  }
  return 'instant';
}

function eatOutMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'eatOut' }>): StepResult {
  const b = ctx.bById.get(step.restaurant);
  const task = p.task!;
  if (!b || !b.built || b.ruined) return 'instant';
  const f = ctx.fById.get(b.firm);
  if (!f) return 'instant';
  if (task.elapsed === 0) {
    const seat = freeSpot(ctx, b, 'table');
    if (seat < 0) { p.activity = 'restaurant is full'; visitedPlace(ctx, p, b, 'food', false); return 'instant'; }
    takeSeat(ctx, p, b, seat);
    task.mem = { served: 0 };
  }
  task.elapsed++;
  p.activity = `at ${f.name}`;
  p.pose = task.mem?.served ? 'eat' : 'sit';
  if (!task.mem?.served) {
    const price = f.prices.meal ?? 5;
    if (staffPresent(ctx, b.id, 'cook') || staffPresent(ctx, b.id)) {
      if (b.store.groceries >= 1.2 && cashOf(ctx, p.id) >= price) {
        b.store.groceries -= 1.2;
        addCash(ctx, p.id, -price);
        addCash(ctx, f.id, price);
        collectSalesTax(ctx, b, f.id, price);
        recordSale(f, 'meal', 1);
        task.mem!.served = 1;
        task.elapsed = 1;
        visitedPlace(ctx, p, b, 'food', true);
      } else if (task.elapsed > 15) { p.activity = 'left hungry'; visitedPlace(ctx, p, b, 'food', false); return 'instant'; }
    } else if (task.elapsed > 20) { p.activity = 'nobody to serve them'; visitedPlace(ctx, p, b, 'food', false); return 'instant'; }
    return 'wait';
  }
  if (task.elapsed >= 35) {
    p.needs.food = Math.min(100, p.needs.food + 48);
    p.needs.fun = Math.min(100, p.needs.fun + 22);
    p.needs.social = Math.min(100, p.needs.social + 8);
    return 'instant';
  }
  return 'wait';
}

function holdsSeat(ctx: Ctx, polity: number, p: Person): boolean {
  return !!ctx.gById.get(polity)?.offices.some((o) => o.holder === p.id && (o.kind === 'council' || o.kind === 'exec'));
}

/** A government's height limit at a place (0 = none). */
export function maxFloorsAt(ctx: Ctx, x: number, y: number): number {
  // the limit is for the neighborhoods: downtown is exempt
  if (zoneAt(ctx, x, y) === 'core') return 0;
  for (const g of ctx.s.polities) {
    if (g.status === 'gone' || g.policy.maxFloors <= 0) continue;
    if (g.cells.length && g.cells.includes(Math.floor(y / 50) * 40 + Math.floor(x / 50))) return g.policy.maxFloors;
  }
  return 0;
}
