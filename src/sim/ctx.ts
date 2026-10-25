import { MINUTES_PER_DAY, NIGHT, STATS } from './config';
import { Rng } from './rng';
import { inGrid } from './world';
import type { Building, Contract, Firm, LogEntry, Lot, Party, Person, Polity, RoadEdge, RoadNode, SimState, Vehicle } from './types';

/** The outside world's land office: owns all land no government here has claimed. Money paid to it leaves the economy. */
export const TERRITORY = { id: -3, name: 'the Territory' } as const;

/**
 * Runtime wrapper around the serializable state: the RNG object and lookup
 * caches that are rebuilt after loading a save.
 */
export interface Ctx {
  s: SimState;
  rng: Rng;
  byId: Map<number, Person>;
  bById: Map<number, Building>;
  fById: Map<number, Firm>;
  cById: Map<number, Contract>;
  vById: Map<number, Vehicle>;
  lotById: Map<number, Lot>;
  nodeById: Map<number, RoadNode>;
  edgeById: Map<number, RoadEdge>;
  gById: Map<number, Polity>;
  partyById: Map<number, Party>;
  /** Administration firm id -> its polity. */
  govOfFirm: Map<number, Polity>;
}

export function makeCtx(s: SimState): Ctx {
  const ctx: Ctx = {
    s,
    rng: new Rng(s.rng),
    byId: new Map(s.people.map((p) => [p.id, p])),
    bById: new Map(s.buildings.map((b) => [b.id, b])),
    fById: new Map(s.firms.map((f) => [f.id, f])),
    cById: new Map(s.contracts.map((c) => [c.id, c])),
    vById: new Map(s.vehicles.map((v) => [v.id, v])),
    lotById: new Map(s.roads.lots.map((l) => [l.id, l])),
    nodeById: new Map(s.roads.nodes.map((n) => [n.id, n])),
    edgeById: new Map(s.roads.edges.map((e) => [e.id, e])),
    gById: new Map(s.polities.map((g) => [g.id, g])),
    partyById: new Map(s.parties.map((p) => [p.id, p])),
    govOfFirm: new Map(s.polities.map((g) => [g.firm, g])),
  };
  return ctx;
}

export function newId(ctx: Ctx): number {
  return ctx.s.nextId++;
}

export const hourOf = (tick: number) => Math.floor((tick % MINUTES_PER_DAY) / 60);
export const minuteOfDay = (tick: number) => tick % MINUTES_PER_DAY;
export const dayOf = (tick: number) => Math.floor(tick / MINUTES_PER_DAY);
export const dayStart = (tick: number) => dayOf(tick) * MINUTES_PER_DAY;

export function isNight(tick: number): boolean {
  const h = hourOf(tick);
  return h >= NIGHT.start || h < NIGHT.end;
}

export function log(ctx: Ctx, kind: LogEntry['kind'], text: string, extra: { who?: number; bid?: number; firm?: number } = {}): void {
  ctx.s.log.push({ t: ctx.s.tick, kind, text, ...extra });
  if (ctx.s.log.length > STATS.logMax) ctx.s.log.splice(0, ctx.s.log.length - STATS.logMax);
}

export function formatTime(tick: number): string {
  const m = minuteOfDay(tick);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `Day ${dayOf(tick) + 1}, ${hh}:${mm}`;
}

// ---------------------------------------------------------------- accounts
// People and firms both hold money. These helpers let code pay "whoever an
// id is" without caring which.

export function nameOf(ctx: Ctx, id: number): string {
  if (id === -2) return 'outside companies';
  if (id === TERRITORY.id) return TERRITORY.name;
  const g = ctx.gById.get(id) ?? ctx.govOfFirm.get(id);
  if (g) return g.name;
  return ctx.byId.get(id)?.name ?? ctx.fById.get(id)?.name ?? ctx.partyById.get(id)?.name ?? 'someone';
}

/** Governments hold their money in their administration firm. */
function account(ctx: Ctx, id: number): number {
  const g = ctx.gById.get(id);
  return g ? g.firm : id;
}

