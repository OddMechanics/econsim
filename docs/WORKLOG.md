# Worklog (for Claude: progress notes during long sessions)

## 2026-10-22 night: v0.2 "City" rewrite

User asked (end of day 1): big city with everything + rural outskirts; cars; less grid; see things happening;
short nights; people more detailed with limbs, entertaining to watch; jobs with computers; watch conversations;
view their internet; fix instant hire/fire; sidewalks/streets; restaurants, shipping, stores, corporations;
apartments/rent/houses/commuting by car. Work overnight, unattended (no questions).

Backup of v0.1: `/Users/juliankopf/10%/econsim-v01-backup/`.

### Plan
- sim (Claude writes): types.ts, goods.ts (all defs), layout.ts (interior stations), roads.ts (road graph + lots + growth + routing),
  world.ts, config.ts, ctx.ts (accounts: pay()), names.ts, then people, buildings, market (exchange w/ order.site),
  firms, jobs (contracts w/ probation+notice), production, logistics (shipments, vehicles), housing (rent),
  construction (contracts), social (dialogue), internet (posts), ai, tasks, stats, sim, save.
- render (delegated to 3 background agents, each owns its files):
  - people.ts + vehicles.ts + palette.ts (dev/people.html)
  - buildings.ts (dev/buildings.html)
  - terrain.ts + roads.ts (dev/roads.html)
- then Claude integrates: renderer.ts (scene, camera, lights, picking, day/night), ui (inspector, firm view, internet browser, conversations), main.ts (night time warp).

### Status
- [x] types/goods/layout/roads/world/config/ctx/names written; core typechecks (tsconfig.core.json)
- [ ] remaining sim modules
- [ ] integration

### Progress (night of 2026-10-22, ~01:00)
- All sim modules written (people, buildings, market w/ order.site, firms, jobs w/ probation+notice, production
  (roles: stations, gatherers walk out, drivers w/ trucks, builders + hauling), logistics, housing (rent), construction
  (contracts), social (dialogue lines), internet (posts), finance (banks, loans create money), ai, tasks, stats, sim, save).
- Roads: master street plan (irregular grid) built as the city grows (`roads.plan`), lots w/ shallower fallback.
- Render agents done: people.ts/vehicles.ts/palette.ts, buildings.ts (+bank added by Claude), terrain.ts/roads.ts.
- Integrated renderer.ts (lighting, glow at night, cutaway, bubbles, picking), ui.ts (tabs incl. Companies/Talk, inspectors
  for person/building/firm), ui/internet.ts (Townnet browser), main.ts (night time warp 8x).
- Fixed: founders starving, build-finish bug, sleep at 21h, hut runaway, plan-retry thrash (cooldowns), restaurant loop.
- Tools: scripts/headless.ts (daily summary), diag.ts, probe.ts, deaths.ts, roadtest.ts.
- Open issues: employment low (people fish), cars appear late, deaths ~10%/100 days, perf ~3s/day at 250 pop (node).

### Progress (night of 2026-10-22, ~04:30)
- Added: banks + loans (money creation), outside traders (exports/imports), freelance couriers, trucks for depots/yards,
  car purchases (from factories, car loans), land market, hut abandonment, master street plan with straight avenues
  from the ring, payroll reserve + progress billing + payroll/material loans, sector caps, plan cooldowns,
  findResource cache (sim ~2.3x faster).
- Key bug found late: first bank's building needed bricks; brickworks needed a loan -> banks now lend from founding.
- Verified: 3 seeds x 100 days healthy (280-330 people, few deaths); browser screenshots of downtown, street level,
  cutaway interiors, Townnet, Talk, night; `npm run build` ok; no console errors.
- Next ideas: wage negotiation, tiny NNs, fewer/larger firms (mergers/acquisitions), government (taxes, roads),
  more downtown height, performance (Web Worker).
- (~05:00) Added tiny per-person neural nets (src/sim/brain.ts) + "Learned habits" in the inspector; taller towers with population.

### 2026-10-23: user hadn't seen multi-story buildings
- Cause: they only appeared after day ~40-55 and some worlds stalled for weeks (no sawmill/brickworks founded;
  brickworks needed planks; developers ran out of cash mid-tower).
