import type { Rng } from './rng';
import type { BuildingKind, SiteKind } from './types';

const FIRST = [
  'Ada', 'Bo', 'Cai', 'Dara', 'Eli', 'Fen', 'Gia', 'Hal', 'Ines', 'Jun', 'Kai', 'Lio', 'Mara', 'Nico',
  'Oda', 'Pim', 'Quin', 'Rae', 'Sol', 'Tam', 'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zed', 'Ari', 'Bex',
  'Cleo', 'Dov', 'Ezra', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kit', 'Lena', 'Milo', 'Nell', 'Otto',
  'Pia', 'Remy', 'Sage', 'Teo', 'Vera', 'Wes', 'Yuki', 'Zoe', 'Ansel', 'Brin', 'Cyra', 'Dax', 'Edda',
  'Femi', 'Goran', 'Ilse', 'Jonah', 'Kemal', 'Lucia', 'Mateo', 'Nadia', 'Omar', 'Priya', 'Rafa', 'Sven',
  'Tariq', 'Ulla', 'Vito', 'Wanda', 'Yusuf', 'Zainab', 'Arlo', 'Bianca', 'Chidi', 'Dagny', 'Elio', 'Freya',
];
const LAST_A = ['Ash', 'Brook', 'Cliff', 'Dun', 'Elm', 'Fair', 'Glen', 'Hart', 'Iron', 'Kings', 'Lark', 'Moss', 'North', 'Oak', 'Pine', 'Reed', 'Stone', 'Thorn', 'Wild', 'Wood', 'Rose', 'Silver', 'Marsh', 'West'];
const LAST_B = ['ley', 'ford', 'well', 'by', 'wick', 'ton', 'more', 'field', 'dale', 'son', 'er', 'holt', 'ridge', 'worth'];

