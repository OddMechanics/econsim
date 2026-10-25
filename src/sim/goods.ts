// Definitions: goods, job roles, and every kind of building with what it
// needs, who works there and what it makes. Tuning the economy mostly means
// editing numbers in this file and config.ts.

import { GOODS, type BuildingKind, type Good, type Inventory, type Pose, type Role, type Zone } from './types';

// ------------------------------------------------------------------- goods

export interface GoodDef {
  label: string;
  weight: number; // carry weight per unit
  laborGuess: number; // hours a newcomer imagines one unit takes to make (first price guess)
  nutrition?: number; // food points per unit when eaten
  joy?: number; // fun points per unit when eaten
  lifeDays?: number; // durables: how long one lasts
}

export const GOOD: Record<Good, GoodDef> = {
  crops: { label: 'grain', weight: 0.5, laborGuess: 0.4 },
  produce: { label: 'fruit & vegetables', weight: 0.5, laborGuess: 0.5, nutrition: 24, joy: 6 },
  milk: { label: 'milk', weight: 1, laborGuess: 0.35 },
  livestock: { label: 'livestock', weight: 2, laborGuess: 1.6 },
  wood: { label: 'wood', weight: 3, laborGuess: 0.4 },
  stone: { label: 'stone', weight: 4, laborGuess: 0.6 },
  clay: { label: 'clay', weight: 3, laborGuess: 0.5 },
  ore: { label: 'ore', weight: 4, laborGuess: 1 },
  groceries: { label: 'groceries', weight: 0.5, laborGuess: 0.6, nutrition: 34, joy: 5 },
  bread: { label: 'bread', weight: 0.4, laborGuess: 0.5, nutrition: 30, joy: 4 },
  dairy: { label: 'dairy', weight: 0.6, laborGuess: 0.6, nutrition: 28, joy: 7 },
  meat: { label: 'meat', weight: 0.6, laborGuess: 1.4, nutrition: 42, joy: 9 },
  planks: { label: 'planks', weight: 1.5, laborGuess: 0.6 },
  bricks: { label: 'bricks', weight: 2, laborGuess: 0.6 },
  steel: { label: 'steel', weight: 3, laborGuess: 2.5 },
  concrete: { label: 'concrete', weight: 4, laborGuess: 0.8 },
  glass: { label: 'glass', weight: 2, laborGuess: 1.8 },
  tools: { label: 'tools', weight: 2, laborGuess: 6, lifeDays: 40 },
  furniture: { label: 'furniture', weight: 6, laborGuess: 6, lifeDays: 250 },
  clothes: { label: 'clothes', weight: 0.5, laborGuess: 3, lifeDays: 45 },
  computers: { label: 'electronics', weight: 3, laborGuess: 25, lifeDays: 180 }, // computers, phones, TVs
  cars: { label: 'cars', weight: 0, laborGuess: 90, lifeDays: 400 },
};

/** What people eat (raw farm goods go to bakeries, dairies, meat plants and food plants first; fruit and vegetables are sold fresh). */
export const EDIBLE: Good[] = ['groceries', 'bread', 'produce', 'dairy', 'meat'];
/** How much of a day's portion each food spoils (fresh food quickly, packaged groceries and grain slowly). */
export const SPOIL: Partial<Record<Good, number>> = { crops: 0.01, produce: 0.06, milk: 0.12, groceries: 0.02, bread: 0.12, dairy: 0.05, meat: 0.06 };
/** Total food units in an inventory. */
export function foodIn(inv: Inventory): number {
  let n = 0;
  for (const g of EDIBLE) n += inv[g] ?? 0;
  return n;
}
/** Take food units from an inventory (a restaurant cooking): the most plentiful first. Returns what it got. */
export function takeFood(inv: Inventory, amount: number): number {
  let left = amount;
  for (let k = 0; k < EDIBLE.length && left > 1e-6; k++) {
    let best: Good | null = null;
    for (const g of EDIBLE) if ((inv[g] ?? 0) > 0.05 && (!best || inv[g] > inv[best])) best = g;
    if (!best) break;
    const t = Math.min(left, inv[best]);
    inv[best] -= t;
    left -= t;
  }
  return amount - left;
}
export const DURABLES: Good[] = ['clothes', 'furniture', 'computers', 'tools', 'cars'];
/** What stores sell to consumers (cars are sold by dealers). */
export const RETAIL_GOODS: Good[] = ['groceries', 'bread', 'produce', 'dairy', 'meat', 'clothes', 'furniture', 'tools', 'computers'];
/** Building materials (what construction sites order). */
export const MATERIALS: Good[] = ['planks', 'bricks', 'steel', 'concrete', 'glass', 'wood', 'stone'];

