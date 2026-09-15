/**
 * What each token IS, and which module carries it.
 *
 * WHY THIS FILE EXISTS. Until now a founder could read a token's SLUG and its
 * KIND on Admin then Tokens and nothing else, so the registry answered "what is
 * it called" and never "what is it for". That gap is what let two rename
 * surfaces coexist for one name: the Setup Wizard carried a "Recognition
 * currency name" box which the registry always overrode
 * (`mergedConfig()` in server/index.ts computes
 * `pick(registryName, pick(brandName, configName))`, so the registry wins over
 * both), and nothing on either screen said which of the two was the real one.
 * The wizard boxes are gone. This is the sentence that replaces them.
 *
 * PURE ON PURPOSE, and separate from client/src/pages/Admin.tsx: the page is on
 * the monolith ratchet (scripts/check-file-lines.mjs) and the filter below is
 * the part worth testing without rendering a table.
 *
 * A SLUG MISSING FROM THIS MAP IS NORMAL. Every token a village mints for
 * itself through "Create a platform token" arrives here unknown, and
 * `describeToken` composes an honest sentence from the registry row rather than
 * leaving the column blank. Adding an entry is an improvement, never a
 * requirement.
 */
import type { ModuleLifecycle } from "@shared/modules";

/** A token the platform ships, in the village's own words. */
export interface TokenNote {
  /** One plain sentence: what this token is, for somebody who has not met it. */
  what: string;
  /**
   * The module that carries it, when a module does. A token named here is
   * absent from the registry page while its module is off, which is the
   * founder's ruling that a module's tokens are named inside their module and
   * go dark when it is switched off.
   *
   * ONLY the two tokens a module's own file registers belong here.
   * `server/lib/stays.ts` and `server/lib/library.ts` each call
   * `registerToken` at boot; `gratitude`, `credits` and the two Hypha mirrors
   * come from migrations 0006/0007 and `village-voice` from `economySeed.ts`,
   * so none of those five is any module's to hide.
   */
  module?: string;
}

export const TOKEN_NOTES: Readonly<Record<string, TokenNote>> = {
  gratitude: {
    what: "Recognition. Members send it to each other for work somebody noticed, and it carries no financial value.",
  },
  credits: {
    what: "The value the cycle pool shares out across recognition, and the default answer to \"which token does the pool pay\".",
  },
  "village-voice": {
    what: "Governance weight earned here on site, held until a member claims it onto Base. It rides in hundredths, so a rule can pay a fraction of one and so that a waning rate reaches a member holding a single whole one.",
  },
  "stay-credit": {
    what: "Nights in the village's own accommodation. Priced per night by the stays desk, and members never send it to each other.",
    module: "stays",
  },
  "library-credit": {
    what: "Borrowing power in the tool library. Bringing something to the shelf earns it, and borrowing holds some of it as a deposit until the item comes back.",
    module: "library",
  },
  /*
   * NO ENTRY FOR THE TWO HYPHA MIRRORS, on purpose. `drizzle/0006` seeds the
   * equity row under one village's own name, and naming that slug here would
   * put a village's brand into platform code (scripts/check-brand-refs.mjs
   * fails the build for it, correctly). `describeToken` answers for them from
   * `kind` and `governance`, which is what those rows actually are, and it
   * keeps answering for a fork whose equity slug is something else entirely.
   */
};

/** The registry row as `GET /api/admin/tokens` returns it. Loosely typed
 *  because the table renders it as `any` and every field is optional. */
export interface TokenRow {
  slug: string;
  name?: string;
  kind?: string;
  governance?: string;
  isExample?: boolean;
  issuedBy?: Record<string, number> | null;
}

/**
 * One plain sentence about a token, always. A slug this file knows gets the
 * written line; anything else gets a sentence built from what the registry
 * itself holds, because "no description" on the page that exists to say what a
 * token is would be the page failing at its only job.
 */
export function describeToken(t: TokenRow): string {
  const known = TOKEN_NOTES[t.slug]?.what;
  if (known) return known;
  if (t.governance !== "platform") {
    if (t.kind === "equity") {
      return "This village's equity, held on Base and governed on Hypha. The platform reads the balance and can never mint, move or price it.";
    }
    if (t.kind === "voice") {
      return "The Base side of governance weight, held on Hypha. Read here, decided there.";
    }
    return "Lives on Base and is governed on Hypha. This platform reads its balance and can never mint it.";
  }
  if (t.kind === "recognition") return "A recognition token this village minted. It carries no financial value.";
  if (t.kind === "voice") return "A governance-weight token this village minted.";
  /*
   * "A STEWARD CAN GRANT IT", never "a quest can pay it". Measured, because
   * the obvious sentence here would have been a promise the engine refuses:
   * `faucetFor` (server/lib/economy.ts) returns a faucet for exactly four
   * slugs (gratitude, village-voice, stay-credit, library-credit) and null for
   * everything else, INCLUDING a token this village minted for itself, so a
   * rule pointed at one has nowhere to issue from. The hand-mint route issues
   * every platform token from `sys:mint` regardless, so the grant half is
   * true for all of them.
   */
  return "A credit this village minted for itself. A steward can grant it by hand from this page.";
}

/** The module that carries a token, or null when the platform always does. */
export function tokenModule(slug: string): string | null {
  return TOKEN_NOTES[slug]?.module ?? null;
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
