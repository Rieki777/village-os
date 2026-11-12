/**
 * What the signed-in member says they can give now (0383, lane E1): the word
 * that holds today and the dated history behind it. The Open work board, the
 * roles list and the profile's own control all read it through this hook.
 *
 * Signed out, or before the read lands, `pct` is null and every surface
 * behaves as it did before: nothing hidden, nothing reordered.
 */
import { useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import type { CommitmentPeriod, MemberCommitment } from "@shared/commitment";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

interface Answer {
  now: MemberCommitment | null;
  history: MemberCommitment[];
}

const readAnswer = (d: unknown): Answer => {
  const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
  return {
    now: (o.now as MemberCommitment | null) ?? null,
    history: Array.isArray(o.history) ? (o.history as MemberCommitment[]) : [],
  };
};

export function useMyCommitment(signedIn: boolean): {
  /** The percent that holds today, or null when none is said. */
  pct: number | null;
  now: MemberCommitment | null;
  history: MemberCommitment[];
  loaded: boolean;
  /** Say a new commitment; a new entry in the history. Answers the server's sentence on a refusal. */
  say: (next: { pct: number; period: CommitmentPeriod; note?: string | null }) => Promise<{ ok: true } | { ok: false; error: string }>;
} {
  const [answer, setAnswer] = useState<Answer>({ now: null, history: [] });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!signedIn) {
      setLoaded(true);
      return;
    }
    let live = true;
    fetch("/api/me/commitment", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setAnswer(readAnswer(d)); })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [signedIn]);
  const say = useCallback(async (next: { pct: number; period: CommitmentPeriod; note?: string | null }) => {
    try {
      const r = await fetch("/api/me/commitment", { method: "POST", headers: headers(), body: JSON.stringify(next) });
      const d = await r.json().catch(() => null);
      if (!r.ok) return { ok: false as const, error: String(d?.error ?? "That did not save. Try again.") };
      setAnswer(readAnswer(d));
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "That did not save. Try again." };
    }
  }, []);
  return { pct: answer.now?.pct ?? null, now: answer.now, history: answer.history, loaded, say };
}
