# Economy Simulation: Design Plan

This is the single source of truth for the project. It records every design decision made so far, the reasoning behind it, what is being built first, and what is still open.

- **Started:** 2026-10-22
- **Status:** v0.4 "Metro" built 2026-10-24 (see section 0). v0.3 "Polity" (section 0a, backed up in `../econsim-v03-backup/`) built 2026-10-23. v0.2 "City" (section 0b) built overnight 2026-10-22/23. v0.1 is backed up in `../econsim-v01-backup/`.
- **Read this first** if you are picking the project back up (human or Claude).

Contents:

0. Current state: v0.4 "Metro" (read this first); 0a. v0.3 "Polity"; 0b. v0.2 "City" 
1. Vision
2. Decisions so far
3. Innovation without a tech tree
4. Proposed product list (for you to edit)
5. Architecture
6. v0.1 "Foundation" scope
7. Defaults I chose without asking (please review)
8. Roadmap
9. Open questions for later
10. Glossary

---

## 0. Current state: v0.4 "Metro"

What you asked for after v0.3 (2026-10-24):
- "I don't see many ads here"; "there should definitely be more ads because the companies have to earn money"; "in real life you would probably see ads on a social networking site";
- "make the internet be able to do more things": you picked all of shopping and delivery, jobs and homes online, gig apps and creators, banking, payments and government services, and "anything";
- "make the population bigger": you picked about 3,000;
- "bigger buildings or even skyscrapers, not some old fashioned apartment building": you picked a modern downtown (glass office towers, residential towers, mid-rises with shops at street level);
- "there shouldn't be anything the equivalent of a trading post"; "no rich person who owns a logistics company forages berries to sell": you picked "empty land, modern people" as the start.

### What's new
- **No trading post, no foraging.**
  - The wholesale market isn't a place any more: it's companies' offers and orders, made by phone, sales reps and business websites. Only companies (and governments) trade there.
  - People buy in shops and online, and earn money from jobs, their own businesses, gig apps and day labor. Nobody gathers, fishes or sells raw goods by hand.
  - Logging, quarries, clay pits and mines are companies with crews and machines.
- **Companies only trade with companies they know of** (`contacts.ts`): their bosses' acquaintances, ads their bosses noticed, sales reps (a new job), a search engine (sponsored results first), word of mouth, and past deals. Outside suppliers are always reachable.
- **The rest of the world is real.**
  - Outside suppliers sell any good, delivered by their own truck from the highway, at the world price plus 30%, arriving next morning-ish.
  - Outside buyers take what the city makes at 85% of the world price and send trucks. A small city is a price-taker: it can sell about as much as it makes.
  - Office work is exported too: consulting firms and internet companies bill clients elsewhere.
  - Outside trucks and vans are real vehicles on the roads, with brand liveries.
  - Outside chains open local branches when the city lacks something: QuickStop (from day 1), FreshMart, Burger Barn, Pizza Palace, AutoNation, First National Bank (when credit runs short). Each is run by a manager hired locally, and its profits leave the city.
- **The start.**
  - Fifty settlers come with their trailers and savings (most have phones) and hold the founding assembly.
  - Valley Regional Construction opens a branch to build the city; its first job is the city hall, where meetings and votes are held on the building site until it's done.
  - The richest settler opens a bank. Everything else is bought online from outside until local shops open.
- **Construction.**
  - Everything is built by construction companies (trailers come on a truck). Tall buildings need a big contractor.
  - Companies finance buildings with construction loans secured by the building, and borrow working capital against it.
- **Towers and leases.**
  - Residential towers (10–60 floors) have shops on the ground floor. Office towers (8–70 floors) have a leasable office suite on every floor.
  - Shops and office floors are buildings of their own inside the tower (`host`, `level`), leased to companies (`leases.ts`).
  - Developers (`development.ts`) pick the kind and height from demand, land price, their money, the city's height limit and the contractors available. They also buy small old buildings on dear land and tear them down to build higher.
  - Downtown and the inner city grow with the population (rezoning).
- **New materials and plants.** Concrete (cement works) and glass (glassworks), plus clay pits. Buildings now use concrete, steel and glass.
- **Ads** (`advertising.ts`).
  - Companies spend a share of their sales on ads.
  - **Outdoor ad companies** (a new business) own billboards, LED screens on downtown towers (several ads rotating), ad columns, big wall ads on mid-rise side walls, and lit sidewalk panels. They rent them out by the week and pay the spot's owner. Empty spaces say "Advertise here".
  - Everyone also puts posters on their own walls, and new businesses hang a "Grand opening" banner.
  - **Online ads** are sold by the city's websites by audience and targeted: near you, things you need, candidates close to your views. Sponsored posts and influencers' #ad posts appear in social feeds, and search engines show sponsored results.
  - TV ads continue. Political campaigns buy targeted online ads.
- **The Net** (`online.ts`, `media.ts`).
  - Sites are launched for whatever the city lacks and could pay: social, search, a marketplace, a job board, home listings, news, a food-delivery app, a ride-hailing app, classifieds, a payments app, crowdfunding, video and a forum.
  - **Shopping:** people order groceries and things online from local stores or outside retailers, delivered to their door by logistics companies, gig couriers or outside vans.
  - **Food and rides:** meals come through the delivery app. People without a car hail rides (the driver gets most of the fare).
  - **Gig work:** anyone with a phone can deliver; anyone with a car can drive for the ride app.
  - **Jobs and homes:** job boards and listings let people find work and flats online.
  - **Money:** a payments app takes a small fee. Crowdfunding lets people back new businesses.
  - **Influencers:** popular posters gain followers, and companies pay them.
- **Safety net.** A soup kitchen at city hall feeds the broke: the city pays if it pays welfare, otherwise a charity funded by the rich. People out of work and out of savings move on.
- **Modern buildings in 3D:** glass towers, residential towers with balconies, modern mid-rises, trailers, new industry, and tower cranes on high-rise sites. Done by a helper; see the files under `src/render/`.

