// Run the simulation without graphics and print a daily summary.
// `./node_modules/.bin/tsx scripts/headless.ts <days> <seed> [-v]`
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { BUILDINGS } from '../src/sim/goods';
import type { BuildingKind } from '../src/sim/types';

const days = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 12345);
const verbose = process.argv.includes('-v');
const t0 = performance.now();
const sim = new Simulation(createState(seed));
console.log(`setup ${(performance.now() - t0).toFixed(0)}ms: ${sim.state.roads.edges.length} roads, ${sim.state.roads.lots.length} lots`);
let lastLogged: unknown = null;
for (let d = 0; d < days; d++) {
  const ts = performance.now();
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  const s = sim.state;
  const kinds: Record<string, number> = {};
  for (const b of s.buildings) if (!b.ruined) kinds[b.kind] = (kinds[b.kind] ?? 0) + (b.built ? 1 : 0);
  const sites = Object.entries(kinds).filter(([, n]) => n > 0).map(([k, n]) => `${BUILDINGS[k as BuildingKind].label.split(' ')[0].toLowerCase()}:${n}`).join(' ');
  const st = s.stats[s.stats.length - 1];
  console.log(`day ${String(d + 1).padStart(3)} pop ${s.people.length} dead ${s.counters.deaths} jobs ${s.contracts.length} posts ${s.postings.length} firms ${st?.firms} homes ${st?.homes}/${s.people.length} renters ${st?.renters} cars ${st?.cars} ships ${s.shipments.length} trades ${s.counters.trades} hires ${s.counters.hires} lay ${s.counters.layoffs} quit ${s.counters.quits} money ${st?.money.toFixed(0)} gini ${st?.gini.toFixed(2)} food ${st?.avgFood.toFixed(0)} wage ${st?.avgWage.toFixed(1)} rent ${st?.avgRent.toFixed(1)} | ${sites} | ${((performance.now() - ts) / 1000).toFixed(1)}s`);
  if ((d + 1) % 10 === 0) {
    for (const g of s.polities) if (g.status !== 'gone') console.log(`   [${g.short}: ${g.label}; treasury ${s.firms.find((f) => f.id === g.firm)?.cash.toFixed(0)}; legit ${g.legitimacy.toFixed(2)}; laws ${g.laws.length}; parties ${s.parties.filter((p) => p.polity === g.id && p.members.length).map((p) => `${p.short}:${p.members.length}`).join(',')}]`);
    const unemployed = s.people.filter((p) => p.job < 0 && !p.firms.length).length;
    const c = s.counters;
    console.log(`   [net: orders ${c.orders ?? 0} gigs ${c.gigs ?? 0} rides ${c.rides ?? 0} imports ${c.imports ?? 0} exports ${c.exports ?? 0} crowdfunds ${(s.crowdfunds ?? []).map((x) => x.status[0]).join('')} influencers ${s.people.filter((p) => (p.followers ?? 0) >= 25).length} adcos ${s.firms.filter((f) => f.kind === 'adco' && !f.closed).length} ad spend/day ${s.firms.reduce((a, f) => a + (f.adSpend?.street ?? 0) + (f.adSpend?.net ?? 0) + (f.adSpend?.tv ?? 0) + (f.adSpend?.influencer ?? 0), 0).toFixed(0)} towers ${s.buildings.filter((b) => (b.kind === 'tower' || b.kind === 'officetower') && b.built).map((b) => b.floors).join(',') || 'none'} chains ${s.firms.filter((f) => f.branch && !f.closed).map((f) => f.branch).join(',')}]`);
    console.log(`   [media: ${s.firms.filter((f) => f.channel).map((f) => f.channel!.name + ' ' + f.channel!.viewers).join(', ') || 'no TV'}; sites ${s.firms.filter((f) => f.site).map((f) => `${f.site!.name}(${f.site!.kind}) ${f.site!.users}`).join(', ') || 'none'}; phones ${s.people.filter((p) => (p.durables.phone ?? 0) > 0).length} tvs ${s.people.filter((p) => (p.durables.tv ?? 0) > 0).length}; ads ${s.ads.length}; protests ${s.events.filter((e) => e.kind === 'protest').length}; auctions ${s.auctions.length}; unemployed ${unemployed}; homeless ${s.people.filter((p) => p.home < 0).length}; dirt roads ${s.roads.edges.filter((e) => e.built === false).length}/${s.roads.edges.length}]`);
  }
  if (verbose) {
    // the log is capped, so find where we left off by entry, not by index
    const from = lastLogged ? s.log.indexOf(lastLogged as never) + 1 : 0;
    for (const e of s.log.slice(Math.max(0, from))) console.log('   ·', e.text);
    lastLogged = s.log[s.log.length - 1] ?? null;
  }
}
const acts: Record<string, number> = {};
for (const p of sim.state.people) { const k = (p.task?.label ?? '-').replace(/\d+/g, 'N').slice(0, 40); acts[k] = (acts[k] ?? 0) + 1; }
console.log(Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${n} ${k}`).join(' | '));
