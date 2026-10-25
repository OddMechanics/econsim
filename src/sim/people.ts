import { MINUTES_PER_DAY, NEEDS, OUTSIDE, POPULATION, WAGES } from './config';
import { isNight, log, newId, type Ctx } from './ctx';
import { BUILDINGS, DURABLES, EDIBLE, emptyInv, GOOD } from './goods';
import { randomName } from './names';
import { nearestRoadPoint } from './roads';
import { initPolitics, ORIGINS } from './ideology';
import { GOODS, type Good, type Looks, type Person, type PriceBelief } from './types';

/** Set by sim.ts: newcomers' brains are inherited from people doing well. */
let brainFrom: (ctx: Ctx) => Person['brain'] = () => undefined;
export function setBrainSource(fn: (ctx: Ctx) => Person['brain']): void {
  brainFrom = fn;
}

export function randomLooks(ctx: Ctx): Looks {
  const r = ctx.rng;
  // clothes skew toward everyday colors: blues, greys, browns, some brights
  const muted = [0.6, 0.62, 0.58, 0.08, 0.1, 0.55, 0.0, 0.33];
  return {
    skin: r.int(0, 6),
    hair: r.int(0, 7),
    hairStyle: r.int(0, 4),
    shirt: r.chance(0.6) ? r.next() : r.pick(muted),
    pants: r.chance(0.7) ? r.pick([0.6, 0.62, 0.08, 0.1, 0.0, 0.65]) + r.range(-0.02, 0.02) : r.next(),
    height: r.range(1.6, 1.9),
    build: r.range(0.88, 1.12),
  };
}

export function createPerson(ctx: Ctx, x: number, y: number, money: number, food: number): Person {
  const r = ctx.rng;
  const traits = {
    diligence: r.trait(), ambition: r.trait(), risk: r.trait(), sociability: r.trait(),
    communication: r.trait(), patience: r.trait(), comfortLove: r.trait(), curiosity: r.trait(), agreeable: r.trait(),
  };
  // where they grew up, how long they went to school, how old they are
  const total = ORIGINS.reduce((s, o) => s + o.w, 0);
  let pick = r.next() * total;
  const origin = ORIGINS.find((o) => (pick -= o.w) < 0) ?? ORIGINS[0];
  const edu = Math.round(Math.max(8, Math.min(21, 7.5 + 3.5 * traits.diligence + 5 * traits.curiosity + origin.edu + r.range(-2.5, 2.5))));
  const age = 19 + 46 * Math.pow(r.next(), 1.5);
  // they come from a modern economy: they know roughly what things cost and what work pays
  // where they lived before (each with their own bias), until they see the prices here
  const hourly = (WAGES.reference / 8) * r.range(0.85, 1.15);
  const prices = {} as Record<Good, PriceBelief>;
  const zero = {} as Record<Good, number>;
  for (const g of GOODS) {
    prices[g] = { p: (OUTSIDE.prices[g] ?? GOOD[g].laborGuess * 2) * r.range(0.8, 1.3), t: -1, src: 'guess' };
    zero[g] = 0;
  }
  const inv = emptyInv();
  inv.groceries = food;
  const p: Person = {
    id: newId(ctx),
    name: randomName(r),
    looks: randomLooks(ctx),
    traits,
    needs: { food: r.range(70, 95), energy: r.range(70, 95), health: 100, social: r.range(50, 90), fun: r.range(50, 90) },
    x, y, px: x, py: y, heading: r.range(0, Math.PI * 2), pose: 'stand',
    inside: -1, seat: -1, driving: -1, path: [],
    // nearly everyone has a phone (and with it the Net)
    money, inv, pantry: emptyInv(), durables: { clothes: r.range(10, 40), ...(r.chance(0.88) ? { phone: r.range(60, 300) } : {}) }, toolWear: 0,
    home: -1, unit: -1, job: -1, car: -1, owned: [], firms: [], projectId: -1, skills: {},
    task: null, hourly, prices,
    demandSeen: { ...zero }, supplySeen: { ...zero }, bidSeen: { ...zero },
    knownJobs: -1e9, knownHomes: -1e9,
    rel: {}, decision: null, activity: 'arriving', sleeping: false,
    said: [], saying: '', sayingUntil: 0,
    arrived: ctx.s.tick, earned: 0, exposure: 0, mood: 0.6, cooldown: {},
    born: ctx.s.tick - Math.round(age * 365 * MINUTES_PER_DAY), edu, origin: origin.name,
    pol: undefined as unknown as Person['pol'], happy: 0.55,
  };
  p.pol = initPolitics(ctx, p);
  // schooling shows in how much they think their time is worth
  p.hourly *= 0.8 + 0.035 * (edu - 8);
  ctx.s.people.push(p);
  ctx.byId.set(p.id, p);
  return p;
}

