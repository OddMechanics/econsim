// Relationships, trust and conversations.
//
// Trust grows with time spent together (working with or for each other,
// trading, talking) and faster with people who communicate well; grievances
// pull it down (the user's description of how trust works). When people talk
// they exchange what they know (prices, job openings, places to live), and
// we write down what they say so you can read their conversations.

import { STATS } from './config';
import { nameOf, type Ctx } from './ctx';
import { BUILDINGS, GOOD } from './goods';
import { sharePlace } from './places';
import { GOODS, type ChatLine, type Good, type Person, type Relation } from './types';

export function relation(a: Person, b: Person): Relation {
  let r = a.rel[b.id];
  if (!r) {
    r = { fam: 0, trust: 0.1, bad: 0, last: 0 };
    a.rel[b.id] = r;
  }
  return r;
}

function recomputeTrust(r: Relation, other: Person): void {
  const familiarity = 0.55 * (1 - Math.exp(-r.fam / 30));
  const charm = 0.25 * other.traits.communication;
  r.trust = Math.min(1, Math.max(0, 0.05 + familiarity + charm * Math.min(1, r.fam / 6) - 0.25 * r.bad));
}

export function meet(ctx: Ctx, a: Person, b: Person, hours: number): void {
  const ra = relation(a, b), rb = relation(b, a);
  ra.fam += hours;
  rb.fam += hours;
  ra.last = rb.last = ctx.s.tick;
  recomputeTrust(ra, b);
  recomputeTrust(rb, a);
}

export function grievance(victim: Person, culprit: Person, amount: number): void {
  const r = relation(victim, culprit);
  r.bad += amount;
  recomputeTrust(r, culprit);
}

/** Forget people you haven't seen in a long time (keeps memory bounded). */
export function pruneRelations(p: Person): void {
  const ids = Object.keys(p.rel);
  if (ids.length < 60) return;
  const sorted = ids.map(Number).sort((x, y) => (p.rel[y].fam + p.rel[y].last / 1e5) - (p.rel[x].fam + p.rel[x].last / 1e5));
  for (const id of sorted.slice(50)) delete p.rel[id];
}

function shareBeliefs(ctx: Ctx, speaker: Person, listener: Person): Good | null {
  const trust = relation(listener, speaker).trust;
  let told: Good | null = null;
  for (const g of GOODS) {
    const sb = speaker.prices[g], lb = listener.prices[g];
    if (sb.src === 'guess' || sb.t <= lb.t) continue;
    const w = lb.src === 'guess' ? 0.5 + 0.4 * trust : 0.6 * trust;
    lb.p += w * (sb.p - lb.p);
    lb.t = sb.t;
    lb.src = 'heard';
    if (!told || ctx.rng.chance(0.3)) told = g;
  }
  if (trust > 0.15) {
    if (speaker.knownJobs > listener.knownJobs) listener.knownJobs = speaker.knownJobs;
    if (speaker.knownHomes > listener.knownHomes) listener.knownHomes = speaker.knownHomes;
  }
  return told;
}

// ------------------------------------------------------------- dialogue

function first(p: Person): string {
  return p.name.split(' ')[0];
}

function employerName(ctx: Ctx, p: Person): string | null {
  const c = ctx.cById.get(p.job);
  return c ? nameOf(ctx, c.firm) : null;
}

