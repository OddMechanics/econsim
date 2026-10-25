import { MINUTES_PER_DAY, OUTSIDE, POLITICS, POPULATION, STATS, WAGES } from './config';
import { dayOf, hourOf, log, makeCtx, minuteOfDay, type Ctx } from './ctx';
import { decide, reviewJob } from './ai';
import { createBuilding, decayBuildings } from './buildings';
import { onFinished, sellHooks } from './hooks';
import { slotsFor } from './goods';
import { chainsDaily, firmDaily, firmHourly, foundFirm, openBranch } from './firms';
import { endContract, hire, jobsDaily, postJob, processApplications } from './jobs';
import { housingDaily, moveIn, moveOut } from './housing';
import { marketHourly, marketNewDay, outsideTrade, spoilFood } from './market';
import { causeOfDeath, createPerson, personDaily, setBrainSource, spawnNewcomer, updateNeeds } from './people';
import { ensurePlaces, placesDaily } from './places';
import { recordDaily } from './stats';
import { initRoads, makeAllLots, rezone } from './roads';
import { seedRng } from './rng';
import { scenariosDaily } from './scenarios';
import { converse, pruneRelations } from './social';
import { sampleStats, wealthOf } from './stats';
import { clock, leaveSeat, runStep, steadyStep } from './tasks';
import { carDelivered, createVehicle, dispatchOutside, outsideCouriers, outsideTrafficMinute, removeVehicle } from './logistics';
import { carHooks } from './market';
import { bankingDaily, loansDaily } from './finance';
import { inheritBrain, learn, newBrain } from './brain';
import { cityName } from './names';
import { buildCityHall, cellOf, foundPolity, governmentsDaily, isAdmin, landOfficeDaily, layOutStreets, mainPolity, polityAt, territoryDaily } from './government';
import { contactsDaily } from './contacts';
import { leasesDaily } from './leases';
import { developmentDaily } from './development';
import { appsDaily, crowdDaily } from './online';
import { councilDaily, councilHourly } from './council';
import { campaignDaily, electionsDaily, electionsHourly, instantElection, partiesDaily } from './elections';
import { foundingCharter, protestsHourly, regimeDaily } from './regime';
import { campaignEventsDaily, debatesHourly } from './civic';
import { firmPost, mediaDaily, tvHourly } from './media';
import { adExposureHourly, adsDaily, campaignAds } from './advertising';
import { auctionsHourly, insolvencyDaily, settleEstate } from './estate';
import { cancelHooks, contractorsDaily } from './construction';
import { crimeDaily, maybeSteal } from './crime';
import { removeBuilding } from './buildings';
import { politicsDaily, talkInfluence } from './ideology';
import { relation } from './social';
import { GOODS, type Building, type Good, type Lot, type Person, type SimState } from './types';
import { generateWorld, mapSize, regrowWorld } from './world';

carHooks.onBought = carDelivered;
cancelHooks.cancel = (ctx, b) => {
  const f = ctx.fById.get(b.firm);
  const lot = ctx.lotById.get(b.lot);
  removeBuilding(ctx, b);
  if (lot) lot.forSale = 0; // the owner decides later (the land office or private sale reprices it)
  // a company founded only for this project winds down
  if (f && !f.sites.length) { f.closed = true; const owner = ctx.byId.get(f.owner); if (owner) { owner.money += Math.max(0, f.cash); owner.firms = owner.firms.filter((id) => id !== f.id); } f.cash = 0; }
};
setBrainSource(inheritBrain);

/** Shipping depots come with a truck per driver (construction yards with one). */
onFinished.push((ctx, b) => {
  if (b.kind !== 'depot' && b.kind !== 'yard') return;
  const f = ctx.fById.get(b.firm);
  if (!f) return;
  const n = b.kind === 'depot' ? slotsFor('depot', b.floors).reduce((s2, j) => s2 + j.slots, 0) : 1;
  for (let i = 0; i < n; i++) createVehicle(ctx, 'truck', f.id, b, f.hue);
});

