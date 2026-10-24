// How full are the big buildings? Flats lived in, office floors leased, people working there (from a save).
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/sim';
import { deserialize } from '../src/sim/save';
import { stationsOf } from '../src/sim/layout';
const sim = new Simulation(deserialize(readFileSync(process.argv[2], 'utf8')));
for (let i = 0; i < Number(process.argv[3] ?? 0) * 1440; i++) sim.step();
const s = sim.state, ctx = sim.ctx;
let flats = 0, lived = 0, floors = 0, leased = 0, desks = 0, staff = 0, present = 0;
// at 11:00 on a weekday: who's at work in the towers
while (s.tick % 1440 !== 11 * 60) sim.step();
for (const t of s.buildings.filter((b) => (b.kind === 'tower' || b.kind === 'officetower') && b.built && !b.ruined)) {
  const units = (t.hosted ?? []).map((id) => ctx.bById.get(id)!).filter(Boolean);
  const occ = t.units.filter((u) => u.tenant >= 0).length;
  flats += t.units.length; lived += occ;
  const suites = units.filter((u) => (u.level ?? 0) > 0);
  const rows = suites.map((u) => {
    const st = s.contracts.filter((c) => c.site === u.id).length;
    const d = stationsOf(u).filter((x) => x.role).length;
    const here = s.people.filter((p) => p.inside === u.id).length;
    floors++; if (u.firm >= 0) leased++; desks += d; staff += st; present += here;
    return `${u.kind}:${st}/${d}`;
  });
  const shops = units.filter((u) => (u.level ?? 0) === 0).map((u) => `${u.kind}:${s.contracts.filter((c) => c.site === u.id).length}`);
  console.log(`${t.kind} ${t.floors}F flats ${occ}/${t.units.length} shops [${shops.join(' ')}] ${rows.length ? `offices (staff/desks) ${rows.slice(0, 12).join(' ')}${rows.length > 12 ? ' …' : ''}` : ''}`);
}
console.log(`\npop ${s.people.length}; tower flats lived in ${lived}/${flats}; office floors leased ${leased}/${floors}; office desks ${desks}, staff ${staff}, at work right now ${present}`);
const firmsInSuites = s.buildings.filter((u) => u.host !== undefined && (u.level ?? 0) > 0 && u.firm >= 0).map((u) => ctx.fById.get(u.firm)!);
console.log('companies on office floors by kind:', Object.entries(firmsInSuites.reduce((m: Record<string, number>, f) => { m[f.kind] = (m[f.kind] ?? 0) + 1; return m; }, {})));
