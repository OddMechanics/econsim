// Media: television and the Net. (Advertising is in advertising.ts.)
//
// TV stations are companies with an editorial slant (their owner's, or the
// state's under a state press). Every hour they broadcast something made
// from what actually happened: news, talk shows with officials, debates
// between candidates. People watch at home in the evening and are nudged
// toward the channel's slant (agenda setting more than persuasion).
//
// The Net is websites run by internet companies: social networks that differ
// in how their feeds work, news sites, search engines, classifieds, video,
// forums, an online marketplace, a job board, home listings, a food-delivery
// app, a ride-hailing app, a payments app, crowdfunding. A founder launches
// whatever the city is missing that could pay. People join sites their
// friends are on (network effects) or that are useful to them, read their
// feeds, like and share posts (popular posters gain followers and become
// influencers); the sites earn from ads, commissions and fees.

import { MINUTES_PER_DAY } from './config';
import { controllerOf, dayOf, hourOf, log, nameOf, newId, type Ctx } from './ctx';
import { BUILDINGS, GOOD, ROLE } from './goods';
import { compass, distance, expose } from './ideology';
import { channelName, siteName } from './names';
import { onFinished } from './hooks';
import { mainPolity, polityAt, referenceWage } from './government';
import { relation } from './social';
import { staffPresent } from './tasks';
import { onlineAdsFor, pushPost, seeAd, slotsFor } from './advertising';
import { isOnline, maybeBack } from './online';
import type { Broadcast, ChatLine, Firm, Person, Post, Site, SiteKind } from './types';



// ---------------------------------------------------------------------- TV

/** When a studio opens it starts a channel; when an internet company's office opens it launches its site. */
onFinished.push((ctx, b) => {
  const f = ctx.fById.get(b.firm);
  if (!f) return;
  const owner = controllerOf(ctx, f);
  if (b.kind === 'studio' && !f.channel) {
    const used = new Set(ctx.s.firms.map((x) => x.channel?.name));
    let name = channelName(ctx.rng);
    for (let k = 0; k < 6 && used.has(name); k++) name = channelName(ctx.rng);
    const c = owner ? compass(owner) : { econ: 0, auth: 0 };
    f.channel = { name, slant: c.econ, slantAuth: c.auth, viewers: 0, adPrice: 6, onAir: -1, style: owner && owner.traits.ambition > 0.7 ? 'tabloid' : 'news' };
    log(ctx, 'media', `${f.name} went on the air as ${name}.`, { firm: f.id });
  }
  if (b.kind === 'netco' && !f.site) launchSite(ctx, f, owner);
});

/**
 * Which site the city is missing that could pay: social first (everyone
 * wants one), then what businesses and people are paying for elsewhere.
 */
function missingSite(ctx: Ctx): SiteKind {
  const have = new Set(ctx.s.firms.filter((x) => x.site && !x.closed).map((x) => x.site!.kind));
  const pop = ctx.s.people.length;
  const count = (k: string) => ctx.s.buildings.filter((b) => b.kind === k && b.built && !b.ruined).length;
  const wants: [SiteKind, boolean][] = [
    ['social', true],
    ['search', true],
    ['shop', count('store') >= 2],
    ['jobs', ctx.s.postings.length >= 4 || pop > 250],
    ['news', pop > 150],
    ['delivery', count('restaurant') >= 2],
    ['homes', ctx.s.buildings.filter((b) => (b.kind === 'apartments' || b.kind === 'tower') && b.built).length >= 3],
    ['rides', pop > 300 && ctx.s.people.filter((q) => q.car >= 0).length > 30],
    ['classifieds', true],
    ['pay', pop > 250],
    ['crowd', pop > 200],
    ['video', pop > 300],
    ['forum', true],
  ];
  return wants.find(([k, ok]) => ok && !have.has(k))?.[0] ?? 'social';
}

const TAGLINES: Record<SiteKind, string[]> = {
  social: ['Share your life', 'Your people, all in one place', 'Say it in a few words', 'Where the city talks'],
  news: ['The news, unfiltered', 'What really happened', 'Your city, every day'],
  search: ['Find anything', 'Ask the Net'],
  classifieds: ['Buy, sell, swap', 'Everything, secondhand'],
  video: ['Watch the world', 'Broadcast yourself'],
  forum: ['Speak freely', 'Anonymous and proud'],
  shop: ['Every shop in the city, one cart', 'Order now, delivered today'],
  jobs: ['Your next job is here', 'Hire better, faster'],
  homes: ['Find your place', 'Every flat in the city'],
  delivery: ['Dinner at your door', 'Hungry? Tap.'],
  rides: ['A ride in minutes', 'Get there'],
  pay: ['Pay anyone, instantly', 'Money, simplified'],
  crowd: ['Back the next big thing', 'Ideas need friends'],
};

