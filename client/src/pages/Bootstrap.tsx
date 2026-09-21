import Layout from "@/components/Layout";
import { KeyRound, ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";

/**
 * The founder's way in on day one, and the way back in after a lockout.
 *
 * WHY THIS PAGE EXISTS. `POST /api/admin/bootstrap` is the only route that can
 * create a village's first founder, and until now the only way to call it was a
 * shell. That stranded the one person who can do anything, twice: once for an
 * operator who read `emailed: true` on a deployment with no mail provider, and
 * once for this deployment's own founder, who never set a password and so fell
 * into the gap `forgot-password` leaves open (server/index.ts:8613 sends only
 * when `user.passwordHash` already exists, so an account that never had one
 * gets the reassuring same-answer and no email, forever).
 *
 * Thirteen villages are about to do this for the first time, on their own
 * hardware, without anyone in the room. A curl command in a runbook is not a
 * product. This is.
 *
 * WHAT IT DOES NOT DO. It does not store the bootstrap password, does not put
 * it in a URL, and does not send it anywhere except the one endpoint that has
 * to check it. The server answers with a claim link rather than a session, so
 * the founder's real credential is set by them, on their own device, and never
 * travels through an operator or through us.
 *
 * The page is deliberately blunt about failure. Every refusal this endpoint can
 * return means something specific and actionable, and answering all of them
 * with "something went wrong" is how the last two lockouts lasted days.
 */
export default function Bootstrap() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [claimUrl, setClaimUrl] = useState("");
  const [note, setNote] = useState("");
  const [emailed, setEmailed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setHint("");
    setClaimUrl("");
    setNote("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (!res.ok) {
        setError(String(data?.error ?? `The server answered ${res.status}.`));
        // Each refusal has one cause and one next step. Saying which is the
        // whole point of this page.
        if (res.status === 503) {
          setHint(
            "This deployment has no bootstrap password set. Add ADMIN_PASSWORD to the environment " +
              "with a value of your own, redeploy, and come back to this page.",
          );
        } else if (res.status === 401) {
          setHint(
            "That is not this deployment's bootstrap password. It is the ADMIN_PASSWORD variable " +
              "in your hosting environment, not your account password and not the shared word from " +
              "any other village.",
          );
        } else if (res.status === 403) {
          setHint(
            "This village already has a founder, so the shared password has spent its power. To " +
              "recover an account you have lost, set BREAK_GLASS_ADMIN_EMAIL in the environment to " +
              "the address you are typing above, redeploy, and try once more.",
          );
        } else if (res.status === 409) {
          setHint(
            "That address belongs to a standing example identity, which can never sign in. Use a " +
              "real address of your own.",
          );
        } else if (res.status === 429) {
          setHint("Five attempts an hour, per address. Wait a little and try again.");
        }
        return;
      }

      // The server tells the truth about whether mail actually left, because a
      // deployment with no mail provider is the state every new village boots
      // in, and a bare `emailed: true` is what stranded an operator for two
      // days.
      setEmailed(Boolean(data?.emailed));
      if (typeof data?.claimUrl === "string") setClaimUrl(data.claimUrl);
      if (typeof data?.emailNote === "string" && data.emailNote) setNote(data.emailNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request did not reach the server.");
      setHint("Check that the village is running and that you are on the right address.");
    } finally {
      setLoading(false);
    }
  }

  const done = Boolean(claimUrl) || emailed;

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-teal-deep/5 to-amber/5 py-16">
        <div className="mx-auto w-full max-w-lg px-4">
          <div className="rounded-2xl bg-white p-8 shadow-lg">
            <div className="mb-6 flex flex-col items-center text-center">
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-deep/10">
                <KeyRound className="h-6 w-6 text-teal-deep" aria-hidden="true" />
              </span>
              <h1 className="text-2xl font-bold text-amber-ink">Claim this village</h1>
              <p className="mt-2 text-sm text-amber-ink/70">
                For the first founder of a new village, and for a founder who has lost their way
                back in.
              </p>
            </div>

            {done ? (
              <div className="space-y-4" role="status">
                <div className="rounded-lg bg-teal-deep/5 p-4">
                  <p className="flex items-start gap-2 text-sm font-medium text-teal-deep">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>You are this village&rsquo;s founder. One step left: set a password.</span>
                  </p>
                </div>

                {emailed && (
                  <p className="text-sm text-amber-ink/80">
                    A link is on its way to <strong>{email}</strong>. It expires in an hour and
                    works once.
                  </p>
                )}

                {note && (
                  <div className="rounded-lg bg-amber/10 p-4">
                    <p className="text-sm text-amber-ink/90">{note}</p>
                  </div>
                )}

                {claimUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-ink">
                      Open this now, on this device:
                    </p>
                    <a
                      href={claimUrl}
                      className="block break-all rounded-lg bg-amber-ink/5 p-3 text-sm text-teal-deep underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep"
                    >
                      {claimUrl}
                    </a>
                    <p className="text-xs text-amber-ink/60">
                      It expires in an hour and works once. If it expires, come back to this page
                      and run it again.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="bootstrap-email"
                    className="mb-1.5 block text-sm font-medium text-amber-ink"
                  >
                    Your email
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-ink/40"
                      aria-hidden="true"
                    />
                    <input
                      id="bootstrap-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-amber-ink/15 py-2.5 pl-9 pr-3 text-amber-ink focus:border-teal-deep focus:outline-none focus:ring-2 focus:ring-teal-deep/20"
                      placeholder="you@example.com"
                    />
                  </div>
                  <p className="mt-1 text-xs text-amber-ink/60">
                    The address that becomes this village&rsquo;s founder. If you already have an
                    account here, use that address. The existing account is promoted in place.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="bootstrap-name"
                    className="mb-1.5 block text-sm font-medium text-amber-ink"
                  >
                    Your name <span className="font-normal text-amber-ink/50">(optional)</span>
                  </label>
                  <input
                    id="bootstrap-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-amber-ink/15 px-3 py-2.5 text-amber-ink focus:border-teal-deep focus:outline-none focus:ring-2 focus:ring-teal-deep/20"
                    placeholder="How the village should greet you"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bootstrap-password"
                    className="mb-1.5 block text-sm font-medium text-amber-ink"
                  >
                    This village&rsquo;s bootstrap password
                  </label>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-ink/40"
                      aria-hidden="true"
                    />
                    <input
                      id="bootstrap-password"
                      type="password"
                      required
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-amber-ink/15 py-2.5 pl-9 pr-3 text-amber-ink focus:border-teal-deep focus:outline-none focus:ring-2 focus:ring-teal-deep/20"
                      placeholder="From your hosting environment"
                    />
                  </div>
                  <p className="mt-1 text-xs text-amber-ink/60">
                    This is the <code className="font-mono">ADMIN_PASSWORD</code> variable where
                    this village is hosted, not your account password. It is never stored here and
                    never appears in a link.
                  </p>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 p-4" role="alert">
                    <p className="text-sm font-medium text-red-800">{error}</p>
                    {hint && <p className="mt-1.5 text-sm text-red-800/85">{hint}</p>}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-deep py-3 font-medium text-white transition hover:bg-teal-deep-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep disabled:opacity-60"
                >
                  {loading ? "Checking..." : "Claim this village"}
                  {!loading && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-amber-ink/60">
            This page only ever creates the first founder, or recovers the account named in
            BREAK_GLASS_ADMIN_EMAIL. Once a village has a founder, the shared password stops
            authenticating anyone.
          </p>
        </div>
      </div>
    </Layout>
  );
}
