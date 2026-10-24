// Test bench for src/render/ads.ts (posters, city-light panels, billboards with
// owner plates, vacant spaces, banners, flyers, advertising columns, rotating
// LED screens on downtown towers) and the liveries of src/render/vehicles.ts
// (company and outside-fleet vans and trucks driving along the boulevard).
// The towers are plain textured boxes so the bench doesn't depend on the
// building renderer. Open /dev/ads.html on the dev server.
// URL params: cam=orbit|screens|plaza|columns|boards|vans|street|far  night=0..1  t=<frozen seconds>
//   stress=1 (about 600 ads incl. 40 screens and 80 columns, 400 vehicles)  ui=0 (hide the panel)

import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Engine, GlowLayer, HemisphericLight, MeshBuilder, PointerEventTypes,
  Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, Texture, Vector3, Vector4,
} from '@babylonjs/core';
import { AdRenderer, type OwnerInfo } from '../src/render/ads';
import { VehicleRenderer, type VehicleVisual } from '../src/render/vehicles';
import type { AdPlacement, World } from '../src/sim/types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const STRESS = q.get('stress') === '1';
const frozen = q.has('t') ? num('t', 0) : null;

// --------------------------------------------------------------- the city

interface Box { x0: number; x1: number; y0: number; y1: number; h: number; id: number; tone: number }
const towers: Box[] = [];
let bid = 1;
const tower = (x0: number, x1: number, y0: number, y1: number, h: number, tone = 0) => { const b = { x0, x1, y0, y1, h, id: bid++, tone }; towers.push(b); return b; };
// boulevard along x at y = 0 (road |y| < 8.6, sidewalks to 12.4) through a downtown square (plaza to |y| = 40),
// cross streets at x = 0 and x = 130; tall towers on the north side, lower ones on the south side
const T1 = tower(-110, -70, 40, 80, 72, 1), T2 = tower(-62, -12, 40, 78, 112, 0), T3 = tower(12, 58, 40, 74, 88, 2), T4 = tower(66, 118, 40, 72, 56, 1);
const T5 = tower(-100, -60, -78, -40, 34, 2), T6 = tower(-52, -12, -74, -40, 42, 1), T7 = tower(12, 52, -76, -40, 38, 0), T8 = tower(62, 118, -68, -40, 30, 2);
// low-rise shops east of the cross street
const shops: Box[] = [];
for (let i = 0; i < 6; i++) { const x0 = 142 + i * 24; const b = tower(x0, x0 + 20, 12.5, 30, 7 + ((i * 5) % 9), 3); shops.push(b); }
for (let i = 0; i < 5; i++) { const x0 = 146 + i * 28; const b = tower(x0, x0 + 22, -32, -12.5, 6 + ((i * 7) % 8), 3); shops.push(b); }

/** A flat world (heightAt reads only size, tile and height). */
const flatWorld = { size: 4, tile: 2000, height: new Array(16).fill(0) } as unknown as World;

// ---------------------------------------------------------------- brands

