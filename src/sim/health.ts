// Health: people fall ill or get hurt now and then; doctors and hospitals
// treat them; who pays is each city's policy.
//
// What people get:
// - colds and flu, which are catching: passed on at work and at home;
// - injuries, more often in manual work;
// - serious illness (pneumonia, a heart attack, appendicitis), more likely
//   with age, hunger and sleeping rough, and deadly without a hospital bed;
// - a long-term condition from middle age on, which regular check-ups keep
//   in hand.
// An illness has a severity. While it lasts, health stays below where the
// illness keeps it (the worse, the lower). Mild ones heal with time, and a
// doctor's visit speeds that up. Serious illness drains health hour by hour
// until it's treated in a staffed hospital bed.
//
// Doctors and nurses work in clinics (visits) and hospitals (visits, an
// emergency room, wards). Patients pay the clinic's or hospital's price. A
// city may pay half (subsidized) or all of it (public healthcare) out of its
// treasury. Where nobody else pays, people short of money put off seeing a
// doctor. A hospital still takes in the seriously ill who can't pay
// (charity care).

import { MINUTES_PER_DAY } from './config';
import { addCash, cashOf, log, newId, type Ctx } from './ctx';
import { BUILDINGS } from './goods';
import { createBuilding, findLot } from './buildings';
import { startConstruction } from './construction';
import { recordSale } from './firms';
import { adminOf, bookSpend, polityAt, polityOf, referenceWage, treasury } from './government';
import { ageOf } from './ideology';
import { staffAt } from './jobs';
import { slogan } from './names';
import { tally } from './stats';
import { freeSpot, leaveSeat, staffPresent, takeSeat } from './tasks';
import { GATE, type Building, type Firm, type IllKind, type Person, type Polity, type Step } from './types';

export const ILLNESS: Record<IllKind, { label: string; cap: number; heal: number; catching: number; rest: boolean }> = {
  // cap: how far below full health it keeps them at full severity; heal: severity lost per day by itself
  cold: { label: 'a cold', cap: 25, heal: 0.22, catching: 0.03, rest: false },
  flu: { label: 'the flu', cap: 55, heal: 0.13, catching: 0.035, rest: true },
  injury: { label: 'an injury', cap: 50, heal: 0.07, catching: 0, rest: true },
  serious: { label: 'a serious illness', cap: 0, heal: 0, catching: 0, rest: true },
  chronic: { label: 'a long-term condition', cap: 35, heal: 0, catching: 0, rest: false },
};

export const HEALTH = {
  /** Chance per day of falling ill (before age, hunger, sleeping rough). */
  daily: { cold: 0.005, flu: 0.0012, injuryManual: 0.0016, injury: 0.0003, serious: 0.00012, chronic: 0.0003 },
  /** Health lost per hour by someone seriously ill, at full severity, untreated (in a hospital bed: half; with staff on duty: a sixth). */
  seriousDrain: 3,
  /** A doctor's visit, and a day in a hospital bed, at first: shares of a typical day's pay. */
  visitPrice: 0.6,
  bedPrice: 1.4,
  /** A check-up keeps a long-term condition in hand this many days. */
  checkupDays: 30,
  /** Days someone can't catch a cold or the flu again after getting over it. */
  immuneDays: { cold: 20, flu: 120 } as Record<string, number>,
};

const MANUAL = new Set(['farmhand', 'logger', 'quarrier', 'miner', 'worker', 'builder', 'driver', 'cook']);

/** Who pays for care where someone lives: the share their city covers (0, half, all). */
export function coverOf(ctx: Ctx, p: Person): { g: Polity | undefined; share: number } {
  const g = polityOf(ctx, p);
  const care = g?.policy.healthcare ?? 'private';
  return { g, share: care === 'public' ? 1 : care === 'subsidized' ? 0.5 : 0 };
}

/** What they'd pay out of pocket for a visit at a clinic or hospital. */
export function visitCost(ctx: Ctx, p: Person, b: Building): number {
  const f = ctx.fById.get(b.firm);
  return (f?.prices.visit ?? referenceWage(ctx) * HEALTH.visitPrice) * (1 - coverOf(ctx, p).share);
}

