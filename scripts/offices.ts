// Why aren't the office floors full? Consulting firms: staff, desks, billing, profit, the export cap.
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { slotsFor } from '../src/sim/goods';
import { staffAt } from '../src/sim/jobs';
import { serviceDemand } from '../src/sim/production';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
for (let i = 0; i < Number(process.argv[3] ?? 0) * 1440; i++) sim.step();
while (sim.state.tick % 1440 !== 11 * 60) sim.step();
const s = sim.state, ctx = sim.ctx;
const d = s.data ?? {};
console.log(`pop ${s.people.length}; office work billed today ${(d.svcToday ?? 0).toFixed(0)}; at full price so far: software ${(d.svcFullSoft ?? 0).toFixed(0)} (rate ×${(d.svcMultSoft ?? 1).toFixed(2)}), professional ${(d.svcFullPro ?? 0).toFixed(0)} (rate ×${(d.svcMultPro ?? 1).toFixed(2)}); demand per market ${serviceDemand(ctx)}; unemployed ${s.people.filter((p) => p.job < 0 && !p.firms.length).length}; with 14+ years of school & no job ${s.people.filter((p) => p.job < 0 && !p.firms.length && p.edu >= 14).length}`);
const firms = s.firms.filter((f) => f.kind === 'office' && !f.closed);
let desks = 0, staff = 0;
const rows = firms.map((f) => {
  const sites = f.sites.map((id) => ctx.bById.get(id)!).filter(Boolean);
  const dk = sites.reduce((a, b) => a + slotsFor(b.kind, b.floors, b.w, b.d).reduce((n, j) => n + j.slots, 0), 0);
  const st = sites.reduce((a, b) => a + staffAt(ctx, b.id).length, 0);
  desks += dk; staff += st;
  const posts = s.postings.filter((p) => p.firm === f.id).map((p) => `${p.role}x${p.openings ?? 1}@${p.wage.toFixed(0)}`).join(',');
  return `${f.name.padEnd(24)} staff ${String(st).padStart(2)}/${dk} cash ${f.cash.toFixed(0).padStart(6)} last5 ${f.ledger.days.slice(-5).map((x) => x.toFixed(0)).join(',')} posts ${posts || '-'}`;
});
console.log(`${firms.length} consulting firms, staff ${staff} of ${desks} desks`);
console.log(rows.slice(0, 25).join('\n'));
const billers = s.firms.filter((f) => (f.sales.billed ?? 0) > 0).sort((a, b) => (b.sales.billed ?? 0) - (a.sales.billed ?? 0));
const byKind: Record<string, { n: number; billed: number; staff: number }> = {};
for (const f of billers) { const k = f.kind; const e = (byKind[k] ??= { n: 0, billed: 0, staff: 0 }); e.n++; e.billed += f.sales.billed ?? 0; e.staff += f.sites.reduce((a, id) => a + staffAt(ctx, id).length, 0); }
console.log('billing by kind (since founding):', JSON.stringify(byKind));
console.log(billers.slice(0, 8).map((f) => `${f.name} (${f.kind}) billed ${(f.sales.billed ?? 0).toFixed(0)} staff ${f.sites.reduce((a, id) => a + staffAt(ctx, id).length, 0)} cash ${f.cash.toFixed(0)}`).join('\n'));
const roles: Record<string, number> = {};
for (const c of s.contracts) roles[c.role] = (roles[c.role] ?? 0) + 1;
console.log('jobs by role:', JSON.stringify(roles));
