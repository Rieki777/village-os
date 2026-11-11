/**
 * THE PULSE SAYS WHAT CHANGED IN THE VILLAGE'S WORDS, NEVER IN A SETTING KEY.
 *
 * `GET /api/game/pulse` is unauthenticated and renders on the landing page.
 * The settings route used to write `A game rule changed: agents.lead_approved_writes`
 * into it, so visitors read internal keys. Two halves fix that:
 *
 *   WRITE   `settingsPulseLine(key)` says which words and which audience a new
 *           line gets. A setting with a human label is public news in that
 *           label. A setting without one, an unknown key, or a sensitive one
 *           (agents.*, secrets, a withheld dial, a dial moved to a secret slot)
 *           is recorded for admins only, with the key.
 *   READ    `publicPulseText(row)` rewrites the lines already stored, at read
 *           time and with no migration, the way credentialScrub rewrote the
 *           older "<key> is now <value>" text. A stored line for a setting that
 *           would be admin-only today is hidden from the public audience.
 *
 * Admin readers are not touched: they still see the key.
 */
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { NARRATION_PREFIX } from "../repos/settingsNarration";

/** What a village reads in front of a setting's label. */
export const PUBLIC_RULE_PREFIX = "We changed a village rule: ";

/** Key prefixes that are never public news, whatever label the dial carries. */
const SENSITIVE_PREFIXES = ["agents.", "secrets.", "secret."] as const;

/** The human label a visitor may read for this setting, or null when none may be shown. */
export function publicSettingLabel(key: string): string | null {
  if (SENSITIVE_PREFIXES.some((p) => key.startsWith(p))) return null;
  const def = VARIABLES_BY_KEY[key];
  if (!def || def.withheld || def.movedToSecret) return null;
  const label = String(def.label ?? "").trim();
  return label || null;
}

/** The line a new settings change writes, with its audience. The entity stays the key. */
export function settingsPulseLine(key: string): { text: string; audience: "public" | "admin" } {
  const label = publicSettingLabel(key);
  return label
    ? { text: `${PUBLIC_RULE_PREFIX}${label}`, audience: "public" }
    : { text: `${NARRATION_PREFIX}${key}`, audience: "admin" };
}

/**
 * The text a public reader gets for a stored line, or null to leave the line out.
 * Anything that is not an old settings line comes back as it was.
 */
export function publicPulseText(row: { kind: string; text: string; entityType?: string | null; entityRef?: string | null }): string | null {
  if (row.kind !== "settings" || !row.text.startsWith(NARRATION_PREFIX)) return row.text;
  const rest = row.text.slice(NARRATION_PREFIX.length);
  const key = (row.entityType === "variable" && row.entityRef ? row.entityRef : rest.split(" is now ")[0]).trim();
  const label = publicSettingLabel(key);
  return label ? `${PUBLIC_RULE_PREFIX}${label}` : null;
}
