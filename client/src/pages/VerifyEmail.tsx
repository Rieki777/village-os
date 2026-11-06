import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { m } from "framer-motion";
import { CheckCircle2, MailCheck } from "lucide-react";
import { ShowPasswordButton } from "@/components/auth/ShowPasswordButton";
import { authToken, gameFetch } from "@/lib/gameApi";

/**
 * Confirm the address an account was made with (R104). Reached only from the
 * letter sign-up sends, carrying `?token=`.
 *
 * The link alone confirms nothing. The server also asks for this account's
 * own credential: the session this browser holds for it, or its password. A
 * letter can reach somebody whose address a stranger signed up with, and one
 * click from them must not confirm a password they never set. So a browser
 * that is signed in to the account confirms in one step, and any other
 * browser (a phone's home-screen app keeps its own storage, so the letter
 * often opens somewhere that is not signed in) asks for the password.
 */
type Stage =
  | { kind: "working" }
  | { kind: "ask_password"; error?: string }
  | { kind: "done" }
  | { kind: "already" }
  | { kind: "failed"; error: string };

export default function VerifyEmail() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const signedIn = !!authToken();
  const [stage, setStage] = useState<Stage>(token ? { kind: "working" } : { kind: "failed", error: "This link is incomplete. Open the link from your email again." });
  const [pw, setPw] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState<string>("");

  const redeem = async (password?: string) => {
    setBusy(true);
    try {
      const res = await gameFetch("/api/auth/verify-email", {
        method: "POST",
        body: JSON.stringify(password ? { token, password } : { token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setStage({ kind: "done" });
      else if (data.code === "used") setStage({ kind: "already" });
      else if (data.code === "credential_required") setStage({ kind: "ask_password" });
      else if (data.code === "wrong_password") setStage({ kind: "ask_password", error: data.error });
      else setStage({ kind: "failed", error: data.error || "That did not work. Try again." });
    } catch {
      setStage({ kind: "failed", error: "Could not reach the village. Try again." });
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!token) return;
    // Signed in here: the session is the credential, so try straight away.
    // Not signed in: there is nothing to send yet but the password.
    if (signedIn) void redeem();
    else setStage({ kind: "ask_password" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resend = async () => {
    setBusy(true);
    try {
      const res = await gameFetch("/api/auth/verify-email/send", { method: "POST", body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setResent(data.error || "That did not work. Try again.");
      else if (data.already) setStage({ kind: "already" });
      else setResent(data.emailed ? "A new link is on its way to your inbox." : "The village could not send the letter just now. Try again later.");
    } catch {
      setResent("Could not reach the village. Try again.");
    }
    setBusy(false);
  };

  return (
    <Layout>
      <section className="py-24 bg-gradient-to-b from-teal/10 to-background min-h-[70vh]">
        <div className="container">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-sm p-8"
          >
            {stage.kind === "done" || stage.kind === "already" ? (
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-teal-deep mx-auto mb-4" />
                <h1 className="font-display text-2xl font-bold text-foreground mb-2">Address confirmed</h1>
                <p className="text-muted-foreground mb-6">
                  {stage.kind === "done" ? "Thank you. This address is now confirmed as yours." : "This address was already confirmed. There is nothing more to do."}
                </p>
                <a href="/profile" className="inline-block py-3 px-6 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-teal-deep-dark transition">
                  Go to your profile
                </a>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-6">
                  <MailCheck className="w-6 h-6 text-teal-deep" />
                </div>
                <h1 className="font-display text-2xl font-bold text-foreground text-center mb-2">Confirm your address</h1>
                {stage.kind === "working" && <p className="text-sm text-muted-foreground text-center">Confirming…</p>}
                {stage.kind === "ask_password" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (pw) void redeem(pw);
                    }}
                    className="space-y-4"
                  >
                    <p className="text-sm text-muted-foreground text-center mb-4">
                      Enter the password for this account. If you did not make an account here, close this page: nothing has changed.
                    </p>
                    <label htmlFor="verify-email-password" className="sr-only">Password</label>
                    <div className="relative">
                      <input
                        id="verify-email-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="Password"
                        autoFocus
                        className="w-full pl-4 pr-12 py-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                    </div>
                    {stage.error && <p role="alert" className="text-sm text-destructive">{stage.error}</p>}
                    <button
                      type="submit"
                      disabled={busy || !pw}
                      className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-teal-deep-dark disabled:opacity-50 transition"
                    >
                      {busy ? "Confirming…" : "Confirm my address"}
                    </button>
                  </form>
                )}
                {stage.kind === "failed" && (
                  <div className="text-center space-y-4">
                    <p role="alert" className="text-sm text-destructive">{stage.error}</p>
                    {signedIn && (
                      <button
                        type="button"
                        onClick={() => void resend()}
                        disabled={busy}
                        className="py-3 px-6 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-teal-deep-dark disabled:opacity-50 transition"
                      >
                        Send me a new link
                      </button>
                    )}
                    {resent && <p className="text-sm text-muted-foreground">{resent}</p>}
                  </div>
                )}
              </>
            )}
          </m.div>
        </div>
      </section>
    </Layout>
  );
}
