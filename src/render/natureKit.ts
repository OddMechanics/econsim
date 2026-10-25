// Nature templates shared by the city square's nature (terrain.ts) and the
// countryside's (countryNature.ts): low-poly trees, rocks, ore, berry bushes
// and clay mounds built from lumpy primitives with baked vertex colors, plus
// the growable instance buffers they're drawn from (thin instances).

import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, Vector3, VertexBuffer, VertexData } from '@babylonjs/core';
import { hash2 } from '../sim/rng';

export type RGB = [number, number, number];

export function rgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mix(out: RGB, c: RGB, t: number): void {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
}

// ---------------------------------------------------------------- templates

export function paint(m: Mesh, c: RGB): Mesh {
  const n = m.getTotalVertices();
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, a);
  return m;
}

export function cone(scene: Scene, dBottom: number, dTop: number, h: number, tess: number, y: number, c: RGB): Mesh {
  const m = MeshBuilder.CreateCylinder('c', { diameterBottom: dBottom, diameterTop: dTop, height: h, tessellation: tess }, scene);
  m.position.y = y + h / 2;
  m.bakeCurrentTransformIntoVertices();
  return paint(m, c);
}

/** A lumpy icosphere: radius r, stretched by (sx, sy, sz), vertices pushed in/out by `jitter`. */
export function blob(scene: Scene, r: number, sub: number, pos: [number, number, number], scale: [number, number, number], jitter: number, seed: number, c: RGB, floorY = -Infinity): Mesh {
  // (Babylon reads subdivisions: 0 as "default 4": a tiny berry would get ~960 vertices; sub 0 means an octahedron here)
  const m = sub <= 0
    ? MeshBuilder.CreatePolyhedron('b', { type: 1, size: r * 0.75 }, scene)
    : MeshBuilder.CreateIcoSphere('b', { radius: r, subdivisions: sub, flat: false }, scene);
  const p = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < p.length; i += 3) {
    // shared positions must move together: hash the rounded position
    const k = hash2(Math.round(p[i] * 1000), Math.round(p[i + 1] * 1000) * 7 + Math.round(p[i + 2] * 1000), seed);
    const f = 1 + (k - 0.5) * 2 * jitter;
    p[i] = p[i] * f * scale[0] + pos[0];
    p[i + 1] = Math.max(floorY, p[i + 1] * f * scale[1]) + pos[1];
    p[i + 2] = p[i + 2] * f * scale[2] + pos[2];
  }
  m.setVerticesData(VertexBuffer.PositionKind, p);
  const nrm = new Float32Array(p.length);
  VertexData.ComputeNormals(p, m.getIndices()!, nrm);
  m.setVerticesData(VertexBuffer.NormalKind, nrm);
  return paint(m, c);
}

export function merge(parts: Mesh[], name: string, flat = true): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  if (flat) m.convertToFlatShadedMesh();
  return m;
}

export type NatureId = 'conifer' | 'oak' | 'birch' | 'stump' | 'rock' | 'ore' | 'bush' | 'mound';

