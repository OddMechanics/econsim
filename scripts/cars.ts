// Why no cars? Follow the steel -> car factory -> dealer chain.
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
const sim = new Simulation(createState(Number(process.argv[3] ?? 12345)));
for (let i = 0; i < Number(process.argv[2] ?? 80) * MINUTES_PER_DAY; i++) sim.step();
const s = sim.state, ctx = sim.ctx;
for (const kind of ['mine', 'steelmill', 'carplant', 'dealer'] as const) {
  for (const b of s.buildings.filter((b) => b.kind === kind)) {
    const f = ctx.fById.get(b.firm);
    const st = Object.entries(b.store).filter(([, q]) => q >= 0.5).map(([g, q]) => `${g}:${q.toFixed(1)}`).join(',');
    console.log(`${kind} built=${b.built} ${Math.round(b.workDone / b.workNeeded * 100)}% needs=${Object.entries(b.needed).filter(([, q]) => q > 0).map(([g, q]) => g + ':' + q.toFixed(0)).join(',')} firm=${f?.name} cash=${f?.cash.toFixed(0)} staff=${s.contracts.filter((c) => c.site === b.id).length} store=${st} price=${JSON.stringify(f?.prices)}`);
  }
}
const ord = (g: string) => s.market.orders.filter((o) => o.good === g).map((o) => `${o.side}${o.qty.toFixed(0)}@${o.price.toFixed(1)}`).join(' ');
console.log('steel orders:', ord('steel'), '| ore orders:', ord('ore'), '| car orders:', ord('cars'));
console.log('last prices', JSON.stringify(s.market.last));
console.log('dead causes', JSON.stringify(s.dead.reduce((a: Record<string, number>, d) => { a[d.cause] = (a[d.cause] ?? 0) + 1; return a; }, {})));
