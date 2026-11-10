/**
 * Introductions: say what you seek, confirm what you could offer, and answer
 * the few good matches the village proposes. Designed at 390px first: one
 * column, 44px tap targets, the inbox above the fold because the yes is the
 * point of the page.
 *
 * Bodies render as TEXT (React escapes); there is no HTML pipeline here to
 * sanitize, the same posture Messages takes.
 */
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { actionError } from "@/lib/actionOutcome";
import { Check, EyeOff, Handshake, Pause, Plus, X } from "lucide-react";
import VoiceArea from "@/components/voice/VoiceArea";
import { useLingui } from "@lingui/react/macro";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

/** Every tap target on this page clears 44px. */
const TAP = "min-h-[44px]";

type Tier = "public" | "members" | "incognito" | "private";

const TIER_GLOSS: Record<Tier, string> = {
  public: "On the board for anyone the village admits",
  members: "On the board for signed-in members",
  incognito: "Matched quietly. Nobody sees your words or name unless you both say yes",
  private: "A note to yourself. Never matched, never shown",
};

interface Intent {
  id: string;
  kind: "seek" | "offer";
  text: string;
  why: string | null;
  topics: string[];
  tier: Tier;
  lifecycle: string;
  inferredFrom: Array<{ source: string; label: string }> | null;
}

interface Opportunity {
  id: string;
  status: string;
  mine: { kind: string; text: string };
  theirs: {
    kind: string;
    text: string | null;
    why: string | null;
    topics: string[];
    incognito: boolean;
    counterpart: { userId: string; firstName: string | null } | null;
  };
  reasons: Array<{ index: number; text: string; source: string; aboutMe: boolean }>;
  myAccepted: boolean;
  theirAccepted: boolean;
  declined: { byMe: boolean } | null;
  conversationId: string | null;
}

interface Policy {
  consentAt: string | null;
  maxPerWeek: number;
  topics: string[] | null;
  pausedUntil: string | null;
}

interface BoardEntry {
  id: string;
  kind: "seek" | "offer";
  text: string;
  why: string | null;
  topics: string[];
  firstName: string | null;
}

interface Suggestion {
  source: string;
  label: string;
  text: string;
}

export default function Introductions() {
  const modules = useModules();
  const introductionsModule = useModule("introductions");
  if (modules.loaded && !introductionsModule) {
    return <ModuleGate moduleId="introductions" name="Introductions" />;
  }
  return <IntroductionsPage />;
}

