/**
 * Moving a form submission along its pipeline, and telling the admin what that did.
 *
 * MOVED OUT OF client/src/pages/Admin.tsx unchanged, so a second control could
 * call it: accepting a Work With Us proposal with the cash it pays (0285,
 * ProposalAcceptCash.tsx). The page is on the monolith ratchet
 * (scripts/check-file-lines.mjs), and two controls each carrying their own copy
 * of these sentences would drift apart.
 *
 * `extra` rides in the body beside the status; today that is only `cashMinor`.
 * Returns true when the server took the change, so the caller reloads.
 */
import { toast } from "sonner";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";

/**
 * The form types the Form Submissions filter offers. Moved out of client/src/pages/Admin.tsx unchanged.
 *
 * visit-inquiry and membership-508 were missing, and they are the two highest-value
 * submissions on the site: a request to walk the land, and a signed 508(c)(1)(a)
 * membership. Both were reachable only by scrolling "All types". The strings are
 * the ones the pages actually POST, from Visit.tsx and LoveLetter.tsx.
 * membership-request is somebody with no invitation asking to join, from
 * RequestMembership.tsx (Rye, 2026-09-09: requests sit in admin for a team to talk to them).
 */
export const FORM_TYPES = ["work-with-us", "quest-proposal", "visit-inquiry", "membership-508", "membership-request", "investor", "steward", "resident", "prosperity", "contact", "comms-change"] as const;

export async function putSubmissionStatus(
  password: string,
  id: string,
  status: string,
  type = "",
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/submissions/${id}/status`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ...extra, status }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (typeof data?.error === "string" && data.error) toast.error(data.error);
      else toast.error("Could not update status");
      return false;
    }
    if (data.rewarded) toast.success("Accepted. The member was welcomed into the game.");
    else if (data.admitted) toast.success("Accepted. They hold membership now.");
    // A stranger signed with no account, so the accept stands and admits nobody.
    else if (data.admitted === false) toast.success("Accepted. This signing carries no account, so nobody was admitted. Invite them to join.");
    // A yes to joining admits nobody, even from an account (a signing or vouches do), and names the next step:
    // for an account, the doors that do admit; for a stranger's form, with no account to reach, an invitation.
    else if (type === "membership-request" && status === "accepted") toast.success(data.notified ? "Accepted, and they have been told. A yes to a request admits nobody. Their signed letter, once accepted, or enough vouches will make them a member." : "Accepted. They have no account yet, so nobody was told. Make them a link under Invite somebody on your profile, and send it to the address on their request.", { duration: 12000 });
    else if (data.notified) toast.success("Status updated. The person who sent it has been told.");
    else toast.success("Status updated");
    return true;
  } catch {
    toast.error("Could not update status");
    return false;
  }
}
