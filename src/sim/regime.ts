// When people stop going along. Every person "recognizes" each government
// to some degree (0..1): how far they accept its rules as binding. It
// follows how life is going, whether the rules seem fair (elections held,
// parties allowed), how far the rulers' views are from theirs, and what
// their friends think. Grievances build up from hunger, joblessness and
// rights taken away. (docs/research/politics.md §6)
//
// Most of the time nothing dramatic happens: people complain, vote, and the
// government carries on. Protests start when grievances are high, and they
// grow only if people see others joining (threshold cascades). A
// revolution needs mass protest (3.5% of residents), a government few
// accept, and police who won't defend it. A coup needs an ambitious police
// chief and a shaky government. Both are rare. And when a toppled
// government keeps enough loyal people and officers, it carries on as a
// rival government claiming the same ground.

import { MINUTES_PER_DAY, POLITICS } from './config';
import { dayStart, hourOf, log, newId, type Ctx } from './ctx';
import { compass, distance, rulersPosition, stance } from './ideology';
import { cityName } from './names';
import {
  cellOf, defaultCharter, defaultPolicy, foundPolity, govSite, polityAt, polityOf, rebuildOffices, residentsOf, systemLabel,
} from './government';
import { instantElection, median, rulingParty, seat } from './elections';
import { fillVacancies } from './council';
import type { Charter, CivicEvent, Person, Polity } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ------------------------------------------------------------ grievances

/** What a person is angry about right now (the biggest one names their protest). */
export function complaints(ctx: Ctx, p: Person, g: Polity): { why: string; w: number }[] {
  const out: { why: string; w: number }[] = [];
  const dem = stance(ctx, p, 'democracy');
  if (p.needs.food < 25) out.push({ why: 'Bread and jobs!', w: 0.7 });
  if (p.home < 0) out.push({ why: 'Homes for all!', w: 0.3 });
  if (p.job < 0 && !p.firms.length && ctx.s.tick - p.arrived > 3 * MINUTES_PER_DAY) out.push({ why: 'Jobs now!', w: 0.25 });
  const home = ctx.bById.get(p.home);
  if (home && home.kind === 'apartments' && (home.units[p.unit]?.arrears ?? 0) > 0) out.push({ why: 'The rent is too high!', w: 0.25 });
  const c = g.charter;
  if (c.suspendedUntil > ctx.s.tick && dem > 0) out.push({ why: 'Free elections now!', w: 0.7 * dem + 0.2 });
  if (c.parties === 'single' && dem > 0) out.push({ why: 'Freedom of association!', w: 0.4 * dem + (p.pol.party >= 0 && ctx.partyById.get(p.pol.party)?.banned ? 0.6 : 0) });
  if (c.press === 'state' && dem > 0) out.push({ why: 'Free press!', w: 0.25 * dem });
  if (c.execBy === 'force' && dem > -0.2) out.push({ why: 'End military rule!', w: 0.5 + 0.3 * dem });
  if (c.franchise !== 'residents' && c.franchise !== 'everyone' && !(c.franchise === 'owners' && p.owned.length)) out.push({ why: 'Give us the vote!', w: 0.4 });
  // feeling unsafe (law-and-order people most)
  const crimes = g.data?.crimes ?? 0;
  if (crimes > 3) out.push({ why: 'Safe streets now!', w: Math.min(0.5, crimes / 40) * (0.5 + Math.max(0, compass(p).auth)) });
  const rulers = rulersPosition(ctx, g);
  if (rulers) {
    const d = distance(compass(p), rulers);
    if (d > 2) out.push({ why: compass(p).econ < rulers.econ ? 'Down with the bosses!' : 'Hands off our businesses!', w: 0.15 * (d - 2) + 0.1 });
  }
  return out;
}