export function emptyInv(): Inventory {
  const inv = {} as Inventory;
  for (const g of GOODS) inv[g] = 0;
  return inv;
}

export function invWeight(inv: Inventory): number {
  let w = 0;
  for (const g of GOODS) w += inv[g] * GOOD[g].weight;
  return w;
}

export function invTotal(inv: Inventory): number {
  let n = 0;
  for (const g of GOODS) n += inv[g];
  return n;
}

export function addInv(to: Inventory, from: Partial<Inventory>, mult = 1): void {
  for (const [g, q] of Object.entries(from)) to[g as Good] += (q ?? 0) * mult;
}

// ------------------------------------------------------------------- roles

export type StationKind =
  | 'desk' | 'counter' | 'stove' | 'table' | 'machine' | 'field' | 'outdoor'
  | 'bay' | 'site' | 'shelf' | 'bed' | 'sofa' | 'stall' | 'bench' | 'showroom'
  | 'stage' | 'podium' | 'camera' | 'server' | 'seat'
  | 'spot'; // a standing spot (crowds at a rally, people waiting)

export interface RoleDef {
  label: string;
  pose: Pose;
  station: StationKind;
  /** Pay relative to the reference shift wage, when no market rate exists yet. */
  pay: number;
  /** Years of schooling employers expect. */
  edu: number;
}

export const ROLE: Record<Role, RoleDef> = {
  farmhand: { label: 'farmhand', pose: 'gather', station: 'field', pay: 0.85, edu: 0 },
  logger: { label: 'logger', pose: 'manual', station: 'outdoor', pay: 0.95, edu: 0 },
  quarrier: { label: 'quarry worker', pose: 'manual', station: 'outdoor', pay: 0.95, edu: 0 },
  miner: { label: 'miner', pose: 'manual', station: 'outdoor', pay: 1.1, edu: 0 },
  worker: { label: 'factory worker', pose: 'manual', station: 'machine', pay: 1.0, edu: 9 },
  cashier: { label: 'cashier', pose: 'stand', station: 'counter', pay: 0.8, edu: 9 },
  cook: { label: 'cook', pose: 'cook', station: 'stove', pay: 0.9, edu: 0 },
  waiter: { label: 'waiter', pose: 'serve', station: 'table', pay: 0.75, edu: 0 },
  driver: { label: 'driver', pose: 'drive', station: 'bay', pay: 1.05, edu: 9 },
  builder: { label: 'builder', pose: 'build', station: 'site', pay: 1.1, edu: 0 },
  clerk: { label: 'office clerk', pose: 'type', station: 'desk', pay: 1.25, edu: 12 },
  manager: { label: 'manager', pose: 'type', station: 'desk', pay: 2.2, edu: 14 },
  presenter: { label: 'TV presenter', pose: 'talk', station: 'stage', pay: 1.8, edu: 14 },
  journalist: { label: 'journalist', pose: 'type', station: 'desk', pay: 1.4, edu: 15 },
  programmer: { label: 'programmer', pose: 'type', station: 'desk', pay: 2.0, edu: 14 },
  official: { label: 'official', pose: 'talk', station: 'podium', pay: 1.6, edu: 0 },
  civil: { label: 'civil servant', pose: 'type', station: 'desk', pay: 1.2, edu: 12 },
  officer: { label: 'police officer', pose: 'walk', station: 'outdoor', pay: 1.25, edu: 12 },
  sales: { label: 'sales rep', pose: 'talk', station: 'desk', pay: 1.3, edu: 12 },
  doctor: { label: 'doctor', pose: 'talk', station: 'desk', pay: 3.2, edu: 18 },
  nurse: { label: 'nurse', pose: 'stand', station: 'counter', pay: 1.35, edu: 14 },
};

// --------------------------------------------------------------- buildings

export type Category = 'civic' | 'home' | 'primary' | 'industry' | 'service';
export type Service = 'retail' | 'meal' | 'freight' | 'build' | 'admin' | 'cars' | 'finance' | 'government' | 'tv' | 'net' | 'ads' | 'lease' | 'health';

