import type { SimState } from './types';

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
  return s;
}
