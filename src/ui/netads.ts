// Shared bits for the Net window and the panels: formatting, today's
// counters, and the ads people see online.
//
// The simulation decides who advertises and pays for it (advertising.ts:
// each company's daily `adSpend.net` is spread over the city's websites by
// their audience, and candidates buy targeted ads during campaigns). The
// sim's per-site ad pools are runtime-only, so the UI rebuilds the same
// picture from state: every site that sells ads (all but payments and
// crowdfunding) carries every online advertiser, weighted by spend and by
// the same targeting the sim uses (near the viewer's home, food for the
// hungry, employers for job seekers, candidates close to the viewer's views).
// Picks are deterministic and rotate every 20 game minutes, so a page
// doesn't flicker while the world runs.

import { dayOf, minuteOfDay, type Ctx } from '../sim/ctx';
import { BUILDINGS, GOOD } from '../sim/goods';
import { compass } from '../sim/ideology';
import type { Building, Candidate, Firm, Person, SimState } from '../sim/types';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const hsl = (h: number, s = 55, l = 45) => `hsl(${Math.round((((h % 1) + 1) % 1) * 360)} ${s}% ${l}%)`;
export const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Money with sensible precision (prices 2 decimals, big sums rounded, k above 10,000). */
export const cash = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 2 : 1));
export const count = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
export const hhmm = (t: number) => { const m = minuteOfDay(t); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** "now", "12m", "3h", "2d" since a tick. */
export function ago(now: number, t: number): string {
  const d = Math.max(0, now - t);
  if (d < 2) return 'now';
  if (d < 60) return `${d}m`;
  if (d < 1440) return `${Math.floor(d / 60)}h`;
  return `${Math.floor(d / 1440)}d`;
}
/** "in 3h", "in 2 days". */
export function until(now: number, t: number): string {
  const d = t - now;
  if (d <= 0) return 'now';
  if (d < 60) return `in ${d} min`;
  if (d < 1440) return `in ${Math.round(d / 60)}h`;
  const days = Math.round(d / 1440);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
export const first = (name: string) => name.split(' ')[0];
export const handle = (name: string) => '@' + name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
export const goodLabel = (g: string) => (g === 'computers' ? 'electronics' : GOOD[g as keyof typeof GOOD]?.label ?? g);
export const GOOD_ICON: Record<string, string> = {
  groceries: '🥦', clothes: '👕', furniture: '🛋️', tools: '🔧', computers: '💻', cars: '🚗', planks: '🪵', bricks: '🧱', steel: '🔩',
  concrete: '🏗️', glass: '🪟', crops: '🌾', wood: '🌲', stone: '🪨', clay: '🏺', ore: '⛏️',
};
/** Years of school in words. */
export function eduLabel(y: number): string {
  return y >= 18 ? 'graduate degree' : y >= 16 ? 'college degree' : y >= 14 ? 'some college' : y >= 12 ? 'high school' : y >= 9 ? 'some high school' : 'basic schooling';
}

/** A small deterministic hash -> 0..1. */
export function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return ((h >>> 0) % 100000) / 100000;
}

// ------------------------------------------------------------ day counters

/**
 * What happened today: the sim's counters are running totals, so the UI
 * remembers them when it first sees a day. (If the page opened mid-day,
 * "today" means "since the page opened"; `since` says when.)
 */
export class DayCounters {
  private day = -1;
  private base: Record<string, number> = {};
  since = 0;
  update(s: SimState): void {
    const d = dayOf(s.tick);
    if (d === this.day) return;
    this.day = d;
    this.since = s.tick;
    this.base = { ...(s.counters as Record<string, number>) };
    for (const [k, v] of Object.entries(s.data ?? {})) this.base['data:' + k] = v;
  }
  get(s: SimState, key: string): number {
    this.update(s);
    return Math.max(0, ((s.counters as Record<string, number | undefined>)[key] ?? 0) - (this.base[key] ?? 0));
  }
  /** Growth of a `s.data` counter today (rides:<app>, gigs:<app>, …). Daily decay happens at midnight, before we snapshot. */
  data(s: SimState, key: string): number {
    this.update(s);
    return Math.max(0, (s.data?.[key] ?? 0) - (this.base['data:' + key] ?? 0));
  }
  /** Forget the baseline (a different world was loaded). */
  reset(): void {
    this.day = -1;
  }
  /** "today" or "since 14:20". */
  label(): string {
    // the small hours are quiet: a count that starts before 3:00 is as good as the whole day
    return minuteOfDay(this.since) < 180 ? 'today' : `since ${hhmm(this.since)}`;
  }
}
export const today = new DayCounters();

// --------------------------------------------------------------------- ads

export interface Advertiser {
  id: number; // sponsor (firm or person)
  name: string;
  hue: number;
  spend: number; // per day online
  firm?: Firm;
  cand?: Candidate;
  office?: string;
  /** Where the business is (for "near you"). */
  geo?: { x: number; y: number };
  /** The street it's on. */
  street?: string;
  service?: string;
  hiring: boolean;
}

export interface ShownAd {
  ad: Advertiser;
  headline: string;
  tagline: string;
  cta: string;
  domain: string;
  /** Targeting, in plain words. */
  why: string;
  nav: string;
}

const cache = new WeakMap<object, { t: number; list: Advertiser[] }>();

/** Everyone buying online ads right now: companies (yesterday's net spend) and candidates in a campaign. */
export function advertisers(ctx: Ctx): Advertiser[] {
  const c = cache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list;
  const list: Advertiser[] = [];
  const hiring = new Set(ctx.s.postings.map((p) => p.firm));
  for (const f of ctx.s.firms) {
    const spend = f.adSpend?.net ?? 0;
    if (f.closed || spend <= 0.05) continue;
    const b = ctx.bById.get(f.sites[0]);
    list.push({ id: f.id, name: f.name, hue: f.hue, spend, firm: f, geo: b ? { x: b.x, y: b.y } : undefined, street: b ? streetOf(ctx, b) : undefined, service: BUILDINGS[f.kind].service, hiring: hiring.has(f.id) });
  }
  for (const e of ctx.s.elections) {
    if (e.status !== 'campaign' && e.status !== 'voting') continue;
    const g = ctx.gById.get(e.polity);
    for (const cand of e.candidates) {
      const p = ctx.byId.get(cand.person);
      if (!p || cand.withdrawn || cand.spent <= 0) continue;
      const party = ctx.partyById.get(cand.party);
      const office = g?.offices.find((o) => o.id === cand.office)?.title.split(' (')[0];
      list.push({ id: p.id, name: p.name, hue: party?.hue ?? p.looks.shirt, spend: Math.min(12, Math.max(1, cand.funds * 0.15)), cand, office, hiring: false });
    }
  }
  cache.set(ctx.s, { t: ctx.s.tick, list });
  return list;
}

/** How an advertiser's ad reads (from what it sells; varies by day). */
export function creative(ctx: Ctx, a: Advertiser): { headline: string; tagline: string; cta: string; domain: string } {
  const f = a.firm;
  const v = hash01(a.id, dayOf(ctx.s.tick));
  const pick = <T,>(xs: T[]) => xs[Math.floor(v * xs.length) % xs.length];
  if (a.cand) {
    const last = a.name.split(' ')[1] ?? a.name;
    const party = ctx.partyById.get(a.cand.party);
    return { headline: `Vote ${last}${a.office ? ` for ${a.office}` : ''}`, tagline: a.cand.slogan, cta: 'Learn more', domain: `${last.toLowerCase()}${party ? '-' + party.short.toLowerCase().replace(/[^a-z]/g, '') : ''}.vote` };
  }
  if (!f) return { headline: a.name, tagline: '', cta: 'Learn more', domain: 'example.net' };
  const domain = f.site?.domain ?? `${f.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  const def = BUILDINGS[f.kind];
  const p = f.prices;
  switch (def.service) {
    case 'retail': return { headline: pick([`Groceries from ${(p.groceries ?? 2).toFixed(2)}`, 'Order online, delivered today', 'Everything you need, one stop', `New: electronics from ${(p.computers ?? 60).toFixed(0)}`]), tagline: f.slogan, cta: 'Shop now', domain };
    case 'meal': return { headline: pick([`Dinner from ${(p.meal ?? 5).toFixed(2)}`, 'Now delivering to your door', 'Taste the difference tonight']), tagline: f.slogan, cta: 'Order now', domain };
    case 'cars': return { headline: pick([`New cars from ${(p.cars ?? 300).toFixed(0)}`, 'Drive home today', '0% financing this week']), tagline: f.slogan, cta: 'Book a test drive', domain };
    case 'finance': return { headline: pick(['Loans for your dreams', 'Banking in your pocket', 'Your money, safe with us']), tagline: f.slogan, cta: 'Open an account', domain };
    case 'tv': return { headline: `Tonight on ${f.channel?.name ?? f.name}`, tagline: 'News you can trust', cta: 'Watch', domain };
    case 'net': return { headline: f.site ? `${f.site.name}: ${f.site.tagline}` : `Join ${f.name}`, tagline: f.site ? `${count(f.site.users)} people already joined` : f.slogan, cta: f.site && ['delivery', 'rides', 'pay'].includes(f.site.kind) ? 'Get the app' : 'Sign up', domain };
    case 'build': return { headline: pick(['We build it right', 'Your next tower, built by us', 'On time, on budget']), tagline: f.slogan, cta: 'Get a quote', domain };
    case 'freight': return { headline: 'Anything, anywhere in the city', tagline: f.slogan, cta: 'Get a quote', domain };
    case 'ads': return { headline: 'Your brand on the biggest screens in the city', tagline: 'Billboards · LED screens · columns', cta: 'Book a space', domain };
    case 'lease': return { headline: 'Office floors available now', tagline: f.slogan, cta: 'Book a viewing', domain };
    case 'admin': return { headline: a.hiring ? `${f.name} is hiring` : f.slogan, tagline: a.hiring ? f.slogan : `Professional services${a.street ? ` on ${a.street}` : ''}`, cta: a.hiring ? 'See jobs' : 'Learn more', domain };
  }
  if (def.output) return { headline: `${goodLabel(def.output)[0].toUpperCase()}${goodLabel(def.output).slice(1)} by the truckload`, tagline: `Wholesale from ${(p[def.output] ?? 0).toFixed(2)} · ${f.slogan}`, cta: 'Request a quote', domain };
  return { headline: f.slogan, tagline: f.name, cta: 'Learn more', domain };
}

function homeOf(ctx: Ctx, p: Person | undefined): Building | undefined {
  return p ? ctx.bById.get(p.home) : undefined;
}

/** The street a building is on (units in a tower: the tower's). */
export function streetOf(ctx: Ctx, b: Building): string {
  const lot = ctx.lotById.get(b.lot);
  return (lot ? ctx.edgeById.get(lot.edge)?.name : undefined) ?? '';
}

/** Weight and targeting reason of an ad for a viewer (the same factors the sim uses). */
function target(ctx: Ctx, a: Advertiser, viewer: Person | undefined): { w: number; why: string } {
  let w = a.spend;
  let why = '';
  const home = homeOf(ctx, viewer);
  const city = ctx.s.polities.find((g) => g.status !== 'gone')?.short ?? 'the city';
  if (a.geo) {
    if (home) {
      const d = Math.hypot(a.geo.x - home.x, a.geo.y - home.y);
      w *= Math.max(0.2, 1.4 - d / 900);
      if (d < 500) why = `it's near your home (${(d / 1000).toFixed(1)} km)`;
    } else {
      why = `targeted at people living near ${a.street || 'the business'}`;
    }
  }
  if (a.cand) {
    if (viewer) {
      const c = compass(viewer);
      const gap = Math.abs(a.cand.econ - c.econ);
      w *= Math.max(0.1, 1.5 - gap);
      why = gap < 0.6 ? 'it matches your views' : gap < 1.2 ? 'you\'re a voter they want to persuade' : 'you\'re a voter in this election';
    } else why = `targeted at voters ${a.cand.econ < -0.4 ? 'on the left' : a.cand.econ > 0.4 ? 'on the right' : 'in the center'}`;
  }
  if (viewer && viewer.needs.food < 50 && (a.service === 'meal' || a.service === 'retail')) { w *= 2; why = 'you might be hungry'; }
  if (viewer && viewer.job < 0 && !viewer.firms.length && a.hiring) { w *= 1.5; why = 'you\'re looking for work and they\'re hiring'; }
  if (!why) why = viewer ? `you live in ${city}` : `shown to everyone online in ${city}`;
  return { w, why };
}

