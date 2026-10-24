// Politics views: the political compass, a person's views, and the
// government panel (system, officials, money, laws, elections, parties,
// upcoming events).

import { formatTime, headOf, nameOf, type Ctx } from '../sim/ctx';
import { compass, compassLabel, stance, ageOf } from '../sim/ideology';
import { mainPolity, polityOf, residentsOf, treasury } from '../sim/government';
import { canVote, districtOf, poll } from '../sim/elections';
import { ISSUES, type Issue, type Person, type Polity } from '../sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hsl = (h: number, s = 60, l = 55) => `hsl(${Math.round(h * 360)} ${s}% ${l}%)`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const ISSUE_LABEL: Record<Issue, [string, string]> = {
  taxes: ['Lower taxes', 'Taxes for services'],
  welfare: ['Less welfare', 'More welfare'],
  housing: ['Free housing market', 'Rent control'],
  growth: ['Slow growth', 'More growth'],
  ownership: ['Private ownership', 'Public ownership'],
  order: ['Fewer police', 'More police'],
  democracy: ['Strong leadership', 'Free elections & press'],
  roads: ['Spend less on roads', 'Pave more roads'],
};

/**
 * The political compass: economic left–right across, authority up (order)
 * and down (liberty). Residents are faint dots, parties labeled circles,
 * officials outlined, and the selected person a ringed dot.
 */
export function compassSvg(ctx: Ctx, people: Person[], opts: { focus?: Person; g?: Polity; size?: number } = {}): string {
  const W = opts.size ?? 300, H = W, pad = 22;
  const X = (e: number) => pad + ((Math.max(-3, Math.min(3, e)) + 3) / 6) * (W - 2 * pad);
  const Y = (a: number) => pad + ((3 - Math.max(-3, Math.min(3, a))) / 6) * (H - 2 * pad);
  const officials = new Set(opts.g?.offices.map((o) => o.holder) ?? []);
  const sample = people.length > 400 ? people.filter((_, i) => i % Math.ceil(people.length / 400) === 0) : people;
  const dots = sample.map((p) => {
    const c = compass(p);
    const party = ctx.partyById.get(p.pol.party);
    const fill = party ? hsl(party.hue, 55, 55) : 'var(--text-muted)';
    return `<circle cx="${X(c.econ).toFixed(1)}" cy="${Y(c.auth).toFixed(1)}" r="${officials.has(p.id) ? 3.6 : 2.2}" fill="${fill}" fill-opacity="${party ? 0.75 : 0.4}"${officials.has(p.id) ? ' stroke="var(--text-primary)" stroke-width="1.2"' : ''}><title>${esc(p.name)}: ${compassLabel(c.econ, c.auth)}</title></circle>`;
  }).join('');
  const parties = opts.g ? ctx.s.parties.filter((pt) => pt.polity === opts.g!.id && !pt.banned && pt.members.length) : [];
  const partyMarks = parties.map((pt) => `<g><circle cx="${X(pt.econ).toFixed(1)}" cy="${Y(pt.auth).toFixed(1)}" r="${4 + Math.min(8, Math.sqrt(pt.members.length))}" fill="none" stroke="${hsl(pt.hue, 60, 60)}" stroke-width="2"/>
    <text x="${(X(pt.econ) + 8).toFixed(1)}" y="${(Y(pt.auth) - 6).toFixed(1)}" font-size="10" fill="var(--text-secondary)">${esc(pt.short)}</text></g>`).join('');
  let focus = '';
  if (opts.focus) {
    const c = compass(opts.focus);
    focus = `<circle cx="${X(c.econ).toFixed(1)}" cy="${Y(c.auth).toFixed(1)}" r="6" fill="var(--accent)" stroke="#fff" stroke-width="2"/>`;
    // where their interests pull them (anchor)
    focus += `<line x1="${X(c.econ).toFixed(1)}" y1="${Y(c.auth).toFixed(1)}" x2="${X(opts.focus.pol.anchorEcon).toFixed(1)}" y2="${Y(opts.focus.pol.anchorAuth).toFixed(1)}" stroke="var(--accent)" stroke-dasharray="3 3" stroke-width="1.2"/>`;
  }
  const mid = W / 2;
  return `<svg class="compass" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
    <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="rgba(255,255,255,0.025)" stroke="var(--grid)"/>
    <line x1="${mid}" y1="${pad}" x2="${mid}" y2="${H - pad}" stroke="var(--grid)"/><line x1="${pad}" y1="${mid}" x2="${W - pad}" y2="${mid}" stroke="var(--grid)"/>
    <text x="${mid}" y="${pad - 7}" text-anchor="middle" font-size="10" fill="var(--text-muted)">authoritarian (order)</text>
    <text x="${mid}" y="${H - pad + 14}" text-anchor="middle" font-size="10" fill="var(--text-muted)">libertarian (liberty)</text>
    <text x="${pad - 4}" y="${mid - 4}" text-anchor="start" font-size="10" fill="var(--text-muted)" transform="rotate(-90 ${pad - 8} ${mid})">left</text>
    <text x="${W - pad + 12}" y="${mid}" text-anchor="middle" font-size="10" fill="var(--text-muted)" transform="rotate(90 ${W - pad + 8} ${mid})">right</text>
    ${dots}${partyMarks}${focus}</svg>`;
}

