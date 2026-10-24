// TV: a window showing what's on. Channels are companies in the simulation;
// every broadcast was made from what actually happened (news chosen and
// framed by the channel's slant, talk shows with officials, debates).
//
// The screen at the top plays the broadcast: the presenter or guest who is
// speaking (drawn from their looks), the line as a caption, the ad break with
// the spots the channel actually sold, and color bars when nothing is on.
// "Watch with them" (from a person who is watching TV) tunes it to their
// channel and shows how they take it.

import { formatTime, hourOf, nameOf } from '../sim/ctx';
import { compass, compassLabel } from '../sim/ideology';
import { SHOWS } from '../sim/media';
import type { Simulation } from '../sim/sim';
import type { Broadcast, Firm, Person } from '../sim/types';
import { SKIN } from '../render/palette';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hsl = (h: number, s = 55, l = 45) => `hsl(${Math.round(h * 360)} ${s}% ${l}%)`;

/** How long each picture stays on the screen (real time). */
const FRAME_MS = 4500;

/** What's on the screen at one moment. */
type Frame =
  | { k: 'title' }
  | { k: 'line'; who: number; text: string }
  | { k: 'ad'; id: number };

export class TV {
  el: HTMLDivElement;
  private channel = -1;
  private body: HTMLDivElement;
  private screen: HTMLDivElement;
  private info: HTMLDivElement;
  /** Watching along with this person (-1: just the TV). */
  private watcher = -1;
  /** The broadcast on screen and when it came on (real ms), so the pictures play from the start. */
  private shown = -1;
  private since = 0;
  private screenKey = '';

  constructor(private sim: Simulation, private onSelect: (kind: 'person' | 'firm', id: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'netwin tv';
    this.el.style.display = 'none';
    this.el.innerHTML = `<div class="nw-bar"><span class="nw-addr">📺 Television</span><button data-close title="Close">✕</button></div><div class="nw-tabs"></div><div class="nw-body"><div class="tv-screen-wrap"></div><div class="tv-info"></div></div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector('.nw-body')!;
    this.screen = this.el.querySelector('.tv-screen-wrap')!;
    this.info = this.el.querySelector('.tv-info')!;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { this.hide(); return; }
      if (t.closest('[data-unwatch]')) { this.watcher = -1; this.render(); return; }
      const ch = t.closest('[data-channel]') as HTMLElement | null;
      // changing the channel yourself: no longer seeing what they see
      if (ch) { this.channel = Number(ch.dataset.channel); this.watcher = -1; this.render(); return; }
      const sel = t.closest('[data-select]') as HTMLElement | null;
      if (sel) { const [k, id] = sel.dataset.select!.split(':'); this.onSelect(k as 'person' | 'firm', Number(id)); }
    });
  }

  setSim(sim: Simulation): void {
    this.sim = sim;
    this.channel = -1;
    this.watcher = -1;
  }

  toggle(): void {
    if (this.el.style.display === 'none') { this.el.style.display = 'flex'; this.render(); } else this.hide();
  }

  /** Sit down next to someone and watch what they're watching. */
  watchWith(personId: number): void {
    const p = this.sim.ctx.byId.get(personId);
    if (!p) return;
    this.watcher = personId;
    if (p.pol.tv >= 0) this.channel = p.pol.tv;
    this.el.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.el.style.display = 'none';
    this.watcher = -1;
  }

  update(): void {
    if (this.el.style.display !== 'none') this.render();
  }

  private channels(): Firm[] {
    return this.sim.state.firms.filter((f) => f.channel && !f.closed);
  }

  private render(): void {
    const ctx = this.sim.ctx;
    const watcher = this.watcher >= 0 ? ctx.byId.get(this.watcher) : undefined;
    if (this.watcher >= 0 && !watcher) this.watcher = -1;
    // they flicked to another channel: so do we
    if (watcher && watcher.pol.tv >= 0 && ctx.fById.get(watcher.pol.tv)?.channel) this.channel = watcher.pol.tv;
    const chans = this.channels();
    const nav = this.el.querySelector('.nw-tabs') as HTMLDivElement;
    if (!chans.some((f) => f.id === this.channel)) this.channel = chans[0]?.id ?? -1;
    nav.innerHTML = chans.map((f) => `<button data-channel="${f.id}" class="${f.id === this.channel ? 'on' : ''}" style="color:${hsl(f.hue, 60, 34)}">${esc(f.channel!.name)}${f.channel!.onAir >= 0 ? ' ●' : ''}</button>`).join('');
    const scroll = this.body.scrollTop;
    const f = ctx.fById.get(this.channel);
    if (!f?.channel) {
      this.setScreen('none', () => this.offAir(undefined));
      this.info.innerHTML = `<p class="nw-sub">There's no TV station yet. Someone will start one when enough homes have a TV and advertisers want to reach them. Until then, people get their news from each other and the Net.</p>`;
      return;
    }
    const ch = f.channel;
    const now = this.sim.state.broadcasts.find((b) => b.id === ch.onAir);
    if ((now?.id ?? -1) !== this.shown) { this.shown = now?.id ?? -1; this.since = performance.now(); }
    let frame: Frame | undefined;
    if (now) {
      const frames = framesOf(now);
      const i = Math.floor((performance.now() - this.since) / FRAME_MS) % frames.length;
      frame = frames[i];
      this.setScreen(`${f.id}:${now.id}:${i}`, () => this.onScreen(f, now, frame!));
    } else this.setScreen(`off:${f.id}`, () => this.offAir(f));
    const recent = this.sim.state.broadcasts.filter((b) => b.channel === f.id && b.id !== ch.onAir).slice(-8).reverse();
    const owner = ctx.byId.get(f.owner);
    this.info.innerHTML = `${watcher ? this.watchingWith(watcher, f, now, frame) : ''}
      <div class="nw-site" style="--brand:${hsl(f.hue)}"><div class="nw-hero"><h2>${esc(ch.name)}</h2>
      <div>${now ? `ON AIR: ${esc(now.show)}` : 'off the air right now'}</div>
      <div class="nw-sub" style="color:#fffc">owned by ${esc(nameOf(ctx, f.owner))} · editorial line ${compassLabel(ch.slant, ch.slantAuth)} · ${ch.viewers} viewers yesterday · ads ${ch.adPrice.toFixed(0)}/day</div></div>
      ${now ? this.broadcast(now, true) : '<p class="nw-sub">Shows air 7–9, 12–14 and 18–23 when a presenter is in the studio.</p>'}
      ${recent.length ? `<h3>Earlier</h3>${recent.map((b) => this.broadcast(b, false)).join('')}` : ''}
      ${owner ? `<p><button class="nw-link" data-select="firm:${f.id}">show the station in the city</button></p>` : ''}</div>`;
    this.body.scrollTop = scroll;
  }

