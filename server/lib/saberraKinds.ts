/**
 * Which kinds a sync asks the outside service for, under which names, and
 * under which argument.
 *
 * ── WHY THE NAMES ARE NOT OURS ───────────────────────────────────────────
 *
 * This village keeps an allow list per kind in `saberraRecords.ts` under its
 * own ids: `circle`, `role`, `roleAssignment`, `tension`, `risk`. Those ids
 * stay. The service names one of them differently. Their mail of 2026-09-24
 * says `list_records` and `get_record` cover "Circles, Roles, and Role
 * Assignments", and their mail of 2026-09-28 says their founder "called
 * list_records on role_assignment". So the wire name for `roleAssignment` is
 * `role_assignment`, and a sync that sent our id was asking for a kind the
 * service has never heard of.
 *
 * The same mails say what the service does NOT offer yet: tensions and risks.
 * A sync used to ask for both and count the refusals as failures. Now it asks
 * only for what is offered, and names every kind it holds and did not ask for
 * as its own line in the answer. A kind left out in silence is a smaller number
 * reported as a success, which is the one thing this module promises never to
 * do.
 *
 * ── WHY THE SERVICE'S OWN SCHEMA OUTRANKS THE MAIL ───────────────────────
 *
 * The argument a kind travels under has never been measured. Our client sends
 * `{ kind }`. The service may call it `record_type`, `type` or `table`, and it
 * may list the values it accepts. MCP gives every tool an `inputSchema` in the
 * `tools/list` answer, which is the service stating what it takes, so this
 * reads that first:
 *
 *   1. A property carrying an enum that names any of our kinds is the kind
 *      argument, and the enum decides what is offered. We send the enum's own
 *      spelling, so `Role Assignments` in their list is what goes back to them.
 *   2. Otherwise, a property with a familiar argument name is the kind
 *      argument, and the mail decides what is offered.
 *   3. Otherwise, or when `tools/list` failed or carried no schema, the
 *      argument is `kind` and the mail decides.
 *
 * Every plan carries a `note` saying which of those happened, so a steward or
 * a developer reading a sync's answer can tell a measured plan from a guessed
 * one.
 *
 * Pure: no pool, no clock, no network. The caller hands in what it fetched.
 */
import type { ToolInfo } from "./saberraClient";
import type { SaberraRecordKind } from "./saberraRecords";

/** The kinds this village holds an allow list for, in the order a sync asks. */
export const HELD_KINDS = ["circle", "role", "roleAssignment", "tension", "risk"] as const satisfies readonly SaberraRecordKind[];

export type HeldKind = (typeof HELD_KINDS)[number];

/** Our kind id to the name the service uses for it. */
export const WIRE_NAME: Readonly<Record<HeldKind, string>> = {
  circle: "circle",
  role: "role",
  roleAssignment: "role_assignment",
  tension: "tension",
  risk: "risk",
};

/** How a kind is named in a line a steward reads. */
export const KIND_LABEL: Readonly<Record<HeldKind, string>> = {
  circle: "circle",
  role: "role",
  roleAssignment: "role assignment",
  tension: "tension",
  risk: "risk",
};

/** What the vendor's mail of 2026-09-24 says `list_records` covers. Used when the service does not say. */
export const OFFERED_BY_MAIL: readonly HeldKind[] = ["circle", "role", "roleAssignment"];

/** The argument a kind travels under when nothing better is known. */
export const DEFAULT_ARGUMENT = "kind";

/** Argument names a kind plausibly travels under, most believed first. */
const ARGUMENT_NAMES = [
  "kind",
  "record_type",
  "recordType",
  "record_kind",
  "recordKind",
  "type",
  "table",
  "entity",
  "entity_type",
  "entityType",
] as const;

export interface KindPlan {
  /** The `list_records` argument the kind is sent under. */
  argument: string;
  /** Our kinds the service offers, each with the exact name to send. */
  ask: { kind: HeldKind; wire: string }[];
  /** Our kinds the service does not offer, one line each, never left out. */
  notOffered: string[];
  /** Whether the service's own schema decided, or the mail did. */
  source: "schema" | "mail";
  /** Which rule above produced this plan, said plainly. */
  note: string;
}

/**
 * The comparable form of a kind name. `Role Assignments`, `role_assignment`
 * and `roleAssignment` are one kind; case, separators and a plural ending are
 * the differences that carry no meaning.
 */
function comparable(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Follow a local `$ref` once, which is how a generated schema often carries an
 * enum: `{ "$ref": "#/$defs/RecordKind" }` beside a `$defs` block.
 */
function resolve(node: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  const n = asObject(node);
  if (!n) return null;
  const ref = typeof n.$ref === "string" ? n.$ref : "";
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  if (!m) return n;
  return asObject(asObject(root[m[1]])?.[m[2]]) ?? n;
}

/**
 * Every string value a property declares it accepts, or null when it declares
 * none. Reads `enum`, `const`, and the branches of `anyOf` and `oneOf`, which
 * covers an optional enum written as "this enum, or null".
 */
function acceptedValues(prop: unknown, root: Record<string, unknown>): string[] | null {
  const p = resolve(prop, root);
  if (!p) return null;
  const out: string[] = [];
  const take = (node: Record<string, unknown> | null) => {
    if (!node) return;
    if (Array.isArray(node.enum)) for (const v of node.enum) if (typeof v === "string") out.push(v);
    if (typeof node.const === "string") out.push(node.const);
  };
  take(p);
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = p[key];
    if (Array.isArray(branches)) for (const b of branches) take(resolve(b, root));
  }
  return out.length > 0 ? out : null;
}

