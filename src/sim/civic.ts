// Public events people go to: campaign speeches and rallies, TV debates
// between candidates, council sessions, protests. This file schedules the
// campaign ones and writes what speakers say. Who attends is decided by each
// person (ai.ts); the session and protest logic is in council.ts and
// regime.ts.

import { MINUTES_PER_DAY } from './config';
import { dayStart, hourOf, log, newId, type Ctx } from './ctx';
import { compass, distance, expose, stance } from './ideology';
import { govSite } from './government';
import type { Candidate, ChatLine, CivicEvent, Election, Issue, Person } from './types';

/** Where a speech can be given: a plaza or park, else the city hall steps (or its building site). */
function venue(ctx: Ctx, polityId: number): number {
  const g = ctx.gById.get(polityId);
  const plaza = ctx.s.buildings.filter((b) => (b.kind === 'plaza' || b.kind === 'park') && b.built && !b.ruined);
  if (plaza.length) return plaza[Math.floor(ctx.rng.next() * plaza.length)].id;
  return (g ? govSite(ctx, g)?.id : undefined) ?? -1;
}

/** Daily during campaigns: candidates schedule speeches and rallies; a TV station sets up a debate. */
export function campaignEventsDaily(ctx: Ctx): void {
  for (const e of ctx.s.elections) {
    if (e.status !== 'campaign') continue;
    const daysLeft = (e.day - ctx.s.tick) / MINUTES_PER_DAY;
    for (const c of e.candidates) {
      const p = ctx.byId.get(c.person);
      if (!p || c.withdrawn) continue;
      // outgoing, well-funded candidates speak often; a rally needs money for the stage and flyers
      if (!ctx.rng.chance(0.15 + 0.35 * p.traits.communication + (c.funds > 40 ? 0.1 : 0))) continue;
      if (ctx.s.events.some((ev) => ev.host === p.id && ev.end > ctx.s.tick)) continue;
      const rally = c.funds > 60 && ctx.rng.chance(0.4);
      if (rally) { c.funds -= 25; c.spent += 25; }
      const start = dayStart(ctx.s.tick + MINUTES_PER_DAY) + (17 + Math.floor(ctx.rng.next() * 2)) * 60 + 30;
      const ev: CivicEvent = {
        id: newId(ctx), kind: rally ? 'rally' : 'speech', polity: e.polity, host: p.id, speakers: [p.id], place: venue(ctx, e.polity),
        start, end: start + (rally ? 90 : 50), title: `${rally ? 'Rally' : 'Campaign speech'}: ${p.name}`, attendees: [], lines: [], election: e.id,
      };
      ctx.s.events.push(ev);
    }
    // a debate a couple of days before election day, on a TV channel if there is one
    const execCands = e.candidates.filter((c) => !c.withdrawn && ctx.gById.get(e.polity)?.offices.find((o) => o.id === c.office)?.kind === 'exec');
    const debaters = (execCands.length >= 2 ? execCands : e.candidates.filter((c) => !c.withdrawn)).slice(0, 4);
    if (daysLeft < 3.5 && daysLeft > 1 && debaters.length >= 2 && !ctx.s.events.some((ev) => ev.kind === 'debate' && ev.election === e.id)) {
      const channel = ctx.s.firms.filter((f) => f.channel && !f.closed).sort((a, b) => b.channel!.viewers - a.channel!.viewers)[0];
      const studio = channel ? channel.sites.map((id) => ctx.bById.get(id)).find((b) => b?.kind === 'studio' && b.built) : undefined;
      const start = dayStart(ctx.s.tick + MINUTES_PER_DAY) + 20 * 60;
      const ev: CivicEvent = {
        id: newId(ctx), kind: 'debate', polity: e.polity, host: -1, speakers: debaters.map((c) => c.person),
        place: studio?.id ?? venue(ctx, e.polity), start, end: start + 60, title: `Debate: ${debaters.map((c) => ctx.byId.get(c.person)?.name).join(' vs ')}`,
        attendees: [], lines: [], election: e.id, channel: studio ? channel!.id : undefined,
      };
      ctx.s.events.push(ev);
      log(ctx, 'politics', `${ev.title} — ${studio ? `live on ${channel!.channel!.name}` : 'in public'} tomorrow at 8pm.`);
    }
  }
}

