// Political views. Everyone has a position on a political compass, in
// standard-deviation units: economic (left < 0: redistribution and public
// ownership; right > 0: markets and low taxes) and authority (libertarian
// < 0: liberty; authoritarian > 0: order). See docs/research/politics.md §5.
//
// Starting positions are not random: they follow from who the person is.
// That means personality (openness and agreeableness matter most), schooling,
// age, where they grew up and how well off they are. Afterwards positions
// drift toward where their interests lie: business owners and landlords
// drift right, the unemployed left. Friends they trust pull them closer
// (only when not too far apart). Media and campaigns persuade a little, and
// most of that wears off within days.

import { MINUTES_PER_DAY, POLITICS } from './config';
import { cashOf, type Ctx } from './ctx';
import { ROLE } from './goods';
import type { Issue, Person, Politics, Polity } from './types';

/** Places people come from, and the outlook they bring. */
export const ORIGINS: { name: string; econ: number; auth: number; edu: number; w: number }[] = [
  { name: 'a big city', econ: -0.2, auth: -0.35, edu: 1.5, w: 3 },
  { name: 'the suburbs', econ: 0.25, auth: 0.05, edu: 1, w: 3 },
  { name: 'farm country', econ: 0.35, auth: 0.45, edu: -1.5, w: 3 },
  { name: 'an old mill town', econ: -0.45, auth: 0.2, edu: -1, w: 2 },
  { name: 'a college town', econ: -0.45, auth: -0.55, edu: 2.5, w: 1 },
  { name: 'abroad', econ: -0.1, auth: 0.15, edu: 0, w: 2 },
  { name: 'a mining town', econ: -0.25, auth: 0.3, edu: -1.5, w: 1 },
  { name: 'a seaside town', econ: 0, auth: -0.05, edu: 0, w: 1 },
  { name: 'a gated community', econ: 0.6, auth: 0.25, edu: 1.5, w: 1 },
];
const ORIGIN = new Map(ORIGINS.map((o) => [o.name, o]));

const z = (t: number) => (t - 0.5) / 0.2;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function ageOf(ctx: Ctx, p: Person): number {
  return (ctx.s.tick - p.born) / (365 * MINUTES_PER_DAY);
}

/** The disposition part of someone's position (personality, upbringing, schooling, age). */
function disposition(ctx: Ctx, p: Person): { econ: number; auth: number } {
  const t = p.traits;
  const o = ORIGIN.get(p.origin) ?? { econ: 0, auth: 0 };
  const age = ageOf(ctx, p);
  const econ = 0.38 * z(t.ambition) + 0.22 * z(t.risk) - 0.38 * z(t.agreeable) + 0.12 * z(t.diligence) + o.econ;
  const auth = -0.45 * z(t.curiosity) + 0.2 * z(t.diligence) + 0.15 * z(t.agreeable) - 0.15 * z(t.risk)
    + 0.2 * (age - 40) / 14 - 0.28 * (p.edu - 13) / 2.5 + o.auth;
  return { econ: econ * 1.35, auth: auth * 1.3 };
}

/** Where someone's interests put them right now: disposition plus their economic situation. */
export function interestPoint(ctx: Ctx, p: Person): { econ: number; auth: number } {
  const d = disposition(ctx, p);
  let econ = d.econ, auth = d.auth;
  const wealth = Math.max(0, cashOf(ctx, p.id)) + p.owned.length * 150 + p.firms.length * 300;
  econ += 0.3 * Math.log((wealth + 60) / 250);
  if (p.firms.length) econ += 0.3;
  const c = ctx.cById.get(p.job);
  if (!c && !p.firms.length && ctx.s.tick - p.arrived > 3 * MINUTES_PER_DAY) econ -= 0.3;
  if (c) {
    if (ctx.fById.get(c.firm)?.gov !== undefined) econ -= 0.2;
    if (ROLE[c.role].pay <= 0.95) econ -= 0.15;
  }
  const home = ctx.bById.get(p.home);
  if (home) {
    if (home.owner === p.id) { econ += 0.1; auth += 0.05; } else econ -= 0.1;
  }
  if (isLandlord(ctx, p)) econ += 0.2;
  return { econ, auth };
}

export function isLandlord(ctx: Ctx, p: Person): boolean {
  for (const id of p.owned) { const k = ctx.bById.get(id)?.kind; if (k === 'apartments' || k === 'tower' || k === 'officetower') return true; }
  for (const fid of p.firms) {
    const f = ctx.fById.get(fid);
    if (f?.sites.some((s) => { const k = ctx.bById.get(s)?.kind; return k === 'apartments' || k === 'tower' || k === 'officetower'; })) return true;
  }
  return false;
}

