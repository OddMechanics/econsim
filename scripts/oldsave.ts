// Load a save from before the countryside and run it a little: usage tsx scripts/oldsave.ts <save.json> [days]
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/sim/save';
import { Simulation } from '../src/sim/sim';
import { isRural } from '../src/sim/countryside';
import { MINUTES_PER_DAY } from '../src/sim/config';
const s = deserialize(readFileSync(process.argv[2], 'utf8'));
const t0 = performance.now();
const sim = new Simulation(s);
console.log(`loaded: people ${s.people.length}, countryside laid out in ${(performance.now() - t0).toFixed(0)} ms; rural ${s.people.filter((p) => isRural(sim.ctx, p)).length}, far gates ${JSON.stringify(s.farGates?.map((g) => [Math.round(g.x), Math.round(g.y)]))}, polity cells ${s.polities.map((g) => g.cells.length).join('/')}`);
sim.stride = 15;
const days = Number(process.argv[3] ?? 2);
for (let d = 0; d < days; d++) {
  const t1 = performance.now();
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  const rural = s.people.filter((p) => isRural(sim.ctx, p));
  console.log(`day +${d + 1}: ${((performance.now() - t1) / 1000).toFixed(1)} s, people ${s.people.length}, rural ${rural.length}, dead ${s.dead.length}, rural food ${(rural.reduce((n, p) => n + p.needs.food, 0) / Math.max(1, rural.length)).toFixed(0)}`);
}
