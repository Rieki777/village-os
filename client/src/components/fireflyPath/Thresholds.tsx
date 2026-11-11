/**
 * THE THRESHOLDS of the open proposal (game feel wave 2, lane 1 option B):
 * "Check your email" after sending, and "Confirmed" from the email's link.
 * You and the village are two circles (the nature kit's Vesica): they touch
 * when you send, and meet when you confirm.
 *
 * PHONE AND DESKTOP. On a phone the drawing leads, one column, and the one act
 * rides within thumb reach above the tab bar. On a desk the page uses its
 * width: the threshold beside a panel of lit side paths to walk while you wait,
 * never a narrow column alone (verify B11, 542px at 1280).
 *
 * Kept apart from pages/ProposeARole.tsx so the form stays one reading
 * (scripts/check-file-lines.mjs); the page re-exports ConfirmProposal.
 */
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { ArrowRight, MailOpen, PenLine } from "lucide-react";
import Layout from "@/components/Layout";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, DOOR, EYEBROW, H1, HINT, LEDE, TILE, WORLD } from "@/components/journey/look";
import { Fireflies, Vesica } from "@/components/journey/nature";
import { BreathingLoader } from "@/components/natural";
import { NextForRoles } from "@/components/openProposal/RoleCardBridge";
import { i18n } from "@/i18n/i18n";
import { LOCALE_STORAGE_KEY, useLocale } from "@/i18n/LocaleProvider";
import { storedText } from "@/lib/safeStorage";
import { isApplicantLanguage } from "@shared/applicantWords";
import { OPEN_CONFIRM_HOURS } from "@shared/openProposals";
import { confirmBy, inboxFor, replyBy } from "./stones";

const BUTTON = `${BTN_PRIMARY} py-3`;

/** What the server said when the proposal went: its words, the address, when, and the days to a first reply. */
export interface SentNote {
  message: string;
  to: string;
  at: Date;
  replyDays: number | null;
}

export function prefersStill(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}