/** One thing a person might bring up, given their life right now. */
function topicLine(ctx: Ctx, a: Person, b: Person, told: Good | null): string {
  const r = ctx.rng;
  const options: [number, () => string][] = [];
  // politics, for people who care (and more so when things are tense)
  const pw = a.pol.engagement * 2 + a.pol.grievance;
  if (pw > 0.5) {
    const lines = politicsTalk(ctx, a);
    if (lines.length) options.push([pw, () => r.pick(lines)]);
  }
  const job = employerName(ctx, a);
  const c = ctx.cById.get(a.job);
  if (told) {
    const price = a.prices[told].p;
    options.push([2, () => r.pick([
      `${capital(GOOD[told].label)} are going for about ${price.toFixed(2)} now.`,
      `Did you know ${GOOD[told].label} cost ${price.toFixed(2)} these days?`,
      `I paid ${price.toFixed(2)} for ${GOOD[told].label} the other day.`,
    ])]);
  }
  if (job && c) {
    options.push([1.5, () => r.pick([
      `Work at ${job} keeps me busy.`,
      `${job} pays me ${c.wage.toFixed(0)} a shift. Could be worse.`,
      `Another long shift at ${job} tomorrow.`,
      c.unpaid > 0 ? `${job} still hasn't paid me for my last shift!` : `I like the people at ${job}.`,
    ])]);
    if (c.noticeEnd > 0) options.push([3, () => `They let me go at ${job}. I've got two days left.`]);
  } else if (a.firms.length) {
    const f = ctx.fById.get(a.firms[0]);
    if (f) {
      const trend = f.ledger.days.slice(-3).reduce((s, x) => s + x, 0);
      options.push([2, () => trend >= 0 ? r.pick([`Business is good at ${f.name}.`, `${f.name} had a great week.`, `We might hire soon at ${f.name}.`])
        : r.pick([`Business is slow at ${f.name}.`, `I'm worried about ${f.name}, sales are down.`])]);
    }
  } else {
    options.push([1.5, () => r.pick(['I\'m still looking for work.', 'Do you know anyone who\'s hiring?', 'I\'ve been gathering what I can to get by.'])]);
  }
  const home = ctx.bById.get(a.home);
  if (!home) options.push([2, () => r.pick(['I\'ve been sleeping outside. It\'s cold at night.', 'I need to find a place to live.'])]);
  else if ((home.kind === 'apartments' || home.kind === 'tower') && home.units[a.unit]) {
    const rent = home.units[a.unit].rent;
    options.push([1, () => r.pick([`My rent is ${rent.toFixed(1)} a day.`, `I like my apartment. ${rent > 8 ? 'Not cheap though.' : 'And it\'s affordable.'}`])]);
  } else if (home.kind === 'house') options.push([0.8, () => r.pick(['The garden is coming along nicely.', 'Owning a house is a lot of work.'])]);
  else if (home.kind === 'trailer') options.push([0.8, () => r.pick(['The trailer gets so cold at night.', 'One day I\'ll have a real house.', 'Trailer life is cheap, at least.'])]);
  if (home?.kind === 'tower') options.push([0.7, () => r.pick(['You can see the whole city from my balcony.', 'The elevator was broken again today.', 'My building has a gym now.'])]);
  if (a.car >= 0) options.push([0.6, () => r.pick(['Driving to work saves me so much time.', 'My car needs a wash.'])]);
  if ((a.durables.computers ?? 0) > 0 || (a.durables.phone ?? 0) > 0) options.push([0.6, () => r.pick(['I read online that prices are going up.', 'Did you see what people are posting today?', 'I ordered it online, it came the next morning.'])]);
  if (a.gig?.jobs) options.push([0.7, () => r.pick([`I did ${a.gig!.jobs} deliveries this week.`, 'The app takes such a big cut.', 'Gig work pays the rent, barely.'])]);
  if (a.needs.food < 30) options.push([2, () => 'I\'m starving, I haven\'t eaten properly today.']);
  if (a.mood > 0.75) options.push([0.6, () => r.pick(['Life is good lately.', 'What a great day!'])]);
  if (a.mood < 0.35) options.push([0.8, () => r.pick(['Things are hard right now.', 'I don\'t know how I\'m going to pay for everything.'])]);
  // gossip about someone they know
  const known = Object.keys(a.rel).map(Number).filter((id) => id !== b.id && ctx.byId.has(id));
  if (known.length) {
    const o = ctx.byId.get(known[Math.floor(r.next() * known.length)])!;
    const oFirm = o.firms.length ? ctx.fById.get(o.firms[0]) : undefined;
    options.push([0.8, () => oFirm ? `${first(o)} owns ${oFirm.name} now. Who would have thought?` : o.car >= 0 ? `${first(o)} just got a car.` : `Have you seen ${first(o)} lately?`]);
  }
  options.push([0.5, () => r.pick(['Long day.', 'The city is growing so fast.', 'Nice evening, isn\'t it?', 'Did you see the new buildings downtown?'])]);
  let total = 0;
  for (const [wt] of options) total += wt;
  let roll = r.next() * total;
  for (const [wt, fn] of options) {
    roll -= wt;
    if (roll <= 0) return fn();
  }
  return options[0][1]();
}

