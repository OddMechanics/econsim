# Politics and government: mechanism notes

Notes for an emergent, not hard-coded, political system. Each section gives the real-world mechanism with typical numbers, then suggested rules. "~" means approximate. [Sn] tags point to the source list. **Y** is one simulated political year, a setting (for example 60 game days).

**Core idea.** A government is an organization, like a firm. It has:
- a **charter**: a data object of rules;
- a **territory claim**: a set of tiles, which need not match where people live;
- **officials**, a **treasury**, and **enforcers** (people it pays to compel others);
- **recognition** `r[person][gov]` ∈ 0..1: how far each person accepts its rules as binding.

Several bodies can claim the same tiles. The real government is the one people actually obey and pay.

---

## 1. How local governments come into being

- **Frontier self-rule comes first.** Mining camps held miners' meetings: only claim owners voted, and a majority of those present decided. A meeting elected a 5-person committee to draft "district laws" and a **recorder** to register claims, re-elected every year. Ten claim holders could force a meeting, and outside law filled any gaps [S1]. Claim clubs and vigilance committees followed the same pattern. The trigger is **land disputes and theft with no one to settle them**.
- **Formal incorporation (US)** requires all of the following [S2]:
  - a petition signed by a share of residents (TN: 33⅓% of voters; OH: 20%);
  - a minimum population (TN: 1,500) and distance from existing cities (TN: 3 mi; CO: 1 mi);
  - a boundary description and a services plan;
  - a public hearing and county approval;
  - a majority vote of the residents inside the proposed area.
- **Motives:** block annexation, control zoning, keep taxes local, get services. Lakewood, CA (1954) incorporated to avoid annexation by Long Beach and *contracted* its services from the county. Over ¼ of California cities now work this way [S3]. An **HOA** that becomes a town switches from one vote per lot to one vote per person and gains the power to tax.
- **A charter contains:** name, boundaries, form of government, offices and their powers, seats, terms, election method, tax and borrowing powers and limits, budget process, who appoints whom, initiative/referendum/recall rules, and the **amendment procedure**. The amendment procedure decides how the system can change itself.
- **First offices:** mayor or board president, 5–7 councillors, clerk/recorder, treasurer, assessor, marshal, and municipal judge. Police chief, fire chief and city manager come later, once there is money.

**Rules suggested**
1. **Founding trigger.** At most once per Y for each cluster of 30 or more adults, count unresolved *civic problems*: land disputes, thefts, missing shared roads, annexation threats. Above a threshold, the resident with the top `ambition × communication` calls a **founding assembly**.
2. **Assembly.** Attendance follows the §3 turnout model. It is valid with a quorum of 10% of adults. Attendees vote on each charter option (form, seats, taxes, who may vote), and ties keep the default.
3. **Voter eligibility** is a charter field: residents, property owners only, or one vote per lot. Founders tend to pick rules that favor their own group.
4. **Territory** at founding is the cluster's hull plus 0–2 tiles, or chosen to grab valuable unowned land.

---

## 2. Structures

- **Forms** (ICMA 2018) [S4]:
  - council-manager ~48%: the council sets policy and hires a professional manager, who can be fired by a simple majority;
  - mayor-council ~38%: the *strong* mayor vetoes, appoints department heads and drafts the budget, while a *weak* mayor mostly chairs. This form is the most common under 5,000 people;
  - town meeting ~8%: every voter is a legislator at a yearly budget meeting, and a 3–5 member select board runs things in between;
  - commission ~3%: each elected commissioner runs one department, with no separation of powers.
- **Size and terms.** Councils have 5–9 seats (Model City Charter); big cities have 15–51. Terms are 2–4 years and usually **staggered**, half every 2 years [S5]. Some cities limit officials to 2–3 terms.
- **Committees** of 3–5 members (finance, public safety, public works, planning) hold hearings and recommend, and the full council votes. The chair controls the agenda. Quorum is a majority; overriding a veto, emergencies and sometimes tax increases need ⅔.
- **Budget.** Yearly: the executive proposes, the council amends and adopts. The operating budget must balance, and capital projects use bonds, often voter-approved.
- **Revenue** (US, ~):
  - property tax ~70% of local tax revenue, at effective rates of ~0.3–1.8% of home value per year [S6];
  - local sales tax 0–5% on top of the state rate (~6–10% combined);
  - local income tax rare in the US (NYC ~3–3.9%) but standard in the Nordics (Sweden ~32% municipal plus regional);
  - fees and charges ~20–25%;
  - transfers from higher governments ~⅓.
