/**
 * THE SIX STEPS of "Propose my roles for next season" (role proposals PR C),
 * on `/role-proposals/:id`, one at a time with Back and Next, a step
 * indicator, and autosave on every change.
 *
 *   1 Pick your roles        existing roles (held by you, open, held by
 *                            someone else) or a new one, at most five
 *   2 Each role's words      every role word the card shows, gold where it
 *                            differs from the posted role; above them, bring
 *                            in a description of your role, and the prompt
 *                            for your own AI (./BringInRole.tsx, ./OwnAiPrompt.tsx)
 *   3 Your season            aim, 1 to 3 seasonal goals, the village's goals
 *                            for that season each serves
 *   4 Terms and review dates one set of terms, a review date per role, and
 *                            the load check
 *   5 Preview your card      the real player card in proposal mode, gold
 *   6 Share and submit       the share link, feedback, and submit
 *
 * THE PAGE HOLDS WHAT IS TYPED; THE SERVER HOLDS WHAT IS SAVED. Each change
 * marks its group dirty and the autosave sends the group whole
 * (`PUT /api/governance/role-proposals/:id`), built from what is typed over
 * the payload's own word fields (./roleWords.ts). The answer replaces the
 * payload, which is where the posted words, the gold and "ready to submit"
 * come from; nothing typed is overwritten by it.
 *
 * A submitted proposal draws where it stands instead (ProposalState).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { loadOrg } from "@/components/governance/pickSources";
import { PlayerRoleCardView } from "@/components/playerCard/PlayerRoleCard";
import { BreathingLoader } from "@/components/natural";
import { servedBody, servedRows, seasonalBody } from "@/components/seasonPlans/SeasonGoalsFields";
import type { PlayerCardPayload } from "@shared/playerCardPayload";
import { civilDayWords } from "@shared/seasonPlans";
import { parseSeatSettings, type SeatSettings } from "@shared/seatSettings";
import { PROPOSAL_WORDS } from "@shared/roleProposals";
import {
  fetchApplicationsForCounts,
  fetchProposalCard,
  saveProposal,
  type ProposalOut,
  type ProposalUpdate,
  type ShareOut,
} from "./proposalApi";
import { RP_WORDS, STEP_TITLES, STEPS, type StepKey } from "./proposalWords";
import { changedSections, newWordsToSave, roleProblems, shownText, stateFrom, wordsToSave } from "./roleWords";
import { FOCUS, H2, LEDE, PRIMARY, SaveLine, SECONDARY } from "./parts";
import { useAutosave, type Group, type SaveResult } from "./useAutosave";
import StepRoles, { type OrgView } from "./StepRoles";
import StepWords, { type WordsRole } from "./StepWords";
import StepSeason, { type SeasonState } from "./StepSeason";
import StepTerms from "./StepTerms";
import StepShare from "./StepShare";
import BringInRole from "./BringInRole";
import OwnAiPrompt from "./OwnAiPrompt";
import ProposalState from "./ProposalState";

interface LocalNew {
  id: string;
  circleId: string;
  seats: number;
}

const seasonFrom = (p: ProposalOut): SeasonState => ({
  aim: p.season?.aim ?? "",
  seasonal: (p.season?.seasonalGoals ?? []).map((g) => ({ title: g.title, doneWhen: g.doneWhen ?? "" })),
  served: servedRows(p.orgGoals, p.season?.servesGoals ?? []),
});

const reviewsFrom = (p: ProposalOut): Record<string, string> =>
  Object.fromEntries([...p.roles.map((r) => [r.roleId, r.reviewOn ?? ""]), ...p.newRoles.map((r) => [r.id, r.reviewOn ?? ""])]);

function stepFromUrl(): StepKey {
  if (typeof window === "undefined") return "roles";
  const s = new URLSearchParams(window.location.search).get("step");
  return (STEPS as readonly string[]).includes(s ?? "") ? (s as StepKey) : "roles";
}

/** The card in proposal mode, with the changed words in gold. */
export function ProposalPreview({ proposal }: { proposal: ProposalOut }) {
  const [card, setCard] = useState<PlayerCardPayload | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    void fetchProposalCard(proposal.id).then((r) => {
      if (alive) setCard(r.ok ? r.data : "failed");
    });
    return () => {
      alive = false;
    };
  }, [proposal.id, proposal.updatedAt]);
  if (card === null) return <BreathingLoader label={RP_WORDS.loadingPreview} />;
  if (card === "failed") return <p className="text-coral">{RP_WORDS.previewFailed}</p>;
  return <PlayerRoleCardView data={card} mode="proposal" changed={changedSections(proposal)} />;
}