/** Things someone might say about politics right now: the election, the people in charge, the latest decision, the news. */
function politicsTalk(ctx: Ctx, a: Person): string[] {
  const out: string[] = [];
  const e = ctx.s.elections.find((x) => x.status === 'campaign' || x.status === 'voting');
  const me = { econ: a.pol.econ + a.pol.pEcon, auth: a.pol.auth + a.pol.pAuth };
  if (e && e.candidates.length) {
    const fav = e.candidates.reduce((x, y) => (Math.hypot(y.econ - me.econ, y.auth - me.auth) < Math.hypot(x.econ - me.econ, x.auth - me.auth) ? y : x));
    const name = ctx.byId.get(fav.person)?.name.split(' ')[0];
    if (name) out.push(`I'm voting for ${name}. "${fav.slogan}" — that's what this city needs.`, `Have you heard ${name} speak? Makes a lot of sense.`);
    if (e.status === 'voting') out.push('Did you vote yet? The polls close at eight.');
  }
  for (const g of ctx.s.polities) {
    if (g.status === 'gone' || !g.cells.length) continue;
    const head = ctx.byId.get(g.offices.find((o) => o.kind === 'exec')?.holder ?? -1);
    if (head && head !== a) {
      const d = Math.hypot(head.pol.econ - me.econ, head.pol.auth - me.auth);
      out.push(d < 1 ? `${head.name.split(' ')[0]} is doing a decent job running the city.` : `${head.name.split(' ')[0]} has no idea what ordinary people need.`);
    }
    const law = g.laws.filter((l) => l.passed && ctx.s.tick - l.t < 7 * 1440).slice(-1)[0];
    if (law) out.push(`Did you hear? The council voted to ${law.title.charAt(0).toLowerCase()}${law.title.slice(1)}.`, `"${law.title}" — ${a.pol.econ < 0 ? 'about time.' : 'what a waste.'}`);
    if (g.charter.suspendedUntil > ctx.s.tick) out.push(a.pol.auth > 0.5 ? 'Postponing the election was the right call. We need stability.' : 'They cancelled the election. This is how it starts.');
    break;
  }
  if (a.pol.grievance > 1) out.push('Things can\'t go on like this. Something has to change.', 'People are angry. You can feel it.');
  if (ctx.s.events.some((ev) => ev.kind === 'protest' && ev.end > ctx.s.tick)) out.push(a.pol.grievance > 0.6 ? 'Are you coming to the protest tomorrow?' : 'I hope that protest doesn\'t turn ugly.');
  const ch = ctx.fById.get(a.pol.tv)?.channel;
  if (ch) out.push(`Did you see ${ch.name} last night? ${me.econ * ch.slant > 0 ? 'Finally someone tells it like it is.' : 'So biased.'}`);
  if (a.pol.party >= 0) out.push(`You should come to a ${ctx.partyById.get(a.pol.party)?.name ?? 'party'} meeting sometime.`);
  return out;
}

