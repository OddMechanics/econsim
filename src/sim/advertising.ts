// Advertising: how companies (and campaigns) pay to be noticed, and who
// earns from it.
//
// Budgets. Companies spend a share of their sales on ads, like real ones:
// shops, restaurants, car dealers, banks and websites ~4–10%, companies that
// sell to other companies ~1–2%. Ambitious owners spend more; a new business
// runs an opening campaign. The money goes to:
//  - Street ads. Outdoor advertising companies own billboards (on legs on
//    empty lots by busy roads, on roof frames), big LED screens on downtown
//    towers (several ads rotating) and ad columns on downtown sidewalks; they
//    rent them out by the week and pay the land or building owner. Empty
//    spaces show "Advertise here". Before there's an ad company, businesses
//    rent billboard spots from owners directly. Everyone puts posters on
//    their own walls, and campaigns tape flyers to lamps (free, few read them).
//  - Online ads, sold by the city's websites by audience: feed ads and
//    sponsored posts on social networks, sponsored results on search engines
//    and marketplaces, banners on news and classifieds sites, ads before
//    videos. Sites target: people see ads for things near them and things
//    they need (the hungry see restaurants, job seekers see employers,
//    voters see candidates close to their views). Without a local site, the
//    budget goes to outside platforms (the money leaves the city).
//  - TV ads on the best-watched channel.
//  - Influencers: people with many followers get paid for posts.
// What it buys: awareness (a brand people have heard of is the one they
// pick), contacts (companies find suppliers through ads and search), votes.

import { MINUTES_PER_DAY } from './config';
import { addCash, controllerOf, dayOf, nameOf, newId, pay, type Ctx } from './ctx';
import { BUILDINGS, GOOD } from './goods';
import { FLOOR_H } from './layout';
import { compass, distance, expose } from './ideology';
import { streetLamps } from './street';
import { borrow } from './finance';
import { TOWERS } from './goods';
import { heardOfFirm } from './places';
import { poll } from './elections';
import { tally } from './stats';
import type { AdChannel, AdLogEntry, AdPlacement, Election, Firm, Person, Post } from './types';

// ------------------------------------------------------------------ spots

/** Street lamp spots (along paved streets) where flyers get taped up: the same layout the renderer draws lamps at. */
export function lampSpots(ctx: Ctx): { x: number; y: number; dir: number; edge: number }[] {
  return streetLamps(ctx.s.roads, ctx.nodeById, ctx.edgeById);
}

/** Runtime spatial grid of ads for exposure checks. */
const adGrid = new WeakMap<object, { n: number; t: number; cells: Map<number, AdPlacement[]> }>();
const AD_CELL = 60;

function adsNear(ctx: Ctx, x: number, y: number): AdPlacement[] {
  let grid = adGrid.get(ctx.s);
  if (!grid || grid.n !== ctx.s.ads.length || ctx.s.tick - grid.t > 120) {
    const cells = new Map<number, AdPlacement[]>();
    for (const a of ctx.s.ads) {
      if (a.sponsor < 0) continue;
      const k = Math.floor(a.x / AD_CELL) * 1000 + Math.floor(a.y / AD_CELL);
      const arr = cells.get(k);
      if (arr) arr.push(a); else cells.set(k, [a]);
    }
    grid = { n: ctx.s.ads.length, t: ctx.s.tick, cells };
    adGrid.set(ctx.s, grid);
  }
  const out: AdPlacement[] = [];
  const cx = Math.floor(x / AD_CELL), cy = Math.floor(y / AD_CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const arr = grid.cells.get((cx + dx) * 1000 + cy + dy);
    if (arr) for (const a of arr) out.push(a);
  }
  return out;
}

function addAd(ctx: Ctx, a: Omit<AdPlacement, 'id' | 'created'>): AdPlacement {
  const ad: AdPlacement = { ...a, id: newId(ctx), created: ctx.s.tick };
  ctx.s.ads.push(ad);
  return ad;
}

/** A poster on a side wall of a building (blank walls are where posters go). */
export function posterOn(ctx: Ctx, b: { x: number; y: number; angle: number; w: number; d: number; id: number }, sponsor: number, headline: string, tagline: string, hue: number, topic: AdPlacement['topic'], days: number): AdPlacement | null {
  const taken = ctx.s.ads.filter((a) => a.building === b.id && a.kind === 'poster').length;
  if (taken >= 4) return null;
  const side = taken % 2 ? 1 : -1;
  const perp = b.angle + side * Math.PI / 2;
  const along = (Math.floor(taken / 2) - 0.5) * Math.min(3, b.d / 3);
  const x = b.x + Math.cos(perp) * (b.w / 2 + 0.06) + Math.cos(b.angle) * along;
  const y = b.y + Math.sin(perp) * (b.w / 2 + 0.06) + Math.sin(b.angle) * along;
  return addAd(ctx, { kind: 'poster', x, y, z: 2.3, angle: perp, w: 1.2, h: 1.7, building: b.id, sponsor, headline, tagline, hue, topic, expires: ctx.s.tick + days * MINUTES_PER_DAY });
}

/** A fabric banner on a business's own facade (above the door). */
function bannerOn(ctx: Ctx, f: Firm, headline: string, tagline: string, days: number): AdPlacement | null {
  const b = ctx.bById.get(f.sites[0]);
  if (!b || !b.built || b.host !== undefined || ctx.s.ads.some((a) => a.building === b.id && a.kind === 'banner')) return null;
  const w = Math.min(6, b.w * 0.5);
  const x = b.x + Math.cos(b.angle) * (b.d / 2 + 0.2), y = b.y + Math.sin(b.angle) * (b.d / 2 + 0.2);
  return addAd(ctx, { kind: 'banner', x, y, z: Math.min(b.floors * FLOOR_H - 0.8, 4.2), angle: b.angle, w, h: 1.1, building: b.id, sponsor: f.id, headline, tagline, hue: f.hue, topic: 'product', expires: ctx.s.tick + days * MINUTES_PER_DAY });
}

