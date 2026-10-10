/**
 * TERMS ON OFFER AND THE VILLAGE'S OWN PRESETS (seat settings PR3).
 *
 * Two pieces of village data sit on top of the settings model
 * (shared/seatSettings.ts) and the platform's shapes (shared/seatPresets.ts):
 *
 *   TERMS ON OFFER   what a seat offers whoever holds it, stored beside the
 *                    seat in `org_roles.terms_offer` (0239), written only by a
 *                    published org draft a human wrote, and projected only to
 *                    a reader holding `terms.read`.
 *   VILLAGE PRESETS  the village's own preset rows, amounts included, in the
 *                    `seat-presets` app_config document. Retired, never
 *                    deleted. A platform preset carries a shape; a village
 *                    preset may carry the village's own figures, because those
 *                    figures are the village's economics and nobody else's.
 *
 * Both are read by the server and the client through the functions here, so
 * the sentence a founder reads in the editor is the sentence the route refuses
 * with. Nothing here fetches, writes or moves value: money stays a record.
 */
import { canonicalJson } from "./canonicalJson";
import { presetById, type SeatPreset } from "./seatPresets";
import {
  GROUP_LABELS,
  SETTINGS_GROUPS,
  looksLikePaymentDetails,
  parseSeatSettings,
  PAYMENT_DETAIL_MESSAGE,
  type SeatSettings,
  type SettingsGroup,
} from "./seatSettings";

/** The app_config key the village's own presets live under. */
export const SEAT_PRESETS_DOC = "seat-presets";

/** The words the hosts and the editor say around an offer. */
export const OFFER_WORDS = {
  none: "No terms on offer yet.",
  propose: "Propose terms",
  changed: "changed",
  machineRefused:
    "Terms on offer are written by a member of this village. A proposal from an outside service never carries them",
} as const;

/** Where "Propose terms" goes: the seat application wizard, with the seat picked. */
export function proposeTermsHref(seatId: string): string {
  return `/propose?type=role_application&seat=${encodeURIComponent(seatId)}`;
}

// ── Terms on offer ──────────────────────────────────────────────────────────

/**
 * Read a stored or proposed offer.
 *
 * `null` (and absent) is "no terms on offer", which is a real answer and
 * different from an empty set of terms. Anything else goes through the one
 * parser, and a refusal is said in the parser's own first sentence.
 */
export function readTermsOffer(
  raw: unknown,
): { ok: true; settings: SeatSettings | null } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, settings: null };
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, problem: "These terms could not be read." };
    }
  }
  const parsed = parseSeatSettings(value);
  if (!parsed.ok || !parsed.settings) {
    return { ok: false, problem: parsed.problems[0]?.message ?? "These terms could not be read." };
  }
  return { ok: true, settings: parsed.settings };
}

/** The groups whose values differ between two offers, in season-card order. */
export function changedGroups(
  before: SeatSettings | null | undefined,
  after: SeatSettings | null | undefined,
): SettingsGroup[] {
  return SETTINGS_GROUPS.filter(
    (g) => canonicalJson(before?.[g] ?? null) !== canonicalJson(after?.[g] ?? null),
  );
}

// ── Village presets ─────────────────────────────────────────────────────────

/** One stored row, exactly as the document holds it. */
export interface VillagePresetRow {
  id: string;
  group: SettingsGroup;
  label: string;
  blurb?: string;
  version: number;
  values: unknown;
  retiredAt?: string | null;
}

export interface SeatPresetsDoc {
  presets: VillagePresetRow[];
}

const CUSTOM_ID = /^custom:[a-z0-9][a-z0-9-]{0,59}$/;
const LABEL_MAX = 60;
const BLURB_MAX = 200;

/** One row's own problems. The values are judged by the settings parser, as one group. */
function rowProblems(row: unknown): string[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["A preset is a set of named fields."];
  const r = row as Record<string, unknown>;
  const out: string[] = [];
  const id = typeof r.id === "string" ? r.id : "";
  const where = id || "A preset";
  if (!CUSTOM_ID.test(id)) out.push(`${where}: a village preset's id is custom: then lowercase letters, digits and dashes.`);
  const group = r.group as SettingsGroup;
  if (!SETTINGS_GROUPS.includes(group)) {
    out.push(`${where}: the group is one of ${SETTINGS_GROUPS.join(", ")}.`);
    return out;
  }
  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (!label || label.length > LABEL_MAX) out.push(`${where}: a label between 1 and ${LABEL_MAX} characters.`);
  if (r.blurb !== undefined && r.blurb !== null && (typeof r.blurb !== "string" || r.blurb.length > BLURB_MAX)) {
    out.push(`${where}: a blurb is at most ${BLURB_MAX} characters.`);
  }
  for (const text of [r.label, r.blurb]) {
    if (typeof text === "string" && looksLikePaymentDetails(text)) out.push(`${where}: ${PAYMENT_DETAIL_MESSAGE}`);
  }
  if (!Number.isInteger(r.version) || (r.version as number) < 1) out.push(`${where}: a version is a whole number from 1.`);
  if (r.retiredAt !== undefined && r.retiredAt !== null && (typeof r.retiredAt !== "string" || !r.retiredAt.trim())) {
    out.push(`${where}: retiredAt is a date or null.`);
  }
  if (r.values === undefined || r.values === null) {
    out.push(`${where}: a preset carries values for its group.`);
  } else {
    const parsed = parseSeatSettings({ [group]: r.values });
    for (const p of parsed.problems) out.push(`${where} (${GROUP_LABELS[group]}): ${p.message}`);
  }
  return out;
}

