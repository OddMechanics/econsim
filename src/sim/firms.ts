// Companies. A firm has its own money (separate from its owner's), operates
// one or more sites, employs people, sets prices and wages, buys inputs,
// sells output, pays its owner dividends, and grows into a chain or a
// corporation with an office building when it does well.

import { JOBS, OUTSIDE } from './config';
import { addCash, cashOf, controllerOf, log, newId, type Ctx } from './ctx';
import { BUILDINGS, chooseFloors, materialsFor, RETAIL_GOODS, slotsFor, workHoursFor } from './goods';
import { createBuilding, farmFertility, findLot, transferBuilding } from './buildings';
import { hire, layOff, offerWage, postJob, staffAt } from './jobs';
import { buyNow, learnPrices, listAsk, placeBid, hasBid } from './market';
import { firmName, slogan } from './names';
import { startConstruction, yardFirms } from './construction';
import { sellHooks } from './hooks';
import { borrow, lendingCapacity } from './finance';
import { leaseUnit, vacantUnits, vacate } from './leases';
import { referenceWage } from './government';
import { planDevelopment, redevelop } from './development';
import { serviceMarket, serviceRate } from './production';
import { GOODS, type Building, type BuildingKind, type Firm, type Good, type Lot, type Person, type Role } from './types';

export function sitesOf(ctx: Ctx, f: Firm): Building[] {
  return f.sites.map((id) => ctx.bById.get(id)!).filter((b) => b && !b.ruined);
}

const staffCount = new WeakMap<object, { t: number; n: number; m: Map<number, number> }>();
/** How many people a firm employs (counted once per minute). */
export function employeesOf(ctx: Ctx, f: Firm): number {
  let c = staffCount.get(ctx.s);
  if (!c || c.t !== ctx.s.tick || c.n !== ctx.s.contracts.length) {
    c = { t: ctx.s.tick, n: ctx.s.contracts.length, m: new Map() };
    for (const k of ctx.s.contracts) c.m.set(k.firm, (c.m.get(k.firm) ?? 0) + 1);
    staffCount.set(ctx.s, c);
  }
  return c.m.get(f.id) ?? 0;
}

/** Rough cost of putting up a building, as someone with these beliefs sees it. */
export function buildCost(_ctx: Ctx, p: Person, kind: BuildingKind, floors: number): number {
  const mats = materialsFor(kind, floors);
  let c = 0;
  for (const g of GOODS) c += mats[g] * p.prices[g].p;
  return c + workHoursFor(kind, floors) * (p.hourly || 2) * 0.8;
}

export function foundFirm(ctx: Ctx, founder: Person, kind: BuildingKind, lot: Lot, invest: number, floors = 1): Firm {
  const last = founder.name.split(' ')[1] ?? founder.name;
  const f: Firm = {
    id: newId(ctx), name: firmName(ctx.rng, kind, last), owner: founder.id, founded: ctx.s.tick, cash: 0, kind,
    sites: [], prices: {}, wages: {}, ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.5,
    sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: (founder.durables.computers ?? 0) > 0,
    slogan: slogan(ctx.rng), closed: false,
  };
  ctx.s.firms.push(f);
  ctx.fById.set(f.id, f);
  founder.firms.push(f.id);
  founder.money -= invest;
  f.cash += invest;
  initPrices(f, founder);
  const site = createBuilding(ctx, kind, lot, f.id, floors, false, f.id);
  startConstruction(ctx, f.id, site);
  log(ctx, 'business', `${founder.name} founded ${f.name} (${BUILDINGS[kind].label.toLowerCase()}) with ${invest.toFixed(0)} of savings.`, { who: founder.id, firm: f.id, bid: site.id });
  return f;
}

/** A company that starts out in a leased unit (a shop in a tower, an office floor). */
export function foundFirmIn(ctx: Ctx, founder: Person, kind: BuildingKind, unit: Building, invest: number): Firm | null {
  const last = founder.name.split(' ')[1] ?? founder.name;
  const f: Firm = {
    id: newId(ctx), name: firmName(ctx.rng, kind, last), owner: founder.id, founded: ctx.s.tick, cash: 0, kind,
    sites: [], prices: {}, wages: {}, ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.5,
    sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: (founder.durables.computers ?? 0) > 0 || founder.edu >= 14,
    slogan: slogan(ctx.rng), closed: false,
  };
  ctx.s.firms.push(f);
  ctx.fById.set(f.id, f);
  founder.firms.push(f.id);
  founder.money -= invest;
  f.cash += invest;
  initPrices(f, founder);
  if (!leaseUnit(ctx, f, unit, kind)) {
    founder.money += f.cash;
    f.cash = 0;
    f.closed = true;
    founder.firms = founder.firms.filter((id) => id !== f.id);
    return null;
  }
  log(ctx, 'business', `${founder.name} founded ${f.name} (${BUILDINGS[kind].label.toLowerCase()}) in a leased ${unit.level ? 'office' : 'shop'} with ${invest.toFixed(0)} of savings.`, { who: founder.id, firm: f.id, bid: unit.id });
  return f;
}

/**
 * A local branch of a company from outside the city (a regional builder, a
 * chain store): owned outside, run by a manager hired here. Its profits
 * leave the city.
 */
export function openBranch(ctx: Ctx, kind: BuildingKind, brand: string, lot: Lot, manager: Person, cash: number): Firm {
  const f: Firm = {
    id: newId(ctx), name: brand, owner: OUTSIDE.id, founded: ctx.s.tick, cash, kind,
    sites: [], prices: {}, wages: {}, ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.6,
    sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: true, slogan: slogan(ctx.rng), closed: false, branch: brand, manager: manager.id,
  };
  ctx.s.firms.push(f);
  ctx.fById.set(f.id, f);
  initPrices(f, manager);
  createBuilding(ctx, kind, lot, f.id, 1, true, f.id);
  return f;
}