function stanceBar(label: [string, string], v: number): string {
  const w = Math.min(50, Math.abs(v) * 50);
  return `<div class="stance"><span class="l">${esc(label[0])}</span><div class="bar habit"><span style="margin-left:${v < 0 ? 50 - w : 50}%;width:${w}%;background:${v >= 0 ? 'var(--series-1)' : 'var(--series-2)'}"></span></div><span class="r">${esc(label[1])}</span></div>`;
}

/** The politics section of a person's inspector. */
export function personPoliticsHtml(ctx: Ctx, p: Person, link: (id: number) => string): string {
  const c = compass(p);
  const g = polityOf(ctx, p);
  const party = ctx.partyById.get(p.pol.party);
  const pid = ctx.partyById.get(p.pol.partyId);
  const tv = ctx.fById.get(p.pol.tv)?.channel?.name;
  const sites = p.pol.sites.map((id) => ctx.fById.get(id)?.site?.name).filter(Boolean);
  const aware = Object.entries(p.pol.aware).filter(([id]) => ctx.byId.has(+id) && ctx.s.elections.some((e) => e.candidates.some((x) => x.person === +id))).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const recs = ctx.s.polities.filter((x) => x.status !== 'gone' && p.pol.rec[x.id] !== undefined).map((x) => `${esc(x.short)} ${pct(p.pol.rec[x.id])}`).join(' · ');
  const office = ctx.s.polities.flatMap((x) => x.offices.filter((o) => o.holder === p.id).map((o) => `${o.title}, ${x.short}`));
  const tilts = Object.entries(p.pol.tilt).filter(([, v]) => Math.abs(v!) > 0.1).map(([k, v]) => `${k} ${v! > 0 ? '+' : ''}${v!.toFixed(1)}`).join(', ');
  return `<h3>Politics</h3>
    <div class="kv">
      <span class="k">Position</span><span><b>${compassLabel(c.econ, c.auth)}</b> <span class="muted small">(economic ${c.econ >= 0 ? '+' : ''}${c.econ.toFixed(1)}, authority ${c.auth >= 0 ? '+' : ''}${c.auth.toFixed(1)})</span></span>
      ${office.length ? `<span class="k">Office</span><span>${esc(office.join('; '))}</span>` : ''}
      <span class="k">Party</span><span>${party ? `<span class="dot" style="background:${hsl(party.hue)}"></span>member of ${esc(party.name)}` : pid ? `votes ${esc(pid.name)} (${pct(p.pol.partyStrength)} attached)` : 'no party'}</span>
      <span class="k">Interest</span><span>${pct(p.pol.engagement)} engaged · grievance ${p.pol.grievance.toFixed(1)}${p.pol.protesting >= 0 ? ' · <b>protesting</b>' : ''}</span>
      <span class="k">Accepts</span><span>${recs || '—'} <span class="muted small">(how far they accept each government's rules)</span></span>
      ${g ? `<span class="k">Vote</span><span>${canVote(ctx, g, p) ? `can vote in ${esc(g.short)}${g.districts.length ? `, district ${districtOf(ctx, g, p) + 1}` : ''}` : `can't vote in ${esc(g.short)}`}${p.pol.voted > 0 ? ` · last voted ${formatTime(p.pol.voted)}${ctx.byId.get(p.pol.votedFor) ? ` for ${link(p.pol.votedFor)}` : ''}` : ''}</span>` : ''}
      <span class="k">Media</span><span>${tv ? `watches ${esc(tv)}` : (p.durables.tv ?? 0) > 0 ? 'has a TV' : 'no TV'} · ${sites.length ? `on ${esc(sites.join(', '))}` : (p.durables.phone ?? 0) > 0 || (p.durables.computers ?? 0) > 0 ? 'online, no accounts yet' : 'offline'}</span>
      ${aware.length ? `<span class="k">Knows of</span><span>${aware.map(([id, v]) => `${link(+id)} ${pct(v)}`).join(' · ')}</span>` : ''}
      ${tilts ? `<span class="k">Life events</span><span class="small">${esc(tilts)}</span>` : ''}
    </div>
    ${compassSvg(ctx, g ? residentsOf(ctx, g) : ctx.s.people, { focus: p, g, size: 260 })}
    <p class="muted small">Their position follows from who they are: personality (openness, agreeableness, ambition…), ${p.edu} years of school, age ${Math.floor(ageOf(ctx, p))}, growing up in ${esc(p.origin)}, and how they live. The dashed line points to where their interests are pulling them. TV, posts, ads, speeches and trusted friends move them a little.</p>
    ${ISSUES.map((i) => stanceBar(ISSUE_LABEL[i], stance(ctx, p, i))).join('')}`;
}

