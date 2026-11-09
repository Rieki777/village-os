/**
 * The shapes /review reads from `GET /api/review/queue`, moved out of
 * pages/Review.tsx unchanged so the page keeps room under the 1000-line
 * ratchet (scripts/check-file-lines.mjs). Types only: nothing here ships.
 */
import type { QuestCard } from "@/components/review/QuestProposalCard";

export interface ProposalCard {
  id: string;
  batchId: string;
  moduleId: string;
  kind: string;
  payload: Record<string, unknown>;
  quote: string | null;
  sourceRef: string | null;
  sourceOccurredAt: string | null;
  evidence: "quoted" | "anchored" | "absent";
  audience: "steward" | "member";
  trustTier: string;
  confidence: number | null;
  significance: number | null;
  subjectRef: string | null;
  receivedAt: string;
  correlationId: string | null;
}

export interface Batch {
  batchId: string;
  moduleId: string | null;
  receivedAt: string | null;
  /** Changes accepting the batch whole would propose. Null with no org proposals; absent from an older server. */
  proposedChanges?: number | null;
  /** Each org card's share of that count, by proposal id, so an edit is counted in its place. Absent from an older server. */
  proposedChangesByItem?: Record<string, number>;
  items: ProposalCard[];
}

export interface Drop {
  moduleId: string;
  reason: string;
  dropped: number;
  lastAt: string | null;
}

export interface Queue {
  batches: Batch[];
  quests: QuestCard[];
  drops: Drop[];
  /** Open drafts this queue made that cannot publish. Absent from an older server. */
  stuckDrafts?: { draftId: string; blocked: number; blockedLines: unknown; unpreviewable?: boolean }[];
  /** Every open draft this queue made, with the batch whose page shows it. Absent from an older server. */
  openDrafts?: { draftId: string; title: string; changes: number; batchId: string | null }[];
  counts: { proposals: number; quests: number };
  /**
   * The halves this reader was given. An older server sends no `scope`, and it
   * only ever answered the key that reads both, so absent reads as both.
   */
  scope?: { proposals: boolean; quests: boolean };
  /** `org.proposal_change_limit`, as the server reads it. Absent from an older server. */
  proposalChangeLimit?: number;
  /** Whether this reader can open the admin page where that limit is changed. */
  mayChangeProposalLimit?: boolean;
}

/** A draft that cannot publish: how many seats are blocked, and why each one is. */
export interface StuckDraft {
  blocked: number;
  lines: string[];
  /** The server could not preview it, so there is no count of blocked seats to give. */
  unpreviewable?: boolean;
}
