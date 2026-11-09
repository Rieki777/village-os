/**
 * The exit policy, published (S52, F12): how leaving works — before anyone
 * needs it. Voluntary departures, the involuntary process, and the
 * restorative path whose content only ever reaches its recipients.
 */
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { DoorOpen, HeartHandshake, ShieldQuestion } from "lucide-react";
import { IdentityConfirmField, identityBody, identityReady, useIdentityConfirm } from "@/components/auth/ConfirmWithGoogle";
import LeavingEnds, { useTermsLeavingEnds } from "@/components/alignment/LeavingEnds";
import { CashOwedNotice, VotesCastNotice, useUnpaidCash } from "@/components/LeavingKeeps";
import LeavingNotices, { useLeavingNotices } from "@/components/LeavingNotices";
import { useFocusTarget } from "@/lib/useFocusTarget";
import ClosingPolicyCard from "@/components/ClosingPolicyCard";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export default function ExitPolicy() {
  const { user } = useAuth();
  const { t } = useLingui();
  const [data, setData] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [intake, setIntake] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // A member with no password confirms with Google (components/auth/ConfirmWithGoogle.tsx).
  const identity = useIdentityConfirm("request-exit");
  // The aligned terms a departure ends when it is resolved (seat settings PR8). Signed in only.
  const endingTerms = useTermsLeavingEnds(!!user);
  // Cash the village still owes keeps a leaver on as a former member (round 4, R4-4). Signed in only.
  const cashOwed = useUnpaidCash(!!user);
  // And their recurring payments: cancelled whether the departure erases the account or keeps them
  // a former member (Rye, 2026-10-31, ruling 8). The server says which act cancels them. Signed in only.
  const leavingNotices = useLeavingNotices(!!user, "exit");

  useEffect(() => {
    // With the token when there is one: the server gives a member the outside
    // contact and every step whole, and anybody else the public reading.
    const token = authToken();
    (token ? fetch("/api/exit-policy", { headers: headers() }) : fetch("/api/exit-policy")).then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const policy = data?.policy;
  const noticeDays = policy?.voluntary?.noticePeriodDays ?? "…";
  const shownError = error || identity.returnError;
  // The departure card renders once the member is known, so look again then.
  useFocusTarget([!!user, !!data]);
  // The role an intake reaches, named by the published policy, so a member
  // knows who will read their words before they send them.
  const intakeRoleName = policy?.restorative?.intakeRole?.name;
  const intakeRoleLabel = intakeRoleName ? t({ message: `${intakeRoleName} role`, context: "the named role a private intake reaches" }) : t({ message: "intake role", context: "the role a private intake reaches, when it has no name" });
  // The conflict door's promise and its outside contact, printed only once the
  // village has stated them: a blank here is a promise nobody made yet.
  const replyHours = Number(policy?.restorative?.replyHours) || 0;
  const outside = policy?.restorative?.outsideContact;
  const outsideNamed = !!(outside?.name && outside?.howToReach);
  const outsideOrganisation = outside?.organisation;
  // The promise belongs to whoever receives the request. With an intake role
  // that is its holders. With none, the outside contact is the only way in, so
  // the page says so plainly, and never "also" beside a door that is not there.
  // A reply time with no door at all promises nothing, and is not printed.
  //
  // HELD TODAY, NOT MERELY CHOSEN (Wave 2 audit, 2026-09-28). This read the
  // stored role id, so a role nobody was ever seated in, or one whose every
  // term had run out, printed "you hear back within N hours" above a form that
  // then refused with "The intake role has no holders right now". The server
  // says whether an intake sent now would reach anybody (`heldToday`,
  // server/lib/restorativeIntake.ts), and the promise and the form follow it.
  const intakeRole = policy?.restorative?.intakeRole;
  const hasIntake = !!intakeRole?.heldToday;
  const intakeUnheld = !!intakeRole && !intakeRole.heldToday;

  const requestExit = () => {
    setError(""); setMsg("");
    fetch("/api/profile/request-exit", {
      method: "POST", headers: headers(), body: JSON.stringify({ ...identityBody(identity, password), note }),
    })
      .then(async (r) => {
        const d = await r.json();
        // A refused Google confirmation is spent or stale either way, so the
        // button to confirm again comes back.
        if (!r.ok) { identity.reset(); throw new Error(d.message ?? d.error ?? t`Could not open the process`); }
        setMsg(t`Your departure process is open. The stewards will walk each step with you. Nothing happens automatically.`);
        setPassword(""); setNote(""); identity.reset();
      })
      .catch((e) => setError(e.message));
  };

  const sendIntake = () => {
    setError(""); setMsg("");
    fetch("/api/exit/restorative-intake", {
      method: "POST", headers: headers(), body: JSON.stringify({ message: intake }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? t({ message: "Could not send", context: "a private intake was not sent" }));
        const reached = Number(d.reached ?? 0);
        setMsg(
          t`Your message reached ${plural(reached, { one: "# person", other: "# people" })} holding the ${intakeRoleLabel}. They read it in their notifications here. Your words were not emailed.`,
        );
        setIntake("");
      })
      .catch((e) => setError(e.message));
  };

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">
            <Trans context="exit policy page title">Leaving Well</Trans>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            <Trans>
              A village that designs its exits before it needs them can afford to
              welcome people wholeheartedly. This is how departure works here.
            </Trans>
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-2xl space-y-6">
          {policy?.placeholder && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <Trans>
                These are the platform's starting terms. The community has not
                yet written its own. Treat them as a draft to be decided
                together, not a contract.
              </Trans>
            </p>
          )}
          {msg && <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">{msg}</p>}
          {shownError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{shownError}</p>}

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DoorOpen className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm"><Trans context="exit policy section heading">Choosing to leave</Trans></p>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              <Trans>
                Notice period: {noticeDays} days.
                Nothing about your departure is automatic. Each step is walked
                with a person.
              </Trans>
            </p>
            <ol className="space-y-1.5 list-decimal pl-5">
              {(policy?.voluntary?.unwindSteps ?? []).map((s: string, i: number) => (
                <li key={i} className="text-sm text-foreground">{s}</li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground mt-3">{policy?.voluntary?.valuationMethod}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldQuestion className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm"><Trans>If the village asks someone to leave</Trans></p>
            </div>
            <p className="text-sm text-muted-foreground">{policy?.involuntary?.process}</p>
            {(policy?.involuntary?.decidingCircle || policy?.involuntary?.appealCircle) && (
              <dl className="mt-3 pt-3 border-t border-border space-y-1">
                {policy?.involuntary?.decidingCircle && (
                  <div className="text-sm">
                    <dt className="inline font-medium text-foreground"><Trans context="the circle that decides an involuntary exit">Decided by:</Trans> </dt>
                    <dd className="inline text-muted-foreground">{policy.involuntary.decidingCircle.name}</dd>
                  </div>
                )}
                {policy?.involuntary?.appealCircle && (
                  <div className="text-sm">
                    <dt className="inline font-medium text-foreground"><Trans context="the circle that hears an appeal against an exit">Appeals go to:</Trans> </dt>
                    <dd className="inline text-muted-foreground">{policy.involuntary.appealCircle.name}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <HeartHandshake className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm"><Trans context="exit policy section heading">Repair before departure</Trans></p>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              <Trans>
                A rupture is not an exit. The restorative path comes first, and
                its content reaches only the people in the room:
              </Trans>
            </p>
            <ol className="space-y-1.5 list-decimal pl-5 mb-3">
              {(policy?.restorative?.steps ?? []).map((s: string, i: number) => (
                <li key={i} className="text-sm text-foreground">{s}</li>
              ))}
            </ol>
            {hasIntake && replyHours > 0 && (
              <p className="text-sm text-muted-foreground mb-2">
                <Trans>
                  Bring it to the {intakeRoleLabel} and you hear back within <Plural value={replyHours} one="# hour" other="# hours" />.
                </Trans>
              </p>
            )}
            {intakeUnheld && (
              <p className="text-sm text-muted-foreground mb-2">
                <Trans>Nobody holds the {intakeRoleLabel} today, so a private intake would reach nobody.</Trans>
              </p>
            )}
            {!outsideNamed && !!outside?.organisation && (
              <p className="text-sm text-muted-foreground mb-3">
                {hasIntake ? (
                  <Trans>
                    You can also bring it to somebody outside the village, at {outsideOrganisation}. Members see who they are and how to reach them.
                  </Trans>
                ) : (
                  <Trans>
                    Bring it to somebody outside the village, at {outsideOrganisation}. Members see who they are and how to reach them.
                  </Trans>
                )}
              </p>
            )}
            {outsideNamed && (
              <p className="text-sm text-muted-foreground mb-3">
                {hasIntake ? t`You can also bring it to somebody outside the village` : t`Bring it to somebody outside the village`}: {outside.name}
                {outside.organisation ? `, ${outside.organisation}` : ""}. {outside.howToReach}
                {!hasIntake && replyHours > 0 ? (
                  <>
                    {" "}
                    <Trans>
                      You hear back within <Plural value={replyHours} one="# hour" other="# hours" />.
                    </Trans>
                  </>
                ) : (
                  ""
                )}
              </p>
            )}
            {user && hasIntake && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Start a private intake. It reaches only the people holding
                    the {intakeRoleLabel}, who read your name and your words in
                    their notifications here. If they get an email, it says only
                    that an intake is waiting: your words and your name are never
                    emailed.
                  </Trans>
                </p>
                <textarea value={intake} onChange={(e) => setIntake(e.target.value)} rows={3}
                  placeholder={t`What happened, in your own words…`}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <button onClick={sendIntake} disabled={!intake.trim()}
                  className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                  <Trans context="button that sends a private restorative intake">Send privately</Trans>
                </button>
              </div>
            )}
          </div>

          {/* The exit AND closing policy: what happens if the village itself ends (2026-09-25). */}
          {policy && <ClosingPolicyCard closing={policy.closing} />}

          {user && (
            // The delete screen's "Leave the village instead" lands here (`?focus=begin-departure`).
            <div id="begin-departure" className="bg-card border border-border rounded-xl p-5 scroll-mt-24">
              <p className="font-semibold text-foreground text-sm mb-2"><Trans>Begin your own departure</Trans></p>
              <p className="text-xs text-muted-foreground mb-3">
                <Trans>
                  This opens the process above. It does not close your account.
                  If you still hold tokens, or the village still owes you cash,
                  when it ends, you stay on as a former member and keep your
                  account and balances. Otherwise your identity is removed at the end and your contributions stay part of the village's record.
                </Trans>
              </p>
              <LeavingEnds titles={endingTerms} />
              <CashOwedNotice count={cashOwed} door="departure" />
              <VotesCastNotice />
              <LeavingNotices notices={leavingNotices} />
              <div className="space-y-2">
                <IdentityConfirmField state={identity} action="request-exit"
                  password={password} onPassword={setPassword}
                  placeholder={t`Confirm with your password`}
                  inputClassName="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder={t`Anything you want the stewards to know (optional)`}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <button onClick={requestExit} disabled={!identityReady(identity, password)}
                  className="text-sm border border-red-300 text-red-600 rounded-lg px-4 py-2 font-medium hover:bg-red-50 disabled:opacity-40">
                  <Trans>Open my departure process</Trans>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
