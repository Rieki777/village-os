/**
 * Deciding what a question costs before anything is spent on it (S78, Lane K1).
 *
 * Every organize answer used to take one road: describe eight readers to the
 * model, pay for a POST that comes back asking for one of them, run it, then
 * pay for a second POST that turns the rows into a sentence. Measured live
 * against the current model, that is two POSTs and about 7,400 input tokens
 * per answer. Fourteen answers out of fourteen opened a reader, and seven of
 * the ten demo questions were structured lookups the model did nothing to
 * except narrate. "How many members do we have" bought both POSTs to read one
 * row this server can read by itself.
 *
 * This file is the decision about which road, and it is keyword scoring and
 * not a model, because a router that costs a model call to run has spent the
 * saving before it starts.
 *
 *   deterministic  one reader answers it completely and a template can say so.
 *                  Zero POSTs, zero tokens, and a usage row that says so.
 *   prefetch       the answer wants prose and we already know which reader
 *                  holds the facts. One POST, with the rows already in it.
 *   no-tools       plainly a general question about coordination, with nothing
 *                  in this village's record bearing on it. One POST.
 *   loop           not sure. The two-POST tool loop, byte for byte unchanged.
 *
 * THE THRESHOLD MATTERS MORE THAN THE PATTERNS. A confidently wrong cheap
 * answer is worse than a right expensive one, so this is built to be hard to
 * convince: a winner needs a real score AND a clear lead over the runner-up.
 * That is the same shape `deterministicWinner` uses to let the concierge
 * resolve a match without the assistant (server/lib/map.ts), and it is here
 * for the same reason. Everything it is unsure about falls to `loop`, which is
 * exactly what happened before this file existed, so the failure mode of the
 * whole lane is "it costs what it used to".
 *
 * Ambiguity is designed IN rather than resolved. "What gaps do we have" could
 * mean unfilled seats or questions the concierge could not answer, so the word
 * `gaps` is worth almost nothing to either and that question goes to the loop.
 * A term only scores well when it names one reader and close to nothing else.
 *
 * It never touches the database, and it never names a reader the viewer cannot
 * call: the caller passes the keys from its own `readerCatalog`, and
 * candidates are filtered to that list BEFORE scoring. Refusals stay in
 * `callReader`, where they belong. The MCP server must not become a second
 * permission system, and neither must this.
 */
import { READER_KEYS } from "./villageReaders";
import { RENDERERS, type Renderer } from "./assistantTemplates";

/**
 * Why a question wants the model, which is not the same question as which
 * reader holds its facts.
 *
 * `narrowed` asked about one thing inside a list, so the rows are the answer
 * and someone has to pick from them. `advisory` asked for a judgement, and the
 * rows are only the evidence. The caller treats them differently when a reader
 * comes back empty: an empty list IS the complete answer to "what did we
 * decide about the land", and it is no answer at all to "how should we
 * structure our circles", which still wants counsel.
 */
export type PrefetchReason = "narrowed" | "advisory";

export type RouteDecision =
  | { kind: "deterministic"; reader: string; renderer: Renderer }
  | { kind: "prefetch"; readers: string[]; reason: PrefetchReason }
  | { kind: "no-tools" }
  | { kind: "loop" };

/**
 * Three tiers, and the gap between them is the whole safety margin.
 *
 * SPECIFIC names one reader and almost nothing else in this vocabulary.
 * TOPIC names its subject but is a word other readers' questions also use.
 * SUPPORT only confirms a reading something else already suggested, and can
 * never carry a winner on its own: two SUPPORT hits still lose to one TOPIC.
 */
const SPECIFIC = 5;
const TOPIC = 3;
const SUPPORT = 1;

/** The lowest score that may answer at all. One TOPIC hit, and nothing less. */
const MIN_SCORE = TOPIC;
/** How far ahead of the runner-up the winner must be. */
const MIN_LEAD = 2;

type Weighted = [RegExp, number];

/**
 * Keyed by reader key, and a test holds these keys to `READER_KEYS` so that
 * adding a reader forces a decision here instead of silently routing to the
 * loop forever. Patterns are matched against lowercased text.
 */
