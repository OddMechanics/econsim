// Ad artwork, painted with the canvas 2D API into the DynamicTextures of the
// ad renderer (ads.ts) and the vehicle liveries (vehicles.ts). Pure painting,
// no scene access. A brand (name + hue) gets a stable identity: palette, logo
// mark, wordmark font and a preferred layout, so a company's billboard, its
// screen spot and the side of its delivery van look like one campaign. Product
// ads show a product illustration picked from the ad's category (inferred
// from the brand name and the message), a price callout when the message
// has one ("from 4.99"), and a brand bar.

import { Color3 } from '@babylonjs/core';
import type { AdPlacement } from '../sim/types';
import { hsl, hx, mix, shade } from './buildingGeo';

type Ctx = CanvasRenderingContext2D;

export type Category =
  | 'food' | 'coffee' | 'grocery' | 'car' | 'furniture' | 'electronics' | 'fashion' | 'bank' | 'office'
  | 'tv' | 'net' | 'realty' | 'freight' | 'tools' | 'materials' | 'farm' | 'generic';

/** Who owns an ad space (for vacant spaces and owner plates). */
export interface OwnerInfo { name: string; hue?: number; adco?: boolean }

// ------------------------------------------------------------ small helpers

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
export const rnd = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
export const css = (c: Color3, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
const lum = (c: Color3) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
/** Readable text color on a background. */
export const inkOn = (c: Color3, dark = hx('#16181c')): Color3 => (lum(c) > 0.6 ? dark : Color3.White());
const TAU = Math.PI * 2;

function grad(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, ...stops: (string | Color3)[]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(i / Math.max(1, stops.length - 1), typeof s === 'string' ? s : css(s)));
  return g;
}
function radial(ctx: Ctx, x: number, y: number, r0: number, r1: number, ...stops: (string | Color3)[]): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach((s, i) => g.addColorStop(i / Math.max(1, stops.length - 1), typeof s === 'string' ? s : css(s)));
  return g;
}
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}
function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, TAU);
}
function polyPath(ctx: Ctx, pts: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]);
  ctx.closePath();
}
/** Soft contact shadow under a product. */
function floorShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, a = 0.35): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / Math.max(0.01, rx));
  ctx.fillStyle = radial(ctx, 0, 0, 0, rx, `rgba(0,0,0,${a})`, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------- text

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const FONTS: { family: string; weight: string; upper: boolean; tight?: number }[] = [
  { family: SANS, weight: '800', upper: false },
  { family: '"Arial Black", "Helvetica Neue", Arial, sans-serif', weight: '900', upper: true },
  { family: 'Futura, "Century Gothic", "Avenir Next", sans-serif', weight: '700', upper: true },
  { family: 'Georgia, "Times New Roman", serif', weight: '700', upper: false },
  { family: '"Avenir Next", "Segoe UI", Arial, sans-serif', weight: '700', upper: false },
  { family: 'Impact, "Arial Narrow", "Helvetica Neue", sans-serif', weight: '400', upper: true },
  { family: 'Rockwell, "Roboto Slab", Georgia, serif', weight: '700', upper: false },
  { family: '"Trebuchet MS", Verdana, sans-serif', weight: '700', upper: false },
];

interface Fit { lines: string[]; size: number }

/** Split words into n lines with the narrowest widest line. */
function balance(ctx: Ctx, words: string[], n: number): string[] {
  if (n <= 1 || words.length < 2) return [words.join(' ')];
  const w = (a: number, b: number) => ctx.measureText(words.slice(a, b).join(' ')).width;
  let best: string[] = [words.join(' ')], bw = Infinity;
  if (n === 2 || words.length === 2) {
    for (let i = 1; i < words.length; i++) {
      const m = Math.max(w(0, i), w(i, words.length));
      if (m < bw) { bw = m; best = [words.slice(0, i).join(' '), words.slice(i).join(' ')]; }
    }
    return best;
  }
  for (let i = 1; i < words.length - 1; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const m = Math.max(w(0, i), w(i, j), w(j, words.length));
      if (m < bw) { bw = m; best = [words.slice(0, i).join(' '), words.slice(i, j).join(' '), words.slice(j).join(' ')]; }
    }
  }
  return best;
}

/** Largest font size (and line breaks, up to maxLines) that fits text into maxW x maxH. */
function fit(ctx: Ctx, text: string, maxW: number, maxH: number, font: (s: number) => string, maxLines = 2, lead = 1.06): Fit {
  const words = text.split(/\s+/).filter(Boolean);
  let best: Fit = { lines: [text], size: 1 };
  ctx.font = font(100);
  for (let n = 1; n <= Math.min(maxLines, Math.max(1, words.length)); n++) {
    const lines = balance(ctx, words, n);
    let wide = 1;
    for (const l of lines) wide = Math.max(wide, ctx.measureText(l).width);
    const size = Math.min((maxW / wide) * 100, maxH / (1 + (n - 1) * lead));
    if (size > best.size * 1.12 || (n === 1 && size > best.size)) best = { lines, size };
  }
  best.size = Math.max(4, Math.floor(best.size));
  return best;
}

/** Draw a fitted block centered vertically on y (align left/center/right at x). */
function drawFit(ctx: Ctx, f: Fit, x: number, y: number, font: (s: number) => string, align: CanvasTextAlign, lead = 1.06): void {
  ctx.font = font(f.size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const n = f.lines.length;
  f.lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (n - 1) / 2) * f.size * lead + f.size * 0.04));
}

/** One line of text shrunk to fit maxW (at most `size`). */
function line(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, font: (s: number) => string, align: CanvasTextAlign = 'center'): number {
  let s = Math.max(4, Math.floor(size));
  ctx.font = font(s);
  const w = ctx.measureText(text).width;
  if (w > maxW) { s = Math.max(4, Math.floor((s * maxW) / w)); ctx.font = font(s); }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + s * 0.04);
  return s;
}

// ------------------------------------------------------------------ brands

export interface Brand {
  name: string;
  hue: number;
  seed: number;
  base: Color3; dark: Color3; light: Color3; accent: Color3;
  mark: number; // logo shape
  font: (s: number) => string;
  upper: boolean;
  layout: number; // preferred layout (0..3)
}

const brandCache = new Map<string, Brand>();

export function brandOf(name: string, hue: number): Brand {
  const key = `${name}|${Math.round(hue * 1000)}`;
  const hit = brandCache.get(key);
  if (hit) return hit;
  const seed = hashStr(name || 'brand');
  const r = (k: number) => rnd(seed, k);
  const h = ((hue % 1) + 1) % 1;
  // yellows and yellow-greens get a bit darker so white text still reads
  const yellow = Math.exp(-((h - 0.16) * (h - 0.16)) / 0.004);
  const base = hsl(h, 0.66 + r(1) * 0.22, 0.47 + r(2) * 0.06 - yellow * 0.06);
  const dark = hsl(h + (r(3) - 0.5) * 0.03, 0.5 + r(4) * 0.2, 0.15 + r(5) * 0.05);
  const light = hsl(h, 0.5, 0.94);
  const ak = r(6);
  const accent = ak < 0.42 ? hsl(0.12 + r(7) * 0.03, 0.96, 0.56) : ak < 0.72 ? hsl(h + 0.5, 0.78, 0.56) : ak < 0.88 ? hsl(h + 0.1, 0.9, 0.6) : hx('#ffffff');
  const f = FONTS[Math.floor(r(8) * FONTS.length)];
  const b: Brand = {
    name, hue: h, seed, base, dark, light, accent,
    mark: Math.floor(r(9) * 8),
    font: (s: number) => `${f.weight} ${Math.round(s)}px ${f.family}`,
    upper: f.upper,
    layout: Math.floor(r(10) * 4),
  };
  if (brandCache.size > 600) brandCache.clear();
  brandCache.set(key, b);
  return b;
}

const initial = (name: string) => (name.replace(/^(the|a)\s+/i, '').match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase();
const monogram = (name: string) => {
  const w = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter((x) => x && !/^(the|of|and|co)$/i.test(x));
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? '•').slice(0, 1)).toUpperCase();
};

/** The brand's logo mark, centered on (x, y) with radius r. */
export function drawMark(ctx: Ctx, x: number, y: number, r: number, b: Brand, fill: Color3, ink: Color3): void {
  ctx.save();
  ctx.fillStyle = css(fill);
  ctx.strokeStyle = css(fill);
  const letter = (s: number, txt = initial(b.name)) => {
    ctx.fillStyle = css(ink);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = b.font(r * s);
    ctx.fillText(txt, x, y + r * 0.07);
  };
  switch (b.mark) {
    case 0: ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); letter(1.25); break;
    case 1: rrect(ctx, x - r, y - r, r * 2, r * 2, r * 0.38); ctx.fill(); letter(1.2); break;
    case 2: polyPath(ctx, [x, y - r * 1.12, x + r * 1.12, y, x, y + r * 1.12, x - r * 1.12, y]); ctx.fill(); letter(1.0); break;
    case 3: { const p: number[] = []; for (let i = 0; i < 6; i++) p.push(x + Math.cos(i * TAU / 6) * r * 1.08, y + Math.sin(i * TAU / 6) * r * 1.08); polyPath(ctx, p); ctx.fill(); letter(0.95, monogram(b.name)); break; }
    case 4: {
      // a planet with an orbit ring
      ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, TAU); ctx.fill();
      letter(1.0);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(-0.42);
      ctx.strokeStyle = css(fill);
      ctx.lineWidth = r * 0.16;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.42, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
      ctx.restore();
      break;
    }
    case 5: {
      // three slanted bars
      for (let i = 0; i < 3; i++) {
        const bx = x - r + i * r * 0.72;
        polyPath(ctx, [bx, y + r, bx + r * 0.42, y - r, bx + r * 0.82, y - r, bx + r * 0.4, y + r]);
        ctx.globalAlpha = 1 - i * 0.22;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 6: {
      // leaf / drop
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.15);
      ctx.bezierCurveTo(x + r * 1.1, y - r * 0.2, x + r * 0.9, y + r, x, y + r);
      ctx.bezierCurveTo(x - r * 0.9, y + r, x - r * 1.1, y - r * 0.2, x, y - r * 1.15);
      ctx.fill();
      letter(0.95);
      break;
    }
    default: {
      // sunburst badge
      const p: number[] = [];
      for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, rr = i % 2 ? r * 0.82 : r * 1.05; p.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      polyPath(ctx, p); ctx.fill();
      letter(0.95);
    }
  }
  ctx.restore();
}

/** Mark + wordmark on one line, height h; returns the drawn width. align: 0 = left at x, 0.5 = centered on x. */
export function drawLockup(ctx: Ctx, x: number, y: number, h: number, maxW: number, b: Brand, color: Color3, markFill: Color3, markInk: Color3, align = 0): number {
  const name = b.upper ? b.name.toUpperCase() : b.name;
  const r = h * 0.5;
  let size = h * 0.62;
  ctx.font = b.font(size);
  let tw = ctx.measureText(name).width;
  const gap = h * 0.28;
  const avail = maxW - r * 2 - gap;
  if (tw > avail) { size = Math.max(4, (size * avail) / tw); ctx.font = b.font(size); tw = ctx.measureText(name).width; }
  const total = r * 2 + gap + tw;
  const x0 = x - total * align;
  drawMark(ctx, x0 + r, y, r * 0.92, b, markFill, markInk);
  ctx.fillStyle = css(color);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = b.font(size);
  ctx.fillText(name, x0 + r * 2 + gap, y + size * 0.05);
  return total;
}

// -------------------------------------------------------------- categories

