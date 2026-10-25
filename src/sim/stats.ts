import { STATS } from './config';
import type { Ctx } from './ctx';
import { BUILDINGS, materialsFor } from './goods';
import { averageRent } from './housing';
import { refPrice } from './market';
import { debtOf } from './finance';
import { assessLot, mainPolity, treasury } from './government';
import { dayOf } from './ctx';
import { RENTALS } from './housing';
import { isOnline } from './online';
import { compass } from './ideology';
import { poll } from './elections';
import { lotsForSale } from './roads';
import { GOODS, type Building, type BuildingKind, type DailyStat, type Firm, type Good, type Lot, type MarketDay, type Person, type Sector, type StatPoint, type Zone } from './types';

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

// ------------------------------------------------------------ daily record
//
// Once a game day (at midnight) the city is summed up into a DailyStat for the
// statistics window: people, money and wealth, jobs and companies by sector,
// every market, housing and land, the government's books, the Net and media.
// What happens during the day (spending by kind, imports, exports…) is tallied
// as it happens (`tally`) and saved with the snapshot.

/** Which sector a kind of business belongs to. */
const SECTOR_KINDS: Record<Sector, BuildingKind[]> = {
  retail: ['store', 'restaurant', 'dealer'],
  manufacturing: ['sawmill', 'brickworks', 'steelmill', 'cementworks', 'glassworks', 'foodplant', 'workshop', 'furniture', 'textile', 'electronics', 'carplant'],
  office: ['office', 'bank', 'apartments', 'tower', 'officetower'],
  tech: ['netco', 'studio', 'adco'],
  construction: ['yard'],
  logistics: ['depot'],
  raw: ['farm', 'lumberyard', 'quarry', 'claypit', 'mine'],
  public: ['cityhall', 'plaza', 'park'],
};
const SECTOR_BY_KIND = new Map<BuildingKind, Sector>();
for (const [s, kinds] of Object.entries(SECTOR_KINDS)) for (const k of kinds) SECTOR_BY_KIND.set(k, s as Sector);
export const SECTORS = Object.keys(SECTOR_KINDS) as Sector[];

export function sectorOf(ctx: Ctx, f: Firm): Sector {
  if (ctx.govOfFirm.has(f.id) || f.gov !== undefined) return 'public';
  return SECTOR_BY_KIND.get(f.kind) ?? 'office';
}

/** Add to today's running totals (spending by kind, imports, exports, office work billed…). */
export function tally(ctx: Ctx, key: string, amount: number): void {
  const t = (ctx.s.today ??= {});
  t[key] = (t[key] ?? 0) + amount;
}

const pct = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const COUNTED = ['arrivals', 'emigrated', 'deaths', 'orders', 'gigs', 'rides', 'hires', 'layoffs', 'quits', 'trades', 'dayLabor'] as const;

