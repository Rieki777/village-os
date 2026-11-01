/**
 * WHAT A STORED RECORD KEEPS IN PLACE OF A KEY.
 *
 * The amendment ledger (`mechanics_changes`) is the village's record of every
 * dial it ever moved, and until this file it stored each before and after
 * raw. The public feed already held a credential back (mechanicsHistory.ts),
 * so the gap was storage: the moment `tokens.base_rpc_url` was set to a
 * dedicated endpoint, the provider key sat in that table in plain text, in
 * every database dump the backup workflow ships, for as long as the row lives.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A value carries a credential when EITHER
 *
 *   - it is SHAPED like one (`looksLikeCredential`, shared/gameVariables.ts,
 *     the same function the public feed asks), or
 *   - its dial is DECLARED `withheld` and the value is not the dial's own
 *     platform default.
 *
 * The second half is load-bearing and not a widening for its own sake. Some
 * providers put the key in a bare path segment (QuickNode's
 * `https://<name>.base-mainnet.quiknode.pro/<key>/`, Ankr's `/base/<key>`), and
 * no pattern recognises those. The dial is declared because its value can
 * carry a key, so every value it held is treated as one, except the public
 * default, which is platform code anybody can read. A dial nobody declared is
 * judged by shape alone, so an ordinary value on an ordinary dial, a URL
 * included, is never touched.
 *
 * ── WHAT REPLACES IT ───────────────────────────────────────────────────────
 *
 * `<scheme>://<host> (key removed)` for a URL, the same swap inside a sentence
 * that quotes one, and the bare `(key removed)` for anything else. The host
 * stays because it is not secret and it is the useful half
 * of the history ("we used Alchemy then"). Userinfo, path, query and fragment
 * go. The result is no longer credential-shaped, so the rule is idempotent: a
 * second pass changes nothing, which is what lets the boot scrub run on every
 * boot.
 *
 * Pure: no pool, no clock. The writer (server/repos/mechanicsChanges.ts) and
 * the boot scrub (credentialScrub.ts) both ask this file, so storage and the
 * scrub cannot disagree about what a key is.
 */
import { VARIABLES_BY_KEY, looksLikeCredential } from "../../shared/gameVariables";

/** The marker a stored record carries where a key was. */
export const KEY_REMOVED = "(key removed)";

/**
 * Did this value already come through `redactCredential`? A substring test,
 * because a redacted URL can sit in the middle of a sentence, and the rule must
 * never redact its own output a second time.
 */
export function isRedactedCredential(value: unknown): boolean {
  return typeof value === "string" && value.includes(KEY_REMOVED);
}

/** Does this value, stored under this dial, carry a credential? See the header. */
export function carriesCredential(key: string, value: string | null | undefined): boolean {
  if (value == null || value === "" || isRedactedCredential(value)) return false;
  if (looksLikeCredential(value)) return true;
  const def = VARIABLES_BY_KEY[key];
  return !!def?.withheld && value !== def.default;
}

/** `scheme://host` of a URL, or null when the text is not one. */
function originOf(text: string): string | null {
  try {
    const u = new URL(text);
    return u.host ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/** A URL-looking token inside free text, up to whitespace, a bracket or a quote. */
const URL_TOKEN = /[a-z][a-z0-9+.-]{0,31}:\/\/[^\s()<>"']+/gi;

/** Every credential-shaped URL inside the text swapped for its origin and the marker. */
function swapCredentialUrls(text: string): string {
  return text.replace(URL_TOKEN, (u) => (looksLikeCredential(u) ? `${originOf(u) ?? ""} ${KEY_REMOVED}`.trim() : u));
}

/**
 * The value with its credential removed. A value that IS a URL keeps its
 * origin; a sentence that quotes one keeps the sentence; anything else, or
 * anything still credential-shaped after that, is the bare marker.
 */
export function redactCredential(value: string): string {
  const origin = originOf(value.trim());
  if (origin) return `${origin} ${KEY_REMOVED}`;
  const swapped = swapCredentialUrls(value);
  return swapped !== value && !looksLikeCredential(swapped) ? swapped : KEY_REMOVED;
}

/** What the ledger stores for one value. Null stays null: it means "the platform default". */
export function ledgerSafeValue(key: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  return carriesCredential(key, value) ? redactCredential(value) : value;
}

/**
 * What the ledger stores for a note. A note is prose that can quote a value
 * ("Baseline moved between proposal (X) and apply (Y)"), so each quoted URL
 * that carries a key is replaced and the sentence around it is kept. If a
 * credential shape survives outside any URL, the whole note goes.
 */
export function ledgerSafeNote(note: string | null | undefined): string | null {
  if (note == null || !looksLikeCredential(note)) return note ?? null;
  const swapped = swapCredentialUrls(note);
  return looksLikeCredential(swapped) ? KEY_REMOVED : swapped;
}

/**
 * What a failed chain call may say in a log line. viem's HttpRequestError puts
 * `URL: <the whole endpoint>` in its `message` and strips only a `user:pass@`,
 * so an Alchemy or Infura endpoint kept its key in every logged failure. The
 * short message carries what went wrong without the URL, and the endpoint is
 * cut out of whatever text is left, whatever the error's shape.
 */
export function rpcErrorText(e: unknown, url: string): string {
  const text = String((e as any)?.shortMessage ?? (e as any)?.message ?? e);
  if (!url) return text;
  let origin = "the RPC endpoint";
  try {
    origin = new URL(url).origin;
  } catch {
    // Not a URL; the generic name stands in.
  }
  return text.split(url).join(origin);
}