export interface Recipe {
  inputs: Partial<Inventory>; // per worker-hour
  outputs: Partial<Inventory>;
  toolBoost: number;
}

export interface BuildingDef {
  label: string;
  category: Category;
  zones: Zone[]; // which lots it can go on
  w: number; // footprint (meters)
  d: number;
  floors: [number, number]; // min, max
  materials: Partial<Inventory>; // for the first floor
  perFloor?: Partial<Inventory>; // each extra floor
  workHours: number; // first floor; extra floors add 60% each
  shelter: number;
  comfort: number;
  unitsPerFloor: number; // homes per floor (0 for non-residential)
  decayPerDay: number;
  jobs: { role: Role; slots: number; perFloor?: number }[];
  recipe?: Recipe;
  output?: Good;
  service?: Service;
  /** Raw resource the workers go out to gather (lumberyard, quarry, mine). */
  gathers?: 'wood' | 'stone' | 'clay' | 'ore';
  hours: [number, number]; // shift start, end
  minFunds: number; // money a founder needs beyond building costs
  /** Towers: shops on the ground floor (number of shopfronts, downtown and in the inner city). */
  podium?: number;
  /** Office towers: every floor above the podium is a leasable office suite. */
  suites?: boolean;
  /** Can operate from a leased unit in a tower (shopfront or office suite) instead of its own building. */
  leasable?: 'shopfront' | 'suite';
  /** Delivered ready-made by an outside dealer (trailers): no construction company needed. */
  delivered?: number; // price
}

