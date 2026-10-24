// Stores in a fresh world at a given minute: open? staffed? stocked?
import { createState, Simulation } from '../src/sim/sim';
import { formatTime, hourOf } from '../src/sim/ctx';
import { BUILDINGS } from '../src/sim/goods';
import { hasStaff, staffAt } from '../src/sim/jobs';
import { staffPresent } from '../src/sim/tasks';
const [seed, at, n, every] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] ?? 1), Number(process.argv[5] ?? 60)];
const sim = new Simulation(createState(seed));
for (let i = 0; i < at; i++) sim.step();
for (let k = 0; k < n; k++) {
  for (let i = 0; i < every; i++) sim.step();
  const ctx = sim.ctx, s = sim.state;
  console.log(formatTime(s.tick), 'pop', s.people.length, 'homeless', s.people.filter((p) => p.home < 0).length, 'hungry(<30)', s.people.filter((p) => p.needs.food < 30).length);
  for (const b of s.buildings.filter((b) => b.kind === 'store' || b.kind === 'restaurant')) {
    const f = ctx.fById.get(b.firm);
    const h = hourOf(s.tick), [o, c] = BUILDINGS[b.kind].hours;
    console.log('  ', b.kind, f?.name, 'built', b.built, `hours ${o}-${c}`, 'openNow', h >= o && h < c - 1, 'present', staffPresent(ctx, b.id), 'hasStaff', hasStaff(ctx, b.id), 'filter', s.contracts.filter((x) => x.site === b.id).length, 'staffAt', staffAt(ctx, b.id).length, 'groceries', b.store.groceries.toFixed(1), 'cash', f?.cash.toFixed(0));
  }
}
{
  const ctx = sim.ctx, s = sim.state;
  const qs = s.buildings.find((b) => b.kind === 'store')!;
  const f = ctx.fById.get(qs.firm)!;
  console.log('QuickStop firm', f.id, 'site', qs.id, 'orders/shipments to it:');
  for (const sh of s.shipments.filter((x) => x.to === qs.id)) console.log('  ', JSON.stringify({ id: sh.id, from: sh.from, to: sh.to, status: sh.status, carrier: sh.carrier, created: sh.created, after: sh.after, goods: Object.fromEntries(Object.entries(sh.goods).filter(([, q]) => (q as number) > 0)) }));
  console.log('vehicles', s.vehicles.map((v) => `${v.id}:${v.kind}:${v.owner}:drv${v.driver}:path${v.path.length}:${v.x.toFixed(0)},${v.y.toFixed(0)}`).join(' '));
  console.log('market bids/asks groceries', JSON.stringify((s as any).market?.groceries ?? Object.keys(s).filter((k) => /market|book|order/i.test(k))));
}
