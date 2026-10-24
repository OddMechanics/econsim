// Every tunable number in the simulation lives here (plus the building and
// goods tables in goods.ts), so "what if X were different?" experiments only
// need edits in one place.

import type { Zone } from './types';

export const MINUTES_PER_DAY = 24 * 60;

export const WORLD = {
  size: 200, // tiles per side
  tile: 10, // meters per tile -> a 2 km x 2 km map
  maxHeight: 10,
};

export const ROAD = {
  avenue: 11, // asphalt width (m)
  street: 7.5,
  country: 6,
  sidewalk: 2.6, // each side (not on country roads)
  block: 72, // typical street segment length (m)
  lotGap: 1.5,
};

/** Lot frontage x depth per zone (meters). */
export const LOT_SIZE: Record<Zone, [number, number]> = {
  core: [20, 22],
  urban: [20, 24],
  suburb: [22, 28],
  industrial: [32, 30],
  rural: [56, 56],
};

/** Distance from the square at which each zone ends (it grows with the city). */
export const ZONES = { core: 150, urban: 290, suburb: 450 };

export const POPULATION = {
  start: 50,
  cap: 10000,
  startMoney: [150, 2600] as [number, number], // modern settlers: savings, skewed (most near the low end, a few well-off)
  startFood: 10,
  newcomerMoney: [60, 700] as [number, number],
  newcomerFood: 6,
  arrivalBase: 4, // expected newcomers per day with no particular pull (family, studies, a growing city's draw)
  arrivalPerOpening: 0.6, // extra per open position (people mostly come for jobs)
  arrivalMax: 40, // per day, plus one per 20 residents (a bigger city draws more people)
};

/**
 * Office work the rest of the world buys from the city each day at full
 * price, in two separate markets: software (programmers) and professional
 * services (consulting, legal, accounting, design: clerks). Each is base +
 * perPerson × population. Past that, the city's firms in that market have to
 * charge less to get more work: every billed hour earns proportionally less
 * (decided each morning from the day before).
 */
export const SERVICE_EXPORTS = { base: 500, perPerson: 8 };

export const MOVE = {
  walk: 75, // meters per minute (~4.5 km/h)
  loaded: 60,
  car: 520, // ~31 km/h in town
  truck: 430,
  driveIfFartherThan: 450, // car owners drive for trips longer than this (m)
};

export const CARRY_CAPACITY = 30;

export const NEEDS = {
  hungerPerHour: 3.4,
  eatBelow: 55,
  energyAwakePerHour: 5.6,
  energyWorkPerHour: 7,
  energySleepPerHour: 13,
  socialPerHour: 1.2,
  funPerHour: 1.6,
  healthRegenPerHour: 1.0,
  starvePerHour: 3.0,
  exposurePerHour: 1.6,
};

/** What loggers, quarry workers, clay diggers and miners extract per hour (companies only: nobody gathers for a living). */
export const GATHER = {
  wood: 7, // with chainsaws, loaders and trucks
  stone: 6,
  clay: 7,
  ore: 4,
  toolBoost: 1.7,
  maxHours: 3,
};

export const REGROW_PER_DAY = {
  wood: 0.35,
  // wild berries and fish only matter for how nature looks (nobody lives off them)
  forage: 0.2,
  fish: 0.1,
  stone: 0.25,
  clay: 0.4,
  ore: 0.12,
};

export const FOOD_SPOIL_PER_DAY = 0.03;

/**
 * Trade with the rest of the world (the city isn't alone). Outside suppliers
 * sell any good to the city's companies, delivered by truck from the highway
 * (world price x `importMarkup`, arriving next morning-ish); outside buyers
 * take up to `buy` units a day of what the city makes at the world price x
 * `exportShare`, and send their own trucks. Money from exports flows in;
 * money for imports leaves.
 */
