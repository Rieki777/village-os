/**
 * STARTER SETS: a few modules that are usually wanted together.
 *
 * Rye approved these on 2026-10-09 as a library improvement. A set is a
 * shortcut and never a tier: the library page shows it, a steward turns the
 * whole set on in one go before launch, and after launch it becomes one
 * proposal carrying every module in it.
 *
 * Only module ids that exist in `shared/modules.ts` belong here, and
 * `moduleStarterSets.test.ts` holds that line, so a renamed module fails a test
 * rather than leaving a set that quietly turns on less than it says. Core
 * modules never appear: they are always on.
 *
 * The words are platform-written and short, because the module cards already
 * say what each one does.
 */
export interface StarterSet {
  id: string;
  name: string;
  /** One line, what the set is for. */
  gloss: string;
  moduleIds: string[];
}

export const STARTER_SETS: StarterSet[] = [
  {
    id: "hosting-guests",
    name: "Hosting guests",
    gloss: "Rooms people can book, a way to take payment, and a calendar for what is on.",
    moduleIds: ["stays", "commerce", "events"],
  },
  {
    id: "village-voice",
    name: "Village voice",
    gloss: "Somewhere to talk in the open, write to each other, and keep a shared journal.",
    moduleIds: ["forum", "messaging", "journal"],
  },
  {
    id: "sharing-things",
    name: "Sharing what we own",
    gloss: "A tool library and a shared library, so things get used more than once.",
    moduleIds: ["tools", "library"],
  },
];
