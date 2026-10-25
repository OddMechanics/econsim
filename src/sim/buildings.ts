import { cashOf, log, nameOf, newId, pay, type Ctx } from './ctx';
import { BUILDINGS, emptyInv, invTotal, materialsFor, TOWERS, unitsFor, workHoursFor } from './goods';
import { toWorld } from './layout';
import { heightAt } from './world';
import { lotsForSale, markLotUsed } from './roads';
import { noteLandDemand, noteLandSale } from './government';
import type { Building, BuildingKind, Lot, Person, Unit, Zone } from './types';

/** Where on its lot a building stands: near the street, the yard behind (farms: fields behind). */
export function placeOnLot(kind: BuildingKind, lot: Lot): { x: number; y: number; w: number; d: number } {
  const def = BUILDINGS[kind];
  const w = Math.min(def.w, lot.w - 2), d = Math.min(def.d, lot.d - 2);
  const setback = kind === 'house' ? 5 : kind === 'farm' ? 4 : BUILDINGS[kind].category === 'industry' ? 4 : 2.5;
  const off = lot.d / 2 - setback - d / 2;
  return { x: lot.x + Math.cos(lot.angle) * off, y: lot.y + Math.sin(lot.angle) * off, w, d };
}

/**
 * Builders level the site: the terrain tiles whose centers lie inside the lot
 * take the height of the lot's center (water stays water). The building, its
 * yard and the ground then line up, instead of the slope poking through.
 */
export function gradeLot(ctx: Ctx, lot: Lot): void {
  const w = ctx.s.world;
  const S = w.size * w.tile;
  if (lot.x < 0 || lot.y < 0 || lot.x > S || lot.y > S) return; // beyond the grid: the countryside is computed, not stored
  const base = heightAt(w, lot.x, lot.y);
  const ca = Math.cos(lot.angle), sa = Math.sin(lot.angle);
  const r = Math.hypot(lot.w, lot.d) / 2;
  const t0x = Math.max(0, Math.floor((lot.x - r) / w.tile)), t1x = Math.min(w.size - 1, Math.floor((lot.x + r) / w.tile));
  const t0y = Math.max(0, Math.floor((lot.y - r) / w.tile)), t1y = Math.min(w.size - 1, Math.floor((lot.y + r) / w.tile));
  let changed = false;
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const i = ty * w.size + tx;
      if (w.kind[i] === 'water') continue;
      const dx = (tx + 0.5) * w.tile - lot.x, dy = (ty + 0.5) * w.tile - lot.y;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      // inside the lot (a metre in from its edges, so the street stays as it is)
      if (Math.abs(u) > lot.d / 2 - 1 || Math.abs(v) > lot.w / 2 - 1) continue;
      if (Math.abs(w.height[i] - base) < 0.01) continue;
      w.height[i] = base;
      changed = true;
    }
  }
  if (changed) { w.ver++; w.hver = (w.hver ?? 0) + 1; }
}

export function createBuilding(
  ctx: Ctx, kind: BuildingKind, lot: Lot, owner: number, floors = 1, built = false, firm = -1,
): Building {
  gradeLot(ctx, lot);
  const pos = placeOnLot(kind, lot);
  const units: Unit[] = [];
  for (let i = 0; i < unitsFor(kind, floors); i++) units.push({ tenant: -1, rent: 0, since: 0, arrears: 0 });
  const b: Building = {
    id: newId(ctx), kind, lot: lot.id, x: pos.x, y: pos.y, angle: lot.angle, w: pos.w, d: pos.d, floors,
    owner, firm, built,
    workDone: 0, workNeeded: workHoursFor(kind, floors) * 60,
    needed: built ? emptyInv() : materialsFor(kind, floors),
    builder: -1, due: 0, billedWork: 0, condition: 1, ruined: false, store: emptyInv(), cash: 0, units,
    seed: Math.floor(ctx.rng.next() * 1e9), created: ctx.s.tick, lastProgress: ctx.s.tick, ver: 0,
  };
  if (built) b.workDone = b.workNeeded;
  // buying the land from whoever owns it (the government's land office, the Territory, a private owner)
  if (lot.owner !== owner && owner >= 0) {
    const seller = lot.owner;
    const paid = lot.forSale > 0 ? pay(ctx, owner, seller, lot.forSale, true) : 0;
    noteLandSale(ctx, lot, paid, seller);
    if (paid > 0 && !ctx.byId.has(owner)) log(ctx, 'business', `${nameOf(ctx, owner)} bought a lot from ${nameOf(ctx, seller)} for ${paid.toFixed(0)}.`, { bid: b.id });
  }
  lot.forSale = 0;
  lot.building = b.id;
  if (owner >= 0) lot.owner = owner;
  markLotUsed(ctx, lot);
  ctx.s.buildings.push(b);
  ctx.bById.set(b.id, b);
  const p = ctx.byId.get(owner);
  if (p) p.owned.push(b.id);
  const f = ctx.fById.get(firm);
  if (f) f.sites.push(b.id);
  return b;
}