  /** Redraw the screen only when the picture changes (so the news ticker keeps scrolling). */
  private setScreen(key: string, html: () => string): void {
    if (key === this.screenKey) return;
    // the ticker belongs to the broadcast, not the frame: keep it running between pictures
    const sameShow = key.split(':').slice(0, 2).join(':') === this.screenKey.split(':').slice(0, 2).join(':');
    this.screenKey = key;
    const ticker = sameShow ? this.screen.querySelector('.tv-ticker') : null;
    this.screen.innerHTML = html();
    if (ticker) this.screen.querySelector('.tv-ticker')?.replaceWith(ticker);
  }

  private onScreen(f: Firm, b: Broadcast, frame: Frame): string {
    const ctx = this.sim.ctx;
    const ch = f.channel!;
    const brand = hsl(f.hue, 60, 40);
    const bug = `<div class="tv-bug" style="background:${brand}">${esc(ch.name)}</div>`;
    const live = b.kind === 'news' || b.kind === 'debate' || b.kind === 'speech' ? '<div class="tv-live">● LIVE</div>' : '';
    const ticker = `<div class="tv-ticker"><span>${esc(tickerText(this.sim, b))}</span></div>`;
    let stage: string;
    if (frame.k === 'ad') {
      const af = ctx.fById.get(frame.id), ap = ctx.byId.get(frame.id);
      const hue = af?.hue ?? ap?.looks.shirt ?? 0.5;
      const name = af ? af.name : ap ? `Vote ${ap.name.split(' ')[1] ?? ap.name}` : nameOf(ctx, frame.id);
      const slogan = af?.slogan ?? (ap ? this.sim.state.elections.flatMap((e) => e.candidates).find((c) => c.person === ap.id)?.slogan : '') ?? '';
      // the ad break is the advertiser's picture, not the channel's
      return `<div class="tv-set"><div class="tv-screen tv-ad" style="--ad:${hsl(hue, 62, 44)};--ad2:${hsl(hue + 0.08, 70, 28)}">
        <div class="tv-ad-tag">Advertisement</div><div class="tv-ad-name">${esc(name)}</div>${slogan ? `<div class="tv-ad-slogan">“${esc(slogan)}”</div>` : ''}
        ${af ? `<div class="tv-ad-what">${esc(adLine(af))}</div>` : ''}</div></div>`;
    }
    if (frame.k === 'title') {
      stage = `<div class="tv-card" style="--brand:${brand}"><div class="tv-card-show">${esc(b.show)}</div><div class="tv-card-title">${esc(b.title)}</div><div class="tv-card-time">${formatTime(b.t).split(', ')[1] ?? ''}</div></div>`;
    } else {
      const speaker = frame.who >= 0 ? ctx.byId.get(frame.who) : undefined;
      const name = frame.who < 0 ? 'Moderator' : speaker ? speaker.name : nameOf(ctx, frame.who);
      const role = !speaker ? '' : ctx.cById.get(speaker.job)?.role === 'presenter' ? `presenter, ${ch.name}` : roleOf(this.sim, speaker);
      stage = `<div class="tv-studio tv-${b.kind}" style="--brand:${brand}">
        ${speaker ? bust(speaker) : frame.who >= 0 && ctx.fById.has(frame.who) ? `<div class="tv-logo" style="background:${brand}">${esc(ch.name)}</div>` : bustPlain()}
        ${b.kind === 'news' ? '<div class="tv-desk"></div>' : b.kind === 'debate' ? '<div class="tv-podium"></div>' : ''}
        <div class="tv-lower"><div class="tv-who" style="background:${brand}">${esc(name)}${role ? `<span>${esc(role)}</span>` : ''}</div><div class="tv-text">${esc(frame.text)}</div></div></div>`;
    }
    return `<div class="tv-set"><div class="tv-screen">${stage}${bug}${live}${ticker}</div></div>`;
  }

