/**
 * THE CONFLICT AGREEMENT EDITOR: block 8's answer, walked one frame at a time
 * (plan section 6.2). The Say frame for block 8 mounts it, and so does the
 * agreement's card on /governance.
 *
 * Eight frames, one per screen, in `AGREEMENT_FRAMES` order, each pre-filled
 * from what the village already has: its saved agreement, or its exit policy's
 * restorative steps, intake role, cover role, reply time and outside contact
 * (the server reads those as the agreement's defaults and writes nothing).
 * Practices start empty on purpose: they are offered as one tap each, and
 * nothing is filled in for a village that has not chosen them.
 *
 * WHO MAY SAVE IS THE SERVER'S ANSWER (`pen` on GET /api/conflict-agreement).
 * Before the Birthing the founders save a draft or adopt it; after it a
 * member holding `proposal.open` puts a change to the village as a vote. The
 * page offers only the button the server says is open, and the write is
 * refused by the server if the page is wrong.
 *
 * THE FORM CHECKS WITH THE SERVER'S OWN WORDS. `parseAgreementContent` and
 * `adoptionProblem` are the functions the route runs, so a refusal on this
 * page reads exactly like one from the server, and the frame it names opens.
 *
 * NO COUNT OF FRAMES. The frames are listed by name and the current one is
 * marked; nothing says how many are done (R55).
 *
 * Phone first: one column, full-width fields, 44px targets.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { ideasNotYetAdded, namedContacts, removeAt, rolesOtherThan, withRungWords } from "@/lib/agreementDraft";
import {
  AGREEMENT_FRAMES,
  APPEAL_NOT_ENFORCED,
  LADDER_RUNGS,
  OUTSIDE_CONTACTS_MAX,
  PRACTICES_MAX,
  SAFETY_CONTACTS_MAX,
  STEPS_MAX,
  adoptionProblem,
  parseAgreementContent,
  type AgreementFrameId,
  type ConflictAgreementContent,
  type ConflictAgreementForReaders,
  type LadderRungNumber,
} from "@shared/conflictAgreement";

interface RoleOption {
  id: string;
  name: string;
  liveHolders: number;
}

/** What GET /api/conflict-agreement answers. */
export interface AgreementPayload {
  stored: boolean;
  agreement: ConflictAgreementForReaders;
  roles: RoleOption[];
  platformSteps: boolean;
  pen: { how: "founders" | "ballot"; mayWrite: boolean; mayPropose: boolean };
  /** An open change vote, with what it would adopt as members read it (the vote's own page holds back names and the members-only parts). */
  openBallot: { id: string; title: string; closesAt: string; proposal: ConflictAgreementContent | null } | null;
}

/** The editable part: what the village writes. */
type Draft = Pick<
  ConflictAgreementForReaders,
  | "steps"
  | "careRole"
  | "coverRole"
  | "outsideContacts"
  | "whenPowerInvolved"
  | "safetyContacts"
  | "consequencesLadder"
  | "practices"
> & { replyHours: string; reviewDate: string };

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** Practices offered as one tap each. Never added until somebody taps one. */
export const PRACTICE_IDEAS = [
  { name: "Beginning Anew", when: "At each new moon gathering" },
  { name: "A check-in round", when: "At the start of each circle meeting" },
  { name: "A walk and talk", when: "Whenever two people feel a knot forming" },
] as const;

const draftOf = (a: ConflictAgreementForReaders): Draft => ({
  steps: a.steps.length ? a.steps.map((s) => ({ ...s })) : [{ what: "", whoInRoom: "" }],
  careRole: a.careRole,
  coverRole: a.coverRole,
  replyHours: a.replyHours === null ? "" : String(a.replyHours),
  outsideContacts: a.outsideContacts.map((c) => ({ ...c })),
  whenPowerInvolved: { ...a.whenPowerInvolved },
  safetyContacts: a.safetyContacts.map((c) => ({ ...c })),
  consequencesLadder: { rungs: a.consequencesLadder.rungs.map((r) => ({ ...r })), appeal: a.consequencesLadder.appeal },
  practices: a.practices.map((p) => ({ ...p })),
  reviewDate: a.reviewDate ?? "",
});

