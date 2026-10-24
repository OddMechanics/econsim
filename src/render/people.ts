// People, in two levels of detail.
//
// Near the camera (up to ~48 people within ~40 m) they are skinned, animated
// characters from a CC0 asset pack (see characters.ts). Everyone else is a
// low-poly humanoid drawn with thin instances: one instanced mesh per body
// part (head, torso, upper arm, ...), every part's matrix computed in JS each
// frame from a tiny skeleton (pelvis -> torso -> shoulders -> elbows, hips ->
// knees -> ankles). 1000 people = ~20000 part instances in ~30 draw calls.
// People crossing the detail boundary cross-fade between the two (with
// distance hysteresis so nobody flickers).
//
// Body space (before the person's yaw/position): x = right, y = up, z = forward,
// feet at the origin. Babylon is left-handed; a model facing local +Z gets
// rotation.y = PI/2 - heading.

import { Color3, Mesh, MeshBuilder, Vector3 } from '@babylonjs/core';
import type { PickingInfo, Scene, ShadowGenerator } from '@babylonjs/core';
import type { Looks, Pose } from '../sim/types';
import { CharacterRenderer, POLICE_NAVY, ROLE, characterLook, type Look } from './characters';
import { InstancedPart, box, cyl, hashf, mergeParts, paintMesh, sphere, writeMatrix } from './characterKit';
import type { PartOptions } from './characterKit';
import { hexInto } from './palette';

// shared helpers (vehicles.ts imports these from here)
export { InstancedPart, hashf, mergeParts, paintMesh, writeMatrix };
export type { PartOptions };

export interface PersonVisual {
  id: number;
  x: number; y: number; z: number; // feet position (sim x,y; Babylon Y = z)
  heading: number;
  pose: Pose;
  moving: boolean; // walking animation on/off
  looks: Looks;
  carrying: boolean; // holds a box in front
  highlight: boolean; // selected person
  /** Optional detail (v0.3): talking right now (mouth/gesture), something in hand, work clothes. */
  talking?: boolean;
  holding?: 'phone' | 'cup' | 'briefcase' | 'bag' | 'tool' | 'flyer' | 'sign' | 'mic' | null;
  outfit?: 'casual' | 'office' | 'work' | 'hivis' | 'chef' | 'apron' | 'suit' | 'police';
  seated?: boolean; // sitting (chair, sofa, car) — poses sit/type/eat/watch
}

const TAU = Math.PI * 2;

// ------------------------------------------------------------- tiny 3D math

class V3 {
  x = 0; y = 0; z = 0;
  set(x: number, y: number, z: number): this {
    this.x = x; this.y = y; this.z = z;
    return this;
  }
}

