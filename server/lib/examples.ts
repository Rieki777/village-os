/**
 * Standing examples — the empty-module problem, solved once.
 *
 * Every non-core module ships OFF. A founder turns one on and meets
 * "No items yet." — the module works and teaches nothing. Standing examples
 * fill that void with platform-authored worked content that retires itself the
 * moment the village publishes anything real.
 *
 * Four rules, each load-bearing:
 *
 * 1. EXAMPLES ARE INERT. They render in full; every mutation against one is
 *    refused. No example ever becomes a ledger row, escrow, a Stripe object,
 *    or open economic state. This is not tidiness: an example library loan
 *    would put credits in escrow, and open escrow makes openStateCheck refuse
 *    to disable the module — a demo that traps you in the module it was
 *    demoing.
 * 2. THE FLAG LIVES ON THE ROW (`is_example`), so it travels through every
 *    existing SELECT and no read path can present an example as real.
 * 3. RETIREMENT IS PER-MODULE AND ONE-WAY. `example_state.retired_at` is a
 *    permanent tombstone; deleting your real items later never brings the
 *    examples back. A village that has spoken for itself is not talked over.
 * 4. THE COPY IS PLATFORM LANGUAGE, never a village's brand, so every fork
 *    inherits the same examples and the brand ratchet stays green.
 *
 * Generalises the exit-policy `placeholder: true` pattern already in the
 * codebase: a flag on the record, cleared by the first real write, visible in
 * launch readiness.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { parseRewardRange } from "../../shared/questRewards";
import { HERO_SLOTS } from "../../shared/gratitudeVoices";
import { realVoiceCount } from "./gratitudeVoices";
import { stringVar } from "./variables";
import { loadTokenRegistry } from "./ledger";
import { badgeProblem } from "./badges";

export const EXAMPLE_REFUSAL =
  "This is a standing example. Publish your own to replace it.";

/** What a caller sends back when a route addresses an example row. */
export const EXAMPLE_REFUSAL_BODY = { error: EXAMPLE_REFUSAL, code: "example_immutable" };

/**
 * Which tables hold each module's examples, CHILD FIRST — retirement deletes
 * in array order, so a row whose parent is also an example goes first.
 *
 * `feed` shares forum_threads with `forum` (it is a lens, not a table), so its
 * entry is scoped by the seeded ids rather than the whole table; see
 * retireExamples().
 */
export const EXAMPLE_TABLES: Record<string, string[]> = {
  map: ["circles"],
  // Child-first, as this whole list is: an assignment points at a seat, so
  // the seatings go before the seats they hang off. `roles` (the permission
  // groups) is unrelated to both and simply also lives in this module.
  progression: ["org_role_assignments", "org_roles", "roles"],
  quests: ["quests"],
  // forum_thread_tags FIRST: this list deletes child-first, and the tag rows
  // are found through their thread, which the next entry removes.
  forum: ["forum_thread_tags", "forum_replies", "forum_threads"],
  feed: ["forum_threads"],
  // NOTE: forum and feed share forum_threads — see SCOPE below. Without a
  // per-module predicate, retiring either one deletes the other's rows.
  tools: ["tools"],
  library: ["library_items", "library_categories"],
  stays: ["accommodation_prices", "accommodations"],
  commerce: ["payment_products"],
  badges: ["badge_awards", "badges"],
  health: ["regen_entries"],
  // Declarations only, no children among them: rules and budgets point at
  // the map's example circles and progression's example seats by id, so
  // this module's examples read as a whole while those stand and retire on
  // the village's first real declaration regardless.
  resources: ["spending_rules", "funding_sources", "circle_budgets"],
  automation: ["call_tasks", "call_syntheses", "transcripts", "recordings"],
  network: ["peer_shared_cache", "peer_instances", "shared_items"],
  exchange: ["currency_prices", "token_exchange_settings", "tokens"],
  // `gratitude_log` is listed so `ownRealContent` can see a village's own
  // sends and decline to layer examples over them. It never HOLDS an example
  // row and never will: a gratitude row posts to the ledger at creation, so
  // seeding one would mint real recognition or break conservation.
  //
  // `gratitude_voices` is where the module's examples actually live (0180).
  // A voice carries no sender, no recipient and no amount, so it is not a
  // send, reaches no ledger, and can be seeded freely. Listing it here is what
  // makes gratitude a normal module at last: the banner appears while the
  // voices stand, "Clear examples" removes them, and the first real send
  // retires them through the trigger that has been firing all along.
  gratitude: ["gratitude_voices", "gratitude_log"],
  profiles: [],
};

/**
 * Tables that must NOT be consulted when asking "has this village made its own
 * content here?".
 *
 * `health_events` is the shared event spine — every boot, seed and module
 * toggle writes to it, so it is never empty and every module listing it would
 * read as already-populated and silently skip its examples. That is exactly
 * what happened to the feed on the first run.
 */
const NOT_EVIDENCE_OF_REAL_CONTENT = new Set([
  "health_events",
  // Every fork is born with the platform's own tokens (gratitude, credits,
  // the chain mirrors) — real rows that say nothing about whether this
  // village has built its own market yet.
  "tokens",
  // Same story, arrived later: 0063 ships the `cartographer` badge from the
  // migration itself, so every fork is born with a non-example row in `badges`
  // before seeding runs. Counting it meant badges read as already-populated on
  // a fresh database and never seeded its examples at all. `badge_awards` is
  // left in, and is the better question anyway: a badge the platform shipped
  // says nothing about this village, but an AWARD means someone here used it.
  "badges",
]);

/**
 * Modules whose "is there real content?" question the table list cannot answer.
 * The feed is a LENS over forum threads, so a forum thread is not evidence the
 * village has posted to the FEED — only a non-example thread in the feed's own
 * category is.
 */
const REAL_CONTENT_CHECK: Record<string, (p: Pool) => Promise<boolean>> = {
  // Scoped by CATEGORY, matching both the retirement trigger and the lens
  // query. Filtering on kind='post' instead meant a real micropost in any
  // other category permanently suppressed feed seeding without ever retiring
  // the feed's examples — two definitions of "real feed content" that
  // disagreed. The lens shows every kind in its category, so the category is
  // the only consistent answer.
  feed: async (p) => {
    const [[r]] = await p.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM forum_threads WHERE is_example = 0 AND category = ?",
      [stringVar("feed.category_slug")],
    );
    return Number(r.n) > 0;
  },
  // health_snapshots is written by the cycle close whether or not the health
  // module is on — collection is infrastructure, display is the module. Any
  // village that has settled one lunation therefore has snapshot rows, and
  // counting them as village-authored content meant enabling health seeded
  // nothing and the dashboard opened on "1 of 3 lunations". Only the land's
  // own ledger is evidence a human recorded something here.
  health: async (p) => {
    const [[r]] = await p.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM regen_entries WHERE is_example = 0",
    );
    return Number(r.n) > 0;
  },
  /**
   * "Has this village written anything for the WALL?", which is a narrower
   * question than "is there a gratitude row".
   *
   * The table list would answer with any non-example row in `gratitude_log`,
   * and that table also holds feed HEARTS: a tap on a post, whose `message` is
   * the body of the post it was tapped on and which the wall deliberately
   * never quotes. So a village that had only ever tapped hearts counted as
   * having spoken for itself, seeded no voices, and opened its wall on nothing
   * at all.
   *
   * This is the same computation `realVoiceCount` uses to decide what the hero
   * DRAWS, which is the point: the question "should this village see example
   * voices" and the question "does this village have voices of its own" must
   * be one question, or the answer to the first stops predicting the second.
   * `fullSendsIn` and `spreadsAcross` earned the same note on this branch.
   */
  gratitude: async (p) => {
    const [[r]] = await p.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM gratitude_log " +
        "WHERE is_example = 0 AND `kind` <> 'heart' AND `message` IS NOT NULL AND TRIM(`message`) <> ''",
    );
    return Number(r.n) > 0;
  },
};

