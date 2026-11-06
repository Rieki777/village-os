/**
 * THE ADMIN READS EVERY MEMBER MAY MAKE (Rye, Q5, 2026-11-01; ROLE_POWERS_DESIGN.md §4.5).
 *
 * "The admin panel should be open to ALL members to see. They need the power
 * to change something without a vote." This is the server's half of SEEING:
 * a short list of admin GET routes a signed-in member at the member stage or
 * past it may read. Changing anything still needs the admin or the power.
 *
 * AN ALLOW-LIST, AND IT FAILS CLOSED. A route is readable only once somebody
 * has read its handler and written it here with the reason it serves nothing
 * private. A route that is not listed stays the admin's, so a new admin read
 * never opens to members by accident (memory: a derived allow-list beside a
 * hand-kept deny-list fails open). The design names what stays holders-only:
 * secrets, other people's private data, report queues, cash owed per member,
 * and the full audit trail.
 *
 * Members, not visitors: a guest, a signed-out visitor and a former member
 * read none of it.
 */

/** `GET /api/admin/...` as Express registers it, to why it is safe for every member. */
export const MEMBER_READABLE_ADMIN_GETS: Readonly<Record<string, string>> = {
  "/api/admin/capabilities/holding":
    "Which powers the village holds, which groups carry what and how many hold each. Role-level only; no person is named.",
  "/api/admin/org/drafts":
    "The village's reorganisation drafts. Anyone may propose a change to the structure (Rye, 2026-09-24), so the drafts are the village's business.",
  "/api/admin/org/drafts/:id/preview": "What one reorganisation draft would change, role by role.",
  "/api/admin/org/expiring":
    "Roles whose holder's term is running out, named by role and first name, which the map already shows every account (map.viewPeople).",
};

/** Whether this request is a member read the list allows. Pure: the caller answers who the person is. */
export function isMemberReadable(method: string, routePath: unknown, isMember: boolean): boolean {
  if (!isMember || method.toUpperCase() !== "GET" || typeof routePath !== "string") return false;
  return Object.prototype.hasOwnProperty.call(MEMBER_READABLE_ADMIN_GETS, routePath);
}
