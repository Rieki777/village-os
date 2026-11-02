/**
 * THE CIRCLE ANSWERS A ROLE PROPOSAL (role proposals PR D).
 *
 * Part B asks every other live holder of a role in the proposal's circles to
 * consent or object within 2 business days, at
 * `POST /api/governance/role-applications/:id/consent`. This is the page half:
 *
 *   ConsentSummary  where it stands, in plain words, for everyone who can
 *                   read the proposal: the state's heading and the server's
 *                   sentence, the tally (who was asked, who consented, who
 *                   objected, as counts and role titles, never a name), and
 *                   the reasons an objection gave, which name nobody.
 *   CircleConsent   the summary, plus the asked holder's own answer: Consent,
 *                   or Object with a reason (at most 300 characters) that goes
 *                   to the circle's next meeting. Drawn only while the server
 *                   says `you.mayAnswer` and the application still waits.
 *
 * AN ANSWER IS GIVEN ONCE. The route answers 409 to a second one, so after an
 * answer the page shows it with "Each holder answers once, so your answer
 * stands." and offers no change.
 *
 * "Record the adoption" is not here: it is the adopt click itself, so it sits
 * where a holder of the power adopts, on the application page's holder card.
 *
 * A role proposal from somebody with no account yet has no application (open
 * proposals part B): its page hands in `answer`, which posts to the
 * proposal's own consent route, and everything else here is the same.
 */
import { useEffect, useId, useState } from "react";
import { Check, MessageSquareWarning } from "lucide-react";
import { CONSENT_WORDS, OBJECTION_MAX, TALLY_WORDS, tallyWords, type ConsentAnswer } from "@shared/roleProposalConsent";
import { answerConsent, type ConsentAnswerOut, type ConsentOut } from "./proposalApi";
import { ADOPTED_HEADING, STATE_HEADINGS } from "./proposalWords";
import { H2, INPUT, LEDE, PANEL, PRIMARY, SECONDARY } from "./parts";

const NO_ROLES = { asked: [] as string[], consented: [] as string[], objected: [] as string[] };

