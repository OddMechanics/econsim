// Test bench for the terrain + road renderers: generates a world, grows a
// city road network with the simulation's own road code, and renders it.
// URL params: ?seed=7&iters=200 (growRoads calls), ?stress=1 (synthetic
// ~1700-edge grid for timing), ?view=overview|city|street|avenue|dirt|works|furniture|signal,
// ?night=1, ?overlay=1, ?paved=0.7 (share of streets paved; the rest are dirt
// tracks, some being paved by active crews), ?crews=1 (crews keep paving).

import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, ShadowGenerator, Vector3,
} from '@babylonjs/core';
import { ROAD } from '../src/sim/config';
import { makeCtx } from '../src/sim/ctx';
import { growRoads, initRoads, makeAllLots, markLotUsed } from '../src/sim/roads';
import { hash2, seedRng } from '../src/sim/rng';
import { streetFurniture, streetLamps } from '../src/sim/street';
import type { Lot, Market, RoadEdge, RoadKind, RoadNode, SimState, Zone } from '../src/sim/types';
import { generateWorld, heightAt, mapSize, tileOf, useTile } from '../src/sim/world';
import { RoadRenderer } from '../src/render/roads';
import { TerrainRenderer } from '../src/render/terrain';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 7);
const iters = Number(params.get('iters') ?? 200);
const stress = params.get('stress') === '1';
const pavedShare = Number(params.get('paved') ?? 0.7);

function skeleton(seed: number): SimState {
  return {
    version: 3, seed, rng: seedRng(seed), tick: 0, nextId: 1,
    world: generateWorld(seed),
    roads: { nodes: [], edges: [], lots: [], plan: [], ver: 0 },
    people: [], dead: [], buildings: [], firms: [], contracts: [], postings: [], vehicles: [], shipments: [], loans: [], ads: [],
    polities: [], parties: [], elections: [], events: [], broadcasts: [], auctions: [], landDemand: {}, taxArrears: {},
    market: { bid: -1, orders: [], lockers: {}, last: {} as Market['last'], day: {} as Market['day'], trades: [] },
    conversations: [], posts: [], stats: [], log: [], scenarios: [],
    counters: { arrivals: 0, deaths: 0, trades: 0, hires: 0, layoffs: 0, quits: 0 },
  } as SimState;
}

/**
 * Street states for the bench: about `pavedShare` of the streets paved, the
 * rest dirt tracks; of those, some scheduled for paving (staked), some half
 * paved, and some with a crew working right now.
 */
function assignStates(): void {
  for (const e of state.roads.edges) {
    const h = hash2(e.id, 1, seed);
    if (h < pavedShare) { e.built = undefined; e.progress = undefined; e.paving = undefined; e.active = undefined; continue; }
    const k = hash2(e.id, 2, seed);
    e.built = false;
    e.progress = 0;
    e.paving = e.active = undefined;
    if (k < 0.45) { e.paving = true; e.progress = k < 0.3 ? 0.1 + 2.5 * k : 0; }
    if (k < 0.2) e.active = true;
  }
  state.roads.ver++;
}

/** Advance every active crew by `meters`, bumping the version every 5% like the sim does. */
function crewStep(meters: number): void {
  for (const e of state.roads.edges) {
    if (e.built !== false || !e.active) continue;
    const before = e.progress ?? 0;
    e.progress = Math.min(1, before + meters / e.len);
    if (Math.floor(e.progress * 20) !== Math.floor(before * 20)) state.roads.ver++;
    if (e.progress >= 1) { e.built = e.progress = e.paving = e.active = undefined; state.roads.ver++; }
  }
}

const state = skeleton(seed);
const ctx = makeCtx(state);
const S = mapSize(state.world);
const ZONES: Zone[] = ['core', 'urban', 'urban', 'suburb', 'industrial', 'rural'];
let grown = 0;
const timings: Record<string, number> = {};

function grow(n: number): void {
  for (let i = 0; i < n; i++) {
    try {
      growRoads(ctx, ZONES[grown % ZONES.length]);
    } catch (err) {
      console.error('growRoads threw', err);
    }
    grown++;
  }
}

