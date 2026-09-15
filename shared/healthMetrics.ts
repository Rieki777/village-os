/**
 * THE health-metric registry (S49): every number the village tracks about
 * itself, as data, shared by server and client.
 *
 * Two families:
 *   snapshot — computed ONCE when a lunar cycle closes and frozen forever
 *              (point-in-time facts are unrecoverable retroactively — F13).
 *   regen    — the land's ledger, hand-recorded by stewards: trees planted,
 *              water protected. ABSOLUTE COUNTS, never percentiles or ranks
 *              (a rank over a village-sized population is noise with a
 *              scoreboard attached), and never a per-person leaderboard.
 */

export type HealthMetricKind = "snapshot" | "regen";

export interface HealthMetricDef {
  key: string;
  kind: HealthMetricKind;
  label: string;
  unit: string;
  description: string;
  /**
   * Doughnut placement (S71). A foundation wedge measures the SHARE of the
   * village a lunation reached: `shareOf: "members_total"` divides the
   * latest snapshot value by the member count; `shareOf: "percent"` reads
   * the value as a percentage already. `floor` is the fraction beneath
   * which the wedge shows shortfall, in the doughnut's own language: the
   * red points at what the village agreed matters, never at a person.
   * Defaults live HERE so a fresh village needs no configuration; a
   * village that disagrees overrides per key in the health module's
   * config JSON (`doughnutFloors`). Absent = the metric stays off the ring.
   */
  doughnut?: {
    ring: "foundation";
    shareOf: "members_total" | "percent";
    floor: number;
  };
}

