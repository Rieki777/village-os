/**
 * THE ECONOMY HALF OF THE DRY RUN'S SNAPSHOT, TAKEN ONCE AND TAKEN READ ONLY.
 *
 * ── WHAT THIS MODULE IS ────────────────────────────────────────────────────
 *
 * `shared/dryRun/types.ts` says the simulation holds plain data and never a
 * database handle: "The snapshot is read ONCE by a governance-owned reader
 * that opens a read-only connection, and from that instant on the simulation
 * holds objects and never a handle." This file is the economy quarter of that
 * read. The composing reader (`server/lib/dryRunReader.ts`) fills the members,
 * the weights, the modules, the launch flag, the clock and the quests; it
 * calls in here for `tokens`, `balances`, `mintRules` and `variables`, and it
 * hands over the connection it already opened.
 *
 * ── READ ONLY BY CONSTRUCTION, NOT BY PROMISE ──────────────────────────────
 *
 * Four structural facts, each one testable and each one tested in
 * `dryRunEconomyReader.test.ts`:
 *
 *   1. Every statement in this file is a SELECT. Nothing else is spelled here
 *      at all, so `dryRunEconomyReader.test.ts` can walk this file's own bytes
 *      and fail on the first write verb it finds.
 *   2. It takes a `PoolConnection` and never a `Pool`. A pool hands out a
 *      fresh connection per query, and a fresh connection is outside whatever
 *      transaction the caller opened, so a reader given a pool would read a
 *      moving village and would not be inside the caller's read-only fence.
 *   3. It opens no transaction of its own and closes none. The caller has
 *      already run `SET TRANSACTION READ ONLY` and `START TRANSACTION` on the
 *      connection, which is what makes MySQL itself refuse a write (error
 *      1792) if this file ever grew one. There is no other such fence in this
 *      build today: the two nearest precedents set an isolation level only
 *      (`server/lib/economy.ts:1082`, `server/lib/voiceClaim.ts:245`).
 *   4. It returns plain objects and holds no reference to the connection past
 *      the last await.
 *
 * ── AN EMPTY TABLE AND A ZERO ARE DIFFERENT FACTS ──────────────────────────
 *
 * R7 says real numbers when they exist and mock numbers when they do not, and
 * this module is where the two meet. A founder standing up a village can open
 * a preview before the economy has ever been seeded, and a preview of a
 * village with no tokens and no rules can only answer "nothing happens", which
 * is a true sentence about an empty table and a useless one about a village.
 *
 * So the fallback is PER SECTION and it is honest about itself:
 *
 *   - `tokens` empty  -> the registry a fresh village boots with.
 *   - `mint_rules` empty -> the rules `server/lib/economySeed.ts` inserts.
 *   - `token_balances` NEVER falls back. The seed grants nobody anything
 *     ("Neither is a genesis grant", economySeed.ts:14), so a village with no
 *     balance rows really is a village at zero, and zero is a measurement.
 *   - `game_variables` never falls back either, because an empty table is that
 *     table's NORMAL state: it stores deltas only, and every unstored key
 *     inherits the platform default. The reader materialises those defaults so
 *     a model never reads `undefined` for a key the engine would default, and
 *     that is filling in a known value, not inventing one.
 *
 * `economyProvenance` is how anybody learns which of those happened. It is a
 * SEPARATE export and not a field on the snapshot, because the composing
 * reader asserts the snapshot's key set and a fifth key there would be a red
 * test. Nothing in this module ever presents a seeded section as a measured
 * one.
 *
 * ── MINOR UNITS, TAKEN FROM TEXT AND NEVER FROM A FLOAT ────────────────────
 *
 * `mint_rules.amount` and `mint_rules.ceiling` are `decimal(18,4)`
 * (drizzle/0071_economy_core.sql:51,56) and the driver hands them over as
 * text. `MintRuleSpec` wants both the scaled bigint and that text, because a
 * token with `decimals: 0` turns 0.0004 into zero minor units and the zero
 * alone cannot say whether a village decided it or fat-fingered it. The
 * scaling therefore runs on the STRING, through `writtenAmount` in
 * `shared/dryRun/economicsModel.ts`, which is the same function the model
 * itself reads `amountRaw` with. Reading the rounding out of the model rather
 * than restating it here means the reader and the model cannot disagree about
 * a village's money.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { writtenAmount } from "../../shared/dryRun/economicsModel";
import type { MintRuleSpec, TokenGovernance, TokenSpec, VillageSnapshot } from "../../shared/dryRun/types";
import { VARIABLES } from "../../shared/gameVariables";
import { CREDITS, HEARTS, VILLAGE_VOICE, faucetFor, villageId } from "./economy";
import { CURRENCY_DECIMALS, VOICE_DECIMALS } from "../../shared/tokenScale";
import { TREASURY } from "./ledger";
import { spendSinkFor } from "./spending";

/**
 * The four fields of `VillageSnapshot` this module answers for.
 *
 * Written as a `Pick` and never as a hand-typed interface: the contract owns
 * these shapes, and a copy of them here would be a second place for them to
 * drift. The composing reader spreads this straight into the snapshot.
 */
