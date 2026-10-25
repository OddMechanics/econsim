// Governments. A government (a "polity") is an organization like a firm:
// it has a charter (its rules, as data), a claimed territory, officials,
// a treasury held by its administration firm, staff (civil servants,
// police, a road crew) and public land. See docs/research/politics.md.
//
// What a government does is decided by people: the council votes on
// motions (council.ts), elections fill the offices (elections.ts), and
// people can stop recognizing it, rise up or set up a rival one
// (regime.ts). Nothing outside the charter limits it.
//
// This file: territory, founding, land (public domain, the land office,
// assessments), the treasury (taxes, welfare, stipends), staffing, and
// public works (laying out and paving streets, building a city hall).

import { LAND, MINUTES_PER_DAY, POLITICS, WAGES, WORLD } from './config';
import { cashOf, controllerOf, dayOf, headOf, isPublic, log, newId, pay, TERRITORY, type Ctx } from './ctx';
import { materialsFor, ROLE } from './goods';
import { createBuilding, findLot } from './buildings';
import { layOff, marketWage, postJob } from './jobs';
import { buyNow, hasBid, placeBid, refPrice } from './market';
import { landHooks, layoutRoads, touchRoads } from './roads';
import { permitHooks, startConstruction } from './construction';
import { procureMaterials } from './firms';
import type { Building, Charter, Firm, Lot, Office, Person, Polity, Policy, RoadEdge, Zone } from './types';
import { tally } from './stats';

// ------------------------------------------------------------------ territory

const COLS = Math.ceil((WORLD.size * WORLD.tile) / POLITICS.cell);

export function cellOf(x: number, y: number): number {
  const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / POLITICS.cell)));
  const cy = Math.max(0, Math.min(COLS - 1, Math.floor(y / POLITICS.cell)));
  return cy * COLS + cx;
}

export function cellCenter(cell: number): [number, number] {
  return [((cell % COLS) + 0.5) * POLITICS.cell, (Math.floor(cell / COLS) + 0.5) * POLITICS.cell];
}

export const TERRITORY_COLS = COLS;

/** Runtime index: cell -> polity ids claiming it (rebuilt when claims change). */
const claimIndex = new WeakMap<object, { key: string; map: Map<number, number[]> }>();

function claims(ctx: Ctx): Map<number, number[]> {
  const key = ctx.s.polities.map((g) => `${g.id}:${g.cells.length}:${g.status}`).join(',');
  const cached = claimIndex.get(ctx.s);
  if (cached && cached.key === key) return cached.map;
  const map = new Map<number, number[]>();
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    for (const c of g.cells) {
      const arr = map.get(c);
      if (arr) arr.push(g.id); else map.set(c, [g.id]);
    }
  }
  claimIndex.set(ctx.s, { key, map });
  return map;
}

/** Every government claiming the place (rivals can claim the same ground). */
export function claimants(ctx: Ctx, x: number, y: number): Polity[] {
  return (claims(ctx).get(cellOf(x, y)) ?? []).map((id) => ctx.gById.get(id)!).filter(Boolean);
}

/** The government in control at a place: the claimant with the most recognition. */
export function polityAt(ctx: Ctx, x: number, y: number): Polity | undefined {
  const list = claimants(ctx, x, y);
  if (list.length <= 1) return list[0];
  return list.reduce((a, b) => (b.legitimacy > a.legitimacy ? b : a));
}

/** The government of the city around downtown (the one the UI shows first). */
export function mainPolity(ctx: Ctx): Polity | undefined {
  return polityAt(ctx, ctx.s.center.x, ctx.s.center.y) ?? ctx.s.polities.find((g) => g.status !== 'gone');
}

/** Whose government someone lives under (where they live, or where they are). */
export function polityOf(ctx: Ctx, p: Person): Polity | undefined {
  const h = ctx.bById.get(p.home);
  return h ? polityAt(ctx, h.x, h.y) : polityAt(ctx, p.x, p.y);
}

export function residentsOf(ctx: Ctx, g: Polity): Person[] {
  return ctx.s.people.filter((p) => polityOf(ctx, p) === g);
}

export function adminOf(ctx: Ctx, g: Polity): Firm | undefined {
  return ctx.fById.get(g.firm);
}

export function treasury(ctx: Ctx, g: Polity): number {
  return cashOf(ctx, g.firm);
}

// ----------------------------------------------------------------- the land

