/**
 * THE CONSEQUENCE PEN'S VOTE (canvas follow-up G.1 and G.2, 2026-11-09).
 *
 * Plan 2.3 puts the exit terms, the care door and the Decision Matrix's human
 * rows under the consequence pen: the founders before the Birthing, a vote of
 * the whole village at the structural tier after it. Until this file the
 * second half had no machinery, so after the Birthing a suggestion to any of
 * them waited forever (`CONSEQUENCE_VOTE_NOT_BUILT`), and the Departures
 * editor still let an administrator rewrite the exit terms alone. Article 0
 * (Rye, 2026-11-06): everything a village runs on changes by its own vote, and
 * a refusal names the vote that gets past it.
 *
 * The vote is a change set, like a dial's, carried by the mechanics proposal
 * door (`POST /api/game/mechanics/proposals`) and landed by `applyChangeSet`
 * (server/lib/changeset.ts). Three item kinds:
 *
 *   exit_terms        the voluntary and involuntary terms of the exit policy
 *   exit_restorative  the care door, while Conflict Evolution is off (with it
 *                     on, the conflict agreement's own vote is the door)
 *   matrix_row        one human row of the Decision Matrix, added, changed or
 *                     removed
 *
 * Each is priced structural (`CRITICALITY_FOR_ITEM_KIND`). The exit writes go
 * through the exit policy's own save (`exitVoteDoor`, server/routes/exits.ts),
 * minus only the administrator check, so every refusal the Departures editor
 * meets, a carried vote meets too. The matrix writes are the matrix's own
 * statements (server/repos/decisionMatrixRows.ts).
 */
import type { Pool } from "mysql2/promise";
import { parseExitTerms, parseMatrixRow, parseRestorative, type MatrixRowChange } from "../../shared/canvasFrames";
import { decisionMatrixRowById, removeDecisionMatrixRow, writeDecisionMatrixRow } from "../repos/decisionMatrixRows";

/** The door a member files the vote through. */
export const MECHANICS_PROPOSAL_DOOR = "/api/game/mechanics/proposals";

/**
 * Said wherever the consequence pen refuses a direct write after the Birthing.
 * It names the vote that gets past it (Article 0).
 */
export const CONSEQUENCE_VOTE =
  "The Game has started, so this changes only by a vote of the whole village at the structural tier. " +
  "Suggest it on the canvas, and the member who suggested it files it as a proposal the village decides.";

export type ExitItemKind = "exit_terms" | "exit_restorative";

/** The key an exit change is filed under on a proposal. */
export const exitChangeKey = (kind: ExitItemKind): string => (kind === "exit_terms" ? "exit:terms" : "exit:restorative");

/** The fields an exit-terms change may carry beyond the four a canvas suggestion sets. */
const TERMS_EXTRA = ["decidingDomainId", "appealDomainId", "grounds"] as const;
const TERMS_CANVAS = ["noticePeriodDays", "valuationMethod", "unwindSteps", "involuntaryProcess"] as const;
const RESTORATIVE_CANVAS = ["steps", "intakeContactRole", "coverRole", "replyHours"] as const;

const pick = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * An exit change as a vote may carry it, or the sentence that refuses it. The
 * canvas's own parsers judge the fields a suggestion sets, so a filed
 * suggestion and a hand-filed proposal refuse alike; the extra fields (the two
 * circles, the involuntary grounds, the outside contact) are the rest of each
 * block, so no term is left without a vote.
 */
export function exitChangeOf(kind: ExitItemKind, raw: unknown): { ok: true; change: Record<string, unknown> } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  const canvasPart = pick(b, kind === "exit_terms" ? TERMS_CANVAS : RESTORATIVE_CANVAS);
  if (Object.keys(canvasPart).length) {
    const parsed = kind === "exit_terms" ? parseExitTerms(canvasPart) : parseRestorative(canvasPart);
    if (!parsed.ok) return parsed;
    Object.assign(out, parsed.change);
  }
  if (kind === "exit_terms") {
    for (const key of ["decidingDomainId", "appealDomainId"] as const) {
      if (b[key] === undefined) continue;
      if (typeof b[key] !== "string") return { ok: false, error: "Name a circle by its id, or leave it empty." };
      out[key] = String(b[key]).trim();
    }
    if (b.grounds !== undefined) {
      const grounds = Array.isArray(b.grounds) ? b.grounds.map((g) => String(g ?? "").trim()).filter(Boolean) : [];
      if (!grounds.length) return { ok: false, error: "Give at least one question a steward answers before asking someone to leave." };
      out.grounds = grounds;
    }
  } else if (b.outsideContact !== undefined) {
    out.outsideContact = b.outsideContact;
  }
  if (!Object.keys(out).length) return { ok: false, error: "Say which part of the exit policy this changes." };
  return { ok: true, change: out };
}

/**
 * The exit-policy body a carried change saves: the policy as every reader is
 * served it, with the change's fields laid over it. The save itself carries
 * the stored closing section, so nothing it owns comes from here.
 */
export function exitBodyWithChange(current: any, kind: ExitItemKind, change: Record<string, unknown>) {
  const now = current ?? {};
  const body: any = {
    placeholder: now.placeholder === true,
    voluntary: { ...(now.voluntary ?? {}) },
    involuntary: { ...(now.involuntary ?? {}) },
    restorative: { ...(now.restorative ?? {}) },
  };
  if (kind === "exit_terms") {
    for (const key of ["noticePeriodDays", "valuationMethod", "unwindSteps"] as const) {
      if (change[key] !== undefined) body.voluntary[key] = change[key];
    }
    if (change.involuntaryProcess !== undefined) body.involuntary.process = change.involuntaryProcess;
    for (const key of TERMS_EXTRA) if (change[key] !== undefined) body.involuntary[key] = change[key];
  } else {
    for (const key of [...RESTORATIVE_CANVAS, "outsideContact"] as const) {
      if (change[key] !== undefined) body.restorative[key] = change[key];
    }
  }
  return body;
}