/**
 * Extra WHERE predicate for a (module, table) pair, for tables two modules
 * share. `forum` and `feed` both live in forum_threads — the feed is a LENS,
 * not a table of its own — so an unscoped `WHERE is_example = 1` means the
 * first real forum thread silently deletes the feed's example posts while the
 * feed's own tombstone stays unset, leaving its banner over an empty page.
 *
 * Scoped by seeded id prefix rather than by `kind`: ex-feed-3 is seeded as an
 * announcement, so a kind='post' filter would miss it.
 */
const SCOPE: Record<string, Record<string, string>> = {
  forum: {
    forum_threads: "id LIKE 'ex-thread-%'",
    forum_replies: "id LIKE 'ex-reply-%'",
  },
  feed: {
    forum_threads: "id LIKE 'ex-feed-%'",
  },
};

const scopeFor = (moduleId: string, table: string): string | null =>
  SCOPE[moduleId]?.[table] ?? null;

/**
 * WIDENED delete predicates: rows that belong to an example because of what
 * they POINT AT, whatever their own flag says.
 *
 * upsertSettings writes `is_example = 0` on every write, which is right when
 * the slug is a real token — the standing example occupies the same primary
 * key, so an admin listing that token updates the example row in place and
 * retirement must not delete the listing they just saved. It is wrong for an
 * example TOKEN: one click on the purchasable toggle made the row real,
 * retirement then took the token and left the listing, and the next boot's
 * assertExchangeFirewalls refused to serve on "ex-credits is not a registered
 * token". A listing can never outlive its token.
 */
const WIDEN: Record<string, Record<string, string>> = {
  exchange: {
    token_exchange_settings: "token_slug IN (SELECT slug FROM tokens WHERE is_example = 1)",
    currency_prices: "token_slug IN (SELECT slug FROM tokens WHERE is_example = 1)",
  },
};

/**
 * The one table where deleting a flagged row can brick the next boot, so the
 * delete is conditioned on the ledger being empty of it. See deleteExampleRows.
 */
const KEEP_IF_IN_LEDGER: Record<string, string> = { exchange: "tokens" };

/** Tables with no `is_example` column of their own — deleted by parent ref. */
const BY_PARENT: Record<string, { parentTable: string; fk: string; parentKey: string }> = {
  transcripts: { parentTable: "recordings", fk: "recording_id", parentKey: "id" },
  peer_shared_cache: { parentTable: "peer_instances", fk: "peer_id", parentKey: "id" },
  // Tags carry no flag of their own, so they outlived the threads they
  // described: harmless, because the tag filter joins live thread ids, and
  // untidy in a way that grows by three rows per village forever.
  forum_thread_tags: { parentTable: "forum_threads", fk: "thread_id", parentKey: "id" },
};

export type RetireReason = "first_real_item" | "admin_cleared";

interface ExampleStateRow {
  seededAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  /** Consecutive retirement attempts that left rows behind. See RETIRE_CEILING. */
  retireAttempts: number;
}

const EMPTY_STATE: ExampleStateRow = {
  seededAt: null, retiredAt: null, retiredReason: null, retireAttempts: 0,
};

/**
 * How many times an automatic retirement may fail before it stops trying.
 *
 * A failed DELETE deliberately leaves the tombstone unstamped so the next
 * trigger retries, and with no ceiling that retry is every publish, forever:
 * the whole delete loop re-runs and logs the same error on every real row the
 * village ever creates. Whatever is wrong needs a person, not a thousandth
 * attempt. The admin clear button ignores this ceiling on purpose — it IS the
 * person, and it is the only way back once the automatic path has given up.
 */
const RETIRE_CEILING = 5;

let pool: Pool | null = null;
const state = new Map<string, ExampleStateRow>();

/**
 * Some of these tables are served by memory-cached collections
 * (`server/repos/store-db.ts`: MySQL-authoritative, memory-cached,
 * write-through). Retirement deletes rows with raw SQL, which is invisible to
 * those caches — the rows leave the database and the API keeps serving them
 * until the next boot. Injected at boot rather than imported, to avoid a cycle
 * back into index.ts, exactly like wireModuleAuth and wireErrorReporting.
 */
type CacheReloader = (tables: string[]) => Promise<void>;
let reloadCaches: CacheReloader | null = null;

export function wireExampleCaches(reload: CacheReloader): void {
  reloadCaches = reload;
}

// ── State ────────────────────────────────────────────────────────────────────

export async function loadExampleState(p: Pool): Promise<void> {
  pool = p;
  // retire_attempts arrived in 0048; a fork mid-migration must still boot.
  let rows: RowDataPacket[];
  try {
    [rows] = await p.query<RowDataPacket[]>(
      "SELECT module_id, seeded_at, retired_at, retired_reason, retire_attempts FROM example_state",
    );
  } catch {
    [rows] = await p.query<RowDataPacket[]>(
      "SELECT module_id, seeded_at, retired_at, retired_reason FROM example_state",
    );
  }
  state.clear();
  for (const r of rows) {
    state.set(String(r.module_id), {
      seededAt: r.seeded_at ? new Date(r.seeded_at).toISOString() : null,
      retiredAt: r.retired_at ? new Date(r.retired_at).toISOString() : null,
      retiredReason: r.retired_reason ?? null,
      retireAttempts: Number(r.retire_attempts ?? 0),
    });
  }
  await refreshRowPresence(p);
}

export function exampleState(moduleId: string): ExampleStateRow | null {
  return state.get(moduleId) ?? null;
}

/** Retired is PERMANENT — the one fact that keeps examples from coming back. */
export function isRetired(moduleId: string): boolean {
  return !!state.get(moduleId)?.retiredAt;
}

export function isSeeded(moduleId: string): boolean {
  return !!state.get(moduleId)?.seededAt;
}

/**
 * Every module currently showing examples.
 *
 * Seeded-and-not-retired is not enough: `gratitude` and `profiles` are stamped
 * seeded so the attempt is not repeated every boot, but they deliberately
 * create no rows. Claiming they show examples would put a banner over a page
 * that has none. Membership requires rows that actually exist.
 */
