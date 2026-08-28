import { ncaaConferencesWithSchools } from "@shared/ncaa-conferences";

const SCHOOL_ALIASES: Record<string, string[]> = {
  "alabama": ["bama", "crimson tide", "roll tide"],
  "alabama a&m": ["aamu"],
  "alabama state": ["bama state"],
  "arizona": ["u of a", "wildcats arizona"],
  "arizona state": ["asu", "sun devils"],
  "arkansas": ["razorbacks", "u of a arkansas"],
  "arkansas state": ["a-state", "red wolves"],
  "arkansas-pine bluff": ["uapb", "pine bluff"],
  "auburn": ["auburn tigers", "war eagle"],
  "appalachian state": ["app state", "mountaineers appalachian"],
  "air force": ["usafa", "air force academy", "falcons air force"],
  "akron": ["zips"],
  "alcorn state": ["alcorn"],
  "ball state": ["ball state cardinals"],
  "baylor": ["baylor bears"],
  "belmont": ["belmont bruins"],
  "bethune-cookman": ["b-cu", "bethune cookman"],
  "boise state": ["bsu", "broncos boise"],
  "boston college": ["bc", "eagles boston"],
  "bowling green": ["bgsu", "falcons bowling green"],
  "bradley": ["bradley braves"],
  "brigham young": ["byu", "cougars byu"],
  "brown": ["brown bears"],
  "buffalo": ["ub", "bulls buffalo"],
  "byu": ["brigham young", "cougars byu"],
  "california": ["cal", "cal bears", "golden bears", "uc berkeley", "berkeley"],
  "campbell": ["camels campbell"],
  "central michigan": ["cmu", "chippewas"],
  "charlotte": ["charlotte 49ers", "uncc"],
  "charleston": ["cofc", "college of charleston", "cougars charleston"],
  "cincinnati": ["uc", "bearcats"],
  "clemson": ["clemson tigers"],
  "cleveland state": ["csu vikings"],
  "coastal carolina": ["ccu", "chanticleers"],
  "colorado": ["cu", "buffaloes", "cu boulder"],
  "colorado state": ["csu", "rams colorado"],
  "columbia": ["columbia lions"],
  "coppin state": ["coppin"],
  "cornell": ["big red cornell"],
  "dartmouth": ["big green"],
  "davidson": ["davidson wildcats"],
  "dayton": ["dayton flyers", "ud flyers"],
  "delaware": ["blue hens", "ud"],
  "delaware state": ["dsu hornets"],
  "denver": ["du pioneers"],
  "detroit mercy": ["detroit titans", "udm"],
  "drake": ["drake bulldogs"],
  "drexel": ["drexel dragons"],
  "duke": ["duke blue devils", "blue devils"],
  "duquesne": ["duquesne dukes"],
  "east carolina": ["ecu", "pirates east carolina"],
  "eastern michigan": ["emu", "eagles eastern michigan"],
  "elon": ["elon phoenix"],
  "evansville": ["purple aces"],
  "fau": ["florida atlantic", "owls fau"],
  "fiu": ["florida international", "panthers fiu"],
  "florida": ["uf", "gators", "university of florida"],
  "florida a&m": ["famu", "rattlers"],
  "florida state": ["fsu", "seminoles", "noles"],
  "fordham": ["fordham rams"],
  "fresno state": ["fresno", "bulldogs fresno"],
  "george mason": ["mason", "patriots george mason"],
  "george washington": ["gw", "colonials"],
  "georgia": ["uga", "bulldogs georgia", "dawgs"],
  "georgia southern": ["ga southern", "eagles georgia southern"],
  "georgia state": ["gsu", "panthers georgia state"],
  "georgia tech": ["gt", "yellow jackets", "ga tech"],
  "gonzaga": ["zags"],
  "grambling state": ["grambling"],
  "green bay": ["gb phoenix", "uwgb"],
  "hampton": ["hampton pirates"],
  "harvard": ["harvard crimson", "crimson harvard"],
  "hawaii": ["hawai'i", "rainbow warriors", "uh manoa"],
  "hofstra": ["hofstra pride"],
  "houston": ["uh", "cougars houston"],
  "howard": ["howard bison"],
  "illinois": ["u of i", "fighting illini", "illini"],
  "illinois state": ["isu", "redbirds"],
  "indiana": ["iu", "hoosiers"],
  "indiana state": ["indiana st", "sycamores"],
  "iowa": ["hawkeyes", "university of iowa"],
  "iowa state": ["isu cyclones", "cyclones"],
  "iupui": ["indiana university-purdue university indianapolis"],
  "jackson state": ["jsu", "jsu tigers"],
  "jacksonville state": ["jax state", "gamecocks jacksonville"],
  "james madison": ["jmu", "dukes jmu"],
  "kansas": ["ku", "jayhawks"],
  "kansas city": ["umkc", "roos"],
  "kansas state": ["k-state", "ksu", "wildcats kansas"],
  "kennesaw state": ["ksu owls", "kennesaw"],
  "kent state": ["kent", "golden flashes"],
  "kentucky": ["uk", "wildcats kentucky"],
  "la salle": ["lasalle", "explorers"],
  "liberty": ["liberty flames"],
  "louisiana": ["ul", "ul lafayette", "ragin cajuns", "ragin' cajuns", "cajuns"],
  "louisiana tech": ["la tech", "bulldogs louisiana tech"],
  "louisville": ["u of l", "cardinals louisville", "cards"],
  "loyola chicago": ["loyola", "ramblers"],
  "loyola marymount": ["lmu", "lions lmu"],
  "lsu": ["louisiana state", "tigers lsu", "geaux tigers"],
  "marshall": ["thundering herd", "herd"],
  "maryland": ["umd", "terrapins", "terps"],
  "maryland eastern shore": ["umes", "hawks umes"],
  "memphis": ["u of m", "tigers memphis"],
  "miami": ["miami fl", "miami florida", "hurricanes", "the u"],
  "miami (oh)": ["miami ohio", "miami of ohio", "redhawks"],
  "michigan": ["u of m michigan", "wolverines", "umich"],
  "michigan state": ["msu", "spartans michigan"],
  "middle tennessee": ["mtsu", "blue raiders"],
  "milwaukee": ["uwm", "panthers milwaukee"],
  "minnesota": ["u of m minnesota", "golden gophers", "gophers"],
  "mississippi state": ["miss state", "msu mississippi", "bulldogs mississippi"],
  "mississippi valley state": ["mvsu", "delta devils"],
  "missouri": ["mizzou", "mu tigers"],
  "missouri state": ["mo state", "bears missouri"],
  "monmouth": ["monmouth hawks"],
  "morgan state": ["morgan", "bears morgan"],
  "murray state": ["murray", "racers"],
  "navy": ["naval academy", "usna", "midshipmen"],
  "nc central": ["nccu", "north carolina central", "eagles nccu"],
  "nc state": ["north carolina state", "ncsu", "wolfpack"],
  "nebraska": ["huskers", "cornhuskers"],
  "nevada": ["unr", "wolf pack"],
  "new mexico": ["unm", "lobos"],
  "new mexico state": ["nmsu", "aggies new mexico"],
  "norfolk state": ["nsu", "spartans norfolk"],
  "north carolina": ["unc", "tar heels", "tarheels", "carolina"],
  "north carolina a&t": ["ncat", "nc a&t", "aggies ncat"],
  "north dakota": ["und", "fighting hawks"],
  "north dakota state": ["ndsu", "bison"],
  "north texas": ["unt", "mean green"],
  "northeastern": ["huskies northeastern"],
  "northern illinois": ["niu", "huskies niu"],
  "northern iowa": ["uni", "panthers uni"],
  "northern kentucky": ["nku", "norse"],
  "northwestern": ["nu", "wildcats northwestern"],
  "notre dame": ["nd", "fighting irish", "irish"],
  "oakland": ["golden grizzlies"],
  "ohio": ["ohio bobcats", "bobcats", "ohio university"],
  "ohio state": ["osu", "buckeyes", "the ohio state"],
  "oklahoma": ["ou", "sooners"],
  "oklahoma state": ["osu cowboys", "cowboys oklahoma", "okstate", "ok state"],
  "old dominion": ["odu", "monarchs"],
  "ole miss": ["mississippi", "rebels", "university of mississippi"],
  "omaha": ["uno", "mavericks omaha"],
  "oral roberts": ["oru", "golden eagles oral roberts"],
  "oregon": ["uo", "ducks"],
  "oregon state": ["osu beavers", "beavers"],
  "pacific": ["pacific tigers", "uop"],
  "penn": ["upenn", "pennsylvania", "quakers"],
  "penn state": ["psu", "nittany lions"],
  "pepperdine": ["pepperdine waves", "waves"],
  "pitt": ["pittsburgh", "panthers pitt", "university of pittsburgh"],
  "portland": ["portland pilots", "pilots"],
  "prairie view a&m": ["pvamu", "prairie view"],
  "princeton": ["princeton tigers"],
  "purdue": ["boilermakers"],
  "purdue fort wayne": ["pfw", "mastodons"],
  "rhode island": ["uri", "rams rhode island"],
  "rice": ["rice owls"],
  "richmond": ["richmond spiders", "spiders"],
  "robert morris": ["rmu", "colonials robert morris"],
  "rutgers": ["ru", "scarlet knights"],
  "saint joseph's": ["st. joseph's", "saint joe's", "st joe's", "hawks saint josephs"],
  "saint louis": ["slu", "billikens"],
  "saint mary's": ["st. mary's", "gaels", "saint marys"],
  "sam houston": ["shsu", "sam houston state", "bearkats"],
  "san diego": ["usd", "toreros"],
  "san diego state": ["sdsu", "aztecs"],
  "san francisco": ["usf", "dons"],
  "san jose state": ["sjsu", "spartans san jose"],
  "santa clara": ["scu", "broncos santa clara"],
  "sc state": ["south carolina state", "scsu", "bulldogs sc state"],
  "south alabama": ["usa jaguars", "jaguars south alabama"],
  "south carolina": ["usc south carolina", "gamecocks"],
  "south dakota": ["usd", "coyotes"],
  "south dakota state": ["sdsu jackrabbits", "jackrabbits"],
  "south florida": ["usf bulls", "bulls south florida"],
  "southern": ["southern university", "jaguars southern", "subr"],
  "southern illinois": ["siu", "salukis"],
  "southern miss": ["usm", "southern mississippi", "golden eagles southern miss"],
  "st. bonaventure": ["saint bonaventure", "bonnies"],
  "st. thomas": ["saint thomas", "tommies"],
  "stanford": ["cardinal stanford"],
  "stony brook": ["seawolves"],
  "syracuse": ["cuse", "orange"],
  "tcu": ["texas christian", "horned frogs"],
  "temple": ["temple owls"],
  "tennessee": ["ut", "vols", "volunteers"],
  "texas": ["ut austin", "longhorns", "university of texas"],
  "texas a&m": ["tamu", "aggies", "aggies texas"],
  "texas southern": ["tsu", "tigers texas southern"],
  "texas state": ["txst", "bobcats texas state"],
  "texas tech": ["ttu", "red raiders"],
  "toledo": ["rockets toledo", "ut rockets"],
  "towson": ["towson tigers"],
  "troy": ["troy trojans"],
  "tulane": ["tulane green wave", "green wave"],
  "tulsa": ["tulsa hurricane", "golden hurricane"],
  "uab": ["alabama-birmingham", "blazers"],
  "ucf": ["central florida", "knights"],
  "ucla": ["bruins", "university of california los angeles"],
  "uic": ["illinois-chicago", "flames uic"],
  "ul monroe": ["ulm", "warhawks", "louisiana-monroe"],
  "umass": ["massachusetts", "minutemen"],
  "unc wilmington": ["uncw", "seahawks"],
  "unlv": ["rebels unlv", "las vegas"],
  "usc": ["southern california", "trojans", "southern cal"],
  "utah": ["utes", "university of utah"],
  "utah state": ["usu", "aggies utah"],
  "utep": ["texas-el paso", "miners"],
  "utsa": ["texas-san antonio", "roadrunners"],
  "valparaiso": ["valpo", "beacons"],
  "vanderbilt": ["vandy", "commodores"],
  "vcu": ["virginia commonwealth", "rams vcu"],
  "virginia": ["uva", "cavaliers", "wahoos"],
  "virginia tech": ["vt", "hokies"],
  "wake forest": ["wake", "demon deacons"],
  "washington": ["uw", "huskies washington", "udub"],
  "washington state": ["wsu", "cougars washington state", "cougs"],
  "west virginia": ["wvu", "mountaineers"],
  "western kentucky": ["wku", "hilltoppers"],
  "western michigan": ["wmu", "broncos western michigan"],
  "wichita state": ["wichita", "shockers"],
  "william & mary": ["w&m", "tribe", "william and mary"],
  "wisconsin": ["uw madison", "badgers"],
  "wright state": ["wright", "raiders wright"],
  "wyoming": ["cowboys wyoming", "pokes"],
  "yale": ["yale bulldogs", "bulldogs yale", "elis"],
  "youngstown state": ["ysu", "penguins"],
};

