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
import { JOIN_ANSWER_WORDS, JOIN_REQUEST_TYPE } from "@shared/joinAnswers";

/**
 * A yes or a no to a request to join, said out loud (sheet A5): the server
 * emails the invitation, or a kind no, to the address the person typed
 * (server/routes/joinAnswers.ts). The sentence says what went and where, and
 * the invitation link stays on screen with a copy button until it is closed,
 * so a send that could not go is never a silent success.
 */
async function answerJoinRequest(password: string, id: string, answer: "accept" | "decline"): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/join-requests/${encodeURIComponent(id)}/${answer}`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(typeof data?.error === "string" && data.error ? data.error : "Could not answer the request");
      return false;
    }
    const message = typeof data?.message === "string" ? data.message : "Done";
    const link = typeof data?.link === "string" && data.link ? data.link : null;
    if (!link) {
      toast.success(message);
      return true;
    }
    const show = data?.emailed ? toast.success : toast.warning;
    show(message, {
      description: link,
      duration: data?.emailed ? 12000 : Infinity,
      closeButton: true,
      action: {
        label: JOIN_ANSWER_WORDS.copyLink,
        onClick: () => {
          void navigator.clipboard?.writeText(link).catch(() => undefined);
        },
      },
    });
    return true;
  } catch {
    toast.error("Could not answer the request");
    return false;
  }
}

export async function putSubmissionStatus(
  password: string,
  id: string,
  status: string,
  type = "",
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  if (type === JOIN_REQUEST_TYPE && (status === "accepted" || status === "declined")) {
    return answerJoinRequest(password, id, status === "accepted" ? "accept" : "decline");
  }
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
    // A yes or a no to a request to join goes through `answerJoinRequest` above, which emails it.
    else if (data.notified) toast.success("Status updated. The person who sent it has been told.");
    else toast.success("Status updated");
    return true;
  } catch {
    toast.error("Could not update status");
    return false;
  }
}
