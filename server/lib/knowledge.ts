/**
 * Maia's shelves (S70, rebuilt S71/S72): what she draws on, and in what order.
 *
 * THE SHARED BRAIN ships with the platform and is identical in every fork:
 *
 *   - `knowledge` — the distilled literature: sociocracy, governance, conflict,
 *     relating, regenerative organizing, legal structures, membership design.
 *   - `modules` — the per-module contracts in docs/modules. They have shipped
 *     since S13 and nothing read them, which is why she could describe what the
 *     exchange is for only by guessing.
 *
 * THE VILLAGE BRAIN is the fork's own and never leaves it. Today that is the
 * human-edited call syntheses; `docs/MAIA_BRAIN_SPEC.md` specifies the rest.
 * The rule (Rye, 2026-07-27) holds across all of it: the village's own material
 * OUTRANKS the shared brain. What this community said about itself is evidence;
 * the literature is counsel.
 *
 * Selection is deterministic BM25, not embeddings, so a prompt you can predict
 * is worth more than a search engine you cannot.
 *
 * ── S71: the scoring ────────────────────────────────────────────────────────
 *
 * The first version tokenized with `[a-z][a-z0-9'-]{3,}`, counted raw
 * substrings, and applied a flat threshold, which failed in three ways a
 * founder would actually hit:
 *
 *   1. Anything under four characters or starting with a digit was invisible.
 *      "tax", "NVC", "LLC", "DAO" and "508" never scored, so "how do we handle
 *      tax" consulted NOTHING while legal-structures.md answered it in detail,
 *      and "what is NVC" ranked nvc-and-conflict.md dead last behind three
 *      documents tied on the word "what". `508` appears twelve times in
 *      legal-structures.md and Maia is told never to soften its scam warnings,
 *      which she cannot do if the term that selects the document does not exist
 *      to her.
 *   2. Substring counting, so "art" scored against "start" and "party".
 *   3. No weighting and no length normalization, so the longest document won on
 *      filler words that appear on every shelf.
 *
 * What replaced it, all deterministic and inspectable: whole-token matching
 * (`508(c)(1)(A)` yields `508`), BM25 with per-collection IDF and length
 * normalization, a rule that only a CONTENT word can qualify a document (so
 * "what should we do" consults nothing and she says the question is outside her
 * shelf), and a relative floor that drops anything under a fifth of the best
 * match.
 *
 * ── S72: sections, not files ────────────────────────────────────────────────
 *
 * Corpus files run 13 to 18 KB, so injecting two whole ones cost about 9,000
 * tokens before the village's own material was added. Shelves now index
 * SECTIONS split on `##` and `###`, which bounds the prompt and sharpens
 * ranking at the same time: a heading-level match is a far better signal than a
 * hit somewhere in 17 KB.
 */
import fs from "fs";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
// LANE Q: the provenance half of the shelf. `moduleDocProvenance.ts` is the
// mechanism (who wrote a document, declared in the document's own text); this
// file is where a citation says it out loud.
import { readProvenance, provenanceSuffix, type DocProvenance } from "./moduleDocProvenance";

// ── Tokenizing and scoring ───────────────────────────────────────────────────

/** BM25 constants, the standard defaults. */
const K1 = 1.2;
const B = 0.75;

/** A match under this share of the best score is noise, not counsel. */
const RELATIVE_FLOOR = 0.2;

/**
 * Retrieval is TWO STAGE: documents first, then sections inside them.
 *
 * Ranking sections directly looked simpler and was measurably worse. Sections
 * are small and numerous (167 of them against 15 documents), so one lucky term
 * in a short section beat a document that was plainly about the subject, and
 * document-frequency statistics stopped meaning anything: "should we turn on
 * the exchange?" answered from the health dashboard, because `turn` appears in
 * 2 sections and `exchange` in 27.
 *
 * Documents are big and topical, so the same scorer picks them reliably. Only
 * once a document is chosen do sections decide WHICH PART of it rides the
 * prompt, which is all sections were ever needed for.
 */
