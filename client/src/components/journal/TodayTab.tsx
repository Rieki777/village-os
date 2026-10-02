/**
 * TODAY: pick a practice, answer it one question at a time, read it back,
 * save it. The open sitting is kept on this device as it is written, so a
 * closed tab or a dead battery loses nothing, and a save goes through the
 * outbox (lib/journalOutbox.ts) so a bad connection loses nothing either.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JOURNAL_DEPTHS, type GuideMessage, type JournalDepth, type JournalPractice } from "@shared/journal";
import { newClientId, saveEntry, type SaveOutcome } from "@/lib/journalOutbox";
import GuidePanel from "./GuidePanel";
import PracticePicker from "./PracticePicker";
import SittingFlow from "./SittingFlow";
import { useRememberedChoice } from "./hooks";
import {
  answersOf,
  clearDraft,
  entryFrom,
  extraKey,
  hasContent,
  newSitting,
  readDraft,
  stepsFor,
  suggestedPractice,
  writeDraft,
  type Sitting,
} from "./sitting";

const SAVED_TEXT: Record<SaveOutcome, string> = {
  synced: "Saved to your journal.",
  "on-device": "Saved on this device. It reaches your journal as soon as you are back online.",
  failed:
    "This browser would not keep it and the journal could not be reached. Your words are still on the page, so copy them before you leave.",
};

export default function TodayTab({
  owner,
  village,
  onSaved,
  now = () => new Date(),
}: {
  owner: string;
  village: string;
  onSaved?: () => void;
  /** The clock, for the morning and evening suggestion. Tests pass their own. */
  now?: () => Date;
}) {
  const [depth, setDepth] = useRememberedChoice<JournalDepth>("village.journal.depth", JOURNAL_DEPTHS, "light");
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [resumable, setResumable] = useState<Sitting | null>(() => readDraft(owner));
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideButton = useRef<HTMLButtonElement>(null);

  // Every change to an open sitting is written to the device as it happens.
  useEffect(() => {
    if (sitting) writeDraft(owner, sitting);
  }, [owner, sitting]);

  const steps = useMemo(() => (sitting ? stepsFor(sitting, village) : []), [sitting, village]);
  const suggested = suggestedPractice(now().getHours());

  const start = (practice: JournalPractice) => {
    clearDraft(owner);
    setResumable(null);
    setOutcome(null);
    setSitting(newSitting(practice, depth, newClientId()));
  };

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    window.setTimeout(() => guideButton.current?.focus(), 0);
  }, []);

  const save = async () => {
    if (!sitting || !hasContent(sitting, village)) return;
    setSaving(true);
    const result = await saveEntry(owner, entryFrom(sitting, village, now()));
    setSaving(false);
    setOutcome(result);
    if (result === "failed") return;
    clearDraft(owner);
    setSitting(null);
    setGuideOpen(false);
    onSaved?.();
  };

  const addQuestion = (prompt: string) => {
    if (!sitting) return;
    const extra = { key: extraKey(sitting), prompt };
    const next = { ...sitting, extras: [...sitting.extras, extra] };
    // Land on the new question, which sits just before the review.
    next.step = stepsFor(next, village).length - 2;
    setSitting(next);
    closeGuide();
  };

  return (
    <div>
      {outcome && (
        <p
          role={outcome === "failed" ? "alert" : "status"}
          className={`mb-5 rounded-xl px-4 py-3 text-sm font-medium ${
            outcome === "failed" ? "bg-destructive/10 text-destructive" : "bg-sage-light text-sage"
          }`}
        >
          {SAVED_TEXT[outcome]}
        </p>
      )}

      {!sitting ? (
        <PracticePicker
          depth={depth}
          onDepth={setDepth}
          suggested={suggested}
          village={village}
          onStart={start}
          resumable={resumable?.practice ?? null}
          onResume={() => {
            if (!resumable) return;
            setOutcome(null);
            setSitting(resumable);
            setResumable(null);
          }}
          onDiscard={() => {
            clearDraft(owner);
            setResumable(null);
          }}
        />
      ) : (
        <SittingFlow
          sitting={sitting}
          steps={steps}
          onChange={setSitting}
          onSave={() => void save()}
          saving={saving}
          canSave={hasContent(sitting, village)}
          onStartOver={() => {
            // The page so far stays on the device, offered back on the picker.
            setResumable(sitting);
            setSitting(null);
            setGuideOpen(false);
          }}
          onOpenGuide={() => setGuideOpen(true)}
          guideButtonRef={guideButton}
        />
      )}

      {sitting && (
        <GuidePanel
          open={guideOpen}
          onClose={closeGuide}
          request={() => ({
            practice: sitting.practice,
            depth: sitting.depth,
            answers: answersOf(sitting, village),
            localHour: now().getHours(),
          })}
          messages={sitting.guide}
          onMessages={(guide: GuideMessage[]) => setSitting((s) => (s ? { ...s, guide } : s))}
          onAddQuestion={addQuestion}
          onConfirmReflection={(reflection) => setSitting((s) => (s ? { ...s, reflection } : s))}
        />
      )}
    </div>
  );
}