const h = (start: number, end: number): [number, number] => [start, end];

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  plaza: {
    label: 'Plaza', category: 'civic', zones: ['core', 'urban'], w: 30, d: 28, floors: [1, 1],
    materials: { stone: 40, concrete: 12 }, workHours: 30, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0005,
    jobs: [], hours: h(0, 24), minFunds: 0,
  },
  park: {
    label: 'Park', category: 'civic', zones: ['core', 'urban', 'suburb'], w: 34, d: 30, floors: [1, 1],
    materials: { wood: 10, stone: 10 }, workHours: 20, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0005,
    jobs: [], hours: h(0, 24), minFunds: 0,
  },
  trailer: {
    label: 'Trailer home', category: 'home', zones: ['suburb', 'rural'], w: 5, d: 15, floors: [1, 1],
    materials: {}, workHours: 2, shelter: 0.85, comfort: 0.3, unitsPerFloor: 1, decayPerDay: 0.003,
    jobs: [], hours: h(0, 0), minFunds: 0, delivered: 300,
  },
  house: {
    label: 'House', category: 'home', zones: ['suburb', 'rural'], w: 10, d: 9, floors: [1, 2],
    // a detached house is a lot of building for one household (that's why most city people rent)
    materials: { planks: 55, bricks: 55, concrete: 30, glass: 6 }, perFloor: { planks: 30, bricks: 40, concrete: 8, glass: 5 },
    workHours: 90, shelter: 1, comfort: 0.65, unitsPerFloor: 1, decayPerDay: 0.0015, jobs: [], hours: h(0, 0), minFunds: 0,
  },
  farmhouse: {
    label: 'Farmhouse', category: 'home', zones: ['rural'], w: 12, d: 10, floors: [1, 2],
    materials: { planks: 60, bricks: 60, concrete: 30, glass: 6 }, perFloor: { planks: 30, bricks: 40, concrete: 8, glass: 5 },
    workHours: 100, shelter: 1, comfort: 0.6, unitsPerFloor: 2, decayPerDay: 0.0015, jobs: [], hours: h(0, 0), minFunds: 0,
  },
  apartments: {
    label: 'Apartment block', category: 'home', zones: ['urban', 'suburb'], w: 17, d: 17, floors: [3, 10],
    materials: { concrete: 46, bricks: 24, steel: 6, glass: 8 }, perFloor: { concrete: 24, bricks: 14, steel: 3, glass: 6 },
    workHours: 44, shelter: 1, comfort: 0.55, unitsPerFloor: 5, decayPerDay: 0.001, jobs: [], hours: h(0, 0), minFunds: 40,
  },
  tower: {
    label: 'Residential tower', category: 'home', zones: ['core', 'urban'], w: 18, d: 18, floors: [10, 60],
    materials: { concrete: 120, steel: 40, glass: 26 }, perFloor: { concrete: 26, steel: 8, glass: 9 },
    workHours: 70, shelter: 1, comfort: 0.7, unitsPerFloor: 6, decayPerDay: 0.0008, jobs: [], hours: h(0, 0), minFunds: 200, podium: 2,
  },
  officetower: {
    label: 'Office tower', category: 'service', zones: ['core', 'urban'], w: 18, d: 18, floors: [8, 70],
    materials: { concrete: 120, steel: 50, glass: 40 }, perFloor: { concrete: 24, steel: 10, glass: 15 },
    workHours: 70, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0008, jobs: [], service: 'lease', hours: h(7, 20), minFunds: 200,
    podium: 2, suites: true,
  },
  farm: {
    label: 'Farm', category: 'primary', zones: ['rural'], w: 14, d: 10, floors: [1, 1],
    materials: { planks: 10, concrete: 8, steel: 2 }, workHours: 14, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'farmhand', slots: 6 }], recipe: { inputs: {}, outputs: { crops: 8 }, toolBoost: 1.4 }, output: 'crops',
    hours: h(7, 15), minFunds: 30,
  },
  vegfarm: {
    label: 'Vegetable farm', category: 'primary', zones: ['rural'], w: 14, d: 10, floors: [1, 1],
    materials: { planks: 10, concrete: 6, steel: 2, glass: 4 }, workHours: 14, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'farmhand', slots: 6 }], recipe: { inputs: {}, outputs: { produce: 7 }, toolBoost: 1.4 }, output: 'produce',
    hours: h(6, 14), minFunds: 30,
  },
  dairyfarm: {
    label: 'Dairy farm', category: 'primary', zones: ['rural'], w: 16, d: 10, floors: [1, 1],
    materials: { planks: 12, concrete: 10, steel: 3 }, workHours: 16, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'farmhand', slots: 4 }], recipe: { inputs: {}, outputs: { milk: 9 }, toolBoost: 1.3 }, output: 'milk',
    hours: h(5, 13), minFunds: 40,
  },
  ranch: {
    label: 'Livestock farm', category: 'primary', zones: ['rural'], w: 16, d: 10, floors: [1, 1],
    materials: { planks: 12, concrete: 8, steel: 3 }, workHours: 16, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'farmhand', slots: 4 }], recipe: { inputs: { crops: 1 }, outputs: { livestock: 2.2 }, toolBoost: 1.2 }, output: 'livestock',
    hours: h(6, 14), minFunds: 40,
  },
  lumberyard: {
    label: 'Logging company', category: 'primary', zones: ['rural', 'industrial'], w: 14, d: 12, floors: [1, 1],
    materials: { planks: 8, concrete: 6 }, workHours: 10, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'logger', slots: 6 }], gathers: 'wood', output: 'wood', hours: h(7, 15), minFunds: 30,
  },
  quarry: {
    label: 'Quarry', category: 'primary', zones: ['rural', 'industrial'], w: 14, d: 12, floors: [1, 1],
    materials: { planks: 6, concrete: 6, steel: 2 }, workHours: 10, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'quarrier', slots: 6 }], gathers: 'stone', output: 'stone', hours: h(7, 15), minFunds: 30,
  },
  claypit: {
    label: 'Clay pit', category: 'primary', zones: ['rural', 'industrial'], w: 14, d: 12, floors: [1, 1],
    materials: { planks: 6, concrete: 4 }, workHours: 8, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'quarrier', slots: 3 }], gathers: 'clay', output: 'clay', hours: h(7, 15), minFunds: 30,
  },
  mine: {
    label: 'Mine', category: 'primary', zones: ['rural', 'industrial'], w: 14, d: 12, floors: [1, 1],
    materials: { planks: 8, concrete: 8, steel: 4 }, workHours: 14, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'miner', slots: 8 }], gathers: 'ore', output: 'ore', hours: h(7, 15), minFunds: 40,
  },
  sawmill: {
    label: 'Sawmill', category: 'industry', zones: ['industrial', 'rural'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 14, steel: 6, planks: 4 }, workHours: 18, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6 }, { role: 'sales', slots: 1 }], recipe: { inputs: { wood: 1.6 }, outputs: { planks: 5 }, toolBoost: 1.3 }, output: 'planks',
    hours: h(7, 15), minFunds: 40,
  },
  brickworks: {
    label: 'Brickworks', category: 'industry', zones: ['industrial', 'rural'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 16, steel: 6 }, workHours: 18, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6 }, { role: 'sales', slots: 1 }], recipe: { inputs: { clay: 1.6, wood: 0.3 }, outputs: { bricks: 5 }, toolBoost: 1.3 }, output: 'bricks',
    hours: h(7, 15), minFunds: 40,
  },
  cementworks: {
    label: 'Cement and concrete plant', category: 'industry', zones: ['industrial'], w: 20, d: 16, floors: [1, 1],
    materials: { concrete: 20, steel: 14 }, workHours: 26, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 8 }, { role: 'sales', slots: 1 }], recipe: { inputs: { stone: 2.4, wood: 0.3 }, outputs: { concrete: 5 }, toolBoost: 1.2 }, output: 'concrete',
    hours: h(6, 14), minFunds: 80,
  },
  glassworks: {
    label: 'Glassworks', category: 'industry', zones: ['industrial'], w: 20, d: 16, floors: [1, 1],
    materials: { concrete: 22, steel: 12, bricks: 10 }, workHours: 28, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 8 }, { role: 'sales', slots: 1 }], recipe: { inputs: { stone: 1.4, wood: 0.4 }, outputs: { glass: 2.2 }, toolBoost: 1.2 }, output: 'glass',
    hours: h(7, 15), minFunds: 100,
  },
  steelmill: {
    label: 'Steel mill', category: 'industry', zones: ['industrial'], w: 22, d: 18, floors: [1, 1],
    materials: { concrete: 30, bricks: 20, steel: 10 }, workHours: 40, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 12 }, { role: 'sales', slots: 1 }], recipe: { inputs: { ore: 1.9, wood: 0.9 }, outputs: { steel: 1.6 }, toolBoost: 1.2 }, output: 'steel',
    hours: h(7, 15), minFunds: 120,
  },
  foodplant: {
    label: 'Food plant', category: 'industry', zones: ['industrial', 'urban'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 18, steel: 6, glass: 2 }, workHours: 24, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 10 }, { role: 'sales', slots: 1 }], recipe: { inputs: { crops: 4 }, outputs: { groceries: 6 }, toolBoost: 1.2 },
    output: 'groceries', hours: h(7, 15), minFunds: 60,
  },
  bakery: {
    label: 'Bakery', category: 'industry', zones: ['industrial', 'urban'], w: 14, d: 12, floors: [1, 1],
    materials: { concrete: 12, bricks: 8, steel: 3, glass: 2 }, workHours: 18, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6 }, { role: 'sales', slots: 1 }], recipe: { inputs: { crops: 3 }, outputs: { bread: 5 }, toolBoost: 1.2 },
    output: 'bread', hours: h(4, 12), minFunds: 50,
  },
  dairyplant: {
    label: 'Dairy', category: 'industry', zones: ['industrial', 'urban'], w: 16, d: 14, floors: [1, 1],
    materials: { concrete: 16, steel: 6, glass: 2 }, workHours: 22, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6 }, { role: 'sales', slots: 1 }], recipe: { inputs: { milk: 5 }, outputs: { dairy: 4 }, toolBoost: 1.2 },
    output: 'dairy', hours: h(6, 14), minFunds: 60,
  },
  meatplant: {
    label: 'Meat plant', category: 'industry', zones: ['industrial'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 18, steel: 7, glass: 1 }, workHours: 24, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 8 }, { role: 'sales', slots: 1 }], recipe: { inputs: { livestock: 2 }, outputs: { meat: 3 }, toolBoost: 1.2 },
    output: 'meat', hours: h(6, 14), minFunds: 60,
  },
  workshop: {
    label: 'Tool factory', category: 'industry', zones: ['industrial', 'urban'], w: 14, d: 12, floors: [1, 1],
    materials: { concrete: 12, steel: 6, glass: 2 }, workHours: 18, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6 }, { role: 'sales', slots: 1 }], recipe: { inputs: { steel: 0.25, planks: 0.15 }, outputs: { tools: 0.5 }, toolBoost: 1.2 },
    output: 'tools', hours: h(7, 15), minFunds: 60,
  },
  furniture: {
    label: 'Furniture factory', category: 'industry', zones: ['industrial', 'urban'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 14, steel: 6, glass: 2 }, workHours: 22, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 8 }, { role: 'sales', slots: 1 }], recipe: { inputs: { planks: 1.6 }, outputs: { furniture: 0.45 }, toolBoost: 1.2 },
    output: 'furniture', hours: h(7, 15), minFunds: 60,
  },
  textile: {
    label: 'Clothing factory', category: 'industry', zones: ['industrial', 'urban'], w: 18, d: 14, floors: [1, 2],
    materials: { concrete: 16, steel: 6, glass: 3 }, workHours: 22, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 6, perFloor: 4 }, { role: 'sales', slots: 1 }], recipe: { inputs: { crops: 1.4 }, outputs: { clothes: 1 }, toolBoost: 1.2 },
    output: 'clothes', hours: h(7, 15), minFunds: 60,
  },
  electronics: {
    label: 'Electronics factory', category: 'industry', zones: ['industrial', 'urban'], w: 20, d: 16, floors: [1, 3],
    materials: { concrete: 24, steel: 12, glass: 8 }, workHours: 36, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 8, perFloor: 5 }, { role: 'sales', slots: 1 }], recipe: { inputs: { steel: 0.25 }, outputs: { computers: 0.4 }, toolBoost: 1.2 },
    output: 'computers', hours: h(8, 16), minFunds: 150,
  },
  carplant: {
    label: 'Car factory', category: 'industry', zones: ['industrial'], w: 26, d: 20, floors: [1, 1],
    materials: { concrete: 40, steel: 30, glass: 6 }, workHours: 50, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'worker', slots: 16 }, { role: 'sales', slots: 1 }], recipe: { inputs: { steel: 1.6, planks: 0.25, glass: 0.3 }, outputs: { cars: 0.08 }, toolBoost: 1.2 },
    output: 'cars', hours: h(7, 15), minFunds: 250,
  },
  store: {
    label: 'Store', category: 'service', zones: ['core', 'urban', 'suburb'], w: 14, d: 12, floors: [1, 2],
    materials: { concrete: 14, bricks: 10, glass: 6, steel: 3 }, workHours: 20, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0015,
    jobs: [{ role: 'cashier', slots: 3, perFloor: 2 }], service: 'retail', hours: h(8, 21), minFunds: 80, leasable: 'shopfront',
  },
  dealer: {
    label: 'Car dealer', category: 'service', zones: ['urban', 'suburb', 'industrial'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 14, steel: 6, glass: 10 }, workHours: 20, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0015,
    jobs: [{ role: 'cashier', slots: 1 }, { role: 'sales', slots: 1 }], service: 'cars', hours: h(9, 19), minFunds: 200,
  },
  restaurant: {
    label: 'Restaurant', category: 'service', zones: ['core', 'urban', 'suburb'], w: 14, d: 12, floors: [1, 1],
    materials: { concrete: 12, bricks: 10, glass: 5, planks: 4 }, workHours: 20, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0015,
    jobs: [{ role: 'cook', slots: 3 }, { role: 'waiter', slots: 3 }], service: 'meal', hours: h(11, 22), minFunds: 60, leasable: 'shopfront',
  },
  clinic: {
    label: 'Clinic', category: 'service', zones: ['core', 'urban', 'suburb'], w: 14, d: 12, floors: [1, 2],
    materials: { concrete: 14, bricks: 10, glass: 6, steel: 3 }, workHours: 24, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0015,
    jobs: [{ role: 'doctor', slots: 2 }, { role: 'nurse', slots: 2 }], service: 'health', hours: h(8, 18), minFunds: 150, leasable: 'shopfront',
  },
  hospital: {
    label: 'Hospital', category: 'service', zones: ['core', 'urban', 'suburb'], w: 30, d: 24, floors: [3, 8],
    materials: { concrete: 120, steel: 30, glass: 30, bricks: 40 }, perFloor: { concrete: 40, steel: 10, glass: 10 }, workHours: 300, shelter: 0.9, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.001,
    jobs: [{ role: 'doctor', slots: 2, perFloor: 1 }, { role: 'nurse', slots: 4, perFloor: 2 }], service: 'health', hours: h(7, 19), minFunds: 1500,
  },
  office: {
    label: 'Office', category: 'service', zones: ['core', 'urban'], w: 16, d: 14, floors: [2, 12],
    materials: { concrete: 30, steel: 12, glass: 14 }, perFloor: { concrete: 16, steel: 5, glass: 8 },
    workHours: 40, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.001,
    jobs: [{ role: 'manager', slots: 1 }, { role: 'clerk', slots: 2, perFloor: 3 }], service: 'admin', hours: h(9, 17), minFunds: 200, leasable: 'suite',
  },
  depot: {
    label: 'Logistics depot', category: 'service', zones: ['industrial', 'urban'], w: 20, d: 16, floors: [1, 1],
    materials: { concrete: 16, steel: 8 }, workHours: 20, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'driver', slots: 4 }], service: 'freight', hours: h(6, 18), minFunds: 120,
  },
  bank: {
    label: 'Bank', category: 'service', zones: ['core', 'urban'], w: 16, d: 14, floors: [1, 6],
    materials: { concrete: 26, steel: 8, glass: 12 }, perFloor: { concrete: 14, steel: 4, glass: 7 }, workHours: 30, shelter: 0, comfort: 0, unitsPerFloor: 0,
    decayPerDay: 0.001, jobs: [{ role: 'manager', slots: 1 }, { role: 'clerk', slots: 2, perFloor: 2 }], service: 'finance', hours: h(9, 17), minFunds: 300, leasable: 'shopfront',
  },
  adco: {
    label: 'Outdoor advertising company', category: 'service', zones: ['urban', 'industrial', 'core'], w: 16, d: 14, floors: [1, 2],
    materials: { concrete: 14, steel: 6, glass: 5 }, workHours: 18, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.0015,
    jobs: [{ role: 'sales', slots: 2 }, { role: 'worker', slots: 2 }], service: 'ads', hours: h(8, 17), minFunds: 200, leasable: 'suite',
  },
  cityhall: {
    label: 'City hall', category: 'civic', zones: ['core'], w: 22, d: 18, floors: [2, 6],
    materials: { concrete: 40, stone: 24, glass: 12, steel: 8 }, perFloor: { concrete: 20, glass: 6, steel: 3 }, workHours: 50, shelter: 0, comfort: 0, unitsPerFloor: 0,
    decayPerDay: 0.0008, jobs: [{ role: 'civil', slots: 3, perFloor: 1 }, { role: 'officer', slots: 0 }, { role: 'builder', slots: 0 }], service: 'government', hours: h(9, 17), minFunds: 0,
  },
  studio: {
    label: 'TV studio', category: 'service', zones: ['core', 'urban'], w: 18, d: 16, floors: [1, 4],
    materials: { concrete: 24, steel: 10, glass: 8 }, perFloor: { concrete: 14, steel: 4, glass: 6 }, workHours: 36, shelter: 0, comfort: 0, unitsPerFloor: 0,
    decayPerDay: 0.001, jobs: [{ role: 'presenter', slots: 2 }, { role: 'journalist', slots: 2, perFloor: 1 }, { role: 'sales', slots: 1 }], service: 'tv', hours: h(10, 22), minFunds: 250,
  },
  netco: {
    label: 'Internet company', category: 'service', zones: ['core', 'urban'], w: 16, d: 14, floors: [2, 12],
    materials: { concrete: 24, steel: 10, glass: 12 }, perFloor: { concrete: 14, steel: 4, glass: 8 }, workHours: 36, shelter: 0, comfort: 0, unitsPerFloor: 0,
    decayPerDay: 0.001, jobs: [{ role: 'manager', slots: 1 }, { role: 'programmer', slots: 3, perFloor: 2 }, { role: 'sales', slots: 1 }], service: 'net', hours: h(9, 18), minFunds: 150, leasable: 'suite',
  },
  yard: {
    label: 'Construction company', category: 'service', zones: ['industrial', 'urban', 'suburb'], w: 18, d: 14, floors: [1, 1],
    materials: { concrete: 8, steel: 4, planks: 4 }, workHours: 12, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0.002,
    jobs: [{ role: 'builder', slots: 8 }, { role: 'manager', slots: 1 }], service: 'build', hours: h(7, 15), minFunds: 80,
  },
  shopfront: {
    label: 'Vacant shop', category: 'service', zones: ['core', 'urban'], w: 9, d: 10, floors: [1, 1],
    materials: {}, workHours: 0, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0, jobs: [], hours: h(0, 0), minFunds: 0,
  },
  suite: {
    label: 'Vacant office floor', category: 'service', zones: ['core', 'urban'], w: 16, d: 16, floors: [1, 1],
    materials: {}, workHours: 0, shelter: 0, comfort: 0, unitsPerFloor: 0, decayPerDay: 0, jobs: [], hours: h(0, 0), minFunds: 0,
  },
};

