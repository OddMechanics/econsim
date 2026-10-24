// Small props drawn as thin instances: cups, plates, monitors, books, chairs,
// AC units, flower boxes... Every prop type ("template") is one shared mesh,
// and every building close to the camera adds instances (a world matrix and a
// tint color each), so hundreds of mugs cost one draw call. Templates bake
// their fixed colors into vertex colors; the instance color multiplies them
// (white parts take the tint, dark parts stay dark).
//
// Placement happens in a building's local frame through the same transform
// stack (Xf) the building generator uses, so props line up with furniture.

import { Color3, Mesh, type Material, type Scene, type ShadowGenerator } from '@babylonjs/core';
import { C, Geo, Xf, hx, shade, type Body } from './buildingGeo';
import type { Building } from '../sim/types';
import type { BuildingLook } from './buildings';

export type PropMat = 'solid' | 'warm' | 'screen' | 'ledA' | 'ledB' | 'clear';

const W = new Color3(1, 1, 1);
const DK = hx('#26282c'); // dark plastic
const DK2 = hx('#3b3f45');
const MET = hx('#a3aab0');
const STEEL = hx('#c9cdd1');
const WOOD = hx('#9b7048');
const WOODL = hx('#c49a66');
const GRN = hx('#4f8a3e');
const GRN2 = hx('#3c7034');
const GRN3 = hx('#6fa24a');
const TERRA = hx('#b5603f');
const CREAM = hx('#efe6d4');

interface Tpl { mat: PropMat; cast?: boolean; build(g: Geo): void }

/** Ring of `n` boxes approximating a torus segment (handles, wheels). */
function ring(g: Geo, cx: number, cy: number, cz: number, r: number, t: number, n: number, col: Color3, a0 = 0, a1 = Math.PI * 2, plane: 'xy' | 'zy' = 'xy'): void {
  for (let k = 0; k < n; k++) {
    const u0 = a0 + ((a1 - a0) * k) / n, u1 = a0 + ((a1 - a0) * (k + 1)) / n;
    const p = (u: number): [number, number, number] => plane === 'xy'
      ? [cx + Math.cos(u) * r, cy + Math.sin(u) * r, cz]
      : [cx, cy + Math.sin(u) * r, cz + Math.cos(u) * r];
    const A = p(u0), B = p(u1);
    g.beam(A[0], A[1], A[2], B[0], B[1], B[2], t, col);
  }
}

