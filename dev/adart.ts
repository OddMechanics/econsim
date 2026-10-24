// Flat gallery of the ad artwork (src/render/adArt.ts): every sponsor of the
// ads bench in each format, vacant spaces, owner plates and vehicle liveries.
// Open /dev/adart.html?fmt=board (or screen, poster, column, banner, strip, flyer, vacant, livery, plate, all).

import type { AdPlacement } from '../src/sim/types';
import { paintAd, paintLivery, paintPlate, paintTicker } from '../src/render/adArt';

const q = new URLSearchParams(location.search);
const fmt = q.get('fmt') ?? 'all';
const scale = Number(q.get('scale') ?? 1);
const g = document.getElementById('g')!;

const SPONSORS: [string, string, number, AdPlacement['topic']][] = [
  ['Bluebird Diner', 'Dinner from 5', 0.58, 'product'], ['Golden Market', 'Groceries from 2.50', 0.1, 'product'],
  ['Meridian Motors', 'New cars from 240', 0.98, 'product'], ['Voltix Electronics', 'Smarter every day', 0.55, 'product'],
  ['Cozy Home Furniture', 'Sofas 30% off', 0.07, 'product'], ['Harbor Bank', 'Loans for your dreams', 0.63, 'product'],
  ['Chirp', 'Join Chirp today', 0.53, 'product'], ['Channel 7', 'News you can trust', 0.0, 'product'],
  ['Sunrise Café', 'Fresh, fast, friendly', 0.06, 'product'], ['Loomworks Apparel', 'Fair prices, every day', 0.86, 'product'],
  ['Oakline Builders', 'Your next home, built by us', 0.11, 'product'], ['Atlas Freight', 'Anything, anywhere in the city', 0.6, 'product'],
  ['Ironhold Steel', 'Steel by the crate', 0.6, 'product'], ['Miller Farms', 'Crops by the crate', 0.28, 'product'],
  ['Anvil Tools', 'Tools by the crate', 0.02, 'product'], ['Pine Realty', 'Homes for everyone', 0.4, 'product'],
  ['Summit Group', 'Built for this city', 0.7, 'product'], ['Prime Grill', 'Taste the difference', 0.03, 'product'],
  ['Seekr', 'Find anything', 0.33, 'product'], ['Timberline Lumber', 'Planks by the crate', 0.09, 'product'],
  ['Corner Shop', 'Everything you need', 0.45, 'product'], ['Nimbus Systems', 'Computers from 40', 0.75, 'product'],
  ['Dunton Systems', 'electronics by the truckload', 0.22, 'product'], ['Ashholt Foundry', 'steel by the truckload', 0.42, 'product'],
  ['Meridian Auto Sales', '0% financing', 0.66, 'product'], ['Rosa Kessler Realty', 'Apartments from 12 a day', 0.92, 'product'],
  ['VOTE LOPEZ', 'A city that works · for Mayor', 0.6, 'campaign'], ['VOTE BECKER', 'Lower taxes, more jobs · for Mayor', 0.0, 'campaign'],
  ['Save the River', 'Join the cleanup on Sunday', 0.38, 'cause'], ['Summer Concert', 'Saturday 8 pm at the plaza', 0.78, 'event'],
];
const FORMATS: Record<string, [AdPlacement['kind'], number, number]> = {
  board: ['billboard', 480, 160], screen: ['screen', 448, 256], poster: ['poster', 170, 240], column: ['column', 150, 240],
  banner: ['banner', 100, 320], strip: ['banner', 480, 92], flyer: ['flyer', 120, 168],
};

function add(label: string, W: number, H: number, paint: (ctx: CanvasRenderingContext2D) => void): void {
  const f = document.createElement('figure');
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  paint(ctx);
  f.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  f.appendChild(cap);
  g.appendChild(f);
}

const ad = (kind: AdPlacement['kind'], s: (typeof SPONSORS)[number], i: number): AdPlacement => ({
  id: i, kind, x: 0, y: 0, z: 0, angle: 0, w: 1, h: 1, building: -1, sponsor: 100 + i, headline: s[0], tagline: s[1], hue: s[2], topic: s[3], created: 0, expires: 1,
});
for (const [name, [kind, W, H]] of Object.entries(FORMATS)) {
  if (fmt !== 'all' && fmt !== name) continue;
  SPONSORS.forEach((s, i) => add(`${name}: ${s[0]}`, W, H, (ctx) => paintAd(ctx, W, H, ad(kind, s, i), { screen: kind === 'screen' })));
  if (name === 'screen') SPONSORS.slice(0, 6).forEach((s, i) => add(`ticker: ${s[0]}`, 512, 32, (ctx) => paintTicker(ctx, 512, 32, ad('screen', s, i))));
}
if (fmt === 'all' || fmt === 'vacant') {
  const owner = { name: 'Metro Outdoor', hue: 0.45, adco: true };
  for (const [name, [kind, W, H]] of Object.entries(FORMATS)) {
    const a = ad(kind, SPONSORS[0], 0);
    a.sponsor = -1;
    add(`vacant ${name}`, W, H, (ctx) => paintAd(ctx, W, H, a, { owner, screen: kind === 'screen' }));
  }
}
if (fmt === 'all' || fmt === 'plate') {
  for (const [n, h] of [['Metro Outdoor', 0.45], ['Skyline Media', 0.8], ['Ströer City', 0.6]] as [string, number][]) add(`plate ${n}`, 256, 56, (ctx) => paintPlate(ctx, 256, 56, n, h));
}
if (fmt === 'all' || fmt === 'livery') {
  for (const [n, h] of [['Golden Market', 0.1], ['Atlas Freight', 0.6], ['Interstate Freight', 0.02], ['MegaMart', 0.95], ['Parcelo', 0.13], ['Bluebird Diner', 0.58], ['Miller Farms', 0.28], ['Cozy Home Furniture', 0.07]] as [string, number][]) {
    add(`livery ${n}`, 256, 256, (ctx) => paintLivery(ctx, 256, 256, n, h));
  }
}
