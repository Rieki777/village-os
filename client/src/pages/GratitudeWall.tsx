import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch, fetchGameMe, GameMe } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Heart, Send, Sparkles } from "lucide-react";
import CycleClock from "@/components/CycleClock";
import { forgetExamplesCache } from "@/components/ExamplesBanner";
import InfoTip from "@/components/InfoTip";

interface WallEntry {
  id: string;
  from: string;
  to: string;
  message: string;
  at: string;
}

export default function GratitudeWall() {
  const { user } = useAuth();
  const [wall, setWall] = useState<WallEntry[]>([]);
  // undefined = not loaded (or the load failed); null = loaded, no game state.
  // fetchGameMe returns null for BOTH a 500 and a real absence, so without
  // this distinction a failed fetch rendered as a factual claim about the
  // member's standing ("your budget unlocks as you progress") when in truth
  // they may have had a full budget all along.
  const [me, setMe] = useState<GameMe | null | undefined>(undefined);
  const currency = useTokenName("Recognition");
  // `to` carries whatever the member typed: an @handle, or an address for
  // anyone who still knows one. The server tells the two apart and looks the
  // handle up; see `recipientFor` in server/index.ts for why a handle is the
  // one of the two a member can actually obtain.
  const [form, setForm] = useState({ to: "", amount: 10, message: "" });
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    fetch("/api/game/gratitude/wall")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setWall(Array.isArray(d) ? d : []))
      .catch(() => { /* silent */ });
    fetchGameMe().then(setMe);
  };

  useEffect(load, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setFeedback(null);
    try {
      const res = await gameFetch("/api/game/gratitude/send", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.message ?? data.error ?? "Something went wrong" });
      } else {
        setFeedback({ ok: true, text: "Your appreciation is on the wall." });
        setForm({ to: "", amount: 10, message: "" });
        // A real send is gratitude's retirement trigger server-side. The
        // stock seed writes no gratitude rows, so today this drops nothing;
        // it is here so a fork that seeds some is not left with a stale
        // label, and the helper no-ops when the module was not showing any.
        forgetExamplesCache("gratitude");
        load();
      }
    } catch {
      setFeedback({ ok: false, text: "Something went wrong. Try again." });
    }
    setSending(false);
  };

  const budget = me?.gratitude.budget;

  return (
    <Layout>
      <section className="bg-teal-deep text-white py-16">
        <div className="container max-w-3xl mx-auto px-4 text-center">
          <Heart className="w-8 h-8 text-amber mx-auto mb-3" />
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">
            The {currency} Wall
          </h1>
          {/* R46 enchant-first: the cadence question (month against lunar
              cycle, founder flag 10) leaves the surface line entirely; the
              tooltip says "each cycle", which is true under any config. */}
          <p className="text-white/80 max-w-xl mx-auto">
            Appreciation, spoken out loud. Naming what is good is how the
            village grows more of it, and every thanks on this wall becomes{" "}
            <InfoTip tip={`Each cycle every member receives a budget of ${currency.toLowerCase()} to send. Sending is thanks for real contributions, never pay, and the wall keeps every word.`}>{currency.toLowerCase()}</InfoTip>{" "}
            in the hands of the member it names.
          </p>
        </div>
      </section>

      <section className="bg-stone-50 py-14">
        <div className="container max-w-2xl mx-auto px-4">
          {/* The clock the economy runs on: lunation, season, the four turnings. */}
          <div className="mb-10"><CycleClock /></div>
          {user ? (
            <form onSubmit={send} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-xl font-bold text-teal-deep">Send {currency.toLowerCase()}</h2>
                {budget && budget.total > 0 ? (
                  <span className="text-sm text-stone-500">
                    <span className="font-semibold text-teal-deep">{budget.remaining}</span> / {budget.total} left this cycle
                    <InfoTip tip="Your sending budget refills when the cycle turns. Sending moves it from your budget to their wall; it never costs you anything you earned." label="How the budget works" />
                  </span>
                ) : budget && budget.total <= 0 ? (
                  <span className="text-xs text-stone-400 italic">Your sending budget unlocks as you progress</span>
                ) : (
                  <span className="text-xs text-stone-400 italic">We couldn't load your budget, reload to see it</span>
                )}
              </div>
              <div className="grid md:grid-cols-[1fr_110px] gap-3 mb-3">
                <input
                  // type="text", and that IS the fix. `type="email"` made the
                  // browser refuse a handle before the form could be sent, so
                  // the field could only take the one thing this site never
                  // shows anybody.
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  aria-label="Who you are thanking, by handle"
                  placeholder="Their @handle"
                  className="px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                />
                <input
                  type="number"
                  min={1}
                  required
                  // Derived from the live currency name, not hardcoded: a fork
                  // that renames its recognition token gets the right label.
                  aria-label={`Amount of ${currency.toLowerCase()} to send`}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: parseInt(e.target.value) || 1 })}
                  className="px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep"
                />
              </div>
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="What are you thanking them for?"
                rows={2}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-teal-deep resize-y mb-3"
              />
              {feedback && (
                <p
                  // Announced, not merely displayed: the result of a submit is
                  // the one thing a screen-reader user must not have to go
                  // hunting for. alert (assertive) for a failure, status for a
                  // success — never on anything that re-renders per keystroke.
                  role={feedback.ok ? "status" : "alert"}
                  className={`text-sm mb-3 ${feedback.ok ? "text-teal-deep" : "text-red-600"}`}
                >
                  {feedback.text}
                </p>
              )}
              {/* A spent budget is a real state, not an error to discover
                  after clicking: say so, and stop offering the button. */}
              {budget && budget.remaining <= 0 && budget.total > 0 && (
                <p className="text-sm text-amber-700 mb-3">
                  You've given your whole budget this cycle. It refills when the lunar cycle turns.
                </p>
              )}
              {/* An UNKNOWN budget no longer disables Send: the server's own
                  guard is the authority on whether a send is allowed, and
                  refusing locally on a failed fetch told the member a lie
                  about their standing. Paired with the explicit "couldn't
                  load" caption above, so the state is never silent. */}
              <button
                type="submit"
                disabled={sending || (!!budget && (budget.total <= 0 || budget.remaining <= 0))}
                className="inline-flex items-center gap-2 bg-teal-deep text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-teal disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" /> {sending ? "Sending..." : "Send"}
              </button>
            </form>
          ) : (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-10 text-center">
              <p className="text-stone-600 mb-4">Sign in to send {currency.toLowerCase()} to a fellow member.</p>
              <Link href="/login" className="inline-flex items-center gap-2 bg-teal-deep text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-teal transition-colors">
                Sign In
              </Link>
            </div>
          )}

          {wall.length === 0 ? (
            <div className="text-center py-14 text-stone-500">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>The wall is waiting for its first appreciation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {wall.map((w) => (
                <div key={w.id} className="bg-white rounded-2xl border border-stone-200 shadow-sm px-5 py-4">
                  <p className="text-stone-700 leading-relaxed mb-2">"{w.message}"</p>
                  <p className="text-xs text-stone-400">
                    <span className="font-semibold text-teal-deep">{w.from}</span> to{" "}
                    <span className="font-semibold text-teal-deep">{w.to}</span> ·{" "}
                    {new Date(w.at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
