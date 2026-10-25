// Elections: who may vote, districts, candidates, campaigns, election day,
// counting, and taking office. The rules all come from the government's
// charter (and can be changed by it). See docs/research/politics.md §3–4.
//
// Turnout and vote choice follow the research:
// - Turnout rises with age, wealth, owning a home, having voted before,
//   being asked by a campaign, and how engaged someone is.
// - Vote choice weighs ideological distance, party, the incumbent's record
//   (as the voter has lived it), name recognition from ads and coverage,
//   charisma, and personal ties, plus noise.
// Campaigns persuade little but mobilize; debates move few votes.

import { MINUTES_PER_DAY, POLITICS } from './config';
import { dayStart, hourOf, log, newId, pay, type Ctx } from './ctx';
import { ageOf, compass, distance, stance } from './ideology';
import { campaignSlogan, partyName } from './names';
import { cellCenter, cellOf, govSite, polityOf, residentsOf } from './government';
import type { Candidate, Election, ElectionResult, Motion, Office, Party, Person, Polity } from './types';

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// ------------------------------------------------------------------ voters

/** Can this person vote in this government's elections? */
export function canVote(ctx: Ctx, g: Polity, p: Person): boolean {
  if (ageOf(ctx, p) < 18) return false;
  const c = g.charter;
  if (c.franchise === 'everyone') return polityOf(ctx, p) === g;
  if (polityOf(ctx, p) !== g) return false;
  if (ctx.s.tick - p.arrived < c.residency * MINUTES_PER_DAY) return false;
  if (c.franchise === 'owners') return ownsPropertyIn(ctx, g, p);
  if (c.franchise === 'members') {
    const ruling = rulingParty(ctx, g);
    return !!ruling && p.pol.party === ruling.id;
  }
  return true;
}

function ownsPropertyIn(ctx: Ctx, g: Polity, p: Person): boolean {
  const cells = new Set(g.cells);
  for (const id of p.owned) {
    const b = ctx.bById.get(id);
    if (b && cells.has(cellOf(b.x, b.y))) return true;
  }
  for (const fid of p.firms) {
    const f = ctx.fById.get(fid);
    if (f?.sites.some((s) => { const b = ctx.bById.get(s); return b && cells.has(cellOf(b.x, b.y)); })) return true;
  }
  return false;
}

export function voters(ctx: Ctx, g: Polity): Person[] {
  return ctx.s.people.filter((p) => canVote(ctx, g, p));
}

/** The party holding most offices (or the only legal one). */
export function rulingParty(ctx: Ctx, g: Polity): Party | undefined {
  const count = new Map<number, number>();
  for (const o of g.offices) if (o.party >= 0 && o.holder >= 0) count.set(o.party, (count.get(o.party) ?? 0) + (o.kind === 'exec' ? 2 : 1));
  let best: number | undefined, n = 0;
  for (const [id, k] of count) if (k > n) { n = k; best = id; }
  return best !== undefined ? ctx.partyById.get(best) : undefined;
}

// --------------------------------------------------------------- districts

/** Which district a voter is in (-1: elected at-large). */
export function districtOf(ctx: Ctx, g: Polity, p: Person): number {
  if (!g.districts.length) return -1;
  const h = ctx.bById.get(p.home);
  const cell = h ? cellOf(h.x, h.y) : cellOf(p.x, p.y);
  return g.districts.findIndex((d) => d.includes(cell));
}

/**
 * Redraw districts of about equal population by recursive bisection along a
 * direction. A partisan drawer tries several directions and keeps the map
 * that gives its party the most seats (packing and cracking); a commission
 * keeps the most compact one.
 */
