// Commercial leases. Towers have shops on the ground floor and (office
// towers) an office suite on every floor above; their owner leases them to
// companies. A vacant unit has an asking rent (`lease.tenant` = -1) that
// drops while it stands empty; a tenant pays daily and is evicted after a
// week of unpaid rent. Leasing is how most businesses downtown get a place:
// no construction, just a deposit and rent.

import { addCash, cashOf, log, nameOf, type Ctx } from './ctx';
import { BUILDINGS, EDIBLE } from './goods';
import { referenceWage } from './government';
import { endContract } from './jobs';
import { onFinished } from './hooks';
import type { Building, BuildingKind, Firm } from './types';
import { tally } from './stats';

/** Vacant units of a kind ('shopfront' on ground floors, 'suite' office floors). */
export function vacantUnits(ctx: Ctx, kind: 'shopfront' | 'suite'): Building[] {
  const out: Building[] = [];
  for (const b of ctx.s.buildings) if (b.kind === kind && b.host !== undefined && !b.ruined && b.firm < 0) out.push(b);
  return out;
}

/** What a unit's owner asks per day, without putting it on the market (for display). */
export function peekRent(ctx: Ctx, u: Building): number {
  if (u.lease) return u.lease.rent;
  const wage = referenceWage(ctx);
  const host = ctx.bById.get(u.host ?? -1);
  const central = ctx.lotById.get(host?.lot ?? u.lot)?.zone === 'core' ? 1.3 : 1;
  return u.kind === 'shopfront' ? wage * 0.55 * central : wage * (0.8 + 0.01 * (u.level ?? 0)) * central;
}

/** What a unit's owner asks per day (set when it comes on the market, lowered while it stands empty). */
export function askingRent(ctx: Ctx, u: Building): number {
  if (u.lease && u.lease.tenant < 0) return u.lease.rent;
  const wage = referenceWage(ctx);
  const host = ctx.bById.get(u.host ?? -1);
  const lot = ctx.lotById.get(host?.lot ?? u.lot);
  const central = lot?.zone === 'core' ? 1.3 : 1;
  // a shop: about half a day's pay a day (more downtown); an office floor: about a day's pay, more up high
  const rent = u.kind === 'shopfront' ? wage * 0.55 * central : wage * (0.8 + 0.01 * (u.level ?? 0)) * central;
  u.lease = { tenant: -1, rent, since: ctx.s.tick, arrears: 0 };
  return rent;
}

/** A company takes a vacant unit: it becomes its store, restaurant, office… A week's rent up front. */
export function leaseUnit(ctx: Ctx, f: Firm, u: Building, kind: BuildingKind): boolean {
  if (u.firm >= 0 || u.ruined) return false;
  const rent = askingRent(ctx, u);
  if (cashOf(ctx, f.id) < rent * 7) return false;
  addCash(ctx, f.id, -rent * 7);
  addCash(ctx, u.owner, rent * 7);
  u.kind = kind;
  u.firm = f.id;
  u.lease = { tenant: f.id, rent, since: ctx.s.tick, arrears: 0 };
  u.ver++;
  if (!f.sites.includes(u.id)) f.sites.push(u.id);
  // a TV station or internet company moving in starts broadcasting / launches its site (as when a building of its own opens)
  for (const fn of onFinished) fn(ctx, u);
  const host = ctx.bById.get(u.host ?? -1);
  log(ctx, 'business', `${f.name} leased ${u.level ? `floor ${u.level + 1} of` : 'a shop in'} ${nameOf(ctx, u.owner)}'s ${host ? BUILDINGS[host.kind].label.toLowerCase() : 'building'} for ${rent.toFixed(0)}/day.`, { firm: f.id, bid: u.id });
  return true;
}

/** The tenant leaves (or is evicted, or closed): the unit is vacant again. */
export function vacate(ctx: Ctx, u: Building, why = ''): void {
  if (u.host === undefined) return;
  const f = ctx.fById.get(u.firm);
  for (const c of ctx.s.contracts.filter((c) => c.site === u.id)) endContract(ctx, c, 'the office closed');
  ctx.s.postings = ctx.s.postings.filter((p) => p.site !== u.id);
  if (f) f.sites = f.sites.filter((id) => id !== u.id);
  for (const p of ctx.s.people) if (p.inside === u.id) p.inside = -1;
  u.kind = u.level ? 'suite' : 'shopfront';
  u.firm = -1;
  u.store = { ...u.store };
  for (const g of EDIBLE) u.store[g] = 0;
  u.lease = undefined;
  u.ver++;
  if (f && why) log(ctx, 'business', `${f.name} gave up its ${u.level ? 'office floor' : 'shop'} (${why}).`, { firm: f.id, bid: u.id });
}

/** Daily: tenants pay rent; landlords lower the asking rent of units that stand empty. */
export function leasesDaily(ctx: Ctx): void {
  for (const u of ctx.s.buildings) {
    if (u.host === undefined || u.ruined) continue;
    const l = u.lease;
    if (!l) { if (u.firm < 0) askingRent(ctx, u); continue; }
    if (l.tenant < 0) {
      // a week empty: 5% off, down to a floor
      if ((ctx.s.tick - l.since) % (7 * 1440) < 1440 && ctx.s.tick - l.since >= 7 * 1440) l.rent = Math.max(referenceWage(ctx) * 0.15, l.rent * 0.95);
      continue;
    }
    const f = ctx.fById.get(l.tenant);
    if (!f || f.closed) { vacate(ctx, u); continue; }
    if (cashOf(ctx, f.id) >= l.rent) {
      addCash(ctx, f.id, -l.rent);
      addCash(ctx, u.owner, l.rent);
      tally(ctx, 'leases', l.rent);
      l.arrears = 0;
    } else if (++l.arrears >= 7) {
      vacate(ctx, u, 'evicted for unpaid rent');
    }
  }
}
