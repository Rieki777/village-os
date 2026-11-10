/**
 * CONSENT MODE: an objection is a contribution.
 *
 * Sociocracy 3.0's distinction, which the engine carries as rows: an
 * OBJECTION reveals a consequence or a risk the village would rather avoid,
 * and it blocks. A CONCERN is a worry that cannot be backed by reasoning or
 * evidence enough to qualify, and it does not block; it is recorded beside the
 * decision and rides into the review of whatever the decision produced.
 *
 * The design ruling this file answers to: filing an objection should feel like
 * contributing. Everything here follows from that.
 *
 *  - The invitation reads as an invitation. "Say what you see" rather than
 *    "block this proposal", because the person with the objection is usually
 *    the person who noticed something, and the interface should not make them
 *    feel like an obstacle for noticing.
 *  - An objection is shown with its author's name and its full text, at the
 *    same weight as the proposal itself. It is not a footnote under a bar.
 *  - Every ruling is shown WITH ITS REASONING, because the engine requires a
 *    note on every ruling and the whole value of that requirement is that
 *    somebody reads it. A facilitator who has to write down why they set an
 *    objection aside is a facilitator who thinks about it.
 *  - "Concern" is never rendered as a downgrade. It is a real outcome: the
 *    village heard it, it does not block, and it travels with the agreement.
 *  - LINEAGE, NEVER CREDIT (0102). An objection that changed a proposal says so
 *    here, on the objection, with a link to the vote the amended version ran
 *    as. It is a fact about the decision and it lives on the decision's page.
 *    It never appears on a person's profile, and NOTHING here counts
 *    objections per member: no total, no ranking, no "most helpful objector",
 *    no badge. "Credit" is a scoring word, and a scoreboard is what this whole
 *    idea was reframed away from. `server/lib/objectionLineageShape.test.ts`
 *    holds that line against the tree.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, CircleMinus, GitBranch, Hand, MessageSquareWarning } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { fetchObjectionLineage, type BallotObjection, type ObjectionLineage } from "./governanceApi";
import VoiceArea from "@/components/voice/VoiceArea";
import { useLingui } from "@lingui/react/macro";

/**
 * What each state of an objection means, and its authority is the server's
 * `OBJECTION_RULINGS` plus the `open` an insert writes (server/lib/ballots.ts).
 * `ballot_objections.status` is a varchar with no enum behind it, so the
 * database constrains nothing here and the route's own allow-list is the only
 * rule; governanceStates.test.ts reads that list and holds this map to it.
 *
 * The lookup takes a fallback for the same reason GameMechanics.tsx does.
 * `Record<Union, T>` types an index as total, so the compiler asserts a claim
 * about the server instead of checking one: the identical shape here threw
 * inside a list and took a whole page to the error boundary the first time a
 * status arrived that a hand-kept union had never heard of.
 */
const STATUS: Record<
  BallotObjection["status"],
  { label: string; blurb: string; chip: string; icon: typeof Hand }
> = {
  open: {
    label: "Standing",
    blurb: "This is unruled, and while it stands the decision cannot carry.",
    chip: "bg-amber-light text-gold",
    icon: Hand,
  },
  integrated: {
    label: "Upheld",
    blurb: "The village accepted this. The proposal has to change and come back.",
    chip: "bg-red-50 text-coral",
    icon: MessageSquareWarning,
  },
  concern: {
    label: "Recorded as a concern",
    blurb: "Heard and kept. It does not block, and it travels with the decision to its review.",
    chip: "bg-stone-100 text-stone-700",
    icon: CheckCircle2,
  },
  withdrawn: {
    label: "Withdrawn",
    blurb: "The person who raised it took it back.",
    chip: "bg-stone-100 text-stone-600",
    icon: CircleMinus,
  },
};

/** A state nobody has taught this panel yet, read as itself. */
const UNKNOWN_STATUS = {
  label: "Recorded",
  blurb: "This objection is in a state this page has not been taught to read. Its ruling is on the decision's record.",
  chip: "bg-stone-100 text-stone-600",
  icon: CircleMinus,
};

export const OBJECTION_STATUS_COPY = STATUS;

