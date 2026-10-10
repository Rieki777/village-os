/**
 * WRITING ONE LETTER, on the Letters screen: the words, who it is for, a
 * preview rendered by the real renderer, Send me a test, and the
 * confirmation (send now or schedule). The routes are
 * server/routes/commsLetters.ts.
 *
 * THE CONFIRMATION IS THE PREVIEW'S. The server answers a confirmation bound
 * to the words, the audience and the count it showed, lasting 15 minutes, and
 * this screen makes one send key per preview. Pressing Send twice sends once;
 * changing a word throws the preview away, so what goes is what was seen.
 *
 * THE SAMPLE RENDERS IN A SANDBOX, like Sent mail: an iframe with nothing
 * allowed, so nothing in a letter can run or reach this page.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useState } from "react";
import type { LetterAudience, LetterAudienceKind } from "@shared/comms/letters";
import { CONFIRM_MINUTES, LETTER_LIMITS } from "@shared/comms/letters";
import {
  createLetter,
  localToIso,
  momentLabel,
  previewLetter,
  saveLetter,
  sendLetter,
  testLetter,
  type LetterInput,
  type LettersAnswer,
  type LetterView,
  type PreviewAnswer,
} from "./lettersApi";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900";
const button = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60";
const primary = `${button} bg-gray-900 text-white`;
const secondary = `${button} border border-gray-300 bg-white text-gray-900`;

/** A fresh key for one preview's confirmation. */
function newSendKey(): string {
  const c = globalThis.crypto;
  return `send:${c && "randomUUID" in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function audienceOf(kind: LetterAudienceKind, pathId: string, eventId: string): LetterAudience | null {
  if (kind === "members" || kind === "everyone") return { kind };
  if (kind === "path") return pathId ? { kind, pathId } : null;
  return eventId ? { kind, eventId } : null;
}

function namesLine(p: PreviewAnswer): string {
  if (p.count === 0) return "Nobody in this audience has said yes to letters yet.";
  const more = p.count - p.names.length;
  return `It goes to ${p.count} ${p.count === 1 ? "person" : "people"}: ${p.names.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
}

export default function LetterComposer({
  password,
  letter,
  choices,
  onDone,
}: {
  password: string;
  /** The letter being edited, or null for a new one. */
  letter: LetterView | null;
  choices: LettersAnswer["choices"];
  /** Called after a save, a send or a schedule, so History reads again. */
  onDone: (note: string, keepOpen: boolean) => void;
}) {
  const [id, setId] = useState<string | null>(letter?.id ?? null);
  const [subject, setSubject] = useState(letter?.subject ?? "");
  const [preheader, setPreheader] = useState(letter?.preheader ?? "");
  const [bodyMd, setBodyMd] = useState(letter?.bodyMd ?? "");
  const [kind, setKind] = useState<LetterAudienceKind>(letter?.audience?.kind ?? "members");
  const [pathId, setPathId] = useState(letter?.audience?.kind === "path" ? letter.audience.pathId : choices.paths[0]?.id ?? "");
  const [eventId, setEventId] = useState(letter?.audience?.kind === "gathering" ? letter.audience.eventId : choices.gatherings[0]?.id ?? "");
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewAnswer | null>(null);
  const [sendKey, setSendKey] = useState("");
  const [when, setWhen] = useState("");

  /** Any change throws the preview and its confirmation away. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  /** Save what is on screen, and answer the letter's id. */
  async function save(): Promise<string | null> {
    const audience = audienceOf(kind, pathId, eventId);
    if (!audience) {
      setProblems([kind === "path" ? "Choose a path." : "Choose a gathering."]);
      return null;
    }
    const input: LetterInput = { subject, preheader, bodyMd, layout: "plain", audience };
    const answer = id ? await saveLetter(password, id, input) : await createLetter(password, input);
    if (!answer.ok) {
      setProblems(answer.problems ?? [answer.error]);
      return null;
    }
    setProblems([]);
    setId(answer.body.letter.id);
    return answer.body.letter.id;
  }

  const run = async (what: () => Promise<void>) => {
    setBusy(true);
    setNote("");
    try {
      await what();
    } finally {
      setBusy(false);
    }
  };

  const onSave = () =>
    run(async () => {
      if (await save()) onDone("Saved.", true);
    });

  const onPreview = () =>
    run(async () => {
      const saved = await save();
      if (!saved) return;
      const answer = await previewLetter(password, saved);
      if (!answer.ok) return setNote(answer.error);
      setPreview(answer.body);
      setSendKey(newSendKey());
    });

  const onTest = () =>
    run(async () => {
      const saved = await save();
      if (!saved) return;
      const answer = await testLetter(password, saved);
      if (!answer.ok) return setNote(answer.error);
      setNote(
        answer.body.status === "sent"
          ? `Sent to ${answer.body.sentTo}.`
          : answer.body.reason === "no_api_key" || answer.body.reason === "no_sender"
            ? "Not sent. Finish the setup in Comms Settings first."
            : "Not sent. Sent mail has the details.",
      );
    });

  const onSend = (schedule: boolean) =>
    run(async () => {
      if (!id || !preview?.confirmToken) return;
      const scheduledFor = schedule ? localToIso(when) : null;
      if (schedule && !scheduledFor) return setNote("Pick a date and time to send it.");
      const answer = await sendLetter(password, id, { confirmToken: preview.confirmToken, idempotencyKey: sendKey, scheduledFor });
      if (!answer.ok) return setNote(answer.error);
      const b = answer.body;
      if (b.state === "scheduled") return onDone(`Scheduled for ${momentLabel(b.scheduledFor)}.`, false);
      const counts = b.counts;
      onDone(
        b.duplicate
          ? "This letter already went. History has its numbers."
          : `Sent. ${counts?.posted ?? 0} handed to the post office${counts?.skipped ? `, ${counts.skipped} skipped` : ""}.`,
        false,
      );
    });

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid gap-3">
        <label className="text-sm font-medium text-gray-900">
          Subject
          <input value={subject} maxLength={LETTER_LIMITS.subject} onChange={(e) => edit(setSubject)(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="text-sm font-medium text-gray-900">
          Preview line <span className="font-normal text-gray-500">(optional, shown beside the subject in an inbox)</span>
          <input value={preheader} maxLength={LETTER_LIMITS.preheader} onChange={(e) => edit(setPreheader)(e.target.value)} className={`${field} mt-1`} />
        </label>
        <fieldset className="text-sm text-gray-900">
          <legend className="font-medium">Who it is for</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select aria-label="Audience" value={kind} onChange={(e) => edit(setKind)(e.target.value as LetterAudienceKind)} className={field + " sm:w-auto"}>
              <option value="members">Members who said yes to letters</option>
              <option value="everyone">Everyone who said yes to letters</option>
              <option value="path">People on a path</option>
              <option value="gathering">People who came to a gathering</option>
            </select>
            {kind === "path" && (
              <select aria-label="Path" value={pathId} onChange={(e) => edit(setPathId)(e.target.value)} className={field + " sm:w-auto"}>
                {choices.paths.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            {kind === "gathering" &&
              (choices.gatherings.length ? (
                <select aria-label="Gathering" value={eventId} onChange={(e) => edit(setEventId)(e.target.value)} className={field + " sm:w-auto"}>
                  {choices.gatherings.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}, {g.startsAt.slice(0, 10)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-500">There are no recent gatherings to choose from.</span>
              ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">Letters reach only people who said yes to them. The preview says how many that is.</p>
        </fieldset>
        <label className="text-sm font-medium text-gray-900">
          The letter
          <textarea value={bodyMd} rows={12} onChange={(e) => edit(setBodyMd)(e.target.value)} className={`${field} mt-1 font-mono`} />
          <span className="mt-1 block text-xs font-normal text-gray-500">
            Markdown: **bold**, _italic_, [a link](https://example.org), and a blank line between paragraphs. It is set inside the
            "Every letter" words, which Words edits.
          </span>
        </label>
      </div>

      {problems.length > 0 && (
        <ul className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {note && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{note}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onPreview} className={primary}>
          Preview and choose when
        </button>
        <button type="button" disabled={busy} onClick={onTest} className={secondary}>
          Send me a test
        </button>
        <button type="button" disabled={busy} onClick={onSave} className={secondary}>
          Save the draft
        </button>
      </div>

      {preview && (
        <section aria-label="Preview" className="space-y-3 border-t border-gray-200 pt-4">
          <p className="text-sm font-medium text-gray-900">{namesLine(preview)}</p>
          {preview.leftOut > 0 && (
            <p className="text-sm text-gray-600">
              {preview.leftOut} more in this group {preview.leftOut === 1 ? "is" : "are"} left out: no yes to letters, a pause, or an
              address that stopped taking email.
            </p>
          )}
          {preview.note && <p className="text-sm text-gray-600">{preview.note}</p>}
          {preview.voice.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {preview.voice.map((v, i) => (
                <li key={`${v.rule}-${i}`}>
                  {v.where}: "{v.match}". {v.hint}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-gray-700">
            Subject: {preview.subject}. Shown as {preview.sampleFor} will see it.
          </p>
          <iframe title="The letter as it arrives" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-lg border border-gray-200 bg-white" />
          {preview.confirmToken && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm text-gray-700">
                This confirmation lasts {CONFIRM_MINUTES} minutes. Change anything and preview again.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => onSend(false)} className={primary}>
                  Send it now to {preview.count}
                </button>
                <span className="text-sm text-gray-500">or</span>
                <label className="sr-only" htmlFor="letter-when">
                  Send at
                </label>
                <input id="letter-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${field} sm:w-auto`} />
                <button type="button" disabled={busy || !when} onClick={() => onSend(true)} className={secondary}>
                  Schedule it
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
