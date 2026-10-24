// Test bench for the camera controller: a small fake town (terrain, streets,
// box buildings, one opened-up building with ghost walls and floor slabs) and
// a dummy subject on a scripted loop: walk, stop and talk, walk to a car,
// drive around the block, park, walk into the opened building, work, go
// upstairs, come back out. Buttons switch free / follow / cinema / walk.
// URL params: ?mode=cinema&speed=1&t=0&seed=1
//
// window.bench has helpers for automated tests (see the bottom).

import {
  Color3, Color4, DirectionalLight, Engine, HemisphericLight, Matrix, Mesh, MeshBuilder, Ray, Scene, ShadowGenerator,
  StandardMaterial, TransformNode, Vector3, VertexData,
} from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import { CameraController, type CameraMode, type CutawayBox, type ShotType, type Subject } from '../src/render/camera';

const params = new URLSearchParams(location.search);
const FLOOR_H = 3.2;

// ------------------------------------------------------------------ terrain

function heightAt(x: number, y: number): number {
  const hill = 13 * Math.exp(-((x - 125) ** 2 + (y + 45) ** 2) / 2200);
  return 1.4 * Math.sin(x * 0.011) * Math.cos(y * 0.009) + 0.7 * Math.sin((x - y) * 0.017) + hill;
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
const scene = new Scene(engine);
scene.clearColor = new Color4(0.66, 0.79, 0.89, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.0025;
scene.fogColor = new Color3(0.66, 0.79, 0.89);

const cam = new CameraController(scene, canvas, {
  heightAt,
  isOccluder: (m) => (m.metadata as { kind?: string } | null)?.kind === 'building' && !m.name.endsWith('-ghost'),
  seed: Number(params.get('seed') ?? 1),
});
const camera = cam.camera;
camera.target.copyFromFloats(0, heightAt(0, 0), 0);
camera.radius = 140;

const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
hemi.intensity = 0.62;
hemi.groundColor = Color3.FromHexString('#4a4a3a');
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35).normalize(), scene);
sun.intensity = 0.95;
sun.diffuse = Color3.FromHexString('#fff2dd');
sun.autoUpdateExtends = false;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.bias = 0.0008;
shadows.normalBias = 0.04;

const mat = (name: string, hex: string, alpha = 1): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  if (alpha < 1) { m.alpha = alpha; m.backFaceCulling = false; }
  return m;
};

const ground = MeshBuilder.CreateGround('ground', { width: 700, height: 700, subdivisions: 175, updatable: true }, scene);
{
  const pos = ground.getVerticesData('position')!;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = heightAt(pos[i], pos[i + 2]);
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, ground.getIndices()!, nrm);
  ground.updateVerticesData('position', pos);
  ground.updateVerticesData('normal', nrm);
  ground.refreshBoundingInfo();
}
ground.material = mat('groundMat', '#7f9a62');
ground.receiveShadows = true;
ground.isPickable = false;

// ------------------------------------------------------------------ streets

const LINES = [-80, 0, 80];
const roadMat = mat('roadMat', '#45474c');
roadMat.zOffset = -1;
const walkMat = mat('walkMat', '#b4afa6');
walkMat.zOffset = -0.5;
function strip(name: string, ax: number, ay: number, bx: number, by: number, o0: number, o1: number, lift: number, m: StandardMaterial): void {
  const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
  const A: Vector3[] = [], B: Vector3[] = [];
  for (let s = 0; s <= len + 0.01; s += 4) {
    for (const [arr, o] of [[A, o0], [B, o1]] as [Vector3[], number][]) {
      const x = ax + ux * s + nx * o, y = ay + uy * s + ny * o;
      arr.push(new Vector3(x, heightAt(x, y) + lift, y));
    }
  }
  const r = MeshBuilder.CreateRibbon(name, { pathArray: o1 > o0 ? [B, A] : [A, B], sideOrientation: Mesh.DOUBLESIDE }, scene);
  r.material = m;
  r.receiveShadows = true;
  r.isPickable = false;
}
for (const c of LINES) {
  strip('streetX', -120, c, 120, c, -4, 4, 0.06, roadMat);
  strip('streetY', c, -120, c, 120, -4, 4, 0.07, roadMat);
  for (const side of [1, -1]) {
    strip('walkX', -120, c, 120, c, side * 4, side * 7, 0.12, walkMat);
    strip('walkY', c, -120, c, 120, side * 4, side * 7, 0.13, walkMat);
  }
}