- Fixed: chooseFloors (taller downtown), brickworks from raw materials, site needs count as demand, yards wait for
  material makers, construction loans for deposits and materials, faster upper floors. scripts/floors.ts tracks it.

## 2026-10-23 day: v0.3 "Polity" (user away, no questions; record all defaults in PLAN.md)

User asked: realistic pay (workers never in the richest 30), greedier people who want money and things, urban density
(~1000 people, "not a random town in wyoming"), land always owned (no claiming), realistic bankruptcy, a company
passes to the next in line when its owner dies, limits on what one person can build, LOD detail ("cups on tables"),
CC0 people, ads (posters, billboards, lamp flyers), a government that builds streets, offices, campaigns, speeches,
TV debates, elections, districts, rules that can change (communism, coups, 2–3 rival governments), a political
compass (not random, influenced by TV, Net and social media), the Net with websites as companies, "city" not "town",
arrow keys, and a movie-like follow camera.

Research notes: docs/research/politics.md (core idea: a government is an organization like a firm, with a charter
as data, a territory claim, officials, a treasury, enforcers, and per-person recognition).

### Design (decided by Claude)
- **Accounts.** A government (Polity) acts through its administration Firm (`firm.gov = polity id`); the
  treasury is that firm's cash. Public land is owned by that firm. Outside every claim, land belongs to "the
  Territory" (id −3, an outside land office; money paid to it leaves the economy).
- **Start.** A regional highway already exists (built by the outside world). The settlers arrive as an organised
  colony and hold a founding assembly on day 1 (at the square). The charter options are voted on from their
  political compasses. The new polity claims city limits (a cell set, 50 m cells), which can be bigger or smaller
  than where the city actually ends up. It lays out the first streets as dirt tracks; settlers buy lots from the
  land office (treasury revenue) and build huts.
- **Streets.** The government lays out streets (survey = dirt track, lots created, sold by auction/at the
  reserve price) and paves them (a public-works project: a road crew of government builders plus stone).
  Unbuilt = dirt: walkable, slow to drive. No government means no new streets.
- **Land.** `lot.owner` is never −1. Land office: new lots go to auction (1 day), unsold ones sell at the reserve
  price. Assessed value comes from zone, distance and recent sales. Property tax uses the assessed value.
- **Estates.** On death: debts first. A will (p by age and diligence) names the closest relation as heir.
  Otherwise the estate escheats to the polity controlling the location, which auctions it. Firms pass to the
  heir; without one, the firm is auctioned as a going concern (staff kept).
- **Bankruptcy.** A creditor files after 7 days of missed payments. Going-concern value vs liquidation (×0.6)
  decides between reorganisation (the bank takes the equity and sells the firm) and liquidation (asset auctions,
  absolute priority: bank, wages, taxes, others, owner). Personal foreclosure: the bank seizes the house and
  auctions it.
- **Wages.** Base multipliers by role, with education requirements: manager, programmer, presenter, official
  need more schooling. Cost of living targets: rent ~30%, food ~15%. Greed: utility for income and wealth by
  ambition, happiness from possessions (phones, TVs, cars, furniture, clothes, a better home).
- **Build limits.** Persons self-build only huts and small houses; everything else goes through construction
  firms. One active project per person; firms are limited by yard capacity and credit.
- **People.** New fields: born (age), edu (years), origin, agreeable trait (openness = curiosity), pol
  (econ/auth in SD units, base anchor, issue tilts, party, engagement, recognition per polity, awareness per
  candidate/brand, media diet, persuasion with decay).
- **Elections.** Turnout logit and vote logit from the research notes. Districts are cell sets, redrawn by
  whoever has the power (pack/crack if partisan). Methods: plurality, runoff, party-list PR. Campaigns:
  declare 14 days before, ads, speeches at the square (crowds), canvassing, TV debates. Election day:
  people walk to the polling place.
- **Council.** Weekly session at city hall. Motions on taxes, budget, roads, land, welfare, police, rent cap,
  height limits, election dates, charter amendments, annexation, nationalisation. Members vote by utility
  (ideology + re-election + self-interest). Everything goes into the Gazette.
