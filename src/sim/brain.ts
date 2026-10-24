// Tiny neural networks ("brains").
//
// Each person has a small network (10 inputs -> 6 hidden -> 8 outputs) that
// learns, from their own life, how much better or worse than usual each kind
// of activity turns out for them in a given situation. Its output nudges the
// hand-written utility scores in ai.ts; it doesn't replace them.
//
// Rewards are personal (a user decision): the reward is the change in that
// person's own satisfaction, weighted by their personality (a sociable person
// values company more, an ambitious one money, …).
//
// Newcomers inherit a blend of the brains of people who are doing well.

import type { Ctx } from './ctx';
import { homeComfort } from './housing';
import type { Brain, Person } from './types';

export const CATS = ['work', 'gig', 'food', 'social', 'rest', 'build', 'career', 'shop'] as const;
export const CAT_LABEL = ['Working', 'Gigs & day labor', 'Getting food', 'Socializing & fun', 'Resting', 'Housing', 'Career moves', 'Shopping'];
const IN = 10, HID = 6, OUT = CATS.length;
const ALPHA = 0.45; // how much the brain can shift a score
const LR = 0.03;

export function categoryOf(label: string): number {
  if (/^Go to work|^Work at own/.test(label)) return 0;
  if (/^Drive for|^Deliver for|day labor/.test(label)) return 1;
  if (/^Buy \d+ |Go home to eat|groceries|^Order (a meal|dinner)/.test(label)) return 2;
  if (/Hang out|^Eat at|Browse|^Go for a walk|Net|TV/.test(label)) return 3;
  if (/sleep|Relax|^Rest/i.test(label)) return 4;
  if (/^Have a|^Buy a trailer|Rent a|Move into|Look for a place/.test(label)) return 5;
  if (/^Apply|job board|^Start a|^Develop|^Lease|^Look for work/.test(label)) return 6;
  if (/^Buy (a|new|furniture)|^Order/.test(label)) return 7;
  return 4;
}

function rand(ctx: Ctx, scale: number): number {
  return (ctx.rng.next() * 2 - 1) * scale;
}

export function newBrain(ctx: Ctx): Brain {
  return {
    w1: Array.from({ length: IN * HID }, () => rand(ctx, 0.3)),
    b1: Array.from({ length: HID }, () => 0),
    w2: Array.from({ length: HID * OUT }, () => rand(ctx, 0.05)),
    b2: Array.from({ length: OUT }, () => 0),
    base: 0,
    n: 0,
  };
}

/** A newcomer's brain: a blend of a few people who are doing well, plus a little noise. */
export function inheritBrain(ctx: Ctx): Brain {
  const pool = ctx.s.people.filter((p) => p.brain && p.brain.n > 20).sort((a, b) => b.mood + Math.log1p(b.money) / 6 - a.mood - Math.log1p(a.money) / 6).slice(0, 15);
  if (pool.length < 3) return newBrain(ctx);
  const parents = [0, 1, 2].map(() => pool[Math.floor(ctx.rng.next() * pool.length)].brain!);
  const mix = (k: keyof Pick<Brain, 'w1' | 'b1' | 'w2' | 'b2'>) => parents[0][k].map((_, i) => parents.reduce((s, b) => s + b[k][i], 0) / parents.length + rand(ctx, 0.02));
  return { w1: mix('w1'), b1: mix('b1'), w2: mix('w2'), b2: mix('b2'), base: 0, n: 0 };
}

export function features(ctx: Ctx, p: Person): number[] {
  const h = ((ctx.s.tick % 1440) / 1440) * Math.PI * 2;
  return [
    Math.sin(h), Math.cos(h),
    p.needs.energy / 100, p.needs.food / 100, p.needs.social / 100, p.needs.fun / 100,
    Math.min(1.5, Math.log1p(Math.max(0, p.money)) / 6),
    p.job >= 0 ? 1 : 0, p.home >= 0 ? 1 : 0, p.mood,
  ];
}

export function predict(b: Brain, x: number[]): { h: number[]; out: number[] } {
  const h = new Array(HID);
  for (let j = 0; j < HID; j++) {
    let s = b.b1[j];
    for (let i = 0; i < IN; i++) s += x[i] * b.w1[i * HID + j];
    h[j] = Math.tanh(s);
  }
  const out = new Array(OUT);
  for (let k = 0; k < OUT; k++) {
    let s = b.b2[k];
    for (let j = 0; j < HID; j++) s += h[j] * b.w2[j * OUT + k];
    out[k] = Math.max(-2, Math.min(2, s));
  }
  return { h, out };
}

/** How content a person is right now, by their own values. */
export function satisfaction(ctx: Ctx, p: Person): number {
  const t = p.traits, n = p.needs;
  return n.food / 100 + (n.energy / 100) * 0.6 + n.health / 100 + (n.social / 100) * (0.3 + t.sociability)
    + (n.fun / 100) * (0.3 + t.comfortLove) + Math.log1p(Math.max(0, p.money)) * (0.15 + 0.25 * t.ambition)
    + homeComfort(ctx, p) * (0.5 + t.comfortLove);
}

/** Score bonus per category, from the brain. */
export function brainBias(ctx: Ctx, p: Person): { x: number[]; bias: number[] } | null {
  if (!p.brain) return null;
  const x = features(ctx, p);
  const { out } = predict(p.brain, x);
  return { x, bias: out.map((o) => o * ALPHA) };
}

export function remember(ctx: Ctx, p: Person, cat: number, x: number[]): void {
  p.brainMem = { cat, x, s0: satisfaction(ctx, p), t0: ctx.s.tick };
}

/** Learn from the task that just ended: was it better or worse than usual? */
export function learn(ctx: Ctx, p: Person): void {
  const mem = p.brainMem;
  const b = p.brain;
  p.brainMem = undefined;
  if (!mem || !b) return;
  const hours = Math.max(0.25, (ctx.s.tick - mem.t0) / 60);
  const rate = (satisfaction(ctx, p) - mem.s0) / hours;
  const reward = Math.max(-2, Math.min(2, (rate - b.base) * 5));
  b.base = 0.97 * b.base + 0.03 * rate;
  b.n++;
  // one step of gradient descent on (prediction - reward)^2 for the chosen output
  const { h, out } = predict(b, mem.x);
  const err = out[mem.cat] - reward;
  const k = mem.cat;
  for (let j = 0; j < HID; j++) {
    const gOut = err * h[j];
    const gHid = err * b.w2[j * OUT + k] * (1 - h[j] * h[j]);
    b.w2[j * OUT + k] -= LR * gOut;
    for (let i = 0; i < IN; i++) b.w1[i * HID + j] -= LR * gHid * mem.x[i];
    b.b1[j] -= LR * gHid;
  }
  b.b2[k] -= LR * err;
}