landHooks.ownerAt = (ctx, x, y) => polityAt(ctx, x, y)?.firm ?? TERRITORY.id;
permitHooks.polityAt = (ctx, x, y) => polityAt(ctx, x, y);
permitHooks.book = (ctx, g, amount) => book(ctx, g as Polity, 'income', 'building permits', amount);
landHooks.isPublic = (ctx, owner) => isPublic(ctx, owner);
landHooks.priceOf = (ctx, lot) => listPrice(ctx, lot);

/** What a lot is worth: its size and zone, the city's size, demand for land, and what it last sold for. */
export function assessLot(ctx: Ctx, lot: Lot): number {
  const area = lot.w * lot.d;
  const pop = ctx.s.people.length;
  const demand = 1 + Math.min(1.5, Math.max(0, (ctx.s.landDemand?.[lot.zone] ?? 0) / 20));
  // and the closer to the center, the dearer (within its zone)
  const central = Math.max(0.6, 1.35 - Math.hypot(lot.x - ctx.s.center.x, lot.y - ctx.s.center.y) / 600);
  const base = area * (LAND.perM2[lot.zone] ?? 0.05) * (0.5 + pop / 150) * demand * central;
  return lot.lastSale ? 0.5 * base + 0.5 * lot.lastSale : base;
}

/** What it would cost to build a building like this again (materials at market prices), as it stands. */
export function buildingValue(ctx: Ctx, b: Building): number {
  if (b.ruined) return 0;
  const mats = materialsFor(b.kind, b.floors);
  let v = 0;
  for (const g of Object.keys(mats) as (keyof typeof mats)[]) v += (b.built ? mats[g] * b.condition : mats[g] - b.needed[g]) * refPrice(ctx, g);
  return v * 1.6; // labor
}

/** Asking price for public land (and the Territory's frontier prices). */
function listPrice(ctx: Ctx, lot: Lot): number {
  if (lot.owner === TERRITORY.id) return LAND.territoryPrice[lot.zone] ?? 30;
  const g = ctx.govOfFirm.get(lot.owner);
  if (!g) return lot.forSale;
  if (g.policy.landPrice <= 0) return 1; // homesteading: a filing fee
  return Math.round(assessLot(ctx, lot) * g.policy.landPrice);
}

/** Daily: the land offices reprice public land; private owners may sell lots they don't use. */
export function landOfficeDaily(ctx: Ctx): void {
  for (const l of ctx.s.roads.lots) {
    if (l.building >= 0) { l.forSale = 0; continue; }
    if (isPublic(ctx, l.owner)) { l.forSale = listPrice(ctx, l); continue; }
    // private empty lots: owners not planning anything sell now and then (speculators hold out for more)
    const owner = ctx.byId.get(l.owner);
    if (owner && owner.projectId >= 0) continue;
    if (l.forSale <= 0 && ctx.rng.chance(0.08)) l.forSale = Math.round(assessLot(ctx, l) * (1.1 + 0.4 * (owner?.traits.patience ?? 0.5)));
  }
  // demand for land fades unless people keep looking
  if (ctx.s.landDemand) for (const z of Object.keys(ctx.s.landDemand) as Zone[]) ctx.s.landDemand[z] = (ctx.s.landDemand[z] ?? 0) * 0.85;
}

/**
 * Outside every city's limits the Territory (like a county) surveys a new
 * country road now and then when people want farmland and homesteads.
 */
export function territoryDaily(ctx: Ctx): void {
  const want = (ctx.s.landDemand?.rural ?? 0) + (ctx.s.landDemand?.suburb ?? 0) * 0.5;
  if (want < 8 || !ctx.rng.chance(0.35)) return;
  const before = ctx.s.roads.lots.length;
  layoutRoads(ctx, 'rural', 1);
  const made = ctx.s.roads.lots.slice(before).filter((l) => l.owner === TERRITORY.id).length;
  if (made) log(ctx, 'build', `The Territory surveyed a new country road outside the city limits (${made} lots for sale).`);
}

/** Someone wanted land of a zone and found none they could afford. */
/** Someone looked for land of these zones and found none they could get (governments may lay out streets). */
export function noteLandDemand(ctx: Ctx, zones: Zone[]): void {
  ctx.s.landDemand ??= {};
  for (const z of zones) ctx.s.landDemand[z] = (ctx.s.landDemand[z] ?? 0) + 1 / zones.length;
}