export type EconomySnapshotFields = Pick<VillageSnapshot, "tokens" | "balances" | "mintRules" | "variables">;

/** Whether a section was measured off the village or filled from the seed. */
export type EconomySectionSource = "live" | "seed";

/** Where one section of the economy snapshot came from. */
export interface EconomySectionProvenance {
  /** `live` when the table had rows, `seed` when this section fell back. */
  source: EconomySectionSource;
  /** How many rows the section carries. */
  rows: number;
  /** The clause this section contributes to `sentence`, ready to print. */
  clause: string;
}

/**
 * Which sections of the snapshot are a measurement and which are a mock.
 *
 * The composing reader prints `sentence` beside the snapshot so a founder
 * running a preview on a village that has not been seeded yet is never shown
 * the seed's numbers as though somebody had chosen them.
 */
export interface EconomyProvenance {
  tokens: EconomySectionProvenance;
  mintRules: EconomySectionProvenance;
  balances: EconomySectionProvenance;
  variables: EconomySectionProvenance;
  /** True when any section fell back to the seed. */
  anySeeded: boolean;
  /** Every clause, comma-joined. */
  sentence: string;
}

// ── The village a fresh Birthing produces ───────────────────────────────────

/**
 * The registry a village holds before anybody has touched it.
 *
 * Four rows arrive from the migrations: `gratitude`, `equity` and `voice` from
 * drizzle/0006_token_registry.sql:41, `credits` from
 * drizzle/0007_village_credits_token.sql:10. `equity` is the slug
 * drizzle/0124_the_equity_token_names_no_village.sql:188 renamed the old
 * per-village one to, so naming it here carries no village's brand. The fifth,
 * `village-voice`, is registered at boot by `ensureVoiceToken`
 * (server/lib/economy.ts:122) at `VOICE_DECIMALS` places.
 *
 * `stay-credit` and `library-credit` are deliberately ABSENT. Those two are
 * registered by their own modules at boot and only when those modules are on,
 * so a village whose registry is empty has neither, and listing them would
 * have the fallback invent two tokens with two faucets that the village has no
 * way to issue from. `dryRunEconomyReader.test.ts` asserts this list against a
 * freshly migrated schema so the claim is measured and not remembered.
 *
 * `decimals` was the column default of 0 for every row the migrations seed
 * (0006:32) until `0184`, which raises the currency-like ones to
 * `CURRENCY_DECIMALS`. That is why `credits` carries a scale here and the two
 * hypha mirrors and recognition do not. `active` still defaults to 1 there.
 */
interface SeedTokenRow {
  slug: string;
  kind: string;
  decimals: number;
  governance: TokenGovernance;
}

const SEED_TOKENS: readonly SeedTokenRow[] = [
  { slug: HEARTS, kind: "recognition", decimals: 0, governance: "platform" },
  { slug: "equity", kind: "equity", decimals: 0, governance: "hypha" },
  { slug: "voice", kind: "voice", decimals: 0, governance: "hypha" },
  { slug: CREDITS, kind: "credit", decimals: CURRENCY_DECIMALS, governance: "platform" },
  { slug: VILLAGE_VOICE, kind: "voice", decimals: VOICE_DECIMALS, governance: "platform" },
];