/** Are the city's banks lent out (or is there no bank)? */
function creditTight(ctx: Ctx): boolean {
  let cap = 0, lent = 0;
  for (const f of ctx.s.firms) if (f.kind === 'bank' && !f.closed) cap += lendingCapacity(ctx, f);
  for (const l of ctx.s.loans) lent += l.balance;
  return cap === 0 || lent > cap * 0.7;
}

/** Chains from outside and what they open: a convenience store, a supermarket, fast food, a car dealer. */
const CHAINS: { brand: string; kind: BuildingKind; per: number; minPop: number; capital?: number }[] = [
  { brand: 'First National Bank', kind: 'bank', per: 600, minPop: 40, capital: 9000 },
  { brand: 'QuickStop', kind: 'store', per: 110, minPop: 30 },
  { brand: 'FreshMart', kind: 'store', per: 220, minPop: 150 },
  { brand: 'Burger Barn', kind: 'restaurant', per: 140, minPop: 60 },
  { brand: 'Pizza Palace', kind: 'restaurant', per: 260, minPop: 180 },
  { brand: 'AutoNation', kind: 'dealer', per: 500, minPop: 150 },
  { brand: 'Metro Outdoor', kind: 'adco', per: 700, minPop: 120 },
];

/**
 * Daily: chains from outside open branches where the city has too few shops
 * or restaurants for its size (like real chains moving into a growing town).
 * They lease a shop in a tower or build, hire a local manager, and stock up
 * from their own warehouses outside.
 */
export function chainsDaily(ctx: Ctx): void {
  const pop = ctx.s.people.length;
  for (const c of CHAINS) {
    if (pop < c.minPop || !ctx.rng.chance(0.25)) continue;
    const have = ctx.s.buildings.filter((b) => b.kind === c.kind && !b.ruined).length;
    // a bank comes when the city's banks are lent out (it's credit that's scarce, not branches)
    if (c.kind === 'bank') { if (!creditTight(ctx)) continue; }
    else if (have * c.per >= pop) continue;
    const mine = ctx.s.firms.find((f) => f.branch === c.brand && !f.closed);
    if (mine && mine.sites.length >= 1 + Math.floor(pop / (c.per * 2))) continue;
    // a manager from among the unemployed (or anyone looking)
    const manager = ctx.s.people.filter((p) => p.job < 0 && !p.firms.length && p.edu >= 10).sort((a, b) => b.traits.diligence + b.traits.communication - a.traits.diligence - a.traits.communication)[0];
    if (!manager) continue;
    const unit = BUILDINGS[c.kind].leasable ? vacantUnits(ctx, BUILDINGS[c.kind].leasable!)[0] : undefined;
    if (!unit && !yardFirms(ctx).length) continue;
    let f = mine;
    if (!f) {
      f = {
        id: newId(ctx), name: c.brand, owner: OUTSIDE.id, founded: ctx.s.tick, cash: c.capital ?? 900, kind: c.kind, sites: [], prices: {}, wages: {},
        ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.6, sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: true,
        slogan: slogan(ctx.rng), closed: false, branch: c.brand, manager: manager.id, webshop: true,
      };
      initPrices(f, manager);
    } else f.cash += 600; // the head office funds the new location
    if (!mine) ctx.fById.set(f.id, f);
    const lot = unit ? undefined : findLot(ctx, c.kind, null, f.id);
    if (!unit && !lot) { if (mine) f.cash -= 600; else ctx.fById.delete(f.id); continue; }
    if (!mine) ctx.s.firms.push(f);
    let site: Building | undefined;
    if (unit) { if (leaseUnit(ctx, f, unit, c.kind)) site = unit; }
    else if (lot) { site = createBuilding(ctx, c.kind, lot, f.id, BUILDINGS[c.kind].floors[0], false, f.id); startConstruction(ctx, f.id, site); }
    if (!site) continue;
    const post = postJob(ctx, f, site.id, BUILDINGS[c.kind].jobs[0].role, offerWage(ctx, f, BUILDINGS[c.kind].jobs[0].role) * 1.1);
    // the local manager runs it (and works the floor)
    if (!mine) { f.manager = manager.id; hire(ctx, post, manager); }
    log(ctx, 'business', `${c.brand}, a chain from outside the city, is opening ${mine ? 'another' : 'a'} ${BUILDINGS[c.kind].label.toLowerCase()} here${unit ? ' in a leased shop' : ''}.`, { firm: f.id, bid: site.id });
  }
}

function initPrices(f: Firm, owner: Person): void {
  const def = BUILDINGS[f.kind];
  if (def.output) f.prices[def.output] = Math.max(owner.prices[def.output].p, owner.bidSeen[def.output]) * 1.1;
  if (def.service === 'retail') for (const g of RETAIL_GOODS) f.prices[g] = owner.prices[g].p * 1.45;
  if (def.service === 'ads') f.prices.rate = 3; // rent for an ad space per day
  if (def.service === 'cars') f.prices.cars = owner.prices.cars.p * 1.2;
  if (def.service === 'meal') f.prices.meal = owner.prices.groceries.p * 2.5 + 2.5;
  if (def.service === 'freight') f.prices.freight = 0.02;
  if (def.service === 'build') f.prices.build = 1.25; // markup on cost
  if (def.service === 'finance') f.prices.rate = 0.0012; // interest per day
  if (f.kind === 'apartments' || f.kind === 'tower' || f.kind === 'officetower') f.prices.build = 0;
}

