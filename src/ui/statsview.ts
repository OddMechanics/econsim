// The statistics window: what's going on in the city, in numbers and charts.
//
// Sections: an overview (headline numbers with their trend, what changed
// this week, the main charts), the economy, every market, people, housing and
// land, companies, the government, and the Net and media. Most charts come
// from the daily snapshots (stats.ts recordDaily); a few show the city right
// now (open orders, the biggest companies, wealth spread). One time-range
// filter above everything scopes all the charts. Every chart has a line on how
// to read it, a hover readout, and a table view.

import { OUTSIDE } from '../sim/config';
import { nameOf } from '../sim/ctx';
import { GOOD, ROLE } from '../sim/goods';
import type { Simulation } from '../sim/sim';
import { firmValue, SECTORS, sectorOf, wealthOf } from '../sim/stats';
import { GOODS, type DailyStat, type Good, type Sector } from '../sim/types';
import { BarList, Columns, compact, DepthChart, DivergingBars, percent, RankedBars, type Series, sparkline, TimeChart, whole } from './statcharts';
import { adsParts, politicsParts } from './statspolitics';
import { morphHTML, morphNodes } from './morph';

type Section = 'overview' | 'economy' | 'markets' | 'people' | 'housing' | 'companies' | 'politics' | 'government' | 'ads' | 'net';
const SECTIONS: [Section, string][] = [
  ['overview', 'Overview'], ['economy', 'Economy'], ['markets', 'Markets'], ['people', 'People'],
  ['housing', 'Housing & land'], ['companies', 'Companies'], ['politics', 'Politics'], ['government', 'Government'], ['ads', 'Advertising'], ['net', 'Net & media'],
];
const RANGES: [number, string][] = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']];

/** Each sector keeps its color everywhere (in this order, which keeps neighbors distinguishable). */
export const SECTOR_LABEL: Record<Sector, string> = {
  retail: 'Shops & restaurants', manufacturing: 'Factories', office: 'Offices, finance & property', tech: 'Tech & media',
  construction: 'Construction', logistics: 'Logistics', raw: 'Farms, forests & mines', public: 'Government',
};
const slot = (i: number) => `var(--series-${(i % 8) + 1})`;
const SECTOR_COLOR = Object.fromEntries(SECTORS.map((s, i) => [s, slot(i)])) as Record<Sector, string>;
const OTHER = 'var(--text-muted)';

interface Part { el: HTMLElement; update: (days: DailyStat[], x: number[]) => void }

const goodName = (g: Good) => (g === 'computers' ? 'electronics' : GOOD[g].label.toLowerCase());
const sumKeys = (o: Record<string, number>, prefix: string) => Object.entries(o).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v, 0);

export class StatsView {
  el: HTMLDivElement;
  private content: HTMLDivElement;
  private section: Section = 'overview';
  private range = 0;
  private good: Good = 'groceries';
  private parts: Part[] = [];
  private lastFill = 0;

