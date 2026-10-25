// How a government decides things: council sessions, motions and votes,
// decrees, appointments, and changes to its own charter.
//
// Officials are people with their own views and interests. A councillor
// votes for what they believe in and what's good for them (their
// property, their business, their party), and gives the public's opinion
// only some weight, depending on how soon they face voters and how much
// they care. Rulers who don't face elections at all ignore it. A
// government can therefore do things most people don't want. The
// consequences come later, at the ballot box or, if things get really
// bad, in the streets (regime.ts).

import { MINUTES_PER_DAY, POLITICS } from './config';
import { dayStart, log, newId, type Ctx } from './ctx';
import { ageOf, compass, distance, stance } from './ideology';
import { createBuilding, findLot } from './buildings';
import { startConstruction } from './construction';
import { averageRent } from './housing';
import { openAuction } from './estate';
import { crimeRate } from './crime';
import { buildPublicHospital, hasHospital } from './health';
import {
  adminOf, buildCityHall, cellCenter, cellOf, councilSeats, govSite, layOutStreets, pavingCandidates, polityAt, polityOf, rebuildOffices,
  referenceWage, residentsOf, systemLabel, treasury,
} from './government';
import { districtOf, electionHooks, electedOffices, newElection, redistrict, referendumHooks, rulingParty, seat, voters } from './elections';
import { lotsForSale } from './roads';
import type { CivicEvent, ChatLine, Firm, Law, Motion, Office, Person, Polity, Zone } from './types';

const ZONE_LABEL: Record<Zone, string> = { core: 'downtown', urban: 'the inner neighborhoods', suburb: 'the suburbs', industrial: 'the industrial district', rural: 'farmland' };

// ---------------------------------------------------------------- support

/** How much a person supports a motion, from their views and their own interests (-1..1-ish). */
export function support(ctx: Ctx, p: Person, g: Polity, m: Motion): number {
  const v = typeof m.value === 'number' ? m.value : 0;
  const sign = v >= 0 ? 1 : -1;
  const home = ctx.bById.get(p.home);
  const ownsHome = !!home && home.owner === p.id;
  switch (m.kind) {
    case 'layout': {
      // more land for sale: good for those who want to build, bad for those holding land
      const holding = ctx.s.roads.lots.some((l) => l.owner === p.id && l.building < 0) ? -0.3 : 0;
      return stance(ctx, p, 'growth') * 0.8 + 0.2 + holding;
    }
    case 'pave': {
      const ids = String(m.value).split(',').map(Number);
      const mine = ctx.s.roads.lots.some((l) => ids.includes(l.edge) && (l.owner === p.id || (home && l.id === home.lot))) ? 0.5 : 0;
      return stance(ctx, p, 'roads') * 0.8 + mine - (m.cost ?? 0) / Math.max(200, treasury(ctx, g)) * 0.3;
    }
    case 'cityhall': return 0.25 + 0.25 * compass(p).auth - 0.15 * compass(p).econ;
    case 'plaza': case 'park': return 0.2 - 0.2 * compass(p).econ + 0.2 * (p.traits.sociability - 0.5) + (m.kind === 'park' ? 0.1 : 0);
    case 'tax': {
      let x = stance(ctx, p, 'taxes') * sign;
      if (sign > 0 && m.field === 'propertyTax' && (ownsHome || p.owned.length > 1)) x -= 0.4;
      if (sign > 0 && m.field === 'incomeTax' && (ctx.cById.get(p.job)?.wage ?? 0) > referenceWage(ctx) * 1.3) x -= 0.3;
      if (sign > 0 && m.field === 'salesTax' && p.firms.length) x -= 0.3;
      return x;
    }
    case 'welfare': return stance(ctx, p, 'welfare') * sign;
    case 'police': return stance(ctx, p, 'order') * sign;
    case 'crew': return stance(ctx, p, 'roads') * sign * 0.7 - (sign > 0 ? 0.1 : 0);
    case 'clerks': return 0.1 * sign + 0.2 * compass(p).auth * sign - 0.15 * compass(p).econ * sign;
    case 'rentcap': return stance(ctx, p, 'housing') * (v > 0 ? 1 : -1);
    case 'height': return stance(ctx, p, 'growth') * (v > 0 ? -1 : 1) - (v > 0 && ownsHome ? -0.2 : 0);
    case 'minwage': return (stance(ctx, p, 'welfare') * 0.7 - (p.firms.length ? 0.6 : 0)) * (v > 0 ? 1 : -1);
    case 'landprice': return (v < 1 ? -1 : 1) * compass(p).econ * 0.5 - (v < 1 && ctx.s.roads.lots.some((l) => l.owner === p.id && l.building < 0) ? 0.3 : 0);
    case 'immigration': return stance(ctx, p, 'growth') * (m.value === 'open' ? 1 : -1);
    case 'nationalize': return stance(ctx, p, 'ownership') - (p.firms.includes(m.target ?? -1) ? 2 : 0);
    case 'privatize': return -stance(ctx, p, 'ownership') + (p.money > 500 ? 0.2 : 0);
    case 'annex': return stance(ctx, p, 'growth') * 0.6 + 0.15;
    case 'amend': return amendSupport(ctx, p, g, m);
    case 'housing': return stance(ctx, p, 'housing') * 0.8 - 0.1;
    case 'health': {
      // more public money for care: the welfare-minded, the ill, the poor and health workers like it; taxpayers less so
      const rank = { private: 0, subsidized: 1, public: 2 } as const;
      const dir = rank[String(m.value) as keyof typeof rank] - rank[g.policy.healthcare ?? 'subsidized'];
      const role = ctx.cById.get(p.job)?.role;
      const care = (p.ill ? 0.35 : 0) + (p.money < referenceWage(ctx) * 5 ? 0.2 : 0) + (role === 'doctor' || role === 'nurse' ? 0.2 : 0);
      return (stance(ctx, p, 'welfare') * 0.8 - 0.25 * Math.max(0, stance(ctx, p, 'taxes')) + care) * Math.sign(dir);
    }
    case 'hospital': return 0.15 + 0.4 * stance(ctx, p, 'welfare') - 0.1 * compass(p).econ + (p.ill || ageOf(ctx, p) > 60 ? 0.3 : 0) - (m.cost ?? 0) / Math.max(500, treasury(ctx, g)) * 0.4;
  }
  return 0;
}

