// Stress test for the dramatic politics code paths: forces conditions that
// should produce backsliding, protests, a revolution or coup, and
// nationalization, and checks nothing crashes.
// `./node_modules/.bin/tsx scripts/regimetest.ts <seed>`
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { mainPolity } from '../src/sim/government';

const seed = Number(process.argv[2] ?? 3);
const sim = new Simulation(createState(seed));
const s = sim.state;
const run = (days: number) => { for (let d = 0; d < days; d++) for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step(); };
run(25);
const g = mainPolity(sim.ctx)!;
// 1. an authoritarian, ambitious mayor with a loyal council suspends elections
const exec = g.offices.find((o) => o.kind === 'exec');
const boss = sim.ctx.byId.get(exec?.holder ?? -1) ?? s.people[0];
boss.pol.auth = 2.5; boss.pol.econ = -1.6; boss.traits.ambition = 0.95;
for (const o of g.offices) { const p = sim.ctx.byId.get(o.holder); if (p) { p.pol.auth = 1.8; p.pol.econ = -1.4; } }
g.charter.suspendedUntil = s.tick + 60 * MINUTES_PER_DAY;
g.charter.parties = 'single';
console.log('forced: elections suspended, single party, authoritarian far-left leadership');
// 2. hunger and anger: empty pantries, freedom-loving people
for (const p of s.people) { p.pantry.groceries = 0; p.pantry.crops = 0; p.traits.curiosity = 0.9; p.pol.auth -= 1; p.pol.engagement = 0.8; }
run(25);
for (const g2 of s.polities) console.log(`${g2.name}: ${g2.label} status ${g2.status} legit ${g2.legitimacy.toFixed(2)} coups ${g2.coups}`);
const notable = s.log.filter((l) => /REVOLUTION|COUP|protest|nationaliz|decree|Postpone|ruler for life|only legal|supervision|founded their own town/.test(l.text));
for (const l of notable.slice(-25)) console.log(`  d${Math.floor(l.t / 1440) + 1} ${l.text}`);
console.log('events', s.events.filter((e) => e.kind === 'protest').map((e) => `${e.title} ${e.attendees.length}`).join(' | '));
console.log('ok, pop', s.people.length, 'dead', s.counters.deaths);