/** Shelter (0..1) where the person is right now. */
export function shelterHere(ctx: Ctx, p: Person): number {
  if (p.inside < 0) return 0;
  const b = ctx.bById.get(p.inside);
  if (!b || !b.built || b.ruined) return 0;
  if (BUILDINGS[b.kind].category === 'home') return BUILDINGS[b.kind].shelter * (0.35 + 0.65 * b.condition);
  return b.kind === 'park' || b.kind === 'plaza' ? 0 : 0.8;
}

/** What to eat from an inventory: of what's there, what they've had least of lately (leftovers count: half a pack is half a meal). */
function pickFood(p: Person, inv: Record<Good, number>): Good | null {
  let best: Good | null = null, bv = Infinity;
  for (const g of EDIBLE) {
    if (inv[g] < 0.25) continue;
    const v = p.ate?.[g] ?? 0;
    if (v < bv) { bv = v; best = g; }
  }
  return best;
}

export function eat(p: Person, g: Good, from: Record<Good, number>): void {
  const amount = Math.min(1, from[g]);
  from[g] -= amount;
  // the same thing again and again gets dull; something different is a treat
  const lately = p.ate?.[g] ?? 0;
  const ate = (p.ate ??= {});
  ate[g] = lately + amount;
  p.needs.food = Math.min(100, p.needs.food + (GOOD[g].nutrition ?? 20) * amount);
  p.needs.fun = Math.min(100, p.needs.fun + (GOOD[g].joy ?? 0) * amount * Math.max(0.3, 1.3 - 0.25 * lately));
}

/** How many different foods they've eaten lately. */
export function dietVariety(p: Person): number {
  let n = 0;
  for (const g of EDIBLE) if ((p.ate?.[g] ?? 0) > 0.4) n++;
  return n;
}

/** Needs drift every minute; people eat automatically when hungry. */
export function updateNeeds(ctx: Ctx, p: Person, working: boolean, dt = 1): void {
  const n = p.needs;
  const perMin = dt / 60;
  n.food = Math.max(0, n.food - NEEDS.hungerPerHour * perMin);
  if (p.sleeping) n.energy = Math.min(100, n.energy + NEEDS.energySleepPerHour * perMin);
  else n.energy = Math.max(0, n.energy - (working ? NEEDS.energyWorkPerHour : NEEDS.energyAwakePerHour) * perMin);
  n.social = Math.max(0, n.social - NEEDS.socialPerHour * perMin);
  if (!p.sleeping) n.fun = Math.max(0, n.fun - NEEDS.funPerHour * perMin);

  if (n.food < NEEDS.eatBelow && !p.sleeping) {
    const atHome = p.inside >= 0 && p.inside === p.home;
    const fromInv = pickFood(p, p.inv);
    const g = fromInv ?? (atHome ? pickFood(p, p.pantry) : null);
    if (g) eat(p, g, fromInv ? p.inv : p.pantry);
  }

  let dh = 0;
  if (n.food <= 0) dh -= NEEDS.starvePerHour;
  if (isNight(ctx.s.tick)) {
    const shelter = shelterHere(ctx, p);
    p.exposure = shelter;
    const clothes = (p.durables.clothes ?? 0) > 0 ? 0.2 : 0;
    dh -= NEEDS.exposurePerHour * Math.max(0, 1 - shelter - clothes) * (p.sleeping ? 1 : 0.6);
  }
  if (n.food > 25 && n.energy > 10 && dh === 0) dh += NEEDS.healthRegenPerHour;
  n.health = Math.min(100, n.health + dh * perMin);
}