function amendSupport(ctx: Ctx, p: Person, g: Polity, m: Motion): number {
  const dem = stance(ctx, p, 'democracy');
  const { econ, auth } = compass(p);
  const myParty = p.pol.party;
  const ruling = rulingParty(ctx, g);
  switch (m.field) {
    case 'districts': return Number(m.value) > 0 ? 0.15 + 0.2 * dem - 0.2 * (ruling && myParty === ruling.id ? 1 : 0) : -0.1;
    case 'seats': return Number(m.value) > g.charter.seats ? 0.2 + 0.2 * dem : -0.2;
    case 'veto': return (m.value === 'yes' ? 1 : -1) * (0.5 * auth - 0.3 * dem);
    case 'execBy': return m.value === 'voters' ? 0.3 * dem + 0.2 * auth : m.value === 'council' ? 0.2 - 0.2 * auth : -0.6 * dem;
    case 'method': {
      // small parties want proportional representation, big ones don't
      const share = ruling && myParty === ruling.id ? 1 : 0;
      return (m.value === 'list' ? 1 : -1) * (0.4 - 0.8 * share + 0.1 * dem);
    }
    case 'franchise': {
      const owner = p.owned.length > 0 || p.firms.length > 0;
      return m.value === 'owners' ? (owner ? 0.3 : -0.8) + 0.4 * econ - 0.4 * dem : (owner ? -0.1 : 0.6) + 0.4 * dem;
    }
    case 'suspend': return -0.9 * dem + 0.5 * auth + (holdsOffice(g, p) ? 0.6 : 0) - 0.4;
    case 'restore': return 0.9 * dem - 0.3 * auth + 0.2;
    case 'parties': return m.value === 'single' ? -0.9 * dem + 0.6 * auth + (ruling && myParty === ruling.id ? 0.7 : -1.2) - 0.3 : 0.6 * dem;
    case 'press': return m.value === 'state' ? -0.8 * dem + 0.5 * auth - 0.3 : 0.6 * dem;
    case 'ownership': return (m.value === 'collective' ? 1.2 : m.value === 'mixed' ? 0.6 : -0.8) * stance(ctx, p, 'ownership') - (p.firms.length && m.value !== 'private' ? 1 : 0);
    case 'life': return -1.1 * dem + 0.6 * auth - 0.6 + (g.offices.find((o) => o.kind === 'exec')?.holder === p.id ? 2 : 0);
    case 'term': return 0.1 * dem - 0.1 * Math.abs(Number(m.value) - POLITICS.year * 2) / POLITICS.year;
  }
  return 0;
}

function holdsOffice(g: Polity, p: Person): boolean {
  return g.offices.some((o) => o.holder === p.id);
}

/** What the public thinks of a motion: the average support of a sample of residents (of a district, if given). */
export function publicOpinion(ctx: Ctx, g: Polity, m: Motion, district = -1): number {
  const pool = residentsOf(ctx, g).filter((p) => district < 0 || districtOf(ctx, g, p) === district);
  if (!pool.length) return 0;
  let sum = 0;
  const n = Math.min(40, pool.length);
  for (let k = 0; k < n; k++) sum += Math.max(-1.5, Math.min(1.5, support(ctx, pool[Math.floor(ctx.rng.next() * pool.length)], g, m)));
  return sum / n;
}

/**
 * How an official votes. Their own support counts most. The public's view
 * counts more the sooner they face voters (and the more they care about
 * being re-elected); unelected rulers ignore it. Party colleagues pull them
 * toward the party line.
 */
function officialVote(ctx: Ctx, g: Polity, p: Person, o: Office | undefined, m: Motion, opinion: number, partyLine: number): number {
  let own = support(ctx, p, g, m);
  // an empty treasury forces hands: even those who'd rather not vote to raise money or cut spending
  const broke = treasury(ctx, g) < 60;
  if (broke && ((m.kind === 'tax' && Number(m.value) > 0) || ((m.kind === 'welfare' || m.kind === 'crew' || m.kind === 'police' || m.kind === 'clerks') && Number(m.value) < 0))) own += 0.45 + 0.3 * p.traits.diligence;
  if (broke && (m.kind === 'pave' || m.kind === 'plaza' || m.kind === 'park' || m.kind === 'cityhall' || ((m.kind === 'welfare' || m.kind === 'crew') && Number(m.value) > 0))) own -= 0.6;
  let w = 0;
  if (o && o.termEnd > 0) {
    const daysLeft = (o.termEnd - ctx.s.tick) / MINUTES_PER_DAY;
    w = (daysLeft < POLITICS.year ? 0.6 : 0.3) * (0.4 + 0.6 * p.traits.ambition) * (0.6 + 0.4 * p.traits.agreeable);
  }
  return own + w * opinion + 0.35 * partyLine + ctx.rng.range(-0.15, 0.15);
}

// ---------------------------------------------------------------- motions