/** Where a new billboard could stand: on legs on an empty lot by a busy road, or on a roof frame downtown. */
function billboardSpot(ctx: Ctx): Omit<AdPlacement, 'id' | 'created' | 'sponsor' | 'headline' | 'tagline' | 'hue' | 'topic' | 'expires'> | null {
  const used = new Set(ctx.s.ads.filter((a) => a.kind === 'billboard').map((a) => a.building));
  const lots = ctx.s.roads.lots.filter((l) => l.building < 0 && !used.has(-l.id) && ctx.edgeById.get(l.edge)?.kind !== 'street');
  const roofs = ctx.s.buildings.filter((b) => b.built && !b.ruined && b.host === undefined && b.floors >= 2 && b.floors <= 8 && !used.has(b.id) && b.kind !== 'cityhall' && !TOWERS.includes(b.kind));
  const lot = ctx.rng.chance(0.55) && lots.length ? lots[Math.floor(ctx.rng.next() * lots.length)] : undefined;
  if (lot) {
    const x = lot.x + Math.cos(lot.angle) * (lot.d / 2 - 2), y = lot.y + Math.sin(lot.angle) * (lot.d / 2 - 2);
    return { kind: 'billboard', x, y, z: 5.5, angle: lot.angle, w: 9, h: 3, building: -lot.id };
  }
  const b = roofs.length ? roofs[Math.floor(ctx.rng.next() * roofs.length)] : undefined;
  if (!b) return null;
  return { kind: 'billboard', x: b.x + Math.cos(b.angle) * (b.d / 4), y: b.y + Math.sin(b.angle) * (b.d / 4), z: b.floors * FLOOR_H + 2.6, angle: b.angle, w: Math.min(9, b.w - 2), h: 3, building: b.id };
}

/** A big LED screen on the street side of a downtown tower (several ads take turns). */
function screenSpot(ctx: Ctx): Omit<AdPlacement, 'id' | 'created' | 'sponsor' | 'headline' | 'tagline' | 'hue' | 'topic' | 'expires'> | null {
  const used = new Set(ctx.s.ads.filter((a) => a.kind === 'screen').map((a) => a.building));
  const towers = ctx.s.buildings.filter((b) => TOWERS.includes(b.kind) && b.built && !b.ruined && !used.has(b.id) && ctx.lotById.get(b.lot)?.zone === 'core');
  if (!towers.length) return null;
  const b = towers[Math.floor(ctx.rng.next() * towers.length)];
  const w = Math.min(12, b.w - 3), h = Math.round(w * 0.58 * 10) / 10;
  const z = Math.min((b.floors - 1) * FLOOR_H, 2 * FLOOR_H + 1 + h / 2 + ctx.rng.next() * 4 * FLOOR_H);
  return { kind: 'screen', x: b.x + Math.cos(b.angle) * (b.d / 2 + 0.25), y: b.y + Math.sin(b.angle) * (b.d / 2 + 0.25), z, angle: b.angle, w, h, building: b.id };
}

/** A round ad column on a downtown sidewalk (a few metres along from a street lamp). */
function columnSpot(ctx: Ctx): Omit<AdPlacement, 'id' | 'created' | 'sponsor' | 'headline' | 'tagline' | 'hue' | 'topic' | 'expires'> | null {
  const near = (x: number, y: number) => ctx.s.ads.some((a) => a.kind === 'column' && Math.hypot(a.x - x, a.y - y) < 60);
  const lamps = lampSpots(ctx).filter((l) => Math.hypot(l.x - ctx.s.center.x, l.y - ctx.s.center.y) < 420);
  for (let k = 0; k < 8 && lamps.length; k++) {
    const l = lamps[Math.floor(ctx.rng.next() * lamps.length)];
    const along = l.dir + Math.PI / 2;
    const x = l.x + Math.cos(along) * 5 - Math.cos(l.dir) * 0.6, y = l.y + Math.sin(along) * 5 - Math.sin(l.dir) * 0.6;
    if (near(x, y)) continue;
    return { kind: 'column', x, y, z: 1.6, angle: l.dir + Math.PI, w: 1.2, h: 2.2, building: -1 };
  }
  return null;
}

/** A big wall ad ("wallscape") painted or hung on the blank side wall of a mid-rise (visible from far off). */
function wallSpot(ctx: Ctx): Omit<AdPlacement, 'id' | 'created' | 'sponsor' | 'headline' | 'tagline' | 'hue' | 'topic' | 'expires'> | null {
  const used = new Set(ctx.s.ads.filter((a) => a.kind === 'banner' && a.owner !== undefined).map((a) => a.building));
  const walls = ctx.s.buildings.filter((b) => b.built && !b.ruined && b.host === undefined && b.floors >= 3 && b.floors <= 12 && !used.has(b.id) && !TOWERS.includes(b.kind) && b.kind !== 'cityhall'
    && Math.hypot(b.x - ctx.s.center.x, b.y - ctx.s.center.y) < 700);
  if (!walls.length) return null;
  const b = walls[Math.floor(ctx.rng.next() * walls.length)];
  const side = ctx.rng.chance(0.5) ? 1 : -1;
  const perp = b.angle + side * Math.PI / 2;
  const h = Math.min(8, (b.floors - 1) * FLOOR_H), w = Math.min(b.d - 2, h * 0.8);
  return { kind: 'banner', x: b.x + Math.cos(perp) * (b.w / 2 + 0.1), y: b.y + Math.sin(perp) * (b.w / 2 + 0.1), z: FLOOR_H + h / 2 + 0.5, angle: perp, w, h, building: b.id };
}

