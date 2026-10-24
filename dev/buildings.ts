// Test bench for the building renderer: one of every kind (built, under
// construction, ruined, a few floor counts) along fake streets, a row of
// towers from 10 to 70 floors with shops and office suites (leased and
// vacant) as hosted units built exactly like the sim does, towers under
// construction at several stages, and a dense downtown of mixed towers and
// mid-rises (tallest in the middle) to judge the skyline. Day/night and the
// hour (the app's lighting), cutaway (a tower opens at a floor; a shop or a
// suite opens its tower there), ownership, a close-up button, a LOD switch,
// far / skyline / downtown views and an ads row.
// Open /dev/buildings.html on the dev server. ?stress=N adds N random
// buildings; the perf scripts inject a real city as window.__benchCity.

import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, GlowLayer, HemisphericLight, MeshBuilder, PointerEventTypes, Scene,
  SceneInstrumentation, ShadowGenerator, StandardMaterial, Vector3,
} from '@babylonjs/core';
import { AdRenderer } from '../src/render/ads';
import { BuildingRenderer, type BuildingLook } from '../src/render/buildings';
import { BUILDINGS, emptyInv, materialsFor, unitsFor, workHoursFor } from '../src/sim/goods';
import { stationsOf, toWorld } from '../src/sim/layout';
import type { AdPlacement, Building, BuildingKind, World, Zone } from '../src/sim/types';

// lot frontage x depth per zone (copied so the bench doesn't depend on config tuning)
const LOT: Record<Zone, [number, number]> = { core: [20, 22], urban: [20, 24], suburb: [22, 28], industrial: [32, 30], rural: [56, 56] };

type State = 'built' | 'site' | 'ruin';
interface Spec {
  kind: BuildingKind; floors?: number; state?: State; progress?: number; label?: string; seed?: number;
  /** Towers: what the two shopfronts are ('shopfront' = vacant) and the share of leased office floors. */
  shops?: BuildingKind[]; leased?: number;
  /** Homes: share of units lived in. */
  occ?: number;
}

const FIRMS = ['Rosa\'s Market', 'Bluebird Diner', 'Northwind Motors', 'Kessler & Co', 'Atlas Freight', 'Oakline Builders', 'Miller Farms',
  'Timberline', 'Greystone', 'Deepvein Mining', 'Riverside Mill', 'Redclay Bricks', 'Ironhold Steel', 'Harvest Foods', 'Anvil Tools',
  'Cozy Home', 'Loomworks', 'Voltix', 'Meridian Auto', 'Corner Shop', 'Nimbus Systems', 'Brightside Cafe', 'Summit Group', 'Halvorsen Capital',
  'Pinecrest Bank', 'Orbit Media', 'Bayline Partners', 'Quantis', 'Copper Kettle', 'Verde Grocers', 'Lumen Labs', 'Harbor Law', 'Atlas Insurance',
  'Kite Studios', 'Northstar Billboards', 'Granite Concrete', 'Clearview Glass', 'Marrow & Finch', 'Sakura Sushi', 'Union Trust'];

const CIVIC_NAMES: Partial<Record<BuildingKind, string>> = { cityhall: 'Free City of Ashford', park: 'Linden Park' };