/** Commissions and fees by kind of site (the rest of their money is ads). */
const FEES: Partial<Record<SiteKind, number>> = { shop: 0.08, delivery: 0.18, rides: 0.25, pay: 0.015, crowd: 0.05, jobs: 1.5, homes: 0.2 };

function launchSite(ctx: Ctx, f: Firm, owner: Person | undefined): void {
  const kind = missingSite(ctx);
  const used = new Set(ctx.s.firms.map((x) => x.site?.name));
  let name = siteName(ctx.rng, kind);
  for (let k = 0; k < 6 && used.has(name); k++) name = siteName(ctx.rng, kind);
  const t = owner?.traits;
  const feed: Site['feed'] = kind !== 'social' ? 'chronological' : t && t.ambition > 0.6 ? 'engagement' : t && t.sociability > 0.6 ? 'friends' : 'chronological';
  f.site = {
    name, kind, domain: `${name.toLowerCase().replace(/[^a-z]/g, '')}.${kind === 'delivery' || kind === 'rides' || kind === 'pay' ? 'app' : 'net'}`, tagline: ctx.rng.pick(TAGLINES[kind]), feed,
    anonymous: kind === 'forum', charLimit: kind === 'social' && ctx.rng.chance(0.5) ? 140 : 0, users: 0, active: 0,
    adPrice: 3, subscription: 0, quality: 0.3, color: f.hue, launched: ctx.s.tick, cpm: 2, impressions: 0, adRevenue: 0, fee: FEES[kind], volume: 0,
  };
  f.website = true;
  const what: Partial<Record<SiteKind, string>> = {
    social: `a social network with ${feed === 'engagement' ? 'an engagement-ranked' : feed === 'friends' ? 'a friends-only' : 'a chronological'} feed`,
    shop: 'an online marketplace for the city\'s shops', jobs: 'a job board', homes: 'a site for flats and homes', delivery: 'a food-delivery app',
    rides: 'a ride-hailing app', pay: 'a payments app', crowd: 'a crowdfunding site', search: 'a search engine',
  };
  log(ctx, 'media', `${f.name} launched ${name} (${f.site.domain}), ${what[kind] ?? `a ${kind} site`}.`, { firm: f.id });
}

export const SHOWS: Record<number, { show: string; kind: Broadcast["kind"] }> = {
  7: { show: 'Morning News', kind: 'news' }, 8: { show: 'Good Morning City', kind: 'talk' },
  12: { show: 'Noon Report', kind: 'news' }, 13: { show: 'Afternoon Matinee', kind: 'entertainment' },
  18: { show: 'Evening News', kind: 'news' }, 19: { show: 'The Business Hour', kind: 'talk' },
  20: { show: 'Talk of the City', kind: 'talk' }, 21: { show: 'Prime Time Drama', kind: 'entertainment' }, 22: { show: 'Late News', kind: 'news' },
};

/** Hourly: each channel airs its show (if someone's in the studio). */
export function tvHourly(ctx: Ctx): void {
  const h = hourOf(ctx.s.tick);
  for (const f of ctx.s.firms) {
    if (!f.channel || f.closed) continue;
    const studio = ctx.bById.get(f.sites.find((id) => ctx.bById.get(id)?.kind === 'studio') ?? -1);
    let slot = SHOWS[h];
    const debate = ctx.s.events.find((e) => e.kind === 'debate' && e.channel === f.id && e.start <= ctx.s.tick && e.end > ctx.s.tick);
    if (debate) slot = { show: 'Election Debate', kind: 'debate' };
    if (!slot) { f.channel.onAir = -1; continue; }
    if (!studio || !studio.built || (!staffPresent(ctx, studio.id, 'presenter') && !debate)) { f.channel.onAir = -1; continue; }
    const presenter = ctx.s.people.find((p) => p.inside === studio.id && ctx.cById.get(p.job)?.role === 'presenter') ?? controllerOf(ctx, f);
    const b = makeBroadcast(ctx, f, slot.show, slot.kind, presenter, debate?.id);
    ctx.s.broadcasts.push(b);
    if (ctx.s.broadcasts.length > 80) ctx.s.broadcasts.shift();
    f.channel.onAir = b.id;
  }
}

/** The state's line (under a state press) or the owner's. */
function slantOf(ctx: Ctx, f: Firm): { econ: number; auth: number } {
  const studio = ctx.bById.get(f.sites[0]);
  const g = studio ? polityAt(ctx, studio.x, studio.y) : mainPolity(ctx);
  if (g && g.charter.press === 'state') {
    const head = ctx.byId.get(g.offices.find((o) => o.kind === 'exec')?.holder ?? -1);
    if (head) return compass(head);
  }
  return { econ: f.channel?.slant ?? 0, auth: f.channel?.slantAuth ?? 0 };
}

