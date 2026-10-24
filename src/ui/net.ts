// The Net: a browser window onto the world's internet. Every site is run by
// an internet company in the simulation and looks like a real product of
// its kind (a social feed, a search engine, a marketplace, a job board,
// flat listings, a food-delivery app, a ride-hailing app, a payments app,
// crowdfunding, news, classifieds, video, forums), plus company homepages
// and the government's site. Everything shown is generated from the
// simulation state, including the ads: free sites live on them (see
// netads.ts for who advertises and why you see what you see).
//
// The window shows the Net as the person selected in the inspector sees it
// (their friends' feed, ads targeted at them, their deliveries), or as a
// visitor when nobody is selected.

import { MINUTES_PER_DAY, ONLINE, OUTSIDE } from '../sim/config';
import { dayStart, formatTime, hourOf, nameOf } from '../sim/ctx';
import { BUILDINGS, RETAIL_GOODS, ROLE, TOWERS } from '../sim/goods';
import { vacancies } from '../sim/housing';
import { importPrice } from '../sim/market';
import { describeItem, highBid } from '../sim/estate';
import { compass, compassLabel } from '../sim/ideology';
import { mainPolity, referenceWage, treasury } from '../sim/government';
import { isOnline, onlineStores, outsideRetailPrice, pendingDeliveries } from '../sim/online';
import { vacantUnits } from '../sim/leases';
import { officeDemand, residentialDemand } from '../sim/development';
import { nextShippingTime } from '../sim/logistics';
import type { Simulation } from '../sim/sim';
import { GOODS, type Building, type BuildingKind, type Firm, type Good, type Person, type Post, type Role, type Shipment, type SiteKind } from '../sim/types';
import {
  ago, bannerAd, boxAd, cash, count, eduLabel, esc, feedAd, first, GOOD_ICON, goodLabel, handle, hash01, hhmm, hsl, pct, pickAds, prerollAd,
  searchAd, sellsAds, streetOf, today, until, type Advertiser,
} from './netads';

export type NetSelect = (kind: 'person' | 'firm' | 'building', id: number) => void;

const KIND_LABEL: Record<SiteKind, string> = {
  social: 'social network', news: 'news site', search: 'search engine', classifieds: 'classifieds', video: 'video site', forum: 'forum',
  shop: 'online marketplace', jobs: 'job board', homes: 'flats & homes', delivery: 'food delivery app', rides: 'ride-hailing app', pay: 'payments app', crowd: 'crowdfunding',
};
const KIND_ICON: Record<SiteKind, string> = {
  social: '💬', news: '📰', search: '🔍', classifieds: '📋', video: '🎬', forum: '🗨', shop: '🛒', jobs: '💼', homes: '🏠', delivery: '🍔', rides: '🚕', pay: '💳', crowd: '🚀',
};
/** How each kind of site makes its money (for the About page). */
const MONEY: Record<SiteKind, string> = {
  social: 'Free to use; paid by advertisers: feed ads and sponsored posts. (Influencers\' #ad posts are paid by the companies directly, not through the site.)',
  news: 'Free to read; banner ads.',
  search: 'Free; sponsored results above the organic ones, and ads beside them. Companies looking for suppliers find advertisers first.',
  classifieds: 'Free listings; banner ads.',
  video: 'Free; an ad before every video.',
  forum: 'Free and anonymous; banner ads.',
  shop: 'A commission on every order, plus ads and sponsored listings that put a store first.',
  jobs: 'Employers pay to list openings; promoted listings and ads.',
  homes: 'Landlords pay for listings; ads.',
  delivery: 'A commission on every meal from the restaurant, and part of the delivery fee (couriers get most of it).',
  rides: 'A quarter of every fare (drivers keep the rest).',
  pay: 'A small fee on every payment, paid by the shop or person being paid. No ads.',
  crowd: 'A share of what successful campaigns raise. No ads.',
};

const ROLE_GROUP: Record<string, Role[]> = {
  office: ['clerk', 'manager', 'sales', 'programmer', 'journalist', 'presenter', 'civil'],
  shops: ['cashier', 'cook', 'waiter'],
  factory: ['worker'],
  outdoors: ['farmhand', 'logger', 'quarrier', 'miner', 'builder', 'driver', 'officer'],
};

export class Net {
  el: HTMLDivElement;
  private page = 'home';
  private history: string[] = [];
  private body: HTMLDivElement;
  private addr: HTMLSpanElement;
  private nav: HTMLDivElement;
  private who_: HTMLSpanElement;
  private lastHtml = '';
  private visitor = false;