export function cashOf(ctx: Ctx, id: number): number {
  id = account(ctx, id);
  const p = ctx.byId.get(id);
  if (p) return p.money;
  const f = ctx.fById.get(id);
  if (f) return f.cash;
  const party = ctx.partyById.get(id);
  return party ? party.cash : 0;
}

export function addCash(ctx: Ctx, id: number, amount: number): void {
  id = account(ctx, id);
  const party = ctx.partyById.get(id);
  if (party) { party.cash += amount; return; }
  const p = ctx.byId.get(id);
  if (p) {
    p.money += amount;
    if (amount > 0) p.earned += amount;
    return;
  }
  const f = ctx.fById.get(id);
  if (f) {
    f.cash += amount;
    if (amount > 0) f.ledger.revenue += amount;
    else f.ledger.costs -= amount;
  }
}

/** Move money between any two accounts. Returns the amount actually paid. */
export function pay(ctx: Ctx, from: number, to: number, amount: number, partial = false): number {
  const have = cashOf(ctx, from);
  const amt = partial ? Math.max(0, Math.min(have, amount)) : amount;
  if (amt <= 0 || (!partial && have < amount - 1e-9)) return 0;
  addCash(ctx, from, -amt);
  addCash(ctx, to, amt);
  return amt;
}

/** The person ultimately behind an account: a person, or whoever runs the firm or government. */
export function principalOf(ctx: Ctx, id: number): Person | undefined {
  const p = ctx.byId.get(id);
  if (p) return p;
  const f = ctx.fById.get(id);
  if (f) return controllerOf(ctx, f);
  const g = ctx.gById.get(id);
  return g ? headOf(ctx, g) : undefined;
}

/** Whoever makes a firm's decisions: its owner, its appointed manager, or (state firms) the government's head. */
export function controllerOf(ctx: Ctx, f: Firm, depth = 0): Person | undefined {
  const owner = ctx.byId.get(f.owner);
  if (owner) return owner;
  const m = ctx.byId.get(f.manager ?? -1);
  if (m) return m;
  if (depth > 3) return undefined;
  const parent = ctx.fById.get(f.owner);
  if (parent) return controllerOf(ctx, parent, depth + 1);
  const g = ctx.gById.get(f.owner) ?? ctx.gById.get(f.gov ?? -1);
  return g ? headOf(ctx, g) : undefined;
}

/** The person at the head of a government (or the longest-serving member if the top office is vacant). */
export function headOf(ctx: Ctx, g: Polity): Person | undefined {
  const exec = g.offices.find((o) => o.kind === 'exec' && o.holder >= 0);
  const p = exec ? ctx.byId.get(exec.holder) : undefined;
  if (p) return p;
  let best: Person | undefined, since = Infinity;
  for (const o of g.offices) {
    const q = ctx.byId.get(o.holder);
    if (q && o.since < since) { since = o.since; best = q; }
  }
  return best;
}

/** A firm owned by a government (its administration or a nationalized company)? */
export function isPublic(ctx: Ctx, id: number): boolean {
  if (id === TERRITORY.id || ctx.gById.has(id) || ctx.govOfFirm.has(id)) return true;
  const f = ctx.fById.get(id);
  return !!f && f.gov !== undefined;
}

/**
 * How many people live in the city itself (not out in the countryside):
 * what the city's size means for zoning, building heights, chains, exports.
 * Counted once per game minute.
 */
const popCache = new WeakMap<object, { t: number; n: number; v: number }>();
export function cityPop(ctx: Ctx): number {
  const s = ctx.s;
  const c = popCache.get(s);
  if (c && c.t === s.tick && c.n === s.people.length) return c.v;
  let v = 0;
  for (const p of s.people) {
    const h = ctx.bById.get(p.home);
    if (!h || inGrid(s.world, h.x, h.y)) v++;
  }
  popCache.set(s, { t: s.tick, n: s.people.length, v });
  return v;
}
