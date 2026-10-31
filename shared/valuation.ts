/**
 * THE VALUATION MODEL: how a figure for a piece of work is worked out, line by
 * line, so any member can follow it by hand (VALUATION_MODEL_SPEC.md).
 *
 * Rye, 2026-10-30: "we also need a valuation model built in that's showing how
 * and where we've come up with figures for roles, quests, etc". THE MODEL ONLY
 * SUGGESTS. Pay is still what a person sets (`value_minor`, `value_tokens`,
 * `cash_minor`, read by `quoteWorkPay`), and this file writes nothing.
 *
 * This first slice prices a ROLE FROM THE SOURCE'S MONTHLY FIGURE: the org
 * structure source holds one blended US-dollar figure a month for a role
 * (`SourcePay.monthlyUsd`, `shared/structurePlan.ts`), and the role is paid by
 * the moon. Rye, 2026-10-30: "roles are paying MUCH more than 25 Credits and 50
 * Voice each cycle this is broken and should be removed", and the source's own
 * figure takes its place.
 *
 * HOW THE VALUE IS PAID (Rye, 2026-10-31):
 *   "Voice is equal to total CRC/USD/etc value ... if the whole job pays 1000 in
 *   value then you get 1000 voice tokens." "Total Value is paid out between
 *   credits, earned equity, and cash ... as a minimum we'll give 10% of each
 *   credits and earned equity as a floor ... (these are all settings we should
 *   be able to tweak in our valuation model pages)."
 * So:
 *   - VOICE IS THE WHOLE VALUE, at the model's rate per currency unit (1), and
 *     it does not depend on the split.
 *   - THE VALUE IS SPLIT between Credits, Earned Equity and cash, each at 1 per
 *     currency unit, so the three always add up to the value. Cash rounds to
 *     whole currency units and the tokens to whole tokens.
 *   - THE FLOORS hold at least the model's share of Credits and of Earned Equity
 *     (10% each), which caps cash at what is left (80%).
 *   - No caps on the value itself (`WORK_PAY_TRIGGERS`).
 *
 * And the two defaults Rye said yes to on 2026-10-31: only a SETTLED figure may
 * be written (`sourcePayWrites`), and only the paid models split themselves
 * (`AUTO_SPLIT_MODELS`). Every other model shows the figure and a person sets
 * the split.
 *
 * EVERY LINE IS WORKED FROM THE FIGURES SHOWN, rounded to cents or whole
 * percents first, so a pencil reproduces each one. Rounding only at the end
 * lets the displayed lines disagree with the displayed result.
 *
 * Pure: no clock, no pool.
 */
import { formatMoney } from "./money";
import type { SourcePay } from "./structurePlan";
import type { TokenAmount } from "./workValue";

/** Days in a moon, as the role card counts them (`shared/roleProposalLoad.ts`). */
export const DAYS_A_MOON = 29.53;
/** Days in an average month (365.25 / 12, written as a person would follow it). */
export const DAYS_A_MONTH = 30.44;

/** How the value is shared out, in whole percents that add up to 100. */
export interface ValuationSplit {
  creditsPct: number;
  equityPct: number;
  cashPct: number;
}

/**
 * One version of a village's model. Each save is a new version and none is
 * ever edited (spec section 2). The rate bands, levels and benefit range join
 * this in the next slice.
 */
export interface ValuationModel {
  /** 0 is the platform default, before a village has saved a version of its own. */
  version: number;
  /** ISO code the model prices in. */
  currency: string;
  /** The tokens the value is paid in, by slug. Their live names are the card's to render. */
  tokens: { credits: string; equity: string; voice: string };
  /** Voice per currency unit of the whole value. */
  voicePerUnit: number;
  /** The split suggested when a person has set none. */
  defaultSplit: ValuationSplit;
  /** The least share of Credits and of Earned Equity any split may pay. Cash takes at most the rest. */
  floors: { creditsPct: number; equityPct: number };
}

/**
 * What a village prices with until it saves a version of its own: dollars,
 * 1 Voice per $1, Credits and Earned Equity half each with no cash until a
 * budget sets some, and the 10% floors Rye named. The slugs are the server's
 * `CREDITS`, `EARNED_EQUITY` and `VILLAGE_VOICE` (`server/lib/economy.ts`),
 * spelled out because shared code cannot import the server; a test holds them
 * equal.
 */