// ------------------------------------------------------------------ buildings

interface Box { id: number; x: number; y: number; w: number; d: number; h: number; angle: number }
const boxes: Box[] = [];
const bmats = ['#c9b79c', '#a87c64', '#d8d2c4', '#8c97a3', '#b9a27f', '#9e6b55', '#e0d6bf'].map((c, i) => mat(`b${i}`, c));
let rs = 12345;
const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };

function addBox(b: Box): Mesh {
  const m = MeshBuilder.CreateBox(`bld${b.id}-solid`, { width: b.w, height: b.h, depth: b.d }, scene);
  m.position.y = b.h / 2;
  m.bakeCurrentTransformIntoVertices();
  m.position.set(b.x, heightAt(b.x, b.y) - 0.3, b.y);
  m.rotation.y = Math.PI / 2 - b.angle;
  m.material = bmats[b.id % bmats.length];
  m.metadata = { kind: 'building', id: b.id };
  m.receiveShadows = true;
  shadows.addShadowCaster(m);
  m.computeWorldMatrix(true);
  m.freezeWorldMatrix();
  boxes.push(b);
  return m;
}

const CUT: CutawayBox = { x: 56.5, y: -23.5, w: 14, d: 12, floors: 2, angle: Math.PI / 2, id: 99 };
CUT.ground = heightAt(CUT.x, CUT.y);
let id = 1;
for (const bx of [-120, -40, 40, 120]) {
  for (const by of [-120, -40, 40, 120]) {
    for (const qx of [-16.5, 16.5]) {
      for (const qy of [-16.5, 16.5]) {
        const x = bx + qx, y = by + qy;
        if (Math.hypot(x - CUT.x, y - CUT.y) < 3) continue;
        if (Math.abs(x) > 130 || Math.abs(y) > 130) continue;
        const floors = 1 + Math.floor(rnd() * rnd() * 7);
        const w = 11 + rnd() * 6, d = 11 + rnd() * 6;
        const angle = (Math.abs(qy) > 0 ? (qy > 0 ? -Math.PI / 2 : Math.PI / 2) : 0) + (rnd() < 0.15 ? 0.12 : 0);
        addBox({ id: id++, x, y, w, d, h: floors * FLOOR_H + 0.6, angle });
      }
    }
  }
}

// ?stress=N: N extra building meshes around the town (like a big city's ~7 meshes per building)
{
  const n = Number(params.get('stress') ?? 0);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, r = 150 + rnd() * 180;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    const m = MeshBuilder.CreateBox(`bld${1000 + k}-solid`, { width: 8, height: 6, depth: 8 }, scene);
    m.position.set(x, heightAt(x, y) + 3, y);
    m.material = bmats[k % bmats.length];
    m.metadata = { kind: 'building', id: 1000 + k };
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
  }
}

