/**
 * POWERS: the climb, and what the village entrusts.
 *
 * ── WHAT THE DATA ACTUALLY SAYS, WHICH IS NOT WHAT A SKILL TREE ASSUMES ─────
 *
 * The brief was "make this feel like an MMORPG skill tree". Reading the real
 * catalogue first changed the shape, and the real shape is a better story than
 * the one the brief assumed. On the platform defaults:
 *
 *     31 capabilities exist
 *     13 open by climbing, across FOUR rungs of twelve
 *     18 open by appointment, which no amount of climbing reaches
 *
 * So more than half of what a member can ever do is HANDED TO THEM BY OTHER
 * PEOPLE. A grind tree drawn over that would be scaffolding pretending to be
 * content: eight of the twelve tiers would be empty boxes, and the biggest
 * fact about this village would be missing from its own map.
 *
 * That fact is the professionalism half of the brief. In a game you earn
 * everything by playing longer. Here you climb into some of it, and the rest
 * arrives because people decided to trust you with it. Both are drawn, and
 * the appointed half is given equal weight instead of a footnote, because on
 * these numbers it IS the larger half.
 *
 * ── THE SPINE, AND WHY EMPTY RUNGS STAY THIN ────────────────────────────────
 *
 * Every rung is on the page, so the ladder reads as one continuous climb and
 * a member can see what they are passing through. A rung that opens nothing
 * gets a connector and its requirement, and no branch. Giving those the same
 * weight as `member` (which opens nine) would flatten the one piece of shape
 * the ladder actually has: signing the covenant is THE unlock moment here,
 * and the drawing should say so without anybody typing that claim.
 *
 * ── EVERY EDGE COMES OFF THE PAYLOAD ────────────────────────────────────────
 *
 * A capability hangs on a rung because `opens.stage` says so, and the rungs
 * are in `servedLadder` order. Nothing here holds a hand-kept grouping beside
 * a union of thirty-one keys, which is the `Record<string, T>` shape CLAUDE.md
 * names as a promise nobody checks. A capability added upstream lands on the
 * right rung with no edit to this file. The one table that IS hand-kept, the
 * requirement wording, is keyed by `StageRule["type"]` so a new rule type is a
 * compile error here instead of a blank line in production.
 *
 * ── THE NUMBERS ARE AS PLAYED, NEVER AS CONFIGURED ──────────────────────────
 *
 * `rule` and `gratitudeMultiplier` arrive overlaid from the variables
 * registry (`servedRule` / `servedMultiplier`), so a village that raised its
 * quest bar to five reads five here. Serving the config default would print a
 * fake number styled like a real one, which is the failure that whole server
 * module exists to stop. `consentedQuests` is the member's own count, so a
 * quest rung shows real progress toward the bar instead of only the bar.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 *
 * `text-open` and `text-notice` resolve through `--sheet-open` / `--sheet-earned`,
 * so they re-tint with the village and darken correctly under `.sheet-night`.
 * `text-sage` is deliberately NOT used: `--color-sage` is defined once in
 * `@theme` and never redefined for night, so on a `bg-card` it measures 2.89:1,
 * which is why the twin fix in `GameDashboard` is only valid over its hardcoded
 * `bg-white`. Nothing here puts a frozen ink on a themed surface.
 */
import { useState } from "react";
import { Check, Circle, Lock, UserCheck } from "lucide-react";
import type { GameStagePublic, ProgressionCapability } from "@/lib/gameApi";
import type { StageRule } from "@shared/gameConfig";

/**
 * How each rung is reached, in the words a member would use.
 *
 * Keyed by the rule union minus the one case that needs a number, so adding a
 * rule type upstream fails the build here. A `Record<string, string>` would
 * render an empty requirement line and say nothing, which is exactly the trap
 * the house rules name.
 *
 * The wording is the platform's, never a village's: `membership` is "the
 * membership covenant" here while the seed calls it something of its own, and
 * that village-specific name arrives on `description` where it belongs.
 */
const REQUIREMENT: Record<Exclude<StageRule["type"], "quests">, string> = {
  default: "Everyone starts here",
  account: "Create an account",
  "training-complete": "Finish community training",
  membership: "Sign the membership covenant",
  granted: "The village grants this one",
};

function requirementOf(rule: StageRule, consented: number | null): string {
  if (rule.type !== "quests") return REQUIREMENT[rule.type];
  const unit = rule.min === 1 ? "consented quest" : "consented quests";
  // Progress, when the member's own count is known. A bare "3 consented
  // quests" tells somebody the price and never how much of it they have paid.
  if (consented === null) return `${rule.min} ${unit}`;
  return `${Math.min(consented, rule.min)} of ${rule.min} ${unit}`;
}

