/**
 * THE CONNECTOR'S TIER B TOOLS (role journey L13): propose only.
 *
 * The 24 Sept ruling: machines and Sera may propose anything, and a person or a
 * vote adopts. Each tool here leaves a WAITING item or reads public data, and
 * none of them adopts, seats, publishes, sends, sets pay or terms, invites or
 * erases. Those are tier C and stay on the always-a-person list
 * (shared/agentAdmin.ts). Every tool has its own scope, so a token lists only
 * what it was given, and every write asks first through the same two calls as
 * the rest of the connector.
 *
 * Tools 4 and 5 (`draft_letter`, `my_conversations`) touch applicant data. The
 * routes behind them answer 403 while the village setting for AI agents is off
 * (shared/agentProposals.ts), and it starts off. Nothing here scores, ranks or
 * summarises a candidate.
 *
 * Like server/lib/agentMcp.ts this file makes no database call: each tool names
 * the holder's own route and the HTTP wiring runs it as the holder.
 */
import type { ToolContext, ToolDef, ToolOutcome, RouteAnswer } from "./agentMcp";
import { neverProposable } from "../../shared/approvalInbox";
import { AI_APPROVAL_WORDS, LETTER_WORDS, parseLetter, parseRoleChange, parseSeating, projectChart } from "../../shared/agentProposals";

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

/** The route that holds a proposal waiting for a person. Every proposing write goes here and nowhere else. */
export const PROPOSALS = "/api/agent-proposals";

function refusal(what: string, a: RouteAnswer): ToolOutcome {
  const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
  const words = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : `status ${a.status}`;
  return { ok: false, error: `${what}: ${words}`, detail: { status: a.status } };
}

/**
 * A proposing write in the two calls. It leaves a WAITING item for a person and
 * changes nothing live, so the echo says so. The route's own refusal wins when it
 * gave words; only a bare 404 reads as "not open on this server".
 */
async function proposeWrite(
  tool: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  path: string,
  body: Record<string, unknown>,
  notOpen: string,
): Promise<ToolOutcome> {
  const echo = { method: "POST", path, body };
  if (args.confirmToken === undefined) {
    const { token, expiresAt } = ctx.mintConfirm(tool, echo);
    return {
      ok: true,
      result: {
        confirmRequired: true,
        echo,
        confirmToken: token,
        expiresAt,
        message: `Nothing was written. This only leaves a waiting item for a person; it changes nothing live. Show it to the member, and after their yes call ${tool} again with the same arguments and this confirmToken.`,
      },
    };
  }
  const check = ctx.verifyConfirm(tool, args.confirmToken, echo);
  if (!check.ok) return { ok: false, error: check.sentence, detail: { reason: check.reason } };
  const a = await ctx.dispatch("POST", path, body);
  const words = a.body && typeof a.body === "object" ? (a.body as Record<string, unknown>).message : null;
  if (a.status === 404 && typeof words !== "string") return { ok: false, error: notOpen };
  if (a.status >= 300) return refusal("That was not taken", a);
  return { ok: true, result: { written: true, waiting: true, echo, answer: a.body } };
}

/** Whether applicant data is open to AI agents here: the letters route answers 403 in words while the setting is off. */
async function applicantDataClosed(ctx: ToolContext): Promise<ToolOutcome | null> {
  const a = await ctx.dispatch("GET", `${PROPOSALS}/letters`);
  if (a.status === 403) return { ok: false, error: AI_APPROVAL_WORDS.off, detail: { code: "ai_agents_not_approved" } };
  if (a.status === 404) return { ok: false, error: "This part of the village is not open on this server yet." };
  return null;
}