const MAX_DOCS = 3;

/**
 * English function words and generic verbs. They still SCORE (inverse document
 * frequency makes them worth almost nothing), and they never SELECT a document.
 *
 * This list is load-bearing and was twice too short. Document frequency cannot
 * tell a generic verb from a technical term: across the 42 literature sections
 * `set` and `508c1a` each appear in exactly 5, and across all 167 sections
 * `turn` (2) is rarer than `exchange` (27). So "should we set up a 508c1a?"
 * answered from a DAO section and "should we turn on the exchange?" answered
 * from the health dashboard. Only vocabulary fixes that.
 *
 * Domain words a founder might genuinely search on stay OUT on purpose:
 * "need", "offer", "hold", "open", "close", "value", "role", "term", "work",
 * "share", "member", "money", "stage", "cycle".
 */
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "the a an and or but if then than that this these those there here of to in on at by for with from as into over under about " +
    "is are was were be been being am do does did doing done have has had having can could will would may might must shall should " +
    "i we you he she it they me us them my our your their his its who whom whose which what when where why how vs versus " +
    "no not yes any all some more most much many very just also too so such own same other another each every both either neither " +
    "get got gets make makes made making go goes going gone come comes came take takes took taken give gives gave given " +
    "say says said know knows knew think thinks thought set sets setting put puts putting use uses used using turn turns turned " +
    "keep keeps kept find finds finding found look looks looking see sees seen seem seems let lets letting " +
    "try tries tried trying start starts started run runs ran help helps helped want wants wanted " +
    "up down out off back again still even well good better best bad really actually maybe perhaps often always never sometimes " +
    "one two three first second next last thing things way ways lot lots kind sort able possible"
  ).split(" "),
);

/** Beyond this, a compacted form is a mangled URL and not a term. */
const MAX_COMPACT = 40;

/**
 * Alphanumeric runs of two or more characters, apostrophes kept inside a word.
 * Digits may lead: `508(c)(1)(A)` yields `508`, and the single characters drop
 * out on length.
 *
 * Punctuation-joined words ALSO emit a compacted form, because a reader treats
 * `508(c)(1)(A)` and `508c1a` as one term and so must she. Without it, a
 * founder asking "should we set up a 508c1a?" reached the sources list at the
 * bottom of legal-structures.md (where that spelling appears in URLs) and lost
 * to a longer document, while the twelve substantive mentions of the scam
 * spelled `508(c)(1)(A)` were invisible to that query. It earns its keep on
 * ordinary words too: `co-op` now matches `coop`.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    const runs = word.match(/[a-z0-9][a-z0-9'’]*/g) ?? [];
    for (const r of runs) if (r.length >= 2) out.push(r);
    if (runs.length > 1) {
      const compact = runs.join("");
      if (compact.length >= 2 && compact.length <= MAX_COMPACT) out.push(compact);
    }
  }
  return out;
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * What a document is CALLED outranks what it mentions.
 *
 * A term in a document's key, title or heading gets this many inverse-document
 * -frequency units on top of its BM25 contribution. BM25 saturates term
 * frequency around 2.2x by design, so no number of body mentions can express
 * "this document is literally named that", and without the bonus "should we
 * turn on the exchange?" answered from `stays.md`, which mentions work-exchange
 * quests. Three units puts a name match just above the best a body can do.
 */
const IDENTITY_BONUS = 3;

/** A document reduced to what scoring needs: term counts, length, and name. */
export interface Indexed<T> {
  item: T;
  tf: Map<string, number>;
  len: number;
  /** Terms from the key, title and heading. */
  identity?: Set<string>;
}

/**
 * Fold singular and plural, but only onto forms the collection actually uses.
 *
 * A founder asking about "deposits" found nothing, because `stays.md` writes
 * "deposit". Generic stemming would mangle "process" into "proces"; checking the
 * collection's own vocabulary first cannot, since a variant is only added when
 * some document already contains it.
 */
