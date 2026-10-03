/**
 * ONE EMAIL'S WORDS, in the editor (the comms build spec 5.5).
 *
 * What a founder can do here: change the subject, the preview line and the
 * body; put in any field this email knows from the picker; read the voice
 * check as they type; see the email the server would send, at phone and
 * desktop widths; send it to themselves; save it as a new version; bring an
 * old version back; and, when the platform's own words have improved since
 * the village took its copy, read the two side by side and take the new ones.
 *
 * THE PREVIEW IS THE SERVER'S. It is asked for after a pause in typing and
 * rendered by the same function that sends, so nothing here can drift from
 * what arrives. The voice check runs in the browser on every keystroke,
 * because it is advice and instant advice is more useful than accurate-later
 * advice; the save never waits on it and never refuses for it.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { voiceLintWords, type VoiceRule } from "@shared/comms/voiceLint";
import WordsPreview from "./WordsPreview";
import {
  adoptWords,
  fetchWordsDetail,
  previewWords,
  restoreWords,
  saveWords,
  sendTestWords,
  testOutcome,
  type WordsDetail,
  type WordsDraft,
  type WordsField,
  type WordsPreview as Preview,
} from "./wordsApi";

/** How long the editor waits after the last keystroke before asking for a new preview. */
const PREVIEW_PAUSE_MS = 700;

type FieldName = "subject" | "preheader" | "bodyMd";

const KIND_LABELS: Record<WordsDetail["kind"], string> = {
  essential: "Always sent: the reader asked for it",
  events: "Gathering emails",
  paths: "Path emails",
  letters: "Letters",
  notices: "Notices",
};

const RULE_LABELS: Record<VoiceRule, string> = {
  dash: "Dash",
  "filler-word": "Filler word",
  contrast: "Contrast",
  passive: "Vague",
  "rhetorical-opener": "Question opener",
};

const draftOf = (d: WordsDetail): WordsDraft => ({
  subject: d.live.subject,
  preheader: d.live.preheader ?? "",
  bodyMd: d.live.bodyMd,
});

const sameDraft = (a: WordsDraft, b: WordsDraft) => a.subject === b.subject && a.preheader === b.preheader && a.bodyMd === b.bodyMd;

