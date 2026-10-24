// Shared low-level helpers for the people renderers (and vehicles.ts, via the
// re-exports in people.ts): thin-instanced parts with growable buffers, flat
// vertex colors, small mesh builders, a deterministic hash.

import { BoundingInfo, Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexBuffer } from '@babylonjs/core';
import type { PickingInfo, Scene, ShadowGenerator } from '@babylonjs/core';

/** Deterministic 0..1 hash of an integer. */
export function hashf(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Bake a flat vertex color into a mesh (vertex colors multiply instance colors). */
export function paintMesh(m: Mesh, r: number, g: number, b: number): Mesh {
  const n = m.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, colors);
  return m;
}

export function mergeParts(parts: Mesh[], name: string): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  return m;
}

/** Cylinder spanning y0..y1 (diameterTop at y1). */
export function cyl(scene: Scene, dTop: number, dBottom: number, tess: number, y0: number, y1: number, rotY = 0, x = 0, z = 0): Mesh {
  const m = MeshBuilder.CreateCylinder('c', { diameterTop: dTop, diameterBottom: dBottom, height: y1 - y0, tessellation: tess }, scene);
  m.rotation.y = rotY;
  m.position.set(x, (y0 + y1) / 2, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

export function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const m = MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

export function sphere(scene: Scene, segments: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, slice = 1): Mesh {
  const m = MeshBuilder.CreateSphere('s', { diameter: 1, segments, slice }, scene);
  m.scaling.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

export interface PartOptions {
  colored?: boolean; // per-instance color buffer
  pickable?: boolean;
  shadows?: boolean; // cast shadows (default true)
  receive?: boolean; // receive shadows (default true)
}

/**
 * One thin-instanced mesh with growable, reused matrix/color buffers. Call
 * begin(), add() per instance (write `m`/`c` at the returned index), then
 * finish() once per frame. With 0 instances the mesh is hidden (an empty
 * instance-color buffer breaks the shader).
 */
export class InstancedPart {
  readonly mesh: Mesh;
  readonly material: StandardMaterial;
  count = 0;
  m: Float32Array;
  c: Float32Array | null;
  ids: Int32Array;
  private cap = 64;
  private fresh = true; // buffers (re)allocated since last finish()

  constructor(mesh: Mesh, scene: Scene, shadows: ShadowGenerator | null, opts: PartOptions = {}) {
    this.mesh = mesh;
    mesh.refreshBoundingInfo();
    const bi = mesh.getBoundingInfo();
    // per-instance pick precheck uses the raw (single part) bounds
    mesh.rawBoundingInfo = new BoundingInfo(bi.minimum.clone(), bi.maximum.clone());
    mesh.doNotSyncBoundingInfo = true; // we set the whole-crowd bounds ourselves
    mesh.isVisible = false;
    mesh.isPickable = !!opts.pickable;
    mesh.thinInstanceEnablePicking = !!opts.pickable;
    mesh.receiveShadows = opts.receive !== false;
    const mat = new StandardMaterial(mesh.name + '-mat', scene);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mesh.material = mat;
    this.material = mat;
    if (shadows && opts.shadows !== false) shadows.addShadowCaster(mesh, false);
    this.m = new Float32Array(this.cap * 16);
    this.c = opts.colored ? new Float32Array(this.cap * 4) : null;
    this.ids = new Int32Array(this.cap);
  }

  begin(): void {
    this.count = 0;
  }

  /** Reserve the next instance for owner `id`; returns its index. */
  add(id: number): number {
    if (this.count >= this.cap) this.grow();
    this.ids[this.count] = id;
    return this.count++;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const m = new Float32Array(cap * 16);
    m.set(this.m);
    this.m = m;
    if (this.c) {
      const c = new Float32Array(cap * 4);
      c.set(this.c);
      this.c = c;
    }
    const ids = new Int32Array(cap);
    ids.set(this.ids);
    this.ids = ids;
    this.cap = cap;
    this.fresh = true;
  }

  /** Upload this frame's instances. `min`/`max` bound all of them (world space). */
  finish(min: Vector3, max: Vector3): void {
    const mesh = this.mesh;
    const n = this.count;
    if (n === 0) {
      mesh.isVisible = false;
      return;
    }
    if (this.fresh) {
      mesh.thinInstanceSetBuffer('matrix', this.m, 16, false);
      if (this.c) mesh.thinInstanceSetBuffer('color', this.c, 4, false);
      this.fresh = false;
      mesh.thinInstanceCount = n;
    } else {
      mesh.thinInstanceCount = n; // before the update: it uploads `count` matrices
      mesh.thinInstanceBufferUpdated('matrix');
      if (this.c) mesh.thinInstanceBufferUpdated('color');
    }
    mesh.isVisible = true;
    mesh.getBoundingInfo().reConstruct(min, max, mesh.getWorldMatrix());
  }

  /** Owner id of the instance a pick hit, or -1. */
  idAt(pick: PickingInfo): number {
    if (!pick.hit || pick.pickedMesh !== this.mesh) return -1;
    const i = pick.thinInstanceIndex;
    return i >= 0 && i < this.count ? this.ids[i] : -1;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}

/** Write an affine transform (world axes X, Y, Z incl. scale, origin O) as a Babylon matrix. */
export function writeMatrix(
  m: Float32Array, i: number,
  xx: number, xy: number, xz: number, yx: number, yy: number, yz: number,
  zx: number, zy: number, zz: number, ox: number, oy: number, oz: number,
): void {
  const o = i * 16;
  m[o] = xx; m[o + 1] = xy; m[o + 2] = xz; m[o + 3] = 0;
  m[o + 4] = yx; m[o + 5] = yy; m[o + 6] = yz; m[o + 7] = 0;
  m[o + 8] = zx; m[o + 9] = zy; m[o + 10] = zz; m[o + 11] = 0;
  m[o + 12] = ox; m[o + 13] = oy; m[o + 14] = oz; m[o + 15] = 1;
}
