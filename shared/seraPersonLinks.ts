/**
 * LINK TO SERA, BY HAND (end-of-moon spec, section 18; Rye, 2026-11-03).
 *
 * A member's library tasks reach their board only once they are linked to
 * their library person (`sera_person_links`). The only way to link used to be
 * a steward import, which also pulls tasks. This is the lighter door: a
 * steward pastes the owner id the library gave them, and nothing is imported.
 * The automatic email link (addendum B5) writes `how = 'email'`; a steward's
 * link always wins over it.
 *
 * Pure: the id check, the shapes and every word a steward reads.
 */

/** The library's owner ids are UUID-like; anything with spaces, slashes or quotes is a paste gone wrong. */
export const SERA_OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;

export const LINK_HOWS = ["steward", "email"] as const;
export type LinkHow = (typeof LINK_HOWS)[number];

export interface MemberLinkRow {
  userId: string;
  name: string;
  /** The last six characters only: enough to check a paste, never the whole id. */
  ownerTail: string | null;
  how: LinkHow | null;
  linkedAt: string | null;
  lastSyncedAt: string | null;
  /** The keyed match could not link this member alone: Sera found none, or several. */
  review?: { outcome: "none" | "several"; matches: number } | null;
}

export interface LinksResponse {
  members: MemberLinkRow[];
}

export interface LinkRequest {
  seraOwnerId: string;
}

export function ownerTail(id: string): string {
  return id.slice(-6);
}

export function seraOwnerIdProblem(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return LINK_WORDS.idMissing;
  if (!SERA_OWNER_ID.test(id)) return LINK_WORDS.idShape;
  return null;
}

export const LINK_HOW_WORDS: Record<LinkHow, string> = {
  steward: "Linked by a steward",
  email: "Linked by email",
};

export const LINK_WORDS = {
  title: "Link to Sera",
  intro: "Paste the owner id Sera gave you for a member. Their Sera tasks reach their board at the next sync. Nothing is imported now.",
  idMissing: "Paste the member's Sera owner id.",
  idShape: "That does not look like a Sera owner id. Paste it exactly as Sera sent it.",
  unknownMember: "That member is not in the village.",
  departed: "That member has left the village, so they are not linked.",
  example: "Example members are never linked.",
  takenBy: (name: string) => `That Sera person is already linked to ${name}. Unlink them first.`,
  linked: (name: string) => `${name} is linked to Sera.`,
  unlinked: (name: string) => `${name} is no longer linked to Sera.`,
  notLinked: "Not linked",
  link: "Link",
  relink: "Relink",
  unlink: "Unlink",
  lastSync: "Last sync",
  never: "Never",
} as const;
