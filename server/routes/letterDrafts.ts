/**
 * THE LETTERS SCREEN, over HTTP (role journey L13). Admin only.
 *
 *   GET  /api/admin/letter-drafts              the drafted letters waiting, with where each would go
 *   PUT  /api/admin/letter-drafts/:id          a person edits the subject and the words
 *   POST /api/admin/letter-drafts/:id/send     a person sends it, through the village's mail door
 *   POST /api/admin/letter-drafts/:id/discard  a person throws it away
 *
 * SENDING IS A PERSON'S ACT. The connector drafts into the queue and has no tool
 * for any route here; these paths are on the always-a-person list
 * (shared/agentAdmin.ts), so they cannot be reached through `admin_request`
 * even if an admin lists them. A send goes through the same post office as
 * every other mail, and an address on the suppression list gets nothing: the
 * person is told, and the letter stays waiting until they discard it.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { recordEvent } from "../lib/events";
import { recipientFor } from "../lib/letterRecipient";
import { isSuppressed } from "../lib/comms/suppressions";
import { editWaitingLetter, listAllWaitingLetters, proposalById, resolveProposal, type StoredProposal } from "../repos/agentProposals";
import { SEND_WORDS, letterTitle, parseLetterEdit, splitLetterTitle } from "../../shared/agentProposals";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "isAdmin" | "overLimit" | "members"> & {
  postEmail: (email: OutgoingEmail) => Promise<PostResult>;
  escapeHtml: (s: string) => string;
};

const WENT: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["sending", "sent", "delivered", "duplicate"]);

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, isAdmin, overLimit, members, postEmail, escapeHtml } = deps;

  /** The admin, or null after answering 401. */
  async function admin(req: any, res: any): Promise<any | null> {
    if (!(await isAdmin(req))) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    return user;
  }

  const waitingLetter = async (id: string): Promise<StoredProposal | null> => {
    const p = await proposalById(getPool(), id);
    return p && p.kind === "letter" && p.status === "waiting" ? p : null;
  };

  app.get("/api/admin/letter-drafts", async (req, res) => {
    if (!(await admin(req, res))) return;
    const pool = getPool();
    const letters = await listAllWaitingLetters(pool);
    const out = [];
    for (const l of letters) {
      const to = l.applicationRef ? await recipientFor(pool, members, l.applicationRef) : null;
      const { kind, subject } = splitLetterTitle(l.title);
      out.push({
        id: l.id,
        kind,
        subject,
        body: l.body ?? "",
        applicationRef: l.applicationRef,
        createdAt: l.createdAt,
        to: to ? { email: to.email, name: to.name } : null,
        suppressed: to ? await isSuppressed(pool, to.email) : false,
      });
    }
    res.set("Cache-Control", "no-store").json({ letters: out });
  });

  app.put("/api/admin/letter-drafts/:id", async (req, res) => {
    if (!(await admin(req, res))) return;
    const edit = parseLetterEdit(req.body);
    if (!edit.ok) return res.status(400).json({ error: "bad_request", message: edit.error });
    const p = await waitingLetter(String(req.params.id ?? ""));
    if (!p) return res.status(404).json({ error: "not_found" });
    const { kind } = splitLetterTitle(p.title);
    if (!(await editWaitingLetter(getPool(), p.id, letterTitle(kind, edit.subject), edit.text))) return res.status(409).json({ error: "not_waiting" });
    res.json({ success: true, message: SEND_WORDS.edited });
  });

  app.post("/api/admin/letter-drafts/:id/send", async (req, res) => {
    const user = await admin(req, res);
    if (!user) return;
    if (await overLimit(`letter-send:${String(user.id)}`, 30, 10 * 60_000)) return res.status(429).json({ error: "too_many" });
    const pool = getPool();
    const p = await waitingLetter(String(req.params.id ?? ""));
    if (!p || !p.applicationRef) return res.status(404).json({ error: "not_found" });
    const to = await recipientFor(pool, members, p.applicationRef);
    if (!to) return res.status(409).json({ error: "no_address", message: SEND_WORDS.noAddress });
    // The suppression list is asked here, for every kind of address, because the letter goes out as a reply to the applicant.
    if (await isSuppressed(pool, to.email)) return res.status(409).json({ error: "suppressed", message: SEND_WORDS.suppressed });
    const { subject } = splitLetterTitle(p.title);
    const text = p.body ?? "";
    const firstName = to.name ? to.name.trim().split(/\s+/)[0] : "";
    const sent = await postEmail({
      idempotencyKey: `letter-draft:${p.id}`,
      kind: "essential",
      origin: "role.letter",
      to: { email: to.email, ...(firstName ? { name: firstName } : {}), ...(to.userId ? { userId: to.userId } : {}) },
      subject,
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${text
        .split("\n\n")
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
        .join("")}</body></html>`,
      text,
    });
    if (!WENT.has(sent.status)) return res.status(503).json({ error: "not_sent", message: SEND_WORDS.notSent });
    await resolveProposal(pool, p.id, "sent", String(user.id));
    await recordEvent(pool, {
      kind: "letter_sent",
      text: "A drafted letter to an applicant was sent by a person.",
      actorUserId: String(user.id),
      actorKind: "human",
      entityType: "application",
      entityRef: p.applicationRef,
      audience: "admin",
    });
    res.json({ success: true, message: SEND_WORDS.sent });
  });

  app.post("/api/admin/letter-drafts/:id/discard", async (req, res) => {
    const user = await admin(req, res);
    if (!user) return;
    const p = await waitingLetter(String(req.params.id ?? ""));
    if (!p) return res.status(404).json({ error: "not_found" });
    if (!(await resolveProposal(getPool(), p.id, "dismissed", String(user.id)))) return res.status(409).json({ error: "not_waiting" });
    res.json({ success: true });
  });
}
