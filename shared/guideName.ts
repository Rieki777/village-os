/**
 * THE VILLAGE GUIDE'S NAME, resolved in one place for every surface.
 *
 * WHERE THE NAME LIVES. The village guide's name is stored in exactly one
 * field: `workWithUs.assistantName`, the village's Work With Us document
 * (`GET /api/work-with-us-config`), which a founder or admin sets under Admin,
 * Work With Us, "AI guide's name". Nothing else stores a guide name. A flow
 * that names the guide writes that field, and every surface that shows the
 * name reads it through `guideName` below.
 *
 * WHY THERE IS NO DEFAULT NAME. Rye, 2026-10-22: "Maia" is Amora's own guide,
 * and every village starts by adding and naming its own. So the platform
 * ships the guide unnamed (`DEFAULT_WORK_WITH_US.assistantName` is ""), and
 * Amora keeps "Maia" in its own saved document like any other village's
 * choice. A fallback that typed "Maia" gave every other village Amora's guide.
 *
 * AN UNNAMED GUIDE IS NEVER HIDDEN. It reads "your village guide" to a
 * founder or admin, the people who can name it, and "the village guide" to
 * members and the public. Both are lowercase, because they usually sit
 * mid-sentence ("Talk it through with the village guide"); use
 * `guideNameAtSentenceStart` where the name opens a sentence or stands alone
 * as a label.
 *
 * Pure: no imports, no clock, no I/O. The client and the server both read it.
 */

/** Who is reading the name. Founders and admins can name the guide; members and the public cannot. */
export type GuideAudience = "founder" | "admin" | "member" | "public";

/** The guide's name as a surface shows it. */
export interface GuideName {
  /** The village's own name for its guide, or the neutral label while it has none. */
  name: string;
  /** True when the village has named its guide. */
  named: boolean;
}

/** What an unnamed guide is called, by who is reading. */
export const UNNAMED_GUIDE = {
  /** To a founder or admin: the guide is theirs to name. */
  own: "your village guide",
  /** To members and the public. */
  shared: "the village guide",
} as const;

/**
 * The guide's name for one reader. PURE.
 *
 * `source` is the stored `workWithUs.assistantName`. Anything that is not a
 * string with letters in it (missing, null, "", spaces) means the village has
 * not named its guide yet.
 */
export function guideName(source: unknown, audience: GuideAudience): GuideName {
  const typed = typeof source === "string" ? source.trim() : "";
  if (typed) return { name: typed, named: true };
  const own = audience === "founder" || audience === "admin";
  return { name: own ? UNNAMED_GUIDE.own : UNNAMED_GUIDE.shared, named: false };
}

/**
 * The audience for a signed-in viewer's account role, or "public" for nobody.
 * Mirrors the client's admin rule: an account whose role is admin or founder.
 */
export function guideAudience(viewer: { role?: string | null } | null | undefined): GuideAudience {
  if (!viewer) return "public";
  if (viewer.role === "founder") return "founder";
  if (viewer.role === "admin") return "admin";
  return "member";
}

/**
 * The name where it opens a sentence or stands alone as a heading: "The
 * village guide is thinking". A name a village typed is already how it
 * wants it, so this only ever raises the first letter.
 */
export function guideNameAtSentenceStart(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The name filled into a village's own words wherever they say `{name}`,
 * raised to a capital where `{name}` opens the text or a sentence. A greeting
 * that starts "{name} here." reads "The village guide here." while the guide
 * is unnamed, and "Hi, I'm {name}." reads "Hi, I'm the village guide."
 */
export function fillGuideName(template: string, name: string): string {
  return template.replace(/\{name\}/g, (_whole, offset: number) =>
    /^\s*$|[.!?]\s+$/.test(template.slice(0, offset)) ? guideNameAtSentenceStart(name) : name,
  );
}

/**
 * How the guide names itself in a system prompt: "You are {this}, ...". The
 * reader-neutral form, since "You are your village guide" is not a sentence.
 */
export function guidePromptName(source: unknown): string {
  return guideName(source, "public").name;
}

/**
 * The guide introduced in a prompt: "Sol, the village guide" for a named
 * guide, and "the village guide" alone for one still unnamed, which would
 * otherwise read "the village guide, the village guide". Takes the name as
 * `guidePromptName` gives it, so a caller that only holds that string can use it.
 */
export function asTheVillageGuide(promptName: string): string {
  const name = String(promptName ?? "").trim();
  return !name || name === UNNAMED_GUIDE.shared ? UNNAMED_GUIDE.shared : `${name}, ${UNNAMED_GUIDE.shared}`;
}