export function redistrict(ctx: Ctx, g: Polity, drawer?: Person): void {
  const k = g.charter.districts;
  if (k <= 0) { g.districts = []; return; }
  const pop = new Map<number, number>();
  const lean = new Map<number, number>(); // per cell: net support for the drawer's party/side
  const side = drawer ? compass(drawer) : null;
  for (const p of residentsOf(ctx, g)) {
    const h = ctx.bById.get(p.home);
    const c = h ? cellOf(h.x, h.y) : cellOf(p.x, p.y);
    pop.set(c, (pop.get(c) ?? 0) + 1);
    if (side) lean.set(c, (lean.get(c) ?? 0) + (distance(compass(p), side) < 1.1 ? 1 : -1));
  }
  const cells = g.cells.filter((c) => (pop.get(c) ?? 0) > 0);
  if (cells.length < k) { g.districts = []; return; }
  const partisan = !!drawer && g.charter.redistrict !== 'commission' && drawer.pol.auth + drawer.traits.ambition > 0.9;
  let best: number[][] | null = null, bestScore = -Infinity;
  for (let attempt = 0; attempt < (partisan ? 12 : 4); attempt++) {
    const ang = attempt * (Math.PI / (partisan ? 12 : 4)) + (partisan ? ctx.rng.next() * 0.2 : 0);
    const parts = bisect(cells, pop, k, ang);
    let score: number;
    if (partisan) {
      score = parts.reduce((s, d) => s + (d.reduce((a, c) => a + (lean.get(c) ?? 0), 0) > 0 ? 1 : 0), 0);
    } else {
      // compactness: small spread of cells around each district's center
      score = -parts.reduce((s, d) => s + spread(d), 0);
    }
    if (score > bestScore) { bestScore = score; best = parts; }
  }
  // empty cells go to the nearest district
  const out = best!.map((d) => d.slice());
  const centers = out.map((d) => { const pts = d.map(cellCenter); return [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length]; });
  for (const c of g.cells) {
    if ((pop.get(c) ?? 0) > 0) continue;
    const [x, y] = cellCenter(c);
    let bi = 0, bd = Infinity;
    centers.forEach(([cx, cy], i) => { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; bi = i; } });
    out[bi].push(c);
  }
  g.districts = out;
  log(ctx, 'politics', `${g.name} redrew its ${k} electoral districts${partisan && drawer ? ` (drawn by ${drawer.name}'s side)` : ''}.`);
}

function spread(d: number[]): number {
  const pts = d.map(cellCenter);
  const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
  return pts.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / pts.length;
}

function bisect(cells: number[], pop: Map<number, number>, k: number, ang: number): number[][] {
  if (k <= 1 || cells.length <= 1) return [cells];
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const sorted = cells.slice().sort((a, b) => { const [ax, ay] = cellCenter(a), [bx, by] = cellCenter(b); return ax * ux + ay * uy - (bx * ux + by * uy); });
  const total = sorted.reduce((s, c) => s + (pop.get(c) ?? 0), 0);
  const kl = Math.floor(k / 2);
  const target = (total * kl) / k;
  let acc = 0, cut = 0;
  for (; cut < sorted.length - 1; cut++) { acc += pop.get(sorted[cut]) ?? 0; if (acc >= target) break; }
  const left = sorted.slice(0, cut + 1), right = sorted.slice(cut + 1);
  return [...bisect(left, pop, kl, ang + Math.PI / 2), ...bisect(right, pop, k - kl, ang + Math.PI / 2)];
}

// --------------------------------------------------------------- candidates

/** How strongly someone wants to run for an office. */
function ambitionToRun(ctx: Ctx, p: Person, o: Office): number {
  const t = p.traits;
  const money = Math.log10(10 + Math.max(0, p.money));
  return 0.5 * t.ambition + 0.4 * p.pol.engagement + 0.25 * t.communication + 0.1 * money + 0.15 * t.risk
    + (o.holder === p.id ? 0.6 : 0) + (o.kind === 'exec' ? 0.1 * t.ambition : 0) + ctx.rng.next() * 0.15;
}

/** What a candidate says they stand for: their own views, nudged toward the voters by ambitious ones. */
function statedPosition(ctx: Ctx, g: Polity, p: Person): { econ: number; auth: number } {
  const own = compass(p);
  const vs = residentsOf(ctx, g);
  if (!vs.length) return own;
  const med = { econ: median(vs.map((v) => compass(v).econ)), auth: median(vs.map((v) => compass(v).auth)) };
  const k = 0.3 * p.traits.ambition;
  return { econ: own.econ + (med.econ - own.econ) * k, auth: own.auth + (med.auth - own.auth) * k };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function makeCandidate(ctx: Ctx, g: Polity, p: Person, o: Office): Candidate {
  const pos = statedPosition(ctx, g, p);
  return { person: p.id, office: o.id, party: p.pol.party, econ: pos.econ, auth: pos.auth, funds: 0, spent: 0, slogan: campaignSlogan(ctx.rng), votes: 0, withdrawn: false };
}

/** Who stands for each office up for election. Parties put forward one candidate each; independents run too. */
function nominate(ctx: Ctx, g: Polity, e: Election, pool: Person[]): void {
  const taken = new Set<number>();
  const single = g.charter.parties === 'single' ? rulingParty(ctx, g) : undefined;
  for (const oid of e.offices) {
    const o = g.offices.find((x) => x.id === oid);
    if (!o) continue;
    const local = o.district >= 0 && g.districts.length ? pool.filter((p) => districtOf(ctx, g, p) === Math.floor(o.district / 100)) : pool;
    const ranked = local.filter((p) => !taken.has(p.id)).map((p) => ({ p, w: ambitionToRun(ctx, p, o) })).sort((a, b) => b.w - a.w);
    const out: Person[] = [];
    // one per party (its most eager member), then independents above a bar
    const parties = new Set<number>();
    for (const { p, w } of ranked) {
      if (out.length >= 4) break;
      const party = p.pol.party;
      if (single && party !== single.id) continue; // only the ruling party may stand
      if (party >= 0 && ctx.partyById.get(party)?.banned) continue;
      if (party >= 0) {
        if (parties.has(party)) continue;
        parties.add(party);
        out.push(p);
      } else if (w > 0.95 || out.length < 2) out.push(p);
    }
    if (!out.length && ranked[0]) out.push(ranked[0].p);
    for (const p of out) { taken.add(p.id); e.candidates.push(makeCandidate(ctx, g, p, o)); }
  }
}

// ---------------------------------------------------------------- the vote

/** Will this person vote (decided once per election)? */
export function willVote(ctx: Ctx, _g: Polity, p: Person, e: Election): boolean {
  const age = ageOf(ctx, p);
  const owner = ctx.bById.get(p.home)?.owner === p.id;
  const tenure = Math.min(2, (ctx.s.tick - p.arrived) / (POLITICS.year * MINUTES_PER_DAY));
  const wealth = Math.log10(10 + Math.max(0, p.money)) - 2;
  const contacted = ctx.s.tick - p.pol.contacted < 7 * MINUTES_PER_DAY ? 1 : 0;
  const votedLast = p.pol.voted > 0 && ctx.s.tick - p.pol.voted < 3 * POLITICS.year * MINUTES_PER_DAY ? 1 : 0;
  const stakes = e.kind === 'referendum' || e.kind === 'founding' ? 0.5 : 0;
  const x = -1.7 + 0.04 * (age - 40) + 0.4 * wealth + 0.6 * (owner ? 1 : 0) + 0.3 * tenure + 0.8 * votedLast + 0.6 * contacted
    + 2.2 * (p.pol.engagement - 0.3) + 0.6 * p.pol.grievance + stakes + 0.4 * (p.traits.diligence - 0.5);
  return ctx.rng.chance(sigmoid(x));
}

/** How a voter rates a candidate (higher = more likely to vote for them). Without noise: what a pollster would expect. */
export function utility(ctx: Ctx, g: Polity, v: Person, c: Candidate, noise = true): number {
  const cand = ctx.byId.get(c.person);
  if (!cand) return -Infinity;
  const me = compass(v);
  let u = -1.0 * distance(me, { econ: c.econ, auth: c.auth });
  if (c.party >= 0 && c.party === v.pol.partyId) u += 1.5 * v.pol.partyStrength;
  // the incumbent's record, as this voter lived it
  const office = g.offices.find((o) => o.id === c.office);
  if (office && office.holder === c.person) {
    const retro = (v.happy - 0.5) * 2 - (v.job < 0 && !v.firms.length ? 0.5 : 0) - v.pol.grievance;
    u += 0.8 * retro + 0.3; // plus the plain advantage of being known and in office
  }
  u += 0.3 * Math.log(1 + 10 * (v.pol.aware[c.person] ?? 0));
  // what attack ads against them left behind
  u -= 1.2 * (v.pol.neg?.[c.person] ?? 0);
  u += 0.3 * (cand.traits.communication - 0.5);
  const r = v.rel[c.person];
  if (r) u += 0.8 * r.trust - 0.4 * r.bad;
  if (cand.id === v.id) u += 5;
  // a Gumbel shock makes this a logit choice
  return noise ? u - Math.log(-Math.log(Math.max(1e-9, ctx.rng.next()))) : u;
}

/**
 * An opinion poll: the share each candidate for an office would get among a
 * sample of voters (logit shares from their expected ratings, no randomness).
 */
export function poll(ctx: Ctx, e: Election, officeId: number, sample = 80): { person: number; share: number }[] {
  const g = ctx.gById.get(e.polity);
  if (!g) return [];
  const cands = e.candidates.filter((c) => !c.withdrawn && c.office === officeId);
  if (!cands.length) return [];
  const vs = voters(ctx, g);
  const step = Math.max(1, Math.floor(vs.length / sample));
  const shares = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < vs.length; i += step) {
    const us = cands.map((c) => Math.exp(utility(ctx, g, vs[i], c, false)));
    const sum = us.reduce((a, b) => a + b, 0) || 1;
    cands.forEach((c, k) => shares.set(c.person, (shares.get(c.person) ?? 0) + us[k] / sum));
    n++;
  }
  return cands.map((c) => ({ person: c.person, share: (shares.get(c.person) ?? 0) / Math.max(1, n) })).sort((a, b) => b.share - a.share);
}

/** A voter fills in their ballot (one choice per office they can vote on). */
export function castBallot(ctx: Ctx, e: Election, v: Person): void {
  const g = ctx.gById.get(e.polity);
  if (!g || e.voters.includes(v.id)) return;
  e.voters.push(v.id);
  v.pol.voted = ctx.s.tick;
  if (e.kind === 'referendum' && e.motion) {
    const yes = motionSupport(ctx, v, e.motion) > 0;
    if (yes) e.yes = (e.yes ?? 0) + 1; else e.no = (e.no ?? 0) + 1;
    return;
  }
  const d = districtOf(ctx, g, v);
  const byOffice = new Map<number, Candidate[]>();
  for (const c of e.candidates) {
    if (c.withdrawn) continue;
    const o = g.offices.find((x) => x.id === c.office);
    if (!o) continue;
    if (o.kind === 'council' && o.district >= 0 && Math.floor(o.district / 100) !== d) continue;
    if (!byOffice.has(o.id)) byOffice.set(o.id, []);
    byOffice.get(o.id)!.push(c);
  }
  // at-large seats: each voter gets as many votes as seats (plurality-at-large), spent on their favorites
  const atLarge = [...byOffice.entries()].filter(([oid]) => (g.offices.find((x) => x.id === oid)?.district ?? 0) < 0 && g.offices.find((x) => x.id === oid)?.kind === 'council');
  const pooled = atLarge.flatMap(([, cs]) => cs);
  if (pooled.length) {
    const seats = atLarge.length;
    const ranked = pooled.map((c) => ({ c, u: utility(ctx, g, v, c) })).sort((a, b) => b.u - a.u).slice(0, seats);
    for (const { c } of ranked) e.ballots[c.person] = (e.ballots[c.person] ?? 0) + 1;
  }
  let last: Candidate | undefined;
  for (const [oid, cs] of byOffice) {
    const o = g.offices.find((x) => x.id === oid)!;
    if (o.kind === 'council' && o.district < 0) continue;
    const best = cs.reduce((a, c) => { const uc = utility(ctx, g, v, c); return uc > a.u ? { c, u: uc } : a; }, { c: cs[0], u: -Infinity });
    e.ballots[best.c.person] = (e.ballots[best.c.person] ?? 0) + 1;
    if (o.kind === 'exec') last = best.c;
  }
  // party identification forms after voting for the same side twice
  const chosen = last ?? pooled[0];
  if (chosen) {
    if (chosen.party >= 0 && chosen.party === ctx.byId.get(v.pol.votedFor)?.pol.party) v.pol.sameSide++;
    else v.pol.sameSide = chosen.party >= 0 ? 1 : 0;
    v.pol.votedFor = chosen.person;
    if (v.pol.sameSide >= 2 && chosen.party >= 0) { v.pol.partyId = chosen.party; v.pol.partyStrength = Math.min(1, v.pol.partyStrength + 0.25); }
  }
}

/** How much someone supports a motion (used for referendums, and by officials). -1..1-ish. */
export function motionSupport(ctx: Ctx, p: Person, m: Motion): number {
  const dir = typeof m.value === 'number' && m.field ? 1 : 1;
  switch (m.kind) {
    case 'tax': return -stance(ctx, p, 'taxes') * (Number(m.value) > 0 ? -1 : 1) * dir;
    case 'welfare': return stance(ctx, p, 'welfare') * Math.sign(Number(m.value) || 1);
    case 'rentcap': return stance(ctx, p, 'housing') * (Number(m.value) > 0 ? 1 : -1);
    case 'ownership': case 'nationalize': return stance(ctx, p, 'ownership');
    case 'privatize': return -stance(ctx, p, 'ownership');
    case 'police': return stance(ctx, p, 'order') * Math.sign(Number(m.value) || 1);
    case 'suspend': case 'ban': case 'press': case 'life': return -stance(ctx, p, 'democracy');
    case 'pave': case 'layout': return stance(ctx, p, m.kind === 'layout' ? 'growth' : 'roads');
    default: return stance(ctx, p, 'democracy') * 0.2;
  }
}

// ------------------------------------------------------------- scheduling

/** Offices filled by a vote of the people. */
export function electedOffices(g: Polity): Office[] {
  const c = g.charter;
  return g.offices.filter((o) => (o.kind === 'exec' && c.execBy === 'voters') || (o.kind === 'council' && c.councilBy === 'voters'));
}

/** Daily: open campaigns, run election day, count the votes. */
export function electionsDaily(ctx: Ctx): void {
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    const due = electedOffices(g).filter((o) => o.termEnd >= 0);
    if (!due.length) { g.nextElection = -1; continue; }
    const nextEnd = Math.min(...due.map((o) => o.termEnd));
    const day = dayStart(nextEnd) + POLITICS.pollsOpen * 60;
    if (g.charter.suspendedUntil > ctx.s.tick) {
      // postponed: terms simply run on
      if (nextEnd <= ctx.s.tick + MINUTES_PER_DAY) for (const o of due) if (o.termEnd <= ctx.s.tick + MINUTES_PER_DAY) o.termEnd = g.charter.suspendedUntil + MINUTES_PER_DAY;
      g.nextElection = -1;
      continue;
    }
    g.nextElection = day;
    const open = ctx.s.elections.find((e) => e.polity === g.id && e.status !== 'done' && e.status !== 'cancelled' && e.kind !== 'referendum');
    if (!open && ctx.s.tick >= day - POLITICS.campaignDays * MINUTES_PER_DAY) {
      const e = newElection(ctx, g, 'general', day, due.filter((o) => o.termEnd <= day + MINUTES_PER_DAY).map((o) => o.id));
      nominate(ctx, g, e, voters(ctx, g));
      const names = e.candidates.map((c) => ctx.byId.get(c.person)?.name).filter(Boolean);
      log(ctx, 'politics', `The campaign for ${g.short}'s election on day ${Math.floor(day / MINUTES_PER_DAY) + 1} has begun: ${names.length} candidates (${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}).`);
    }
  }
  for (const e of ctx.s.elections) if (e.status === 'campaign' && ctx.s.tick >= e.day - 60) e.status = 'voting';
  // keep a few finished ones for the UI
  const done = ctx.s.elections.filter((e) => e.status === 'done' || e.status === 'cancelled');
  if (done.length > 12) ctx.s.elections = ctx.s.elections.filter((e) => !done.slice(0, done.length - 12).includes(e));
}

