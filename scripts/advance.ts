// Run a saved city some days and save it again: `tsx scripts/advance.ts <in.json> <days> <out.json>`
import { readFileSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize, serialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const days = Number(process.argv[3] ?? 10);
for (let i = 0; i < days * 1440; i++) sim.step();
writeFileSync(process.argv[4], serialize(sim.state));
console.log('pop', sim.state.people.length, 'daily records', sim.state.daily?.length);
