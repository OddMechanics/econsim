// Property development: who builds apartment blocks and towers, and how tall.
//
// A developer (a well-off person or a company with spare cash) looks at
// demand: people without a proper home who could pay rent, newcomers
// arriving, renters who'd move up; companies that want office space. Minus
// what stands empty and what's already going up. If there's room, they pick
// what to build and how tall the way real developers do: on cheap land
// further out, a mid-rise block; downtown, where land is dear, a tower
// (the land costs the same whatever goes on it, so the more floors share
// it the better), as tall as demand, the city's height limit, their money
// (with a construction loan), and the construction companies allow.

import { MINUTES_PER_DAY } from './config';
import { cityPop, log, nameOf, pay, type Ctx } from './ctx';
import { BUILDINGS, materialsFor, unitsFor, workHoursFor } from './goods';
import { refPrice } from './market';
import { assessLot, noteLandDemand, referenceWage } from './government';
import { moveOut, RENTALS, vacancies } from './housing';
import { endContract } from './jobs';
import { removeBuilding } from './buildings';
import { stationsOf } from './layout';
import { vacantUnits } from './leases';
import { yardFirms } from './construction';
import { maxFloorsAt } from './tasks';
import { lotsForSale } from './roads';
import { GOODS, type BuildingKind, type Lot } from './types';

export interface DevPlan {
  kind: 'apartments' | 'tower' | 'officetower';
  floors: number;
  lot: Lot;
  cost: number; // building + land
  /** A year's (120 days') rent at the expected occupancy, as a share of the cost. */
  yield: number;
  why: string;
  /** A small old building on the lot to buy and tear down first (building id). */
  redevelop?: number;
}

/**
 * A building on valuable land worth buying and tearing down for something
 * taller: houses and trailers that the city has grown around, small blocks
 * of flats that stand mostly empty, empty shops and offices. Returns what
 * the owner would accept (well over what it's worth to them), or null.
 */
export function redevelopPrice(ctx: Ctx, lot: Lot): number | null {
  const b = ctx.bById.get(lot.building);
  if (!b || b.ruined || !b.built || b.host !== undefined || b.hosted?.length || ctx.govOfFirm.has(b.owner)) return null;
  if (b.kind === 'cityhall' || b.kind === 'park' || b.kind === 'plaza' || b.kind === 'tower' || b.kind === 'officetower') return null;
  const tenants = b.units.filter((u) => u.tenant >= 0).length;
  const ok = b.kind === 'house' || b.kind === 'trailer'
    || (b.kind === 'apartments' && b.floors <= 4 && tenants <= b.units.length * 0.3)
    || (b.firm < 0 && b.floors <= 3)
    || (ctx.fById.get(b.firm)?.losing ?? 0) > 6 && b.floors <= 2;
  if (!ok) return null;
  const mats = materialsFor(b.kind, b.floors);
  let value = 0;
  for (const g of GOODS) value += mats[g] * refPrice(ctx, g);
  return (value * b.condition * 1.6 + assessLot(ctx, lot)) * 1.4;
}

/** Buy a building and tear it down (its people move out, a business there loses the site). Returns true when the lot is clear. */
export function redevelop(ctx: Ctx, buyer: number, buildingId: number): boolean {
  const b = ctx.bById.get(buildingId);
  const lot = b ? ctx.lotById.get(b.lot) : undefined;
  if (!b || !lot) return false;
  const price = redevelopPrice(ctx, lot);
  if (price === null || pay(ctx, buyer, b.owner, price, false) <= 0) return false;
  for (const p of ctx.s.people) {
    if (p.home === b.id) moveOut(ctx, p);
    if (p.inside === b.id) { p.inside = -1; p.seat = -1; }
  }
  for (const c of ctx.s.contracts.filter((c) => c.site === b.id)) endContract(ctx, c, 'lost their job when the building was sold for redevelopment');
  const f = ctx.fById.get(b.firm);
  if (f) f.sites = f.sites.filter((id) => id !== b.id);
  log(ctx, 'build', `${nameOf(ctx, buyer)} bought ${nameOf(ctx, b.owner)}'s ${BUILDINGS[b.kind].label.toLowerCase()} for ${price.toFixed(0)} to tear it down and build higher.`, { bid: b.id });
  removeBuilding(ctx, b);
  lot.owner = buyer;
  lot.forSale = 0;
  lot.lastSale = price;
  return true;
}