/** A lit, double-sided ad panel on a downtown sidewalk (like a bus shelter's), between street lamps. */
function panelSpot(ctx: Ctx): Omit<AdPlacement, 'id' | 'created' | 'sponsor' | 'headline' | 'tagline' | 'hue' | 'topic' | 'expires'> | null {
  const near = (x: number, y: number) => ctx.s.ads.some((a) => (a.kind === 'poster' || a.kind === 'column') && a.building === -1 && Math.hypot(a.x - x, a.y - y) < 45);
  const lamps = lampSpots(ctx).filter((l) => Math.hypot(l.x - ctx.s.center.x, l.y - ctx.s.center.y) < 550);
  for (let k = 0; k < 8 && lamps.length; k++) {
    const l = lamps[Math.floor(ctx.rng.next() * lamps.length)];
    const along = l.dir - Math.PI / 2;
    const x = l.x + Math.cos(along) * 9 - Math.cos(l.dir) * 0.8, y = l.y + Math.sin(along) * 9 - Math.sin(l.dir) * 0.8;
    if (near(x, y)) continue;
    // facing along the sidewalk, so people walking either way see a side
    return { kind: 'poster', x, y, z: 1.35, angle: along, w: 1.2, h: 1.8, building: -1 };
  }
  return null;
}

