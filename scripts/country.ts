// Quick look at the countryside: what was laid out, and how its people do over a few days.
// usage: tsx scripts/country.ts <days> <seed>
import { createState, Simulation } from '../src/sim/sim';
import { makeCtx } from '../src/sim/ctx';
import { isRural } from '../src/sim/countryside';
import { inGrid } from '../src/sim/world';
import { MINUTES_PER_DAY } from '../src/sim/config';

const days = Number(process.argv[2] ?? 3), seed = Number(process.argv[3] ?? 4);
let t0 = performance.now();
const s = createState(seed);
(globalThis as any).S = s;
console.log(`created in ${(performance.now() - t0).toFixed(0)} ms`);
const ctx = makeCtx(s);
const w = s.world;
const out = (x: number, y: number) => !inGrid(w, x, y);
const ringEdges = s.roads.edges.filter((e) => { const a = ctx.nodeById.get(e.a)!, b = ctx.nodeById.get(e.b)!; return out((a.x + b.x) / 2, (a.y + b.y) / 2); });
console.log('ring edges', ringEdges.length, 'km', (ringEdges.reduce((n, e) => n + e.len, 0) / 1000).toFixed(1), 'far gates', JSON.stringify(s.farGates));
const ringLots = s.roads.lots.filter((l) => out(l.x, l.y));
console.log('ring lots', ringLots.length, 'fields', ringLots.filter((l) => l.w > 100).length, 'village', ringLots.filter((l) => l.zone === 'suburb').length);
const kinds: Record<string, number> = {};
for (const b of s.buildings) if (out(b.x, b.y)) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
console.log('ring buildings', JSON.stringify(kinds));
const report = () => {
  const rural = s.people.filter((p) => isRural(ctx, p));
  const jobs = rural.filter((p) => p.job >= 0).length;
  const food = rural.reduce((n, p) => n + p.needs.food, 0) / Math.max(1, rural.length);
  const acts: Record<string, number> = {};
  for (const p of rural) { const k = p.activity.replace(/ at .*| \(.*/, ''); acts[k] = (acts[k] ?? 0) + 1; }
  const top = Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(', ');
  console.log(`day ${(s.tick / MINUTES_PER_DAY).toFixed(2)} people ${s.people.length} rural ${rural.length} employed ${jobs} food ${food.toFixed(0)} | ${top}`);
  const farms = s.firms.filter((f) => ['farm', 'vegfarm', 'dairyfarm', 'ranch'].includes(f.kind) && f.sites.some((id) => { const b = ctx.bById.get(id); return b && out(b.x, b.y); }));
  const open = farms.filter((f) => !f.closed);
  const cash = open.reduce((n, f) => n + f.cash, 0) / Math.max(1, open.length);
  const profit = open.reduce((n, f) => n + (f.ledger.days.at(-1) ?? 0), 0);
  const staff = s.contracts.filter((c) => open.some((f) => f.id === c.firm)).length;
  const price = (g: string) => (s.market.last as any)[g]?.toFixed(2);
  console.log(`   farms ${open.length}/${farms.length} cash ${cash.toFixed(0)} profit/day ${profit.toFixed(0)} hands ${staff} losing ${open.filter((f) => f.losing > 2).length} | price crops ${price('crops')} produce ${price('produce')} milk ${price('milk')} livestock ${price('livestock')}`);
};
report();
const sim = new Simulation(s);
sim.stride = 15;
for (let d = 0; d < days; d++) {
  t0 = performance.now();
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  report();
}
const dead = s.dead.length;
console.log('dead', dead, 'farm output', JSON.stringify(Object.fromEntries(['crops', 'produce', 'milk', 'livestock'].map((g) => [g, Math.round(s.buildings.filter((b) => out(b.x, b.y)).reduce((n, b) => n + (b.store as any)[g], 0))]))));
