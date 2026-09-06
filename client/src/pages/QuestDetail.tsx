/**
 * A quest's own page (/quests/:id): the second and third tiers of the
 * disclosure ladder the board starts. The card said "this exists, here is
 * the offer"; this page says why it matters, how to begin, how to do it,
 * what to share, and who else is in the field. Claiming and submitting
 * live here too, so the board stays calm and every quest is deep-linkable:
 * a member can hand a friend a URL that IS the quest.
 *
 * Lessons carried over from the sibling game's quest specs, adapted to this
 * platform's shape:
 *   - a first step small enough to do today, stated before the full path;
 *   - "what you'll share" sits directly above the submit form it feeds;
 *   - life signs are real counts or silence, never a zero;
 *   - a gated quest stays in full color and says what opens it.
 */
import Layout from "@/components/Layout";
import { Link, useRoute } from "wouter";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ClipboardCheck, Clock, Compass, Footprints,
  Heart, Lightbulb, ListChecks, Send, Sparkles, Sprout, Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGameMe, QuestClaim, useGameConfig } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import QuestActions from "@/components/QuestActions";
import QuestCrews from "@/components/QuestCrews";
import QuestCard, { difficultyColors, iconFor, QuestPoster } from "@/components/QuestCard";
import {
  currentClaims, gateLabel, relativeWhen, statusIs,
  type BoardQuest, type FieldSigns,
} from "@/lib/questBoard";

