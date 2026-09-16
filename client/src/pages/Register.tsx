import Layout from "@/components/Layout";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { fetchSignInMethods } from "@/components/auth/signInMethods";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Heart, ArrowRight, Mail, Lock, User, CheckCircle2, Circle, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useVillageName } from "@/hooks/useVillageName";

// Parameterised the way HowWeCreate.tsx parameterises its recognition cards:
// the copy names the village, so the list has to be built after the config
// answers rather than frozen at module load.
const paths = (villageName: string) => [
  {
    id: "investor",
    label: "Investor",
    description: `Support ${villageName}'s vision through financial investment`,
    // text-amber-ink, not text-amber: --color-amber is derived only to carry
    // ink AS a background chip, never checked as small foreground text on a
    // light surface. This pill measured 1.43:1 with text-amber; amber-ink
    // (index.css) measures 4.90:1 in the same spot. See index.css for the
    // full measurement.
    color: "bg-amber/10 border-amber/30 text-amber-ink hover:bg-amber/20",
  },
  {
    id: "steward",
    label: "Village Steward",
    description: "Help govern and guide our community's evolution",
    // text-sage is already a static, measured-safe foreground colour
    // (5.21:1 on this pill's tint) - unchanged.
    color: "bg-sage/10 border-sage/30 text-sage hover:bg-sage/20",
  },
  {
    id: "resident",
    label: "Resident",
    description: `Make ${villageName} your home and live the village vision`,
    // text-teal-deep, not text-teal (brand-soft): brand-soft is a decorative
    // tint, never checked as foreground text. text-teal measured 2.33:1 here.
    // teal-deep is safe by construction instead: shared/brandTokens.ts
    // enforces contrastRatio(white, brand) >= 4.5 for every seed, and
    // contrast is symmetric, so contrastRatio(brand, white) clears the same
    // floor - proven down to 4.50:1 worst case across all 54 card x seed
    // combinations in CHARACTER_CARDS, not just the neutral default (9.59:1
    // here). See index.css for the neutral-default measurement.
    color: "bg-teal/10 border-teal/30 text-teal-deep hover:bg-teal/20",
  },
  {
    id: "prosperity-creator",
    label: "Prosperity Creator",
    description: "Build businesses and enterprises that thrive",
    // Same fix as "resident": text-teal-light (brand-mid) measured 4.20:1,
    // below AA. text-teal-deep is safe by construction (see above), 9.18:1
    // in this specific tint under the neutral default.
    color: "bg-teal-light/10 border-teal-light/30 text-teal-deep hover:bg-teal-light/20",
  },
];

/** What the server said about the invitation link this page was opened with. */
interface InviteCheck {
  valid: boolean;
  invitedBy?: string | null;
  daysLeft?: number;
  error?: string;
}