/** Tape a flyer to a lamp near a point (covering an older one if the lamp is full). Free, but read by few. */
export function flyerAt(ctx: Ctx, x: number, y: number, sponsor: number, headline: string, tagline: string, hue: number, topic: AdPlacement['topic']): AdPlacement | null {
  const spots = lampSpots(ctx);
  let best = -1, bd = 40;
  for (let i = 0; i < spots.length; i++) {
    const d = Math.hypot(spots[i].x - x, spots[i].y - y);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return null;
  const s = spots[best];
  const here = ctx.s.ads.filter((a) => a.kind === 'flyer' && Math.hypot(a.x - s.x, a.y - s.y) < 0.6);
  if (here.length >= 3) ctx.s.ads = ctx.s.ads.filter((a) => a !== here[0]); // covered up
  // taped to the pole, facing the sidewalk (away from the road)
  return addAd(ctx, { kind: 'flyer', x: s.x - Math.cos(s.dir) * 0.1, y: s.y - Math.sin(s.dir) * 0.1, z: 1.4 + here.length * 0.35, angle: s.dir + Math.PI, w: 0.3, h: 0.42, building: -1, sponsor, headline, tagline, hue, topic, expires: ctx.s.tick + 3 * MINUTES_PER_DAY });
}

/** Who owns the ground or building an ad stands on (paid for the spot). */
function spotOwner(ctx: Ctx, a: Pick<AdPlacement, 'building' | 'kind'>): number {
  if (a.kind === 'column' || (a.kind === 'poster' && a.building === -1)) return ctx.s.polities[0]?.firm ?? -1; // the city (a sidewalk permit)
  if (a.building >= 0) return ctx.bById.get(a.building)?.owner ?? -1;
  return ctx.lotById.get(-a.building)?.owner ?? -1;
}

// ---------------------------------------------------------- ad companies

const NEVER = 1e12;

/** Ad spaces an outdoor advertising company rents out, and their weekly rent per space (a screen slot, a column face, a billboard). */
const BASE_RENT: Record<string, number> = { billboard: 3.2, screen: 4.5, column: 1.2, banner: 3.6, poster: 0.9 };

function adcos(ctx: Ctx): Firm[] {
  return ctx.s.firms.filter((f) => !f.closed && BUILDINGS[f.kind].service === 'ads' && f.sites.some((id) => ctx.bById.get(id)?.built));
}

/** An ad company puts up new spaces when most of its spaces are rented (it pays for the structure and the spot). */
function growInventory(ctx: Ctx, f: Firm): void {
  const mine = ctx.s.ads.filter((a) => a.owner === f.id);
  const rented = mine.filter((a) => a.sponsor >= 0).length;
  if (mine.length >= 12 && rented / mine.length < 0.7) return;
  const installers = ctx.s.contracts.filter((c) => c.firm === f.id && c.role === 'worker').length;
  const builds = Math.max(1, installers);
  for (let k = 0; k < builds; k++) {
    const r = ctx.rng.next();
    const spot = (r < 0.25 ? screenSpot(ctx) : r < 0.45 ? columnSpot(ctx) : r < 0.6 ? wallSpot(ctx) : r < 0.78 ? panelSpot(ctx) : null) ?? billboardSpot(ctx);
    if (!spot) continue;
    const cost = spot.kind === 'screen' ? 120 : spot.kind === 'column' ? 25 : spot.kind === 'banner' ? 35 : spot.kind === 'poster' ? 15 : 45;
    // the structures pay for themselves in rent: the bank lends for them
    if (f.cash < cost + 80) borrow(ctx, f.id, cost + 100 - f.cash, 90, 'ad spaces');
    if (f.cash < cost + 80) return;
    addCash(ctx, f.id, -cost); // the structure (bought from outside suppliers)
    const slots = spot.kind === 'screen' ? 4 : spot.kind === 'column' ? 3 : 1;
    for (let i = 0; i < slots; i++) {
      addAd(ctx, { ...spot, sponsor: -1, headline: '', tagline: '', hue: f.hue, topic: 'product', expires: NEVER, owner: f.id, slot: i, slots });
    }
  }
}

/** The rent an ad company asks for a space (per day, rented by the week). */
export function spaceRent(ctx: Ctx, a: AdPlacement): number {
  const f = ctx.fById.get(a.owner ?? -1);
  const base = BASE_RENT[a.kind] ?? 2;
  const central = Math.max(0.5, 1.6 - Math.hypot(a.x - ctx.s.center.x, a.y - ctx.s.center.y) / 600);
  return base * central * (f?.prices.rate ?? 3) / 3;
}

/** Daily: ad companies set prices from occupancy, pay for their spots, and take down expired ads. */
function adcosDaily(ctx: Ctx): void {
  for (const f of adcos(ctx)) {
    const mine = ctx.s.ads.filter((a) => a.owner === f.id);
    const rented = mine.filter((a) => a.sponsor >= 0).length;
    const occ = mine.length ? rented / mine.length : 0;
    f.prices.rate = Math.max(1, Math.min(9, (f.prices.rate ?? 3) * (occ > 0.85 ? 1.05 : occ < 0.5 ? 0.96 : 1)));
    // rent for the spots: building owners, lot owners, the city
    const paid = new Set<string>();
    for (const a of mine) {
      const key = `${a.x.toFixed(1)}|${a.y.toFixed(1)}`;
      if (paid.has(key)) continue;
      paid.add(key);
      const owner = spotOwner(ctx, a);
      if (owner !== f.id && (owner >= 0 || owner < -2)) pay(ctx, f.id, owner, a.kind === 'screen' ? 2 : a.kind === 'column' || a.kind === 'poster' ? 0.3 : 0.8, true);
    }
    growInventory(ctx, f);
    f.sales.ads = rented;
  }
}

// ------------------------------------------------------------------ budgets

/** Share of sales a kind of business spends on advertising. */
function adShare(f: Firm): number {
  const svc = BUILDINGS[f.kind].service;
  switch (svc) {
    case 'retail': case 'meal': return 0.05;
    case 'cars': case 'finance': return 0.06;
    case 'net': return 0.1;
    case 'tv': return 0.06;
    case 'build': case 'freight': case 'admin': case 'ads': case 'lease': return 0.02;
    default: return BUILDINGS[f.kind].output ? 0.015 : 0.02;
  }
}

/** Consumer brands (that people pick between) vs companies that sell to other companies. */
function consumerFacing(f: Firm): boolean {
  const svc = BUILDINGS[f.kind].service;
  return svc === 'retail' || svc === 'meal' || svc === 'cars' || svc === 'finance' || svc === 'net' || svc === 'tv';
}

/** Online ad pools: who advertises on which site today (runtime; rebuilt daily). */
/** Who an online ad is aimed at, beyond place and views: likely buyers. */
type Audience = 'car' | 'saver' | 'jobless' | 'hungry';
interface Target { geo?: { x: number; y: number }; econ?: number; aud?: Audience; swing?: boolean; attack?: number }
const pools = new Map<number, ({ sponsor: number; w: number } & Target)[]>();
/** Does a person belong to an ad's audience? */
function inAudience(p: Person, aud: Audience): boolean {
  switch (aud) {
    case 'car': return p.car < 0 && p.money > 250;
    case 'saver': return p.money > 500;
    case 'jobless': return p.job < 0 && !p.firms.length;
    case 'hungry': return p.needs.food < 55;
  }
}
/** TV ad slots bought for a day (runtime; recomputed daily). */
const adSlots: { day: number; outlet: number; sponsor: number; attack?: number }[] = [];
export function slotsFor(ctx: Ctx, outlet: number): number[] {
  const d = dayOf(ctx.s.tick);
  return adSlots.filter((s) => s.outlet === outlet && s.day === d).map((s) => s.sponsor);
}
/** A TV spot bought as an attack ad: the opponent it's about (undefined for an ordinary spot). */
export function attackOf(ctx: Ctx, outlet: number, sponsor: number): number | undefined {
  const d = dayOf(ctx.s.tick);
  return adSlots.find((s) => s.outlet === outlet && s.day === d && s.sponsor === sponsor)?.attack;
}

function sitesSellingAds(ctx: Ctx): Firm[] {
  return ctx.s.firms.filter((f) => !f.closed && f.site && f.site.active > 0 && f.site.kind !== 'pay' && f.site.kind !== 'crowd');
}

function bestChannel(ctx: Ctx): Firm | undefined {
  let best: Firm | undefined, n = 0;
  for (const f of ctx.s.firms) if (!f.closed && (f.channel?.viewers ?? 0) > n) { n = f.channel!.viewers; best = f; }
  return best;
}

/** Buy online ads: spread across sites by their audience (the money goes to them), targeted. */
function buyOnline(ctx: Ctx, sponsor: number, budget: number, target: Target): number {
  if (budget <= 0.05) return 0;
  const sites = sitesSellingAds(ctx);
  const reach = sites.reduce((s, f) => s + f.site!.active, 0);
  if (!sites.length || reach < 5) {
    // outside platforms: the money leaves the city; the ads still reach people online (spread thin)
    addCash(ctx, sponsor, -budget);
    const arr = pools.get(-2) ?? [];
    arr.push({ sponsor, w: budget, ...target });
    pools.set(-2, arr);
    return budget;
  }
  let spent = 0;
  for (const f of sites) {
    const share = budget * (f.site!.active / reach);
    const paid = pay(ctx, sponsor, f.id, share, true);
    if (paid <= 0) continue;
    spent += paid;
    f.site!.adRevenue = (f.site!.adRevenue ?? 0) + paid;
    const arr = pools.get(f.id) ?? [];
    arr.push({ sponsor, w: paid, ...target });
    pools.set(f.id, arr);
  }
  return spent;
}

/** Rent street ad spaces: from ad companies (vacant spaces near where the customers are), else a billboard spot from its owner. */
function buyStreet(ctx: Ctx, f: Firm, budget: number, headline: string, tagline: string): number {
  const home = ctx.bById.get(f.sites[0]);
  let spent = 0;
  // already renting: those carry on (paid weekly when renewed)
  const vacant = ctx.s.ads.filter((a) => a.sponsor < 0 && a.owner !== undefined && ctx.fById.get(a.owner) && !ctx.fById.get(a.owner)!.closed);
  if (vacant.length) {
    // the best value: screens downtown for big budgets, columns for small ones; near their own place
    const scored = vacant.map((a) => {
      const rent = spaceRent(ctx, a) * 7;
      const views = a.kind === 'screen' ? 3 : a.kind === 'billboard' ? 2 : 1;
      const near = home ? Math.max(0.3, 1.5 - Math.hypot(a.x - home.x, a.y - home.y) / 800) : 1;
      return { a, rent, value: (views * near) / rent };
    }).filter((x) => x.rent <= budget * 7).sort((x, y) => y.value - x.value);
    for (const { a, rent } of scored.slice(0, 2)) {
      if (spent + rent / 7 > budget) break;
      if (pay(ctx, f.id, a.owner!, rent, false) <= 0) break;
      spent += rent / 7;
      a.sponsor = f.id;
      a.headline = f.name;
      a.tagline = headline;
      a.hue = f.hue;
      a.topic = 'product';
      a.expires = ctx.s.tick + 7 * MINUTES_PER_DAY;
      void tagline;
    }
    return spent;
  }
  // no ad company: rent a billboard spot straight from its owner (a few a day for the spot)
  if (budget > 4 && ctx.s.ads.filter((a) => a.sponsor === f.id && a.kind === 'billboard').length < 2 && ctx.rng.chance(0.3)) {
    const spot = billboardSpot(ctx);
    if (spot) {
      const owner = spotOwner(ctx, spot);
      const rent = 3 * 7;
      if (pay(ctx, f.id, owner >= 0 || owner < -2 ? owner : -2, rent, false) > 0) {
        addAd(ctx, { ...spot, sponsor: f.id, headline: f.name, tagline: headline, hue: f.hue, topic: 'product', expires: ctx.s.tick + 7 * MINUTES_PER_DAY, owner });
        spent += rent / 7;
      }
    }
  }
  return spent;
}

/** Pay an influencer for a sponsored post. */
function buyInfluencer(ctx: Ctx, f: Firm, budget: number, headline: string): number {
  const social = ctx.s.firms.filter((x) => x.site?.kind === 'social' && !x.closed).sort((a, b) => b.site!.users - a.site!.users)[0];
  if (!social) return 0;
  const stars = ctx.s.people.filter((p) => (p.followers ?? 0) >= 25 && p.pol.sites.includes(social.id)).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 8);
  const p = stars[Math.floor(ctx.rng.next() * stars.length)];
  if (!p) return 0;
  const fee = Math.min(budget * 3, 1 + (p.followers ?? 0) * 0.06);
  if (pay(ctx, f.id, p.id, fee, false) <= 0) return 0;
  const lines = [`Honestly obsessed with ${f.name}. ${headline} #ad`, `${f.name} just changed my week. Go check them out! #sponsored`, `Not gonna lie, ${f.name} is the best in the city. ${f.slogan}. #ad`];
  pushPost(ctx, { who: p.id, text: ctx.rng.pick(lines), site: social.id, topic: 'ad', sponsor: f.id });
  return fee;
}