interface Spon { id: number; headline: string; tagline: string; hue: number; topic: AdPlacement['topic'] }
const S: Spon[] = [
  { id: 101, headline: 'Bluebird Diner', tagline: 'Dinner from 5', hue: 0.58, topic: 'product' },
  { id: 102, headline: 'Golden Market', tagline: 'Groceries from 2.50', hue: 0.1, topic: 'product' },
  { id: 103, headline: 'Meridian Motors', tagline: 'New cars from 240', hue: 0.98, topic: 'product' },
  { id: 104, headline: 'Voltix Electronics', tagline: 'Smarter every day', hue: 0.55, topic: 'product' },
  { id: 105, headline: 'Cozy Home Furniture', tagline: 'Sofas 30% off', hue: 0.07, topic: 'product' },
  { id: 106, headline: 'Harbor Bank', tagline: 'Loans for your dreams', hue: 0.63, topic: 'product' },
  { id: 107, headline: 'Chirp', tagline: 'Join Chirp today', hue: 0.53, topic: 'product' },
  { id: 108, headline: 'Channel 7', tagline: 'News you can trust', hue: 0.0, topic: 'product' },
  { id: 109, headline: 'Sunrise Café', tagline: 'Fresh, fast, friendly', hue: 0.06, topic: 'product' },
  { id: 110, headline: 'Loomworks Apparel', tagline: 'Fair prices, every day', hue: 0.86, topic: 'product' },
  { id: 111, headline: 'Oakline Builders', tagline: 'Your next home, built by us', hue: 0.11, topic: 'product' },
  { id: 112, headline: 'Atlas Freight', tagline: 'Anything, anywhere in the city', hue: 0.6, topic: 'product' },
  { id: 113, headline: 'Ironhold Steel', tagline: 'Steel by the crate', hue: 0.6, topic: 'product' },
  { id: 114, headline: 'Miller Farms', tagline: 'Crops by the crate', hue: 0.28, topic: 'product' },
  { id: 115, headline: 'Anvil Tools', tagline: 'Tools by the crate', hue: 0.02, topic: 'product' },
  { id: 116, headline: 'Pine Realty', tagline: 'Homes for everyone', hue: 0.4, topic: 'product' },
  { id: 117, headline: 'Summit Group', tagline: 'Built for this city', hue: 0.7, topic: 'product' },
  { id: 118, headline: 'Prime Grill', tagline: 'Taste the difference', hue: 0.03, topic: 'product' },
  { id: 119, headline: 'Seekr', tagline: 'Find anything', hue: 0.33, topic: 'product' },
  { id: 120, headline: 'Timberline Lumber', tagline: 'Planks by the crate', hue: 0.09, topic: 'product' },
  { id: 121, headline: 'Corner Shop', tagline: 'Everything you need', hue: 0.45, topic: 'product' },
  { id: 122, headline: 'Nimbus Systems', tagline: 'Computers from 40', hue: 0.75, topic: 'product' },
  { id: 901, headline: 'VOTE LOPEZ', tagline: 'A city that works · for Mayor', hue: 0.6, topic: 'campaign' },
  { id: 902, headline: 'VOTE BECKER', tagline: 'Lower taxes, more jobs · for Mayor', hue: 0.0, topic: 'campaign' },
  { id: 903, headline: 'Save the River', tagline: 'Join the cleanup on Sunday', hue: 0.38, topic: 'cause' },
  { id: 904, headline: 'Summer Concert', tagline: 'Saturday 8 pm at the plaza', hue: 0.78, topic: 'event' },
];
const sp = (id: number) => S.find((s) => s.id === id)!;
const OWNERS: Record<number, OwnerInfo> = {
  501: { name: 'Metro Outdoor', hue: 0.45, adco: true },
  502: { name: 'Skyline Media', hue: 0.8, adco: true },
  503: { name: 'Rosa Kessler', hue: 0.1, adco: false },
};

// ------------------------------------------------------------------- ads