// --------------------------------------------------------------- founding

export function defaultCharter(): Charter {
  return {
    execTitle: 'Mayor', execBy: 'voters', execTerm: POLITICS.year * 2, execLimit: 0, veto: false,
    councilTitle: 'City Council', seats: 5, councilBy: 'voters', councilTerm: POLITICS.year * 2, staggered: false,
    districts: 0, method: 'plurality', franchise: 'residents', residency: 5, parties: 'free', press: 'free',
    ownership: 'private', amend: 'supermajority', redistrict: 'council', recall: true, initiative: 0.1, suspendedUntil: 0,
  };
}

export function defaultPolicy(): Policy {
  return {
    propertyTax: 0.01, salesTax: 0.02, incomeTax: 0.03, welfare: 3, police: 1, roadCrew: 3, clerks: 1,
    rentCap: 0, maxFloors: 0, minWage: 0, landPrice: 1, priceCaps: false, nationalizeAbove: 0, immigration: 'open', publicHousing: false,
  };
}

/** A description of the system a charter sets up (it changes when the charter does). */
export function systemLabel(ctx: Ctx, g: Polity): string {
  const c = g.charter;
  const suspended = c.suspendedUntil > ctx.s.tick ? ', elections suspended' : '';
  const elected = c.execBy === 'voters' || c.councilBy === 'voters' || c.councilBy === 'all';
  if (g.status === 'provisional') return `provisional government${suspended}`;
  if (g.status === 'rival') return `rival government (claims to rule)${suspended}`;
  if (c.execBy === 'force') return c.councilBy === 'voters' ? `military-backed regime${suspended}` : `military junta${suspended}`;
  if (c.execBy === 'owner') return `company town${elected ? ' with an elected council' : ''}${suspended}`;
  if (c.execBy === 'successor' || (c.execTerm === 0 && c.execBy !== 'none')) return elected ? `ruler for life with an elected council${suspended}` : `autocracy (ruler for life)${suspended}`;
  if (c.parties === 'single' && c.ownership === 'collective') return `one-party communist state${suspended}`;
  if (c.parties === 'single') return `one-party state${suspended}`;
  if (!elected) {
    if (c.franchise === 'owners' || c.councilBy === 'appointed') return c.ownership === 'collective' ? `appointed workers' council${suspended}` : `oligarchy (appointed council)${suspended}`;
    return `unelected government${suspended}`;
  }
  const owners = c.franchise === 'owners' ? "property owners' " : c.franchise === 'members' ? "members' " : '';
  if (c.councilBy === 'all') return `${owners}direct democracy (town meeting)${suspended}`;
  const socialist = c.ownership === 'collective' ? 'socialist ' : c.ownership === 'mixed' ? 'social-democratic ' : '';
  const form = c.execBy === 'voters' ? (c.veto ? 'strong-mayor' : 'mayor–council') : c.execBy === 'council' ? 'council–manager'
    : c.execBy === 'party' ? 'party-led council' : 'commission';
  const pr = c.method === 'list' ? ', proportional' : '';
  const kind = c.franchise === 'owners' ? 'republic' : 'democracy';
  return `${socialist}${owners}${form} ${kind}${pr}${suspended}`;
}

export interface FoundingArgs {
  name: string;
  short: string;
  cx: number;
  cy: number;
  radius: number;
  charter: Charter;
  policy: Policy;
  status?: Polity['status'];
  parent?: number;
  hue?: number;
}