const T = {
  // ---------------------------------------------------------- primitives (tinted, scaled)
  box: { mat: 'solid', build: (g) => g.box(0, 0, 0, 1, 1, 1, W, 0, true) },
  block: { mat: 'solid', cast: true, build: (g) => g.box(0, 0, 0, 1, 1, 1, W, 0, true) },
  cyl: { mat: 'solid', build: (g) => g.cyl(0, 0, 0, 0.5, 0.5, 1, 8, W) },
  disc: { mat: 'solid', build: (g) => g.cyl(0, 0, 0, 0.47, 0.5, 1, 12, W) },
  ball: { mat: 'solid', build: (g) => g.blob(0, 0.5, 0, 0.5, 0.5, 0.5, W, 7, 4) },
  dome: { mat: 'solid', build: (g) => g.blob(0, 0, 0, 0.5, 1, 0.5, W, 8, 4, true) },
  cone: { mat: 'solid', build: (g) => g.cyl(0, 0, 0, 0.5, 0, 1, 8, W) },
  quad: { mat: 'solid', build: (g) => g.rect(-0.5, 0, 0.5, 1, 0, W) },
  screen: { mat: 'screen', build: (g) => g.rect(-0.5, 0, 0.5, 1, 0, W) },
  glowQuad: { mat: 'warm', build: (g) => g.rect(-0.5, 0, 0.5, 1, 0, W) },
  glowBall: { mat: 'warm', build: (g) => g.blob(0, 0.5, 0, 0.5, 0.5, 0.5, W, 6, 3) },
  glowBox: { mat: 'warm', build: (g) => g.box(0, 0, 0, 1, 1, 1, W, 0, true) },
  ledA: { mat: 'ledA', build: (g) => g.box(0, 0, 0, 1, 1, 1, W) },
  ledB: { mat: 'ledB', build: (g) => g.box(0, 0, 0, 1, 1, 1, W) },
  ledOn: { mat: 'screen', build: (g) => g.box(0, 0, 0, 1, 1, 1, W) },
  glassCup: { mat: 'clear', build: (g) => g.cyl(0, 0, 0, 0.42, 0.5, 1, 8, W) },

  // ---------------------------------------------------------- seating
  chairOffice: {
    mat: 'solid', cast: true, build: (g) => {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.beam(0, 0.07, 0, Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3, 0.04, DK);
        g.box(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0.05, 0.05, 0.05, DK);
      }
      g.cyl(0, 0.07, 0, 0.035, 0.035, 0.35, 6, MET);
      g.box(0, 0.42, 0, 0.5, 0.08, 0.48, W);
      g.box(0, 0.47, -0.25, 0.06, 0.12, 0.04, DK);
      g.box(0, 0.56, -0.27, 0.46, 0.56, 0.07, W);
      for (const sx of [-0.27, 0.27]) {
        g.box(sx, 0.47, 0.0, 0.03, 0.2, 0.03, DK);
        g.box(sx, 0.66, 0.02, 0.06, 0.03, 0.26, DK);
      }
    },
  },
  chairWood: {
    mat: 'solid', cast: true, build: (g) => {
      for (const [sx, sz] of [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]]) g.box(sx, 0, sz, 0.045, 0.44, 0.045, W);
      g.box(0, 0.44, 0, 0.46, 0.04, 0.46, W);
      for (const sx of [-0.2, 0.2]) g.box(sx, 0.48, -0.21, 0.04, 0.5, 0.04, W);
      g.box(0, 0.64, -0.21, 0.42, 0.07, 0.025, W);
      g.box(0, 0.86, -0.21, 0.44, 0.1, 0.03, W);
    },
  },
  chairBistro: {
    mat: 'solid', cast: true, build: (g) => {
      for (const [sx, sz] of [[-0.17, -0.17], [0.17, -0.17], [0.17, 0.17], [-0.17, 0.17]]) g.beam(sx * 0.8, 0.44, sz * 0.8, sx * 1.1, 0, sz * 1.1, 0.025, DK);
      g.cyl(0, 0.44, 0, 0.21, 0.21, 0.035, 10, W);
      g.beam(-0.17, 0.46, -0.15, -0.17, 0.82, -0.2, 0.025, DK);
      g.beam(0.17, 0.46, -0.15, 0.17, 0.82, -0.2, 0.025, DK);
      g.box(0, 0.68, -0.2, 0.36, 0.14, 0.025, W);
      g.box(0, 0.8, -0.2, 0.36, 0.04, 0.03, DK);
    },
  },
  chairArm: {
    // upholstered armchair (council, lounge)
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0.06, 0, 0.62, 0.36, 0.6, W);
      g.box(0, 0.42, 0.02, 0.5, 0.06, 0.52, shadeW(1.08));
      g.box(0, 0.06, -0.26, 0.62, 0.86, 0.1, W);
      for (const sx of [-0.28, 0.28]) g.box(sx, 0.06, 0.02, 0.08, 0.56, 0.56, shadeW(0.9));
      for (const [sx, sz] of [[-0.26, -0.24], [0.26, -0.24], [0.26, 0.24], [-0.26, 0.24]]) g.box(sx, 0, sz, 0.05, 0.06, 0.05, DK);
    },
  },
  seatTheater: {
    mat: 'solid', cast: true, build: (g) => {
      for (const sx of [-0.27, 0.27]) {
        g.box(sx, 0, 0, 0.05, 0.62, 0.5, DK2);
        g.box(sx, 0.62, 0.05, 0.07, 0.04, 0.42, DK);
      }
      g.box(0, 0.38, 0.04, 0.48, 0.09, 0.46, W);
      g.slab([-0.24, 0.45, -0.17, 0.24, 0.45, -0.17, 0.24, 0.98, -0.25, -0.24, 0.98, -0.25], 0.08, W, 0, 0.2, 1, shadeW(0.8));
      g.box(0, 0.14, -0.04, 0.5, 0.06, 0.06, DK);
    },
  },
  stool: {
    mat: 'solid', build: (g) => {
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g.beam(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, Math.cos(a) * 0.08, 0.45, Math.sin(a) * 0.08, 0.035, W); }
      g.cyl(0, 0.45, 0, 0.17, 0.17, 0.05, 8, W);
    },
  },
  beanBag: { mat: 'solid', cast: true, build: (g) => { g.blob(0, 0.24, 0, 0.42, 0.26, 0.42, W, 8, 4); g.blob(0, 0.42, -0.2, 0.34, 0.24, 0.18, shadeW(0.92), 7, 4); } },
  cushion: { mat: 'solid', build: (g) => g.blob(0, 0.2, 0, 0.21, 0.2, 0.07, W, 6, 4) },
  pillow: { mat: 'solid', build: (g) => g.blob(0, 0.06, 0, 0.32, 0.07, 0.19, W, 7, 4) },

  // ---------------------------------------------------------- office
  monitor: {
    // faces +Z; the screen template goes at (0, 0.14, 0.001) scaled 0.56 x 0.32
    mat: 'solid', build: (g) => {
      g.box(0, 0, -0.02, 0.22, 0.015, 0.16, DK);
      g.box(0, 0.015, -0.06, 0.05, 0.16, 0.03, DK2);
      g.box(0, 0.12, -0.02, 0.6, 0.36, 0.03, DK);
    },
  },
  keyboard: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.44, 0.018, 0.15, W); g.box(0, 0.018, 0.008, 0.41, 0.007, 0.115, shadeW(0.55)); } },
  laptop: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 0.34, 0.018, 0.24, W);
      g.box(0, 0.018, 0.02, 0.3, 0.003, 0.12, shadeW(0.4));
      g.slab([-0.17, 0.02, -0.12, 0.17, 0.02, -0.12, 0.17, 0.25, -0.17, -0.17, 0.25, -0.17], 0.012, W, 0, 0.2, 1, W);
    },
  },
  laptopScreen: { mat: 'screen', build: (g) => g.poly([-0.155, 0.035, -0.115, 0.155, 0.035, -0.115, 0.155, 0.235, -0.158, -0.155, 0.235, -0.158], W, 0, 0.2, 1) },
  mug: {
    mat: 'solid', build: (g) => {
      g.cyl(0, 0, 0, 0.04, 0.042, 0.095, 8, W, 0, true, hx('#4a2c1c'));
      ring(g, 0.05, 0.05, 0, 0.022, 0.012, 4, W, -Math.PI / 2, Math.PI / 2);
    },
  },
  deskLamp: {
    mat: 'solid', build: (g) => {
      g.cyl(0, 0, 0, 0.075, 0.07, 0.02, 8, DK);
      g.beam(0, 0.02, 0, 0.04, 0.3, -0.04, 0.018, MET);
      g.beam(0.04, 0.3, -0.04, 0.0, 0.42, 0.14, 0.018, MET);
      g.tube(0.0, 0.43, 0.12, 0.0, 0.33, 0.2, 0.03, 8, W, true, 0.075);
    },
  },
  phone: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.18, 0.05, 0.2, DK); g.box(-0.05, 0.05, 0, 0.05, 0.035, 0.19, DK2); g.box(0.04, 0.051, 0.03, 0.08, 0.004, 0.1, shadeW(0.5)); } },
  cashRegister: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.42, 0.12, 0.42, DK2);
      g.box(0, 0.12, 0.05, 0.38, 0.03, 0.26, shadeW(0.75));
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) g.box(-0.1 + k * 0.065, 0.15, 0.1 - r * 0.07, 0.045, 0.012, 0.045, k === 3 ? hx('#c0392b') : shadeW(0.9));
      g.box(0, 0.12, -0.13, 0.06, 0.18, 0.05, DK);
      g.box(0, 0.3, -0.14, 0.26, 0.15, 0.06, DK);
    },
  },
  cardTerminal: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.08, 0.025, 0.16, DK); g.box(0, 0.025, 0.02, 0.065, 0.004, 0.09, shadeW(0.6)); } },
  binder: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.05, 0.3, 0.24, W); g.box(0.026, 0.05, 0, 0.002, 0.08, 0.1, shadeW(1.2)); } },
  printer: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0, 0, 0.5, 0.3, 0.42, W); g.box(0, 0.3, -0.05, 0.44, 0.04, 0.26, shadeW(0.8)); g.box(0, 0.12, 0.21, 0.36, 0.04, 0.08, DK); } },
  filingCabinet: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.46, 1.32, 0.6, W);
      for (let k = 0; k < 4; k++) { g.box(0, 0.08 + k * 0.32, 0.301, 0.42, 0.005, 0.005, shadeW(0.6)); g.box(0, 0.24 + k * 0.32, 0.305, 0.14, 0.025, 0.02, MET); }
    },
  },
  whiteboard: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 1.8, 1.0, 0.04, MET);
      g.rect(-0.86, 0.05, 0.86, 0.95, 0.021, hx('#f7f7f4'));
      const ink = [hx('#2e5eaa'), hx('#c0392b'), hx('#222222'), hx('#27ae60')];
      for (let k = 0; k < 7; k++) g.rect(-0.75 + (k % 2) * 0.85, 0.82 - Math.floor(k / 2) * 0.2, -0.75 + (k % 2) * 0.85 + 0.3 + (k * 37 % 30) / 100, 0.84 - Math.floor(k / 2) * 0.2, 0.023, ink[k % 4]);
      g.box(0, 0.0, 0.05, 1.2, 0.03, 0.08, MET);
    },
  },
  wallClock: { mat: 'solid', build: (g) => { g.tube(0, 0, 0, 0, 0, 0.04, 0.17, 12, DK, true, 0.17, hx('#f5f2ea')); g.box(0, -0.01, 0.042, 0.012, 0.11, 0.004, DK); g.box(0.04, -0.006, 0.043, 0.09, 0.012, 0.004, DK); } },
  waterCooler: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0, 0, 0.32, 0.95, 0.32, hx('#e8e8e4')); g.box(0, 0.6, 0.161, 0.12, 0.08, 0.02, DK); } },
  coolerJug: { mat: 'clear', build: (g) => g.cyl(0, 0.95, 0, 0.14, 0.13, 0.42, 8, hx('#6fa6d6')) },
  coffeeMachine: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 0.3, 0.42, 0.34, DK);
      g.box(0, 0.42, -0.02, 0.28, 0.05, 0.3, MET);
      g.box(0, 0.12, 0.13, 0.22, 0.02, 0.1, MET);
      g.box(0, 0.28, 0.16, 0.05, 0.06, 0.04, MET);
    },
  },
  extinguisher: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.08, 0.08, 0.5, 8, hx('#c0392b')); g.cyl(0, 0.5, 0, 0.03, 0.03, 0.08, 5, DK); g.beam(0.02, 0.56, 0, 0.09, 0.45, 0.03, 0.015, DK); } },

  // ---------------------------------------------------------- dining & kitchen
  plate: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.1, 0.13, 0.016, 12, W); g.cyl(0, 0.016, 0, 0.085, 0.085, 0.002, 12, shadeW(0.96), 0, true); } },
  foodA: {
    // steak, potatoes and greens
    mat: 'solid', build: (g) => {
      g.blob(-0.02, 0.016, 0.01, 0.055, 0.022, 0.04, hx('#7a4026'), 6, 4, true);
      for (let k = 0; k < 3; k++) g.blob(0.05, 0.016, -0.04 + k * 0.035, 0.018, 0.018, 0.018, hx('#e2c060'), 5, 3);
      for (let k = 0; k < 3; k++) g.blob(-0.03 + k * 0.03, 0.016, -0.055, 0.02, 0.02, 0.02, GRN3, 5, 3);
    },
  },
  foodB: {
    // pasta with sauce
    mat: 'solid', build: (g) => {
      g.blob(0, 0.016, 0, 0.075, 0.035, 0.07, hx('#ecd27a'), 8, 4, true);
      g.blob(0.01, 0.03, 0.005, 0.04, 0.02, 0.035, hx('#b8321f'), 7, 4, true);
      g.blob(-0.01, 0.045, -0.01, 0.012, 0.012, 0.012, GRN, 5, 3);
    },
  },
  foodC: {
    // salad
    mat: 'solid', build: (g) => {
      for (let k = 0; k < 6; k++) { const a = k * 1.05; g.blob(Math.cos(a) * 0.04, 0.016, Math.sin(a) * 0.04, 0.035, 0.022, 0.03, k % 2 ? GRN3 : GRN, 5, 3); }
      for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.4; g.blob(Math.cos(a) * 0.03, 0.03, Math.sin(a) * 0.03, 0.016, 0.016, 0.016, hx('#d0342c'), 5, 3); }
    },
  },
  foodD: {
    // bowl of soup
    mat: 'solid', build: (g) => { g.cyl(0, 0.016, 0, 0.045, 0.075, 0.05, 10, W); g.cyl(0, 0.06, 0, 0.068, 0.068, 0.004, 10, hx('#d98a32')); },
  },
  cutlery: {
    mat: 'solid', build: (g) => {
      g.box(-0.16, 0, 0.0, 0.014, 0.004, 0.17, STEEL);
      for (let k = 0; k < 3; k++) g.box(-0.165 + k * 0.005, 0, 0.1, 0.003, 0.004, 0.04, STEEL);
      g.box(0.16, 0, 0.0, 0.016, 0.004, 0.2, STEEL);
    },
  },
  wineGlass: {
    mat: 'clear', build: (g) => {
      g.cyl(0, 0, 0, 0.03, 0.03, 0.004, 8, W);
      g.cyl(0, 0.004, 0, 0.006, 0.006, 0.08, 5, W);
      g.cyl(0, 0.084, 0, 0.022, 0.04, 0.075, 8, W);
    },
  },
  vase: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.035, 0.05, 0.08, 8, W); g.cyl(0, 0.08, 0, 0.05, 0.03, 0.06, 8, W); } },
  bouquet: {
    mat: 'solid', build: (g) => {
      for (let k = 0; k < 4; k++) { const a = k * 1.6; g.beam(0, 0.12, 0, Math.cos(a) * 0.05, 0.25, Math.sin(a) * 0.05, 0.008, GRN2); }
      const cols = [hx('#e2475a'), hx('#f4d03f'), hx('#f5f1ea'), hx('#e58fb0')];
      for (let k = 0; k < 4; k++) { const a = k * 1.6; g.blob(Math.cos(a) * 0.05, 0.25, Math.sin(a) * 0.05, 0.03, 0.025, 0.03, cols[k], 5, 3); }
      g.blob(0, 0.2, 0, 0.05, 0.03, 0.05, GRN, 5, 3);
    },
  },
  candle: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.035, 0.035, 0.012, 8, MET); g.cyl(0, 0.012, 0, 0.018, 0.018, 0.1, 6, W); } },
  flame: { mat: 'warm', build: (g) => g.cyl(0, 0, 0, 0.012, 0, 0.035, 5, hx('#ffcf6a')) },
  bottle: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.035, 0.035, 0.2, 8, W); g.cyl(0, 0.2, 0, 0.035, 0.013, 0.05, 8, W); g.cyl(0, 0.25, 0, 0.013, 0.013, 0.07, 6, W, 0, true, DK); } },
  pot: {
    mat: 'solid', build: (g) => {
      g.cyl(0, 0, 0, 0.13, 0.13, 0.16, 10, STEEL, 0, true, hx('#7d6a55'));
      for (const sx of [-0.15, 0.15]) g.box(sx, 0.12, 0, 0.05, 0.02, 0.04, DK);
      g.cyl(0, 0.16, 0, 0.135, 0.06, 0.03, 10, STEEL);
      g.cyl(0, 0.19, 0, 0.015, 0.015, 0.025, 5, DK);
    },
  },
  pan: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.12, 0.14, 0.04, 10, DK2, 0, true, DK); g.box(0, 0.025, 0.25, 0.03, 0.02, 0.24, DK); } },
  cuttingBoard: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.42, 0.02, 0.28, WOODL); g.box(0.05, 0.02, 0.04, 0.2, 0.004, 0.025, STEEL); g.box(-0.07, 0.02, 0.04, 0.08, 0.012, 0.02, DK); } },
  fridge: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.7, 1.85, 0.66, W);
      g.box(0, 1.15, 0.331, 0.68, 0.01, 0.005, shadeW(0.6));
      g.box(-0.28, 1.25, 0.34, 0.03, 0.4, 0.03, MET);
      g.box(-0.28, 0.55, 0.34, 0.03, 0.45, 0.03, MET);
    },
  },
  stoveHome: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.6, 0.9, 0.6, W);
      g.box(0, 0.9, 0, 0.6, 0.01, 0.6, DK);
      for (const [sx, sz] of [[-0.14, -0.14], [0.14, -0.14], [0.14, 0.12], [-0.14, 0.12]]) g.cyl(sx, 0.905, sz, 0.08, 0.08, 0.008, 8, DK2);
      g.box(0, 0.18, 0.301, 0.46, 0.4, 0.01, DK);
      g.box(0, 0.62, 0.31, 0.44, 0.025, 0.03, MET);
      for (let k = 0; k < 4; k++) g.box(-0.2 + k * 0.13, 0.78, 0.305, 0.04, 0.04, 0.02, DK);
    },
  },
  sink: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.8, 0.88, 0.6, W);
      g.box(0, 0.88, 0, 0.82, 0.03, 0.62, hx('#8e8a82'));
      g.box(0, 0.84, 0.0, 0.5, 0.072, 0.38, STEEL);
      g.box(0, 0.89, -0.24, 0.04, 0.24, 0.04, STEEL);
      g.box(0, 1.1, -0.17, 0.03, 0.03, 0.18, STEEL);
      for (const sx of [-0.2, 0.2]) g.box(sx, 0.05, 0.301, 0.36, 0.72, 0.01, shadeW(0.92));
    },
  },
  counterUnit: {
    // kitchen base cabinet with stone top (0.6 wide)
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.6, 0.88, 0.6, W);
      g.box(0, 0.88, 0, 0.62, 0.035, 0.62, hx('#8e8a82'));
      g.box(0, 0.06, 0.301, 0.56, 0.78, 0.01, shadeW(0.93));
      g.box(0.2, 0.62, 0.31, 0.12, 0.02, 0.02, MET);
    },
  },
  wallCabinet: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.6, 0.7, 0.34, W); g.box(0, 0.03, 0.171, 0.56, 0.64, 0.01, shadeW(0.93)); g.box(0.2, 0.08, 0.18, 0.1, 0.02, 0.02, MET); } },
  microwave: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.48, 0.28, 0.36, W); g.box(-0.06, 0.04, 0.181, 0.3, 0.2, 0.005, DK); g.box(0.17, 0.05, 0.182, 0.08, 0.18, 0.005, shadeW(0.7)); } },
  kettle: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.08, 0.06, 0.2, 8, W); g.beam(0.07, 0.17, 0, 0.11, 0.05, 0, 0.02, W); g.beam(-0.06, 0.12, 0, -0.11, 0.2, 0, 0.012, W); } },
  toaster: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.28, 0.18, 0.16, W); g.box(0, 0.18, -0.03, 0.2, 0.005, 0.025, DK); g.box(0, 0.18, 0.03, 0.2, 0.005, 0.025, DK); } },
  hood: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.42, 0.12, 0.35, 4, STEEL, Math.PI / 4); g.box(0, 0.35, 0, 0.18, 0.6, 0.18, STEEL); } },

  // ---------------------------------------------------------- home
  tableDining: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0.72, 0, 1.3, 0.045, 0.82, W);
      g.box(0, 0.66, 0, 1.18, 0.06, 0.7, shadeW(0.85));
      for (const [sx, sz] of [[-0.58, -0.34], [0.58, -0.34], [0.58, 0.34], [-0.58, 0.34]]) g.box(sx, 0, sz, 0.06, 0.72, 0.06, shadeW(0.9));
    },
  },
  coffeeTable: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0.36, 0, 1.0, 0.05, 0.55, W); g.box(0, 0.08, 0, 0.9, 0.02, 0.46, shadeW(0.85)); for (const [sx, sz] of [[-0.46, -0.24], [0.46, -0.24], [0.46, 0.24], [-0.46, 0.24]]) g.box(sx, 0, sz, 0.05, 0.36, 0.05, shadeW(0.8)); } },
  nightstand: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0, 0, 0.46, 0.52, 0.4, W); g.box(0, 0.52, 0, 0.48, 0.02, 0.42, shadeW(0.9)); g.box(0, 0.3, 0.201, 0.4, 0.004, 0.005, shadeW(0.6)); g.box(0, 0.4, 0.205, 0.1, 0.02, 0.02, MET); } },
  wardrobe: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 1.4, 2.05, 0.6, W);
      g.box(0, 2.05, 0, 1.44, 0.04, 0.62, shadeW(0.85));
      g.box(0, 0.06, 0.301, 0.006, 1.94, 0.006, shadeW(0.55));
      for (const sx of [-0.06, 0.06]) g.box(sx, 0.95, 0.31, 0.02, 0.3, 0.02, MET);
    },
  },
  bookshelf: {
    // 0.9 wide, 0.3 deep, 1.9 tall, 5 shelves; books are separate instances
    mat: 'solid', cast: true, build: (g) => {
      for (const sx of [-0.44, 0.44]) g.box(sx, 0, 0, 0.025, 1.9, 0.3, W);
      g.box(0, 0, -0.14, 0.9, 1.9, 0.015, shadeW(0.85));
      for (let k = 0; k < 6; k++) g.box(0, k * 0.37, 0, 0.88, 0.025, 0.3, W);
    },
  },
  tableLamp: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.07, 0.08, 0.02, 8, DK); g.cyl(0, 0.02, 0, 0.05, 0.03, 0.22, 8, W); g.cyl(0, 0.24, 0, 0.14, 0.09, 0.18, 8, CREAM, 0, false); } },
  floorLamp: { mat: 'solid', cast: true, build: (g) => { g.cyl(0, 0, 0, 0.16, 0.16, 0.03, 8, DK); g.cyl(0, 0.03, 0, 0.018, 0.018, 1.45, 5, MET); g.cyl(0, 1.38, 0, 0.22, 0.14, 0.26, 8, W, 0, false); } },
  tv: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.36, 0.02, 0.2, DK); g.box(0, 0.02, -0.02, 0.06, 0.08, 0.04, DK); g.box(0, 0.08, -0.02, 1.12, 0.66, 0.05, DK); } },
  rug: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 1, 0.01, 1, shadeW(0.7)); g.box(0, 0.002, 0, 0.88, 0.011, 0.84, W); g.box(0, 0.003, 0, 0.6, 0.011, 0.5, shadeW(0.85)); } },
  picture: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 1, 1, 0.035, hx('#5a4430'));
      g.rect(-0.44, 0.06, 0.44, 0.5, 0.018, hx('#7aa060'));
      g.rect(-0.44, 0.5, 0.44, 0.94, 0.018, hx('#9fc4e0'));
      g.rect(0.14, 0.62, 0.3, 0.78, 0.019, hx('#f2d36b'));
      g.poly([-0.44, 0.45, 0.019, 0.0, 0.45, 0.019, -0.2, 0.75, 0.019], hx('#5d7a8a'), 0, 0, 1);
    },
  },
  plantPot: {
    // small potted plant (table / sill)
    mat: 'solid', build: (g) => {
      g.cyl(0, 0, 0, 0.06, 0.075, 0.1, 8, TERRA);
      for (let k = 0; k < 5; k++) { const a = k * 1.26; g.blob(Math.cos(a) * 0.04, 0.12, Math.sin(a) * 0.04, 0.05, 0.06, 0.05, k % 2 ? GRN : GRN3, 5, 3); }
    },
  },
  plantFloor: {
    // tall floor plant in a white pot
    mat: 'solid', cast: true, build: (g) => {
      g.cyl(0, 0, 0, 0.17, 0.21, 0.42, 10, hx('#ecebe6'));
      g.cyl(0, 0.42, 0, 0.025, 0.02, 0.5, 5, hx('#6b4a2e'));
      g.blob(0, 1.0, 0, 0.32, 0.36, 0.32, GRN, 7, 4);
      g.blob(0.12, 1.25, -0.06, 0.22, 0.24, 0.22, GRN3, 6, 4);
      g.blob(-0.14, 0.82, 0.08, 0.2, 0.18, 0.2, GRN2, 6, 4);
    },
  },
  plantBush: {
    mat: 'solid', cast: true, build: (g) => {
      g.cyl(0, 0, 0, 0.2, 0.17, 0.32, 8, hx('#5d6670'));
      for (let k = 0; k < 6; k++) { const a = k * 1.05; g.blob(Math.cos(a) * 0.12, 0.42, Math.sin(a) * 0.12, 0.16, 0.18, 0.16, k % 2 ? GRN : GRN2, 6, 3); }
      g.blob(0, 0.6, 0, 0.17, 0.17, 0.17, GRN3, 6, 3);
    },
  },
  book: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 1, 1, 1, W); g.box(0, 0.85, 0.501, 1.02, 0.05, 0.002, shadeW(1.25)); g.box(0, 0.15, 0.501, 1.02, 0.05, 0.002, shadeW(1.25)); } },
  bookRowA: { mat: 'solid', build: (g) => bookRow(g, 1) },
  bookRowB: { mat: 'solid', build: (g) => bookRow(g, 2) },
  bookRowC: { mat: 'solid', build: (g) => bookRow(g, 3) },
  remote: { mat: 'solid', build: (g) => g.box(0, 0, 0, 0.05, 0.02, 0.17, DK) },
  laundry: {
    // drying rack with clothes
    mat: 'solid', build: (g) => {
      for (const sz of [-0.25, 0.25]) { g.beam(-0.5, 0, sz, 0.5, 0.9, sz * 0.4, 0.02, MET); g.beam(0.5, 0, sz, -0.5, 0.9, sz * 0.4, 0.02, MET); }
      for (let k = 0; k < 4; k++) g.box(0, 0.86, -0.12 + k * 0.08, 1.0, 0.012, 0.012, MET);
      const cols = [hx('#d35454'), hx('#f5f1ea'), hx('#5b8bd0'), hx('#f2c94c'), hx('#7ab37a')];
      for (let k = 0; k < 5; k++) g.box(-0.36 + k * 0.18, 0.5, -0.12 + (k % 4) * 0.08, 0.14, 0.36, 0.01, cols[k]);
    },
  },

  // ---------------------------------------------------------- exterior
  acUnit: {
    // rooftop condenser (1.2 x 0.9 x 0.9)
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 1.2, 0.9, 0.9, W);
      g.cyl(0, 0.9, 0, 0.36, 0.36, 0.02, 10, DK);
      g.box(0, 0.92, 0, 0.7, 0.012, 0.04, DK2);
      g.box(0, 0.92, 0, 0.04, 0.012, 0.7, DK2);
      for (let k = 0; k < 6; k++) g.box(-0.45 + k * 0.18, 0.15, 0.451, 0.1, 0.6, 0.006, shadeW(0.75));
      g.box(-0.5, 0, 0.5, 0.06, 0.06, 0.2, DK);
    },
  },
  acWall: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.62, 0.42, 0.52, W); for (let k = 0; k < 5; k++) g.box(0, 0.06 + k * 0.07, 0.261, 0.54, 0.02, 0.005, shadeW(0.7)); g.box(0, -0.06, -0.15, 0.5, 0.06, 0.04, MET); } },
  ventPipe: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.08, 0.08, 0.55, 8, MET); g.cyl(0, 0.55, 0, 0.16, 0.05, 0.12, 8, MET); g.cyl(0, 0.5, 0, 0.16, 0.16, 0.05, 8, MET, 0, false); } },
  ventBox: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0, 0, 0.8, 0.5, 0.8, W); g.box(0, 0.5, 0, 0.9, 0.06, 0.9, shadeW(0.85)); for (let k = 0; k < 3; k++) g.box(0, 0.1 + k * 0.12, 0.401, 0.66, 0.05, 0.01, DK2); } },
  turbineVent: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.18, 0.18, 0.3, 8, MET); g.blob(0, 0.3, 0, 0.24, 0.3, 0.24, STEEL, 10, 4, true); } },
  antenna: {
    mat: 'solid', build: (g) => {
      g.cyl(0, 0, 0, 0.12, 0.12, 0.08, 6, DK);
      g.cyl(0, 0.08, 0, 0.025, 0.02, 2.4, 5, MET);
      for (let k = 0; k < 3; k++) {
        const y = 1.7 + k * 0.28, l = 1.1 - k * 0.25;
        g.box(0, y, 0, 0.03, 0.03, l, MET);
        for (let j = 0; j < 5; j++) g.box(0, y, -l / 2 + (j + 0.5) * (l / 5), 0.5 - k * 0.1, 0.015, 0.015, MET);
      }
    },
  },
  satDish: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, -0.05, 0.05, 0.6, 0.05, MET);
      g.tube(0, 0.6, 0.0, 0, 0.75, 0.16, 0.06, 10, hx('#ecebe6'), true, 0.34);
      g.beam(0, 0.6, 0.02, 0, 0.9, 0.42, 0.015, MET);
      g.box(0, 0.86, 0.42, 0.05, 0.06, 0.08, DK);
    },
  },
  skylight: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 1.2, 0.3, 1.2, MET); g.slab([-0.55, 0.3, 0.55, 0.55, 0.3, 0.55, 0.55, 0.45, -0.55, -0.55, 0.45, -0.55], 0.03, hx('#3e5a70'), 0, 1, 0.3, MET); } },
  roofHatch: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.9, 0.45, 0.9, W); g.box(0, 0.45, 0, 0.96, 0.05, 0.96, shadeW(0.8)); } },
  flowerBox: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 1, 0.18, 0.22, W); g.box(0, 0.17, 0, 0.95, 0.02, 0.18, hx('#5a3e2a')); } },
  flowerLeaves: { mat: 'solid', build: (g) => { for (let k = 0; k < 5; k++) g.blob(-0.4 + k * 0.2, 0.2, 0, 0.13, 0.1, 0.09, k % 2 ? GRN : GRN3, 5, 3); } },
  flowerHeads: { mat: 'solid', build: (g) => { for (let k = 0; k < 7; k++) g.blob(-0.42 + k * 0.14, 0.28 + (k % 2) * 0.03, (k % 3 - 1) * 0.04, 0.035, 0.03, 0.035, W, 5, 3); } },
  bistroTable: { mat: 'solid', cast: true, build: (g) => { g.cyl(0, 0, 0, 0.2, 0.2, 0.02, 8, DK); g.cyl(0, 0.02, 0, 0.025, 0.025, 0.68, 5, DK); g.cyl(0, 0.7, 0, 0.3, 0.3, 0.025, 12, W); } },
  umbrella: { mat: 'solid', cast: true, build: (g) => { g.cyl(0, 0, 0, 0.025, 0.025, 2.2, 5, hx('#ecebe6')); g.cyl(0, 1.85, 0, 1.2, 0.04, 0.4, 8, W, 0.2, true, shadeW(0.75)); } },
  bike: {
    mat: 'solid', build: (g) => {
      for (const z of [-0.52, 0.52]) ring(g, 0, 0.34, z, 0.32, 0.03, 10, DK, 0, Math.PI * 2, 'zy');
      g.beam(0, 0.34, -0.52, 0, 0.62, -0.05, 0.03, W);
      g.beam(0, 0.62, -0.05, 0, 0.66, 0.4, 0.03, W);
      g.beam(0, 0.34, -0.52, 0, 0.34, 0.0, 0.03, W);
      g.beam(0, 0.34, 0.0, 0, 0.66, 0.4, 0.03, W);
      g.beam(0, 0.34, 0.0, 0, 0.62, -0.05, 0.03, W);
      g.beam(0, 0.66, 0.4, 0, 0.34, 0.52, 0.025, W);
      g.box(0, 0.68, -0.08, 0.1, 0.04, 0.2, DK);
      g.box(0, 0.86, 0.42, 0.5, 0.025, 0.025, DK);
      g.beam(0, 0.66, 0.4, 0, 0.86, 0.42, 0.025, W);
    },
  },
  bikeRack: { mat: 'solid', build: (g) => { for (let k = 0; k < 4; k++) ring(g, -0.9 + k * 0.6, 0, 0, 0.35, 0.04, 6, MET, 0, Math.PI, 'zy'); g.box(0, 0, 0, 2.0, 0.04, 0.06, MET); } },
  trashBin: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0.05, 0, 0.6, 0.95, 0.7, W); g.box(0, 1.0, -0.02, 0.64, 0.08, 0.76, shadeW(0.75)); for (const sx of [-0.22, 0.22]) g.cyl(sx, 0, -0.3, 0.07, 0.07, 0.05, 6, DK); } },
  litterBin: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.22, 0.24, 0.85, 8, W); g.cyl(0, 0.85, 0, 0.25, 0.2, 0.08, 8, shadeW(0.8)); } },
  mailboxBank: {
    // 6 x 3 letter boxes on a wall (1.2 wide x 0.8 tall)
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 1.2, 0.8, 0.22, W);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
        const x = -0.5 + k * 0.2, y = 0.06 + r * 0.25;
        g.box(x, y, 0.111, 0.17, 0.2, 0.01, shadeW(0.86));
        g.box(x, y + 0.14, 0.12, 0.1, 0.012, 0.01, DK);
      }
    },
  },
  intercom: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.18, 0.32, 0.04, MET); for (let k = 0; k < 6; k++) g.box(0, 0.05 + k * 0.04, 0.021, 0.12, 0.02, 0.006, DK); } },
  bollard: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.1, 0.1, 0.85, 8, W); g.cyl(0, 0.7, 0, 0.105, 0.105, 0.05, 8, hx('#e8b631'), 0, false); } },
  sandwichBoard: {
    mat: 'solid', cast: true, build: (g) => {
      g.slab([-0.3, 0.0, 0.3, 0.3, 0.0, 0.3, 0.3, 0.95, 0.03, -0.3, 0.95, 0.03], 0.03, DK2, 0, 0.3, 1, DK2);
      g.slab([0.3, 0.0, -0.3, -0.3, 0.0, -0.3, -0.3, 0.95, -0.03, 0.3, 0.95, -0.03], 0.03, DK2, 0, 0.3, -1, DK2);
      g.poly([-0.25, 0.08, 0.29, 0.25, 0.08, 0.29, 0.25, 0.86, 0.06, -0.25, 0.86, 0.06], hx('#1e2a24'), 0, 0.3, 1);
      for (let k = 0; k < 4; k++) g.poly([-0.18, 0.62 - k * 0.15, 0.13 + k * 0.042 + 0.012, 0.12 - (k % 2) * 0.08, 0.62 - k * 0.15, 0.13 + k * 0.042 + 0.012, 0.12 - (k % 2) * 0.08, 0.66 - k * 0.15, 0.12 + k * 0.042 + 0.012, -0.18, 0.66 - k * 0.15, 0.12 + k * 0.042 + 0.012], k ? hx('#f4f1ea') : hx('#f4d03f'), 0, 0.3, 1);
    },
  },
  crate: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0, 0, 1, 0.8, 1, W); for (const y of [0.05, 0.38, 0.7]) { g.box(0, y, 0.502, 1.0, 0.07, 0.01, shadeW(0.8)); g.box(0, y, -0.502, 1.0, 0.07, 0.01, shadeW(0.8)); g.box(0.502, y, 0, 0.01, 0.07, 1.0, shadeW(0.8)); g.box(-0.502, y, 0, 0.01, 0.07, 1.0, shadeW(0.8)); } } },
  pallet: { mat: 'solid', cast: true, build: (g) => { for (const sz of [-0.5, 0, 0.5]) g.box(0, 0, sz, 1.2, 0.1, 0.12, WOODL); for (let k = 0; k < 6; k++) g.box(-0.5 + k * 0.2, 0.1, 0, 0.14, 0.03, 1.2, WOODL); } },
  barrel: { mat: 'solid', cast: true, build: (g) => { g.cyl(0, 0, 0, 0.29, 0.29, 0.88, 10, W, 0, true, shadeW(0.8)); for (const y of [0.18, 0.66]) g.cyl(0, y, 0, 0.3, 0.3, 0.05, 10, shadeW(0.7), 0, false); } },
  gasCylinder: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.12, 0.12, 1.25, 8, W); g.blob(0, 1.25, 0, 0.12, 0.08, 0.12, W, 8, 3, true); g.cyl(0, 1.32, 0, 0.04, 0.04, 0.1, 5, MET); } },
  forklift: {
    mat: 'solid', cast: true, build: (g) => {
      const Y = hx('#e8b631');
      g.box(0, 0.2, -0.2, 1.1, 0.7, 1.6, Y);
      g.box(0, 0.9, -0.55, 1.0, 0.5, 0.7, Y);
      for (const sx of [-0.45, 0.45]) g.box(sx, 0.9, 0.0, 0.06, 1.25, 0.06, DK);
      g.box(0, 2.1, -0.25, 1.0, 0.06, 0.8, DK);
      for (const sx of [-0.45, 0.45]) g.box(sx, 0.9, -0.62, 0.06, 1.2, 0.06, DK);
      g.box(0, 0.95, -0.2, 0.4, 0.1, 0.4, DK);
      for (const sx of [-0.25, 0.25]) g.box(sx, 0.05, 0.95, 0.12, 0.05, 1.0, MET);
      for (const sx of [-0.52, 0.52]) g.box(sx, 0.05, 0.62, 0.08, 1.9, 0.1, DK2);
      for (const [sx, sz] of [[-0.56, 0.35], [0.56, 0.35], [-0.56, -0.7], [0.56, -0.7]]) g.tube(sx - 0.1, 0.25, sz, sx + 0.1, 0.25, sz, 0.25, 8, DK);
    },
  },
  toolboard: {
    mat: 'solid', build: (g) => {
      g.box(0, 0, 0, 1.6, 1.0, 0.03, hx('#cdb68a'));
      const cols = [hx('#c0392b'), DK, hx('#2e6da4'), MET];
      for (let k = 0; k < 8; k++) g.box(-0.65 + k * 0.18, 0.35 + (k % 2) * 0.15, 0.025, 0.05, 0.35 + (k % 3) * 0.08, 0.02, cols[k % 4]);
      g.box(0.4, 0.1, 0.025, 0.5, 0.08, 0.03, DK);
    },
  },
  workbench: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0.86, 0, 1.8, 0.06, 0.75, WOODL);
      for (const [sx, sz] of [[-0.84, -0.32], [0.84, -0.32], [0.84, 0.32], [-0.84, 0.32]]) g.box(sx, 0, sz, 0.06, 0.86, 0.06, DK2);
      g.box(0, 0.2, 0, 1.7, 0.03, 0.7, WOOD);
      g.box(0.7, 0.92, 0.32, 0.18, 0.12, 0.14, hx('#2e6da4'));
      g.box(-0.4, 0.92, -0.1, 0.4, 0.1, 0.22, hx('#c0392b'));
    },
  },
  toolbox: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.5, 0.22, 0.24, W); g.box(0, 0.22, 0, 0.3, 0.05, 0.03, DK); g.box(0, 0.1, 0.121, 0.46, 0.01, 0.005, DK); } },
  wheelbarrow: {
    mat: 'solid', cast: true, build: (g) => {
      g.cyl(0, 0.3, 0.15, 0.35, 0.25, 0.3, 4, W, Math.PI / 4);
      g.tube(-0.05, 0.2, 0.62, 0.05, 0.2, 0.62, 0.2, 8, DK);
      for (const sx of [-0.25, 0.25]) { g.beam(sx, 0.3, 0.6, sx * 1.3, 0.55, -0.6, 0.035, DK2); g.box(sx * 0.9, 0, -0.25, 0.04, 0.32, 0.04, DK2); }
    },
  },
  ladder: { mat: 'solid', build: (g) => { for (const sx of [-0.22, 0.22]) g.box(sx, 0, 0, 0.05, 3.0, 0.08, MET); for (let k = 0; k < 10; k++) g.box(0, 0.25 + k * 0.28, 0, 0.44, 0.035, 0.035, MET); } },
  bucket: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.12, 0.15, 0.3, 8, W, 0, true, hx('#9a9690')); ring(g, 0, 0.3, 0, 0.14, 0.008, 5, DK, 0, Math.PI); } },
  hardhat: { mat: 'solid', build: (g) => { g.blob(0, 0.0, 0, 0.13, 0.13, 0.15, W, 8, 4, true); g.cyl(0, 0.0, 0.02, 0.17, 0.17, 0.012, 10, W); } },
  rebar: { mat: 'solid', build: (g) => { for (let k = 0; k < 9; k++) g.box(-0.12 + (k % 3) * 0.12, 0.04 + Math.floor(k / 3) * 0.06, 0, 0.025, 0.025, 4.0, hx('#7a4a32')); g.box(0, 0, -1.2, 0.4, 0.04, 0.12, WOOD); g.box(0, 0, 1.2, 0.4, 0.04, 0.12, WOOD); } },
  trafficCone: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.38, 0.04, 0.38, DK); g.cyl(0, 0.04, 0, 0.16, 0.03, 0.66, 8, hx('#e8612c')); g.cyl(0, 0.36, 0, 0.1, 0.085, 0.1, 8, hx('#f4f1ea'), 0, false); } },
  skip: {
    mat: 'solid', cast: true, build: (g) => {
      g.poly([-1.6, 0.1, 0.9, 1.6, 0.1, 0.9, 1.9, 1.3, 0.9, -1.9, 1.3, 0.9], W, 0, 0, 1);
      g.poly([1.6, 0.1, -0.9, -1.6, 0.1, -0.9, -1.9, 1.3, -0.9, 1.9, 1.3, -0.9], W, 0, 0, -1);
      g.poly([1.6, 0.1, 0.9, 1.6, 0.1, -0.9, 1.9, 1.3, -0.9, 1.9, 1.3, 0.9], shadeW(0.9), 1, 0, 0);
      g.poly([-1.6, 0.1, -0.9, -1.6, 0.1, 0.9, -1.9, 1.3, 0.9, -1.9, 1.3, -0.9], shadeW(0.9), -1, 0, 0);
      g.box(0, 0.1, 0, 3.2, 0.02, 1.8, shadeW(0.6));
      g.blob(0.2, 0.3, 0, 1.4, 0.8, 0.7, hx('#8a8070'), 7, 4, true);
    },
  },
  generator: { mat: 'solid', cast: true, build: (g) => { g.box(0, 0.1, 0, 1.4, 0.8, 0.8, W); g.box(0, 0, 0, 1.5, 0.1, 0.9, DK); g.box(0.45, 0.25, 0.401, 0.35, 0.3, 0.01, DK2); g.cyl(-0.5, 0.9, 0, 0.05, 0.05, 0.3, 6, DK); } },
  siteLight: { mat: 'solid', build: (g) => { for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g.beam(0, 1.0, 0, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, 0.03, DK); } g.cyl(0, 1.0, 0, 0.025, 0.025, 2.0, 5, MET); g.box(0, 3.0, 0.05, 0.5, 0.36, 0.14, DK); } },
  netting: { mat: 'clear', build: (g) => g.rect(-0.5, 0, 0.5, 1, 0, hx('#3f8f5a')) },
  hydrant: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.13, 0.11, 0.6, 8, hx('#c0392b')); g.blob(0, 0.6, 0, 0.12, 0.1, 0.12, hx('#c0392b'), 6, 3, true); for (const sx of [-0.12, 0.12]) g.tube(sx * 0.6, 0.4, 0, sx * 1.4, 0.4, 0, 0.045, 6, hx('#c0392b')); } },
  elecBox: { mat: 'solid', build: (g) => { g.box(0, 0, 0, 0.7, 1.0, 0.3, W); g.box(0, 0.08, 0.151, 0.62, 0.84, 0.01, shadeW(0.9)); g.box(0.24, 0.45, 0.16, 0.03, 0.12, 0.02, DK); } },
  pipeRun: { mat: 'solid', build: (g) => { g.tube(0, 0, 0, 0, 1, 0, 0.09, 8, W); } },

  // ---------------------------------------------------------- media & civic
  serverRack: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.62, 2.0, 1.0, hx('#1d1f22'));
      g.box(0, 0.04, 0.501, 0.56, 1.9, 0.01, hx('#2b2e33'));
      for (let k = 0; k < 14; k++) g.box(0, 0.12 + k * 0.13, 0.507, 0.5, 0.1, 0.008, k % 3 ? hx('#3a3e44') : hx('#23262a'));
      g.box(0, 2.0, 0, 0.64, 0.04, 1.02, DK2);
    },
  },
  tvCamera: {
    // pedestal camera looking along +Z, lens at y ~1.45
    mat: 'solid', cast: true, build: (g) => {
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; g.beam(0, 0.9, 0, Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45, 0.04, DK); g.blob(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, 0.06, 0.06, 0.06, DK2, 5, 3); }
      g.cyl(0, 0.85, 0, 0.06, 0.05, 0.42, 6, MET);
      g.box(0, 1.27, 0, 0.18, 0.06, 0.2, DK);
      g.box(0, 1.33, -0.05, 0.24, 0.26, 0.5, hx('#3a3d42'));
      g.tube(0, 1.46, 0.2, 0, 1.46, 0.48, 0.09, 10, DK, true, 0.1, hx('#1a2a3a'));
      g.box(0.18, 1.5, -0.12, 0.12, 0.12, 0.2, DK);
      for (const sx of [-0.22, 0.22]) g.beam(sx * 0.4, 1.3, -0.25, sx, 1.2, -0.65, 0.025, MET);
      g.box(-0.05, 1.6, -0.02, 0.06, 0.06, 0.24, DK2);
    },
  },
  cameraTally: { mat: 'screen', build: (g) => g.box(0, 0, 0, 0.05, 0.03, 0.03, W) },
  studioLight: {
    // hanging spotlight aimed down/forward along +Z; lens via 'spotLens'
    mat: 'solid', build: (g) => {
      g.box(0, -0.06, 0, 0.04, 0.12, 0.04, DK);
      g.box(0, -0.4, 0, 0.36, 0.03, 0.03, DK);
      for (const sx of [-0.18, 0.18]) g.box(sx, -0.4, 0, 0.03, 0.34, 0.03, DK);
      g.tube(0, -0.12, -0.18, 0, -0.32, 0.16, 0.14, 8, DK, true, 0.12);
    },
  },
  spotLens: { mat: 'warm', build: (g) => g.tube(0, -0.32, 0.16, 0, -0.335, 0.185, 0.11, 8, hx('#fff2cc')) },
  truss: { mat: 'solid', build: (g) => { for (const [sy, sz] of [[0, -0.15], [0, 0.15], [0.3, 0]]) g.box(0, sy, sz, 1, 0.04, 0.04, MET); for (let k = 0; k < 5; k++) { const x = -0.5 + k * 0.25; g.beam(x, 0, -0.15, x + 0.125, 0.3, 0, 0.02, MET); g.beam(x, 0, 0.15, x + 0.125, 0.3, 0, 0.02, MET); } } },
  softbox: { mat: 'solid', cast: true, build: (g) => { for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g.beam(0, 0.7, 0, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 0.025, DK); } g.cyl(0, 0.7, 0, 0.02, 0.02, 1.0, 5, MET); g.box(0, 1.55, -0.12, 0.6, 0.6, 0.3, DK); } },
  softboxFace: { mat: 'warm', build: (g) => g.rect(-0.27, 1.58, 0.27, 2.12, 0.035, hx('#fffaf0')) },
  lectern: {
    mat: 'solid', cast: true, build: (g) => {
      g.box(0, 0, 0, 0.7, 0.06, 0.5, shadeW(0.8));
      g.poly([-0.3, 0.06, 0.2, 0.3, 0.06, 0.2, 0.33, 1.02, 0.23, -0.33, 1.02, 0.23], W, 0, 0, 1);
      g.poly([0.3, 0.06, -0.2, -0.3, 0.06, -0.2, -0.33, 1.02, -0.15, 0.33, 1.02, -0.15], shadeW(0.85), 0, 0, -1);
      g.poly([0.3, 0.06, 0.2, 0.3, 0.06, -0.2, 0.33, 1.02, -0.15, 0.33, 1.02, 0.23], shadeW(0.9), 1, 0, 0);
      g.poly([-0.3, 0.06, -0.2, -0.3, 0.06, 0.2, -0.33, 1.02, 0.23, -0.33, 1.02, -0.15], shadeW(0.9), -1, 0, 0);
      g.slab([-0.36, 1.02, 0.25, 0.36, 1.02, 0.25, 0.36, 1.14, -0.2, -0.36, 1.14, -0.2], 0.03, shadeW(0.9), 0, 1, -0.3, shadeW(0.7));
      g.box(0, 0.55, 0.215, 0.36, 0.26, 0.02, hx('#e8c56a'));
    },
  },
  mic: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.04, 0.04, 0.015, 6, DK); g.beam(0, 0.015, 0, 0, 0.18, -0.02, 0.012, DK2); g.beam(0, 0.18, -0.02, 0, 0.3, -0.12, 0.01, DK2); g.blob(0, 0.3, -0.135, 0.018, 0.018, 0.03, DK, 5, 3); } },
  namePlate: { mat: 'solid', build: (g) => { g.slab([-0.13, 0, -0.03, 0.13, 0, -0.03, 0.13, 0.08, 0, -0.13, 0.08, 0], 0.006, W, 0, 0.3, -1); g.slab([0.13, 0, 0.03, -0.13, 0, 0.03, -0.13, 0.08, 0, 0.13, 0.08, 0], 0.006, W, 0, 0.3, 1); g.poly([-0.09, 0.03, 0.022, 0.09, 0.03, 0.022, 0.09, 0.045, 0.0125, -0.09, 0.045, 0.0125], DK, 0, 0.3, 1); g.poly([0.09, 0.03, -0.022, -0.09, 0.03, -0.022, -0.09, 0.045, -0.0125, 0.09, 0.045, -0.0125], DK, 0, 0.3, -1); } },
  flagStand: { mat: 'solid', cast: true, build: (g) => { g.cyl(0, 0, 0, 0.18, 0.2, 0.06, 8, DK); g.cyl(0, 0.06, 0, 0.022, 0.02, 2.3, 5, hx('#c9a13b')); g.blob(0, 2.36, 0, 0.05, 0.06, 0.05, hx('#e0b850'), 5, 3); } },
  flagCloth: {
    mat: 'solid', build: (g) => {
      // hanging flag beside a pole (x = 0.03 .. 0.75), gentle folds
      for (let k = 0; k < 4; k++) {
        const x0 = 0.03 + k * 0.18, x1 = x0 + 0.18, z0 = (k % 2 ? 0.03 : -0.03), z1 = (k % 2 ? -0.03 : 0.03);
        g.poly([x0, 1.15, z0, x1, 1.15, z1, x1, 2.25, z1, x0, 2.25, z0], k % 2 ? W : shadeW(0.88), 0, 0, 1);
        g.poly([x1, 1.15, z1, x0, 1.15, z0, x0, 2.25, z0, x1, 2.25, z1], k % 2 ? shadeW(0.88) : W, 0, 0, -1);
      }
    },
  },
  stanchion: { mat: 'solid', build: (g) => { g.cyl(0, 0, 0, 0.16, 0.16, 0.03, 8, DK); g.cyl(0, 0.03, 0, 0.025, 0.025, 0.9, 6, hx('#c9a13b')); g.blob(0, 0.93, 0, 0.04, 0.04, 0.04, hx('#c9a13b'), 5, 3); } },
  atm: { mat: 'solid', build: (g) => { g.box(0, 0.6, 0, 0.7, 0.95, 0.12, hx('#5d6670')); g.box(0, 1.15, 0.065, 0.3, 0.22, 0.01, DK); g.box(0, 0.95, 0.07, 0.24, 0.14, 0.02, MET); g.box(0, 0.82, 0.07, 0.2, 0.02, 0.02, DK); } },
} satisfies Record<string, Tpl>;

