/**
 * The journal's bridge to the organisational memory service, as the admin's
 * setup panel and the server agree on it.
 *
 * ONE FILE IS THE CONTRACT for `GET /api/saberra/outbox`: the server
 * (server/lib/saberraOutbox.ts) builds this shape and the panel
 * (client/src/components/admin/SaberraOutboxPanel.tsx) reads it, and the two
 * unions below key every lookup table on both sides, so a kind or a status
 * added here is a build error wherever a sentence for it is missing.
 *
 * WHAT IS NOT IN IT, on purpose: any word of a member's writing. The listing
 * carries the kind, the date, the code-name, the length and the status of
 * each item. Inside the village an entry is its author's alone, and no admin
 * reads it, here or anywhere.
 */

export const OUTBOX_KINDS = ["journal_entry", "team_signal"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/**
 * queued  waiting for a write path, or for its next try
 * sent    the service confirmed it holds it
 * failed  the last try did not land; it is tried again
 * held    withdrawn (made private, deleted, or its author left): never sent
 */
export const OUTBOX_STATUSES = ["queued", "sent", "failed", "held"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** One row of the admin's listing. No words, ever. */
export interface OutboxListItem {
  id: string;
  kind: OutboxKind;
  /** The entry's civil date (`2026-10-14`), or the signal's ISO week (`2026-W42`). */
  period: string;
  /** The author's code-name, or null for a team signal. */
  codeName: string | null;
  /** Characters of member writing the item carries. */
  chars: number;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
}

/** What `GET /api/saberra/outbox` answers. */
export interface OutboxView {
  /** False until a transport to the service exists. Today it is always false. */
  writePath: boolean;
  /** Whether the journal module is on, since nothing is queued while it is off. */
  journalOn: boolean;
  counts: Record<OutboxStatus, number>;
  byKind: Record<OutboxKind, number>;
  /** Departed members whose code-names are kept, waiting on the service to confirm a delete. */
  pendingVendorDelete: number;
  /** The newest items, at most `OUTBOX_LISTING_LIMIT`. */
  items: OutboxListItem[];
}

/** How many items the admin's listing carries. */
export const OUTBOX_LISTING_LIMIT = 50;
