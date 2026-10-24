// Banks. Anyone with enough capital can open one ("just like real life").
// A bank lends to people and companies it trusts to pay back: founders,
// growing companies, developers, house builders. The loaned money is newly
// created (that's how banks add money to an economy); repayments of the
// principal remove it again, interest is the bank's income. A bank can only
// lend up to a multiple of its own cash (a reserve requirement), and loans
// that go unpaid for a week default.

import { addCash, cashOf, log, nameOf, newId, type Ctx } from './ctx';
import { relation } from './social';
import type { Firm, Loan } from './types';

const RESERVE_MULTIPLE = 8; // loans outstanding may be up to 8x the bank's cash
const BASE_RATE = 0.0012; // per day (~0.12%)

/** Banks in business (a newly founded bank lends from day one, even before its building is finished). */
const bankCache = new WeakMap<object, { t: number; list: Firm[] }>();
export function banks(ctx: Ctx): Firm[] {
  const c = bankCache.get(ctx.s);
  if (c && c.t === ctx.s.tick) return c.list;
  const list = ctx.s.firms.filter((f) => f.kind === 'bank' && !f.closed);
  bankCache.set(ctx.s, { t: ctx.s.tick, list });
  return list;
}

const debtCache = new WeakMap<object, { t: number; n: number; m: Map<number, number> }>();
export function debtOf(ctx: Ctx, id: number): number {
  let c = debtCache.get(ctx.s);
  if (!c || c.t !== ctx.s.tick || c.n !== ctx.s.loans.length) {
    c = { t: ctx.s.tick, n: ctx.s.loans.length, m: new Map() };
    for (const l of ctx.s.loans) c.m.set(l.borrower, (c.m.get(l.borrower) ?? 0) + l.balance);
    debtCache.set(ctx.s, c);
  }
  return c.m.get(id) ?? 0;
}

/** What a borrower earns per day, as a bank would judge it. */
function incomeOf(ctx: Ctx, id: number): number {
  const p = ctx.byId.get(id);
  if (p) {
    // banks lend against a steady income: a job, or a business that makes money
    const c = ctx.cById.get(p.job);
    if (c) return c.wage;
    let biz = 0;
    for (const fid of p.firms) {
      const f = ctx.fById.get(fid);
      const days = f?.ledger.days.slice(-7) ?? [];
      if (days.length) biz += Math.max(0, days.reduce((s, x) => s + x, 0) / days.length) * 0.5;
    }
    return biz + p.hourly * 1.5;
  }
  const f = ctx.fById.get(id);
  if (f) {
    const days = f.ledger.days.slice(-7);
    return days.length ? Math.max(0, days.reduce((s, x) => s + x, 0) / days.length) + 10 : 10;
  }
  return 0;
}

/**
 * Ask the banks in town for a loan. The cheapest bank that agrees lends;
 * returns the amount lent (0 if nobody would).
 */
/**
 * Ask the banks for a loan. A loan secured by a building (`collateral`: a
 * construction loan or mortgage, up to 70% of what the building is worth)
 * doesn't depend on income so much: the bank can take the building.
 */
export function borrow(ctx: Ctx, borrower: number, amount: number, days: number, purpose: string, collateral?: { building: number; value: number }): number {
  if (amount < 5) return 0;
  // a building can secure loans up to 70% of its value in all
  const already = collateral ? ctx.s.loans.reduce((s, l) => s + (l.collateral === collateral.building ? l.balance : 0), 0) : 0;
  const secured = collateral && amount + already <= collateral.value * 0.7;
  const income = incomeOf(ctx, borrower);
  const debt = debtOf(ctx, borrower);
  const person = ctx.byId.get(borrower) ?? ctx.byId.get(ctx.fById.get(borrower)?.owner ?? -1);
  if (ctx.s.loans.some((l) => l.borrower === borrower && l.missed > 0)) return 0;
  let best: Firm | undefined, bestRate = Infinity;
  for (const bank of banks(ctx)) {
    if (bank.id === borrower) continue;
    const lent = ctx.s.loans.filter((l) => l.bank === bank.id).reduce((s, l) => s + l.balance, 0);
    if (lent + amount > lendingCapacity(ctx, bank)) continue;
    // can they carry the payments? (at most ~40% of their income)
    const payment = amount / days + amount * BASE_RATE;
    if (payment + debt / 30 > income * (secured ? 1.5 : 0.4)) continue;
    // bankers lend more cheaply to people they know and trust
    const banker = ctx.byId.get(bank.owner);
    const trust = banker && person ? relation(banker, person).trust : 0.1;
    const rate = (bank.prices.rate ?? BASE_RATE) * (1.4 - trust);
    if (rate < bestRate) { bestRate = rate; best = bank; }
  }
  if (!best) return 0;
  const loan: Loan = { id: newId(ctx), bank: best.id, borrower, principal: amount, balance: amount, rate: bestRate, days, start: ctx.s.tick, missed: 0, purpose, collateral: collateral?.building };
  ctx.s.loans.push(loan);
  addCash(ctx, borrower, amount); // new money
  const f = ctx.fById.get(borrower);
  if (f) f.ledger.revenue -= amount; // a loan isn't income
  else if (ctx.byId.get(borrower)) ctx.byId.get(borrower)!.earned -= amount;
  best.sales.loans = (best.sales.loans ?? 0) + 1;
  log(ctx, 'business', `${best.name} lent ${amount.toFixed(0)} to ${nameOf(ctx, borrower)} (${purpose}).`, { firm: best.id });
  return amount;
}

