// Who keeps choosing "Have a house built", and why the plan does nothing
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const seen = new Map<number, number>();
for (let i = 0; i < 600; i++) {
  sim.step();
  for (const p of sim.state.people) if (p.decision?.t === sim.state.tick - 1 && /./.test(p.decision.chosen)) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
}
const top = [...seen].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [id, n] of top) {
  const p = sim.state.people.find((x) => x.id === id)!;
  const proj = sim.state.buildings.find((b) => b.id === p.projectId);
  console.log(n, p.name, p.decision?.chosen, 'money', p.money.toFixed(0), 'home', sim.state.buildings.find((b) => b.id === p.home)?.kind, 'project', p.projectId, proj?.kind, proj?.built, proj?.owner === p.id, 'task', p.task?.label, p.task?.steps.map((s) => s.k).join(','));
}
