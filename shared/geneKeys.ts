/**
 * GENE KEYS AND HUMAN DESIGN, FROM A CHART THAT IS ALREADY COMPUTED.
 *
 * This file never sees a birth date. The sky is read in the member's browser
 * (shared/geneKeysSky.ts) and only the 26 activations it produces travel to the
 * server, which is what lets a member's birth details stay on their own screen.
 * Everything here is pure: the server uses it to check what a browser sent and
 * to derive type and authority itself, so a client cannot claim a type its own
 * activations do not support.
 *
 * ── THE NUMBERS ARE TESTED AGAINST THE PUBLIC CALCULATORS ───────────────────
 *
 * The wheel starts gate 41 at 302 degrees (2 Aquarius) and the design moment is
 * the Sun 88 degrees of arc before birth. Both were checked on 2026-10-22 against
 * genekeys.com (7 births, including pairs a few minutes either side of a line
 * change) and humandesignchart.org / arcanepattern.com (all 26 activations).
 * The sphere to planet mapping below matched genekeys.com on 187 of 187 spheres.
 * geneKeys.test.ts carries those births as fixtures.
 *
 * ── THE NODE IS THE TRUE NODE ───────────────────────────────────────────────
 *
 * Calculators use the osculating (true) lunar node. The mean node changes type
 * or authority for about 6% of people, so it is not a harmless approximation.
 */

export const GENE_KEYS_CALC_VERSION = 1;

/** The 64 gates in wheel order, starting at WHEEL_START_DEG. */
export const WHEEL: readonly number[] = [
  41, 19, 13, 49, 30, 55, 37, 63, 22, 36, 25, 17, 21, 51, 42, 3, 27, 24, 2, 23, 8, 20, 16, 35, 45, 12, 15, 52, 39, 53, 62, 56,
  31, 33, 7, 4, 29, 59, 40, 64, 47, 6, 46, 18, 48, 57, 32, 50, 28, 44, 1, 43, 14, 34, 9, 5, 26, 11, 10, 58, 38, 54, 61, 60,
];
export const WHEEL_START_DEG = 302;
const GATE_DEG = 360 / 64;
const LINE_DEG = GATE_DEG / 6;

export const BODIES = [
  "Sun", "Earth", "NorthNode", "SouthNode", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
] as const;
export type Body = (typeof BODIES)[number];

export interface Activation {
  gate: number;
  line: number;
}
export type Activations = Record<Body, Activation>;
/** Personality is the birth moment; design is the Sun 88 degrees earlier. */
export interface Chart {
  personality: Activations;
  design: Activations;
}