/** What a bank may have lent out: a multiple of its own money, plus part of its customers' deposits. */
export function lendingCapacity(ctx: Ctx, bank: Firm): number {
  return Math.max(50, bank.cash) * RESERVE_MULTIPLE + depositsOf(ctx, bank.id) * 0.6;
}

const depCache = new WeakMap<object, { t: number; m: Map<number, number> }>();
/** Customers' money held at a bank (people keep their money in their bank account). */
export function depositsOf(ctx: Ctx, bank: number): number {
  let c = depCache.get(ctx.s);
  if (!c || ctx.s.tick - c.t > 60) {
    c = { t: ctx.s.tick, m: new Map() };
    for (const p of ctx.s.people) if (p.bank !== undefined && p.money > 0) c.m.set(p.bank, (c.m.get(p.bank) ?? 0) + p.money);
    depCache.set(ctx.s, c);
  }
  return c.m.get(bank) ?? 0;
}

/**
 * Daily: people without a bank open an account at the one they've heard of
 * most (ads work); people online prefer a bank with online banking (a
 * website). Customers pay a small account fee. Now and then someone
 * switches to a bank they like better.
 */
export function bankingDaily(ctx: Ctx): void {
  const list = banks(ctx);
  if (!list.length) return;
  for (const p of ctx.s.people) {
    const cur = list.find((b) => b.id === p.bank);
    if (cur && !ctx.rng.chance(0.01)) {
      if (cashOf(ctx, p.id) > 30) { addCash(ctx, p.id, -0.03); addCash(ctx, cur.id, 0.03); cur.sales.accounts = (cur.sales.accounts ?? 0) + 1; }
      continue;
    }
    const online = (p.durables.phone ?? 0) > 0 || (p.durables.computers ?? 0) > 0;
    let best: Firm | undefined, bs = -Infinity;
    for (const b of list) {
      const s = (p.pol.aware[b.id] ?? 0) * 3 + (online && b.website ? 0.6 : 0) + ctx.rng.next() * 0.5 - (b.prices.rate ?? BASE_RATE) * 100;
      if (s > bs) { bs = s; best = b; }
    }
    if (best) p.bank = best.id;
  }
}

/** Daily: borrowers pay interest and part of the principal. */
export function loansDaily(ctx: Ctx): void {
  for (const l of ctx.s.loans.slice()) {
    const bank = ctx.fById.get(l.bank);
    const interest = l.balance * l.rate;
    const principal = Math.min(l.balance, l.principal / l.days);
    const due = interest + principal;
    // people pay for food before the bank (they keep a little to live on)
    const have = cashOf(ctx, l.borrower) - (ctx.byId.has(l.borrower) ? 20 : 0);
    if (have >= due) {
      addCash(ctx, l.borrower, -due);
      const f = ctx.fById.get(l.borrower);
      if (f) f.ledger.costs -= principal; // repaying principal isn't a cost either
      if (bank) addCash(ctx, bank.id, interest); // the principal part disappears again
      l.balance -= principal;
      l.missed = 0;
    } else {
      l.missed++;
      if (l.missed >= 7 || !bank || bank.closed) {
        if (bank && !bank.closed) {
          bank.cash -= Math.min(bank.cash, l.balance * 0.2); // the bank takes a hit
          log(ctx, 'business', `${nameOf(ctx, l.borrower)} defaulted on a loan of ${l.principal.toFixed(0)} from ${bank.name}.`, { firm: bank.id });
        }
        l.balance = 0;
      }
    }
    if (l.balance <= 0.01) ctx.s.loans = ctx.s.loans.filter((x) => x !== l);
  }
}