const ads: AdPlacement[] = [];
let adId = 1;
function put(kind: AdPlacement['kind'], x: number, y: number, z: number, angle: number, w: number, h: number, spon: number, o: Partial<AdPlacement> = {}): void {
  const base = spon < 0 ? { sponsor: -1, headline: '', tagline: '', hue: 0, topic: 'product' as const } : (({ id, ...r }) => ({ sponsor: id, ...r }))(sp(spon));
  ads.push({ id: adId++, kind, x, y, z, angle, w, h, building: -1, created: 0, expires: 1e9, ...base, ...o });
}
const N = -Math.PI / 2, Sx = Math.PI / 2; // facing south (-y), north (+y)
/** A rotating screen: `list` = sponsors per slot (-1 = vacant slot). */
function screen(x: number, y: number, z: number, angle: number, w: number, h: number, list: number[], owner: number, building: number): void {
  list.forEach((s, slot) => put('screen', x, y, z, angle, w, h, s, { slot, slots: list.length, owner, building }));
}
// downtown screens: the towers' faces on the boulevard and on the cross street (a small Times Square)
screen(-44, T2.y0, 20, N, 14, 8, [104, 101, 108, 103, 107], 501, T2.id);
screen(-26, T2.y0, 38, N, 10, 6, [106, 119, 118], 501, T2.id);
screen(-90, T1.y0, 26, N, 6, 10, [110, 109, 902, 122], 502, T1.id);
screen(36, T3.y0, 17, N, 12, 7, [102, 105, 107, 104, 101, 904], 502, T3.id);
screen(24, T3.y0, 36, N, 8, 5, [119, -1, 108], 502, T3.id);
screen(92, T4.y0, 14, N, 10, 6, [103, 112, 117], 501, T4.id);
screen(-32, T6.y1, 22, Sx, 12, 7, [101, 122, 106, 109], 501, T6.id);
screen(32, T7.y1, 26, Sx, 14, 8, [107, 104, 118, 903, 105], 502, T7.id);
screen(-80, T5.y1, 14, Sx, 8, 5, [121, 102, 116], 501, T5.id);
screen(T2.x1, 58, 30, 0, 8, 12, [108, 103, 110], 501, T2.id);
screen(T3.x0, 56, 24, Math.PI, 8, 10, [101, 104, 119, 102], 502, T3.id);
screen(T7.x0, -58, 18, Math.PI, 7, 9, [118, 105, 106], 502, T7.id);
// advertising columns on the sidewalks (3-4 faces, some vacant)
const colSpots: [number, number, number, number[]][] = [
  [-75, 10.6, N, [101, 904, 109]], [-28, 10.6, N, [102, 105, -1, 118]], [28, 10.6, N, [107, 903, 122]], [84, 10.6, N, [110, 103, 121, 106]],
  [-55, -10.6, Sx, [104, 901, 119]], [-14, -22, Sx, [-1, 108, 101, 902]], [40, -10.6, Sx, [118, 102, 117]], [150, 10.6, N, [121, -1, 105]], [184, 10.6, N, [118, 109, 107]],
  [-40, 26, N, [109, 107, 102]], [44, 24, N, [104, 118, 903, 110]],
];
for (const [x, y, a, list] of colSpots) list.forEach((s, slot) => put('column', x, y, 1.9, a, 1.2, 1.9, s, { slot, slots: list.length, owner: 501 }));
// city-light panels on the sidewalks (double-sided), along the curb
for (const [x, y, s] of [[-100, 11.2, 104], [-12, 11.2, 108], [62, 11.2, 102], [-30, -11.2, 105], [100, -11.2, 107], [-70, 30, 109], [70, -28, 122]] as [number, number, number][]) put('poster', x, y, 1.4, 0, 1.19, 1.75, s, { owner: 501 });
// low-rise shops: posters on the side walls (framed and pasted), banners, rooftop billboards
shops.forEach((b, i) => {
  const north = b.y0 > 0;
  const facing = north ? N : Sx, front = north ? b.y0 : b.y1;
  const mid = (b.x0 + b.x1) / 2;
  if (i % 2 === 0) put('poster', b.x1 + 0.06, (b.y0 + b.y1) / 2 + (north ? -3 : 3), 2.3, 0, 1.2, 1.7, [118, 901, 102, 902, 121, 109][i % 6], { building: b.id });
  if (i % 3 === 1) put('banner', mid - 4, front + (north ? -0.05 : 0.05), Math.min(b.h - 1.6, 5.2), facing, 1.3, 3.6, [110, 105, 109, 116][i % 4], { building: b.id });
  if (i % 3 === 0) put('banner', mid + 2, front + (north ? -0.05 : 0.05), 3.6, facing, 6, 0.95, [904, 903][i % 2], { building: b.id });
  if (i % 2 === 1) put('billboard', mid, (b.y0 + b.y1) / 2 + (north ? -2 : 2), b.h + 2.6 + 1.6, facing, Math.min(9, b.x1 - b.x0 - 4), 3, i % 4 === 1 ? -1 : [103, 106, 122][i % 3], { building: b.id, owner: i % 4 === 3 ? 503 : 501 });
});
// free-standing billboards on lots along the arterial south of downtown (some vacant, all with an owner)
const boards: [number, number, number, number, number, number][] = [
  [-140, 9, 3, 103, 501, 0], [-80, 12, 4, -1, 501, 0.2], [-20, 9, 3, 106, 502, 0], [40, 12, 4, 107, 502, -0.25], [100, 9, 3, -1, 502, 0], [160, 12, 4, 902, 501, 0.1], [220, 9, 3, 101, 503, 0],
];
for (const [x, w, h, s, owner, tilt] of boards) put('billboard', x, -156, h > 3 ? 8 : 6.5, Sx + tilt, w, h, s, { owner });
// flyers on street lamps
const lamps: [number, number][] = [];
for (let x = -120; x <= 300; x += 30) for (const y of [-9.0, 9.0]) lamps.push([x, y]);
lamps.forEach(([x, y], k) => {
  if (k % 3 === 2) return;
  const a = y > 0 ? Math.PI / 2 : -Math.PI / 2; // facing the sidewalk
  for (let j = 0; j < 1 + (k % 2); j++) put('flyer', x + Math.cos(a) * 0.105, y + Math.sin(a) * 0.105, 1.45 + j * 0.4, a, 0.3, 0.42, [101, 904, 903, 121, 901, 109][(k + j) % 6]);
});

