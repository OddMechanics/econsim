import { MAP, REGROW_PER_DAY, WORLD } from './config';
import { hash2, Rng } from './rng';
import type { ResourceKind, TileKind, World } from './types';

export const WOOD_CAP = 30;
export const STONE_CAP = 200;

export function tileOf(w: World, x: number, y: number): number {
  const tx = Math.min(w.size - 1, Math.max(0, Math.floor(x / w.tile)));
  const ty = Math.min(w.size - 1, Math.max(0, Math.floor(y / w.tile)));
  return ty * w.size + tx;
}

export function tileCenter(w: World, i: number): [number, number] {
  return [((i % w.size) + 0.5) * w.tile, (Math.floor(i / w.size) + 0.5) * w.tile];
}

export function tileXY(w: World, i: number): [number, number] {
  return [i % w.size, Math.floor(i / w.size)];
}

export function mapSize(w: World): number {
  return w.size * w.tile;
}

// ------------------------------------------------------------ the countryside
//
// Only the city's 2 x 2 km in the middle of the map is stored as tiles. The
// countryside around it (MAP) is described by formulas of position and the
// world's seed: its height, where the woods are, how good the soil is. The
// same formulas draw the ground, so what stands on it sits on it.

/** On the city's stored grid? */
export function inGrid(w: World, x: number, y: number): boolean {
  const S = w.size * w.tile;
  return x >= 0 && y >= 0 && x < S && y < S;
}

/** On the map at all (the countryside included), at least `margin` from its edge? */
export function onLand(x: number, y: number, margin = 0): boolean {
  return x >= MAP.min + margin && y >= MAP.min + margin && x <= MAP.max - margin && y <= MAP.max - margin;
}

