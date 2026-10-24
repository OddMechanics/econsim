// Test bench for src/render/people.ts (both LODs), src/render/characters.ts and
// src/render/vehicles.ts.
// URL params:
//   cam=gallery|close|side|back|far|cars|road|top|crowd|outfits|props
//   col=<pose column for cam=close>  row=<row for cam=close>  r/alpha/beta/tx/ty/tz = camera overrides
//   lod=auto|detail|far   (detail: everyone detailed, far: instanced figures only)
//   n=<crowd size, default 300>  night=0..1  glow=1  scale=<number>  freeze=<time sec>  hl=<person id>
// Keys: n = night, g = glow, l = cycle LOD mode, 1..9 = camera presets, click = pick.

import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, GlowLayer, HemisphericLight, Matrix, Mesh, MeshBuilder,
  PointerEventTypes, Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, Vector3,
} from '@babylonjs/core';
import { PeopleRenderer, type PersonVisual } from '../src/render/people';
import { VehicleRenderer, type VehicleVisual } from '../src/render/vehicles';
import type { Looks, Pose } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
const scene = new Scene(engine);
const hud = document.getElementById('hud')!;
const inst = new SceneInstrumentation(scene);
inst.captureFrameTime = true;
inst.captureRenderTime = true;

const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.2, 30, new Vector3(0, 1, 3), scene);
camera.lowerRadiusLimit = 1.5;
camera.upperRadiusLimit = 900;
camera.minZ = 0.1;
camera.maxZ = 3000;
camera.wheelDeltaPercentage = 0.02;
camera.attachControl(canvas, true);

const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
hemi.groundColor = Color3.FromHexString('#4a4a3a');
const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35).normalize(), scene);
sun.autoUpdateExtends = false;
sun.shadowFrustumSize = 170;
sun.position = new Vector3(0, 0, 35).subtract(sun.direction.scale(300));
sun.shadowMinZ = 1;
sun.shadowMaxZ = 700;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.0008;
shadows.normalBias = 0.02;

let glow: GlowLayer | null = null;
const setGlow = (on: boolean) => {
  if (on && !glow) {
    glow = new GlowLayer('glow', scene);
    glow.intensity = 0.6;
    glow.addExcludedMesh(vehicleR.coneMesh);
  }
  if (!on && glow) { glow.dispose(); glow = null; }
};