/** Plain words for a charter. */
export function charterText(ctx: Ctx, g: Polity): string {
  const c = g.charter;
  const parts: string[] = [];
  const exec = c.execBy === 'voters' ? `a ${c.execTitle.toLowerCase()} elected by the voters every ${c.execTerm} days${c.veto ? ' (with a veto)' : ''}`
    : c.execBy === 'council' ? `a ${c.execTitle.toLowerCase()} chosen by the council` : c.execBy === 'party' ? `a ${c.execTitle.toLowerCase()} chosen by the ruling party`
      : c.execBy === 'force' ? `a ${c.execTitle.toLowerCase()} who took power by force` : c.execBy === 'successor' ? `a ${c.execTitle.toLowerCase()} for life, who names a successor`
        : c.execBy === 'owner' ? `the owner of ${ctx.fById.get(g.company ?? -1)?.name ?? 'the company'}` : 'no executive';
  parts.push(`Run by ${exec}.`);
  if (c.councilBy === 'all') parts.push('Every voter has a seat and a vote at the open city meeting.');
  else if (c.councilBy === 'voters') parts.push(`${c.councilTitle}: ${c.seats} seats, ${c.districts ? `${c.districts} districts` : 'elected at-large'}, ${c.method === 'list' ? 'party-list proportional representation' : c.method === 'runoff' ? 'with runoffs' : 'first past the post'}, every ${c.councilTerm} days.`);
  else if (c.councilBy === 'appointed') parts.push(`${c.councilTitle}: appointed.`);
  else if (c.councilBy === 'party') parts.push(`${c.councilTitle}: chosen by the party.`);
  else parts.push('No council.');
  parts.push(`Vote: ${c.franchise === 'residents' ? `residents after ${c.residency} days` : c.franchise === 'owners' ? 'property owners only' : c.franchise === 'members' ? 'party members only' : 'everyone'}.`);
  parts.push(`Parties ${c.parties === 'free' ? 'free' : c.parties === 'single' ? 'banned except the ruling party' : 'not on the ballot'}; press ${c.press}; economy ${c.ownership}.`);
  parts.push(`Changing the charter needs ${c.amend === 'supermajority' ? 'a two-thirds council vote' : c.amend === 'referendum' ? 'the council and then the voters' : c.amend === 'majority' ? 'a council majority' : 'only the executive'}.`);
  if (c.suspendedUntil > ctx.s.tick) parts.push(`<b>Elections are suspended until ${formatTime(c.suspendedUntil)}.</b>`);
  return parts.join(' ');
}