export function newElection(ctx: Ctx, g: Polity, kind: Election['kind'], day: number, offices: number[], motion?: Motion): Election {
  const e: Election = {
    id: newId(ctx), polity: g.id, kind, day, offices, candidates: [], motion, status: 'campaign', results: [], turnout: 0,
    eligible: 0, ballots: {}, voters: [], fair: true,
  };
  if (kind === 'referendum') { e.yes = 0; e.no = 0; }
  ctx.s.elections.push(e);
  return e;
}

/** Hourly: polls open and close; votes are counted at closing time. */
export function electionsHourly(ctx: Ctx): void {
  const h = hourOf(ctx.s.tick);
  for (const e of ctx.s.elections) {
    if (e.status === 'campaign' && ctx.s.tick >= e.day) e.status = 'voting';
    if (e.status === 'voting' && h >= POLITICS.pollsClose && ctx.s.tick >= e.day) count(ctx, e);
  }
}

/** Is there an election someone could go and vote in right now? */
export function openElectionFor(ctx: Ctx, p: Person): Election | undefined {
  const h = hourOf(ctx.s.tick);
  if (h < POLITICS.pollsOpen || h >= POLITICS.pollsClose) return undefined;
  for (const e of ctx.s.elections) {
    if (e.status !== 'voting' || e.voters.includes(p.id)) continue;
    const g = ctx.gById.get(e.polity);
    if (g && canVote(ctx, g, p)) return e;
  }
  return undefined;
}

