// How people decide what to do next ("utility AI").
//
// Whenever someone finishes a task they list what they could do, score each
// option by what it's worth to *them* (needs, personality, money, beliefs),
// and pick the best. Scores are roughly "satisfaction per hour". The
// inspector shows the top options and why.
//
// It's a modern city: people earn money from jobs, their own businesses,
// gig apps and day labor; they buy food and things in shops and online,
// rent flats or buy trailers and houses (built by construction companies),
// and nobody lives off the land.

import { MINUTES_PER_DAY, MOVE, ONLINE, OUTSIDE } from './config';
import { serviceDemand, serviceRate } from './production';
import { cashOf, cityPop, dayOf, dayStart, hourOf, type Ctx } from './ctx';
import { BUILDINGS, BUSINESS_KINDS, comfortOf, EDIBLE, foodIn, GOOD, ROLE } from './goods';
import { deliveredFraction } from './buildings';
import { buildCost, sitesOf } from './firms';
import { yardFirms } from './construction';
import { lotsForSale } from './roads';
import { activeCampaign, eventsFor } from './civic';
import { openElectionFor, pollingPlace, willVote } from './elections';
import { joinsProtest } from './regime';
import { lampSpots } from './advertising';
import { hasStaff, quit, staffAt } from './jobs';
import { doorOf } from './layout';
import { canAfford, homeComfort, RENTALS, vacancies } from './housing';
import { banks, debtOf } from './finance';
import { brainBias, categoryOf, remember } from './brain';
import { setTask, staffPresent } from './tasks';
import { askingRent, vacantUnits } from './leases';
import { planDevelopment } from './development';
import { gigOutlook, isOnline, onlineStores, outsideRetailPrice, pendingDeliveries, siteOf } from './online';
import { govSite, mainPolity, polityOf, referenceWage } from './government';
import { ILLNESS, nearestCare, nearestHospital, tooSickToWork, visitCost } from './health';
import { askAround, ensurePlaces, knownOf, learnPlace, searchFor } from './places';
import { GOODS, type Building, type Crowdfund, type DecisionOption, type Firm, type Good, type Person, type Role, type Step } from './types';

interface Option extends DecisionOption {
  steps: () => Step[] | null;
}

const MAX_SCORE = 6;
const cap = (x: number) => Math.min(MAX_SCORE, x);
const fmt = (x: number) => x.toFixed(1);

interface View {
  ctx: Ctx;
  p: Person;
  hour: number;
  night: boolean;
  mv: number; // what one coin is worth to them now
  effort: number; // what an hour of work costs them
  fatigue: number;
  foodStock: number; // edible units carried + at home (+ on its way)
  foodTarget: number;
  foodUnit: number; // value of one more unit of food while below the buffer
  home: Building | undefined;
  project: Building | undefined;
  online: boolean; // has a phone or computer (and so the Net)
}

const hoursTo = (p: Person, x: number, y: number) => Math.hypot(x - p.x, y - p.y) / (p.car >= 0 ? MOVE.car * 0.6 : MOVE.walk) / 60;
const bHours = (p: Person, b: Building) => { const [x, y] = doorOf(b); return hoursTo(p, x, y); };
const go = (b: Building): Step => ({ k: 'go', to: { t: 'bld', id: b.id } });

function edibleCount(inv: Record<Good, number>): number {
  return foodIn(inv);
}

/** A person's taste for a food (0.6–1.4), stable for life. */
function taste(p: Person, g: Good): number {
  const h = Math.imul(p.id ^ 0x9e3779b9, 2654435761) ^ Math.imul(EDIBLE.indexOf(g) + 7, 40503);
  return 0.6 + ((h >>> 8) % 1000) / 1250;
}

/**
 * A basket of food at a store: `want` portions spread over what's on the
 * shelves, by their taste, the price (counts more when money is tight),
 * what they haven't had lately, and (for the better off) a liking for meat
 * and dairy. Each portion goes to the food that's most wanted given what's
 * already in the basket, so baskets come out varied.
 */
function foodBasket(v: View, b: Building, f: Firm, want: number): { list: Partial<Record<Good, number>>; exp: Partial<Record<Good, number>>; cost: number; n: number } | null {
  const { p } = v;
  const items = EDIBLE.filter((g) => (b.store[g] ?? 0) >= 1 && (f.prices[g] ?? 0) > 0);
  if (!items.length) return null;
  const weight = new Map(items.map((g) => {
    const price = f.prices[g]!;
    const fancy = g === 'meat' || g === 'dairy' ? 0.8 * Math.max(0, 1 - v.mv) : 0;
    return [g, (taste(p, g) * (1 + fancy)) / (1 + (p.ate?.[g] ?? 0)) / Math.pow(price, 0.5 + v.mv)];
  }));
  const list: Partial<Record<Good, number>> = {}, exp: Partial<Record<Good, number>> = {};
  let cost = 0, n = 0;
  for (let k = 0; k < want; k++) {
    let best: Good | null = null, bw = 0;
    for (const g of items) {
      const have = list[g] ?? 0;
      if (have + 1 > Math.floor(b.store[g]) || cost + f.prices[g]! > p.money) continue;
      const w = weight.get(g)! / (1 + have);
      if (w > bw) { bw = w; best = g; }
    }
    if (!best) break;
    list[best] = (list[best] ?? 0) + 1;
    exp[best] = f.prices[best]!;
    cost += f.prices[best]!;
    n++;
  }
  return n ? { list, exp, cost, n } : null;
}

/** How much a bank would probably lend them (0 if there's no bank yet). */
function creditOf(ctx: Ctx, p: Person): number {
  if (!banks(ctx).length) return 0;
  const c = ctx.cById.get(p.job);
  const income = c ? c.wage : p.firms.length ? 15 : p.hourly * 4;
  return Math.max(0, income * 0.4 * 60 - debtOf(ctx, p.id));
}

function makeView(ctx: Ctx, p: Person): View {
  const t = p.traits;
  let invValue = 0;
  for (const g of GOODS) invValue += p.inv[g] * p.prices[g].p;
  const fatigue = (100 - p.needs.energy) / 100;
  const hungerUrgency = Math.max(0, (60 - p.needs.food) / 60);
  const h = hourOf(ctx.s.tick);
  // groceries already ordered count toward the buffer (unless they're hungry now: then only what's at hand counts)
  let coming = 0;
  if (p.needs.food > 35) for (const sh of pendingDeliveries(ctx, p)) coming += foodIn(sh.goods);
  return {
    ctx, p, hour: h, night: h >= 21 || h < 6,
    // what money is worth to them: less the more they have, but the ambitious stay hungry for more
    mv: (0.6 + 0.8 * t.ambition) * Math.pow(80 / (80 + Math.max(0, p.money) + 0.5 * invValue), 0.5 - 0.25 * t.ambition),
    effort: 0.35 * (1.25 - t.diligence) * (1 + 0.8 * fatigue),
    fatigue,
    // (the pantry only counts with a home to keep it in)
    foodStock: edibleCount(p.inv) + (p.home >= 0 ? edibleCount(p.pantry) : 0) + coming,
    foodTarget: 4 + 6 * t.patience,
    foodUnit: 1.6 * (1 + 3 * hungerUrgency),
    home: ctx.bById.get(p.home),
    project: ctx.bById.get(p.projectId),
    online: isOnline(p),
  };
}

/**
 * How much they need to work for money: days of pay they have saved. People
 * with a cushion don't feel rewarded by small jobs the way people without one
 * do: they skip day labor and gig work, don't look for manual or low-skill
 * jobs, and leave such a job once they can afford to.
 */
function cushionDays(ctx: Ctx, p: Person): number {
  return Math.max(0, p.money) / Math.max(1, referenceWage(ctx));
}
const MANUAL = new Set<Role>(['farmhand', 'logger', 'quarrier', 'miner', 'worker', 'cashier', 'cook', 'waiter', 'driver', 'builder']);

/** A plan that failed recently (e.g. no land) waits before being tried again. */
function cooling(v: View, key: string): boolean {
  return (v.p.cooldown[key] ?? 0) > v.ctx.s.tick;
}

// People choose among the places they know (places.ts). Now and then (not at
// every decision) they look more up: on a search engine if they use one, on
// the delivery app, a job board or home listings.

/** The search engine they use, if any. */
function engineFor(v: View): Firm | undefined {
  if (!v.online) return undefined;
  const e = siteOf(v.ctx, 'search');
  return e && v.p.pol.sites.includes(e.id) ? e : undefined;
}

/** Is it time to look up places of this sort again? (Marks it done.) */
function searchDue(v: View, what: string, every: number): boolean {
  if (cooling(v, 'search:' + what)) return false;
  v.p.cooldown['search:' + what] = v.ctx.s.tick + every;
  return true;
}

/** How a search ranks places for someone: near them, and well thought of. */
const nearAndGood = (ctx: Ctx, p: Person) => (b: Building) => -Math.hypot(b.x - p.x, b.y - p.y) / 1000 + (ctx.fById.get(b.firm)?.reputation ?? 0.5);

// ------------------------------------------------------------- daily life

function sleepOption(v: View): Option | null {
  const p = v.p;
  let score: number;
  if (v.night) score = 5 + v.fatigue * 4;
  else if (p.needs.energy < 30) score = 2 + (30 - p.needs.energy) / 6;
  else return null;
  const home = v.home?.built && !v.home.ruined ? v.home : undefined;
  return {
    label: home ? 'Go home and sleep' : 'Sleep rough',
    score,
    why: `energy ${p.needs.energy.toFixed(0)}${v.night ? ', it is night' : ''}${home ? '' : ', no home'}`,
    steps: () => (home ? [go(home), { k: 'sleep' }] : [{ k: 'sleep' }]),
  };
}

function workOption(v: View): Option | null {
  const { ctx, p } = v;
  const c = ctx.cById.get(p.job);
  if (!c) return null;
  const site = ctx.bById.get(c.site);
  if (!site || !site.built || site.ruined) return null;
  // too ill to work: they call in sick
  if (tooSickToWork(p)) return null;
  const [start, end] = BUILDINGS[site.kind].hours;
  const day = dayOf(ctx.s.tick);
  const travel = bHours(p, site);
  if (c.lastShiftDay === day || v.hour >= end - 1 || v.hour * 60 + ctx.s.tick % 60 < start * 60 - travel * 60 - 45) return null;
  const until = dayStart(ctx.s.tick) + end * 60;
  return {
    label: `Go to work (${ROLE[c.role].label} at ${ctx.fById.get(c.firm)?.name ?? 'work'})`,
    score: 4.5 + v.mv * c.wage / 8,
    why: `shift ${start}:00–${end}:00 for ${c.wage.toFixed(0)}`,
    steps: () => [rideOrGo(v, site), { k: 'work', contract: c.id, until }],
  };
}