- **Regime.** Recognition drift. Protests with threshold cascades. Revolution (3.5% participation plus police
  defection). Coup hazard. Backsliding moves. Secession petitions. Rival governments (dual power: taxes go to
  whoever is recognised). Communist programme (nationalise firms over N staff and banks, rent cap, price
  controls cause shortages, liberalise when shortages last).
- **Media.**
  - Ads: posters, billboards, lamp flyers, TV and Net ads. Exposure raises awareness, a little persuasion with
    a 3-day decay, and brand choice.
  - TV: studio firms with a slant; hourly broadcasts generated from real events (news, debates, talk shows);
    people watch at home on a TV.
  - Net: netco firms run sites (social, news, search, classifieds, video, forum) with accounts and network
    effects, feeds (chronological, engagement or friends) and ad revenue. Townnet is renamed "Net".
- **New goods:** phones, tvs (from electronics).
- **Visuals** (3 background agents, own files):
  - CC0 people LOD: people.ts and characters.ts.
  - Buildings, props and ads: buildings.ts, props.ts, ads.ts.
  - Camera and streets: camera.ts, render/roads.ts, sim/street.ts (lamp spots shared with the sim for flyers).

### Progress (2026-10-23 evening)
- New sim modules:
  - ideology.ts: compass, stances, drift, persuasion.
  - government.ts: polity, territory cells, land office, taxes, welfare, staff, paving, city hall, Territory roads.
  - council.ts: sessions, motions, votes, decrees, appointments, amendments, backsliding.
  - elections.ts: franchise, districts with gerrymandering, nomination, turnout and vote models, list PR, runoffs, referendums, parties, campaign money, polls.
  - regime.ts: grievance, recognition, protests with cascades, revolution and dual power, coups, new towns incorporating, foundingCharter.
  - civic.ts: speeches, rallies, debates, canvassing.
  - media.ts: ads (posters, billboards, lamp flyers, TV and Net slots), exposure, TV channels and broadcasts, Net sites, feeds, posts.
  - estate.ts: auctions, wills, escheat, bankruptcy (reorganize or liquidate), foreclosure, tax sales.
  - hooks.ts: onFinished registry, which fixes circular-import load order.
- The town square became the outside traders' trading post. Main Street is the pre-existing highway (Route 9).
  Plaza and park are government-built kinds.