/**
 * Pick `n` different ads for a viewer on a page (deterministic for this page
 * and slot, rotating every 20 game minutes). `filter` narrows the advertisers
 * (e.g. search ads that match a query).
 */
export function pickAds(ctx: Ctx, viewer: Person | undefined, n: number, slot: number, filter?: (a: Advertiser) => boolean): ShownAd[] {
  const pool = advertisers(ctx).filter((a) => !filter || filter(a));
  if (!pool.length || n <= 0) return [];
  const scored = pool.map((a) => ({ a, ...target(ctx, a, viewer) }));
  const out: ShownAd[] = [];
  const rot = Math.floor(ctx.s.tick / 20);
  for (let k = 0; k < n && scored.length; k++) {
    const total = scored.reduce((s, x) => s + x.w, 0);
    let r = hash01(slot, k, rot, viewer?.id ?? 0) * total;
    let i = 0;
    for (; i < scored.length - 1; i++) { r -= scored[i].w; if (r <= 0) break; }
    const { a, why } = scored.splice(i, 1)[0];
    out.push({ ad: a, ...creative(ctx, a), why, nav: a.firm ? `firm:${a.id}` : `person:${a.id}` });
  }
  return out;
}

/** Sites that sell ads (payments apps and crowdfunding sites live on fees). */
export function sellsAds(f: Firm): boolean {
  return !!f.site && f.site.kind !== 'pay' && f.site.kind !== 'crowd';
}

