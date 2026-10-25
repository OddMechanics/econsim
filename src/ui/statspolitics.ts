// The statistics window's Politics and Advertising sections.
//
// Politics: the elections at a glance (when, who's running, the polls, the
// money), every campaign ad, the political compass with everyone's dot, how
// groups lean, and how views, parties and moods change over time.
// Advertising: what each channel costs and brings in, who advertises and how
// they split their budget, the street ad spaces, and campaign ad spending.

import { formatTime, nameOf, type Ctx } from '../sim/ctx';
import { BUILDINGS } from '../sim/goods';
import { compass, compassLabel } from '../sim/ideology';
import { poll } from '../sim/elections';
import { mainPolity } from '../sim/government';
import type { Simulation } from '../sim/sim';
import { wealthOf } from '../sim/stats';
import type { AdChannel, AdLogEntry, DailyStat, Election, Person, Polity } from '../sim/types';
import { morphHTML } from './morph';
import { BarList, card, Columns, CompassChart, compact, DivergingBars, type Dot, type Marker, percent, type Series, whole } from './statcharts';

export interface Part { el: HTMLElement; update: (days: DailyStat[], x: number[]) => void }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const slot = (i: number) => `var(--series-${(i % 8) + 1})`;
const hsl = (h: number, s = 55, l = 42) => `hsl(${Math.round(h * 360)} ${s}% ${l}%)`;
const OTHER = 'var(--text-muted)';
const DIM = 'var(--dim)';
/** Wealth fifths on one blue ramp (dark mode: the richest lightest). */
const WEALTH_RAMP = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'];
const WEALTH_LABEL = ['Poorest 20%', 'Lower 20%', 'Middle 20%', 'Upper 20%', 'Richest 20%'];
const KIND_LABEL: Record<AdLogEntry['kind'], string> = { poster: 'Posters', billboard: 'Billboard', space: 'Ad space', tv: 'TV spot', online: 'Online', attack: 'Attack ad' };
const CHANNEL_LABEL: Record<AdChannel, string> = { street: 'Street', net: 'Online', tv: 'TV', influencer: 'Influencers' };
const CHANNELS: AdChannel[] = ['street', 'net', 'tv', 'influencer'];

type Helpers = {
  chart: (title: string, sub: string, series: (days: DailyStat[]) => Series[], opts?: Record<string, unknown>) => Part;
  s: (name: string, color: string, days: DailyStat[], f: (d: DailyStat) => number | null | undefined) => Series;
  keyed: (days: DailyStat[], pick: (d: DailyStat) => Record<string, number>) => Series[];
  onSelect: (kind: 'person' | 'firm' | 'building', id: number) => void;
};

/** People's wealth, worked out at most once an hour of game time (it's costly). */
const wealthCache = new WeakMap<object, { t: number; m: Map<number, number> }>();
function wealthMap(ctx: Ctx): Map<number, number> {
  const c = wealthCache.get(ctx.s);
  if (c && Math.abs(ctx.s.tick - c.t) < 60) return c.m;
  const m = new Map<number, number>();
  for (const p of ctx.s.people) m.set(p.id, wealthOf(ctx, p));
  wealthCache.set(ctx.s, { t: ctx.s.tick, m });
  return m;
}

/** Everyone's wealth fifth (0 poorest … 4 richest). */
function wealthFifths(ctx: Ctx): Map<number, number> {
  const w = wealthMap(ctx);
  const sorted = [...w.entries()].sort((a, b) => a[1] - b[1]);
  const out = new Map<number, number>();
  sorted.forEach(([id], i) => out.set(id, Math.min(4, Math.floor((i / Math.max(1, sorted.length)) * 5))));
  return out;
}

const workOf = (p: Person) => (p.job >= 0 ? 0 : p.firms.length ? 1 : 2);
const WORK_LABEL = ['Employed', 'Runs a business', 'Out of work'];