const rows: { z: number; facing: 1 | -1; zone?: Zone; specs: Spec[] }[] = [
  {
    z: -110, facing: 1, specs: [
      { kind: 'plaza', seed: 1 }, { kind: 'plaza', seed: 2, label: 'plaza-b' }, { kind: 'park', seed: 1 }, { kind: 'park', seed: 3, label: 'park-b' },
      { kind: 'cityhall', floors: 2, seed: 1 }, { kind: 'cityhall', floors: 4, seed: 2 },
    ],
  },
  {
    z: -66, facing: -1, specs: [
      { kind: 'studio', floors: 1, seed: 3 }, { kind: 'studio', floors: 3, seed: 4 }, { kind: 'netco', floors: 2, seed: 5 }, { kind: 'netco', floors: 8, seed: 6 },
      { kind: 'bank', floors: 1, seed: 8 }, { kind: 'bank', floors: 5, seed: 9 }, { kind: 'office', floors: 2, seed: 5 }, { kind: 'office', floors: 6, seed: 6 },
      { kind: 'office', floors: 12, seed: 17 }, { kind: 'adco', floors: 1, seed: 3 }, { kind: 'adco', floors: 2, seed: 4, label: 'adco-2' },
    ],
  },
  {
    z: -22, facing: 1, specs: [
      { kind: 'trailer', seed: 3, occ: 1 }, { kind: 'trailer', seed: 8, label: 'trailer-b', occ: 1 }, { kind: 'trailer', seed: 21, label: 'trailer-c', occ: 0 },
      { kind: 'house', floors: 1, seed: 11, occ: 1 }, { kind: 'house', floors: 2, seed: 12, occ: 1 }, { kind: 'house', floors: 2, seed: 25, label: 'house-2b', occ: 1 },
      { kind: 'apartments', floors: 3, seed: 4 }, { kind: 'apartments', floors: 5, seed: 5 }, { kind: 'apartments', floors: 8, seed: 6 }, { kind: 'apartments', floors: 10, seed: 7 },
    ],
  },
  {
    z: 22, facing: -1, specs: [
      { kind: 'store', floors: 1, seed: 1 }, { kind: 'store', floors: 2, seed: 2 }, { kind: 'restaurant', seed: 3 }, { kind: 'restaurant', seed: 14, label: 'restaurant-b' },
      { kind: 'dealer', seed: 4 }, { kind: 'depot', seed: 8 }, { kind: 'yard', seed: 9 },
    ],
  },
  {
    z: 110, facing: 1, specs: [
      { kind: 'farm', seed: 1 }, { kind: 'lumberyard', seed: 2 }, { kind: 'quarry', seed: 3 }, { kind: 'claypit', seed: 4 }, { kind: 'mine', seed: 4 },
      { kind: 'sawmill', seed: 5 }, { kind: 'brickworks', seed: 6 },
    ],
  },
  {
    z: 158, facing: -1, specs: [
      { kind: 'steelmill', seed: 7 }, { kind: 'cementworks', seed: 1 }, { kind: 'glassworks', seed: 2 }, { kind: 'foodplant', seed: 8 },
      { kind: 'workshop', seed: 1 }, { kind: 'furniture', seed: 2 }, { kind: 'textile', floors: 2, seed: 3 }, { kind: 'electronics', floors: 2, seed: 4 }, { kind: 'carplant', seed: 5 },
    ],
  },
  {
    z: 236, facing: 1, specs: [
      { kind: 'house', floors: 2, state: 'site', progress: 0.4 }, { kind: 'apartments', floors: 6, state: 'site', progress: 0.4 }, { kind: 'office', floors: 8, state: 'site', progress: 0.4 },
      { kind: 'store', state: 'site', progress: 0.4 }, { kind: 'restaurant', state: 'site', progress: 0.02, label: 'site-restaurant-0' }, { kind: 'depot', state: 'site', progress: 0.4 },
      { kind: 'officetower', floors: 40, state: 'site', progress: 0.03, label: 'site-ot-dig' },
      { kind: 'officetower', floors: 40, state: 'site', progress: 0.2, label: 'site-ot-20' },
      { kind: 'officetower', floors: 40, state: 'site', progress: 0.5, label: 'site-ot-50' },
      { kind: 'tower', floors: 30, state: 'site', progress: 0.35, label: 'site-t-35' },
      { kind: 'tower', floors: 30, state: 'site', progress: 0.75, label: 'site-t-75' },
      { kind: 'officetower', floors: 60, state: 'site', progress: 0.9, label: 'site-ot-90' },
    ],
  },
  {
    z: 300, facing: -1, specs: [
      { kind: 'house', state: 'ruin' }, { kind: 'apartments', floors: 4, state: 'ruin' }, { kind: 'office', floors: 4, state: 'ruin' },
      { kind: 'store', state: 'ruin' }, { kind: 'sawmill', state: 'ruin' }, { kind: 'trailer', state: 'ruin' },
      { kind: 'tower', floors: 20, state: 'ruin', label: 'ruin-tower' }, { kind: 'officetower', floors: 24, state: 'ruin', label: 'ruin-ot' },
      { kind: 'house', floors: 2, seed: 12, label: 'house-worn' }, { kind: 'apartments', floors: 5, seed: 9, label: 'apartments-worn' },
    ],
  },
  {
    // the tower row: offices and flats from 10 to 70 floors, shops leased and vacant
    z: 370, facing: 1, zone: 'core', specs: [
      { kind: 'officetower', floors: 10, seed: 1, label: 'ot-10', shops: ['store', 'shopfront'], leased: 0.6 },
      { kind: 'officetower', floors: 20, seed: 2, label: 'ot-20', shops: ['restaurant', 'bank'], leased: 0.85 },
      { kind: 'officetower', floors: 35, seed: 3, label: 'ot-35', shops: ['shopfront', 'shopfront'], leased: 0.3 },
      { kind: 'officetower', floors: 50, seed: 4, label: 'ot-50', shops: ['bank', 'store'], leased: 0.9 },
      { kind: 'officetower', floors: 70, seed: 5, label: 'ot-70', shops: ['restaurant', 'store'], leased: 0.75 },
      { kind: 'tower', floors: 10, seed: 6, label: 't-10', shops: ['store', 'restaurant'], occ: 0.8 },
      { kind: 'tower', floors: 20, seed: 7, label: 't-20', shops: ['shopfront', 'store'], occ: 0.6 },
      { kind: 'tower', floors: 35, seed: 8, label: 't-35', shops: ['restaurant', 'shopfront'], occ: 0.9 },
      { kind: 'tower', floors: 50, seed: 9, label: 't-50', shops: ['bank', 'restaurant'], occ: 0.7 },
      { kind: 'tower', floors: 60, seed: 10, label: 't-60', shops: ['store', 'store'], occ: 0.85 },
    ],
  },
  {
    // more tower variety (styles come from the seed)
    z: 420, facing: -1, zone: 'core', specs: Array.from({ length: 10 }, (_, i): Spec => ({
      kind: i % 2 ? 'tower' : 'officetower', floors: 14 + ((i * 7) % 5) * 7, seed: 31 + i * 3, label: `var-${i}`,
      shops: [(['store', 'restaurant', 'bank', 'shopfront'] as BuildingKind[])[i % 4], (['shopfront', 'store', 'restaurant'] as BuildingKind[])[i % 3]], leased: 0.5 + (i % 3) * 0.2, occ: 0.75,
    })),
  },
  {
    // ads test row: posters, a banner, a rooftop billboard, free-standing billboards (added below), flyers on lamps
    z: 470, facing: 1, specs: [
      { kind: 'store', floors: 1, seed: 21, label: 'ads-store' }, { kind: 'apartments', floors: 5, seed: 22, label: 'ads-apartments' },
      { kind: 'office', floors: 6, seed: 23, label: 'ads-office' }, { kind: 'cityhall', floors: 2, seed: 24, label: 'ads-cityhall' },
    ],
  },
];