- **Spending** (US cities, ~): police ~16% [S7], fire ~8–10%, roads ~8%, sewer and garbage ~10%, parks ~5%, administration ~10%, debt interest ~5%. Welfare is small in US cities (counties pay it) but a municipal job in Europe.

**Rules suggested**
1. **Charter fields:** `form`, `seats` (3–15), `termY` (2–4), `staggered`, `districts` (0 = at-large), `vetoOverride` (⅔), `quorum` (½), `taxes[]`, `debtLimit` (10% of assessed value), `amendRule`.
2. **Default budget:** police 20, roads 20, sanitation 15, administration 15, welfare 10, parks 5, reserve 15 (%). Each line drives a service level: crime, road speed, disease, satisfaction.
3. **Starting taxes:** property 1%/Y of assessed value (assessed at the last sale price, refreshed every 2Y), sales 2%, income 0–3%, plus fees for services.
4. **Officials vote by utility:** own ideology (§5) + re-election risk (§3) + donors' interests.

---

## 3. Elections

- **At-large voting** lets a 51% bloc win every seat. **Districts** give local minorities seats. Most of Europe uses party-list proportional representation.
- **Redistricting** after each census equalizes populations (local deviations of ±5–10% are tolerated). **Gerrymandering** works by *packing* (opponents win a few seats 80–20) and *cracking* (opponents lose everywhere 45–55). The efficiency gap (difference in wasted votes ÷ total votes) above ~7% is a red flag.
- **Changing the rules:**
  - *charter amendment*: proposed by the council or by initiative, then a voter vote;
  - *initiative*: ~5–15% of voters must sign;
  - *referendum*: often mandatory for bonds and taxes;
  - *recall*: ~25% of the last vote for that office, gathered within ~120 days. 36 US states allow recall of local officials [S8].
- **Turnout.** Off-cycle mayoral elections draw ~20% (under 15% in a third of large US cities). Voting on the same day as national elections gives ~50–70%. People 65+ are ~15× likelier to vote than those under 35 [S9]. Turnout rises with age, education, income, homeownership ("homevoters") [S10], length of residence, being personally asked, and having voted before.
- **How voters decide:**
  - party ID dominates where parties exist;
  - nonpartisan races turn on incumbency, name recognition, endorsements, neighborhood, and ballot order (first-listed gets ~+2 points in low-information races);
  - *retrospective voting* punishes incumbents for bad times, weighted heavily toward recent months [S11];
  - competence read from a candidate's face predicted ~70% of Senate races (Todorov 2005).
- **Incumbency.** Barely winning a mayoral race raises the chance of winning the next one by **38–40 points** in Germany, more in big cities. The US effect is substantial and larger in on-cycle elections [S12].

**Rules suggested**
1. **Turnout:** `p = σ(−2.2 + 0.04(age−40) + 0.5 z(wealth) + 0.6 owner + 0.3 z(tenure) + 0.8 votedLast + 0.6 contacted + 0.4 duty + 1.5 onCycle)`. Calibrate to ~20% off-cycle, ~55% on-cycle, and 65+ outvoting under-35s by about 10–15×.
2. **Vote choice** (logit): `U = −1.0 dist(voter, perceivedPos) + 1.5 partyMatch + 0.8 incumbent·retro + 0.3 log(1+exposures) + 0.3 charisma + 0.2 sameNeighborhood + ε`. Here `retro` is the change in the voter's own income plus the change in city unemployment, with a 0.25Y half-life.
3. **Ballot order:** +0.1 utility to the first-listed candidate for voters with fewer than 3 exposures to the race.
4. **Districts:** whoever controls the council redraws them every 10Y. The drawing goal is either "maximize our seats" (pack and crack) or "compact and equal".
5. **Petitions:** any agent can start one, and agreement drives signing. An initiative qualifies at 10% of voters. A recall needs 25% of the last vote within 0.33Y.

---

## 4. Campaigns and media

