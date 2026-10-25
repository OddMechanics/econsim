// What each person knows about the city's places.
//
// Nobody has a live list of every shop, restaurant, employer and flat in the
// city. People know:
//  - places near home and work, and along the way between them;
//  - places they've been to (and what they thought of them);
//  - places friends and colleagues told them about;
//  - places from ads (billboards, TV, sponsored posts);
//  - what a search turned up (a search engine, the delivery app, a job board,
//    home listings): the top few results, sponsored ones first.
// Where to shop, eat, work, live and hang out is chosen from this list (ai.ts).
// Places fade when they don't come up for a while, and a list only holds so
// many of each kind (the weakest go first). Posted prices and whether a known
// place is open and has stock are visible (shops show them online); what
// people don't know is that a place exists, or what it's like.

import { MINUTES_PER_DAY } from './config';
import { type Ctx } from './ctx';
import { BUILDINGS } from './goods';
import { RENTALS } from './housing';
import { tally } from './stats';
import type { AdChannel, Building, Firm, KnownPlace, Person, PlaceKind, PlaceSource } from './types';

/** How many places of each kind a person keeps in mind. */
export const PLACE_CAP: Record<PlaceKind, number> = { shop: 8, food: 6, car: 2, job: 12, home: 8, out: 4 };
/** How many results a search shows. */
export const SEARCH_RESULTS = 5;
/** Days without anything bringing a place back to mind before it's forgotten. */
const FORGET_DAYS: Record<PlaceSource, number> = { near: 3, route: 3, visit: 45, friend: 20, ad: 14, search: 10, asked: 10 };

/** What a building can be to someone (a store is a place to shop and a place to work). */
export function placeKinds(b: Building): PlaceKind[] {
  if (!b.built || b.ruined) return [];
  if (b.kind === 'park' || b.kind === 'plaza') return ['out'];
  if (RENTALS.has(b.kind)) return ['home'];
  if (b.firm < 0) return [];
  const out: PlaceKind[] = [];
  if (b.kind === 'store') out.push('shop');
  else if (b.kind === 'restaurant') out.push('food');
  else if (b.kind === 'dealer') out.push('car');
  if (BUILDINGS[b.kind].jobs.length) out.push('job');
  return out;
}

/** Is the building still that kind of place (not torn down, closed, or turned into something else)? */
function still(b: Building | undefined, k: PlaceKind): b is Building {
  return !!b && placeKinds(b).includes(k);
}

/** The places of a kind they know (still standing and still that kind of place). */
export function knownOf(ctx: Ctx, p: Person, k: PlaceKind): { b: Building; pl: KnownPlace }[] {
  const out: { b: Building; pl: KnownPlace }[] = [];
  for (const pl of p.places ?? []) {
    if (pl.k !== k) continue;
    const b = ctx.bById.get(pl.b);
    if (still(b, k)) out.push({ b, pl });
  }
  return out;
}

export function knows(p: Person, b: number, k: PlaceKind): KnownPlace | undefined {
  return p.places?.find((x) => x.b === b && x.k === k);
}

/** How firmly a place sits in someone's mind (the weakest is forgotten first when the list is full). */
function standing(ctx: Ctx, pl: KnownPlace): number {
  const age = (ctx.s.tick - pl.t) / MINUTES_PER_DAY;
  return (pl.seen !== undefined ? 1.5 : 0) + 2 * (pl.op ?? 0) - age / 7;
}