/** Who the circle asked, who consented and who objected: counts and role titles, never a name. */
export function ConsentTally({ consent }: { consent: ConsentOut }) {
  // A circle nobody else holds a role in asked nobody, and its sentence already says so.
  if (consent.asked <= 0) return null;
  const roles = consent.roles ?? NO_ROLES;
  const rows = [
    { key: "asked", label: TALLY_WORDS.asked, n: consent.asked, titles: roles.asked },
    { key: "consented", label: TALLY_WORDS.consented, n: consent.consented, titles: roles.consented },
    { key: "objected", label: TALLY_WORDS.objected, n: consent.objected, titles: roles.objected },
  ];
  return (
    <dl className="grid gap-1 text-sm" data-consent-tally="">
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap gap-x-2" data-tally={r.key}>
          <dt className="font-semibold text-stone-700">{r.label}</dt>
          <dd className="min-w-0 break-words text-stone-900">{tallyWords(r.n, r.titles)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Where it stands, for any reader: the heading, the sentence (or the decision record), the tally and the reasons. */
export function ConsentSummary({ consent, decided, headingId }: { consent: ConsentOut; decided: string | null; headingId?: string }) {
  const own = useId();
  const id = headingId ?? `${own}-consent`;
  return (
    <section aria-labelledby={id} className={`${PANEL} grid gap-3`} data-consent-summary={decided ? "adopted" : consent.state}>
      <h2 id={id} className={H2}>
        {CONSENT_WORDS.heading}
      </h2>
      <div className="grid gap-1">
        <p className="font-semibold text-stone-900" data-state-heading="">
          {decided ? ADOPTED_HEADING : STATE_HEADINGS[consent.state]}
        </p>
        <p className="text-stone-800">{decided ?? consent.words}</p>
      </div>
      <ConsentTally consent={consent} />
      {consent.objections.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700" data-objections="">
          {consent.objections.map((o, i) => (
            <li key={i} className="break-words">
              {o}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface CircleConsentProps {
  applicationId: string;
  consent: ConsentOut;
  decided: string | null;
  /** Whether the application still waits on a decision. Answers close with it. */
  waiting: boolean;
  /** After an answer lands, so the page can read the application again. */
  onAnswered?: () => void;
  /** Where the answer goes, when it is not an application's consent route. */
  answer?: (answer: ConsentAnswer, reason?: string) => Promise<{ ok: true; data: ConsentAnswerOut } | { ok: false; error: string }>;
}

/** The summary, and the asked holder's Consent and Object. */
export default function CircleConsent({ applicationId, consent: given, decided, waiting, onAnswered, answer: answerWith }: CircleConsentProps) {
  const [consent, setConsent] = useState(given);
  const [objecting, setObjecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Where an objection waits when the circle has no meeting to carry it to yet.
  const [where, setWhere] = useState<string | null>(null);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const goesId = `${ids}-goes`;
  const helpId = `${ids}-help`;
  const errorId = `${ids}-error`;

  // A fresh read of the page wins over what this panel last heard.
  useEffect(() => setConsent(given), [given]);

  const mayAnswer = waiting && !decided && consent.you.mayAnswer;
  const answered = consent.you.answer === "consent" || consent.you.answer === "object" ? (consent.you.answer as ConsentAnswer) : null;

  const send = async (answer: ConsentAnswer) => {
    if (busy) return;
    const said = reason.trim();
    // The route refuses an objection with no reason; say so here before asking it.
    if (answer === "object" && !said) {
      setError(CONSENT_WORDS.reasonNeeded);
      return;
    }
    setBusy(true);
    setError("");
    const out = await (answerWith ?? ((a: ConsentAnswer, r?: string) => answerConsent(applicationId, a, r)))(answer, answer === "object" ? said : undefined);
    setBusy(false);
    if (!out.ok) {
      setError(out.error || CONSENT_WORDS.failed);
      return;
    }
    setConsent(out.data.consent);
    setObjecting(false);
    setReason("");
    setWhere(out.data.carriedWords);
    onAnswered?.();
  };

  return (
    <div className="grid gap-3" data-circle-consent={decided ? "adopted" : consent.state}>
      <ConsentSummary consent={consent} decided={decided} />

      {mayAnswer && !objecting && (
        <div className={`${PANEL} grid gap-3`} data-consent-ask="">
          <p className="text-stone-800">{CONSENT_WORDS.askedYou(consent.closesOn ?? "")}</p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <button type="button" disabled={busy} onClick={() => void send("consent")} className={PRIMARY}>
              <Check className="size-4" aria-hidden="true" />
              {CONSENT_WORDS.consentButton}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setObjecting(true);
              }}
              className={SECONDARY}
            >
              <MessageSquareWarning className="size-4" aria-hidden="true" />
              {CONSENT_WORDS.objectButton}
            </button>
          </div>
        </div>
      )}

      {mayAnswer && objecting && (
        <form
          noValidate
          className={`${PANEL} grid gap-2`}
          data-objection-form=""
          onSubmit={(e) => {
            e.preventDefault();
            void send("object");
          }}
        >
          <label htmlFor={reasonId} className="font-semibold text-stone-900">
            {CONSENT_WORDS.reasonLabel}
          </label>
          <p id={goesId} className="text-stone-800">
            {CONSENT_WORDS.objectionGoes}
          </p>
          <textarea
            id={reasonId}
            rows={4}
            maxLength={OBJECTION_MAX}
            aria-required="true"
            aria-describedby={`${goesId} ${helpId}${error ? ` ${errorId}` : ""}`}
            aria-invalid={error === CONSENT_WORDS.reasonNeeded ? true : undefined}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
            autoFocus
          />
          <p id={helpId} className={LEDE}>
            {CONSENT_WORDS.reasonHelp}
          </p>
          {/* The refusal sits under the box it is about. */}
          {error && (
            <p id={errorId} role="alert" className="text-sm font-medium text-coral">
              {error}
            </p>
          )}
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <button type="submit" disabled={busy} className={PRIMARY}>
              {CONSENT_WORDS.sendObjection}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setObjecting(false);
                setError("");
              }}
              className={SECONDARY}
            >
              {CONSENT_WORDS.notNow}
            </button>
          </div>
        </form>
      )}

      {answered && (
        <div role="status" className={`${PANEL} grid gap-1`} data-your-answer={answered}>
          <p className="font-semibold text-stone-900">{answered === "object" ? CONSENT_WORDS.youObjected : CONSENT_WORDS.youConsented}</p>
          <p className={LEDE}>{CONSENT_WORDS.answerStands}</p>
          {where && <p className={LEDE}>{where}</p>}
        </div>
      )}

      {error && !(mayAnswer && objecting) && (
        <p role="alert" className="text-sm font-medium text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
