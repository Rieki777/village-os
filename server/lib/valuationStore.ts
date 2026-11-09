/**
 * THE VALUATION ENGINE'S MEMORY (0336): the village's model, version by
 * version, and the record every set figure leaves beside its suggestion.
 *
 * The engine (shared/valuationEngine.ts) and the setting rule
 * (shared/valuationSetting.ts) are pure; this file is where they meet the
 * database. It decides nothing the shared files do not: it reads the model a
 * suggestion is priced with, writes the record, and reads records back for the
 * anti-swap rule and for calibration.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { validateModel, type ValuationModel, type WorkInputs } from "../../shared/valuation";
import { modelForVillage, type PayeeSuggestion } from "../../shared/valuationEngine";
import type { InputChange, SettingRecord } from "../../shared/valuationSetting";
import { EARNED_EQUITY } from "./economy";
import { tokenDef } from "./ledger";
import { insertModelRow, insertSettingRow, latestModelRow, setRowsInCategory, setterRowsSince, settingRowById, settingRowsForWork, signSettingRow } from "../repos/valuation";

type Db = Pool | PoolConnection;

const parse = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

/** The model the village prices with now: its newest saved version, or the platform rules in its own currency. */
export async function currentModel(db: Db, currency: string): Promise<ValuationModel> {
  const row = await latestModelRow(db);
  if (!row) return modelForVillage(currency);
  const body = parse<ValuationModel | null>(row.body_json, null);
  return body ? { ...body, version: Number(row.version) } : modelForVillage(currency);
}

/** Save a new version. Never edits one. Refuses, with every reason, a model `validateModel` refuses. */
export async function saveModelVersion(
  db: Db,
  model: ValuationModel,
  p: { door: string; actorId: string | null; note?: string | null; proposalRef?: string | null },
): Promise<{ ok: true; version: number } | { ok: false; problems: string[] }> {
  const problems = validateModel(model);
  if (problems.length) return { ok: false, problems };
  const latest = await latestModelRow(db);
  const version = latest ? Number(latest.version) + 1 : 1;
  await insertModelRow(db, {
    id: randomUUID(),
    version,
    bodyJson: JSON.stringify({ ...model, version }),
    baseVersion: latest ? Number(latest.version) : null,
    door: p.door,
    proposalRef: p.proposalRef ?? null,
    actorId: p.actorId,
    note: (p.note ?? "").trim().slice(0, 500) || null,
  });
  return { ok: true, version };
}

export type SettingState = "awaiting_second" | "awaiting_vote" | "set";

