/**
 * THE LIVE MAILER, moved out of server/index.ts (Village Comms, 2026-10-02).
 *
 * `sendResendEmail`, `resolvedEmailSender`, `getEmailConfig`,
 * `buildSubmissionEmailHtml` and `recipientsForType`, with the helpers they
 * lean on, unchanged in behaviour. server/index.ts builds one mailer at boot
 * with `createMailer` and keeps calling the same five names, so no caller had
 * to change.
 *
 * WHY THIS FILE AND THIS NAME. These functions are the existing email door,
 * and the post office (`./postOffice.ts`) is where every email now goes
 * through. Keeping the old names in a file of their own beside the post
 * office means the callers that know them keep working while the inside
 * changes, and the one place that reads the email-config document and the
 * Resend key is a file somebody can open, instead of four functions spread
 * through a 27,000-line closure.
 *
 * INJECTED, NEVER IMPORTED. The email-config document, the secrets store and
 * the brand overlay are booted by server/index.ts. Passing their readers in
 * keeps this file free of that boot order, and keeps every name it touches in
 * one visible list (`MailerDeps`).
 *
 * `sendResendEmail` IS NOW A THIN CALL TO THE POST OFFICE. Each recipient is
 * posted as its own `essential`, `urgent` email, so every send is a ledger row
 * a founder can read, and the answer keeps the exact `{ sent, reason }` shape
 * every existing caller was written against.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { PostResult } from "../../../shared/comms/contracts";
import { post, type PostOfficeDeps } from "./postOffice";
import { resendTransport, type Transport } from "./transport";

/**
 * The email-config document's defaults. The four inboxes are where form
 * submissions are routed, by pathway.
 */
export const DEFAULT_EMAIL_CONFIG = {
  investor: "",
  steward: "",
  resident: "",
  prosperity: "",
  resend_api_key: "",
  // Anthropic API key for the "Work With Us" guide. Blank = the AI persona is
  // dormant and the site shows the plain form instead. No key, no cost.
  assistant_api_key: "",
  // The From: address every village email leaves under. Blank inherits
  // EMAIL_FROM, then the platform's last-resort literal. So an existing
  // deployment changes nothing, and a fork can set its own sender from Admin
  // without a deploy. Must be `addr@dom.tld` or `Name <addr@dom.tld>`.
  sender: "",
};

/** `addr@dom.tld` or `Name <addr@dom.tld>`. Anything else is not sendable. */
export function validEmailSender(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) || /^[^<>]+<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(s);
}

/**
 * Which inbox a public form's submissions reach. The types a real page posts,
 * mapped to the four pathways of the email-config document. `PUBLIC_FORM_TYPES`
 * in server/index.ts is the list of form types the public door accepts, and
 * this map is one of the three sources it is derived from.
 */
export const FORM_TYPE_TO_PATHWAY: Record<string, "investor" | "steward" | "resident" | "prosperity"> = {
  investor: "investor",
  "investor-pack": "investor",
  "investor-call": "investor",
  "investor-doc-request": "investor",
  steward: "steward",
  resident: "resident",
  prosperity: "prosperity",
  contact: "prosperity",
  "work-with-us": "prosperity",
  "quest-proposal": "steward",
};

/** Escape a string for HTML. Every value interpolated into an email body goes through it. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * WHAT `sendResendEmail` RETURNS, and why it did not used to return anything.
 *
 * Every path out of it used to be indistinguishable from every other: no API
 * key, no recipients, a 4xx from the provider and a clean accepted send all
 * returned the same `undefined`, and none of them threw. So a caller that
 * wanted to know whether mail had actually gone had exactly one signal
 * available, "it did not throw", which was true in all four cases.
 *
 * `POST /api/admin/bootstrap` was that caller. It set `emailed = true` after
 * the await and reported it to the operator who had just created the founder
 * account, on a deployment with no email provider configured, which is the
 * state every fork boots in. The server log on the same request read
 * "[RESEND] API key not set, skipping email".
 *
 * `sent` is now only true when the provider accepted the message, and `reason`
 * names which door it left by otherwise. Note the ceiling on that word:
 * ACCEPTED is not DELIVERED. A provider returns 200 for a domain whose SPF and
 * DKIM records were never published and then delivers nothing, so `sent: true`
 * means the message was handed over, never that it arrived.
 *
 * Callers that do not care may keep ignoring the result.
 */