/** How well they are kept below full health by an illness (100 = not at all). */
export function healthCap(ctx: Ctx, p: Person): number {
  const ill = p.ill;
  if (!ill || ill.kind === 'serious') return 100;
  const managed = ill.kind === 'chronic' && ill.seen !== undefined && ctx.s.tick - ill.seen < HEALTH.checkupDays * MINUTES_PER_DAY;
  return 100 - ILLNESS[ill.kind].cap * ill.sev * (managed ? 0.35 : 1);
}

/** Health lost per hour to a serious illness (much less in a hospital bed with staff on duty). */
export function seriousDrain(ctx: Ctx, p: Person): number {
  const ill = p.ill;
  if (ill?.kind !== 'serious') return 0;
  // in a hospital bed: watched over at night, treated while doctors and nurses are on duty
  if (ill.admitted === GATE) return HEALTH.seriousDrain * ill.sev * 0.15; // in the regional hospital
  const inBed = ill.admitted !== undefined && p.inside === ill.admitted;
  const treated = inBed && (staffPresent(ctx, ill.admitted!, 'doctor') || staffPresent(ctx, ill.admitted!, 'nurse'));
  return HEALTH.seriousDrain * ill.sev * (treated ? 0.15 : inBed ? 0.5 : 1);
}

/** Does this illness keep them home from work (and in bed)? */
export function tooSickToWork(p: Person): boolean {
  return !!p.ill && ILLNESS[p.ill.kind].rest && p.ill.sev > 0.25;
}

function fallIll(ctx: Ctx, p: Person, kind: IllKind, why = ''): void {
  if (p.ill && (p.ill.kind === 'serious' || kind !== 'serious')) return;
  if ((p.cooldown['immune:' + kind] ?? 0) > ctx.s.tick) return;
  const r = ctx.rng;
  const sev = kind === 'cold' ? r.range(0.3, 0.6) : kind === 'flu' ? r.range(0.4, 0.8) : kind === 'injury' ? r.range(0.3, 0.9) : kind === 'serious' ? r.range(0.45, 0.8) : r.range(0.3, 0.6);
  p.ill = { kind, sev, since: ctx.s.tick };
  tally(ctx, 'ill:' + kind, 1);
  if (kind !== 'cold') log(ctx, 'health', `${p.name} ${kind === 'injury' ? 'got hurt' : 'fell ill'}${why}: ${ILLNESS[kind].label}.`, { who: p.id });
}

/**
 * Daily: who falls ill, how illnesses run their course (and who recovers),
 * who catches a cold or flu from whom, and the hospitals' bills for the
 * day's patients.
 */
