// Death causes and circumstances across seeds.
import { MINUTES_PER_DAY } from '../src/sim/config';
import { createState, Simulation } from '../src/sim/sim';
const days = Number(process.argv[2] ?? 40);
for (const seed of process.argv.slice(3).map(Number)) {
  const sim = new Simulation(createState(seed));
  const notes: string[] = [];
  for (let i = 0; i < days * MINUTES_PER_DAY; i++) {
    // watch people who are about to die
    if (i % 60 === 0) for (const p of sim.state.people) if (p.needs.health < 8 && !notes.some((n) => n.startsWith(p.name))) {
      notes.push(`${p.name}: food ${p.needs.food.toFixed(0)} money ${p.money.toFixed(0)} home ${p.home >= 0 ? sim.ctx.bById.get(p.home)?.kind : 'none'} job ${p.job >= 0} firms ${p.firms.length} pantry ${(p.pantry.groceries).toFixed(0)} inv ${(p.inv.groceries).toFixed(0)} task "${p.task?.label}" day ${Math.floor(i / 1440)} h${Math.floor(i % 1440 / 60)}`);
    }
    sim.step();
  }
  const causes: Record<string, number> = {};
  for (const d of sim.state.dead) causes[d.cause] = (causes[d.cause] ?? 0) + 1;
  console.log(`seed ${seed}: pop ${sim.state.people.length} dead ${sim.state.dead.length}`, causes);
  for (const n of notes.slice(0, 20)) console.log('   ', n);
}
