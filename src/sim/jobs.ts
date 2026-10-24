// The labor market. Firms post openings; people apply (at the square's job
// board, online, or after hearing about it); after a few hours the firm picks
// the best applicant. New hires start with a short probation; after that,
// both sides have to give notice. Wages are fixed per contract (negotiation
// comes later, a user decision).

import { JOBS, MINUTES_PER_DAY, WAGES } from './config';
import { addCash, cashOf, controllerOf, log, nameOf, newId, type Ctx } from './ctx';
import { bookSpend, polityAt, withholdIncomeTax } from './government';
import { shock } from './ideology';
import { BUILDINGS, ROLE } from './goods';
import { grievance, meet, relation } from './social';
import { borrow } from './finance';
import type { Contract, Firm, Person, Posting, Role } from './types';

export function contractOf(ctx: Ctx, p: Person): Contract | undefined {
  return ctx.cById.get(p.job);
}

export function staffAt(ctx: Ctx, site: number, role?: Role): Contract[] {
  const list = contractsBySite(ctx).get(site);
  if (!list) return [];
  return role === undefined ? list.slice() : list.filter((c) => c.role === role);
}

/** Does anyone work at this site? */
export function hasStaff(ctx: Ctx, site: number): boolean {
  return (contractsBySite(ctx).get(site)?.length ?? 0) > 0;
}

/**
 * Contracts by site. Rebuilt when a contract is added or removed (the array
 * grows or is replaced) and at least once a minute (for in-place changes).
 */
const bySiteCache = new WeakMap<object, { arr: Contract[]; n: number; t: number; m: Map<number, Contract[]> }>();
function contractsBySite(ctx: Ctx): Map<number, Contract[]> {
  const arr = ctx.s.contracts;
  const c = bySiteCache.get(ctx.s);
  if (c && c.arr === arr && c.n === arr.length && c.t === ctx.s.tick) return c.m;
  const m = new Map<number, Contract[]>();
  for (const k of arr) { const l = m.get(k.site); if (l) l.push(k); else m.set(k.site, [k]); }
  bySiteCache.set(ctx.s, { arr, n: arr.length, t: ctx.s.tick, m });
  return m;
}

/**
 * What people in a role are typically paid per shift right now. With few
 * contracts in that role, it's the going rate for work in general scaled by
 * how roles usually compare (a manager earns about 2.2x a factory worker, a
 * waiter about 0.75x; see ROLE.pay).
 */
export function marketWage(ctx: Ctx, role: Role): number {
  let sum = 0, n = 0, all = 0, units = 0;
  for (const c of ctx.s.contracts) {
    if (c.role === role) { sum += c.wage; n++; }
    all += c.wage;
    units += ROLE[c.role].pay;
  }
  const general = units > 0 ? (all / units) * ROLE[role].pay : WAGES.reference * ROLE[role].pay;
  if (n >= 3) return sum / n;
  return n ? (sum + general * (3 - n)) / 3 : general;
}

export function postJob(ctx: Ctx, f: Firm, site: number, role: Role, wage: number, openings = 1): Posting {
  const existing = ctx.s.postings.find((p) => p.site === site && p.role === role);
  if (existing) { existing.openings = Math.max(existing.openings ?? 1, openings); return existing; }
  const post: Posting = { id: newId(ctx), firm: f.id, site, role, wage, t: ctx.s.tick, applicants: [], openings };
  ctx.s.postings.push(post);
  return post;
}

export function applyFor(ctx: Ctx, p: Person, postingId: number): boolean {
  const post = ctx.s.postings.find((x) => x.id === postingId);
  if (!post || post.applicants.includes(p.id)) return false;
  const f = ctx.fById.get(post.firm);
  if (!f || f.owner === p.id) return false;
  if (p.edu < ROLE[post.role].edu - 1) return false;
  post.applicants.push(p.id);
  return true;
}