const buildings: Building[] = [];
const looks = new Map<number, BuildingLook>();
const labels = new Map<string, number>();
const ownerColors = [Color3.FromHexString('#e74c3c'), Color3.FromHexString('#3498db'), Color3.FromHexString('#2ecc71'), Color3.FromHexString('#f1c40f'), Color3.FromHexString('#9b59b6')];
let nextId = 1;
const roads: { x0: number; z0: number; x1: number; z1: number }[] = [];
const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** A Building record as the sim makes it (cast: tolerate fields added later). */
function mkBuilding(kind: BuildingKind, x: number, z: number, angle: number, floors: number, seed: number, state: State, progress: number, extra: Partial<Building> = {}): Building {
  const def = BUILDINGS[kind];
  const mats = materialsFor(kind, floors);
  const needed = emptyInv();
  for (const g of Object.keys(mats) as (keyof typeof mats)[]) needed[g] = Math.round(mats[g] * (1 - Math.min(1, progress + 0.3)));
  const work = workHoursFor(kind, floors) * 60;
  return {
    id: nextId++, kind, lot: 0, x, y: z, angle, w: def.w, d: def.d, floors,
    owner: 1, firm: -1, built: state !== 'site', workDone: progress * work, workNeeded: work,
    needed, builder: -1, due: 0, billedWork: 0, condition: state === 'ruin' ? 0.1 : 0.95, ruined: state === 'ruin', store: emptyInv(), cash: 0, units: [],
    seed: seed * 7919 + 13, created: 0, lastProgress: 0, ver: 1, ...extra,
  } as Building;
}

function firmLook(id: number, lw: number, ld: number, name?: string): BuildingLook {
  return { lotW: lw, lotD: ld, ground: 0, firmName: name ?? FIRMS[(id * 7) % FIRMS.length], firmHue: (id * 0.137) % 1, ownerColor: null };
}

/** Fill a home's units: `occ` of them lived in. */
function fillUnits(b: Building, occ: number): void {
  const n = unitsFor(b.kind, b.floors);
  b.units = Array.from({ length: n }, (_, i) => ({ tenant: hash(b.seed, i) < occ ? 1 : -1, rent: 10, since: 0, arrears: 0 }));
}

/** A tower with its hosted units, created exactly like the sim does when a tower is finished. */
function addHosted(T: Building, lw: number, ld: number, shops: BuildingKind[], leased: number): void {
  const def = BUILDINGS[T.kind];
  const hosted: number[] = [];
  const unit = (kind: BuildingKind, level: number, x: number, y: number, w: number, d: number, name?: string) => {
    const u = { ...mkBuilding(kind, x, y, T.angle, 1, T.seed + level * 31 + hosted.length, 'built', 1), w, d, host: T.id, level, lot: T.lot } as Building;
    buildings.push(u);
    hosted.push(u.id);
    looks.set(u.id, kind === 'shopfront' || kind === 'suite' ? { lotW: lw, lotD: ld, ground: 0, ownerColor: null } : firmLook(u.id, lw, ld, name));
    return u;
  };
  const n = def.podium ?? 0;
  for (let k = 0; k < n; k++) {
    const sx = k === 0 ? -1 : 1;
    const [x, y] = toWorld(T, sx * T.w * 0.32, T.d * 0.25);
    unit(shops[k] ?? 'shopfront', 0, x, y, T.w * 0.36, T.d * 0.5);
  }
  if (def.suites) {
    // big tenants take several floors in a row
    let k = 1;
    while (k < T.floors) {
      const run = 1 + Math.floor(hash(T.seed, k) * 4);
      const take = hash(T.seed, 100 + k) < leased;
      const kind: BuildingKind = take ? (['office', 'office', 'netco', 'bank', 'adco', 'studio'] as BuildingKind[])[Math.floor(hash(T.seed, 200 + k) * 6)] : 'suite';
      const name = FIRMS[Math.floor(hash(T.seed, 300 + k) * FIRMS.length)];
      for (let j = 0; j < run && k < T.floors; j++, k++) unit(kind, k, T.x, T.y, T.w, T.d, name);
    }
  }
  T.hosted = hosted;
}

function place(sp: Spec, cx: number, cz: number, angle: number, lw: number, ld: number, i: number): Building {
  const def = BUILDINGS[sp.kind];
  const state = sp.state ?? 'built';
  const floors = sp.floors ?? def.floors[0];
  const b = mkBuilding(sp.kind, cx, cz, angle, floors, sp.seed ?? i * 17 + 5, state, state === 'site' ? sp.progress ?? 0.4 : 1);
  if (sp.label?.endsWith('worn')) b.condition = 0.25;
  buildings.push(b);
  const commercial = def.category !== 'home' && def.category !== 'civic';
  looks.set(b.id, commercial ? firmLook(b.id, lw, ld) : {
    lotW: lw, lotD: ld, ground: 0, firmName: CIVIC_NAMES[sp.kind],
    firmHue: sp.kind === 'cityhall' || sp.kind === 'plaza' ? 0.6 + (b.id % 3) * 0.13 : undefined, ownerColor: null,
    live: sp.kind === 'studio' ? b.id % 2 === 0 : undefined,
  });
  if (def.category === 'home') fillUnits(b, sp.occ ?? 0.75);
  if ((sp.kind === 'tower' || sp.kind === 'officetower') && state === 'built') addHosted(b, lw, ld, sp.shops ?? ['store', 'shopfront'], sp.leased ?? 0.6);
  return b;
}

