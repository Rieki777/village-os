/**
 * The email a person receives when their Work With Us proposal arrives.
 *
 * Its words are the village's own since 2026-10-22: Admin, Pages, Work With
 * Us, "Email to the person who proposed" (shared/pageContent/workWithUs.ts).
 * Before that the subject and the paragraph were typed into server/index.ts,
 * including a promise ("Please allow up to a month") that only a village can
 * make, sent under every village's name.
 *
 * The title inside the email is the page's own thank-you heading, so the
 * screen a person sees after sending and the email that follows say the same
 * thing. Its band wears the village's brand colour (server/lib/emailAccent.ts),
 * and the neutral when none is given.
 *
 * Its words stay on the Work With Us page's own fields and do not move into
 * the comms Words: the page and the email are one form's two halves, and two
 * homes for the same sentence would drift.
 *
 * Everything a founder typed is escaped before it reaches the HTML.
 */
import { resolvePage } from "../../shared/pageContent/resolve";
import { pageSectionKey, type PageVars } from "../../shared/pageContent/types";
import { WORK_WITH_US_PAGE } from "../../shared/pageContent/workWithUs";
import { escapeHtml } from "./comms/mailer";
import { emailAccent } from "./emailAccent";

/**
 * The name a public form's mail greets its sender by (R106): the first of the
 * fields a form carries, and never longer than a name, because a stranger
 * types it and the village's own mail repeats it to an address they chose.
 */
export function greetingName(data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const raw = [d.name, d.firstName, d.email].find((v) => typeof v === "string" && v.trim() !== "");
  return (typeof raw === "string" ? raw.trim() : "Anonymous").slice(0, 120);
}

export function workWithUsAckEmail(
  content: unknown,
  vars: PageVars,
  applicantName: string,
  brandColour?: string,
): { subject: string; html: string } {
  const doc = content && typeof content === "object" ? (content as Record<string, unknown>)[pageSectionKey(WORK_WITH_US_PAGE)] : null;
  const page = resolvePage(WORK_WITH_US_PAGE, doc, vars);
  const { subject, body } = page.email.fields;
  const title = page.thanks.fields.heading;
  // A paragraph the founder broke into lines keeps its breaks.
  const paragraph = escapeHtml(body).replace(/\r?\n/g, "<br>");
  return {
    subject,
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:${emailAccent(brandColour)};color:#fff;padding:22px 24px"><div style="font-size:20px;font-weight:700">${escapeHtml(title)}</div></div><div style="padding:22px 24px;line-height:1.6"><p>Hi ${escapeHtml(applicantName)},</p><p>${paragraph}</p><p style="color:#6b7280;font-size:13px;margin-top:20px">The team</p></div></div></body></html>`,
  };
}
