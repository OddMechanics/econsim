// The HTML panels over the 3D view: the top bar, the dashboards on the left
// (overview, richest, companies, government, trade, talk, log) and the
// inspector on the right (a person, a building, a company), plus the Net and
// TV windows. Everything is plain DOM strings rebuilt a few times a second
// from the simulation state.

import { dayOf, dayStart, formatTime, minuteOfDay, nameOf } from '../sim/ctx';
import { MINUTES_PER_DAY, OUTSIDE } from '../sim/config';
import { BUILDINGS, comfortOf, GOOD, invWeight, RETAIL_GOODS, ROLE, slotsFor, TOWERS } from '../sim/goods';
import { deliveredFraction, hostedOf } from '../sim/buildings';
import { RENTALS } from '../sim/housing';
import { importPrice } from '../sim/market';
import { inputsOf } from '../sim/contacts';
import { pendingDeliveries } from '../sim/online';
import { howKnown, knownBy, knownOf } from '../sim/places';
import { FLOOR_H } from '../sim/layout';
import type { Simulation } from '../sim/sim';
import { firmValue, wealthOf } from '../sim/stats';
import { GOODS, type AdPlacement, type Building, type Firm, type Good, type Person, type PlaceKind } from '../sim/types';
import type { Selection, WorldRenderer } from '../render/renderer';
import { LineChart } from './charts';
import { CAT_LABEL, features, predict } from '../sim/brain';
import { Net } from './net';
import { TV } from './tv';
import { governmentHtml, personPoliticsHtml } from './politics';
import { ageOf } from '../sim/ideology';
import { mainPolity, referenceWage, treasury } from '../sim/government';
import { describeItem, highBid } from '../sim/estate';
import { count, goodLabel, hsl, today } from './netads';

export const SPEEDS: { label: string; mult: number; title: string }[] = [
  { label: '❚❚', mult: 0, title: 'Pause (space)' },
  { label: '1×', mult: 1, title: 'Real time: watch people walk' },
  { label: '10×', mult: 10, title: '10× real time' },
  { label: '60×', mult: 60, title: '1 game minute per second' },
  { label: '600×', mult: 600, title: '10 game minutes per second' },
  { label: '1h/s', mult: 3600, title: '1 game hour per second: the fastest with the 3D view on' },
  { label: 'Max', mult: Infinity, title: 'As fast as your computer can go: turns the 3D view off (any other speed turns it back on)' },
];

type Tab = 'overview' | 'richest' | 'companies' | 'gov' | 'trade' | 'talk' | 'log';