for (let r = 0; r < rows.length; r += 2) {
  let x0 = Infinity, x1 = -Infinity;
  for (const row of [rows[r], rows[r + 1]]) {
    if (!row) continue;
    let x = 0;
    row.specs.forEach((sp, i) => {
      const def = BUILDINGS[sp.kind];
      const zone = row.zone ?? def.zones[0];
      const state = sp.state ?? 'built';
      let [lw, ld] = LOT[zone];
      if (sp.kind === 'plaza' || sp.kind === 'park') { lw = def.w + 2; ld = def.d + 2; }
      if (zone === 'rural' && state !== 'built') { lw = 36; ld = 36; }
      lw = Math.max(lw, def.w + 2); ld = Math.max(ld, def.d + 4);
      const cx = x + lw / 2;
      x += lw + 2;
      const cz = row.z - row.facing * (ld / 2);
      const b = place(sp, cx, cz, row.facing > 0 ? Math.PI / 2 : -Math.PI / 2, lw, ld, i + r * 17);
      const label = sp.label ?? (state === 'site' ? `site-${sp.kind}` : state === 'ruin' ? `ruin-${sp.kind}` : def.floors[1] > 1 ? `${sp.kind}-${b.floors}` : sp.kind);
      labels.set(label, b.id);
    });
    x0 = Math.min(x0, 0); x1 = Math.max(x1, x);
  }
  const z = (rows[r].z + (rows[r + 1]?.z ?? rows[r].z)) / 2;
  roads.push({ x0: x0 - 10, z0: z - 4, x1: x1 + 10, z1: z + 4 });
}

// ----------------------------------------------------------------- downtown

/**
 * A dense downtown west of the bench: blocks of lots facing the streets, the tallest towers in the
 * middle and lower buildings toward the edges (as land prices fall off).
 */
const DT = { x: -620, z: 120, cols: 5, rows: 4, bw: 110, bd: 50, street: 18 };
const downtownLots: { x: number; z: number; facing: 1 | -1 }[] = [];
{
  const W = DT.cols * (DT.bw + DT.street), D = DT.rows * (DT.bd + DT.street);
  for (let bx = 0; bx < DT.cols; bx++) for (let bz = 0; bz < DT.rows; bz++) {
    const x0 = DT.x - W / 2 + bx * (DT.bw + DT.street) + DT.street / 2, z0 = DT.z - D / 2 + bz * (DT.bd + DT.street) + DT.street / 2;
    for (let k = 0; k < Math.floor(DT.bw / 22); k++) {
      const x = x0 + 11 + k * 22;
      downtownLots.push({ x, z: z0 + DT.bd - 12, facing: 1 }, { x, z: z0 + 12, facing: -1 });
    }
  }
  for (let i = 0; i <= DT.cols; i++) { const x = DT.x - W / 2 + i * (DT.bw + DT.street); roads.push({ x0: x - DT.street / 2 + 1, z0: DT.z - D / 2, x1: x + DT.street / 2 - 1, z1: DT.z + D / 2 }); }
  for (let i = 0; i <= DT.rows; i++) { const z = DT.z - D / 2 + i * (DT.bd + DT.street); roads.push({ x0: DT.x - W / 2, z0: z - DT.street / 2 + 1, x1: DT.x + W / 2, z1: z + DT.street / 2 - 1 }); }
  const maxR = Math.hypot(W / 2, D / 2);
  downtownLots.forEach((lot, i) => {
    const d = Math.hypot(lot.x - DT.x, lot.z - DT.z) / maxR; // 0 center .. 1 corner
    const h = hash(i, 77), h2 = hash(i, 78);
    let sp: Spec;
    if (d < 0.25) sp = h < 0.55 ? { kind: 'officetower', floors: 40 + Math.floor(h2 * 31) } : h < 0.85 ? { kind: 'tower', floors: 35 + Math.floor(h2 * 26) } : { kind: 'bank', floors: 4 + Math.floor(h2 * 3) };
    else if (d < 0.5) sp = h < 0.35 ? { kind: 'officetower', floors: 18 + Math.floor(h2 * 22) } : h < 0.7 ? { kind: 'tower', floors: 14 + Math.floor(h2 * 24) } : h < 0.85 ? { kind: 'office', floors: 6 + Math.floor(h2 * 7) } : { kind: 'apartments', floors: 8 + Math.floor(h2 * 3) };
    else if (d < 0.75) sp = h < 0.15 ? { kind: 'tower', floors: 10 + Math.floor(h2 * 12) } : h < 0.5 ? { kind: 'apartments', floors: 5 + Math.floor(h2 * 6) } : h < 0.65 ? { kind: 'office', floors: 3 + Math.floor(h2 * 5) } : h < 0.8 ? { kind: 'store', floors: 1 + Math.floor(h2 * 2) } : h < 0.92 ? { kind: 'restaurant' } : { kind: 'netco', floors: 3 + Math.floor(h2 * 5) };
    else sp = h < 0.5 ? { kind: 'apartments', floors: 3 + Math.floor(h2 * 4) } : h < 0.7 ? { kind: 'store', floors: 1 } : h < 0.82 ? { kind: 'restaurant' } : h < 0.9 ? { kind: 'house', floors: 2 } : { kind: 'office', floors: 2 + Math.floor(h2 * 2) };
    if (hash(i, 79) < 0.04 && d < 0.6) sp = { kind: 'officetower', floors: 30, state: 'site', progress: 0.2 + hash(i, 80) * 0.7 };
    sp.seed = 1000 + i;
    sp.shops = [(['store', 'restaurant', 'bank', 'shopfront', 'store'] as BuildingKind[])[Math.floor(hash(i, 81) * 5)], (['restaurant', 'store', 'shopfront', 'store'] as BuildingKind[])[Math.floor(hash(i, 82) * 4)]];
    sp.leased = 0.35 + hash(i, 83) * 0.6;
    sp.occ = 0.55 + hash(i, 84) * 0.4;
    const b = place(sp, lot.x, lot.z, lot.facing > 0 ? Math.PI / 2 : -Math.PI / 2, 20, 22, i);
    if (i === 0) labels.set('downtown-first', b.id);
  });
  // a plaza and a park in the middle of the grid
  const pl = place({ kind: 'plaza', seed: 5 }, DT.x - 22, DT.z + DT.bd / 2 + DT.street / 2 + 2, 0, 32, 30, 1);
  void pl;
}