export function initPolitics(ctx: Ctx, p: Person): Politics {
  const t = p.traits;
  const d = interestPoint(ctx, p);
  const age = ageOf(ctx, p);
  const engagement = clamp(0.18 + 0.06 * z(t.communication) + 0.18 * (age - 20) / 45 + 0.05 * (p.edu - 12) + 0.04 * z(t.ambition) + 0.06 * (Math.abs(d.econ) + Math.abs(d.auth)), 0.03, 1);
  return {
    econ: d.econ, auth: d.auth, anchorEcon: d.econ, anchorAuth: d.auth, tilt: {}, pEcon: 0, pAuth: 0,
    engagement, party: -1, partyId: -1, partyStrength: 0, rec: {}, aware: {}, tv: -1, sites: [],
    voted: -1, votedFor: -1, sameSide: 0, grievance: 0,
    threshold: clamp(0.42 - 0.32 * t.risk + 0.12 * t.patience - 0.1 * t.sociability, 0.03, 0.9),
    protesting: -1, contacted: -1,
  };
}

/** Their position as it shows right now (with short-lived persuasion). */
export function compass(p: Person): { econ: number; auth: number } {
  return { econ: p.pol.econ + p.pol.pEcon, auth: p.pol.auth + p.pol.pAuth };
}

export function distance(a: { econ: number; auth: number }, b: { econ: number; auth: number }): number {
  return Math.hypot(a.econ - b.econ, a.auth - b.auth);
}

/** A plain-words label for a compass position. */
export function compassLabel(econ: number, auth: number): string {
  const e = econ < -1.2 ? 'far left' : econ < -0.45 ? 'left' : econ > 1.2 ? 'far right' : econ > 0.45 ? 'right' : 'centrist';
  const a = auth > 1.1 ? 'authoritarian' : auth > 0.45 ? 'law-and-order' : auth < -1.1 ? 'libertarian' : auth < -0.45 ? 'liberal' : '';
  if (e === 'centrist' && !a) return 'moderate';
  if (e === 'far left' && auth > 0.6) return 'communist';
  if (e === 'far right' && auth > 1) return 'nationalist';
  if (e === 'far right' && auth < -0.6) return 'libertarian (free-market)';
  if (e === 'far left' && auth < -0.8) return 'anarchist';
  return a ? `${a} ${e === 'centrist' ? 'centrist' : e}` : e;
}

/**
 * Support (-1..1) for MORE of something: taxes for services, welfare, rent
 * control/public housing, growth (building, newcomers), public ownership,
 * policing, democratic rules, road spending. Ideology plus self-interest.
 */
export function stance(ctx: Ctx, p: Person, issue: Issue): number {
  const { econ: E, auth: A } = compass(p);
  const tilt = p.pol.tilt[issue] ?? 0;
  const home = ctx.bById.get(p.home);
  const owner = !!home && home.owner === p.id;
  const renter = !!home && (home.kind === 'apartments' || home.kind === 'tower') && home.owner !== p.id;
  const landlord = isLandlord(ctx, p);
  const business = p.firms.length > 0;
  const jobless = p.job < 0 && !business;
  let x = 0;
  switch (issue) {
    case 'taxes': x = -0.5 * E - (owner ? 0.25 : 0) - (landlord ? 0.25 : 0) + (jobless ? 0.15 : 0); break;
    case 'welfare': x = -0.55 * E + (jobless ? 0.45 : 0) - (business ? 0.15 : 0); break;
    case 'housing': x = -0.45 * E + (renter ? 0.4 : 0) - (landlord ? 0.75 : 0) - (owner ? 0.1 : 0); break;
    case 'growth': x = 0.2 * E - 0.25 * A + (business ? 0.35 : 0) - (owner ? 0.25 : 0) + (renter ? 0.15 : 0); break;
    case 'ownership': x = -0.7 * E - (business ? 0.5 : 0) - (landlord ? 0.3 : 0); break;
    case 'order': x = 0.6 * A + (business ? 0.1 : 0); break;
    case 'democracy': x = 0.35 - 0.6 * A; break;
    case 'roads': x = 0.25 + (p.car >= 0 ? 0.25 : 0) + (business ? 0.15 : 0) - 0.1 * E; break;
  }
  return Math.tanh(x + tilt);
}