// ------------------------------------------------------------------ ground
const mat = (hex: string) => {
  const m = new StandardMaterial(hex, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  return m;
};
const ground = MeshBuilder.CreateGround('ground', { width: 1200, height: 1200 }, scene);
ground.material = mat('#6d8a4c');
ground.receiveShadows = true;
const ROAD_C = new Vector3(0, 0, 80);
const asphalt = MeshBuilder.CreateDisc('road', { radius: 44, tessellation: 96 }, scene);
asphalt.rotation.x = Math.PI / 2;
asphalt.position.set(ROAD_C.x, 0.02, ROAD_C.z);
asphalt.material = mat('#4a4c50');
asphalt.receiveShadows = true;
const inner = MeshBuilder.CreateDisc('inner', { radius: 35, tessellation: 96 }, scene);
inner.rotation.x = Math.PI / 2;
inner.position.set(ROAD_C.x, 0.04, ROAD_C.z);
inner.material = mat('#9a948a'); // plaza
inner.receiveShadows = true;
const lane = MeshBuilder.CreateTorus('lane', { diameter: 79, thickness: 0.15, tessellation: 128 }, scene);
lane.scaling.y = 0.05;
lane.position.set(ROAD_C.x, 0.03, ROAD_C.z);
lane.material = mat('#e8e2c8');

// ---------------------------------------------------------------- people
const POSES: Pose[] = ['stand', 'walk', 'talk', 'carry', 'serve', 'cook', 'manual', 'build', 'gather', 'sit', 'type', 'eat',
  'drive', 'sleep', 'watch', 'phone', 'speech', 'cheer', 'protest', 'vote'];
const OUTFITS = ['casual', 'office', 'work', 'hivis', 'chef', 'apron', 'suit', 'police'] as const;
const HOLDS = ['phone', 'cup', 'briefcase', 'bag', 'tool', 'flyer', 'sign', 'mic'] as const;
const SEATED = new Set<Pose>(['sit', 'type', 'eat', 'drive', 'watch']);
const SPACING = 2.6;
const people: PersonVisual[] = [];
let nextId = 1;
const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
const looks = (i: number): Looks => ({
  skin: i % 6, hair: (i * 3) % 7, hairStyle: (i >> 1) % 4, shirt: (i * 0.137) % 1, pants: (i * 0.291 + 0.55) % 1,
  height: 1.62 + ((i * 7) % 5) * 0.065, build: 0.86 + ((i * 5) % 4) * 0.09,
});
/** Each pose's typical clothes in the gallery. */
const POSE_OUTFIT: Partial<Record<Pose, PersonVisual['outfit']>> = {
  serve: 'apron', cook: 'chef', manual: 'work', build: 'hivis', gather: 'work', type: 'office', speech: 'suit',
};

const propMat = mat('#8a6a4a');
const deskMat = mat('#a58358');
const steelMat = mat('#9aa0a6');
const bedMat = mat('#d9d4e8');
const tvMat = mat('#1d2024');
const props: Mesh[] = [];
const prop = (w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
  const b = MeshBuilder.CreateBox('prop', { width: w, height: h, depth: d }, scene);
  b.position.set(x, y + h / 2, z);
  b.material = m;
  b.receiveShadows = true;
  b.isPickable = false;
  shadows.addShadowCaster(b);
  props.push(b);
};
/** Box along the person's facing (fx, fz): `fwd` ahead, `side` to the right. */
const boxAt = (x: number, z: number, fx: number, fz: number, fwd: number, w: number, h: number, d: number, y: number, m: StandardMaterial) => {
  const along = Math.abs(fx) > 0.5;
  prop(along ? d : w, h, along ? w : d, x + fx * fwd, y, z + fz * fwd, m);
};

const labels: { text: string; pos: Vector3 }[] = [];
// rows: 0..2 face the camera (-Z), 3 faces +X (profile), 4 faces away
const ROWS = [{ z: -1.5, h: -Math.PI / 2 }, { z: 1.4, h: -Math.PI / 2 }, { z: 4.3, h: -Math.PI / 2 }, { z: 7.2, h: 0 }, { z: 10.1, h: Math.PI / 2 }];
const colX = (c: number, n: number) => (c - (n - 1) / 2) * SPACING;
POSES.forEach((pose, ci) => {
  const x = colX(ci, POSES.length);
  labels.push({ text: `${ci}: ${pose}`, pos: new Vector3(x, 2.3, -2.4) });
  ROWS.forEach((r, ri) => {
    const i = ci * 5 + ri;
    const seated = SEATED.has(pose);
    let z = 0;
    const fx = Math.cos(r.h), fz = Math.sin(r.h);
    if (seated) {
      boxAt(x, r.z, fx, fz, 0, 0.44, 0.45, 0.44, 0, propMat);
      boxAt(x, r.z, fx, fz, -0.22, 0.44, 0.5, 0.06, 0.45, propMat);
      if (pose === 'type' || pose === 'eat') boxAt(x, r.z, fx, fz, 0.62, 1.1, 0.06, 0.6, 0.68, deskMat);
      if (pose === 'watch') boxAt(x, r.z, fx, fz, 2.0, 0.9, 0.55, 0.08, 0.6, tvMat);
    }
    if (pose === 'sleep') { boxAt(x, r.z, fx, fz, 0.1, 1.0, 0.45, 2.1, 0, bedMat); z = 0.45; }
    if (pose === 'cook' || pose === 'manual') boxAt(x, r.z, fx, fz, 0.62, 1.0, 0.88, 0.6, 0, pose === 'cook' ? steelMat : deskMat);
    if (pose === 'vote') { // booth: shelf with two side walls
      boxAt(x, r.z, fx, fz, 0.55, 0.8, 0.95, 0.5, 0, deskMat);
      const sx = -fz, sz = fx; // to the right
      for (const k of [-1, 1]) boxAt(x + sx * k * 0.45, r.z + sz * k * 0.45, fx, fz, 0.4, 0.04, 1.8, 0.9, 0, steelMat);
    }
    if (pose === 'speech') boxAt(x, r.z, fx, fz, 0.5, 0.6, 1.1, 0.4, 0, propMat);
    const moving = pose === 'walk' || ((pose === 'carry' || pose === 'serve' || pose === 'phone' || pose === 'talk' || pose === 'protest') && ri === 4);
    people.push({
      id: nextId++, x, y: r.z, z, heading: r.h, pose, moving,
      looks: looks(i), carrying: pose === 'carry', highlight: false,
      outfit: POSE_OUTFIT[pose] ?? OUTFITS[i % OUTFITS.length],
      talking: (pose === 'sit' && ri === 2) || (pose === 'phone' && ri === 1),
      holding: pose === 'speech' && ri === 2 ? 'mic' : pose === 'walk' && ri === 1 ? 'briefcase' : null,
    });
  });
});

// outfit row (standing, then walking) and held-items row
// in front of the gallery (toward the default camera), facing it: lit by the bench sun
const OUTFIT_Z = -7.5, HOLD_Z = -11.5;
OUTFITS.forEach((o, ci) => {
  for (let k = 0; k < 4; k++) {
    const x = colX(ci, OUTFITS.length) * 1.6 + (k - 1.5) * 0.9;
    people.push({
      id: nextId++, x, y: OUTFIT_Z - (k % 2) * 1.4, z: 0, heading: -Math.PI / 2, pose: k === 3 ? 'walk' : 'stand', moving: k === 3,
      looks: looks(200 + ci * 4 + k), carrying: false, highlight: false, outfit: o,
    });
  }
  labels.push({ text: o, pos: new Vector3(colX(ci, OUTFITS.length) * 1.6, 2.3, OUTFIT_Z + 0.9) });
});
HOLDS.forEach((hld, ci) => {
  for (let k = 0; k < 3; k++) {
    const x = colX(ci, HOLDS.length) * 1.6 + (k - 1) * 1.0;
    people.push({
      id: nextId++, x, y: HOLD_Z, z: 0, heading: -Math.PI / 2, pose: k === 2 ? 'walk' : 'stand', moving: k === 2,
      looks: looks(300 + ci * 3 + k), carrying: false, highlight: false, holding: hld, talking: k === 1 && hld === 'phone',
      outfit: OUTFITS[(ci + k) % OUTFITS.length],
    });
  }
  labels.push({ text: hld, pos: new Vector3(colX(ci, HOLDS.length) * 1.6, 2.3, HOLD_Z + 0.9) });
});
const benchCount = people.length;
if (q.has('only')) { // only=<id,id,...>: keep just these bench people (debug)
  const keep = new Set(q.get('only')!.split(',').map(Number));
  for (let i = people.length - 1; i >= 0; i--) if (!keep.has(people[i].id)) people.splice(i, 1);
}
if (q.has('hl')) for (const p of people) p.highlight = p.id === num('hl', -1);

// walking crowd on the plaza inside the ring road
const N = q.has('only') ? 0 : num('n', 300);
interface Walker { p: PersonVisual; r: number; a: number; w: number }
const walkers: Walker[] = [];
for (let i = 0; i < N; i++) {
  const r = 4 + rnd() * 28;
  const dir = rnd() < 0.5 ? 1 : -1;
  const kind = rnd();
  const pose: Pose = kind < 0.62 ? 'walk' : kind < 0.7 ? 'carry' : kind < 0.74 ? 'serve' : kind < 0.82 ? 'talk' : kind < 0.88 ? 'phone' : kind < 0.93 ? 'cheer' : 'stand';
  const moving = pose === 'walk' || pose === 'carry' || pose === 'serve' || (pose === 'phone' && rnd() < 0.5);
  const p: PersonVisual = {
    id: nextId++, x: 0, y: 0, z: 0.04, heading: 0, pose, moving, looks: looks(i + 100),
    carrying: pose === 'carry' || (pose === 'walk' && rnd() < 0.06), highlight: false,
    outfit: OUTFITS[Math.floor(rnd() * OUTFITS.length)], holding: pose === 'walk' && rnd() < 0.15 ? HOLDS[Math.floor(rnd() * 5)] : null,
    talking: pose === 'talk',
  };
  walkers.push({ p, r, a: rnd() * Math.PI * 2, w: moving ? (dir * (1.25 + rnd() * 0.3)) / r : 0 });
  people.push(p);
}

// ---------------------------------------------------------------- vehicles
const vehicles: VehicleVisual[] = [];
interface Driver { v: VehicleVisual; r: number; a: number; w: number }
const drivers: Driver[] = [];
for (let i = 0; i < 14; i++) {
  const outer = i % 2 === 0;
  const r = outer ? 41.5 : 37.5;
  const kind = i % 5 === 4 ? 'truck' : 'car';
  const speed = 8 + rnd() * 4;
  const v: VehicleVisual = { id: nextId++, kind, x: 0, y: 0, z: 0.02, heading: 0, hue: rnd(), speed, hasDriver: true };
  drivers.push({ v, r, a: (i / 14) * Math.PI * 2, w: ((outer ? 1 : -1) * speed) / r });
  vehicles.push(v);
}
for (let i = 0; i < 8; i++) {
  vehicles.push({ id: nextId++, kind: i === 3 || i === 6 ? 'truck' : 'car', x: -16 + i * (i > 3 ? 5.2 : 4.6) + (i > 3 ? 4 : 0), y: -36, z: 0, heading: Math.PI / 2, hue: (i * 0.173 + 0.05) % 1, speed: 0, hasDriver: i % 3 === 1 });
}

// ---------------------------------------------------------------- renderers
const peopleR = new PeopleRenderer(scene, shadows);
const vehicleR = new VehicleRenderer(scene, shadows);
setGlow(q.get('glow') === '1');
type LodMode = 'auto' | 'detail' | 'far';
let lodMode: LodMode = (q.get('lod') as LodMode) || 'auto';
const applyLod = () => {
  peopleR.detail = lodMode !== 'far';
  peopleR.detailMax = lodMode === 'detail' ? 2000 : 48;
  peopleR.detailIn = lodMode === 'detail' ? 1e6 : 38;
  peopleR.detailOut = lodMode === 'detail' ? 1e6 : 46;
};
applyLod();
if (q.has('clip')) peopleR.characters.debugClip = q.get('clip');

const tags = labels.map((l) => {
  const d = document.createElement('div');
  d.className = 'tag';
  d.textContent = l.text;
  document.body.appendChild(d);
  return d;
});

// ---------------------------------------------------------------- cameras
const presets: Record<string, () => void> = {
  gallery: () => { camera.target.set(0, 0.9, 0); camera.alpha = -Math.PI / 2; camera.beta = 1.15; camera.radius = 44; },
  close: () => {
    const c = num('col', 0);
    camera.target.set(colX(c, POSES.length), 0.85, ROWS[num('row', 1)].z);
    camera.alpha = -Math.PI / 2 + num('rot', 0.3); camera.beta = num('beta', 1.38); camera.radius = num('r', 4.5);
  },
  side: () => { camera.target.set(0, 0.9, 7.2); camera.alpha = -Math.PI / 2 - 0.5; camera.beta = 1.25; camera.radius = 26; },
  back: () => { camera.target.set(0, 0.9, 4); camera.alpha = Math.PI / 2; camera.beta = 1.2; camera.radius = 34; },
  far: () => { camera.target.set(0, 0, 40); camera.alpha = -Math.PI / 2 + 0.4; camera.beta = 0.85; camera.radius = 230; },
  outfits: () => { camera.target.set(0, 0.9, OUTFIT_Z - 0.7); camera.alpha = -Math.PI / 2; camera.beta = 1.4; camera.radius = 13; },
  props: () => { camera.target.set(0, 1.0, HOLD_Z); camera.alpha = -Math.PI / 2; camera.beta = 1.42; camera.radius = 9; },
  crowd: () => { camera.target.set(0, 0.5, ROAD_C.z - 8); camera.alpha = -Math.PI / 2 + 0.6; camera.beta = 1.2; camera.radius = 26; },
  cars: () => { camera.target.set(-6, 0.8, -36); camera.alpha = -Math.PI / 2 - 0.55; camera.beta = 1.2; camera.radius = 15; },
  road: () => { camera.target.set(-38, 0.8, ROAD_C.z); camera.alpha = Math.PI + 0.5; camera.beta = 1.25; camera.radius = 30; },
  top: () => { camera.target.set(0, 0, 40); camera.alpha = -Math.PI / 2; camera.beta = 0.35; camera.radius = 90; },
};
const presetKeys = Object.keys(presets);
(presets[q.get('cam') ?? 'gallery'] ?? presets.gallery)();
if (q.has('tx')) camera.target.set(num('tx', 0), num('ty', 1), num('tz', 0));
if (q.has('alpha')) camera.alpha = num('alpha', camera.alpha);
if (q.has('beta')) camera.beta = num('beta', camera.beta);
if (q.has('r')) camera.radius = num('r', camera.radius);

// ---------------------------------------------------------------- day / night
let night = num('night', 0);
let nightTarget = night;
const applyLight = () => {
  const day = 1 - night;
  sun.intensity = 0.06 + 0.9 * day;
  sun.diffuse = Color3.Lerp(Color3.FromHexString('#8fa3d6'), Color3.FromHexString('#fff6e8'), day);
  hemi.intensity = 0.16 + 0.44 * day;
  hemi.diffuse = Color3.Lerp(Color3.FromHexString('#5a6aa0'), Color3.FromHexString('#f2f4ff'), day);
  const sky = Color3.Lerp(Color3.FromHexString('#0d1424'), Color3.FromHexString('#a9c8e8'), day);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
};
applyLight();

// ---------------------------------------------------------------- input
let selected = -1;
const pickAt = (x: number, y: number) => {
  const pick = scene.pick(x, y);
  const pid = peopleR.pickedId(pick);
  const vid = vehicleR.pickedId(pick);
  selected = pid >= 0 ? pid : -1;
  for (const p of people) p.highlight = p.id === selected;
  return { person: pid, vehicle: vid, mesh: pick.pickedMesh?.name ?? null };
};
let lastPick = '';
scene.onPointerObservable.add((e) => {
  if (e.type === PointerEventTypes.POINTERTAP) lastPick = JSON.stringify(pickAt(scene.pointerX, scene.pointerY));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'n') nightTarget = nightTarget > 0.5 ? 0 : 1;
  if (e.key === 'g') setGlow(!glow);
  if (e.key === 'l') { lodMode = lodMode === 'auto' ? 'detail' : lodMode === 'detail' ? 'far' : 'auto'; applyLod(); }
  const k = Number(e.key);
  if (k >= 1 && k <= Math.min(9, presetKeys.length)) presets[presetKeys[k - 1]]();
});
window.addEventListener('resize', () => engine.resize());