/** The end of a day: sum the city up. (Call before the markets start their new day.) */
export function recordDaily(ctx: Ctx): void {
  const s = ctx.s;
  const prev = s.daily?.[s.daily.length - 1];
  const flows: Record<string, number> = { ...(s.today ?? {}) };
  const counters = s.counters as unknown as Record<string, number | undefined>;
  for (const k of COUNTED) {
    const now = counters[k] ?? 0;
    flows['c:' + k] = now;
    // (the first day recorded has nothing to compare with: left out rather than shown as zero)
    flows[k] = prev ? Math.max(0, now - (prev.flows['c:' + k] ?? now)) : NaN;
  }
  // people
  let employed = 0, owners = 0, jobless = 0, homeless = 0, renters = 0, homeowners = 0, trailers = 0, online = 0, mood = 0, happy = 0;
  const needs = { food: 0, energy: 0, social: 0, fun: 0, health: 0 };
  for (const p of s.people) {
    if (p.job >= 0) employed++; else if (p.firms.length) owners++; else jobless++;
    const home = ctx.bById.get(p.home);
    if (!home) homeless++;
    else if (RENTALS.has(home.kind)) renters++;
    else if (home.kind === 'trailer') trailers++;
    else if (home.owner === p.id) homeowners++;
    if (isOnline(p)) online++;
    mood += p.mood; happy += p.happy;
    for (const k of Object.keys(needs) as (keyof typeof needs)[]) needs[k] += p.needs[k];
  }
  const n = Math.max(1, s.people.length);
  for (const k of Object.keys(needs) as (keyof typeof needs)[]) needs[k] /= n;
  // wages and wealth
  const wages = s.contracts.map((c) => c.wage).sort((a, b) => a - b);
  const wealth = s.people.map((p) => wealthOf(ctx, p)).sort((a, b) => a - b);
  const totalWealth = wealth.reduce((a, w) => a + Math.max(0, w), 0);
  const top = wealth.slice(Math.floor(wealth.length * 0.9)).reduce((a, w) => a + Math.max(0, w), 0);
  const wealthBins = [0, 0, 0, 0, 0, 0];
  for (const w of wealth) wealthBins[w < 10 ? 0 : w < 100 ? 1 : w < 1000 ? 2 : w < 10000 ? 3 : w < 100000 ? 4 : 5]++;
  // jobs, companies and sales by sector
  const jobs: Partial<Record<Sector, number>> = {}, firms: Partial<Record<Sector, number>> = {}, revenue: Partial<Record<Sector, number>> = {};
  const sectorOfFirm = new Map<number, Sector>();
  let profitable = 0, firmCash = 0;
  for (const f of s.firms) {
    if (f.closed) continue;
    const sec = sectorOf(ctx, f);
    sectorOfFirm.set(f.id, sec);
    firms[sec] = (firms[sec] ?? 0) + 1;
    revenue[sec] = (revenue[sec] ?? 0) + (f.lastRevenue ?? 0);
    if ((f.ledger.days[f.ledger.days.length - 1] ?? 0) > 0) profitable++;
    if (!ctx.govOfFirm.has(f.id)) firmCash += f.cash;
  }
  for (const c of s.contracts) { const sec = sectorOfFirm.get(c.firm) ?? 'public'; jobs[sec] = (jobs[sec] ?? 0) + 1; }
  // markets
  const markets: Partial<Record<Good, MarketDay>> = {};
  const retailFirms = s.firms.filter((f) => !f.closed && (f.kind === 'store' || f.kind === 'dealer'));
  for (const g of GOODS) {
    const d = s.market.day[g];
    let bids = 0, asks = 0;
    for (const o of s.market.orders) if (o.good === g) { if (o.side === 'bid') bids += o.qty; else asks += o.qty; }
    const shelf = retailFirms.map((f) => f.prices[g]).filter((x): x is number => !!x && x > 0);
    let makers = 0;
    for (const b of s.buildings) if (b.built && !b.ruined && b.firm >= 0 && BUILDINGS[b.kind].output === g) makers++;
    markets[g] = {
      price: d.q > 0 ? d.v / d.q : s.market.last[g],
      q: d.q,
      imp: flows['imp:' + g] ?? 0,
      exp: flows['exp:' + g] ?? 0,
      retail: shelf.length ? shelf.reduce((a, x) => a + x, 0) / shelf.length : undefined,
      bids, asks, makers,
    };
  }
  // housing and land
  let units = 0, vacantUnits = 0, suites = 0, vacantSuites = 0, shops = 0, vacantShops = 0, building = 0, towers = 0, tallest = 0;
  for (const b of s.buildings) {
    if (b.ruined) continue;
    if (!b.built) { if (b.host === undefined) building++; continue; }
    if (RENTALS.has(b.kind)) { units += b.units.length; vacantUnits += b.units.filter((u) => u.tenant < 0).length; }
    if (b.host !== undefined) {
      if (b.level) { suites++; if (b.firm < 0) vacantSuites++; } else { shops++; if (b.firm < 0) vacantShops++; }
    }
    if (b.kind === 'tower' || b.kind === 'officetower') towers++;
    if (b.host === undefined) tallest = Math.max(tallest, b.floors);
  }
  const land: Partial<Record<Zone, number>> = {};
  for (const z of ['core', 'urban', 'suburb', 'industrial'] as Zone[]) {
    const lots = lotsForSale(ctx, [z]).slice(0, 40);
    if (lots.length) land[z] = lots.reduce((a, l) => a + l.forSale / Math.max(1, l.w * l.d), 0) / lots.length;
  }
  const rent = averageRent(ctx);
  // a typical day's basket: food, a little of the things people buy, and a day's rent
  const shelfOr = (g: Good) => markets[g]?.retail ?? refPrice(ctx, g) * 1.45;
  const cpi = 0.6 * shelfOr('groceries') + 0.4 * shelfOr('bread') + 0.4 * shelfOr('produce') + 0.3 * shelfOr('dairy') + 0.3 * shelfOr('meat')
    + 0.05 * shelfOr('clothes') + 0.02 * shelfOr('furniture') + 0.01 * shelfOr('computers') + rent;
  // government: what was booked during the day
  const g = mainPolity(ctx);
  const today = dayOf(s.tick);
  const income: Record<string, number> = {}, spend: Record<string, number> = {};
  for (const [k, v] of Object.entries(flows)) {
    if (k.startsWith('gin:')) income[k.slice(4)] = v;
    else if (k.startsWith('gsp:')) spend[k.slice(4)] = v;
  }
  // the Net and media
  const adSpend = { street: 0, net: 0, tv: 0, influencer: 0 };
  let siteUsers = 0, tvViewers = 0;
  for (const f of s.firms) {
    if (f.closed) continue;
    for (const k of Object.keys(adSpend) as (keyof typeof adSpend)[]) adSpend[k] += f.adSpend?.[k] ?? 0;
    siteUsers += f.site?.users ?? 0;
    tvViewers += f.channel?.viewers ?? 0;
  }
  // politics
  let econ = 0, auth = 0, engagement = 0, grievance = 0, protesting = 0;
  for (const p of s.people) { const c = compass(p); econ += c.econ; auth += c.auth; engagement += p.pol.engagement; grievance += p.pol.grievance; if (p.pol.protesting >= 0) protesting++; }
  const parties: Record<string, number> = {};
  for (const pt of s.parties) if (pt.members.length) parties[pt.name] = (parties[pt.name] ?? 0) + pt.members.length;
  // profits by sector, and who holds the wealth
  const profit: Partial<Record<Sector, number>> = {};
  for (const f of s.firms) if (!f.closed) { const sec = sectorOfFirm.get(f.id) ?? 'office'; profit[sec] = (profit[sec] ?? 0) + (f.ledger.days[f.ledger.days.length - 1] ?? 0); }
  const share = (from: number, to: number) => (totalWealth > 0 ? wealth.slice(Math.floor(from * wealth.length), Math.floor(to * wealth.length)).reduce((a, w) => a + Math.max(0, w), 0) / totalWealth : 0);
  // the main government's coming election: where the race for its top office stands
  let polls: DailyStat['polls'];
  // (the main government's race; if it isn't voting soon, the soonest race elsewhere)
  const races = s.elections.filter((e) => (e.status === 'campaign' || e.status === 'voting') && e.kind !== 'referendum').sort((a, b) => (a.polity === g?.id ? -1 : b.polity === g?.id ? 1 : a.day - b.day));
  const race = races[0];
  const rg = race ? ctx.gById.get(race.polity) : undefined;
  if (race && rg) {
    const top = race.offices.map((id) => rg.offices.find((o) => o.id === id)).find((o) => o?.kind === 'exec') ?? rg.offices.find((o) => o.id === race.offices[0]);
    if (top) {
      const shares: Record<string, number> = {};
      for (const r of poll(ctx, race, top.id, 150)) shares[ctx.byId.get(r.person)?.name ?? `#${r.person}`] = r.share;
      polls = { election: race.id, office: `${top.title}, ${rg.short}`, shares };
    }
  }
  const rec: DailyStat = {
    day: today - 1, t: s.tick, // the day that just ended
    pop: s.people.length,
    arrivals: flows.arrivals, left: flows.emigrated, deaths: flows.deaths,
    employed, owners, jobless, homeless, renters, homeowners, trailers, online,
    cars: s.vehicles.filter((v) => v.kind === 'car').length,
    mood: mood / n, happy: happy / n, needs,
    wage: { p10: pct(wages, 0.1), median: pct(wages, 0.5), mean: wages.length ? wages.reduce((a, w) => a + w, 0) / wages.length : 0, p90: pct(wages, 0.9) },
    wealthGini: gini(wealth), top10: totalWealth > 0 ? top / totalWealth : 0, wealthBins,
    money: moneySupply(ctx), cpi,
    flows, jobs, firms, revenue, profitable, firmCash,
    markets,
    units, vacantUnits, rent, suites, vacantSuites, shops, vacantShops, building, towers, tallest, land,
    treasury: g ? treasury(ctx, g) : 0,
    legit: g?.legitimacy ?? 0,
    income: { ...income }, spend: { ...spend },
    adSpend, siteUsers, tvViewers,
    compass: { econ: econ / n, auth: auth / n }, engagement: engagement / n, grievance: grievance / n, protesting, parties,
    profit,
    wealthShares: { bottom50: share(0, 0.5), middle40: share(0.5, 0.9), top10: share(0.9, 1), top1: share(0.99, 1) },
    ...(polls ? { polls } : {}),
  };
  // (two decimals is plenty, and keeps a long game's save small)
  (s.daily ??= []).push(JSON.parse(JSON.stringify(rec, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))) as DailyStat);
  // a long game: keep every day of the last ~1,000, and every other day before that
  if (s.daily.length > 1500) {
    const cut = s.daily.length - 1000;
    s.daily = s.daily.slice(0, cut).filter((_, i) => i % 2 === 0).concat(s.daily.slice(cut));
  }
  s.today = {};
}