/** What a rung pays, in the terms the allowance is actually spent in. */
function allowanceOf(multiplier: number): string {
  if (multiplier <= 0) return "No sending allowance";
  if (multiplier === 1) return "Base sending allowance";
  return `${multiplier}x the sending allowance`;
}

type RungState = "walked" | "here" | "ahead";

interface Rung {
  id: string;
  name: string;
  description: string;
  requirement: string;
  allowance: string | null;
  state: RungState;
  powers: ProgressionCapability[];
}

/**
 * The ladder with its capabilities hung on it.
 *
 * Pure and separate from the render, so the shape of the climb can be read
 * and argued about without going through JSX.
 */
function buildClimb(
  catalogue: ProgressionCapability[],
  stages: GameStagePublic[],
  stageIndex: number,
  consentedQuests: number | null,
): Rung[] {
  const byRung = new Map<string, ProgressionCapability[]>();
  for (const row of catalogue) {
    if (row.opens.via !== "stage") continue;
    const list = byRung.get(row.opens.stage);
    if (list) list.push(row);
    else byRung.set(row.opens.stage, [row]);
  }
  return stages.map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    requirement: requirementOf(s.rule, consentedQuests),
    // The allowance earns its line only where it MOVES. Printed on every rung
    // it was "Base sending allowance" five times running, which buries the two
    // rungs where the number actually rises. Shown only on the change, the
    // column reads as the reward curve it is.
    allowance: i === 0 || s.gratitudeMultiplier !== stages[i - 1]!.gratitudeMultiplier
      ? allowanceOf(s.gratitudeMultiplier)
      : null,
    state: i < stageIndex ? "walked" : i === stageIndex ? "here" : "ahead",
    powers: byRung.get(s.id) ?? [],
  }));
}

/**
 * One capability, on the spine or in the appointed list.
 *
 * `reached` is the honest half. The gate is `admin -> badgeDenies -> role ->
 * badgeCapabilities -> stage`, so a deny outranks the ladder and a member can
 * stand ABOVE a rung with its power still closed. Hanging that row on its rung
 * and calling it "Closed" would leave somebody staring at a rung they have
 * visibly walked, wondering what they got wrong. Saying "Closed on your
 * account" names the mechanism at the row where the confusion is, and claims
 * nothing this payload cannot see: it does not guess WHICH badge or role did
 * it, because the payload does not carry that.
 */
function PowerRow({ row, reached }: { row: ProgressionCapability; reached: boolean }) {
  // SILENCE WHERE THE STRUCTURE ALREADY SAID IT. A power under a rung nobody
  // has reached is visibly out of reach, and the entrusted block's own heading
  // says a role opens everything in it. Labelling all of those "Closed" put the
  // word on the page twenty times and turned a map into a wall. The label is
  // kept for the two states that ARE news: it is yours, or your standing
  // reaches it and it is shut anyway.
  const standing = row.held ? "Open to you" : reached ? "Closed on your account" : "";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border px-3 py-2">
      {/* The label is the words a member reads. The key stays as the title for
          the one reader who wants it, the same way the roles chip carries its
          id. */}
      <span title={row.key} className="text-sm text-foreground">
        {row.label}
      </span>
      {standing ? (
        <span className={`text-xs ${row.held ? "text-open" : "text-muted-foreground"}`}>{standing}</span>
      ) : null}
    </li>
  );
}