/** How far outside the city's grid a point is (0 on it). */
export function beyondGrid(w: World, x: number, y: number): number {
  const S = w.size * w.tile;
  const dx = x < 0 ? -x : x > S ? x - S : 0, dy = y < 0 ? -y : y > S ? y - S : 0;
  return Math.hypot(dx, dy);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Ground height in the countryside: gently rolling farmland, hills toward the horizon. */
function countryHeight(w: World, x: number, y: number): number {
  const S = w.size * w.tile, seed = w.seed ?? 0;
  const d = beyondGrid(w, x, y);
  // the grid's own edge, smoothed along the border (the land carries on its general level, not every bump)
  const bx = Math.min(S, Math.max(0, x)), by = Math.min(S, Math.max(0, y));
  const alongY = Math.abs(bx - x) >= Math.abs(by - y);
  let edge = 0;
  for (let k = -3; k <= 3; k++) edge += gridHeight(w, alongY ? bx : bx + k * 25, alongY ? by + k * 25 : by);
  edge /= 7;
  const h0 = gridHeight(w, bx, by) + (edge - gridHeight(w, bx, by)) * smoothstep(0, 40, d);
  const ground = 1.2 + 3.5 * fbm(x / 200, y / 200, seed + 61, 3);
  const farm = 40 * Math.max(0, fbm(x / 900, y / 900, seed + 62, 3) - 0.42) * smoothstep(250, 1500, d);
  // past the edge of the map: real hills on the horizon
  const out = Math.max(0, Math.max(MAP.min - x, x - MAP.max, MAP.min - y, y - MAP.max));
  const hills = 120 * Math.max(0, fbm(x / 1100, y / 1100, seed + 63, 3) - 0.3) * smoothstep(-200, 1200, out);
  return h0 + (ground + farm + hills - h0) * smoothstep(0, 160, d);
}

/**
 * The countryside's ground: the same woods and rocky outcrops as the edge of
 * the city's square (the same noise), thinning out over the first few hundred
 * metres into farmland with small woodlots.
 */
function countryKind(w: World, x: number, y: number): TileKind {
  const seed = w.seed ?? 0;
  const d = beyondGrid(w, x, y);
  if (fbm(x / 160, y / 160, seed + 7, 3) > 0.71 + 0.12 * smoothstep(0, 350, d)) return 'rock';
  return fbm(x / 130, y / 130, seed + 13, 4) > 0.55 + 0.07 * smoothstep(0, 350, d) ? 'forest' : 'grass';
}

/** What the ground is anywhere on the map. */
export function kindAt(w: World, x: number, y: number): TileKind {
  if (inGrid(w, x, y)) return w.kind[tileOf(w, x, y)];
  return countryKind(w, x, y);
}

/** How good the soil is (0..1) anywhere on the map. */
export function fertilityAt(w: World, x: number, y: number): number {
  if (inGrid(w, x, y)) return w.fertility[tileOf(w, x, y)];
  const soil = fbm(x / 200, y / 200, (w.seed ?? 0) + 29, 3);
  return Math.min(1, Math.max(0.3, soil * 1.25));
}

// ---------------------------------------------------------------- generation

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function generateWorld(seed: number): World {
  const n = WORLD.size;
  const N = n * n;
  const arr = () => new Array<number>(N).fill(0);
  const w: World = {
    size: n, tile: WORLD.tile,
    height: arr(), kind: new Array<TileKind>(N).fill('grass'), fertility: arr(),
    wood: arr(), stone: arr(), clay: arr(), ore: arr(), forage: arr(), fish: arr(),
    forageCap: arr(), fishCap: arr(), oreCap: arr(), clayCap: arr(), used: arr(), ver: 0, seed,
  };
  const c = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const dc = Math.hypot(x - c, y - c) / c; // 0 center .. ~1 edge
      let h = fbm(x / 30, y / 30, seed, 5);
      // the middle of the map stays dry, open land: room for a city to grow
      const middle = Math.max(0, 1 - dc * 1.9);
      h = h * (1 - middle) + Math.min(0.58, Math.max(0.45, h)) * middle;
      const rocky = fbm(x / 16, y / 16, seed + 7, 3);
      const woods = fbm(x / 13, y / 13, seed + 13, 4);
      const soil = fbm(x / 20, y / 20, seed + 29, 3);
      let kind: TileKind = 'grass';
      if (h < 0.36) kind = 'water';
      else if ((h > 0.64 || rocky > 0.71) && dc > 0.42) kind = 'rock';
      else if (woods > 0.55 && dc > 0.22) kind = 'forest';
      w.kind[i] = kind;
      w.height[i] = kind === 'water' ? -1.5 : Math.max(0.15, (h - 0.36) * WORLD.maxHeight * 1.6);
      if (kind === 'forest') w.wood[i] = WOOD_CAP * (0.55 + 0.45 * hash2(x, y, seed + 3));
      if (kind === 'rock') {
        w.stone[i] = STONE_CAP * (0.6 + 0.4 * hash2(x, y, seed + 5));
        if (fbm(x / 8, y / 8, seed + 41, 2) > 0.6) {
          w.oreCap[i] = 100;
          w.ore[i] = 60 + 40 * hash2(x, y, seed + 9);
        }
      }
      if (kind === 'grass' || kind === 'forest') w.fertility[i] = Math.min(1, Math.max(0, soil * 1.25 - 0.1));
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (w.kind[i] === 'water') {
        if (nearKind(w, x, y, 1, (k) => k !== 'water')) {
          w.fishCap[i] = 10;
          w.fish[i] = 7 + 3 * hash2(x, y, seed + 17);
        }
        continue;
      }
      if (w.kind[i] === 'rock') continue;
      const wet = nearKind(w, x, y, 3, (k) => k === 'water');
      if (wet) w.fertility[i] = Math.min(1, w.fertility[i] + 0.2);
      // clay banks along water
      if (wet && w.kind[i] === 'grass' && hash2(x, y, seed + 51) < 0.35) {
        w.clayCap[i] = 60;
        w.clay[i] = 40 + 20 * hash2(x, y, seed + 53);
      }
      if (w.fertility[i] > 0.45 && hash2(x, y, seed + 23) < 0.07) {
        w.forageCap[i] = 8 * w.fertility[i];
        w.forage[i] = w.forageCap[i] * (0.5 + 0.5 * hash2(x, y, seed + 31));
      }
    }
  }
  return w;
}

function nearKind(w: World, x: number, y: number, r: number, pred: (k: TileKind) => boolean): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      if (pred(w.kind[ny * w.size + nx])) return true;
    }
  }
  return false;
}

/** Clear nature from a tile (roads, lots and buildings). */
export function useTile(w: World, i: number): void {
  if (w.used[i]) return;
  w.used[i] = 1;
  if (w.kind[i] === 'forest') w.kind[i] = 'grass';
  w.wood[i] = 0;
  w.forage[i] = 0;
  w.forageCap[i] = 0;
  w.clay[i] = 0;
  w.clayCap[i] = 0;
  w.ver++;
}

// ------------------------------------------------------------------ regrowth

