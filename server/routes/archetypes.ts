/**
 * The admin surface for the five classes: the village's own words for them.
 *
 *   GET  /api/admin/archetypes        every class, with `customized`
 *   PUT  /api/admin/archetypes/order  { keys } rewrites the running order
 *   PUT  /api/admin/archetypes/:key   the five words a village owns
 *   POST /api/admin/archetypes        add a class, and name its key once
 *
 * ── THE KEY IS AN IDENTIFIER AND IS NEVER EDITABLE ─────────────────────────
 *
 * `openPathsFor` (server/lib/characters.ts) joins on it, the per-power
 * affinity map keys on it, and every `player_characters` row a member has ever
 * chosen stores it. A renamed key does not fail loudly: it matches nothing,
 * and a member's chosen class quietly stops resolving.
 *
 * So it is not enough for the form to leave the field out. `req.body` never
 * reaches a write anywhere in this file. The edit route reads five named
 * fields off it, builds an `ArchetypeWords` (server/repos/archetypes.ts), and
 * hands the key across as a separate argument that the repo puts in a WHERE
 * clause. There is no spread into an UPDATE and no column list built from
 * data. The repo header carries the five points that make that structural; the
 * one that lives here is the first: `ArchetypeWords` has no `key` member, so
 * `{ ...req.body }` in this file would not compile.
 *
 * `POST` is the one place a key is written, and it validates the string it is
 * about to make permanent.
 *
 * ── WHY THE ROUTES ARE IN THIS ORDER ───────────────────────────────────────
 *
 * `/order` is registered before `/:key`. Express matches in registration order
 * and `:key` would otherwise swallow the literal path, so a reorder would
 * arrive at the edit route as a class keyed "order". Moving these two past
 * each other is a behaviour change, the same note server/routes/faqs.ts makes
 * about extraction generally.
 *
 * ── THE GATES ──────────────────────────────────────────────────────────────
 *
 * The read takes `isAdmin`; the three writes take `guardCapability` with
 * `story.tell`, whose own description is "say what the village is, in public,
 * in its own words". That is exactly what a class name, subtitle, blurb and
 * examples are: `/api/archetypes` serves them to anybody at the front door.
 * The same asymmetry stands on `/api/admin/content` and `/api/admin/faqs`, and
 * this surface matches it instead of inventing a sixth capability key, which
 * would be five edits with the fifth invisible to the compiler.
 *
 * ── LENGTHS ARE CHECKED AGAINST THE SCHEMA, NOT TRIMMED TO IT ──────────────
 *
 * `name` is varchar(120), `subtitle` varchar(160), `sigil` varchar(64), `key`
 * varchar(64), `blurb` a text column of 65535 bytes. MySQL runs strict here,
 * so an over-long value is a rejected row and the caller gets a 500 for what
 * was really a typo. Silently cutting the string instead is worse: the admin
 * saves a blurb and reads back a shorter one with nothing said. Both are
 * refused with the number, so the person can see how far over they are.
 *
 * Character counts use code points, because that is what MySQL counts in
 * utf8mb4 and what JavaScript's `.length` does not: an emoji is one character
 * to the column and two to `.length`.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { villageId } from "../lib/economy";
import {
  type ArchetypeWords,
  getArchetypeRow,
  insertArchetype,
  listArchetypeRows,
  reorderArchetypes,
  updateArchetypeWords,
} from "../repos/archetypes";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability" | "getPool">;

/** The column widths, in the units the column measures. */
const NAME_MAX = 120;
const SUBTITLE_MAX = 160;
const SIGIL_MAX = 64;
const KEY_MAX = 64;
const BLURB_MAX_BYTES = 65535;

/**
 * A key is lowercase letters and nothing else.
 *
 * Narrow on purpose. It is permanent, it goes into URLs and JSON_CONTAINS
 * comparisons, and the five the platform ships are all of this shape. A
 * village that wants a two-word class calls it what it likes in `name`.
 */
const KEY_SHAPE = /^[a-z]{1,64}$/;

