// The whole simulation state is plain JSON-compatible data: no classes, no
// Maps, no references between objects (only ids). That keeps saving/loading
// trivial and lets the simulation move to a Web Worker later.
//
// Ids are globally unique across people, firms, buildings, lots, roads,
// vehicles, contracts, orders… (one counter), so an "owner" id can point to
// either a person or a firm.

import type { RngState } from './rng';

// ------------------------------------------------------------------- goods

export const GOODS = [
  'crops', 'produce', 'milk', 'livestock', // from farms: grain, fruit & vegetables, milk, animals for meat
  'wood', 'stone', 'clay', 'ore', // raw (logging, quarries, clay pits, mines)
  'groceries', 'bread', 'dairy', 'meat', // food (packaged groceries, bakeries, dairies, meat plants)
  'planks', 'bricks', 'steel', 'concrete', 'glass', // processed
  'tools', 'furniture', 'clothes', 'computers', 'cars', // manufactured
] as const;
export type Good = (typeof GOODS)[number];
export type Inventory = Record<Good, number>;

/** Where the highway leaves the map: outside suppliers' trucks come in and outside buyers' trucks leave here (an order's or shipment's site). */
export const GATE = -2;

export type TileKind = 'grass' | 'forest' | 'rock' | 'water';
/** Natural resources companies extract (nobody gathers by hand for a living in a modern city). */
export type ResourceKind = 'wood' | 'stone' | 'clay' | 'ore';

export interface World {
  size: number; // tiles per side
  tile: number; // meters per tile
  height: number[];
  kind: TileKind[];
  fertility: number[]; // 0..1
  wood: number[];
  stone: number[];
  clay: number[];
  ore: number[];
  forage: number[];
  fish: number[];
  forageCap: number[];
  /** Bumped when terrain heights change (lots graded for building), so the ground mesh can follow. */
  hver?: number;
  fishCap: number[];
  oreCap: number[];
  clayCap: number[];
  /** 1 where a road, lot or building covers the tile (nature cleared). */
  used: number[];
  ver: number; // bumped when resources change enough to redraw nature
}

// ------------------------------------------------------------------- roads

export type RoadKind = 'avenue' | 'street' | 'country';
export type Zone = 'core' | 'urban' | 'suburb' | 'industrial' | 'rural';

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  edges: number[];
}

export interface RoadEdge {
  id: number;
  a: number; // node ids
  b: number;
  kind: RoadKind;
  width: number; // asphalt width in meters (sidewalks are extra, see SIDEWALK)
  len: number;
  /**
   * Roads have to be built. A newly laid-out street is a surveyed dirt track
   * (built = false): usable on foot and slowly by car, lots along it can be
   * sold and built on. Paving it is a public-works project. undefined = paved.
   */
  built?: boolean;
  /** 0..1 paving progress while not built (fraction of the length paved, from end a). */
  progress?: number;
  /** A road crew is working on it right now (cones, machines). */
  active?: boolean;
  /** The government has decided to pave it (crews work on it). */
  paving?: boolean;
  /** Street name ("Main Street", "Oak Avenue", "Route 9"). */
  name?: string;
}

/**
 * A parcel of land along a road. Buildings always sit on a lot and face the
 * road. `angle` is the direction from the lot's center toward the road.
 */
export interface Lot {
  id: number;
  edge: number;
  side: 1 | -1;
  t: number; // 0..1 position along the edge
  x: number; // center
  y: number;
  angle: number;
  w: number; // frontage width
  d: number; // depth
  zone: Zone;
  /**
   * Person or firm id. Land is always owned: public land belongs to a
   * government's administration firm, land outside every government's claim
   * to the Territory (TERRITORY.id). -1 only transiently.
   */
  owner: number;
  building: number; // -1 = empty
  forSale: number; // asking price, 0 = not for sale
  /** Last price it sold for (assessments start from it). */
  lastSale?: number;
}

/** A street in the town's master plan, built once the city reaches it. */
export interface PlannedRoad {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: RoadKind;
  done: boolean;
  name?: string;
}

export interface Roads {
  nodes: RoadNode[];
  edges: RoadEdge[];
  lots: Lot[];
  plan: PlannedRoad[];
  ver: number;
}

// ---------------------------------------------------------------- people

export interface Traits {
  diligence: number;
  ambition: number;
  risk: number;
  sociability: number;
  communication: number;
  patience: number;
  comfortLove: number;
  curiosity: number; // also "openness" for politics
  agreeable: number; // compassion/politeness (Big Five agreeableness)
}

export interface Needs {
  food: number; // 0..100 (100 = full)
  energy: number;
  health: number;
  social: number;
  fun: number;
}

export interface Looks {
  skin: number; // index into a palette
  hair: number; // hair color index
  hairStyle: number; // 0 bald/short … 3 long
  shirt: number; // hue 0..1
  pants: number; // hue 0..1
  height: number; // meters
  build: number; // width multiplier
}

/** What a place is to someone: somewhere to shop, eat, buy a car, work, live, or go out. */
export type PlaceKind = 'shop' | 'food' | 'car' | 'job' | 'home' | 'out';
/** How they came to know it. */
export type PlaceSource = 'near' | 'route' | 'visit' | 'friend' | 'ad' | 'search' | 'asked';

/** A place someone knows of (see places.ts). */
export interface KnownPlace {
  b: number; // building id
  k: PlaceKind;
  src: PlaceSource; // how they first heard of it
  via?: number; // who told them (a person), whose ad (a company), or which website
  t: number; // last time it came to mind: seen, heard of, visited
  seen?: number; // last visit (tick)
  op?: number; // what they think of it, -1 (avoid) … 1 (love it)
  ch?: AdChannel; // learned from an ad: which kind (to credit the ad when they first go there)
}

