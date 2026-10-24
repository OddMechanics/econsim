// What limits growth: arrivals, departures, job postings vs open positions, the arrival formula's parts.
// `tsx scripts/growth.ts <seed> <days> [every]`
import { POPULATION } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
const [seed, days, every] = [Number(process.argv[2] ?? 4), Number(process.argv[3] ?? 80), Number(process.argv[4] ?? 10)];
const sim = new Simulation(createState(seed));
const s = sim.state;
let lastArr = 0, lastLeft = 0;
const count = (re: RegExp) => s.log.filter((l) => re.test(l.text)).length;
let arr = 0, left = 0;
for (let d = 1; d <= days; d++) {
  for (let m = 0; m < 1440; m++) sim.step();
  arr = s.counters.arrivals ?? arr; left = s.counters.emigrated ?? left;
  if (d % every) continue;
  const pop = s.people.length;
  const fed = s.people.filter((p) => p.needs.food > 40).length / pop;
  const jobless = s.people.filter((p) => p.job < 0 && !p.firms.length).length / pop;
  const prospects = Math.max(0.15, Math.min(1.3, 1.3 - 2 * jobless));
  const openings = s.postings.reduce((n, x) => n + (x.openings ?? 1), 0);
  const most = POPULATION.arrivalMax + Math.floor(pop / 40);
  const expected = (POPULATION.arrivalBase + POPULATION.arrivalPerOpening * Math.min(most, s.postings.length)) * (0.4 + 0.6 * fed) * prospects;
  const vacantFlats = s.buildings.reduce((n, b) => n + (b.units ?? []).filter((u) => u.tenant < 0).length, 0);
  console.log(`day ${d}: pop ${pop}; employers hiring ${s.postings.length}, open positions ${openings}; jobless ${(jobless * 100).toFixed(0)}% → prospects ${prospects.toFixed(2)}; fed ${(fed * 100).toFixed(0)}%; expected arrivals/day ${expected.toFixed(1)} (cap ${most}); vacant flats ${vacantFlats}; arrived ${(s.counters.arrivals ?? 0) - lastArr}, left ${(s.counters.emigrated ?? 0) - lastLeft} in ${every} days`);
  lastArr = s.counters.arrivals ?? 0; lastLeft = s.counters.emigrated ?? 0;
}
void count; void arr; void left;
