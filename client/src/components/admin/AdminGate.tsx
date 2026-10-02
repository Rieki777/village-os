// ── Admin Gate (S1: admins are real users) ───────────────────────────────────
//
// The old PasswordGate probed the server with a shared password. Admins are
// member accounts with role admin|founder now, so the gate is login-aware:
// signed out → member login; signed in without the role → a clear refusal;
// admin → the member TOKEN flows into the existing `password` prop plumbing,
// which already sends `Authorization: Bearer <value>` everywhere. Renaming
// that prop across fifteen tabs is deliberate later cleanup, not S1.
//
// Moved out of client/src/pages/Admin.tsx so the card could gain its two
// other ways in (a forgotten password, and Google) without growing a file
// that sits at its line ratchet. Both are the member doors, reused: an admin
// is a member, so there is no admin-only reset and no admin-only OAuth.

import { useEffect, useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken, useGameConfig } from "@/lib/gameApi";
import BreathingLoader from "@/components/natural/BreathingLoader";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

/**
 * The sentence a refused sign-in shows, from what `login()` threw.
 *
 * The card used to answer every failure with "Wrong email or password.", and
 * two of them are not that. Once an account has spent its quarter-hour budget
 * of failed attempts the server answers 429 and refuses the RIGHT password
 * too, so a founder retrying it was told it was wrong for as long as they kept
 * trying. And a browser that will not keep a session has its own sentence in
 * signInStorage.ts, which this card swallowed. Both now arrive as written; only
 * the plain credential refusal is reworded, and it names the confusion that
 * actually brings people here: the deployment's ADMIN_PASSWORD is a one-time
 * bootstrap key for /claim, and this form never accepts it.
 */
export function signInFailure(err: unknown): string {
  // fetch rejects with a TypeError when nothing answered, and res.json() throws
  // a SyntaxError when a proxy answered with an HTML error page instead.
  if (err instanceof TypeError || err instanceof SyntaxError) {
    return "Could not reach the village. Try again in a moment.";
  }
  const said = err instanceof Error ? err.message : "";
  if (!said || said === "Invalid credentials" || said === "Login failed") {
    return "Wrong email or password. Use your own account's password here. The ADMIN_PASSWORD setting only creates the first founder, at /claim.";
  }
  return said;
}

export default function AdminGate({ onAuth }: { onAuth: (token: string) => void }) {
  const { user, loading, login, logout } = useAuth();
  // Same config the rest of the app reads its identity from (Layout.tsx and
  // every public page use this hook). Null until the fetch resolves, so
  // villageName starts blank and the heading falls back to plain "Admin"
  // rather than flashing anyone's name.
  const cfg = useGameConfig();
  const villageName = String(cfg?.project?.name ?? "").trim();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const isAdmin = !!user && (user.role === "admin" || user.role === "founder");
  // Where this admin was headed, deep link included (`?tab=modules&module=…`),
  // so the reset and the Google round trip both come back to the same screen.
  const here = `${window.location.pathname}${window.location.search}`;

  useEffect(() => {
    if (isAdmin) {
      const token = authToken();
      if (token) onAuth(token);
    }
  }, [isAdmin, onAuth]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw) return;
    setChecking(true);
    setError("");
    try {
      await login(email, pw);
      // On success the user lands in context; the effect above finishes the job
      // (or the refusal screen renders if the account isn't an admin).
    } catch (err) {
      setError(signInFailure(err));
      setPw("");
    }
    setChecking(false);
  };

  if (loading || isAdmin) {
    return (
      <div className="min-h-screen bg-teal-deep flex items-center justify-center">
        <BreathingLoader label="Opening the admin" size={56} />
      </div>
    );
  }

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-teal-deep flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">Not an admin</h1>
          <p className="text-sm text-gray-500 mb-8">
            You're signed in as <strong>{user.name}</strong>, but this account doesn't
            have admin access. Ask a founder to grant it, or sign in with an admin
            account.
          </p>
          <button
            onClick={() => logout()}
            className="w-full py-3 bg-teal-deep text-white rounded-lg font-medium hover:bg-teal-deep-dark transition-colors"
          >
            Sign out and switch accounts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-teal-deep flex items-center justify-center px-4">
      {/* px-6 under sm so "Continue with Google" keeps to one line at 375px. */}
      <div className="bg-white rounded-2xl shadow-2xl px-6 py-10 sm:px-10 w-full max-w-sm">
        <div className="w-14 h-14 rounded-full bg-teal-deep/10 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-7 h-7 text-teal-deep" />
        </div>
        <h1 className="font-display text-2xl font-bold text-center text-gray-900 mb-2">
          {villageName ? `${villageName} Admin` : "Admin"}
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          Sign in with your admin account
        </p>
        <form onSubmit={submit} className="space-y-4">
          {/*
            * `username`, not `email`, even though the field takes an address:
            * `username` is the token a password manager pairs with
            * `current-password` to recognise a sign-in form, and this is the
            * identifier half of exactly that pair. A placeholder is not a name,
            * so both fields carry one an assistive technology can read.
            */}
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="Email"
            aria-label="Email"
            autoComplete="username"
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
          />
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => { setPw(e.target.value); setError(""); }}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
            />
            {/*
              * The eye stays a 16px icon and the thing a thumb hits becomes
              * 44x44 around it, which is what the input's `pr-12` was already
              * reserving. gray-600 rather than gray-400 because this is a
              * control, and 2.6:1 was under the 3:1 a non-text control owes.
              */}
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={checking}
            className="w-full py-3 bg-teal-deep text-white rounded-lg font-medium hover:bg-teal-deep-dark disabled:opacity-60 transition-colors"
          >
            {checking ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {/*
          * The member reset, which is the admin reset: the letter's link opens
          * /set-password, and that page already sends an admin or founder to
          * /admin once the new password is set. `next` only steers the reset
          * page's "Back to sign in" here instead of to the member sign-in.
          *
          * The Google button renders nothing on a village with no Google
          * credentials, and `space-y` spaces only what renders, so that
          * village gets no gap. Google hands the member back to /login, which
          * finishes the exchange and replaces the page with `next`.
          */}
        <div className="mt-4 space-y-4">
          <p className="text-center">
            <a
              href={`/forgot-password?${new URLSearchParams({ next: here })}`}
              className="text-sm text-teal-deep hover:underline"
            >
              Forgot your password?
            </a>
          </p>
          <GoogleSignInButton next={here} />
        </div>
      </div>
    </div>
  );
}