export interface PriceBelief {
  p: number;
  t: number;
  src: 'guess' | 'seen' | 'heard' | 'traded' | 'online';
}

export interface Relation {
  fam: number; // hours spent together
  trust: number; // 0..1
  bad: number; // grievances
  last: number; // tick of last meeting
}

export type Role =
  | 'farmhand' | 'logger' | 'quarrier' | 'miner' // primary
  | 'worker' // processing / manufacturing floor
  | 'cashier' | 'cook' | 'waiter' // services
  | 'driver' | 'builder' | 'clerk' | 'manager'
  | 'presenter' | 'journalist' | 'programmer' // media and internet
  | 'sales' // sales reps and ad sales (they find customers for the company)
  | 'official' | 'civil' | 'officer'; // government: officials, civil servants, police

/** What the body is doing, for animation. */
export type Pose =
  | 'stand' | 'walk' | 'sit' | 'type' | 'manual' | 'carry' | 'talk'
  | 'eat' | 'sleep' | 'drive' | 'cook' | 'serve' | 'build' | 'gather'
  | 'watch' // sitting, watching a screen (TV)
  | 'phone' // looking at a phone (standing, walking or sitting)
  | 'speech' // giving a speech: standing, emphatic arm gestures
  | 'cheer' // in a crowd: clapping, arms up now and then
  | 'protest' // holding a sign up, chanting
  | 'vote'; // at a voting booth, marking a ballot

export type Step =
  | { k: 'go'; to: Place; ride?: boolean } // travel (walk, drive, or ride with a ride-hailing app) to a place
  | { k: 'sleep' }
  | { k: 'idle'; mins: number; label: string; pose?: Pose }
  | { k: 'chat'; mins: number }
  | { k: 'browse'; mins: number } // use a computer at home
  | { k: 'build'; bid: number; mins: number }
  | { k: 'work'; contract: number; until: number } // a shift
  | { k: 'ownWork'; bid: number; until: number } // owner working their own site
  | { k: 'shop'; store: number; good: Good; qty: number; max: number; device?: 'phone' | 'tv'; list?: Partial<Record<Good, number>>; exp?: Partial<Record<Good, number>> } // retail (electronics bought as a phone or TV; a food basket as a list, with the prices they expect)
  /** Order online (from a local store's web shop, a marketplace, or an outside retailer): delivered to their home. */
  | { k: 'order'; seller: number; good: Good; qty: number; price: number; via: number; device?: 'phone' | 'tv'; meal?: boolean }
  | { k: 'gig'; app: number; mins: number } // work for a gig app (deliveries or rides) for a while
  | { k: 'daylabor'; bid: number; mins: number } // casual work on a construction site, paid in cash by the builder
  | { k: 'crowdfund'; kind: BuildingKind; goal: number } // ask the crowd to fund a business they can't afford
  | { k: 'soup'; polity: number } // a free meal at the city's soup kitchen (city hall), paid from the welfare budget
  | { k: 'claim' } // file a welfare claim (in person, at city hall)
  | { k: 'eatOut'; restaurant: number }
  | { k: 'deliver'; bid: number } // drop carried materials at a site / business
  | { k: 'pickup'; bid: number; good: Good; qty: number }
  | { k: 'store' } // put carried goods in the pantry at home
  | { k: 'fetch'; shipment: number } // pick up (part of) a shipment on foot
  | { k: 'drop'; shipment: number } // hand it over at its destination
  | { k: 'apply'; posting: number }
  | { k: 'rent'; bid: number; unit: number }
  | { k: 'attend'; event: number; until: number } // be at a civic event (session, speech, rally, protest, debate)
  | { k: 'vote'; election: number }
  | { k: 'watch'; mins: number } // TV at home
  | { k: 'phone'; mins: number } // scroll the Net on a phone, wherever they are
  | { k: 'canvass'; candidate: number; mins: number } // knock on doors for a campaign
  | { k: 'poster'; ad: number } // tape a flyer to the lamp here (ad = sponsor id)
  | { k: 'speak'; event: number; until: number } // the speaker at a speech / rally / session / debate
  | { k: 'plan'; kind: BuildingKind; floors: number; forFirm?: number }
  /** Start a company: build its first site (on `lot`, `floors` high, for developments), or lease a vacant unit (building id). */
  | { k: 'found'; kind: BuildingKind; lease?: number; floors?: number; lot?: number; redevelop?: number }
  | { k: 'look' }; // look around here (help-wanted and for-rent signs)

/** A destination: a building's door, or a point in the wild. */
export type Place =
  | { t: 'bld'; id: number }
  | { t: 'pt'; x: number; y: number };

export interface Task {
  label: string;
  steps: Step[];
  i: number;
  elapsed: number;
  started: number;
  /** Scratch memory for multi-phase steps (e.g. a driver's current delivery). */
  mem?: Record<string, number>;
}

export interface DecisionOption {
  label: string;
  score: number;
  why: string;
}

export interface DecisionRecord {
  t: number;
  chosen: string;
  why: string;
  options: DecisionOption[];
}

export interface ChatLine {
  t: number;
  who: number;
  text: string;
}