const RULES: [RegExp, Category][] = [
  [/caf[eé]|coffee|espresso|bakery|roaster/i, 'coffee'],
  [/diner|kitchen|bistro|grill|eatery|restaurant|burger|pizza|dinner|lunch|breakfast|\bmeals?\b|taste|takeaway/i, 'food'],
  [/grocer|market\b|\bmart\b|general store|\bshop\b|groceries|fresh|supermarket|pantry|provisions|\bfoods\b/i, 'grocery'],
  [/motor|\bauto|\bcars?\b|\bdrive\b|dealer|vehicle/i, 'car'],
  [/furniture|home goods|joinery|sofa|interior/i, 'furniture'],
  [/electronic|computing|systems|phone|\btech|gadget|computer/i, 'electronics'],
  [/textile|apparel|clothing|fashion|\bwear\b|boutique|loomworks/i, 'fashion'],
  [/bank|savings|loan|\btrust\b|credit|\bmoney\b|finance|insurance|invest/i, 'bank'],
  [/holdings|\bgroup\b|partners|\bcorp|consult|office/i, 'office'],
  [/\btv\b|broadcast|channel|\bmedia\b|\bnews\b|\bwatch\b|tonight|network/i, 'tv'],
  [/\bnet\b|online|digital|\bweb\b|\blabs\b|\bjoin\b|\.net|\bapp\b|chirp|circles|\bpulse\b|\bloop\b|\byap\b|gather|\bhive\b|seekr|findit|lookup|querio|listly|swapboard|classified|cliptube|viewly|streamr|forum|threadly/i, 'net'],
  [/construction|builders?\b|contracting|\bbuild|propert|realty|residences|\bhomes?\b|apartments|estate/i, 'realty'],
  [/shipping|logistics|freight|express|deliver|parcel|courier|anywhere/i, 'freight'],
  [/\btools?\b|toolworks|hardware/i, 'tools'],
  [/steel|foundry|metal|timber|lumber|forestry|sawmill|plank|woodworks|brick|masonry|kiln|quarry|clay|earthworks|mining|\bore\b|deep works|cement|concrete|glass|crate/i, 'materials'],
  [/farm|acres|harvest|fields|orchard|dairy/i, 'farm'],
];
const CATS = new Set<string>(RULES.map((r) => r[1]).concat('generic'));

/** What an ad sells: an explicit `category` on the placement, else keywords in the brand name, then the message. */
export function categoryOf(ad: Pick<AdPlacement, 'headline' | 'tagline'> & { category?: string }): Category {
  if (ad.category && CATS.has(ad.category)) return ad.category as Category;
  for (const text of [ad.headline, ad.tagline]) {
    if (!text) continue;
    for (const [re, c] of RULES) if (re.test(text)) return c;
  }
  return 'generic';
}

/** The message without its price phrase (shown as a badge instead). */
/** The message without a price phrase at its end ("Dinner from 5" -> "Dinner"); unchanged otherwise. */
function stripPrice(text: string): string {
  return text.replace(/\s*\b(from|only|just|now)\s+\$?\d+(?:[.,]\d{1,2})?\s*[!.]?\s*$/i, '').replace(/\s*(save\s+)?\d{1,2}\s*%\s*off\s*[!.]?\s*$/i, '').replace(/[\s,:;·-]+$/, '').trim();
}

/** A price or discount in the message ("from 4.99", "30% off"). */
export function priceOf(text: string): { pre: string; value: string } | null {
  const m = /\b(from|only|just|now)\s+\$?(\d+(?:[.,]\d{1,2})?)/i.exec(text);
  if (m) return { pre: m[1].toLowerCase(), value: m[2] };
  const off = /(\d{1,2})\s*%\s*off/i.exec(text);
  if (off) return { pre: 'save', value: `${off[1]}%` };
  const p = /(\d{1,3})\s*%\s*([a-z]+)?/i.exec(text); // "0% financing", "5% interest"
  if (p) return { pre: (p[2] ?? '').toLowerCase().slice(0, 10), value: `${p[1]}%` };
  return null;
}

function priceBadge(ctx: Ctx, x: number, y: number, r: number, p: { pre: string; value: string }, fill: Color3, ink: Color3, burst: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.16);
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = r * 0.25;
  ctx.shadowOffsetY = r * 0.08;
  ctx.fillStyle = css(fill);
  if (burst) {
    const pts: number[] = [];
    for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, rr = i % 2 ? r * 0.86 : r; pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    polyPath(ctx, pts);
  } else { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); }
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = css(ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const f = (s: number) => `900 ${Math.round(s)}px ${SANS}`;
  const small = (s: number) => `700 ${Math.round(s)}px ${SANS}`;
  if (!p.pre) line(ctx, p.value, 0, 0, r * 1.55, r * 0.8, f);
  else if (/^(from|only|just|now|save)$/.test(p.pre)) {
    line(ctx, p.pre, 0, -r * 0.4, r * 1.2, r * 0.32, small);
    line(ctx, p.value, 0, r * 0.12, r * 1.55, r * 0.74, f);
  } else {
    // "0% financing": the figure on top, the word under it
    line(ctx, p.value, 0, -r * 0.12, r * 1.55, r * 0.74, f);
    line(ctx, p.pre, 0, r * 0.45, r * 1.3, r * 0.28, small);
  }
  ctx.restore();
}

// --------------------------------------------------------- product drawings
// Each draws into a box of size s centered on (cx, cy).

type Art = (ctx: Ctx, cx: number, cy: number, s: number, b: Brand) => void;

const burger: Art = (ctx, cx, cy, s) => {
  const w = s * 0.92, x0 = cx - w / 2;
  floorShadow(ctx, cx, cy + s * 0.37, w * 0.56, s * 0.07);
  ctx.fillStyle = grad(ctx, 0, cy + s * 0.16, 0, cy + s * 0.36, '#e9a457', '#b2622a');
  rrect(ctx, x0 + w * 0.05, cy + s * 0.17, w * 0.9, s * 0.18, s * 0.08); ctx.fill();
  ctx.fillStyle = grad(ctx, 0, cy + s * 0.03, 0, cy + s * 0.19, '#6d3a20', '#3f1f10');
  rrect(ctx, x0 + w * 0.01, cy + s * 0.04, w * 0.98, s * 0.15, s * 0.07); ctx.fill();
  ctx.fillStyle = 'rgba(30,12,4,0.5)';
  for (let i = 0; i < 26; i++) { ell(ctx, x0 + w * (0.06 + rnd(i, 1) * 0.88), cy + s * (0.07 + rnd(i, 2) * 0.09), s * 0.008, s * 0.006); ctx.fill(); }
  // cheese with drips
  ctx.fillStyle = '#f7bf2c';
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.02, cy + s * 0.02);
  ctx.lineTo(x0 + w * 0.98, cy + s * 0.02);
  for (let i = 6; i >= 0; i--) { const xx = x0 + w * (0.06 + i * 0.145); ctx.lineTo(xx + w * 0.04, cy + s * 0.05); ctx.lineTo(xx, cy + s * (0.1 + (i % 3) * 0.03)); ctx.lineTo(xx - w * 0.04, cy + s * 0.05); }
  ctx.closePath(); ctx.fill();
  // tomato + lettuce
  ctx.fillStyle = '#d63a2a';
  rrect(ctx, x0 + w * 0.06, cy - s * 0.04, w * 0.42, s * 0.07, s * 0.03); ctx.fill();
  rrect(ctx, x0 + w * 0.52, cy - s * 0.04, w * 0.42, s * 0.07, s * 0.03); ctx.fill();
  ctx.fillStyle = '#5fb03a';
  ctx.beginPath(); ctx.moveTo(x0, cy - s * 0.03);
  for (let i = 0; i <= 12; i++) ctx.quadraticCurveTo(x0 + w * ((i - 0.5) / 12), cy + (i % 2 ? s * 0.05 : -s * 0.02), x0 + w * (i / 12), cy - s * 0.01);
  ctx.lineTo(x0 + w, cy - s * 0.06); ctx.lineTo(x0, cy - s * 0.06); ctx.closePath(); ctx.fill();
  // top bun
  ctx.fillStyle = radial(ctx, cx - w * 0.15, cy - s * 0.32, s * 0.02, w * 0.62, '#f8c983', '#e08a3c', '#a9561f');
  ctx.beginPath(); ctx.ellipse(cx, cy - s * 0.05, w * 0.5, s * 0.33, 0, Math.PI, TAU); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff3d6';
  for (let i = 0; i < 16; i++) {
    const a = Math.PI + 0.25 + rnd(i, 7) * (Math.PI - 0.5), rr = 0.35 + rnd(i, 8) * 0.55;
    ctx.save(); ctx.translate(cx + Math.cos(a) * w * 0.5 * rr, cy - s * 0.05 + Math.sin(a) * s * 0.33 * rr); ctx.rotate(rnd(i, 9) * 3);
    ell(ctx, 0, 0, s * 0.018, s * 0.008); ctx.fill(); ctx.restore();
  }
};

const pizza: Art = (ctx, cx, cy, s) => {
  floorShadow(ctx, cx, cy + s * 0.4, s * 0.25, s * 0.05);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.12);
  const top = -s * 0.36, tip = s * 0.42, hw = s * 0.4;
  ctx.fillStyle = grad(ctx, 0, top, 0, tip, '#f9d55a', '#f0b43a');
  ctx.beginPath(); ctx.moveTo(-hw, top); ctx.quadraticCurveTo(0, top - s * 0.08, hw, top); ctx.lineTo(0, tip); ctx.closePath(); ctx.fill();
  ctx.fillStyle = grad(ctx, 0, top - s * 0.12, 0, top + s * 0.06, '#e3a259', '#b46a2c');
  ctx.beginPath(); ctx.moveTo(-hw - s * 0.03, top + s * 0.02); ctx.quadraticCurveTo(0, top - s * 0.16, hw + s * 0.03, top + s * 0.02);
  ctx.quadraticCurveTo(0, top - s * 0.04, -hw - s * 0.03, top + s * 0.02); ctx.fill();
  for (const [px, py, pr] of [[-0.16, -0.18, 0.075], [0.14, -0.2, 0.07], [0, 0.0, 0.07], [-0.06, 0.2, 0.05], [0.12, 0.04, 0.05]]) {
    ctx.fillStyle = '#b8302a'; ell(ctx, px * s, py * s, pr * s, pr * s * 0.92); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ell(ctx, px * s - pr * s * 0.3, py * s - pr * s * 0.3, pr * s * 0.35, pr * s * 0.25); ctx.fill();
  }
  ctx.fillStyle = '#3f8a35';
  for (const [px, py] of [[-0.02, -0.26], [0.2, -0.08], [-0.15, 0.04]]) { ctx.save(); ctx.translate(px * s, py * s); ctx.rotate(px * 9); ell(ctx, 0, 0, s * 0.035, s * 0.016); ctx.fill(); ctx.restore(); }
  ctx.restore();
};

const coffee: Art = (ctx, cx, cy, s, b) => {
  floorShadow(ctx, cx, cy + s * 0.42, s * 0.24, s * 0.05);
  const tw = s * 0.42, bw = s * 0.32, top = cy - s * 0.24, bot = cy + s * 0.42;
  ctx.fillStyle = grad(ctx, cx - tw / 2, 0, cx + tw / 2, 0, '#e9e6e0', '#ffffff', '#cfcac2');
  polyPath(ctx, [cx - tw / 2, top, cx + tw / 2, top, cx + bw / 2, bot, cx - bw / 2, bot]); ctx.fill();
  // sleeve in brand color
  const sy0 = cy - s * 0.02, sy1 = cy + s * 0.22;
  const at = (y: number) => tw / 2 + ((bw - tw) / 2) * ((y - top) / (bot - top));
  ctx.fillStyle = grad(ctx, cx - tw / 2, 0, cx + tw / 2, 0, shade(b.base, 0.8), b.base, shade(b.base, 0.7));
  polyPath(ctx, [cx - at(sy0), sy0, cx + at(sy0), sy0, cx + at(sy1), sy1, cx - at(sy1), sy1]); ctx.fill();
  drawMark(ctx, cx, (sy0 + sy1) / 2, s * 0.075, b, Color3.White(), b.base);
  // lid
  ctx.fillStyle = grad(ctx, 0, top - s * 0.08, 0, top + s * 0.02, '#4a3a33', '#2a201c');
  rrect(ctx, cx - tw / 2 - s * 0.02, top - s * 0.05, tw + s * 0.04, s * 0.06, s * 0.02); ctx.fill();
  rrect(ctx, cx - tw / 2 + s * 0.02, top - s * 0.1, tw - s * 0.04, s * 0.06, s * 0.03); ctx.fill();
  // steam
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = s * 0.025;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(cx + i * s * 0.08, top - s * 0.14);
    ctx.bezierCurveTo(cx + i * s * 0.08 + s * 0.06, top - s * 0.2, cx + i * s * 0.08 - s * 0.06, top - s * 0.28, cx + i * s * 0.08, top - s * 0.36);
    ctx.stroke();
  }
};