- Land is always owned (Territory id −3, or a government's admin firm). Unbuilt roads are dirt tracks
  (built=false, progress = paved share).
- Wages are role-based (ROLE.pay, ROLE.edu). Income, sales and property taxes. Big buildings need a
  contractor (builder −2 = waiting). Zombie firms close and their property is auctioned.
- Wild food regrowth was cut so subsistence feeds about 60 people, not a city (fish 0.1, forage 0.2).
- Bugs fixed:
  - A truck driver's return-to-depot loop re-routed every minute (20% CPU).
  - Government crews were idle because the site firm was the trading post.
  - Fractional food couldn't be eaten.
  - People kept walking to stores with no staff.
- UI:
  - ui/net.ts (Net browser: portal, sites by kind, gov site, classifieds, auctions).
  - ui/tv.ts.
  - ui/politics.ts (compass SVG, person politics, Gov tab with polls).
  - ui.ts integration. Townnet removed.
- Scripts: scripts/politics.ts (politics diagnostics). The headless summary prints politics and media every 10 days.
- Open: no phones/TVs yet in 120-day runs (gadget valuation just changed). Treasuries run near empty (welfare budget
  cap just added). Housing sprawl (houses are now suburb/rural only and cost more). Perf ~0.27 s/day at 200
  people (node). Visual agents still running.

### Progress (2026-10-23 night)
- Camera/streets agent done: camera.ts (free/follow/cinema/walk, letterbox, captions), dirt tracks and paving crews in
  render/roads.ts, sim/street.ts (lamps + furniture, shared with flyers). Integrated in renderer.ts (their diff + manual
  hunk). UI: 🎬 Cinema button, Limits (city limits + districts overlay), mode callbacks.
- Buildings agent done: city hall/studio/netco/trading post/plaza/park models, interior props near camera, exterior detail,
  far LOD chunks, ads.ts (posters/billboards/flyers/banners with generated designs). Integrated (AdRenderer, ad picking ->
  sponsor, trading post enclosed).
- People agent still working (close-up CC0 characters); reported bug: detailed character invisible close up (shadow only).
- Fixes: terrain bush/ore blobs had subdivisions 0 = Babylon default 4 (8.7k verts per bush) -> octahedra; drivers
  return-to-depot loop; council double seats; overlapping town claims; hooks moved to hooks.ts (circular-import TDZ).
- Economy: investor newcomers (10–20% bring 800–3400 + schooling), export demand for manufactured goods scales with the
  city, trading post counter margin for individuals (to sellers), store restocking credit, builders borrow against
  receivables and grow crews (no extra yards), stuck projects downsize then cancel, developers check vacancy/rent,
  emigration of the hopeless, day labor at the trading post, cheaper electronics (phones/TVs spread), gadget values by
  income, officials' pay scaled, founding taxes ~6%/3%/1.5%, gov buys stone at market, permits, street layout only on demand.
- Typical (seed 4): day 160 pop ~425, ~236 jobs, ~150 renters, TV channel + social network, few deaths; richest 30 = owners.
- Perf: 1000 people ~2–3 s/game day (node); production build in browser ~3 game days/s early, ~1/s at 350 people.

## 2026-10-24: gender-neutral people
- The user asked for gender-neutral people: one neutral, minimalist look, from an existing asset (not one Claude makes).
- Replaced the Quaternius modular men/women characters with the faceless CC0 mannequin from the Universal Animation Library.
  - It is slimmed toward the bones (it was sculpted like a bodybuilder) and its knuckle spheres are low-poly now (13.7k -> 6.9k tris per person; people.glb 1.6 MB -> 0.65 MB).
  - Clothes are palette zones per triangle.
- One rig, no sex/rig index in the renderer.
  - Clips are retargeted straight onto the mannequin, so the runtime has no leg-ratio rescaling.
  - Hard hats are a tinted prop.
  - The far figures lost their face (eyes, mouth, nose, ears) and hair.
- Build: `python3 -I scripts/people-assets/build_people.py <dir with M_Casual_2.glb> <UAL .gltf> public/models/people` (sources and mirrors are listed in LICENSE.txt).
- Checked in dev/people.html: all poses and outfits, pick test 165/165, 156 detailed people at 60 fps.
  - The main game could not be checked: the sim was mid-edit by another session (building kinds renamed; sim.ts still creates 'square'/'hut').

## 2026-10-24: v0.4 "Metro" (modern city: no trading post, towers, ads, the Net, 3,000 people)
- User asks: more ads (companies must earn money; ads on social networks), the Net doing more (all of: shopping/delivery,
  jobs/homes, gig apps/creators, banking/payments/government services, anything), population ~3,000, modern downtown with
  skyscrapers, no trading post / nobody foraging. Start: empty land + modern settlers (trailers, savings, phones).
- Sim (lead):
  - market.ts: wholesale order book without a place (firms + OUTSIDE only, GATE site); contacts.ts (who knows whom).
  - logistics.ts: outside trucks/vans with trips from the highway gate; home deliveries.
  - online.ts: orders, delivery/ride apps, gigs, crowdfunding; advertising.ts (budgets, ad companies, screens, columns, wall
    ads, sidewalk panels, online ad pools with targeting, influencers, sponsored posts).
  - leases.ts: shops and office suites in towers; development.ts (developers, tower demand, redevelopment); rezoning.
  - New goods concrete/glass, kinds trailer/tower/officetower/claypit/cementworks/glassworks/adco/shopfront/suite, sales role.
  - Outside chains (QuickStop at the founding, FreshMart, Burger Barn, Pizza Palace, AutoNation, Metro Outdoor,
    First National Bank when credit is tight); bank accounts and deposits; welfare claims (online or at city hall);
    soup kitchen; service exports (offices, software).
- Economy debugging, in order: starvation (store couldn't restock: managers didn't know import prices; ordered groceries
  blocked store trips; leftovers uneatable); founders spent working capital on buildings (construction loans secured by
  the building, startup working capital); only one bank at its limit (outside bank chain); exports never matched waiting
  offers; local drivers grabbed outside shipments (stuck 'loaded'); low productivity (machine-level recipes); outside
  demand caps (raised: price-taker); sprawl (houses dearer, BUILD_SCALE 1.5); no towers (downtown too small -> zones grow
  with population; height limit applied downtown -> neighborhoods only; tower demand; redevelopment).
- Perf: per-minute caches (labor sites, gig workers, parcels, vacancies, people inside buildings, demand); walks on streets
  instead of wild A*. Synthetic 3,000 people: ~3–4 s per game day (node).
- Helpers: architecture (modern towers etc., in progress), ads/liveries (done: screens, columns, vacant spaces, vans), UI
  (Net pages, inspector, Trade tab; in progress).
- Later the same day:
  - Bugs reported by the UI helper, fixed: double hiring in one pass; restaurants priced below cost; broke ad companies (now
    borrow for structures); internet companies in leased offices never launched their site (leasing now fires the
    building-opened hooks).
  - Food safety net: soup kitchen for people under 20 money; at night for the starving; a charity kitchen when there's no
    city hall; affordable partial online orders. Public building sites are never abandoned, and a lost city hall is rebuilt.
  - Parking beyond a few cars goes to the street, then an underground garage (long rows of cars in fields).
- User request mid-turn: "let government inspection show borders". The Gov tab, city hall or administration selection shows
  that government's territory (flag-coloured wall + tint + districts); the panel has a "zoom to the borders" link.
- Results (headless): seed 4 day 165 = 2,584 people, 1 death, 16 towers; seed 11 day 151 = 2,782 people, 1 death,
  32 towers. Production build OK; app runs without console errors.
- Fix (reported by the user): detailed characters rendered inside out. You saw the inside of the far side, e.g. a person's tie from behind. buildGeometry flipped the triangle order on top of the x mirror; the mirror alone already turns glTF's counter-clockwise fronts into Babylon's clockwise ones. This bug predates the mannequin: the old modular characters had it too.

## 2026-10-24 (later): cars on roads, speed modes, 10,000 people, office towers, TV
- User asks: cars clip through houses and drive across lots; towers with hardly anyone in them; more people ("10,000 if it
  works") with speeds that draw nothing or only buildings and jumps to a time of day; "no 3D can run much faster", "can't go
  as fast in 3D but way faster without"; "watch the people's television".
- Cars: drive routes end at the curb (`curbAt`), cars park along the street (`curbSpot`, 6 m apart) then underground;
  depot/yard trucks in the yard; cabs pick up at the curb.
- Speed modes (main.ts + ui.ts): Skip menu (to 7/12/18/24 h, +1 day/week/30 days; flat out, progress box, Stop, a 3D
  glimpse each second), View menu (full / buildings only / no 3D), 3D capped at 1h/s, Max = no 3D. `sim.stride` 5 → 15
  while nothing is drawn.
- Perf (2,400 people: ~11 s → ~4 s per game day; synthetic 7,000: 32 s → ~20 s):
  - batching browse/phone/TV/audience steps;
  - cooldowns: housing (`homecheck`), business, development, failed gigs;
  - route cache per street pair (cleared when roads change);
  - contracts indexed by site (`staffAt`/`hasStaff`);
  - hourly market snapshot for business choices (`bizClimate`); hourly development sites (`devSites`);
  - gig counts; feed posts per site; online-ad weights once per visit;
  - steady people get a wake tick (symbol keys, not saved) instead of a per-minute check.
- Bugs found while profiling (people re-deciding every minute): stale `projectId` after a building was torn down (now
  cleared on removal and when finished); cab drivers whose car was down the street (they walk to it now). Starvation
  regression traced to the arrivals change counting openings (reverted to postings) and a store stock-out trap (order 4×
  sales after selling out); soup kitchen also serves anyone starving.
- Office towers: service exports split into software and professional markets (500 + 8 × pop each), the price falls for
  everyone when oversold (it used to stop billing at a cap → afternoon losses); internet companies hire by demand (they
  filled every desk). Test city: tower office staff 290 → 673, floors leased 103/133.
- TV (tv.ts rewritten): a screen with title cards, the speaker as the faceless figure (skin tone, shirt) + caption, ad spots in the
  advertiser's colors, ticker, color bars off air; "📺 Watch with them" in the person inspector (follows their channel,
  homes tuned in, their reaction).
- Two starvation deaths in a validation run: homeless people at night skipped the soup kitchen (the night penalty applied to
  it); exempted. The TV figure was made faceless and hairless like the city's mannequins (see neutral-people).
- Results (headless, day 220): seed 4 = 4,179 people, 2 deaths (before the night fix), 27 towers; seed 11 = 4,661 people,
  1 death, 21 towers; 2 homeless each. Production build OK; browser tests of Skip/View/Max/TV without console errors.
- User question: "why would Liberty Web build a residential tower". Cause: maybeExpand put any profitable company's spare
  cash into property (planDevelopment). The user: "nobody should be forced to build a tower… if a company wants to build a
  tower they can do it but it isn't 'spare money goes to building towers'"; the aim is an urban city, not towers as such.
  Now: own trade first (diversify/expand split into functions), property last and only when yield × trade knowledge
  beats the boss's hurdle (`considerProperty`); people's development choice scored by yield (`DevPlan.yield`).
- People only know some places (user: "okay implement that", after asking what it would look like). New `places.ts`:
  per-person lists (`Person.places`, `KnownPlace`) with caps by kind. Sources: noticed near home/work and along the
  commute, visits, conversations (`sharePlace` adds a chat line: tips, warnings, "my work is hiring"), ads (`seeAd` →
  `heardOfFirm`), searches (`searchFor`: top 5, advertisers first). Places fade; opinions come from visits.
  ai.ts choices (groceries, eating out, delivery, durables, cars, jobs, flats, parks) read the lists; safety nets
  (`askAround`, look cooldowns). Inspector: "Places they know"; company: "Known by". Also cached the average wage in
  personDaily (it summed all contracts per person).
- Results with known places (headless, day 200): seed 4 = 4,240 people, 0 deaths, 0–1 homeless, 20 towers; seed 11 =
  4,546 people, 0 deaths, 22 towers. Speed about as before (~5 s per game day at 2,400 people). Browser: inspector
  sections render, no console errors.
- Open issue found while checking the tower change: rental yields come out at ~200–600% "a year" (120 days), because
  building is very cheap compared with rents. Real buildings earn ~5–8% a year. To discuss with the user.
- Population limit (user asked "how high can the population get now"): a synthetic 10,000-person city ran ~40 s per game
  day, a 120 MB save (0.9 s to write), ~600 MB of memory; estimate ~10–15k in the browser.
- Faster growth (user: "make the population grow quicker"): arrivals count open positions (not hiring employers), base 4/day,
  cap 40 + pop/20; a housing brake (homeless share). Day 120: 2,490 / 3,031 people, 0 deaths (before 2,225 / 1,643).
- The project is on GitHub: `git@github.com:OddMechanics/econsim.git` (branch `main`, first commit b30c762). Standing rule
  from the user: commit and push after every round of edits.
- Statistics window (user: "make way better statistics… graphs… also markets"): `recordDaily` + `tally` in stats.ts
  (DailyStat per game day; hooks for spending, trade, wages, rent, leases, construction, companies, buildings, government
  books); `statcharts.ts` (time charts: lines/stacked/area with readouts, end labels and table views; bar lists; columns;
  order-book depth; sparklines) and `statsview.ts` (8 sections, time-range filter). Colors validated (dark surface).
  The charts showed a bug: the resident dividend counted itself as spending and paid only every other day (fixed).
- More statistics (user: "more detailed… all company earnings… a political compass with everyone's dot"; "make it way easier
  to track politics… election ads"; "make ads more sophisticated"): `statspolitics.ts` (Politics: elections at a glance,
  polls, campaign ad wall, compass with party/wealth/work coloring, group leanings, trends, results; Advertising: channel
  effectiveness, advertisers and budget splits, ad spaces). Companies: every company's earnings (search, sector filter,
  30-day sparkline), ranked profit bars, profits by sector. People: wealth shares, richest, wages by sector, jobs by role.
  Sim: DailyStat gains politics, profits, wealth shares, polls; Firm.hist (60 days); ad impressions/conversions by
  channel with learned budget splits, audiences, saturation; campaigns with polls, swing targeting, attack ads (Politics.neg,
  votes), turnout boost; `s.adLog`.