/** Ideas for motions, given the city's situation and the proposer's views. */
function ideas(ctx: Ctx, g: Polity, p: Person): Motion[] {
  const out: Motion[] = [];
  const pol = g.policy, ch = g.charter;
  const pop = residentsOf(ctx, g).length;
  const cash = treasury(ctx, g);
  const spend = Object.values(g.fiscal.prevSpend).reduce((s, x) => s + x, 0) + ctx.s.contracts.filter((c) => c.firm === g.firm).reduce((s, c) => s + c.wage, 0);
  const income = Object.values(g.fiscal.prevIncome).reduce((s, x) => s + x, 0);
  const reserveDays = cash / Math.max(1, spend);
  const { econ, auth } = compass(p);
  const ref = referenceWage(ctx);
  const by = p.id;
  const jobless = residentsOf(ctx, g).filter((q) => q.job < 0 && !q.firms.length).length / Math.max(1, pop);

  // land: where people want to build and nothing is for sale
  for (const z of ['core', 'urban', 'suburb', 'industrial', 'rural'] as Zone[]) {
    const demand = ctx.s.landDemand?.[z] ?? 0;
    const supply = lotsForSale(ctx, [z]).filter((l) => g.cells.includes(cellOf(l.x, l.y))).length;
    // new streets only where people actually wanted land and couldn't get it (fill what's there first)
    if (demand > 2.5 && supply < (z === 'core' ? 4 : 8)) {
      const n = Math.min(4, 1 + Math.floor(demand / 10));
      out.push({ kind: 'layout', title: `Lay out ${n} new street${n > 1 ? 's' : ''} in ${ZONE_LABEL[z]}`, by, value: z, target: n });
    }
  }
  // paving
  const pave = pavingCandidates(ctx, g).slice(0, 3);
  if (pave.length && pave[0].score >= 1) {
    let cost = 0;
    const pick = pave.filter((x) => (cost += x.cost) < cash * 0.7);
    if (pick.length) {
      const named = [...new Set(pick.map((x) => x.e.name).filter((n): n is string => !!n))];
      const unnamed = pick.some((x) => !x.e.name);
      const names = unnamed ? [...named, named.length ? 'some side streets' : 'several side streets'] : named;
      out.push({ kind: 'pave', title: `Pave ${names.join(' and ')}`, by, value: pick.map((x) => x.e.id).join(','), cost: pick.reduce((s, x) => s + x.cost, 0) });
    }
  }
  const hall = ctx.bById.get(g.seat);
  if ((!hall || hall.ruined) && pop >= 30 && cash > 350) out.push({ kind: 'cityhall', title: 'Build a city hall', by, cost: 350 });
  if (hall?.built && pop >= 120 && cash > 500 && !ctx.s.buildings.some((b) => b.kind === 'plaza' && b.owner === g.firm)) out.push({ kind: 'plaza', title: 'Build a public plaza downtown', by, cost: 250 });
  const parks = ctx.s.buildings.filter((b) => b.kind === 'park' && b.owner === g.firm).length;
  if (pop >= 160 * (parks + 1) && cash > 400) out.push({ kind: 'park', title: 'Open a public park', by, cost: 150 });
  // money
  if (reserveDays < 6 && spend > income) {
    if (econ < 0) out.push({ kind: 'tax', field: auth > 0 ? 'propertyTax' : 'incomeTax', title: `Raise the ${auth > 0 ? 'property' : 'income'} tax`, by, value: auth > 0 ? 0.004 : 0.01 });
    else {
      out.push({ kind: 'tax', field: 'salesTax', title: 'Raise the sales tax', by, value: 0.01 });
      if (pol.welfare > 0) out.push({ kind: 'welfare', title: 'Cut welfare payments', by, value: -1 });
      if (pol.roadCrew > 1) out.push({ kind: 'crew', title: 'Shrink the road crew', by, value: -1 });
    }
  }
  if (reserveDays > 30 && income > spend) {
    if (econ > 0) {
      const field = pol.incomeTax > 0 ? 'incomeTax' : pol.propertyTax > 0 ? 'propertyTax' : 'salesTax';
      if (pol[field] > 0) out.push({ kind: 'tax', field, title: `Cut the ${field.replace('Tax', '')} tax`, by, value: -(field === 'propertyTax' ? 0.004 : 0.01) });
    } else out.push({ kind: 'welfare', title: 'Raise welfare payments', by, value: 1 });
  }
  if (jobless > 0.2 && econ < -0.2 && reserveDays > 8 && pol.welfare < ref * 0.3) out.push({ kind: 'welfare', title: 'Raise welfare payments', by, value: 1 });
  // a big surplus gets spent one way or another: more public works, or lower taxes
  if (reserveDays > 20 && cash > 600) {
    out.push({ kind: 'crew', title: 'Hire more road workers', by, value: 2 });
    if (econ > 0) {
      for (const field of ['incomeTax', 'propertyTax', 'salesTax'] as const) if (pol[field] > 0) { out.push({ kind: 'tax', field, title: `Cut the ${field.replace('Tax', '')} tax`, by, value: -(field === 'propertyTax' ? 0.004 : 0.01) }); break; }
    }
    if (hall?.built) out.push({ kind: 'clerks', title: 'Hire more city staff', by, value: 1 });
  }
  // order
  const protests = ctx.s.events.filter((ev) => ev.kind === 'protest' && ev.polity === g.id && ctx.s.tick - ev.start < 5 * MINUTES_PER_DAY).length;
  const crimes = crimeRate(g);
  const want = Math.ceil(pop / 60) + protests + (auth > 0.6 ? 1 : 0) + Math.floor(crimes / 4);
  if (pol.police < want && reserveDays > 4) out.push({ kind: 'police', title: 'Hire another police officer', by, value: 1 });
  if (pol.police > want + 1 && auth < 0) out.push({ kind: 'police', title: 'Cut the police force', by, value: -1 });
  const backlog = ctx.s.roads.edges.filter((e) => e.paving && e.built === false).length;
  if (backlog > pol.roadCrew && reserveDays > 6) out.push({ kind: 'crew', title: 'Hire more road workers', by, value: 1 });
  if (!backlog && pol.roadCrew > 2) out.push({ kind: 'crew', title: 'Shrink the road crew', by, value: -1 });
  if (hall?.built && pol.clerks < 1 + Math.floor(pop / 150) && reserveDays > 6) out.push({ kind: 'clerks', title: 'Hire another city clerk', by, value: 1 });
  // housing
  const rent = averageRent(ctx);
  if (rent > ref * 0.35 && pol.rentCap <= 0 && econ < -0.3) out.push({ kind: 'rentcap', title: `Cap rents at ${(rent * 0.9).toFixed(1)} a day`, by, value: Math.round(rent * 9) / 10 });
  if (pol.rentCap > 0 && econ > 0.3) out.push({ kind: 'rentcap', title: 'Abolish rent control', by, value: 0 });
  const tall = ctx.s.buildings.some((b) => b.floors >= 8 && !b.built);
  // height limits protect the neighborhoods; downtown is where towers go (like most real cities' zoning)
  if (tall && pol.maxFloors <= 0 && stance(ctx, p, 'growth') < -0.25) out.push({ kind: 'height', title: 'Limit buildings outside downtown to 6 floors', by, value: 6 });
  if (pol.maxFloors > 0 && stance(ctx, p, 'growth') > 0.25) out.push({ kind: 'height', title: 'Lift the height limit in the neighborhoods', by, value: 0 });
  // healthcare: who pays the doctor, and a public hospital once the city is big enough
  const care = pol.healthcare ?? 'subsidized';
  const sick = residentsOf(ctx, g).filter((q) => q.ill && q.ill.kind !== 'cold').length / Math.max(1, pop);
  if (care !== 'public' && stance(ctx, p, 'welfare') > 0.45 && econ < -0.3) out.push({ kind: 'health', title: 'Make healthcare free, paid by the city', by, value: 'public' });
  else if (care === 'private' && (econ < 0.2 || sick > 0.06)) out.push({ kind: 'health', title: "Pay half of everyone's doctor and hospital bills", by, value: 'subsidized' });
  if (care !== 'private' && econ > 0.5 && (reserveDays < 10 || econ > 0.8)) out.push({ kind: 'health', title: care === 'public' ? 'End free healthcare (patients pay half)' : "Stop paying people's doctor bills", by, value: care === 'public' ? 'subsidized' : 'private' });
  if (care !== 'private' && pop >= 400 && cash > 2500 && !hasHospital(ctx, g)) out.push({ kind: 'hospital', title: 'Build a public hospital', by, cost: 2500 });
  if (pol.minWage < ref * 0.7 && econ < -0.5 && pop > 40) out.push({ kind: 'minwage', title: `Set a minimum wage of ${(ref * 0.75).toFixed(0)} a shift`, by, value: Math.round(ref * 0.75) });
  if (pol.minWage > 0 && econ > 0.6) out.push({ kind: 'minwage', title: 'Abolish the minimum wage', by, value: 0 });
  if (econ < -0.7 && pol.landPrice > 0.4) out.push({ kind: 'landprice', title: 'Sell public land cheaply to homesteaders', by, value: 0.3 });
  if (econ > 0.7 && pol.landPrice < 1.2) out.push({ kind: 'landprice', title: 'Sell public land at full market value', by, value: 1.2 });
  // calls to limit newcomers come when the city is crowded or jobs are scarce
  if (auth > 0.9 && stance(ctx, p, 'growth') < -0.2 && pol.immigration === 'open' && (pop > 250 || jobless > 0.25)) out.push({ kind: 'immigration', title: 'Limit newcomers', by, value: 'limited' });
  if (pol.immigration !== 'open' && stance(ctx, p, 'growth') > 0.2) out.push({ kind: 'immigration', title: 'Welcome newcomers again', by, value: 'open' });
  // ownership
  if (ch.ownership !== 'private' || stance(ctx, p, 'ownership') > 0.7) {
    const big = ctx.s.firms.filter((f) => !f.closed && f.gov === undefined && !ctx.govOfFirm.has(f.id))
      .map((f) => ({ f, n: ctx.s.contracts.filter((c) => c.firm === f.id).length })).sort((a, b) => b.n - a.n)[0];
    if (ch.ownership === 'private' && stance(ctx, p, 'ownership') > 0.7) out.push({ kind: 'amend', field: 'ownership', title: 'Amend the charter: allow public ownership of key industries', by, value: 'mixed' });
    else if (big && big.n >= 6) out.push({ kind: 'nationalize', title: `Nationalize ${big.f.name}`, by, target: big.f.id });
  }
  const stateFirm = ctx.s.firms.find((f) => f.gov === g.id && !ctx.govOfFirm.has(f.id) && !f.closed);
  if (stateFirm && stance(ctx, p, 'ownership') < -0.4) out.push({ kind: 'privatize', title: `Sell ${stateFirm.name} to private owners`, by, target: stateFirm.id });
  // annexing where the city has grown past its limits
  const annex = annexCandidates(ctx, g);
  if (annex.length >= 3) out.push({ kind: 'annex', title: `Annex ${annex.length} blocks beyond the city limits`, by, value: annex.join(',') });
  // the charter itself
  out.push(...amendments(ctx, g, p, pop));
  return out;
}

