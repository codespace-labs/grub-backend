const MUSIC_SIGNALS: ReadonlyArray<string> = [
  "concierto", "concert",
  "festival",
  "tour", "world tour",
  " live", "live show", "en vivo",
  "dj set", "dj session",
  "banda", "band",
  "techno", "house",
  "reggaeton", "reggae",
  "salsa",
  "hip-hop", "hip hop", "rap",
  "indie", "rock", "metal",
  "edm", "rave", "electronica",
  "jazz",
];

const NON_MUSIC_KEYWORDS: ReadonlyArray<string> = [
  "estacionamiento",
  "parking",
  "puntos de venta",
  "centro de ayuda",
  "teatro",
  "teatral",
  "el musical",
  "arlequin",
  "obra de",
  " obra ",
  "dramaturgia",
  "dramaturgia ",
  "puesta en escena",
  "comedia",
  "humor",
  "humoristico",
  "humorística",
  "humoristica",
  "impro",
  "improv",
  "improvisacion",
  "improvisación",
  "imitaciones",
  "parodia",
  "sketch",
  "stand up",
  "standup",
  "stand-up",
  "comico",
  "cómico",
  "monologo",
  "monólogo",
  "clown",
  "payaso",
  "payasos",
  "ballet",
  "danza",
  "coreografia",
  "coreografía",
  "flamenco",
  "cisnes",
  "lago de los",
  "temporada de abono",
  "ciclo cuerdas",
  "sinfonia alla",
  "sinfonía alla",
  "temporada sinfonica",
  "temporada sinf",
  "clasicos de",
  "clásicos de",
  "fiesta en la granja",
  "show infantil",
  "espectaculo infantil",
  "espectáculo infantil",
  "infantil",
  "familiar",
  "family show",
  "para toda la familia",
  "titeres",
  "títeres",
  "marionetas",
  "cuentacuentos",
  "cuento infantil",
  "para niños",
  "para ninos",
  "niños",
  "ninos",
  "kids",
  "magia",
  "ilusionismo",
  "acrobacia",
  "acrobatico",
  "acrobático",
  "circo",
];

const HARD_EXCLUSION_PATTERNS: ReadonlyArray<RegExp> = [
  /\btributo\b/i,
  /\btribute\b/i,
  /\bhomenaje\b/i,
  /\brevive\b/i,
  /\bx siempre\b/i,
  /\bcerati x siempre\b/i,
  /\bpara ni(?:n|ñ)os\b/i,
  /\bni(?:n|ñ)os?\b/i,
  /\binfantil(?:es)?\b/i,
  /\bkids?\b/i,
  /\bcumbia\b/i,
  /\bchicha\b/i,
  /\bhuayno?s?\b/i,
  /\bfolklor(?:e|ica|ico)\b/i,
  /\bfolkl[oó]ric[ao]s?\b/i,
  /\bandino?s?\b/i,
  /\bcriollo?s?\b/i,
  /\bteatro\b/i,
  /\bteatral\b/i,
  /\barlequin\b/i,
  /\bobra(?:\s+de)?\b/i,
  /\bmusical\b/i,
  /\bdramaturgia\b/i,
  /\bpuesta en escena\b/i,
  /\bcomedia\b/i,
  /\bhumor\b/i,
  /\bhumorist(?:a|ico|ica|icos|icas)\b/i,
  /\bimpro\b/i,
  /\bimprov\b/i,
  /\bimprovisaci[oó]n\b/i,
  /\bstand\s?-?up\b/i,
  /\bcomico\b/i,
  /\bc[oó]mico\b/i,
  /\bmon[oó]log(?:o|os)\b/i,
  /\bparodia\b/i,
  /\bsketch\b/i,
  /\bclown\b/i,
  /\bpayasos?\b/i,
  /\bballet\b/i,
  /\bdanza\b/i,
  /\bcoreograf(?:ia|ías|ias)\b/i,
  /\bflamenco\b/i,
  /\bcisnes\b/i,
  /\blago de los\b/i,
  /\bfiesta en la granja\b/i,
  /\bfamiliar\b/i,
  /\bfamily show\b/i,
  /\bpara toda la familia\b/i,
  /\bt[ií]teres\b/i,
  /\bmarionetas\b/i,
  /\bcuentacuentos\b/i,
  /\bcuento infantil\b/i,
  /\bmagia\b/i,
  /\bilusionismo\b/i,
  /\bacrobacia\b/i,
  /\bacrob[aá]tic[ao]s?\b/i,
  /\bcirco\b/i,
  /\brie por humor\b/i,
  /\br[ií]e por humor\b/i,
];

const HARD_EXCLUDED_GENRES = new Set([
  "cumbia",
  "cumbia-andina",
  "folklore",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface EditorialExclusionInput {
  name: string;
  venue?: string | null;
  genreSlugs?: string[];
  coverUrl?: string | null;
}

export function getEditorialExclusionReason(input: EditorialExclusionInput): string | null {
  const nameNorm = normalizeText(input.name ?? "");

  if (/\b(tributo|tribute|homenaje|revive|x siempre|cerati x siempre)\b/i.test(nameNorm)) {
    return "editorial-blocked";
  }

  if (/\b(para ninos|para niños|infantil|infantiles|ninos|niños|kids|familiar|family show|para toda la familia|titeres|títeres|marionetas|cuentacuentos|cuento infantil)\b/i.test(nameNorm)) {
    return "editorial-childrens";
  }

  if (/\b(cumbia|chicha|huayno|huaynos|folklore|folklorica|folklorico|andino|andinos|criollo|criollos)\b/i.test(nameNorm)) {
    return "editorial-excluded-genre";
  }

  if (/\b(teatro|teatral|arlequin|obra(?:\s+de)?|musical|dramaturgia|puesta en escena)\b/i.test(nameNorm)) {
    return "editorial-theater";
  }

  if (/\b(comedia|humor|humorist(?:a|ico|ica|icos|icas)|impro|improv|improvisaci[oó]n|stand\s?-?up|comico|c[oó]mico|mon[oó]log(?:o|os)|parodia|sketch|clown|payasos?|r[ií]e por humor)\b/i.test(nameNorm)) {
    return "editorial-comedy";
  }

  if (/\b(ballet|danza|coreograf(?:ia|ías|ias)|flamenco|cisnes|lago de los)\b/i.test(nameNorm)) {
    return "editorial-dance";
  }

  if (/\b(fiesta en la granja|magia|ilusionismo|acrobacia|acrob[aá]tic[ao]s?|circo)\b/i.test(nameNorm)) {
    return "editorial-family";
  }

  if (HARD_EXCLUSION_PATTERNS.some((pattern) => pattern.test(nameNorm))) {
    return "editorial-blocked";
  }

  if ((input.genreSlugs ?? []).some((slug) => HARD_EXCLUDED_GENRES.has(slug))) {
    return "excluded-genre";
  }

  return null;
}

export function isMusicalEvent(name: string, venue = ""): boolean {
  if (getEditorialExclusionReason({ name, venue })) return false;

  const haystack = normalizeText(`${name} ${venue}`);

  if (MUSIC_SIGNALS.some((kw) => haystack.includes(kw))) return true;

  const nameNorm = normalizeText(name);

  if (NON_MUSIC_KEYWORDS.some((kw) => nameNorm.includes(kw))) return false;

  return true;
}
