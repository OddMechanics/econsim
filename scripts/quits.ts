import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
const sim = new Simulation(createState(Number(process.argv[3] ?? 12345)));
for (let i = 0; i < Number(process.argv[2] ?? 30) * MINUTES_PER_DAY; i++) sim.step();
const lines = sim.state.log.filter((e) => e.kind === 'job').map((e) => `d${Math.floor(e.t / 1440)} ${e.text}`);
console.log(lines.slice(-30).join('\n'));
