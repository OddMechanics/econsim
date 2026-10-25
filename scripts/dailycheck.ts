// Run a saved city a few days and print the daily statistics (and how long recording took).
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { recordDaily } from '../src/sim/stats';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
for (let i = 0; i < Number(process.argv[3] ?? 2) * 1440; i++) sim.step();
const t0 = performance.now();
recordDaily(sim.ctx);
console.log('recordDaily took', (performance.now() - t0).toFixed(0), 'ms');
const d = sim.state.daily!;
const last = d[d.length - 2];
console.log(JSON.stringify({ ...last, markets: Object.fromEntries(Object.entries(last.markets).slice(0, 3)) }, null, 0).slice(0, 2500));
console.log('days recorded', d.length, 'json size of one', JSON.stringify(last).length);
