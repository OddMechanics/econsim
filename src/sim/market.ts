// The wholesale market: companies' standing offers (asks) and orders (bids).
//
// It isn't a place. Companies list what they make at their own sites and
// order inputs to be delivered to theirs, by phone, through sales reps and
// on business websites. A company can only deal with companies it knows of
// (see contacts.ts): its owner's acquaintances, firms whose ads it has seen,
// ones its sales reps called on or a search engine turned up, past partners.
// Outside suppliers (the rest of the world) are always reachable: they sell
// anything, delivered by truck from the highway, at a markup; outside buyers
// take some of what the city makes. People don't trade here: they buy in
// shops and online, and earn money from jobs and businesses.

import { FOOD_SPOIL_PER_DAY, MARKET, MINUTES_PER_DAY, OUTSIDE } from './config';
import { addCash, cashOf, log, newId, type Ctx } from './ctx';
import { GOOD } from './goods';
import { createShipment } from './logistics';
import { introduce, knows } from './contacts';
import { meet } from './social';
import { GATE, GOODS, type Good, type Order, type Person } from './types';

export function bestAsk(ctx: Ctx, good: Good, exclude = -1): Order | undefined {
  let best: Order | undefined;
  for (const o of ctx.s.market.orders) {
    if (o.side !== 'ask' || o.good !== good || o.qty <= 0 || o.who === exclude) continue;
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

export function bestBid(ctx: Ctx, good: Good, exclude = -1): Order | undefined {
  let best: Order | undefined;
  for (const o of ctx.s.market.orders) {
    if (o.side !== 'bid' || o.good !== good || o.qty <= 0 || o.who === exclude) continue;
    if (!best || o.price > best.price) best = o;
  }
  return best;
}

export function offered(ctx: Ctx, good: Good, maxPrice = Infinity, exclude = -1): number {
  let q = 0;
  for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.good === good && o.price <= maxPrice && o.who !== exclude && o.who !== OUTSIDE.id) q += o.qty;
  return q;
}

export function wanted(ctx: Ctx, good: Good, exclude = -1): number {
  let q = 0;
  for (const o of ctx.s.market.orders) if (o.side === 'bid' && o.good === good && o.who !== exclude) q += o.qty;
  return q;
}

/** The delivered price of a good from outside suppliers today. */
export function importPrice(ctx: Ctx, good: Good): number {
  for (const o of ctx.s.market.orders) if (o.side === 'ask' && o.who === OUTSIDE.id && o.good === good) return o.price;
  return OUTSIDE.prices[good] * OUTSIDE.importMarkup;
}

/** Reference price for valuing wealth: last trade, else the import price. */
export function refPrice(ctx: Ctx, g: Good): number {
  const last = ctx.s.market.last[g];
  if (last > 0) return last;
  return OUTSIDE.prices[g] ?? GOOD[g].laborGuess * 2;
}

function recordTrade(ctx: Ctx, good: Good, qty: number, price: number, buyer: number, seller: number): void {
  const m = ctx.s.market;
  const local = buyer !== OUTSIDE.id && seller !== OUTSIDE.id;
  if (m.last[good] === 0 && local) log(ctx, 'market', `First local sale of ${GOOD[good].label}: ${qty.toFixed(0)} at ${price.toFixed(2)} each.`);
  m.last[good] = price;
  m.day[good].q += qty;
  m.day[good].v += qty * price;
  m.trades.push({ t: ctx.s.tick, good, qty, price, buyer, seller });
  if (m.trades.length > MARKET.tradeMemory) m.trades.splice(0, m.trades.length - MARKET.tradeMemory);
  ctx.s.counters.trades++;
  if (buyer === OUTSIDE.id) ctx.s.counters.exports = (ctx.s.counters.exports ?? 0) + 1;
  if (seller === OUTSIDE.id) ctx.s.counters.imports = (ctx.s.counters.imports ?? 0) + 1;
  for (const id of [buyer, seller]) {
    const p = ctx.byId.get(ctx.fById.get(id)?.owner ?? -1) ?? ctx.byId.get(ctx.fById.get(id)?.manager ?? -1);
    if (p) p.prices[good] = { p: price, t: ctx.s.tick, src: 'traded' };
  }
  // doing business: the two companies now know each other (and their bosses a little)
  if (local) {
    introduce(ctx, buyer, seller);
    const b = ctx.byId.get(ctx.fById.get(buyer)?.owner ?? -1), s = ctx.byId.get(ctx.fById.get(seller)?.owner ?? -1);
    if (b && s && b !== s) meet(ctx, b, s, 0.03);
  }
}

/**
 * Get traded goods from where they are to where the buyer wants them. Goods
 * from outside come on an outside supplier's truck; exports are picked up by
 * the outside buyer's truck; local goods wait for a carrier (see logistics.ts).
 */
function settle(ctx: Ctx, good: Good, qty: number, fromSite: number, toSite: number, buyer: number, seller: number): void {
  const goods = {} as Record<Good, number>;
  for (const g of GOODS) goods[g] = 0;
  goods[good] = qty;
  if (buyer === OUTSIDE.id) {
    createShipment(ctx, OUTSIDE.id, fromSite, GATE, goods, OUTSIDE.id);
    return;
  }
  if (seller === OUTSIDE.id) {
    if (toSite < 0) return;
    createShipment(ctx, buyer, GATE, toSite, goods, OUTSIDE.id);
    return;
  }
  if (fromSite === toSite) { const b = ctx.bById.get(toSite); if (b) b.store[good] += qty; return; }
  createShipment(ctx, buyer, fromSite, toSite, goods);
}

/**
 * A company puts goods on offer at one of its sites. They first go to the
 * standing orders of buyers it knows that pay at least the asking price (at
 * the buyer's price); the rest wait. Goods must already have been taken out
 * of the site's store. Returns the quantity sold right away.
 */
export function listAsk(ctx: Ctx, seller: number, good: Good, qty: number, price: number, floor: number, site: number): number {
  const m = ctx.s.market;
  let left = qty, sold = 0;
  const bids = m.orders
    .filter((o) => o.side === 'bid' && o.good === good && o.qty > 0 && o.price >= price && o.who !== seller && knows(ctx, o.who, seller))
    .sort((a, b) => b.price - a.price);
  for (const bid of bids) {
    if (left <= 0) break;
    const q = Math.min(left, bid.qty);
    bid.qty -= q;
    left -= q;
    sold += q;
    addCash(ctx, seller, q * bid.price);
    if (good === 'cars' && ctx.byId.has(bid.who)) carHooks.onBought(ctx, ctx.byId.get(bid.who)!, seller);
    else settle(ctx, good, q, site, bid.site, bid.who, seller);
    recordTrade(ctx, good, q, bid.price, bid.who, seller);
  }
  if (left > 0) {
    const mine = m.orders.find((o) => o.side === 'ask' && o.who === seller && o.site === site && o.good === good);
    if (mine) {
      mine.qty += left;
      mine.price = price;
      mine.floor = floor;
      mine.lastReprice = ctx.s.tick;
    } else {
      m.orders.push({ id: newId(ctx), side: 'ask', who: seller, site, good, qty: left, price, floor, t: ctx.s.tick, lastReprice: ctx.s.tick });
    }
  }
  m.orders = m.orders.filter((o) => o.qty > 0);
  return sold;
}

/**
 * A company (or government) buys up to `qty` at or below `max` from the
 * cheapest suppliers it knows of, delivered to its site `dest`.
 */
export function buyNow(ctx: Ctx, buyer: number, good: Good, qty: number, max: number, dest: number): number {
  const m = ctx.s.market;
  const asks = m.orders
    .filter((o) => o.side === 'ask' && o.good === good && o.qty > 0 && o.price <= max && o.who !== buyer && knows(ctx, buyer, o.who))
    .sort((a, b) => a.price - b.price);
  let got = 0;
  for (const a of asks) {
    if (got >= qty) break;
    const affordable = Math.floor(cashOf(ctx, buyer) / a.price + 1e-9);
    const q = Math.min(qty - got, a.qty, affordable);
    if (q <= 0) break;
    a.qty -= q;
    got += q;
    addCash(ctx, buyer, -q * a.price);
    addCash(ctx, a.who, q * a.price);
    settle(ctx, good, q, a.site, dest, buyer, a.who);
    recordTrade(ctx, good, q, a.price, buyer, a.who);
  }
  m.orders = m.orders.filter((o) => o.qty > 0);
  return got;
}

/** A person bought a car (from a dealer's stock, or ordered one): it's delivered to their home. */
export const carHooks: { onBought: (ctx: Ctx, p: Person, seller: number) => void } = { onBought: () => {} };

/** Leave a standing order; the money is set aside until it's filled or expires. */
export function placeBid(ctx: Ctx, buyer: number, good: Good, qty: number, price: number, dest: number): void {
  const m = ctx.s.market;
  qty = Math.min(qty, Math.floor(cashOf(ctx, buyer) / price + 1e-9));
  if (qty <= 0 || price <= 0) return;
  const existing = m.orders.find((o) => o.side === 'bid' && o.good === good && o.who === buyer && o.site === dest);
  if (existing) {
    addCash(ctx, buyer, existing.qty * existing.price);
    existing.qty = 0;
  }
  addCash(ctx, buyer, -qty * price);
  m.orders.push({ id: newId(ctx), side: 'bid', who: buyer, site: dest, good, qty, price, floor: 0, t: ctx.s.tick, lastReprice: ctx.s.tick });
  m.orders = m.orders.filter((o) => o.qty > 0);
}

export function hasBid(ctx: Ctx, buyer: number, good: Good): boolean {
  return ctx.s.market.orders.some((o) => o.side === 'bid' && o.who === buyer && o.good === good);
}

/** Cancel a seller's offer and return the goods (to `into`). */
export function withdrawAsks(ctx: Ctx, seller: number, good: Good, site: number, into: Record<Good, number>): number {
  let q = 0;
  for (const o of ctx.s.market.orders) {
    if (o.side === 'ask' && o.who === seller && o.good === good && o.site === site) { q += o.qty; o.qty = 0; }
  }
  into[good] += q;
  ctx.s.market.orders = ctx.s.market.orders.filter((o) => o.qty > 0);
  return q;
}

interface Board { ask: number; traded: number; bids: number; supply: number; topBid: number }
/** The state of the wholesale market this minute: what the trade press and business sites report (shared by everyone who reads them). */
const boards = new WeakMap<object, { t: number; n: number; b: Record<Good, Board> }>();
function board(ctx: Ctx): Record<Good, Board> {
  const m = ctx.s.market;
  const c = boards.get(ctx.s);
  if (c && c.t === ctx.s.tick && c.n === m.orders.length) return c.b;
  const t = ctx.s.tick;
  const b = {} as Record<Good, Board>;
  for (const g of GOODS) b[g] = { ask: Infinity, traded: 0, bids: 0, supply: 0, topBid: 0 };
  for (const tr of m.trades) if (tr.t > t - 2 * MINUTES_PER_DAY && tr.seller !== OUTSIDE.id) b[tr.good].traded += tr.qty;
  const bidsBy = new Map<Good, { p: number; q: number }[]>();
  for (const o of m.orders) {
    const x = b[o.good];
    if (o.side === 'bid') {
      if (o.who === OUTSIDE.id) continue;
      x.bids += o.qty;
      const arr = bidsBy.get(o.good);
      if (arr) arr.push({ p: o.price, q: o.qty }); else bidsBy.set(o.good, [{ p: o.price, q: o.qty }]);
    } else {
      if (o.who !== OUTSIDE.id) x.supply += o.qty;
      if (o.qty > 0) x.ask = Math.min(x.ask, o.price);
    }
  }
  // demand from local buyers that has to be imported counts too (what local makers could sell instead)
  for (const tr of m.trades) if (tr.t > t - 2 * MINUTES_PER_DAY && tr.seller === OUTSIDE.id) b[tr.good].traded += tr.qty * 0.8;
  // what buyers typically offer: the quantity-weighted median bid (one desperate bidder doesn't set the market)
  for (const [g, arr] of bidsBy) {
    arr.sort((a, c) => a.p - c.p);
    const total = arr.reduce((s2, x) => s2 + x.q, 0);
    let acc = 0;
    for (const x of arr) { acc += x.q; if (acc >= total / 2) { b[g].topBid = x.p; break; } }
  }
  boards.set(ctx.s, { t, n: m.orders.length, b });
  return b;
}

/**
 * What a person learns about wholesale prices and demand: business owners
 * and office staff from their work (suppliers' quotes, the trade press),
 * others from business news online.
 */
export function learnPrices(ctx: Ctx, p: Person, src: 'seen' | 'online'): void {
  const m = ctx.s.market;
  const t = ctx.s.tick;
  const b = board(ctx);
  for (const g of GOODS) {
    const x = b[g];
    const belief = p.prices[g];
    if (x.ask < Infinity) {
      belief.p = x.ask;
      belief.t = t;
      belief.src = src;
    } else if (m.last[g] > 0 && belief.t < t - MINUTES_PER_DAY) {
      belief.p = 0.5 * belief.p + 0.5 * m.last[g];
      belief.t = t;
      belief.src = src;
    }
    // demand they can see, per day: recent trades plus waiting orders (spread over a week)
    p.demandSeen[g] = x.traded / 2 + x.bids / 7;
    p.supplySeen[g] = x.supply;
    p.bidSeen[g] = x.topBid;
  }
}

/**
 * Daily: outside suppliers renew their offers (delivered prices drift a
 * little) and outside buyers their orders for the city's exports.
 */
export function outsideTrade(ctx: Ctx): void {
  const m = ctx.s.market;
  for (const o of m.orders) if (o.who === OUTSIDE.id && o.side === 'bid') o.qty = 0;
  m.orders = m.orders.filter((o) => o.who !== OUTSIDE.id);
  const scale = 1 + ctx.s.people.length / 300;
  for (const g of GOODS) {
    const world = OUTSIDE.prices[g] * (0.92 + 0.16 * ctx.rng.next());
    const made = g === 'tools' || g === 'furniture' || g === 'clothes' || g === 'computers' || g === 'cars' || g === 'steel' || g === 'glass';
    const buy = Math.round((OUTSIDE.buy[g] ?? 0) * (made ? scale : Math.sqrt(scale)));
    if (buy > 0) {
      const bid: Order = { id: newId(ctx), side: 'bid', who: OUTSIDE.id, site: GATE, good: g, qty: buy, price: world * OUTSIDE.exportShare, floor: 0, t: ctx.s.tick, lastReprice: ctx.s.tick };
      m.orders.push(bid);
      fillFromAsks(ctx, bid);
    }
    const sell = world * OUTSIDE.importMarkup;
    m.orders.push({ id: newId(ctx), side: 'ask', who: OUTSIDE.id, site: GATE, good: g, qty: OUTSIDE.supply, price: sell, floor: sell, t: ctx.s.tick, lastReprice: ctx.s.tick });
  }
}

/** A standing order is filled from offers already waiting (cheapest first, at the offer's price). */
function fillFromAsks(ctx: Ctx, bid: Order): void {
  const asks = ctx.s.market.orders
    .filter((o) => o.side === 'ask' && o.good === bid.good && o.qty > 0 && o.price <= bid.price && o.who !== bid.who && o.who !== OUTSIDE.id && knows(ctx, bid.who, o.who))
    .sort((a, b) => a.price - b.price);
  for (const a of asks) {
    if (bid.qty <= 0) break;
    const q = Math.min(bid.qty, a.qty);
    a.qty -= q;
    bid.qty -= q;
    // outside buyers pay on delivery terms like anyone: the money comes into the city now
    addCash(ctx, a.who, q * a.price);
    settle(ctx, bid.good, q, a.site, bid.site, bid.who, a.who);
    recordTrade(ctx, bid.good, q, a.price, bid.who, a.who);
  }
  ctx.s.market.orders = ctx.s.market.orders.filter((o) => o.qty > 0);
}

/** Hourly: standing orders expire after a while (the money set aside goes back). */
export function marketHourly(ctx: Ctx): void {
  const m = ctx.s.market;
  const t = ctx.s.tick;
  for (const o of m.orders) {
    if (o.who === OUTSIDE.id || o.side !== 'bid') continue;
    if (t - o.t >= MARKET.bidLifetimeHours * 60) {
      addCash(ctx, o.who, o.qty * o.price);
      o.qty = 0;
    }
  }
  m.orders = m.orders.filter((o) => o.qty > 0);
}

export function marketNewDay(ctx: Ctx): void {
  for (const g of GOODS) ctx.s.market.day[g] = { q: 0, v: 0 };
}

/** Food goes bad slowly wherever it is, so overproducing it has a cost. */
export function spoilFood(ctx: Ctx): void {
  const keep = 1 - FOOD_SPOIL_PER_DAY;
  const foods: Good[] = ['crops', 'groceries'];
  for (const g of foods) {
    for (const p of ctx.s.people) { p.inv[g] *= keep; p.pantry[g] *= keep; }
    for (const b of ctx.s.buildings) b.store[g] *= keep;
    for (const sh of ctx.s.shipments) sh.goods[g] *= keep;
  }
  for (const o of ctx.s.market.orders) {
    if (o.side === 'ask' && o.who !== OUTSIDE.id && foods.includes(o.good)) o.qty = Math.floor(o.qty * keep + ctx.rng.next());
  }
  ctx.s.market.orders = ctx.s.market.orders.filter((o) => o.qty > 0);
}