export interface Person {
  id: number;
  name: string;
  looks: Looks;
  traits: Traits;
  needs: Needs;
  // where they are
  x: number;
  y: number;
  px: number; // previous tick position (render interpolation)
  py: number;
  heading: number;
  pose: Pose;
  inside: number; // building id they're inside, -1 = outdoors
  seat: number; // workstation / seat index inside the building, -1 = none
  driving: number; // vehicle id while driving, -1 = on foot
  path: number[]; // flat [x0,y0,x1,y1,...] waypoints still ahead
  // what they have
  money: number;
  inv: Inventory; // carried
  pantry: Inventory; // kept at home
  /** Remaining life (days) of clothes, furniture, computer, phone, TV… (phones and TVs are electronics, bought as 'computers' units). */
  durables: Partial<Record<Good | 'phone' | 'tv', number>>;
  toolWear: number;
  // their life
  home: number; // building id, -1 = homeless
  unit: number; // apartment unit index in that building
  job: number; // contract id, -1 = none
  car: number; // vehicle id, -1 = none
  owned: number[]; // building ids owned personally
  firms: number[]; // firms they own
  projectId: number; // a building they're building themselves
  skills: Partial<Record<Role, number>>; // experience in hours
  // their mind
  task: Task | null;
  hourly: number; // what they think an hour of their work is worth
  prices: Record<Good, PriceBelief>;
  demandSeen: Record<Good, number>;
  supplySeen: Record<Good, number>;
  bidSeen: Record<Good, number>;
  knownJobs: number; // tick they last saw job postings
  knownHomes: number; // tick they last saw housing listings
  /** The places they know of: shops, restaurants, employers, flats, parks (see places.ts). */
  places?: KnownPlace[];
  /** What they've eaten lately (food -> recent portions, fading daily): variety makes meals more enjoyable. */
  ate?: Partial<Record<Good, number>>;
  rel: Record<number, Relation>;
  decision: DecisionRecord | null;
  activity: string;
  sleeping: boolean;
  said: ChatLine[]; // their last few lines of conversation
  saying: string; // speech bubble text right now ('' = silent)
  sayingUntil: number;
  arrived: number;
  earned: number;
  exposure: number;
  mood: number; // 0..1, for posts and conversation tone
  /** Plans that recently failed (e.g. no land found), keyed by option, with the tick they may be tried again. */
  cooldown: Record<string, number>;
  /** Tick they were born (negative: before the world began). */
  born: number;
  /** Years of schooling (8 = basic, 12 = high school, 16 = college, 18+ = graduate). */
  edu: number;
  /** Where they came from (flavor; shapes politics a little). */
  origin: string;
  /** Political views, loyalties and media habits. */
  pol: Politics;
  /** 0..1 how happy they are with their life (income, possessions, home, needs), smoothed daily. */
  happy: number;
  /** People following them on social networks (influencers have many; companies pay them for posts). */
  followers?: number;
  /** Gig work: the app they drive/deliver for, and what they earned on it recently. */
  gig?: { app: number; earned: number; jobs: number };
  /** Where their money is: online banking customers of a bank (firm id). */
  bank?: number;
  /** A tiny neural network that learns, from this person's own experience, which kinds of activity pay off. */
  brain?: Brain;
  /** What the brain needs to learn from the task in progress. */
  brainMem?: { cat: number; x: number[]; s0: number; t0: number };
}

// ---------------------------------------------------------------- politics

export type Issue = 'taxes' | 'welfare' | 'housing' | 'growth' | 'ownership' | 'order' | 'democracy' | 'roads';
export const ISSUES: Issue[] = ['taxes', 'welfare', 'housing', 'growth', 'ownership', 'order', 'democracy', 'roads'];

/**
 * A person's politics. Positions are in standard-deviation units (~N(0,1)):
 * econ < 0 = left (redistribution, public ownership), > 0 = right (markets);
 * auth < 0 = libertarian (liberty), > 0 = authoritarian (order). Starting
 * positions follow from who they are (traits, schooling, age, wealth, work),
 * then drift with their interests, media, friends and what happens to them.
 */
export interface Politics {
  econ: number;
  auth: number;
  /** Where their interests would put them (recomputed now and then); positions drift toward it. */
  anchorEcon: number;
  anchorAuth: number;
  /** Issue-specific shifts from life events (job loss -> welfare +), decaying. */
  tilt: Partial<Record<Issue, number>>;
  /** Short-lived persuasion from ads, TV, posts and speeches (half-life ~3 days). */
  pEcon: number;
  pAuth: number;
  engagement: number; // 0..1 interest in politics
  party: number; // member of (party id), -1
  partyId: number; // identifies with (votes for), -1
  partyStrength: number; // 0..1
  /** Recognition 0..1 per government (polity id): how far they accept its rules as binding. */
  rec: Record<number, number>;
  /** Name recognition 0..1 per candidate (person id) and brand (firm id), decaying. */
  aware: Record<number, number>;
  tv: number; // favorite channel (studio firm id), -1
  sites: number[]; // Net sites they have accounts on (firm ids)
  voted: number; // tick of their last vote
  votedFor: number; // who they voted for last (person id)
  sameSide: number; // consecutive votes for the same party (party ID forms after 2)
  grievance: number; // 0.. how aggrieved they are with the government
  threshold: number; // share of visible protesting contacts that makes them join
  protesting: number; // protest event id, -1
  contacted: number; // tick a campaign last knocked on their door
  /** Bad impressions of candidates from attack ads (person id -> 0..1), fading. */
  neg?: Record<number, number>;
}

export interface Brain {
  w1: number[]; // inputs x hidden
  b1: number[];
  w2: number[]; // hidden x outputs
  b2: number[];
  base: number; // running average reward (baseline)
  n: number; // how many experiences it has learned from
}

// --------------------------------------------------------------- buildings