// the opened-up building: ghost walls, solid floor slabs and furniture
{
  const g = CUT.ground!;
  const parts: Mesh[] = [];
  for (let f = 0; f < CUT.floors; f++) {
    const top = f * FLOOR_H + 0.15;
    const s = MeshBuilder.CreateBox('slab', { width: CUT.w - 0.15, height: 0.3, depth: CUT.d - 0.15 }, scene);
    s.position.set(0, top - 0.15, 0);
    parts.push(s);
    // a desk and a cabinet per floor
    const desk = MeshBuilder.CreateBox('desk', { width: 1.6, height: 0.75, depth: 0.8 }, scene);
    desk.position.set(-3.5 + f * 4, top + 0.375, -1);
    parts.push(desk);
    const cab = MeshBuilder.CreateBox('cab', { width: 0.6, height: 1.8, depth: 2.5 }, scene);
    cab.position.set(6.2, top + 0.9, 2 - f * 3);
    parts.push(cab);
  }
  for (const p of parts) p.bakeCurrentTransformIntoVertices();
  const solid = Mesh.MergeMeshes(parts, true, true)!;
  solid.name = 'bld99-solid';
  solid.position.set(CUT.x, g, CUT.y);
  solid.rotation.y = Math.PI / 2 - CUT.angle;
  solid.material = mat('slabMat', '#cfc6b3');
  solid.metadata = { kind: 'building', id: 99 };
  solid.receiveShadows = true;
  shadows.addShadowCaster(solid);
  const walls: Mesh[] = [];
  const H = CUT.floors * FLOOR_H;
  for (const [wx, wz, ww, wd] of [[0, CUT.d / 2, CUT.w, 0.2], [0, -CUT.d / 2, CUT.w, 0.2], [CUT.w / 2, 0, 0.2, CUT.d], [-CUT.w / 2, 0, 0.2, CUT.d]]) {
    const w = MeshBuilder.CreateBox('wall', { width: ww, height: H, depth: wd }, scene);
    w.position.set(wx, H / 2, wz);
    w.bakeCurrentTransformIntoVertices();
    walls.push(w);
  }
  const ghost = Mesh.MergeMeshes(walls, true, true)!;
  ghost.name = 'bld99-ghost';
  ghost.position.copyFrom(solid.position);
  ghost.rotation.y = solid.rotation.y;
  ghost.material = mat('ghostMat', '#dfe8f0', 0.16);
  ghost.isPickable = false;
  ghost.metadata = { kind: 'building', id: 99 };
}

// ------------------------------------------------------------------ actors

function person(name: string, shirt: string): TransformNode {
  const root = new TransformNode(name, scene);
  const body = MeshBuilder.CreateCapsule(name + '-body', { height: 1.45, radius: 0.24 }, scene);
  body.position.y = 0.73;
  body.material = mat(name + '-shirt', shirt);
  const head = MeshBuilder.CreateSphere(name + '-head', { diameter: 0.3, segments: 10 }, scene);
  head.position.y = 1.6;
  head.material = mat(name + '-skin', '#e0b48f');
  const nose = MeshBuilder.CreateBox(name + '-nose', { width: 0.08, height: 0.08, depth: 0.12 }, scene);
  nose.position.set(0, 1.6, 0.16);
  nose.material = head.material;
  for (const m of [body, head, nose]) { m.parent = root; m.isPickable = false; shadows.addShadowCaster(m); }
  return root;
}
const hero = person('hero', '#d4473b');
const friend = person('friend', '#3b6fd4');

const car = new TransformNode('car', scene);
{
  const body = MeshBuilder.CreateBox('car-body', { width: 1.85, height: 0.8, depth: 4.4 }, scene);
  body.position.y = 0.55;
  body.material = mat('carMat', '#2e5e9e');
  const cabin = MeshBuilder.CreateBox('car-cabin', { width: 1.6, height: 0.6, depth: 2.3 }, scene);
  cabin.position.set(0, 1.25, -0.2);
  cabin.material = mat('cabMat', '#1b2633');
  for (const m of [body, cabin]) { m.parent = car; m.isPickable = false; shadows.addShadowCaster(m); }
}

// ------------------------------------------------------------------ script

type P = [number, number];
type Phase =
  | { k: 'walk'; path: P[]; speed: number; inside?: boolean; floor?: number; dur?: number }
  | { k: 'idle'; dur: number; at: P; heading: number; talking?: boolean; working?: boolean; inside?: boolean; floor?: number }
  | { k: 'drive'; path: P[]; speed: number; dur?: number };