function shadeW(k: number): Color3 { return new Color3(Math.min(1, k), Math.min(1, k), Math.min(1, k)); }

const BOOK_COLS = ['#8e2f2a', '#2d4f7c', '#2f5e3a', '#c9a13b', '#6b3b5e', '#d8cfb8', '#1f2a36', '#a85a3e', '#3d6b6b', '#e0d5c0', '#5a6b8a', '#b5523a', '#f2efe6', '#4a3a2a'].map(hx);

/** A shelf row of books (0.84 m wide, origin at the left end of the row's center line, spines facing +Z). */
function bookRow(g: Geo, seed: number): void {
  let x = -0.42, k = 0;
  const r = (j: number) => { const v = Math.sin(seed * 91.7 + j * 12.9898) * 43758.5453; return v - Math.floor(v); };
  while (x < 0.4 && k < 40) {
    const w = 0.022 + r(k * 3) * 0.032, h = 0.19 + r(k * 3 + 1) * 0.12, d = 0.18 + r(k * 3 + 2) * 0.06;
    if (x + w > 0.42) break;
    if (r(k * 7 + 5) < 0.07) { x += 0.05 + r(k) * 0.06; k++; continue; }
    const col = BOOK_COLS[Math.floor(r(k * 5 + 3) * BOOK_COLS.length) % BOOK_COLS.length];
    g.box(x + w / 2, 0, 0, w - 0.002, h, d, col);
    if (r(k * 11 + 4) < 0.5) g.box(x + w / 2, h * 0.78, d / 2 + 0.001, w - 0.006, 0.012, 0.002, shade(col, 1.35));
    x += w;
    k++;
  }
}

