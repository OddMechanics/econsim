// Tower demand and a rich developer's options at day N.
import { createState, Simulation } from '../src/sim/sim';
import { devCost, planDevelopment, residentialDemand, towerDemand } from '../src/sim/development';
import { referenceWage } from '../src/sim/government';
import { lotsForSale } from '../src/sim/roads';
import { redevelopPrice } from '../src/sim/development';
const sim = new Simulation(createState(Number(process.argv[3] ?? 4)));
for (let i = 0; i < Number(process.argv[2] ?? 130) * 1440; i++) sim.step();
const ctx = sim.ctx, s = sim.state;
console.log('pop', s.people.length, 'towerDemand', towerDemand(ctx).toFixed(0), 'resDemand', residentialDemand(ctx).toFixed(0), 'refWage', referenceWage(ctx).toFixed(1));
const core = s.roads.lots.filter((l) => l.zone === 'core');
console.log('core lots', core.length, 'forSale fitting', lotsForSale(ctx, ['core']).filter((l) => l.w >= 19 && l.d >= 20).length, 'redevelopable', core.filter((l) => l.building >= 0 && l.w >= 19 && l.d >= 20 && redevelopPrice(ctx, l) !== null).length, 'lot sizes', [...new Set(core.map((l) => `${l.w.toFixed(0)}x${l.d.toFixed(0)}`))].slice(0, 6).join(' '));
for (const F of [10, 20, 30]) console.log('tower', F, devCost(ctx, 'tower', F).toFixed(0));
const rich = [...s.people].sort((a, b) => b.money - a.money).slice(0, 3);
for (const p of rich) { const pl = planDevelopment(ctx, p.id, p.money, 5000); console.log(p.name, p.money.toFixed(0), pl ? `${pl.kind} ${pl.floors}F cost ${pl.cost.toFixed(0)} ${pl.why}` : 'no plan'); }
const pl = planDevelopment(ctx, -999, 50000, 50000); console.log('mega investor:', pl ? `${pl.kind} ${pl.floors}F cost ${pl.cost.toFixed(0)} ${pl.why}` : 'no plan');
import { yardFirms } from '../src/sim/construction';
import { maxFloorsAt } from '../src/sim/tasks';
import { vacancies } from '../src/sim/housing';
console.log('crews', yardFirms(ctx).map((y) => `${y.name}:${s.contracts.filter((c) => c.firm === y.id && c.role === 'builder').length}`).join(' '), 'height limit at center', maxFloorsAt(ctx, s.center.x, s.center.y), 'policy', s.polities.map((g) => g.policy.maxFloors).join(','));
const vac = vacancies(ctx);
const byB = new Map<number, number>(); for (const v of vac) byB.set(v.b.id, (byB.get(v.b.id) ?? 0) + 1);
console.log('vacant flats', vac.length, 'in', byB.size, 'buildings; rents', vac.slice(0, 8).map((v) => v.rent.toFixed(1)).join(','), 'renters', s.people.filter((p) => { const h = ctx.bById.get(p.home); return h && (h.kind === 'apartments' || h.kind === 'tower'); }).length);
console.log('towers', s.buildings.filter((b) => b.kind === 'tower' || b.kind === 'officetower').map((b) => `${b.kind}:${b.floors}F${b.built ? '' : `(${Math.round(b.workDone / b.workNeeded * 100)}%${b.builder === -2 ? ' WAIT' : ''})`}`).join(' ') || 'none');
console.log(s.log.filter((l) => /tower|tear it down/.test(l.text)).slice(-6).map((l) => l.text).join('\n'));