export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Layout>
      <div className={`${WORLD} py-10 sm:py-14`}>
        <div className={`container ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</div>
      </div>
    </Layout>
  );
}

export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-live="polite" className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-bold text-card-foreground outline-none">
        {title}
      </h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
    </section>
  );
}

/** A day and time in the reader's own language and zone, for a dated step. */
function whenWords(d: Date, withTime: boolean): string {
  try {
    return new Intl.DateTimeFormat(i18n.locale || "en", withTime ? { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" } : { weekday: "long", day: "numeric", month: "long" }).format(d);
  } catch {
    return d.toDateString();
  }
}

/**
 * THE DOORS TO WALK WHILE YOU WAIT: pages every village has, open to a
 * visitor. Drawn as lit side paths beside the threshold on a desk, and under
 * it on a phone.
 */
function WhileYouWait() {
  const { t } = useLingui();
  const doors: Array<[string, string, string]> = [
    ["/quests", t({ message: "Take a quest", context: "while you wait" }), t({ message: "Alone or with others, no role needed", context: "while you wait" })],
    ["/roles", t({ message: "Meet the other roles", context: "while you wait" }), t({ message: "Who you would work beside", context: "while you wait" })],
    ["/love-letter", t({ message: "Read the Love Letter slowly", context: "while you wait" }), t({ message: "How we live together", context: "while you wait" })],
  ];
  return (
    <nav aria-labelledby="wait-doors-h" className={`${CARD} grid gap-3`} data-wait-doors="">
      <h2 id="wait-doors-h" className={EYEBROW}>
        {t({ message: "Paths lit while you wait", context: "while you wait" })}
      </h2>
      <ul className="grid gap-2">
        {doors.map(([href, title, line]) => (
          <li key={href}>
            <Link href={href} className={`jw-btn min-h-14 ${DOOR}`}>
              <span className="grid min-w-0 flex-1">
                <span>{title}</span>
                <span className="text-xs font-normal text-muted-foreground">{line}</span>
              </span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The link in the confirmation email: a threshold, where you and the village meet. */
export function ConfirmProposal() {
  const { t } = useLingui();
  const locale = useLocale();
  const gone = t`That link has run out or was already used. Send your proposal again, and open the new link within ${OPEN_CONFIRM_HOURS} hours.`;
  const [said, setSaid] = useState<{ ok: boolean; message: string; statusPath?: string | null; replyDays?: number | null } | null>(null);
  const [met, setMet] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    fetch("/api/open-proposals/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        // The applicant's own page (role journey L5): shown once here as well as mailed, and only an address of its own.
        const statusPath = typeof data?.statusPath === "string" && data.statusPath.startsWith("/application-status/") ? data.statusPath : null;
        // The page speaks the language they proposed in, unless this browser has already chosen one.
        if (r.ok && isApplicantLanguage(data?.locale) && data.locale !== i18n.locale && !storedText("local", LOCALE_STORAGE_KEY) && locale.supported.includes(data.locale)) locale.setLocale(data.locale);
        const replyDays = typeof data?.replyDays === "number" ? data.replyDays : null;
        setSaid({ ok: r.ok, message: typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : gone, statusPath, replyDays });
      })
      .catch(() => setSaid({ ok: false, message: gone }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The two circles meet once the page is up, so the meeting is seen.
  useEffect(() => {
    if (!said?.ok) return;
    const id = window.setTimeout(() => setMet(true), prefersStill() ? 0 : 250);
    return () => window.clearTimeout(id);
  }, [said?.ok]);

  if (!said) {
    return (
      <Shell>
        <BreathingLoader label={t({ message: "Confirming your proposal", context: "open proposal" })} showLabel />
      </Shell>
    );
  }
  if (!said.ok) {
    return (
      <Shell>
        <Notice title={t`That link didn't work`}>
          <p>{said.message}</p>
          <a href="/propose-a-role" className={`${BUTTON} mt-6`}>
            {t({ message: "Propose again", context: "open proposal confirm" })}
          </a>
        </Notice>
      </Shell>
    );
  }
  const by = said.replyDays ? replyBy(new Date(), said.replyDays) : null;
  const byWords = by ? whenWords(by, false) : "";
  return (
    <Shell wide>
      <div data-hides-fab-phone="" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" data-threshold="confirmed">
        <section aria-live="polite" className={`${CARD} grid gap-5 text-center lg:text-left`}>
          <div className="flex justify-center lg:justify-start">
            <Vesica met={met} size="lg" label={t({ message: "You and the village, met", context: "open proposal confirmed drawing" })} names={[t({ message: "You", context: "open proposal confirmed drawing" }), t({ message: "The village", context: "open proposal confirmed drawing" })]} />
          </div>
          <ConfirmedHeading title={t({ message: "Confirmed", context: "open proposal confirm" })} />
          <p className={`${LEDE} mx-auto lg:mx-0`}>{t`Your proposal is with the village now. We read every word, and we write to you by email.`}</p>
          <ol className="grid gap-2 text-left text-sm text-foreground" data-dated-steps="">
            <li className={TILE}>
              {by
                ? t({ message: `We write to you by ${byWords} with what comes next.`, context: "open proposal confirmed step" })
                : t({ message: "We write to you with what comes next.", context: "open proposal confirmed step" })}
            </li>
          </ol>
          {said.statusPath && (
            <div className="sticky bottom-[calc(var(--tabbar-h)+0.75rem)] z-10 grid justify-items-center gap-2 lg:static lg:justify-items-start">
              <Fireflies block>
                <a href={said.statusPath} className={`${BUTTON} w-full sm:w-auto`} data-status-link="">
                  {t`Follow where your proposal is`}
                  <ArrowRight className="size-5" aria-hidden="true" />
                </a>
              </Fireflies>
            </div>
          )}
          {said.statusPath && <p className={HINT}>{t`We emailed you this link too. Keep it to yourself: it is how we know it is you.`}</p>}
        </section>
        <aside className="grid gap-4">
          <WhileYouWait />
        </aside>
      </div>
    </Shell>
  );
}

