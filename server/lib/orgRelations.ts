/**
 * Links between org nodes, of types the village names itself (0054).
 *
 * Peerdom's lesson: an organisation defines its own relationship vocabulary
 * instead of receiving an enum. A village will ask for deputy, mentor,
 * successor and prerequisite, then two more nobody predicted, and shipping each
 * as its own column is six migrations for one idea.
 *
 * ── ENDPOINTS ARE NODES, NEVER PEOPLE ────────────────────────────────────
 *
 * There is no `user` endpoint kind and adding one would be a different feature
 * with its own consent question. "Ada mentors Bo" is a statement about two
 * people that would then have to be kept out of the public export by
 * filtering, and filtering is how leaks happen. "The Water Steward seat is
 * deputised by the Gate Steward seat" says the useful part, outlives both
 * holders, and is publishable BY CONSTRUCTION.
 *
 * ── WHY `is_cover` EXISTS ────────────────────────────────────────────────
 *
 * A generic link table with no semantics is a table nobody reads. The health
 * dashboard already reports seats with no second holder; a seat with a named
 * deputy is a materially different risk from one without. `is_cover` rides on
 * the TYPE, not on its label, so a village that renames "deputises for" to
 * "stands in for" keeps the meaning.
 */
import type { Pool } from "mysql2/promise";

export type NodeKind = "org_role" | "circle";

export interface RelationType {
  id: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
  isCover: boolean;
  order: number;
  isExample: boolean;
}

export interface Relation {
  id: string;
  typeId: string;
  fromKind: NodeKind;
  fromId: string;
  toKind: NodeKind;
  toId: string;
  note: string | null;
  isExample: boolean;
}

/**
 * The starter vocabulary, seeded ONLY into an empty table.
 *
 * Same rule the quest library already follows: a village that has edited or
 * deleted these never has them come back, because coming back would make an
 * intentional deletion look like a bug. They are suggestions, not platform
 * vocabulary, which is the whole point of the feature.
 */
export const STARTER_TYPES: Array<Omit<RelationType, "isExample">> = [
  { id: "deputy", label: "is deputised by", inverseLabel: "deputises for", symmetric: false, isCover: true, order: 1 },
  { id: "successor", label: "is succeeded by", inverseLabel: "succeeds", symmetric: false, isCover: true, order: 2 },
  { id: "mentor", label: "is mentored by", inverseLabel: "mentors", symmetric: false, isCover: false, order: 3 },
  { id: "prerequisite", label: "requires", inverseLabel: "is required by", symmetric: false, isCover: false, order: 4 },
  { id: "works-with", label: "works closely with", inverseLabel: "works closely with", symmetric: true, isCover: false, order: 5 },
  // 0083 (P5): "if I disagree, where do I go" as a drawable line. The power
  // map draws it as a thin arrow; existing deployments got the same row from
  // the migration's INSERT IGNORE. Deleted once, gone for good, like every
  // starter type.
  { id: "escalation", label: "escalates objections to", inverseLabel: "hears objections from", symmetric: false, isCover: false, order: 6 },
];

export async function seedStarterTypes(pool: Pool): Promise<number> {
  const [[row]] = await pool.query<any[]>("SELECT COUNT(*) n FROM org_relation_types");
  if (Number(row?.n ?? 0) > 0) return 0;
  let n = 0;
  for (const t of STARTER_TYPES) {
    const [r]: any = await pool.query(
      `INSERT IGNORE INTO org_relation_types (id, label, inverse_label, symmetric, is_cover, sort_order)
       VALUES (?,?,?,?,?,?)`,
      [t.id, t.label, t.inverseLabel, t.symmetric ? 1 : 0, t.isCover ? 1 : 0, t.order],
    );
    n += r?.affectedRows ?? 0;
  }
  return n;
}

/** Same shape orgChart.ts uses: a clock stamp plus a counter, so two ids
 *  minted in the same millisecond still differ. */
let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

const TYPE_COLS = "id, label, inverse_label, symmetric, is_cover, sort_order, is_example";
const REL_COLS = "id, type_id, from_kind, from_id, to_kind, to_id, note, is_example";

function rowToType(r: any): RelationType {
  return {
    id: r.id,
    label: r.label,
    inverseLabel: r.inverse_label,
    symmetric: !!r.symmetric,
    isCover: !!r.is_cover,
    order: Number(r.sort_order ?? 0),
    isExample: !!r.is_example,
  };
}

function rowToRelation(r: any): Relation {
  return {
    id: r.id,
    typeId: r.type_id,
    fromKind: r.from_kind === "circle" ? "circle" : "org_role",
    fromId: r.from_id,
    toKind: r.to_kind === "circle" ? "circle" : "org_role",
    toId: r.to_id,
    note: r.note ?? null,
    isExample: !!r.is_example,
  };
}

export async function listRelationTypes(pool: Pool): Promise<RelationType[]> {
  const [rows]: any = await pool.query(`SELECT ${TYPE_COLS} FROM org_relation_types ORDER BY sort_order, label`);
  return (rows as any[]).map(rowToType);
}

export async function listRelations(pool: Pool): Promise<Relation[]> {
  const [rows]: any = await pool.query(`SELECT ${REL_COLS} FROM org_relations ORDER BY id`);
  return (rows as any[]).map(rowToRelation);
}

