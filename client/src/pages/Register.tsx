import Layout from "@/components/Layout";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { fetchSignInMethods } from "@/components/auth/signInMethods";
import { useAuth } from "@/contexts/AuthContext";
import { m } from "framer-motion";
import { Heart, ArrowRight, Mail, Lock, User, CheckCircle2, Circle, CalendarDays } from "lucide-react";
import { BTN_NOTICE, BTN_PRIMARY, CARD, FIELD, H1, H2, HINT, LABEL, LEDE, RING, TILE, WORLD } from "@/components/journey/look";
import { useEffect, useState } from "react";
import { ShowPasswordButton } from "@/components/auth/ShowPasswordButton";
import { useLocation } from "wouter";
import { useVillageName } from "@/hooks/useVillageName";
import { useVillagePaths } from "@/hooks/useVillagePaths";
import { ACCOUNT_WORDS, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@shared/accountRules";
import { andList } from "@shared/openProposals";
import { useLingui } from "@lingui/react/macro";

/** What the server said about the invitation link this page was opened with. */
interface InviteCheck {
  valid: boolean;
  invitedBy?: string | null;
  daysLeft?: number;
  error?: string;
  /** An adopted application's link: the roles it places you on, and what you sent (role audit, 10 Nov 2026). */
  forRoles?: string[];
  name?: string | null;
  email?: string | null;
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
 * or an event. It sits on the same panel as the form it stands in for.
 */
function InvitationNeeded({ villageName, reason }: { villageName: string; reason?: string }) {
  return (
    <section aria-labelledby="invitation-needed" className={`${CARD} space-y-5`}>
      {reason && (
        <p role="alert" className="rounded-xl border border-notice/60 bg-muted p-4 text-sm text-foreground">
          {reason}
        </p>
      )}
      <h2 id="invitation-needed" className={H2}>
        You need an invitation to join {villageName}
      </h2>
      <p className={LEDE}>
        Got an invitation link? Open it to create your account.
      </p>
      <p className={LEDE}>
        No link yet? Ask to join, and someone from the village will reach out. A community call is a good
        first step.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a
          href="/request-membership"
          className={BTN_PRIMARY}
        >
          Ask to join
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </a>
        <a
          href="/events"
          className={BTN_NOTICE}
        >
          <CalendarDays className="w-5 h-5" aria-hidden="true" />
          See calls and events
        </a>
      </div>
    </section>
  );
}

export default function Register() {
  const { t } = useLingui();
  const villageName = useVillageName();
  // Null until the village's words have arrived, so the choice paints once,
  // in this village's own names.
  const PATHS = useVillagePaths();
  const [, navigate] = useLocation();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        if (!alive) return;
        const c = d as InviteCheck;
        setCheck(c);
        // The application's own name and address carry forward; whatever was typed already stays.
        if (c.valid && c.name) setName((now) => now || String(c.name));
        if (c.valid && c.email) setEmail((now) => now || String(c.email));
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

  /** The roles an adopted application's link places the person on, as one phrase. */
  const forRoles = andList(check?.forRoles ?? []);

  /** Still asking, so the page draws neither the form nor the invitation panel. */
  const deciding = inviteOnly === null || (invite !== "" && check === null);
  /** The link that opened this page works, as far as the server has said. */
  const goodLink = invite !== "" && check?.valid === true;
  /** Nobody makes an account here without a link, and this page has no working one. */
  const heldAtTheDoor = !deciding && inviteOnly === true && !goodLink;

  // An adopted application is joining to hold roles: the steward's path is already the answer, and
  // stays a choice the person can change (role audit, 10 Nov 2026).
  const adoptedForRoles = goodLink && (check?.forRoles?.length ?? 0) > 0;
  /** The steward path is the answer, so the picker is not drawn (audit M7). Only when this village has that path to send. */
  const skipPicker = adoptedForRoles && !!PATHS?.some((p) => p.id === "steward");
  /** Where a new account lands: a holder is asked their steps on the profile, and everybody else picks a character first. */
  const landing = adoptedForRoles ? "/profile" : "/profile/characters?first=1";
  useEffect(() => {
    if (!adoptedForRoles || !PATHS?.some((p) => p.id === "steward")) return;
    setSelectedPaths((prev) => (prev.length ? prev : ["steward"]));
  }, [adoptedForRoles, PATHS]);

  function togglePath(pathId: string) {
    setSelectedPaths((prev) =>
      prev.includes(pathId) ? prev.filter((p) => p !== pathId) : [...prev, pathId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // The server's own rules (shared/accountRules.ts), said before anything is sent.
    if (password.trim().length < PASSWORD_MIN) {
      setError(ACCOUNT_WORDS.passwordShort);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    const chosenPaths = skipPicker ? ["steward"] : selectedPaths;
    if (chosenPaths.length === 0) {
      setError("Choose a path to continue.");
      return;
    }

    setLoading(true);
    try {
      if (goodLink) await register(name, email, password, chosenPaths, invite);
      else await register(name, email, password, chosenPaths);
      // Straight into the class select, skippable. Somebody who has just
      // signed up is the one moment they are most willing to say who they
      // want to be, and the one moment a form they cannot leave would be
      // worst. `first` only changes the copy and adds the way out.
      navigate(landing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't create your account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <div className={`${WORLD} py-16`}>
        <div className="container max-w-2xl">
          <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-12">
              <div className="flex justify-center mb-4">
                <div className={`${RING} size-16`}>
                  <Heart className="size-7" aria-hidden="true" />
                </div>
              </div>
              <h1 className={`${H1} mb-2`}>
                Join {villageName}
              </h1>
              {/* R47: only the reader who can act on it sees it. Somebody held
                  at the door needs an invitation first, and the card says so. */}
              {!deciding && !heldAtTheDoor && (
                <p className={LEDE + " mx-auto"}>{skipPicker ? "Create your account. Your first steps are waiting on your profile." : "Create your account and choose your path."}</p>
              )}
            </div>

            {deciding ? (
              <p aria-live="polite" className={`${HINT} text-center`}>
                Checking how to join...
              </p>
            ) : heldAtTheDoor ? (
              <InvitationNeeded villageName={villageName} reason={invite ? check?.error : undefined} />
            ) : (
            <form onSubmit={handleSubmit} className={`${CARD} space-y-8`}>
              {goodLink && (
                <p className={TILE + " text-sm text-foreground"}>
                  {check?.invitedBy ? `${check.invitedBy} invited you. ` : "You were invited. "}
                  {check?.forRoles?.length ? (
                    <span data-invite-roles="">
                      {t`The village adopted your application for ${forRoles}. Make your account to take them up.`}
                    </span>
                  ) : (
                    "Create your account to step inside."
                  )}
                  {/* R47: the expiry is only news when it is close. */}
                  {(check?.daysLeft ?? 0) <= 3 &&
                    ` This invitation ends in ${check?.daysLeft ?? 0} ${check?.daysLeft === 1 ? "day" : "days"}.`}
                </p>
              )}
              {invite !== "" && check?.valid === false && check.error && (
                <p className="rounded-xl border border-notice/60 bg-muted p-4 text-sm text-foreground">
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
                <m.div
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-xl border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  {error}
                </m.div>
              )}

              <div className="space-y-6">
                <div>
                  {/* htmlFor + id on every field here. The labels were plain
                      text sitting above unlinked inputs, so a screen reader
                      announced four controls with no names, and iOS offered no
                      Keychain suggestion on the one form where a saved
                      password matters most. */}
                  <label htmlFor="register-name" className={`block ${LABEL} mb-2`}>Name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3.5 size-5 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="register-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      maxLength={NAME_MAX}
                      className={`${FIELD} min-h-11 pl-12 pr-4 py-3`}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-email" className={`block ${LABEL} mb-2`}>Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-3.5 size-5 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="register-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={`${FIELD} min-h-11 pl-12 pr-4 py-3`}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-password" className={`block ${LABEL} mb-2`}>Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-3.5 size-5 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="register-password"
                      name="new-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      minLength={PASSWORD_MIN}
                      maxLength={PASSWORD_MAX}
                      aria-describedby="register-password-rule"
                      className={`${FIELD} min-h-11 pl-12 pr-12 py-3`}
                      required
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                  </div>
                  <p id="register-password-rule" className={`${HINT} mt-1`}>
                    At least {PASSWORD_MIN} characters.
                  </p>
                </div>

                <div>
                  <label htmlFor="register-confirm" className={`block ${LABEL} mb-2`}>
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-3.5 size-5 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="register-confirm"
                      name="confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${FIELD} min-h-11 pl-12 pr-12 py-3`}
                      required
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                  </div>
                </div>
              </div>

              {!skipPicker && (
              <div>
                <label className={`block ${LABEL} mb-4`}>
                  Choose your path. Pick more than one if you like.
                </label>
                <div className="grid gap-3" aria-busy={PATHS === null}>
                  {(PATHS ?? []).map((path) => (
                    <button
                      key={path.id}
                      type="button"
                      onClick={() => togglePath(path.id)}
                      aria-pressed={selectedPaths.includes(path.id)}
                      data-on={selectedPaths.includes(path.id)}
                      className={`${TILE} jw-btn jw-pick min-h-11 border-2 text-left ${
                        selectedPaths.includes(path.id) ? "border-notice" : "hover:border-notice/60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {selectedPaths.includes(path.id) ? (
                          <CheckCircle2 className="size-5 mt-0.5 shrink-0 text-notice" aria-hidden="true" />
                        ) : (
                          <Circle className="size-5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground break-words">{path.label}</p>
                          {path.description && <p className="text-sm text-muted-foreground break-words">{path.description}</p>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              )}

              <button disabled={loading} type="submit" className={`${BTN_PRIMARY} w-full`}>
                {loading ? "Creating your account…" : "Create account"}
                {!loading && <ArrowRight className="size-5" aria-hidden="true" />}
              </button>

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
                next={landing}
                invite={goodLink ? invite : undefined}
              />
            </form>
            )}

            <div className="mt-8 text-center">
              <p className={`${HINT} mb-4`}>Already have an account?</p>
              <a href="/login" className={BTN_NOTICE}>
                Sign in
                <ArrowRight className="size-5" aria-hidden="true" />
              </a>
            </div>
          </m.div>
        </div>
      </div>
    </Layout>
  );
}