/**
 * A sigil is a key into the shared glyph library, so it carries no path
 * characters. 0069 says why in the column's own comment: a path in a data
 * column is a path somebody can point anywhere, and this string is rendered
 * into a lookup. Empty is allowed and means the class has no glyph yet.
 */
const SIGIL_SHAPE = /^[a-z0-9_-]{0,64}$/;

/**
 * What the column counts. `.length` counts UTF-16 units and is not this.
 *
 * A character outside the basic plane, an emoji among them, is one character
 * to a utf8mb4 column and two units to `.length`, so `.length` refuses names
 * the column would have taken. Collapsing each surrogate pair to one unit
 * first gives the column's own count. Written as a replace instead of a spread
 * because this project compiles with no `target` set, which means ES5, where
 * iterating a string needs a flag the repo does not set.
 */
const chars = (s: string): number => s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The words, or the sentence saying why not.
 *
 * One function for both writes, so an edit and an add can never drift into
 * accepting different things. It reads five named fields and returns a value
 * of a type with no `key` member, which is the first of the five reasons the
 * identifier is out of reach.
 */
function readWords(body: unknown): { words: ArchetypeWords } | { problem: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = text(b.name);
  if (!name) return { problem: "Every class needs a name. Give this one a name and save again." };
  if (chars(name) > NAME_MAX) {
    return { problem: `A class name fits in ${NAME_MAX} characters and that one is ${chars(name)}. Shorten it and save again.` };
  }

  const subtitle = text(b.subtitle);
  if (chars(subtitle) > SUBTITLE_MAX) {
    return { problem: `A subtitle fits in ${SUBTITLE_MAX} characters and that one is ${chars(subtitle)}. Shorten it and save again.` };
  }

  const sigil = text(b.sigil);
  if (chars(sigil) > SIGIL_MAX) {
    return { problem: `A sigil key fits in ${SIGIL_MAX} characters and that one is ${chars(sigil)}. Shorten it and save again.` };
  }
  if (!SIGIL_SHAPE.test(sigil)) {
    return { problem: "A sigil is a glyph key: lowercase letters, digits, hyphens and underscores. Leave it empty for no glyph." };
  }

  const blurb = typeof b.blurb === "string" ? b.blurb.trim() : "";
  const blurbBytes = Buffer.byteLength(blurb, "utf8");
  if (blurbBytes > BLURB_MAX_BYTES) {
    return { problem: `A blurb fits in ${BLURB_MAX_BYTES} bytes and that one is ${blurbBytes}. Shorten it and save again.` };
  }

  if (!Array.isArray(b.examples)) {
    return { problem: "Examples must be a list of sentences. Send an array of strings, or an empty array for none." };
  }
  const examples: string[] = [];
  for (let i = 0; i < b.examples.length; i += 1) {
    const entry = b.examples[i];
    if (typeof entry !== "string") {
      return { problem: `Example ${i + 1} is a ${typeof entry} and every example has to be a sentence. Send strings only.` };
    }
    const trimmed = entry.trim();
    // An empty entry renders as a blank bullet on the class panel, which reads
    // as a broken page. Dropping it is what the admin meant by leaving it blank.
    if (trimmed) examples.push(trimmed);
  }
  const examplesBytes = Buffer.byteLength(JSON.stringify(examples), "utf8");
  if (examplesBytes > BLURB_MAX_BYTES) {
    return { problem: `That is more example text than the column holds. Keep the whole list under ${BLURB_MAX_BYTES} bytes.` };
  }

  return { words: { name, subtitle, blurb, examples, sigil } };
}

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability, getPool } = deps;

  /**
   * Every class this village has, in the order it shows them.
   *
   * The refusal carries `message` beside the code, which most of the admin
   * routes in server/index.ts still do not. `refusal()` in the admin client
   * (client/src/components/admin/adminApi.ts) prefers the sentence and falls
   * back to the code, so a bare `auth_required` is what a founder reads in the
   * toast. The three writes below need no such line: their refusal body is
   * written by `guardCapability`, which already says who holds the power.
   */
  app.get("/api/admin/archetypes", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({
        error: "auth_required",
        message: "Sign in as an admin to see the village's classes.",
      });
    }
    res.json({ archetypes: await listArchetypeRows(getPool(), villageId()) });
  });

  /**
   * The running order.
   *
   * Registered before `/:key`, and it takes EVERY key exactly once. A partial
   * list would leave the classes it did not name at whatever number they had,
   * which is a list that reads in an order nobody chose and that nobody can
   * see is wrong. So the refusal names what is missing and what is unexpected,
   * and the caller can fix its payload without guessing.
   */
  app.put("/api/admin/archetypes/order", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(raw.keys)) {
      return res.status(400).json({ error: "Send { keys: [...] } naming every class in the order you want them." });
    }
    if (raw.keys.some((k: unknown) => typeof k !== "string")) {
      return res.status(400).json({ error: "Every entry in keys has to be a class key. Send strings only." });
    }
    const keys = (raw.keys as string[]).map((k) => k.trim());

    const existing = await listArchetypeRows(getPool(), villageId());
    const have = new Set(existing.map((a) => a.key));
    const sent = new Set(keys);
    const missing = existing.filter((a) => !sent.has(a.key)).map((a) => a.key);
    const unknown = keys.filter((k) => !have.has(k));
    const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (missing.length || unknown.length || repeated.length) {
      const parts: string[] = [];
      if (missing.length) parts.push(`left out ${missing.join(", ")}`);
      if (unknown.length) parts.push(`named ${unknown.join(", ")}, which this village has no class for`);
      if (repeated.length) parts.push(`listed ${repeated.join(", ")} twice`);
      return res.status(400).json({
        error: `The order has to name every class exactly once. This one ${parts.join("; ")}.`,
      });
    }

    await reorderArchetypes(getPool(), villageId(), keys);
    res.json({ success: true, archetypes: await listArchetypeRows(getPool(), villageId()) });
  });

  /**
   * Edit one class's words.
   *
   * The key in the path selects the row. It is handed to the repo as its own
   * argument and lands in a WHERE clause; the values come from `readWords`,
   * whose return type has no key in it.
   */
  app.put("/api/admin/archetypes/:key", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const key = String(req.params.key ?? "");
    const read = readWords(req.body);
    if ("problem" in read) return res.status(400).json({ error: read.problem });

    const row = await updateArchetypeWords(getPool(), villageId(), key, read.words);
    if (!row) return res.status(404).json({ error: `This village has no class keyed "${key}".` });
    res.json({ success: true, archetype: row });
  });

  /**
   * Add a class, and name its key.
   *
   * The key is permanent from this moment, so it is checked before it is
   * written and a collision is a refusal. Overwriting would take a class
   * members may already be playing and give it somebody else's words, with
   * every character row still pointing at it.
   */
  app.post("/api/admin/archetypes", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const key = text(raw.key);
    if (!key) {
      return res.status(400).json({ error: "A new class needs a key. It is the permanent identifier the game joins on, and it can never be changed." });
    }
    if (chars(key) > KEY_MAX || !KEY_SHAPE.test(key)) {
      return res.status(400).json({
        error: `A key is lowercase letters only, 1 to ${KEY_MAX} of them, with no spaces, digits or punctuation. It is permanent, so the village's own wording belongs in the name.`,
      });
    }
    const read = readWords(req.body);
    if ("problem" in read) return res.status(400).json({ error: read.problem });

    // Asked before the insert so the common case answers plainly. The insert
    // itself is what actually decides: it carries no ON DUPLICATE KEY UPDATE,
    // so two admins adding the same key at once still end with one class and
    // one refusal.
    const taken = await getArchetypeRow(getPool(), villageId(), key);
    if (taken) {
      return res.status(409).json({
        error: `This village already has a class keyed "${key}", called ${taken.name}. Keys are permanent, so pick a different one or edit that class.`,
      });
    }

    const outcome = await insertArchetype(getPool(), villageId(), key, read.words);
    if (!outcome.added) {
      return res.status(409).json({
        error: `This village already has a class keyed "${key}". Keys are permanent, so pick a different one or edit that class.`,
      });
    }
    res.json({ success: true, archetype: outcome.row });
  });
}