// What's wanted is recounted every two hours (it means scanning everyone); what's empty or being built is
// counted live, so a developer sees the projects others started minutes ago.
const demandCache = new WeakMap<object, { day: number; res: number; office: number; tower: number }>();
function cached(ctx: Ctx): { day: number; res: number; office: number; tower: number } {
  const day = Math.floor(ctx.s.tick / 120);
  let c = demandCache.get(ctx.s);
  if (!c || c.day !== day) { c = { day, res: residentialWant(ctx), office: officeWant(ctx), tower: towerWant(ctx) }; demandCache.set(ctx.s, c); }
  let sup = supplyCache.get(ctx.s);
  if (!sup || sup.t !== ctx.s.tick || sup.n !== ctx.s.buildings.length) {
    sup = { t: ctx.s.tick, n: ctx.s.buildings.length, res: residentialSupply(ctx), office: officeSupply(ctx), tower: towerSupply(ctx) };
    supplyCache.set(ctx.s, sup);
  }
  return { day, res: c.res - sup.res, office: c.office - sup.office, tower: c.tower - sup.tower };
}
/** What's empty or being built, counted once a minute (and again when a building is added). */
const supplyCache = new WeakMap<object, { t: number; n: number; res: number; office: number; tower: number }>();

/**
 * Flats in a downtown tower people would rent: those who earn well enough to
 * pay the premium and don't live in one yet (a share of them would move
 * downtown: closer to work and the city, a view, status), minus what's empty
 * or being built in towers.
 */
export function towerDemand(ctx: Ctx): number {
  return cached(ctx).tower;
}

function towerWant(ctx: Ctx): number {
  const rent = Math.max(referenceWage(ctx) * 0.25, 2) * 1.4;
  let want = 0;
  for (const p of ctx.s.people) {
    const h = ctx.bById.get(p.home);
    if (h?.kind === 'tower') continue;
    const income = ctx.cById.get(p.job)?.wage ?? (p.firms.length ? 40 : 0);
    if (income * 0.35 < rent && p.money < rent * 120) continue;
    want += h?.kind === 'house' ? 0.12 : 0.3;
  }
  return want;
}

function towerSupply(ctx: Ctx): number {
  let supply = 0;
  for (const b of ctx.s.buildings) {
    if (b.kind !== 'tower' || b.ruined) continue;
    supply += b.built ? b.units.filter((u) => u.tenant < 0).length : b.units.length;
  }
  return supply;
}

/** Flats the city will want over the next few weeks beyond what's empty or being built. */
export function residentialDemand(ctx: Ctx): number {
  return cached(ctx).res;
}

/** Office floors companies will want beyond what's empty or being built. */
export function officeDemand(ctx: Ctx): number {
  return cached(ctx).office;
}

function residentialWant(ctx: Ctx): number {
  let want = 0;
  for (const p of ctx.s.people) {
    const h = ctx.bById.get(p.home);
    const canPay = p.job >= 0 || p.firms.length > 0 || p.money > 150;
    if (!h || !h.built) want += canPay ? 1 : 0.2;
    else if (h.kind === 'trailer') want += canPay ? 0.5 : 0.1;
  }
  // newcomers: the last week's arrivals, for the next three weeks
  const arrived = ctx.s.people.filter((p) => ctx.s.tick - p.arrived < 7 * MINUTES_PER_DAY).length;
  want += (arrived / 7) * 21 * 0.6;
  return want;
}

function residentialSupply(ctx: Ctx): number {
  let supply = vacancies(ctx).length;
  for (const b of ctx.s.buildings) if (RENTALS.has(b.kind) && !b.built && !b.ruined) supply += b.units.length;
  return supply;
}

/**
 * Office floors wanted: companies that have outgrown their desks (or have no
 * office yet), and people who looked for an office and found none, minus
 * floors standing empty or going up. Counted in floors of desks, so a few
 * small firms don't make a tower.
 */
function officeWant(ctx: Ctx): number {
  let want = (ctx.s.data?.officeWanted ?? 0) * 0.5;
  const staff = new Map<number, number>();
  for (const c of ctx.s.contracts) staff.set(c.firm, (staff.get(c.firm) ?? 0) + 1);
  for (const f of ctx.s.firms) {
    if (f.closed || ctx.govOfFirm.has(f.id)) continue;
    const n = staff.get(f.id) ?? 0;
    let desks = 0;
    for (const id of f.sites) {
      const b = ctx.bById.get(id);
      if (b && (b.kind === 'office' || b.kind === 'netco')) desks += stationsOf(b).filter((s) => s.role).length;
    }
    if (desks === 0) { if (n >= 10) want += 1; continue; }
    // nearly full: another floor's worth
    if (n > desks * 0.85) want += 1;
  }
  return want;
}

