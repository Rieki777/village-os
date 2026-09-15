/**
 * What a village is born knowing: five classes, and a starting set of rules.
 *
 * Two different idempotency rules here, and the difference is the whole point.
 *
 *   Archetypes UPSERT by natural key. They are vocabulary, and a platform
 *   improvement to the copy should reach every village on the next deploy.
 *
 *   Mint rules INSERT IF ABSENT and are never updated. They are money. Once a
 *   village has looked at its rules and decided its own amounts, a redeploy
 *   that "restored the defaults" would silently undo a governance decision, and
 *   nobody would see it happen until the next settlement paid the wrong number.
 *
 * Neither is a genesis grant. Re-running this seeds nothing twice and grants
 * nobody anything: value only ever enters through the engine.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ARCHETYPES } from "../../shared/archetypes";
import { CREDITS, ensureVoiceToken, HEARTS, VILLAGE_VOICE } from "./economy";

/**
 * The starting rules: VILLAGE VOICE AND VILLAGE CREDITS, and not Gratitude.
 *
 * Rye, 2026-08-30: "Quests, roles, and contributions of any type should be
 * able to pay any combination of any tokens (the defaults being village voice
 * and village credits)", and "if they want to connect quests and roles to the
 * gratitude system they can have this be one of the tokens issued but that is
 * a change they can add not the defaults we're going to ship with."
 *
 * A CHANGE THEY CAN ADD IS WHY THE GRATITUDE RULE IS STILL HERE, DISABLED,
 * rather than deleted. There is no route in this build that CREATES a mint
 * rule: `PATCH /api/admin/economy/rules/:id` edits amount, ceiling and
 * enabled on a row that already exists, and the governed path after launch
 * (`shared/mintRuleKeys.ts`) offers the same three fields on the same rows.
 * Deleting the row would therefore take the payout away permanently, with no
 * way for any village to get it back. The ruling asked for a default that
 * omits Gratitude, and this is what that costs. Seeded at `enabled: 0`, the
 * row pays nobody until a village decides otherwise, and turning it on is one
 * PATCH before launch or one vote after.
 *
 * Hearts on quest.completed are deliberately ABSENT ENTIRELY, and this is the
 * one place the disabled-row trick would be actively dangerous. The consent
 * route has minted recognition for a confirmed quest since S7, with its own
 * range, cap and standing multiplier. A quest.completed gratitude rule sitting
 * here disabled would look like the obvious thing to switch on, and switching
 * it on would pay twice for one piece of work. A trap with a toggle on it is
 * worse than an absence.
 *
 * WHICH ALSO MEANS A QUEST STILL PAYS GRATITUDE, and no change to this table
 * can stop it. The consent route mints it from the range the quest advertises
 * in `quests.gratitude`, and on the shipped defaults it REFUSES a consent
 * below 1 (`quest.allow_zero_consent` off) and refuses any quest whose range it
 * cannot read (`quest.consent_cap_mode` = 'posted'). Gratitude for a quest is
 * the consent transaction itself, so "quests stop paying gratitude" is a change
 * to that route and to what the board advertises. This file changes the seat
 * payout, where Gratitude genuinely was a default.
 *
 * Every ceiling is a real number. A from_source rule with no ceiling is an open
 * faucet with a form in front of it.
 */