const bags: Art = (ctx, cx, cy, s, b) => {
  floorShadow(ctx, cx, cy + s * 0.43, s * 0.42, s * 0.06);
  const bag = (x: number, w: number, h: number, col: Color3, logo: boolean) => {
    const y0 = cy + s * 0.43 - h;
    // produce sticking out
    if (logo) {
      ctx.save(); ctx.translate(x - w * 0.18, y0); ctx.rotate(-0.35);
      ctx.fillStyle = grad(ctx, -s * 0.04, 0, s * 0.04, 0, '#e7b56c', '#c8853a'); rrect(ctx, -s * 0.045, -s * 0.28, s * 0.09, s * 0.36, s * 0.045); ctx.fill();
      ctx.strokeStyle = 'rgba(120,70,20,0.6)'; ctx.lineWidth = s * 0.01;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-s * 0.03, -s * 0.2 + k * s * 0.08); ctx.lineTo(s * 0.03, -s * 0.24 + k * s * 0.08); ctx.stroke(); }
      ctx.restore();
      for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? '#4e9a36' : '#6dbb45'; ell(ctx, x + w * (0.05 + k * 0.08), y0 - s * (0.05 + (k % 2) * 0.04), s * 0.08, s * 0.06); ctx.fill(); }
      ctx.fillStyle = '#d8342b'; ell(ctx, x + w * 0.3, y0 - s * 0.02, s * 0.07, s * 0.065); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ell(ctx, x + w * 0.27, y0 - s * 0.05, s * 0.02, s * 0.015); ctx.fill();
    }
    ctx.fillStyle = grad(ctx, x - w / 2, 0, x + w / 2, 0, shade(col, 0.82), col, shade(col, 0.72));
    ctx.fillRect(x - w / 2, y0, w, h);
    ctx.fillStyle = css(shade(col, 0.62));
    ctx.fillRect(x - w / 2, y0, w, h * 0.06);
    ctx.strokeStyle = css(shade(col, 0.5));
    ctx.lineWidth = s * 0.018;
    ctx.beginPath(); ctx.arc(x, y0 + h * 0.02, w * 0.2, Math.PI, TAU); ctx.stroke();
    if (logo) drawMark(ctx, x, y0 + h * 0.52, Math.min(w, h) * 0.22, b, b.base, Color3.White());
    else drawMark(ctx, x, y0 + h * 0.5, Math.min(w, h) * 0.2, b, Color3.White(), col);
  };
  bag(cx + s * 0.2, s * 0.38, s * 0.5, b.base, false);
  bag(cx - s * 0.1, s * 0.46, s * 0.56, hx('#c99c64'), true);
};

const car: Art = (ctx, cx, cy, s, b) => {
  const L = s, x0 = cx - L / 2, g = cy + s * 0.2; // ground line
  const P = (u: number, v: number): [number, number] => [x0 + u * L, g - v * L];
  floorShadow(ctx, cx, g + s * 0.01, L * 0.5, s * 0.04, 0.5);
  const body = shade(b.base, 1.05);
  ctx.fillStyle = grad(ctx, 0, g - 0.36 * L, 0, g, shade(body, 1.25), body, shade(body, 0.55));
  ctx.beginPath();
  ctx.moveTo(...P(0.03, 0.06));
  ctx.lineTo(...P(0.005, 0.12));
  ctx.quadraticCurveTo(...P(0.0, 0.2), ...P(0.05, 0.205));
  ctx.lineTo(...P(0.2, 0.215));
  ctx.quadraticCurveTo(...P(0.27, 0.225), ...P(0.33, 0.3));
  ctx.quadraticCurveTo(...P(0.38, 0.34), ...P(0.47, 0.342));
  ctx.lineTo(...P(0.56, 0.338));
  ctx.quadraticCurveTo(...P(0.62, 0.33), ...P(0.7, 0.245));
  ctx.quadraticCurveTo(...P(0.88, 0.225), ...P(0.96, 0.2));
  ctx.quadraticCurveTo(...P(1.0, 0.18), ...P(0.995, 0.11));
  ctx.lineTo(...P(0.97, 0.06));
  ctx.lineTo(...P(0.88, 0.06));
  ctx.arc(...P(0.79, 0.06), L * 0.095, 0, Math.PI, true);
  ctx.lineTo(...P(0.3, 0.06));
  ctx.arc(...P(0.21, 0.06), L * 0.095, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();
  // windows
  ctx.fillStyle = grad(ctx, 0, g - 0.33 * L, 0, g - 0.23 * L, '#9fb8cc', '#2b3d4f');
  ctx.beginPath();
  ctx.moveTo(...P(0.27, 0.232)); ctx.quadraticCurveTo(...P(0.33, 0.3), ...P(0.39, 0.322)); ctx.lineTo(...P(0.55, 0.322));
  ctx.quadraticCurveTo(...P(0.6, 0.315), ...P(0.665, 0.243)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(shade(body, 0.6)); ctx.fillRect(...P(0.462, 0.33), L * 0.016, L * 0.1);
  // shoulder highlight, door lines, handle
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = L * 0.006;
  ctx.beginPath(); ctx.moveTo(...P(0.06, 0.19)); ctx.quadraticCurveTo(...P(0.5, 0.215), ...P(0.95, 0.18)); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = L * 0.004;
  ctx.beginPath(); ctx.moveTo(...P(0.46, 0.23)); ctx.lineTo(...P(0.455, 0.08)); ctx.moveTo(...P(0.66, 0.235)); ctx.lineTo(...P(0.68, 0.09)); ctx.stroke();
  // lights
  ctx.fillStyle = '#fff6d0'; ell(ctx, ...P(0.965, 0.165), L * 0.025, L * 0.012); ctx.fill();
  ctx.fillStyle = '#c22a22'; rrect(ctx, ...P(0.005, 0.19), L * 0.03, L * 0.03, L * 0.008); ctx.fill();
  // wheels
  for (const u of [0.21, 0.79]) {
    const [wx, wy] = P(u, 0.06);
    ctx.fillStyle = '#17181a'; ctx.beginPath(); ctx.arc(wx, wy, L * 0.082, 0, TAU); ctx.fill();
    ctx.fillStyle = radial(ctx, wx - L * 0.01, wy - L * 0.01, 0, L * 0.05, '#f2f4f6', '#9aa1a8'); ctx.beginPath(); ctx.arc(wx, wy, L * 0.05, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5d636a'; ctx.lineWidth = L * 0.008;
    for (let k = 0; k < 5; k++) { const a = k * TAU / 5; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.cos(a) * L * 0.045, wy + Math.sin(a) * L * 0.045); ctx.stroke(); }
  }
};

const sofa: Art = (ctx, cx, cy, s, b) => {
  const fab = mix(b.base, hx('#9aa0a6'), 0.25), w = s * 0.98, x0 = cx - w / 2, gy = cy + s * 0.26;
  floorShadow(ctx, cx, gy + s * 0.04, w * 0.55, s * 0.05);
  ctx.fillStyle = '#4a3324';
  for (const lx of [0.08, 0.92]) ctx.fillRect(x0 + w * lx - s * 0.015, gy - s * 0.02, s * 0.03, s * 0.07);
  ctx.fillStyle = grad(ctx, 0, gy - s * 0.42, 0, gy, shade(fab, 1.15), shade(fab, 0.85));
  rrect(ctx, x0 + w * 0.07, gy - s * 0.42, w * 0.86, s * 0.3, s * 0.06); ctx.fill(); // back
  ctx.fillStyle = grad(ctx, 0, gy - s * 0.16, 0, gy, shade(fab, 1.05), shade(fab, 0.7));
  rrect(ctx, x0 + w * 0.04, gy - s * 0.16, w * 0.92, s * 0.16, s * 0.04); ctx.fill(); // base
  ctx.strokeStyle = css(shade(fab, 0.65)); ctx.lineWidth = s * 0.008;
  for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x0 + w * (0.1 + i * 0.267), gy - s * 0.4); ctx.lineTo(x0 + w * (0.1 + i * 0.267), gy - s * 0.16); ctx.stroke(); }
  ctx.fillStyle = grad(ctx, 0, gy - s * 0.2, 0, gy - s * 0.1, shade(fab, 1.2), shade(fab, 0.95));
  for (let i = 0; i < 3; i++) { rrect(ctx, x0 + w * (0.12 + i * 0.257), gy - s * 0.2, w * 0.25, s * 0.09, s * 0.03); ctx.fill(); }
  ctx.fillStyle = grad(ctx, 0, gy - s * 0.3, 0, gy, shade(fab, 1.1), shade(fab, 0.75));
  rrect(ctx, x0, gy - s * 0.28, w * 0.1, s * 0.28, s * 0.04); ctx.fill();
  rrect(ctx, x0 + w * 0.9, gy - s * 0.28, w * 0.1, s * 0.28, s * 0.04); ctx.fill();
  ctx.save(); ctx.translate(x0 + w * 0.24, gy - s * 0.27); ctx.rotate(-0.25);
  ctx.fillStyle = css(b.accent.equals(Color3.White()) ? hx('#f2d16b') : b.accent);
  rrect(ctx, -s * 0.08, -s * 0.08, s * 0.16, s * 0.15, s * 0.04); ctx.fill(); ctx.restore();
};