/** Round a polyline's corners with arcs of radius R. */
function fillet(path: P[], R: number): P[] {
  const out: P[] = [path[0]];
  for (let i = 1; i + 1 < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], [cx, cy] = path[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const u1x = (bx - ax) / l1, u1y = (by - ay) / l1, u2x = (cx - bx) / l2, u2y = (cy - by) / l2;
    const r = Math.min(R, l1 / 2, l2 / 2);
    const p0: P = [bx - u1x * r, by - u1y * r], p1: P = [bx + u2x * r, by + u2y * r];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8; // quadratic bezier through the corner
      const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * bx + t * t * p1[0];
      const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * by + t * t * p1[1];
      out.push([x, y]);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}
const pathLen = (p: P[]) => { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; };
function along(p: P[], s: number): { x: number; y: number; heading: number } {
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (s <= l || i === p.length - 1) {
      const f = l > 0 ? Math.min(1, s / l) : 0;
      return { x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f, heading: Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]) };
    }
    s -= l;
  }
  return { x: p[0][0], y: p[0][1], heading: 0 };
}

const DOOR: P = [56.5, -17.3];
const FRIEND: P = [-34.9, 5.5];
const drivePath = fillet([[-12, 2.2], [77.8, 2.2], [77.8, -77.8], [2.2, -77.8], [2.2, -2.2], [56.5, -2.2]], 9);
const SCRIPT: Phase[] = [
  { k: 'walk', path: [[-62, 5.5], [-36.2, 5.5]], speed: 1.4 },
  { k: 'idle', dur: 8, at: [-36.2, 5.5], heading: 0, talking: true },
  { k: 'walk', path: [[-36.2, 5.5], [-30, 5.5], [-26, 5.2], [-13, 5.2]], speed: 1.4 },
  { k: 'idle', dur: 1.2, at: [-13, 5.2], heading: -Math.PI / 2 },
  { k: 'drive', path: drivePath, speed: 9 },
  { k: 'idle', dur: 1.5, at: [56.5, -5.5], heading: -Math.PI / 2 },
  { k: 'walk', path: [[56.5, -5.5], DOOR], speed: 1.4 },
  { k: 'walk', path: [DOOR, [56.5, -21], [53, -23.6]], speed: 1.2, inside: true },
  { k: 'idle', dur: 9, at: [53, -23.6], heading: Math.PI, working: true, inside: true },
  { k: 'walk', path: [[53, -23.6], [60, -27.5]], speed: 1.2, inside: true },
  { k: 'walk', path: [[60, -27.5], [57, -24.5]], speed: 1.2, inside: true, floor: 1 },
  { k: 'idle', dur: 7, at: [57, -24.5], heading: 2.4, inside: true, floor: 1, talking: true },
  { k: 'walk', path: [[57, -24.5], [60, -27.5]], speed: 1.2, inside: true, floor: 1 },
  { k: 'walk', path: [[60, -27.5], [56.5, -21], DOOR], speed: 1.3, inside: true },
  { k: 'walk', path: [DOOR, [56.5, -5.5], [20, -5.5]], speed: 1.4 },
];
let total = 0;
const starts: number[] = [];
for (const ph of SCRIPT) {
  starts.push(total);
  if (ph.k !== 'idle') ph.dur = pathLen(ph.path) / ph.speed;
  total += ph.dur!;
}
const driveIdx = SCRIPT.findIndex((p) => p.k === 'drive');