/** Kinds of company a person can start (towers are developments, see development.ts; units come with towers). */
export const BUSINESS_KINDS = (Object.keys(BUILDINGS) as BuildingKind[]).filter(
  // (hospitals are built by cities and hospital groups, not by one person)
  (k) => BUILDINGS[k].category !== 'home' && BUILDINGS[k].category !== 'civic' && k !== 'officetower' && k !== 'shopfront' && k !== 'suite' && k !== 'hospital',
);

/** Towers (residential or office): built by developers, hosting shops and office suites. */
export const TOWERS: BuildingKind[] = ['tower', 'officetower'];

/**
 * How much a real building takes compared with the table above (materials by
 * the truckload, crews for weeks): a house costs a few months of a typical
 * wage, a tower block a fortune. Tuning knob for how fast a city can build.
 */
export const BUILD_SCALE = { materials: 1.5, hours: 1.5 };

export function materialsFor(kind: BuildingKind, floors: number): Inventory {
  const def = BUILDINGS[kind];
  const inv = emptyInv();
  addInv(inv, def.materials, BUILD_SCALE.materials);
  if (def.perFloor) addInv(inv, def.perFloor, (floors - 1) * BUILD_SCALE.materials);
  return inv;
}

export function workHoursFor(kind: BuildingKind, floors: number): number {
  // upper floors of towers repeat the same plan, so they go up faster
  const perFloor = kind === 'tower' || kind === 'officetower' ? 0.3 : kind === 'apartments' || kind === 'office' || kind === 'bank' || kind === 'netco' ? 0.4 : 0.6;
  return BUILDINGS[kind].workHours * (1 + perFloor * (floors - 1)) * BUILD_SCALE.hours;
}

