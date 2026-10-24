/**
 * A ROLE CARD, TO AND FROM A DRAFT: a stored body as a card, and the
 * member's choice of what a card fills (shared/roleCardText.ts, which also
 * writes the proposal payload directly, `docFromProposal`).
 *
 *   docFromBody      a stored draft body, with the roles as posted, to a card
 *   changesOf        every change a read card would make to the draft, one
 *                    line per word, each with the path that keeps it
 *   acceptOnly       the PUT body with only the changes the member kept
 *
 * Rye, 2026-10-24: "Keep only the fields the member accepts." The import
 * shows `changesOf` as a list with a box on each line; `acceptOnly` turns the
 * ticked boxes into the PUT, and anything left unticked stays as the draft
 * holds it. A change whose path a blocking problem names cannot be ticked
 * until the card is fixed and read again (`isBlocked`).
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { normalWord, type NewRole, type ProposalBody, type ProposalRole, type RoleWords, type SeasonWords, type WordFieldsContext, type WordValue } from "./roleProposals";
import type { LiveCircle } from "./proposedSeats";
import type { SeatSettings } from "./seatSettings";
import {
  fieldPath,
  ROLE_CARD_FIELDS,
  ROLE_CARD_WORD_FIELDS,
  type RoleCardBody,
  type RoleCardDoc,
  type RoleCardNewRole,
  type RoleCardProblem,
  type RoleCardRole,
  type RoleCardRoleIn,
  type RoleCardWordField,
  type RoleGroup,
} from "./roleCardText";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The card's heading for a word field, or the field's own name for one the card does not show. */
export function headingFor(field: string): string {
  return ROLE_CARD_FIELDS.find((f) => f.key === field)?.heading ?? field;
}

// ── To a card ───────────────────────────────────────────────────────────────

export interface DocContext {
  words: WordFieldsContext;
  roles: readonly RoleCardRoleIn[];
  circles: readonly LiveCircle[];
  village?: string | null;
}

const CARD_WORDS_ONLY = ROLE_CARD_WORD_FIELDS.filter((f) => f !== "name");

function wordsOf(posted: Record<string, unknown> | null, words: RoleWords, ctx: WordFieldsContext): RoleCardRole["words"] {
  const out: RoleCardRole["words"] = {};
  for (const f of CARD_WORDS_ONLY) {
    const list = ctx.lists.has(f);
    const v = has(words, f) ? normalWord(words[f], list) : posted ? normalWord(posted[f], list) : null;
    if (v !== null) out[f] = v;
  }
  return out;
}

const measuresOf = (settings: SeatSettings | undefined | null): string[] => (settings?.scoreboard?.measures ?? []).map((m) => m.measure).filter(Boolean);

/** A stored draft as a card: each role as the draft would leave it, posted words under proposed ones. PURE. */
export function docFromBody(body: ProposalBody, ctx: DocContext): RoleCardDoc {
  const circleName = (id: string | null) => {
    const c = id ? ctx.circles.find((x) => String(x.id) === id) : null;
    return c ? String(c.name ?? c.id) : null;
  };
  const roles: RoleCardRole[] = [];
  for (const r of body.roles) {
    const posted = ctx.roles.find((x) => x.id === r.roleId);
    const title = typeof r.words.name === "string" && r.words.name.trim() ? r.words.name : posted?.name ?? r.roleId;
    roles.push({ title, id: r.roleId, circle: circleName(posted?.circleId ?? null), words: wordsOf(posted?.posted ?? null, r.words, ctx.words) });
  }
  for (const r of body.newRoles) {
    roles.push({ title: typeof r.words.name === "string" ? r.words.name : "", id: r.id, circle: circleName(r.circleId), words: wordsOf(null, r.words, ctx.words) });
  }
  return { village: ctx.village ?? null, roles, measures: measuresOf(body.settings), season: body.season };
}

// ── What a card changes ─────────────────────────────────────────────────────

