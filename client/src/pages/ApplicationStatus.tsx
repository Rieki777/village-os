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
import { BTN_SECONDARY, CARD, CARD_FEATURED, EYEBROW, H1, H2, LINK, TILE, WORLD } from "@/components/journey/look";
import { Check } from "lucide-react";
import { BreathingLoader, useReducedMotion } from "@/components/natural";
import { gameFetch } from "@/lib/gameApi";
import { DECLINED_PAGE_WORDS } from "@shared/openProposalDecide";
import { chooseApplicantLanguage } from "@shared/applicantLanguage";
import { statusView, wordsIn } from "@shared/applicantWords";
import { useLingui } from "@lingui/react/macro";
import { TERM_NOTE_MAX } from "@shared/termsWords";

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
  /** A count only: how many references the applicant gave (shared/proposalAbout.ts). */
  referencesGiven?: number | null;
  /** The applicant's language, and a decider's note for them (server/lib/applicationReview.ts statusOf). */
  locale?: string;
  note?: string | null;
  /** The terms we changed for this proposal, beside what the applicant answered (joining lane PR 4). Never the log. */
  offer?: ServedOffer | null;
}

interface ServedOffer {
  revision: number;
  open: number;
  mayAnswer: boolean;
  rows: Array<{
    key: string;
    label: string;
    ours: string;
    theirs: { choice: "accept" | "talk"; note: string } | null;
    theirCommitment: number | null;
    state: "accept" | "talk" | "waiting";
    reply: { choice: "accept" | "talk"; note: string } | null;
  }>;
}

type Pick = { choice: "accept" | "talk"; note: string };

/** The terms we changed: each one beside the applicant's own answer, with "I accept" and "Let's talk" again. */
export function ChangedTerms({ offer, answerUrl, onSaved }: { offer: ServedOffer; answerUrl: string; onSaved: (o: ServedOffer | null) => void }) {
  const { t } = useLingui();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const now = (r: ServedOffer["rows"][number]): Pick | null => picks[r.key] ?? r.reply;
  const send = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await gameFetch(answerUrl, { method: "POST", body: JSON.stringify({ replies: picks }), cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setSaid({ ok: false, text: String(data?.message ?? data?.error ?? t`That did not save. Try again.`) });
      else {
        setPicks({});
        setSaid({ ok: true, text: t`Thank you. We have your answers.` });
        onSaved(data?.offer ?? null);
      }
    } catch {
      setSaid({ ok: false, text: t`That did not save. Try again.` });
    } finally {
      setBusy(false);
    }
  };
  const choice = (c: "accept" | "talk") => (c === "accept" ? t({ message: `I accept`, context: "applicant's application status, terms" }) : t({ message: `Let's talk`, context: "applicant's application status, terms" }));
  return (
    <section aria-labelledby="changed-terms" className="rounded-2xl border-2 border-notice/60 bg-card p-5 shadow-sm sm:p-6" data-changed-terms="">
      <p className="text-xs font-semibold uppercase tracking-widest text-notice">{t({ message: `Terms`, context: "applicant's application status, terms" })}</p>
      <h2 id="changed-terms" className="font-display text-2xl font-bold text-card-foreground">{t`We changed some of the terms`}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t`Here is our new wording beside what you answered. Settings we did not change stay as you accepted them.`}</p>
      <ul className="mt-4 grid gap-3">
        {offer.rows.map((r) => (
          <li key={r.key} className="rounded-xl border border-border bg-muted p-4" data-changed-term={r.key}>
            <h3 className="font-semibold text-foreground">{r.label}</h3>
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t({ message: `Our wording now`, context: "applicant's application status, terms" })}</p>
            <p className="whitespace-pre-wrap break-words text-foreground">{r.ours}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t({ message: `What you answered`, context: "applicant's application status, terms" })}</p>
            <p className="whitespace-pre-wrap break-words text-foreground">
              {r.theirCommitment != null ? `${r.theirCommitment}%` : r.theirs ? `${choice(r.theirs.choice)}${r.theirs.note ? `: ${r.theirs.note}` : ""}` : t`You did not answer this one.`}
            </p>
            {offer.mayAnswer && (
              <fieldset className="mt-3">
                <legend className="sr-only">{r.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {(["accept", "talk"] as const).map((c) => {
                    const on = now(r)?.choice === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicks((p) => ({ ...p, [r.key]: { choice: c, note: p[r.key]?.note ?? r.reply?.note ?? "" } }))}
                        className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-notice bg-notice text-background" : "border-border text-foreground hover:bg-card"}`}
                      >
                        {choice(c)}
                      </button>
                    );
                  })}
                </div>
                {now(r)?.choice === "talk" && (
                  <label className="mt-2 block">
                    <span className="text-sm font-semibold text-foreground">{t`What would you like to talk about?`}</span>
                    <textarea
                      rows={2}
                      maxLength={TERM_NOTE_MAX}
                      value={now(r)?.note ?? ""}
                      onChange={(e) => setPicks((p) => ({ ...p, [r.key]: { choice: "talk", note: e.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                )}
                {r.state === "waiting" && !picks[r.key] && <p className="mt-2 text-sm text-muted-foreground">{t`We are waiting for your answer.`}</p>}
              </fieldset>
            )}
          </li>
        ))}
      </ul>
      {offer.mayAnswer && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || Object.keys(picks).length === 0}
            onClick={() => void send()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-notice px-5 py-2 font-semibold text-background hover:bg-notice/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t({ message: `Send my answers`, context: "applicant's application status, terms" })}
          </button>
          {said && <p role="status" className={said.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>{said.text}</p>}
        </div>
      )}
    </section>
  );
}

