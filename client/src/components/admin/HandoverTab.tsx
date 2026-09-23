/**
 * The handover tab, moved out of client/src/pages/Admin.tsx.
 *
 * Measured before the move, not guessed: of the 44 tab components in that
 * file this one referenced the fewest things defined alongside it (API_BASE,
 * authHeaders and refusal, all three of which now live in ./adminApi), and it
 * is one of only two real tabs carrying no `text-gray-*` class, which is what
 * let it move without disturbing the Tailwind-gray ratchet whose per-file
 * baseline would otherwise treat a new file as new debt. So it goes first: it
 * proves the shape at the lowest risk to everything else.
 *
 * It moved byte-for-byte. It has grown three things since, all from Rye's
 * walk of the live panel on 2026-09-14, and each is explained where it lives:
 * the empty-role warning (`nobodyHolds`), the confirmation before a power
 * crosses (`HandOverDialog`), and the escalation question in `grant`.
 *
 * NEW COLOUR HERE IS FIXED LIGHT, by ruling. The admin panel is a light-only
 * workspace, so the warning and the dialog pair fixed text with fixed
 * surfaces (`bg-white`, `text-gray-*`, amber). The older cards above them
 * still carry semantic tokens and were left as they were.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * NOBODY HOLDS THIS ROLE YET.
 *
 * Rye, 2026-09-14: a power may go to a role nobody holds, in preparation for
 * someone holding it, and the panel should say so. The server allows it and
 * this keeps it allowed. The warning is a sentence beside the control and
 * never a gate.
 *
 * ONLY A SERVED NUMBER COUNTS. `holderCount` comes from
 * `GET /api/admin/capabilities/holding`, counted the way the capability gate
 * counts (`liveHolderCount` in server/lib/roleGrants.ts: a seat whose term has
 * lapsed is nobody). The roles list the panel already had cannot answer this,
 * and a server that predates the field sends nothing at all. Nothing is not
 * zero, so a missing count shows no warning: a false "nobody holds this" on a
 * seat somebody is sitting in would teach an admin to skip the true ones.
 */
function nobodyHolds(role: { holderCount?: unknown } | null | undefined): boolean {
  return typeof role?.holderCount === "number" && role.holderCount === 0;
}

const emptyRoleWarning = (roleName: string) =>
  `Nobody holds ${roleName} yet. The power waits there until someone is appointed.`;

/**
 * THE HANDOVER (0098): what this village looks after, and how a power moves.
 *
 * R54, the founder's ruling: these villages are meant to be taken over by
 * their electorate, and the admin panel is scaffolding to be dismantled. This
 * tab is the scaffolding naming itself.
 *
 * TWO STEPS AND THE ORDER MATTERS, which is why the panel is shaped this way
 * and not as one button. First a role is given the power, so somebody can
 * act. Then the village takes the power on, and from that moment the admin
 * short-circuit stops answering for it. Handing a power to a role nobody
 * could act through would produce the one state worth refusing outright: the
 * admin stops passing, the named holder never passed, and the power belongs
 * to nobody. The server refuses it; this panel makes it hard to try.
 */