export type BuildingKind =
  | 'trailer' // a mobile home, bought from an outside dealer and set on a lot (where newcomers start out)
  | 'house'
  | 'apartments' // modern mid-rise apartment block (3–10 floors)
  | 'tower' // residential high-rise (10–50 floors), shops on the ground floor downtown
  | 'officetower' // office high-rise built by a developer and leased out floor by floor
  | 'farm' | 'vegfarm' | 'dairyfarm' | 'ranch' // grain, fruit & vegetables, dairy cows, livestock
  | 'lumberyard' | 'quarry' | 'claypit' | 'mine'
  | 'bakery' | 'dairyplant' | 'meatplant' // food processing
  | 'sawmill' | 'brickworks' | 'steelmill' | 'cementworks' | 'glassworks' | 'foodplant'
  | 'workshop' | 'furniture' | 'textile' | 'electronics' | 'carplant'
  | 'store' | 'dealer' | 'restaurant' | 'office' | 'depot' | 'yard' | 'bank'
  | 'adco' // outdoor advertising company: owns billboards, screens and ad columns and rents them out
  | 'cityhall' // seat of a government
  | 'studio' // TV station
  | 'netco' // internet company headquarters
  | 'plaza' // a public square (built by a government): speeches, rallies, protests, hanging out
  | 'park' // a public park
  /** A vacant shop on a tower's ground floor (becomes a store, restaurant, bank… when leased). */
  | 'shopfront'
  /** A vacant office floor in an office tower (becomes a company's office when leased). */
  | 'suite';

export interface Unit {
  tenant: number; // person id, -1 = vacant
  rent: number; // per day
  since: number;
  arrears: number; // unpaid days
}

/** A commercial lease: the company operating in a building it doesn't own pays the owner rent. */
export interface Lease {
  tenant: number; // firm id
  rent: number; // per day
  since: number;
  arrears: number; // unpaid days
}

export interface Ledger {
  revenue: number; // today
  costs: number; // today
  days: number[]; // recent daily profits, newest last
}

export interface Building {
  id: number;
  kind: BuildingKind;
  lot: number;
  x: number; // center
  y: number;
  angle: number; // facing the road (same as the lot)
  w: number;
  d: number;
  floors: number;
  owner: number; // person or firm id, -1 = public/abandoned
  firm: number; // firm operating here, -1 = none
  built: boolean;
  workDone: number; // minutes
  workNeeded: number;
  needed: Inventory; // materials still to deliver
  builder: number; // construction firm id, -1 = owner builds
  due: number; // what the client still owes the construction firm
  billedWork: number; // construction minutes already billed to the client
  condition: number;
  ruined: boolean;
  store: Inventory;
  cash: number;
  units: Unit[]; // residential units
  seed: number;
  created: number;
  lastProgress: number;
  ver: number;
  /**
   * Units inside a tower: shops on the ground floor and leased office floors
   * are buildings of their own (so businesses work the same anywhere), with
   * `host` = the tower and `level` = the floor they start on (0 = street).
   * x, y, w, d are the unit's own footprint inside the tower; it has no lot of
   * its own (lot = the tower's). They're built when the tower is.
   */
  host?: number;
  level?: number;
  /** Towers: their hosted units (building ids). */
  hosted?: number[];
  /** A leased unit: business days in a row with nobody employed there (the tenant gives it up after a few). */
  idle?: number;
  /** The operating company rents the building (or unit) from its owner. */
  lease?: Lease;
}

// -------------------------------------------------------------------- firms

export interface Firm {
  id: number;
  name: string;
  owner: number; // person id
  founded: number;
  cash: number;
  kind: BuildingKind; // its main line of business
  sites: number[]; // building ids it operates
  prices: Partial<Record<Good | 'meal' | 'freight' | 'build' | 'rate', number>>;
  wages: Partial<Record<Role, number>>; // offered wage per shift for new hires
  ledger: Ledger;
  /** Sales in its last full business day (for statistics). */
  lastRevenue?: number;
  /** Sales and profit of its last 60 business days, oldest first (for statistics). */
  hist?: { rev: number[]; profit: number[] };
  /** Today's ad results: people who saw its ads, and new customers who came because of one, by channel. */
  adToday?: { imp: Partial<Record<AdChannel, number>>; conv: Partial<Record<AdChannel, number>> };
  /** What each channel has been costing and bringing in (smoothed daily), and how the budget is split. */
  adPerf?: { spend: Partial<Record<AdChannel, number>>; conv: Partial<Record<AdChannel, number>>; imp: Partial<Record<AdChannel, number>> };
  adMix?: Partial<Record<AdChannel, number>>;
  reputation: number; // 0..1
  sales: Record<string, number>; // today's units sold (goods, 'meal', 'freight', 'build')
  salesAvg: Record<string, number>; // recent daily average
  losing: number; // consecutive days with a loss
  hue: number; // brand color
  website: boolean;
  slogan: string;
  closed: boolean;
  /** Owned by a government (polity id): its administration, or a nationalized company. */
  gov?: number;
  /** Who runs it day to day when the owner isn't a person (state firms, bank-owned firms). */
  manager?: number;
  /** Marketing spend per day it aims for. */
  adBudget?: number;
  /** Average daily sales (money coming in), smoothed: what ad budgets and valuations are based on. */
  revenueAvg?: number;
  /** What it spent on ads yesterday, by channel (street, tv, net, sponsorships). */
  adSpend?: Partial<Record<'street' | 'tv' | 'net' | 'influencer', number>>;
  /** TV stations. */
  channel?: Channel;
  /** Internet companies. */
  site?: Site;
  /** Under bankruptcy proceedings since (tick). */
  insolvent?: number;
  /**
   * Companies it knows it can buy from or sell to (firm ids). There is no
   * central market: a business only orders from suppliers it has heard of
   * (from its owner's acquaintances, ads, sales calls, a search engine,
   * past deals). Outside suppliers are always reachable.
   */
  contacts?: number[];
  /** A local branch of a company from outside the city (owned by OUTSIDE; profits leave the city). */
  branch?: string;
  /** Sells online (its own web shop, or listed on a marketplace site). */
  webshop?: boolean;
}

/** A TV channel (run by a studio firm). */
export interface Channel {
  name: string; // "Channel 4", "KTV News"
  slant: number; // editorial econ position (owner's, or the state's)
  slantAuth: number;
  viewers: number; // people who watched yesterday
  adPrice: number; // per day of ads
  onAir: number; // broadcast id now on, -1
  style: 'news' | 'tabloid' | 'public' | 'state';
}