export type MailResult = { sent: boolean; reason?: "no_api_key" | "no_sender" | "no_recipients" | "rejected" | "failed" };

export interface MailerDeps {
  /** The stored email-config document, unmerged. */
  emailConfig(): any;
  /** A key from the write-only secrets store: admin-typed first, env second. */
  secretValue(key: "resend_api_key" | "assistant_api_key"): string;
  /** This village's own name, for the heading of a submission email. */
  projectName(): string;
  /** The pool the post office writes its ledger through. */
  getPool(): Pool;
  /** This village's absolute origin, for the one-click links in an email's headers. */
  origin(): string;
  /** The provider. Resend unless a test hands in its own. */
  transport?: Transport;
}

/**
 * The same recipient rule the mailer has always applied: every configured
 * inbox may hold a comma-separated LIST, because several people receiving
 * updates is the norm for a village. Split, trim, drop non-addresses, dedupe.
 */
export function normalizeRecipients(to: string[]): string[] {
  return Array.from(new Set(
    to.flatMap((a) => String(a ?? "").split(",")).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)),
  ));
}

/** The post office's answer, in the words the old mailer's callers read. */
export function mailResultOf(r: PostResult): MailResult {
  if (r.status === "sent") return { sent: true };
  if (r.reason === "no_api_key" || r.reason === "no_sender") return { sent: false, reason: r.reason };
  if (r.status === "skipped" && r.reason === "bad_address") return { sent: false, reason: "no_recipients" };
  if (r.reason === "rejected") return { sent: false, reason: "rejected" };
  return { sent: false, reason: "failed" };
}

