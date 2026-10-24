// Diagnostics: what people do, who died of what, which firms exist.
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { BUILDINGS } from '../src/sim/goods';
const days = Number(process.argv[2] ?? 10);
const sim = new Simulation(createState(Number(process.argv[3] ?? 12345)));
const none: Record<string, number> = {};
const time: Record<string, number> = {};
for (let i = 0; i < days * MINUTES_PER_DAY; i++) {
  sim.step();
  if (i % 30 === 0) for (const p of sim.state.people) {
    const k = (p.task?.label ?? 'NONE').replace(/\d+(\.\d+)?/g, 'N').replace(/ at .*/, '').slice(0, 34);
    time[k] = (time[k] ?? 0) + 0.5;
    if (!p.task) { const d = p.decision?.chosen ?? '?'; none[d] = (none[d] ?? 0) + 1; }
  }
}
const s = sim.state;
console.log('TIME (person-hours):', Object.entries(time).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}=${v}`).join(' | '));
console.log('\nNO-TASK after decision:', JSON.stringify(none));
console.log('\nDEAD:', s.dead.map((d) => `${d.name}:${d.cause}@d${Math.floor(d.died / 1440)}`).join(', '));
console.log('\nFIRMS:', s.firms.map((f) => `${f.name}[${f.kind}${f.closed ? ' CLOSED' : ''}] cash=${f.cash.toFixed(0)} sites=${f.sites.map((id) => { const b = sim.ctx.bById.get(id); return b ? (b.built ? 'B' : `u${Math.round(b.workDone / b.workNeeded * 100)}%`) : 'x'; }).join(',')} staff=${s.contracts.filter((c) => c.firm === f.id).length}`).join('\n  '));
console.log('\nUNBUILT:', s.buildings.filter((b) => !b.built && !b.ruined).map((b) => `${BUILDINGS[b.kind].label}(${Math.round(b.workDone / b.workNeeded * 100)}% needs ${Object.entries(b.needed).filter(([, q]) => q > 0).map(([g, q]) => g + ':' + Math.ceil(q)).join(',')}${b.builder >= 0 ? ' contractor' : ''})`).join('; '));
console.log('\nSHIPMENTS:', s.shipments.slice(0, 15).map((sh) => `${sim.ctx.bById.get(sh.from)?.kind}->${sim.ctx.bById.get(sh.to)?.kind} ${Object.entries(sh.goods).filter(([, q]) => q > 0).map(([g, q]) => g + ':' + q.toFixed(0)).join(',')} ${sh.status} age=${((s.tick - sh.created) / 60).toFixed(0)}h`).join('\n  '));
console.log('\nORDERS:', s.market.orders.map((o) => `${o.side} ${o.good} ${o.qty.toFixed(0)}@${o.price.toFixed(2)}`).join(', '));
