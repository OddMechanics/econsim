// When do multi-story buildings appear? Counts built buildings by floors over time.
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
const days = Number(process.argv[2] ?? 60);
const sim = new Simulation(createState(Number(process.argv[3] ?? 12345)));
for (let d = 1; d <= days; d++) {
  for (let i = 0; i < MINUTES_PER_DAY; i++) sim.step();
  if (d % 5) continue;
  const built = sim.state.buildings.filter((b) => b.built && !b.ruined);
  const multi = built.filter((b) => b.floors >= 2);
  const kinds: Record<string, number> = {};
  for (const b of multi) kinds[`${b.kind}${b.floors}`] = (kinds[`${b.kind}${b.floors}`] ?? 0) + 1;
  const planned = sim.state.buildings.filter((b) => !b.built && !b.ruined && b.floors >= 2).map((b) => `${b.kind}${b.floors}`);
  console.log(`day ${d}: pop ${sim.state.people.length}, built ${built.length}, 2+ floors ${multi.length} ${JSON.stringify(kinds)} | under construction 2+: ${planned.join(',')}`);
}