- **Persuasion ≈ 0 and mobilization works.** Across 49 field experiments, campaign contact in general elections had **~0** persuasive effect. Early contact persuades briefly, and effects are larger in primaries and low-information races [S13].
  - **TV ads:** ~+5 points while airing heavily, ~0 one to two weeks later [S14].
  - **Lawn signs:** ~+1–2 points, with spillover into neighboring precincts; signs naming a party work less well [S15].
  - **Canvassing:** ~+4 points of turnout among people contacted (~$16–19 per extra vote). Volunteer phone calls ~+1–4 points, mail minor, email and robocalls ~0 [S16].
  - **Social pressure** mailer ("neighbors will see whether you voted"): **+8 points** (Gerber, Green & Larimer 2008).
  - **Debates** rarely shift polls by more than 1–3 points (Erikson & Wlezien 2012).
  - **Endorsements** matter mainly when surprising (Chiang & Knight 2011).
- **News slant.** When Fox News entered a town, the Republican vote rose **0.4–0.7 points**, meaning the channel persuaded ~3–8% of its non-Republican viewers [S17]. **Agenda setting** is the strongest effect: the issues media cover become the ones voters call important (r ≈ 0.97, McCombs & Shaw 1972). Framing changes how an issue is judged, not where people stand.
- **Social networks.**
  - The median Facebook user gets 50.4% of content from like-minded sources vs 14.7% from cross-cutting ones.
  - Changing the feed (chronological, no reshares, less like-minded content) had **no measurable effect** on polarization over 3 months [S18].
  - Influence travels through **close ties**: in a 61-million-person experiment, most of the extra turnout came through close friends [S19].
  - The *two-step flow* (media → opinion leaders → their friends) and *homophily* shape who hears what.
- **Commercial ads** have small effects. Average elasticity is ~0.12 short-run and ~0.24 long-run (Sethuraman et al. 2011). Across 288 brands, TV ads showed elasticities of ~0.01–0.03 and were mostly unprofitable at the margin (Shapiro, Hitsch & Tuchman 2021). Effects are hard even for firms to measure (Lewis & Rao 2015). **Flyers reach few** because each copy reaches one household, most go unread, and ~0.5–5% respond. Reach is limited by how many copies get distributed, not by printing cost.

**Rules suggested**
1. **Exposure:** each exposure raises `awareness[candidate]` (capped at 1, half-life 0.5Y). It also moves the person's position by `Δpos = k(msgPos − pos)`, with k = 0.002–0.005, only when the gap is under 1.5 SD. This persuasion decays with a 3-game-day half-life.
2. **Channels** (reach → effect):
   - sign: passers-by within 3 tiles → awareness +0.05/day;
   - billboard: within 8 tiles → +0.03/day;
   - flyer: 1 person per copy, read with p = 0.2;
   - TV or online ad: 5–30% of the outlet's audience;
   - door knock: 10 contacts per worker-hour → turnout +4 points, persuasion ~0 (×3 in low-information races);
   - rally: attendees → awareness +0.3, turnout +5 points.
3. **Outlets** are firms with a `slant`. People pick outlets near their own position. Coverage share over 0.25Y sets **issue salience**, which feeds the voting weights. Over a whole campaign, persuasion caps at ~5% of regular viewers who disagree.
4. **Talk:** when two people with trust above 0.5 talk, each moves 2% of the gap toward the other, but only if the gap is under 1.0 SD (bounded confidence). Echo chambers then emerge on their own.
5. **Debate:** the winner is drawn from `communication` plus noise and gets +0.1 perceived competence among viewers, decaying with a 0.1Y half-life.

---

## 5. Ideology formation

- **Two axes:** *economic* (redistribution, ownership) and *authority* (order vs liberty). They are weakly correlated in the public and more tightly bundled among activists.
- **Economic predictors** (~0.1–0.3 SD each):
  - right: income and wealth, owning a business or being self-employed, managing, renting out property;
  - left: union membership (~10–20 points more left), public-sector jobs, low-wage manual work, unemployment.
  - Homeowners oppose property taxes and new housing nearby [S10].
  - Education: socially liberal (strong), economically mixed.
  - Age: slight drift toward order.
- **Self-interest moves salient, targeted policies more than ideology.**
  - Lottery winners turned against estate taxes but barely changed on redistribution [S20].
  - New homeowners (Ethiopian housing lottery) opposed taxing homes while their general views stayed put [S20].
  - Job loss raises support for more welfare by **~22–25 points**, most among right-leaners, and the shift fades after re-employment [S21].