function reply(ctx: Ctx, b: Person, said: string): string {
  const r = ctx.rng;
  if (said.includes('voting for') || said.includes('running the city') || said.includes('council voted') || said.includes('election')) {
    const agree = ctx.rng.chance(0.5);
    return agree ? r.pick(['I agree.', 'Same here.', 'Exactly what I think.', 'Good.']) : r.pick(['I don\'t know about that.', 'Really? I see it differently.', 'We\'ll have to agree to disagree.', 'Hmm. Not sure.']);
  }
  if (said.includes('hiring') || said.includes('looking for work')) {
    const posting = ctx.s.postings[Math.floor(r.next() * Math.max(1, ctx.s.postings.length))];
    if (posting && b.knownJobs > 0) {
      const site = ctx.bById.get(posting.site);
      return `${nameOf(ctx, posting.firm)} is hiring${site ? ` at their ${BUILDINGS[site.kind].label.toLowerCase()}` : ''}, ${posting.wage.toFixed(0)} a shift.`;
    }
    return 'Try the job board at the square.';
  }
  if (said.includes('cost') || said.includes('going for') || said.includes('paid')) return r.pick(['That much? Wow.', 'Cheaper than I expected.', 'Good to know, thanks.']);
  if (said.includes('starving') || said.includes('sleeping outside')) return r.pick(['That sounds awful. I hope it gets better.', 'You should get some groceries at the store.']);
  if (said.includes('let me go') || said.includes('hasn\'t paid')) return r.pick(['That\'s terrible.', 'You deserve better than that.']);
  if (said.includes('Business is good') || said.includes('great week')) return r.pick(['Congratulations!', 'Good for you.']);
  return r.pick(['Mm-hm.', 'Really?', 'I know what you mean.', 'Ha, true.', 'Same here.', 'Interesting.']);
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function say(ctx: Ctx, p: Person, text: string): ChatLine {
  const line = { t: ctx.s.tick, who: p.id, text };
  p.said.push(line);
  if (p.said.length > 6) p.said.shift();
  p.saying = text;
  p.sayingUntil = ctx.s.tick + 12;
  return line;
}

/** Two people talk for `hours`: they share what they know and say a few things. */
export function converse(ctx: Ctx, a: Person, b: Person, hours: number, where: number): void {
  meet(ctx, a, b, hours);
  const toldA = shareBeliefs(ctx, a, b);
  const toldB = shareBeliefs(ctx, b, a);
  a.needs.social = Math.min(100, a.needs.social + 30 * hours * (0.5 + a.traits.sociability));
  b.needs.social = Math.min(100, b.needs.social + 30 * hours * (0.5 + b.traits.sociability));
  a.needs.fun = Math.min(100, a.needs.fun + 6);
  b.needs.fun = Math.min(100, b.needs.fun + 6);
  const r = relation(a, b);
  const lines: ChatLine[] = [];
  lines.push(say(ctx, a, r.fam < 0.4 ? `Hi, I'm ${first(a)}. Haven't seen you around.` : ctx.rng.pick([`Hey ${first(b)}!`, `${first(b)}, good to see you.`, `Oh hi, ${first(b)}.`])));
  lines.push(say(ctx, b, r.fam < 0.4 ? `Nice to meet you, I'm ${first(b)}.` : ctx.rng.pick(['Hey! How are you?', 'Hi! What\'s new?', 'Oh, hello!'])));
  const t1 = topicLine(ctx, a, b, toldA);
  lines.push(say(ctx, a, t1));
  lines.push(say(ctx, b, reply(ctx, b, t1)));
  if (ctx.rng.chance(0.6)) {
    const t2 = topicLine(ctx, b, a, toldB);
    lines.push(say(ctx, b, t2));
    lines.push(say(ctx, a, reply(ctx, a, t2)));
  }
  // word of mouth: a place one of them liked or hated, or a job going where they work
  if (ctx.rng.chance(0.35)) {
    const [x, y] = ctx.rng.chance(0.5) ? [a, b] : [b, a];
    const tip = sharePlace(ctx, x, y);
    if (tip) {
      lines.push(say(ctx, x, tip));
      lines.push(say(ctx, y, ctx.rng.pick(['Good to know, thanks.', 'Oh really? I\'ll keep that in mind.', 'Huh. I didn\'t know that.'])));
    }
  }
  // a friend who's hungry and broke gets help (money for food), from those who can spare it and care
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (x.needs.food < 30 && x.money < 5 && y.money > 40 && relation(y, x).trust > 0.35 && ctx.rng.chance(0.3 + 0.5 * y.traits.agreeable)) {
      const gift = Math.min(y.money * 0.1, 8);
      y.money -= gift;
      x.money += gift;
      lines.push(say(ctx, y, `Here, take this. Get yourself something to eat.`));
      lines.push(say(ctx, x, 'Thank you. I won\'t forget it.'));
      relation(x, y).fam += 1;
      break;
    }
  }
  ctx.s.conversations.push({ t: ctx.s.tick, a: a.id, b: b.id, where, lines });
  if (ctx.s.conversations.length > STATS.conversationsMax) ctx.s.conversations.splice(0, ctx.s.conversations.length - STATS.conversationsMax);
}

/** An hour of working side by side: trust grows slowly and know-how spreads. */
export function workTogether(ctx: Ctx, a: Person, b: Person): void {
  meet(ctx, a, b, 1);
  shareBeliefs(ctx, a, b);
  a.needs.social = Math.min(100, a.needs.social + 4);
  // colleagues swap tips about lunch places and shops
  if (ctx.rng.chance(0.1)) sharePlace(ctx, b, a);
}
