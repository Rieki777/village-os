import Layout from "@/components/Layout";
import { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { TOKEN_KEY } from "@/lib/gameApi";
import { writeStored } from "@/lib/safeStorage";
import { PASSWORD_SET_STORAGE_BLOCKED, sessionWriteRefused } from "@/lib/signInStorage";

/**
 * Claim an account by setting its password (S1). Reached from the founder
 * bootstrap email today; the same page becomes the password-reset landing when
 * reset emails exist. The token arrives as ?token=… and expires in an hour.
 */
export default function SetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Could not set the password");
      // The key comes from the module that owns it (client/src/lib/gameApi.ts),
      // which asks in its own comment that nothing re-type the literal. This
      // page was the one place that did, and it agreed with the constant only
      // by coincidence. The key carries a village name inside platform code, so
      // a fork's rename will reach it; the moment it does, a hand-typed copy
      // writes a key nothing reads and the member is signed out holding a
      // password that was set correctly.
      // The password IS set by the time this runs, so a blocked store here
      // used to report "the link may have expired" over a change that landed.
      // Its own sentence says the password is saved and then says what the
      // browser is doing (client/src/lib/signInStorage.ts).
      if (sessionWriteRefused(writeStored("local", TOKEN_KEY, data.token))) {
        setError(PASSWORD_SET_STORAGE_BLOCKED);
        setBusy(false);
        return;
      }
      setDone(true);
      // Admins land on the admin panel; everyone else on their profile. This
      // route is a member-reachable password reset now, and sending an
      // ordinary member to /admin lands them on a refusal screen.
      const isAdminUser = data.user?.role === "admin" || data.user?.role === "founder";
      setTimeout(() => { window.location.href = isAdminUser ? "/admin" : "/profile"; }, 1200);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. The link may have expired.");
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
            {done ? (
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-teal-deep mx-auto mb-4" />
                <h1 className="font-display text-2xl font-bold text-foreground mb-2">
                  You're in
                </h1>
                <p className="text-muted-foreground">Password set. Taking you to your dashboard…</p>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
                  <KeyRound className="w-6 h-6 text-teal-deep" />
                </div>
                <h1 className="font-display text-2xl font-bold text-foreground text-center mb-2">
                  Set your password
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-8">
                  Choose the password for your account. This link expires an hour
                  after it was sent.
                </p>
                {!token && (
                  <p className="text-sm text-destructive text-center mb-4">
                    This link is missing its token. Open the link from your email
                    again.
                  </p>
                )}
                <form onSubmit={submit} className="space-y-4">
                  {/* A placeholder is not a name: it disappears on the first
                      keystroke and a screen reader may never announce it.
                      Both fields carry a real one, plus the autocomplete
                      token that lets a password manager offer to save. */}
                  <label htmlFor="set-password-new" className="sr-only">New password</label>
                  <input
                    id="set-password-new"
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="New password (8+ characters)"
                    autoFocus
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <label htmlFor="set-password-repeat" className="sr-only">Repeat the new password</label>
                  <input
                    id="set-password-repeat"
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="Repeat it"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {/* role="alert": the only signal that a password did not
                      save. Setting a password is not optional and there is no
                      second route to it. */}
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  <button
                    type="submit"
                    disabled={busy || !token}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {busy ? "Saving…" : "Set password"}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
