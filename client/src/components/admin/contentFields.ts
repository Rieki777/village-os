/**
 * What each written section of a village actually contains, as data.
 *
 * WHY THIS EXISTS. Admin, Content offered a raw JSON textarea for Legal &
 * Jurisdiction Notices and for the Love Letter Covenant. Rye, on both: "need
 * to improve the UI of this so non tech users can update this information".
 * Asking a founder to hand-edit a nested JSON document is asking them to know
 * which keys the public pages read, and to keep the braces balanced while
 * they do it.
 *
 * Every field below was established by reading the page that renders it, and
 * each `help` line carries what a reader sees AND what the page does when the
 * box is empty, because that is the question a founder actually has and the
 * answer is never the same twice: some fall back to platform wording, some
 * drop their sentence, and one drops an entire block of cards.
 *
 * A LEGAL CLAIM WITH NO SAFE DEFAULT IS MARKED. `landShareTransferNote` and
 * the membership notes are tax and entity claims about one jurisdiction. The
 * honest empty state for a village that has not taken advice is BLANK, and
 * the pages are written so blank reads correctly. `claim: true` puts that in
 * front of the founder instead of leaving them to inherit somebody else's
 * tax position by not noticing a field.
 *
 * The editor keeps the parsed document as ground truth and writes back
 * through these paths, so a key nothing here describes survives an edit
 * untouched. The raw JSON stays below as the advanced view.
 */

export type FieldKind = "text" | "long";

export interface DocField {
  /** Key path from the document root, or from a repeat item. */
  path: string[];
  label: string;
  help: string;
  kind: FieldKind;
  rows?: number;
  /** A jurisdiction-specific claim. Blank is the safe state, and it says so. */
  claim?: boolean;
}

export interface RepeatGroup {
  path: string[];
  label: string;
  help: string;
  /** Label for the button that adds one. */
  addLabel: string;
  /** Which field names the row in its header. */
  titlePath: string[];
  fields: DocField[];
}

export interface SectionSpec {
  intro: string;
  fields: DocField[];
  groups?: RepeatGroup[];
}

const LEGAL: SectionSpec = {
  intro:
    "What this village says about its own law, tax and entity. Every box is optional, and the pages are written so an empty box reads correctly. Leave anything you have not taken advice on blank.",
  fields: [
    {
      path: ["jurisdictionOverview", "heading"],
      label: "Heading over the legal and tax section",
      help: "The big heading on your investor and resident pages. Fill this in, or the sentence below it, and the block publishes even with no points added yet.",
      kind: "text",
    },
    {
      path: ["jurisdictionOverview", "intro"],
      label: "One sentence under that heading",
      help: "Sets up the points below it.",
      kind: "long",
      rows: 2,
    },
    {
      path: ["landShareTransferNote"],
      label: "Passing a land share to your children",
      help: 'A SHORT PHRASE dropped into the middle of a sentence on three pages, as in "pass your land share to your children YOUR PHRASE, keeping it in the family". No capital letter, no full stop. Leave it blank and the sentences read correctly with no tax claim in them.',
      kind: "text",
      claim: true,
    },
    {
      path: ["membership", "entityLabel"],
      label: "The legal entity a member joins",
      help: "Exactly as it appears on the paperwork. It is printed six times on the Love Letter, including the line above the signature. Left blank, your village's NAME is printed in its place, which reads as a legal entity and is not one.",
      kind: "text",
      claim: true,
    },
    {
      path: ["membership", "contributionParagraph"],
      label: "What a monthly contribution supports",
      help: "The full paragraph in the body of the Love Letter.",
      kind: "long",
      rows: 4,
      claim: true,
    },
    {
      path: ["membership", "contributionShortNote"],
      label: "Short note above the suggested amounts",
      help: "One line, printed just before the suggested contribution figures.",
      kind: "text",
      claim: true,
    },
    {
      path: ["membership", "footerNote"],
      label: "Fine print under the submit button",
      help: "Left blank, this does not go quiet: members are told to ask the community how contributions are structured. Read that sentence and decide whether it is true of you.",
      kind: "long",
      rows: 3,
      claim: true,
    },
    {
      path: ["membership", "backgroundCheckNote"],
      label: "Note on the background-check step",
      help: 'A SHORT PHRASE appended to that step on the resident path, as in "...the description, YOUR PHRASE." No leading comma, no full stop.',
      kind: "text",
      claim: true,
    },
  ],
  groups: [
    {
      path: ["jurisdictionOverview", "points"],
      label: "The points under that heading",
      help: "Each one is a card on your investor and resident pages, two to a row. A card needs BOTH a title and a body to appear at all, so a half-filled one is silently skipped. Icons cycle through a set of six, so a seventh card reuses the first icon.",
      addLabel: "Add a point",
      titlePath: ["title"],
      fields: [
        { path: ["title"], label: "Title", help: "A few words.", kind: "text" },
        { path: ["body"], label: "Body", help: "A short paragraph.", kind: "long", rows: 4 },
      ],
    },
  ],
};

const COVENANT: SectionSpec = {
  intro:
    "The two paragraphs at the top of the Love Letter, which members read and sign. Both shipped describing one village's own land and its own plan, so these are the boxes where you say yours. Left blank, each falls back to the same words with the geography and the numbers taken out.",
  fields: [
    {
      path: ["opening"],
      label: "The invitation",
      help: "The first paragraph a member reads. This is where a village describes its own land.",
      kind: "long",
      rows: 7,
    },
    {
      path: ["governance"],
      label: "How this village will govern itself",
      help: "How and when you form your governance, in your own words. This is the paragraph members are asked to sign, so it should say what you actually intend.",
      kind: "long",
      rows: 7,
    },
  ],
};

/** The sections that have a field editor. Anything else gets raw JSON alone. */
export const SECTION_FIELDS: Record<string, SectionSpec> = {
  legal: LEGAL,
  covenant: COVENANT,
};

/** Read a nested path, tolerating every missing level. */
export function readPath(doc: any, path: string[]): string {
  let cur = doc;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return "";
    cur = cur[k];
  }
  return cur === null || cur === undefined ? "" : String(cur);
}

/**
 * Write a nested path, creating the objects on the way down.
 *
 * An empty value DELETES the key rather than storing "". The pages branch on
 * absent-or-blank identically, but a document full of empty strings is a
 * document that looks answered, and the next person to read it cannot tell a
 * deliberate blank from a box nobody reached.
 */
export function writePath(doc: any, path: string[], value: string): any {
  const next = Array.isArray(doc) ? [...doc] : { ...(doc ?? {}) };
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    const child = cur[k];
    cur[k] = child && typeof child === "object" && !Array.isArray(child) ? { ...child } : {};
    cur = cur[k];
  }
  const last = path[path.length - 1];
  if (value === "") delete cur[last];
  else cur[last] = value;
  return next;
}

/** The array at a repeat group's path, always a real array. */
export function readGroup(doc: any, path: string[]): any[] {
  let cur = doc;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return [];
    cur = cur[k];
  }
  return Array.isArray(cur) ? cur : [];
}

/** Replace a repeat group's array, creating the objects on the way down. */
export function writeGroup(doc: any, path: string[], rows: any[]): any {
  const next = { ...(doc ?? {}) };
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    const child = cur[k];
    cur[k] = child && typeof child === "object" && !Array.isArray(child) ? { ...child } : {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = rows;
  return next;
}