function makeBroadcast(ctx: Ctx, f: Firm, show: string, kind: Broadcast['kind'], host: Person | undefined, event?: number): Broadcast {
  const s = slantOf(ctx, f);
  const lines: ChatLine[] = [];
  const say = (who: number, text: string) => lines.push({ t: ctx.s.tick, who, text });
  const hid = host?.id ?? f.id;
  const g = mainPolity(ctx);
  const state = g?.charter.press === 'state';
  let title = show;
  if (kind === 'news') {
    say(hid, `Good ${hourOf(ctx.s.tick) < 12 ? 'morning' : 'evening'}, this is ${show} on ${f.channel!.name}.`);
    const since = ctx.s.tick - 14 * 60;
    const items = ctx.s.log.filter((l) => l.t >= since && ['politics', 'law', 'business', 'death', 'build', 'event', 'media'].includes(l.kind));
    // agenda setting: what the channel covers depends on its slant (and censorship)
    const scored = items.map((l) => ({ l, w: newsWeight(l.text, s.econ, s.auth, state) + ctx.rng.next() * 0.5 })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 4);
    for (const { l } of scored) say(hid, frame(l.text, s.econ, state));
    if (!scored.length) say(hid, 'A quiet day in the city.');
    title = scored[0] ? scored[0].l.text.slice(0, 70) : 'A quiet day';
    const unemployed = ctx.s.people.filter((p) => p.job < 0 && !p.firms.length).length / Math.max(1, ctx.s.people.length);
    if (ctx.rng.chance(0.5)) say(hid, `Joblessness stands at ${(unemployed * 100).toFixed(0)}%. ${unemployed > 0.25 ? (s.econ < 0 ? 'Working families are hurting.' : 'Critics blame high taxes.') : 'The economy is holding up.'}`);
  } else if (kind === 'debate') {
    const ev = ctx.s.events.find((e) => e.id === event);
    if (ev) { lines.push(...ev.lines.slice(-6)); title = ev.title; }
  } else if (kind === 'talk') {
    const guest = g ? ctx.byId.get(g.offices.filter((o) => o.holder >= 0)[Math.floor(ctx.rng.next() * Math.max(1, g.offices.length))]?.holder ?? -1) : undefined;
    if (guest) {
      title = `${show}: ${guest.name}`;
      const c = compass(guest);
      say(hid, `Joining us tonight: ${guest.name}. What's the city's biggest problem?`);
      say(guest.id, c.econ < -0.4 ? 'Too many people working hard and still struggling. We need fair wages and decent homes.' : c.econ > 0.4 ? 'Taxes and red tape. Let people build and businesses grow.' : 'We need to get the basics right: roads, jobs, safety.');
      say(hid, s.econ * c.econ < 0 ? 'Some would say that\'s exactly the wrong approach.' : 'Many of our viewers would agree.');
      say(guest.id, c.auth > 0.5 ? 'What this city needs is order and someone willing to make hard decisions.' : 'The people of this city can decide for themselves.');
    } else {
      say(hid, 'Tonight: what\'s new in the city, and what\'s next.');
    }
  } else {
    title = ctx.rng.pick(['"Love on Main Street", episode ' + (1 + dayOf(ctx.s.tick) % 40), 'The Big Quiz', 'Sports Highlights', 'Cooking with ' + (host?.name.split(' ')[0] ?? 'Chef')]);
    say(hid, ctx.rng.pick(['Stay tuned!', 'And now, the moment you\'ve been waiting for…', 'Don\'t go away.']));
  }
  return { id: newId(ctx), channel: f.id, t: ctx.s.tick, show, kind, title, lines, slant: s.econ, viewers: 0, ads: slotsFor(ctx, f.id), event };
}

function newsWeight(text: string, econ: number, auth: number, censored: boolean): number {
  const t = text.toLowerCase();
  let w = 0.4;
  if (t.includes('protest') || t.includes('revolution') || t.includes('coup')) w = censored ? -1 : 1.5 - 0.4 * auth;
  if (t.includes('election') || t.includes('voted') || t.includes('campaign') || t.includes('referendum')) w = 1.3;
  if (t.includes('passed') || t.includes('failed') || t.includes('decree')) w = 1.1;
  if (t.includes('closed') || t.includes('bankrupt') || t.includes('liquidat') || t.includes('evicted')) w = 0.9 - 0.4 * econ;
  if (t.includes('opened') || t.includes('founded') || t.includes('expanding')) w = 0.8 + 0.4 * econ;
  if (t.includes('nationaliz')) w = 1.2;
  if (t.includes('died')) w = 0.7;
  if (censored && (t.includes('failed') || t.includes('strike'))) w -= 0.6;
  return w;
}