export function createMailer(deps: MailerDeps) {
  /**
   * Integration config. Keys resolve in this order:
   *   1. What an admin typed in the UI (per-project override, stored in the
   *      email-config document)
   *   2. The environment (RESEND_API_KEY / ANTHROPIC_API_KEY on the host)
   * Env vars are the better home for a shared key: they are not sitting in a
   * JSON document, and one Railway service can run the integrations for a
   * project hosted under it. The admin UI still wins if a project sets its own.
   */
  function getEmailConfig() {
    const merged = { ...DEFAULT_EMAIL_CONFIG, ...deps.emailConfig() };
    return {
      ...merged,
      // S63: keys live in the write-only secrets store now (admin-first,
      // env-fallback). Legacy values are migrated out of this doc at boot.
      resend_api_key: deps.secretValue("resend_api_key"),
      assistant_api_key: deps.secretValue("assistant_api_key"),
    };
  }

  /**
   * The heading was the literal name of one village, so every village that
   * installed this platform emailed its own stewards under another village's
   * name. Same rule as every other identity string: the name comes from the
   * merged config, which is a brand override over the gameConfig default, and
   * is escaped because a village types its own name.
   */
  function buildSubmissionEmailHtml(type: string, data: Record<string, unknown>, adminUrl: string): string {
    const rows = Object.entries(data)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px;font-weight:600;color:#2D5A5A;background:#f4f7f7;border-bottom:1px solid #e5e7eb;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 12px;color:#1f2937;border-bottom:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v ?? ""))}</td></tr>`
      )
      .join("");
    return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:#2D5A5A;color:#fff;padding:20px 24px"><div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.7">New ${escapeHtml(type)} submission</div><div style="font-size:20px;font-weight:700;margin-top:4px">${escapeHtml(deps.projectName())}</div></div>
  <div style="padding:20px 24px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <div style="margin-top:24px"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#2D5A5A;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open Admin</a></div>
  </div>
</div></body></html>`;
  }

  /**
   * The From: address, resolved across the config planes: admin-typed sender
   * (Admin, Email config) beats EMAIL_FROM. An admin value that is not a
   * sendable address is skipped loudly and never used. Resend accepts a
   * malformed From: and delivers nothing, which is the silent email death this
   * whole path exists to avoid.
   */
  function resolvedEmailSender(): string {
    const typed = String(getEmailConfig().sender ?? "").trim();
    if (typed) {
      if (validEmailSender(typed)) return typed;
      console.error(`[RESEND] configured sender "${typed}" is not a valid address, falling back`);
    }
    const env = String(process.env.EMAIL_FROM ?? "").trim();
    if (env) {
      if (validEmailSender(env)) return env;
      console.error(`[RESEND] EMAIL_FROM "${env}" is not a valid address, falling back`);
    }
    /*
     * NO LAST-RESORT SENDER ANY MORE, and that is the honest answer.
     *
     * This used to return one specific village's address. Two things followed.
     * Every fork's mail went out claiming a domain it does not own, which Resend
     * accepts with a 200 and then delivers nowhere, because the send fails the
     * receiving domain's SPF and DKIM checks. And the runbook already records
     * that this very domain is unverified, so the fallback was not even
     * delivering for the village it named.
     *
     * An empty string means "this deployment has not said who its mail comes
     * from", `sendResendEmail` declines instead of sending into a hole, and the
     * caller is told. A refusal a founder can read beats a 200 nobody receives.
     */
    return "";
  }

  /**
   * The post office this mailer posts through, built once. The comms admin
   * routes read the same object, so "run now" drains exactly the ledger
   * `sendResendEmail` writes to.
   */
  const postOffice: PostOfficeDeps = {
    getPool: deps.getPool,
    transport: deps.transport ?? resendTransport({ apiKey: () => deps.secretValue("resend_api_key") }),
    // Admin-typed sender first, then the env var. A malformed admin value is
    // IGNORED and never sent (a bad From: kills every email silently), and
    // says so in the log so the founder can find it.
    sender: resolvedEmailSender,
    hasApiKey: () => Boolean(deps.secretValue("resend_api_key")),
    origin: deps.origin,
  };

  /**
   * Send one email to each recipient, now. The old name and the old answer,
   * through the post office.
   *
   * WHAT EACH ANSWER MEANS, unchanged for every caller. `no_api_key` and
   * `no_sender` say which half of the setup is missing, and they still come
   * BEFORE `no_recipients`, so a fork with nothing configured hears the
   * thing it can fix. `sent` is true only when the provider accepted every
   * recipient's copy, and the first refusal names the answer otherwise.
   *
   * The `from` override this used to accept was passed by no caller and is
   * gone: every email leaves under the one configured sender.
   *
   * THE LOG LINES ARE PART OF THE MOVE. Each call prints the line the old
   * mailer printed, once per call, before anything is posted: a fork with no
   * key reads "[RESEND] API key not set, skipping email" exactly as it always
   * has, and server/housing.routes.e2e.test.ts counts that line as the number
   * of emails a route tried to send. The rows are still written, as `skipped`,
   * so Sent mail shows what would have gone.
   */
  async function sendResendEmail(opts: { to: string[]; subject: string; html: string; replyTo?: string; origin?: string }): Promise<MailResult> {
    const gap = !postOffice.hasApiKey() ? "no_api_key" : !postOffice.sender() ? "no_sender" : null;
    if (gap === "no_api_key") console.log("[RESEND] API key not set, skipping email");
    if (gap === "no_sender") {
      console.error("[RESEND] no sender address configured, skipping email. Set EMAIL_FROM or the sender in Admin, Email config.");
    }
    const to = normalizeRecipients(opts.to);
    if (!to.length) {
      if (gap) return { sent: false, reason: gap };
      console.log("[RESEND] No recipients, skipping email");
      return { sent: false, reason: "no_recipients" };
    }
    let first: MailResult | null = null;
    for (const address of to) {
      const answer = mailResultOf(
        await post(postOffice, {
          // Every call is its own email, exactly as before: the old mailer
          // never deduplicated, and the callers that need a stable key will
          // post through the post office directly with their own.
          idempotencyKey: `essential:${randomUUID()}`,
          kind: "essential",
          origin: opts.origin ?? "mail.direct",
          to: { email: address },
          subject: opts.subject,
          html: opts.html,
          text: "",
          // The contact relay (S22) sets this to the SENDER's address so a
          // plain reply works, always with compose-screen disclosure.
          replyTo: opts.replyTo ?? null,
          urgent: true,
        }),
      );
      if (!answer.sent && !first) first = answer;
    }
    return first ?? { sent: true };
  }

  /** The configured inboxes for one form type's pathway, falling back to all of them. */
  function recipientsForType(type: string): string[] {
    const cfg = getEmailConfig();
    const pathway = FORM_TYPE_TO_PATHWAY[type];
    if (pathway && cfg[pathway]) return [cfg[pathway]];
    // Fallback: send to all configured pathway inboxes
    return Array.from(
      new Set(
        ["investor", "steward", "resident", "prosperity"]
          .map((k) => cfg[k as keyof typeof cfg])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      )
    );
  }

  return { getEmailConfig, buildSubmissionEmailHtml, resolvedEmailSender, sendResendEmail, recipientsForType, postOffice };
}
