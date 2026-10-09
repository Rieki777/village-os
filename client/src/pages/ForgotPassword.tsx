import Layout from "@/components/Layout";
import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, CheckCircle2 } from "lucide-react";

/**
 * Account recovery, member-side. The server answers identically whether or
 * not an account exists, so this page cannot be used to find out who is a
 * member — and the confirmation copy has to stay honest about that: it says
 * a link is on its way IF an account exists, and never claims delivery.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // "Back to sign in" returns to the door the member came from. The admin card
  // links here with `?from=admin`, and the page picks between two fixed paths,
  // so nothing from the URL ever becomes the link. Taking a `next` path here
  // was refused by CodeQL, rightly: a browser drops tabs and newlines from a
  // URL, so `/<tab>/evil.example` passes a startsWith check and lands offsite.
  const signIn = new URLSearchParams(window.location.search).get("from") === "admin" ? "/admin" : "/login";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "That didn't go through. Try again.");
      setSent(true);
    } catch (err: any) {
      setError(err?.message || "That didn't go through. Try again.");
    }
    setBusy(false);
  };

  return (
    <Layout>
      <section className="py-24 bg-gradient-to-b from-teal/10 to-background min-h-[70vh]">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-sm p-8"
          >
            {sent ? (
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-teal-deep mx-auto mb-4" />
                <h1 className="font-display text-2xl font-bold text-foreground mb-2">Check your email</h1>
                <p className="text-muted-foreground">
                  If an account exists for that address, a link to set a new password is on its
                  way. It expires in an hour and works once.
                </p>
                <a href={signIn} className="inline-block mt-6 text-teal-deep font-semibold hover:underline">
                  Back to sign in
                </a>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <Mail className="w-12 h-12 text-teal-deep mx-auto mb-4" />
                  <h1 className="font-display text-2xl font-bold text-foreground mb-2">
                    Set a new password
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    Tell us the address you signed up with and we'll send you a link.
                  </p>
                </div>
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label htmlFor="forgot-email" className="block text-sm font-medium text-foreground mb-2">
                      Email
                    </label>
                    <input
                      id="forgot-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      required
                    />
                  </div>
                  {error && (
                    <p role="alert" className="text-sm text-red-600">
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-gradient-to-r from-teal-deep to-teal-deep/80 text-white font-semibold py-3 rounded-lg hover:shadow-lg transition-shadow disabled:opacity-50"
                  >
                    {busy ? "Sending…" : "Send the link"}
                  </button>
                </form>
                <div className="mt-6 text-center">
                  <a href={signIn} className="text-sm text-teal-deep hover:underline">
                    Back to sign in
                  </a>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