export default function ProposalEditor({ initial, me }: { initial: ProposalOut; me: string }) {
  const [proposal, setProposal] = useState(initial);
  const [step, setStep] = useState<StepKey>(stepFromUrl);
  const [picked, setPicked] = useState<string[]>(() => initial.roles.map((r) => r.roleId));
  const [newRoles, setNewRoles] = useState<LocalNew[]>(() => initial.newRoles.map((r) => ({ id: r.id, circleId: r.circle?.id ?? "", seats: r.seats })));
  const [reviews, setReviews] = useState<Record<string, string>>(() => reviewsFrom(initial));
  const [typed, setTyped] = useState<Record<string, Record<string, string>>>({});
  const [settings, setSettings] = useState<SeatSettings>(() => initial.settings ?? { v: 1 });
  const [season, setSeason] = useState<SeasonState>(() => seasonFrom(initial));
  const [org, setOrg] = useState<OrgView | null | "failed">(null);
  const [applying, setApplying] = useState<Map<string, number>>(new Map());

  // The newest of everything, for the save to read when it runs.
  const latest = useRef({ proposal, picked, newRoles, reviews, typed, settings, season });
  latest.current = { proposal, picked, newRoles, reviews, typed, settings, season };

  useEffect(() => {
    let alive = true;
    void loadOrg().then((o) => {
      if (!alive) return;
      setOrg(o ? { roles: Array.isArray(o.roles) ? o.roles : [], circles: Array.isArray(o.circles) ? o.circles : [] } : "failed");
    });
    void fetchApplicationsForCounts().then((r) => {
      if (!alive || !r.ok) return;
      const counts = new Map<string, number>();
      for (const a of r.data.applications ?? []) {
        if (a.status !== "awaiting-holder" && a.status !== "voting") continue;
        if (String(a.candidate?.id ?? "") === me) continue;
        for (const s of a.seats ?? []) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      }
      setApplying(counts);
    });
    return () => {
      alive = false;
    };
  }, [me]);

  const send = useCallback(async (groups: ReadonlySet<Group>): Promise<SaveResult> => {
    const s = latest.current;
    const p = s.proposal;
    const update: ProposalUpdate = {};
    if (groups.has("roles")) {
      const roles: NonNullable<ProposalUpdate["roles"]> = [];
      for (const roleId of s.picked) {
        const server = p.roles.find((r) => r.roleId === roleId);
        const st = stateFrom(server?.fields ?? [], s.typed[roleId] ?? {});
        const problem = server ? Object.values(roleProblems(st, false))[0] : undefined;
        if (problem) return { ok: false, error: problem };
        roles.push({ roleId, words: server ? wordsToSave(st) : {}, reviewOn: s.reviews[roleId] || null });
      }
      update.roles = roles;
    }
    if (groups.has("newRoles")) {
      const list: NonNullable<ProposalUpdate["newRoles"]> = [];
      for (const n of s.newRoles) {
        const server = p.newRoles.find((r) => r.id === n.id);
        const st = stateFrom(server?.fields ?? [], s.typed[n.id] ?? {});
        const problem = Object.values(roleProblems(st, true))[0];
        if (problem) return { ok: false, error: problem };
        list.push({ id: n.id, circleId: n.circleId, seats: n.seats, words: newWordsToSave(st), reviewOn: s.reviews[n.id] || null });
      }
      update.newRoles = list;
    }
    if (groups.has("settings")) {
      if (!parseSeatSettings(s.settings).ok) return { ok: false, error: RP_WORDS.termsNotSaved };
      update.settings = s.settings;
    }
    if (groups.has("season")) {
      update.season = { aim: s.season.aim.trim() || null, seasonalGoals: seasonalBody(s.season.seasonal), servesGoals: servedBody(s.season.served) };
    }
    const r = await saveProposal(p.id, update);
    if (!r.ok) return { ok: false, error: r.error };
    setProposal(r.data.proposal);
    return { ok: true };
  }, []);

  const save = useAutosave(send);

  /** A draft the server answered as a whole (a role card filled it): everything typed starts again from it. */
  const adopt = (p: ProposalOut) => {
    setProposal(p);
    setPicked(p.roles.map((r) => r.roleId));
    setNewRoles(p.newRoles.map((r) => ({ id: r.id, circleId: r.circle?.id ?? "", seats: r.seats })));
    setReviews(reviewsFrom(p));
    setTyped({});
    setSettings(p.settings ?? { v: 1 });
    setSeason(seasonFrom(p));
  };
  const isNewId = (id: string) => latest.current.newRoles.some((n) => n.id === id);

  // A field scrolled to by focus stops above the sticky save bar and the tab bar, never under them.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "11rem";
    return () => {
      root.style.scrollPaddingBottom = before;
    };
  }, []);

  const go = async (next: StepKey) => {
    await save.flush();
    setStep(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("step", next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      window.scrollTo?.({ top: 0 });
    }
  };

  const toggle = (roleId: string) => {
    const on = picked.includes(roleId);
    if (!on && picked.length + newRoles.length >= proposal.limits.maxRoles) return;
    setPicked(on ? picked.filter((r) => r !== roleId) : [...picked, roleId]);
    save.touch("roles");
  };

  const addNew = async (circleId: string, name: string): Promise<string | null> => {
    if (picked.length + newRoles.length >= proposal.limits.maxRoles) return PROPOSAL_WORDS.tooManyRoles;
    await save.flush();
    const s = latest.current;
    const kept = s.newRoles.map((n) => {
      const server = s.proposal.newRoles.find((r) => r.id === n.id);
      return { id: n.id, circleId: n.circleId, seats: n.seats, words: newWordsToSave(stateFrom(server?.fields ?? [], s.typed[n.id] ?? {})), reviewOn: s.reviews[n.id] || null };
    });
    const r = await saveProposal(s.proposal.id, { newRoles: [...kept, { circleId, words: { name }, reviewOn: null }] });
    if (!r.ok) return r.error;
    setProposal(r.data.proposal);
    setNewRoles(r.data.proposal.newRoles.map((n) => ({ id: n.id, circleId: n.circle?.id ?? circleId, seats: n.seats })));
    return null;
  };

  const removeNew = (id: string) => {
    setNewRoles((list) => list.filter((n) => n.id !== id));
    save.touch("newRoles");
  };

  const type = (roleId: string, field: string, text: string) => {
    setTyped((t) => ({ ...t, [roleId]: { ...(t[roleId] ?? {}), [field]: text } }));
    save.touch(isNewId(roleId) ? "newRoles" : "roles");
  };

  const review = (roleId: string, day: string) => {
    setReviews((r) => ({ ...r, [roleId]: day }));
    save.touch(isNewId(roleId) ? "newRoles" : "roles");
  };

  if (proposal.status === "submitted") {
    return (
      <div className="grid gap-6">
        <ProposalState proposal={proposal} />
        <ProposalPreview proposal={proposal} />
      </div>
    );
  }

  const orgRole = (id: string) => (org && org !== "failed" ? org.roles.find((r) => r.id === id) : undefined);
  const circleName = (id: string) => (org && org !== "failed" ? org.circles.find((c) => c.id === id)?.name ?? null : null);

  const wordsRoles: WordsRole[] = [
    ...picked.map((roleId) => {
      const server = proposal.roles.find((r) => r.roleId === roleId);
      const o = orgRole(roleId);
      return {
        id: roleId,
        name: server?.name ?? o?.name ?? roleId,
        isNew: false,
        fields: server?.fields ?? null,
        reviewOn: reviews[roleId] ?? "",
        circle: server?.circle ?? null,
        holderCount: o?.holderCount ?? (o?.holders ?? []).length,
      };
    }),
    ...newRoles.map((n) => {
      const server = proposal.newRoles.find((r) => r.id === n.id);
      const typedName = typed[n.id]?.name;
      return {
        id: n.id,
        name: (typedName ?? server?.name ?? "").trim() || RP_WORDS.newRoleTag,
        isNew: true,
        fields: server?.fields ?? null,
        reviewOn: reviews[n.id] ?? "",
        circle: server?.circle ?? null,
        holderCount: 0,
      };
    }),
  ];

  const index = STEPS.indexOf(step);
  const target = proposal.target;

  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-bold text-stone-900">{RP_WORDS.title}</h1>
        <p className={LEDE}>{target ? RP_WORDS.forSeason(target.name, civilDayWords(target.startsOn)) : proposal.targetWords}</p>
      </header>

      <nav aria-label={RP_WORDS.stepOf(index + 1, STEPS.length)}>
        <ol className="flex flex-wrap gap-2" data-step-indicator="">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => void go(s)}
                aria-current={s === step ? "step" : undefined}
                aria-label={RP_WORDS.goToStep(i + 1, STEP_TITLES[s])}
                className={`inline-flex size-11 items-center justify-center rounded-full border text-sm font-semibold ${FOCUS} ${
                  s === step ? "border-teal-deep bg-teal-deep text-white" : i < index ? "border-teal-deep text-teal-deep" : "border-stone-300 text-stone-600"
                }`}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="rp-step-title" className="grid gap-4" data-step={step}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{RP_WORDS.stepOf(index + 1, STEPS.length)}</p>
          <h2 id="rp-step-title" className={H2}>
            {STEP_TITLES[step]}
          </h2>
        </div>

        {step === "roles" && (
          <StepRoles
            proposal={proposal}
            picked={picked}
            newRoles={newRoles.map((n) => ({ id: n.id, name: wordsRoles.find((w) => w.id === n.id)?.name ?? n.id, circleName: circleName(n.circleId) }))}
            org={org}
            applying={applying}
            me={me}
            onToggle={toggle}
            onAddNew={addNew}
            onRemoveNew={removeNew}
          />
        )}
        {step === "words" && (
          <>
            <BringInRole proposal={proposal} org={org} beforeImport={save.flush} onFilled={adopt} />
            <OwnAiPrompt proposal={proposal} org={org} />
            <StepWords roles={wordsRoles} typed={typed} frameworkTerms={proposal.frameworkTerms === true} onType={type} onReview={review} />
          </>
        )}
        {step === "season" && (
          <StepSeason
            season={season}
            orgGoals={proposal.orgGoals}
            onChange={(next) => {
              setSeason(next);
              save.touch("season");
            }}
          />
        )}
        {step === "terms" && (
          <StepTerms
            roles={wordsRoles.map((r) => ({ id: r.id, name: r.name, reviewOn: r.reviewOn, time: shownText(stateFrom(r.fields ?? [], typed[r.id] ?? {}), "timeCommitment") || null }))}
            settings={settings}
            onReview={review}
            onSettings={(next) => {
              setSettings(next);
              save.touch("settings");
            }}
          />
        )}
        {step === "preview" && (
          <div className="grid gap-3">
            <p className={LEDE}>{RP_WORDS.previewLede}</p>
            <ProposalPreview proposal={proposal} />
          </div>
        )}
        {step === "share" && (
          <StepShare
            proposal={proposal}
            onShare={(share: ShareOut) => setProposal((p) => ({ ...p, share }))}
            beforeSubmit={save.flush}
            onSubmitted={(p) => p && setProposal(p)}
          />
        )}
      </section>

      {/*
        The save line and Back and Next, kept in reach. On a phone the bar sits
        on top of the site's tab bar (h-16 plus the safe area, MobileTabBar.tsx)
        and the shortcuts button steps out while the steps are open, the way a
        journal sitting's Next does (index.css, `data-hides-fab-phone`).
      */}
      <div
        data-hides-fab-phone
        data-step-bar=""
        className="sticky bottom-[var(--rp-bar-bottom)] z-10 -mx-4 grid gap-1 border-t border-stone-200 bg-white/95 px-4 py-2 backdrop-blur md:bottom-0"
        style={{ "--rp-bar-bottom": "max(calc(env(safe-area-inset-bottom, 0px) + 4rem), 4rem)" } as React.CSSProperties}
      >
        <SaveLine status={save.status} error={save.error} onRetry={() => void save.flush()} />
        <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={index === 0} onClick={() => void go(STEPS[index - 1])} className={SECONDARY}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {RP_WORDS.back}
          </button>
          {index < STEPS.length - 1 && (
            <button type="button" onClick={() => void go(STEPS[index + 1])} className={PRIMARY}>
              {RP_WORDS.next}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