/** The body a save sends. */
const bodyOf = (d: Draft) => ({ ...d, replyHours: d.replyHours.trim() === "" ? null : d.replyHours.trim(), reviewDate: d.reviewDate || null });

const input = "w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";
const area = `${input} min-h-[72px]`;
const label = "block text-xs font-medium text-stone-600";
const smallButton = "min-h-[44px] rounded-lg border border-stone-300 px-3 text-sm text-stone-700 hover:bg-stone-50";
const primary = "min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-50";

function newContactId(taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`oc-${n}`)) n += 1;
  return `oc-${n}`;
}

function roleLabel(r: RoleOption): string {
  if (r.liveHolders === 0) return `${r.name}, nobody holds it today`;
  return `${r.name}, held by ${r.liveHolders === 1 ? "one person" : `${r.liveHolders} people`} today`;
}

export function ConflictAgreementEditor({ onDone }: { onDone?: () => void }) {
  const [payload, setPayload] = useState<AgreementPayload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [frame, setFrame] = useState<AgreementFrameId>("steps");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(null);
    fetch("/api/conflict-agreement", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLoadFailed(r.status === 401 ? "Sign in to read the conflict agreement." : String(d?.error ?? "The agreement could not be read just now."));
          return;
        }
        setPayload(d as AgreementPayload);
        setDraft(draftOf((d as AgreementPayload).agreement));
      })
      .catch(() => setLoadFailed("The agreement could not be read just now."));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const roleIds = useMemo(() => (payload?.roles ?? []).map((r) => r.id), [payload]);
  const canEdit = !!payload && (payload.pen.mayWrite || payload.pen.mayPropose);

  if (loadFailed) return <p role="status" className="text-sm text-stone-700">{loadFailed}</p>;
  if (!payload || !draft) return <p role="status" className="text-sm text-stone-600">Loading the conflict agreement…</p>;

  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
  };
  const current = AGREEMENT_FRAMES.find((f) => f.id === frame)!;
  const at = AGREEMENT_FRAMES.findIndex((f) => f.id === frame);

  /** Checks with the server's own rules, then sends. Resolves on the server's answer, never before it. */
  const send = async (kind: "draft" | "adopt" | "propose") => {
    setError(null);
    setNotice(null);
    const parsed = parseAgreementContent(bodyOf(draft), { roleIds });
    if (!parsed.ok) {
      setError(parsed.error);
      setFrame(parsed.frame);
      return;
    }
    if (kind !== "draft") {
      const today = new Date().toISOString().slice(0, 10);
      const problem = adoptionProblem(parsed.content, { today, platformSteps: [] });
      if (problem) {
        setError(problem.error);
        setFrame(problem.frame);
        return;
      }
    }
    setBusy(true);
    try {
      const r =
        kind === "propose"
          ? await fetch("/api/governance/conflict-agreement-changes", { method: "POST", headers: headers(), body: JSON.stringify({ agreement: bodyOf(draft) }) })
          : await fetch("/api/admin/conflict-agreement", { method: "PUT", headers: headers(), body: JSON.stringify({ agreement: bodyOf(draft), adopt: kind === "adopt" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(String(d?.error ?? "That was not saved."));
        if (d?.frame) setFrame(d.frame as AgreementFrameId);
        return;
      }
      if (kind === "propose") {
        setNotice(`The vote is open until ${new Date(d.ballot.closesAt).toLocaleDateString()}. Every member on the roll has been told.`);
      } else if (!d.changed) {
        setNotice("Nothing changed: this is what the village already has on record.");
      } else {
        setNotice(kind === "adopt" ? "Adopted. The exit policy and the governance page read it from now on." : "Saved as a draft. The exit policy reads it from now on.");
      }
      load();
      onDone?.();
    } catch {
      setError("That did not reach the server, so nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const a = payload.agreement;
  const adoptedLine = a.adoptedAt
    ? `Adopted on ${new Date(a.adoptedAt).toLocaleDateString()} ${a.adoptedHow === "ballot" ? "by the village's vote" : "by the founders, before the Game started"}.`
    : payload.stored
      ? "Saved as a draft. Nobody has adopted it yet."
      : "Not written yet. What you see is drawn from the exit policy's restorative path.";

  return (
    <section aria-label="The conflict agreement" className="space-y-4 text-stone-700">
      <nav aria-label="Frames">
        <ol className="flex flex-wrap gap-2">
          {AGREEMENT_FRAMES.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                aria-current={f.id === frame ? "step" : undefined}
                onClick={() => setFrame(f.id)}
                className={`min-h-[44px] rounded-full px-3 text-xs font-medium border ${
                  f.id === frame ? "bg-teal-deep text-white border-teal-deep" : "border-stone-300 text-stone-700 hover:bg-stone-50"
                }`}
              >
                {f.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
        <h3 className="font-semibold text-stone-900">{current.question}</h3>
        <p className="text-xs text-stone-600">{current.hint}</p>
        <fieldset disabled={!canEdit || busy} className="space-y-3">
          {frame === "steps" && (
            <>
              {payload.platformSteps && (
                <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  These are still the platform's starting steps. Write them in the village's own words before adopting them.
                </p>
              )}
              {draft.steps.map((s, i) => (
                <div key={i} className="rounded-lg border border-stone-200 p-3 space-y-2">
                  <label className={label}>
                    Step {i + 1}: what happens
                    <textarea
                      className={area}
                      value={s.what}
                      onChange={(e) => set({ steps: draft.steps.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)) })}
                    />
                  </label>
                  <label className={label}>
                    Who is in the room
                    <input
                      className={input}
                      value={s.whoInRoom}
                      placeholder="For example: the two of us and the care holder"
                      onChange={(e) => set({ steps: draft.steps.map((x, j) => (j === i ? { ...x, whoInRoom: e.target.value } : x)) })}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {i > 0 && (
                      <button
                        type="button"
                        className={smallButton}
                        onClick={() => {
                          const next = [...draft.steps];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          set({ steps: next });
                        }}
                      >
                        Move up
                      </button>
                    )}
                    {draft.steps.length > 1 && (
                      <button type="button" className={smallButton} onClick={() => set({ steps: removeAt(draft.steps, i) })}>
                        Remove this step
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {draft.steps.length < STEPS_MAX && (
                <button type="button" className={smallButton} onClick={() => set({ steps: [...draft.steps, { what: "", whoInRoom: "" }] })}>
                  Add a step
                </button>
              )}
              <details className="text-xs text-stone-600">
                <summary className="cursor-pointer font-medium text-teal-deep">An example, to read and not to copy</summary>
                <ol className="mt-2 list-decimal pl-5 space-y-1">
                  <li>The two of us talk it through, in person. In the room: the two of us.</li>
                  <li>If that does not settle it, we ask the care holder to sit with us. In the room: the two of us and the care holder.</li>
                  <li>If it is still stuck, a circle hears it. In the room: the two of us, the care holder and the circle.</li>
                </ol>
              </details>
            </>
          )}

          {frame === "care" && (
            <>
              <label className={label}>
                The care role: who hears a request first
                <select className={input} value={draft.careRole} onChange={(e) => set({ careRole: e.target.value, coverRole: e.target.value && e.target.value !== draft.coverRole ? draft.coverRole : "" })}>
                  <option value="">No role chosen</option>
                  {payload.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                The cover role: who hears it when the care role cannot
                <select className={input} value={draft.coverRole} disabled={!draft.careRole} onChange={(e) => set({ coverRole: e.target.value })}>
                  <option value="">No cover</option>
                  {rolesOtherThan(payload.roles, draft.careRole).map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm font-medium text-stone-900">Contacts outside the village</p>
              <p className="text-xs text-stone-600">
                The public page names them by organisation or role. Members see the name and how to reach them, and can ask them to talk.
              </p>
              {draft.outsideContacts.map((c, i) => (
                <div key={c.id} className="rounded-lg border border-stone-200 p-3 space-y-2">
                  {(["name", "organisation", "role", "howToReach"] as const).map((field) => (
                    <label key={field} className={label}>
                      {{ name: "Their name", organisation: "Organisation", role: "Their role here, such as cohort ombuds", howToReach: "How to reach them" }[field]}
                      <input
                        className={input}
                        value={c[field]}
                        onChange={(e) => set({ outsideContacts: draft.outsideContacts.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)) })}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() =>
                      set({
                        outsideContacts: removeAt(draft.outsideContacts, i),
                        whenPowerInvolved:
                          draft.whenPowerInvolved.outsideContactId === c.id ? { ...draft.whenPowerInvolved, outsideContactId: "" } : draft.whenPowerInvolved,
                      })
                    }
                  >
                    Remove this contact
                  </button>
                </div>
              ))}
              {draft.outsideContacts.length < OUTSIDE_CONTACTS_MAX && (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() =>
                    set({
                      outsideContacts: [
                        ...draft.outsideContacts,
                        { id: newContactId(draft.outsideContacts.map((c) => c.id)), name: "", organisation: "", role: "", howToReach: "" },
                      ],
                    })
                  }
                >
                  Add a contact outside the village
                </button>
              )}
            </>
          )}

          {frame === "reply" && (
            <label className={label}>
              Hours until someone who reaches out hears back
              <input className={input} inputMode="numeric" value={draft.replyHours} placeholder="The village chooses" onChange={(e) => set({ replyHours: e.target.value })} />
            </label>
          )}

          {frame === "power" && (
            <>
              <label className={label}>
                Who holds it instead
                <select
                  className={input}
                  value={draft.whenPowerInvolved.roleId ? `role:${draft.whenPowerInvolved.roleId}` : draft.whenPowerInvolved.outsideContactId ? `contact:${draft.whenPowerInvolved.outsideContactId}` : ""}
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(":");
                    set({
                      whenPowerInvolved: {
                        ...draft.whenPowerInvolved,
                        roleId: kind === "role" ? id : "",
                        outsideContactId: kind === "contact" ? id : "",
                      },
                    });
                  }}
                >
                  <option value="">Not named yet</option>
                  {rolesOtherThan(payload.roles, draft.careRole).map((r) => (
                    <option key={r.id} value={`role:${r.id}`}>
                      {roleLabel(r)}
                    </option>
                  ))}
                  {namedContacts(draft.outsideContacts).map((c) => (
                    <option key={c.id} value={`contact:${c.id}`}>
                      {c.name}, outside the village
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                In the village's own words
                <textarea className={area} value={draft.whenPowerInvolved.words} onChange={(e) => set({ whenPowerInvolved: { ...draft.whenPowerInvolved, words: e.target.value } })} />
              </label>
            </>
          )}

          {frame === "safety" && (
            <>
              <p className="text-xs rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-stone-700">
                If anyone is in danger now, the first call is to local emergency services. These contacts come after that, and nothing here contacts anyone on its own.
              </p>
              {draft.safetyContacts.map((c, i) => (
                <div key={i} className="rounded-lg border border-stone-200 p-3 space-y-2">
                  {(["name", "howToReach", "when"] as const).map((field) => (
                    <label key={field} className={label}>
                      {{ name: "Who", howToReach: "How to reach them", when: "When to call them" }[field]}
                      <input
                        className={input}
                        value={c[field]}
                        onChange={(e) => set({ safetyContacts: draft.safetyContacts.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)) })}
                      />
                    </label>
                  ))}
                  <button type="button" className={smallButton} onClick={() => set({ safetyContacts: removeAt(draft.safetyContacts, i) })}>
                    Remove this contact
                  </button>
                </div>
              ))}
              {draft.safetyContacts.length < SAFETY_CONTACTS_MAX && (
                <button type="button" className={smallButton} onClick={() => set({ safetyContacts: [...draft.safetyContacts, { name: "", howToReach: "", when: "" }] })}>
                  Add a safety contact
                </button>
              )}
            </>
          )}

          {frame === "ladder" && (
            <>
              {([1, 2, 3, 4] as LadderRungNumber[]).map((rung) => {
                const mine = draft.consequencesLadder.rungs.find((r) => r.rung === rung);
                const setWords = (words: string) => {
                  set({ consequencesLadder: { ...draft.consequencesLadder, rungs: withRungWords(draft.consequencesLadder.rungs, rung, words) } });
                };
                return (
                  <label key={rung} className={label}>
                    <span className="text-sm font-medium text-stone-900">{LADDER_RUNGS[rung].name}</span>
                    <span className="block text-xs text-stone-600">{LADDER_RUNGS[rung].rule}</span>
                    <textarea className={area} value={mine?.words ?? ""} placeholder="Leave empty if this village does not use this rung" onChange={(e) => setWords(e.target.value)} />
                  </label>
                );
              })}
              <label className={label}>
                How someone appeals
                <textarea
                  className={area}
                  value={draft.consequencesLadder.appeal}
                  onChange={(e) => set({ consequencesLadder: { ...draft.consequencesLadder, appeal: e.target.value } })}
                />
              </label>
              <p className="text-xs text-stone-600">{APPEAL_NOT_ENFORCED}</p>
            </>
          )}

          {frame === "practices" && (
            <>
              {draft.practices.map((p, i) => (
                <div key={i} className="rounded-lg border border-stone-200 p-3 space-y-2">
                  <label className={label}>
                    The practice
                    <input className={input} value={p.name} onChange={(e) => set({ practices: draft.practices.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  </label>
                  <label className={label}>
                    When
                    <input className={input} value={p.when} onChange={(e) => set({ practices: draft.practices.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })} />
                  </label>
                  <button type="button" className={smallButton} onClick={() => set({ practices: removeAt(draft.practices, i) })}>
                    Remove this practice
                  </button>
                </div>
              ))}
              {draft.practices.length < PRACTICES_MAX && (
                <>
                  <button type="button" className={smallButton} onClick={() => set({ practices: [...draft.practices, { name: "", when: "" }] })}>
                    Add a practice
                  </button>
                  <p className="text-xs text-stone-600">Ideas other villages keep, added only if you tap one:</p>
                  <div className="flex flex-wrap gap-2">
                    {ideasNotYetAdded(PRACTICE_IDEAS, draft.practices).map((idea) => (
                      <button key={idea.name} type="button" className={smallButton} onClick={() => set({ practices: [...draft.practices, { ...idea }] })}>
                        {idea.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {frame === "adoption" && (
            <>
              <p className="text-sm text-stone-900">{adoptedLine}</p>
              <label className={label}>
                The date it comes back for review
                <input className={input} type="date" value={draft.reviewDate} onChange={(e) => set({ reviewDate: e.target.value })} />
              </label>
            </>
          )}
        </fieldset>
      </div>

      {error && (
        <p role="alert" className="text-sm rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={smallButton} disabled={at === 0} onClick={() => setFrame(AGREEMENT_FRAMES[at - 1].id)}>
          Back
        </button>
        <button type="button" className={smallButton} disabled={at === AGREEMENT_FRAMES.length - 1} onClick={() => setFrame(AGREEMENT_FRAMES[at + 1].id)}>
          Next
        </button>
      </div>

      {payload.pen.mayWrite && (
        <div className="flex flex-wrap gap-2">
          {!a.adoptedAt && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => void send("draft")}>
              Save as a draft
            </button>
          )}
          <button type="button" className={primary} disabled={busy} onClick={() => void send("adopt")}>
            {a.adoptedAt ? "Adopt this new version" : "Adopt it"}
          </button>
        </div>
      )}
      {payload.pen.mayPropose && !payload.openBallot && (
        <button type="button" className={primary} disabled={busy} onClick={() => void send("propose")}>
          Put this change to the village
        </button>
      )}
      {payload.openBallot && (
        <p className="text-sm text-stone-700">
          A vote on changing the agreement is open until {new Date(payload.openBallot.closesAt).toLocaleDateString()}.{" "}
          <a className="font-medium text-teal-deep underline" href={`/decisions/${payload.openBallot.id}`}>
            Read it and vote
          </a>
          .
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-stone-600">
          {payload.pen.how === "founders"
            ? "Until the Game starts, the founders write this agreement. You can read every frame here."
            : "Changing this agreement opens a vote of the whole village, which takes somebody holding proposal.open as a member."}
        </p>
      )}
    </section>
  );
}

export default ConflictAgreementEditor;
