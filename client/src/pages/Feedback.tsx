/**
 * Feedback (S66): the door where a bug report or an idea walks in.
 *
 * Two honesty rules shape this page. First, the disclosure is REAL: the form
 * says where the words go — to this village's team, and (while the relay is
 * on) a copy to the platform team so a fix can reach every village — before
 * anyone types. Second, names stay home: whoever is signed in is attached
 * for the LOCAL queue so their own admins can follow up, but the relay
 * never carries it.
 */
import Layout from "@/components/Layout";
import { useEffect, useRef, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { Bug, Check, Lightbulb, Loader2 } from "lucide-react";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export default function Feedback() {
  const [cfg, setCfg] = useState<{ relayOn: boolean; villageName: string } | null>(null);
  const [kind, setKind] = useState<"bug" | "idea">("bug");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | { shared: boolean }>(null);
  // The panel replaces the form and its button, so focus would fall to
  // <body> and nothing would be read. Focus goes to the panel, which reads it.
  const received = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sent) received.current?.focus();
  }, [sent]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/feedback/config").then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);

  const submit = () => {
    setBusy(true);
    setError("");
    fetch("/api/feedback", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ kind, title, detail, hp, pageUrl: document.referrer || null }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not send that");
        setSent({ shared: !!d.shared });
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Something broken? Something missing?</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Both are gifts. A bug named is a bug on its way out; an idea written
            down is one the village can actually weigh.
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-xl">
          {sent ? (
            <div ref={received} tabIndex={-1} className="bg-card border border-border rounded-xl p-8 text-center outline-none">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-6 h-6 text-emerald-700" />
              </div>
              <p className="font-semibold text-foreground mb-1">Received, thank you.</p>
              <p className="text-sm text-muted-foreground">
                {sent.shared
                  ? "Your village's team has it, and a copy reaches the platform team so a fix can land for every village. Your name travels to neither the platform nor anywhere else. It stays here."
                  : "Your village's team has it and will take it from here."}
              </p>
              <button
                onClick={() => { setSent(null); setTitle(""); setDetail(""); }}
                className="mt-5 text-sm text-teal-deep font-medium hover:underline"
              >
                Send another
              </button>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setKind("bug")}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${
                    kind === "bug" ? "border-teal-deep bg-teal-deep/5 text-teal-deep" : "border-border text-muted-foreground"
                  }`}
                >
                  <Bug className="w-4 h-4" /> Something broke
                </button>
                <button
                  onClick={() => setKind("idea")}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium ${
                    kind === "idea" ? "border-teal-deep bg-teal-deep/5 text-teal-deep" : "border-border text-muted-foreground"
                  }`}
                >
                  <Lightbulb className="w-4 h-4" /> An idea
                </button>
              </div>

              <div>
                {/* htmlFor + id. The label text was already right; it just
                    was not tied to the field, so both controls reached a
                    screen reader unnamed. */}
                <label htmlFor="feedback-title" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {kind === "bug" ? "What went wrong, in one line" : "The idea, in one line"}
                </label>
                <input
                  id="feedback-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="w-full text-base border border-border rounded-lg px-3 py-2.5 bg-background"
                  placeholder={kind === "bug" ? "The quest page shows a blank box when…" : "It would help if…"}
                />
              </div>

              <div>
                <label htmlFor="feedback-detail" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {kind === "bug" ? "What did you do, what did you expect, what happened instead?" : "How would it work, and who does it serve?"}
                </label>
                <textarea
                  id="feedback-detail"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={6}
                  maxLength={8000}
                  className="w-full text-base border border-border rounded-lg px-3 py-2.5 bg-background"
                />
              </div>

              {/* Honeypot — humans never see it, bots can't resist it. */}
              <input
                type="text"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute opacity-0 pointer-events-none h-0 w-0"
              />

              {/* The disclosure, before the button, in plain words. */}
              <p className="text-xs text-muted-foreground border-t border-border pt-3">
                {cfg?.relayOn
                  ? `Where this goes: ${cfg?.villageName ?? "your village"}'s team, plus a copy to the ReGen Civics platform team, so a bug fixed once is fixed for every village. What you write travels; who you are does not.`
                  : `Where this goes: ${cfg?.villageName ?? "your village"}'s team, and nowhere else.`}
              </p>

              {/* The thresholds used to be silent: the button was disabled with no title,
                  no aria-disabled and no helper text, so clicking it changed nothing on
                  the page and said nothing about why. This is the channel members use to
                  report every other bug, so it is the last surface that should make
                  somebody guess. */}
              {(title.trim().length < 4 || detail.trim().length < 10) && (
                <p className="text-xs text-muted-foreground">
                  {title.trim().length < 4
                    ? "Give it a short title first, at least four characters."
                    : "Add a little more detail, at least ten characters, so somebody can act on it."}
                </p>
              )}
              <button
                onClick={submit}
                aria-disabled={busy || title.trim().length < 4 || detail.trim().length < 10}
                disabled={busy || title.trim().length < 4 || detail.trim().length < 10}
                className="w-full inline-flex items-center justify-center gap-2 text-sm bg-teal-deep text-white rounded-lg px-4 py-3 font-medium disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send it
              </button>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