/** They come to know a place (or it comes back to mind). */
export function learnPlace(ctx: Ctx, p: Person, b: Building, k: PlaceKind, src: PlaceSource, extra: { via?: number; op?: number; ch?: AdChannel } = {}): KnownPlace {
  const list = (p.places ??= []);
  const have = list.find((x) => x.b === b.id && x.k === k);
  if (have) {
    have.t = ctx.s.tick;
    // a friend's word or an ad nudges an opinion they don't have yet; their own visits count for more
    if (extra.op !== undefined && have.seen === undefined) have.op = Math.max(-1, Math.min(1, (have.op ?? 0) * 0.7 + extra.op * 0.3));
    return have;
  }
  const pl: KnownPlace = { b: b.id, k, src, t: ctx.s.tick };
  if (extra.via !== undefined) pl.via = extra.via;
  if (extra.op !== undefined) pl.op = extra.op;
  if (extra.ch !== undefined) pl.ch = extra.ch;
  list.push(pl);
  // too many of this kind: the one they think of least goes (never the one just learned)
  let n = 0;
  for (const x of list) if (x.k === k) n++;
  if (n > PLACE_CAP[k]) {
    let worst: KnownPlace | undefined, ws = Infinity;
    for (const x of list) if (x.k === k && x !== pl) { const v = standing(ctx, x); if (v < ws) { ws = v; worst = x; } }
    if (worst) list.splice(list.indexOf(worst), 1);
  }
  return pl;
}

/** After going somewhere: they've seen it for themselves (good: got what they came for). */
export function visitedPlace(ctx: Ctx, p: Person, b: Building, k: PlaceKind, good: boolean): void {
  const pl = learnPlace(ctx, p, b, k, 'visit');
  // the first visit to a place they found through an ad: a new customer for that ad (and its channel)
  if (pl.seen === undefined && good && pl.src === 'ad' && pl.ch) {
    const af = ctx.fById.get(pl.via ?? -1);
    if (af) { const t = (af.adToday ??= { imp: {}, conv: {} }); t.conv[pl.ch] = (t.conv[pl.ch] ?? 0) + 1; }
    tally(ctx, 'adconv:' + pl.ch, 1);
  }
  pl.seen = ctx.s.tick;
  const f = ctx.fById.get(b.firm);
  const op = pl.op ?? 0;
  pl.op = good
    ? Math.min(1, op + 0.25 * (1 - op) + ((f?.reputation ?? 0.5) - 0.5) * 0.2)
    : Math.max(-1, op - 0.35);
}

export function forgetPlace(p: Person, b: number, k?: PlaceKind): void {
  if (!p.places) return;
  p.places = p.places.filter((x) => x.b !== b || (k !== undefined && x.k !== k));
}

// ------------------------------------------------------------ what's around

/** Places by area (a grid of 120 m squares), for "what's near here". Rebuilt when buildings change, at most hourly. */
const CELL = 120;
const gridCache = new WeakMap<object, { h: number; n: number; cells: Map<number, Building[]> }>();
function grid(ctx: Ctx): Map<number, Building[]> {
  const h = Math.floor(ctx.s.tick / 60);
  const c = gridCache.get(ctx.s);
  if (c && c.h === h && c.n === ctx.s.buildings.length) return c.cells;
  const cells = new Map<number, Building[]>();
  for (const b of ctx.s.buildings) {
    if (!b.built || b.ruined || b.host !== undefined) continue;
    const key = Math.floor(b.x / CELL) * 4096 + Math.floor(b.y / CELL);
    const arr = cells.get(key);
    if (arr) arr.push(b); else cells.set(key, [b]);
  }
  gridCache.set(ctx.s, { h, n: ctx.s.buildings.length, cells });
  return cells;
}

/** The buildings within r of a point (towers include their shops and offices). */
function around(ctx: Ctx, x: number, y: number, r: number): Building[] {
  const cells = grid(ctx);
  const out: Building[] = [];
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    for (const b of cells.get(cx * 4096 + cy) ?? []) {
      if (Math.hypot(b.x - x, b.y - y) > r) continue;
      out.push(b);
      for (const id of b.hosted ?? []) { const u = ctx.bById.get(id); if (u) out.push(u); }
    }
  }
  return out;
}

/** Sites with a "hiring" sign (an open job posting), gathered once a minute. */
const hiringCache = new WeakMap<object, { t: number; n: number; set: Set<number> }>();
export function hiringSites(ctx: Ctx): Set<number> {
  const c = hiringCache.get(ctx.s);
  if (c && c.t === ctx.s.tick && c.n === ctx.s.postings.length) return c.set;
  const set = new Set(ctx.s.postings.map((q) => q.site));
  hiringCache.set(ctx.s, { t: ctx.s.tick, n: ctx.s.postings.length, set });
  return set;
}

