import { OUTSIDE } from './config';
import { GOOD } from './goods';
import { GOODS, type Good, type SimState } from './types';

/**
 * Bump when the shape of SimState changes so old autosaves are not loaded
 * into code that doesn't understand them (a fresh world starts instead).
 */
export const SAVE_FORMAT = 4;

export function serialize(state: SimState): string {
  return JSON.stringify({ format: SAVE_FORMAT, state });
}

export function deserialize(json: string): SimState {
  const data = JSON.parse(json) as { format?: number; state?: SimState };
  const s = data?.state;
  if (data?.format !== SAVE_FORMAT || !s || !Array.isArray(s.people) || !s.world || !s.roads) {
    throw new Error("This save is from an older or different version of the simulation and can't be loaded.");
  }
  upgrade(s);
  return s;
}

/**
 * Bring a save from an earlier build up to date without a format change:
 * goods added since (bread, dairy, meat, fruit & vegetables, milk, livestock)
 * get their place in every inventory, price belief and market record.
 */
function upgrade(s: SimState): void {
  const fill = (rec: Record<string, number> | undefined) => { if (rec) for (const g of GOODS) if (rec[g] === undefined) rec[g] = 0; };
  const guess = (g: Good) => OUTSIDE.prices[g] ?? GOOD[g].laborGuess * 2;
  for (const p of s.people) {
    fill(p.inv); fill(p.pantry); fill(p.demandSeen); fill(p.supplySeen); fill(p.bidSeen);
    for (const g of GOODS) if (!p.prices[g]) p.prices[g] = { p: guess(g), t: -1, src: 'guess' };
  }
  for (const b of s.buildings) { fill(b.store); fill(b.needed); }
  for (const sh of s.shipments) fill(sh.goods);
  for (const v of s.vehicles) fill(v.cargo);
  fill(s.market.last);
  for (const g of GOODS) if (!s.market.day[g]) s.market.day[g] = { q: 0, v: 0 };
}