// ?stress=N adds N random buildings in a block south of the bench (performance check)
const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);
if (stress > 0) {
  const mix: BuildingKind[] = ['house', 'house', 'trailer', 'apartments', 'apartments', 'store', 'store', 'restaurant', 'office', 'office',
    'dealer', 'depot', 'yard', 'sawmill', 'workshop', 'furniture', 'textile', 'electronics', 'foodplant', 'brickworks', 'farm', 'lumberyard'];
  let x = 0, z = 560, rowD = 0;
  for (let i = 0; i < stress; i++) {
    const kind = mix[Math.floor(((i * 2654435761) >>> 0) / 4294967296 * mix.length)];
    const def = BUILDINGS[kind];
    const zone = def.zones[0] === 'rural' ? 'suburb' : def.zones[0];
    const [lw, ld] = LOT[zone];
    if (x > 600) { x = 0; z += rowD + 12; rowD = 0; }
    const floors = def.floors[0] + ((i * 7) % (def.floors[1] - def.floors[0] + 1));
    const state: State = i % 17 === 0 ? 'site' : i % 23 === 0 ? 'ruin' : 'built';
    place({ kind, floors, state, seed: i + 101 }, x + lw / 2, z - ld / 2, Math.PI / 2, lw, ld, i);
    x += lw + 1.5;
    rowD = Math.max(rowD, ld);
  }
}

// a real city (injected by the headless perf script as window.__benchCity) replaces the bench rows
const cityData = (window as unknown as { __benchCity?: CityB[] }).__benchCity;
interface CityB { kind: BuildingKind; x: number; y: number; angle: number; w: number; d: number; floors: number; built: boolean; ruined: boolean; condition: number;
  seed: number; workDone: number; workNeeded: number; lotW: number; lotD: number; firmName?: string; firmHue?: number }
if (cityData) {
  buildings.length = 0;
  looks.clear();
  labels.clear();
  roads.length = 0;
  for (const c of cityData) {
    if (!BUILDINGS[c.kind]) continue; // kinds that no longer exist
    const b = mkBuilding(c.kind, c.x, c.y, c.angle, c.floors, 0, c.ruined ? 'ruin' : c.built ? 'built' : 'site', 0);
    Object.assign(b, { w: c.w, d: c.d, workDone: c.workDone, workNeeded: c.workNeeded, condition: c.condition, seed: c.seed });
    buildings.push(b);
    looks.set(b.id, { lotW: c.lotW, lotD: c.lotD, ground: 0, firmName: c.firmName, firmHue: c.firmHue, ownerColor: null });
  }
}

// --------------------------------------------------------------------- ads

const ads: AdPlacement[] = [];
const lampSpots: [number, number][] = [];
const DESIGNS: Pick<AdPlacement, 'headline' | 'tagline' | 'hue' | 'topic' | 'sponsor'>[] = [
  { headline: 'Vote Maria Lopez', tagline: 'A city that works for you', hue: 0.6, topic: 'campaign', sponsor: 901 },
  { headline: 'Vote Tom Becker', tagline: 'Lower rents. Safer streets.', hue: 0.0, topic: 'campaign', sponsor: 902 },
  { headline: 'Voltix Phones', tagline: 'Smarter every day', hue: 0.55, topic: 'product', sponsor: 17 },
  { headline: 'Bluebird Diner', tagline: 'Breakfast all day', hue: 0.12, topic: 'product', sponsor: 2 },
];
if (!cityData) {
  let adId = 1;
  const put = (kind: AdPlacement['kind'], x: number, y: number, z: number, angle: number, w: number, h: number, d: number, building = -1) =>
    ads.push({ id: adId++, kind, x, y, z, angle, w, h, building, created: 0, expires: 1e9, ...DESIGNS[d % DESIGNS.length] } as AdPlacement);
  const at = (label: string) => buildings.find((b) => b.id === labels.get(label))!;
  const st = at('ads-store');
  [[-1.0, 0], [0.25, 2], [4.4, 1]].forEach(([lz, d], i) => {
    const [x, y] = toWorld(st, st.w / 2 - 0.3, lz - 0.3);
    put('poster', x, y, 1.65 + (i % 2) * 0.1, st.angle - Math.PI / 2, 0.95, 1.35, d, st.id);
  });
  const of = at('ads-office');
  { const [x, y] = toWorld(of, 2.4, 3.2); put('billboard', x, y, of.floors * 3.2 + 1.0 + 2.6 + 1.5, of.angle, 7, 3, 2, of.id); }
  const lastX = Math.max(...[st, of].map((b) => b.x)) + 40;
  put('billboard', lastX, 460, 6, Math.PI / 2, 6, 3, 3);
  for (let k = 0; k < 4; k++) {
    const px = st.x - 6 + k * 14, pz = 474.4;
    lampSpots.push([px, pz]);
    put('flyer', px + 0.1, pz, 1.45, Math.PI / 2, 0.3, 0.42, k);
  }
}
/** A flat world (heightAt reads only size, tile and height). */
const flatWorld = { size: 4, tile: 2000, height: new Array(16).fill(0) } as unknown as World;