// stress: a whole downtown grid of extra screens, columns, posters, boards and flyers (~600 ads total)
if (STRESS) {
  const pool = S.map((s) => s.id);
  let k = 0;
  const pick = () => pool[(k++ * 7) % pool.length];
  for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 4; gy++) {
    const x = -300 + gx * 100, y = 180 + gy * 90;
    const b = tower(x - 20, x + 20, y - 15, y + 15, 40 + ((gx * 3 + gy * 5) % 7) * 12, (gx + gy) % 3);
    if ((gx + gy) % 1 === 0 && ads.filter((a) => a.kind === 'screen' && (a.slot ?? 0) === 0).length < 40) screen(x, y - 15, 14 + (gx % 3) * 6, N, 10, 6, [pick(), pick(), pick(), pick()], 501 + (gx % 2), b.id);
    for (let c = 0; c < 2; c++) { const cx = x - 30 + c * 60, cy = y - 22; [pick(), pick(), pick()].forEach((s, slot) => put('column', cx, cy, 1.9, N, 1.2, 1.9, s, { slot, slots: 3, owner: 501 })); }
    for (let p = 0; p < 4; p++) put('poster', x + 20.06, y - 9 + p * 5, 2.3, 0, 1.2, 1.7, pick(), { building: b.id });
    for (let f = 0; f < 4; f++) put('flyer', x - 15 + f * 10, y - 26.6, 1.5, N, 0.3, 0.42, pick());
    put('billboard', x, y + 40, 6.5, N, 9, 3, (gx + gy) % 4 === 0 ? -1 : pick(), { owner: 501 + (gy % 2) });
  }
}

// ------------------------------------------------------------- vehicles

