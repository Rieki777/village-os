/**
 * Which kinds a sync asks for, under which names, read off the service's own
 * schema where it gives one.
 *
 * The fixtures are `tools/list` answers in the shapes an MCP server plausibly
 * sends: a zod-style schema with a plain enum, a generated schema carrying its
 * enum behind a `$ref`, a schema with no enum, and no schema at all. None of
 * them is measured from the live service, which is the reason the planner
 * reads the schema at all. What these pin is that EVERY kind this village
 * holds comes back either asked for or named as not offered, never left out.
 */
import { describe, expect, it } from "vitest";
import { HELD_KINDS, KIND_LABEL, OFFERED_BY_MAIL, WIRE_NAME, planKinds } from "./saberraKinds";
import { shownFields } from "./saberraRecords";
import type { ToolInfo } from "./saberraClient";

const listRecords = (inputSchema: unknown): ToolInfo[] => [
  { name: "ask_sera", inputSchema: { type: "object", properties: { question: { type: "string" } } } },
  { name: "list_records", inputSchema },
];

/** Every held kind lands in exactly one of the two lists. The promise, as a check. */
function accountsForEveryKind(plan: ReturnType<typeof planKinds>) {
  const asked = plan.ask.map((a) => a.kind);
  const named = plan.notOffered.map((line) => line.split(":")[0]);
  for (const kind of HELD_KINDS) {
    const inAsked = asked.includes(kind);
    const inNamed = named.includes(KIND_LABEL[kind]);
    expect(inAsked !== inNamed, `${kind} is asked for or named, exactly once`).toBe(true);
  }
}

describe("the wire names", () => {
  it("CALLS A ROLE ASSIGNMENT role_assignment, which is the service's own name for it", () => {
    // Their mail of 2026-09-28: their founder "called list_records on
    // role_assignment". Our id `roleAssignment` is a kind they never heard of.
    expect(WIRE_NAME.roleAssignment).toBe("role_assignment");
    expect(WIRE_NAME.circle).toBe("circle");
    expect(WIRE_NAME.role).toBe("role");
  });

  it("keeps a wire name for every kind this village holds an allow list for", () => {
    // The ids stay ours. A kind with no allow list would be read into nothing.
    for (const kind of HELD_KINDS) {
      expect(shownFields(kind).length, kind).toBeGreaterThan(0);
      expect(WIRE_NAME[kind]).toBeTruthy();
    }
  });

  it("offers, by the mail, circles, roles and role assignments, and nothing else", () => {
    expect([...OFFERED_BY_MAIL].sort()).toEqual(["circle", "role", "roleAssignment"]);
  });
});