export function pollingPlace(ctx: Ctx, e: Election) {
  const g = ctx.gById.get(e.polity);
  return g ? govSite(ctx, g) : undefined;
}

/** Count the votes and seat the winners. */
export function count(ctx: Ctx, e: Election): void {
  const g = ctx.gById.get(e.polity);
  e.status = 'done';
  if (!g) return;
  const vs = e.kind === 'founding' ? e.voters.map((id) => ctx.byId.get(id)).filter((p): p is Person => !!p) : voters(ctx, g);
  e.eligible = vs.length;
  e.turnout = e.voters.length / Math.max(1, vs.length);
  if (e.kind === 'referendum') {
    const passed = (e.yes ?? 0) > (e.no ?? 0);
    log(ctx, 'politics', `Referendum in ${g.short} — "${e.motion?.title}": ${passed ? 'passed' : 'rejected'} ${e.yes}–${e.no} (turnout ${(e.turnout * 100).toFixed(0)}%).`);
    if (passed && e.motion) referendumHooks.apply(ctx, g, e.motion, `referendum ${e.yes}–${e.no}`);
    return;
  }
  for (const c of e.candidates) c.votes = e.ballots[c.person] ?? 0;
  const results: ElectionResult[] = [];
  const offices = e.offices.map((id) => g.offices.find((o) => o.id === id)).filter((o): o is Office => !!o);
  // party lists: council seats in proportion to party votes (D'Hondt)
  if (g.charter.method === 'list' && g.charter.parties !== 'none') {
    const seats = offices.filter((o) => o.kind === 'council');
    const partyVotes = new Map<number, number>();
    for (const c of e.candidates) if (c.party >= 0) partyVotes.set(c.party, (partyVotes.get(c.party) ?? 0) + c.votes);
    const won = new Map<number, number>();
    for (let k = 0; k < seats.length; k++) {
      let best = -1, q = -1;
      for (const [pid, v] of partyVotes) { const qq = v / ((won.get(pid) ?? 0) + 1); if (qq > q) { q = qq; best = pid; } }
      if (best < 0) break;
      won.set(best, (won.get(best) ?? 0) + 1);
    }
    const lists = new Map<number, Person[]>();
    for (const [pid] of won) lists.set(pid, (ctx.partyById.get(pid)?.members ?? []).map((id) => ctx.byId.get(id)!).filter(Boolean)
      .sort((a, b) => (e.ballots[b.id] ?? 0) - (e.ballots[a.id] ?? 0) || b.pol.engagement - a.pol.engagement));
    let i = 0;
    for (const [pid, n] of won) for (let k = 0; k < n && i < seats.length; k++) {
      const who = lists.get(pid)?.[k];
      if (who) seat(ctx, g, seats[i++], who, pid);
    }
    results.push({ office: -1, district: -1, tallies: Object.fromEntries([...partyVotes].map(([pid, v]) => [pid, v])), winners: [], eligible: vs.length });
  }
  for (const o of offices) {
    if (g.charter.method === 'list' && o.kind === 'council' && g.charter.parties !== 'none') continue;
    const cands = e.candidates.filter((c) => c.office === o.id && !c.withdrawn);
    const atLarge = o.kind === 'council' && o.district < 0;
    // nobody holds two seats: those sitting in offices not up for election can't win another
    const sitting = new Set(g.offices.filter((x) => !e.offices.includes(x.id) && x.holder >= 0).map((x) => x.holder));
    let pool = atLarge ? e.candidates.filter((c) => !c.withdrawn && (g.offices.find((x) => x.id === c.office)?.district ?? 0) < 0 && g.offices.find((x) => x.id === c.office)?.kind === 'council') : cands;
    // at-large: the top vote-getters fill the seats in order
    pool = pool.filter((c) => !sitting.has(c.person) && !results.some((r) => r.winners.includes(c.person)));
    const sorted = pool.slice().sort((a, b) => b.votes - a.votes);
    const total = sorted.reduce((s, c) => s + c.votes, 0);
    const win = sorted[0];
    if (!win) continue;
    // a runoff for executives elected by majority
    if (o.kind === 'exec' && g.charter.method === 'runoff' && sorted[1] && win.votes < total / 2 && e.kind === 'general') {
      const r = newElection(ctx, g, 'runoff', dayStart(ctx.s.tick) + 7 * MINUTES_PER_DAY + POLITICS.pollsOpen * 60, [o.id]);
      r.candidates = [{ ...win, votes: 0 }, { ...sorted[1], votes: 0 }];
      log(ctx, 'politics', `No one won a majority for ${o.title}; ${ctx.byId.get(win.person)?.name} and ${ctx.byId.get(sorted[1].person)?.name} face a runoff in a week.`);
      results.push({ office: o.id, district: o.district, tallies: Object.fromEntries(sorted.map((c) => [c.person, c.votes])), winners: [], eligible: vs.length });
      continue;
    }
    const who = ctx.byId.get(win.person);
    if (who) seat(ctx, g, o, who, win.party);
    results.push({ office: o.id, district: o.district, tallies: Object.fromEntries(sorted.map((c) => [c.person, c.votes])), winners: [win.person], eligible: vs.length });
  }
  e.results = results;
  const winners = [...new Set(offices.map((o) => o.holder))].map((id) => ctx.byId.get(id)?.name).filter(Boolean);
  log(ctx, 'politics', `${g.short} voted (turnout ${(e.turnout * 100).toFixed(0)}% of ${vs.length}). In office now: ${winners.join(', ')}.`);
  electionHooks.onCounted(ctx, g, e);
}