export function healthDaily(ctx: Ctx): void {
  const s = ctx.s, rng = ctx.rng, H = HEALTH.daily;
  // who's together most of the day: workmates and the people they live with
  const atSite = new Map<number, Person[]>(), atHome = new Map<number, Person[]>();
  for (const p of s.people) {
    const c = ctx.cById.get(p.job);
    if (c) { const l = atSite.get(c.site); if (l) l.push(p); else atSite.set(c.site, [p]); }
    if (p.home >= 0) { const l = atHome.get(p.home); if (l) l.push(p); else atHome.set(p.home, [p]); }
  }
  for (const p of s.people.slice()) {
    const ill = p.ill;
    const frail = (p.needs.food < 25 ? 2 : 1) * (p.home < 0 ? 2 : 1) * (p.exposure < 0.5 && p.home < 0 ? 1.5 : 1);
    const age = ageOf(ctx, p);
    const old = Math.pow(Math.max(20, age) / 45, 2.5);
    if (!ill) {
      const role = ctx.cById.get(p.job)?.role;
      if (rng.chance(H.serious * old * frail)) fallIll(ctx, p, 'serious');
      else if (rng.chance((role && MANUAL.has(role) ? H.injuryManual : H.injury))) fallIll(ctx, p, 'injury', role && MANUAL.has(role) ? ' at work' : '');
      else if (age > 45 && rng.chance(H.chronic * old)) fallIll(ctx, p, 'chronic');
      else if (rng.chance(H.flu * frail)) fallIll(ctx, p, 'flu');
      else if (rng.chance(H.cold * frail)) fallIll(ctx, p, 'cold');
      continue;
    }
    const def = ILLNESS[ill.kind];
    const seen = ill.seen !== undefined && s.tick - ill.seen < 5 * MINUTES_PER_DAY;
    const away = ill.admitted === GATE;
    const inBed = away || (ill.admitted !== undefined && p.inside === ill.admitted);
    const staffed = away || (inBed && staffAt(ctx, ill.admitted!).length > 0);
    switch (ill.kind) {
      case 'cold': case 'flu': case 'injury': {
        ill.sev -= def.heal * (seen ? 1.8 : 1) * (inBed ? 1.5 : 1) * (frail > 1 ? 0.5 : 1);
        // flu turns into pneumonia in the old and the weak, now and then
        if (ill.kind === 'flu' && (frail > 1 || age > 70) && rng.chance(0.05 * ill.sev)) { delete p.ill; fallIll(ctx, p, 'serious', ' (the flu turned into pneumonia)'); }
        break;
      }
      case 'serious':
        // only a hospital cures it; a clinic can only hold it back a little
        ill.sev += staffed ? -0.2 : seen ? -0.03 : 0.1;
        ill.sev = Math.min(1, ill.sev);
        break;
      case 'chronic':
        // left alone, it flares up now and then
        if (!(ill.seen !== undefined && s.tick - ill.seen < HEALTH.checkupDays * MINUTES_PER_DAY) && rng.chance(0.03)) ill.sev = Math.min(1, ill.sev + 0.1);
        break;
    }
    if (p.ill && ill.kind !== 'chronic' && ill.sev <= 0.05) {
      if (ill.kind !== 'cold') log(ctx, 'health', `${p.name} got over ${def.label}${ill.kind === 'serious' ? ' in hospital' : ''}.`, { who: p.id });
      const immune = HEALTH.immuneDays[ill.kind];
      if (immune) p.cooldown['immune:' + ill.kind] = s.tick + immune * MINUTES_PER_DAY;
      delete p.ill;
      continue;
    }
    // passing it on
    if (def.catching > 0) {
      const c = ctx.cById.get(p.job);
      const mates = [...(c ? (atSite.get(c.site) ?? []).slice(0, 8) : []), ...(atHome.get(p.home) ?? [])];
      for (const q of mates) {
        if (q === p || q.ill) continue;
        const near = q.home === p.home ? 2 : 1;
        if (rng.chance(def.catching * ill.sev * near)) fallIll(ctx, q, ill.kind, ` (caught it from ${p.name})`);
      }
    }
  }
  billPatients(ctx);
  healthPrices(ctx);
}

/** Hospitals charge each patient in a bed for the day (the city pays its share; the rest is charity if they can't). */
function billPatients(ctx: Ctx): void {
  for (const p of ctx.s.people) {
    const id = p.ill?.admitted;
    if (id === GATE) {
      // the regional hospital outside: the money leaves the city
      payOutside(ctx, p, referenceWage(ctx) * HEALTH.bedPrice * 1.3);
      tally(ctx, 'health:away', 1);
      continue;
    }
    if (id === undefined || p.inside !== id) continue;
    const b = ctx.bById.get(id);
    const f = b ? ctx.fById.get(b.firm) : undefined;
    if (!b || !f) continue;
    const price = f.prices.bed ?? referenceWage(ctx) * HEALTH.bedPrice;
    pay(ctx, p, f, price);
    recordSale(f, 'bed', 1);
    tally(ctx, 'health:bed', 1);
  }
}

