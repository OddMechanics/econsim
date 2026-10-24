// Detailed people for the near-camera LOD: skinned, animated characters. Everyone
// is the same faceless, gender-neutral mannequin (from Quaternius' CC0
// "Universal Animation Library"); people differ by height, build, skin tone and
// clothes. Clips come from that library and Quaternius' CC0 "Ultimate Modular
// Men" pack (retargeted offline, see public/models/people/LICENSE.txt), plus
// procedural layers (arm/leg IK, head look, finger grip) for poses no clip covers.
//
// Each character is one skinned mesh (head + body + legs + feet merged per
// combination, flat-shaded, palette-textured so skin and clothes are tinted
// per person with one material) on its own flat skeleton. We pose the bones
// ourselves: clip sample -> local tweaks -> FK -> IK -> blend -> FK -> bone
// matrices, no Babylon animation objects. Props are thin instances.
//
// Model space (after mirroring the right-handed glTF data on load): x = the
// character's right, y = up, z = forward, feet at the origin, ~1.83 units tall.

import {
  Bone, BoundingInfo, Color3, FresnelParameters, Geometry, LoadAssetContainerAsync, Matrix, Mesh, MeshBuilder, RawTexture,
  Skeleton, StandardMaterial, Texture, Vector3, VertexBuffer,
} from '@babylonjs/core';
import type { PickingInfo, Scene, ShadowGenerator } from '@babylonjs/core';
import type { PersonVisual } from './people';
import { InstancedPart, box, cyl, hashf, mergeParts, paintMesh, sphere, writeMatrix } from './characterKit';
import { SKIN, clothInto, hexInto } from './palette';

/** Where people.glb / people-anim.bin are served from (public/models/people). */
const viteEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
export const CHARACTER_ASSET_BASE = { url: (viteEnv?.BASE_URL ?? '/') + 'models/people/' };

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const SEAT = 0.45; // chair height (m), same as the instanced figures
const DESK = 0.74; // desk height (m)
const BLEND = 0.3; // seconds to blend between poses

// ------------------------------------------------------------------ rig

/** Joint indices, filled from the animation file's joint list. */
const J = {
  Root: 0, Body: 0, Hips: 0, Abdomen: 0, Torso: 0, Chest: 0, Neck: 0, Head: 0,
  ShoL: 0, UaL: 0, LaL: 0, WrL: 0, ShoR: 0, UaR: 0, LaR: 0, WrR: 0,
  UlL: 0, LlL: 0, FootL: 0, UlR: 0, LlR: 0, FootR: 0, MidL: 0, MidR: 0,
};
const JNAME: Record<keyof typeof J, string> = {
  Root: 'Root', Body: 'Body', Hips: 'Hips', Abdomen: 'Abdomen', Torso: 'Torso', Chest: 'Chest', Neck: 'Neck', Head: 'Head',
  ShoL: 'Shoulder.L', UaL: 'UpperArm.L', LaL: 'LowerArm.L', WrL: 'Wrist.L', ShoR: 'Shoulder.R', UaR: 'UpperArm.R', LaR: 'LowerArm.R', WrR: 'Wrist.R',
  UlL: 'UpperLeg.L', LlL: 'LowerLeg.L', FootL: 'Foot.L', UlR: 'UpperLeg.R', LlR: 'LowerLeg.R', FootR: 'Foot.R', MidL: 'Middle1.L', MidR: 'Middle1.R',
};

interface Rig {
  n: number;
  parent: Int16Array;
  bind: Float32Array; // joint positions (model space), n*3
  off: Float32Array; // offset from the parent joint, n*3
  height: number; // model height (m)
  fingers: Int16Array; // finger joints
  fingerSide: Int8Array; // -1 left, +1 right
  thumb: Uint8Array; // 1 = thumb joint
  seg: Uint8Array; // 1 = metacarpal .. 4 = finger tip
}

interface Clip {
  name: string;
  frames: number;
  loop: boolean;
  speed: number; // m/s at rate 1 for locomotion
  data: Int16Array; // frames * (3 + bones*4)
}

interface RawPart {
  id: string;
  kind: string;
  pos: Float32Array;
  uv: Float32Array;
  mi: Float32Array;
  mw: Float32Array;
  idx: ArrayLike<number>;
}

interface Assets {
  rig: Rig;
  clips: Clip[];
  clipIx: Map<string, number>;
  animBones: Int16Array; // joint index per animated bone
  stride: number;
  parts: Map<string, RawPart>;
}

async function loadAssets(scene: Scene): Promise<Assets> {
  const base = CHARACTER_ASSET_BASE.url;
  await import('@babylonjs/loaders/glTF');
  const [container, animBuf] = await Promise.all([
    LoadAssetContainerAsync(base + 'people.glb', scene),
    fetch(base + 'people-anim.bin').then((r) => {
      if (!r.ok) throw new Error('people-anim.bin: HTTP ' + r.status);
      return r.arrayBuffer();
    }),
  ]);
  // ---- animation file
  const dv = new DataView(animBuf);
  if (dv.getUint32(0, true) !== 0x4d4e4150) throw new Error('people-anim.bin: bad magic');
  const jl = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(animBuf, 12, jl))) as {
    fps: number; bones: string[]; joints: string[]; parents: number[];
    clips: { name: string; frames: number; offset: number; loop: boolean; speed: number }[];
  };
  const data = new Int16Array(animBuf, 12 + jl);
  const joints = meta.joints;
  const jix = new Map(joints.map((n, i) => [n, i]));
  for (const k of Object.keys(J) as (keyof typeof J)[]) J[k] = jix.get(JNAME[k]) ?? 0;
  const stride = 3 + meta.bones.length * 4;
  const clips: Clip[] = meta.clips.map((c) => ({
    name: c.name, frames: c.frames, loop: c.loop, speed: c.speed,
    data: data.subarray(c.offset, c.offset + c.frames * stride),
  }));
  // mirror right-handed glTF animation data into our left-handed model space
  for (const c of clips) {
    const d = c.data;
    for (let f = 0; f < c.frames; f++) {
      const o = f * stride;
      d[o] = -d[o];
      for (let b = 0; b < meta.bones.length; b++) {
        const q = o + 3 + b * 4;
        d[q + 1] = -d[q + 1];
        d[q + 2] = -d[q + 2];
      }
    }
  }
  // ---- skeleton (flat joint nodes named after the joints)
  const n = joints.length;
  const parent = Int16Array.from(meta.parents);
  const nodePos = new Map<string, Vector3>();
  for (const t of container.transformNodes) nodePos.set(t.name, t.position);
  for (const sk of container.skeletons) for (const b of sk.bones) {
    const tn = b.getTransformNode();
    if (tn) nodePos.set(b.name, tn.position);
  }
  const fingers: number[] = [];
  const side: number[] = [];
  const thumb: number[] = [];
  const seg: number[] = [];
  joints.forEach((nm, i) => {
    const m = /^(Index|Middle|Ring|Pinky|Thumb)(\d)\.[LR]$/.exec(nm);
    if (m) {
      fingers.push(i);
      side.push(nm.endsWith('.L') ? -1 : 1);
      thumb.push(m[1] === 'Thumb' ? 1 : 0);
      seg.push(Number(m[2]));
    }
  });
  const bind = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = nodePos.get(joints[i]);
    if (!p) throw new Error('people.glb: missing joint ' + joints[i]);
    bind[i * 3] = -p.x; bind[i * 3 + 1] = p.y; bind[i * 3 + 2] = p.z;
  }
  const off = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const pi = parent[i];
    for (let k = 0; k < 3; k++) off[i * 3 + k] = pi < 0 ? bind[i * 3 + k] : bind[i * 3 + k] - bind[pi * 3 + k];
  }
  const rig: Rig = {
    n, parent, bind, off, height: 1.829,
    fingers: Int16Array.from(fingers), fingerSide: Int8Array.from(side), thumb: Uint8Array.from(thumb), seg: Uint8Array.from(seg),
  };
  // ---- parts
  const parts = new Map<string, RawPart>();
  for (const m of container.meshes) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
    const id = m.name.replace(/_primitive\d+$/, '');
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const uv = m.getVerticesData(VertexBuffer.UVKind);
    const mi = m.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const mw = m.getVerticesData(VertexBuffer.MatricesWeightsKind);
    const idx = m.getIndices();
    if (!pos || !uv || !mi || !mw || !idx) continue;
    parts.set(id, {
      id, kind: id.split('_')[0],
      pos: Float32Array.from(pos), uv: Float32Array.from(uv), mi: Float32Array.from(mi), mw: Float32Array.from(mw), idx: Uint32Array.from(idx),
    });
  }
  container.dispose();
  return { rig, clips, clipIx: new Map(clips.map((c, i) => [c.name, i])), animBones: Int16Array.from(meta.bones.map((b) => jix.get(b) ?? 0)), stride, parts };
}

/** Merge parts into one flat-shaded, compactly packed geometry (mirrored to left-handed). */
function buildGeometry(scene: Scene, parts: RawPart[], key: string): Geometry {
  let tris = 0;
  for (const p of parts) tris += p.idx.length / 3;
  const nv = tris * 3;
  const pos = new Float32Array(nv * 3);
  const nrm = new Int8Array(nv * 4);
  const uv = new Uint16Array(nv * 2);
  const mi = new Uint8Array(nv * 4);
  const mw = new Uint8Array(nv * 4);
  let v = 0;
  for (const p of parts) {
    const P = p.pos, I = p.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx = -nx / nl; ny /= nl; nz /= nl; // mirrored x
      // glTF fronts are counter-clockwise; mirrored into Babylon's left-handed
      // space they turn clockwise, which is Babylon's front: keep a, b, c
      for (const src of [I[t], I[t + 1], I[t + 2]]) {
        pos[v * 3] = -P[src * 3]; pos[v * 3 + 1] = P[src * 3 + 1]; pos[v * 3 + 2] = P[src * 3 + 2];
        nrm[v * 4] = Math.round(nx * 127); nrm[v * 4 + 1] = Math.round(ny * 127); nrm[v * 4 + 2] = Math.round(nz * 127);
        uv[v * 2] = Math.round(p.uv[src * 2] * 65535); uv[v * 2 + 1] = 32768;
        for (let k = 0; k < 4; k++) {
          mi[v * 4 + k] = p.mi[src * 4 + k];
          mw[v * 4 + k] = Math.round(p.mw[src * 4 + k] * 255);
        }
        v++;
      }
    }
  }
  const engine = scene.getEngine();
  const geo = new Geometry('person-geo-' + key, scene);
  geo.setVerticesBuffer(new VertexBuffer(engine, pos, VertexBuffer.PositionKind, { updatable: false, stride: 3, size: 3 }), nv);
  geo.setVerticesBuffer(new VertexBuffer(engine, nrm, VertexBuffer.NormalKind, { updatable: false, stride: 4, size: 3, type: VertexBuffer.BYTE, normalized: true, useBytes: true }));
  geo.setVerticesBuffer(new VertexBuffer(engine, uv, VertexBuffer.UVKind, { updatable: false, stride: 4, size: 2, type: VertexBuffer.UNSIGNED_SHORT, normalized: true, useBytes: true }));
  geo.setVerticesBuffer(new VertexBuffer(engine, mi, VertexBuffer.MatricesIndicesKind, { updatable: false, stride: 4, size: 4, type: VertexBuffer.UNSIGNED_BYTE, normalized: false, useBytes: true }));
  geo.setVerticesBuffer(new VertexBuffer(engine, mw, VertexBuffer.MatricesWeightsKind, { updatable: false, stride: 4, size: 4, type: VertexBuffer.UNSIGNED_BYTE, normalized: true, useBytes: true }));
  const idx = nv < 65536 ? new Uint16Array(nv) : new Uint32Array(nv);
  for (let i = 0; i < nv; i++) idx[i] = i;
  geo.setIndices(idx, nv);
  return geo;
}