function phoneBody(ctx: Ctx, cx: number, cy: number, s: number, b: Brand, tilt: number, chat: boolean): void {
  const w = s * 0.42, h = s * 0.86;
  floorShadow(ctx, cx + s * 0.04, cy + h * 0.52, w * 0.7, s * 0.05);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
  ctx.fillStyle = grad(ctx, -w / 2, 0, w / 2, 0, '#5b5f66', '#1b1c20', '#3a3d42');
  rrect(ctx, -w / 2, -h / 2, w, h, w * 0.16); ctx.fill();
  const sx = -w / 2 + w * 0.05, sy = -h / 2 + w * 0.05, sw = w * 0.9, sh = h - w * 0.1;
  ctx.fillStyle = grad(ctx, sx, sy, sx + sw, sy + sh, shade(b.base, 1.3), b.base, b.dark);
  rrect(ctx, sx, sy, sw, sh, w * 0.12); ctx.fill();
  ctx.save(); rrect(ctx, sx, sy, sw, sh, w * 0.12); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.moveTo(sx, sy + sh * 0.6); ctx.quadraticCurveTo(sx + sw * 0.5, sy + sh * 0.45, sx + sw, sy + sh * 0.7); ctx.lineTo(sx + sw, sy + sh); ctx.lineTo(sx, sy + sh); ctx.fill();
  if (chat) {
    for (let i = 0; i < 4; i++) {
      const right = i % 2 === 1, by = sy + sh * (0.16 + i * 0.17);
      ctx.fillStyle = right ? 'rgba(255,255,255,0.92)' : css(b.accent.equals(Color3.White()) ? shade(b.base, 1.4) : b.accent, 0.95);
      rrect(ctx, right ? sx + sw * 0.3 : sx + sw * 0.08, by, sw * 0.62, sh * 0.11, sh * 0.04); ctx.fill();
    }
  } else {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = `rgba(255,255,255,${0.55 + ((r * 4 + c) % 3) * 0.15})`;
      rrect(ctx, sx + sw * (0.1 + c * 0.21), sy + sh * (0.12 + r * 0.12), sw * 0.15, sw * 0.15, sw * 0.04); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `600 ${Math.round(sw * 0.26)}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('9:41', 0, sy + sh * 0.74);
  }
  ctx.restore();
  ctx.fillStyle = '#0e0f11'; rrect(ctx, -w * 0.16, -h / 2 + w * 0.08, w * 0.32, w * 0.07, w * 0.035); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = s * 0.006;
  rrect(ctx, -w / 2 + s * 0.004, -h / 2 + s * 0.004, w - s * 0.008, h - s * 0.008, w * 0.16); ctx.stroke();
  ctx.restore();
}

const phone: Art = (ctx, cx, cy, s, b) => phoneBody(ctx, cx, cy, s, b, -0.12, false);

const chat: Art = (ctx, cx, cy, s, b) => {
  phoneBody(ctx, cx - s * 0.08, cy + s * 0.02, s * 0.92, b, 0.08, true);
  const bubble = (x: number, y: number, r: number, col: Color3, icon: 'heart' | 'dots' | 'up') => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = r * 0.3; ctx.shadowOffsetY = r * 0.1;
    ctx.fillStyle = css(col);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - r * 0.6, y + r * 0.6); ctx.lineTo(x - r * 0.95, y + r * 1.05); ctx.lineTo(x - r * 0.1, y + r * 0.9); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    if (icon === 'heart') heartPath(ctx, x, y + r * 0.02, r * 0.5);
    else if (icon === 'dots') for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(x + k * r * 0.38, y, r * 0.13, 0, TAU); ctx.fill(); }
    else { polyPath(ctx, [x, y - r * 0.5, x + r * 0.45, y + r * 0.05, x + r * 0.16, y + r * 0.05, x + r * 0.16, y + r * 0.45, x - r * 0.16, y + r * 0.45, x - r * 0.16, y + r * 0.05, x - r * 0.45, y + r * 0.05]); ctx.fill(); }
  };
  bubble(cx + s * 0.27, cy - s * 0.26, s * 0.13, hx('#e8435a'), 'heart');
  bubble(cx + s * 0.32, cy + s * 0.04, s * 0.1, b.base, 'dots');
  bubble(cx + s * 0.22, cy + s * 0.3, s * 0.09, hx('#2f9ee8'), 'up');
};

const shirt: Art = (ctx, cx, cy, s, b) => {
  ctx.strokeStyle = '#8b9096'; ctx.lineWidth = s * 0.02; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - s * 0.2, cy - s * 0.3); ctx.lineTo(cx, cy - s * 0.4); ctx.lineTo(cx + s * 0.2, cy - s * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - s * 0.45, s * 0.04, Math.PI * 0.9, Math.PI * 2.3); ctx.stroke();
  const c = b.base;
  ctx.fillStyle = grad(ctx, cx - s * 0.4, 0, cx + s * 0.4, 0, shade(c, 0.8), shade(c, 1.15), shade(c, 0.75));
  polyPath(ctx, [cx - s * 0.12, cy - s * 0.32, cx - s * 0.4, cy - s * 0.2, cx - s * 0.46, cy - s * 0.02, cx - s * 0.3, cy + s * 0.02, cx - s * 0.28, cy + s * 0.42,
    cx + s * 0.28, cy + s * 0.42, cx + s * 0.3, cy + s * 0.02, cx + s * 0.46, cy - s * 0.02, cx + s * 0.4, cy - s * 0.2, cx + s * 0.12, cy - s * 0.32]);
  ctx.fill();
  ctx.fillStyle = css(shade(c, 0.55));
  ctx.beginPath(); ctx.moveTo(cx - s * 0.12, cy - s * 0.32); ctx.quadraticCurveTo(cx, cy - s * 0.18, cx + s * 0.12, cy - s * 0.32); ctx.quadraticCurveTo(cx, cy - s * 0.26, cx - s * 0.12, cy - s * 0.32); ctx.fill();
  drawMark(ctx, cx + s * 0.13, cy - s * 0.1, s * 0.05, b, Color3.White(), c);
  // price tag on a string
  ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = s * 0.006;
  ctx.beginPath(); ctx.moveTo(cx + s * 0.4, cy - s * 0.12); ctx.lineTo(cx + s * 0.44, cy + s * 0.08); ctx.stroke();
  ctx.save(); ctx.translate(cx + s * 0.44, cy + s * 0.14); ctx.rotate(0.3);
  ctx.fillStyle = '#f4efe2'; polyPath(ctx, [-s * 0.05, -s * 0.06, s * 0.05, -s * 0.06, s * 0.05, s * 0.08, -s * 0.05, s * 0.08]); ctx.fill();
  ctx.restore();
};

const card: Art = (ctx, cx, cy, s, b) => {
  floorShadow(ctx, cx, cy + s * 0.38, s * 0.42, s * 0.05);
  // coin stack
  for (let i = 0; i < 6; i++) {
    const y = cy + s * 0.32 - i * s * 0.055;
    ctx.fillStyle = '#a77a1f'; ell(ctx, cx + s * 0.24, y + s * 0.02, s * 0.15, s * 0.05); ctx.fill();
    ctx.fillStyle = grad(ctx, cx + s * 0.09, 0, cx + s * 0.39, 0, '#f6d77a', '#e0aa33', '#b88324'); ell(ctx, cx + s * 0.24, y, s * 0.15, s * 0.05); ctx.fill();
  }
  ctx.save(); ctx.translate(cx - s * 0.08, cy - s * 0.06); ctx.rotate(-0.22);
  const w = s * 0.62, h = w * 0.63;
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = s * 0.04; ctx.shadowOffsetY = s * 0.015;
  ctx.fillStyle = grad(ctx, -w / 2, -h / 2, w / 2, h / 2, shade(b.base, 1.25), b.base, b.dark);
  rrect(ctx, -w / 2, -h / 2, w, h, w * 0.06); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.arc(w * 0.35, -h * 0.5, h * 0.8, 0, TAU); ctx.fill();
  ctx.fillStyle = grad(ctx, 0, -h * 0.15, 0, h * 0.05, '#f4d98a', '#c79a3b');
  rrect(ctx, -w * 0.38, -h * 0.16, w * 0.16, h * 0.22, w * 0.02); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let g = 0; g < 4; g++) for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(-w * 0.38 + g * w * 0.2 + k * w * 0.04, h * 0.22, w * 0.012, 0, TAU); ctx.fill(); }
  drawMark(ctx, w * 0.36, -h * 0.3, h * 0.12, b, Color3.White(), b.base);
  ctx.restore();
};

const tv: Art = (ctx, cx, cy, s, b) => {
  const w = s * 0.92, h = w * 0.58, y0 = cy - h * 0.6;
  floorShadow(ctx, cx, cy + s * 0.36, s * 0.3, s * 0.04);
  ctx.fillStyle = '#2a2c30'; polyPath(ctx, [cx - s * 0.05, y0 + h, cx + s * 0.05, y0 + h, cx + s * 0.07, cy + s * 0.33, cx - s * 0.07, cy + s * 0.33]); ctx.fill();
  rrect(ctx, cx - s * 0.2, cy + s * 0.32, s * 0.4, s * 0.035, s * 0.015); ctx.fill();
  ctx.fillStyle = '#111215'; rrect(ctx, cx - w / 2, y0, w, h, s * 0.02); ctx.fill();
  ctx.fillStyle = grad(ctx, cx - w / 2, y0, cx + w / 2, y0 + h, b.dark, b.base, shade(b.base, 1.3));
  ctx.fillRect(cx - w / 2 + s * 0.02, y0 + s * 0.02, w - s * 0.04, h - s * 0.04);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + s * 0.02, y0 + s * 0.02); ctx.lineTo(cx, y0 + s * 0.02); ctx.lineTo(cx - w * 0.3, y0 + h - s * 0.02); ctx.lineTo(cx - w / 2 + s * 0.02, y0 + h - s * 0.02); ctx.fill();
  ctx.fillStyle = '#ffffff';
  polyPath(ctx, [cx - s * 0.07, y0 + h * 0.32, cx + s * 0.1, y0 + h * 0.5, cx - s * 0.07, y0 + h * 0.68]); ctx.fill();
  ctx.fillStyle = '#e02b2b'; rrect(ctx, cx - w / 2 + s * 0.05, y0 + s * 0.05, s * 0.17, s * 0.075, s * 0.015); ctx.fill();
  ctx.fillStyle = '#fff'; line(ctx, 'LIVE', cx - w / 2 + s * 0.135, y0 + s * 0.088, s * 0.14, s * 0.06, (z) => `800 ${Math.round(z)}px ${SANS}`);
};

const house: Art = (ctx, cx, cy, s, b) => {
  const build = /build|construct|contract/i.test(b.name);
  floorShadow(ctx, cx, cy + s * 0.38, s * 0.42, s * 0.05);
  if (build) {
    // tower crane over a building frame
    ctx.strokeStyle = '#e8b631'; ctx.lineWidth = s * 0.02;
    const mx = cx + s * 0.22;
    ctx.beginPath(); ctx.moveTo(mx, cy + s * 0.38); ctx.lineTo(mx, cy - s * 0.42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - s * 0.46, cy - s * 0.36); ctx.lineTo(mx + s * 0.16, cy - s * 0.36); ctx.stroke();
    ctx.lineWidth = s * 0.007;
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(mx - s * 0.02, cy + s * 0.38 - i * s * 0.09); ctx.lineTo(mx + s * 0.02, cy + s * 0.38 - (i + 0.5) * s * 0.09); ctx.stroke(); }
    ctx.strokeStyle = '#444'; ctx.beginPath(); ctx.moveTo(cx - s * 0.3, cy - s * 0.36); ctx.lineTo(cx - s * 0.3, cy - s * 0.12); ctx.stroke();
    ctx.fillStyle = css(b.base); ctx.fillRect(cx - s * 0.34, cy - s * 0.12, s * 0.08, s * 0.05);
    ctx.fillStyle = '#7b8288'; ctx.fillRect(mx + s * 0.08, cy - s * 0.4, s * 0.08, s * 0.06);
  }
  const bx = build ? cx - s * 0.12 : cx, bw = s * 0.5, wy = cy - s * 0.02, by = cy + s * 0.38;
  ctx.fillStyle = grad(ctx, bx - bw / 2, 0, bx + bw / 2, 0, '#f6f1e7', '#ddd5c6');
  ctx.fillRect(bx - bw / 2, wy, bw, by - wy);
  ctx.fillStyle = grad(ctx, 0, cy - s * 0.32, 0, wy, shade(b.base, 1.1), b.dark);
  polyPath(ctx, [bx - bw / 2 - s * 0.06, wy + s * 0.01, bx, cy - s * 0.32, bx + bw / 2 + s * 0.06, wy + s * 0.01]); ctx.fill();
  ctx.fillStyle = css(b.base); rrect(ctx, bx - s * 0.05, by - s * 0.18, s * 0.1, s * 0.18, s * 0.01); ctx.fill();
  ctx.fillStyle = grad(ctx, 0, wy, 0, wy + s * 0.12, '#cfe6f5', '#7fa6c4');
  ctx.fillRect(bx - bw * 0.38, wy + s * 0.07, s * 0.1, s * 0.1);
  ctx.fillRect(bx + bw * 0.38 - s * 0.1, wy + s * 0.07, s * 0.1, s * 0.1);
  if (!build) {
    // a key
    ctx.save(); ctx.translate(cx + s * 0.36, cy + s * 0.12); ctx.rotate(-0.6);
    ctx.fillStyle = grad(ctx, -s * 0.1, 0, s * 0.1, 0, '#f3d47a', '#c29a3a');
    ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.07, 0, TAU); ctx.fill();
    ctx.fillRect(-s * 0.018, -s * 0.08, s * 0.036, s * 0.24);
    ctx.fillRect(0, s * 0.08, s * 0.06, s * 0.03); ctx.fillRect(0, s * 0.13, s * 0.045, s * 0.03);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -s * 0.14, s * 0.025, 0, TAU); ctx.fill();
    ctx.restore();
  }
};

const truck: Art = (ctx, cx, cy, s, b) => {
  const L = s, x0 = cx - L / 2, g = cy + s * 0.18;
  floorShadow(ctx, cx, g + s * 0.01, L * 0.5, s * 0.035, 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = s * 0.012; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x0 - L * 0.02 - i * L * 0.03, g - L * (0.1 + i * 0.07)); ctx.lineTo(x0 - L * 0.16 - i * L * 0.03, g - L * (0.1 + i * 0.07)); ctx.stroke(); }
  ctx.fillStyle = grad(ctx, 0, g - L * 0.4, 0, g, '#ffffff', '#d9dde1');
  rrect(ctx, x0, g - L * 0.4, L * 0.66, L * 0.33, L * 0.01); ctx.fill();
  ctx.fillStyle = css(b.base); ctx.fillRect(x0, g - L * 0.16, L * 0.66, L * 0.05);
  drawMark(ctx, x0 + L * 0.33, g - L * 0.27, L * 0.065, b, b.base, Color3.White());
  ctx.fillStyle = grad(ctx, 0, g - L * 0.33, 0, g, shade(b.base, 1.2), shade(b.base, 0.7));
  ctx.beginPath(); ctx.moveTo(x0 + L * 0.68, g - L * 0.07); ctx.lineTo(x0 + L * 0.68, g - L * 0.33); ctx.lineTo(x0 + L * 0.84, g - L * 0.33);
  ctx.quadraticCurveTo(x0 + L * 0.9, g - L * 0.32, x0 + L * 0.93, g - L * 0.2); ctx.lineTo(x0 + L * 0.98, g - L * 0.17); ctx.lineTo(x0 + L * 0.98, g - L * 0.07); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2d3b48'; polyPath(ctx, [x0 + L * 0.8, g - L * 0.31, x0 + L * 0.85, g - L * 0.31, x0 + L * 0.9, g - L * 0.2, x0 + L * 0.8, g - L * 0.2]); ctx.fill();
  ctx.fillStyle = '#26282b'; ctx.fillRect(x0, g - L * 0.08, L * 0.98, L * 0.03);
  for (const u of [0.14, 0.5, 0.86]) {
    ctx.fillStyle = '#17181a'; ctx.beginPath(); ctx.arc(x0 + u * L, g - L * 0.04, L * 0.055, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b6bcc2'; ctx.beginPath(); ctx.arc(x0 + u * L, g - L * 0.04, L * 0.025, 0, TAU); ctx.fill();
  }
};

const tools: Art = (ctx, cx, cy, s) => {
  floorShadow(ctx, cx, cy + s * 0.4, s * 0.35, s * 0.05);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.75);
  ctx.fillStyle = grad(ctx, -s * 0.05, 0, s * 0.05, 0, '#dde2e6', '#8c949b');
  rrect(ctx, -s * 0.045, -s * 0.3, s * 0.09, s * 0.62, s * 0.04); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -s * 0.34, s * 0.12, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(-s * 0.045, -s * 0.5, s * 0.09, s * 0.17);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.75);
  ctx.fillStyle = grad(ctx, -s * 0.04, 0, s * 0.04, 0, '#c38b52', '#8a5a2d');
  rrect(ctx, -s * 0.04, -s * 0.24, s * 0.08, s * 0.66, s * 0.03); ctx.fill();
  ctx.fillStyle = grad(ctx, 0, -s * 0.38, 0, -s * 0.22, '#5d646b', '#2c3035');
  rrect(ctx, -s * 0.2, -s * 0.36, s * 0.4, s * 0.13, s * 0.02); ctx.fill();
  ctx.restore();
};

const materials: Art = (ctx, cx, cy, s, b) => {
  const n = b.name;
  floorShadow(ctx, cx, cy + s * 0.38, s * 0.46, s * 0.05);
  if (/steel|metal|foundry|ore|mining|deep/i.test(n)) {
    // steel coils: two on the floor, one on top
    for (const [dx, dy, r] of [[-0.21, 0.17, 0.2], [0.21, 0.17, 0.2], [0, -0.17, 0.2]]) {
      const x = cx + dx * s, y = cy + dy * s, R = r * s;
      ctx.fillStyle = '#5d646b'; ctx.beginPath(); ctx.arc(x + R * 0.08, y + R * 0.05, R, 0, TAU); ctx.fill();
      ctx.fillStyle = radial(ctx, x - R * 0.3, y - R * 0.35, R * 0.05, R * 1.1, '#f3f6f8', '#b9c1c8', '#6f7880');
      ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(70,80,90,0.35)'; ctx.lineWidth = s * 0.004;
      for (let k = 0.45; k < 1; k += 0.09) { ctx.beginPath(); ctx.arc(x, y, R * k, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = grad(ctx, x - R * 0.35, y - R * 0.35, x + R * 0.35, y + R * 0.35, '#2a2e33', '#4b525a');
      ctx.beginPath(); ctx.arc(x, y, R * 0.36, 0, TAU); ctx.fill();
    }
  } else if (/brick|kiln|masonry|clay|quarry|earth|cement|concrete/i.test(n)) {
    for (let r = 0; r < 5; r++) for (let i = 0; i < 4; i++) {
      const x = cx - s * 0.42 + i * s * 0.21 + (r % 2) * s * 0.105, y = cy + s * 0.28 - r * s * 0.11;
      if (x > cx + s * 0.3) continue;
      ctx.fillStyle = grad(ctx, 0, y, 0, y + s * 0.1, '#c9603f', '#8f3b24');
      rrect(ctx, x, y, s * 0.2, s * 0.1, s * 0.01); ctx.fill();
    }
  } else if (/timber|lumber|forest|saw|plank|wood|mill/i.test(n)) {
    for (let r = 0; r < 4; r++) for (let i = 0; i < 5 - r; i++) {
      const x = cx - s * 0.36 + i * s * 0.18 + r * s * 0.09, y = cy + s * 0.27 - r * s * 0.16;
      ctx.fillStyle = radial(ctx, x, y, 0, s * 0.085, '#f0cf96', '#d7a865', '#9a6a35');
      ell(ctx, x, y, s * 0.085, s * 0.08); ctx.fill();
      ctx.strokeStyle = 'rgba(120,80,40,0.45)'; ctx.lineWidth = s * 0.006;
      for (const k of [0.3, 0.6]) { ell(ctx, x, y, s * 0.085 * k, s * 0.08 * k); ctx.stroke(); }
    }
  } else {
    ctx.fillStyle = grad(ctx, 0, cy - s * 0.3, 0, cy + s * 0.36, '#d9a865', '#9c6b35');
    ctx.fillRect(cx - s * 0.34, cy - s * 0.3, s * 0.68, s * 0.66);
    ctx.strokeStyle = '#7a5128'; ctx.lineWidth = s * 0.04;
    ctx.strokeRect(cx - s * 0.32, cy - s * 0.28, s * 0.64, s * 0.62);
    ctx.beginPath(); ctx.moveTo(cx - s * 0.32, cy + s * 0.34); ctx.lineTo(cx + s * 0.32, cy - s * 0.28); ctx.stroke();
    ctx.fillStyle = css(b.dark, 0.85);
    line(ctx, initial(b.name), cx, cy + s * 0.03, s * 0.4, s * 0.34, b.font);
  }
};

const farm: Art = (ctx, cx, cy, s) => {
  floorShadow(ctx, cx, cy + s * 0.43, s * 0.36, s * 0.05);
  // a sheaf of wheat: stalks fanning out from a tie, golden ears with awns
  const fx = cx - s * 0.08, tieY = cy + s * 0.14, topY = cy - s * 0.16, botY = cy + s * 0.42;
  for (let i = -6; i <= 6; i++) {
    const t = i / 6, tx = fx + t * s * 0.32, bx = fx + t * s * 0.13, mx = fx + t * s * 0.025;
    ctx.strokeStyle = i % 2 ? '#c49a3a' : '#d8b24c';
    ctx.lineWidth = s * 0.016;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, botY); ctx.lineTo(mx, tieY); ctx.quadraticCurveTo(mx + (tx - mx) * 0.3, topY + s * 0.12, tx, topY + Math.abs(t) * s * 0.06); ctx.stroke();
    const ang = Math.atan2(topY - tieY, tx - mx);
    ctx.save(); ctx.translate(tx, topY + Math.abs(t) * s * 0.06); ctx.rotate(ang + Math.PI / 2);
    ctx.strokeStyle = 'rgba(200,160,70,0.8)'; ctx.lineWidth = s * 0.004;
    for (let k = 0; k < 6; k++) {
      for (const side of [-1, 1]) {
        ctx.fillStyle = k % 2 ? '#e9c35a' : '#dcae45';
        ctx.save(); ctx.translate(side * s * 0.014, -k * s * 0.026); ctx.rotate(side * 0.35);
        ell(ctx, 0, 0, s * 0.012, s * 0.022); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, -s * 0.02); ctx.lineTo(side * s * 0.02, -s * 0.07); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }
  ctx.fillStyle = '#8a5a2d';
  rrect(ctx, fx - s * 0.06, tieY - s * 0.02, s * 0.12, s * 0.045, s * 0.01); ctx.fill();
  const ax = cx + s * 0.28, ay = cy + s * 0.3;
  ctx.fillStyle = radial(ctx, ax - s * 0.04, ay - s * 0.05, 0, s * 0.16, '#ff6a5a', '#d22b22', '#8e1712');
  ctx.beginPath(); ctx.arc(ax - s * 0.05, ay, s * 0.1, 0, TAU); ctx.arc(ax + s * 0.05, ay, s * 0.1, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ell(ctx, ax - s * 0.09, ay - s * 0.04, s * 0.025, s * 0.016); ctx.fill();
  ctx.fillStyle = '#4c8f35'; ctx.save(); ctx.translate(ax + s * 0.03, ay - s * 0.12); ctx.rotate(-0.6); ell(ctx, 0, 0, s * 0.05, s * 0.02); ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = s * 0.012;
  ctx.beginPath(); ctx.moveTo(ax, ay - s * 0.08); ctx.lineTo(ax - s * 0.01, ay - s * 0.14); ctx.stroke();
};

const office: Art = (ctx, cx, cy, s, b) => {
  ctx.fillStyle = css(mix(b.base, Color3.White(), 0.55), 0.9);
  const sky = [[-0.46, 0.32], [-0.36, 0.55], [-0.24, 0.4], [-0.1, 0.72], [0.04, 0.5], [0.16, 0.62], [0.3, 0.35], [0.4, 0.48]];
  for (const [x, h] of sky) ctx.fillRect(cx + x * s, cy + s * 0.3 - h * s * 0.75, s * 0.12, h * s * 0.75);
  floorShadow(ctx, cx, cy + s * 0.42, s * 0.32, s * 0.05);
  const w = s * 0.56, h = s * 0.36, y0 = cy + s * 0.04;
  ctx.strokeStyle = '#3d2a1c'; ctx.lineWidth = s * 0.03;
  rrect(ctx, cx - s * 0.1, y0 - s * 0.08, s * 0.2, s * 0.12, s * 0.03); ctx.stroke();
  ctx.fillStyle = grad(ctx, 0, y0, 0, y0 + h, '#8b5a34', '#5a3720');
  rrect(ctx, cx - w / 2, y0, w, h, s * 0.03); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx - w / 2, y0 + h * 0.35, w, s * 0.02);
  ctx.fillStyle = '#d8b25a'; ctx.fillRect(cx - s * 0.04, y0 + h * 0.3, s * 0.08, s * 0.06);
};

const bottle: Art = (ctx, cx, cy, s, b) => {
  floorShadow(ctx, cx, cy + s * 0.44, s * 0.3, s * 0.05);
  // box
  ctx.fillStyle = grad(ctx, cx + s * 0.02, 0, cx + s * 0.42, 0, b.base, shade(b.base, 0.75));
  ctx.fillRect(cx + s * 0.04, cy - s * 0.12, s * 0.36, s * 0.56);
  ctx.fillStyle = css(Color3.White(), 0.9); ctx.fillRect(cx + s * 0.04, cy + s * 0.08, s * 0.36, s * 0.12);
  drawMark(ctx, cx + s * 0.22, cy - s * 0.0, s * 0.07, b, Color3.White(), b.base);
  // bottle
  ctx.fillStyle = grad(ctx, cx - s * 0.32, 0, cx, 0, shade(b.dark, 1.6), shade(b.dark, 0.8));
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, cy - s * 0.44); ctx.lineTo(cx - s * 0.12, cy - s * 0.44); ctx.lineTo(cx - s * 0.12, cy - s * 0.3);
  ctx.quadraticCurveTo(cx - s * 0.02, cy - s * 0.24, cx - s * 0.02, cy - s * 0.1); ctx.lineTo(cx - s * 0.02, cy + s * 0.44); ctx.lineTo(cx - s * 0.3, cy + s * 0.44);
  ctx.lineTo(cx - s * 0.3, cy - s * 0.1); ctx.quadraticCurveTo(cx - s * 0.3, cy - s * 0.24, cx - s * 0.2, cy - s * 0.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(b.light); ctx.fillRect(cx - s * 0.3, cy + s * 0.02, s * 0.28, s * 0.22);
  ctx.fillStyle = css(b.base); ctx.fillRect(cx - s * 0.3, cy + s * 0.08, s * 0.28, s * 0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(cx - s * 0.26, cy - s * 0.2, s * 0.03, s * 0.6);
};

function artFor(cat: Category, seed: number): Art {
  switch (cat) {
    case 'food': return rnd(seed, 31) < 0.55 ? burger : pizza;
    case 'coffee': return coffee;
    case 'grocery': return bags;
    case 'car': return car;
    case 'furniture': return sofa;
    case 'electronics': return phone;
    case 'fashion': return shirt;
    case 'bank': return card;
    case 'office': return office;
    case 'tv': return tv;
    case 'net': return chat;
    case 'realty': return house;
    case 'freight': return truck;
    case 'tools': return tools;
    case 'materials': return materials;
    case 'farm': return farm;
    default: return bottle;
  }
}
/** Products that are wide rather than tall (get a wider slot in layouts). */
const WIDE_ART = new Set<Category>(['car', 'freight', 'furniture', 'tv']);

// ----------------------------------------------------------------- layouts

export interface PaintOpts {
  /** Owner of the space (vacant spaces show their name). */
  owner?: OwnerInfo | null;
  /** Big LED screen: brighter, more digital look, a ticker band at the bottom. */
  screen?: boolean;
}

function heartPath(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.7);
  ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.6, y - s * 0.9, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 0.9, x + s * 1.2, y - s * 0.1, x, y + s * 0.7);
  ctx.fill();
}
function star(ctx: Ctx, x: number, y: number, r: number): void {
  const p: number[] = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r; p.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  polyPath(ctx, p);
  ctx.fill();
}

/** Height of the ticker band at the bottom of screen designs (fraction of H). */
export const TICKER_BAND = 0.14;
/** Left part of the ticker band holding the static logo block (fraction of W). */
export const TICKER_LOGO = 0.2;

/** Paint one ad design into a W x H canvas. */
export function paintAd(ctx: Ctx, W: number, H: number, ad: AdPlacement, opts: PaintOpts = {}): void {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (ad.sponsor === -1) paintVacant(ctx, W, H, opts);
  else if (ad.topic === 'campaign') paintCampaign(ctx, W, H, ad);
  else if (ad.topic === 'cause') paintCause(ctx, W, H, ad);
  else if (ad.topic === 'event') paintEvent(ctx, W, H, ad);
  else paintProduct(ctx, W, H, ad, opts);
  ctx.restore();
  const seed = hashStr(`${ad.sponsor}|${ad.headline}`);
  if (ad.kind === 'flyer') {
    if (ad.topic !== 'campaign') tearTabs(ctx, W, H, seed);
    weather(ctx, W, H, seed, 0.6);
  } else if (ad.kind === 'poster' && ad.topic === 'campaign') {
    weather(ctx, W, H, seed, 1);
    tornCorner(ctx, W, H, seed);
  }
}

function paintProduct(ctx: Ctx, W: number, H: number, ad: AdPlacement, opts: PaintOpts): void {
  const b = brandOf(ad.headline || 'Brand', ad.hue);
  const cat = categoryOf(ad as AdPlacement & { category?: string });
  const art = artFor(cat, b.seed);
  let msg = (ad.tagline && ad.tagline !== ad.headline ? ad.tagline : ad.headline) || 'Now open';
  let price = priceOf(ad.tagline ?? '');
  const full = msg;
  if (price) {
    // the price moves into a badge; a short message that is just the offer ("0% financing") keeps it and gets no badge
    const m = stripPrice(msg);
    if (m.length >= 3 && m !== msg) msg = m;
    else if (msg.length <= 18) price = null;
  }
  const a = W / H;
  const screen = !!opts.screen;
  // variety: the brand's own layout, shifted by the message so its ads differ
  let v = (b.layout + Math.floor(hashStr(msg) * 2)) % 4;
  if (screen && (v === 0 || v === 3)) v = v === 0 ? 2 : 1; // LED screens: dark and bold looks (white backgrounds blow out at night)
  const white = Color3.White();
  const ink = inkOn(b.base);
  const head = (s: number) => `900 ${Math.round(s)}px ${SANS}`;
  const message = b.upper || v === 1 ? msg.toUpperCase() : msg;
  const bandH = screen && H > 64 ? H * TICKER_BAND : 0;
  const h = H - bandH; // area above the ticker band
  const wideArt = WIDE_ART.has(cat);
  const badgeFill = b.accent.equals(white) ? hx('#ffd23f') : b.accent;
  /** The price callout, kept inside the canvas. */
  const badge = (x: number, y: number, r: number, burst: boolean) => {
    if (price) priceBadge(ctx, Math.min(W - r * 1.08, Math.max(r * 1.08, x)), Math.min(H - r * 1.08, Math.max(r * 1.08, y)), r, price, badgeFill, inkOn(badgeFill), burst);
  };

  if (a >= 4.2) {
    // ---- strip (horizontal banners): mark | message | price | product
    ctx.fillStyle = grad(ctx, 0, 0, W, 0, b.base, shade(b.base, 0.72));
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css(white, 0.1);
    polyPath(ctx, [W * 0.55, 0, W * 0.75, 0, W * 0.6, H, W * 0.4, H]); ctx.fill();
    const artW = h * (wideArt ? 1.7 : 1.0), artX = W - artW / 2 - h * 0.1;
    ctx.fillStyle = css(white, 0.92);
    ctx.beginPath(); ctx.arc(artX, h * 0.5, h * 0.62, 0, TAU); ctx.fill();
    art(ctx, artX, h * 0.52, h * (wideArt ? 1.3 : 0.86), b);
    let right = artX - artW / 2 - h * 0.15;
    if (price) { badge(right - h * 0.42, h * 0.5, h * 0.42, true); right -= h * 0.95; }
    drawMark(ctx, h * 0.55, h * 0.5, h * 0.36, b, white, b.base);
    ctx.fillStyle = css(ink);
    const f = fit(ctx, message, right - h * 1.2, h * 0.5, head, 1);
    drawFit(ctx, f, h * 1.1, h * 0.36, head, 'left');
    ctx.fillStyle = css(ink, 0.85);
    line(ctx, b.upper ? b.name.toUpperCase() : b.name, h * 1.1, h * 0.78, right - h * 1.2, h * 0.2, b.font, 'left');
  } else if (a < 0.45) {
    // ---- tall (vertical banners)
    ctx.fillStyle = grad(ctx, 0, 0, 0, H, b.base, shade(b.base, 0.6));
    ctx.fillRect(0, 0, W, H);
    drawMark(ctx, W / 2, W * 0.55, W * 0.32, b, white, b.base);
    ctx.fillStyle = css(white, 0.95);
    ctx.beginPath(); ctx.arc(W / 2, H * 0.5, W * 0.42, 0, TAU); ctx.fill();
    art(ctx, W / 2, H * 0.5, W * 0.62, b);
    ctx.fillStyle = css(ink);
    drawFit(ctx, fit(ctx, message, W * 0.86, H * 0.2, head, 3), W / 2, H * 0.78, head, 'center');
    ctx.fillStyle = css(white);
    ctx.fillRect(0, H * 0.92, W, H * 0.08);
    ctx.fillStyle = css(b.dark);
    line(ctx, b.upper ? b.name.toUpperCase() : b.name, W / 2, H * 0.96, W * 0.9, H * 0.05, b.font);
  } else if (a >= 1.25) {
    // ---- landscape (billboards, screens)
    if (v === 0) {
      // studio: light background, product on a color disc, dark message, brand bar
      ctx.fillStyle = grad(ctx, 0, 0, 0, h, '#ffffff', b.light);
      ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = grad(ctx, W * 0.55, 0, W, h, shade(b.base, 1.15), b.base);
      ctx.beginPath(); ctx.arc(W * 0.76, h * 0.5, h * 0.6, 0, TAU); ctx.fill();
      art(ctx, W * 0.76, h * 0.47, h * (wideArt ? 0.95 : 0.78), b);
      ctx.fillStyle = css(b.dark);
      drawFit(ctx, fit(ctx, message, W * 0.46, h * 0.46, head, 2), W * 0.05, h * 0.38, head, 'left');
      drawLockup(ctx, W * 0.05, h * 0.78, h * 0.18, W * 0.44, b, b.base, b.base, white);
      ctx.fillStyle = css(b.base);
      ctx.fillRect(0, h * 0.94, W, h * 0.06);
      badge(W * 0.76 - h * 0.52, h * 0.27, h * 0.24, true);
    } else if (v === 1) {
      // bold color block with a diagonal band, product on a white disc
      ctx.fillStyle = grad(ctx, 0, 0, W, h, shade(b.base, 1.1), shade(b.base, 0.78));
      ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = css(white, 0.12);
      polyPath(ctx, [W * 0.18, 0, W * 0.42, 0, W * 0.3, h, W * 0.06, h]); ctx.fill();
      ctx.fillStyle = css(b.dark, 0.25);
      ctx.beginPath(); ctx.arc(W * 0.23, h * 0.52, h * 0.47, 0, TAU); ctx.fill();
      ctx.fillStyle = css(white);
      ctx.beginPath(); ctx.arc(W * 0.22, h * 0.5, h * 0.43, 0, TAU); ctx.fill();
      art(ctx, W * 0.22, h * 0.5, h * (wideArt ? 0.78 : 0.62), b);
      ctx.fillStyle = css(ink);
      drawFit(ctx, fit(ctx, message, W * 0.5, h * 0.5, head, 2), W * 0.47, h * 0.38, head, 'left');
      const lk = h * 0.17;
      ctx.fillStyle = css(white);
      rrect(ctx, W * 0.46, h * 0.7, W * 0.46, lk * 1.35, lk * 0.3); ctx.fill();
      drawLockup(ctx, W * 0.48, h * 0.7 + lk * 0.68, lk, W * 0.42, b, b.dark, b.base, white);
      badge(W * 0.22 + h * 0.4, h * 0.24, h * 0.22, false);
    } else if (v === 2) {
      // dark premium: spotlight, product with a reflection, light type
      ctx.fillStyle = css(shade(b.dark, 0.55));
      ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = radial(ctx, W * 0.68, h * 0.45, 0, h * 0.9, css(shade(b.base, 1.2), 0.9), css(b.base, 0.35), 'rgba(0,0,0,0)');
      ctx.fillRect(0, 0, W, h);
      ctx.strokeStyle = css(b.accent, 0.8); ctx.lineWidth = Math.max(1, h * 0.012);
      ctx.beginPath(); ctx.moveTo(W * 0.05, h * 0.62); ctx.lineTo(W * 0.2, h * 0.62); ctx.stroke();
      art(ctx, W * 0.7, h * 0.48, h * (wideArt ? 0.95 : 0.8), b);
      ctx.save();
      ctx.globalAlpha = 0.18; ctx.translate(0, h * 1.86); ctx.scale(1, -1);
      ctx.beginPath(); ctx.rect(0, h * 0.86, W, h); ctx.clip();
      art(ctx, W * 0.7, h * 0.48, h * (wideArt ? 0.95 : 0.8), b);
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      drawFit(ctx, fit(ctx, message, W * 0.44, h * 0.42, b.font, 2), W * 0.05, h * 0.36, b.font, 'left');
      drawLockup(ctx, W * 0.05, h * 0.8, h * 0.15, W * 0.4, b, white, b.base, white);
      badge(W * 0.7 + h * 0.48, h * 0.26, h * 0.22, false);
    } else {
      // split panel: brand color left with the lockup, a light photo area right
      const sx = W * 0.36, rest = W - sx;
      ctx.fillStyle = grad(ctx, sx, 0, W, h, '#fbfaf7', mix(b.light, hx('#d9d4ca'), 0.4));
      ctx.fillRect(0, 0, W, h);
      const artS = Math.min(h * (wideArt ? 0.95 : 0.8), rest * (wideArt ? 0.5 : 0.42));
      art(ctx, sx + rest * 0.73, h * 0.53, artS, b);
      ctx.fillStyle = css(b.base);
      polyPath(ctx, [0, 0, sx + h * 0.12, 0, sx - h * 0.08, h, 0, h]); ctx.fill();
      drawMark(ctx, sx * 0.5, h * 0.3, h * 0.17, b, white, b.base);
      ctx.fillStyle = css(ink);
      line(ctx, b.upper ? b.name.toUpperCase() : b.name, sx * 0.48, h * 0.56, sx * 0.84, h * 0.12, b.font);
      ctx.fillStyle = css(b.dark);
      const f = fit(ctx, message, rest * 0.38, h * 0.52, head, 3);
      drawFit(ctx, f, sx + rest * 0.07 + h * 0.04, h * 0.5, head, 'left');
      ctx.fillStyle = css(ink, 0.85);
      ctx.fillRect(sx * 0.2, h * 0.68, sx * 0.56, Math.max(1, h * 0.012));
      badge(sx + rest * 0.73 + artS * 0.42, h * 0.22, h * 0.2, true);
    }
  } else {
    // ---- portrait (posters, columns, flyers)
    if (v === 0 || v === 2) {
      const dark = v === 2;
      ctx.fillStyle = dark ? css(shade(b.dark, 0.6)) : grad(ctx, 0, 0, 0, H, '#ffffff', b.light);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = dark ? radial(ctx, W / 2, H * 0.42, 0, W * 0.75, css(b.base, 0.95), css(b.base, 0.25), 'rgba(0,0,0,0)') : grad(ctx, 0, 0, W, H, shade(b.base, 1.15), b.base);
      ctx.beginPath(); ctx.arc(W / 2, H * 0.37, W * 0.39, 0, TAU); ctx.fill();
      art(ctx, W / 2, H * 0.37, W * (wideArt ? 0.82 : 0.62), b);
      ctx.fillStyle = dark ? '#ffffff' : css(b.dark);
      drawFit(ctx, fit(ctx, message, W * 0.88, H * 0.15, head, 2), W / 2, H * 0.76, head, 'center');
      ctx.fillStyle = css(b.base);
      ctx.fillRect(0, H * 0.86, W, H * 0.14);
      drawLockup(ctx, W / 2, H * 0.93, H * 0.08, W * 0.86, b, ink, white, b.base, 0.5);
      badge(W * 0.78, H * 0.15, W * 0.17, true);
    } else if (v === 1) {
      ctx.fillStyle = grad(ctx, 0, 0, 0, H, shade(b.base, 1.12), shade(b.base, 0.75));
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = css(white, 0.12);
      polyPath(ctx, [0, H * 0.32, W, H * 0.18, W, H * 0.42, 0, H * 0.56]); ctx.fill();
      ctx.fillStyle = css(ink);
      drawFit(ctx, fit(ctx, message, W * 0.88, H * 0.22, head, 3), W / 2, H * 0.15, head, 'center');
      ctx.fillStyle = css(white);
      ctx.beginPath(); ctx.arc(W / 2, H * 0.53, W * 0.36, 0, TAU); ctx.fill();
      art(ctx, W / 2, H * 0.53, W * (wideArt ? 0.62 : 0.5), b);
      ctx.fillStyle = css(white);
      ctx.fillRect(0, H * 0.84, W, H * 0.16);
      drawLockup(ctx, W / 2, H * 0.92, H * 0.085, W * 0.86, b, b.dark, b.base, white, 0.5);
      badge(W * 0.78, H * 0.36, W * 0.15, false);
    } else {
      ctx.fillStyle = grad(ctx, 0, 0, 0, H, '#fbfaf7', mix(b.light, hx('#d9d4ca'), 0.4));
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = css(b.base);
      polyPath(ctx, [0, 0, W, 0, W, H * 0.24, 0, H * 0.3]); ctx.fill();
      drawLockup(ctx, W / 2, H * 0.12, H * 0.09, W * 0.86, b, ink, white, b.base, 0.5);
      art(ctx, W / 2, H * 0.52, W * (wideArt ? 0.84 : 0.62), b);
      ctx.fillStyle = css(b.dark);
      drawFit(ctx, fit(ctx, message, W * 0.88, H * 0.15, head, 2), W / 2, H * 0.83, head, 'center');
      ctx.fillStyle = css(b.base);
      ctx.fillRect(W * 0.3, H * 0.93, W * 0.4, Math.max(1, H * 0.012));
      badge(W * 0.8, H * 0.36, W * 0.15, true);
    }
  }
  if (bandH > 0) tickerBand(ctx, W, H, bandH, b, full);
}

/** Bottom band of screen designs: logo block + static ticker text (scrolls when the screen is near the camera). */
function tickerBand(ctx: Ctx, W: number, H: number, bh: number, b: Brand, msg: string): void {
  const y0 = H - bh;
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, y0, W, bh);
  ctx.fillStyle = css(b.base);
  ctx.fillRect(0, y0, W * TICKER_LOGO, bh);
  ctx.fillStyle = css(b.accent.equals(Color3.White()) ? shade(b.base, 1.3) : b.accent);
  ctx.fillRect(0, y0, W, Math.max(1, bh * 0.07));
  // mark + name in the logo block (just the mark when the name would be too small to read)
  const nf = (s: number) => `800 ${Math.round(s)}px ${SANS}`;
  ctx.font = nf(bh * 0.4);
  const room = W * TICKER_LOGO - bh * 1.25;
  if (room > 0 && (bh * 0.4 * room) / Math.max(1, ctx.measureText(b.name.toUpperCase()).width) >= bh * 0.26) {
    drawMark(ctx, bh * 0.6, y0 + bh * 0.53, bh * 0.36, b, Color3.White(), b.base);
    ctx.fillStyle = css(inkOn(b.base));
    line(ctx, b.name.toUpperCase(), bh * 1.1, y0 + bh * 0.53, room, bh * 0.4, nf, 'left');
  } else drawMark(ctx, W * TICKER_LOGO / 2, y0 + bh * 0.53, bh * 0.38, b, Color3.White(), b.base);
  ctx.save();
  ctx.beginPath(); ctx.rect(W * TICKER_LOGO, y0, W * (1 - TICKER_LOGO), bh); ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(bh * 0.5)}px ${SANS}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(tickerText(b.name, msg), W * TICKER_LOGO + bh * 0.4, y0 + bh * 0.55);
  ctx.restore();
}

export const tickerText = (name: string, msg: string) => `${msg}   ●   ${name}   ●   ${msg}   ●   ${name}   ●   `;

/** The scrolling ticker strip of a screen design (repeats horizontally). */
export function paintTicker(ctx: Ctx, W: number, H: number, ad: AdPlacement): void {
  const b = brandOf(ad.headline || 'Brand', ad.hue);
  const msg = (ad.tagline && ad.tagline !== ad.headline ? ad.tagline : ad.headline) || '';
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `700 ${Math.round(H * 0.5)}px ${SANS}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  // one unit = message, brand; repeated a whole number of times (squeezed a little) so the strip loops seamlessly
  const parts = [msg.toUpperCase(), b.name];
  const gap = H * 1.0;
  const unit = parts.reduce((w, t) => w + ctx.measureText(t).width + gap, 0);
  const reps = Math.max(1, Math.round(W / unit));
  ctx.save();
  ctx.scale(W / (reps * unit), 1);
  let x = 0;
  for (let r = 0; r < reps; r++) {
    parts.forEach((t, i) => {
      ctx.fillStyle = i ? css(mix(b.light, Color3.White(), 0.4)) : '#ffffff';
      ctx.fillText(t, x + gap * 0.5, H * 0.55);
      x += ctx.measureText(t).width + gap;
      ctx.fillStyle = css(b.accent.equals(Color3.White()) ? shade(b.base, 1.4) : b.accent);
      ctx.beginPath(); ctx.arc(x, H * 0.53, H * 0.1, 0, TAU); ctx.fill();
    });
  }
  ctx.restore();
}

function paintVacant(ctx: Ctx, W: number, H: number, opts: PaintOpts): void {
  const o = opts.owner;
  const name = o?.name ?? 'the owner';
  const ob = brandOf(name, o?.hue ?? 0.58);
  const phone = `555-${String(1000 + Math.floor(hashStr(name) * 8999)).slice(0, 4)}`;
  const a = W / H;
  const head = (s: number) => `900 ${Math.round(s)}px ${SANS}`;
  const body = (s: number) => `600 ${Math.round(s)}px ${SANS}`;
  if (opts.screen) {
    ctx.fillStyle = grad(ctx, 0, 0, W, H, '#10141c', '#1b2333');
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = css(ob.base, 0.9); ctx.lineWidth = Math.max(2, H * 0.02);
    ctx.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
    ctx.fillStyle = '#ffffff';
    drawFit(ctx, fit(ctx, 'YOUR AD HERE', W * 0.8, H * 0.32, head, 1), W / 2, H * 0.36, head, 'center');
    ctx.fillStyle = css(mix(ob.base, Color3.White(), 0.4));
    line(ctx, `Advertise on this screen · call ${name} ${phone}`, W / 2, H * 0.66, W * 0.84, H * 0.08, body);
    drawMark(ctx, W / 2, H * 0.82, H * 0.07, ob, ob.base, Color3.White());
    return;
  }
  ctx.fillStyle = grad(ctx, 0, 0, 0, H, '#f4f3ef', '#dedcd5');
  ctx.fillRect(0, 0, W, H);
  // faint paste seams of the empty board
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = Math.max(1, W / 300);
  const seams = a > 1 ? Math.round(a * 2) : 2;
  for (let i = 1; i < seams; i++) { ctx.beginPath(); ctx.moveTo((W * i) / seams, 0); ctx.lineTo((W * i) / seams, H); ctx.stroke(); }
  ctx.fillStyle = css(ob.base);
  if (a >= 1.25) {
    ctx.fillRect(0, 0, W * 0.03, H);
    ctx.fillStyle = '#23262b';
    drawFit(ctx, fit(ctx, 'ADVERTISE HERE', W * 0.62, H * 0.34, head, 1), W * 0.07, H * 0.38, head, 'left');
    ctx.fillStyle = '#4a4f57';
    line(ctx, `call ${name} · ${phone}`, W * 0.07, H * 0.66, W * 0.62, H * 0.12, body, 'left');
    drawMark(ctx, W * 0.84, H * 0.5, H * 0.24, ob, ob.base, Color3.White());
  } else {
    ctx.fillRect(0, 0, W, H * 0.05);
    ctx.fillStyle = '#23262b';
    drawFit(ctx, fit(ctx, 'YOUR AD HERE', W * 0.86, H * 0.3, head, 3), W / 2, H * 0.36, head, 'center');
    ctx.fillStyle = '#4a4f57';
    drawFit(ctx, fit(ctx, `call ${name} ${phone}`, W * 0.84, H * 0.14, body, 2), W / 2, H * 0.66, body, 'center');
    drawMark(ctx, W / 2, H * 0.84, W * 0.12, ob, ob.base, Color3.White());
  }
}

function paintCampaign(ctx: Ctx, W: number, H: number, ad: AdPlacement): void {
  const base = hsl(ad.hue, 0.68, 0.45), dark = hsl(ad.hue, 0.6, 0.2), light = hsl(ad.hue, 0.45, 0.93);
  const name = (ad.headline || '').replace(/^\s*vote\s+(for\s+)?/i, '').trim() || ad.headline || 'Candidate';
  const tag = ad.tagline || '';
  const head = (s: number) => `900 ${Math.round(s)}px ${SANS}`;
  ctx.fillStyle = grad(ctx, 0, 0, W, H, shade(base, 1.08), shade(base, 0.85));
  ctx.fillRect(0, 0, W, H);
  // flag-like stripes
  ctx.fillStyle = css(Color3.White(), 0.14);
  polyPath(ctx, [0, H * 0.62, W, H * 0.44, W, H * 0.5, 0, H * 0.68]); ctx.fill();
  ctx.fillStyle = css(dark, 0.6);
  polyPath(ctx, [0, H * 0.7, W, H * 0.52, W, H, 0, H]); ctx.fill();
  const wide = W >= H * 1.3;
  if (wide) {
    portrait(ctx, W * 0.2, H * 0.98, H * 0.86, dark, light, ad.hue);
    ctx.fillStyle = '#ffffff';
    line(ctx, 'VOTE', W * 0.64, H * 0.17, W * 0.6, H * 0.2, head);
    ctx.fillStyle = css(light);
    drawFit(ctx, fit(ctx, name.toUpperCase(), W * 0.6, H * 0.32, head, 1), W * 0.64, H * 0.42, head, 'center');
    ctx.fillStyle = '#ffffff';
    rrect(ctx, W * 0.36, H * 0.64, W * 0.56, H * 0.2, H * 0.03); ctx.fill();
    ctx.fillStyle = css(dark);
    drawFit(ctx, fit(ctx, tag, W * 0.52, H * 0.15, (s) => `800 ${Math.round(s)}px ${SANS}`, 2), W * 0.64, H * 0.74, (s) => `800 ${Math.round(s)}px ${SANS}`, 'center');
    ctx.fillStyle = css(light, 0.9);
    for (let i = 0; i < 5; i++) star(ctx, W * 0.46 + i * W * 0.09, H * 0.92, H * 0.035);
  } else {
    portrait(ctx, W * 0.5, H * 0.62, W * 0.62, dark, light, ad.hue);
    ctx.fillStyle = '#ffffff';
    line(ctx, 'VOTE', W / 2, H * 0.08, W * 0.8, H * 0.09, head);
    drawFit(ctx, fit(ctx, name.toUpperCase(), W * 0.9, H * 0.12, head, 1), W / 2, H * 0.69, head, 'center');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W * 0.06, H * 0.78, W * 0.88, H * 0.13);
    ctx.fillStyle = css(dark);
    drawFit(ctx, fit(ctx, tag, W * 0.82, H * 0.1, (s) => `800 ${Math.round(s)}px ${SANS}`, 2), W / 2, H * 0.845, (s) => `800 ${Math.round(s)}px ${SANS}`, 'center');
    ctx.fillStyle = css(light, 0.9);
    for (let i = 0; i < 5; i++) star(ctx, W * 0.3 + i * W * 0.1, H * 0.955, W * 0.03);
  }
}