export function expandPlurals<T>(terms: string[], docs: Array<Indexed<T>>): string[] {
  const vocab = new Set<string>();
  // forEach, not `for...of` over keys(): the build target does not iterate map
  // iterators without downlevelIteration.
  for (const d of docs) d.tf.forEach((_, t) => vocab.add(t));
  const out = new Set(terms);
  for (const t of terms) {
    // A function word's plural is still a function word. Expanding them let
    // "set it up and turn it on" reach a section through `ups`, from
    // "follow-ups", and answer a question that contained no question.
    if (STOPWORDS.has(t)) continue;
    for (const variant of [t.replace(/ies$/, "y"), t.replace(/es$/, ""), t.replace(/s$/, ""), `${t}s`, `${t}es`]) {
      if (variant !== t && variant.length >= 3 && !STOPWORDS.has(variant) && vocab.has(variant)) out.add(variant);
    }
  }
  return Array.from(out);
}

export function indexDoc<T>(item: T, text: string, identityText?: string): Indexed<T> {
  const tokens = tokenize(text);
  return {
    item,
    tf: termFreq(tokens),
    len: tokens.length,
    identity: identityText ? new Set(tokenize(identityText)) : undefined,
  };
}

/**
 * BM25 over an already-indexed collection. Ties keep input order, so callers
 * that pass rows newest-first get recency as the tiebreak for free.
 */
export function rank<T>(docs: Array<Indexed<T>>, query: string, max: number): T[] {
  const n = docs.length;
  if (n === 0 || max <= 0) return [];
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / n || 1;
  const terms = expandPlurals(Array.from(new Set(tokenize(query))), docs);

  // Inverse document frequency, over THIS collection. A term on every shelf
  // lands near zero; a term in one document lands high.
  const idf = new Map<string, number>();
  for (const t of terms) {
    let df = 0;
    for (const d of docs) if (d.tf.has(t)) df += 1;
    if (df > 0) idf.set(t, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }

  const scored: Array<{ item: T; score: number }> = [];
  for (const d of docs) {
    let score = 0;
    let qualified = false;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      // A content word the document holds is what earns it a place in the
      // prompt. Function words ride along for ranking and never qualify.
      if (!STOPWORDS.has(t)) qualified = true;
      const w = idf.get(t) ?? 0;
      score += w * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avgLen))));
      if (d.identity?.has(t) && !STOPWORDS.has(t)) score += w * IDENTITY_BONUS;
    }
    if (qualified && score > 0) scored.push({ item: d.item, score });
  }
  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);
  const floor = scored[0].score * RELATIVE_FLOOR;
  return scored.filter((s) => s.score >= floor).slice(0, max).map((s) => s.item);
}

// ── The shared brain: shelves of sections ────────────────────────────────────

export type ShelfId = "knowledge" | "modules";

export interface ShelfSection {
  shelfId: ShelfId;
  /** Stable key for citation. For `modules` this is the MODULE ID. */
  docKey: string;
  docTitle: string;
  /** The `##`/`###` heading this section sits under, or "" for the preamble. */
  heading: string;
  body: string;
  tokens: number;
  /**
   * LANE Q: whose words these are, read from the document's own `Provenance:`
   * line. Null for a document that declares nothing, which is the same as
   * platform for citation purposes and is why the knowledge shelf is unchanged.
   */
  provenance?: DocProvenance | null;
}

/** Prompt budget for the shared brain, per turn. Tokens are authoritative. */
export const SHELF_BUDGET = {
  maxTokens: 2500,
  maxSections: 6,
  maxPerDoc: 3,
  sectionTokenCap: 1200,
} as const;

/**
 * The module shelf is an ALLOWLIST, never a directory glob.
 *
 * `docs/modules/` also holds CRITIQUE-architecture.md and CRITIQUE-economy.md,
 * two platform notes, and a doc for a module that does not ship. A glob would
 * let Maia answer "should we turn on the exchange?" by quoting a critique of its
 * design back to a founder as though it described the product. Filenames also do
 * not follow module ids (CLAUDE.md warns about this), so the mapping is
 * explicit in both directions.
 */