function amendments(ctx: Ctx, g: Polity, p: Person, pop: number): Motion[] {
  const out: Motion[] = [];
  const ch = g.charter;
  const { econ, auth } = compass(p);
  const dem = stance(ctx, p, 'democracy');
  const by = p.id;
  const exec = g.offices.find((o) => o.kind === 'exec');
  const isExec = exec?.holder === p.id;
  if (pop >= 150 && ch.districts === 0 && ch.councilBy === 'voters' && ch.method !== 'list') out.push({ kind: 'amend', field: 'districts', title: 'Elect the council by districts', by, value: Math.min(ch.seats, 7) });
  const seatsWanted = Math.min(15, 5 + 2 * Math.floor(pop / 250));
  if (seatsWanted > ch.seats && ch.councilBy !== 'all') out.push({ kind: 'amend', field: 'seats', title: `Enlarge the council to ${seatsWanted} seats`, by, value: seatsWanted });
  if (isExec && !ch.veto && auth > 0.5) out.push({ kind: 'amend', field: 'veto', title: `Give the ${ch.execTitle.toLowerCase()} a veto`, by, value: 'yes' });
  if (!isExec && ch.veto && auth < -0.3) out.push({ kind: 'amend', field: 'veto', title: `Take away the ${ch.execTitle.toLowerCase()}'s veto`, by, value: 'no' });
  const myParty = p.pol.party >= 0 ? p.pol.party : -2;
  const ruling = rulingParty(ctx, g);
  if (ch.method !== 'list' && ch.parties === 'free' && ruling && ruling.id !== myParty && ctx.s.parties.filter((x) => x.polity === g.id && !x.banned).length >= 3) out.push({ kind: 'amend', field: 'method', title: 'Switch to proportional representation (party lists)', by, value: 'list' });
  if (ch.franchise === 'residents' && econ > 1.1 && (p.owned.length || p.firms.length)) out.push({ kind: 'amend', field: 'franchise', title: 'Restrict the vote to property owners', by, value: 'owners' });
  if (ch.franchise === 'owners' && dem > 0.3) out.push({ kind: 'amend', field: 'franchise', title: 'Give every resident the vote', by, value: 'residents' });
  // backsliding: an ambitious, authoritarian executive with friends on the council
  if (isExec && ch.suspendedUntil <= ctx.s.tick && auth > 0.9 && p.traits.ambition > 0.65 && dem < -0.2 && electedOffices(g).length) {
    out.push({ kind: 'amend', field: 'suspend', title: `Postpone the next election by ${POLITICS.year * 2} days ("for stability")`, by, value: POLITICS.year * 2 });
  }
  if (isExec && ch.parties === 'free' && auth > 1.2 && ch.suspendedUntil > ctx.s.tick) out.push({ kind: 'amend', field: 'parties', title: 'Make the ruling party the only legal party', by, value: 'single' });
  if (isExec && ch.press === 'free' && auth > 1.1 && ctx.s.firms.some((f) => f.channel || f.site)) out.push({ kind: 'amend', field: 'press', title: 'Place TV and the Net under state supervision', by, value: 'state' });
  if (isExec && ch.execTerm > 0 && auth > 1.4 && p.traits.ambition > 0.75 && ch.suspendedUntil > ctx.s.tick) out.push({ kind: 'amend', field: 'life', title: `Make the ${ch.execTitle.toLowerCase()} ruler for life`, by, value: 'life' });
  // and the way back
  if (dem > 0.5 && (ch.suspendedUntil > ctx.s.tick || ch.parties !== 'free' || ch.press !== 'free')) out.push({ kind: 'amend', field: 'restore', title: 'Restore free elections, parties and press', by, value: 'restore' });
  if (ch.ownership === 'mixed' && stance(ctx, p, 'ownership') > 1) out.push({ kind: 'amend', field: 'ownership', title: 'Collectivize the economy', by, value: 'collective' });
  if (ch.ownership !== 'private' && stance(ctx, p, 'ownership') < -0.6) out.push({ kind: 'amend', field: 'ownership', title: 'Return the economy to private hands', by, value: 'private' });
  if (ch.execBy === 'council' && auth > 0.6 && dem > -0.2) out.push({ kind: 'amend', field: 'execBy', title: 'Let the voters elect the mayor directly', by, value: 'voters' });
  return out;
}