/** The `?invite=` token, read once. Empty when the page was opened without one. */
function inviteFromAddress(): string {
  try {
    return new URLSearchParams(window.location.search).get("invite")?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * JOINING BY INVITATION, where the form would be (Rye, 2026-09-09).
 *
 * Somebody with no working link is told how people arrive here, and given the
 * two ways forward the ruling names: ask to join, and come to a community call
 * or an event. It sits on the same fixed light card as the form it stands in
 * for, with the page's own measured inks, so it reads the same in either theme.
 */
function InvitationNeeded({ villageName, reason }: { villageName: string; reason?: string }) {
  return (
    <section aria-labelledby="invitation-needed" className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
      {reason && (
        <p role="alert" className="p-4 bg-amber/10 border border-amber/30 rounded-lg text-amber-ink text-sm">
          {reason}
        </p>
      )}
      <h2 id="invitation-needed" className="text-2xl font-display font-bold text-teal-deep">
        Joining {villageName} is by invitation
      </h2>
      <p className="text-stone-600">
        Everybody here arrives because somebody already in the village knows them. If a member has sent you an
        invitation link, open that link to make your account.
      </p>
      <p className="text-stone-600">
        No link yet? Ask to join, and someone from the village will be in touch. Coming to a community call or an
        event is the best way to get to know us.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a
          href="/request-membership"
          className="inline-flex min-h-11 items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-deep to-teal-deep/80 text-white font-semibold rounded-lg hover:shadow-lg transition-shadow"
        >
          Ask to join
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </a>
        <a
          href="/events"
          className="inline-flex min-h-11 items-center justify-center gap-2 px-6 py-3 border-2 border-amber-ink text-amber-ink font-semibold rounded-lg hover:bg-amber-ink/5 transition-colors"
        >
          <CalendarDays className="w-5 h-5" aria-hidden="true" />
          See calls and events
        </a>
      </div>
    </section>
  );
}

export default function Register() {
  const villageName = useVillageName();
  const PATHS = paths(villageName);
  const [, navigate] = useLocation();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /*
   * THE INVITATION (Rye, 2026-09-09: "all members are by invitation").
   *
   * The form waits for the village's answer, because a form that appears and
   * then gives way to "joining is by invitation" is the page contradicting
   * itself. A failed read answers open (signInMethods.ts says why), so a blip
   * never costs somebody the form, and the server refuses an uninvited account
   * with its own sentence either way.
   */
  const [invite] = useState(inviteFromAddress);
  const [inviteOnly, setInviteOnly] = useState<boolean | null>(null);
  const [check, setCheck] = useState<InviteCheck | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchSignInMethods().then((m) => {
      if (alive) setInviteOnly(m.inviteOnly);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!invite) return;
    let alive = true;
    fetch(`/api/invites/check?token=${encodeURIComponent(invite)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (alive) setCheck(d as InviteCheck);
      })
      .catch(() => {
        // A link that could not be checked is not a link that was refused. The
        // form is offered, and the server says what is wrong if anything is.
        if (alive) setCheck({ valid: true });
      });
    return () => {
      alive = false;
    };
  }, [invite]);

  /** Still asking, so the page draws neither the form nor the invitation panel. */
  const deciding = inviteOnly === null || (invite !== "" && check === null);
  /** The link that opened this page works, as far as the server has said. */
  const goodLink = invite !== "" && check?.valid === true;
  /** Nobody makes an account here without a link, and this page has no working one. */
  const heldAtTheDoor = !deciding && inviteOnly === true && !goodLink;

  function togglePath(pathId: string) {
    setSelectedPaths((prev) =>
      prev.includes(pathId) ? prev.filter((p) => p !== pathId) : [...prev, pathId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (selectedPaths.length === 0) {
      setError("Please select at least one path");
      return;
    }

    setLoading(true);
    try {
      if (goodLink) await register(name, email, password, selectedPaths, invite);
      else await register(name, email, password, selectedPaths);
      // Straight into the class select, skippable. Somebody who has just
      // signed up is the one moment they are most willing to say who they
      // want to be, and the one moment a form they cannot leave would be
      // worst. `first` only changes the copy and adds the way out.
      navigate("/profile/characters?first=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-teal-deep/5 to-amber/5 py-16">
        <div className="container max-w-2xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-12">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-teal-deep/10 flex items-center justify-center">
                  <Heart className="w-8 h-8 text-teal-deep" />
                </div>
              </div>
              <h1 className="text-4xl font-display font-bold text-teal-deep mb-2">
                Join {villageName}
              </h1>
              <p className="text-gray-600">Begin your village journey and choose your path</p>
            </div>

            {deciding ? (
              <p aria-live="polite" className="text-center text-stone-600">
                Checking how to join...
              </p>
            ) : heldAtTheDoor ? (
              <InvitationNeeded villageName={villageName} reason={invite ? check?.error : undefined} />
            ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-8 space-y-8">
              {goodLink && (
                <p className="p-4 bg-teal-deep/5 border border-teal-deep/20 rounded-lg text-teal-deep text-sm">
                  {check?.invitedBy ? `${check.invitedBy} invited you. ` : "You were invited. "}
                  This link makes one account, and it works for {check?.daysLeft ?? 0} more{" "}
                  {check?.daysLeft === 1 ? "day" : "days"}.
                </p>
              )}
              {invite !== "" && check?.valid === false && check.error && (
                <p className="p-4 bg-amber/10 border border-amber/30 rounded-lg text-amber-ink text-sm">
                  {check.error} This village is open, so you can still make an account here.
                </p>
              )}
              {/*
                role="alert", the same as Login.tsx's matching box. All three
                things that land here are refusals of a submit the member just
                pressed - the passwords not matching, no path chosen, and a
                registration the server turned down - and without the role a
                screen reader says nothing at all: the button appears to do
                nothing and the only account-creation form on the site becomes
                a dead end. The box is CONDITIONALLY RENDERED, so the role
                arrives with the text rather than sitting in an empty region.
                That is the same shape Login.tsx uses and it announces,
                because the mount happens well after first paint, in response
                to a press.
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

              <div className="space-y-6">
                <div>
                  {/* htmlFor + id on every field here. The labels were plain
                      text sitting above unlinked inputs, so a screen reader
                      announced four controls with no names, and iOS offered no
                      Keychain suggestion on the one form where a saved
                      password matters most. */}
                  <label htmlFor="register-name" className="block text-sm font-semibold text-gray-700 mb-2">Name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                    <input
                      id="register-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-email" className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                    <input
                      id="register-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-password" className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                    <input
                      id="register-password"
                      name="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-confirm" className="block text-sm font-semibold text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" aria-hidden="true" />
                    <input
                      id="register-confirm"
                      name="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      required
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-4">
                  Choose Your Path(s)
                </label>
                <div className="grid gap-3">
                  {PATHS.map((path) => (
                    <motion.button
                      key={path.id}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => togglePath(path.id)}
                      className={`p-4 border-2 rounded-lg text-left transition-all ${
                        selectedPaths.includes(path.id)
                          ? `${path.color} border-current`
                          : "bg-gray-50 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {selectedPaths.includes(path.id) ? (
                          <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0 text-teal-deep" />
                        ) : (
                          <Circle className="w-5 h-5 mt-0.5 flex-shrink-0 text-gray-400" />
                        )}
                        <div>
                          <p className="font-semibold text-gray-900">{path.label}</p>
                          <p className="text-sm text-gray-600">{path.description}</p>
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={loading}
                type="submit"
                className="w-full bg-gradient-to-r from-teal-deep to-teal-deep/80 text-white font-semibold py-3 rounded-lg hover:shadow-lg transition-shadow disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? "Creating Account..." : "Create Account"}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </motion.button>

              {/*
                Joining with Google, beside the form and never in place of it.
                A member with no Google account fills in the fields above, the
                way they always have. On a village with no Google credentials
                this renders nothing.
              */}
              {/*
                THE SAME FIRST RUN AS THE FORM ABOVE IT.

                This sent Google sign-ups straight to /profile while the email
                form sent everybody to the character select, so two people who
                joined the same day had had materially different first runs and
                every surface downstream that assumed a character was chosen
                was wrong for one of them.

                It lands everybody on the same page because somebody on the
                REGISTER page is registering. A returning member who uses this
                door instead of Login sees their own party once, which costs
                them a click and tells them nothing untrue.

                The invitation rides along when the link works, so an account
                made by Google carries the same vouch as one made by the form.
              */}
              <GoogleSignInButton
                label="Continue with Google"
                next="/profile/characters?first=1"
                invite={goodLink ? invite : undefined}
              />
            </form>
            )}

            <div className="mt-8 text-center">
              <p className="text-gray-600 mb-4">Already have an account?</p>
              <motion.a
                whileHover={{ scale: 1.05 }}
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 border-2 border-amber-ink text-amber-ink font-semibold rounded-lg hover:bg-amber-ink/5 transition-colors"
              >
                Sign In
                <ArrowRight className="w-5 h-5" />
              </motion.a>
            </div>
          </motion.div>
        </div>
      </div>
    </Layout>
  );
}