export function modulesWithExamples(): string[] {
  return Array.from(state.entries())
    .filter(([id, s]) => s.seededAt && !s.retiredAt && withRows.has(id))
    .map(([id]) => id);
}

/** Modules that currently hold at least one example row. */
const withRows = new Set<string>();

/** Recount which modules actually hold example rows. Cheap, and only at the
 *  three moments it can change: boot, a seed, and a retirement. */
async function refreshRowPresence(p: Pool, only?: string): Promise<void> {
  const ids = only ? [only] : Object.keys(EXAMPLE_TABLES);
  for (const id of ids) {
    let found = false;
    for (const table of EXAMPLE_TABLES[id] ?? []) {
      if (BY_PARENT[table]) continue;
      // Scoped exactly like retirement, or forum's surviving example replies
      // would keep the feed counted as "showing examples" and vice versa.
      const scope = scopeFor(id, table);
      try {
        const [[r]] = await p.query<RowDataPacket[]>(
          `SELECT COUNT(*) n FROM \`${table}\` WHERE is_example = 1` + (scope ? ` AND ${scope}` : ""),
        );
        if (Number(r.n) > 0) { found = true; break; }
      } catch { /* table absent on an older fork: not a failure */ }
    }
    if (found) withRows.add(id); else withRows.delete(id);
  }
}

// ── Reading the seed file ────────────────────────────────────────────────────

