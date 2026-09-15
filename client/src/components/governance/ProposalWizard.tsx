/**
 * THE WIZARD, orchestrated.
 *
 * Everything structural about this component comes from the config and the
 * walker, so what is left here is the four things a config cannot express:
 *
 *  1. THE DRAFT. Autosaved after a pause in typing, saved again on every step
 *     change, and saved on the way out. The draft carries `stepIndex`, so
 *     Continue reopens where the author stopped. This is the harvest's one
 *     flagged upgrade over Hypha, whose drafts die with the browser.
 *  2. THE WAY OUT. Hypha guards the route with a two-button modal, "Leave
 *     without saving" against "Save draft and leave". Wouter has no route
 *     guard, so the same choice is offered on the wizard's own exit and on
 *     `beforeunload`, and unsaved work is never thrown away silently.
 *  3. THE REVIEW. Every problem across every step, each one a button that
 *     jumps to the field it belongs to. A member should never be told "check
 *     your entries" and left to search.
 *  4. THE PUBLISH. One POST to the type's own route. What happens next is
 *     stated before the button, not after it, because "publish" means
 *     something different for each type and guessing is not a member's job.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, Loader2, Save, Send } from "lucide-react";
import { BreathingLoader } from "@/components/natural";
import {
  deleteDraft as apiDeleteDraft,
  fetchDrafts,
  fetchWizardFacts,
  publishProposal,
  saveDraft,
  type ProposalDraft,
} from "./governanceApi";
import { typeConfig, type StepKey, type WizardType } from "./wizardConfig";
import { fieldsFor, nextStep, prevStep, problemsFor, problemsInStep, stepAtIndex, walkFor } from "./wizardWalk";
import DraftCards from "./DraftCards";
import PracticeVote from "./PracticeVote";
import TypeCards from "./TypeCards";
import WizardField, { type MechanicsVariableLite } from "./WizardField";
import WizardStepper from "./WizardStepper";
import { authToken } from "@/lib/gameApi";

const AUTOSAVE_PAUSE_MS = 1500;

type Feedback = { ok: boolean; text: string } | null;

export default function ProposalWizard() {
  const [, navigate] = useLocation();

  const [type, setType] = useState<WizardType | null>(null);
  const [step, setStep] = useState<StepKey>("type");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [drafts, setDrafts] = useState<ProposalDraft[]>([]);
  const [conductable, setConductable] = useState<string[]>([]);
  const [advisory, setAdvisory] = useState<string[]>([]);
  const [mayOpenAdvisory, setMayOpenAdvisory] = useState(false);
  /** The kind being put to a practice vote, when one is being written. */
  const [practiceType, setPracticeType] = useState<WizardType | null>(null);
  const [supportThreshold, setSupportThreshold] = useState(0);
  const [dials, setDials] = useState<MechanicsVariableLite[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [leaving, setLeaving] = useState(false);
  const [published, setPublished] = useState<{ id?: string; title: string } | null>(null);

  const walk = walkFor(type);
  const stepIndex = Math.max(0, walk.findIndex((s) => s.key === step));
  const stepMeta = walk[stepIndex];
  const cfg = type ? typeConfig(type) : null;
  const problems = problemsFor(type, answers);
  const stepProblems = problemsInStep(type, step, answers);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const [factsAnswer, draftsAnswer] = await Promise.all([fetchWizardFacts(), fetchDrafts()]);
      if (!alive) return;
      if (factsAnswer.ok) {
        setConductable(factsAnswer.data.conductable);
        setAdvisory(factsAnswer.data.advisory ?? []);
        setMayOpenAdvisory(!!factsAnswer.data.mayOpenAdvisory);
        setSupportThreshold(factsAnswer.data.supportThreshold);
      }
      if (draftsAnswer.ok) setDrafts(draftsAnswer.data.drafts);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The dials, loaded once: the mechanics type needs them and nothing else
  // does, so this is deliberately not in the critical path of the first paint.
  useEffect(() => {
    if (type !== "mechanics" || dials.length > 0) return;
    const t = authToken();
    fetch("/api/game/mechanics", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDials(d?.variables ?? []))
      .catch(() => setDials([]));
  }, [type, dials.length]);

  // ── The draft ─────────────────────────────────────────────────────────────
  /**
   * Saves are SERIALIZED, and the id is held in a ref beside the state.
   *
   * Two writes can be in flight at once here: the autosave timer and the save
   * that a step change or a Leave triggers. Both read `draftId`, and if the
   * first has not returned yet, both read null and both INSERT, so a member
   * clicking Next while an autosave is in the air ends up with the same
   * proposal in their drafts card twice. The ref is written the moment an id
   * comes back, and every save waits on the one before it, so the second write
   * sees the id the first created and updates that row.
   */
  const inFlight = useRef<Promise<string | null>>(Promise.resolve(null));
  const draftIdRef = useRef<string | null>(null);

  const persist = useCallback(
    (over?: { stepIndex?: number }): Promise<string | null> => {
      if (!type) return Promise.resolve(null);
      const run = inFlight.current.then(async () => {
        const answer = await saveDraft({
          id: draftIdRef.current,
          wizardType: type,
          payload: answers,
          stepIndex: over?.stepIndex ?? stepIndex,
        });
        if (!answer.ok) {
          setFeedback({ ok: false, text: answer.error });
          return null;
        }
        draftIdRef.current = answer.data.draft.id;
        setDraftId(answer.data.draft.id);
        setDirty(false);
        return answer.data.draft.id;
      });
      // A rejection must not poison the chain for every later save.
      inFlight.current = run.catch(() => null);
      return run;
    },
    [answers, stepIndex, type],
  );

  // Autosave after a pause. A wizard that saves on every keystroke writes a
  // row per character; one that never saves is the thing this table exists to
  // fix. A pause is the honest middle.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (!dirty || !type) return;
    const t = setTimeout(() => {
      void persistRef.current();
    }, AUTOSAVE_PAUSE_MS);
    return () => clearTimeout(t);
  }, [answers, dirty, type]);

  // The browser's own way out. This cannot save (the tab is going), so it asks
  // the browser to ask, which is all any page can honestly do here.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const set = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const goTo = async (next: StepKey) => {
    setStep(next);
    setFeedback(null);
    const position = walk.findIndex((s) => s.key === next);
    if (type) await persist({ stepIndex: Math.max(0, position) });
  };

  const chooseType = (id: WizardType) => {
    setType(id);
    setDirty(true);
    const first = nextStep(id, "type");
    if (first) setStep(first);
  };

  const continueDraft = (draft: ProposalDraft) => {
    setBusyDraft(draft.id);
    setType(draft.wizardType as WizardType);
    setAnswers(draft.payload ?? {});
    draftIdRef.current = draft.id;
    setDraftId(draft.id);
    setStep(stepAtIndex(draft.wizardType, draft.stepIndex));
    setDirty(false);
    setBusyDraft(null);
  };

  const discardDraft = async (draft: ProposalDraft) => {
    setBusyDraft(draft.id);
    const answer = await apiDeleteDraft(draft.id);
    if (answer.ok) {
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      if (draftIdRef.current === draft.id) {
        draftIdRef.current = null;
        setDraftId(null);
        setAnswers({});
        setType(null);
        setStep("type");
      }
    } else {
      setFeedback({ ok: false, text: answer.error });
    }
    setBusyDraft(null);
  };

  const leave = async (save: boolean) => {
    if (save) await persist();
    setDirty(false);
    setLeaving(false);
    navigate("/decisions");
  };

  const publish = async () => {
    if (!cfg || problems.length > 0) return;
    setBusy(true);
    setFeedback(null);
    const answer = await publishProposal(cfg.publish.path, cfg.publish.body(answers));
    if (!answer.ok) {
      setFeedback({ ok: false, text: answer.error });
      setBusy(false);
      return;
    }
    // Published work is not draft work: the row goes, and it goes here rather
    // than on a schedule, so the drafts card never offers a proposal that is
    // already in front of the village.
    if (draftIdRef.current) await apiDeleteDraft(draftIdRef.current);
    draftIdRef.current = null;
    setDirty(false);
    setPublished({ id: answer.data?.id, title: String(answers.title ?? cfg.title) });
    setBusy(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <BreathingLoader label="Opening the wizard" />
      </div>
    );
  }

  if (published) {
    return (
      <div className="rounded-xl border-2 border-sage bg-sage-light p-6">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-stone-900">
          <Check className="w-6 h-6 text-sage" aria-hidden="true" />
          It is in front of the village
        </h2>
        <p className="mt-2 text-stone-800 leading-relaxed">{cfg?.consequence}</p>
        {supportThreshold > 0 && !cfg?.opensVote && (
          <p className="mt-2 text-sm text-stone-700 leading-relaxed">
            It needs {supportThreshold} {supportThreshold === 1 ? "supporter" : "supporters"} before it can go to a
            vote. Sensing happens where the proposal lives, and anyone can add theirs.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate("/decisions")}
            className="min-h-[44px] rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
          >
            See what the village is deciding
          </button>
          <button
            type="button"
            onClick={() => {
              setPublished(null);
              setType(null);
              setAnswers({});
              draftIdRef.current = null;
              setDraftId(null);
              setStep("type");
            }}
            className="min-h-[44px] rounded-lg border border-stone-400 px-5 text-sm font-medium text-stone-800 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          >
            Write another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_14rem] lg:gap-8">
      <div className="min-w-0">
        {/* Mobile stepper sits above the step; the desktop rail is on the right. */}
        <div className="mb-4 lg:hidden">
          <WizardStepper typeId={type} current={step} onGoBack={(s) => void goTo(s)} />
        </div>

        {stepMeta?.intro && step !== "type" && (
          <p className="mb-4 text-stone-700 leading-relaxed">{stepMeta.intro}</p>
        )}

        {step === "type" && (
          <div className="space-y-8">
            {/* A practice vote is not a wizard walk: it opens on one screen
                and goes straight to the real decision it created, so it
                REPLACES the type step rather than becoming a sixth road
                through it. Nothing about the draft is touched on the way in
                or out, because a practice vote is not a draft of anything. */}
            {practiceType ? (
              <PracticeVote
                about={practiceType}
                onOpened={(ballotId) => navigate(`/decisions/${ballotId}`)}
                onCancel={() => setPracticeType(null)}
              />
            ) : (
              <>
                <DraftCards drafts={drafts} busyId={busyDraft} onContinue={continueDraft} onDiscard={discardDraft} />
                <div>
                  <h2 className="text-base font-bold text-stone-900">What kind of decision is this?</h2>
                  <p className="mt-0.5 text-sm text-stone-600">
                    Each kind asks different questions and travels a different road. Pick the one that fits and the
                    rest follows.
                  </p>
                  <div className="mt-4">
                    <TypeCards
                      chosen={type}
                      conductable={conductable}
                      advisory={advisory}
                      mayOpenAdvisory={mayOpenAdvisory}
                      onChoose={chooseType}
                      onPractice={setPracticeType}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {step !== "type" && step !== "review" && (
          <div className="space-y-6">
            {fieldsFor(type, step).map((field) => (
              <WizardField
                key={field.key}
                field={field}
                value={answers[field.key]}
                problem={stepProblems.get(field.key)}
                onChange={(v) => set(field.key, v)}
                dials={dials}
                answers={answers}
              />
            ))}
          </div>
        )}

        {step === "review" && cfg && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-stone-900">Read it back</h2>
              <p className="mt-0.5 text-sm text-stone-600">
                This is what the village will see. Everything here is still yours to change.
              </p>
            </div>

            <dl className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
              {walk
                .filter((s) => s.key !== "type" && s.key !== "review")
                .flatMap((s) => fieldsFor(type, s.key).map((f) => ({ step: s.key, field: f })))
                .map(({ step: from, field }) => {
                  const v = answers[field.key];
                  const shown =
                    field.kind === "changeSet"
                      ? (Array.isArray(v) ? v : []).map((c: any) => `${c.key} becomes ${c.to}`).join(", ")
                      : field.kind === "seatTerm"
                        ? // A blank end date is an answer: the seat ends with the season.
                          String(v ?? "").trim()
                          ? `Until ${String(v).trim()}`
                          : "Until the season ends"
                        : String(v ?? "");
                  return (
                    <div key={field.key} className="flex flex-wrap gap-x-4 gap-y-1 p-3">
                      <dt className="w-40 shrink-0 text-sm font-medium text-stone-600">{field.label}</dt>
                      <dd className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-stone-900">
                        {shown || <span className="text-stone-400">Left blank</span>}
                      </dd>
                      <button
                        type="button"
                        onClick={() => void goTo(from)}
                        className="min-h-[44px] shrink-0 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                      >
                        Change
                        <span className="sr-only"> {field.label}</span>
                      </button>
                    </div>
                  );
                })}
            </dl>

            {problems.length > 0 && (
              <div role="alert" className="rounded-xl border-2 border-coral bg-red-50 p-4">
                <p className="text-sm font-bold text-coral">
                  {problems.length === 1 ? "One thing is not ready" : `${problems.length} things are not ready`}
                </p>
                <ul className="mt-2 space-y-2">
                  {problems.map((p) => (
                    <li key={p.field}>
                      <button
                        type="button"
                        onClick={() => void goTo(p.step)}
                        className="min-h-[44px] w-full rounded-lg px-2 text-left text-sm text-stone-800 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                      >
                        <strong>{p.label}:</strong> {p.message}
                        <span className="sr-only">. Go to this step</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm font-semibold text-stone-900">What publishing does</p>
              <p className="mt-1 text-sm text-stone-700 leading-relaxed">{cfg.consequence}</p>
              {/* A type whose route opens the ballot itself says so in its
                  consequence, and this sentence would contradict it. */}
              {!cfg.opensVote && (
                <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
                  Publishing does not start a vote. The village senses it first, and someone has to take it to a ballot.
                </p>
              )}
            </div>
          </div>
        )}

        {feedback && (
          <p
            role={feedback.ok ? "status" : "alert"}
            className={`mt-4 text-sm font-medium ${feedback.ok ? "text-sage" : "text-coral"}`}
          >
            {feedback.text}
          </p>
        )}

        {/* The walk's controls. */}
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
          {prevStep(type, step) ? (
            <button
              type="button"
              onClick={() => void goTo(prevStep(type, step)!)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (dirty ? setLeaving(true) : navigate("/decisions"))}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Leave
            </button>
          )}

          {step === "review" ? (
            <button
              type="button"
              disabled={busy || problems.length > 0}
              onClick={publish}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
              Put it in front of the village
            </button>
          ) : (
            nextStep(type, step) && (
              <button
                type="button"
                disabled={!type}
                onClick={() => void goTo(nextStep(type, step)!)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Next
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            )
          )}

          {type && step !== "type" && (
            <button
              type="button"
              onClick={() => setLeaving(true)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-medium text-stone-600 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              Save and leave
            </button>
          )}
        </div>
      </div>

      {/* Desktop right rail. */}
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <WizardStepper typeId={type} current={step} onGoBack={(s) => void goTo(s)} />
          {dirty && (
            <p className="mt-4 px-2 text-xs text-stone-500">Unsaved changes. They save on their own in a moment.</p>
          )}
          {!dirty && draftId && <p className="mt-4 px-2 text-xs text-stone-500">Saved. You can close this and come back.</p>}
        </div>
      </aside>

      {leaving && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 id="leave-title" className="text-lg font-bold text-stone-900">
              Keep this for later?
            </h2>
            <p className="mt-1 text-sm text-stone-600 leading-relaxed">
              A saved draft waits for you on any device you sign in from. Nobody else can see it.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void leave(true)}
                className="min-h-[44px] w-full rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
              >
                Save draft and leave
              </button>
              <button
                type="button"
                onClick={() => void leave(false)}
                className="min-h-[44px] w-full rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={() => setLeaving(false)}
                className="min-h-[44px] w-full rounded-lg px-4 text-sm font-medium text-stone-600 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
