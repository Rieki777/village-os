/**
 * The access bundle at a role's start and end.
 *
 * START raises one grant task per item for the granting role (or the admins
 * when the item names none). END raises one revoke task per item that was
 * ever granted or asked for. A task names the item and its state and nothing
 * else: no credential, username or link is stored (shared/accessBundle.ts).
 * Jobs only remind; a person does the granting and marks the task done.
 */
import type { Pool } from "mysql2/promise";
import { readAccessBundle, type AccessItem } from "../../shared/accessBundle";
import {
  accessBundleOf,
  insertTaskIfAbsent,
  liveHolderIds,
  seatingFacts,
  tasksForAssignment,
  type AccessTaskRow,
} from "../repos/roleAccess";

export interface AccessNoticeDeps {
  notify: (input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => Promise<unknown>;
  notifyAdmins: (type: string, title: string, dedupeKey: string, link?: string) => Promise<unknown>;
}

export const ACCESS_TASKS_LINK = "/admin?tab=org";
const MY_ACCESS_LINK = "/season-plan";

async function tell(
  pool: Pool,
  deps: AccessNoticeDeps | undefined,
  item: AccessItem,
  kind: "grant" | "revoke",
  assignmentId: string,
  roleName: string,
): Promise<void> {
  if (!deps) return;
  const title = kind === "grant" ? `Access to give for ${roleName}: ${item.label}` : `Access to take back for ${roleName}: ${item.label}`;
  const key = `access-${kind}:${assignmentId}:${item.key}`;
  try {
    const holders = item.grantingRoleId ? await liveHolderIds(pool, item.grantingRoleId) : [];
    if (holders.length) {
      for (const userId of holders) {
        await deps.notify({ userId, type: "role_access", title, body: null, link: ACCESS_TASKS_LINK, dedupeKey: `${key}:${userId}` });
      }
    } else {
      await deps.notifyAdmins("role_access", title, `${key}:admins`, ACCESS_TASKS_LINK);
    }
  } catch {
    /* A notice that fails never undoes the task: the row is the record. */
  }
}

/** Raise grant tasks for a role that has just started. Idempotent per seating and item. */
export async function raiseGrantTasks(pool: Pool, assignmentId: string, deps?: AccessNoticeDeps): Promise<number> {
  const seat = await seatingFacts(pool, assignmentId);
  if (!seat || seat.holderKind !== "member") return 0;
  const items = readAccessBundle(await accessBundleOf(pool, seat.orgRoleId));
  let made = 0;
  for (const item of items) {
    const fresh = await insertTaskIfAbsent(pool, {
      assignmentId,
      orgRoleId: seat.orgRoleId,
      holderUserId: seat.userId,
      itemKey: item.key,
      itemLabel: item.label,
      kind: "grant",
      grantingRoleId: item.grantingRoleId,
    });
    if (fresh) {
      made += 1;
      await tell(pool, deps, item, "grant", assignmentId, seat.roleName);
    }
  }
  return made;
}

/**
 * Raise revoke tasks for a role that has ended. Items come from the grant
 * tasks that exist, so a card edited since the start cannot hide a grant that
 * was made; the card's current list is added for items never raised.
 */
export async function raiseRevokeTasks(pool: Pool, assignmentId: string, deps?: AccessNoticeDeps): Promise<number> {
  const seat = await seatingFacts(pool, assignmentId);
  if (!seat || seat.holderKind !== "member") return 0;
  const granted = (await tasksForAssignment(pool, assignmentId)).filter((t) => t.kind === "grant" && t.state !== "not_needed");
  const items = new Map<string, AccessItem>();
  for (const t of granted) items.set(t.itemKey, { key: t.itemKey, label: t.itemLabel, grantingRoleId: t.grantingRoleId });
  let made = 0;
  for (const item of Array.from(items.values())) {
    const fresh = await insertTaskIfAbsent(pool, {
      assignmentId,
      orgRoleId: seat.orgRoleId,
      holderUserId: seat.userId,
      itemKey: item.key,
      itemLabel: item.label,
      kind: "revoke",
      grantingRoleId: item.grantingRoleId,
    });
    if (fresh) {
      made += 1;
      await tell(pool, deps, item, "revoke", assignmentId, seat.roleName);
    }
  }
  return made;
}

/** What the new holder sees: each item and where it stands. */
export function holderView(tasks: AccessTaskRow[]): Array<{ id: string; label: string; state: AccessTaskRow["state"] }> {
  return tasks.filter((t) => t.kind === "grant").map((t) => ({ id: t.id, label: t.itemLabel, state: t.state }));
}