export function loadExampleSeed(seedsDir: string): any | null {
  const file = path.resolve(seedsDir, "examples-seed.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[examples] examples-seed.json is unreadable, skipping", e);
    return null;
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

const J = (v: unknown) => JSON.stringify(v ?? null);

/** INSERT IGNORE everywhere: re-running is a no-op, never a duplicate. */
/** N days before now; fractional days welcome. Undefined = a day ago. */
function agoDate(daysAgo: unknown): Date {
  const days = Number(daysAgo);
  return new Date(Date.now() - (Number.isFinite(days) ? days : 1) * 86400_000);
}

async function ins(conn: Pool | PoolConnection, table: string, row: Record<string, any>): Promise<number> {
  const cols = Object.keys(row);
  const sql =
    `INSERT IGNORE INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")}) ` +
    `VALUES (${cols.map(() => "?").join(",")})`;
  const [r] = await conn.query<any>(sql, Object.values(row));
  return r?.affectedRows ?? 0;
}

/** Units come from the registry, never from seed data — a wrong unit poisons
 *  the MAX(unit) label on the regen totals tile. */
const REGEN_UNITS: Record<string, string> = {
  trees_planted: "trees",
  hectares_restored: "ha",
  food_produced_kg: "kg",
  water_protected_liters: "liters",
  carbon_sequestered_kg: "kg",
};

const EXAMPLE_AUTHOR = "ex-user-mira";

/**
 * Modules whose example rows carry an author, owner or recorder. Only these
 * bring the identities into existence — otherwise a deployment that never
 * turns on a single one of them still ends up with three phantom accounts,
 * which is precisely the fake-people-in-`users` problem the exclusions exist
 * to contain.
 */
const NEEDS_IDENTITIES = new Set([
  "forum", "feed", "commerce", "health", "network", "exchange",
  // badges carries AWARDS, and an award names a holder. Without the
  // identities, enabling badges alone seeded award rows pointing at users
  // that do not exist: the holders list rendered empty, and every "no example
  // award touches a real user" check passed vacuously because a JOIN cannot
  // see a row whose other side is missing.
  "badges",
]);

/**
 * Seed the three example identities. No password_hash, so they can never log
 * in; `is_example` keeps them out of the member directory, launch counts,
 * gratitude eligibility, the Sybil helper and badge evaluation.
 */
async function seedIdentities(p: Pool, seed: any): Promise<number> {
  let n = 0;
  for (const u of seed?._identities?.users ?? []) {
    n += await ins(p, "users", {
      id: u.id,
      name: u.name,
      email: `${u.id}@examples.invalid`,
      password_hash: "",
      handle: u.handle,
      bio: u.bio,
      stage_granted: u.stageGranted,
      role: "member",
      paths: J([]),
      contributions: J([]),
      quests: J([]),
      journeys: J({}),
      prefs: J({}),
      is_example: 1,
    });
  }
  return n;
}

export interface SeedOptions {
  /** Health snapshots are stamped relative to this lunation. */
  baseCycle?: number;
  /** Skip the has-real-rows check (the dev seeder wants this). */
  force?: boolean;
}

/**
 * Seed one module's examples. A no-op — quietly, by design — when the module
 * has ever been seeded, has ever been retired, or already holds a real row.
 * Returns the number of rows written.
 */
export async function seedExamples(
  p: Pool,
  moduleId: string,
  seed: any,
  opts: SeedOptions = {},
): Promise<number> {
  const block = seed?.[moduleId];
  if (!block) return 0;
  if (isRetired(moduleId)) return 0;
  if (isSeeded(moduleId) && !opts.force) return 0;
  if (!opts.force && (await hasRealContent(p, moduleId))) {
    // A village with its own content never gets examples layered over it.
    await stamp(p, moduleId, { seeded: false });
    return 0;
  }

  const baseCycle = opts.baseCycle ?? 0;
  // The three identities are shared by every module, so they are created on
  // demand but NOT counted here — otherwise whichever module happens to seed
  // first reports three rows it did not create, and `gratitude`, which seeds
  // nothing at all, claims a row count.
  if (NEEDS_IDENTITIES.has(moduleId)) await seedIdentities(p, seed);
  let n = 0;

  switch (moduleId) {
    case "map":
      for (const c of block.circles ?? []) {
        n += await ins(p, "circles", {
          id: c.id, name: c.name, purpose: c.purpose, aliases: J(c.aliases),
          parent_circle_id: null, lead_role_id: c.leadRoleId, icon: c.icon,
          color: c.color, status: c.status, sort_order: c.sortOrder, is_example: 1,
          // 0083 (P4): examples ship declaring a method, so the decide lens
          // has something to teach before a village says anything.
          decides_by: c.decidesBy ?? null,
        });
      }
      break;

    case "progression":
      for (const r of block.roles ?? []) {
        n += await ins(p, "roles", {
          id: r.id, name: r.name, description: r.description,
          capabilities: J(r.capabilities), min_stage: r.minStage,
          circle_id: r.circleId, seats: r.seats, sort_order: r.sortOrder, is_example: 1,
        });
      }
      // 0049 moved the org chart off the `roles` table, and the map draws
      // `org_roles` now. Without these the empty state this module's examples
      // exist to teach had nothing in it: a fresh fork opened the map and saw
      // circles with no seats at all.
      for (const r of block.orgRoles ?? []) {
        n += await ins(p, "org_roles", {
          id: r.id, name: r.name, circle_id: r.circleId, aim: r.aim,
          domain: r.domain, accountabilities: J(r.accountabilities ?? []),
          why_it_matters: r.whyItMatters ?? null,
          seats: r.seats ?? 1, sort_order: r.sortOrder ?? 0, is_example: 1,
        });
        // A documented holder, never a member: an example seat must never
        // point at a real account, and the identities this module seeds are
        // the example ones.
        for (const h of r.holders ?? []) {
          n += await ins(p, "org_role_assignments", {
            id: `ex-seat-${r.id}-${String(h.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            org_role_id: r.id, holder_kind: "documented", display_name: h.name,
            holder_key: `doc:${String(h.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            focus: h.focus ?? null, is_example: 1,
          });
        }
      }
      break;

    case "quests":
      for (const q of block.quests ?? []) {
        // gratitude_min/max are DERIVED, never authored. shared/questRewards.ts
        // parses the label, here and on every other write path, so an example
        // quest and a real one cannot disagree about what the board advertises.
        const range = parseRewardRange(q.gratitude);
        n += await ins(p, "quests", {
          id: q.id, title: q.title, description: q.description, impact: q.impact,
          gratitude: q.gratitude, gratitude_min: range.min, gratitude_max: range.max,
          duration: q.duration, difficulty: q.difficulty, circle: q.circle,
          status: q.status, icon: q.icon, min_stage: q.minStage ?? null,
          tags: J(q.tags), sort_order: q.sortOrder, is_example: 1,
        });
      }
      break;

    case "forum":
      for (const t of block.threads ?? []) {
        const replies = t.replies ?? [];
        // A conversation that happened in zero seconds convinces nobody.
        // Threads carry daysAgo, replies hoursAfter their thread, and the
        // stamps land in created_at so lists sort the authored order.
        const threadAt = agoDate(t.daysAgo);
        let lastReplyAt: Date | null = null;
        // An event with a hard-coded date goes stale the day after it; the
        // seed declares startsInDays and the date is minted here, always
        // ahead of whoever is looking at it.
        let meta = t.meta ?? null;
        if (meta?.startsInDays !== undefined) {
          const startsAt = new Date(Date.now() + Number(meta.startsInDays) * 86400_000);
          startsAt.setMinutes(0, 0, 0);
          const { startsInDays: _s, durationHours, ...rest } = meta;
          meta = {
            ...rest,
            startsAt: startsAt.toISOString(),
            ...(durationHours
              ? { endsAt: new Date(startsAt.getTime() + Number(durationHours) * 3600_000).toISOString() }
              : {}),
          };
        }
        for (const r of replies) {
          const at = new Date(threadAt.getTime() + Number(r.hoursAfter ?? 24) * 3600_000);
          if (!lastReplyAt || at > lastReplyAt) lastReplyAt = at;
        }
        n += await ins(p, "forum_threads", {
          id: t.id, category: t.category, author_id: t.authorId, title: t.title,
          body: t.body, kind: t.kind, meta: meta ? J(meta) : null,
          heart_count: 0, reply_count: replies.length,
          created_at: threadAt,
          last_reply_at: lastReplyAt,
          pinned_at: t.pinned ? new Date() : null,
          locked_at: t.locked ? new Date() : null,
          is_example: 1,
        });
        for (const tag of t.tags ?? []) {
          await ins(p, "forum_thread_tags", { thread_id: t.id, tag });
        }
        for (const r of replies) {
          n += await ins(p, "forum_replies", {
            id: r.id, thread_id: t.id, author_id: r.authorId,
            parent_reply_id: r.parentReplyId ?? null, body: r.body,
            created_at: new Date(threadAt.getTime() + Number(r.hoursAfter ?? 24) * 3600_000),
            is_example: 1,
          });
        }
      }
      break;

    case "feed":
      // heart_count stays 0: a heart is a real ledger send, and hearting an
      // example is refused, so the cache must never claim otherwise.
      for (const post of block.posts ?? []) {
        n += await ins(p, "forum_threads", {
          id: post.id, category: post.category, author_id: post.authorId,
          title: null, body: post.body, kind: post.kind,
          heart_count: 0, reply_count: 0,
          created_at: agoDate(post.daysAgo),
          is_example: 1,
        });
        for (const tag of post.tags ?? []) {
          await ins(p, "forum_thread_tags", { thread_id: post.id, tag });
        }
      }
      // NO SEEDED EVENTS, deliberately. recentEvents reads
      // `WHERE is_example = 0` and it is right to: the event spine feeds the
      // public Pulse, where seeded copy would read as things that actually
      // happened here. That correct filter also serves the feed's own
      // "village happenings" lane, so a seeded event could never appear
      // anywhere — it was counted as seeded and rendered nowhere.
      break;

    case "tools":
      for (const t of block.tools ?? []) {
        n += await ins(p, "tools", {
          id: t.id, name: t.name, purpose: t.purpose, description: t.description,
          url: t.url, cta_label: t.ctaLabel, category: t.category,
          icon_kind: t.iconKind, icon: t.icon, visibility: t.visibility,
          role_ids: null, getting_started: t.gettingStarted,
          sort_order: t.sortOrder, enabled: t.enabled ? 1 : 0, is_example: 1,
        });
      }
      break;

    case "library":
      // Direct inserts, NOT recordIntake() — intake mints credits to the donor.
      // A direct row raises supply-vs-backing coverage without minting anything.
      for (const c of block.categories ?? []) {
        n += await ins(p, "library_categories", {
          id: c.id, label: c.label, sort_order: c.sortOrder, is_example: 1,
        });
      }
      for (const it of block.items ?? []) {
        n += await ins(p, "library_items", {
          id: it.id, name: it.name, description: it.description,
          category_id: it.categoryId, status: it.status, health_bp: it.healthBp,
          credit_value: it.creditValue, min_stage: it.minStage ?? null,
          donor_user_id: null, is_example: 1,
        });
      }
      break;

    case "stays":
      for (const a of block.accommodations ?? []) {
        n += await ins(p, "accommodations", {
          id: a.id, name: a.name, description: a.description, capacity: a.capacity,
          active: a.active ? 1 : 0, sort_order: a.sortOrder, is_example: 1,
        });
        for (const [i, price] of (a.prices ?? []).entries()) {
          n += await ins(p, "accommodation_prices", {
            id: `${a.id}-price-${i + 1}`, accommodation_id: a.id,
            token_type: price.tokenType, audience: price.audience,
            amount_minor: price.amountMinor, active: 1, is_example: 1,
          });
        }
      }
      break;

    case "commerce":
      for (const prod of block.products ?? []) {
        n += await ins(p, "payment_products", {
          id: prod.id, name: prod.name, description: prod.description, kind: prod.kind,
          amount_minor: prod.amountMinor, min_amount_minor: prod.minAmountMinor,
          recurring: prod.recurring, provider: prod.provider, audience: prod.audience,
          active: prod.active ? 1 : 0, sort_order: prod.sortOrder,
          created_by: EXAMPLE_AUTHOR, is_example: 1,
        });
      }
      break;

    case "badges":
      // Definitions WITH powers, and awards held by example identities, so
      // the page shows the whole arc: what a badge grants, what holding one
      // looks like, what stacking means. Safe because an example award may
      // only ever point at an example user: the award and claim routes both
      // refuse examples, the earned engine skips them, and example users
      // never authenticate — so badgeGrantsFor() never reads these rows for
      // anyone real. Warning badges never get awards: a warning award is
      // open state and would block turning the module off.
      for (const b of block.badges ?? []) {
        // The boot assertion deliberately skips examples (it runs BEFORE the
        // seeder, so a row it rejected would land quietly on one boot and
        // brick the next), which left example definitions validated by
        // nothing at all. Validate here instead, at the seam that already
        // knows how: a definition the platform would refuse to create must
        // not ship as the thing teaching a founder what a badge is. Skipping
        // the badge keeps the fail-soft posture the boot check chose.
        const problem = badgeProblem({
          kind: String(b.kind),
          capabilities: Array.isArray(b.capabilities) ? b.capabilities.map(String) : [],
          denies: Array.isArray(b.denies) ? b.denies.map(String) : [],
          rule: b.rule ?? null,
        });
        if (problem) {
          console.error(`[examples] badge "${b.id}" is not a valid definition, skipping: ${problem}`);
          continue;
        }
        n += await ins(p, "badges", {
          id: b.id, name: b.name, description: b.description, kind: b.kind,
          icon: b.icon ?? null,
          capabilities: J(b.capabilities), denies: J(b.denies),
          rule: b.rule ? J(b.rule) : null, active: b.active ? 1 : 0, is_example: 1,
        });
        // A warning award is open state and would block turning the module
        // off, so warnings never get one. The condition belongs here, at the
        // loop, rather than inside it: it does not depend on the award.
        for (const a of b.kind === "warning" ? [] : b.awards ?? []) {
          n += await ins(p, "badge_awards", {
            id: `ex-award-${b.id}-${a.userId}`, badge_id: b.id, user_id: a.userId,
            count: a.count ?? 1, awarded_by: a.selfClaimed ? a.userId : EXAMPLE_AUTHOR,
            note: a.note ?? null,
            // Minted forward from seed time, like the event date: an absolute
            // expiry would read as already-lapsed a season after anyone wrote
            // it, and a lapsed award is invisible to every read.
            expires_at: a.expiresInDays === undefined
              ? null
              : new Date(Date.now() + Number(a.expiresInDays) * 86400_000),
            // Bylines render FEATURED awards only. No example award set this,
            // so every example member's byline came back empty and the whole
            // wearing-a-badge surface demonstrated nothing.
            featured: a.featured ? 1 : 0,
            is_example: 1,
          });
        }
      }
      break;

    case "health":
      for (const e of block.regenEntries ?? []) {
        n += await ins(p, "regen_entries", {
          id: e.id, metric_key: e.metricKey, value: e.value,
          unit: REGEN_UNITS[e.metricKey] ?? "", note: e.note,
          recorded_by: EXAMPLE_AUTHOR, is_example: 1,
        });
      }
      // NO SEEDED SNAPSHOTS, deliberately. snapshotSeries reads
      // `WHERE is_example = 0` and it is right to: three fabricated lunations
      // would open the honest-sparse trend gate on a village that has closed
      // none. Seeding rows that a correct filter must always hide only makes
      // the boot log lie about how much was seeded — and the ids collided with
      // insertSnapshot's own `snap-<cycle>-<metric>`, so a later real backfill
      // of those cycles was silently swallowed by rows nothing could read.
      // The regen entries above DO render (regenEntries does not filter), and
      // they are what teaches the module.
      break;

    case "resources":
      // A map of rules, never a wallet: every row is a declaration, and the
      // seeder writes the three declaration tables and nothing else.
      for (const r of block.spendingRules ?? []) {
        n += await ins(p, "spending_rules", {
          id: r.id, scope: r.scope, scope_id: r.scopeId,
          amount_minor: r.amountMinor, unit: r.unit,
          approval: r.approval, approval_note: r.approvalNote ?? null,
          paid_from: r.paidFrom, visibility: r.visibility ?? "village",
          note: r.note ?? null, is_example: 1,
        });
      }
      for (const s of block.fundingSources ?? []) {
        n += await ins(p, "funding_sources", {
          id: s.id, name: s.name, kind: s.kind,
          share_pct: s.sharePct ?? null,
          amount_minor_per_year: s.amountMinorPerYear ?? null,
          unit: s.unit ?? null, note: s.note ?? null,
          sort_order: s.sortOrder ?? 0, is_example: 1,
        });
      }
      for (const b of block.circleBudgets ?? []) {
        n += await ins(p, "circle_budgets", {
          id: b.id, circle_id: b.circleId, season_id: b.seasonId ?? null,
          amount_minor: b.amountMinor, unit: b.unit,
          note: b.note ?? null, is_example: 1,
        });
      }
      break;

    case "automation":
      for (const r of block.recordings ?? []) {
        n += await ins(p, "recordings", {
          id: r.id, source: r.source, title: r.title, url: r.url,
          duration_s: r.durationS, status: r.status, is_example: 1,
        });
        if (r.transcript) {
          n += await ins(p, "transcripts", {
            recording_id: r.id,
            body: (r.transcript.segments ?? []).map((s: any) => s.text).join("\n\n"),
            segments: J(r.transcript.segments), source: r.transcript.source,
          });
        }
        const s = r.synthesis;
        if (s) {
          n += await ins(p, "call_syntheses", {
            id: s.id, recording_id: r.id, ai_body: s.aiBody, body: s.body,
            chapters: J(s.chapters), decisions: J(s.decisions), model: s.model,
            dropped_task_count: s.droppedTaskCount, is_example: 1,
          });
          for (const t of s.tasks ?? []) {
            n += await ins(p, "call_tasks", {
              id: t.id, synthesis_id: s.id, description: t.description,
              quote: t.quote, timestamp_ms: t.timestampMs,
              role_id: t.roleId, status: t.status, is_example: 1,
            });
          }
        }
      }
      break;

    case "network":
      for (const s of block.sharedItems ?? []) {
        n += await ins(p, "shared_items", {
          id: s.id, type: s.type, title: s.title, detail: s.detail,
          contact: s.contact, created_by: EXAMPLE_AUTHOR, status: s.status, is_example: 1,
        });
      }
      for (const peer of block.peers ?? []) {
        n += await ins(p, "peer_instances", {
          id: peer.id, instance_id: peer.instanceId, base_url: peer.baseUrl,
          name: peer.name, version: peer.version, added_by: EXAMPLE_AUTHOR,
          status: peer.status, is_example: 1,
        });
        // Cache item dates are seeded as daysAgo and minted here: an absolute
        // date reads as weeks-stale the month after anyone writes it.
        const cache = peer.cache
          ? {
              ...peer.cache,
              items: (peer.cache.items ?? []).map((it: any) => {
                const { daysAgo, ...rest } = it;
                return { ...rest, createdAt: agoDate(daysAgo).toISOString() };
              }),
            }
          : peer.cache;
        n += await ins(p, "peer_shared_cache", { peer_id: peer.id, payload: J(cache) });
      }
      break;

    case "exchange":
      // A working-looking market: example TOKENS of the platform's own kinds,
      // listed and priced, with a display-only stock number. The ledger is
      // never touched — an example token has NO ledger rows, so conservation
      // holds trivially, and the buy route refuses the example before any
      // stock logic runs. The first real token an admin creates or lists
      // retires the whole set.
      for (const t of block.tokens ?? []) {
        n += await ins(p, "tokens", {
          slug: t.slug, name: t.name, kind: t.kind, governance: "platform",
          transferable: t.transferable ? 1 : 0, active: 1,
          sort_order: t.sortOrder ?? 90, is_example: 1,
        });
      }
      if ((block.tokens ?? []).length) {
        // The registry is a boot-loaded memory map; the new tokens must
        // resolve for their listings to render names on the page.
        await loadTokenRegistry(p as Pool);
      }
      for (const l of block.listings ?? []) {
        const [[tok]] = await p.query<RowDataPacket[]>(
          "SELECT slug FROM tokens WHERE slug = ?", [l.tokenSlug],
        );
        if (!tok) {
          console.log(`[examples] exchange: token "${l.tokenSlug}" absent, skipping listing`);
          continue;
        }
        n += await ins(p, "token_exchange_settings", {
          token_slug: l.tokenSlug, purchasable: l.purchasable ? 1 : 0,
          swappable: l.swappable ? 1 : 0, active: l.active ? 1 : 0,
          sort_order: l.sortOrder, min_stage_to_buy: l.minStageToBuy,
          example_stock: l.exampleStock ?? null, is_example: 1,
        });
        for (const [i, price] of (l.prices ?? []).entries()) {
          n += await ins(p, "currency_prices", {
            id: `ex-price-${l.tokenSlug}-${i + 1}`, token_slug: l.tokenSlug,
            price_minor: price.priceMinor, note: price.note,
            set_by: EXAMPLE_AUTHOR, is_example: 1,
          });
        }
      }
      break;

    /*
     * Gratitude seeds VOICES and never entries.
     *
     * `block.entries` stays empty forever and the seed file says so at length:
     * a gratitude row posts to the ledger at creation, so an example send would
     * either mint real recognition or break conservation. Nothing below reads
     * that key, and it is left in the seed as the place that refusal is
     * recorded rather than deleted and forgotten.
     *
     * A voice is the part that was always safe. No sender, no recipient, no
     * amount, so no ledger row and nothing for a settlement to count.
     */
    case "gratitude":
      for (const [i, v] of (block.voices ?? []).entries()) {
        n += await ins(p, "gratitude_voices", {
          id: v.id,
          message: v.message,
          // The set is composed, not chronological: the order they are read in
          // is a choice about which kind of care a founder meets first, so it
          // is carried explicitly and never left to insert order.
          sort_order: i,
          is_example: 1,
        });
      }
      break;

    // profiles seeds nothing, on purpose: a profile belongs to its owner.
    default:
      break;
  }

  await stamp(p, moduleId, { seeded: true });
  await refreshRowPresence(p, moduleId);
  // Seeding writes raw rows, which the memory-cached collections cannot see.
  // Boot seeding runs after initStores, and enable-time seeding runs against a
  // long-warm cache, so without this the examples exist and never appear.
  if (n && reloadCaches) {
    try {
      await reloadCaches(EXAMPLE_TABLES[moduleId] ?? []);
    } catch (e) {
      console.error(`[examples] cache reload after seeding "${moduleId}" failed`, e);
    }
  }
  if (n) console.log(`[examples] seeded ${n} example row(s) for "${moduleId}"`);
  return n;
}

async function stamp(p: Pool, moduleId: string, o: { seeded: boolean }): Promise<void> {
  await p.query(
    "INSERT INTO example_state (module_id, seeded_at) VALUES (?, ?) " +
      "ON DUPLICATE KEY UPDATE seeded_at = VALUES(seeded_at)",
    [moduleId, o.seeded ? new Date() : null],
  );
  const prev = state.get(moduleId) ?? EMPTY_STATE;
  state.set(moduleId, { ...prev, seededAt: o.seeded ? new Date().toISOString() : null });
}

/**
 * Does this module already hold content the village made itself? Examples are
 * never layered over real content, and a module that already has real rows is
 * marked decided-without-seeding so the check runs once, not on every boot.
 */
export async function hasRealContent(p: Pool, moduleId: string): Promise<boolean> {
  if (await ownRealContent(p, moduleId)) return true;
  // SEEDING IS SYMMETRIC WITH RETIREMENT. Modules that retire together share a
  // table and a category, so neither read path can tell their rows apart — and
  // that cuts both ways. forum's check is the whole of forum_threads while
  // feed's is one category, so a real thread in `governance` made forum
  // decided-without-seeding while feed happily seeded ex-feed-1..3 into the
  // shared category: platform fiction on the forum's "All" tab under no
  // banner at all, which is exactly what RETIRE_TOGETHER exists to prevent.
  // Asking the pair means both seed or neither does.
  for (const id of RETIRE_TOGETHER[moduleId] ?? []) {
    if (await ownRealContent(p, id)) return true;
  }
  return false;
}

/** One module's own answer, before the retire-together union. */
async function ownRealContent(p: Pool, moduleId: string): Promise<boolean> {
  const custom = REAL_CONTENT_CHECK[moduleId];
  if (custom) {
    try { return await custom(p); } catch { return false; }
  }
  for (const table of EXAMPLE_TABLES[moduleId] ?? []) {
    if (BY_PARENT[table] || NOT_EVIDENCE_OF_REAL_CONTENT.has(table)) continue;
    try {
      const [[r]] = await p.query<RowDataPacket[]>(
        `SELECT COUNT(*) n FROM \`${table}\` WHERE is_example = 0`,
      );
      if (Number(r.n) > 0) return true;
    } catch {
      // A module whose table does not exist yet simply has no real content.
    }
  }
  return false;
}

/**
 * Delete every example row for a module and stamp the permanent tombstone.
 *
 * Called from exactly two places: a module's own create path AFTER a real row
 * commits, and the admin clear endpoint. After the write, never before — a
 * failed create must not retire anything.
 *
 * Deliberately forgiving: retirement is housekeeping riding on someone else's
 * successful write, and it must never turn their 201 into a 500.
 */
/** The delete loop shared by retirement and refresh: every example row for a
 *  module, child tables first, scoped where two modules share a table. */
async function deleteExampleRows(
  p: Pool,
  moduleId: string,
): Promise<{ removed: number; failed: boolean }> {
  let removed = 0;
  let failed = false;
  // Release any REAL row still pointing at an example we are about to
  // delete. The library's admin intake picker offers every shelf, example
  // ones included, so the founder's first real donation is usually filed
  // under "Power tools" — and that same request triggers this retirement.
  // category_id carries no FK constraint, so the delete would succeed and
  // leave their item pointing at a shelf that no longer exists, permanently
  // uncategorised and unfilable.
  if (moduleId === "library") {
    await p.query(
      "UPDATE library_items SET category_id = NULL WHERE is_example = 0 AND category_id IN " +
        "(SELECT id FROM library_categories WHERE is_example = 1)",
    ).catch(() => { /* older forks without the column */ });
  }
  // Belt and braces on the one table whose deletion can refuse the NEXT boot.
  // checkLedgerInvariants fails loud on "ledger rows exist for unregistered
  // token", so removing a registry row that has transfers behind it turns a
  // founder's first real listing into a deployment that will not start. Every
  // write door onto an example token now refuses, and this is what holds if
  // one is ever missed or a row is hand-edited: leave the token, report the
  // failure, and let the unstamped tombstone retry.
  if (moduleId === "exchange") {
    const [stuck] = await p.query<RowDataPacket[]>(
      "SELECT DISTINCT t.slug FROM tokens t JOIN token_ledger l ON l.token_type = t.slug WHERE t.is_example = 1",
    ).catch(() => [[]] as any);
    for (const r of stuck as RowDataPacket[]) {
      failed = true;
      console.error(
        `[examples] example token "${r.slug}" has ledger rows; leaving the registry row in place ` +
          "so the ledger invariants still hold, and not stamping the tombstone",
      );
    }
  }
  for (const table of EXAMPLE_TABLES[moduleId] ?? []) {
    const parent = BY_PARENT[table];
    try {
      if (parent) {
        const [r] = await p.query<any>(
          `DELETE FROM \`${table}\` WHERE \`${parent.fk}\` IN ` +
            `(SELECT \`${parent.parentKey}\` FROM \`${parent.parentTable}\` WHERE is_example = 1)`,
        );
        removed += r?.affectedRows ?? 0;
      } else {
        const scope = scopeFor(moduleId, table);
        const widen = WIDEN[moduleId]?.[table];
        let where = `(is_example = 1${scope ? ` AND ${scope}` : ""}${widen ? `) OR (${widen}` : ""})`;
        if (KEEP_IF_IN_LEDGER[moduleId] === table) {
          where = `(${where}) AND slug NOT IN (SELECT DISTINCT token_type FROM token_ledger)`;
        }
        const [r] = await p.query<any>(`DELETE FROM \`${table}\` WHERE ${where}`);
        removed += r?.affectedRows ?? 0;
      }
    } catch (e: any) {
      // A table or column this fork does not have is not a failure; anything
      // else is, and must not be papered over with a tombstone.
      const benign = e?.code === "ER_NO_SUCH_TABLE" || e?.code === "ER_BAD_FIELD_ERROR";
      if (!benign) failed = true;
      console.error(`[examples] could not clear ${table} for "${moduleId}"`, e);
    }
  }
  return { removed, failed };
}

/**
 * Replace a module's SHOWING examples with the current seed, without touching
 * the tombstone. For live instances that seeded an older revision of the
 * content: delete-and-reseed, only while the module is still demonstrating.
 * A retired module stays retired; a module whose village has real content is
 * untouched (its examples are already gone or were never seeded).
 */
export async function refreshExamples(
  p: Pool,
  moduleId: string,
  seed: any,
  opts: { baseCycle?: number } = {},
): Promise<number> {
  if (!isSeeded(moduleId) || isRetired(moduleId)) return 0;
  const { failed } = await deleteExampleRows(p, moduleId);
  if (failed) {
    console.error(`[examples] refresh of "${moduleId}" aborted: old rows not fully cleared`);
    return 0;
  }
  const n = await seedExamples(p, moduleId, seed, { force: true, baseCycle: opts.baseCycle });
  console.log(`[examples] refreshed "${moduleId}" to the current seed (${n} row(s))`);
  return n;
}

/**
 * What retirement actually did. `retired` is the tombstone: a partial `removed`
 * count on a failed pass is indistinguishable from a clean sweep by number
 * alone, and the admin clear endpoint was reporting the failure as success —
 * "3 example row(s) cleared" over three rows still on the page.
 */
export interface RetireOutcome {
  removed: number;
  retired: boolean;
}

export async function retireExamples(
  p: Pool,
  moduleId: string,
  reason: RetireReason,
  byUserId: string | null = null,
): Promise<RetireOutcome> {
  if (isRetired(moduleId)) return { removed: 0, retired: true };
  const attempts = state.get(moduleId)?.retireAttempts ?? 0;
  if (reason === "first_real_item" && attempts >= RETIRE_CEILING) {
    return { removed: 0, retired: false };
  }
  let removed = 0;
  /** A DELETE that failed for a real reason — not a table this fork lacks. */
  let failed = false;
  try {
    const cleared = await deleteExampleRows(p, moduleId);
    removed = cleared.removed;
    failed = cleared.failed;
    // The tombstone is permanent and short-circuits every later attempt,
    // including the admin clear button. Stamping it after a failed DELETE
    // would strand the surviving rows with no removal path but hand-written
    // SQL, while the module reported examplesRetired = true. Leave it unset so
    // the next trigger retries.
    if (failed) {
      // Only the AUTOMATIC path is governed by the ceiling, so only the
      // automatic path may count against it. Counting an admin_cleared failure
      // let five unlucky presses of the escape hatch switch off the
      // first_real_item trigger for good, while the button that did it is
      // documented as ignoring the ceiling precisely because it IS the person.
      if (reason === "first_real_item") await countRetireFailure(p, moduleId, attempts + 1);
      if (reason === "first_real_item" && attempts + 1 >= RETIRE_CEILING) {
        console.error(
          `[examples] retiring "${moduleId}" has left rows behind ${attempts + 1} times; the automatic ` +
            "trigger is giving up. Fix the rows, then use Admin -> Modules -> Clear examples",
        );
      } else {
        console.error(`[examples] retiring "${moduleId}" left rows behind; not stamping the tombstone so it can retry`);
      }
      return { removed, retired: false };
    }
    // Orphaned tag rows would otherwise outlive their threads.
    if (moduleId === "forum" || moduleId === "feed") {
      await p.query(
        "DELETE FROM forum_thread_tags WHERE thread_id NOT IN (SELECT id FROM forum_threads)",
      ).catch(() => {});
    }
    await p.query(
      "INSERT INTO example_state (module_id, retired_at, retired_reason, retired_by) " +
        "VALUES (?, NOW(), ?, ?) ON DUPLICATE KEY UPDATE " +
        "retired_at = VALUES(retired_at), retired_reason = VALUES(retired_reason), " +
        "retired_by = VALUES(retired_by)",
      [moduleId, reason, byUserId],
    );
    const prev = state.get(moduleId) ?? EMPTY_STATE;
    state.set(moduleId, {
      ...prev, retiredAt: new Date().toISOString(), retiredReason: reason, retireAttempts: 0,
    });
    withRows.delete(moduleId);
    // The identities are shared, so they can only go once the last module that
    // could still be displaying their words has retired. Removing them earlier
    // would leave surviving example threads with an author nobody can resolve.
    await refreshRowPresence(p);
    if (withRows.size === 0) {
      const [r] = await p.query<any>("DELETE FROM users WHERE is_example = 1");
      if (r?.affectedRows) {
        console.log(`[examples] removed ${r.affectedRows} example identity/identities`);
      }
    }
    // Without this the rows are gone from MySQL and still on the page.
    if (reloadCaches) {
      try {
        await reloadCaches(EXAMPLE_TABLES[moduleId] ?? []);
      } catch (e) {
        console.error(`[examples] cache reload after retiring "${moduleId}" failed`, e);
      }
    }
    if (removed) {
      console.log(`[examples] retired ${removed} example row(s) for "${moduleId}" (${reason})`);
    }
  } catch (e) {
    console.error(`[examples] retiring "${moduleId}" failed (continuing)`, e);
    if (reason === "first_real_item") await countRetireFailure(p, moduleId, attempts + 1);
    return { removed, retired: false };
  }
  return { removed, retired: true };
}

/** Record one unsuccessful pass, so the automatic trigger can stop trying. */
async function countRetireFailure(p: Pool, moduleId: string, attempts: number): Promise<void> {
  const prev = state.get(moduleId) ?? EMPTY_STATE;
  state.set(moduleId, { ...prev, retireAttempts: attempts });
  await p.query(
    "INSERT INTO example_state (module_id, retire_attempts) VALUES (?, ?) " +
      "ON DUPLICATE KEY UPDATE retire_attempts = VALUES(retire_attempts)",
    [moduleId, attempts],
  ).catch(() => { /* a fork that has not run 0048 yet still retries in memory */ });
}

/**
 * The one call a module's create path makes after a real row commits. Fire and
 * forget — the caller's response must not wait on housekeeping, and must not
 * fail because of it.
 */
/**
 * Modules that must retire TOGETHER because they share a physical table AND a
 * category, so neither read path can tell them apart.
 *
 * The feed is a lens over `forum_threads`, both modules' examples sit in the
 * feed's category, and both list queries are category-wide (the forum's "All"
 * tab sends no category at all). Retiring one alone therefore deleted its own
 * rows, dropped its banner — and left the OTHER module's examples rendering on
 * the same page with no banner and no row-level marker. That is a worse bug
 * than the cross-deletion the scoping was added to fix: unlabelled platform
 * fiction presented as village content.
 *
 * Scoping still earns its keep — each module deletes only its own rows and
 * stamps its own tombstone — but the two tombstones are stamped together.
 */
const RETIRE_TOGETHER: Record<string, string[]> = {
  forum: ["feed"],
  feed: ["forum"],
};

/** Every module that must retire when `moduleId` does, itself included. */
export function retiresWith(moduleId: string): string[] {
  return [moduleId, ...(RETIRE_TOGETHER[moduleId] ?? [])];
}

/**
 * Retire a module AND whatever must go with it, awaited, with one combined
 * answer.
 *
 * The pair rule used to live inside `onRealItemPublished` alone, so the admin
 * clear button retired exactly the module its label named — and clearing the
 * forum left the feed's three example threads rendering on the forum's "All"
 * tab with the banner already gone. Unlabelled platform fiction presented as
 * village content is the failure the pairing exists to prevent, and the button
 * is not exempt from it.
 *
 * `retired` is the AND of the passes: a partial sweep must not report success,
 * because the tombstone is what the caller acts on.
 */
export async function retireExamplesWithPair(
  p: Pool,
  moduleId: string,
  reason: RetireReason,
  byUserId: string | null = null,
): Promise<RetireOutcome> {
  let removed = 0;
  let retired = true;
  for (const id of retiresWith(moduleId)) {
    // A module that never seeded has nothing to retire and no tombstone to
    // owe: stamping one would only forbid a later, legitimate seeding.
    if (!isSeeded(id)) continue;
    const outcome = await retireExamples(p, id, reason, byUserId);
    removed += outcome.removed;
    if (!outcome.retired) retired = false;
  }
  return { removed, retired };
}

/**
 * Modules that retire on a threshold of their own instead of on the FIRST real
 * item, and the one module that needs it.
 *
 * Rule 3 of the contract is "the first real item retires the module", and for
 * eleven of the twelve modules that is exactly right: one real quest, one real
 * library item, and the founder has spoken for themselves in that surface.
 *
 * The Gratitude wall is the exception, and the shape of the surface is why.
 * Its examples are not a list a founder replaces one row at a time, they are
 * the HERO: a composed set of voices that opens the page. Retiring all of them
 * on the first real send would take a village from sixteen voices to exactly
 * one, on the day the thing starts working, and the page would get visibly
 * worse at the moment it first succeeded. That is a cliff, and the honest
 * shape is a crossfade: real voices take the hero's slots as they arrive,
 * labelled examples hold whatever is left, and the last example leaves when
 * the village can fill the hero on its own.
 *
 * It stays one-way and it stays permanent. This moves WHEN the tombstone is
 * stamped and changes nothing about what stamping means, so a village that has
 * spoken for itself is still never talked over again.
 *
 * A predicate that throws is treated as "not yet" rather than as "retire":
 * failing closed here leaves labelled examples standing for one more send,
 * while failing open would delete a village's hero on a transient error.
 */
const RETIRE_WHEN: Record<string, (p: Pool) => Promise<boolean>> = {
  gratitude: async (p) => (await realVoiceCount(p)) >= HERO_SLOTS,
};


export function onRealItemPublished(p: Pool, moduleId: string, byUserId: string | null = null): void {
  for (const id of retiresWith(moduleId)) {
    if (isRetired(id) || !isSeeded(id)) continue;
    const when = RETIRE_WHEN[id];
    if (!when) {
      void retireExamples(p, id, "first_real_item", byUserId);
      continue;
    }
    void (async () => {
      let ready = false;
      try {
        ready = await when(p);
      } catch {
        // Not yet. See the block above for why this direction is the safe one.
        return;
      }
      if (ready) await retireExamples(p, id, "first_real_item", byUserId);
    })();
  }
}

/**
 * Is this row a standing example?
 *
 * Asks the table directly rather than trusting whatever object a module's
 * mapper handed back. Most domain libraries build their records from an
 * explicit column list, so a new column does not reach them, and a guard that
 * silently reads `undefined` is a guard that never fires. One extra query on a
 * mutation path is the right price for that.
 */
export async function isExampleRow(
  p: Pool,
  table: string,
  id: string,
  idColumn = "id",
): Promise<boolean> {
  if (!id) return false;
  try {
    const [[row]] = await p.query<RowDataPacket[]>(
      `SELECT is_example FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
      [id],
    );
    return !!row && Number(row.is_example) === 1;
  } catch {
    // A missing column or table means the concept does not apply here, and a
    // guard that cannot answer must not block a real member's action.
    return false;
  }
}

/**
 * The identities that author example content. Excluded from the member
 * directory, launch counts, gratitude eligibility and badge evaluation — they
 * are content, not people, and every metric that counts humans must skip them.
 */
export function isExampleUser(u: Record<string, any> | null | undefined): boolean {
  return !!u && (u.isExample === true || u.isExample === 1);
}

/** SQL fragment for the many queries that must not count example members. */
export const NOT_EXAMPLE = "is_example = 0";
