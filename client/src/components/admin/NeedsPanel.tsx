/**
 * Admin, The Game, What This Village Is For: the six-screen needs ceremony.
 *
 * ── THE DOOR THIS FILE IS ────────────────────────────────────────────────
 * server/routes/needs.ts shipped four admin writes with no caller in any
 * browser, and scripts/check-admin-reach.mjs carried four ALLOWED lines
 * naming this file and saying to delete them when it landed. It has landed,
 * and they are deleted. Every one of the four is reached from a control here:
 * PUT /api/admin/needs/scope from the Save on screens 1, 2 and 3,
 * POST /api/admin/needs/retire from unticking a need, POST
 * /api/admin/needs/links and DELETE /api/admin/needs/links/:id from screen 5.
 *
 * ── WHY SIX SCREENS AND NOT ONE FORM ─────────────────────────────────────
 * The order is the argument. A founder answers what the village is for, then
 * how far on each, then for how many, then what all of that adds up to, then
 * what does the meeting, and only then reads the whole of it back. Every
 * screen after the first is prefilled from the one before it, so the ceremony
 * narrows. A single page of ten rows with four columns each asks all four
 * questions at once and gets four half-answers.
 *
 * ── EVERY COMPONENT IN THIS FILE IS AT MODULE SCOPE ──────────────────────
 * Not one is declared inside another component's body. That rule cost this
 * repository a real defect: `Section` was declared inside `SetupWizard`, which
 * made a new component TYPE on every render, and React replaced the whole
 * subtree on every keystroke. The founder of the live village reported it as
 * "every time I type a single letter it takes down my keyboard". See
 * client/src/components/admin/SetupSection.tsx for the full account. The
 * custom-need field on screen 1 is the input this file has to keep alive, and
 * NeedsPanel.test.tsx types five letters into it and asserts the same DOM node
 * is still there and still focused after each one.
 *
 * ── NO NUMBER APPEARS HERE THAT THIS CODE CANNOT COMPUTE ─────────────────
 * Three figures a founder would reasonably expect are deliberately absent,
 * each replaced by a sentence saying what is missing:
 *
 *   THE ROLL COUNT. A breadth target is a percentage of the members on the
 *   roll, and this screen does not count them. `members_total` is derived in
 *   server/lib/health.ts and reaches no route this panel can call, so a count
 *   taken here would be a SECOND derivation that could disagree with the one
 *   the village measures against. Screen 3 says that in a sentence.
 *
 *   THE ENGINE-SIZING DIAL. R1's target ("we aim to meet N percent of our
 *   members' needs") is a game variable in a `Needs` category that does not
 *   exist yet; lane N5 owns shared/gameVariables.ts. Screen 4 computes and
 *   prints the descriptive figure and says plainly that nothing in the engine
 *   reads it.
 *
 *   THE TAGS ADDED BEFORE THIS SITTING. `GET /api/needs/coverage` answers
 *   COUNTS per need and no route anywhere returns a link with its id, so the
 *   only tag this screen can take off is one it just put on. Screen 5 says so
 *   where the Remove buttons are, so an absent button reads as a missing route
 *   and never as a missing tag.
 *
 * ── REFUSALS ARE PRINTED AS RECEIVED ─────────────────────────────────────
 * `server/lib/needs.ts` refuses in whole sentences ("A breadth is a whole
 * number of percent, from 0 to 100."), and this file never paraphrases one.
 * The refusal lands in a `role="alert"` region so a screen reader says it
 * without the founder having to go looking.
 *
 * ── WHY IT IS FOUR FILES ─────────────────────────────────────────────────
 * `scripts/check-file-lines.mjs` refuses a NEW client file born over 1000
 * lines, and the whole ceremony written as one file was 1305. The split is by
 * what a reader is looking for: `needsCopy.ts` holds the sentences and the
 * shapes, `NeedsPieces.tsx` holds the small components and every class name,
 * `NeedsSetupStep.tsx` holds the wizard step and the read behind its tick, and
 * this file holds the six screens. The step and its hook are re-exported from
 * here so `Admin.tsx` spends one import line on all of it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, ListChecks } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import {
  HUMAN_NEEDS,
  HUMAN_NEEDS_BY_ID,
  customNeedKey,
  expressionsLine,
  needKeyProblem,
  type NeedDepth,
  type NeedSubject,
} from "@shared/needs";
import {
  coveredSentence,
  draftsFrom,
  needSentence,
  seatLineWorthSaying,
  seatSentence,
  totalitySentence,
  uncoveredSentence,
  type CoverageReport,
  type Drafts,
  type FreshLink,
  type NeedDraft,
  type ScopeRow,
  type ScopeSummary,
} from "./needsCopy";
import { CARD, FIELD, HINT, PRIMARY, QUIET, DepthLadder, NeedDot, NeedTickRow, Recap, ScreenRail } from "./NeedsPieces";

export { NeedsSetupStep, useNeedsSetupObservation } from "./NeedsSetupStep";

export default function NeedsPanel({
  password,
  onOpenTab,
}: {
  password: string;
  onOpenTab?: (tab: string) => void;
}) {
  const auth = useMemo(() => authHeaders(password), [password]);

  const [screen, setScreen] = useState(1);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ScopeRow[]>([]);
  const [summary, setSummary] = useState<ScopeSummary | null>(null);
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom([]).drafts);
  const [order, setOrder] = useState<string[]>(() => draftsFrom([]).order);
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState("");
  const [refused, setRefused] = useState("");

  /* Screen 5's tagging controls, and the tags this sitting added. */
  const [tagNeed, setTagNeed] = useState("");
  const [tagSubject, setTagSubject] = useState("");
  const [quests, setQuests] = useState<Array<{ id: string; title: string }>>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [freshLinks, setFreshLinks] = useState<FreshLink[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/needs/scope`, { headers: auth });
      if (!res.ok) {
        setRefused(refusal(await res.json().catch(() => ({})), "The needs scope could not be read."));
        return;
      }
      const data = await res.json();
      const rows: ScopeRow[] = Array.isArray(data.scope) ? data.scope : [];
      setScope(rows);
      setSummary(data.summary ?? null);
      const built = draftsFrom(rows);
      setDrafts(built.drafts);
      setOrder(built.order);
    } catch {
      setRefused("The needs scope could not be read.");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  const loadCoverage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/needs/coverage`, { headers: auth });
      setReport(res.ok ? await res.json() : null);
    } catch {
      setReport(null);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (screen !== 5 && screen !== 6) return;
    loadCoverage();
  }, [screen, loadCoverage]);

  /* The things a tag can be put onto. Both reads are public lists the rest of
     the admin already shows; a token rides along because every other call on
     this screen carries one. */
  useEffect(() => {
    if (screen !== 5) return;
    let alive = true;
    fetch(`${API_BASE}/quests`, { headers: auth })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (alive && Array.isArray(d)) setQuests(d.map((q: any) => ({ id: String(q.id), title: String(q.title ?? q.id) })));
      })
      .catch(() => {});
    fetch(`${API_BASE}/org`, { headers: auth })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.roles)) {
          setRoles(d.roles.map((r: any) => ({ id: String(r.id), name: String(r.name ?? r.id) })));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [screen, auth]);

  const setDraft = useCallback((key: string, patch: Partial<NeedDraft>) => {
    setDrafts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }, []);

  const toggle = useCallback((key: string, on: boolean) => setDraft(key, { on }), [setDraft]);
  const pickDepth = useCallback((key: string, depth: NeedDepth) => setDraft(key, { depth }), [setDraft]);

  const live = order.map((k) => drafts[k]).filter((d) => d && d.on);
  const activeScope = scope.filter((r) => r.active);

  /**
   * Save the ticked needs, then retire the ones that were unticked.
   *
   * THE PUT NEVER RETIRES, by the route's own design: a PUT that dropped every
   * need absent from its body would make a half-loaded screen an act of
   * policy. So unticking is its own call, and re-ticking is an ordinary PUT
   * because the upsert clears `retired_at` and the links were never touched.
   *
   * The PUT goes first and its refusal stops everything. A refused save that
   * had already retired three needs would leave the village holding neither
   * the old scope nor the new one.
   */
  const save = useCallback(async () => {
    setSaving(true);
    setRefused("");
    setSaid("");
    try {
      const wanted = order
        .map((k) => drafts[k])
        .filter((d) => d && d.on)
        .map((d, i) => ({
          needKey: d.key,
          label: d.label,
          depthTarget: d.depth,
          breadthTargetPct: Number(d.breadth),
          note: d.note.trim() ? d.note : null,
          sortOrder: i,
        }));
      if (wanted.length > 0) {
        const res = await fetch(`${API_BASE}/admin/needs/scope`, {
          method: "PUT",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({ needs: wanted }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRefused(refusal(body, "That save was refused and the server said nothing about why."));
          return;
        }
      }
      const wantedKeys = new Set(wanted.map((w) => w.needKey));
      const toRetire = activeScope.filter((r) => !wantedKeys.has(r.needKey));
      for (const row of toRetire) {
        const res = await fetch(`${API_BASE}/admin/needs/retire`, {
          method: "POST",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({ needKey: row.needKey }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setRefused(refusal(body, `${row.label} could not be taken out of scope.`));
          return;
        }
      }
      setSaid(
        toRetire.length > 0
          ? `Saved. ${wanted.length} need${wanted.length === 1 ? "" : "s"} in scope, ${toRetire.length} retired.`
          : `Saved. ${wanted.length} need${wanted.length === 1 ? "" : "s"} in scope.`,
      );
      await load();
    } catch {
      setRefused("That save did not reach the server, so nothing was written.");
    } finally {
      setSaving(false);
    }
  }, [order, drafts, activeScope, password, load]);

  /** A need this list does not name. Refused in the shared rule's own words. */
  const addCustom = useCallback(() => {
    setRefused("");
    setSaid("");
    const typed = customName.trim();
    if (!typed) {
      setRefused("A need this list does not name needs a label of its own.");
      return;
    }
    const key = customNeedKey(typed);
    const problem = needKeyProblem(key);
    if (problem) {
      setRefused(problem);
      return;
    }
    if (drafts[key]) {
      setRefused(`${drafts[key].label} is already on this list.`);
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [key]: { key, label: typed, isCustom: true, on: true, depth: "satisfied", breadth: "100", note: "" },
    }));
    setOrder((prev) => [...prev, key]);
    setCustomName("");
    setSaid(`${typed} is on the list. It is written to the village when you save.`);
  }, [customName, drafts]);

  /** Tag one thing as meeting one need. POST /api/admin/needs/links. */
  const addTag = useCallback(async () => {
    setRefused("");
    setSaid("");
    const [subjectType, subjectRef] = tagSubject.split(":");
    if (!tagNeed || !subjectType || !subjectRef) {
      setRefused("Pick a need and a thing that meets it.");
      return;
    }
    const name =
      subjectType === "quest"
        ? (quests.find((q) => q.id === subjectRef)?.title ?? subjectRef)
        : (roles.find((r) => r.id === subjectRef)?.name ?? subjectRef);
    try {
      const res = await fetch(`${API_BASE}/admin/needs/links`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ needKey: tagNeed, subjectType, subjectRef, weight: "primary" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefused(refusal(body, "That tag was refused and the server said nothing about why."));
        return;
      }
      if (body?.link?.id) {
        setFreshLinks((prev) => [
          ...prev,
          { id: String(body.link.id), needKey: tagNeed, subjectType: subjectType as NeedSubject, subjectRef, subjectName: name },
        ]);
      }
      setSaid(`${name} is tagged as meeting ${drafts[tagNeed]?.label ?? tagNeed}.`);
      await loadCoverage();
    } catch {
      setRefused("That tag did not reach the server, so nothing was written.");
    }
  }, [tagNeed, tagSubject, quests, roles, password, drafts, loadCoverage]);

  /** Take one tag off. DELETE /api/admin/needs/links/:id. */
  const removeTag = useCallback(
    async (link: FreshLink) => {
      setRefused("");
      setSaid("");
      try {
        const res = await fetch(`${API_BASE}/admin/needs/links/${link.id}`, { method: "DELETE", headers: auth });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRefused(refusal(body, "That tag could not be taken off."));
          return;
        }
        setFreshLinks((prev) => prev.filter((l) => l.id !== link.id));
        setSaid(`${link.subjectName} is no longer tagged to ${drafts[link.needKey]?.label ?? link.needKey}.`);
        await loadCoverage();
      } catch {
        setRefused("That change did not reach the server.");
      }
    },
    [auth, drafts, loadCoverage],
  );

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground" role="status" aria-live="polite">
        Reading what this village is for.
      </div>
    );
  }

  return (
    /*
     * THE PANEL CARRIES ITS OWN GROUND, and this is not decoration.
     *
     * The Admin shell around it is theme-FROZEN: `client/src/pages/Admin.tsx`
     * paints the page `bg-gray-50` with no dark variant. A responsive
     * `text-foreground` on a frozen light surface is near-white text on light
     * gray the moment a member turns dark mode on, which is the defect
     * `Profile.tsx` already shipped once. Painting `bg-background` here means
     * this panel's text and its background move together whatever the shell
     * does, and the shell's own freeze stays the shell's to fix.
     */
    <div className="bg-background text-foreground rounded-xl p-4 -m-1">
      <header className="mb-5">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Heart className="w-5 h-5" aria-hidden="true" />
          What this village is for
        </h2>
        <p className={`${HINT} mt-1`}>
          Six screens. Say which needs this village is taking on, how far it means to get on each, for
          how many, and what does the meeting. You can change any of it later.
        </p>
      </header>

      <ScreenRail at={screen} onGo={setScreen} />

      {/* BOTH REGIONS STAY MOUNTED and collapse to nothing when they are empty.
          A live region inserted at the moment it has something to say is a
          region some screen readers never announce, and a permanently reserved
          20px leaves a blank hole above the heading on the screen a founder
          arrives at. Empty means no height and no margin, never no element. */}
      <p role="alert" className={`text-sm text-destructive ${refused ? "mb-2" : ""}`}>
        {refused}
      </p>
      <p role="status" aria-live="polite" className={`text-sm text-teal-deep ${said ? "mb-4" : ""}`}>
        {said}
      </p>

      {screen === 1 ? (
        <section aria-labelledby="needs-screen-1">
          <h3 id="needs-screen-1" className="text-lg font-semibold text-foreground mb-2">
            What this village is for
          </h3>
          <p className="text-sm text-foreground mb-2">
            A village is a business designed to meet the needs of the people in it. A need is something a
            person cannot do without and can name out loud: clean water, someone to talk to, work that
            means something. Before you set a single number, say which needs this village is taking on.
          </p>
          <p className="text-sm text-foreground mb-2">
            These ten come from Manfred Max-Neef's list by way of Nonviolent Communication. Tick the ones
            this village is taking on. You can add your own, and you can change any of this later.
          </p>
          <p className={`${HINT} mb-4`}>
            Choosing few is the honest move. Every need you take on is work somebody has to do, so a
            village that names all ten and staffs two has told its members something untrue.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              className={QUIET}
              onClick={() => setDrafts((prev) => {
                const next = { ...prev };
                for (const need of HUMAN_NEEDS) next[need.id] = { ...next[need.id], on: true };
                return next;
              })}
            >
              Take on all ten
            </button>
            <button
              type="button"
              className={QUIET}
              onClick={() => setDrafts((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) next[key] = { ...next[key], on: false };
                return next;
              })}
            >
              Clear every tick
            </button>
          </div>

          <div className="grid gap-2 mb-5">
            {order.map((key) => {
              const draft = drafts[key];
              if (!draft) return null;
              const def = HUMAN_NEEDS_BY_ID[key];
              return (
                <NeedTickRow
                  key={key}
                  draft={draft}
                  hint={def ? expressionsLine(def) : "A need this village wrote for itself."}
                  onToggle={toggle}
                />
              );
            })}
          </div>

          <div className={`${CARD} px-4 py-4 mb-5`}>
            <label htmlFor="needs-custom-name" className="block text-sm font-medium text-foreground mb-1">
              A need this list does not name
            </label>
            <p className={`${HINT} mb-2`}>
              Write it the way the ten above are written, as the words your members would actually use. It
              is stored under a key of its own and can never take one of the ten.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="needs-custom-name"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Quiet"
                className={`${FIELD} flex-1 min-w-[12rem]`}
              />
              <button type="button" onClick={addCustom} className={QUIET}>
                Add this need
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className={PRIMARY}>
              {saving ? "Saving" : "Save what this village is for"}
            </button>
            <button type="button" onClick={() => setScreen(2)} className={QUIET}>
              Next: how far, on each
            </button>
          </div>
        </section>
      ) : null}

      {screen === 2 ? (
        <section aria-labelledby="needs-screen-2">
          <h3 id="needs-screen-2" className="text-lg font-semibold text-foreground mb-2">
            How far, on each
          </h3>
          <div className="mb-3">
            <Recap drafts={drafts} order={order} upTo={1} />
          </div>
          <p className="text-sm text-foreground mb-2">
            For each need you took on, say how far you mean to get. The five rungs are Deprived, Unmet,
            Alive, Satisfied and Thriving, and every need starts at Satisfied.
          </p>
          <p className="text-sm text-foreground mb-2">
            Most villages aim at Satisfied and reach for Thriving on two or three. Aiming at Thriving
            everywhere is a promise, and a promise the economy cannot fund is worse than a smaller one it
            can.
          </p>
          <p className={`${HINT} mb-4`}>
            The five words are the deck's own. The sentence under each one is this platform's reading of
            what that rung means for the need beside it.
          </p>

          {live.length === 0 ? (
            <p className="text-sm text-foreground">
              Nothing is ticked, so there is nothing to set a depth on. Screen 1 is where that starts.
            </p>
          ) : (
            <div className="grid gap-3 mb-5">
              {live.map((draft) => (
                <div key={draft.key} className={`${CARD} px-4 py-4`}>
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                    <NeedDot needKey={draft.key} />
                    {draft.label}
                  </p>
                  <DepthLadder draft={draft} onPick={pickDepth} />
                  <label className="block mt-3">
                    <span className={`${HINT} block mb-1`}>Why this one, in your words. Optional.</span>
                    <input
                      type="text"
                      value={draft.note}
                      onChange={(e) => setDraft(draft.key, { note: e.target.value })}
                      className={`${FIELD} w-full`}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setScreen(1)} className={QUIET}>
              Back
            </button>
            <button type="button" onClick={save} disabled={saving} className={PRIMARY}>
              {saving ? "Saving" : "Save these depths"}
            </button>
            <button type="button" onClick={() => setScreen(3)} className={QUIET}>
              Next: for how many
            </button>
          </div>
        </section>
      ) : null}

      {screen === 3 ? (
        <section aria-labelledby="needs-screen-3">
          <h3 id="needs-screen-3" className="text-lg font-semibold text-foreground mb-2">
            For how many
          </h3>
          <div className="mb-3">
            <Recap drafts={drafts} order={order} upTo={2} />
          </div>
          <p className="text-sm text-foreground mb-2">
            Say who each need is for. A village that meets Love for half its members has chosen something,
            and it should be able to say so out loud. Childcare may be for the four families with
            children. Clean water is for everyone.
          </p>
          <p className={`${HINT} mb-4`}>
            A percentage here is a share of the members on the roll. This screen does not count them: the
            roll is counted on the Village Health page, and a second count taken here could disagree with
            the one the village measures against.
          </p>

          {live.length === 0 ? (
            <p className="text-sm text-foreground">
              Nothing is ticked, so there is nobody to set a share for. Screen 1 is where that starts.
            </p>
          ) : (
            <div className="grid gap-2 mb-5">
              {live.map((draft) => (
                <div key={draft.key} className={`${CARD} flex items-center justify-between gap-3 px-4 py-3`}>
                  <label htmlFor={`breadth-${draft.key}`} className="flex items-center gap-2 text-sm text-foreground">
                    <NeedDot needKey={draft.key} />
                    {draft.label}
                  </label>
                  <span className="flex items-center gap-2">
                    <input
                      id={`breadth-${draft.key}`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.breadth}
                      onChange={(e) => setDraft(draft.key, { breadth: e.target.value })}
                      className={`${FIELD} w-24 text-right`}
                    />
                    <span className={HINT}>percent of members</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setScreen(2)} className={QUIET}>
              Back
            </button>
            <button type="button" onClick={save} disabled={saving} className={PRIMARY}>
              {saving ? "Saving" : "Save these shares"}
            </button>
            <button type="button" onClick={() => setScreen(4)} className={QUIET}>
              Next: how much of each person's needs
            </button>
          </div>
        </section>
      ) : null}

      {screen === 4 ? (
        <section aria-labelledby="needs-screen-4">
          <h3 id="needs-screen-4" className="text-lg font-semibold text-foreground mb-2">
            How much of each person's needs
          </h3>
          <div className="mb-3">
            <Recap drafts={drafts} order={order} upTo={3} />
          </div>
          <p className="text-sm text-foreground mb-2">
            Nobody meets all of anybody's needs, and a village that says it does is lying to the person
            who joins it. This is what you have said so far, added up:
          </p>
          <p className={`${CARD} px-4 py-4 text-base text-foreground mb-3`}>
            {totalitySentence(activeScope, summary?.answered ?? false)}
          </p>
          <p className="text-sm text-foreground mb-2">
            Ten percent is a good neighbour: people live their own lives and this village helps. A hundred
            percent is a whole world, and it needs a whole economy behind it.
          </p>
          <p className={`${HINT} mb-2`}>
            That sentence is a description of what you have ticked and saved. The dial that would take this
            figure and size the economy around it is not built. No quest payout, no seat payout and no
            allowance reads it today, so changing your ticks changes what this village SAYS and nothing
            about what it pays.
          </p>
          <p className={`${HINT} mb-4`}>
            The more needs you take on, the more roles the economy needs to meet them. Screen 5 counts the
            seats you have tagged and how many of them are held.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setScreen(3)} className={QUIET}>
              Back
            </button>
            <button type="button" onClick={() => setScreen(5)} className={QUIET}>
              Next: what meets them
            </button>
          </div>
        </section>
      ) : null}

      {screen === 5 ? (
        <section aria-labelledby="needs-screen-5">
          <h3 id="needs-screen-5" className="text-lg font-semibold text-foreground mb-2">
            What meets them
          </h3>
          <div className="mb-3">
            <Recap drafts={drafts} order={order} upTo={3} />
          </div>
          <p className="text-sm text-foreground mb-2">
            Now say what does the meeting. A quest, a seat, a place a member can spend, a stay, an event or
            a place on the map can each be tagged with the needs it meets. A need with nothing tagged to it
            is an intention, and no economy answers it.
          </p>

          {activeScope.length === 0 ? (
            <p className="text-sm text-foreground mb-4">
              Nothing is in scope, so there is nothing to meet. Screen 1 is where that starts.
            </p>
          ) : (
            <div className="grid gap-2 mb-5">
              {(report?.coverage ?? []).map((row) => {
                const seats = report?.seatings.find((s) => s.needKey === row.needKey);
                return (
                  <div key={row.needKey} className={`${CARD} px-4 py-3`}>
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <NeedDot needKey={row.needKey} />
                      {row.label}
                    </p>
                    <p className={`${HINT} mt-1`}>
                      {row.uncovered ? uncoveredSentence(row.label) : coveredSentence(row)}
                    </p>
                    {seats && seatLineWorthSaying(seats) ? (
                      <p className={`${HINT} mt-0.5`}>{seatSentence(seats)}</p>
                    ) : null}
                    {seats && seats.rolesWithNobodyInThem.length > 0 ? (
                      <p className={`${HINT} mt-0.5`}>
                        Nobody holds {seats.rolesWithNobodyInThem.map((r) => r.name).join(", ")}. That is
                        work this village said it needed.
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {report === null ? (
                <p className={HINT}>The coverage read has not come back, so no count is shown here.</p>
              ) : report.seatings.every((s) => !seatLineWorthSaying(s)) ? (
                <p className={HINT}>
                  No seat is tagged to any of these needs, so there is no seat count to give. The more
                  needs a village takes on, the more seats its economy needs to meet them.
                </p>
              ) : null}
            </div>
          )}

          <div className={`${CARD} px-4 py-4 mb-4`}>
            <p className="text-sm font-medium text-foreground mb-2">Tag one thing as meeting one need</p>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="grid gap-1">
                <span className={HINT}>The need</span>
                <select value={tagNeed} onChange={(e) => setTagNeed(e.target.value)} className={FIELD}>
                  <option value="">Pick a need</option>
                  {activeScope.map((r) => (
                    <option key={r.needKey} value={r.needKey}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className={HINT}>What meets it</span>
                <select value={tagSubject} onChange={(e) => setTagSubject(e.target.value)} className={FIELD}>
                  <option value="">Pick a quest or a seat</option>
                  {quests.map((q) => (
                    <option key={`quest:${q.id}`} value={`quest:${q.id}`}>
                      {q.title}
                    </option>
                  ))}
                  {roles.map((r) => (
                    <option key={`role:${r.id}`} value={`role:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addTag} className={QUIET}>
                Tag it
              </button>
            </div>
            <p className={`${HINT} mt-2`}>
              Quests and seats are edited on their own screens. Nothing here changes a quest or a seat: it
              only records that the one meets the other.
            </p>
            {onOpenTab ? (
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" onClick={() => onOpenTab("quests-admin")} className={QUIET}>
                  Open Quests
                </button>
                <button type="button" onClick={() => onOpenTab("org-chart")} className={QUIET}>
                  Open Org Chart
                </button>
              </div>
            ) : null}
          </div>

          <div className={`${CARD} px-4 py-4 mb-5`}>
            <p className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              <ListChecks className="w-4 h-4" aria-hidden="true" />
              Tags added in this sitting
            </p>
            <p className={`${HINT} mb-2`}>
              These are the only tags this screen can take off. No route returns a tag with its id, so a
              tag added before today can be counted here and cannot be removed here.
            </p>
            {freshLinks.length === 0 ? (
              <p className={HINT}>None yet.</p>
            ) : (
              <ul className="grid gap-1.5">
                {freshLinks.map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-3 text-sm text-foreground">
                    <span>
                      {link.subjectName} meets {drafts[link.needKey]?.label ?? link.needKey}
                    </span>
                    <button type="button" onClick={() => removeTag(link)} className={QUIET}>
                      Take this tag off
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setScreen(4)} className={QUIET}>
              Back
            </button>
            <button type="button" onClick={() => setScreen(6)} className={QUIET}>
              Next: the whole of it
            </button>
          </div>
        </section>
      ) : null}

      {screen === 6 ? (
        <section aria-labelledby="needs-screen-6">
          <h3 id="needs-screen-6" className="text-lg font-semibold text-foreground mb-2">
            The whole of it
          </h3>
          <p className={`${HINT} mb-3`}>
            This is what your village says it is for, in the words you would read out at its birthing.
            Every sentence here is read back from what was saved.
          </p>

          <p className={`${CARD} px-4 py-4 text-base text-foreground mb-3`}>
            {totalitySentence(activeScope, summary?.answered ?? false)}
          </p>

          {activeScope.length > 0 ? (
            <ul className="grid gap-1.5 mb-4">
              {activeScope.map((row) => (
                <li key={row.needKey} className="flex items-start gap-2 text-sm text-foreground">
                  <NeedDot needKey={row.needKey} />
                  <span>
                    {needSentence(row)}
                    {row.note ? <span className={`${HINT} block`}>{row.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {report && report.uncovered.length > 0 ? (
            <p className="text-sm text-foreground mb-3">
              {report.uncovered.length} of the needs you took on have nothing tagged to them yet:{" "}
              {report.uncovered
                .map((k) => report.coverage.find((c) => c.needKey === k)?.label ?? k)
                .join(", ")}
              . Nothing here stops you. A need with nothing meeting it is a gap this screen names and does
              not block.
            </p>
          ) : null}

          {report && report.seatings.some((s) => s.seatsNeeded > 0) ? (
            <p className="text-sm text-foreground mb-3">
              {report.seatings.reduce((n, s) => n + s.seatsFilled, 0)} of the{" "}
              {report.seatings.reduce((n, s) => n + s.seatsNeeded, 0)} seats tagged to these needs are
              held. The more needs a village takes on, the more seats its economy needs to meet them.
            </p>
          ) : (
            <p className={`${HINT} mb-3`}>
              No seat is tagged to any of these needs, so there is no seat count to give. Screen 5 is where
              a seat is tagged.
            </p>
          )}

          <p className={`${HINT} mb-4`}>
            {summary && summary.adopted > 0
              ? "This step counts as done in the Setup Wizard while at least one need is in scope."
              : "This step stays unfinished in the Setup Wizard while nothing is in scope."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setScreen(5)} className={QUIET}>
              Back
            </button>
            <button type="button" onClick={() => setScreen(1)} className={QUIET}>
              Start again at screen 1
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
