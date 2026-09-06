/**
 * THE VESSEL: one panel where six sections used to be.
 *
 * The live profile carried six separate places that talked about the same
 * token. Two printed the same balance and one repeated another's sentence
 * word for word. Consolidating them was the third of the five asks in the
 * original brief and it is what this component is.
 *
 * What it absorbs:
 *   the balance held                    (Profile.tsx's 5xl figure)
 *   how much is left to give this moon  (ProfileSheet's "This moon")
 *   what standing does to the allowance (MaturityLadder's multiplier line)
 *   the send control                    (previously only on the Wall)
 *
 * What deliberately stays where it is: "Where It Came From". A full ledger is
 * a different act from a glance, and it earns its own place lower down.
 *
 * ── THE MOON IS NOT IN HERE, AND THE DESIGN PUT IT IN ────────────────────
 *
 * The mockup drew a moon glyph inside this panel with the phase and the days
 * remaining. This page already has a moon: MoonDock is fixed in the corner and
 * follows the reader down the whole sheet, carrying the same phase and opening
 * the same calendar. A second moon would be a second opinion about the date,
 * and it would cost another /api/events request on a page that already makes
 * about twenty-six.
 *
 * ── EVERY WORD FOR THE TOKEN COMES FROM THE VILLAGE ──────────────────────
 *
 * Not one string here spells the token's name. `scripts/check-village-facts.mjs`
 * refuses that literal in new copy and it is right to: this platform once
 * shipped one token's name as display text in 93 places across 29 files, none
 * of them changeable by the village that had to live with it.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";

import { useTokenName } from "@/hooks/useTokenNames";
import { formatTokenAmount } from "@/lib/tokenAmount";
import { gameFetch, type GameMe, type GameStagePublic } from "@/lib/gameApi";
import { announceProfileChange } from "@/lib/profileRefresh";

/** "2 times" / "1 time", so a multiplier of one does not read as "1 times". */
const times = (n: number): string => `${n} time${n === 1 ? "" : "s"}`;