export function hire(ctx: Ctx, post: Posting, p: Person): Contract {
  const old = ctx.cById.get(p.job);
  if (old) endContract(ctx, old, 'switched jobs');
  const c: Contract = {
    id: newId(ctx), firm: post.firm, person: p.id, site: post.site, role: post.role, wage: post.wage,
    start: ctx.s.tick, probationEnd: ctx.s.tick + JOBS.probationDays * MINUTES_PER_DAY, noticeEnd: -1, lastShiftDay: -1, unpaid: 0,
  };
  ctx.s.contracts.push(c);
  ctx.cById.set(c.id, c);
  p.job = c.id;
  // one opening filled; the posting stays up while there are more
  post.openings = (post.openings ?? 1) - 1;
  post.applicants = post.applicants.filter((id) => id !== p.id);
  if (post.openings <= 0) ctx.s.postings = ctx.s.postings.filter((x) => x !== post);
  ctx.s.counters.hires++;
  const f = ctx.fById.get(post.firm);
  const owner = ctx.byId.get(f?.owner ?? -1);
  if (owner) meet(ctx, owner, p, 0.3);
  const site = ctx.bById.get(post.site);
  log(ctx, 'job', `${p.name} was hired by ${f?.name ?? 'a company'} as ${ROLE[post.role].label}${site ? ` at the ${BUILDINGS[site.kind].label.toLowerCase()}` : ''} for ${c.wage.toFixed(0)} a shift.`, { who: p.id, firm: f?.id, bid: site?.id });
  return c;
}

export function endContract(ctx: Ctx, c: Contract, reason: string): void {
  ctx.s.contracts = ctx.s.contracts.filter((x) => x !== c);
  ctx.cById.delete(c.id);
  const p = ctx.byId.get(c.person);
  if (p && p.job === c.id) p.job = -1;
  // losing a job changes how people see welfare (until they're working again)
  if (p && reason && !reason.startsWith('quit') && !reason.includes('switched')) shock(p, 'welfare', 0.8);
  if (reason) log(ctx, 'job', `${p?.name ?? 'Someone'} ${reason} (${nameOf(ctx, c.firm)}).`, { who: p?.id, firm: c.firm });
}

/** The firm lets someone go: at once during probation, otherwise after notice. */
export function layOff(ctx: Ctx, c: Contract): void {
  if (c.noticeEnd > 0) return;
  ctx.s.counters.layoffs++;
  if (ctx.s.tick < c.probationEnd) {
    endContract(ctx, c, 'was let go during probation');
    return;
  }
  c.noticeEnd = ctx.s.tick + JOBS.noticeDays * MINUTES_PER_DAY;
  const p = ctx.byId.get(c.person);
  log(ctx, 'job', `${nameOf(ctx, c.firm)} gave ${p?.name ?? 'a worker'} notice (${JOBS.noticeDays} days).`, { who: p?.id, firm: c.firm });
}

/** A worker resigns: at once during probation or when unpaid, otherwise with notice. */
export function quit(ctx: Ctx, c: Contract, why: string): void {
  if (c.noticeEnd > 0) return;
  ctx.s.counters.quits++;
  if (ctx.s.tick < c.probationEnd || c.unpaid >= 2) {
    endContract(ctx, c, `quit (${why})`);
    return;
  }
  c.noticeEnd = ctx.s.tick + JOBS.noticeDays * MINUTES_PER_DAY;
  const p = ctx.byId.get(c.person);
  log(ctx, 'job', `${p?.name ?? 'A worker'} handed in their notice at ${nameOf(ctx, c.firm)} (${why}).`, { who: p?.id, firm: c.firm });
}