function annexCandidates(ctx: Ctx, g: Polity): number[] {
  const inside = new Set(g.cells);
  const out = new Set<number>();
  for (const b of ctx.s.buildings) {
    if (b.ruined) continue;
    const c = cellOf(b.x, b.y);
    if (inside.has(c) || polityAt(ctx, b.x, b.y)) continue;
    // next to the city?
    const [x, y] = cellCenter(c);
    if (g.cells.some((k) => { const [kx, ky] = cellCenter(k); return Math.hypot(kx - x, ky - y) < POLITICS.cell * 2.1; })) out.add(c);
  }
  return [...out];
}

// ---------------------------------------------------------------- applying

function setCharter(ctx: Ctx, g: Polity, m: Motion): void {
  const ch = g.charter;
  switch (m.field) {
    case 'districts': ch.districts = Number(m.value); rebuildOffices(ctx, g); redistrict(ctx, g); fillVacancies(ctx, g, true); break;
    case 'seats': ch.seats = Number(m.value); rebuildOffices(ctx, g); fillVacancies(ctx, g, true); break;
    case 'veto': ch.veto = m.value === 'yes'; break;
    case 'execBy': ch.execBy = m.value as typeof ch.execBy; rebuildOffices(ctx, g); break;
    case 'method': ch.method = m.value as typeof ch.method; break;
    case 'franchise': ch.franchise = m.value as typeof ch.franchise; break;
    case 'suspend': ch.suspendedUntil = ctx.s.tick + Number(m.value) * MINUTES_PER_DAY; break;
    case 'restore': ch.suspendedUntil = 0; ch.parties = 'free'; ch.press = 'free'; for (const pt of ctx.s.parties) if (pt.polity === g.id) pt.banned = false; break;
    case 'parties': {
      ch.parties = m.value as typeof ch.parties;
      const ruling = rulingParty(ctx, g);
      if (ch.parties === 'single') for (const pt of ctx.s.parties) if (pt.polity === g.id && pt !== ruling) pt.banned = true;
      break;
    }
    case 'press': ch.press = m.value as typeof ch.press; break;
    case 'ownership': ch.ownership = m.value as typeof ch.ownership; if (ch.ownership === 'collective') g.policy.nationalizeAbove = 8; if (ch.ownership === 'private') g.policy.nationalizeAbove = 0; break;
    case 'life': ch.execTerm = 0; ch.execBy = 'successor'; for (const o of g.offices) if (o.kind === 'exec') o.termEnd = -1; break;
    case 'term': ch.councilTerm = Number(m.value); break;
  }
  g.label = systemLabel(ctx, g);
}

/** Put a motion that passed into effect. */
export function enact(ctx: Ctx, g: Polity, m: Motion): void {
  const pol = g.policy;
  const v = m.value;
  switch (m.kind) {
    case 'layout': {
      const made = layOutStreets(ctx, g, v as Zone, Number(m.target ?? 2));
      if (!made) log(ctx, 'politics', `${g.short}'s surveyors found no room for new streets in ${ZONE_LABEL[v as Zone]}.`);
      if (ctx.s.landDemand) ctx.s.landDemand[v as Zone] = 0;
      break;
    }
    case 'pave': for (const id of String(v).split(',').map(Number)) { const e = ctx.edgeById.get(id); if (e && e.built === false) e.paving = true; } break;
    case 'cityhall': buildCityHall(ctx, g); break;
    case 'plaza': case 'park': {
      const f = adminOf(ctx, g);
      if (!f) break;
      const lot = findLot(ctx, m.kind, { x: g.cx ?? ctx.s.center.x, y: g.cy ?? ctx.s.center.y }, f.id);
      if (!lot) break;
      const b = createBuilding(ctx, m.kind, lot, f.id, 1, false, -1);
      startConstruction(ctx, f.id, b);
      if (b.builder < 0) b.builder = f.id;
      f.sites.push(b.id);
      break;
    }
    case 'tax': {
      const field = m.field as 'propertyTax' | 'salesTax' | 'incomeTax';
      pol[field] = Math.max(0, Math.round((pol[field] + Number(v)) * 1000) / 1000);
      break;
    }
    case 'welfare': pol.welfare = Math.max(0, pol.welfare + Number(v)); break;
    case 'police': pol.police = Math.max(0, pol.police + Number(v)); break;
    case 'crew': pol.roadCrew = Math.max(0, pol.roadCrew + Number(v)); break;
    case 'clerks': pol.clerks = Math.max(0, pol.clerks + Number(v)); break;
    case 'rentcap': pol.rentCap = Number(v); break;
    case 'height': pol.maxFloors = Number(v); break;
    case 'minwage': pol.minWage = Number(v); break;
    case 'landprice': pol.landPrice = Number(v); break;
    case 'immigration': pol.immigration = v as typeof pol.immigration; break;
    case 'nationalize': { const f = ctx.fById.get(m.target ?? -1); if (f) nationalize(ctx, g, f); break; }
    case 'privatize': { const f = ctx.fById.get(m.target ?? -1); if (f) openAuction(ctx, { item: 'firm', target: f.id, seller: g.firm, reserve: Math.max(50, f.cash), reason: `privatization by ${g.short}`, hours: 30 }); break; }
    case 'annex': {
      const add = String(v).split(',').map(Number).filter((c) => !g.cells.includes(c));
      g.cells.push(...add);
      for (const l of ctx.s.roads.lots) if (l.owner === -3 && add.includes(cellOf(l.x, l.y))) l.owner = g.firm;
      break;
    }
    case 'amend': setCharter(ctx, g, m); break;
    case 'health': pol.healthcare = v as typeof pol.healthcare; break;
    case 'hospital': buildPublicHospital(ctx, g); break;
  }
}