function IntroductionsPage() {
  const { user } = useAuth();
  const [mine, setMine] = useState<Intent[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [consentSentence, setConsentSentence] = useState("");
  const [canAct, setCanAct] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");

  const loadMine = useCallback(() => {
    if (!authToken()) return;
    fetch("/api/intents/mine", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMine(Array.isArray(d.intents) ? d.intents : []);
        setPolicy(d.policy ?? null);
        setConsentSentence(String(d.consentSentence ?? ""));
        setCanAct(!!d.canAct);
      })
      .catch(() => {});
    fetch("/api/intents/opportunities", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOpportunities(Array.isArray(d?.opportunities) ? d.opportunities : []))
      .catch(() => {});
  }, []);

  const loadSuggestions = useCallback(() => {
    if (!authToken()) return;
    fetch("/api/intents/suggestions", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSuggestions(Array.isArray(d?.suggestions) ? d.suggestions : []))
      .catch(() => {});
  }, []);

  const loadBoard = useCallback(() => {
    fetch("/api/intents/board", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBoard(Array.isArray(d?.board) ? d.board : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBoard();
    if (user) {
      loadMine();
      loadSuggestions();
    }
  }, [user, loadBoard, loadMine, loadSuggestions]);

  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(""), 4000);
  };

  if (!user) {
    // The module is public here (requireModule admitted the board), so the
    // page keeps its own chrome and offers sign-in inline. SignInToSee
    // carries a whole Layout of its own and belongs to the gate path only.
    return (
      <Layout>
        <div className="container max-w-2xl py-6 sm:py-10 space-y-6">
          <Header />
          <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              The rest of this page opens when you sign in: your own intents, offers to confirm, and the
              introductions waiting for you.
            </p>
            <SignInDoors next="/introductions" />
          </div>
          <Board entries={board} />
        </div>
      </Layout>
    );
  }

  const consented = !!policy?.consentAt;

  return (
    <Layout>
      <div className="container max-w-2xl py-6 sm:py-10 space-y-6">
        <Header />
        {note && (
          <p role="status" className="rounded-lg bg-teal-deep/10 text-teal-deep text-sm px-4 py-3">{note}</p>
        )}

        {!canAct && (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Posting and answering introductions opens at the member stage, or during an active stay. The board below is
            yours to read meanwhile.
          </div>
        )}

        <Inbox opportunities={opportunities} onChanged={loadMine} onSay={say} />

        {canAct && (
          <ConsentCard
            sentence={consentSentence}
            consented={consented}
            onChange={async (consent) => {
              const r = await fetch("/api/intents/policy", {
                method: "PUT",
                headers: headers(),
                body: JSON.stringify({ consent }),
              });
              if (r.ok) {
                say(consent ? "Thank you. Suggestions and richer matching are on" : "Withdrawn. Your intents are paused");
                loadMine();
                loadSuggestions();
              }
            }}
          />
        )}

        {canAct && consented && suggestions.length > 0 && (
          <Suggestions
            suggestions={suggestions}
            onConfirm={async (s) => {
              const r = await fetch("/api/intents", {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({
                  kind: "offer",
                  text: s.text,
                  inferredFrom: [{ source: s.source, label: s.label }],
                }),
              });
              if (r.ok) {
                say("Offer confirmed. It joins the pool");
                loadMine();
                loadSuggestions();
              }
            }}
            onDismiss={(s) => setSuggestions((prev) => prev.filter((x) => x.source !== s.source))}
          />
        )}

        {canAct && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-foreground">My intents</h2>
              <button
                type="button"
                onClick={() => setComposing((v) => !v)}
                className={`inline-flex items-center gap-2 ${TAP} px-4 rounded-lg bg-teal-deep text-white font-semibold text-sm`}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                New
              </button>
            </div>
            {composing && (
              <Compose
                onDone={(created) => {
                  setComposing(false);
                  if (created) {
                    say("Posted. The matcher is looking");
                    loadMine();
                  }
                }}
              />
            )}
            {mine.length === 0 && !composing && (
              <p className="text-sm text-muted-foreground">
                Say what you seek in your own words. The village listens better than a form suggests.
              </p>
            )}
            <ul className="space-y-2">
              {mine.map((i) => (
                <MyIntent key={i.id} intent={i} onChanged={loadMine} onSay={say} />
              ))}
            </ul>
          </section>
        )}

        {canAct && (
          <PolicyLine
            policy={policy}
            onSave={async (patch) => {
              const r = await fetch("/api/intents/policy", {
                method: "PUT",
                headers: headers(),
                body: JSON.stringify(patch),
              });
              if (r.ok) {
                say("Saved");
                loadMine();
              }
            }}
          />
        )}

        <Board entries={board} />
      </div>
    </Layout>
  );
}

function Header() {
  return (
    <header>
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
        <Handshake className="w-7 h-7 text-teal-deep" aria-hidden="true" />
        Introductions
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        A few good introductions a week. Both people say yes before a conversation opens.
      </p>
    </header>
  );
}

function ConsentCard({
  sentence,
  consented,
  onChange,
}: {
  sentence: string;
  consented: boolean;
  onChange: (consent: boolean) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 w-5 h-5 accent-teal-deep"
        />
        <span className="text-sm text-foreground">{sentence}</span>
      </label>
      <p className="text-xs text-muted-foreground pl-8">
        Until you tick this, matching reads only the words you post here. Withdrawing pauses your intents and deletes
        nothing.
      </p>
    </section>
  );
}