/** Productivity factor: big firms need office staff to stay organized. */
const effCache = new WeakMap<object, { t: number; m: Map<number, number> }>();
export function efficiency(ctx: Ctx, f: Firm): number {
  const n = employeesOf(ctx, f);
  if (n <= 10) return 1;
  let c = effCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) { c = { t: ctx.s.tick, m: new Map() }; effCache.set(ctx.s, c); }
  const hit = c.m.get(f.id);
  if (hit !== undefined) return hit;
  let admin = 0;
  for (const k of ctx.s.contracts) if (k.firm === f.id && (k.role === 'clerk' || k.role === 'manager')) admin++;
  const e = Math.min(1, Math.sqrt((10 + 12 * admin) / n));
  c.m.set(f.id, e);
  return e;
}

/** How many people a site wants in each role right now. */
function staffWanted(ctx: Ctx, f: Firm, b: Building): { role: Role; want: number }[] {
  const def = BUILDINGS[b.kind];
  const slots = slotsFor(b.kind, b.floors, b.w, b.d);
  const out: { role: Role; want: number }[] = [];
  for (const { role, slots: max } of slots) {
    let want = max;
    const have = staffAt(ctx, b.id, role).length;
    if (role === 'sales') {
      // a sales rep once there's something to sell and few customers know the company
      const made = def.output;
      const unsold = made ? b.store[made] + ctx.s.market.orders.filter((o) => o.side === 'ask' && o.who === f.id).reduce((s, o) => s + o.qty, 0) : 0;
      const known = f.contacts?.length ?? 0;
      want = def.service === 'ads' ? max : (made ? (unsold > workerDailyOutput(ctx, b) * 2 || known < 6 ? 1 : 0) : 1);
      if (f.cash < 60 && have === 0) want = 0;
      out.push({ role, want: Math.min(max, want) });
      continue;
    }
    if (role === 'manager' && def.service === 'build') {
      out.push({ role, want: staffAt(ctx, b.id, 'builder').length >= 5 ? 1 : 0 });
      continue;
    }
    if (def.output) {
      const g = def.output;
      const perWorkerDay = workerDailyOutput(ctx, b);
      let unsold = 0;
      for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.who === f.id && o.good === g) unsold += o.qty;
      unsold += b.store[g];
      const price = f.prices[g] ?? 0;
      const margin = price - unitCost(ctx, f, b);
      if (unsold > perWorkerDay * Math.max(1, have) * 1.5 || margin <= 0) want = Math.min(max, have);
      if (unsold > perWorkerDay * Math.max(1, have) * 3) want = Math.max(0, have - 1);
    } else if (def.service === 'retail' || def.service === 'cars') {
      // a cashier per ~20 sales a day
      const sold = Object.values(f.salesAvg).reduce((s, x) => s + x, 0) / Math.max(1, f.sites.length);
      want = Math.min(max, Math.max(1, Math.ceil(sold / 20)));
    } else if (def.service === 'meal') {
      const meals = (f.salesAvg.meal ?? 0) / Math.max(1, f.sites.length);
      want = Math.min(max, Math.max(1, Math.ceil(meals / 18)));
    } else if (def.service === 'freight') {
      const open = ctx.s.shipments.filter((s) => s.status === 'open').length;
      want = Math.min(max, Math.max(1, Math.ceil(open / 3)));
    } else if (def.service === 'build') {
      const backlog = ctx.s.buildings.filter((x) => x.builder === f.id && !x.built && !x.ruined)
        .reduce((s, x) => s + (x.workNeeded - x.workDone) / 60, 0);
      want = Math.min(max, Math.ceil(backlog / 14));
    } else if ((def.service === 'admin' && f.kind === 'office') || (def.service === 'net' && role === 'programmer')) {
      // a consulting (law, accounting, design…) firm or a software company: fills its desks while clients
      // elsewhere want more work and it pays; lets people go when it loses money and the market is saturated
      const mult = serviceRate(ctx, serviceMarket(role === 'manager' ? 'clerk' : role));
      const recent = f.ledger.days.slice(-5).reduce((a, x) => a + x, 0);
      const young = ctx.s.tick - f.founded < 20 * 1440;
      if (role === 'manager') want = 1;
      else if (mult > 0.9 && (recent > 0 || young)) want = Math.min(max, have + (f.kind === 'office' ? 5 : 3));
      else if (mult < 0.8 && recent < 0 && !young) want = Math.max(1, have - 1);
      else want = Math.min(max, have);
    } else if (def.service === 'admin') {
      // a company's head office: about one clerk for every nine people the company employs
      const n = employeesOf(ctx, f);
      want = Math.min(max, role === 'manager' ? 1 : Math.ceil(n / 9));
    } else if (def.service === 'ads') {
      // installers: one per ~15 ad spaces the company owns
      const spaces = ctx.s.ads.filter((a) => a.owner === f.id).length;
      want = Math.min(max, Math.max(1, Math.ceil(spaces / 15)));
    }
    out.push({ role, want });
  }
  return out;
}

export function workerDailyOutput(ctx: Ctx, b: Building): number {
  const def = BUILDINGS[b.kind];
  const hours = def.hours[1] - def.hours[0];
  if (def.recipe && def.output) return (def.recipe.outputs[def.output] ?? 0) * hours * (b.kind === 'farm' ? farmFertility(ctx, b) : 1);
  if (def.gathers) return 1.8 * hours; // walking back and forth included
  return 0;
}

