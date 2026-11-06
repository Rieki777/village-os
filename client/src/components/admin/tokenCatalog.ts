/**
 * Which module carries each token, and which tokens this village runs.
 *
 * WHAT THIS FILE NO LONGER HOLDS. It used to carry a written sentence for each
 * shipped token (`TOKEN_NOTES[slug].what`) and `describeToken`, which composed
 * one for any token it did not know. Both said what a token DOES, and Rye
 * ruled on 2026-10-22 that platform copy never says that: "every community
 * will design their own rules for these and other tokens so don't mention what
 * it does anywhere". On 2026-10-23 he asked for the village to say it instead:
 * "name each type of token and for what categories it's issued and what it
 * means". So a token's meaning is now the village's own text, stored on the
 * token (drizzle/0283), written in TokenMeaningField.tsx and read by members
 * on their wallet. What is left here is a fact about the platform, not about
 * any village's rules: which module registers a token.
 *
 * PURE ON PURPOSE, and separate from client/src/pages/Admin.tsx: the page is on
 * the monolith ratchet (scripts/check-file-lines.mjs) and the filter below is
 * the part worth testing without rendering a table.
 */
import type { ModuleLifecycle } from "@shared/modules";

/**
 * The module that carries a token, for the tokens a module carries.
 *
 * A token named here is absent from the registry page while its module is
 * off, which is the founder's ruling that a module's tokens are named inside
 * their module and go dark when it is switched off.
 *
 * ONLY the two tokens a module's own file registers belong here.
 * `server/lib/stays.ts` and `server/lib/library.ts` each call `registerToken`
 * at boot; `gratitude`, `credits` and the two Hypha mirrors come from
 * migrations 0006/0007 and `village-voice` from `economySeed.ts`, so none of
 * those five is any module's to hide.
 */
export const TOKEN_MODULES: Readonly<Record<string, string>> = {
  "stay-credit": "stays",
  "library-credit": "library",
};

/** The registry row as `GET /api/admin/tokens` returns it. Loosely typed
 *  because the table renders it as `any` and every field is optional. */
export interface TokenRow {
  slug: string;
  name?: string;
  /** The village's own words for what it means (0283), or null. */
  description?: string | null;
  kind?: string;
  governance?: string;
  isExample?: boolean;
  issuedBy?: Record<string, number> | null;
}

/** The module that carries a token, or null when the platform always does. */
export function tokenModule(slug: string): string | null {
  return TOKEN_MODULES[slug] ?? null;
}

/**
 * Which tokens this village actually runs.
 *
 * A module's token is absent while its module is off. THE ONE EXCEPTION is a
 * token that has already been issued: the founder's ruling is that switching a
 * module off makes its tokens go dark for members and that "they're still on a
 * database so we don't destroy that row", and a steward who has to answer for
 * somebody's balance needs the row to still be findable on the one page that
 * names it. So an issued token stays listed and says its module is off.
 * `server/lib/stays.ts` is explicit that stay-credit exists while the module is
 * off precisely so a quest reward can post and wait, which is how a village
 * reaches that state without doing anything wrong.
 *
 * `lifecycles` null means the modules payload has not arrived yet: filter
 * NOTHING, the same rule `filterNavByModules` follows, so a slow link shows the
 * full registry instead of flashing a short one. An id missing from the record
 * reads as off, which is the delta-off rule the server lives by.
 */
export function visibleTokens<T extends TokenRow>(
  tokens: readonly T[],
  lifecycles: Record<string, ModuleLifecycle> | null | undefined,
): T[] {
  if (!lifecycles) return [...tokens];
  return tokens.filter((t) => {
    const moduleId = tokenModule(t.slug);
    if (!moduleId) return true;
    if ((lifecycles[moduleId] ?? "off") !== "off") return true;
    return Object.keys(t.issuedBy ?? {}).length > 0;
  });
}

/** True when this token is listed only because somebody holds it and its
 *  module is off. The row says so rather than looking like an ordinary one. */
export function tokenModuleIsOff(
  t: TokenRow,
  lifecycles: Record<string, ModuleLifecycle> | null | undefined,
): boolean {
  if (!lifecycles) return false;
  const moduleId = tokenModule(t.slug);
  if (!moduleId) return false;
  return (lifecycles[moduleId] ?? "off") === "off";
}