/**
 * What is wrong with a proposed link, in the words somebody would use.
 *
 * Pure, so the same sentence can be shown before a save is attempted and
 * returned when one is refused, and so the rules are testable without a
 * database.
 */
export function relationProblem(
  rel: { typeId: string; fromKind: string; fromId: string; toKind: string; toId: string },
  known: { types: Set<string>; roles: Set<string>; circles: Set<string> },
): string | null {
  if (!known.types.has(rel.typeId)) return "That relationship type does not exist";
  const endpoint = (kind: string, id: string) =>
    kind === "circle" ? known.circles.has(id) : kind === "org_role" ? known.roles.has(id) : false;
  if (!endpoint(rel.fromKind, rel.fromId)) return "The first end of the link is not a role or a circle here";
  if (!endpoint(rel.toKind, rel.toId)) return "The other end of the link is not a role or a circle here";
  // A node standing in for itself is always a mistake, and it is the one that
  // renders as an infinite loop on the page rather than as bad data.
  if (rel.fromKind === rel.toKind && rel.fromId === rel.toId) {
    return "A role cannot be linked to itself";
  }
  return null;
}

export async function createRelation(
  pool: Pool,
  body: { typeId: string; fromKind: string; fromId: string; toKind: string; toId: string; note?: string | null; createdBy?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [types, roles, circles] = await Promise.all([
    listRelationTypes(pool),
    pool.query<any[]>("SELECT id FROM org_roles WHERE is_example = 0").then(([r]) => r),
    pool.query<any[]>("SELECT id FROM circles WHERE is_example = 0").then(([r]) => r),
  ]);
  const problem = relationProblem(body, {
    types: new Set(types.map((t) => t.id)),
    roles: new Set((roles as any[]).map((r) => String(r.id))),
    circles: new Set((circles as any[]).map((r) => String(r.id))),
  });
  if (problem) return { ok: false, error: problem };

  const id = newId("rel");
  try {
    await pool.query(
      `INSERT INTO org_relations (id, type_id, from_kind, from_id, to_kind, to_id, note, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, body.typeId, body.fromKind, body.fromId, body.toKind, body.toId, body.note ?? null, body.createdBy ?? null],
    );
  } catch (e: any) {
    // The unique key is on the whole tuple, so this is somebody saying the
    // same thing twice.
    if (e?.code === "ER_DUP_ENTRY") return { ok: false, error: "That link already exists" };
    throw e;
  }
  return { ok: true, id };
}

export async function deleteRelation(pool: Pool, id: string): Promise<boolean> {
  const [r]: any = await pool.query("DELETE FROM org_relations WHERE id = ? AND is_example = 0", [id]);
  return (r?.affectedRows ?? 0) > 0;
}

export interface RelationView {
  id: string;
  typeId: string;
  /** Reads correctly from the node being looked at, whichever end it is. */
  label: string;
  otherKind: NodeKind;
  otherId: string;
  isCover: boolean;
  note: string | null;
}

/**
 * Every link touching one node, phrased from that node's side.
 *
 * A relation is stored once and read from both ends, so the label has to flip:
 * standing on the Water Steward seat the link reads "is deputised by Gate
 * Steward", and standing on Gate Steward the SAME ROW reads "deputises for
 * Water Steward". Storing it twice to avoid the flip is how the two copies
 * eventually disagree.
 */
export function relationsFor(
  node: { kind: NodeKind; id: string },
  relations: Relation[],
  types: Map<string, RelationType>,
): RelationView[] {
  const out: RelationView[] = [];
  for (const r of relations) {
    if (r.isExample) continue;
    const t = types.get(r.typeId);
    if (!t) continue; // the type was deleted; the row is orphaned, not shown
    const isFrom = r.fromKind === node.kind && r.fromId === node.id;
    const isTo = r.toKind === node.kind && r.toId === node.id;
    if (!isFrom && !isTo) continue;
    out.push({
      id: r.id,
      typeId: r.typeId,
      label: isFrom ? t.label : t.inverseLabel,
      otherKind: isFrom ? r.toKind : r.fromKind,
      otherId: isFrom ? r.toId : r.fromId,
      isCover: t.isCover,
      note: r.note,
    });
  }
  return out;
}

/**
 * Which seats have somebody named to carry them.
 *
 * This is the reason the table earns its place. `structuralLoad` reports seats
 * with no second holder; this says which of those have a deputy or a successor
 * written down, which is the difference between a risk and a plan.
 *
 * Cover is DIRECTIONAL on purpose. A seat deputised BY another is covered; the
 * deputy is not thereby covered itself. Treating the link as mutual would
 * report the whole chain as safe the moment one link existed.
 */
export function coveredSeatIds(relations: Relation[], types: Map<string, RelationType>): Set<string> {
  const covered = new Set<string>();
  for (const r of relations) {
    if (r.isExample) continue;
    const t = types.get(r.typeId);
    if (!t?.isCover) continue;
    if (r.fromKind === "org_role") covered.add(r.fromId);
    // A symmetric cover type ("stands in for each other") covers both ends,
    // which is exactly what symmetric means and why the flag is separate.
    if (t.symmetric && r.toKind === "org_role") covered.add(r.toId);
  }
  return covered;
}