export const PLATFORM_DEFAULT_MODEL: ValuationModel = {
  version: 0,
  currency: "USD",
  tokens: { credits: "credits", equity: "earned-equity", voice: "village-voice" },
  voicePerUnit: 1,
  defaultSplit: { creditsPct: 50, equityPct: 50, cashPct: 0 },
  floors: { creditsPct: 10, equityPct: 10 },
};

/**
 * One line of the working, ready to read: what it is, how it was worked out,
 * and what it came to. A token line carries `token`, and the card renders that
 * token's live name in place of `label`, so a rename reaches the working too.
 */
export interface ValuationLine {
  key: string;
  label: string;
  working: string;
  result: string;
  token?: string;
}

/** A role's suggested pay for one moon, from the source's monthly figure. */
export interface RolePrice {
  modelVersion: number;
  currency: "USD";
  valueMinorPerMoon: number;
  /** The whole value as Voice. Set whoever splits the pay. */
  voice: TokenAmount;
  /** "model": the model suggests the split. "person": a person sets it. */
  splitBy: "model" | "person";
  /** The split used, after the floors. Null when a person sets it. */
  split: ValuationSplit | null;
  /** Null when no cash is suggested, and always when a person sets the split. */
  cashMinor: number | null;
  /** Credits and Earned Equity. Null when a person sets the split. A token that rounds to nothing is left out. */
  payTokens: TokenAmount[] | null;
  lines: ValuationLine[];
}

/**
 * The source's pay models that split themselves (Rye, 2026-10-31). Volunteer,
 * Reciprocity / In-Kind, Revenue Share, Equity / Ownership and any model not
 * named here show the figure, and a person sets the split.
 */
export const AUTO_SPLIT_MODELS: readonly string[] = ["Stipend", "Part-Time Salaried", "Full-Time Salaried", "Hybrid"];

const modelKey = (s: string): string => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const AUTO_SPLIT_KEYS = new Set(AUTO_SPLIT_MODELS.map(modelKey));

/** Whether the source's pay model splits itself. Case, spacing and dashes do not matter. */
export function autoSplits(model: string | null | undefined): boolean {
  return typeof model === "string" && AUTO_SPLIT_KEYS.has(modelKey(model));
}

/**
 * Whether the source's figure may be written to the role: only a settled one
 * (the source's "Active") with a figure. Pending and agreed-not-paying figures
 * are shown, never written (Rye, 2026-10-31).
 */
