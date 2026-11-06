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
import { operationsRoleName, opsPartner, withPartnerName } from "@shared/roleProposalHonesty";
import { stepDone, type StepDoneCopy } from "@shared/stepDone";
import { civilDayWords } from "@shared/seasonPlans";
import { parseSeatSettings, settingsWords, type SeatSettings } from "@shared/seatSettings";
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
import { resumeAt } from "@shared/roleProposalProgress";
import { changedSections, newWordsToSave, roleProblems, shownText, stateFrom, wordsToSave } from "./roleWords";
import { FOCUS, H2, LEDE, PRIMARY, SaveLine, SECONDARY } from "./parts";
import { useAutosave, type Group, type SaveResult } from "./useAutosave";
import StepRoles, { type OrgView } from "./StepRoles";
import StepWords, { type WordsRole } from "./StepWords";
import StepSeason, { type SeasonState } from "./StepSeason";
import StepTerms from "./StepTerms";
import StepShare from "./StepShare";
import { PathToggle, WelcomeScreen, YourWordsActions, YourWordsScreen, pathFromUrl, readPlace, rememberPath, roleFromUrl, urlNamesPlace, writePlace, type FrontScreen, type ProposalPath } from "./QuickPath";
import StepDoneCard from "./StepDoneCard";
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
  ownWords: {
    love: p.season?.ownWords?.love ?? "",
    offer: p.season?.ownWords?.offer ?? "",
    why: p.season?.ownWords?.why ?? "",
  },
});

const reviewsFrom = (p: ProposalOut): Record<string, string> =>
  Object.fromEntries([...p.roles.map((r) => [r.roleId, r.reviewOn ?? ""]), ...p.newRoles.map((r) => [r.id, r.reviewOn ?? ""])]);

function fromDraft(p: ProposalOut): { path: ProposalPath; step: StepKey; front: FrontScreen } | null {
  if (p.status !== "draft") return null;
  const at = resumeAt({
    roleCount: p.roles.length + p.newRoles.length,
    love: p.season?.ownWords?.love,
    offer: p.season?.ownWords?.offer,
    why: p.season?.ownWords?.why,
    aim: p.season?.aim,
    goalCount: p.season?.seasonalGoals?.length ?? 0,
  });
  return at ? { path: pathFromUrl(), step: at.step, front: at.front } : null;
}

function stepFromUrl(): StepKey {
  if (typeof window === "undefined") return "roles";
  const s = new URLSearchParams(window.location.search).get("step");
  return (STEPS as readonly string[]).includes(s ?? "") ? (s as StepKey) : "roles";
}

/** The card in proposal mode, with the changed words in gold. */
/** `partner` is the Ops role from the village chart, as the terms step reads it; null while it loads. */
export function ProposalPreview({ proposal, partner }: { proposal: ProposalOut; partner?: string | null }) {
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
  if (card === null || partner === null) return <BreathingLoader label={RP_WORDS.loadingPreview} />;
  if (card === "failed") return <p className="text-coral">{RP_WORDS.previewFailed}</p>;
  return <PlayerRoleCardView data={withPartnerName(card, partner)} mode="proposal" changed={changedSections(proposal)} />;
}