export interface RoleCardChange {
  /** The path a tick keeps: `roles.0.words.aim`, `newRoles.1` for a role the card adds, `season.aim`. */
  path: string;
  kind: "role" | "word" | "season" | "measures";
  /** The role it is on, by title, or null for the season and the measures. */
  roleTitle: string | null;
  /** The card's heading. */
  label: string;
  /** What the card says, as text. Null when it puts the posted words back. */
  value: string | null;
  /** For a role the card adds, every word it brings, by heading. */
  words?: Array<{ path: string; label: string; value: string }>;
}

const shown = (v: WordValue | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? v.map((x) => `- ${x}`).join("\n") : v;
};

const wordChanges = (group: RoleGroup, i: number, words: RoleWords): Array<{ path: string; label: string; value: string }> =>
  Object.keys(words)
    .filter((f) => shown(words[f]) !== null)
    .map((f) => ({ path: fieldPath.word(group, i, f as RoleCardWordField), label: headingFor(f), value: shown(words[f]) ?? "" }));

const titleOf = (words: RoleWords, fallback: string) => (typeof words.name === "string" && words.name.trim() ? words.name : fallback);

/**
 * EVERY CHANGE a read card would make to the draft, in the card's order.
 * PURE. `names` gives a posted role's title by id.
 */
export function changesOf(body: RoleCardBody, current: ProposalBody, names: (roleId: string) => string): RoleCardChange[] {
  const out: RoleCardChange[] = [];
  (body.roles ?? []).forEach((r, i) => {
    const draft = current.roles.find((x) => x.roleId === r.roleId);
    const roleTitle = titleOf(r.words, names(r.roleId));
    if (!draft) {
      out.push({ path: fieldPath.role("roles", i), kind: "role", roleTitle, label: roleTitle, value: null, words: wordChanges("roles", i, r.words) });
      return;
    }
    for (const f of Array.from(new Set([...Object.keys(r.words), ...Object.keys(draft.words)]))) {
      if (same(r.words[f], draft.words[f])) continue;
      out.push({ path: fieldPath.word("roles", i, f as RoleCardWordField), kind: "word", roleTitle, label: headingFor(f), value: has(r.words, f) ? shown(r.words[f]) : null });
    }
  });
  (body.newRoles ?? []).forEach((r, i) => {
    const draft = r.id ? current.newRoles.find((x) => x.id === r.id) : undefined;
    const roleTitle = titleOf(r.words, "");
    if (!draft) {
      out.push({ path: fieldPath.role("newRoles", i), kind: "role", roleTitle, label: roleTitle, value: null, words: wordChanges("newRoles", i, r.words) });
      return;
    }
    for (const f of Array.from(new Set([...Object.keys(r.words), ...Object.keys(draft.words)]))) {
      if (same(r.words[f], draft.words[f])) continue;
      out.push({ path: fieldPath.word("newRoles", i, f as RoleCardWordField), kind: "word", roleTitle, label: headingFor(f), value: has(r.words, f) ? shown(r.words[f]) : null });
    }
  });
  const measures = body.settings?.scoreboard?.measures;
  if (measures && !same(measures, current.settings?.scoreboard?.measures ?? [])) {
    out.push({ path: fieldPath.measures(), kind: "measures", roleTitle: null, label: headingFor("measures"), value: measures.map((m) => `- ${m.measure}`).join("\n") });
  }
  const s = body.season;
  if (s) {
    if (s.aim !== undefined && !same(s.aim, current.season.aim)) out.push({ path: fieldPath.season("aim"), kind: "season", roleTitle: null, label: headingFor("seasonAim"), value: s.aim });
    if (s.seasonalGoals !== undefined && !same(s.seasonalGoals, current.season.seasonalGoals)) {
      out.push({
        path: fieldPath.season("seasonalGoals"),
        kind: "season",
        roleTitle: null,
        label: headingFor("seasonalGoals"),
        value: s.seasonalGoals.map((g) => (g.doneWhen ? `- ${g.title}\n  Done when: ${g.doneWhen}` : `- ${g.title}`)).join("\n"),
      });
    }
    if (s.servesGoals !== undefined && !same(s.servesGoals, current.season.servesGoals)) {
      out.push({
        path: fieldPath.season("servesGoals"),
        kind: "season",
        roleTitle: null,
        label: headingFor("servesGoals"),
        value: s.servesGoals.map((g) => (g.howItHelps ? `- ${g.goal}\n  How it helps: ${g.howItHelps}` : `- ${g.goal}`)).join("\n"),
      });
    }
  }
  return out;
}

