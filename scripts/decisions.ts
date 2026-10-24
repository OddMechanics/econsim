// How many decisions a day, and which choices: `tsx scripts/decisions.ts <save.json>`
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const by = new Map<string, number>();
let n = 0;
for (let i = 0; i < 1440; i++) {
  sim.step();
  for (const p of sim.state.people) if (p.decision?.t === sim.state.tick - 1 || p.decision?.t === sim.state.tick) {
    if ((p as any)._lastD === p.decision.t) continue;
    (p as any)._lastD = p.decision.t; n++;
    const k = p.decision.chosen.replace(/\d+/g, '#').slice(0, 40);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
}
console.log('pop', sim.state.people.length, 'decisions/day', n, 'per person', (n / sim.state.people.length).toFixed(1));
console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, c]) => `${c} ${k}`).join('\n'));