/** Daily: companies decide what to spend on ads and where; old ads come down. */
export function adsDaily(ctx: Ctx): void {
  // expired: own posters and flyers come down; rented spaces go back to "Advertise here"
  const keep: AdPlacement[] = [];
  for (const a of ctx.s.ads) {
    if (a.expires > ctx.s.tick) { keep.push(a); continue; }
    if (a.owner !== undefined && ctx.fById.get(a.owner) && !ctx.fById.get(a.owner)!.closed && BUILDINGS[ctx.fById.get(a.owner)!.kind].service === 'ads') {
      a.sponsor = -1; a.headline = ''; a.tagline = ''; a.expires = NEVER; keep.push(a);
    }
  }
  ctx.s.ads = keep;
  // spaces of ad companies that closed come down
  ctx.s.ads = ctx.s.ads.filter((a) => a.owner === undefined || a.expires !== NEVER || (ctx.fById.get(a.owner) && !ctx.fById.get(a.owner)!.closed));
  adcosDaily(ctx);
  pools.clear();
  for (const f of ctx.s.firms) if (f.site) { f.site.adRevenue = 0; }
  const channel = bestChannel(ctx);
  let streetWanted = 0;
  // bad impressions from attack ads fade
  for (const p of ctx.s.people) {
    if (!p.pol.neg) continue;
    for (const k of Object.keys(p.pol.neg)) { const v = p.pol.neg[+k] * 0.85; if (v < 0.02) delete p.pol.neg[+k]; else p.pol.neg[+k] = v; }
  }
  for (const f of ctx.s.firms) {
    if (f.closed || ctx.govOfFirm.has(f.id)) continue;
    const def = BUILDINGS[f.kind];
    if (!def.service && !def.output) continue;
    // yesterday's results, smoothed: what each channel cost, reached and brought in
    learnFromAds(f);
    const head = controllerOf(ctx, f);
    const young = ctx.s.tick - f.founded < 10 * MINUTES_PER_DAY;
    const sales = f.revenueAvg ?? 0;
    // the marketing budget: a share of sales (ambitious owners spend more), an opening campaign when new
    let budget = sales * adShare(f) * (0.6 + 0.8 * (head?.traits.ambition ?? 0.5)) + (young ? 6 : 0);
    budget = Math.min(budget, Math.max(0, f.cash - 40) * 0.08);
    f.adBudget = budget;
    f.adSpend = {};
    if (budget < 0.3) continue;
    const headline = adHeadline(ctx, f);
    const site = ctx.bById.get(f.sites[0]);
    // free: posters on their own walls and a banner over the door
    if (site?.built && site.host === undefined && ctx.rng.chance(0.3)) posterOn(ctx, site, f.id, f.name, headline, f.hue, 'product', 10);
    if (young && ctx.rng.chance(0.5)) bannerOn(ctx, f, 'GRAND OPENING', headline, 10);
    const consumer = consumerFacing(f);
    const split = adMix(f, consumer, !!channel);
    const geo = site ? { x: site.x, y: site.y } : undefined;
    const aud: Audience | undefined = def.service === 'cars' ? 'car' : def.service === 'finance' ? 'saver' : def.service === 'meal' ? 'hungry' : f.site?.kind === 'jobs' || f.site?.kind === 'classifieds' ? 'jobless' : undefined;
    const spend = f.adSpend;
    streetWanted += budget * split.street;
    // street ads are rented by the week: only when not already renting
    if (!ctx.s.ads.some((a) => a.sponsor === f.id && a.owner !== undefined && a.expires > ctx.s.tick + MINUTES_PER_DAY)) spend.street = buyStreet(ctx, f, budget * split.street, headline, f.slogan);
    spend.net = buyOnline(ctx, f.id, budget * split.net, consumer ? { geo, aud } : {});
    if (channel && split.tv > 0 && budget * split.tv * 2 > channel.channel!.adPrice && ctx.rng.chance(0.5)) {
      if (pay(ctx, f.id, channel.id, channel.channel!.adPrice, false) > 0) { adSlots.push({ day: dayOf(ctx.s.tick), outlet: channel.id, sponsor: f.id }); spend.tv = channel.channel!.adPrice; }
    }
    if (split.influencer > 0 && ctx.rng.chance(0.25)) spend.influencer = buyInfluencer(ctx, f, budget * split.influencer * 4, headline);
    // the paid posts sites run for advertisers
    if ((spend.net ?? 0) > 0.5 && ctx.rng.chance(0.4)) sponsoredPost(ctx, f, headline);
  }
  while (adSlots.length && adSlots[0].day < dayOf(ctx.s.tick) - 1) adSlots.shift();
  // what businesses would spend on street ads if there were spaces to rent (ad companies watch this)
  ctx.s.data = { ...(ctx.s.data ?? {}), streetWanted };
}