/** The state takes over a company: the owner may get some compensation, depending on who's in charge. */
export function nationalize(ctx: Ctx, g: Polity, f: Firm): void {
  const owner = ctx.byId.get(f.owner);
  const radical = g.charter.ownership === 'collective';
  const paid = radical ? 0 : Math.min(treasury(ctx, g) * 0.3, f.cash + 200);
  if (owner && paid > 0) { ctx.fById.get(g.firm)!.cash -= paid; owner.money += paid; }
  if (owner) owner.firms = owner.firms.filter((id) => id !== f.id);
  f.owner = g.id;
  f.gov = g.id;
  // a manager runs it now: the old owner if they cooperate, otherwise a senior employee
  const senior = ctx.s.contracts.filter((c) => c.firm === f.id).sort((a, b) => a.start - b.start)[0];
  f.manager = owner && owner.pol.econ < 0.5 ? owner.id : senior?.person;
  log(ctx, 'politics', `${g.short} nationalized ${f.name}${owner ? ` from ${owner.name}` : ''}${paid > 0 ? ` (compensation ${paid.toFixed(0)})` : ' without compensation'}.`, { firm: f.id, who: owner?.id });
  if (owner) { owner.pol.grievance = Math.min(2, owner.pol.grievance + 0.8); owner.pol.rec[g.id] = Math.max(0, (owner.pol.rec[g.id] ?? 0.6) - 0.5); }
}

// ----------------------------------------------------------------- sessions

/** Who decides: the council members present (or every voter present at a town meeting). */
function deciders(ctx: Ctx, g: Polity, ev: CivicEvent | undefined): { p: Person; o?: Office }[] {
  const ch = g.charter;
  if (ch.councilBy === 'all') {
    const present = ev ? ev.attendees.map((id) => ctx.byId.get(id)).filter((p): p is Person => !!p) : [];
    const vs = new Set(voters(ctx, g).map((p) => p.id));
    return present.filter((p) => vs.has(p.id)).map((p) => ({ p }));
  }
  return councilSeats(g).map((o) => ({ p: ctx.byId.get(o.holder)!, o })).filter((x) => x.p);
}

/** Who rules alone (decrees instead of votes). */
function autocrat(ctx: Ctx, g: Polity): Person | undefined {
  const ch = g.charter;
  if (!['force', 'successor', 'owner'].includes(ch.execBy) && ch.councilBy !== 'none') return undefined;
  const exec = g.offices.find((o) => o.kind === 'exec');
  return ctx.byId.get(exec?.holder ?? -1);
}

/** Daily: schedule the weekly session; prepare the agenda; census and appointments. */
export function councilDaily(ctx: Ctx): void {
  for (const g of ctx.s.polities) {
    if (g.status === 'gone') continue;
    fillVacancies(ctx, g, false);
    if (g.nextSession < ctx.s.tick) {
      const days = g.nextSession < 0 ? 1 : POLITICS.sessionEveryDays;
      g.nextSession = dayStart(ctx.s.tick + days * MINUTES_PER_DAY) + POLITICS.sessionHour * 60;
      const site = govSite(ctx, g);
      const plaza = ctx.s.buildings.find((b) => b.kind === 'plaza' && b.built && b.owner === g.firm);
      const place = site?.kind === 'cityhall' ? site : plaza ?? site;
      if (place) {
        const ev: CivicEvent = {
          id: newId(ctx), kind: 'session', polity: g.id, host: g.offices.find((o) => o.kind === 'exec')?.holder ?? -1, speakers: [],
          place: place.id, start: g.nextSession, end: g.nextSession + 100, title: `${g.charter.councilBy === 'all' ? 'Town meeting' : `${g.charter.councilTitle} session`} (${g.short})`,
          attendees: [], lines: [],
        };
        ctx.s.events.push(ev);
      }
    }
    // a census every political year; districts redrawn by whoever has that power
    if (ctx.s.tick - g.lastCensus > POLITICS.year * MINUTES_PER_DAY) {
      g.lastCensus = ctx.s.tick;
      if (g.charter.districts > 0) {
        const drawer = g.charter.redistrict === 'commission' ? undefined
          : g.charter.redistrict === 'executive' ? ctx.byId.get(g.offices.find((o) => o.kind === 'exec')?.holder ?? -1)
            : ctx.byId.get(rulingParty(ctx, g)?.leader ?? -1);
        redistrict(ctx, g, drawer);
      }
    }
  }
  ctx.s.events = ctx.s.events.filter((e) => e.end > ctx.s.tick - 3 * MINUTES_PER_DAY);
}

/** Hourly: sessions that have ended decide their agenda; autocrats issue decrees now and then. */
export function councilHourly(ctx: Ctx): void {
  for (const ev of ctx.s.events) {
    if (ev.kind !== 'session' || ev.end > ctx.s.tick || ev.data?.done) continue;
    ev.data = { done: 1 };
    const g = ctx.gById.get(ev.polity);
    if (g && g.status !== 'gone') runSession(ctx, g, ev);
  }
}

const line = (ctx: Ctx, who: number, text: string): ChatLine => ({ t: ctx.s.tick, who, text });

