// What people are doing each minute (steady vs active), over a day
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { steadyStep } from '../src/sim/tasks';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const ctx = (sim as any).ctx;
const by = new Map<string, number>();
let steady = 0, total = 0;
for (let i = 0; i < 1440; i++) {
  sim.step();
  if (i % 10) continue;
  for (const p of sim.state.people) {
    total++;
    if (steadyStep(ctx, p)) { steady++; continue; }
    const st = p.task?.steps[p.task.i];
    let k = st ? st.k : 'none';
    if (p.path.length) k += '+walk';
    if (p.driving >= 0) k += '+drive';
    if (st?.k === 'work') k += ':' + ctx.cById.get((st as any).contract)?.role;
    if (st && (st.k === "work" || st.k === "ownWork") && !p.task!.mem?.seated) k += '(unseated)';
    by.set(k, (by.get(k) ?? 0) + 1);
  }
}
console.log('steady', (steady / total * 100).toFixed(1) + '%');
console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
