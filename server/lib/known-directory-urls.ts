import { findConferenceUrlBySchoolId, findConferenceUrlBySchoolName } from './school-name-matcher';

export interface DirectoryOverride {
  directoryUrl: string;
  athleticsBaseUrl?: string;
  notes?: string;
  lastVerified?: string;
}

export const KNOWN_DIRECTORY_URLS: Record<string, DirectoryOverride> = {
  "brigham-young": {
    directoryUrl: "https://byucougars.com/staff-directory",
    athleticsBaseUrl: "https://byucougars.com",
    lastVerified: "2024-12-06",
  },
  "byu": {
    directoryUrl: "https://byucougars.com/staff-directory",
    athleticsBaseUrl: "https://byucougars.com",
    lastVerified: "2024-12-06",
  },
  "arizona": {
    directoryUrl: "https://arizonawildcats.com/staff-directory",
    athleticsBaseUrl: "https://arizonawildcats.com",
    lastVerified: "2024-12-06",
  },
  "alabama": {
    directoryUrl: "https://rolltide.com/staff-directory",
    athleticsBaseUrl: "https://rolltide.com",
    lastVerified: "2025-03-20",
  },
  "arkansas": {
    directoryUrl: "https://arkansasrazorbacks.com/staff-directory",
    athleticsBaseUrl: "https://arkansasrazorbacks.com",
    lastVerified: "2025-03-20",
  },
  "auburn": {
    directoryUrl: "https://auburntigers.com/staff-directory",
    athleticsBaseUrl: "https://auburntigers.com",
    lastVerified: "2025-03-20",
  },
  "florida": {
    directoryUrl: "https://floridagators.com/staff-directory",
    athleticsBaseUrl: "https://floridagators.com",
    lastVerified: "2025-03-20",
  },
  "georgia": {
    directoryUrl: "https://georgiadogs.com/staff-directory",
    athleticsBaseUrl: "https://georgiadogs.com",
    lastVerified: "2025-03-20",
  },
  "kentucky": {
    directoryUrl: "https://ukathletics.com/staff-directory",
    athleticsBaseUrl: "https://ukathletics.com",
    lastVerified: "2025-03-20",
  },
  "lsu": {
    directoryUrl: "https://lsusports.net/staff-directory",
    athleticsBaseUrl: "https://lsusports.net",
    lastVerified: "2025-03-20",
  },
  "mississippi-state": {
    directoryUrl: "https://hailstate.com/staff-directory",
    athleticsBaseUrl: "https://hailstate.com",
    lastVerified: "2025-03-20",
  },
  "missouri": {
    directoryUrl: "https://mutigers.com/staff-directory",
    athleticsBaseUrl: "https://mutigers.com",
    lastVerified: "2025-03-20",
  },
  "ole-miss": {
    directoryUrl: "https://olemisssports.com/staff-directory",
    athleticsBaseUrl: "https://olemisssports.com",
    lastVerified: "2025-03-20",
  },
  "mississippi": {
    directoryUrl: "https://olemisssports.com/staff-directory",
    athleticsBaseUrl: "https://olemisssports.com",
    lastVerified: "2025-03-20",
  },
  "south-carolina": {
    directoryUrl: "https://gamecocksonline.com/staff-directory",
    athleticsBaseUrl: "https://gamecocksonline.com",
    lastVerified: "2025-03-20",
  },
  "tennessee": {
    directoryUrl: "https://utsports.com/staff-directory",
    athleticsBaseUrl: "https://utsports.com",
    lastVerified: "2025-03-20",
  },
  "texas-a-m": {
    directoryUrl: "https://12thman.com/staff-directory",
    athleticsBaseUrl: "https://12thman.com",
    lastVerified: "2025-03-20",
  },
  "texas-am": {
    directoryUrl: "https://12thman.com/staff-directory",
    athleticsBaseUrl: "https://12thman.com",
    lastVerified: "2025-03-20",
  },
  "vanderbilt": {
    directoryUrl: "https://vucommodores.com/staff-directory",
    athleticsBaseUrl: "https://vucommodores.com",
    lastVerified: "2025-03-20",
  },
  "illinois": {
    directoryUrl: "https://fightingillini.com/staff-directory",
    athleticsBaseUrl: "https://fightingillini.com",
    lastVerified: "2025-03-20",
  },
  "indiana": {
    directoryUrl: "https://iuhoosiers.com/staff-directory",
    athleticsBaseUrl: "https://iuhoosiers.com",
    lastVerified: "2025-03-20",
  },
  "iowa": {
    directoryUrl: "https://hawkeyesports.com/staff-directory",
    athleticsBaseUrl: "https://hawkeyesports.com",
    lastVerified: "2025-03-20",
  },
  "maryland": {
    directoryUrl: "https://umterps.com/staff-directory",
    athleticsBaseUrl: "https://umterps.com",
    lastVerified: "2025-03-20",
  },
  "michigan": {
    directoryUrl: "https://static.mgoblue.com/custompages/library/staff/staff-dept.html",
    athleticsBaseUrl: "https://mgoblue.com",
    lastVerified: "2025-03-20",
  },
  "michigan-state": {
    directoryUrl: "https://msuspartans.com/staff-directory",
    athleticsBaseUrl: "https://msuspartans.com",
    lastVerified: "2025-03-20",
  },
  "minnesota": {
    directoryUrl: "https://gophersports.com/staff-directory",
    athleticsBaseUrl: "https://gophersports.com",
    lastVerified: "2025-03-20",
  },
  "nebraska": {
    directoryUrl: "https://huskers.com/staff-directory",
    athleticsBaseUrl: "https://huskers.com",
    lastVerified: "2025-03-20",
  },
  "northwestern": {
    directoryUrl: "https://nusports.com/staff-directory",
    athleticsBaseUrl: "https://nusports.com",
    lastVerified: "2025-03-20",
  },
  "ohio-state": {
    directoryUrl: "https://ohiostatebuckeyes.com/staff-directory",
    athleticsBaseUrl: "https://ohiostatebuckeyes.com",
    lastVerified: "2025-03-20",
  },
  "penn-state": {
    directoryUrl: "https://gopsusports.com/staff-directory",
    athleticsBaseUrl: "https://gopsusports.com",
    lastVerified: "2025-03-20",
  },
  "purdue": {
    directoryUrl: "https://purduesports.com/staff-directory",
    athleticsBaseUrl: "https://purduesports.com",
    lastVerified: "2025-03-20",
  },
  "rutgers": {
    directoryUrl: "https://scarletknights.com/staff-directory",
    athleticsBaseUrl: "https://scarletknights.com",
    lastVerified: "2025-03-20",
  },
  "wisconsin": {
    directoryUrl: "https://uwbadgers.com/staff-directory",
    athleticsBaseUrl: "https://uwbadgers.com",
    lastVerified: "2025-03-20",
  },
  "boston-college": {
    directoryUrl: "https://bceagles.com/staff-directory",
    athleticsBaseUrl: "https://bceagles.com",
    lastVerified: "2025-03-20",
  },
  "clemson": {
    directoryUrl: "https://clemsontigers.com/staff-directory",
    athleticsBaseUrl: "https://clemsontigers.com",
    lastVerified: "2025-03-20",
  },
  "duke": {
    directoryUrl: "https://goduke.com/staff-directory",
    athleticsBaseUrl: "https://goduke.com",
    lastVerified: "2025-03-20",
  },
  "florida-state": {
    directoryUrl: "https://seminoles.com/staff-directory",
    athleticsBaseUrl: "https://seminoles.com",
    lastVerified: "2025-03-20",
  },
  "georgia-tech": {
    directoryUrl: "https://ramblinwreck.com/staff-directory",
    athleticsBaseUrl: "https://ramblinwreck.com",
    lastVerified: "2025-03-20",
  },
  "louisville": {
    directoryUrl: "https://gocards.com/staff-directory",
    athleticsBaseUrl: "https://gocards.com",
    lastVerified: "2025-03-20",
  },
  "miami": {
    directoryUrl: "https://hurricanesports.com/staff-directory",
    athleticsBaseUrl: "https://hurricanesports.com",
    lastVerified: "2025-03-20",
  },
  "nc-state": {
    directoryUrl: "https://gopack.com/staff-directory",
    athleticsBaseUrl: "https://gopack.com",
    lastVerified: "2025-03-20",
  },
  "north-carolina": {
    directoryUrl: "https://goheels.com/staff-directory",
    athleticsBaseUrl: "https://goheels.com",
    lastVerified: "2025-03-20",
  },
  "notre-dame": {
    directoryUrl: "https://fightingirish.com/staff-directory",
    athleticsBaseUrl: "https://fightingirish.com",
    lastVerified: "2025-03-20",
  },
  "pitt": {
    directoryUrl: "https://pittsburghpanthers.com/staff-directory",
    athleticsBaseUrl: "https://pittsburghpanthers.com",
    lastVerified: "2025-03-20",
  },
  "pittsburgh": {
    directoryUrl: "https://pittsburghpanthers.com/staff-directory",
    athleticsBaseUrl: "https://pittsburghpanthers.com",
    lastVerified: "2025-03-20",
  },
  "syracuse": {
    directoryUrl: "https://cuse.com/staff-directory",
    athleticsBaseUrl: "https://cuse.com",
    lastVerified: "2025-03-20",
  },
  "virginia": {
    directoryUrl: "https://virginiasports.com/staff-directory",
    athleticsBaseUrl: "https://virginiasports.com",
    lastVerified: "2025-03-20",
  },
  "virginia-tech": {
    directoryUrl: "https://hokiesports.com/staff-directory",
    athleticsBaseUrl: "https://hokiesports.com",
    lastVerified: "2025-03-20",
  },
  "wake-forest": {
    directoryUrl: "https://wakeforestsports.com/staff-directory",
    athleticsBaseUrl: "https://wakeforestsports.com",
    lastVerified: "2025-03-20",
  },
  "arizona-state": {
    directoryUrl: "https://thesundevils.com/staff-directory",
    athleticsBaseUrl: "https://thesundevils.com",
    lastVerified: "2025-03-20",
  },
  "california": {
    directoryUrl: "https://calbears.com/staff-directory",
    athleticsBaseUrl: "https://calbears.com",
    lastVerified: "2025-03-20",
  },
  "colorado": {
    directoryUrl: "https://cubuffs.com/staff-directory",
    athleticsBaseUrl: "https://cubuffs.com",
    lastVerified: "2025-03-20",
  },
  "oregon": {
    directoryUrl: "https://goducks.com/staff-directory",
    athleticsBaseUrl: "https://goducks.com",
    lastVerified: "2025-03-20",
  },
  "oregon-state": {
    directoryUrl: "https://osubeavers.com/staff-directory",
    athleticsBaseUrl: "https://osubeavers.com",
    lastVerified: "2025-03-20",
  },
  "stanford": {
    directoryUrl: "https://gostanford.com/staff-directory",
    athleticsBaseUrl: "https://gostanford.com",
    lastVerified: "2025-03-20",
  },
  "ucla": {
    directoryUrl: "https://uclabruins.com/staff-directory",
    athleticsBaseUrl: "https://uclabruins.com",
    lastVerified: "2025-03-20",
  },
  "usc": {
    directoryUrl: "https://usctrojans.com/staff-directory",
    athleticsBaseUrl: "https://usctrojans.com",
    lastVerified: "2025-03-20",
  },
  "southern-california": {
    directoryUrl: "https://usctrojans.com/staff-directory",
    athleticsBaseUrl: "https://usctrojans.com",
    lastVerified: "2025-03-20",
  },
  "utah": {
    directoryUrl: "https://utahutes.com/staff-directory",
    athleticsBaseUrl: "https://utahutes.com",
    lastVerified: "2025-03-20",
  },
  "washington": {
    directoryUrl: "https://gohuskies.com/staff-directory",
    athleticsBaseUrl: "https://gohuskies.com",
    lastVerified: "2025-03-20",
  },
  "washington-state": {
    directoryUrl: "https://wsucougars.com/staff-directory",
    athleticsBaseUrl: "https://wsucougars.com",
    lastVerified: "2025-03-20",
  },
  "baylor": {
    directoryUrl: "https://baylorbears.com/staff-directory",
    athleticsBaseUrl: "https://baylorbears.com",
    lastVerified: "2025-03-20",
  },
  "cincinnati": {
    directoryUrl: "https://gobearcats.com/staff-directory",
    athleticsBaseUrl: "https://gobearcats.com",
    lastVerified: "2025-03-20",
  },
  "houston": {
    directoryUrl: "https://uhcougars.com/staff-directory",
    athleticsBaseUrl: "https://uhcougars.com",
    lastVerified: "2025-03-20",
  },
  "iowa-state": {
    directoryUrl: "https://cyclones.com/staff-directory",
    athleticsBaseUrl: "https://cyclones.com",
    lastVerified: "2025-03-20",
  },
  "kansas": {
    directoryUrl: "https://kuathletics.com/staff-directory",
    athleticsBaseUrl: "https://kuathletics.com",
    lastVerified: "2025-03-20",
  },
  "kansas-state": {
    directoryUrl: "https://kstatesports.com/staff-directory",
    athleticsBaseUrl: "https://kstatesports.com",
    lastVerified: "2025-03-20",
  },
  "oklahoma": {
    directoryUrl: "https://soonersports.com/staff-directory",
    athleticsBaseUrl: "https://soonersports.com",
    lastVerified: "2025-03-20",
  },
  "oklahoma-state": {
    directoryUrl: "https://okstate.com/staff-directory",
    athleticsBaseUrl: "https://okstate.com",
    lastVerified: "2025-03-20",
  },
  "texas": {
    directoryUrl: "https://texassports.com/staff-directory",
    athleticsBaseUrl: "https://texassports.com",
    lastVerified: "2025-03-20",
  },
  "tcu": {
    directoryUrl: "https://gofrogs.com/staff-directory",
    athleticsBaseUrl: "https://gofrogs.com",
    lastVerified: "2025-03-20",
  },
  "texas-tech": {
    directoryUrl: "https://texastech.com/staff-directory",
    athleticsBaseUrl: "https://texastech.com",
    lastVerified: "2025-03-20",
  },
  "ucf": {
    directoryUrl: "https://ucfknights.com/staff-directory",
    athleticsBaseUrl: "https://ucfknights.com",
    lastVerified: "2025-03-20",
  },
  "west-virginia": {
    directoryUrl: "https://wvusports.com/staff-directory",
    athleticsBaseUrl: "https://wvusports.com",
    lastVerified: "2025-03-20",
  },
  "brown": {
    directoryUrl: "https://brownbears.com/staff-directory",
    athleticsBaseUrl: "https://brownbears.com",
    lastVerified: "2025-03-20",
  },
  "columbia": {
    directoryUrl: "https://gocolumbialions.com/staff-directory",
    athleticsBaseUrl: "https://gocolumbialions.com",
    lastVerified: "2025-03-20",
  },
  "cornell": {
    directoryUrl: "https://cornellbigred.com/staff-directory",
    athleticsBaseUrl: "https://cornellbigred.com",
    lastVerified: "2025-03-20",
  },
  "dartmouth": {
    directoryUrl: "https://dartmouthsports.com/staff-directory",
    athleticsBaseUrl: "https://dartmouthsports.com",
    lastVerified: "2025-03-20",
  },
  "harvard": {
    directoryUrl: "https://gocrimson.com/staff-directory",
    athleticsBaseUrl: "https://gocrimson.com",
    lastVerified: "2025-03-20",
  },
  "penn": {
    directoryUrl: "https://pennathletics.com/staff-directory",
    athleticsBaseUrl: "https://pennathletics.com",
    lastVerified: "2025-03-20",
  },
  "princeton": {
    directoryUrl: "https://goprincetontigers.com/staff-directory",
    athleticsBaseUrl: "https://goprincetontigers.com",
    lastVerified: "2025-03-20",
  },
  "yale": {
    directoryUrl: "https://yalebulldogs.com/staff-directory",
    athleticsBaseUrl: "https://yalebulldogs.com",
    lastVerified: "2025-03-20",
  },
  "air-force": {
    directoryUrl: "https://goairforcefalcons.com/staff-directory",
    athleticsBaseUrl: "https://goairforcefalcons.com",
    lastVerified: "2025-03-20",
  },
  "boise-state": {
    directoryUrl: "https://broncosports.com/staff-directory",
    athleticsBaseUrl: "https://broncosports.com",
    lastVerified: "2025-03-20",
  },
  "colorado-state": {
    directoryUrl: "https://csurams.com/staff-directory",
    athleticsBaseUrl: "https://csurams.com",
    lastVerified: "2025-03-20",
  },
  "fresno-state": {
    directoryUrl: "https://gobulldogs.com/staff-directory",
    athleticsBaseUrl: "https://gobulldogs.com",
    lastVerified: "2025-03-20",
  },
  "hawaii": {
    directoryUrl: "https://hawaiiathletics.com/staff-directory",
    athleticsBaseUrl: "https://hawaiiathletics.com",
    lastVerified: "2025-03-20",
  },
  "nevada": {
    directoryUrl: "https://nevadawolfpack.com/staff-directory",
    athleticsBaseUrl: "https://nevadawolfpack.com",
    lastVerified: "2025-03-20",
  },
  "new-mexico": {
    directoryUrl: "https://golobos.com/staff-directory",
    athleticsBaseUrl: "https://golobos.com",
    lastVerified: "2025-03-20",
  },
  "san-diego-state": {
    directoryUrl: "https://goaztecs.com/staff-directory",
    athleticsBaseUrl: "https://goaztecs.com",
    lastVerified: "2025-03-20",
  },
  "san-jose-state": {
    directoryUrl: "https://sjsuspartans.com/staff-directory",
    athleticsBaseUrl: "https://sjsuspartans.com",
    lastVerified: "2025-03-20",
  },
  "unlv": {
    directoryUrl: "https://unlvrebels.com/staff-directory",
    athleticsBaseUrl: "https://unlvrebels.com",
    lastVerified: "2025-03-20",
  },
  "utah-state": {
    directoryUrl: "https://utahstateaggies.com/staff-directory",
    athleticsBaseUrl: "https://utahstateaggies.com",
    lastVerified: "2025-03-20",
  },
  "wyoming": {
    directoryUrl: "https://gowyo.com/staff-directory",
    athleticsBaseUrl: "https://gowyo.com",
    lastVerified: "2025-03-20",
  },
  "appalachian-state": {
    directoryUrl: "https://appstatesports.com/staff-directory",
    athleticsBaseUrl: "https://appstatesports.com",
    lastVerified: "2025-03-20",
  },
  "arkansas-state": {
    directoryUrl: "https://astateredwolves.com/staff-directory",
    athleticsBaseUrl: "https://astateredwolves.com",
    lastVerified: "2025-03-20",
  },
  "coastal-carolina": {
    directoryUrl: "https://goccusports.com/staff-directory",
    athleticsBaseUrl: "https://goccusports.com",
    lastVerified: "2025-03-20",
  },
  "georgia-state": {
    directoryUrl: "https://georgiastatesports.com/staff-directory",
    athleticsBaseUrl: "https://georgiastatesports.com",
    lastVerified: "2025-03-20",
  },
  "georgia-southern": {
    directoryUrl: "https://gseagles.com/staff-directory",
    athleticsBaseUrl: "https://gseagles.com",
    lastVerified: "2025-03-20",
  },
  "james-madison": {
    directoryUrl: "https://jmusports.com/staff-directory",
    athleticsBaseUrl: "https://jmusports.com",
    lastVerified: "2025-03-20",
  },
  "louisiana": {
    directoryUrl: "https://ragincajuns.com/staff-directory",
    athleticsBaseUrl: "https://ragincajuns.com",
    lastVerified: "2025-03-20",
  },
  "marshall": {
    directoryUrl: "https://herdzone.com/staff-directory",
    athleticsBaseUrl: "https://herdzone.com",
    lastVerified: "2025-03-20",
  },
  "old-dominion": {
    directoryUrl: "https://odusports.com/staff-directory",
    athleticsBaseUrl: "https://odusports.com",
    lastVerified: "2025-03-20",
  },
  "southern-miss": {
    directoryUrl: "https://southernmiss.com/staff-directory",
    athleticsBaseUrl: "https://southernmiss.com",
    lastVerified: "2025-03-20",
  },
  "texas-state": {
    directoryUrl: "https://txstatebobcats.com/staff-directory",
    athleticsBaseUrl: "https://txstatebobcats.com",
    lastVerified: "2025-03-20",
  },
  "troy": {
    directoryUrl: "https://troytrojans.com/staff-directory",
    athleticsBaseUrl: "https://troytrojans.com",
    lastVerified: "2025-03-20",
  },
  "charlotte": {
    directoryUrl: "https://charlotte49ers.com/staff-directory",
    athleticsBaseUrl: "https://charlotte49ers.com",
    lastVerified: "2025-03-20",
  },
  "east-carolina": {
    directoryUrl: "https://ecupirates.com/staff-directory",
    athleticsBaseUrl: "https://ecupirates.com",
    lastVerified: "2025-03-20",
  },
  "fau": {
    directoryUrl: "https://fausports.com/staff-directory",
    athleticsBaseUrl: "https://fausports.com",
    lastVerified: "2025-03-20",
  },
  "memphis": {
    directoryUrl: "https://gotigersgo.com/staff-directory",
    athleticsBaseUrl: "https://gotigersgo.com",
    lastVerified: "2025-03-20",
  },
  "navy": {
    directoryUrl: "https://navysports.com/staff-directory",
    athleticsBaseUrl: "https://navysports.com",
    lastVerified: "2025-03-20",
  },
  "north-texas": {
    directoryUrl: "https://meangreensports.com/staff-directory",
    athleticsBaseUrl: "https://meangreensports.com",
    lastVerified: "2025-03-20",
  },
  "rice": {
    directoryUrl: "https://riceowls.com/staff-directory",
    athleticsBaseUrl: "https://riceowls.com",
    lastVerified: "2025-03-20",
  },
  "south-florida": {
    directoryUrl: "https://gousfbulls.com/staff-directory",
    athleticsBaseUrl: "https://gousfbulls.com",
    lastVerified: "2025-03-20",
  },
  "temple": {
    directoryUrl: "https://owlsports.com/staff-directory",
    athleticsBaseUrl: "https://owlsports.com",
    lastVerified: "2025-03-20",
  },
  "tulane": {
    directoryUrl: "https://tulanegreenwave.com/staff-directory",
    athleticsBaseUrl: "https://tulanegreenwave.com",
    lastVerified: "2025-03-20",
  },
  "tulsa": {
    directoryUrl: "https://tulsahurricane.com/staff-directory",
    athleticsBaseUrl: "https://tulsahurricane.com",
    lastVerified: "2025-03-20",
  },
  "uab": {
    directoryUrl: "https://uabsports.com/staff-directory",
    athleticsBaseUrl: "https://uabsports.com",
    lastVerified: "2025-03-20",
  },
  "utsa": {
    directoryUrl: "https://goutsa.com/staff-directory",
    athleticsBaseUrl: "https://goutsa.com",
    lastVerified: "2025-03-20",
  },
  "wichita-state": {
    directoryUrl: "https://goshockers.com/staff-directory",
    athleticsBaseUrl: "https://goshockers.com",
    lastVerified: "2025-03-20",
  },
  "akron": {
    directoryUrl: "https://gozips.com/staff-directory",
    athleticsBaseUrl: "https://gozips.com",
    lastVerified: "2025-03-20",
  },
  "ball-state": {
    directoryUrl: "https://ballstatesports.com/staff-directory",
    athleticsBaseUrl: "https://ballstatesports.com",
    lastVerified: "2025-03-20",
  },
  "bowling-green": {
    directoryUrl: "https://bgsufalcons.com/staff-directory",
    athleticsBaseUrl: "https://bgsufalcons.com",
    lastVerified: "2025-03-20",
  },
  "buffalo": {
    directoryUrl: "https://ubbulls.com/staff-directory",
    athleticsBaseUrl: "https://ubbulls.com",
    lastVerified: "2025-03-20",
  },
  "central-michigan": {
    directoryUrl: "https://cmuchippewas.com/staff-directory",
    athleticsBaseUrl: "https://cmuchippewas.com",
    lastVerified: "2025-03-20",
  },
  "eastern-michigan": {
    directoryUrl: "https://emueagles.com/staff-directory",
    athleticsBaseUrl: "https://emueagles.com",
    lastVerified: "2025-03-20",
  },
  "kent-state": {
    directoryUrl: "https://kentstatesports.com/staff-directory",
    athleticsBaseUrl: "https://kentstatesports.com",
    lastVerified: "2025-03-20",
  },
  "northern-illinois": {
    directoryUrl: "https://niuhuskies.com/staff-directory",
    athleticsBaseUrl: "https://niuhuskies.com",
    lastVerified: "2025-03-20",
  },
  "ohio": {
    directoryUrl: "https://ohiobobcats.com/staff-directory",
    athleticsBaseUrl: "https://ohiobobcats.com",
    lastVerified: "2025-03-20",
  },
  "toledo": {
    directoryUrl: "https://utrockets.com/staff-directory",
    athleticsBaseUrl: "https://utrockets.com",
    lastVerified: "2025-03-20",
  },
  "western-michigan": {
    directoryUrl: "https://wmubroncos.com/staff-directory",
    athleticsBaseUrl: "https://wmubroncos.com",
    lastVerified: "2025-03-20",
  },
  "gonzaga": {
    directoryUrl: "https://gozags.com/staff-directory",
    athleticsBaseUrl: "https://gozags.com",
    lastVerified: "2025-03-20",
  },
  "liberty": {
    directoryUrl: "https://libertyflames.com/staff-directory",
    athleticsBaseUrl: "https://libertyflames.com",
    lastVerified: "2025-03-20",
  },
  "sam-houston": {
    directoryUrl: "https://gobearkats.com/staff-directory",
    athleticsBaseUrl: "https://gobearkats.com",
    lastVerified: "2025-03-20",
  },
  "north-dakota-state": {
    directoryUrl: "https://gobison.com/staff-directory",
    athleticsBaseUrl: "https://gobison.com",
    lastVerified: "2025-03-20",
  },
  "south-dakota-state": {
    directoryUrl: "https://gojacks.com/staff-directory",
    athleticsBaseUrl: "https://gojacks.com",
    lastVerified: "2025-03-20",
  },
  "campbell": {
    directoryUrl: "https://gocamels.com/staff-directory",
    athleticsBaseUrl: "https://gocamels.com",
    lastVerified: "2025-03-20",
  },
  "charleston": {
    directoryUrl: "https://cofcsports.com/staff-directory",
    athleticsBaseUrl: "https://cofcsports.com",
    lastVerified: "2025-03-20",
  },
  "delaware": {
    directoryUrl: "https://bluehens.com/staff-directory",
    athleticsBaseUrl: "https://bluehens.com",
    lastVerified: "2025-03-20",
  },
  "drexel": {
    directoryUrl: "https://drexeldragons.com/staff-directory",
    athleticsBaseUrl: "https://drexeldragons.com",
    lastVerified: "2025-03-20",
  },
  "elon": {
    directoryUrl: "https://elonphoenix.com/staff-directory",
    athleticsBaseUrl: "https://elonphoenix.com",
    lastVerified: "2025-03-20",
  },
  "hampton": {
    directoryUrl: "https://hamptonpirates.com/staff-directory",
    athleticsBaseUrl: "https://hamptonpirates.com",
    lastVerified: "2025-03-20",
  },
  "hofstra": {
    directoryUrl: "https://gohofstra.com/staff-directory",
    athleticsBaseUrl: "https://gohofstra.com",
    lastVerified: "2025-03-20",
  },
  "monmouth": {
    directoryUrl: "https://monmouthhawks.com/staff-directory",
    athleticsBaseUrl: "https://monmouthhawks.com",
    lastVerified: "2025-03-20",
  },
  "north-carolina-at": {
    directoryUrl: "https://ncataggies.com/staff-directory",
    athleticsBaseUrl: "https://ncataggies.com",
    lastVerified: "2025-03-20",
  },
  "northeastern": {
    directoryUrl: "https://gonu.com/staff-directory",
    athleticsBaseUrl: "https://gonu.com",
    lastVerified: "2025-03-20",
  },
  "stony-brook": {
    directoryUrl: "https://stonybrookathletics.com/staff-directory",
    athleticsBaseUrl: "https://stonybrookathletics.com",
    lastVerified: "2025-03-20",
  },
  "towson": {
    directoryUrl: "https://towsontigers.com/staff-directory",
    athleticsBaseUrl: "https://towsontigers.com",
    lastVerified: "2025-03-20",
  },
  "unc-wilmington": {
    directoryUrl: "https://uncwsports.com/staff-directory",
    athleticsBaseUrl: "https://uncwsports.com",
    lastVerified: "2025-03-20",
  },
  "william-mary": {
    directoryUrl: "https://tribeathletics.com/staff-directory",
    athleticsBaseUrl: "https://tribeathletics.com",
    lastVerified: "2025-03-20",
  },
  "ul-monroe": {
    directoryUrl: "https://ulmwarhawks.com/staff-directory",
    athleticsBaseUrl: "https://ulmwarhawks.com",
    lastVerified: "2025-03-20",
  },
  "south-alabama": {
    directoryUrl: "https://usajaguars.com/staff-directory",
    athleticsBaseUrl: "https://usajaguars.com",
    lastVerified: "2025-03-20",
  },
  "fiu": {
    directoryUrl: "https://fiusports.com/staff-directory",
    athleticsBaseUrl: "https://fiusports.com",
    lastVerified: "2025-03-20",
  },
  "jacksonville-state": {
    directoryUrl: "https://jsugamecocksports.com/staff-directory",
    athleticsBaseUrl: "https://jsugamecocksports.com",
    lastVerified: "2025-03-20",
  },
  "kennesaw-state": {
    directoryUrl: "https://ksuowls.com/staff-directory",
    athleticsBaseUrl: "https://ksuowls.com",
    lastVerified: "2025-03-20",
  },
  "louisiana-tech": {
    directoryUrl: "https://latechsports.com/staff-directory",
    athleticsBaseUrl: "https://latechsports.com",
    lastVerified: "2025-03-20",
  },
  "middle-tennessee": {
    directoryUrl: "https://goblueraiders.com/staff-directory",
    athleticsBaseUrl: "https://goblueraiders.com",
    lastVerified: "2025-03-20",
  },
  "new-mexico-state": {
    directoryUrl: "https://nmstatesports.com/staff-directory",
    athleticsBaseUrl: "https://nmstatesports.com",
    lastVerified: "2025-03-20",
  },
  "utep": {
    directoryUrl: "https://utepathletics.com/staff-directory",
    athleticsBaseUrl: "https://utepathletics.com",
    lastVerified: "2025-03-20",
  },
  "western-kentucky": {
    directoryUrl: "https://wkusports.com/staff-directory",
    athleticsBaseUrl: "https://wkusports.com",
    lastVerified: "2025-03-20",
  },
  "davidson": {
    directoryUrl: "https://davidsonwildcats.com/staff-directory",
    athleticsBaseUrl: "https://davidsonwildcats.com",
    lastVerified: "2025-03-20",
  },
  "duquesne": {
    directoryUrl: "https://goduquesne.com/staff-directory",
    athleticsBaseUrl: "https://goduquesne.com",
    lastVerified: "2025-03-20",
  },
  "fordham": {
    directoryUrl: "https://fordhamsports.com/staff-directory",
    athleticsBaseUrl: "https://fordhamsports.com",
    lastVerified: "2025-03-20",
  },
  "george-mason": {
    directoryUrl: "https://gomason.com/staff-directory",
    athleticsBaseUrl: "https://gomason.com",
    lastVerified: "2025-03-20",
  },
  "george-washington": {
    directoryUrl: "https://gwsports.com/staff-directory",
    athleticsBaseUrl: "https://gwsports.com",
    lastVerified: "2025-03-20",
  },
  "la-salle": {
    directoryUrl: "https://goexplorers.com/staff-directory",
    athleticsBaseUrl: "https://goexplorers.com",
    lastVerified: "2025-03-20",
  },
  "loyola-chicago": {
    directoryUrl: "https://loyolaramblers.com/staff-directory",
    athleticsBaseUrl: "https://loyolaramblers.com",
    lastVerified: "2025-03-20",
  },
  "umass": {
    directoryUrl: "https://umassathletics.com/staff-directory",
    athleticsBaseUrl: "https://umassathletics.com",
    lastVerified: "2025-03-20",
  },
  "rhode-island": {
    directoryUrl: "https://gorhody.com/staff-directory",
    athleticsBaseUrl: "https://gorhody.com",
    lastVerified: "2025-03-20",
  },
  "richmond": {
    directoryUrl: "https://richmondspiders.com/staff-directory",
    athleticsBaseUrl: "https://richmondspiders.com",
    lastVerified: "2025-03-20",
  },
  "saint-louis": {
    directoryUrl: "https://slubillikens.com/staff-directory",
    athleticsBaseUrl: "https://slubillikens.com",
    lastVerified: "2025-03-20",
  },
  "st-bonaventure": {
    directoryUrl: "https://gobonnies.com/staff-directory",
    athleticsBaseUrl: "https://gobonnies.com",
    lastVerified: "2025-03-20",
  },
  "saint-josephs": {
    directoryUrl: "https://sjuhawks.com/staff-directory",
    athleticsBaseUrl: "https://sjuhawks.com",
    lastVerified: "2025-03-20",
  },
  "vcu": {
    directoryUrl: "https://vcuathletics.com/staff-directory",
    athleticsBaseUrl: "https://vcuathletics.com",
    lastVerified: "2025-03-20",
  },
  "loyola-marymount": {
    directoryUrl: "https://lmulions.com/staff-directory",
    athleticsBaseUrl: "https://lmulions.com",
    lastVerified: "2025-03-20",
  },
  "pepperdine": {
    directoryUrl: "https://pepperdinewaves.com/staff-directory",
    athleticsBaseUrl: "https://pepperdinewaves.com",
    lastVerified: "2025-03-20",
  },
  "portland": {
    directoryUrl: "https://portlandpilots.com/staff-directory",
    athleticsBaseUrl: "https://portlandpilots.com",
    lastVerified: "2025-03-20",
  },
  "saint-marys": {
    directoryUrl: "https://smcgaels.com/staff-directory",
    athleticsBaseUrl: "https://smcgaels.com",
    lastVerified: "2025-03-20",
  },
  "san-diego": {
    directoryUrl: "https://usdtoreros.com/staff-directory",
    athleticsBaseUrl: "https://usdtoreros.com",
    lastVerified: "2025-03-20",
  },
  "san-francisco": {
    directoryUrl: "https://usfdons.com/staff-directory",
    athleticsBaseUrl: "https://usfdons.com",
    lastVerified: "2025-03-20",
  },
  "santa-clara": {
    directoryUrl: "https://santaclarabroncos.com/staff-directory",
    athleticsBaseUrl: "https://santaclarabroncos.com",
    lastVerified: "2025-03-20",
  },
  "pacific": {
    directoryUrl: "https://pacifictigers.com/staff-directory",
    athleticsBaseUrl: "https://pacifictigers.com",
    lastVerified: "2025-03-20",
  },
  "coppin-state": {
    directoryUrl: "https://coppinstatesports.com/staff-directory",
    athleticsBaseUrl: "https://coppinstatesports.com",
    lastVerified: "2025-03-20",
  },
  "delaware-state": {
    directoryUrl: "https://dsuhornets.com/staff-directory",
    athleticsBaseUrl: "https://dsuhornets.com",
    lastVerified: "2025-03-20",
  },
  "howard": {
    directoryUrl: "https://hubison.com/staff-directory",
    athleticsBaseUrl: "https://hubison.com",
    lastVerified: "2025-03-20",
  },
  "morgan-state": {
    directoryUrl: "https://morganstatebears.com/staff-directory",
    athleticsBaseUrl: "https://morganstatebears.com",
    lastVerified: "2025-03-20",
  },
  "norfolk-state": {
    directoryUrl: "https://nsuspartans.com/staff-directory",
    athleticsBaseUrl: "https://nsuspartans.com",
    lastVerified: "2025-03-20",
  },
  "nc-central": {
    directoryUrl: "https://nccueaglepride.com/staff-directory",
    athleticsBaseUrl: "https://nccueaglepride.com",
    lastVerified: "2025-03-20",
  },
  "sc-state": {
    directoryUrl: "https://www.scsuathletics.com/staff-directory",
    athleticsBaseUrl: "https://www.scsuathletics.com",
    lastVerified: "2025-03-20",
  },
  "maryland-eastern-shore": {
    directoryUrl: "https://umeshawksports.com/staff-directory",
    athleticsBaseUrl: "https://umeshawksports.com",
    lastVerified: "2025-03-20",
  },
  "alabama-am": {
    directoryUrl: "https://aamusports.com/staff-directory",
    athleticsBaseUrl: "https://aamusports.com",
    lastVerified: "2025-03-20",
  },
  "alabama-state": {
    directoryUrl: "https://bamastatesports.com/staff-directory",
    athleticsBaseUrl: "https://bamastatesports.com",
    lastVerified: "2025-03-20",
  },
  "alcorn-state": {
    directoryUrl: "https://alcornsports.com/staff-directory",
    athleticsBaseUrl: "https://alcornsports.com",
    lastVerified: "2025-03-20",
  },
  "bethune-cookman": {
    directoryUrl: "https://bcuathletics.com/staff-directory",
    athleticsBaseUrl: "https://bcuathletics.com",
    lastVerified: "2025-03-20",
  },
  "florida-am": {
    directoryUrl: "https://famuathletics.com/staff-directory",
    athleticsBaseUrl: "https://famuathletics.com",
    lastVerified: "2025-03-20",
  },
  "grambling-state": {
    directoryUrl: "https://glostate.com/staff-directory",
    athleticsBaseUrl: "https://glostate.com",
    lastVerified: "2025-03-20",
  },
  "jackson-state": {
    directoryUrl: "https://gojsutigers.com/staff-directory",
    athleticsBaseUrl: "https://gojsutigers.com",
    lastVerified: "2025-03-20",
  },
  "mississippi-valley-state": {
    directoryUrl: "https://mvsusports.com/staff-directory",
    athleticsBaseUrl: "https://mvsusports.com",
    lastVerified: "2025-03-20",
  },
  "prairie-view-am": {
    directoryUrl: "https://pvpanthers.com/staff-directory",
    athleticsBaseUrl: "https://pvpanthers.com",
    lastVerified: "2025-03-20",
  },
  "southern": {
    directoryUrl: "https://gojagsports.com/staff-directory",
    athleticsBaseUrl: "https://gojagsports.com",
    lastVerified: "2025-03-20",
  },
  "texas-southern": {
    directoryUrl: "https://tsusports.com/staff-directory",
    athleticsBaseUrl: "https://tsusports.com",
    lastVerified: "2025-03-20",
  },
  "arkansas-pine-bluff": {
    directoryUrl: "https://uapblionsroar.com/staff-directory",
    athleticsBaseUrl: "https://uapblionsroar.com",
    lastVerified: "2025-03-20",
  },
  "cleveland-state": {
    directoryUrl: "https://csuvikings.com/staff-directory",
    athleticsBaseUrl: "https://csuvikings.com",
    lastVerified: "2025-03-20",
  },
  "detroit-mercy": {
    directoryUrl: "https://detroittitans.com/staff-directory",
    athleticsBaseUrl: "https://detroittitans.com",
    lastVerified: "2025-03-20",
  },
  "green-bay": {
    directoryUrl: "https://greenbayphoenix.com/staff-directory",
    athleticsBaseUrl: "https://greenbayphoenix.com",
    lastVerified: "2025-03-20",
  },
  "iupui": {
    directoryUrl: "https://iupuijags.com/staff-directory",
    athleticsBaseUrl: "https://iupuijags.com",
    lastVerified: "2025-03-20",
  },
  "milwaukee": {
    directoryUrl: "https://mkepanthers.com/staff-directory",
    athleticsBaseUrl: "https://mkepanthers.com",
    lastVerified: "2025-03-20",
  },
  "northern-kentucky": {
    directoryUrl: "https://nkunorse.com/staff-directory",
    athleticsBaseUrl: "https://nkunorse.com",
    lastVerified: "2025-03-20",
  },
  "oakland": {
    directoryUrl: "https://goldengrizzlies.com/staff-directory",
    athleticsBaseUrl: "https://goldengrizzlies.com",
    lastVerified: "2025-03-20",
  },
  "purdue-fort-wayne": {
    directoryUrl: "https://gomastodons.com/staff-directory",
    athleticsBaseUrl: "https://gomastodons.com",
    lastVerified: "2025-03-20",
  },
  "robert-morris": {
    directoryUrl: "https://rmucolonials.com/staff-directory",
    athleticsBaseUrl: "https://rmucolonials.com",
    lastVerified: "2025-03-20",
  },
  "wright-state": {
    directoryUrl: "https://wsuraiders.com/staff-directory",
    athleticsBaseUrl: "https://wsuraiders.com",
    lastVerified: "2025-03-20",
  },
  "youngstown-state": {
    directoryUrl: "https://ysusports.com/staff-directory",
    athleticsBaseUrl: "https://ysusports.com",
    lastVerified: "2025-03-20",
  },
  "belmont": {
    directoryUrl: "https://belmontbruins.com/staff-directory",
    athleticsBaseUrl: "https://belmontbruins.com",
    lastVerified: "2025-03-20",
  },
  "bradley": {
    directoryUrl: "https://bradleybraves.com/staff-directory",
    athleticsBaseUrl: "https://bradleybraves.com",
    lastVerified: "2025-03-20",
  },
  "drake": {
    directoryUrl: "https://godrakebulldogs.com/staff-directory",
    athleticsBaseUrl: "https://godrakebulldogs.com",
    lastVerified: "2025-03-20",
  },
  "evansville": {
    directoryUrl: "https://gopurpleaces.com/staff-directory",
    athleticsBaseUrl: "https://gopurpleaces.com",
    lastVerified: "2025-03-20",
  },
  "illinois-state": {
    directoryUrl: "https://goredbirds.com/staff-directory",
    athleticsBaseUrl: "https://goredbirds.com",
    lastVerified: "2025-03-20",
  },
  "indiana-state": {
    directoryUrl: "https://gosycamores.com/staff-directory",
    athleticsBaseUrl: "https://gosycamores.com",
    lastVerified: "2025-03-20",
  },
  "missouri-state": {
    directoryUrl: "https://missouristatebears.com/staff-directory",
    athleticsBaseUrl: "https://missouristatebears.com",
    lastVerified: "2025-03-20",
  },
  "murray-state": {
    directoryUrl: "https://goracers.com/staff-directory",
    athleticsBaseUrl: "https://goracers.com",
    lastVerified: "2025-03-20",
  },
  "northern-iowa": {
    directoryUrl: "https://unipanthers.com/staff-directory",
    athleticsBaseUrl: "https://unipanthers.com",
    lastVerified: "2025-03-20",
  },
  "southern-illinois": {
    directoryUrl: "https://siusalukis.com/staff-directory",
    athleticsBaseUrl: "https://siusalukis.com",
    lastVerified: "2025-03-20",
  },
  "uic": {
    directoryUrl: "https://uicflames.com/staff-directory",
    athleticsBaseUrl: "https://uicflames.com",
    lastVerified: "2025-03-20",
  },
  "valparaiso": {
    directoryUrl: "https://valpoathletics.com/staff-directory",
    athleticsBaseUrl: "https://valpoathletics.com",
    lastVerified: "2025-03-20",
  },
  "denver": {
    directoryUrl: "https://denverpioneers.com/staff-directory",
    athleticsBaseUrl: "https://denverpioneers.com",
    lastVerified: "2025-03-20",
  },
  "kansas-city": {
    directoryUrl: "https://kcroos.com/staff-directory",
    athleticsBaseUrl: "https://kcroos.com",
    lastVerified: "2025-03-20",
  },
  "north-dakota": {
    directoryUrl: "https://fightinghawks.com/staff-directory",
    athleticsBaseUrl: "https://fightinghawks.com",
    lastVerified: "2025-03-20",
  },
  "omaha": {
    directoryUrl: "https://omavs.com/staff-directory",
    athleticsBaseUrl: "https://omavs.com",
    lastVerified: "2025-03-20",
  },
  "oral-roberts": {
    directoryUrl: "https://oruathletics.com/staff-directory",
    athleticsBaseUrl: "https://oruathletics.com",
    lastVerified: "2025-03-20",
  },
  "south-dakota": {
    directoryUrl: "https://goyotes.com/staff-directory",
    athleticsBaseUrl: "https://goyotes.com",
    lastVerified: "2025-03-20",
  },
  "st-thomas": {
    directoryUrl: "https://tommiesports.com/staff-directory",
    athleticsBaseUrl: "https://tommiesports.com",
    lastVerified: "2025-03-20",
  },
  "western-illinois": {
    directoryUrl: "https://goleathernecks.com/staff-directory",
    athleticsBaseUrl: "https://goleathernecks.com",
    lastVerified: "2025-03-20",
  },
  "eastern-washington": {
    directoryUrl: "https://goeags.com/staff-directory",
    athleticsBaseUrl: "https://goeags.com",
    lastVerified: "2025-03-20",
  },
  "idaho": {
    directoryUrl: "https://govandals.com/staff-directory",
    athleticsBaseUrl: "https://govandals.com",
    lastVerified: "2025-03-20",
  },
  "idaho-state": {
    directoryUrl: "https://isubengals.com/staff-directory",
    athleticsBaseUrl: "https://isubengals.com",
    lastVerified: "2025-03-20",
  },
  "montana": {
    directoryUrl: "https://gogriz.com/staff-directory",
    athleticsBaseUrl: "https://gogriz.com",
    lastVerified: "2025-03-20",
  },
  "montana-state": {
    directoryUrl: "https://msubobcats.com/staff-directory",
    athleticsBaseUrl: "https://msubobcats.com",
    lastVerified: "2025-03-20",
  },
  "northern-arizona": {
    directoryUrl: "https://nauathletics.com/staff-directory",
    athleticsBaseUrl: "https://nauathletics.com",
    lastVerified: "2025-03-20",
  },
  "northern-colorado": {
    directoryUrl: "https://uncbears.com/staff-directory",
    athleticsBaseUrl: "https://uncbears.com",
    lastVerified: "2025-03-20",
  },
  "portland-state": {
    directoryUrl: "https://goviks.com/staff-directory",
    athleticsBaseUrl: "https://goviks.com",
    lastVerified: "2025-03-20",
  },
  "sacramento-state": {
    directoryUrl: "https://hornetsports.com/staff-directory",
    athleticsBaseUrl: "https://hornetsports.com",
    lastVerified: "2025-03-20",
  },
  "uc-davis": {
    directoryUrl: "https://ucdavisaggies.com/staff-directory",
    athleticsBaseUrl: "https://ucdavisaggies.com",
    lastVerified: "2025-03-20",
  },
  "weber-state": {
    directoryUrl: "https://weberstatesports.com/staff-directory",
    athleticsBaseUrl: "https://weberstatesports.com",
    lastVerified: "2025-03-20",
  },
  "cal-poly": {
    directoryUrl: "https://gopoly.com/staff-directory",
    athleticsBaseUrl: "https://gopoly.com",
    lastVerified: "2025-03-20",
  },
  "southern-utah": {
    directoryUrl: "https://suutbirds.com/staff-directory",
    athleticsBaseUrl: "https://suutbirds.com",
    lastVerified: "2025-03-20",
  },
  "miami-oh": {
    directoryUrl: "https://miamiredhawks.com/staff-directory",
    athleticsBaseUrl: "https://miamiredhawks.com",
    lastVerified: "2025-03-20",
  },
  "dayton": {
    directoryUrl: "https://daytonflyers.com/staff-directory",
    athleticsBaseUrl: "https://daytonflyers.com",
    lastVerified: "2025-03-20",
  },
};