/** Put someone in an office for a new term. */
export function seat(ctx: Ctx, g: Polity, o: Office, p: Person, party: number): void {
  const again = o.holder === p.id;
  o.terms = again ? o.terms + 1 : 1;
  o.holder = p.id;
  o.party = party;
  if (!again) o.since = ctx.s.tick;
  const term = o.kind === 'exec' ? g.charter.execTerm : g.charter.councilTerm;
  o.termEnd = (o.kind === 'exec' && g.charter.execBy !== 'voters') || (o.kind === 'council' && g.charter.councilBy !== 'voters') || term <= 0
    ? -1 : dayStart(ctx.s.tick + term * MINUTES_PER_DAY);
  p.pol.engagement = Math.min(1, p.pol.engagement + 0.2);
  p.pol.rec[g.id] = Math.max(p.pol.rec[g.id] ?? 0.6, 0.85);
}

/** Set by council.ts / regime.ts (they import this module). */
export const referendumHooks = { apply: (_ctx: Ctx, _g: Polity, _m: Motion, _how: string): void => {} };
export const electionHooks = { onCounted: (_ctx: Ctx, _g: Polity, _e: Election): void => {} };

// ----------------------------------------------------------------- instant

/**
 * A vote held on the spot (a founding assembly, a council choosing an
 * executive, an assembly after a revolution): everyone present votes now.
 */