/** A patient's bill: their city pays its share, they pay what they can of the rest. */
function pay(ctx: Ctx, p: Person, f: Firm, price: number): number {
  const { g, share } = coverOf(ctx, p);
  let got = 0;
  if (g && share > 0) {
    const pub = price * share;
    addCash(ctx, g.firm, -pub);
    bookSpend(ctx, g, 'healthcare', pub);
    got += pub;
  }
  const own = Math.min(price * (1 - share), Math.max(0, cashOf(ctx, p.id)));
  addCash(ctx, p.id, -own);
  tally(ctx, 'spend:health', own);
  got += own;
  addCash(ctx, f.id, got);
  return got;
}

/** A bill from the regional hospital outside the city (the city pays its share, the patient what they can of the rest). */
function payOutside(ctx: Ctx, p: Person, price: number): void {
  const { g, share } = coverOf(ctx, p);
  if (g && share > 0) {
    addCash(ctx, g.firm, -price * share);
    bookSpend(ctx, g, 'healthcare', price * share);
  }
  const own = Math.min(price * (1 - share), Math.max(0, cashOf(ctx, p.id)));
  addCash(ctx, p.id, -own);
  tally(ctx, 'spend:health', own);
}

/** Taken to the regional hospital outside the city: out by Route 9, treated there, brought back into town when well. */
export function awayMinute(ctx: Ctx, p: Person): 'wait' | 'instant' {
  const task = p.task!;
  const far = ctx.s.farGates?.[0] ?? ctx.s.gates[0] ?? ctx.s.center;
  if (task.elapsed === 0) {
    leaveSeat(ctx, p);
    p.inside = -1;
    p.x = p.px = far.x;
    p.y = p.py = far.y;
    p.path = [];
    if (p.ill) p.ill.admitted = GATE;
    log(ctx, 'health', `An ambulance took ${p.name} to the regional hospital outside the city${p.ill ? ` (${ILLNESS[p.ill.kind].label})` : ''}.`, { who: p.id });
  }
  task.elapsed++;
  p.pose = 'stand';
  p.activity = 'in the regional hospital, outside the city';
  if (p.needs.food < 45) p.needs.food = Math.min(100, p.needs.food + 40);
  if (p.needs.energy < 60) p.needs.energy = 80;
  if (!p.ill || p.ill.sev < 0.12 || (p.ill.kind !== 'serious' && p.ill.sev < 0.3)) {
    discharge(ctx, p, 'the regional hospital');
    // dropped off where the highway meets the city
    const gate = ctx.s.gates[0] ?? ctx.s.center;
    p.x = p.px = gate.x + (ctx.s.center.x - gate.x) * 0.6;
    p.y = p.py = gate.y + (ctx.s.center.y - gate.y) * 0.6;
    p.activity = 'back from the regional hospital';
    return 'instant';
  }
  return 'wait';
}

/**
 * Clinics and hospitals set their prices to cover their staff: the day's wage
 * bill (plus a margin) spread over the visits and bed-days they've been
 * getting, moving a few percent a day toward that.
 */
function healthPrices(ctx: Ctx): void {
  const ref = referenceWage(ctx);
  for (const f of ctx.s.firms) {
    if (f.closed || BUILDINGS[f.kind].service !== 'health') continue;
    f.prices.visit ??= ref * HEALTH.visitPrice;
    f.prices.bed ??= ref * HEALTH.bedPrice;
    let wages = 0;
    for (const c of ctx.s.contracts) if (c.firm === f.id) wages += c.wage;
    const visits = Math.max(3, f.salesAvg.visit ?? 0), beds = f.salesAvg.bed ?? 0;
    // a bed-day costs about two and a half visits' worth of care
    const perVisit = (wages * 1.15) / (visits + 2.5 * beds);
    const towards = (cur: number, target: number) => cur + Math.max(-0.04 * cur, Math.min(0.04 * cur, target - cur));
    f.prices.visit = Math.min(ref * 2.5, Math.max(ref * 0.3, towards(f.prices.visit, perVisit)));
    f.prices.bed = Math.min(ref * 6, Math.max(ref * 0.8, towards(f.prices.bed, perVisit * 2.5)));
  }
}

// ------------------------------------------------------------------ visits

