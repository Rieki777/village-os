/**
 * THE QUEST BOARD'S EDITOR, moved out of client/src/pages/Admin.tsx (2026-10-21).
 *
 * Moved whole, the way #377 moved its tabs, to make room in a file at its line
 * cap for the one thing this round adds: what a quest is worth and pays (0265).
 * The Gratitude reward box is gone with it, because no quest pays Gratitude
 * (Rye, 2026-10-21). Every quest carries a value from the moment it is
 * created, and the token amounts beside it are offered from the village's own
 * rules (`WorkValueEditor`).
 *
 * Admin is a light-only workspace by ruling (2026-09-04), so this file keeps
 * the fixed grays it was written in.
 *
 * STARTER QUESTS (Rye, sheet A8 / 19g, 2026-10-31). A fresh village opens on
 * starters that are standing examples, which nobody can claim and the save
 * and delete routes refuse. Each one carries Keep instead: it publishes that
 * starter as a real quest, with whatever the founder changed and the value
 * they set, and leaves the others standing. The note above the list clears
 * the ones nobody kept. This is the screen the Journey to Launch row
 * `starter-quests` links to.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { ExampleChip, forgetExamplesCache } from "@/components/ExamplesBanner";
import WorkValueEditor, { draftFrom, draftToBody, usePayOptions, type WorkValueDraft } from "@/components/WorkValueEditor";
import { usePrefill } from "@/lib/profilePrefill";
import { linesToList, listToLines } from "@/lib/questBoard";

export default function QuestsTab({ password }: { password: string }) {
  const [quests, setQuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState({ title: "", description: "", circle: "" });
  // What a new quest is worth and pays (0265). Every quest carries a value from
  // the moment it is created (Rye, 2026-10-21), and the token boxes open on the
  // village's standard amounts once the options arrive.
  const options = usePayOptions();
  const offered = options?.quest ?? null;
  const currency = options?.currency ?? "";
  const [addingPay, setAddingPay] = useState<WorkValueDraft>({ value: "", tokens: {} });
  useEffect(() => {
    if (!options) return;
    setAddingPay((p) => (Object.keys(p.tokens).length ? p : { ...draftFrom(null, options.quest, options.currency), value: p.value }));
  }, [options]);
  // A quest handed over from a ReGen Civics file (ProfileImport.tsx): in the form, unposted, until Post is pressed.
  const [fromProfile, setFromProfile] = useState<{ needLabel: string | null } | null>(null);
  usePrefill("quest", (q) => { setAdding((a) => ({ ...a, title: q.title })); setFromProfile({ needLabel: q.needLabel }); });
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";
  // Suggestions come from the board itself, so an admin reuses the circle
  // names already in play instead of coining a near-miss the chips ignore.
  const questCircles = useMemo(
    () => Array.from(new Set(quests.map((q) => q?.circle).filter(Boolean))).sort() as string[],
    [quests],
  );
  const starters = quests.filter((q) => q?.isExample).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quests`);
      const data = await res.json();
      setQuests(Array.isArray(data) ? data : []);
    } catch { setQuests([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body?: unknown, method = "POST") => {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error || "That did not work");
      }
      return await res.json();
    } catch (e: any) {
      toast.error(e?.message || "That did not work");
      return null;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Quests</h2>
        <p className="text-sm text-gray-500 mt-1">
          The board members see. Edits are live immediately, no deploy. A quest with claims in
          flight cannot be deleted until those claims are consented or declined.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Post a quest</h3>
        {fromProfile && <p className="text-xs text-gray-600 mb-3">From your ReGen Civics profile{fromProfile.needLabel ? `, a quest that grows ${fromProfile.needLabel}` : ""}. Nothing is posted until you press Post quest. Add what it asks for, and a reward if you want one.</p>}
        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <label className="text-xs text-gray-500">Title
            <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          <label className="text-xs text-gray-500">What it asks for
            <input value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} className={`${inputCls} w-full mt-1`} />
          </label>
          {/* The state carried a circle from the day this form shipped and no
              field was ever bound to it, so every admin-posted quest landed
              with an empty circle: filtered off every chip on the board, and
              unplaceable on the map. */}
          <label className="text-xs text-gray-500">Circle
            <input value={adding.circle} onChange={(e) => setAdding({ ...adding, circle: e.target.value })}
              list="quest-circles" placeholder="Which circle?" className={`${inputCls} w-full mt-1`} />
            <datalist id="quest-circles">
              {questCircles.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <button
            onClick={async () => {
              if (!adding.title.trim()) return toast.error("Give it a title");
              const pay = draftToBody(addingPay, offered ?? [], currency, { required: true });
              if (!pay.ok) return toast.error(pay.error);
              const d = await call("/admin/quests", { ...adding, valueMinor: pay.valueMinor, valueTokens: pay.valueTokens, cashMinor: pay.cashMinor });
              if (d) {
                forgetExamplesCache("quests");
                toast.success("Posted");
                setAdding({ title: "", description: "", circle: "" });
                setAddingPay(options ? draftFrom(null, options.quest, options.currency) : { value: "", tokens: {} });
                setFromProfile(null);
                load();
              }
            }}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
          >
            Post quest
          </button>
        </div>
        <div className="mt-3 text-gray-700">
          <WorkValueEditor draft={addingPay} onChange={setAddingPay} offered={offered} currency={currency || null} cadence="once" inputClassName={inputCls} />
        </div>
      </div>

      {starters > 0 && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{starters === 1 ? "1 starter quest is" : `${starters} starter quests are`} waiting for you</p>
          <p className="mt-1">
            Nobody can claim a starter. Keep the ones that fit as real quests, then clear the rest.
            Posting a quest of your own clears every starter you have not kept.
          </p>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Clear the starter quests you have not kept? They are removed for good.")) return;
              const r = await call("/admin/modules/quests/examples/clear");
              if (r) {
                forgetExamplesCache("quests", { confirmed: true });
                toast.success("Starters cleared");
                load();
              }
            }}
            className="mt-2 min-h-[44px] px-3 rounded-md border border-amber-400 bg-white font-medium"
          >
            Clear the starters you have not kept
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : quests.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No quests on the board yet.</div>
      ) : (
        <div className="space-y-3">
          {quests.map((q: any) => {
            const base = {
              ...q,
              stepsText: listToLines(q.steps),
              tipsText: listToLines(q.tips),
              payDraft: draftFrom(q, offered ?? [], currency),
            };
            const d = draft[q.id] ?? base;
            // The dirty check projects every editable field, story layer
            // included, so a change buried in a collapsed section still
            // lights the Save button.
            const proj = (x: any, stepsText: string, tipsText: string) =>
              JSON.stringify({
                t: x.title, de: x.description, pv: x.payDraft, s: x.status, c: x.circle,
                su: x.subtitle ?? "", st: x.story ?? "", fs: x.firstStep ?? "",
                dv: x.deliverable ?? "", iu: x.imageUrl ?? "", im: x.impact ?? "",
                di: x.difficulty ?? "", du: x.duration ?? "",
                sl: stepsText, tl: tipsText,
              });
            const dirty =
              proj(d, d.stepsText ?? "", d.tipsText ?? "") !==
              proj(base, base.stepsText, base.tipsText);
            return (
              <div key={q.id} className="bg-white border border-gray-100 rounded-xl p-4">
                {/* On a fresh fork the whole board is examples. Without the
                    chip the admin found that out by editing one and reading
                    the 409 the edit route answers. */}
                {q.isExample && (
                  <p className="mb-2"><ExampleChip /></p>
                )}
                <div className="grid sm:grid-cols-4 gap-2 items-end">
                  <label className="text-xs text-gray-500">Title
                    <input value={d.title ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, title: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">What it asks for
                    <input value={d.description ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, description: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">Circle
                    <input value={d.circle ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, circle: e.target.value } })}
                      list="quest-circles" className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="text-xs text-gray-500">Status
                    <select value={d.status ?? "Open"} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, status: e.target.value } })} className={`${inputCls} w-full mt-1`}>
                      <option value="Open">Open</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </label>
                </div>

                {/* What it is worth and pays (0265). A quest with no list of its
                    own opens on the standard amounts, which is what it is paid. */}
                <div className="mt-3 text-gray-700">
                  <WorkValueEditor
                    draft={d.payDraft}
                    onChange={(payDraft) => setDraft({ ...draft, [q.id]: { ...d, payDraft } })}
                    offered={offered}
                    currency={currency || null}
                    cadence="once"
                    inputClassName={inputCls}
                  />
                </div>

                {/* The story layer (0068): everything a member reads on the
                    quest's own page. Collapsed by default so the board list
                    stays scannable; every field is optional and an empty one
                    simply does not render. */}
                <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
                  <summary className="text-xs font-semibold text-gray-600 cursor-pointer select-none">
                    Story, effort, steps, and poster
                  </summary>
                  <div className="grid sm:grid-cols-2 gap-2 mt-3">
                    {/* Difficulty, duration and impact were in the save payload
                        and in the dirty check from the day the story layer
                        shipped, with no field bound to any of them. The server
                        took all three and a founder had no door to reach them,
                        so every admin-posted quest kept whatever the seed left
                        behind. Difficulty is the load-bearing one: ringFor
                        reads it to place the quest on the board. */}
                    <label className="text-xs text-gray-500">Difficulty
                      {/* A select, because the three words are a vocabulary
                          the board reads: QuestCard colours by them,
                          the Quests filter chips match on them exactly, and
                          ringFor compares against "Beginner" character for
                          character. A typed "beginner" would drop the colour
                          and move the quest out of Start here with nothing
                          said. */}
                      <select value={d.difficulty ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, difficulty: e.target.value } })} className={`${inputCls} w-full mt-1`}>
                        <option value="">Not set</option>
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                        {/* A stored value outside the three shows itself. A
                            select whose value matches no option renders blank,
                            which would read as "Not set" over a row that holds
                            something, and the founder would save the blank
                            believing they changed nothing. */}
                        {d.difficulty && !["Beginner", "Intermediate", "Advanced"].includes(d.difficulty) && (
                          <option value={d.difficulty}>{d.difficulty} (not one of the three)</option>
                        )}
                      </select>
                    </label>
                    <label className="text-xs text-gray-500">Time it takes
                      <input value={d.duration ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, duration: e.target.value } })} placeholder="90 minutes, Two mornings, Flexible" className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">Subtitle
                      <input value={d.subtitle ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, subtitle: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">First step
                      <input value={d.firstStep ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, firstStep: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500 sm:col-span-2">Why it matters
                      <textarea value={d.story ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, story: e.target.value } })} rows={3} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    {/* A textarea, because the quest page prints this as a
                        pull quote under Why it matters and the seeded ones run
                        to two full sentences. */}
                    <label className="text-xs text-gray-500 sm:col-span-2">What changes because of it
                      <textarea value={d.impact ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, impact: e.target.value } })} rows={2} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">Steps, one per line
                      <textarea value={d.stepsText ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, stepsText: e.target.value } })} rows={4} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">Tips, one per line
                      <textarea value={d.tipsText ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, tipsText: e.target.value } })} rows={4} className={`${inputCls} w-full mt-1 resize-y`} />
                    </label>
                    <label className="text-xs text-gray-500">What they'll share
                      <input value={d.deliverable ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, deliverable: e.target.value } })} className={`${inputCls} w-full mt-1`} />
                    </label>
                    <label className="text-xs text-gray-500">Poster path
                      <input value={d.imageUrl ?? ""} onChange={(e) => setDraft({ ...draft, [q.id]: { ...d, imageUrl: e.target.value } })} placeholder="/api/uploads/quest-01.webp" className={`${inputCls} w-full mt-1`} />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Beginner places this quest in the board's Start here ring. Any other setting, and an empty one, place it under The village. A stage floor or a role requirement moves it to Further in whatever you pick.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-2">
                    A poster comes through the village's own upload, so its path starts with /api/uploads/. Leave it empty and the card paints a scene from the quest's circle.
                  </p>
                </details>
                {q.isExample ? (
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    <button
                      onClick={async () => {
                        // Required, the way posting a new quest requires it:
                        // a kept starter is a real quest from this moment.
                        const pay = draftToBody(d.payDraft, offered ?? [], currency, { required: true });
                        if (!pay.ok) return toast.error(pay.error);
                        const r = await call(`/admin/quests/${q.id}/keep`, {
                          title: d.title, description: d.description,
                          valueMinor: pay.valueMinor, valueTokens: pay.valueTokens, cashMinor: pay.cashMinor,
                          status: d.status, circle: d.circle,
                          subtitle: d.subtitle ?? "", story: d.story ?? "", firstStep: d.firstStep ?? "",
                          deliverable: d.deliverable ?? "", imageUrl: d.imageUrl ?? "",
                          difficulty: d.difficulty ?? "", duration: d.duration ?? "", impact: d.impact ?? "",
                          steps: linesToList(d.stepsText ?? ""), tips: linesToList(d.tipsText ?? ""),
                        });
                        if (r) {
                          if (!r.startersLeft) forgetExamplesCache("quests", { confirmed: true });
                          toast.success("Kept. It is a real quest now");
                          setDraft({ ...draft, [q.id]: undefined });
                          load();
                        }
                      }}
                      className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
                    >
                      Keep as a real quest
                    </button>
                    <span className="text-xs text-gray-500">Change anything above first, and set its value.</span>
                  </div>
                ) : (
                <div className="flex items-center gap-3 mt-3">
                  <button
                    disabled={!dirty}
                    onClick={async () => {
                      const pay = draftToBody(d.payDraft, offered ?? [], currency, { required: false });
                      if (!pay.ok) return toast.error(pay.error);
                      const r = await call(`/admin/quests/${q.id}`, {
                        title: d.title, description: d.description,
                        valueMinor: pay.valueMinor, valueTokens: pay.valueTokens, cashMinor: pay.cashMinor,
                        status: d.status, circle: d.circle,
                        subtitle: d.subtitle ?? "", story: d.story ?? "", firstStep: d.firstStep ?? "",
                        deliverable: d.deliverable ?? "", imageUrl: d.imageUrl ?? "",
                        difficulty: d.difficulty ?? "", duration: d.duration ?? "", impact: d.impact ?? "",
                        steps: linesToList(d.stepsText ?? ""), tips: linesToList(d.tipsText ?? ""),
                      }, "PUT");
                      if (r) { toast.success("Saved"); setDraft({ ...draft, [q.id]: undefined }); load(); }
                    }}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete "${q.title}"? Members will no longer see it.`)) return;
                      const r = await call(`/admin/quests/${q.id}`, undefined, "DELETE");
                      if (r) { toast.success("Deleted"); load(); }
                    }}
                    className="text-sm text-red-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