/** The firm's estimate of what one unit of a site's output costs to make. */
export function unitCost(ctx: Ctx, f: Firm, b: Building): number {
  const def = BUILDINGS[b.kind];
  const owner = controllerOf(ctx, f);
  const out = workerDailyOutput(ctx, b);
  if (!out) return 0;
  const role = def.jobs[0]?.role;
  const wage = (role ? f.wages[role] : undefined) ?? 16;
  let inputs = 0;
  if (def.recipe && owner) {
    const per = def.recipe.outputs[def.output!] ?? 1;
    for (const [g, q] of Object.entries(def.recipe.inputs)) inputs += (q! / per) * owner.prices[g as Good].p;
  }
  return inputs + wage / out;
}

/** Hourly: put freshly made goods on the market. */
export function firmHourly(ctx: Ctx, f: Firm): void {
  if (f.closed) return;
  for (const b of sitesOf(ctx, f)) {
    const g = BUILDINGS[b.kind].output;
    if (!b.built || !g) continue;
    const q = Math.floor(b.store[g]);
    if (q < 1) continue;
    b.store[g] -= q;
    const price = f.prices[g] ?? 1;
    listAsk(ctx, f.id, g, q, price, price * 0.6, b.id);
  }
}

/** Once a day each firm reviews prices, buys inputs, staffs up or down, pays its owner, maybe expands. */
export function firmDaily(ctx: Ctx, f: Firm): void {
  if (f.closed) return;
  const profit = f.ledger.revenue - f.ledger.costs;
  f.revenueAvg = 0.8 * (f.revenueAvg ?? f.ledger.revenue) + 0.2 * f.ledger.revenue;
  f.ledger.days.push(profit);
  if (f.ledger.days.length > 14) f.ledger.days.shift();
  f.ledger.revenue = 0;
  f.ledger.costs = 0;
  f.losing = profit < 0 ? f.losing + 1 : 0;
  for (const k of new Set([...Object.keys(f.sales), ...Object.keys(f.salesAvg)])) {
    f.salesAvg[k] = 0.7 * (f.salesAvg[k] ?? 0) + 0.3 * (f.sales[k] ?? 0);
  }
  f.sales = {};
  const owner = controllerOf(ctx, f);
  if (!owner) return;
  // whoever runs a business knows the trade: suppliers' quotes, the trade press
  learnPrices(ctx, owner, 'seen');
  const sites = sitesOf(ctx, f);
  for (const b of sites) {
    if (!b.built) {
      if (b.builder === -1) procureMaterials(ctx, f, b, owner);
      continue;
    }
    reprice(ctx, f, b, owner);
    procure(ctx, f, b, owner);
    staff(ctx, f, b);
  }
  // construction companies bill their clients and buy the materials for their buildings
  if (BUILDINGS[f.kind].service === 'build') {
    billClients(ctx, f);
    for (const b of ctx.s.buildings) if (b.builder === f.id && !b.built && !b.ruined) procureMaterials(ctx, f, b, owner);
  }
  // dividends: keep a reserve, pay the owner part of the rest
  const avgCost = f.ledger.days.length ? Math.max(10, -Math.min(0, ...f.ledger.days)) : 20;
  const reserve = 60 + avgCost * 4 + sites.length * 30 + payrollReserve(ctx, f) * 1.5;
  // dividends go to the owner, whoever that is (a person, a bank, a government)
  if (f.cash > reserve * 1.5) {
    const div = (f.cash - reserve) * 0.25;
    addCash(ctx, f.id, -div);
    addCash(ctx, f.owner, div);
  }
  // a hired manager doesn't start new ventures with someone else's company
  if (owner.id === f.owner) maybeExpand(ctx, f, owner);
  // a business that has been dead for over a week (no staff, no sales, no money) is shut down and its property sold
  const dead = f.ledger.days.length >= 10 && f.ledger.days.slice(-10).every((x) => Math.abs(x) < 1) && !ctx.s.contracts.some((c) => c.firm === f.id) && f.cash < 30;
  const built = sitesOf(ctx, f).every((b) => b.built);
  if (dead && built && f.kind !== 'bank' && ctx.s.tick - f.founded > 12 * 1440) {
    const sites = sitesOf(ctx, f);
    closeFirm(ctx, f, 'it had no business left');
    for (const b of sites) if (b.owner >= 0 && !isPublicOwner(ctx, b.owner)) sellHooks.sell(ctx, b, `${f.name} closed`);
  }
}