/**
 * Owners keep their own sites running when nobody else does: worth more the
 * less money they have (a struggling founder pitches in; a rich owner hires
 * someone for manual work and, at most, drops by to look after the business,
 * though a doctor still sees patients at their own practice).
 */
function ownWorkOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const wealthy = p.money > 40 * referenceWage(ctx);
  let checked = false;
  for (const fid of p.firms) {
    const f = ctx.fById.get(fid);
    if (!f || f.closed) continue;
    for (const b of sitesOf(ctx, f)) {
      if (!b.built) continue;
      const def = BUILDINGS[b.kind];
      const [start, end] = def.hours;
      if (v.hour < start - 1 || v.hour >= end - 1 || !def.jobs.length) continue;
      const role = def.jobs[0].role;
      const staffed = staffAt(ctx, b.id, role).length > 0;
      if (staffed) continue;
      // nothing to work with and no money to buy it: no point standing at the machine
      const r = def.recipe;
      if (r && Object.entries(r.inputs).some(([g, q]) => b.store[g as Good] < q! * 2) && f.cash < 5) continue;
      const until = Math.min(ctx.s.tick + 240, dayStart(ctx.s.tick) + end * 60);
      // (only manual work: a well-off doctor still sees patients at their own practice)
      if (wealthy && MANUAL.has(role)) {
        // the company hires for it; the owner looks in on the business now and then (no digging, no machines)
        if (checked || cooling(v, 'oversee:' + f.id)) continue;
        checked = true;
        out.push({
          label: `Look after the business (${f.name})`,
          score: cap(0.4 + 1.2 * p.traits.ambition + (f.losing > 2 ? 0.6 : 0) - 0.5 * v.effort),
          why: 'nobody works there yet; they can afford to hire, so they check on things rather than do the work',
          steps: () => { p.cooldown['oversee:' + f.id] = ctx.s.tick + 720; return [go(b), { k: 'idle', mins: 90, label: `looking after ${f.name}`, pose: 'stand' }]; },
        });
        continue;
      }
      out.push({
        label: `Work at own ${def.label.toLowerCase()} (${f.name})`,
        // pitching in pays (in their eyes) the more, the less money they have
        score: cap(0.6 + 2.2 * v.mv + 1.2 * p.traits.ambition + (f.cash < 20 ? 1 : 0) - v.effort),
        why: 'nobody else is working there yet',
        steps: () => [go(b), { k: 'ownWork', bid: b.id, until }],
      });
    }
  }
  return out;
}

/** Walking, driving their own car, or (far, no car, an app exists and they can pay) a ride. */
function rideOrGo(v: View, b: Building): Step {
  const { ctx, p } = v;
  if (p.car >= 0 || !v.online) return go(b);
  const [x, y] = doorOf(b);
  const d = Math.hypot(x - p.x, y - p.y);
  const rides = siteOf(ctx, 'rides');
  if (!rides || d < 1000 || !p.pol.sites.includes(rides.id)) return go(b);
  const fare = 2 + d / 1000 * 2.5;
  // worth it when the walk is long and money isn't tight: the time saved, and not arriving tired and late
  const saved = d / MOVE.walk / 60 - d / MOVE.car / 60;
  if (p.money < fare * 5 || v.mv * fare > saved * p.hourly * 2.5 + 0.8 * p.traits.comfortLove + v.fatigue) return go(b);
  return { k: 'go', to: { t: 'bld', id: b.id }, ride: true };
}

// --------------------------------------------------------------------- food

function eatAtHomeOption(v: View): Option | null {
  const { p } = v;
  if (!v.home || edibleCount(p.pantry) < 1 || p.inside === p.home || p.needs.food > 55 || edibleCount(p.inv) >= 1) return null;
  return {
    label: 'Go home to eat',
    score: cap(1 + v.foodUnit * 1.2 - bHours(p, v.home)),
    why: `hungry (${p.needs.food.toFixed(0)}), food in the fridge`,
    steps: () => [go(v.home!), { k: 'idle', mins: 25, label: 'eating at home', pose: 'eat' }],
  };
}

/** Is someone serving customers at this site right now (staff or the owner)? */
function staffed(ctx: Ctx, b: Building): boolean {
  return staffPresent(ctx, b.id) || hasStaff(ctx, b.id);
}

/** Stores open now (cached per minute; shared by everyone deciding this minute). */
interface Open { t: number; stores: Building[]; restaurants: Building[]; dealers: Building[]; open: Set<number> }
const openCache = new WeakMap<object, Open>();
function openPlaces(ctx: Ctx): Open {
  let c = openCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c;
  const h = hourOf(ctx.s.tick);
  const ok = (b: Building) => b.built && !b.ruined && b.firm >= 0 && h >= BUILDINGS[b.kind].hours[0] && h < BUILDINGS[b.kind].hours[1] - 1 && staffed(ctx, b);
  c = { t: ctx.s.tick, stores: [], restaurants: [], dealers: [], open: new Set() };
  for (const b of ctx.s.buildings) {
    if (b.kind === 'store' && ok(b)) c.stores.push(b);
    else if (b.kind === 'restaurant' && ok(b) && foodIn(b.store) >= 1.2) c.restaurants.push(b);
    else if (b.kind === 'dealer' && ok(b)) c.dealers.push(b);
  }
  for (const b of [...c.stores, ...c.restaurants, ...c.dealers]) c.open.add(b.id);
  openCache.set(ctx.s, c);
  return c;
}

/** How much they like a brand: the ads they've seen and how they were treated. */
const brand = (p: Person, firm: number) => p.pol.aware[firm] ?? 0;

function groceryOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const deficit = Math.max(0, v.foodTarget - v.foodStock);
  if (deficit < 1) return out;
  // a store they know of, in person (the best value nearby; places they like and brands they know get a preference)
  const open = openPlaces(ctx);
  const usable = (b: Building) => open.open.has(b.id) && foodIn(b.store) >= 1 && !cooling(v, 'store:' + b.id);
  let known = knownOf(ctx, p, 'shop').filter(({ b }) => usable(b));
  if (known.length < 2) {
    // nowhere they know has food right now: look it up, or (if they're getting hungry) ask around
    const engine = engineFor(v);
    if (engine && searchDue(v, 'shop', 360)) searchFor(ctx, p, 'shop', engine, open.stores.filter(usable), nearAndGood(ctx, p));
    known = knownOf(ctx, p, 'shop').filter(({ b }) => usable(b));
    if (!known.length && (p.needs.food < 40 || v.foodStock < 1)) {
      askAround(ctx, p, 'shop', 2, usable);
      known = knownOf(ctx, p, 'shop').filter(({ b }) => usable(b));
    }
  }
  let best: Option | null = null;
  for (const { b, pl } of known) {
    const f = ctx.fById.get(b.firm);
    if (!f) continue;
    const basket = foodBasket(v, b, f, Math.ceil(deficit));
    if (!basket) continue;
    const T = Math.max(0.6, bHours(p, b) * 2 + 0.25);
    // a varied basket is a little more appealing than more of the same
    const kinds = Object.keys(basket.list).length;
    const score = (basket.n * v.foodUnit - v.mv * basket.cost) / T + 0.5 * brand(p, f.id) + 0.6 * (pl.op ?? 0) + 0.1 * kinds;
    if (!best || score > best.score) {
      const what = (Object.keys(basket.list) as Good[]).sort((a, c) => (basket.list[c] ?? 0) - (basket.list[a] ?? 0)).map((g) => GOOD[g].label).join(', ');
      const first = Object.keys(basket.list)[0] as Good;
      best = {
        label: `Shop for food at ${f.name}`,
        score: v.foodUnit > 3 ? score : cap(score),
        why: `${basket.n} portions (${what}) for about ${basket.cost.toFixed(1)}; has ${v.foodStock.toFixed(0)} of ${v.foodTarget.toFixed(0)} at hand`,
        steps: () => [go(b), { k: 'shop', store: b.id, good: first, qty: basket.n, max: 0, list: basket.list, exp: basket.exp }, ...(v.home ? [go(v.home), { k: 'store' } as Step] : [])],
      };
    }
  }
  if (best) out.push(best);
  // online: a local store's web shop (or the marketplace), or an outside online retailer; delivered home
  if (v.online && v.home && deficit >= 2 && !pendingDeliveries(ctx, p).some((s) => s.goods.groceries > 0)) {
    let q = Math.ceil(deficit + 3);
    // waiting for a delivery is worse the hungrier they are (but food tomorrow beats no food)
    const wait = (hours: number) => 0.55 + 0.45 / (1 + (hours / 10) * Math.max(0, (60 - p.needs.food) / 30));
    let pick: { seller: number; price: number; fee: number; via: number; hours: number; name: string } | null = null;
    for (const { b, f, via } of onlineStores(ctx, 'groceries', q)) {
      const price = f.prices.groceries!;
      const total = price * q + ONLINE.localDeliveryFee;
      if (!pick || total < pick.price * q + pick.fee) pick = { seller: f.id, price, fee: ONLINE.localDeliveryFee, via, hours: 3, name: f.name };
      void b;
    }
    const outside = outsideRetailPrice(ctx, 'groceries');
    if (!pick || outside * q + ONLINE.deliveryFee < pick.price * q + pick.fee) pick = { seller: OUTSIDE.id, price: outside, fee: ONLINE.deliveryFee, via: -1, hours: 18, name: 'an online supermarket' };
    // short of money: as much as they can pay for
    q = Math.min(q, Math.floor((p.money - pick.fee) / pick.price));
    if (q >= 2) {
      const pk = pick;
      const score = (q * v.foodUnit * wait(pk.hours) - v.mv * (pk.price * q + pk.fee)) / 1.2 + (p.traits.comfortLove - 0.5) * 0.6;
      out.push({
        label: `Order ${q} groceries online from ${pk.name}`,
        score: v.foodUnit > 3 ? score : cap(score),
        why: `${pk.price.toFixed(2)} each + ${pk.fee.toFixed(1)} delivery, arrives in ~${pk.hours}h`,
        steps: () => [{ k: 'order', seller: pk.seller, good: 'groceries', qty: q, price: pk.price, via: pk.via }],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------- health

/**
 * Ill or hurt: stay home in bed, see a doctor (when it's bad enough to be
 * worth the price to them, or a check-up is due for a long-term condition),
 * or go to hospital in an emergency (at any hour, money or not).
 */
function healthOptions(v: View): Option[] {
  const { ctx, p } = v;
  const ill = p.ill;
  const out: Option[] = [];
  if (!ill) return checkupOption(v);
  if (ill.admitted !== undefined) return out;
  const serious = ill.kind === 'serious';
  const day = MINUTES_PER_DAY;
  const due = serious || (ill.kind === 'chronic'
    ? !(ill.seen !== undefined && ctx.s.tick - ill.seen < 25 * day)
    : ill.sev >= 0.25 && !(ill.seen !== undefined && ctx.s.tick - ill.seen < 2 * day));
  if (due && !cooling(v, 'doctor')) {
    let known = knownOf(ctx, p, 'care').map((x) => x.b);
    if (!known.length) {
      // for a doctor people ask further afield (out in the villages, the nearest one may be in town)
      const near = nearestCare(ctx, p);
      if (near) learnPlace(ctx, p, near, 'care', 'asked');
      known = knownOf(ctx, p, 'care').map((x) => x.b);
    }
    // the seriously ill go to a hospital; otherwise the nearest clinic or hospital that's seeing patients now
    const open = (b: Building) => { const [h0, h1] = BUILDINGS[b.kind].hours; return v.hour >= h0 && v.hour < h1 - 1; };
    const target = serious
      ? known.find((b) => b.kind === 'hospital') ?? nearestHospital(ctx, p) ?? known.filter(open)[0]
      : known.filter(open).sort((a, b) => bHours(p, a) - bHours(p, b))[0];
    // badly ill or hurt with no hospital bed in reach: an ambulance to the regional hospital outside the city
    if (!target?.kind.startsWith('hospital') && (serious ? ill.sev > 0.45 : ill.kind === 'injury' && ill.sev > 0.75) && !nearestHospital(ctx, p)) {
      out.push({
        label: 'Call an ambulance (regional hospital)',
        score: 6.5 + 3 * ill.sev,
        why: `${ILLNESS[ill.kind].label} (${Math.round(ill.sev * 100)}%) and no hospital bed in the city`,
        steps: () => [{ k: 'idle', mins: 20, label: 'waiting for the ambulance', pose: 'sleep' }, { k: 'away' }],
      });
    }
    if (target) {
      const f = ctx.fById.get(target.firm);
      const cost = visitCost(ctx, p, target);
      if (f && (cashOf(ctx, p.id) >= cost || (serious && target.kind === 'hospital'))) {
        // worth taking time off work for, unless it's just a cold
        // (a check-up put off for long becomes worth a morning off work)
        const overdue = ill.kind === 'chronic' ? (ctx.s.tick - (ill.seen ?? ill.since)) / day - 25 : 0;
        const worry = serious ? 6 + 3 * ill.sev : ill.kind === 'chronic' ? Math.min(7, 2.2 + Math.max(0, overdue) / 6) : ill.kind === 'cold' ? 1 + 2 * ill.sev : 2.8 + 3.5 * ill.sev;
        out.push({
          label: serious ? `Go to the hospital (${f.name})` : `See a doctor at ${f.name}`,
          score: serious ? worry : cap(worry - v.mv * cost / 4 - bHours(p, target)),
          why: `${ILLNESS[ill.kind].label} (${Math.round(ill.sev * 100)}%)${ill.kind === 'chronic' ? ', due for a check-up' : ''}; costs them ${cost.toFixed(1)}`,
          steps: () => [rideOrGo(v, target), { k: 'clinic', bid: target.id }],
        });
      }
    }
  }
  if (tooSickToWork(p) && v.home?.built) {
    // a doctor first (if they mean to see one), then bed
    const doctorFirst = out.some((o) => o.label.startsWith('See a doctor') && o.score > 1.5);
    out.push({
      label: 'Stay home sick',
      score: 2.2 + 3 * ill.sev - (doctorFirst ? 1.2 : 0),
      why: `${ILLNESS[ill.kind].label}: in no state to work`,
      steps: () => [go(v.home!), { k: 'idle', mins: 180, label: `home sick (${ILLNESS[ill.kind].label})`, pose: 'sleep' }],
    });
  }
  return out;
}

/** A yearly check-up at a clinic they know (when it's open and the price doesn't put them off). */
function checkupOption(v: View): Option[] {
  const { ctx, p } = v;
  const due = p.cooldown.checkup ??= ctx.s.tick + Math.floor(ctx.rng.next() * 365 * MINUTES_PER_DAY);
  if (due > ctx.s.tick || cooling(v, 'doctor')) return [];
  const clinic = knownOf(ctx, p, 'care').map((x) => x.b).find((b) => { const [h0, h1] = BUILDINGS[b.kind].hours; return v.hour >= h0 && v.hour < h1 - 1; });
  const f = clinic ? ctx.fById.get(clinic.firm) : undefined;
  if (!clinic || !f) return [];
  const cost = visitCost(ctx, p, clinic);
  if (cashOf(ctx, p.id) < cost * 3) return [];
  return [{
    label: `Go for a check-up at ${f.name}`,
    score: cap(1.4 - v.mv * cost / 4 - bHours(p, clinic) + 0.3 * p.traits.patience),
    why: `a yearly check-up; costs them ${cost.toFixed(1)}`,
    steps: () => [rideOrGo(v, clinic), { k: 'clinic', bid: clinic.id }],
  }];
}

/** Out of work, broke, and not online: apply for welfare in person at city hall. */
function welfareOption(v: View): Option | null {
  const { ctx, p } = v;
  if (v.online || p.job >= 0 || p.firms.length || p.money > 80 || (p.cooldown.welfare ?? 0) > ctx.s.tick || v.hour < 9 || v.hour >= 16) return null;
  const g = polityOf(ctx, p);
  const hall = g && g.policy.welfare > 0 ? ctx.bById.get(g.seat) : undefined;
  if (!hall?.built) return null;
  return {
    label: 'Apply for welfare at city hall',
    score: cap(1.2 + (80 - p.money) / 40 - bHours(p, hall) * 0.5),
    why: `out of work, ${p.money.toFixed(0)} left; no phone to apply online`,
    steps: () => [go(hall), { k: 'idle', mins: 40, label: 'filling in a welfare claim at city hall', pose: 'stand' }, { k: 'claim' }],
  };
}

/** Broke and hungry: a free meal at the soup kitchen (the city's if it pays welfare, otherwise a charity's). */
function soupKitchenOption(v: View): Option | null {
  const { ctx, p } = v;
  // (a shelter's kitchen serves late for anyone starving; anyone who can't afford a few days' food may come,
  // and so may anyone starving who can't get food elsewhere: shops sold out, nowhere to cook)
  if (p.needs.food > 40 || (p.money > 20 && p.needs.food > 18) || (v.night && p.needs.food > 15)) return null;
  const g = polityOf(ctx, p) ?? mainPolity(ctx);
  // at city hall; without one, a charity runs it in a park or at a shop
  const site = (g ? govSite(ctx, g) : undefined) ?? hangouts(ctx)[0] ?? openPlaces(ctx).stores[0];
  if (!g || !site) return null;
  return {
    label: 'Get a free meal at the soup kitchen',
    score: cap(1.5 + v.foodUnit - bHours(p, site) * 0.5 - 0.6 * p.traits.ambition),
    why: `no money, hungry (${p.needs.food.toFixed(0)})`,
    steps: () => [go(site), { k: 'soup', polity: g.id }],
  };
}

function eatOutOption(v: View): Option | null {
  const { ctx, p } = v;
  if (p.needs.food > 70 && p.needs.fun > 60) return null;
  // restaurants they know of that are open (none: maybe look one up)
  const open = openPlaces(ctx);
  let known = knownOf(ctx, p, 'food').filter(({ b }) => open.open.has(b.id));
  if (!known.length) {
    const engine = engineFor(v);
    if (engine && searchDue(v, 'food', 720)) searchFor(ctx, p, 'food', engine, open.restaurants, nearAndGood(ctx, p));
    known = knownOf(ctx, p, 'food').filter(({ b }) => open.open.has(b.id));
  }
  let best: Option | null = null;
  for (const { b, pl } of known) {
    const f = ctx.fById.get(b.firm);
    const price = f?.prices.meal;
    if (!f || !price || p.money < price * 1.5) continue;
    const value = 2.2 * (1 + (100 - p.needs.food) / 50) + 2 * (100 - p.needs.fun) / 100 * (0.5 + p.traits.comfortLove) + p.traits.sociability + 0.8 * brand(p, f.id) + 0.8 * (pl.op ?? 0);
    const T = Math.max(0.8, bHours(p, b) * 2 + 0.6);
    const score = cap((value - v.mv * price) / T + 0.2);
    if (!best || score > best.score) {
      best = {
        label: `Eat at ${f.name}`,
        score,
        why: `meal ${price.toFixed(2)}; hungry ${(100 - p.needs.food).toFixed(0)}%, wants some fun`,
        steps: () => [rideOrGo(v, b), { k: 'eatOut', restaurant: b.id }],
      };
    }
  }
  return best;
}

/** A meal delivered by a food-delivery app's courier. */
function deliveryOption(v: View): Option | null {
  const { ctx, p } = v;
  const app = siteOf(ctx, 'delivery');
  // at home (or, with no home, wherever they are: couriers deliver to a park bench too)
  if (!app || !v.online || (v.home && p.inside !== p.home) || p.needs.food > 55 || !p.pol.sites.includes(app.id)) return null;
  if (pendingDeliveries(ctx, p).some((s) => s.meal)) return null;
  // the app shows the restaurants near them (the top few, sponsored first); they may know others already
  const open = openPlaces(ctx);
  if (searchDue(v, 'app', 720)) searchFor(ctx, p, 'food', app, open.restaurants, nearAndGood(ctx, p));
  let best: { b: Building; price: number; name: string; firm: number } | undefined;
  for (const { b, pl } of knownOf(ctx, p, 'food')) {
    if (!open.open.has(b.id)) continue;
    const f = ctx.fById.get(b.firm);
    const price = f?.prices.meal;
    if (!f || !price) continue;
    const cost = price + Math.hypot(b.x - p.x, b.y - p.y) / 1000 - (pl.op ?? 0) * 1.5;
    if (!best || cost < best.price) best = { b, price, name: f.name, firm: f.id };
  }
  if (!best) return null;
  const total = best.price + ONLINE.mealDeliveryFee;
  if (p.money < total * 2) return null;
  const value = 2.2 * (1 + (100 - p.needs.food) / 50) + 0.6 * p.traits.comfortLove + 0.6 * v.fatigue;
  const pk = best;
  return {
    label: `Order a meal from ${pk.name} (${app.site!.name})`,
    score: cap((value - v.mv * total) / 0.9),
    why: `${total.toFixed(1)} with delivery; tired and hungry`,
    steps: () => [{ k: 'order', seller: pk.firm, good: 'groceries', qty: 0, price: pk.price, via: app.id, meal: true }],
  };
}

// --------------------------------------------------------------------- jobs

function jobOptions(v: View, bestSide: number): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const c = ctx.cById.get(p.job);
  if (p.firms.length && !c) return out; // business owners run their business
  if (c && ctx.s.tick - c.start < 4 * MINUTES_PER_DAY) return out;
  // people glance at the job ads now and then, not every time they decide something (job seekers often)
  const checking = (p.cooldown.jobcheck ?? 0) <= ctx.s.tick;
  if (c && !checking) return out;
  if (checking) p.cooldown.jobcheck = ctx.s.tick + (c ? 720 : 90);
  // a job board (if they're online): its search shows the few openings that fit them best, sponsored first
  const board = v.online ? siteOf(ctx, 'jobs') ?? siteOf(ctx, 'classifieds') : undefined;
  let best: { id: number; wage: number; label: string; site: Building } | undefined;
  if (checking) {
    // what each opening they could do would be worth to them
    const fits: { post: (typeof ctx.s.postings)[number]; site: Building; label: string; value: number }[] = [];
    const cushion = cushionDays(ctx, p);
    for (const post of ctx.s.postings) {
      if (post.applicants.includes(p.id)) continue;
      const f = ctx.fById.get(post.firm);
      const site = ctx.bById.get(post.site);
      if (!f || !site || f.owner === p.id) continue;
      // employers want the schooling a job needs (a bit of slack)
      if (p.edu < ROLE[post.role].edu - 1) continue;
      // comfortably off: no manual or low-skill work (a career job can still appeal to the ambitious)
      if (MANUAL.has(post.role) && cushion > 200) continue;
      // distance matters: a long commute eats into the day
      const commute = v.home ? Math.hypot(site.x - v.home.x, site.y - v.home.y) / (p.car >= 0 ? MOVE.car : MOVE.walk) / 60 : 0;
      fits.push({ post, site, label: `${ROLE[post.role].label} at ${f.name}`, value: post.wage - commute * 2 * p.hourly + Math.min(4, (p.skills[post.role] ?? 0) / 40) });
    }
    if (board && fits.length) {
      const bestAt = new Map<number, number>();
      for (const x of fits) bestAt.set(x.site.id, Math.max(bestAt.get(x.site.id) ?? -Infinity, x.value));
      searchFor(ctx, p, 'job', board, [...new Set(fits.map((x) => x.site))], (b) => bestAt.get(b.id) ?? 0);
    }
    // they can only apply where they know there's an opening: from the board, friends, signs, places they know
    const knownSites = new Set(knownOf(ctx, p, 'job').map((x) => x.b.id));
    for (const x of fits) {
      if (!knownSites.has(x.site.id)) continue;
      if (!best || x.value > best.wage) best = { id: x.post.id, wage: x.value, label: x.label, site: x.site };
    }
    const minimum = c ? c.wage * 1.25 : 0;
    if (best && best.wage > minimum) {
      // a steady wage matters less the more they have put by
      const need = 1 / (1 + cushionDays(ctx, p) / 40);
      const rate = v.mv * best.wage / 8 - v.effort + 0.3 * (1 - p.traits.risk) * need;
      if (rate > bestSide * 1.05 || (!c && rate > bestSide * 0.8)) {
        const postId = best.id;
        const site = best.site;
        const online = !!board;
        out.push({
          label: `Apply: ${best.label}`,
          score: cap(rate + (c ? 0 : 0.6 * need)),
          why: `pays about ${best.wage.toFixed(0)} a shift${c ? ' (more than now)' : ''}${online ? `, applying on ${board?.site?.name ?? 'the Net'}` : ''}`,
          steps: () => (online ? [{ k: 'apply', posting: postId }] : [go(site), { k: 'apply', posting: postId }]),
        });
      }
    }
  }
  if (!best && !c && !board) {
    // no openings they know of: walk around asking at businesses with a help-wanted sign
    const hiring = ctx.s.postings.map((x) => ctx.bById.get(x.site)).filter((b): b is Building => !!b && b.built);
    const target = hiring.length ? hiring.reduce((a, b) => (bHours(p, b) < bHours(p, a) ? b : a)) : ctx.s.buildings.find((b) => b.firm >= 0 && b.built);
    // (a round of asking takes a while to pay off: applications are answered within the hour or so)
    if (target && !cooling(v, 'look:job')) out.push({
      label: 'Look for work around the city',
      score: 0.9 + 0.4 * (1 - p.traits.risk) + 0.4 * p.traits.ambition,
      why: hiring.length ? 'walking around, asking at businesses with a help-wanted sign' : 'asking around for work',
      steps: () => { p.cooldown['look:job'] = ctx.s.tick + 180; return [go(target), { k: 'look' }]; },
    });
  }
  return out;
}

/** Building sites taking day laborers right now, with how many are already on each (cached per minute). */
const laborCache = new WeakMap<object, { t: number; list: { b: Building; taken: { n: number } }[] }>();
function laborSites(ctx: Ctx): { b: Building; taken: { n: number } }[] {
  // looked up every 10 minutes (counting who's already there means going through everyone)
  const c = laborCache.get(ctx.s);
  if (c && ctx.s.tick - c.t < 10 && ctx.s.tick >= c.t) return c.list;
  const list: { b: Building; taken: { n: number } }[] = [];
  const byId = new Map<number, { n: number }>();
  for (const b of sitesUnderConstruction(ctx)) {
    if (b.builder < 0) continue;
    if (b.workDone >= b.workNeeded * Math.min(1, deliveredFraction(b) + 0.15) - 60) continue;
    const crew = ctx.fById.get(b.builder);
    if (!crew || crew.cash < 40) continue;
    const taken = { n: 0 };
    byId.set(b.id, taken);
    list.push({ b, taken });
  }
  for (const q of ctx.s.people) {
    const st = q.task?.steps[q.task.i];
    if (st?.k === 'daylabor') { const t = byId.get(st.bid); if (t) t.n++; }
  }
  laborCache.set(ctx.s, { t: ctx.s.tick, list });
  return list;
}

/** Cash-in-hand work for people without a steady job: construction sites, and gig apps. */
function sideWorkOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  if (p.job >= 0 && ctx.cById.get(p.job)?.lastShiftDay !== dayOf(ctx.s.tick) && v.hour < 17) return out;
  if (p.firms.length) return out;
  // with two months' pay put by, a few hours of day labor or deliveries just isn't worth it to them
  if (cushionDays(ctx, p) > 60) return out;
  // day labor: builders take on a few extra hands at their sites (from early morning)
  if (p.job < 0 && v.hour >= 6 && v.hour < 13) {
    let site: Building | undefined, bd = Infinity, slot: { n: number } | undefined;
    for (const { b, taken } of laborSites(ctx)) {
      if (taken.n >= 3) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd && d < 1800) { bd = d; site = b; slot = taken; }
    }
    if (site) {
      const pay = referenceWage(ctx) * ROLE.builder.pay * 0.7 * 0.5;
      const s2 = site;
      out.push({
        label: 'Look for day labor at a building site',
        score: cap(0.4 + v.mv * pay / 4 + (p.money < 15 ? 1.2 : 0) + (v.foodStock < 2 ? 0.8 : 0) - v.effort),
        why: `the builders pay cash, about ${pay.toFixed(0)} for a few hours`,
        steps: () => { if (slot) slot.n++; return [go(s2), { k: 'daylabor', bid: s2.id, mins: 240 }]; },
      });
    }
  }
  // gig apps: deliveries (on foot or by car) and rides (own car)
  if (v.online && v.hour >= 8 && v.hour < 22 && !cooling(v, 'gig')) {
    for (const kind of ['delivery', 'rides'] as const) {
      const app = siteOf(ctx, kind);
      if (!app || (kind === 'rides' && p.car < 0)) continue;
      const perHour = gigOutlook(ctx, app, p);
      if (perHour <= 0.3) continue;
      const label = kind === 'rides' ? `Drive for ${app.site!.name}` : `Deliver for ${app.site!.name}`;
      out.push({
        label,
        score: cap(v.mv * perHour - v.effort * 0.8 + (p.job < 0 ? 0.4 : 0) + (p.money < 20 ? 0.8 : 0)),
        why: `about ${perHour.toFixed(1)} an hour, whenever they want`,
        steps: () => [{ k: 'gig', app: app.id, mins: 180 }],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ housing

function housingOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const t = p.traits;
  const home = v.home?.built && !v.home.ruined ? v.home : undefined;
  // having a home built already: wait for it (somewhere to sleep meanwhile if they have nowhere)
  const building = v.project && BUILDINGS[v.project.kind].category === 'home' && !v.project.built && !v.project.ruined;
  if (building && v.home) return out;
  const comfortNow = homeComfort(ctx, p);
  const currentRent = home && RENTALS.has(home.kind) ? home.units[p.unit]?.rent ?? 0 : 0;
  const job = ctx.bById.get(ctx.cById.get(p.job)?.site ?? -1);
  // home listings (if they're online): a search shows the few flats that suit them best, sponsored first
  const listings = v.online ? siteOf(ctx, 'homes') ?? siteOf(ctx, 'classifieds') : undefined;
  let found = false;

  // rent a flat in a building they know of
  if (!home || home.kind === 'trailer' || RENTALS.has(home.kind)) {
    const gainOf = (vac: ReturnType<typeof vacancies>[number]) => {
      const comfort = comfortOf(vac.b.kind, vac.b.floors, vac.b.condition);
      const commute = job ? Math.hypot(job.x - vac.b.x, job.y - vac.b.y) / 1000 : 0.5;
      // a flat high up in a tower is something to show off
      const status = vac.b.kind === 'tower' ? 0.4 * t.ambition : 0;
      return (comfort - comfortNow) * 6 * (0.5 + t.comfortLove) + status + (home ? 0 : 3) - commute * 1.5 - (vac.rent - currentRent) * v.mv * 1.2;
    };
    const vacs = cheapestVacancies(ctx).filter((vac) => canAfford(p, vac.rent) && vac.b.id !== p.home);
    if (listings && vacs.length) {
      const gains = new Map(vacs.map((vac) => [vac.b.id, gainOf(vac)]));
      searchFor(ctx, p, 'home', listings, vacs.map((vac) => vac.b), (b) => gains.get(b.id) ?? 0);
    }
    const knownHomes = new Set(knownOf(ctx, p, 'home').map((x) => x.b.id));
    let best: Option | null = null;
    for (const vac of vacs) {
      if (!knownHomes.has(vac.b.id)) continue;
      const gain = gainOf(vac);
      if (gain <= 0.3) continue;
      const score = cap(gain + (home ? 0 : 1.5));
      if (!best || score > best.score) {
        const b = vac.b, unit = vac.unit;
        best = {
          label: `Rent a flat (${vac.rent.toFixed(1)}/day${b.kind === 'tower' ? ', in a tower' : ''})`,
          score,
          why: home ? `nicer or closer to work than now` : listings ? 'no home yet; found it online' : 'no home yet',
          steps: () => [go(b), { k: 'rent', bid: b.id, unit }],
        };
      }
    }
    if (best) { out.push(best); found = true; }
  }
  if (!home && !found && !listings) {
    // look for "for rent" signs: walk to a building with empty flats
    const vac = vacancies(ctx)[0];
    const target = vac?.b ?? ctx.s.buildings.find((b) => RENTALS.has(b.kind) && b.built);
    if (target && !cooling(v, 'look:home')) out.push({ label: 'Look for a place to live', score: 1.6, why: 'looking for a "for rent" sign', steps: () => { p.cooldown['look:home'] = ctx.s.tick + 180; return [go(target), { k: 'look' }]; } });
  }

  // a trailer home: cheap, delivered, on a lot of their own out of town
  const trailer = BUILDINGS.trailer.delivered ?? 170;
  if (!home && !(building && v.project?.kind === 'trailer') && !cooling(v, 'plan:trailer') && p.money > trailer + 40 && p.money < 3000) {
    out.push({ label: 'Buy a trailer home', score: 2.4 + (v.night ? 0 : 0.3), why: `no home; a used trailer costs ~${trailer}, plus a lot`, steps: () => [{ k: 'plan', kind: 'trailer', floors: 1 }] });
  }
  // a house of their own (built by a construction company): a savings goal
  if ((!home || home.kind !== 'house') && !building && !cooling(v, 'plan:house') && hasBuilders(ctx)) {
    for (const floors of [1, 2]) {
      if (floors === 2 && t.comfortLove + t.ambition < 1.1) continue;
      const cost = buildCost(ctx, p, 'house', floors) * 1.3;
      const needed = cost * (1.6 - 0.6 * t.comfortLove - 0.3 * t.patience) + (floors - 1) * 40;
      // with a mortgage, a third of the cost in savings is enough
      const credit = creditOf(ctx, p);
      if (p.money < needed && !(credit > cost * 0.8 && p.money > cost * 0.35)) continue;
      out.push({
        label: floors > 1 ? 'Have a 2-floor house built' : 'Have a house built',
        score: cap(1.4 + 2.5 * (comfortOf('house', floors, 1) - comfortNow) * (0.5 + t.comfortLove) + 0.5 * t.ambition * (floors - 1)),
        why: `saved ${fmt(p.money)}; a house costs ~${fmt(cost)}`,
        steps: () => [{ k: 'plan', kind: 'house', floors }],
      });
    }
  }
  return out;
}

/** The cheapest empty flat in each building (people compare buildings, not every flat). Cached per minute. */
const cheapVacCache = new WeakMap<object, { t: number; list: ReturnType<typeof vacancies> }>();
function cheapestVacancies(ctx: Ctx): ReturnType<typeof vacancies> {
  const c = cheapVacCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list.filter((v) => v.b.units[v.unit]?.tenant < 0);
  const best = new Map<number, ReturnType<typeof vacancies>[number]>();
  for (const v of vacancies(ctx)) { const cur = best.get(v.b.id); if (!cur || v.rent < cur.rent) best.set(v.b.id, v); }
  const list = [...best.values()];
  cheapVacCache.set(ctx.s, { t: ctx.s.tick, list });
  return list;
}

/** Buildings of each kind standing (counted once per minute). */
const kindCache = new WeakMap<object, { t: number; m: Map<string, number> }>();
function countKind(ctx: Ctx, kind: string): number {
  let c = kindCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) {
    c = { t: ctx.s.tick, m: new Map() };
    for (const b of ctx.s.buildings) if (!b.ruined) c.m.set(b.kind, (c.m.get(b.kind) ?? 0) + 1);
    kindCache.set(ctx.s, c);
  }
  return c.m.get(kind) ?? 0;
}

/** Parks and plazas (cached per minute). */
const spotCache = new WeakMap<object, { t: number; list: Building[] }>();
function hangouts(ctx: Ctx): Building[] {
  const c = spotCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list;
  const list = ctx.s.buildings.filter((b) => (b.kind === 'park' || b.kind === 'plaza') && b.built && !b.ruined);
  spotCache.set(ctx.s, { t: ctx.s.tick, list });
  return list;
}

// ---------------------------------------------------------------- business

const siteCache = new WeakMap<object, { t: number; sites: Building[] }>();
function sitesUnderConstruction(ctx: Ctx): Building[] {
  let c = siteCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, sites: ctx.s.buildings.filter((b) => !b.built && !b.ruined) }; siteCache.set(ctx.s, c); }
  return c.sites;
}

/** How much of a good unfinished buildings around the city are still waiting for. */
function sitesNeeding(ctx: Ctx, g: Good): number {
  let q = 0;
  for (const b of sitesUnderConstruction(ctx)) q += b.needed[g];
  return q;
}

/** Could starting a company of this kind pay off, as this person sees it? */
/** The state of the market everyone sees when weighing a business (counted once an hour, not per person). */
const climateCache = new WeakMap<object, { h: number; tvs: number; online: number; sites: number; openShip: number; waitingBuild: number; offices: number; openCrowd: Crowdfund[] }>();
function bizClimate(ctx: Ctx) {
  const h = Math.floor(ctx.s.tick / 60);
  const c = climateCache.get(ctx.s);
  if (c && c.h === h) return c;
  let tvs = 0, online = 0;
  for (const q of ctx.s.people) { if ((q.durables.tv ?? 0) > 0) tvs++; if (isOnline(q)) online++; }
  const fresh = {
    h, tvs, online,
    sites: ctx.s.firms.filter((f) => f.site && !f.closed).length,
    openShip: ctx.s.shipments.filter((s) => s.status === 'open' && s.from !== -2).length,
    waitingBuild: ctx.s.buildings.filter((b) => b.builder === -2 && !b.built && !b.ruined).length,
    offices: ctx.s.firms.filter((f) => f.kind === 'office' && !f.closed).length,
    openCrowd: (ctx.s.crowdfunds ?? []).filter((c) => c.status === 'open'),
  };
  climateCache.set(ctx.s, fresh);
  return fresh;
}

function businessOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  if (p.firms.length >= 3) return out;
  const t = p.traits;
  if (t.ambition + t.risk < 0.7) return out;
  const pop = cityPop(ctx);
  const wage = p.hourly * 8 * 1.05;
  const credit = creditOf(ctx, p);
  // too little money even for a small start (or to ask the crowd): no point weighing every business
  if (p.money + credit * 0.8 < 250 && (p.money < 40 || !siteOf(ctx, 'crowd'))) return out;
  const builders = hasBuilders(ctx);
  const climate = bizClimate(ctx);
  for (const kind of BUSINESS_KINDS) {
    const def = BUILDINGS[kind];
    if (cooling(v, 'found:' + kind)) continue;
    // a consulting (law, accounting, design…) firm: for professionals
    if (kind === 'office' && p.edu < 14) continue;
    // a place to work from: lease a vacant shop or office floor, or have a building built
    const unit = def.leasable ? cheapestUnit(ctx, def.leasable) : undefined;
    if (!unit && !builders) continue;
    const floors = def.floors[0];
    const lotPrice = unit ? 0 : cheapestLot(ctx, kind);
    if (lotPrice === Infinity) continue;
    const cost = unit ? askingRent(ctx, unit) * 7 : buildCost(ctx, p, kind, floors) * 1.3 + lotPrice;
    // they keep enough to live on (a few weeks of food and rent)
    const living = 120;
    const short = p.money - living + credit * 0.8 < cost * 0.6 + def.minFunds || p.money < living + 40;
    // can't afford it: maybe the crowd will fund it (if there's a crowdfunding site and they're on it)
    const crowd = short ? siteOf(ctx, 'crowd') : undefined;
    // a crowdfunding site only gets so much attention: a handful of campaigns at a time
    const open = short ? climate.openCrowd.filter((c) => c.status === 'open') : [];
    if (short && (!crowd || !p.pol.sites.includes(crowd.id) || p.money < 40 || open.length >= 3 + pop / 300 || open.some((c) => c.founder === p.id || c.kind === kind) || p.traits.risk < 0.4)) continue;
    const rivals = countKind(ctx, kind);
    // a city only supports so many of one kind of business (makers sell outside too, but need a market)
    if (def.output && rivals >= 1 + pop / 120) continue;
    let daily = 0;
    let why = '';
    if (def.output) {
      const g = def.output;
      const belief = p.prices[g];
      // construction sites around town waiting for this: plain to see, and proof it's wanted
      const siteNeed = sitesNeeding(ctx, g);
      const expected = Math.max(belief.p * (belief.src === 'guess' && siteNeed < 5 ? 0.6 : 1), p.bidSeen[g] * 0.95);
      const hours = def.hours[1] - def.hours[0];
      const fert = kind === 'farm' ? 0.65 : 1;
      const perWorker = def.recipe ? (def.recipe.outputs[g] ?? 0) * hours * fert : 1.8 * hours;
      let inputs = 0;
      if (def.recipe) for (const [ig, q] of Object.entries(def.recipe.inputs)) inputs += q! * p.prices[ig as Good].p;
      inputs = def.recipe ? inputs / (def.recipe.outputs[g] ?? 1) : 0;
      const margin = expected - inputs - wage / perWorker;
      if (margin <= 0) continue;
      const slots = def.jobs.reduce((s, j) => s + j.slots, 0);
      // local makers can replace imports (what local companies buy from outside is demand too)
      const seen = p.demandSeen[g] + siteNeed / 5;
      const demand = Math.max(seen, belief.src === 'guess' ? 2 : 4) * 1.2;
      // what rivals (including ones still being built) will make covers part of it
      const room = demand - rivals * perWorker * slots;
      if (room <= perWorker * 0.3) continue;
      daily = Math.min(perWorker * slots, room) * margin;
      why = `${GOOD[g].label} sell for ~${fmt(expected)}; ${rivals} rivals`;
    } else if (def.service === 'retail') {
      const perStore = 70;
      if (rivals * perStore > pop) continue;
      daily = Math.min(pop - rivals * perStore, perStore) * 0.6;
      why = `${pop} people and ${rivals} stores`;
    } else if (def.service === 'health') {
      // a doctors' practice: opened by a doctor, about one per 700 people
      if (p.edu < 18 || rivals * 700 > pop) continue;
      daily = Math.min(pop - rivals * 700, 700) * 0.06;
      why = `${pop} people and ${rivals} clinics`;
    } else if (def.service === 'meal') {
      const perPlace = 80;
      if (rivals * perPlace > pop || ctx.s.contracts.length < 8) continue;
      daily = Math.min(pop - rivals * perPlace, perPlace) * 0.25;
      why = `${pop} people and ${rivals} restaurants`;
    } else if (def.service === 'freight') {
      // each logistics company can handle a dozen or so waiting deliveries
      const open = climate.openShip;
      if (open < 6 + rivals * 14 || rivals * 120 > pop) continue;
      daily = (open - rivals * 14) * 1.5;
      why = `${open} deliveries waiting for someone to carry them`;
    } else if (def.service === 'build') {
      const waiting = climate.waitingBuild;
      const backlog = sitesUnderConstruction(ctx).length;
      if (waiting < 1 && backlog < 4 + rivals * 4 || rivals >= 1 + Math.floor(pop / 70)) continue;
      daily = waiting * 6 + Math.max(0, backlog - rivals * 4) * 2 + 4;
      why = `${waiting} projects waiting for a builder, ${backlog} going up`;
    } else if (def.service === 'finance') {
      if (pop < 45 || rivals * 250 > pop) continue;
      daily = rivals ? 15 : 35;
      why = rivals ? `${pop} people, ${rivals} bank${rivals > 1 ? 's' : ''}` : 'the city has no bank yet';
    } else if (def.service === 'cars') {
      const wantCars = p.demandSeen.cars + pop / 120;
      if (rivals >= 1 + pop / 600 || wantCars < 2) continue;
      daily = 25;
      why = 'people want cars, and the nearest dealer is out of town';
    } else if (def.service === 'tv') {
      // advertisers need somewhere to reach people; a channel per ~400 people
      const tvs = climate.tvs;
      if (pop < 90 || rivals * 400 > pop || tvs < 15) continue;
      daily = tvs * 0.25 + pop * 0.03;
      why = `${tvs} homes with a TV and no ${rivals ? 'good ' : ''}channel`;
    } else if (def.service === 'net') {
      // a site the city doesn't have yet is the opening (a marketplace, a job board, a delivery app…)
      const onlineN = climate.online;
      const sites = climate.sites;
      if (pop < 60 || onlineN < 25 || sites >= 13 || sites * 45 > onlineN + 30) continue;
      if (p.edu < 13 && p.traits.curiosity < 0.6) continue; // a tech founder
      daily = onlineN * 0.2 + wage * 0.5;
      why = `${onlineN} people online${rivals ? `, ${rivals} local sites so far` : ', and no local sites yet'}; software sells anywhere`;
    } else if (def.service === 'admin') {
      // clients outside the city buy the city's office work: room for another firm only while the city's
      // consultancies can't do it all (counting the desks they already have, not just today's billing)
      const cap = serviceDemand(ctx);
      const used = serviceRate(ctx, 'Pro') < 0.95 ? cap : ctx.s.data?.svcFullPro ?? 0;
      const firms = climate.offices;
      const capacityHere = firms * 15 * referenceWage(ctx) * ROLE.clerk.pay * 1.7; // what the existing firms could bill once staffed
      if (used > cap * 0.8 || capacityHere > cap) continue;
      daily = wage * 3 * 0.25 * (1 - Math.max(used, capacityHere) / cap);
      why = `firms elsewhere hire consultants; ${rivals} office${rivals === 1 ? '' : 's'} here so far`;
    } else if (def.service === 'ads') {
      // advertisers wanting street ads, few spaces to rent
      const spend = ctx.s.data?.streetWanted ?? 0;
      if (rivals * 250 > pop || spend < 15 + rivals * 40) continue;
      daily = spend * 0.4 - rivals * 10;
      why = `companies spend ~${spend.toFixed(0)} a day on street ads`;
    }
    if (daily <= 0) continue;
    const horizon = 15 + 40 * t.patience;
    const value = daily * horizon * (0.3 + 0.7 * t.risk) * (0.5 + t.ambition);
    const invest = v.mv * (cost + def.minFunds) + v.effort * 20;
    if (value < invest * 2) continue;
    const lease = unit?.id;
    if (short) {
      const goal = Math.max(100, cost * 0.6 + def.minFunds + living - p.money - credit * 0.5);
      out.push({
        label: `Crowdfund a ${def.label.toLowerCase()}`,
        score: cap((value - invest) / 60 + 0.4),
        why: `expects ~${fmt(daily)}/day but is ${goal.toFixed(0)} short: ${why}`,
        steps: () => [{ k: 'crowdfund', kind, goal }],
      });
      continue;
    }
    out.push({
      label: unit ? `Start a ${def.label.toLowerCase()} in a leased ${def.leasable === 'suite' ? 'office' : 'shop'}` : `Start a ${def.label.toLowerCase()}`,
      score: cap((value - invest) / 40 + 0.5 + (unit ? 0.3 : 0)),
      why: `expects ~${fmt(daily)}/day: ${why}`,
      steps: () => [{ k: 'found', kind, lease }],
    });
  }
  // property developer: blocks of flats and towers when people need homes, office towers when companies need space
  if ((p.money > 600 || credit > 1500) && t.ambition > 0.45 && !cooling(v, 'develop') && !cooling(v, 'devcheck')) {
    p.cooldown.devcheck = ctx.s.tick + 1440 + Math.floor(ctx.rng.next() * 1440);
    const plan = planDevelopment(ctx, p.id, p.money, credit);
    if (plan) {
      const label = plan.kind === 'officetower' ? `Develop a ${plan.floors}-floor office tower` : plan.kind === 'tower' ? `Develop a ${plan.floors}-floor residential tower` : `Develop a ${plan.floors}-floor apartment block`;
      out.push({
        label,
        // worth it when the rent beats what they'd want for tying up the money (the cautious want more)
        score: cap(0.8 + 2.5 * (plan.yield - (1.05 - 0.35 * t.risk)) + t.ambition),
        why: plan.why,
        steps: () => [{ k: 'found', kind: plan.kind, floors: plan.floors, lot: plan.lot.id, redevelop: plan.redevelop }],
      });
    }
  }
  return out;
}

const unitCache = new WeakMap<object, { t: number; m: Map<string, Building | undefined> }>();
function cheapestUnit(ctx: Ctx, kind: 'shopfront' | 'suite'): Building | undefined {
  let c = unitCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, m: new Map() }; unitCache.set(ctx.s, c); }
  if (c.m.has(kind)) { const hit = c.m.get(kind); return hit && hit.firm < 0 ? hit : undefined; }
  let best: Building | undefined, br = Infinity;
  for (const u of vacantUnits(ctx, kind)) {
    const r = askingRent(ctx, u);
    if (r < br) { br = r; best = u; }
  }
  c.m.set(kind, best);
  return best;
}