export const OUTSIDE = {
  id: -2,
  prices: {
    crops: 0.8, wood: 0.7, stone: 0.9, clay: 0.6, ore: 1.4, groceries: 1.5, planks: 1.7, bricks: 1.7,
    steel: 7, concrete: 1.6, glass: 3.6, tools: 14, furniture: 26, clothes: 9, computers: 40, cars: 260,
  } as Record<string, number>,
  importMarkup: 1.3,
  exportShare: 0.85,
  // the region buys what the city makes (its export base); manufactured goods sell best
  // (to the wider world a small city is a price-taker: it can sell about as much as it can make)
  buy: { crops: 800, wood: 600, stone: 600, clay: 300, ore: 500, groceries: 1500, planks: 1500, bricks: 1500, steel: 1000, concrete: 1500, glass: 1000, tools: 600, furniture: 600, clothes: 1000, computers: 500, cars: 100 } as Record<string, number>,
  /** Outside suppliers' capacity per good per day (practically unlimited for a city this size). */
  supply: 4000,
  /** Hours from order to an outside truck setting off (orders placed in the afternoon come next morning). */
  leadHours: 14,
  /** A courier from outside picks up local deliveries nobody local took after this many hours (for a fee). */
  courierAfterHours: 5,
};

/**
 * Shopping online. Outside online retailers (the wider Net) sell everything
 * stores sell, delivered to the door by a van the next day; they're dearer
 * than a local store with stock, but always there. Local stores sell online
 * too once they have a web shop or a marketplace lists them.
 */
export const ONLINE = {
  retailMarkup: 1.75, // outside online retail price = world price x this
  deliveryFee: 2.5, // per order
  leadHours: 5, // same- or next-day delivery
  localDeliveryFee: 1.5,
  mealDeliveryFee: 2.2, // food-delivery app fee per order (the courier gets most of it)
};

/** Nights pass faster than days on screen (the UI speeds up time at night). */
export const NIGHT = { start: 22, end: 6, speedup: 8 };

export const JOBS = {
  probationDays: 3, // either side can end it at once during probation
  noticeDays: 2, // after probation, layoffs and quits take this long
  postingMinHours: 6, // applications are collected this long before hiring
  losingDaysBeforeLayoff: 5,
  minTenureDaysToQuit: 4, // except when not paid
};

export const HOUSING = {
  rentShareMax: 0.4, // of income people are willing to pay in rent
  evictAfterDays: 4,
};

export const MARKET = {
  bidLifetimeHours: 48,
  repriceEveryHours: 6,
  repriceStep: 0.04,
  tradeMemory: 300,
};

export const STATS = {
  sampleEveryMinutes: 120,
  maxPoints: 1500,
  logMax: 800,
  conversationsMax: 300,
  postsMax: 400,
};

export const AUTOSAVE_SECONDS = 30;

/**
 * Politics. Real political life runs on years; here one "political year"
 * is POLITICS.year game days so elections, drift and reforms happen within
 * a watchable run (a 2-year council term = 2 * year days).
 */
export const POLITICS = {
  year: 30, // game days per political year
  cell: 50, // meters per territory cell
  founding: { limitsRadius: 420, seats: 5 },
  campaignDays: 10, // candidates declare this long before election day
  pollsOpen: 7, // polling place hours
  pollsClose: 20,
  sessionHour: 18, // council sessions start (weekly)
  sessionEveryDays: 7,
  persuasionHalfLifeDays: 3,
  awarenessHalfLifeDays: 15,
  talkPull: 0.02, // share of the gap closed per conversation between trusting people (bounded confidence)
  talkMaxGap: 1.0,
  mediaPull: 0.004, // per exposure, toward the message (only when within 1.5 SD)
  driftPerYear: { young: 0.15, mid: 0.05, old: 0.02 },
};

/** The Territory sells land outside every government's claim (frontier prices, money leaves). */
export const LAND = {
  territoryPrice: { rural: 18, suburb: 25, urban: 40, core: 60, industrial: 30 } as Record<string, number>,
  auctionHours: 20,
  /**
   * Assessed value per square meter of lot by zone (times 0.5 + population/150, and demand): downtown land
   * gets dear as the city grows, which is what makes building tall pay (the land's cost is shared by more floors).
   */
  perM2: { core: 2.5, urban: 0.8, suburb: 0.2, industrial: 0.15, rural: 0.03 } as Record<string, number>,
};

/** Wages: a reference shift wage that firms anchor on before a market exists (per shift). */
export const WAGES = {
  reference: 18,
  minShare: 0.6, // nobody accepts less than this share of the going rate for their role
};
