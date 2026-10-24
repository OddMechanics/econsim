// Homes: trailers and houses are lived in by their owners; apartment blocks
// and residential towers rent out flats. Landlords set rents from how many
// flats stand empty; tenants pay daily and get evicted after a few unpaid days.
// (Commercial leases of shops and offices are in leases.ts.)

import { HOUSING } from './config';
import { addCash, cashOf, log, nameOf, principalOf, type Ctx } from './ctx';
import { polityAt } from './government';
import { sellBuilding } from './estate';
import { BUILDINGS, comfortOf } from './goods';
import { onFinished } from './hooks';
import type { Building, BuildingKind, Person } from './types';

/** Buildings with flats to rent. */
export const RENTALS = new Set<BuildingKind>(['apartments', 'tower']);

/** When someone's own trailer or house is ready, they move in (if it beats where they live). */
onFinished.push((ctx, b) => {
  if (b.kind !== 'trailer' && b.kind !== 'house') return;
  const p = ctx.byId.get(b.owner);
  if (!p) return;
  const now = homeComfort(ctx, p);
  if (p.home < 0 || comfortOf(b.kind, b.floors, 1) > now) moveIn(ctx, p, b, 0);
});

export interface Vacancy {
  b: Building;
  unit: number;
  rent: number;
}

const vacCache = new WeakMap<object, { t: number; list: Vacancy[] }>();
/** Empty flats (cached per minute; moving in removes them from the list). */
export function vacancies(ctx: Ctx): Vacancy[] {
  const c = vacCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list.filter((v) => v.b.units[v.unit]?.tenant < 0);
  const out: Vacancy[] = [];
  for (const b of ctx.s.buildings) {
    if (!RENTALS.has(b.kind) || !b.built || b.ruined) continue;
    b.units.forEach((u, i) => { if (u.tenant < 0) out.push({ b, unit: i, rent: u.rent }); });
  }
  vacCache.set(ctx.s, { t: ctx.s.tick, list: out });
  return out;
}

/** Share of finished apartments standing empty (plus units being built, counted as coming supply). */
export function vacancyRate(ctx: Ctx): number {
  let units = 0, empty = 0;
  for (const b of ctx.s.buildings) {
    if (!RENTALS.has(b.kind) || b.ruined || b.builder === -2) continue;
    // units still being built count as half (they'll come, but people are already waiting for them)
    units += b.built ? b.units.length : b.units.length * 0.5;
    empty += b.built ? b.units.filter((u) => u.tenant < 0).length : b.units.length * 0.5;
  }
  return units ? empty / units : 0;
}

/** Would a developer build apartments now? Only when few stand empty and rents are worth it. */
export function apartmentsPay(ctx: Ctx): boolean {
  const ref = ctx.s.contracts.length ? ctx.s.contracts.reduce((s, c) => s + c.wage, 0) / ctx.s.contracts.length : 18;
  const rent = averageRent(ctx);
  return vacancyRate(ctx) < 0.2 && (rent === 0 || rent > ref * 0.12);
}

export function averageRent(ctx: Ctx): number {
  let sum = 0, n = 0;
  for (const b of ctx.s.buildings) {
    if (!RENTALS.has(b.kind) || !b.built) continue;
    for (const u of b.units) if (u.tenant >= 0) { sum += u.rent; n++; }
  }
  return n ? sum / n : 0;
}

export function homeComfort(ctx: Ctx, p: Person): number {
  const h = ctx.bById.get(p.home);
  if (!h || !h.built || h.ruined) return 0;
  const furn = (p.durables.furniture ?? 0) > 0 ? 0.15 : 0;
  return comfortOf(h.kind, h.floors, h.condition) + furn;
}

export function moveOut(ctx: Ctx, p: Person): void {
  const h = ctx.bById.get(p.home);
  if (h && h.units[p.unit]?.tenant === p.id) {
    h.units[p.unit].tenant = -1;
    h.units[p.unit].arrears = 0;
  }
  // a trailer or house they own and leave stays theirs (they may sell it later)
  p.home = -1;
  p.unit = -1;
}

