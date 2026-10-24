// A snapshot of the v0.4 features after N days: towers, leases, ads, sites, gigs, chains.
import { createState, Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY } from '../src/sim/config';
const days = Number(process.argv[2] ?? 150), seed = Number(process.argv[3] ?? 4);
const sim = new Simulation(createState(seed));
for (let i = 0; i < days * MINUTES_PER_DAY; i++) sim.step();
const s = sim.state, ctx = sim.ctx;
const jobs = s.contracts.length, pop = s.people.length;
console.log(`day ${days} seed ${seed}: pop ${pop}, jobs ${jobs}, unemployed ${s.people.filter((p) => p.job < 0 && !p.firms.length).length}, homeless ${s.people.filter((p) => p.home < 0).length}, deaths ${s.counters.deaths}, emigrated ${s.counters.emigrated ?? 0}`);
for (const t of s.buildings.filter((b) => (b.kind === 'tower' || b.kind === 'officetower') && !b.ruined)) {
  const units = (t.hosted ?? []).map((id) => ctx.bById.get(id)!).filter(Boolean);
  const occupied = t.units.filter((u) => u.tenant >= 0).length;
  console.log(`  ${t.kind} ${t.floors}F ${t.built ? 'built' : `${Math.round(t.workDone / t.workNeeded * 100)}%`} flats ${occupied}/${t.units.length} units: ${units.map((u) => u.kind).join(',')}`);
}
const leased = s.buildings.filter((b) => b.host !== undefined && b.lease && b.lease.tenant >= 0);
console.log('leased units:', Object.entries(leased.reduce((m: Record<string, number>, b) => { m[b.kind] = (m[b.kind] ?? 0) + 1; return m; }, {})));
const ads = s.ads.reduce((m: Record<string, number>, a) => { const k = `${a.kind}${a.owner !== undefined ? (a.sponsor < 0 ? ':vacant' : ':rented') : ''}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log('ads:', ads);
console.log('sites:', s.firms.filter((f) => f.site && !f.closed).map((f) => `${f.site!.name}(${f.site!.kind}) users ${f.site!.users} cpm ${(f.site!.cpm ?? 0).toFixed(1)} adRev ${(f.site!.adRevenue ?? 0).toFixed(0)}`).join(' | '));
const c = s.counters;
console.log(`orders ${c.orders} gigs ${c.gigs} rides ${c.rides} imports ${c.imports} exports ${c.exports} dayLabor ${c.dayLabor}; gig workers now ${s.people.filter((p) => p.task?.steps[p.task.i]?.k === 'gig').length}; influencers ${s.people.filter((p) => (p.followers ?? 0) >= 25).map((p) => Math.round(p.followers!)).join(',')}`);
console.log('crowdfunds:', (s.crowdfunds ?? []).map((x) => `${x.title} ${x.raised.toFixed(0)}/${x.goal} ${x.status}`).join(' | '));
console.log('chains:', s.firms.filter((f) => f.branch && !f.closed).map((f) => `${f.name}:${f.sites.length}`).join(' '));
console.log('top advertisers:', s.firms.filter((f) => f.adBudget).sort((a, b) => (b.adBudget ?? 0) - (a.adBudget ?? 0)).slice(0, 6).map((f) => `${f.name} ${f.adBudget!.toFixed(1)}`).join(', '));
const kinds: Record<string, number> = {};
for (const b of s.buildings) if (!b.ruined && b.built && b.host === undefined) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
console.log('buildings:', kinds);
console.log('richest:', [...s.people].sort((a, b) => b.money - a.money).slice(0, 6).map((p) => `${p.name} ${p.money.toFixed(0)} (${p.firms.map((id) => ctx.fById.get(id)?.kind).join('/') || ctx.cById.get(p.job)?.role || '-'})`).join(', '));
