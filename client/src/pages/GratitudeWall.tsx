/**
 * THE GRATITUDE WALL.
 *
 * The page this replaced opened with a heading, a tooltip, a clock and a form,
 * and the gratitude itself was a list of small quotes underneath all of it. A
 * wall opens with the writing on it. So `VoicesHero` is first and carries no
 * number of any kind, and the send panel is what a member does in RESPONSE to
 * the wall rather than the door into it.
 *
 * ── THE NIGHT WORLD, AND WHY THE MIGRATION HAD TO BE IN PAIRS ────────────
 *
 * `sheet-night` (client/src/index.css) redeclares the semantic colour tokens
 * on this element, so every descendant reading `bg-card`, `text-muted-
 * foreground` and `border-border` resolves them against the night world. It is
 * the same class the character sheet uses and it needed no component edits
 * there, because that page had already been migrated to the semantic set.
 *
 * This page had not. It paired hardcoded surfaces (`bg-white`, `bg-stone-50`)
 * with hardcoded stone text, and that pairing is exactly what kept it safe:
 * neither half answers to a theme, so both held. `--muted-foreground` IS
 * theme-responsive, so dropping `text-muted-foreground` onto a card still
 * painted white measures 2.76:1 at night, an AA failure invisible to anyone
 * testing in daylight. Every pair on this page therefore moved BOTH halves in
 * one edit, and `index.css` records two earlier shipments of the sibling bug.
 *
 * ── WHAT IS DELIBERATELY NOT ON THE HERO ─────────────────────────────────
 *
 * Totals, names, amounts, dates and counts. A number beside a piece of
 * gratitude turns a human sentence into a dashboard tile and the reader starts
 * scanning the figure. The meter and the hearts a member genuinely needs in
 * order to play are in the send panel, below, where they are labelled.
 */
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch, fetchGameMe, GameMe } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Send, Sparkles } from "lucide-react";
import CycleClock from "@/components/CycleClock";
import { forgetExamplesCache } from "@/components/ExamplesBanner";
import InfoTip from "@/components/InfoTip";
import MoonDock from "@/components/profile/MoonDock";
import NightMotes from "@/components/profile/NightMotes";
import VoicesHero from "@/components/gratitude/VoicesHero";
import HeartsRow from "@/components/gratitude/HeartsRow";
import WallEntryCard from "@/components/gratitude/WallEntryCard";
import type { WallEntry } from "@shared/gratitudeVoices";

interface SentEntry {
  toId?: string | null;
  cycleId?: string | null;
}