/** True when a blocking problem names this path or anything under it, and no pick has answered it. */
export function isBlocked(path: string, problems: readonly RoleCardProblem[], answered: ReadonlySet<string> = new Set()): boolean {
  return problems.some((p) => p.blocks && !answered.has(p.field) && (p.field === path || p.field.startsWith(`${path}.`) || (path === "newRoles" && p.field === "roles")));
}

/** The PUT body a page sends once the member has picked what to keep. */
export interface AcceptedBody {
  roles?: ProposalRole[];
  newRoles?: Array<Omit<NewRole, "id"> & { id?: string }>;
  settings?: SeatSettings;
  season?: SeasonWords;
}

/**
 * THE CHANGES THE MEMBER KEPT, as the PUT body. PURE.
 *
 * `accepted` holds the paths ticked; `circles` holds a circle the member
 * picked for a new role whose card named none it could match, by the new
 * role's path. Everything unticked stays exactly as `current` holds it.
 */
export function acceptOnly(body: RoleCardBody, accepted: ReadonlySet<string>, current: ProposalBody, circles: Readonly<Record<string, string>> = {}): AcceptedBody {
  const out: AcceptedBody = {};
  const keepWords = (group: RoleGroup, i: number, card: RoleWords, draft: RoleWords): RoleWords => {
    const words: RoleWords = { ...draft };
    for (const f of Array.from(new Set([...Object.keys(card), ...Object.keys(draft)]))) {
      if (!accepted.has(fieldPath.word(group, i, f as RoleCardWordField))) continue;
      if (has(card, f)) words[f] = card[f];
      else delete words[f];
    }
    return words;
  };
  if (body.roles) {
    const roles: ProposalRole[] = [];
    body.roles.forEach((r, i) => {
      const draft = current.roles.find((x) => x.roleId === r.roleId);
      if (draft) roles.push({ ...draft, words: keepWords("roles", i, r.words, draft.words) });
      else if (accepted.has(fieldPath.role("roles", i))) roles.push(r);
    });
    out.roles = roles;
  }
  if (body.newRoles) {
    const list: RoleCardNewRole[] = [];
    body.newRoles.forEach((r, i) => {
      const draft = r.id ? current.newRoles.find((x) => x.id === r.id) : undefined;
      if (draft) list.push({ ...draft, words: keepWords("newRoles", i, r.words, draft.words) });
      else if (accepted.has(fieldPath.role("newRoles", i))) list.push({ ...r, circleId: circles[fieldPath.role("newRoles", i)] || r.circleId });
    });
    out.newRoles = list;
  }
  if (body.settings && accepted.has(fieldPath.measures())) out.settings = body.settings;
  if (body.season) {
    const season: SeasonWords = { ...current.season };
    if (body.season.aim !== undefined && accepted.has(fieldPath.season("aim"))) season.aim = body.season.aim;
    if (body.season.seasonalGoals !== undefined && accepted.has(fieldPath.season("seasonalGoals"))) season.seasonalGoals = body.season.seasonalGoals;
    if (body.season.servesGoals !== undefined && accepted.has(fieldPath.season("servesGoals"))) season.servesGoals = body.season.servesGoals;
    if (!same(season, current.season)) out.season = season;
  }
  return out;
}
