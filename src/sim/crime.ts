// Crime and policing. Desperate people (hungry, broke, out of work) are
// sometimes tempted to steal: shoplifting food from a store, or picking a
// pocket. Whether they do depends on who they are (agreeable and diligent
// people mostly don't). Whether they get caught depends on how many police
// officers are around. Caught thieves spend a night in a cell at city hall
// (and are fed there). Crime shows up in the news, makes people feel less
// safe (less accepting of a government that can't keep order), and pushes
// councils toward hiring more police.

import { MINUTES_PER_DAY } from './config';
import { addCash, log, type Ctx } from './ctx';
import { govSite, polityAt } from './government';
import { shock } from './ideology';
import { grievance } from './social';
import { leaveSeat, setTask, takeSeat } from './tasks';
import type { Person, Polity } from './types';

/** Officers on duty within a radius of a point (they're out on patrol). */
function policeNear(ctx: Ctx, g: Polity | undefined, x: number, y: number, r: number): number {
  if (!g) return 0;
  let n = 0;
  for (const c of ctx.s.contracts) {
    if (c.firm !== g.firm || c.role !== 'officer') continue;
    const p = ctx.byId.get(c.person);
    if (p && p.task?.steps[p.task.i]?.k === 'work' && Math.hypot(p.x - x, p.y - y) < r) n++;
  }
  return n;
}

/** Crimes in a government's territory over the last week (kept in its data). */
export function crimeRate(g: Polity): number {
  return g.data?.crimes ?? 0;
}

function noteCrime(g: Polity | undefined): void {
  if (!g) return;
  g.data ??= {};
  g.data.crimes = (g.data.crimes ?? 0) + 1;
}

/** Daily: the week's crime count decays (a rolling week). */
export function crimeDaily(ctx: Ctx): void {
  for (const g of ctx.s.polities) if (g.data?.crimes) g.data.crimes *= 6 / 7;
}

/**
 * Hourly, for someone desperate: maybe steal. Returns true if they tried
 * (so the caller doesn't also make them leave the city this hour).
 */
export function maybeSteal(ctx: Ctx, p: Person): boolean {
  if (p.task?.label.startsWith('In a cell')) return false;
  const t = p.traits;
  const temptation = 0.05 * (1 - t.agreeable) * (1.2 - t.diligence) * (0.5 + t.risk);
  if (!ctx.rng.chance(temptation)) return false;
  const g = polityAt(ctx, p.x, p.y);
  // a store nearby with food on the shelves, or someone with money in their pocket
  const store = ctx.s.buildings.find((b) => b.kind === 'store' && b.built && !b.ruined && b.store.groceries >= 2 && Math.hypot(b.x - p.x, b.y - p.y) < 250);
  const mark = ctx.s.people.find((q) => q !== p && q.inside < 0 && q.money > 30 && Math.hypot(q.x - p.x, q.y - p.y) < 40);
  if (!store && !mark) return false;
  const odds = Math.min(0.9, 0.12 + 0.3 * policeNear(ctx, g, p.x, p.y, 160));
  const caught = ctx.rng.chance(odds);
  noteCrime(g);
  if (store) {
    const firm = ctx.fById.get(store.firm);
    if (caught) {
      log(ctx, 'event', `${p.name} was caught shoplifting at ${firm?.name ?? 'a store'} and arrested.`, { who: p.id, bid: store.id });
      jail(ctx, p, g);
    } else {
      store.store.groceries -= 2;
      p.inv.groceries += 2;
      log(ctx, 'event', `Someone stole groceries from ${firm?.name ?? 'a store'}.`, { bid: store.id });
      const owner = ctx.byId.get(firm?.owner ?? -1);
      if (owner) shock(owner, 'order', 0.15);
    }
  } else if (mark) {
    const amount = Math.min(mark.money * 0.3, 15);
    if (caught) {
      log(ctx, 'event', `${p.name} tried to pick ${mark.name}'s pocket and was arrested.`, { who: p.id });
      grievance(mark, p, 1);
      jail(ctx, p, g);
    } else {
      addCash(ctx, mark.id, -amount);
      addCash(ctx, p.id, amount);
      log(ctx, 'event', `${mark.name} had ${amount.toFixed(0)} stolen from their pocket.`, { who: mark.id });
      shock(mark, 'order', 0.3);
      mark.pol.rec[g?.id ?? -1] = Math.max(0, (mark.pol.rec[g?.id ?? -1] ?? 0.6) - 0.03);
    }
  }
  return true;
}

/** A night (24 hours) in a cell at city hall (or the trading post's back room before there is one). */
function jail(ctx: Ctx, p: Person, g: Polity | undefined): void {
  const site = g ? govSite(ctx, g) : undefined;
  if (!site || !site.built) return;
  leaveSeat(ctx, p);
  p.driving = -1;
  p.path = [];
  p.inside = site.id;
  takeSeat(ctx, p, site, -1);
  p.x = p.px = site.x;
  p.y = p.py = site.y;
  p.needs.food = Math.max(p.needs.food, 55); // they feed you in jail
  setTask(ctx, p, 'In a cell at city hall', [{ k: 'idle', mins: MINUTES_PER_DAY, label: 'in a cell at city hall', pose: 'sit' }]);
  p.pol.grievance = Math.min(3, p.pol.grievance + 0.3);
  if (g) p.pol.rec[g.id] = Math.max(0, (p.pol.rec[g.id] ?? 0.6) - 0.1);
}