/**
 * The rules `server/lib/economySeed.ts` writes at boot, as their columns land.
 *
 * A MIRROR, and it says so. `RULES` in economySeed.ts:135 is a module-private
 * constant with no export, so the only way to state the seed's defaults here
 * is to restate them, and a restatement can drift. Two things bound that: the
 * id scheme is the seed's own (`rule-<trigger>-<token>`, economySeed.ts:227),
 * and `dryRunEconomyReader.test.ts` runs the real `seedEconomy` against a
 * scratch schema and asserts the rows it wrote equal the rows named here,
 * field for field. The day somebody retunes the seed, that test goes red.
 *
 * The figures are the seed's human numbers as `decimal(18,4)` holds them, so
 * the whole numbers the seed passes arrive back as four-place text. The minor
 * units are computed from that text at call time against the token's own
 * decimals, so the arithmetic in this file cannot drift from the arithmetic in
 * the model.
 */
interface SeedRuleRow {
  trigger: string;
  token: string;
  amountRaw: string;
  ceilingRaw: string;
  recipient: string;
  enabled: boolean;
}

const SEED_RULES: readonly SeedRuleRow[] = [
  { trigger: "quest.completed", token: VILLAGE_VOICE, amountRaw: "10.0000", ceilingRaw: "100.0000", recipient: "claimant", enabled: true },
  { trigger: "quest.completed", token: CREDITS, amountRaw: "25.0000", ceilingRaw: "250.0000", recipient: "claimant", enabled: true },
  { trigger: "role.cycle", token: VILLAGE_VOICE, amountRaw: "50.0000", ceilingRaw: "200.0000", recipient: "holder", enabled: true },
  { trigger: "role.cycle", token: CREDITS, amountRaw: "25.0000", ceilingRaw: "250.0000", recipient: "holder", enabled: true },
  // Seeded off, and off is not gone. See the block comment at economySeed.ts:99.
  { trigger: "role.cycle", token: HEARTS, amountRaw: "20.0000", ceilingRaw: "100.0000", recipient: "holder", enabled: false },
];

// ── Reading one value at a time ─────────────────────────────────────────────

/**
 * A token's sinks: where the village can send it once somebody holds it.
 *
 * `spendSinkFor` (server/lib/spending.ts:139) answers for every slug, but it
 * answers for slugs this platform can never post at all, and a Hypha-governed
 * mirror is one of those: `validateLeg` refuses to move it, so naming a sink
 * for it would describe a movement that cannot happen. Platform tokens get
 * their one sink; mirrors get none.
 */
function sinksFor(slug: string, governance: TokenGovernance): string[] {
  return governance === "platform" ? [spendSinkFor(slug)] : [];
}

/** One registry row as the simulation needs it. */
function specFor(slug: string, kind: string, decimals: number, governance: TokenGovernance, active: boolean): TokenSpec {
  return {
    slug,
    kind,
    decimals,
    faucet: faucetFor(slug),
    sinks: sinksFor(slug, governance),
    governance,
    active,
  };
}

/**
 * How many places a slug rides in, answered off the snapshot's own registry.
 *
 * The fallback mirrors `toLedgerUnits` (server/lib/economy.ts:154) exactly,
 * including its one special case: a rule naming a token that is not registered
 * scales as whole units unless it is the village voice token, which rides in
 * hundredths whether or not its row has loaded yet.
 */
function decimalsOf(tokens: readonly TokenSpec[], slug: string): number {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].slug === slug) return tokens[i].decimals;
  }
  return slug === VILLAGE_VOICE ? VOICE_DECIMALS : 0;
}

/**
 * A `decimal(18,4)` column's text as minor units of its token.
 *
 * Loud on anything it cannot scale. A money column that reads as something
 * `writtenAmount` refuses is a defect in this build and never news about the
 * village, and a preview that quietly turned it into zero would be a preview
 * of a rule that pays nobody.
 */
function minorUnits(text: string, decimals: number, what: string): bigint {
  const written = writtenAmount(text, decimals);
  if (!written) {
    throw new Error(`dryRunEconomyReader: ${what} reads ${JSON.stringify(text)}, which is not a decimal this build can scale.`);
  }
  return written.rounded;
}

