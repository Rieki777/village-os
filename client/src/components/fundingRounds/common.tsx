/**
 * Funding rounds page, the shared pieces: the shapes the server sends, the
 * stage words, amounts in a pot's unit, and the form styles. Imported only by
 * the page and its parts, so it stays inside the page's lazy chunk
 * (docs/ARCHITECTURE.md section 3.19, rule 1).
 */
import { useLingui } from "@lingui/react/macro";
import type { RoundStage } from "@shared/fundingRounds";

export interface Pot {
  id: string;
  name: string;
  purpose: string | null;
  unitKind: "currency" | "token";
  unit: string;
  balanceMinor: number;
  freeMinor: number;
}

export interface Round {
  id: string;
  potId: string;
  title: string;
  stage: RoundStage;
  acceptsIdeas: boolean;
  stageEndsAt: string | null;
  ideasPerMember: number;
  anonymousOffered: boolean;
  ideaCount: number;
}

export interface Idea {
  id: string;
  title: string;
  what: string;
  whoHelps: string | null;
  roughCostMinor: number | null;
  whoMight: string | null;
  status: string;
  deliverable: string | null;
  askMinor: number | null;
  sharedImpact: boolean;
  byline: { kind: "named" | "anonymous"; text: string };
  mine: boolean;
  threadId: string | null;
  questId: string | null;
  /** First names of those who ticked it; sent only once choosing has closed. */
  markedBy?: string[];
  backing?: {
    pledgedMinor: number;
    backers: number;
    firmMinor: number;
    withdrawnMinor: number;
    mine: { id: string; amountMinor: number; status: string } | null;
    pledges: Array<{ id: string; name: string; amountMinor: number; status: string }>;
  };
}

export interface CountView {
  funded: string[];
  steps: Array<{ order: number; option: string; cost: number; backers: number }>;
  spentMinor: number;
  leftoverMinor: number;
}

export interface Outcome {
  decider: "power" | "people";
  quorumMet: boolean;
  quorumPct: number;
  markers: number;
  electorate: number;
  availableMinor: number;
  power: CountView;
  people: CountView;
  divergence: Array<{ ideaId: string; fundedBy: "power" | "people"; costMinor: number }>;
  /** Absent on a round counted before backing existed. */
  backerFunded?: string[];
}

export interface Detail {
  round: Round;
  pot: Pot;
  ideas: Idea[];
  ballot: Idea[];
  myMarks: string[];
  outcome: Outcome | null;
}

/**
 * The stage words, as a hook. The Lingui macro only transforms a `t` taken
 * from `useLingui()` in the same scope; a `t` passed in as an argument is left
 * as a plain call and renders nothing (found on this page, 2026-11-08).
 */
export function useStageText() {
  const { t } = useLingui();
  const word = (stage: RoundStage): string => {
    const words: Record<RoundStage, string> = {
      seed: t({ message: "Seed", context: "funding round stage" }),
      grow: t({ message: "Grow", context: "funding round stage" }),
      choose: t({ message: "Choose", context: "funding round stage" }),
      harvest: t({ message: "Harvest", context: "funding round stage" }),
      closed: t({ message: "Closed", context: "funding round stage" }),
    };
    return words[stage];
  };
  const line = (stage: RoundStage, endsAt: string | null): string => {
    const day = endsAt ? new Date(endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : null;
    const lines: Record<RoundStage, string> = {
      seed: day ? t({ message: `Ideas welcome until ${day}`, context: "funding round stage" }) : t({ message: `Ideas welcome until the pot's holder sets the next stage`, context: "funding round stage" }),
      grow: day ? t({ message: `Ideas are being shaped into quests until ${day}`, context: "funding round stage" }) : t({ message: `Ideas are being shaped into quests`, context: "funding round stage" }),
      choose: day ? t({ message: `Choosing which quests to fund until ${day}`, context: "funding round stage" }) : t({ message: `Choosing which quests to fund`, context: "funding round stage" }),
      harvest: t({ message: `The village has chosen`, context: "funding round stage" }),
      closed: t({ message: `This round is closed`, context: "funding round stage" }),
    };
    return lines[stage];
  };
  return { word, line };
}

/** How many minor units one whole unit holds, for a currency; a token counts whole. */
export function minorDigits(unitKind: Pot["unitKind"], unit: string): number {
  if (unitKind !== "currency") return 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: unit }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function amount(minor: number, pot: Pick<Pot, "unitKind" | "unit">): string {
  const digits = minorDigits(pot.unitKind, pot.unit);
  if (pot.unitKind === "currency") {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: pot.unit, maximumFractionDigits: 0 }).format(minor / 10 ** digits);
    } catch {
      /* falls through to the plain form */
    }
  }
  return `${minor.toLocaleString()} ${pot.unit}`;
}

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** A server refusal a member can act on is a sentence; a code is not shown. */
export const sentenceOf = (body: any): string | null => (typeof body?.error === "string" && /\s/.test(body.error) ? body.error : null);

export const FIELD = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground";
export const LABEL = "block text-sm font-medium text-foreground";

/** Whole units typed by a person, as minor units; null when empty, NaN when unreadable. */
export function toMinor(typed: string, pot: Pot): number | null {
  if (typed.trim() === "") return null;
  const whole = Number(typed.replace(/[\s,]/g, ""));
  return Number.isFinite(whole) && whole >= 0 ? Math.round(whole * 10 ** minorDigits(pot.unitKind, pot.unit)) : Number.NaN;
}