export const ATHLETICS_DOMAIN_OVERRIDES: Record<string, string> = {
  "brigham young": "byucougars.com",
  "byu": "byucougars.com",
  "arizona": "arizonawildcats.com",
  "notre dame": "und.com",
  "usc": "usctrojans.com",
  "southern california": "usctrojans.com",
  "texas": "texassports.com",
  "oklahoma": "soonersports.com",
  "michigan": "mgoblue.com",
  "ohio state": "ohiostatebuckeyes.com",
  "penn state": "gopsusports.com",
  "georgia": "georgiadogs.com",
  "alabama": "rolltide.com",
  "lsu": "lsusports.net",
  "florida": "floridagators.com",
  "clemson": "clemsontigers.com",
  "auburn": "auburntigers.com",
  "tennessee": "utsports.com",
  "kentucky": "ukathletics.com",
  "arkansas": "arkansasrazorbacks.com",
  "missouri": "mutigers.com",
  "south carolina": "gamecocksonline.com",
  "mississippi state": "hailstate.com",
  "ole miss": "olemisssports.com",
  "mississippi": "olemisssports.com",
  "vanderbilt": "vucommodores.com",
  "texas a&m": "12thman.com",
  "iowa": "hawkeyesports.com",
  "wisconsin": "uwbadgers.com",
  "minnesota": "gophersports.com",
  "illinois": "fightingillini.com",
  "northwestern": "nusports.com",
  "purdue": "purduesports.com",
  "indiana": "iuhoosiers.com",
  "maryland": "umterps.com",
  "rutgers": "scarletknights.com",
  "nebraska": "huskers.com",
  "colorado": "cubuffs.com",
  "utah": "utahutes.com",
  "oregon": "goducks.com",
  "oregon state": "osubeavers.com",
  "washington": "gohuskies.com",
  "washington state": "wsucougars.com",
  "stanford": "gostanford.com",
  "california": "calbears.com",
  "cal": "calbears.com",
  "ucla": "uclabruins.com",
  "arizona state": "thesundevils.com",
  "boston college": "bceagles.com",
  "duke": "goduke.com",
  "florida state": "seminoles.com",
  "georgia tech": "ramblinwreck.com",
  "louisville": "gocards.com",
  "miami": "hurricanesports.com",
  "nc state": "gopack.com",
  "north carolina": "goheels.com",
  "notre dame fighting irish": "fightingirish.com",
  "pitt": "pittsburghpanthers.com",
  "pittsburgh": "pittsburghpanthers.com",
  "syracuse": "cuse.com",
  "virginia": "virginiasports.com",
  "virginia tech": "hokiesports.com",
  "wake forest": "wakeforestsports.com",
  "baylor": "baylorbears.com",
  "cincinnati": "gobearcats.com",
  "houston": "uhcougars.com",
  "iowa state": "cyclones.com",
  "kansas": "kuathletics.com",
  "kansas state": "kstatesports.com",
  "oklahoma state": "okstate.com",
  "tcu": "gofrogs.com",
  "texas tech": "texastech.com",
  "ucf": "ucfknights.com",
  "west virginia": "wvusports.com",
  "air force": "goairforcefalcons.com",
  "boise state": "broncosports.com",
  "colorado state": "csurams.com",
  "fresno state": "gobulldogs.com",
  "hawaii": "hawaiiathletics.com",
  "nevada": "nevadawolfpack.com",
  "new mexico": "golobos.com",
  "san diego state": "goaztecs.com",
  "san jose state": "sjsuspartans.com",
  "unlv": "unlvrebels.com",
  "utah state": "utahstateaggies.com",
  "wyoming": "gowyo.com",
  "appalachian state": "appstatesports.com",
  "coastal carolina": "goccusports.com",
  "georgia southern": "gseagles.com",
  "james madison": "jmusports.com",
  "louisiana": "ragincajuns.com",
  "marshall": "herdzone.com",
  "old dominion": "odusports.com",
  "southern miss": "southernmiss.com",
  "troy": "troytrojans.com",
  "memphis": "gotigersgo.com",
  "navy": "navysports.com",
  "north texas": "meangreensports.com",
  "rice": "riceowls.com",
  "south florida": "gousfbulls.com",
  "temple": "owlsports.com",
  "tulane": "tulanegreenwave.com",
  "east carolina": "ecupirates.com",
  "charlotte": "charlotte49ers.com",
  "michigan state": "msuspartans.com",
  "liberty": "libertyflames.com",
  "gonzaga": "gozags.com",
  "sam houston": "gobearkats.com",
  "north dakota state": "gobison.com",
  "south dakota state": "gojacks.com",
  "dayton": "daytonflyers.com",
  "saint louis": "slubillikens.com",
  "vcu": "vcuathletics.com",
  "richmond": "richmondspiders.com",
};

