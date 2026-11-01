/**
 * HOW WE GOVERN, STEP 2, WITH NO SAVE FOR ANYONE TO REMEMBER (2026-11-01).
 *
 * Step 1 (#697) put /governance on the page content system with the words it
 * had always shown as its defaults. Step 2 makes those defaults neutral, so a
 * new village starts with a page that describes nobody in particular. The
 * order rule is that a default a village still inherits must not move under
 * it, which used to mean a founder saving the page in Admin first. Rye asked
 * for as few manual steps as possible, so the save is done here, once, at boot.
 *
 * WHO KEEPS THE OLD WORDS. A village that already made its page words its own
 * (any other `page-*` section stored) is an established village, and it keeps
 * the wording it shows today. So does a village that already saved part of
 * this page: the boxes it left alone keep reading what they read. A village
 * with neither, which is every new one, gets the neutral starter page.
 *
 * NEVER OVER A VILLAGE'S OWN WORD. Every box a village saved stays exactly as
 * saved, a hidden section stays hidden, and a list it wrote stays its list.
 * Only the boxes it never touched are filled, from the snapshot in
 * server/seeds/page-governance-before-neutral.json, which is the step-1
 * defaults as `adoptedDocument` wrote them, `{words}` kept as words.
 *
 * A save made from an editor opened before this ran is refused rather than
 * written over these words: the Pages editor names the stored words it was
 * opened on (`contentVersion`) and the content route answers 409 when they
 * moved.
 */
import BEFORE_NEUTRAL from "../seeds/page-governance-before-neutral.json";
import { GOVERNANCE_PAGE } from "../../shared/pageContent/governance";
import { pageSectionKey } from "../../shared/pageContent/types";

type Doc = Record<string, unknown>;

export const GOVERNANCE_WORDS_BEFORE_NEUTRAL: Doc = BEFORE_NEUTRAL as Doc;

const isDoc = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The governance section this village should hold, or null when it needs
 * nothing written. Pure: the same content in gives the same answer out.
 */
export function keptGovernanceSection(content: Doc | null | undefined): Doc | null {
  const all = isDoc(content) ? content : {};
  const key = pageSectionKey(GOVERNANCE_PAGE);
  const stored = all[key];
  const adoptedElsewhere = Object.keys(all).some((k) => k !== key && k.startsWith("page-") && all[k] !== undefined);
  if (stored === undefined && !adoptedElsewhere) return null;
  const own = isDoc(stored) ? stored : {};
  const out: Doc = {};
  for (const [sectionId, before] of Object.entries(GOVERNANCE_WORDS_BEFORE_NEUTRAL)) {
    const mine = own[sectionId];
    out[sectionId] = isDoc(mine) && isDoc(before) ? { ...before, ...mine } : mine ?? before;
  }
  // A section the village wrote that the snapshot never had is still its own.
  for (const [sectionId, mine] of Object.entries(own)) if (!(sectionId in out)) out[sectionId] = mine;
  return JSON.stringify(out) === JSON.stringify(stored) ? null : out;
}

/** The boot fixup: writes the kept section once, and reports whether it wrote. */
export async function keepGovernanceWords(repo: {
  get(): Doc | null;
  put(doc: Doc): Promise<unknown>;
}): Promise<boolean> {
  const content = repo.get() ?? {};
  const section = keptGovernanceSection(content);
  if (!section) return false;
  await repo.put({ ...content, [pageSectionKey(GOVERNANCE_PAGE)]: section });
  return true;
}