/** The same fact, told with a slant. */
function frame(text: string, econ: number, censored: boolean): string {
  const t = text.replace(/\.$/, '');
  const lt = t.toLowerCase();
  if (lt.includes('protest')) return censored ? 'A small group of troublemakers disturbed the peace downtown.' : econ < 0 ? `${t}. Their anger is understandable.` : `${t}. Shop owners worry about disorder.`;
  if (lt.includes('closed') || lt.includes('bankrupt')) return econ < 0 ? `${t}. More workers left out in the cold.` : `${t}. A tough market weeds out the weak.`;
  if (lt.includes('nationaliz')) return econ < 0 ? `${t}, a win for the public.` : `${t}. Investors are alarmed.`;
  if (lt.includes('tax')) return econ < 0 ? `${t}.` : `${t}. Another burden on hardworking families?`;
  return `${t}.`;
}

/** What someone watching TV right now sees and how it affects them. */
export function watchMinute(ctx: Ctx, p: Person, dt = 1): string | null {
  let ch = ctx.fById.get(p.pol.tv);
  if (!ch?.channel || ch.closed || ch.channel.onAir < 0) {
    // pick a channel: one that's on, closer to their views, or the one with the bigger audience
    const on = ctx.s.firms.filter((f) => f.channel && !f.closed && f.channel.onAir >= 0);
    if (!on.length) return null;
    ch = on.reduce((a, b) => (scoreChannel(p, b) > scoreChannel(p, a) ? b : a));
    p.pol.tv = ch.id;
  }
  const channel = ch.channel!;
  const b = ctx.s.broadcasts.find((x) => x.id === channel.onAir);
  if (!b) return null;
  // every quarter hour: counted in the audience, the show and its ads sink in
  const quarters = Math.floor(ctx.s.tick / 15) - Math.floor((ctx.s.tick - dt) / 15);
  for (let i = 0; i < quarters; i++) {
    b.viewers++;
    if (b.kind === 'news' || b.kind === 'talk' || b.kind === 'propaganda') expose(p, b.slant, channel.slantAuth, 0.6);
    for (const sponsor of b.ads) if (ctx.rng.chance(0.3)) seeAd(ctx, p, sponsor, 0.03);
    if (b.kind === 'debate') {
      const ev = ctx.s.events.find((e) => e.id === b.event);
      for (const id of ev?.speakers ?? []) p.pol.aware[id] = Math.min(1, (p.pol.aware[id] ?? 0) + 0.05);
      const winner = ev?.data?.winner;
      if (winner) p.pol.aware[winner] = Math.min(1, (p.pol.aware[winner] ?? 0) + 0.04);
    }
  }
  return `${b.show} on ${channel.name}`;
}

function scoreChannel(p: Person, f: Firm): number {
  const c = compass(p);
  return -Math.abs(c.econ - (f.channel?.slant ?? 0)) * 0.6 + Math.log(1 + (f.channel?.viewers ?? 0)) * 0.3 + (p.pol.aware[f.id] ?? 0);
}

/** Daily: audiences counted, ad prices follow the audience. */
export function mediaDaily(ctx: Ctx): void {
  const d = dayOf(ctx.s.tick);
  for (const f of ctx.s.firms) {
    if (f.channel) {
      const viewers = ctx.s.broadcasts.filter((b) => b.channel === f.id && dayOf(b.t) === d - 1).reduce((s, b) => s + b.viewers, 0);
      f.channel.viewers = Math.round(0.6 * f.channel.viewers + 0.4 * viewers);
      f.channel.adPrice = Math.max(2, 2 + f.channel.viewers * 0.12);
      // the owner's views drift into the channel's line
      const owner = controllerOf(ctx, f);
      if (owner) { f.channel.slant = 0.95 * f.channel.slant + 0.05 * owner.pol.econ; f.channel.slantAuth = 0.95 * f.channel.slantAuth + 0.05 * owner.pol.auth; }
    }
    if (f.site) {
      const site = f.site;
      site.users = ctx.s.people.filter((p) => p.pol.sites.includes(f.id)).length;
      site.active = Math.round(0.5 * site.active + 0.5 * (siteVisits.get(f.id) ?? 0));
      // what an advertiser pays for a thousand views
      site.cpm = site.impressions ? Math.max(0.5, ((site.adRevenue ?? 0) / site.impressions) * 1000) : site.cpm;
      site.impressions = 0;
      site.adPrice = Math.max(1.5, 1.5 + site.active * 0.06);
      // programmers make the site better
      const coders = ctx.s.contracts.filter((c) => c.firm === f.id && c.role === 'programmer').length;
      site.quality = Math.min(1, Math.max(0.1, site.quality + coders * 0.01 - 0.004));
      site.volume = 0;
    }
  }
  siteVisits.clear();
  joinSites(ctx);
  // followers fade unless people keep posting things others like
  for (const p of ctx.s.people) if (p.followers) p.followers = Math.max(0, p.followers * 0.98 - 0.1);
}