/**
 * Pick a lot for a new building: one they already own, or one someone is
 * selling that they can pay for. Each kind weighs different things. If
 * there's none, that's noted as demand for land (governments see it and
 * may lay out new streets). Nobody gets land for free.
 */
export function findLot(ctx: Ctx, kind: BuildingKind, near: { x: number; y: number } | null, owner: number): Lot | null {
  const def = BUILDINGS[kind];
  const zones = def.zones;
  const lots = candidateLots(ctx, kind, zones, owner);
  if (!lots.length) { noteLandDemand(ctx, zones); return null; }
  const cash = Math.max(1, cashOf(ctx, owner));
  const cx = ctx.s.center.x, cy = ctx.s.center.y;
  let best: Lot | null = null, bestScore = Infinity;
  const sample = lots.length > 120 ? lots.filter(() => ctx.rng.next() < 120 / lots.length) : lots;
  for (const l of sample) {
    const dCenter = Math.hypot(l.x - cx, l.y - cy);
    const dNear = near ? Math.hypot(l.x - near.x, l.y - near.y) : dCenter;
    // the price matters more the less money they have
    let score = ctx.rng.next() * 40 + (l.owner === owner ? 0 : l.forSale * 60 / (60 + cash / 8));
    switch (def.category) {
      case 'home':
        score += dNear * 0.6 + dCenter * 0.3;
        break;
      case 'primary':
      case 'industry': {
        const res = def.gathers ?? (kind === 'sawmill' ? 'wood' : kind === 'brickworks' ? 'clay' : kind === 'steelmill' ? 'ore' : null);
        score += dCenter * 0.15;
        if (res) score += nearestStock(ctx, l.x, l.y, res) * 1.2;
        if (kind === 'farm') score -= lotFertility(ctx, l) * 400;
        break;
      }
      default: {
        // shops, restaurants, offices: where people are, away from rivals (towers: as central as possible)
        score += dCenter * (kind === 'office' || kind === 'officetower' ? 1.2 : 0.5);
        for (const b of ctx.s.buildings) {
          if (b.kind !== kind || b.ruined) continue;
          const d = Math.hypot(b.x - l.x, b.y - l.y);
          if (d < 160) score += (160 - d) * 0.8;
        }
      }
    }
    if (score < bestScore) { bestScore = score; best = l; }
  }
  return best;
}

function candidateLots(ctx: Ctx, kind: BuildingKind, zones: Zone[], owner: number): Lot[] {
  const def = BUILDINGS[kind];
  const fits = (l: Lot) => l.w >= Math.min(def.w, 14) + 2 && l.d >= Math.min(def.d, 12) + 2;
  // empty lots they already own, and land others are selling that they can pay for (keeping some money to build)
  const own = ctx.s.roads.lots.filter((l) => l.owner === owner && owner >= 0 && l.building < 0 && zones.includes(l.zone) && fits(l));
  const budget = cashOf(ctx, owner);
  const forSale = lotsForSale(ctx, zones).filter((l) => l.owner !== owner && fits(l) && budget > l.forSale * 1.4 + 10);
  return own.concat(forSale);
}

/** What a buyer would pay for a lot right now (0 if it's theirs). */
export function lotPrice(lot: Lot, buyer: number): number {
  return lot.owner === buyer ? 0 : lot.forSale;
}

function lotFertility(ctx: Ctx, l: Lot): number {
  const w = ctx.s.world;
  let f = 0, n = 0;
  for (const [dx, dy] of [[0, 0], [12, 12], [-12, 12], [12, -12], [-12, -12]]) {
    const tx = Math.floor((l.x + dx) / w.tile), ty = Math.floor((l.y + dy) / w.tile);
    if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) continue;
    f += w.fertility[ty * w.size + tx];
    n++;
  }
  return n ? f / n : 0;
}