export const EXTENDED_STAFF_PATTERNS = [
  '/staff-directory',
  '/staff',
  '/athletics-staff',
  '/athletic-staff',
  '/directory',
  '/about/staff',
  '/about/directory',
  '/sports/staff',
  '/administration',
  '/front-office',
  '/inside/staff',
  '/about/staff-directory',
  '/about/athletics-staff',
  '/about/administration',
  '/about/front-office',
  '/info/staff',
  '/information/staff',
  '/department/staff',
  '/athletics/staff',
  '/athletic-department/staff',
  '/athletic-department',
  '/sports/administration',
  '/sports/athletic-staff',
  '/general/staff',
  '/general/directory',
  '/sports/staff-directory',
  '/sports/athletic-department',
  '/staff.aspx',
  '/staff-directory.aspx',
  '/athletics-staff.aspx',
  '/directory.aspx',
];

export const STAFF_LINK_KEYWORDS = [
  'staff directory',
  'staff-directory',
  'athletics staff',
  'athletic staff',
  'department staff',
  'our staff',
  'meet the staff',
  'administration',
  'athletic department',
  'front office',
  'coaches & staff',
  'coaches and staff',
  'staff & coaches',
  'staff and coaches',
  'directory',
];

export function getKnownDirectoryUrl(schoolId: string): DirectoryOverride | null {
  const normalized = schoolId.toLowerCase().trim();
  return KNOWN_DIRECTORY_URLS[normalized] || null;
}

