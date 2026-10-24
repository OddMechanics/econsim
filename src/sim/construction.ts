// Who builds a new building. Construction companies do: the client takes
// the cheapest quote it can afford (40% up front, progress payments, the
// rest when done) and the company buys the materials and sends its crews.
// Only a big contractor takes on a tall tower. With no construction company
// free, the project waits (and is scaled down, then given up). Trailers come
// ready-made on a truck; governments build public works with their own crews.

import { addCash, cashOf, controllerOf, log, nameOf, principalOf, type Ctx } from './ctx';
import { BUILDINGS, materialsFor, unitsFor, workHoursFor } from './goods';
import { onFinished } from './hooks';
import { marketWage } from './jobs';
import { borrow } from './finance';
import { GOODS, type Building, type BuildingKind, type Firm } from './types';

const yardCache = new WeakMap<object, { t: number; list: Firm[] }>();
export function yardFirms(ctx: Ctx): Firm[] {
  const c = yardCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list;
  const out: Firm[] = [];
  for (const b of ctx.s.buildings) {
    if (b.kind !== 'yard' || !b.built || b.ruined) continue;
    const f = ctx.fById.get(b.firm);
    if (f && !f.closed && !out.includes(f)) out.push(f);
  }
  yardCache.set(ctx.s, { t: ctx.s.tick, list: out });
  return out;
}

/** What doesn't need a construction company: trailer homes (delivered on a truck, set up by the dealer). */
export function selfBuildable(kind: BuildingKind, _floors: number): boolean {
  return kind === 'trailer';
}

/** The crew a contractor needs to take on a building this tall. */
function crewNeeded(floors: number): number {
  return floors > 30 ? 10 : floors > 14 ? 6 : floors > 6 ? 3 : 0;
}

export function quote(ctx: Ctx, yard: Firm, b: Building): number {
  const owner = controllerOf(ctx, yard);
  const mats = materialsFor(b.kind, b.floors);
  let cost = 0;
  for (const g of GOODS) cost += mats[g] * Math.max(owner?.prices[g].p ?? 1, ctx.s.market.last[g] || 0);
  cost += (workHoursFor(b.kind, b.floors) / 8) * marketWage(ctx, 'builder');
  return cost * (yard.prices.build ?? 1.25);
}

/** A building permit: a small fee to the government where it's built (once). */
function permitFee(ctx: Ctx, client: number, b: Building): void {
  if (b.builder !== -1 && b.builder !== WAITING && b.builder !== undefined && b.due > 0) return;
  const g = permitHooks.polityAt(ctx, b.x, b.y);
  if (!g || g.firm === client) return;
  const fee = 2 + workHoursFor(b.kind, b.floors) * 0.15;
  const paid = Math.min(fee, Math.max(0, cashOf(ctx, client)));
  if (paid > 0) { addCash(ctx, client, -paid); addCash(ctx, g.firm, paid); permitHooks.book(ctx, g, paid); }
}

/** Set by government.ts (which imports this module). */
export const permitHooks = {
  polityAt: (_ctx: Ctx, _x: number, _y: number): { firm: number } | undefined => undefined,
  book: (_ctx: Ctx, _g: { firm: number }, _amount: number): void => {},
};

