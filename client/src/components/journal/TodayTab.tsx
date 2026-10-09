/**
 * TODAY: pick a practice, answer it one question at a time, read it back,
 * save it. The open sitting is kept on this device as it is written, so a
 * closed tab or a dead battery loses nothing, and a save goes through the
 * outbox (lib/journalOutbox.ts) so a bad connection loses nothing either.
 *
 * ONE PAGE, ONE CLIENTID, ONE SAVE. The server answers a second POST under a
 * clientId it already holds with the first one and keeps none of the new
 * words. So the draft is let go the moment the outbox holds the entry, a
 * draft is read again before it is picked up, and a draft whose clientId is
 * already on its way (or already sent) is picked up under a new one. The
 * page is held still while it saves, so what the review shows is what went.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JOURNAL_DEPTHS, type GuideMessage, type JournalDepth, type JournalPractice } from "@shared/journal";
import {
  newClientId,
  pendingFor,
  saveEntry,
  sentFromThisPage,
  type SaveOutcome,
  type SaveResult,
} from "@/lib/journalOutbox";
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
  "signed-out": "Saved on this device. It reaches your journal once you sign in again.",
  refused: "The journal did not take this page. Your words are still here, so you can change it and save again.",
  failed:
    "This browser would not keep it and the journal could not be reached. Your words are still on the page, so copy them before you leave.",
};

/** The sentence for one save: a refusal leads with the server's own words. */
function savedText(result: SaveResult): string {
  if (result.outcome === "refused" && result.why) {
    return `${result.why} Your words are still here, so you can save again once that is put right.`;
  }
  return SAVED_TEXT[result.outcome];
}

const PROBLEM: ReadonlySet<SaveOutcome> = new Set<SaveOutcome>(["failed", "refused"]);

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
  const [outcome, setOutcome] = useState<SaveResult | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideButton = useRef<HTMLButtonElement>(null);
  /** The sitting as last rendered, for a save that ends after the page moved on. */
  const latest = useRef<Sitting | null>(sitting);
  latest.current = sitting;

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
    if (!sitting || saving || !hasContent(sitting, village)) return;
    // A refused copy of this page may have gone through from "Try again" in
    // the list above the tabs. Saving again under that clientId would be the
    // server's duplicate answer, keeping none of the new words, so the page
    // goes on under a new one.
    const current = sentFromThisPage(sitting.clientId) ? { ...sitting, clientId: newClientId() } : sitting;
    if (current !== sitting) {
      latest.current = current;
      setSitting(current);
    }
    const savedId = current.clientId;
    setSaving(true);
    const result = await saveEntry(owner, entryFrom(current, village, now()), {
      // The outbox holds the words from here, so the draft has done its job.
      // A page opened meanwhile, in this tab or another, offers nothing back.
      onStored: () => clearDraft(owner),
    });
    setSaving(false);
    setOutcome(result);
    if (result.outcome === "failed") return;
    if (result.outcome === "refused") {
      // The page stays open to be put right, and stays on the device too.
      const open = latest.current;
      if (open && open.clientId === savedId) writeDraft(owner, open);
      return;
    }
    // Only this page's own draft goes, never one started since.
    if (readDraft(owner)?.clientId === savedId) clearDraft(owner);
    setSitting((s) => (s && s.clientId === savedId ? null : s));
    setGuideOpen(false);
    onSaved?.();
  };

  const resume = () => {
    // Read again: a save that ended since this offer appeared took the draft
    // with it, and another tab may have left a different one.
    const fresh = readDraft(owner);
    if (!fresh || fresh.clientId !== resumable?.clientId) {
      setResumable(fresh);
      return;
    }
    // A clientId already sent, or on its way, would take these words to a
    // save the server has already made. The page goes on under a new one.
    const taken =
      sentFromThisPage(fresh.clientId) || pendingFor(owner).some((i) => i.entry.clientId === fresh.clientId && !i.refused);
    setOutcome(null);
    setSitting(taken ? { ...fresh, clientId: newClientId() } : fresh);
    setResumable(null);
  };

  const addQuestion = (prompt: string) => {
    if (!sitting || saving) return;
    const extra = { key: extraKey(sitting), prompt };
    const next = { ...sitting, extras: [...sitting.extras, extra] };
    // Land on the new question, which sits just before the review.
    next.step = stepsFor(next, village).length - 2;
    setSitting(next);
    closeGuide();
  };

  // The sitting a guide ask belongs to. GuidePanel calls back with the
  // handlers of the render its ask started in, so a reply that lands after
  // the member left for another page compares against the page it was for.
  const askedIn = sitting?.clientId ?? null;
  const problem = outcome !== null && PROBLEM.has(outcome.outcome);

  return (
    <div>
      {outcome && (
        <p
          role={problem ? "alert" : "status"}
          className={`mb-5 rounded-xl px-4 py-3 text-sm font-medium ${
            problem ? "bg-destructive/10 text-destructive" : "bg-sage-light text-sage"
          }`}
        >
          {savedText(outcome)}
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
          onResume={resume}
          onDiscard={() => {
            clearDraft(owner);
            setResumable(null);
          }}
        />
      ) : (
        <SittingFlow
          sitting={sitting}
          steps={steps}
          // Held still while it saves: the entry on its way is the page as
          // Save found it, so a word typed now would show and then be lost.
          onChange={(next) => {
            if (!saving) setSitting(next);
          }}
          onSave={() => void save()}
          saving={saving}
          canSave={hasContent(sitting, village)}
          onStartOver={() => {
            if (saving) return;
            // The page so far stays on the device, offered back on the picker.
            writeDraft(owner, sitting);
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
          onMessages={(guide: GuideMessage[]) => setSitting((s) => (s && s.clientId === askedIn ? { ...s, guide } : s))}
          onAddQuestion={addQuestion}
          onConfirmReflection={(reflection) => {
            if (saving) return;
            setSitting((s) => (s && s.clientId === askedIn ? { ...s, reflection } : s));
          }}
        />
      )}
    </div>
  );
}