// ---------------------------------------------------------------- ad HTML

const logo = (a: Advertiser, size = 34) => `<span class="ad-logo" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.48)}px">${esc(a.name[0] ?? '?')}</span>`;
const whyHtml = (s: ShownAd) => `<span class="ad-why" title="Why am I seeing this ad? Because ${esc(s.why)}. Advertisers pay the site per view; ${esc(s.ad.name)} spends about ${s.ad.spend.toFixed(1)}/day on online ads.">ⓘ ${esc(s.why)}</span>`;
const vars = (a: Advertiser) => `--ad:${hsl(a.hue, 62, 44)};--ad-soft:${hsl(a.hue, 70, 94)};--ad-deep:${hsl(a.hue, 60, 30)}`;

/** A leaderboard banner across the page. */
export function bannerAd(s: ShownAd | undefined): string {
  if (!s) return '';
  return `<div class="ad ad-banner" data-nav="${s.nav}" style="${vars(s.ad)}">${logo(s.ad, 40)}<div class="ad-copy"><b>${esc(s.headline)}</b><span>${esc(s.ad.name)} · ${esc(s.tagline)}</span></div>
    <span class="ad-cta">${esc(s.cta)}</span><span class="ad-label">Ad</span>${whyHtml(s)}</div>`;
}

