/**
 * The claims waiting for a witness, on /review.
 *
 * ── WHY IT LIVES ON /review ──────────────────────────────────────────────
 *
 * Consent is the one step in the game that releases value, and the server has
 * let a steward who holds `quest.consent` take it since the 0103 capability
 * round. The only screen for it was `QuestClaimsTab` in Admin.tsx, behind
 * `AdminGate`, so a steward who was not an admin was rung by the submit bell to
 * a page that refused them. The governance lane's reading (2026-09-14) is that
 * consent's home is this page, beside the other things a steward decides.
 *
 * ── THE BOX OPENS ON A NUMBER THE SERVER WILL TAKE ───────────────────────
 *
 * The admin panel's box opens at a hardcoded 50, and under the shipped `posted`
 * mode the first press on a quest paying 100 to 200 is a certain 409. Here each
 * claim arrives with `bounds` (`consentBounds`, server/lib/questConsent.ts), the
 * box opens on its floor, and the button asks `canGrant`
 * (shared/questConsentBounds.ts) before anybody presses. The grid in
 * server/lib/questConsent.test.ts holds `canGrant` equal to the route's own
 * refusal for every mode, label, zero dial and amount, so a button this screen
 * enables is an amount the route accepts. The route still decides the rest: a
 * self-consent, a claim nobody submitted and issuance that has not started are
 * refusals this screen cannot see, and their sentences come back verbatim.
 *
 * ── A FAILED READ IS NEVER AN EMPTY LIST ─────────────────────────────────
 *
 * The page's own rule, kept per section. Refused renders nothing, because a
 * member without the key has no use for the section and the page says so when
 * every section refused. Failed says the list may not be empty. Only an answer
 * with nothing submitted says nothing is waiting.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { canGrant, type ConsentBounds, type ConsentCapMode } from "@shared/questConsentBounds";

/** One row of `GET /api/admin/quest-claims`: `ClaimRecord` in server/repos/quests.ts, plus `bounds`. */
export interface ConsentClaim {
  id: string;
  questId: string;
  questTitle: string;
  userId: string;
  userName: string;
  status: "claimed" | "submitted" | "consented" | "declined";
  artifactUrl?: string | null;
  note?: string | null;
  amount?: number | null;
  claimedAt: string | null;
  submittedAt?: string | null;
  resolvedAt?: string | null;
  confidence?: "on_track" | "at_risk" | "stuck" | null;
  confidenceNote?: string | null;
  /** `null` when the claim's quest is gone, so nothing is advertised. */
  bounds: ConsentBounds | null;
}

interface Props {
  /** `null` until the read answers, and after a refusal or a failure. */
  claims: ConsentClaim[] | null;
  refused: boolean;
  error: string | null;
  headers: () => Record<string, string>;
  /** Read the claims again after a decision landed. */
  onChanged: () => Promise<void>;
  onRetry: () => void;
}

/** What a steward may grant, in words, keyed by the dial's own union. */
const RANGE_WORDS: Record<ConsentCapMode, (b: ConsentBounds) => string> = {
  posted: (b) =>
    b.floor === b.ceiling
      ? `Exactly ${b.floor}, what the board advertises.`
      : `Between ${b.floor} and ${b.ceiling}, what the board advertises.`,
  capped: (b) =>
    `Between ${b.floor} and ${b.ceiling}. The board advertises ${b.label}, and this village allows a bonus up to ${b.ceiling}.`,
  unlimited: (b) =>
    b.readable
      ? `The board advertises ${b.label}, and this village sets no ceiling on what a steward grants.`
      : `The board's reward reads "${b.label}", and this village sets no ceiling on what a steward grants.`,
};

const CONFIDENCE_WORDS: Record<NonNullable<ConsentClaim["confidence"]>, string> = {
  on_track: "says it is on track",
  at_risk: "flagged a wobble",
  stuck: "is stuck",
};

function rangeSentence(b: ConsentBounds | null): string {
  if (!b) {
    return "Its quest is gone from the board, so there is no advertised amount to check. The server answers when you press.";
  }
  if (b.mode !== "unlimited" && !b.readable) {
    return `The board's reward reads "${b.label}", which is not an amount, so nothing can be granted until the quest says a number.`;
  }
  const zero = b.zeroAllowed && b.floor !== 0 ? " 0 is allowed too, which completes the claim and moves no recognition." : "";
  return RANGE_WORDS[b.mode](b) + zero;
}

/** Why a typed amount cannot be sent, or null when it can. An empty box is neither, and is handled by the caller. */
function refusalFor(text: string, b: ConsentBounds | null): string | null {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return "Whole tokens only, 0 or more.";
  if (!b || canGrant(n, b)) return null;
  if (n === 0) return "This quest does not allow a consent at 0.";
  if (b.mode !== "unlimited" && !b.readable) return "Nothing can be granted until the quest says a number.";
  if (b.floor !== null && n < b.floor) return `Below ${b.floor}, the least this quest pays.`;
  if (b.ceiling !== null && n > b.ceiling) {
    return b.mode === "capped"
      ? `Above ${b.ceiling}, the most this village allows.`
      : `Above ${b.ceiling}, the most this quest advertises.`;
  }
  return "Outside what this quest allows.";
}