function officeSupply(ctx: Ctx): number {
  let supply = vacantUnits(ctx, 'suite').length;
  for (const b of ctx.s.buildings) if (b.kind === 'officetower' && !b.built && !b.ruined) supply += b.floors - 1;
  return supply;
}

/** What a building of this kind and height would cost to put up (materials at market prices, labor, the builder's margin). */
export function devCost(ctx: Ctx, kind: BuildingKind, floors: number): number {
  const mats = materialsFor(kind, floors);
  let c = 0;
  for (const g of GOODS) c += mats[g] * refPrice(ctx, g) * 1.15;
  // taller is harder: cranes, pumps, stronger structure (about 1% more per floor above ten)
  const height = 1 + Math.max(0, floors - 10) * 0.01;
  return (c + (workHoursFor(kind, floors) / 8) * referenceWage(ctx) * 1.1) * 1.25 * height;
}

/** The biggest crew any construction company has (towers need a big contractor). Counted once an hour. */
const crewCache = new WeakMap<object, { t: number; n: number }>();
function biggestCrew(ctx: Ctx): number {
  const c = crewCache.get(ctx.s);
  if (c && ctx.s.tick - c.t < 60) return c.n;
  const per = new Map<number, number>();
  for (const k of ctx.s.contracts) if (k.role === 'builder') per.set(k.firm, (per.get(k.firm) ?? 0) + 1);
  let n = 0;
  for (const y of yardFirms(ctx)) n = Math.max(n, per.get(y.id) ?? 0);
  crewCache.set(ctx.s, { t: ctx.s.tick, n });
  return n;
}

/** A plan for what this investor could develop now, or null. */
/** Newcomers per day over the last week (counted hourly). */
const growthCache = new WeakMap<object, { h: number; v: number }>();
function recentGrowth(ctx: Ctx): number {
  const h = Math.floor(ctx.s.tick / 60);
  const c = growthCache.get(ctx.s);
  if (c && c.h === h) return c.v;
  const v = ctx.s.people.filter((p) => ctx.s.tick - p.arrived < 7 * MINUTES_PER_DAY).length / 7;
  growthCache.set(ctx.s, { h, v });
  return v;
}

/**
 * Where a development of a kind could go, for any developer: the 16 central-most
 * lots for sale that fit, and (towers) the 6 central-most small old buildings
 * worth tearing down. Looked up hourly.
 */
const sitesCache = new WeakMap<object, { h: number; m: Map<string, { lots: Lot[]; old: Lot[] }> }>();
function devSites(ctx: Ctx, kind: DevPlan['kind']): { lots: Lot[]; old: Lot[] } {
  const h = Math.floor(ctx.s.tick / 60);
  let c = sitesCache.get(ctx.s);
  if (!c || c.h !== h) { c = { h, m: new Map() }; sitesCache.set(ctx.s, c); }
  let r = c.m.get(kind);
  if (r) return r;
  const def = BUILDINGS[kind];
  const fits = (l: Lot) => l.w >= def.w + 1 && l.d >= def.d + 2;
  const byCenter = (a: Lot, b: Lot) => Math.hypot(a.x - ctx.s.center.x, a.y - ctx.s.center.y) - Math.hypot(b.x - ctx.s.center.x, b.y - ctx.s.center.y);
  const lots = lotsForSale(ctx, def.zones).filter(fits).sort(byCenter).slice(0, 16);
  // small old buildings on dear land, bought to be torn down (towers only: blocks go on empty land)
  const old = kind === 'apartments' ? [] : ctx.s.roads.lots.filter((l) => l.building >= 0 && def.zones.includes(l.zone) && fits(l) && redevelopPrice(ctx, l) !== null).sort(byCenter).slice(0, 6);
  r = { lots, old };
  c.m.set(kind, r);
  return r;
}