/** The Government tab. */
export function governmentHtml(ctx: Ctx, which: number, link: (id: number) => string, watch: (personId: number) => string): string {
  const all = ctx.s.polities.filter((g) => g.status !== 'gone');
  const g = ctx.gById.get(which) ?? mainPolity(ctx);
  if (!g) return '<p class="muted small">No government exists here (yet).</p>';
  const tabs = all.length > 1 ? `<div class="chips">${all.map((x) => `<span class="chip${x === g ? ' on' : ''}" data-polity="${x.id}">${esc(x.short)}${x.status === 'rival' ? ' (rival)' : x.status === 'provisional' ? ' (provisional)' : ''}</span>`).join('')}</div>` : '';
  const people = residentsOf(ctx, g);
  const head = headOf(ctx, g);
  const offices = g.offices.map((o) => {
    const pt = ctx.partyById.get(o.party);
    return `<tr><td>${esc(o.title)}</td><td>${o.holder >= 0 ? link(o.holder) : '<span class="muted">vacant</span>'}</td><td>${pt ? `<span class="dot" style="background:${hsl(pt.hue)}"></span>${esc(pt.short)}` : '<span class="muted small">ind.</span>'}</td><td class="r muted small">${o.termEnd > 0 ? formatTime(o.termEnd).replace('Day ', 'D').split(',')[0] : o.kind === 'chief' || o.kind === 'clerk' ? 'appointed' : '—'}</td></tr>`;
  }).join('');
  const sum = (r: Record<string, number>) => Object.values(r).reduce((s, x) => s + x, 0);
  const fiscal = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v.toFixed(0)}`).join(' · ') || '—';
  const p = g.policy;
  const laws = g.laws.slice(-30).reverse().map((l) => `<div class="log-row"><span class="t">${formatTime(l.t).replace('Day ', 'D')}</span><span class="tag" style="background:${l.passed ? 'rgba(12,163,12,0.25)' : 'rgba(208,59,59,0.22)'}">${l.passed ? 'passed' : l.how === 'sent to referendum' ? 'to voters' : 'failed'}</span>${esc(l.title)} <span class="muted small">${esc(l.how)}${l.how === 'decree' || l.how === 'founding assembly' ? '' : ` ${l.yes}–${l.no}`}${l.by >= 0 && ctx.byId.has(l.by) ? ` · moved by ${link(l.by)}` : ''}</span></div>`).join('');
  // elections: running and past
  const running = ctx.s.elections.filter((e) => e.polity === g.id && (e.status === 'campaign' || e.status === 'voting'));
  const elections = running.map((e) => {
    if (e.kind === 'referendum') return `<div class="card"><b>Referendum ${formatTime(e.day)}</b>: ${esc(e.motion?.title ?? '')}${e.status === 'voting' ? ` · voting now (${e.voters.length} so far)` : ''}</div>`;
    const offices2 = [...new Set(e.candidates.map((c) => c.office))];
    return `<div class="card"><b>${e.kind === 'runoff' ? 'Runoff' : 'Election'} ${formatTime(e.day)}</b>${e.status === 'voting' ? ` · <b>polls open</b>, ${e.voters.length} have voted` : ''}
      ${offices2.map((oid) => {
        const o = g.offices.find((x) => x.id === oid);
        const shares = poll(ctx, e, oid, 60);
        return `<div class="small muted" style="margin-top:6px">${esc(o?.kind === 'council' && o.district < 0 ? 'Council (at-large)' : o?.title ?? '')} · poll</div>${shares.map((s) => {
          const c = e.candidates.find((x) => x.person === s.person && x.office === oid)!;
          const pt = ctx.partyById.get(c.party);
          return `<div class="poll"><span class="name">${link(s.person)}</span><span class="muted small">${pt ? esc(pt.short) : 'ind.'}</span><div class="bar"><span style="width:${(s.share * 100).toFixed(0)}%;background:${pt ? hsl(pt.hue) : 'var(--text-muted)'}"></span></div><span class="n">${pct(s.share)}</span></div>`;
        }).join('')}`;
      }).join('')}</div>`;
  }).join('');
  const past = ctx.s.elections.filter((e) => e.polity === g.id && e.status === 'done').slice(-3).reverse().map((e) => {
    if (e.kind === 'referendum') return `<div class="small">${formatTime(e.day)}: referendum "${esc(e.motion?.title ?? '')}": ${(e.yes ?? 0) > (e.no ?? 0) ? 'passed' : 'rejected'} ${e.yes}–${e.no}</div>`;
    const winners = e.results.flatMap((r) => r.winners).map((id) => link(id));
    return `<div class="small">${formatTime(e.day)}: ${e.kind} · turnout ${pct(e.turnout)} of ${e.eligible} · elected ${winners.join(', ') || '—'}</div>`;
  }).join('');
  const parties = ctx.s.parties.filter((pt) => pt.polity === g.id && pt.members.length).sort((a, b) => b.members.length - a.members.length).map((pt) => {
    const seats = g.offices.filter((o) => o.party === pt.id && o.holder >= 0).length;
    return `<div class="row"><span class="dot" style="background:${hsl(pt.hue)}"></span><div class="main"><div class="name">${esc(pt.name)}${pt.banned ? ' <span class="tag">banned</span>' : ''}</div><div class="sub">${compassLabel(pt.econ, pt.auth)} · leader ${link(pt.leader)} · “${esc(pt.slogan)}”</div></div><div class="num">${pt.members.length}<div class="sub">${seats} in office</div></div></div>`;
  }).join('');
  const events = ctx.s.events.filter((e) => e.polity === g.id && e.end > ctx.s.tick).sort((a, b) => a.start - b.start).slice(0, 8)
    .map((e) => `<div class="log-row click" data-building="${e.place}"><span class="t">${formatTime(e.start).replace('Day ', 'D')}</span><span class="tag">${e.kind}</span>${esc(e.title)}${e.start <= ctx.s.tick ? ` · <b>now</b>, ${e.attendees.length} there` : ''} ${ctx.byId.has(e.host) ? watch(e.host) : ''}</div>`).join('');
  const recent = ctx.s.events.filter((e) => e.polity === g.id && e.end <= ctx.s.tick && e.lines.length).slice(-1)[0];
  const others = ctx.s.polities.filter((x) => x !== g && x.status !== 'gone' && x.cells.some((c) => g.cells.includes(c)));
  return `${tabs}<h3>${esc(g.name)}</h3>
    <p class="small muted">Its borders are shown on the map while you look at it (${(g.cells.length * 0.0025).toFixed(2)} km²) · <span class="link" data-borders="${g.id}">zoom to the borders</span></p>
    <p><b>${esc(g.label)}</b>${others.length ? ` · <span style="color:var(--critical)">disputed: ${others.map((o) => esc(o.name)).join(', ')} also claims to govern here</span>` : ''}</p>
    <p class="small">${charterText(ctx, g)}</p>
    <div class="tiles">
      <div class="tile"><div class="v">${people.length}</div><div class="l">residents</div></div>
      <div class="tile"><div class="v">${treasury(ctx, g).toFixed(0)}</div><div class="l">treasury</div></div>
      <div class="tile"><div class="v">${pct(g.legitimacy)}</div><div class="l">accept its authority</div></div>
    </div>
    ${head ? `<p class="small">Led by ${link(head.id)} (${compassLabel(head.pol.econ, head.pol.auth)}).${g.nextElection > 0 ? ` Next election ${formatTime(g.nextElection)}.` : g.charter.execBy === 'voters' || g.charter.councilBy === 'voters' ? '' : ' No elections.'} ${g.nextSession > ctx.s.tick ? ` Next session ${formatTime(g.nextSession)}.` : ''}</p>` : ''}
    ${elections ? `<h3>Elections</h3>${elections}` : ''}
    <h3>Offices</h3><table>${offices}</table>
    <h3>Money (yesterday)</h3><div class="kv small"><span class="k">In ${sum(g.fiscal.prevIncome).toFixed(0)}</span><span>${fiscal(g.fiscal.prevIncome)}</span><span class="k">Out ${sum(g.fiscal.prevSpend).toFixed(0)}</span><span>${fiscal(g.fiscal.prevSpend)}</span></div>
    <h3>Policies</h3><p class="small">Property tax ${(p.propertyTax * 100).toFixed(1)}%/yr · income tax ${(p.incomeTax * 100).toFixed(1)}% · sales tax ${(p.salesTax * 100).toFixed(1)}% · welfare ${p.welfare}/day · ${p.police} police · road crew ${p.roadCrew} · ${p.clerks} clerks${p.minWage ? ` · minimum wage ${p.minWage}` : ''}${p.rentCap ? ` · rent cap ${p.rentCap}` : ''}${p.maxFloors ? ` · height limit ${p.maxFloors} floors` : ''} · public land at ${p.landPrice}× value · newcomers ${p.immigration}${p.nationalizeAbove ? ` · firms over ${p.nationalizeAbove} staff are nationalized` : ''}</p>
    ${events ? `<h3>Coming up</h3>${events}` : ''}
    ${recent ? `<h3>${esc(recent.title)}</h3>${recent.lines.slice(-8).map((l) => `<div class="line"><b>${esc(l.who >= 0 ? nameOf(ctx, l.who).split(' ')[0] : 'Moderator')}:</b> ${esc(l.text)}</div>`).join('')}` : ''}
    ${past ? `<h3>Past elections</h3>${past}` : ''}
    <h3>Parties</h3>${parties || '<p class="muted small">No parties yet.</p>'}
    <h3>Where people stand</h3>${compassSvg(ctx, people, { g })}
    <h3>Gazette (decisions)</h3>${laws}`;
}