// --------------------------------------------------------------------- Net

const siteVisits = new Map<number, number>();

/** Would this person find a kind of site useful (apps and services, not just reading)? */
function useful(ctx: Ctx, p: Person, kind: SiteKind): number {
  switch (kind) {
    case 'social': return 0;
    case 'shop': return 0.04 + 0.04 * p.traits.comfortLove;
    case 'jobs': return p.job < 0 && !p.firms.length ? 0.25 : 0.02 * p.traits.ambition;
    case 'homes': { const h = ctx.bById.get(p.home); return !h || h.kind === 'trailer' || h.kind === 'apartments' || h.kind === 'tower' ? 0.12 : 0.01; }
    case 'delivery': return 0.03 + 0.05 * p.traits.comfortLove;
    case 'rides': return p.car < 0 ? 0.06 : 0.04 * p.traits.risk; // passengers, and drivers looking for a gig
    case 'pay': return 0.02 + 0.04 * p.traits.curiosity;
    case 'crowd': return 0.01 + 0.03 * p.traits.curiosity + (p.firms.length ? 0.03 : 0);
    case 'search': return 0.08;
    default: return 0.03 + 0.05 * p.traits.curiosity;
  }
}

/** People with a phone or computer sign up for sites: social ones where their friends are (network effects), others when useful. */
function joinSites(ctx: Ctx): void {
  const sites = ctx.s.firms.filter((f) => f.site && !f.closed);
  if (!sites.length) return;
  const ids = new Set(sites.map((f) => f.id));
  for (const p of ctx.s.people) {
    if (!isOnline(p)) continue;
    p.pol.sites = p.pol.sites.filter((id) => ids.has(id));
    for (const f of sites) {
      if (p.pol.sites.includes(f.id)) {
        // leave a bad, empty site now and then
        if (f.site!.quality < 0.2 && ctx.rng.chance(0.03)) p.pol.sites = p.pol.sites.filter((id) => id !== f.id);
        continue;
      }
      let friendsOn = 0, friends = 0;
      for (const [id, r] of Object.entries(p.rel)) {
        if (r.fam < 3) continue;
        friends++;
        if (ctx.byId.get(+id)?.pol.sites.includes(f.id)) friendsOn++;
      }
      const network = friends ? friendsOn / friends : 0;
      const kind = f.site!.kind;
      const pJoin = (kind === 'social' ? 0.02 + 0.25 * network * (0.5 + p.traits.sociability) : useful(ctx, p, kind) + 0.05 * network)
        * (0.5 + f.site!.quality) + 0.1 * (p.pol.aware[f.id] ?? 0);
      if (ctx.rng.chance(pJoin)) p.pol.sites.push(f.id);
    }
  }
}

export function online(p: Person): boolean {
  return isOnline(p);
}

/**
 * A person spends a few minutes on the Net (phone or computer). They see
 * ads chosen for them, read and post, check listings, back a campaign.
 * Returns what they're doing, for the activity text.
 */
