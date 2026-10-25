// Leased shops and office floors: staff on the books vs people actually there at 11:00.
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
const s = sim.state, ctx = sim.ctx;
while (s.tick % 1440 !== 11 * 60) sim.step();
const inside = new Map<number, number>();
for (const p of s.people) if (p.inside >= 0) inside.set(p.inside, (inside.get(p.inside) ?? 0) + 1);
const staff = new Map<number, number>();
for (const c of s.contracts) staff.set(c.site, (staff.get(c.site) ?? 0) + 1);
const byKind = new Map<string, { units: number; staffed: number; staff: number; present: number; zeroStaff: string[] }>();
for (const b of s.buildings) {
  if (b.host === undefined || b.firm < 0) continue;
  const e = byKind.get(b.kind) ?? { units: 0, staffed: 0, staff: 0, present: 0, zeroStaff: [] };
  e.units++;
  const st = staff.get(b.id) ?? 0;
  if (st) e.staffed++; else e.zeroStaff.push(ctx.fById.get(b.firm)?.name ?? '?');
  e.staff += st;
  e.present += inside.get(b.id) ?? 0;
  byKind.set(b.kind, e);
}
for (const [k, e] of byKind) console.log(`${k.padEnd(12)} units ${e.units} with staff ${e.staffed} · staff ${e.staff} · inside now ${e.present} · no staff: ${e.zeroStaff.slice(0, 6).join(', ')}`);
// the same for buildings companies own
let own = 0, ownStaff = 0, ownPresent = 0;
for (const b of s.buildings) { if (b.host !== undefined || b.firm < 0 || !b.built) continue; own++; ownStaff += staff.get(b.id) ?? 0; ownPresent += inside.get(b.id) ?? 0; }
console.log(`own buildings: ${own} · staff ${ownStaff} · inside now ${ownPresent}`);