/** Head-and-shoulders portrait of a candidate (suit, tie, hair), bottom at y. */
function portrait(ctx: Ctx, cx: number, bot: number, h: number, suit: Color3, bg: Color3, hue: number): void {
  const s = h;
  ctx.save();
  ctx.fillStyle = css(bg, 0.25);
  ctx.beginPath(); ctx.arc(cx, bot - s * 0.55, s * 0.42, 0, TAU); ctx.fill();
  // shoulders + suit
  ctx.fillStyle = grad(ctx, cx - s * 0.4, 0, cx + s * 0.4, 0, shade(suit, 1.4), suit);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.42, bot); ctx.quadraticCurveTo(cx - s * 0.42, bot - s * 0.3, cx - s * 0.12, bot - s * 0.36);
  ctx.lineTo(cx + s * 0.12, bot - s * 0.36); ctx.quadraticCurveTo(cx + s * 0.42, bot - s * 0.3, cx + s * 0.42, bot); ctx.fill();
  ctx.fillStyle = '#f4f2ee';
  polyPath(ctx, [cx - s * 0.1, bot - s * 0.36, cx + s * 0.1, bot - s * 0.36, cx, bot - s * 0.18]); ctx.fill();
  ctx.fillStyle = css(hsl(hue + 0.5, 0.6, 0.45));
  polyPath(ctx, [cx - s * 0.025, bot - s * 0.33, cx + s * 0.025, bot - s * 0.33, cx + s * 0.04, bot - s * 0.12, cx, bot - s * 0.08, cx - s * 0.04, bot - s * 0.12]); ctx.fill();
  // neck + head
  const skin = hx(['#f0cfb4', '#d9a77f', '#b07a52', '#7c5235'][Math.floor(rnd(hue * 100, 3) * 4)]);
  ctx.fillStyle = css(shade(skin, 0.9));
  ctx.fillRect(cx - s * 0.06, bot - s * 0.44, s * 0.12, s * 0.1);
  ctx.fillStyle = grad(ctx, cx - s * 0.14, 0, cx + s * 0.14, 0, shade(skin, 1.05), shade(skin, 0.85));
  ell(ctx, cx, bot - s * 0.56, s * 0.13, s * 0.165); ctx.fill();
  ctx.fillStyle = css(hx(['#2a1d14', '#4a3222', '#8a6b48', '#9c9890'][Math.floor(rnd(hue * 100, 4) * 4)]));
  ctx.beginPath(); ctx.ellipse(cx, bot - s * 0.62, s * 0.14, s * 0.12, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.lineTo(cx + s * 0.13, bot - s * 0.58); ctx.lineTo(cx - s * 0.13, bot - s * 0.58); ctx.fill();
  ctx.restore();
}

