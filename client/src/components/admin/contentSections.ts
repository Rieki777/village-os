/**
 * The content sections a founder can edit, moved out of
 * client/src/pages/Admin.tsx unchanged.
 *
 * It sits in its own file because TWO things read it and they now live apart:
 * the admin nav builds its Content group from it, and the content editor tab
 * renders a picker from it. Leaving it in Admin.tsx would have forced the nav
 * to stay there too.
 */
import { FileText, Users } from "lucide-react";

/*
 * ONE SECTION LEFT, and the six that went are why this comment exists.
 *
 * Investor, Steward, Resident and Prosperity saved into
 * `app_config['content'].<pathway>` and the four journey pages each hold their
 * own `journeySteps` constant and never fetched it, so every save was a green
 * toast over nothing. Circles and Roles had carried an amber banner since 0049
 * saying the public pages no longer read them, which is an editor admitting it
 * lies and staying on the rail anyway. /circles and /roles read `/api/org`;
 * their editor is Admin, Org Chart.
 *
 * Team stays because Team.tsx really does fetch `/api/content/team`: the cards
 * carry the portrait and the bio a seat row has no place for, and a card for
 * somebody who holds no seat is the only way they reach the page at all.
 */
export const CONTENT_SECTIONS = [
  { key: "team", label: "Team Page", icon: Users },
  // Added for the brochure lane's legal-content extraction (fe3f3e1): 22
  // jurisdiction-specific claims moved out of compiled JSX into this section,
  // read through the same generic content routes. Without a registry entry
  // here a founder has no door to write their own jurisdiction's notices.
  { key: "legal", label: "Legal & Jurisdiction Notices", icon: FileText },
  // S3 pages lane: the two paragraphs of the Love Letter covenant that
  // describe this village's own land and its own plan for forming a
  // governance council. They shipped compiled in, so every founder's members
  // were asked to SIGN a description of Amora's jungle and Amora's lot count.
  // LoveLetter.tsx reads `covenant.opening` and `covenant.governance`; with
  // nothing saved it falls back to the same sentences minus the geography and
  // the number. Amora's own wording is in server/seeds/pages-covenant-seed.json.
  { key: "covenant", label: "Love Letter Covenant", icon: FileText },
] as const;

/**
 * The document a section starts as when this village has never saved it.
 *
 * GET /api/content/:section answers 404 for a section nobody has written
 * yet, which is the correct answer and the ordinary state of every fresh
 * instance. The editor needs SOMETHING to put in the box in that case, and
 * the one thing it must never put there is the 404's own body: it used to,
 * and Save then wrote {"error":"Section not found"} into the village as real
 * content. See the load() in client/src/components/admin/ContentEditorTab.tsx for
 * the full account.
 *
 * `team` is an ARRAY of cards and everything else is an object keyed by
 * field. Getting this wrong is not cosmetic either: the team card editor
 * only renders when the parsed value is an array, so handing it `{}` would
 * silently drop a founder back to raw JSON. `legal` and `covenant` have field
 * editors of their own now (client/src/components/admin/contentFields.ts) and
 * are gated the same way, on their document parsing to an object.
 */
const ARRAY_SECTIONS = new Set<string>(["team"]);

export function emptyContentFor(sectionKey: string): unknown[] | Record<string, never> {
  return ARRAY_SECTIONS.has(sectionKey) ? [] : {};
}
