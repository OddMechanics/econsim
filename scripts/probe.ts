// Probe: who has no task, who is homeless and why, at a given day.
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
import { vacancies } from '../src/sim/housing';
const days = Number(process.argv[2] ?? 40);
const sim = new Simulation(createState(Number(process.argv[3] ?? 12345)));
const at = Number(process.argv[4] ?? 13 * 60); for (let i = 0; i < days * MINUTES_PER_DAY + at; i++) sim.step();
const s = sim.state;
const none = s.people.filter((p) => !p.task);
console.log(`at day ${days} +${at}min: ${none.length} without task`); for (const p of none.slice(0, 5)) console.log("   ", p.name, "energy", p.needs.energy.toFixed(0), "food", p.needs.food.toFixed(0), "inside", p.inside, "home", p.home, "dec@", p.decision?.t, "now", s.tick, "chosen", p.decision?.chosen, "opts", p.decision?.options.map((o) => o.label + "=" + o.score.toFixed(1)).join("; "));
const why: Record<string, number> = {};
for (const p of none) { const k = (p.decision?.chosen ?? '?').replace(/\d+/g, 'N'); why[k] = (why[k] ?? 0) + 1; }
console.log(why);
const homeless = s.people.filter((p) => p.home < 0);
console.log(`homeless ${homeless.length}; vacancies ${vacancies(sim.ctx).length}; avg money of homeless ${(homeless.reduce((a, p) => a + p.money, 0) / Math.max(1, homeless.length)).toFixed(0)}`);
for (const p of homeless.slice(0, 6)) console.log(`  ${p.name} $${p.money.toFixed(0)} job ${p.job >= 0} arrived d${Math.floor(p.arrived / 1440)} task "${p.task?.label}" top: ${p.decision?.options.slice(0, 4).map((o) => o.label + '=' + o.score.toFixed(1)).join(', ')}`);
const quits = s.log.filter((e) => e.kind === 'job' && /quit|notice/.test(e.text)).slice(-6).map((e) => e.text);
console.log('recent quits:', quits);