/** Everything renews (a user decision): called once per game day. */
export function regrowWorld(w: World): void {
  const N = w.size * w.size;
  for (let i = 0; i < N; i++) {
    const k = w.kind[i];
    if (k === 'forest' && !w.used[i]) w.wood[i] = Math.min(WOOD_CAP, w.wood[i] + REGROW_PER_DAY.wood);
    else if (k === 'rock') {
      w.stone[i] = Math.min(STONE_CAP, w.stone[i] + REGROW_PER_DAY.stone);
      if (w.oreCap[i] > 0) w.ore[i] = Math.min(w.oreCap[i], w.ore[i] + REGROW_PER_DAY.ore);
    } else if (k === 'water' && w.fishCap[i] > 0) w.fish[i] = Math.min(w.fishCap[i], w.fish[i] + REGROW_PER_DAY.fish);
    if (w.forageCap[i] > 0) w.forage[i] = Math.min(w.forageCap[i], w.forage[i] + REGROW_PER_DAY.forage * w.fertility[i]);
    if (w.clayCap[i] > 0) w.clay[i] = Math.min(w.clayCap[i], w.clay[i] + REGROW_PER_DAY.clay);
  }
  w.ver++;
}

export function resourceArray(w: World, res: ResourceKind | 'forage' | 'fish'): number[] {
  switch (res) {
    case 'forage': return w.forage;
    case 'fish': return w.fish;
    case 'wood': return w.wood;
    case 'stone': return w.stone;
    case 'clay': return w.clay;
    case 'ore': return w.ore;
  }
}

const searchCache = new Map<string, { t: number; tiles: number[] }>();

/**
 * Nearest tile holding at least `minStock`, picked among the few closest so
 * crowds spread out. Results are shared for a couple of game hours between
 * people searching from the same neighbourhood (pass `now` to enable that).
 */
export function findResource(w: World, res: ResourceKind, x: number, y: number, minStock: number, rng: Rng, maxR = 60, now = -1): number {
  const arr = resourceArray(w, res);
  const key = now >= 0 ? `${res}:${Math.floor(x / 60)}:${Math.floor(y / 60)}:${minStock}:${maxR}` : '';
  if (key) {
    const hit = searchCache.get(key);
    if (hit && now - hit.t < 120) {
      if (!hit.tiles.length) return -1; // nothing around here (remembered)
      const ok = hit.tiles.filter((i) => arr[i] >= minStock);
      if (ok.length) return ok[Math.floor(rng.next() * ok.length)];
    }
  }
  const best = nearestTiles(w, arr, x, y, minStock, maxR, 4);
  if (key) {
    if (searchCache.size > 5000) searchCache.clear();
    searchCache.set(key, { t: now, tiles: best });
  }
  return best.length ? best[Math.floor(rng.next() * best.length)] : -1;
}

/** The `n` closest tiles with at least `minStock` (ring search). */
function nearestTiles(w: World, arr: number[], x: number, y: number, minStock: number, maxR: number, n: number): number[] {
  const [cx, cy] = tileXY(w, tileOf(w, x, y));
  const found: number[] = [];
  let foundAt = -1;
  for (let r = 0; r <= maxR; r++) {
    if (found.length >= n || (foundAt >= 0 && r > foundAt + 3)) break;
    for (let dy = -r; dy <= r; dy++) {
      const step = Math.abs(dy) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step || 1) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) continue;
        const i = ty * w.size + tx;
        if (arr[i] < minStock) continue;
        if (foundAt < 0) foundAt = r;
        if (found.length < n) found.push(i);
      }
    }
  }
  return found;
}

/** Where a person stands to work a tile (fishers stand on the shore). */
export function workSpot(w: World, i: number): [number, number] {
  if (w.kind[i] !== 'water') {
    const [x, y] = tileCenter(w, i);
    return [x + (hash2(i, 1, 9) - 0.5) * 5, y + (hash2(i, 2, 9) - 0.5) * 5];
  }
  const [tx, ty] = tileXY(w, i);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const j = ny * w.size + nx;
      if (w.kind[j] !== 'water') {
        const [ax, ay] = tileCenter(w, i), [bx, by] = tileCenter(w, j);
        return [ax * 0.35 + bx * 0.65, ay * 0.35 + by * 0.65];
      }
    }
  }
  return tileCenter(w, i);
}

export function walkable(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x / w.tile), ty = Math.floor(y / w.tile);
  if (tx < 0 || ty < 0 || tx >= w.size || ty >= w.size) return onLand(x, y);
  return w.kind[ty * w.size + tx] !== 'water';
}

export function lineClear(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(d / (w.tile * 0.4));
  for (let s = 1; s < steps; s++) {
    const f = s / steps;
    if (!walkable(w, ax + (bx - ax) * f, ay + (by - ay) * f)) return false;
  }
  return true;
}