export type SiteKind =
  | 'social' | 'news' | 'search' | 'classifieds' | 'video' | 'forum'
  | 'shop' // online marketplace: stores list their goods, people order for delivery (commission + sponsored listings)
  | 'jobs' // job board: postings, profiles, online applications (employers pay to post)
  | 'homes' // rentals and homes for sale (landlords pay for listings)
  | 'delivery' // food-delivery app: restaurant meals brought by gig couriers
  | 'rides' // ride-hailing app: gig drivers with their own cars
  | 'pay' // payments app: people pay each other and shops online (a small fee per payment)
  | 'crowd'; // crowdfunding: people back new businesses (the site takes a cut)

/** A website (run by an internet company). Social networks differ in how they work. */
export interface Site {
  name: string;
  kind: SiteKind;
  domain: string; // "chirp.net"
  tagline: string;
  /** How the feed is ranked: newest first, what gets reactions, or only friends. */
  feed: 'chronological' | 'engagement' | 'friends';
  anonymous: boolean; // posts under pseudonyms (forums)
  charLimit: number; // 0 = none
  users: number; // accounts
  active: number; // visits yesterday
  adPrice: number; // per day
  subscription: number; // per day, 0 = free (ads)
  quality: number; // 0..1 (programmers' work over time)
  color: number; // hue 0..1
  launched: number;
  /** Price per 1,000 ad views (set by demand from advertisers). */
  cpm?: number;
  /** Ad views served yesterday, and what advertisers paid for them. */
  impressions?: number;
  adRevenue?: number;
  /** Commission on sales/fares/backing through the site (marketplaces, apps, crowdfunding). */
  fee?: number;
  /** Money that went through it yesterday (orders, fares, payments, pledges). */
  volume?: number;
}

export interface Contract {
  id: number;
  firm: number;
  person: number;
  site: number;
  role: Role;
  wage: number; // per shift
  start: number;
  probationEnd: number;
  noticeEnd: number; // -1 = no notice given; otherwise the tick employment ends
  lastShiftDay: number;
  unpaid: number;
}

export interface Posting {
  id: number;
  firm: number;
  site: number;
  role: Role;
  wage: number;
  t: number;
  applicants: number[];
  /** How many people the company wants to hire for this posting (1 if unset). */
  openings?: number;
}

// ----------------------------------------------------------------- vehicles

export interface Vehicle {
  id: number;
  /** car; truck (freight); van (parcel and grocery delivery). */
  kind: 'car' | 'truck' | 'van';
  owner: number; // person or firm id (OUTSIDE for outside companies' trucks)
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  path: number[];
  driver: number; // person id, -1 = parked (or an outside driver, see `trip`)
  parkedAt: number; // building id, -1 = on the road
  cargo: Inventory;
  hue: number;
  bought: number;
  /** Name painted on the side (company trucks and vans show their owner's name; outside fleets their own brand). */
  brand?: string;
  /**
   * A trip by an outside company's truck or van (its driver isn't one of the
   * city's people): drive in from the highway gate to a building, unload or
   * load, drive back out, and vanish.
   */
  trip?: {
    shipment: number;
    to: number; // the building it's heading to (GATE when leaving)
    phase: 'in' | 'stop' | 'out';
    until: number; // end of the current stop
    stops: number[]; // building ids, ending with GATE
    i: number; // current stop
  };
}

/**
 * An advertisement somewhere in the world: a poster on a wall, a billboard,
 * a flyer taped to a street lamp, a banner. Position is the center of the ad
 * face; `angle` is the direction it faces (sim radians, like headings).
 */
/** Where an ad was seen. */
export type AdChannel = 'street' | 'net' | 'tv' | 'influencer';

/** A political ad bought in a campaign (for the statistics window's list of election ads). */
export interface AdLogEntry {
  t: number;
  election: number;
  sponsor: number; // the candidate (person id)
  kind: 'poster' | 'billboard' | 'space' | 'tv' | 'online' | 'attack';
  target?: number; // an attack ad: the opponent it's about
  headline: string;
  tagline: string;
  cost: number;
}

export interface AdPlacement {
  id: number;
  /**
   * poster (on a wall), billboard (on legs or a roof frame), flyer (taped to a
   * lamp), banner (fabric on a facade), screen (big LED screen on a facade
   * downtown, rotating ads), column (round advertising column on a sidewalk).
   */
  kind: 'poster' | 'billboard' | 'flyer' | 'banner' | 'screen' | 'column';
  x: number;
  y: number;
  z: number; // height of the ad's center above the ground
  angle: number;
  w: number; // meters
  h: number;
  building: number; // building it's on, -1 = free-standing
  sponsor: number; // firm, person or government id
  headline: string;
  tagline: string;
  hue: number; // brand color 0..1
  topic: 'product' | 'campaign' | 'cause' | 'event';
  created: number;
  expires: number;
  /**
   * Who owns the ad space (an outdoor advertising company, or the building's
   * owner). An empty space (sponsor -1) shows "Advertise here" and the owner's name.
   */
  owner?: number;
  /** Screens rotate ads: this ad is shown in slot `slot` of `slots` (each ~8 s). */
  slot?: number;
  slots?: number;
}

// -------------------------------------------------------------- government

/**
 * A government's constitution, as data. Nothing outside this object limits
 * what a government is: amendments, coups and revolutions rewrite it.
 */
