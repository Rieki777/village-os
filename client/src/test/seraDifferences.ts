/**
 * Rows for the tests of the outside service's differences on /review, built
 * the way the route builds them: the server's own sentence builders
 * (shared/seraDifferenceWords.ts) over a difference, so a test reads the words
 * the page is sent. Test support only; nothing in the app imports it.
 */
import type { Difference, DifferenceSubject } from "@shared/seraDifferences";
import { differenceSentence, flagWords, openInUrl, openInWords, shownFlags, sourceWords } from "@shared/seraDifferenceWords";
import type { ListedDifference } from "@/lib/seraReview";

let seq = 0;
export type Over = Omit<Partial<Difference>, "subject"> & { subject?: Partial<DifferenceSubject> };

/** One difference as the route sends it, words included: the role's holders here, and the shown flags only. */
export function listed(over: Over = {}, agent = "Sera", holders?: string[]): ListedDifference {
  seq += 1;
  const pageId = over.subject?.pageId ?? `0000${seq}aaaabbbbccccddddeeee`;
  const d: Difference = {
    key: `${pageId}:name`,
    kind: "rename",
    lane: "decision",
    state: "suggestion",
    field: "name",
    sera: `Keeper ${seq}`,
    ours: `Steward ${seq}`,
    base: { value: `Steward ${seq}` },
    seraHash: "s",
    oursHash: "o",
    flags: [],
    namesAMember: false,
    autoEligible: false,
    bulkEligible: true,
    takeable: true,
    source: { pageId, editedAt: "2026-10-29T10:00:00.000Z" },
    ...over,
    subject: {
      kind: "role",
      pageId,
      ourId: `role-${seq}`,
      via: "pageId",
      name: `Steward ${seq}`,
      circleId: "c-water",
      circleName: "Water",
      ...over.subject,
    },
  };
  return {
    ...d,
    words: {
      sentence: differenceSentence(d, agent, holders ? { holders } : {}),
      flags: shownFlags(d).map((f) => flagWords(f, agent)),
      source: sourceWords(d, agent),
      open: d.source.pageId ? openInUrl("https://dashboard.example.org/ws", d.source.pageId) : null,
      openWords: openInWords(agent),
    },
  };
}