interface State { s: Subject; carX: number; carY: number; carH: number }
function scriptAt(t: number): State {
  const loop = Math.floor(t / total);
  let tl = t - loop * total;
  let i = 0;
  while (i + 1 < SCRIPT.length && tl >= starts[i + 1]) i++;
  tl -= starts[i];
  const ph = SCRIPT[i];
  let x = 0, y = 0, heading = 0, moving = false;
  if (ph.k === 'idle') { [x, y] = ph.at; heading = ph.heading; }
  else { const a = along(ph.path, tl * ph.speed); x = a.x; y = a.y; heading = a.heading; moving = true; }
  const inside = ph.k !== 'drive' && !!ph.inside;
  const floor = ph.k !== 'drive' ? ph.floor ?? 0 : 0;
  const z = inside ? CUT.ground! + 0.15 + floor * FLOOR_H : heightAt(x, y) + (ph.k === 'drive' ? 0 : 0.12);
  const s: Subject = {
    x, y, z, heading, moving, driving: ph.k === 'drive', inside, id: 1000 + loop,
    talking: ph.k === 'idle' && !!ph.talking, working: ph.k === 'idle' && !!ph.working,
    cutawayBuilding: inside ? CUT : null,
    partner: ph.k === 'idle' && ph.talking && !inside ? { x: FRIEND[0], y: FRIEND[1] } : null,
  };
  // the car: parked at the start, driving, then parked at the end
  const dp = drivePath;
  let carX = dp[0][0], carY = dp[0][1], carH = 0;
  if (i > driveIdx) { const e = along(dp, 1e9); carX = e.x; carY = e.y; carH = e.heading; }
  if (ph.k === 'drive') { carX = x; carY = y; carH = heading; }
  return { s, carX, carY, carH };
}

// ------------------------------------------------------------------ loop

let t = Number(params.get('t') ?? 0);
let speed = Number(params.get('speed') ?? 1);
let paused = false;
let state = scriptAt(t);

function placeActors(st: State): void {
  const s = st.s;
  hero.setEnabled(!s.driving);
  hero.position.set(s.x, s.z, s.y);
  hero.rotation.y = Math.PI / 2 - s.heading;
  friend.position.set(FRIEND[0], heightAt(FRIEND[0], FRIEND[1]) + 0.12, FRIEND[1]);
  friend.rotation.y = Math.PI / 2 - Math.PI;
  car.position.set(st.carX, heightAt(st.carX, st.carY), st.carY);
  car.rotation.y = Math.PI / 2 - st.carH;
}

function step(dt: number): void {
  if (!paused) t += dt * speed;
  state = scriptAt(t);
  placeActors(state);
  cam.update(dt, state.s);
}

scene.onBeforeRenderObservable.add(() => {
  const ext = Math.min(500, Math.max(50, camera.radius * 1.5));
  sun.shadowFrustumSize = ext;
  sun.position = camera.target.subtract(sun.direction.scale(400));
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 900;
});
let auto = true;
engine.runRenderLoop(() => {
  if (auto) step(Math.min(0.1, engine.getDeltaTime() / 1000));
  scene.render();
});
window.addEventListener('resize', () => engine.resize());

// ------------------------------------------------------------------ UI

const statsEl = document.getElementById('stats')!;
const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const sync = () => {
  for (const b of btns) b.classList.toggle('on', b.dataset.mode === cam.mode);
  document.getElementById('letterbox')!.classList.toggle('on', cam.letterbox);
  document.getElementById('captions')!.classList.toggle('on', cam.captions);
  document.getElementById('pause')!.classList.toggle('on', paused);
  document.getElementById('fast')!.textContent = `Speed x${speed}`;
};
const modeLog: string[] = [];
cam.onModeChange = (m, prev, reason) => { modeLog.push(`${prev}->${m}:${reason}`); sync(); };
const shotLog: { type: ShotType; reason: string; t: number; info: string }[] = [];
cam.onShot = (type, reason) => shotLog.push({ type, reason, t, info: cam.lastCut });
for (const b of btns) b.onclick = () => cam.setMode(b.dataset.mode as CameraMode);
document.getElementById('letterbox')!.onclick = () => { cam.letterbox = !cam.letterbox; sync(); };
document.getElementById('captions')!.onclick = () => { cam.captions = !cam.captions; sync(); };
document.getElementById('pause')!.onclick = () => { paused = !paused; sync(); };
document.getElementById('fast')!.onclick = () => { speed = speed === 1 ? 3 : speed === 3 ? 8 : 1; sync(); };
sync();
setInterval(() => {
  const st = cam.stats, s = state.s;
  statsEl.textContent =
    `mode ${cam.mode}  shot ${cam.shotType ?? '-'} ${cam.shotTime.toFixed(1)}s  cuts ${st.cuts}\n` +
    `subject ${s.driving ? 'driving' : s.inside ? 'inside' : s.moving ? 'walking' : 'standing'}${s.talking ? ' talking' : ''}${s.working ? ' working' : ''}  t ${t.toFixed(1)}/${total.toFixed(0)}\n` +
    `rays ${st.raysPerSec.toFixed(0)}/s  blocked samples ${st.blockedSamples}/${st.samples}  update ${st.updateMs.toFixed(3)} ms  fps ${engine.getFps().toFixed(0)}`;
}, 250);