export function planDevelopment(ctx: Ctx, investor: number, money: number, credit: number): DevPlan | null {
  if (!yardFirms(ctx).length) return null;
  const budget = money + credit;
  const office = officeDemand(ctx);
  const homes = residentialDemand(ctx);
  const crew = biggestCrew(ctx);
  // newcomers per day lately (people looking for homes and office space come with them)
  const growth = recentGrowth(ctx);
  const rent = Math.max(referenceWage(ctx) * 0.25, 2);
  const plans: (DevPlan & { score: number })[] = [];
  const consider = (kind: DevPlan["kind"], wantUnits: number, _perFloor: number, unitRent: number) => {
    const def = BUILDINGS[kind];
    const fits = (l: Lot) => l.w >= def.w + 1 && l.d >= def.d + 2;
    // the central-most lots for sale and old buildings to tear down are the same for every developer (looked up hourly)
    const market = devSites(ctx, kind);
    const lots = market.lots.filter((l) => l.owner !== investor && l.building < 0 && l.forSale > 0);
    const own = ctx.s.roads.lots.filter((l) => l.owner === investor && l.building < 0 && def.zones.includes(l.zone) && fits(l));
    const byCenter = (a: Lot, b: Lot) => Math.hypot(a.x - ctx.s.center.x, a.y - ctx.s.center.y) - Math.hypot(b.x - ctx.s.center.x, b.y - ctx.s.center.y);
    const cands = own.concat(lots).sort(byCenter).slice(0, 10).concat(market.old.filter((l) => l.building >= 0));
    if (!cands.length && kind !== 'apartments') noteLandDemand(ctx, def.zones);
    for (const lot of cands) {
      const tear = lot.building >= 0 ? redevelopPrice(ctx, lot) : null;
      if (lot.building >= 0 && tear === null) continue; // (no longer for sale since the hourly look)
      const land = tear !== null ? tear : lot.owner === investor ? 0 : lot.forSale || assessLot(ctx, lot);
      const cap = maxFloorsAt(ctx, lot.x, lot.y);
      let hi = def.floors[1];
      if (cap > 0) hi = Math.min(hi, cap);
      // only a big contractor can put up a big tower
      hi = Math.min(hi, crew >= 10 ? hi : crew >= 6 ? 30 : crew >= 3 ? 14 : 8);
      // how many it can let soon: what's wanted now plus the city's growth over the next two months
      const absorb = Math.max(0, wantUnits) * 1.5 + growth * 60;
      // the best height: the land costs the same however tall, each floor costs a bit more the higher it goes,
      // and units beyond what can be let soon earn less (they stand empty a while)
      let floors = def.floors[0], bestValue = -Infinity;
      for (let F = def.floors[0]; F <= hi; F++) {
        const units = kind === 'officetower' ? F - 1 : unitsFor(kind, F);
        const let_ = Math.min(units, absorb) + Math.max(0, units - absorb) * 0.1;
        const value = let_ * unitRent * 0.85 * 120 - devCost(ctx, kind, F) - land;
        if (devCost(ctx, kind, F) + land > budget * 2.5) break; // as tall as the money allows (a third down, the rest from the bank)
        if (value > bestValue) { bestValue = value; floors = F; }
      }
      if (floors < def.floors[0] || floors > hi) continue;
      const cost = devCost(ctx, kind, floors) + land;
      if (cost > budget * 2.5 || budget < cost * 0.3) continue;
      // the yield: a year (here 120 days) of rent at expected occupancy, against the cost
      const units = kind === 'officetower' ? floors - 1 : unitsFor(kind, floors);
      const yearRent = (Math.min(units, absorb) + Math.max(0, units - absorb) * 0.1) * unitRent * 0.85 * 120;
      const score = yearRent / cost + (lot.zone === 'core' ? 0.1 : 0);
      if (yearRent < cost * 0.8) continue;
      plans.push({ kind, floors, lot, cost, score, yield: yearRent / cost, redevelop: tear !== null ? lot.building : undefined, why: `${Math.round(wantUnits)} ${kind === 'officetower' ? 'office floors' : 'homes'} wanted; ~${Math.round(yearRent / cost * 100)}% a year on ${Math.round(cost)}${tear !== null ? ' (tearing down an old building)' : ''}` });
      break;
    }
  };
  if (office >= 3) consider('officetower', office + 2, 1, referenceWage(ctx) * 0.9);
  // dear land downtown: towers for people who can pay for a flat there (even while cheaper flats stand empty elsewhere)
  const towers = towerDemand(ctx);
  if (cityPop(ctx) > 250 && towers >= 20) consider('tower', towers, BUILDINGS.tower.unitsPerFloor, rent * 1.3);
  // a block of flats further out when people need homes
  if (homes >= 12 || homes + growth * 20 >= 30) consider('apartments', Math.min(homes + growth * 10, 60), BUILDINGS.apartments.unitsPerFloor, rent);
  if (!plans.length) return null;
  // the best yield
  const { score: _s, ...best } = plans.reduce((a, b) => (b.score > a.score ? b : a));
  return best;
}

/** Someone wanted an office suite and found none: developers notice (decays daily). */
export function noteOfficeWanted(ctx: Ctx): void {
  ctx.s.data = { ...(ctx.s.data ?? {}), officeWanted: (ctx.s.data?.officeWanted ?? 0) + 1 };
}

export function developmentDaily(ctx: Ctx): void {
  if (ctx.s.data?.officeWanted) ctx.s.data.officeWanted *= 0.85;
}
