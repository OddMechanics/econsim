// Shared color palettes for people and vehicles. Everything here is pure
// (no scene access), so it can be used by the UI as well.

import { Color3 } from '@babylonjs/core';

/** Skin tones, light to dark (Looks.skin indexes this). */
export const SKIN: string[] = ['#f5d6c0', '#e8bc98', '#d09a74', '#b27750', '#875535', '#583624'];

/** Hair colors (Looks.hair indexes this): black, dark brown, brown, light brown, blond, auburn, grey. */
export const HAIR: string[] = ['#1d1916', '#3a281c', '#62432b', '#8c6741', '#cfad6c', '#8a3c20', '#a9a59f'];

function frac(x: number): number {
  return x - Math.floor(x);
}

/** HSL (all 0..1) to linear-ish RGB triple written into `out` at `o`. */
export function hslInto(h: number, s: number, l: number, out: ArrayLike<number> & { [i: number]: number }, o = 0): void {
  const a = s * Math.min(l, 1 - l);
  const hh = frac(h) * 12;
  for (let i = 0; i < 3; i++) {
    const n = i === 0 ? 0 : i === 1 ? 8 : 4;
    const k = (n + hh) % 12;
    out[o + i] = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  }
}

const tmp = [0, 0, 0];

/** Hex color "#rrggbb" into `out` at `o`. */
export function hexInto(hex: string, out: ArrayLike<number> & { [i: number]: number }, o = 0): void {
  const v = parseInt(hex.slice(1), 16);
  out[o] = ((v >> 16) & 255) / 255;
  out[o + 1] = ((v >> 8) & 255) / 255;
  out[o + 2] = (v & 255) / 255;
}

/**
 * Clothing color from a hue (0..1), written into `out`. Variant 0 = shirt
 * (medium, moderately saturated), 1 = pants (darker, muted), 2 = accent
 * (light, soft). Yellow-greens, which turn neon easily, are toned down.
 */
export function clothInto(hue: number, variant: number, out: ArrayLike<number> & { [i: number]: number }, o = 0): void {
  const h = frac(hue);
  const neon = Math.exp(-((h - 0.2) * (h - 0.2)) / 0.006); // yellow-green band
  const blue = Math.exp(-((h - 0.62) * (h - 0.62)) / 0.004);
  let s: number, l: number;
  if (variant === 1) {
    s = 0.26 + 0.12 * blue;
    l = 0.27 + 0.05 * blue;
  } else if (variant === 2) {
    s = 0.35;
    l = 0.72;
  } else {
    s = 0.5 - 0.17 * neon;
    l = 0.5 - 0.07 * neon;
  }
  hslInto(h, s, l, out, o);
}

export function clothColor(hue: number, variant = 0): Color3 {
  clothInto(hue, variant, tmp);
  return new Color3(tmp[0], tmp[1], tmp[2]);
}

const NEUTRAL_CARS = ['#e9e9e6', '#c4c7ca', '#8e9296', '#4b4f54', '#1f2124', '#d9d2c3'];

/**
 * Car paint from a hue. About 40% of hues map to the usual neutral shades
 * (white, silver, grey, black, beige); the rest are deep, slightly muted colors.
 */
export function carInto(hue: number, out: ArrayLike<number> & { [i: number]: number }, o = 0): void {
  const h = frac(hue);
  const pick = frac(h * 7.137 + 0.31);
  if (pick < 0.4) {
    hexInto(NEUTRAL_CARS[Math.floor(frac(h * 13.71) * NEUTRAL_CARS.length)], out, o);
    return;
  }
  const neon = Math.exp(-((h - 0.2) * (h - 0.2)) / 0.006);
  hslInto(h, 0.55 - 0.2 * neon, 0.4 - 0.05 * neon + 0.08 * frac(h * 31.3), out, o);
}

export function carColor(hue: number): Color3 {
  carInto(hue, tmp);
  return new Color3(tmp[0], tmp[1], tmp[2]);
}