/** Does a rental building show a "for rent" banner (an empty flat)? */
const forRent = (b: Building) => b.units.some((u) => u.tenant < 0);

/** The nearest few places of each kind around a point that someone would notice, learned with a source. */
function notice(ctx: Ctx, p: Person, x: number, y: number, r: number, src: PlaceSource, per: Partial<Record<PlaceKind, number>>): void {
  const found: Record<PlaceKind, { b: Building; d: number }[]> = { shop: [], food: [], car: [], job: [], home: [], out: [] };
  const hiring = hiringSites(ctx);
  for (const b of around(ctx, x, y, r)) {
    for (const k of placeKinds(b)) {
      if (!per[k]) continue;
      // employers are noticed by their "hiring" sign, flats by their "for rent" banner
      if (k === 'job' && !hiring.has(b.id)) continue;
      if (k === 'home' && !forRent(b)) continue;
      found[k].push({ b, d: Math.hypot(b.x - x, b.y - y) });
    }
  }
  for (const k of Object.keys(found) as PlaceKind[]) {
    found[k].sort((a, c) => a.d - c.d);
    for (const { b } of found[k].slice(0, per[k] ?? 0)) learnPlace(ctx, p, b, k, src);
  }
}

/** Daily: forget what hasn't come up in a while; notice what's near home, near work and on the way. */
export function placesDaily(ctx: Ctx, p: Person): void {
  const now = ctx.s.tick;
  if (p.places) {
    p.places = p.places.filter((pl) => {
      if (!still(ctx.bById.get(pl.b), pl.k)) return false;
      const src = pl.seen !== undefined ? 'visit' : pl.src;
      return (now - pl.t) / MINUTES_PER_DAY < FORGET_DAYS[src];
    });
  }
  const home = ctx.bById.get(p.home);
  const job = ctx.bById.get(ctx.cById.get(p.job)?.site ?? -1);
  const base = home ?? { x: p.x, y: p.y };
  notice(ctx, p, base.x, base.y, 420, 'near', { shop: 4, food: 3, car: 1, out: 2, home: 3, job: 4 });
  if (job) {
    notice(ctx, p, job.x, job.y, 250, 'near', { shop: 2, food: 2, home: 2, job: 3 });
    // on the way: every ~150 m along the commute, what's right by the street
    const d = Math.hypot(job.x - base.x, job.y - base.y);
    const steps = Math.min(12, Math.floor(d / 150));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      notice(ctx, p, base.x + (job.x - base.x) * f, base.y + (job.y - base.y) * f, 70, 'route', { shop: 1, food: 1, car: 1, home: 1, job: 1 });
    }
    learnPlace(ctx, p, job, 'job', 'visit').seen = now;
  }
  if (home && RENTALS.has(home.kind)) learnPlace(ctx, p, home, 'home', 'visit').seen = now;
  // they know their own businesses
  for (const fid of p.firms) {
    const f = ctx.fById.get(fid);
    for (const id of f?.sites ?? []) { const b = ctx.bById.get(id); if (b) for (const k of placeKinds(b)) learnPlace(ctx, p, b, k, 'visit'); }
  }
}

/**
 * Countryside people's look round (every few days, not daily): forget what's
 * stale, and know the nearest village shop, pub and farms hiring within a
 * walk or a short drive of home, their work and their own business.
 */