/** At a clinic or emergency room: wait for a doctor, be seen, pay; the seriously ill are admitted (or sent to a hospital). */
export function clinicMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'clinic' }>): 'wait' | 'instant' {
  const b = ctx.bById.get(step.bid);
  const task = p.task!;
  const f = b ? ctx.fById.get(b.firm) : undefined;
  if (!b || !b.built || b.ruined || !f) return 'instant';
  if (task.elapsed === 0) {
    const seat = freeSpot(ctx, b, 'seat');
    if (seat >= 0) takeSeat(ctx, p, b, seat);
    task.mem = { seen: 0 };
  }
  task.elapsed++;
  const name = f.name;
  if (!task.mem?.seen) {
    p.pose = 'sit';
    p.activity = `waiting to see a doctor at ${name}`;
    if (staffPresent(ctx, b.id, 'doctor')) {
      const price = f.prices.visit ?? referenceWage(ctx) * HEALTH.visitPrice;
      const serious = p.ill?.kind === 'serious';
      // without the money (and nobody paying for them) they're turned away, unless it's an emergency at a hospital
      const own = price * (1 - coverOf(ctx, p).share);
      if (cashOf(ctx, p.id) < own && !(serious && b.kind === 'hospital')) { p.activity = "couldn't afford the doctor"; p.cooldown.doctor = ctx.s.tick + 2 * MINUTES_PER_DAY; leaveSeat(ctx, p); return 'instant'; }
      pay(ctx, p, f, price);
      recordSale(f, 'visit', 1);
      tally(ctx, 'health:visit', 1);
      task.mem!.seen = 1;
      task.elapsed = 1;
    } else if (p.ill?.kind === 'serious' && b.kind === 'hospital' && task.elapsed > 15) {
      // the night staff take an emergency straight in (the doctors see them in the morning)
      leaveSeat(ctx, p);
      task.steps.splice(task.i + 1, task.steps.length, { k: 'hospital', bid: b.id });
      return 'instant';
    } else if (task.elapsed > 90) { p.activity = 'no doctor in'; p.cooldown.doctor = ctx.s.tick + 240; leaveSeat(ctx, p); return 'instant'; }
    return 'wait';
  }
  p.pose = 'sit';
  p.activity = `seeing the doctor at ${name}`;
  if (task.elapsed < 20) return 'wait';
  leaveSeat(ctx, p);
  p.cooldown.checkup = ctx.s.tick + 365 * MINUTES_PER_DAY;
  if (p.ill) {
    p.ill.seen = ctx.s.tick;
    // too ill to go home: a bed here, or the nearest hospital
    if (p.ill.kind === 'serious' || (p.ill.kind === 'injury' && p.ill.sev > 0.7)) {
      const h = b.kind === 'hospital' && freeSpot(ctx, b, 'bed') >= 0 ? b : nearestHospital(ctx, p);
      if (h) {
        const next: Step[] = h === b ? [{ k: 'hospital', bid: h.id }] : [{ k: 'go', to: { t: 'bld', id: h.id } }, { k: 'hospital', bid: h.id }];
        task.steps.splice(task.i + 1, task.steps.length, ...next);
        if (h !== b) log(ctx, 'health', `The doctor at ${name} sent ${p.name} to the hospital.`, { who: p.id, bid: h.id });
      } else task.steps.splice(task.i + 1, task.steps.length, { k: 'away' });
    }
  }
  return 'instant';
}

/** Sent home: cured of a serious illness; anything milder heals the rest of the way at home. */
function discharge(ctx: Ctx, p: Person, where: string): void {
  if (!p.ill) return;
  if (p.ill.kind === 'serious') {
    log(ctx, 'health', `${p.name} recovered at ${where} and went home.`, { who: p.id });
    delete p.ill;
  } else delete p.ill.admitted;
}

