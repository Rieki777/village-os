import Layout from "@/components/Layout";
import { BTN_PRIMARY, EYEBROW, H1, RING, WORLD } from "@/components/journey/look";
import QuietEmpty from "@/components/quiet/QuietEmpty";
import { Link, useSearch } from "wouter";
import { m } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  Compass,
  Filter,
  Heart,
  Lightbulb,
  Sparkles,
  Star,
  Sprout,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth, useOptionalAuth } from "@/contexts/AuthContext";
import { fetchGameMe, QuestClaim, useGameConfig } from "@/lib/gameApi";
import { pageVarsFrom } from "@shared/pageContent/vars";
import { useTokenName, useTokensWord, useValueTokenName } from "@/hooks/useTokenNames";
import { useValueConversion } from "@/lib/moneyClaims";
import { ExamplesBanner } from "@/components/ExamplesBanner";
import InfoTip from "@/components/InfoTip";
import { useLadderTitle } from "@/hooks/useVillagePaths";
import QuestCard, { iconFor, QuestPoster } from "@/components/QuestCard";
import {
  currentClaims,
  filterBoard,
  groupByCircle,
  leadQuestFor,
  relativeWhen,
  type BoardQuest,
  type FieldSigns,
} from "@/lib/questBoard";
import { memberDoorShown } from "@/lib/brochure";
import MaiaTypeLine from "@/components/geneKeys/MaiaTypeLine";
import RootsFilterToggle from "@/components/roots/RootsFilterToggle";
import { useRootsFilter } from "@/components/roots/useRootsFilter";
import { useLingui } from "@lingui/react/macro";
import { statusFor } from "@/lib/questStatus";
import { goalOf, QUEST_PLACES } from "@shared/questThreads";
import FitsYouCard from "@/components/openWork/FitsYouCard";
import { usePlaceWords } from "@/components/openWork/placeWords";
import { useQuestGoals } from "@/components/openWork/useQuestGoals";

/*
 * The bare "?" is a 16px circle set inside a sentence. Its button's own box is
 * 44px (`tapBox`), with negative margins giving the space back so the line
 * does not reflow; the rehearsal measured the old ::before hit area as a 16px
 * box on /quests at 390 (12 Nov 2026), and a box is what a thumb is promised.
 * `z-10` lifts the wrapper over the next paragraph, which on the hero is
 * pulled up under it by a negative margin and was eating the bottom of the
 * target.
 */
const INFO_TIP_44 = "z-10";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

/**
 * S10: quests render from GET /api/quests — the server list with REAL ids.
 * The old hardcoded array joined to server state by slugified titles, so a
 * rename silently orphaned claims (hazard table, questIdFromTitle). Server
 * ids are the only join key now, and admin quest edits appear without a
 * client release.
 *
 * The board itself is tier one of the disclosure ladder ported from the
 * sibling game's quest redesigns: cards draw the eye and state the offer,
 * and everything else (story, steps, claiming, submitting) lives on each
 * quest's own page at /quests/:id. Circle names come from the data, so the
 * filter row is whatever this village's quests actually use, never a
 * hardcoded list.
 */