/** Daily: grievances and recognition drift toward what people are living through. */
export function regimeDaily(ctx: Ctx): void {
  const byPolity = new Map<number, Person[]>();
  for (const p of ctx.s.people) {
    const g = polityOf(ctx, p);
    if (!g) continue;
    if (!byPolity.has(g.id)) byPolity.set(g.id, []);
    byPolity.get(g.id)!.push(p);
    const list = complaints(ctx, p, g);
    const target = clamp(list.reduce((s, c) => s + c.w, 0) * (0.6 + 0.6 * p.pol.engagement) - 0.3 * Math.max(0, p.happy - 0.5), 0, 3);
    p.pol.grievance += (target - p.pol.grievance) * 0.12;
    // recognition: how life goes, fairness, distance to the rulers, friends' views, temperament
    const g2 = g;
    const rulers = rulersPosition(ctx, g2);
    const dist = rulers ? distance(compass(p), rulers) : 0;
    const fair = g2.charter.suspendedUntil > ctx.s.tick || g2.charter.parties === 'single' || g2.charter.execBy === 'force' ? -0.25 * Math.max(0, stance(ctx, p, 'democracy')) : 0.08;
    let friends = 0, n = 0;
    for (const [id, r] of Object.entries(p.rel)) {
      if (r.trust < 0.45) continue;
      const q = ctx.byId.get(+id);
      if (q && q.pol.rec[g2.id] !== undefined) { friends += q.pol.rec[g2.id]; n++; }
      if (n >= 6) break;
    }
    let target2 = 0.55 + 0.3 * (p.happy - 0.5) - 0.18 * p.pol.grievance + 0.08 * compass(p).auth - 0.08 * Math.max(0, dist - 1) + fair;
    if (n) target2 = 0.7 * target2 + 0.3 * (friends / n);
    const cur = p.pol.rec[g2.id] ?? 0.6;
    p.pol.rec[g2.id] = clamp(cur + (target2 - cur) * 0.05, 0, 1);
  }
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    const people = byPolity.get(g.id) ?? residentsOf(ctx, g);
    g.legitimacy = people.length ? people.reduce((s, p) => s + (p.pol.rec[g.id] ?? 0.5), 0) / people.length : 0.5;
    maybeProtest(ctx, g, people);
    maybeCoup(ctx, g, people);
    resolveDualPower(ctx, g);
  }
  maybeIncorporate(ctx);
}

// ---------------------------------------------------------------- protests