export type PropName = keyof typeof T;
const TEMPLATES: Record<PropName, Tpl> = T;

/** Prop instances of one building (world-space matrices + colors per template). */
interface Buf { m: Float32Array; c: Float32Array; n: number }

export class PropList {
  private raw = new Map<PropName, Buf>();
  /** Finished data (after `finish`). */
  data = new Map<PropName, { m: Float32Array; c: Float32Array }>();
  count = 0;
  private cs: number;
  private sn: number;

  /**
   * (bx, by, bz) = building origin in world space, rot = its yaw (same as the building meshes).
   * lit: inside a cut-open building (drawn with room light at night).
   */
  constructor(private bx: number, private by: number, private bz: number, private rot: number, readonly lit = false) {
    this.cs = Math.cos(rot);
    this.sn = Math.sin(rot);
  }

  /** Add one instance at local (x, y, z) + yaw `rot` relative to the current frame of `t`, scaled, tinted. */
  add(name: PropName, t: Xf, x: number, y: number, z: number, rot = 0, sx = 1, sy = 1, sz = 1, col?: Color3 | null): void {
    const lx = t.ox + x * t.cs + z * t.sn, lz = t.oz - x * t.sn + z * t.cs, ly = t.oy + y;
    const wx = this.bx + lx * this.cs + lz * this.sn, wz = this.bz - lx * this.sn + lz * this.cs, wy = this.by + ly;
    const a = t.a + rot + this.rot;
    const c = Math.cos(a), s = Math.sin(a);
    let d = this.raw.get(name);
    if (!d) { d = { m: new Float32Array(16 * 16), c: new Float32Array(16 * 4), n: 0 }; this.raw.set(name, d); }
    if (d.n * 16 >= d.m.length) {
      const m = new Float32Array(d.m.length * 2); m.set(d.m); d.m = m;
      const cc = new Float32Array(d.c.length * 2); cc.set(d.c); d.c = cc;
    }
    const M = d.m, o = d.n * 16;
    M[o] = sx * c; M[o + 1] = 0; M[o + 2] = -sx * s; M[o + 3] = 0;
    M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
    M[o + 8] = sz * s; M[o + 9] = 0; M[o + 10] = sz * c; M[o + 11] = 0;
    M[o + 12] = wx; M[o + 13] = wy; M[o + 14] = wz; M[o + 15] = 1;
    const C4 = d.c, q = d.n * 4;
    if (col) { C4[q] = col.r; C4[q + 1] = col.g; C4[q + 2] = col.b; } else { C4[q] = 1; C4[q + 1] = 1; C4[q + 2] = 1; }
    C4[q + 3] = 1;
    d.n++;
    this.count++;
  }