const CHANNELS: AdChannel[] = ['street', 'net', 'tv', 'influencer'];

/** Fold yesterday's ad results into the smoothed record (and start a new day's count). */
function learnFromAds(f: Firm): void {
  const perf = (f.adPerf ??= { spend: {}, conv: {}, imp: {} });
  const today = f.adToday ?? { imp: {}, conv: {} };
  for (const ch of CHANNELS) {
    perf.spend[ch] = 0.85 * (perf.spend[ch] ?? 0) + 0.15 * (f.adSpend?.[ch] ?? 0);
    perf.conv[ch] = 0.85 * (perf.conv[ch] ?? 0) + 0.15 * (today.conv[ch] ?? 0);
    perf.imp[ch] = 0.85 * (perf.imp[ch] ?? 0) + 0.15 * (today.imp[ch] ?? 0);
  }
  f.adToday = { imp: {}, conv: {} };
}

/**
 * How a company splits its ad budget. It starts from what businesses like it
 * usually do; consumer brands then move money toward the channels that bring
 * them more new customers per coin (measured: people who first came after
 * seeing an ad there), a little each day, keeping a toe in every channel.
 */
function adMix(f: Firm, consumer: boolean, tv: boolean): Record<AdChannel, number> {
  const base: Record<AdChannel, number> = consumer ? { street: 0.4, net: 0.35, tv: tv ? 0.2 : 0, influencer: 0.05 } : { street: 0.3, net: 0.7, tv: 0, influencer: 0 };
  if (!tv) { base.street += consumer ? 0.1 : 0; base.net += consumer ? 0.1 : 0; }
  if (!consumer) return base;
  const mix: Record<AdChannel, number> = { street: f.adMix?.street ?? base.street, net: f.adMix?.net ?? base.net, tv: tv ? f.adMix?.tv ?? base.tv : 0, influencer: f.adMix?.influencer ?? base.influencer };
  const perf = f.adPerf;
  const results = perf ? CHANNELS.reduce((a, ch) => a + (perf.conv[ch] ?? 0), 0) : 0;
  if (perf && results > 0.5) {
    // new customers per coin spent, with a little benefit of the doubt for channels not tried much
    const value: Record<AdChannel, number> = { street: 0, net: 0, tv: 0, influencer: 0 };
    let total = 0;
    for (const ch of CHANNELS) {
      if (ch === 'tv' && !tv) continue;
      value[ch] = ((perf.conv[ch] ?? 0) + 0.05) / ((perf.spend[ch] ?? 0) + 1);
      total += value[ch];
    }
    for (const ch of CHANNELS) if (total > 0 && (ch !== 'tv' || tv)) mix[ch] = 0.9 * mix[ch] + 0.1 * (value[ch] / total);
  }
  // every available channel keeps at least 5%; shares add up to 1
  let sum = 0;
  for (const ch of CHANNELS) { if (ch === 'tv' && !tv) { mix[ch] = 0; continue; } mix[ch] = Math.max(0.05, mix[ch]); sum += mix[ch]; }
  for (const ch of CHANNELS) mix[ch] /= sum;
  f.adMix = { ...mix };
  return mix;
}

function adHeadline(ctx: Ctx, f: Firm): string {
  const def = BUILDINGS[f.kind];
  const r = ctx.rng;
  if (def.service === 'retail') return r.pick(['Fresh groceries daily', 'Everything you need', `Groceries from ${(f.prices.groceries ?? 2).toFixed(2)}`, 'Order online, delivered today', f.slogan]);
  if (def.service === 'meal') return r.pick([`Dinner from ${(f.prices.meal ?? 5).toFixed(0)}`, 'Taste the difference', 'Now delivering!', f.slogan]);
  if (def.service === 'cars') return r.pick(['Drive home today', `New cars from ${(f.prices.cars ?? 200).toFixed(0)}`, '0% financing']);
  if (def.service === 'finance') return r.pick(['Loans for your dreams', 'Your money, safe with us', 'Banking in your pocket']);
  if (def.service === 'tv') return r.pick([`Watch ${f.channel?.name ?? f.name}`, 'News you can trust', 'Tonight at 8']);
  if (def.service === 'net') return r.pick([`Join ${f.site?.name ?? f.name}`, f.site?.tagline ?? 'Get online', `${f.site?.domain ?? 'www'}`, 'Download the app']);
  if (def.service === 'build') return r.pick(['We build it right', 'Your next tower, built by us', 'On time, on budget']);
  if (def.service === 'freight') return 'Anything, anywhere in the city';
  if (def.service === 'ads') return 'Your ad here: call us';
  if (def.service === 'lease') return 'Offices available now';
  if (def.output) return `${GOOD[def.output].label} by the truckload`;
  return f.slogan;
}

// ----------------------------------------------------------------- online

const POSTS_MAX = 700;

export function pushPost(ctx: Ctx, post: Omit<Post, 'id' | 't' | 'likes'>): Post {
  const full: Post = { ...post, id: newId(ctx), t: ctx.s.tick, likes: 0 };
  ctx.s.posts.push(full);
  if (ctx.s.posts.length > POSTS_MAX) ctx.s.posts.splice(0, ctx.s.posts.length - POSTS_MAX);
  return full;
}

