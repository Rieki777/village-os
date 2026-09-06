import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGameMe, QuestClaim, useGameConfig } from "@/lib/gameApi";
import { useTokenName, useValueTokenName } from "@/hooks/useTokenNames";
import { rewardCeiling } from "@shared/questRewards";
import { ExamplesBanner } from "@/components/ExamplesBanner";
import InfoTip from "@/components/InfoTip";
import QuestCard, { iconFor, QuestPoster } from "@/components/QuestCard";
import {
  currentClaims,
  nextQuestFor,
  relativeWhen,
  revealedFrom,
  ringFor,
  RING_ORDER,
  type BoardQuest,
  type FieldSigns,
  type Ring,
} from "@/lib/questBoard";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

/**
 * What each ring is for, said once at the top of its section. The rings are
 * derived from the quests themselves (see ringFor), so a village that gates a
 * quest or retunes a difficulty moves it here without touching this file.
 */
const RING_COPY: Record<Ring, { title: string; blurb: string }> = {
  welcome: {
    title: "Start here",
    blurb:
      "Open to everyone with a profile. Small enough to finish in an afternoon, and worth doing on its own.",
  },
  village: {
    title: "The village",
    blurb: "The everyday work the village runs on. Pick what fits your gift.",
  },
  further: {
    title: "Further in",
    blurb:
      "These open as you walk the Path of Growth or step into a role. Each one says what opens it.",
  },
};

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
  // The recognition and value tokens' live names (Admin → Tokens) — a fork's
  // rename reaches every line below without a code change.
  const cfg = useGameConfig();
  const currencyName = useTokenName("Recognition");
  const valueName = useValueTokenName();
  // Same rule for the village's own name and its events page: this page is
  // platform code, so it asks the config rather than naming anybody.
  const villageName = cfg?.project?.name ?? "the village";
  const eventsUrl = cfg?.project?.eventsUrl ?? "";
  const stages = cfg?.stages ?? [];
  const [activeCircle, setActiveCircle] = useState<string>("All");
  const [activeDifficulty, setActiveDifficulty] = useState<Difficulty | "All">(
    "All"
  );
  const { user } = useAuth();
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

  const filtered = quests.filter((q) => {
    const circleMatch = activeCircle === "All" || q.circle === activeCircle;
    const diffMatch =
      activeDifficulty === "All" || q.difficulty === activeDifficulty;
    return circleMatch && diffMatch;
  });

  // The filtered board, grouped into its rings. Filters apply inside a ring,
  // so narrowing to one circle empties the rings it does not touch instead of
  // flattening the whole page back into a wall.
  const byRing = useMemo(() => {
    const out: Record<Ring, BoardQuest[]> = { welcome: [], village: [], further: [] };
    for (const q of filtered) out[ringFor(q)].push(q);
    return out;
  }, [filtered]);

  // Progress counts read the WHOLE board, never the filtered view: "2 of 4
  // walked" must not change because somebody tapped a circle chip.
  const walkedIn = useMemo(() => {
    const out: Record<Ring, number> = { welcome: 0, village: 0, further: 0 };
    for (const q of quests) {
      if (claims[q.id]?.status === "consented") out[ringFor(q)] += 1;
    }
    return out;
  }, [quests, claims]);

  const [expandedRings, setExpandedRings] = useState<Partial<Record<Ring, boolean>>>({});

  const questById = useMemo(() => new Map(quests.map((q) => [q.id, q])), [quests]);
  const inFlight = claimList.filter(
    (c) => (c.status === "claimed" || c.status === "submitted") && questById.has(c.questId),
  );
  const suggestion = useMemo(
    () => (user && quests.length ? nextQuestFor(quests, claimList) : null),
    [user, quests, claimList],
  );
  const now = new Date();

  return (
    <Layout>
      {/* Hero */}
      <section className="py-10 md:py-24 bg-gradient-to-b from-teal/10 to-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-6"
          >
            <div className="w-16 h-16 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
              <Compass className="w-8 h-8 text-teal-700" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              Community Quests
            </h1>
            {/* R46 enchant-first: the surface line carries the invitation;
                the reward mechanics live in the tooltip. */}
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
              Real work, on real land, beside people becoming your people.
              Every quest you finish grows the village a little, and the
              village says thank you in{" "}
              <InfoTip tip={`${currencyName} is thanks for work, never pay. A finished quest carries its thank-you, released when the circle consents the work is done.`}>{currencyName}</InfoTip>.
            </p>
            <ExamplesBanner moduleId="quests" noun="quest" />
            <p className="text-sm text-muted-foreground mb-8">
              {quests.length} active quests &nbsp;·&nbsp; up to{" "}
              {quests
                .reduce((s, q) => s + rewardCeiling(q.gratitude), 0)
                .toLocaleString()}{" "}
              {currencyName} available
              <InfoTip tip="Every open quest names its own thank-you; this number is all of them added together." label="Where this number comes from" />
            </p>

          </motion.div>
        </div>
      </section>

      {/* Your journey: what you hold now, or the gentlest place to begin.
          Signed-out visitors see nothing here; the board speaks for itself. */}
      {user && (inFlight.length > 0 || suggestion) && (
        <section className="pb-4 bg-background">
          <div className="container max-w-7xl">
            <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-sm">
              <h2 className="font-display text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Sprout className="w-5 h-5 text-teal-deep" />
                {inFlight.length > 0 ? "Pick up where you left off" : "A good first quest"}
              </h2>
              {inFlight.length > 0 ? (
                <ul className="grid sm:grid-cols-2 gap-3">
                  {inFlight.map((c) => {
                    const q = questById.get(c.questId)!;
                    const Icon = iconFor(q.icon);
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/quests/${q.id}`}
                          className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-teal/40 hover:shadow-sm transition-all"
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
                                ? "In progress: submit your work when it's done"
                                : "Submitted, awaiting circle consent"}
                            </span>
                          </span>
                          <ArrowRight className="w-4 h-4 text-teal-deep shrink-0" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : suggestion ? (
                <Link
                  href={`/quests/${suggestion.quest.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-teal/40 hover:shadow-sm transition-all"
                >
                  <QuestPoster quest={suggestion.quest} className="w-14 h-14 rounded-xl shrink-0">
                    {(() => {
                      const Icon = iconFor(suggestion.quest.icon);
                      return <Icon className="absolute inset-0 m-auto w-6 h-6 text-white" />;
                    })()}
                  </QuestPoster>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-sm text-foreground truncate">
                      {suggestion.quest.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {suggestion.quest.subtitle ?? "A gentle way in. See the first step."}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-teal-deep shrink-0" />
                </Link>
              ) : null}
            </div>
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
                className={`px-3 min-h-[44px] inline-flex items-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
                  activeCircle === c
                    ? "bg-teal-deep text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center overflow-x-auto flex-nowrap" data-scroll-contain>
            <span className="text-sm text-muted-foreground ml-5 flex-shrink-0">Level:</span>
            {(["All", "Beginner", "Intermediate", "Advanced"] as const).map(
              (d) => (
                <button
                  key={d}
                  onClick={() => setActiveDifficulty(d)}
                  className={`px-3 min-h-[44px] inline-flex items-center whitespace-nowrap flex-shrink-0 rounded-full text-xs font-medium transition-colors ${
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
          <div className="max-w-2xl mx-auto bg-card border border-teal/20 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-center gap-4 text-left mt-6">
            <div className="w-12 h-12 rounded-xl bg-amber/15 flex items-center justify-center shrink-0">
              <Lightbulb className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h2 className="font-display text-lg font-bold text-foreground">
                Don't see your gift here?
              </h2>
              <p className="text-sm text-muted-foreground">
                Anyone with an idea to add value can propose their own unique quest.
                Tell us what you want to bring and what you'd need to make it real.
              </p>
            </div>
            <Link href="/propose-quest">
              <a className="shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity">
                Propose a Quest
                <ArrowRight className="w-4 h-4" />
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* The board, in rings. Each ring is a plain section with its own count,
          so the page reads as a walk rather than as one long wall. */}
      <section className="py-16 bg-background">
        <div className="container">
          <div className="max-w-7xl mx-auto mb-16 space-y-14">
            {RING_ORDER.map((ring) => {
              const all = byRing[ring] ?? [];
              if (all.length === 0) return null;
              const meta = RING_COPY[ring];
              const shown = expandedRings[ring]
                ? all
                : revealedFrom(all, user?.id ?? null, walkedIn[ring] ?? 0);
              const hidden = all.length - shown.length;
              return (
                <div key={ring}>
                  <div className="mb-5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="font-display text-2xl font-bold text-foreground">
                        {meta.title}
                      </h2>
                      {user && walkedIn[ring] > 0 && (
                        <span className="text-sm font-medium text-teal-deep">
                          {walkedIn[ring]} of {all.length} walked
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 max-w-2xl">
                      {meta.blurb}
                      {ring === "further" && (
                        <InfoTip tip="The Path of Growth is the membership ladder on your profile. Walking it, or holding a role, opens these quests." label="What opens these quests" />
                      )}
                    </p>
                  </div>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {shown.map((quest, index) => (
                      <motion.div
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
                          currencyName={currencyName}
                          priority={ring === RING_ORDER[0] && index === 0}
                        />
                      </motion.div>
                    ))}
                  </div>
                  {hidden > 0 && (
                    <button
                      onClick={() => setExpandedRings((r) => ({ ...r, [ring]: true }))}
                      className="mt-5 min-h-11 px-5 rounded-lg border border-border font-semibold text-teal-deep hover:border-teal/40 transition-colors"
                    >
                      Show all {all.length}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Compass className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>
                {boardFailed
                  ? "The quest board couldn't be loaded just now. Reload to try again."
                  : quests.length === 0
                    ? "There are no quests on the board yet."
                    : "No quests match those filters. Try a different combination."}
              </p>
            </div>
          )}

          {/* Life signs: recent consented completions. Absent when there are
              none — an empty feed renders as silence, never as a zero. */}
          {signs && signs.recent.length > 0 && (
            <div className="max-w-3xl mx-auto mb-16">
              <h2 className="font-display text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-gold" />
                Recently completed
              </h2>
              <ul className="space-y-2">
                {signs.recent.map((r, i) => (
                  <li key={`${r.questId}-${i}`}>
                    <Link
                      href={`/quests/${r.questId}`}
                      className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-teal/40 transition-colors"
                    >
                      <span className="text-sm text-foreground min-w-0 truncate">
                        <span className="font-semibold">{r.name}</span> completed{" "}
                        <span className="font-medium text-teal-deep">{r.questTitle}</span>
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
          <div className="max-w-3xl mx-auto text-center bg-gradient-to-br from-teal/10 to-sage/10 p-8 rounded-2xl border border-teal/10">
            <Star className="w-12 h-12 text-primary mx-auto mb-4" />
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-4">
              Ready to Take on a Quest?
            </h2>
            <p className="text-muted-foreground mb-6">
              Quests are open to anyone who has signed the Love Letter membership
              covenant. Join a community call to meet the circles and find your
              first quest.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {/* A fork with no events page shows no button rather than a dead
                  link, the same rule the footer follows. */}
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  <Calendar className="w-5 h-5" />
                  Join a Community Call
                </a>
              )}
              <Link href="/love-letter">
                <a className="px-6 py-3 bg-muted text-foreground rounded-lg font-semibold hover:bg-muted/80 transition-colors flex items-center gap-2">
                  <Heart className="w-5 h-5" />
                  Sign the Love Letter
                </a>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Gratitude Explainer */}
      <section className="py-16 bg-primary/5">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-bold text-foreground mb-4 text-center">
              About {currencyName}
            </h2>
            <p className="text-muted-foreground text-center mb-10">
              {villageName} acknowledges contributions in {currencyName}, a recognition signal with
              no financial value of its own. The value rides beside it: each cycle the
              community sets aside a real pool of {valueName} and shares it across
              everyone's {currencyName}, so appreciation decides where the value flows.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                {
                  title: "Earn",
                  body: `Complete quests, contribute to circles, steward the land, teach, build, host, create. Every meaningful act earns ${currencyName}.`,
                  icon: Heart,
                },
                {
                  title: "Hold",
                  body: `Your Village Profile accumulates ${currencyName} and reflects your full contribution history, a record of everything you have invested.`,
                  icon: Star,
                },
                {
                  title: "Share",
                  body: `Each cycle, everyone's ${currencyName} shares in a real pool of ${valueName}. As ${villageName} grows, ${valueName} can convert to cash, equity, or community currency. This is how we honor contributions made before we could pay in cash.`,
                  icon: Sprout,
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="bg-card rounded-xl p-6 shadow-sm text-center"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <item.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-foreground mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