export function randomName(rng: Rng): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST_A)}${rng.pick(LAST_B)}`;
}

const NOUN: Partial<Record<BuildingKind, string[]>> = {
  farm: ['Farms', 'Acres', 'Harvest', 'Fields'],
  vegfarm: ['Produce', 'Market Garden', 'Greens', 'Orchards'],
  dairyfarm: ['Dairy Farm', 'Meadows', 'Pastures'],
  ranch: ['Ranch', 'Livestock', 'Cattle Co.'],
  bakery: ['Bakery', 'Bread Co.', 'Ovens'],
  dairyplant: ['Dairy', 'Creamery', 'Milk Co.'],
  meatplant: ['Meats', 'Butchers', 'Packing Co.'],
  clinic: ['Medical', 'Family Practice', 'Health Clinic', 'Medical Center'],
  hospital: ['Hospital', 'Medical Center'],
  lumberyard: ['Timber', 'Logging', 'Forestry'],
  quarry: ['Quarry', 'Aggregates', 'Stone & Sand'],
  claypit: ['Clay', 'Clay Works', 'Earthworks'],
  cementworks: ['Cement', 'Concrete', 'Ready-Mix'],
  glassworks: ['Glass', 'Glassworks', 'Float Glass'],
  mine: ['Mining', 'Ore Co.', 'Deep Works'],
  sawmill: ['Sawmill', 'Mill & Plank', 'Woodworks'],
  brickworks: ['Bricks', 'Brick & Kiln', 'Masonry Supply'],
  steelmill: ['Steel', 'Foundry', 'Metalworks'],
  foodplant: ['Foods', 'Provisions', 'Pantry Co.'],
  workshop: ['Tools', 'Toolworks', 'Hardware'],
  furniture: ['Furniture', 'Home Goods', 'Joinery'],
  textile: ['Textiles', 'Apparel', 'Clothing Co.'],
  electronics: ['Electronics', 'Computing', 'Systems'],
  carplant: ['Motors', 'Automotive', 'Motor Works'],
  store: ['Market', 'General Store', 'Mart', 'Grocers', 'Shop'],
  dealer: ['Auto Sales', 'Cars', 'Motors Dealer'],
  restaurant: ['Kitchen', 'Diner', 'Bistro', 'Grill', 'Café', 'Eatery'],
  office: ['Holdings', 'Group', 'Partners', 'Corp.'],
  depot: ['Shipping', 'Logistics', 'Freight', 'Express'],
  yard: ['Construction', 'Builders', 'Contracting', 'Build Co.'],
  apartments: ['Properties', 'Realty', 'Residences'],
  tower: ['Developments', 'Tower Co.', 'Living', 'Residences'],
  officetower: ['Real Estate', 'Properties', 'Center', 'Plaza Holdings'],
  adco: ['Outdoor', 'Media Outdoor', 'Billboards', 'Signs & Screens'],
  bank: ['Bank', 'Savings & Loan', 'Trust', 'Credit Union'],
  studio: ['TV', 'Broadcasting', 'Channel', 'Media', 'News Network'],
  netco: ['Net', 'Online', 'Digital', 'Web', 'Labs'],
};

const PREFIX = ['North', 'River', 'Oak', 'Summit', 'Golden', 'Blue', 'Red', 'Green', 'Bright', 'Prime', 'Union', 'Harbor', 'Valley', 'Crown', 'Maple', 'Cedar', 'Pioneer', 'Liberty', 'Sunrise', 'Iron'];

const SLOGANS = [
  'Quality you can count on', 'Fair prices, every day', 'Built for this city', 'Since day one',
  'Fresh, fast, friendly', 'Better every day', 'Your neighbors at work', 'Proudly local',
  'Made with care', 'We deliver', 'Simply good', 'Here for the long run',
];

export function firmName(rng: Rng, kind: BuildingKind, founderLast: string): string {
  const noun = rng.pick(NOUN[kind] ?? ['Company']);
  return rng.chance(0.45) ? `${founderLast} ${noun}` : `${rng.pick(PREFIX)} ${noun}`;
}

export function slogan(rng: Rng): string {
  return rng.pick(SLOGANS);
}

// ---------------------------------------------------------------- places

const CITY_A = ['Ash', 'Brook', 'Cedar', 'Elm', 'Fair', 'Glen', 'Granite', 'Haven', 'Iron', 'Lake', 'Maple', 'Mill', 'New', 'North', 'Oak', 'Pine', 'River', 'Silver', 'Spring', 'Stone', 'West', 'Willow'];
const CITY_B = ['ford', 'field', 'ton', 'wood', 'dale', 'view', 'mont', 'port', 'bridge', 'haven', 'ville', 'burg', ' Falls', ' Springs', ' Hollow', 'crest'];

export function cityName(rng: Rng): string {
  return rng.pick(CITY_A) + rng.pick(CITY_B);
}

const TREES = ['Oak', 'Maple', 'Cedar', 'Elm', 'Birch', 'Willow', 'Ash', 'Chestnut', 'Spruce', 'Poplar', 'Linden', 'Walnut', 'Juniper', 'Hawthorn', 'Alder', 'Magnolia', 'Sycamore', 'Laurel'];
const PEOPLE = ['Washington', 'Lincoln', 'Franklin', 'Jefferson', 'Madison', 'Grant', 'Adams', 'Monroe', 'Jackson', 'Harrison', 'Wilson', 'Hamilton', 'Carver', 'Douglass', 'Tubman', 'Curie', 'Ada', 'Tesla'];
const ORD = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

/** Street names for the lines of a city's street plan: numbered streets one way, named avenues the other. */
export function streetName(axis: 'u' | 'v', index: number, major: boolean): string {
  if (axis === 'u') {
    if (index === 0) return 'Main Street';
    const n = Math.abs(index);
    return `${index < 0 ? 'West' : 'East'} ${ORD(n)} Street`;
  }
  if (index === 0) return 'Central Avenue';
  const list = major ? PEOPLE : TREES;
  return `${list[(Math.abs(index) * 7 + (index < 0 ? 3 : 0)) % list.length]} ${major ? 'Boulevard' : 'Avenue'}`;
}

// --------------------------------------------------------------- politics

const PARTY_LEFT = ["Workers' Party", 'Labour Alliance', "People's Front", 'Social Democrats', 'Union Party', 'Common Ground'];
const PARTY_FARLEFT = ['Communist Party', 'Red League', 'Revolutionary Socialists', 'Commune Movement'];
const PARTY_RIGHT = ['Enterprise Party', 'Free Market League', 'Taxpayers Union', 'Conservatives', 'Property Owners Party'];
const PARTY_AUTH = ['Order Party', 'National Front', 'Civic Guard', 'Law & Order League'];
const PARTY_LIB = ['Liberty Party', 'Free City Movement', 'Open Society', 'Libertarians'];
const PARTY_CENTER = ['Civic Union', 'Moderates', 'Progress Party', 'City First', 'Independents Alliance', 'Greens'];

export function partyName(rng: Rng, econ: number, auth: number): string {
  const list = econ < -1.1 && auth > 0 ? PARTY_FARLEFT : auth > 0.9 ? PARTY_AUTH : auth < -0.9 && econ > -0.5 ? PARTY_LIB
    : econ < -0.4 ? PARTY_LEFT : econ > 0.4 ? PARTY_RIGHT : PARTY_CENTER;
  return rng.pick(list);
}

const CAMPAIGN = ['A city that works', 'Fair shares for all', 'Safe streets, strong city', 'Lower taxes, more jobs', 'Homes for everyone', 'Build the future', 'Back to basics', 'Power to the people', 'Common sense, common good', 'Get things done', 'Order and progress', 'Freedom first'];

export function campaignSlogan(rng: Rng): string {
  return rng.pick(CAMPAIGN);
}

// ------------------------------------------------------------------ media

const CHANNEL = ['Channel 1', 'Channel 4', 'Channel 7', 'City TV', 'Metro News', 'KTV', 'Prime Time TV', 'News 24', 'The Local Channel', 'Civic Broadcasting'];

export function channelName(rng: Rng): string {
  return rng.pick(CHANNEL);
}

const SITE_SOCIAL = ['Chirp', 'Friendly', 'Circles', 'Pulse', 'Loop', 'Yap', 'Gather', 'Hive'];
const SITE_NEWS = ['The Daily Wire', 'City Herald Online', 'Newsbeat', 'The Ledger', 'Plain Facts'];
const SITE_SEARCH = ['Seekr', 'Findit', 'Lookup', 'Querio'];
const SITE_CLASS = ['Listly', 'Swapboard', 'Classified', 'Marketplace'];
const SITE_VIDEO = ['ClipTube', 'Viewly', 'Streamr'];
const SITE_FORUM = ['The Board', 'Citysquare Forum', 'Anon Corner', 'Threadly'];
const SITE_SHOP = ['ShopLocal', 'Cartly', 'MarketHub', 'Bazaarly'];
const SITE_JOBS = ['HireMe', 'WorkBoard', 'JobDock', 'Careerly'];
const SITE_HOMES = ['NestFinder', 'RentNow', 'HomeSpot', 'Doorstep'];
const SITE_DELIVERY = ['Dashly', 'FoodRun', 'Munchr', 'EatsNow'];
const SITE_RIDES = ['Zoom Rides', 'Hopp', 'Liftr', 'CityCab'];
const SITE_PAY = ['Payly', 'Coinflow', 'Zapp Pay', 'Tapcash'];
const SITE_CROWD = ['BackIt', 'Fundmade', 'StartTogether', 'Kickoff'];

export function siteName(rng: Rng, kind: SiteKind): string {
  const list = {
    social: SITE_SOCIAL, news: SITE_NEWS, search: SITE_SEARCH, classifieds: SITE_CLASS, video: SITE_VIDEO, forum: SITE_FORUM,
    shop: SITE_SHOP, jobs: SITE_JOBS, homes: SITE_HOMES, delivery: SITE_DELIVERY, rides: SITE_RIDES, pay: SITE_PAY, crowd: SITE_CROWD,
  }[kind];
  return rng.pick(list);
}
