/**
 * CHANGE REQUESTS: THE PURE RULES (Rye, 2026-11-06; spec
 * village-os-ops/internal/spec/change-requests/).
 *
 * A change request gathers several changes to the village's settings, says
 * why once, goes through a review round, and goes to ONE vote priced at its
 * hardest change, applied whole or not at all. This file holds what both the
 * server and the page need to agree on: which setting a change touches, the
 * limits on its words, and how a change joins, replaces or leaves the list.
 */
import { brandChangeKey } from "./brandVote";
import { mintRuleCreateKey } from "./mintRuleKeys";
import { VARIABLES_BY_KEY } from "./gameVariables";
import { MODULES_BY_ID } from "./modules";

export const CHANGE_REQUEST_TITLE_MAX = 120;
export const CHANGE_REQUEST_WHY_MAX = 4000;

export { GATHERING_LIMIT_DEFAULT, GATHERING_LIMIT_KEY } from "./changeRequestLimits";

/** One change, as a change set already spells it: a typed item or an untyped `{ key, to }` dial. */
export type ChangeLike = { kind?: string; [field: string]: unknown };

/**
 * The setting a change touches, in the keys the rest of the app already uses,
 * so two changes to one setting are one string compare and a conflict across
 * change requests is one indexed lookup.
 */
export function changeKeyOf(change: ChangeLike): string {
  const c = change as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "").trim();
  switch (c.kind) {
    case "module_lifecycle":
      return `module:${s(c.moduleId)}`;
    case "brand_field":
      return brandChangeKey(s(c.field));
    case "mode_switch":
      return "governance.weight_mode";
    case "weight_allocation":
      return `weight:${s(c.userId)}`;
    case "mint_rule_create":
      return mintRuleCreateKey(s(c.trigger), s(c.tokenSlug));
    case "role":
      return `role:${s(c.role)}`;
    default:
      // A dial, a minting-rule field, or the untyped `{ key, to }` pair.
      return s(c.key);
  }
}

const BRAND_SECTION_WORDS: Record<string, string> = {
  project: "Village words",
  currency: "Currency",
  images: "Images",
  theme: "Look",
  identityPack: "Identity",
};

/** "shortName" -> "short name". */
const words = (camel: string) => camel.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * The name a member reads for the setting a change touches: a dial's own
 * label, a module's name, or a brand field's section and field in words.
 * Never a raw key, unless nothing else is known.
 */
export function changeLabel(key: string): string {
  const def = VARIABLES_BY_KEY[key];
  if (def) return def.label;
  if (key.startsWith("module:")) {
    const mod = MODULES_BY_ID[key.slice("module:".length)];
    return mod ? `${mod.name} (on or off)` : key;
  }
  if (key.startsWith("brand:")) {
    const [section, field] = key.slice("brand:".length).split(".");
    return field ? `${BRAND_SECTION_WORDS[section] ?? words(section)}: ${words(field)}` : key;
  }
  if (key === "governance.weight_mode") return "How votes are weighed";
  return key;
}

/** Why a title and a why cannot stand, or null. */
export function changeRequestTextProblem(input: { title: unknown; why: unknown }): string | null {
  const title = String(input.title ?? "").trim();
  const why = String(input.why ?? "").trim();
  if (!title) return "Give the change request a title.";
  if (title.length > CHANGE_REQUEST_TITLE_MAX) return `A title is at most ${CHANGE_REQUEST_TITLE_MAX} characters.`;
  if (!why) return "Say why. The village weighs reasons, and the why travels with every change in it.";
  if (why.length > CHANGE_REQUEST_WHY_MAX) return `The why is at most ${CHANGE_REQUEST_WHY_MAX} characters.`;
  return null;
}

export type ListResult<T> = { ok: true; items: T[] } | { ok: false; problem: string };

function clash(items: readonly ChangeLike[], change: ChangeLike, except: number): string | null {
  const key = changeKeyOf(change);
  const other = items.findIndex((it, i) => i !== except && changeKeyOf(it) === key);
  return other >= 0 ? `This change request already changes that setting (change ${other + 1}). Edit that change instead.` : null;
}

export function withChangeAdded(items: readonly ChangeLike[], change: ChangeLike): ListResult<ChangeLike> {
  const problem = clash(items, change, -1);
  return problem ? { ok: false, problem } : { ok: true, items: [...items, change] };
}

export function withChangeReplaced(items: readonly ChangeLike[], position: number, change: ChangeLike): ListResult<ChangeLike> {
  if (!Number.isInteger(position) || position < 0 || position >= items.length) return { ok: false, problem: "There is no change at that place." };
  const problem = clash(items, change, position);
  if (problem) return { ok: false, problem };
  const next = [...items];
  next[position] = change;
  return { ok: true, items: next };
}

export function withChangeRemoved(items: readonly ChangeLike[], position: number): ListResult<ChangeLike> {
  if (!Number.isInteger(position) || position < 0 || position >= items.length) return { ok: false, problem: "There is no change at that place." };
  return { ok: true, items: items.filter((_, i) => i !== position) };
}