/** Offices and internet companies fill their floors with desks (about one per 12 m² of floor). */
const DESK_ROLE: Partial<Record<BuildingKind, Role>> = { office: 'clerk', netco: 'programmer' };

/** Jobs at a workplace of this kind and size (pass the footprint for desk-based workplaces). */
export function slotsFor(kind: BuildingKind, floors: number, w?: number, d?: number): { role: Role; slots: number }[] {
  const base = BUILDINGS[kind].jobs.map((j) => ({ role: j.role, slots: j.slots + (j.perFloor ?? 0) * (floors - 1) }));
  const role = DESK_ROLE[kind];
  if (!role || w === undefined || d === undefined) return base;
  const desks = Math.floor(((w - 2) * (d - 2)) / 12) * floors;
  const others = base.reduce((n, j) => n + (j.role === role ? 0 : j.slots), 0);
  return base.map((j) => (j.role === role ? { role, slots: Math.max(j.slots, desks - others) } : j));
}

export function unitsFor(kind: BuildingKind, floors: number): number {
  // a tower's ground floor is shops and the lobby
  return BUILDINGS[kind].unitsPerFloor * (BUILDINGS[kind].podium ? floors - 1 : floors);
}

/**
 * How tall to build: downtown lots get taller buildings, and the bigger the
 * city, the taller (within each kind's range).
 */
export function chooseFloors(kind: BuildingKind, zone: Zone, population: number, rnd: number): number {
  const [lo, hi] = BUILDINGS[kind].floors;
  if (hi <= lo) return lo;
  const cat = BUILDINGS[kind].category;
  let want = lo;
  if (zone === 'core') want = lo + 1 + Math.floor(rnd * 2) + Math.floor(population / 80);
  else if (zone === 'urban') want = lo + Math.floor(rnd * 2) + Math.floor(population / 150);
  if (cat === 'industry') want = Math.min(want, lo + 1);
  return Math.max(lo, Math.min(hi, want));
}

export function comfortOf(kind: BuildingKind, floors: number, condition: number): number {
  const base = BUILDINGS[kind].comfort + (kind === 'house' ? 0.15 * (floors - 1) : 0);
  return base * (0.4 + 0.6 * condition);
}
