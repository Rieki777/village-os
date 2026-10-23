/**
 * Step 1: PICK YOUR ROLES (role proposals PR C).
 *
 * The village's roles from `/api/org`, in three groups: the roles you hold
 * now, open roles (a place free), and roles someone else holds now. Each says
 * its circle and the circle's purpose, and who else holds it or is applying,
 * as counts: nobody is named (Rye, 2026-10-22). Or propose a new role, which
 * sits in a circle the member picks.
 *
 * At most five, across existing and new (`limits.maxRoles`). Once five are
 * picked the rest are disabled and the count says why.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ProposalOut, OrgCircleIn, OrgRoleIn } from "./proposalApi";
import { RP_WORDS } from "./proposalWords";
import { FOCUS, INPUT, LEDE, PANEL, PRIMARY, QUIET } from "./parts";

export interface OrgView {
  roles: OrgRoleIn[];
  circles: OrgCircleIn[];
}

type Group = "youHold" | "open" | "othersHold";

export interface StepRolesProps {
  proposal: ProposalOut;
  /** The existing roles picked, in the order picked. */
  picked: readonly string[];
  newRoles: ReadonlyArray<{ id: string; name: string; circleName: string | null }>;
  org: OrgView | null | "failed";
  /** Other members' applications waiting, by role id. */
  applying: ReadonlyMap<string, number>;
  me: string;
  onToggle: (roleId: string) => void;
  onAddNew: (circleId: string, name: string) => Promise<string | null>;
  onRemoveNew: (id: string) => void;
}

const holderIds = (r: OrgRoleIn): string[] => (r.holders ?? []).map((h) => String(h?.userId ?? "")).filter(Boolean);

/** Which group a role sits in, for this member. */
export function groupOf(r: OrgRoleIn, me: string): Group {
  if (me && holderIds(r).includes(me)) return "youHold";
  const held = r.holderCount ?? holderIds(r).length;
  return held < (r.seats || 1) ? "open" : "othersHold";
}

/** The facts under a role's name: who holds it and who is applying, as counts. */
export function roleFacts(r: OrgRoleIn, me: string, applying: number): string[] {
  const mine = !!me && holderIds(r).includes(me);
  const held = r.holderCount ?? holderIds(r).length;
  const others = mine ? held - 1 : held;
  const of = r.seats || 1;
  const out: string[] = [];
  if (mine) out.push(RP_WORDS.youHoldThis);
  if (others > 0) out.push(RP_WORDS.heldBy(others));
  out.push(held < of ? RP_WORDS.places(of - held, of) : RP_WORDS.everyPlaceHeld);
  if (applying > 0) out.push(RP_WORDS.applying(applying));
  return out;
}