interface Car { id: number; kind: VehicleVisual['kind']; lane: number; s0: number; v: number; hue: number; brand?: string; brandHue?: number; driver: boolean }
const LANES = [{ y: -4.6, dir: 1 }, { y: -1.8, dir: 1 }, { y: 1.8, dir: -1 }, { y: 4.6, dir: -1 }, { y: -138, dir: 1 }, { y: -134, dir: -1 }];
const X0 = -260, X1 = 330, LEN = X1 - X0;
const FLEET: { brand: string; hue: number; kind: 'van' | 'truck' }[] = [
  { brand: 'Golden Market', hue: 0.1, kind: 'van' }, { brand: 'Atlas Freight', hue: 0.6, kind: 'truck' }, { brand: 'Cozy Home Furniture', hue: 0.07, kind: 'truck' },
  { brand: 'Bluebird Diner', hue: 0.58, kind: 'van' }, { brand: 'Interstate Freight', hue: 0.02, kind: 'truck' }, { brand: 'MegaMart', hue: 0.95, kind: 'truck' },
  { brand: 'Parcelo', hue: 0.13, kind: 'van' }, { brand: 'Ironhold Steel', hue: 0.6, kind: 'truck' }, { brand: 'Miller Farms', hue: 0.28, kind: 'van' },
  { brand: 'Voltix Electronics', hue: 0.55, kind: 'van' }, { brand: 'Oakline Builders', hue: 0.11, kind: 'truck' }, { brand: 'Parcelo', hue: 0.13, kind: 'van' },
];
const cars: Car[] = [];
const nVeh = STRESS ? 400 : 64;
for (let i = 0; i < nVeh; i++) {
  const lane = i % LANES.length;
  const r = (k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const fleet = r(1) < 0.55 ? FLEET[Math.floor(r(2) * FLEET.length)] : null;
  cars.push({
    id: 1000 + i, kind: fleet ? fleet.kind : r(3) < 0.08 ? 'van' : 'car', lane, s0: r(4) * LEN, v: 8 + r(5) * 6, hue: r(6),
    brand: fleet?.brand, brandHue: fleet?.hue, driver: true,
  });
}
// parked delivery vans and a truck at the curb in front of the shops
const parked: VehicleVisual[] = [
  { id: 1, kind: 'van', x: 152, y: 7.0, z: 0.03, heading: Math.PI, hue: 0.1, speed: 0, hasDriver: false, brand: 'Golden Market', brandHue: 0.1 },
  { id: 2, kind: 'van', x: 160, y: 7.0, z: 0.03, heading: Math.PI, hue: 0.13, speed: 0, hasDriver: false, brand: 'Parcelo', brandHue: 0.13 },
  { id: 3, kind: 'truck', x: 171, y: 7.2, z: 0.03, heading: Math.PI, hue: 0.6, speed: 0, hasDriver: true, brand: 'Atlas Freight', brandHue: 0.6 },
  { id: 4, kind: 'van', x: 158, y: -7.0, z: 0.03, heading: 0, hue: 0.58, speed: 0, hasDriver: false, brand: 'Bluebird Diner', brandHue: 0.58 },
  { id: 5, kind: 'truck', x: 147, y: -7.2, z: 0.03, heading: 0, hue: 0.95, speed: 0, hasDriver: true, brand: 'MegaMart', brandHue: 0.95 },
  { id: 6, kind: 'van', x: 168, y: -7.0, z: 0.03, heading: 0, hue: 0.3, speed: 0, hasDriver: false },
  { id: 7, kind: 'car', x: 177, y: -7.0, z: 0.03, heading: 0, hue: 0.62, speed: 0, hasDriver: false },
];

// ------------------------------------------------------------------- scene

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
const scene = new Scene(engine);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = 0.00055;
const camera = new ArcRotateCamera('cam', -Math.PI / 2 + 0.5, 0.95, 300, new Vector3(0, 10, 0), scene);
camera.lowerRadiusLimit = 3;
camera.upperRadiusLimit = 1700;
camera.upperBetaLimit = 1.52;
camera.minZ = 0.25;
camera.maxZ = 7000;
camera.wheelDeltaPercentage = 0.015;
camera.panningSensibility = 40;
camera.attachControl(canvas, true);

const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
hemi.groundColor = Color3.FromHexString('#4a4a3a');
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
sun.autoUpdateExtends = false;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true;
shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
shadows.bias = 0.0008;
shadows.normalBias = 0.06;
// like the main renderer: the glow layer exists before the ads (screens register with it)
const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5 });
glow.intensity = 0;