export function browseMinute(ctx: Ctx, p: Person, elapsed: number, from = elapsed - 1): string {
  const sites = p.pol.sites.map((id) => ctx.fById.get(id)).filter((f): f is Firm => !!f?.site && !f.closed);
  if (!sites.length) return 'browsing the web';
  const f = sites[(Math.floor(elapsed / 12) + p.id) % sites.length];
  const site = f.site!;
  // a new site every 12 minutes (several at once when a stretch of browsing is simulated in one go)
  const visits = Math.min(3, Math.floor(elapsed / 12) - Math.floor(from / 12));
  for (let i = 0; i < visits; i++) {
    siteVisits.set(f.id, (siteVisits.get(f.id) ?? 0) + 1);
    if (site.kind === 'social' || site.kind === 'forum' || site.kind === 'news') {
      for (const post of feed(ctx, p, f, 4)) readPost(ctx, p, post, site);
      if (ctx.rng.chance(0.12 + 0.2 * p.traits.sociability)) postOnline(ctx, p, undefined, f.id);
    }
    // the ads the site shows them (feed ads, sponsored results, banners, pre-rolls)
    onlineAdsFor(ctx, p, f.id, site.kind === 'social' || site.kind === 'video' ? 6 : site.kind === 'pay' || site.kind === 'crowd' ? 1 : 3);
    for (const sponsor of slotsFor(ctx, f.id)) if (ctx.rng.chance(0.25)) seeAd(ctx, p, sponsor, 0.02);
    if (site.kind === 'classifieds' || site.kind === 'jobs') p.knownJobs = ctx.s.tick;
    if (site.kind === 'classifieds' || site.kind === 'homes') p.knownHomes = ctx.s.tick;
    if (site.kind === 'crowd') maybeBack(ctx, p);
  }
  // the city's own website: out of work and short of money, they file a claim for welfare online
  if (from < 3 && elapsed >= 3 && p.job < 0 && !p.firms.length && p.money < 80 && (p.cooldown.welfare ?? 0) < ctx.s.tick) p.cooldown.welfare = ctx.s.tick + 30 * 1440;
  const doing: Partial<Record<SiteKind, string>> = { shop: 'shopping on', jobs: 'looking at jobs on', homes: 'looking at flats on', video: 'watching videos on', search: 'searching on', crowd: 'looking at projects on', pay: 'paying a bill on' };
  return `${doing[site.kind] ?? 'on'} ${site.name}`;
}

/** The latest posts on each site (gathered once a minute for everyone browsing). */
const recentCache = new WeakMap<object, { t: number; n: number; m: Map<number, Post[]> }>();
function recentPosts(ctx: Ctx, site: number): Post[] {
  let c = recentCache.get(ctx.s);
  // rebuilt each minute, and when someone posts (the list grows)
  if (!c || c.t !== ctx.s.tick || c.n !== ctx.s.posts.length) {
    const m = new Map<number, Post[]>();
    for (const x of ctx.s.posts) { const k = x.site ?? -1; const l = m.get(k); if (l) l.push(x); else m.set(k, [x]); }
    for (const [k, l] of m) if (l.length > 100) m.set(k, l.slice(-100));
    c = { t: ctx.s.tick, n: ctx.s.posts.length, m };
    recentCache.set(ctx.s, c);
  }
  return c.m.get(site) ?? [];
}

/** A person's feed on a site: chronological, ranked by engagement, or friends only. */
export function feed(ctx: Ctx, p: Person, f: Firm, n: number): Post[] {
  const site = f.site!;
  const posts = recentPosts(ctx, f.id).filter((x) => x.who !== p.id).slice(-80);
  const friend = (id: number) => (p.rel[id]?.fam ?? 0) > 2;
  let pool = site.feed === 'friends' ? posts.filter((x) => friend(x.who)) : posts;
  if (!pool.length) pool = posts;
  if (site.feed === 'engagement') {
    // what gets reactions rises: likes, shares, and politics that agrees with the reader
    const c = compass(p);
    return pool.map((x) => ({ x, s: x.likes + 2 * (x.shares ?? 0) + (x.topic === 'politics' && x.slant !== undefined ? 6 - 4 * Math.abs(x.slant - c.econ) : 0) + (friend(x.who) ? 4 : 0) - (ctx.s.tick - x.t) / 120 }))
      .sort((a, b) => b.s - a.s).slice(0, n).map((y) => y.x);
  }
  return pool.slice(-n).reverse();
}

function readPost(ctx: Ctx, p: Person, post: Post, site: Site): void {
  post.views = (post.views ?? 0) + 1;
  if (post.topic === 'politics' && post.slant !== undefined) {
    const author = ctx.byId.get(post.who);
    expose(p, post.slant, author ? compass(author).auth : 0, site.anonymous ? 0.6 : 0.4);
    if (Math.abs(post.slant - compass(p).econ) < 0.6 && ctx.rng.chance(0.3)) { post.likes++; if (ctx.rng.chance(0.2)) post.shares = (post.shares ?? 0) + 1; }
  } else if ((p.rel[post.who]?.fam ?? 0) > 2 && ctx.rng.chance(0.3) || ctx.rng.chance(0.04 + 0.03 * Math.log10(1 + (ctx.byId.get(post.who)?.followers ?? 0)))) {
    post.likes++;
    const author = ctx.byId.get(post.who);
    if (author) {
      relation(p, author).fam += 0.05;
      // liked posts win followers (some become influencers): the more they already have, the faster it grows
      if (ctx.rng.chance(0.4 + Math.min(0.4, (author.followers ?? 0) / 100))) author.followers = (author.followers ?? 0) + 1 + (post.shares ?? 0) * 0.2;
    }
  }
  if (post.sponsor !== undefined) seeAd(ctx, p, post.sponsor, ctx.byId.has(post.who) ? 0.04 * (0.5 + (p.rel[post.who]?.trust ?? 0.3)) : 0.02);
  else if (ctx.byId.get(post.who) === undefined && ctx.fById.has(post.who)) seeAd(ctx, p, post.who, 0.01);
}