export const TIER_B_TOOLS: readonly ToolDef[] = [
  {
    name: "get_roles",
    scope: "roles.read",
    kind: "read",
    title: "The roles chart",
    description:
      "The village's chart of roles: each role's id, circle, whether it is listed, its open places, the first names of its holders, and how much of its card is written. Public facts only: no pay, no terms, no contact details. Read only.",
    inputSchema: NO_ARGS,
    routes: ["GET /api/org"],
    async run(_args, ctx) {
      const a = await ctx.dispatch("GET", "/api/org");
      return a.status === 200 ? { ok: true, result: projectChart(a.body) } : refusal("The chart could not be read", a);
    },
  },
  {
    name: "propose_role_change",
    scope: "roles.propose",
    kind: "write",
    title: "Propose a change to a role",
    description:
      "Drafts a change to one role's card words or parameters (aim, domain, whyItMatters, bringMe, notMine, runbook, number of places, criticality, recruiting, accountabilities) as an org draft that waits in Review. The conversation list, listing and a pay group from Sera's range ride along as asks a person sets. It never publishes: a holder of the power to decide on the village's structure reads it and publishes with one click. Call it first without confirmToken: it writes nothing and answers with what it would leave and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the token.",
    inputSchema: {
      type: "object",
      properties: {
        roleId: { type: "string", description: "The role's id, from get_roles." },
        fields: { type: "object", description: "The card words or parameters to change." },
        conversations: { type: "array", items: { type: "string" }, description: "Role ids whose holders hold the interviews. An ask a person sets." },
        listing: { type: "string", enum: ["list", "unlist"], description: "An ask a person does on the role." },
        payGroup: { type: "string", description: "A pay group from Sera's range. An ask: a person sets pay." },
        why: { type: "string", description: "Why, in a sentence or two." },
        confirmToken: { type: "string", description: "From the first call. Leave it out to see what would be written." },
      },
      required: ["roleId", "why"],
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/role-change`],
    async run(args, ctx) {
      const parsed = parseRoleChange(args);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const a = parsed.value;
      return proposeWrite(
        "propose_role_change",
        args,
        ctx,
        `${PROPOSALS}/role-change`,
        { roleId: a.roleId, fields: a.fields, conversations: a.conversations, listing: a.listing, payGroup: a.payGroup, why: a.why },
        "Role proposals are not open on this server yet.",
      );
    },
  },
  {
    name: "propose_seating",
    scope: "roles.propose",
    kind: "write",
    title: "Propose a seating",
    description:
      "Proposes that a member be seated in a role from a date, as a waiting item for a holder of the power to fill roles. It never seats anyone, and it refuses a proposal for the member who holds this token. Call it first without confirmToken: it writes nothing and answers with what it would leave and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the token.",
    inputSchema: {
      type: "object",
      properties: {
        roleId: { type: "string", description: "The role's id, from get_roles." },
        memberId: { type: "string", description: "The member to seat. Never the holder of this token." },
        from: { type: "string", description: "The date the seating starts, YYYY-MM-DD." },
        why: { type: "string", description: "Why, in a sentence." },
        confirmToken: { type: "string", description: "From the first call. Leave it out to see what would be written." },
      },
      required: ["roleId", "memberId", "from"],
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/seating`],
    async run(args, ctx) {
      const parsed = parseSeating(args, ctx.holderId ?? null);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const a = parsed.value;
      return proposeWrite("propose_seating", args, ctx, `${PROPOSALS}/seating`, { roleId: a.roleId, memberId: a.memberId, from: a.from, why: a.why }, "Seating proposals are not open on this server yet.");
    },
  },
  {
    name: "draft_letter",
    scope: "letters.draft",
    kind: "write",
    title: "Draft a letter to an applicant",
    description:
      "Drafts a first reply or a decision letter into a queue. It sends nothing: a person reads it, changes it and sends it from the app. It touches applicant data, so it stays closed until the Anchor records its approval of AI agents. It never scores, ranks or summarises a candidate. Call it first without confirmToken: it writes nothing and answers with what it would queue and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the token.",
    inputSchema: {
      type: "object",
      properties: {
        applicationRef: { type: "string", description: "The application's reference." },
        kind: { type: "string", enum: ["first_reply", "decision"] },
        subject: { type: "string" },
        body: { type: "string", description: "The letter, in the village's voice." },
        confirmToken: { type: "string", description: "From the first call. Leave it out to see what would be written." },
      },
      required: ["applicationRef", "kind", "subject", "body"],
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/letters`, `GET ${PROPOSALS}/letters`],
    async run(args, ctx) {
      const parsed = parseLetter(args);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const closed = await applicantDataClosed(ctx);
      if (closed) return closed;
      const l = parsed.value;
      const out = await proposeWrite(
        "draft_letter",
        args,
        ctx,
        `${PROPOSALS}/letters`,
        { applicationRef: l.applicationRef, kind: l.kind, subject: l.subject, body: l.body },
        "The letter queue is not open on this server yet.",
      );
      if (out.ok && (out.result as { confirmRequired?: boolean }).confirmRequired === true) (out.result as Record<string, unknown>).queueNote = LETTER_WORDS.queued;
      return out;
    },
  },
  {
    name: "my_conversations",
    scope: "applicants.read",
    kind: "read",
    title: "Conversations waiting on me",
    description:
      "For a holder of a role that holds interviews: the applications waiting on them, with the application reference, the role asked about, the length of the conversation and how long it has waited. No names, no contact details, no time zones, no scores. It touches applicant data, so it stays closed until the Anchor records its approval of AI agents. Scoring stays a person's act, and nothing here ranks or summarises anyone. Read only.",
    inputSchema: NO_ARGS,
    routes: [`GET ${PROPOSALS}/conversations`],
    async run(_args, ctx) {
      const a = await ctx.dispatch("GET", `${PROPOSALS}/conversations`);
      if (a.status === 403) return { ok: false, error: AI_APPROVAL_WORDS.off, detail: { code: "ai_agents_not_approved" } };
      if (a.status === 404) return { ok: false, error: "Conversations are not open in this village yet." };
      return a.status === 200 ? { ok: true, result: a.body } : refusal("The conversations could not be read", a);
    },
  },
  {
    name: "my_onboarding_path",
    scope: "onboarding.write",
    kind: "write",
    title: "My onboarding path",
    description:
      "Without itemKey, reads the holder's own onboarding path and its items. With pathId and itemKey, ticks that item done for the holder, exactly as a tap on the path does. Only the holder's own path. Call a tick first without confirmToken: it writes nothing and answers with what it would do and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the token.",
    inputSchema: {
      type: "object",
      properties: {
        pathId: { type: "string", description: "The path's id, from the read." },
        itemKey: { type: "string", description: "The item to tick. Leave out both to read the path." },
        confirmToken: { type: "string", description: "From the first call of a tick. Leave it out to see what would be written." },
      },
      additionalProperties: false,
    },
    routes: ["GET /api/onboarding/me", "POST /api/onboarding/paths/:id/items/:key/done"],
    writes: (args) => args.itemKey !== undefined,
    async run(args, ctx) {
      const NOT_OPEN = "The onboarding path is not open in this village yet.";
      if (args.itemKey === undefined) {
        const a = await ctx.dispatch("GET", "/api/onboarding/me");
        if (a.status === 404) return { ok: false, error: NOT_OPEN };
        return a.status === 200 ? { ok: true, result: a.body } : refusal("The path could not be read", a);
      }
      const pathId = typeof args.pathId === "string" ? args.pathId.slice(0, 64) : "";
      const itemKey = typeof args.itemKey === "string" ? args.itemKey.slice(0, 64) : "";
      if (!/^[A-Za-z0-9_-]+$/.test(pathId) || !/^[A-Za-z0-9_.-]+$/.test(itemKey)) return { ok: false, error: "Name the path and the item: pathId and itemKey, from the read." };
      const path = `/api/onboarding/paths/${encodeURIComponent(pathId)}/items/${encodeURIComponent(itemKey)}/done`;
      const echo = { method: "POST", path, body: {} };
      if (args.confirmToken === undefined) {
        const { token, expiresAt } = ctx.mintConfirm("my_onboarding_path", echo);
        return {
          ok: true,
          result: { confirmRequired: true, echo, confirmToken: token, expiresAt, message: "Nothing was written. Show this to the member, and after their yes call my_onboarding_path again with the same arguments and this confirmToken." },
        };
      }
      const check = ctx.verifyConfirm("my_onboarding_path", args.confirmToken, echo);
      if (!check.ok) return { ok: false, error: check.sentence, detail: { reason: check.reason } };
      const a = await ctx.dispatch("POST", path, {});
      if (a.status === 404) return { ok: false, error: NOT_OPEN };
      if (a.status >= 300) return refusal("The path did not take that", a);
      return { ok: true, result: { written: true, echo, answer: a.body } };
    },
  },
];

/** The proposals that go to the approval inbox (role journey L13, part A). Each files a waiting item and changes nothing. */
const INBOX_NOTE =
  "It only files a proposal for a person to approve in the approval inbox, through that thing's own route. Nothing changes until then, and it lapses in seven days. Money, secrets, erasure, invites and power changes are refused at filing.";
const ASK_FIRST = "Call it first without confirmToken: it writes nothing and answers with what it would file and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the token.";
const CONFIRM_PROP = { type: "string", description: "From the first call. Leave it out to see what would be written." } as const;

export const INBOX_TOOLS: readonly ToolDef[] = [
  {
    name: "propose_setting",
    scope: "settings.propose",
    kind: "write",
    title: "Propose a village setting",
    description: `Proposes a change to a village setting (target variable, with key and value), a module switch (target module, with id and lifecycle off, preview, members or public), or what public proposals are for (target open_proposals_term, with term season or moon). The org.start_after switches are village settings. ${INBOX_NOTE} ${ASK_FIRST}`,
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["variable", "module", "open_proposals_term"] },
        key: { type: "string", description: "For a variable: its key, such as org.start_after_open." },
        value: { type: "string", description: "For a variable: the new value, as text." },
        id: { type: "string", description: "For a module: its id." },
        lifecycle: { type: "string", enum: ["off", "preview", "members", "public"] },
        term: { type: "string", enum: ["season", "moon"] },
        confirmToken: CONFIRM_PROP,
      },
      required: ["target"],
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/setting`],
    async run(args, ctx) {
      const subject = String(args.key ?? args.id ?? "");
      const never = subject ? neverProposable(subject) : null;
      if (never) return { ok: false, error: never.words, detail: { code: "never_proposable", key: never.key } };
      const body: Record<string, unknown> = { target: args.target };
      for (const k of ["key", "value", "id", "lifecycle", "term"]) if (args[k] !== undefined) body[k] = args[k];
      return proposeWrite("propose_setting", args, ctx, `${PROPOSALS}/setting`, body, "Setting proposals are not open on this server yet.");
    },
  },
  {
    name: "propose_listing",
    scope: "listing.propose",
    kind: "write",
    title: "Propose which roles are listed",
    description: `Proposes "list only these" (only: a list of role ids), or listing or unlisting one role (roleId and listed). ${INBOX_NOTE} ${ASK_FIRST}`,
    inputSchema: {
      type: "object",
      properties: {
        only: { type: "array", items: { type: "string" }, description: "List only these roles, and unlist every other one." },
        roleId: { type: "string" },
        listed: { type: "boolean", description: "For one role: true to list, false to unlist." },
        confirmToken: CONFIRM_PROP,
      },
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/listing`],
    async run(args, ctx) {
      const body: Record<string, unknown> = {};
      for (const k of ["only", "roleId", "listed"]) if (args[k] !== undefined) body[k] = args[k];
      return proposeWrite("propose_listing", args, ctx, `${PROPOSALS}/listing`, body, "Listing proposals are not open on this server yet.");
    },
  },
  {
    name: "propose_page_copy",
    scope: "pages.propose",
    kind: "write",
    title: "Propose new words for a page",
    description: `Proposes new content for one Admin Pages content block (section, and the block as it is saved there). It is read against the page's own rules at filing and again by the page's route when a person approves, and it is refused if the words changed in between. ${INBOX_NOTE} ${ASK_FIRST}`,
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", description: "The content block's name." },
        content: { type: "object", description: "The block, as Admin Pages saves it." },
        confirmToken: CONFIRM_PROP,
      },
      required: ["section", "content"],
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/page-copy`],
    async run(args, ctx) {
      const never = neverProposable(String(args.section ?? ""));
      if (never) return { ok: false, error: never.words, detail: { code: "never_proposable", key: never.key } };
      return proposeWrite("propose_page_copy", args, ctx, `${PROPOSALS}/page-copy`, { section: args.section, content: args.content }, "Page proposals are not open on this server yet.");
    },
  },
  {
    name: "propose_map_publish",
    scope: "map.propose",
    kind: "write",
    title: "Propose publishing the map draft",
    description: `Proposes publishing the map draft this member has saved. The approver publishes it through the map's own publish route, with the draft as it stands then. ${INBOX_NOTE} ${ASK_FIRST}`,
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "A line saying what changed." }, confirmToken: CONFIRM_PROP },
      additionalProperties: false,
    },
    routes: [`POST ${PROPOSALS}/map-publish`],
    async run(args, ctx) {
      return proposeWrite("propose_map_publish", args, ctx, `${PROPOSALS}/map-publish`, args.note === undefined ? {} : { note: args.note }, "Map proposals are not open on this server yet.");
    },
  },
];