export function sourcePayWrites(sp: SourcePay | null | undefined): boolean {
  return !!sp && sp.standing === "settled" && sp.monthlyUsd !== null;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const floorsOf = (model: ValuationModel): { fc: number; fe: number } => {
  const fc = clamp(Math.round(model.floors.creditsPct), 0, 100);
  return { fc, fe: clamp(Math.round(model.floors.equityPct), 0, 100 - fc) };
};

/** The most of the value cash may take: whatever the Credits and Earned Equity floors leave (80% on the default). */
export function cashCapPct(model: ValuationModel): number {
  const { fc, fe } = floorsOf(model);
  return 100 - fc - fe;
}

/**
 * A requested split held to the model's floors, in whole percents adding to
 * 100. Cash is capped at what the floors leave. Credits and Earned Equity share
 * the rest in the ratio asked for (the model's default ratio when none is),
 * then each is lifted to its floor. Anything not asked for comes from the
 * model's default, so a budget that names only its cash keeps the default
 * ratio for the rest.
 */
export function holdSplit(model: ValuationModel, asked: Partial<ValuationSplit> = {}): ValuationSplit {
  const { fc, fe } = floorsOf(model);
  const cashCap = 100 - fc - fe;
  const cashPct = clamp(Math.round(finite(asked.cashPct) ? asked.cashPct : model.defaultSplit.cashPct), 0, cashCap);
  const rest = 100 - cashPct;
  let rc = Math.max(0, finite(asked.creditsPct) ? asked.creditsPct : model.defaultSplit.creditsPct);
  let re = Math.max(0, finite(asked.equityPct) ? asked.equityPct : model.defaultSplit.equityPct);
  if (!(rc + re > 0)) {
    rc = Math.max(0, model.defaultSplit.creditsPct);
    re = Math.max(0, model.defaultSplit.equityPct);
  }
  if (!(rc + re > 0)) rc = re = 1;
  const creditsPct = clamp(Math.round((rest * rc) / (rc + re)), fc, rest - fe);
  return { creditsPct, equityPct: rest - creditsPct, cashPct };
}

const usd = (minor: number): string => formatMoney(minor, "USD");
const versionWords = (v: number): string => (v === 0 ? "platform default (no village version yet)" : `village version ${v}`);
const sameSplit = (a: Partial<ValuationSplit>, b: ValuationSplit): boolean =>
  (!finite(a.creditsPct) || Math.round(a.creditsPct) === b.creditsPct) &&
  (!finite(a.equityPct) || Math.round(a.equityPct) === b.equityPct) &&
  (!finite(a.cashPct) || Math.round(a.cashPct) === b.cashPct);

/**
 * The tokens to store on the role for a price: Voice, plus Credits and Earned
 * Equity when the model split the pay. A person-set split stores only Voice.
 */
export function rolePriceTokens(p: RolePrice): TokenAmount[] {
  return [...(p.voice.amount > 0 ? [p.voice] : []), ...(p.payTokens ?? [])];
}

/**
 * A role's pay for one moon from the source's monthly figure, with every line
 * of the working. Null when the source sends no figure, or when the model does
 * not price in dollars (the figure is dollars, and nothing here converts it).
 *
 * It prices whatever the figure's standing, so a pending figure can be shown;
 * whether it may be WRITTEN is `sourcePayWrites`.
 *
 * `opts.split` is the split a person or a budget asks for; anything it leaves
 * out comes from the model's default, and the floors always hold.
 * `opts.cashMinorPerMoon` is cash a person or a budget already set on the role:
 * it is kept (up to the floors' cap) and Credits and Earned Equity share the rest.
 */
export function priceRoleFromMonthly(
  model: ValuationModel,
  sourcePay: SourcePay | null,
  opts: { split?: Partial<ValuationSplit>; cashMinorPerMoon?: number } = {},
): RolePrice | null {
  if (!sourcePay || sourcePay.monthlyUsd === null) return null;
  if (model.currency.trim().toUpperCase() !== "USD") return null;

  const monthlyMinor = Math.round(sourcePay.monthlyUsd * 100);
  const valueMinor = Math.round((monthlyMinor * DAYS_A_MOON) / DAYS_A_MONTH);
  const voice = { token: model.tokens.voice, amount: Math.round((valueMinor / 100) * model.voicePerUnit) };
  const sourceWords = [sourcePay.model, sourcePay.statusLabel].filter(Boolean).join(", ") || "no model or status sent";

  const lines: ValuationLine[] = [
    { key: "model", label: "Model", working: versionWords(model.version), result: `v${model.version}` },
    { key: "source", label: "Monthly figure from the source", working: sourceWords, result: `${usd(monthlyMinor)} a month` },
    {
      key: "moon",
      label: "Value per moon",
      working: `${usd(monthlyMinor)} × ${DAYS_A_MOON} days ÷ ${DAYS_A_MONTH} days`,
      result: usd(valueMinor),
    },
    {
      key: `token:${voice.token}`,
      label: voice.token,
      token: voice.token,
      working: `${usd(valueMinor)} of value × ${model.voicePerUnit} per $1`,
      result: String(voice.amount),
    },
  ];
  const base = { modelVersion: model.version, currency: "USD" as const, valueMinorPerMoon: valueMinor, voice };

  if (!autoSplits(sourcePay.model)) {
    lines.push({
      key: "split",
      label: "How it is paid",
      working: `${sourcePay.model ?? "A role with no pay model"} is not split by the model`,
      result: "set by a person",
    });
    return { ...base, splitBy: "person", split: null, cashMinor: null, payTokens: null, lines };
  }

  // THE FLOORS ARE WHOLE TOKENS: at least the floor's share of the value,
  // rounded UP, in Credits and in Earned Equity. Cash is rounded DOWN to whole
  // dollars and never takes what those minimums need, so rounding can never
  // carry a payout under a floor.
  const { fc, fe } = floorsOf(model);
  const units = valueMinor / 100;
  let minCredits = Math.ceil((units * fc) / 100 - 1e-9);
  let minEquity = Math.ceil((units * fe) / 100 - 1e-9);
  const roomMinor = Math.max(0, Math.floor(units - minCredits - minEquity)) * 100;

  // Cash first: an amount already set on the role (kept, up to the floors' cap),
  // or the split's share of the value.
  const fixed = finite(opts.cashMinorPerMoon) && opts.cashMinorPerMoon > 0 ? Math.round(opts.cashMinorPerMoon) : null;
  let split: ValuationSplit;
  let cashMinor: number;
  let cashWorking: string;
  let held: boolean;
  if (fixed !== null) {
    const capMinor = Math.min(Math.floor((valueMinor * cashCapPct(model)) / 100 / 100) * 100, roomMinor);
    cashMinor = Math.min(fixed, capMinor);
    split = holdSplit(model, { ...opts.split, cashPct: valueMinor > 0 ? (cashMinor / valueMinor) * 100 : 0 });
    cashWorking =
      cashMinor === fixed
        ? "already set on the role, kept as it is"
        : `set at ${usd(fixed)}, held to ${usd(cashMinor)} by the floors`;
    held = cashMinor !== fixed || !sameSplit({ creditsPct: opts.split?.creditsPct, equityPct: opts.split?.equityPct }, split);
  } else {
    split = holdSplit(model, opts.split);
    cashMinor = Math.min(Math.floor((valueMinor * split.cashPct) / 100 / 100) * 100, roomMinor);
    cashWorking = `${split.cashPct}% of ${usd(valueMinor)}, rounded down to whole dollars`;
    held = !sameSplit(opts.split ?? {}, split);
  }
  const fromModel = !opts.split && fixed === null;

  lines.push({
    key: "split",
    label: "Split",
    working:
      `Credits ${split.creditsPct}%, Earned Equity ${split.equityPct}%, cash ${split.cashPct}%` +
      (fromModel
        ? " (the model's default)"
        : held
          ? ` (held to the floors: at least ${model.floors.creditsPct}% Credits and ${model.floors.equityPct}% Earned Equity)`
          : ""),
    result: "100%",
  });
  lines.push({ key: "cash", label: "Cash", working: cashWorking, result: usd(cashMinor) });

  // The tokens take what cash leaves, so the three always add up to the value.
  // Below about $2 there are too few whole tokens for both floors, and they
  // share what there is in the floors' ratio.
  const tokenUnits = Math.max(0, Math.round((valueMinor - cashMinor) / 100));
  if (minCredits + minEquity > tokenUnits) {
    minCredits = Math.round((tokenUnits * fc) / (fc + fe || 1));
    minEquity = tokenUnits - minCredits;
  }
  const asked = Math.round((units * split.creditsPct) / 100);
  const credits = clamp(asked, minCredits, tokenUnits - minEquity);
  const equity = tokenUnits - credits;
  lines.push({
    key: `token:${model.tokens.credits}`,
    label: model.tokens.credits,
    token: model.tokens.credits,
    working: `${split.creditsPct}% of ${usd(valueMinor)}${credits === asked ? "" : `, lifted to the floor of ${fc}% rounded up`}`,
    result: String(credits),
  });
  lines.push({
    key: `token:${model.tokens.equity}`,
    label: model.tokens.equity,
    token: model.tokens.equity,
    working: `${usd(valueMinor)} − ${usd(cashMinor)} cash − ${credits} Credits, to whole units`,
    result: String(equity),
  });

  const payTokens: TokenAmount[] = [];
  if (credits > 0) payTokens.push({ token: model.tokens.credits, amount: credits });
  if (equity > 0) payTokens.push({ token: model.tokens.equity, amount: equity });
  return { ...base, splitBy: "model", split, cashMinor: cashMinor > 0 ? cashMinor : null, payTokens, lines };
}
