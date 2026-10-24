// Trace what one person does minute by minute: `tsx scripts/trace.ts <save> <name> <minutes> [skip]`
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { formatTime } from '../src/sim/ctx';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
for (let i = 0; i < Number(process.argv[5] ?? 0); i++) sim.step();
const p = sim.state.people.find((x) => x.name === process.argv[3])!;
for (let i = 0; i < Number(process.argv[4] ?? 20); i++) {
  sim.step();
  const t = p.task;
  console.log(formatTime(sim.state.tick), 'd', p.decision?.t === sim.state.tick - 1 ? 'NEW ' + p.decision.chosen : '   ', t?.label, t ? `${t.i}/${t.steps.length} ${t.steps[t.i]?.k} el=${t.elapsed}` : '', 'pos', p.x.toFixed(0), p.y.toFixed(0), 'in', p.inside, 'path', p.path.length, 'drv', p.driving, p.activity, JSON.stringify(t?.steps[t.i] ?? {}).slice(0, 120));
}