export default function GratitudeWall() {
  const { user } = useAuth();
  const [wall, setWall] = useState<WallEntry[]>([]);
  // undefined = not loaded (or the load failed); null = loaded, no game state.
  // fetchGameMe returns null for BOTH a 500 and a real absence, so without
  // this distinction a failed fetch rendered as a factual claim about the
  // member's standing ("your budget unlocks as you progress") when in truth
  // they may have had a full budget all along.
  const [me, setMe] = useState<GameMe | null | undefined>(undefined);
  /**
   * Distinct people this member has thanked this cycle, which is what the
   * hearts count. Null means UNKNOWN and the row stays away: a zero here would
   * draw a full set of open hearts at somebody who has already given, which is
   * a claim about them and not a gap in the render.
   */
  const [peopleThanked, setPeopleThanked] = useState<number | null>(null);
  const currency = useTokenName("Recognition");
  // `to` carries whatever the member typed: an @handle, or an address for
  // anyone who still knows one. The server tells the two apart and looks the
  // handle up; see `recipientFor` in server/index.ts for why a handle is the
  // one of the two a member can actually obtain.
  const [form, setForm] = useState({ to: "", amount: 10, message: "" });
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    fetch("/api/game/gratitude/wall")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setWall(Array.isArray(d) ? d : []))
      .catch(() => { /* silent */ });
    fetchGameMe().then(setMe);
  };

  useEffect(load, []);

  /* The one thing on this form the village decides. See the textarea below. */
  const [requireMessage, setRequireMessage] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    gameFetch("/api/game/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setRequireMessage(Boolean(d?.gratitude?.requireMessage));
      })
      .catch(() => {
        /* stays optional, which is the server's own default posture */
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The people, counted from this member's own sends.
   *
   * `/api/game/gratitude/me` already returns them and is already
   * authenticated, so there is no new surface here and nothing anonymous can
   * reach it. Counted client-side against the budget's own `cycleId`, which is
   * the same string the server spends against, so the row cannot drift into a
   * different lunation than the meter beside it.
   */
  useEffect(() => {
    if (!user) return;
    const cycleId = me?.gratitude.budget?.cycleId;
    if (!cycleId) return;
    let alive = true;
    gameFetch("/api/game/gratitude/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !Array.isArray(d.sent)) return;
        const ids = new Set(
          (d.sent as SentEntry[])
            .filter((s) => s.cycleId === cycleId && s.toId)
            .map((s) => String(s.toId)),
        );
        setPeopleThanked(ids.size);
      })
      .catch(() => { /* the row stays away rather than guessing */ });
    return () => { alive = false; };
  }, [user, me?.gratitude.budget?.cycleId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setFeedback(null);
    try {
      const res = await gameFetch("/api/game/gratitude/send", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.message ?? data.error ?? "Something went wrong" });
      } else {
        setFeedback({ ok: true, text: "Your appreciation is on the wall." });
        setForm({ to: "", amount: 10, message: "" });
        // A real send is gratitude's retirement trigger server-side. Since the
        // voices shipped it has something to retire, and it now retires on a
        // threshold rather than on the first send, so this can drop the banner
        // one send early. It is a cache hint and the next read corrects it.
        forgetExamplesCache("gratitude");
        load();
      }
    } catch {
      setFeedback({ ok: false, text: "Something went wrong. Try again." });
    }
    setSending(false);
  };

  const budget = me?.gratitude.budget;

  return (
    <Layout>
      {/*
        `relative` is load-bearing: NightMotes measures this element. MoonDock
        renders its own fixed layer and is placed last for source order, so a
        keyboard reaches the wall before it reaches an ornament.
      */}
      <div className="relative sheet-night min-h-screen bg-background py-14">
        <NightMotes />
        <div className="relative container mx-auto max-w-3xl px-4">
          <VoicesHero />

          {/* The clock the economy runs on: lunation, season, the four turnings. */}
          <div className="mb-10"><CycleClock /></div>

          {user ? (
            <form onSubmit={send} className="mb-10 rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-card-foreground">Send {currency.toLowerCase()}</h2>
                {budget && budget.total > 0 ? (
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-card-foreground">{budget.remaining}</span> / {budget.total} left this cycle
                    <InfoTip tip="Your sending budget refills when the cycle turns. Sending moves it from your budget to their wall; it never costs you anything you earned." label="How the budget works" />
                  </span>
                ) : budget && budget.total <= 0 ? (
                  <span className="text-xs italic text-muted-foreground">Your sending budget unlocks as you progress</span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">We couldn't load your budget, reload to see it</span>
                )}
              </div>

              {/* One heart, one person. Both figures come off the budget the
                  server derived, never recomputed here. */}
              {budget && budget.total > 0 && peopleThanked !== null && (
                <HeartsRow people={peopleThanked} fullSends={budget.fullSends} cap={budget.cap} />
              )}

              <div className="mb-3 grid gap-3 md:grid-cols-[1fr_110px]">
                <input
                  // type="text", and that IS the fix. `type="email"` made the
                  // browser refuse a handle before the form could be sent, so
                  // the field could only take the one thing this site never
                  // shows anybody.
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  aria-label="Who you are thanking, by handle"
                  placeholder="Their @handle"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  type="number"
                  min={1}
                  required
                  // Derived from the live currency name, not hardcoded: a fork
                  // that renames its recognition token gets the right label.
                  aria-label={`Amount of ${currency.toLowerCase()} to send`}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: parseInt(e.target.value) || 1 })}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {/*
                THE VILLAGE'S OWN SETTING, NOT A HARDCODED TRUE.

                The server gates this on `gratitude.require_message`
                (server/lib/gratitude.ts, via boolVar), so a village that turned
                it off still had a form here refusing to submit without a
                message. A config knob the client ignores is a knob that does
                not exist. /api/game/rules has carried the real answer all along
                and nothing read it.

                Null while the rule is in flight means OPTIONAL, which matches
                the server's own posture: it refuses on the way in, so an
                optimistic client costs a round trip and a sentence, while a
                pessimistic one blocks a legitimate send outright.
              */}
              <textarea
                required={requireMessage === true}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="What are you thanking them for?"
                rows={2}
                className="mb-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              {feedback && (
                <p
                  // Announced, not merely displayed: the result of a submit is
                  // the one thing a screen-reader user must not have to go
                  // hunting for. alert (assertive) for a failure, status for a
                  // success — never on anything that re-renders per keystroke.
                  role={feedback.ok ? "status" : "alert"}
                  className={`mb-3 text-sm ${feedback.ok ? "text-open" : "text-destructive"}`}
                >
                  {feedback.text}
                </p>
              )}
              {/* A spent budget is a real state, not an error to discover
                  after clicking: say so, and stop offering the button. */}
              {budget && budget.remaining <= 0 && budget.total > 0 && (
                <p className="mb-3 text-sm text-notice">
                  You've given your whole budget this cycle. It refills when the lunar cycle turns.
                </p>
              )}
              {/* An UNKNOWN budget no longer disables Send: the server's own
                  guard is the authority on whether a send is allowed, and
                  refusing locally on a failed fetch told the member a lie
                  about their standing. Paired with the explicit "couldn't
                  load" caption above, so the state is never silent. */}
              <button
                type="submit"
                disabled={sending || (!!budget && (budget.total <= 0 || budget.remaining <= 0))}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-teal-deep px-5 py-2.5 font-semibold text-white transition-colors disabled:opacity-50"
              >
                <Send className="h-4 w-4" aria-hidden="true" /> {sending ? "Sending..." : "Send"}
              </button>
            </form>
          ) : (
            <div className="mb-10 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
              <p className="mb-4 text-muted-foreground">Sign in to send {currency.toLowerCase()} to a fellow member.</p>
              <Link href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-teal-deep px-5 py-2.5 font-semibold text-white">
                Sign In
              </Link>
            </div>
          )}

          {wall.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">
              <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
              <p>The wall is waiting for its first appreciation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {wall.map((w) => (
                <WallEntryCard key={w.id} entry={w} currency={currency} />
              ))}
            </div>
          )}
        </div>
        <MoonDock />
      </div>
    </Layout>
  );
}