const RULES = [
  // Whole numbers on purpose (Rye, 2026-08-11). 10 a quest and 50 a season
  // against a claim threshold of 100 means ten quests, or two seasons holding a
  // seat, or a mix. Whole numbers read better on a chip than 0.1 does and they
  // make the threshold arithmetic something a member can do in their head.
  { trigger: "quest.completed", token: VILLAGE_VOICE, amount: 10, ceiling: 100, recipient: "claimant", enabled: true },
  // ── The credit amounts, and why both are 25 (RYE TO CONFIRM) ────────────
  //
  // Sized against the one credit number a village already has:
  // `gratitude.pool_per_cycle` releases 1000 credits at each cycle close, split
  // by the recognition people received. That pool is meant to be the main way
  // value follows appreciation, so a direct payout wants to stay the smaller
  // channel. 25 a quest and 25 a seat-moon does that: ten seats issue 250 a
  // moon against a pool of 1000.
  //
  // THE VOICE RATIO IS DELIBERATELY NOT CARRIED OVER, and this is the number
  // to look at first. Voice pays 50 for a seat-moon and 10 for a quest, five to
  // one, because a seat is a season of holding something and a quest is one
  // piece of work. Applying five to one here would make a seat-moon 125
  // credits, and ten seats would then issue 1250 a moon, more than the entire
  // cycle pool. That is a real change to what credits are worth and nobody has
  // decided it, so this ships the conservative number and names the question.
  //
  // Both figures are a founder's call. They are not derived from anything, and
  // erring low is the cheaper mistake: raising a payout later costs one PATCH,
  // while credits already issued at the wrong rate are in people's hands.
  { trigger: "quest.completed", token: CREDITS, amount: 25, ceiling: 250, recipient: "claimant", enabled: true },
  { trigger: "role.cycle", token: VILLAGE_VOICE, amount: 50, ceiling: 200, recipient: "holder", enabled: true },
  { trigger: "role.cycle", token: CREDITS, amount: 25, ceiling: 250, recipient: "holder", enabled: true },
  // Off, not gone. See the block comment above.
  { trigger: "role.cycle", token: HEARTS, amount: 20, ceiling: 100, recipient: "holder", enabled: false },
];

export interface SeedReport {
  archetypes: number;
  rulesAdded: number;
  rulesLeftAlone: number;
}

export async function seedEconomy(
  pool: Pool,
  villageId: string,
  opts: { dryRun?: boolean; voiceName?: string } = {},
): Promise<SeedReport> {
  const report: SeedReport = { archetypes: 0, rulesAdded: 0, rulesLeftAlone: 0 };

  if (!opts.dryRun) await ensureVoiceToken(pool, opts.voiceName);

  for (const a of ARCHETYPES) {
    report.archetypes += 1;
    if (opts.dryRun) continue;
    await pool.query(
      "INSERT INTO `archetypes` (`village_id`, `key`, `name`, `subtitle`, `blurb`, `examples`, `sigil`, `sort_order`) " +
        "VALUES (?,?,?,?,?,?,?,?) " +
        // Vocabulary, so platform copy improvements travel. A village that has
        // renamed a class keeps its own name: `name` is the one column an
        // admin edits, and it is restored from the row rather than the seed
        // once `renamed` is set. Until that editor ships, a rename is an admin
        // act on the row and this line would undo it, which is why the admin
        // surface is part of the same build.
        // EVERY COLUMN IS CONDITIONAL ON `customized`, and that column is why
        // the admin editor could not ship before it. This statement used to
        // overwrite subtitle, blurb, examples, sigil and sort_order on every
        // deploy, so a village that re-blurbed a class would find its words
        // replaced by the platform's at the next restart, with nothing said.
        // The comment that stood here promised a `renamed` flag would protect
        // them; no such column ever existed.
        //
        // `name` was already absent from this list and stays absent: a rename
        // survived even before there was a screen to do it in.
        //
        // So a platform copy improvement travels to villages that have not
        // made a class their own, and never undoes one that has.
        "ON DUPLICATE KEY UPDATE " +
        "`subtitle` = IF(`customized`, `subtitle`, VALUES(`subtitle`)), " +
        "`blurb` = IF(`customized`, `blurb`, VALUES(`blurb`)), " +
        "`examples` = IF(`customized`, `examples`, VALUES(`examples`)), " +
        "`sigil` = IF(`customized`, `sigil`, VALUES(`sigil`)), " +
        "`sort_order` = IF(`customized`, `sort_order`, VALUES(`sort_order`))",
      [
        villageId,
        a.key,
        a.name,
        a.subtitle,
        a.blurb,
        JSON.stringify(a.examples),
        a.sigil,
        ARCHETYPES.indexOf(a),
      ],
    );
  }

  for (const r of RULES) {
    // INSERT IGNORE against the natural key, so an amount a village has edited
    // is never restored to the platform default by a redeploy.
    if (opts.dryRun) {
      const [existing]: any = await pool.query(
        "SELECT 1 FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = ? AND `token_slug` = ? LIMIT 1",
        [villageId, r.trigger, r.token],
      );
      if (existing.length) report.rulesLeftAlone += 1;
      else report.rulesAdded += 1;
      continue;
    }
    const [res]: any = await pool.query(
      "INSERT IGNORE INTO `mint_rules` " +
        "(`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [
        `rule-${r.trigger}-${r.token}`,
        villageId,
        r.trigger,
        r.token,
        r.amount,
        r.ceiling,
        r.recipient,
        // Was hardcoded to 1. A seeded-off rule is how a default omits a token
        // without removing the village's ability to pay it, and INSERT IGNORE
        // still means a village that has already turned this row on keeps it
        // on through every redeploy.
        r.enabled ? 1 : 0,
      ],
    );
    if (Number(res?.affectedRows ?? 0) > 0) report.rulesAdded += 1;
    else report.rulesLeftAlone += 1;
  }

  return report;
}

