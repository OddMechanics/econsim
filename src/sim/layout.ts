// Interior layouts. A building only stores abstract facts (kind, size, floors,
// seed); where its desks, counters, stoves, tables and beds are is generated
// from those facts, so it's the same every time. The simulation uses the
// stations to place people; the renderer draws furniture at the same spots.
//
// Local coordinates: origin at the building's center on the ground, `lz`
// points toward the front (the road), `lx` to the right when facing the front.

import { BUILDINGS, slotsFor, type StationKind } from './goods';
import { hash2 } from './rng';
import type { Building, BuildingKind, Role } from './types';

export const FLOOR_H = 3.2;

export interface Station {
  lx: number;
  lz: number;
  floor: number;
  kind: StationKind;
  facing: number; // local yaw in radians, 0 = facing the front (+lz)
  role?: Role; // staff station for this role; undefined = customer/resident spot
  unit?: number; // apartment unit
  outside?: boolean; // in the lot around the building (fields, yards)
}

const cache = new Map<string, Station[]>();

/**
 * Stations of a building. Units inside a tower (shops, office suites) have a
 * `level`: their stations' floors are counted from the tower's ground floor.
 */
export function stationsOf(b: Pick<Building, 'kind' | 'w' | 'd' | 'floors' | 'seed'> & { level?: number }): Station[] {
  const level = b.level ?? 0;
  const key = `${b.kind}|${b.w}|${b.d}|${b.floors}|${b.seed}|${level}`;
  let s = cache.get(key);
  if (!s) {
    s = generate(b.kind, b.w, b.d, b.floors, b.seed);
    if (level) for (const st of s) st.floor += level;
    cache.set(key, s);
    if (cache.size > 6000) cache.clear();
  }
  return s;
}

/** Staff stations for a role, in a stable order (index = seat number). */
export function staffStations(b: Building, role: Role): Station[] {
  return stationsOf(b).filter((s) => s.role === role);
}

export function customerStations(b: Building, kind?: StationKind): Station[] {
  return stationsOf(b).filter((s) => s.role === undefined && (kind === undefined || s.kind === kind));
}

/** World position (sim x/y) of a local point in a building. */
export function toWorld(b: Pick<Building, 'x' | 'y' | 'angle'>, lx: number, lz: number): [number, number] {
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle); // front
  const rx = Math.sin(b.angle), ry = -Math.cos(b.angle); // right
  return [b.x + rx * lx + fx * lz, b.y + ry * lx + fy * lz];
}

/** World heading for a local facing angle. */
export function worldHeading(b: Pick<Building, 'angle'>, facing: number): number {
  return b.angle - facing;
}

/** The front door, just outside the building, in world coordinates. */
export function doorOf(b: Pick<Building, 'x' | 'y' | 'angle' | 'd'>): [number, number] {
  return toWorld(b, 0, b.d / 2 + 1.2);
}