- Bug reports from the user: leased floors looked empty (3D only drew people when the exact unit was selected; firm
  selection never opened buildings) and some really were (software firms held at zero staff; idle leased units kept).
  Fixed both. "The richest person is digging clay": owners' own-work ignored the value of money; fixed (wealthy owners
  hire/oversee; early retirement).
- User: rich people still took small jobs; screens with few ads showed "Advertise here"; the world and the side panel
  flickered. Fixes: `cushionDays` gates side work, manual job search and keeping a manual job (ai.ts); screens rotate booked
  ads only (render + exposure); camera near plane follows the radius; `gradeLot` levels lots (terrain mesh follows via
  `world.hver`); `morph.ts` patches panels in place (side panel, inspector, Net, TV, statistics with delegated clicks).
- More minimalist (user: "could have way less triangles"):
  - Each mannequin piece is simplified by quadric edge collapses in build_people.py (no new dependency). Surviving vertices keep their position and weights, and vertices on open piece edges are locked, so no holes open.
  - The finger joint balls are dropped and the head keeps a bigger share so it stays round.
  - ~1,070 tris per person (was 6.9k), people.glb 0.13 MB. Clothes follow body regions: tee = torso + upper arms; suit = jacket with white collar and cuffs on the joint balls; hi-vis band = chest ball; shorts = pelvis + thighs.
