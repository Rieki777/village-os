/**
 * GIVE FEEDBACK: to someone who said yes, in four parts, shaped into one
 * message the author reads and may edit before it is queued.
 *
 * What the recipient will read is shown EXACTLY, in an editable box, before
 * anything is sent, beside a plain warning: in a small team people may still
 * guess the author, and it arrives unsigned in the next Monday batch. When
 * the guide cannot shape it, the author's own four parts fill the box and
 * they shape it by hand.
 */
import { useEffect, useState } from "react";
import {
  FEEDBACK_FIELD_MAX,
  FEEDBACK_STYLE_LABELS,
  type FeedbackDraft,
  type FeedbackPerson,
} from "@shared/journal";
import {
  JournalHttpError,
  feedbackPeople,
  isAssistantUnavailable,
  problemText,
  sendFeedback,
  shapeFeedback,
} from "@/lib/journalApi";
import GrowingTextarea from "./GrowingTextarea";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, HINT, LABEL } from "./ui";

/**
 * The longest message the server queues. It is FEEDBACK_MESSAGE_MAX in
 * server/lib/journal.ts and not yet in the shared contract, so it is mirrored
 * here; a longer box would let a member write words the server refuses.
 */
const FEEDBACK_MESSAGE_MAX = 2000;

type Part = "observation" | "feeling" | "need" | "request";

const PARTS: { key: Part; label: string; hint: string }[] = [
  { key: "observation", label: "What I saw", hint: "What happened, as a camera would have caught it." },
  { key: "feeling", label: "How I felt", hint: "Your feeling, in a word or two." },
  { key: "need", label: "What I need", hint: "What mattered to you underneath the feeling." },
  { key: "request", label: "What I'm asking for", hint: "One thing they could do, that they can say yes or no to." },
];

const EMPTY = { observation: "", feeling: "", need: "", request: "" };

export default function FeedbackGive({ onSent }: { onSent: () => void }) {
  const [people, setPeople] = useState<FeedbackPerson[] | null>(null);
  const [recipient, setRecipient] = useState<string>("");
  const [parts, setParts] = useState<Record<Part, string>>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [shapedByHand, setShapedByHand] = useState(false);
  const [busy, setBusy] = useState<"shape" | "send" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    feedbackPeople()
      .then((p) => live && setPeople(p))
      .catch((err) => {
        if (!live) return;
        setPeople([]);
        setProblem(problemText(err, "The people open to feedback could not be read just now."));
      });
    return () => {
      live = false;
    };
  }, []);

  const draft = (): FeedbackDraft => ({ recipientId: recipient, ...parts });
  const ready = !!recipient && PARTS.every((p) => parts[p.key].trim());
  const person = people?.find((p) => p.id === recipient) ?? null;

  const shape = async () => {
    setBusy("shape");
    setProblem(null);
    setDone(null);
    const own = PARTS.map((p) => parts[p.key].trim()).join("\n\n").slice(0, FEEDBACK_MESSAGE_MAX);
    try {
      const shaped = await shapeFeedback(draft());
      setMessage(shaped || own);
      setShapedByHand(!shaped);
    } catch (err) {
      // No model, or a model that answered nothing usable: the author's own
      // words fill the box. Any other refusal (they withdrew their yes, too
      // many drafts this hour) is a sentence, and nothing is offered to send.
      if (isAssistantUnavailable(err) || (err instanceof JournalHttpError && err.status === 502)) {
        setMessage(own);
        setShapedByHand(true);
      } else {
        setProblem(problemText(err, "The guide could not shape it just now."));
      }
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!message?.trim()) return;
    setBusy("send");
    setProblem(null);
    try {
      await sendFeedback({ ...draft(), message: message.trim() });
      setDone(`Queued for ${person?.name ?? "them"}. It arrives in the next Monday batch, unsigned.`);
      setParts(EMPTY);
      setMessage(null);
      setRecipient("");
      onSent();
    } catch (err) {
      setProblem(problemText(err, "It was not queued. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="fb-give" className="space-y-4">
      <h2 id="fb-give" className="font-display text-xl font-bold text-foreground">
        Give feedback
      </h2>

      {done && (
        <p role="status" className="rounded-xl bg-sage-light px-4 py-3 text-sm font-medium text-sage">
          {done}
        </p>
      )}

      {people === null ? (
        <p className={HINT}>Reading who is open to feedback...</p>
      ) : people.length === 0 ? (
        <p className={HINT}>Nobody has said yes to feedback yet. When someone does, they appear here.</p>
      ) : (
        <fieldset>
          <legend className={LABEL}>Who is it for?</legend>
          <p className={HINT}>Only people who said yes to feedback are listed.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {people.map((p) => (
              <li key={p.id}>
                <label
                  className={`flex min-h-11 cursor-pointer flex-col rounded-xl border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-deep ${
                    recipient === p.id ? "border-teal-deep bg-teal-deep/5" : "border-border bg-card"
                  }`}
                >
                  <input
                    type="radio"
                    name="feedback-recipient"
                    value={p.id}
                    checked={recipient === p.id}
                    onChange={() => {
                      setRecipient(p.id);
                      setMessage(null);
                    }}
                    className="sr-only"
                  />
                  <span className="font-semibold text-foreground">{p.name}</span>
                  <span className="text-xs font-medium text-muted-foreground">{FEEDBACK_STYLE_LABELS[p.style] ?? ""}</span>
                  {p.note && <span className="mt-1 text-sm text-foreground">{p.note}</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {recipient && (
        <div className={`${CARD} space-y-4`}>
          {PARTS.map((part) => (
            <div key={part.key}>
              <label htmlFor={`fb-${part.key}`} className={LABEL}>
                {part.label}
              </label>
              <p id={`fb-${part.key}-hint`} className={HINT}>
                {part.hint}
              </p>
              <div className="mt-1">
                <GrowingTextarea
                  id={`fb-${part.key}`}
                  aria-describedby={`fb-${part.key}-hint`}
                  value={parts[part.key]}
                  onValue={(t) => {
                    setParts({ ...parts, [part.key]: t });
                    setMessage(null);
                  }}
                  minRows={2}
                  maxLength={FEEDBACK_FIELD_MAX}
                />
              </div>
            </div>
          ))}
          <button type="button" className={BTN_SECONDARY} onClick={() => void shape()} disabled={!ready || busy !== null}>
            {busy === "shape" ? "Shaping..." : "Shape it"}
          </button>
          {!ready && <p className={HINT}>Fill in all four parts to shape the message.</p>}
        </div>
      )}

      {message !== null && (
        <div className={`${CARD} space-y-3 border-teal-deep/40`}>
          <label htmlFor="fb-message" className={LABEL}>
            Exactly what {person?.name ?? "they"} will read
          </label>
          {shapedByHand && (
            <p className={HINT}>The guide could not shape this one, so here are your own four parts. Shape them by hand.</p>
          )}
          <GrowingTextarea
            id="fb-message"
            value={message}
            onValue={setMessage}
            minRows={5}
            maxLength={FEEDBACK_MESSAGE_MAX}
          />
          <p className="rounded-xl bg-amber-light px-3 py-2 text-sm text-foreground">
            In a small team, people may still guess who wrote this. It arrives without your name, in the next Monday batch,
            and you can withdraw it until then.
          </p>
          <button type="button" className={BTN_PRIMARY} onClick={() => void send()} disabled={!message.trim() || busy !== null}>
            {busy === "send" ? "Queueing..." : "Send in the next batch"}
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