/**
 * Suggested class tags on work that already exists.
 *
 * The character select's "Open paths" panel is empty until something carries a
 * tag, so a fresh village meets five classes that appear to open nothing. This
 * fills that in from words the village already wrote.
 *
 * KEYWORDS, NOT IDS. Hardcoding a quest id would put one village's content in
 * platform code, and a fork would inherit tags for quests it does not have.
 * Matching on the title and tags a village wrote works on any village's board
 * and degrades to "no suggestion" rather than to a wrong one.
 *
 * EVERY TAG IS A SUGGESTION AND SAYS SO. `archetypes_suggested = 1` is what the
 * admin surface renders amber: a machine's guess awaiting a human's word. And
 * the write only ever touches rows where `archetypes IS NULL`, so a tag anybody
 * has confirmed or cleared is never overwritten by a later boot. Clearing a
 * suggestion to an empty array is a decision, and an empty array is not NULL.
 */
const CLASS_WORDS: Array<{ key: string; words: string[] }> = [
  { key: "building", words: ["build", "infrastructure", "tech", "platform", "trail", "garden", "food", "forest", "repair", "tool", "maintain", "construct", "greenhouse", "install"] },
  { key: "researching", words: ["research", "design", "scribe", "record", "map", "plan", "steward", "survey", "analys", "framework", "architect"] },
  { key: "facilitating", words: ["host", "facilitat", "circle", "gather", "potluck", "welcome", "play", "heal", "retreat", "gathering", "gatekeep", "hold"] },
  { key: "catalyzing", words: ["connect", "ambassador", "partner", "introduc", "weave", "outreach", "alliance", "network"] },
  // No bare "art": it is a substring of "Arts" in "Healing Arts Practitioner",
  // which is a therapy and not a story, and of part, party, chart and start.
  // Short generic stems are where a keyword matcher earns its false positives.
  { key: "storytelling", words: ["story", "photo", "write", "mural", "artist", "paint", "music", "document", "communicat", "publish", "newsletter", "film"] },
];

function suggestClasses(text: string): string[] {
  const hay = text.toLowerCase();
  const hits = CLASS_WORDS.filter((c) => c.words.some((w) => hay.includes(w))).map((c) => c.key);
  // Two is a suggestion; five is noise. A row that matches everything is
  // telling us the words are too generic, not that it suits every class.
  return hits.length && hits.length <= 3 ? hits : [];
}

export async function suggestClassTags(
  pool: Pool,
  villageId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ quests: number; roles: number }> {
  const out = { quests: 0, roles: 0 };

  const [quests] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `tags` FROM `quests` WHERE `archetypes` IS NULL AND `is_example` = 0",
  );
  for (const q of quests) {
    const tags = Array.isArray(q.tags) ? q.tags.join(" ") : String(q.tags ?? "");
    const keys = suggestClasses(`${q.title ?? ""} ${tags}`);
    if (!keys.length) continue;
    out.quests += 1;
    if (opts.dryRun) continue;
    await pool.query(
      "UPDATE `quests` SET `archetypes` = ?, `archetypes_suggested` = 1 WHERE `id` = ? AND `archetypes` IS NULL",
      [JSON.stringify(keys), q.id],
    );
  }

  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `aim` FROM `org_roles` WHERE `archetypes` IS NULL AND `is_example` = 0",
  );
  for (const r of roles) {
    const keys = suggestClasses(`${r.name ?? ""} ${r.aim ?? ""}`);
    if (!keys.length) continue;
    out.roles += 1;
    if (opts.dryRun) continue;
    await pool.query(
      "UPDATE `org_roles` SET `archetypes` = ?, `archetypes_suggested` = 1 WHERE `id` = ? AND `archetypes` IS NULL",
      [JSON.stringify(keys), r.id],
    );
  }
  return out;
}