let heap: Int32Array, gScore: Float32Array, came: Int32Array, closed: Int32Array, opened: Int32Array, stamp = 0;

/** Cross-country path avoiding water (A* on tiles, then smoothed). */
/** Off-road paths only avoid water, which never changes: remember them by start and goal tile. */
const wildCache = new Map<number, number[]>();

export function wildPath(w: World, sx: number, sy: number, tx: number, ty: number): number[] {
  if (lineClear(w, sx, sy, tx, ty)) return [tx, ty];
  const key = tileOf(w, sx, sy) * w.size * w.size + tileOf(w, tx, ty);
  const hit = wildCache.get(key);
  if (hit) { const out = hit.slice(); out[out.length - 2] = tx; out[out.length - 1] = ty; return out; }
  const path = wildPathSearch(w, sx, sy, tx, ty);
  if (wildCache.size > 20000) wildCache.clear();
  wildCache.set(key, path.slice());
  return path;
}

function wildPathSearch(w: World, sx: number, sy: number, tx: number, ty: number): number[] {
  const n = w.size, N = n * n;
  if (!heap || heap.length < N) {
    heap = new Int32Array(N); gScore = new Float32Array(N); came = new Int32Array(N);
    closed = new Int32Array(N); opened = new Int32Array(N);
  }
  stamp++;
  const start = tileOf(w, sx, sy), goal = tileOf(w, tx, ty);
  const [gx, gy] = tileXY(w, goal);
  const f = (i: number) => {
    const dx = Math.abs((i % n) - gx), dy = Math.abs(((i / n) | 0) - gy);
    return gScore[i] + dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  let len = 0;
  const push = (i: number) => {
    let k = len++;
    heap[k] = i;
    const fi = f(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f(heap[p]) <= fi) break;
      heap[k] = heap[p]; heap[p] = i; k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap[--len];
    let k = 0;
    const fl = f(last);
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      if (l >= len) break;
      const c = r < len && f(heap[r]) < f(heap[l]) ? r : l;
      if (f(heap[c]) >= fl) break;
      heap[k] = heap[c]; k = c;
    }
    heap[k] = last;
    return top;
  };
  gScore[start] = 0; came[start] = -1; opened[start] = stamp;
  push(start);
  let found = false, expanded = 0;
  while (len > 0 && expanded < 30000) {
    const cur = pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    expanded++;
    if (cur === goal) { found = true; break; }
    const cx = cur % n, cy = (cur / n) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        if (w.kind[ni] === 'water' && ni !== goal) continue;
        if (closed[ni] === stamp) continue;
        const g = gScore[cur] + (dx && dy ? Math.SQRT2 : 1);
        if (opened[ni] === stamp && g >= gScore[ni]) continue;
        opened[ni] = stamp; gScore[ni] = g; came[ni] = cur;
        push(ni);
      }
    }
  }
  if (!found) return [tx, ty];
  const tiles: number[] = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) tiles.push(c);
  tiles.reverse();
  const pts: number[] = [];
  let ax = sx, ay = sy;
  for (let k = 0; k < tiles.length; k++) {
    const next = k + 1 < tiles.length ? tileCenter(w, tiles[k + 1]) : [tx, ty];
    if (!lineClear(w, ax, ay, next[0], next[1])) {
      const [cx, cy] = tileCenter(w, tiles[k]);
      pts.push(cx, cy);
      ax = cx; ay = cy;
    }
  }
  pts.push(tx, ty);
  return pts;
}

/** Terrain height at a point anywhere on the map (the countryside's is computed). */
export function heightAt(w: World, x: number, y: number): number {
  const S = w.size * w.tile;
  if (x < -w.tile / 2 || y < -w.tile / 2 || x > S + w.tile / 2 || y > S + w.tile / 2) return countryHeight(w, x, y);
  return gridHeight(w, x, y);
}

/** On the grid: bilinear over tile corner heights. */
function gridHeight(w: World, x: number, y: number): number {
  const n = w.size;
  const fx = Math.min(n - 1.001, Math.max(0, x / w.tile - 0.5)), fy = Math.min(n - 1.001, Math.max(0, y / w.tile - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  const hh = (tx: number, ty: number) => Math.max(-1.5, w.height[ty * n + tx]);
  return (hh(x0, y0) * (1 - ax) + hh(x0 + 1, y0) * ax) * (1 - ay) + (hh(x0, y0 + 1) * (1 - ax) + hh(x0 + 1, y0 + 1) * ax) * ay;
}
