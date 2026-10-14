/**
 * THE THREE WRITES THE LIBRARY MAKES, and nothing that decides anything.
 *
 *   `switchInOrder`  PUT /api/admin/modules/:id/lifecycle, one module at a
 *                    time, dependencies first, stopping at the first refusal
 *   `proposeTurnOn`  POST /api/game/mechanics/proposals with a
 *                    `module_lifecycle` change set: a binding village vote
 *   `dryRunTurnOn`   POST /api/game/mechanics/proposals/dry-run, which runs
 *                    the executor's own phase 1 and writes nothing
 *
 * Who may press which is the server's answer (`viewer` on the catalog, and the
 * switch route refuses whatever the page got wrong). The order is
 * `turnOnPlan` in shared/moduleSwitch.ts, the same function the server's rule
 * lives beside.
 */
import { authToken } from "@/lib/gameApi";
import { turnOnChangeSet, turnOnTitle, type PlanModule } from "@shared/moduleSwitch";
import type { ModuleLifecycle } from "@shared/modules";

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${authToken() ?? ""}`,
  "Content-Type": "application/json",
});

const sentence = (d: any, fallback: string): string => {
  for (const v of [d?.message, d?.error]) {
    const t = v == null ? "" : String(v).trim();
    if (t && t !== "auth_required") return t;
  }
  return fallback;
};

export interface SwitchOutcome {
  /** The modules that moved, in the order they moved. */
  done: string[];
  /** The first one the server refused, with its own words, or null when every one moved. */
  refused: { id: string; name: string; message: string; proposeInstead: boolean } | null;
}

/**
 * Move every module in `plan` to `to`, in order. A refusal stops the walk,
 * because a module after a refused dependency would be refused too and the
 * reader needs the first reason, not the last.
 */
export async function switchInOrder(
  plan: readonly PlanModule[],
  to: ModuleLifecycle,
  opts: { examples?: boolean } = {},
): Promise<SwitchOutcome> {
  const done: string[] = [];
  for (const m of plan) {
    let res: Response;
    try {
      res = await fetch(`/api/admin/modules/${encodeURIComponent(m.id)}/lifecycle`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ lifecycle: to, ...(opts.examples === false ? { examples: false } : {}) }),
      });
    } catch {
      return finish(done, { id: m.id, name: m.name, message: "That did not go through. Try again in a moment.", proposeInstead: false });
    }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      return finish(done, { id: m.id, name: m.name, message: sentence(d, "That change was refused."), proposeInstead: !!d?.proposeInstead });
    }
    done.push(m.id);
  }
  return finish(done, null);
}

function finish(done: string[], refused: SwitchOutcome["refused"]): SwitchOutcome {
  if (done.length) window.dispatchEvent(new Event("modules:changed"));
  return { done, refused };
}

export interface DryRun {
  wouldApply: boolean;
  blocker: { sentence: string } | null;
  landing: string;
  closesAt: string | null;
}

export async function dryRunTurnOn(plan: readonly PlanModule[], to: ModuleLifecycle): Promise<DryRun | null> {
  try {
    const res = await fetch("/api/game/mechanics/proposals/dry-run", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ changeSet: turnOnChangeSet(plan, to) }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      wouldApply: !!d?.wouldApply,
      blocker: d?.blocker ? { sentence: String(d.blocker.sentence ?? "") } : null,
      landing: String(d?.landing ?? ""),
      closesAt: d?.closesAt ? String(d.closesAt) : null,
    };
  } catch {
    return null;
  }
}

export type ProposeOutcome =
  | { ok: true; id: string; status: string; message: string }
  | { ok: false; message: string };

export async function proposeTurnOn(
  plan: readonly PlanModule[],
  to: ModuleLifecycle,
  reason: string,
): Promise<ProposeOutcome> {
  try {
    const res = await fetch("/api/game/mechanics/proposals", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: turnOnTitle(plan.map((m) => m.name)),
        rationale: reason.trim(),
        changes: turnOnChangeSet(plan, to),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const problems = Array.isArray(d?.problems) ? d.problems.map((p: any) => String(p?.problem ?? "")).filter(Boolean) : [];
      return { ok: false, message: problems.length ? problems.join(". ") : sentence(d, "The proposal was refused.") };
    }
    window.dispatchEvent(new Event("modules:changed"));
    return { ok: true, id: String(d.id), status: String(d.status), message: String(d.message ?? "") };
  } catch {
    return { ok: false, message: "That did not go through. Try again in a moment." };
  }
}

/** Where a proposal is read, supported and taken to a vote. */
export const proposalHref = (id: string) => `/game-mechanics?focus=proposal-${encodeURIComponent(id)}`;