/**
 * A preset document rebuilt from the fields a row is known to carry (red team
 * S7). Call it only on a document `seatPresetsDocProblems` passed: anything
 * else a request sent, an unknown key on a row, is not
 * stored, so a field no check reads can never carry payment details in.
 * The values themselves are what the settings parser passed, unknown keys
 * inside them refused there.
 */
export function cleanSeatPresetsDoc(doc: SeatPresetsDoc): SeatPresetsDoc {
  return {
    presets: doc.presets.map((r) => {
      const row: VillagePresetRow = {
        id: r.id,
        group: r.group,
        label: String(r.label).trim(),
        version: r.version,
        // The settings parser already refused any key a group does not know.
        values: r.values,
        retiredAt: typeof r.retiredAt === "string" ? r.retiredAt : null,
      };
      if (typeof r.blurb === "string") row.blurb = r.blurb;
      return row;
    }),
  };
}

/**
 * The village's presets as the picker and the drawer read them.
 *
 * Tolerant on purpose: a row that no longer reads is left out rather than
 * taking the whole library down, because a stored document outlives the
 * release that wrote it. Retired rows stay in the list, flagged, so a drawer
 * can still name the preset an old offer started from; `presetsFor` is what
 * hides them from the picker.
 */
export function villagePresetsFrom(doc: unknown): SeatPreset[] {
  const rows = (doc as SeatPresetsDoc | null)?.presets;
  if (!Array.isArray(rows)) return [];
  const out: SeatPreset[] = [];
  for (const row of rows) {
    if (rowProblems(row).length > 0) continue;
    const r = row as VillagePresetRow;
    const parsed = parseSeatSettings({ [r.group]: r.values });
    const values = parsed.settings?.[r.group];
    if (!values) continue;
    out.push({
      id: r.id,
      group: r.group,
      label: r.label.trim(),
      blurb: typeof r.blurb === "string" ? r.blurb : "",
      version: r.version,
      values: values as never,
      retiredAt: r.retiredAt ?? null,
    });
  }
  return out;
}

/**
 * Judge a whole new document against the one stored, for the founding write.
 *
 * RETIRED, NEVER DELETED. Every id the stored document holds must still be
 * there, because an offer or an application may name it as the preset it
 * started from, and a drawer that cannot find it cannot say so. A preset
 * whose values changed must carry a higher version, so provenance pinned to
 * the old version still means the old values.
 */
export function seatPresetsDocProblems(next: unknown, stored: unknown): string[] {
  const rows = (next as SeatPresetsDoc | null)?.presets;
  if (!next || typeof next !== "object" || !Array.isArray(rows)) return ["Send { presets: [...] }."];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    out.push(...rowProblems(row));
    const id = (row as VillagePresetRow)?.id;
    if (typeof id === "string") {
      if (seen.has(id)) out.push(`${id}: each id appears once.`);
      seen.add(id);
      if (presetById(id) && !id.startsWith("custom:")) out.push(`${id}: that id is the platform's.`);
    }
  }
  const before = Array.isArray((stored as SeatPresetsDoc | null)?.presets) ? (stored as SeatPresetsDoc).presets : [];
  for (const old of before) {
    const now = rows.find((r) => (r as VillagePresetRow)?.id === old?.id) as VillagePresetRow | undefined;
    if (!now) {
      out.push(`${old?.id}: a preset is retired, never deleted. Set retiredAt instead.`);
      continue;
    }
    const valuesMoved = canonicalJson(now.values ?? null) !== canonicalJson(old.values ?? null);
    if (valuesMoved && !(Number(now.version) > Number(old.version))) {
      out.push(`${old.id}: its values changed, so its version goes up from ${old.version}.`);
    }
    if (now.group !== old.group) out.push(`${old.id}: a preset keeps its group.`);
  }
  return out;
}