const ground = MeshBuilder.CreateGround('ground', { width: 4000, height: 4000 }, scene);
ground.position.set(0, -0.02, 0);
const gm = new StandardMaterial('gm', scene);
gm.diffuseColor = Color3.FromHexString('#8a8f7c');
gm.specularColor = Color3.Black();
ground.material = gm;
ground.receiveShadows = true;
const flat = (hex: string, z = -2) => { const m = new StandardMaterial(hex, scene); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = Color3.Black(); m.zOffset = z; return m; };
const road = flat('#4b4e52'), walk = flat('#b7b2a8', -1), lot = flat('#a7a596', -1);
const strip = (x0: number, x1: number, y0: number, y1: number, m: StandardMaterial, h = 0.02) => {
  const g = MeshBuilder.CreateGround('strip', { width: x1 - x0, height: y1 - y0 }, scene);
  g.position.set((x0 + x1) / 2, h, (y0 + y1) / 2);
  g.material = m;
  g.receiveShadows = true;
};
strip(-400, 420, -8.6, 8.6, road);
strip(-400, 420, 8.6, 12.4, walk, 0.12); strip(-400, 420, -12.4, -8.6, walk, 0.12);
const plaza = flat('#cfc6b4', -1);
strip(-125, 125, 12.4, 40, plaza, 0.1); strip(-125, 125, -40, -12.4, plaza, 0.1);
for (const x of [130]) { strip(x - 7, x + 7, -400, 400, road, 0.025); }
strip(-7, 7, 40, 400, road, 0.025); strip(-7, 7, -400, -40, road, 0.025);
strip(-400, 420, -141, -131, road);
strip(-180, 260, -172, -146, lot, 0.03);
if (STRESS) for (let gy = 0; gy < 4; gy++) strip(-400, 420, 180 + gy * 90 - 30, 180 + gy * 90 - 20, road);
// lane markings
const mark = flat('#e8e4d6', -3);
for (let x = -390; x < 410; x += 12) { const d = MeshBuilder.CreateGround('dash', { width: 5, height: 0.18 }, scene); d.position.set(x, 0.03, 0); d.material = mark; }

// facade texture (window bays) for the boxes, one per tone; lit windows for the night
function facade(tone: number, lit: boolean): DynamicTexture {
  const t = new DynamicTexture(`facade${tone}${lit ? 'L' : ''}`, { width: 256, height: 256 }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  const wall = ['#c9ccd0', '#b9a993', '#8c9aa6', '#d8cdb9'][tone], glass = ['#4f6a80', '#5a6470', '#3e5566', '#5b5146'][tone];
  c.fillStyle = lit ? '#000' : wall;
  c.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    const on = ((r * 7 + k * 13 + tone * 3) % 5) < 2;
    c.fillStyle = lit ? (on ? '#ffd9a0' : '#000') : glass;
    c.fillRect(k * 64 + (tone === 3 ? 12 : 6), r * 64 + 12, tone === 3 ? 40 : 52, 44);
  }
  t.update(true);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}
const facadeMats: StandardMaterial[] = [];
for (let tone = 0; tone < 4; tone++) {
  const m = new StandardMaterial(`facade${tone}`, scene);
  m.diffuseTexture = facade(tone, false);
  m.emissiveTexture = facade(tone, true);
  m.emissiveTexture.level = 0;
  m.specularColor = new Color3(0.08, 0.08, 0.08);
  facadeMats.push(m);
}
for (const b of towers) {
  const w = b.x1 - b.x0, d = b.y1 - b.y0, bayW = b.tone === 3 ? 5 : 3.2, flH = b.tone === 3 ? 3.6 : 3.4;
  const fu = (len: number) => new Vector4(0, 0, len / (bayW * 4), b.h / (flH * 4));
  const m = MeshBuilder.CreateBox('tower', { width: w, height: b.h, depth: d, wrap: true, faceUV: [fu(w), fu(w), fu(d), fu(d), new Vector4(0, 0, 0.02, 0.02), new Vector4(0, 0, 0.02, 0.02)] }, scene);
  m.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.y0 + b.y1) / 2);
  m.material = facadeMats[b.tone];
  m.receiveShadows = true;
  shadows.addShadowCaster(m);
}
// street lamps (flyers are taped to them)
const pm = flat('#33363b', 0);
for (const [x, y] of lamps) {
  const pole = MeshBuilder.CreateCylinder('lampPole', { height: 7, diameterTop: 0.14, diameterBottom: 0.22, tessellation: 10 }, scene);
  pole.position.set(x, 3.5, y);
  pole.material = pm;
  const arm = MeshBuilder.CreateBox('lampArm', { width: 0.08, height: 0.08, depth: 1.8 }, scene);
  arm.position.set(x, 6.9, y - Math.sign(y) * 0.9);
  arm.material = pm;
  shadows.addShadowCaster(pole);
}