// ------------------------------------------------------------------- scene

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
const scene = new Scene(engine);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.00055; // the main app's fog
const camera = new ArcRotateCamera('cam', -Math.PI / 2.6, 0.9, 260, new Vector3(110, 0, 110), scene);
camera.lowerRadiusLimit = 3;
camera.upperRadiusLimit = 3200;
camera.upperBetaLimit = 1.56;
camera.minZ = 0.3;
camera.maxZ = 9000;
camera.wheelDeltaPercentage = 0.015;
camera.panningSensibility = 40;
camera.attachControl(canvas, true);

const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
hemi.groundColor = Color3.FromHexString('#4a4a3a');
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
sun.autoUpdateExtends = false;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.0008;
shadows.normalBias = 0.06;
const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5 });
glow.intensity = 0;

const ground = MeshBuilder.CreateGround('ground', { width: 6000, height: 6000 }, scene);
ground.position.set(0, -0.02, 150);
const gm = new StandardMaterial('gm', scene);
gm.diffuseColor = Color3.FromHexString('#7a9a58');
gm.specularColor = Color3.Black();
ground.material = gm;
ground.receiveShadows = true;
{
  // downtown is paved
  const W = DT.cols * (DT.bw + DT.street), D = DT.rows * (DT.bd + DT.street);
  const pave = MeshBuilder.CreateGround('downtown', { width: W + 20, height: D + 20 }, scene);
  pave.position.set(DT.x, -0.01, DT.z);
  const pm = new StandardMaterial('pm', scene);
  pm.diffuseColor = Color3.FromHexString('#a9a59c');
  pm.specularColor = Color3.Black();
  pave.material = pm;
  pave.receiveShadows = true;
}
if (cityData) { ground.position.set(1000, -0.02, 1000); }
const rm = new StandardMaterial('rm', scene);
rm.diffuseColor = Color3.FromHexString('#4d5054');
rm.specularColor = Color3.Black();
rm.zOffset = -2;
const sm = new StandardMaterial('sm', scene);
sm.diffuseColor = Color3.FromHexString('#b4afa6');
sm.specularColor = Color3.Black();
sm.zOffset = -2;
for (const r of roads) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const road = MeshBuilder.CreateGround('road', { width: w, height: d }, scene);
  road.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2);
  road.material = rm;
  road.receiveShadows = true;
  for (const s of [-1, 1]) {
    const along = w > d;
    const walk = MeshBuilder.CreateGround('walk', { width: along ? w : 2.4, height: along ? 2.4 : d }, scene);
    walk.position.set((r.x0 + r.x1) / 2 + (along ? 0 : s * (w / 2 + 1.2)), 0.04, (r.z0 + r.z1) / 2 + (along ? s * (d / 2 + 1.2) : 0));
    walk.material = sm;
    walk.receiveShadows = true;
  }
}

const renderer = new BuildingRenderer(scene, shadows);
const adRenderer = new AdRenderer(scene, shadows);
{
  const pm = new StandardMaterial('pole', scene);
  pm.diffuseColor = Color3.FromHexString('#3a3d42');
  for (const [x, z] of lampSpots) {
    const pole = MeshBuilder.CreateCylinder('lampPole', { height: 6.6, diameterTop: 0.12, diameterBottom: 0.2, tessellation: 10 }, scene);
    pole.position.set(x, 3.3, z);
    pole.material = pm;
    shadows.addShadowCaster(pole);
  }
}
let ownership = false;
const lookOf = (b: Building): BuildingLook => {
  const l = looks.get(b.id)!;
  l.ownerColor = ownership && b.id % 3 === 0 ? ownerColors[b.id % ownerColors.length] : null;
  return l;
};

// ---------------------------------------------------------------- lighting

let hour = 12;
let nightOverride: number | null = null;
let night = 0;
const smooth = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
/** The app's lighting (renderer.ts updateLighting) for an hour of the day. */
function applyLight(): void {
  const day = hour / 24;
  const elev = Math.sin(Math.max(0, Math.min(1, (hour - 5.5) / 14.5)) * Math.PI);
  const daylight = nightOverride !== null ? 1 - nightOverride : smooth(5.3, 7.5, hour) * (1 - smooth(18.5, 20.6, hour));
  night = 1 - daylight;
  const az = day * Math.PI * 2;
  sun.direction = new Vector3(Math.cos(az) * 0.8, -Math.max(0.25, elev), Math.sin(az) * 0.5 - 0.3).normalize();
  sun.intensity = nightOverride !== null ? 0.95 * Math.max(0, daylight * 1.2 - 0.2) : 1.0 * Math.min(1, Math.max(0, elev * 1.5));
  sun.diffuse = Color3.Lerp(Color3.FromHexString('#ffb46b'), Color3.FromHexString('#fff6e8'), Math.min(1, Math.max(0, elev * 2)));
  hemi.intensity = 0.2 + 0.42 * daylight;
  hemi.diffuse = Color3.Lerp(Color3.FromHexString('#5b6aa0'), Color3.FromHexString('#f2f4ff'), daylight);
  const sky = Color3.Lerp(Color3.FromHexString('#0b1222'), Color3.FromHexString('#a9cbe3'), daylight);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;
  glow.intensity = 0.75 * night;
  glow.isEnabled = night > 0.05;
  renderer.setNight(night);
  renderer.setHour(hour);
  adRenderer.setNight(night);
}
applyLight();

// ---------------------------------------------------------------------- ui