const when = (epochSeconds: number) =>
  new Date(epochSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function sourceLine(d: WordsDetail): string {
  if (d.live.source === "village") return `Your village's words, version ${d.live.version}`;
  return `The platform's words, version ${d.live.version}. Saving an edit gives your village its own copy.`;
}

/** The field picker: every field this email knows, grouped, each one click from the words. */
function FieldPicker({ fields, onPick }: { fields: WordsField[]; onPick: (key: string) => void }) {
  const groups = useMemo(() => {
    const out: Array<{ label: string; fields: WordsField[] }> = [];
    for (const f of fields) {
      const g = out.find((x) => x.label === f.groupLabel);
      if (g) g.fields.push(f);
      else out.push({ label: f.groupLabel, fields: [f] });
    }
    return out;
  }, [fields]);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold text-gray-700">Put in a field</p>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{g.label}</p>
            <div className="flex flex-wrap gap-1">
              {g.fields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onPick(f.key)}
                  title={`${f.hint}${f.optional ? " Left out of the email when we don't know it." : ""}`}
                  className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:border-gray-400"
                >
                  {f.label}
                  {f.optional ? " (if known)" : ""}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The side-by-side compare, when the platform has newer words than the village's copy. */
function Compare({ detail, onAdopt, busy }: { detail: WordsDetail; onAdopt: () => void; busy: boolean }) {
  const platform = detail.platform;
  if (!platform) return null;
  const column = (title: string, w: { subject: string; preheader: string | null; bodyMd: string }) => (
    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <p className="text-sm font-semibold text-gray-900">{w.subject}</p>
      {w.preheader && <p className="mb-2 text-xs text-gray-500">{w.preheader}</p>}
      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800">{w.bodyMd}</pre>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row">
        {column(`Yours, version ${detail.live.version}`, detail.live)}
        {column(`The platform's new words, version ${platform.version}`, platform)}
      </div>
      <button
        type="button"
        onClick={onAdopt}
        disabled={busy}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        Take the new words
      </button>
      <p className="text-xs text-gray-500">Your own words stay in the versions below, one click from coming back.</p>
    </div>
  );
}

export default function WordsEditor({
  password,
  templateKey,
  onChanged,
  onDirty,
}: {
  password: string;
  templateKey: string;
  /** Called after a save, restore or adopt, so the list can refresh its line. */
  onChanged: () => void;
  /** Tells the screen whether there are unsaved words. */
  onDirty: (dirty: boolean) => void;
}) {
  const [detail, setDetail] = useState<WordsDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<WordsDraft>({ subject: "", preheader: "", bodyMd: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; problems?: string[] } | null>(null);
  const [comparing, setComparing] = useState(false);
  const focused = useRef<FieldName>("bodyMd");
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const load = useCallback(async () => {
    setLoadError("");
    const answer = await fetchWordsDetail(password, templateKey);
    if (!answer.ok) {
      setLoadError(answer.error);
      return;
    }
    setDetail(answer.body);
    setDraft(draftOf(answer.body));
  }, [password, templateKey]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = detail ? !sameDraft(draft, draftOf(detail)) : false;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // Ask the server for the email after a pause in typing. The first ask has no
  // pause, so the preview is there when the editor opens.
  const firstPreview = useRef(true);
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    const wait = firstPreview.current ? 0 : PREVIEW_PAUSE_MS;
    firstPreview.current = false;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const answer = await previewWords(password, templateKey, dirty ? draft : null);
      if (cancelled) return;
      setPreviewing(false);
      if (answer.ok) {
        setPreview(answer.body);
        setPreviewError("");
      } else {
        setPreviewError(answer.error);
      }
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `dirty` follows from `draft` and `detail`, both already listed.
  }, [draft, detail, password, templateKey]);

  const voice = useMemo(() => voiceLintWords(draft), [draft]);

  /** Put a field's token where the cursor is, in whichever box was last used. */
  const pick = (key: string) => {
    const name = focused.current;
    const el = inputs.current[name];
    const token = `{{${key}}}`;
    const value = draft[name];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setDraft({ ...draft, [name]: next });
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  /** Apply an answer that carries fresh words, and say what happened. */
  const landed = (fresh: WordsDetail, text: string) => {
    setDetail(fresh);
    setDraft(draftOf(fresh));
    setComparing(false);
    setNotice({ tone: "ok", text });
    onChanged();
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const answer = await saveWords(password, templateKey, draft);
    setBusy(false);
    if (!answer.ok) return setNotice({ tone: "error", text: answer.error, problems: answer.problems });
    landed(answer.body.detail, `Saved as version ${answer.body.saved}. Emails written from now on use these words.`);
  };

  const restore = async (version: number) => {
    setBusy(true);
    setNotice(null);
    const answer = await restoreWords(password, templateKey, version);
    setBusy(false);
    if (!answer.ok) return setNotice({ tone: "error", text: answer.error });
    landed(answer.body.detail, `Version ${version} is live again.`);
  };

  const adopt = async () => {
    setBusy(true);
    setNotice(null);
    const answer = await adoptWords(password, templateKey);
    setBusy(false);
    if (!answer.ok) return setNotice({ tone: "error", text: answer.error });
    landed(answer.body.detail, `The platform's words are live as version ${answer.body.adopted}.`);
  };

  const test = async () => {
    setBusy(true);
    setNotice(null);
    const answer = await sendTestWords(password, templateKey, dirty ? draft : null);
    setBusy(false);
    if (!answer.ok) return setNotice({ tone: "error", text: answer.error });
    setNotice({ tone: answer.body.status === "sent" ? "ok" : "error", text: testOutcome(answer.body) });
  };

  if (loadError) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>;
  if (!detail) return <p className="py-12 text-center text-sm text-gray-400">Loading the words...</p>;

  const box = (name: FieldName) => ({
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputs.current[name] = el;
    },
    onFocus: () => {
      focused.current = name;
    },
    value: draft[name],
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{detail.label}</h3>
        <p className="text-xs text-gray-500">
          {KIND_LABELS[detail.kind]}. {sourceLine(detail)}
        </p>
      </div>

      {detail.upgradeAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-amber-900">
              An improved version of these words is available from the platform. Your words stay yours until you take it.
            </p>
            <button
              type="button"
              onClick={() => setComparing(!comparing)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              {comparing ? "Hide the comparison" : "Compare side by side"}
            </button>
          </div>
          {comparing && (
            <div className="mt-3">
              <Compare detail={detail} onAdopt={adopt} busy={busy} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label htmlFor="words-subject" className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
            <input
              id="words-subject"
              type="text"
              {...box("subject")}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label htmlFor="words-preheader" className="mb-1 block text-sm font-medium text-gray-700">Preview line</label>
            <input
              id="words-preheader"
              type="text"
              {...box("preheader")}
              onChange={(e) => setDraft({ ...draft, preheader: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <p className="mt-1 text-xs text-gray-500">The line an inbox shows after the subject. Left empty, it shows the email's first words.</p>
          </div>
          <div>
            <label htmlFor="words-body" className="mb-1 block text-sm font-medium text-gray-700">The email</label>
            <textarea
              id="words-body"
              rows={16}
              {...box("bodyMd")}
              onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs leading-relaxed text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <p className="mt-1 text-xs text-gray-500">
              A blank line starts a new paragraph. A line that is only a link, like [See the gathering]({"{{gathering.url}}"}), becomes the
              email's button: keep to one.
            </p>
          </div>

          <FieldPicker fields={detail.fields} onPick={pick} />

          <div aria-live="polite" className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold text-gray-700">Voice check</p>
            {voice.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">Clean: no dashes, filler words or contrast frames.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {voice.map((f, i) => (
                  <li key={i} className="text-xs text-amber-900">
                    <span className="font-semibold">{RULE_LABELS[f.rule]}</span> in the {f.where}: "{f.match}". {f.hint}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {notice && (
            <div className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
              <p>{notice.text}</p>
              {notice.problems && notice.problems.length > 1 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {notice.problems.slice(1).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Save as a new version
            </button>
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Send me a test
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setDraft(draftOf(detail))}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Undo my changes
              </button>
            )}
          </div>
        </div>

        <WordsPreview preview={preview} loading={previewing} error={previewError} />
      </div>

      <section aria-label="Versions" className="rounded-xl border border-gray-200 bg-white">
        <p className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Versions</p>
        {detail.versions.length === 0 ? (
          <p className="px-4 py-3 text-xs text-gray-500">None yet. This email uses the platform's words until your village saves its own.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900">
                    Version {v.version}: {v.subject}
                  </p>
                  <p className="text-xs text-gray-500">
                    {when(v.createdAt)}
                    {v.editedBy ? `, by ${v.editedByName ?? "a former member"}` : `, the platform's words, version ${v.platformVersion ?? 1}`}
                  </p>
                </div>
                {v.state === "live" ? (
                  <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">Live</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => restore(v.version)}
                    disabled={busy}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Bring back version {v.version}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
