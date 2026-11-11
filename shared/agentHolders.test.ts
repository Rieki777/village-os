/**
 * Who may hold a role, and the words and rules around an agent holding one (0374).
 */
import { describe, expect, it } from "vitest";
import { heldByOf, mayHold, parseAgentProposal, readHeldBy, AGENT_PROPOSAL_WORDS, HELD_BY_WORDS } from "./agentHolders";
import { readParameter } from "./roleParameters";
import { roleCardView } from "./roleCardView";
import { rosterFor } from "./roleSheet";
import { adminRequestDecision, leadApprovedBodyProblem, DEFAULT_AGENT_ADMIN_PATHS } from "./agentAdmin";
import { NOT_ROLE_WORDS } from "./roleProposals";

const ctx = { roles: [{ id: "r1", heldBy: null }, { id: "r2", heldBy: "person" }], maxRoles: 3, noteMax: 600, whyMax: 1200, aimMax: 300 };
const good = { agentUserId: "u-a", keeper: true, what: "A scribe.", switchOff: "Revoke its token.", why: "It keeps minutes.", roles: [{ roleId: "r1" }] };

describe("who may hold a role", () => {
  it("reads an unsaid card as either, which changes nothing for people", () => {
    expect(readHeldBy(null)).toBeNull();
    expect(heldByOf(null)).toBe("either");
    expect(mayHold(null, "person")).toBe(true);
    expect(mayHold(null, "agent")).toBe(true);
    expect(mayHold("person", "agent")).toBe(false);
    expect(mayHold("agent", "person")).toBe(false);
    expect(mayHold("either", "agent")).toBe(true);
  });

  it("reads the card text's words as well as the key", () => {
    expect(readParameter("heldBy", "A person or an agent")).toEqual({ ok: true, value: "either" });
    expect(readParameter("heldBy", "An agent")).toEqual({ ok: true, value: "agent" });
    expect(readParameter("heldBy", "person")).toEqual({ ok: true, value: "person" });
    expect(readParameter("heldBy", "")).toEqual({ ok: true, value: null });
    expect(readParameter("heldBy", "a robot").ok).toBe(false);
  });

  it("is a row on the card only when the card says, and never a word a member proposes", () => {
    expect(roleCardView({ card: {} }).rows.find((r) => r.id === "heldBy")).toBeUndefined();
    expect(roleCardView({ card: { heldBy: "agent" } }).rows.find((r) => r.id === "heldBy")?.lines).toEqual([HELD_BY_WORDS.agent]);
    expect(NOT_ROLE_WORDS.has("heldBy")).toBe(true);
  });

  it("an agent on the roster is an agent, with its keeper under it", () => {
    const { spots } = rosterFor([{ name: "Scribe", isAgent: true, keeper: "Kai Stone" }], 1, 1, { now: new Date(), forming: false, openSub: () => "" });
    expect(spots[0]).toMatchObject({ kind: "agent", title: "An agent", sub: "Kept by Kai Stone" });
  });
});

describe("the keeper's proposal, read", () => {
  it("needs the keeper's word, refuses a person's role, and reads the rest", () => {
    expect(parseAgentProposal(good, ctx)).toMatchObject({ ok: true, value: { agentUserId: "u-a", roles: [{ roleId: "r1", note: "" }] } });
    expect(parseAgentProposal({ ...good, keeper: "yes" }, ctx)).toMatchObject({ ok: false, field: "keeper", error: AGENT_PROPOSAL_WORDS.needKeeper });
    expect(parseAgentProposal({ ...good, roles: [{ roleId: "r2" }] }, ctx)).toMatchObject({ ok: false, status: 409, error: AGENT_PROPOSAL_WORDS.personOnly });
    expect(parseAgentProposal({ ...good, switchOff: "" }, ctx)).toMatchObject({ ok: false, field: "switchOff" });
    expect(parseAgentProposal({ ...good, roles: [{ roleId: "nope" }] }, ctx)).toMatchObject({ ok: false, field: "roles" });
  });
});

describe("an agent never decides who holds a role through the connector", () => {
  it("never adopts, declines or proposes an agent, whatever the allow-list says (the existing rules hold)", () => {
    const doc = { paths: [...DEFAULT_AGENT_ADMIN_PATHS.paths, { method: "POST" as const, path: "/api/governance/open-proposals/:id/adopt", confirm: "agent" as const, label: "x" }] };
    expect(adminRequestDecision("POST", "/api/governance/open-proposals/op-1/adopt", doc)).toMatchObject({ ok: false, code: "always_a_person" });
    const declining = { paths: [...doc.paths, { method: "POST" as const, path: "/api/governance/open-proposals/:id/decline", confirm: "agent" as const, label: "x" }] };
    expect(adminRequestDecision("POST", "/api/governance/open-proposals/op-1/decline", declining)).toMatchObject({ ok: false, code: "always_a_person" });
    expect(adminRequestDecision("POST", "/api/governance/agent-proposals", doc)).toMatchObject({ ok: false, code: "always_a_person" });
  });

  it("never sets who may hold a role through the role editor or a draft", () => {
    const approval = { approvedBy: "Kai Stone", approvalNote: "Yes, go ahead." };
    expect(leadApprovedBodyProblem("role_edit", "/api/admin/roles/r1/edit", { ...approval, parameters: { heldBy: "agent" } })).toMatch(/parameters\.heldBy/);
    expect(leadApprovedBodyProblem("role_draft", "/api/admin/org/drafts/d1/changes", { ...approval, op: "update_seat", payload: { heldBy: "agent" } })).toMatch(/heldBy/);
    expect(leadApprovedBodyProblem("role_edit", "/api/admin/roles/r1/edit", { ...approval, parameters: { track: "contribution" } })).toBeNull();
  });
});