export const HEALTH_METRICS: HealthMetricDef[] = [
  // ── Snapshots: frozen at each cycle close ──────────────────────────────────
  {
    key: "members_total",
    kind: "snapshot",
    label: "Members",
    unit: "people",
    description: "Accounts at close (tombstones excluded).",
  },
  {
    key: "members_active_cycle",
    kind: "snapshot",
    label: "Active this cycle",
    unit: "people",
    description: "Distinct members who did anything the village heard about during the lunation.",
    doughnut: { ring: "foundation", shareOf: "members_total", floor: 0.35 },
  },
  {
    key: "events_total_cycle",
    kind: "snapshot",
    label: "Village events",
    unit: "events",
    description: "Everything the event spine recorded during the lunation; the per-kind split rides in meta.",
  },
  {
    key: "gratitude_senders_distinct",
    kind: "snapshot",
    label: "Members who gave recognition",
    unit: "people",
    description: "Distinct ELIGIBLE senders this cycle. The Sybil rule (stage >= member or >= 1 consented quest) is consumed from settlement, never re-implemented.",
    doughnut: { ring: "foundation", shareOf: "members_total", floor: 0.25 },
  },
  {
    key: "gratitude_recipients_distinct",
    kind: "snapshot",
    label: "Members who were recognized",
    unit: "people",
    description: "Distinct recipients of recognition this cycle.",
    doughnut: { ring: "foundation", shareOf: "members_total", floor: 0.25 },
  },

  // ── R9 (2026-09-03): the allowance a village left unused ──────────────────
  // Three figures, one sentence. An allowance is COMPUTED and never stored
  // (`allowanceFor`, server/lib/economy.ts), so what a member could have given
  // is only knowable while they still hold the stage they held that lunation.
  // Recomputing this later reads the stage somebody holds TODAY, which shows
  // every member who has climbed a rung a number that was never true, and
  // shows it to them as a reproach. So it is frozen at close like every other
  // snapshot, and it is a VILLAGE figure: `health_snapshots` holds one value
  // per (cycle, metric) and no per-member row belongs in it.
  {
    key: "gratitude_allowance_total",
    kind: "snapshot",
    label: "Recognition the village could give",
    unit: "tokens",
    description:
      "Summed over every member the roster counted at close: the base sending allowance times the stage multiplier that member held at that moment. Figures are in the recognition token, in its minor units, which is whole Gratitude at the shipped 0 decimals. Computed when the cycle closed and never recomputed.",
  },
  {
    key: "gratitude_allowance_given",
    kind: "snapshot",
    label: "Recognition the village gave",
    unit: "tokens",
    description:
      "What was actually given against that allowance this lunation: the acknowledgments and hearts the counted roster sent inside the cycle window, less the reversals of them inside the same window. This is the arithmetic that charges one member's allowance, summed over the village. Same token and units as the total, computed at close and never recomputed.",
  },
  {
    key: "gratitude_allowance_unspent",
    kind: "snapshot",
    label: "Recognition allowance unspent",
    unit: "tokens",
    description:
      "The total less what was given, floored at zero. Unspent allowance does not carry over, so this is what the village let go this lunation. Same token and units as the total, computed at close and never recomputed. A village figure, with no per-member breakdown anywhere.",
  },
  {
    key: "quests_consented_cycle",
    kind: "snapshot",
    label: "Quests consented",
    unit: "quests",
    description: "Work shown and consented to during the lunation.",
    doughnut: { ring: "foundation", shareOf: "members_total", floor: 0.1 },
  },
  {
    key: "decisions_opened_cycle",
    kind: "snapshot",
    label: "Decisions opened",
    unit: "decisions",
    description: "Governance threads opened during the lunation; distinct authors ride in meta (authorship concentration is the F13 read).",
  },

  // ── H3 (Wave 1): the reserved keys, claimable at last ─────────────────────
  // Reserved at S49 and deliberately left unwired: each needed an upstream
  // source that could not be fabricated. All three now exist — the library
  // (S41-46), stays (S30-32) and the ledger's system accounts — so these
  // read real facts or they read nothing. A metric with no source is worse
  // than a missing metric: it invites a guess.
  {
    key: "library_utilization_pct",
    kind: "snapshot",
    label: "Library in use",
    unit: "%",
    description: "Share of library items that were out on loan at any point in the lunation: how hard the shelves actually work. Meta carries the item and loan counts behind it.",
    doughnut: { ring: "foundation", shareOf: "percent", floor: 0.2 },
  },
  {
    key: "stay_occupancy_nights",
    kind: "snapshot",
    label: "Nights stayed",
    unit: "nights",
    description: "Nights actually posted against stays during the lunation. Counts nights slept, never nights booked.",
  },
  {
    key: "treasury_balance",
    kind: "snapshot",
    label: "Treasury holdings",
    unit: "tokens",
    description: "What sys:treasury held at close, summed across tokens; the per-token split rides in meta. A time series here is how a village sees its own reserves move.",
  },
  {
    key: "gratitude_pool_issued",
    kind: "snapshot",
    label: "Recognition issued to date",
    unit: "tokens",
    description: "Total recognition the gratitude faucet has released since the beginning. The faucet's negative balance IS issuance-to-date, read straight from the ledger.",
  },

  // ── Regen: the land's own ledger, steward-recorded ─────────────────────────
  { key: "trees_planted", kind: "regen", label: "Trees planted", unit: "trees", description: "Cumulative plantings, recorded as they happen." },
  { key: "hectares_restored", kind: "regen", label: "Hectares in restoration", unit: "ha", description: "Land under active regeneration." },
  { key: "food_produced_kg", kind: "regen", label: "Food produced", unit: "kg", description: "Harvest weighed out of the gardens and food forest." },
  { key: "water_protected_liters", kind: "regen", label: "Water protected", unit: "liters", description: "Storage and springflow brought under protection." },
  { key: "carbon_sequestered_kg", kind: "regen", label: "Carbon sequestered", unit: "kg", description: "Estimated sequestration from plantings and soil work." },
];

export const HEALTH_METRICS_BY_KEY: Record<string, HealthMetricDef> = Object.fromEntries(
  HEALTH_METRICS.map((m) => [m.key, m]),
);

export const SNAPSHOT_METRICS = HEALTH_METRICS.filter((m) => m.kind === "snapshot");
export const REGEN_METRICS = HEALTH_METRICS.filter((m) => m.kind === "regen");

/** How many lunations of snapshots the dashboard needs before trends render. */
export const TREND_MIN_LUNATIONS = 3;