/** Set up a new government: its administration, territory and offices. Public land inside the claim becomes its domain. */
export function foundPolity(ctx: Ctx, a: FoundingArgs): Polity {
  const id = newId(ctx);
  const firm: Firm = {
    id: newId(ctx), name: `${a.short} City Government`, owner: id, founded: ctx.s.tick, cash: 0, kind: 'cityhall',
    sites: [], prices: {}, wages: {}, ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.5, sales: {}, salesAvg: {},
    losing: 0, hue: a.hue ?? ctx.rng.next(), website: true, slogan: 'Serving the public', closed: false, gov: id,
  };
  ctx.s.firms.push(firm);
  ctx.fById.set(firm.id, firm);
  const cells: number[] = [];
  for (let c = 0; c < COLS * COLS; c++) {
    const [x, y] = cellCenter(c);
    if (Math.hypot(x - a.cx, y - a.cy) <= a.radius) cells.push(c);
  }
  const g: Polity = {
    id, name: a.name, short: a.short, founded: ctx.s.tick, firm: firm.id, seat: -1, cells, districts: [],
    charter: a.charter, policy: a.policy, offices: [], status: a.status ?? 'active', label: '', hue: firm.hue,
    nextElection: -1, nextSession: -1, agenda: [], laws: [], legitimacy: 0.7, coups: 0,
    fiscal: { day: dayOf(ctx.s.tick), income: {}, spend: {}, prevIncome: {}, prevSpend: {} },
    lastCensus: ctx.s.tick, parent: a.parent ?? -1, cx: a.cx, cy: a.cy,
  };
  ctx.s.polities.push(g);
  ctx.gById.set(g.id, g);
  ctx.govOfFirm.set(firm.id, g);
  rebuildOffices(ctx, g);
  // the public domain: land inside the claim that the Territory (or a predecessor's state) held
  for (const l of ctx.s.roads.lots) {
    if (l.owner !== TERRITORY.id) continue;
    const [x, y] = [l.x, l.y];
    if (cells.includes(cellOf(x, y))) { l.owner = firm.id; l.forSale = listPrice(ctx, l); }
  }
  g.label = systemLabel(ctx, g);
  return g;
}

/** Offices follow from the charter: an executive, council seats (by district or at-large). Holders are kept where seats survive. */
export function rebuildOffices(ctx: Ctx, g: Polity): void {
  const c = g.charter;
  const old = g.offices;
  const out: Office[] = [];
  const keep = (kind: Office['kind'], district: number, title: string) => {
    const prev = old.find((o) => o.kind === kind && o.district === district && !out.includes(o));
    if (prev) { prev.title = title; out.push(prev); return; }
    out.push({ id: newId(ctx), title, kind, district, holder: -1, party: -1, since: ctx.s.tick, termEnd: -1, terms: 0 });
  };
  if (c.execBy !== 'none') keep('exec', -1, c.execTitle);
  if (c.councilBy !== 'all' && c.councilBy !== 'none') {
    if (c.districts > 0) {
      const perDistrict = Math.max(1, Math.round(c.seats / c.districts));
      for (let d = 0; d < c.districts; d++) for (let k = 0; k < perDistrict; k++) keep('council', d * 100 + k, `${councillorTitle(c)} (District ${d + 1}${perDistrict > 1 ? String.fromCharCode(97 + k) : ''})`);
    } else {
      for (let k = 0; k < c.seats; k++) keep('council', -1 - k, `${councillorTitle(c)} (at-large)`);
    }
  }
  keep('chief', -1, 'Police Chief');
  keep('clerk', -1, 'City Clerk');
  // anyone whose seat was abolished leaves office
  g.offices = out;
}

export function councillorTitle(c: Charter): string {
  return c.councilTitle.includes("People's") ? 'Deputy' : c.councilTitle.includes('Assembly') ? 'Assembly member' : 'Councillor';
}

export function councilSeats(g: Polity): Office[] {
  return g.offices.filter((o) => o.kind === 'council');
}

export function holds(g: Polity, personId: number): Office | undefined {
  return g.offices.find((o) => o.holder === personId);
}

/** Which government office (if any) a person holds, anywhere. */
export function officeOf(ctx: Ctx, p: Person): { g: Polity; o: Office } | undefined {
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    const o = holds(g, p.id);
    if (o) return { g, o };
  }
  return undefined;
}

// ------------------------------------------------------------- the treasury

function book(ctx: Ctx, g: Polity, side: 'income' | 'spend', key: string, amount: number): void {
  const day = dayOf(ctx.s.tick);
  if (g.fiscal.day !== day) {
    g.fiscal.prevIncome = g.fiscal.income;
    g.fiscal.prevSpend = g.fiscal.spend;
    g.fiscal.income = {};
    g.fiscal.spend = {};
    g.fiscal.day = day;
  }
  const rec = g.fiscal[side];
  rec[key] = (rec[key] ?? 0) + amount;
  // for the statistics window (all governments together, on the same day boundary as everything else)
  tally(ctx, (side === 'income' ? 'gin:' : 'gsp:') + key, amount);
}

