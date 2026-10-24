import { STATS } from './config';
import type { Ctx } from './ctx';
import { BUILDINGS, materialsFor } from './goods';
import { averageRent } from './housing';
import { refPrice } from './market';
import { debtOf } from './finance';
import { assessLot } from './government';
import { GOODS, type Building, type Firm, type Good, type Lot, type Person, type StatPoint } from './types';

/** A building at market value: what went into it, its stock, and the land under it. */
function buildingValue(ctx: Ctx, b: Building): number {
  if (b.ruined) return 0;
  const mats = materialsFor(b.kind, b.floors);
  let v = 0;
  for (const g of GOODS) {
    v += (b.built ? mats[g] * b.condition : mats[g] - b.needed[g]) * refPrice(ctx, g);
    v += b.store[g] * refPrice(ctx, g);
  }
  const lot = ctx.lotById.get(b.lot);
  return v * 1.6 + b.cash + (lot ? assessLot(ctx, lot) : 0);
}

export function firmValue(ctx: Ctx, f: Firm): number {
  if (f.closed) return 0;
  let v = f.cash - debtOf(ctx, f.id);
  for (const id of f.sites) {
    const b = ctx.bById.get(id);
    if (b) v += buildingValue(ctx, b);
  }
  for (const o of ctx.s.market.orders) {
    if (o.who !== f.id) continue;
    v += o.side === 'bid' ? o.qty * o.price : o.qty * refPrice(ctx, o.good) * 0.8;
  }
  return v;
}

/** Net worth at current market prices: cash, goods, buildings, land, companies, minus debts. */
export function wealthOf(ctx: Ctx, p: Person): number {
  let w = p.money - debtOf(ctx, p.id);
  for (const l of emptyLotsOf(ctx).get(p.id) ?? []) w += assessLot(ctx, l);
  for (const g of GOODS) w += (p.inv[g] + p.pantry[g]) * refPrice(ctx, g);
  for (const id of p.owned) {
    const b = ctx.bById.get(id);
    if (b) w += buildingValue(ctx, b);
  }
  for (const id of p.firms) {
    const f = ctx.fById.get(id);
    if (f) w += firmValue(ctx, f);
  }
  const car = ctx.vById.get(p.car);
  if (car) w += refPrice(ctx, 'cars') * 0.7;

  for (const o of ctx.s.market.orders) {
    if (o.who !== p.id) continue;
    w += o.side === 'bid' ? o.qty * o.price : o.qty * refPrice(ctx, o.good);
  }
  return w;
}

/** Empty lots by owner (cached for the current tick). */
const lotCache = new WeakMap<object, { t: number; map: Map<number, Lot[]> }>();
function emptyLotsOf(ctx: Ctx): Map<number, Lot[]> {
  const c = lotCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.map;
  const map = new Map<number, Lot[]>();
  for (const l of ctx.s.roads.lots) if (l.building < 0) { const a = map.get(l.owner); if (a) a.push(l); else map.set(l.owner, [l]); }
  lotCache.set(ctx.s, { t: ctx.s.tick, map });
  return map;
}

export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  let sum = 0, weighted = 0;
  for (let i = 0; i < n; i++) { sum += v[i]; weighted += (i + 1) * v[i]; }
  return sum <= 0 ? 0 : (2 * weighted) / (n * sum) - (n + 1) / n;
}

/** All money in existence. */
export function moneySupply(ctx: Ctx): number {
  let m = 0;
  for (const p of ctx.s.people) m += p.money;
  for (const f of ctx.s.firms) m += f.cash;
  for (const b of ctx.s.buildings) m += b.cash;
  for (const o of ctx.s.market.orders) if (o.side === 'bid') m += o.qty * o.price;
  return m;
}

export function sampleStats(ctx: Ctx): void {
  const s = ctx.s;
  const prices: Partial<Record<Good, number>> = {};
  for (const g of GOODS) {
    const d = s.market.day[g];
    prices[g] = d.q > 0 ? d.v / d.q : s.market.last[g];
  }
  const live = s.buildings.filter((b) => b.built && !b.ruined);
  const wages = s.contracts.map((c) => c.wage);
  const pt: StatPoint = {
    t: s.tick,
    pop: s.people.length,
    money: moneySupply(ctx),
    employed: s.contracts.length,
    firms: s.firms.filter((f) => !f.closed).length,
    homes: s.people.filter((p) => p.home >= 0).length,
    renters: s.people.filter((p) => { const k = ctx.bById.get(p.home)?.kind; return k === 'apartments' || k === 'tower'; }).length,
    cars: s.vehicles.filter((v) => v.kind === 'car').length,
    buildings: live.filter((b) => BUILDINGS[b.kind].category !== 'civic').length,
    // inequality is costly to measure: once every few samples
    gini: s.stats.length % 6 === 0 || !s.stats.length ? gini(s.people.map((p) => wealthOf(ctx, p))) : s.stats[s.stats.length - 1].gini,
    avgFood: s.people.length ? s.people.reduce((a, p) => a + p.needs.food, 0) / s.people.length : 0,
    avgWage: wages.length ? wages.reduce((a, b) => a + b, 0) / wages.length : 0,
    avgRent: averageRent(ctx),
    prices,
    jobless: s.people.length ? s.people.filter((p) => p.job < 0 && !p.firms.length).length / s.people.length : 0,
    legit: s.polities.find((g) => g.status !== 'gone')?.legitimacy,
  };
  s.stats.push(pt);
  if (s.stats.length > STATS.maxPoints) {
    const cut = Math.floor(s.stats.length * 0.66);
    s.stats = s.stats.slice(0, cut).filter((_, i) => i % 2 === 0).concat(s.stats.slice(cut));
  }
}