export function instantElection(ctx: Ctx, g: Polity, electorate: Person[], officeIds: number[], kind: Election['kind'] = 'founding'): Election {
  const e = newElection(ctx, g, kind, ctx.s.tick, officeIds);
  nominate(ctx, g, e, electorate.filter((p) => ageOf(ctx, p) >= 18));
  e.status = 'voting';
  for (const v of electorate) castBallot(ctx, e, v);
  count(ctx, e);
  return e;
}

// ---------------------------------------------------------------- parties

/**
 * Parties form when engaged people with similar views find each other: an
 * ambitious, engaged person founds one near their own position if no
 * existing party is close enough; others join the closest party if they're
 * engaged enough. Platforms follow their members.
 */
export function partiesDaily(ctx: Ctx): void {
  for (const g of ctx.s.polities) {
    if (g.status === 'gone' || g.charter.parties === 'none') continue;
    const people = residentsOf(ctx, g);
    if (people.length < 25) continue;
    const parties = ctx.s.parties.filter((p) => p.polity === g.id && !p.banned);
    // founding
    if (parties.length < 5 && ctx.rng.chance(0.15) && g.charter.parties === 'free') {
      const founder = people.filter((p) => p.pol.party < 0 && p.pol.engagement > 0.5 && p.traits.ambition > 0.55)
        .sort((a, b) => b.pol.engagement + b.traits.ambition - a.pol.engagement - a.traits.ambition)[0];
      if (founder && !parties.some((pt) => distance(compass(founder), pt) < 0.9)) foundParty(ctx, g, founder);
    }
    // joining and leaving
    for (const p of people) {
      if (p.pol.party >= 0) {
        const pt = ctx.partyById.get(p.pol.party);
        if (!pt || pt.banned || distance(compass(p), pt) > 1.8) leaveParty(ctx, p);
        continue;
      }
      if (p.pol.engagement < 0.35 || !ctx.rng.chance(0.05)) continue;
      const near = parties.map((pt) => ({ pt, d: distance(compass(p), pt) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 1.0) joinParty(ctx, p, near.pt);
    }
    for (const pt of parties) {
      const ms = pt.members.map((id) => ctx.byId.get(id)).filter((x): x is Person => !!x);
      pt.members = ms.map((m) => m.id);
      if (!ms.length) { pt.banned = true; continue; }
      pt.econ = 0.9 * pt.econ + 0.1 * (ms.reduce((s, m) => s + m.pol.econ, 0) / ms.length);
      pt.auth = 0.9 * pt.auth + 0.1 * (ms.reduce((s, m) => s + m.pol.auth, 0) / ms.length);
      if (!ctx.byId.has(pt.leader)) pt.leader = ms.reduce((a, b) => (b.pol.engagement + b.traits.communication > a.pol.engagement + a.traits.communication ? b : a)).id;
      // dues
      for (const m of ms) if (m.money > 30) pt.cash += pay(ctx, m.id, pt.id, 0.3, true);
    }
  }
}

export function foundParty(ctx: Ctx, g: Polity, founder: Person): Party {
  const c = compass(founder);
  const used = new Set(ctx.s.parties.filter((p) => p.polity === g.id).map((p) => p.name));
  let name = partyName(ctx.rng, c.econ, c.auth);
  for (let k = 0; k < 5 && used.has(name); k++) name = partyName(ctx.rng, c.econ + ctx.rng.range(-0.5, 0.5), c.auth + ctx.rng.range(-0.5, 0.5));
  if (used.has(name)) name = `${g.short} ${name}`;
  const pt: Party = {
    id: newId(ctx), name, short: name.split(' ').map((w) => w[0]).join('').replace(/[^A-Z]/g, '').slice(0, 4) || 'P', hue: hueFor(c.econ, c.auth),
    founded: ctx.s.tick, leader: founder.id, polity: g.id, members: [], econ: c.econ, auth: c.auth, cash: 0, banned: false, slogan: campaignSlogan(ctx.rng),
  };
  ctx.s.parties.push(pt);
  ctx.partyById.set(pt.id, pt);
  joinParty(ctx, founder, pt);
  log(ctx, 'politics', `${founder.name} founded the ${pt.name} in ${g.short}.`, { who: founder.id });
  return pt;
}

/** Party colors follow tradition loosely: red left, blue right, purple/brown for authoritarian, gold for liberal. */
function hueFor(econ: number, auth: number): number {
  if (auth > 1) return econ < 0 ? 0.0 : 0.08;
  if (auth < -0.9) return 0.13;
  if (econ < -0.4) return 0.98;
  if (econ > 0.4) return 0.6;
  return 0.33;
}

export function joinParty(ctx: Ctx, p: Person, pt: Party): void {
  if (p.pol.party === pt.id) return;
  leaveParty(ctx, p);
  p.pol.party = pt.id;
  p.pol.partyId = pt.id;
  p.pol.partyStrength = Math.max(p.pol.partyStrength, 0.6);
  pt.members.push(p.id);
}

export function leaveParty(ctx: Ctx, p: Person): void {
  const pt = ctx.partyById.get(p.pol.party);
  if (pt) pt.members = pt.members.filter((id) => id !== p.id);
  p.pol.party = -1;
}

// --------------------------------------------------------------- campaigns

/** Daily during a campaign: candidates raise and spend money and get known. Ads and speeches live in media.ts / civic events. */
export function campaignDaily(ctx: Ctx): void {
  for (const e of ctx.s.elections) {
    if (e.status !== 'campaign' && e.status !== 'voting') continue;
    for (const c of e.candidates) {
      const p = ctx.byId.get(c.person);
      if (!p) { c.withdrawn = true; continue; }
      // own money, party money, donations from supporters with money to spare
      const party = ctx.partyById.get(c.party);
      const own = Math.min(p.money * 0.05 * (0.5 + p.traits.ambition), 30);
      c.funds += own;
      p.money -= own;
      if (party && party.cash > 5) { const give = party.cash * 0.25; party.cash -= give; c.funds += give; }
      // donors: rich residents close to the candidate's stated positions
      const g = ctx.gById.get(e.polity);
      if (g) for (let k = 0; k < 4; k++) {
        const d = ctx.s.people[Math.floor(ctx.rng.next() * ctx.s.people.length)];
        if (!d || d.money < 300 || distance(compass(d), c) > 0.8) continue;
        const gift = Math.min(d.money * 0.02, 40);
        d.money -= gift;
        c.funds += gift;
      }
    }
  }
}