export interface Charter {
  execTitle: string; // Mayor, President, Chair, General Secretary, Commander, Director, Governor…
  /**
   * How the executive is chosen: elected by voters; picked by the council; by
   * the ruling party; by whoever seized power; named by the previous ruler
   * (ruler for life, monarchy-like); the owner of a company that runs the
   * town (company town); or nobody (no executive: commission / town meeting).
   */
  execBy: 'voters' | 'council' | 'party' | 'force' | 'successor' | 'owner' | 'none';
  execTerm: number; // days, 0 = for life
  execLimit: number; // max consecutive terms, 0 = no limit
  veto: boolean; // can the executive veto council motions (2/3 override)
  councilTitle: string; // City Council, Assembly, People's Council…
  seats: number;
  councilBy: 'voters' | 'party' | 'appointed' | 'all' | 'none'; // 'all' = town meeting: every voter sits; appointed = by the executive
  councilTerm: number; // days
  staggered: boolean;
  districts: number; // 0 = at-large
  method: 'plurality' | 'runoff' | 'list'; // list = party-list proportional (D'Hondt)
  franchise: 'residents' | 'owners' | 'members' | 'everyone';
  residency: number; // days of residence before one may vote
  parties: 'free' | 'single' | 'none'; // single = only the ruling party; none = nonpartisan ballots
  press: 'free' | 'state'; // state = TV and Net licensed and censored
  ownership: 'private' | 'mixed' | 'collective';
  amend: 'majority' | 'supermajority' | 'referendum' | 'executive';
  redistrict: 'council' | 'commission' | 'executive';
  recall: boolean;
  initiative: number; // share of voters whose signatures force a referendum (0 = no initiatives)
  suspendedUntil: number; // tick until which elections are suspended (0 = not)
}

export interface Policy {
  propertyTax: number; // share of assessed value per year
  salesTax: number; // share of retail/restaurant sales
  incomeTax: number; // share of wages
  welfare: number; // per day to adults without income
  police: number; // officers employed
  roadCrew: number; // public-works builders
  clerks: number; // civil servants
  rentCap: number; // max rent per unit per day, 0 = none
  maxFloors: number; // height limit, 0 = none
  minWage: number; // per shift, 0 = none
  landPrice: number; // public land sells at this multiple of its assessed value
  priceCaps: boolean; // price controls on groceries and rent
  nationalizeAbove: number; // staff; firms this big become public (0 = never)
  immigration: 'open' | 'limited' | 'closed';
  publicHousing: boolean;
}

export interface Office {
  id: number;
  title: string; // "Mayor", "Councillor (District 2)", "Police Chief"
  kind: 'exec' | 'council' | 'chief' | 'clerk';
  district: number; // -1 = at-large
  holder: number; // person id, -1 = vacant
  party: number;
  since: number;
  termEnd: number; // tick, -1 = no fixed term
  terms: number; // consecutive terms served by the holder
}

/** A motion before the council (or the voters, as a referendum). */
export interface Motion {
  kind: string; // 'tax' | 'welfare' | 'pave' | 'layout' | 'cityhall' | 'police' | 'crew' | 'rentcap' | 'height' | 'amend' | 'annex' | 'nationalize' | 'privatize' | 'suspend' | 'redistrict' | 'schedule' | 'ban' | 'immigration' | 'housing' | 'minwage' | 'land'
  title: string;
  by: number; // proposer (person id)
  field?: string; // charter/policy field it changes
  value?: number | string;
  target?: number; // road edge / party / firm …
  cost?: number;
}

export interface Law {
  t: number;
  title: string;
  kind: string;
  by: number;
  yes: number;
  no: number;
  abstain: number;
  passed: boolean;
  how: string; // "council vote", "referendum", "decree", "veto overridden"…
}

export interface Polity {
  id: number;
  name: string; // "City of Ashford", "Ashford People's Commune"
  short: string;
  founded: number;
  firm: number; // its administration (treasury, staff, public land)
  seat: number; // city hall building id, -1 = none yet
  /** Claimed territory: 50 m cells (y * cols + x). Need not match where the city is. */
  cells: number[];
  /** Electoral districts: cells per district (empty when elected at-large). */
  districts: number[][];
  charter: Charter;
  policy: Policy;
  offices: Office[];
  status: 'active' | 'provisional' | 'rival' | 'gone';
  /** Company towns: the firm whose owner runs the place. */
  company?: number;
  label: string; // derived system description, e.g. "mayor-council democracy"
  hue: number; // flag color
  nextElection: number; // tick, -1 = none scheduled
  nextSession: number; // tick of the next council session
  agenda: Motion[];
  laws: Law[]; // the gazette, newest last
  legitimacy: number; // mean recognition among residents (daily)
  coups: number;
  /** Rolling fiscal record for the UI: yesterday's revenue by source and spending by item. */
  fiscal: { day: number; income: Record<string, number>; spend: Record<string, number>; prevIncome: Record<string, number>; prevSpend: Record<string, number> };
  lastCensus: number;
  parent: number; // polity it split from, -1
  data?: Record<string, number>;
  /** Where it was founded (its downtown). */
  cx?: number;
  cy?: number;
}

export interface Party {
  id: number;
  name: string;
  short: string;
  hue: number;
  founded: number;
  leader: number;
  polity: number;
  members: number[];
  econ: number; // platform (members' mean, smoothed)
  auth: number;
  cash: number; // campaign funds (dues, donations)
  banned: boolean;
  slogan: string;
}

export interface Candidate {
  person: number;
  office: number; // office id
  party: number; // -1 independent
  econ: number; // stated positions
  auth: number;
  funds: number; // campaign account
  spent: number;
  slogan: string;
  votes: number;
  withdrawn: boolean;
}

export interface ElectionResult {
  office: number;
  district: number;
  tallies: Record<number, number>; // candidate person id -> votes
  winners: number[];
  eligible: number;
}

export interface Election {
  id: number;
  polity: number;
  kind: 'general' | 'runoff' | 'referendum' | 'recall' | 'founding';
  day: number; // tick polls open
  offices: number[];
  candidates: Candidate[];
  motion?: Motion; // referendums
  yes?: number;
  no?: number;
  status: 'campaign' | 'voting' | 'done' | 'cancelled';
  results: ElectionResult[];
  turnout: number;
  eligible: number;
  /** Ballots cast for each candidate so far (person id -> count), counted at close. */
  ballots: Record<number, number>;
  voters: number[]; // who has voted (to prevent double voting)
  fair: boolean; // false if manipulated (disqualifications, intimidation)
}