const mode0 = params.get('mode') as CameraMode | null;
if (mode0) cam.setMode(mode0);

// ------------------------------------------------------------------ test helpers

const verifyRay = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
const occ = (m: AbstractMesh) => (m.metadata as { kind?: string } | null)?.kind === 'building' && !m.name.endsWith('-ghost') && m.isEnabled();
/** Independent check (scene.pickWithRay over everything): is a point visible from the camera? */
function visible(p: Vector3, c: Vector3): boolean {
  const d = p.subtract(c);
  const L = d.length();
  verifyRay.origin.copyFrom(c);
  verifyRay.direction.copyFrom(d.scale(1 / L));
  verifyRay.length = L - 0.15;
  if (scene.pickWithRay(verifyRay, occ, true)?.hit) return false;
  for (let i = 1; i < 20; i++) {
    const f = i / 20, x = c.x + d.x * f, y = c.y + d.y * f, z = c.z + d.z * f;
    if (y < heightAt(x, z) + 0.05) return false;
  }
  return true;
}
function insideBox(c: Vector3): boolean {
  for (const b of boxes) {
    const g = heightAt(b.x, b.y) - 0.3;
    if (c.y > g + b.h + 0.1) continue;
    const dx = c.x - b.x, dz = c.z - b.y, a = Math.cos(b.angle), s = Math.sin(b.angle);
    if (Math.abs(dx * a + dz * s) < b.d / 2 + 0.1 && Math.abs(dx * s - dz * a) < b.w / 2 + 0.1) return true;
  }
  return false;
}
/** Where the subject's head lands on screen (NDC, y up) and whether it's in front. */
function screenOf(p: Vector3): { x: number; y: number; front: boolean } {
  const vm = camera.getViewMatrix(true), pm = camera.getProjectionMatrix(true);
  const m = vm.multiply(pm);
  const v = Vector3.TransformCoordinates(p, m);
  const w = Vector3.TransformCoordinates(p, vm);
  return { x: v.x, y: v.y, front: w.z > 0 };
}