/** A box in the sidebar. */
export function boxAd(s: ShownAd | undefined): string {
  if (!s) return '';
  return `<div class="ad ad-box" data-nav="${s.nav}" style="${vars(s.ad)}"><span class="ad-label">Ad</span>
    <div class="ad-art">${logo(s.ad, 46)}<div class="ad-big">${esc(s.headline)}</div></div>
    <div class="ad-body"><b>${esc(s.ad.name)}</b><div class="ad-tag">${esc(s.tagline)}</div><span class="ad-cta">${esc(s.cta)}</span></div>${whyHtml(s)}</div>`;
}

/** An ad in a social feed: looks like a post, says "Sponsored". */
export function feedAd(s: ShownAd | undefined): string {
  if (!s) return '';
  return `<div class="sp-post sp-sponsored" style="${vars(s.ad)}"><div class="sp-av ad-av">${esc(s.ad.name[0] ?? '?')}</div><div class="sp-main">
    <div class="sp-head"><a data-nav="${s.nav}"><b>${esc(s.ad.name)}</b></a> <span class="sp-spon">Sponsored</span></div>
    <div class="sp-text">${esc(s.headline)}</div>
    <div class="ad-card" data-nav="${s.nav}"><div class="ad-card-art">${logo(s.ad, 54)}<div>${esc(s.tagline || s.ad.name)}</div></div><div class="ad-card-foot"><span>${esc(s.domain)}</span><span class="ad-cta">${esc(s.cta)}</span></div></div>
    ${whyHtml(s)}</div></div>`;
}

/** A sponsored search result. */
export function searchAd(s: ShownAd): string {
  return `<div class="se-result se-ad" data-nav="${s.nav}"><div class="se-url"><b class="se-adtag">Ad</b> · ${esc(s.domain)}</div>
    <a class="se-title">${esc(s.ad.name)}: ${esc(s.headline)}</a><div class="se-desc">${esc(s.tagline)}. ${esc(s.cta)}.</div>${whyHtml(s)}</div>`;
}

/** A pre-roll before a video. */
export function prerollAd(s: ShownAd | undefined, now: number): string {
  if (!s) return '';
  const left = 5 - (now % 6);
  return `<div class="vid-player ad-roll" data-nav="${s.nav}" style="${vars(s.ad)}">${logo(s.ad, 70)}<div class="ad-roll-h">${esc(s.headline)}</div><div class="ad-roll-t">${esc(s.ad.name)} · ${esc(s.tagline)}</div>
    <span class="ad-roll-badge">Ad · 0:0${Math.max(0, left)}</span><span class="ad-roll-skip">Skip ad ▸</span><span class="ad-cta">${esc(s.cta)}</span></div>${whyHtml(s)}`;
}