  /** Color bars and when the next show is. */
  private offAir(f: Firm | undefined): string {
    const h = hourOf(this.sim.tick);
    const hours = Object.keys(SHOWS).map(Number).sort((a, b) => a - b);
    const next = hours.find((x) => x > h) ?? hours[0];
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].map((c) => `<i style="background:${c}"></i>`).join('');
    const msg = !f ? 'No station on the air' : `${esc(f.channel!.name)} · back at ${String(next).padStart(2, '0')}:00${f.channel!.onAir < 0 && SHOWS[h] ? ' (no presenter in the studio)' : ''}`;
    return `<div class="tv-set"><div class="tv-screen tv-off"><div class="tv-bars">${bars}</div><div class="tv-offmsg">${msg}</div></div></div>`;
  }

  /** Under the screen: who you're watching with, how many others are tuned in, and how they take it. */
  private watchingWith(p: Person, f: Firm, b: Broadcast | undefined, frame: Frame | undefined): string {
    const ctx = this.sim.ctx;
    const first = p.name.split(' ')[0];
    const st = p.task?.steps[p.task.i];
    const watching = st?.k === 'watch';
    let tuned = 0;
    for (const q of this.sim.state.people) if (q.pol.tv === f.id && q.task?.steps[q.task.i]?.k === 'watch') tuned++;
    const where = ctx.bById.get(p.inside)?.id === p.home ? 'on the sofa at home' : 'here';
    const line = !watching
      ? `${esc(first)} switched the TV off: ${esc(p.activity)}.`
      : `${esc(first)} ${reaction(p, b, frame)}.`;
    return `<div class="tv-with"><span class="tv-with-dot" style="background:${hsl(p.looks.shirt, 55, 50)}"></span>
      <div><div>Watching with <a data-select="person:${p.id}">${esc(p.name)}</a> ${watching ? where : ''} · ${tuned} ${tuned === 1 ? 'home' : 'homes'} tuned in now</div>
      <div class="nw-sub">${line}</div></div><button class="nw-link" data-unwatch>just watch</button></div>`;
  }

  private broadcast(b: Broadcast, live: boolean): string {
    const ctx = this.sim.ctx;
    const who = (id: number) => (id < 0 ? 'Moderator' : ctx.byId.has(id) ? `<a data-select="person:${id}">${esc(nameOf(ctx, id).split(' ')[0])}</a>` : esc(nameOf(ctx, id)));
    // the ad break: who paid for a spot (companies, and candidates during a campaign)
    const ads = b.ads.length ? `<div class="tv-break"><span class="nw-sub">Ad break</span>${[...new Set(b.ads)].map((id) => {
      const f = ctx.fById.get(id), p = ctx.byId.get(id);
      const hue = f?.hue ?? p?.looks.shirt ?? 0.5;
      return `<span class="tv-spot" style="background:${hsl(hue, 60, 42)}" data-select="${f ? 'firm' : 'person'}:${id}">${esc(f ? f.name : p ? `Vote ${p.name.split(' ')[1] ?? p.name}` : nameOf(ctx, id))}</span>`;
    }).join('')}</div>` : '';
    return `<div class="nw-card${live ? ' live' : ''}"><div class="nw-meta">${formatTime(b.t)} · ${esc(b.show)}${b.kind !== 'entertainment' ? ` · ${b.kind}` : ''}${b.viewers ? ` · ${b.viewers} watching` : ''}</div>
      <b>${esc(b.title)}</b>${(live ? b.lines : b.lines.slice(0, 3)).map((l) => `<div class="line"><b>${who(l.who)}:</b> ${esc(l.text)}</div>`).join('')}${ads}</div>`;
  }
}