export function farmFertility(ctx: Ctx, b: Building): number {
  const l = ctx.lotById.get(b.lot);
  return l ? Math.max(0.25, lotFertility(ctx, l)) : 0.5;
}

/** Distance (m) from a point to the nearest tile with some of a resource, capped. */
export function nearestStock(ctx: Ctx, x: number, y: number, res: 'wood' | 'stone' | 'clay' | 'ore'): number {
  const w = ctx.s.world;
  const arr = w[res];
  const cx = Math.floor(x / w.tile), cy = Math.floor(y / w.tile);
  for (let r = 0; r <= 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step || 1) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) continue;
        if (arr[ty * w.size + tx] > 3) return r * w.tile;
      }
    }
  }
  return 600;
}

const needTotal = new Map<string, number>();
export function deliveredFraction(b: Building): number {
  const key = b.kind + b.floors;
  let need = needTotal.get(key);
  if (need === undefined) { need = invTotal(materialsFor(b.kind, b.floors)); needTotal.set(key, need); }
  return need === 0 ? 1 : 1 - invTotal(b.needed) / need;
}

/** One minute of construction work. Returns true when the building is finished. */
export function buildMinute(ctx: Ctx, b: Building, worker: Person): boolean {
  if (checkFinished(ctx, b)) return true;
  const cap = b.workNeeded * Math.min(1, deliveredFraction(b) + 0.15);
  if (b.workDone >= cap) return false;
  const skill = Math.min(1.5, 1 + (worker.skills.builder ?? 0) / 400);
  b.workDone += (worker.inv.tools > 0 ? 1.25 : 1) * skill;
  b.lastProgress = ctx.s.tick;
  if (Math.floor(b.workDone) % 45 === 0) b.ver++;
  if (b.workDone >= b.workNeeded && invTotal(b.needed) === 0) {
    finishBuilding(ctx, b);
    return true;
  }
  return false;
}

import { onFinished } from './hooks';
import { tally } from './stats';
export { onFinished };

/** Finish a building whose work and materials are both complete. */
export function checkFinished(ctx: Ctx, b: Building): boolean {
  if (b.built || b.ruined || b.workDone < b.workNeeded || invTotal(b.needed) > 0) return false;
  finishBuilding(ctx, b);
  return true;
}

export function finishBuilding(ctx: Ctx, b: Building): void {
  b.built = true;
  b.workDone = b.workNeeded;
  b.condition = 1;
  b.ver++;
  const owner = ctx.byId.get(b.owner);
  for (const q of ctx.s.people) if (q.projectId === b.id) q.projectId = -1;
  if (b.host === undefined) { tally(ctx, 'built', 1); tally(ctx, 'floors', b.floors); }
  if (TOWERS.includes(b.kind)) createHostedUnits(ctx, b);
  const what = b.floors > 2 ? `${b.floors}-floor ${BUILDINGS[b.kind].label.toLowerCase()}` : BUILDINGS[b.kind].label.toLowerCase();
  const firm = ctx.fById.get(b.firm);
  log(ctx, BUILDINGS[b.kind].category === 'home' ? 'build' : 'business',
    firm ? `${firm.name} opened a new ${what}.` : `${nameOf(ctx, b.owner)} finished a ${what}.`, { who: owner?.id, bid: b.id, firm: firm?.id });
  for (const fn of onFinished) fn(ctx, b);
}

/**
 * A finished tower gets its units: shopfronts on the ground floor (two, on
 * either side of the lobby) and, in an office tower, an office suite on
 * every floor above. They belong to the tower's owner, who leases them out.
 */