function reprice(ctx: Ctx, f: Firm, b: Building, owner: Person): void {
  const def = BUILDINGS[b.kind];
  if (def.output) {
    const g = def.output;
    let price = f.prices[g] ?? owner.prices[g].p;
    const perDay = workerDailyOutput(ctx, b) * Math.max(1, staffAt(ctx, b.id).length);
    let onOffer = 0;
    for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.who === f.id && o.good === g && o.site === b.id) onOffer += o.qty;
    if (onOffer > 1.5 * perDay) price *= 0.93;
    else if (onOffer < 0.4 * perDay) price *= 1.04;
    if (owner.bidSeen[g] > price) price = 0.5 * (price + owner.bidSeen[g]);
    price = Math.max(price, unitCost(ctx, f, b) * 0.7, 0.05);
    f.prices[g] = price;
    for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.who === f.id && o.good === g) { o.price = price; o.floor = price * 0.6; }
  }
  if (def.service === 'retail' || def.service === 'cars') {
    const goods = def.service === 'cars' ? (['cars'] as Good[]) : RETAIL_GOODS;
    for (const g of goods) {
      const cost = Math.max(owner.prices[g].p, ctx.s.market.last[g] || 0);
      const sold = f.salesAvg[g] ?? 0;
      let markup = (f.prices[g] ?? cost * 1.4) / Math.max(0.01, cost);
      if (b.store[g] > Math.max(4, sold * 4)) markup *= 0.97;
      else if (b.store[g] < 1 && sold > 0.5) markup *= 1.04;
      f.prices[g] = cost * Math.min(2.2, Math.max(1.1, markup));
    }
  }
  if (def.service === 'meal') {
    // a meal: the food (1.2 groceries), the kitchen and the staff, and a margin
    const base = owner.prices.groceries.p * 1.2 * 1.4 + referenceWage(ctx) * 0.12;
    const meals = f.salesAvg.meal ?? 0;
    let price = f.prices.meal ?? base * 2;
    if (meals < 6) price *= 0.96; else if (meals > 25) price *= 1.04;
    f.prices.meal = Math.max(base, price);
  }
  if (def.service === 'freight') {
    const open = ctx.s.shipments.filter((s) => s.status === 'open').length;
    let rate = f.prices.freight ?? 0.02;
    rate *= open > 10 ? 1.05 : open < 2 ? 0.96 : 1;
    f.prices.freight = Math.min(0.2, Math.max(0.008, rate));
  }
  if (def.service === 'finance') {
    // lend more cheaply when there's room to lend, dearer when near the limit
    const lent = ctx.s.loans.filter((l) => l.bank === f.id).reduce((s, l) => s + l.balance, 0);
    const room = Math.max(50, f.cash) * 8 - lent;
    let r = f.prices.rate ?? 0.0012;
    r *= room < 200 ? 1.05 : (f.salesAvg.loans ?? 0) < 0.3 ? 0.97 : 1;
    f.prices.rate = Math.min(0.006, Math.max(0.0004, r));
  }
  if (def.service === 'build') {
    const backlog = ctx.s.buildings.filter((x) => x.builder === f.id && !x.built && !x.ruined).length;
    let m = f.prices.build ?? 1.25;
    m *= backlog > 3 ? 1.03 : backlog === 0 ? 0.98 : 1;
    f.prices.build = Math.min(2, Math.max(1.05, m));
  }
}

/** Buy what the site will need: inputs for production, stock for shelves, groceries for the kitchen. */
function procure(ctx: Ctx, f: Firm, b: Building, owner: Person): void {
  const def = BUILDINGS[b.kind];
  const needs: Partial<Record<Good, number>> = {};
  if (def.recipe) {
    const staff = Math.max(1, staffAt(ctx, b.id).length);
    const hours = def.hours[1] - def.hours[0];
    for (const [g, q] of Object.entries(def.recipe.inputs)) needs[g as Good] = q! * hours * staff * 1.6;
  } else if (def.service === 'retail') {
    for (const g of RETAIL_GOODS) {
      const sold = f.salesAvg[g] ?? 0;
      // an empty shelf means it sold out: more was wanted than it could sell, so order well beyond past sales
      const soldOut = b.store[g] < 1 + sold * 0.15;
      needs[g] = Math.max(g === 'groceries' ? 10 : 2, sold * (soldOut ? 4 : 2.5));
    }
  } else if (def.service === 'cars') {
    needs.cars = Math.max(1, (f.salesAvg.cars ?? 0) * 3);
  } else if (def.service === 'meal') {
    needs.groceries = Math.max(10, (f.salesAvg.meal ?? 0) * 1.3 * 2);
  }
  for (const [gk, target] of Object.entries(needs)) {
    const g = gk as Good;
    const incoming = incomingTo(ctx, b.id, g);
    const short = Math.ceil(target! - b.store[g] - incoming);
    if (short < 1) continue;
    const belief = Math.max(owner.prices[g].p, ctx.s.market.last[g] || 0);
    const max = belief * 1.25;
    // wages come first: keep a few days of payroll before buying anything
    let budget = Math.max(0, (cashOf(ctx, f.id) - payrollReserve(ctx, f)) * 0.6);
    // out of cash but customers are waiting (or the shelves sell): borrow for materials or stock
    const out = def.output;
    // shops and restaurants keep stocked: customers walk away from empty shelves (a new place stocks up on credit)
    const selling = def.service === 'retail' || def.service === 'meal' ? Object.values(f.salesAvg).reduce((a, x) => a + x, 0) > 2 || ctx.s.tick - f.founded < 20 * 1440 : false;
    const waiting = out ? ctx.s.market.orders.some((o) => o.side === 'bid' && o.good === out && o.price > unitCost(ctx, f, b)) : selling;
    if (budget < max * short * 0.5 && (waiting || ctx.s.tick - f.founded < 25 * 1440) && f.losing < 5) {
      budget += borrow(ctx, f.id, max * short, 30, 'materials', b.owner === f.id ? { building: b.id, value: buildingWorth(ctx, b) } : undefined) * 0.9;
    }
    const qty = Math.min(short, Math.floor(budget / Math.max(0.01, max)));
    if (qty < 1) continue;
    const got = buyNow(ctx, f.id, g, qty, max, b.id);
    if (got < qty && !hasBid(ctx, f.id, g)) placeBid(ctx, f.id, g, qty - got, belief * 1.05, b.id);
  }
}

/** Order the materials a construction site still needs, delivered to the site. */
export function procureMaterials(ctx: Ctx, f: Firm, b: Building, owner: Person): void {
  // not enough money to finish: a construction loan (banks lend against the building)
  let missing = 0;
  for (const g of GOODS) missing += Math.max(0, b.needed[g] - incomingTo(ctx, b.id, g)) * Math.max(owner.prices[g].p, ctx.s.market.last[g] || 0) * 1.3;
  if (missing > 5 && cashOf(ctx, f.id) < missing) borrow(ctx, f.id, missing - cashOf(ctx, f.id), 90, `materials for a ${BUILDINGS[b.kind].label.toLowerCase()}`);
  for (const g of GOODS) {
    const short = Math.ceil(b.needed[g] - incomingTo(ctx, b.id, g) - b.store[g]);
    if (short < 1) continue;
    const belief = Math.max(owner.prices[g].p, ctx.s.market.last[g] || 0);
    const max = belief * 1.3;
    // building materials are paid for by the client's deposit and progress payments
    const qty = Math.min(short, Math.floor(Math.max(0, cashOf(ctx, f.id) - payrollReserve(ctx, f) * 0.25) / Math.max(0.01, max)));
    if (qty < 1) continue;
    const got = buyNow(ctx, f.id, g, qty, max, b.id);
    if (got < qty && !hasBid(ctx, f.id, g)) placeBid(ctx, f.id, g, qty - got, belief * 1.05, b.id);
  }
}

