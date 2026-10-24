// Facade geometry shared by towers and mid-rise blocks: floor plates as
// outlines (rectangles with square, chamfered, notched or rounded corners,
// tapering and twisting per floor), offsets and subdivisions of outlines,
// wall frames along their edges, slabs and ring slabs (balconies), parapets,
// mullions and fins (straight or slanted), bands, braces, and rows of window
// panes merged by lighting state.

import { Color3 } from '@babylonjs/core';
import { Geo, clamp01, lerp, shade, type WinState } from './buildingGeo';
import type { Ctx } from './buildingCtx';


export type Corner = 'sq' | 'chamfer' | 'notch' | 'round';

/** A stretch of the shaft with one plate shape: floors [f0, f1). */
export interface Seg {
  f0: number; f1: number;
  w0: number; d0: number; w1: number; d1: number; // plate at f0 and (tapering) at f1
  cx: number; cz: number;
  corner: Corner; cr: number;
  twist: number; // plate rotation per floor (radians)
  balc: number; // balcony depth (flats)
}

/** The plate of segment `s` at floor `f` (tower-local x, z points; front-left first, clockwise seen from above). */
export function outline(s: Seg, f: number): number[] {
  const t = s.f1 > s.f0 ? clamp01((f - s.f0) / (s.f1 - s.f0)) : 0;
  const hw = lerp(s.w0, s.w1, t) / 2, hd = lerp(s.d0, s.d1, t) / 2;
  const corners = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  const out: number[] = [];
  const cr = Math.min(s.cr, hw, hd);
  for (let i = 0; i < 4; i++) {
    const [x, z] = corners[i];
    const [px, pz] = corners[(i + 3) % 4], [nx, nz] = corners[(i + 1) % 4];
    const il = Math.hypot(x - px, z - pz), ol = Math.hypot(nx - x, nz - z);
    const dix = (x - px) / il, diz = (z - pz) / il, dox = (nx - x) / ol, doz = (nz - z) / ol;
    if (s.corner === 'sq' || cr < 0.05) out.push(x, z);
    else if (s.corner === 'chamfer') out.push(x - dix * cr, z - diz * cr, x + dox * cr, z + doz * cr);
    else if (s.corner === 'notch') out.push(x - dix * cr, z - diz * cr, x - dix * cr + dox * cr, z - diz * cr + doz * cr, x + dox * cr, z + doz * cr);
    else {
      // round: arc around (corner - din*cr + dout*cr)
      const ccx = x - dix * cr + dox * cr, ccz = z - diz * cr + doz * cr;
      const n = cr > 4 ? 5 : 2;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * (Math.PI / 2);
        // from -dout direction (start, at corner - din*cr) to +din direction (end, at corner + dout*cr)
        const ux = -dox * Math.cos(a) + dix * Math.sin(a), uz = -doz * Math.cos(a) + diz * Math.sin(a);
        out.push(ccx + ux * cr, ccz + uz * cr);
      }
    }
  }
  const a = s.twist * (f - s.f0);
  if (a !== 0 || s.cx !== 0 || s.cz !== 0) {
    const cs = Math.cos(a), sn = Math.sin(a);
    for (let i = 0; i < out.length; i += 2) {
      const x = out[i], z = out[i + 1];
      out[i] = s.cx + x * cs - z * sn;
      out[i + 1] = s.cz + x * sn + z * cs;
    }
  }
  return out;
}

/** Offset a closed outline outward by `d` (miter at the vertices). */
export function offsetOutline(pts: number[], d: number | ((i: number) => number)): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = pts[((i + n - 1) % n) * 2], pz = pts[((i + n - 1) % n) * 2 + 1];
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const nx = pts[((i + 1) % n) * 2], nz = pts[((i + 1) % n) * 2 + 1];
    // outward normals of the two edges: n = (-dz, dx)
    let ax = -(z - pz), az = x - px; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    let bx = -(nz - z), bz = nx - x; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
    let mx = ax + bx, mz = az + bz; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const cosHalf = Math.max(0.35, mx * ax + mz * az);
    const dd = typeof d === 'number' ? d : d(i);
    out.push(x + (mx * dd) / cosHalf, z + (mz * dd) / cosHalf);
  }
  return out;
}