/** The nearest clinic or hospital that's running (anywhere on the map). */
export function nearestCare(ctx: Ctx, p: Person): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of ctx.s.buildings) {
    if ((b.kind !== 'clinic' && b.kind !== 'hospital') || !b.built || b.ruined || b.firm < 0) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** The nearest hospital with a free bed. */
export function nearestHospital(ctx: Ctx, p: Person): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of ctx.s.buildings) {
    if (b.kind !== 'hospital' || !b.built || b.ruined || b.firm < 0) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < bd && freeSpot(ctx, b, 'bed') >= 0) { bd = d; best = b; }
  }
  return best;
}

/** In a hospital bed: rest, meals, treatment (while staff are on duty) until well enough to go home. */
export function hospitalMinute(ctx: Ctx, p: Person, step: Extract<Step, { k: 'hospital' }>): 'wait' | 'instant' {
  const b = ctx.bById.get(step.bid);
  const task = p.task!;
  const f = b ? ctx.fById.get(b.firm) : undefined;
  if (!b || !b.built || b.ruined || !f) { if (p.ill) delete p.ill.admitted; p.sleeping = false; return 'instant'; }
  if (task.elapsed === 0) {
    const bed = freeSpot(ctx, b, 'bed');
    if (bed < 0) { p.activity = 'no free bed at the hospital'; return 'instant'; }
    takeSeat(ctx, p, b, bed);
    if (p.ill) {
      p.ill.admitted = b.id;
      log(ctx, 'health', `${p.name} was admitted to ${f.name} with ${ILLNESS[p.ill.kind].label}.`, { who: p.id, bid: b.id });
    }
  }
  task.elapsed++;
  // discharged once well enough (or if they've nothing wrong any more)
  if (!p.ill || p.ill.sev < 0.12 || (p.ill.kind !== 'serious' && p.ill.sev < 0.3)) {
    discharge(ctx, p, f.name);
    p.sleeping = false;
    leaveSeat(ctx, p);
    p.activity = 'discharged from hospital';
    return 'instant';
  }
  p.pose = 'sleep';
  p.sleeping = true;
  p.activity = `in hospital at ${f.name} (${ILLNESS[p.ill.kind].label})`;
  // meals come with the bed
  if (p.needs.food < 45) p.needs.food = Math.min(100, p.needs.food + 40);
  return 'wait';
}

// ------------------------------------------------------------- public care

/** A city builds a public hospital (its own company, run by the city, paid for out of the treasury). */
export function buildPublicHospital(ctx: Ctx, g: Polity): Building | null {
  const admin = adminOf(ctx, g);
  if (!admin) return null;
  const lot = findLot(ctx, 'hospital', { x: g.cx ?? ctx.s.center.x, y: g.cy ?? ctx.s.center.y }, admin.id);
  if (!lot) return null;
  const budget = Math.min(treasury(ctx, g) * 0.8, 4000);
  const f: Firm = {
    id: newId(ctx), name: `${g.short} General Hospital`, owner: g.id, gov: g.id, founded: ctx.s.tick, cash: 0, kind: 'hospital',
    sites: [], prices: { visit: referenceWage(ctx) * HEALTH.visitPrice, bed: referenceWage(ctx) * HEALTH.bedPrice }, wages: {},
    ledger: { revenue: 0, costs: 0, days: [] }, reputation: 0.6, sales: {}, salesAvg: {}, losing: 0, hue: ctx.rng.next(), website: true,
    slogan: slogan(ctx.rng), closed: false,
  };
  ctx.s.firms.push(f);
  ctx.fById.set(f.id, f);
  addCash(ctx, admin.id, -budget);
  f.cash += budget;
  bookSpend(ctx, g, 'hospital', budget);
  const b = createBuilding(ctx, 'hospital', lot, f.id, 3, false, f.id);
  startConstruction(ctx, f.id, b);
  log(ctx, 'politics', `${g.short} is building a public hospital, ${f.name}.`, { firm: f.id, bid: b.id });
  return b;
}

/** Is there a hospital in this city's territory (built or going up)? */
export function hasHospital(ctx: Ctx, g: Polity): boolean {
  return ctx.s.buildings.some((b) => b.kind === 'hospital' && !b.ruined && polityAt(ctx, b.x, b.y)?.id === g.id);
}
