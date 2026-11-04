/**
 * The Sera bridge board on the Saberra module card: what the server answers at
 * GET /api/saberra/bridge, the agreement date, and the tools checklist.
 *
 * Every number on the board comes from this answer. The tools list is a
 * checklist state taken from Saberra's emails (Rick, Nov 2 2026), not a reading
 * of the service, and the board says so.
 */
import type { QuestFeedAnswer } from "./seraQuestFeed";
import type { SyncLast } from "./seraSyncHealth";

/** The data agreement with Saberra LLC: Tue Nov 3 2026, 2:00 PM Costa Rica time (UTC-6). */
export const SERA_AGREEMENT = {
  at: "2026-11-03T20:00:00.000Z",
  timezone: "America/Costa_Rica",
  label: "Tue Nov 3, 2:00 PM Costa Rica time",
  party: "Saberra LLC",
} as const;

export interface BridgeAnswer {
  connection: { mayCall: boolean; addressSet: boolean; held: number; /** The full-scope privacy token is set (never its value). */ privacySet?: boolean; /** Which token each act goes over; never a value. */ tokens?: TokenUse[] };
  lists: {
    /** False when the member-list tables are not in this database yet. */
    ready: boolean;
    linkedPeople: number;
    listsOn: number;
    imported: number;
    importedOpen: number;
    lastBatch: { id: string; at: string | null; tasks: number } | null;
    /** Each member linked to Sera, for the steward: name, list switch, what came in. */
    people?: LinkedPerson[];
  };
  feedback: {
    /** False while the feedback bridge has not landed: the board shows "Building". */
    ready: boolean;
    sent: number;
    queued: number;
    failed: number;
    notesHeld: number;
    /** Whether notes are released to Sera, or null when unknown. */
    notesReleased: boolean | null;
    /** Members who turned "Help the knowledge library learn" off. */
    membersOff?: number;
  };
  reviewQueue: { waiting: number };
  /** The last linked-members sync, for the health alert. */
  sync?: SyncLast | null;
  /** Sera's quest feed: the last real run, and how many of its quests wait for a steward. */
  questFeed?: { last: QuestFeedAnswer | null; waiting: number };
  needsOwner: { ready: boolean; waiting: number; items?: { title: string; role: string | null }[] };
}

export interface LinkedPerson {
  name: string;
  listOn: boolean;
  imported: number;
  lastImportAt: string | null;
  /** When the 6-hourly sync last read this member (sera_person_links.last_synced_at). */
  lastSyncedAt?: string | null;
}

export interface SeraTool {
  name: string;
  what: string;
  unlocked: boolean;
}

/** Shipped and not-yet, as Saberra's emails of Nov 2 2026 list them. */
export const SERA_TOOLS: readonly SeraTool[] = [
  { name: "list_voice_tasks", what: "Paging, changed_since, removed_since, evidence_contains", unlocked: true },
  { name: "submit_task_feedback", what: "Reason, context, redirect target; notes switched off until the agreement", unlocked: true },
  { name: "retract_task_feedback", what: "Undo a feedback", unlocked: true },
  { name: "delete_owner_feedback", what: "Delete a person's feedback", unlocked: true },
  { name: "reassign_voice_task", what: "Redirect a task to a named person", unlocked: true },
  { name: "list_quest_proposals", what: "Quest ideas from the library", unlocked: true },
  { name: "Role relation", what: "Redirect to a role, not only a person", unlocked: false },
  { name: "requested_by", what: "A \"waiting on you\" field", unlocked: false },
  { name: "Retention job", what: "Delete feedback after 12 months", unlocked: false },
  { name: "Hard delete", what: "Hard delete of a person's tasks", unlocked: false },
];

export type AgreementState = { phase: "before"; ms: number } | { phase: "signed-time-passed" };

export function agreementState(now: number): AgreementState {
  const ms = Date.parse(SERA_AGREEMENT.at) - now;
  return ms > 0 ? { phase: "before", ms } : { phase: "signed-time-passed" };
}

export interface BridgeCheck {
  id: string;
  label: string;
  done: boolean;
}

/** The checks the bridge level counts. Each one is a fact in the answer, never an estimate. */
export function bridgeChecks(a: BridgeAnswer, now: number): BridgeCheck[] {
  return [
    { id: "key", label: "Key set and readable", done: a.connection.mayCall },
    { id: "address", label: "Address set", done: a.connection.addressSet },
    { id: "facts", label: "Facts held from Sera", done: a.connection.held > 0 },
    { id: "linked", label: "A member linked to Sera", done: a.lists.linkedPeople > 0 },
    { id: "imported", label: "Tasks imported from Sera", done: a.lists.imported > 0 },
    { id: "list-on", label: "A personal list turned on", done: a.lists.listsOn > 0 },
    { id: "feedback", label: "Feedback reached Sera", done: a.feedback.ready && a.feedback.sent > 0 },
    { id: "agreement", label: "Agreement time reached", done: agreementState(now).phase !== "before" },
  ];
}

export type TokenKind = "sync" | "connection" | "privacy";

export interface TokenUse {
  act: string;
  /** Which token this act goes over right now. */
  uses: TokenKind;
  /** Whether that token is there; never its value. */
  set: boolean;
}

/**
 * Every time on the Sera board and the Link to Sera panel, in village time
 * (SERA_AGREEMENT.timezone). The zone is named when it is not the viewer's,
 * so two readers never see two different clocks for one sync.
 */
export function villageTime(iso: string | null, fallback = "unknown time", viewerZone?: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const zone = SERA_AGREEMENT.timezone;
  const text = d.toLocaleString("en-US", { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  let viewer = viewerZone;
  if (viewer === undefined) {
    try { viewer = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { viewer = zone; }
  }
  return viewer === zone ? text : `${text} ${zoneName(zone)} time`;
}

function zoneName(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}