  finish(): this {
    for (const [k, d] of this.raw) this.data.set(k, { m: d.m.subarray(0, d.n * 16), c: d.c.subarray(0, d.n * 4) });
    this.raw.clear();
    return this;
  }
}

/** All prop templates as thin-instance meshes, fed by the prop lists of every detailed building. */
export class PropLib {
  private meshes = new Map<string, Mesh>();
  private lists = new Set<PropList>();
  private dirty = new Set<string>(); // template name, or name + '|lit'

  /** `litSolid`: the material for solid props inside an opened building (room light at night). */
  constructor(private scene: Scene, private shadows: ShadowGenerator | null, private mats: Record<PropMat, Material>, private litSolid: Material) {}

  attach(list: PropList): void {
    if (this.lists.has(list)) return;
    this.lists.add(list);
    for (const k of list.data.keys()) this.dirty.add(list.lit ? `${k}|lit` : k);
  }

  detach(list: PropList | null): void {
    if (!list || !this.lists.delete(list)) return;
    for (const k of list.data.keys()) this.dirty.add(list.lit ? `${k}|lit` : k);
  }

  get pending(): boolean { return this.dirty.size > 0; }

  /** Total instances currently drawn (debugging). */
  get instances(): number {
    let n = 0;
    for (const l of this.lists) n += l.count;
    return n;
  }