export default function Quests() {
  const { t } = useLingui();
  // The letter is a member's door: open to anybody signed in, a story page for a visitor (shared/brochure.ts).
  const letterConfig = useGameConfig();
  const letterOn = memberDoorShown(letterConfig, "/love-letter", !!useOptionalAuth()?.user);
  // The recognition and value tokens' live names (Admin → Tokens) — a fork's
  // rename reaches every line below without a code change.
  const cfg = useGameConfig();
  const currencyName = useTokenName("Recognition");
  const valueName = useValueTokenName();
  // The umbrella word heads the section that names every token (Rye,
  // 2026-11-01: Gratitude is the recognition token's name and nothing else's).
  const tokensWord = useTokensWord("Tokens");
  // Same rule for the village's own name and its events page: this page is
  // platform code, so it asks the config rather than naming anybody.
  const villageName = cfg?.project?.name ?? "the village";
  const eventsUrl = cfg?.project?.eventsUrl ?? "";
  const stages = cfg?.stages ?? [];
  // The ladder's name in this village's words (Admin, Paths & Stages), for the
  // one line that says some work opens further along it.
  const ladder = useLadderTitle();
  const [activeCircle, setActiveCircle] = useState<string>("All");
  const [activeDifficulty, setActiveDifficulty] = useState<Difficulty | "All">(
    "All"
  );
  // Goal threads (decision 5): `/quests?goal=<id>` opens the board on one
  // season goal's open work. The commons links each goal here.
  const search = useSearch();
  const [activeGoal, setActiveGoal] = useState<string>(() => new URLSearchParams(search).get("goal") || "All");
  const [activePlace, setActivePlace] = useState<string>("All");
  const goals = useQuestGoals();
  const placeWords = usePlaceWords();
  const { user } = useAuth();
  /*
   * WHAT HAPPENS TO THE VALUE TOKEN, IN THE FOUNDER'S OWN WORDS.
   *
   * This card said "As {village} grows, {value} can convert to cash, equity,
   * or community currency" as compiled copy, and nothing in the product
   * converts anything. The founder's ruling (2026-09-03) is that the
   * conversion is REAL and happens OFF the platform, and that an on-platform
   * redemption process is coming and is not built. That is a claim only he can
   * make and only he should be able to correct, so it comes from the runtime
   * content document and changes without a deploy.
   *
   * A village that has written nothing SAYS nothing here, and the two
   * sentences around it stand on their own.
   *
   * This is a claim about the VALUE token. It does not touch the wallet's
   * "money flows in and never back out", which is the credit token's rule.
   */
  const conversionNote = useValueConversion({ village: villageName, value: valueName });
  const [claims, setClaims] = useState<Record<string, QuestClaim>>({});
  const [claimList, setClaimList] = useState<QuestClaim[]>([]);
  const [quests, setQuests] = useState<BoardQuest[]>([]);
  const [signs, setSigns] = useState<FieldSigns | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);

  useEffect(() => {
    fetch("/api/quests")
      .then((r) => {
        if (!r.ok) throw new Error(`quests ${r.status}`);
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setQuests(d); })
      // A swallowed failure used to render as "no quests match those
      // filters" — an outage presented as a fact about the village.
      .catch(() => setBoardFailed(true));
    // Life signs are decoration on top of the board: if they fail, the
    // board still renders, just quieter.
    fetch("/api/quests/field")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.perQuest) setSigns(d); })
      .catch(() => { /* board renders without counts */ });
  }, []);

  const refreshClaims = () => {
    fetchGameMe().then((me) => {
      if (!me) return;
      setClaimList(me.quests);
      // Live work outranks finished work, and within one rank the later claim
      // wins. Taking the first non-declined claim showed a repeatable quest as
      // "Completed" while the member was holding it again.
      setClaims(currentClaims(me.quests));
    });
  };

  useEffect(refreshClaims, []);

  // The filter row is built from the data: every circle that actually has a
  // quest, in board order. A village that renames its circles sees its own
  // names here the moment the board updates.
  const circles = useMemo(() => {
    const seen: string[] = [];
    for (const q of quests) {
      const c = String(q.circle ?? "").trim();
      if (c && !seen.includes(c)) seen.push(c);
    }
    return ["All", ...seen];
  }, [quests]);

  // "Show only what matches my roots": on by default once the member has
  // picked roots on their profile, one press to turn off (components/roots).
  const roots = useRootsFilter(user?.id ?? null);
  const byChips = filterBoard(quests, {
    circle: activeCircle,
    difficulty: activeDifficulty,
    goal: activeGoal,
    place: activePlace,
  });
  // The roots filter reads the WHOLE board, so "is anything tagged" is a fact
  // about the village and never about whichever circle chip is pressed.
  const byRoots = roots.apply(quests, (q) => q.archetypes);
  const rootKept = new Set(byRoots.shown.map((q) => q.id));
  const filtered = byChips.filter((q) => rootKept.has(q.id));
  const rootsHidden = byChips.length - filtered.length;
  // The switch is offered only when the board carries roots at all: a village
  // that has tagged nothing yet has nothing to filter by.
  const rootsOffered = roots.available && byRoots.tagged;

  // The open work list, grouped by circle (decision 5): circles in board order,
  // quests in board order inside each. Nothing is ranked by who did what.
  const groups = useMemo(() => groupByCircle(filtered), [filtered]);

  // The season goals the board can filter by: this season's goals that any
  // quest grows. The counts beside them are the village's (open quests), never a person's.
  const goalList = goals ?? [];
  const threadedGoals = goalList.filter((g) => quests.some((q) => q.goalId === g.id));
  const chosenGoal = activeGoal === "All" ? null : goalOf(activeGoal, goalList);
  const goalName = chosenGoal?.text ?? "";
  const goalCount = chosenGoal?.openQuests ?? 0;
  const placesUsed = QUEST_PLACES.filter((p) => p !== "both" && quests.some((q) => q.place === p || q.place === "both"));

  const questById = useMemo(() => new Map(quests.map((q) => [q.id, q])), [quests]);
  const inFlight = claimList.filter(
    (c) => (c.status === "claimed" || c.status === "submitted") && questById.has(c.questId),
  );
  /*
   * FITS YOU (decision 5): the one card the board leads with, chosen from the
   * member's roots, then a season goal that still needs hands, then the
   * gentlest open quest. Examples never lead.
   */
  const rootsKey = roots.mine.join(",");
  const openGoalIds = goalList.filter((g) => !g.done).map((g) => g.id);
  const lead = useMemo(
    () => (quests.length ? leadQuestFor(quests, claimList, roots.mine, openGoalIds) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quests, claimList, rootsKey, openGoalIds.join(",")],
  );
  const goalFor = (q: BoardQuest) => goalOf(q.goalId, goalList);
  const now = new Date();

  return (
    <Layout>
      <div className={WORLD}>
      {/* Hero */}
      <section className="py-10 md:py-16">
        <div className="container">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-6"
          >
            <div className={`${RING} mx-auto mb-6 size-16`}>
              <Compass className="size-7" aria-hidden="true" />
            </div>
            <p className={EYEBROW}>{t({ message: "Quests", context: "open work board eyebrow" })}</p>
            <h1 className={`${H1} mb-4 mt-2`}>
              {t({ message: "Open work", context: "open work board heading" })}
            </h1>
            {/* R47: the Trail line leads, the reward word keeps its tooltip,
                and the Lore line comes last, after the numbers. */}
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
              Take a Quest, do the work, turn it in.
            </p>
            <ExamplesBanner moduleId="quests" noun="quest" />
            <p className="text-sm text-muted-foreground mb-8">
              {quests.length} active quests &nbsp;·&nbsp; {quests.filter((q) => q.pay?.value).length} with a value set
              <InfoTip tip="A quest with a value set shows it on its card. One without says to inquire for payment details." label="What a value is" className={INFO_TIP_44} tapBox />
            </p>
            <p className="text-sm italic text-muted-foreground -mt-6 mb-8">
              Real work, on real land, beside people becoming your people.
            </p>

          </m.div>
        </div>
      </section>

      {/* Your journey: what you hold now. The gentlest place to begin is the
          meadow's own lead, just below. Signed-out visitors see nothing here. */}
      {user && inFlight.length > 0 && (
        <section className="pb-4 bg-background">
          <div className="container max-w-7xl">
            <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-sm">
              <h2 className="font-display text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Sprout className="w-5 h-5 text-notice" />
                Pick up where you left off
              </h2>
              <ul className="grid sm:grid-cols-2 gap-3">
                {inFlight.map((c) => {
                  const q = questById.get(c.questId)!;
                  const Icon = iconFor(q.icon);
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/quests/${q.id}`}
                        className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-notice hover:shadow-sm transition-all"
                      >
                        <QuestPoster quest={q} className="w-14 h-14 rounded-xl shrink-0">
                          <Icon className="absolute inset-0 m-auto w-6 h-6 text-white" />
                        </QuestPoster>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-sm text-foreground truncate">
                            {q.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {c.status === "claimed"
                              ? "In progress. Turn in your work when it's done."
                              : "Turned in. Waiting on the circle's yes."}
                          </span>
                        </span>
                        <ArrowRight className="w-4 h-4 text-notice shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* FITS YOU: one card, one act (decision 5). Phone: one column, the act
          full width under the thumb. Desktop: the words beside the act. */}
      {lead && (
        <section className="pb-6 pt-2 bg-background">
          <div className="container max-w-7xl">
            <FitsYouCard
              lead={lead}
              status={statusFor(signs?.perQuest?.[lead.quest.id])}
              goal={goalFor(lead.quest)}
              footer={user ? <MaiaTypeLine className="mt-3" /> : null}
            />
          </div>
        </section>
      )}

      {/* Filters */}
      {/* The nav is 96px tall (a 64px logo inside container py-4), not 64 —
          so the filter bar used to park 32px BEHIND an opaque, higher-z
          header, hiding two thirds of the first filter row. top-24 = 6rem. */}
      <section className="sticky top-24 z-30 bg-background/95 backdrop-blur border-b border-border py-4 shadow-sm">
        <div className="container">
          {/* One scrolling row per filter group instead of five wrapped ones.
              Wrapped, the fourteen pills stacked seven rows deep and each row
              sat 32px from the next, which is the whole story on both counts:
              a 24px pill inside a 32px pitch cannot hold a 44px tap target
              (the neighbours' hit areas clip it to 32), and seven rows of
              sticky chrome ate a quarter of a phone screen before a single
              quest showed. Nowrap gives each pill its own 44px and gives the
              bar back four rows. The pills themselves are unchanged to look
              at. */}
          <div className="flex gap-2 items-center mb-1 overflow-x-auto flex-nowrap" data-scroll-contain>
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            <span className="text-sm text-muted-foreground flex-shrink-0">Circle:</span>
            {circles.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCircle(c)}
                className={`px-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                  activeCircle === c
                    ? "bg-notice text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center overflow-x-auto flex-nowrap" data-scroll-contain>
            <span className="text-sm text-muted-foreground ml-5 flex-shrink-0">Difficulty:</span>
            {(["All", "Beginner", "Intermediate", "Advanced"] as const).map(
              (d) => (
                <button
                  key={d}
                  onClick={() => setActiveDifficulty(d)}
                  className={`px-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                    activeDifficulty === d
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {d}
                </button>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length} quest{filtered.length !== 1 ? "s" : ""} shown
          </p>
        </div>
      </section>

      {/*
       * Propose-your-own CTA. It used to sit at the end of the hero, and on a
       * phone that put it at y772 to y820 in a 375x812 Safari viewport, where
       * the fixed tab bar owns everything below y747: the whole control was
       * behind the bar and a tap at its centre opened Gratitude instead.
       *
       * It cannot be nudged out of that band. The clear window at the end of
       * the hero is a 15px slice (lift it 73px and 812 clears, lift it 89 and
       * a 664 viewport pulls it back INTO the band from below), which any copy
       * edit would close again. Clearing it upward instead needs a 201px lift
       * — the whole explainer paragraph and the stats line — because a 390x664
       * viewport wants the card either wholly under y599 or wholly past y664.
       *
       * So it moves below the filters, where it is past the fold by 76px at
       * 390x844 and by more at the other two heights, and where "don't see
       * your gift here" reads better anyway: after the board's filters rather
       * than before anyone has seen the board.
       */}
      <section className="pb-2 bg-background">
        <div className="container">
          <div className="max-w-2xl mx-auto bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-center gap-4 text-left mt-6">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <Lightbulb className="w-6 h-6 text-notice" />
            </div>
            <div className="flex-1">
              <h2 className="font-display text-lg font-bold text-foreground">
                Don't see your gift here?
              </h2>
              <p className="text-sm text-muted-foreground">
                Post your own Quest. Anyone can propose one.
                Tell us what you want to bring and what you'd need to make it real.
              </p>
            </div>
            <Link href="/propose-quest">
              <a className={`${BTN_PRIMARY} shrink-0`}>
                Propose a Quest
                <ArrowRight className="w-4 h-4" />
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* "Show only what matches my roots", outside the sticky bar so a phone keeps its slim filter row. */}
      {rootsOffered && (
        <section className="pt-6 bg-background">
          <div className="container max-w-7xl">
            <RootsFilterToggle filter={roots} total={byChips.length} shown={filtered.length} noun="quests" />
          </div>
        </section>
      )}

      {/* The season goal and the place, the two filters goal threads add
          (decision 5). Outside the sticky bar too, for the same slim phone row. */}
      {(threadedGoals.length > 0 || placesUsed.length > 0 || activeGoal !== "All") && (
        <section className="pt-6 bg-background" aria-label={t({ message: "Filter by season goal and place", context: "open work filters" })}>
          <div className="container max-w-7xl space-y-1">
            {(threadedGoals.length > 0 || activeGoal !== "All") && (
              <div className="flex gap-2 items-center overflow-x-auto flex-nowrap" data-scroll-contain role="group" aria-label={t({ message: "Season goal", context: "open work filter row" })}>
                <Target className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                {[{ id: "All", text: t({ message: "Every goal", context: "open work filter: all season goals" }) }, ...threadedGoals].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={activeGoal === g.id}
                    data-goal-filter={g.id}
                    onClick={() => setActiveGoal(g.id)}
                    className={`px-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                      activeGoal === g.id ? "bg-open text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {g.text}
                  </button>
                ))}
              </div>
            )}
            {placesUsed.length > 0 && (
              <div className="flex gap-2 items-center overflow-x-auto flex-nowrap" data-scroll-contain role="group" aria-label={t({ message: "Where it happens", context: "open work filter row" })}>
                <span className="w-4 flex-shrink-0" aria-hidden="true" />
                {(["All", ...placesUsed] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={activePlace === p}
                    data-place-filter={p}
                    onClick={() => setActivePlace(p)}
                    className={`px-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                      activePlace === p ? "bg-open text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {p === "All" ? t({ message: "Anywhere", context: "open work filter: every place" }) : placeWords[p]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* The open work, grouped by circle (decision 5): a clean list to scan. */}
      <section className="py-16 bg-background">
        <div className="container">
          {/* The goal thread read back: how many open quests grow the chosen
              goal. The village's count, from GET /api/quests/goals. */}
          {chosenGoal && (
            <div className="max-w-7xl mx-auto mb-8 flex flex-wrap items-center gap-x-3 gap-y-2" data-goal-thread={chosenGoal.id}>
              <Target className="w-5 h-5 text-open" aria-hidden="true" />
              <p className="font-display text-xl font-bold text-foreground">
                {chosenGoal.openQuests === 0
                  ? t({ message: `No open quests grow ${goalName} yet`, context: "open work: the goal thread, none" })
                  : chosenGoal.openQuests === 1
                    ? t({ message: `1 open quest grows ${goalName}`, context: "open work: the goal thread, one" })
                    : t({ message: `${goalCount} open quests grow ${goalName}`, context: "open work: the goal thread, several" })}
              </p>
              <button
                type="button"
                onClick={() => setActiveGoal("All")}
                className="min-h-11 text-sm font-medium text-notice underline underline-offset-2 hover:text-foreground"
              >
                {t({ message: "Show every goal", context: "open work: clear the season goal filter" })}
              </button>
            </div>
          )}
          {/* What the old "Further in" ring said, kept as one line: some work
              opens with a stage or a role, and each card names what opens it. */}
          {filtered.some((q) => q.minStage || q.requiresRole) && (
            <p className="max-w-7xl mx-auto mb-8 text-sm text-muted-foreground">
              {t({ message: `Some of this work opens as you walk the ${ladder} or step into a role. Each card says what opens it.`, context: "open work: gated quests explained once" })}
            </p>
          )}
          <div className="max-w-7xl mx-auto mb-16 space-y-14">
            {groups.map((group, gi) => (
              <div key={group.circle ?? ""} data-circle-group={group.circle ?? ""}>
                <h2 className="mb-5 font-display text-2xl font-bold text-foreground">
                  {group.circle ?? t({ message: "Open to every circle", context: "open work: the group for quests with no circle" })}
                </h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {group.quests.map((quest, index) => (
                    <m.div
                      key={quest.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: Math.min(index, 5) * 0.04 }}
                      className="h-full"
                    >
                      <QuestCard
                        quest={quest}
                        claim={claims[quest.id]}
                        signs={signs?.perQuest?.[quest.id]}
                        stages={stages}
                        goal={goalFor(quest)}
                        priority={gi === 0 && index === 0}
                      />
                    </m.div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Empty is a resting meadow with one door (components/quiet). A
              failure stays plain words: no drawing beside a problem. */}
          {filtered.length === 0 &&
            (boardFailed ? (
              <div className="text-center py-16 text-muted-foreground" role="alert">
                <p>{t`The Quest Board didn't load. Reload to try again.`}</p>
              </div>
            ) : quests.length === 0 ? (
              <QuietEmpty
                drawing="meadow"
                title={t`The meadow is resting`}
                door={{ label: t({ message: "Propose a Quest", context: "empty quest board: the one door" }), href: "/propose-quest" }}
                className="max-w-3xl mx-auto mb-16 justify-center"
              >
                {t`No Quests posted yet. Post the first one.`}
              </QuietEmpty>
            ) : roots.on && rootsHidden > 0 ? (
              <QuietEmpty
                drawing="meadow"
                title={t`Nothing here with these filters`}
                door={{
                  label: t({ message: "Show every quest", context: "quests board, roots filter hid everything" }),
                  onClick: () => roots.setOn(false),
                }}
                className="max-w-3xl mx-auto mb-16 justify-center"
              >
                {t({ message: "None of these grow from your roots yet.", context: "quests board, roots filter hid everything" })}
              </QuietEmpty>
            ) : (
              <QuietEmpty
                drawing="meadow"
                title={t`Nothing here with these filters`}
                door={{
                  label: t({ message: "Show every Quest", context: "empty quest board: clears the circle and difficulty filters" }),
                  onClick: () => {
                    setActiveCircle("All");
                    setActiveDifficulty("All");
                    setActiveGoal("All");
                    setActivePlace("All");
                  },
                }}
                className="max-w-3xl mx-auto mb-16 justify-center"
              >
                {t`No Quests match. Clear a filter to see more.`}
              </QuietEmpty>
            ))}

          {/* Life signs: recent consented completions. Absent when there are
              none — an empty feed renders as silence, never as a zero. */}
          {signs && signs.recent.length > 0 && (
            <div className="max-w-3xl mx-auto mb-16">
              <h2 className="font-display text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-notice" />
                Recently completed
              </h2>
              <ul className="space-y-2">
                {signs.recent.map((r, i) => (
                  <li key={`${r.questId}-${i}`}>
                    <Link
                      href={`/quests/${r.questId}`}
                      className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-notice transition-colors"
                    >
                      <span className="text-sm text-foreground min-w-0 truncate">
                        <span className="font-semibold">{r.name}</span> completed{" "}
                        <span className="font-medium text-notice">{r.questTitle}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {relativeWhen(r.when, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <div className="max-w-3xl mx-auto text-center bg-card p-8 rounded-2xl border border-border shadow-sm">
            <Star className="mx-auto mb-4 size-12 text-notice" aria-hidden="true" />
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-4">
              Find your first Quest
            </h2>
            <p className="text-muted-foreground mb-6">
              Meet the circles on a community call, then come back and take a
              Start here Quest.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {/* A fork with no events page shows no button rather than a dead
                  link, the same rule the footer follows. */}
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-teal-deep-dark transition flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join a Community Call
                </a>
              )}
              {letterOn && (
                <Link href="/love-letter">
                  <a className="px-6 py-3 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors flex items-center gap-2">
                    <Heart className="w-5 h-5" />
                    Sign the {pageVarsFrom(cfg ?? {}).commitment}
                  </a>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/*
        About the village's tokens, WITHOUT SAYING WHAT ANY OF THEM DOES (Rye,
        2026-10-22): "every community will design their own rules for these and
        other tokens so don't mention what it does anywhere". It names the tokens,
        carries the village's own published wording about conversion when there
        is any, and points at the village's live rules.
      */}
      <section className="py-16 bg-primary/5">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl font-bold text-foreground mb-4">
              About {tokensWord}
            </h2>
            <p className="text-muted-foreground">
              {villageName} sets its own rules for {currencyName}, {valueName} and its other tokens.
              {conversionNote ? ` ${conversionNote}` : ""}
            </p>
            <Link href="/game-mechanics" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2">
              See this village's rules
            </Link>
          </div>
        </div>
      </section>
      </div>
    </Layout>
  );
}
