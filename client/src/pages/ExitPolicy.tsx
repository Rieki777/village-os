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

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export default function ExitPolicy() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [intake, setIntake] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // A member with no password confirms with Google (components/auth/ConfirmWithGoogle.tsx).
  const identity = useIdentityConfirm("request-exit");

  useEffect(() => {
    fetch("/api/exit-policy").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const policy = data?.policy;
  const shownError = error || identity.returnError;

  const requestExit = () => {
    setError(""); setMsg("");
    fetch("/api/profile/request-exit", {
      method: "POST", headers: headers(), body: JSON.stringify({ ...identityBody(identity, password), note }),
    })
      .then(async (r) => {
        const d = await r.json();
        // A refused Google confirmation is spent or stale either way, so the
        // button to confirm again comes back.
        if (!r.ok) { identity.reset(); throw new Error(d.message ?? d.error ?? "Could not open the process"); }
        setMsg("Your departure process is open. The stewards will walk each step with you. Nothing happens automatically.");
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
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not send");
        setMsg(`Your message reached ${d.reached} steward(s), privately. Nothing was posted anywhere.`);
        setIntake("");
      })
      .catch((e) => setError(e.message));
  };

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Leaving Well</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A village that designs its exits before it needs them can afford to
            welcome people wholeheartedly. This is how departure works here.
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-2xl space-y-6">
          {policy?.placeholder && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              These are the platform's starting terms. The community has not
              yet written its own. Treat them as a draft to be decided
              together, not a contract.
            </p>
          )}
          {msg && <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">{msg}</p>}
          {shownError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{shownError}</p>}

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DoorOpen className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">Choosing to leave</p>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Notice period: {policy?.voluntary?.noticePeriodDays ?? "…"} days.
              Nothing about your departure is automatic. Each step is walked
              with a person.
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
              <p className="font-semibold text-foreground text-sm">If the village asks someone to leave</p>
            </div>
            <p className="text-sm text-muted-foreground">{policy?.involuntary?.process}</p>
            {(policy?.involuntary?.decidingCircle || policy?.involuntary?.appealCircle) && (
              <dl className="mt-3 pt-3 border-t border-border space-y-1">
                {policy?.involuntary?.decidingCircle && (
                  <div className="text-sm">
                    <dt className="inline font-medium text-foreground">Decided by: </dt>
                    <dd className="inline text-muted-foreground">{policy.involuntary.decidingCircle.name}</dd>
                  </div>
                )}
                {policy?.involuntary?.appealCircle && (
                  <div className="text-sm">
                    <dt className="inline font-medium text-foreground">Appeals go to: </dt>
                    <dd className="inline text-muted-foreground">{policy.involuntary.appealCircle.name}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <HeartHandshake className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">Repair before departure</p>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              A rupture is not an exit. The restorative path comes first, and
              its content reaches only the people in the room:
            </p>
            <ol className="space-y-1.5 list-decimal pl-5 mb-3">
              {(policy?.restorative?.steps ?? []).map((s: string, i: number) => (
                <li key={i} className="text-sm text-foreground">{s}</li>
              ))}
            </ol>
            {user && policy?.restorative?.intakeContactRole && (
              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Start a private intake. It goes directly to the stewards
                  holding that role. It is never posted anywhere.
                </p>
                <textarea value={intake} onChange={(e) => setIntake(e.target.value)} rows={3}
                  placeholder="What happened, in your own words…"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <button onClick={sendIntake} disabled={!intake.trim()}
                  className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                  Send privately
                </button>
              </div>
            )}
          </div>

          {user && (
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="font-semibold text-foreground text-sm mb-2">Begin your own departure</p>
              <p className="text-xs text-muted-foreground mb-3">
                This opens the process above. It does not close your account.
                Your contributions stay part of the village's record; your
                identity is removed at the end, when everything is settled.
              </p>
              <div className="space-y-2">
                <IdentityConfirmField state={identity} action="request-exit"
                  password={password} onPassword={setPassword}
                  placeholder="Confirm with your password"
                  inputClassName="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder="Anything you want the stewards to know (optional)"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2" />
                <button onClick={requestExit} disabled={!identityReady(identity, password)}
                  className="text-sm border border-red-300 text-red-600 rounded-lg px-4 py-2 font-medium hover:bg-red-50 disabled:opacity-40">
                  Open my departure process
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