  constructor(
    private sim: Simulation,
    private onSelect: NetSelect,
    /** Who's looking (the person selected in the inspector, or -1). */
    private viewerId: () => number = () => -1,
    /** What's selected in the city (for search suggestions). */
    private selection: () => { type: string; id: number } | null = () => null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'netwin';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="nw-bar">
        <span class="nw-dots"><i></i><i></i><i></i></span>
        <button data-back title="Back">←</button>
        <button data-nav="home" title="Start page">⌂</button>
        <span class="nw-addr"><span class="nw-lock">🔒</span><span class="nw-url">net://home</span></span>
        <span class="nw-who"></span>
        <button data-close title="Close">✕</button>
      </div>
      <div class="nw-tabs"></div>
      <div class="nw-body"></div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector('.nw-body')!;
    this.addr = this.el.querySelector('.nw-url')!;
    this.nav = this.el.querySelector('.nw-tabs')!;
    this.who_ = this.el.querySelector('.nw-who')!;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { this.hide(); return; }
      if (t.closest('[data-back]')) { const prev = this.history.pop(); if (prev) { this.page = prev; this.render(true); } return; }
      if (t.closest('[data-visitor]')) { this.visitor = !this.visitor; this.render(true); return; }
      const sel = t.closest('[data-select]') as HTMLElement | null;
      if (sel) {
        const [kind, id] = sel.dataset.select!.split(':');
        this.onSelect(kind as 'person' | 'firm' | 'building', Number(id));
        return;
      }
      const go = t.closest('[data-search-go]') as HTMLElement | null;
      if (go) { this.submitSearch(go.dataset.searchGo!); return; }
      const nav = t.closest('[data-nav]') as HTMLElement | null;
      if (nav) this.go(nav.dataset.nav!);
    });
    this.el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.search !== undefined && e.key === 'Enter') this.submitSearch(t.dataset.search);
    });
  }

  private submitSearch(site: string): void {
    const input = this.el.querySelector(`input[data-search="${site}"]`) as HTMLInputElement | null;
    const q = (input?.value ?? '').trim();
    if (!q) return;
    this.go(`site:${site}/q=${encodeURIComponent(q)}`);
  }

  setSim(sim: Simulation): void {
    this.sim = sim;
    today.reset();
    this.page = 'home';
    this.history = [];
  }

  get open(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(): void {
    if (!this.open) { this.el.style.display = 'flex'; this.render(true); } else this.hide();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  go(page: string): void {
    if (page !== this.page) this.history.push(this.page);
    if (this.history.length > 50) this.history.shift();
    this.page = page;
    this.render(true);
    this.body.scrollTop = 0;
  }

  /** Refresh while open (the world keeps changing), unless someone is typing. */
  update(): void {
    if (!this.open) return;
    if ((document.activeElement as HTMLElement)?.dataset?.search !== undefined) return;
    this.render(false);
  }

  private get ctx() { return this.sim.ctx; }
  private get s() { return this.sim.state; }

  private viewer(): Person | undefined {
    if (this.visitor) return undefined;
    return this.ctx.byId.get(this.viewerId());
  }

  private sites(): Firm[] {
    return this.s.firms.filter((f) => f.site && !f.closed).sort((a, b) => b.site!.users - a.site!.users);
  }

  private siteOfKind(kind: SiteKind): Firm | undefined {
    return this.sites().find((f) => f.site!.kind === kind);
  }

  private render(force = true): void {
    const scroll = this.body.scrollTop;
    const m = /^([a-z]+)(?::(-?\d+))?(?:\/(.*))?$/.exec(this.page) ?? [];
    const kind = m[1] ?? 'home', id = Number(m[2] ?? -1), sub = decodeURIComponent(m[3] ?? '');
    const f = kind === 'site' || kind === 'firm' ? this.ctx.fById.get(id) : undefined;
    // the address bar
    let url = `net://${this.page}`;
    if (kind === 'home') url = 'net://start';
    else if (f?.site) url = `${f.site.domain}${sub.startsWith('q=') ? `/search?q=${encodeURIComponent(sub.slice(2))}` : sub.startsWith('u=') ? `/${handle(nameOf(this.ctx, Number(sub.slice(2))))}` : sub ? `/${sub.replace('=', '/')}` : ''}`;
    else if (f) url = `${f.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    else if (kind === 'gov') url = `${(this.ctx.gById.get(id)?.short ?? 'city').toLowerCase().replace(/[^a-z]/g, '')}.gov`;
    else if (kind === 'person') {
      const p = this.ctx.byId.get(id);
      const soc = p?.pol.sites.map((x) => this.ctx.fById.get(x)).find((x) => x?.site?.kind === 'social' && !x.closed);
      url = soc ? `${soc.site!.domain}/${handle(p!.name)}` : `profiles/${handle(nameOf(this.ctx, id)).slice(1)}`;
    }
    else if (kind === 'companies') url = 'directory/companies';
    this.addr.textContent = url;
    // who is browsing
    const v = this.viewer();
    const sel = this.ctx.byId.get(this.viewerId());
    const who = v ? `<span class="nw-av" style="background:${hsl(v.looks.shirt, 50, 48)}">${esc(v.name[0])}</span>Viewing as <b>${esc(first(v.name))}</b><button data-visitor title="See the Net as an anonymous visitor">visitor</button>`
      : sel ? `Visitor <button data-visitor>view as ${esc(first(sel.name))}</button>` : '<span title="Select a person in the city to see the Net as they do: their feed, their ads, their orders">Visitor</span>';
    if (this.who_.innerHTML !== who) this.who_.innerHTML = who;
    // bookmarks
    const sites = this.sites().slice(0, 9);
    const g = mainPolity(this.ctx);
    const tabs = sites.map((s) => `<button data-nav="site:${s.id}" class="${f === s ? 'on' : ''}"><span class="nw-fav" style="background:${hsl(s.site!.color, 60, 45)}">${esc(s.site!.name[0])}</span>${esc(s.site!.name)}</button>`).join('')
      + (g ? `<button data-nav="gov:${g.id}" class="${kind === 'gov' ? 'on' : ''}"><span class="nw-fav" style="background:${hsl(g.hue, 45, 35)}">★</span>${esc(g.short)}.gov</button>` : '')
      + `<button data-nav="companies" class="${kind === 'companies' ? 'on' : ''}"><span class="nw-fav nw-fav-dir">≡</span>Companies</button>`;
    if (this.nav.innerHTML !== tabs) this.nav.innerHTML = tabs;
    let html = '';
    switch (kind) {
      case 'home': html = this.home(); break;
      case 'site': html = f?.site && !f.closed ? this.site(f, sub) : this.gone(); break;
      case 'gov': html = this.gov(id); break;
      case 'companies': html = this.companies(); break;
      case 'firm': html = f ? (f.site ? this.site(f, sub) : this.firmSite(f)) : this.gone(); break;
      case 'person': html = this.profile(id); break;
      default: html = this.gone();
    }
    if (!force && html === this.lastHtml) return;
    this.lastHtml = html;
    this.body.innerHTML = html;
    this.body.scrollTop = scroll;
  }

  private gone(): string {
    return '<div class="nw-404"><div class="nw-404-n">404</div><p>This page no longer exists. The company behind it may have closed.</p><button class="nw-btn" data-nav="home">Back to the start page</button></div>';
  }

  // ---------------------------------------------------------- small pieces

  /** A link to a person, firm or government (to their page on the Net). */
  private who(id: number): string {
    const ctx = this.ctx;
    if (ctx.govOfFirm.has(id)) return `<a data-nav="gov:${ctx.govOfFirm.get(id)!.id}">${esc(nameOf(ctx, id))}</a>`;
    if (ctx.gById.has(id)) return `<a data-nav="gov:${id}">${esc(nameOf(ctx, id))}</a>`;
    if (ctx.fById.has(id)) return `<a data-nav="firm:${id}">${esc(nameOf(ctx, id))}</a>`;
    if (ctx.byId.has(id)) return `<a data-nav="person:${id}">${esc(nameOf(ctx, id))}</a>`;
    if (id === OUTSIDE.id) return 'a company from outside the city';
    return esc(nameOf(ctx, id));
  }

  private av(id: number, size = 36): string {
    const p = this.ctx.byId.get(id);
    const f = this.ctx.fById.get(id);
    const color = p ? hsl(p.looks.shirt, 48, 50) : f ? hsl(f.hue, 60, 42) : '#999';
    const letter = (p?.name ?? f?.name ?? '?')[0];
    return `<span class="sp-av${f && !p ? ' sq' : ''}" style="background:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px">${esc(letter)}</span>`;
  }

  private stars(r: number): string {
    const v = Math.max(1, Math.min(5, 2.6 + 2.4 * r));
    return `<span class="nw-stars" title="${v.toFixed(1)} out of 5">★ ${v.toFixed(1)}</span>`;
  }

  private ads(n: number, slot: number, filter?: (a: Advertiser) => boolean) {
    return pickAds(this.ctx, this.viewer(), n, slot, filter);
  }

  private where(b: Building | undefined): string {
    if (!b) return '';
    const host = b.host !== undefined ? this.ctx.bById.get(b.host) : undefined;
    const st = streetOf(this.ctx, b);
    return `${host ? `${b.level ? `floor ${(b.level ?? 0) + 1}, ` : 'ground floor, '}${BUILDINGS[host.kind].label.toLowerCase()}` : ''}${st ? `${host ? ', ' : ''}${esc(st)}` : ''}`;
  }

  /** " · Main Street" (or nothing when the street has no name). */
  private on(b: Building): string {
    const st = streetOf(this.ctx, b);
    return st ? ` · ${esc(st)}` : '';
  }

  /** "350 m" or "1.4 km". */
  private dist(b: Building | undefined, p: Person | undefined): string {
    const km = this.distKm(b, p);
    return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`;
  }

  private distKm(b: Building | undefined, p: Person | undefined): number {
    if (!b) return 1;
    const h = p ? this.ctx.bById.get(p.home) : undefined;
    const x = h?.x ?? this.s.center.x, y = h?.y ?? this.s.center.y;
    return Math.hypot(b.x - x, b.y - y) / 1000;
  }

  /** The frame every site page sits in: header, nav, columns, footer. */
  private frame(f: Firm, nav: [string, string][], cur: string, main: string, side = '', opts: { banner?: boolean; wide?: boolean } = {}): string {
    const st = f.site!;
    const ad = opts.banner && sellsAds(f) ? bannerAd(this.ads(1, f.id * 13 + 7)[0]) : '';
    return `<div class="nw-site k-${st.kind}" style="--brand:${hsl(st.color, 62, 42)};--brand-soft:${hsl(st.color, 70, 95)};--brand-deep:${hsl(st.color, 60, 26)}">
      <header class="nw-head"><a class="nw-logo" data-nav="site:${f.id}"><span>${esc(st.name[0])}</span>${esc(st.name)}</a><span class="nw-tagline">${esc(st.tagline)}</span>
        <nav>${nav.map(([label, sub]) => `<a data-nav="site:${f.id}${sub ? '/' + sub : ''}" class="${cur === sub ? 'on' : ''}">${label}</a>`).join('')}<a data-nav="site:${f.id}/about" class="${cur === 'about' ? 'on' : ''}">About</a></nav></header>
      ${ad}
      ${side ? `<div class="nw-cols"><main>${main}</main><aside>${side}</aside></div>` : `<div class="${opts.wide ? 'nw-wide' : 'nw-one'}">${main}</div>`}
      <footer class="nw-foot">${esc(st.name)} is run by ${this.who(f.id)} · ${count(st.users)} accounts · ${count(st.active)} visits yesterday${sellsAds(f) ? ` · ads ${(st.cpm ?? 0).toFixed(2)} per 1,000 views` : ''}${st.fee ? ` · ${st.fee < 1 ? `${(st.fee * 100).toFixed(st.fee < 0.05 ? 1 : 0)}% fee` : `${st.fee.toFixed(1)} per listing`}` : ''} · <a data-nav="site:${f.id}/about">About &amp; advertising</a></footer></div>`;
  }

  // ------------------------------------------------------------- start page

  private home(): string {
    const s = this.s, ctx = this.ctx;
    const online = s.people.filter(isOnline).length;
    const sites = this.sites();
    const g = mainPolity(ctx);
    const search = this.siteOfKind('search');
    const homepages = s.firms.filter((f) => f.website && !f.closed && !f.site && !ctx.govOfFirm.has(f.id)).length;
    const groups: [string, SiteKind[]][] = [
      ['Social & news', ['social', 'forum', 'news', 'video']],
      ['Shopping & apps', ['shop', 'delivery', 'rides', 'pay']],
      ['Jobs, homes & more', ['jobs', 'homes', 'classifieds', 'crowd', 'search']],
    ];
    const tile = (f: Firm) => `<a class="nw-app" data-nav="site:${f.id}"><span class="nw-applogo" style="background:${hsl(f.site!.color, 62, 44)}">${esc(f.site!.name[0])}<i>${KIND_ICON[f.site!.kind]}</i></span><b>${esc(f.site!.name)}</b><span>${KIND_LABEL[f.site!.kind]} · ${count(f.site!.users)}</span></a>`;
    const apps = groups.map(([label, kinds]) => {
      const list = sites.filter((f) => kinds.includes(f.site!.kind));
      return list.length ? `<h3>${label}</h3><div class="nw-apps">${list.map(tile).join('')}</div>` : '';
    }).join('');
    const netSpend = s.firms.reduce((a, f) => a + (f.closed ? 0 : f.adSpend?.net ?? 0), 0);
    const localAds = sites.reduce((a, f) => a + (f.site!.adRevenue ?? 0), 0);
    const postsToday = s.posts.filter((p) => p.t >= dayStart(s.tick));
    const paidToday = postsToday.filter((p) => p.sponsor !== undefined).length;
    const missing = (Object.keys(KIND_LABEL) as SiteKind[]).filter((k) => !sites.some((f) => f.site!.kind === k));
    const label = today.label();
    return `<div class="nw-start">
      <div class="nw-start-h"><div class="nw-start-logo">the&nbsp;<b>Net</b></div>
        ${search ? `<div class="nw-searchbar big"><input data-search="${search.id}" placeholder="Search ${esc(search.site!.name)}…"><button data-search-go="${search.id}">🔍</button></div><div class="nw-sub">Search by ${esc(search.site!.name)}</div>`
          : '<div class="nw-sub">There is no search engine in the city yet: type nothing, browse the sites below.</div>'}</div>
      ${bannerAd(this.ads(1, 9001)[0])}
      ${sites.length ? apps : `<p class="nw-sub">No internet company has launched a site yet. For now the Net is just ${homepages} company homepages${g ? " and the city's website" : ''}. When enough people are online, someone will start one.</p>`}
      <h3>Also on the Net</h3><div class="nw-apps">
        ${g ? `<a class="nw-app" data-nav="gov:${g.id}"><span class="nw-applogo" style="background:${hsl(g.hue, 45, 35)}">★</span><b>${esc(g.short)}.gov</b><span>council, laws, elections</span></a>` : ''}
        <a class="nw-app" data-nav="companies"><span class="nw-applogo" style="background:#5d5c55">≡</span><b>Companies</b><span>${homepages} homepages</span></a></div>
      <h3>The Net ${label}</h3>
      <div class="nw-stats">
        <div><b>${online}</b><span>of ${s.people.length} people online</span></div>
        <div><b>${today.get(s, 'orders')}</b><span>online orders ${label}</span></div>
        <div><b>${today.get(s, 'gigs')}</b><span>gig deliveries ${label}</span></div>
        <div><b>${today.get(s, 'rides')}</b><span>app rides ${label}</span></div>
        <div><b>${postsToday.length}</b><span>posts today (${paidToday} paid)</span></div>
        <div><b>${cash(netSpend)}</b><span>spent on online ads today${netSpend > 0 ? `, ${pct(Math.min(1, localAds / netSpend))} with local sites` : ''}</span></div>
      </div>
      ${missing.length && sites.length ? `<p class="nw-sub">Not in the city yet: ${missing.map((k) => KIND_LABEL[k]).join(', ')}. Internet companies launch whatever the city is missing that could pay.</p>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------------ sites

  private site(f: Firm, sub: string): string {
    const st = f.site!;
    if (sub === 'about') return this.frame(f, this.navFor(f), 'about', this.about(f));
    switch (st.kind) {
      case 'social': return this.social(f, sub);
      case 'forum': return this.forum(f);
      case 'news': return this.newsSite(f);
      case 'classifieds': return this.classifieds(f);
      case 'search': return this.search(f, sub);
      case 'video': return this.video(f);
      case 'shop': return this.shop(f, sub);
      case 'jobs': return this.jobBoard(f, sub);
      case 'homes': return this.homesSite(f, sub);
      case 'delivery': return this.delivery(f);
      case 'rides': return this.rides(f);
      case 'pay': return this.pay(f);
      case 'crowd': return this.crowd(f);
    }
    return this.gone();
  }

  private navFor(f: Firm): [string, string][] {
    switch (f.site!.kind) {
      case 'social': return [['Home', ''], ['Trending', 'trending']];
      case 'search': return [['Search', '']];
      case 'shop': return [['All', ''], ...RETAIL_GOODS.map((g): [string, string] => [goodLabel(g)[0].toUpperCase() + goodLabel(g).slice(1), `c=${g}`]), ['Cars', 'c=cars']];
      case 'jobs': return [['Jobs', ''], ['Office', 'r=office'], ['Shops & food', 'r=shops'], ['Factory', 'r=factory'], ['Outdoors', 'r=outdoors'], ['Salaries', 'salaries']];
      case 'homes': return [['Rent', ''], ['Buy', 't=buy'], ['Commercial', 't=commercial']];
      default: return [['Home', '']];
    }
  }

  // ---------------------------------------------------------------- social

  /** Posts on a social site, ranked the way the site ranks its feed (for this viewer). */
  private ranked(f: Firm, v: Person | undefined): { posts: Post[]; note: string } {
    const st = f.site!;
    const all = this.s.posts.filter((p) => p.site === f.id && p.sponsor === undefined && (!v || p.who !== v.id));
    const friend = (id: number) => !!v && (v.rel[id]?.fam ?? 0) > 2;
    if (st.feed === 'engagement') {
      const c = v ? compass(v) : undefined;
      const scored = all.slice(-150).map((x) => ({
        x, s: x.likes + 2 * (x.shares ?? 0) + (c && x.topic === 'politics' && x.slant !== undefined ? 6 - 4 * Math.abs(x.slant - c.econ) : 0) + (friend(x.who) ? 4 : 0) - (this.s.tick - x.t) / 120,
      }));
      return { posts: scored.sort((a, b) => b.s - a.s).map((y) => y.x), note: `Top posts: ranked by likes and shares${v ? ', friends, and politics that agrees with ' + esc(first(v.name)) : ''} (how ${esc(st.name)}'s feed works)` };
    }
    if (st.feed === 'friends') {
      if (v) {
        const mine = all.filter((x) => friend(x.who));
        if (mine.length) return { posts: mine.slice(-60).reverse(), note: `${esc(first(v.name))}'s friends, newest first (${esc(st.name)} only shows friends' posts)` };
        return { posts: all.slice(-40).reverse(), note: `${esc(first(v.name))} has no friends on ${esc(st.name)} yet: showing public posts` };
      }
      return { posts: all.slice(-40).reverse(), note: `Public posts (members see only their friends' posts; select a person to see their feed)` };
    }
    return { posts: all.slice(-60).reverse(), note: 'Latest posts, newest first (a chronological feed)' };
  }

  private social(f: Firm, sub: string): string {
    const v = this.viewer();
    const st = f.site!;
    const nav = this.navFor(f);
    if (sub.startsWith('u=')) return this.frame(f, nav, sub, this.socialProfile(f, Number(sub.slice(2))), this.socialSide(f));
    if (sub === 'trending') return this.frame(f, nav, sub, this.trendingPage(f), this.socialSide(f));
    const { posts, note } = this.ranked(f, v);
    const paid = this.s.posts.filter((p) => p.site === f.id && p.sponsor !== undefined).slice(-14).reverse();
    const ads = sellsAds(f) ? this.ads(5, f.id * 31 + 3) : [];
    const items: string[] = [];
    let ai = 0, pi = 0;
    posts.slice(0, 30).forEach((p, i) => {
      items.push(this.post(f, p));
      if (i % 4 === 1) {
        // the site mixes paid posts and feed ads into the feed
        const slot = Math.floor(i / 4);
        if (slot % 2 === 0 && paid[pi]) items.push(this.post(f, paid[pi++]));
        else if (ads[ai]) items.push(feedAd(ads[ai++]));
        else if (paid[pi]) items.push(this.post(f, paid[pi++]));
      }
    });
    const composer = v && v.pol.sites.includes(f.id)
      ? `<div class="sp-compose">${this.av(v.id, 34)}<div class="sp-input">${st.charLimit ? `What's happening, ${esc(first(v.name))}? (${st.charLimit} characters)` : `What's on your mind, ${esc(first(v.name))}?`}</div></div>`
      : `<div class="sp-compose sp-join"><b>Join ${esc(st.name)}</b> · ${count(st.users)} people already have. <span class="nw-sub">${st.feed === 'engagement' ? 'The feed shows what gets the most reactions.' : st.feed === 'friends' ? 'You only see your friends\' posts.' : 'Everything, newest first.'}${st.charLimit ? ` Posts up to ${st.charLimit} characters.` : ''}</span></div>`;
    return this.frame(f, nav, '', `${composer}<div class="sp-note">${note}</div>${items.join('') || '<p class="nw-sub">No posts yet.</p>'}`, this.socialSide(f));
  }

  private post(f: Firm, p: Post, anon = false): string {
    const ctx = this.ctx;
    const person = ctx.byId.get(p.who);
    const firm = person ? undefined : ctx.fById.get(p.who);
    const name = anon ? `anon${(p.who * 7919) % 10000}` : person?.name ?? firm?.name ?? nameOf(ctx, p.who);
    const link = anon ? `<b>${esc(name)}</b>` : person ? `<a data-nav="site:${f.id}/u=${p.who}"><b>${esc(name)}</b></a>` : `<a data-nav="firm:${p.who}"><b>${esc(name)}</b></a>`;
    const star = person && (person.followers ?? 0) >= 25 && !anon ? `<span class="sp-star" title="${count(person.followers ?? 0)} followers: an influencer">★ ${count(person.followers ?? 0)}</span>` : '';
    const sponsor = p.sponsor !== undefined ? ctx.fById.get(p.sponsor) ?? undefined : undefined;
    const paidBy = p.sponsor !== undefined && person ? `<div class="sp-paid">Paid partnership with ${sponsor ? `<a data-nav="firm:${sponsor.id}">${esc(sponsor.name)}</a>` : esc(nameOf(ctx, p.sponsor))}</div>` : '';
    const spon = p.sponsor !== undefined && !person ? '<span class="sp-spon">Sponsored</span>' : firm && p.topic === 'work' ? '<span class="sp-chip">Hiring</span>' : firm ? '<span class="sp-chip">Page</span>' : '';
    const topic = p.topic === 'politics' ? '<span class="sp-chip pol">Politics</span>' : '';
    const text = esc(p.text).replace(/#(\w+)/g, '<span class="sp-hash">#$1</span>');
    const card = p.sponsor !== undefined && !person && firm ? `<div class="ad-card" data-nav="firm:${firm.id}" style="--ad:${hsl(firm.hue, 62, 44)};--ad-soft:${hsl(firm.hue, 70, 94)};--ad-deep:${hsl(firm.hue, 60, 30)}"><div class="ad-card-art"><span class="ad-logo" style="width:54px;height:54px;font-size:26px">${esc(firm.name[0])}</span><div>${esc(firm.slogan)}</div></div><div class="ad-card-foot"><span>${esc(firm.site?.domain ?? firm.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com')}</span><span class="ad-cta">Learn more</span></div></div>` : '';
    const replies = this.s.posts.filter((x) => x.replyTo === p.id).length;
    return `<div class="sp-post${p.sponsor !== undefined ? ' sp-paidpost' : ''}">${anon ? `<span class="sp-av anon">?</span>` : this.av(p.who)}<div class="sp-main">
      <div class="sp-head">${link} ${anon ? '' : `<span class="sp-handle">${esc(person ? handle(name) : '')}</span>`} ${star} ${spon}${topic}<span class="sp-time">${ago(this.s.tick, p.t)}</span></div>
      ${paidBy}<div class="sp-text">${text}</div>${card}
      <div class="sp-actions"><span>♡ ${p.likes}</span><span>↻ ${p.shares ?? 0}</span>${replies ? `<span>💬 ${replies}</span>` : ''}<span>👁 ${count(p.views ?? 0)}</span></div></div></div>`;
  }

  /** What people on a site are talking about today. */
  private trending(f: Firm): { label: string; n: number; nav?: string }[] {
    const since = this.s.tick - MINUTES_PER_DAY;
    const recent = this.s.posts.filter((p) => p.site === f.id && p.t >= since);
    const counts = new Map<string, { label: string; n: number; nav?: string }>();
    const bump = (key: string, label: string, nav?: string) => { const c = counts.get(key) ?? { label, n: 0, nav }; c.n++; counts.set(key, c); };
    const words: [RegExp, string][] = [[/\brent\b/i, '#rent'], [/tax/i, '#taxes'], [/elect|vot/i, '#election'], [/\bjob|hiring|work\b/i, '#jobs'], [/traffic|streets|dirt/i, '#roads'],
      [/price|expensive|overpriced/i, '#prices'], [/police|law and order/i, '#police'], [/welfare/i, '#welfare'], [/package|deliver|ordered/i, '#delivery'], [/hungry|food/i, '#food'],
      [/#ad|#sponsored/i, '#ad'], [/landlord/i, '#landlords'], [/gig|apps take/i, '#giglife']];
    const firms = this.s.firms.filter((x) => !x.closed && x.name.length > 3);
    const cands = this.s.elections.filter((e) => e.status === 'campaign' || e.status === 'voting').flatMap((e) => e.candidates).map((c) => this.ctx.byId.get(c.person)).filter((p): p is Person => !!p);
    for (const p of recent) {
      for (const [re, tag] of words) if (re.test(p.text)) bump(tag, tag);
      for (const x of firms) if (p.text.includes(x.name)) bump('f' + x.id, x.name, `firm:${x.id}`);
      for (const c of cands) if (p.text.includes(c.name)) bump('p' + c.id, c.name, `site:${f.id}/u=${c.id}`);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }

  private socialSide(f: Firm): string {
    const tr = this.trending(f).slice(0, 5);
    const stars = this.s.people.filter((p) => p.pol.sites.includes(f.id) && (p.followers ?? 0) > 3).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 4);
    const ad = sellsAds(f) ? boxAd(this.ads(1, f.id * 31 + 99)[0]) : '';
    return `<div class="sp-box"><h4>Trending in ${esc(mainPolity(this.ctx)?.short ?? 'the city')}</h4>${tr.length ? tr.map((t, i) => `<div class="sp-trend"${t.nav ? ` data-nav="${t.nav}"` : ''}><span class="nw-sub">${i + 1} · Trending</span><b>${esc(t.label)}</b><span class="nw-sub">${t.n} post${t.n === 1 ? '' : 's'} today</span></div>`).join('') : '<p class="nw-sub">Quiet today.</p>'}</div>
      ${ad}
      ${stars.length ? `<div class="sp-box"><h4>Who to follow</h4>${stars.map((p) => `<div class="sp-follow" data-nav="site:${f.id}/u=${p.id}">${this.av(p.id, 30)}<div><b>${esc(p.name)}</b><span class="nw-sub">${count(p.followers ?? 0)} followers</span></div><span class="nw-btn sm">Follow</span></div>`).join('')}</div>` : ''}`;
  }

  private trendingPage(f: Firm): string {
    const tr = this.trending(f);
    const top = this.s.posts.filter((p) => p.site === f.id && p.t >= this.s.tick - MINUTES_PER_DAY && p.sponsor === undefined).sort((a, b) => b.likes + 2 * (b.shares ?? 0) - a.likes - 2 * (a.shares ?? 0)).slice(0, 12);
    return `<h3>Trending today</h3>${tr.map((t) => `<div class="sp-trend big"${t.nav ? ` data-nav="${t.nav}"` : ''}><b>${esc(t.label)}</b> <span class="nw-sub">${t.n} posts</span></div>`).join('') || '<p class="nw-sub">Nothing is trending.</p>'}
      <h3>Most liked today</h3>${top.map((p) => this.post(f, p)).join('') || '<p class="nw-sub">No posts today.</p>'}`;
  }

  private socialProfile(f: Firm, id: number): string {
    const ctx = this.ctx;
    const p = ctx.byId.get(id);
    if (!p) return `<p class="nw-sub">This account no longer exists.</p>`;
    const c = ctx.cById.get(p.job);
    const home = ctx.bById.get(p.home);
    const posts = this.s.posts.filter((x) => x.who === p.id && x.site === f.id).slice(-15).reverse();
    const friends = Object.entries(p.rel).filter(([oid, r]) => r.fam > 2 && ctx.byId.get(+oid)?.pol.sites.includes(f.id)).length;
    const deals = [...new Set(this.s.posts.filter((x) => x.who === p.id && x.sponsor !== undefined).map((x) => x.sponsor!))];
    const on = p.pol.sites.includes(f.id);
    const bio = [c ? `${ROLE[c.role].label} at ${nameOf(ctx, c.firm)}` : p.firms.length ? `founder of ${p.firms.map((x) => nameOf(ctx, x)).join(', ')}` : 'open to work',
      home ? `lives near ${streetOf(ctx, home) || 'the city'}` : 'no fixed address', `from ${p.origin}`].join(' · ');
    return `<div class="sp-profile"><div class="sp-cover"></div><div class="sp-prof-row">${this.av(p.id, 72)}<div class="sp-prof-n"><h2>${esc(p.name)}</h2><span class="sp-handle">${esc(handle(p.name))}</span></div>
        <button class="nw-link" data-select="person:${p.id}">show in the city</button></div>
      <div class="sp-bio">${esc(bio)}</div>
      <div class="sp-counts"><span><b>${count(p.followers ?? 0)}</b> followers</span><span><b>${friends}</b> friends here</span><span><b>${this.s.posts.filter((x) => x.who === p.id && x.site === f.id).length}</b> posts</span>${(p.followers ?? 0) >= 25 ? '<span class="sp-star">★ Influencer</span>' : ''}</div>
      ${deals.length ? `<div class="sp-bio">Paid partnerships: ${deals.map((d) => this.who(d)).join(', ')}</div>` : ''}
      ${on ? '' : `<div class="sp-bio nw-sub">${esc(first(p.name))} doesn't have an account on ${esc(f.site!.name)} (yet).</div>`}</div>
      ${posts.map((x) => this.post(f, x)).join('') || '<p class="nw-sub">No posts yet.</p>'}`;
  }

  private forum(f: Firm): string {
    const posts = this.s.posts.filter((p) => p.site === f.id && p.replyTo === undefined).slice(-50).reverse();
    const ads = this.ads(3, f.id * 7 + 1);
    const rows: string[] = [];
    posts.forEach((p, i) => {
      const replies = this.s.posts.filter((x) => x.replyTo === p.id).length;
      rows.push(`<div class="fo-thread"><div class="fo-votes">▲<b>${p.likes}</b>▼</div><div><div class="fo-title">${esc(p.text)}</div><div class="nw-meta">posted by anon${(p.who * 7919) % 10000} · ${ago(this.s.tick, p.t)} ago · ${replies} replies · ${count(p.views ?? 0)} views${p.topic === 'politics' ? ' · <span class="sp-chip pol">politics</span>' : ''}</div></div></div>`);
      if (i % 8 === 5 && ads[Math.floor(i / 8)]) rows.push(bannerAd(ads[Math.floor(i / 8)]));
    });
    return this.frame(f, this.navFor(f), '', `<div class="sp-note">Anonymous threads, newest first. Nobody knows who you are here.</div>${rows.join('') || '<p class="nw-sub">No threads yet.</p>'}`, '', { banner: true });
  }

  private newsSite(f: Firm): string {
    const owner = this.ctx.byId.get(f.owner);
    const slant = owner ? compass(owner).econ : 0;
    const items = this.s.log.filter((e) => ['politics', 'law', 'business', 'death', 'build', 'event', 'media'].includes(e.kind)).slice(-80)
      // the editorial line decides what's worth covering (half of what doesn't fit the line is dropped)
      .filter((e) => slant < -0.4 ? !e.text.includes('opened') || e.t % 2 === 0 : slant > 0.4 ? !e.text.includes('protest') || e.t % 2 === 0 : true).slice(-40).reverse();
    const ads = this.ads(3, f.id * 5 + 2);
    const [lead, ...rest] = items;
    const section = (k: string) => ({ politics: 'Politics', law: 'City Hall', business: 'Business', death: 'Obituaries', build: 'Real estate', event: 'City', media: 'Media' } as Record<string, string>)[k] ?? 'City';
    const rows = rest.map((e, i) => `<div class="nx-item"><span class="nx-sec">${section(e.kind)}</span><div class="nx-h">${esc(e.text)}</div><span class="nw-meta">${formatTime(e.t)}</span></div>${i % 9 === 4 && ads[1 + Math.floor(i / 9)] ? bannerAd(ads[1 + Math.floor(i / 9)]) : ''}`).join('');
    return this.frame(f, this.navFor(f), '', `${lead ? `<div class="nx-lead"><span class="nx-sec">${section(lead.kind)}</span><h2>${esc(lead.text)}</h2><span class="nw-meta">${formatTime(lead.t)} · Editorial line: ${compassLabel(slant, owner ? compass(owner).auth : 0)} (the owner's)</span></div>` : ''}${rows}`,
      `${boxAd(ads[0])}<div class="sp-box"><h4>Most read</h4>${this.s.posts.filter((p) => p.topic === 'politics').slice(-40).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 4).map((p) => `<div class="nx-small">“${esc(p.text.slice(0, 90))}”<span class="nw-sub"> ${count(p.views ?? 0)} views</span></div>`).join('') || '<p class="nw-sub">—</p>'}</div>`, { banner: true });
  }

  private classifieds(f: Firm): string {
    const ads = this.ads(2, f.id * 3 + 5);
    return this.frame(f, this.navFor(f), '', `${this.jobsTable()}${bannerAd(ads[0])}${this.homesTable()}${bannerAd(ads[1])}${this.auctions()}`, '', { banner: true, wide: true });
  }

  // ---------------------------------------------------------------- search

  private search(f: Firm, sub: string): string {
    const q = sub.startsWith('q=') ? sub.slice(2) : '';
    const st = f.site!;
    const suggestions = ['groceries', 'jobs', 'flats for rent', 'construction company', 'restaurants near me', 'office space', 'car', 'bank loan'];
    const sel = this.selection();
    const sb = sel?.type === 'building' ? this.ctx.bById.get(sel.id) : undefined;
    const sf = sel?.type === 'firm' ? this.ctx.fById.get(sel.id) : this.ctx.fById.get(sb?.firm ?? -1);
    const selGood = sf ? BUILDINGS[sf.kind].output : undefined;
    if (selGood) suggestions.unshift(`${goodLabel(selGood)} suppliers`);
    else if (sf && BUILDINGS[sf.kind].service === 'retail') suggestions.unshift('clothes');
    const box = (big: boolean) => `<div class="nw-searchbar${big ? ' big' : ''}"><input data-search="${f.id}" value="${esc(q)}" placeholder="Search ${esc(st.name)} or type a question"><button data-search-go="${f.id}">🔍</button></div>`;
    if (!q) {
      return this.frame(f, [], '', `<div class="se-home"><div class="se-logo" style="color:${hsl(st.color, 62, 42)}">${esc(st.name)}</div>${box(true)}
        <div class="se-sugg">${suggestions.map((x) => `<a class="sp-chip" data-nav="site:${f.id}/q=${encodeURIComponent(x)}">${esc(x)}</a>`).join('')}</div>
        <p class="nw-sub">${count(st.users)} people search with ${esc(st.name)}. Companies also use it to find suppliers: the ones that advertise come first.</p></div>`);
    }
    const r = this.results(q);
    const sponsored = this.ads(3, f.id * 17 + q.length * 7 + q.charCodeAt(0), (a) => r.matchAd(a));
    const organic = r.items.slice(0, 12);
    const main = `${box(false)}<div class="nw-sub se-count">About ${count(Math.max(organic.length, 1) * 1370 + Math.floor(hash01(q.length, q.charCodeAt(0)) * 900))} results (0.${2 + (q.length % 6)} seconds)</div>
      ${sponsored.map(searchAd).join('')}
      ${organic.map((x) => `<div class="se-result"><div class="se-url">${esc(x.url)}</div><a class="se-title" data-nav="${x.nav}">${esc(x.title)}</a><div class="se-desc">${x.desc}</div></div>`).join('') || `<p>No results for <b>${esc(q)}</b>. Try ${suggestions.slice(0, 3).map((x) => `<a data-nav="site:${f.id}/q=${encodeURIComponent(x)}">${esc(x)}</a>`).join(', ')}.</p>`}`;
    const side = `${r.panel}${boxAd(this.ads(1, f.id * 17 + 1, (a) => !sponsored.some((x) => x.ad.id === a.id))[0])}`;
    return this.frame(f, [], '', main, side);
  }

  /** What a query means and what it finds: organic results, a knowledge panel, which ads match. */
  private results(qRaw: string): { items: { title: string; url: string; desc: string; nav: string }[]; panel: string; matchAd: (a: Advertiser) => boolean } {
    const ctx = this.ctx, s = this.s;
    const q = qRaw.toLowerCase();
    const kinds = new Set<BuildingKind>();
    const goods = new Set<Good>();
    let topic = '';
    const has = (...w: string[]) => w.some((x) => q.includes(x));
    if (has('grocer', 'food', 'supermarket', 'shop', 'store')) { goods.add('groceries'); kinds.add('store'); kinds.add('foodplant'); }
    if (has('restaurant', 'dinner', 'lunch', 'eat', 'pizza', 'burger', 'meal')) { kinds.add('restaurant'); topic = 'food'; }
    if (has('job', 'work', 'hiring', 'career', 'vacanc')) topic = 'jobs';
    if (has('flat', 'apartment', 'rent', 'home', 'house', 'live')) { topic = 'homes'; kinds.add('apartments'); kinds.add('tower'); }
    if (has('office', 'lease', 'commercial')) { topic = 'office'; kinds.add('officetower'); kinds.add('office'); }
    if (has('construct', 'builder', 'build', 'contractor')) kinds.add('yard');
    if (has('car', 'vehicle', 'drive')) { goods.add('cars'); kinds.add('dealer'); kinds.add('carplant'); }
    if (has('bank', 'loan', 'mortgage', 'credit')) kinds.add('bank');
    if (has('advert', 'billboard', 'marketing')) kinds.add('adco');
    if (has('freight', 'shipping', 'truck', 'logistic', 'deliver')) kinds.add('depot');
    if (has('tv', 'channel')) kinds.add('studio');
    if (has('ride', 'taxi', 'cab')) topic = 'rides';
    for (const g of GOODS) if (q.includes(goodLabel(g).replace(/s$/, '')) || q.includes(g.replace(/s$/, ''))) {
      goods.add(g);
      for (const k of Object.keys(BUILDINGS) as BuildingKind[]) if (BUILDINGS[k].output === g) kinds.add(k);
      if (RETAIL_GOODS.includes(g)) kinds.add('store');
    }
    for (const k of Object.keys(BUILDINGS) as BuildingKind[]) if (BUILDINGS[k].label.toLowerCase().includes(q)) kinds.add(k);
    const matches = (f: Firm) => kinds.has(f.kind) || f.name.toLowerCase().includes(q) || (f.site?.name.toLowerCase().includes(q) ?? false) || f.sites.some((id) => kinds.has(ctx.bById.get(id)?.kind as BuildingKind));
    const owns = (f: Firm, k: BuildingKind[]) => s.buildings.some((b) => b.owner === f.id && k.includes(b.kind));
    const firms = s.firms.filter((f) => !f.closed && !ctx.govOfFirm.has(f.id) && (matches(f) || (topic === 'homes' && owns(f, ['apartments', 'tower'])) || (topic === 'office' && owns(f, ['officetower']))));
    // only companies with a website are in the index; the ones with more customers rank higher
    const ranked = firms.filter((f) => f.website).sort((a, b) => (b.revenueAvg ?? 0) * (0.5 + b.reputation) - (a.revenueAvg ?? 0) * (0.5 + a.reputation));
    const items: { title: string; url: string; desc: string; nav: string }[] = [];
    // the city's own sites first when the query is about what they do
    const siteFor: Record<string, SiteKind> = { jobs: 'jobs', homes: 'homes', food: 'delivery', rides: 'rides', office: 'homes' };
    const site = topic ? this.siteOfKind(siteFor[topic]) : goods.size ? this.siteOfKind('shop') : undefined;
    if (site) items.push({ title: `${site.site!.name}: ${site.site!.tagline}`, url: site.site!.domain, desc: esc(`${KIND_LABEL[site.site!.kind]} · ${count(site.site!.users)} users`), nav: `site:${site.id}${topic === 'office' ? '/t=commercial' : ''}` });
    for (const f of ranked) {
      const def = BUILDINGS[f.kind];
      const b = ctx.bById.get(f.sites[0]);
      const price = def.output && f.prices[def.output] ? ` · ${goodLabel(def.output)} from ${f.prices[def.output]!.toFixed(2)}` : def.service === 'meal' && f.prices.meal ? ` · meals ${f.prices.meal.toFixed(2)}` : def.service === 'retail' && f.prices.groceries ? ` · groceries ${f.prices.groceries.toFixed(2)}` : '';
      items.push({ title: `${f.name} · ${def.label}`, url: f.site?.domain ?? `${f.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`, desc: `${esc(f.slogan)}.${price}${b ? ` · ${this.where(b)}` : ''}${f.branch ? ' · part of a national chain' : ''}`, nav: `firm:${f.id}` });
    }
    for (const p of s.people.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 5)) items.push({ title: `${p.name} · profile`, url: `profiles/${handle(p.name).slice(1)}`, desc: esc(`${p.pol.sites.length ? 'On ' + p.pol.sites.map((x) => nameOf(ctx, x)).slice(0, 2).join(', ') : 'No social accounts'}`), nav: `person:${p.id}` });
    if (firms.length > ranked.length) items.push({ title: `${firms.length - ranked.length} more companies without a website`, url: 'directory', desc: 'They don\'t show up in search: customers find them by walking past, by word of mouth, or their ads.', nav: 'companies' });
    // the knowledge panel
    let panel = '';
    const g = [...goods][0];
    if (g) {
      const stores = s.firms.filter((f) => !f.closed && f.prices[g] && (BUILDINGS[f.kind].service === 'retail' || BUILDINGS[f.kind].output === g || (g === 'cars' && f.kind === 'dealer'))).sort((a, b) => a.prices[g]! - b.prices[g]!);
      panel = `<div class="se-panel"><div class="se-panel-h">${GOOD_ICON[g] ?? ''} ${esc(goodLabel(g))}</div>
        <div class="kvp"><span>Cheapest here</span><b>${stores[0] ? `${stores[0].prices[g]!.toFixed(2)} at ${esc(stores[0].name)}` : '—'}</b>
        <span>Wholesale</span><b>${s.market.last[g] ? s.market.last[g].toFixed(2) : '—'}</b>
        <span>Imported</span><b>${importPrice(ctx, g).toFixed(2)}</b>
        ${RETAIL_GOODS.includes(g) || g === 'cars' ? `<span>Online, outside</span><b>${outsideRetailPrice(ctx, g).toFixed(2)} + ${ONLINE.deliveryFee}</b>` : ''}</div>
        ${stores.slice(0, 5).map((f) => `<div class="se-panel-row" data-nav="firm:${f.id}"><span>${esc(f.name)}</span><b>${f.prices[g]!.toFixed(2)}</b></div>`).join('')}</div>`;
    } else if (topic === 'jobs') {
      const posts = s.postings;
      const best = posts.slice().sort((a, b) => b.wage - a.wage).slice(0, 5);
      const jobsSite = this.siteOfKind('jobs');
      panel = `<div class="se-panel"><div class="se-panel-h">💼 Jobs in ${esc(mainPolity(ctx)?.short ?? 'the city')}</div><div class="kvp"><span>Open positions</span><b>${posts.length}</b><span>Out of work</span><b>${s.people.filter((p) => p.job < 0 && !p.firms.length).length}</b><span>Typical pay</span><b>${referenceWage(ctx).toFixed(1)} per shift</b></div>
        ${best.map((p) => `<div class="se-panel-row" data-nav="firm:${p.firm}"><span>${esc(ROLE[p.role].label)} · ${esc(nameOf(ctx, p.firm))}</span><b>${p.wage.toFixed(1)}</b></div>`).join('')}${jobsSite ? `<a class="nw-btn" data-nav="site:${jobsSite.id}">All jobs on ${esc(jobsSite.site!.name)}</a>` : ''}</div>`;
    } else if (topic === 'homes' || topic === 'office') {
      const vac = vacancies(ctx);
      const shops = vacantUnits(ctx, 'shopfront'), suites = vacantUnits(ctx, 'suite');
      const homes = this.siteOfKind('homes');
      panel = `<div class="se-panel"><div class="se-panel-h">🏠 Renting in ${esc(mainPolity(ctx)?.short ?? 'the city')}</div><div class="kvp"><span>Flats for rent</span><b>${vac.length}${vac.length ? `, from ${Math.min(...vac.map((x) => x.rent)).toFixed(1)}/day` : ''}</b>
        <span>Shops for lease</span><b>${shops.length}</b><span>Office floors</span><b>${suites.length}${suites.length ? `, from ${Math.min(...suites.map((u) => this.ask(u))).toFixed(0)}/day` : ''}</b></div>${homes ? `<a class="nw-btn" data-nav="site:${homes.id}${topic === 'office' ? '/t=commercial' : ''}">See listings on ${esc(homes.site!.name)}</a>` : ''}</div>`;
    } else if (topic === 'food') {
      const app = this.siteOfKind('delivery');
      const open = this.restaurants().filter((x) => x.open);
      panel = `<div class="se-panel"><div class="se-panel-h">🍽 Restaurants</div><div class="kvp"><span>Open now</span><b>${open.length}</b></div>${open.slice(0, 5).map((x) => `<div class="se-panel-row" data-nav="firm:${x.f.id}"><span>${esc(x.f.name)}</span><b>${(x.f.prices.meal ?? 0).toFixed(2)}</b></div>`).join('')}${app ? `<a class="nw-btn" data-nav="site:${app.id}">Order on ${esc(app.site!.name)}</a>` : ''}</div>`;
    } else if (ranked[0] && ranked[0].name.toLowerCase().includes(q)) {
      const f = ranked[0];
      panel = `<div class="se-panel"><div class="se-panel-h"><span class="nw-fav" style="background:${hsl(f.hue, 60, 45)}">${esc(f.name[0])}</span> ${esc(f.name)}</div><div class="nw-sub">${BUILDINGS[f.kind].label}${f.branch ? ' · national chain' : ''}</div>
        <div class="kvp"><span>Founded</span><b>${formatTime(f.founded).split(',')[0]}</b><span>Employees</span><b>${s.contracts.filter((c) => c.firm === f.id).length}</b><span>Owner</span><b>${esc(nameOf(ctx, f.owner))}</b></div></div>`;
    }
    const matchAd = (a: Advertiser) => (a.firm ? matches(a.firm) || (topic === 'jobs' && a.hiring) || (topic === 'homes' && owns(a.firm, ['apartments', 'tower'])) || (topic === 'office' && owns(a.firm, ['officetower'])) || (topic === 'food' && a.service === 'meal') : q.includes(a.name.toLowerCase().split(' ')[1] ?? '###') || has('vote', 'elect', 'candidate'));
    return { items, panel, matchAd };
  }

  // ------------------------------------------------------------------ video

  private video(f: Firm): string {
    const posts = this.s.posts.filter((p) => p.site === f.id || (p.topic === 'life' && p.likes > 2)).slice(-24).reverse();
    const shows = this.s.broadcasts.slice(-10).reverse();
    const ads = this.ads(2, f.id * 11 + 3);
    const clips = [
      ...shows.map((b) => ({ title: b.title, by: this.ctx.fById.get(b.channel)?.channel?.name ?? 'TV', views: b.viewers * 3 + 10, hue: this.ctx.fById.get(b.channel)?.hue ?? 0.6, t: b.t, len: 4 + (b.id % 9) })),
      ...posts.map((p) => ({ title: p.text, by: nameOf(this.ctx, p.who), views: p.views ?? p.likes * 7, hue: this.ctx.byId.get(p.who)?.looks.shirt ?? 0.3, t: p.t, len: 1 + (p.id % 5) })),
    ];
    const [top, ...rest] = clips;
    return this.frame(f, this.navFor(f), '', `${prerollAd(ads[0], this.s.tick)}${top ? `<div class="vid-now"><b>${esc(top.title)}</b><span class="nw-sub">${esc(top.by)} · ${count(top.views)} views · up next after the ad</span></div>` : ''}
      <h3>Trending</h3><div class="vid-grid">${rest.slice(0, 16).map((c) => `<div class="vid-card"><div class="vid-thumb" style="background:linear-gradient(135deg, ${hsl(c.hue + hash01(c.t, c.len) * 0.25, 55, 45)}, ${hsl(c.hue + 0.12, 50, 22)})"><span>▶</span><i>${c.len}:${String(Math.floor(hash01(c.t, c.views) * 60)).padStart(2, '0')}</i></div><b>${esc(c.title.slice(0, 70))}</b><span class="nw-sub">${esc(c.by)} · ${count(c.views)} views · ${ago(this.s.tick, c.t)} ago</span></div>`).join('')}</div>`,
      boxAd(ads[1]));
  }

  // ------------------------------------------------------------- marketplace

  private shop(f: Firm, sub: string): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const v = this.viewer();
    const cat = sub.startsWith('c=') ? sub.slice(2) as Good : undefined;
    const cats: Good[] = cat ? [cat] : RETAIL_GOODS;
    const arrive = nextShippingTime(s.tick, ONLINE.leadHours) + 60;
    const arriveText = arrive - dayStart(s.tick) < MINUTES_PER_DAY ? `today by ${hhmm(arrive)}` : arrive - dayStart(s.tick) < 2 * MINUTES_PER_DAY ? `tomorrow by ${hhmm(arrive)}` : formatTime(arrive);
    const retailers = ['MegaMart', 'ShopAll', 'Bazaar.com'];
    const card = (o: { title: string; icon: string; price: number; seller: string; sellerNav: string; stock: string; deliver: string; rating: number; sponsored?: boolean; outside?: boolean }) =>
      `<div class="mk-card${o.sponsored ? ' spon' : ''}" data-nav="${o.sellerNav}"><div class="mk-img">${o.icon}${o.sponsored ? '<span class="mk-spon">Sponsored</span>' : ''}</div>
        <div class="mk-title">${esc(o.title)}</div><div class="mk-price">${o.price.toFixed(2)}</div>
        <div class="nw-sub">${o.outside ? '🌐 ' : ''}${esc(o.seller)} · ${this.stars(o.rating)}</div><div class="mk-ship">${esc(o.deliver)}</div><div class="nw-sub">${esc(o.stock)}</div></div>`;
    const section = (g: Good) => {
      if (g === 'cars') {
        const dealers = s.firms.filter((x) => !x.closed && x.kind === 'dealer' && x.prices.cars);
        const out = outsideRetailPrice(ctx, 'cars');
        return `<div class="mk-row">${dealers.map((d) => card({ title: 'New car', icon: '🚗', price: d.prices.cars!, seller: d.name, sellerNav: `firm:${d.id}`, stock: `${Math.floor(d.sites.reduce((a, id) => a + (ctx.bById.get(id)?.store.cars ?? 0), 0))} in the showroom`, deliver: 'Pick it up at the showroom', rating: d.reputation, sponsored: (d.adSpend?.net ?? 0) > 0 })).join('')}
          ${card({ title: 'New car, delivered', icon: '🚛', price: out, seller: 'AutoDirect (outside)', sellerNav: `site:${f.id}/c=cars`, stock: 'made to order', deliver: `Comes on a truck · ${arriveText}`, rating: 0.5, outside: true })}</div>`;
      }
      const stores = onlineStores(ctx, g, 1);
      const seen = new Set<number>();
      const local = stores.filter((x) => { if (seen.has(x.f.id)) return false; seen.add(x.f.id); return true; })
        .map((x) => ({ ...x, price: x.f.prices[g]!, stock: stores.filter((y) => y.f === x.f).reduce((a, y) => a + y.b.store[g], 0), spon: x.f.adSpend?.net ?? 0 }));
      // sponsored listings first (stores that pay for ads), then the cheapest
      const spon = local.filter((x) => x.spon > 0).sort((a, b) => b.spon - a.spon).slice(0, 2);
      const rest = local.filter((x) => !spon.includes(x)).sort((a, b) => a.price - b.price);
      const unit = g === 'groceries' ? 'Groceries, a day\'s basket' : g === 'computers' ? 'Electronics: phone, TV or computer' : g === 'furniture' ? 'Furniture, one piece' : g === 'tools' ? 'Tool set' : 'Clothes, an outfit';
      const out = outsideRetailPrice(ctx, g);
      const localCards = [...spon.map((x) => ({ ...x, sponsored: true })), ...rest.map((x) => ({ ...x, sponsored: false }))].map((x) => card({
        title: unit, icon: GOOD_ICON[g], price: x.price, seller: x.f.name, sellerNav: `firm:${x.f.id}`, stock: [`${Math.floor(x.stock)} in stock`, this.where(x.b)].filter(Boolean).join(' · '),
        deliver: `Local delivery today · ${ONLINE.localDeliveryFee.toFixed(2)}`, rating: x.f.reputation, sponsored: x.sponsored,
      }));
      const outCards = (cat ? retailers : [retailers[RETAIL_GOODS.indexOf(g) % retailers.length]]).map((r, i) => card({ title: unit, icon: GOOD_ICON[g], price: out, seller: r, sellerNav: `site:${f.id}/c=${g}`, stock: 'ships from a warehouse outside the city', deliver: `${arriveText} · ${ONLINE.deliveryFee.toFixed(2)}`, rating: 0.45 + i * 0.05, outside: true }));
      return `<div class="mk-row">${localCards.join('')}${outCards.join('')}</div>${!localCards.length ? '<p class="nw-sub">No shop in the city has this in stock right now: only sellers from outside.</p>' : ''}`;
    };
    const mine = v ? pendingDeliveries(ctx, v) : [];
    const sellers = new Set(onlineStores(ctx, 'groceries', 0).concat(...RETAIL_GOODS.map((g) => onlineStores(ctx, g, 1))).map((x) => x.f.id)).size;
    const main = `<div class="mk-hero"><div><b>${sellers} local shops</b> sell on ${esc(st.name)}, delivered today by couriers. Or order from outside retailers (delivered ${arriveText}).</div>
        <div class="nw-sub">${today.get(s, 'orders')} online orders ${today.label()} in the city · ${cash(st.volume ?? 0)} sold through ${esc(st.name)} today · ${pct(st.fee ?? 0.08)} commission</div></div>
      ${mine.length ? `<div class="mk-orders"><b>${esc(first(v!.name))}'s orders on the way</b>${mine.map((sh) => `<div>${this.deliveryLine(sh)}</div>`).join('')}</div>` : ''}
      ${cats.map((g) => `<h3>${GOOD_ICON[g] ?? ''} ${esc(goodLabel(g))}</h3>${section(g)}`).join('')}`;
    return this.frame(f, this.navFor(f), cat ? `c=${cat}` : '', main, '', { banner: true, wide: true });
  }

  /** One delivery on its way to someone, in words. */
  deliveryLine(sh: Shipment): string {
    const ctx = this.ctx;
    const from = ctx.bById.get(sh.from);
    const seller = sh.from < 0 ? ['MegaMart', 'ShopAll', 'Bazaar.com'][sh.id % 3] : nameOf(ctx, from?.firm ?? -1);
    const what = sh.meal ? 'a meal' : sh.device ? `a ${sh.device === 'tv' ? 'TV' : 'phone'}` : GOODS.filter((g) => sh.goods[g] >= 0.5).map((g) => `${Math.round(sh.goods[g])} ${goodLabel(g)}`).join(', ') || 'a parcel';
    const v = ctx.vById.get(ctx.byId.get(sh.driver)?.driving ?? -1) ?? ctx.s.vehicles.find((x) => x.trip?.shipment === sh.id);
    const by = sh.carrier === OUTSIDE.id ? (v?.brand ? `a ${v.brand} ${v.kind}` : 'an outside courier') : sh.carrier >= 0 ? `${ctx.byId.get(sh.driver)?.name.split(' ')[0] ?? 'a courier'} (${nameOf(ctx, sh.carrier)})` : 'waiting for a courier';
    const status = sh.after !== undefined && sh.after > ctx.s.tick ? `ships ${until(ctx.s.tick, sh.after)}` : sh.status === 'open' ? 'waiting for a courier' : sh.status === 'assigned' ? `${by} is on the way to pick it up` : `on the way with ${by}`;
    return `${sh.meal ? '🍽' : '📦'} ${esc(what)} from ${esc(seller)} · <span class="nw-sub">${esc(status)}</span>`;
  }

  // -------------------------------------------------------------- job board

  private jobBoard(f: Firm, sub: string): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const v = this.viewer();
    const nav = this.navFor(f);
    if (sub === 'salaries') return this.frame(f, nav, sub, this.salaries(), this.seekersBox(f));
    const group = sub.startsWith('r=') ? ROLE_GROUP[sub.slice(2)] : undefined;
    const posts = s.postings.filter((p) => !group || group.includes(p.role));
    // promoted listings (employers that advertise) first, then newest
    const promoted = (p: { firm: number }) => (ctx.fById.get(p.firm)?.adSpend?.net ?? 0) > 0;
    const list = posts.slice().sort((a, b) => Number(promoted(b)) - Number(promoted(a)) || b.t - a.t);
    const jobless = s.people.filter((p) => p.job < 0 && !p.firms.length).length;
    const avg = posts.length ? posts.reduce((a, p) => a + p.wage, 0) / posts.length : 0;
    const ads = this.ads(2, f.id * 19 + 4, (a) => a.hiring);
    const cards = list.map((p, i) => {
      const firm = ctx.fById.get(p.firm);
      const site = ctx.bById.get(p.site);
      const need = ROLE[p.role].edu;
      const badges = [promoted(p) ? '<span class="jb-badge promo">Promoted</span>' : '', p.applicants.length < 2 ? '<span class="jb-badge">Actively hiring</span>' : `<span class="jb-badge muted">${p.applicants.length} applicants</span>`,
        s.tick - p.t < 360 ? '<span class="jb-badge new">New</span>' : '', firm?.branch ? '<span class="jb-badge muted">National chain</span>' : '', v && p.applicants.includes(v.id) ? '<span class="jb-badge done">Applied</span>' : ''].join('');
      return `<div class="jb-card"><span class="sp-av sq" style="background:${hsl(firm?.hue ?? 0.5, 60, 42)};width:44px;height:44px;font-size:20px">${esc((firm?.name ?? '?')[0])}</span><div class="jb-main">
        <div class="jb-title">${esc(ROLE[p.role].label[0].toUpperCase() + ROLE[p.role].label.slice(1))}</div>
        <div>${this.who(p.firm)} · <span class="nw-sub">${site ? `${BUILDINGS[site.kind].label} · ${this.where(site)}` : ''}</span></div>
        <div class="jb-meta"><b>${p.wage.toFixed(1)}</b> per shift · ${BUILDINGS[site?.kind ?? 'office'].hours[0]}:00–${BUILDINGS[site?.kind ?? 'office'].hours[1]}:00 · ${need ? `${need}+ years of school` : 'no diploma needed'} · posted ${ago(s.tick, p.t)} ago</div>
        <div>${badges}</div></div><span class="nw-btn" data-nav="firm:${p.firm}">Apply</span></div>${i === 3 && ads[0] ? bannerAd(ads[0]) : ''}`;
    }).join('');
    const filled = s.log.filter((e) => e.kind === 'job' && /hired|joined|started/i.test(e.text)).slice(-6).reverse();
    const main = `<div class="jb-hero"><b>${posts.length} open position${posts.length === 1 ? '' : 's'}</b> · ${jobless} people looking for work${posts.length ? ` · average pay ${avg.toFixed(1)} per shift` : ''}
        <div class="nw-sub">Employers pay ${st.fee ? st.fee.toFixed(1) : 'a fee'} to list a job; promoted listings come first.</div></div>
      ${cards || `<div class="jb-empty"><b>No openings right now.</b> Companies post jobs when they grow or someone leaves; new listings usually fill within hours.${filled.length ? `<h3>Recently filled</h3>${filled.map((e) => `<div class="jb-mini">${esc(e.text)} <span class="nw-sub">${ago(s.tick, e.t)} ago</span></div>`).join('')}` : ''}</div>`}
      ${posts.length ? '' : bannerAd(ads[0])}`;
    return this.frame(f, nav, sub, main, `${this.seekersBox(f)}${boxAd(ads[1])}`);
  }

  private seekersBox(f: Firm): string {
    const seekers = this.s.people.filter((p) => p.job < 0 && !p.firms.length)
      .map((p) => {
        const best = Object.entries(p.skills).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
        return { p, best, score: p.edu + (best?.[1] ?? 0) / 40 };
      }).sort((a, b) => b.score - a.score).slice(0, 6);
    return `<div class="sp-box"><h4>Open to work</h4>${seekers.map(({ p, best }) => `<div class="jb-seeker" data-nav="person:${p.id}">${this.av(p.id, 32)}<div><b>${esc(p.name)}</b><span class="nw-sub">${esc(eduLabel(p.edu))} (${p.edu}y)${best && (best[1] ?? 0) >= 2 ? ` · ${Math.round(best[1]!)}h as ${esc(ROLE[best[0] as Role].label)}` : ' · no experience yet'}</span>
      <span class="jb-otw">#OpenToWork</span>${p.home < 0 ? ' <span class="nw-sub">· no home</span>' : ''}</div></div>`).join('') || '<p class="nw-sub">Everyone who wants a job has one.</p>'}
      <div class="nw-sub">${this.s.people.filter((p) => p.job < 0 && !p.firms.length && p.pol.sites.includes(f.id)).length} job seekers have a profile here.</div></div>`;
  }

  private salaries(): string {
    const by = new Map<Role, number[]>();
    for (const c of this.s.contracts) { const a = by.get(c.role) ?? []; a.push(c.wage); by.set(c.role, a); }
    const rows = [...by].map(([r, ws]) => ({ r, n: ws.length, avg: ws.reduce((a, b) => a + b, 0) / ws.length, lo: Math.min(...ws), hi: Math.max(...ws) })).sort((a, b) => b.avg - a.avg);
    const max = Math.max(1, ...rows.map((x) => x.hi));
    return `<h3>What people earn (per shift)</h3><table><tr><th>Job</th><th class="r">People</th><th class="r">Average</th><th>Range</th></tr>${rows.map((x) => `<tr><td>${esc(ROLE[x.r].label)}</td><td class="r">${x.n}</td><td class="r"><b>${x.avg.toFixed(1)}</b></td>
      <td><div class="jb-range"><span style="left:${(x.lo / max) * 100}%;width:${Math.max(2, ((x.hi - x.lo) / max) * 100)}%"></span></div><span class="nw-sub">${x.lo.toFixed(0)}–${x.hi.toFixed(0)}</span></td></tr>`).join('')}</table>`;
  }

  // ------------------------------------------------------------------ homes

  /** A vacant unit's asking rent, without touching the state (leases.ts sets it at midnight). */
  private ask(u: Building): number {
    if (u.lease && u.lease.tenant < 0) return u.lease.rent;
    const wage = referenceWage(this.ctx);
    const host = this.ctx.bById.get(u.host ?? -1);
    const central = this.ctx.lotById.get(host?.lot ?? u.lot)?.zone === 'core' ? 1.3 : 1;
    return u.kind === 'shopfront' ? wage * 0.55 * central : wage * (0.8 + 0.01 * (u.level ?? 0)) * central;
  }

  private homesSite(f: Firm, sub: string): string {
    const ctx = this.ctx, s = this.s;
    const nav = this.navFor(f);
    const tab = sub.startsWith('t=') ? sub.slice(2) : '';
    const want = (n: number, what: string) => (n >= 1 ? `${Math.round(n)} more ${what} wanted` : `no shortage`);
    const demand = `<div class="sp-box"><h4>Market report</h4><div class="kvp"><span>Flats</span><b>${want(residentialDemand(ctx), 'than empty')}</b><span>Office floors</span><b>${want(officeDemand(ctx), 'than empty')}</b>
      <span>Average rent</span><b>${(s.stats[s.stats.length - 1]?.avgRent ?? 0).toFixed(1)}/day</b></div><div class="nw-sub">Developers build when demand is high: blocks of flats further out, towers downtown where land is dear.</div></div>${boxAd(this.ads(1, f.id * 23 + 2)[0])}`;
    if (tab === 'commercial') {
      const units = [...vacantUnits(ctx, 'shopfront'), ...vacantUnits(ctx, 'suite')];
      const byTower = new Map<number, Building[]>();
      for (const u of units) { const a = byTower.get(u.host!) ?? []; a.push(u); byTower.set(u.host!, a); }
      const leased = s.buildings.filter((b) => b.host !== undefined && b.lease && b.lease.tenant >= 0).length;
      const main = `<div class="hm-hero"><b>${units.length} commercial units for lease</b> · ${leased} let · rent per day, a week up front</div>${[...byTower].map(([tid, list]) => {
        const t = ctx.bById.get(tid);
        if (!t) return '';
        list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
        const occupied = (t.hosted ?? []).length - list.length;
        return `<div class="hm-card"><div class="hm-img tower" style="--h:${Math.min(100, 30 + t.floors)}px"><span>${t.floors}F</span></div><div class="hm-main">
          <div class="hm-title">${t.floors}-floor ${esc(BUILDINGS[t.kind].label.toLowerCase())}${this.on(t)}</div>
          <div class="nw-sub">Landlord ${this.who(t.owner)} · ${occupied} of ${(t.hosted ?? []).length} units let</div>
          <div class="hm-units">${list.slice(0, 12).map((u) => `<span class="hm-unit" data-select="building:${u.id}">${u.kind === 'shopfront' ? '🏪 Shop, ground floor' : `🏢 Office, floor ${(u.level ?? 0) + 1}`} · ${Math.round(u.w * u.d)} m² · <b>${this.ask(u).toFixed(1)}/day</b>${u.lease?.since && s.tick - u.lease.since > MINUTES_PER_DAY ? ` <i>empty ${Math.floor((s.tick - u.lease.since) / MINUTES_PER_DAY)}d</i>` : ''}</span>`).join('')}${list.length > 12 ? `<span class="hm-unit">+${list.length - 12} more floors</span>` : ''}</div></div></div>`;
      }).join('') || '<p class="nw-sub">No shops or office floors for lease. When downtown fills up, developers put up towers with shops on the ground floor and offices above.</p>'}`;
      return this.frame(f, nav, sub, main, demand);
    }
    if (tab === 'buy') {
      const sales = s.auctions.filter((a) => a.item === 'building' || a.item === 'lot');
      const privateLots = s.roads.lots.filter((l) => l.building < 0 && l.forSale > 0 && (ctx.byId.has(l.owner) || (ctx.fById.has(l.owner) && !ctx.govOfFirm.has(l.owner))));
      const publicLots = s.roads.lots.filter((l) => l.building < 0 && l.forSale > 0 && ctx.govOfFirm.has(l.owner));
      const byZone = new Map<string, number[]>();
      for (const l of publicLots) { const a = byZone.get(l.zone) ?? []; a.push(l.forSale); byZone.set(l.zone, a); }
      const main = `<div class="hm-hero"><b>For sale</b> · ${sales.length} at auction · ${privateLots.length} private lots · ${publicLots.length} public lots</div>
        ${sales.map((a) => {
          const b = a.item === 'building' ? ctx.bById.get(a.target) : undefined;
          const top = highBid(a);
          const kind = b?.kind ?? 'house';
          const icon = kind === 'trailer' ? '🚐' : kind === 'house' ? '🏡' : TOWERS.includes(kind) ? '🏙' : kind === 'apartments' ? '🏢' : a.item === 'lot' ? '🌳' : '🏬';
          return `<div class="hm-card"${b ? ` data-select="building:${b.id}"` : ''}><div class="hm-img">${icon}</div><div class="hm-main"><div class="hm-title">${esc(describeItem(ctx, a).replace(/^./, (c) => c.toUpperCase()))}${b ? this.on(b) : ''}</div>
            <div class="nw-sub">${esc(a.reason)}${b ? ` · condition ${pct(b.condition)}` : ''}</div><div class="hm-price">${top ? `Top bid <b>${top.amount}</b> (${esc(first(nameOf(ctx, top.who)))})` : `Starting at <b>${a.reserve}</b>`} · closes ${until(s.tick, a.closes)}</div></div></div>`;
        }).join('') || '<p class="nw-sub">No homes at auction right now.</p>'}
        <div class="hm-card"><div class="hm-img">🚐</div><div class="hm-main"><div class="hm-title">New trailer home, delivered and set up</div><div class="nw-sub">From an outside dealer: needs a lot of your own (suburbs or outside the city)</div><div class="hm-price"><b>${BUILDINGS.trailer.delivered}</b> + the lot</div></div></div>
        <h3>Land</h3><table><tr><th>Seller</th><th>Zone</th><th class="r">Size</th><th class="r">Price</th></tr>${privateLots.slice(0, 12).map((l) => `<tr><td>${this.who(l.owner)}</td><td>${l.zone}</td><td class="r">${Math.round(l.w * l.d)} m²</td><td class="r">${l.forSale}</td></tr>`).join('')}
        ${[...byZone].map(([z, a]) => `<tr><td>${this.who(publicLots[0].owner)} (land office)</td><td>${z}</td><td class="r">${a.length} lots</td><td class="r">from ${Math.min(...a)}</td></tr>`).join('')}</table>`;
      return this.frame(f, nav, sub, main, demand);
    }
    // flats for rent, grouped by building, cheapest first
    const vac = vacancies(ctx);
    const byB = new Map<number, { b: Building; units: { unit: number; rent: number }[] }>();
    for (const x of vac) { const e = byB.get(x.b.id) ?? { b: x.b, units: [] }; e.units.push({ unit: x.unit, rent: x.rent }); byB.set(x.b.id, e); }
    const list = [...byB.values()].sort((a, b) => Math.min(...a.units.map((u) => u.rent)) - Math.min(...b.units.map((u) => u.rent)));
    const v = this.viewer();
    const featured = (b: Building) => (ctx.fById.get(b.owner)?.adSpend?.net ?? 0) > 0;
    const main = `<div class="hm-hero"><b>${vac.length} flat${vac.length === 1 ? '' : 's'} for rent</b> in ${list.length} building${list.length === 1 ? '' : 's'}${vac.length ? ` · from ${Math.min(...vac.map((x) => x.rent)).toFixed(1)}/day` : ''}${v ? ` · ${esc(first(v.name))} ${v.home < 0 ? 'has no home' : `pays ${(ctx.bById.get(v.home)?.units[v.unit]?.rent ?? 0).toFixed(1)}/day now`}` : ''}</div>
      ${list.sort((a, b) => Number(featured(b.b)) - Number(featured(a.b))).map(({ b, units }) => {
        const lo = Math.min(...units.map((u) => u.rent)), hi = Math.max(...units.map((u) => u.rent));
        const let_ = b.units.filter((u) => u.tenant >= 0).length;
        return `<div class="hm-card" data-select="building:${b.id}"><div class="hm-img ${TOWERS.includes(b.kind) ? 'tower' : 'block'}" style="--h:${Math.min(100, 24 + b.floors * 2)}px"><span>${b.floors}F</span></div><div class="hm-main">
          <div class="hm-title">${featured(b) ? '<span class="jb-badge promo">Featured</span> ' : ''}${units.length} flat${units.length === 1 ? '' : 's'} in a ${b.floors}-floor ${esc(BUILDINGS[b.kind].label.toLowerCase())}${this.on(b)}</div>
          <div class="nw-sub">Landlord ${this.who(b.owner)} · ${let_} of ${b.units.length} let · condition ${pct(b.condition)} · ${this.dist(b, v)} ${v ? 'from ' + esc(first(v.name)) + '\'s place' : 'from downtown'}</div>
          <div class="hm-price"><b>${lo.toFixed(1)}${hi > lo + 0.05 ? `–${hi.toFixed(1)}` : ''}</b> per day</div>
          <div class="hm-units">${(() => {
            const floors = new Map<number, number[]>();
            for (const u of units) { const fl = this.flatFloor(b, u.unit); const a = floors.get(fl) ?? []; a.push(u.rent); floors.set(fl, a); }
            const list = [...floors].sort((x, y) => x[0] - y[0]);
            return list.slice(0, 8).map(([fl, rents]) => `<span class="hm-unit">Floor ${fl} · ${rents.length} flat${rents.length === 1 ? '' : 's'} · ${Math.min(...rents).toFixed(1)}</span>`).join('') + (list.length > 8 ? `<span class="hm-unit">+${list.length - 8} more floors</span>` : '');
          })()}</div></div></div>`;
      }).join('') || '<p class="nw-sub">No flats for rent right now. Developers build when enough people are looking.</p>'}`;
    return this.frame(f, nav, '', main, demand);
  }

  /** The floor (1 = street level) a flat is on. */
  flatFloor(b: Building, unit: number): number {
    const def = BUILDINGS[b.kind];
    return Math.floor(unit / Math.max(1, def.unitsPerFloor)) + 1 + (def.podium ? 1 : 0);
  }

  // ---------------------------------------------------------- food delivery

  private restaurants(): { f: Firm; b: Building; open: boolean; soldOut: boolean }[] {
    const h = hourOf(this.s.tick);
    const [o, c] = BUILDINGS.restaurant.hours;
    const out: { f: Firm; b: Building; open: boolean; soldOut: boolean }[] = [];
    for (const f of this.s.firms) {
      if (f.closed || !f.prices.meal) continue;
      const b = f.sites.map((id) => this.ctx.bById.get(id)).find((x): x is Building => !!x && x.kind === 'restaurant' && x.built && !x.ruined);
      if (!b) continue;
      out.push({ f, b, open: h >= o && h < c, soldOut: b.store.groceries < 1.2 });
    }
    return out;
  }

  private delivery(f: Firm): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const v = this.viewer();
    const home = v ? ctx.bById.get(v.home) : undefined;
    const rest = this.restaurants();
    const couriers = s.people.filter((p) => { const x = p.task?.steps[p.task.i]; return x?.k === 'gig' && x.app === f.id; });
    const orders = s.shipments.filter((sh) => sh.meal && sh.app === f.id);
    const spon = (x: Firm) => (x.adSpend?.net ?? 0) > 0;
    rest.sort((a, b) => Number(b.open) - Number(a.open) || Number(spon(b.f)) - Number(spon(a.f)) || this.distKm(a.b, v) - this.distKm(b.b, v));
    const cards = rest.map(({ f: r, b, open, soldOut }) => {
      const km = this.distKm(b, v);
      const eta = Math.round(12 + km * 1000 / (couriers.some((c) => c.car >= 0) ? 300 : 75) / 2);
      const tag = /pizza/i.test(r.name) ? 'Pizza' : /burger/i.test(r.name) ? 'Burgers' : /bistro|café|cafe/i.test(r.name) ? 'Bistro' : /grill|bbq/i.test(r.name) ? 'Grill' : r.branch ? 'Fast food' : 'Restaurant';
      return `<div class="dl-card${open && !soldOut ? '' : ' closed'}" data-nav="firm:${r.id}"><div class="dl-img" style="background:linear-gradient(135deg, ${hsl(r.hue, 60, 52)}, ${hsl(r.hue + 0.08, 55, 32)})"><span>${esc(r.name[0])}</span>${spon(r) ? '<i class="mk-spon">Sponsored</i>' : ''}${!open ? `<em>Opens ${BUILDINGS.restaurant.hours[0]}:00</em>` : soldOut ? '<em>Sold out</em>' : ''}</div>
        <div class="dl-name">${esc(r.name)} ${this.stars(r.reputation)}</div><div class="nw-sub">${tag} · meal ${(r.prices.meal ?? 0).toFixed(2)} · ${eta}–${eta + 10} min · delivery ${ONLINE.mealDeliveryFee.toFixed(2)}</div></div>`;
    }).join('');
    const main = `<div class="dl-top"><span>📍 Deliver to <b>${home ? esc(streetOf(ctx, home) || 'home') : 'downtown'}</b>${v ? ` (${esc(first(v.name))})` : ''}</span><span class="nw-sub">${couriers.length} courier${couriers.length === 1 ? '' : 's'} online · ${orders.length} order${orders.length === 1 ? '' : 's'} on the way</span></div>
      <div class="dl-grid">${cards || '<p class="nw-sub">No restaurant is on the app yet.</p>'}</div>
      ${orders.length ? `<h3>Orders on the way</h3>${orders.slice(0, 10).map((sh) => `<div class="dl-order">${this.deliveryLine(sh)} → ${esc(first(nameOf(ctx, sh.recipient ?? -1)))}</div>`).join('')}` : ''}`;
    const jobs = (n: number) => `${n} job${n === 1 ? '' : 's'}`;
    const busy = couriers.slice().sort((a, b) => (b.gig?.jobs ?? 0) - (a.gig?.jobs ?? 0));
    const side = `<div class="sp-box"><h4>Couriers online (${couriers.length})</h4>${busy.slice(0, 7).map((p) => `<div class="sp-follow" data-nav="person:${p.id}">${this.av(p.id, 28)}<div><b>${esc(p.name)}</b><span class="nw-sub">${p.driving >= 0 || p.car >= 0 ? '🚗 by car' : '🚶 on foot'} · ${jobs(p.gig?.jobs ?? 0)} · earned ${(p.gig?.earned ?? 0).toFixed(0)}</span></div></div>`).join('') || '<p class="nw-sub">No courier is working right now.</p>'}${couriers.length > 7 ? `<div class="nw-sub">…and ${couriers.length - 7} more waiting for orders.</div>` : ''}
      <div class="nw-sub">Anyone with a phone can deliver: paid per job (most of the delivery fee, plus tips), no boss, no shifts.</div></div>
      <div class="sp-box"><h4>${esc(st.name)} today</h4><div class="kvp"><span>Meals sold</span><b>${cash(st.volume ?? 0)}</b><span>Deliveries ${today.label()}</span><b>${Math.round(today.data(s, 'gigs:' + f.id))}</b><span>Commission</span><b>${pct(st.fee ?? 0.18)} of the meal</b></div></div>
      ${boxAd(this.ads(1, f.id * 29 + 1, (a) => a.service === 'meal' || a.service === 'retail')[0] ?? this.ads(1, f.id * 29 + 2)[0])}`;
    return this.frame(f, this.navFor(f), '', main, side);
  }

  // ----------------------------------------------------------- ride-hailing

  /** A small map of the city's streets with dots on it. */
  private miniMap(dots: { x: number; y: number; color: string; r?: number; title?: string }[], h = 200): string {
    const s = this.s;
    const live = s.buildings.filter((b) => b.built && !b.ruined);
    if (!live.length) return '';
    // most of the city (the 90% of buildings nearest downtown), and whatever the dots need
    const c = s.center;
    const ds = live.map((b) => Math.hypot(b.x - c.x, b.y - c.y)).sort((a, b) => a - b);
    let r = (ds[Math.floor(ds.length * 0.9)] ?? 200) + 70;
    for (const d of dots) r = Math.max(r, Math.hypot(d.x - c.x, d.y - c.y) + 40);
    const W = 640;
    const sc = Math.min(W, h) / (2 * r);
    const X = (x: number) => (W / 2 + (x - c.x) * sc).toFixed(1), Y = (y: number) => (h / 2 + (y - c.y) * sc).toFixed(1);
    const lines = s.roads.edges.map((e) => {
      const a = this.ctx.nodeById.get(e.a), b = this.ctx.nodeById.get(e.b);
      if (!a || !b) return '';
      return `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${e.built === false ? '#d9cfb8' : '#ffffff'}" stroke-width="${e.kind === 'avenue' ? 4 : e.kind === 'street' ? 2.6 : 2}" stroke-linecap="round"/>`;
    }).join('');
    const blocks = live.filter((b) => b.host === undefined).map((b) => `<rect x="${X(b.x - b.w / 2)}" y="${Y(b.y - b.d / 2)}" width="${(b.w * sc).toFixed(1)}" height="${(b.d * sc).toFixed(1)}" fill="${TOWERS.includes(b.kind) ? '#b9b4a8' : '#d8d4ca'}"/>`).join('');
    const pins = dots.map((d) => `<circle cx="${X(d.x)}" cy="${Y(d.y)}" r="${d.r ?? 5}" fill="${d.color}" stroke="#fff" stroke-width="1.5">${d.title ? `<title>${esc(d.title)}</title>` : ''}</circle>`).join('');
    return `<svg class="nw-map" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet"><rect width="${W}" height="${h}" fill="#ece8de"/>${blocks}${lines}${pins}</svg>`;
  }

  private rides(f: Firm): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const v = this.viewer();
    const drivers = s.people.filter((p) => { const x = p.task?.steps[p.task.i]; return x?.k === 'gig' && x.app === f.id; });
    const rides = s.vehicles.filter((x) => x.owner === f.id);
    const from = v ? ctx.bById.get(v.home) : undefined;
    const fx = from?.x ?? s.center.x, fy = from?.y ?? s.center.y;
    // where people go: city hall, the tallest building, the biggest workplaces, a park, the restaurants
    const dests: { name: string; b: Building }[] = [];
    const add = (b: Building | undefined, name?: string) => { if (b && b.built && !b.ruined && !dests.some((d) => d.b === b)) dests.push({ name: name ?? ctx.fById.get(b.firm)?.name ?? BUILDINGS[b.kind].label, b }); };
    const g = mainPolity(ctx);
    add(ctx.bById.get(g?.seat ?? -1), 'City hall');
    const live = s.buildings.filter((x) => x.built && !x.ruined && x.host === undefined);
    add(live.reduce<Building | undefined>((a, b) => (!a || b.floors > a.floors ? b : a), undefined));
    const staff = new Map<number, number>();
    for (const c of s.contracts) staff.set(c.site, (staff.get(c.site) ?? 0) + 1);
    for (const [id] of [...staff].sort((a, b) => b[1] - a[1]).slice(0, 3)) add(ctx.bById.get(id));
    add(live.find((x) => x.kind === 'park'), 'The park');
    add(live.filter((x) => x.kind === 'restaurant').sort((a, b) => Math.hypot(b.x - fx, b.y - fy) - Math.hypot(a.x - fx, a.y - fy))[0]);
    dests.splice(7);
    const fare = (b: Building) => 2 + (Math.hypot(b.x - fx, b.y - fy) / 1000) * 2.5;
    const map = this.miniMap([
      ...drivers.map((p) => ({ x: p.x, y: p.y, color: hsl(st.color, 70, 45), r: 5, title: `${p.name} (driver)` })),
      ...rides.map((r) => ({ x: r.x, y: r.y, color: '#1d1d1b', r: 5.5, title: `a ride with ${nameOf(ctx, r.driver)}` })),
      { x: fx, y: fy, color: '#2a63b8', r: 7, title: v ? `${v.name}'s place` : 'downtown' },
    ]);
    const main = `<div class="rd-map">${map}<div class="rd-where"><div class="rd-from">● ${v && from ? `${esc(first(v.name))}'s place${this.on(from).replace(' · ', ', ')}` : 'Downtown'}</div><div class="rd-to">■ Where to?</div></div></div>
      <h3>Popular destinations</h3>${dests.map((d) => `<div class="rd-dest"><span>📍 ${esc(d.name)}<span class="nw-sub"> · ${Math.hypot(d.b.x - fx, d.b.y - fy) < 1000 ? `${Math.round(Math.hypot(d.b.x - fx, d.b.y - fy) / 10) * 10} m` : `${(Math.hypot(d.b.x - fx, d.b.y - fy) / 1000).toFixed(1)} km`}</span></span><b>${fare(d.b).toFixed(2)}</b><span class="nw-btn sm">${drivers.length ? `${Math.max(2, Math.round(Math.min(...drivers.map((p) => Math.hypot(p.x - fx, p.y - fy))) / 400))} min` : 'no cars'}</span></div>`).join('')}
      <p class="nw-sub">Fares are 2 plus 2.50 per km. Drivers keep three quarters; ${esc(st.name)} keeps ${pct(st.fee ?? 0.25)}.</p>`;
    const side = `<div class="sp-box"><h4>Drivers online (${drivers.length})</h4>${drivers.map((p) => `<div class="sp-follow" data-nav="person:${p.id}">${this.av(p.id, 28)}<div><b>${esc(p.name)}</b><span class="nw-sub">${p.gig?.jobs ?? 0} ride${p.gig?.jobs === 1 ? '' : 's'} · earned ${(p.gig?.earned ?? 0).toFixed(0)} · ${this.stars(p.traits.agreeable)}</span></div></div>`).join('') || '<p class="nw-sub">No driver is online. Anyone with a car can drive for the app.</p>'}</div>
      <div class="sp-box"><h4>${esc(st.name)} today</h4><div class="kvp"><span>Rides ${today.label()}</span><b>${Math.round(today.data(s, 'rides:' + f.id))}</b><span>Riding now</span><b>${rides.length}</b><span>Fares today</span><b>${cash(st.volume ?? 0)}</b><span>All-time rides (city)</span><b>${count(s.counters.rides ?? 0)}</b></div></div>
      ${boxAd(this.ads(1, f.id * 37 + 1)[0])}`;
    return this.frame(f, this.navFor(f), '', main, side);
  }

  // --------------------------------------------------------------- payments

  private pay(f: Firm): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const v = this.viewer();
    const users = new Set(s.people.filter((p) => p.pol.sites.includes(f.id)).map((p) => p.id));
    // payments in progress: local orders by users (the store is paid through the app), meals and rides
    const recent = s.shipments.filter((sh) => sh.recipient !== undefined && users.has(sh.recipient) && sh.from >= 0).slice(-14).reverse();
    const merchants = new Set(s.firms.filter((x) => !x.closed && (BUILDINGS[x.kind].service === 'retail' || BUILDINGS[x.kind].service === 'meal' || x.site?.kind === 'rides')).map((x) => x.id)).size;
    const row = (sh: Shipment) => {
      const b = ctx.bById.get(sh.from);
      const seller = ctx.fById.get(b?.firm ?? -1);
      const g = GOODS.find((x) => sh.goods[x] >= 0.5);
      const amount = sh.meal ? seller?.prices.meal ?? 5 : g && seller?.prices[g] ? seller.prices[g]! * sh.goods[g] : 0;
      return `<div class="py-row">${this.av(sh.recipient!, 30)}<div><b>${esc(first(nameOf(ctx, sh.recipient!)))}</b> paid <b>${esc(seller?.name ?? 'a shop')}</b><span class="nw-sub">${sh.meal ? 'dinner' : g ? `${Math.round(sh.goods[g])} ${goodLabel(g)}` : 'an order'} · ${ago(s.tick, sh.created)} ago</span></div><span class="py-amt">−${amount.toFixed(2)}</span></div>`;
    };
    const card = v ? `<div class="py-card"><div class="nw-sub" style="color:#fffb">${users.has(v.id) ? `${esc(st.name)} balance` : `${esc(first(v.name))} isn't on ${esc(st.name)}`}</div><div class="py-bal">${users.has(v.id) ? v.money.toFixed(2) : '—'}</div><div>${esc(v.name)}</div><span class="py-chip">◉◉</span></div>`
      : `<div class="py-card"><div class="nw-sub" style="color:#fffb">Pay anyone in ${esc(mainPolity(ctx)?.short ?? 'the city')}</div><div class="py-bal">${count(users.size)} users</div><div>${merchants} shops, restaurants and apps accept it</div><span class="py-chip">◉◉</span></div>`;
    const shops = s.firms.filter((x) => !x.closed && (x.salesAvg.online ?? 0) > 0).sort((a, b) => (b.salesAvg.online ?? 0) - (a.salesAvg.online ?? 0)).slice(0, 8);
    const main = `${card}<div class="py-actions"><span>↑ Send</span><span>↓ Request</span><span>⌁ Scan to pay</span><span>⋯ More</span></div>
      <h3>Recent payments</h3>${recent.map(row).join('') || '<p class="nw-sub">No payments in progress right now.</p>'}
      ${shops.length ? `<h3>Where people pay online</h3>${shops.map((x) => `<div class="py-row" data-nav="firm:${x.id}"><span class="sp-av sq" style="background:${hsl(x.hue, 60, 42)};width:30px;height:30px;font-size:14px">${esc(x.name[0])}</span><div><b>${esc(x.name)}</b><span class="nw-sub">${esc(BUILDINGS[x.kind].label)} · ${(x.salesAvg.online ?? 0).toFixed(1)} online orders a day</span></div><span class="nw-sub">${((st.fee ?? 0.015) * 100).toFixed(1)}% fee</span></div>`).join('')}` : ''}`;
    const side = `<div class="sp-box"><h4>${esc(st.name)} today</h4><div class="kvp"><span>Paid through the app</span><b>${cash(st.volume ?? 0)}</b><span>Fee</span><b>${((st.fee ?? 0.015) * 100).toFixed(1)}% (paid by the shop)</b><span>Users</span><b>${users.size}</b><span>Merchants</span><b>${merchants}</b></div>
      <div class="nw-sub">No ads: ${esc(st.name)} earns from the fee on every payment.</div></div>`;
    return this.frame(f, this.navFor(f), '', main, side);
  }

  // ----------------------------------------------------------- crowdfunding

  private crowd(f: Firm): string {
    const ctx = this.ctx, s = this.s, st = f.site!;
    const all = (s.crowdfunds ?? []).filter((c) => c.site === f.id);
    const order = { open: 0, funded: 1, failed: 2 } as const;
    all.sort((a, b) => order[a.status] - order[b.status] || b.raised / b.goal - a.raised / a.goal);
    const cards = all.map((c) => {
      const share = Math.min(1, c.raised / Math.max(1, c.goal));
      const founder = ctx.byId.get(c.founder);
      const top = c.backers.slice().sort((a, b) => b.amount - a.amount).slice(0, 3);
      const status = c.status === 'funded' ? '<span class="cf-status ok">✓ Funded</span>' : c.status === 'failed' ? '<span class="cf-status bad">Didn\'t make it · backers refunded</span>' : `<span class="cf-status">${until(s.tick, c.deadline).replace('in ', '')} left</span>`;
      return `<div class="cf-card ${c.status}"><div class="cf-img" style="background:linear-gradient(135deg, ${hsl(hash01(c.id), 55, 55)}, ${hsl(hash01(c.id) + 0.12, 50, 30)})"><span>${esc(BUILDINGS[c.kind].label)}</span></div>
        <div class="cf-main"><div class="cf-title">${esc(c.title)}</div><div class="nw-sub">by ${founder ? `<a data-nav="person:${founder.id}">${esc(founder.name)}</a>` : 'someone who left'} · a new ${esc(BUILDINGS[c.kind].label.toLowerCase())} · started ${ago(s.tick, c.start)} ago</div>
        <div class="cf-bar"><span style="width:${(share * 100).toFixed(1)}%"></span></div>
        <div class="cf-nums"><span><b>${c.raised.toFixed(0)}</b> of ${c.goal} raised</span><span><b>${pct(share)}</b></span><span><b>${c.backers.length}</b> backers</span>${status}</div>
        ${top.length ? `<div class="nw-sub">Top backers: ${top.map((b) => `${esc(first(nameOf(ctx, b.who)))} ${b.amount.toFixed(0)}`).join(', ')}</div>` : ''}</div></div>`;
    }).join('');
    const raised = all.filter((c) => c.status === 'funded').reduce((a, c) => a + c.raised, 0);
    const main = `<div class="cf-hero"><b>Back the next business in ${esc(mainPolity(ctx)?.short ?? 'the city')}</b><div class="nw-sub">People who can't afford to start a business ask the crowd. If the goal is reached in ten days, the founder gets the money (minus ${pct(st.fee ?? 0.05)}); if not, everyone gets theirs back.</div></div>
      ${cards || '<p class="nw-sub">No campaigns yet.</p>'}`;
    const side = `<div class="sp-box"><h4>So far</h4><div class="kvp"><span>Campaigns</span><b>${all.length}</b><span>Live now</span><b>${all.filter((c) => c.status === 'open').length}</b><span>Funded</span><b>${all.filter((c) => c.status === 'funded').length}</b><span>Raised for founders</span><b>${cash(raised)}</b></div><div class="nw-sub">No ads: ${esc(st.name)} keeps a share of what funded campaigns raise.</div></div>`;
    return this.frame(f, this.navFor(f), '', main, side);
  }

  // ------------------------------------------------------------------ about

  private about(f: Firm): string {
    const ctx = this.ctx, st = f.site!;
    const coders = ctx.s.contracts.filter((c) => c.firm === f.id && c.role === 'programmer').length;
    const staff = ctx.s.contracts.filter((c) => c.firm === f.id).length;
    const fee = st.fee === undefined ? '—' : st.fee < 1 ? `${(st.fee * 100).toFixed(st.fee < 0.05 ? 1 : 0)}%` : `${st.fee.toFixed(1)} per listing`;
    const advertisers = this.s.firms.filter((x) => !x.closed && (x.adSpend?.net ?? 0) > 0).sort((a, b) => (b.adSpend!.net ?? 0) - (a.adSpend!.net ?? 0));
    return `<div class="ab-grid">
      <div class="ab-tile"><b>${count(st.users)}</b><span>accounts</span></div><div class="ab-tile"><b>${count(st.active)}</b><span>visits yesterday</span></div>
      <div class="ab-tile"><b>${pct(st.quality)}</b><span>quality (programmers' work)</span></div><div class="ab-tile"><b>${sellsAds(f) ? (st.cpm ?? 0).toFixed(2) : '—'}</b><span>price per 1,000 ad views (CPM)</span></div>
      <div class="ab-tile"><b>${count(st.impressions ?? 0)}</b><span>ad views today so far</span></div><div class="ab-tile"><b>${cash(st.adRevenue ?? 0)}</b><span>ad sales today</span></div>
      <div class="ab-tile"><b>${fee}</b><span>commission / fee</span></div><div class="ab-tile"><b>${cash(st.volume ?? 0)}</b><span>money through the site today</span></div></div>
      <div class="kvp wide"><span>Run by</span><b>${this.who(f.id)}, owned by ${this.who(f.owner)}</b><span>Launched</span><b>${formatTime(st.launched)}</b><span>Staff</span><b>${staff} (${coders} programmers)</b>
        <span>Feed</span><b>${st.kind === 'social' ? `${st.feed}${st.charLimit ? `, ${st.charLimit}-character posts` : ''}` : st.anonymous ? 'anonymous' : '—'}</b><span>Price</span><b>${st.subscription ? `${st.subscription}/day` : 'free'}</b>
        <span>Company cash</span><b>${cash(f.cash)}</b><span>Profit yesterday</span><b>${cash(f.ledger.days[f.ledger.days.length - 1] ?? 0)}</b></div>
      <h3>How ${esc(st.name)} makes money</h3><p>${MONEY[st.kind]}</p>
      ${sellsAds(f) ? `<h3>Advertisers (online, all sites)</h3><table><tr><th>Company</th><th class="r">Online ads/day</th><th class="r">All ads/day</th></tr>${advertisers.slice(0, 12).map((x) => `<tr><td>${this.who(x.id)}</td><td class="r">${(x.adSpend!.net ?? 0).toFixed(2)}</td><td class="r">${Object.values(x.adSpend!).reduce((a, b) => a + (b ?? 0), 0).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="3">No company advertises online yet.</td></tr>'}</table>
        <p class="nw-sub">Companies spread their online budget over the city's sites by audience; ${esc(st.name)}'s share depends on its visits. Ads are targeted: things near you, food when you're hungry, employers when you're out of work, candidates close to your views.</p>` : ''}
      <p><button class="nw-link" data-select="firm:${f.id}">show the company in the city</button></p>`;
  }

  // ------------------------------------------------------------- listings

  private jobsTable(): string {
    const ctx = this.ctx;
    const rows = this.s.postings.map((p) => {
      const site = ctx.bById.get(p.site);
      return `<tr><td>${esc(ROLE[p.role].label)}</td><td>${this.who(p.firm)}</td><td>${site ? BUILDINGS[site.kind].label : ''}</td><td class="r">${p.wage.toFixed(1)}</td><td class="r">${ROLE[p.role].edu ? `${ROLE[p.role].edu}y school` : '—'}</td><td class="r">${p.applicants.length}</td></tr>`;
    }).join('');
    return `<h3>Jobs</h3><table><tr><th>Position</th><th>Company</th><th>Where</th><th class="r">Per shift</th><th class="r">Needs</th><th class="r">Applied</th></tr>${rows || '<tr><td colspan="6">No openings right now.</td></tr>'}</table>`;
  }

  private homesTable(): string {
    const vac = vacancies(this.ctx).sort((a, b) => a.rent - b.rent).slice(0, 40);
    return `<h3>Flats for rent</h3><table><tr><th>Building</th><th>Landlord</th><th class="r">Floor</th><th class="r">Rent / day</th></tr>${vac.map((v) => `<tr><td><a data-select="building:${v.b.id}">${v.b.floors}-floor ${esc(BUILDINGS[v.b.kind].label.toLowerCase())}</a></td><td>${this.who(v.b.owner)}</td><td class="r">${this.flatFloor(v.b, v.unit)}</td><td class="r">${v.rent.toFixed(1)}</td></tr>`).join('') || '<tr><td colspan="4">No vacancies.</td></tr>'}</table>`;
  }

  private auctions(): string {
    const ctx = this.ctx;
    const list = this.s.auctions.slice(-40);
    return `<h3>For sale: auctions</h3><table><tr><th>What</th><th>Why</th><th class="r">Reserve</th><th class="r">Top bid</th><th class="r">Closes</th></tr>${list.map((a) => {
      const top = highBid(a);
      return `<tr><td>${a.item === 'building' ? `<a data-select="building:${a.target}">${esc(describeItem(ctx, a))}</a>` : esc(describeItem(ctx, a))}</td><td>${esc(a.reason)}</td><td class="r">${a.reserve}</td><td class="r">${top ? `${top.amount} (${esc(first(nameOf(ctx, top.who)))})` : '—'}</td><td class="r">${formatTime(a.closes)}</td></tr>`;
    }).join('') || '<tr><td colspan="5">Nothing at auction.</td></tr>'}</table>`;
  }

  private companies(): string {
    const ctx = this.ctx;
    const firms = this.s.firms.filter((f) => !f.closed && f.website)
      .map((f) => ({ f, staff: ctx.s.contracts.filter((c) => c.firm === f.id).length }))
      .sort((a, b) => b.staff - a.staff || b.f.cash - a.f.cash);
    const without = this.s.firms.filter((f) => !f.closed && !f.website && !ctx.govOfFirm.has(f.id)).length;
    return `<div class="nw-one"><h2>Company homepages</h2><p class="nw-sub">${firms.length} companies have a website; ${without} don't (customers find those by walking past, by word of mouth and ads).</p>
      <div class="dir">${firms.map(({ f, staff }) => `<a class="dir-row" data-nav="firm:${f.id}"><span class="sp-av sq" style="background:${hsl(f.hue, 60, 42)};width:30px;height:30px;font-size:14px">${esc(f.name[0])}</span><b>${esc(f.name)}</b><span class="nw-sub">${BUILDINGS[f.kind].label}${f.branch ? ' · chain' : ''} · ${staff} staff</span></a>`).join('') || '<p class="nw-sub">No company has a website yet.</p>'}</div></div>`;
  }

  // ---------------------------------------------------------------- the city

  private gov(id: number): string {
    const ctx = this.ctx;
    const g = ctx.gById.get(id);
    if (!g) return '<p>This government no longer exists.</p>';
    const off = g.offices.filter((o) => o.holder >= 0).map((o) => `<tr><td>${esc(o.title)}</td><td>${this.who(o.holder)}</td><td>${esc(ctx.partyById.get(o.party)?.name ?? 'independent')}</td></tr>`).join('');
    const laws = g.laws.slice(-15).reverse().map((l) => `<div class="nw-news"><span class="nw-meta">${formatTime(l.t)}</span> ${l.passed ? '✔' : '✘'} ${esc(l.title)} <span class="nw-sub">(${esc(l.how)}${l.how === 'decree' ? '' : `, ${l.yes}–${l.no}`})</span></div>`).join('');
    const e = this.s.elections.find((x) => x.polity === g.id && (x.status === 'campaign' || x.status === 'voting'));
    const cands = e ? e.candidates.filter((c) => !c.withdrawn).map((c) => `<tr><td>${this.who(c.person)}</td><td>${esc(g.offices.find((o) => o.id === c.office)?.title ?? '')}</td><td>${esc(ctx.partyById.get(c.party)?.name ?? 'independent')}</td><td>${esc(c.slogan)}</td></tr>`).join('') : '';
    const lots = this.s.roads.lots.filter((l) => l.owner === g.firm && l.building < 0 && l.forSale > 0);
    const byZone = new Map<string, number[]>();
    for (const l of lots) { const a = byZone.get(l.zone) ?? []; a.push(l.forSale); byZone.set(l.zone, a); }
    const p = g.policy;
    return `<div class="nw-site gov" style="--brand:${hsl(g.hue, 45, 35)};--brand-soft:${hsl(g.hue, 40, 95)};--brand-deep:${hsl(g.hue, 45, 22)}">
      <header class="nw-head gov-head"><span class="nw-logo"><span>★</span>${esc(g.name)}</span><span class="nw-tagline">${esc(g.label)} · official website</span></header><div class="nw-one">
      <p>Treasury ${treasury(ctx, g).toFixed(0)} · property tax ${(p.propertyTax * 100).toFixed(1)}%/yr · income tax ${(p.incomeTax * 100).toFixed(1)}% · sales tax ${(p.salesTax * 100).toFixed(1)}% · welfare ${p.welfare}/day${p.minWage ? ` · minimum wage ${p.minWage}` : ''}${p.rentCap ? ` · rent cap ${p.rentCap}` : ''}${p.maxFloors ? ` · height limit ${p.maxFloors} floors` : ''}</p>
      ${e ? `<h3>${e.kind === 'referendum' ? `Referendum: ${esc(e.motion?.title ?? '')}` : `Election on ${formatTime(e.day)}`}</h3>${cands ? `<table><tr><th>Candidate</th><th>For</th><th>Party</th><th>Slogan</th></tr>${cands}</table>` : ''}` : ''}
      <h3>Officials</h3><table>${off || '<tr><td>No one in office.</td></tr>'}</table>
      <h3>Recent decisions</h3>${laws || '<p class="nw-sub">None yet.</p>'}
      <h3>Public land for sale</h3><p>${[...byZone].map(([z, a]) => `${a.length} ${z} lots from ${Math.min(...a)}`).join(' · ') || 'None right now.'}</p>
      ${this.jobsTable().replace('<h3>Jobs</h3>', '<h3>Working for the city (and everyone else\'s openings)</h3>')}
    </div></div>`;
  }

  /** A company's own homepage (companies that aren't internet sites). */
  private firmSite(f: Firm): string {
    const ctx = this.ctx, s = this.s;
    const def = BUILDINGS[f.kind];
    const prices = Object.entries(f.prices).filter(([k, v]) => v && k !== 'build' && k !== 'freight' && k !== 'rate').map(([k, v]) => `<tr><td>${GOOD_ICON[k] ?? ''} ${esc(k === 'meal' ? 'a meal' : goodLabel(k))}</td><td class="r">${v!.toFixed(2)}</td></tr>`).join('');
    const jobs = s.postings.filter((p) => p.firm === f.id).map((p) => `<div class="jb-mini"><b>${esc(ROLE[p.role].label)}</b> · ${p.wage.toFixed(1)} per shift · ${p.applicants.length} applied</div>`).join('');
    const posts = s.posts.filter((p) => p.who === f.id).slice(-6).reverse();
    const sites = f.sites.map((id) => ctx.bById.get(id)).filter((b): b is Building => !!b && !b.ruined);
    const market = this.siteOfKind('shop');
    const stock = (g: Good) => sites.reduce((a, b) => a + (b.kind === 'store' ? b.store[g] : 0), 0);
    const shop = def.service === 'retail' && (f.webshop || f.website || market)
      ? `<h3>${market ? `Order online (on ${esc(market.site!.name)})` : 'Web shop'}</h3><div class="mk-row">${RETAIL_GOODS.filter((g) => f.prices[g]).map((g) => `<div class="mk-card"${market ? ` data-nav="site:${market.id}/c=${g}"` : ''}><div class="mk-img">${GOOD_ICON[g]}</div><div class="mk-title">${esc(goodLabel(g))}</div><div class="mk-price">${f.prices[g]!.toFixed(2)}</div><div class="nw-sub">${Math.floor(stock(g))} in stock</div><div class="mk-ship">Delivered today · ${ONLINE.localDeliveryFee.toFixed(2)}</div></div>`).join('')}</div>` : '';
    const owner = f.owner === OUTSIDE.id ? `${esc(f.branch ?? f.name)} (a company from outside the city)` : this.who(f.owner);
    return `<div class="nw-site firm" style="--brand:${hsl(f.hue, 60, 42)};--brand-soft:${hsl(f.hue, 70, 95)};--brand-deep:${hsl(f.hue, 60, 26)}">
      <header class="nw-head"><span class="nw-logo"><span>${esc(f.name[0])}</span>${esc(f.name)}</span><span class="nw-tagline">${esc(f.slogan)}</span><nav><a class="on">Home</a>${jobs ? '<a>Careers</a>' : ''}<a>Contact</a></nav></header>
      <div class="fm-hero"><h2>${esc(f.slogan)}.</h2><div>${esc(def.label)}${sites.length > 1 ? ` · ${sites.length} locations` : ''} · since ${formatTime(f.founded).split(',')[0]}${f.branch ? ` · part of ${esc(f.branch)}, a national chain` : ''}</div></div>
      <div class="nw-one">
      <p>Owned by ${owner}${f.manager !== undefined && ctx.byId.has(f.manager) ? ` · managed by ${this.who(f.manager)}` : ''} <button class="nw-link" data-select="firm:${f.id}">show in the city</button></p>
      ${f.channel ? `<p>📺 ${esc(f.channel.name)} · ${f.channel.viewers} viewers yesterday</p>` : ''}
      ${shop}
      ${prices ? `<h3>Prices</h3><table>${prices}</table>` : ''}
      ${f.prices.freight ? `<p>Freight: ${(f.prices.freight * 1000).toFixed(1)} per ton-km</p>` : ''}
      <h3>Find us</h3>${sites.map((b) => `<div class="jb-mini"><a data-select="building:${b.id}">${esc(BUILDINGS[b.kind].label)}</a> · ${this.where(b) || 'the city'}${b.lease && b.lease.tenant === f.id ? ` <span class="nw-sub">(leased from ${esc(nameOf(ctx, b.owner))})</span>` : ''} · open ${BUILDINGS[b.kind].hours[0]}:00–${BUILDINGS[b.kind].hours[1]}:00</div>`).join('') || '<p class="nw-sub">—</p>'}
      <h3>Careers</h3>${jobs || '<p class="nw-sub">No openings right now.</p>'}
      ${posts.length ? `<h3>Updates</h3>${posts.map((p) => `<div class="nw-post"><div class="nw-meta">${formatTime(p.t)}${p.sponsor !== undefined ? ' · sponsored' : ''}</div>${esc(p.text)}</div>`).join('')}` : ''}
    </div></div>`;
  }

  private profile(id: number): string {
    const ctx = this.ctx;
    const p = ctx.byId.get(id);
    if (!p) return '<div class="nw-one"><p>This person is no longer here.</p></div>';
    // their profile on the biggest social network they're on
    const social = p.pol.sites.map((x) => ctx.fById.get(x)).filter((f): f is Firm => !!f?.site && !f.closed && f.site.kind === 'social').sort((a, b) => b.site!.users - a.site!.users)[0];
    if (social) return this.frame(social, this.navFor(social), `u=${p.id}`, this.socialProfile(social, p.id), this.socialSide(social));
    const c = ctx.cById.get(p.job);
    const posts = this.s.posts.filter((x) => x.who === p.id).slice(-15).reverse();
    const sites = p.pol.sites.map((s) => ctx.fById.get(s)?.site?.name).filter(Boolean).join(', ');
    return `<div class="nw-one"><h2>${esc(p.name)}</h2>
      <p class="nw-sub">${c ? `${ROLE[c.role].label} at ${this.who(c.firm)}` : p.firms.length ? `owner of ${p.firms.map((f) => this.who(f)).join(', ')}` : 'looking for work'} · from ${esc(p.origin)}${sites ? ` · on ${esc(sites)}` : ' · no accounts on the Net'}
       <button class="nw-link" data-select="person:${p.id}">show in the city</button></p>
      ${posts.map((x) => `<div class="nw-post"><div class="nw-meta">${formatTime(x.t)} · ♥ ${x.likes}</div>${esc(x.text)}</div>`).join('') || '<p class="nw-sub">No posts.</p>'}</div>`;
  }
}