export function getAthleticsDomainOverride(schoolName: string): string | null {
  const normalized = schoolName.toLowerCase().trim();

  if (ATHLETICS_DOMAIN_OVERRIDES[normalized]) {
    return ATHLETICS_DOMAIN_OVERRIDES[normalized];
  }

  return null;
}

export function addKnownDirectoryUrl(
  schoolId: string,
  directoryUrl: string,
  athleticsBaseUrl?: string,
  notes?: string
): void {
  KNOWN_DIRECTORY_URLS[schoolId.toLowerCase().trim()] = {
    directoryUrl,
    athleticsBaseUrl,
    notes,
    lastVerified: new Date().toISOString().split('T')[0],
  };
}

export function hasKnownDirectoryUrl(schoolId: string): boolean {
  return !!KNOWN_DIRECTORY_URLS[schoolId.toLowerCase().trim()];
}

export function resolveDirectoryUrl(schoolId: string, schoolName: string): string | null {
  const knownOverride = getKnownDirectoryUrl(schoolId);
  if (knownOverride) return knownOverride.directoryUrl;

  const conferenceUrl = findConferenceUrlBySchoolId(schoolId);
  if (conferenceUrl) return conferenceUrl;

  const conferenceUrlByName = findConferenceUrlBySchoolName(schoolName);
  if (conferenceUrlByName) return conferenceUrlByName;

  const domainOverride = getAthleticsDomainOverride(schoolName);
  if (domainOverride) return `https://${domainOverride}/staff-directory`;

  return null;
}