/** Income tax withheld from a wage paid at a site (to the government in control there). Returns the tax. */
export function withholdIncomeTax(ctx: Ctx, site: Building | undefined, worker: Person, gross: number): number {
  if (!site || gross <= 0) return 0;
  const g = polityAt(ctx, site.x, site.y);
  if (!g || g.policy.incomeTax <= 0) return 0;
  const tax = gross * g.policy.incomeTax;
  const paid = pay(ctx, worker.id, g.firm, tax, true);
  if (paid > 0) book(ctx, g, 'income', 'income tax', paid);
  return paid;
}

/** Sales tax on a sale at a site, paid by the seller out of what the customer paid. */
export function collectSalesTax(ctx: Ctx, site: Building, seller: number, amount: number): void {
  const g = polityAt(ctx, site.x, site.y);
  if (!g || g.policy.salesTax <= 0 || seller === g.firm) return;
  const paid = pay(ctx, seller, g.firm, amount * g.policy.salesTax, true);
  if (paid > 0) book(ctx, g, 'income', 'sales tax', paid);
}

/** A sale of public land: the proceeds are government income. */
export function noteLandSale(ctx: Ctx, lot: Lot, price: number, seller: number): void {
  lot.lastSale = price;
  const g = ctx.govOfFirm.get(seller);
  if (g && price > 0) book(ctx, g, 'income', 'land sales', price);
}

/** Daily property tax on everything privately owned inside the territory; unpaid tax piles up as arrears. */
function propertyTax(ctx: Ctx, g: Polity): void {
  const rate = g.policy.propertyTax / POLITICS.year;
  if (rate <= 0) return;
  const owners = new Map<number, number>();
  const inside = new Set(g.cells);
  for (const b of ctx.s.buildings) {
    if (b.ruined || isPublic(ctx, b.owner) || !inside.has(cellOf(b.x, b.y))) continue;
    const lot = ctx.lotById.get(b.lot);
    const value = (lot ? assessLot(ctx, lot) : 0) + buildingValue(ctx, b);
    owners.set(b.owner, (owners.get(b.owner) ?? 0) + value * rate);
  }
  for (const l of ctx.s.roads.lots) {
    if (l.building >= 0 || isPublic(ctx, l.owner) || !inside.has(cellOf(l.x, l.y))) continue;
    owners.set(l.owner, (owners.get(l.owner) ?? 0) + assessLot(ctx, l) * rate);
  }
  ctx.s.taxArrears ??= {};
  for (const [who, due] of owners) {
    const owed = due + (ctx.s.taxArrears[who] ?? 0);
    const p = ctx.byId.get(who);
    // people who don't accept this government's authority dodge it when they can
    if (p && (p.pol.rec[g.id] ?? 0.6) < 0.4 && ctx.rng.chance(0.6)) { ctx.s.taxArrears[who] = owed; continue; }
    const paid = pay(ctx, who, g.firm, owed, true);
    if (paid > 0) book(ctx, g, 'income', 'property tax', paid);
    const left = owed - paid;
    if (left > 0.01) ctx.s.taxArrears[who] = left; else delete ctx.s.taxArrears[who];
  }
}

/** Daily payments: elected officials' stipends and welfare for those without income. */
function payOut(ctx: Ctx, g: Polity): void {
  const ref = marketWage(ctx, 'clerk') / ROLE.clerk.pay;
  for (const o of g.offices) {
    if (o.holder < 0 || o.kind === 'chief' || o.kind === 'clerk') continue;
    // a part-time council stipend, a salary for the executive; small towns pay little
    const scale = Math.min(1, 0.25 + residentsOf(ctx, g).length / 500);
    const stipend = ref * (o.kind === 'exec' ? 1.2 : 0.15) * scale;
    const paid = pay(ctx, g.firm, o.holder, stipend, true);
    if (paid > 0) book(ctx, g, 'spend', 'officials', paid);
  }
  if (g.policy.welfare <= 0) return;
  // the welfare budget: what the treasury can spare (about a third of what came in, plus some savings)
  let budget = Math.max(0, Object.values(g.fiscal.prevIncome).reduce((s, x) => s + x, 0) * 0.4 + Math.max(0, treasury(ctx, g) - 100) * 0.1);
  for (const p of residentsOf(ctx, g)) {
    if (p.job >= 0 || p.firms.length || p.money > g.policy.welfare * 15) continue;
    if (ctx.s.tick - p.arrived < g.charter.residency * MINUTES_PER_DAY) continue;
    // only those who applied (online on the city's website, or in person at city hall), for 30 days at a time
    if ((p.cooldown.welfare ?? 0) < ctx.s.tick) continue;
    if (budget < 0.5) break; // the welfare budget is spent
    const paid = pay(ctx, g.firm, p.id, Math.min(g.policy.welfare, budget), true);
    budget -= paid;
    if (paid <= 0) break; // the treasury is empty
    p.pol.rec[g.id] = Math.min(1, (p.pol.rec[g.id] ?? 0.6) + 0.004);
    book(ctx, g, 'spend', 'welfare', paid);
  }
}

