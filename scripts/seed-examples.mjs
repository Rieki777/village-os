#!/usr/bin/env -S npx tsx
/**
 * Seed standing examples into a target schema.
 *
 *   npx tsx scripts/seed-examples.mjs --url "mysql://user:pass@host:port/schema"
 *   npx tsx scripts/seed-examples.mjs --url "..." --module library
 *   npx tsx scripts/seed-examples.mjs --url "..." --clear
 *
 * RUN IT UNDER tsx, NOT plain node. It imports the reward parser from
 * shared/questRewards.ts, and node cannot resolve a TypeScript module: under
 * `node` this script now dies at import with ERR_MODULE_NOT_FOUND. That is
 * deliberate and it is the cheaper failure. It used to carry its own copy of
 * the parser, which disagreed with the shared one about range ordering,
 * negative clamping and truncation, and wrote bounds no error ever mentioned.
 * A loud import error beats a quiet wrong number in the database.
 * `measure:provisioning` already runs an .mjs under tsx the same way.
 *
 * Every row written here carries is_example = 1 and is INERT: nothing in this
 * script touches the ledger, escrow, Stripe, or the capability gate. The unsafe
 * paths are deliberately not used — library intake mints credits to the donor,
 * so items are inserted directly; a gratitude send posts a ledger leg, so the
 * gratitude module seeds nothing at all.
 *
 * This is the dev/demo entry point. The shipped path calls the same content
 * through the module-enable hook (docs/STANDING_EXAMPLES.md).
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRewardRange } from "../shared/questRewards";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(__dirname, "..", "server", "seeds", "examples-seed.json");

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const URL_ = arg("url", process.env.DATABASE_URL);
if (!URL_) {
  console.error("need --url or DATABASE_URL");
  process.exit(2);
}
const ONLY = arg("module");
const CLEAR = has("clear");

/** Cycle numbers for the health snapshot series; three lunations unlock trends. */
const BASE_CYCLE = Number(arg("base-cycle", "328"));

const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
const EXAMPLE_AUTHOR = "ex-user-mira";

/** Units are taken from the registry, never from seed data — MAX(unit) labels
 *  the totals tile and a wrong unit poisons it. */
const REGEN_UNITS = {
  trees_planted: "trees",
  hectares_restored: "ha",
  food_produced_kg: "kg",
  water_protected_liters: "liters",
  carbon_sequestered_kg: "kg",
};

const conn = await mysql.createConnection({ uri: URL_, timezone: "Z", multipleStatements: false });
const J = (v) => JSON.stringify(v ?? null);
let written = 0;

/** INSERT IGNORE everywhere: re-running is a no-op, never a duplicate. */
async function ins(table, row) {
  const cols = Object.keys(row);
  const sql =
    `INSERT IGNORE INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")}) ` +
    `VALUES (${cols.map(() => "?").join(",")})`;
  const [r] = await conn.query(sql, Object.values(row));
  written += r.affectedRows ?? 0;
  return r;
}

const EXAMPLE_TABLES = [
  "forum_replies", "forum_threads", "call_tasks", "call_syntheses", "transcripts",
  "recordings", "accommodation_prices", "accommodations", "library_items",
  "library_categories", "payment_products", "badges", "regen_entries",
  "health_snapshots", "health_events", "shared_items", "peer_instances",
  "currency_prices", "token_exchange_settings", "tools", "quests", "roles",
  "circles", "gratitude_log", "users",
];

if (CLEAR) {
  for (const t of EXAMPLE_TABLES) {
    try {
      const [r] = await conn.query(`DELETE FROM \`${t}\` WHERE is_example = 1`);
      if (r.affectedRows) console.log(`  cleared ${r.affectedRows} from ${t}`);
    } catch (e) {
      if (e.code !== "ER_NO_SUCH_TABLE" && e.code !== "ER_BAD_FIELD_ERROR") throw e;
    }
  }
  await conn.query("DELETE FROM `example_state`");
  console.log("examples cleared");
  await conn.end();
  process.exit(0);
}

