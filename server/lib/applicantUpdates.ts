/**
 * UPDATES ABOUT A ROLE PROPOSAL, TO THE PERSON WHO MADE IT.
 *
 * Every reply and update reaches them twice: as an email to the address they
 * gave, and, once the address has an account here, as a notice on their
 * profile (type `applicant_update`, bell only, because the email already went).
 * Before they have an account it is the email alone.
 *
 * ONE SEND PER MOMENT. The email carries a stable idempotency key
 * (`open-proposal:<id>:update:<kind>[:<part>]`) and the notice a stable dedupe
 * key, so a retried door sends nothing twice. A failure is logged and never
 * the decider's problem: the step it follows has already happened.
 *
 * WHEN THE ACCOUNT COMES LATER. A proposal is linked to the account its
 * invitation makes through the invitation's own id (`openInviteId`), so
 * `carryUpdatesToAccount` writes the earlier updates onto the new profile from
 * the review's recorded steps, under the same keys the live notices use. No
 * column is needed: the steps already say what happened and when.
 *
 * LANGUAGE AND NOTE. Each update is written in the language kept on the
 * proposal (server/lib/applicantLanguage.ts), and carries the decider's note
 * when they wrote one (the proposal's `note`, plain text, escaped in the email).
 */
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { applicantUpdate, greetingName, UPDATE_EMAILS, type ApplicantUpdateKind } from "../../shared/openProposalDecide";
import * as proposals from "../repos/openProposals";
import * as review from "../repos/applicationReview";
import type { DecideDeps } from "./openProposalDecide";
import { isExampleUser } from "./examples";
import { isTombstone } from "./oauthAccounts";
import { numberVar } from "./variables";
import { escapeHtml } from "./comms/mailer";
import { languageOf } from "./applicantLanguage";
import { STATUS_LINK_LINES } from "../../shared/applicantWords";

const WENT: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["sending", "sent", "delivered", "duplicate"]);

export interface TellDeps extends Pick<DecideDeps, "getPool" | "members" | "notify"> {
  postEmail(email: OutgoingEmail): Promise<PostResult>;
  projectName(): string;
}

/** What one update may add: which part of a kind (the position of a conversation), and facts the words use. */
export interface UpdateFacts {
  part?: string;
  withRole?: string | null;
  minutes?: number | null;
}

export type TellApplicant = (ref: string, kind: ApplicantUpdateKind, facts?: UpdateFacts) => Promise<void>;

/** The address's account here, when it is a real, present person (the same rule as openProposalDecide's, kept here so the files do not import each other). */
async function accountFor(members: TellDeps["members"], email: string | null): Promise<string | null> {
  if (!email) return null;
  const m: any = await members.byEmail(email);
  return m && !isExampleUser(m) && !isTombstone({ email: String(m.email ?? "") }) ? String(m.id) : null;
}

const keyOf = (ref: string, kind: ApplicantUpdateKind, part?: string) => `${ref}:update:${kind}${part ? `:${part}` : ""}`;

async function wordsFor(deps: Pick<TellDeps, "getPool" | "projectName">, p: proposals.StoredOpenProposal, kind: ApplicantUpdateKind, facts: UpdateFacts) {
  const names = await review.roleNamesById(deps.getPool(), p.body.roles.map((r) => r.roleId));
  return applicantUpdate(kind, {
    firstName: greetingName(p.name),
    village: deps.projectName(),
    roleNames: p.body.roles.map((r) => names.get(r.roleId) ?? "").filter(Boolean),
    replyDays: numberVar("org.applicant_reply_days"),
    withRole: facts.withRole ?? null,
    minutes: facts.minutes ?? null,
    lang: languageOf(p),
    note: p.body.note ?? null,
  });
}

export function makeApplicantTeller(deps: TellDeps): TellApplicant {
  return async (ref, kind, facts = {}) => {
    try {
      const p = await proposals.readOpenProposal(deps.getPool(), ref);
      // Anonymised or unconfirmed: nobody to tell.
      if (!p || !p.email || p.status === "unconfirmed") return;
      const words = await wordsFor(deps, p, kind, facts);
      if (UPDATE_EMAILS[kind]) {
        const body = words.text
          .split("\n\n")
          .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
          .join("");
        const sent = await deps.postEmail({
          idempotencyKey: `open-proposal:${keyOf(ref, kind, facts.part)}`,
          kind: "essential",
          origin: "open_proposal.update",
          to: { email: p.email, ...(greetingName(p.name) ? { name: greetingName(p.name) as string } : {}) },
          subject: words.title,
          html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${body}</body></html>`,
          text: words.text,
        });
        if (!WENT.has(sent.status)) console.warn(`[open-proposals] the ${kind} update for ${ref} did not go by email: ${sent.status}`);
      }
      const account = await accountFor(deps.members, p.email);
      if (account) await notifyAccount(deps, account, ref, kind, facts, words);
    } catch (e) {
      console.error(`[open-proposals] the ${kind} update for ${ref} was not sent`, e);
    }
  };
}

/** Drops the "Your status page link" line (the notice carries its own link) and the blank lines around it. Split, not a regex, so a long run of newlines costs one pass. */
export function withoutStatusLink(text: string): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (!STATUS_LINK_LINES.has(line)) { kept.push(line); continue; }
    while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  }
  return kept.join("\n").trim();
}

async function notifyAccount(deps: Pick<TellDeps, "notify">, userId: string, ref: string, kind: ApplicantUpdateKind, facts: UpdateFacts, words: { title: string; text: string }) {
  await deps.notify({
    userId,
    type: "applicant_update",
    title: words.title,
    body: withoutStatusLink(words.text).slice(0, 1000),
    link: "/profile",
    actorUserId: null,
    dedupeKey: `op:${keyOf(ref, kind, facts.part)}:${userId}`,
  });
}

/**
 * The account an invitation just made reads the earlier updates about the
 * proposal it came from: the steps the review recorded, under the keys the live
 * notices use, so none is written twice.
 */
export async function carryUpdatesToAccount(deps: Pick<TellDeps, "getPool" | "notify" | "projectName">, proposal: proposals.StoredOpenProposal, userId: string): Promise<void> {
  const steps = await review.stepsOf(deps.getPool(), proposal.id);
  const kinds: ApplicantUpdateKind[] = [];
  if (steps.some((s) => s.kind === "confirmed")) kinds.push("confirmed");
  if (steps.some((s) => s.kind === "first_reply")) kinds.push("first_reply");
  if (steps.some((s) => s.kind === "consent")) kinds.push("consent");
  if (proposal.status === "adopted") kinds.push("adopted");
  for (const kind of kinds) {
    const words = await wordsFor(deps, proposal, kind, {});
    await notifyAccount(deps, userId, proposal.id, kind, {}, words);
  }
}