- **Personality** explains ~5–10% of the variance:
  - **Openness** is the strongest: r ≈ −0.15 with conservatism (N ≈ 576k).
  - **Conscientiousness:** r ≈ +0.08.
  - **Agreeableness** splits: compassion goes with economic left, politeness with social conservatism.
  - Threat sensitivity goes with the authority axis; comfort with hierarchy goes with economic right.
  - Effects are weaker outside rich Western countries and can flip [S22].
- **Stability.** Parent-child correlation in party ID is ~0.5–0.6. Views are most malleable at ages 18–25 and harden after 30. Party ID is very stable (r ~0.8–0.9 over years). Single issue answers are noisy (r ~0.3–0.5), but averaged ideology is stable.

**Rules suggested** (SD units, ~N(0,1))
1. **Initial economic position:** `econ = 0.5 parentEcon + 0.25 z(log wealth) + 0.3 bizOwner + 0.2 landlord − 0.3 union − 0.2 publicJob − 0.3 unemployed + 0.2 z(greed) − 0.15 z(agreeable) + N(0, 0.7)`.
2. **Initial authority position:** `auth = 0.5 parentAuth − 0.25 z(openness) + 0.1 z(workEthic) + 0.1 z(age) + 0.2 z(localCrime) − 0.2 z(education) + N(0, 0.7)`. This needs `openness` and `agreeableness` added to the personality set. Existing traits map as: greed ≈ low agreeableness, work ethic ≈ conscientiousness, sociability (drives participation rather than direction).
3. **Drift:** each Y, move toward the "interest point" (rule 1 without the parent and noise terms) at λ = 0.15 (ages 18–25), 0.05 (26–40), 0.02 (over 40).
4. **Shocks** go to a separate `issueTilt` map:
   - job loss → welfare support +0.8, half-life 0.5Y after re-employment;
   - windfall → opposition to the matching tax +0.6;
   - becoming a landlord → anti-rent-control +0.7, and econ +0.1.
5. **Party ID** forms after voting for the same side twice. It gives +1.5 utility to that side, and switching needs cumulative grievance above 2.0.

---

## 6. Regime change and rival governments

- **Reform** comes in waves after a crisis or scandal, through charter amendments or a charter commission. A **convention** can exceed its mandate: Philadelphia 1787 was called to revise the Articles, wrote a new constitution, and set its own ratification rule (9 of 13 states).
- **Coups.** 491 attempts from 1950 to 2023, ~50% successful, ~4% of country-years [S23]. They are concentrated in poor or declining economies, under illegitimate leaders, and where coups have happened before (the "coup trap"). A coup is a **coordination game**: it wins if armed actors expect others to go along, so seizing broadcasting and the capital is key. Rulers counter with *coup-proofing*: parallel forces and loyalists in command.
- **Revolutions** need **fiscal crisis + elite division + mass mobilization** at once. Youth bulges, urbanization and food-price spikes add pressure [S24].
  - People join once enough others have joined (*threshold cascades*). Because they hide their true views (*preference falsification*), regimes look stable until they suddenly fall, as in Eastern Europe in 1989.
  - Nonviolent campaigns succeeded 53% of the time vs 26% for violent ones. None failed after **3.5%** of the population took part at the peak, though this is contested as a rule [S25].
  - The decisive variable is **security-force defection**.
- **Dual power.**
  - Russia 1917: the Provisional Government had formal authority, but the Petrograd Soviet controlled the troops, railways and telegraph. Order No. 1 told soldiers to obey the government only if the Soviet agreed [S26]. The split ended after 8 months in a seizure of power.
  - Libya 2014–21 (Tripoli vs Tobruk) and Venezuela 2019–23 (Maduro vs Guaidó) had rival governments for years. Each governed where people complied and where its forces reached.
- **Splitting off and annexation.**
  - Rich areas split away to keep their tax base: St. George, LA voted 54% in 2019 to incorporate out of Baton Rouge's parish, and the courts upheld it in 2024. Staten Island voted 65% to leave NYC in 1993, but the state legislature blocked it.
  - **Annexation** needs a petition from landowners or a vote of the people being annexed.
  - Cities annex *empty land* for growth or its tax base, so city limits ≠ built-up area. Texas cities also regulate 0.5–5 miles beyond their limits.
  - A town whose tax base shrinks too far can *disincorporate*.