const PATTERNS: Record<string, Weighted[]> = {
  "roles.all": [
    [/\brole (definitions?|descriptions?)\b/, SPECIFIC],
    [/\bwho does what\b/, TOPIC],
    [/\broles?\b/, TOPIC],
    [/\bpositions?\b/, SUPPORT],
    [/\bresponsibilit/, SUPPORT],
  ],
  "seats.vacant": [
    [/\bvacan/, SPECIFIC],
    [/\bunfilled\b/, SPECIFIC],
    [/\bshort.?handed\b/, SPECIFIC],
    [/\bunderstaffed\b/, SPECIFIC],
    [/\b(empty|open|unheld) seats?\b/, SPECIFIC],
    [/\bnobody (is )?(holding|in)\b/, SPECIFIC],
    [/\bseats?\b/, TOPIC],
    [/\bfill\w*/, SUPPORT],
    [/\broles?\b/, SUPPORT],
    [/\bshort of\b/, SUPPORT],
  ],
  "circles.all": [
    [/\bworking groups?\b/, SPECIFIC],
    [/\bsub.?circles?\b/, SPECIFIC],
    [/\bcircles?\b/, TOPIC],
  ],
  "members.summary": [
    [/\bhow many (people|members|of us|are we)\b/, SPECIFIC],
    [/\bhead ?count\b/, SPECIFIC],
    [/\bpopulation\b/, SPECIFIC],
    [/\bmembers?\b/, TOPIC],
    [/\bpeople\b/, SUPPORT],
    [/\bresidents?\b/, SUPPORT],
  ],
  "quests.library": [
    [/\bquest library\b/, SPECIFIC],
    [/\bquests?\b/, TOPIC],
    [/\bbount/, SUPPORT],
    [/\bofferings?\b/, SUPPORT],
  ],
  "badges.all": [
    [/\bbadges?\b/, TOPIC],
    [/\brecognitions?\b/, SUPPORT],
    [/\bcredentials?\b/, SUPPORT],
  ],
  "record.decisions": [
    [/\bdecision (log|record|history)\b/, SPECIFIC],
    [/\bwhat (have|did) we (decide|agree)/, SPECIFIC],
    [/\bdecisions?\b/, TOPIC],
    [/\bdecided\b/, TOPIC],
    [/\bagreed\b/, SUPPORT],
  ],
  "events.week": [
    [/\bthis week\b/, SPECIFIC],
    [/\bnext (7|seven) days\b/, SPECIFIC],
    [/\bwhat.?s on\b/, SPECIFIC],
    [/\bcalendar\b/, SPECIFIC],
    [/\bgatherings?\b/, TOPIC],
    [/\bevents?\b/, TOPIC],
    [/\bhappening\b/, TOPIC],
    [/\bcoming up\b/, TOPIC],
    [/\bschedule\b/, SUPPORT],
    [/\btonight\b/, SUPPORT],
    [/\bweekend\b/, SUPPORT],
  ],
  "concierge.gaps": [
    [/\bconcierge\b/, SPECIFIC],
    [/\bunanswered\b/, SPECIFIC],
    [/\b(could ?n.?t|cannot|can.?t|nothing could) (be )?answer/, SPECIFIC],
    [/\bquestions? (nobody|no one)\b/, SPECIFIC],
    // Deliberately cheap on both sides. See the header: this word is the
    // ambiguity, so it may confirm a reading and may never make one.
    [/\bgaps?\b/, SUPPORT],
  ],
  // The canvas's three (Wave 4, the companion). A block's NAME is not a
  // pattern here: "roles", "meetings" and "power" are words other readers'
  // questions use. The route reads the block a question names itself
  // (`blocksNamedIn`, server/lib/companionCanvas.ts), and the Ask buttons send
  // the block they sit on.
  "canvas.answers": [
    [/\bcanvas\b/, SPECIFIC],
    [/\bstill blank\b/, SPECIFIC],
    [/\bwhat did we (answer|say|adopt)\b/, SPECIFIC],
    [/\b(our |last |latest )readings?\b/, TOPIC],
    [/\breadings?\b/, SUPPORT],
    [/\badopted\b/, SUPPORT],
    [/\banswers?\b/, SUPPORT],
  ],
  "canvas.library": [
    [/\breading list\b/, SPECIFIC],
    [/\b(what|which) (should|could|can) (i|we) read\b/, SPECIFIC],
    [/\bresources?\b/, TOPIC],
    [/\b(articles?|toolkits?|books?)\b/, SUPPORT],
  ],
  "matrix.rows": [
    [/\bdecision matrix\b/, SPECIFIC],
    [/\bmatrix\b/, SPECIFIC],
    [/\bwho approves\b/, SPECIFIC],
    [/\bwho (is|gets|should be) (told|informed|consulted|asked first)\b/, TOPIC],
  ],
};