export function countryPlaces(ctx: Ctx, p: Person): void {
  const now = ctx.s.tick;
  if (p.places) {
    p.places = p.places.filter((pl) => {
      if (!still(ctx.bById.get(pl.b), pl.k)) return false;
      const src = pl.seen !== undefined ? 'visit' : pl.src;
      return (now - pl.t) / MINUTES_PER_DAY < FORGET_DAYS[src] * 2;
    });
  } else p.places = [];
  const home = ctx.bById.get(p.home);
  const base = home ?? { x: p.x, y: p.y };
  notice(ctx, p, base.x, base.y, 1500, 'near', { shop: 2, food: 1, out: 1, job: 3 });
  const job = ctx.bById.get(ctx.cById.get(p.job)?.site ?? -1);
  if (job) learnPlace(ctx, p, job, 'job', 'visit').seen = now;
  for (const fid of p.firms) {
    const f = ctx.fById.get(fid);
    for (const id of f?.sites ?? []) { const b = ctx.bById.get(id); if (b) for (const k of placeKinds(b)) learnPlace(ctx, p, b, k, 'visit'); }
  }
}

/** The first time (a newcomer, or a world saved before people kept lists): what's around them, and brands they know. */
export function ensurePlaces(ctx: Ctx, p: Person): void {
  if (p.places) return;
  p.places = [];
  placesDaily(ctx, p);
  for (const [id, a] of Object.entries(p.pol.aware)) if (a > 0.15) heardOfFirm(ctx, p, Number(id), 1);
}

/** Desperate (hungry, homeless, out of work): they ask around and walk the streets, and learn the nearest few. */
export function askAround(ctx: Ctx, p: Person, k: PlaceKind, n = 2, ok: (b: Building) => boolean = () => true): void {
  // nearby first, then further afield
  for (const r of [400, 1000, 2500]) {
    const cands: { b: Building; d: number }[] = [];
    for (const b of around(ctx, p.x, p.y, r)) {
      if (!placeKinds(b).includes(k) || !ok(b)) continue;
      cands.push({ b, d: Math.hypot(b.x - p.x, b.y - p.y) });
    }
    if (cands.length < n && r < 2500) continue;
    cands.sort((a, c) => a.d - c.d);
    for (const { b } of cands.slice(0, n)) learnPlace(ctx, p, b, k, 'asked');
    return;
  }
}

// -------------------------------------------------------------- ads, search

/** Consumer places of a company (what an ad would make someone aware of). */
function consumerPlaces(ctx: Ctx, f: Firm): { b: Building; k: PlaceKind }[] {
  const out: { b: Building; k: PlaceKind }[] = [];
  for (const id of f.sites) {
    const b = ctx.bById.get(id);
    if (!b) continue;
    for (const k of placeKinds(b)) if (k === 'shop' || k === 'food' || k === 'car') out.push({ b, k });
  }
  return out;
}

/** An ad: maybe they now know one of the company's places (the one nearest them). `w` is the ad's strength. */
export function heardOfFirm(ctx: Ctx, p: Person, firm: number, w: number, ch: AdChannel = 'street'): void {
  const f = ctx.fById.get(firm);
  if (!f || f.closed || !p.places || !ctx.rng.chance(Math.min(1, w * 10))) return;
  const sites = consumerPlaces(ctx, f);
  if (!sites.length) return;
  const home = ctx.bById.get(p.home) ?? p;
  const near = sites.reduce((a, c) => (Math.hypot(c.b.x - home.x, c.b.y - home.y) < Math.hypot(a.b.x - home.x, a.b.y - home.y) ? c : a));
  learnPlace(ctx, p, near.b, near.k, 'ad', { via: firm, ch });
}

/**
 * A search (a search engine, the delivery app, a job board, home listings):
 * the top few results of a kind among `cands`, sponsored ones first, then by
 * `rank` (higher is better). The results are added to their list.
 */
export function searchFor(ctx: Ctx, p: Person, k: PlaceKind, site: Firm, cands: Building[], rank: (b: Building) => number): Building[] {
  const sponsored = (b: Building) => ((ctx.fById.get(b.firm)?.adSpend?.net ?? 0) > 0 ? 1 : 0);
  const top = cands
    .map((b) => ({ b, s: rank(b), ad: sponsored(b) }))
    .sort((a, c) => c.ad - a.ad || c.s - a.s)
    .slice(0, SEARCH_RESULTS)
    .map((x) => x.b);
  for (const b of top) learnPlace(ctx, p, b, k, 'search', { via: site.id });
  return top;
}

// ------------------------------------------------------------ word of mouth

