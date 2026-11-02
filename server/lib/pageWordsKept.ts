/**
 * A PAGE'S DEFAULTS GO NEUTRAL, AND AN ESTABLISHED VILLAGE KEEPS ITS WORDS,
 * WITH NO SAVE FOR ANYONE TO REMEMBER.
 *
 * A page that moves onto the page content system first ships with the words it
 * always showed as its defaults, and then those defaults become neutral, so a
 * new village starts with a page that describes nobody in particular. The
 * order rule is that a default a village still inherits must not move under
 * it, which used to mean a founder saving the page in Admin first. Rye asked
 * for as few manual steps as possible, so the save is done at boot, once per
 * page, by a runOnce that calls `keepPageWords` (How We Govern first, #732, in
 * governanceWordsKept.ts; Circles next, in circlesWordsKept.ts).
 *
 * WHO KEEPS THE OLD WORDS. A village that already made its page words its own
 * (any other `page-*` section stored) is an established village, and it keeps
 * the wording it shows today. So does a village that already saved part of
 * this page: the boxes it left alone keep reading what they read. A village
 * with neither, which is every new one, gets the neutral starter page.
 *
 * NEVER OVER A VILLAGE'S OWN WORD. Every box a village saved stays exactly as
 * saved, a hidden section stays hidden, and a list it wrote stays its list.
 * Only the boxes it never touched are filled, from the page's snapshot in
 * server/seeds/page-<id>-before-neutral.json: the first defaults as
 * `adoptedDocument` wrote them, `{words}` kept as words.
 *
 * A save made from an editor opened before this ran is refused rather than
 * written over these words: the Pages editor names the stored words it was
 * opened on (`contentVersion`) and the content route answers 409 when they
 * moved.
 */
import { pageSectionKey, type PageSpec } from "../../shared/pageContent/types";

type Doc = Record<string, unknown>;

/** The content document, as the boot fixup reads and writes it. */
export interface PageWordsRepo {
  get(): Doc | null;
  put(doc: Doc): Promise<unknown>;
}

const isDoc = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The section this village should hold for `spec`, or null when it needs
 * nothing written. Pure: the same content in gives the same answer out.
 */
export function keptPageSection(spec: Pick<PageSpec, "id">, before: Doc, content: Doc | null | undefined): Doc | null {
  const all = isDoc(content) ? content : {};
  const key = pageSectionKey(spec);
  const stored = all[key];
  const adoptedElsewhere = Object.keys(all).some((k) => k !== key && k.startsWith("page-") && all[k] !== undefined);
  if (stored === undefined && !adoptedElsewhere) return null;
  const own = isDoc(stored) ? stored : {};
  const out: Doc = {};
  for (const [sectionId, old] of Object.entries(before)) {
    const mine = own[sectionId];
    out[sectionId] = isDoc(mine) && isDoc(old) ? { ...old, ...mine } : mine ?? old;
  }
  // A section the village wrote that the snapshot never had is still its own.
  for (const [sectionId, mine] of Object.entries(own)) if (!(sectionId in out)) out[sectionId] = mine;
  return JSON.stringify(out) === JSON.stringify(stored) ? null : out;
}

/** The boot fixup: writes the kept section once, and reports whether it wrote. */
export async function keepPageWords(spec: Pick<PageSpec, "id">, before: Doc, repo: PageWordsRepo): Promise<boolean> {
  const content = repo.get() ?? {};
  const section = keptPageSection(spec, before, content);
  if (!section) return false;
  await repo.put({ ...content, [pageSectionKey(spec)]: section });
  return true;
}
