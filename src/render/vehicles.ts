// Low-poly cars, delivery vans and trucks drawn with thin instances (one mesh
// per part kind, per-instance body color, spinning wheels, night lights).
// Company trucks and vans carry a livery: the company's name, logo and brand
// color painted on the box or cargo sides and the rear doors (one small
// texture and one decal mesh per brand, shared by its whole fleet). Model
// space: x = right, y = up, z = forward, origin on the ground at the vehicle center.

import { Color3, Constants, DynamicTexture, Mesh, MeshBuilder, Texture, Vector3, VertexData } from '@babylonjs/core';
import type { PickingInfo, Scene, ShadowGenerator } from '@babylonjs/core';
import { InstancedPart, hashf, mergeParts, paintMesh, writeMatrix } from './people';
import type { PartOptions } from './people';
import { SKIN, carInto, clothInto, hexInto } from './palette';
import { Geo, Xf } from './buildingGeo';
import { LIVERY, liveryStyle, paintLivery, type LiveryStyle } from './adArt';

export interface VehicleVisual {
  id: number;
  kind: 'car' | 'truck' | 'van';
  x: number; y: number; z: number; heading: number;
  hue: number; // 0..1 body color
  speed: number; // m/s, for wheel spin (0 when parked)
  hasDriver: boolean; // draw a seated driver silhouette inside
  /** Company name painted on a truck or van (its livery); none = a plain vehicle. */
  brand?: string;
  /** Brand color of the livery (0..1), defaults to `hue`. */
  brandHue?: number;
}

/** Overall sizes (meters), handy for spacing/parking logic. */
export const VEHICLE_SIZE = {
  car: { length: 4.3, width: 1.8, height: 1.48 },
  van: { length: 6.0, width: 2.0, height: 2.52 },
  truck: { length: 7.6, width: 2.45, height: 3.4 },
} as const;

// ------------------------------------------------------------- geometry

type P3 = [number, number, number];

/**
 * Convex side profile [z0, y0, z1, y1, ...] extruded across x in [-w/2, w/2],
 * flat shaded. Winding is chosen per triangle from an outward hint.
 */