- Food variety (user: yes to recommendations; countryside next): goods produce/milk/livestock/bread/dairy/meat, kinds
  vegfarm/dairyfarm/ranch/bakery/dairyplant/meatplant (3D uses farm/food-plant looks for now), EDIBLE/SPOIL/foodIn/takeFood,
  food baskets (ai.ts foodBasket, shop step `list`), variety-aware eating and diet happiness, restaurant meal mix, save
  upgrade (save.ts `upgrade`). 30-day check: 0 deaths in two worlds.
- Countryside (stage B + basic 3D): MAP −2000..4000 (config MAP/COUNTRY); world.ts inGrid/onLand/beyondGrid/kindAt/fertilityAt and
  heightAt beyond the grid (countryHeight); territory cells cover the whole map (government.ts cellOf, save.ts remaps old cells);
  roads.ts addLotAt/layHighway (Route 9 around lakes); countryside.ts generateCountryside (highway, lanes, villages, farmsteads,
  farm families, village shop/pub), countryDaily (own produce, lodging, leaving for the city, farm arrivals); ai.ts decideCountry;
  places.ts countryPlaces; sim.ts stride ×3 for rural, cap on city pop; ctx.ts cityPop used for city-size formulas; farmhouse kind;
  render: terrain buildOuter rings on heightAt to the map edge + field colors (renderer countryFields). Checks: 30 days seeds 4/11
  0 deaths; old 4,257-person save loads (countryside laid out in 66 ms).
