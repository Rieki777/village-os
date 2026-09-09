/**
 * WHAT TO DRAW IN A SEAT WHEN THERE IS A PERSON IN IT.
 *
 * Measured against live Amora on 2026-09-09: TWELVE of twelve seatings are
 * `documented` holders, real people with no account yet, and not one of them
 * has a primary character. The avatar query is an INNER JOIN on that
 * character, so it returned nothing for every seat in the village, and the
 * glyph drew a plain teal dot on each one.
 *
 * A filled seat and a filled seat held by somebody you could go and talk to
 * looked identical. Rye's ask for this map was "know what roles do what, and
 * whom to interact with", and the second half was drawing nothing at all.
 *
 * THE FOUR CASES, decided here rather than inside the renderer, because each
 * one is a POLICY about a person and a renderer that decides policy is a
 * renderer that will decide it differently next time:
 *
 *   an agent          the agent mark, and NEVER a face. Checked first, so no
 *                     later branch can put a portrait on a machine.
 *   a member with art their character's portrait
 *   a documented      initials, from the name the payload already tiered
 *   a member, no art  initials, the same way
 *
 * NOTHING NEW REACHES THE WIRE. `name` is already there and already behind
 * `map.viewPeople`, already `firstName()`d where the village asked for that.
 * Initials are derived from the string the reader can see anyway, so this
 * cannot show more of a person than the card beside it already does.
 */

export type HolderFace =
  | { kind: "agent" }
  | { kind: "face"; src: string }
  | { kind: "initials"; text: string }
  | { kind: "anonymous" };

/** At most two letters: three is a monogram and stops reading at 9px. */
export function initialsFrom(name: string | null | undefined): string {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  // The FIRST letter of the first and last word, which is what a person
  // recognises. A middle name adds nothing at this size.
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function holderFace(h: {
  name?: string | null;
  avatar?: string | null;
  isAgent?: boolean;
}): HolderFace {
  // FIRST, and deliberately: an agent is never given a face, whatever else
  // the payload carries. `server/lib/orgChart.ts` keeps agents and people
  // apart at the write; this keeps them apart at the eye.
  if (h.isAgent) return { kind: "agent" };
  if (h.avatar) return { kind: "face", src: h.avatar };
  const text = initialsFrom(h.name);
  return text ? { kind: "initials", text } : { kind: "anonymous" };
}