const $ = (id: string) => document.getElementById(id)!;
const nr = $('nr') as HTMLInputElement;
const hr = $('hr') as HTMLInputElement;
const setHour = (h: number) => { hour = h; nightOverride = null; hr.value = String(h); $('hv').textContent = `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; applyLight(); nr.value = String(night); $('nv').textContent = night.toFixed(2); };
const setNight = (v: number) => { nightOverride = v; nr.value = String(v); $('nv').textContent = v.toFixed(2); $('night').classList.toggle('on', v > 0.5); applyLight(); };
$('night').onclick = () => setHour(night > 0.5 ? 12 : 21.5);
nr.oninput = () => setNight(Number(nr.value));
hr.oninput = () => setHour(Number(hr.value));
let cutMode = false;
let cutId: number | null = null;
$('cut').onclick = () => {
  cutMode = !cutMode;
  $('cut').textContent = `Cutaway: ${cutMode ? 'on' : 'off'}`;
  $('cut').classList.toggle('on', cutMode);
  if (!cutMode) { cutId = null; renderer.setCutaway(null); }
  else if (cutId === null) { cutId = labels.get(($('focus') as HTMLSelectElement).value) ?? null; renderer.setCutaway(cutId); }
};
$('own').onclick = () => { ownership = !ownership; $('own').classList.toggle('on', ownership); };
$('grow').onclick = () => {
  for (const b of buildings) {
    if (b.built || b.ruined) continue;
    b.workDone = Math.min(b.workNeeded, b.workDone + b.workNeeded * 0.1);
    for (const g of Object.keys(b.needed) as (keyof typeof b.needed)[]) b.needed[g] = Math.max(0, b.needed[g] - 2);
    if (b.workDone >= b.workNeeded) { b.built = true; b.ver++; }
  }
};
const LODS: (0 | 1 | 2 | null)[] = [null, 0, 1, 2];
let lodIdx = 0;
$('lod').onclick = () => {
  lodIdx = (lodIdx + 1) % LODS.length;
  renderer.forceLod = LODS[lodIdx];
  $('lod').textContent = `LOD: ${['auto', 'far', 'normal', 'near'][lodIdx]}`;
  $('lod').classList.toggle('on', lodIdx > 0);
};
$('close').onclick = () => {
  // open the focused building and fly in close enough for the props
  const id = labels.get(($('focus') as HTMLSelectElement).value);
  if (id === undefined) return;
  cutMode = true; cutId = id; renderer.setCutaway(id);
  $('cut').textContent = 'Cutaway: on'; $('cut').classList.add('on');
  const b = buildings.find((x) => x.id === id)!;
  camera.target = new Vector3(b.x, 2, b.y);
  camera.radius = Math.max(14, Math.max(b.w, b.d) * 1.5);
  camera.beta = 0.8;
};
$('far').onclick = () => view(DT.x + 300, DT.z - 200, 1500, 1.25, -2.2);
$('downtown').onclick = () => view(DT.x, DT.z, 520, 1.05, -2.3);
$('adsrow').onclick = () => focus(labels.has('ads-office') ? 'ads-office' : 'overview', 75, 1.2, 1.15);
const sel = $('focus') as HTMLSelectElement;
for (const name of ['overview', ...labels.keys()]) {
  const o = document.createElement('option');
  o.value = o.textContent = name;
  sel.appendChild(o);
}
function view(x: number, z: number, radius: number, beta = 0.9, alpha = -Math.PI / 2.4, y = 0): void {
  camera.target = new Vector3(x, y, z); camera.radius = radius; camera.beta = beta; camera.alpha = alpha;
}
function focus(name: string, radius?: number, alpha?: number, beta?: number): void {
  if (name === 'overview') { view(150, 130, radius ?? 380, beta ?? 0.85, alpha ?? Math.PI / 2.6); return; }
  const id = labels.get(name);
  const b = buildings.find((x) => x.id === id);
  if (!b) return;
  const look = looks.get(b.id)!;
  camera.target = new Vector3(b.x, 4, b.y);
  camera.radius = radius ?? Math.max(28, Math.max(look.lotW, look.lotD) * 1.35 + Math.min(b.floors, 30) * 2);
  camera.alpha = alpha ?? (b.angle > 0 ? Math.PI / 2 - 0.6 : -Math.PI / 2 - 0.6);
  camera.beta = beta ?? 1.0;
  if (cutMode) { cutId = b.id; renderer.setCutaway(b.id); }
}
sel.onchange = () => focus(sel.value);

scene.onPointerObservable.add((pi) => {
  if (pi.type !== PointerEventTypes.POINTERPICK || !pi.pickInfo) return;
  const adId = adRenderer.pickedId(pi.pickInfo);
  if (adId >= 0) { $('pick').textContent = `picked ad #${adId}`; return; }
  const id = renderer.pickedId(pi.pickInfo);
  const b = buildings.find((x) => x.id === id);
  const name = [...labels].find(([, v]) => v === id)?.[0];
  $('pick').textContent = id >= 0 ? `picked #${id} ${b?.kind ?? ''} ${name ?? ''}${b?.host !== undefined ? ` (in #${b.host}, floor ${b.level})` : ''} ${looks.get(id)?.firmName ?? ''}` : '';
  if (cutMode && id >= 0) { cutId = id; renderer.setCutaway(id); }
});

const instr = new SceneInstrumentation(scene);
instr.captureFrameTime = true;
let syncMs = 0;
scene.onBeforeRenderObservable.add(() => {
  const t0 = performance.now();
  renderer.sync(buildings, lookOf);
  adRenderer.sync(ads, flatWorld, camera.position.x, camera.position.z);
  syncMs = syncMs * 0.9 + (performance.now() - t0) * 0.1;
  // keep the shadow map around what the camera looks at
  const extent = Math.min(700, Math.max(60, camera.radius * 1.3));
  sun.shadowFrustumSize = extent;
  sun.position = camera.target.subtract(sun.direction.scale(600));
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 1400;
  scene.shadowsEnabled = camera.radius < 650 && sun.intensity > 0.05;
});
let frames = 0;
scene.onAfterRenderObservable.add(() => {
  if (++frames % 20) return;
  $('stats').textContent = [
    `buildings ${buildings.length}  backlog ${renderer.backlog}`,
    `meshes ${scene.meshes.length}  active ${scene.getActiveMeshes().length}`,
    `draw calls ${instr.drawCallsCounter.current}`,
    `frame ${instr.frameTimeCounter.lastSecAverage.toFixed(1)} ms  sync ${syncMs.toFixed(2)} ms`,
    `fps ${engine.getFps().toFixed(0)}`,
    `lod ${JSON.stringify(renderer.stats())}`,
  ].join('\n');
});

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
focus('overview');