export default function QuestDetail() {
  const [, params] = useRoute("/quests/:id");
  const questId = params?.id ?? "";
  const cfg = useGameConfig();
  const currencyName = useTokenName("Recognition");
  const stages = cfg?.stages ?? [];
  const { user } = useAuth();
  const [quest, setQuest] = useState<BoardQuest | null>(null);
  const [related, setRelated] = useState<BoardQuest[]>([]);
  const [signs, setSigns] = useState<FieldSigns | null>(null);
  const [claims, setClaims] = useState<Record<string, QuestClaim>>({});
  /**
   * The recognition token's scale, off the same `/api/game/me` call the claims
   * come from. A claim's `amount` and `credited` are ledger figures, so the
   * payout line needs this to read as the number the member was actually paid.
   * See client/src/lib/tokenAmount.ts.
   */
  const [payoutDecimals, setPayoutDecimals] = useState(0);
  const [roleName, setRoleName] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!questId) return;
    let live = true;
    setLoaded(false);
    // One quest and the three beside it, in one small response. Finding the
    // quest inside the whole board meant every deep link carried every other
    // quest's story, steps and tips across the wire.
    fetch(`/api/quests/${encodeURIComponent(questId)}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`quest ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!live) return;
        setQuest(d?.quest ?? null);
        setRelated(Array.isArray(d?.related) ? d.related : []);
      })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoaded(true); });
    fetch("/api/quests/field")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && d.perQuest) setSigns(d); })
      .catch(() => { /* the page renders without counts */ });
    return () => { live = false; };
  }, [questId]);

  const refreshClaims = () => {
    fetchGameMe().then((me) => {
      if (!me) return;
      setClaims(currentClaims(me.quests));
      setPayoutDecimals(Number(me.gratitude?.decimals ?? 0));
    });
  };
  useEffect(refreshClaims, []);

  // A role gate names its role properly when the quest carries no display
  // prose of its own. Fetched only when needed; a miss falls back to the
  // generic label from gateLabel().
  useEffect(() => {
    if (!quest?.requiresRole || quest.roleRequired) return;
    fetch("/api/roles")
      .then((r) => (r.ok ? r.json() : null))
      .then((roles) => {
        const hit = Array.isArray(roles)
          ? roles.find((x: any) => x.id === quest.requiresRole)
          : null;
        if (hit?.name) setRoleName(String(hit.name));
      })
      .catch(() => { /* generic label stands */ });
  }, [quest?.requiresRole, quest?.roleRequired]);

  const claim = quest ? claims[quest.id] : undefined;
  const questSigns = quest ? signs?.perQuest?.[quest.id] : undefined;
  const active = questSigns?.active ?? 0;
  const done = questSigns?.done ?? 0;
  const completions = useMemo(
    () => (quest && signs ? signs.recent.filter((r) => r.questId === quest.id) : []),
    [quest, signs],
  );
  const gate = quest ? gateLabel(quest, stages) : null;
  const gateText =
    quest?.requiresRole && !quest.roleRequired && roleName
      ? `Held for: ${roleName}`
      : gate;
  const now = new Date();
  const Icon = iconFor(quest?.icon);
  const steps = quest?.steps ?? [];
  const tips = quest?.tips ?? [];
  const why = quest?.story ?? quest?.description ?? "";

  if (loaded && !quest) {
    return (
      <Layout>
        <section className="py-24 bg-background min-h-[60vh]">
          <div className="container max-w-2xl text-center">
            <Compass className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <h1 className="font-display text-2xl font-bold text-foreground mb-3">
              {failed
                ? "The quest board couldn't be loaded just now."
                : "That quest is not on the board."}
            </h1>
            <p className="text-muted-foreground mb-8">
              {failed
                ? "Reload to try again."
                : "It may have been completed and retired, or the link may be old."}
            </p>
            <Link
              href="/quests"
              className="inline-flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              All quests
            </Link>
          </div>
        </section>
      </Layout>
    );
  }

  if (!quest) {
    // A blank panel on a slow phone reads as a broken page. The skeleton is
    // the shape the quest will take, so the layout does not jump when it lands.
    return (
      <Layout>
        <section className="py-10 bg-background min-h-[60vh]">
          <div className="container max-w-5xl" aria-busy="true">
            <span className="sr-only">Loading this quest</span>
            <div className="rounded-3xl aspect-[16/9] sm:aspect-[21/9] bg-muted animate-pulse" />
            <div className="flex gap-2.5 mt-4">
              <div className="h-8 w-32 rounded-full bg-muted animate-pulse" />
              <div className="h-8 w-24 rounded-full bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-3/4 rounded bg-muted animate-pulse mt-8" />
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse mt-3" />
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Poster hero */}
      <section className="bg-background">
        <div className="container max-w-5xl pt-6">
          <Link
            href="/quests"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-deep hover:text-teal transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            All quests
          </Link>
          <QuestPoster
            quest={quest}
            priority
            className="rounded-3xl aspect-[16/9] sm:aspect-[21/9] shadow-md"
          >
            <div className="absolute top-4 left-4 w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Icon className="w-6 h-6 text-white" />
            </div>
            {statusIs(quest, "seasonal") && (
              <span className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-white/85 text-teal-deep text-xs font-bold uppercase tracking-wide">
                Seasonal
              </span>
            )}
            <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-7">
              {quest.circle && (
                <p className="text-white/80 text-xs sm:text-sm font-medium mb-1">{quest.circle}</p>
              )}
              <h1 className="font-display text-2xl sm:text-4xl font-bold text-white leading-tight drop-shadow-sm">
                {quest.title}
              </h1>
              {quest.subtitle && (
                <p className="text-white/90 text-sm sm:text-lg mt-1.5 italic">{quest.subtitle}</p>
              )}
            </div>
          </QuestPoster>

          {/* The offer, stated once and plainly */}
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            {quest.gratitude && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                <Heart className="w-4 h-4" />
                {quest.gratitude} {currencyName}
              </span>
            )}
            {quest.duration && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-sm">
                <Clock className="w-4 h-4" />
                {quest.duration}
              </span>
            )}
            {quest.difficulty && (
              <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${difficultyColors[quest.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                {quest.difficulty}
              </span>
            )}
            {(active > 0 || done > 0) && (
              <span className="inline-flex items-center gap-3 text-sm text-muted-foreground ml-1">
                {active > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-teal-deep">
                    <Users className="w-4 h-4" /> {active} in the field now
                  </span>
                )}
                {done > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {done} completed
                  </span>
                )}
              </span>
            )}
          </div>

          {quest.isExample && (
            <p className="mt-4 text-sm text-muted-foreground bg-amber/10 border border-amber/30 rounded-xl px-4 py-3">
              A standing example. It shows what a quest looks like here until the
              village posts its own, and it cannot be claimed.
            </p>
          )}
        </div>
      </section>

      <section className="py-10 bg-background">
        <div className="container max-w-5xl grid lg:grid-cols-[1fr_360px] gap-8 items-start">
          {/* The reading column */}
          <div className="space-y-8 min-w-0">
            {/* Why this quest matters. A quest with no story and no
                description renders no heading either: an empty section is the
                one thing the board's own empty-state law forbids. */}
            {(why || quest.impact) && (
              <div>
                <h2 className="font-display text-xl font-bold text-foreground mb-3">
                  Why this quest matters
                </h2>
                {why && (
                  <p className="text-muted-foreground leading-relaxed">{why}</p>
                )}
                {quest.impact && (
                  <p className="mt-3 text-sm text-foreground/70 italic border-l-2 border-teal/40 pl-3">
                    "{quest.impact}"
                  </p>
                )}
              </div>
            )}

            {/* The first step: small enough to do today */}
            {quest.firstStep && (
              <div className="bg-amber-light border border-amber/30 rounded-2xl p-5">
                <h2 className="font-display text-lg font-bold text-gold mb-2 flex items-center gap-2">
                  <Footprints className="w-5 h-5" />
                  Your first step
                </h2>
                <p className="text-foreground/90 leading-relaxed">{quest.firstStep}</p>
                <p className="text-xs text-foreground/60 mt-2">
                  Fifteen minutes or less. The rest of the quest can wait until you have done this.
                </p>
              </div>
            )}

            {/* The path through the work */}
            {steps.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                  <ListChecks className="w-5 h-5 text-teal-deep" />
                  How to do this quest
                </h2>
                <ol className="space-y-3">
                  {steps.map((step, i) => (
                    <li key={i} className="flex gap-3 bg-card border border-border rounded-xl p-4">
                      <span className="shrink-0 w-7 h-7 rounded-full bg-teal-deep text-white text-sm font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <p className="text-sm text-foreground/90 leading-relaxed pt-0.5">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Tips from people who have done it */}
            {tips.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-bold text-foreground mb-3 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-gold" />
                  Worth knowing
                </h2>
                <ul className="space-y-2">
                  {tips.map((tip, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
                      <Sparkles className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Who has walked it */}
            {completions.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-bold text-foreground mb-3">
                  Recently completed by
                </h2>
                <ul className="space-y-1.5">
                  {completions.map((r, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{r.name}</span>
                      {r.when ? `, ${relativeWhen(r.when, now)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* The doing column */}
          <aside className="lg:sticky lg:top-28 space-y-4">
            {/* What you'll share, directly above the form it feeds */}
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 pb-4">
                <h2 className="font-display text-lg font-bold text-foreground mb-2 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-teal-deep" />
                  What you'll share
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {quest.deliverable ??
                    "A link or a few words showing what you did. The circle reads it before consenting."}
                </p>
                {quest.gratitude && (
                  <p className="text-xs text-muted-foreground mt-3">
                    The circle sets the exact amount inside the {quest.gratitude} range
                    when it consents to your work. What a quest advertises is what it pays.
                  </p>
                )}
              </div>
              <QuestActions
                questId={quest.id}
                signedIn={!!user}
                claim={claim}
                decimals={payoutDecimals}
                onChanged={refreshClaims}
              />
            </div>

            {/* The gate, in full color, saying what opens it */}
            {gateText && (
              <div className="bg-sage-light border border-sage/30 rounded-2xl p-5">
                <p className="flex items-center gap-2 font-semibold text-sage text-sm mb-1.5">
                  <Sprout className="w-4 h-4" />
                  {gateText}
                </p>
                <p className="text-xs text-foreground/70 leading-relaxed">
                  {quest.minStage
                    ? "Keep walking the Path of Growth and this opens on its own."
                    : "Ask a founder or the circle about stepping into it."}
                </p>
              </div>
            )}

            {/* Who is walking it with you */}
            {!quest.isExample && <QuestCrews questId={quest.id} signedIn={!!user} />}

            {/* Submitted state gets a small reassurance */}
            {claim?.status === "submitted" && (
              <p className="flex items-center gap-2 text-sm text-blue-700 px-1">
                <Send className="w-4 h-4" />
                A steward will review your work soon.
              </p>
            )}
          </aside>
        </div>
      </section>

      {/* More from this circle */}
      {related.length > 0 && (
        <section className="py-10 bg-primary/5">
          <div className="container max-w-5xl">
            <h2 className="font-display text-xl font-bold text-foreground mb-5">
              More from {quest.circle}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {related.map((q) => (
                <QuestCard
                  key={q.id}
                  quest={q}
                  claim={claims[q.id]}
                  signs={signs?.perQuest?.[q.id]}
                  stages={stages}
                  currencyName={currencyName}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* The board's standing invitation, carried through */}
      <section className="py-10 bg-background">
        <div className="container max-w-3xl text-center">
          <p className="text-sm text-muted-foreground">
            None of these fit your gift?{" "}
            <Link href="/propose-quest" className="font-semibold text-teal-deep hover:text-teal transition-colors">
              Propose your own quest
            </Link>
            .
          </p>
        </div>
      </section>
    </Layout>
  );
}