/** Someone takes over an abandoned business building and starts a firm around it. */
export function adoptSite(ctx: Ctx, p: Person, b: Building): Firm {
  const last = p.name.split(' ')[1] ?? p.name;
  const f: Firm = {
    id: newId(ctx), name: firmName(ctx.rng, b.kind, last), owner: p.id, founded: ctx.s.tick, cash: 0, kind: b.kind,
    sites: [], prices: {}, wages: {}, ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.5,
    sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: (p.durables.computers ?? 0) > 0, slogan: slogan(ctx.rng), closed: false,
  };
  ctx.s.firms.push(f);
  ctx.fById.set(f.id, f);
  p.firms.push(f.id);
  p.owned = p.owned.filter((id) => id !== b.id);
  b.owner = f.id;
  b.firm = f.id;
  b.ver++;
  const lot = ctx.lotById.get(b.lot);
  if (lot) lot.owner = f.id;
  f.sites.push(b.id);
  const invest = Math.min(p.money * 0.4, 60);
  p.money -= invest;
  f.cash += invest + b.cash;
  b.cash = 0;
  initPrices(f, p);
  log(ctx, 'business', `${p.name} took over an abandoned ${BUILDINGS[b.kind].label.toLowerCase()} and started ${f.name}.`, { who: p.id, firm: f.id, bid: b.id });
  return f;
}

/** Money a firm needs to keep running its sites: a few days of inputs plus payroll. */
function workingCapital(ctx: Ctx, f: Firm): number {
  let need = payrollReserve(ctx, f);
  for (const b of sitesOf(ctx, f)) {
    const r = BUILDINGS[b.kind].recipe;
    if (!r) continue;
    const owner = controllerOf(ctx, f);
    const hours = BUILDINGS[b.kind].hours[1] - BUILDINGS[b.kind].hours[0];
    for (const [g, q] of Object.entries(r.inputs)) need += q! * hours * 3 * Math.max(1, staffAt(ctx, b.id).length) * (owner?.prices[g as Good].p ?? 1);
  }
  return need;
}

/** What a building would fetch (for lending against it): its materials and labor. */
function buildingWorth(ctx: Ctx, b: Building): number {
  const mats = materialsFor(b.kind, b.floors);
  let v = 0;
  for (const g of GOODS) v += mats[g] * (ctx.s.market.last[g] || OUTSIDE.prices[g]);
  return (v + workHoursFor(b.kind, b.floors) * 2.5) * b.condition;
}

/** About four days of wages for everyone the firm employs. */
export function payrollReserve(ctx: Ctx, f: Firm): number {
  let bill = 0;
  for (const c of ctx.s.contracts) if (c.firm === f.id) bill += c.wage;
  return bill * 4;
}

/** Daily: construction clients pay for the work done since the last bill. */
function billClients(ctx: Ctx, f: Firm): void {
  for (const b of ctx.s.buildings) {
    if (b.builder !== f.id || b.built || b.ruined || b.due <= 0) continue;
    const left = b.workNeeded - b.billedWork;
    if (left <= 0) continue;
    const share = Math.min(1, (b.workDone - b.billedWork) / left);
    if (share <= 0) continue;
    const bill = b.due * share * 0.8; // the last bit is paid when it's finished
    // short of cash for a progress payment: the client's bank tops up the construction loan
    if (cashOf(ctx, b.owner) < bill && !ctx.govOfFirm.has(b.owner)) borrow(ctx, b.owner, bill - cashOf(ctx, b.owner) + 5, 200, 'a construction loan', { building: b.id, value: b.due * 2 });
    const paid = Math.min(bill, Math.max(0, cashOf(ctx, b.owner)));
    addCash(ctx, b.owner, -paid);
    addCash(ctx, f.id, paid);
    b.due -= paid;
    b.billedWork = b.workDone;
  }
}

export function incomingTo(ctx: Ctx, site: number, g: Good): number {
  let q = 0;
  for (const s of ctx.s.shipments) if (s.to === site) q += s.goods[g];
  for (const o of ctx.s.market.orders) if (o.side === 'bid' && o.site === site && o.good === g) q += o.qty;
  return q;
}