function generate(kind: BuildingKind, w: number, d: number, floors: number, seed: number): Station[] {
  const out: Station[] = [];
  const rnd = (k: number) => hash2(seed, k);
  const def = BUILDINGS[kind];
  const slots = slotsFor(kind, floors, w, d);
  const staff = (role: Role) => slots.find((s) => s.role === role)?.slots ?? 0;
  const iw = w - 2, id = d - 2; // inner size

  const grid = (n: number, floor: number, k: StationKind, role: Role | undefined, x0: number, x1: number, z0: number, z1: number, facing: number) => {
    if (n <= 0) return;
    const cols = Math.max(1, Math.round(Math.sqrt(n * (x1 - x0) / Math.max(1, z1 - z0))));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      out.push({
        lx: x0 + ((c + 0.5) / cols) * (x1 - x0),
        lz: z0 + ((r + 0.5) / rows) * (z1 - z0),
        floor, kind: k, facing, role,
      });
    }
  };

  switch (kind) {
    case 'plaza': {
      // a speaker's spot at the far end, benches around the edge, room for a crowd in the middle
      out.push({ lx: 0, lz: -id / 2 + 3, floor: 0, kind: 'stage', facing: 0, outside: true });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        out.push({ lx: Math.cos(a) * (iw / 2 - 2), lz: Math.sin(a) * (id / 2 - 2), floor: 0, kind: 'bench', facing: Math.atan2(-Math.cos(a), -Math.sin(a)), outside: true });
      }
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) out.push({ lx: -7 + c * 2, lz: -id / 2 + 7 + r * 1.8, floor: 0, kind: 'spot', facing: Math.PI, outside: true });
      break;
    }
    case 'park': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        out.push({ lx: Math.cos(a) * (iw / 3), lz: Math.sin(a) * (id / 3), floor: 0, kind: 'bench', facing: Math.atan2(-Math.cos(a), -Math.sin(a)), outside: true });
      }
      for (let i = 0; i < 10; i++) out.push({ lx: -iw / 2 + 3 + (i % 5) * ((iw - 6) / 4), lz: (i < 5 ? -1 : 1) * (id / 2 - 3), floor: 0, kind: 'spot', facing: i < 5 ? 0 : Math.PI, outside: true });
      break;
    }
    case 'trailer':
      // a single-wide: bedroom at one end, living room at the other
      out.push({ lx: 0, lz: -id / 2 + 1.6, floor: 0, kind: 'bed', facing: 0, unit: 0 });
      out.push({ lx: 0, lz: id / 2 - 2, floor: 0, kind: 'sofa', facing: Math.PI, unit: 0 });
      break;
    case 'house':
      for (let f = 0; f < floors; f++) {
        out.push({ lx: -iw / 4, lz: -id / 4, floor: f, kind: 'bed', facing: 0, unit: 0 });
        out.push({ lx: iw / 4, lz: id / 4, floor: f, kind: 'sofa', facing: Math.PI, unit: 0 });
        out.push({ lx: iw / 4, lz: -id / 4, floor: f, kind: 'desk', facing: Math.PI, unit: 0 });
      }
      break;
    case 'apartments':
    case 'tower': {
      // flats around a central core (stairs and lifts); a tower's ground floor is shops and the lobby
      const per = def.unitsPerFloor;
      const first = def.podium ? 1 : 0;
      for (let f = first; f < floors; f++) {
        for (let u = 0; u < per; u++) {
          // flats in a ring around the core: front row, back row, and (6+) one at each side
          const a = ((u + 0.5) / per) * Math.PI * 2 + 0.2;
          const ux = Math.cos(a), uz = Math.sin(a);
          const cx = ux * iw * 0.32, cz = uz * id * 0.32;
          const unit = (f - first) * per + u;
          const out_ = Math.atan2(ux, uz); // facing away from the core
          out.push({ lx: cx + uz * 1.4, lz: cz - ux * 1.4, floor: f, kind: 'bed', facing: out_, unit });
          out.push({ lx: cx - uz * 1.3, lz: cz + ux * 1.3, floor: f, kind: 'sofa', facing: out_ + Math.PI, unit });
          out.push({ lx: cx + ux * 0.9, lz: cz + uz * 0.9, floor: f, kind: 'desk', facing: out_, unit });
        }
      }
      if (def.podium) out.push({ lx: 0, lz: id / 2 - 1.5, floor: 0, kind: 'counter', facing: 0 }); // the lobby desk
      break;
    }
    case 'officetower':
      // the lobby: a reception and security desk (the offices above are suites, buildings of their own)
      out.push({ lx: 0, lz: id / 2 - 2, floor: 0, kind: 'counter', facing: 0 });
      for (let i = 0; i < 4; i++) out.push({ lx: -iw / 2 + 2 + i * 1.6, lz: id / 2 - 4, floor: 0, kind: 'seat', facing: Math.PI / 2 });
      break;
    case 'shopfront':
    case 'suite':
      break; // empty, for lease
    case 'office':
    case 'bank': {
      const perFloor = Math.ceil((staff('clerk') + staff('manager')) / floors) + 1;
      for (let f = 0; f < floors; f++) {
        const n = perFloor;
        grid(n, f, 'desk', 'clerk', -iw / 2 + 1, iw / 2 - 1, -id / 2 + 1, id / 2 - 2, Math.PI);
      }
      // the last desk on the top floor is the manager's
      const desks = out.filter((s) => s.kind === 'desk');
      desks[desks.length - 1].role = 'manager';
      out.push({ lx: 0, lz: id / 2 - 1, floor: 0, kind: 'counter', facing: 0 }); // reception (visitors)
      break;
    }
    case 'cityhall': {
      // the front steps: speeches, rallies and protests outside city hall
      outdoorCrowd(out, id / 2 + 2.5, iw);
      // council chamber on the top floor: the presiding officer at a podium, seats in an arc
      const top = floors - 1;
      out.push({ lx: 0, lz: -id / 2 + 1.5, floor: top, kind: 'podium', facing: 0, role: 'official' });
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 8));
        out.push({ lx: Math.cos(a) * (iw / 2 - 1.5), lz: -id / 2 + 1.5 + Math.sin(a) * (id / 2 - 1), floor: top, kind: 'desk', facing: Math.PI - (a - Math.PI / 2), role: 'official' });
      }
      // public gallery
      for (let i = 0; i < 8; i++) out.push({ lx: -iw / 2 + 2 + (i % 4) * ((iw - 4) / 3), lz: id / 2 - 2 - Math.floor(i / 4) * 1.4, floor: top, kind: 'seat', facing: Math.PI });
      // clerks below
      grid(staff('civil'), 0, 'desk', 'civil', -iw / 2 + 1, iw / 2 - 1, -id / 2 + 1, id / 2 - 3, Math.PI);
      out.push({ lx: 0, lz: id / 2 - 1, floor: 0, kind: 'counter', facing: 0 });
      break;
    }
    case 'studio': {
      // the set: a news desk / debate podiums facing cameras, a newsroom behind
      out.push({ lx: -2, lz: -id / 2 + 3, floor: 0, kind: 'stage', facing: 0, role: 'presenter' });
      out.push({ lx: 2, lz: -id / 2 + 3, floor: 0, kind: 'stage', facing: 0, role: 'presenter' });
      for (let i = 0; i < 3; i++) out.push({ lx: -4 + i * 4, lz: -id / 2 + 5.5, floor: 0, kind: 'podium', facing: 0 });
      for (let i = 0; i < 2; i++) out.push({ lx: -3 + i * 6, lz: 2, floor: 0, kind: 'camera', facing: Math.PI });
      for (let i = 0; i < 6; i++) out.push({ lx: -iw / 2 + 1.5 + (i % 3) * ((iw - 3) / 2), lz: id / 2 - 1.5 - Math.floor(i / 3) * 2, floor: 0, kind: 'seat', facing: Math.PI });
      // the newsroom: upstairs, or at the back of the ground floor, away from the set and cameras
      for (let f = 0; f < floors; f++) grid(Math.ceil(staff('journalist') / floors) + 1, f, 'desk', 'journalist', -iw / 2 + 1, iw / 2 - 1, f === 0 ? id / 2 - 6 : 0, id / 2 - (f === 0 ? 1.5 : 4), Math.PI);
      break;
    }
    case 'netco': {
      const perFloor = Math.ceil((staff('programmer') + 1) / floors) + 1;
      for (let f = 0; f < floors; f++) grid(perFloor, f, 'desk', 'programmer', -iw / 2 + 1, iw / 2 - 3, -id / 2 + 1, id / 2 - 2, Math.PI);
      const desks = out.filter((s) => s.kind === 'desk');
      desks[desks.length - 1].role = 'manager';
      for (let i = 0; i < 3; i++) out.push({ lx: iw / 2 - 1.2, lz: -id / 2 + 2 + i * 1.6, floor: 0, kind: 'server', facing: -Math.PI / 2 });
      break;
    }
    case 'store': {
      const cashiers = staff('cashier');
      for (let i = 0; i < cashiers; i++) out.push({ lx: -iw / 2 + 2 + i * 2.6, lz: id / 2 - 2.2, floor: 0, kind: 'counter', facing: 0, role: 'cashier' });
      grid(6, 0, 'shelf', undefined, -iw / 2 + 1.5, iw / 2 - 1.5, -id / 2 + 1, id / 4, 0);
      break;
    }
    case 'dealer': {
      out.push({ lx: -iw / 2 + 2, lz: -id / 2 + 2, floor: 0, kind: 'counter', facing: 0, role: 'cashier' });
      for (let i = 0; i < 4; i++) out.push({ lx: -iw / 2 + 4 + i * ((iw - 6) / 3), lz: d / 2 + 3, floor: 0, kind: 'showroom', facing: 0, outside: true });
      grid(3, 0, 'showroom', undefined, -iw / 4, iw / 2 - 2, -id / 4, id / 4, 0);
      break;
    }
    case 'restaurant': {
      const cooks = staff('cook'), waiters = staff('waiter');
      for (let i = 0; i < cooks; i++) out.push({ lx: -iw / 2 + 2 + i * 2.4, lz: -id / 2 + 1.2, floor: 0, kind: 'stove', facing: Math.PI, role: 'cook' });
      for (let i = 0; i < waiters; i++) out.push({ lx: iw / 2 - 2 - i * 2, lz: -id / 2 + 3.5, floor: 0, kind: 'table', facing: 0, role: 'waiter' });
      // tables with 2 seats facing each other
      const tables = 6;
      for (let t = 0; t < tables; t++) {
        const c = t % 3, r = Math.floor(t / 3);
        const tx = -iw / 2 + 2.5 + c * ((iw - 5) / 2), tz = -id / 2 + 6 + r * 3.2;
        out.push({ lx: tx, lz: tz - 0.7, floor: 0, kind: 'table', facing: 0 });
        out.push({ lx: tx, lz: tz + 0.7, floor: 0, kind: 'table', facing: Math.PI });
      }
      break;
    }
    case 'depot':
      for (let i = 0; i < Math.max(2, staff('driver')); i++) out.push({ lx: -iw / 2 + 3 + i * 4, lz: d / 2 + 2, floor: 0, kind: 'bay', facing: Math.PI, role: 'driver', outside: true });
      break;
    case 'yard':
      grid(staff('builder'), 0, 'outdoor', 'builder', -iw / 2 + 1, iw / 2 - 1, -d / 2 - 6, -d / 2 - 2, 0);
      out.forEach((s) => { s.outside = true; });
      break;
    case 'farm': {
      // fields behind the farmhouse
      const n = staff('farmhand');
      for (let i = 0; i < n; i++) {
        out.push({ lx: -18 + ((i + 0.5) / n) * 36, lz: -d / 2 - 10 - rnd(i) * 14, floor: 0, kind: 'field', facing: 0, role: 'farmhand', outside: true });
      }
      break;
    }
    case 'lumberyard':
    case 'quarry':
    case 'claypit':
    case 'mine': {
      const role = def.jobs[0].role;
      for (let i = 0; i < staff(role); i++) out.push({ lx: -iw / 2 + 2 + i * 3, lz: -d / 2 - 3, floor: 0, kind: 'outdoor', facing: 0, role, outside: true });
      break;
    }
    case 'adco': {
      // ad sales at desks; the installers' workbench (they put up billboards around the city)
      grid(staff('sales'), 0, 'desk', 'sales', -iw / 2 + 1, iw / 2 - 1, -id / 2 + 1, 0, Math.PI);
      grid(staff('worker'), 0, 'machine', 'worker', -iw / 2 + 1.5, iw / 2 - 1.5, 1, id / 2 - 1.5, 0);
      break;
    }
    default: {
      // factories and mills: rows of machines (and a small front office)
      const role = def.jobs[0]?.role ?? 'worker';
      const n = staff(role);
      grid(n, 0, 'machine', role, -iw / 2 + 1.5, iw / 2 - 1.5, -id / 2 + 1.5, id / 2 - 3.5, 0);
      break;
    }
  }
  // any role still without a place (sales reps, a construction company's manager): desks by the front
  for (const { role, slots: n } of slots) {
    if (n <= 0 || out.some((st) => st.role === role)) continue;
    for (let i = 0; i < n; i++) out.push({ lx: iw / 2 - 1.2 - i * 1.8, lz: id / 2 - 1.4, floor: 0, kind: 'desk', facing: Math.PI, role });
  }
  return out;
}

/** A speaker's spot at the front (facing the street) and standing room for a crowd in front of it. */
function outdoorCrowd(out: Station[], front: number, iw: number): void {
  out.push({ lx: 0, lz: front, floor: 0, kind: 'stage', facing: 0, outside: true });
  const cols = Math.max(4, Math.min(8, Math.floor(iw / 1.6)));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ lx: (c - (cols - 1) / 2) * 1.5 + (r % 2) * 0.5, lz: front + 2.2 + r * 1.3, floor: 0, kind: 'spot', facing: Math.PI, outside: true });
    }
  }
}
