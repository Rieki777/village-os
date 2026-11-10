/**
 * `/application-status/:ref?token=`: THE APPLICANT'S PAGE (role journey L5).
 * The step they are on, who acts next (a role, never a person) and by when.
 * It shows steps only: no score, no note and no name ever reaches it
 * (server/routes/applicationReview.ts, shared/applicationReview.ts `statusFor`).
 * A visitor reaches it by the link in their email; a member by their profile.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import Layout from "@/components/Layout";
import { BTN_SECONDARY, CARD_FEATURED, EYEBROW, H1, TILE, WORLD } from "@/components/journey/look";
import { Check } from "lucide-react";
import { BreathingLoader, useReducedMotion } from "@/components/natural";
import { gameFetch } from "@/lib/gameApi";
import { PANEL_WORDS } from "@shared/applicationReview";
import { DECLINED_PAGE_WORDS, replyPromise } from "@shared/openProposalDecide";
import { civilDayWords } from "@shared/seasonPlans";

interface Served {
  step: string;
  stepWords: string;
  actsNext: string;
  by: string | null;
  roles: string[];
  path: Array<{ label: string; state: "done" | "now" | "later" }>;
  booking: string | null;
  mode: "block" | "split";
  outcome?: "adopted" | "declined" | "withdrawn" | null;
  replyDays?: number;
}

export default function ApplicationStatus() {
  const params = useParams<{ ref: string }>();
  const ref = String(params.ref ?? "");
  const [s, setS] = useState<Served | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [said, setSaid] = useState<string | null>(null);
  const token = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("token") ?? "");

  const split = async () => {
    const url = token ? `/api/application-status/${encodeURIComponent(ref)}/split?token=${encodeURIComponent(token)}` : `/api/governance/applications/${encodeURIComponent(ref)}/split`;
    try {
      const res = await gameFetch(url, { method: "POST", body: "{}", cache: "no-store" });
      const data = await res.json().catch(() => null);
      setSaid(String(data?.message ?? data?.error ?? ""));
      if (res.ok) setS((cur) => (cur ? { ...cur, mode: "split" } : cur));
    } catch {
      setSaid(PANEL_WORDS.statusMissing);
    }
  };

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const url = token ? `/api/application-status/${encodeURIComponent(ref)}?token=${encodeURIComponent(token)}` : `/api/governance/applications/${encodeURIComponent(ref)}/status`;
    void (async () => {
      try {
        const res = await gameFetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.status) {
          setS(data.status as Served);
          setState("ready");
        } else setState("missing");
      } catch {
        setState("missing");
      }
    })();
  }, [ref]);

  const still = useReducedMotion();
  const byDay = s?.by ? civilDayWords(new Date(s.by).toISOString().slice(0, 10)) : null;

  return (
    <Layout>
      <div className={`${WORLD} py-4 sm:py-10`}>
      <div className="container max-w-2xl px-4 py-8">
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label={PANEL_WORDS.statusHeading} />
          </div>
        )}
        {state === "missing" && <p className="sel-rise rounded-2xl border-2 border-dashed border-border bg-card p-6 text-foreground">{PANEL_WORDS.statusMissing}</p>}
        {state === "ready" && s && (
          <article className="space-y-6" data-application-step={s.step}>
            <header>
              <h1 className={H1}>{PANEL_WORDS.statusHeading}</h1>
              {s.roles.length > 0 && <p className="mt-1 text-muted-foreground">{s.roles.join(", ")}</p>}
            </header>
            <section aria-label={PANEL_WORDS.statusNext} className={`sel-rise ${CARD_FEATURED}`}>
              <p className={EYEBROW}>{s.stepWords}</p>
              <p className="mt-1 text-lg text-foreground">
                <span className="font-semibold">{PANEL_WORDS.statusNext}: </span>
                {s.actsNext}
              </p>
              {byDay && <p className="mt-1 text-foreground">{PANEL_WORDS.statusBy(byDay)}</p>}
              {s.outcome == null && typeof s.replyDays === "number" && <p className="mt-1 text-foreground" data-reply-promise="">{replyPromise(s.replyDays)}</p>}
            </section>
            {s.outcome === "declined" && (
              <section aria-label={DECLINED_PAGE_WORDS.heading} className="rounded-xl border border-border bg-card p-4" data-declined="">
                <h2 className="font-display text-xl font-bold text-foreground">{DECLINED_PAGE_WORDS.heading}</h2>
                <p className="mt-1 text-foreground">{DECLINED_PAGE_WORDS.line}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground">
                  <li><a className="font-semibold underline" href={DECLINED_PAGE_WORDS.quests.href}>{DECLINED_PAGE_WORDS.quests.label}</a></li>
                  <li><a className="font-semibold underline" href={DECLINED_PAGE_WORDS.roles.href}>{DECLINED_PAGE_WORDS.roles.label}</a></li>
                  <li>{DECLINED_PAGE_WORDS.again}</li>
                </ul>
              </section>
            )}
            {/* The path as stepping stones: the line fills down to where you stand, one stone after another, and the
                stone you are on answers with a ring on the water. Reduce motion: the filled path, at once. */}
            <ol className="jw-trail-v" data-motion={still ? "still" : "live"}>
              {s.path.map((p, i) => (
                <li
                  key={i}
                  className="sel-rise flex min-h-[52px] items-center gap-3 py-1"
                  data-path-state={p.state}
                  aria-current={p.state === "now" ? "step" : undefined}
                  style={{ animationDelay: `${i * 80}ms`, ["--jw-delay" as string]: `${i * 80}ms` }}
                >
                  <span className="jw-stone flex w-11 shrink-0 justify-center" data-state={p.state === "done" ? "done" : p.state === "now" ? "here" : "ahead"} aria-hidden="true">
                    <span className="jw-stone-face !m-0">{p.state === "done" ? <Check className="size-4" /> : p.state === "now" ? i + 1 : ""}</span>
                  </span>
                  <span className={p.state === "later" ? "text-muted-foreground" : p.state === "now" ? "font-bold text-foreground" : "font-medium text-foreground"}>{p.label}</span>
                  <span className="sr-only">{p.state === "done" ? "done" : p.state === "now" ? "now" : "later"}</span>
                </li>
              ))}
            </ol>
            {s.booking && (
              <section aria-label={PANEL_WORDS.bookingLabel} className={TILE}>
                <p className="text-foreground">{s.booking}</p>
                {s.mode === "block" && (
                  <button
                    type="button"
                    onClick={() => void split()}
                    className={`mt-3 ${BTN_SECONDARY}`}
                  >
                    {PANEL_WORDS.splitAsk}
                  </button>
                )}
                {said && <p role="status" className="mt-2 text-sm text-foreground">{said}</p>}
              </section>
            )}
            <p className="text-sm text-muted-foreground">{PANEL_WORDS.statusPrivate}</p>
          </article>
        )}
      </div>
      </div>
    </Layout>
  );
}
