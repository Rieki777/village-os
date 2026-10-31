/**
 * THE ROLE GUIDE'S FOUR CHECKS, worked out by the village from its own chart.
 *
 * Rye, 2026-10-24: the guide flags a domain that overlaps another role, a
 * circle accountability nobody covers, a load over a full season, and the
 * card's own limits. The guide is Sera (the outside governance service's
 * agent) or the village guide, whichever the member chose, and these come out
 * the same whoever answers, because the village computes them and the guide
 * only words the question. No guide can invent a flag, and none can miss one.
 *
 * OVERLAP IS A HINT, NEVER A RULING. Two lines "share meaning" here when they
 * share enough plain content words (`sharesMeaning`). That finds "the front
 * end and the app" against "how the app looks and plays" only when the words
 * meet, and it cannot see meaning the words hide. So a flag says "may
 * overlap" and names both lines, and the member decides. The load check and
 * the limits are exact: they reuse `loadCheck` and the card's own counts.
 *
 * Pure: no clock, no pool.
 */
import { loadCheck } from "./roleProposalLoad";
import { ACCOUNTABILITIES_MAX, ACCOUNTABILITIES_MIN } from "./roleCcos";

/** One role the member is proposing, with the words as they stand now. */
export interface GuideRoleIn {
  /** Where the role sits in the proposal: `roles.0` or `newRoles.1`. */
  key: string;
  name: string;
  circleId: string | null;
  /** The posted role this one renews, or null for a new role. */
  roleId: string | null;
  domain: string;
  accountabilities: readonly string[];
  time: string | null;
}

/** A role on the live chart, held by anyone. */
export interface ChartRoleIn {
  id: string;
  name: string;
  circleId: string | null;
  domain: string;
  accountabilities: readonly string[];
}

/** A circle and what its charter says it answers for. */
export interface CircleIn {
  id: string;
  name: string;
  accountabilities: readonly string[];
}

export type GuideFlag =
  | { kind: "overlap"; roleKey: string; otherRole: string; ours: string; theirs: string; sentence: string }
  | { kind: "uncovered"; circle: string; accountability: string; sentence: string }
  | { kind: "load"; hours: number; sentence: string }
  | { kind: "limit"; roleKey: string; field: "accountabilities"; sentence: string };

export const GUIDE_CHECK_WORDS = {
  overlap: (ours: string, other: string) =>
    `What ${ours} looks after may overlap with ${other}. Is that shared on purpose, or does one role hold it?`,
  uncovered: (circle: string, line: string) =>
    `${circle} answers for "${line}", and no role in it says it covers that yet. Does one of your roles hold it?`,
  tooFew: (name: string, n: number) =>
    `${name} answers for ${n} ${n === 1 ? "thing" : "things"}. A role card holds ${ACCOUNTABILITIES_MIN} to ${ACCOUNTABILITIES_MAX}.`,
  tooMany: (name: string, n: number) =>
    `${name} answers for ${n} things. A role card holds ${ACCOUNTABILITIES_MIN} to ${ACCOUNTABILITIES_MAX}, so pick the ones that matter most.`,
} as const;

const STOP: ReadonlySet<string> = new Set(
  (
    "the a an and or but if then than that this these those there here of to in on at by for with from as into over under about " +
    "is are was were be been being am do does did have has had can could will would may might must shall should " +
    "i we you he she it they me us them my our your their his its who whom whose which what when where why how " +
    "no not any all some more most much many very just also too so such own same other another each every both " +
    "make makes made get gets keep keeps hold holds holding look looks looking after sure role roles"
  ).split(" "),
);

/** The content words of a line, lowercased, plurals folded. PURE. */
export function contentWords(line: string): Set<string> {
  const out = new Set<string>();
  for (const raw of line.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

/**
 * Two lines share meaning when at least two content words meet and they make
 * up half of the shorter line, or when a line of one or two content words is
 * wholly inside the other. PURE.
 */
export function sharesMeaning(a: string, b: string): boolean {
  const x = contentWords(a);
  const y = contentWords(b);
  const shorter = Math.min(x.size, y.size);
  if (shorter === 0) return false;
  let shared = 0;
  for (const w of Array.from(x)) if (y.has(w)) shared++;
  if (shorter <= 2) return shared === shorter;
  return shared >= 2 && shared / shorter >= 0.5;
}

export interface GuideChecksIn {
  roles: readonly GuideRoleIn[];
  chart: readonly ChartRoleIn[];
  circles: readonly CircleIn[];
}

/** Every flag for a proposal, in a fixed order: limits, overlap, uncovered, load. PURE. */
export function guideChecks(input: GuideChecksIn): GuideFlag[] {
  const flags: GuideFlag[] = [];
  const renewed = new Set(input.roles.map((r) => r.roleId).filter((id): id is string => !!id));

  for (const r of input.roles) {
    const lines = r.accountabilities.map((s) => s.trim()).filter(Boolean);
    if (lines.length && lines.length < ACCOUNTABILITIES_MIN) {
      flags.push({ kind: "limit", roleKey: r.key, field: "accountabilities", sentence: GUIDE_CHECK_WORDS.tooFew(r.name, lines.length) });
    } else if (lines.length > ACCOUNTABILITIES_MAX) {
      flags.push({ kind: "limit", roleKey: r.key, field: "accountabilities", sentence: GUIDE_CHECK_WORDS.tooMany(r.name, lines.length) });
    }
  }

  for (const r of input.roles) {
    if (!r.domain.trim()) continue;
    for (const other of input.chart) {
      // A role never overlaps the posted role it renews, and one already in this proposal is judged as proposed.
      if (other.id === r.roleId || renewed.has(other.id) || !other.domain.trim()) continue;
      if (sharesMeaning(r.domain, other.domain)) {
        flags.push({
          kind: "overlap",
          roleKey: r.key,
          otherRole: other.name,
          ours: r.domain.trim(),
          theirs: other.domain.trim(),
          sentence: GUIDE_CHECK_WORDS.overlap(r.name, other.name),
        });
      }
    }
  }

  const circleIds = new Set(input.roles.map((r) => r.circleId).filter((id): id is string => !!id));
  for (const circle of input.circles) {
    if (!circleIds.has(circle.id)) continue;
    // The circle's roles as they would stand: the proposal's words replace the posted words of the roles it renews.
    const held = [
      ...input.chart.filter((c) => c.circleId === circle.id && !renewed.has(c.id)).flatMap((c) => c.accountabilities),
      ...input.roles.filter((r) => r.circleId === circle.id).flatMap((r) => r.accountabilities),
    ];
    for (const line of circle.accountabilities) {
      if (!line.trim()) continue;
      if (!held.some((h) => sharesMeaning(line, h))) {
        flags.push({ kind: "uncovered", circle: circle.name, accountability: line.trim(), sentence: GUIDE_CHECK_WORDS.uncovered(circle.name, line.trim()) });
      }
    }
  }

  const load = loadCheck(input.roles.map((r) => ({ name: r.name, time: r.time })));
  if (load.over) flags.push({ kind: "load", hours: load.hours, sentence: load.lines[0] });

  return flags;
}