/** The pictures of a broadcast in order: a title card, the lines, and an ad break after every three. */
function framesOf(b: Broadcast): Frame[] {
  const out: Frame[] = [{ k: 'title' }];
  const ads = [...new Set(b.ads)];
  let a = 0;
  b.lines.forEach((l, i) => {
    out.push({ k: 'line', who: l.who, text: l.text });
    if (ads.length && (i % 3 === 2 || i === b.lines.length - 1)) {
      for (let n = 0; n < Math.min(2, ads.length); n++) out.push({ k: 'ad', id: ads[a++ % ads.length] });
    }
  });
  return out;
}

/** Head and shoulders, as in the city: the same faceless figure, in their skin tone and shirt color. */
function bust(p: Person): string {
  const L = p.looks;
  const skin = SKIN[Math.max(0, Math.min(SKIN.length - 1, Math.round(L.skin)))];
  return `<div class="tv-bust"><i class="tv-shoulders" style="background:${hsl(L.shirt, 45, 40)}"></i><i class="tv-neck" style="background:${skin}"></i><i class="tv-head" style="background:${skin}"></i></div>`;
}

function bustPlain(): string {
  return `<div class="tv-bust"><i class="tv-shoulders" style="background:#3b3f46"></i><i class="tv-neck" style="background:#c9a68a"></i><i class="tv-head" style="background:#c9a68a"></i></div>`;
}

/** What a guest is introduced as: their office, their company, or their job. */
function roleOf(sim: Simulation, p: Person): string {
  const ctx = sim.ctx;
  for (const g of sim.state.polities) {
    const o = g.offices.find((x) => x.holder === p.id);
    if (o) return `${o.title ?? o.kind}, ${g.short}`;
  }
  const f = ctx.fById.get(p.firms[0] ?? -1);
  if (f) return `owner, ${f.name}`;
  return '';
}

/** The news ticker: headlines from the city's log and the numbers people talk about. */
function tickerText(sim: Simulation, b: Broadcast): string {
  const s = sim.state;
  const heads = s.log.filter((l) => l.t >= b.t - 12 * 60 && l.t <= b.t && ['politics', 'law', 'business', 'build'].includes(l.kind)).slice(-5).map((l) => l.text.replace(/\.$/, ''));
  const jobless = s.people.length ? (s.people.filter((p) => p.job < 0 && !p.firms.length).length / s.people.length) * 100 : 0;
  const parts = [...heads, `Population ${s.people.length.toLocaleString()}`, `Out of work ${jobless.toFixed(0)}%`];
  return parts.join('  ·  ');
}

/** What an ad says, from what the company sells. */
function adLine(f: Firm): string {
  const k = f.kind;
  if (k === 'store') return 'Groceries, clothes and more: open 8–21';
  if (k === 'restaurant') return 'Lunch and dinner, eat in or order online';
  if (k === 'dealer') return 'New cars, easy financing';
  if (k === 'bank') return 'Accounts, savings and loans';
  if (k === 'netco') return f.site ? `Visit ${f.site.name} today` : 'Online now';
  if (k === 'yard') return 'Homes and offices, built to last';
  if (k === 'depot') return 'Fast, reliable delivery across the city';
  if (k === 'adco') return 'Get your name on the street: billboards and screens';
  if (k === 'office') return 'Legal, accounting and design services';
  return 'Made right here in the city';
}

/** How someone takes what's on: agreement with the channel's line, interest in the show, patience with ads. */
function reaction(p: Person, b: Broadcast | undefined, frame: Frame | undefined): string {
  if (!b) return 'is flicking through the channels';
  if (frame?.k === 'ad') return p.traits.curiosity > 0.6 ? 'watches the ad' : 'checks their phone during the ads';
  if (b.kind === 'entertainment') return p.needs.fun < 50 ? 'is glued to the screen' : 'is half watching';
  const d = Math.abs(compass(p).econ - b.slant);
  if (d < 0.35) return 'nods along';
  if (d < 0.8) return 'listens, unconvinced';
  return p.traits.agreeable !== undefined && p.traits.agreeable < 0.4 ? 'argues with the TV' : 'shakes their head';
}
