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
import { BreathingLoader } from "@/components/natural";
import { gameFetch } from "@/lib/gameApi";
import { PANEL_WORDS } from "@shared/applicationReview";
import { civilDayWords } from "@shared/seasonPlans";

interface Served {
  step: string;
  stepWords: string;
  actsNext: string;
  by: string | null;
  roles: string[];
  path: Array<{ label: string; state: "done" | "now" | "later" }>;
}

export default function ApplicationStatus() {
  const params = useParams<{ ref: string }>();
  const ref = String(params.ref ?? "");
  const [s, setS] = useState<Served | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

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

  const byDay = s?.by ? civilDayWords(new Date(s.by).toISOString().slice(0, 10)) : null;

  return (
    <Layout>
      <div className="container max-w-2xl px-4 py-8">
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label={PANEL_WORDS.statusHeading} />
          </div>
        )}
        {state === "missing" && <p className="text-stone-700">{PANEL_WORDS.statusMissing}</p>}
        {state === "ready" && s && (
          <article className="space-y-6" data-application-step={s.step}>
            <header>
              <h1 className="font-display text-3xl font-bold text-stone-900">{PANEL_WORDS.statusHeading}</h1>
              {s.roles.length > 0 && <p className="mt-1 text-stone-600">{s.roles.join(", ")}</p>}
            </header>
            <section aria-label={PANEL_WORDS.statusNext} className="rounded-xl border-2 border-teal-deep/40 bg-white p-5">
              <p className="text-sm font-semibold text-teal-deep">{s.stepWords}</p>
              <p className="mt-1 text-lg text-stone-900">{s.actsNext}</p>
              {byDay && <p className="mt-1 text-stone-700">{PANEL_WORDS.statusBy(byDay)}</p>}
            </section>
            <ol className="space-y-2">
              {s.path.map((p, i) => (
                <li key={i} className="flex min-h-[44px] items-center gap-3 rounded-lg border border-stone-200 bg-white px-4" data-path-state={p.state}>
                  <span aria-hidden="true">{p.state === "done" ? "✓" : p.state === "now" ? "•" : "○"}</span>
                  <span className={p.state === "later" ? "text-stone-600" : "font-medium text-stone-900"}>{p.label}</span>
                  <span className="sr-only">{p.state === "done" ? "done" : p.state === "now" ? "now" : "later"}</span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-stone-600">{PANEL_WORDS.statusPrivate}</p>
          </article>
        )}
      </div>
    </Layout>
  );
}