/**
 * A new world. Before anyone arrives there is land and a regional highway
 * to the rest of the (modern) world. Fifty settlers come as an organized
 * group with their trailers and savings and hold a founding assembly: they
 * vote on a charter (from what they each believe), claim city limits around
 * the crossroads, survey the first streets as dirt tracks, give each settler
 * a lot, and elect their first officials. A regional construction company
 * opens a branch to build the new city (its first job: city hall), and the
 * best-off settler opens a bank. Everything else they buy online from
 * outside until someone opens a shop.
 */
export function createState(seed: number): SimState {
  const zero = () => Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;
  const s: SimState = {
    version: 4, seed, rng: seedRng(seed), tick: 7 * 60, nextId: 1,
    world: generateWorld(seed),
    roads: { nodes: [], edges: [], lots: [], plan: [], ver: 0 },
    people: [], dead: [], buildings: [], firms: [], contracts: [], postings: [], vehicles: [], shipments: [], loans: [], ads: [],
    polities: [], parties: [], elections: [], events: [], broadcasts: [], auctions: [], landDemand: {}, taxArrears: {}, crowdfunds: [],
    market: { orders: [], last: zero(), day: Object.fromEntries(GOODS.map((g) => [g, { q: 0, v: 0 }])) as SimState['market']['day'], trades: [] },
    conversations: [], posts: [], stats: [], log: [], scenarios: [],
    counters: { arrivals: 0, deaths: 0, trades: 0, hires: 0, layoffs: 0, quits: 0 },
    center: { x: 0, y: 0 }, gates: [],
  };
  const ctx = makeCtx(s);
  const size = mapSize(s.world);
  const cx = size / 2, cy = size / 2;
  s.center = { x: cx, y: cy };
  initRoads(ctx, cx, cy);
  // where the highway leaves the map: outside trucks come and go there
  for (const n of s.roads.nodes) {
    if (n.edges.length !== 1) continue;
    const e = ctx.edgeById.get(n.edges[0]);
    if (e?.name === 'Route 9') s.gates.push({ x: n.x, y: n.y });
  }
  if (!s.gates.length) s.gates.push({ x: cx, y: 40 });

  // the settlers arrive along the highway
  const [lo, hi] = POPULATION.startMoney;
  const settlers: Person[] = [];
  for (let i = 0; i < POPULATION.start; i++) {
    const money = Math.round(lo + (hi - lo) * Math.pow(ctx.rng.next(), 3));
    const p = createPerson(ctx, cx + ctx.rng.range(-25, 25), cy + ctx.rng.range(-8, 8), money, POPULATION.startFood);
    p.brain = newBrain(ctx);
    settlers.push(p);
  }

  // the founding assembly: a charter from the median founder's views on each question
  const founding = foundingCharter(ctx, settlers);
  const name = cityName(ctx.rng);
  const g = foundPolity(ctx, { name: `City of ${name}`, short: name, cx, cy, radius: POLITICS.founding.limitsRadius, charter: founding.charter, policy: founding.policy });
  makeAllLots(ctx);
  for (const p of settlers) p.pol.rec[g.id] = 0.7 + 0.1 * Math.max(0, p.pol.auth);
  // the Territory grants the new city a founding fund (for a city hall and the first works)
  ctx.fById.get(g.firm)!.cash += 4000;

  // the first plat: streets laid out around the crossroads (dirt for now)
  layOutStreets(ctx, g, 'core', 5);
  layOutStreets(ctx, g, 'urban', 4);
  for (let k = 0; k < 3; k++) layOutStreets(ctx, g, 'suburb', 4);
  layOutStreets(ctx, g, 'industrial', 2);
  layOutStreets(ctx, g, 'rural', 3);
  outsideTrade(ctx);

  // each settler is granted a lot in the suburbs (or out of town) and sets their trailer on it
  for (const p of settlers) {
    let lot: Lot | undefined;
    for (let tries = 0; tries < 4 && !lot; tries++) {
      lot = nearestLot(ctx, cx, cy, (l) => (l.zone === 'suburb' || l.zone === 'rural') && l.building < 0 && l.owner === g.firm)
        ?? nearestLot(ctx, cx, cy, (l) => l.zone !== 'core' && l.zone !== 'industrial' && l.building < 0 && l.owner === g.firm);
      if (!lot) layOutStreets(ctx, g, 'suburb', 4);
    }
    if (!lot) continue;
    lot.owner = p.id;
    lot.forSale = 0;
    const home = createBuilding(ctx, 'trailer', lot, p.id, 1, true);
    home.condition = ctx.rng.range(0.6, 0.95);
    moveIn(ctx, p, home, 0);
    p.x = p.px = home.x;
    p.y = p.py = home.y;
    p.inside = home.id;
  }
  s.log = [];
  log(ctx, 'event', `${POPULATION.start} settlers came up Route 9 with their trailers and savings. At the crossroads they held a founding assembly and founded the ${g.name}.`);
  log(ctx, 'law', `The founding charter: ${founding.votes.join('; ')}. System: ${g.label}.`);
  g.laws.push({ t: s.tick, title: 'Founding Charter', kind: 'amend', by: -1, yes: settlers.length, no: 0, abstain: 0, passed: true, how: 'founding assembly' });
  log(ctx, 'politics', `The city limits were drawn ${POLITICS.founding.limitsRadius} m around the crossroads; the first streets were staked out, and each settler was granted a lot.`);
  // the assembly elects the first officials
  instantElection(ctx, g, settlers, g.offices.filter((o) => o.kind === 'exec' || o.kind === 'council').map((o) => o.id));

  // a regional construction company opens a branch to build the new city, with one of the settlers as its manager
  const yardLot = nearestLot(ctx, cx, cy, (l) => (l.zone === 'industrial' || l.zone === 'urban') && l.w >= 18 && l.owner === g.firm)
    ?? nearestLot(ctx, cx, cy, (l) => l.w >= 18 && l.owner === g.firm);
  const richest = settlers.reduce((a, b) => (b.money > a.money ? b : a), settlers[0]);
  const managerPick = settlers.filter((p) => p.edu >= 12 && p !== richest).sort((a, b) => b.traits.diligence + b.traits.communication - a.traits.diligence - a.traits.communication)[0] ?? settlers[0];
  if (yardLot && managerPick) {
    yardLot.forSale = 0;
    const branch = openBranch(ctx, 'yard', 'Valley Regional Construction', yardLot, managerPick, 900);
    const yard = ctx.bById.get(branch.sites[0])!;
    createVehicle(ctx, 'truck', branch.id, yard, branch.hue);
    const wage = Math.round(WAGES.reference * 2);
    const post = postJob(ctx, branch, yard.id, 'manager', wage);
    hire(ctx, post, managerPick);
    log(ctx, 'business', `Valley Regional Construction opened a branch in ${name}, run by ${managerPick.name}. It's hiring builders.`, { firm: branch.id, bid: yard.id });
  }
  // a convenience-store chain opens a branch (groceries and basics from its warehouses outside)
  const shopLot = nearestLot(ctx, cx, cy, (l) => (l.zone === 'urban' || l.zone === 'core') && l.w >= 14 && l.building < 0 && l.owner === g.firm);
  const clerk = settlers.filter((p) => p.job < 0 && p !== richest).sort((a, b) => b.traits.diligence - a.traits.diligence)[0];
  if (shopLot && clerk) {
    shopLot.forSale = 0;
    const chain = openBranch(ctx, 'store', 'QuickStop', shopLot, clerk, 500);
    const shop = ctx.bById.get(chain.sites[0])!;
    // it opens with its shelves stocked
    Object.assign(shop.store, { groceries: 140, clothes: 12, furniture: 4, tools: 6, computers: 6 });
    for (const good of ['groceries', 'clothes', 'furniture', 'tools', 'computers'] as Good[]) chain.prices[good] = OUTSIDE.prices[good] * OUTSIDE.importMarkup * 1.35;
    hire(ctx, postJob(ctx, chain, shop.id, 'cashier', Math.round(WAGES.reference * 0.9)), clerk);
    log(ctx, 'business', `QuickStop, a convenience-store chain, opened a branch in ${name}.`, { firm: chain.id, bid: shop.id });
  }
  // the best-off settler opens the city's first bank
  if (richest) {
    richest.money += 800;
    const lot = nearestLot(ctx, cx, cy, (l) => l.zone === 'core' && l.building < 0 && l.forSale > 0 && l.w >= 14);
    if (lot) foundFirm(ctx, richest, 'bank', lot, 820 + lot.forSale, 1);
  }
  // the city's first project: a city hall (meetings and votes are held on the site until it's done)
  buildCityHall(ctx, g);
  return s;
}

