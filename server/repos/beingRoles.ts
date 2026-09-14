/**
 * `roles.represents_being`: which permission roles speak for a being (19G).
 *
 * ── WHY THIS IS A REPO MODULE AND NOT A LINE IN THE QUORUM CODE ────────────
 *
 * `server/lib/nonHumanSeats.ts` argues at length why a river's seat is read off
 * the `roles` plane and not `org_roles`, and that argument is not repeated
 * here. What is this file's business is narrower: `represents_being` is a
 * column that changes a QUORUM DENOMINATOR, so every reader of it has to be
 * findable in one place. A second reader written later with a slightly
 * different WHERE — one that forgot the flag is nullable, say, or that read
 * `org_roles` because the two planes share a word — would move the bar a
 * constitutional decision has to clear, and nothing about it would look wrong
 * at the call site.
 *
 * ── THE PROBE BELONGS WITH THE READ IT GUARDS ──────────────────────────────
 *
 * `representsBeingColumnExists` asks `information_schema` whether the column is
 * on this database at all. That is a schema question and not a village
 * question, and there was an argument for leaving it where it was and waiving
 * it. It is here anyway, because the two statements are one act: the answer to
 * the probe decides whether the second statement may run, and separating them
 * would let a future caller run the read without the guard. On a database that
 * predates the founding step which adds the column, that read is an error and
 * not an empty list.
 *
 * The distinction the probe exists for is the whole point of the module:
 *
 *   `known: false`   the Game cannot tell whether any seat speaks for a being
 *   `roleIds: []`    the Game can tell, and this village has named none
 *
 * Those are different facts. A caller that collapsed them would count weight
 * the village had voted out of its own arithmetic, so this file never returns
 * one where it means the other.
 *
 * ── NO CACHE SITS ABOVE THIS READ ──────────────────────────────────────────
 *
 * `server/index.ts` caches the roles plane for permission checks, and this read
 * deliberately does not go through it. A quorum is arithmetic about the state
 * of the roll at the moment a ballot closes, and reading it from a cache that
 * a founding step has just written to would settle a vote against a roll the
 * database no longer agrees with. The cost is one round trip per close.
 *
 * ── ONE READER IS ELSEWHERE AND IS NAMED SO IT STAYS FINDABLE ──────────────
 *
 * Nothing else reads `represents_being` today, which is why this file can be
 * short and honest at the same time. The rest of the `roles` table — the
 * capability lists, the naming, the seeding — is still read in `server/index.ts`
 * and in `server/lib/stewardship.ts`. This module does not claim to be that
 * table's home; it claims to be the home of one column that quorum arithmetic
 * depends on.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** The column on `roles` that says this seat speaks for a being. */
export const REPRESENTS_BEING_COLUMN = "represents_being";

/**
 * What the roles plane says about beings right now.
 *
 * `known` false means the flag is not on this database yet. It is the "could
 * not tell" answer and it is deliberately different from an empty `roleIds`,
 * which is "this village has named no beings".
 */
export interface BeingRoles {
  known: boolean;
  roleIds: string[];
}

/**
 * Is the flag on this database at all?
 *
 * `TABLE_SCHEMA = DATABASE()` and never a schema name typed here: a fork runs
 * this code against a schema whose name this repository does not know, and a
 * probe that named one would answer "absent" on every one of them. The column
 * name travels as a PARAMETER rather than being interpolated, which costs
 * nothing and means this statement can never be the one that carries a value
 * into the text of a query.
 */
async function representsBeingColumnExists(pool: Pool): Promise<boolean> {
  const [cols] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = ?",
    [REPRESENTS_BEING_COLUMN],
  );
  return cols.length > 0;
}

/**
 * Every role flagged as speaking for a being, or the "could not tell" answer.
 *
 * The flag is compared to `1` and not tested for truthiness, which is what the
 * raw statement did. The column arrives with the founding step that writes it
 * and this repository holds no migration for it yet, so its exact type is not
 * settled here; `= 1` matches a `tinyint(1)` set true and leaves NULL out,
 * which is the safe direction for a value that widens a quorum denominator.
 *
 * Unordered, because the caller turns the result into a membership test and
 * never renders it. An ORDER BY added later would be a cost with no reader.
 */
export async function beingRoleIds(pool: Pool): Promise<BeingRoles> {
  if (!(await representsBeingColumnExists(pool))) return { known: false, roleIds: [] };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM roles WHERE \`${REPRESENTS_BEING_COLUMN}\` = 1`,
  );
  return { known: true, roleIds: rows.map((r) => String(r.id)) };
}