/** What the named fields read in this policy today, in the change's own spelling. */
export function exitFieldsNow(current: any, kind: ExitItemKind, change: Record<string, unknown>): Record<string, unknown> {
  const now = current ?? {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(change)) {
    if (kind === "exit_terms") {
      if (key === "involuntaryProcess") out[key] = now.involuntary?.process ?? "";
      else if ((TERMS_EXTRA as readonly string[]).includes(key)) out[key] = now.involuntary?.[key] ?? "";
      else out[key] = now.voluntary?.[key] ?? "";
    } else out[key] = now.restorative?.[key] ?? "";
  }
  return out;
}

/** Fields as one line a voter reads: "noticePeriodDays: 30; unwindSteps: A / B". */
export function changeWords(fields: Record<string, unknown>): string {
  const said = (v: unknown): string => {
    if (Array.isArray(v)) return v.map((x) => String(x)).join(" / ");
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map((x) => String(x ?? "")).filter(Boolean).join(", ");
    return v === null || v === undefined ? "" : String(v);
  };
  return Object.entries(fields)
    .map(([k, v]) => `${k}: ${said(v) || "(none)"}`)
    .join("; ");
}

/**
 * The exit policy's side of a vote, built by server/routes/exits.ts over the
 * policy's own save and injected here, so this file and the change-set
 * executor stay free of the route.
 */
export interface ExitVoteDoor {
  /** The change judged by every refusal the save makes, writing nothing: what it reads now and would read, or why not. */
  judge(kind: ExitItemKind, change: Record<string, unknown>): Promise<{ from: string; to: string } | string>;
  /** The carried change, written through the save. */
  write(kind: ExitItemKind, change: Record<string, unknown>): Promise<{ ok: true; from: string; to: string } | { ok: false; problem: string }>;
}

// ── The Decision Matrix's human rows ─────────────────────────────────────────

export type MatrixAct = "insert" | "update" | "remove";

export interface MatrixRowItemShape {
  act?: unknown;
  rowId?: unknown;
  row?: unknown;
}

/** The key a matrix change is filed under: one row, or a new row by its subject. */
export function matrixChangeKey(item: MatrixRowItemShape): string {
  const id = Number(item.rowId);
  if (Number.isInteger(id) && id > 0 && item.act !== "insert") return `matrix:row:${id}`;
  const subject = String((item.row as { subject?: unknown } | undefined)?.subject ?? "").trim().toLowerCase();
  return `matrix:new:${subject}`.slice(0, 120);
}

export type JudgedMatrixItem =
  | { ok: true; act: MatrixAct; rowId: number | null; row: MatrixRowChange | null; from: string; to: string }
  | { ok: false; problem: string };

const rowWords = (r: { subject: string; approval: string; consultation: string; information: string; method: string }) =>
  `${r.subject}: approved by ${r.approval}; asked first ${r.consultation}; told ${r.information}${r.method ? `; method ${r.method}` : ""}`;

/** A matrix change judged against the table as it stands, writing nothing. */
export async function judgeMatrixItem(pool: Pool, item: MatrixRowItemShape): Promise<JudgedMatrixItem> {
  const act = item.act;
  if (act !== "insert" && act !== "update" && act !== "remove") {
    return { ok: false, problem: "A matrix change adds a row, changes one, or removes one" };
  }
  let rowId: number | null = null;
  let before: Awaited<ReturnType<typeof decisionMatrixRowById>> = null;
  if (act !== "insert") {
    const n = Number(item.rowId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, problem: "Name the row of the matrix this changes" };
    before = await decisionMatrixRowById(pool, n);
    if (!before) return { ok: false, problem: "There is no matrix row by that number" };
    rowId = n;
  }
  if (act === "remove") return { ok: true, act, rowId, row: null, from: rowWords(before!), to: "(removed)" };
  const parsed = parseMatrixRow({ ...((item.row ?? {}) as Record<string, unknown>), rowId: undefined });
  if (!parsed.ok) return { ok: false, problem: parsed.error.replace(/\.$/, "") };
  const { rowId: _ignored, ...row } = parsed.row;
  return { ok: true, act, rowId, row: row as MatrixRowChange, from: before ? rowWords(before) : "(no row)", to: rowWords(row) };
}

/** The carried matrix change, written. */
export async function writeMatrixItem(
  pool: Pool,
  item: MatrixRowItemShape,
  actor: string,
): Promise<{ ok: true; rowId: number; from: string; to: string } | { ok: false; problem: string }> {
  const judged = await judgeMatrixItem(pool, item);
  if (!judged.ok) return judged;
  if (judged.act === "remove") {
    if (!(await removeDecisionMatrixRow(pool, judged.rowId!))) return { ok: false, problem: "there is no matrix row by that number" };
    return { ok: true, rowId: judged.rowId!, from: judged.from, to: judged.to };
  }
  const id = await writeDecisionMatrixRow(pool, { ...judged.row!, ...(judged.rowId ? { rowId: judged.rowId } : {}) }, actor);
  if (!id) return { ok: false, problem: "there is no matrix row by that number" };
  return { ok: true, rowId: id, from: judged.from, to: judged.to };
}
