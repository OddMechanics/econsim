// Run N days and save the state to a file (for profiling and inspection).
import { writeFileSync } from 'node:fs';
import { createState, Simulation } from '../src/sim/sim';
import { serialize } from '../src/sim/save';
const [days, seed, out] = [Number(process.argv[2] ?? 150), Number(process.argv[3] ?? 4), process.argv[4] ?? 'save.json'];
const sim = new Simulation(createState(seed));
for (let i = 0; i < days * 1440; i++) sim.step();
writeFileSync(out, serialize(sim.state));
console.log('saved day', days, 'pop', sim.state.people.length);