/** Once a day: things wear out, mood follows how life is going, and so does happiness. */
export function personDaily(ctx: Ctx, p: Person): void {
  for (const g of [...DURABLES, 'phone', 'tv'] as (Good | 'phone' | 'tv')[]) {
    if (g === 'tools' || g === 'cars') continue;
    const left = p.durables[g];
    if (left !== undefined) {
      p.durables[g] = left - 1;
      if (left - 1 <= 0) delete p.durables[g];
    }
  }
  const n = p.needs;
  const target = (n.food + n.health + n.social + n.fun + n.energy) / 500 + (p.home >= 0 ? 0.1 : -0.15) + (p.job >= 0 || p.firms.length ? 0.05 : -0.05);
  p.mood = Math.max(0, Math.min(1, 0.7 * p.mood + 0.3 * target));
  // happiness: needs met, a good home, things they own, and earning as much as the people around them (or more)
  const home = ctx.bById.get(p.home);
  const comfort = home && home.built ? BUILDINGS[home.kind].comfort * (0.4 + 0.6 * home.condition) + (home.owner === p.id ? 0.15 : 0) : 0;
  const things = ['phone', 'tv', 'computers', 'furniture', 'clothes'].filter((g) => (p.durables[g as Good] ?? 0) > 0).length + (p.car >= 0 ? 2 : 0);
  const income = ctx.cById.get(p.job)?.wage ?? (p.firms.length ? 25 : 0);
  const avg = averageWage(ctx);
  const status = Math.max(-0.2, Math.min(0.2, 0.15 * Math.log((income + 5) / (avg + 5)) + 0.04 * Math.log10(10 + Math.max(0, p.money)) - 0.08));
  // a varied diet (three or more different foods lately) is one of life's pleasures; eating one thing gets you down
  const variety = dietVariety(p);
  const diet = variety >= 3 ? 0.04 : variety <= 1 ? -0.03 : 0;
  const happyTarget = 0.25 * target + 0.25 * comfort + 0.05 * things + status + diet + (p.job >= 0 || p.firms.length ? 0.1 : -0.05);
  p.happy = Math.max(0, Math.min(1, 0.85 * p.happy + 0.15 * happyTarget));
  // what they ate fades from memory over a few days
  if (p.ate) for (const g of Object.keys(p.ate) as Good[]) { const v = (p.ate[g] ?? 0) * 0.6; if (v < 0.05) delete p.ate[g]; else p.ate[g] = Math.round(v * 100) / 100; }
  // forget old cooldowns
  for (const k of Object.keys(p.cooldown)) if (p.cooldown[k] < ctx.s.tick - 2 * MINUTES_PER_DAY) delete p.cooldown[k];
}

/** The average wage per shift (worked out once a minute for everyone). */
const wageCache = new WeakMap<object, { t: number; v: number }>();
function averageWage(ctx: Ctx): number {
  const c = wageCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.v;
  let sum = 0;
  for (const k of ctx.s.contracts) sum += k.wage;
  const v = ctx.s.contracts.length ? sum / ctx.s.contracts.length : 18;
  wageCache.set(ctx.s, { t: ctx.s.tick, v });
  return v;
}

export function causeOfDeath(p: Person): string {
  return p.needs.food <= 0 ? 'starvation' : 'exposure';
}

/** Newcomers come in along the highway (by bus or a friend's car) and get out at the edge of town. */
export function spawnNewcomer(ctx: Ctx): Person | null {
  const gate = ctx.s.gates.length ? ctx.s.gates[Math.floor(ctx.rng.next() * ctx.s.gates.length)] : ctx.s.center;
  // dropped off where the highway meets the city
  const t = 0.55 + 0.2 * ctx.rng.next();
  let x = gate.x + (ctx.s.center.x - gate.x) * t, y = gate.y + (ctx.s.center.y - gate.y) * t;
  const r = nearestRoadPoint(ctx, x, y, 300);
  if (r) { x = r.x; y = r.y; }
  x += ctx.rng.range(-3, 3);
  y += ctx.rng.range(-3, 3);
  const [lo, hi] = POPULATION.newcomerMoney;
  // most come with little; about one in ten brings real savings (to invest, start a business, or a profession)
  const investor = ctx.rng.chance(0.1 + Math.min(0.1, ctx.s.people.length / 3000));
  const money = investor ? Math.round(800 + 2600 * Math.pow(ctx.rng.next(), 2)) : Math.round(lo + (hi - lo) * Math.pow(ctx.rng.next(), 2));
  const p = createPerson(ctx, x, y, money, POPULATION.newcomerFood);
  if (investor) {
    p.edu = Math.max(p.edu, 14 + Math.floor(ctx.rng.next() * 5));
    p.traits.ambition = Math.max(p.traits.ambition, 0.6);
    p.hourly *= 1.3;
  }
  p.brain = brainFrom(ctx);
  ctx.s.counters.arrivals++;
  log(ctx, 'arrival', investor ? `${p.name} arrived with savings of ${money}, looking for opportunities.` : `${p.name} arrived in the city looking for a new life.`, { who: p.id });
  return p;
}