const ISSUE_TALK: Record<Issue, [string, string]> = {
  taxes: ['We will invest in this city: schools, roads, a safety net. Everyone pays their fair share.', 'Your money belongs in your pocket. We will cut taxes.'],
  welfare: ['No one in this city should go hungry while others have more than they can spend.', 'Welfare should be a bridge back to work, not a way of life.'],
  housing: ['Housing is a right. We will cap rents and build homes people can afford.', 'Let builders build. More supply is the only way rents come down.'],
  growth: ['This city should grow: more homes, more businesses, more people.', 'Slow down. We must protect the neighborhoods we love.'],
  ownership: ['What we all depend on, we should all own.', 'Private enterprise built this city.'],
  order: ['Safe streets come first. More police, tougher on crime.', 'We need fewer police and more opportunity.'],
  democracy: ['Your vote, your voice. We will defend free elections and a free press.', 'This city needs strong leadership, not endless debate.'],
  roads: ['Paved roads, working infrastructure: the basics, done right.', 'Fix what we have before building more.'],
};

/** A line from a speaker on an issue they care about. */
export function speechLine(ctx: Ctx, p: Person, issue?: Issue): string {
  const issues: Issue[] = ['taxes', 'welfare', 'housing', 'growth', 'order', 'democracy', 'roads', 'ownership'];
  const pick = issue ?? issues.reduce((a, b) => (Math.abs(stance(ctx, p, b)) > Math.abs(stance(ctx, p, a)) * (0.7 + 0.6 * ctx.rng.next()) ? b : a));
  const s = stance(ctx, p, pick);
  return ISSUE_TALK[pick][s >= 0 ? 0 : 1];
}

/** Each minute a speaker is on stage: every few minutes a line; the crowd hears it. */
export function speakMinute(ctx: Ctx, p: Person, ev: CivicEvent, elapsed: number): void {
  if (elapsed % 6 !== 1) return;
  const opener = elapsed < 6;
  const text = opener
    ? ev.kind === 'protest' ? `${ev.cause} We won't be silent anymore!` : ev.kind === 'session' ? 'This session is called to order.' : `Thank you all for coming! I'm ${p.name}.`
    : ev.kind === 'protest' ? ctx.rng.pick([ev.cause ?? 'Enough!', 'They can\'t ignore us!', 'This is our city!', 'Whose streets? Our streets!']) : speechLine(ctx, p);
  const line: ChatLine = { t: ctx.s.tick, who: p.id, text };
  ev.lines.push(line);
  if (ev.lines.length > 60) ev.lines.shift();
  p.saying = text;
  p.sayingUntil = ctx.s.tick + 5;
  p.said.push(line);
  if (p.said.length > 6) p.said.shift();
  const c = compass(p);
  for (const id of ev.attendees) {
    const q = ctx.byId.get(id);
    if (!q || q === p) continue;
    q.pol.aware[p.id] = Math.min(1, (q.pol.aware[p.id] ?? 0) + (ev.kind === 'rally' ? 0.05 : 0.03));
    if (ev.kind !== 'protest') expose(q, c.econ, c.auth, 1.5);
    q.pol.contacted = ctx.s.tick; // being there gets people out to vote
  }
}

/**
 * Hourly: a debate that's starting is held if at least two candidates showed
 * up. The transcript is written now, and the TV channel airs it. Who comes
 * out on top depends on how well they speak (and luck).
 */
export function debatesHourly(ctx: Ctx): void {
  for (const ev of ctx.s.events) {
    if (ev.kind !== 'debate' || ev.data?.held || ctx.s.tick < ev.start || ctx.s.tick > ev.start + 30) continue;
    const present = ev.speakers.map((id) => ctx.byId.get(id)).filter((p): p is Person => !!p && (p.inside === ev.place || ctx.rng.chance(0.5)));
    ev.data = { ...(ev.data ?? {}), held: 1 };
    if (present.length < 2) { ev.lines.push({ t: ctx.s.tick, who: -1, text: 'The debate was called off: not enough candidates showed up.' }); continue; }
    const mod = -1;
    const say = (who: number, text: string) => ev.lines.push({ t: ctx.s.tick, who, text });
    say(mod, `Good evening and welcome to the debate. With us: ${present.map((p) => p.name).join(', ')}.`);
    const topics: Issue[] = ['taxes', 'housing', 'welfare', 'order', 'growth'];
    for (const t of topics.sort(() => ctx.rng.next() - 0.5).slice(0, 3)) {
      say(mod, `${t === 'taxes' ? 'Taxes' : t === 'housing' ? 'Rents' : t === 'welfare' ? 'Those without work' : t === 'order' ? 'Safety' : 'Growth'}: what will you do?`);
      for (const p of present) say(p.id, speechLine(ctx, p, t));
      // a jab at the rival furthest away
      const a = present[Math.floor(ctx.rng.next() * present.length)];
      const b = present.filter((x) => x !== a).reduce((x, y) => (distance(compass(y), compass(a)) > distance(compass(x), compass(a)) ? y : x));
      say(a.id, ctx.rng.pick([`${b.name.split(' ')[0]}'s plan would ruin this city.`, `With respect, ${b.name.split(' ')[0]} has no idea what people here are going through.`, `We've heard these promises before.`]));
    }
    const scores = present.map((p) => ({ p, s: p.traits.communication + 0.3 * p.pol.engagement + ctx.rng.next() * 0.6 }));
    const winner = scores.reduce((a, b) => (b.s > a.s ? b : a)).p;
    ev.data.winner = winner.id;
    say(mod, 'Thank you all. And thank you for watching.');
    log(ctx, 'politics', `${ev.title}: most viewers thought ${winner.name} came out on top.`, { who: winner.id });
  }
}