export function moveIn(ctx: Ctx, p: Person, b: Building, unit: number): void {
  const old = ctx.bById.get(p.home);
  moveOut(ctx, p);
  p.home = b.id;
  p.unit = unit;
  const u = b.units[unit];
  if (u) {
    u.tenant = p.id;
    u.since = ctx.s.tick;
    u.arrears = 0;
  }
  // a trailer or house they leave behind stays theirs: they put it up for sale
  if (old && old.owner === p.id && (old.kind === 'trailer' || old.kind === 'house') && b.id !== old.id) {
    sellBuilding(ctx, old, `${p.name} moved out`);
  }
  const rental = RENTALS.has(b.kind);
  const what = rental ? `a flat on floor ${Math.floor(unit / BUILDINGS[b.kind].unitsPerFloor) + (BUILDINGS[b.kind].podium ? 2 : 1)} of ${nameOf(ctx, b.owner)}'s ${b.floors}-floor ${b.kind === 'tower' ? 'tower' : 'building'}` : `a ${BUILDINGS[b.kind].label.toLowerCase()}`;
  log(ctx, 'home', `${p.name} moved into ${what}${u && rental ? ` (rent ${u.rent.toFixed(1)}/day)` : ''}.`, { who: p.id, bid: b.id });
}

/** Daily: tenants pay rent; landlords adjust rents to how full their buildings are. */
export function housingDaily(ctx: Ctx): void {
  for (const b of ctx.s.buildings) {
    if (!RENTALS.has(b.kind) || !b.built || b.ruined) continue;
    let empty = 0;
    for (const u of b.units) {
      if (u.tenant < 0) { empty++; continue; }
      const p = ctx.byId.get(u.tenant);
      if (!p || p.home !== b.id) { u.tenant = -1; continue; }
      if (cashOf(ctx, p.id) >= u.rent) {
        addCash(ctx, p.id, -u.rent);
        addCash(ctx, b.owner, u.rent);
        const f = ctx.fById.get(b.owner);
        if (f) f.sales.rent = (f.sales.rent ?? 0) + 1;
        u.arrears = 0;
      } else {
        u.arrears++;
        if (u.arrears >= HOUSING.evictAfterDays) {
          log(ctx, 'home', `${p.name} was evicted for not paying rent.`, { who: p.id, bid: b.id });
          moveOut(ctx, p);
        }
      }
    }
    // landlords: lower rent when units stand empty, raise it when full (within any rent cap),
    // but not below what a unit costs them to keep (upkeep, taxes): about 15% of a typical day's pay
    const vacancy = empty / Math.max(1, b.units.length);
    const cap = polityAt(ctx, b.x, b.y)?.policy.rentCap ?? 0;
    const floor = Math.max(0.8, typicalWage(ctx) * 0.15);
    for (const u of b.units) {
      if (u.rent <= 0) u.rent = initialRent(ctx, b);
      if (u.tenant >= 0) {
        // sitting tenants get a raise only once a week, and only when the building is nearly full
        if (vacancy < 0.1 && ctx.rng.chance(1 / 7)) u.rent *= 1.03;
      } else {
        u.rent *= vacancy > 0.3 ? 0.95 : vacancy > 0.1 ? 0.98 : 1.03;
        u.rent = Math.max(floor, u.rent);
      }
      if (cap > 0 && u.rent > cap) u.rent = cap;
    }
  }
}

function initialRent(ctx: Ctx, b: Building): number {
  const avg = averageRent(ctx);
  const owner = principalOf(ctx, b.owner);
  // what a tenant can pay: about a third of a typical day's wage
  const wage = ctx.s.contracts.length ? ctx.s.contracts.reduce((s, c) => s + c.wage, 0) / ctx.s.contracts.length : (owner?.hourly ?? 2) * 8;
  // a new tower asks more (views, a lobby, a gym): the higher, the dearer
  const premium = b.kind === 'tower' ? 1.15 + b.floors / 80 : 1;
  return Math.max(avg, wage * 0.3, 2) * premium;
}

function typicalWage(ctx: Ctx): number {
  const n = ctx.s.contracts.length;
  return n ? ctx.s.contracts.reduce((s, c) => s + c.wage, 0) / n : 18;
}

export function canAfford(p: Person, rent: number): boolean {
  const income = Math.max(p.hourly * 8, 1);
  return rent <= income * HOUSING.rentShareMax || p.money > rent * 30;
}
