/**
 * TELL THE HOLDER (Rye, 2026-10-09: "Vote + tell the holder").
 *
 * After launch a member who wants a module on proposes it, and the proposal
 * goes to a binding village vote. Where somebody holds `module.switch`, that
 * holder could simply turn it on, so they are told: one notification per
 * holder per proposal, pointing at the module's page. The vote runs either
 * way; this only makes sure the person who could act knows there is a reason
 * to.
 *
 * Only a switch that turns a module ON or wider is worth a holder's time; a
 * proposal to narrow one is the village's business and the holder reads it on
 * the decisions page like anyone else. The proposer is never told about their
 * own proposal, even when they hold the switch themselves.
 */
import { MODULES_BY_ID, type ModuleLifecycle } from "../../shared/modules";
import { MODULE_SWITCH_KEY } from "../../shared/moduleSwitch";

type Notify = (input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorUserId?: string | null;
  dedupeKey: string;
}) => unknown;

export interface SwitchNoticeDeps {
  liveHoldersOf: (capability: string) => Promise<string[]>;
  notify: Notify;
}

const WIDE: ReadonlySet<ModuleLifecycle> = new Set<ModuleLifecycle>(["members", "public"]);

/** The module ids a normalized change set turns on for members or wider. */
export function modulesTurnedOn(changes: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    const item = c as { kind?: unknown; moduleId?: unknown; to?: unknown };
    if (item?.kind === "module_lifecycle" && typeof item.moduleId === "string" && WIDE.has(item.to as ModuleLifecycle)) {
      out.push(item.moduleId);
    }
  }
  return out;
}

/**
 * Notify every live holder of the switch about an open proposal. Never throws:
 * the proposal is already saved, and a notice that fails must not turn its
 * success into an error.
 */
export async function tellSwitchHolders(
  deps: SwitchNoticeDeps,
  p: { proposalId: string; proposerId: string; proposerFirstName: string; changes: readonly unknown[] },
): Promise<number> {
  try {
    const ids = modulesTurnedOn(p.changes);
    if (ids.length === 0) return 0;
    const holders = (await deps.liveHoldersOf(MODULE_SWITCH_KEY)).filter((h) => h !== p.proposerId);
    if (holders.length === 0) return 0;
    const names = ids.map((id) => MODULES_BY_ID[id]?.name ?? id);
    const what = names.join(" and ");
    let sent = 0;
    for (const userId of holders) {
      await deps.notify({
        userId,
        type: "governance",
        title: `${p.proposerFirstName} proposed turning on ${what}`,
        body: "The village votes on it. You hold the module switch, so you can also turn it on yourself from its page.",
        link: `/modules/${ids[0]}`,
        actorUserId: p.proposerId,
        dedupeKey: `module-switch-proposal:${p.proposalId}:${userId}`,
      });
      sent++;
    }
    return sent;
  } catch (e) {
    console.error("[modules] telling the switch holders failed (continuing)", e);
    return 0;
  }
}