/** Is there an event this person should be at (or might go to)? Returns the best one with a reason and weight. */
export function eventsFor(ctx: Ctx, p: Person): { ev: CivicEvent; w: number; role: 'speak' | 'attend' }[] {
  const out: { ev: CivicEvent; w: number; role: 'speak' | 'attend' }[] = [];
  const h = hourOf(ctx.s.tick);
  for (const ev of ctx.s.events) {
    // from an hour before until it's nearly over
    if (ev.start - ctx.s.tick > 70 || ev.end - ctx.s.tick < 15) continue;
    if (ev.speakers.includes(p.id) || ev.host === p.id) { out.push({ ev, w: 6, role: ev.kind === 'session' ? 'attend' : 'speak' }); continue; }
    const g = ctx.gById.get(ev.polity);
    if (ev.kind === 'session' && g) {
      const official = g.offices.some((o) => o.holder === p.id && (o.kind === 'council' || o.kind === 'exec'));
      const meeting = g.charter.councilBy === 'all';
      if (official) out.push({ ev, w: 5.5, role: 'attend' });
      else if (meeting) out.push({ ev, w: 1.2 + 2.5 * p.pol.engagement, role: 'attend' });
      else if (p.pol.engagement > 0.55 || p.pol.grievance > 1) out.push({ ev, w: 0.6 + p.pol.engagement + 0.4 * p.pol.grievance, role: 'attend' });
      continue;
    }
    if (ev.kind === 'speech' || ev.kind === 'rally') {
      const speaker = ctx.byId.get(ev.host);
      if (!speaker) continue;
      const near = distance(compass(p), compass(speaker)) < 1.1;
      const friend = (p.rel[speaker.id]?.trust ?? 0) > 0.5;
      const w = (near ? 1 : 0.3) * (0.4 + 2 * p.pol.engagement) + (friend ? 1.5 : 0) + (ev.kind === 'rally' ? 0.4 : 0) + 0.3 * p.traits.curiosity - (h >= 21 ? 1 : 0);
      if (w > 1) out.push({ ev, w, role: 'attend' });
      continue;
    }
    if (ev.kind === 'protest') continue; // decided in regime.joinsProtest
  }
  return out;
}

/** People who are candidates in a running campaign (for canvassing and flyers). */
export function activeCampaign(ctx: Ctx, p: Person): { e: Election; c: Candidate; mine: boolean } | undefined {
  for (const e of ctx.s.elections) {
    if (e.status !== 'campaign') continue;
    const own = e.candidates.find((c) => c.person === p.id && !c.withdrawn);
    if (own) return { e, c: own, mine: true };
    // party activists campaign for their party's candidate
    if (p.pol.party >= 0 && p.pol.engagement > 0.6) {
      const c = e.candidates.find((x) => x.party === p.pol.party && !x.withdrawn);
      if (c) return { e, c, mine: false };
    }
  }
  return undefined;
}

/** Knocking on doors: people living near here hear about the candidate (and are likelier to vote). */
export function canvassMinute(ctx: Ctx, p: Person, candidate: number, elapsed: number): void {
  if (elapsed % 8 !== 0) return;
  for (const q of ctx.s.people) {
    if (q.home < 0 || q === p) continue;
    const h = ctx.bById.get(q.home);
    if (!h || Math.hypot(h.x - p.x, h.y - p.y) > 45 || q.inside !== h.id || !ctx.rng.chance(0.3)) continue;
    q.pol.contacted = ctx.s.tick;
    q.pol.aware[candidate] = Math.min(1, (q.pol.aware[candidate] ?? 0) + 0.1);
    const text = `Hi! I'm ${candidate === p.id ? 'running for office' : `with ${ctx.byId.get(candidate)?.name ?? 'the campaign'}`}. Can we count on your vote?`;
    p.saying = text;
    p.sayingUntil = ctx.s.tick + 4;
    break;
  }
}