export function normDeg(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** A tropical ecliptic longitude to its gate and line. */
export function gateLine(longitude: number): Activation {
  const p = normDeg(longitude - WHEEL_START_DEG);
  const g = Math.floor(p / GATE_DEG);
  return { gate: WHEEL[g], line: Math.floor((p - g * GATE_DEG) / LINE_DEG) + 1 };
}

const WHEEL_INDEX: Record<number, number> = Object.fromEntries(WHEEL.map((g, i) => [g, i]));
/** The gate on the other side of the wheel. Sun and Earth, and the two nodes, always sit this way. */
export function oppositeGate(gate: number): number {
  return WHEEL[(WHEEL_INDEX[gate] + 32) % 64];
}

// ── THE SPHERES ────────────────────────────────────────────────────────────

export const SPHERES = [
  "lifesWork", "evolution", "radiance", "purpose",
  "attraction", "iq", "eq", "sq", "core",
  "culture", "pearl",
] as const;
export type Sphere = (typeof SPHERES)[number];
export type Sequence = "activation" | "venus" | "pearl";

export const SPHERE_SOURCE: Record<Sphere, { side: keyof Chart; body: Body; sequence: Sequence }> = {
  lifesWork: { side: "personality", body: "Sun", sequence: "activation" },
  evolution: { side: "personality", body: "Earth", sequence: "activation" },
  radiance: { side: "design", body: "Sun", sequence: "activation" },
  purpose: { side: "design", body: "Earth", sequence: "activation" },
  attraction: { side: "design", body: "Moon", sequence: "venus" },
  iq: { side: "personality", body: "Venus", sequence: "venus" },
  eq: { side: "personality", body: "Mars", sequence: "venus" },
  sq: { side: "design", body: "Venus", sequence: "venus" },
  core: { side: "design", body: "Mars", sequence: "venus" },
  culture: { side: "design", body: "Jupiter", sequence: "pearl" },
  pearl: { side: "personality", body: "Jupiter", sequence: "pearl" },
};

export function sphereOf(chart: Chart, sphere: Sphere): Activation {
  const s = SPHERE_SOURCE[sphere];
  return chart[s.side][s.body];
}

/** The profile, `2/5`: the personality Sun's line over the design Sun's. */
export function profileOf(chart: Chart): string {
  return `${chart.personality.Sun.line}/${chart.design.Sun.line}`;
}

/**
 * The twelve profiles that exist. The design Sun sits 88 degrees back, which is
 * 93.87 lines, so the design line is always two or three past the personality
 * line, wrapping at six. Six of these hold about 14.5% of people each and the
 * other six about 2%.
 */
export const PROFILES: readonly string[] = ["1/3", "1/4", "2/4", "2/5", "3/5", "3/6", "4/6", "4/1", "5/1", "5/2", "6/2", "6/3"];

// ── HUMAN DESIGN ────────────────────────────────────────────────────────────

export const CENTERS = {
  Head: [64, 61, 63],
  Ajna: [47, 24, 4, 17, 43, 11],
  Throat: [62, 23, 56, 35, 12, 45, 33, 8, 31, 20, 16],
  G: [7, 1, 13, 25, 46, 2, 15, 10],
  Heart: [21, 40, 26, 51],
  Spleen: [48, 57, 44, 50, 32, 28, 18],
  SolarPlexus: [36, 22, 37, 6, 49, 55, 30],
  Sacral: [34, 5, 14, 29, 59, 9, 3, 42, 27],
  Root: [53, 60, 52, 19, 39, 41, 58, 38, 54],
} as const;
export type Center = keyof typeof CENTERS;

export const CHANNELS: ReadonlyArray<readonly [number, number]> = [
  [64, 47], [61, 24], [63, 4], [17, 62], [43, 23], [11, 56], [31, 7], [8, 1], [33, 13], [20, 10], [45, 21], [16, 48],
  [20, 57], [12, 22], [35, 36], [20, 34], [25, 51], [2, 14], [15, 5], [46, 29], [10, 34], [10, 57], [26, 44], [37, 40],
  [50, 27], [57, 34], [32, 54], [28, 38], [18, 58], [42, 53], [3, 60], [9, 52], [59, 6], [19, 49], [39, 55], [41, 30],
];

const CENTER_OF: Record<number, Center> = {};
for (const [c, gates] of Object.entries(CENTERS) as Array<[Center, readonly number[]]>) for (const g of gates) CENTER_OF[g] = c;
const MOTORS: readonly Center[] = ["Sacral", "SolarPlexus", "Heart", "Root"];

/** The centre a gate belongs to (the session card reads a room's centres from it). */
export function centerOf(gate: number): Center | undefined {
  return CENTER_OF[gate];
}

export const HD_TYPES = ["Generator", "Manifesting Generator", "Projector", "Manifestor", "Reflector"] as const;
export type HdType = (typeof HD_TYPES)[number];
export const AUTHORITIES = ["Emotional", "Sacral", "Splenic", "Ego Manifested", "Ego Projected", "Self-Projected", "Mental", "Lunar"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export interface Design {
  type: HdType;
  authority: Authority;
  channels: string[];
  centers: Center[];
}

/**
 * Type and authority from the 26 activations.
 *
 * A motor reaches the Throat through ANY chain of defined channels, not only a
 * direct one: Sacral to G (10-34) and G to Throat (13-33) makes a Manifesting
 * Generator. humandesignchart.org gets this case wrong and calls it a
 * Generator; arcanepattern.com and the standard rules agree with this code.
 */
export function analyse(chart: Chart): Design {
  const set = new Set<number>();
  for (const side of ["personality", "design"] as const) for (const b of BODIES) set.add(chart[side][b].gate);
  const channels = CHANNELS.filter(([a, b]) => set.has(a) && set.has(b));
  const defined = new Set<Center>();
  const adj = new Map<Center, Set<Center>>();
  for (const [a, b] of channels) {
    const x = CENTER_OF[a], y = CENTER_OF[b];
    defined.add(x); defined.add(y);
    if (!adj.has(x)) adj.set(x, new Set());
    if (!adj.has(y)) adj.set(y, new Set());
    adj.get(x)!.add(y); adj.get(y)!.add(x);
  }
  const reaches = (from: Center, to: Center): boolean => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift()!;
      if (c === to) return true;
      for (const n of Array.from(adj.get(c) ?? [])) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return false;
  };
  const motorToThroat = defined.has("Throat") && MOTORS.some((m) => defined.has(m) && reaches(m, "Throat"));
  let type: HdType;
  if (defined.size === 0) type = "Reflector";
  else if (defined.has("Sacral")) type = motorToThroat ? "Manifesting Generator" : "Generator";
  else type = motorToThroat ? "Manifestor" : "Projector";
  let authority: Authority;
  if (type === "Reflector") authority = "Lunar";
  else if (defined.has("SolarPlexus")) authority = "Emotional";
  else if (defined.has("Sacral")) authority = "Sacral";
  else if (defined.has("Spleen")) authority = "Splenic";
  else if (defined.has("Heart")) authority = adj.get("Heart")?.has("Throat") ? "Ego Manifested" : "Ego Projected";
  else if (defined.has("G") && adj.get("G")?.has("Throat")) authority = "Self-Projected";
  else authority = "Mental";
  return {
    type,
    authority,
    channels: channels.map(([a, b]) => `${a}-${b}`),
    centers: (Object.keys(CENTERS) as Center[]).filter((c) => defined.has(c)),
  };
}

// ── CHECKING A CHART A BROWSER SENT ─────────────────────────────────────────

function isActivation(v: unknown): v is Activation {
  const a = v as Activation;
  return !!a && Number.isInteger(a.gate) && a.gate >= 1 && a.gate <= 64 && Number.isInteger(a.line) && a.line >= 1 && a.line <= 6;
}

/**
 * Everything wrong with a chart, or an empty list. These are facts of the sky,
 * so a chart that breaks one was typed wrong or tampered with:
 *  - every body has a gate 1 to 64 and a line 1 to 6;
 *  - Earth sits opposite the Sun on the same line, on both sides;
 *  - the South Node sits opposite the North Node on the same line;
 *  - the design Sun is 88 degrees of arc behind the personality Sun, which on
 *    the wheel is 93 or 94 lines back.
 */
export function chartProblems(chart: unknown): string[] {
  const c = chart as Chart;
  const problems: string[] = [];
  if (!c || typeof c !== "object" || !c.personality || !c.design) return ["The chart needs a personality and a design side."];
  for (const side of ["personality", "design"] as const) {
    for (const b of BODIES) if (!isActivation(c[side][b])) problems.push(`${side} ${b} is not a gate and line.`);
  }
  if (problems.length) return problems;
  for (const side of ["personality", "design"] as const) {
    const s = c[side];
    if (s.Earth.gate !== oppositeGate(s.Sun.gate) || s.Earth.line !== s.Sun.line) problems.push(`${side} Earth is not opposite the Sun.`);
    if (s.SouthNode.gate !== oppositeGate(s.NorthNode.gate) || s.SouthNode.line !== s.NorthNode.line) problems.push(`${side} South Node is not opposite the North Node.`);
  }
  const lineIndex = (a: Activation) => WHEEL_INDEX[a.gate] * 6 + (a.line - 1);
  const back = (lineIndex(c.personality.Sun) - lineIndex(c.design.Sun) + 384) % 384;
  if (back !== 93 && back !== 94) problems.push("The design Sun is not 88 degrees behind the personality Sun.");
  return problems;
}

// ── THE WORDS ───────────────────────────────────────────────────────────────

/**
 * The words genekeys.com shows for each line, per sphere. They depend on the
 * sphere and the line, never on the key: Life's Work line 2 reads Dancer for
 * key 12, 38, 54 and 55 alike (17 births read off the profiler, 2026-10-22;
 * the last four, Culture 3 and 5 and Pearl 4 and 5, from 7 more on 2026-10-30,
 * which also matched every one of the 77 key.lines to the profiler's).
 * Richard Rudd has agreed to Amora using Gene Keys naming.
 *
 * The seal and the circle view use the LIFE'S WORK words for both numbers of a
 * profile, so a member and their team share one set of six words; the lines
 * card shows each sphere's own word.
 */
export const LINE_WORDS: Record<Sphere, readonly string[]> = {
  lifesWork: ["Creator", "Dancer", "Changer", "Server", "Fixer", "Teacher"],
  evolution: ["Self & Empowerment", "Passion & Relationship", "Energy & Experience", "Love & Community", "Power & Projection", "Education & Surrender"],
  radiance: ["Solitude", "Marriage", "Interaction", "Friendship", "Impact", "Nurture"],
  purpose: ["Physicality", "Posture", "Movement", "Breath", "Voice", "Intent"],
  attraction: ["Sterility / Fertility", "Lust / Passion", "Promiscuity / Playfulness", "Frigidity / Romance", "Entrapment / Sensuality", "Disappointment / Innocence"],
  iq: ["The Contemplative mind", "The Brilliant mind", "The Flexible mind", "The Influential mind", "The Practical mind", "The Objective mind"],
  eq: ["Self-esteem / Self-sabotage", "Courtesy / Aggression", "Sympathy / Apathy", "Kindness / Meanness", "Respect / Disrespect", "Reverence / Alienation"],
  sq: ["Certainty", "Freedom", "Pleasure", "Belonging", "Mentoring", "Patience"],
  core: ["Repression / Honesty", "Denial / Ease", "Shame / Humour", "Rejection / Gentleness", "Guilt / Forgiveness", "Isolation / Care"],
  culture: ["Individual", "Partnership", "Unit", "Network", "Society", "System"],
  pearl: ["Simplicity", "Recognition", "Celebration", "Charity", "Power", "Nature"],
};

/** The one word for a line wherever a single word is needed: the seal, the circle view. */
export function lineWord(line: number): string {
  return LINE_WORDS.lifesWork[line - 1] ?? "";
}

/**
 * One-line taglines. The four Activation lines are Richard's own, as
 * genekeys.com prints them. The free profile prints none for the Venus and
 * Pearl spheres, so those seven are AMORA'S words, plain and short, and are
 * never presented as Richard's.
 */
export const SPHERE_WORDS: Record<Sphere, { name: string; tagline: string | null }> = {
  lifesWork: { name: "Life's Work", tagline: "what I'm here to do" },
  evolution: { name: "Evolution", tagline: "what I'm here to learn" },
  radiance: { name: "Radiance", tagline: "what keeps me healthy" },
  purpose: { name: "Purpose", tagline: "what deeply fulfils me" },
  attraction: { name: "Attraction", tagline: "who and what I draw to me" },
  iq: { name: "IQ", tagline: "how my mind works best" },
  eq: { name: "EQ", tagline: "how I meet other people's feelings" },
  sq: { name: "SQ", tagline: "how my heart opens" },
  core: { name: "Core", tagline: "where my deepest healing lies" },
  culture: { name: "Culture", tagline: "how I serve the whole" },
  pearl: { name: "Pearl", tagline: "where my prosperity comes from" },
};

export const STRATEGY_WORDS: Record<HdType, { strategy: string; line: string }> = {
  Generator: { strategy: "Respond", line: "Let life bring you things, then follow what lights you up." },
  "Manifesting Generator": { strategy: "Respond, then inform", line: "Follow what lights you up, then tell people what you are starting." },
  Projector: { strategy: "Wait for the invitation", line: "Your gift lands best when someone asks for it." },
  Manifestor: { strategy: "Inform", line: "Start things, and tell people first so they can make room." },
  Reflector: { strategy: "Wait a moon", line: "Give big choices a full moon cycle." },
};

export const AUTHORITY_WORDS: Record<Authority, { name: string; line: string }> = {
  Emotional: { name: "Emotional", line: "Sleep on it. Clarity comes with time." },
  Sacral: { name: "Sacral", line: "Trust your gut yes or no, right now." },
  Splenic: { name: "Splenic", line: "Trust the first quiet hunch." },
  "Ego Manifested": { name: "Ego", line: "Go with what your heart truly wants." },
  "Ego Projected": { name: "Ego", line: "Go with what your heart truly wants." },
  "Self-Projected": { name: "Self", line: "Talk it out and listen to what you say." },
  Mental: { name: "Outer", line: "Talk it over with people you trust, somewhere that feels right." },
  Lunar: { name: "Lunar", line: "Take a full moon cycle before you choose." },
};

/**
 * Richard Rudd's own site, where every Gene Keys surface sends a member to
 * explore more in depth (Rye, 2026-10-22). A platform destination of this
 * module, the same for every village that turns it on, never one village's.
 */
export const GENE_KEYS_SITE = "https://genekeys.com/free-profile/";

/** "a Manifestor", "an Emotional". */
export function withArticle(word: string): string {
  return `${/^[AEIOU]/.test(word) ? "an" : "a"} ${word}`;
}

// ── THE HTTP SHAPES ─────────────────────────────────────────────────────────
//
// What /api/gene-keys/** answers (server/routes/geneKeys.ts), so the browser and
// the server read one definition.

export type GeneKeysVisibility = "show" | "hide";
export type GeneKeysSource = "exact" | "chosen" | "typed";

export interface SphereView {
  sphere: Sphere;
  name: string;
  tagline: string | null;
  /** "12.2" */
  keyLine: string;
  gate: number;
  line: number;
  /** The word genekeys.com shows for this line in this sphere. */
  word: string;
}

export interface GeneKeysView {
  profile: string;
  /** The two profile lines as one word each, "Dancer · Fixer". */
  names: string;
  lines: [number, number];
  /** The Activation Sequence: Life's Work, Evolution, Radiance, Purpose. */
  spheres: SphereView[];
  /** The Venus Sequence: Attraction, IQ, EQ, SQ, Core. */
  love: SphereView[];
  /** The Pearl Sequence: Culture, Pearl. */
  prosperity: SphereView[];
  type: HdType;
  strategy: string;
  strategyLine: string;
  authority: Authority;
  authorityName: string;
  authorityLine: string;
}

/**
 * WHETHER A SESSION CARD ASKS ITS OWN YES (the clause 13 review's F4, Rye's
 * call). True: a card reads a member only after they say yes to cards
 * themselves (`card_in`, 0308), whatever they let Maia do. False: a card reads
 * anyone who shows their lines and lets Maia use them, unless they said no
 * (`card_out`, 0296). The toggle writes both, so either ruling is this line.
 */
export const CARDS_ASK_THEIR_OWN_YES = true;

/** Whether a member's own choices put them on session cards, under the ruling above. */
export function inCardsBy(choice: { cardIn: boolean; cardOut: boolean }): boolean {
  return CARDS_ASK_THEIR_OWN_YES ? choice.cardIn && !choice.cardOut : !choice.cardOut;
}

export interface OwnGeneKeysView extends GeneKeysView {
  visibility: GeneKeysVisibility;
  maia: boolean;
  /** Listed in "Who complements me", for others who listed themselves too. */
  complement: boolean;
  /** "Talk to me plainly": Maia never adapts her wording to the type. */
  maiaPlain: boolean;
  /** "Leave me out of session cards" (shared/sessionCard.ts): welcomed by name, never read. */
  cardOut: boolean;
  /** "Read me on session cards" (0308): their own yes. */
  cardIn: boolean;
  /** Whether their own choice puts them on cards (`inCardsBy`). Lines shown and Maia allowed are asked as well. */
  inCards: boolean;
  source: GeneKeysSource;
  /** Computed by an older calculator than this release runs: ask the member to read the sky again. */
  stale: boolean;
}

/** One person in "Who complements me" (GET /api/gene-keys/complements). */
export interface Complement {
  name: string;
  handle: string | null;
  view: GeneKeysView;
  /** Their lines that the asker does not carry, lowest first. Never empty. */
  fills: number[];
}

/**
 * What "Who complements me" answers. Opt-in on both sides: until the asker
 * shows their own lines and joins, the answer says which of those is missing
 * and lists nobody.
 */
export type ComplementsAnswer =
  | { state: "no-lines" }
  | { state: "hidden" }
  | { state: "not-joined" }
  | { state: "joined"; people: Complement[] };

/**
 * The three sequences, in the order genekeys.com reads them. Launch showed the
 * Activation Sequence only (Rye, 2026-10-22); Love and Prosperity opened after
 * their live test passed, 77 of 77 key.lines against genekeys.com
 * (2026-10-30), as Rye asked ("10. Great!", 2026-10-23).
 */
export const SHOWN_SPHERES: readonly Sphere[] = ["lifesWork", "evolution", "radiance", "purpose"];
export const LOVE_SPHERES: readonly Sphere[] = ["attraction", "iq", "eq", "sq", "core"];
export const PROSPERITY_SPHERES: readonly Sphere[] = ["culture", "pearl"];

/** Attraction follows the design Moon, which changes line every couple of hours: a chosen birth time may misread it. */
export const MOON_SPHERES: ReadonlySet<Sphere> = new Set<Sphere>(["attraction"]);

function wordFor(sphere: Sphere, line: number): string {
  return LINE_WORDS[sphere][line - 1] ?? "";
}

function sphereView(chart: Chart, sphere: Sphere): SphereView {
  const act = sphereOf(chart, sphere);
  return {
    sphere,
    name: SPHERE_WORDS[sphere].name,
    tagline: SPHERE_WORDS[sphere].tagline,
    keyLine: `${act.gate}.${act.line}`,
    gate: act.gate,
    line: act.line,
    word: wordFor(sphere, act.line),
  };
}

/** What a reader sees of a chart. The server builds it to answer; the browser builds it to preview before a save. */
export function viewOf(chart: Chart): GeneKeysView {
  const design = analyse(chart);
  const p = chart.personality.Sun.line, d = chart.design.Sun.line;
  const s = STRATEGY_WORDS[design.type], a = AUTHORITY_WORDS[design.authority];
  return {
    profile: profileOf(chart),
    names: `${lineWord(p)} · ${lineWord(d)}`,
    lines: [p, d],
    spheres: SHOWN_SPHERES.map((sphere) => sphereView(chart, sphere)),
    love: LOVE_SPHERES.map((sphere) => sphereView(chart, sphere)),
    prosperity: PROSPERITY_SPHERES.map((sphere) => sphereView(chart, sphere)),
    type: design.type,
    strategy: s.strategy,
    strategyLine: s.line,
    authority: design.authority,
    authorityName: a.name,
    authorityLine: a.line,
  };
}