- **Communist takeover** (Eastern Europe 1944–49, "salami tactics") [S27]:
  1. Join a coalition while taking the police ministry and the media.
  2. Split, smear or merge the rival parties one at a time.
  3. Hold rigged or single-list elections (Poland disqualified 246 opposition candidates and arrested 149).
  4. Nationalize banks and big industry (Hungary: firms over 100 employees in 1948, over 10 in 1949), plus a popular **land reform** handing estates over ~50–100 ha to peasants.
  5. Later, coerced **collectivization** and central five-year plans with price controls, bringing shortages and queues.
  6. A one-party constitution.

  The real process was messier than this list. **Liberalization** runs in reverse: private plots and small firms first (China 1978–84: household farming reached ~98% of households), then price reform, negotiated elections (Poland 1989) and privatization.
- **Backsliding** today seldom uses open coups [S28]. It works through *executive aggrandizement* (removing checks one at a time), *strategic electoral manipulation* (postponing elections, rewriting rules, disqualifying rivals, harassing the press), and *promissory coups* ("temporary" rule with elections promised). The playbook: capture the referees (courts, election board), sideline opponents, rewrite the rules. Rich democracies are durable: none died above ~$6k per capita (1985 dollars), and falling income raises the risk [S29].

**Rules suggested**
1. **Recognition** `r[i][g]` updates each Y toward:
   - service satisfaction (safety, roads, welfare received minus tax paid);
   - perceived fairness of the last election;
   - ideological distance to the people in power;
   - trusted friends' recognition of g (weight 0.3).

   A person complies (pays tax, obeys) if `r > 0.5` or `P(caught)·penalty > cost`.
2. **Control of a tile** = loyalty-weighted enforcers of g in range ÷ all enforcers in range. A body with r > 0.5 among at least 20% of residents and some enforcers can **declare itself a government**, which is how rival governments appear. The standoff ends when one side holds over 70% of enforcers or of compliant taxpayers for 1Y.
3. **Coup:** a leader of an armed group (police chief, security firm, militia) with high `ambition × riskTolerance` and low loyalty can try one.
   - Base hazard 1%/Y; ×2 if the economy is declining, ×2 if mean r < 0.4, ×2.5 if a coup has happened before.
   - It succeeds if its forces exceed the loyalists who actually resist. Each enforcer resists with a probability that rises with their r and with how many others they expect to resist.
   - Calibrate to a ~50% success rate.
4. **Revolt:** `grievance = relative deprivation + z(inequality) + unemployment + unfairness − fear`.
   - Each person has a threshold θ ~ N(25%, 15%) of *visible* participation among their contacts. Run the cascade daily during a crisis.
   - It wins if peak participation reaches 3.5% and at least 30% of enforcers defect. Violence halves defection.
5. **Territory:**
   - Claims may include empty tiles.
   - Annexing needs owners of more than 50% of the area, or a majority of residents if anyone lives there.
   - A neighborhood of 20 or more adults may petition to secede when its net fiscal transfer exceeds 5% of its income. Secession needs a local majority, plus the parent's consent if the charter says so. If the parent refuses, the area can declare unilaterally (rule 2).
6. **Communist path.** A ruling coalition with mean econ below −1.2 runs a staged program:
   - Y0–1: nationalize banks and firms over 20 staff (0–50% compensation) and redistribute land above a cap.
   - Y1–3: farm cooperatives, price controls and planner quotas.
   - Ban parties if r < 0.4, and take over media outlets.
   - Shortages appear wherever the controlled price is below the market-clearing price.
   - Liberalize (private plots and small firms first) when shortages last over 1Y and mean r < 0.35.
7. **Backsliding moves.** An incumbent with high `ambition`, auth above +0.5 and a council majority can postpone an election, redistrict, disqualify a rival, buy or close an outlet, or pack the election board. Each move costs r among high-openness people and gains a little among authoritarian ones. The next move becomes 1.5× likelier if this one met no resistance (protest under 1%, no court block).
8. **Prosperity damps instability:** multiply coup and revolt hazards by `clamp(2 − medianRealIncome/comfortIncome, 0.2, 2)`.

---

## 7. Bankruptcy, inheritance, initial land