/** A company's paid post in social feeds ("Sponsored"). */
function sponsoredPost(ctx: Ctx, f: Firm, headline: string): void {
  const social = ctx.s.firms.filter((x) => x.site?.kind === 'social' && !x.closed).sort((a, b) => b.site!.users - a.site!.users)[0];
  if (!social) return;
  pushPost(ctx, { who: f.id, text: `${f.name}: ${headline}. ${f.slogan}.`, site: social.id, topic: 'ad', sponsor: f.id });
}

/**
 * Someone browsing a site sees a few ads, chosen by the site for them:
 * nearby businesses and things they need weigh more; political ads go to
 * people whose views are close to the candidate's. Returns the sponsors shown.
 */
export function onlineAdsFor(ctx: Ctx, p: Person, site: number, n: number): number[] {
  const pool = pools.get(site) ?? pools.get(-2);
  if (!pool?.length) return [];
  const home = ctx.bById.get(p.home);
  const hx = home?.x ?? p.x, hy = home?.y ?? p.y;
  const c = compass(p);
  const hungry = p.needs.food < 50;
  const out: number[] = [];
  // how well each ad in the pool targets this person (near them, their views, hungry → food)
  let total = 0;
  const ws = pool.map((a) => {
    let w = a.w;
    if (a.geo) w *= Math.max(0.2, 1.4 - Math.hypot(a.geo.x - hx, a.geo.y - hy) / 900);
    if (a.econ !== undefined) w *= Math.max(0.1, 1.5 - Math.abs(a.econ - c.econ));
    // likely buyers (no car, savings, out of work, hungry) see more of the ads aimed at them
    if (a.aud && inAudience(p, a.aud)) w *= 2.5;
    // campaigns aim at the undecided: weak party loyalty, some interest in politics
    if (a.swing) w *= (1.4 - p.pol.partyStrength) * (0.4 + p.pol.engagement);
    const f = ctx.fById.get(a.sponsor);
    if (f && hungry && (BUILDINGS[f.kind].service === 'meal' || BUILDINGS[f.kind].service === 'retail')) w *= 2;
    total += w;
    return w;
  });
  const picked: typeof pool = [];
  for (let k = 0; k < n; k++) {
    let r = ctx.rng.next() * total;
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) { picked.push(pool[i]); out.push(pool[i].sponsor); break; } }
  }
  // most online ads barely register (scrolling past): a little awareness each, more for repeats
  for (const a of picked) seeAd(ctx, p, a.sponsor, 0.008, 'net', a.attack);
  // impressions (for the site's stats)
  const f = ctx.fById.get(site);
  if (f?.site) f.site.impressions = (f.site.impressions ?? 0) + out.length;
  return out;
}

// --------------------------------------------------------------- campaigns

/** A campaign spends: posters on supporters' walls, a billboard or a screen slot, TV and targeted Net ads. */
export function campaignAds(ctx: Ctx, e: Election): void {
  const channel = bestChannel(ctx);
  // the polls for each office being contested: who leads, who trails
  const polls = new Map<number, { person: number; share: number }[]>();
  for (const oid of new Set(e.candidates.filter((c) => !c.withdrawn).map((c) => c.office))) polls.set(oid, poll(ctx, e, oid, 60));
  for (const c of e.candidates) {
    const p = ctx.byId.get(c.person);
    if (!p || c.withdrawn) continue;
    const party = ctx.partyById.get(c.party);
    const hue = party?.hue ?? (p.looks.shirt);
    const name = p.name.split(' ')[1] ?? p.name;
    const headline = `VOTE ${name.toUpperCase()}`;
    const office = ctx.gById.get(e.polity)?.offices.find((o) => o.id === c.office);
    const tag = `${c.slogan}${office ? ` · for ${office.title.split(' (')[0]}` : ''}`;
    const race = polls.get(c.office) ?? [];
    const mine = race.find((r) => r.person === c.person)?.share ?? 0;
    const leader = race.find((r) => r.person !== c.person);
    // supporters put posters on their own houses (free)
    let posters = 0;
    for (const [id, r] of Object.entries(p.rel)) {
      if (r.trust < 0.55 || !ctx.rng.chance(0.15)) continue;
      const q = ctx.byId.get(+id);
      const h = q && ctx.bById.get(q.home);
      if (h && h.owner === q.id && distance(compass(q), c) < 1.2 && posterOn(ctx, h, p.id, headline, tag, hue, 'campaign', 14)) posters++;
    }
    if (posters) logAd(ctx, e, p.id, 'poster', headline, `${tag} (${posters} on supporters' houses)`, 0);
    // a rented space (an ad company's), or a billboard spot from its owner
    if (c.funds > 30 && ctx.rng.chance(0.3)) {
      const space = ctx.s.ads.find((a) => a.sponsor < 0 && a.owner !== undefined && spaceRent(ctx, a) * 7 < c.funds * 0.5);
      if (space && pay(ctx, p.id, space.owner!, 0, true) >= 0) {
        const rent = spaceRent(ctx, space) * 7;
        c.funds -= rent; c.spent += rent;
        addCash(ctx, space.owner!, rent);
        Object.assign(space, { sponsor: p.id, headline, tagline: tag, hue, topic: 'campaign', expires: ctx.s.tick + 7 * MINUTES_PER_DAY });
        logAd(ctx, e, p.id, 'space', headline, `${tag} (a ${space.kind} for a week)`, rent);
      } else {
        const spot = billboardSpot(ctx);
        if (spot) { addAd(ctx, { ...spot, sponsor: p.id, headline, tagline: tag, hue, topic: 'campaign', expires: ctx.s.tick + 10 * MINUTES_PER_DAY }); c.funds -= 25; c.spent += 25; logAd(ctx, e, p.id, 'billboard', headline, tag, 25); }
      }
    }
    // trailing well behind: some of the money goes into attacking the leader (online and on TV)
    const attacking = leader && mine < leader.share - 0.08 && c.funds > 20;
    const rival = attacking ? ctx.byId.get(leader!.person) : undefined;
    const attackLine = rival ? `${(rival.name.split(' ')[1] ?? rival.name).toUpperCase()}: WRONG FOR ${(ctx.gById.get(e.polity)?.short ?? 'THE CITY').toUpperCase()}` : '';
    if (channel && c.funds > channel.channel!.adPrice * 2 && ctx.rng.chance(0.5)) {
      c.funds -= channel.channel!.adPrice; c.spent += channel.channel!.adPrice; addCash(ctx, channel.id, channel.channel!.adPrice);
      const attackSpot = rival && ctx.rng.chance(0.5) ? rival.id : undefined;
      adSlots.push({ day: dayOf(ctx.s.tick), outlet: channel.id, sponsor: p.id, ...(attackSpot !== undefined ? { attack: attackSpot } : {}) });
      logAd(ctx, e, p.id, attackSpot !== undefined ? 'attack' : 'tv', attackSpot !== undefined ? attackLine : headline, attackSpot !== undefined ? `a TV spot on ${channel.channel!.name}` : `${tag} · a TV spot on ${channel.channel!.name}`, channel.channel!.adPrice, attackSpot);
    }
    // targeted online ads: to the undecided near the candidate's views (and, when trailing, attacks on the leader)
    if (c.funds > 6) {
      const budget = Math.min(c.funds * 0.15, 12);
      c.funds -= budget; c.spent += budget;
      addCash(ctx, p.id, budget);
      const attack = rival ? budget * 0.4 : 0;
      buyOnline(ctx, p.id, budget - attack, { econ: c.econ, swing: true });
      logAd(ctx, e, p.id, 'online', headline, `${tag} · targeted at undecided voters near their views`, budget - attack);
      if (rival) { buyOnline(ctx, p.id, attack, { econ: c.econ, attack: rival.id }); logAd(ctx, e, p.id, 'attack', attackLine, 'online ads', attack, rival.id); }
    }
  }
}