/**
 * Something people gather for: a founding assembly, a council session, a
 * campaign speech or rally, a protest, a TV debate, a vote count.
 */
export interface CivicEvent {
  id: number;
  kind: 'assembly' | 'session' | 'speech' | 'rally' | 'protest' | 'debate' | 'inauguration' | 'hearing';
  polity: number;
  host: number; // person id (speaker/organizer)
  speakers: number[];
  place: number; // building id
  start: number;
  end: number;
  title: string;
  attendees: number[];
  lines: ChatLine[]; // transcript
  election?: number;
  channel?: number; // televised on (studio firm id)
  cause?: string; // protests: what they want
  data?: Record<string, number>;
}

/** One hour of TV on one channel. */
export interface Broadcast {
  id: number;
  channel: number; // studio firm id
  t: number;
  show: string; // "Evening News", "City Debate", "Talk of the Town"
  kind: 'news' | 'debate' | 'talk' | 'entertainment' | 'speech' | 'propaganda';
  title: string;
  lines: ChatLine[];
  slant: number; // econ framing
  viewers: number;
  ads: number[]; // sponsor ids
  event?: number; // CivicEvent covered live
}

export interface Auction {
  id: number;
  item: 'lot' | 'building' | 'firm' | 'vehicle';
  target: number;
  seller: number; // account receiving the proceeds
  reason: string; // "land office", "estate of X", "foreclosure", "bankruptcy of X"
  reserve: number;
  bids: { who: number; amount: number; t: number }[];
  opened: number;
  closes: number;
  relists: number;
  /** Bankruptcy: proceeds go to these creditors in order (account, amount owed). */
  creditors?: { who: number; owed: number; why: string }[];
}

/** A bank loan. Lending creates new money; repaying the principal removes it again. */
export interface Loan {
  id: number;
  bank: number; // firm id
  borrower: number; // person or firm id
  principal: number;
  balance: number;
  rate: number; // interest per day
  days: number; // term
  start: number;
  missed: number;
  purpose: string;
  /** Building pledged as security (mortgages, construction loans): the bank can seize it. */
  collateral?: number;
}

export interface Shipment {
  id: number;
  client: number; // who pays for the delivery (firm or person id)
  from: number; // building id, or GATE (comes from outside)
  to: number; // building id, or GATE (goes outside)
  goods: Inventory;
  price: number;
  carrier: number; // firm id (OUTSIDE for outside companies' trucks), -1 = unassigned
  driver: number; // person id
  status: 'open' | 'assigned' | 'loaded' | 'done';
  created: number;
  /** A delivery to a person's home (online orders): goods go into their pantry or become their things. */
  recipient?: number;
  /** Electronics bought as a phone or TV (online orders). */
  device?: 'phone' | 'tv';
  /** A restaurant meal (food-delivery app): eaten when it arrives. */
  meal?: boolean;
  /** Not to be picked up before this tick (outside suppliers ship next morning). */
  after?: number;
  /** Gig app that brokers the delivery (couriers working for it may take it). */
  app?: number;
}

// ------------------------------------------------------------------ market

/**
 * The wholesale market is not a place: it's companies' standing offers and
 * orders, made by phone, by sales reps and on business websites. Only
 * companies (and governments) trade here; people buy in shops and online.
 */
export interface Order {
  id: number;
  side: 'ask' | 'bid';
  who: number; // firm id (or OUTSIDE)
  /** Asks: where the goods are (a firm's site, or GATE for outside suppliers); bids: where they should go (GATE = exported). */
  site: number;
  good: Good;
  qty: number;
  price: number;
  floor: number;
  t: number;
  lastReprice: number;
}

export interface Trade {
  t: number;
  good: Good;
  qty: number;
  price: number;
  buyer: number;
  seller: number;
}

export interface Market {
  orders: Order[];
  last: Record<Good, number>;
  day: Record<Good, { q: number; v: number }>;
  trades: Trade[];
}

// ----------------------------------------------------------------- society

export interface LogEntry {
  t: number;
  kind: 'build' | 'business' | 'death' | 'arrival' | 'job' | 'market' | 'event' | 'home' | 'buy' | 'politics' | 'media' | 'law';
  text: string;
  who?: number;
  bid?: number;
  firm?: number;
}

export interface Conversation {
  t: number;
  a: number;
  b: number;
  where: number; // building id or -1
  lines: ChatLine[];
}

export interface Post {
  id: number;
  t: number;
  who: number; // person or firm id
  text: string;
  likes: number;
  /** Net site it's on (firm id); -1/undefined = an old-style public post. */
  site?: number;
  topic?: 'politics' | 'life' | 'work' | 'shop' | 'news' | 'ad';
  slant?: number; // econ position it pushes, if political
  replyTo?: number;
  shares?: number;
  views?: number;
  /** A paid post: the company (or campaign) that paid for it, shown as "Sponsored" (or an influencer's #ad). */
  sponsor?: number;
}

/** A crowdfunding campaign: someone raising money from backers to start a business. */
export interface Crowdfund {
  id: number;
  founder: number; // person id
  kind: BuildingKind; // the business they want to start
  title: string;
  goal: number;
  raised: number;
  backers: { who: number; amount: number }[];
  site: number; // the crowdfunding site's firm id
  start: number;
  deadline: number;
  status: 'open' | 'funded' | 'failed';
}

