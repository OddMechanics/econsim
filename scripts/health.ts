// How health plays out: illnesses, doctor visits, hospital stays, clinics and hospitals, deaths.
// usage: tsx scripts/health.ts <days> <seed>
import { createState, Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY } from '../src/sim/config';
const days = Number(process.argv[2] ?? 30), seed = Number(process.argv[3] ?? 4);
const sim = new Simulation(createState(seed));
sim.stride = 15;
const s = sim.state;
console.log('healthcare policy:', s.polities.map((g) => `${g.short}: ${g.policy.healthcare}`).join(', '));
for (let d = 1; d <= days; d++) {
  for (let m = 0; m < MINUTES_PER_DAY; m++) sim.step();
  if (d % 5) continue;
  const kinds: Record<string, number> = {};
  for (const p of s.people) if (p.ill) kinds[p.ill.kind] = (kinds[p.ill.kind] ?? 0) + 1;
  const places = s.buildings.filter((b) => b.kind === 'clinic' || b.kind === 'hospital').map((b) => `${b.kind}${b.built ? '' : '(building)'}:${s.firms.find((f) => f.id === b.firm)?.name ?? '?'}`);
  const today = s.daily?.at(-1);
  const doctors = s.contracts.filter((c) => c.role === 'doctor').length, nurses = s.contracts.filter((c) => c.role === 'nurse').length;
  const causes: Record<string, number> = {};
  for (const x of s.dead) causes[x.cause] = (causes[x.cause] ?? 0) + 1;
  console.log(`day ${d}: pop ${s.people.length} ill ${JSON.stringify(kinds)} in bed ${today?.patients} | visits so far ${s.today?.['health:visit'] ?? '-'} | doctors ${doctors} nurses ${nurses} | ${places.join(', ') || 'no clinics'} | dead ${JSON.stringify(causes)}`);
}
console.log('policy now:', s.polities.map((g) => `${g.short}: ${g.policy.healthcare}`).join(', '));
console.log('health log:', s.log.filter((l) => l.kind === 'health').slice(-12).map((l) => l.text).join('\n  '));
for (const d of s.dead) {
  const lines = s.log.filter((l) => l.text.includes(d.name)).slice(-8).map((l) => `  [${(l.t / 1440).toFixed(2)}] ${l.text}`);
  console.log(`DEAD ${d.name} (${d.cause}):\n${lines.join('\n')}`);
}
console.log('ambulance trips:', s.log.filter((l) => l.text.includes('ambulance')).length);
