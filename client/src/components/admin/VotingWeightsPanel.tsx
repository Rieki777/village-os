/**
 * Admin, The Game, Voting Weights.
 *
 * ── THE DOOR THIS FILE IS ────────────────────────────────────────────────
 * `governance.weight_mode` offers Custom, and its own description promises
 * "the allocation table you keep under Voting weights".
 * `PUT /api/admin/governance/weights/:userId` and
 * `POST /api/admin/governance/weights/bulk` were that table's only writers,
 * and nothing in the browser called either one. `openBallot` refuses a
 * zero-weight electorate with the sentence "Allocate weight before opening a
 * ballot" (server/lib/ballots.ts), so a founder in custom mode met a correct
 * signpost pointing at a place the product did not have. This is that place,
 * and it echoes that sentence's vocabulary on purpose.
 *
 * ── POSTURE (R56) ────────────────────────────────────────────────────────
 * The screen states what is true and gets out of the way. The count of
 * members holding no weight is a fact about the current allocation, never a
 * caution: a village that gives weight to three of forty has exercised a
 * dial, and nothing here argues with it. The only refusals on this page are
 * the two the route itself makes, a negative weight and a change with no
 * reason, and both are stated before a save is attempted.
 *
 * ── THE REASON IS PART OF THE ACT ────────────────────────────────────────
 * `weightChangeProblem` refuses a noteless change. So the reason field opens
 * the moment a number changes, and the save stays out of reach until it is
 * written. A founder meets that requirement while allocating, never as a red
 * sentence after pressing Save.
 *
 * ── THE TRAIL IS MEMBER-READABLE ─────────────────────────────────────────
 * `governance_weight_changes` is append-only and `GET /api/governance/weights`
 * serves it to every signed-in member. The history says so out loud, because
 * an admin should know that what they type here is read by the people it is
 * about.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Scale } from "lucide-react";
import { toast } from "sonner";
import BreathingLoader from "@/components/natural/BreathingLoader";
import InfoTip from "@/components/InfoTip";
import { sortMembersByName } from "@shared/memberOrder";

type WeightMode = "equal" | "token" | "custom";

interface WeightMember {
  id: string;
  name: string;
  weight: number;
}

interface WeightsPayload {
  mode: WeightMode;
  token: string | null;
  members: WeightMember[];
  membersWithNoWeight: number;
}

interface ChangeRow {
  id: string;
  userId: string;
  oldWeight: number | null;
  newWeight: number;
  actorUserId: string;
  note: string;
  at: string;
}

/** The same rounding `weightText` uses on the member side, so one number
 *  never reads two ways across the two surfaces. */
const weightText = (n: number): string => String(Math.round((Number.isFinite(n) ? n : 0) * 10000) / 10000);

const MODE_LABEL: Record<WeightMode, string> = {
  equal: "One person, one vote",
  token: "Token balance",
  custom: "Custom allocation",
};

/**
 * What the live mode means for this table, said plainly. The table is kept
 * under every mode: a village that switches to custom next season should find
 * last season's allocations where it left them.
 */
function modeLine(mode: WeightMode, token: string | null): string {
  if (mode === "custom") return "Custom is live. Each number below is what that member's vote carries on the next ballot.";
  if (mode === "token") {
    return `Weight comes from each member's balance of ${token ?? "the weight token"} at the moment a ballot opens. This table is kept, and it takes effect the day the village moves to custom.`;
  }
  return "Every eligible member weighs one. This table is kept, and it takes effect the day the village moves to custom.";
}

const inputCls =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep";
const buttonCls =
  "text-sm rounded-lg px-3 py-2 min-h-[44px] font-medium disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep";

