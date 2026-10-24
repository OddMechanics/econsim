// inclusive profile of a save: tsx incl.ts <save> <hours>
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const mins = Number(process.argv[3] ?? 6) * 60;
for (let i = 0; i < Number(process.argv[4] ?? 30); i++) sim.step();
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 200 }); await session.post('Profiler.start');
const t0 = performance.now();
for (let i = 0; i < mins; i++) sim.step();
console.log('pop', sim.state.people.length, 'minutes', mins, 'took', ((performance.now() - t0) / 1000).toFixed(1), 's');
const { profile } = await session.post('Profiler.stop');
const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of profile.nodes as any[]) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map<string, number>();
for (const s of profile.samples ?? []) {
  const seen = new Set<string>();
  for (let id: number | undefined = s; id !== undefined; id = parent.get(id)) {
    const n: any = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}`;
    if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + 1); }
  }
}
const total = profile.samples!.length;
console.log([...incl].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