export default function ProposalEditor({ initial, me }: { initial: ProposalOut; me: string }) {
  // This tab's place first; failing that, the first unwritten part of the saved draft (a new tab agrees).
  const resumed = !urlNamesPlace() ? readPlace(initial.id) ?? fromDraft(initial) : null;
  const [proposal, setProposal] = useState(initial);
  const [step, setStep] = useState<StepKey>(resumed?.step ?? stepFromUrl);
  const submitOpen = useRef<() => void>(() => {});
  const [submitOff, setSubmitOff] = useState(true);
  const onSubmitGate = useCallback((gate: { open: () => void; off: boolean }) => {
    submitOpen.current = gate.open;
    setSubmitOff((prev) => (prev === gate.off ? prev : gate.off));
  }, []);
  const [path, setPath] = useState<ProposalPath>(resumed?.path ?? pathFromUrl);
  const [front, setFront] = useState<FrontScreen>(resumed?.front ?? ((resumed?.path ?? pathFromUrl()) === "quick" ? "welcome" : "steps"));
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [done, setDone] = useState<StepDoneCopy | null>(null);
  const [orgAttempt, setOrgAttempt] = useState(0);
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
    setOrg(null);
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
  }, [me, orgAttempt]);

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
      update.season = {
        aim: s.season.aim.trim() || null,
        seasonalGoals: seasonalBody(s.season.seasonal),
        servesGoals: servedBody(s.season.served),
        ownWords: s.season.ownWords,
      };
    }
    const r = await saveProposal(p.id, update);
    if (!r.ok) return { ok: false, error: r.error };
    setProposal(r.data.proposal);
    return { ok: true };
  }, []);

  const save = useAutosave(send);
  const seededRole = useRef(false);
  // A role card can open this draft with that role already picked, up to the five.
  useEffect(() => {
    if (proposal.status !== "draft" || seededRole.current || !org || org === "failed") return;
    const role = roleFromUrl();
    if (!role) return;
    seededRole.current = true;
    if (!org.roles.some((r) => r.id === role && !r.isExample)) {
      setSeedNote(RP_WORDS.roleNotOnChart);
      return;
    }
    const now = latest.current;
    if (now.picked.includes(role)) return;
    if (now.picked.length + now.newRoles.length >= now.proposal.limits.maxRoles) {
      setSeedNote(RP_WORDS.atMost(now.proposal.limits.maxRoles));
      return;
    }
    // The save reads this ref, and it is only rewritten on the next render.
    // Write the pick in before the save is asked, or the save can leave with the old list.
    const picked = [...now.picked, role];
    latest.current = { ...now, picked };
    setPicked(picked);
    save.touch("roles");
  }, [org, save, proposal.status]);

  const choosePath = (next: ProposalPath) => {
    if (next === path) return;
    setPath(next);
    rememberPath(next);
    setFront(next === "full" ? "steps" : "yours");
  };

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
    root.style.scrollPaddingBottom = "calc(env(safe-area-inset-bottom, 0px) + 7rem)";
    return () => {
      root.style.scrollPaddingBottom = before;
    };
  }, []);

  useEffect(() => {
    const id = done ? "rp-step-done" : front === "steps" ? "rp-step-title" : front === "yours" ? "rp-your-words" : "rp-welcome";
    document.getElementById(id)?.focus();
  }, [step, front, done]);

  useEffect(() => {
    if (proposal.status !== "draft") return;
    writePlace(proposal.id, { path, step, front });
  }, [proposal.id, proposal.status, path, step, front]);

  const [goFailed, setGoFailed] = useState<StepKey | null>(null);
  const go = async (next: StepKey) => {
    const ok = await save.flush();
    if (!ok) {
      // Never a silent click: say it did not save, and offer the same move again.
      setGoFailed(next);
      return;
    }
    setGoFailed(null);
    const forward = STEPS.indexOf(next) > STEPS.indexOf(step);
    setDone(forward && step !== "share" ? stepDone(step) : null);
    setStep(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("step", next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      window.scrollTo?.({ top: 0 });
    }
  };

  const [limitNote, setLimitNote] = useState<string | null>(null);
  const toggle = (roleId: string) => {
    const on = picked.includes(roleId);
    if (!on && picked.length + newRoles.length >= proposal.limits.maxRoles) {
      setLimitNote(PROPOSAL_WORDS.tooManyRoles);
      return;
    }
    setLimitNote(null);
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
      <div className="grid min-w-0 gap-6">
        <ProposalState proposal={proposal} />
        <ProposalPreview proposal={proposal} partner={org === null ? null : opsPartner(operationsRoleName(org !== "failed" ? org.roles : []))} />
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
  const quick = path === "quick";
  const progressTotal = quick ? STEPS.length + 2 : STEPS.length;
  const progressNow = front === "welcome" ? 1 : front === "yours" ? 2 : quick ? index + 3 : index + 1;

  return (
    <div data-proposal-pad="" className="grid gap-5 max-md:pb-[env(safe-area-inset-bottom,0px)]">
      <PathToggle path={path} onPath={choosePath} />
      <div className="grid gap-1">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progressTotal}
          aria-valuenow={progressNow}
          aria-label={front === "steps" ? RP_WORDS.stepOf(index + 1, STEPS.length) : front === "yours" ? RP_WORDS.yourWordsTitle : RP_WORDS.welcomeTitle}
          className="h-2.5 overflow-hidden rounded-md border border-dash-edge bg-dash-track"
        >
          <div
            className="h-full bg-[linear-gradient(90deg,var(--color-dash-gold),var(--color-dash-gold-lit))]"
            style={{ width: `${Math.round((progressNow / progressTotal) * 100)}%` }}
          />
        </div>
      </div>
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-bold text-foreground">{RP_WORDS.title}</h1>
        <p className={LEDE}>{target ? RP_WORDS.forSeason(target.name, civilDayWords(target.startsOn)) : proposal.targetWords}</p>
        {seedNote && (
          <p role="status" className="text-sm font-medium text-foreground" data-role-seed="">
            {seedNote}
          </p>
        )}
      </header>

      {done && <StepDoneCard saved={done.saved} next={done.next} />}
      {front === "welcome" && <WelcomeScreen org={org} onStart={() => { setDone(stepDone("welcome")); setFront("yours"); }} />}
      {front === "yours" && (
        <YourWordsScreen
          season={season}
          onChange={(next) => {
            setSeason(next);
            save.touch("season");
          }}
        />
      )}

      {front === "steps" && (
      <>
      {goFailed && (
        <div role="alert" className="grid gap-2 rounded-lg border border-coral p-3 text-sm text-foreground" data-go-failed="">
          <p>{RP_WORDS.goFailed}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${PRIMARY} ${FOCUS}`} onClick={() => void go(goFailed)}>{RP_WORDS.tryAgain}</button>
            <button type="button" className={`${SECONDARY} ${FOCUS}`} onClick={() => setGoFailed(null)}>{RP_WORDS.stayHere}</button>
          </div>
        </div>
      )}
      {limitNote && <p role="alert" className="text-sm font-medium text-foreground">{limitNote}</p>}
      <button type="button" className={`${SECONDARY} ${FOCUS} justify-self-start`} onClick={() => { setDone(null); setFront("yours"); }}>
        {RP_WORDS.editYourWords}
      </button>
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
                  s === step
                    ? "border-dash-gold bg-dash-gold text-dash-gold-ink"
                    : i < index
                      ? "border-dash-gold text-dash-gold-lit"
                      : "border-border text-foreground"
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
          <p className="text-xs font-semibold uppercase tracking-wide text-dash-gold-lit">{RP_WORDS.stepOf(index + 1, STEPS.length)}</p>
          <h2 id="rp-step-title" tabIndex={-1} className={`${H2} outline-none`}>
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
            onRetry={() => setOrgAttempt((n) => n + 1)}
            ownWords={season.ownWords}
          />
        )}
        {step === "words" && (
          <>
            <BringInRole proposal={proposal} org={org} beforeImport={save.flush} onFilled={adopt} />
            <OwnAiPrompt proposal={proposal} org={org} />
            <StepWords
              roles={wordsRoles}
              typed={typed}
              frameworkTerms={proposal.frameworkTerms === true}
              onType={type}
              onReview={review}
              ownText={[season.ownWords.love, season.ownWords.offer, season.ownWords.why].map((s) => s.trim()).filter(Boolean).join("\n")}
            />
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
            partner={org === null ? null : opsPartner(operationsRoleName(org !== "failed" ? org.roles : []))}
            onOpenWords={() => void go("words")}
            onHours={(roleId, text) => type(roleId, "timeCommitment", text)}
          />
        )}
        {step === "preview" && (
          <div className="grid gap-3">
            <p className={LEDE}>{RP_WORDS.previewLede}</p>
            <ProposalPreview proposal={proposal} partner={org === null ? null : opsPartner(operationsRoleName(org !== "failed" ? org.roles : []))} />
          </div>
        )}
        {step === "share" && (
          <StepShare
            proposal={proposal}
            onShare={(share: ShareOut) => setProposal((p) => ({ ...p, share }))}
            beforeSubmit={save.flush}
            onSubmitted={(p) => p && setProposal(p)}
            termsOpen={settingsWords(settings).every((row) => !row.set)}
            partner={opsPartner(operationsRoleName(org && org !== "failed" ? org.roles : []))}
            onSubmitGate={onSubmitGate}
          />
        )}
      </section>
      </>
      )}

      {/*
        The save line and Back and Next, kept in reach. On a phone the bar sits
        on top of the site's tab bar (h-16 plus the safe area, MobileTabBar.tsx)
        and the shortcuts button steps out while the steps are open, the way a
        journal sitting's Next does (index.css, `data-hides-fab-phone`).
      */}
      <div
        data-hides-fab-phone
        data-hides-tabbar-phone
        data-step-bar=""
        className="sticky bottom-[var(--rp-bar-bottom)] z-20 -mx-4 grid gap-1 border-t border-border bg-card/95 px-3 py-2 backdrop-blur md:bottom-0"
        style={{ "--rp-bar-bottom": "env(safe-area-inset-bottom, 0px)" } as React.CSSProperties}
      >
        <SaveLine status={save.status} error={save.error} onRetry={() => void save.flush()} />
        {front === "yours" && (
          <YourWordsActions
            onBack={() => { setDone(null); setFront("welcome"); }}
            onNext={() => { setDone(stepDone("yours")); setFront("steps"); }}
          />
        )}
        {front === "steps" && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={index === 0 && path !== "quick"}
            onClick={() => {
              if (index === 0) {
                setDone(null);
                setFront("yours");
              } else void go(STEPS[index - 1]);
            }}
            className={SECONDARY}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {RP_WORDS.back}
          </button>
          {index < STEPS.length - 1 ? (
            <button type="button" onClick={() => void go(STEPS[index + 1])} className={PRIMARY}>
              {RP_WORDS.next}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitOff}
              className={PRIMARY}
              onClick={() => {
                document.getElementById("rp-submit")?.scrollIntoView({ block: "center" });
                submitOpen.current();
              }}
            >
              {RP_WORDS.submit}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