interface RunReport {
  frames: number; seconds: number; occludedBoth: number; occludedAny: number; belowGround: number; insideBox: number;
  offscreen: number; shots: Record<string, number>; framing: Record<string, [number, number, number]>;
  cuts: number; reasons: Record<string, number>; msPerUpdate: number; maxMs: number; rays: number;
  blockedFrames: { t: number; type: string }[];
  offFrames: { t: number; type: string; x: number; y: number; st: number }[];
}
function run(seconds: number, dt = 1 / 30): RunReport {
  auto = false;
  const rep: RunReport = {
    frames: 0, seconds, occludedBoth: 0, occludedAny: 0, belowGround: 0, insideBox: 0, offscreen: 0, shots: {}, framing: {},
    cuts: 0, reasons: {}, msPerUpdate: 0, maxMs: 0, rays: 0, blockedFrames: [], offFrames: [],
  };
  const cuts0 = cam.stats.cuts, rays0 = cam.stats.rays, log0 = shotLog.length;
  let ms = 0;
  const pos = new Vector3();
  for (let k = 0; k * dt < seconds; k++) {
    const t0 = performance.now();
    step(dt);
    const el = performance.now() - t0;
    ms += el;
    rep.maxMs = Math.max(rep.maxMs, el);
    rep.frames++;
    if (cam.mode !== 'cinema') continue;
    const s = state.s;
    cam.position(pos);
    const headY = s.driving ? 1.3 : 1.65, chestY = s.driving ? 0.7 : 1.1;
    const head = new Vector3(s.x, s.z + headY, s.y), chest = new Vector3(s.x, s.z + chestY, s.y);
    const vh = visible(head, pos), vc = visible(chest, pos);
    if (!vh && !vc) { rep.occludedBoth++; if (rep.blockedFrames.length < 40) rep.blockedFrames.push({ t: +t.toFixed(2), type: cam.shotType ?? '-' }); }
    if (!vh || !vc) rep.occludedAny++;
    if (pos.y < heightAt(pos.x, pos.z) + 0.2) rep.belowGround++;
    if (insideBox(pos)) rep.insideBox++;
    const type = cam.shotType ?? '-';
    rep.shots[type] = (rep.shots[type] ?? 0) + 1;
    const sp = screenOf(s.driving ? chest : head);
    if (!sp.front || Math.abs(sp.x) > 1 || Math.abs(sp.y) > 1) { rep.offscreen++; if (rep.offFrames.length < 30) rep.offFrames.push({ t: +t.toFixed(2), type, x: +sp.x.toFixed(2), y: +sp.y.toFixed(2), st: +cam.shotTime.toFixed(2) }); }
    const f = rep.framing[type] ?? [0, 0, 0];
    f[0] += Math.abs(sp.x); f[1] += sp.y; f[2]++;
    rep.framing[type] = f;
  }
  for (const k in rep.framing) { const f = rep.framing[k]; rep.framing[k] = [+(f[0] / f[2]).toFixed(2), +(f[1] / f[2]).toFixed(2), f[2]]; }
  for (const e of shotLog.slice(log0)) rep.reasons[e.reason] = (rep.reasons[e.reason] ?? 0) + 1;
  rep.cuts = cam.stats.cuts - cuts0;
  rep.rays = cam.stats.rays - rays0;
  rep.msPerUpdate = +(ms / rep.frames).toFixed(4);
  auto = true;
  return rep;
}

Object.assign(window, {
  bench: {
    cam, scene, engine, camera, CUT, boxes, shotLog, modeLog, total,
    get t() { return t; }, set t(v: number) { t = v; },
    get speed() { return speed; }, set speed(v: number) { speed = v; sync(); },
    get paused() { return paused; }, set paused(v: boolean) { paused = v; sync(); },
    get auto() { return auto; }, set auto(v: boolean) { auto = v; },
    setMode: (m: CameraMode) => cam.setMode(m),
    subject: () => state.s,
    shot: () => ({ type: cam.shotType, t: cam.shotTime }),
    forceShot: (type: ShotType) => cam.forceShot(type),
    /** Advance the script and camera without rendering (dt seconds per step). */
    step: (seconds: number, dt = 1 / 30) => { const a = auto; auto = false; for (let k = 0; k * dt < seconds; k++) step(dt); auto = a; },
    run,
    visible: () => { const p = cam.position(); const s = state.s; return visible(new Vector3(s.x, s.z + 1.6, s.y), p); },
    target: () => camera.target.asArray().map((v) => +v.toFixed(2)),
    orbit: () => ({ alpha: +camera.alpha.toFixed(3), beta: +camera.beta.toFixed(3), radius: +camera.radius.toFixed(2) }),
    pos: () => cam.position().asArray().map((v) => +v.toFixed(2)),
    phaseTimes: () => SCRIPT.map((p, i) => [p.k, +starts[i].toFixed(1), +(p.dur ?? 0).toFixed(1)]),
    Matrix,
  },
});