// ------------------------------------------------------------------ math

// quaternions are (x, y, z, w) at an offset in a Float32Array / Float64Array
type Arr = Float32Array | Float64Array;

function qmul(o: Arr, oo: number, a: Arr, ao: number, b: Arr, bo: number): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  o[oo] = aw * bx + ax * bw + ay * bz - az * by;
  o[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** o = conj(a) * b */
function qmulInv(o: Arr, oo: number, a: Arr, ao: number, b: Arr, bo: number): void {
  const ax = -a[ao], ay = -a[ao + 1], az = -a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  o[oo] = aw * bx + ax * bw + ay * bz - az * by;
  o[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** out = rotate (x, y, z) by q */
function qrot(out: Arr, q: Arr, qo: number, x: number, y: number, z: number): void {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
}
function qaxis(o: Arr, oo: number, ax: number, ay: number, az: number, ang: number): void {
  const s = Math.sin(ang / 2);
  o[oo] = ax * s; o[oo + 1] = ay * s; o[oo + 2] = az * s; o[oo + 3] = Math.cos(ang / 2);
}
/** Normalized lerp from a toward b by u (shortest path), into o. */
function qnlerp(o: Arr, oo: number, a: Arr, ao: number, b: Arr, bo: number, u: number): void {
  const d = a[ao] * b[bo] + a[ao + 1] * b[bo + 1] + a[ao + 2] * b[bo + 2] + a[ao + 3] * b[bo + 3];
  const s = d < 0 ? -u : u, r = 1 - u;
  const x = a[ao] * r + b[bo] * s, y = a[ao + 1] * r + b[bo + 1] * s, z = a[ao + 2] * r + b[bo + 2] * s, w = a[ao + 3] * r + b[bo + 3] * s;
  const l = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
  o[oo] = x * l; o[oo + 1] = y * l; o[oo + 2] = z * l; o[oo + 3] = w * l;
}
/** Rotation matrix (columns X, Y, Z) to a quaternion. */
function qFromBasis(o: Arr, oo: number, xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, zx: number, zy: number, zz: number): void {
  const t = xx + yy + zz;
  let x: number, y: number, z: number, w: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (yz - zy) / s; y = (zx - xz) / s; z = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    w = (yz - zy) / s; x = 0.25 * s; y = (yx + xy) / s; z = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    w = (zx - xz) / s; x = (yx + xy) / s; y = 0.25 * s; z = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    w = (xy - yx) / s; x = (zx + xz) / s; y = (zy + yz) / s; z = 0.25 * s;
  }
  const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
  o[oo] = x * l; o[oo + 1] = y * l; o[oo + 2] = z * l; o[oo + 3] = w * l;
}
const F = new Float64Array(18); // frame scratch (two 3x3 bases)
/**
 * Rotation that takes the (orthonormalized) frame (a1, b1) onto (a2, b2):
 * a1 -> a2 exactly, b1 -> b2 as closely as possible.
 */
function qFrames(o: Arr, oo: number, a1: Arr, b1: Arr, a2: Arr, b2: Arr): void {
  basis(F, 0, a1, b1);
  basis(F, 9, a2, b2);
  // R = B2 * B1^T  (columns of B are the frame axes)
  const r = (i: number, j: number) => F[9 + i] * F[j] + F[12 + i] * F[3 + j] + F[15 + i] * F[6 + j];
  qFromBasis(o, oo, r(0, 0), r(1, 0), r(2, 0), r(0, 1), r(1, 1), r(2, 1), r(0, 2), r(1, 2), r(2, 2));
}
function basis(o: Float64Array, oo: number, a: Arr, b: Arr): void {
  let ax = a[0], ay = a[1], az = a[2];
  let l = 1 / (Math.hypot(ax, ay, az) || 1);
  ax *= l; ay *= l; az *= l;
  const d = b[0] * ax + b[1] * ay + b[2] * az;
  let bx = b[0] - d * ax, by = b[1] - d * ay, bz = b[2] - d * az;
  l = Math.hypot(bx, by, bz);
  if (l < 1e-6) { // b parallel to a: pick any perpendicular
    if (Math.abs(ax) < 0.9) { bx = 0; by = -az; bz = ay; } else { bx = az; by = 0; bz = -ax; }
    l = Math.hypot(bx, by, bz);
  }
  bx /= l; by /= l; bz /= l;
  o[oo] = ax; o[oo + 1] = ay; o[oo + 2] = az;
  o[oo + 3] = bx; o[oo + 4] = by; o[oo + 5] = bz;
  o[oo + 6] = ay * bz - az * by; o[oo + 7] = az * bx - ax * bz; o[oo + 8] = ax * by - ay * bx;
}

const v1 = new Float64Array(3), v2 = new Float64Array(3), v3 = new Float64Array(3), v4 = new Float64Array(3);
const tq = new Float64Array(8);

// ------------------------------------------------------------------ looks

/** Palette slots; keep in sync with ROLES in scripts/people-assets/build_people.py. */
export const ROLE = { skin: 0, top: 1, top2: 2, topDark: 3, accent: 4, pants: 5, shoe: 6, shoe2: 7, vest: 8, stripe: 9 };
const SHOES = ['#2b2522', '#1c1c1e', '#4a3426', '#e4e2dc', '#5a5f66', '#6b4a33'];
const SUITS = ['#262b33', '#1f2a3d', '#2f2f31', '#3b3530', '#4a4d52'];
const DARK_PANTS = ['#2b2f36', '#30343f', '#4b4237', '#3a3d42', '#555a60', '#5f5544'];
const WORKWEAR = ['#3c4a5c', '#5b4a33', '#4d5233', '#3f3f42', '#2f3f57'];
const HIVIS = ['#f26b1d', '#dfe83a', '#ff8a1f'];
const HARDHAT = ['#e9c12c', '#eeeeea', '#f07a22', '#e9c12c'];
const OFFICE_SHIRTS = ['#eef0f2', '#dce7f3', '#c9d8ea', '#f1e2e2', '#e2e4e8', '#e6dff0', '#f3efe4'];
const APRONS = ['#f2f2ee', '#e9e2d0', '#2e3440', '#5b4636', '#3b5f8a', '#7d2f2f'];
const SIGNS = ['#f4f1e6', '#f7e27a', '#f2b4a6', '#bfe0f4'];
export const POLICE_NAVY = '#1f2b47';

type Outfit = NonNullable<PersonVisual['outfit']>;
type Hat = 'chef' | 'police' | 'hard' | null;

export interface Look {
  key: string;
  /** inputs (to skip recomputation without building strings) */
  id: number; skin: number; shirt: number; pants: number; outfit: string;
  combo: string[]; // head, body, legs, feet part ids
  pal: Uint8Array; // 16 RGBA
  hat: Hat;
  hatColor: string; // hard hat color
  apron: number; // apron color index, -1 none
  belt: boolean; // duty belt (police)
  badge: boolean;
  formal: boolean; // formal walk
}

function pick<T>(h: number, opts: [T, number][]): T {
  let s = 0;
  for (const o of opts) s += o[1];
  let x = h * s;
  for (const o of opts) {
    x -= o[1];
    if (x < 0) return o[0];
  }
  return opts[opts.length - 1][0];
}

const tmp3 = [0, 0, 0];
/** Deterministic appearance (clothes, palette, accessories) of a person; shared by both LODs. */
export function characterLook(p: PersonVisual, out?: Look): Look {
  const L = p.looks, id = p.id;
  const outfit: Outfit = p.outfit ?? 'casual';
  if (out && out.id === id && out.skin === L.skin && out.shirt === L.shirt && out.pants === L.pants && out.outfit === outfit) return out;
  const key = `${id}|${outfit}|${L.skin}|${L.shirt}|${L.pants}`;
  const h = (k: number) => hashf(id * 97 + k * 131);
  let body: string, legs: string, feet: string;
  const r = h(2);
  type C = [string, string, string];
  const M = (o: [C, number][]) => pick(r, o);
  let hat: Hat = null, apron = -1, belt = false, badge = false;
  switch (outfit) {
    case 'office': [body, legs, feet] = ['long', 'pants', 'shoe']; break;
    case 'suit': [body, legs, feet] = ['suit', 'pants', 'shoe']; break;
    case 'work': [body, legs, feet] = M([[['overall', 'pants', 'shoe'], 0.45], [['tee', 'pants', 'shoe'], 0.55]]); break;
    case 'hivis': [body, legs, feet] = ['hivis', 'pants', 'shoe']; if (h(3) < 0.75) hat = 'hard'; break;
    case 'chef': [body, legs, feet] = ['long', 'pants', 'shoe']; hat = 'chef'; break;
    case 'apron': [body, legs, feet] = M([[['tee', 'pants', 'sneaker'], 0.6], [['long', 'pants', 'shoe'], 0.4]]); apron = Math.floor(h(4) * APRONS.length); break;
    case 'police': [body, legs, feet] = M([[['long', 'pants', 'shoe'], 0.7], [['hivis', 'pants', 'shoe'], 0.3]]); hat = 'police'; belt = true; badge = true; break;
    default: [body, legs, feet] = M([
      [['tee', 'pants', 'sneaker'], 0.32], [['hoodie', 'pants', 'sneaker'], 0.18], [['tee', 'shorts', 'sneaker'], 0.14],
      [['long', 'pants', 'shoe'], 0.24], [['hoodie', 'shorts', 'sneaker'], 0.06], [['tee', 'pants', 'shoe'], 0.06]]);
  }
  // ---- palette
  const pal = out?.pal ?? new Uint8Array(64);
  const set = (role: number, r: number, g: number, b: number) => {
    pal[role * 4] = clamp(Math.round(r * 255), 0, 255);
    pal[role * 4 + 1] = clamp(Math.round(g * 255), 0, 255);
    pal[role * 4 + 2] = clamp(Math.round(b * 255), 0, 255);
    pal[role * 4 + 3] = 255;
  };
  const hex = (role: number, c: string, k = 1) => { hexInto(c, tmp3); set(role, tmp3[0] * k, tmp3[1] * k, tmp3[2] * k); };
  const cloth = (role: number, hue: number, variant: number, k = 1) => { clothInto(hue, variant, tmp3); set(role, tmp3[0] * k, tmp3[1] * k, tmp3[2] * k); };
  hex(ROLE.skin, SKIN[clamp(Math.round(L.skin) | 0, 0, SKIN.length - 1)]);
  cloth(ROLE.top, L.shirt || 0, 0);
  hex(ROLE.top2, h(5) < 0.5 ? '#e9e7e1' : '#c9ccd1');
  cloth(ROLE.accent, (L.shirt || 0) + 0.45, 0);
  cloth(ROLE.pants, L.pants || 0, 1);
  hex(ROLE.shoe, SHOES[Math.floor(hashf(id * 5 + 11) * SHOES.length)]);
  hex(ROLE.shoe2, h(6) < 0.6 ? '#e6e4de' : '#3a3632');
  hex(ROLE.vest, HIVIS[Math.floor(h(7) * HIVIS.length)]);
  hex(ROLE.stripe, '#cfd2d4');
  switch (outfit) {
    case 'office':
      hex(ROLE.top, OFFICE_SHIRTS[Math.floor(h(11) * OFFICE_SHIRTS.length)]);
      hex(ROLE.pants, DARK_PANTS[Math.floor(h(9) * DARK_PANTS.length)]);
      hex(ROLE.shoe, h(10) < 0.6 ? '#1c1c1e' : '#4a3426');
      break;
    case 'suit': {
      const c = SUITS[Math.floor(h(9) * SUITS.length)];
      hex(ROLE.top, c); hex(ROLE.pants, c);
      hex(ROLE.top2, h(5) < 0.7 ? '#eef0f2' : '#d8e3f0');
      cloth(ROLE.accent, L.shirt || 0, 0);
      hex(ROLE.shoe, h(10) < 0.6 ? '#1c1c1e' : '#4a3426');
      break;
    }
    case 'work':
      hex(ROLE.pants, WORKWEAR[Math.floor(h(9) * WORKWEAR.length)]);
      hex(ROLE.shoe, h(10) < 0.5 ? '#4a3426' : '#2b2522');
      break;
    case 'hivis':
      hex(ROLE.pants, WORKWEAR[Math.floor(h(9) * WORKWEAR.length)]);
      hex(ROLE.shoe, '#2b2522');
      break;
    case 'chef':
      hex(ROLE.top, '#f3f3ef'); hex(ROLE.pants, h(9) < 0.5 ? '#3d3d3d' : '#50545a'); hex(ROLE.shoe, '#1c1c1e');
      break;
    case 'police':
      hex(ROLE.top, POLICE_NAVY); hex(ROLE.pants, '#1a2238'); hex(ROLE.shoe, '#121212');
      hex(ROLE.vest, '#d6ee3a');
      break;
    default:
      break;
  }
  set(ROLE.topDark, pal[ROLE.top * 4] / 255 * 0.78, pal[ROLE.top * 4 + 1] / 255 * 0.78, pal[ROLE.top * 4 + 2] / 255 * 0.78);
  const hatColor = HARDHAT[Math.floor(h(8) * HARDHAT.length)];
  const formal = outfit === 'suit' || outfit === 'office' || outfit === 'police';
  const look: Look = out ?? { key, id, skin: 0, shirt: 0, pants: 0, outfit, combo: [], pal, hat, hatColor, apron, belt, badge, formal };
  look.id = id; look.skin = L.skin; look.shirt = L.shirt; look.pants = L.pants; look.outfit = outfit;
  look.key = key; look.pal = pal; look.hat = hat; look.hatColor = hatColor; look.apron = apron; look.belt = belt; look.badge = badge; look.formal = formal;
  look.combo = ['head_bare', 'body_' + body, 'legs_' + legs, 'feet_' + feet];
  return look;
}

// ------------------------------------------------------------------ props

const enum P {
  Phone, Cup, Briefcase, Bag, Hammer, Wrench, Flyer, Sign, Mic, Crate, Tray, ChefHat, Cap, Belt, Badge, Apron, Pen, HardHat, Count,
}

function buildProps(scene: Scene, shadows: ShadowGenerator | null): InstancedPart[] {
  const parts: InstancedPart[] = [];
  const add = (mesh: Mesh, name: string, colored = false, castShadow = true) => {
    mesh.name = 'person-prop-' + name;
    parts.push(new InstancedPart(mesh, scene, shadows, { colored, shadows: castShadow }));
  };
  // all props are built in their own frame, origin at the grip point
  add(mergeParts([
    paintMesh(box(scene, 0.075, 0.15, 0.011, 0, 0, 0), 0.08, 0.08, 0.09),
    paintMesh(box(scene, 0.064, 0.13, 0.002, 0, 0.004, 0.0062), 0.35, 0.55, 0.75), // screen (+z)
  ], 'phone'), 'phone');
  add(mergeParts([
    paintMesh(cyl(scene, 0.085, 0.07, 10, -0.05, 0.06), 0.95, 0.94, 0.9),
    paintMesh(cyl(scene, 0.088, 0.088, 10, 0.06, 0.075), 0.25, 0.18, 0.14), // lid
  ], 'cup'), 'cup');
  add(mergeParts([ // hangs below the grip, flat side against the leg (width along z)
    paintMesh(box(scene, 0.1, 0.3, 0.42, 0, -0.2, 0), 0.24, 0.16, 0.11),
    paintMesh(box(scene, 0.03, 0.04, 0.12, 0, -0.03, 0), 0.12, 0.1, 0.09),
    paintMesh(box(scene, 0.03, 0.05, 0.03, 0, -0.06, -0.06), 0.12, 0.1, 0.09),
    paintMesh(box(scene, 0.03, 0.05, 0.03, 0, -0.06, 0.06), 0.12, 0.1, 0.09),
  ], 'briefcase'), 'briefcase');
  add(mergeParts([
    paintMesh(box(scene, 0.13, 0.34, 0.3, 0, -0.27, 0), 1, 1, 1),
    paintMesh(MeshBuilder.CreateTorus('h', { diameter: 0.1, thickness: 0.012, tessellation: 10 }, scene), 0.9, 0.9, 0.9),
  ].map((m, i) => { if (i === 1) { m.rotation.z = Math.PI / 2; m.position.y = -0.07; m.bakeCurrentTransformIntoVertices(); } return m; }), 'bag'), 'bag', true);
  add(mergeParts([ // handle along +y from the fist
    paintMesh(box(scene, 0.03, 0.34, 0.03, 0, 0.1, 0), 0.6, 0.42, 0.25),
    paintMesh(box(scene, 0.045, 0.05, 0.15, 0, 0.27, 0.02), 0.3, 0.31, 0.33),
  ], 'hammer'), 'hammer');
  add(mergeParts([
    paintMesh(box(scene, 0.025, 0.22, 0.012, 0, 0.06, 0), 0.62, 0.64, 0.66),
    paintMesh(cyl(scene, 0.06, 0.06, 8, 0.16, 0.19), 0.62, 0.64, 0.66),
  ], 'wrench'), 'wrench');
  add(paintMesh(box(scene, 0.15, 0.21, 0.004, 0, 0.06, 0), 0.97, 0.96, 0.92), 'flyer');
  add(mergeParts([ // pole along +y, board on top
    paintMesh(box(scene, 0.035, 1.25, 0.035, 0, 0.25, 0), 0.6, 0.45, 0.3),
    paintMesh(box(scene, 0.62, 0.42, 0.02, 0, 0.98, 0.02), 1, 1, 1),
    paintMesh(box(scene, 0.5, 0.06, 0.022, 0, 1.04, 0.022), 0.15, 0.15, 0.15),
    paintMesh(box(scene, 0.42, 0.05, 0.022, 0, 0.94, 0.022), 0.15, 0.15, 0.15),
  ], 'sign'), 'sign', true);
  add(mergeParts([
    paintMesh(cyl(scene, 0.03, 0.022, 8, -0.06, 0.1), 0.12, 0.12, 0.13),
    paintMesh(sphere(scene, 6, 0, 0.13, 0, 0.055, 0.055, 0.055), 0.45, 0.46, 0.48),
  ], 'mic'), 'mic');
  add(mergeParts([
    paintMesh(box(scene, 1, 1, 1, 0, 0, 0), 0.72, 0.55, 0.36),
    paintMesh(box(scene, 1.02, 0.06, 0.25, 0, 0.5, 0), 0.86, 0.78, 0.6),
  ], 'crate'), 'crate');
  add(mergeParts([
    paintMesh(cyl(scene, 0.42, 0.4, 14, 0, 0.018), 0.55, 0.56, 0.58),
    paintMesh(cyl(scene, 0.2, 0.17, 12, 0.018, 0.032), 0.96, 0.96, 0.94),
    paintMesh(cyl(scene, 0.11, 0.09, 8, 0.03, 0.06), 0.85, 0.45, 0.25),
    paintMesh(cyl(scene, 0.07, 0.06, 8, 0.018, 0.13, 0, 0.12, -0.06), 0.92, 0.92, 0.95),
  ], 'tray'), 'tray');
  // hats: origin at the head joint (the head is ~0.26 tall above it, ~0.18 wide, ~0.23 deep)
  add(mergeParts([
    paintMesh(cyl(scene, 0.215, 0.2, 12, 0.17, 0.3), 0.97, 0.97, 0.95),
    paintMesh(sphere(scene, 8, 0, 0.33, 0, 0.27, 0.12, 0.25), 0.97, 0.97, 0.95),
  ], 'chefhat'), 'chefhat');
  add(mergeParts([ // police cap
    paintMesh(cyl(scene, 0.2, 0.194, 14, 0.16, 0.23, 0, 0, 0.004), 0.12, 0.16, 0.27),
    paintMesh(cyl(scene, 0.226, 0.2, 14, 0.23, 0.258, 0, 0, 0.006), 0.12, 0.16, 0.27),
    paintMesh(box(scene, 0.15, 0.012, 0.075, 0, 0.165, 0.13), 0.05, 0.05, 0.06), // visor
    paintMesh(box(scene, 0.038, 0.034, 0.01, 0, 0.21, 0.103), 0.85, 0.7, 0.3), // badge
    paintMesh(cyl(scene, 0.204, 0.204, 14, 0.16, 0.178, 0, 0, 0.004), 0.06, 0.06, 0.07), // band
  ], 'cap'), 'cap');
  add(paintMesh(MeshBuilder.CreateTorus('belt', { diameter: 1, thickness: 0.12, tessellation: 18 }, scene), 0.06, 0.06, 0.06), 'belt');
  add(mergeParts([
    paintMesh(box(scene, 0.05, 0.06, 0.01, 0, 0, 0), 0.88, 0.72, 0.28),
  ], 'badge'), 'badge', false, false);
  add(box(scene, 1, 1, 0.012, 0, 0, 0), 'apron', true); // unit plate: one instance for the bib, one for the skirt
  add(paintMesh(box(scene, 0.01, 0.13, 0.01, 0, 0.03, 0), 0.1, 0.15, 0.5), 'pen', false, false);
  add(mergeParts([ // hard hat (tinted per person): dome and brim
    paintMesh(sphere(scene, 8, 0, 0.15, 0.005, 0.22, 0.26, 0.27, 0.5), 1, 1, 1),
    paintMesh(cyl(scene, 0.27, 0.27, 14, 0.145, 0.157, 0, 0, 0.015), 1, 1, 1),
  ], 'hardhat'), 'hardhat', true);
  return parts;
}

// ------------------------------------------------------------------ actor

/** Per-person animation/pose state. */
class Actor {
  id = -1;
  look: Look | null = null;
  readonly mesh: Mesh;
  readonly skel: Skeleton;
  readonly bones: Bone[] = [];
  readonly mat: StandardMaterial;
  readonly tex: RawTexture;
  combo = '';
  lookKey = '';
  used = false;
  // animation
  key = -1; // pose/clip state (a change starts a blend)
  clip = -1;
  t = 0;
  rate = 1;
  blend = 0; // remaining weight of the snapshot
  readonly L: Float32Array; // local rotations
  readonly bp = new Float32Array(3); // body joint position
  readonly Wq: Float32Array; // world rotations
  readonly Wp: Float32Array; // world positions
  readonly snapL: Float32Array;
  readonly snapP = new Float32Array(3);
  readonly mats: Float32Array;
  grip = new Float32Array(2); // finger curl per hand (smoothed)
  lie = 0; // 0 standing .. 1 lying (smoothed)
  hl = false;

  constructor(scene: Scene, rig: Rig, index: number) {
    const n = rig.n;
    this.L = new Float32Array(n * 4);
    this.Wq = new Float32Array(n * 4);
    this.Wp = new Float32Array(n * 3);
    this.snapL = new Float32Array(n * 4);
    this.mats = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) this.L[i * 4 + 3] = 1;
    this.skel = new Skeleton('person-skel-' + index, 'person-skel-' + index, scene);
    for (let i = 0; i < n; i++) {
      const m = Matrix.Translation(rig.bind[i * 3], rig.bind[i * 3 + 1], rig.bind[i * 3 + 2]);
      this.bones.push(new Bone('j' + i, this.skel, null, m, m.clone(), m.clone(), i));
    }
    this.mesh = new Mesh('person-detail-' + index, scene);
    this.mesh.skeleton = this.skel;
    this.mesh.numBoneInfluencers = 4;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = true;
    this.mesh.setEnabled(false);
    this.mat = new StandardMaterial('person-detail-mat-' + index, scene);
    this.mat.specularColor = new Color3(0.05, 0.05, 0.05);
    this.mat.backFaceCulling = true;
    const pal = new Uint8Array(64).fill(200);
    this.tex = RawTexture.CreateRGBATexture(pal, 16, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    this.tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.mat.diffuseTexture = this.tex;
    // the selection rim is always compiled in (black when not selected), so selecting
    // someone changes uniforms only and never waits for a new shader variant
    this.mat.emissiveFresnelParameters = new FresnelParameters({ bias: 0.05, power: 2.5, leftColor: Color3.Black(), rightColor: Color3.Black() });
    this.mesh.material = this.mat;
  }

  dispose(): void {
    this.mesh.dispose();
    this.skel.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

const POSE_IDS = new Map<string, number>(['stand', 'walk', 'sit', 'type', 'manual', 'carry', 'talk', 'eat', 'sleep', 'drive', 'cook',
  'serve', 'build', 'gather', 'watch', 'phone', 'speech', 'cheer', 'protest', 'vote'].map((p, i) => [p, i + 1]));
const HOLD_IDS = new Map<string, number>(['phone', 'cup', 'briefcase', 'bag', 'tool', 'flyer', 'sign', 'mic'].map((h, i) => [h, i + 1]));

/** Seated poses (from the pose itself; `seated` can add more). */
const SEATED_POSES = new Set(['sit', 'type', 'eat', 'drive', 'watch']);
const RIM = new Color3(0.75, 0.6, 0.28), RIM_BASE = new Color3(0.08, 0.06, 0.02), BLACK = Color3.Black();

interface PropUse { part: P; bone: number; side: number }

export class CharacterRenderer {
  ready = false;
  failed = false;
  /** Debug: play this clip for everyone (bench). */
  debugClip: string | null = null;
  /** Detailed characters drawn last frame. */
  count = 0;
  private assets: Assets | null = null;
  private actors = new Map<number, Actor>();
  private free: Actor[] = [];
  private nextIndex = 0;
  private geos = new Map<string, { geo: Geometry; users: number; last: number }>();
  private props: InstancedPart[];
  private proxy: InstancedPart;
  private min = new Vector3();
  private max = new Vector3();
  private frame = 0;
  private bbox: BoundingInfo;
  private uses: PropUse[] = [];

  constructor(private scene: Scene, private shadows: ShadowGenerator | null) {
    this.props = buildProps(scene, shadows);
    const pm = MeshBuilder.CreateBox('person-detail-pick', { size: 1 }, scene);
    this.proxy = new InstancedPart(pm, scene, null, { pickable: true, receive: false });
    pm.layerMask = 0; // never rendered, only picked
    this.bbox = new BoundingInfo(new Vector3(-0.95, -0.1, -1.1), new Vector3(0.95, 2.45, 1.15));
    loadAssets(scene).then((a) => {
      this.assets = a;
      this.ready = true;
    }).catch((e) => {
      this.failed = true;
      console.warn('[people] detailed characters unavailable:', e);
    });
  }

  begin(): void {
    this.frame++;
    for (const a of this.actors.values()) a.used = false;
    for (const p of this.props) p.begin();
    this.proxy.begin();
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    this.count = 0;
  }

  /**
   * Draw one person in detail. `fade` 0..1 (opacity), `speed` m/s along the
   * ground, `dt` animation seconds since the last frame, `blendDt` real seconds
   * (pose blends), `time` animation clock. Returns false while the character
   * cannot be shown yet (shaders still compiling): keep drawing the stand-in then.
   */
  draw(p: PersonVisual, fade: number, speed: number, dt: number, blendDt: number, time: number): boolean {
    const A = this.assets;
    if (!A) return false;
    let a = this.actors.get(p.id);
    const look = characterLook(p, a?.look ?? undefined);
    if (!a) {
      a = this.free.pop() ?? new Actor(this.scene, A.rig, this.nextIndex++);
      a.id = p.id;
      a.key = -1;
      a.combo = '';
      a.lookKey = '';
      a.blend = 0;
      a.look = null;
      a.lie = 0;
      a.grip[0] = a.grip[1] = 0.3;
      this.actors.set(p.id, a);
      a.mesh.setEnabled(true);
      if (this.shadows) this.shadows.addShadowCaster(a.mesh, false);
    }
    a.used = true;
    if (a.look !== look || a.lookKey !== look.key) {
      a.look = look;
      a.lookKey = look.key;
      this.setCombo(a, look);
      a.tex.update(look.pal);
    }
    if (a.hl !== p.highlight) {
      a.hl = p.highlight;
      a.mat.emissiveFresnelParameters!.leftColor.copyFrom(a.hl ? RIM : BLACK);
      a.mat.emissiveColor.copyFrom(a.hl ? RIM_BASE : BLACK);
    }
    this.animate(a, p, speed, dt, blendDt, time);
    // mesh transform (true size; build widens x/z)
    const s = clamp(p.looks.height || 1.75, 1.3, 2.2) / A.rig.height;
    const bw = 1 + (clamp(p.looks.build || 1, 0.7, 1.35) - 1) * 0.6;
    const m = a.mesh;
    m.position.set(p.x, p.z, p.y);
    m.rotation.y = Math.PI / 2 - p.heading;
    m.scaling.set(s * bw, s, s * bw);
    m.visibility = fade >= 0.999 ? 1 : Math.max(0.001, fade);
    // bounds of all detailed people (for the prop / proxy instances)
    const mn = this.min, mx = this.max;
    if (p.x < mn.x) mn.x = p.x; if (p.x > mx.x) mx.x = p.x;
    if (p.z < mn.y) mn.y = p.z; if (p.z > mx.y) mx.y = p.z;
    if (p.y < mn.z) mn.z = p.y; if (p.y > mx.z) mx.z = p.y;
    this.emitProps(a, p, s, bw);
    this.count++;
    return m.isReady(true);
  }

  end(): void {
    for (const a of this.actors.values()) if (!a.used) this.release(a);
    const mn = this.min, mx = this.max;
    if (mn.x <= mx.x) {
      mn.x -= 3; mn.y -= 1; mn.z -= 3;
      mx.x += 3; mx.y += 3.5; mx.z += 3;
    }
    for (const p of this.props) p.finish(mn, mx);
    this.proxy.finish(mn, mx);
    // drop cached geometries nobody used for a while
    if (this.frame % 120 === 0 && this.geos.size > 40) {
      for (const [k, g] of this.geos) if (g.users === 0 && this.frame - g.last > 600) { g.geo.dispose(); this.geos.delete(k); }
    }
  }

  pickedId(pick: PickingInfo): number {
    return this.proxy.idAt(pick);
  }

  get meshes(): Mesh[] {
    return [...[...this.actors.values()].map((a) => a.mesh), ...this.props.map((p) => p.mesh), this.proxy.mesh];
  }

  dispose(): void {
    for (const a of this.actors.values()) a.dispose();
    for (const a of this.free) a.dispose();
    this.actors.clear();
    this.free = [];
    for (const g of this.geos.values()) g.geo.dispose();
    this.geos.clear();
    for (const p of this.props) p.dispose();
    this.proxy.dispose();
  }

  // ------------------------------------------------------------ internals

  private release(a: Actor): void {
    this.actors.delete(a.id);
    a.mesh.setEnabled(false);
    if (this.shadows) this.shadows.removeShadowCaster(a.mesh, false);
    const g = this.geos.get(a.combo);
    if (g) { g.users--; g.last = this.frame; }
    a.combo = '';
    a.id = -1;
    this.free.push(a);
  }

  private setCombo(a: Actor, look: Look): void {
    const key = look.combo.join('|');
    if (key === a.combo) return;
    const old = this.geos.get(a.combo);
    if (old) { old.users--; old.last = this.frame; }
    let g = this.geos.get(key);
    if (!g) {
      const parts = look.combo.map((id) => this.assets!.parts.get(id)).filter((x): x is RawPart => !!x);
      g = { geo: buildGeometry(this.scene, parts, key), users: 0, last: this.frame };
      this.geos.set(key, g);
    }
    g.users++;
    g.geo.applyToMesh(a.mesh);
    // generous local bounds that cover every pose (the bind-pose box is a T-pose);
    // each mesh needs its own copy, and must keep syncing it with its world matrix
    // (doNotSyncBoundingInfo would leave walkers culled at the spot they were set up)
    a.mesh.setBoundingInfo(new BoundingInfo(this.bbox.minimum, this.bbox.maximum));
    a.combo = key;
  }

  // ------------------------------------------------------------ animation

  private animate(a: Actor, p: PersonVisual, speed: number, dt: number, blendDt: number, time: number): void {
    const A = this.assets!;
    const rig = A.rig;
    const look = a.look!;
    const pose = p.pose;
    const seated = SEATED_POSES.has(pose) || (!!p.seated && pose !== 'sleep');
    const moving = p.moving && !seated && pose !== 'sleep' && pose !== 'build' && pose !== 'gather';
    const holding = p.holding ?? null;
    const talking = !!p.talking;
    const id = p.id;
    const hv = hashf(id * 7 + 3);
    const ph = hashf(id) * TAU;
    const s = clamp(p.looks.height || 1.75, 1.3, 2.2) / rig.height;

    // ---- choose the base clip
    let clip: string;
    let rate = 1;
    if (moving) {
      const v = speed / s; // model units / s
      if (v > 2.7 && v < 4.5) { // hurrying; beyond that it is time-lapse, so keep walking (fast)
        clip = 'jog';
        rate = clamp(v / A.clips[A.clipIx.get('jog')!].speed, 0.75, 1.3);
      } else {
        clip = look.formal ? 'walk_formal' : hv < 0.5 ? 'walk_u' : 'walk_m';
        const cs = A.clips[A.clipIx.get(clip)!].speed;
        rate = v > 0.05 ? clamp(v / cs, 0.55, 2.2) : 1;
      }
    } else if (pose === 'sleep') clip = 'idle_n';
    else if (pose === 'drive') clip = 'drive';
    else if (seated) clip = (talking || pose === 'sit' && hv < 0.15) && pose !== 'type' && pose !== 'watch' ? 'sit_talk' : 'sit';
    else if (pose === 'build' || pose === 'gather') clip = 'kneel';
    else if (pose === 'talk' || pose === 'speech' || talking) clip = 'talk';
    else if (pose === 'cheer' && hv < 0.4) clip = 'dance';
    else if (pose === 'cheer' || pose === 'protest' || pose === 'carry' || pose === 'serve' || pose === 'cook' || pose === 'manual' || pose === 'vote') clip = 'idle_n';
    else clip = hv < 0.4 ? 'idle_u' : hv < 0.8 ? 'idle_m' : 'idle_n';
    if (this.debugClip && A.clipIx.has(this.debugClip)) clip = this.debugClip;
    const ci = A.clipIx.get(clip) ?? 0;
    const key = ((POSE_IDS.get(pose) ?? 0) * 16 + (HOLD_IDS.get(holding ?? '') ?? 0)) * 4096 + ci * 4 + (moving ? 2 : 0) + (seated ? 1 : 0);
    if (key !== a.key) {
      if (a.key >= 0) { // blend from what is on screen now
        a.snapL.set(a.L);
        a.snapP.set(a.bp);
        a.blend = 1;
      }
      const wasLoco = a.clip >= 0 && A.clips[a.clip].speed > 0;
      a.key = key;
      if (!(wasLoco && moving)) a.t = hashf(id * 13 + ci) * 10; // desync, keep the gait phase when walking on
      a.clip = ci;
    }
    a.rate = rate;
    a.t += dt * rate;
    this.sample(a, A, rig, A.clips[ci], a.t);

    // ---- local tweaks
    const L = a.L;
    const lieTarget = pose === 'sleep' ? 1 : 0;
    a.lie += clamp(lieTarget - a.lie, -blendDt * 3, blendDt * 3);
    let gripL = 0.35, gripR = 0.35;
    let lookYaw = 0, lookPitch = 0;
    // idle glances
    if (!moving && pose !== 'sleep' && pose !== 'type' && pose !== 'vote' && pose !== 'phone' && pose !== 'watch') {
      lookYaw = 0.35 * Math.sin(time * 0.23 + ph) * Math.max(0, Math.sin(time * 0.13 + ph * 2));
    }
    if (seated) { // pelvis on the seat (the clips sit 0.25 behind their feet)
      a.bp[1] = SEAT / s + 0.085;
      a.bp[2] += 0.22;
    }

    // ---- FK, then IK / pose layers
    this.fk(a, rig);
    this.armL = this.armR = false; // arm handled by IK
    const uses = this.uses;
    uses.length = 0;
    const tt = time + ph;
    const chestY = a.Wp[J.Chest * 3 + 1];
    const shY = a.Wp[J.UaR * 3 + 1];
    // hand (palm) orientation helpers set after IK below
    let palmL = 0, palmR = 0; // 0 = keep, 1 = palm up (tray), 2 = palm in, 3 = palm toward face
    switch (pose) {
      case 'carry':
        this.hand(a, rig, -1, -0.2, shY - 0.4, 0.32, -0.6, -0.4, -0.5);
        this.hand(a, rig, 1, 0.2, shY - 0.4, 0.32, 0.6, -0.4, -0.5);
        palmL = palmR = 2; gripL = gripR = 0.7;
        uses.push({ part: P.Crate, bone: -1, side: 0 });
        break;
      case 'serve':
        this.hand(a, rig, 1, 0.26, shY - 0.2, 0.27, 0.8, -0.6, -0.3);
        palmR = 1; gripR = 0.15;
        uses.push({ part: P.Tray, bone: J.WrR, side: 1 });
        break;
      case 'cook': {
        const w = tt * 3.2;
        this.hand(a, rig, 1, 0.12 + 0.05 * Math.cos(w), 0.98 / s + 0.03, 0.42 + 0.04 * Math.sin(w), 0.7, -0.7, -0.3);
        this.hand(a, rig, -1, -0.2, 0.97 / s + 0.02, 0.36, -0.7, -0.6, -0.3);
        gripL = gripR = 0.8; lookPitch = 0.45;
        uses.push({ part: P.Wrench, bone: J.WrR, side: 1 });
        break;
      }
      case 'manual': {
        const cyc = (tt * 1.25) % 1;
        const u = cyc < 0.7 ? smooth(cyc / 0.7) : 1 - Math.pow((cyc - 0.7) / 0.3, 0.7);
        this.hand(a, rig, -1, -0.08, 0.98 / s, 0.44, -0.6, -0.6, -0.3);
        this.hand(a, rig, 1, 0.14, 1.0 / s + 0.38 * u, 0.42 - 0.08 * u, 0.7, -0.5, -0.5);
        gripL = 0.6; gripR = 1; lookPitch = 0.5;
        uses.push({ part: P.Hammer, bone: J.WrR, side: 1 });
        break;
      }
      case 'build':
        gripR = 1;
        uses.push({ part: P.Hammer, bone: J.WrR, side: 1 });
        break;
      case 'type': {
        const desk = DESK / s;
        for (let side = -1; side <= 1; side += 2) {
          const tap = 0.012 * Math.max(0, Math.sin(time * 15 + ph + side * 2.1)) * (0.5 + 0.5 * Math.sin(time * 0.9 + side));
          this.hand(a, rig, side, side * 0.13 + 0.01 * Math.sin(time * 1.7 + side * 2 + ph), desk + 0.05 + tap, 0.45, side * 0.6, -1, -0.4);
        }
        palmL = palmR = 4; gripL = gripR = 0.25; lookPitch = 0.12; lookYaw = 0.06 * Math.sin(time * 0.4 + ph);
        break;
      }
      case 'eat': {
        const desk = DESK / s;
        this.hand(a, rig, -1, -0.17, desk + 0.05, 0.38, -0.5, -1, -0.3);
        const cyc = (time / 4.5 + ph / TAU) % 1;
        const up = cyc < 0.15 ? smooth(cyc / 0.15) : cyc < 0.42 ? 1 : cyc < 0.6 ? 1 - smooth((cyc - 0.42) / 0.18) : 0;
        const head = a.Wp[J.Head * 3 + 1];
        this.hand(a, rig, 1, 0.17 + (0.04 - 0.17) * up, desk + 0.05 + (head + 0.02 - desk - 0.05) * up, 0.38 + (0.17 - 0.38) * up, 0.7, -1, -0.1);
        gripR = 0.8; lookPitch = 0.25 - 0.2 * up;
        uses.push({ part: P.Cup, bone: J.WrR, side: 1 });
        break;
      }
      case 'watch':
        lookPitch = -0.05;
        break;
      case 'sleep':
        lookYaw = 0.3 * (hv - 0.5);
        break;
      case 'speech': {
        const cyc = (tt * 0.45) % 1;
        const up = Math.max(0, Math.sin(cyc * TAU));
        if (holding === 'mic') {
          const head = a.Wp[J.Head * 3 + 1];
          this.hand(a, rig, 1, 0.06, head - 0.02, 0.17, 0.6, -0.8, -0.2);
          uses.push({ part: P.Mic, bone: J.WrR, side: 1 });
          gripR = 0.9;
        } else {
          this.hand(a, rig, 1, 0.3 + 0.05 * Math.sin(tt * 2.3), shY - 0.15 + 0.38 * up, 0.33 + 0.06 * up, 0.8, -0.6, -0.4);
          palmR = 2; gripR = 0.2;
        }
        this.hand(a, rig, -1, -0.28 - 0.04 * Math.sin(tt * 1.7), shY - 0.18 + 0.25 * Math.max(0, Math.sin(cyc * TAU + 2.2)), 0.3, -0.8, -0.6, -0.4);
        palmL = 2; gripL = 0.2;
        lookYaw = 0.35 * Math.sin(tt * 0.5);
        break;
      }
      case 'cheer': {
        if (clip === 'dance') { lookPitch = -0.1; break; }
        const cyc = (tt * 0.2) % 1;
        const arms = cyc > 0.72 && cyc < 0.92;
        if (arms) {
          const k = Math.sin((cyc - 0.72) / 0.2 * Math.PI);
          this.hand(a, rig, -1, -0.25, shY + 0.25 + 0.25 * k, 0.12, -0.8, 0.2, -0.6);
          this.hand(a, rig, 1, 0.25, shY + 0.25 + 0.25 * k, 0.12, 0.8, 0.2, -0.6);
          palmL = palmR = 2; gripL = gripR = 0.9;
        } else {
          const c = Math.abs(Math.sin(tt * 3.4 * Math.PI / 2));
          const d = 0.025 + 0.09 * c;
          this.hand(a, rig, -1, -d, chestY - 0.02, 0.33, -0.8, -0.5, -0.4);
          this.hand(a, rig, 1, d, chestY - 0.02, 0.33, 0.8, -0.5, -0.4);
          palmL = palmR = 2; gripL = gripR = 0.15;
        }
        lookPitch = -0.08;
        break;
      }
      case 'protest':
        break; // sign below
      case 'vote': {
        this.hand(a, rig, 1, 0.1 + 0.02 * Math.sin(time * 9 + ph), 1.0 / s, 0.4 + 0.015 * Math.cos(time * 7), 0.7, -0.6, -0.4);
        this.hand(a, rig, -1, -0.12, 1.0 / s, 0.38, -0.7, -0.6, -0.4);
        palmL = 4; gripR = 0.9; lookPitch = 0.55;
        uses.push({ part: P.Pen, bone: J.WrR, side: 1 }, { part: P.Flyer, bone: -2, side: -1 });
        break;
      }
      default:
        break;
    }
    // things in hand for any pose that left the arm free
    const hold = pose === 'phone' ? 'phone' : pose === 'protest' ? 'sign' : holding;
    if (hold && !this.armR) {
      switch (hold) {
        case 'phone':
          if (talking && !seated) { // a call: phone at the ear
            const hy = a.Wp[J.Head * 3 + 1];
            this.hand(a, rig, 1, 0.13, hy + 0.04, 0.0, 0.7, -0.6, -0.3);
            palmR = 2;
          } else {
            const y = seated ? chestY - 0.08 : chestY - 0.1;
            this.hand(a, rig, 1, 0.06, y, 0.3, 0.8, -0.6, -0.3);
            if (!this.armL && !moving) this.hand(a, rig, -1, -0.03, y - 0.02, 0.28, -0.8, -0.6, -0.3);
            palmR = 3; lookPitch = 0.55; lookYaw = 0;
          }
          gripR = 0.75;
          uses.push({ part: P.Phone, bone: J.WrR, side: 1 });
          break;
        case 'cup': {
          const cyc = (time / 6 + ph / TAU) % 1;
          const up = cyc < 0.12 ? smooth(cyc / 0.12) : cyc < 0.3 ? 1 : cyc < 0.42 ? 1 - smooth((cyc - 0.3) / 0.12) : 0;
          const hy = a.Wp[J.Head * 3 + 1];
          this.hand(a, rig, 1, 0.13 - 0.08 * up, chestY - 0.14 + (hy - chestY + 0.16) * up, 0.25 - 0.1 * up, 0.8, -0.8, -0.2);
          gripR = 0.8; palmR = 2;
          uses.push({ part: P.Cup, bone: J.WrR, side: 1 });
          break;
        }
        case 'briefcase':
        case 'bag':
        case 'tool':
          // the arm hangs (the walk clip still swings it a little)
          if (!moving && !seated) this.hand(a, rig, 1, 0.21, shY - 0.47, 0.03, 0.3, 0, -1);
          gripR = 1;
          uses.push({ part: hold === 'bag' ? P.Bag : hold === 'tool' ? P.Wrench : P.Briefcase, bone: J.WrR, side: 1 });
          break;
        case 'flyer':
          this.hand(a, rig, 1, 0.16, chestY - 0.12, 0.32, 0.8, -0.6, -0.3);
          palmR = 2; gripR = 0.6;
          uses.push({ part: P.Flyer, bone: J.WrR, side: 1 });
          break;
        case 'mic': {
          const hy = a.Wp[J.Head * 3 + 1];
          this.hand(a, rig, 1, 0.06, hy - 0.02, 0.17, 0.6, -0.8, -0.2);
          gripR = 0.9;
          uses.push({ part: P.Mic, bone: J.WrR, side: 1 });
          break;
        }
        case 'sign': {
          const pump = 0.06 * Math.sin(tt * 2.6);
          this.hand(a, rig, 1, 0.06, shY + 0.16 + pump, 0.2, 0.8, -0.3, -0.5);
          this.hand(a, rig, -1, 0.0, shY - 0.14 + pump, 0.22, -0.8, -0.5, -0.4);
          palmL = palmR = 2; gripL = gripR = 1;
          uses.push({ part: P.Sign, bone: J.WrR, side: 1 });
          lookPitch = -0.1;
          break;
        }
      }
    }
    if (moving && (pose === 'talk' || talking) && !this.armR && !p.carrying) {
      const side = hv < 0.5 ? 1 : -1;
      const g = Math.sin(tt * 2.2) * 0.5 + 0.5;
      this.hand(a, rig, side, side * (0.2 + 0.05 * g), chestY - 0.12 + 0.08 * Math.sin(tt * 3.1), 0.28 + 0.05 * g, side * 0.8, -0.6, -0.3);
      if (side > 0) palmR = 1; else palmL = 1;
      lookYaw = side * 0.35 * (0.6 + 0.4 * Math.sin(tt * 0.7));
    }
    if (p.carrying && pose !== 'carry' && !this.armL && !this.armR && !seated && pose !== 'sleep') {
      this.hand(a, rig, -1, -0.2, shY - 0.4, 0.32, -0.6, -0.4, -0.5);
      this.hand(a, rig, 1, 0.2, shY - 0.4, 0.32, 0.6, -0.4, -0.5);
      palmL = palmR = 2; gripL = gripR = 0.7;
      uses.push({ part: P.Crate, bone: -1, side: 0 });
    }
    if (look.hat) uses.push({ part: look.hat === 'chef' ? P.ChefHat : look.hat === 'police' ? P.Cap : P.HardHat, bone: J.Head, side: 0 });
    if (look.belt) uses.push({ part: P.Belt, bone: J.Hips, side: 0 });
    if (look.badge) uses.push({ part: P.Badge, bone: J.Chest, side: 0 });
    if (look.apron >= 0) uses.push({ part: P.Apron, bone: J.Hips, side: seated ? 1 : 0 });
    // hand orientations
    if (palmR) this.palm(a, rig, 1, palmR);
    if (palmL) this.palm(a, rig, -1, palmL);
    // spine lean for work at a surface
    if (pose === 'cook' || pose === 'manual' || pose === 'vote' || pose === 'type') {
      this.addLocal(a, J.Abdomen, 1, 0, 0, pose === 'type' ? 0.12 : 0.1);
      this.addLocal(a, J.Torso, 1, 0, 0, 0.06);
    }
    // head look (split over neck and head)
    if (lookYaw || lookPitch) {
      this.addLocal(a, J.Neck, 0, 1, 0, lookYaw * 0.4);
      this.addLocal(a, J.Head, 0, 1, 0, lookYaw * 0.6);
      this.addLocal(a, J.Neck, 1, 0, 0, lookPitch * 0.45);
      this.addLocal(a, J.Head, 1, 0, 0, lookPitch * 0.55);
    }
    // fingers
    a.grip[0] += clamp(gripL - a.grip[0], -blendDt * 6, blendDt * 6);
    a.grip[1] += clamp(gripR - a.grip[1], -blendDt * 6, blendDt * 6);
    this.fingers(a, rig);
    // blend from the snapshot after a pose change
    if (a.blend > 0) {
      const w = smooth(a.blend);
      const n = rig.n;
      for (let i = 0; i < n; i++) qnlerp(L, i * 4, L, i * 4, a.snapL, i * 4, w);
      for (let k = 0; k < 3; k++) a.bp[k] += (a.snapP[k] - a.bp[k]) * w;
      a.blend = Math.max(0, a.blend - blendDt / BLEND);
    }
    this.fk(a, rig);
    if (a.lie > 0) this.lieDown(a, rig, a.lie);
    this.writeBones(a, rig);
  }

  private armL = false;
  private armR = false;
  /** Arm IK to a hand target (model space); remembers which arms are taken. */
  private hand(a: Actor, rig: Rig, side: number, x: number, y: number, z: number, px: number, py: number, pz: number): void {
    this.armIK(a, rig, side, x, y, z, px, py, pz);
    if (side < 0) this.armL = true; else this.armR = true;
  }

  /** Clip frame into the actor's locals (animated bones) and body position. */
  private sample(a: Actor, A: Assets, rig: Rig, c: Clip, t: number): void {
    const f = t * 30;
    let i0 = Math.floor(f);
    const u = f - i0;
    i0 = ((i0 % c.frames) + c.frames) % c.frames;
    const i1 = (i0 + 1) % c.frames;
    const d = c.data, st = A.stride;
    const o0 = i0 * st, o1 = i1 * st;
    const k = 1 / 8192;
    const L = a.L;
    // body position (the clips are retargeted to this rig)
    for (let c3 = 0; c3 < 3; c3++) a.bp[c3] = (d[o0 + c3] + (d[o1 + c3] - d[o0 + c3]) * u) * k;
    void rig;
    const bones = A.animBones;
    for (let b = 0; b < bones.length; b++) {
      const j = bones[b] * 4, s0 = o0 + 3 + b * 4, s1 = o1 + 3 + b * 4;
      let x1 = d[s1], y1 = d[s1 + 1], z1 = d[s1 + 2], w1 = d[s1 + 3];
      const x0 = d[s0], y0 = d[s0 + 1], z0 = d[s0 + 2], w0 = d[s0 + 3];
      if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, z = z0 + (z1 - z0) * u, w = w0 + (w1 - w0) * u;
      const l = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
      L[j] = x * l; L[j + 1] = y * l; L[j + 2] = z * l; L[j + 3] = w * l;
    }
  }

  private fk(a: Actor, rig: Rig): void {
    const { L, Wq, Wp } = a;
    const n = rig.n, par = rig.parent, off = rig.off;
    for (let i = 0; i < n; i++) {
      const p = par[i];
      if (p < 0) {
        Wq[0] = L[0]; Wq[1] = L[1]; Wq[2] = L[2]; Wq[3] = L[3];
        Wp[0] = 0; Wp[1] = 0; Wp[2] = 0;
        continue;
      }
      qmul(Wq, i * 4, Wq, p * 4, L, i * 4);
      if (i === J.Body) {
        Wp[i * 3] = a.bp[0]; Wp[i * 3 + 1] = a.bp[1]; Wp[i * 3 + 2] = a.bp[2];
      } else {
        qrot(v1, Wq, p * 4, off[i * 3], off[i * 3 + 1], off[i * 3 + 2]);
        Wp[i * 3] = Wp[p * 3] + v1[0]; Wp[i * 3 + 1] = Wp[p * 3 + 1] + v1[1]; Wp[i * 3 + 2] = Wp[p * 3 + 2] + v1[2];
      }
    }
  }

  /** Multiply a local rotation by an axis-angle rotation (in the parent-relative frame). */
  private addLocal(a: Actor, j: number, ax: number, ay: number, az: number, ang: number): void {
    qaxis(tq, 0, ax, ay, az, ang);
    qmul(tq, 4, a.L, j * 4, tq, 0);
    a.L[j * 4] = tq[4]; a.L[j * 4 + 1] = tq[5]; a.L[j * 4 + 2] = tq[6]; a.L[j * 4 + 3] = tq[7];
  }

  /**
   * Two-bone arm IK to a hand target (model space) with the elbow toward the
   * pole. Writes the upper arm / forearm locals; the wrist keeps its local.
   */
  private armIK(a: Actor, rig: Rig, side: number, tx: number, ty: number, tz: number, px: number, py: number, pz: number): void {
    const ua = side < 0 ? J.UaL : J.UaR, la = side < 0 ? J.LaL : J.LaR, sho = side < 0 ? J.ShoL : J.ShoR;
    const { Wq, Wp, L } = a;
    const off = rig.off;
    const l1 = Math.hypot(off[la * 3], off[la * 3 + 1], off[la * 3 + 2]);
    const l2 = Math.hypot(off[(la + 1) * 3], off[(la + 1) * 3 + 1], off[(la + 1) * 3 + 2]); // wrist follows the forearm
    const sx = Wp[ua * 3], sy = Wp[ua * 3 + 1], sz = Wp[ua * 3 + 2];
    let dx = tx - sx, dy = ty - sy, dz = tz - sz;
    let dist = Math.hypot(dx, dy, dz) || 1e-6;
    dx /= dist; dy /= dist; dz /= dist;
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
    const ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const h = l1 * Math.sqrt(Math.max(0, 1 - ca * ca));
    const pd = px * dx + py * dy + pz * dz;
    let qx = px - pd * dx, qy = py - pd * dy, qz = pz - pd * dz;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;
    const ex = sx + dx * l1 * ca + qx * h, ey = sy + dy * l1 * ca + qy * h, ez = sz + dz * l1 * ca + qz * h;
    const hx = sx + dx * dist, hy = sy + dy * dist, hz = sz + dz * dist;
    // upper arm: rest direction (to the elbow) and rest elbow-tip (-z)
    v1[0] = off[la * 3]; v1[1] = off[la * 3 + 1]; v1[2] = off[la * 3 + 2];
    v2[0] = 0; v2[1] = 0; v2[2] = -1;
    v3[0] = ex - sx; v3[1] = ey - sy; v3[2] = ez - sz;
    v4[0] = qx; v4[1] = qy; v4[2] = qz;
    qFrames(tq, 0, v1, v2, v3, v4); // world rotation of the upper arm
    // forearm
    const fx = hx - ex, fy = hy - ey, fz = hz - ez;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const ud = (qx * fx + qy * fy + qz * fz) / fl;
    v1[0] = off[(la + 1) * 3]; v1[1] = off[(la + 1) * 3 + 1]; v1[2] = off[(la + 1) * 3 + 2];
    v3[0] = fx; v3[1] = fy; v3[2] = fz;
    v4[0] = qx - ud * fx / fl; v4[1] = qy - ud * fy / fl; v4[2] = qz - ud * fz / fl;
    qFrames(tq, 4, v1, v2, v3, v4);
    // locals: ua = inv(W[sho]) * Wua ; la = inv(Wua) * Wla
    qmulInv(L, ua * 4, Wq, sho * 4, tq, 0);
    qmulInv(L, la * 4, tq, 0, tq, 4);
    // keep world state consistent for later layers (wrist/fingers recomputed by the final FK)
    for (let k = 0; k < 4; k++) { Wq[ua * 4 + k] = tq[k]; Wq[la * 4 + k] = tq[4 + k]; }
    Wp[la * 3] = ex; Wp[la * 3 + 1] = ey; Wp[la * 3 + 2] = ez;
    const wr = la + 1;
    qmul(Wq, wr * 4, tq, 4, L, wr * 4);
    Wp[wr * 3] = hx; Wp[wr * 3 + 1] = hy; Wp[wr * 3 + 2] = hz;
  }

  /** Orient a hand: 1 palm up, 2 palm inward (fingers forward), 3 screen toward the face, 4 palm down (keyboard). */
  private palm(a: Actor, rig: Rig, side: number, mode: number): void {
    const la = side < 0 ? J.LaL : J.LaR, wr = la + 1;
    const off = rig.off;
    const mid = side < 0 ? J.MidL : J.MidR;
    // rest: fingers along the wrist->middle offset, palm normal -y
    v1[0] = off[mid * 3]; v1[1] = off[mid * 3 + 1]; v1[2] = off[mid * 3 + 2];
    v2[0] = 0; v2[1] = -1; v2[2] = 0;
    // forearm direction in the world
    qrot(v3, a.Wq, la * 4, off[wr * 3], off[wr * 3 + 1], off[wr * 3 + 2]);
    const l = Math.hypot(v3[0], v3[1], v3[2]) || 1;
    const fx = v3[0] / l, fy = v3[1] / l, fz = v3[2] / l;
    switch (mode) {
      case 1: v3[0] = fx; v3[1] = fy * 0.3; v3[2] = fz; v4[0] = 0; v4[1] = 1; v4[2] = 0; break; // palm up
      case 2: v3[0] = fx; v3[1] = fy; v3[2] = fz; v4[0] = -side; v4[1] = 0; v4[2] = 0; break; // palm inward
      case 3: v3[0] = fx * 0.4 - side * 0.3; v3[1] = 0.9; v3[2] = fz * 0.4; v4[0] = -side * 0.4; v4[1] = 0.3; v4[2] = -1; break;
      default: v3[0] = fx; v3[1] = Math.min(fy, 0) * 0.5; v3[2] = fz; v4[0] = 0; v4[1] = -1; v4[2] = 0; break; // palm down
    }
    qFrames(tq, 0, v1, v2, v3, v4);
    qmulInv(a.L, wr * 4, a.Wq, la * 4, tq, 0);
    for (let k = 0; k < 4; k++) a.Wq[wr * 4 + k] = tq[k];
  }

  private fingers(a: Actor, rig: Rig): void {
    const L = a.L, fj = rig.fingers;
    const CURL = [0, 0.08, 0.9, 1.05, 0.75]; // per segment (metacarpal stays flat)
    for (let i = 0; i < fj.length; i++) {
      const j = fj[i], side = rig.fingerSide[i];
      const g = side < 0 ? a.grip[0] : a.grip[1];
      const sg = rig.seg[i];
      if (rig.thumb[i]) {
        // thumb: fold toward the palm a little
        qaxis(L, j * 4, 0, 1, 0, side * g * (sg === 1 ? 0.25 : 0.35));
      } else {
        // curl about z: right fingers (+x) bend toward -y with a negative angle
        qaxis(L, j * 4, 0, 0, 1, -side * (0.12 + g) * CURL[sg]);
      }
    }
  }

  /** Lay the posed body on its back (head toward -z), hips resting on the surface. */
  private lieDown(a: Actor, rig: Rig, k: number): void {
    const n = rig.n;
    const ang = -Math.PI / 2 * smooth(k);
    qaxis(tq, 0, 1, 0, 0, ang);
    const px = a.Wp[J.Body * 3], py = a.Wp[J.Body * 3 + 1], pz = a.Wp[J.Body * 3 + 2];
    const ty = py + (0.13 - py) * smooth(k);
    for (let i = 0; i < n; i++) {
      qmul(a.Wq, i * 4, tq, 0, a.Wq, i * 4);
      qrot(v1, tq, 0, a.Wp[i * 3] - px, a.Wp[i * 3 + 1] - py, a.Wp[i * 3 + 2] - pz);
      a.Wp[i * 3] = px + v1[0]; a.Wp[i * 3 + 1] = ty + v1[1]; a.Wp[i * 3 + 2] = pz + v1[2];
    }
    void rig;
  }

  private writeBones(a: Actor, rig: Rig): void {
    const { Wq, Wp, mats } = a;
    const n = rig.n;
    for (let i = 0; i < n; i++) {
      const x = Wq[i * 4], y = Wq[i * 4 + 1], z = Wq[i * 4 + 2], w = Wq[i * 4 + 3];
      const o = i * 16;
      mats[o] = 1 - 2 * (y * y + z * z); mats[o + 1] = 2 * (x * y + z * w); mats[o + 2] = 2 * (x * z - y * w); mats[o + 3] = 0;
      mats[o + 4] = 2 * (x * y - z * w); mats[o + 5] = 1 - 2 * (x * x + z * z); mats[o + 6] = 2 * (y * z + x * w); mats[o + 7] = 0;
      mats[o + 8] = 2 * (x * z + y * w); mats[o + 9] = 2 * (y * z - x * w); mats[o + 10] = 1 - 2 * (x * x + y * y); mats[o + 11] = 0;
      mats[o + 12] = Wp[i * 3]; mats[o + 13] = Wp[i * 3 + 1]; mats[o + 14] = Wp[i * 3 + 2]; mats[o + 15] = 1;
      Matrix.FromArrayToRef(mats, o, a.bones[i].getLocalMatrix());
    }
    a.bones[0].markAsDirty();
  }

  // ------------------------------------------------------------ props

  // per-actor state for the prop writers (no closures, no per-frame allocations)
  private ep = { id: 0, x: 0, y: 0, z: 0, c: 1, sn: 0, sx: 1, sy: 1, sz: 1, s: 1 };
  private gp = new Float64Array(3); // last grip point
  private gp2 = new Float64Array(3);
  private R = new Float64Array(9); // rotation scratch (columns)

  /** World x / z of a model-space point. */
  private wx(x: number, z: number): number { const e = this.ep; return e.x + e.c * x * e.sx + e.sn * z * e.sz; }
  private wz(x: number, z: number): number { const e = this.ep; return e.y - e.sn * x * e.sx + e.c * z * e.sz; }

  /** Instance of `part` with model-space rotation columns R (unit or scaled; null = identity) at model point o. */
  private put(part: InstancedPart, R: Float64Array | null, ox: number, oy: number, oz: number, color?: string): void {
    const e = this.ep;
    const i = part.add(e.id);
    const ax = R ? R[0] : 1, ay = R ? R[1] : 0, az = R ? R[2] : 0;
    const bx = R ? R[3] : 0, by = R ? R[4] : 1, bz = R ? R[5] : 0;
    const cx = R ? R[6] : 0, cy = R ? R[7] : 0, cz = R ? R[8] : 1;
    const c = e.c, sn = e.sn, k1 = e.sx, k2 = e.sy, k3 = e.sz;
    writeMatrix(part.m, i,
      c * ax * k1 + sn * az * k3, ay * k2, -sn * ax * k1 + c * az * k3,
      c * bx * k1 + sn * bz * k3, by * k2, -sn * bx * k1 + c * bz * k3,
      c * cx * k1 + sn * cz * k3, cy * k2, -sn * cx * k1 + c * cz * k3,
      this.wx(ox, oz), e.z + oy * k2, this.wz(ox, oz));
    if (part.c) {
      if (color) hexInto(color, tmp3); else { tmp3[0] = tmp3[1] = tmp3[2] = 1; }
      part.c[i * 4] = tmp3[0]; part.c[i * 4 + 1] = tmp3[1]; part.c[i * 4 + 2] = tmp3[2]; part.c[i * 4 + 3] = 1;
    }
  }

  /** A bone's world rotation as columns, into this.R. */
  private boneRot(a: Actor, j: number): Float64Array {
    const R = this.R, Wq = a.Wq;
    const x = Wq[j * 4], y = Wq[j * 4 + 1], z = Wq[j * 4 + 2], w = Wq[j * 4 + 3];
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y + z * w); R[2] = 2 * (x * z - y * w);
    R[3] = 2 * (x * y - z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z + x * w);
    R[6] = 2 * (x * z + y * w); R[7] = 2 * (y * z - x * w); R[8] = 1 - 2 * (x * x + y * y);
    return R;
  }

  /** Grip point of a hand (along the fingers, toward the palm), into `out`. */
  private grip(a: Actor, side: number, out: Float64Array): Float64Array {
    const wr = side < 0 ? J.WrL : J.WrR;
    qrot(v1, a.Wq, wr * 4, side * 0.075, -0.03, 0.0);
    out[0] = a.Wp[wr * 3] + v1[0]; out[1] = a.Wp[wr * 3 + 1] + v1[1]; out[2] = a.Wp[wr * 3 + 2] + v1[2];
    return out;
  }

  /** A prop held in a hand: y along the thumb side (-z of the hand at rest), z out of the palm. */
  private inHand(a: Actor, part: InstancedPart, side: number): void {
    const Rw = this.boneRot(a, side < 0 ? J.WrL : J.WrR);
    const yx = -Rw[6], yy = -Rw[7], yz = -Rw[8];
    const zx = -Rw[3], zy = -Rw[4], zz = -Rw[5];
    Rw[0] = yy * zz - yz * zy; Rw[1] = yz * zx - yx * zz; Rw[2] = yx * zy - yy * zx;
    Rw[3] = yx; Rw[4] = yy; Rw[5] = yz;
    Rw[6] = zx; Rw[7] = zy; Rw[8] = zz;
    const g = this.grip(a, side, this.gp);
    this.put(part, Rw, g[0], g[1], g[2]);
  }

  /** Invisible pick box along joint j0 -> point (x1, y1, z1) (model space). */
  private pickSeg(a: Actor, j0: number, x1: number, y1: number, z1: number, w: number): void {
    const e = this.ep, Wp = a.Wp;
    const x0 = Wp[j0 * 3], y0 = Wp[j0 * 3 + 1], z0 = Wp[j0 * 3 + 2];
    const ax = this.wx(x0, z0), ay = e.z + y0 * e.sy, az = this.wz(x0, z0);
    const bx = this.wx(x1, z1), by = e.z + y1 * e.sy, bz = this.wz(x1, z1);
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    dx /= len; dy /= len; dz /= len;
    // a horizontal side axis perpendicular to the segment
    let ux = -dz, uz = dx;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-3) { ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
    const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;
    const ww = w * e.s;
    const i = this.proxy.add(e.id);
    writeMatrix(this.proxy.m, i, ux * ww, 0, uz * ww, dx * len, dy * len, dz * len, vx * ww, vy * ww, vz * ww, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  }

  private emitProps(a: Actor, p: PersonVisual, s: number, bw: number): void {
    const th = Math.PI / 2 - p.heading;
    const e = this.ep;
    e.id = p.id; e.x = p.x; e.y = p.y; e.z = p.z;
    e.c = Math.cos(th); e.sn = Math.sin(th);
    e.sx = s * bw; e.sy = s; e.sz = s * bw; e.s = s;
    const Wp = a.Wp;
    const props = this.props;
    for (const u of this.uses) {
      const part = props[u.part];
      switch (u.part) {
        case P.Crate: {
          const l = this.grip(a, -1, this.gp), r = this.grip(a, 1, this.gp2);
          const w = Math.max(0.24, Math.abs(r[0] - l[0]) - 0.03);
          const R = this.R;
          R[0] = w; R[1] = 0; R[2] = 0; R[3] = 0; R[4] = 0.28; R[5] = 0; R[6] = 0; R[7] = 0; R[8] = 0.32;
          this.put(part, R, (l[0] + r[0]) / 2, (l[1] + r[1]) / 2 + 0.03, (l[2] + r[2]) / 2 + 0.02);
          break;
        }
        case P.Tray: {
          const g = this.grip(a, 1, this.gp);
          this.put(part, null, g[0] + 0.02, g[1] + 0.06, g[2]);
          break;
        }
        case P.Briefcase:
        case P.Bag: { // hangs vertically beside the leg, swings with the hand
          const g = this.grip(a, 1, this.gp);
          this.put(part, null, g[0] + 0.03, g[1], g[2], u.part === P.Bag ? APRONS[Math.floor(hashf(p.id * 3) * APRONS.length)] : undefined);
          break;
        }
        case P.Sign: {
          const g = this.grip(a, 1, this.gp);
          this.put(part, null, g[0], g[1] - 0.3, g[2] + 0.02, SIGNS[Math.floor(hashf(p.id * 5) * SIGNS.length)]);
          break;
        }
        case P.ChefHat:
        case P.Cap:
          this.put(part, this.boneRot(a, J.Head), Wp[J.Head * 3], Wp[J.Head * 3 + 1], Wp[J.Head * 3 + 2]);
          break;
        case P.HardHat:
          this.put(part, this.boneRot(a, J.Head), Wp[J.Head * 3], Wp[J.Head * 3 + 1], Wp[J.Head * 3 + 2], a.look!.hatColor);
          break;
        case P.Belt: { // torus around the waist in the hips' xz plane
          const R = this.boneRot(a, J.Hips);
          const ox = Wp[J.Hips * 3] + R[3] * 0.1, oy = Wp[J.Hips * 3 + 1] + R[4] * 0.1, oz = Wp[J.Hips * 3 + 2] + R[5] * 0.1;
          for (let k = 0; k < 3; k++) { R[k] *= 0.27; R[3 + k] *= 0.45; R[6 + k] *= 0.225; }
          this.put(part, R, ox, oy, oz);
          break;
        }
        case P.Badge: {
          const R = this.boneRot(a, J.Chest);
          const j = J.Chest * 3;
          this.put(part, R, Wp[j] - R[0] * 0.07 + R[6] * 0.12, Wp[j + 1] - R[1] * 0.07 + R[7] * 0.12, Wp[j + 2] - R[2] * 0.07 + R[8] * 0.12);
          break;
        }
        case P.Apron: {
          const col = APRONS[a.look!.apron];
          // bib on the torso (follows a lean)
          const R = this.boneRot(a, J.Torso);
          const fz = 0.135, j = J.Torso * 3;
          const tx = Wp[j] + R[3] * 0.02 + R[6] * fz, ty = Wp[j + 1] + R[4] * 0.02 + R[7] * fz, tz = Wp[j + 2] + R[5] * 0.02 + R[8] * fz;
          // horizontal forward of the torso (for the hanging skirt)
          let hx = R[6], hz = R[8];
          const hl = Math.hypot(hx, hz) || 1;
          hx /= hl; hz /= hl;
          for (let k = 0; k < 3; k++) { R[k] *= 0.26; R[3 + k] *= 0.3; }
          this.put(part, R, tx, ty, tz, col);
          if (!u.side) { // skirt hangs straight down from the waist (not when seated)
            R[0] = hz * 0.36; R[1] = 0; R[2] = -hx * 0.36;
            R[3] = 0; R[4] = 0.4; R[5] = 0;
            R[6] = hx; R[7] = 0; R[8] = hz;
            const h = J.Hips * 3;
            this.put(part, R, Wp[h] + hx * 0.125, Wp[h + 1] - 0.1, Wp[h + 2] + hz * 0.125, col);
          }
          break;
        }
        case P.Flyer:
          if (u.bone === -2) { // ballot lying under the left hand
            const g = this.grip(a, -1, this.gp);
            const R = this.R;
            R[0] = 1; R[1] = 0; R[2] = 0; R[3] = 0; R[4] = 0; R[5] = 1; R[6] = 0; R[7] = -1; R[8] = 0;
            this.put(part, R, g[0] + 0.08, g[1] - 0.03, g[2] - 0.02);
          } else this.inHand(a, part, u.side || 1);
          break;
        default:
          this.inHand(a, part, u.side || 1);
          break;
      }
    }
    // pick proxy: torso box (pelvis..head top) and legs box (pelvis..feet)
    const h = J.Head * 3, fl = J.FootL * 3, fr = J.FootR * 3;
    this.pickSeg(a, J.Body, Wp[h], Wp[h + 1] + 0.25, Wp[h + 2], 0.42);
    this.pickSeg(a, J.Body, (Wp[fl] + Wp[fr]) / 2, (Wp[fl + 1] + Wp[fr + 1]) / 2, (Wp[fl + 2] + Wp[fr + 2]) / 2, 0.36);
  }
}