function maybeProtest(ctx: Ctx, g: Polity, people: Person[]): void {
  if (people.length < 15) return;
  const angry = people.filter((p) => p.pol.grievance > 0.9);
  if (angry.length < Math.max(3, people.length * 0.06)) return;
  // already one coming up?
  if (ctx.s.events.some((e) => e.kind === 'protest' && e.polity === g.id && e.end > ctx.s.tick)) return;
  const leader = angry.slice().sort((a, b) => (b.pol.grievance + b.pol.engagement + b.traits.risk + b.traits.communication) - (a.pol.grievance + a.pol.engagement + a.traits.risk + a.traits.communication))[0];
  if (!leader || leader.traits.risk + leader.pol.engagement < 0.9 || !ctx.rng.chance(0.5)) return;
  const causes = new Map<string, number>();
  for (const p of angry) for (const c of complaints(ctx, p, g)) causes.set(c.why, (causes.get(c.why) ?? 0) + c.w);
  const cause = [...causes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Enough!';
  const place = ctx.s.buildings.find((b) => b.kind === 'plaza' && b.built && b.owner === g.firm) ?? govSite(ctx, g);
  if (!place) return;
  const start = dayStart(ctx.s.tick + MINUTES_PER_DAY) + 17 * 60;
  const ev: CivicEvent = {
    id: newId(ctx), kind: 'protest', polity: g.id, host: leader.id, speakers: [leader.id], place: place.id, start, end: start + 150,
    title: `Protest: "${cause}"`, attendees: [], lines: [], cause,
  };
  ctx.s.events.push(ev);
  leader.pol.protesting = ev.id;
  log(ctx, 'politics', `${leader.name} is calling a protest in ${g.short} tomorrow evening: "${cause}"`, { who: leader.id });
}

/**
 * Would this person go to a protest? Only if they're aggrieved and enough
 * of the people they know (or, from the news, enough people in general)
 * are going. Everyone has their own threshold.
 */
export function joinsProtest(ctx: Ctx, p: Person, ev: CivicEvent): boolean {
  if (p.pol.grievance < 0.55 || ev.kind !== 'protest') return false;
  if (ev.host === p.id) return true;
  const going = new Set(ev.attendees);
  let known = 0, joined = 0;
  for (const [id, r] of Object.entries(p.rel)) {
    if (r.fam < 2) continue;
    known++;
    const q = ctx.byId.get(+id);
    if (going.has(+id) || q?.pol.protesting === ev.id) joined++;
  }
  const g = ctx.gById.get(ev.polity);
  const pop = g ? Math.max(1, residentsOf(ctx, g).length) : 100;
  // the organizer asks their friends in person; the last protest's size (on the news) carries over
  const asked = (p.rel[ev.host]?.trust ?? 0) > 0.4 ? 0.25 : 0;
  const last = ctx.s.events.filter((e) => e.kind === 'protest' && e.polity === ev.polity && e.id !== ev.id && e.end < ctx.s.tick && ctx.s.tick - e.end < 6 * MINUTES_PER_DAY)
    .reduce((m, e) => Math.max(m, e.data?.peak ?? 0), 0);
  const visible = Math.max(known ? joined / known : 0, (ev.attendees.length / pop) * 4, last * 3) + asked; // news makes big crowds look bigger
  return visible >= p.pol.threshold * (1.2 - 0.4 * Math.min(1, p.pol.grievance / 2));
}

/** Hourly: protests that just ended are taken stock of: did it get big enough to bring the government down? */
export function protestsHourly(ctx: Ctx): void {
  for (const ev of ctx.s.events) {
    if (ev.kind !== 'protest' || ev.end > ctx.s.tick || ev.data?.done) continue;
    ev.data = { ...(ev.data ?? {}), done: 1 };
    const g = ctx.gById.get(ev.polity);
    if (!g || g.status === 'gone') continue;
    const people = residentsOf(ctx, g);
    const share = ev.attendees.length / Math.max(1, people.length);
    ev.data.peak = share;
    for (const id of ev.attendees) { const p = ctx.byId.get(id); if (p) p.pol.protesting = -1; }
    log(ctx, 'politics', `About ${ev.attendees.length} people (${(share * 100).toFixed(1)}%) protested in ${g.short}: "${ev.cause}".`);
    // the government may give a little ground, or crack down
    const head = ctx.byId.get(g.offices.find((o) => o.kind === 'exec')?.holder ?? -1);
    if (head && share > 0.02 && compass(head).auth > 1 && g.policy.police > 0) {
      for (const id of ev.attendees) { const p = ctx.byId.get(id); if (p) { p.pol.rec[g.id] = Math.max(0, (p.pol.rec[g.id] ?? 0.5) - 0.08); p.pol.grievance += 0.15; } }
      log(ctx, 'politics', `Police broke up the protest on ${head.name}'s orders.`);
    }
    // a revolution needs mass protest, low legitimacy and a police force that won't defend the government
    const recent = ctx.s.events.filter((e) => e.kind === 'protest' && e.polity === g.id && ctx.s.tick - e.end < 8 * MINUTES_PER_DAY && (e.data?.peak ?? 0) >= 0.025);
    const officers = policeOf(ctx, g);
    const defect = officers.length ? officers.filter((o) => (o.pol.rec[g.id] ?? 0.5) < 0.45 || o.pol.grievance > 0.8).length / officers.length : 1;
    if (share >= 0.035 && recent.length >= 2 && g.legitimacy < 0.4 && defect >= 0.3) revolution(ctx, g, ev, defect);
  }
}

function policeOf(ctx: Ctx, g: Polity): Person[] {
  return ctx.s.contracts.filter((c) => c.firm === g.firm && c.role === 'officer').map((c) => ctx.byId.get(c.person)).filter((p): p is Person => !!p);
}

// --------------------------------------------------------------- uprisings

/** What kind of government the people who brought the old one down set up: it follows their views. */
function revolutionaryCharter(crowd: Person[], old: Charter, ctx: Ctx): Charter {
  const econ = median(crowd.map((p) => compass(p).econ)), auth = median(crowd.map((p) => compass(p).auth));
  const dem = median(crowd.map((p) => stance(ctx, p, 'democracy')));
  const c = { ...defaultCharter(), seats: old.seats, districts: old.districts };
  if (econ < -1.1 && auth > 0.2) {
    Object.assign(c, { execTitle: 'Chairman', execBy: 'party', councilTitle: "People's Council", councilBy: 'party', parties: 'single', press: 'state', ownership: 'collective', amend: 'executive', franchise: 'members' });
  } else if (auth > 1.0 && dem < 0) {
    Object.assign(c, { execTitle: 'Leader', execBy: 'successor', execTerm: 0, councilTitle: 'Advisory Council', councilBy: 'appointed', parties: 'single', press: 'state', amend: 'executive' });
  } else {
    // a democratic revolution: elections soon, wider rights
    Object.assign(c, { franchise: 'residents', parties: 'free', press: 'free', method: econ < -0.5 ? 'list' : 'plurality', ownership: econ < -0.9 ? 'mixed' : 'private', amend: 'referendum', recall: true });
  }
  return c as Charter;
}

function revolution(ctx: Ctx, g: Polity, ev: CivicEvent, defect: number): void {
  const crowd = ev.attendees.map((id) => ctx.byId.get(id)).filter((p): p is Person => !!p);
  const leader = ctx.byId.get(ev.host) ?? crowd[0];
  if (!leader) return;
  const loyalists = residentsOf(ctx, g).filter((p) => (p.pol.rec[g.id] ?? 0) > 0.65).length / Math.max(1, residentsOf(ctx, g).length);
  const charter = revolutionaryCharter(crowd, g.charter, ctx);
  const oldName = g.name;
  const holders = g.offices.map((o) => o.holder);
  if (loyalists >= 0.2 && defect < 0.7) {
    // dual power: the old government holds on as a rival, the revolutionaries set up their own
    const rival = foundPolity(ctx, { name: `${g.short} Revolutionary Government`, short: g.short, cx: 0, cy: 0, radius: -1, charter, policy: { ...g.policy }, status: 'provisional', parent: g.id });
    rival.cells = g.cells.slice();
    g.status = 'rival';
    // the revolutionaries hold city hall and the treasury
    const admin = ctx.fById.get(g.firm)!, theirs = ctx.fById.get(rival.firm)!;
    theirs.cash += admin.cash * 0.7;
    admin.cash *= 0.3;
    rival.seat = g.seat;
    g.seat = -1;
    seat(ctx, rival, rival.offices.find((o) => o.kind === 'exec') ?? rival.offices[0], leader, leader.pol.party);
    for (const p of crowd) { p.pol.rec[rival.id] = 0.85; p.pol.rec[g.id] = Math.min(p.pol.rec[g.id] ?? 0.3, 0.2); }
    fillVacancies(ctx, rival, false);
    log(ctx, 'politics', `REVOLUTION: ${leader.name}'s movement seized city hall and set up a ${systemLabel(ctx, rival)}. The old government (${oldName}) refuses to step down; ${g.short} now has two governments.`, { who: leader.id });
    return;
  }
  // the old order collapses: the charter is rewritten and the offices change hands
  g.charter = charter;
  g.status = 'provisional';
  g.name = charter.ownership === 'collective' ? `${g.short} People's Commune` : charter.execBy === 'successor' ? `State of ${g.short}` : `Free City of ${g.short}`;
  for (const o of g.offices) { o.holder = -1; o.termEnd = -1; }
  rebuildOffices(ctx, g);
  const exec = g.offices.find((o) => o.kind === 'exec');
  if (exec) seat(ctx, g, exec, leader, leader.pol.party);
  for (const id of holders) { const p = ctx.byId.get(id); if (p) p.pol.grievance += 0.5; }
  fillVacancies(ctx, g, false);
  // democratic revolutions promise elections soon
  if (charter.councilBy === 'voters') for (const o of g.offices) if (o.kind === 'council' || o.kind === 'exec') o.termEnd = dayStart(ctx.s.tick + 14 * MINUTES_PER_DAY);
  g.label = systemLabel(ctx, g);
  for (const p of crowd) p.pol.grievance *= 0.4;
  log(ctx, 'politics', `REVOLUTION in ${g.short}: ${oldName} fell. ${leader.name} leads the new ${g.label}.`, { who: leader.id });
}

/** Rarely: the police chief (or another commander of armed people) tries to seize power. */
function maybeCoup(ctx: Ctx, g: Polity, people: Person[]): void {
  if (g.charter.execBy === 'force' || people.length < 30) return;
  const chiefO = g.offices.find((o) => o.kind === 'chief');
  const chief = ctx.byId.get(chiefO?.holder ?? -1);
  if (!chief) return;
  const jobless = people.filter((p) => p.job < 0 && !p.firms.length).length / people.length;
  let hazard = 0.01 / POLITICS.year; // ~1% per political year
  if (jobless > 0.25) hazard *= 2;
  if (g.legitimacy < 0.4) hazard *= 2;
  if (g.coups > 0) hazard *= 2.5;
  const ambition = chief.traits.ambition * chief.traits.risk * (1 - (chief.pol.rec[g.id] ?? 0.5)) * (0.5 + Math.max(0, compass(chief).auth));
  hazard *= ambition * 6;
  const prosperity = clamp(2 - people.reduce((s, p) => s + p.happy, 0) / people.length / 0.6, 0.2, 2);
  if (!ctx.rng.chance(hazard * prosperity)) return;
  // a coordination game: officers follow the chief if they trust them more than they accept the government
  const officers = policeOf(ctx, g).filter((o) => o !== chief);
  const follow = officers.filter((o) => (o.rel[chief.id]?.trust ?? 0.2) > (o.pol.rec[g.id] ?? 0.5) * 0.8).length + 1;
  const resist = officers.length + 1 - follow + (g.legitimacy > 0.6 ? 2 : 0);
  g.coups++;
  if (follow <= resist) {
    if (chiefO) chiefO.holder = -1;
    const c = ctx.s.contracts.find((x) => x.person === chief.id && x.firm === g.firm);
    if (c) { ctx.s.contracts = ctx.s.contracts.filter((x) => x !== c); ctx.cById.delete(c.id); chief.job = -1; }
    log(ctx, 'politics', `A coup attempt by police chief ${chief.name} in ${g.short} failed; the officers stayed loyal. ${chief.name} was dismissed.`, { who: chief.id });
    return;
  }
  const oldLabel = g.label;
  Object.assign(g.charter, { execTitle: 'Commander', execBy: 'force', execTerm: 0, councilBy: 'none', press: 'state', suspendedUntil: ctx.s.tick + 2 * POLITICS.year * MINUTES_PER_DAY, amend: 'executive' });
  rebuildOffices(ctx, g);
  for (const o of g.offices) if (o.kind === 'council') o.holder = -1;
  const exec = g.offices.find((o) => o.kind === 'exec');
  if (exec) seat(ctx, g, exec, chief, -1);
  g.label = systemLabel(ctx, g);
  for (const p of people) p.pol.rec[g.id] = (p.pol.rec[g.id] ?? 0.5) * (0.8 + 0.3 * Math.max(0, compass(p).auth) / 2);
  log(ctx, 'politics', `COUP in ${g.short}: police chief ${chief.name} seized power, dissolved the ${g.charter.councilTitle.toLowerCase()} and promised elections "within ${2 * POLITICS.year} days". (was: ${oldLabel})`, { who: chief.id });
}

/** Two governments claiming the same ground: the one most people (and officers) obey for long enough wins. */
function resolveDualPower(ctx: Ctx, g: Polity): void {
  if (g.status !== 'rival' && g.status !== 'provisional') return;
  const other = ctx.s.polities.find((o) => o !== g && o.status !== 'gone' && o.cells.some((c) => g.cells.includes(c)));
  if (!other) {
    if (g.status === 'provisional' && g.offices.some((o) => o.holder >= 0)) g.status = 'active';
    return;
  }
  const people = residentsOf(ctx, g).concat(residentsOf(ctx, other));
  if (!people.length) return;
  const backG = people.filter((p) => (p.pol.rec[g.id] ?? 0) > (p.pol.rec[other.id] ?? 0)).length / people.length;
  g.data ??= {};
  g.data.lead = backG > 0.7 ? (g.data.lead ?? 0) + 1 : 0;
  if ((g.data.lead ?? 0) >= 15) {
    other.status = 'gone';
    ctx.fById.get(g.firm)!.cash += ctx.fById.get(other.firm)?.cash ?? 0;
    const f = ctx.fById.get(other.firm);
    if (f) f.cash = 0;
    if (g.status === 'provisional' || g.status === 'rival') g.status = 'active';
    log(ctx, 'politics', `${other.name} gave up; ${g.name} is now the only government of ${g.short}.`);
  }
}

// ------------------------------------------------------------- new towns

/**
 * People living well outside any government's claim eventually set up their
 * own town (incorporation): a founding meeting with the residents there.
 */
function maybeIncorporate(ctx: Ctx): void {
  if (!ctx.rng.chance(0.1)) return;
  const outside = ctx.s.people.filter((p) => { const h = ctx.bById.get(p.home); return h && !polityAt(ctx, h.x, h.y); });
  if (outside.length < 12) return;
  // the densest cluster of homes out there
  let best: { x: number; y: number; n: number } | null = null;
  for (const p of outside.slice(0, 60)) {
    const h = ctx.bById.get(p.home)!;
    const n = outside.filter((q) => { const hq = ctx.bById.get(q.home)!; return Math.hypot(hq.x - h.x, hq.y - h.y) < 220; }).length;
    if (!best || n > best.n) best = { x: h.x, y: h.y, n };
  }
  if (!best || best.n < 12) return;
  const founders = outside.filter((q) => { const hq = ctx.bById.get(q.home)!; return Math.hypot(hq.x - best!.x, hq.y - best!.y) < 220; });
  const name = cityName(ctx.rng);
  const charter = foundingCharter(ctx, founders);
  const g = foundPolity(ctx, { name: `Town of ${name}`, short: name, cx: best.x, cy: best.y, radius: 240, charter: charter.charter, policy: charter.policy });
  // don't claim ground another government already holds
  const held = new Set(ctx.s.polities.filter((o) => o !== g && o.status !== 'gone').flatMap((o) => o.cells));
  g.cells = g.cells.filter((c) => !held.has(c));
  for (const l of ctx.s.roads.lots) if (l.owner === g.firm && held.has(cellOf(l.x, l.y))) l.owner = -3;
  for (const p of founders) p.pol.rec[g.id] = 0.8;
  instantElection(ctx, g, founders, g.offices.filter((o) => o.kind === 'exec' || o.kind === 'council').map((o) => o.id));
  log(ctx, 'politics', `${founders.length} people living outside the city limits founded their own town: ${g.name} (${g.label}).`);
}

/** The rules a group of founders agrees on: for each choice, what the median founder wants. */
export function foundingCharter(ctx: Ctx, founders: Person[]): { charter: Charter; policy: ReturnType<typeof defaultPolicy>; votes: string[] } {
  const charter = defaultCharter();
  const policy = defaultPolicy();
  const E = median(founders.map((p) => compass(p).econ));
  const A = median(founders.map((p) => compass(p).auth));
  const m = (issue: Parameters<typeof stance>[2]) => median(founders.map((p) => stance(ctx, p, issue)));
  const votes: string[] = [];
  const share = (pred: (p: Person) => boolean) => founders.filter(pred).length;
  // the form of government
  if (A > 0.25) {
    charter.execBy = 'voters'; charter.veto = A > 0.6; charter.execTitle = 'Mayor';
    votes.push(`an elected mayor${charter.veto ? ' with a veto' : ''} (${share((p) => compass(p).auth > 0)} of ${founders.length} favored a strong executive)`);
  } else if (A < -0.55 && founders.length < 80) {
    charter.execBy = 'council'; charter.councilBy = 'all'; charter.execTitle = 'Moderator';
    votes.push(`a town meeting of all citizens (${share((p) => compass(p).auth < -0.3)} of ${founders.length} wanted direct democracy)`);
  } else {
    charter.execBy = 'council'; charter.execTitle = 'City Manager';
    votes.push('a council that hires a professional city manager');
  }
  if (E > 0.6) { charter.franchise = 'owners'; votes.push(`only property owners may vote (${share((p) => compass(p).econ > 0.4)} for, ${share((p) => compass(p).econ <= 0.4)} against)`); }
  if (E < -0.6) charter.method = 'list';
  if (A < 0) { charter.amend = 'referendum'; charter.recall = true; } else { charter.amend = 'supermajority'; charter.recall = A < 0.5; }
  charter.initiative = A < 0.3 ? 0.1 : 0;
  if (E < -1.1) { charter.ownership = 'mixed'; votes.push('public ownership of key industries'); }
  // money
  const taxes = m('taxes'), welfare = m('welfare'), order = m('order'), housing = m('housing');
  policy.propertyTax = Math.max(0.004, Math.round((0.015 + 0.01 * taxes) * 1000) / 1000);
  policy.incomeTax = Math.max(0.01, Math.round((0.06 + 0.04 * taxes) * 1000) / 1000);
  policy.salesTax = Math.max(0.005, Math.round((0.03 + 0.015 * taxes) * 1000) / 1000);
  policy.welfare = Math.max(0, Math.round(2 + 3 * welfare));
  policy.police = order > 0.2 ? 2 : 1;
  policy.landPrice = E < -0.5 ? 0.4 : E > 0.5 ? 1.2 : 0.8;
  if (housing > 0.4) policy.rentCap = 0; // decided later, once there are rents
  votes.push(`property tax ${(policy.propertyTax * 100).toFixed(1)}%/yr, income tax ${(policy.incomeTax * 100).toFixed(1)}%, sales tax ${(policy.salesTax * 100).toFixed(1)}%, welfare ${policy.welfare}/day`);
  // who pays the doctor: the founders' views on welfare and the economy
  policy.healthcare = welfare > 0.35 && E < -0.2 ? 'public' : welfare < -0.25 || E > 0.45 ? 'private' : 'subsidized';
  votes.push(policy.healthcare === 'public' ? 'free healthcare, paid by the city' : policy.healthcare === 'subsidized' ? 'the city pays half of doctor and hospital bills' : 'patients pay for their own healthcare');
  return { charter, policy, votes };
}

export { rulingParty, hourOf };