// ---------------------------------------------------------------- exposure

/** Hourly: people out and about notice the ads around them. */
export function adExposureHourly(ctx: Ctx): void {
  if (!ctx.s.ads.length) return;
  const slot = Math.floor(ctx.s.tick / 2) % 12;
  for (const p of ctx.s.people) {
    if (p.inside >= 0 && p.driving < 0) continue;
    if (p.sleeping || !ctx.rng.chance(0.5)) continue;
    for (const a of adsNear(ctx, p.x, p.y)) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      const reach = a.kind === 'screen' ? 110 : a.kind === 'billboard' ? 70 : a.kind === 'banner' ? (a.h > 3 ? 90 : 25) : a.kind === 'poster' ? 14 : a.kind === 'column' ? 7 : 3.5;
      if (d > reach) continue;
      // only from the front (columns are round; sidewalk panels have two faces)
      if (a.kind !== 'column' && !(a.kind === 'poster' && a.building === -1) && Math.cos(a.angle) * (p.x - a.x) + Math.sin(a.angle) * (p.y - a.y) < 0) continue;
      // a screen shows one of its ads at a time
      if (a.kind === 'screen' && (a.slots ?? 1) > 1 && (slot % (a.slots ?? 1)) !== (a.slot ?? 0)) continue;
      const read = a.kind === 'flyer' ? 0.2 : a.kind === 'billboard' || a.kind === 'screen' ? 0.6 : 0.4;
      if (!ctx.rng.chance(read)) continue;
      const w = a.kind === 'screen' ? 0.05 : a.kind === 'billboard' ? 0.04 : a.kind === 'flyer' ? 0.03 : 0.025;
      seeAd(ctx, p, a.sponsor, w);
    }
  }
}

/** Someone saw an ad (on the street, on TV, online). */
export function seeAd(ctx: Ctx, p: Person, sponsor: number, w: number, ch: AdChannel = 'street', attack?: number): void {
  if (sponsor < 0) return;
  // counted for the advertiser (what its money reached) and the city's statistics
  const f = ctx.fById.get(sponsor);
  if (f) { const t = (f.adToday ??= { imp: {}, conv: {} }); t.imp[ch] = (t.imp[ch] ?? 0) + 1; }
  tally(ctx, 'adimp:' + ch, 1);
  if (attack !== undefined) {
    // an attack ad: a worse impression of the opponent it's about (and a little of who paid for it)
    const neg = (p.pol.neg ??= {});
    neg[attack] = Math.min(1, (neg[attack] ?? 0) + w * 4);
    p.pol.aware[sponsor] = Math.min(1, (p.pol.aware[sponsor] ?? 0) + w * 0.3);
    return;
  }
  // each further sighting matters less once they know the name well
  const known = p.pol.aware[sponsor] ?? 0;
  p.pol.aware[sponsor] = Math.min(1, known + w * (1 - 0.7 * known));
  // a company's ad can put one of its shops or restaurants on their list of places they know
  heardOfFirm(ctx, p, sponsor, w, ch);
  const cand = ctx.byId.get(sponsor);
  if (cand) {
    // a political ad: small, short-lived persuasion toward what the candidate stands for,
    // and supporters who already agree get fired up to go and vote
    const c = ctx.s.elections.flatMap((e) => e.candidates).find((x) => x.person === sponsor);
    if (c) {
      expose(p, c.econ, c.auth, 0.5);
      if (distance(compass(p), c) < 0.6) p.pol.engagement = Math.min(1, p.pol.engagement + w * 0.5);
    }
  }
}

/** Log a campaign ad (for the statistics window). */
function logAd(ctx: Ctx, e: Election, sponsor: number, kind: AdLogEntry['kind'], headline: string, tagline: string, cost: number, target?: number): void {
  const log = (ctx.s.adLog ??= []);
  log.push({ t: ctx.s.tick, election: e.id, sponsor, kind, headline, tagline, cost: Math.round(cost * 100) / 100, ...(target !== undefined ? { target } : {}) });
  if (log.length > 400) log.splice(0, log.length - 400);
}

/** For the UI: a short description of who owns an ad space. */
export function adOwnerName(ctx: Ctx, a: AdPlacement): string {
  return a.owner !== undefined ? nameOf(ctx, a.owner) : '';
}
