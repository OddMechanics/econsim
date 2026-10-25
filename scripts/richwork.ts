// What the comfortably off do: jobs by role, side work, current activity.
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { referenceWage } from '../src/sim/government';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const report = (label: string) => {
  const ctx = sim.ctx, ref = referenceWage(ctx);
  const rich = sim.state.people.filter((p) => p.money / ref > 80);
  const roles: Record<string, number> = {};
  for (const p of rich) { const c = ctx.cById.get(p.job); const k = c ? c.role : p.firms.length ? 'owner' : 'none'; roles[k] = (roles[k] ?? 0) + 1; }
  const acts: Record<string, number> = {};
  for (const p of rich) { const k = (p.task?.label ?? '-').replace(/\(.*\)/, '').replace(/\d+/g, '#').slice(0, 32); acts[k] = (acts[k] ?? 0) + 1; }
  console.log(`${label}: ${rich.length} people with 80+ days' pay saved (ref wage ${ref.toFixed(1)})`);
  console.log('  jobs:', JSON.stringify(roles));
  console.log('  doing:', Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${n} ${k}`).join(' | '));
};
report('now');
for (let i = 0; i < 3 * 1440; i++) sim.step();
// at 10:00 on a working day
while (sim.state.tick % 1440 !== 10 * 60) sim.step();
report('after 3 days, 10:00');