### Defaults chosen in v0.4 (please review)
59. **Start:** 50 settlers with savings of 150–2,600 (skewed low); 88% have a phone. Each gets a lot with a trailer. The founding fund is 4,000.
60. **Trade with the world:** imports cost world price × 1.3, arriving 5–14 hours after the order (outside trucks run 6:00–22:00). Exports sell at world price × 0.85. Outside demand per good per day: 300–1,500 × (1 + population/300) for manufactured goods (× its square root for raw ones). It's set high on purpose: a small city is a price-taker and can sell about as much as it makes.
61. **Online shopping:** outside online retailers charge world price × 1.75 (cars × 1.25) plus a delivery fee of 2.5. Local web-shop delivery costs 1.5. The marketplace takes 8%, the delivery app 18% of the meal price plus most of a 2.2 fee, the ride app 25% of fares (fare 2 + 2.5/km), the payments app 1.5%, crowdfunding 5%.
62. **Ad budgets** as a share of sales: shops and restaurants 5%; car dealers and banks 6%; websites 10%; TV 6%; companies selling to companies 1.5–2%. That's × (0.6 + 0.8 × the owner's ambition), plus 6/day for the first 10 days, capped at 8% of spare cash a day.
63. **Ad split:** consumer brands put 40% on the street, 35% online, 20% on TV and 5% on influencers; companies selling to companies 30% street and 70% online. Weekly rents for ad-company spaces: billboard 3.2/day, screen slot 4.5, wall ad 3.6, column face 1.2, sidewalk panel 0.9 (× centrality × the company's price level).
64. **Productivity (machines):** factory recipes were raised so a worker adds 40–110 of value a day (typical wage ~22). Extraction per worker-hour: wood 7, stone 6, clay 7, ore 4. Factories have 6–16 jobs.
65. **Service exports:** office workers and programmers bill outside clients 1.7 × their role's reference pay × (0.6 + 0.8 × reputation). Offices and internet companies get a desk per ~12 m² of floor (an office floor in a tower has about 22). Consulting firms hire up to 5 more a day while clients want more work and they make money. The world buys up to 1,000 + 10 × population a day of the city's office work.
66. **Construction:** materials × 1.5 and work hours × 1.5 compared with the table in goods.ts (`BUILD_SCALE`); a house takes about 2.5× what it did. Construction loans cover 65% of the price, secured by the building; buildings secure loans up to 70% of their value. Contractors need 3/6/10 builders for buildings over 6/14/30 floors.
67. **Land:** per m² by zone: core 2.5, urban 0.8, suburb 0.2, industrial 0.15, rural 0.03. That's × (0.5 + population/150) × demand × centrality (up to 1.35 at the center). Downtown radius 150 m + population/10 (up to +250); inner city 290 + population/6; suburbs 450 + population/5.
68. **Developers:** they build where a year (120 days) of rent at 85% occupancy is at least 80% of the cost. Height maximizes value: units beyond what can be let soon (1.5 × current demand + 60 days of growth) count at 40%. Towers start at 250 people, for downtown demand: 30% of renters and 12% of house owners who can pay the tower premium.
69. **Redevelopment:** houses, trailers, mostly-empty blocks of up to 4 floors, empty buildings of up to 3 floors, and failing businesses of up to 2 floors can be bought at 1.4 × (building + land value) and torn down for a tower.
70. **Migration:** 1.5 newcomers a day plus 0.8 per open job (up to 40 openings), × prospects (1.3 − 2 × jobless share, at least 0.15). People without a job or firm and under 300 in savings leave after 8 days with 2–12% a day (fewer with friends or property).
71. **Living reserve:** founders keep 120 when they start a business. People pay for food before loan payments (they keep 20).
72. **Chains:** QuickStop opens at the founding. Others open (25% chance a day) when there are fewer of their kind than population ÷ 110–700. First National Bank (capital 9,000) opens when the banks have lent out 70% of what they can.
73. **Soup kitchen:** a meal costs 1.5 and gives +40 food, for people with under 20 money and food under 40 (at night only for the starving). It runs at city hall (or its building site). Without one, a charity runs it in a park or at a shop. The city pays if it pays welfare, otherwise the richest resident donates.
74. **Welfare must be claimed:** online (people with a phone or computer do it while on the Net) or in person at city hall. A claim lasts 30 days.
75. **Banking:** people open an account at the bank they know best (ads count; online customers prefer a bank with a website). The fee is 0.03/day. A bank may lend 8 × its own money + 60% of its customers' deposits.
76. **Gig work:** couriers get 80% of the delivery fee (all of it for meals) plus occasional tips. Ride drivers get 75% of the fare. People take a ride for trips over 1 km when the time saved (× 2.5 × their hourly value) plus comfort and tiredness outweighs the fare.
77. **Crowdfunding:** at most 3 + population/300 campaigns open at once (one per kind of business), only from risk-takers. Campaigns run 10 days. Backers give up to 8% of their money (the well-off give more).
78. **Influencers:** each like a post gets wins a follower with 40–80% chance (more for people already followed). Followers fade 2% and 0.1 a day. Companies pay 1 + 0.06 × followers per sponsored post.
79. **Online ads:** a social or video visit shows 6 ads, a marketplace or news visit 3. Each view adds a little awareness (0.008).
80. **Height limits:** the council's 6-floor limit applies to the neighborhoods, not downtown.
81. **Parking:** cars park beside small buildings (up to 6), then on the street out front (up to 10), then in an underground garage (hidden).
82. **City hall:** public building sites are never abandoned. A city hall that's lost is rebuilt once the treasury has 400.

- **Border view (user request, 2026-10-24):** inspecting a government (the Gov tab, its city hall or its administration) shows its territory: a wall in its flag colour along the limits, a light tint inside, and its voting districts. The Gov tab has a "zoom to the borders" link. The Limits button still shows every government's lines.

### Since v0.4: speed modes, up to 10,000 people, office towers, TV (later on 2026-10-24)

What you asked for:
- Cars clipped through houses and drove sideways or diagonally through buildings.
- "skyscrapers with hardly any people": you couldn't see why anyone builds them, or why a company would rent space in one.
- More people: "maybe we could make it 10,000 if it works". Speeds where nothing is drawn, or only the buildings, and jumping to a time of day without the 3D.
- "if you have no 3d the world can run much much faster"; "you can't go as fast in 3d view but way faster in non 3d view"; "could you theoretically go even faster speeds on non 3d view".
- "make it so you can watch the people's television".

What's new:
- **Cars stay on the roads.** Drives end at the curb in front of the building, not at its center. Cars park along the street in front, then in an underground garage. Trucks of logistics and construction companies park in their yard. Ride-app cars pick people up at the curb.
- **Speed modes** (top bar):
  - The 3D view goes up to 1 game hour per second.
  - **Max** turns the 3D view off and runs as fast as the computer can, while the panels keep updating. Any other speed turns the 3D back on.
  - **⏩ Skip:** to 7:00, 12:00, 18:00 or midnight, or ahead 1 day, 1 week or 30 days. It runs flat out with a progress box and a "Stop here" button, and draws the city once a second.
  - **View:** full 3D, buildings only (no people or cars), or no 3D.
- **Population cap 10,000.** The city grows by itself, about 15–25 people a day once past 2,000 (people come for jobs). So 10,000 takes a long game; Skip and Max are how to get there.
- **A much faster simulation.**
  - A game day at ~2,400 people went from ~11 s to ~4 s of computing.
  - On a synthetic city of 7,000 people (newcomers added to a real city) it takes ~20 s.
  - In the browser, Max at ~2,400 people runs about a day every 5–8 s.
  - How:
    - steady activities are batched;
    - people only reconsider housing, starting a business or developing now and then;
    - routes between two streets are remembered;
    - "who works here" is indexed;
    - counts shared by everyone are cached;
    - steady people get a wake-up time instead of being checked every minute.
- **Bugs this uncovered (fixed):**
  - People whose house project had been torn down tried to build it again every minute.
  - Ride-app drivers whose car was parked down the street gave up and retried every minute. They now walk to it.
  - A store that sold out kept ordering only what it had sold, so it never caught up. It now orders more after selling out.
  - The soup kitchen turned away starving people who had a little money but nowhere to buy food.
- **Office towers fill up.**
  - The office work the world buys from the city is now two markets: software (programmers) and professional services (consulting, legal, accounting: clerks).
  - When the city sells more than the world wants, the price of every hour falls a little for everyone. Before, the work billed after the daily limit earned nothing, so afternoon work was lost and consulting firms ran at a loss.
  - Internet companies used to fill every desk whatever the demand. Now they hire like consulting firms: while their market still pays full price and they make money.
  - In a test city (day 125 + 12 days) people at work in the office towers went from 290 to 673, and 103 of 133 office floors are leased.
- **Watch TV with someone.**
  - The TV window has a screen. It shows the channel's logo, LIVE for news, a title card, then whoever is speaking: presenter, guest or candidate, shown as the same faceless figure as in the city (their skin tone and shirt color), with a caption. The ad break shows the spots the channel sold, in each advertiser's colors with its slogan. A news ticker runs along the bottom. Color bars show when nothing is on.
  - A person who is watching TV has a "📺 Watch with them" button. It tunes the screen to their channel, follows them when they switch, and shows how many homes are tuned in. It also shows how they take it: nodding along, unconvinced, shaking their head, checking their phone during the ads.

### Defaults chosen since v0.4 (please review)
83. **Speed caps:** the 3D view tops out at 1 game hour per second (nights still pass faster). Max, no-3D and Skip run up to 150 ms of simulation per frame, and the panels redraw ~6 times a second. While skipping with the 3D view on, the city is drawn once a second.
84. **Batching:** people doing something steady are updated every 5 game minutes (15 while nothing is drawn); everyone else every minute. Steady means asleep, relaxing, seated at work, on the Net, on the phone, watching TV, or sitting in an audience.
85. **How often people reconsider:**
    - where to live: every 8–16 hours once they have a home (every time while homeless or in a trailer);
    - starting a business: every 12–36 hours;
    - developing property: every 1–2 days;
    - gig apps after a failed try: 4 hours later;
    - a house plan that can't go ahead: 12 hours later.
86. **Arrivals:** at most 40 + 1 per 40 residents a day. Each employer that's hiring counts once, however many people it wants.
87. **Office work exports:** two markets, each buying 500 + 8 × population a day at full price. Past that, the next day's price is full price × demand ÷ what was billed, moved halfway there each day.
88. **Hiring at software and consulting firms:**
    - They add 3 (software) or 5 (consulting) people a day while their market pays at least 90% and they made money in the last 5 days (or are under 20 days old).
    - They let one go a day when it pays under 80% and they're losing money.
89. **Stores after selling out:** a shelf (nearly) empty means they order 4 × average daily sales, otherwise 2.5×.
90. **Soup kitchen:** also serves anyone whose food is at 18 or below, whatever their money.
91. **Parking (replaces #81):** the first 10 cars park at the curb in front, 6 m apart; the rest go to an underground garage. Logistics and construction trucks park in their yard.
92. **TV screen:** each picture stays 4.5 s (real time). There's an ad break after every 3 lines (up to 2 spots).
93. **Soup kitchen at night:** it no longer gets the night-time penalty that other trips out get. Two people starved at night next to an open kitchen.

94. **Companies and property (after your question "why would Liberty Web build a residential tower"):**
    - There used to be a rule: any profitable company with over 800 spare cash put it into flats or offices when they were in demand.
    - Now it's the company boss's decision, and it comes last, after expanding or branching out in its own trade.
    - It only goes ahead when a year's rent (120 days) × how well the company knows the trade beats the boss's hurdle. Trade knowledge: 1 for property companies, 0.85 for construction companies, 0.6 for everyone else. Hurdle: 1.1 − 0.4 × their risk taking.
    - The log says who decided and why.
    - Otherwise spare cash goes to the owner as dividends, as before.
95. **People developing property:** the "Develop a … tower" choice now scores by how well the project pays against what they'd want for tying up the money (yield above 1.05 − 0.35 × risk taking). It used to be a flat score whenever a plan existed.

96. **People only know some places** (you asked for it after "explain what it would look like if people only knew some places"; `places.ts`):
    - **What's on a list:** each person keeps up to 8 shops, 6 places to eat, 2 car dealers, 12 places to work, 8 buildings with flats and 4 parks or plazas. When a kind is full, the place they think of least goes.
    - **Where places come from:**
      - noticed daily: within 420 m of home and 250 m of work, the nearest few of each kind; employers only with a "hiring" sign, flats only with a "for rent" banner;
      - every ~150 m along the commute, what's right by the street;
      - visits;
      - friends and colleagues: a place they liked or hated, or "my work is hiring", in 35% of conversations;
      - ads: chance = 10 × the ad's strength, for the company's place nearest them;
      - searches.
    - **Searches** show the top 5 results, companies that advertise online first. Where they happen: a search engine when people know fewer than 2 open shops (every 6 hours at most) or no restaurant; the delivery app every 12 hours; job boards at each job check; home listings at each housing check.
    - **Forgetting:** places seen nearby or on the commute fade after 3 days unless seen again. Others fade after a while without coming up: 10 days for a search result, 14 for an ad, 20 for a friend's tip, 45 for somewhere they've been.
    - **Opinions:** a good visit raises it (more for a company with a good reputation); a wasted trip (sold out, nobody at the counter, too expensive, restaurant full) lowers it by 0.35. Friends pass on 60% of their opinion. Opinion counts in choices next to brand awareness.
    - **What's visible for a known place:** posted prices, opening hours and stock (shops show them online). Only that a place exists, and what it's like, has to be learned.
    - **Safety nets:**
      - hungry people with no open shop they know ask around and learn the 2 nearest;
      - "Look for work" and "Look for a place to live" walks teach people the nearest 3 places that are hiring or have flats (at most every 3 hours);
      - walks can turn up a park;
      - the soup kitchen and city hall are always known.
    - Each person's daily look round is spread over the day (1/24 of people each hour).

97. **Faster growth (you asked "make the population grow quicker"; replaces #86):**
    - Newcomers per day = (4 + 0.6 × open positions) × (0.4 + 0.6 × share fed) × prospects (1.3 − 2 × jobless share) × housing (1 − 2.5 × homeless share).
    - Open positions are capped at 40 + 1 per 20 residents, prospects are kept between 0.15 and 1.3, and housing is at least 0.2.
    - At most 40 + 1 per 20 residents arrive a day.
    - Test runs: day 120 = 2,490 and 3,031 people (before: 2,225 and 1,643), no deaths.

98. **Statistics window** (📊 Stats; you asked for "way better statistics… graphs… also markets"):
    - **Sections:** Overview (10 headline numbers with their 7-day change and a 30-day trend, "What changed this week" in plain sentences, the main charts), Economy, Markets (every good in a table; the chosen one in detail: price, quantities, open orders, biggest sellers and buyers), People, Housing & land, Companies (a sortable table of the biggest), Government, Net & media.
    - **Data:** the city is summed up at the end of each game day (`recordDaily`). What happens during the day (spending by kind, imports and exports by good, office work billed, companies opened and closed, buildings finished, wages, rent, government income and spending) is tallied as it happens. The last ~1,000 days are kept day by day, older ones every other day. A day is about 4–5 KB of the save.
    - **Definitions:**
      - "out of work" = no job and no business of their own;
      - "cost of a day's living" = 2 groceries + 0.05 clothes + 0.02 furniture + 0.01 electronics at shelf prices + a day's average rent;
      - inflation = its change over 30 days;
      - wealth = net worth (cash, goods, property, companies, minus debts), in bins under 10 / 100 / 1K / 10K / 100K / above.
    - **Sectors:**
      - Shops & restaurants (stores, restaurants, car dealers);
      - Factories;
      - Offices, finance & property (consulting, banks, property companies);
      - Tech & media (internet companies, TV, ad companies);
      - Construction;
      - Logistics;
      - Farms, forests & mines;
      - Government.
    - **Chart rules:** one y-axis per chart. Two measures on different scales go in separate charts, or are both indexed to 100 (wages against prices). Each chart has a hover readout and a table view, and colors follow the sector or series everywhere.
    - **A bug the charts showed:** the resident dividend counted itself as spending, so it was only paid every other day. Fixed.

99. **More statistics** (you asked for "more detailed… all company earnings or a political compass with everyone's dot"):
    - **Politics section:**
      - Elections at a glance: next election dates; candidates with party, views, poll, funds, spending, ads bought and attack ads against them; who's in office.
      - Polls for the next race, day by day.
      - Campaign money by candidate.
      - A wall of campaign ads (filter: attack ads).
      - The political compass: every resident as a dot, colored by party (the 3 biggest), wealth fifth or work; hover names the person, click opens them.
      - How views are spread on each axis; how groups lean by wealth, work and home; average views, party members, interest and grievance, protesters; past results.
    - **Advertising section:** for each channel, the spend, times seen, new customers, cost per 1,000 views and cost per new customer. Also the biggest advertisers and their budget splits, the street ad spaces, and campaign ad spending per day.
    - **Companies:** every company's earnings in a searchable table with a sector filter and a 30-day profit trend; one bar per company from biggest loss to biggest profit; profits by sector; total profits per day. Losses are red, profits blue.
    - **People:** who owns the wealth (poorer half / next 40% / top 10%), the richest residents, median wage by sector, jobs by role.
    - **Economy:** people's income by source (wages, dividends, gig work, day labor, government payments).
100. **Smarter ads:**
    - **Diminishing returns:** each further sighting adds less awareness once a brand is well known (× (1 − 0.7 × awareness)).
    - **Targeting:** online ads reach likely buyers 2.5× more often: car dealers people without a car with 250+, banks savers with 500+, restaurants the hungry, job sites the jobless.
    - **Measured results:** a first visit to a place someone learned about from an ad counts as a new customer for that ad's channel.
    - **Learning budgets:** consumer brands move 10% a day of their budget split toward the channels with the most new customers per coin (smoothed over about a week), keeping at least 5% in each channel.
    - **Campaigns:** online ads aim at the undecided (weaker party loyalty, some interest in politics). A candidate more than 8 points behind the leader puts 40% of online money (and half of TV spots) into attack ads against them. An attack leaves a fading bad impression that costs the target votes (−1.2 × impression). Ads also fire up supporters who already agree (more likely to vote).
    - **Ad log:** every campaign ad is recorded (last 400).
101. **Rich people don't do manual work:**
    - An owner with more than 40 days' typical wages no longer works hands-on at their own site; their company hires instead. They may "Look after the business" (90 minutes, no labor, at most twice a day per company).
    - Less well-off owners pitch in, more eagerly the less money they have.
    - Employees with savings over 150 shifts' pay who aren't very ambitious may retire (8% a day).
    - (People already value money less as they get richer; working at their own company was the one choice that ignored it.)
102. **Leased offices are staffed:** software and consulting firms keep a core team (3 programmers / 2 clerks per site) whatever their export market does, and only lease more space while their market pays full price. A leased shop or office floor with nobody employed for 5 business days is given back (if the company has another site). The 3D view shows people on leased floors when their tower or company is selected, and a tower's panel counts everyone inside.

103. **Small jobs don't pay off for the comfortably off** (you: "they shouldn't feel rewarded by doing simple jobs"). Measured in days of pay saved (money ÷ the reference wage):
    - over 60: no day labor or gig work;
    - over 200: no manual or low-skill jobs, and anyone in one leaves it (20% a day). The ambitious can still take professional jobs: manager, programmer, clerk, journalist, official.
    - The unemployment bonus and the pull of job security shrink as 1 ÷ (1 + days saved ÷ 40).
104. **Screens rotate only booked ads** (in the 3D view and in who sees them), evenly; "Advertise here" shows only on a screen with nothing booked. Ad companies discount 2% a day while under 70% of their spaces are rented.
105. **Less flicker:**
    - The camera's near plane follows the viewing distance (0.8% of it, 0.2–4 m).
    - Building sites level the ground: terrain tiles whose centers lie inside a lot take the height of its center. Older cities are leveled once on load.
    - Panels (side panel, inspector, Net, TV, statistics) are patched in place instead of rebuilt, so what's under the mouse doesn't blink.

106. **Food variety** (you said yes to "shoppers buy different foods"):
    - **New goods:** fruit & vegetables (sold fresh), milk, livestock, bread, dairy, meat. "Crops" is now grain.
    - **New businesses:** vegetable farms, dairy farms and livestock farms (fed with grain); bakeries (grain → bread), dairies (milk → dairy) and meat plants (livestock → meat).
    - **Nutrition / enjoyment per portion:** groceries 34/5, bread 30/4, fruit & vegetables 24/6, dairy 28/7, meat 42/9.
    - **Shopping:** a basket where each portion goes to the most-wanted food. That's personal taste (0.6–1.4, for life) ÷ (1 + times eaten lately) ÷ price^(0.5 + value of money), with the better-off liking meat and dairy up to 1.8×.
    - **Variety:** people eat what they've had least of lately; the same food again is less enjoyable. Three or more different foods lately raises happiness (+0.04); one or none lowers it (−0.03).
    - **Restaurants** cook with 30% meat, 30% fruit & vegetables, 20% bread, 20% groceries.
    - **Spoilage per day:** grain 1%, groceries 2%, dairy 5%, fruit & vegetables and meat 6%, bread and milk 12%.
    - **Shops** keep at least 10 of each fresh food.
    - **The cost of a day's living** now uses a mixed basket.
    - **Old saves** get the new goods added on load.

107. **The countryside** (you said "yes exactly what you were thinking… you have all these farms", and that its people should be simpler programs rather than extra people):
    - **The map is now 6 × 6 km.** The city's detailed ground (stored tiles) is the 2 × 2 km square in the middle. Around it, 2 km of countryside is computed from formulas: rolling farmland, woodlots, and the city edge's woods and rocks thinning out over the first ~350 m.
    - **Roads:** Route 9 carries on to the map's edge, going around lakes. Outside trucks come and go there; newcomers are still dropped off at the edge of town. Country lanes run about 1 km apart, with bends and a few gaps. They join the highway and wait at the ends of the city's planned country roads.
    - **Farms:** along every lane, a farmhouse lot (38 × 44 m) next to a field lot (170–300 m wide × 220–400 m deep). About 30% start farmed (grain 42%, vegetables 22%, dairy 20%, livestock 16%, by soil); the rest is the Territory's, for sale by area (0.004 per m²). Field fertility comes from the soil formula.
    - **Farm families:** the farmer owns the farmhouse (4 rooms) and the farm. One or two relatives work with them and live in it rent-free. A farm worker who lives rough or far away moves into the farmhouse if there's room. Open farm jobs with room in the farmhouse draw someone from outside (25% a day per opening).
    - **Villages:** 3, at crossroads far apart, each with two short streets, a shop, a pub and about 16 houses. A quarter of the villagers are retired; the rest work on nearby farms.
    - **Countryside people are a simpler program:**
      - Their choices: sleep, work or their farm, eat at home, the village shop, the pub, TV, a walk, voting.
      - They skip: business plans, moving house, gig work, the Net at home, learned habits.
      - They look round every 3 days instead of daily, knowing the nearest 2 shops, 1 pub and 3 hiring farms within 1.5 km.
      - They're updated 3× less often while doing something steady.
      - Vegetable farmers eat their own produce.
      - After 10 days out of work (unless well off), they leave for the city and become city people.
    - **Who counts as countryside:** anyone whose home is outside the city's square. The population cap (10,000) and everything sized by "the city's population" (zones, building heights, chains, export and service demand) count only city residents.
    - **Food exports:** the region's wholesalers buy more farm goods: grain 2,500, vegetables 1,500, milk 1,500, livestock 600 a day (they were 800/700/700/400).
    - **Highway fix:** Route 9 used to stop at the first lake. In some worlds that meant no highway at all.
    - **3D:** the ground out to the map's edge uses the same height formula. Fields are colored by crop; the farm model draws its rows over the whole field. Countryside woods have no trees yet.

Your rule for this (2026-10-24): nobody is forced to build a tower. Towers should come from people's and companies' own decisions in an urban economy; skyscrapers were never the goal in themselves.

### What a run looks like now (headless, final code apart from #93, 2026-10-24)

| | Seed 4 | Seed 11 |
|---|---|---|
| Day 60 | 761 people, 585 jobs | 389 people, 291 jobs |
| Day 120 | 1,967 people, 1,612 jobs | 1,403 people, 1,242 jobs |
| Day 180 | 3,585 people, 2,809 jobs | 3,490 people, 2,893 jobs |
| Day 220 | 4,179 people, 3,216 jobs | 4,661 people, 3,781 jobs |
| Deaths | 2 (both homeless, at night, before #93) | 1 |
| Homeless / out of work | 2 / 818 | 2 / 713 |
| Towers | 27 (10–30 floors) | 21 (10–30 floors) |
| Ad spend per day | 5,654 | 6,456 |

- The city now grows past 3,000 by itself, about 15–30 people a day.
- Each run took ~9–11 s per game day at 4,200–4,700 people, with both running at once on a busy machine.
- With #93, seed 4 had no deaths by day 60.

### What a run looks like (headless, two worlds, 2026-10-24)

| | Seed 4 | Seed 11 |
|---|---|---|
| Day 60 | 503 people, 277 jobs | 529 people, 357 jobs |
| Day 120 | 1,681 people, 1,055 jobs | 2,081 people, 1,406 jobs |
| Last day | day 165: 2,584 people, 1,803 jobs | day 151: 2,782 people, 1,694 jobs |
| Deaths | 1 | 1 |
| Towers | 16 (8–30 floors) | 32 (mostly 20–30 floors) |
| Ad companies | 20 | 12 |
| Influencers | 34 | 5 |
| Ad spend per day | 2,568 | 1,704 |

- In seed 4, about 25,800 online orders, and imports roughly equal exports.
- Office towers are mostly leased to consulting and internet companies, plus bank branches, stores and restaurants on the ground floor.
- In the browser, a new world reached about 1,700 people by day 147 at Max speed.

### Known issues (v0.4)
- **Building is too cheap compared with rents:** developers see yields of ~200–600% "a year" (120 days); real rental buildings earn ~5–8%. So building anything to let pays off absurdly fast, which pushes everyone with money toward property. Found 2026-10-24; to discuss.
- **Speed:** after the later speedups, a game day takes ~4 s of computing at ~2,400 people and ~20 s at 7,000 (Node). It scales about linearly. The 3D view is capped at 1h/s, and Max/Skip run without it.
- **Unemployment** is about 20–35%. People who stay out of work and run out of savings move away, so the city keeps churning (~1 in 3 arrivals leaves again).
- **Inequality:** wealth is very unequal (Gini ~0.7). Founders of successful companies, developers and landlords hold most of the money.
- **Crowdfunding:** most campaigns fail (backers are few and give little). The successful ones are mostly small businesses.
- **Towers stop at 30 floors** in practice: taller ones need a construction company with 10+ builders, and few get that big.
- **Ride-hailing is rare:** mostly better-off people without cars ride, for long trips. Most people walk, and car ownership is ~10%.
- **Sprawl:** early cities still have many houses and trailers. Towers appear from about 250–500 people, once downtown land is dear and developers see demand.
- **Unprofitable companies:** many manufacturers fail (realistic startup failure, but a lot). The survivors export most of what they make.

(Section 0a below is v0.3, kept for reference.)

---

## 0a. v0.3 "Polity"

What you asked for after v0.2:
- realistic pay, so workers aren't in the richest 30;
- people who want money and things;
- a dense city of about 1,000 people, not "a random town in Wyoming";
- land that is always owned, with realistic bankruptcy and inheritance;
- limits on what one person can build;
- far more detail up close (cups on tables);
- better people from a free pack;
- ads: posters, billboards, flyers on lamps;
- a government that builds the streets, with offices, campaigns, speeches, TV debates, elections and districts;
- rules that can change, up to communism, coups and two or three rival governments;
- a political compass that isn't random;
- the Net, with websites run as companies;
- arrow keys and a movie-like camera;
- no more "town".

Mid-way you added: governments don't have to do what people want; people vote them out, or revolt only when things are really out of hand; there are many kinds of government; the town square is unrealistic; homelessness is fine (real life).

Research notes behind the politics: `docs/research/politics.md`.

### What's new
- **Nothing is free; land is always owned.**
  - Before anyone arrives, all land belongs to "the Territory" (an outside land office; money paid to it leaves the economy).
  - At the founding, the land inside the city limits becomes the city's public land. A land office sells lots at their assessed value: size × zone price × city size × demand, blended with the last sale.
  - Private owners sell lots they don't use. The Territory sells farmland and homesteads outside the limits, and lays out country roads when people want land there.
- **Streets are built.**
  - At the start only the regional highway exists (Route 9; in town it is Main Street).
  - The council lays out new streets from a street plan where people want land. A new street is a dirt track that people can walk and cars drive slowly, and lots along it can be sold and built on.
  - Paving is a separate council decision. The government's road crew then paves with stone it buys at the trading post.
  - Streets have names (numbered streets, tree and people avenues).
- **No town square.**
  - The trading post (the outside traders' depot by the highway) is where people sell raw goods and buy supplies. Companies still trade wholesale through it, with deliveries.
  - Jobs are found by walking to businesses with a help-wanted sign, through friends, or on the Net. Homes are found through "for rent" signs and the Net.
  - Hanging out happens on the trading post's porch, or in a park or plaza once a government builds one.
- **Governments ("polities").** A government is an organization like a firm: a charter (data), a claimed territory (50 m cells, which need not match where the city actually is), an administration firm holding the treasury and public land, and staff (clerks, police, road crew).
  - **The founding assembly.** The 40 settlers vote on each charter question; for each, what the median founder wants wins. The questions:
    - mayor–council vs council–manager vs town meeting;
    - who may vote;
    - voting method;
    - how to amend the charter;
    - tax rates.
    Then they elect the first officials on the spot and get a homestead lot each.
  - **The charter is data, and nothing outside it limits a government.**
    - Executive chosen by voters, the council, the party, force, a predecessor (ruler for life), or a company owner (company town).
    - Council elected, appointed, party-chosen, or every voter (town meeting); seats, terms, districts.
    - Plurality, runoff, or party-list proportional representation.
    - Franchise: residents, owners, party members or everyone.
    - Parties free, single or none; press free or state; ownership private, mixed or collective.
    - Amendment by majority, two-thirds, referendum, or decree.
    The label (e.g. "strong-mayor democracy", "one-party communist state", "military junta") is derived from these fields.
  - **The council meets weekly** at city hall, or the trading post before there is one. Each member proposes what they care about most, plus whatever is urgent:
    - laying out and paving streets, city hall, plazas, parks;
    - taxes, welfare, police, road crew, clerks;
    - rent cap, height limit, minimum wage, land prices, newcomers;
    - nationalizing or privatizing;
    - annexing land;
    - charter amendments: districts, seats, veto, proportional representation, franchise, postponing elections, single party, state press, ruler for life, collectivization, and restoring democracy.

    Members vote by their own views and interests. Public opinion counts more the sooner they face voters, and not at all for unelected rulers. Executives with a veto can use it, and rulers issue decrees. Every decision goes into the Gazette.
  - **Taxes** are on income (withheld from pay), sales (stores and restaurants) and property (assessed value, per political year), plus building permits and land sales. Spending goes to officials' pay (scaled with city size), staff, welfare (capped by what the treasury can spare), stone and buildings. Unpaid property tax leads to a tax sale.
  - **Elections.**
    - Campaigns open 10 days before; candidates are nominated per party plus independents.
    - Candidates raise money (own savings, party dues, donors near their views) and spend it on posters on supporters' houses, billboards, TV and Net ads.
    - They give speeches and hold rallies (crowds cheer), knock on doors, put flyers on lamps, and debate on TV.
    - On election day people walk to the polling place. Turnout and vote choice follow the research (see below). Votes are counted at 8 pm; runoffs follow a week later.
    - Districts are redrawn after each census by whoever has the power; partisan drawers gerrymander.
    - Referendums decide amendments when the charter requires it.
  - **Parties** form when engaged, ambitious people find no party near their views. Others join the nearest party; platforms follow the members, and members pay dues.
  - **Regime change.**
    - Everyone has a recognition of each government (how far they accept its rules). It follows how life goes, fairness (suspended elections or banned parties anger people who value democracy), distance to the rulers, and friends.
    - Grievances (hunger, joblessness, rights taken away) lead to protests that grow only if people see others they know joining (threshold cascades).
    - A revolution needs at least 3.5% of residents protesting at least twice in a week, legitimacy under 40%, and at least 30% of the police unwilling to defend the government. The new government follows the crowd's views (communist, democratic, or authoritarian).
    - If the old government keeps enough loyalists, it carries on as a rival: two governments claim the same ground, and the one obeyed by more than 70% for 15 days wins.
    - Coups are rare: about 1% per political year, raised by unrest, coup history and an ambitious police chief; a coup succeeds if the officers follow the chief.
    - Backsliding is gradual: postponed elections, a single party, state press, ruler for life.
    - People living far outside any city limits found their own towns, so several cities emerge.
- **People.**
  - New attributes: age, years of schooling, where they grew up, an agreeableness trait (openness is "curiosity"), happiness.
  - **The political compass** (economic left–right, authority liberty–order) is not random. It follows from personality (openness and agreeableness most), schooling, age, origin and wealth. Positions drift toward people's interests: owners and landlords move right, the jobless left.
  - Persuasion from TV, posts, ads and speeches mostly fades within days; trusted friends pull people a little closer if they're not too far apart.
  - Issue stances (taxes, welfare, rent control, growth, public ownership, police, democracy, roads) mix ideology with self-interest. Landlords oppose rent control; homeowners oppose new building next door.
- **Realistic money.**
  - Pay is by role and schooling: managers ~2.2×, programmers 2×, presenters 1.8×, clerks 1.25×, factory workers 1×, waiters 0.75×. Employers want the schooling a job needs.
  - Banks lend only against income.
  - Net worth subtracts debts and counts land.
  - People value money longer the more ambitious they are, and buy things that make them happy: phones, TVs, nicer clothes and furniture, cars partly as status. Happiness counts possessions and income compared with others.
- **Property never becomes ownerless.**
  - **Death:** debts are paid from the estate first. A will (likelier for older, conscientious people) names the closest friend as heir. Without one, the estate escheats to the government where they lived, which auctions it. Companies pass to the heir, or are auctioned as going concerns while a senior employee runs them.
  - **Bankruptcy:** a creditor files after 7 missed days. The business is either reorganized (the bank takes it over and sells it) or liquidated (assets auctioned; proceeds go to the bank, then unpaid wages, taxes, others, and the owner last).
  - **Foreclosure:** mortgages are secured by the house, which the bank can seize.
  - **Dead companies** close and sell their buildings.
  - The old "claim an abandoned building" mechanic is gone.
- **Build limits.** A person can put up only single-floor simple buildings (hut, house, farm, shed-type works, small shop or restaurant). Anything taller or more complex needs a construction company and waits until one can take the job. Houses are zoned out of downtown.
- **Media.**
  - **Ads:** posters on side walls, billboards on roofs and empty lots along busy roads (rent paid to the owner), flyers taped to street lamps (free, rarely read, covered by the next flyer), and TV and Net ad slots. Passers-by gain awareness of the brand or candidate. Political ads persuade a little, briefly.
  - **TV stations** are companies with an editorial line (the owner's, or the government's under a state press). They air hourly shows made from what actually happened:
    - news chosen and framed by the slant;
    - talk shows with officials;
    - election debates with the candidates in the studio;
    - entertainment.
    People with a TV watch in the evening.
  - **The Net** is websites run by internet companies:
    - social networks with different feed rules (chronological, engagement-ranked, friends-only), short-post limits and anonymity;
    - news sites, classifieds, search, video and forums.
    People join where their friends are (network effects), read their feeds, like and share, post (engaged people post politics), and see sponsored posts. Company homepages and the city's website (officials, decisions, elections, land for sale) are there too.
- **Survival realism.** Wild food only feeds a frontier-sized settlement, so a growing city needs farms, food plants and stores. People with nothing keeping them leave to look for work elsewhere. Newcomers arrive more often when there are jobs. Day labor at the trading post pays a little cash.
- **Viewer (UI).**
  - A Gov tab: system, charter in plain words, offices, money, policies, upcoming sessions, speeches and protests, transcripts, polls during campaigns, past elections, parties, a compass of residents, and the Gazette.
  - The person inspector shows politics: compass with the pull of their interests, stances, party, vote, media diet, recognition, life events, plus age, schooling, origin and happiness.
  - The 🌐 Net browser and 📺 TV window.
  - A Limits overlay showing city limits and districts.
  - Arrow keys/WASD pan, Q/E rotate, R/F zoom, Shift faster, V street view, C or 🎬 Cinema for an automatic movie camera that cuts between shots.
  - "Town" is now "city".
- **Visuals (by helper agents).**
  - **People up close.** Within ~38 m, up to 48 people become skinned, animated characters, fading back to the simple instanced figures at 46 m.
    - **Gender-neutral (2026-10-24).** Everyone is the same faceless, hairless mannequin. People differ only by height, build, skin tone and clothes. The renderer has no male/female concept, and the far figures have no faces or hair either.
    - **Minimalist.** The mannequin is simplified to ~1,070 triangles per person (it had 13,700), faceted low-poly.
    - Source: the CC0 mannequin from Quaternius' *Universal Animation Library*, slimmed to a neutral build, with clips from that library and the *Ultimate Modular Men* pack (licenses in `public/models/people/LICENSE.txt`; build script `scripts/people-assets/build_people.py`).
    - Outfits by job (police, hi-vis, chef, apron, suit, office, casual), as simple color zones on the body (tee, long sleeves, hoodie, suit, hi-vis vest, overalls; trousers or shorts; shoes or sneakers) plus hats, apron and police belt.
    - All 20 poses, including phone, speech, cheering, protest sign and voting.
    - Held phone, sign, mic or cup.
  - **Buildings.**
    - New models: city hall (portico, clock tower or dome, flag, council chamber), TV studio (antenna, dishes, ON AIR light, set with cameras), internet company tower (server room), trading post, plaza, park.
    - Close up, an opened building shows props: monitors, mugs, plates with food, cutlery, candles, pots, stocked shelves, beds, sofas with TVs, bookshelves, plants.
    - Exteriors near the camera get curtains, flower boxes, AC units, balconies and café tables.
    - Far away, buildings become merged boxes with lit window textures.
  - **Ads.** Weathered wall posters, billboards (free-standing with lights, or on roofs), flyers taped to lamp poles over older torn ones, and banners. Designs are generated: election ads say "VOTE NAME" in the party colour with a silhouette and the slogan. Clicking an ad selects its sponsor.
  - **Streets.** Dirt tracks with ruts; paving fronts with a paver, roller, cones and signs; survey stakes on streets about to be paved. Benches, bins, hydrants, bus shelters, street trees with grates, and traffic lights on avenues. Lamps sit exactly where flyers get taped.
  - **Camera.** Free, follow, cinema (15 shot types, cuts every 5–14 s or on events, occlusion avoidance, letterbox and caption) and street-level walk (V).

### Defaults chosen in v0.3 (please review)
36. **Political year = 30 game days.** Terms are 2 political years (60 days); the census and redistricting happen once a year.
37. **Founding.** City limits are 420 m around the crossroads. The Territory grants the city 500. Each settler gets a free homestead lot (suburbs first).
38. **Charter rules at founding (median founder):** authority above +0.25 gives an elected mayor (with a veto above +0.6); below −0.55 gives a town meeting; otherwise a council–manager system. Economic views above +0.6 limit the vote to property owners; below −0.6 bring party lists; below −1.1 bring mixed ownership.
39. **Starting taxes:** property 1.5%/yr, income 6%, sales 3%, each ± the median founder's tax stance; welfare 2 + 3 × the welfare stance per day.
40. **Officials' pay:** executive 1.2× and councillors 0.15× a reference wage, scaled down in small cities.
41. **Land:** zone prices per m² (core 0.4, urban 0.15, suburb 0.05, industrial 0.045, rural 0.01) × (0.6 + population/200) × demand (up to 2.5×). The Territory's prices are flat (rural 18, suburb 25, urban 40, core 60).
42. **Paving:** 4 m per worker-hour on a street (narrower roads faster); stone 0.08 per m².
43. **Revolution:** at least 3.5% protesting at least twice in 8 days, legitimacy under 0.4, and police defection of at least 30%. **Coups:** base ~1% per political year, and only with an ambitious police chief.
44. **Wild food regrowth:** fish 0.1 and forage 0.2 per tile per day. This feeds about 60 people.
45. **Emigration:** jobless people with no property and under 15 money, who are hungry or homeless, leave with a probability of ~12% per day (less with friends). **Day labor:** 6 + population/25 slots a day, paying ~1.4 per hour, from outside money.
46. **Phones and TVs are electronics units.** A unit becomes whatever device the buyer lacks: a phone first, then a TV, then a computer.
47. **The council considers about 7 motions per session.** Each member proposes their favorite, weighted by urgency.
48. **Visual detail distances.**
    - Close-up props: within 110 m of a cut building (off at 140 m).
    - Exterior detail: within 135 m (off at 165 m).
    - Far boxes: beyond 720 m (back to detailed at 640 m).
    - Detailed people: within 38 m (off at 46 m), at most 48.
    - Ad textures: billboards within 250 m, posters 120 m, flyers 32 m.
49. **About 1 in 10 newcomers brings savings** (800–3,400) and more schooling, up to 1 in 5 as the city grows: investors, professionals, entrepreneurs.
50. **The trading post's counter.** Individuals buying everyday goods there pay 20% over the wholesale price; the margin goes to the seller. Stores buy wholesale.
51. **New streets are laid out only on real demand** (people looked for land and found none), up to 4 per motion. Smaller towns grow around their own center.
52. **Stuck building projects.** They shrink by 2 floors after 4 days of waiting for a builder, and are given up after 12.
53. **Crime.** Hungry, broke people steal with a probability of ~5% per hour × (1 − agreeableness) × (1.2 − diligence) × (0.5 + risk). They're caught with probability 12% + 30% per officer within 160 m, and spend 24 hours in a cell (fed). Crime pushes councils toward more police and angers law-and-order residents.
54. **Last resort** (hourly, for the starving and broke): owners draw on their company, homeowners sell their house, and the rest leave the city (15% per hour).
55. **Price signals** use the quantity-weighted median bid, not the top bid. Quitting a job to gather counts the walk to the nearest stock and needs 2× the wage.
56. **Windfall dividend.** A government with more than 60 days of spending + 2,000 in reserve pays residents 3% of the excess per day.
57. **Migration.** Arrivals happen at 3/day base, plus 0.45 per job posting, scaled by job prospects (minimum 35%). Jobless people without ties leave at about 7% per day.
58. **Neutral people (Claude's picks, 2026-10-24).**
    - The mannequin's shoulders, chest and arms are pulled 12–28% toward the bones to soften its bodybuilder sculpt.
    - The clothes are only neutral ones (no skirts or dresses).
    - Casual mix: tee+trousers 32%, long sleeves 24%, hoodie 18%, tee+shorts 14%, hoodie+shorts 6%, tee+trousers+shoes 6%.
    - The sim's `hair` and `hairStyle` looks are no longer drawn. They are still in the data, in case hair comes back.

### Known issues (v0.3)
- Unemployment stays around 45–50% of adults (many work informally: fishing, foraging, day labor). Companies are small and many fail.
- Population levels off around 450–650 depending on the world (not yet 1,000). Growth is limited by jobs, and people leave when there are none.
- Inequality is very high (wealth Gini ~0.85, like real wealth distributions); a few company owners hold most of the money.
- Many houses (suburban sprawl); apartments come late, once construction companies grow.
- Governments are often near broke because councils deadlock on taxes versus welfare (emergent, but it slows paving).
- Revolutions and coups are rare by design. A test script (`scripts/regimetest.ts`) forces the conditions.
- With ~1000 people the simulation takes ~2–3 s per game day (node); in the browser, Max speed is about 2–4 s per day.

---

## 0b. v0.2 "City"

After v0.1 you asked for: a big city with everything plus scattered areas outside it; cars; less grid-like; things you can actually see happening; short nights; people who are fun to watch (with limbs); jobs with computers; readable conversations; a town internet; no instant hiring and firing; sidewalks and streets; restaurants, shipping companies, stores and large corporations; apartments, rent, owning a house and driving to work. v0.2 is a rewrite of most of the code toward that.

### What you can see and do
- **A city that grows street by street.** A master plan of streets (an irregular grid aligned with four avenues out of the square) gets built as the city needs land; country roads lead to farms outside. Every building sits on a lot facing the street; lots are bought, sold and redeveloped (shacks give way to apartments downtown).
- **People with limbs**, each looking different, walking on sidewalks, driving cars, sitting at desks typing, cooking, serving tables, eating, hammering on construction sites, hauling, sleeping. Zoom in to read speech bubbles.
- **Cars and trucks** on the roads: people buy cars (with car loans), shipping companies' trucks deliver goods between companies.
- **Opened-up buildings:** select a building, or follow a person into one, and its roof and walls fade to show the generated interior (desks with computers, counters, stoves, tables, machines, beds) with the people at work inside.
- **Day and night** with lit windows, glowing signs and streetlights; nights pass 8× faster than days.
- **Dashboards:** Overview charts (people/jobs/renters, exchange prices, wages and rents, companies/buildings/cars, money, inequality), Richest people, Companies by value, Market (exchange, job openings, housing, deliveries), **Talk** (conversations around town), Log.
- **Inspectors** for people (what they're doing and why, all options they weighed, job and contract status, home and rent, car, needs, personality, skills, beliefs, trust, what they said and posted), buildings (owner, firm, staff, tenants, who's inside, construction progress and contractor) and companies (owner, cash, value, employees by role, prices, daily profits, sites, website).
- **Townnet** (🌐 button): the town's internet: a feed of people's posts, news, job listings, apartments for rent, shops and restaurants with prices, exchange prices, a company directory, company websites and personal profiles.

### How the economy works now (main changes from v0.1)
- **Companies (firms)** have their own money, separate from their owner. They set prices from how fast things sell, buy their inputs (delivered by shipment), staff up and down, pay their owner dividends, borrow, open more sites (chains), build a headquarters office once they have 12+ employees (offices give admin capacity), and branch out into whatever product buyers want most that few make (corporations). Owners who die pass their company to their longest-serving employee.
- **Jobs** are contracts: postings collect applicants for a few hours, then the firm picks the best (experience in the role, trust, a bit of luck). 3-day probation, then 2 days' notice for layoffs and quits. Workers quit at once only if unpaid twice. Wages are fixed per contract (negotiation still later, as you decided).
- **Roles** at work: farmhand, logger, quarry worker, miner (walk out to the resource and carry loads back), factory worker, cashier, cook, waiter, driver (trucks), builder (company construction sites), clerk and manager (at computers in offices and banks). Skills grow with experience.
- **Goods** (15): crops, fish, wood, stone, clay, ore → groceries, planks, bricks, steel → tools, furniture, clothes, computers, cars. Production chains: farm → food plant → store; lumber yard → sawmill; quarry → brickworks; mine → steel mill → workshop / electronics / car factory → dealer.
- **The exchange** at the square: individuals bring goods; companies list goods that stay at their sites; trades create **shipments** that drivers carry. Freelance couriers take shipments nobody picked up for 8 hours (for a steep fee).
- **Stores, restaurants, dealers:** people shop for groceries (and fresh crops/fish), clothes, furniture, tools and computers at stores, eat at restaurants (needs a cook on duty and food in the kitchen), buy cars at dealers or straight from factories.
- **Housing:** huts (outskirts), self-built or contracted houses (with mortgages), and apartment buildings built by developers/companies that rent out units; rents follow vacancy; eviction after 4 unpaid days. Abandoned huts fall apart; unused land goes up for sale.
- **Construction companies** quote prices, take 40% up front, buy materials, and send builders.
- **Banks** (anyone with enough capital can open one; the richest settler opens the first): loans create new money, repaying the principal removes it; reserve limit 8× the bank's cash; rates adjust to demand; defaults after a week of missed payments.
- **Outside world:** traders at the square buy a limited amount of each good daily at world prices (exports bring money in) and sell some imports at a markup.
- **Conversations** produce real lines from what people know and feel (prices, jobs, rent, bosses, gossip) and actually pass information (prices, job openings, places to live) weighted by trust.
- **Tiny neural networks:** every person has a small network (10 inputs → 6 hidden → 8 outputs) that learns from their own experience how much better or worse than usual each kind of activity (working, gathering, food, socializing, resting, building, career moves, shopping) turns out for them in a given situation. The reward is personal: the change in their own satisfaction weighted by their personality. It nudges the hand-written scores. Newcomers inherit a blend of the brains of people who are doing well. See "Learned habits" in the person inspector.
- **Needs** now include fun; food can be eaten from what you carry or your pantry at home; durables (clothes, furniture, computer) wear out.

### Defaults added overnight (please review)
| # | Default | Why |
|---|---|---|
| 21 | A master street plan exists from day one; streets are only built as the city reaches them | Random street growth stalled and sprawled; real towns are often platted ahead |
| 22 | Nights pass 8× faster than days on screen | You asked for short nights |
| 23 | 40 settlers, money skewed (30–900); the richest gets +500 and founds the first bank | So the economy has some capital and credit early |
| 24 | Outside traders buy/sell limited daily amounts at world prices | A closed town never needed many workers; real towns export |
| 25 | Freelance couriers deliver shipments waiting 8+ hours, for a fee | Without them one missing kind of business could starve the town |
| 26 | Wild fish and berries regrow slowly | So the town depends on farms, stores and jobs as it grows |
| 27 | Huts only on the outskirts; abandoned huts fall apart fast; unused land goes up for sale | So downtown can redevelop |
| 28 | A company keeps a core staff and only lets people go after sustained losses or clear overstaffing | Fixes the instant hire/fire churn you noticed |
| 29 | Lending creates money (with a reserve limit) | That's how banks work; you said banks can create money |
| 30 | A town supports only so many makers of one product (≈2 + population/60) | Too many one-person companies split the demand |
| 31 | Tower heights grow with the population (apartments up to 14 floors, offices up to 16) | A bigger city builds taller downtown |
| 32 | A bank lends from the day it's founded (before its building is finished) | Otherwise credit, bricks and the bank's own building could block each other forever |
| 33 | Downtown buildings are built taller (shops 2 floors, banks/offices/apartments more), rising with population | You wanted to see multi-story buildings early |
| 34 | Brickworks can be built from raw materials; founders count unfinished sites' material needs as demand; construction companies only start once planks and bricks are made | Early towns used to stall for weeks with nobody making building materials |
| 35 | Construction loans: developers and builders borrow to pay deposits and finish sites | Towers stalled half-built when the developer ran out of cash |

**Multi-story buildings** (after the 2026-10-23 fix): the first 2-floor shop around day 10, 5–7-floor apartment blocks from about day 20–35, 25–36 multi-story buildings by day 40 and 40–50 by day 60.

### What a typical run looks like (headless tests, 3 different worlds)
| Day | People | Jobs | Companies | Houses | Cars | Deaths |
|---|---|---|---|---|---|---|
| 50 | 130–150 | 45–60 | 70–90 | 7–60 | 0–3 | 0–3 |
| 100 | 280–330 | 65–100 | 115–130 | 180–220 | ~34 | 2–5 |

By day 100 you'll typically see several apartment buildings (up to 8 floors) and offices downtown, 2–3 banks, steel mills, car factories, electronics, textile and furniture factories, shipping companies with trucks, stores and restaurants, and suburbs of houses.

### Known issues (to iterate on)
- **Employment** is about a third of the population by day 100; many people still fish or run one-person businesses. Wages are fixed per contract (negotiation was planned for later), so they barely move.
- Many small companies (100+) instead of a few large ones; corporations with several sites appear, but slowly.
- Cars arrive only after steel mills and car factories exist (around day 50–80).
- Speed: roughly 1 game day per 1–2 seconds at Max with ~300 people in the browser (headless Chrome renders at ~20–30 fps; a real GPU should do better).
- The neural networks only adjust *which kind* of activity people prefer (8 categories); prices, wages and business decisions are still hand-written rules. Many people learn that socializing pays off, so the square gets busy.
- Sometimes people wait at a restaurant or store with nobody working there yet.

---

## 1. Vision

A browser-based simulation of a small population of people living in a small world. They work, gather resources, build buildings, start businesses, hire each other, trade, and use money. A town grows out of empty land purely from the choices individual people make. You watch it happen in a 3D view and on dashboards.

**What it is:**

- An **economy** simulation. The interesting things are markets, prices, wages, ownership, inequality, businesses rising and failing, trust, secrets, and how ideas spread.
- A **learning project** for you, that can also answer "what happens if...?" questions (for example, "what if a famine suddenly hits?").
- A **viewer**. You do not control anything. You can change the speed, move the camera, look at graphs, and inspect any person or building to see what they own and what they are doing and why.
- **Endless.** A run can in principle last forever, so the world has to be able to sustain itself (resources renew, new people arrive), and runs can be saved and resumed.
- **As close to real life as possible.** A decentralized market economy where people act in their own interest and nobody plans the whole thing from above.

**What it is not:**

- Not a technology-progression game. In your words: "this simulation isn't meant to simulate how people evolve from bronze age to some sort of sci fi world, it's supposed to be about the economy and things like that." All kinds of things (buildings, cars, tools) are known to be possible from day one. People get better at making them.
- Not a city builder you play. There is no setup screen and no way to intervene during a run.

---

## 2. Decisions so far

Each topic lists what was decided, with your own words quoted where they carry nuance.

### 2.1 Purpose and control

| Decision | Detail |
|---|---|
| Purpose | A learning project "that can also be a way to simulate what happens if you change things." |
| Control during a run | None besides speed and looking around: "you don't really get to decide anything. you can change the speed and look around to see graphs and all sorts of things about what people are doing." |
| No setup screen | There are no variables to set before starting. |
| How "what if" experiments happen | You ask Claude to change the code: "If I want you can change things you could add something like what if suddenly you add famines or something." The code therefore needs a clean, pluggable way to add events and scenarios. |

### 2.2 Platform and visuals

| Decision | Detail |
|---|---|
| Platform | Runs in the browser. Claude chose the language: **TypeScript**. |
| 3D engine | **Babylon.js**: "I think babylon.js can be a good option but we could also try unity or something but we should probably go with babylon.js for now." |
| What you see | Dashboards plus a 3D map. "you can view individuals and look at what they do. you can have a chart with the richest individuals. you could also see who owns things." |
| 3D style | "Simple but fully 3D," with deep zoom. |
| Level of detail and generated interiors | Your idea, in your words: "a person's location is nothing on the large scale but if you zoom in you could see them walking or you could zoom in closer but it's just generated. you don't store the chairs in a building you just store that it's a building and maybe how many people work there and maybe the floor number but you can actually go in and see chairs that are in generated places." |

The interiors idea means the simulation only stores abstract facts (building type, floors, number of workers). The detailed contents, such as chairs and desks, are generated on the fly from a seed stored with the building. That way the same building always looks the same inside, but none of that detail costs memory or simulation time. This is planned for v0.5.

### 2.3 Scale and persistence

| Decision | Detail |
|---|---|
| Population | "Start small and scale it up." Project goal: **200 to 300 people**. |
| Run length | "Runs could theoretically last forever." |
| Saving | Manual save, plus automatic recovery: "if someone forgets to save they can just get it back when they come back but that's not always possible." |

### 2.4 Lifecycle: death and newcomers

| Decision | Detail |
|---|---|
| Births | No children or families: "I feel like having children or things aren't such a good idea." |
| Population turnover | **Death plus newcomers.** People can die, and new people arrive from outside. |
| Causes of death | "At first we only add starvation and exposure. I think our end goal is all of the above" (old age, illness, accidents). |
| Newcomers' behaviour | New arrivals start with strategies inherited from people who did well (see 2.8). |

### 2.5 The world and its starting state

| Decision | Detail |
|---|---|
| Geography | The city emerges: "people can decide to build buildings and a city would naturally emerge." It starts as empty land. |
| Starting state | "maybe you can start with some food so they don't starve but quickly they start to build houses and things. maybe they start with small houses or huts but it gets renewed." Interpreted as: everyone starts with some food and a simple hut, and huts wear out and get replaced or upgraded over time. |
| Setting | **Modern settlers**: people with present-day knowledge (they know cars, electricity and factories exist) who start from empty land and must build everything up themselves. |

### 2.6 Money and banks

| Decision | Detail |
|---|---|
| Money | "maybe we can make it so that banks or things can create money but because people need to actually buy things they agree on some amount of money." Banks create money by lending, and prices are whatever people agree on. |
| Who can be a bank | Anyone: "anyone can start businesses it's just like real life." There is no central bank, and banks are ordinary businesses. |

### 2.7 Land and government

| Decision | Detail |
|---|---|
| Land | First come, first served, then bought and sold: "like real life... I'd say option one first to claim it then bought/sold is best." |
| Government | **A later phase.** It starts without one, designed so one can be added. You also said "I don't know if we should start with a government but also I think maybe make it as close as real life as possible." |

### 2.8 People: needs, personality, decisions

| Decision | Detail |
|---|---|
| Needs | All of: food and water, shelter and sleep, comfort and luxury, status and social. "several things matter and it's all a matter of how much people value these things and I think different types of personalities value certain things more which could change their algorithm to focus on seeking something." |
| Personality | A spectrum, not archetypes: "every person starts a bit differently it's more like a spectrum. people can adapt maybe at the end goal but never that much." Personality drift is a late, small feature. |
| How people decide | **Utility AI plus tiny neural networks.** You said: "if at all they should only have small neural networks, maybe not any." Utility AI does most of the work. Tiny networks handle specific judgments. |
| Rewards | Each person's reward is their own satisfaction, weighted by their personal values. So two people in the same situation can be "rewarded" differently for the same outcome. |
| How the networks learn | **From their own experience**, and **newcomers inherit** strategies blended from people who did well. Nobody learns by copying others' networks directly. |
| Self-interest | "this is a market economy and it doesn't rely on something central and people don't help each other or anything." People act in their own interest. See open question 9.2. |

### 2.9 Resources and production

| Decision | Detail |
|---|---|
| Resources | Food sources, wood, stone and clay, ores and coal: "also factories can make tools and things." |
| Renewal | **Everything renews**, so the world can sustain itself forever. |
| Production depth | Deep, multi-step chains (for example ore to metal to tools to machines). |
| "Technology" | Replaced by the design-improvement model in section 3. There is no tech tree. |

### 2.10 Businesses, ownership and jobs

| Decision | Detail |
|---|---|
| Who can start a business | Anyone, "just like real life." |
| Ownership | **Start simple, then grow.** One owner per business first. Partners and shares or a stock market come later. |
| Hiring | **Fixed-wage job postings first.** Wage negotiation, raises and pay cuts come in a later development phase. (Your words: "yes job postings but then later negotiations, job wages can change," clarified as "later in development.") |

### 2.11 Trade, logistics and information

| Decision | Detail |
|---|---|
| How goods are traded | **Like real life (mixed):** shops with posted prices for consumers, direct deals and contracts between businesses, and haggling between individuals. |
| Logistics | **Goods physically move.** They are stored in specific buildings and must be carried, by hand at first and later by vehicles. Distance costs time, so transport can be a job or a business. |
| Information | **People only know what they see or hear.** They learn prices and opportunities from their own experience, places they visit, and what people they know tell them, which may be wrong or a lie. |

### 2.12 Trust

In your words:

> "several factors play a role here: if you've known the person for a long time if they've worked together with you, for you, if you've worked for them a long time, you get more trust. some people should be better at communication and it's a spectrum so those people can talk you into more trust. if you think telling them will help you then you tell them. trust isn't the only factor for secrets. you're not going to run a factory yourself"

What this means for the model:

- Trust is **personal**. It's held by one person toward another, not a global score.
- Trust grows with **how long you've known someone** and with **working relationships**: working alongside them, working for them, or having them work for you, especially over a long time.
- **Communication skill** is a personality spectrum. Skilled communicators can talk others into trusting them more.
- Sharing is a **self-interested calculation**: "if you think telling them will help you then you tell them." Trust is one input, not the only one.
- "You're not going to run a factory yourself." Owners must share know-how with workers to run a business at all. Every worker you teach is a potential leak.

### 2.13 Knowledge and secrets

In your words:

> "think: what is most realistic. this is a market economy and it doesn't rely on something central and people don't help each other or anything. I think people can copy off others if it's too blatant but secrets can be kept and probably negotiated. people could even be convinced to tell secrets or something. when considering if to tell someone people assess trust or things."

What this means for the model:

- Knowledge lives in individual people. Nothing is "unlocked" for everyone.
- **Visible** things can be copied. That's copying something "too blatant."
- **Hidden** things can be kept secret, **sold** (negotiated), or **coaxed out** of someone by a persuasive person.
- Whether to tell someone a secret depends on trust and on what the teller gains or loses.

### 2.14 Products and quality

| Decision | Detail |
|---|---|
| What can be made | Everything basic is possible from day one: "the basic ideas for things already exist. everyone from the beginning know they can make buildings but they can change how they make buildings." |
| How things improve | "if someone builds a car, they can do it but they might not do a good job. slowly people can innovate and find out how cars can be made better. people can make cars differently and people might buy them for speed, how good they look, and more. people can change things and would find out what makes things better." |
| Where ideas come from | "individuals don't come up with things on their own which is why they communicate to others." Innovation is mostly social (see 3.6). |
| Hidden physics | **The same in every world**, like real physics. The best way to make a fast car is always the same, so runs can be compared. |
| What buyers know | **Both:** (1) buyers see visible qualities (looks, size) and can test some (speed), but hidden qualities (durability) are only learned after use or from other people's word. Also (2) makers can advertise and make claims, which may be false, and trust in the maker decides whether buyers believe them. |

---

## 3. Innovation without a tech tree

### 3.1 Why there is no tech tree

A tech tree is a game mechanic: a central list where someone decides what can exist and in what order, and an "unlock" applies to everyone at once. That clashes with a decentralized economy where knowledge belongs to individuals, and it would make this a story about progress through the ages, which is explicitly not the goal.

A simulation can only contain what its rules allow, so we still write the world's **physics**: which materials exist, which kinds of products exist, and how design choices turn into real qualities. The question is how people come to make things *well*.

### 3.2 The design model

Every product, whether a car, a house, a loaf of bread or a factory machine, is made from a **design**:

1. **Design choices.** The maker decides things like engine size, body material, weight, number of seats and how much effort goes into the finish. Each choice costs materials and labour.
2. **Hidden physics.** Fixed formulas, the same in every world, turn the design into **qualities** such as speed, looks, durability, comfort, safety and running cost. They include trade-offs and diminishing returns. A bigger engine is faster but costs more and burns more fuel. A lighter body is faster but breaks sooner. Makers don't know these formulas; they discover their shape by building, testing and talking.
3. **Execution (skill).** How closely the real product matches the design depends on the skill of the maker and their workers. Beginners waste material, make defects and get uneven quality. Skill grows by doing the work, and it passes to others mainly by working alongside someone for a long time.
4. **The secret sauce (process).** Beyond the design, there's *how* it's made: exact settings like temperatures, ratios, timing and order of steps. These change cost and quality and are the main kind of trade secret.

### 3.3 Buyers want different things

Buyers value qualities differently according to their personality. A status-seeker pays for looks, a practical person for durability and a low price, and someone else wants speed. **There is no single "best car"**, so different makers can each find a niche, and real product variety appears.

### 3.4 Feedback and reputation

- **Makers learn** from testing their own products ("how fast did it go, did it break?") and from the market ("did it sell, at what price, did buyers come back?").
- **Buyers learn** from using products. Hidden qualities like durability only show over time.
- **Reputation is personal, and it spreads by talk.** A buyer remembers how a maker's product held up and tells people they know. Over time this becomes a brand reputation, but it's held in people's heads, not in a global score.
- **Advertising and lying.** Makers can make claims about hidden qualities. Each buyer decides whether to believe a claim based on their trust in the maker and what they've heard. Lying can pay off briefly but damages trust when the truth shows.

### 3.5 Trial and error, with tiny neural networks

A maker adjusts their design or process a little, sees what happens and keeps what works. Bold, risk-tolerant personalities try bigger and riskier changes, while cautious ones make small tweaks.

This is the most natural home for the **tiny neural networks**. Each maker has their own small learned model of "if I change this, what happens to quality, sales and profit?", trained only on what *they* have experienced or been told. The training is weighted by how much they trust each source. Two makers with different histories will believe different things about the same product, some of which will be wrong.

### 3.6 Innovation is social

Your point: "individuals don't come up with things on their own which is why they communicate to others." So in this model a person working alone improves only slowly, and most new ideas come out of conversations. Here's a concrete proposal for how that works:

**What people carry around:**

- **Observations:** facts from their own experience, such as "when I baked at a higher heat, the bread sold faster" or "the car I bought from Ada broke after a month." Each has a source and a confidence level.
- **Beliefs:** their current understanding of what design and process choices lead to (this is their tiny network's learned model, or a simple table before networks exist).

**When people talk** (at work, at the market, at home, while idle), each side decides what to share:

- They share an observation if they expect it to help them more than it hurts them. Telling your own employee how to work faster helps your business. Telling a competitor your process hurts you. Telling a long-time friend builds goodwill.
- **Trust** in the listener, **competition** with them and the **expected gain** all go into that choice. As you said, trust isn't the only factor.
- **Communication skill** matters both ways. Good communicators get their point across accurately, and are better at drawing information out of others, including secrets.
- People can **deliberately mislead**: share something false to throw off a competitor. The listener weighs everything they hear by their trust in the speaker.

**How new ideas are born:**

- An **idea** is a proposed change to a design or process ("what if we used a lighter frame?").
- Ideas mainly come from **combining knowledge from different people.** When two people talk and their experiences differ, there's a chance the conversation produces an idea neither would have had alone. A woodworker and a car maker talking might produce "build the frame from lighter wood." The more different their experiences, the higher the chance. Two people who know exactly the same things rarely spark anything new.
- A person can also get an idea alone, from their own experiments, but this is **rare**.
- An idea is only a guess. Whoever has it may decide to **experiment** (spend time and materials to try it), and the hidden physics decides whether it actually works.

**What should emerge from this, without being programmed directly:**

- Places where many different people talk (markets, workplaces, dense neighbourhoods) become **idea hubs**. Isolated people innovate slowly.
- Businesses with many experienced workers who talk to each other improve faster, and also **leak** more.
- Persuasive, sociable people gather more knowledge than quiet ones.
- Secrets **spread slowly and unevenly** through trust networks rather than instantly.

### 3.7 Copying versus secrets

| Visible (can be copied) | Hidden (can be kept secret) |
|---|---|
| Shape, size, colour, number of seats, top speed when tested | Exact process settings, internal design, supplier tricks |
| Anyone who sees or buys the product learns these | Learned only by doing the work, being told, or reverse engineering with effort |

**How secrets escape:**

- An employee who learned it on the job leaves
- Someone is talked into revealing it
- It's sold
- A competitor buys the product and takes it apart

**How owners protect them:**

- Hire people they've trusted for a long time
- Pay well, so workers are less tempted to leave
- Split the process so each worker only knows one step
- Simply accept the risk

### 3.8 The same model applies to everything

| Product | Example design choices | Resulting qualities |
|---|---|---|
| House | floors, floor area, wall material, insulation, windows, finish | capacity, comfort, warmth (protection from exposure), durability, looks, build cost and time |
| Bread | flour type, ingredient ratio, baking heat and time | taste, cost, shelf life |
| Factory machine | build material, precision, size, power source | output speed, breakdown rate, running cost |
| Car | engine size, body material, weight, seats, finish | speed, looks, durability, comfort, safety, fuel use |

---

## 4. Proposed product list (for you to edit)

You asked me to propose this. It's sized for "modern settlers": people who know modern things exist but have to build everything up. **Everything here is a proposal. Add, remove or rename freely.** Not all of it will be in early versions (see the roadmap).

### 4.1 Raw resources (all renew)

| Resource | Where it comes from | Renews by |
|---|---|---|
| Crops (grain, vegetables) | fertile land, farmed | regrowing each season |
| Wild food | forest, meadows (foraging) | regrowing |
| Fish | water | slowly refilling |
| Livestock | pasture, farmed | breeding |
| Wood | forest | trees regrowing (slowly) |
| Stone | rock outcrops, quarries | slow regeneration (deliberately unrealistic, per "everything renews") |
| Clay and sand | riverbanks, shores | slow regeneration |
| Iron ore | ore deposits | slow regeneration |
| Copper ore | ore deposits | slow regeneration |
| Coal | coal seams | slow regeneration |
| Crude oil | oil deposits | slow regeneration |
| Fibre (cotton, wool) | farmed | regrowing |
| Water | rivers, wells | always available, may need a well or pipes |

### 4.2 Processed materials

| Material | Made from |
|---|---|
| Planks / lumber | wood |
| Bricks | clay plus fuel |
| Cement / concrete | stone, sand, fuel |
| Glass | sand plus fuel |
| Steel | iron ore plus coal |
| Copper wire | copper ore |
| Plastic | crude oil |
| Fabric | fibre |
| Fuel (petrol/diesel) | crude oil |
| Electricity | a power plant burning coal or fuel (later: water, wind) |

### 4.3 Consumer goods

| Good | Satisfies |
|---|---|
| Groceries (raw and packaged food) | hunger |
| Prepared meals (restaurants) | hunger plus comfort and status |
| Clothing | warmth (exposure), comfort, status |
| Furniture | home comfort |
| Household appliances | comfort, saves time |
| Bicycles | faster travel |
| Cars | much faster travel, status |
| Simple electronics (later) | comfort, status |

### 4.4 Capital goods (things used to make other things)

- Hand tools (boost worker output, wear out)
- Factory machines (big output boost, need power and maintenance)
- Trucks and vans (move many goods quickly)
- Farm machinery
- Generators

### 4.5 Buildings

| Kind | Examples |
|---|---|
| Homes | hut, house, apartment building |
| Commerce | shop, market stall, restaurant, bank, office |
| Production | farm, sawmill, brickworks, quarry, mine, steel mill, workshop, factory, car factory, power plant |
| Storage and transport | warehouse, depot, road |

Every building has a design (floors, size, materials, finish) with the qualities in 3.8.

### 4.6 Services (jobs and businesses that aren't a physical product)

- Retail / merchant (buy from producers, sell to consumers)
- Restaurant
- Hauling and delivery
- Construction (build for others)
- Banking and lending
- Teaching and training (selling knowledge, which ties into secrets)
- Repair and maintenance
- Real estate and renting
- Healthcare (once illness exists)

### 4.7 Example production chain: a car

```
iron ore + coal  -> steel ------\
sand + fuel      -> glass -------\
crude oil        -> plastic ------> car factory (machines + skilled workers) -> car
fibre            -> fabric ------/
steel + copper wire -> engine --/
```

Each step is a separate business that could be owned by different people, linked by trade and physical transport.

---

## 5. Architecture

### 5.1 Technology stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript | Plain JavaScript with type checking, which catches many mistakes early. Runs in the browser. |
| Build tool | Vite | Fast development server that reloads when code changes. |
| 3D | Babylon.js | Your choice. A full 3D engine with good built-in tools (inspector, picking, instancing). |
| Dashboards | HTML and CSS overlaid on the 3D canvas, plus lightweight charts | Simple and flexible. |

### 5.2 The simulation is separate from the drawing

The most important structural rule: **the simulation core never imports anything from Babylon.js or the page.** It is plain data (people, buildings, goods, tiles) plus "systems": functions that update that data each tick.

This means:

- The simulation can later move into a **Web Worker** (a background thread) so 300 people don't slow down the 3D view.
- It can be **saved and loaded** easily, because the whole state is plain data that converts to JSON.
- It can be **tested without a browser**, for example by running 100 simulated days in Node and checking nobody starves on day 2.

### 5.3 Time

| Concept | Value |
|---|---|
| Tick | **1 tick = 1 game minute**, so 1,440 ticks make a game day. |
| Fixed step | The simulation always advances in whole ticks, whatever the frame rate. |
| Speed control | Changes how many ticks run per real second (pause, slow, normal, fast, very fast). |
| Rendering | The 3D view **interpolates**: it smoothly animates between the last two ticks so people walk smoothly even at low speeds. |
| Efficiency | People don't "think" every tick. They pick an action, carry it out over many ticks, and only decide again when it's finished or something urgent happens (like getting very hungry). |

### 5.4 Randomness and reproducibility

All randomness comes from a **seeded random number generator** whose state is stored in the simulation state. Given the same seed and the same code, a world plays out identically. That makes bugs reproducible and allows fair comparisons ("same world, but with a famine on day 50").

### 5.5 Saving

| Feature | Behaviour |
|---|---|
| Autosave | To the browser's IndexedDB about every 30 seconds of real time, and whenever the tab is hidden or closed. On return, the run resumes. |
| Manual save | Export the whole world as a JSON file, and import it again later. |
| Honest limit | Autosave lives in that one browser on that one computer. Clearing browser data loses it, which is why manual export exists. |

### 5.6 Events and scenarios

"What if" experiments are added in code as **events**. An event is a small, self-contained module that can:

- trigger at a time or under a condition (for example, "on day 50" or "when the population passes 100")
- change the world (for example, a famine: crop yields drop 70% for 30 days)
- log what happened, so it shows in the event log and the graphs

New events are added by asking Claude. They don't require changing the core simulation.

### 5.7 Code layout (v0.2)

```
econsim/
  docs/PLAN.md, docs/WORKLOG.md
  index.html, vite.config.ts (dev fix for the "%" in the folder name)
  dev/                  test benches for the renderers (people, buildings, roads)
  scripts/              headless runs and diagnostics (headless, diag, probe, deaths, cars, roadtest, savesize)
  src/main.ts           game loop (speed, short nights), autosave, load/save/new world
  src/sim/              simulation: no rendering imports
    types.ts config.ts goods.ts (all goods, roles, building kinds)  ctx.ts (lookups, accounts)
    world.ts (terrain, resources)  roads.ts (street plan, growth, lots, routing)  layout.ts (interiors)
    people.ts ai.ts (decisions) tasks.ts (steps) production.ts (shifts by role)
    market.ts (exchange, outside trade)  logistics.ts (shipments, vehicles, couriers)
    firms.ts jobs.ts construction.ts housing.ts finance.ts (banks)  buildings.ts
    social.ts (trust, conversations)  internet.ts (posts)  stats.ts scenarios.ts sim.ts save.ts
  src/render/           Babylon.js: renderer.ts (scene, lights, picking, bubbles), terrain.ts, roads.ts,
                        buildings.ts (procedural models + interiors), people.ts, vehicles.ts, palette.ts
  src/ui/               ui.ts (top bar, tabs, inspectors), internet.ts (Townnet), charts.ts, storage.ts, styles.css
```

---

## 6. v0.1 "Foundation" scope

The goal of v0.1 is a world that runs on its own and is worth watching: people survive (or don't), gather, build, trade with money at prices that change, and start simple businesses, all visible in 3D and on dashboards. It's deliberately a subset; everything else is in the roadmap.

### 6.1 Included in v0.1

**World**
- Tile world of roughly 80 by 80 tiles
- Terrain: grass/fertile land, forest, rock, ore, water
- All resources regrow over time

**Goods**
- food, wood, stone, ore, planks, tools

**People**
- About 30 starting settlers. The population cap is 300.
- Everyone starts with some food and a simple hut.
- Personality traits are **continuous spectra** (for example greed/ambition, work ethic, risk tolerance, sociability, communication, patience). They weight how much each person values each need.

**Needs**
- Hunger, energy (sleep), health
- Shelter and exposure: sleeping without shelter, or in poor shelter, hurts health
- Comfort (from home quality)
- Status (from wealth relative to others)

**Death and newcomers**
- Death from **starvation and exposure only**
- **Newcomers** arrive faster when the town is prosperous (food affordable, jobs available), up to the cap

**Decisions**
- **Utility AI:** each possible action gets a score from that person's needs and personality, and they choose the best
- The **inspector shows why**: the top options and their scores

**Land and building**
- **Claim-first land:** unclaimed land can be claimed by whoever builds on it first
- **Self-built** huts, houses and workplaces
- Materials are **hauled physically** to the building site
- Buildings decay. Huts decay fast and get replaced by better buildings over time.

**Businesses and jobs**
- Workplaces: **farm** (food), **sawmill** (wood to planks), **smithy** (ore and wood to tools)
- **Single-owner businesses** post **fixed-wage jobs** on a job board at the town square

**Market**
- A public **town-square marketplace**
- Sellers physically bring goods and post asking prices
- Prices adapt: lowered when goods don't sell, raised when they sell fast

**Information and trust**
- **Price knowledge comes only from visiting the market or hearing from others.** People share what they've seen when they talk.
- Basic **familiarity and trust** tracking: grows from working together, trading and talking

**Tools**
- Tools boost productivity and wear out

**3D view (Babylon.js)**
- Terrain, trees, rocks
- Buildings with visible floors
- People walking
- Click any person or building to inspect it
- Ownership colour overlay

**Dashboard**
- Clock and speed controls
- Charts: population, prices, total money, employment, inequality
- Richest-people leaderboard
- Ownership list
- Event log
- Person and building inspector

**Saving**
- Autosave and resume, plus manual export and import

### 6.2 Status of v0.1 (built 2026-10-22)

**Run it:** `cd econsim && npm run dev`, then open the address it prints (http://localhost:5173). `npm run headless -- 60 12345` runs 60 days without graphics.

Everything in 6.1 exists and runs. Differences from the plan above:
- The map is **128 x 128 tiles of 10 m** (about 1.3 km across), not 80 x 80.
- **Food spoils** at 3% a day wherever it is, so overproducing food has a cost.
- **Buyers can leave standing bids** at the square (money held until filled or expired after 2 days). Bids are how sellers and would-be business owners see demand for things nobody sells yet (e.g. the first planks).
- Construction sites with **no progress for 7 days are given up**.
- People are drawn **larger when the camera is zoomed out** so they stay visible.
- Speeds: pause, 1x (real time), 10x, 60x, 600x (default), 1 game hour per second, and max.

**What you'll typically see:** settlers fish and forage, trade food, a few farms appear, someone opens a sawmill once enough people want planks for houses, smithies follow, tools sell at a high price and then get cheaper as competitors open. Houses replace huts, newcomers take over the empty huts, and inequality (Gini) climbs from ~0.1 to ~0.5-0.7 over 50 days.

**Known issues (to iterate on):**
- **Few jobs.** Most businesses end up run by the owner alone; employment peaks early then fades. Fixed wages set when prices were higher become unaffordable as prices fall.
- **Steady deflation.** Money only enters with newcomers while output grows, so all prices drift down. (Banks in v0.3 will change this; a good experiment.)
- **Net worth of business owners can look inflated**: stock is valued at the last trade price even if it wouldn't sell.
- People sleep a lot (about 9-10 h) and rest when nothing pays; it's rational but looks idle.
- Performance: ~3,000 game minutes per second with ~40 people; it will slow down toward 300 people (Web Worker planned for v0.5).
- No neural networks yet (v0.2).

### 6.3 Deliberately not in v0.1

- Neural networks (heuristics first, networks in v0.2)
- Banks and money creation
- Merchant-owned shops and business-to-business contracts
- Wage negotiation
- Construction, hauling and other service businesses
- Renting and land sales
- The design and quality model from section 3
- Advertising
- Zoom-in interiors
- Government
- Old age, illness and accidents
- Cars and most of the product list

---

## 7. Defaults I chose without asking (please review)

You stopped the questions before these were discussed, so Claude picked reasonable defaults to get v0.1 running. **None of these are final.** Change any of them.

| # | Default | Why this default | Alternatives |
|---|---|---|---|
| 1 | **Starting cash: 50 per settler, equal for everyone.** No bank exists yet, so this is the only money at the start. | Money has to exist somehow before banks are built (v0.3). | Unequal starting cash, no cash (barter first), a founding bank |
| 2 | **Newcomers bring a little food and cash from outside.** | Otherwise they'd arrive and die before finding work. It also slowly adds money to the town. | Arrive with nothing, or arrive with skills instead of goods |
| 3 | **A public town-square market exists from day one**, owned by nobody, as a stand-in until people can open shops. | Without some place to trade, the early economy can't get started. | No market at first (pure barter between neighbours), or the first shop must be built by someone |
| 4 | **Sellers are paid instantly, even when not present** (consignment). They leave goods at the market with a price and get paid when someone buys. | Otherwise sellers would stand at the market all day. | Seller must be present; or a merchant buys from them up front |
| 5 | **A dead person's goods and money stay in their home**, and belong to whoever claims the abandoned building. Their land becomes unowned. | No children and no government means no heirs. This is the closest "real life without a state" answer. | Goods vanish; goods auctioned; the town takes them (once a government exists) |
| 6 | **The owner's personal money is the business's money.** | Simplest form of single-owner business. | Separate business accounts (needed later for shares and bankruptcy) |
| 7 | **Self-build only.** People build their own buildings, and nobody can be hired to build yet. | Construction firms come with v0.3. | Allow hiring builders from v0.1 |
| 8 | **1 tick = 1 game minute.** | Fine enough for smooth walking, coarse enough to be fast. | 1 tick = 10 game minutes |
| 9 | **Map 128 by 128 tiles of 10 m.** | Room for a town of up to 300 people plus countryside. | Larger, or growing over time |
| 10 | **Starting population 30.** | Small enough to follow individuals, large enough for trade and jobs. | 10 or 50 |
| 11 | **Speed range from pause to very fast**, where very fast is many game hours per real second. | You asked to be able to change speed. Exact values will be tuned. | (specific values to tune) |
| 12 | **Six goods and three workplace types in v0.1** (food, wood, stone, ore, planks, tools; farm, sawmill, smithy). | Smallest set that still has a chain (ore and wood to tools) and capital goods. | Include clay and bricks from the start |
| 13 | **Huts wear out quickly.** Reading of "it gets renewed": huts are replaced by better buildings over time. | Your words suggested huts are temporary. | Huts don't decay, and people only upgrade by choice |
| 14 | **Trust and price info spread by talk in v0.1 at a basic level only** (familiarity from time together, simple sharing of prices seen). | Full trust and secrets need the v0.2 machinery. | No talk in v0.1 at all |
| 15 | **Prices adapt by simple rules** (cut if unsold, raise if sold out quickly) until neural networks arrive in v0.2. | Gets realistic price movement without learning yet. | Fixed prices in v0.1 |
| 16 | **Newcomer arrival depends on prosperity** (affordable food, open jobs), with a small steady trickle. | Realistic: people move to where opportunity is. | Fixed arrival rate; only arrive when someone dies |
| 17 | **Everyone is purely self-interested in v0.1.** | Matches "people don't help each other or anything." | Some people on the spectrum are generous (see 9.2) |
| 18 | **Food spoils 3% per day.** | Without it, food piled up forever and prices meant nothing. | Different rates per food type (later) |
| 19 | **Standing bids at the square.** | Lets demand for not-yet-made goods be visible, so the first sawmill/smithy has a reason to exist. | Buyers could only take what's on offer |
| 20 | **Abandoned construction after 7 days without progress.** | Stops land from being blocked forever by stuck projects. | Longer/shorter, or sell the site |

---

## 8. Roadmap

Each version builds on the last. Events like a famine can be added **at any point**: just ask.

### v0.1 Foundation (built 2026-10-22)
See section 6, including 6.2 for status and known issues.

### v0.2 Smarter people
- **Tiny neural networks** for specific judgments: what price to ask, whether to take a job, whether to try an experiment. Each learns from that person's own personal reward.
- **Newcomers inherit** strategies (network weights) blended from people who did well.
- Richer **trust**: long-term memory of dealings, working relationships, communication skill shaping trust.
- **Gossip** about prices, jobs and people, which can be wrong or deliberately false.
- **Secrets**: knowledge that belongs to individuals, deciding whether to share it, being persuaded to reveal it, selling it.

### v0.3 Money and business
- **Banks** that anyone can found: deposits, loans that create money, interest, defaults, bank failures and bank runs.
- **Merchant-owned shops** replacing the public market as the main way consumers buy.
- **Business-to-business deals and contracts** (supply agreements).
- **Hauling / delivery** and **construction** businesses.
- **Renting and landlords**, **land sales**.
- Separate business accounts, and **bankruptcy**.
- Later in this phase: **partners and shares**.

### v0.4 Products and design innovation
- The **design model** from section 3: design choices, hidden physics, qualities, skill.
- **Visible and hidden qualities**, **advertising and lying**, **reputation** spreading by talk.
- **Social innovation**: ideas born from conversations between people with different experiences.
- **Process secrets** and copying.
- Gradually add the **product list** from section 4 (bricks, glass, steel, clothing, furniture, vehicles...).

### v0.5 World and visuals
- **Zoom levels of detail**: town overview, then street level with people walking, then inside buildings.
- **Generated interiors** from a seed stored per building (your chairs idea).
- **Emergent roads** where people walk often.
- **Day and night**.
- **Scale to 300 people**, moving the simulation into a Web Worker if needed.

### v0.6 and later
- **Wage negotiation**, raises, pay cuts.
- **Stock market**.
- **Government** that can emerge (council, taxes, rules, maybe patents).
- **Old age, illness, accidents**.
- **Small personality drift** from life experience ("never that much").

---

## 9. Open questions for later

Topics we haven't discussed yet. Each one has a temporary default where v0.1 needs one.

### 9.1 Crime, fraud and enforcing agreements
- Can people steal, cheat on deals, or break promises (for example, not paying a promised wage, not repaying a loan)?
- Without a government, what stops them? Only reputation and trust? Private security businesses?
- *v0.1 default:* the simulation itself guarantees that trades and wages happen as agreed. Nobody can steal or cheat.

### 9.2 Is everyone self-interested?
- You said "people don't help each other or anything." Does that mean **everyone** is purely self-interested? Or that there's no built-in charity system, but some people on the personality spectrum could still be generous (help a friend, share food)?
- *v0.1 default:* everyone is self-interested (default 17).

### 9.3 A dead person's property
- What should happen to their home, land, goods, money, and businesses (and their employees)?
- *v0.1 default:* see default 5.

### 9.4 Housing
- Can people rent homes or rooms from others? Share a home with roommates?
- Is there homelessness, and what does it look like?

### 9.5 Newcomers
- What exactly do they bring (money, goods, skills, knowledge of other places)?
- Can people also **leave** the town if things go badly?

### 9.6 Where do newcomers' inherited strategies come from?
- "People who did well" by whose measure: wealth, their own satisfaction, survival time? Since rewards differ per person, this needs a definition.

### 9.7 Dashboard extras
Which other views would you want? Some ideas:
- Price history per good
- Wage levels
- A map of who owns which land
- Supply chain diagrams
- A "life story" view per person
- A trust network graph
- Business profits

### 9.8 Leisure and social life
- Do people need free time, friends, or entertainment as part of "status and social"?
- Do they ever socialise without an economic reason?

### 9.9 Skill
- How fast should people learn by doing, and can they forget skills they stop using?

### 9.10 Water
- Is water a separate need from food, and does it need to be fetched or bought?

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Utility AI | A decision method: list every action a person could take, give each a score ("utility") based on their needs and personality, pick the highest. Easy to explain because you can see the scores. |
| Neural network (tiny) | A small learnable function that takes some numbers in (for example current price, stock left) and gives a number out (for example new price). It improves by adjusting itself after seeing how well its outputs worked. |
| Reward | The signal a learning system tries to increase. Here, each person's own satisfaction, weighted by what they personally value. |
| Tick | One step of the simulation. Here 1 tick is 1 game minute. |
| Interpolation | Drawing smooth in-between positions between two ticks so movement looks fluid. |
| Seed / seeded RNG | A starting number for the random number generator. The same seed always gives the same "random" sequence, so runs are reproducible. |
| Deterministic | Same inputs always produce exactly the same outputs. |
| Level of detail (LOD) | Showing less detail for things far away and more as you zoom in, to save work. |
| Web Worker | A background thread in the browser, so heavy computation doesn't freeze the page. |
| IndexedDB | A database built into the browser for storing larger amounts of data locally. |
| Consignment | Leaving goods with a seller (here, the market) who sells them for you and passes on the money. |
| Gini coefficient | A standard measure of inequality from 0 (everyone has the same) to 1 (one person has everything). |
| Hidden physics | The fixed formulas that decide how a design turns into real qualities. People don't know them and discover them through experience and conversation. |