const want = (m) => !ONLY || ONLY === m;
const stamp = async (m) =>
  conn.query(
    "INSERT INTO `example_state` (module_id, seeded_at) VALUES (?, NOW()) " +
      "ON DUPLICATE KEY UPDATE seeded_at = VALUES(seeded_at)",
    [m],
  );

// ── Identities ───────────────────────────────────────────────────────────────
// No password_hash, so these can never log in. Excluded from the member
// directory, launch counts, gratitude eligibility and badge evaluation.
for (const u of seed._identities.users) {
  await ins("users", {
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

// ── map ──────────────────────────────────────────────────────────────────────
if (want("map")) {
  for (const c of seed.map.circles) {
    await ins("circles", {
      id: c.id, name: c.name, purpose: c.purpose, aliases: J(c.aliases),
      parent_circle_id: null, lead_role_id: c.leadRoleId, icon: c.icon,
      color: c.color, status: c.status, sort_order: c.sortOrder, is_example: 1,
    });
  }
  await stamp("map");
}

// ── progression (roles) ──────────────────────────────────────────────────────
if (want("progression")) {
  for (const r of seed.progression.roles) {
    await ins("roles", {
      id: r.id, name: r.name, description: r.description,
      capabilities: J(r.capabilities), min_stage: r.minStage,
      circle_id: r.circleId, seats: r.seats, sort_order: r.sortOrder, is_example: 1,
    });
  }
  await stamp("progression");
}

// ── quests ───────────────────────────────────────────────────────────────────
if (want("quests")) {
  for (const q of seed.quests.quests) {
    // gratitude_min/max are DERIVED, never authored: parseRewardRange is the
    // parser, the same one server/lib/examples.ts and server/repos/quests.ts
    // use, so this script and the shipped path write identical bounds.
    const r = parseRewardRange(q.gratitude);
    await ins("quests", {
      id: q.id, title: q.title, description: q.description, impact: q.impact,
      gratitude: q.gratitude, gratitude_min: r.min, gratitude_max: r.max,
      duration: q.duration, difficulty: q.difficulty, circle: q.circle,
      status: q.status, icon: q.icon, min_stage: q.minStage ?? null,
      tags: J(q.tags), sort_order: q.sortOrder, is_example: 1,
    });
  }
  await stamp("quests");
}

// ── forum ────────────────────────────────────────────────────────────────────
if (want("forum")) {
  for (const t of seed.forum.threads) {
    const replies = t.replies ?? [];
    await ins("forum_threads", {
      id: t.id, category: t.category, author_id: t.authorId, title: t.title,
      body: t.body, kind: t.kind, meta: t.meta ? J(t.meta) : null,
      heart_count: 0, reply_count: replies.length,
      last_reply_at: replies.length ? new Date() : null,
      pinned_at: t.pinned ? new Date() : null,
      locked_at: t.locked ? new Date() : null,
      is_example: 1,
    });
    for (const tag of t.tags ?? []) {
      await ins("forum_thread_tags", { thread_id: t.id, tag });
    }
    for (const r of replies) {
      await ins("forum_replies", {
        id: r.id, thread_id: t.id, author_id: r.authorId,
        parent_reply_id: r.parentReplyId ?? null, body: r.body, is_example: 1,
      });
    }
  }
  await stamp("forum");
}

// ── feed (a lens over forum_threads; hearts stay 0 — a heart is a ledger send)
if (want("feed")) {
  for (const p of seed.feed.posts) {
    await ins("forum_threads", {
      id: p.id, category: p.category, author_id: p.authorId, title: null,
      body: p.body, kind: p.kind, heart_count: 0, reply_count: 0, is_example: 1,
    });
    for (const tag of p.tags ?? []) await ins("forum_thread_tags", { thread_id: p.id, tag });
  }
  for (const [i, e] of (seed.feed.events ?? []).entries()) {
    await ins("health_events", {
      id: `ex-event-${i + 1}`, kind: e.kind, text: e.text,
      audience: e.audience, is_example: 1,
    });
  }
  await stamp("feed");
}

// ── tools ────────────────────────────────────────────────────────────────────
if (want("tools")) {
  for (const t of seed.tools.tools) {
    await ins("tools", {
      id: t.id, name: t.name, purpose: t.purpose, description: t.description,
      url: t.url, cta_label: t.ctaLabel, category: t.category,
      icon_kind: t.iconKind, icon: t.icon, visibility: t.visibility,
      role_ids: null, getting_started: t.gettingStarted,
      sort_order: t.sortOrder, enabled: t.enabled ? 1 : 0, is_example: 1,
    });
  }
  await stamp("tools");
}

// ── library ──────────────────────────────────────────────────────────────────
// Direct inserts, NOT recordIntake() — intake mints credits to the donor.
// A direct row raises supply-vs-backing coverage without minting anything.
if (want("library")) {
  for (const c of seed.library.categories) {
    await ins("library_categories", { id: c.id, label: c.label, sort_order: c.sortOrder, is_example: 1 });
  }
  for (const it of seed.library.items) {
    await ins("library_items", {
      id: it.id, name: it.name, description: it.description,
      category_id: it.categoryId, status: it.status, health_bp: it.healthBp,
      credit_value: it.creditValue, min_stage: it.minStage ?? null,
      donor_user_id: null, is_example: 1,
    });
  }
  await stamp("library");
}

// ── stays ────────────────────────────────────────────────────────────────────
if (want("stays")) {
  for (const a of seed.stays.accommodations) {
    await ins("accommodations", {
      id: a.id, name: a.name, description: a.description, capacity: a.capacity,
      active: a.active ? 1 : 0, sort_order: a.sortOrder, is_example: 1,
    });
    for (const [i, p] of a.prices.entries()) {
      // The twin of server/lib/examples.ts: a token price is seeded in WHOLE
      // credits and scaled by that token's decimals in THIS database, and a
      // usd price is already cents. An unregistered token reads as zero
      // decimals, the registry's own default.
      let stored = Math.floor(Number(p.amountMinor) || 0);
      if (p.tokenType !== "usd") {
        const [[tok]] = await conn.query("SELECT decimals FROM tokens WHERE slug = ?", [p.tokenType]);
        const whole = Math.floor(Number(p.amount ?? p.amountMinor) || 0);
        stored = whole * 10 ** Math.max(0, Math.trunc(Number(tok?.decimals ?? 0)));
      }
      await ins("accommodation_prices", {
        id: `${a.id}-price-${i + 1}`, accommodation_id: a.id,
        token_type: p.tokenType, audience: p.audience,
        amount_minor: stored, active: 1, is_example: 1,
      });
    }
  }
  await stamp("stays");
}

// ── commerce ─────────────────────────────────────────────────────────────────
if (want("commerce")) {
  for (const p of seed.commerce.products) {
    await ins("payment_products", {
      id: p.id, name: p.name, description: p.description, kind: p.kind,
      amount_minor: p.amountMinor, min_amount_minor: p.minAmountMinor,
      recurring: p.recurring, provider: p.provider, audience: p.audience,
      active: p.active ? 1 : 0, sort_order: p.sortOrder,
      created_by: EXAMPLE_AUTHOR, is_example: 1,
    });
  }
  await stamp("commerce");
}

// ── badges ───────────────────────────────────────────────────────────────────
// Definitions only. No award rows, ever — a definition grants nothing without
// one, and assertBadgeInvariants refuses boot on an unknown capability key.
if (want("badges")) {
  for (const b of seed.badges.badges) {
    await ins("badges", {
      id: b.id, name: b.name, description: b.description, kind: b.kind,
      capabilities: J(b.capabilities), denies: J(b.denies),
      rule: b.rule ? J(b.rule) : null, active: b.active ? 1 : 0, is_example: 1,
    });
  }
  await stamp("badges");
}

// ── health ───────────────────────────────────────────────────────────────────
if (want("health")) {
  for (const e of seed.health.regenEntries) {
    await ins("regen_entries", {
      id: e.id, metric_key: e.metricKey, value: e.value,
      unit: REGEN_UNITS[e.metricKey] ?? "", note: e.note,
      recorded_by: EXAMPLE_AUTHOR, is_example: 1,
    });
  }
  for (const c of seed.health.snapshots.cycles) {
    const n = BASE_CYCLE + c.cycleNumber;
    for (const [key, value] of Object.entries(c)) {
      if (key === "cycleNumber") continue;
      await ins("health_snapshots", {
        id: `snap-${n}-${key}`, cycle_number: n, metric_key: key,
        value, is_example: 1,
      });
    }
  }
  await stamp("health");
}

// ── automation ───────────────────────────────────────────────────────────────
if (want("automation")) {
  for (const r of seed.automation.recordings) {
    await ins("recordings", {
      id: r.id, source: r.source, title: r.title, url: r.url,
      duration_s: r.durationS, status: r.status, is_example: 1,
    });
    if (r.transcript) {
      await ins("transcripts", {
        recording_id: r.id,
        body: r.transcript.segments.map((s) => s.text).join("\n\n"),
        segments: J(r.transcript.segments), source: r.transcript.source,
      });
    }
    const s = r.synthesis;
    if (s) {
      await ins("call_syntheses", {
        id: s.id, recording_id: r.id, ai_body: s.aiBody, body: s.body,
        chapters: J(s.chapters), decisions: J(s.decisions), model: s.model,
        dropped_task_count: s.droppedTaskCount, is_example: 1,
      });
      for (const t of s.tasks ?? []) {
        await ins("call_tasks", {
          id: t.id, synthesis_id: s.id, description: t.description,
          quote: t.quote, timestamp_ms: t.timestampMs,
          role_id: t.roleId, status: t.status, is_example: 1,
        });
      }
    }
  }
  await stamp("automation");
}

// ── network ──────────────────────────────────────────────────────────────────
if (want("network")) {
  for (const s of seed.network.sharedItems) {
    await ins("shared_items", {
      id: s.id, type: s.type, title: s.title, detail: s.detail,
      contact: s.contact, created_by: EXAMPLE_AUTHOR, status: s.status, is_example: 1,
    });
  }
  for (const p of seed.network.peers) {
    await ins("peer_instances", {
      id: p.id, instance_id: p.instanceId, base_url: p.baseUrl, name: p.name,
      version: p.version, added_by: EXAMPLE_AUTHOR, status: p.status, is_example: 1,
    });
    await ins("peer_shared_cache", { peer_id: p.id, payload: J(p.cache) });
  }
  await stamp("network");
}

// ── exchange ─────────────────────────────────────────────────────────────────
// A listing and a posted price, both display-only. The treasury is deliberately
// NOT stocked, so even without the inert guard a purchase refuses out-of-stock
// rather than minting.
if (want("exchange")) {
  for (const l of seed.exchange.listings) {
    const [[tok]] = await conn.query("SELECT slug FROM `tokens` WHERE slug = ?", [l.tokenSlug]);
    if (!tok) {
      console.log(`  ! exchange: token "${l.tokenSlug}" not in registry, skipping listing`);
      continue;
    }
    await ins("token_exchange_settings", {
      token_slug: l.tokenSlug, purchasable: l.purchasable ? 1 : 0,
      swappable: l.swappable ? 1 : 0, active: l.active ? 1 : 0,
      sort_order: l.sortOrder, min_stage_to_buy: l.minStageToBuy, is_example: 1,
    });
    for (const [i, p] of l.prices.entries()) {
      await ins("currency_prices", {
        id: `ex-price-${l.tokenSlug}-${i + 1}`, token_slug: l.tokenSlug,
        price_minor: p.priceMinor, note: p.note, set_by: EXAMPLE_AUTHOR, is_example: 1,
      });
    }
  }
  await stamp("exchange");
}

// gratitude and profiles seed nothing on purpose — see examples-seed.json.
await stamp("gratitude");
await stamp("profiles");

const [[{ n }]] = await conn.query("SELECT COUNT(*) n FROM `example_state` WHERE seeded_at IS NOT NULL");
console.log(`\nseeded ${written} example rows across ${n} modules`);
await conn.end();