describe("planning a sync off the service's schema", () => {
  it("USES THE ENUM THE SERVICE DECLARES, under the argument it names", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: {
          record_type: { type: "string", enum: ["circle", "role", "role_assignment", "meeting"] },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["record_type"],
      }),
    );
    expect(plan.source).toBe("schema");
    expect(plan.argument).toBe("record_type");
    expect(plan.ask).toEqual([
      { kind: "circle", wire: "circle" },
      { kind: "role", wire: "role" },
      { kind: "roleAssignment", wire: "role_assignment" },
    ]);
    accountsForEveryKind(plan);
  });

  it("NAMES A KIND THE SERVICE DOES NOT OFFER, as its own line", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { kind: { type: "string", enum: ["circle", "role", "role_assignment"] } },
      }),
    );
    expect(plan.notOffered).toEqual([
      "tension: not offered by the service yet",
      "risk: not offered by the service yet",
    ]);
    // The known positive beside the absence: the same plan DOES ask for the
    // three it offers, so an empty ask list cannot pass this by accident.
    expect(plan.ask.map((a) => a.kind)).toEqual(["circle", "role", "roleAssignment"]);
  });

  it("asks for a tension once the service starts offering one", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { kind: { type: "string", enum: ["circle", "role", "role_assignment", "tension"] } },
      }),
    );
    expect(plan.ask.map((a) => a.kind)).toContain("tension");
    expect(plan.notOffered).toEqual(["risk: not offered by the service yet"]);
  });

  it("SENDS THE SERVICE'S OWN SPELLING when its enum writes a kind differently", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { table: { type: "string", enum: ["Circles", "Roles", "Role Assignments"] } },
      }),
    );
    expect(plan.argument).toBe("table");
    expect(plan.ask).toEqual([
      { kind: "circle", wire: "Circles" },
      { kind: "role", wire: "Roles" },
      { kind: "roleAssignment", wire: "Role Assignments" },
    ]);
  });

  it("reads an enum carried behind a $ref, which is how a generated schema often writes one", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { type: { anyOf: [{ $ref: "#/$defs/RecordKind" }, { type: "null" }] } },
        $defs: { RecordKind: { type: "string", enum: ["circle", "role_assignment"] } },
      }),
    );
    expect(plan.argument).toBe("type");
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role_assignment"]);
    expect(plan.notOffered).toContain("role: not offered by the service yet");
    accountsForEveryKind(plan);
  });

  it("takes the argument name from the schema when it lists no values, and the kinds from the mail", () => {
    const plan = planKinds(
      listRecords({ type: "object", properties: { record_type: { type: "string" }, limit: { type: "number" } } }),
    );
    expect(plan.argument).toBe("record_type");
    expect(plan.source).toBe("mail");
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role", "role_assignment"]);
    accountsForEveryKind(plan);
  });

  it("NEVER TAKES A SORT ENUM FOR THE KIND ARGUMENT when a familiar name sits beside it", () => {
    // Found by a verifier: `sort_by` lists "role" among its values, and an
    // earlier rule took any enum naming one of our kinds over a plain `kind`.
    // The sync then sent `{ sort_by: "role" }` with no kind at all, and told the
    // steward that circles and role assignments were not offered, which the
    // service never said.
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: {
          kind: { type: "string" },
          sort_by: { type: "string", enum: ["name", "role", "created_at"] },
        },
      }),
    );
    expect(plan.argument).toBe("kind");
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role", "role_assignment"]);
    expect(plan.notOffered).toEqual([
      "tension: not offered by the service yet",
      "risk: not offered by the service yet",
    ]);
    accountsForEveryKind(plan);
  });

  it("never takes a parent filter for the kind argument either", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { parent_type: { type: "string", enum: ["circle"] }, record_type: { type: "string" } },
      }),
    );
    expect(plan.argument).toBe("record_type");
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role", "role_assignment"]);
  });

  it("still reads an enum under an unfamiliar name when no familiar name exists, which is the control", () => {
    const plan = planKinds(
      listRecords({
        type: "object",
        properties: { category: { type: "string", enum: ["circle", "role", "role_assignment"] }, limit: { type: "number" } },
      }),
    );
    expect(plan.argument).toBe("category");
    expect(plan.source).toBe("schema");
    expect(plan.ask.map((a) => a.wire)).toEqual(["circle", "role", "role_assignment"]);
  });

  it("asks for nothing when the named argument accepts none of our kinds, and says what it does accept", () => {
    const plan = planKinds(
      listRecords({ type: "object", properties: { kind: { type: "string", enum: ["meeting", "project"] } } }),
    );
    expect(plan.ask).toEqual([]);
    expect(plan.notOffered).toHaveLength(HELD_KINDS.length);
    expect(plan.note).toContain("meeting, project");
  });
});

describe("falling back to the mail", () => {
  const MAIL_ASK = [
    { kind: "circle", wire: "circle" },
    { kind: "role", wire: "role" },
    { kind: "roleAssignment", wire: "role_assignment" },
  ];

  it("FALLS BACK WHEN tools/list FAILED, and carries the reason into the note", () => {
    const plan = planKinds(null, "the service answered 403");
    expect(plan.source).toBe("mail");
    expect(plan.argument).toBe("kind");
    expect(plan.ask).toEqual(MAIL_ASK);
    expect(plan.notOffered).toEqual([
      "tension: not offered by the service yet",
      "risk: not offered by the service yet",
    ]);
    expect(plan.note).toContain("403");
  });

  it("falls back when list_records carries no schema", () => {
    for (const schema of [null, undefined, {}, { type: "object" }, { type: "object", properties: {} }]) {
      const plan = planKinds(listRecords(schema));
      expect(plan.argument).toBe("kind");
      expect(plan.ask).toEqual(MAIL_ASK);
      expect(plan.note).toContain("no input schema");
    }
  });

  it("falls back when the service lists no list_records tool at all", () => {
    const plan = planKinds([{ name: "ask_sera", inputSchema: {} }]);
    expect(plan.ask).toEqual(MAIL_ASK);
    expect(plan.note).toContain("no list_records tool");
  });

  it("falls back to kind when no argument reads as one, and names what it does take", () => {
    const plan = planKinds(listRecords({ type: "object", properties: { query: { type: "string" } } }));
    expect(plan.argument).toBe("kind");
    expect(plan.ask).toEqual(MAIL_ASK);
    expect(plan.note).toContain("query");
  });
});