export default function ApplicationStatus() {
  const { i18n } = useLingui();
  const params = useParams<{ ref: string }>();
  const ref = String(params.ref ?? "");
  const [s, setS] = useState<Served | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [said, setSaid] = useState<string | null>(null);
  const token = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("token") ?? "");

  // The words this page owns follow the language the person is reading the site in, else the one kept on their proposal.
  const lang = chooseApplicantLanguage({ chosenOnSite: i18n.locale, profile: s?.locale ?? null }).language;
  const w = wordsIn(lang);
  const view = s ? statusView(lang, s) : null;

  const split = async () => {
    const url = token ? `/api/application-status/${encodeURIComponent(ref)}/split?token=${encodeURIComponent(token)}` : `/api/governance/applications/${encodeURIComponent(ref)}/split`;
    try {
      const res = await gameFetch(url, { method: "POST", body: "{}", cache: "no-store" });
      const data = await res.json().catch(() => null);
      setSaid(String(data?.message ?? data?.error ?? ""));
      if (res.ok) setS((cur) => (cur ? { ...cur, mode: "split" } : cur));
    } catch {
      setSaid(w.status.missing);
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
  const byDay = s?.by && !s.outcome ? w.day(new Date(s.by).toISOString().slice(0, 10)) : null;

  return (
    <Layout>
      <div className={`${WORLD} py-4 sm:py-10`}>
      <div className="container max-w-2xl px-4 py-8">
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label={w.status.heading} />
          </div>
        )}
        {state === "missing" && <p className="sel-rise rounded-2xl border-2 border-dashed border-border bg-card p-6 text-foreground">{w.status.missing}</p>}
        {state === "ready" && s && view && (
          <article className="space-y-6" data-application-step={s.step}>
            <header>
              <h1 className={H1}>{w.status.heading}</h1>
              {s.roles.length > 0 && <p className="mt-1 text-muted-foreground">{s.roles.join(", ")}</p>}
            </header>
            <section aria-label={w.status.nextLabel} className={`sel-rise ${CARD_FEATURED}`}>
              <p className={EYEBROW}>{view.stepWords}</p>
              <p className="mt-1 text-lg text-foreground">{view.move}</p>
              {byDay && <p className="mt-1 text-foreground">{w.status.by(byDay)}</p>}
              {s.outcome == null && typeof s.replyDays === "number" && <p className="mt-1 text-foreground" data-reply-promise="">{w.replyPromise(s.replyDays)}</p>}
            </section>
            {s.note && (
              <section aria-label={w.page.noteHeading} className="rounded-xl border border-border bg-card p-4" data-applicant-note="">
                <h2 className="font-display text-xl font-bold text-foreground">{w.page.noteHeading}</h2>
                <p className="mt-1 whitespace-pre-line text-foreground">{s.note}</p>
              </section>
            )}
            {s.outcome === "declined" && (
              <section aria-label={w.page.declinedHeading} className="rounded-xl border border-border bg-card p-4" data-declined="">
                <h2 className="font-display text-xl font-bold text-foreground">{w.page.declinedHeading}</h2>
                <p className="mt-1 text-foreground">{w.page.declinedLine}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground">
                  <li><a className="font-semibold underline" href={DECLINED_PAGE_WORDS.quests.href}>{w.page.quests}</a></li>
                  <li><a className="font-semibold underline" href={DECLINED_PAGE_WORDS.roles.href}>{w.page.roles}</a></li>
                  <li>{w.page.again}</li>
                </ul>
              </section>
            )}
            {s.offer && s.offer.rows.length > 0 && (
              <ChangedTerms
                offer={s.offer}
                answerUrl={token ? `/api/application-status/${encodeURIComponent(ref)}/terms?token=${encodeURIComponent(token)}` : `/api/governance/applications/${encodeURIComponent(ref)}/terms`}
                onSaved={(o) => setS((cur) => (cur ? { ...cur, offer: o } : cur))}
              />
            )}
            {/* The path as stepping stones: the line fills down to where you stand, one stone after another, and the
                stone you are on answers with a ring on the water. Reduce motion: the filled path, at once. */}
            <ol className="jw-trail-v" data-motion={still ? "still" : "live"}>
              {view.path.map((p, i) => (
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
                  <span className="sr-only">{p.state === "done" ? w.status.stateDone : p.state === "now" ? w.status.stateNow : w.status.stateLater}</span>
                </li>
              ))}
            </ol>
            {view.references && (
              <p className="text-sm text-muted-foreground" data-references-given="">{view.references}</p>
            )}
            {view.booking && (
              <section aria-label={w.status.booking.label} className={TILE}>
                <p className="text-foreground">{view.booking.text}</p>
                {view.booking.canSplit && (
                  <button
                    type="button"
                    onClick={() => void split()}
                    className={`mt-3 ${BTN_SECONDARY}`}
                  >
                    {w.status.booking.splitAsk}
                  </button>
                )}
                {said && <p role="status" className="mt-2 text-sm text-foreground">{said}</p>}
              </section>
            )}
            {s.outcome == null && (
              <section aria-labelledby="while-you-wait" className={CARD} data-while-you-wait="">
                <h2 id="while-you-wait" className={H2}>{w.status.wait.heading}</h2>
                <p className="mt-1 text-foreground">{w.status.wait.line}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground">
                  <li><a className={LINK} href="/quests">{w.status.wait.quests}</a></li>
                  <li><a className={LINK} href="/map">{w.status.wait.map}</a></li>
                  <li><a className={LINK} href="/events">{w.status.wait.events}</a></li>
                </ul>
              </section>
            )}
            <p className="text-sm text-muted-foreground">{w.status.private}</p>
          </article>
        )}
      </div>
      </div>
    </Layout>
  );
}
