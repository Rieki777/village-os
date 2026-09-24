/**
 * THE ORG CHART TAB, lifted out of client/src/pages/Admin.tsx unchanged.
 *
 * WHY IT MOVED, and it is not about this component. `Admin.tsx` sat at 10236
 * lines against a cap of exactly 10236, so the admin surface was closed to
 * everyone: a PR adding five lines to mount a panel that already lives in its
 * own file failed with all of its tests passing. That is a wall rather than a
 * defect, and the remedy the gate's own message names is to move a coherent
 * piece out, not to raise the number.
 *
 * NOTHING ABOUT THE COMPONENT CHANGED. The body is byte-identical to what it
 * was in Admin.tsx; only its imports are restated here. It referenced no other
 * top-level name in that file, which is what made it the safe one to take.
 *
 * STATIC IMPORT, DELIBERATELY (docs/ARCHITECTURE.md 3.19 rule 1). That rule
 * makes ROUTES lazy, and `Admin` already is: this code was only ever fetched
 * when the admin chunk loaded, so moving it to a file that chunk imports
 * statically leaves every byte exactly where it was. Making it `React.lazy`
 * would instead add a network round trip when a founder opens this tab, which
 * on the ~50 KB/s links this platform is built for is a cost paid for nothing.
 * The dist budget is measured on this tree rather than assumed.
 */
import { useCallback, useEffect, useState } from "react";
import { Circle, Save } from "lucide-react";
import { toast } from "sonner";
import { CIRCLE_STATUSES } from "@shared/draftKinds";
import { parentChoicesFor } from "@shared/circleView";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import RelationsEditor from "@/components/admin/RelationsEditor";
import { SeatClaimAsks, type SeatClaimAsk } from "@/components/admin/SeatClaimAsks";
import { UndrawnSeatAsks } from "@/components/admin/UndrawnSeatAsks";
import { SeatSomebody } from "@/components/power/SeatSomebody";