/** Reader keys this router knows how to score. Derived, never typed out twice. */
export const ROUTED_READERS = Object.keys(PATTERNS);

/**
 * Asking for a judgement, so a template cannot be the answer even when the
 * facts behind it are one reader away. These questions go to `prefetch`: the
 * model still writes the reply, and it stops paying for a round trip to ask
 * for data we could already tell it was going to want.
 */
const ADVISORY =
  /\b(should|recommend|advis|suggest|why|help me|best|prioriti|improve|better|next step|what do you (think|make)|how do we|how should|worth)\b/;

/** Asking for what is there. A template can answer this completely. */
const LOOKUP = /\b(list|show|what|which|who|how many|how much|do we have|are there|tell me|give me)\b/;

/**
 * Narrowing to one thing inside the list, which a template cannot do.
 *
 * "What did we decide" and "what did we decide about quiet hours" score
 * identically and want completely different answers: the first wants the list,
 * and the second wants one row out of it, read and summarized. A template that
 * answered the second by naming every decision in the record would be
 * answering a question nobody asked, confidently, for free, which is the one
 * failure this router must not have. The rows still get prefetched, so the
 * model writes that reply without spending a POST to ask for them.
 */
const QUALIFIER = /\b(about|regarding|concerning|to do with|related to|involving)\b/;

/**
 * Any sign the question is about THIS village. One of these words and the
 * question is never treated as general knowledge, however definitional it
 * looks, because "what are our roles" and "what is a role" differ by one word
 * and only one of them has an answer in the database.
 */
const DEIXIS = /\b(our|ours|we|us|we're|we've|this village|here|my|mine|the village)\b/;

/** The shape of a question about the world instead of about this village. */
const DEFINITIONAL =
  /\b(what (is|is a|is an|are|does)|difference between|what.s the difference|define|meaning of|explain)\b/;

function scoreFor(text: string, key: string): number {
  let score = 0;
  for (const [re, weight] of PATTERNS[key] ?? []) if (re.test(text)) score += weight;
  return score;
}

/**
 * Which road this question takes.
 *
 * `catalog` is the caller's own `readerCatalog(viewer)` keys. Filtering to it
 * before scoring is what keeps this file out of the permission business: a
 * viewer who cannot see `concierge.gaps` asking about the concierge scores
 * nothing and goes to the loop, where the model is shown the same restricted
 * tool list it always was.
 */
export function routeQuestion(text: string, catalog: string[]): RouteDecision {
  const q = String(text ?? "").toLowerCase();
  if (!q.trim()) return { kind: "loop" };

  const allowed = ROUTED_READERS.filter((k) => catalog.includes(k));
  const scored = allowed
    .map((key) => ({ key, score: scoreFor(q, key) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const confident = Boolean(top) && top.score >= MIN_SCORE && (!second || top.score - second.score >= MIN_LEAD);

  if (!confident) {
    // No reader is even faintly implicated and the question is shaped like one
    // about the world. Offering eight tools to a question about the difference
    // between consent and consensus is what made 14 of 14 answers open a
    // reader that had nothing to do with the question.
    if (!top && DEFINITIONAL.test(q) && !DEIXIS.test(q)) return { kind: "no-tools" };
    return { kind: "loop" };
  }

  // Advisory first: a question can be shaped as a lookup and still be asking
  // for a recommendation ("which seat should we fill first"), and the model
  // has to write that reply.
  if (ADVISORY.test(q)) return { kind: "prefetch", readers: [top.key], reason: "advisory" };
  // Then narrowing, which is the difference between the list and one row of it.
  if (QUALIFIER.test(q)) return { kind: "prefetch", readers: [top.key], reason: "narrowed" };
  // A key check and not a truthiness check on the function. A reader can be
  // scored here and have no template yet, and that case has to fall to a road
  // with a model on it instead of handing the route an undefined to call.
  if (LOOKUP.test(q) && top.key in RENDERERS) {
    return { kind: "deterministic", reader: top.key, renderer: RENDERERS[top.key] };
  }
  return { kind: "prefetch", readers: [top.key], reason: "narrowed" };
}

/**
 * Every reader is scored, or the omission is loud.
 *
 * Exported so the unit test asserts it against `READER_KEYS` instead of
 * against a list in the test file that drifts the first time a reader lands.
 */
export function unroutedReaders(): string[] {
  return READER_KEYS.filter((k) => !ROUTED_READERS.includes(k));
}