/** The rulings a facilitator is offered. Same authority as STATUS above. */
export const RULINGS: Array<{ id: string; label: string; help: string }> = [
  { id: "integrated", label: "Uphold it", help: "The proposal must change. This ballot closes and a new one carries the amended version." },
  { id: "concern", label: "Record as a concern", help: "It does not block. It stays attached to the decision and surfaces at its review." },
  { id: "withdrawn", label: "Withdraw it", help: "For when the person who raised it no longer holds it." },
];

export default function ObjectionPanel({
  objections,
  standing,
  canFile,
  canRule,
  busy,
  onFile,
  onRule,
}: {
  objections: BallotObjection[];
  /**
   * How many of them block, stated by the server rather than counted here.
   * See the note in voteBars.ts: both ballot payloads carry this number from
   * the same function the close route evaluates with, and a panel that
   * recounted would be a second authority on whether this decision can carry.
   */
  standing: number;
  /** In the electorate, and the ballot is still open. */
  canFile: boolean;
  /** Holds proposal.decide, or is an admin. */
  canRule: boolean;
  busy: boolean;
  onFile: (text: string) => Promise<void>;
  onRule: (objectionId: string, ruling: string, note: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [rulingFor, setRulingFor] = useState<string | null>(null);
  const [ruling, setRuling] = useState("concern");
  const [note, setNote] = useState("");

  /*
   * WHERE EACH OF THESE OBJECTIONS LED, IF IT LED ANYWHERE (0102).
   *
   * Asked for by the ids this panel is already holding, so the panel needs to
   * know nothing about which ballot it is standing on. Almost every objection
   * that will ever exist has no successor, so this map is usually empty and
   * the panel renders exactly as it did before.
   *
   * A failed read leaves the map empty and the panel says nothing, which is
   * the honest outcome: a sentence about the village's record must come from
   * the record. It is never guessed at from what is on screen.
   */
  const [lineage, setLineage] = useState<Record<string, ObjectionLineage>>({});
  const ids = objections.map((o) => o.id).join(",");
  useEffect(() => {
    const asked = ids.split(",").filter(Boolean);
    if (asked.length === 0) {
      setLineage({});
      return;
    }
    let live = true;
    void fetchObjectionLineage(asked).then((answer) => {
      if (!live) return;
      if (!answer.ok) return;
      const next: Record<string, ObjectionLineage> = {};
      for (const row of answer.data) next[row.objectionId] = row;
      setLineage(next);
    });
    return () => {
      live = false;
    };
  }, [ids]);

  const file = async () => {
    if (!text.trim()) {
      setProblem("An objection is its reasoning. Say what consequence or risk you see.");
      return;
    }
    setProblem(null);
    await onFile(text.trim());
    setText("");
  };

  const rule = async (id: string) => {
    if (!note.trim()) {
      setProblem("Every ruling carries its reasoning. Say why.");
      return;
    }
    setProblem(null);
    await onRule(id, ruling, note.trim());
    setRulingFor(null);
    setNote("");
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
        <Hand className="w-4 h-4 text-teal-deep" aria-hidden="true" />
        Objections
        <InfoTip
          tip="An objection names a consequence the village should avoid. Only an objection blocks a consent decision. A worry without reasoning behind it is recorded as a concern instead."
          label="What an objection is"
        />
      </h3>
      <p className="mt-1 text-sm text-stone-600 leading-relaxed">
        {standing === 0
          ? "Nothing stands in the way of this decision right now."
          : `${standing} ${standing === 1 ? "objection stands" : "objections stand"}, and this cannot carry while ${standing === 1 ? "it does" : "they do"}.`}
      </p>

      {objections.length > 0 && (
        <ul className="mt-4 space-y-4">
          {objections.map((o) => {
            const s = STATUS[o.status] ?? UNKNOWN_STATUS;
            const Icon = s.icon;
            return (
              <li key={o.id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-stone-900">{o.by}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
                    <Icon className="w-3 h-3" aria-hidden="true" />
                    {s.label}
                  </span>
                  <span className="text-xs text-stone-500">
                    {new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800 leading-relaxed">{o.text}</p>
                <p className="mt-1.5 text-xs text-stone-500">{s.blurb}</p>

                {o.rulingNote && (
                  <div className="mt-2 border-l-2 border-stone-300 pl-3">
                    <p className="text-xs font-semibold text-stone-700">Why it was ruled that way</p>
                    <p className="text-sm text-stone-700 leading-relaxed">{o.rulingNote}</p>
                  </div>
                )}

                {/* THE FORWARD EDGE. Shown only when the record holds one, and
                    made of the successor vote's own title. A proposal changing
                    because somebody spoke up is the thing worth saying, and it
                    is said about the proposal. */}
                {lineage[o.id] && (
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-teal-deep">
                    <GitBranch className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-stone-700">The proposal changed after this. The version that came next:</span>
                    <Link
                      href={`/decisions/${lineage[o.id].ballotId}`}
                      className="rounded font-semibold underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                    >
                      {lineage[o.id].title}
                    </Link>
                  </p>
                )}

                {/* The facilitator tests an objection; its author may take it
                    back. Offering the panel to everyone would be a row of
                    buttons the route refuses, and finding out your standing by
                    being told no is not how a member should learn it. */}
                {(canRule || o.mine) && o.status === "open" && (
                  <div className="mt-3">
                    {rulingFor === o.id ? (
                      <div className="space-y-2">
                        <fieldset>
                          <legend className="text-sm font-medium text-stone-800">How does this land?</legend>
                          <div className="mt-1.5 space-y-1.5">
                            {(canRule ? RULINGS : RULINGS.filter((r) => r.id === "withdrawn")).map((r) => (
                              <label key={r.id} className="flex min-h-[44px] items-start gap-2 rounded-lg border border-stone-200 p-2 has-[:checked]:border-teal-deep">
                                {/* The ruling names the option; what the ruling
                                    does to the proposal is a description. A
                                    wrapping <label> read both as one name, so
                                    choosing between three rulings meant hearing
                                    three paragraphs. */}
                                <input
                                  type="radio"
                                  name={`ruling-${o.id}`}
                                  value={r.id}
                                  checked={ruling === r.id}
                                  onChange={() => setRuling(r.id)}
                                  aria-label={r.label}
                                  aria-describedby={`ruling-${o.id}-${r.id}-help`}
                                  className="mt-1 accent-teal-deep"
                                />
                                <span>
                                  <span className="block text-sm font-medium text-stone-900">{r.label}</span>
                                  <span id={`ruling-${o.id}-${r.id}-help`} className="block text-xs text-stone-600 leading-relaxed">{r.help}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <label htmlFor={`note-${o.id}`} className="block text-sm font-medium text-stone-800">
                          Your reasoning, for the record
                        </label>
                        <VoiceArea value={note} onValue={setNote}
                          talk={{
                            label: t({ message: "Your reasoning", context: "voice field label: objection ruling note" }),
                            purpose: t({ message: "Why you ruled this objection the way you did, for the record.", context: "voice field purpose: objection ruling note" }),
                          }}
                        >
                        <textarea
                          id={`note-${o.id}`}
                          rows={3}
                          value={note}
                          maxLength={2000}
                          onChange={(e) => setNote(e.target.value)}
                          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                        />
                        </VoiceArea>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => rule(o.id)}
                            className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
                          >
                            Record the ruling
                          </button>
                          <button
                            type="button"
                            onClick={() => setRulingFor(null)}
                            className="min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                          >
                            Not now
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRulingFor(o.id);
                          setRuling(canRule ? "concern" : "withdrawn");
                          setNote("");
                        }}
                        className="min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                      >
                        {canRule ? "Test this objection" : "Take this back"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canFile && (
        <div className="mt-4 border-t border-stone-100 pt-4">
          <label htmlFor="new-objection" className="block text-sm font-semibold text-stone-900">
            Say what you see
          </label>
          <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
            Naming a risk early is one of the more useful things anyone does here. You do not have to vote no to raise
            one, and raising one is not a vote.
          </p>
          <VoiceArea value={text} onValue={setText}
            talk={{
              label: t({ message: "Your objection", context: "voice field label: raise an objection" }),
              purpose: t({ message: "A risk or concern you see in this proposal and what could go wrong.", context: "voice field purpose: raise an objection" }),
            }}
          >
          <textarea
            id="new-objection"
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="If we do this in the wet season the track will not carry the load, and we lose the deliveries."
            className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          />
          </VoiceArea>
          <button
            type="button"
            disabled={busy}
            onClick={file}
            className="mt-2 min-h-[44px] rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
          >
            Raise it
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm font-medium text-coral">
          {problem}
        </p>
      )}
    </section>
  );
}