function prism(scene: Scene, prof: number[], w: number): Mesh {
  const pos: number[] = [];
  const n = prof.length / 2;
  let cz = 0, cy = 0;
  for (let i = 0; i < n; i++) { cz += prof[i * 2]; cy += prof[i * 2 + 1]; }
  cz /= n; cy /= n;
  const hw = w / 2;
  const tri = (a: P3, b: P3, c: P3, ox: number, oy: number, oz: number) => {
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
    const vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * ox + ny * oy + nz * oz >= 0) pos.push(...a, ...b, ...c);
    else pos.push(...a, ...c, ...b);
  };
  const pt = (i: number, x: number): P3 => [x, prof[(i % n) * 2 + 1], prof[(i % n) * 2]];
  for (const side of [-1, 1]) {
    for (let i = 1; i < n - 1; i++) tri(pt(0, side * hw), pt(i, side * hw), pt(i + 1, side * hw), side, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = pt(i, -hw), b = pt(i + 1, -hw), c = pt(i + 1, hw), d = pt(i, hw);
    const oz = (a[2] + b[2]) / 2 - cz, oy = (a[1] + b[1]) / 2 - cy;
    tri(a, b, c, 0, oy, oz);
    tri(a, c, d, 0, oy, oz);
  }
  const indices = pos.map((_, i) => i).slice(0, pos.length / 3);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, indices, normals);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = new Array((pos.length / 3) * 2).fill(0); // same attribute set as MeshBuilder parts (for merging)
  const m = new Mesh('prism', scene);
  vd.applyToMesh(m);
  return m;
}

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const m = MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/** Cylinder whose axis runs along x. */
function xcyl(scene: Scene, d: number, len: number, tess: number, x = 0, y = 0, z = 0): Mesh {
  const m = MeshBuilder.CreateCylinder('c', { diameter: d, height: len, tessellation: tess }, scene);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

function zcyl(scene: Scene, d: number, len: number, tess: number, x = 0, y = 0, z = 0): Mesh {
  const m = MeshBuilder.CreateCylinder('c', { diameter: d, height: len, tessellation: tess }, scene);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

const P = (m: Mesh, hex: string) => {
  const c = Color3.FromHexString(hex);
  return paintMesh(m, c.r, c.g, c.b);
};

// car layout
const CAR_WHEEL = { r: 0.33, w: 0.22, x: 0.8, z: [1.33, -1.36] };
const TRUCK_WHEEL = { r: 0.5, w: 0.32, x: 1.04, z: [2.85, -1.85, -3.0] };
const CAR_HEAD = { x: 0.58, y: 0.7, z: 2.2, w: 0.36, h: 0.12 };
const CAR_TAIL = { x: 0.62, y: 0.79, z: -2.19, w: 0.32, h: 0.13 };
const TRUCK_HEAD = { x: 0.86, y: 1.02, z: 3.84, w: 0.38, h: 0.17 };
const TRUCK_TAIL = { x: 1.0, y: 1.16, z: -3.775, w: 0.22, h: 0.18 };
const VAN_WHEEL = { r: 0.36, w: 0.24, x: 0.86, z: [1.95, -1.85] };
const VAN_HEAD = { x: 0.68, y: 0.84, z: 2.975, w: 0.36, h: 0.14 };
const VAN_TAIL = { x: 0.9, y: 1.02, z: -2.995, w: 0.14, h: 0.36 };
const VAN_PAINT = ['#f1f1ee', '#f1f1ee', '#e9e9e6', '#d5d8dc', '#c4c7ca', '#ece6d6'];
const SIDES = [-1, 1];
const CARGO = ['#f1efe9', '#e8e2d2', '#d5d8dc', '#c9cdd1', '#efe9dc'];

// greenhouse profiles (also used for the shadow proxies)
const CAR_GLASS = [0.74, 0.96, -1.32, 0.98, -0.98, 1.41, 0.06, 1.42];
const TRUCK_GLASS = [1.97, 1.84, 3.79, 1.84, 3.63, 2.73, 1.97, 2.73];
const VAN_GLASS = [2.04, 1.3, 1.38, 2.26, 0.62, 2.26, 0.62, 1.3];
const VAN_W = 1.98;

/** Livery decals: [x side, z rear, z front, y bottom, y top] of the side panels and the rear patch. */
const TRUCK_DECAL = { x: 1.237, z0: -3.66, z1: 1.78, y0: 1.04, y1: 3.34, rz: -3.732, rx: 1.15, ry0: 2.5, ry1: 3.16 };
const VAN_DECAL = { x: VAN_W / 2 + 0.012, z0: -2.84, z1: 0.42, y0: 0.78, y1: 2.36, rz: -2.985, rx: 0.75, ry0: 1.75, ry1: 2.18 };

interface Livery { key: string; tex: DynamicTexture; style: LiveryStyle; truck: InstancedPart | null; van: InstancedPart | null; seen: number }

export class VehicleRenderer {
  private parts: InstancedPart[] = [];
  private pickParts: InstancedPart[] = [];
  private carBody: InstancedPart; private carGlass: InstancedPart; private carTrim: InstancedPart; private carShadow: InstancedPart;
  private truckCab: InstancedPart; private truckBox: InstancedPart; private truckGlass: InstancedPart; private truckTrim: InstancedPart;
  private truckShadow: InstancedPart;
  private vanBody: InstancedPart; private vanGlass: InstancedPart; private vanTrim: InstancedPart; private vanShadow: InstancedPart;
  private wheel: InstancedPart;
  private liveries = new Map<string, Livery>();
  private scene: Scene;
  /** Max new livery textures painted per frame. */
  liveryBudget = 2;
  private headGlow: InstancedPart; private tailGlow: InstancedPart; private cone: InstancedPart;
  private driverHead: InstancedPart; private driverBody: InstancedPart;

  private dist = new Map<number, { d: number; seen: number }>();
  private frame = 0;
  private lastTime = -1;
  private min = new Vector3();
  private max = new Vector3();
  private col = new Float32Array(3);

  // current vehicle frame
  private ax = 1; private az = 0; // local x axis (cos, -sin)
  private fx = 0; private fz = 1; // local z axis
  private px = 0; private py = 0; private pz = 0;

  constructor(scene: Scene, shadows: ShadowGenerator | null) {
    this.scene = scene;
    const add = (mesh: Mesh, name: string, opts: PartOptions) => {
      mesh.name = 'vehicle-' + name;
      const p = new InstancedPart(mesh, scene, shadows, opts);
      this.parts.push(p);
      if (opts.pickable) this.pickParts.push(p);
      return p;
    };
    const tinted = { colored: true, pickable: true };

    // ---- car
    const carBody = mergeParts([
      prism(scene, [-2.12, 0.3, 2.1, 0.3, 2.2, 0.48, 2.17, 0.74, 1.92, 0.86, 0.76, 0.98, -1.36, 1.0, -2.05, 0.95, -2.19, 0.73, -2.18, 0.42], 1.74),
      prism(scene, [0.1, 1.39, -1.03, 1.37, -0.97, 1.47, 0.03, 1.48], 1.48), // roof
      box(scene, 0.07, 0.46, 0.12, -0.735, 1.19, -0.3), // B pillars
      box(scene, 0.07, 0.46, 0.12, 0.735, 1.19, -0.3),
      box(scene, 0.16, 0.1, 0.1, -0.92, 1.0, 0.62), // mirrors
      box(scene, 0.16, 0.1, 0.1, 0.92, 1.0, 0.62),
    ], 'car-body');
    this.carBody = add(carBody, 'car-body', tinted);
    this.carGlass = add(prism(scene, CAR_GLASS, 1.5), 'car-glass', { pickable: true, shadows: false });
    this.carShadow = add(prism(scene, CAR_GLASS, 1.46), 'car-shadow', { receive: false });
    const carTrim = mergeParts([
      P(box(scene, 1.8, 0.2, 0.16, 0, 0.38, 2.15), '#2f3134'), // bumpers
      P(box(scene, 1.8, 0.2, 0.16, 0, 0.38, -2.13), '#2f3134'),
      P(box(scene, 0.78, 0.13, 0.05, 0, 0.6, 2.18), '#1d1f22'), // grille
      P(box(scene, CAR_HEAD.w, CAR_HEAD.h, 0.06, -CAR_HEAD.x, CAR_HEAD.y, CAR_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, CAR_HEAD.w, CAR_HEAD.h, 0.06, CAR_HEAD.x, CAR_HEAD.y, CAR_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, CAR_TAIL.w, CAR_TAIL.h, 0.06, -CAR_TAIL.x, CAR_TAIL.y, CAR_TAIL.z + 0.04), '#8e1d18'),
      P(box(scene, CAR_TAIL.w, CAR_TAIL.h, 0.06, CAR_TAIL.x, CAR_TAIL.y, CAR_TAIL.z + 0.04), '#8e1d18'),
      P(box(scene, 0.42, 0.1, 0.02, 0, 0.42, 2.235), '#eeeeea'), // plates
      P(box(scene, 0.42, 0.1, 0.02, 0, 0.42, -2.215), '#eeeeea'),
      P(box(scene, 1.77, 0.1, 1.9, 0, 0.35, 0), '#2a2c2f'), // side skirts
      P(box(scene, 1.46, 0.03, 1.95, 0, 0.995, -0.29), '#1b1d20'), // dark interior seen through the glass
      P(box(scene, 0.5, 0.42, 0.12, -0.37, 1.1, -0.62), '#2b2d31'), // seat backs
      P(box(scene, 0.5, 0.42, 0.12, 0.37, 1.1, -0.62), '#2b2d31'),
      // wheel arches (dark rims over the wheels)
      ...CAR_WHEEL.z.map((z) => P(prism(scene, [z - 0.46, 0.33, z - 0.36, 0.62, z + 0.36, 0.62, z + 0.46, 0.33], 1.755), '#232528')),
    ], 'car-trim');
    this.carTrim = add(carTrim, 'car-trim', {});

    // ---- truck
    const truckCab = mergeParts([
      prism(scene, [1.95, 0.72, 3.76, 0.72, 3.82, 1.85, 1.95, 1.85], 2.3),
      prism(scene, [1.95, 2.72, 3.64, 2.72, 3.6, 2.98, 1.95, 2.98], 2.3), // roof
      prism(scene, [2.0, 2.98, 3.0, 2.98, 2.15, 3.32, 2.0, 3.32], 2.1), // wind deflector
      ...[-1, 1].flatMap((s) => [
        box(scene, 0.1, 0.9, 0.12, s * 1.1, 2.28, 3.7), // A pillars
        box(scene, 0.1, 0.9, 0.12, s * 1.1, 2.28, 2.0),
      ]),
    ], 'truck-cab');
    this.truckCab = add(truckCab, 'truck-cab', tinted);
    this.truckBox = add(mergeParts([
      box(scene, 2.45, 2.42, 5.56, 0, 2.19, -0.94),
      box(scene, 2.5, 0.08, 5.6, 0, 3.42, -0.94), // top rim
    ], 'truck-box'), 'truck-box', tinted);
    this.truckGlass = add(prism(scene, TRUCK_GLASS, 2.26), 'truck-glass', { pickable: true, shadows: false });
    this.truckShadow = add(prism(scene, TRUCK_GLASS, 2.2), 'truck-shadow', { receive: false });
    const truckTrim = mergeParts([
      P(box(scene, 1.1, 0.32, 7.3, 0, 0.74, 0), '#26282b'), // chassis
      P(box(scene, 2.36, 0.34, 0.16, 0, 0.72, 3.8), '#3a3c40'), // bumper
      P(box(scene, 1.3, 0.62, 0.05, 0, 1.36, 3.815), '#1f2124'), // grille
      P(box(scene, TRUCK_HEAD.w, TRUCK_HEAD.h, 0.06, -TRUCK_HEAD.x, TRUCK_HEAD.y, TRUCK_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, TRUCK_HEAD.w, TRUCK_HEAD.h, 0.06, TRUCK_HEAD.x, TRUCK_HEAD.y, TRUCK_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, TRUCK_TAIL.w, TRUCK_TAIL.h, 0.05, -TRUCK_TAIL.x, TRUCK_TAIL.y, TRUCK_TAIL.z + 0.03), '#8e1d18'),
      P(box(scene, TRUCK_TAIL.w, TRUCK_TAIL.h, 0.05, TRUCK_TAIL.x, TRUCK_TAIL.y, TRUCK_TAIL.z + 0.03), '#8e1d18'),
      P(box(scene, 2.3, 0.12, 0.12, 0, 0.56, -3.62), '#3a3c40'), // underride bar
      P(zcyl(scene, 0.5, 1.1, 10, -0.82, 0.68, 0.7), '#aeb2b6'), // fuel tank
      P(box(scene, 0.08, 0.34, 0.16, -1.32, 2.25, 3.55), '#1f2124'), // mirrors
      P(box(scene, 0.08, 0.34, 0.16, 1.32, 2.25, 3.55), '#1f2124'),
      P(box(scene, 0.22, 0.04, 0.04, -1.22, 2.25, 3.6), '#1f2124'),
      P(box(scene, 0.22, 0.04, 0.04, 1.22, 2.25, 3.6), '#1f2124'),
      P(box(scene, 0.44, 0.06, 0.7, -1.08, 1.03, TRUCK_WHEEL.z[0]), '#222427'), // front mudguards
      P(box(scene, 0.44, 0.06, 0.7, 1.08, 1.03, TRUCK_WHEEL.z[0]), '#222427'),
      P(box(scene, 0.36, 0.08, 0.5, -1.06, 0.48, 2.1), '#3a3c40'), // cab steps
      P(box(scene, 0.36, 0.08, 0.5, 1.06, 0.48, 2.1), '#3a3c40'),
      P(box(scene, 2.24, 0.03, 1.78, 0, 1.86, 2.87), '#1b1d20'), // cab interior
    ], 'truck-trim');
    this.truckTrim = add(truckTrim, 'truck-trim', {});

    // ---- van (parcel / grocery delivery): boxy body, sloped nose, sliding door, rear doors
    this.vanBody = add(mergeParts([
      prism(scene, [-2.95, 0.32, 2.85, 0.32, 2.98, 0.55, 2.95, 0.88, 2.55, 1.1, 2.0, 1.24, -2.97, 1.24, -2.98, 0.5], VAN_W), // lower body + hood
      prism(scene, [2.0, 1.22, 1.32, 2.28, 1.08, 2.5, -2.86, 2.52, -2.97, 2.4, -2.97, 1.22], VAN_W), // cab and cargo box
    ], 'van-body'), 'van-body', tinted);
    this.vanGlass = add(prism(scene, VAN_GLASS, VAN_W + 0.02), 'van-glass', { pickable: true, shadows: false });
    this.vanShadow = add(prism(scene, VAN_GLASS, VAN_W - 0.04), 'van-shadow', { receive: false });
    const vanTrim = mergeParts([
      P(box(scene, 1.96, 0.26, 0.16, 0, 0.36, 2.9), '#2f3134'), // bumpers
      P(box(scene, 1.96, 0.24, 0.14, 0, 0.34, -2.94), '#2f3134'),
      P(box(scene, 1.0, 0.24, 0.05, 0, 0.72, 2.955), '#1d1f22'), // grille
      P(box(scene, VAN_HEAD.w, VAN_HEAD.h, 0.06, -VAN_HEAD.x, VAN_HEAD.y, VAN_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, VAN_HEAD.w, VAN_HEAD.h, 0.06, VAN_HEAD.x, VAN_HEAD.y, VAN_HEAD.z - 0.04), '#dfe3e6'),
      P(box(scene, VAN_TAIL.w, VAN_TAIL.h, 0.05, -VAN_TAIL.x, VAN_TAIL.y, VAN_TAIL.z + 0.03), '#8e1d18'),
      P(box(scene, VAN_TAIL.w, VAN_TAIL.h, 0.05, VAN_TAIL.x, VAN_TAIL.y, VAN_TAIL.z + 0.03), '#8e1d18'),
      P(box(scene, 0.42, 0.1, 0.02, 0, 0.42, 2.995), '#eeeeea'), // plates
      P(box(scene, 0.42, 0.1, 0.02, 0, 0.5, -3.0), '#eeeeea'),
      P(box(scene, VAN_W + 0.012, 0.1, 4.7, 0, 0.6, -0.35), '#2a2c2f'), // rub strip
      P(box(scene, VAN_W + 0.016, 1.5, 0.025, 0, 0.78, 0.47), '#3a3d42'), // sliding door seam
      P(box(scene, 0.025, 1.85, 0.02, 0, 0.5, -2.982), '#3a3d42'), // rear door seam
      P(box(scene, 0.1, 0.34, 0.2, -1.13, 1.62, 1.85), '#1f2124'), // mirrors on arms
      P(box(scene, 0.1, 0.34, 0.2, 1.13, 1.62, 1.85), '#1f2124'),
      P(box(scene, 0.22, 0.04, 0.04, -1.04, 1.66, 1.9), '#1f2124'),
      P(box(scene, 0.22, 0.04, 0.04, 1.04, 1.66, 1.9), '#1f2124'),
      P(box(scene, 1.9, 0.03, 1.5, 0, 1.28, 1.25), '#1b1d20'), // cab interior
      P(box(scene, 0.55, 0.5, 0.12, -0.45, 1.5, 0.75), '#2b2d31'), // seat backs
      P(box(scene, 0.55, 0.5, 0.12, 0.45, 1.5, 0.75), '#2b2d31'),
      P(box(scene, 1.9, 1.0, 0.05, 0, 1.28, 0.6), '#25272b'), // bulkhead behind the seats
      P(box(scene, 0.5, 0.06, 0.7, 0.85, 0.36, -0.1), '#3a3c40'), // side step
      ...VAN_WHEEL.z.map((z) => P(prism(scene, [z - 0.5, 0.33, z - 0.4, 0.72, z + 0.4, 0.72, z + 0.5, 0.33], VAN_W + 0.01), '#232528')),
    ], 'van-trim');
    this.vanTrim = add(vanTrim, 'van-trim', {});

    // ---- shared: wheel (diameter 1, width 1 along x), lights, cones, driver
    const tire = P(xcyl(scene, 1, 1, 14), '#1e1f21');
    tire.convertToFlatShadedMesh();
    this.wheel = add(mergeParts([
      tire,
      P(xcyl(scene, 0.62, 1.04, 10), '#b9bec3'), // hubcap
      P(box(scene, 1.06, 0.5, 0.08, 0, 0, 0), '#55595e'), // spokes (show rotation)
      P(box(scene, 1.06, 0.08, 0.5, 0, 0, 0), '#55595e'),
      P(xcyl(scene, 0.16, 1.08, 8), '#7d8287'), // hub nut
    ], 'wheel'), 'wheel', {});

    const glow = (name: string, color: Color3) => {
      const p = add(MeshBuilder.CreateBox(name, { size: 1 }, scene), name, { shadows: false, receive: false });
      p.material.disableLighting = true;
      p.material.emissiveColor = color;
      p.material.diffuseColor = Color3.Black();
      p.material.specularColor = Color3.Black();
      p.mesh.applyFog = false;
      return p;
    };
    this.headGlow = glow('headglow', new Color3(1, 0.96, 0.82));
    this.tailGlow = glow('tailglow', new Color3(1, 0.1, 0.06));

    this.cone = add(lightCone(scene), 'cone', { shadows: false, receive: false });
    const cm = this.cone.material;
    cm.diffuseColor = Color3.Black();
    cm.specularColor = Color3.Black();
    cm.emissiveColor = new Color3(1, 0.9, 0.7);
    cm.disableLighting = true;
    cm.alphaMode = Constants.ALPHA_ADD;
    cm.transparencyMode = 2; // MATERIAL_ALPHABLEND
    cm.disableDepthWrite = true;
    cm.zOffset = -2;
    this.cone.mesh.applyFog = false;

    this.driverHead = add(MeshBuilder.CreateSphere('dhead', { diameter: 1, segments: 5 }, scene), 'driver-head', { colored: true });
    this.driverBody = add(MeshBuilder.CreateCapsule('dbody', { radius: 0.5, height: 1.6, tessellation: 8, subdivisions: 1 }, scene), 'driver-body', { colored: true });

    // materials
    for (const g of [this.carGlass, this.truckGlass, this.vanGlass]) {
      g.material.diffuseColor = Color3.FromHexString('#24313b');
      g.material.specularColor = new Color3(0.55, 0.6, 0.65);
      g.material.specularPower = 48;
      g.material.alpha = 0.7;
    }
    for (const sp of [this.carShadow, this.truckShadow, this.vanShadow]) {
      // opaque stand-in for the translucent glass, only rendered into the shadow map:
      // default-mask cameras skip it, and any other camera draws nothing
      sp.mesh.layerMask = 0x10000000;
      sp.material.disableColorWrite = true;
      sp.material.disableDepthWrite = true;
    }
    for (const b of [this.carBody, this.truckCab, this.truckBox, this.vanBody]) {
      b.material.specularColor = new Color3(0.32, 0.32, 0.32);
      b.material.specularPower = 40;
    }
  }

  update(vehicles: VehicleVisual[], timeSec: number, night: number): void {
    const dt = this.lastTime < 0 ? 0 : clamp(timeSec - this.lastTime, 0, 0.25);
    this.lastTime = timeSec;
    const frame = ++this.frame;
    for (const p of this.parts) p.begin();
    for (const l of this.liveries.values()) { l.truck?.begin(); l.van?.begin(); }
    let painted = 0;
    const nightOn = night > 0.02;
    const min = this.min.set(Infinity, Infinity, Infinity);
    const max = this.max.set(-Infinity, -Infinity, -Infinity);

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const truck = v.kind === 'truck', van = v.kind === 'van';
      // vehicle frame
      const th = Math.PI / 2 - v.heading;
      const c = Math.cos(th), s = Math.sin(th);
      this.ax = c; this.az = -s; this.fx = s; this.fz = c;
      this.px = v.x; this.py = v.z; this.pz = v.y;
      if (v.x < min.x) min.x = v.x;
      if (v.x > max.x) max.x = v.x;
      if (v.z < min.y) min.y = v.z;
      if (v.z > max.y) max.y = v.z;
      if (v.y < min.z) min.z = v.y;
      if (v.y > max.z) max.z = v.y;

      // wheel rotation from the distance traveled
      let rec = this.dist.get(v.id);
      if (!rec) { rec = { d: hashf(v.id) * 10, seen: frame }; this.dist.set(v.id, rec); }
      rec.d += v.speed * dt;
      rec.seen = frame;

      const col = this.col;
      // livery (company trucks and vans): painted lazily, a few brands per frame
      let liv: Livery | null = null;
      if (v.brand && (truck || van)) {
        const key = `${v.brand}|${Math.round((v.brandHue ?? v.hue) * 1000)}`;
        liv = this.liveries.get(key) ?? null;
        if (!liv && painted < this.liveryBudget) { liv = this.makeLivery(key, v.brand, v.brandHue ?? v.hue); painted++; }
        if (liv) liv.seen = frame;
      }
      if (truck) {
        if (liv) rgbInto(liv.style.cab, col);
        else carInto(v.hue, col, 0);
        this.put(this.truckCab, v.id, 0, 0, 0, col);
        const cargo = hashf(v.id * 3 + 1);
        if (liv) rgbInto(liv.style.box, col);
        else if (cargo < 0.7) hexInto(CARGO[Math.floor(hashf(v.id * 7) * CARGO.length)], col, 0);
        else { for (let k = 0; k < 3; k++) col[k] = col[k] * 0.4 + 0.6; }
        this.put(this.truckBox, v.id, 0, 0, 0, col);
        if (liv) this.put(liv.truck ?? (liv.truck = this.liveryPart(liv, 'truck')), v.id, 0, 0, 0, null);
        this.put(this.truckGlass, v.id, 0, 0, 0, null);
        this.put(this.truckShadow, v.id, 0, 0, 0, null);
        this.put(this.truckTrim, v.id, 0, 0, 0, null);
        const W = TRUCK_WHEEL;
        const ang = -rec.d / W.r;
        for (const z of W.z) for (const sx of SIDES) this.putWheel(v.id, sx * W.x, W.r, z, W.r * 2, W.w, ang);
      } else if (van) {
        if (liv) rgbInto(liv.style.body, col);
        else hexInto(VAN_PAINT[Math.floor(hashf(v.id * 7 + 3) * VAN_PAINT.length)], col, 0);
        this.put(this.vanBody, v.id, 0, 0, 0, col);
        this.put(this.vanGlass, v.id, 0, 0, 0, null);
        this.put(this.vanShadow, v.id, 0, 0, 0, null);
        this.put(this.vanTrim, v.id, 0, 0, 0, null);
        if (liv) this.put(liv.van ?? (liv.van = this.liveryPart(liv, 'van')), v.id, 0, 0, 0, null);
        const W = VAN_WHEEL;
        const ang = -rec.d / W.r;
        for (const z of W.z) for (const sx of SIDES) this.putWheel(v.id, sx * W.x, W.r, z, W.r * 2, W.w, ang);
      } else {
        carInto(v.hue, col, 0);
        this.put(this.carBody, v.id, 0, 0, 0, col);
        this.put(this.carGlass, v.id, 0, 0, 0, null);
        this.put(this.carShadow, v.id, 0, 0, 0, null);
        this.put(this.carTrim, v.id, 0, 0, 0, null);
        const W = CAR_WHEEL;
        const ang = -rec.d / W.r;
        for (const z of W.z) for (const sx of SIDES) this.putWheel(v.id, sx * W.x, W.r, z, W.r * 2, W.w, ang);
      }

      if (v.hasDriver) {
        const dx = truck ? -0.55 : van ? -0.45 : -0.37, dz = truck ? 2.95 : van ? 1.02 : -0.22;
        const hy = truck ? 2.42 : van ? 1.86 : 1.2;
        hexInto(SKIN[Math.floor(hashf(v.id * 11 + 2) * SKIN.length)], col, 0);
        this.putScaled(this.driverHead, v.id, dx, hy, dz + 0.02, 0.19, 0.23, 0.21, col);
        clothInto(hashf(v.id * 5 + 9), 0, col, 0);
        this.putScaled(this.driverBody, v.id, dx, hy - 0.38, dz - 0.04, 0.4, 0.34, 0.25, col);
      }

      // lights at night (on when someone drives or it moves)
      if (nightOn && (v.hasDriver || v.speed > 0.05)) {
        const H = truck ? TRUCK_HEAD : van ? VAN_HEAD : CAR_HEAD, T = truck ? TRUCK_TAIL : van ? VAN_TAIL : CAR_TAIL;
        for (const sx of SIDES) {
          this.putScaled(this.headGlow, v.id, sx * H.x, H.y, H.z, H.w * 0.92, H.h * 0.85, 0.02, null);
          this.putScaled(this.tailGlow, v.id, sx * T.x, T.y, T.z, T.w * 0.92, T.h * 0.85, 0.02, null);
        }
        const cs = truck ? 1.25 : van ? 1.12 : 1;
        this.putScaled(this.cone, v.id, 0, 0.06, H.z + 0.05, cs, 1, cs, null);
      }
    }

    const pad = 9;
    min.x -= pad; min.y -= 1; min.z -= pad;
    max.x += pad; max.y += 5; max.z += pad;
    for (const p of this.parts) p.finish(min, max);
    for (const [key, l] of this.liveries) {
      l.truck?.finish(min, max);
      l.van?.finish(min, max);
      if (frame - l.seen > 900) { this.disposeLivery(l); this.liveries.delete(key); }
    }

    // light intensities follow the night factor
    const n = clamp(night, 0, 1);
    this.headGlow.material.emissiveColor.set(0.35 + 0.65 * n, 0.33 + 0.63 * n, 0.28 + 0.54 * n);
    this.tailGlow.material.emissiveColor.set(0.4 + 0.6 * n, 0.04 + 0.06 * n, 0.03 + 0.03 * n);
    this.cone.material.emissiveColor.set(0.6 * n, 0.55 * n, 0.42 * n);

    if (this.dist.size > vehicles.length * 2 + 64) {
      for (const [id, r] of this.dist) if (r.seen !== frame) this.dist.delete(id);
    }
  }

  /** If a scene pick hit a vehicle mesh, return that vehicle's id, else -1. */
  pickedId(pick: PickingInfo): number {
    if (!pick || !pick.hit) return -1;
    for (const p of this.pickParts) {
      const id = p.idAt(pick);
      if (id >= 0) return id;
    }
    for (const l of this.liveries.values()) {
      for (const p of [l.truck, l.van]) { const id = p ? p.idAt(pick) : -1; if (id >= 0) return id; }
    }
    return -1;
  }

  get meshes(): Mesh[] {
    const out = this.parts.map((p) => p.mesh);
    for (const l of this.liveries.values()) for (const p of [l.truck, l.van]) if (p) out.push(p.mesh);
    return out;
  }

  /** Number of brand liveries currently painted (for debugging). */
  get liveryCount(): number {
    return this.liveries.size;
  }

  /** Additive headlight cone mesh: exclude it from a GlowLayer (glow.addExcludedMesh) or it blows out. */
  get coneMesh(): Mesh {
    return this.cone.mesh;
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    for (const l of this.liveries.values()) this.disposeLivery(l);
    this.liveries.clear();
    this.parts = [];
    this.pickParts = [];
    this.dist.clear();
  }

  // ------------------------------------------------------------ internals

  private makeLivery(key: string, name: string, hue: number): Livery {
    const S = 256;
    const tex = new DynamicTexture(`livery:${key}`, { width: S, height: S }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    paintLivery(tex.getContext() as unknown as CanvasRenderingContext2D, S, S, name, hue);
    tex.update(true);
    const l: Livery = { key, tex, style: liveryStyle(name, hue), truck: null, van: null, seen: this.frame };
    this.liveries.set(key, l);
    return l;
  }

  /** The decal mesh for one brand and body type (side panels and rear doors). */
  private liveryPart(l: Livery, kind: 'truck' | 'van'): InstancedPart {
    const D = kind === 'truck' ? TRUCK_DECAL : VAN_DECAL;
    const R = kind === 'truck' ? LIVERY.truck : LIVERY.van, B = LIVERY.rear;
    const g = new Geo(new Xf(), true);
    const W = Color3.White();
    const v0 = 1 - R[3], v1 = 1 - R[1]; // texture rows (from the top) to v
    // right side: the front is on the viewer's right, so u runs rear -> front
    g.poly([D.x, D.y0, D.z0, D.x, D.y0, D.z1, D.x, D.y1, D.z1, D.x, D.y1, D.z0], W, 1, 0, 0, [R[0], v0, R[2], v0, R[2], v1, R[0], v1]);
    // left side: front on the viewer's left, u runs front -> rear
    g.poly([-D.x, D.y0, D.z1, -D.x, D.y0, D.z0, -D.x, D.y1, D.z0, -D.x, D.y1, D.z1], W, -1, 0, 0, [R[0], v0, R[2], v0, R[2], v1, R[0], v1]);
    // rear doors, seen from behind: +x is on the viewer's right
    const b0 = 1 - B[3], b1 = 1 - B[1];
    g.poly([-D.rx, D.ry0, D.rz, D.rx, D.ry0, D.rz, D.rx, D.ry1, D.rz, -D.rx, D.ry1, D.rz], W, 0, 0, -1, [B[0], b0, B[2], b0, B[2], b1, B[0], b1]);
    const mesh = g.toMesh(`vehicle-livery-${kind}-${l.key}`, this.scene, false);
    const p = new InstancedPart(mesh, this.scene, null, { pickable: true, shadows: false });
    p.material.diffuseTexture = l.tex;
    p.material.specularColor = new Color3(0.32, 0.32, 0.32);
    p.material.specularPower = 40;
    p.material.zOffset = -1;
    return p;
  }

  private disposeLivery(l: Livery): void {
    l.truck?.dispose();
    l.van?.dispose();
    l.tex.dispose();
  }

  /** Instance at local offset (x, y, z) with the vehicle's rotation. */
  private put(part: InstancedPart, id: number, x: number, y: number, z: number, col: Float32Array | null): void {
    this.putScaled(part, id, x, y, z, 1, 1, 1, col);
  }

  private putScaled(part: InstancedPart, id: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, col: Float32Array | null): void {
    const i = part.add(id);
    const ax = this.ax, az = this.az, fx = this.fx, fz = this.fz;
    writeMatrix(part.m, i,
      ax * sx, 0, az * sx,
      0, sy, 0,
      fx * sz, 0, fz * sz,
      this.px + ax * x + fx * z, this.py + y, this.pz + az * x + fz * z);
    if (col && part.c) {
      part.c[i * 4] = col[0]; part.c[i * 4 + 1] = col[1]; part.c[i * 4 + 2] = col[2]; part.c[i * 4 + 3] = 1;
    }
  }

  /** Wheel at local (x, y, z): diameter d, width w, spun by `ang` around its axle. */
  private putWheel(id: number, x: number, y: number, z: number, d: number, w: number, ang: number): void {
    const part = this.wheel;
    const i = part.add(id);
    const ax = this.ax, az = this.az, fx = this.fx, fz = this.fz;
    const c = Math.cos(ang) * d, s = Math.sin(ang) * d;
    // local Y -> (0, c, -s), local Z -> (0, s, c), mapped through the vehicle yaw
    writeMatrix(part.m, i,
      ax * w, 0, az * w,
      -s * fx, c, -s * fz,
      c * fx, s, c * fz,
      this.px + ax * x + fx * z, this.py + y, this.pz + az * x + fz * z);
  }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rgbInto = (c: Color3, out: Float32Array) => { out[0] = c.r; out[1] = c.g; out[2] = c.b; };

/** Ground quad fanning out in front of the headlights, brightness in vertex colors (additive). */
function lightCone(scene: Scene): Mesh {
  const rows = [
    { z: 0, w: 2.0, c: [0.9] },
    { z: 3.5, w: 4.6, c: [0.6] },
    { z: 8, w: 7.0, c: [0.25] },
    { z: 14, w: 9.0, c: [0] },
  ];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const r of rows) {
    // soft lateral edges: outer columns fade to black
    for (const [fx, cc] of [[-0.5, 0], [-0.2, r.c[0]], [0.2, r.c[0]], [0.5, 0]] as const) {
      pos.push(fx * r.w, 0, r.z);
      col.push(cc, cc, cc, 1);
    }
  }
  for (let rI = 0; rI < rows.length - 1; rI++) {
    for (let k = 0; k < 3; k++) {
      const a = rI * 4 + k, b = a + 1, c = a + 4, d = a + 5;
      // faces up: (p1 - p2) x (p3 - p2) must point to +y
      idx.push(a, c, b, b, c, d);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  // make sure the quad faces up
  if (normals[1] < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    VertexData.ComputeNormals(pos, idx, normals);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = normals;
  vd.colors = col;
  const m = new Mesh('cone', scene);
  vd.applyToMesh(m);
  m.isPickable = false;
  return m;
}

