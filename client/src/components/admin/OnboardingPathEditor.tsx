/**
 * THE VILLAGE'S OWN ONBOARDING PATH, in the Org chart tab.
 *
 * The path a new holder gets opens from this document: the village's phases and
 * steps, each circle's defaults, and which role holds each owner key
 * (onboarding, access, memory, appointer). Paste the document
 * or edit it here; saving checks every row and names the one that is wrong.
 * A path already opened keeps the steps it was opened with.
 *
 * The switch is OFF until a founder ticks it and saves: onboarding needs the
 * circle's consent. Its own file because OrgChartTab carries one line for it.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import SaveBar, { type SaveResult } from "@/components/SaveBar";
import { docChangeCount } from "@/lib/unsavedChanges";

const WORDS = {
  heading: "Onboarding path",
  intro:
    "The onboarding path every new holder sees on their profile: a title, phases (a name, fromDay, toDay and steps), each circle's own steps, optional check-in days, and the role that holds each owner key. A step has a title, an owner (holder, buddy, onboarding, access, memory or appointer), a dueDay, a doneWhen and, if you like, a link ({ "label": "Open the guide", "href": "https://..." }: https only, shown as a button on the step). Paths already opened keep the steps they opened with.",
  label: "Onboarding path document (JSON)",
  on: "Switched on: new holders get this path. Tick only once the circle has consented.",
  notSaved: "The onboarding path did not save.",
  badJson: "That is not valid JSON.",
  failed: "The onboarding path did not load.",
} as const;

// A JSON document in a text box reads in a fixed-width face.
const JSON_BOX = "mt-1 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground"; // design-ok: JSON document box

export default function OnboardingPathEditor({ password }: { password: string }) {
  const [text, setText] = useState("");
  // What the server holds, so the floating save bar knows when this differs.
  const [savedText, setSavedText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [, setBusy] = useState(false);
  const parsed = (() => {
    try {
      const d = JSON.parse(text);
      return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    let live = true;
    void fetch(`${API_BASE}/admin/onboarding-path`, { headers: authHeaders(password) })
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) {
          setText(JSON.stringify(out.doc ?? {}, null, 2));
          setSavedText(JSON.stringify(out.doc ?? {}, null, 2));
          setLoaded(true);
        } else toast.error(refusal(out, WORDS.failed));
      })
      .catch(() => live && toast.error(WORDS.failed));
    return () => {
      live = false;
    };
  }, [password]);

  async function save(): Promise<SaveResult> {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, reason: WORDS.badJson };
    }
    setBusy(true);
    const res = await fetch(`${API_BASE}/admin/onboarding-path`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ doc }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      const now = JSON.stringify(out.doc ?? doc, null, 2);
      setText(now);
      setSavedText(now);
      return { ok: true };
    }
    return { ok: false, reason: refusal(out, WORDS.notSaved) };
  }

  return (
    <section aria-labelledby="onb-editor-h" className="rounded-xl border border-border bg-card p-4">
      <h3 id="onb-editor-h" className="font-semibold text-card-foreground">{WORDS.heading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{WORDS.intro}</p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-card-foreground">
        <input
          type="checkbox"
          checked={parsed?.enabled === true}
          disabled={!loaded || !parsed}
          onChange={(e) => setText(JSON.stringify({ ...parsed, enabled: e.target.checked }, null, 2))}
          className="h-5 w-5"
        />
        {WORDS.on}
      </label>
      <label className="mt-3 block text-sm font-medium text-card-foreground">
        {WORDS.label}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!loaded}
          rows={16}
          spellCheck={false}
          className={JSON_BOX}
        />
      </label>
      <SaveBar count={loaded ? docChangeCount(savedText, text) : 0} onSave={save} onDiscard={() => setText(savedText)} what={WORDS.heading} />
    </section>
  );
}