export function OrgChartTab({ password }: { password: string }) {
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [circleDraft, setCircleDraft] = useState<Record<string, any>>({});
  const [newSeat, setNewSeat] = useState<Record<string, string>>({});
  // Opened per seat, because the point of a journal is reading one node's
  // history before you change it, not scrolling a feed of everything.
  const [journal, setJournal] = useState<Record<string, any[] | "loading">>({});
  // Mandates that have run out or are about to. Sorted most overdue first by
  // the server, which is the only order that makes this list get acted on.
  const [expiring, setExpiring] = useState<any[]>([]);
  // Members asking to be confirmed in a seat the village recorded under their
  // name. Answered on the seat itself, which is where a steward can see what
  // they are answering about.
  const [seatAsks, setSeatAsks] = useState<SeatClaimAsk[]>([]);
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  const openJournal = async (id: string) => {
    if (journal[id]) { setJournal((p) => { const n = { ...p }; delete n[id]; return n; }); return; }
    setJournal((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await fetch(`${API_BASE}/org/roles/${id}/journal`, { headers: authHeaders(password) });
      const rows = r.ok ? await r.json() : [];
      setJournal((p) => ({ ...p, [id]: Array.isArray(rows) ? rows : [] }));
    } catch { setJournal((p) => ({ ...p, [id]: [] })); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, m, e, asks] = await Promise.all([
        fetch(`${API_BASE}/org`, { headers: authHeaders(password) }).then((r) => r.json()),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_BASE}/admin/org/expiring?days=45`, { headers: authHeaders(password) })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        // A reader without `org.seat` gets a 401 here and the rest of the tab
        // still draws. The queue is the only part of this screen that power
        // gates, so it is the only part that disappears.
        fetch(`${API_BASE}/org/seat-claims`, { headers: authHeaders(password) })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);
      setOrg(o);
      setMembers(Array.isArray(m) ? m : []);
      setExpiring(Array.isArray(e) ? e : []);
      setSeatAsks(Array.isArray(asks) ? asks : []);
    } catch { setOrg(null); }
    setLoading(false);
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, body?: any, method = "POST") => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    // `refusal` and not `d?.error`: the refusal bodies this tab now meets
    // carry the sentence in `message` and the machine code in `error`, and a
    // toast that prints `unknown_status` hands a founder a code and calls it
    // an explanation. `??` also let a body with `error: ""` toast nothing.
    if (!res.ok) { toast.error(refusal(d, "That did not save")); return null; }
    return d;
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Loading…</div>;
  if (!org) return <div className="text-center py-12 text-gray-400">The org chart could not be read.</div>;

  const circles: any[] = org.circles ?? [];
  const roles: any[] = org.roles ?? [];
  const byCircle = new Map<string, any[]>();
  for (const r of roles) {
    const k = r.circleId ?? "";
    byCircle.set(k, [...(byCircle.get(k) ?? []), r]);
  }
  // The seats drawn as cards below. UndrawnSeatAsks catches every ask for any other seat.
  const drawnSeatIds = new Set(circles.flatMap((c) => (byCircle.get(c.id) ?? []).map((r) => String(r.id))));

  const STATE_LABEL: Record<string, string> = {
    filled: "Filled", partial: "Partially filled", open: "Open seat", forming: "Forming",
    // Held, and overdue. Nobody has been removed; the seat is asking to be
    // reassigned because a term ran out or the season it was filled in turned.
    expired: "Term ended, awaiting reassignment",
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Org Chart</h2>
        <p className="text-sm text-gray-500 mt-1">
          Circles, the seats inside them, and who holds each seat. This is what
          /roles, /circles and /team show, and edits are live immediately.
          Whether a seat reads as filled or open is worked out from its holders,
          so it can never say filled with nobody in it.
        </p>
      </div>

      {/*
        The mandates that have run out, at the top where they get seen.

        This list is the whole reason terms are worth recording. Nothing on it
        has been revoked and nobody has been removed: a seat going dark on a
        Tuesday for reasons nobody chose is worse than one saying out loud that
        it is overdue. Reassigning happens in the seat below, so this points
        rather than acts.
      */}
      {expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="font-semibold text-gray-900 text-sm">
            {expiring.filter((e: any) => e.lapsed).length > 0
              ? `${expiring.filter((e: any) => e.lapsed).length} mandate(s) have run out`
              : "Mandates coming up"}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            Everyone here is still holding their seat and still doing the work. What has run out is the
            agreement to keep doing it unasked.
          </p>
          <ul className="mt-2 space-y-1">
            {expiring.map((e: any) => (
              <li key={e.assignmentId} className="text-xs text-gray-800">
                <span className="font-medium">{e.roleName}</span>
                {e.holder ? <> held by {e.holder}</> : null}
                {": "}
                {e.lapsed
                  ? e.reason === "season"
                    ? "the season it was filled in has turned"
                    : "the term has passed"
                  : `${e.daysLeft} day(s) left`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <UndrawnSeatAsks
        asks={seatAsks}
        drawnSeatIds={drawnSeatIds}
        roles={roles}
        circles={circles}
        call={call}
        onDone={(said) => { toast.success(said); void load(); }}
      />

      <div className="space-y-6">
        {circles.map((c) => {
          const seats = byCircle.get(c.id) ?? [];
          return (
            <div key={c.id} className="bg-white border border-gray-100 rounded-xl p-5">
              {/*
                A CIRCLE'S NAME, PURPOSE AND STATUS ARE EDITABLE HERE.

                All three are printed by /circles, /roles and /team, all three
                of which are always-on core pages. The only editor used to be
                the Circles and Map tab, which disappears with the map module,
                so turning the map off took away the ability to rename a circle
                while the public pages kept printing the old name. This tab has
                no module gate, and `/api/admin/circles` no longer has one
                either.
              */}
              {(() => {
                const cd = circleDraft[c.id] ?? c;
                const cDirty = ["name", "purpose", "status", "parentCircleId"].some((k) => (cd[k] ?? "") !== (c[k] ?? ""));
                const setCircle = (patch: any) => setCircleDraft({ ...circleDraft, [c.id]: { ...cd, ...patch } });
                return (
                  <div className="mb-4">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
                      <label className="text-xs text-gray-500">Circle name
                        <input value={cd.name ?? ""} className={`${inputCls} w-full mt-1 min-h-[44px]`} disabled={!!c.isExample}
                          onChange={(e) => setCircle({ name: e.target.value })} />
                      </label>
                      <label className="text-xs text-gray-500">Status
                        <select value={cd.status ?? "active"} className={`${inputCls} w-full mt-1 min-h-[44px]`} disabled={!!c.isExample}
                          onChange={(e) => setCircle({ status: e.target.value })}>
                          {CIRCLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      {/* WHERE THIS CIRCLE SITS. Offered from `parentChoicesFor`,
                          the rules the server refuses with, so nothing on this
                          list is a choice the save turns down: not the circle
                          itself, nothing already inside it, and no standing
                          example. Empty is the top of the village. */}
                      <label className="text-xs text-gray-500">Sits inside
                        <select value={cd.parentCircleId ?? ""} className={`${inputCls} w-full mt-1 min-h-[44px]`} disabled={!!c.isExample}
                          onChange={(e) => setCircle({ parentCircleId: e.target.value || null })}>
                          <option value="">The village, at the top</option>
                          {parentChoicesFor(circles, c.id).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                      <div className="text-xs text-gray-400 pb-2">
                        {c.grownFromOrgRoleId && <span>Grew from a seat. </span>}
                        {c.isExample && <span className="text-amber-700">Standing example, publish your own to replace it.</span>}
                      </div>
                    </div>
                    <label className="text-xs text-gray-500 block mt-2">Purpose
                      {/* A wrapping <label> names the control with EVERY string
                          inside it, so this field announced its name plus the
                          whole hint as one sentence. The name is the field, the
                          hint is a description a reader can take or skip. */}
                      <textarea rows={2} value={cd.purpose ?? ""} className={`${inputCls} w-full mt-1`} disabled={!!c.isExample}
                        aria-label="Purpose"
                        aria-describedby={`${c.id}-purpose-hint`}
                        onChange={(e) => setCircle({ purpose: e.target.value })} />
                      <span id={`${c.id}-purpose-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                        Printed on /circles as the circle's description, and on /roles as the heading under its name.
                      </span>
                    </label>
                    <button
                      disabled={!cDirty || !!c.isExample}
                      className="mt-2 text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                      onClick={async () => {
                        const ok = await call(`/admin/circles/${c.id}`, { name: cd.name, purpose: cd.purpose, status: cd.status, parentCircleId: cd.parentCircleId || null }, "PUT");
                        if (ok) { toast.success("Circle saved"); setCircleDraft({ ...circleDraft, [c.id]: undefined }); void load(); }
                      }}
                    >Save circle</button>
                  </div>
                );
              })()}

              <div className="space-y-3">
                {seats.map((r) => {
                  const d = draft[r.id] ?? r;
                  /*
                   * accountabilities is an ARRAY, so it is compared by value.
                   * A `d[k] !== r[k]` over an array is a reference comparison
                   * that is true the moment the draft object is cloned and
                   * false for two different lists that happen to be the same
                   * object, which is the wrong answer in both directions.
                   */
                  const dirty =
                    ["name", "circleId", "aim", "domain", "seats", "whyItMatters"].some((k) => (d[k] ?? "") !== (r[k] ?? "")) ||
                    JSON.stringify(d.accountabilities ?? []) !== JSON.stringify(r.accountabilities ?? []);
                  return (
                    <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                      <div className="grid sm:grid-cols-4 gap-2 items-end">
                        <label className="text-xs text-gray-500">Seat
                          <input value={d.name ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, name: e.target.value } })} />
                        </label>
                        <label className="text-xs text-gray-500">Circle
                          <select value={d.circleId ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, circleId: e.target.value } })}>
                            <option value="">Unplaced</option>
                            {circles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-gray-500">Seats
                          <input type="number" min={1} value={d.seats ?? 1} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, seats: Number(e.target.value) } })} />
                        </label>
                        <p className="text-xs text-gray-500">
                          State<br />
                          <span className="font-medium text-gray-800">{STATE_LABEL[r.state] ?? r.state}</span>
                          <span className="text-gray-400"> · {r.holderCount} of {r.seats}</span>
                        </p>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2 mt-2">
                        <label className="text-xs text-gray-500">Aim
                          <textarea rows={2} value={d.aim ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, aim: e.target.value } })} />
                        </label>
                        <label className="text-xs text-gray-500">Domain (what it decides alone)
                          <textarea rows={2} value={d.domain ?? ""} className={`${inputCls} w-full mt-1`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, domain: e.target.value } })} />
                        </label>
                      </div>
                      {/*
                        Both of these are rendered on /roles inside the seat's
                        expanded panel, and `updateOrgRole` has accepted both
                        since the org chart shipped. The form never sent them,
                        so every village's accountabilities and reason-this-
                        matters were frozen at whatever the backfill wrote,
                        while the banner on the old cards editor sent founders
                        here promising the site updates immediately.
                      */}
                      <div className="grid sm:grid-cols-2 gap-2 mt-2">
                        {/* Both fields carry an explicit aria-label: a wrapping
                            <label> would otherwise name each control with its
                            field name AND the hint under it, run together. */}
                        <label className="text-xs text-gray-500">Key accountabilities, one per line
                          <textarea rows={4} value={(d.accountabilities ?? []).join("\n")} className={`${inputCls} w-full mt-1`}
                            aria-label="Key accountabilities, one per line"
                            aria-describedby={`${r.id}-accountabilities-hint`}
                            onChange={(e) => setDraft({
                              ...draft,
                              [r.id]: { ...d, accountabilities: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) },
                            })} />
                          <span id={`${r.id}-accountabilities-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                            The ongoing work the circle counts on this seat to keep doing. Listed on /roles.
                          </span>
                        </label>
                        <label className="text-xs text-gray-500">Why this seat matters
                          <textarea rows={4} value={d.whyItMatters ?? ""} className={`${inputCls} w-full mt-1`}
                            aria-label="Why this seat matters"
                            aria-describedby={`${r.id}-why-hint`}
                            onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, whyItMatters: e.target.value } })} />
                          <span id={`${r.id}-why-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                            Shown on /roles under Why This Role Matters.
                          </span>
                        </label>
                      </div>

                      {/*
                        SEATING SOMEBODY WAS A ONE-WAY DOOR.

                        `DELETE /api/admin/org/seatings/:id` and its `/forget`
                        sibling shipped with their own test suite and no caller
                        anywhere in the client, so a village could seat a person
                        and never unseat them, and the right-to-be-forgotten
                        path was reachable only by curl. `/api/org` now carries
                        the seating id for admins, which is what these two need.

                        Two doors on purpose. Ending a holding is ordinary and
                        reversible: the person stays in the record and can be
                        seated again. Forgetting is destructive and only exists
                        for a documented holder, a real person with no account
                        who asked to be erased: it scrubs their name and note
                        from every row, live and historical, and nothing brings
                        it back. It is labelled as such and it types their name.
                      */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(r.holders ?? []).map((h: any) => (
                          <span key={h.assignmentId ?? h.userId ?? h.name} className={`text-xs rounded-full pl-3 pr-1 py-1 inline-flex items-center gap-1 ${h.lapsed ? "bg-amber-50 border border-amber-200" : "bg-gray-100"}`}>
                            {h.name}
                            {h.focus && <span className="text-gray-500"> · {h.focus}</span>}
                            {h.kind === "documented" && <span className="text-amber-700"> · no account yet</span>}
                            {h.lapsed && (
                              <span className="text-amber-700">
                                {" "}· {h.lapsedReason === "term" ? "term ended" : "seated last season"}
                              </span>
                            )}
                            {h.assignmentId && (
                              <button
                                type="button"
                                aria-label={`End ${h.name}'s holding of ${r.name}`}
                                className="ml-1 min-h-[44px] min-w-[44px] px-2 rounded-full text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                                onClick={async () => {
                                  const reason = window.prompt(`End ${h.name}'s holding of "${r.name}"? They stay in the record and can be seated again. Reason for the journal (optional):`);
                                  if (reason === null) return;
                                  const ok = await call(`/admin/org/seatings/${h.assignmentId}`, { reason }, "DELETE");
                                  if (ok) { toast.success("Holding ended"); void load(); }
                                }}
                              >Unseat</button>
                            )}
                            {h.assignmentId && h.kind === "documented" && (
                              <button
                                type="button"
                                aria-label={`Forget ${h.name} permanently`}
                                className="min-h-[44px] min-w-[44px] px-2 rounded-full text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600"
                                onClick={async () => {
                                  const typed = window.prompt(
                                    `FORGET ${h.name}. This ends every holding in their name and erases their name and notes from this seat's history, past entries included. It cannot be undone.\n\nType their name exactly to confirm:`,
                                  );
                                  if (typed === null) return;
                                  if (typed.trim() !== String(h.name).trim()) { toast.error("That name did not match. Nothing was changed."); return; }
                                  const ok = await call(`/admin/org/seatings/${h.assignmentId}/forget`, { reason: "forgotten at their request" });
                                  if (ok) { toast.success(`Forgotten. ${ok.seatings} holding(s) ended.`); void load(); }
                                }}
                              >Forget</button>
                            )}
                          </span>
                        ))}
                        {(r.holders ?? []).length === 0 && <span className="text-xs text-gray-400">Nobody holds this yet.</span>}
                      </div>

                      {/*
                        The asks waiting on this seat, on the seat itself. A
                        claim files a row and never moves a seating, because a
                        name on an account is typed by whoever holds it; this
                        is where a person decides. Nothing draws when the seat
                        has no ask, which is every seat most days.
                      */}
                      <SeatClaimAsks
                        asks={seatAsks.filter((a) => a.roleId === r.id)}
                        call={call}
                        onDone={(said) => { toast.success(said); void load(); }}
                      />

                      <div className="mt-2 flex flex-wrap gap-2 items-end">
                        <SeatSomebody
                          roleId={r.id}
                          members={members}
                          call={call}
                          onSeated={(what) => { toast.success(what); void load(); }}
                          onFailed={(why) => toast.error(why)}
                        />
                        <button
                          onClick={() => void openJournal(r.id)}
                          className="text-sm text-gray-500 hover:text-gray-800 px-2 py-2"
                        >{journal[r.id] ? "Hide history" : "History"}</button>
                        <button
                          disabled={!dirty}
                          className="text-sm border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40"
                          onClick={async () => {
                            const ok = await call(`/admin/org/roles/${r.id}`, {
                              name: d.name, circleId: d.circleId, aim: d.aim, domain: d.domain, seats: d.seats,
                              accountabilities: d.accountabilities ?? [], whyItMatters: d.whyItMatters ?? "",
                            }, "PUT");
                            if (ok) { toast.success("Saved"); setDraft({ ...draft, [r.id]: undefined }); void load(); }
                          }}
                        >Save seat</button>
                      </div>

                      {journal[r.id] === "loading" && (
                        <p className="text-xs text-gray-400 mt-2">Reading the history…</p>
                      )}
                      {Array.isArray(journal[r.id]) && (
                        <div className="mt-2 border-t border-gray-100 pt-2 space-y-1">
                          {(journal[r.id] as any[]).length === 0 && (
                            <p className="text-xs text-gray-400">
                              Nothing recorded against this seat yet. Changes from here on will show up.
                            </p>
                          )}
                          {(journal[r.id] as any[]).map((e) => (
                            <p key={e.id} className="text-xs text-gray-600">
                              <span className="text-gray-400">{new Date(e.at).toLocaleDateString()}</span>{" "}
                              {e.text}
                              {e.by && <span className="text-gray-400"> · {e.by}</span>}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {seats.length === 0 && <p className="text-xs text-gray-400">No seats in this circle yet.</p>}
                {/*
                  Creating a seat. `POST /api/admin/org/roles` has existed since
                  the org chart shipped and nothing in the browser called it, so
                  a village could rename and re-seat the seats it was given and
                  never add one of its own.
                */}
                <div className="flex flex-wrap gap-2 items-end pt-2 border-t border-gray-50">
                  <label className="text-xs text-gray-500">Add a seat to this circle
                    <input value={newSeat[c.id] ?? ""} placeholder="Welcome Host"
                      className={`${inputCls} mt-1 min-h-[44px]`}
                      onChange={(e) => setNewSeat({ ...newSeat, [c.id]: e.target.value })} />
                  </label>
                  <button
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                    disabled={!String(newSeat[c.id] ?? "").trim()}
                    onClick={async () => {
                      const ok = await call("/admin/org/roles", { name: String(newSeat[c.id]).trim(), circleId: c.id, seats: 1 });
                      if (ok) { toast.success("Seat added"); setNewSeat({ ...newSeat, [c.id]: "" }); void load(); }
                    }}
                  >Add seat</button>
                </div>
              </div>
            </div>
          );
        })}

        {(byCircle.get("") ?? []).length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h3 className="font-semibold text-amber-900 mb-2">Seats with no circle</h3>
            <p className="text-xs text-amber-800">
              {(byCircle.get("") ?? []).map((r) => r.name).join(", ")}
            </p>
          </div>
        )}

        {/*
          THE LINKS BETWEEN THE NODES ABOVE, and the second door this lane owed.

          `POST /api/admin/org/relations` and its DELETE sibling had no caller
          anywhere in the browser while `RelationLines.tsx` drew the rows on
          the Power Map, so a live renderer could only ever draw nothing. It
          sits here because the circles and seats it joins are the ones a
          person has just been editing, and it reads them from the same `/api/org`
          payload this tab already holds instead of fetching them twice.
        */}
        <RelationsEditor password={password} circles={circles} roles={roles} />
      </div>
    </div>
  );
}
