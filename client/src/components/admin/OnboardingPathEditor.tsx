/**
 * THE VILLAGE'S OWN ONBOARDING PATH, in the Org chart tab.
 *
 * "Your first moons in <role>" opens from the platform's four steps plus this
 * document: the village's steps, each circle's defaults, and which role holds
 * each owner key (onboarding, access, memory, appointer). Paste the document
 * or edit it here; saving checks every row and names the one that is wrong.
 * A path already opened keeps the steps it was opened with.
 *
 * Its own file because OrgChartTab carries one line for it.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";

const WORDS = {
  heading: "Onboarding path",
  intro:
    "The steps every new holder sees under \"Your first moons\", beyond the four the platform brings. Each step has a key, a title, an owner (holder, buddy, onboarding, access, memory or appointer), a dueDay and a doneWhen. The owners object names the role that holds each owner key. Paths already opened keep the steps they opened with.",
  label: "Onboarding path document (JSON)",
  save: "Save onboarding path",
  saved: "Onboarding path saved",
  badJson: "That is not valid JSON.",
  failed: "The onboarding path did not load.",
} as const;

export default function OnboardingPathEditor({ password }: { password: string }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`${API_BASE}/admin/onboarding-path`, { headers: authHeaders(password) })
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) {
          setText(JSON.stringify(out.doc ?? {}, null, 2));
          setLoaded(true);
        } else toast.error(refusal(out, WORDS.failed));
      })
      .catch(() => live && toast.error(WORDS.failed));
    return () => {
      live = false;
    };
  }, [password]);

  async function save() {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      toast.error(WORDS.badJson);
      return;
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
      setText(JSON.stringify(out.doc ?? doc, null, 2));
      toast.success(WORDS.saved);
    } else toast.error(refusal(out, WORDS.failed));
  }

  return (
    <section aria-labelledby="onb-editor-h" className="rounded-xl border border-border bg-card p-4">
      <h3 id="onb-editor-h" className="font-semibold text-card-foreground">{WORDS.heading}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{WORDS.intro}</p>
      <label className="mt-3 block text-sm font-medium text-card-foreground">
        {WORDS.label}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!loaded}
          rows={16}
          spellCheck={false}
          className="mt-1 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground"
        />
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={!loaded || busy}
        className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {WORDS.save}
      </button>
    </section>
  );
}