// ----------------------------------------------------------------- staffing

/**
 * Where the government sits: its city hall (while it's being built, meetings
 * and votes happen outdoors on the site), else the main city's hall.
 */
export function govSite(ctx: Ctx, g: Polity): Building | undefined {
  const hall = ctx.bById.get(g.seat);
  if (hall && !hall.ruined) return hall;
  const main = mainPolity(ctx);
  const other = main && main !== g ? ctx.bById.get(main.seat) : undefined;
  return other && !other.ruined ? other : undefined;
}

function staffGovernment(ctx: Ctx, g: Polity): void {
  const f = adminOf(ctx, g);
  const site = govSite(ctx, g);
  if (!f || !site) return;
  const hall = site.kind === 'cityhall' && site.built && site.id === g.seat;
  const want: Partial<Record<'civil' | 'officer' | 'builder', number>> = {
    civil: hall ? g.policy.clerks : 0,
    officer: g.policy.police,
    builder: g.policy.roadCrew,
  };
  for (const [role, n] of Object.entries(want) as ['civil' | 'officer' | 'builder', number][]) {
    // staff report wherever the government sits now
    const have = ctx.s.contracts.filter((c) => c.firm === f.id && c.role === role && c.noticeEnd < 0);
    for (const c of have) if (c.site !== site.id) c.site = site.id;
    const posting = ctx.s.postings.find((p) => p.firm === f.id && p.role === role);
    const wage = Math.max(g.policy.minWage, marketWage(ctx, role) * 1.02);
    if (have.length < n) {
      if (!posting && cashOf(ctx, f.id) > wage * 5) postJob(ctx, f, site.id, role, wage);
      else if (posting && ctx.s.tick - posting.t > 2 * MINUTES_PER_DAY && !posting.applicants.length) { posting.wage *= 1.06; posting.t = ctx.s.tick; }
    } else {
      if (posting) ctx.s.postings = ctx.s.postings.filter((p) => p !== posting);
      if (have.length > n) layOff(ctx, have.reduce((a, c) => (c.start > a.start ? c : a)));
    }
  }
  // a broke government lays off its newest staff
  const bill = ctx.s.contracts.filter((c) => c.firm === f.id).reduce((s, c) => s + c.wage, 0);
  if (cashOf(ctx, f.id) < bill * 0.5 && bill > 0) {
    const newest = ctx.s.contracts.filter((c) => c.firm === f.id && c.noticeEnd < 0).sort((a, b) => b.start - a.start)[0];
    if (newest) layOff(ctx, newest);
  }
}

// ------------------------------------------------------------ public works

/** Lay out new streets where land is wanted. Returns lots created. */
export function layOutStreets(ctx: Ctx, g: Polity, zone: Zone, n: number): number {
  // the main city follows its street plan; other towns grow around their own center
  const main = mainPolity(ctx) === g;
  let center: { x: number; y: number } | undefined;
  if (!main && g.cells.length) {
    const pts = g.cells.map(cellCenter);
    center = { x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length };
  }
  const made = layoutRoads(ctx, zone, n, center);
  for (const l of ctx.s.roads.lots) if (l.owner === TERRITORY.id && g.cells.includes(cellOf(l.x, l.y))) { l.owner = g.firm; l.forSale = listPrice(ctx, l); }
  return made;
}