export interface StoredSetting {
  id: string;
  workKind: SettingRecord["workKind"];
  workRef: string;
  category: string;
  state: SettingState;
  modelVersion: number;
  currency: string;
  suggestedMinor: number;
  rangeLowMinor: number;
  rangeHighMinor: number;
  bandLowMinor: number;
  bandHighMinor: number;
  setMinor: number;
  gapMinor: number;
  inside: boolean;
  needs: SettingRecord["needs"];
  reason: string | null;
  note: string | null;
  ownNumberFirst: number | null;
  inputs: WorkInputs;
  suggestion: PayeeSuggestion;
  inputChanges: InputChange[];
  payeeIds: string[];
  setterId: string;
  signerId: string | null;
  signedAt: string | null;
  conflicted: boolean;
  eeHeld: boolean;
  createdAt: string;
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function rowToSetting(r: RowDataPacket): StoredSetting {
  return {
    id: String(r.id),
    workKind: r.work_kind,
    workRef: String(r.work_ref),
    category: String(r.category),
    state: r.state,
    modelVersion: Number(r.model_version),
    currency: String(r.currency),
    suggestedMinor: Number(r.suggested_minor),
    rangeLowMinor: Number(r.range_low_minor),
    rangeHighMinor: Number(r.range_high_minor),
    bandLowMinor: Number(r.band_low_minor),
    bandHighMinor: Number(r.band_high_minor),
    setMinor: Number(r.set_minor),
    gapMinor: Number(r.gap_minor),
    inside: !!Number(r.inside),
    needs: r.needs,
    reason: r.reason ?? null,
    note: r.note ?? null,
    ownNumberFirst: r.own_number_first === null || r.own_number_first === undefined ? null : Number(r.own_number_first),
    inputs: parse<WorkInputs>(r.inputs_json, { kind: "role", lines: [] }),
    suggestion: parse<PayeeSuggestion>(r.suggestion_json, null as unknown as PayeeSuggestion),
    inputChanges: parse<InputChange[]>(r.input_changes_json, []),
    payeeIds: parse<string[]>(r.payee_ids_json, []),
    setterId: String(r.setter_id),
    signerId: r.signer_id ?? null,
    signedAt: iso(r.signed_at),
    conflicted: !!Number(r.conflicted),
    eeHeld: !!Number(r.ee_held),
    createdAt: iso(r.created_at) ?? "",
  };
}

/** Write one record. Returns its id. */
export async function writeSetting(
  db: Db,
  rec: SettingRecord,
  p: { workRef: string; state: SettingState; modelVersion: number; currency: string; inputs: WorkInputs; suggestion: PayeeSuggestion; payeeIds: string[]; setterId: string },
): Promise<string> {
  const id = randomUUID();
  await insertSettingRow(db, {
    id,
    workKind: rec.workKind,
    workRef: p.workRef,
    category: rec.category,
    state: p.state,
    modelVersion: p.modelVersion,
    currency: p.currency,
    suggestedMinor: rec.suggestedMinor,
    rangeLowMinor: rec.rangeLowMinor,
    rangeHighMinor: rec.rangeHighMinor,
    bandLowMinor: rec.bandLowMinor,
    bandHighMinor: rec.bandHighMinor,
    setMinor: rec.setMinor,
    gapMinor: rec.gapMinor,
    inside: rec.inside,
    needs: rec.needs,
    reason: rec.reason ? rec.reason.slice(0, 500) : null,
    note: rec.note ? rec.note.slice(0, 500) : null,
    ownNumberFirst: rec.ownNumberFirst,
    inputsJson: JSON.stringify(p.inputs),
    suggestionJson: JSON.stringify(p.suggestion),
    inputChangesJson: rec.inputChanges.length ? JSON.stringify(rec.inputChanges) : null,
    payeeIdsJson: JSON.stringify(p.payeeIds),
    setterId: p.setterId,
    conflicted: rec.conflicted,
    eeHeld: rec.eeHeld,
  });
  return id;
}

export async function settingById(db: Db, id: string): Promise<StoredSetting | null> {
  const row = await settingRowById(db, id);
  return row ? rowToSetting(row) : null;
}

export async function settingsForWork(db: Db, workKind: string, workRef: string): Promise<StoredSetting[]> {
  return (await settingRowsForWork(db, workKind, workRef)).map(rowToSetting);
}

/**
 * The members whose pay this setter set since a moment: they may not sign the
 * setter's figure (no swapping). The figure being signed is left out, since its
 * own payees are refused by the conflict rule already.
 */
export async function payeesSetBy(db: Db, setterId: string, since: Date, exceptSettingId?: string): Promise<string[]> {
  const out = new Set<string>();
  for (const r of await setterRowsSince(db, setterId, since)) {
    if (exceptSettingId && String(r.id) === exceptSettingId) continue;
    for (const id of parse<string[]>(r.payee_ids_json, [])) out.add(String(id));
  }
  return Array.from(out);
}

/** Records that set a figure in a category, shaped for `calibrate`. Members are compared by id. */
export async function calibrationRecords(db: Db, category: string, limit = 500): Promise<SettingRecord[]> {
  return (await setRowsInCategory(db, category, limit)).map((r) => {
    const s = rowToSetting(r);
    return {
      workKind: s.workKind,
      workId: 0,
      category: s.category,
      suggestedMinor: s.suggestedMinor,
      rangeLowMinor: s.rangeLowMinor,
      rangeHighMinor: s.rangeHighMinor,
      bandLowMinor: s.bandLowMinor,
      bandHighMinor: s.bandHighMinor,
      setMinor: s.setMinor,
      gapMinor: s.gapMinor,
      inside: s.inside,
      needs: s.needs,
      reason: s.reason,
      note: s.note,
      ownNumberFirst: s.ownNumberFirst,
      inputChanges: s.inputChanges,
      setterId: s.setterId,
      signerId: s.signerId ?? null,
      conflicted: s.conflicted,
      eeHeld: s.eeHeld,
      at: s.createdAt,
    };
  });
}

/** The second signer signs. True only when this call moved the row. */
export async function signSetting(db: Db, id: string, signerId: string): Promise<boolean> {
  const res = await signSettingRow(db, id, signerId);
  return res.affectedRows === 1;
}

/** Whether the village has written what Earned Equity is a share of (#892): the token's meaning, Admin, Tokens. */
export function earnedEquityMeaningWritten(): boolean {
  return !!String(tokenDef(EARNED_EQUITY)?.description ?? "").trim();
}