function Suggestions({
  suggestions,
  onConfirm,
  onDismiss,
}: {
  suggestions: Suggestion[];
  onConfirm: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-display text-lg font-bold text-foreground">You could offer</h2>
      <p className="text-xs text-muted-foreground">
        Drawn from your skills, roles, badges and finished quests. Nothing is posted unless you confirm it.
      </p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.source} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-foreground">{s.label}</span>
            <span className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onConfirm(s)}
                className={`inline-flex items-center gap-1 ${TAP} px-3 rounded-lg bg-teal-deep text-white text-xs font-semibold`}
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Confirm
              </button>
              <button
                type="button"
                onClick={() => onDismiss(s)}
                className={`inline-flex items-center ${TAP} px-3 rounded-lg border border-border text-xs`}
              >
                Not now
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Compose({ onDone }: { onDone: (created: boolean) => void }) {
  const { t } = useLingui();
  const [kind, setKind] = useState<"seek" | "offer">("seek");
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [topics, setTopics] = useState("");
  const [tier, setTier] = useState<Tier>("members");
  const [weeks, setWeeks] = useState(4);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/intents", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        kind,
        text,
        why: why || undefined,
        tier,
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
        expiresWeeks: weeks,
      }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) return onDone(true);
    const body = await r?.json().catch(() => null);
    setError(String(body?.error ?? "That did not save. Try again in a moment"));
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex gap-2" role="radiogroup" aria-label="Kind">
        {(["seek", "offer"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`${TAP} px-4 rounded-lg text-sm font-semibold border ${
              kind === k ? "bg-teal-deep text-white border-teal-deep" : "border-border text-foreground"
            }`}
          >
            {k === "seek" ? "I am seeking" : "I can offer"}
          </button>
        ))}
      </div>
      <VoiceArea value={text} onValue={setText}
        talk={{
          label: t({ message: "What you seek or offer", context: "voice field label: introductions request" }),
          purpose: t({ message: "What you are looking for, or what you could give a hand with, in your own words.", context: "voice field purpose: introductions request" }),
        }}
      >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder={kind === "seek" ? "What are you looking for, in your own words?" : "What could you give a hand with?"}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      </VoiceArea>
      <input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        maxLength={300}
        placeholder="Why it matters to you (optional)"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <input
        value={topics}
        onChange={(e) => setTopics(e.target.value)}
        placeholder="Topics, separated by commas: food, land, music"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold text-muted-foreground">Who can see it</legend>
        {(Object.keys(TIER_GLOSS) as Tier[]).map((t) => (
          <label key={t} className="flex items-start gap-2 text-sm cursor-pointer">
            {/* The tier names the choice; the gloss explains it. Wrapped in a
                <label> the two were read as one name, so picking a visibility
                meant hearing four sentences to find four words. */}
            <input
              type="radio"
              name="tier"
              checked={tier === t}
              onChange={() => setTier(t)}
              aria-label={t.charAt(0).toUpperCase() + t.slice(1)}
              aria-describedby={`tier-${t}-gloss`}
              className="mt-1 accent-teal-deep"
            />
            <span>
              <span className="font-semibold capitalize">{t}</span>
              <span id={`tier-${t}-gloss`} className="block text-xs text-muted-foreground">{TIER_GLOSS[t]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Rests after</span>
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-2 py-1"
        >
          <option value={2}>2 weeks</option>
          <option value={4}>4 weeks</option>
          <option value={8}>8 weeks</option>
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={submit}
          className={`${TAP} px-4 rounded-lg bg-teal-deep text-white text-sm font-semibold disabled:opacity-50`}
        >
          Post it
        </button>
        <button type="button" onClick={() => onDone(false)} className={`${TAP} px-4 rounded-lg border border-border text-sm`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MyIntent({ intent, onChanged, onSay }: { intent: Intent; onChanged: () => void; onSay: (t: string) => void }) {
  // SWEEP. Pausing, resuming or retiring an intent swallowed every failure,
  // so a member could press Pause, watch the row stay active, and conclude
  // the control was decorative.
  const set = async (patch: Record<string, unknown>) => {
    const r = await fetch(`/api/intents/${intent.id}`, { method: "PUT", headers: headers(), body: JSON.stringify(patch) }).catch(
      () => null,
    );
    const wrong = actionError({ ok: !!r?.ok, error: null });
    if (wrong) onSay(wrong);
    onChanged();
  };
  const resting = intent.lifecycle !== "active";
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{intent.kind === "seek" ? "Seeking" : "Offering"}:</span> {intent.text}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="capitalize">{intent.tier}</span>
            {intent.topics.length > 0 && <> · {intent.topics.join(", ")}</>}
            {resting && <> · {intent.lifecycle}</>}
            {intent.inferredFrom?.length ? <> · confirmed from your record</> : null}
          </p>
        </div>
        <span className="flex gap-1 shrink-0">
          {intent.lifecycle === "active" ? (
            <button
              type="button"
              title="Pause"
              aria-label={`Pause: ${intent.text}`}
              onClick={() => set({ lifecycle: "paused" })}
              className={`inline-flex items-center justify-center ${TAP} min-w-[44px] rounded-lg border border-border`}
            >
              <Pause className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => set({ lifecycle: "active" })}
              className={`inline-flex items-center ${TAP} px-3 rounded-lg border border-border text-xs`}
            >
              Wake it
            </button>
          )}
          {intent.lifecycle === "active" && (
            <button
              type="button"
              title="Fulfilled"
              aria-label={`Mark fulfilled: ${intent.text}`}
              onClick={() => set({ lifecycle: "fulfilled" })}
              className={`inline-flex items-center justify-center ${TAP} min-w-[44px] rounded-lg border border-border`}
            >
              <Check className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function Inbox({
  opportunities,
  onChanged,
  onSay,
}: {
  opportunities: Opportunity[];
  onChanged: () => void;
  onSay: (t: string) => void;
}) {
  const open = opportunities.filter((o) => !["declined", "expired"].includes(o.status));
  if (!open.length) return null;
  return (
    <section className="rounded-xl border-2 border-teal-deep/40 bg-card p-4 space-y-3">
      <h2 className="font-display text-lg font-bold text-foreground">Introductions for you</h2>
      <ul className="space-y-3">
        {open.map((o) => (
          <OpportunityCard key={o.id} opp={o} onChanged={onChanged} onSay={onSay} />
        ))}
      </ul>
    </section>
  );
}

function OpportunityCard({
  opp,
  onChanged,
  onSay,
}: {
  opp: Opportunity;
  onChanged: () => void;
  onSay: (t: string) => void;
}) {
  const them = opp.theirs.incognito
    ? "Someone here"
    : opp.theirs.counterpart?.firstName ?? "A member";
  /*
   * SWEEP (the incomplete loop). Accept and decline printed their
   * confirmation on success and said NOTHING on failure, so a member who
   * tapped Accept on a dropped connection saw the same screen either way and
   * had no reason to try again.
   */
  const act = async (path: string, success: string) => {
    const r = await fetch(`/api/intents/opportunities/${opp.id}/${path}`, { method: "POST", headers: headers() }).catch(
      () => null,
    );
    const wrong = actionError({ ok: !!r?.ok, error: null });
    onSay(wrong ?? success);
    onChanged();
  };
  return (
    <li className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-sm text-foreground">
        {opp.theirs.incognito ? (
          <>Someone here is looking for what you offer.</>
        ) : (
          <>
            <span className="font-semibold">{them}</span>{" "}
            {opp.theirs.kind === "seek" ? "is seeking" : "offers"}: {opp.theirs.text}
          </>
        )}
      </p>
      {opp.reasons.length > 0 && (
        <ul className="space-y-1">
          {opp.reasons.map((r) => (
            <li key={r.index} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>· {r.text}</span>
              {r.aboutMe && (
                <button
                  type="button"
                  title="About me? Hide this sentence"
                  aria-label={`Hide this sentence about you: ${r.text}`}
                  onClick={() => act(`reasons/${r.index}/hide`, "Hidden. It no longer shows to anyone")}
                  className="inline-flex items-center gap-1 shrink-0 underline decoration-dotted"
                >
                  <EyeOff className="w-3 h-3" aria-hidden="true" />
                  about me?
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {opp.status === "opened" && opp.conversationId ? (
        <p className="text-sm">
          You both said yes.{" "}
          <Link href={`/messages/${opp.conversationId}`} className="font-semibold text-teal-deep underline">
            Open the thread
          </Link>{" "}
          and say hello in your own words.
        </p>
      ) : opp.myAccepted ? (
        <p className="text-sm text-muted-foreground">
          You said yes. Waiting for {opp.theirs.incognito ? "them" : them}.
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => act("accept", "Your yes is in")}
            className={`${TAP} px-4 rounded-lg bg-teal-deep text-white text-sm font-semibold`}
          >
            {opp.theirAccepted ? "Yes, open the thread" : "Yes, introduce us"}
          </button>
          <button
            type="button"
            onClick={() => act("decline", "Quietly closed")}
            className={`${TAP} px-4 rounded-lg border border-border text-sm`}
          >
            Not now
          </button>
        </div>
      )}
    </li>
  );
}

function PolicyLine({
  policy,
  onSave,
}: {
  policy: Policy | null;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [maxPerWeek, setMaxPerWeek] = useState(policy?.maxPerWeek ?? 2);
  const [topics, setTopics] = useState((policy?.topics ?? []).join(", "));
  useEffect(() => {
    setMaxPerWeek(policy?.maxPerWeek ?? 2);
    setTopics((policy?.topics ?? []).join(", "));
  }, [policy]);
  const paused = !!policy?.pausedUntil && new Date(policy.pausedUntil).getTime() > Date.now();
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-display text-lg font-bold text-foreground">My policy line</h2>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Introductions a week, at most</span>
        <select
          value={maxPerWeek}
          onChange={(e) => setMaxPerWeek(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-2 py-1"
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Only about these topics (empty means anything)</span>
        <input
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          placeholder="food, land"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            onSave({
              maxPerWeek,
              topics: topics.trim() ? topics.split(",").map((t) => t.trim()).filter(Boolean) : null,
            })
          }
          className={`${TAP} px-4 rounded-lg bg-teal-deep text-white text-sm font-semibold`}
        >
          Save
        </button>
        {paused ? (
          <button
            type="button"
            onClick={() => onSave({ pauseDays: null })}
            className={`${TAP} px-4 rounded-lg border border-border text-sm`}
          >
            Resume introductions
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSave({ pauseDays: 14 })}
            className={`${TAP} px-4 rounded-lg border border-border text-sm`}
          >
            Pause for two weeks
          </button>
        )}
      </div>
    </section>
  );
}

function Board({ entries }: { entries: BoardEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-display text-lg font-bold text-foreground">The board</h2>
      <ul className="space-y-2">
        {entries.map((b) => (
          <li key={b.id} className="rounded-lg border border-border px-3 py-2">
            <p className="text-sm text-foreground">
              <span className="font-semibold">
                {b.firstName ?? "A member"} {b.kind === "seek" ? "is seeking" : "offers"}:
              </span>{" "}
              {b.text}
            </p>
            {(b.why || b.topics.length > 0) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {b.why}
                {b.why && b.topics.length > 0 && " · "}
                {b.topics.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