const CHART_GOODS: Good[] = ['groceries', 'planks', 'bricks', 'steel', 'concrete', 'glass'];
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];
const AD_KIND: Record<AdPlacement['kind'], string> = { poster: 'Poster', billboard: 'Billboard', flyer: 'Flyer', banner: 'Banner', screen: 'LED screen', column: 'Ad column' };
const CHANNELS: ['street' | 'net' | 'tv' | 'influencer', string][] = [['street', 'Street'], ['net', 'Online'], ['tv', 'TV'], ['influencer', 'Influencers']];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(v < 10 ? 1 : 0));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortTime = (t: number) => {
  const m = minuteOfDay(t);
  return `D${dayOf(t) + 1} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** A person's signature color: their shirt (the same formula as the renderer's clothing palette). */
export function personHex(p: Person): string {
  const h = ((p.looks.shirt % 1) + 1) % 1;
  const neon = Math.exp(-((h - 0.2) * (h - 0.2)) / 0.006);
  return `hsl(${(h * 360).toFixed(0)} ${((0.5 - 0.17 * neon) * 100).toFixed(0)}% ${((0.5 - 0.07 * neon) * 100).toFixed(0)}%)`;
}

export type ViewMode = 'full' | 'buildings' | 'none';

export interface UIHooks {
  setSpeed(mult: number): void;
  /** Run the simulation flat out (no 3D) until this tick. */
  skipTo(tick: number): void;
  /** How much of the 3D view to draw: everything, buildings only, or nothing (the sim runs alone). */
  setView(mode: ViewMode): void;
  save(): void;
  load(): void;
  newWorld(): void;
}

/** "today", "yesterday", "5 days ago" from a number of game minutes. */
function agoText(mins: number): string {
  const d = Math.floor(mins / MINUTES_PER_DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The tick a "skip to…" choice means, from now. */
function skipTarget(tick: number, what: string): number {
  const day = Math.floor(tick / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const next = (h: number) => { const t = day + h * 60; return t > tick + 1 ? t : t + MINUTES_PER_DAY; };
  switch (what) {
    case 'morning': return next(7);
    case 'noon': return next(12);
    case 'evening': return next(18);
    case 'midnight': return next(24);
    case 'day': return tick + MINUTES_PER_DAY;
    case 'week': return tick + 7 * MINUTES_PER_DAY;
    default: return tick + 30 * MINUTES_PER_DAY;
  }
}

export class UI {
  speed = 600;
  private prevSpeed = 600;
  private tab: Tab = 'overview';
  private left: HTMLDivElement;
  private right: HTMLDivElement;
  private body: HTMLDivElement;
  private clock: HTMLSpanElement;
  private saveStatus: HTMLSpanElement;
  private charts: LineChart[] = [];
  private chartsAt = -1;
  private lastRender = 0;
  private runBox!: HTMLDivElement;
  private runAt = 0;
  private runMode = '';
  private view: ViewMode = 'full';
  /** The 3D view to go back to when leaving "no 3D". */
  private view3d: ViewMode = 'full';
  private lastSaved = -1;
  private net: Net;
  private tv: TV;
  private polity = -1;
  /** The ad last clicked in the 3D view (its sponsor is selected; the inspector shows the ad too). */
  private pickedAd = -1;

  constructor(private sim: Simulation, private renderer: WorldRenderer, private hooks: UIHooks) {
    const top = document.createElement('div');
    top.id = 'topbar';
    top.innerHTML = `
      <span class="brand">Econsim</span>
      <span class="clock"></span>
      <div class="group speeds">${SPEEDS.map((s, i) => `<button data-speed="${i}" title="${s.title}">${s.label}</button>`).join('')}</div>
      <div class="menu-wrap"><button class="btn" data-act="skipmenu" title="Jump ahead: the simulation runs flat out without drawing the city">⏩ Skip</button>
        <div class="menu" data-menu="skip">
          <button data-skip="morning">to 7:00 (morning)</button><button data-skip="noon">to 12:00 (noon)</button>
          <button data-skip="evening">to 18:00 (evening)</button><button data-skip="midnight">to midnight</button>
          <button data-skip="day">1 day</button><button data-skip="week">1 week</button><button data-skip="month">30 days</button>
        </div></div>
      <div class="menu-wrap"><button class="btn" data-act="viewmenu" title="Draw less to run faster">View: 3D</button>
        <div class="menu" data-menu="view">
          <button data-view="full">Full 3D</button><button data-view="buildings">Buildings only (no people or cars)</button><button data-view="none">No 3D (the simulation runs alone)</button>
        </div></div>
      <button class="btn" data-act="ownership" title="Color land and buildings by owner">Ownership</button>
      <button class="btn" data-act="follow" title="Camera follows the selected person">Follow</button>
      <button class="btn" data-act="cinema" title="Movie camera: follows the selected person with changing shots (C)">🎬 Cinema</button>
      <button class="btn" data-act="map" title="Show city limits and electoral districts">Limits</button>
      <button class="btn" data-act="net" title="Browse the Net: websites and apps run by the city's internet companies">🌐 Net</button>
      <button class="btn" data-act="tv" title="Watch what's on TV">📺 TV</button>
      <span class="spacer"></span>
      <span class="muted small save-status"></span>
      <button class="btn" data-act="save" title="Download this world as a file">Save</button>
      <button class="btn" data-act="load" title="Open a saved world file">Load</button>
      <button class="btn" data-act="new" title="Start a fresh random world">New world</button>`;
    document.body.appendChild(top);
    this.clock = top.querySelector('.clock')!;
    this.saveStatus = top.querySelector('.save-status')!;
    top.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('button');
      if (!el) return;
      if (el.dataset.speed) this.setSpeed(SPEEDS[Number(el.dataset.speed)].mult);
      const act = el.dataset.act;
      // the Skip and View menus
      top.querySelectorAll('.menu').forEach((m) => { if (!(act === 'skipmenu' && (m as HTMLElement).dataset.menu === 'skip') && !(act === 'viewmenu' && (m as HTMLElement).dataset.menu === 'view')) m.classList.remove('open'); });
      if (act === 'skipmenu') { top.querySelector('[data-menu="skip"]')!.classList.toggle('open'); return; }
      if (act === 'viewmenu') { top.querySelector('[data-menu="view"]')!.classList.toggle('open'); return; }
      if (el.dataset.skip) { this.hooks.skipTo(skipTarget(this.sim.tick, el.dataset.skip)); return; }
      if (el.dataset.view) { this.setView(el.dataset.view as ViewMode); return; }
      if (act === 'ownership') {
        this.renderer.ownership = !this.renderer.ownership;
        this.renderer.refreshOwnership();
        el.classList.toggle('on', this.renderer.ownership);
      } else if (act === 'map') {
        this.renderer.politicsMap = !this.renderer.politicsMap;
        el.classList.toggle('on', this.renderer.politicsMap);
      } else if (act === 'cinema') {
        if (this.renderer.selection?.type !== 'person') {
          // cinema needs someone to follow: pick someone interesting nearby
          const busy = this.sim.state.people.find((p) => p.saying || p.pose === 'speech') ?? this.sim.state.people[Math.floor(Math.random() * this.sim.state.people.length)];
          if (busy) this.select({ type: 'person', id: busy.id });
        }
        this.renderer.cam.toggleCinema('user');
      } else if (act === 'follow') {
        this.renderer.follow = !this.renderer.follow;
      } else if (act === 'net') this.net.toggle();
      else if (act === 'tv') this.tv.toggle();
      else if (act === 'save') this.hooks.save();
      else if (act === 'load') this.hooks.load();
      else if (act === 'new') this.hooks.newWorld();
    });

    this.left = document.createElement('div');
    this.left.id = 'left';
    this.left.className = 'panel';
    this.left.innerHTML = `<div class="tabs">
        <button data-tab="overview" class="on">Overview</button>
        <button data-tab="richest">Richest</button>
        <button data-tab="companies">Companies</button>
        <button data-tab="gov">Gov</button>
        <button data-tab="trade" title="Wholesale trade, imports and exports, outside companies">Trade</button>
        <button data-tab="talk">Talk</button>
        <button data-tab="log">Log</button>
        <button class="collapse" title="Collapse">–</button>
      </div><div class="panel-body"></div>`;
    document.body.appendChild(this.left);
    this.body = this.left.querySelector('.panel-body')!;
    this.left.querySelector('.tabs')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.classList.contains('collapse')) {
        this.left.classList.toggle('collapsed');
        b.textContent = this.left.classList.contains('collapsed') ? '+' : '–';
        return;
      }
      this.showTab(b.dataset.tab as Tab);
    });
    this.body.addEventListener('click', (e) => {
      const watch = (e.target as HTMLElement).closest('[data-watch]') as HTMLElement | null;
      if (watch) {
        e.stopPropagation();
        this.select({ type: 'person', id: Number(watch.dataset.watch) });
        this.renderer.cam.setMode('cinema', 'user');
        return;
      }
      const chip = (e.target as HTMLElement).closest('[data-polity]') as HTMLElement | null;
      if (chip) { this.polity = Number(chip.dataset.polity); this.syncBorders(); this.renderTab(true); return; }
      const borders = (e.target as HTMLElement).closest('[data-borders]') as HTMLElement | null;
      if (borders) { this.zoomToBorders(Number(borders.dataset.borders)); return; }
      const site = (e.target as HTMLElement).closest('[data-site]') as HTMLElement | null;
      if (site) { this.openNet(site.dataset.site!); return; }
      this.handleSelectClick(e);
    });

    this.right = document.createElement('div');
    this.right.id = 'right';
    this.right.className = 'panel';
    document.body.appendChild(this.right);
    this.right.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { this.select(null); return; }
      if (t.closest('[data-follow]')) {
        this.renderer.follow = !this.renderer.follow;
        top.querySelector('[data-act="follow"]')!.classList.toggle('on', this.renderer.follow);
        this.renderInspector();
        return;
      }
      const site = t.closest('[data-site]') as HTMLElement | null;
      if (site) { this.openNet(site.dataset.site!); return; }
      const watch = t.closest('[data-watch]') as HTMLElement | null;
      if (watch) { this.tv.watchWith(Number(watch.dataset.watch)); return; }
      this.handleSelectClick(e);
    });

    this.net = new Net(sim, (kind, id) => this.selectAndFocus(kind, id), () => (this.renderer.selection?.type === 'person' ? this.renderer.selection.id : -1), () => this.renderer.selection);
    this.tv = new TV(sim, (kind, id) => this.selectAndFocus(kind, id));

    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.textContent = 'Arrows/WASD move · Shift faster · Q/E rotate · R/F zoom · C cinema · V street view · click a person, car, building or ad';
    document.body.appendChild(hint);
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
    this.runBox = document.createElement('div');
    this.runBox.id = 'runbox';
    document.body.appendChild(this.runBox);
    this.runBox.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.run === 'stop') this.hooks.skipTo(-1);
      if (b?.dataset.run === 'view') this.setView(this.view3d);
    });
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.menu-wrap')) top.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        this.setSpeed(this.speed === 0 ? this.prevSpeed || 600 : 0);
      }
    });

    renderer.onPick = (sel) => this.select(sel);
    renderer.onCameraMode = (mode) => {
      top.querySelector('[data-act="follow"]')!.classList.toggle('on', mode === 'follow');
      top.querySelector('[data-act="cinema"]')!.classList.toggle('on', mode === 'cinema');
      this.renderInspector();
    };
    this.hookAdPicks();
    this.buildCharts();
    this.setSpeed(this.speed);
    this.renderTab(true);
  }

  /**
   * Clicking an ad in the 3D view selects its sponsor (the renderer does
   * that); to also show the ad itself, look at the same click (after the
   * renderer's own handler) and remember which ad it hit.
   */
  private hookAdPicks(): void {
    type PickFn = (x: number, y: number, pred?: (m: { isPickable: boolean; isEnabled(): boolean; isVisible: boolean }) => boolean) => unknown;
    const r = this.renderer as unknown as {
      scene?: { onPointerObservable?: { add(fn: (info: { type: number; event: PointerEvent }) => void): void }; pick?: PickFn; pointerX: number; pointerY: number };
      ads?: { pickedId?: (pick: unknown) => number };
    };
    const scene = r.scene;
    if (!scene?.onPointerObservable || typeof scene.pick !== 'function') return;
    let dx = 0, dy = 0;
    scene.onPointerObservable.add((info) => {
      const e = info.event;
      if (info.type === 1) { dx = e.clientX; dy = e.clientY; return; } // pointer down
      if (info.type !== 2 || e.button !== 0 || Math.hypot(e.clientX - dx, e.clientY - dy) > 6) return; // a click
      const pickedId = r.ads?.pickedId;
      if (typeof pickedId !== 'function') return;
      try {
        const pick = scene.pick!(scene.pointerX, scene.pointerY, (m) => m.isPickable && m.isEnabled() && m.isVisible);
        const id = pickedId.call(r.ads, pick);
        this.pickedAd = typeof id === 'number' && id >= 0 ? id : -1;
      } catch {
        this.pickedAd = -1;
      }
      if (this.pickedAd >= 0) this.renderInspector();
    });
  }

  private openNet(page: string): void {
    if (!this.net.open) this.net.toggle();
    this.net.go(page);
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    this.left.querySelectorAll('.tabs button[data-tab]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.tab === tab));
    this.chartsAt = -1;
    this.renderTab(true);
  }

  setSpeed(mult: number): void {
    if (this.speed !== 0) this.prevSpeed = this.speed;
    this.speed = mult;
    this.hooks.setSpeed(mult);
    document.querySelectorAll('.speeds button').forEach((b) => {
      b.classList.toggle('on', SPEEDS[Number((b as HTMLElement).dataset.speed)].mult === mult);
    });
    // the 3D view tops out at 1 game hour per second; Max runs without it, flat out
    if (mult === Infinity && this.view !== 'none') this.setView('none');
    else if (mult > 0 && mult !== Infinity && this.view === 'none') this.setView(this.view3d);
  }

  /** Full 3D, buildings only, or no 3D at all (the simulation then runs as fast as it can). */
  setView(mode: ViewMode): void {
    this.view = mode;
    if (mode !== 'none') this.view3d = mode;
    this.hooks.setView(mode);
    document.querySelector('[data-act="viewmenu"]')!.textContent = `View: ${mode === 'full' ? '3D' : mode === 'buildings' ? 'buildings' : 'no 3D'}`;
    if (mode !== 'none' && this.speed === Infinity) this.setSpeed(3600);
    else if (mode === 'none' && this.speed > 0 && this.speed !== Infinity) this.setSpeed(Infinity);
  }

  setSim(sim: Simulation): void {
    this.sim = sim;
    this.net.setSim(sim);
    this.tv.setSim(sim);
    this.polity = -1;
    this.select(null);
    this.chartsAt = -1;
    this.renderTab(true);
  }

  /**
   * The box shown while the 3D view is off: skipping ahead (with progress and
   * a stop button) or the "no 3D" view. `rate` is game minutes per real second.
   */
  setRunOverlay(o: { skip?: { from: number; to: number }; noView: boolean; rate: number } | null): void {
    if (!o) { if (this.runMode) { this.runBox.style.display = 'none'; this.runMode = ''; } return; }
    // the box is built once per mode (so its button stays clickable); the numbers update every frame
    const mode = o.skip ? 'skip' : 'none';
    if (mode !== this.runMode) {
      this.runMode = mode;
      this.runBox.style.display = 'block';
      this.runBox.innerHTML = `<div class="runhead"></div>${o.skip ? '<div class="runbar"><i></i></div>' : ''}
        <div class="runnow"></div><div class="muted runstats"></div><div class="muted small runspeed"></div>
        ${o.skip ? '<button class="btn" data-run="stop">Stop here</button>' : '<button class="btn" data-run="view">Turn the 3D view back on</button>'}`;
    }
    const s = this.sim.state;
    const q = (sel: string) => this.runBox.querySelector(sel) as HTMLElement;
    q('.runhead').textContent = o.skip ? `Skipping ahead to ${formatTime(o.skip.to)}` : 'The 3D view is off: the simulation runs as fast as it can';
    if (o.skip) q('.runbar i').style.width = `${(Math.max(0, Math.min(1, (s.tick - o.skip.from) / Math.max(1, o.skip.to - o.skip.from))) * 100).toFixed(1)}%`;
    q('.runnow').textContent = formatTime(s.tick);
    const now = performance.now();
    if (now - this.runAt > 300) {
      this.runAt = now;
      q('.runstats').textContent = `${count(s.people.length)} people · ${count(s.contracts.length)} jobs · ${count(s.firms.filter((f) => !f.closed).length)} companies`;
      q('.runspeed').textContent = o.rate >= 1440 ? `${(o.rate / 1440).toFixed(1)} game days per second` : `${(o.rate / 60).toFixed(1)} game hours per second`;
    }
  }

  toast(text: string, ms = 4000): void {
    const t = document.getElementById('toast')!;
    t.textContent = text;
    t.style.display = 'block';
    clearTimeout((t as unknown as { _h: number })._h);
    (t as unknown as { _h: number })._h = window.setTimeout(() => (t.style.display = 'none'), ms);
  }

  markSaved(): void {
    this.lastSaved = performance.now();
  }

  select(sel: Selection): void {
    this.pickedAd = -1;
    this.renderer.selection = sel;
    this.renderInspector();
  }

  private selectAndFocus(kind: 'person' | 'building' | 'firm', id: number): void {
    const ctx = this.sim.ctx;
    this.select({ type: kind, id });
    if (kind === 'person') {
      const p = ctx.byId.get(id);
      if (p) this.renderer.focusOn(p.x, p.y, Math.min(this.renderer.camera.radius, 70));
    } else if (kind === 'building') {
      const b = ctx.bById.get(id);
      if (b) this.renderer.focusOn(b.x, b.y, Math.min(this.renderer.camera.radius, 90 + b.floors * FLOOR_H));
    } else {
      const f = ctx.fById.get(id);
      const b = f ? ctx.bById.get(f.sites[0]) : undefined;
      if (b) this.renderer.focusOn(b.x, b.y, Math.min(this.renderer.camera.radius, 160));
    }
  }

  private handleSelectClick(e: Event): void {
    const el = (e.target as HTMLElement).closest('[data-person],[data-building],[data-firm]') as HTMLElement | null;
    if (!el) return;
    if (el.dataset.person) this.selectAndFocus('person', Number(el.dataset.person));
    else if (el.dataset.building) this.selectAndFocus('building', Number(el.dataset.building));
    else if (el.dataset.firm) this.selectAndFocus('firm', Number(el.dataset.firm));
  }

  /**
   * Inspecting a government shows its borders on the map: the government on
   * the Gov tab, or the one whose city hall (or administration) is selected.
   */
  private syncBorders(): void {
    const ctx = this.sim.ctx;
    let id = -1;
    if (this.tab === 'gov') id = this.polity >= 0 ? this.polity : mainPolity(ctx)?.id ?? -1;
    const sel = this.renderer.selection;
    if (sel?.type === 'building') {
      const b = ctx.bById.get(sel.id);
      const g = b?.kind === 'cityhall' ? ctx.govOfFirm.get(b.owner) ?? ctx.govOfFirm.get(b.firm) : undefined;
      if (g) id = g.id;
    } else if (sel?.type === 'firm') {
      const g = ctx.govOfFirm.get(sel.id);
      if (g) id = g.id;
    }
    this.renderer.inspectedPolity = id;
  }

  /** Fly the camera out so a government's whole territory is in view. */
  private zoomToBorders(id: number): void {
    const g = this.sim.ctx.gById.get(id);
    if (!g || !g.cells.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of g.cells) {
      const x = (c % 40) * 50 + 25, y = Math.floor(c / 40) * 50 + 25;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    this.renderer.inspectedPolity = id;
    this.renderer.focusOn((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 1.1 + 150, true);
  }

  /** Called every frame; the DOM refreshes a few times per second. */
  update(): void {
    const now = performance.now();
    this.clock.textContent = formatTime(this.sim.tick);
    today.update(this.sim.state);
    if (now - this.lastRender < 300) return;
    this.lastRender = now;
    this.syncBorders();
    this.renderTab(false);
    this.renderInspector();
    this.net.update();
    this.tv.update();
    if (this.lastSaved > 0) {
      const s = Math.round((now - this.lastSaved) / 1000);
      this.saveStatus.textContent = s < 5 ? 'Autosaved just now' : `Autosaved ${s < 60 ? s + 's' : Math.round(s / 60) + 'm'} ago`;
    }
  }

  // ---------------------------------------------------------------- tabs

  private buildCharts(): void {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const col = (v: string) => { probe.style.color = v; return getComputedStyle(probe).color; };
    const fmtX = (t: number) => shortTime(t);
    const n0 = (v: number) => v.toFixed(0);
    this.charts = [
      new LineChart('People', [{ name: 'Population', color: col(SERIES[0]) }, { name: 'Employed', color: col(SERIES[1]) }, { name: 'Renting', color: col(SERIES[2]) }], n0, fmtX),
      new LineChart('Wholesale prices (average traded price)', CHART_GOODS.map((g, i) => ({ name: g, color: col(SERIES[i]) })), (v) => v.toFixed(v < 10 ? 1 : 0), fmtX, true),
      new LineChart('Average wage per shift and rent per day', [{ name: 'Wage', color: col(SERIES[0]) }, { name: 'Rent', color: col(SERIES[1]) }], (v) => v.toFixed(1), fmtX, true),
      new LineChart('Companies and buildings', [{ name: 'Companies', color: col(SERIES[0]) }, { name: 'Buildings', color: col(SERIES[1]) }, { name: 'Cars', color: col(SERIES[2]) }], n0, fmtX),
      new LineChart('Money in circulation', [{ name: 'Money', color: col(SERIES[2]) }], money, fmtX),
      new LineChart('Inequality (Gini: 0 equal … 1 one person has everything)', [{ name: 'Gini', color: col(SERIES[4]) }], (v) => v.toFixed(2), fmtX),
      new LineChart('Out of work, and trust in the government (%)', [{ name: 'Without a job', color: col(SERIES[1]) }, { name: 'Accept the government', color: col(SERIES[0]) }], (v) => v.toFixed(0), fmtX),
    ];
    probe.remove();
  }

  private overviewTiles(): string {
    const s = this.sim.state, ctx = this.sim.ctx;
    const last = s.stats[s.stats.length - 1];
    const g = mainPolity(ctx);
    const live = s.buildings.filter((b) => b.built && !b.ruined && b.host === undefined);
    const towers = live.filter((b) => TOWERS.includes(b.kind));
    const tallest = live.reduce<Building | undefined>((a, b) => (!a || b.floors > a.floors ? b : a), undefined);
    const jobless = s.people.filter((p) => p.job < 0 && !p.firms.length).length;
    const rented = s.ads.filter((a) => a.sponsor >= 0).length, vacant = s.ads.length - rented;
    const spend = (f: Firm) => Object.values(f.adSpend ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    const top = s.firms.filter((f) => !f.closed && spend(f) > 0).sort((a, b) => spend(b) - spend(a)).slice(0, 3);
    const tiles: [string, string, string?][] = [
      ['People', String(s.people.length)],
      ['Employed', String(s.contracts.length)],
      ['Companies', String(s.firms.filter((f) => !f.closed && f.gov === undefined).length)],
      ['Open jobs / out of work', `${s.postings.length} / ${pct(s.people.length ? jobless / s.people.length : 0)}`],
      [`Online orders ${today.label()}`, String(today.get(s, 'orders'))],
      ['Ads on the street / empty spaces', `${rented} / ${vacant}`],
      ['Renting / own home / homeless', `${last?.renters ?? 0} / ${s.people.filter((p) => p.owned.includes(p.home)).length} / ${s.people.filter((p) => p.home < 0).length}`],
      ['Towers', String(towers.length)],
      ['Tallest building', tallest ? `${tallest.floors} floors` : '—', tallest ? `${ctx.fById.get(tallest.firm)?.name ?? BUILDINGS[tallest.kind].label}${tallest.floors > 1 ? ` · ${Math.round(tallest.floors * FLOOR_H)} m` : ''}` : ''],
      ['Cars', String(s.vehicles.filter((v) => v.kind === 'car' && v.owner !== OUTSIDE.id && !ctx.fById.get(v.owner)?.site).length)],
      ['Deaths / arrivals', `${s.counters.deaths} / ${s.counters.arrivals}`],
      ...(g ? [['Treasury', money(treasury(ctx, g))] as [string, string], ['Government', g.label.replace(' democracy', '')] as [string, string], ['Next election', g.nextElection > 0 ? shortTime(g.nextElection) : 'none'] as [string, string]] : []),
    ];
    const adv = top.length ? `<div class="tile wide"><div class="l">Top advertisers (all channels, per day)</div><div class="adv">${top.map((f) => `<span class="link" data-firm="${f.id}"><i class="dot" style="background:${hsl(f.hue, 55, 50)}"></i>${esc(f.name)} <b>${spend(f).toFixed(1)}</b></span>`).join('')}</div></div>` : '';
    return `<div class="tiles">${tiles.map(([l, v, sub]) => `<div class="tile"${l === 'Tallest building' && tallest ? ` data-building="${tallest.id}" style="cursor:pointer"` : ''}><div class="v${v.length > 9 ? ' sm' : ''}">${v}</div><div class="l">${l}${sub ? `<br>${esc(sub)}` : ''}</div></div>`).join('')}${adv}</div>`;
  }

  private renderTab(force: boolean): void {
    const s = this.sim.state;
    if (this.tab === 'overview') {
      const tileHtml = this.overviewTiles();
      if (force || !this.body.querySelector('.tiles')) {
        this.body.innerHTML = tileHtml;
        for (const c of this.charts) this.body.appendChild(c.el);
        this.chartsAt = -1;
      } else this.body.querySelector('.tiles')!.outerHTML = tileHtml;
      if (this.chartsAt !== s.stats.length) {
        this.chartsAt = s.stats.length;
        const st = s.stats;
        const x = st.map((p) => p.t);
        this.charts[0].setData({ x, ys: [st.map((p) => p.pop), st.map((p) => p.employed), st.map((p) => p.renters)] });
        this.charts[1].setData({ x, ys: CHART_GOODS.map((g) => st.map((p) => p.prices[g] ?? 0)) });
        this.charts[2].setData({ x, ys: [st.map((p) => p.avgWage), st.map((p) => p.avgRent)] });
        this.charts[3].setData({ x, ys: [st.map((p) => p.firms), st.map((p) => p.buildings), st.map((p) => p.cars)] });
        this.charts[4].setData({ x, ys: [st.map((p) => p.money)] });
        this.charts[5].setData({ x, ys: [st.map((p) => p.gini)] });
        this.charts[6].setData({ x, ys: [st.map((p) => (p.jobless ?? 0) * 100), st.map((p) => (p.legit ?? 0) * 100)] });
      }
      return;
    }
    let html = '';
    if (this.tab === 'richest') html = this.richestHtml();
    else if (this.tab === 'companies') html = this.companiesHtml();
    else if (this.tab === 'trade') html = this.tradeHtml();
    else if (this.tab === 'gov') html = governmentHtml(this.sim.ctx, this.polity, (id) => this.personLink(id), (id) => `<span class="link" data-watch="${id}" title="Follow the speaker with the movie camera">🎬 watch</span>`);
    else if (this.tab === 'talk') html = this.talkHtml();
    else html = this.logHtml();
    const scroll = this.body.scrollTop;
    this.body.innerHTML = html;
    this.body.scrollTop = scroll;
  }

  private dot(p: Person): string {
    return `<span class="dot" style="background:${personHex(p)}"></span>`;
  }

  private personLink(id: number): string {
    const p = this.sim.ctx.byId.get(id);
    return p ? `<span class="link" data-person="${id}">${esc(p.name)}</span>` : esc(nameOf(this.sim.ctx, id));
  }

  private firmLink(id: number): string {
    const f = this.sim.ctx.fById.get(id);
    return f ? `<span class="link" data-firm="${id}">${esc(f.name)}</span>` : esc(nameOf(this.sim.ctx, id));
  }

  /** A link to whoever an id is (person, company, government), or plain text. */
  private anyLink(id: number): string {
    const ctx = this.sim.ctx;
    if (ctx.byId.has(id)) return this.personLink(id);
    if (ctx.govOfFirm.has(id)) return `<span class="link" data-site="gov:${ctx.govOfFirm.get(id)!.id}">${esc(nameOf(ctx, id))}</span>`;
    if (ctx.fById.has(id)) return this.firmLink(id);
    if (id === OUTSIDE.id) return 'an outside company';
    return esc(nameOf(ctx, id));
  }

  private bldLink(b: Building, text?: string): string {
    return `<span class="link" data-building="${b.id}">${esc(text ?? this.sim.ctx.fById.get(b.firm)?.name ?? BUILDINGS[b.kind].label)}</span>`;
  }

  private richestHtml(): string {
    const ctx = this.sim.ctx;
    const rows = this.sim.state.people.map((p) => ({ p, w: wealthOf(ctx, p) })).sort((a, b) => b.w - a.w).slice(0, 30);
    const max = Math.max(1, ...rows.map((r) => r.w));
    return `<h3>Richest people (net worth)</h3><div class="list">${rows.map((r, i) => {
      const firms = r.p.firms.map((id) => ctx.fById.get(id)?.name).filter(Boolean);
      const c = ctx.cById.get(r.p.job);
      const office = ctx.s.polities.flatMap((g) => g.offices.filter((o) => o.holder === r.p.id).map((o) => o.title.split(' (')[0]))[0];
      const towers = r.p.owned.filter((id) => TOWERS.includes(ctx.bById.get(id)?.kind ?? 'house')).length;
      const what = [firms.length ? `owns ${firms.join(', ')}` : c ? `${ROLE[c.role].label} at ${nameOf(ctx, c.firm)}` : r.p.home < 0 ? 'homeless, no job' : 'no job', towers ? `${towers} tower${towers > 1 ? 's' : ''}` : '', office].filter(Boolean).join(' · ');
      return `<div class="row" data-person="${r.p.id}"><span class="rank">${i + 1}</span>${this.dot(r.p)}
        <div class="main"><div class="name">${esc(r.p.name)}</div><div class="sub">${esc(what)}</div>
        <div class="bar"><span style="width:${(r.w / max) * 100}%"></span></div></div>
        <div class="num">${money(r.w)}<div class="sub">cash ${money(r.p.money)}</div></div></div>`;
    }).join('')}</div>`;
  }

  private companiesHtml(): string {
    const ctx = this.sim.ctx;
    const firms = this.sim.state.firms.filter((f) => !f.closed).map((f) => ({ f, v: firmValue(ctx, f), staff: ctx.s.contracts.filter((c) => c.firm === f.id).length }))
      .sort((a, b) => b.v - a.v);
    let land = 0;
    for (const l of this.sim.state.roads.lots) if (l.owner >= 0) land++;
    return `<h3>Companies by value</h3><p class="muted small">${firms.length} companies · ${land} of ${this.sim.state.roads.lots.length} lots owned. “Ownership” on the top bar colors lots by owner.</p>
      <div class="list">${firms.map(({ f, v, staff }) => {
        const last = f.ledger.days[f.ledger.days.length - 1] ?? 0;
        return `<div class="row" data-firm="${f.id}"><span class="dot" style="background:hsl(${Math.round(f.hue * 360)} 55% 50%)"></span>
          <div class="main"><div class="name">${esc(f.name)}${f.branch ? ' <span class="tag">chain</span>' : ''}${f.site ? ` <span class="tag">${esc(f.site.kind)}</span>` : ''}</div><div class="sub">${BUILDINGS[f.kind].label} · ${f.sites.length} site${f.sites.length === 1 ? '' : 's'} · ${staff} staff · ${esc(f.owner === OUTSIDE.id ? 'owned outside the city' : nameOf(ctx, f.owner))}</div></div>
          <div class="num">${money(v)}<div class="sub" style="color:${last >= 0 ? 'var(--good)' : 'var(--critical)'}">${last >= 0 ? '+' : ''}${money(last)}/day</div></div></div>`;
      }).join('')}</div>`;
  }

  /** The Trade tab: the wholesale market between companies and the rest of the world. */
  private tradeHtml(): string {
    const ctx = this.sim.ctx, s = this.sim.state;
    const m = s.market;
    const t0 = dayStart(s.tick);
    const todays = m.trades.filter((t) => t.t >= t0);
    const partial = m.trades.length > 0 && m.trades[0].t > t0;
    const imp = new Map<Good, number>(), exp = new Map<Good, number>(), loc = new Map<Good, number>();
    for (const t of todays) {
      const map = t.seller === OUTSIDE.id ? imp : t.buyer === OUTSIDE.id ? exp : loc;
      map.set(t.good, (map.get(t.good) ?? 0) + t.qty);
    }
    const localAsk = (g: Good) => {
      let best = Infinity, q = 0;
      for (const o of m.orders) if (o.side === 'ask' && o.good === g && o.who !== OUTSIDE.id && o.qty > 0) { best = Math.min(best, o.price); q += o.qty; }
      return { best, q };
    };
    const rows = GOODS.map((g) => {
      const last = m.last[g], ip = importPrice(ctx, g), la = localAsk(g);
      const cheaper = last > 0 && last < ip;
      return `<tr><td>${esc(GOOD[g].label)}</td><td class="r">${last ? `<span style="color:${cheaper ? 'var(--good)' : 'var(--text-primary)'}">${last.toFixed(2)}</span>` : '—'}</td><td class="r muted">${ip.toFixed(2)}</td>
        <td class="r">${la.best < Infinity ? `${la.best.toFixed(2)}<span class="muted small"> ×${Math.floor(la.q)}</span>` : '—'}</td>
        <td class="r">${Math.floor(loc.get(g) ?? 0) || ''}</td><td class="r" style="color:var(--series-2)">${Math.floor(imp.get(g) ?? 0) || ''}</td><td class="r" style="color:var(--series-3)">${Math.floor(exp.get(g) ?? 0) || ''}</td></tr>`;
    }).join('');
    const sum = (map: Map<Good, number>) => [...map.values()].reduce((a, b) => a + b, 0);
    const valueOf = (pred: (t: (typeof todays)[number]) => boolean) => todays.filter(pred).reduce((a, t) => a + t.qty * t.price, 0);
    // who sells most (from the trades the market remembers)
    const sellers = new Map<number, { v: number; goods: Map<Good, number> }>();
    const importers = new Map<number, number>();
    for (const t of m.trades) {
      if (t.seller === OUTSIDE.id) { importers.set(t.buyer, (importers.get(t.buyer) ?? 0) + t.qty * t.price); continue; }
      const e = sellers.get(t.seller) ?? { v: 0, goods: new Map() };
      e.v += t.qty * t.price;
      e.goods.set(t.good, (e.goods.get(t.good) ?? 0) + t.qty);
      sellers.set(t.seller, e);
    }
    const since = m.trades[0]?.t ?? s.tick;
    const topSellers = [...sellers].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
    const maxV = Math.max(1, ...topSellers.map(([, e]) => e.v));
    const suppliers = topSellers.map(([id, e]) => {
      const main = [...e.goods].sort((a, b) => b[1] - a[1])[0];
      return `<div class="row" data-firm="${id}"><div class="main"><div class="name">${esc(nameOf(ctx, id))}</div><div class="sub">mostly ${main ? `${Math.floor(main[1])} ${esc(goodLabel(main[0]))}` : '—'}</div><div class="bar"><span style="width:${(e.v / maxV) * 100}%"></span></div></div><div class="num">${money(e.v)}<div class="sub">sold</div></div></div>`;
    }).join('');
    const topImp = [...importers].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => `<span class="chip" data-firm="${id}">${esc(nameOf(ctx, id))} ${money(v)}</span>`).join('');
    // outside companies in the city
    const chains = s.firms.filter((f) => f.branch && !f.closed);
    const trucks = s.vehicles.filter((v) => v.owner === OUTSIDE.id && v.trip);
    const byBrand = new Map<string, typeof trucks>();
    for (const v of trucks) { const k = v.brand ?? 'Outside truck'; const a = byBrand.get(k) ?? []; a.push(v); byBrand.set(k, a); }
    const truckRows = trucks.slice(0, 10).map((v) => {
      const to = ctx.bById.get(v.trip!.to);
      const sh = s.shipments.find((x) => x.id === v.trip!.shipment);
      const cargo = GOODS.filter((g) => v.cargo[g] >= 0.5).map((g) => `${Math.floor(v.cargo[g])} ${goodLabel(g)}`).join(', ');
      const where = v.trip!.phase === 'out' ? 'leaving the city' : to ? `${v.trip!.phase === 'stop' ? 'at' : 'to'} ${esc(ctx.fById.get(to.firm)?.name ?? (sh?.recipient !== undefined ? `${nameOf(ctx, sh.recipient).split(' ')[0]}'s home` : BUILDINGS[to.kind].label))}` : '';
      return `<div class="log-row"><span class="dot" style="background:${hsl(v.hue, 60, 50)}"></span><b>${esc(v.brand ?? 'Outside')}</b> ${v.kind} · ${where}${cargo ? ` <span class="muted small">(${esc(cargo)})</span>` : sh?.recipient !== undefined ? ' <span class="muted small">(parcel)</span>' : ''}</div>`;
    }).join('');
    const ships = s.shipments;
    const waitingImports = ships.filter((x) => x.from < 0 && x.after !== undefined && x.after > s.tick).length;
    const auctions = s.auctions.slice(-12).map((a) => {
      const top = highBid(a);
      return `<div class="row"${a.item === 'building' ? ` data-building="${a.target}"` : a.item === 'firm' ? ` data-firm="${a.target}"` : ''}><div class="main"><div class="name">${esc(describeItem(ctx, a))}</div><div class="sub">${esc(a.reason)} · closes ${shortTime(a.closes)}</div></div><div class="num">${top ? top.amount : '—'}<div class="sub">reserve ${a.reserve}</div></div></div>`;
    }).join('');
    return `<h3>Wholesale market</h3><p class="muted small">There is no market place: companies sell to buyers they know (contacts, sales reps, ads, search) and order from outside suppliers, who deliver by truck from the highway. Today${partial ? ` (from ${shortTime(m.trades[0].t)})` : ''}: ${todays.length} trades,
      imports ${money(valueOf((t) => t.seller === OUTSIDE.id))}, exports ${money(valueOf((t) => t.buyer === OUTSIDE.id))}, local ${money(valueOf((t) => t.seller !== OUTSIDE.id && t.buyer !== OUTSIDE.id))}.</p>
      <table class="trade"><tr><th>Good</th><th class="r" title="Last trade (green: below the import price)">Last</th><th class="r" title="Delivered price from outside suppliers today">Import</th><th class="r" title="Cheapest local offer (and how much is on offer)">Local offer</th><th class="r" title="Units traded between local companies today">Local</th><th class="r" title="Units imported today">In</th><th class="r" title="Units exported today">Out</th></tr>${rows}
      <tr class="tot"><td>Units today</td><td></td><td></td><td></td><td class="r">${Math.floor(sum(loc))}</td><td class="r">${Math.floor(sum(imp))}</td><td class="r">${Math.floor(sum(exp))}</td></tr></table>
      <h3>Biggest local suppliers</h3><p class="muted small">Sales to other companies and outside buyers since ${shortTime(since)}.</p>${suppliers || '<p class="muted small">No local company has sold wholesale yet.</p>'}
      ${topImp ? `<h3>Biggest importers</h3><div>${topImp}</div>` : ''}
      <h3>Outside companies in the city</h3>
      <div class="kv"><span class="k">Chains</span><span>${chains.map((f) => `<span class="link" data-firm="${f.id}">${esc(f.name)}</span> <span class="muted small">${esc(BUILDINGS[f.kind].label.toLowerCase())}${f.sites.length > 1 ? ` ×${f.sites.length}` : ''}</span>`).join(' · ') || 'none'}</span>
        <span class="k">On the road</span><span>${trucks.length ? [...byBrand].map(([b, vs]) => `${esc(b)} ${vs.length}`).join(' · ') : 'no outside trucks right now'}</span>
        <span class="k">Waiting</span><span>${waitingImports} import${waitingImports === 1 ? '' : 's'} ship next morning · ${s.counters.imports ?? 0} truckloads in, ${s.counters.exports ?? 0} out since the start</span></div>
      ${truckRows}
      <h3>Deliveries in the city</h3><p class="small">${ships.filter((x) => x.status === 'open').length} waiting for a carrier, ${ships.filter((x) => x.status !== 'open').length} on the road (${ships.filter((x) => x.carrier === OUTSIDE.id).length} by outside companies, ${ships.filter((x) => ctx.fById.get(x.carrier)?.site).length} by gig couriers) · ${ships.filter((x) => x.recipient !== undefined).length} online orders on their way to people's homes.</p>
      <h3>Auctions (${s.auctions.length})</h3>${auctions || '<p class="muted small">Nothing for sale at auction.</p>'}`;
  }

  private talkHtml(): string {
    const ctx = this.sim.ctx;
    const convos = this.sim.state.conversations.slice(-40).reverse();
    return `<h3>Conversations around the city</h3><p class="muted small">Zoom in near people to see speech bubbles live.</p>${convos.map((c) => {
      const where = ctx.bById.get(c.where);
      const place = where ? `at ${ctx.fById.get(where.firm)?.name ?? BUILDINGS[where.kind].label.toLowerCase()}` : '';
      return `<div class="convo"><div class="convo-h">${this.personLink(c.a)} &amp; ${this.personLink(c.b)} <span class="muted small">${place} · ${shortTime(c.t)}</span></div>
        ${c.lines.map((l) => `<div class="line"><b>${esc(nameOf(ctx, l.who).split(' ')[0])}:</b> ${esc(l.text)}</div>`).join('')}</div>`;
    }).join('') || '<p class="muted small">Nobody has talked yet.</p>'}`;
  }

  private logHtml(): string {
    const ctx = this.sim.ctx;
    const items = this.sim.state.log.slice(-250).reverse();
    return `<h3>What happened</h3>${items.map((e) => {
      const target = e.who !== undefined && ctx.byId.has(e.who) ? ` data-person="${e.who}"` : e.firm !== undefined && ctx.fById.has(e.firm) ? ` data-firm="${e.firm}"` : e.bid !== undefined && ctx.bById.has(e.bid) ? ` data-building="${e.bid}"` : '';
      return `<div class="log-row${target ? ' click' : ''}"${target}><span class="t">${shortTime(e.t)}</span><span class="tag">${e.kind}</span>${esc(e.text)}</div>`;
    }).join('')}`;
  }

  // ------------------------------------------------------------ inspector

  private renderInspector(): void {
    const sel = this.renderer.selection;
    if (!sel) { if (this.right.innerHTML) this.right.innerHTML = ''; return; }
    const scroll = this.right.querySelector('.panel-body')?.scrollTop ?? 0;
    const html = sel.type === 'person' ? this.personHtml(sel.id) : sel.type === 'building' ? this.buildingHtml(sel.id) : this.firmHtml(sel.id);
    if (!html) { this.right.innerHTML = ''; return; }
    this.right.innerHTML = html;
    const body = this.right.querySelector('.panel-body');
    if (body) body.scrollTop = scroll;
  }

  private meter(label: string, v: number, color = 'var(--accent)'): string {
    return `<div class="meter"><span class="k">${label}</span><div class="bar"><span style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></span></div><span class="n">${v.toFixed(0)}</span></div>`;
  }

  /** The floor (1 = street level) a flat is on. */
  private flatFloor(b: Building, unit: number): number {
    const def = BUILDINGS[b.kind];
    return Math.floor(unit / Math.max(1, def.unitsPerFloor)) + 1 + (def.podium ? 1 : 0);
  }

  /** A vacant unit's asking rent, without changing the state. */
  private askingRent(u: Building): number {
    if (u.lease && u.lease.tenant < 0) return u.lease.rent;
    const ctx = this.sim.ctx;
    const host = ctx.bById.get(u.host ?? -1);
    const central = ctx.lotById.get(host?.lot ?? u.lot)?.zone === 'core' ? 1.3 : 1;
    const wage = referenceWage(ctx);
    return u.kind === 'shopfront' ? wage * 0.55 * central : wage * (0.8 + 0.01 * (u.level ?? 0)) * central;
  }

  /** What an ad space rents for per week (outdoor advertising companies' spaces; billboards rented from their owner). */
  private adRent(a: AdPlacement): number | null {
    const ctx = this.sim.ctx;
    const owner = ctx.fById.get(a.owner ?? -1);
    if (owner && BUILDINGS[owner.kind].service === 'ads') {
      const base = ({ billboard: 3.2, screen: 4.5, column: 1.2 } as Record<string, number>)[a.kind] ?? 2;
      const central = Math.max(0.5, 1.6 - Math.hypot(a.x - ctx.s.center.x, a.y - ctx.s.center.y) / 600);
      return base * central * ((owner.prices.rate ?? 3) / 3) * 7;
    }
    if (a.kind === 'billboard' && a.owner !== undefined) return 21;
    return null;
  }

  /** One ad, described: what it says, who paid, whose space it is, the rent. */
  private adRow(a: AdPlacement, clicked = false): string {
    const ctx = this.sim.ctx;
    const rent = this.adRent(a);
    const vacant = a.sponsor < 0;
    const owner = a.owner !== undefined ? this.anyLink(a.owner) : '';
    const slot = a.slots && a.slots > 1 ? ` · slot ${(a.slot ?? 0) + 1} of ${a.slots}` : '';
    return `<div class="adrow${clicked ? ' clicked' : ''}" style="--ad:${vacant ? '#6b6a63' : hsl(a.hue, 60, 46)}"><div class="adrow-face">${vacant ? 'Advertise here' : esc(a.headline || nameOf(ctx, a.sponsor))}<small>${vacant ? esc(nameOf(ctx, a.owner ?? -1)) : esc(a.tagline)}</small></div>
      <div class="adrow-info"><b>${AD_KIND[a.kind]}${slot}</b>${vacant ? ' · <span class="muted">vacant</span>' : ` · paid by ${this.anyLink(a.sponsor)}${a.topic === 'campaign' ? ' (campaign)' : ''}`}
      <div class="muted small">${owner ? `space owned by ${owner}` : a.kind === 'flyer' ? 'taped to a lamp post (free)' : 'on their own wall (free)'}${rent !== null ? ` · ${rent.toFixed(1)}/week` : ''}${!vacant && a.expires < 1e11 ? ` · until ${shortTime(a.expires)}` : ''}</div></div></div>`;
  }

  private clickedAdCard(match: (a: AdPlacement) => boolean): string {
    const a = this.sim.state.ads.find((x) => x.id === this.pickedAd);
    if (!a || !match(a)) return '';
    return `<h3>The ad you clicked</h3>${this.adRow(a, true)}`;
  }

  private personHtml(id: number): string {
    const ctx = this.sim.ctx;
    const p = ctx.byId.get(id);
    if (!p) return '';
    const s = this.sim.state;
    const home = ctx.bById.get(p.home);
    const c = ctx.cById.get(p.job);
    const needColor = (v: number) => (v < 25 ? 'var(--critical)' : v < 50 ? 'var(--warning)' : 'var(--good)');
    const carried = GOODS.filter((g) => p.inv[g] >= 0.5).map((g) => `${Math.floor(p.inv[g])} ${GOOD[g].label}`).join(', ') || 'nothing';
    const pantry = GOODS.filter((g) => p.pantry[g] >= 0.5).map((g) => `${Math.floor(p.pantry[g])} ${GOOD[g].label}`).join(', ') || 'empty';
    const owns = Object.entries(p.durables).filter(([, v]) => (v ?? 0) > 0).map(([g]) => (g === 'phone' ? 'a phone' : g === 'tv' ? 'a TV' : g === 'computers' ? 'a computer' : GOOD[g as Good].label)).join(', ');
    const d = p.decision;
    const opts = d ? d.options.map((o) => `<div class="opt${o.label === d.chosen ? ' chosen' : ''}"><span class="l">${esc(o.label)}</span><span class="s">${o.score.toFixed(2)}</span><span class="w">${esc(o.why)}</span></div>`).join('') : '';
    const t = p.traits;
    const traits: [string, number][] = [['Diligence', t.diligence], ['Ambition', t.ambition], ['Risk taking', t.risk], ['Sociability', t.sociability],
      ['Communication', t.communication], ['Patience', t.patience], ['Comfort love', t.comfortLove], ['Curiosity (openness)', t.curiosity], ['Agreeableness', t.agreeable ?? 0.5]];
    const beliefs = GOODS.map((g) => {
      const b = p.prices[g];
      return `<tr><td>${GOOD[g].label}</td><td class="r">${b.p.toFixed(2)}</td><td class="muted small">${b.t < 0 ? 'guess' : `${b.src}, ${Math.max(0, Math.round((s.tick - b.t) / 60))}h ago`}</td></tr>`;
    }).join('');
    const rels = Object.entries(p.rel).map(([oid, r]) => ({ o: ctx.byId.get(Number(oid)), r })).filter((x) => x.o).sort((a, b) => b.r.trust - a.r.trust).slice(0, 6)
      .map(({ o, r }) => `<div class="row" data-person="${o!.id}">${this.dot(o!)}<div class="main"><div class="name">${esc(o!.name)}</div><div class="sub">${r.fam.toFixed(1)}h together${r.bad ? ` · ${r.bad} grievance${r.bad > 1 ? 's' : ''}` : ''}</div></div><div class="num">${pct(r.trust)}<div class="sub">trust</div></div></div>`).join('');
    const said = p.said.slice().reverse().map((l) => `<div class="line">“${esc(l.text)}” <span class="muted small">${shortTime(l.t)}</span></div>`).join('');
    const posts = s.posts.filter((x) => x.who === p.id).slice(-3).reverse().map((x) => `<div class="line">${x.sponsor !== undefined ? '<span class="tag">#ad</span>' : ''}${esc(x.text)} <span class="muted small">${shortTime(x.t)} · ♥${x.likes}</span></div>`).join('');
    const flat = home && RENTALS.has(home.kind);
    const homeText = home
      ? `<span class="link" data-building="${home.id}">${flat ? `flat on floor ${this.flatFloor(home, p.unit)} of a ${home.floors}-floor ${BUILDINGS[home.kind].label.toLowerCase()}` : BUILDINGS[home.kind].label}</span>${flat ? ` · rent ${home.units[p.unit]?.rent.toFixed(1)}/day to ${esc(nameOf(ctx, home.owner))}` : home.owner === p.id ? ' · owns it' : ''} · comfort ${pct(comfortOf(home.kind, home.floors, home.condition))}`
      : '<span style="color:var(--critical)">homeless</span>';
    const jobText = c
      ? `${ROLE[c.role].label} at ${this.firmLink(c.firm)} · ${c.wage.toFixed(1)}/shift since ${shortTime(c.start)}${s.tick < c.probationEnd ? ' · on probation' : ''}${c.noticeEnd > 0 ? ` · <b>leaving ${shortTime(c.noticeEnd)}</b>` : ''}${c.unpaid ? ` · <span style="color:var(--critical)">${c.unpaid} unpaid shifts</span>` : ''}`
      : p.firms.length ? `runs ${p.firms.map((f) => this.firmLink(f)).join(', ')}` : 'no job';
    // the gig economy and the Net
    const app = p.gig ? ctx.fById.get(p.gig.app) : undefined;
    const step = p.task?.steps[p.task.i];
    const onGig = step?.k === 'gig';
    const gigText = p.gig && app?.site ? `${app.site.kind === 'rides' ? 'drives for' : 'delivers for'} <span class="link" data-site="site:${app.id}">${esc(app.site.name)}</span> · ${p.gig.jobs} job${p.gig.jobs === 1 ? '' : 's'} · earned ${p.gig.earned.toFixed(0)}${onGig ? ' · <b>working now</b>' : ''}` : '';
    const deals = [...new Set(s.posts.filter((x) => x.who === p.id && x.sponsor !== undefined).map((x) => x.sponsor!))];
    const followers = p.followers ?? 0;
    const fame = followers >= 1 ? `${count(followers)} followers${followers >= 25 ? ' · <b>influencer</b>' : ''}${deals.length ? ` · paid posts for ${deals.map((x) => this.anyLink(x)).join(', ')}` : ''}` : '';
    const parcels = pendingDeliveries(ctx, p);
    const property = p.owned.map((bid) => ctx.bById.get(bid)).filter((b): b is Building => !!b && b.host === undefined && b.id !== p.home);
    const sites = p.pol.sites.map((x) => ctx.fById.get(x)).filter((f): f is Firm => !!f?.site);
    return `<div class="insp-head">${this.dot(p)}<div class="title">${esc(p.name)}<div class="sub">${esc(p.activity)}${p.driving >= 0 ? ' 🚗' : ''}</div></div>
        <button class="btn${this.renderer.follow ? ' on' : ''}" data-follow>Follow</button><button class="btn" data-close title="Close">✕</button></div>
      <div class="panel-body">
        ${this.clickedAdCard((a) => a.sponsor === p.id)}
        <div class="why"><div class="doing">${esc(p.task?.label ?? 'Deciding what to do')}</div>${d ? `<div class="muted small" style="margin-top:2px">because: ${esc(d.why)}</div>` : ''}
          ${step?.k === 'watch' ? `<button class="btn watch-btn" data-watch="${p.id}">📺 Watch with them</button>` : ''}</div>
        ${p.saying ? `<div class="speech">“${esc(p.saying)}”</div>` : ''}
        <h3>Life</h3><div class="kv">
          <span class="k">Job</span><span>${jobText}</span>
          ${gigText ? `<span class="k">Gig work</span><span>${gigText}</span>` : ''}
          <span class="k">Home</span><span>${homeText}</span>
          ${property.length ? `<span class="k">Property</span><span>${property.slice(0, 6).map((b) => this.bldLink(b, `${b.floors > 2 ? `${b.floors}-floor ` : ''}${BUILDINGS[b.kind].label.toLowerCase()}`)).join(', ')}${property.length > 6 ? ` +${property.length - 6}` : ''}</span>` : ''}
          <span class="k">Who</span><span>${Math.floor(ageOf(ctx, p))} years old · ${p.edu} years of school · grew up in ${esc(p.origin)}</span>
          <span class="k">Happiness</span><span>${pct(p.happy)}</span>
          <span class="k">Cash</span><span>${p.money.toFixed(1)}</span>
          <span class="k">Net worth</span><span>${wealthOf(ctx, p).toFixed(0)}</span>
          <span class="k">Car</span><span>${p.car >= 0 ? 'yes' : 'no'}</span>
          <span class="k">Owns</span><span>${owns || 'nothing much'}</span>
          <span class="k">Online</span><span>${sites.length ? `${sites.map((f) => `<span class="link" data-site="site:${f.id}">${esc(f.site!.name)}</span>`).join(', ')} · <span class="link" data-site="person:${p.id}">profile</span>` : (p.durables.phone ?? 0) > 0 || (p.durables.computers ?? 0) > 0 ? 'online, no accounts yet' : 'offline'}${fame ? `<br>${fame}` : ''}</span>
          ${parcels.length ? `<span class="k">On the way</span><span>${parcels.map((sh) => `<div class="small">${this.net.deliveryLine(sh)}</div>`).join('')}</span>` : ''}
          <span class="k">Carrying</span><span>${carried} <span class="muted small">(${invWeight(p.inv).toFixed(0)}/30)</span></span>
          <span class="k">At home</span><span>${pantry}</span>
          <span class="k">Arrived</span><span>${shortTime(p.arrived)}</span>
        </div>
        <h3>Needs</h3>
        ${this.meter('Food', p.needs.food, needColor(p.needs.food))}${this.meter('Energy', p.needs.energy, needColor(p.needs.energy))}
        ${this.meter('Health', p.needs.health, needColor(p.needs.health))}${this.meter('Social', p.needs.social, needColor(p.needs.social))}
        ${this.meter('Fun', p.needs.fun, needColor(p.needs.fun))}${this.meter('Mood', p.mood * 100)}
        ${opts ? `<h3>What they considered (≈ satisfaction per hour)</h3>${opts}` : ''}
        ${this.brainHtml(p)}
        ${said ? `<h3>Recently said</h3>${said}` : ''}
        ${posts ? `<h3>Posted on the Net</h3>${posts}` : ''}
        ${this.brandsHtml(p)}
        ${this.placesHtml(p)}
        ${personPoliticsHtml(ctx, p, (oid) => this.personLink(oid))}
        <h3>Personality</h3>${traits.map(([l, v]) => `<div class="meter"><span class="k">${l}</span><div class="bar"><span style="width:${v * 100}%"></span></div><span class="n">${Math.round(v * 100)}</span></div>`).join('')}
        <h3>Skills (hours of experience)</h3><p class="small">${Object.entries(p.skills).filter(([, h]) => (h ?? 0) >= 1).map(([r, h]) => `${ROLE[r as keyof typeof ROLE].label} ${Math.round(h!)}`).join(' · ') || 'none yet'}</p>
        <h3>What they believe prices are</h3><table><tr><th>Good</th><th class="r">Price</th><th>Learned</th></tr>${beliefs}</table>
        <h3>People they trust most</h3>${rels || '<p class="muted small">Doesn\'t know anyone well yet.</p>'}
      </div>`;
  }

  /** The places a person knows of, by kind: how they know each, what they think of it, when they last went. */
  private placesHtml(p: Person): string {
    const ctx = this.sim.ctx;
    const s = this.sim.state;
    const groups: [PlaceKind, string][] = [['shop', 'Shops'], ['food', 'Places to eat'], ['car', 'Car dealers'], ['job', 'Places to work'], ['home', 'Buildings with flats'], ['out', 'Places to go out']];
    const rows = groups.map(([k, title]) => {
      const list = knownOf(ctx, p, k).sort((a, b) => (b.pl.seen ?? -1) - (a.pl.seen ?? -1) || b.pl.t - a.pl.t);
      if (!list.length) return '';
      return `<div class="pl-group">${title}</div>${list.map(({ b, pl }) => {
        const name = ctx.fById.get(b.firm)?.name ?? (b.kind === 'park' ? 'Park' : b.kind === 'plaza' ? 'Plaza' : BUILDINGS[b.kind].label);
        const op = pl.op ?? 0;
        const feel = op >= 0.3 ? '<span class="pl-op good">likes it</span>' : op <= -0.3 ? '<span class="pl-op bad">avoids it</span>' : '';
        const last = pl.seen !== undefined ? `went ${agoText(s.tick - pl.seen)}` : 'never been';
        return `<div class="pl-row" data-building="${b.id}"><span class="pl-name">${esc(name)}</span>${feel}<span class="pl-how">${esc(howKnown(ctx, p, pl))} · ${last}</span></div>`;
      }).join('')}`;
    }).join('');
    const n = (p.places ?? []).length;
    return rows ? `<h3>Places they know (${n})</h3>${rows}` : `<h3>Places they know</h3><p class="muted small">None yet: they're new here.</p>`;
  }

  /** How many people know a company's places, and how many went there in the last week. */
  private knownByHtml(sites: Building[]): string {
    const ctx = this.sim.ctx;
    let n = 0, regulars = 0;
    for (const b of sites) { const k = knownBy(ctx, b.id); n += k.n; regulars += k.regulars; }
    if (!sites.length) return '';
    return `<span class="k">Known by</span><span>${count(n)} ${n === 1 ? 'person' : 'people'}${regulars ? ` · ${count(regulars)} came in the last week` : ''}</span>`;
  }

  /** The brands a person has heard of (from ads, posts, shopping), strongest first. */
  private brandsHtml(p: Person): string {
    const ctx = this.sim.ctx;
    const brands = Object.entries(p.pol.aware).map(([id, v]) => ({ f: ctx.fById.get(+id), v })).filter((x) => x.f && !x.f.closed && x.v >= 0.05).sort((a, b) => b.v - a.v).slice(0, 6);
    if (!brands.length) return '';
    return `<h3>Brands they know (mostly from ads)</h3>${brands.map(({ f, v }) => `<div class="meter" data-firm="${f!.id}" style="cursor:pointer"><span class="k" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f!.name)}</span><div class="bar"><span style="width:${v * 100}%;background:${hsl(f!.hue, 55, 50)}"></span></div><span class="n">${Math.round(v * 100)}</span></div>`).join('')}`;
  }

  /** What their tiny neural network has learned: how much better than usual each kind of activity tends to be for them right now. */
  private brainHtml(p: Person): string {
    if (!p.brain) return '';
    const out = predict(p.brain, features(this.sim.ctx, p)).out;
    const rows = CAT_LABEL.map((l, i) => {
      const v = out[i];
      const w = Math.min(50, Math.abs(v) * 25);
      return `<div class="meter"><span class="k">${l}</span><div class="bar habit"><span style="margin-left:${v < 0 ? 50 - w : 50}%;width:${w}%;background:${v >= 0 ? 'var(--good)' : 'var(--critical)'}"></span></div><span class="n">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
    }).join('');
    return `<h3>Learned habits (their own neural network, ${p.brain.n} experiences)</h3>
      <p class="muted small">From their own life: whether each kind of activity tends to leave them better (green) or worse (red) off than usual in a moment like this. It nudges their choices.</p>${rows}`;
  }

  /** A tower: its floors, flats, shops on the ground floor and office floors (each a unit of its own). */
  private towerHtml(b: Building): string {
    const ctx = this.sim.ctx;
    const units = hostedOf(ctx, b);
    const shops = units.filter((u) => (u.level ?? 0) === 0);
    const floors = units.filter((u) => (u.level ?? 0) > 0).sort((a, c) => (c.level ?? 0) - (a.level ?? 0));
    const residents = this.sim.state.people.filter((p) => p.home === b.id).length;
    const let_ = b.units.filter((u) => u.tenant >= 0).length;
    const unitRow = (u: Building) => {
      const f = ctx.fById.get(u.firm);
      const rent = u.lease && u.lease.tenant >= 0 ? u.lease.rent : this.askingRent(u);
      return `<div class="row" data-building="${u.id}"><span class="dot" style="background:${f ? hsl(f.hue, 55, 50) : 'var(--grid)'}"></span><div class="main"><div class="name">${f ? esc(f.name) : u.kind === 'shopfront' ? 'Vacant shop' : 'Vacant office floor'}</div>
        <div class="sub">${(u.level ?? 0) ? `floor ${(u.level ?? 0) + 1}` : 'ground floor'} · ${f ? BUILDINGS[u.kind].label : `for lease${u.lease?.since ? `, empty ${Math.max(0, Math.floor((this.sim.state.tick - u.lease.since) / 1440))} days` : ''}`} · ${Math.round(u.w * u.d)} m²</div></div>
        <div class="num">${rent.toFixed(1)}<div class="sub">${f ? 'rent/day' : 'asking/day'}</div></div></div>`;
    };
    const tenants = new Map<number, number>();
    for (const u of floors) if (u.firm >= 0) tenants.set(u.firm, (tenants.get(u.firm) ?? 0) + 1);
    const stack = floors.length ? `<div class="floors">${floors.map((u) => {
      const f = ctx.fById.get(u.firm);
      return `<span class="flr${f ? '' : ' vac'}" data-building="${u.id}" style="${f ? `background:${hsl(f.hue, 50, 42)}` : ''}" title="Floor ${(u.level ?? 0) + 1}: ${f ? esc(f.name) : `vacant, ${this.askingRent(u).toFixed(1)}/day`}">${(u.level ?? 0) + 1}</span>`;
    }).join('')}</div>` : '';
    return `<h3>${b.kind === 'officetower' ? 'Office tower' : 'Residential tower'}</h3><div class="kv">
        <span class="k">Height</span><span>${b.floors} floors · about ${Math.round(b.floors * FLOOR_H)} m</span>
        ${b.units.length ? `<span class="k">Flats</span><span>${let_} of ${b.units.length} let (${BUILDINGS[b.kind].unitsPerFloor} a floor above the shops) · ${residents} residents${let_ < b.units.length ? ` · ${b.units.length - let_} for rent from ${Math.min(...b.units.filter((u) => u.tenant < 0).map((u) => u.rent)).toFixed(1)}/day` : ''}</span>` : ''}
        ${floors.length ? `<span class="k">Office floors</span><span>${floors.filter((u) => u.firm >= 0).length} of ${floors.length} leased${tenants.size ? ` to ${[...tenants].slice(0, 6).map(([id, n]) => `${this.firmLink(id)}${n > 1 ? ` (${n})` : ''}`).join(', ')}${tenants.size > 6 ? ` and ${tenants.size - 6} more companies` : ''}` : ''}</span>` : ''}
        <span class="k">Rent roll</span><span>${units.reduce((a, u) => a + (u.lease && u.lease.tenant >= 0 ? u.lease.rent : 0), 0).toFixed(0)}/day from businesses${b.units.length ? ` + ${b.units.reduce((a, u) => a + (u.tenant >= 0 ? u.rent : 0), 0).toFixed(0)}/day from flats` : ''}</span></div>
      ${shops.length ? `<h3>Shops on the ground floor</h3>${shops.map(unitRow).join('')}` : ''}
      ${floors.length ? `<h3>Floors (top to bottom)</h3>${stack}<div class="list">${floors.filter((u) => u.firm >= 0).slice(0, 12).map(unitRow).join('')}</div>${floors.some((u) => u.firm < 0) ? `<p class="muted small">${floors.filter((u) => u.firm < 0).length} floors for lease, from ${Math.min(...floors.filter((u) => u.firm < 0).map((u) => this.askingRent(u))).toFixed(1)}/day.</p>` : ''}` : ''}`;
  }

  private buildingHtml(id: number): string {
    const ctx = this.sim.ctx;
    const s = this.sim.state;
    const b = ctx.bById.get(id);
    if (!b) return '';
    const def = BUILDINGS[b.kind];
    const firm = ctx.fById.get(b.firm);
    const host = b.host !== undefined ? ctx.bById.get(b.host) : undefined;
    const stock = GOODS.filter((g) => b.store[g] >= 0.5).map((g) => `${Math.floor(b.store[g])} ${GOOD[g].label}`).join(', ') || 'empty';
    const needed = GOODS.filter((g) => b.needed[g] > 0).map((g) => `${Math.ceil(b.needed[g])} ${GOOD[g].label}`).join(', ');
    const staff = s.contracts.filter((c) => c.site === b.id);
    const inside = s.people.filter((p) => p.inside === b.id);
    const workers = staff.map((c) => {
      const w = ctx.byId.get(c.person);
      return w ? `<div class="row" data-person="${w.id}">${this.dot(w)}<div class="main"><div class="name">${esc(w.name)}</div><div class="sub">${ROLE[c.role].label} · ${esc(w.activity)}</div></div><div class="num">${c.wage.toFixed(1)}<div class="sub">per shift</div></div></div>` : '';
    }).join('');
    const flats = RENTALS.has(b.kind);
    const tenants = b.units.map((u, i) => {
      const t = ctx.byId.get(u.tenant);
      return t ? `<span class="chip" data-person="${t.id}" title="Floor ${flats ? this.flatFloor(b, i) : 1}">${flats ? `${this.flatFloor(b, i)}F ` : ''}${esc(t.name.split(' ')[0])}${flats ? ` (${u.rent.toFixed(1)})` : ''}</span>` : flats ? `<span class="chip muted">${this.flatFloor(b, i)}F vacant ${u.rent.toFixed(1)}</span>` : '';
    }).join('');
    const auction = s.auctions.find((a) => a.item === 'building' && a.target === b.id);
    const ownerText = this.anyLink(b.owner);
    const slots = slotsFor(b.kind, b.floors, b.w, b.d).map((x) => `${x.slots} ${ROLE[x.role].label}${x.slots > 1 ? 's' : ''}`).join(', ');
    const label = host && b.firm < 0 ? (b.kind === 'shopfront' ? 'Vacant shop' : 'Vacant office floor') : def.label;
    const title = `${firm ? esc(firm.name) : label}${b.floors > 1 ? ` <span class="muted small">${b.floors} floors</span>` : ''}`;
    // ads on the building (or right by it)
    const near = s.ads.filter((a) => a.building === b.id || (host && a.building === host.id && (a.kind === 'screen' || a.kind === 'banner')) || (a.building < 0 && a.kind === 'column' && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(b.w, b.d) / 2 + 12));
    const adList = near.slice(0, 10).map((a) => this.adRow(a, a.id === this.pickedAd)).join('');
    // a unit inside a tower and its lease
    const unitCard = host ? (() => {
      const l = b.lease;
      const lease = l && l.tenant >= 0
        ? `Leased to ${this.firmLink(l.tenant)} for <b>${l.rent.toFixed(1)}/day</b> since ${shortTime(l.since)}${l.arrears ? ` · <span style="color:var(--critical)">${l.arrears} days behind on rent</span>` : ''}`
        : `<b>For lease at ${this.askingRent(b).toFixed(1)}/day</b> (a week up front)${l?.since ? ` · empty since ${shortTime(l.since)}` : ''}`;
      return `<div class="card">${(b.level ?? 0) ? `Floor ${(b.level ?? 0) + 1}` : 'Ground floor'} of ${this.bldLink(host, `a ${host.floors}-floor ${BUILDINGS[host.kind].label.toLowerCase()}`)} · ${Math.round(b.w * b.d)} m² · landlord ${ownerText}<div style="margin-top:4px">${lease}</div></div>`;
    })() : '';
    const leaseCard = !host && b.lease && b.lease.tenant >= 0 ? `<div class="card">${this.firmLink(b.lease.tenant)} rents this building from ${ownerText} for <b>${b.lease.rent.toFixed(1)}/day</b>.</div>` : '';
    const trailer = b.kind === 'trailer' ? `<div class="card">A mobile home, bought ready-made from a dealer outside the city (new ones cost ${def.delivered}) and set on its lot. Cheap, but not much comfort: people move out when they can afford a flat or a house.</div>` : '';
    return `<div class="insp-head"><div class="title">${title}<div class="sub">${host ? `${label === def.label ? def.label : label} in ${esc(BUILDINGS[host.kind].label.toLowerCase())}` : def.label} · ${b.ruined ? 'ruined' : !b.built ? 'under construction' : `owned by ${ownerText}`}</div></div>
        <button class="btn" data-close title="Close">✕</button></div>
      <div class="panel-body">
        ${this.clickedAdCard((a) => a.building === b.id)}
        ${unitCard}${leaseCard}${trailer}
        ${!b.built && !b.ruined ? `<h3>Construction</h3>${this.meter('Work done', (b.workDone / b.workNeeded) * 100)}${this.meter('Materials', deliveredFraction(b) * 100)}
          <div class="kv"><span class="k">Still needs</span><span>${needed || 'all delivered'}</span>
          <span class="k">Built by</span><span>${b.builder >= 0 ? this.firmLink(b.builder) : b.builder === -2 ? '<b>waiting for a construction company to take the job</b>' : 'the owner themselves'}</span>
          <span class="k">For</span><span>${ownerText}</span>${TOWERS.includes(b.kind) ? `<span class="k">Height</span><span>${b.floors} floors (${Math.round(b.floors * FLOOR_H)} m)</span>` : ''}</div>` : ''}
        ${auction ? `<div class="card"><b>For sale at auction</b> (${esc(auction.reason)}): reserve ${auction.reserve}${highBid(auction) ? `, top bid ${highBid(auction)!.amount} by ${this.anyLink(highBid(auction)!.who)}` : ', no bids yet'} · closes ${shortTime(auction.closes)}</div>` : ''}
        ${!host ? (() => { const lot = ctx.lotById.get(b.lot); return lot ? `<p class="muted small">Lot ${lot.w.toFixed(0)}×${lot.d.toFixed(0)} m (${lot.zone})${lot.lastSale ? `, last sold for ${lot.lastSale.toFixed(0)}` : ''}${ctx.edgeById.get(lot.edge)?.name ? ` on ${esc(ctx.edgeById.get(lot.edge)!.name!)}` : ''}${ctx.edgeById.get(lot.edge)?.built === false ? ' (a dirt road)' : ''}.</p>` : ''; })() : ''}
        ${b.built && !host ? this.meter('Condition', b.condition * 100, b.condition < 0.3 ? 'var(--critical)' : 'var(--accent)') : ''}
        ${b.kind === 'cityhall' ? (() => { const g = ctx.govOfFirm.get(b.owner); return g ? `<p>Seat of ${esc(g.name)} · <span class="link" data-site="gov:${g.id}">website</span></p>` : ''; })() : ''}
        ${TOWERS.includes(b.kind) && b.built ? this.towerHtml(b) : ''}
        ${firm ? `<h3>Business</h3><div class="kv">
          <span class="k">Company</span><span>${this.firmLink(firm.id)} (${firm.sites.length} site${firm.sites.length === 1 ? '' : 's'})${firm.branch ? ' · <span class="tag">chain</span>' : ''}</span>
          <span class="k">Hours</span><span>${def.hours[0]}:00–${def.hours[1]}:00</span>
          <span class="k">Jobs</span><span>${staff.length} of ${slots || '0'}</span>
          ${def.service === 'retail' || def.output ? `<span class="k">In stock</span><span>${stock}</span>` : ''}
          ${def.service === 'retail' ? `<span class="k">Prices</span><span>${RETAIL_GOODS.filter((g) => firm.prices[g]).map((g) => `${goodLabel(g)} ${firm.prices[g]!.toFixed(2)}`).join(' · ')}</span>` : ''}
          ${def.service === 'meal' && firm.prices.meal ? `<span class="k">Meal</span><span>${firm.prices.meal.toFixed(2)}${s.firms.some((f) => f.site?.kind === 'delivery' && !f.closed) ? ' · also delivered by app' : ''}</span>` : ''}</div>
          <h3>Staff</h3>${workers || '<p class="muted small">No employees; the owner may work here.</p>'}` : ''}
        ${b.units.length && !TOWERS.includes(b.kind) ? `<h3>${flats ? `Flats (${b.units.filter((u) => u.tenant >= 0).length}/${b.units.length} rented)` : 'Who lives here'}</h3><div>${tenants || '<p class="muted small">Nobody.</p>'}</div>` : ''}
        ${b.units.length && TOWERS.includes(b.kind) ? `<h3>Residents</h3><div>${tenants.split('</span>').filter((x) => x.includes('data-person')).slice(0, 40).join('</span>')}${tenants.includes('data-person') ? '</span>' : '<p class="muted small">Nobody yet.</p>'}</div>` : ''}
        ${adList ? `<h3>Ads here</h3>${adList}` : ''}
        ${inside.length ? `<h3>Inside right now (${inside.length})</h3><div>${inside.slice(0, 30).map((p) => `<span class="chip" data-person="${p.id}">${esc(p.name.split(' ')[0])}: ${esc(p.activity)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  private firmHtml(id: number): string {
    const ctx = this.sim.ctx;
    const s = this.sim.state;
    const f: Firm | undefined = ctx.fById.get(id);
    if (!f) return '';
    const def = BUILDINGS[f.kind];
    const staff = s.contracts.filter((c) => c.firm === f.id);
    const sites = f.sites.map((sid) => ctx.bById.get(sid)).filter(Boolean) as Building[];
    const profits = f.ledger.days.slice(-10).map((v) => `<span class="chip" style="color:${v >= 0 ? 'var(--good)' : 'var(--critical)'}">${v >= 0 ? '+' : ''}${v.toFixed(0)}</span>`).join('');
    const prices = Object.entries(f.prices).filter(([k, v]) => v && (def.service === 'retail' ? RETAIL_GOODS.includes(k as Good) : true))
      .map(([k, v]) => `${k === 'computers' ? 'electronics' : k} ${k === 'freight' ? (v! * 1000).toFixed(1) + '/t·km' : k === 'build' ? '×' + v!.toFixed(2) : k === 'rate' ? `×${(v! / 3).toFixed(2)} (ad space rates)` : v!.toFixed(2)}`).join(' · ');
    const roles = new Map<string, number>();
    for (const c of staff) roles.set(c.role, (roles.get(c.role) ?? 0) + 1);
    // advertising
    const spend = f.adSpend ?? {};
    const total = CHANNELS.reduce((a, [k]) => a + (spend[k] ?? 0), 0);
    const maxCh = Math.max(0.01, ...CHANNELS.map(([k]) => spend[k] ?? 0));
    const street = s.ads.filter((a) => a.sponsor === f.id);
    const byKind = new Map<string, number>();
    for (const a of street) byKind.set(AD_KIND[a.kind], (byKind.get(AD_KIND[a.kind]) ?? 0) + 1);
    const paidPosts = s.posts.filter((p) => p.sponsor === f.id && s.tick - p.t < 3 * 1440);
    const influencers = [...new Set(paidPosts.filter((p) => ctx.byId.has(p.who)).map((p) => p.who))];
    const aware = s.people.length ? s.people.filter((p) => (p.pol.aware[f.id] ?? 0) >= 0.15).length / s.people.length : 0;
    const ads = (f.adBudget ?? 0) > 0 || total > 0 || street.length ? `<h3>Advertising</h3><div class="kv">
        <span class="k">Budget</span><span>${(f.adBudget ?? 0).toFixed(2)}/day${f.revenueAvg ? ` (${pct((f.adBudget ?? 0) / Math.max(0.01, f.revenueAvg))} of sales)` : ''} · spent ${total.toFixed(2)} yesterday</span></div>
      ${CHANNELS.map(([k, l]) => `<div class="meter"><span class="k">${l}</span><div class="bar"><span style="width:${((spend[k] ?? 0) / maxCh) * 100}%;background:var(--series-${k === 'street' ? 4 : k === 'net' ? 1 : k === 'tv' ? 2 : 5})"></span></div><span class="n" style="width:auto">${(spend[k] ?? 0).toFixed(1)}</span></div>`).join('')}
      <div class="kv" style="margin-top:4px"><span class="k">Running</span><span>${[...byKind].map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ') || 'no street ads'}${paidPosts.length ? ` · ${paidPosts.length} sponsored posts (3 days)` : ''}${influencers.length ? ` · paid ${influencers.map((x) => this.personLink(x)).join(', ')}` : ''}</span>
        <span class="k">Known by</span><span>${pct(aware)} of people</span></div>` : '';
    // who it trades with
    const contacts = (f.contacts ?? []).map((x) => ctx.fById.get(x)).filter((x): x is Firm => !!x && !x.closed);
    const ins = inputsOf(f);
    const out = def.output;
    const suppliers = contacts.filter((c) => BUILDINGS[c.kind].output && ins.includes(BUILDINGS[c.kind].output!));
    const customers = out ? contacts.filter((c) => inputsOf(c).includes(out)) : [];
    const contactHtml = contacts.length ? `<span class="k">Contacts</span><span>${contacts.length} companies known · ${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}${suppliers.length ? ` (${suppliers.slice(0, 4).map((x) => this.firmLink(x.id)).join(', ')})` : ''}${out ? ` · ${customers.length} possible customer${customers.length === 1 ? '' : 's'}` : ''}</span>` : `<span class="k">Contacts</span><span class="muted">knows no other company yet (buys from outside suppliers)</span>`;
    // locations it leases, and units it leases out
    const leased = sites.filter((b) => b.lease && b.lease.tenant === f.id);
    const landlordOf = s.buildings.filter((b) => b.owner === f.id && b.host !== undefined && b.lease && b.lease.tenant >= 0 && b.lease.tenant !== f.id);
    // an outdoor advertising company's spaces
    const spaces = s.ads.filter((a) => a.owner === f.id && def.service === 'ads');
    const rentedSpaces = spaces.filter((a) => a.sponsor >= 0);
    const adco = def.service === 'ads' ? `<h3>Ad spaces (${spaces.length})</h3><div class="kv"><span class="k">Rented</span><span>${rentedSpaces.length} of ${spaces.length} (${pct(spaces.length ? rentedSpaces.length / spaces.length : 0)}) · rates ×${((f.prices.rate ?? 3) / 3).toFixed(2)}</span>
        <span class="k">Income</span><span>about ${rentedSpaces.reduce((a, x) => a + (this.adRent(x) ?? 0), 0).toFixed(0)}/week from ${new Set(rentedSpaces.map((a) => a.sponsor)).size} advertisers</span></div>
      ${spaces.slice().sort((a, b) => b.sponsor - a.sponsor).slice(0, 8).map((a) => this.adRow(a, a.id === this.pickedAd)).join('')}${spaces.length > 8 ? `<p class="muted small">…and ${spaces.length - 8} more.</p>` : ''}` : '';
    const st = f.site;
    const siteHtml = st ? `<h3>${esc(st.name)} (${esc(st.domain)})</h3><div class="kv">
        <span class="k">Users</span><span>${st.users} accounts · ${st.active} visits yesterday · quality ${pct(st.quality)}</span>
        <span class="k">Ads</span><span>${st.kind === 'pay' || st.kind === 'crowd' ? 'none (lives on fees)' : `${(st.cpm ?? 0).toFixed(2)} per 1,000 views · ${count(st.impressions ?? 0)} views today · sold ${(st.adRevenue ?? 0).toFixed(1)} today`}</span>
        ${st.fee !== undefined ? `<span class="k">Fee</span><span>${st.fee < 1 ? `${(st.fee * 100).toFixed(st.fee < 0.05 ? 1 : 0)}%` : `${st.fee.toFixed(1)} per listing`} · ${(st.volume ?? 0).toFixed(0)} through the site today</span>` : ''}
        <span class="k">Open</span><span><span class="link" data-site="site:${f.id}">visit ${esc(st.name)}</span> · <span class="link" data-site="site:${f.id}/about">about</span></span></div>` : '';
    const ownerText = f.owner === OUTSIDE.id ? `${esc(f.branch ?? 'a company')} (outside the city)` : this.anyLink(f.owner);
    return `<div class="insp-head"><span class="dot" style="background:hsl(${Math.round(f.hue * 360)} 55% 50%)"></span><div class="title">${esc(f.name)}<div class="sub">${def.label}${/company$/i.test(def.label) ? '' : ' company'} · “${esc(f.slogan)}”</div></div>
        <button class="btn" data-close title="Close">✕</button></div>
      <div class="panel-body">
        ${this.clickedAdCard((a) => a.sponsor === f.id || a.owner === f.id)}
        ${f.branch ? `<div class="card">A local branch of <b>${esc(f.branch)}</b>, a chain from outside the city: it's run by a manager hired here, and its profits leave the city.</div>` : ''}
        <div class="kv">
          <span class="k">Owner</span><span>${ownerText}${f.manager !== undefined && ctx.byId.has(f.manager) ? ` · run by ${this.personLink(f.manager)}` : ''}${f.gov !== undefined && !ctx.govOfFirm.has(f.id) ? ' · <b>state-owned</b>' : ''}</span>
          ${f.channel ? `<span class="k">TV</span><span>${esc(f.channel.name)} · ${f.channel.viewers} viewers · ${f.channel.onAir >= 0 ? 'on the air' : 'off the air'}</span>` : ''}
          <span class="k">Founded</span><span>${shortTime(f.founded)}</span>
          <span class="k">Sales</span><span>${(f.revenueAvg ?? 0).toFixed(1)}/day on average · ${f.ledger.revenue.toFixed(0)} so far today</span>
          <span class="k">Cash</span><span>${f.cash.toFixed(0)}</span>
          <span class="k">Value</span><span>${firmValue(ctx, f).toFixed(0)}</span>
          <span class="k">Employees</span><span>${staff.length}${roles.size ? ` (${[...roles].map(([r, n]) => `${n} ${ROLE[r as keyof typeof ROLE].label}`).join(', ')})` : ''}</span>
          <span class="k">Prices</span><span>${prices || '—'}</span>
          ${this.knownByHtml(sites)}
          ${contactHtml}
          ${f.site ? '' : `<span class="k">Online</span><span>${f.website ? `<span class="link" data-site="firm:${f.id}">homepage</span>` : 'no website yet'}${def.service === 'retail' ? ` · ${(s.firms.some((x) => x.site?.kind === 'shop' && !x.closed) ? 'sells on the marketplace' : f.webshop || f.website ? 'own web shop' : 'no web shop')}` : ''}${(f.salesAvg.online ?? 0) > 0 ? ` · ${(f.salesAvg.online ?? 0).toFixed(1)} online orders/day` : ''}</span>`}
          ${leased.length ? `<span class="k">Leases</span><span>${leased.map((b) => { const t = ctx.bById.get(b.host ?? -1); return `${this.bldLink(b, t ? `${(b.level ?? 0) ? `floor ${(b.level ?? 0) + 1}` : 'shop'} of ${BUILDINGS[t.kind].label.toLowerCase()}` : BUILDINGS[b.kind].label)} ${b.lease!.rent.toFixed(1)}/day`; }).join(' · ')}</span>` : ''}
          ${landlordOf.length ? `<span class="k">Landlord</span><span>leases out ${landlordOf.length} unit${landlordOf.length === 1 ? '' : 's'} for ${landlordOf.reduce((a, b) => a + b.lease!.rent, 0).toFixed(0)}/day</span>` : ''}
        </div>
        ${siteHtml}
        ${ads}
        ${adco}
        <h3>Daily profit</h3><div>${profits || '<span class="muted small">no history yet</span>'}</div>
        <h3>Sites</h3>${sites.map((b) => { const t = ctx.bById.get(b.host ?? -1); return `<div class="row" data-building="${b.id}"><div class="main"><div class="name">${BUILDINGS[b.kind].label}${b.floors > 1 ? ` (${b.floors} floors)` : ''}${t ? ` · ${(b.level ?? 0) ? `floor ${(b.level ?? 0) + 1}` : 'ground floor'} of a ${t.floors}-floor tower` : ''}</div><div class="sub">${b.built ? `condition ${pct(b.condition)}` : `under construction ${Math.round((b.workDone / b.workNeeded) * 100)}%`}${b.lease && b.lease.tenant === f.id ? ` · leased, ${b.lease.rent.toFixed(1)}/day` : ''}</div></div></div>`; }).join('')}
        <h3>Staff</h3>${staff.map((c) => `<span class="chip" data-person="${c.person}">${esc(nameOf(ctx, c.person))} · ${ROLE[c.role].label}</span>`).join('') || '<p class="muted small">None yet.</p>'}
      </div>`;
  }
}