export default function StepRoles({ proposal, picked, newRoles, org, applying, me, onToggle, onAddNew, onRemoveNew }: StepRolesProps) {
  const max = proposal.limits.maxRoles;
  const count = picked.length + newRoles.length;
  const atMost = count >= max;
  const [circleId, setCircleId] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const circles = org && org !== "failed" ? org.circles.filter((c) => !c.isExample && c.status !== "retired") : [];
  const circleOf = (id: string | null) => (id ? circles.find((c) => c.id === id) ?? null : null);
  const roles = org && org !== "failed" ? org.roles.filter((r) => !r.isExample) : [];
  // A role the draft names that the chart no longer offers stays listed, so it is never dropped unseen.
  const strays = proposal.roles.filter((r) => picked.includes(r.roleId) && !roles.some((o) => o.id === r.roleId));

  const add = async () => {
    setSaid(null);
    if (!circleId || !name.trim()) return;
    setAdding(true);
    const problem = await onAddNew(circleId, name.trim());
    setAdding(false);
    if (problem) setSaid(problem);
    else {
      setName("");
      setCircleId("");
    }
  };

  const groups: Array<{ key: Group; heading: string }> = [
    { key: "youHold", heading: RP_WORDS.youHold },
    { key: "open", heading: RP_WORDS.open },
    { key: "othersHold", heading: RP_WORDS.othersHold },
  ];

  const roleRow = (r: OrgRoleIn) => {
    const on = picked.includes(r.id);
    const circle = circleOf(r.circleId);
    const id = `rp-pick-${r.id}`;
    return (
      <li key={r.id}>
        <label
          htmlFor={id}
          className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? "border-teal-deep bg-teal-deep/5" : "border-stone-200 bg-white hover:bg-stone-50"}`}
        >
          <input
            id={id}
            type="checkbox"
            checked={on}
            disabled={!on && atMost}
            onChange={() => onToggle(r.id)}
            className={`mt-0.5 size-5 shrink-0 accent-teal-deep ${FOCUS}`}
          />
          <span className="grid min-w-0 gap-0.5">
            <span className="break-words font-semibold text-stone-900">{r.name}</span>
            <span className="break-words text-sm text-stone-600">{circle ? RP_WORDS.circleLine(circle.name, circle.purpose ?? null) : RP_WORDS.noCircle}</span>
            <span className="text-xs text-stone-600" data-role-facts="">
              {roleFacts(r, me, applying.get(r.id) ?? 0).join(". ")}.
            </span>
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="grid gap-4">
      <p className={LEDE}>{RP_WORDS.rolesLede}</p>
      <p className="text-sm font-medium text-stone-800" aria-live="polite" data-picked-count="">
        {RP_WORDS.picked(count, max)}
        {atMost ? ` ${RP_WORDS.atMost(max)}` : ""}
      </p>

      {org === null && <p className="text-sm text-stone-600">{RP_WORDS.loadingRoles}</p>}
      {org === "failed" && <p className="text-sm text-coral">{RP_WORDS.rolesFailed}</p>}
      {org && org !== "failed" && roles.length === 0 && <p className="text-sm text-stone-600">{RP_WORDS.noRolesYet}</p>}

      {groups.map((g) => {
        const list = roles.filter((r) => groupOf(r, me) === g.key);
        if (!list.length && !(g.key === "youHold" && strays.length)) return null;
        return (
          <fieldset key={g.key} className="grid min-w-0 gap-2" data-pick-group={g.key}>
            <legend className="mb-1 text-sm font-semibold text-stone-800">{g.heading}</legend>
            <ul className="grid gap-2">
              {list.map(roleRow)}
              {g.key === "youHold" &&
                strays.map((s) => (
                  <li key={s.roleId}>
                    <label className="flex min-h-[44px] items-center gap-3 rounded-lg border border-teal-deep bg-teal-deep/5 p-3">
                      <input type="checkbox" checked onChange={() => onToggle(s.roleId)} className={`size-5 accent-teal-deep ${FOCUS}`} />
                      <span className="break-words font-semibold text-stone-900">{s.name}</span>
                    </label>
                  </li>
                ))}
            </ul>
          </fieldset>
        );
      })}

      {newRoles.length > 0 && (
        <ul className="grid gap-2" aria-label={RP_WORDS.newRoleTag}>
          {newRoles.map((r) => (
            <li key={r.id} className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-notice border-l-4 bg-notice/10 p-3">
              <span className="grid min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-notice">{RP_WORDS.newRoleTag}</span>
                <span className="break-words font-semibold text-stone-900">{r.name}</span>
                {r.circleName && <span className="text-sm text-stone-600">{r.circleName}</span>}
              </span>
              <button type="button" onClick={() => onRemoveNew(r.id)} aria-label={RP_WORDS.removeNewRole(r.name)} className={`${QUIET} min-w-[44px] justify-center`}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`${PANEL} grid gap-3`} data-new-role-form="">
        <h3 className="font-semibold text-stone-900">{RP_WORDS.newRoleHeading}</h3>
        <p className={LEDE}>{RP_WORDS.newRoleLede}</p>
        {org && org !== "failed" && circles.length === 0 ? (
          <p className="text-sm text-stone-600">{RP_WORDS.noCircles}</p>
        ) : (
          <>
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {RP_WORDS.newRoleCircle}
              <select value={circleId} onChange={(e) => setCircleId(e.target.value)} className={`${INPUT} min-h-[44px]`} disabled={atMost}>
                <option value="">{RP_WORDS.pickCircle}</option>
                {circles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-stone-800">
              {RP_WORDS.newRoleName}
              <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={`${INPUT} min-h-[44px]`} disabled={atMost} />
            </label>
            <div>
              <button type="button" onClick={() => void add()} disabled={atMost || adding || !circleId || !name.trim()} className={PRIMARY}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {RP_WORDS.addNewRole}
              </button>
            </div>
            {said && (
              <p role="alert" className="text-sm text-coral">
                {said}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
