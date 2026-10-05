/**
 * WHAT A PERSON SEES WHEN THEY CHOOSE WHICH EMAIL THEY GET, as data both sides
 * read (the comms build spec 5.3 and 5.4).
 *
 * The server builds these shapes and the pages under /email/* render them, so
 * the words beside each switch and the shape of each answer are written once.
 * Every lookup table here is keyed by the union it describes, so a kind added
 * to shared/comms/kinds.ts is a compile error here until somebody writes its
 * words (CLAUDE.md, the hand-kept map trap).
 *
 * Pure and isomorphic: no imports beyond the vocabulary, nothing that touches
 * a database or the DOM. No village name: the server sends the village's own
 * name inside each view.
 */
import type { LinkPurpose, PermissionBasis, PermissionKind, SuppressionReason } from "./kinds";

/** How long "pause" holds the village's email, in days. */
export const PAUSE_DAYS = 30;

/** The kinds a person chooses between, in the order the page lists them. */
export const CHOOSABLE_KINDS: readonly PermissionKind[] = ["events", "paths", "letters", "notices"];

/** The kinds a pause holds. Notices are a member's own account mail, with their own settings. */
export const PAUSABLE_KINDS: readonly PermissionKind[] = ["events", "paths", "letters"];

/** The words beside each switch. */
export const KIND_WORDS: Record<PermissionKind, { label: string; description: string }> = {
  events: {
    label: "Gathering reminders",
    description: "Reminders and changes for the gatherings you said yes to.",
  },
  paths: {
    label: "Path emails",
    description: "A few emails that walk you along a path you chose, and the welcome for new members.",
  },
  letters: {
    label: "Letters",
    description: "News from the village, sent only to the people who asked for it.",
  },
  notices: {
    label: "Your notifications by email",
    description: "Quests, roles, votes and messages. Your notification settings choose which ones.",
  },
};

/** The one thing every page says about the email that always goes. */
export const ESSENTIAL_NOTE =
  "Some email always goes, because you asked for it just then: a password link, or a confirmation of something you did.";

/** Why an address receives nothing, in words for the person it belongs to. */
export const BLOCKED_WORDS: Record<SuppressionReason, string> = {
  bounced: "Email to this address stopped because messages to it bounced. Ask a person at the village to start it again.",
  complained:
    "Email to this address stopped after one of our emails was marked as spam. Ask a person at the village if you want it back.",
  unsubscribed_all: "You asked us to stop every email to this address.",
  manual: "A person at the village stopped email to this address. Ask them if you want it back.",
  erased: "This address was removed from the village's records.",
};

/** One kind's switch, as the page draws it. */
export interface KindView {
  kind: PermissionKind;
  on: boolean;
  /** Why the village holds this answer. Null when nothing has been said yet. */
  basis: PermissionBasis | null;
  /** Where the answer came from, for example `preferences` or `account`. */
  source: string | null;
  /** False when this switch is not this page's to change. */
  changeable: boolean;
  /** A sentence beside the switch, or null. */
  note: string | null;
}

/** Everything the preferences page shows for one address. */
export interface PreferencesView {
  /** The village's own name. */
  village: string;
  /** Enough of the address to tell two of one's own apart, and no more. */
  addressHint: string;
  /** True when the address belongs to a member's account. */
  member: boolean;
  kinds: KindView[];
  /** ISO time the pause ends, or null when nothing is paused. */
  pausedUntil: string | null;
  /** The person asked to stop everything, and may start again here. */
  stopped: boolean;
  /** Email to this address is stopped for a reason only a person at the village can lift. */
  blocked: { reason: SuppressionReason; sentence: string } | null;
}

/** One change the preferences page can ask for. */
export type PreferencesChange =
  | { type: "kind"; kind: PermissionKind; on: boolean }
  | { type: "pause"; on: boolean }
  | { type: "stop_everything" }
  | { type: "start_again" };

const isKind = (v: unknown): v is PermissionKind => (CHOOSABLE_KINDS as readonly unknown[]).includes(v);

/**
 * A request body read as one change, or null.
 *
 * Strict on purpose: a body that names a kind but sends `on: "false"` is not a
 * yes, and a body that asks for two things at once is refused whole, so one
 * press always means one change.
 */
export function preferencesChangeOf(body: unknown): PreferencesChange | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const asked = ["kind", "pause", "stopEverything", "startAgain"].filter((k) => b[k] !== undefined);
  if (asked.length !== 1) return null;
  if (b.kind !== undefined) return isKind(b.kind) && typeof b.on === "boolean" ? { type: "kind", kind: b.kind, on: b.on } : null;
  if (b.pause !== undefined) return typeof b.pause === "boolean" ? { type: "pause", on: b.pause } : null;
  if (b.stopEverything !== undefined) return b.stopEverything === true ? { type: "stop_everything" } : null;
  return b.startAgain === true ? { type: "start_again" } : null;
}

/**
 * Enough of an address for a person with two of them to tell which one a page
 * is about: the first character, a mask, and the domain. A preferences page
 * answers to a link, never to a sign-in, and a link is forwarded and kept in
 * inboxes for years, so the page shows no more of the address than this.
 */
export function addressHint(email: string): string {
  const s = String(email ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at < 1) return "";
  return `${s[0]}•••${s.slice(at)}`;
}

/** The unsubscribe page, before and after the press. */
export interface UnsubscribeView {
  village: string;
  /** What the link stops: one kind, or every kind when the link names none. */
  kind: PermissionKind | "all";
  label: string;
  /** True when this is already stopped, so the press would change nothing. */
  done: boolean;
  /** A preferences link for the same address, so the page can offer every choice. */
  preferencesToken: string | null;
}

/** One answer on the action page. */
export interface ActionChoice {
  value: string;
  label: string;
  primary?: boolean;
}

/**
 * What the action page shows for one signed link: a heading, a few sentences,
 * the answers, which one the person already gave, and an optional box for
 * words. Each purpose's `describe()` builds one; nothing here acts.
 */
export interface ActionDescription {
  purpose: LinkPurpose;
  title: string;
  paragraphs: string[];
  choices: ActionChoice[];
  /** The answer already on record, so the page can show it and offer to change it. */
  current: string | null;
  input?: { name: string; label: string; multiline: boolean; maxLength: number } | null;
  /** Extras one purpose's page knows how to draw. */
  data?: Record<string, unknown> | null;
}

/** What an answer did, and the page to show next. */
export interface ActionOutcome {
  ok: boolean;
  title: string;
  paragraphs: string[];
  description: ActionDescription | null;
}
