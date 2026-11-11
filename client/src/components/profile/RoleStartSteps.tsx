/**
 * THE STEPS BEFORE YOUR ROLE STARTS, ON YOUR PROFILE (role journey L7).
 *
 * A new holder signs up and lands on their profile. When a role of theirs was
 * adopted and waits on agreements, this card is the first thing above the
 * tabs: "Before you start", every step with its door (and the role terms
 * that wait on the holder, so there is one card and no second "Your move"). The
 * confidentiality agreement is aligned with right here; the membership letter
 * opens on its own page, which is always open to somebody signed in; a paid
 * role's terms open on the application. The role starts within the hour after
 * the last one, and this card goes once nothing waits.
 *
 * Nothing waiting, nothing drawn. The words are the notice's own
 * (shared/roleStartWords.ts), so the bell and the profile say the same thing.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Hourglass } from "lucide-react";
import { START_WORDS, type StartStep } from "@shared/roleStartWords";
import { SEAT_OPENS_WORDS } from "@shared/openProposalDecide";
import ConfidentialityCard from "@/components/alignment/ConfidentialityCard";
import { authToken } from "@/lib/gameApi";
import { call, fetchMyAlignments } from "@/components/alignment/alignmentsApi";
import { waitingOnYou } from "./YourMoveCard";

type Waiting = { applicationId: string; roles: string[]; steps: Array<{ step: StartStep; href: string }>; waitsForSeat?: boolean };

export default function RoleStartSteps({ className = "", onShown }: { className?: string; onShown?: (shown: boolean) => void } = {}) {
  const [waiting, setWaiting] = useState<Waiting[] | null>(null);
  /** Role terms that wait on this reader and are not one of the steps above: they are listed here too, so "Your move" has no second card (audit M8). */
  const [extra, setExtra] = useState<Array<{ key: string; title: string; href: string }>>([]);

  const load = useCallback(() => {
    void call<{ waiting: Waiting[] }>("/api/profile/role-start-steps").then((a) => setWaiting(a.ok ? (a.data.waiting ?? []) : []));
  }, []);
  useEffect(load, [load]);
  // Every step any waiting role still asks, once each, in the order they are met.
  const steps = Array.from(new Map((waiting ?? []).flatMap((w) => w.steps).map((s) => [s.step, s])).values());
  const shown = !!waiting && waiting.length > 0;
  const hasTermsStep = steps.some((s) => s.step === "terms");
  useEffect(() => {
    onShown?.(shown);
  }, [shown, onShown]);
  useEffect(() => {
    if (!shown || !authToken()) return;
    let alive = true;
    void fetchMyAlignments().then((r) => {
      if (!alive || !r.ok) return;
      setExtra(
        waitingOnYou(r.data?.alignments)
          .filter((a) => (a.kind ?? "seat_terms") === "seat_terms" && !hasTermsStep)
          .map((a) => ({ key: `${a.textId ?? a.title}-${a.version}`, title: a.title, href: a.href ?? "/aligned" })),
      );
    });
    return () => {
      alive = false;
    };
  }, [shown, hasTermsStep]);

  if (!shown || !waiting) return null;
  const roles = waiting.flatMap((w) => w.roles);
  // Every seat taken (audit B3): the honest line, never "within the hour".
  const full = waiting.filter((w) => w.waitsForSeat).flatMap((w) => w.roles);
  return (
    <section aria-labelledby="role-start-h" data-role-start-steps="" className={`rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm ${className}`}>
      <h2 id="role-start-h" className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
        <Hourglass className="size-5 shrink-0 text-notice" aria-hidden="true" />
        {steps.length === 0 && extra.length === 0 && full.length ? SEAT_OPENS_WORDS.heldTitle : START_WORDS.cardTitle}
      </h2>
      {roles.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{roles.join(", ")}</p>}
      <ol className="mt-4 grid gap-3">
        {steps.map((s) => (
          <li key={s.step} data-step={s.step} className="text-sm text-foreground">
            {s.step === "confidentiality" ? (
              // The card names the step in its own heading, so it reads once, and it sits inside this card without a second frame.
              <ConfidentialityCard onAligned={load} embedded />
            ) : (
              <Link href={s.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {START_WORDS.step[s.step]}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
        {extra.map((x) => (
          <li key={x.key} data-step="terms-waiting" className="text-sm text-foreground">
            <Link href={x.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              {START_WORDS.alignWith(x.title)}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground" data-start-after={full.length ? "seat" : "hour"}>
        {full.length ? (steps.length || extra.length ? SEAT_OPENS_WORDS.after(full) : SEAT_OPENS_WORDS.held(full)) : START_WORDS.after}
      </p>
    </section>
  );
}
