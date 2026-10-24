// Profile a synthetic 3,000-person city.
import { Session } from 'node:inspector/promises';
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { spawnNewcomer } from '../src/sim/people';
const sim = new Simulation(createState(5));
for (let d = 0; d < 5; d++) for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
while (sim.state.people.length < 3000) { const p = spawnNewcomer(sim.ctx); if (p) p.money += 400; }
for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
for (let m = 0; m < MINUTES_PER_DAY / 2; m++) sim.step();
const { profile } = await session.post('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
for (const s of profile.samples ?? []) { const n = byId.get(s)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + 1); }
const total = profile.samples!.length;
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
