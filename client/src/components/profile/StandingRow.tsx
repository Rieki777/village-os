/**
 * WHERE YOU STAND, IN FOUR NUMBERS AND ONE SENTENCE.
 *
 * The design puts both at the top of the sheet, and both were already on the
 * page: the four figures were in four different sections at four different
 * depths in four different treatments, and the next-rung sentence was four
 * screens down inside the Maturity ladder. Nothing here is computed that the
 * page did not already know.
 *
 * ── IT HIDES ITSELF UNTIL A NUMBER IS TRUE ───────────────────────────────
 *
 * A member on their first day sees 0 / 0 / 0 / 0 in a large display serif.
 * Four zeros presented as a scoreboard is a worse first impression than no
 * scoreboard, so the row does not render until at least one figure is above
 * zero. That was Rye's call and it is the right one: the row exists to say
 * "look what you have", and it has nothing to say yet.
 *
 * Powers open is deliberately NOT counted for this test. Every member has some
 * powers open from the first minute, so counting it would make the row appear
 * on day one showing three zeros and a twelve, which is the discouraging thing
 * the rule exists to avoid.
 *
 * ── THE BAR ONLY EXISTS WHERE THERE IS A DENOMINATOR ─────────────────────
 *
 * Ten of this village's twelve rungs turn on a signature, a training record or
 * somebody's decision. Only two count anything. So the countdown sentence and
 * its bar appear for a member on those two, and everybody else reads how their
 * next rung opens. Drawing "60% of the way to Member" across a rung that turns
 * on a signature is a fabricated number, and this codebase deleted a set of
 * those once already.
 *
 * MaturityLadder owns that logic and still renders it by default; this
 * component is handed the same sentence rather than deriving a second one.
 */
import { motion } from "framer-motion";

import { useTokenName } from "@/hooks/useTokenNames";
import { formatTokenAmount } from "@/lib/tokenAmount";

export interface Standing {
  /*
   * The balance AND its scale, or nothing.
   *
   * Never a bare number. `users.recognition_balance` is a MINOR-unit column and
   * this page prints it raw today (Profile.tsx, the 5xl figure), so a token
   * with two decimals reads a hundred times too large. That defect is real and
   * it is not this component's to fix: the vessel decides which of the four
   * gratitude sources is canonical, and until it has, passing `null` prints no
   * figure rather than a confident wrong one.
   */
  held: { units: number; decimals: number } | null;
  powersOpen: number | null;
  pathsWalked: number | null;
  questsDone: number | null;
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: "gold" | "living" }) {
  return (
    <div className="border-border pr-6 last:border-0 last:pr-0 sm:border-r sm:pr-8">
      <span
        className={`block font-display text-3xl font-bold tabular-nums sm:text-4xl ${
          tone === "gold" ? "text-notice" : tone === "living" ? "text-open" : "text-card-foreground"
        }`}
      >
        {value}
      </span>
      <span className="mt-1 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export default function StandingRow({ standing }: { standing: Standing }) {
  const tokenName = useTokenName();
  const { held, powersOpen, pathsWalked, questsDone } = standing;

  // Null means "not read yet", which is a different thing from zero and must
  // not be printed as one. A row that flashes 0 and then corrects itself reads
  // as the number having changed.
  if (held === null && powersOpen === null && pathsWalked === null && questsDone === null) return null;

  /*
   * A FIGURE THIS COMPONENT HAS NOT READ IS NOT ZERO, AND WAS PRINTED AS ZERO.
   *
   * The early return above only fires when ALL FOUR are null, so a member with
   * three paths, twelve powers and seven quests, arriving while
   * /api/game/progression was slow or after it returned 500, read
   * "0 Powers open / 3 Paths walked / 0 Quests done" as a settled fact. That is
   * the exact discouragement the hide-until-non-zero rule exists to prevent,
   * arriving through the back door.
   *
   * Unread figures are simply absent now. A row of two true numbers says less
   * than a row of four, and it says nothing false.
   */
  const n = (v: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const heldUnits = held ? Number(held.units) || 0 : 0;
  const worthShowing = heldUnits > 0 || (n(pathsWalked) ?? 0) > 0 || (n(questsDone) ?? 0) > 0;
  if (!worthShowing) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 flex flex-wrap gap-x-6 gap-y-4"
    >
      {held ? (
        <Figure value={formatTokenAmount(held.units, held.decimals)} label={`${tokenName} held`} tone="gold" />
      ) : null}
      {n(powersOpen) !== null ? <Figure value={String(n(powersOpen))} label="Powers open" tone="living" /> : null}
      {n(pathsWalked) !== null ? <Figure value={String(n(pathsWalked))} label="Paths walked" /> : null}
      {n(questsDone) !== null ? <Figure value={String(n(questsDone))} label="Quests done" /> : null}
    </motion.div>
  );
}