/**
 * A person posts something (on a given site, or wherever they have an
 * account). Politically engaged people post about politics, with a slant.
 */
export function postOnline(ctx: Ctx, p: Person, text?: string, siteId?: number): void {
  const site = siteId ?? p.pol.sites.find((id) => ctx.fById.get(id)?.site?.kind === 'social') ?? p.pol.sites[0];
  if (text) { pushPost(ctx, { who: p.id, text, site, topic: 'life' }); return; }
  const r = ctx.rng;
  const c = compass(p);
  const forum = ctx.fById.get(site ?? -1)?.site?.anonymous;
  if (r.chance(0.15 + 0.5 * p.pol.engagement) && (p.pol.engagement > 0.35 || forum)) {
    pushPost(ctx, { who: p.id, text: politicalPost(ctx, p, !!forum), site, topic: 'politics', slant: c.econ });
    return;
  }
  const options: string[] = [];
  const job = ctx.cById.get(p.job);
  if (job) {
    const f = nameOf(ctx, job.firm);
    options.push(`Another day at ${f}. ${r.pick(['Tired but proud.', 'Coffee needed.', 'Good team.', 'The boss was in a mood today.'])}`);
    if (job.unpaid > 0) options.push(`${f} still owes me money. Not cool.`);
    if (job.noticeEnd > 0) options.push(`Lost my job at ${f}. Anyone hiring a ${ROLE[job.role].label}?`);
  } else if (!p.firms.length) options.push(r.pick(['Looking for work, any leads? 🙏', 'Job hunting is exhausting.', 'Anyone need a hand? I work hard.']));
  const home = ctx.bById.get(p.home);
  if (!home) options.push('Still no place to live. Sleeping rough again tonight.');
  else if (home.kind === 'apartments' || home.kind === 'tower') {
    const rent = home.units[p.unit]?.rent ?? 0;
    options.push(rent > referenceWage(ctx) * 0.35 ? `Rent is ${rent.toFixed(1)} a day now. How is anyone supposed to afford that?` : 'Loving my apartment, great view.');
  } else if (home.kind === 'house') options.push(r.pick(['Weekend project: fixing the porch.', 'Nothing beats having your own house.']));
  else if (home.kind === 'trailer') options.push(r.pick(['Trailer life. It\'s cheap, at least.', 'Saving up to get out of this trailer.']));
  if (p.gig?.jobs) options.push(r.pick([`${p.gig.jobs} deliveries this week. My feet hurt.`, 'The apps take a huge cut, just saying.', 'Gig life: no boss, no benefits.']));
  if (ctx.s.shipments.some((x) => x.recipient === p.id)) options.push(r.pick(['Waiting for my package like 👀', 'Ordered online again, oops.']));
  if (p.car >= 0) options.push(r.pick(['New tires. Expensive.', 'Traffic downtown is getting worse.', 'Road trip this weekend!', 'Why are half the streets still dirt?']));
  if (p.pol.party >= 0) options.push(`Proud member of the ${ctx.partyById.get(p.pol.party)?.name ?? 'party'}. Join us!`);
  const pal = Object.entries(p.rel).filter(([, x]) => x.trust > 0.5).map(([id]) => ctx.byId.get(+id)).find(Boolean);
  if (pal) options.push(r.pick([`Great evening with ${pal.name.split(' ')[0]}.`, `Happy birthday ${pal.name.split(' ')[0]}! 🎉`, `${pal.name.split(' ')[0]} and I finally tried that new place.`]));
  const shop = ctx.s.firms.filter((f) => !f.closed && (f.kind === 'restaurant' || f.kind === 'store'))[Math.floor(r.next() * 5)];
  if (shop) options.push(r.pick([`${shop.name} is ${r.pick(['so good', 'overpriced', 'my new favorite', 'always closed when I go'])}.`]));
  if (p.needs.food < 30) options.push(r.pick(['So hungry. Payday can\'t come soon enough.', 'Food prices are insane.']));
  if (p.mood > 0.75) options.push(r.pick(['What a great day in the city! ☀️', 'Life is good.', 'Grateful for this community.']));
  if (p.mood < 0.35) options.push(r.pick(['Rough week.', 'Everything is so expensive.', 'Need a break.']));
  if (p.happy > 0.7 && p.money > 500) options.push(r.pick(['Treated myself today. 🛍️', 'Hard work pays off.']));
  // nobody posts the same thing twice in a row
  const last = ctx.s.posts.filter((x) => x.who === p.id).slice(-3).map((x) => x.text);
  const fresh = options.filter((o) => !last.includes(o));
  if (!fresh.length) return;
  pushPost(ctx, { who: p.id, text: r.pick(fresh), site, topic: 'life' });
}