function runSession(ctx: Ctx, g: Polity, ev: CivicEvent): void {
  const ruler = autocrat(ctx, g);
  const members = deciders(ctx, g, ev);
  const presentIds = new Set(ev.attendees);
  // everyone with a seat may propose one thing they care about most
  const proposers = ruler ? [{ p: ruler, o: g.offices.find((o) => o.kind === 'exec') }] : [...members, ...g.offices.filter((o) => o.kind === 'exec').map((o) => ({ p: ctx.byId.get(o.holder)!, o })).filter((x) => x.p)];
  const agenda: Motion[] = [];
  for (const { p } of proposers) {
    const opts = ideas(ctx, g, p).filter((m) => !agenda.some((a) => a.kind === m.kind && a.field === m.field && (a.kind !== 'layout' || a.value === m.value)));
    // what they'd like most, plus how pressing it is (land people are clamoring for, a treasury about to run dry)
    const best = opts.map((m) => ({ m, s: support(ctx, p, g, m) + urgency(ctx, g, m) + ctx.rng.range(0, 0.2) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s > 0.2) agenda.push(best.m);
    if (agenda.length >= 7) break;
  }
  g.agenda = agenda;
  if (!agenda.length) { ev.lines.push(line(ctx, ev.host, 'Nothing on the agenda tonight. Meeting adjourned.')); return; }
  const exec = g.offices.find((o) => o.kind === 'exec');
  const execP = ctx.byId.get(exec?.holder ?? -1);
  for (const m of agenda) {
    const proposer = ctx.byId.get(m.by);
    const opinion = publicOpinion(ctx, g, m);
    if (ruler) {
      // a decree: the ruler does what they want (they may still glance at the mood)
      const u = support(ctx, ruler, g, m) + 0.1 * opinion;
      ev.lines.push(line(ctx, ruler.id, u > 0 ? `By decree: ${m.title.toLowerCase()}.` : `I considered "${m.title}" and rejected it.`));
      record(ctx, g, m, u > 0 ? 1 : 0, u > 0 ? 0 : 1, 0, u > 0, 'decree');
      if (u > 0) { enact(ctx, g, m); reactions(ctx, g, m); }
      continue;
    }
    ev.lines.push(line(ctx, m.by, `I move that we ${m.title.charAt(0).toLowerCase()}${m.title.slice(1)}.`));
    // party line: what most party colleagues on the council think
    let yes = 0, no = 0, abstain = 0;
    const votes: { p: Person; y: boolean }[] = [];
    for (const { p, o } of members) {
      if (g.charter.councilBy !== 'all' && !presentIds.has(p.id) && ctx.rng.chance(0.5)) { abstain++; continue; }
      const mates = members.filter((x) => x.p.pol.party >= 0 && x.p.pol.party === p.pol.party && x.p !== p);
      const partyLine = mates.length ? mates.reduce((s, x) => s + Math.sign(support(ctx, x.p, g, m)), 0) / mates.length : 0;
      const u = officialVote(ctx, g, p, o, m, opinion, partyLine);
      if (Math.abs(u) < 0.05) { abstain++; continue; }
      votes.push({ p, y: u > 0 });
      if (u > 0) yes++; else no++;
    }
    // a speech for and against from those who care most
    const pro = votes.filter((x) => x.y).sort((a, b) => b.p.traits.communication - a.p.traits.communication)[0];
    const con = votes.filter((x) => !x.y).sort((a, b) => b.p.traits.communication - a.p.traits.communication)[0];
    if (pro && pro.p.id !== m.by) ev.lines.push(line(ctx, pro.p.id, argue(m, true)));
    if (con) ev.lines.push(line(ctx, con.p.id, argue(m, false)));
    const needed = threshold(g, m);
    let passed = yes > (yes + no) * needed && yes > 0;
    let how = g.charter.councilBy === 'all' ? 'town meeting vote' : 'council vote';
    if (passed && g.charter.veto && execP && m.kind !== 'amend') {
      const u = support(ctx, execP, g, m);
      if (u < -0.3) {
        if (yes >= (yes + no) * (2 / 3)) how = 'veto overridden';
        else { passed = false; how = 'vetoed'; ev.lines.push(line(ctx, execP.id, `I veto this. ${argue(m, false)}`)); }
      }
    }
    // amendments may need the voters' approval
    if (passed && m.kind === 'amend' && g.charter.amend === 'referendum' && m.field !== 'restore') {
      const r = newElection(ctx, g, 'referendum', dayStart(ctx.s.tick + 7 * MINUTES_PER_DAY) + POLITICS.pollsOpen * 60, [], m);
      ev.lines.push(line(ctx, ev.host, `The amendment carried ${yes}–${no}; it goes to the voters on day ${Math.floor(r.day / MINUTES_PER_DAY) + 1}.`));
      record(ctx, g, m, yes, no, abstain, false, 'sent to referendum');
      continue;
    }
    ev.lines.push(line(ctx, ev.host, `The motion ${passed ? 'carries' : 'fails'}, ${yes} to ${no}${abstain ? `, ${abstain} absent or abstaining` : ''}${how === 'vetoed' ? ' (vetoed)' : ''}.`));
    record(ctx, g, m, yes, no, abstain, passed, how);
    if (passed) { enact(ctx, g, m); reactions(ctx, g, m); }
    if (proposer) proposer.pol.engagement = Math.min(1, proposer.pol.engagement + 0.02);
  }
}

/** How pressing a motion is (for deciding what to bring up, not how to vote). */
function urgency(ctx: Ctx, g: Polity, m: Motion): number {
  if (m.kind === 'layout') return Math.min(1.2, (ctx.s.landDemand?.[m.value as Zone] ?? 0) / 15);
  if (m.kind === 'tax' && Number(m.value) > 0) return treasury(ctx, g) < 100 ? 0.8 : 0;
  if (m.kind === 'pave') return 0.2;
  if (m.kind === 'police' && Number(m.value) > 0) return Math.min(1, crimeRate(g) / 15);
  return 0;
}

/** Share of votes needed. Amendments need more, unless the charter says otherwise. */
function threshold(g: Polity, m: Motion): number {
  if (m.kind !== 'amend') return 0.5;
  return g.charter.amend === 'majority' || g.charter.amend === 'executive' ? 0.5 : 2 / 3;
}

function record(ctx: Ctx, g: Polity, m: Motion, yes: number, no: number, abstain: number, passed: boolean, how: string): void {
  const law: Law = { t: ctx.s.tick, title: m.title, kind: m.kind, by: m.by, yes, no, abstain, passed, how };
  g.laws.push(law);
  if (g.laws.length > 120) g.laws.shift();
  if (passed || m.kind === 'amend') log(ctx, 'law', `${g.short}: "${m.title}" ${passed ? 'passed' : how === 'sent to referendum' ? 'goes to a referendum' : 'failed'} (${how}${how === 'decree' ? '' : `, ${yes}–${no}`}).`, { who: m.by });
}

/** People react to what passed: those strongly against grow aggrieved and trust the government less. */
function reactions(ctx: Ctx, g: Polity, m: Motion): void {
  for (const p of residentsOf(ctx, g)) {
    if (!ctx.rng.chance(0.5)) continue;
    const s = support(ctx, p, g, m);
    const rec = p.pol.rec[g.id] ?? 0.6;
    if (s < -0.4) {
      p.pol.grievance = Math.min(3, p.pol.grievance + 0.04 * -s * (0.5 + p.pol.engagement) * (m.kind === 'amend' ? 2 : 1));
      p.pol.rec[g.id] = Math.max(0, rec - 0.01 * -s * (m.kind === 'amend' ? 3 : 1));
    } else if (s > 0.4) p.pol.rec[g.id] = Math.min(1, rec + 0.005);
  }
}

/** A line of debate for or against a motion. */
function argue(m: Motion, pro: boolean): string {
  const P: Record<string, [string, string]> = {
    layout: ['People need land to build on. Growth pays for everything else.', 'More lots means more sprawl, and nobody asked the neighbors.'],
    pave: ['Mud in the street is bad for business and bad for everyone.', 'We can\'t afford it right now.'],
    cityhall: ['A city needs a proper seat of government.', 'A monument to ourselves, paid by the taxpayer.'],
    plaza: ['Every real city has a heart. Let\'s build one.', 'Pretty, but not a priority.'],
    park: ['Families need somewhere green.', 'Land is worth more built on.'],
    tax: ['The books have to balance.', 'People are taxed enough already.'],
    welfare: ['Nobody in this city should go hungry.', 'We can\'t pay people not to work.'],
    police: ['People want to feel safe.', 'More police won\'t fix what\'s really wrong.'],
    crew: ['The streets won\'t pave themselves.', 'The crew is big enough.'],
    clerks: ['City hall needs staff to work.', 'Bureaucracy grows, it never shrinks.'],
    rentcap: ['Rents are crushing working people.', 'Rent control kills new housing.'],
    height: ['We have to protect the character of our neighborhoods.', 'We need homes, not empty sky.'],
    minwage: ['A day\'s work deserves a living wage.', 'This will cost jobs.'],
    landprice: ['Public land belongs in the hands of the people who\'ll use it.', 'Selling cheap is giving away the public\'s wealth.'],
    immigration: ['We should decide who comes here.', 'This city was built by newcomers.'],
    nationalize: ['What the whole city depends on, the whole city should own.', 'This is theft, plain and simple.'],
    privatize: ['Government has no business running a company.', 'They\'ll sell it to their friends for nothing.'],
    annex: ['They use our roads; they should be part of the city.', 'Nobody out there asked to be annexed.'],
    amend: ['Our charter has to change with the times.', 'This is an attack on the rules that protect us all.'],
  };
  const pair = P[m.kind] ?? ['I support this.', 'I oppose this.'];
  return pro ? pair[0] : pair[1];
}

// ------------------------------------------------------------- appointments

/**
 * Fill empty offices: executives chosen by the council, appointed councils,
 * the police chief and the clerk (named by the executive), company-town
 * bosses, and interim replacements for those who died or left.
 */
export function fillVacancies(ctx: Ctx, g: Polity, all: boolean): void {
  const ch = g.charter;
  const exec = g.offices.find((o) => o.kind === 'exec');
  const execP = ctx.byId.get(exec?.holder ?? -1);
  const residents = residentsOf(ctx, g);
  for (const o of g.offices) {
    const holder = ctx.byId.get(o.holder);
    if (holder && (all || livesIn(ctx, g, holder))) continue;
    o.holder = -1; // died or moved away
    let pick: Person | undefined;
    if (o.kind === 'exec') {
      if (ch.execBy === 'owner') pick = ctx.byId.get(ctx.fById.get(g.company ?? -1)?.owner ?? -1);
      else if (ch.execBy === 'party') pick = ctx.byId.get(rulingParty(ctx, g)?.leader ?? -1);
      else if (ch.execBy === 'council' || ch.execBy === 'voters' || ch.execBy === 'successor' || ch.execBy === 'force') {
        // the council (or the old ruler's circle) picks one of its own, or a qualified manager for council–manager systems
        const council = councilSeats(g).map((x) => ctx.byId.get(x.holder)).filter((p): p is Person => !!p);
        const pool = ch.execBy === 'council' ? residents.filter((p) => p.edu >= 15) : council.length ? council : residents;
        pick = best(pool, (p) => p.pol.engagement + p.traits.communication + (ch.execBy === 'council' ? (p.edu - 14) * 0.1 : 0)
          + council.reduce((s, c) => s + (c.rel[p.id]?.trust ?? 0) - 0.3 * distance({ econ: c.pol.econ, auth: c.pol.auth }, { econ: p.pol.econ, auth: p.pol.auth }), 0) / Math.max(1, council.length));
      }
      if (pick) log(ctx, 'politics', `${pick.name} became ${o.title} of ${g.short}${ch.execBy === 'voters' ? ' (interim, chosen by the council)' : ''}.`, { who: pick.id });
    } else if (o.kind === 'council') {
      // appointed councils are the executive's friends; elected seats get an interim appointee
      const appointer = execP ?? ctx.byId.get(councilSeats(g).find((x) => x.holder >= 0)?.holder ?? -1);
      const taken = new Set(g.offices.map((x) => x.holder));
      pick = best(residents.filter((p) => !taken.has(p.id)), (p) => p.pol.engagement + (appointer ? (appointer.rel[p.id]?.trust ?? 0) * 2 - distance({ econ: appointer.pol.econ, auth: appointer.pol.auth }, { econ: p.pol.econ, auth: p.pol.auth }) * 0.5 : 0));
    } else if (o.kind === 'chief') {
      const officers = ctx.s.contracts.filter((c) => c.firm === g.firm && c.role === 'officer').map((c) => ctx.byId.get(c.person)).filter((p): p is Person => !!p);
      if (!officers.length) continue;
      pick = best(officers, (p) => (p.skills.officer ?? 0) / 50 + (execP ? (execP.rel[p.id]?.trust ?? 0) * 2 - distance({ econ: execP.pol.econ, auth: execP.pol.auth }, { econ: p.pol.econ, auth: p.pol.auth }) * 0.3 : 0));
    } else if (o.kind === 'clerk') {
      const civil = ctx.s.contracts.filter((c) => c.firm === g.firm && c.role === 'civil').map((c) => ctx.byId.get(c.person)).filter((p): p is Person => !!p);
      pick = best(civil.length ? civil : residents.filter((p) => p.edu >= 14), (p) => p.edu / 10 + p.traits.diligence);
    }
    if (pick && !g.offices.some((x) => x.holder === pick!.id && x !== o)) seat(ctx, g, o, pick, pick.pol.party);
  }
}

function livesIn(ctx: Ctx, g: Polity, p: Person): boolean {
  return polityOf(ctx, p) === g || ctx.s.tick - p.arrived < MINUTES_PER_DAY;
}

function best<T>(xs: T[], score: (x: T) => number): T | undefined {
  let b: T | undefined, bs = -Infinity;
  for (const x of xs) { const s = score(x); if (s > bs) { bs = s; b = x; } }
  return b;
}

// referendums and elections need these
referendumHooks.apply = (ctx, g, m) => { enact(ctx, g, m); reactions(ctx, g, m); record(ctx, g, m, 0, 0, 0, true, 'referendum'); };
electionHooks.onCounted = (ctx, g) => { if (g.charter.execBy === 'council') { const o = g.offices.find((x) => x.kind === 'exec'); if (o && !councilSeats(g).length) fillVacancies(ctx, g, false); } };

