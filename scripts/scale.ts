// How the cost of a game day grows with population: a real city (a save) topped up with newcomers.
// `tsx scripts/scale.ts <save.json> <target population> [stride]`
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { spawnNewcomer } from '../src/sim/people';
import { serialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
sim.stride = Number(process.argv[4] ?? 5);
const target = Number(process.argv[3] ?? 6000);
while (sim.state.people.length < target) { const p = spawnNewcomer(sim.ctx); if (p) p.money += 1500; }
for (let d = 0; d < 2; d++) {
  const t0 = performance.now();
  for (let m = 0; m < 1440; m++) sim.step();
  console.log(`day ${d + 1}: ${((performance.now() - t0) / 1000).toFixed(1)} s, pop ${sim.state.people.length}`);
}
{
  const t0 = performance.now();
  const json = serialize(sim.state);
  console.log(`save: ${(json.length / 1e6).toFixed(0)} MB, took ${((performance.now() - t0) / 1000).toFixed(1)} s to write; heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
}
if (process.argv.includes('noprof')) process.exit(0);
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
for (let m = 0; m < 720; m++) sim.step();
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
console.log([...incl].sort((a, b) => b[1] - a[1]).slice(3, 40).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
const self = new Map<string, number>();
for (const s of profile.samples ?? []) { const n: any = byId.get(s)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + 1); }
console.log('--- self');
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, c]) => `${(c / total * 100).toFixed(1)}% ${k}`).join('\n'));
