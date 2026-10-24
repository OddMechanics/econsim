// Count ads by kind and sponsor type, and who forages/sells at the trading post.
// `./node_modules/.bin/tsx scripts/adcensus.ts <days> <seed>`
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { BUILDINGS } from '../src/sim/goods';

const days = Number(process.argv[2] ?? 90);
const seed = Number(process.argv[3] ?? 4);
const sim = new Simulation(createState(seed));
const labels: Record<string, number> = {};
for (let d = 0; d < days; d++) {
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    sim.step();
    if (m % 60 === 0 && d >= days - 10) for (const p of sim.state.people) {
      const k = (p.task?.label ?? '-').replace(/\d+(\.\d+)?/g, 'N').slice(0, 36);
      labels[k] = (labels[k] ?? 0) + 1;
    }
  }
}
const s = sim.state, ctx = sim.ctx;
const byKind: Record<string, number> = {};
const bySponsor: Record<string, number> = {};
for (const a of s.ads) {
  byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  const f = ctx.fById.get(a.sponsor);
  const k = f ? `${BUILDINGS[f.kind].service ?? f.kind}` : ctx.byId.has(a.sponsor) ? 'person/campaign' : 'other';
  bySponsor[`${a.kind}:${k}`] = (bySponsor[`${a.kind}:${k}`] ?? 0) + 1;
}
console.log(`day ${days} pop ${s.people.length} firms ${s.firms.filter((f) => !f.closed).length} ads ${s.ads.length}`, byKind);
console.log(bySponsor);
const budgets = s.firms.filter((f) => !f.closed && f.adBudget !== undefined).map((f) => f.adBudget!).sort((a, b) => a - b);
console.log('ad budgets: n', budgets.length, 'median', budgets[budgets.length >> 1]?.toFixed(1), 'max', budgets[budgets.length - 1]?.toFixed(1), '>6:', budgets.filter((b) => b > 6).length);
const floors: Record<number, number> = {};
for (const b of s.buildings) if (b.built && !b.ruined) floors[b.floors] = (floors[b.floors] ?? 0) + 1;
console.log('floors histogram', floors);
console.log('activity samples (last 10 days, hourly):');
console.log(Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${n} ${k}`).join('\n'));
// richest people and what they did
const rich = [...s.people].sort((a, b) => b.money - a.money).slice(0, 10);
for (const p of rich) console.log(`${p.name} money ${p.money.toFixed(0)} firms ${p.firms.length} job ${p.job} task ${p.task?.label}`);