function nearestLot(ctx: Ctx, x: number, y: number, ok: (l: Lot) => boolean): Lot | undefined {
  let best: Lot | undefined, bd = Infinity;
  for (const l of ctx.s.roads.lots) {
    if (l.building >= 0 || !ok(l)) continue;
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}


/**
 * Runtime-only bookkeeping on a person (symbol keys, so saves leave them out):
 * when they were last updated, and when a steady activity next needs them.
 */
const WAKE = Symbol('wake');
const LAST = Symbol('last');
type Runtime = Person & { [WAKE]?: number; [LAST]?: number };

/** Advances the world one game minute at a time. Pure logic, no rendering. */
export class Simulation {
  ctx: Ctx;

  /**
   * People doing something steady (asleep, relaxing, at a desk or machine)
   * are updated every this many minutes. 5 with the 3D view on; the app
   * raises it while nothing is drawn, which is much faster.
   */
  stride = 5;
  constructor(public state: SimState) {
    this.ctx = makeCtx(state);
  }

  get tick(): number {
    return this.state.tick;
  }

  step(): void {
    const ctx = this.ctx;
    const s = ctx.s;
    const mod = minuteOfDay(s.tick);
    for (const v of s.vehicles) { v.px = v.x; v.py = v.y; }
    const stride = this.stride;
    const dying: Person[] = [];
    for (const p of s.people) {
      // steady activities (asleep, relaxing, at the desk or machine) are updated every few minutes in one go:
      // after an update, someone doing something steady sleeps until their next turn
      const r = p as Runtime;
      if (r[WAKE] !== undefined && r[WAKE] > s.tick) continue;
      const dt = Math.max(1, Math.min(stride * 2, s.tick - (r[LAST] ?? s.tick - 1)));
      r[LAST] = s.tick;
      p.px = p.x;
      p.py = p.y;
      if (p.task && p.needs.food < 12 && p.inv.groceries < 1 && s.tick - p.task.started > 90 && p.driving < 0) p.task = null;
      if (!p.task) {
        if (p.brainMem) learn(ctx, p);
        decide(ctx, p);
      }
      clock.dt = dt;
      const working = runStep(ctx, p);
      updateNeeds(ctx, p, working, dt);
      clock.dt = 1;
      if (p.saying && s.tick > p.sayingUntil) p.saying = '';
      if (p.needs.health <= 0) dying.push(p);
      r[WAKE] = steadyStep(ctx, p) ? s.tick + stride - ((s.tick + p.id) % stride) : undefined;
    }
    outsideTrafficMinute(ctx);
    if (mod % 10 === 0) this.conversations();
    for (const p of dying) if (p.needs.health <= 0) this.kill(p, causeOfDeath(p));

    if (mod % 60 === 0) {
      // the places people know: each person's daily look round, spread over the day
      const hour = mod / 60;
      for (const p of s.people) if (p.id % 24 === hour) { if (p.places) placesDaily(ctx, p); else ensurePlaces(ctx, p); }
      marketHourly(ctx);
      outsideCouriers(ctx);
      dispatchOutside(ctx);
      processApplications(ctx);
      for (const f of s.firms) if (!isAdmin(ctx, f)) firmHourly(ctx, f);
      auctionsHourly(ctx);
      this.lastResort();
      electionsHourly(ctx);
      councilHourly(ctx);
      protestsHourly(ctx);
      debatesHourly(ctx);
      tvHourly(ctx);
      adExposureHourly(ctx);
    }
    if (mod % STATS.sampleEveryMinutes === 0) sampleStats(ctx);
    if (mod === 0) this.daily();
    if (mod === 5 * 60) {
      outsideTrade(ctx);
      for (const f of s.firms) if (!isAdmin(ctx, f)) firmDaily(ctx, f);
      s.firms = s.firms.filter((f) => !f.closed || s.tick - f.founded < 30 * MINUTES_PER_DAY || ctx.govOfFirm.has(f.id));
      for (const p of s.people) reviewJob(ctx, p);
    }
    if (mod === 12 * 60 || mod === 19 * 60) this.online();
    if (mod === 9 * 60) this.arrivals();
    s.tick++;
  }

  private daily(): void {
    const ctx = this.ctx;
    const s = ctx.s;
    // counters at the start of the day (so "today" can be shown)
    s.data = { ...(s.data ?? {}), ordersDay0: s.counters.orders ?? 0, gigsDay0: s.counters.gigs ?? 0, ridesDay0: s.counters.rides ?? 0, importsDay0: s.counters.imports ?? 0, exportsDay0: s.counters.exports ?? 0 };
    // the day just ended, for the statistics window (before the markets start their new day)
    recordDaily(ctx);
    regrowWorld(s.world);
    decayBuildings(ctx, (b) => this.onRuin(b));
    marketNewDay(ctx);
    spoilFood(ctx);
    scenariosDaily(ctx);
    for (const p of s.people) { personDaily(ctx, p); pruneRelations(p); politicsDaily(ctx, p); }
    housingDaily(ctx);
    jobsDaily(ctx);
    this.emigration();
    loansDaily(ctx);
    bankingDaily(ctx);
    insolvencyDaily(ctx);
    contractorsDaily(ctx);
    rezone(ctx);
    landOfficeDaily(ctx);
    territoryDaily(ctx);
    governmentsDaily(ctx);
    partiesDaily(ctx);
    electionsDaily(ctx);
    campaignDaily(ctx);
    campaignEventsDaily(ctx);
    for (const e of s.elections) if (e.status === 'campaign') campaignAds(ctx, e);
    councilDaily(ctx);
    regimeDaily(ctx);
    crimeDaily(ctx);
    adsDaily(ctx);
    mediaDaily(ctx);
    contactsDaily(ctx);
    chainsDaily(ctx);
    leasesDaily(ctx);
    developmentDaily(ctx);
    crowdDaily(ctx);
    appsDaily(ctx);
  }

  /** People sitting near each other talk now and then (and talk politics, if they care). */
  private conversations(): void {
    const ctx = this.ctx;
    const groups = new Map<number, Person[]>();
    for (const p of ctx.s.people) {
      const st = p.task?.steps[p.task.i];
      if (!st || p.inside < 0) continue;
      const social = st.k === 'chat' || (st.k === 'eatOut' && ctx.rng.chance(0.5)) || (st.k === 'attend' && ctx.rng.chance(0.15));
      if (!social) continue;
      if (!groups.has(p.inside)) groups.set(p.inside, []);
      groups.get(p.inside)!.push(p);
    }
    for (const [where, list] of groups) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.rng.next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      for (let i = 0; i + 1 < list.length; i += 2) {
        const a = list[i], b = list[i + 1];
        converse(ctx, a, b, 10 / 60, where);
        if (a.pol.engagement + b.pol.engagement > 0.7) talkInfluence(a, b, relation(a, b).trust, relation(b, a).trust);
      }
    }
  }

  private online(): void {
    const ctx = this.ctx;
    for (const f of ctx.s.firms) if (!f.closed && f.website && ctx.rng.chance(0.12)) firmPost(ctx, f);
    for (const f of ctx.s.firms) if (!f.website && ((ctx.byId.get(f.owner)?.durables.computers ?? 0) > 0 || f.site)) f.website = true;
  }

  /** Newcomers come more often when there are jobs to fill and places to live (and the city lets them). */
  private arrivals(): void {
    const ctx = this.ctx;
    const s = ctx.s;
    if (s.people.length >= POPULATION.cap) return;
    const g = mainPolity(ctx);
    const policy = g?.policy.immigration ?? 'open';
    if (policy === 'closed') return;
    const fed = s.people.length ? s.people.filter((p) => p.needs.food > 40).length / s.people.length : 1;
    // word gets around: people move for jobs (open positions pull them in), and a city where many are out of work puts them off
    const jobless = s.people.length ? s.people.filter((p) => p.job < 0 && !p.firms.length).length / s.people.length : 0;
    const prospects = Math.max(0.15, Math.min(1.3, 1.3 - 2 * jobless));
    // open positions pull people in (hunger, joblessness and people sleeping rough in the city put them off)
    const most = POPULATION.arrivalMax + Math.floor(s.people.length / 20);
    const openings = s.postings.reduce((n, x) => n + (x.openings ?? 1), 0);
    const homeless = s.people.length ? s.people.filter((p) => p.home < 0).length / s.people.length : 0;
    const housing = Math.max(0.2, 1 - 2.5 * homeless);
    let expected = (POPULATION.arrivalBase + POPULATION.arrivalPerOpening * Math.min(most, openings)) * (0.4 + 0.6 * fed) * prospects * housing;
    if (policy === 'limited') expected *= 0.35;
    let n = Math.floor(expected) + (ctx.rng.chance(expected % 1) ? 1 : 0);
    n = Math.min(n, most, POPULATION.cap - s.people.length);
    for (let i = 0; i < n; i++) spawnNewcomer(ctx);
    if (s.people.length === 0) spawnNewcomer(ctx);
  }

  /**
   * Hourly, for people who are starving with no money: business owners draw
   * on their company, homeowners put their house up for sale, and those with
   * nothing walk out of the city rather than starve in it.
   */
  private lastResort(): void {
    const ctx = this.ctx;
    for (const p of ctx.s.people.slice()) {
      if (p.needs.food > 20 || p.money >= 2) continue;
      const firm = p.firms.map((id) => ctx.fById.get(id)).find((f) => f && !f.closed && f.cash > 15);
      if (firm) { const draw = Math.min(12, firm.cash * 0.2); firm.cash -= draw; p.money += draw; continue; }
      if (p.owned.length) {
        const b = ctx.bById.get(p.owned[0]);
        if (b && p.needs.food < 12) sellHooks.sell(ctx, b, `${p.name} needs the money`);
        continue;
      }
      // some are tempted to steal before they give up
      if (p.needs.food < 25 && maybeSteal(ctx, p)) continue;
      if (p.job < 0 && p.needs.food < 12 && p.needs.health < 70 && ctx.rng.chance(0.15)) {
        log(ctx, 'arrival', `${p.name}, broke and hungry, left the city.`, { who: p.id });
        ctx.s.counters.emigrated = (ctx.s.counters.emigrated ?? 0) + 1;
        this.remove(p);
      }
    }
  }

  /**
   * People with nothing keeping them here (no job, no money, no property, few
   * friends) give up and leave to look for work somewhere else.
   */
  private emigration(): void {
    const ctx = this.ctx;
    const s = ctx.s;
    for (const p of s.people.slice()) {
      if (p.job >= 0 || p.firms.length || p.money > 300) continue;
      // nobody starves to death in a city they can walk out of: the starving leave whatever ties they have
      const starving = p.needs.food < 15 && p.needs.health < 60;
      if (!starving && s.tick - p.arrived < 8 * MINUTES_PER_DAY) continue;
      // out of work and running out of savings: they move on to look elsewhere (friends and a home of their own keep them here longer)
      const ties = Object.values(p.rel).filter((r) => r.trust > 0.5).length + (p.owned.length ? 3 : 0);
      const broke = p.money < 40 || p.home < 0;
      const chance = starving ? 0.6 : (broke ? 0.12 : p.money < 120 ? 0.05 : 0.02) / (1 + ties * 0.3);
      if (!ctx.rng.chance(chance)) continue;
      log(ctx, 'arrival', `${p.name} gave up and left the city to look for work elsewhere.`, { who: p.id });
      s.counters.emigrated = (s.counters.emigrated ?? 0) + 1;
      this.remove(p);
    }
  }

  private onRuin(b: Building): void {
    const ctx = this.ctx;
    for (const p of ctx.s.people) {
      if (p.home === b.id) moveOut(ctx, p);
      if (p.inside === b.id) { leaveSeat(ctx, p); p.inside = -1; }
    }
    for (const c of ctx.s.contracts.filter((c) => c.site === b.id)) endContract(ctx, c, 'lost their job when the building fell apart');
  }

  /** Someone dies. Their estate is settled: debts, then a will or the state (estate.ts). */
  kill(p: Person, cause: string): void {
    const ctx = this.ctx;
    const s = ctx.s;
    const wealth = wealthOf(ctx, p);
    for (const c of s.contracts.filter((c) => c.person === p.id)) endContract(ctx, c, '');
    settleEstate(ctx, p);
    this.remove(p);
    s.dead.push({ id: p.id, name: p.name, died: s.tick, cause, wealth });
    if (s.dead.length > 500) s.dead.shift();
    s.counters.deaths++;
    log(ctx, 'death', `${p.name} died of ${cause}.`, { who: p.id });
  }

  /** Take someone out of the world (died or moved away). */
  private remove(p: Person): void {
    const ctx = this.ctx;
    const s = ctx.s;
    for (const c of s.contracts.filter((c) => c.person === p.id)) endContract(ctx, c, '');
    for (const l of s.loans.filter((x) => x.borrower === p.id)) { const bank = ctx.fById.get(l.bank); if (bank) bank.cash -= Math.min(bank.cash, l.balance * 0.3); s.loans = s.loans.filter((x) => x !== l); }
    moveOut(ctx, p);
    leaveSeat(ctx, p);
    const car = ctx.vById.get(p.car);
    if (car && car.owner === p.id) removeVehicle(ctx, car);
    s.shipments = s.shipments.filter((sh) => sh.recipient !== p.id || sh.status !== 'open');
    s.postings.forEach((post) => { post.applicants = post.applicants.filter((a) => a !== p.id); });
    for (const pt of s.parties) pt.members = pt.members.filter((id) => id !== p.id);
    for (const g of s.polities) for (const o of g.offices) if (o.holder === p.id) o.holder = -1;
    for (const e of s.elections) for (const c of e.candidates) if (c.person === p.id) c.withdrawn = true;
    s.people = s.people.filter((q) => q !== p);
    ctx.byId.delete(p.id);
    for (const q of s.people) delete q.rel[p.id];
  }

  dayNumber(): number {
    return dayOf(this.state.tick) + 1;
  }

  hour(): number {
    return hourOf(this.state.tick);
  }
}

export { cellOf, polityAt };
