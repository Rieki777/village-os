/**
 * A ROLE'S PAY IN AN ORG DRAFT (constitution 0.3, 0.4; Rye, 2026-11-06).
 *
 * The valuation engine sends a role's pay to the village, when no second
 * signer may sign it, as an org draft put to a vote. An org draft's role edit
 * (`update_seat`) could not carry pay, so that vote path changed nothing. This
 * file is the one place a draft's pay is read: the same `readWorkValueInput`
 * and `payLineProblem` the admin door and the Treasurer's door use, so a draft
 * cannot store what either would refuse, and the currency is stamped from the
 * village, never read from the payload.
 *
 * A machine's draft (Sera, a vendor) may not carry pay: a pay package lands
 * through a person's set step (II.14).
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { readConfigDocument } from "../repos/appConfigDocs";
import { defaultDisplayCurrency } from "../../shared/money";
import { readWorkValueInput, type TokenAmount } from "../../shared/workValue";
import { HEARTS, type MintRule } from "./economy";
import { payLineProblem, rolePayRules } from "./workPay";
import type { OrgRoleValueEdit } from "./orgChart";

/** The payload keys that carry a role's pay. */
export const DRAFT_PAY_KEYS = ["valueMinor", "valueTokens", "cashMinor"] as const;

export function carriesRolePay(p: Record<string, unknown> | null | undefined): boolean {
  return !!p && DRAFT_PAY_KEYS.some((k) => p[k] !== undefined);
}

export const MACHINE_PAY_REFUSED = "A role's pay in a draft is set by a person: a suggested package goes through the Treasurer's set step.";

/** Why a draft's pay cannot be stored, or null. Rules absent: Gratitude and the shape only, the rest at publish. */
export function draftPayProblem(p: Record<string, unknown> | null | undefined, rules: readonly MintRule[] | undefined, machine: boolean): string | null {
  if (!carriesRolePay(p)) return null;
  if (machine) return MACHINE_PAY_REFUSED;
  const read = readWorkValueInput(pick(p), (slug) => (rules ? payLineProblem(rules, slug) : slug === HEARTS ? payLineProblem([], slug) : null));
  return read.ok ? null : read.error;
}

const pick = (p: Record<string, unknown> | null | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_PAY_KEYS) if (p?.[k] !== undefined) out[k] = p[k];
  return out;
};

/** The pay a draft writes on publish, checked again against the village's rules, stamped in its currency. */
export async function draftPayEdit(conn: Pool | PoolConnection, p: Record<string, unknown>, machine: boolean): Promise<OrgRoleValueEdit | undefined> {
  if (!carriesRolePay(p)) return undefined;
  if (machine) throw new Error(MACHINE_PAY_REFUSED);
  const rules = await rolePayRules(conn);
  const read = readWorkValueInput(pick(p), (slug) => payLineProblem(rules, slug));
  if (!read.ok) throw new Error(read.error);
  const doc = await readConfigDocument<{ project?: { fiatCurrency?: string } }>(conn as Pool, "brand");
  const currency = defaultDisplayCurrency({ fiatCurrency: doc?.project?.fiatCurrency ?? "" });
  const out: OrgRoleValueEdit = {};
  if (read.valueMinor !== undefined) {
    out.valueMinor = read.valueMinor;
    out.valueCurrency = read.valueMinor === null ? null : currency;
  }
  if (read.tokens !== undefined) out.valueTokens = read.tokens as TokenAmount[] | null;
  if (read.cashMinor !== undefined) {
    out.cashMinor = read.cashMinor;
    out.cashCurrency = read.cashMinor === null ? null : currency;
  }
  return out;
}
