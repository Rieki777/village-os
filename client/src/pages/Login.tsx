import Layout from "@/components/Layout";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { useGoogleSignInReturn } from "@/components/auth/useGoogleSignInReturn";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Heart, ArrowRight, Mail, Lock } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Google sends members back to this page. The hook finishes the exchange and
  // reloads onto the destination, so the only thing this page renders for it is
  // a waiting line or a refusal.
  const googleReturn = useGoogleSignInReturn();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      // A sign-in that started on a members-only page goes back there (R36).
      // Internal paths only, so a crafted link cannot bounce anyone offsite;
      // the backslash variant is refused with the same breath.
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(
        next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
          ? next
          : "/profile",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-teal-deep/5 to-amber/5 py-16">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <div className="text-center mb-8">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-teal-deep/10 flex items-center justify-center">
                  <Heart className="w-8 h-8 text-teal-deep" />
                </div>
              </div>
              {/*
                It used to say "Welcome Back" to everybody, and `/profile` is
                linked from the footer of every public page, so the person who
                met that line most often was somebody arriving for the first
                time. A member's own words: "It welcomed me back and I had
                never been here."

                And the page cannot tell the difference. The one thing that
                counts visits is `recordVisit()` in landing.ts, which runs
                inside `LandingRoute` alone, so a visitor who follows a link
                straight to a sign-in form never increments it. There is no
                fact here to build a greeting on, so the heading says what
                the page is, which is also what the tab already says.
              */}
              <h1 className="text-4xl font-display font-bold text-teal-deep mb-2">Sign in</h1>
              <p className="text-gray-600">
                Members sign in here. If you do not have an account yet, there is a link to
                create one below.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
              {/*
                A Google round trip that failed says so here, in the same
                spoken box a failed password gets. Silence would leave a
                member staring at a sign-in form with no idea their click
                went anywhere.
              */}
              {googleReturn.status === "failed" && (
                <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {googleReturn.message}
                </div>
              )}
              {googleReturn.status === "working" && (
                <p role="status" className="text-sm text-muted-foreground">
                  Finishing your Google sign-in.
                </p>
              )}
              {/*
                role="alert" so a failed sign-in is SPOKEN. A red box that
                only appears visually leaves a screen-reader user pressing
                the same button again with no idea why nothing happened.
              */}
              {error && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
                >
                  {error}
                </motion.div>
              )}

              {/*
                htmlFor + id, so the label is ATTACHED to the field rather
                than merely sitting above it. Without the pair, a screen
                reader announces "edit text, blank" and a tap on the word
                "Email" does nothing — on the sign-in form, the one page
                every single member has to get through.
              */}
              <div>
                <label htmlFor="login-email" className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                  <input
                    id="login-email"
                    name="email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                  <input
                    id="login-password"
                    name="password"
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                    required
                  />
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={loading}
                type="submit"
                className="w-full bg-gradient-to-r from-teal-deep to-teal-deep/80 text-white font-semibold py-3 rounded-lg hover:shadow-lg transition-shadow disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Signing in..." : "Sign In"}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </motion.button>

              <p className="text-center">
                <a href="/forgot-password" className="text-sm text-teal-deep hover:underline">
                  Forgot your password?
                </a>
              </p>

              {/*
                An ADDITIONAL way in, never a replacement. The form above stays
                exactly where it was, because a village will have members with
                no Google account. On a village that configured no Google
                credentials this renders nothing at all.
              */}
              <GoogleSignInButton next={new URLSearchParams(window.location.search).get("next") ?? "/profile"} />
            </form>

            <div className="mt-8 text-center">
              <p className="text-gray-600 mb-4">Don't have an account?</p>
              <motion.a
                whileHover={{ scale: 1.05 }}
                href="/register"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-amber-ink text-amber-ink font-semibold rounded-lg hover:bg-amber-ink/5 transition-colors"
              >
                Create Account
                <ArrowRight className="w-5 h-5" />
              </motion.a>
              {/* The second way to ask to join (Rye, 2026-09-09): in a village
                  that joins by invitation, somebody here with no account and
                  no link is exactly who needs it. */}
              <p className="mt-4 text-sm text-stone-600">
                No invitation yet?{" "}
                <a href="/request-membership" className="font-semibold text-teal-deep underline underline-offset-2">
                  Ask to join
                </a>
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </Layout>
  );
}