function staff(ctx: Ctx, f: Firm, b: Building): void {
  for (const { role, want } of staffWanted(ctx, f, b)) {
    const have = staffAt(ctx, b.id, role).filter((c) => c.noticeEnd < 0);
    const posting = ctx.s.postings.find((p) => p.site === b.id && p.role === role);
    if (have.length < want) {
      if (posting) {
        posting.openings = want - have.length;
        if (!posting.applicants.length && ctx.s.tick - posting.t > 2 * 1440) {
          posting.wage *= 1.06;
          posting.t = ctx.s.tick;
          f.wages[role] = posting.wage;
        }
      } else {
        const wage = offerWage(ctx, f, role);
        // a few days of wages in hand; a doing-well company borrows the rest
        const needCash = wage * 3 * (have.length + 1);
        const recent = f.ledger.days.slice(-5);
        // builders can borrow against what their clients still owe them
        const owed = BUILDINGS[f.kind].service === 'build' ? ctx.s.buildings.reduce((s2, x) => s2 + (x.builder === f.id && !x.built ? x.due : 0), 0) : 0;
        // a new business borrows to get going (that's what its business plan is for): until it has its first staff
        const young = (ctx.s.tick - f.founded < 25 * 1440 || employeesOf(ctx, f) === 0 && b.built) && f.losing < 12;
        const doingWell = (recent.length >= 3 && recent.reduce((a, x) => a + x, 0) > 0) || owed > needCash * 2 || young;
        // a working-capital loan, secured by the business's own building
        if (cashOf(ctx, f.id) < needCash && doingWell) borrow(ctx, f.id, needCash - cashOf(ctx, f.id) + wage * 5, 60, 'working capital', b.built && b.owner === f.id ? { building: b.id, value: buildingWorth(ctx, b) } : undefined);
        if (cashOf(ctx, f.id) < needCash) continue;
        f.wages[role] = wage;
        postJob(ctx, f, b.id, role, wage, want - have.length);
      }
    } else if (posting) {
      ctx.s.postings = ctx.s.postings.filter((p) => p !== posting);
    }
    // let the newest go only when it's clearly needed: losing money for days
    // with little cash left, or far more staff than work for a while
    const bill = have.reduce((s, c) => s + c.wage, 0);
    const struggling = f.losing >= JOBS.losingDaysBeforeLayoff && cashOf(ctx, f.id) < bill * 3;
    const idle = have.length > Math.max(1, want) + 1 && f.losing >= 2;
    if (have.length > 1 && (idle || struggling) || have.length === 1 && struggling && f.losing >= 8) {
      const newest = have.reduce((a, c) => (c.start > a.start ? c : a));
      layOff(ctx, newest);
    }
  }
}

function maybeExpand(ctx: Ctx, f: Firm, owner: Person): void {
  if (!ctx.rng.chance(0.2)) return;
  // bigger projects need a construction company
  const builders = yardFirms(ctx).length > 0;
  const recent = f.ledger.days.slice(-5);
  if (recent.length < 5) return;
  const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
  const sites = sitesOf(ctx, f);
  if (sites.some((s) => !s.built)) return; // one project at a time
  // a corporate office once the company is big: a floor in an office tower if there's one free, else its own building
  const employees = employeesOf(ctx, f);
  const suite = employees >= 10 && !sites.some((s) => s.kind === 'office') ? vacantUnits(ctx, 'suite')[0] : undefined;
  if (suite && leaseUnit(ctx, f, suite, 'office')) return;
  if (employees >= 12 && !sites.some((s) => s.kind === 'office') && builders) {
    // bigger cities, taller towers (and downtown land is precious)
    const floors = Math.min(4 + Math.floor(ctx.s.people.length / 40), 2 + Math.floor(employees / 6));
    const cost = buildCost(ctx, owner, 'office', floors);
    if (f.cash > cost * 1.3) {
      const lot = findLot(ctx, 'office', null, f.id);
      if (lot) {
        const b = createBuilding(ctx, 'office', lot, f.id, floors, false, f.id);
        startConstruction(ctx, f.id, b);
        log(ctx, 'business', `${f.name} is building a ${floors}-floor headquarters.`, { firm: f.id, bid: b.id });
        return;
      }
    }
  }
  // a construction company grows its crews, not its yards
  if (BUILDINGS[f.kind].service !== 'build') {
    if (diversify(ctx, f, owner, avg, builders) || expand(ctx, f, owner, avg, builders)) return;
  }
  // last, and only if the boss wants to: a building to let (see considerProperty)
  if (builders) considerProperty(ctx, f, owner, avg);
}

/**
 * Property is a business of its own. A company in some other trade only
 * builds flats or offices to let when its boss judges it a better use of the
 * money than paying it out or leaving it in the bank: the yield has to clear
 * what they'd want from a venture outside what they know (higher for the
 * cautious), with unfamiliar work (tenants, upkeep, empty units) counted
 * against it. Developers and construction companies know the trade.
 */
const PROPERTY_KINDS: BuildingKind[] = ['apartments', 'tower', 'officetower'];
function considerProperty(ctx: Ctx, f: Firm, owner: Person, avg: number): void {
  if (f.cash < 800 + workingCapital(ctx, f) || avg <= 5) return;
  const plan = planDevelopment(ctx, f.id, f.cash - workingCapital(ctx, f) - 300, f.cash);
  if (!plan) return;
  const boss = controllerOf(ctx, f) ?? owner;
  const trade = PROPERTY_KINDS.includes(f.kind) ? 1 : BUILDINGS[f.kind].service === 'build' ? 0.85 : 0.6;
  const hurdle = 1.1 - 0.4 * boss.traits.risk;
  const value = plan.yield * trade;
  if (value < hurdle) return;
  if (plan.redevelop !== undefined && !redevelop(ctx, f.id, plan.redevelop)) return;
  const b = createBuilding(ctx, plan.kind, plan.lot, f.id, plan.floors, false, f.id);
  startConstruction(ctx, f.id, b);
  const why = trade < 1 ? `${boss.name} decided it pays better than anything else they could do with the money: ${plan.why}` : plan.why;
  log(ctx, 'business', `${f.name} is investing in a ${plan.floors}-floor ${BUILDINGS[plan.kind].label.toLowerCase()} (${why}).`, { firm: f.id, bid: b.id });
}