export default function PowersMap({
  catalogue,
  stages,
  stageIndex,
  consentedQuests = null,
}: {
  catalogue: ProgressionCapability[];
  stages: GameStagePublic[];
  stageIndex: number;
  /** The member's own consented-quest count, for the rungs priced in quests. */
  consentedQuests?: number | null;
}) {
  const [showClosed, setShowClosed] = useState(true);

  if (catalogue.length === 0) return null;

  const climb = buildClimb(catalogue, stages, stageIndex, consentedQuests);
  const appointed = catalogue.filter((c) => c.opens.via === "appointment");
  const openCount = catalogue.filter((c) => c.held).length;
  const climbCount = catalogue.length - appointed.length;

  // A rung ABOVE the member with a capability still closed at or below it is
  // the gate's doing, never the ladder's: `admin -> badgeDenies -> role ->
  // badgeCapabilities -> stage` lets a deny outrank standing. Those rows say
  // "Closed" on a walked rung, which is the true thing, and claims no
  // mechanism this payload cannot see.
  /*
   * HIDING "WHAT IS CLOSED" HIDES CLOSED POWERS, and it used to hide RUNGS
   * AHEAD instead, which is a different set. The gate is `admin -> badgeDenies
   * -> role -> badgeCapabilities -> stage`, so a badge or a role can open a
   * power whose rung sits above where a member stands: filtering by rung threw
   * those away while the sentence underneath still counted them, so the button
   * hid powers the member had actually earned and announced a number it was
   * not showing.
   *
   * Filtered by `held`, the two agree by construction. A rung with nothing held
   * on it drops out, which is what makes the short view short.
   */
  const rungs = showClosed
    ? climb
    : climb.map((r) => ({ ...r, powers: r.powers.filter((p) => p.held) })).filter((r) => r.powers.length > 0);
  const appointedShown = showClosed ? appointed : appointed.filter((c) => c.held);

  return (
    <section aria-labelledby="powers-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="powers-h" className="font-display text-2xl font-bold text-card-foreground">
            Powers
          </h2>
          {/* Every figure comes off the payload. `catalogue.length` is what
              this village RUNS, which is smaller than the platform's full set
              whenever a module is off, because an off module's keys are left
              out entirely. */}
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{openCount}</span> of {catalogue.length} open to you now.{" "}
            {climbCount} open by climbing, {appointed.length} by appointment.
          </p>
        </div>
        {/* No `aria-pressed`. This button's NAME changes to describe what the
            next press does, and a toggle that does that must not also carry a
            pressed state: "Hide what is closed, pressed" announced that hiding
            was on at the exact moment everything was shown. One or the other,
            never both. */}
        <button
          type="button"
          onClick={() => setShowClosed((v) => !v)}
          className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          {showClosed ? "Hide what is closed" : "Show what is closed"}
        </button>
      </div>

      {/* The page had no `aria-live` anywhere, so every async change and every
          toggle on it was silent. This sentence is what a screen reader hears
          when the button above changes the two lists underneath it. */}
      <p aria-live="polite" className="sr-only">
        {showClosed
          ? `Showing all ${catalogue.length} powers.`
          : `Showing the ${openCount} powers open to you.`}
      </p>

      <h3 className="mt-8 font-semibold text-card-foreground">The climb</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Every rung of the ladder, and what each one opens.
      </p>

      {/* An ordered list because the order IS the information: these rungs are
          climbed in sequence and a screen reader should hear that. */}
      <ol className="mt-4">
        {rungs.map((rung, i) => {
          const last = i === rungs.length - 1;
          const Marker = rung.state === "walked" ? Check : rung.state === "here" ? Circle : Lock;
          const tone =
            rung.state === "walked" ? "text-open" : rung.state === "here" ? "text-notice" : "text-muted-foreground";
          return (
            <li
              key={rung.id}
              aria-current={rung.state === "here" ? "step" : undefined}
              className="relative pb-5 pl-8"
            >
              {/* The spine itself. It stops at the last rung shown, so the
                  line never dangles past the end of the climb. */}
              {last ? null : (
                <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />
              )}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card ${tone}`}
              >
                <Marker className="h-3 w-3" />
              </span>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={`font-semibold ${rung.state === "ahead" ? "text-muted-foreground" : "text-card-foreground"}`}>
                  {rung.name}
                </span>
                {rung.state === "here" ? (
                  <span className="rounded-full bg-notice/15 px-2 py-0.5 text-xs font-semibold text-notice">
                    You are here
                  </span>
                ) : null}
                <span className="text-sm text-muted-foreground">{rung.requirement}</span>
              </div>

              {/* The description is on EVERY rung, and the first live pass is
                  why. Suppressing it on rungs that open nothing left five of
                  the twelve reading the identical sentence "The village grants
                  this one" and nothing else: Immersant, Initiate, Role Holder,
                  Guide and Sage became indistinguishable rows. The description
                  is the only thing that says what a rung MEANS, so a rung
                  without it is the scaffolding this drawing was meant to
                  avoid. */}
              <p className="mt-0.5 text-sm text-muted-foreground">
                {rung.description}
                {rung.allowance ? ` ${rung.allowance}.` : ""}
              </p>

              {rung.powers.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {rung.powers.map((row) => (
                    <PowerRow key={row.key} row={row} reached={rung.state !== "ahead"} />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>

      {appointedShown.length > 0 ? (
        <>
          <div className="mt-8 flex items-center gap-2">
            <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h3 className="font-semibold text-card-foreground">Entrusted by the village</h3>
            <span className="text-sm text-muted-foreground">{appointed.length}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A role or a badge opens these. No amount of climbing reaches them.
          </p>
          <ul className="mt-3 space-y-1.5">
            {appointedShown.map((row) => (
              <PowerRow key={row.key} row={row} reached={false} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
