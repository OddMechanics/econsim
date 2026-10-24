// Profile the simulation after a warm-up: `tsx scripts/prof.ts <warmDays> <profDays> <seed> <out.cpuprofile>`
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { createState, Simulation } from '../src/sim/sim';
const [warm, prof, seed, out] = [Number(process.argv[2] ?? 120), Number(process.argv[3] ?? 2), Number(process.argv[4] ?? 4), process.argv[5] ?? 'sim.cpuprofile'];
const sim = new Simulation(createState(seed));
for (let i = 0; i < warm * 1440; i++) sim.step();
console.log('warm done, pop', sim.state.people.length);
const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.start');
const t0 = performance.now();
for (let i = 0; i < prof * 1440; i++) sim.step();
console.log('profiled', prof, 'days in', ((performance.now() - t0) / 1000).toFixed(1), 's');
const { profile } = await session.post('Profiler.stop');
writeFileSync(out, JSON.stringify(profile));
// top self-time functions
const self = new Map<string, number>();
const total = profile.samples?.length ?? 1;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map<number, number>();
for (const s of profile.samples ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
for (const [id, c] of counts) {
  const n = byId.get(id)!;
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + c);
}
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