function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function ConsentQueue({ claims, refused, error, headers, onChanged, onRetry }: Props) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const card = "bg-card border border-border rounded-xl p-5";

  if (refused) return null;

  if (error) {
    return (
      <div className={card}>
        <h2 className="font-semibold text-foreground">The claims did not load</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {error}. Finished work may be waiting for a witness, and this page cannot see it right now.
        </p>
        <button onClick={onRetry} className="text-xs border border-border rounded-lg px-3 py-2 mt-4 min-h-[44px]">
          Try again
        </button>
      </div>
    );
  }

  if (!claims) return null;

  const waiting = claims.filter((c) => c.status === "submitted");
  const underway = claims.filter((c) => c.status === "claimed");
  const decided = claims
    .filter((c) => c.status === "consented" || c.status === "declined")
    .sort((a, b) => String(b.resolvedAt ?? "").localeCompare(String(a.resolvedAt ?? "")))
    .slice(0, 10);

  const decide = async (c: ConsentClaim, approve: boolean, amount: number) => {
    setBusy(c.id);
    try {
      // The Response is held before anything says a decision landed, which is
      // what `check-save-honesty.mjs` asks of every control that reports success.
      const res = await fetch(`/api/admin/quest-claims/${c.id}/consent`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(approve ? { approve: true, amount } : { approve: false }),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        // The server's own sentence. These refusals name the rule a steward just
        // met, and a generic failure teaches them nothing about which one.
        toast.error((d as { error?: string })?.error ?? "That did not go through");
        return;
      }
      toast.success(
        approve
          ? amount > 0
            ? "Consented, and the credit is posted."
            : "Consented at 0."
          : "Declined. The quest is open again.",
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="consent-heading">
      <div>
        <h2 id="consent-heading" className="text-lg font-semibold text-foreground">
          Finished work waiting for a witness
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Consent is the one step that releases value. Read what they did, then say what it earns.
        </p>
      </div>

      {waiting.length === 0 && (
        <div className={card}>
          <p className="text-sm text-muted-foreground">No finished work is waiting for a witness.</p>
        </div>
      )}

      {waiting.map((c) => {
        const text = amounts[c.id] ?? (c.bounds?.floor != null ? String(c.bounds.floor) : "");
        const empty = text.trim() === "";
        const why = empty ? null : refusalFor(text, c.bounds);
        const blocked = empty || why !== null;
        const n = Number(text);
        const submitted = day(c.submittedAt ?? c.claimedAt);
        // A member typed this. Only a web address becomes a link.
        const href = c.artifactUrl && /^https?:\/\//i.test(c.artifactUrl) ? c.artifactUrl : null;
        return (
          <div key={c.id} className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-foreground">{c.questTitle}</h3>
              {submitted && <p className="text-xs text-muted-foreground">Submitted {submitted}</p>}
            </div>
            <p className="text-sm text-foreground mt-1">{c.userName}</p>
            {c.note && <p className="text-sm text-muted-foreground mt-2 italic">&ldquo;{c.note}&rdquo;</p>}
            {c.artifactUrl &&
              (href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-teal-deep underline break-all block mt-1"
                >
                  {c.artifactUrl}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground mt-1 break-all">{c.artifactUrl}</p>
              ))}

            <p className="text-xs text-muted-foreground mt-4">{rangeSentence(c.bounds)}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <label className="sr-only" htmlFor={`grant-${c.id}`}>
                What this work earns
              </label>
              <input
                id={`grant-${c.id}`}
                inputMode="numeric"
                value={text}
                onChange={(e) => setAmounts((s) => ({ ...s, [c.id]: e.target.value }))}
                aria-describedby={why ? `grant-why-${c.id}` : undefined}
                className="w-28 border border-border rounded-lg px-3 py-2 text-sm min-h-[44px] bg-background text-foreground"
              />
              <button
                disabled={busy === c.id || blocked}
                onClick={() => void decide(c, true, n)}
                className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 min-h-[44px] font-medium disabled:opacity-40"
              >
                {blocked ? "Consent and credit" : n === 0 ? "Consent at 0" : `Consent and credit ${n}`}
              </button>
              <button
                disabled={busy === c.id}
                onClick={() => void decide(c, false, 0)}
                className="text-sm border border-border rounded-lg px-3 py-2 min-h-[44px]"
              >
                Decline
              </button>
            </div>
            {why && (
              <p id={`grant-why-${c.id}`} className="text-xs text-destructive mt-2">
                {why}
              </p>
            )}
          </div>
        );
      })}

      {underway.length > 0 && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-foreground">Claimed and still underway ({underway.length})</h3>
          <ul className="text-sm text-muted-foreground mt-2 space-y-2">
            {underway.map((c) => (
              <li key={c.id}>
                {c.userName} on {c.questTitle}
                {c.confidence ? `, ${CONFIDENCE_WORDS[c.confidence]}` : ""}
                {c.confidenceNote && (c.confidence === "at_risk" || c.confidence === "stuck") && (
                  <span className="block italic">&ldquo;{c.confidenceNote}&rdquo;</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {decided.length > 0 && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-foreground">Recently decided</h3>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1">
            {decided.map((c) => (
              <li key={c.id}>
                {c.userName} on {c.questTitle}: {c.status === "consented" ? `consented at ${c.amount ?? 0}` : "declined"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The claims read behind this section, with the three states the page keeps for
 * its own queue: refused, failed and answered. `claims` stays null until it
 * answers. The page reads `refused` to decide whether it refuses as a whole,
 * because a steward refused the queue may still hold this key.
 */
export function useConsentClaims(headers: () => Record<string, string>) {
  const [claims, setClaims] = useState<ConsentClaim[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/quest-claims", { headers: headers() });
      if (r.status === 401 || r.status === 403 || r.status === 409) {
        setRefused(true);
        setError(null);
        setClaims(null);
        return;
      }
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) {
        setRefused(false);
        setError((d as { error?: string } | null)?.error ?? "Could not read the claims");
        return;
      }
      setRefused(false);
      setError(null);
      setClaims(d as ConsentClaim[]);
    } catch {
      setError("Could not reach the server");
    }
  }, [headers]);
  return { claims, refused, error, load };
}