- Health (stage D): health.ts (ILLNESS/HEALTH, healthDaily onset/course/contagion/immunity, bills, clinicMinute,
  hospitalMinute, awayMinute = ambulance to the regional hospital, public hospital), types Illness/Person.ill/Policy.healthcare/
  steps clinic|hospital|away/PlaceKind care, clinic + hospital kinds and doctor/nurse roles (layout stations), ai.ts healthOptions
  (+ call in sick), firms staffing/prices/chains (CityCare, Mercy Health; doctors brought in), newcomers can be doctors/nurses,
  council motions health/hospital, founding charter sets healthcare, stats sick/patients + Health chart, person panel illness.
  Fixed maxFloorsAt cell lookup and a redistrict crash.
- Countryside & health visuals (stage C, helper): natureKit/countryNature (TreeLod: detailed trees near the camera,
  cheap stand-ins far; countryside woods and rocks from kindAt), fields.ts (fields, farmyards and lawns cut from the
  outer ground mesh: crops, rows, fenced pastures with CC0 cows/sheep, hedgerows, tractors, ambulances), farms.ts (four
  farmyard looks + farmhouse), foodplants.ts, health.ts (clinic, hospital with H signs and emergency bay), seamless
  grid edge in terrain.ts; people away at the regional hospital aren't drawn. Assets: public/models/country (Quaternius
  farm animals, Kenney car + nature kits, all CC0; LICENSE.txt). Frame times measured equal or lower in every view.
