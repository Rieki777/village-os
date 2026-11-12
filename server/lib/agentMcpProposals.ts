/**
 * THE CONNECTOR'S PROPOSAL PATH (the lead, 11 Nov 2026; shared/proposedChanges.ts).
 *
 *   propose_changes         one change or a whole batch, for a person to review on /admin/proposals
 *   read_proposal_lessons   what people changed in earlier proposals before accepting them
 *
 * A proposal changes nothing live, so it needs no confirmToken: the person's
 * accept on the review page is the decision. The connector cannot accept or
 * discard: those routes refuse anything that came through it, and
 * `ALWAYS_A_PERSON` keeps them off the agent paths list.
 */
import type { ToolDef, RouteAnswer } from "./agentMcp";
import { KIND_WORDS, PROPOSAL_KINDS, PROPOSAL_LIMITS } from "../../shared/proposedChanges";

const refusal = (what: string, a: RouteAnswer) => {
  const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
  return { ok: false as const, error: `${what}: ${String(b.message ?? b.error ?? `the route answered ${a.status}`)}`, detail: b.refused ?? undefined };
};

const KINDS_LINE = PROPOSAL_KINDS.map((k) => `${k}: ${KIND_WORDS[k]}`).join(" ");

export const PROPOSAL_TOOLS: readonly ToolDef[] = [
  {
    name: "propose_changes",
    scope: "admin",
    kind: "write",
    title: "Propose changes for review",
    description:
      `Puts one change, or a whole batch, in front of a person on the village's review page (/admin/proposals). Nothing changes live: the person reads each change beside what is live now, edits the words, and accepts or discards them there; accepting runs each change through its own admin route as that person. Covers every setting an admin can change. Send batch (a short title, such as Phase A content) and items, up to ${PROPOSAL_LIMITS.items}, each {kind, target, body, summary}. summary is one plain sentence a non-technical person understands. Kinds: ${KINDS_LINE} ` +
      "Any admin write route not listed is kind setting with target {method, path}; a setting that names a listed route is read as that kind. Each item is checked by its route's own validator when proposed, and the batch is refused whole, with a reason per item, when any is broken. Never proposable: secrets and integration keys, erasure, agent accounts and tokens, powers, capability grants and badges, moving value (payments, payouts, invoices, ledger, treasury, mint, settlement), seating or unseating a person, and sending letters or email. Read read_proposal_lessons first.",
    inputSchema: {
      type: "object",
      properties: {
        batch: { type: "string", description: "The batch's title, such as Phase A content. Required unless batchId is given." },
        batchId: { type: "string", description: "Add to a batch already waiting, by the id an earlier call answered." },
        items: {
          type: "array",
          maxItems: PROPOSAL_LIMITS.items,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...PROPOSAL_KINDS] },
              target: { type: "object", description: "What the change reaches; the shape depends on kind." },
              body: { type: "object", description: "The proposed fields." },
              summary: { type: "string", description: "One plain sentence saying what it changes." },
            },
            required: ["kind", "target", "summary"],
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    routes: ["POST /api/admin/proposals"],
    async run(args, ctx) {
      const a = await ctx.dispatch("POST", "/api/admin/proposals", { batch: args.batch, batchId: args.batchId, items: args.items });
      if (a.status !== 200) return refusal("Nothing was proposed", a);
      return { ok: true, result: { written: false, proposed: true, ...(a.body as Record<string, unknown>) } };
    },
  },
  {
    name: "read_proposal_lessons",
    scope: "admin",
    kind: "read",
    title: "Read what people changed before accepting",
    description:
      "Answers recent proposals a person edited before accepting, grouped by kind and then by field: what was proposed, what was accepted, and the proposal's summary. Read it before drafting proposals, and write the next ones the way people accepted them. Optional kind narrows it to one kind.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: [...PROPOSAL_KINDS] }, limit: { type: "number" } },
      additionalProperties: false,
    },
    routes: ["GET /api/admin/proposals/lessons"],
    async run(args, ctx) {
      const q = new URLSearchParams();
      if (typeof args.kind === "string") q.set("kind", args.kind);
      if (typeof args.limit === "number") q.set("limit", String(Math.floor(args.limit)));
      const a = await ctx.dispatch("GET", `/api/admin/proposals/lessons${q.toString() ? `?${q}` : ""}`);
      return a.status === 200 ? { ok: true, result: a.body } : refusal("The lessons could not be read", a);
    },
  },
];
