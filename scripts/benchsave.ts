// Time a game day from a save (no profiler): `tsx scripts/benchsave.ts <save.json> [days]`
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
sim.stride = Number(process.argv[4] ?? 5);
for (let d = 0; d < Number(process.argv[3] ?? 1); d++) {
  const t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < 1440; i++) { const a = performance.now(); sim.step(); worst = Math.max(worst, performance.now() - a); }
  console.log(`day: ${((performance.now() - t0) / 1000).toFixed(1)} s, pop ${sim.state.people.length}, slowest tick ${worst.toFixed(0)} ms`);
}
