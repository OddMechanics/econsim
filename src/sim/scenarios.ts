// "What if…" events. Each scenario is a small piece of code that changes the
// world while it's active. To try one, add it to ACTIVE_AT_START (or ask
// Claude to write a new one, e.g. a plague, a gold rush or a crash).

import { dayOf, log, type Ctx } from './ctx';
import type { ScenarioState } from './types';

export type YieldKind = 'farm' | 'forage' | 'fish' | 'wood' | 'stone' | 'clay' | 'ore';

export interface Scenario {
  id: string;
  name: string;
  description: string;
  yieldMultiplier?(state: ScenarioState, kind: YieldKind): number;
  /** Runs once per game day while active. Return false to end it. */
  daily?(ctx: Ctx, state: ScenarioState): boolean;
}

export const SCENARIOS: Record<string, Scenario> = {
  famine: {
    id: 'famine',
    name: 'Famine',
    description: 'For 20 days farms, foraging and fishing produce only 30% of normal.',
    yieldMultiplier: (_s, kind) => (kind === 'farm' || kind === 'forage' || kind === 'fish' ? 0.3 : 1),
    daily: (ctx, st) => dayOf(ctx.s.tick) - st.startDay < 20,
  },
};

/** Scenarios that switch on automatically, e.g. [{ id: 'famine', day: 30 }]. */
export const ACTIVE_AT_START: { id: string; day: number }[] = [];

export function yieldMultiplier(ctx: Ctx, kind: YieldKind): number {
  let m = 1;
  for (const st of ctx.s.scenarios) {
    const sc = SCENARIOS[st.id];
    if (sc?.yieldMultiplier) m *= sc.yieldMultiplier(st, kind);
  }
  return m;
}

export function scenariosDaily(ctx: Ctx): void {
  const day = dayOf(ctx.s.tick);
  for (const plan of ACTIVE_AT_START) {
    if (plan.day === day && SCENARIOS[plan.id] && !ctx.s.scenarios.some((s) => s.id === plan.id)) {
      ctx.s.scenarios.push({ id: plan.id, startDay: day, data: {} });
      log(ctx, 'event', `${SCENARIOS[plan.id].name} begins: ${SCENARIOS[plan.id].description}`);
    }
  }
  ctx.s.scenarios = ctx.s.scenarios.filter((st) => {
    const sc = SCENARIOS[st.id];
    const keep = sc?.daily ? sc.daily(ctx, st) : true;
    if (!keep) log(ctx, 'event', `${sc?.name ?? st.id} is over.`);
    return keep;
  });
}