/** Open (campaigning or voting) elections, the main government's first. */
function openElections(sim: Simulation): Election[] {
  const main = mainPolity(sim.ctx);
  return sim.state.elections.filter((e) => e.status === 'campaign' || e.status === 'voting').sort((a, b) => (a.polity === main?.id ? -1 : b.polity === main?.id ? 1 : a.day - b.day));
}

// -------------------------------------------------------------- politics

export function politicsParts(sim: () => Simulation, h: Helpers): Part[] {
  let mode = 'party';
  let adsFilter: 'all' | 'attack' = 'all';
  const ctxOf = () => sim().ctx;

  // 1. the elections at a glance
  const glance = document.createElement('div');
  glance.className = 'sv-card sv-wide';
  const fillGlance = () => {
    const s = sim().state, ctx = ctxOf();
    const main = mainPolity(ctx);
    const govs = s.polities.filter((g) => g.status !== 'gone').sort((a, b) => (a === main ? -1 : b === main ? 1 : 0));
    const open = openElections(sim());
    const adCount = new Map<string, number>();
    for (const a of s.adLog ?? []) { const k = `${a.election}:${a.sponsor}`; adCount.set(k, (adCount.get(k) ?? 0) + 1); if (a.target !== undefined) { const t = `${a.election}:at:${a.target}`; adCount.set(t, (adCount.get(t) ?? 0) + 1); } }
    const dayTxt = (tick: number) => formatTime(tick);
    const inDays = (tick: number) => { const d = Math.ceil((tick - s.tick) / 1440); return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`; };
    const block = (g: Polity, full: boolean) => {
      const e = open.find((x) => x.polity === g.id);
      const next = g.nextElection >= 0 ? `Next election: <b>${dayTxt(g.nextElection)}</b> (${inDays(g.nextElection)})` : g.charter.suspendedUntil > s.tick ? '<b>Elections suspended</b>' : 'No elections scheduled';
      let html = `<div class="el-gov"><div class="el-head"><span class="el-name">${esc(g.name)}</span>${e ? `<span class="el-pill ${e.status}">${e.status === 'voting' ? 'Voting now' : 'Campaigning'}</span>` : ''}<span class="muted small">${next}</span></div>`;
      if (e && full) {
        const rows: string[] = [];
        const offices = [...new Set(e.candidates.filter((c) => !c.withdrawn).map((c) => c.office))];
        for (const oid of offices) {
          const office = g.offices.find((o) => o.id === oid);
          const pollRes = poll(ctx, e, oid, 120);
          const cands = e.candidates.filter((c) => !c.withdrawn && c.office === oid).sort((a, b) => (pollRes.find((r) => r.person === b.person)?.share ?? 0) - (pollRes.find((r) => r.person === a.person)?.share ?? 0));
          rows.push(`<tr class="el-office"><td colspan="8">${esc(office?.title ?? 'Office')}${office && office.holder >= 0 ? ` <span class="muted">· now held by ${esc(nameOf(ctx, office.holder))}</span>` : ''}</td></tr>`);
          for (const c of cands) {
            const party = ctx.partyById.get(c.party);
            const share = pollRes.find((r) => r.person === c.person)?.share ?? 0;
            const ads = adCount.get(`${e.id}:${c.person}`) ?? 0, hits = adCount.get(`${e.id}:at:${c.person}`) ?? 0;
            rows.push(`<tr class="sv-click" data-person="${c.person}"><td><i class="key-dot" style="background:${party ? hsl(party.hue, 55, 52) : OTHER}"></i>${esc(nameOf(ctx, c.person))}</td><td>${party ? esc(party.short) : 'independent'}</td><td>${esc(compassLabel(c.econ, c.auth))}</td><td class="el-poll"><span class="sv-bar-track"><i style="width:${(share * 100).toFixed(0)}%;background:var(--series-1)"></i></span><b>${(share * 100).toFixed(0)}%</b></td><td class="r">${compact(c.funds)}</td><td class="r">${compact(c.spent)}</td><td class="r">${ads}</td><td class="r">${hits || '—'}</td></tr>`);
          }
        }
        html += `<div class="sv-scroll"><table class="sv-mtable el-table"><tr><th>Candidate</th><th>Party</th><th>Views</th><th>Poll</th><th class="r">Funds</th><th class="r">Spent</th><th class="r">Ads bought</th><th class="r">Attacked in</th></tr>${rows.join('')}</table></div>`;
      }
      if (full) {
        const held = g.offices.filter((o) => o.holder >= 0).slice(0, 12).map((o) => {
          const party = ctx.partyById.get(o.party);
          return `<span class="chip" data-person="${o.holder}">${esc(o.title)}: ${esc(nameOf(ctx, o.holder))}${party ? ` (${esc(party.short)})` : ''}${o.termEnd >= 0 ? ` · until day ${Math.floor(o.termEnd / 1440) + 1}` : ''}</span>`;
        });
        html += `<div class="el-held"><span class="muted small">In office:</span> ${held.join('') || '<span class="muted small">nobody yet</span>'}</div>`;
      }
      return html + '</div>';
    };
    // the main government in full, then every government that's campaigning, then the rest briefly
    const campaigning = govs.slice(1).filter((g) => open.some((e) => e.polity === g.id));
    const quiet = govs.slice(1).filter((g) => !campaigning.includes(g));
    morphHTML(glance, `<div class="sv-card-h"><div><div class="sv-title">Elections at a glance</div><div class="sv-sub">When the next votes are, who's running, how the polls look (from voters' views, party loyalty and name recognition), and the money and ads behind each campaign. Click a candidate to open them.</div></div></div>
      ${govs[0] ? block(govs[0], true) : '<p class="muted small">No government yet.</p>'}
      ${campaigning.map((g) => block(g, true)).join('')}
      ${quiet.length ? `<div class="el-others"><div class="pl-group">Other governments</div>${quiet.map((g) => block(g, false)).join('')}</div>` : ''}`);
  };
  glance.addEventListener('click', (ev) => { const el = (ev.target as HTMLElement).closest('[data-person]') as HTMLElement | null; if (el) h.onSelect('person', Number(el.dataset.person)); });

  // 2. the polls over time
  const polls = h.chart('Polls for the next race', 'Each candidate\'s expected share of the vote for the top office in the next election (the main government\'s, or the soonest elsewhere), day by day.', (d) => {
    const all = sim().state.daily ?? [];
    const lastPolls = [...all].reverse().find((x) => x.polls)?.polls;
    const cur = lastPolls ? { id: lastPolls.election } : undefined;
    const shares = d.map((x) => (x.polls && x.polls.election === cur?.id ? x.polls.shares : undefined));
    // the candidates in this race, strongest (latest poll) first; each keeps its color
    const latest = [...shares].reverse().find((x) => x) ?? {};
    const names = Object.keys(latest).sort((a, b) => latest[b] - latest[a]).slice(0, 7);
    return names.map((n, i) => ({ name: n, color: slot(i), values: shares.map((sh) => (sh ? sh[n] ?? null : null)) }));
  }, { fmt: percent });

  // 3. every campaign ad
  const adsCard = document.createElement('div');
  adsCard.className = 'sv-card sv-wide';
  const spendBars = new BarList('Campaign money spent, by candidate', 'Everything spent so far in the campaigns now running.', compact);
  const fillAds = () => {
    const s = sim().state, ctx = ctxOf();
    const open = new Set(openElections(sim()).map((e) => e.id));
    const recent = (s.adLog ?? []).filter((a) => open.has(a.election) || s.tick - a.t < 7 * 1440).filter((a) => adsFilter === 'all' || a.kind === 'attack').slice(-60).reverse();
    const byKind = new Map<string, number>();
    for (const a of (s.adLog ?? []).filter((x) => open.has(x.election))) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    const cards = recent.map((a) => {
      const cand = ctx.byId.get(a.sponsor);
      const party = ctx.partyById.get(cand?.pol.party ?? -1);
      const hue = party?.hue ?? cand?.looks.shirt ?? 0.6;
      const face = a.kind === 'attack' ? `background:#2a2a28;border:2px solid ${hsl(hue, 60, 50)}` : `background:${hsl(hue, 55, 38)}`;
      return `<div class="ad-card${a.kind === 'attack' ? ' attack' : ''}" data-person="${a.sponsor}"><div class="ad-face" style="${face}">${esc(a.headline)}</div><div class="ad-tag">${esc(a.tagline)}</div><div class="ad-meta"><span class="ad-kind">${KIND_LABEL[a.kind]}</span> · ${a.cost ? compact(a.cost) : 'free'} · ${esc(formatTime(a.t).split(',')[0])} · by ${esc(cand?.name ?? nameOf(ctx, a.sponsor))}${a.target !== undefined ? ` · about ${esc(nameOf(ctx, a.target))}` : ''}</div></div>`;
    });
    morphHTML(adsCard, `<div class="sv-card-h"><div><div class="sv-title">Campaign ads</div><div class="sv-sub">The latest ads in the campaigns now running (and the last week): posters supporters put up, billboards and rented spaces, TV spots, targeted online ads, and attack ads. Click one to open the candidate.</div></div>
      <div class="group sv-seg"><button data-adf="all" class="${adsFilter === 'all' ? 'on' : ''}">All</button><button data-adf="attack" class="${adsFilter === 'attack' ? 'on' : ''}">Attack ads</button></div></div>
      <div class="ad-counts muted small">${[...byKind.entries()].map(([k, n]) => `${KIND_LABEL[k as AdLogEntry['kind']]}: ${n}`).join(' · ') || 'No campaign running right now.'}</div>
      <div class="ad-grid">${cards.join('') || '<p class="muted small">No campaign ads yet.</p>'}</div>`);
    const cands = openElections(sim()).flatMap((e) => e.candidates.filter((c) => !c.withdrawn));
    spendBars.set(cands.map((c) => ({ label: nameOf(ctx, c.person), value: c.spent, onClick: () => h.onSelect('person', c.person) })).sort((a, b) => b.value - a.value), 12);
  };
  adsCard.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const f = t.closest('[data-adf]') as HTMLElement | null;
    if (f) { adsFilter = f.dataset.adf as 'all' | 'attack'; fillAds(); return; }
    const el = t.closest('[data-person]') as HTMLElement | null;
    if (el) h.onSelect('person', Number(el.dataset.person));
  });

  // 4. the political compass
  const compassChart = new CompassChart('Political compass (now)', 'Everyone in the city as a dot: economic left to right across, liberal to authoritarian upward. Rings are the parties\' platforms, the cross is the city\'s average. Hover a dot to see who it is; click to open them.',
    [['party', 'Party'], ['wealth', 'Wealth'], ['work', 'Work']], mode, (m) => { mode = m; fillCompass(); }, (id) => h.onSelect('person', id));
  compassChart.el.classList.add('sv-wide');
  const fillCompass = () => {
    const s = sim().state, ctx = ctxOf();
    const parties = s.parties.filter((p) => p.members.length).sort((a, b) => b.members.length - a.members.length);
    const top = parties.slice(0, 3);
    const partyColor = (id: number) => { const i = top.findIndex((p) => p.id === id); return i >= 0 ? slot(i) : id >= 0 ? OTHER : DIM; };
    const fifths = mode === 'wealth' ? wealthFifths(ctx) : undefined;
    const wealth = wealthMap(ctx);
    const dots: Dot[] = [];
    const counts = new Map<string, { label: string; color: string; n: number }>();
    const count = (label: string, color: string) => { const e = counts.get(color) ?? { label, color, n: 0 }; e.n++; counts.set(color, e); };
    let ex = 0, ay = 0;
    for (const p of s.people) {
      const c = compass(p);
      ex += c.econ; ay += c.auth;
      let color: string, label: string;
      if (mode === 'party') {
        color = partyColor(p.pol.party);
        const pt = ctx.partyById.get(p.pol.party);
        label = top.some((t) => t.id === p.pol.party) ? pt!.name : p.pol.party >= 0 ? 'Other parties' : 'No party';
      } else if (mode === 'wealth') {
        const q = fifths!.get(p.id) ?? 0;
        color = WEALTH_RAMP[q]; label = WEALTH_LABEL[q];
      } else {
        const k = workOf(p); color = slot(k); label = WORK_LABEL[k];
      }
      count(label, color);
      const party = ctx.partyById.get(p.pol.party);
      const job = ctx.cById.get(p.job);
      dots.push({ x: c.econ, y: c.auth, color, id: p.id, label: p.name, info: `${compassLabel(c.econ, c.auth)} · ${party ? party.name : 'no party'} · ${job ? 'employed' : p.firms.length ? 'runs a business' : 'out of work'} · worth ${compact(wealth.get(p.id) ?? 0)}` });
    }
    const n = Math.max(1, s.people.length);
    const markers: Marker[] = parties.slice(0, 6).map((pt) => ({ x: pt.econ, y: pt.auth, label: `${pt.short} (${pt.members.length})`, color: partyColor(pt.id), kind: 'ring' as const }));
    markers.push({ x: ex / n, y: ay / n, label: 'City average', color: OTHER, kind: 'cross' });
    const order = mode === 'wealth' ? WEALTH_LABEL : mode === 'work' ? WORK_LABEL : [...top.map((t) => t.name), 'Other parties', 'No party'];
    compassChart.set(dots, markers, [...counts.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)));
  };

  // 5. how views are spread, and how groups lean
  const econCols = new Columns('Left or right? (now)', 'People by their economic views, from far left to far right.');
  const authCols = new Columns('Liberal or authoritarian? (now)', 'People by how much order and authority they want, from libertarian to authoritarian.');
  const bins = (vals: number[], labels: string[]) => {
    const edges = [-Infinity, -1.2, -0.45, 0.45, 1.2, Infinity];
    return labels.map((label, i) => ({ label, value: vals.filter((v) => v >= edges[i] && v < edges[i + 1]).length }));
  };
  const leanEcon = new DivergingBars('How groups lean: left or right (now)', 'The average economic view of each group. Bars to the left lean left, to the right lean right.', 'left', 'right');
  const leanAuth = new DivergingBars('How groups lean: liberal or authoritarian (now)', 'The average view on order and authority of each group.', 'liberal', 'authoritarian');
  const fillLean = () => {
    const s = sim().state, ctx = ctxOf();
    const fifths = wealthFifths(ctx);
    const groups: { label: string; group: string; test: (p: Person) => boolean }[] = [
      ...WEALTH_LABEL.map((label, q) => ({ label, group: 'By wealth', test: (p: Person) => fifths.get(p.id) === q })),
      ...WORK_LABEL.map((label, k) => ({ label, group: 'By work', test: (p: Person) => workOf(p) === k })),
      { label: 'Renting', group: 'By home', test: (p: Person) => { const b = ctx.bById.get(p.home); return !!b && (b.kind === 'apartments' || b.kind === 'tower'); } },
      { label: 'Own house', group: 'By home', test: (p: Person) => { const b = ctx.bById.get(p.home); return !!b && b.kind === 'house' && b.owner === p.id; } },
      { label: 'Trailer', group: 'By home', test: (p: Person) => ctx.bById.get(p.home)?.kind === 'trailer' },
      { label: 'Homeless', group: 'By home', test: (p: Person) => p.home < 0 },
    ];
    const rows = groups.map((g) => { const ps = s.people.filter(g.test); const cs = ps.map(compass); return { ...g, n: ps.length, econ: cs.reduce((a, c) => a + c.econ, 0) / Math.max(1, cs.length), auth: cs.reduce((a, c) => a + c.auth, 0) / Math.max(1, cs.length) }; }).filter((r) => r.n > 0);
    leanEcon.set(rows.map((r) => ({ label: `${r.label} (${r.n})`, value: r.econ, group: r.group })));
    leanAuth.set(rows.map((r) => ({ label: `${r.label} (${r.n})`, value: r.auth, group: r.group })));
    const cs = s.people.map(compass);
    econCols.set(bins(cs.map((c) => c.econ), ['far left', 'left', 'center', 'right', 'far right']));
    authCols.set(bins(cs.map((c) => c.auth), ['libertarian', 'liberal', 'middle', 'law & order', 'authoritarian']));
  };

  // 6. past results
  const results = document.createElement('div');
  results.className = 'sv-card sv-wide';
  const fillResults = () => {
    const s = sim().state, ctx = ctxOf();
    const done = s.elections.filter((e) => e.status === 'done').sort((a, b) => b.day - a.day).slice(0, 10);
    const rows = done.map((e) => {
      const g = ctx.gById.get(e.polity);
      const won = e.results.flatMap((r) => r.winners.map((w) => {
        const total = Object.values(r.tallies).reduce((a, v) => a + v, 0) || 1;
        const party = ctx.partyById.get(e.candidates.find((c) => c.person === w)?.party ?? -1);
        return `${esc(nameOf(ctx, w))}${party ? ` (${esc(party.short)})` : ''} ${(((r.tallies[w] ?? 0) / total) * 100).toFixed(0)}%`;
      }));
      const motion = e.kind === 'referendum' ? `"${esc(e.motion?.title ?? 'referendum')}": ${(e.yes ?? 0) > (e.no ?? 0) ? 'passed' : 'rejected'} ${e.yes}–${e.no}` : won.join(', ');
      const none = e.candidates.length ? 'no winner' : 'nobody stood';
      return `<tr><td>${esc(formatTime(e.day).split(',')[0])}</td><td>${esc(g?.short ?? '?')}</td><td>${e.kind}</td><td>${motion || `<span class="muted">${none}</span>`}</td><td class="r">${percent(e.turnout)}</td></tr>`;
    });
    morphHTML(results, `<div class="sv-card-h"><div><div class="sv-title">Past elections</div><div class="sv-sub">Who won (and with what share of the vote in their race), and how many voters turned out.</div></div></div><div class="sv-scroll"><table class="sv-mtable"><tr><th>Day</th><th>Government</th><th>Kind</th><th>Winners</th><th class="r">Turnout</th></tr>${rows.join('') || '<tr><td colspan="5" class="muted">No elections held yet.</td></tr>'}</table></div>`);
  };

  return [
    { el: glance, update: () => fillGlance() },
    polls,
    { el: spendBars.el, update: () => undefined },
    { el: adsCard, update: () => fillAds() },
    { el: compassChart.el, update: () => fillCompass() },
    { el: econCols.el, update: () => fillLean() },
    { el: authCols.el, update: () => undefined },
    { el: leanEcon.el, update: () => undefined },
    { el: leanAuth.el, update: () => undefined },
    h.chart('Average views over time', 'Where the average resident stands: economic left (below 0) or right (above), liberal (below 0) or authoritarian (above).', (d) => [
      h.s('Left–right', slot(0), d, (x) => x.compass?.econ), h.s('Liberal–authoritarian', slot(1), d, (x) => x.compass?.auth)], { free: true, fmt: (v: number) => v.toFixed(2) }),
    h.chart('Party members', 'Members of each party. Stacked: the top edge is everyone in a party.', (d) => h.keyed(d, (x) => x.parties ?? {}), { kind: 'stacked' }),
    h.chart('Interest and anger', 'How interested people are in politics, and how aggrieved with the government (averages, 0 to 1).', (d) => [
      h.s('Interest in politics', slot(0), d, (x) => x.engagement), h.s('Grievance', slot(1), d, (x) => x.grievance)], { fmt: (v: number) => v.toFixed(2) }),
    h.chart('Protesters', 'People at a protest at the end of each day.', (d) => [h.s('Protesting', slot(7), d, (x) => x.protesting)], { kind: 'area' }),
    { el: results, update: () => fillResults() },
  ];
}