  /** Rebuild the instance buffers of templates whose contributors changed. */
  flush(): void {
    for (const key of this.dirty) {
      const lit = key.endsWith('|lit');
      const name = (lit ? key.slice(0, -4) : key) as PropName;
      let n = 0;
      for (const l of this.lists) { if (l.lit !== lit) continue; const d = l.data.get(name); if (d) n += d.c.length / 4; }
      let mesh = this.meshes.get(key);
      if (n === 0) { if (mesh) mesh.setEnabled(false); continue; }
      if (!mesh) mesh = this.create(name, lit);
      // a single contributor's data can go to the GPU as is; otherwise concatenate
      let single: { m: Float32Array; c: Float32Array } | null = null, count = 0;
      for (const l of this.lists) { if (l.lit !== lit) continue; const d = l.data.get(name); if (d) { single = d; count++; } }
      if (count === 1 && single) {
        mesh.thinInstanceSetBuffer('matrix', single.m, 16, true);
        mesh.thinInstanceSetBuffer('color', single.c, 4, true);
        mesh.setEnabled(true);
        continue;
      }
      const m = new Float32Array(n * 16), c = new Float32Array(n * 4);
      let o = 0;
      for (const l of this.lists) {
        if (l.lit !== lit) continue;
        const d = l.data.get(name);
        if (!d) continue;
        m.set(d.m, o * 16);
        c.set(d.c, o * 4);
        o += d.c.length / 4;
      }
      mesh.thinInstanceSetBuffer('matrix', m, 16, true);
      mesh.thinInstanceSetBuffer('color', c, 4, true);
      mesh.setEnabled(true);
    }
    this.dirty.clear();
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      if (this.shadows) this.shadows.removeShadowCaster(m, false);
      m.dispose(false, false);
    }
    this.meshes.clear();
    this.lists.clear();
    this.dirty.clear();
  }

  private create(name: PropName, lit: boolean): Mesh {
    const tpl = TEMPLATES[name];
    const g = new Geo(new Xf());
    tpl.build(g);
    const mesh = g.toMesh(`prop-${name}${lit ? '-lit' : ''}`, this.scene);
    mesh.material = lit && tpl.mat === 'solid' ? this.litSolid : this.mats[tpl.mat];
    mesh.isPickable = false;
    mesh.receiveShadows = tpl.mat === 'solid';
    // instances are spread over the near buildings: skip per-update bounds (culling them would save little)
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    if (tpl.cast && this.shadows) this.shadows.addShadowCaster(mesh, false);
    this.meshes.set(lit ? `${name}|lit` : name, mesh);
    return mesh;
  }
}