export function startConstruction(ctx: Ctx, client: number, b: Building): void {
  if (b.builder === -1 && b.workDone === 0 && b.lastProgress === b.created) permitFee(ctx, client, b);
  let best: Firm | undefined, bestPrice = Infinity;
  if (b.kind === 'trailer') { b.builder = -1; return; }
  for (const y of yardFirms(ctx)) {
    if (y.id === client) continue;
    if (crewOf(ctx, y) - 1 < crewNeeded(b.floors)) continue;
    // a builder only takes on what its crews can get to soon (the client's deposit pays for materials)
    if (backlogHours(ctx, y) > Math.max(1, crewOf(ctx, y)) * 70) continue;
    const q = quote(ctx, y, b) * (1 + backlogHours(ctx, y) / 400); // busy builders charge more
    if (q < bestPrice) { bestPrice = q; best = y; }
  }
  // a construction loan: companies finance most of a building with the bank (secured by the building) and keep
  // their own money to run the business; people borrow when their savings fall short of the deposit
  if (best && ctx.fById.has(client) && !ctx.govOfFirm.has(client)) borrow(ctx, client, bestPrice * 0.65, 240, `a construction loan for a ${BUILDINGS[b.kind].label.toLowerCase()}`, { building: b.id, value: bestPrice });
  if (best && cashOf(ctx, client) < bestPrice * 0.4) borrow(ctx, client, bestPrice * 0.45 - cashOf(ctx, client), 120, `building a ${BUILDINGS[b.kind].label.toLowerCase()}`, { building: b.id, value: bestPrice });
  if (best && cashOf(ctx, client) >= bestPrice * 0.4) {
    const deposit = bestPrice * 0.4;
    addCash(ctx, client, -deposit);
    addCash(ctx, best.id, deposit);
    b.builder = best.id;
    b.due = bestPrice - deposit;
    // the builder buys the materials: the client no longer needs to deliver them
    log(ctx, 'business', `${nameOf(ctx, client)} hired ${best.name} to build a ${BUILDINGS[b.kind].label.toLowerCase()} for ${bestPrice.toFixed(0)}.`, { firm: best.id, bid: b.id });
    return;
  }
  // nobody free (or big enough) to build it: it waits until a construction company can take it on
  if (!ctx.govOfFirm.has(client)) {
    if (b.builder !== WAITING) log(ctx, 'build', `${nameOf(ctx, client)}'s ${BUILDINGS[b.kind].label.toLowerCase()} is waiting for a construction company to take the job.`, { bid: b.id });
    b.builder = WAITING;
    b.lastProgress = ctx.s.tick;
    return;
  }
  b.builder = -1;
  const p = principalOf(ctx, client);
  if (p && p.projectId < 0 && ctx.byId.has(client)) p.projectId = b.id;
}

function backlogHours(ctx: Ctx, y: Firm): number {
  let h = 0;
  for (const b of ctx.s.buildings) if (b.builder === y.id && !b.built && !b.ruined) h += (b.workNeeded - b.workDone) / 60;
  return h;
}

function crewOf(ctx: Ctx, y: Firm): number {
  return ctx.s.contracts.filter((c) => c.firm === y.id && c.role === 'builder').length + 1;
}

/** builder value of a site waiting for a contractor. */
export const WAITING = -2;

/**
 * Daily: sites waiting for a contractor ask again. A project that can't get
 * going (usually because the owner can't raise the deposit) is scaled down,
 * and eventually given up: the half-planned site is cleared and the lot sold.
 */
export function contractorsDaily(ctx: Ctx): void {
  for (const b of ctx.s.buildings.slice()) {
    if (b.builder !== WAITING || b.built || b.ruined) continue;
    startConstruction(ctx, b.owner, b);
    if (b.builder !== WAITING) continue;
    const waited = (ctx.s.tick - b.created) / 1440;
    const lo = BUILDINGS[b.kind].floors[0];
    if (waited > 4 && b.floors > lo && b.workDone === 0) {
      const floors = Math.max(lo, b.floors - (b.floors > 20 ? 6 : 2));
      b.floors = floors;
      b.needed = materialsFor(b.kind, floors);
      b.workNeeded = workHoursFor(b.kind, floors) * 60;
      b.units = b.units.slice(0, unitsFor(b.kind, floors));
      b.created = ctx.s.tick;
      b.ver++;
      log(ctx, 'build', `${nameOf(ctx, b.owner)} scaled their ${BUILDINGS[b.kind].label.toLowerCase()} down to ${floors} floor${floors > 1 ? 's' : ''} to get it built.`, { bid: b.id });
    } else if (waited > 12 && b.workDone === 0) {
      log(ctx, 'build', `${nameOf(ctx, b.owner)} gave up on building a ${BUILDINGS[b.kind].label.toLowerCase()}; the lot is for sale.`, { bid: b.id });
      cancelHooks.cancel(ctx, b);
    }
  }
}

/** Set by sim.ts: clear a site that never started (the lot stays with its owner). */
export const cancelHooks = { cancel: (_ctx: Ctx, _b: Building): void => {} };

/** When a contracted building is done the client pays the rest (what it can). */
onFinished.push((ctx, b) => {
  if (b.builder >= 0 && b.due > 0) {
    const paid = Math.min(b.due, Math.max(0, cashOf(ctx, b.owner)));
    addCash(ctx, b.owner, -paid);
    addCash(ctx, b.builder, paid);
    const f = ctx.fById.get(b.builder);
    if (f) f.sales.build = (f.sales.build ?? 0) + 1;
    b.due = 0;
  }
});