/** 3x3 rotation as columns: [X | Y | Z] (images of the local axes). */
type M3 = Float64Array;
const m3 = (): M3 => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** rotX(a): a > 0 swings a hanging limb forward (and tilts an upright one back). */
function rotX(o: M3, a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  o[0] = 1; o[1] = 0; o[2] = 0;
  o[3] = 0; o[4] = c; o[5] = -s;
  o[6] = 0; o[7] = s; o[8] = c;
  return o;
}
/** rotY(a): yaw; maps +Z to (sin a, 0, cos a) like Babylon's rotation.y. */
function rotY(o: M3, a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  o[0] = c; o[1] = 0; o[2] = -s;
  o[3] = 0; o[4] = 1; o[5] = 0;
  o[6] = s; o[7] = 0; o[8] = c;
  return o;
}
/** rotZ(a): a > 0 swings a hanging limb toward +x. */
function rotZ(o: M3, a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a);
  o[0] = c; o[1] = s; o[2] = 0;
  o[3] = -s; o[4] = c; o[5] = 0;
  o[6] = 0; o[7] = 0; o[8] = 1;
  return o;
}
/** o = a * b (o must not alias a or b). */
function mul(o: M3, a: M3, b: M3): M3 {
  for (let j = 0; j < 9; j += 3) {
    const x = b[j], y = b[j + 1], z = b[j + 2];
    o[j] = a[0] * x + a[3] * y + a[6] * z;
    o[j + 1] = a[1] * x + a[4] * y + a[7] * z;
    o[j + 2] = a[2] * x + a[5] * y + a[8] * z;
  }
  return o;
}
/** out = base + M * (x, y, z) */
function off(out: V3, base: V3, M: M3, x: number, y: number, z: number): V3 {
  return out.set(
    base.x + M[0] * x + M[3] * y + M[6] * z,
    base.y + M[1] * x + M[4] * y + M[7] * z,
    base.z + M[2] * x + M[5] * y + M[8] * z,
  );
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ the rig

// body proportions for a 1.75 m person (scaled by height / 1.75)
const THIGH = 0.43, SHIN = 0.42, ANKLE = 0.075, HIP = THIGH + SHIN + ANKLE;
const UPPER_ARM = 0.28, FOREARM = 0.25;
const SEAT = 0.45; // implied chair height (m)
const DESK = 0.74; // implied desk height (m)

/** Seated poses (the `seated` flag can make any other pose seated too). */
const SEATED_POSES = new Set<Pose>(['sit', 'type', 'eat', 'drive', 'watch']);

/** Things held in a hand (instanced figure props). */
const enum Hold { None, Phone, Cup, Briefcase, Bag, Tool, Flyer, Sign, Mic }
const HOLD: Record<string, Hold> = { phone: Hold.Phone, cup: Hold.Cup, briefcase: Hold.Briefcase, bag: Hold.Bag, tool: Hold.Tool, flyer: Hold.Flyer, sign: Hold.Sign, mic: Hold.Mic };

/** Joint angles / targets for one person this frame (reused object). */
class Rig {
  grounded = true; // shift the body so the lowest sole touches the ground
  lying = false;
  px = 0; py = 0; pz = 0; // hip-joint center
  pitch = 0; // pelvis forward tilt
  lean = 0; twist = 0; roll = 0; // torso relative to pelvis
  nod = 0; yaw = 0; // head
  swing = new Float64Array(2); // thigh forward swing [left, right]
  abd = new Float64Array(2); // thigh outward
  knee = new Float64Array(2); // knee bend (> 0)
  foot = new Float64Array(2); // foot pitch, toes up > 0
  ik = new Uint8Array(2); // arm mode: 0 = angles, 1 = hand target
  aSwing = new Float64Array(2); // shoulder forward
  aAbd = new Float64Array(2); // shoulder outward
  aTwist = new Float64Array(2); // upper-arm twist, inward > 0
  elbow = new Float64Array(2); // elbow bend (> 0)
  tgt = new Float64Array(6); // hand targets relative to the waist (body space)
  pole = new Float64Array(6); // elbow direction hints
  box = false;
  tray = false;
  hammer = -1; // hand holding a hammer
  hold = Hold.None; // right hand
  rest = false; // hands resting on the thighs (seated default)
}

/** Color slots per person. */
const SKIN_C = 0, SHIRT_C = 1, PANTS_C = 2, SHOE_C = 3, SLEEVE_C = 4, SHIN_C = 5, THIGH_C = 6, ARM_C = 7;
const NSLOT = 8;
const LONG_SLEEVES = new Set(['long', 'hoodie', 'suit']);
const BARE_SHINS = new Set(['shorts']);

interface Tint {
  key: string;
  look: Look;
  rgb: Float32Array; // NSLOT x 3
  hat: number; // 0 none, 1 chef, 2 police cap, 3 hard hat
  hatRgb: Float32Array;
  apron: number; // apron color index or -1
}
const APRON_RGB = ['#f2f2ee', '#e9e2d0', '#2e3440', '#5b4636', '#3b5f8a', '#7d2f2f'];
const BAG_RGB = APRON_RGB;
const SIGN_RGB = ['#f4f1e6', '#f7e27a', '#f2b4a6', '#bfe0f4'];

// level of detail (defaults; see PeopleRenderer.detailMax/In/Out)
const FADE_S = 0.35; // cross-fade seconds

interface LodState {
  target: boolean; // wants to be detailed
  fade: number; // 0 instanced .. 1 detailed
  speed: number; // m/s (smoothed)
  px: number; py: number;
  frame: number; // last frame seen
}

export class PeopleRenderer {
  /** Detailed characters near the camera (set false to force the instanced figures). */
  detail = true;
  /** At most this many detailed characters (nearest first). */
  detailMax = 48;
  /** Distance (m) from the camera at which people become detailed ... */
  detailIn = 38;
  /** ... and at which they drop back to the instanced figures (hysteresis). */
  detailOut = 46;
  private parts: InstancedPart[] = [];
  private pickParts: InstancedPart[] = [];
  private head: InstancedPart;
  private neck: InstancedPart; private torso: InstancedPart; private pelvis: InstancedPart;
  private upperArm: InstancedPart; private forearm: InstancedPart; private hand: InstancedPart;
  private thigh: InstancedPart; private shin: InstancedPart; private shoe: InstancedPart;
  private crate: InstancedPart; private tray: InstancedPart; private hammer: InstancedPart; private ring: InstancedPart;
  private hats: InstancedPart[]; private apron: InstancedPart; private holds: InstancedPart[];

  private chars: CharacterRenderer;
  private lod = new Map<number, LodState>();
  private cands: number[] = [];
  private candD: Float64Array = new Float64Array(256);
  private lastT = -1;
  private frame = 0;
  private detailOn = true;

  private tints = new Map<number, Tint>();
  private R = new Rig();
  private min = new Vector3();
  private max = new Vector3();

  // per-person scratch
  private rgb: Float32Array = new Float32Array(NSLOT * 3);
  private hl = false;
  private pid = 0;
  private M = m3(); // root rotation * scale
  private T = new V3(); // root translation
  private t0 = m3(); private t1 = m3(); private t2 = m3(); private t3 = m3();
  private Rp = m3(); private Rt = m3(); private Rh = m3();
  private Rthigh = m3(); private Rshin = m3(); private Rup = m3(); private Rlo = m3();
  private hipJ = [new V3(), new V3()]; private kneeJ = [new V3(), new V3()]; private ankleJ = [new V3(), new V3()];
  private footR = [m3(), m3()];
  private pel = new V3(); private waist = new V3(); private neckB = new V3(); private headC = new V3();
  private sh = new V3(); private el = new V3(); private wr = [new V3(), new V3()];
  private a = new V3();
  private seg = m3(); // last segment frame (unit axes)
  private handF = [m3(), m3()]; // forearm frames (for props)

  constructor(private scene: Scene, shadows: ShadowGenerator | null) {
    const P = (mesh: Mesh, name: string, opts: PartOptions) => {
      mesh.name = 'person-' + name;
      const p = new InstancedPart(mesh, scene, shadows, opts);
      this.parts.push(p);
      if (opts.pickable) this.pickParts.push(p);
      return p;
    };
    const tinted = { colored: true, pickable: true };

    // head: a plain, faceless egg like the detailed characters' (white: the skin tint shows as is)
    this.head = P(paintMesh(sphere(scene, 6), 1, 1, 1), 'head', tinted);
    this.neck = P(cyl(scene, 0.9, 1, 6, 0, 1), 'neck', { colored: true });
    // torso: octagonal prism, narrower at the waist, tapered at the shoulders
    const torsoParts = [
      cyl(scene, 1, 0.84, 8, 0, 0.86, Math.PI / 8),
      cyl(scene, 0.78, 1, 8, 0.86, 1, Math.PI / 8),
    ];
    this.torso = P(mergeParts(torsoParts, 'torso'), 'torso', tinted);
    this.pelvis = P(cyl(scene, 1, 0.9, 8, -0.5, 0.5, Math.PI / 8), 'pelvis', tinted);
    const limbParts = (dTop: number, dBot: number) => [
      cyl(scene, dTop, dBot, 7, -1, 0),
      sphere(scene, 4, 0, 0, 0, dTop, dTop * 0.9, dTop), // rounded joint at the top
    ];
    this.upperArm = P(mergeParts(limbParts(1, 0.8), 'uarm'), 'uarm', tinted);
    this.forearm = P(mergeParts(limbParts(0.95, 0.72), 'farm'), 'farm', { colored: true });
    this.hand = P(mergeParts([box(scene, 1, 0.75, 1, 0, -0.375, 0), box(scene, 0.9, 0.3, 0.75, 0, -0.85, 0.05)], 'hand'), 'hand', { colored: true });
    this.thigh = P(mergeParts(limbParts(1, 0.74), 'thigh'), 'thigh', tinted);
    this.shin = P(mergeParts(limbParts(0.9, 0.66), 'shin'), 'shin', tinted);
    // shoe: unit box spanning x -.5..5, y -1..0, z -.25..75 with a rounded toe
    const shoeParts = [
      box(scene, 1, 1, 0.8, 0, -0.5, 0.15),
      cyl(scene, 0.9, 0.9, 8, -1, -0.1),
    ];
    shoeParts[1].scaling.set(1, 1, 0.5);
    shoeParts[1].position.z = 0.53;
    shoeParts[1].bakeCurrentTransformIntoVertices();
    this.shoe = P(mergeParts(shoeParts, 'shoe'), 'shoe', { colored: true });

    // props (fixed colors from vertex colors)
    const crate = mergeParts([
      paintMesh(box(scene, 1, 1, 1, 0, 0, 0), 0.72, 0.55, 0.36),
      paintMesh(box(scene, 1.02, 0.06, 0.25, 0, 0.5, 0), 0.86, 0.78, 0.6), // tape
    ], 'crate');
    this.crate = P(crate, 'crate', {});
    const tray = mergeParts([
      paintMesh(cyl(scene, 0.42, 0.4, 12, 0, 0.018), 0.55, 0.56, 0.58),
      paintMesh(cyl(scene, 0.2, 0.17, 10, 0.018, 0.032), 0.96, 0.96, 0.94), // plate
      paintMesh(cyl(scene, 0.11, 0.09, 8, 0.03, 0.06), 0.85, 0.45, 0.25), // food
      paintMesh(cyl(scene, 0.07, 0.06, 8, 0.018, 0.13, 0, 0.12, -0.06), 0.92, 0.92, 0.95), // glass
    ], 'tray');
    this.tray = P(tray, 'tray', {});
    // hammer, in hand space: handle from the fist, angled forward
    const handle = paintMesh(box(scene, 0.028, 0.32, 0.028, 0, 0.12, 0), 0.6, 0.42, 0.25);
    const hhead = paintMesh(box(scene, 0.04, 0.045, 0.13, 0, 0.27, 0.02), 0.3, 0.31, 0.33);
    const hammer = mergeParts([handle, hhead], 'hammer');
    hammer.rotation.x = (5 * Math.PI) / 6;
    hammer.position.y = -0.05;
    hammer.bakeCurrentTransformIntoVertices();
    this.hammer = P(hammer, 'hammer', {});
    const ring = MeshBuilder.CreateTorus('ring', { diameter: 1, thickness: 0.07, tessellation: 24 }, scene);
    this.ring = P(ring, 'ring', { shadows: false, receive: false });
    this.ring.material.disableLighting = true;
    this.ring.material.emissiveColor = new Color3(1, 0.82, 0.3);
    // hats, in head-sphere units (head radius 1 = half the head width), colored per instance
    this.hats = [
      P(mergeParts([cyl(scene, 1.6, 1.5, 10, 0.55, 1.5), sphere(scene, 6, 0, 1.55, 0, 2.0, 0.9, 1.9)], 'chefhat'), 'chefhat', { colored: true }),
      P(mergeParts([cyl(scene, 2.1, 2.05, 10, 0.35, 0.95), box(scene, 1.4, 0.08, 0.8, 0, 0.38, 0.95)], 'cap'), 'cap', { colored: true }),
      P(mergeParts([sphere(scene, 6, 0, 0.2, 0, 2.25, 1.9, 2.3, 0.5), cyl(scene, 2.6, 2.6, 10, 0.18, 0.26)], 'hardhat'), 'hardhat', { colored: true }),
    ];
    // apron: a plate in front of the torso (unit = torso width)
    this.apron = P(mergeParts([box(scene, 0.62, 0.55, 0.04, 0, 0.55, 0), box(scene, 0.8, 0.75, 0.04, 0, -0.1, 0.02)], 'apron'), 'apron', { colored: true });
    // hand-held things, in hand space (origin at the wrist, -y along the hand)
    const phone = paintMesh(box(scene, 0.08, 0.15, 0.015, 0, -0.1, 0.05), 0.1, 0.1, 0.12);
    const cup = paintMesh(cyl(scene, 0.09, 0.075, 8, -0.15, -0.03, 0, 0, 0.06), 0.95, 0.94, 0.9);
    const brief = mergeParts([paintMesh(box(scene, 0.42, 0.3, 0.1, 0, -0.3, 0), 0.24, 0.16, 0.11)], 'brief');
    const bag = box(scene, 0.3, 0.34, 0.13, 0, -0.32, 0);
    const flyer = paintMesh(box(scene, 0.16, 0.22, 0.006, 0, -0.12, 0.06), 0.97, 0.96, 0.92);
    const sign = mergeParts([
      paintMesh(box(scene, 0.035, 1.2, 0.035, 0, 0.35, 0.03), 0.6, 0.45, 0.3),
      paintMesh(box(scene, 0.62, 0.42, 0.02, 0, 1.05, 0.05), 1, 1, 1),
    ], 'sign');
    const mic = mergeParts([paintMesh(cyl(scene, 0.03, 0.022, 6, -0.18, -0.02, 0, 0, 0.04), 0.12, 0.12, 0.13), paintMesh(sphere(scene, 4, 0, 0.01, 0.04, 0.055, 0.055, 0.055), 0.45, 0.46, 0.48)], 'mic');
    this.holds = [
      P(phone, 'phone', {}), P(cup, 'cup', {}), P(brief, 'briefcase', {}), P(bag, 'bag', { colored: true }),
      P(flyer, 'flyer', {}), P(sign, 'sign', { colored: true }), P(mic, 'mic', {}),
    ];

    this.chars = new CharacterRenderer(scene, shadows);
  }

  /**
   * Called every frame. `scale` (>= 1) enlarges the instanced figures uniformly.
   * `realDt` (optional, seconds) drives fades and speed estimates when `timeSec`
   * does not advance in real time (e.g. a frozen bench); defaults to the change of `timeSec`.
   */
  update(people: PersonVisual[], timeSec: number, scale: number, realDt?: number): void {
    const animDt = this.lastT < 0 ? 0 : clamp(timeSec - this.lastT, 0, 0.1);
    const dt = realDt !== undefined ? clamp(realDt, 0, 0.1) : animDt;
    this.lastT = timeSec;
    this.frame++;
    for (const p of this.parts) p.begin();
    const min = this.min.set(Infinity, Infinity, Infinity);
    const max = this.max.set(-Infinity, -Infinity, -Infinity);
    const S = Math.max(1, scale);

    // ---- which people are drawn in detail
    const chars = this.chars;
    const cam = this.scene.activeCamera;
    // the instanced figures get enlarged when the camera is far; detailed ones
    // are true size, so they only appear while that enlargement is negligible
    this.detailOn = this.detail && chars.ready && !!cam && (this.detailOn ? S < 1.3 : S < 1.2);
    const lod = this.lod;
    const frame = this.frame;
    if (this.detailOn || lod.size) this.selectDetail(people, cam ? cam.globalPosition : null, cam ? cam.getDirection(Vector3.Forward()) : null);
    if (lod.size) chars.begin();

    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const st = lod.size ? lod.get(p.id) : undefined;
      let fade = 0;
      if (st) {
        st.frame = frame;
        if (animDt > 0) {
          const v = Math.hypot(p.x - st.px, p.y - st.py) / animDt;
          st.speed += (Math.min(v, 30) - st.speed) * Math.min(1, dt * 6);
        }
        st.px = p.x; st.py = p.y;
        st.fade = clamp(st.fade + (st.target ? dt : -dt) / FADE_S, 0, 1);
        fade = st.fade;
        // the instanced figure stays until the detailed one is fully faded in and renderable
        if (fade > 0 && !chars.draw(p, fade, p.moving ? st.speed : 0, animDt, dt, timeSec)) fade = 0;
      }
      if (fade < 1) this.person(p, timeSec, S);
      else if (p.highlight) this.ringFor(p, 0.62);
      if (p.x < min.x) min.x = p.x;
      if (p.x > max.x) max.x = p.x;
      if (p.z < min.y) min.y = p.z;
      if (p.z > max.y) max.y = p.z;
      if (p.y < min.z) min.z = p.y;
      if (p.y > max.z) max.z = p.y;
    }
    if (lod.size) {
      chars.end();
      for (const [id, st] of lod) if (st.frame !== frame || (!st.target && st.fade <= 0)) lod.delete(id);
    }
    const pad = 2.4 * S;
    min.x -= pad; min.y -= pad; min.z -= pad;
    max.x += pad; max.y += pad; max.z += pad;
    for (const p of this.parts) p.finish(min, max);
    if (this.tints.size > people.length * 2 + 256) this.tints.clear();
  }

  /** If a scene pick hit one of the people meshes, return that person's id, else -1. */
  pickedId(pick: PickingInfo): number {
    if (!pick || !pick.hit) return -1;
    const d = this.chars.pickedId(pick);
    if (d >= 0) return d;
    for (const p of this.pickParts) {
      const id = p.idAt(pick);
      if (id >= 0) return id;
    }
    return -1;
  }

  /** The detailed-character renderer (debug access). */
  get characters(): CharacterRenderer {
    return this.chars;
  }

  /** Number of people drawn as detailed characters last frame. */
  get detailedCount(): number {
    return this.chars.count;
  }

  /** True once the character pack has loaded (or false while loading / if it failed). */
  get detailReady(): boolean {
    return this.chars.ready;
  }

  /** All meshes (e.g. for a picking predicate or a render list). */
  get meshes(): Mesh[] {
    return [...this.parts.map((p) => p.mesh), ...this.chars.meshes];
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.pickParts = [];
    this.tints.clear();
    this.chars.dispose();
    this.lod.clear();
  }

  // ------------------------------------------------------------ level of detail

  private selectDetail(people: PersonVisual[], cp: Vector3 | null, fwd: Vector3 | null): void {
    const lod = this.lod;
    const cands = this.cands;
    cands.length = 0;
    if (this.detailOn && cp && fwd) {
      let D = this.candD;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const dx = p.x - cp.x, dy = p.z + 1 - cp.y, dz = p.y - cp.z;
        const st = lod.get(p.id);
        const r = (st && st.target ? this.detailOut : this.detailIn) * (p.highlight ? 1.6 : 1);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) continue;
        let d = Math.sqrt(d2);
        if (dx * fwd.x + dy * fwd.y + dz * fwd.z < 0) d *= 1.5; // behind the camera
        if (st && st.target) d *= 0.85; // keep who is already detailed
        if (p.highlight) d *= 0.2;
        if (cands.length >= D.length) { const n = new Float64Array(D.length * 2); n.set(D); D = this.candD = n; }
        D[cands.length] = d;
        cands.push(i);
      }
      if (cands.length > this.detailMax) {
        const order = cands.map((_, k) => k);
        order.sort((a, b) => D[a] - D[b]);
        const sorted = order.map((k) => cands[k]);
        for (let k = 0; k < sorted.length; k++) cands[k] = sorted[k];
      }
    }
    for (const st of lod.values()) st.target = false;
    const n = Math.min(this.detailMax, cands.length);
    for (let k = 0; k < n; k++) {
      const p = people[cands[k]];
      let st = lod.get(p.id);
      if (!st) {
        st = { target: true, fade: 0, speed: p.moving ? 1.3 : 0, px: p.x, py: p.y, frame: this.frame };
        lod.set(p.id, st);
      }
      st.target = true;
    }
  }

  // ------------------------------------------------------------ internals

  private tint(p: PersonVisual): Tint {
    let t = this.tints.get(p.id);
    const look = characterLook(p, t?.look);
    if (!t || t.key !== look.key) {
      const rgb = t ? t.rgb : new Float32Array(NSLOT * 3);
      const hatRgb = t ? t.hatRgb : new Float32Array(3);
      const pal = look.pal;
      const role = (slot: number, r: number) => {
        rgb[slot * 3] = pal[r * 4] / 255; rgb[slot * 3 + 1] = pal[r * 4 + 1] / 255; rgb[slot * 3 + 2] = pal[r * 4 + 2] / 255;
      };
      const [, body, legs] = look.combo.map((c) => c.slice(c.indexOf('_') + 1));
      role(SKIN_C, ROLE.skin);
      role(SHIRT_C, body === 'hivis' ? ROLE.vest : body === 'overall' ? ROLE.pants : ROLE.top);
      role(SLEEVE_C, LONG_SLEEVES.has(body) ? ROLE.top : ROLE.skin);
      role(ARM_C, ROLE.top);
      role(PANTS_C, ROLE.pants);
      role(THIGH_C, ROLE.pants);
      role(SHIN_C, BARE_SHINS.has(legs) ? ROLE.skin : ROLE.pants);
      role(SHOE_C, ROLE.shoe);
      let hat = 0;
      if (look.hat === 'chef') { hat = 1; hexInto('#f3f3ef', hatRgb); }
      else if (look.hat === 'police') { hat = 2; hexInto(POLICE_NAVY, hatRgb); }
      else if (look.hat === 'hard') { hat = 3; hexInto(look.hatColor, hatRgb); }
      t = { key: look.key, look, rgb, hat, hatRgb, apron: look.apron };
      this.tints.set(p.id, t);
    }
    return t;
  }

  /** Write a part instance: local frame R (unit axes) scaled by sx/sy/sz at local origin o. */
  private put(part: InstancedPart, slot: number, R: M3, sx: number, sy: number, sz: number, o: V3, color?: ArrayLike<number>): void {
    const M = this.M, T = this.T;
    const i = part.add(this.pid);
    const ax = R[0] * sx, ay = R[1] * sx, az = R[2] * sx;
    const bx = R[3] * sy, by = R[4] * sy, bz = R[5] * sy;
    const cx = R[6] * sz, cy = R[7] * sz, cz = R[8] * sz;
    writeMatrix(part.m, i,
      M[0] * ax + M[3] * ay + M[6] * az, M[1] * ax + M[4] * ay + M[7] * az, M[2] * ax + M[5] * ay + M[8] * az,
      M[0] * bx + M[3] * by + M[6] * bz, M[1] * bx + M[4] * by + M[7] * bz, M[2] * bx + M[5] * by + M[8] * bz,
      M[0] * cx + M[3] * cy + M[6] * cz, M[1] * cx + M[4] * cy + M[7] * cz, M[2] * cx + M[5] * cy + M[8] * cz,
      T.x + M[0] * o.x + M[3] * o.y + M[6] * o.z,
      T.y + M[1] * o.x + M[4] * o.y + M[7] * o.z,
      T.z + M[2] * o.x + M[5] * o.y + M[8] * o.z,
    );
    const c = part.c;
    if (c) {
      let r: number, g: number, b: number;
      if (color) { r = color[0]; g = color[1]; b = color[2]; } else {
        const rgb = this.rgb;
        r = rgb[slot * 3]; g = rgb[slot * 3 + 1]; b = rgb[slot * 3 + 2];
      }
      if (this.hl) {
        r += (1 - r) * 0.3; g += (1 - g) * 0.3; b += (1 - b) * 0.2;
      }
      c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = 1;
    }
  }

  /**
   * Limb segment from joint a to joint b (geometry hangs along local -Y from
   * 0 to -1). `ref` column 0 (its local right) fixes the twist. Leaves the unit
   * frame in this.seg.
   */
  private limb(part: InstancedPart, slot: number, a: V3, b: V3, tx: number, tz: number, ext: number, ref: M3): void {
    const F = this.seg;
    let yx = a.x - b.x, yy = a.y - b.y, yz = a.z - b.z;
    const len = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1e-6;
    yx /= len; yy /= len; yz /= len;
    let rx = ref[0], ry = ref[1], rz = ref[2];
    let d = rx * yx + ry * yy + rz * yz;
    if (d > 0.92 || d < -0.92) {
      rx = ref[6]; ry = ref[7]; rz = ref[8];
      d = rx * yx + ry * yy + rz * yz;
    }
    let xx = rx - d * yx, xy = ry - d * yy, xz = rz - d * yz;
    const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1e-6;
    xx /= xl; xy /= xl; xz /= xl;
    F[0] = xx; F[1] = xy; F[2] = xz;
    F[3] = yx; F[4] = yy; F[5] = yz;
    F[6] = xy * yz - xz * yy; F[7] = xz * yx - xx * yz; F[8] = xx * yy - xy * yx; // z = x cross y
    this.put(part, slot, F, tx, len + ext, tz, a);
  }

  /** Two-bone IK: elbow/knee position `el` and end `wr` for a target, bending toward `pole`. */
  private ik(s: V3, tx: number, ty: number, tz: number, l1: number, l2: number, px: number, py: number, pz: number, el: V3, wr: V3): void {
    let dx = tx - s.x, dy = ty - s.y, dz = tz - s.z;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    dx /= dist; dy /= dist; dz /= dist;
    dist = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.995);
    const ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const h = l1 * Math.sqrt(Math.max(0, 1 - ca * ca));
    const pd = px * dx + py * dy + pz * dz;
    let qx = px - pd * dx, qy = py - pd * dy, qz = pz - pd * dz;
    let ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (ql < 1e-5) { qx = 0; qy = -1; qz = 0; ql = 1; }
    qx /= ql; qy /= ql; qz /= ql;
    el.set(s.x + dx * l1 * ca + qx * h, s.y + dy * l1 * ca + qy * h, s.z + dz * l1 * ca + qz * h);
    wr.set(s.x + dx * dist, s.y + dy * dist, s.z + dz * dist);
  }

  private ringFor(p: PersonVisual, r: number): void {
    const i = this.ring.add(p.id);
    writeMatrix(this.ring.m, i, r, 0, 0, 0, r, 0, 0, 0, r, p.x, p.z + 0.05, p.y);
  }

  private person(p: PersonVisual, t: number, S: number): void {
    const L = p.looks;
    const k = clamp(L.height || 1.75, 1.3, 2.2) / 1.75;
    const bw = clamp(L.build || 1, 0.7, 1.35);
    const tint = this.tint(p);
    this.rgb = tint.rgb;
    this.hl = p.highlight;
    this.pid = p.id;
    const R = this.R;
    this.rig(p, t, k);

    // ---- legs (body space, independent of the pelvis tilt)
    const hipX = 0.088 * k * bw;
    const thighL = THIGH * k, shinL = SHIN * k, ankleH = ANKLE * k;
    let minY = Infinity;
    for (let s = 0; s < 2; s++) {
      const sign = s ? 1 : -1;
      const hip = this.hipJ[s].set(R.px + sign * hipX, R.py, R.pz);
      mul(this.Rthigh, rotX(this.t0, R.swing[s]), rotZ(this.t1, sign * R.abd[s]));
      off(this.kneeJ[s], hip, this.Rthigh, 0, -thighL, 0);
      mul(this.Rshin, this.Rthigh, rotX(this.t0, -R.knee[s]));
      const ank = off(this.ankleJ[s], this.kneeJ[s], this.Rshin, 0, -shinL, 0);
      const Rf = mul(this.footR[s], rotY(this.t0, sign * 0.1), rotX(this.t1, R.foot[s]));
      // sole: heel and toe
      const hy = ank.y + Rf[4] * -ankleH + Rf[7] * -0.06 * k;
      const ty = ank.y + Rf[4] * -ankleH + Rf[7] * 0.2 * k;
      minY = Math.min(minY, hy, ty);
    }

    // ---- root transform: body space -> world
    const th = Math.PI / 2 - p.heading;
    const M = this.M, T = this.T;
    rotY(this.t2, th);
    if (R.lying) {
      mul(M, this.t2, rotX(this.t3, Math.PI / 2));
      for (let i = 0; i < 9; i++) M[i] *= S;
      // pivot at the hips, back resting on the surface at z
      const lift = 0.115 * k * bw + 0.015;
      T.set(p.x - M[3] * R.py, p.z + S * lift - M[4] * R.py, p.y - M[5] * R.py);
    } else {
      for (let i = 0; i < 9; i++) M[i] = this.t2[i] * S;
      const shift = R.grounded ? -minY : 0;
      T.set(p.x + M[3] * shift, p.z + M[4] * shift, p.y + M[5] * shift);
    }

    // legs
    for (let s = 0; s < 2; s++) {
      this.limb(this.thigh, THIGH_C, this.hipJ[s], this.kneeJ[s], 0.16 * k * bw, 0.165 * k * bw, 0.03 * k, IDENT);
      this.limb(this.shin, SHIN_C, this.kneeJ[s], this.ankleJ[s], 0.12 * k * bw, 0.125 * k * bw, 0.02 * k, IDENT);
      const Rf = this.footR[s];
      off(this.a, this.ankleJ[s], Rf, 0, 0.02 * k, 0);
      this.put(this.shoe, SHOE_C, Rf, 0.105 * k * bw, ankleH + 0.02 * k, 0.27 * k, this.a);
    }

    // pelvis, torso, neck, head
    const Rp = rotX(this.Rp, -R.pitch);
    const pel = this.pel.set(R.px, R.py, R.pz);
    off(this.a, pel, Rp, 0, 0.035 * k, 0);
    this.put(this.pelvis, PANTS_C, Rp, 0.33 * k * bw, 0.2 * k, 0.215 * k * bw, this.a);
    const waist = off(this.waist, pel, Rp, 0, 0.12 * k, 0);
    mul(this.t3, rotY(this.t0, R.twist), rotZ(this.t1, R.roll));
    mul(this.t2, rotX(this.t0, -R.lean), this.t3);
    const Rt = mul(this.Rt, Rp, this.t2);
    this.put(this.torso, SHIRT_C, Rt, 0.4 * k * bw, 0.385 * k, 0.225 * k * bw, waist);
    if (tint.apron >= 0) {
      hexInto(APRON_RGB[tint.apron], this.cbuf);
      off(this.a, waist, Rt, 0, 0.0, 0.118 * k * bw);
      this.put(this.apron, 0, Rt, 0.4 * k * bw, 0.4 * k, 1, this.a, this.cbuf);
    }
    const neckB = off(this.neckB, waist, Rt, 0, 0.36 * k, 0);
    mul(this.t2, rotY(this.t0, R.yaw), rotX(this.t1, -R.nod));
    const Rh = mul(this.Rh, Rt, this.t2);
    rotX(this.t0, -R.nod * 0.4);
    mul(this.t1, Rt, this.t0);
    this.put(this.neck, SKIN_C, this.t1, 0.1 * k, 0.14 * k, 0.105 * k, neckB);
    const headC = off(this.headC, neckB, Rh, 0, 0.2 * k, 0.012 * k);
    const hw = 0.168 * k, hh = 0.23 * k, hd = 0.205 * k;
    this.put(this.head, SKIN_C, Rh, hw, hh, hd, headC);

    // hat (no hair: everyone has the same bare head)
    if (tint.hat) {
      const hs = hw * 0.5;
      off(this.a, headC, Rh, 0, tint.hat === 3 ? 0.02 * k : 0, 0);
      this.put(this.hats[tint.hat - 1], 0, Rh, hs * 1.05, hs, hs * 1.08, this.a, tint.hatRgb);
    }

    // arms
    const shX = 0.178 * k * bw, shY = 0.335 * k;
    const ua = UPPER_ARM * k, fa = FOREARM * k;
    for (let s = 0; s < 2; s++) {
      const sign = s ? 1 : -1;
      const sh = off(this.sh, waist, Rt, sign * shX, shY, 0);
      const el = this.el, wr = this.wr[s];
      if (R.ik[s]) {
        const o = s * 3;
        this.ik(sh, waist.x + R.tgt[o], waist.y + R.tgt[o + 1], waist.z + R.tgt[o + 2], ua, fa,
          R.pole[o], R.pole[o + 1], R.pole[o + 2], el, wr);
      } else {
        mul(this.t2, rotX(this.t0, R.aSwing[s]), rotZ(this.t1, sign * R.aAbd[s]));
        mul(this.t3, this.t2, rotY(this.t0, -sign * R.aTwist[s]));
        const Rup = mul(this.Rup, Rt, this.t3);
        off(el, sh, Rup, 0, -ua, 0);
        const Rlo = mul(this.Rlo, Rup, rotX(this.t0, R.elbow[s]));
        off(wr, el, Rlo, 0, -fa, 0);
      }
      this.limb(this.upperArm, ARM_C, sh, el, 0.105 * k * bw, 0.105 * k * bw, 0.02 * k, Rt);
      this.limb(this.forearm, SLEEVE_C, el, wr, 0.085 * k * bw, 0.085 * k * bw, 0.015 * k, Rt);
      const F = this.seg;
      this.handF[s].set(F);
      this.put(this.hand, SKIN_C, F, 0.042 * k, 0.1 * k, 0.085 * k, wr);
      if (R.hammer === s) this.put(this.hammer, 0, F, k, k, k, wr);
    }

    // props
    if (R.box) {
      const w0 = this.wr[0], w1 = this.wr[1];
      this.a.set((w0.x + w1.x) / 2, (w0.y + w1.y) / 2 + 0.01 * k, (w0.z + w1.z) / 2 + 0.01 * k);
      this.put(this.crate, 0, IDENT, Math.max(0.2, Math.abs(w1.x - w0.x) - 0.045 * k), 0.26 * k, 0.3 * k, this.a);
    }
    if (R.tray) {
      const w = this.wr[1];
      this.a.set(w.x + 0.03 * k, w.y + 0.085 * k, w.z + 0.02 * k);
      this.put(this.tray, 0, IDENT, k, k, k, this.a);
    }
    if (R.hold !== Hold.None) {
      const w = this.wr[1];
      switch (R.hold) {
        case Hold.Phone: this.put(this.holds[0], 0, this.handF[1], k, k, k, w); break;
        case Hold.Cup: this.put(this.holds[1], 0, IDENT, k, k, k, this.a.set(w.x, w.y, w.z)); break;
        case Hold.Briefcase: this.put(this.holds[2], 0, IDENT, k, k, k, this.a.set(w.x, w.y - 0.05 * k, w.z)); break;
        case Hold.Bag:
          hexInto(BAG_RGB[Math.floor(hashf(p.id * 3) * BAG_RGB.length)], this.cbuf);
          this.put(this.holds[3], 0, IDENT, k, k, k, this.a.set(w.x, w.y - 0.05 * k, w.z), this.cbuf);
          break;
        case Hold.Tool: this.put(this.hammer, 0, this.handF[1], k, k, k, w); break;
        case Hold.Flyer: this.put(this.holds[4], 0, this.handF[1], k, k, k, w); break;
        case Hold.Sign:
          hexInto(SIGN_RGB[Math.floor(hashf(p.id * 5) * SIGN_RGB.length)], this.cbuf);
          this.put(this.holds[5], 0, IDENT, k, k, k, this.a.set(w.x, w.y - 0.3 * k, w.z), this.cbuf);
          break;
        case Hold.Mic: this.put(this.holds[6], 0, this.handF[1], k, k, k, w); break;
      }
    }
    if (p.highlight) this.ringFor(p, 1.05 * S);
  }

  private cbuf = new Float32Array(3);

  // ------------------------------------------------------------- poses

  private rig(p: PersonVisual, t: number, k: number): void {
    const R = this.R;
    const id = p.id;
    const ph = hashf(id) * TAU;
    const hv = hashf(id * 7 + 3);
    // defaults: relaxed standing with a little idle motion
    R.grounded = true; R.lying = false;
    R.px = 0.012 * Math.sin(t * 0.37 + ph); R.py = HIP * k; R.pz = 0; R.pitch = 0;
    R.lean = 0.03 + 0.012 * Math.sin(t * 1.4 + ph); R.twist = 0; R.roll = 0;
    R.nod = 0.03; R.yaw = 0.45 * Math.sin(t * 0.23 + ph) * Math.max(0, Math.sin(t * 0.13 + ph * 2));
    for (let s = 0; s < 2; s++) {
      R.swing[s] = 0; R.abd[s] = 0.04; R.knee[s] = 0.04; R.foot[s] = 0;
      R.ik[s] = 0; R.aSwing[s] = 0.05; R.aAbd[s] = 0.1; R.aTwist[s] = 0.1;
      R.elbow[s] = 0.16 + 0.05 * Math.sin(t * 0.8 + ph + s);
    }
    R.box = false; R.tray = false; R.hammer = -1; R.hold = Hold.None; R.rest = false;

    const pose = p.pose;
    const seated = SEATED_POSES.has(pose) || (!!p.seated && pose !== 'sleep');
    const walking = p.moving && !seated && pose !== 'sleep';
    if (walking) this.walk(t, ph, id);
    const talking = !!p.talking;

    switch (pose) {
      case 'talk':
        this.gesture(1 - (hv < 0.5 ? 0 : 1), t, ph, walking);
        break;
      case 'carry':
        this.carryArms(k);
        break;
      case 'serve': {
        R.ik[1] = 1;
        R.tgt[3] = 0.29 * k; R.tgt[4] = 0.32 * k; R.tgt[5] = 0.14 * k;
        R.pole[3] = 1; R.pole[4] = -0.9; R.pole[5] = -0.3;
        R.tray = true;
        R.yaw *= 0.4;
        break;
      }
      case 'cook': {
        const w = t * 3.4 + ph;
        R.lean = 0.1; R.nod = 0.35; R.yaw = 0;
        this.setIK(1, (0.08 + 0.06 * Math.cos(w)) * k, -0.02 * k, (0.4 + 0.05 * Math.sin(w)) * k, 0.7, -0.7, -0.2);
        this.setIK(0, -0.2 * k, -0.04 * k, 0.36 * k, -0.7, -0.7, -0.2);
        break;
      }
      case 'manual': {
        R.lean = 0.16; R.nod = 0.38; R.yaw = 0.05 * Math.sin(t * 0.5 + ph);
        R.pz = -0.02 * k;
        this.setIK(0, -0.07 * k, -0.08 * k, 0.42 * k, -0.6, -0.6, -0.3);
        this.hammerArm(1, t, ph, 0.45, 0.7);
        break;
      }
      case 'build': {
        for (let s = 0; s < 2; s++) {
          R.swing[s] = 0.62 + (s ? 0.08 : -0.04); R.knee[s] = 1.15 + (s ? 0.15 : 0); R.abd[s] = 0.12;
          R.foot[s] = R.knee[s] - R.swing[s] - 0.45; // keep the feet near flat (shin tilt partly absorbed)
        }
        R.pz = -0.08 * k;
        R.lean = 0.42; R.nod = 0.15; R.yaw = 0;
        this.setIK(0, -0.06 * k, -0.3 * k, 0.48 * k, -0.6, -0.4, -0.4);
        this.hammerArm(1, t, ph, 0.25, 0.6);
        break;
      }
      case 'gather': {
        const cyc = (t / 3.2 + ph / TAU) % 1;
        const b = 0.5 - 0.5 * Math.cos(cyc * TAU);
        R.lean = 0.25 + 0.85 * b;
        R.pitch = 0.35 * b;
        R.pz = -0.1 * k * b;
        R.nod = 0.1 - 0.2 * b;
        R.yaw = 0;
        for (let s = 0; s < 2; s++) {
          R.swing[s] = 0.08 + 0.3 * b; R.knee[s] = 0.12 + 0.45 * b; R.abd[s] = 0.1;
          R.foot[s] = 0;
          R.ik[s] = 0;
          R.aSwing[s] = R.lean + R.pitch + 0.15 + 0.25 * b + (s ? 0.2 * Math.sin(cyc * TAU * 2) * b : 0);
          R.aAbd[s] = 0.15; R.aTwist[s] = 0.2;
          R.elbow[s] = 0.25 + 0.2 * (1 - b);
        }
        break;
      }
      case 'sleep': {
        R.grounded = false; R.lying = true;
        R.px = 0; R.lean = 0.01 * Math.sin(t * 1.1 + ph); R.nod = -0.08; R.yaw = 0.35 * (hv - 0.5);
        for (let s = 0; s < 2; s++) {
          R.swing[s] = 0.02; R.abd[s] = 0.06; R.knee[s] = 0.06; R.foot[s] = -0.25;
          R.aSwing[s] = 0.05; R.aAbd[s] = 0.13; R.aTwist[s] = 0.1; R.elbow[s] = 0.15;
        }
        break;
      }
      case 'speech': {
        // emphatic: one arm rises and chops down, the other rests forward, head sweeps the crowd
        const cyc = (t * 0.45 + ph / TAU) % 1;
        const up = Math.max(0, Math.sin(cyc * TAU));
        this.setIK(1, 0.24 * k, (0.24 + 0.3 * up) * k, (0.3 + 0.05 * up) * k, 0.8, -0.6, -0.3);
        this.setIK(0, -0.24 * k, (0.2 + 0.16 * Math.max(0, Math.sin(cyc * TAU + 2.2))) * k, 0.3 * k, -0.8, -0.6, -0.3);
        R.yaw = 0.35 * Math.sin(t * 0.5 + ph); R.nod = -0.02; R.lean = 0.06;
        break;
      }
      case 'cheer': {
        const cyc = (t * 0.2 + ph / TAU) % 1;
        if (cyc > 0.72 && cyc < 0.92) {
          const u = Math.sin((cyc - 0.72) / 0.2 * Math.PI);
          this.setIK(0, -0.22 * k, (0.62 + 0.25 * u) * k, 0.1 * k, -0.8, 0.2, -0.6);
          this.setIK(1, 0.22 * k, (0.62 + 0.25 * u) * k, 0.1 * k, 0.8, 0.2, -0.6);
          R.py += 0.03 * k * u;
        } else {
          const d = (0.02 + 0.08 * Math.abs(Math.sin(t * 5.3 + ph))) * k;
          this.setIK(0, -d, 0.27 * k, 0.3 * k, -0.8, -0.5, -0.4);
          this.setIK(1, d, 0.27 * k, 0.3 * k, 0.8, -0.5, -0.4);
        }
        R.nod = -0.06; R.yaw *= 0.3;
        break;
      }
      case 'protest':
        this.signArms(k, t, ph);
        break;
      case 'vote': {
        R.lean = 0.16; R.nod = 0.5; R.yaw = 0;
        this.setIK(1, (0.1 + 0.015 * Math.sin(t * 9 + ph)) * k, -0.04 * k, (0.38 + 0.012 * Math.cos(t * 7)) * k, 0.7, -0.6, -0.4);
        this.setIK(0, -0.12 * k, -0.05 * k, 0.36 * k, -0.7, -0.6, -0.4);
        R.hold = Hold.Flyer;
        break;
      }
      default:
        break;
    }
    if (seated && pose !== 'sleep') this.seated(p, t, ph, k, hv);
    // things in hand (unless the pose already uses the right hand)
    const hold = pose === 'phone' ? Hold.Phone : pose === 'protest' ? Hold.Sign : HOLD[p.holding ?? ''] ?? Hold.None;
    if (hold !== Hold.None && (!R.ik[1] || R.rest) && R.hammer < 0 && !R.tray && pose !== 'vote') {
      R.hold = hold;
      switch (hold) {
        case Hold.Phone:
          if (talking && !seated) this.setIK(1, 0.12 * k, 0.62 * k, 0.02 * k, 0.7, -0.6, -0.3); // a call
          else {
            this.setIK(1, 0.05 * k, (seated ? 0.24 : 0.28) * k, 0.3 * k, 0.7, -0.7, -0.3);
            if (!walking && (!R.ik[0] || R.rest)) this.setIK(0, -0.03 * k, (seated ? 0.22 : 0.26) * k, 0.28 * k, -0.7, -0.7, -0.3);
            R.nod = 0.5; R.yaw = 0;
          }
          break;
        case Hold.Cup: {
          const cyc = (t / 6 + ph / TAU) % 1;
          const up = cyc < 0.12 ? smooth(cyc / 0.12) : cyc < 0.3 ? 1 : cyc < 0.42 ? 1 - smooth((cyc - 0.3) / 0.12) : 0;
          this.setIK(1, (0.12 - 0.08 * up) * k, (0.2 + 0.35 * up) * k, (0.25 - 0.1 * up) * k, 0.8, -0.8, -0.2);
          break;
        }
        case Hold.Flyer:
          this.setIK(1, 0.16 * k, 0.22 * k, 0.3 * k, 0.8, -0.6, -0.3);
          break;
        case Hold.Mic:
          this.setIK(1, 0.06 * k, 0.55 * k, 0.17 * k, 0.6, -0.8, -0.2);
          break;
        case Hold.Sign:
          this.signArms(k, t, ph);
          break;
        default: // briefcase, bag, tool: hang from the right hand
          R.elbow[1] = Math.min(R.elbow[1], 0.15);
          R.aSwing[1] *= 0.5;
          break;
      }
    } else if (talking && !walking && pose !== 'talk' && pose !== 'speech' && (!R.ik[1] || R.rest) && R.hammer < 0) {
      this.gesture(1, t, ph, false);
    }
    if (p.carrying && !seated && pose !== 'sleep' && pose !== 'serve' && pose !== 'carry' && R.hold === Hold.None) this.carryArms(k);
  }

  private gesture(s: number, t: number, ph: number, walking: boolean): void {
    const R = this.R;
    R.ik[s] = 0;
    R.aSwing[s] = 0.32 + 0.16 * Math.sin(t * 2.1 + ph);
    R.aAbd[s] = 0.22 + 0.1 * Math.sin(t * 1.6 + ph);
    R.elbow[s] = 1.45 + 0.3 * Math.sin(t * 3.0 + ph * 1.3);
    R.aTwist[s] = 0.35;
    if (!walking) {
      R.nod = 0.04 + 0.06 * Math.sin(t * 3.6 + ph);
      R.yaw = 0.18 * Math.sin(t * 0.8 + ph);
    }
  }

  private signArms(k: number, t: number, ph: number): void {
    const pump = 0.05 * Math.sin(t * 2.6 + ph) * k;
    this.setIK(1, 0.05 * k, 0.62 * k + pump, 0.2 * k, 0.8, -0.3, -0.5);
    this.setIK(0, 0.0, 0.34 * k + pump, 0.22 * k, -0.8, -0.5, -0.4);
    this.R.hold = Hold.Sign;
    this.R.nod = -0.08;
  }

  private setIK(s: number, x: number, y: number, z: number, px: number, py: number, pz: number): void {
    const R = this.R, o = s * 3;
    R.ik[s] = 1;
    R.tgt[o] = x; R.tgt[o + 1] = y; R.tgt[o + 2] = z;
    R.pole[o] = px; R.pole[o + 1] = py; R.pole[o + 2] = pz;
  }

  private carryArms(k: number): void {
    this.setIK(0, -0.19 * k, 0.02 * k, 0.34 * k, -0.6, -0.6, -0.5);
    this.setIK(1, 0.19 * k, 0.02 * k, 0.34 * k, 0.6, -0.6, -0.5);
    this.R.box = true;
    this.R.yaw *= 0.3;
  }

  /** Hammering: slow raise, fast strike. */
  private hammerArm(s: number, t: number, ph: number, swing0: number, elbow0: number): void {
    const R = this.R;
    const cyc = (t * 1.25 + ph / TAU) % 1;
    const u = cyc < 0.7 ? smooth(cyc / 0.7) : 1 - Math.pow((cyc - 0.7) / 0.3, 0.7);
    R.ik[s] = 0;
    R.aSwing[s] = swing0 + 0.95 * u;
    R.aAbd[s] = 0.18;
    R.aTwist[s] = 0.25;
    R.elbow[s] = elbow0 + 1.25 * u;
    R.hammer = s;
  }

  private walk(t: number, ph: number, id: number): void {
    const R = this.R;
    const f = 0.9 + 0.14 * hashf(id * 3 + 1); // strides per second
    const th = t * f * TAU + ph;
    for (let s = 0; s < 2; s++) {
      const a = th + (s ? Math.PI : 0);
      const sn = Math.sin(a), cs = Math.cos(a);
      R.swing[s] = 0.36 * sn;
      R.knee[s] = 0.07 + 0.75 * Math.max(0, cs) * (0.6 + 0.4 * Math.max(0, -sn + 0.3));
      R.abd[s] = 0.025;
      R.foot[s] = 0.55 * (R.swing[s] - R.knee[s]) + 0.08;
      R.ik[s] = 0;
      R.aSwing[s] = -0.34 * sn;
      R.aAbd[s] = 0.09;
      R.aTwist[s] = 0.12;
      R.elbow[s] = 0.28 + 0.32 * Math.max(0, -sn);
    }
    R.twist = 0.07 * Math.sin(th);
    R.lean = 0.07;
    R.px = 0.012 * Math.sin(th);
    R.nod = 0.04;
    R.yaw *= 0.25;
  }

  private seated(p: PersonVisual, t: number, ph: number, k: number, hv: number): void {
    const R = this.R;
    R.grounded = false;
    R.px = 0;
    R.py = SEAT + 0.075 * k;
    R.pz = -0.03 * k;
    R.twist = 0;
    const kneeY = (SHIN + ANKLE) * k;
    const sw = Math.acos(clamp((R.py - kneeY) / (THIGH * k), -0.6, 1));
    for (let s = 0; s < 2; s++) {
      R.swing[s] = sw + 0.02;
      R.abd[s] = 0.07;
      R.knee[s] = sw - (s === (hv < 0.5 ? 0 : 1) ? 0.22 : 0);
      R.foot[s] = 0;
    }
    const waistY = R.py + 0.12 * k;
    const desk = DESK - waistY; // desk height relative to the waist
    R.lean = 0.02;
    switch (p.pose) {
      case 'type': {
        R.lean = 0.1; R.nod = 0.12; R.yaw = 0.06 * Math.sin(t * 0.4 + ph);
        for (let s = 0; s < 2; s++) {
          const sign = s ? 1 : -1;
          const tap = 0.012 * Math.max(0, Math.sin(t * 15 + ph + s * 2.1)) * (0.5 + 0.5 * Math.sin(t * 0.9 + s));
          this.setIK(s, sign * 0.13 * k + 0.01 * Math.sin(t * 1.7 + s * 2 + ph), desk + 0.035 + tap, 0.4 * k, sign * 0.5, -1, -0.3);
        }
        break;
      }
      case 'eat': {
        R.lean = 0.12; R.nod = 0.1;
        this.setIK(0, -0.17 * k, desk + 0.04, 0.36 * k, -0.5, -1, -0.3);
        const cyc = (t / 4.5 + ph / TAU) % 1;
        const up = cyc < 0.15 ? smooth(cyc / 0.15) : cyc < 0.42 ? 1 : cyc < 0.6 ? 1 - smooth((cyc - 0.42) / 0.18) : 0;
        const tx = 0.17 * k, ty = desk + 0.04, tz = 0.36 * k;
        const mx = 0.05 * k, my = 0.42 * k, mz = 0.2 * k;
        this.setIK(1, tx + (mx - tx) * up, ty + (my - ty) * up, tz + (mz - tz) * up, 0.6, -1, -0.1);
        R.nod = 0.1 - 0.12 * up;
        break;
      }
      case 'drive': {
        R.lean = -0.1; R.nod = -0.08; R.yaw *= 0.2;
        const turn = 0.03 * Math.sin(t * 0.7 + ph);
        this.setIK(0, -0.17 * k, 0.26 * k + turn, 0.42 * k, -0.6, -0.8, -0.2);
        this.setIK(1, 0.17 * k, 0.26 * k - turn, 0.42 * k, 0.6, -0.8, -0.2);
        break;
      }
      case 'watch': // leaning back, eyes on the screen, hands in the lap
        R.lean = -0.12; R.nod = -0.04; R.yaw *= 0.15;
        this.setIK(0, -0.1 * k, -0.04 * k, 0.26 * k, -0.4, -0.6, -1);
        this.setIK(1, 0.1 * k, -0.04 * k, 0.26 * k, 0.4, -0.6, -1);
        break;
      default: {
        if (R.ik[0] || R.ik[1]) break; // pose arms already set (phone, talk...)
        // hands resting on the thighs
        R.lean = -0.03;
        R.rest = true;
        this.setIK(0, -0.13 * k, -0.02 * k, 0.3 * k, -0.4, -0.6, -1);
        this.setIK(1, 0.13 * k, -0.02 * k, 0.3 * k, 0.4, -0.6, -1);
        break;
      }
    }
  }
}

const IDENT: M3 = m3();