/** Diversify: a rich company goes into something buyers want and nobody makes. */
function diversify(ctx: Ctx, f: Firm, owner: Person, avg: number, builders: boolean): boolean {
  if (f.cash <= 400 + workingCapital(ctx, f) || avg <= 4 || sitesOf(ctx, f).length >= 10 || !builders) return false;
  const kind = bestOpportunity(ctx, f);
  if (!kind) return false;
  const cost = buildCost(ctx, owner, kind, BUILDINGS[kind].floors[0]);
  if (f.cash < cost * 1.2) borrow(ctx, f.id, cost * 1.2 - f.cash, 90, `a new ${BUILDINGS[kind].label.toLowerCase()}`);
  if (f.cash <= cost * 1.1) return false;
  const lot = findLot(ctx, kind, null, f.id);
  if (!lot) return false;
  const b = createBuilding(ctx, kind, lot, f.id, chooseFloors(kind, lot.zone, ctx.s.people.length, ctx.rng.next()), false, f.id);
  startConstruction(ctx, f.id, b);
  log(ctx, 'business', `${f.name} is branching out: building a ${BUILDINGS[kind].label.toLowerCase()}.`, { firm: f.id, bid: b.id });
  return true;
}

/** Open another site of the same kind when it pays well (keeping money to run the old ones). */
function expand(ctx: Ctx, f: Firm, owner: Person, avg: number, builders: boolean): boolean {
  if (avg <= 12 || sitesOf(ctx, f).length >= 6 || f.cash <= workingCapital(ctx, f) + 100 || !(builders || BUILDINGS[f.kind].leasable)) return false;
  const kind = f.kind;
  // shops and restaurants: a second location in a vacant shopfront
  const lease = BUILDINGS[kind].leasable ? vacantUnits(ctx, BUILDINGS[kind].leasable!)[0] : undefined;
  if (lease && leaseUnit(ctx, f, lease, kind)) { log(ctx, 'business', `${f.name} opened another location.`, { firm: f.id, bid: lease.id }); return true; }
  if (!builders) return false;
  const cost = buildCost(ctx, owner, kind, BUILDINGS[kind].floors[0]);
  if (f.cash < cost * 1.4 + BUILDINGS[kind].minFunds && avg > 20) borrow(ctx, f.id, cost * 1.4 + BUILDINGS[kind].minFunds - f.cash, 90, 'expansion');
  if (f.cash <= cost * 1.4 + BUILDINGS[kind].minFunds) return false;
  const lot = findLot(ctx, kind, null, f.id);
  if (!lot) return false;
  const b = createBuilding(ctx, kind, lot, f.id, chooseFloors(kind, lot.zone, ctx.s.people.length, ctx.rng.next()), false, f.id);
  startConstruction(ctx, f.id, b);
  log(ctx, 'business', `${f.name} is expanding: a new ${BUILDINGS[kind].label.toLowerCase()} is going up.`, { firm: f.id, bid: b.id });
  return true;
}

/** The product buyers bid most for that few or no companies make. */
function bestOpportunity(ctx: Ctx, f: Firm): BuildingKind | null {
  let best: BuildingKind | null = null, bestScore = 40;
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
    const def = BUILDINGS[kind];
    if (!def.output || kind === f.kind || def.category === 'primary' && kind !== 'farm') continue;
    const g = def.output;
    let wantValue = 0;
    for (const o of ctx.s.market.orders) if (o.side === 'bid' && o.good === g) wantValue += o.qty * o.price;
    let supply = 0;
    for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.good === g) supply += o.qty;
    const makers = ctx.s.buildings.filter((b) => b.kind === kind && !b.ruined).length;
    if (makers >= 2 + ctx.s.people.length / 50) continue;
    const score = wantValue - makers * 60 - supply * (ctx.s.market.last[g] || 1);
    if (score > bestScore) { bestScore = score; best = kind; }
  }
  return best;
}

/**
 * Close a company. Its buildings never become ownerless: they pass to the
 * company's owner (a person, a bank, a government), who may sell them.
 */
export function closeFirm(ctx: Ctx, f: Firm, why: string, quiet = false): void {
  f.closed = true;
  for (const c of ctx.s.contracts.filter((c) => c.firm === f.id)) {
    ctx.s.contracts = ctx.s.contracts.filter((x) => x !== c);
    ctx.cById.delete(c.id);
    const p = ctx.byId.get(c.person);
    if (p && p.job === c.id) p.job = -1;
  }
  ctx.s.postings = ctx.s.postings.filter((p) => p.firm !== f.id);
  for (const o of ctx.s.market.orders) {
    if (o.who !== f.id) continue;
    if (o.side === 'bid') addCash(ctx, f.id, o.qty * o.price);
    o.qty = 0;
  }
  ctx.s.market.orders = ctx.s.market.orders.filter((o) => o.qty > 0);
  // whatever money is left goes to the owner, and so do the buildings
  if (f.cash > 0) addCash(ctx, f.owner, f.cash);
  f.cash = 0;
  const owner = ctx.byId.get(f.owner);
  if (owner) owner.firms = owner.firms.filter((id) => id !== f.id);
  for (const b of sitesOf(ctx, f)) {
    // a leased shop or office floor goes back to its landlord
    if (b.lease?.tenant === f.id || b.host !== undefined && b.owner !== f.id) { vacate(ctx, b); continue; }
    b.firm = -1;
    if (b.owner === f.id) transferBuilding(ctx, b, ctx.fById.get(f.owner)?.closed ? -1 : f.owner);
    b.ver++;
  }
  for (const v of ctx.s.vehicles) if (v.owner === f.id) v.owner = f.owner;
  if (!quiet) log(ctx, 'business', `${f.name} closed (${why}).`, { firm: f.id });
}

function isPublicOwner(ctx: Ctx, id: number): boolean {
  return ctx.govOfFirm.has(id);
}


export function recordSale(f: Firm, key: string, qty: number): void {
  f.sales[key] = (f.sales[key] ?? 0) + qty;
}