/** Insert points along the edges of a closed outline so no edge is longer than `step`. */
export function subdivide(pts: number[], step: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
    const k = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let j = 0; j < k; j++) out.push(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k);
  }
  return out;
}

/** Each edge of a closed outline as a wall frame: push the transform, call fn(len, i, ax, az, dx, dz), pop. */
export function eachEdge(c: Ctx, pts: number[], fn: (len: number, i: number, ax: number, az: number, dx: number, dz: number) => void): void {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    c.t.push((ax + bx) / 2, 0, (az + bz) / 2, Math.atan2(-dz, dx));
    fn(len, i, ax, az, dx, dz);
    c.t.pop();
  }
}

/** Bounding box of an outline: [x0, z0, x1, z1]. */
export function bounds(pts: number[]): [number, number, number, number] {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
  return [x0, z0, x1, z1];
}

/** Horizontal polygon (flat xz list) at height y, facing up (or down). */
export function flatPoly(g: Geo, pts: number[], y: number, col: Color3, up = true): void {
  const p3: number[] = [];
  for (let i = 0; i < pts.length; i += 2) p3.push(pts[i], y, pts[i + 1]);
  g.poly(p3, col, 0, up ? 1 : -1, 0);
}

/** A slab (prism) between two heights over a (convex) outline. */
export function prism(g: Geo, pts: number[], y0: number, y1: number, col: Color3, top = true, sides = true, bottom = false): void {
  if (top) flatPoly(g, pts, y1, col);
  if (bottom) flatPoly(g, pts, y0, shade(col, 0.8), false);
  if (!sides) return;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
    g.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, col, -(bz - az), 0, bx - ax);
  }
}

/** A parapet around a flat roof: outer wall, a coping ring on top, the inner face and the roof membrane. */
export function parapet(g: Geo, pts: number[], y: number, h: number, col: Color3, roofC: Color3, t = 0.3): void {
  const inner = offsetOutline(pts, -t);
  prism(g, pts, y, y + h, col, false, true);
  ringSlab(g, inner, pts, y + h - 0.08, y + h, shade(col, 0.92), col);
  const n = inner.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = inner[i * 2], az = inner[i * 2 + 1], bx = inner[j * 2], bz = inner[j * 2 + 1];
    g.quad(bx, y, bz, ax, y, az, ax, y + h, az, bx, y + h, bz, shade(col, 0.8), bz - az, 0, -(bx - ax));
  }
  flatPoly(g, inner, y + 0.06, roofC);
}

/** A ring slab between an inner outline and an outer one with the same number of points (balconies). */
export function ringSlab(g: Geo, inner: number[], outer: number[], y0: number, y1: number, col: Color3, under: Color3 | null): void {
  const n = inner.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = inner[i * 2], az = inner[i * 2 + 1], bx = inner[j * 2], bz = inner[j * 2 + 1];
    const cx = outer[j * 2], cz = outer[j * 2 + 1], dx = outer[i * 2], dz = outer[i * 2 + 1];
    if (Math.hypot(cx - bx, cz - bz) < 0.02 && Math.hypot(dx - ax, dz - az) < 0.02) continue;
    g.poly([ax, y1, az, bx, y1, bz, cx, y1, cz, dx, y1, dz], col, 0, 1, 0);
    if (under) g.poly([ax, y0, az, dx, y0, dz, cx, y0, cz, bx, y0, bz], under, 0, -1, 0);
    g.quad(dx, y0, dz, cx, y0, cz, cx, y1, cz, dx, y1, dz, col, -(cz - dz), 0, cx - dx);
  }
}

/** Group bays with the same lighting state into one quad (fewer vertices on big curtain walls). */
export function paneRow(c: Ctx, x0: number, x1: number, n: number, y0: number, y1: number, z: number, states: WinState[], col: (i: number) => Color3): void {
  const bw = (x1 - x0) / n;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && states[j] === states[i]) j++;
    c.lit(states[i]).quad(x0 + i * bw, y0, z, x0 + j * bw, y0, z, x0 + j * bw, y1, z, x0 + i * bw, y1, z, col(i), 0, 0, 1);
    i = j;
  }
}

