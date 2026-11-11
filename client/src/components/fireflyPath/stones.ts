/**
 * THE APPLICATION'S STEPS, the pure half (the lead, 11 Nov 2026; Phase A, lane A1).
 *
 * The application for a listed role (/propose-a-role, "Apply: [role name]")
 * is six steps: Get to know us, About you, Your value, The terms, Your first
 * day, Review & submit. It keeps the Firefly Path's mechanics (game feel wave
 * 2): every check the form makes still runs in one place
 * (pages/ProposeARole.tsx), and this file says which step each finding belongs
 * to, so Continue judges only the step you are on and Send reviews the whole
 * application in the order it is walked.
 *
 * No React here, so a test can read every rule without drawing a page.
 */

export const STONES = ["know", "about", "value", "terms", "first", "review"] as const;
export type Stone = (typeof STONES)[number];
export const LAST_STONE = STONES.length - 1;

/**
 * Which step a field the checks or the server name lives on. A field nobody
 * placed (a server refusal with no field, a rate limit, the role itself)
 * belongs to Review & submit, where the person pressed the button.
 */
export function stoneOfField(field: string | null | undefined): number {
  switch (field) {
    case "knowUs":
      return 0;
    case "why":
    case "name":
    case "email":
    case "checkConsent":
    case "references":
    case "about":
    case "links":
    case "files":
    case "selfKnowledge":
    case "drafts:about":
      return 1;
    case "aim":
    case "card":
    case "serves":
    case "drafts:moon":
      return 2;
    case "terms":
      return 3;
    case "timeZone":
    case "windows":
    case "earliestStart":
      return 4;
    default:
      return LAST_STONE;
  }
}

/** Findings in the order the path walks them; within a stone, in the order they were found. */
export function orderByStone<T extends { field: string | null }>(found: readonly T[]): T[] {
  return found
    .map((p, i) => ({ p, i, s: stoneOfField(p.field) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}

/** Only the findings on one stone. */
export function onStone<T extends { field: string | null }>(found: readonly T[], stone: number): T[] {
  return found.filter((p) => stoneOfField(p.field) === stone);
}

/**
 * The webmail door for an address whose provider we know, so "Check your
 * email" can be one tap. Unknown domains get no button: guessing would send
 * somebody to the wrong door. Only https addresses of the providers' own.
 */
const INBOXES: ReadonlyArray<{ domains: readonly string[]; name: string; href: string }> = [
  { domains: ["gmail.com", "googlemail.com"], name: "Gmail", href: "https://mail.google.com/" },
  { domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], name: "Outlook", href: "https://outlook.live.com/mail/" },
  { domains: ["yahoo.com", "ymail.com"], name: "Yahoo Mail", href: "https://mail.yahoo.com/" },
  { domains: ["icloud.com", "me.com", "mac.com"], name: "iCloud Mail", href: "https://www.icloud.com/mail" },
  { domains: ["proton.me", "protonmail.com", "pm.me"], name: "Proton Mail", href: "https://mail.proton.me/" },
  { domains: ["gmx.com", "gmx.net", "gmx.de"], name: "GMX", href: "https://www.gmx.com/" },
  { domains: ["aol.com"], name: "AOL Mail", href: "https://mail.aol.com/" },
];

export function inboxFor(email: string): { name: string; href: string } | null {
  const at = String(email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at <= 0) return null;
  const domain = String(email).trim().toLowerCase().slice(at + 1);
  const hit = INBOXES.find((i) => i.domains.includes(domain));
  return hit ? { name: hit.name, href: hit.href } : null;
}

/**
 * A swipe between stones, from where a touch began and ended: +1 is on to the
 * next stone (the finger moved left), -1 is back. A mostly vertical move is a
 * scroll and says nothing, and so does a short one.
 */
export const SWIPE_MIN_PX = 64;
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX) return 0;
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return 0;
  return dx < 0 ? 1 : -1;
}

/** Where a key or a swipe belongs to the field itself (typing, a caret, a choice), so the path must not take it. */
export function ownsKeys(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select, [contenteditable], [role='radiogroup'], [role='slider'], [role='listbox']");
}

/** A one-line field where Enter means "on to the next stone" (never a long answer, a choice or a file). */
export function enterWalksOn(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null;
  if (!el || el.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "file", "button", "submit", "reset", "image", "range", "color"].includes(String(el.type).toLowerCase());
}

/** The time a confirmation link stops working, counted from when the proposal was sent. */
export function confirmBy(sentAt: Date, hours: number): Date {
  return new Date(sentAt.getTime() + hours * 60 * 60_000);
}

/** The day the village has said it will have written by, counted from a moment in days. */
export function replyBy(from: Date, days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60_000);
}