export default function VotingWeightsPanel({
  password,
}: {
  password: string;
}) {
  const auth = useMemo(() => ({ Authorization: `Bearer ${password}` }), [password]);
  const [data, setData] = useState<WeightsPayload | null>(null);
  const [history, setHistory] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleOff, setModuleOff] = useState(false);

  // Per member: the typed number, and the reason it changed. Both keyed by
  // user id so a half-written row survives a reload of the other rows.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  // The bulk pass: one weight, one reason, one row in the trail per member.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkWeight, setBulkWeight] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, h] = await Promise.all([
        fetch("/api/admin/governance/weights", { headers: auth }),
        fetch("/api/admin/governance/weights/history", { headers: auth }),
      ]);
      if (w.status === 404) {
        setModuleOff(true);
        setData(null);
        return;
      }
      setModuleOff(false);
      setData(w.ok ? await w.json() : null);
      setHistory(h.ok ? await h.json() : []);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [auth]);
  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useCallback(
    (userId: string): string => {
      const m = (data?.members ?? []).find((x) => x.id === userId);
      if (m) return m.name;
      // The actor on a bulk pass run from the runbook is the literal string
      // "admin", and a member who has left keeps their row in the trail.
      return userId === "admin" ? "A steward" : "Someone no longer here";
    },
    [data],
  );

  const saveOne = async (m: WeightMember) => {
    const weight = Number(draft[m.id]);
    const note = (reason[m.id] ?? "").trim();
    setSaving(m.id);
    try {
      const res = await fetch(`/api/admin/governance/weights/${encodeURIComponent(m.id)}`, {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ weight, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.message ?? body?.error ?? "That weight did not save");
        return;
      }
      toast.success(`${m.name} now weighs ${weightText(weight)}`);
      setDraft((d) => {
        const next = { ...d };
        delete next[m.id];
        return next;
      });
      setReason((r) => {
        const next = { ...r };
        delete next[m.id];
        return next;
      });
      await load();
    } finally {
      setSaving(null);
    }
  };

  const saveBulk = async () => {
    const weight = Number(bulkWeight);
    // Array.from, because the tsconfig target here predates spreading a Set.
    const changes = Array.from(picked).map((userId) => ({ userId, weight }));
    setBulkSaving(true);
    try {
      const res = await fetch("/api/admin/governance/weights/bulk", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ changes, note: bulkReason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.message ?? body?.error ?? "That pass did not save");
        return;
      }
      toast.success(`${changes.length} member(s) now weigh ${weightText(weight)}`);
      setPicked(new Set());
      setBulkWeight("");
      setBulkReason("");
      await load();
    } finally {
      setBulkSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12">
        <BreathingLoader label="Reading the allocation table" showLabel />
      </div>
    );
  }

  if (moduleOff) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900">Voting Weights</h2>
        <p className="text-sm text-gray-500 mt-1">
          Governance is off in this village, so there is nothing to allocate. Turn it on in Module Library and this
          table comes back with whatever it held.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900">Voting Weights</h2>
        <p className="text-sm text-gray-500 mt-1">The allocation table could not be read. Reload and try again.</p>
      </div>
    );
  }

  /*
   * SORTED BY NAME, and this is not a nicety. An admin works down this table
   * row by row, and the read after a save has to put every row back where the
   * read before it did. A table that reshuffles after a save is one where the
   * next click lands on the wrong person.
   *
   * The route sorts too, through this same comparator. Sorting again here is
   * deliberate: it costs nothing on a village-sized list, and it means the
   * table holds its order even if a future payload arrives unsorted. The
   * comparator lives in `shared/memberOrder.ts` so that every admin surface
   * showing members agrees on one order, and the reasoning is written out
   * there in full.
   */
  const members = sortMembersByName(data.members);
  const total = members.reduce((s, m) => s + m.weight, 0);
  const allPicked = picked.size > 0 && picked.size === members.length;
  const bulkNumber = Number(bulkWeight);
  const bulkReady =
    picked.size > 0 &&
    bulkWeight.trim() !== "" &&
    Number.isFinite(bulkNumber) &&
    bulkNumber >= 0 &&
    bulkReason.trim().length > 0 &&
    !bulkSaving;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Voting Weights</h2>
        <p className="text-sm text-gray-500 mt-1">
          What one member's vote counts for on a village ballot. Every change here carries a reason, and every change
          lands on a permanent record any member can read.
        </p>
      </div>

      {/* WHICH MODE IS LIVE, and where the dial that picks it lives. The mode
          is a founder-ring game variable, so this points at the one place it
          is set instead of offering a second place to set it. That place is
          the Governance module's card now (Rye, 2026-09-15): a dial a module
          owns is set up on that module's card, and `governance.weight_mode` is
          owned by Governance, with Exchange reading it too. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Scale className="w-4 h-4 text-teal-deep" aria-hidden="true" />
          {MODE_LABEL[data.mode]}
          <InfoTip
            tip="How voting weight is assigned is one setting for the whole village. Equal gives everyone the same vote, token reads a balance, custom uses the table below."
            label="What the weight mode is"
          />
        </h3>
        <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{modeLine(data.mode, data.token)}</p>
        <a
          href="/admin?tab=modules&module=governance"
          className="mt-2 inline-flex items-center min-h-[44px] text-sm font-semibold text-teal-deep hover:underline focus:outline-none focus:ring-2 focus:ring-teal-deep rounded-lg"
        >
          Change how weight is assigned
        </a>
      </div>

      {/* THE STANDING COUNT. Plain information about the current allocation.
          It never blocks a save and it takes no position on whether a village
          should spread weight wide or narrow, which is the village's call. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-4">
        <p className="text-sm text-gray-900 font-medium">
          {data.membersWithNoWeight} of {members.length} member{members.length === 1 ? "" : "s"} hold no weight.
        </p>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          The allocated weight across the village adds up to {weightText(total)}.
          {data.mode === "custom" && total === 0 && (
            <>
              {" "}
              A ballot refuses to open while the electorate's total weight is zero. Allocate weight before opening a
              ballot.
            </>
          )}
        </p>
      </div>

      {/* THE FREEZE. A mechanical fact an admin plans around: `ballot_electorate`
          is written when a ballot opens and nothing rewrites it, so a change
          made today reaches the next vote and never the one in flight. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <p className="text-sm text-gray-600 leading-relaxed">
          A ballot copies who may vote and how much each of them weighs at the moment it opens, and keeps that copy for
          its whole life. Anything you change here applies to the next vote. A vote already running keeps the weights it
          started with.
        </p>
      </div>

      {/* THE BULK PASS. One weight and one reason across everybody picked, and
          the route writes one trail row per member, so the record stays
          per-person even when the act was a sweep. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900">Set several at once</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Tick the members below, then give one weight and one reason for the whole pass. Each member still gets their
          own line on the record.
        </p>
        <div className="flex flex-wrap gap-2 items-end mt-3">
          <label className="text-xs text-gray-500">
            Weight for everyone picked
            <input
              type="number"
              min={0}
              step="any"
              value={bulkWeight}
              onChange={(e) => setBulkWeight(e.target.value)}
              className={`${inputCls} w-36 mt-1 min-h-[44px] block`}
            />
          </label>
          <label className="text-xs text-gray-500 flex-1 min-w-[220px]">
            Why the whole pass
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              maxLength={500}
              placeholder="Founding members carry two, everyone else one"
              className={`${inputCls} w-full mt-1 min-h-[44px] block`}
            />
          </label>
          <button
            type="button"
            disabled={!bulkReady}
            onClick={() => void saveBulk()}
            className={`${buttonCls} bg-teal-deep text-white`}
          >
            {bulkSaving ? "Saving..." : `Set ${picked.size} member(s)`}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {picked.size === 0
            ? "Nobody is picked yet."
            : bulkReason.trim()
              ? `${picked.size} picked.`
              : `${picked.size} picked. The reason is what makes this saveable.`}
        </p>
      </div>

      {/* THE TABLE. A row is a member, their weight now, and the number you
          are proposing. The reason opens as soon as those two differ. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-semibold text-gray-900">Every member</h3>
          <button
            type="button"
            onClick={() => setPicked(allPicked ? new Set() : new Set(members.map((m) => m.id)))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-teal-deep"
          >
            {allPicked ? "Clear the ticks" : "Tick everyone"}
          </button>
        </div>

        {members.length === 0 && (
          <p className="text-sm text-gray-500">
            No members hold an account here yet. Weights become allocatable as people join.
          </p>
        )}

        <div className="space-y-2">
          {members.map((m) => {
            const typed = draft[m.id];
            const proposed = typed === undefined ? weightText(m.weight) : typed;
            const asNumber = Number(proposed);
            const changed = proposed.trim() !== "" && Number.isFinite(asNumber) && asNumber !== m.weight;
            const negative = proposed.trim() !== "" && Number.isFinite(asNumber) && asNumber < 0;
            const note = (reason[m.id] ?? "").trim();
            const ready = changed && !negative && note.length > 0 && saving !== m.id;
            return (
              <div key={m.id} className="border border-gray-100 rounded-lg p-3">
                {/*
                  A GRID, so the four columns line up down the page. Flexed,
                  every row sized itself to its own name and the numbers walked
                  sideways, which is what makes a table of numbers unreadable.
                  It stacks under `sm`, where four columns is one column.
                */}
                <div className="grid gap-3 items-end sm:grid-cols-[minmax(0,1fr)_100px_140px_auto]">
                  <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={picked.has(m.id)}
                      aria-label={`Include ${m.name} in the bulk pass`}
                      onChange={(e) =>
                        setPicked((p) => {
                          const next = new Set(p);
                          if (e.target.checked) next.add(m.id);
                          else next.delete(m.id);
                          return next;
                        })
                      }
                      className="w-5 h-5 accent-teal-deep focus:outline-none focus:ring-2 focus:ring-teal-deep"
                    />
                    <span className="font-medium text-gray-900">{m.name}</span>
                  </label>

                  <p className="text-xs text-gray-500 pb-2">
                    Weight now
                    <br />
                    <span className="text-sm font-medium text-gray-900 tabular-nums">{weightText(m.weight)}</span>
                    {m.weight === 0 && <span className="text-gray-500"> (none)</span>}
                  </p>

                  <label className="text-xs text-gray-500">
                    New weight
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={proposed}
                      aria-label={`New weight for ${m.name}`}
                      onChange={(e) => setDraft({ ...draft, [m.id]: e.target.value })}
                      className={`${inputCls} w-full mt-1 min-h-[44px] block`}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!ready}
                    aria-label={`Save the new weight for ${m.name}`}
                    onClick={() => void saveOne(m)}
                    className={`${buttonCls} border border-gray-200 justify-self-start`}
                  >
                    {saving === m.id ? "Saving..." : "Save"}
                  </button>
                </div>

                {/*
                  THE REASON, opened by the change itself. The route refuses a
                  noteless change, and meeting that as part of typing the
                  number is the difference between a rule and an error message.
                */}
                {changed && (
                  <label className="text-xs text-gray-500 block mt-2">
                    Why {m.name} moves from {weightText(m.weight)} to {weightText(asNumber)}
                    {/*
                      An explicit aria-label, because a wrapping <label> takes
                      its accessible name from EVERY string inside it: without
                      this the field announced as the question plus the hint
                      under it, one long sentence, every time focus landed.
                      The hint stays, as a description.
                    */}
                    <input
                      value={reason[m.id] ?? ""}
                      maxLength={500}
                      autoFocus
                      aria-label={`Why ${m.name} moves from ${weightText(m.weight)} to ${weightText(asNumber)}`}
                      aria-describedby={`${m.id}-reason-hint`}
                      placeholder="Elected to the finance seat this season"
                      onChange={(e) => setReason({ ...reason, [m.id]: e.target.value })}
                      className={`${inputCls} w-full mt-1 min-h-[44px] block`}
                    />
                    <span id={`${m.id}-reason-hint`} className="block text-[11px] text-gray-400 mt-0.5">
                      {m.name} reads this sentence on their own page, with your name beside it.
                    </span>
                  </label>
                )}
                {negative && (
                  <p className="text-xs text-gray-700 mt-2">A weight is zero or a positive number.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* THE RECORD. Append-only, and the same rows every member can read at
          /decisions. Saying that here keeps the two surfaces honest with each
          other. */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <History className="w-4 h-4 text-gray-500" aria-hidden="true" />
          Every change ever made
        </h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Append-only. Nothing here can be edited or removed, by anyone, and every signed-in member reads the same list
          on the decisions page.
        </p>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 mt-3">Nobody's weight has been changed yet.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {history.map((h) => (
              <li key={h.id} className="text-sm border-b border-gray-50 pb-2.5 last:border-0 last:pb-0">
                <span className="font-medium text-gray-900">{nameOf(h.userId)}</span>
                <span className="text-gray-700 tabular-nums">
                  {h.oldWeight === null ? " set to " : ` ${weightText(h.oldWeight)} to `}
                  {weightText(h.newWeight)}
                </span>
                <span className="text-gray-400">
                  {" by "}
                  {nameOf(h.actorUserId)} on {new Date(h.at).toLocaleDateString()}
                </span>
                <p className="text-gray-600 leading-relaxed">{h.note}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