const adR = new AdRenderer(scene, shadows);
adR.ownerInfo = (id) => OWNERS[id] ?? null;
const vehR = new VehicleRenderer(scene, shadows);
glow.addExcludedMesh(vehR.coneMesh);

// ---------------------------------------------------------------- lighting

let night = 0;
function applyLight(): void {
  const day = 1 - night;
  sun.direction = new Vector3(-0.5, -Math.max(0.25, 0.3 + day * 0.7), -0.35).normalize();
  sun.intensity = 0.95 * Math.max(0, day * 1.2 - 0.2);
  sun.diffuse = Color3.Lerp(Color3.FromHexString('#ffb46b'), Color3.FromHexString('#fff6e8'), day);
  hemi.intensity = 0.2 + 0.42 * day;
  hemi.diffuse = Color3.Lerp(Color3.FromHexString('#5b6aa0'), Color3.FromHexString('#f2f4ff'), day);
  const sky = Color3.Lerp(Color3.FromHexString('#0b1222'), Color3.FromHexString('#a9cbe3'), day);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;
  glow.intensity = 0.75 * night;
  glow.isEnabled = glowOn && night > 0.05;
  for (const m of facadeMats) m.emissiveTexture!.level = night * 0.55;
  adR.setNight(night);
}
let glowOn = true;
applyLight();

// --------------------------------------------------------------------- ui

const $ = (id: string) => document.getElementById(id)!;
if (q.get('ui') === '0') $('ui').classList.add('hidden');
const nr = $('nr') as HTMLInputElement;
const setNight = (v: number) => { night = v; nr.value = String(v); $('nv').textContent = v.toFixed(2); $('night').classList.toggle('on', v > 0.5); applyLight(); };
$('night').onclick = () => setNight(night > 0.5 ? 0 : 1);
nr.oninput = () => setNight(Number(nr.value));
$('glow').onclick = () => { glowOn = !glowOn; $('glow').classList.toggle('on', glowOn); applyLight(); };
let traffic = true;
$('move').onclick = () => { traffic = !traffic; $('move').classList.toggle('on', traffic); };

const CAMS: Record<string, [number, number, number, number, number, number]> = {
  // target x, y, z (babylon), radius, alpha, beta
  orbit: [0, 12, 0, 320, -Math.PI / 2 + 0.35, 0.95],
  screens: [-10, 24, 40, 72, -Math.PI / 2 + 0.32, 1.28],
  plaza: [0, 22, 30, 125, -Math.PI / 2 + 0.12, 1.2],
  columns: [-28, 2.2, 10.6, 15, -Math.PI / 2 + 0.55, 1.33],
  boards: [40, 6, -156, 70, Math.PI / 2 - 0.35, 1.32],
  vans: [158, 1.6, 0, 24, -Math.PI / 2 + 0.75, 1.18],
  vacant: [-80, 7, -156, 40, Math.PI / 2 - 0.45, 1.42],
  street: [60, 10, 0, 150, Math.PI + 0.12, 1.42],
  far: [0, 0, -20, 900, -Math.PI / 2 + 0.4, 0.9],
};
function cam(name: string): void {
  const c = CAMS[name] ?? CAMS.orbit;
  camera.target = new Vector3(c[0], c[1], c[2]);
  camera.radius = c[3]; camera.alpha = c[4]; camera.beta = c[5];
}
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => { b.onclick = () => cam(b.dataset.cam!); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'n') $('night').click();
  const names = Object.keys(CAMS);
  const i = Number(e.key) - 1;
  if (i >= 0 && i < names.length) cam(names[i]);
});
scene.onPointerObservable.add((pi) => {
  if (pi.type !== PointerEventTypes.POINTERPICK || !pi.pickInfo) return;
  const id = adR.pickedId(pi.pickInfo);
  if (id >= 0) { const a = ads.find((x) => x.id === id)!; $('pick').textContent = `ad #${id} ${a.kind}: ${a.sponsor < 0 ? 'vacant' : a.headline}`; return; }
  const vid = vehR.pickedId(pi.pickInfo);
  $('pick').textContent = vid >= 0 ? `vehicle #${vid} ${cars.find((c) => c.id === vid)?.brand ?? ''}` : '';
});

