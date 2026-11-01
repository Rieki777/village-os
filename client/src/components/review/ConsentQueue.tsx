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
 * consent's home is this page, beside the other things a steward decides, and
 * that tab is only a door to it now.
 *
 * ── A CONSENT IS A YES (Rye, 2026-10-21) ─────────────────────────────────
 *
 * There is no amount to type. A steward used to choose a Gratitude amount inside
 * the quest's advertised range; no quest pays Gratitude now, and the quest pays
 * what it says (0265). Each claim arrives with `pay`, the same answer the
 * quest's card gives and the consent prices from, so the steward reads what
 * saying yes releases before saying it. The route still decides the rest: a
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
import { authToken } from "@/lib/gameApi";
import type { WorkPay } from "@shared/workValue";
import WorkPayBlock from "@/components/WorkPayBlock";

/** One row of `GET /api/admin/quest-claims`: `ClaimRecord` in server/repos/quests.ts, plus `pay`. */
export interface ConsentClaim {
  id: string;
  questId: string;
  questTitle: string;
  userId: string;
  userName: string;
  status: "claimed" | "submitted" | "consented" | "declined";
  artifactUrl?: string | null;
  note?: string | null;
  /** The Gratitude an older consent granted. Null on every consent since 2026-10-21. */
  amount?: number | null;
  claimedAt: string | null;
  submittedAt?: string | null;
  resolvedAt?: string | null;
  confidence?: "on_track" | "at_risk" | "stuck" | null;
  confidenceNote?: string | null;
  /** What saying yes releases. `null` when the claim's quest is gone, so nothing is advertised. */
  pay?: WorkPay | null;
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

const CONFIDENCE_WORDS: Record<NonNullable<ConsentClaim["confidence"]>, string> = {
  on_track: "says it is on track",
  at_risk: "flagged a wobble",
  stuck: "is stuck",
};

function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function ConsentQueue({ claims, refused, error, headers, onChanged, onRetry }: Props) {
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

  const decide = async (c: ConsentClaim, approve: boolean) => {
    setBusy(c.id);
    try {
      // The Response is held before anything says a decision landed, which is
      // what `check-save-honesty.mjs` asks of every control that reports success.
      const res = await fetch(`/api/admin/quest-claims/${c.id}/consent`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ approve }),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        // The server's own sentence. These refusals name the rule a steward just
        // met, and a generic failure teaches them nothing about which one.
        toast.error((d as { error?: string })?.error ?? "That did not go through");
        // Then the list is read again, whenever the server answered at all. The
        // likeliest refusal is a claim another steward decided first, and it has
        // to leave this list instead of keeping buttons that can never work.
        if (res) await onChanged();
        return;
      }
      toast.success(approve ? "Consented. The work is confirmed." : "Declined. The quest is open again.");
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
          Consent is the one step that releases value. Read what they did. Saying yes pays what the quest says.
        </p>
      </div>

      {waiting.length === 0 && (
        <div className={card}>
          <p className="text-sm text-muted-foreground">No finished work is waiting for a witness.</p>
        </div>
      )}

      {waiting.map((c) => {
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

            <div className="mt-4 rounded-lg bg-muted/40 px-3 py-2">
              {c.pay ? (
                <WorkPayBlock pay={c.pay} variant="full" />
              ) : (
                <p className="text-xs text-muted-foreground">Its quest is gone from the board, so nothing is advertised. The server answers when you press.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                disabled={busy === c.id}
                onClick={() => void decide(c, true)}
                className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 min-h-[44px] font-medium disabled:opacity-40"
              >
                Consent
              </button>
              <button
                disabled={busy === c.id}
                onClick={() => void decide(c, false)}
                className="text-sm border border-border rounded-lg px-3 py-2 min-h-[44px]"
              >
                Decline
              </button>
            </div>
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
                {c.userName} on {c.questTitle}: {c.status === "consented" ? (c.amount ? `consented at ${c.amount}` : "consented") : "declined"}
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
    // Signed out, the refusal is already known: the route answers a stranger
    // 401. Asking anyway was a failed request the browser logged on every
    // signed-out visit to /review, so the answer is recorded without the call.
    if (!authToken()) {
      setRefused(true);
      setError(null);
      setClaims(null);
      return;
    }
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