  constructor(private sim: Simulation, private onSelect: (kind: 'person' | 'firm' | 'building', id: number) => void) {
    this.el = document.createElement('div');
    this.el.id = 'statswin';
    this.el.style.display = 'none';
    this.el.innerHTML = `<div class="sv-head"><span class="sv-name">📊 Statistics</span><div class="sv-tabs">${SECTIONS.map(([k, l]) => `<button data-sec="${k}">${l}</button>`).join('')}</div><button class="btn" data-close title="Close">✕</button></div>
      <div class="sv-filters"><span class="muted small">Show</span><div class="group">${RANGES.map(([d, l]) => `<button data-range="${d}">${l}</button>`).join('')}</div><span class="sv-note muted small"></span></div>
      <div class="sv-content"></div>`;
    document.body.appendChild(this.el);
    this.content = this.el.querySelector('.sv-content')!;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { this.hide(); return; }
      const sec = t.closest('[data-sec]') as HTMLElement | null;
      if (sec) { this.show(sec.dataset.sec as Section); return; }
      const r = t.closest('[data-range]') as HTMLElement | null;
      if (r) { this.range = Number(r.dataset.range); this.fill(true); return; }
    });
  }

  setSim(sim: Simulation): void {
    this.sim = sim;
    if (this.el.style.display !== 'none') this.show(this.section);
  }

  toggle(): void {
    if (this.el.style.display === 'none') this.show(this.section); else this.hide();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Called every frame by the UI; redraws about once a second while open. */
  update(): void {
    if (this.el.style.display === 'none') return;
    // leave room for the inspector when something is selected
    const right = document.getElementById('right');
    this.el.style.right = right && right.childElementCount ? '376px' : '8px';
    if (performance.now() - this.lastFill > 1000) this.fill();
  }

  private show(section: Section): void {
    this.section = section;
    this.el.style.display = 'flex';
    this.el.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.sec === section));
    this.parts = this.build(section);
    this.content.replaceChildren(...this.parts.map((p) => p.el));
    this.content.scrollTop = 0;
    this.fill(true);
  }

  private fill(force = false): void {
    if (!force && performance.now() - this.lastFill < 1000) return;
    this.lastFill = performance.now();
    this.el.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.range) === this.range));
    const all = this.sim.state.daily ?? [];
    const days = this.range ? all.slice(-this.range) : all;
    const note = this.el.querySelector('.sv-note')!;
    note.textContent = all.length ? `${all.length} day${all.length === 1 ? '' : 's'} recorded · a point is added at the end of each game day` : 'No days recorded yet: the first point is added at midnight.';
    const x = days.map((d) => d.day);
    for (const p of this.parts) p.update(days, x);
  }

  // ------------------------------------------------------------ helpers

  /** A time chart part from series builders. */
  private chart(title: string, sub: string, series: (days: DailyStat[]) => Series[], opts: ConstructorParameters<typeof TimeChart>[2] = {}): Part {
    const c = new TimeChart(title, sub, opts);
    return { el: c.el, update: (days, x) => c.set(x, series(days)) };
  }

  private s(name: string, color: string, days: DailyStat[], f: (d: DailyStat) => number | null | undefined): Series {
    return { name, color, values: days.map((d) => { const v = f(d); return v === undefined || v === null || !Number.isFinite(v) ? null : v; }) };
  }

  /** Dynamic keys (e.g. tax kinds) keep the same color across the whole history: the 7 biggest, the rest as "Other". */
  private keyed(days: DailyStat[], pick: (d: DailyStat) => Record<string, number>): Series[] {
    const all = this.sim.state.daily ?? [];
    const totals = new Map<string, number>();
    for (const d of all) for (const [k, v] of Object.entries(pick(d) ?? {})) totals.set(k, (totals.get(k) ?? 0) + Math.abs(v));
    const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const top = keys.slice(0, 7);
    const out = top.map((k, i) => this.s(k, slot(i), days, (d) => pick(d)?.[k] ?? 0));
    if (keys.length > 7) out.push(this.s('Other', OTHER, days, (d) => Object.entries(pick(d) ?? {}).filter(([k]) => !top.includes(k)).reduce((a, [, v]) => a + v, 0)));
    return out;
  }

  private sectorSeries(days: DailyStat[], pick: (d: DailyStat) => Partial<Record<Sector, number>>): Series[] {
    return SECTORS.map((sec) => this.s(SECTOR_LABEL[sec], SECTOR_COLOR[sec], days, (d) => pick(d)?.[sec] ?? 0));
  }

  private live(el: HTMLElement, update: () => void): Part {
    return { el, update: () => update() };
  }

  // ------------------------------------------------------------ sections

  private build(section: Section): Part[] {
    switch (section) {
      case 'overview': return this.overview();
      case 'economy': return this.economy();
      case 'markets': return this.markets();
      case 'people': return this.people();
      case 'housing': return this.housing();
      case 'companies': return this.companies();
      case 'politics': return politicsParts(() => this.sim, this.helpers());
      case 'government': return this.government();
      case 'ads': return adsParts(() => this.sim, this.helpers());
      case 'net': return this.net();
    }
  }

  private helpers() {
    return {
      chart: (title: string, sub: string, series: (days: DailyStat[]) => Series[], opts?: Record<string, unknown>) => this.chart(title, sub, series, opts as ConstructorParameters<typeof TimeChart>[2]),
      s: (name: string, color: string, days: DailyStat[], f: (d: DailyStat) => number | null | undefined) => this.s(name, color, days, f),
      keyed: (days: DailyStat[], pick: (d: DailyStat) => Record<string, number>) => this.keyed(days, pick),
      onSelect: this.onSelect,
    };
  }

  private overview(): Part[] {
    const tiles = document.createElement('div');
    tiles.className = 'sv-tiles sv-wide';
    const insights = document.createElement('div');
    insights.className = 'sv-card sv-wide';
    insights.innerHTML = '<div class="sv-card-h"><div><div class="sv-title">What changed this week</div><div class="sv-sub">The biggest moves over the last 7 days, worked out from the daily numbers.</div></div></div><ul class="sv-insights"></ul>';
    const list = insights.querySelector('.sv-insights') as HTMLUListElement;
    return [
      { el: tiles, update: () => this.fillTiles(tiles) },
      { el: insights, update: () => this.fillInsights(list) },
      this.chart('People and jobs', 'Everyone living in the city and the countryside around it, how many have a job, and how many have neither a job nor a business.', (d) => [
        this.s('Population', slot(0), d, (x) => x.pop), this.s('Employed', slot(1), d, (x) => x.employed), this.s('Out of work', slot(2), d, (x) => x.jobless)]),
      this.chart('Health', 'People ill or injured at the end of each day, and of them those in a hospital bed.', (d) => [
        this.s('Ill or injured', slot(0), d, (x) => x.sick ?? 0), this.s('In hospital', slot(1), d, (x) => x.patients ?? 0)]),
      this.chart('City and countryside', 'Where people live: in the city, or out in the farm country and its villages (whose people live a simpler life).', (d) => [
        this.s('City', slot(0), d, (x) => x.pop - (x.rural ?? 0)), this.s('Countryside', slot(3), d, (x) => x.rural ?? 0)], { kind: 'stacked' }),
      this.chart('Where people\'s money goes each day', 'Spending in shops, at restaurants and on rent. Stacked: the top edge is the total.', (d) => this.spendSeries(d), { kind: 'stacked' }),
      this.chart('Wages against prices', 'Both start at 100. If the wage line is above the prices line, people can afford more than at the start.', (d) => {
        const w0 = d.find((x) => x.wage.median > 0)?.wage.median ?? 1, p0 = d.find((x) => x.cpi > 0)?.cpi ?? 1;
        return [this.s('Median wage', slot(0), d, (x) => (x.wage.median / w0) * 100), this.s('Prices', slot(1), d, (x) => (x.cpi / p0) * 100)];
      }, { free: true, fmt: (v) => v.toFixed(0) }),
      this.chart('Jobs by sector', 'Who employs the city. Stacked: the top edge is all jobs.', (d) => this.sectorSeries(d, (x) => x.jobs), { kind: 'stacked' }),
    ];
  }

  private spendSeries(d: DailyStat[]): Series[] {
    return [
      this.s('Food', slot(0), d, (x) => ['groceries', 'bread', 'produce', 'dairy', 'meat'].reduce((a, g) => a + (x.flows['spend:' + g] ?? 0), 0)),
      this.s('Eating out & delivery', slot(1), d, (x) => x.flows['spend:meal'] ?? 0),
      this.s('Rent', slot(2), d, (x) => x.flows['spend:rent'] ?? 0),
      this.s('Clothes, furniture & electronics', slot(3), d, (x) => (x.flows['spend:clothes'] ?? 0) + (x.flows['spend:furniture'] ?? 0) + (x.flows['spend:computers'] ?? 0) + (x.flows['spend:tools'] ?? 0)),
      this.s('Cars', slot(4), d, (x) => x.flows['spend:cars'] ?? 0),
    ];
  }

  private fillTiles(host: HTMLElement): void {
    const all = this.sim.state.daily ?? [];
    const now = all[all.length - 1];
    if (!now) { host.innerHTML = '<p class="muted small">The headline numbers appear after the first game day.</p>'; return; }
    const ago = all[Math.max(0, all.length - 8)];
    const last30 = all.slice(-30);
    const spend = (d: DailyStat) => sumKeys(d.flows, 'spend:') - (d.flows['spend:online'] ?? 0);
    const tile = (label: string, f: (d: DailyStat) => number, fmt: (v: number) => string, upIsGood: boolean | null) => {
      const v = f(now), v0 = f(ago);
      const delta = v - v0;
      const rel = Math.abs(v0) > 1e-9 ? delta / Math.abs(v0) : 0;
      const dir = Math.abs(rel) < 0.005 ? 0 : delta > 0 ? 1 : -1;
      const good = upIsGood === null || dir === 0 ? '' : (dir > 0) === upIsGood ? 'up-good' : 'up-bad';
      const arrow = dir > 0 ? '▲' : dir < 0 ? '▼' : '•';
      return `<div class="sv-tile"><div class="sv-tile-l">${label}</div><div class="sv-tile-v">${fmt(v)}</div><div class="sv-tile-d ${good}">${arrow} ${dir === 0 ? 'no change' : `${rel >= 0 ? '+' : ''}${(rel * 100).toFixed(Math.abs(rel) < 0.1 ? 1 : 0)}%`} <span class="muted">vs 7 days ago</span></div>${sparkline(last30.map(f))}</div>`;
    };
    morphHTML(host, [
      tile('Population', (d) => d.pop, whole, true),
      tile('Jobs', (d) => d.employed, whole, true),
      tile('Out of work', (d) => d.jobless / Math.max(1, d.pop), percent, false),
      tile('Median wage per shift', (d) => d.wage.median, compact, true),
      tile('Average rent per day', (d) => d.rent, compact, false),
      tile('Cost of a day\'s living', (d) => d.cpi, compact, false),
      tile('Spending per day', spend, compact, true),
      tile('Companies', (d) => Object.values(d.firms).reduce((a, n) => a + (n ?? 0), 0), whole, true),
      tile('Treasury', (d) => d.treasury, compact, true),
      tile('Homeless', (d) => d.homeless, whole, false),
    ].join(''));
  }

  /** Plain sentences about the biggest changes of the week. */
  private fillInsights(list: HTMLUListElement): void {
    const all = this.sim.state.daily ?? [];
    const now = all[all.length - 1];
    const items: string[] = [];
    if (!now || all.length < 2) { list.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Check back after a couple of game days.' })); return; }
    const ago = all[Math.max(0, all.length - 8)];
    const week = all.slice(-7);
    const sum = (f: (d: DailyStat) => number) => week.reduce((a, d) => a + f(d), 0);
    const pctTxt = (a: number, b: number) => `${b > 0 ? (((a - b) / b) * 100).toFixed(0) : '—'}%`;
    // people
    const arrived = sum((d) => d.arrivals), left = sum((d) => d.left), died = sum((d) => d.deaths);
    items.push(`${now.pop >= ago.pop ? '▲' : '▼'} The population went from ${whole(ago.pop)} to ${whole(now.pop)} (${pctTxt(now.pop, ago.pop)}): ${whole(arrived)} arrived, ${whole(left)} left${died ? `, ${died} died` : ''}.`);
    const u0 = ago.jobless / Math.max(1, ago.pop), u1 = now.jobless / Math.max(1, now.pop);
    if (Math.abs(u1 - u0) >= 0.01) items.push(`${u1 > u0 ? '▲' : '▼'} Unemployment ${u1 > u0 ? 'rose' : 'fell'} from ${percent(u0)} to ${percent(u1)}.`);
    else items.push(`• Unemployment held at about ${percent(u1)}.`);
    // prices and wages
    if (ago.cpi > 0) {
      const c = (now.cpi - ago.cpi) / ago.cpi, w = ago.wage.median > 0 ? (now.wage.median - ago.wage.median) / ago.wage.median : 0;
      items.push(`${c > 0 ? '▲' : c < 0 ? '▼' : '•'} The cost of a day's living changed ${c >= 0 ? '+' : ''}${(c * 100).toFixed(1)}%, the median wage ${w >= 0 ? '+' : ''}${(w * 100).toFixed(1)}%${w > c + 0.005 ? ': people can afford a bit more' : c > w + 0.005 ? ': people can afford a bit less' : ''}.`);
    }
    // markets: the biggest wholesale price moves
    const moves = GOODS.map((g) => ({ g, a: ago.markets[g]?.price ?? 0, b: now.markets[g]?.price ?? 0 })).filter((m) => m.a > 0 && m.b > 0).map((m) => ({ ...m, r: (m.b - m.a) / m.a })).sort((p, q) => Math.abs(q.r) - Math.abs(p.r)).slice(0, 2);
    for (const m of moves) if (Math.abs(m.r) >= 0.05) items.push(`${m.r > 0 ? '▲' : '▼'} Wholesale ${goodName(m.g)} got ${m.r > 0 ? 'dearer' : 'cheaper'}: ${compact(m.a)} → ${compact(m.b)} (${m.r > 0 ? '+' : ''}${(m.r * 100).toFixed(0)}%).`);
    // trade
    const exp = sum((d) => (d.flows.exports ?? 0) + (d.flows['svc:Soft'] ?? 0) + (d.flows['svc:Pro'] ?? 0)), imp = sum((d) => d.flows.imports ?? 0);
    if (exp + imp > 0) items.push(`${exp >= imp ? '▲' : '▼'} The city earned ${compact(exp / 7)} a day from the rest of the world (goods and office work) and spent ${compact(imp / 7)} a day on imports: ${exp >= imp ? 'more money is coming in than going out' : 'more money is leaving than coming in'}.`);
    // companies, housing, government
    const founded = sum((d) => d.flows.founded ?? 0), closed = sum((d) => d.flows.closed ?? 0);
    items.push(`${founded >= closed ? '▲' : '▼'} ${whole(founded)} companies opened and ${whole(closed)} closed.`);
    const vac = now.units ? now.vacantUnits / now.units : 0;
    items.push(vac < 0.03 ? `▲ Flats are scarce: only ${percent(vac)} stand empty${now.homeless ? `, and ${now.homeless} people are homeless` : ''}.` : `• ${percent(vac)} of flats stand empty; the average rent is ${compact(now.rent)} a day.`);
    if (now.building) items.push(`• ${now.building} buildings are going up; ${whole(sum((d) => d.flows.built ?? 0))} were finished this week.`);
    if (ago.treasury) items.push(`${now.treasury >= ago.treasury ? '▲' : '▼'} The treasury went from ${compact(ago.treasury)} to ${compact(now.treasury)}.`);
    morphNodes(list, items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  }

  private economy(): Part[] {
    return [
      this.chart('Spending per day, by kind', 'What people spend their money on. Stacked: the top edge is all spending.', (d) => this.spendSeries(d), { kind: 'stacked' }),
      this.chart('Money from and to the rest of the world', 'What the city sells elsewhere (goods, and office work billed to clients elsewhere) against what it buys from outside.', (d) => [
        this.s('Goods sold outside', slot(0), d, (x) => x.flows.exports ?? 0),
        this.s('Office work billed outside', slot(1), d, (x) => (x.flows['svc:Soft'] ?? 0) + (x.flows['svc:Pro'] ?? 0)),
        this.s('Bought from outside', slot(2), d, (x) => x.flows.imports ?? 0)]),
      this.chart('Wages paid per day', 'Everything employers paid their staff in the day.', (d) => [this.s('Wages', slot(0), d, (x) => x.flows.wages ?? 0)], { kind: 'area' }),
      this.chart('People\'s income per day, by source', 'What residents earned: wages, dividends from companies they own, gig work, day labor, and government payments (welfare and the resident dividend). Stacked: the top edge is all income.', (d) => [
        this.s('Wages', slot(0), d, (x) => x.flows.wages ?? 0),
        this.s('Dividends', slot(1), d, (x) => x.flows.dividends ?? 0),
        this.s('Gig work', slot(2), d, (x) => x.flows.gigpay ?? 0),
        this.s('Day labor', slot(3), d, (x) => x.flows.daylaborpay ?? 0),
        this.s('Government payments', slot(4), d, (x) => (x.flows['gsp:welfare'] ?? 0) + (x.flows['gsp:resident dividend'] ?? 0)),
      ], { kind: 'stacked' }),
      this.chart('Company sales by sector', 'Sales in each company\'s last business day, by sector. Stacked: the top edge is all sales.', (d) => this.sectorSeries(d, (x) => x.revenue), { kind: 'stacked' }),
      this.chart('Inflation', 'How much the cost of a day\'s living (food, things, rent) changed over the previous 30 days.', (d) => {
        const all = this.sim.state.daily ?? [];
        const idx = new Map(all.map((x, i) => [x.day, i]));
        return [this.s('30-day change', slot(1), d, (x) => { const i = idx.get(x.day) ?? 0; const b = all[Math.max(0, i - 30)]; return b && b.cpi > 0 && i >= 1 ? (x.cpi - b.cpi) / b.cpi : null; })];
      }, { fmt: percent, free: true }),
      this.chart('Money in circulation', 'All the money people, companies and buildings hold. Banks create money when they lend, so it can grow.', (d) => [this.s('Money', slot(2), d, (x) => x.money)], { kind: 'area' }),
      this.chart('Construction spending per day', 'What construction companies billed for the work they did.', (d) => [this.s('Construction', slot(4), d, (x) => x.flows.construction ?? 0)], { kind: 'area' }),
      this.chart('Rent paid per day', 'Flats (by tenants) and shops and offices (by the companies leasing them).', (d) => [
        this.s('Flats', slot(0), d, (x) => x.flows['spend:rent'] ?? 0), this.s('Shops & offices', slot(1), d, (x) => x.flows.leases ?? 0)], { kind: 'stacked' }),
    ];
  }

  private markets(): Part[] {
    // the table of every market, then the chosen market in detail
    const table = document.createElement('div');
    table.className = 'sv-card sv-wide';
    table.innerHTML = '<div class="sv-card-h"><div><div class="sv-title">All markets</div><div class="sv-sub">Wholesale trading between companies, with the rest of the world, and in the shops (yesterday). Click a row to see that market in detail below.</div></div></div><div class="sv-scroll"></div>';
    const host = table.querySelector('.sv-scroll') as HTMLDivElement;
    host.addEventListener('click', (e) => { const r = (e.target as HTMLElement).closest('[data-good]') as HTMLElement | null; if (r) { this.good = r.dataset.good as Good; this.fill(true); } });
    const title = document.createElement('div');
    title.className = 'sv-section sv-wide';
    const price = new TimeChart('Price', 'The average wholesale price companies paid each other, and the average shelf price in shops.', { free: true });
    const flows = new TimeChart('Quantities per day', 'Traded between local companies, bought from outside, and sold outside.');
    const depth = new DepthChart('Open orders right now', 'How much buyers want at each price or above (blue) and sellers offer at each price or below (orange). Where they cross, deals happen.');
    const sellers = new BarList('Biggest sellers (recent trades)', 'Who sold the most in the latest trades in this market.', whole);
    const buyers = new BarList('Biggest buyers (recent trades)', 'Who bought the most in the latest trades in this market.', whole, 'var(--series-2)');
    return [
      { el: table, update: (days) => this.fillMarketTable(host, days) },
      { el: title, update: () => { title.textContent = `Market for ${goodName(this.good)}`; } },
      { el: price.el, update: (days, x) => price.set(x, [this.s('Wholesale', slot(0), days, (d) => d.markets[this.good]?.price || null), this.s('In shops', slot(1), days, (d) => d.markets[this.good]?.retail ?? null)]) },
      { el: flows.el, update: (days, x) => flows.set(x, [this.s('Traded locally', slot(0), days, (d) => d.markets[this.good]?.q ?? 0), this.s('Bought from outside', slot(1), days, (d) => d.markets[this.good]?.imp ?? 0), this.s('Sold outside', slot(2), days, (d) => d.markets[this.good]?.exp ?? 0)]) },
      this.live(depth.el, () => {
        const o = this.sim.state.market.orders.filter((x) => x.good === this.good);
        depth.set(o.filter((x) => x.side === 'bid').map((x) => ({ price: x.price, qty: x.qty })), o.filter((x) => x.side === 'ask').map((x) => ({ price: x.price, qty: x.qty })));
      }),
      this.live(sellers.el, () => sellers.set(this.traders('seller'))),
      this.live(buyers.el, () => buyers.set(this.traders('buyer'))),
    ];
  }

  private traders(side: 'seller' | 'buyer'): { label: string; value: number; onClick?: () => void }[] {
    const ctx = this.sim.ctx;
    const by = new Map<number, number>();
    for (const t of this.sim.state.market.trades) if (t.good === this.good) by.set(t[side], (by.get(t[side]) ?? 0) + t.qty);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, q]) => ({
      label: id === OUTSIDE.id ? 'Outside companies' : nameOf(ctx, id), value: q,
      onClick: ctx.fById.has(id) ? () => this.onSelect('firm', id) : undefined,
    }));
  }

  private fillMarketTable(host: HTMLDivElement, days: DailyStat[]): void {
    const now = days[days.length - 1];
    const week = (this.sim.state.daily ?? []).slice(-8)[0];
    const t = document.createElement('table');
    t.className = 'sv-mtable';
    const head = ['Good', 'Price', '7 days', 'Trend', 'Traded/day', 'Imported', 'Exported', 'Wanted', 'Offered', 'Makers', 'In shops'];
    const tr = document.createElement('tr');
    head.forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i && i !== 3) th.className = 'r'; tr.appendChild(th); });
    t.appendChild(tr);
    for (const g of GOODS) {
      const m = now?.markets[g];
      const row = document.createElement('tr');
      row.className = 'sv-click' + (g === this.good ? ' on' : '');
      row.dataset.good = g;
      const p0 = week?.markets[g]?.price ?? 0, p1 = m?.price ?? 0;
      const ch = p0 > 0 && p1 > 0 ? (p1 - p0) / p0 : 0;
      const cells: (string | Node)[] = [goodName(g), p1 ? compact(p1) : '—', p0 && p1 ? `${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(0)}%` : '—', '', m ? whole(m.q) : '—', m ? whole(m.imp) : '—', m ? whole(m.exp) : '—', m ? whole(m.bids) : '—', m ? whole(m.asks) : '—', m ? String(m.makers) : '—', m?.retail ? compact(m.retail) : '—'];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        if (i && i !== 3) td.className = 'r';
        if (i === 3) td.innerHTML = sparkline(days.slice(-30).map((d) => d.markets[g]?.price ?? NaN), 70, 18);
        else td.textContent = String(c);
        row.appendChild(td);
      });
      t.appendChild(row);
    }
    morphNodes(host, [t]);
  }

  private people(): Part[] {
    const richest = new BarList('Richest people (now)', 'Net worth: cash, goods, property and companies, minus debts.', compact);
    const wagesBySector = new BarList('Median wage by sector (now)', 'The middle wage per shift in each sector (number of jobs in brackets).', compact, 'var(--series-2)');
    const roles = document.createElement('div');
    roles.className = 'sv-card';
    const fillRoles = () => {
      const s = this.sim.state;
      const by = new Map<string, { n: number; open: number; wages: number[] }>();
      for (const c of s.contracts) { const e = by.get(c.role) ?? { n: 0, open: 0, wages: [] }; e.n++; e.wages.push(c.wage); by.set(c.role, e); }
      for (const p of s.postings) { const e = by.get(p.role) ?? { n: 0, open: 0, wages: [] }; e.open += p.openings ?? 1; by.set(p.role, e); }
      const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([role, e]) => { e.wages.sort((a, b) => a - b); return `<tr><td>${ROLE[role as keyof typeof ROLE]?.label ?? role}</td><td class="r">${whole(e.n)}</td><td class="r">${whole(e.open)}</td><td class="r">${e.wages.length ? compact(e.wages[Math.floor(e.wages.length / 2)]) : '—'}</td></tr>`; });
      morphHTML(roles, `<div class="sv-card-h"><div><div class="sv-title">Jobs by role (now)</div><div class="sv-sub">People employed in each kind of job, open positions, and the middle wage per shift.</div></div></div><div class="sv-scroll"><table class="sv-mtable"><tr><th>Role</th><th class="r">Employed</th><th class="r">Open</th><th class="r">Median wage</th></tr>${rows.join('')}</table></div>`);
    };
    const wealthCols = new Columns('How wealth is spread (now)', 'People by net worth: cash, goods, property and companies, minus debts.');
    const lorenz = new TimeChart('Inequality curve (now)', 'Share of all wealth held by the poorest X% of people. The further the curve sags below the straight line, the more unequal.', { fmt: percent, fmtX: (i) => `poorest ${i * 5}%` });
    return [
      this.chart('Arrivals and departures per day', 'Newcomers, people who gave up and left, and deaths.', (d) => [
        this.s('Arrived', slot(0), d, (x) => x.arrivals), this.s('Left', slot(1), d, (x) => x.left), this.s('Died', slot(2), d, (x) => x.deaths)]),
      this.chart('Work', 'Everyone by what they do for a living. Stacked: the top edge is the population.', (d) => [
        this.s('Employed', slot(0), d, (x) => x.employed), this.s('Runs a business', slot(1), d, (x) => x.owners), this.s('Out of work', slot(2), d, (x) => x.jobless)], { kind: 'stacked' }),
      this.chart('Wages per shift', 'The low end (10% earn less), the middle (median), and the high end (10% earn more).', (d) => [
        this.s('Top 10% earn above', slot(0), d, (x) => x.wage.p90), this.s('Median', slot(1), d, (x) => x.wage.median), this.s('Bottom 10% earn below', slot(2), d, (x) => x.wage.p10)]),
      { el: wealthCols.el, update: () => {
        const d = this.sim.state.daily?.at(-1);
        const labels = ['under 10', '10–100', '100–1K', '1K–10K', '10K–100K', '100K+'];
        wealthCols.set(labels.map((label, i) => ({ label, value: d?.wealthBins[i] ?? 0 })));
      } },
      { el: lorenz.el, update: () => {
        const ctx = this.sim.ctx;
        const w = this.sim.state.people.map((p) => Math.max(0, wealthOf(ctx, p))).sort((a, b) => a - b);
        const total = w.reduce((a, v) => a + v, 0) || 1;
        const xs: number[] = [], curve: number[] = [], equal: number[] = [];
        let acc = 0, k = 0;
        for (let i = 0; i <= 20; i++) {
          const upto = Math.floor((i / 20) * w.length);
          while (k < upto) acc += w[k++];
          xs.push(i); curve.push(acc / total); equal.push(i / 20);
        }
        lorenz.set(xs, [{ name: 'Share of wealth', color: slot(0), values: curve }, { name: 'If everyone had the same', color: OTHER, values: equal }]);
      } },
      this.chart('Inequality over time', 'The Gini index (0 = everyone has the same, 1 = one person has everything) and the share of all wealth the richest 10% hold.', (d) => [
        this.s('Gini index', slot(0), d, (x) => x.wealthGini), this.s('Richest 10%\'s share', slot(1), d, (x) => x.top10)], { fmt: (v) => v.toFixed(2) }),
      this.chart('Needs', 'How well people\'s needs are met on average (100 = fully).', (d) => [
        this.s('Food', slot(0), d, (x) => x.needs.food), this.s('Energy', slot(1), d, (x) => x.needs.energy), this.s('Social', slot(2), d, (x) => x.needs.social),
        this.s('Fun', slot(3), d, (x) => x.needs.fun), this.s('Health', slot(4), d, (x) => x.needs.health)], { fmt: (v) => v.toFixed(0) }),
      this.chart('Mood and happiness', 'Mood (needs met today) and happiness (home, belongings, earning as much as others), averaged over everyone.', (d) => [
        this.s('Mood', slot(0), d, (x) => x.mood), this.s('Happiness', slot(1), d, (x) => x.happy)], { fmt: percent }),
      this.chart('Online and on wheels', 'Share of people with a phone or computer, and cars per person.', (d) => [
        this.s('Online', slot(0), d, (x) => x.online / Math.max(1, x.pop)), this.s('Cars per person', slot(1), d, (x) => x.cars / Math.max(1, x.pop))], { fmt: percent }),
      this.chart('Who owns the wealth', 'Shares of all wealth held by the poorer half, the next 40%, and the richest 10%. Stacked: together they make 100%.', (d) => [
        this.s('Poorer half', slot(0), d, (x) => x.wealthShares?.bottom50), this.s('Next 40%', slot(1), d, (x) => x.wealthShares?.middle40), this.s('Richest 10%', slot(2), d, (x) => x.wealthShares?.top10)], { kind: 'stacked', fmt: percent }),
      this.live(richest.el, () => {
        const ctx = this.sim.ctx;
        richest.set(this.sim.state.people.map((p) => ({ label: p.name, value: wealthOf(ctx, p), onClick: () => this.onSelect('person', p.id) })).sort((a, b) => b.value - a.value), 15);
      }),
      this.live(wagesBySector.el, () => {
        const ctx = this.sim.ctx;
        const by = new Map<Sector, number[]>();
        for (const c of this.sim.state.contracts) { const f = ctx.fById.get(c.firm); if (!f) continue; const sec = sectorOf(ctx, f); const a = by.get(sec) ?? []; a.push(c.wage); by.set(sec, a); }
        wagesBySector.set([...by.entries()].map(([sec, ws]) => { ws.sort((a, b) => a - b); return { label: `${SECTOR_LABEL[sec]} (${ws.length})`, value: ws[Math.floor(ws.length / 2)] }; }).sort((a, b) => b.value - a.value));
      }),
      { el: roles, update: () => fillRoles() },
    ];
  }

  private housing(): Part[] {
    return [
      this.chart('Where people live', 'Renting a flat, in a house of their own, in a trailer, or homeless. Stacked: the top edge is the population.', (d) => [
        this.s('Renting', slot(0), d, (x) => x.renters), this.s('Own house', slot(1), d, (x) => x.homeowners), this.s('Trailer', slot(2), d, (x) => x.trailers), this.s('Homeless', slot(7), d, (x) => x.homeless)], { kind: 'stacked' }),
      this.chart('Average rent per day', 'What people pay for the flats they live in.', (d) => [this.s('Rent', slot(0), d, (x) => x.rent)], { kind: 'area', free: true }),
      this.chart('Empty space', 'Share of flats, office floors and shops in towers that stand empty.', (d) => [
        this.s('Flats', slot(0), d, (x) => (x.units ? x.vacantUnits / x.units : null)), this.s('Office floors', slot(1), d, (x) => (x.suites ? x.vacantSuites / x.suites : null)), this.s('Shops', slot(2), d, (x) => (x.shops ? x.vacantShops / x.shops : null))], { fmt: percent }),
      this.chart('Land prices per m²', 'Average asking price of lots for sale in each part of the city.', (d) => [
        this.s('Downtown', slot(0), d, (x) => x.land.core ?? null), this.s('Inner city', slot(1), d, (x) => x.land.urban ?? null), this.s('Suburbs', slot(2), d, (x) => x.land.suburb ?? null), this.s('Industrial', slot(3), d, (x) => x.land.industrial ?? null)]),
      this.chart('Buildings going up', 'Building sites at the end of each day.', (d) => [this.s('Under construction', slot(4), d, (x) => x.building)], { kind: 'area' }),
      this.chart('Buildings finished per day', 'New buildings completed, and the floors they added.', (d) => [
        this.s('Buildings', slot(0), d, (x) => x.flows.built ?? 0), this.s('Floors', slot(1), d, (x) => x.flows.floors ?? 0)]),
      this.chart('Towers', 'Residential and office towers standing, and the tallest building\'s floors.', (d) => [
        this.s('Towers', slot(0), d, (x) => x.towers), this.s('Tallest (floors)', slot(1), d, (x) => x.tallest)]),
      this.chart('Flats', 'All flats in apartment blocks and towers, and how many stand empty.', (d) => [
        this.s('Flats', slot(0), d, (x) => x.units), this.s('Empty', slot(1), d, (x) => x.vacantUnits)]),
    ];
  }

  private companies(): Part[] {
    const table = document.createElement('div');
    table.className = 'sv-card sv-wide';
    table.innerHTML = '<div class="sv-card-h"><div><div class="sv-title">Biggest companies (now)</div><div class="sv-sub">Sorted by the column you click. Click a company to open it.</div></div></div><div class="sv-scroll"></div>';
    const host = table.querySelector('.sv-scroll') as HTMLDivElement;
    let sortBy = 3;
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const th = t.closest('[data-sort]') as HTMLElement | null;
      if (th) { sortBy = Number(th.dataset.sort); fillTable(); return; }
      const r = t.closest('[data-firm]') as HTMLElement | null;
      if (r) this.onSelect('firm', Number(r.dataset.firm));
    });
    const employers = new BarList('Biggest employers (now)', 'People on the payroll.', whole);
    const sectorProfit = new DivergingBars('Profits by sector (yesterday)', 'All companies\' profit or loss in their last business day, added up by sector.', 'loss', 'profit', compact, 'var(--div-pos)', 'var(--div-neg)');
    const ranked = new RankedBars('Profit or loss of every company (yesterday)', 'One thin bar per company, from the biggest loss to the biggest profit in its last business day. Hover to see which; click to open it.', compact, (id) => this.onSelect('firm', id));
    // every company's earnings: a full table with a sector filter and a search box
    const earnings = document.createElement('div');
    earnings.className = 'sv-card sv-wide';
    earnings.innerHTML = `<div class="sv-card-h"><div><div class="sv-title">Every company's earnings</div><div class="sv-sub">All companies with their sales and profit in the last business day, the profit trend over the last 30 days, and what they're worth. Sort by any column; filter by sector or name. Click a company to open it.</div></div></div>
      <div class="sv-filterrow"><input class="sv-search" placeholder="Search companies…"><div class="group sv-chips"><button data-sec="" class="on">All</button>${SECTORS.map((sec) => `<button data-sector="${sec}">${SECTOR_LABEL[sec]}</button>`).join('')}</div></div><div class="sv-scroll sv-tall"></div>`;
    const ehost = earnings.querySelector('.sv-tall') as HTMLDivElement;
    let esort = 5, esector = '', equery = '';
    ehost.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const th = t.closest('[data-sort]') as HTMLElement | null;
      if (th) { esort = Number(th.dataset.sort); fillEarnings(); return; }
      const r = t.closest('[data-firm]') as HTMLElement | null;
      if (r) this.onSelect('firm', Number(r.dataset.firm));
    });
    earnings.querySelector('.sv-search')!.addEventListener('input', (e) => { equery = (e.target as HTMLInputElement).value.toLowerCase(); fillEarnings(); });
    earnings.querySelector('.sv-chips')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      esector = b.dataset.sector ?? '';
      earnings.querySelectorAll('.sv-chips button').forEach((x) => x.classList.toggle('on', x === b));
      fillEarnings();
    });
    const fillEarnings = () => {
      const ctx = this.sim.ctx;
      const staff = new Map<number, number>();
      for (const c of this.sim.state.contracts) staff.set(c.firm, (staff.get(c.firm) ?? 0) + 1);
      const head = ['Company', 'Sector', 'Owner', 'Employees', 'Sales', 'Profit', '30-day trend', 'Profit, 30 days', 'Cash', 'Value'];
      const rows = this.sim.state.firms.filter((f) => !f.closed && !ctx.govOfFirm.has(f.id)).map((f) => {
        const sec = sectorOf(ctx, f);
        const hist = f.hist?.profit ?? f.ledger.days;
        const sum30 = hist.slice(-30).reduce((a, v) => a + v, 0);
        return { f, sec, hist, cells: [f.name, SECTOR_LABEL[sec], f.owner === OUTSIDE.id ? 'outside owners' : nameOf(ctx, f.owner), staff.get(f.id) ?? 0, f.lastRevenue ?? f.revenueAvg ?? 0, f.ledger.days[f.ledger.days.length - 1] ?? 0, 0, sum30, f.cash, firmValue(ctx, f)] as (string | number)[] };
      }).filter((r) => (!esector || r.sec === esector) && (!equery || r.f.name.toLowerCase().includes(equery)));
      rows.sort((a, b) => (typeof a.cells[esort] === 'string' ? String(a.cells[esort]).localeCompare(String(b.cells[esort])) : (b.cells[esort] as number) - (a.cells[esort] as number)));
      const t = document.createElement('table');
      t.className = 'sv-mtable';
      const tr = document.createElement('tr');
      head.forEach((h, i) => {
        const th = document.createElement('th');
        th.textContent = h + (i === esort ? ' ▾' : '');
        th.className = (i > 2 && i !== 6 ? 'r ' : '') + (i === 6 ? '' : 'sv-click');
        if (i !== 6) th.dataset.sort = String(i);
        tr.appendChild(th);
      });
      t.appendChild(tr);
      for (const r of rows) {
        const row = document.createElement('tr');
        row.className = 'sv-click';
        row.dataset.firm = String(r.f.id);
        r.cells.forEach((c, i) => {
          const td = document.createElement('td');
          if (i === 6) td.innerHTML = sparkline(r.hist.slice(-30), 80, 18);
          else td.textContent = typeof c === 'number' ? (i === 3 ? whole(c) : compact(c)) : c;
          if (i > 2 && i !== 6) td.className = 'r';
          if ((i === 5 || i === 7) && typeof c === 'number') td.classList.add(c < 0 ? 'neg' : 'pos');
          row.appendChild(td);
        });
        t.appendChild(row);
      }
      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = `${rows.length} companies`;
      morphNodes(ehost, [note, t]);
    };
    const conc = new BarList('How concentrated each sector is (now)', 'The biggest company\'s share of its sector\'s sales. Near 100%: one company dominates.', percent, 'var(--series-2)');
    const fillTable = () => {
      const ctx = this.sim.ctx;
      const staff = new Map<number, number>();
      for (const c of this.sim.state.contracts) staff.set(c.firm, (staff.get(c.firm) ?? 0) + 1);
      const rows = this.sim.state.firms.filter((f) => !f.closed && !ctx.govOfFirm.has(f.id)).map((f) => ({
        f, cells: [f.name, SECTOR_LABEL[sectorOf(ctx, f)], staff.get(f.id) ?? 0, f.revenueAvg ?? 0, f.ledger.days[f.ledger.days.length - 1] ?? 0, f.cash, firmValue(ctx, f)] as (string | number)[],
      }));
      rows.sort((a, b) => (typeof a.cells[sortBy] === 'string' ? String(a.cells[sortBy]).localeCompare(String(b.cells[sortBy])) : (b.cells[sortBy] as number) - (a.cells[sortBy] as number)));
      const t = document.createElement('table');
      t.className = 'sv-mtable';
      const tr = document.createElement('tr');
      ['Company', 'Sector', 'Employees', 'Sales/day', 'Last day\'s profit', 'Cash', 'Value'].forEach((h, i) => {
        const th = document.createElement('th');
        th.textContent = h + (i === sortBy ? ' ▾' : '');
        th.className = (i > 1 ? 'r ' : '') + 'sv-click';
        th.dataset.sort = String(i);
        tr.appendChild(th);
      });
      t.appendChild(tr);
      for (const r of rows.slice(0, 30)) {
        const row = document.createElement('tr');
        row.className = 'sv-click';
        row.dataset.firm = String(r.f.id);
        r.cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = typeof c === 'number' ? (i === 2 ? whole(c) : compact(c)) : c; if (i > 1) td.className = 'r'; row.appendChild(td); });
        t.appendChild(row);
      }
      morphNodes(host, [t]);
    };
    return [
      this.chart('Companies by sector', 'How many companies there are in each sector. Stacked: the top edge is all companies.', (d) => this.sectorSeries(d, (x) => x.firms), { kind: 'stacked' }),
      this.chart('Openings and closures per day', 'New companies started, and companies that closed down.', (d) => [
        this.s('Opened', slot(0), d, (x) => x.flows.founded ?? 0), this.s('Closed', slot(1), d, (x) => x.flows.closed ?? 0)]),
      this.chart('Companies making money', 'Share of companies that made a profit in their last business day.', (d) => [
        this.s('Profitable', slot(0), d, (x) => { const n = Object.values(x.firms).reduce((a, v) => a + (v ?? 0), 0); return n ? x.profitable / n : null; })], { fmt: percent, kind: 'area' }),
      this.chart('Hiring and leaving per day', 'People hired, laid off, and quitting.', (d) => [
        this.s('Hired', slot(0), d, (x) => x.flows.hires), this.s('Laid off', slot(1), d, (x) => x.flows.layoffs), this.s('Quit', slot(2), d, (x) => x.flows.quits)]),
      { el: table, update: () => fillTable() },
      this.live(employers.el, () => {
        const ctx = this.sim.ctx;
        const staff = new Map<number, number>();
        for (const c of this.sim.state.contracts) staff.set(c.firm, (staff.get(c.firm) ?? 0) + 1);
        employers.set([...staff.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ label: nameOf(ctx, id), value: n, onClick: () => this.onSelect('firm', id) })));
      }),
      this.live(conc.el, () => {
        const ctx = this.sim.ctx;
        const bySec = new Map<Sector, { total: number; top: number; name: string }>();
        for (const f of this.sim.state.firms) {
          if (f.closed || ctx.govOfFirm.has(f.id)) continue;
          const sec = sectorOf(ctx, f), v = f.revenueAvg ?? 0;
          const e = bySec.get(sec) ?? { total: 0, top: 0, name: '' };
          e.total += v;
          if (v > e.top) { e.top = v; e.name = f.name; }
          bySec.set(sec, e);
        }
        conc.set([...bySec.entries()].filter(([, e]) => e.total > 0).map(([sec, e]) => ({ label: SECTOR_LABEL[sec], value: e.top / e.total, note: e.name })).sort((a, b) => b.value - a.value));
      }),
      this.chart('All companies\' profits per day', 'Profit (or loss) of every company added up, in its last business day.', (d) => [
        this.s('Total profit', slot(0), d, (x) => (x.profit ? Object.values(x.profit).reduce((a, v) => a + (v ?? 0), 0) : null))], { free: true }),
      this.live(sectorProfit.el, () => {
        const d = this.sim.state.daily?.at(-1);
        sectorProfit.set(SECTORS.filter((sec) => d?.profit?.[sec] !== undefined).map((sec) => ({ label: SECTOR_LABEL[sec], value: d!.profit![sec] ?? 0 })).sort((a, b) => b.value - a.value));
      }),
      this.live(ranked.el, () => {
        const ctx = this.sim.ctx;
        ranked.set(this.sim.state.firms.filter((f) => !f.closed && !ctx.govOfFirm.has(f.id)).map((f) => ({ label: f.name, value: f.ledger.days[f.ledger.days.length - 1] ?? 0, id: f.id })));
      }),
      { el: earnings, update: () => fillEarnings() },
    ];
  }

  private government(): Part[] {
    return [
      this.chart('Treasury', 'The government\'s money at the end of each day.', (d) => [this.s('Treasury', slot(0), d, (x) => x.treasury)], { kind: 'area' }),
      this.chart('Acceptance', 'How far residents accept the government\'s authority (100% = everyone).', (d) => [this.s('Acceptance', slot(1), d, (x) => x.legit)], { fmt: percent, kind: 'area' }),
      this.chart('Income by kind', 'Taxes, fees and other income each day. Stacked: the top edge is all income.', (d) => this.keyed(d, (x) => x.income), { kind: 'stacked' }),
      this.chart('Spending by kind', 'Wages, welfare, building and other spending each day. Stacked: the top edge is all spending.', (d) => this.keyed(d, (x) => x.spend), { kind: 'stacked' }),
    ];
  }

  private net(): Part[] {
    const sites = new BarList('Biggest websites (now)', 'Accounts on each of the city\'s sites.', whole);
    const tv = new BarList('TV channels (now)', 'People who watched yesterday.', whole, 'var(--series-2)');
    return [
      this.chart('The Net in daily life', 'Online orders, gig deliveries and app rides per day.', (d) => [
        this.s('Online orders', slot(0), d, (x) => x.flows.orders), this.s('Gig deliveries', slot(1), d, (x) => x.flows.gigs), this.s('Rides', slot(2), d, (x) => x.flows.rides)]),
      this.chart('Advertising per day', 'What companies spend on ads, by channel. Stacked: the top edge is all ad spending.', (d) => [
        this.s('Street', slot(0), d, (x) => x.adSpend.street), this.s('Online', slot(1), d, (x) => x.adSpend.net), this.s('TV', slot(2), d, (x) => x.adSpend.tv), this.s('Influencers', slot(3), d, (x) => x.adSpend.influencer)], { kind: 'stacked' }),
      this.chart('Online shopping per day', 'Money spent online (groceries, things and meals).', (d) => [this.s('Online spending', slot(0), d, (x) => x.flows['spend:online'] ?? 0)], { kind: 'area' }),
      this.chart('Audiences', 'Accounts on all sites, and TV viewers yesterday.', (d) => [this.s('Site accounts', slot(0), d, (x) => x.siteUsers), this.s('TV viewers', slot(1), d, (x) => x.tvViewers)]),
      this.live(sites.el, () => sites.set(this.sim.state.firms.filter((f) => f.site && !f.closed).map((f) => ({ label: f.site!.name, value: f.site!.users, onClick: () => this.onSelect('firm', f.id) })).sort((a, b) => b.value - a.value))),
      this.live(tv.el, () => tv.set(this.sim.state.firms.filter((f) => f.channel && !f.closed).map((f) => ({ label: f.channel!.name, value: f.channel!.viewers, onClick: () => this.onSelect('firm', f.id) })).sort((a, b) => b.value - a.value))),
    ];
  }
}
