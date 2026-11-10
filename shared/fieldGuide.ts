/**
 * "Talk it out" beside a long text box (server/routes/fieldGuide.ts and
 * client/src/components/voice/TalkItOut.tsx). Shared so the page and the
 * route agree on the limits.
 */

/** The box's label as the page names it. */
export const FIELD_LABEL_MAX = 80;
/** What the box is for, in a sentence. */
export const FIELD_PURPOSE_MAX = 300;
/** What is in the box now, sent so the guide can improve it. */
export const FIELD_TEXT_MAX = 6000;
/** The longest draft the guide may offer. */
export const FIELD_DRAFT_MAX = 6000;

export interface FieldGuideAnswer {
  reply: string;
  /** A draft for the box, or null until the guide has enough. */
  draft: string | null;
  /** Who answered: the member's own choice of guide. */
  guide: { id: "village" | "saberra"; name: string };
}