/** A synthetic jittered grid (for timing the renderer with ~1700 edges). */
function stressNetwork(): void {
  const r = state.roads, w = state.world;
  const G = 30, sp = 62, o = S / 2 - ((G - 1) * sp) / 2;
  const ids: number[][] = [];
  for (let j = 0; j < G; j++) {
    ids.push([]);
    for (let i = 0; i < G; i++) {
      const n: RoadNode = { id: state.nextId++, x: o + i * sp + (Math.random() - 0.5) * 10, y: o + j * sp + (Math.random() - 0.5) * 10, edges: [] };
      r.nodes.push(n);
      ctx.nodeById.set(n.id, n);
      ids[j].push(n.id);
    }
  }
  const link = (a: number, b: number, kind: RoadKind) => {
    const A = ctx.nodeById.get(a)!, B = ctx.nodeById.get(b)!;
    const width = kind === 'avenue' ? ROAD.avenue : kind === 'street' ? ROAD.street : ROAD.country;
    const e: RoadEdge = { id: state.nextId++, a, b, kind, width, len: Math.hypot(B.x - A.x, B.y - A.y) };
    r.edges.push(e);
    ctx.edgeById.set(e.id, e);
    A.edges.push(e.id);
    B.edges.push(e.id);
    for (let s = 0; s <= e.len; s += 5) useTile(w, tileOf(w, A.x + ((B.x - A.x) * s) / e.len, A.y + ((B.y - A.y) * s) / e.len));
  };
  const kindOf = (line: number) => (line === 0 || line === G - 1 ? 'country' : line % 6 === 3 ? 'avenue' : 'street');
  for (let j = 0; j < G; j++) for (let i = 0; i + 1 < G; i++) link(ids[j][i], ids[j][i + 1], kindOf(j));
  for (let i = 0; i < G; i++) for (let j = 0; j + 1 < G; j++) link(ids[j][i], ids[j + 1][i], kindOf(i));
  r.ver++;
}

let t = performance.now();
if (stress) stressNetwork();
else {
  initRoads(ctx, S / 2, S / 2);
  grow(iters);
  makeAllLots(ctx);
}
assignStates();
timings.generate = performance.now() - t;
t = performance.now();
const lampsN = streetLamps(state.roads, ctx.nodeById, ctx.edgeById).length;
const furnN = streetFurniture(state.roads, ctx.nodeById, ctx.edgeById).length;
timings.streetLayout = performance.now() - t;
t = performance.now();
streetLamps(state.roads, ctx.nodeById, ctx.edgeById);
timings.streetLayoutCached = performance.now() - t;
console.log('street layout', lampsN, 'lamps', furnN, 'furniture');

// some owners for the overlay
const owners = [101, 102, 103, 104, 105];
state.roads.lots.forEach((l, i) => {
  if (i % 3 !== 0) {
    l.owner = owners[i % owners.length];
    markLotUsed(ctx, l);
  }
});
const ownerColor = new Map<number, Color3>(owners.map((o, i) => [o, Color3.FromHSV((i * 360) / owners.length + 20, 0.75, 0.95)]));
const colorOf = (l: Lot) => ownerColor.get(l.owner) ?? null;

// ------------------------------------------------------------------ scene

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
const scene = new Scene(engine);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.0006;
const camera = new ArcRotateCamera('cam', -Math.PI / 2.4, 0.9, 500, new Vector3(S / 2, 0, S / 2), scene);
camera.lowerRadiusLimit = 4;
camera.upperRadiusLimit = 2600;
camera.lowerBetaLimit = 0.1;
camera.upperBetaLimit = 1.5;
camera.wheelDeltaPercentage = 0.015;
camera.panningSensibility = 40;
camera.minZ = 0.3;
camera.maxZ = 7000;
camera.attachControl(canvas, true);

const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
hemi.groundColor = Color3.FromHexString('#4a4a3a');
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35).normalize(), scene);
sun.autoUpdateExtends = false;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.0008;
shadows.normalBias = 0.02;

t = performance.now();
const terrain = new TerrainRenderer(scene, shadows, state.world);
timings.terrainBuild = performance.now() - t;
t = performance.now();
terrain.updateNature(state.world);
timings.natureUpdate = performance.now() - t;

let roads = new RoadRenderer(scene, shadows);
roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
timings.syncFirst = roads.stats.ms;
// a second full build on a fresh renderer (warm JIT)
roads.dispose();
roads = new RoadRenderer(scene, shadows);
roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
timings.syncFull = roads.stats.ms;
// incremental: one more growth step
if (!stress) {
  grow(3);
  roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
  timings.syncIncremental = roads.stats.ms;
  timings.rebuiltChunks = roads.stats.rebuilt;
}