/** A hosted unit of a tower (by label) at a floor. */
function unitAt(label: string, level: number): Building | undefined {
  const T = buildings.find((x) => x.id === labels.get(label));
  return buildings.find((u) => u.host === T?.id && u.level === level);
}

// hooks for headless screenshots
(window as unknown as { bench: unknown }).bench = {
  focus, labels: () => [...labels.keys()], view,
  night: (v: number | null) => { if (v === null) setHour(hour); else setNight(v); },
  hour: (h: number) => setHour(h),
  cut: (name: string | null) => {
    cutMode = name !== null;
    cutId = name ? labels.get(name) ?? null : null;
    renderer.setCutaway(cutId);
  },
  /** Open a tower at one of its units (a shop on floor 0, an office floor). */
  cutUnit: (label: string, level: number) => { const u = unitAt(label, level); cutMode = !!u; cutId = u?.id ?? null; renderer.setCutaway(cutId); return u?.kind; },
  owners: (on: boolean) => { ownership = on; },
  ready: () => renderer.backlog === 0,
  target: (x: number, y: number, z: number) => {
    const { alpha, beta, radius } = camera; // setting the target recomputes these from the old position
    camera.target = new Vector3(x, y, z);
    camera.alpha = alpha; camera.beta = beta; camera.radius = radius;
  },
  at: (label: string) => { const b = buildings.find((x) => x.id === labels.get(label)); return b ? { x: b.x, z: b.y, angle: b.angle, floors: b.floors } : null; },
  cutId: (id: number | null) => { cutMode = id !== null; cutId = id; renderer.setCutaway(id); },
  forceLod: (l: 0 | 1 | 2 | null) => { renderer.forceLod = l; },
  lodStats: () => renderer.stats(),
  resetStats: () => renderer.resetStats(),
  breakdown: () => renderer.lastBreakdown,
  adStats: () => adRenderer.stats(),
  /** World position of a station on the top floor of a building (for close-up shots). */
  stationWorld: (label: string, kind?: string) => {
    const b = buildings.find((x) => x.id === labels.get(label));
    if (!b) return null;
    const sts = stationsOf(b).filter((s) => !s.outside && (kind ? s.kind === kind : s.kind !== 'counter'));
    if (!sts.length) return null;
    const top = Math.max(...sts.map((s) => s.floor));
    const onTop = sts.filter((s) => s.floor === top);
    const st = onTop[Math.floor(onTop.length / 2)];
    const [x, z] = toWorld(b, st.lx, st.lz);
    return { x, y: st.floor * 3.2, z };
  },
  downtown: () => ({ ...DT }),
  perf: () => ({
    fps: Math.round(engine.getFps()), frameMs: +instr.frameTimeCounter.lastSecAverage.toFixed(2), syncMs: +syncMs.toFixed(2),
    drawCalls: instr.drawCallsCounter.current, active: scene.getActiveMeshes().length, meshes: scene.meshes.length, backlog: renderer.backlog,
    verts: scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length).reduce((n, m) => n + m.getTotalVertices(), 0),
  }),
  resetSync: () => { syncMs = 0; },
  /** Active meshes by kind of mesh (solid, win, clear, sign, far chunks, props...). */
  activeByTag: () => {
    const out: Record<string, number> = {};
    const act = scene.getActiveMeshes();
    for (let i = 0; i < act.length; i++) {
      const n = act.data[i].name;
      const tag = /^bld\d+-(\w+)/.exec(n)?.[1] ?? (n.startsWith('bldfar') ? 'far' : n.startsWith('prop-') ? 'prop' : n.split(/[-:]/)[0]);
      out[tag] = (out[tag] ?? 0) + 1;
    }
    return out;
  },
  rebuilds: () => renderer.rebuilds,
  grow: () => $('grow').click(),
  stats: () => $('stats').textContent,
  setBudget: (ms: number) => { renderer.budgetMs = ms; },
  /** Vertex count per bench label (heaviest first). */
  vertsByLabel: () => {
    const byId = new Map<number, number>();
    for (const m of scene.meshes) {
      const k = /^bld(\d+)-/.exec(m.name);
      if (k) byId.set(+k[1], (byId.get(+k[1]) ?? 0) + m.getTotalVertices());
    }
    return [...labels].map(([l, id]) => [l, byId.get(id) ?? 0] as [string, number]).sort((x, y) => y[1] - x[1]);
  },
  /** Build every building once with a throwaway renderer; returns ms total and vertex count. */
  timeBuild: () => {
    const r = new BuildingRenderer(scene, null);
    r.budgetMs = 1e9;
    r.forceLod = 1;
    const before = new Set(scene.meshes);
    const t0 = performance.now();
    for (let k = 0; k < 4; k++) r.sync(buildings, lookOf);
    const ms = performance.now() - t0;
    let verts = 0, meshes = 0;
    for (const m of scene.meshes) if (!before.has(m)) { verts += m.getTotalVertices(); meshes++; }
    r.dispose();
    return { ms: Math.round(ms), perBuilding: +(ms / buildings.length).toFixed(2), verts, meshes, buildings: buildings.length };
  },
};
