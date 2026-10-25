// Where things go on a countryside farm (shared by the farm buildings in
// farms.ts and the fields in fields.ts).
//
// A farm on one of the countryside's big field lots (170-300 x 220-400 m)
// stands in a farmyard at the front of its lot, by the lane: the building,
// sheds, silos, the tractor. The crops or the pasture fill the rest of the
// lot and are drawn by the field renderer, laid on the ground's surface.

import type { BuildingKind } from '../sim/types';

export const FARM_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['farm', 'vegfarm', 'dairyfarm', 'ranch']);

/** The farmyard: from the lot's front edge to this far behind the building, and this far to each side of it (m). */
export const YARD = { behind: 16, side: 17 };

/** Is a lot this size a field lot (with a farmyard), rather than a farm on a city-sized rural lot? */
export function isFieldLot(lotW: number, lotD: number): boolean {
  return lotW > 90 && lotD > 90;
}

/**
 * The farmyard in the building's local frame (front = +z): x from -hw to hw,
 * z from z0 (behind) to z1 (the lot's front edge). `lotZ` is the lot center's
 * local z (negative: behind the building).
 */
export function yardRect(bw: number, bd: number, lotD: number, lotZ: number): { hw: number; z0: number; z1: number } {
  return { hw: bw / 2 + YARD.side, z0: -bd / 2 - YARD.behind, z1: lotZ + lotD / 2 };
}

/**
 * Is a building's lot ground drawn by the field renderer (laid on the
 * unleveled countryside ground) instead of as a flat slab? Every building on
 * a lot outside the city's grid (the sim only levels lots on the grid).
 */
export function drapedLot(_kind: BuildingKind, _lotW: number, _lotD: number, outside: boolean): boolean {
  return outside;
}

/**
 * Is a draped building also bent to meet the ground (settle.ts)? All but the
 * standing farmyards and farmhouses, whose builders stand each piece on the
 * ground themselves (farms.ts). `standing` = built and not a ruin.
 */
export function settledLot(kind: BuildingKind, lotW: number, lotD: number, outside: boolean, standing: boolean): boolean {
  return outside && (!standing || (kind !== 'farmhouse' && !(FARM_KINDS.has(kind) && isFieldLot(lotW, lotD))));
}

/** The lot ground a building's builder asks for (lotGround in buildingCtx.ts), for laying it on the terrain. */
export function lotGroundOf(kind: BuildingKind, built: boolean, ruined: boolean): 'lawn' | 'paved' | 'gravel' | 'dirt' | 'plaza' | 'clay' | 'meadow' {
  if (ruined || !built) return 'dirt';
  switch (kind) {
    case 'house': case 'trailer': case 'park': case 'farmhouse': return 'lawn';
    case 'yard': case 'sawmill': case 'brickworks': case 'cementworks': case 'steelmill': case 'workshop': case 'furniture': case 'mine': return 'gravel';
    case 'quarry': case 'claypit': return 'clay';
    case 'lumberyard': return 'dirt';
    case 'plaza': return 'plaza';
    case 'farm': case 'vegfarm': case 'dairyfarm': case 'ranch': return 'meadow';
    default: return 'paved';
  }
}

/** Where the farm's tractor stands, in the building's local frame (left of the building, facing the lane). */
export function tractorSpot(bw: number, bd: number): { x: number; z: number; yaw: number } {
  return { x: -bw / 2 - 8.5, z: bd / 2 - 0.5, yaw: 0.35 };
}