export default function HandoverTab({ password }: { password: string }) {
  const [data, setData] = useState<any>(null);
  const [picking, setPicking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  /**
   * The one power whose "bring it back" has been refused AND whose refusal
   * said this account could reach past the village anyway. Set from the
   * server's answer and never guessed: the second press sends the glass.
   */
  const [glassFor, setGlassFor] = useState("");
  /** The power and role waiting on "is the village ready". Null when nothing is being asked. */
  const [confirming, setConfirming] = useState<{ capability: string; roleId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/capabilities/holding`, { headers: authHeaders(password) });
      setData(res.ok ? await res.json() : null);
    } catch { setData(null); }
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const roles: any[] = data?.roles ?? [];

  /** Give a role a capability it does not carry yet, escalation and all. */
  const grant = async (roleId: string, capability: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const next = Array.from(new Set([...(role.capabilities ?? []), capability]));
    setBusy(capability);
    try {
      let res = await fetch(`${API_BASE}/admin/roles/${roleId}/capabilities`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ capabilities: next }),
      });
      let d = await res.json();
      if (res.status === 409 && d?.requiresConfirmation) {
        /*
         * THE QUESTION IS WRITTEN FOR THE BOX IT APPEARS IN.
         *
         * This used to print the server's sentence, which ended "Tick the
         * ones you mean and send them back", inside an OK/Cancel box with
         * nothing to tick. The sentence came from the draft review screen,
         * which does have checkboxes. The server now states the fact and
         * names no control, and this box says what its own two buttons do.
         */
        const esc: Array<{ capability: string; consequence: string }> = d.escalations ?? [];
        const one = esc.length === 1;
        const question = [
          `No other role in the village carries ${one ? "this power" : "these powers"}, so ${role.name} would be the first.`,
          esc.map((e) => `Anyone in it could ${e.consequence}.`).join("\n"),
          nobodyHolds(role) ? emptyRoleWarning(role.name) : "",
          `OK gives ${role.name} ${one ? "the power" : "all of them"}. Cancel leaves the role as it is.`,
        ].filter(Boolean).join("\n\n");
        if (!window.confirm(question)) { setBusy(""); return; }
        res = await fetch(`${API_BASE}/admin/roles/${roleId}/capabilities`, {
          method: "PUT",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            capabilities: next,
            grantedEscalations: esc.map((e) => e.capability),
          }),
        });
        d = await res.json();
      }
      if (!res.ok) throw new Error(refusal(d, "The change did not go through"));
      toast.success(`${role.name} carries it now`);
      load();
    } catch (e: any) { toast.error(e?.message || "The change did not go through"); }
    setBusy("");
  };

  /** Hand the power to the village. Reached only through `HandOverDialog`. */
  const handOver = async (capability: string, roleId: string) => {
    setConfirming(null);
    setBusy(capability);
    try {
      const res = await fetch(`${API_BASE}/admin/capabilities/${encodeURIComponent(capability)}/holding`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ roleId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "The handover did not go through"));
      toast.success("The village holds it now");
      load();
    } catch (e: any) { toast.error(e?.message || "The handover did not go through"); }
    setBusy("");
  };

  /**
   * ASK THE SERVER, AND LET IT SAY NO (Rye, 2026-09-23).
   *
   * Taking a power back is the village's own decision now: the server refuses
   * this with a sentence naming the `power_return` ballot, and carries on only
   * for a founder seated as a steward with the veto who breaks the glass. The
   * panel does NOT decide which of those the person is — it asks, shows the
   * refusal it gets back, and offers the glass only when the server says the
   * door is there for THIS account (`overrideAvailable`). A button that
   * predicted the answer would be a second gate in the browser.
   */
  const takeBack = async (capability: string, glass = false) => {
    if (glass && !window.confirm(
      "Reach past the village and take this power back? The village sees this on its own feed, with your name on it.",
    )) return;
    setBusy(capability);
    try {
      const res = await fetch(`${API_BASE}/admin/capabilities/${encodeURIComponent(capability)}/holding`, {
        method: "DELETE",
        headers: authHeaders(password, glass ? { "x-capability-override": "true" } : {}),
      });
      const d = await res.json();
      if (!res.ok) {
        if (!glass && d?.overrideAvailable) {
          setBusy("");
          toast.error(d.error);
          setGlassFor(capability);
          return;
        }
        throw new Error(refusal(d, "That did not go through"));
      }
      toast.success("Back with the admin panel");
      setGlassFor("");
      load();
    } catch (e: any) { toast.error(e?.message || "That did not go through"); }
    setBusy("");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-xl font-semibold">The handover</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Every power below has somebody behind it. A power the village holds is one
          you stop passing by being an admin: whoever sits in the holding role acts on
          their own account, and you can still reach past it on a day something has
          gone wrong. Reaching past writes a line on the village feed naming the power
          and your name, and tells whoever holds it.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Members read the same list, in their own words, at{" "}
          <Link href="/powers" className="underline">What this village looks after</Link>.
        </p>
      </div>

      {(data?.powers ?? []).map((p: any) => {
        const holdingRole = p.heldBy ? roles.find((r) => r.id === p.heldBy.roleId) : null;
        const canHold = roles.filter((r) => !r.isExample && (r.capabilities ?? []).includes(p.capability));
        const chosen = picking[p.capability] ?? "";
        const chosenRole = chosen ? roles.find((r) => r.id === chosen) : null;
        return (
          <div key={p.capability} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{p.surface}.</p>
                <p className="text-sm mt-2">Whoever holds this can {p.consequence}.</p>
              </div>
              <code className="text-xs text-muted-foreground shrink-0">{p.capability}</code>
            </div>

            {p.heldBy ? (
              <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm">
                  {holdingRole?.name ?? p.heldBy.roleName ?? p.heldBy.roleId} holds this.{" "}
                  {p.heldBy.byBallot ? "The village voted it across." : "An admin handed it over."}
                </p>
                <button
                  className="text-sm underline text-muted-foreground"
                  disabled={busy === p.capability}
                  onClick={() => takeBack(p.capability, glassFor === p.capability)}
                >
                  {glassFor === p.capability ? "Reach past the village and bring it back" : "Bring it back"}
                </button>
              </div>
            ) : !p.movable ? (
              <p className="text-sm text-muted-foreground mt-3">
                This one stays with the admin panel for now. Its gate has no way back
                through the product yet, and a power an operator cannot reach past is
                an outage waiting for a bad day.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  The admin panel looks after this one.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    className="border border-border rounded px-2 py-1 text-sm bg-background"
                    value={chosen}
                    onChange={(e) => setPicking((prev) => ({ ...prev, [p.capability]: e.target.value }))}
                  >
                    <option value="">Choose a role</option>
                    {roles.filter((r) => !r.isExample).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  {chosen && !canHold.some((r) => r.id === chosen) && (
                    <button
                      className="text-sm px-3 py-1 rounded border border-border"
                      disabled={busy === p.capability}
                      onClick={() => grant(chosen, p.capability)}
                    >
                      Give this role the power
                    </button>
                  )}
                  {chosen && canHold.some((r) => r.id === chosen) && (
                    <button
                      className="text-sm px-3 py-1 rounded bg-primary text-primary-foreground"
                      disabled={busy === p.capability}
                      onClick={() => setConfirming({ capability: p.capability, roleId: chosen })}
                    >
                      Hand it to the village
                    </button>
                  )}
                </div>
                {chosenRole && nobodyHolds(chosenRole) && (
                  <p className="text-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    {emptyRoleWarning(chosenRole.name)}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      <HandOverDialog
        handover={data?.handover ?? null}
        power={confirming ? (data?.powers ?? []).find((p: any) => p.capability === confirming.capability) ?? null : null}
        role={confirming ? roles.find((r) => r.id === confirming.roleId) ?? null : null}
        busy={!!confirming && busy === confirming.capability}
        onCancel={() => setConfirming(null)}
        onConfirm={() => { if (confirming) handOver(confirming.capability, confirming.roleId); }}
      />
    </div>
  );
}

/**
 * ARE YOU SURE THE VILLAGE IS READY TO HOLD THIS POWER.
 *
 * Rye, 2026-09-14: "Hand it to the village" sat one click from the step that
 * stops the admin short-circuit, as the filled primary button, in the same
 * picker that a moment earlier offered the grant. Nothing asked. Now the
 * button only opens this, and the PUT is sent from the confirm button inside
 * it and from nowhere else. Cancel, Escape and the overlay all close it
 * having sent nothing.
 *
 * WHAT IT SAYS is what changes, as facts: who will hold the power, that being
 * an admin stops passing for it, and that reaching past it afterwards is a
 * break-glass the village reads about. When the role has nobody in it, it
 * says that too, because that is the day the break-glass is the only way in.
 *
 * The shared Radix dialog, for the reason InvoluntaryExitDialog gives: it
 * traps focus, closes on Escape and hands focus back. Colours are fixed
 * light, overriding the primitive's themed surface, by the admin ruling.
 */
function HandOverDialog({
  power,
  role,
  handover,
  busy,
  onCancel,
  onConfirm,
}: {
  power: { title?: string; consequence?: string; capability?: string } | null;
  role: { id: string; name?: string; holderCount?: number } | null;
  /** How far the handover has got, from GET /api/admin/capabilities/holding. */
  handover: { complete?: boolean; remaining?: string[]; total?: number } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = !!power && !!role;
  const roleName = role?.name ?? role?.id ?? "";
  /*
   * THE LAST POWER, AND ONLY THE LAST ONE (0217).
   *
   * Crossing this one completes the handover, and completing the handover
   * moves the pen over the governing purpose statement from the founder to
   * the village. That is a different kind of consequence from the other
   * eighteen crossings and the founder should meet it once, here, before
   * pressing the button.
   *
   * IT FIRES ON `remaining.length === 1` AND THE REMAINING ONE IS THIS ONE. A
   * warning on every handover is a warning an admin learns to click past, and
   * by the time the one that mattered arrived they would already have learned
   * to. That is why this is the only extra sentence in this dialog and why it
   * is not a general "you are getting close" nudge.
   *
   * ONLY A SERVED ANSWER COUNTS, the same rule `nobodyHolds` follows. A server
   * that predates this field sends nothing, and nothing is not one, so the
   * warning stays hidden. A false "this is the last one" would be worse than
   * no warning at all.
   */
  const remaining = Array.isArray(handover?.remaining) ? handover!.remaining : null;
  const isLastPower =
    !!remaining && remaining.length === 1 && !!power?.capability && remaining[0] === power.capability;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-lg bg-white text-gray-900 border-gray-200">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Is the village ready to hold this power?</DialogTitle>
          <DialogDescription className="text-gray-600">
            {power?.title}. Whoever holds it can {power?.consequence}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            {roleName} will hold it. From then on, being an admin no longer passes for
            this power. Whoever sits in {roleName} acts on their own account.
          </p>
          <p>
            If an admin reaches past it afterwards, that is a break-glass: the village
            feed carries a line naming that admin and this power, and whoever holds it
            is told.
          </p>
          {isLastPower && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              This is the last of the {handover?.total} powers. Once it crosses, this village
              looks after all of them, and the governing purpose statement becomes the
              village's to change by a vote. You will not be able to rewrite it from here
              afterwards.
            </p>
          )}
          {nobodyHolds(role) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              Nobody holds {roleName} yet. Until someone is appointed, the only way
              anyone can use this power is a break-glass.
            </p>
          )}
          <p className="text-gray-500">
            You can bring it back to the admin panel from this tab later, and the
            village sees that on its feed too.
          </p>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm rounded-lg px-4 py-2 border border-gray-300 text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="text-sm rounded-lg px-4 py-2 font-medium bg-teal-deep text-white disabled:opacity-40"
          >
            Yes, hand it over
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
