/**
 * SENT MAIL, `/api/admin/comms/messages*` (the comms build spec 5.1 and 6):
 * every row the post office wrote, what became of it, and the two things a
 * person running the village's email may do about one.
 *
 *   GET  /api/admin/comms/messages             a page of the record, filtered
 *   GET  /api/admin/comms/messages/:id         one email: its words when they
 *                                              are still kept, and every
 *                                              delivery report about it
 *   POST /api/admin/comms/messages/:id/retry   a failed email, back in the queue
 *   POST /api/admin/comms/messages/:id/cancel  a queued email, withdrawn
 *
 * ── WHERE THIS IS REGISTERED, AND WHY ──────────────────────────────────────
 *
 * From server/routes/comms.ts, so it sits where every comms admin route sits:
 * after `express.json()`, the admin audit and the admin default-deny gate, and
 * never behind the comms module's gate. A village reads what it has sent while
 * the module is off, because essential mail and notices go out whatever the
 * module says.
 *
 * ── WHO MAY ────────────────────────────────────────────────────────────────
 *
 * Holders of `comms.manage`, through the one gate. Reading is a look
 * (`mayStillSee`); a retry or a cancel is an act (`guardCapability`, with the
 * break-glass and the public record it carries). This screen shows addresses,
 * because finding one person's email is what it is for, and that is why it
 * sits behind the same power that runs the email.
 *
 * ── WHAT CANNOT BE DONE FROM HERE, AND THE ANSWER SAYS WHY ─────────────────
 *
 * A retry needs the email's words. Essential mail never keeps them (most of it
 * carries a link that acts for the person); every other email keeps its words
 * as long as its row. An email past its moment is not retried either: a
 * notice late by a day surprises more than a missed one.
 */
import type { Express, Request, Response } from "express";
import { EMAIL_KINDS, MESSAGE_STATUSES, type EmailKind, type MessageStatus } from "../../shared/comms/kinds";
import type { AppDeps } from "../lib/appDeps";
import {
  cancelQueued,
  listMessages,
  messageDetail,
  messageOrigins,
  providerEventsForMessage,
  requeueFailed,
} from "../repos/commsMessages";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "mayStillSee" | "getPool">;

/** Rows on one page of the list. */
export const SENT_MAIL_PAGE = 50;

const REFUSED = { error: "Running the village's email is an appointment" };

/** `YYYY-MM-DD` as the epoch second that day starts at, in UTC, or null. */
export function dayStart(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // A date that rolled over (the 31st of a 30-day month) is not the day that was asked for.
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== m[0]) return null;
  return Math.floor(ms / 1000);
}

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

/** When, as a person reads it in Sent mail. */
const when = (epoch: number | null): string | null => (epoch == null ? null : new Date(epoch * 1000).toISOString());

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, mayStillSee, getPool } = deps;

  /** A look at the record. Answers the refusal itself and says false when there is one. */
  const mayLook = async (req: Request, res: Response): Promise<boolean> => {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(403).json(REFUSED);
      return false;
    }
    return true;
  };

  app.get("/api/admin/comms/messages", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const q = req.query ?? {};
    const page = Math.max(0, Math.min(10_000, Math.trunc(Number(q.page ?? 0)) || 0));
    const origin = typeof q.origin === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(q.origin) ? q.origin : null;
    const search = typeof q.q === "string" ? q.q.trim().slice(0, 191) : "";
    const from = dayStart(q.from);
    const to = dayStart(q.to);
    const filters = {
      status: oneOf<MessageStatus>(q.status, MESSAGE_STATUSES),
      kind: oneOf<EmailKind>(q.kind, EMAIL_KINDS),
      origin,
      search: search || null,
      from,
      // `to` is a whole day, so the list runs to the end of it.
      before: to == null ? null : to + 86_400,
    };
    const pool = getPool();
    const [{ rows, total }, origins] = await Promise.all([
      listMessages(pool, { ...filters, limit: SENT_MAIL_PAGE, offset: page * SENT_MAIL_PAGE }),
      messageOrigins(pool),
    ]);
    res.json({
      messages: rows.map((r) => ({ ...r, createdAt: when(r.createdAt), sentAt: when(r.sentAt) })),
      total,
      page,
      pageSize: SENT_MAIL_PAGE,
      origins,
      filters: {
        status: filters.status,
        kind: filters.kind,
        origin: filters.origin,
        q: search,
        from: from == null ? null : String(q.from),
        to: to == null ? null : String(q.to),
      },
    });
  });

  app.get("/api/admin/comms/messages/:id", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const pool = getPool();
    const m = await messageDetail(pool, String(req.params.id));
    if (!m) return res.status(404).json({ error: "There is no such email in the record." });
    const reports = await providerEventsForMessage(pool, m.id, m.providerMessageId);
    res.json({
      message: {
        ...m,
        createdAt: when(m.createdAt),
        sentAt: when(m.sentAt),
        sendAfter: when(m.sendAfter),
        nextAttemptAt: when(m.nextAttemptAt),
        expiresAt: when(m.expiresAt),
        deliveredAt: when(m.deliveredAt),
        bouncedAt: when(m.bouncedAt),
        complainedAt: when(m.complainedAt),
        updatedAt: when(m.updatedAt),
        // Why the words are missing, when they are, in one sentence the screen shows.
        wordsNote: m.hasBody
          ? null
          : m.kind === "essential"
            ? "The words of essential mail are never kept: most of it carries a link that acts for the person."
            : "The words of this email were not kept.",
      },
      reports: reports.map((r) => ({ ...r, receivedAt: when(r.receivedAt), processedAt: when(r.processedAt) })),
      canRetry: m.status === "failed" && m.kind !== "essential" && m.hasBody && (m.expiresAt == null || m.expiresAt * 1000 > Date.now()),
      canCancel: m.status === "queued",
    });
  });

  app.post("/api/admin/comms/messages/:id/retry", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", { status: 403, body: REFUSED }))) return;
    const pool = getPool();
    const id = String(req.params.id);
    const m = await messageDetail(pool, id);
    if (!m) return res.status(404).json({ error: "There is no such email in the record." });
    if (await requeueFailed(pool, id)) {
      return res.json({ ok: true, status: "queued", message: "It is back in the queue, and goes with the next send." });
    }
    // Said in the order a person would ask it.
    const why =
      m.status !== "failed"
        ? `Only an email that failed can be tried again, and this one is ${m.status}.`
        : m.kind === "essential"
          ? "The words of essential mail are never kept, so it cannot be sent again from here. Ask the person to request it again."
          : !m.hasBody
            ? "The words of this email are no longer kept, so it cannot be sent again."
            : "This email was only worth sending until its moment, and that has passed.";
    res.status(409).json({ error: why });
  });

  app.post("/api/admin/comms/messages/:id/cancel", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", { status: 403, body: REFUSED }))) return;
    const pool = getPool();
    const id = String(req.params.id);
    const m = await messageDetail(pool, id);
    if (!m) return res.status(404).json({ error: "There is no such email in the record." });
    if (await cancelQueued(pool, id)) {
      return res.json({ ok: true, status: "cancelled", message: "It will not be sent." });
    }
    res.status(409).json({ error: `Only an email still waiting in the queue can be cancelled, and this one is ${m.status}.` });
  });
}