export function makeTemplate(scene: Scene, id: NatureId): Mesh {
  const bark = rgb('#6a4a2f');
  switch (id) {
    case 'conifer':
      return merge([
        cone(scene, 0.38, 0.24, 1.9, 5, 0, bark),
        cone(scene, 3.7, 0, 3.6, 7, 1.2, rgb('#2f5d34')),
        cone(scene, 2.9, 0, 3.0, 7, 3.0, rgb('#33653a')),
        cone(scene, 2.0, 0, 2.6, 7, 4.8, rgb('#3a6e40')),
      ], 'conifer');
    case 'oak':
      return merge([
        cone(scene, 0.5, 0.32, 3.2, 6, 0, bark),
        blob(scene, 2.3, 1, [0, 4.6, 0], [1, 0.85, 1], 0.18, 11, rgb('#4f8a39')),
        blob(scene, 1.6, 1, [1.2, 3.9, 0.5], [1, 0.85, 1], 0.2, 12, rgb('#5a9440')),
      ], 'oak');
    case 'birch':
      return merge([
        cone(scene, 0.28, 0.16, 5.2, 6, 0, rgb('#e4e0d6')),
        blob(scene, 1.35, 1, [0, 5.4, 0], [1, 1.7, 1], 0.22, 13, rgb('#86ad4c')),
      ], 'birch');
    case 'stump':
      return merge([cone(scene, 0.55, 0.45, 0.5, 7, -0.05, rgb('#7a5a3a'))], 'stump');
    case 'rock':
      return merge([blob(scene, 1, 1, [0, 0, 0], [1, 1, 1], 0.3, 21, rgb('#ffffff'), -0.35)], 'rock');
    case 'ore':
      return merge([
        blob(scene, 1, 1, [0, 0, 0], [0.9, 1.2, 0.9], 0.28, 31, rgb('#ffffff'), -0.4),
        blob(scene, 0.55, 1, [0.75, 0, 0.35], [1, 1.4, 1], 0.3, 32, rgb('#c9c2bb'), -0.3),
      ], 'ore');
    case 'bush': {
      const parts = [blob(scene, 0.85, 1, [0, 0.45, 0], [1, 0.75, 1], 0.22, 41, rgb('#3f7a35'), -0.1)];
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4, h = 0.25 + 0.5 * hash2(k, 1, 43);
        const rr = 0.8 * Math.sqrt(1 - h * h * 0.6);
        parts.push(blob(scene, 0.1, 0, [Math.cos(a) * rr, 0.45 + h * 0.6, Math.sin(a) * rr], [1, 1, 1], 0.1, 44 + k, k % 3 ? rgb('#b3263a') : rgb('#5a2a6a')));
      }
      return merge(parts, 'bush');
    }
    case 'mound':
      return merge([
        blob(scene, 1, 1, [0, 0, 0], [1, 0.38, 1], 0.2, 51, rgb('#ffffff'), -0.05),
        blob(scene, 0.6, 1, [0.9, 0, 0.4], [1, 0.35, 1], 0.25, 52, rgb('#e6ddd5'), -0.05),
      ], 'mound');
  }
}


/** Growable instance buffers (matrix + color). */
export class Buf {
  m = new Float32Array(16 * 256);
  c = new Float32Array(4 * 256);
  n = 0;
  next(): number {
    if ((this.n + 1) * 16 > this.m.length) {
      const m = new Float32Array(this.m.length * 2), c = new Float32Array(this.c.length * 2);
      m.set(this.m); c.set(this.c);
      this.m = m; this.c = c;
    }
    return this.n++;
  }
}

const tmpM = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

export function pushYaw(b: Buf, x: number, y: number, z: number, s: number, sy: number, yaw: number, r: number, g: number, bl: number): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const i = b.next(), m = b.m, o = i * 16;
  m[o] = s * c; m[o + 1] = 0; m[o + 2] = -s * sn; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = s * sn; m[o + 9] = 0; m[o + 10] = s * c; m[o + 11] = 0;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
  b.c[i * 4] = r; b.c[i * 4 + 1] = g; b.c[i * 4 + 2] = bl; b.c[i * 4 + 3] = 1;
}

export function pushTilt(b: Buf, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, roll: number, r: number, g: number, bl: number): void {
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, tmpQ);
  tmpS.set(sx, sy, sz);
  tmpP.set(x, y, z);
  Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
  const i = b.next();
  b.m.set(tmpM.m, i * 16);
  b.c[i * 4] = r; b.c[i * 4 + 1] = g; b.c[i * 4 + 2] = bl; b.c[i * 4 + 3] = 1;
}

/**
 * Thin instances with zero instances would draw the template once with a
 * broken instance-color buffer, so empty meshes are hidden instead.
 */
export function setInstances(mesh: Mesh, b: Buf): void {
  mesh.isVisible = b.n > 0;
  if (b.n === 0) return;
  mesh.thinInstanceSetBuffer('matrix', b.m.slice(0, b.n * 16), 16, true);
  mesh.thinInstanceSetBuffer('color', b.c.slice(0, b.n * 4), 4, true);
}