// ------------------------------------------------------------------- loop

const visuals: VehicleVisual[] = [];
let simT = 0, lastReal = performance.now() / 1000;
let manualT: number | null = null; // clock override for screenshots (adbench.time)
function vehicles(now: number): VehicleVisual[] {
  visuals.length = 0;
  for (const c of cars) {
    const L = LANES[c.lane];
    const s = (((c.s0 + c.v * now) % LEN) + LEN) % LEN;
    const x = L.dir > 0 ? X0 + s : X1 - s;
    visuals.push({ id: c.id, kind: c.kind, x, y: L.y, z: 0.03, heading: L.dir > 0 ? 0 : Math.PI, hue: c.hue, speed: traffic ? c.v : 0, hasDriver: c.driver, brand: c.brand, brandHue: c.brandHue });
  }
  for (const p of parked) visuals.push(p);
  return visuals;
}

const instr = new SceneInstrumentation(scene);
instr.captureFrameTime = true;
let syncMs = 0;
scene.onBeforeRenderObservable.add(() => {
  const real = performance.now() / 1000;
  if (traffic) simT += Math.min(0.1, real - lastReal);
  lastReal = real;
  const now = manualT ?? frozen ?? real;
  const t0 = performance.now();
  adR.sync(ads, flatWorld, camera.position.x, camera.position.z, now);
  vehR.update(vehicles(frozen ?? simT), now, night);
  syncMs = syncMs * 0.9 + (performance.now() - t0) * 0.1;
  sun.shadowFrustumSize = Math.min(700, Math.max(40, camera.radius * 1.3));
  sun.position = camera.target.subtract(sun.direction.scale(600));
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 1400;
  scene.shadowsEnabled = camera.radius < 650 && sun.intensity > 0.05;
});
let frames = 0;
scene.onAfterRenderObservable.add(() => {
  if (++frames % 20) return;
  $('stats').textContent = [
    `ads ${ads.length}  vehicles ${visuals.length}`,
    `draw calls ${instr.drawCallsCounter.current}  active ${scene.getActiveMeshes().length}`,
    `frame ${instr.frameTimeCounter.lastSecAverage.toFixed(1)} ms  sync ${syncMs.toFixed(2)} ms  fps ${engine.getFps().toFixed(0)}`,
    `ads ${JSON.stringify(adR.stats())}`,
    `liveries ${vehR.liveryCount}`,
  ].join('\n');
});

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
cam(q.get('cam') ?? 'orbit');
setNight(num('night', 0));

// hooks for headless screenshots
(window as unknown as { adbench: unknown }).adbench = {
  cam, night: setNight, ads: () => ads,
  view: (x: number, y: number, z: number, radius: number, alpha: number, beta: number) => { camera.target = new Vector3(x, y, z); camera.radius = radius; camera.alpha = alpha; camera.beta = beta; },
  ready: () => { const s = adR.stats(); return frames > 10 && s.designs > 0 && s.loTextures >= s.designs; },
  stats: () => ({ ...adR.stats(), liveries: vehR.liveryCount }),
  perf: () => ({
    fps: Math.round(engine.getFps()), frameMs: +instr.frameTimeCounter.lastSecAverage.toFixed(2), syncMs: +syncMs.toFixed(2),
    drawCalls: instr.drawCallsCounter.current, active: scene.getActiveMeshes().length, meshes: scene.meshes.length,
  }),
  glow: (on: boolean) => { glowOn = on; applyLight(); },
  /** Set the ads' clock (seconds), null = back to real time. */
  time: (t: number | null) => { manualT = t; },
};