export default function TheVessel({
  gratitude,
  here,
  next,
  onGiven,
}: {
  gratitude: GameMe["gratitude"] | null;
  here: GameStagePublic | null;
  next: GameStagePublic | null;
  /** Told after a successful give, so whatever else prints a balance re-reads. */
  onGiven?: () => void;
}) {
  const tokenName = useTokenName();
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ tone: "ok" | "no"; text: string } | null>(null);
  /*
   * NULL UNTIL THE RULE ARRIVES, and the field is optional until then.
   *
   * The Wall hardcodes `required` on this textarea while the SERVER gates it on
   * `gratitude.require_message`, a variable a village can turn off. So a
   * village that turned it off still had a form refusing to submit without a
   * message, which is a config knob the client ignored. /api/game/rules has
   * carried the real answer all along.
   */
  const [requireMessage, setRequireMessage] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    gameFetch("/api/game/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setRequireMessage(Boolean(d?.gratitude?.requireMessage));
      })
      .catch(() => {
        /* the field stays optional, which is the server's own default posture */
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * THE PANEL SURVIVES A FAILED REFRESH, AND SO DOES WHAT IT JUST TOLD YOU.
   *
   * This returned null whenever `gratitude` was null. After a SUCCESSFUL give,
   * `onGiven` re-reads /api/game/me; if that read fails, the parent sets `me`
   * to null, this panel unmounts, and the "Sent." confirmation for a transfer
   * that really happened vanishes with it. The member is left believing
   * nothing went through.
   *
   * So a panel that has already spoken keeps standing. `lastKnown` holds the
   * figures from before the failed read, which are one give stale rather than
   * absent, and the sentence below says so instead of pretending they are
   * current.
   */
  const [lastKnown, setLastKnown] = useState<GameMe["gratitude"] | null>(null);
  useEffect(() => {
    if (gratitude) setLastKnown(gratitude);
  }, [gratitude]);
  const figures = gratitude ?? lastKnown;
  const stale = !gratitude && Boolean(lastKnown);
  if (!figures) return null;

  const budget = figures.budget;
  const total = Number(budget?.total ?? 0);
  const remaining = Number(budget?.remaining ?? 0);
  const held = formatTokenAmount(Number(figures.balance ?? 0), Number(figures.decimals ?? 0));

  const give = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setSaid(null);
    try {
      // The Wall's own endpoint and the Wall's own field names, read off
      // server/index.ts rather than guessed: `to`, not `toHandle`. One give
      // door, so a refusal reads the same wherever a member gives from.
      const res = await gameFetch("/api/game/gratitude/send", {
        method: "POST",
        body: JSON.stringify({
          to: handle.replace(/^@/, "").trim(),
          amount: Number(amount),
          message: message.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        /*
         * THE SERVER'S OWN SENTENCE, VERBATIM. Its refusals name the reason:
         * the allowance is spent, the recipient is not a member, a share cap
         * was passed. Replacing any of those with a house message would tell a
         * member something less true than what the server already said.
         */
        setSaid({ tone: "no", text: String(body?.message ?? body?.error ?? "That did not go through.") });
        return;
      }
      setHandle("");
      setAmount("");
      setMessage("");
      setSaid({ tone: "ok", text: `Sent. ${tokenName} is on its way.` });
      /*
       * TELL THE WHOLE PAGE, not just the parent. ProfileSheet's "you have not
       * thanked anyone yet this season" and ProfileJourney's Recognition Flows
       * both read their own endpoints on mount and both listen for this. Without
       * it a member gives, sees "Sent.", and reads two cards below saying they
       * have thanked nobody. `announceProfileChange` is the signal those cards
       * already subscribe to; it simply was never fired from here.
       */
      announceProfileChange();
      onGiven?.();
    } catch {
      setSaid({ tone: "no", text: "Could not reach the village. Try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.section
      aria-labelledby="vessel-h"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="flex items-center gap-2">
        <Heart className="h-6 w-6 shrink-0 text-notice" aria-hidden="true" />
        <h2 id="vessel-h" className="font-display text-2xl font-bold text-card-foreground">
          {tokenName}
        </h2>
      </div>

      <p className="mt-4 font-display text-5xl font-bold text-notice tabular-nums">
        <span className="sr-only">{tokenName} held: </span>
        {held}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Held in all. Yours to keep, never spent.
      </p>
      {/* Said out loud rather than shown by dimming, because a figure that is
          one write behind looks exactly like a figure that is current. */}
      {stale ? (
        <p className="mt-1 text-sm text-notice">
          These figures are from before your last send. Reload to see them settle.
        </p>
      ) : null}

      {total > 0 ? (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-card-foreground">Left to give this moon</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              <span className="font-semibold text-card-foreground">{remaining}</span> of {total}
            </span>
          </div>
          {/*
            THE FILL IS GOLD AND IT USED TO BE THE BRAND.

            `bg-teal-deep` resolves to the village's own brand colour, which is
            guaranteed to carry WHITE text and is therefore dark. On this night
            panel it measured 1.43:1 against its own track: a member could not
            see how much they had left. The sheet's gold is 7.10:1 on the same
            track. A bar nobody can see is not a quieter bar.
          */}
          <div
            role="progressbar"
            aria-valuenow={Math.min(remaining, total)}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={`${remaining} of ${total} left to give this moon`}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-notice"
              /* Clamped, because a dial lowered mid-cycle can leave spent above
                 total, and a bar wider than its track is a rendering fault that
                 reads as a data one. */
              style={{ width: `${Math.min(100, Math.max(0, (remaining / (total || 1)) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The allowance resets with the new moon. Nothing you were given is ever taken back.
          </p>
          {here && next && next.gratitudeMultiplier !== here.gratitudeMultiplier ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Your sending allowance is {times(here.gratitudeMultiplier)} the base now, and{" "}
              {times(next.gratitudeMultiplier)} at {next.name}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        THE SEND CONTROL, HERE RATHER THAN ONLY ON THE WALL.

        The second half of the same ask: one section, with a send button in it.
        A member looking at what they have left to give is the member most
        likely to want to give it, and sending them to another page to do it is
        the reason the six sections never felt like one thing.
      */}
      <form onSubmit={give} className="mt-6 border-t border-border pt-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium text-card-foreground">Who to thank</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              required
              placeholder="Their @handle"
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-card-foreground placeholder:text-muted-foreground"
            />
          </label>
          <label className="sm:w-32">
            <span className="mb-1 block text-sm font-medium text-card-foreground">How much</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              inputMode="numeric"
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 tabular-nums text-card-foreground"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-card-foreground">
            What for{requireMessage === false ? " (optional)" : ""}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            /* The village's own setting, never a hardcoded true. */
            required={requireMessage === true}
            rows={2}
            placeholder="What are you thanking them for?"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-card-foreground placeholder:text-muted-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={sending || remaining <= 0}
          /*
            THE EDGE, AND WHY THE FILL STAYS THE VILLAGE'S.

            `bg-teal-deep` is the brand colour, which shared/brandTokens.ts
            guarantees only to CARRY white text, which means it is dark. On this
            night card it measured 1.58:1 against the panel: the label was
            perfectly legible and the BUTTON was not a shape. WCAG 1.4.11 asks a
            control's boundary to be findable, and a member scanning for
            somewhere to press was reading text to find it.

            The theme kept brand fills deliberately, so the fill is untouched
            and the boundary is added. Same defect the allowance bar had, one
            element over, and a text-only contrast pass cannot see either.

            /70 AND NOT /50, because a border composites over the element's OWN
            background: `background-clip` is `border-box`, so this edge sits on
            top of the brand fill rather than on the card. At /50 it measured
            2.99:1, which is a hair under the 3:1 WCAG 1.4.11 asks, and picking
            a number that clears on BOTH readings costs nothing.
          */
          className="mt-3 min-h-11 rounded-lg border border-notice/70 bg-teal-deep px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : remaining > 0 ? "Give" : "Nothing left to give this moon"}
        </button>
        {/*
          THE LIVE REGION IS ALWAYS MOUNTED, AND THAT IS THE WHOLE POINT.

          It was rendered only when there was something to say, which means the
          `role="status"` element was INSERTED at the same moment it got its
          text. Assistive technology watches a live region for changes; a region
          that did not exist a moment ago has no change to report, so the
          server's own refusal ("Only 3 left in your budget this cycle", "No
          member here with that id") was announced to nobody. It is mounted
          empty from the first render now and only its text changes.
        */}
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm ${!said ? "sr-only" : said.tone === "ok" ? "text-open" : "text-destructive"}`}
        >
          {said?.text ?? ""}
        </p>
      </form>
    </motion.section>
  );
}
