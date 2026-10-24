// Politics diagnostics: offices, laws, agenda, treasury, events, parties.
// `./node_modules/.bin/tsx scripts/politics.ts <days> <seed>`
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { treasury } from '../src/sim/government';
import { compassLabel } from '../src/sim/ideology';

const days = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 1);
const sim = new Simulation(createState(seed));
const ctx = sim.ctx;
for (let d = 0; d < days; d++) {
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  const s = sim.state;
  for (const g of s.polities) {
    const f = g.fiscal;
    const inc = Object.entries(f.prevIncome).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    const sp = Object.entries(f.prevSpend).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    console.log(`day ${d + 1} ${g.name} [${g.label}] treasury ${treasury(ctx, g).toFixed(0)} legit ${g.legitimacy.toFixed(2)} | in: ${inc} | out: ${sp} | next session ${(g.nextSession / MINUTES_PER_DAY + 1).toFixed(1)} next election ${g.nextElection > 0 ? (g.nextElection / MINUTES_PER_DAY + 1).toFixed(1) : '-'}`);
  }
}
const s = sim.state;
for (const g of s.polities) {
  console.log(`\n== ${g.name}: ${g.label}`);
  console.log('policy', JSON.stringify(g.policy));
  console.log('charter', JSON.stringify(g.charter));
  for (const o of g.offices) {
    const p = ctx.byId.get(o.holder);
    console.log(`  ${o.title}: ${p ? `${p.name} (${compassLabel(p.pol.econ, p.pol.auth)}, party ${ctx.partyById.get(p.pol.party)?.name ?? '-'})` : 'vacant'} term ends ${o.termEnd > 0 ? (o.termEnd / MINUTES_PER_DAY + 1).toFixed(0) : '-'}`);
  }
  console.log('laws:'); for (const l of g.laws.slice(-25)) console.log(`  day ${(l.t / MINUTES_PER_DAY + 1).toFixed(0)} ${l.passed ? 'PASSED' : 'failed'} ${l.title} (${l.how} ${l.yes}-${l.no})`);
  console.log('agenda:', g.agenda.map((m) => m.title).join(' | '));
}
console.log('\nparties:', s.parties.map((p) => `${p.name} (${p.members.length})`).join(', '));
console.log('events:', s.events.slice(-10).map((e) => `${e.kind} d${(e.start / MINUTES_PER_DAY + 1).toFixed(1)} att ${e.attendees.length} lines ${e.lines.length}`).join(' | '));
console.log('elections:', s.elections.map((e) => `${e.kind} ${e.status} d${(e.day / MINUTES_PER_DAY + 1).toFixed(0)} turnout ${(e.turnout * 100).toFixed(0)}% cands ${e.candidates.length}`).join(' | '));
const edges = s.roads.edges;
console.log(`roads: ${edges.length} (${edges.filter((e) => e.built === false).length} dirt, ${edges.filter((e) => e.paving).length} being paved), lots ${s.roads.lots.length}, for sale ${s.roads.lots.filter((l) => l.forSale > 0 && l.building < 0).length}`);
console.log('land demand', JSON.stringify(s.landDemand));
const reasons: Record<string, number> = {};
for (const l of s.log) if (l.kind === 'job') { const k = l.text.replace(/^[A-Z][a-z]+ [A-Z][a-z]+ /, '').replace(/\(.*\)/, '').replace(/\d+/g, 'N').slice(0, 50); reasons[k] = (reasons[k] ?? 0) + 1; }
console.log(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12));