/** Pay for a (part of a) shift. Unpaid work hurts trust; two unpaid shifts and they walk. */
export function payShift(ctx: Ctx, c: Contract, fraction: number): void {
  const p = ctx.byId.get(c.person);
  if (!p) return;
  const due = c.wage * fraction;
  // short on cash: a doing-alright firm takes a short loan to make payroll
  if (cashOf(ctx, c.firm) < due && !ctx.govOfFirm.has(c.firm)) borrow(ctx, c.firm, due * 6, 30, 'payroll');
  const paid = Math.min(due, Math.max(0, cashOf(ctx, c.firm)));
  addCash(ctx, c.firm, -paid);
  addCash(ctx, p.id, paid);
  // the government at the workplace takes its income tax out of the pay
  withholdIncomeTax(ctx, ctx.bById.get(c.site), p, paid);
  const g = ctx.govOfFirm.get(c.firm);
  if (g) bookSpend(ctx, g, ROLE[c.role].label + ' wages', paid);
  p.hourly = 0.85 * p.hourly + 0.15 * (paid / Math.max(1, 8 * fraction));
  if (paid < due * 0.95) {
    c.unpaid++;
    const owner = ctx.byId.get(ctx.fById.get(c.firm)?.owner ?? -1);
    if (owner) grievance(p, owner, 1);
    if (c.unpaid >= 2) quit(ctx, c, 'not being paid');
  } else c.unpaid = 0;
}

/** Hourly: firms pick among applicants once a posting has been up long enough. */
export function processApplications(ctx: Ctx): void {
  const hired = new Set<number>();
  for (const post of ctx.s.postings.slice()) {
    if (ctx.s.tick - post.t < JOBS.postingMinHours * 60 || !post.applicants.length) continue;
    const f = ctx.fById.get(post.firm);
    if (!f || f.closed) { ctx.s.postings = ctx.s.postings.filter((x) => x !== post); continue; }
    const owner = controllerOf(ctx, f);
    // the best applicants, as many as there are openings
    for (let k = (post.openings ?? 1); k > 0; k--) {
      let best: Person | undefined, bestScore = -Infinity;
      for (const id of post.applicants) {
        const a = ctx.byId.get(id);
        if (!a || hired.has(a.id) || a.job >= 0 && ctx.cById.get(a.job)?.firm === f.id) continue;
        // experience in the role, schooling beyond what's needed, how well the owner knows them, a bit of luck
        const score = Math.min(1, (a.skills[post.role] ?? 0) / 300) + (owner ? relation(owner, a).trust : 0) + ctx.rng.next() * 0.4 + a.traits.communication * 0.2
          + Math.max(0, a.edu - ROLE[post.role].edu) * 0.04 + a.traits.diligence * 0.15;
        if (score > bestScore) { bestScore = score; best = a; }
      }
      if (!best) { post.applicants = []; break; }
      hire(ctx, post, best);
      hired.add(best.id);
      // they've taken a job: their other applications are withdrawn
      for (const other of ctx.s.postings) other.applicants = other.applicants.filter((id) => id !== best!.id);
      if (!ctx.s.postings.includes(post)) break;
    }
  }
}

/** Daily: notices run out; people reconsider their jobs. */
export function jobsDaily(ctx: Ctx): void {
  for (const c of ctx.s.contracts.slice()) {
    if (c.noticeEnd > 0 && ctx.s.tick >= c.noticeEnd) {
      endContract(ctx, c, 'left after the notice period');
      continue;
    }
    const f = ctx.fById.get(c.firm);
    const site = ctx.bById.get(c.site);
    if (!f || f.closed || !site || site.ruined) endContract(ctx, c, 'lost their job when the business closed');
  }
}

/** Wage a firm offers new hires for a role (keeps up with the market, never below a legal minimum wage). */
export function offerWage(ctx: Ctx, f: Firm, role: Role): number {
  const market = marketWage(ctx, role);
  const own = f.wages[role] ?? market;
  const owner = controllerOf(ctx, f);
  const subsistence = 3.5 * (owner?.prices.groceries.p ?? 1.5);
  const site = ctx.bById.get(f.sites[0]);
  const g = site ? polityAt(ctx, site.x, site.y) : undefined;
  return Math.max(subsistence, g?.policy.minWage ?? 0, 0.5 * own + 0.5 * market);
}
