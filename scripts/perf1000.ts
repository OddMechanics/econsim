// Performance with a big population: a fresh world plus ~950 newcomers, then time a few days.
// `./node_modules/.bin/tsx scripts/perf1000.ts [people]`
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { spawnNewcomer } from '../src/sim/people';

const n = Number(process.argv[2] ?? 1000);
const sim = new Simulation(createState(5));
for (let d = 0; d < 5; d++) for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
while (sim.state.people.length < n) { const p = spawnNewcomer(sim.ctx); if (p) p.money += 400; }
for (let d = 0; d < 4; d++) {
  const t0 = performance.now();
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  console.log(`day ${d + 1}: ${((performance.now() - t0) / 1000).toFixed(2)}s, pop ${sim.state.people.length}, homeless ${sim.state.people.filter((p) => p.home < 0).length}`);
}