// ------------------------------------------------------------------ change

/** Some message pushes toward a position (an ad, a broadcast, a post, a speech). */
export function expose(p: Person, econ: number, auth: number, strength = 1): void {
  const pol = p.pol;
  const cur = compass(p);
  const gap = Math.hypot(econ - cur.econ, auth - cur.auth);
  if (gap > 1.5 || gap < 0.01) return; // too far away to take seriously
  const k = POLITICS.mediaPull * strength * (0.6 + 0.8 * (1 - pol.partyStrength));
  pol.pEcon += k * (econ - cur.econ);
  pol.pAuth += k * (auth - cur.auth);
  // a tenth of it sticks
  pol.econ += 0.1 * k * (econ - cur.econ);
  pol.auth += 0.1 * k * (auth - cur.auth);
}

/** Two people who trust each other talk: they move a little toward each other (if not too far apart). */
export function talkInfluence(a: Person, b: Person, trustAB: number, trustBA: number): void {
  const ca = compass(a), cb = compass(b);
  const gap = distance(ca, cb);
  if (gap > POLITICS.talkMaxGap || gap < 0.01) return;
  const k = POLITICS.talkPull;
  if (trustAB > 0.5) { a.pol.econ += k * (cb.econ - ca.econ); a.pol.auth += k * (cb.auth - ca.auth); }
  if (trustBA > 0.5) { b.pol.econ += k * (ca.econ - cb.econ); b.pol.auth += k * (ca.auth - cb.auth); }
}

/** Something happened to them that changes how they see one issue (job loss, windfall…). */
export function shock(p: Person, issue: Issue, amount: number): void {
  p.pol.tilt[issue] = clamp((p.pol.tilt[issue] ?? 0) + amount, -1.5, 1.5);
}

/** Daily: drift toward interests, persuasion and awareness fade, tilts relax. */
export function politicsDaily(ctx: Ctx, p: Person): void {
  const pol = p.pol;
  const age = ageOf(ctx, p);
  // the anchor is recomputed now and then (cheap enough daily)
  const ip = interestPoint(ctx, p);
  pol.anchorEcon = ip.econ;
  pol.anchorAuth = ip.auth;
  const perYear = age < 26 ? POLITICS.driftPerYear.young : age < 41 ? POLITICS.driftPerYear.mid : POLITICS.driftPerYear.old;
  const k = perYear / POLITICS.year;
  pol.econ += (pol.anchorEcon - pol.econ) * k;
  pol.auth += (pol.anchorAuth - pol.auth) * k;
  pol.econ = clamp(pol.econ, -3.2, 3.2);
  pol.auth = clamp(pol.auth, -3.2, 3.2);
  const fade = Math.pow(0.5, 1 / POLITICS.persuasionHalfLifeDays);
  pol.pEcon *= fade;
  pol.pAuth *= fade;
  const forget = Math.pow(0.5, 1 / POLITICS.awarenessHalfLifeDays);
  for (const id of Object.keys(pol.aware)) {
    const v = pol.aware[+id] * forget;
    if (v < 0.02) delete pol.aware[+id]; else pol.aware[+id] = v;
  }
  for (const k2 of Object.keys(pol.tilt) as Issue[]) {
    // job-loss tilts fade only after they're working again
    if (k2 === 'welfare' && p.job < 0 && !p.firms.length) continue;
    pol.tilt[k2] = pol.tilt[k2]! * Math.pow(0.5, 1 / (POLITICS.year * 0.5));
    if (Math.abs(pol.tilt[k2]!) < 0.03) delete pol.tilt[k2];
  }
  // engagement rises in hard times and with age; falls when life is easy
  const target = clamp(0.15 + 0.15 * (age - 20) / 45 + 0.05 * (p.edu - 12) + 0.2 * pol.grievance + 0.05 * (Math.abs(pol.econ) + Math.abs(pol.auth)), 0.03, 1);
  pol.engagement += (target - pol.engagement) * 0.03;
}

/** How a person sees the people running a government (their average position). */
export function rulersPosition(ctx: Ctx, g: Polity): { econ: number; auth: number } | null {
  let e = 0, a = 0, n = 0;
  for (const o of g.offices) {
    const q = ctx.byId.get(o.holder);
    if (!q) continue;
    const w = o.kind === 'exec' ? 2 : 1;
    e += q.pol.econ * w; a += q.pol.auth * w; n += w;
  }
  return n ? { econ: e / n, auth: a / n } : null;
}