function paintCause(ctx: Ctx, W: number, H: number, ad: AdPlacement): void {
  const base = hsl(ad.hue, 0.55, 0.45), dark = hsl(ad.hue, 0.55, 0.2), light = hsl(ad.hue, 0.4, 0.94), accent = hsl(ad.hue + 0.5, 0.7, 0.56);
  const head = (s: number) => `700 ${Math.round(s)}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = grad(ctx, 0, 0, 0, H, '#ffffff', light);
  ctx.fillRect(0, 0, W, H);
  const wide = W >= H;
  ctx.fillStyle = css(accent);
  heartPath(ctx, wide ? W * 0.18 : W / 2, wide ? H * 0.45 : H * 0.28, Math.min(W, H) * 0.24);
  ctx.fillStyle = css(dark);
  drawFit(ctx, fit(ctx, ad.headline || '', wide ? W * 0.6 : W * 0.86, wide ? H * 0.5 : H * 0.3, head, 3), wide ? W * 0.63 : W / 2, wide ? H * 0.4 : H * 0.62, head, 'center');
  ctx.fillStyle = css(base);
  ctx.fillRect(0, H * 0.86, W, H * 0.14);
  ctx.fillStyle = '#ffffff';
  line(ctx, ad.tagline || '', W / 2, H * 0.93, W * 0.9, H * 0.08, (s) => `700 ${Math.round(s)}px ${SANS}`);
}

function paintEvent(ctx: Ctx, W: number, H: number, ad: AdPlacement): void {
  const base = hsl(ad.hue, 0.75, 0.5), dark = hsl(ad.hue, 0.6, 0.1), light = hsl(ad.hue, 0.5, 0.88), accent = hsl(ad.hue + 0.45, 0.85, 0.6);
  const head = (s: number) => `900 ${Math.round(s)}px ${SANS}`;
  ctx.fillStyle = grad(ctx, 0, 0, 0, H, css(shade(dark, 0.8)), css(shade(base, 0.45)));
  ctx.fillRect(0, 0, W, H);
  // stage light beams
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const x = W * (0.1 + i * 0.2);
    ctx.fillStyle = grad(ctx, 0, 0, 0, H, css(i % 2 ? accent : base, 0.35), 'rgba(0,0,0,0)');
    polyPath(ctx, [x - W * 0.01, 0, x + W * 0.01, 0, x + W * (0.12 - i * 0.06), H, x - W * (0.1 - i * 0.04), H]);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // crowd
  ctx.fillStyle = '#07080a';
  for (let i = 0; i < 26; i++) {
    const x = (i / 25) * W, r = Math.min(W, H) * (0.035 + rnd(i, 5) * 0.015), y = H - r * (1.6 + rnd(i, 6));
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillRect(x - r * 1.3, y + r * 0.6, r * 2.6, H);
    if (rnd(i, 7) < 0.3) { ctx.save(); ctx.translate(x + r, y); ctx.rotate(-0.3); ctx.fillRect(-r * 0.25, -r * 3, r * 0.5, r * 3); ctx.restore(); }
  }
  const wide = W >= H * 1.25;
  ctx.fillStyle = css(light);
  drawFit(ctx, fit(ctx, (ad.headline || '').toUpperCase(), W * 0.84, H * (wide ? 0.34 : 0.26), head, 2), W / 2, H * (wide ? 0.3 : 0.22), head, 'center');
  ctx.fillStyle = css(accent);
  line(ctx, ad.tagline || '', W / 2, H * (wide ? 0.58 : 0.45), W * 0.86, H * (wide ? 0.11 : 0.06), (s) => `800 ${Math.round(s)}px ${SANS}`);
  ctx.fillStyle = css(base);
  rrect(ctx, W / 2 - Math.min(W, H) * 0.17, H * (wide ? 0.7 : 0.53), Math.min(W, H) * 0.34, Math.min(W, H) * 0.1, Math.min(W, H) * 0.03); ctx.fill();
  ctx.fillStyle = '#ffffff';
  line(ctx, 'LIVE', W / 2, H * (wide ? 0.7 : 0.53) + Math.min(W, H) * 0.05, Math.min(W, H) * 0.3, Math.min(W, H) * 0.07, head);
}

function tearTabs(ctx: Ctx, W: number, H: number, seed: number): void {
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, H * 0.9, W, H * 0.1);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.setLineDash([2, 2]);
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((i / 8) * W, H * 0.9); ctx.lineTo((i / 8) * W, H); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let i = 0; i < 8; i++) if (rnd(seed, 50 + i) < 0.35) ctx.clearRect((i / 8) * W + 1, H * 0.905, W / 8 - 2, H * 0.1);
}

function weather(ctx: Ctx, W: number, H: number, seed: number, amount: number): void {
  ctx.fillStyle = `rgba(250,245,225,${0.1 * amount})`;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90 * amount; i++) {
    ctx.fillStyle = `rgba(60,50,40,${0.06 + rnd(seed, i) * 0.12})`;
    const s = 1 + rnd(seed, i + 300) * 2.5;
    ctx.fillRect(rnd(seed, i + 100) * W, rnd(seed, i + 200) * H, s, s);
  }
  ctx.strokeStyle = `rgba(255,255,255,${0.18 * amount})`;
  ctx.lineWidth = Math.max(1, W / 200);
  ctx.beginPath();
  ctx.moveTo(0, H * (0.45 + rnd(seed, 900) * 0.1)); ctx.lineTo(W, H * (0.45 + rnd(seed, 901) * 0.1));
  ctx.moveTo(W * (0.48 + rnd(seed, 902) * 0.06), 0); ctx.lineTo(W * (0.48 + rnd(seed, 903) * 0.06), H);
  ctx.stroke();
}

function tornCorner(ctx: Ctx, W: number, H: number, seed: number): void {
  if (rnd(seed, 70) >= 0.6) return;
  const m = Math.min(W, H);
  const cx = rnd(seed, 71) < 0.5 ? 0 : W, s = m * (0.1 + rnd(seed, 72) * 0.12);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx + (cx ? -s : s), 0); ctx.lineTo(cx + (cx ? -s * 0.35 : s * 0.35), s * 0.5); ctx.lineTo(cx, s * 1.1); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------- plates & liveries

/** The small owner plate under a billboard ("OUTFRONT"-style). */
export function paintPlate(ctx: Ctx, W: number, H: number, name: string, hue: number): void {
  const b = brandOf(name, hue);
  ctx.fillStyle = grad(ctx, 0, 0, 0, H, '#f6f5f1', '#d9d7d0');
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = css(b.base);
  ctx.fillRect(0, H * 0.84, W, H * 0.16);
  const total = drawLockup(ctx, W / 2, H * 0.44, H * 0.58, W * 0.92, b, hx('#1d2024'), b.base, Color3.White(), 0.5);
  void total;
}

/**
 * A vehicle livery in one texture: the truck box side (top band, aspect 2.3),
 * the van's cargo side (middle band, aspect 2.0), and the rear doors (bottom
 * left, aspect 2.4). Background matches the body color the vehicle gets.
 */
export interface LiveryStyle { body: Color3; box: Color3; cab: Color3; white: boolean }

export function liveryStyle(name: string, hue: number): LiveryStyle {
  const b = brandOf(name, hue);
  const white = rnd(b.seed, 41) < 0.62;
  return { white, box: white ? hx('#f2f2ef') : b.base, body: white ? hx('#f2f2ef') : b.base, cab: b.base };
}

export const LIVERY = {
  truck: [0, 0, 1, 0.43] as const, // u0, v0 (from the top), u1, v1
  van: [0, 0.44, 0.88, 0.87] as const,
  rear: [0, 0.88, 0.42, 1] as const,
};

export function paintLivery(ctx: Ctx, W: number, H: number, name: string, hue: number): void {
  const b = brandOf(name, hue);
  const st = liveryStyle(name, hue);
  ctx.fillStyle = css(st.box);
  ctx.fillRect(0, 0, W, H);
  const region = (r: readonly [number, number, number, number], draw: (x: number, y: number, w: number, h: number) => void) => {
    const x = r[0] * W, y = r[1] * H, w = (r[2] - r[0]) * W, h = (r[3] - r[1]) * H;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    draw(x, y, w, h);
    ctx.restore();
  };
  const fg = st.white ? b.base : Color3.White();
  const markFill = st.white ? b.base : Color3.White(), markInk = st.white ? Color3.White() : b.base;
  const cat = categoryOf({ headline: name, tagline: '' });
  const what = cat === 'grocery' ? 'Groceries · Fresh daily' : cat === 'food' ? 'Fresh food delivered' : cat === 'freight' ? 'Freight · Logistics' : cat === 'furniture' ? 'Home delivery'
    : cat === 'materials' ? 'Building supplies' : cat === 'realty' ? 'Construction' : cat === 'farm' ? 'Farm fresh' : cat === 'electronics' ? 'Tech delivered' : 'Delivery';
  const side = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = css(st.box);
    ctx.fillRect(x, y, w, h);
    // a sweeping band from the back
    ctx.fillStyle = st.white ? css(b.base) : css(shade(b.base, 0.75));
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.62); ctx.bezierCurveTo(x + w * 0.35, y + h * 0.58, x + w * 0.6, y + h * 0.9, x + w, y + h * 0.78);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(b.accent.equals(Color3.White()) ? (st.white ? b.dark : hx('#ffffff')) : b.accent);
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.56); ctx.bezierCurveTo(x + w * 0.35, y + h * 0.52, x + w * 0.6, y + h * 0.84, x + w, y + h * 0.72);
    ctx.lineTo(x + w, y + h * 0.76); ctx.bezierCurveTo(x + w * 0.6, y + h * 0.88, x + w * 0.35, y + h * 0.56, x, y + h * 0.6); ctx.closePath(); ctx.fill();
    drawLockup(ctx, x + w * 0.06, y + h * 0.3, h * 0.34, w * 0.88, b, fg, markFill, markInk, 0);
    ctx.fillStyle = st.white ? css(b.dark) : 'rgba(255,255,255,0.9)';
    line(ctx, what, x + w * 0.06, y + h * 0.52, w * 0.6, h * 0.09, (s) => `600 ${Math.round(s)}px ${SANS}`, 'left');
  };
  region(LIVERY.truck, side);
  region(LIVERY.van, side);
  region(LIVERY.rear, (x, y, w, h) => {
    ctx.fillStyle = css(st.box);
    ctx.fillRect(x, y, w, h);
    drawLockup(ctx, x + w / 2, y + h * 0.5, h * 0.62, w * 0.92, b, fg, markFill, markInk, 0.5);
  });
}