/**
 * A `bigint` column as a bigint, through its text and never through a double.
 *
 * `token_balances.balance` is a `bigint` (drizzle/0009:81) and the driver
 * hands a bigint back as a JavaScript number by default, which is exact up to
 * 2^53 and silently is not past it. Going through the string means a value
 * this build cannot carry exactly fails loudly here instead of arriving in
 * somebody's preview a few units short.
 */
function balanceOfRow(value: unknown, what: string): bigint {
  const text = String(value ?? "0").trim();
  if (!/^-?[0-9]+$/.test(text)) {
    throw new Error(`dryRunEconomyReader: ${what} reads ${JSON.stringify(text)}, which is not a whole number of minor units.`);
  }
  return BigInt(text);
}

// ── The four reads ──────────────────────────────────────────────────────────

/** Every row of the registry, in the order the registry sorts itself. */
async function liveTokens(conn: PoolConnection): Promise<TokenSpec[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `slug`, `kind`, `decimals`, `governance`, `active` FROM `tokens` ORDER BY `sort_order`, `slug`",
  );
  const out: TokenSpec[] = [];
  for (const row of rows) {
    const governance: TokenGovernance = row.governance === "hypha" ? "hypha" : "platform";
    out.push(specFor(String(row.slug), String(row.kind), Number(row.decimals ?? 0), governance, !!row.active));
  }
  return out;
}

/**
 * Every balance, faucets and system accounts included.
 *
 * TWO READS, because two different facts are wanted and one table holds only
 * one of them. `token_balances` is a CACHE recomputed from `token_ledger`
 * (drizzle/0009:77), so a faucet that has never issued anything has no row at
 * all. `ledger_accounts` is where an account EXISTS, and the fourteen system
 * accounts the migrations seed are all there from the first boot. That figure
 * is measured in `dryRunEconomyReader.test.ts` and not counted by hand: the
 * first draft of this comment said seven and the test said otherwise.
 *
 * The model reads `state.balances[faucet] !== undefined` as "this account
 * exists" and raises `econ_faucet_account_missing` when it does not, on the
 * grounds that "the ledger refuses a posting out of a system account that does
 * not exist" (economicsModel.ts:1228). Handing over only the cache rows would
 * make every un-issued faucet look absent, and a fresh village would open its
 * first preview to five danger flags about accounts that are sitting right
 * there. So every account contributes a row, and only the balances it actually
 * holds go inside it. An empty row therefore means the account exists and has
 * never held that token; a zero inside a row means it held it and is now at
 * zero. Those are different facts and the snapshot keeps them apart.
 *
 * Conservation survives either way: an empty row adds nothing to any sum, so
 * `SUM(balance)` over the snapshot is `SUM(balance)` over the table, which the
 * ledger's own boot invariant already proves is zero per token.
 */
async function liveBalances(conn: PoolConnection): Promise<Record<string, Record<string, bigint>>> {
  const out: Record<string, Record<string, bigint>> = {};

  const [accounts] = await conn.query<RowDataPacket[]>(
    "SELECT `id` FROM `ledger_accounts` ORDER BY `id`",
  );
  for (const row of accounts) out[String(row.id)] = {};

  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `account_id`, `token_type`, `balance` FROM `token_balances` ORDER BY `account_id`, `token_type`",
  );
  for (const row of rows) {
    const account = String(row.account_id);
    const slug = String(row.token_type);
    const held = out[account] ?? {};
    held[slug] = balanceOfRow(row.balance, `the ${slug} balance on ${account}`);
    out[account] = held;
  }
  return out;
}

/**
 * Every minting rule this village holds, enabled or not.
 *
 * No `enabled = 1` filter and no `effective_from_cycle` window, unlike
 * `rulesFor` (server/lib/economy.ts:425). `MintRuleSpec.enabled` is part of
 * the contract and a change set can turn a rule on, so a snapshot that dropped
 * the disabled rows would be a snapshot in which half the decisions a village
 * might take cannot be previewed at all.
 */