// ------------------------------------------------------------ advertising

export function adsParts(sim: () => Simulation, h: Helpers): Part[] {
  const ctxOf = () => sim().ctx;
  // per-channel effectiveness
  const eff = card('How well each channel works', 'Yesterday and the last 7 days: what companies spent, how many times their ads were seen, and how many people became new customers after seeing one (their first visit to a place they found through an ad).');
  eff.el.classList.add('sv-wide');
  eff.toggle.hidden = true;
  const fillEff = (days: DailyStat[]) => {
    const all = sim().state.daily ?? [];
    const last = all[all.length - 1];
    const week = all.slice(-7);
    const rows = CHANNELS.map((ch) => {
      const spend = last?.adSpend[ch] ?? 0, seen = last?.flows['adimp:' + ch] ?? 0, conv = last?.flows['adconv:' + ch] ?? 0;
      const wSpend = week.reduce((a, d) => a + (d.adSpend[ch] ?? 0), 0), wSeen = week.reduce((a, d) => a + (d.flows['adimp:' + ch] ?? 0), 0), wConv = week.reduce((a, d) => a + (d.flows['adconv:' + ch] ?? 0), 0);
      return `<tr><td><i class="key-rect" style="background:${slot(CHANNELS.indexOf(ch))}"></i>${CHANNEL_LABEL[ch]}</td><td class="r">${compact(spend)}</td><td class="r">${whole(seen)}</td><td class="r">${whole(conv)}</td><td class="r">${wSeen ? compact((wSpend / wSeen) * 1000) : '—'}</td><td class="r">${wConv ? compact(wSpend / wConv) : '—'}</td><td class="r">${whole(wConv)}</td></tr>`;
    });
    morphHTML(eff.body, `<div class="sv-scroll"><table class="sv-mtable"><tr><th>Channel</th><th class="r">Spent yesterday</th><th class="r">Times seen</th><th class="r">New customers</th><th class="r">Cost per 1,000 seen (7 days)</th><th class="r">Cost per new customer (7 days)</th><th class="r">New customers (7 days)</th></tr>${rows.join('')}</table></div>`);
    void days;
  };
  // advertisers
  const top = new BarList('Biggest advertisers (today)', 'Each company\'s ad budget for the day.', compact);
  const table = card('Advertisers and their budget split', 'How each company divides its budget between channels. Consumer brands shift money toward the channels that bring them new customers most cheaply, a little each day.');
  table.el.classList.add('sv-wide');
  table.toggle.hidden = true;
  const fillAdvertisers = () => {
    const ctx = ctxOf();
    const firms = sim().state.firms.filter((f) => !f.closed && (f.adBudget ?? 0) > 0.3).sort((a, b) => (b.adBudget ?? 0) - (a.adBudget ?? 0));
    top.set(firms.map((f) => ({ label: f.name, value: f.adBudget ?? 0, onClick: () => h.onSelect('firm', f.id) })), 12);
    const rows = firms.slice(0, 40).map((f) => {
      const mix = f.adMix ?? {};
      const perf = f.adPerf;
      const seen = perf ? CHANNELS.reduce((a, ch) => a + (perf.imp[ch] ?? 0), 0) : 0;
      const conv = perf ? CHANNELS.reduce((a, ch) => a + (perf.conv[ch] ?? 0), 0) : 0;
      const spend = perf ? CHANNELS.reduce((a, ch) => a + (perf.spend[ch] ?? 0), 0) : 0;
      const bar = CHANNELS.map((ch, i) => `<i style="width:${((mix[ch] ?? 0) * 100).toFixed(1)}%;background:${slot(i)}" title="${CHANNEL_LABEL[ch]} ${percent(mix[ch] ?? 0)}"></i>`).join('');
      return `<tr class="sv-click" data-firm="${f.id}"><td>${esc(f.name)}</td><td>${esc(BUILDINGS[f.kind].label)}</td><td class="r">${compact(f.adBudget ?? 0)}</td><td class="mixcell"><span class="mixbar">${f.adMix ? bar : ''}</span>${f.adMix ? '' : '<span class="muted small">fixed split</span>'}</td><td class="r">${whole(seen)}</td><td class="r">${conv.toFixed(1)}</td><td class="r">${conv > 0.05 ? compact(spend / conv) : '—'}</td></tr>`;
    });
    morphHTML(table.body, `<div class="legend">${CHANNELS.map((ch, i) => `<span><i class="key-rect" style="background:${slot(i)}"></i>${CHANNEL_LABEL[ch]}</span>`).join('')}</div><div class="sv-scroll"><table class="sv-mtable"><tr><th>Company</th><th>Business</th><th class="r">Budget/day</th><th>Budget split</th><th class="r">Ads seen/day</th><th class="r">New customers/day</th><th class="r">Cost per new customer</th></tr>${rows.join('')}</table></div>`);
    void ctx;
  };
  table.body.addEventListener('click', (ev) => { const el = (ev.target as HTMLElement).closest('[data-firm]') as HTMLElement | null; if (el) h.onSelect('firm', Number(el.dataset.firm)); });
  // street ad spaces
  const spaces = card('Street ad spaces (now)', 'Billboards, screens, columns, wall ads and sidewalk panels owned by ad companies: how many are rented out, and the going weekly rent.');
  spaces.toggle.hidden = true;
  const fillSpaces = () => {
    const ads = sim().state.ads.filter((a) => a.owner !== undefined);
    const kinds = [...new Set(ads.map((a) => a.kind))];
    morphHTML(spaces.body, `<table class="sv-mtable"><tr><th>Kind</th><th class="r">Spaces</th><th class="r">Rented</th><th class="r">Empty</th></tr>${kinds.map((k) => { const of = ads.filter((a) => a.kind === k); const rented = of.filter((a) => a.sponsor >= 0).length; return `<tr><td>${k}</td><td class="r">${of.length}</td><td class="r">${rented}</td><td class="r">${of.length - rented}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">No ad companies yet.</td></tr>'}</table>`);
  };
  return [
    { el: eff.el, update: (d) => fillEff(d) },
    h.chart('Ad spending per day', 'What companies spend on ads, by channel. Stacked: the top edge is all ad spending.', (d) => CHANNELS.map((ch, i) => h.s(CHANNEL_LABEL[ch], slot(i), d, (x) => x.adSpend[ch])), { kind: 'stacked' }),
    h.chart('New customers from ads per day', 'People who went to a shop or restaurant for the first time after learning about it from an ad, by where they saw it.', (d) => CHANNELS.map((ch, i) => h.s(CHANNEL_LABEL[ch], slot(i), d, (x) => x.flows['adimp:' + ch] === undefined && x.flows['adconv:' + ch] === undefined ? null : x.flows['adconv:' + ch] ?? 0))),
    h.chart('Cost per new customer', 'Ad spending divided by the new customers it brought, over the previous 7 days, by channel.', (d) => {
      const all = sim().state.daily ?? [];
      const idx = new Map(all.map((x, i) => [x.day, i]));
      return CHANNELS.map((ch, i) => h.s(CHANNEL_LABEL[ch], slot(i), d, (x) => {
        const k = idx.get(x.day) ?? 0;
        const wk = all.slice(Math.max(0, k - 6), k + 1);
        const conv = wk.reduce((a, y) => a + (y.flows['adconv:' + ch] ?? 0), 0), spend = wk.reduce((a, y) => a + (y.adSpend[ch] ?? 0), 0);
        return conv >= 1 ? spend / conv : null;
      }));
    }),
    { el: top.el, update: () => fillAdvertisers() },
    { el: spaces.el, update: () => fillSpaces() },
    { el: table.el, update: () => undefined },
    h.chart('Campaign ad spending per day', 'What candidates spent on ads each day (all governments).', (d) => {
      const byDay = new Map<number, number>();
      for (const a of sim().state.adLog ?? []) { const day = Math.floor(a.t / 1440) - 1; byDay.set(day, (byDay.get(day) ?? 0) + a.cost); }
      return [h.s('Campaign ads', slot(4), d, (x) => byDay.get(x.day) ?? 0)];
    }, { kind: 'area' }),
  ];
}
