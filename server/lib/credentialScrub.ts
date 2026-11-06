/**
 * THE BOOT SCRUB: keys an older release left in the clear in two records.
 *
 *   `mechanics_changes`   the amendment ledger stored every before and after
 *                         raw, so a dedicated RPC endpoint sat there with its
 *                         key. The INSERT redacts now (server/repos/
 *                         mechanicsChanges.ts); this rewrites what is already
 *                         stored.
 *   `health_events`       the pulse narrated "<key> is now <value>" until
 *                         2026-08-12. Rewritten to the sentence the route
 *                         writes today, "A game rule changed: <key>".
 *
 * ── WHY AT BOOT AND NOT A NUMBERED MIGRATION ────────────────────────────────
 *
 * A migration would have to restate the rule in SQL, and the rule is a
 * TypeScript function that two other places already ask (the public feed and
 * the ledger's writer). A second copy in SQL is a copy that can disagree, and
 * here the disagreement is measurable before it is written: `looksLikeCredential`
 * is three JavaScript regexes, case-sensitive in one place, and MySQL 8 (ICU,
 * what CI and production run) and MariaDB (PCRE, what these dev machines run)
 * give REGEXP different case rules depending on the column's collation. Half of
 * the rule also lives in the registry, not the database: which dials are
 * declared `withheld`. SQL cannot see that.
 *
 * So SQL only finds CANDIDATES, with a superset filter cheap enough to run on
 * every boot (`ledgerRowsThatMayCarryKeys`), and the decision per row is made
 * here by `carriesCredential`, the same function the writer uses. The UPDATE
 * is by primary key and compares every column it rewrites against what was
 * read, so it touches exactly the rows the rule chose and only while they still
 * say what was read. Running every boot, and not once, also catches a row a
 * rolled-back previous release wrote raw after this one first ran.
 *
 * Idempotent: a redacted value no longer carries a key under the rule, so the
 * second boot rewrites nothing. Precedent for doing a conversion here is
 * `resealPlaintextSecrets` in secrets.ts, which cannot be SQL for its own reason.
 *
 * Never throws into boot. A scrub that failed leaves the rows as they were and
 * says so; the next boot tries again.
 */
import type { Pool } from "mysql2/promise";
import { VARIABLES } from "../../shared/gameVariables";
import { carriesCredential, ledgerSafeNote, ledgerSafeValue } from "./credentialRedaction";
import { ledgerRowsThatMayCarryKeys, rewriteLedgerValues } from "../repos/mechanicsChanges";
import { NARRATION_PREFIX, narratedSettingsLines, rewriteNarration } from "../repos/settingsNarration";

/** Dials declared `withheld`, whose every non-default value is treated as a key. */
const DECLARED = VARIABLES.filter((v) => v.withheld).map((v) => v.key);

export async function scrubCredentialCopies(pool: Pool): Promise<{ ledgerRows: number; narrations: number }> {
  let ledgerRows = 0;
  let narrations = 0;
  try {
    for (const row of await ledgerRowsThatMayCarryKeys(pool, DECLARED)) {
      const after = {
        ...row,
        oldValue: ledgerSafeValue(row.configKey, row.oldValue),
        newValue: ledgerSafeValue(row.configKey, row.newValue),
        note: ledgerSafeNote(row.note),
      };
      if (after.oldValue === row.oldValue && after.newValue === row.newValue && after.note === row.note) continue;
      if (await rewriteLedgerValues(pool, row, after)) ledgerRows += 1;
    }
    for (const line of await narratedSettingsLines(pool)) {
      const marker = `${NARRATION_PREFIX}${line.dial} is now `;
      if (!line.text.startsWith(marker)) continue;
      if (!carriesCredential(line.dial, line.text.slice(marker.length))) continue;
      if (await rewriteNarration(pool, line, `${NARRATION_PREFIX}${line.dial}`)) narrations += 1;
    }
  } catch (e) {
    // The code only: a driver message can quote the statement, and the
    // statement can carry the very value this pass exists to remove.
    console.error(`[secrets] the credential scrub did not finish (${String((e as any)?.code ?? "error")}); it runs again next boot`);
  }
  if (ledgerRows + narrations > 0) {
    console.log(`[secrets] removed keys from ${ledgerRows} amendment ledger row(s) and ${narrations} old pulse line(s)`);
  }
  return { ledgerRows, narrations };
}