/** A vertical fin / mullion in the current wall frame: front + two sides (no top). */
export function fin(g: Geo, x: number, y0: number, y1: number, w: number, depth: number, col: Color3, z = 0): void {
  const a = x - w / 2, b = x + w / 2, f = z + depth;
  g.quad(a, y0, f, b, y0, f, b, y1, f, a, y1, f, col, 0, 0, 1);
  if (depth > 0.015) {
    const side = shade(col, 0.86);
    g.quad(b, y0, f, b, y0, z, b, y1, z, b, y1, f, side, 1, 0, 0);
    g.quad(a, y0, z, a, y0, f, a, y1, f, a, y1, z, side, -1, 0, 0);
  }
}

/** A flat diagonal brace in the current wall frame (front face and one side), proud of the wall by `depth`. */
export function diag(g: Geo, xa: number, ya: number, xb: number, yb: number, w: number, depth: number, col: Color3): void {
  const dx = xb - xa, dy = yb - ya, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
  g.quad(xa - nx, ya - ny, depth, xb - nx, yb - ny, depth, xb + nx, yb + ny, depth, xa + nx, ya + ny, depth, col, 0, 0, 1);
  g.quad(xa + nx, ya + ny, depth, xb + nx, yb + ny, depth, xb + nx, yb + ny, 0, xa + nx, ya + ny, 0, shade(col, 0.8), nx, ny, 0);
}

/**
 * A slanted fin from (ax, ay, az) to (bx, by, bz) in tower-local space: `ex, ez` runs along the wall,
 * the fin sticks out along the wall's outward normal.
 */
export function slantFin(g: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ex: number, ez: number, w: number, depth: number, col: Color3): void {
  const el = Math.hypot(ex, ez) || 1;
  const ux = (ex / el) * (w / 2), uz = (ez / el) * (w / 2);
  const nx = (-ez / el) * depth, nz = (ex / el) * depth;
  g.quad(ax - ux + nx, ay, az - uz + nz, ax + ux + nx, ay, az + uz + nz, bx + ux + nx, by, bz + uz + nz, bx - ux + nx, by, bz - uz + nz, col, nx, 0, nz);
  if (depth > 0.015) {
    const side = shade(col, 0.86);
    g.quad(ax + ux, ay, az + uz, ax + ux + nx, ay, az + uz + nz, bx + ux + nx, by, bz + uz + nz, bx + ux, by, bz + uz, side, ux, 0, uz);
    g.quad(ax - ux + nx, ay, az - uz + nz, ax - ux, ay, az - uz, bx - ux, by, bz - uz, bx - ux + nx, by, bz - uz + nz, side, -ux, 0, -uz);
  }
}

/** A horizontal band in the current wall frame: front, top and bottom faces. */
export function band(g: Geo, x0: number, x1: number, y0: number, y1: number, depth: number, col: Color3, z = 0): void {
  const f = z + depth;
  g.quad(x0, y0, f, x1, y0, f, x1, y1, f, x0, y1, f, col, 0, 0, 1);
  if (depth > 0.015) {
    g.quad(x0, y1, f, x1, y1, f, x1, y1, z, x0, y1, z, shade(col, 1.06), 0, 1, 0);
    g.quad(x0, y0, z, x1, y0, z, x1, y0, f, x0, y0, f, shade(col, 0.7), 0, -1, 0);
  }
}

/** A dark box inside the glass of a segment (casts the shadow; nothing to see through gaps), kept inside any plate shape. */
export function coreFill(g: Geo, s: Seg, y0: number, y1: number, col: Color3): void {
  const hw = Math.min(s.w0, s.w1) / 2, hd = Math.min(s.d0, s.d1) / 2;
  const inset = s.corner === 'round' ? s.cr * 0.32 + 0.6 : s.corner === 'notch' ? s.cr + 0.4 : s.corner === 'chamfer' ? s.cr * 0.55 + 0.6 : 0.6;
  const ins = s.twist !== 0 ? Math.max(inset, Math.min(hw, hd) * 0.32) : inset;
  g.box(s.cx, y0, s.cz, Math.max(1, 2 * (hw - ins)), y1 - y0, Math.max(1, 2 * (hd - ins)), col);
}

