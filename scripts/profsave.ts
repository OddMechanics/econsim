// Profile a saved state: `tsx scripts/profsave.ts <save.json> <hours>`
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const mins = Number(process.argv[3] ?? 6) * 60;
for (let i = 0; i < Number(process.argv[4] ?? 30); i++) sim.step();
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
const t0 = performance.now();
for (let i = 0; i < mins; i++) sim.step();
console.log('pop', sim.state.people.length, 'minutes', mins, 'took', ((performance.now() - t0) / 1000).toFixed(1), 's');
const { profile } = await session.post('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
for (const s of profile.samples ?? []) { const n = byId.get(s)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + 1); }
const total = profile.samples!.length;
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
