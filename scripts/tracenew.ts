// Trace a person in a fresh world: `tsx scripts/tracenew.ts <seed> <name> <fromMinute> <minutes> [every]`
import { createState, Simulation } from '../src/sim/sim';
import { formatTime } from '../src/sim/ctx';
const [seed, name, from, mins, every] = [Number(process.argv[2]), process.argv[3], Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6] ?? 30)];
const sim = new Simulation(createState(seed));
for (let i = 0; i < from; i++) sim.step();
const p = sim.state.people.find((x) => x.name === name);
if (!p) { console.log('not found'); process.exit(0); }
let lastD = -1;
for (let i = 0; i < mins; i++) {
  sim.step();
  const d = p.decision;
  if (d && d.t !== lastD) {
    lastD = d.t;
    console.log(formatTime(d.t), `food ${p.needs.food.toFixed(0)} hp ${p.needs.health.toFixed(0)} money ${p.money.toFixed(0)} inv ${p.inv.groceries.toFixed(1)} pantry ${p.pantry.groceries.toFixed(1)} home ${p.home}`, '→', d.chosen, '|', d.options.map((o) => `${o.label} ${o.score.toFixed(2)}`).join(' ; ').slice(0, 330));
  } else if (i % every === 0) console.log('   ', formatTime(sim.state.tick), p.activity, `food ${p.needs.food.toFixed(0)}`);
}