- **Bankruptcy.**
  - *Liquidation:* a trustee auctions the assets at fire-sale prices. Proceeds follow **absolute priority**: secured creditors up to their collateral, then administration costs, then wages (capped) and taxes, then unsecured creditors pro rata. Owners usually get nothing [S30].
  - *Reorganization:* the firm keeps running, creditor classes vote on a plan, and debt usually becomes equity, so creditors become the owners and the old owners are wiped out.
  - Recoveries (~): secured ~60–70%, senior unsecured ~35–40%, subordinated ~25–30%.
  - *Individuals:* debts are discharged, but exemptions protect the home and tools of the trade.
- **Inheritance.** Probate pays debts first, and heirs never inherit more debt than the estate holds. Only ~45% of US adults have a will, and the share rises with age. **Intestacy** goes spouse → children equally (a dead child's share passes to its children) → parents → siblings → grandparents' descendants. With no heirs the estate **escheats to the state** [S31]. Stateless societies use custom (eldest son, or equal split) or let occupiers take it.
- **Initial land.** The government owns the *public domain*.
  - Survey: 6×6-mile townships of 36 sections of 640 acres, with section 16 reserved for schools.
  - Sale: by **auction** at land offices, minimum **$1.25/acre** and 80 acres from 1820.
  - *Preemption* (1841): squatters could buy up to 160 acres at the minimum before auction.
  - *Homestead Act* (1862): **160 acres free** after 5 years of living on and improving the land, for a ~$10 fee [S32].
  - Before any of this, claim clubs enforced first-come claims.

**Rules suggested**
1. **Insolvency:** a creditor files after 7 game days of unpaid debts. Compare going-concern value (2Y of expected profit) with liquidation value (assets × 0.6).
   - If the business is worth more running, reorganize: creditors get equity pro rata to their claims, and the owner is wiped out.
   - Otherwise auction each asset (ascending bids, no reserve) and pay out in order: secured bank → wages → taxes → others pro rata → owner.
2. **Death:** a will exists with p = `0.2 + 0.006(age−30)`, higher for conscientious people. Pay debts first. Then follow the will, or intestacy: spouse 50% and children 50% split equally; spouse takes all with no children; then parents, then siblings. With no heir, the estate goes to the government controlling the tile. With no government, keep the current PLAN rule: goods stay in the home and the land becomes unowned.
3. **Public land:** unowned tiles inside a government's claim become public domain. The charter picks how to dispose of them: auction with a minimum price (default 2× the average daily wage per tile), homesteading (free after 1Y of occupation and improvement), or reservation for roads and parks. Earlier first-come claims are confirmed if the claimant lives on and uses the tile (preemption).

---

## Sources

- [S1] NPS, Death Valley mining district laws: https://www.nps.gov/parkhistory/online_books/deva/appendixa.htm; Yavapai district (1863): https://accessgenealogy.com/?p=38497
- [S2] MTAS, How to Incorporate a New City in Tennessee: https://mtas.tennessee.edu/system/files/mrln/mknowledge/main/How%20to%20Incorporate%20a%20New%20City%20in%20Tennessee.pdf; Ohio RC 707.30: https://codes.ohio.gov/ohio-revised-code/section-707.30; Colorado CRS 31-2-101: https://colorado.public.law/statutes/crs_31-2-101
- [S3] City of Lakewood, The Lakewood Plan: https://www.lakewoodca.gov/About/Our-History/The-Lakewood-Story/05-The-Lakewood-Plan
- [S4] ICMA 2018 Form of Government Survey: https://icma.org/sites/default/files/2018%20Municipal%20Form%20of%20Government%20Survey%20Report.pdf
- [S5] National Civic League Model City Charter, Art. II: https://www.nationalcivicleague.org/model-city-charter-9th-edition-article-ii-city-council/
- [S6] Tax Foundation 2025 property tax rates (via Bankrate): https://www.bankrate.com/taxes/states-with-the-highest-property-taxes
- [S7] GFOA city expenditure dashboard: https://www.gfoa.org/expenditure-dashboard-cities
- [S8] Arizona recall: https://www.inmaricopa.com/recalling-elected-officials-in-arizona-and-maricopa/; Wisconsin §9.10: https://docs.legis.wisconsin.gov/statutes/statutes/9/10/2/l
- [S9] Portland State "Who Votes for Mayor?": https://knightfoundation.org/articles/portland-state-study-seniors-much-more-likely-cast-ballots-young-votes/
- [S10] Fischel, The Homevoter Hypothesis: https://papers.ssrn.com/abstract=294711
- [S11] Healy & Malhotra 2013: https://web.stanford.edu/~neilm/voting.html; Bartels: https://www.princeton.edu/~piirs/events/Bartels_paper.pdf
- [S12] Freier 2015: https://research.hhs.se/esploro/outputs/other/Incumbency-as-the-major-advantage/991001480640906056; de Benedictis-Kessner: https://harvard.academia.edu/JustindeBenedictisKessner
- [S13] Kalla & Broockman 2018, APSR: https://www.cambridge.org/core/product/753665A313C4AB433DBF7110299B7433
- [S14] Gerber, Gimpel, Green & Shaw 2011 (J-PAL): https://www.povertyactionlab.org/evaluation/persuasive-effects-televised-campaign-ads
- [S15] Green et al. 2016, lawn signs: https://isps.yale.edu/research/publications/isps16-23
- [S16] Green & Gerber, Get Out the Vote (summary): https://www.philanthropy.com/news/cost-of-door-to-door-canvassing-is-19-per-vote-research-finds/
- [S17] DellaVigna & Kaplan 2007: https://eml.berkeley.edu/~sdellavi/wp/FoxVoteQJEAug07.pdf
- [S18] US 2020 Facebook & Instagram Election Study: https://csmapnyu.org/impact/news/first-four-papers-from-us-2020-facebook-instagram-research-election-study-published-in-science-and-nature
- [S19] Bond et al. 2012, Nature: https://sparq.stanford.edu/sites/g/files/sbiybj19021/files/media/file/bond_et_al._2012_-_a_61-million-person_experiment_in_social_influence_political_mobilization.pdf
- [S20] Doherty, Gerber & Green 2006: https://isps.yale.edu/research/publications/isps06-006; Ethiopian housing lottery: https://nhh.no/en/departments/economics/news-archive/2023/does-wealth-reduce-support-for-redistribution/
- [S21] Margalit 2013, APSR: https://ideas.repec.org/a/cup/apsrev/v107y2013i01p80-103_00.html
- [S22] Big Five and ideology meta-analysis: https://pmc.ncbi.nlm.nih.gov/articles/PMC6867614; DIW German panels: https://www.diw.de/de/diw_01.c.796943.de/s_12001.html; Czech study: https://dspace.cuni.cz/handle/20.500.11956/196519
- [S23] IMF WP/24/34 (Powell & Thyne data): https://www.imf.org/-/media/files/publications/wp/2024/english/wpiea2024034-print-pdf.pdf.md
- [S24] Goldstone, Revolution and Rebellion: https://www.routledge.com/products/9781138222113; applied stress indicator: https://apps.dtic.mil/sti/tr/pdf/ADA493641.pdf
- [S25] Chenoweth, 3.5% rule: https://www.transcend.org/tms/2019/05/the-3-5-rule-how-a-small-minority-can-change-the-world
- [S26] 1914-1918 Online, Dual Power: https://encyclopedia.1914-1918-online.net/article/dual-power/
- [S27] Salami tactics: https://content.time.com/time/subscriber/article/0,33009,857130,00.html; Mazower caveat: https://johndclare.net/cold_war6_nosalami.htm
- [S28] Bermeo 2016, On Democratic Backsliding: https://www.journalofdemocracy.org/articles/on-democratic-backsliding/
- [S29] Przeworski threshold (summary): https://inequality.hks.harvard.edu/file_url/382
- [S30] Absolute priority rule: https://www.wallstreetprep.com/knowledge/absolute-priority-rule-apr-priority-of-claims-waterfall/
- [S31] Uniform Probate Code: https://britannica.com/topic/inheritance-law/Uniform-Probate-Code-U-S; Massachusetts intestacy chart: https://www.mass.gov/doc/intestacy-chart/download
- [S32] Land Act of 1820: https://en.wikipedia.org/wiki/Land_Act_of_1820; Homestead Acts: https://en.wikipedia.org/wiki/Homestead_Acts

Also from general knowledge, not re-checked online: Todorov et al. 2005; Gerber, Green & Larimer 2008; Erikson & Wlezien 2012; Chiang & Knight 2011; McCombs & Shaw 1972; Sethuraman, Tellis & Briesch 2011; Shapiro, Hitsch & Tuchman 2021; Lewis & Rao 2015; Converse 1964; Granovetter 1978; Kuran 1991; Levitsky & Ziblatt 2018; Moody's recovery averages; Gallup 2021 (wills).
