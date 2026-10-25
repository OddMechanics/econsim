// Who knows whom in business. There is no central market where every offer
// is visible: a company can only order from suppliers it has heard of, and
// only sells to customers who know it exists. Companies get to know each
// other through
//  - their owners' and managers' acquaintances,
//  - ads their bosses have seen (billboards, TV, sponsored posts, search ads),
//  - sales reps, who call on companies that might buy what theirs makes,
//  - a search engine (once there is one), which finds suppliers with a website,
//  - doing business (a deal makes both sides contacts).
// Outside suppliers and buyers are always reachable (catalogs, national
// distributors), and governments put their purchases out to public tender.
// So a new local maker has to work to be found, which is what sales reps
// and advertising are for.

import { OUTSIDE } from './config';
import { controllerOf, type Ctx } from './ctx';
import { BUILDINGS, RETAIL_GOODS } from './goods';
import { staffAt } from './jobs';
import type { Firm, Good } from './types';

const MAX_CONTACTS = 60;

/** Can `a` and `b` do business (does either know the other)? */
export function knows(ctx: Ctx, a: number, b: number): boolean {
  if (a === OUTSIDE.id || b === OUTSIDE.id || a === b) return true;
  if (ctx.govOfFirm.has(a) || ctx.govOfFirm.has(b)) return true;
  const fa = ctx.fById.get(a), fb = ctx.fById.get(b);
  if (!fa || !fb) return true;
  return !!(fa.contacts?.includes(b) || fb.contacts?.includes(a));
}

/** Make two companies contacts of each other. */
export function introduce(ctx: Ctx, a: number, b: number): void {
  add(ctx.fById.get(a), b);
  add(ctx.fById.get(b), a);
}

function add(f: Firm | undefined, id: number): boolean {
  if (!f || f.id === id) return false;
  f.contacts ??= [];
  if (f.contacts.includes(id)) return false;
  f.contacts.push(id);
  if (f.contacts.length > MAX_CONTACTS) f.contacts.shift();
  return true;
}

/** What a company buys (inputs, stock, materials). */
export function inputsOf(f: Firm): Good[] {
  const def = BUILDINGS[f.kind];
  if (def.recipe) return Object.keys(def.recipe.inputs) as Good[];
  if (def.service === 'retail') return RETAIL_GOODS;
  if (def.service === 'cars') return ['cars'];
  if (def.service === 'meal') return ['meat', 'produce', 'bread', 'groceries'];
  if (def.service === 'build') return ['planks', 'bricks', 'steel', 'concrete', 'glass'];
  return [];
}

/** Is there a search engine people use? (Returns its firm, the biggest one.) */
function searchEngine(ctx: Ctx): Firm | undefined {
  let best: Firm | undefined;
  for (const f of ctx.s.firms) if (!f.closed && f.site?.kind === 'search' && (!best || f.site.users > best.site!.users)) best = f;
  return best;
}

/**
 * Daily: companies meet new trading partners. Bosses' friends' companies,
 * advertisers they noticed, sales calls, and (if there's a search engine) a
 * couple of suppliers with websites for each input.
 */
export function contactsDaily(ctx: Ctx): void {
  const firms = ctx.s.firms.filter((f) => !f.closed);
  const byOwner = new Map<number, Firm[]>();
  for (const f of firms) {
    const arr = byOwner.get(f.owner);
    if (arr) arr.push(f); else byOwner.set(f.owner, [f]);
  }
  // who makes what (for sales calls and searches)
  const makers = new Map<Good, Firm[]>();
  for (const f of firms) {
    const out = BUILDINGS[f.kind].output;
    if (!out) continue;
    const arr = makers.get(out);
    if (arr) arr.push(f); else makers.set(out, [f]);
  }
  const search = searchEngine(ctx);
  for (const f of firms) {
    const boss = controllerOf(ctx, f);
    if (!boss) continue;
    // word of mouth: now and then they hear of a local maker of something they buy
    const needs = inputsOf(f);
    if (needs.length && ctx.rng.chance(0.5)) {
      const g = needs[Math.floor(ctx.rng.next() * needs.length)];
      const list = (makers.get(g) ?? []).filter((m) => m !== f && !f.contacts?.includes(m.id));
      if (list.length) introduce(ctx, f.id, list[Math.floor(ctx.rng.next() * list.length)].id);
    }
    // 1. the boss's acquaintances who own companies
    for (const [id, r] of Object.entries(boss.rel)) {
      if (r.trust < 0.35 || r.fam < 3) continue;
      for (const g of byOwner.get(+id) ?? []) add(f, g.id);
    }
    // 2. companies whose ads the boss has noticed
    for (const [id, a] of Object.entries(boss.pol.aware)) {
      if (a > 0.15 && ctx.fById.has(+id)) add(f, +id);
    }
    // 3. a search engine finds suppliers (with a website) for what it needs
    if (search && boss.pol.sites.includes(search.id)) {
      for (const g of inputsOf(f)) {
        const found = (makers.get(g) ?? []).filter((m) => m.website && !f.contacts?.includes(m.id));
        // sponsored results first (companies that advertise get found first)
        found.sort((a, b) => (b.adSpend?.net ?? 0) - (a.adSpend?.net ?? 0));
        for (const m of found.slice(0, 2)) introduce(ctx, f.id, m.id);
      }
    }
  }
  // 4. sales reps call on companies that buy what theirs makes (two calls each a day)
  for (const f of firms) {
    const reps = f.sites.reduce((n, id) => n + staffAt(ctx, id, 'sales').length, 0);
    if (!reps) continue;
    const out = BUILDINGS[f.kind].output;
    const buyers = out ? firms.filter((x) => x !== f && inputsOf(x).includes(out) && !f.contacts?.includes(x.id)) : advertisersFor(ctx, f, firms);
    for (let i = 0; i < reps * 2 && buyers.length; i++) {
      const k = Math.floor(ctx.rng.next() * buyers.length);
      introduce(ctx, f.id, buyers[k].id);
      buyers.splice(k, 1);
    }
  }
}

/** Media companies' and ad companies' sales reps call on businesses that might advertise. */
function advertisersFor(ctx: Ctx, f: Firm, firms: Firm[]): Firm[] {
  const svc = BUILDINGS[f.kind].service;
  if (svc !== 'tv' && svc !== 'net' && svc !== 'ads') return [];
  return firms.filter((x) => x !== f && !f.contacts?.includes(x.id) && !ctx.govOfFirm.has(x.id) && BUILDINGS[x.kind].service !== undefined);
}