const conferenceUrlCache = new Map<string, string>();
let cacheBuilt = false;

function buildConferenceUrlCache(): void {
  if (cacheBuilt) return;

  for (const conf of ncaaConferencesWithSchools) {
    for (const school of conf.schools) {
      if (!school.staffDirectoryUrl) continue;
      const normalized = school.name.toLowerCase().trim();
      conferenceUrlCache.set(normalized, school.staffDirectoryUrl);
    }
  }
  cacheBuilt = true;
}

function normalizeSchoolName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\buniversity\b/gi, "")
    .replace(/\bof\b/gi, "")
    .replace(/\bthe\b/gi, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findConferenceUrlBySchoolName(schoolName: string): string | null {
  buildConferenceUrlCache();

  const normalized = normalizeSchoolName(schoolName);

  const cacheEntries = Array.from(conferenceUrlCache.entries());

  for (let i = 0; i < cacheEntries.length; i++) {
    if (cacheEntries[i][0] === normalized) {
      return cacheEntries[i][1];
    }
  }

  const aliasEntries = Object.entries(SCHOOL_ALIASES);
  for (let i = 0; i < aliasEntries.length; i++) {
    const [canonical, aliases] = aliasEntries[i];
    if (canonical === normalized || aliases.some((a) => a === normalized)) {
      const url = conferenceUrlCache.get(canonical);
      if (url) return url;
      for (let j = 0; j < aliases.length; j++) {
        const aliasUrl = conferenceUrlCache.get(aliases[j]);
        if (aliasUrl) return aliasUrl;
      }
    }
  }

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (let i = 0; i < cacheEntries.length; i++) {
    const score = tokenSimilarity(normalized, cacheEntries[i][0]);
    if (score > 0.85 && score > bestScore) {
      bestScore = score;
      bestMatch = cacheEntries[i][1];
    }
  }

  return bestMatch;
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = a.split(/\s+/).filter((t) => t.length > 1);
  const tokensB = b.split(/\s+/).filter((t) => t.length > 1);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  let intersection = 0;
  for (let i = 0; i < tokensA.length; i++) {
    if (setB.has(tokensA[i])) intersection++;
  }

  const allTokens = new Set([...tokensA, ...tokensB]);
  return intersection / allTokens.size;
}

export function findConferenceUrlBySchoolId(schoolId: string): string | null {
  let name = schoolId.replace(/-/g, " ").replace(/\d+/g, "").trim();

  name = name
    .replace(/\ba m\b/g, "a&m")
    .replace(/\ba t\b/g, "a&t")
    .replace(/\bam$/g, "a&m")
    .replace(/\bat$/g, "a&t");

  return findConferenceUrlBySchoolName(name);
}

export function getAllConferenceUrls(): Map<string, string> {
  buildConferenceUrlCache();
  return new Map(conferenceUrlCache);
}