function politicalPost(ctx: Ctx, p: Person, anon: boolean): string {
  const r = ctx.rng;
  const c = compass(p);
  const g = mainPolity(ctx);
  const head = g ? ctx.byId.get(g.offices.find((o) => o.kind === 'exec')?.holder ?? -1) : undefined;
  const likesHead = head ? distance(compass(head), c) < 1 : false;
  const out: string[] = [];
  if (head) out.push(likesHead ? `${head.name} is doing a solid job. Haters gonna hate.` : `${head.name} has to go. ${anon ? 'Worst leader this city has ever had.' : 'We deserve better.'}`);
  if (c.econ < -0.6) out.push(r.pick(['Tax the rich. Simple as that.', 'Landlords are bleeding this city dry.', 'Workers built this city, not the bosses.', 'Healthcare, housing, jobs: are those too much to ask?']));
  if (c.econ > 0.6) out.push(r.pick(['Taxes are theft with extra steps.', 'Let businesses breathe and everyone wins.', 'Welfare just keeps people from working.', 'The government should get out of the way.']));
  if (c.auth > 0.7) out.push(r.pick(['We need more police on the streets.', 'Law and order. Is that so hard?', 'Too many newcomers, too fast.']));
  if (c.auth < -0.7) out.push(r.pick(['Hands off our freedoms.', 'Nobody voted for this.', 'Question everything they tell you.']));
  const e = ctx.s.elections.find((x) => x.status === 'campaign');
  if (e && e.candidates.length) {
    const fav = e.candidates.reduce((a, b) => (distance(c, b) < distance(c, a) ? b : a));
    const name = ctx.byId.get(fav.person)?.name;
    if (name) out.push(`Voting ${name} on election day. ${fav.slogan}!`);
  }
  if (!out.length) out.push(r.pick(['Politics in this city is a circus.', 'Did anyone watch the council last night?', 'Both sides are as bad as each other.']));
  return r.pick(out) + (anon && r.chance(0.3) ? ' Wake up people.' : '');
}

/** A company posts on its own page / the sites (ads and job openings). */
export function firmPost(ctx: Ctx, f: Firm): void {
  const r = ctx.rng;
  const options: string[] = [];
  const def = BUILDINGS[f.kind];
  if (def.output && f.prices[def.output]) options.push(`${f.name}: ${GOOD[def.output].label} for ${f.prices[def.output]!.toFixed(2)} each. ${f.slogan}.`);
  if (def.service === 'retail' && f.prices.groceries) options.push(`Fresh groceries at ${f.name}, only ${f.prices.groceries.toFixed(2)}! ${f.slogan}.`);
  if (def.service === 'meal' && f.prices.meal) options.push(`Tonight at ${f.name}: chef's special for ${f.prices.meal.toFixed(2)}. 🍽️`);
  if (def.service === 'cars' && f.prices.cars) options.push(`New cars in stock at ${f.name}! From ${f.prices.cars.toFixed(0)}.`);
  if (def.service === 'freight') options.push(`${f.name} delivers anywhere in the city. ${f.slogan}.`);
  if (def.service === 'build') options.push(`Need a building? ${f.name} builds it. ${f.slogan}.`);
  if (f.channel) options.push(`Tonight on ${f.channel.name}: ${SHOWS[20].show} at 8.`);
  if (f.site) options.push(`${f.site.name}: ${f.site.tagline}. ${f.site.users} people already joined.`);
  const g = ctx.govOfFirm.get(f.id);
  if (g) options.push(g.nextElection > 0 ? `${g.name}: the next election is on day ${Math.floor(g.nextElection / MINUTES_PER_DAY) + 1}. Make sure you vote!` : `${g.name}: the council meets on day ${Math.floor(g.nextSession / MINUTES_PER_DAY) + 1}.`);
  const post = ctx.s.postings.find((p) => p.firm === f.id);
  if (post) options.push(`We're hiring! ${ROLE[post.role].label} wanted at ${f.name}, ${post.wage.toFixed(0)} per shift.`);
  if (!options.length) options.push(`${f.name}. ${f.slogan}.`);
  // on the most-used social site if it has one, otherwise on their own website
  const social = ctx.s.firms.filter((x) => x.site?.kind === 'social' && !x.closed).sort((a, b) => b.site!.users - a.site!.users)[0];
  pushPost(ctx, { who: f.id, text: r.pick(options), site: social?.id ?? -1, topic: post ? 'work' : 'ad' });
}