export interface StatPoint {
  t: number;
  pop: number;
  money: number;
  employed: number;
  firms: number;
  homes: number; // people with a home
  renters: number;
  cars: number;
  buildings: number;
  gini: number;
  avgFood: number;
  avgWage: number;
  avgRent: number;
  prices: Partial<Record<Good, number>>;
  /** Share of people without a job or business. */
  jobless?: number;
  /** How far residents accept the main government's authority (0..1). */
  legit?: number;
}

/** Sectors of the economy (for jobs, companies and sales by sector). */
export type Sector = 'retail' | 'manufacturing' | 'office' | 'tech' | 'construction' | 'logistics' | 'raw' | 'public';

/** One market's day: wholesale trading, the rest of the world, shelves. */
export interface MarketDay {
  price: number; // average wholesale price traded (or the last price)
  q: number; // quantity traded locally (company to company)
  imp: number; // bought from outside
  exp: number; // sold outside
  retail?: number; // average shelf price in shops (consumer goods)
  bids: number; // quantity wanted in open orders at day's end
  asks: number; // quantity offered in open orders at day's end
  makers: number; // local companies making it
}

/** A snapshot of the city at the end of each game day, plus what happened during it (see stats.ts). */
export interface DailyStat {
  day: number;
  t: number;
  // people
  pop: number;
  arrivals: number; // during the day
  left: number;
  deaths: number;
  employed: number; // job contracts
  owners: number; // people running a business of their own
  jobless: number; // neither
  homeless: number;
  renters: number;
  homeowners: number;
  trailers: number;
  online: number;
  cars: number;
  mood: number; // average 0..1
  happy: number;
  needs: { food: number; energy: number; social: number; fun: number; health: number };
  // money
  wage: { p10: number; median: number; mean: number; p90: number };
  wealthGini: number;
  top10: number; // share of all wealth held by the richest 10%
  wealthBins: number[]; // people by wealth: <10, 10–100, 100–1k, 1k–10k, 10k–100k, 100k+
  money: number; // money supply
  cpi: number; // cost of a typical day's basket (food, things, rent)
  // what happened in the day (money): see `tally`
  flows: Record<string, number>;
  // jobs, companies and sales by sector
  jobs: Partial<Record<Sector, number>>;
  firms: Partial<Record<Sector, number>>;
  revenue: Partial<Record<Sector, number>>; // over the last business day
  profitable: number; // companies that made money in their last business day
  firmCash: number;
  // markets
  markets: Partial<Record<Good, MarketDay>>;
  // housing and land
  units: number; // flats
  vacantUnits: number;
  rent: number; // average rent of occupied flats
  suites: number; // office floors in towers
  vacantSuites: number;
  shops: number; // shopfronts in towers
  vacantShops: number;
  building: number; // buildings under construction
  towers: number;
  tallest: number; // floors
  land: Partial<Record<Zone, number>>; // average price per m² of lots for sale
  // government (the main one)
  treasury: number;
  legit: number;
  income: Record<string, number>; // yesterday, by kind
  spend: Record<string, number>;
  // the Net and media
  adSpend: { street: number; net: number; tv: number; influencer: number };
  siteUsers: number;
  tvViewers: number;
  // politics (added later: may be missing in older records)
  compass?: { econ: number; auth: number }; // average position
  engagement?: number; // average interest in politics 0..1
  grievance?: number; // average grievance with the government
  protesting?: number; // people at a protest at day's end
  parties?: Record<string, number>; // members per party (by name)
  // money (added later)
  profit?: Partial<Record<Sector, number>>; // over the last business day
  wealthShares?: { bottom50: number; middle40: number; top10: number; top1: number };
  /** The main government's coming election: poll shares for its top office (candidate name -> share). */
  polls?: { election: number; office: string; shares: Record<string, number> };
}

export interface DeadPerson {
  id: number;
  name: string;
  died: number;
  cause: string;
  wealth: number;
}

export interface ScenarioState {
  id: string;
  startDay: number;
  data: Record<string, number>;
}

export interface SimState {
  version: 4;
  seed: number;
  rng: RngState;
  tick: number;
  nextId: number;
  world: World;
  roads: Roads;
  people: Person[];
  dead: DeadPerson[];
  buildings: Building[];
  firms: Firm[];
  contracts: Contract[];
  postings: Posting[];
  vehicles: Vehicle[];
  shipments: Shipment[];
  loans: Loan[];
  ads: AdPlacement[];
  polities: Polity[];
  parties: Party[];
  elections: Election[];
  events: CivicEvent[];
  broadcasts: Broadcast[];
  auctions: Auction[];
  /** How often people looked for land of a zone and found none they could get (decays daily). */
  landDemand?: Partial<Record<Zone, number>>;
  /** Unpaid property tax by owner. */
  taxArrears?: Record<number, number>;
  /** Small bits of bookkeeping that don't deserve their own field. */
  data?: Record<string, number>;
  market: Market;
  conversations: Conversation[];
  posts: Post[];
  stats: StatPoint[];
  /** One snapshot per game day (stats.ts), for the statistics window. */
  daily?: DailyStat[];
  /** Running totals for the current day (spending by kind, imports, exports…), reset each midnight. */
  today?: Record<string, number>;
  /** Political ads bought in campaigns (latest few hundred). */
  adLog?: AdLogEntry[];
  log: LogEntry[];
  scenarios: ScenarioState[];
  counters: {
    arrivals: number; deaths: number; trades: number; hires: number; layoffs: number; quits: number; emigrated?: number; dayLabor?: number;
    /** Online orders by people; deliveries by gig couriers; rides; truckloads in from and out to the rest of the world. */
    orders?: number; gigs?: number; rides?: number; imports?: number; exports?: number;
  };
  crowdfunds?: Crowdfund[];
  /** The crossroads the city grew from (downtown). */
  center: { x: number; y: number };
  /** Where the highway leaves the map (outside trucks come and go here). */
  gates: { x: number; y: number }[];
}