/** Streets worth paving: unpaved, with the most buildings along them first. */
export function pavingCandidates(ctx: Ctx, g: Polity): { e: RoadEdge; score: number; cost: number }[] {
  const inside = new Set(g.cells);
  const along = new Map<number, number>();
  for (const l of ctx.s.roads.lots) if (l.building >= 0) along.set(l.edge, (along.get(l.edge) ?? 0) + 1);
  const out: { e: RoadEdge; score: number; cost: number }[] = [];
  for (const e of ctx.s.roads.edges) {
    if (e.built !== false || e.paving) continue;
    const a = ctx.nodeById.get(e.a), b = ctx.nodeById.get(e.b);
    if (!a || !b || !inside.has(cellOf((a.x + b.x) / 2, (a.y + b.y) / 2))) continue;
    const n = along.get(e.id) ?? 0;
    out.push({ e, score: n + (e.kind === 'avenue' ? 2 : 0) + (e.name === 'Market Square' ? 3 : 0), cost: pavingCost(ctx, e) });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Stone per meter and labor: what paving a street will roughly cost. */
export function pavingCost(ctx: Ctx, e: RoadEdge): number {
  const stone = stoneFor(e) * (1 - (e.progress ?? 0));
  const hours = (e.len * (1 - (e.progress ?? 0))) / pavePerHour(e);
  return stone * Math.max(0.9, refPrice(ctx, 'stone')) + hours * marketWage(ctx, 'builder') / 8;
}

const stoneFor = (e: RoadEdge) => e.len * e.width * 0.08;
const pavePerHour = (e: RoadEdge) => 4 * (7.5 / e.width); // meters per worker-hour (a crew with machines paves a block in a day or two)

/** One minute of a road crew member paving. Returns false when there's nothing they can do here. */
export function paveMinute(ctx: Ctx, g: Polity, e: RoadEdge, worker: Person): boolean {
  if (e.built !== false) return false;
  const site = govSite(ctx, g);
  const perMeter = stoneFor(e) / e.len;
  const meters = (pavePerHour(e) / 60) * Math.min(1.5, 1 + (worker.skills.builder ?? 0) / 400) * (worker.inv.tools > 0 ? 1.2 : 1);
  const stone = perMeter * meters;
  if (!site || site.store.stone < stone) return false;
  site.store.stone -= stone;
  e.progress = Math.min(1, (e.progress ?? 0) + meters / e.len);
  e.active = true;
  worker.skills.builder = (worker.skills.builder ?? 0) + 1 / 60;
  if (Math.floor(e.progress * 20) !== Math.floor((e.progress - meters / e.len) * 20)) touchRoads(ctx); // redraw every 5%
  if (e.progress >= 1) {
    e.built = undefined;
    e.progress = undefined;
    e.paving = undefined;
    e.active = undefined;
    touchRoads(ctx);
    log(ctx, 'build', `${e.name ?? 'A street'} was paved (${g.short}).`, {});
  }
  return true;
}

/** The paving job nearest to a crew member. */
export function nextPavingJob(ctx: Ctx, g: Polity, p: Person): RoadEdge | undefined {
  const inside = new Set(g.cells);
  let best: RoadEdge | undefined, bestD = Infinity;
  for (const e of ctx.s.roads.edges) {
    if (!e.paving || e.built !== false) continue;
    const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
    if (!inside.has(cellOf((a.x + b.x) / 2, (a.y + b.y) / 2))) continue;
    const t = e.progress ?? 0;
    const d = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/** Point where paving continues on an edge (the front), plus the direction along it. */
export function pavingFront(ctx: Ctx, e: RoadEdge): { x: number; y: number; dir: number } {
  const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!;
  const t = e.progress ?? 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Buy the stone the crews will need, and materials for government buildings. */
function procureWorks(ctx: Ctx, g: Polity): void {
  const site = govSite(ctx, g);
  const f = adminOf(ctx, g);
  if (!site || !f) return;
  let need = 0;
  for (const e of ctx.s.roads.edges) if (e.paving && e.built === false) need += stoneFor(e) * (1 - (e.progress ?? 0));
  const target = Math.min(need, 60);
  const short = Math.ceil(target - site.store.stone);
  if (short >= 1) {
    // buy what's on offer at a reasonable price; bid for the rest
    const price = Math.max(1, refPrice(ctx, 'stone') * 1.4);
    const afford = Math.floor(Math.max(0, cashOf(ctx, f.id) - 30) / price);
    const got = afford > 0 ? buyNow(ctx, f.id, 'stone', Math.min(short, afford), price, site.id) : 0;
    if (got < short && !hasBid(ctx, f.id, 'stone') && cashOf(ctx, f.id) > (short - got) * price * 1.5) placeBid(ctx, f.id, 'stone', short - got, price, site.id);
  }
  for (const id of f.sites) {
    const b = ctx.bById.get(id);
    const head = controllerOf(ctx, f) ?? ctx.s.people[0];
    if (b && !b.built && !b.ruined && head) procureMaterials(ctx, f, b, head);
  }
  for (const e of ctx.s.roads.edges) if (e.active) e.active = false; // crews set it again while they work
}

/** Build a city hall (a council decision). */
export function buildCityHall(ctx: Ctx, g: Polity): Building | null {
  const f = adminOf(ctx, g);
  if (!f) return null;
  const lot = findLot(ctx, 'cityhall', { x: g.cx ?? ctx.s.center.x, y: g.cy ?? ctx.s.center.y }, f.id);
  if (!lot) return null;
  const floors = Math.min(4, 2 + Math.floor(ctx.s.people.length / 300));
  const b = createBuilding(ctx, 'cityhall', lot, f.id, floors, false, f.id);
  startConstruction(ctx, f.id, b);
  if (b.builder < 0) b.builder = f.id; // the public works crew builds it
  g.seat = b.id;
  log(ctx, 'politics', `${g.name} broke ground on a ${floors}-floor city hall.`, { bid: b.id, firm: f.id });
  return b;
}

// ------------------------------------------------------------------- daily

/**
 * A government sitting on far more than it could spend (a big escheated
 * estate, years of surpluses) pays residents a small daily dividend from the
 * excess, like Alaska's resident dividend, so the money doesn't vanish from
 * the economy.
 */
function windfall(ctx: Ctx, g: Polity): void {
  // what it normally spends a day (not counting yesterday's dividend itself, or it would only pay every other day)
  const daily = Object.entries(g.fiscal.prevSpend).filter(([k]) => k !== 'resident dividend').reduce((s, [, x]) => s + x, 0) + 20;
  const excess = treasury(ctx, g) - daily * 60 - 2000;
  if (excess <= 0) return;
  const people = residentsOf(ctx, g);
  if (!people.length) return;
  const each = (excess * 0.03) / people.length;
  if (each < 0.5) return;
  for (const p of people) pay(ctx, g.firm, p.id, each, true);
  book(ctx, g, 'spend', 'resident dividend', each * people.length);
  if (!g.data?.dividend) { g.data = { ...(g.data ?? {}), dividend: 1 }; log(ctx, 'politics', `${g.name} has more money than it can spend and started paying every resident a daily dividend.`); }
}

export function governmentsDaily(ctx: Ctx): void {
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    // a city hall that was lost (fell into ruin, torn down) is rebuilt
    const hall = ctx.bById.get(g.seat);
    if (g.seat >= 0 && (!hall || hall.ruined)) g.seat = -1;
    if (g.seat < 0 && treasury(ctx, g) > 400 && g === mainPolity(ctx)) buildCityHall(ctx, g);
    propertyTax(ctx, g);
    payOut(ctx, g);
    windfall(ctx, g);
    staffGovernment(ctx, g);
    procureWorks(ctx, g);
    const f = adminOf(ctx, g);
    if (f) {
      f.ledger.days.push(f.ledger.revenue - f.ledger.costs);
      if (f.ledger.days.length > 14) f.ledger.days.shift();
      f.ledger.revenue = 0;
      f.ledger.costs = 0;
    }
    g.label = systemLabel(ctx, g);
  }
}

/** Is this firm a government's administration? */
export function isAdmin(ctx: Ctx, f: Firm): boolean {
  return ctx.govOfFirm.has(f.id);
}

/** The government's head (or anyone in office) to speak for it. */
export function spokesperson(ctx: Ctx, g: Polity): Person | undefined {
  return headOf(ctx, g);
}

/** Add to the treasury's books (used by other modules: fines, fees, auctions). */
export function bookIncome(ctx: Ctx, g: Polity, key: string, amount: number): void {
  book(ctx, g, 'income', key, amount);
}

export function bookSpend(ctx: Ctx, g: Polity, key: string, amount: number): void {
  book(ctx, g, 'spend', key, amount);
}

/** A rough reference wage (per shift) for setting stipends, welfare and policy amounts. */
const refCache = new WeakMap<object, { t: number; v: number }>();
export function referenceWage(ctx: Ctx): number {
  const c = refCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.v;
  const n = ctx.s.contracts.length;
  let v = WAGES.reference;
  if (n) {
    let sum = 0, pay = 0;
    for (const k of ctx.s.contracts) { sum += k.wage; pay += ROLE[k.role].pay; }
    v = sum / pay;
  }
  refCache.set(ctx.s, { t: ctx.s.tick, v });
  return v;
}

