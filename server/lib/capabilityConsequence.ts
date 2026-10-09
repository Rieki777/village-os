/**
 * THE SENTENCE SOMEBODY READS BEFORE A POWER CHANGES HANDS, with the one
 * number that sentence depends on filled in from the village as it is set now.
 *
 * `CAPABILITY_CONSEQUENCE` (shared/draftKinds.ts) is the fixed wording. One
 * power's honest description depends on a dial: `comms.manage` reads every
 * email the village still keeps, words included, and how long that is comes
 * from `comms.retention_months`. Rye, 2026-10-09: "show it and put a dial".
 * So at the moment a founder hands that power over, the sentence names the
 * months, read live, rather than leaving them to look it up.
 *
 * Every server surface that shows a consequence (badges, the powers map,
 * drafts) reads it through here, so the number cannot say one thing in one
 * place and another elsewhere.
 */
import type { Capability } from "../../shared/capabilities";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import { numberVar } from "./variables";

/** The months an email and its words are kept, as the village is set now, or null when the dial cannot be read. */
export function commsRetentionMonths(): number | null {
  try {
    const n = Math.trunc(numberVar("comms.retention_months"));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** What holding this power lets somebody do, in the village's words. Unknown keys read as themselves. */
export function liveConsequence(capability: string): string {
  const base = CAPABILITY_CONSEQUENCE[capability as Capability] ?? capability;
  if (capability !== "comms.manage") return base;
  const months = commsRetentionMonths();
  return months ? `${base}, kept ${months} month${months === 1 ? "" : "s"} as the village is set now` : base;
}