const KIND_WORD: Record<PlaceKind, string> = { shop: 'shop', food: 'place to eat', car: 'car dealer', job: 'place to work', home: 'building', out: 'spot' };

/**
 * In a conversation, `a` tells `b` about a place: one they liked or hated,
 * or (if b is out of work) their own employer when it's hiring. Returns
 * what they said (or null if nothing came up).
 */
export function sharePlace(ctx: Ctx, a: Person, b: Person): string | null {
  if (!a.places?.length || !b.places) return null;
  // a job tip: the friend is out of work and a's employer is hiring
  const c = ctx.cById.get(a.job);
  if (c && b.job < 0 && !b.firms.length && hiringSites(ctx).has(c.site)) {
    const site = ctx.bById.get(c.site);
    const f = ctx.fById.get(c.firm);
    if (site && f && !knows(b, site.id, 'job')) {
      learnPlace(ctx, b, site, 'job', 'friend', { via: a.id, op: 0.4 });
      return `${f.name} is hiring, you know. Where I work. You should apply.`;
    }
  }
  // a place they have strong feelings about, from their own visits
  const strong = a.places.filter((x) => x.seen !== undefined && Math.abs(x.op ?? 0) >= 0.3 && x.k !== 'job' && x.k !== 'home');
  if (!strong.length) return null;
  const pl = strong[Math.floor(ctx.rng.next() * strong.length)];
  const bd = ctx.bById.get(pl.b);
  if (!still(bd, pl.k)) return null;
  learnPlace(ctx, b, bd, pl.k, 'friend', { via: a.id, op: (pl.op ?? 0) * 0.6 });
  const name = ctx.fById.get(bd.firm)?.name ?? (bd.kind === 'park' ? 'the park' : 'the plaza');
  if ((pl.op ?? 0) > 0) return ctx.rng.pick([`Have you been to ${name}? It's really good.`, `You should try ${name}, honestly.`, `${name} is my favorite ${KIND_WORD[pl.k]}.`]);
  return ctx.rng.pick([`Stay away from ${name}. Not worth it.`, `I went to ${name} once. Never again.`]);
}

// --------------------------------------------------------------------- UI

/** How many people know a place, and how many have been there in the last week (counted once a minute). */
const knownCache = new WeakMap<object, { t: number; m: Map<number, { n: number; regulars: number }> }>();
export function knownBy(ctx: Ctx, b: number): { n: number; regulars: number } {
  let c = knownCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick) {
    const m = new Map<number, { n: number; regulars: number }>();
    const week = ctx.s.tick - 7 * MINUTES_PER_DAY;
    for (const p of ctx.s.people) {
      const counted = new Set<number>();
      for (const pl of p.places ?? []) {
        if (counted.has(pl.b)) continue;
        counted.add(pl.b);
        const e = m.get(pl.b) ?? { n: 0, regulars: 0 };
        e.n++;
        if (pl.seen !== undefined && pl.seen >= week) e.regulars++;
        m.set(pl.b, e);
      }
    }
    c = { t: ctx.s.tick, m };
    knownCache.set(ctx.s, c);
  }
  return c.m.get(b) ?? { n: 0, regulars: 0 };
}

/** How someone came to know a place, in words. */
export function howKnown(ctx: Ctx, p: Person, pl: KnownPlace): string {
  const who = (id: number | undefined) => (id !== undefined ? ctx.byId.get(id)?.name.split(' ')[0] ?? ctx.fById.get(id)?.name ?? ctx.fById.get(id)?.site?.name : undefined);
  switch (pl.src) {
    case 'near': return pl.b === p.home ? 'lives there' : 'near home or work';
    case 'route': return 'on the way to work';
    case 'visit': return 'been there';
    case 'friend': return `${who(pl.via) ?? 'a friend'} told them`;
    case 'ad': return 'saw an ad';
    case 'search': return `found on ${ctx.fById.get(pl.via ?? -1)?.site?.name ?? 'the Net'}`;
    case 'asked': return 'asked around';
  }
}
