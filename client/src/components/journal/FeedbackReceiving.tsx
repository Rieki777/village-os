/**
 * RECEIVING: whether this member wants feedback, how they like it, and what
 * has arrived. Nobody can send them anything until they say yes here. What
 * arrives carries no author. Thanks and Not useful are the two answers a
 * member can give back, and tapping the chosen one again takes it back.
 */
import { useEffect, useState } from "react";
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_STYLES,
  FEEDBACK_STYLE_LABELS,
  type FeedbackPrefs,
  type FeedbackReceived,
  type FeedbackResponse,
  type FeedbackStyle,
} from "@shared/journal";
import { getPrefs, problemText, putPrefs, receivedFeedback, respondFeedback } from "@/lib/journalApi";
import GrowingTextarea from "./GrowingTextarea";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, HINT, LABEL, dayLabel } from "./ui";

const RESPONSE_TEXT: Record<Exclude<FeedbackResponse, "none">, string> = {
  thanks: "Thanks",
  "not-useful": "Not useful",
};

export default function FeedbackReceiving() {
  const [prefs, setPrefs] = useState<FeedbackPrefs>({ open: false, style: "gentle", note: "" });
  // True only once the member's own settings were READ. A failed read leaves
  // it false, so the defaults above can never be saved over the real row: a
  // member who had said Yes and tapped Save after a blip would otherwise be
  // closed to feedback with their note erased, and told it saved.
  const [loaded, setLoaded] = useState(false);
  const [prefsProblem, setPrefsProblem] = useState<string | null>(null);
  const [prefsTry, setPrefsTry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null);
  const [received, setReceived] = useState<FeedbackReceived[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPrefsProblem(null);
    getPrefs()
      .then((p) => {
        if (!live) return;
        // No row yet is a real answer: the defaults ARE this member's settings.
        if (p) setPrefs({ open: !!p.open, style: p.style, note: p.note ?? "" });
        setLoaded(true);
      })
      .catch((err) => {
        if (!live) return;
        setPrefsProblem(problemText(err, "Your feedback settings could not be read just now, so they cannot be changed yet."));
      });
    return () => {
      live = false;
    };
  }, [prefsTry]);

  useEffect(() => {
    let live = true;
    receivedFeedback()
      .then((r) => live && setReceived(r))
      .catch((err) => {
        if (!live) return;
        setReceived([]);
        setProblem(problemText(err, "What has arrived for you could not be read just now."));
      });
    return () => {
      live = false;
    };
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loaded) return;
    setSaving(true);
    setSaved(null);
    try {
      await putPrefs({ ...prefs, note: prefs.note.slice(0, FEEDBACK_NOTE_MAX) });
      setSaved({ ok: true, text: prefs.open ? "Saved. People can now send you feedback." : "Saved. Nobody can send you feedback." });
    } catch (err) {
      setSaved({ ok: false, text: problemText(err, "That did not save. Try again in a moment.") });
    } finally {
      setSaving(false);
    }
  };

  const respond = async (id: string, response: FeedbackResponse) => {
    const before = received;
    setReceived((was) => (was ?? []).map((r) => (r.id === id ? { ...r, response } : r)));
    try {
      await respondFeedback(id, response);
    } catch (err) {
      setReceived(before);
      setProblem(problemText(err, "Your answer did not reach the journal. Try again in a moment."));
    }
  };

  return (
    <section aria-labelledby="fb-receiving" className="space-y-4">
      <h2 id="fb-receiving" className="font-display text-xl font-bold text-foreground">
        Receiving
      </h2>

      <form onSubmit={save} className={`${CARD} space-y-4`} aria-busy={!loaded && !prefsProblem}>
        {prefsProblem ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {prefsProblem}
            </p>
            <button type="button" className={BTN_SECONDARY} onClick={() => setPrefsTry((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : (
          // Locked until the member's own settings have been read.
          <fieldset disabled={!loaded} className="space-y-4">
            <fieldset>
              <legend className={LABEL}>Do you want to receive feedback?</legend>
              <div className="mt-2 flex gap-2">
                {([
                  [true, "Yes"],
                  [false, "Not now"],
                ] as const).map(([v, label]) => (
                  <label
                    key={label}
                    className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border px-4 font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-deep ${
                      prefs.open === v ? "border-teal-deep bg-teal-deep/10 text-foreground" : "border-border bg-card text-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="feedback-open"
                      checked={prefs.open === v}
                      onChange={() => setPrefs({ ...prefs, open: v })}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="fb-style" className={LABEL}>
                How should it be written?
              </label>
              <select
                id="fb-style"
                value={prefs.style}
                onChange={(e) => setPrefs({ ...prefs, style: e.target.value as FeedbackStyle })}
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {FEEDBACK_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {FEEDBACK_STYLE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="fb-note" className={LABEL}>
                How I like to receive feedback
              </label>
              <p id="fb-note-hint" className={HINT}>
                Shown to the people who can write to you.
              </p>
              <div className="mt-1">
                <GrowingTextarea
                  id="fb-note"
                  aria-describedby="fb-note-hint"
                  value={prefs.note}
                  onValue={(note) => setPrefs({ ...prefs, note })}
                  minRows={2}
                  maxLength={FEEDBACK_NOTE_MAX}
                />
              </div>
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {prefs.note.length} / {FEEDBACK_NOTE_MAX}
              </p>
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BTN_PRIMARY} disabled={saving || !loaded}>
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && (
            <p role={saved.ok ? "status" : "alert"} className={`text-sm ${saved.ok ? "text-open" : "text-destructive"}`}>
              {saved.text}
            </p>
          )}
        </div>
      </form>

      <div>
        <h3 className="font-semibold text-foreground">What has arrived</h3>
        {problem && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {problem}
          </p>
        )}
        {received !== null && received.length === 0 && !problem && (
          <p className={`${HINT} mt-2`}>Nothing yet. Feedback arrives unsigned on Monday mornings, village time.</p>
        )}
        <ul className="mt-2 space-y-3">
          {(received ?? []).map((r) => (
            <li key={r.id} className={CARD}>
              <p className="whitespace-pre-wrap text-foreground">{r.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">Arrived {dayLabel(r.deliveredAt)}</p>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Your answer to this feedback">
                {(Object.keys(RESPONSE_TEXT) as Exclude<FeedbackResponse, "none">[]).map((resp) => (
                  <button
                    key={resp}
                    type="button"
                    aria-pressed={r.response === resp}
                    onClick={() => void respond(r.id, r.response === resp ? "none" : resp)}
                    className={`inline-flex min-h-11 items-center rounded-xl border px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                      r.response === resp ? "border-teal-deep bg-teal-deep text-white" : "border-border bg-card text-foreground"
                    }`}
                  >
                    {RESPONSE_TEXT[resp]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