/** What prop placement needs from the building generator (implemented by its context). */
export interface Host {
  t: Xf;
  /** The building is opened up (roofs and walls hidden). */
  readonly cut: boolean;
  solid: Geo; warm: Geo; clear: Geo; glass: Geo;
  props: PropList;
  b: Building;
  look: BuildingLook;
  body: Body | null;
  brand: Color3; brandDark: Color3; hue: number;
  /** Deterministic 0..1 from the building's seed. */
  r(k: number): number;
}

export const PC = {
  white: W, dark: DK, dark2: DK2, metal: MET, steel: STEEL, wood: WOOD, woodLight: WOODL, green: GRN, cream: CREAM, terra: TERRA,
  mugs: ['#f4f1ea', '#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#34495e', '#e67e22', '#ecf0f1', '#8e44ad'].map(hx),
  books: ['#8e2f2a', '#2d4f7c', '#2f5e3a', '#c9a13b', '#6b3b5e', '#d8cfb8', '#1f2a36', '#a85a3e', '#3d6b6b', '#e0d5c0', '#5a6b8a', '#b5523a'].map(hx),
  fabric: ['#7a8fb5', '#b5523a', '#d9a441', '#5f8a5a', '#8e6aa8', '#c96a8a', '#e8e0cf', '#4a6b8a', '#a0785a', '#5a7a7a'].map(hx),
  curtains: ['#e8dcc4', '#c9b79a', '#8a3f3a', '#4a6b8a', '#6f8a5a', '#d9c27a', '#efe9df', '#b58a9a', '#7a8a9a', '#f2e6d0', '#a85a3e', '#5a5f6a'].map(hx),
  flowers: ['#e2475a', '#f4d03f', '#f5f1ea', '#e58fb0', '#9b59b6', '#e67e22'].map(hx),
  screens: [hx('#cfe6ff'), hx('#e8f0f8'), hx('#9fd0ff'), hx('#2b3b55'), hx('#bfe8c8'), hx('#f2f2f2')],
  woods: [hx('#9b7048'), hx('#c49a66'), hx('#6e4d33'), hx('#d6b88a'), hx('#8a6a52')],
  upholstery: ['#3d4f6b', '#6b3b3b', '#2f2f33', '#4f6b4f', '#7a6a5a', '#5a4a6b'].map(hx),
  bins: ['#3f6b4a', '#4a5560', '#2e5f8a', '#6a6a62'].map(hx),
  C,
};