export function createHostedUnits(ctx: Ctx, t: Building): void {
  if (t.hosted?.length) return;
  const def = BUILDINGS[t.kind];
  const ids: number[] = [];
  const unit = (kind: 'shopfront' | 'suite', level: number, x: number, y: number, w: number, d: number) => {
    const u: Building = {
      id: newId(ctx), kind, lot: t.lot, x, y, angle: t.angle, w, d, floors: 1, owner: t.owner, firm: -1, built: true,
      workDone: 0, workNeeded: 0, needed: emptyInv(), builder: -1, due: 0, billedWork: 0, condition: 1, ruined: false,
      store: emptyInv(), cash: 0, units: [], seed: Math.floor(ctx.rng.next() * 1e9), created: ctx.s.tick, lastProgress: ctx.s.tick, ver: 0,
      host: t.id, level,
    };
    ctx.s.buildings.push(u);
    ctx.bById.set(u.id, u);
    const p = ctx.byId.get(t.owner);
    if (p) p.owned.push(u.id);
    ids.push(u.id);
  };
  for (let i = 0; i < (def.podium ?? 0); i++) {
    const [x, y] = toWorld(t, (i % 2 ? 1 : -1) * t.w * 0.32, t.d * 0.25);
    unit('shopfront', 0, x, y, t.w * 0.36, t.d * 0.5);
  }
  if (def.suites) for (let k = 1; k < t.floors; k++) unit('suite', k, t.x, t.y, t.w, t.d);
  t.hosted = ids;
}

/** The units inside a tower (shops, office floors). */
export function hostedOf(ctx: Ctx, t: Building): Building[] {
  return (t.hosted ?? []).map((id) => ctx.bById.get(id)).filter((b): b is Building => !!b);
}

/** Daily wear and tear; stuck construction sites are given up after a week. */
export function decayBuildings(ctx: Ctx, onRuin: (b: Building) => void): void {
  for (const b of ctx.s.buildings) {
    if (b.ruined) continue;
    if (b.built) {
      // units inside a tower age with the tower
      if (b.host !== undefined) { b.condition = ctx.bById.get(b.host)?.condition ?? b.condition; continue; }
      // a trailer nobody lives in isn't looked after
      const neglect = b.kind === 'trailer' && !b.units.some((u) => u.tenant >= 0) ? 0.02 : 0;
      b.condition = Math.max(0, b.condition - BUILDINGS[b.kind].decayPerDay - neglect);
      if (b.condition <= 0) { ruin(ctx, b); onRuin(b); }
    } else if (ctx.s.tick - b.lastProgress > 14 * 1440 && b.builder !== -2 && !ctx.govOfFirm.has(b.owner)) {
      log(ctx, 'build', `Work on ${nameOf(ctx, b.owner)}'s ${BUILDINGS[b.kind].label.toLowerCase()} stopped for good; the half-built shell was torn down.`, { bid: b.id });
      ruin(ctx, b);
      onRuin(b);
    }
  }
  const keep = ctx.s.tick - 15 * 1440;
  const gone = ctx.s.buildings.filter((b) => b.ruined && b.created < keep);
  for (const b of gone) removeBuilding(ctx, b);
}

export function ruin(ctx: Ctx, b: Building): void {
  b.ruined = true;
  b.ver++;
  b.created = ctx.s.tick; // reused as "ruined at"
  for (const u of hostedOf(ctx, b)) if (!u.ruined) ruin(ctx, u);
}

export function removeBuilding(ctx: Ctx, b: Building): void {
  for (const u of hostedOf(ctx, b)) removeBuilding(ctx, u);
  ctx.s.buildings = ctx.s.buildings.filter((x) => x !== b);
  ctx.bById.delete(b.id);
  const lot = ctx.lotById.get(b.lot);
  if (lot && lot.building === b.id) lot.building = -1;
  const p = ctx.byId.get(b.owner);
  if (p) p.owned = p.owned.filter((id) => id !== b.id);
  const f = ctx.fById.get(b.firm);
  if (f) f.sites = f.sites.filter((id) => id !== b.id);
  // whoever was waiting for it to be built isn't any more
  for (const q of ctx.s.people) if (q.projectId === b.id) q.projectId = -1;
}

/** Change who owns a building (and its lot). */
export function transferBuilding(ctx: Ctx, b: Building, to: number): void {
  const prev = b.owner;
  const from = ctx.byId.get(prev);
  if (from) from.owned = from.owned.filter((id) => id !== b.id);
  b.owner = to;
  b.ver++;
  const p = ctx.byId.get(to);
  if (p && !p.owned.includes(b.id)) p.owned.push(b.id);
  // a unit in a tower changes hands alone; a tower takes its land and its vacant units with it
  if (b.host !== undefined) return;
  const lot = ctx.lotById.get(b.lot);
  if (lot) lot.owner = to;
  for (const u of hostedOf(ctx, b)) if (u.owner === prev) transferBuilding(ctx, u, to);
}

export function lotOf(ctx: Ctx, b: Building): Lot | undefined {
  return ctx.lotById.get(b.lot);
}