let night = 0, overlay = false;
function setNight(v: number): void {
  night = v;
  roads.setNight(v);
  const day = 1 - v;
  hemi.intensity = 0.14 + 0.5 * day;
  hemi.diffuse = Color3.Lerp(Color3.FromHexString('#5a6aa0'), Color3.FromHexString('#f2f4ff'), day);
  sun.intensity = 0.06 + 0.9 * day;
  sun.diffuse = Color3.Lerp(Color3.FromHexString('#8090c0'), Color3.FromHexString('#fff6e8'), day);
  const sky = Color3.Lerp(Color3.FromHexString('#0b1220'), Color3.FromHexString('#a9cbe3'), day);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;
  document.getElementById('night')!.classList.toggle('on', v > 0.5);
}
function setOverlay(on: boolean): void {
  overlay = on;
  roads.setLotOverlay(on ? state.roads.lots : null, colorOf);
  document.getElementById('overlay')!.classList.toggle('on', on);
}

function junctionNear(x: number, y: number, pred: (n: RoadNode) => boolean): RoadNode | undefined {
  let best: RoadNode | undefined, bd = Infinity;
  for (const n of state.roads.nodes) {
    if (!pred(n)) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function edgeDist(e: RoadEdge): number {
  const A = ctx.nodeById.get(e.a)!, B = ctx.nodeById.get(e.b)!;
  return Math.hypot((A.x + B.x) / 2 - S / 2, (A.y + B.y) / 2 - S / 2);
}

function view(name: string): void {
  const look = (x: number, y: number, radius: number, beta: number, alpha = -Math.PI / 2.4) => {
    camera.target = new Vector3(x, heightAt(state.world, x, y), y);
    camera.radius = radius;
    camera.beta = beta;
    camera.alpha = alpha;
  };
  const kinds = (n: RoadNode) => n.edges.map((id) => ctx.edgeById.get(id)!.kind);
  if (name === 'overview') look(S / 2, S / 2, 2100, 0.8);
  else if (name === 'city') look(S / 2, S / 2, 560, 0.85);
  else if (name === 'street') {
    const n = junctionNear(S / 2 + 120, S / 2 + 80, (n) => n.edges.length >= 3 && kinds(n).every((k) => k === 'street'));
    if (n) look(n.x, n.y, 48, 1.1, -0.9);
  } else if (name === 'avenue') {
    const n = junctionNear(S / 2, S / 2, (n) => n.edges.length >= 3 && kinds(n).includes('avenue') && kinds(n).includes('street'));
    if (n) look(n.x, n.y, 70, 1.0, -2.2);
  } else if (name === 'country') {
    const n = junctionNear(S / 2 + 500, S / 2, (n) => n.edges.length >= 2 && kinds(n).includes('country'));
    if (n) look(n.x, n.y, 80, 1.0);
  } else if (name === 'square') look(S / 2, S / 2, 110, 0.95, -1.2);
  else if (name === 'dirt' || name === 'dirtLow') {
    // a crossing where paved streets meet dirt tracks
    const n = junctionNear(S / 2 + 60, S / 2 + 60, (n) => n.edges.length >= 3 && kinds(n).every((k) => k !== 'country')
      && n.edges.some((id) => ctx.edgeById.get(id)!.built === false) && n.edges.some((id) => ctx.edgeById.get(id)!.built !== false));
    if (n) look(n.x, n.y, name === 'dirt' ? 55 : 22, name === 'dirt' ? 1.0 : 1.4, -0.7);
  } else if (name === 'works' || name === 'worksLow') {
    const e = state.roads.edges.filter((e) => e.active && e.kind !== 'country').sort((a, b) => edgeDist(a) - edgeDist(b))[0];
    if (e) {
      const A = ctx.nodeById.get(e.a)!, B = ctx.nodeById.get(e.b)!, f = e.progress ?? 0;
      const low = name === 'worksLow';
      look(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, low ? 20 : 40, low ? 1.38 : 1.05, -Math.atan2(B.y - A.y, B.x - A.x) + (low ? 2.6 : 2.2));
    }
  } else if (name === 'furniture') {
    const f = streetFurniture(state.roads, ctx.nodeById, ctx.edgeById).filter((f) => f.kind === 'busstop')
      .sort((a, b) => Math.hypot(a.x - S / 2, a.y - S / 2) - Math.hypot(b.x - S / 2, b.y - S / 2))[0];
    if (f) look(f.x, f.y, 26, 1.15, -f.dir + 2.4);
  } else if (name === 'signal') {
    const n = junctionNear(S / 2, S / 2, (n) => n.edges.length >= 3 && kinds(n).includes('avenue')
      && n.edges.every((id) => ctx.edgeById.get(id)!.built !== false && ctx.edgeById.get(id)!.kind !== 'country'));
    if (n) look(n.x, n.y, 38, 1.1, -0.6);
  }
  else if (name.startsWith('at:')) {
    // at:x:y:radius:beta:alpha
    const [x, y, rad, beta, alpha] = name.slice(3).split(':').map(Number);
    look(x, y, rad, beta, alpha);
  }
}

document.getElementById('night')!.onclick = () => setNight(night > 0.5 ? 0 : 1);
document.getElementById('overlay')!.onclick = () => setOverlay(!overlay);
document.getElementById('grow')!.onclick = () => {
  grow(10);
  roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
  t = performance.now();
  terrain.updateNature(state.world);
  timings.natureUpdate = performance.now() - t;
  if (overlay) setOverlay(true);
  showStats();
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.onclick = () => view(b.dataset.view!);
document.getElementById('crews')!.onclick = () => { crews = !crews; document.getElementById('crews')!.classList.toggle('on', crews); };

const statsEl = document.getElementById('stats')!;
function showStats(): void {
  const s = roads.stats;
  statsEl.textContent =
    `seed ${seed}  growRoads x${grown}  nodes ${state.roads.nodes.length}  edges ${state.roads.edges.length}  lots ${state.roads.lots.length}\n` +
    `sync: first ${timings.syncFirst?.toFixed(1)} ms, full ${timings.syncFull?.toFixed(1)} ms, incremental ${timings.syncIncremental?.toFixed(1) ?? '-'} ms (${timings.rebuiltChunks ?? '-'} chunks)  last ${s.ms.toFixed(1)} ms\n` +
    `chunks ${s.chunks}  road verts ${s.vertices}  lamps ${s.lamps}  dirt edges ${s.dirt}  furniture ${s.furniture} (near ${s.nearFurniture})  works ${s.works}  signals ${s.signals}\n` +
    `terrain ${timings.terrainBuild.toFixed(0)} ms  nature ${timings.natureUpdate.toFixed(1)} ms  gen ${timings.generate.toFixed(0)} ms  street layout ${timings.streetLayout.toFixed(1)} ms`;
}
showStats();
console.log('bench timings', JSON.stringify(timings), JSON.stringify(roads.stats));

setNight(params.get('night') === '1' ? 1 : 0);
setOverlay(params.get('overlay') === '1');
view(params.get('view') ?? 'city');

scene.onBeforeRenderObservable.add(() => {
  // keep the shadow map around what the camera looks at
  const extent = Math.min(900, Math.max(60, camera.radius * 1.3));
  sun.shadowFrustumSize = extent;
  sun.position = camera.target.subtract(sun.direction.scale(800));
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 1800;
  scene.fogDensity = Math.min(0.0009, 0.4 / (camera.radius + 400));
});
let crews = params.get('crews') === '1';
let syncClock = 0;
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  if (crews) crewStep(dt * 3); // 3 m per second
  syncClock += dt;
  if (syncClock > 0.5) {
    syncClock = 0;
    roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
  }
  scene.render();
});
window.addEventListener('resize', () => engine.resize());

(window as unknown as { bench: unknown }).bench = {
  view, setNight, setOverlay, grow: (n: number) => { grow(n); roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world); terrain.updateNature(state.world); showStats(); },
  timings, get stats() { return roads.stats; }, get roads() { return roads; }, state, ctx, camera, scene, ready: true,
  /** surfaceAt across an edge's middle, from -12 m to +12 m (paved / dirt check), and its timing (us per call). */
  surfaceProfile(paved: boolean): { kind: string; hw: number; prof: number[]; us: number } | null {
    const e = state.roads.edges.find((e) => (e.built !== false) === paved && e.kind === 'street');
    if (!e) return null;
    const A = ctx.nodeById.get(e.a)!, B = ctx.nodeById.get(e.b)!;
    const ux = (B.x - A.x) / e.len, uy = (B.y - A.y) / e.len, mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const prof: number[] = [];
    for (let o = -12; o <= 12; o += 1) prof.push(+roads.surfaceAt(mx - uy * o, my + ux * o).toFixed(3));
    const t0 = performance.now();
    let acc = 0;
    for (let k = 0; k < 20000; k++) acc += roads.surfaceAt(mx + (k % 50) - 25, my + ((k * 7) % 50) - 25);
    return { kind: e.kind, hw: e.width / 2, prof, us: ((performance.now() - t0) / 20000) * 1000 + acc * 0 };
  },
  setCrews(on: boolean) { crews = on; },
  /** Crews pave `meters` per step; returns [ms, chunks rebuilt] per sync (sync after every step, like every 0.5 s). */
  crewTimes(n = 20, meters = 1): number[][] {
    const out: number[][] = [];
    for (let k = 0; k < n; k++) {
      crewStep(meters);
      roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
      out.push([+roads.stats.ms.toFixed(2), roads.stats.rebuilt]);
    }
    return out;
  },
  /** street.ts: [first layout on a copy, re-layout after a version bump with no change, after one street got paved] (ms). */
  layoutTimes(): number[] {
    const copy = { ...state.roads };
    let t0 = performance.now();
    streetLamps(copy, ctx.nodeById, ctx.edgeById);
    const first = performance.now() - t0;
    copy.ver++;
    t0 = performance.now();
    const a = streetLamps(copy, ctx.nodeById, ctx.edgeById);
    const bump = performance.now() - t0;
    const e = copy.edges.find((e) => e.built === false && e.kind !== 'country');
    if (e) e.built = undefined;
    copy.ver++;
    t0 = performance.now();
    const b = streetLamps(copy, ctx.nodeById, ctx.edgeById);
    const paved = performance.now() - t0;
    if (e) e.built = false;
    return [first, bump, paved, +(a === streetLamps(state.roads, ctx.nodeById, ctx.edgeById)), b.length - a.length];
  },
  /** Time a sync call when nothing changed (the every-0.5 s cost). */
  idleSync(n = 20): number {
    const t0 = performance.now();
    for (let k = 0; k < n; k++) roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
    return (performance.now() - t0) / n;
  },
  assignStates() { assignStates(); roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world); showStats(); },
  /** Pave everything (or make everything dirt with share 0). */
  setPaved(share: number) {
    for (const e of state.roads.edges) {
      if (hash2(e.id, 1, seed) < share) { e.built = e.progress = e.paving = e.active = undefined; } else { e.built = false; e.progress = 0; e.paving = e.active = undefined; }
    }
    state.roads.ver++;
    roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
    showStats();
  },
  /** Full rebuilds on fresh renderers; returns the sync times (ms). */
  fullSync(n = 5): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      roads.dispose();
      roads = new RoadRenderer(scene, shadows);
      roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
      out.push(roads.stats.ms);
    }
    setNight(night);
    setOverlay(overlay);
    return out;
  },
  /** Grow one step at a time; returns [ms, chunks rebuilt] per sync. */
  growTimes(n = 10): number[][] {
    const out: number[][] = [];
    for (let k = 0; k < n; k++) {
      grow(1);
      roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world);
      out.push([+roads.stats.ms.toFixed(2), roads.stats.rebuilt]);
    }
    terrain.updateNature(state.world);
    showStats();
    return out;
  },
  /** Syncs after a version bump with no geometry change (e.g. lots added). */
  noopSync(n = 5): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) { state.roads.ver++; roads.sync(state.roads, ctx.nodeById, ctx.edgeById, state.world); out.push(roads.stats.ms); }
    return out;
  },
  /** Nature re-instancing times (ms): forced full placement, then a no-change update. */
  natureTimes(n = 3): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      (terrain as unknown as { natSig: Uint32Array }).natSig.fill(0xffffffff);
      const t0 = performance.now();
      terrain.updateNature(state.world);
      out.push(performance.now() - t0);
    }
    const t0 = performance.now();
    terrain.updateNature(state.world);
    out.push(performance.now() - t0);
    return out;
  },
  /** Cut all wood within r meters of (x, y) (or set it to `wood`), then update nature; returns ms. */
  chop(x: number, y: number, r: number, wood = 0): number {
    const w = state.world;
    for (let i = 0; i < w.size * w.size; i++) {
      const tx = ((i % w.size) + 0.5) * w.tile, ty = (Math.floor(i / w.size) + 0.5) * w.tile;
      if (Math.hypot(tx - x, ty - y) < r && w.kind[i] === 'forest') w.wood[i] = wood;
    }
    w.ver++;
    const t0 = performance.now();
    terrain.updateNature(w);
    return performance.now() - t0;
  },
};