// --------------------------------------------------------------- shopping

function durableOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const t = p.traits;
  const wants: { g: Good; value: number; why: string; device?: 'phone' | 'tv' }[] = [];
  if ((p.durables.clothes ?? 0) < 3) wants.push({ g: 'clothes', value: 8 + 10 * t.comfortLove + 6 * t.ambition, why: 'their clothes are worn out' });
  if (v.home && (p.durables.furniture ?? 0) <= 0) wants.push({ g: 'furniture', value: 12 + 20 * t.comfortLove, why: 'their home is bare' });
  // gadgets are worth a few days' pay to people (more to the sociable, curious and comfort-loving)
  const day = Math.max(8, p.hourly * 8);
  if ((p.durables.computers ?? 0) <= 0 && v.home && (p.edu >= 12 || t.curiosity > 0.6)) wants.push({ g: 'computers', value: day * (3 + 6 * t.curiosity + 2 * t.ambition), why: 'wants a computer' });
  if ((p.durables.phone ?? 0) <= 0) wants.push({ g: 'computers', device: 'phone', value: day * (5 + 6 * t.sociability + 3 * t.curiosity), why: 'everyone has a phone' });
  if ((p.durables.tv ?? 0) <= 0 && v.home) wants.push({ g: 'computers', device: 'tv', value: day * (4 + 5 * t.comfortLove + 2 * (1 - t.curiosity)), why: 'wants a TV for the evenings' });
  // people with money to spare want nicer things (it makes them happy, and others see it)
  if (p.money > 400 && (p.durables.clothes ?? 0) < 60) wants.push({ g: 'clothes', value: 10 + 15 * t.ambition + 10 * t.comfortLove, why: 'treating themselves to new clothes' });
  if (p.money > 600 && v.home && (p.durables.furniture ?? 0) < 120) wants.push({ g: 'furniture', value: 15 + 25 * t.comfortLove, why: 'wants a nicer home' });
  const what = (w: { g: Good; device?: string }) => w.device === 'phone' ? 'a phone' : w.device === 'tv' ? 'a TV' : w.g === 'clothes' ? 'new clothes' : w.g === 'computers' ? 'a computer' : 'furniture';
  const pending = pendingDeliveries(ctx, p);
  for (const w of wants) {
    // in a store they know of (none with it: maybe look one up)
    const open = openPlaces(ctx);
    const has = (b: Building) => open.open.has(b.id) && b.kind === 'store' && b.store[w.g] >= 1;
    let stores = knownOf(ctx, p, 'shop').filter(({ b }) => has(b));
    if (!stores.length) {
      const engine = engineFor(v);
      if (engine && searchDue(v, 'shop:' + w.g, 1440)) searchFor(ctx, p, 'shop', engine, open.stores.filter(has), nearAndGood(ctx, p));
      stores = knownOf(ctx, p, 'shop').filter(({ b }) => has(b));
    }
    let best: { b: Building; price: number } | undefined;
    for (const { b, pl } of stores) {
      const price = ctx.fById.get(b.firm)?.prices[w.g];
      if (!price) continue;
      const cost = price + bHours(p, b) * p.hourly * 2 - brand(p, b.firm) * 2 - (pl.op ?? 0) * 3;
      if (!best || cost < best.price) best = { b, price };
    }
    const weight = w.g === 'computers' ? 2.5 : 4;
    if (best && p.money > best.price * 1.3) {
      const net = w.value - v.mv * best.price * weight;
      const { b, price } = best;
      if (net > 0) out.push({
        label: `Buy ${what(w)} at ${ctx.fById.get(b.firm)?.name ?? 'a store'}`,
        score: cap(net / 6),
        why: `${w.why}; costs ${price.toFixed(1)}`,
        steps: () => [go(b), { k: 'shop', store: b.id, good: w.g, qty: 1, max: price * 1.1, device: w.device }],
      });
    }
    // online: a local web shop, or an outside retailer (delivered the next day)
    if (v.online && v.home && !pending.some((s) => s.goods[w.g] > 0)) {
      let pick: { seller: number; price: number; via: number; name: string; fee: number } | undefined;
      for (const { f, via } of onlineStores(ctx, w.g, 1)) {
        const price = f.prices[w.g]!;
        if (!pick || price < pick.price) pick = { seller: f.id, price, via, name: f.name, fee: ONLINE.localDeliveryFee };
      }
      const outside = outsideRetailPrice(ctx, w.g);
      if (!pick || outside + ONLINE.deliveryFee < pick.price + pick.fee) pick = { seller: OUTSIDE.id, price: outside, via: -1, name: 'an online store', fee: ONLINE.deliveryFee };
      const pk = pick;
      const net = w.value * 0.9 - v.mv * (pk.price + pk.fee) * weight;
      if (net > 0 && p.money > (pk.price + pk.fee) * 1.3) out.push({
        label: `Order ${what(w)} online from ${pk.name}`,
        score: cap(net / 6 + 0.1),
        why: `${w.why}; ${pk.price.toFixed(1)} + ${pk.fee.toFixed(1)} delivery`,
        steps: () => [{ k: 'order', seller: pk.seller, good: w.g, qty: 1, price: pk.price, via: pk.via, device: w.device }],
      });
    }
  }
  // a car, when the commute is long and money allows (from a dealer, or ordered from outside)
  if (p.car < 0 && v.home && !pending.some((s) => s.goods.cars > 0)) {
    const job = ctx.bById.get(ctx.cById.get(p.job)?.site ?? -1);
    const commute = job ? Math.hypot(job.x - v.home.x, job.y - v.home.y) : 300;
    const hoursSaved = (2 * commute / MOVE.walk - 2 * commute / MOVE.car) / 60;
    // time saved, plus what owning a car means to them (status, comfort)
    // time saved, freedom (weekends, errands), what owning a car means to them (status, comfort)
    const value = hoursSaved * p.hourly * 200 + 120 + t.ambition * 160 + t.comfortLove * 120 + (p.money > 1000 ? 120 : 0);
    const credit = creditOf(ctx, p);
    // car dealers they know of (none: maybe look one up)
    const open = openPlaces(ctx);
    let dealers = knownOf(ctx, p, 'car').filter(({ b }) => open.open.has(b.id));
    if (!dealers.length) {
      const engine = engineFor(v);
      if (engine && searchDue(v, 'car', 1440)) searchFor(ctx, p, 'car', engine, open.dealers, nearAndGood(ctx, p));
      dealers = knownOf(ctx, p, 'car').filter(({ b }) => open.open.has(b.id));
    }
    for (const { b } of dealers) {
      if (b.store.cars < 1) continue;
      const price = ctx.fById.get(b.firm)?.prices.cars;
      if (!price || (p.money < price * 1.15 && !(p.money > price * 0.3 && credit > price))) continue;
      if (value < price * v.mv * 2) continue;
      out.push({
        label: 'Buy a car',
        score: cap(2 + t.ambition),
        why: `commute ${(commute / 1000).toFixed(1)} km; car costs ${price.toFixed(0)}`,
        steps: () => [go(b), { k: 'shop', store: b.id, good: 'cars', qty: 1, max: price * 1.05 }],
      });
      break;
    }
    if (!out.some((o) => o.label === 'Buy a car') && v.online) {
      const price = outsideRetailPrice(ctx, 'cars');
      const canPay = p.money > price * 1.15 || (p.money > price * 0.3 && credit > price * 0.8);
      if (canPay && value > price * v.mv * 2.2 && commute > 500) out.push({
        label: 'Order a car online',
        score: cap(1.2 + t.ambition),
        why: `commute ${(commute / 1000).toFixed(1)} km; ~${price.toFixed(0)} delivered${p.money < price ? ' (with a car loan)' : ''}`,
        steps: () => [{ k: 'order', seller: OUTSIDE.id, good: 'cars', qty: 1, price, via: -1 }],
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------- leisure

function leisureOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  const evening = v.hour >= 17 && v.hour < 21 ? 0.4 : 0;
  const lonely = (100 - p.needs.social) / 100;
  const bored = (100 - p.needs.fun) / 100;
  // somewhere to hang out: a park or plaza they know of; otherwise a walk around the neighborhood
  const spots = knownOf(ctx, p, 'out').map((x) => x.b);
  const hangout = spots.length ? spots.reduce((a, b) => (bHours(p, b) < bHours(p, a) ? b : a)) : undefined;
  if (hangout) {
    out.push({
      label: `Hang out ${hangout.kind === 'park' ? 'in the park' : 'on the plaza'}`,
      score: p.traits.sociability * lonely * 1.6 + evening + 0.1 + (hangout.kind === 'park' ? 0.25 * bored : 0) - bHours(p, hangout),
      why: `social ${p.needs.social.toFixed(0)}, sociability ${(p.traits.sociability * 100).toFixed(0)}%`,
      steps: () => [go(hangout), { k: 'chat', mins: 60 }],
    });
  } else if (!v.night) {
    // around the block: to a street corner a couple of hundred metres away and back
    const nodes = ctx.s.roads.nodes;
    let x = p.x, y = p.y;
    for (let k = 0; k < 8; k++) {
      const n = nodes[Math.floor(ctx.rng.next() * nodes.length)];
      if (n && Math.hypot(n.x - p.x, n.y - p.y) < 300) { x = n.x; y = n.y; break; }
    }
    out.push({
      label: 'Go for a walk',
      score: p.traits.sociability * lonely * 1.1 + 0.3 * bored + evening * 0.5,
      why: hangouts(ctx).length ? "doesn't know a park around here; a walk around the neighborhood" : 'no park yet; a walk around the neighborhood',
      steps: () => {
        // on the way they may come across a park or plaza
        const seen = hangouts(ctx).find((b) => Math.hypot(b.x - x, b.y - y) < 400);
        if (seen) learnPlace(ctx, p, seen, 'out', 'near');
        return [{ k: 'go', to: { t: 'pt', x, y } }, { k: 'idle', mins: 15, label: 'out for a walk', pose: 'stand' }, ...(v.home ? [go(v.home)] : [])];
      },
    });
  }
  if (v.home && (p.durables.computers ?? 0) > 0) {
    out.push({
      label: 'Go on the Net at home',
      score: 0.4 + bored * (0.6 + p.traits.curiosity) + evening,
      why: `fun ${p.needs.fun.toFixed(0)}; catches up on news, friends and prices`,
      steps: () => [go(v.home!), { k: 'browse', mins: 50 }],
    });
  }
  if ((p.durables.phone ?? 0) > 0) {
    out.push({
      label: 'Scroll the Net on their phone',
      score: 0.35 + bored * (0.5 + 0.5 * p.traits.sociability) + 0.2 * lonely,
      why: 'a few minutes on the phone',
      steps: () => [{ k: 'phone', mins: 15 + Math.floor(ctx.rng.next() * 20) }],
    });
  }
  if (v.home && (p.durables.tv ?? 0) > 0 && v.hour >= 18 && v.hour < 23) {
    const on = ctx.s.firms.some((f) => f.channel && f.channel.onAir >= 0);
    out.push({
      label: 'Watch TV at home',
      score: (on ? 0.9 : 0.3) + bored * (0.8 + 0.4 * p.traits.comfortLove) + v.fatigue * 0.5 + evening,
      why: on ? 'something good is on tonight' : 'streaming something',
      steps: () => [go(v.home!), { k: 'watch', mins: 60 }],
    });
  }
  out.push({
    label: v.home ? 'Relax at home' : 'Rest',
    score: 0.45 * (1.3 - p.traits.diligence) * (1 + v.fatigue) + (v.home ? 0.15 + evening * 0.5 : 0),
    why: 'nothing seems worth the effort right now',
    steps: () => (v.home ? [go(v.home), { k: 'idle', mins: 50, label: 'relaxing at home' }] : [{ k: 'idle', mins: 40, label: 'resting' }]),
  });
  return out;
}

function hasBuilders(ctx: Ctx): boolean {
  return yardFirms(ctx).length > 0;
}

/** The cheapest lot on sale that a building of this kind could go on (Infinity: none). Cached per minute. */
const cheapCache = new WeakMap<object, { t: number; m: Map<string, number> }>();
function cheapestLot(ctx: Ctx, kind: Building['kind']): number {
  let c = cheapCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, m: new Map() }; cheapCache.set(ctx.s, c); }
  const hit = c.m.get(kind);
  if (hit !== undefined) return hit;
  const def = BUILDINGS[kind];
  let best = Infinity;
  for (const l of lotsForSale(ctx, def.zones)) if (l.w >= Math.min(def.w, 14) + 2 && l.d >= Math.min(def.d, 12) + 2 && l.forSale < best) best = l.forSale;
  c.m.set(kind, best);
  return best;
}

// ---------------------------------------------------------------- politics

function politicsOptions(v: View): Option[] {
  const { ctx, p } = v;
  const out: Option[] = [];
  // election day: those who mean to vote go to the polling place
  const e = openElectionFor(ctx, p);
  if (e) {
    const key = 'intend:' + e.id;
    if (p.cooldown[key] === undefined) {
      const g = ctx.gById.get(e.polity);
      p.cooldown[key] = g && willVote(ctx, g, p, e) ? 1 : 2;
    }
    const place = pollingPlace(ctx, e);
    if (p.cooldown[key] === 1 && place) {
      out.push({
        label: `Go vote (${ctx.gById.get(e.polity)?.short ?? 'election'}${e.kind === 'referendum' ? ' referendum' : ''})`,
        score: 3.6 + p.pol.engagement + p.pol.grievance * 0.5 - bHours(p, place),
        why: e.kind === 'referendum' ? `"${e.motion?.title}"` : 'it\'s election day',
        steps: () => [go(place), { k: 'vote', election: e.id }],
      });
    }
  }
  // meetings, speeches, rallies, debates
  for (const { ev, w, role } of eventsFor(ctx, p)) {
    const place = ctx.bById.get(ev.place);
    if (!place) continue;
    out.push({
      label: role === 'speak' ? `${ev.kind === 'debate' ? 'Take part in' : 'Give'} ${ev.title.replace(/^[^:]*: /, ev.kind === 'debate' ? 'the debate: ' : 'a speech: ')}` : `Go to ${ev.title}`,
      score: w - bHours(p, place) * 0.5,
      why: role === 'speak' ? 'they are on the program' : ev.kind === 'session' ? 'a public meeting' : 'wants to hear what they have to say',
      steps: () => [go(place), { k: role, event: ev.id, until: ev.end }],
    });
  }
  // protests: only if enough people they know (or the news) are going
  for (const ev of ctx.s.events) {
    if (ev.kind !== 'protest' || ev.start - ctx.s.tick > 60 || ev.end - ctx.s.tick < 20) continue;
    if (!joinsProtest(ctx, p, ev)) continue;
    const place = ctx.bById.get(ev.place);
    if (!place) continue;
    out.push({
      label: ev.host === p.id ? `Lead the protest: ${ev.cause}` : `Join the protest: ${ev.cause}`,
      score: 3 + p.pol.grievance + (ev.host === p.id ? 3 : 0),
      why: `grievance ${p.pol.grievance.toFixed(1)}; others they know are going`,
      steps: () => [go(place), { k: ev.host === p.id ? 'speak' : 'attend', event: ev.id, until: ev.end }],
    });
  }
  // campaigning: knocking on doors and putting up flyers
  const camp = v.hour >= 10 && v.hour < 19 ? activeCampaign(ctx, p) : undefined;
  if (camp) {
    const keen = (camp.mine ? 1.4 : 0.6) + p.pol.engagement + 0.5 * p.traits.ambition;
    out.push({
      label: camp.mine ? 'Knock on doors for the campaign' : `Knock on doors for ${ctx.byId.get(camp.c.person)?.name ?? 'the campaign'}`,
      score: cap(keen),
      why: `election on day ${Math.floor(camp.e.day / MINUTES_PER_DAY) + 1}`,
      steps: () => [{ k: 'canvass', candidate: camp.c.person, mins: 90 }],
    });
    const lamps = lampSpots(ctx).filter((s) => Math.hypot(s.x - p.x, s.y - p.y) < 300);
    if (lamps.length >= 3) {
      const pick = [0, 1, 2].map(() => lamps[Math.floor(ctx.rng.next() * lamps.length)]);
      out.push({
        label: 'Put up campaign flyers',
        score: cap(keen * 0.75),
        why: 'free, if not very effective',
        steps: () => pick.flatMap((s) => [{ k: 'go', to: { t: 'pt', x: s.x, y: s.y } } as Step, { k: 'poster', ad: camp.c.person } as Step]),
      });
    }
  }
  // the head of government works at city hall on weekday daytimes
  const exec = ctx.s.polities.find((g) => g.status !== 'gone' && g.offices.some((o) => o.holder === p.id && o.kind === 'exec'));
  const hall = exec ? ctx.bById.get(exec.seat) : undefined;
  if (exec && hall?.built && v.hour >= 9 && v.hour < 15 && Math.floor(ctx.s.tick / MINUTES_PER_DAY) % 7 < 5) {
    out.push({
      label: `Govern from city hall (${exec.charter.execTitle})`,
      score: 3.4 + 0.5 * p.traits.diligence,
      why: 'the job of running the city',
      steps: () => [go(hall), { k: 'idle', mins: 180, label: `governing ${exec.short}`, pose: 'type' }],
    });
  }
  return out;
}

// ------------------------------------------------------------------ decide

export function decide(ctx: Ctx, p: Person): void {
  ensurePlaces(ctx, p);
  const v = makeView(ctx, p);
  const opts: Option[] = [];
  const add = (o: Option | null) => { if (o) opts.push(o); };
  add(sleepOption(v));
  add(workOption(v));
  opts.push(...ownWorkOptions(v));
  add(eatAtHomeOption(v));
  opts.push(...groceryOptions(v));
  add(eatOutOption(v));
  add(deliveryOption(v));
  opts.push(...healthOptions(v));
  add(soupKitchenOption(v));
  add(welfareOption(v));
  // where to live is weighed a couple of times a day (every time while they have nowhere decent)
  const settled = !!v.home?.built && !v.home.ruined && v.home.kind !== 'trailer';
  if (!settled || (p.cooldown.homecheck ?? 0) <= ctx.s.tick) {
    opts.push(...housingOptions(v));
    if (settled) p.cooldown.homecheck = ctx.s.tick + 480 + Math.floor(ctx.rng.next() * 480);
  }
  // big life choices aren't reconsidered every hour
  if ((p.cooldown.bizcheck ?? 0) <= ctx.s.tick) {
    const biz = businessOptions(v);
    opts.push(...biz);
    p.cooldown.bizcheck = ctx.s.tick + (biz.length ? 720 : 1440) + Math.floor(ctx.rng.next() * 720);
  }
  if ((p.cooldown.shopcheck ?? 0) <= ctx.s.tick) {
    const shop = durableOptions(v);
    opts.push(...shop);
    p.cooldown.shopcheck = ctx.s.tick + (shop.length ? 60 : 240);
  }
  const side = sideWorkOptions(v);
  opts.push(...side);
  const bestSide = Math.max(0, ...side.map((o) => o.score));
  opts.push(...jobOptions(v, bestSide));
  opts.push(...leisureOptions(v));
  opts.push(...politicsOptions(v));
  // late at night only home things make sense
  if (v.night) for (const o of opts) if (!/sleep|home|eat|groceries|Shop for food|online|TV|phone|Order a meal|soup kitchen|hospital|sick|ambulance/i.test(o.label)) o.score -= 2;
  for (const o of opts) o.score += ctx.rng.range(-0.08, 0.08);
  // their own learned habits nudge the scores (survival needs stay in charge)
  const learned = brainBias(ctx, p);
  if (learned) for (const o of opts) o.score += learned.bias[categoryOf(o.label)];
  opts.sort((a, b) => b.score - a.score);
  for (const o of opts) {
    const steps = o.steps();
    if (!steps || !steps.length) continue;
    p.decision = { t: ctx.s.tick, chosen: o.label, why: o.why, options: opts.slice(0, 6).map(({ label, score, why }) => ({ label, score, why })) };
    setTask(ctx, p, o.label, steps);
    if (learned) remember(ctx, p, categoryOf(o.label), learned.x);
    return;
  }
}

/**
 * Countryside people live a simpler life, and are a simpler program: a short
 * list of things to do (sleep, the farm or their job, meals at home, the
 * village shop, the pub, TV, a walk, voting) instead of everything the city
 * offers. They don't weigh starting businesses, moving house or what's for
 * sale in town, and have no learned habits. Out of work, they ask at the farms
 * around (and after a while move to the city, see countryDaily).
 */
export function decideCountry(ctx: Ctx, p: Person): void {
  const v = makeView(ctx, p);
  const opts: Option[] = [];
  const add = (o: Option | null) => { if (o) opts.push(o); };
  add(sleepOption(v));
  add(workOption(v));
  opts.push(...ownWorkOptions(v));
  add(eatAtHomeOption(v));
  opts.push(...groceryOptions(v));
  add(eatOutOption(v));
  add(soupKitchenOption(v));
  opts.push(...healthOptions(v));
  if (p.job < 0 && !p.firms.length && (p.cooldown.jobcheck ?? 0) <= ctx.s.tick) {
    opts.push(...jobOptions(v, 0));
    p.cooldown.jobcheck = ctx.s.tick + 360;
  }
  // clothes, a TV, furniture: once in a while (by the week, not the hour)
  if ((p.cooldown.shopcheck ?? 0) <= ctx.s.tick) {
    opts.push(...durableOptions(v));
    p.cooldown.shopcheck = ctx.s.tick + 7 * 1440;
  }
  opts.push(...leisureOptions(v).filter((o) => !/Net at home|phone/.test(o.label)));
  opts.push(...politicsOptions(v).filter((o) => /^Go vote|^Go to /.test(o.label)));
  if (v.night) for (const o of opts) if (!/sleep|home|eat|Shop for food|TV|hospital|sick|ambulance/i.test(o.label)) o.score -= 2;
  for (const o of opts) o.score += ctx.rng.range(-0.08, 0.08);
  opts.sort((a, b) => b.score - a.score);
  for (const o of opts) {
    const steps = o.steps();
    if (!steps || !steps.length) continue;
    p.decision = { t: ctx.s.tick, chosen: o.label, why: o.why, options: opts.slice(0, 6).map(({ label, score, why }) => ({ label, score, why })) };
    setTask(ctx, p, o.label, steps);
    return;
  }
}

/** Once a day: quit a job that doesn't pay. (Better jobs are applied for while still employed, see jobOptions.) */
export function reviewJob(ctx: Ctx, p: Person): void {
  const c = ctx.cById.get(p.job);
  if (!c || c.noticeEnd > 0) return;
  if (c.unpaid >= 2) quit(ctx, c, 'not being paid');
  // comfortably off in a manual or low-skill job: they leave it
  else if (MANUAL.has(c.role) && cushionDays(ctx, p) > 200 && ctx.rng.chance(0.2)) quit(ctx, c, `can afford not to work as a ${ROLE[c.role].label} any more`);
  // enough saved that the pay no longer matters: the less ambitious retire early
  else if (p.money > 150 * c.wage && p.traits.ambition < 0.65 && ctx.rng.chance(0.08)) quit(ctx, c, "retiring: doesn't need the money any more");
}