// ---------------------------------------------------------------- loop
const freeze = q.has('freeze') ? num('freeze', 0) : -1;
const stats = { people: 0, vehicles: 0, frames: 0, pMs: 0, vMs: 0, renderMs: 0, frameMs: 0, detailed: 0 };
const t0 = performance.now();
let last = t0;
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // freeze=<t>: animation runs for 1 s, then stops at t + 1 (fades still run in real time)
  const t = freeze >= 0 ? freeze + Math.min(1, (now - t0) / 1000) : (now - t0) / 1000;
  if (night !== nightTarget) { night += Math.sign(nightTarget - night) * Math.min(Math.abs(nightTarget - night), dt * 0.5); applyLight(); }

  for (const w of walkers) {
    w.a += w.w * (freeze >= 0 ? 0 : dt);
    w.p.x = ROAD_C.x + Math.cos(w.a) * w.r;
    w.p.y = ROAD_C.z + Math.sin(w.a) * w.r;
    w.p.heading = w.a + (w.w >= 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const d of drivers) {
    d.a += d.w * (freeze >= 0 ? 0 : dt);
    d.v.x = ROAD_C.x + Math.cos(d.a) * d.r;
    d.v.y = ROAD_C.z + Math.sin(d.a) * d.r;
    d.v.heading = d.a + (d.w >= 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  const scale = q.has('scale') ? num('scale', 1) : Math.min(2.5, Math.max(1, camera.radius / 110));
  const a = performance.now();
  const empty = q.get('blink') === '1' && Math.floor((now - t0) / 700) % 2 === 1;
  peopleR.update(empty ? [] : people, t, scale, dt);
  const b = performance.now();
  vehicleR.update(empty ? [] : vehicles, t, night);
  const c = performance.now();
  stats.pMs = stats.pMs * 0.95 + (b - a) * 0.05;
  stats.vMs = stats.vMs * 0.95 + (c - b) * 0.05;
  stats.frames++;
  stats.people = people.length;
  stats.vehicles = vehicles.length;
  stats.detailed = peopleR.detailedCount;

  const r0 = performance.now();
  scene.render();
  stats.renderMs = stats.renderMs * 0.95 + (performance.now() - r0) * 0.05;
  stats.frameMs = stats.frameMs * 0.95 + dt * 1000 * 0.05;

  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const vp = camera.viewport.toGlobal(w, h);
  const show = camera.radius < 60;
  labels.forEach((l, i) => {
    const p = Vector3.Project(l.pos, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    const el = tags[i];
    el.style.display = show && p.z > 0 && p.z < 1 ? 'block' : 'none';
    el.style.left = `${(p.x / w) * canvas.clientWidth}px`;
    el.style.top = `${(p.y / h) * canvas.clientHeight}px`;
  });
  if (stats.frames % 10 === 0) {
    hud.textContent = `fps ${engine.getFps().toFixed(0)}  people ${people.length} (${benchCount} bench)  detailed ${stats.detailed}${peopleR.detailReady ? '' : ' (loading)'}  vehicles ${vehicles.length}  LOD ${lodMode}\n` +
      `people.update ${stats.pMs.toFixed(2)} ms  render ${stats.renderMs.toFixed(2)} ms  draw calls ${inst.drawCallsCounter.lastSecAverage.toFixed(0)}  scale ${scale.toFixed(2)}  night ${night.toFixed(2)}\n` +
      `keys: n night, g glow, l LOD, 1-9 cameras (${presetKeys.slice(0, 9).join(' ')}), click to pick ${lastPick}`;
  }
});

// ---------------------------------------------------------------- scripted checks (puppeteer)
/** Screen position (CSS px) of a world point given in sim coordinates. */
const screenOf = (x: number, y: number, z: number) => {
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const p = Vector3.Project(new Vector3(x, z, y), Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  return { x: (p.x / w) * canvas.clientWidth, y: (p.y / h) * canvas.clientHeight };
};
/** Pick test: aim at every gallery person's chest and every vehicle's body; returns failures. */
const pickTest = () => {
  const fails: string[] = [];
  let ok = 0;
  for (const p of people.slice(0, benchCount)) {
    if (p.pose === 'sleep') continue;
    const seated = SEATED.has(p.pose);
    const kneel = p.pose === 'build' || p.pose === 'gather';
    const s = screenOf(p.x, p.y, p.z + (seated ? 0.85 : kneel ? 0.6 : 1.2) * p.looks.height / 1.75);
    if (s.x < 0 || s.y < 0 || s.x > canvas.clientWidth || s.y > canvas.clientHeight) continue;
    const r = pickAt(s.x, s.y);
    if (r.person === p.id) ok++; else fails.push(`person ${p.id} ${p.pose} -> ${JSON.stringify(r)}`);
  }
  for (const v of vehicles) {
    const s = screenOf(v.x, v.y, v.z + (v.kind === 'truck' ? 2.0 : 0.8));
    if (s.x < 0 || s.y < 0 || s.x > canvas.clientWidth || s.y > canvas.clientHeight) continue;
    const r = pickAt(s.x, s.y);
    if (r.vehicle === v.id) ok++; else fails.push(`vehicle ${v.id} -> ${JSON.stringify(r)}`);
  }
  return { ok, fails };
};
/** Average people.update and scene.render ms over `frames` frames. */
const measure = (frames = 120) => new Promise<{ update: number; render: number; frame: number; detailed: number; draws: number }>((resolve) => {
  let n = 0, u = 0, r = 0, f = 0, d = 0;
  let lastF = performance.now();
  const obs = scene.onAfterRenderObservable.add(() => {
    const now = performance.now();
    n++; u += stats.pMs; r += stats.renderMs; f += now - lastF; d += stats.detailed;
    lastF = now;
    if (n >= frames) {
      scene.onAfterRenderObservable.remove(obs);
      resolve({ update: u / n, render: r / n, frame: f / n, detailed: d / n, draws: inst.drawCallsCounter.lastSecAverage });
    }
  });
});
const setLod = (m: LodMode) => { lodMode = m; applyLod(); };
(window as unknown as { dev: unknown }).dev = { scene, engine, camera, people, vehicles, peopleR, vehicleR, stats, pickAt, presets, screenOf, pickTest, measure, setLod };