export function ConfirmedHeading({ title }: { title: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <h1 ref={heading} tabIndex={-1} className={`${H1} outline-none`}>
      {title}
    </h1>
  );
}


/**
 * THE SENT THRESHOLD: two circles that touch and have not met yet. The inbox
 * when we know the provider, a way to fix the address, the next steps with
 * their dates, and paths to walk while you wait. No resend: the server has no
 * route for it, so "fix the address" sends a fresh proposal, and one nobody
 * confirms is deleted on its own.
 */
export function SentThreshold({ sent, roles, onFixAddress }: { sent: SentNote; roles: ComponentProps<typeof NextForRoles>["roles"]; onFixAddress: () => void }) {
  const { t } = useLingui();
  const inbox = inboxFor(sent.to);
  const until = confirmBy(sent.at, OPEN_CONFIRM_HOURS);
  const reply = sent.replyDays ? replyBy(until, sent.replyDays) : null;
  const inboxName = inbox?.name ?? "";
  const untilWords = whenWords(until, true);
  const replyWords = reply ? whenWords(reply, false) : "";
  const sentTo = sent.to;
  return (
    <Shell wide>
      <div data-hides-fab-phone="" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" data-threshold="sent">
        <section aria-live="polite" className={`${CARD} grid gap-5`}>
          <div className="flex justify-center lg:justify-start">
            <Vesica met={false} size="lg" label={t({ message: "You and the village, about to meet", context: "open proposal sent drawing" })} names={[t({ message: "You", context: "open proposal sent drawing" }), t({ message: "The village", context: "open proposal sent drawing" })]} />
          </div>
          <ConfirmedHeading title={t({ message: "Check your email", context: "open proposal sent" })} />
          <p className={LEDE}>{sent.message}</p>
          <div className="sticky bottom-[calc(var(--tabbar-h)+0.75rem)] z-10 flex flex-wrap items-center gap-3 lg:static">
            {inbox && (
              <Fireflies block className="w-full sm:w-auto">
                <a href={inbox.href} target="_blank" rel="noopener noreferrer" className={`${BUTTON} w-full sm:w-auto`} data-inbox-link="">
                  <MailOpen className="size-5" aria-hidden="true" />
                  {t({ message: `Open ${inboxName}`, context: "open proposal sent" })}
                </a>
              </Fireflies>
            )}
            <button
              type="button"
              className={BTN_SECONDARY}
              data-fix-address=""
              onClick={onFixAddress}
            >
              <PenLine className="size-4" aria-hidden="true" />
              {t({ message: `Not ${sentTo}? Fix the address`, context: "open proposal sent" })}
            </button>
          </div>
          <div className="grid gap-2">
            <h2 className={EYEBROW}>{t({ message: "What comes next", context: "open proposal sent" })}</h2>
            <ol className="grid gap-2 text-sm text-foreground" data-dated-steps="">
              <li className={TILE}>{t({ message: `Open the link in that email by ${untilWords}. Until you do, nothing reaches the village, and after that we delete what you sent.`, context: "open proposal sent step" })}</li>
              <li className={TILE}>
                {reply
                  ? t({ message: `Then the circle reads it, and we write to you by ${replyWords}.`, context: "open proposal sent step" })
                  : t({ message: "Then the circle reads it, and we write to you by email.", context: "open proposal sent step" })}
              </li>
            </ol>
            {/* The steps after confirming, for the roles picked (Rye's answer 7): conversations in order, the booking link. */}
            <NextForRoles roles={roles} />
          </div>
          <p className={HINT}>{t`No email after a few minutes? Look in spam or promotions, or fix the address and send again. A proposal nobody confirms is deleted on its own.`}</p>
        </section>
        <aside className="grid gap-4">
          <WhileYouWait />
        </aside>
      </div>
    </Shell>
  );
}
