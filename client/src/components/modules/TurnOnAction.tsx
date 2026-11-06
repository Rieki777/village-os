/**
 * TURNING ONE OR MORE MODULES ON, in whichever way this reader may.
 *
 * One component for every place the library offers it: a module's own page,
 * the founder's planning basket, and a starter set. What it offers is the
 * server's answer on the catalog (`viewer`), never a guess from the account's
 * role:
 *
 *   canSwitch      "Turn on", which turns the whole plan on in order,
 *                  dependencies first. Before launch it opens in preview so a
 *                  founder can look before anybody else sees it; after launch
 *                  a holder turns it on for members.
 *   launched, signed in, not a holder
 *                  "Propose to turn on": a short platform-written form that
 *                  posts one proposal carrying every module in the plan. When
 *                  the village votes yes, the modules come on. The dry run
 *                  below the form is the executor's own check.
 *   otherwise      nothing.
 *
 * A dependency is never a dead end. Where the server used to answer 409
 * "Enable X first", the plan names it ("Stays also needs Commerce") and the
 * one press turns on both. A module that touches money shows `ConsentCard`
 * first, whichever way it is being turned on.
 *
 * R55: this never sits on a shelf tile. Tiles are single links; this lives on
 * the module page and in the panels above the shelves.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import ConsentCard from "./ConsentCard";
import { dryRunTurnOn, proposeTurnOn, proposalHref, switchInOrder, type DryRun } from "./switchModules";
import { alsoNeedsLine, joinNames, turnOnPlan, type LibraryViewer, type PlanModule } from "@shared/moduleSwitch";
import type { ModuleLifecycle } from "@shared/modules";

const BUTTON = "min-h-[44px] px-5 rounded-lg bg-teal-deep text-white font-semibold text-sm disabled:opacity-40";
const QUIET = "min-h-[44px] px-4 rounded-lg border border-border bg-background text-sm font-medium";

export default function TurnOnAction({
  ids,
  all,
  viewer,
  label,
  examplesAvailable = false,
  onDone,
}: {
  /** What the reader picked. The plan adds whatever these need. */
  ids: string[];
  /** Every module, with `lifecycle` where the reader may see it. */
  all: PlanModule[];
  viewer: LibraryViewer;
  /** What the picks are called on the button, when more than one. */
  label?: string;
  /** Offer "start with example content" (one module, steward, off). */
  examplesAvailable?: boolean;
  onDone?: () => void;
}) {
  const direct = viewer.canSwitch;
  const proposes = !direct && viewer.launched && viewer.mode !== "visitor";
  const to: ModuleLifecycle = viewer.launched ? "members" : "preview";
  const [wide, setWide] = useState<ModuleLifecycle>("members");
  const target: ModuleLifecycle = direct ? to : wide;
  const plan = useMemo(() => turnOnPlan(ids, target, all), [ids, target, all]);
  const [busy, setBusy] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const [withExamples, setWithExamples] = useState(true);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dry, setDry] = useState<DryRun | null>(null);
  const [sent, setSent] = useState<{ id: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const funds = plan.filter((m) => m.legalReview && (m.lifecycle ?? "off") === "off");
  const first = all.find((m) => m.id === ids[0]);
  const needs = ids.length === 1 && first ? alsoNeedsLine(first, plan) : null;
  const names = plan.map((m) => m.name);
  const priced = (plan as Array<PlanModule & { priceLine?: string | null }>).filter(
    (m) => !!m.priceLine && m.priceLine !== "Free",
  );

  useEffect(() => {
    if (!proposes || !open || plan.length === 0) return;
    let alive = true;
    void dryRunTurnOn(plan, target).then((d) => alive && setDry(d));
    return () => {
      alive = false;
    };
  }, [proposes, open, plan, target]);

  if ((!direct && !proposes) || plan.length === 0) return null;

  const turnOn = async () => {
    setAskConsent(false);
    setBusy(true);
    setError(null);
    const out = await switchInOrder(plan, to, { examples: examplesAvailable ? withExamples : undefined });
    setBusy(false);
    if (out.refused) {
      setError(`${out.refused.name}: ${out.refused.message}`);
      return;
    }
    toast.success(to === "preview" ? `${joinNames(names)} on, in preview` : `${joinNames(names)} on for members`);
    onDone?.();
  };

  const propose = async () => {
    setAskConsent(false);
    setBusy(true);
    setError(null);
    const out = await proposeTurnOn(plan, target, reason);
    setBusy(false);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    setSent({ id: out.id, message: out.message });
    onDone?.();
  };

  const press = (go: () => void) => () => (funds.length ? setAskConsent(true) : go());

  if (sent) {
    return (
      <div className="rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-4 text-sm">
        <p className="font-semibold text-foreground">Your proposal is in.</p>
        <p className="mt-1 text-muted-foreground">{sent.message}</p>
        <Link href={proposalHref(sent.id)} className="mt-2 inline-flex min-h-[44px] items-center font-medium text-teal-deep underline">
          Go to your proposal
        </Link>
      </div>
    );
  }

  if (askConsent) {
    return (
      <ConsentCard
        names={funds.map((m) => m.name)}
        action={direct ? "Turn on" : "Send the proposal"}
        busy={busy}
        onConfirm={direct ? turnOn : propose}
        onCancel={() => setAskConsent(false)}
      />
    );
  }

  if (direct) {
    return (
      <div className="space-y-3">
        {needs && <p className="text-sm text-foreground">{needs}. One press turns on all of them, in order.</p>}
        {examplesAvailable && (
          <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
            <input
              type="checkbox"
              checked={withExamples}
              onChange={(e) => setWithExamples(e.target.checked)}
              className="w-5 h-5 accent-teal-deep"
            />
            Start with example content
          </label>
        )}
        <button type="button" disabled={busy} onClick={press(turnOn)} className={BUTTON}>
          {busy ? "Turning on…" : plan.length > 1 ? `Turn on ${label ?? `all ${plan.length}`}` : "Turn on"}
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!open ? (
        <>
          {needs && <p className="text-sm text-foreground">{needs}. One proposal asks for all of them.</p>}
          <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
            Propose to turn on
          </button>
        </>
      ) : (
        <form
          className="space-y-3 rounded-xl border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            press(propose)();
          }}
        >
          <p className="font-semibold text-foreground">Propose turning on {joinNames(names)}</p>
          <p className="text-sm text-muted-foreground">
            The village votes on it. If the vote carries, {names.length > 1 ? "they come" : "it comes"} on.
          </p>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-foreground">Who should see it</legend>
            {(["members", "public"] as const).map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm min-h-[44px]">
                <input type="radio" name="wide" checked={wide === v} onChange={() => setWide(v)} className="w-5 h-5 accent-teal-deep" />
                {v === "members" ? "Signed-in members" : "Everyone, visitors too"}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm font-medium text-foreground">
            Why the village should turn {names.length > 1 ? "these" : "it"} on
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-base"
            />
          </label>
          {dry && (
            <div className="text-sm text-muted-foreground space-y-1">
              {plan.length > 1 && <p>This asks for {joinNames(names)}, in that order.</p>}
              {priced.map((m) => (
                <p key={m.id}>{m.name} costs {m.priceLine}.</p>
              ))}
              {funds.length > 0 && <p>{joinNames(funds.map((m) => m.name))} touches money, so the village reads the funds conditions first.</p>}
              {dry.blocker ? <p className="text-red-700">{dry.blocker.sentence}</p> : <p>{dry.landing}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || reason.trim().length < 10} className={BUTTON}>
              {busy ? "Sending…" : "Send the proposal"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={QUIET}>
              Not now
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