export const MODULE_DOCS: Readonly<Record<string, string>> = {
  map: "village-map.md",
  exchange: "internal-exchange.md",
  feed: "gratitude-feed.md",
  library: "material-library.md",
  health: "health-dashboard.md",
  tools: "tools-hub.md",
  badges: "badges.md",
  stays: "stays.md",
  events: "events.md",
  resources: "how-resources-flow.md",
  crowdpool: "crowdpool.md",
  hypha: "hypha.md",
  // The doc has sat on the shelf since 2026-08-10 with nothing routing to it, so
  // the assistant could not reach it and the module read as undocumented. Its
  // own header names the registry id.
  messaging: "messaging.md",
  // The four CORE modules. A village cannot switch these off, so their
  // contract docs are the ones a fork operator most needs and the last ones
  // written: the gap ratchet counted all four until 2026-09-06.
  quests: "quests.md",
  gratitude: "gratitude.md",
  progression: "progression.md",
  profiles: "profiles.md",
};

/** Deterministic and close enough for a budget. Four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split a markdown document on its `##` and `###` headings. The text before the
 * first heading becomes a section with an empty heading, so a document's
 * opening framing is never lost.
 */
export function splitSections(body: string): Array<{ heading: string; text: string }> {
  const out: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } = { heading: "", lines: [] };
  for (const line of body.split("\n")) {
    if (/^#{2,3}\s+\S/.test(line)) {
      if (current.lines.some((l) => l.trim())) out.push(current);
      current = { heading: line.replace(/^#{2,3}\s+/, "").trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) out.push(current);
  return out.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
}

interface ShelfDoc {
  shelfId: ShelfId;
  key: string;
  title: string;
  sectionCount: number;
}

let sections: Array<Indexed<ShelfSection>> = [];
let docs: Array<Indexed<ShelfDoc>> = [];

function loadOne(shelfId: ShelfId, dir: string, file: string, key: string): number {
  const body = fs.readFileSync(path.join(dir, file), "utf8");
  const title = body.split("\n")[0]?.replace(/^#\s*/, "").trim() || key;
  // LANE Q: read once per document, carried on every section it produces, so a
  // citation can say whose words it is quoting without a second file read.
  const provenance = readProvenance(body);
  let n = 0;
  for (const s of splitSections(body)) {
    const section: ShelfSection = {
      shelfId,
      docKey: key,
      docTitle: title,
      heading: s.heading,
      body: s.text,
      tokens: estimateTokens(s.text),
      provenance,
    };
    // The key, title and heading are the section's IDENTITY, not just more of
    // its text: a question about legal structures should reach
    // `legal-structures.md` even where the prose says "entity".
    sections.push(indexDoc(section, `${key} ${title} ${s.heading}\n${s.text}`, `${key} ${title} ${s.heading}`));
    n += 1;
  }
  docs.push(indexDoc({ shelfId, key, title, sectionCount: n }, `${key} ${title}\n${body}`, `${key} ${title}`));
  return n;
}

/**
 * Load every shared-brain shelf once at boot. An absent directory is an empty
 * shelf, loudly: Maia says a question is outside her shelf, and the operator
 * gets a line in the log saying why.
 */
export function loadShelves(baseDir: string): Record<ShelfId, number> {
  sections = [];
  docs = [];
  const counts: Record<ShelfId, number> = { knowledge: 0, modules: 0 };

  const knowledgeDir = path.join(baseDir, "docs", "knowledge");
  if (fs.existsSync(knowledgeDir)) {
    for (const f of fs.readdirSync(knowledgeDir).filter((x) => x.endsWith(".md")).sort()) {
      counts.knowledge += loadOne("knowledge", knowledgeDir, f, f.replace(/\.md$/, ""));
    }
  } else {
    console.error("[knowledge] docs/knowledge missing: Maia has no literature shelf");
  }

  const modulesDir = path.join(baseDir, "docs", "modules");
  if (fs.existsSync(modulesDir)) {
    for (const [moduleId, file] of Object.entries(MODULE_DOCS)) {
      if (!fs.existsSync(path.join(modulesDir, file))) {
        console.error(`[knowledge] module contract missing: ${file} (module ${moduleId})`);
        continue;
      }
      counts.modules += loadOne("modules", modulesDir, file, moduleId);
    }
  } else {
    console.error("[knowledge] docs/modules missing: Maia has no module contracts");
  }
  return counts;
}

/** What is on the shelves, for the admin transparency panel. */
export function shelfDocs(shelfId?: ShelfId): ShelfDoc[] {
  return docs.map((d) => d.item).filter((d) => !shelfId || d.shelfId === shelfId);
}

/** Module ids from the given list that ship no contract. She must say so rather
 *  than reason from a neighbouring module's doc. */
export function modulesWithoutContracts(moduleIds: readonly string[]): string[] {
  return moduleIds.filter((id) => !(id in MODULE_DOCS));
}

export interface SectionQuery {
  /** Which shelves may answer. Omitted means all of them. */
  shelves?: readonly ShelfId[];
  /** Restrict the module shelf to these module ids (usually: the ones that are on). */
  moduleKeys?: readonly string[];
  /** How many documents stage one may choose. */
  maxDocs?: number;
  /**
   * Override any of the budget's four numbers. The keys are tied to
   * `SHELF_BUDGET` so a misspelled one is still a type error, but the VALUES
   * are plain numbers: `SHELF_BUDGET` is `as const`, so `Partial<typeof
   * SHELF_BUDGET>` typed each override as the literal default it was meant to
   * replace, and `{ maxTokens: 400 }` was rejected as "not assignable to type
   * 2500". The option could not be used with any number but the one already
   * in force, at any call site.
   */
  budget?: Partial<Record<keyof typeof SHELF_BUDGET, number>>;
}

/** Stage one: which documents is this question about. Exported for tests. */
export function relevantDocs(query: string, opts: SectionQuery = {}): ShelfDoc[] {
  const eligible = docs.filter((d) => {
    if (opts.shelves && !opts.shelves.includes(d.item.shelfId)) return false;
    if (opts.moduleKeys && d.item.shelfId === "modules" && !opts.moduleKeys.includes(d.item.key)) return false;
    return true;
  });
  return rank(eligible, query, opts.maxDocs ?? MAX_DOCS);
}

/**
 * The shared brain's answer to a question, inside the prompt budget.
 *
 * Both stages rank over the ELIGIBLE pool only, so inverse document frequency
 * reflects what is actually being searched: a term common across the module
 * contracts should not read as rare because the literature never uses it.
 */
export function relevantSections(query: string, opts: SectionQuery = {}): ShelfSection[] {
  const budget = { ...SHELF_BUDGET, ...(opts.budget ?? {}) };
  const chosenDocs = relevantDocs(query, opts);
  if (chosenDocs.length === 0) return [];
  const allowed = new Set(chosenDocs.map((d) => `${d.shelfId}:${d.key}`));

  // Stage two: the best sections WITHIN the chosen documents. Ranking inside a
  // narrow pool is what sections are good at; choosing the subject is not.
  const eligible = sections.filter((s) => allowed.has(`${s.item.shelfId}:${s.item.docKey}`));
  const ranked = rank(eligible, query, 50);

  const chosen: ShelfSection[] = [];
  const perDoc = new Map<string, number>();
  let spent = 0;
  for (const s of ranked) {
    if (chosen.length >= budget.maxSections) break;
    const docId = `${s.shelfId}:${s.docKey}`;
    if ((perDoc.get(docId) ?? 0) >= budget.maxPerDoc) continue;
    // Cap the section itself first: one 2,282-token section would otherwise eat
    // the whole budget and crowd out every other shelf.
    const capped =
      s.tokens > budget.sectionTokenCap
        ? { ...s, body: `${s.body.slice(0, budget.sectionTokenCap * 4)}\n\n[section truncated]`, tokens: budget.sectionTokenCap }
        : s;
    if (spent + capped.tokens > budget.maxTokens) {
      // A later, smaller section may still fit; keep going rather than stopping.
      continue;
    }
    chosen.push(capped);
    perDoc.set(docId, (perDoc.get(docId) ?? 0) + 1);
    spent += capped.tokens;
  }
  return chosen;
}

/**
 * How a section cites itself in a prompt and in the transparency panel.
 *
 * LANE Q wires the provenance half. Silence still means ours: a platform
 * document (or one that declares nothing) appends an empty string, so every
 * citation on today's shelf reads exactly as it did. The first time a
 * listing's own contract joins the shelf, a reader sees whose words they are
 * instead of receiving a vendor's description of a vendor's product in the
 * same voice as the platform's own contract for quests.
 *
 * The suffix goes LAST, which is what `provenanceSuffix` documents itself as
 * ("what a citation appends") and what its leading space is shaped for. The
 * one-line sketch in `moduleDocProvenance.ts`'s header has the two operands
 * the other way round, which would print the author before the title.
 */
export function sectionCitation(s: ShelfSection): string {
  return (s.heading ? `${s.docTitle} > ${s.heading}` : s.docTitle) + provenanceSuffix(s.provenance ?? null);
}

// ── The village's own second brain ───────────────────────────────────────────

export interface SecondBrainHit {
  recordingTitle: string;
  recordedAt: string | null;
  /** The human-edited synthesis body, truncated for the prompt. */
  excerpt: string;
}

export interface SynthesisRow {
  body: string;
  title: string | null;
  recorded_at: Date | string | null;
}

/** Pure half of the second-brain read, so it is testable without a database. */
export function rankSyntheses(rows: SynthesisRow[], query: string, max = 3): SecondBrainHit[] {
  const indexed = rows.map((r) => indexDoc(r, String(r.body ?? "")));
  return rank(indexed, query, max).map((r) => ({
    recordingTitle: String(r.title ?? "Untitled call"),
    recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
    excerpt: String(r.body).slice(0, 2400),
  }));
}

/**
 * The village's own voice: human-edited call syntheses matching the question,
 * newest first. `body` (edited), never `ai_body`: what the village CORRECTED is
 * the trustworthy record.
 *
 * The whole archive ranks, and recency only decides what falls off the end. The
 * first version took the newest 40 rows and ranked THOSE, so a village's older
 * calls went silently unfindable the moment it recorded its 41st. The 1000-row
 * bound is memory safety and nothing else; a village that passes it has earned a
 * FULLTEXT index on `call_syntheses.body` and a WHERE MATCH.
 */
export async function relevantSyntheses(pool: Pool, query: string, max = 3): Promise<SecondBrainHit[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    // is_example = 0 or the seeded demo synthesis is fed to the model under
    // "THIS VILLAGE'S OWN RECORD, highest authority" and cited back as a call
    // that happened. On a fresh fork it is the only synthesis there is, so it
    // would be the top-authority source for every question it scores against.
    // `recordings` has no `recorded_at` and never had one: 0028 creates it with
    // id, source, external_id, title, url, duration_s, status, created_at, and
    // the only later ALTER is is_example (0046). MySQL raises ER_BAD_FIELD_ERROR
    // at parse time whatever the row count, so this query failed on every call
    // and took the whole organize route down with it. The synthesis's own
    // created_at is the date a reader wants anyway: it is when the village
    // wrote up the call.
    "SELECT s.body, r.title, s.created_at AS recorded_at FROM call_syntheses s JOIN recordings r ON r.id = s.recording_id " +
      "WHERE s.is_example = 0 ORDER BY s.created_at DESC LIMIT 1000",
  );
  return rankSyntheses(rows as unknown as SynthesisRow[], query, max);
}