/** Whether a declared value names one of our kinds. */
function namesOneOfOurs(value: string): boolean {
  return HELD_KINDS.some((k) => comparable(WIRE_NAME[k]) === comparable(value));
}

function notOfferedLine(kind: HeldKind): string {
  return `${KIND_LABEL[kind]}: not offered by the service yet`;
}

function planFrom(offered: readonly HeldKind[], wireFor: (k: HeldKind) => string, argument: string, source: KindPlan["source"], note: string): KindPlan {
  const ask: KindPlan["ask"] = [];
  const notOffered: string[] = [];
  for (const kind of HELD_KINDS) {
    if (offered.includes(kind)) ask.push({ kind, wire: wireFor(kind) });
    else notOffered.push(notOfferedLine(kind));
  }
  return { argument, ask, notOffered, source, note };
}

function byMail(argument: string, note: string): KindPlan {
  return planFrom(OFFERED_BY_MAIL, (k) => WIRE_NAME[k], argument, "mail", note);
}

/**
 * The plan for one sync.
 *
 * `tools` is what `tools/list` answered, or null when it failed; `failure` is
 * its detail, carried into the note so the reason survives to the screen.
 */
export function planKinds(tools: readonly ToolInfo[] | null, failure?: string): KindPlan {
  if (tools === null) {
    const why = failure ? ` It answered: ${failure}` : "";
    return byMail(
      DEFAULT_ARGUMENT,
      `The service did not list its tools, so the kinds its mail names were asked for under "${DEFAULT_ARGUMENT}".${why}`,
    );
  }
  const tool = tools.find((t) => t.name === "list_records");
  if (!tool) {
    return byMail(
      DEFAULT_ARGUMENT,
      `The service lists no list_records tool, so the kinds its mail names were asked for under "${DEFAULT_ARGUMENT}".`,
    );
  }
  const schema = asObject(tool.inputSchema);
  const props = asObject(schema?.properties);
  if (!schema || !props || Object.keys(props).length === 0) {
    return byMail(
      DEFAULT_ARGUMENT,
      `list_records carries no input schema, so the kinds its mail names were asked for under "${DEFAULT_ARGUMENT}".`,
    );
  }

  // Rule 1: an enum that names one of our kinds. A familiar argument name wins
  // a tie, so a schema with two enums picks the one that reads like a kind.
  const withEnum = Object.keys(props)
    .map((name) => ({ name, values: acceptedValues(props[name], schema) }))
    .filter((p): p is { name: string; values: string[] } => p.values !== null && p.values.some(namesOneOfOurs))
    .sort((a, b) => rank(a.name) - rank(b.name));
  const chosen = withEnum[0];
  if (chosen) {
    const spelling = new Map<HeldKind, string>();
    for (const kind of HELD_KINDS) {
      const hit = chosen.values.find((v) => comparable(v) === comparable(WIRE_NAME[kind]));
      if (hit !== undefined) spelling.set(kind, hit);
    }
    return planFrom(
      HELD_KINDS.filter((k) => spelling.has(k)),
      (k) => spelling.get(k) ?? WIRE_NAME[k],
      chosen.name,
      "schema",
      `The service's schema names "${chosen.name}" and accepts: ${chosen.values.join(", ")}.`,
    );
  }

  // Rule 2: a familiar argument name with no enum we can read.
  const named = ARGUMENT_NAMES.find((n) => n in props);
  if (named) {
    const declared = acceptedValues(props[named], schema);
    if (declared) {
      // It declares what it accepts and none of it is ours. Ask for nothing
      // and say what it does accept, so the mapping can be fixed by a person.
      return planFrom(
        [],
        (k) => WIRE_NAME[k],
        named,
        "schema",
        `The service's schema names "${named}" and accepts only: ${declared.join(", ")}. None of those is a kind this village reads.`,
      );
    }
    return byMail(named, `The service's schema names "${named}" without listing its values, so the kinds its mail names were asked for.`);
  }

  // Rule 3.
  return byMail(
    DEFAULT_ARGUMENT,
    `list_records names no argument that reads as a kind (it takes: ${Object.keys(props).join(", ")}), so the kinds its mail names were asked for under "${DEFAULT_ARGUMENT}".`,
  );
}

/** Where a name sits in the believed order, unknown names last. */
function rank(name: string): number {
  const i = (ARGUMENT_NAMES as readonly string[]).indexOf(name);
  return i === -1 ? ARGUMENT_NAMES.length : i;
}
