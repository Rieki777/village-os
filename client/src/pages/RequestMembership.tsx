/**
 * ASK TO JOIN.
 *
 * Rye's ruling, 2026-09-09: somebody without an invitation "can look around at
 * everything but the sign in process is gated by them making a request for
 * membership that then sits in admin for a team to then talk to these people,
 * they're directed to the community calls/events page to get to know the
 * community more."
 *
 * The request lands in the admin submissions queue as `membership-request`,
 * beside everything else a stranger sends, where whoever works the queue can
 * write back. Sending it makes no account and grants nothing, and the page says
 * where to go next rather than leaving somebody at a thank-you with nowhere to
 * stand.
 *
 * The honeypot is `hp`, the house pattern. ReserveHome.tsx says why the name
 * matters.
 */
import { useState } from "react";
import { ArrowRight, CalendarDays, HeartHandshake } from "lucide-react";

import Layout from "@/components/Layout";
import { useVillageName } from "@/hooks/useVillageName";

const FIELD =
  "w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function RequestMembership() {
  const villageName = useVillageName();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [why, setWhy] = useState("");
  const [heardFrom, setHeardFrom] = useState("");
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "membership-request",
          hp,
          data: { name: name.trim(), email: email.trim(), why: why.trim(), heardFrom: heardFrom.trim() },
        }),
      });
      if (res.status === 429) {
        setError("Too many requests from this connection. Wait a few minutes and try again.");
        return;
      }
      if (!res.ok) {
        setError("That did not send. Try again in a moment.");
        return;
      }
      setSent(true);
    } catch {
      setError("That did not send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const firstName = name.trim().split(/\s+/)[0] ?? "";

  return (
    <Layout>
      <div className="min-h-screen bg-background py-16">
        <div className="container max-w-2xl">
          {sent ? (
            <section aria-live="polite" className="rounded-2xl border border-border bg-card p-8 shadow-sm">
              <HeartHandshake className="h-8 w-8 text-notice" aria-hidden="true" />
              <h1 className="mt-4 font-display text-3xl font-bold text-card-foreground">
                Thank you{firstName ? `, ${firstName}` : ""}.
              </h1>
              <p className="mt-3 text-muted-foreground">
                Your request is with the people who look after joining {villageName}. Someone will write to you at{" "}
                <span className="font-medium text-card-foreground break-words">{email.trim()}</span>.
              </p>
              <p className="mt-3 text-muted-foreground">
                The best way to get to know the village while you wait is to come along to a community call or an event.
              </p>
              <a
                href="/events"
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarDays className="h-5 w-5" aria-hidden="true" />
                See calls and events
              </a>
            </section>
          ) : (
            <>
              <div className="mb-8">
                <h1 className="font-display text-4xl font-bold text-foreground">Ask to join {villageName}</h1>
                <p className="mt-3 text-muted-foreground">
                  Everybody here arrives because somebody already in the village knows them. If nobody has invited you
                  yet, tell us a little about yourself and someone will be in touch.
                </p>
                <p className="mt-3 text-muted-foreground">
                  Already have an invitation link? Open it, and it takes you straight to making your account.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
                {error && (
                  <p role="alert" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
                    {error}
                  </p>
                )}
                <div>
                  <label htmlFor="request-name" className="mb-2 block text-sm font-semibold text-card-foreground">
                    Name
                  </label>
                  <input
                    id="request-name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="request-email" className="mb-2 block text-sm font-semibold text-card-foreground">
                    Email
                  </label>
                  <input
                    id="request-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="request-why" className="mb-2 block text-sm font-semibold text-card-foreground">
                    What draws you to {villageName}?
                  </label>
                  <textarea
                    id="request-why"
                    name="why"
                    required
                    rows={5}
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="request-heard" className="mb-2 block text-sm font-semibold text-card-foreground">
                    How did you hear about us? <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    id="request-heard"
                    name="heard-from"
                    value={heardFrom}
                    onChange={(e) => setHeardFrom(e.target.value)}
                    className={FIELD}
                  />
                </div>
                {/* The honeypot. Named `hp` so no autofill heuristic fills it; see ReserveHome.tsx. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: 0 }}>
                  <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
                </div>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send my request"}
                  {!sending && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
                </button>
              </form>

              <p className="mt-6 text-center text-muted-foreground">
                Want to meet us first?{" "}
                <a href="/events" className="font-medium text-foreground underline underline-offset-2">
                  Come to a community call or an event
                </a>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
