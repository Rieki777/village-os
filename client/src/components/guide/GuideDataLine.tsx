/**
 * WHERE YOUR WORDS GO, in one plain line (the coordinator, 2026-11-09): what
 * you type goes to the guide answering you, only to answer you; nothing you
 * type to a guide is used to choose people; and whether the journal is ever
 * shared. Shown beside every guide (MyGuide), beside each "Talk it out" and
 * "Ask Sera", and in the member's own data settings (NotifyPrefsPanel).
 *
 * The journal sentence follows JOURNAL_ON_SERA (shared/guideChoice.ts), so the
 * page can never promise one thing while the server does another: today the
 * journal never goes to the outside agent.
 */
import { useLingui } from "@lingui/react/macro";
import { JOURNAL_ON_SERA } from "@shared/guideChoice";

export function useGuideDataWords() {
  const { t } = useLingui();
  return {
    goesTo: (guide: string) =>
      t({ message: `What you type here goes to ${guide}, only to answer you.`, context: "guide data line: where a member's words go" }),
    goesToYourGuide: t({ message: "What you type goes to your guide, only to answer you.", context: "guide data line: where a member's words go, guide unnamed" }),
    neverChoose: t({ message: "Nothing you type to a guide is used to choose people for roles.", context: "guide data line: no AI in selection" }),
    journal: (outside: string) =>
      JOURNAL_ON_SERA
        ? t({ message: `Your journal goes to ${outside} only once you choose ${outside}.`, context: "guide data line: the journal, when it can go to the outside agent" })
        : t({ message: `Your journal never goes to ${outside}.`, context: "guide data line: the journal stays in the village" }),
  };
}

/** The line itself. `guide` is who answers here; `outside` names the outside agent when the village has one. */
export default function GuideDataLine({ guide, outside, className = "" }: { guide?: string | null; outside?: string | null; className?: string }) {
  const w = useGuideDataWords();
  return (
    <p className={`text-xs text-muted-foreground ${className}`} data-testid="guide-data-line">
      {guide ? w.goesTo(guide) : w.goesToYourGuide} {w.neverChoose}
      {outside ? ` ${w.journal(outside)}` : ""}
    </p>
  );
}