async function liveMintRules(conn: PoolConnection, tokens: readonly TokenSpec[]): Promise<MintRuleSpec[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled` " +
      "FROM `mint_rules` WHERE `village_id` = ? ORDER BY `trigger`, `token_slug`",
    [villageId()],
  );
  const out: MintRuleSpec[] = [];
  for (const row of rows) {
    const tokenSlug = String(row.token_slug);
    const id = String(row.id);
    const places = decimalsOf(tokens, tokenSlug);
    const amountNull = row.amount === null || row.amount === undefined;
    const ceilingNull = row.ceiling === null || row.ceiling === undefined;
    const amountRaw = amountNull ? "" : String(row.amount);
    const ceilingRaw = ceilingNull ? "" : String(row.ceiling);
    out.push({
      id,
      trigger: String(row.trigger),
      tokenSlug,
      recipient: String(row.recipient ?? "claimant"),
      amount: amountNull ? null : minorUnits(amountRaw, places, `the amount on mint rule ${id}`),
      amountRaw,
      ceiling: ceilingNull ? null : minorUnits(ceilingRaw, places, `the ceiling on mint rule ${id}`),
      ceilingRaw,
      enabled: !!row.enabled,
    });
  }
  return out;
}

/**
 * Every variable's effective text: the village's own where it stored one, the
 * platform's default everywhere else.
 *
 * `game_variables` holds DELTAS ONLY (server/lib/variables.ts:5), so an
 * unstored key is not a missing value, it is a value the village has chosen
 * not to have an opinion about. `rawValue` (variables.ts:66) resolves exactly
 * this way, and this is that function over the whole registry, off a
 * connection instead of off the boot cache.
 *
 * EVERY registry key, not only the ones the economics model reads. The keys
 * the model touches today are `gratitude.base_budget`,
 * `gratitude.pool_per_cycle`, `gratitude.pool_token`,
 * `gratitude.max_share_per_recipient`, `governance.weight_mode`,
 * `governance.weight_token` and `progression.multiplier.<stage>` for every
 * stage on the roll. That list is a fact about today's model, and a hand-kept
 * copy of it here would go stale the first time the model read a sixth dial.
 * The registry answers for all of them at once and can never be short.
 *
 * A stored row whose key has no definition is carried through verbatim rather
 * than dropped. `variable()` throws on such a key (variables.ts:39), so it is
 * a village fact worth seeing in a snapshot, and the model already answers
 * null for a key it cannot define.
 */
async function liveVariables(conn: PoolConnection): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const def of VARIABLES) out[def.key] = def.default;
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `config_key`, `value` FROM `game_variables`",
  );
  for (const row of rows) out[String(row.config_key)] = String(row.value);
  return out;
}

// ── The seed, which is the honest mock ──────────────────────────────────────

/** The registry a fresh village boots with. */
function seedTokens(): TokenSpec[] {
  return SEED_TOKENS.map((t) => specFor(t.slug, t.kind, t.decimals, t.governance, true));
}

/** The rules a fresh village boots with, scaled against the tokens it has. */
function seedMintRules(tokens: readonly TokenSpec[]): MintRuleSpec[] {
  return SEED_RULES.map((r) => {
    const id = `rule-${r.trigger}-${r.token}`;
    const places = decimalsOf(tokens, r.token);
    return {
      id,
      trigger: r.trigger,
      tokenSlug: r.token,
      recipient: r.recipient,
      amount: minorUnits(r.amountRaw, places, `the seed amount on ${id}`),
      amountRaw: r.amountRaw,
      ceiling: minorUnits(r.ceilingRaw, places, `the seed ceiling on ${id}`),
      ceilingRaw: r.ceilingRaw,
      enabled: r.enabled,
    };
  });
}

/**
 * The accounts a fresh village's ledger already has, all of them empty.
 *
 * Every faucet its tokens can issue from, plus the treasury, which is the
 * ordinary vault every spend retires into. Empty rows and not absent ones, for
 * the reason `liveBalances` gives: an absent account reads to the model as an
 * account that does not exist, and these all exist from the first migration.
 */
function seedBalances(tokens: readonly TokenSpec[]): Record<string, Record<string, bigint>> {
  const out: Record<string, Record<string, bigint>> = {};
  for (const token of tokens) {
    if (token.faucet) out[token.faucet] = {};
  }
  out[TREASURY] = {};
  return out;
}

/**
 * The village its own Birthing would create, for the founder-setup case where
 * no rows exist yet.
 *
 * R7's honest mock: every number here is one this build would itself write on
 * the village's first boot, and none of it is invented for the preview. It
 * takes the connection so a caller can choose between this and
 * `readEconomySnapshot` on one predicate and call either the same way. It
 * reads nothing off it: the registry defaults live in `shared/gameVariables`
 * and the seed's own figures live above, so there is nothing here a database
 * could answer.
 */
export async function seedSnapshotFields(conn: PoolConnection): Promise<EconomySnapshotFields> {
  void conn;
  const tokens = seedTokens();
  const variables: Record<string, string> = {};
  for (const def of VARIABLES) variables[def.key] = def.default;
  return {
    tokens,
    balances: seedBalances(tokens),
    mintRules: seedMintRules(tokens),
    variables,
  };
}

// ── The two exports the composing reader calls ──────────────────────────────

/**
 * The economy quarter of the snapshot, read once off a connection the caller
 * has already fenced.
 *
 * EXACTLY the four fields and nothing else, because the composing reader
 * asserts the key set. Which of them are measured and which fell back to the
 * seed is `economyProvenance`'s answer, on the same connection.
 *
 * The tokens are read before the rules on purpose: a rule's minor units are
 * scaled against its own token's decimals, so the rules are scaled against
 * whichever registry the snapshot is going to carry. A seeded registry beside
 * live rules therefore still agrees with itself.
 */
export async function readEconomySnapshot(conn: PoolConnection): Promise<EconomySnapshotFields> {
  const measuredTokens = await liveTokens(conn);
  const tokens = measuredTokens.length > 0 ? measuredTokens : seedTokens();

  const measuredRules = await liveMintRules(conn, tokens);
  const mintRules = measuredRules.length > 0 ? measuredRules : seedMintRules(tokens);

  const balances = await liveBalances(conn);
  const variables = await liveVariables(conn);

  return { tokens, balances, mintRules, variables };
}

/** How many rows one question answers with. */
async function countOf(conn: PoolConnection, sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** One section's provenance, for a section that can fall back. */
function sectionOf(name: string, liveRows: number, seedRows: number): EconomySectionProvenance {
  const seeded = liveRows === 0;
  const rows = seeded ? seedRows : liveRows;
  return {
    source: seeded ? "seed" : "live",
    rows,
    clause: `${name}: ${seeded ? "seed defaults" : "live"} (${rows} rows)`,
  };
}

/**
 * Which sections of the snapshot are a measurement and which are a mock.
 *
 * Asked with its own counts rather than off the snapshot, so a caller may ask
 * it without taking a snapshot and so the two answers cannot disagree about
 * what "empty" means: both use the same predicate, which is whether the table
 * has a row.
 *
 * `balances` and `variables` never say `seed`. A village with no balance rows
 * is measurably at zero, and a village with no variable rows is measurably on
 * the platform defaults; neither is an absence the reader had to paper over.
 * Their counts are still reported, because "live (0 rows)" is the sentence
 * that tells a founder the reader looked and found nothing.
 */
export async function economyProvenance(conn: PoolConnection): Promise<EconomyProvenance> {
  const tokenRows = await countOf(conn, "SELECT COUNT(*) AS n FROM `tokens`");
  const ruleRows = await countOf(
    conn,
    "SELECT COUNT(*) AS n FROM `mint_rules` WHERE `village_id` = ?",
    [villageId()],
  );
  const balanceRows = await countOf(conn, "SELECT COUNT(*) AS n FROM `token_balances`");
  const storedVars = await countOf(conn, "SELECT COUNT(*) AS n FROM `game_variables`");

  const tokens = sectionOf("tokens", tokenRows, SEED_TOKENS.length);
  const mintRules = sectionOf("mint rules", ruleRows, SEED_RULES.length);
  const balances: EconomySectionProvenance = {
    source: "live",
    rows: balanceRows,
    clause: `balances: live (${balanceRows} rows)`,
  };
  const variables: EconomySectionProvenance = {
    source: "live",
    rows: storedVars,
    clause: `variables: live (${storedVars} stored, ${VARIABLES.length} platform defaults)`,
  };

  return {
    tokens,
    mintRules,
    balances,
    variables,
    anySeeded: tokens.source === "seed" || mintRules.source === "seed",
    sentence: [tokens.clause, mintRules.clause, balances.clause, variables.clause].join(", "),
  };
}
