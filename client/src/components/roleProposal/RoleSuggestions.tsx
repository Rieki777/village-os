/**
 * After "In your words": about three roles ranked from those answers.
 *
 * The list draws only when a guide can answer. With no guide configured it
 * stays empty, and the member picks by hand. A tap selects the role. It
 * does not write the member's words. Holders are not on this list: the
 * shared step never mounts it, and a card shows the role and the sentence.
 */
import { useEffect, useState } from "react";
import { fetchGuide } from "@/lib/guideApi";
import { suggestRoles, type OwnAnswers, type SuggestRoleIn } from "@shared/roleSuggestions";
import { RP_WORDS } from "./proposalWords";
import { FOCUS, PANEL } from "./parts";

export function RoleSuggestions({
  answers,
  roles,
  picked,
  atMost,
  onToggle,
}: {
  answers: OwnAnswers;
  roles: readonly SuggestRoleIn[];
  picked: readonly string[];
  atMost: boolean;
  onToggle: (roleId: string) => void;
}) {
  const [guideOn, setGuideOn] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchGuide().then((g) => {
      if (alive) setGuideOn(!!g?.answering);
    });
    return () => {
      alive = false;
    };
  }, []);

  const list = guideOn ? suggestRoles(answers, roles) : [];
  if (list.length === 0) return null;

  return (
    <section className={`${PANEL} grid gap-2`} aria-labelledby="rp-suggested-roles" data-role-suggestions="">
      <h3 id="rp-suggested-roles" className="font-semibold text-foreground">
        {RP_WORDS.suggestionsHeading}
      </h3>
      <ul className="grid gap-2">
        {list.map((s) => {
          const on = picked.includes(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && atMost}
                onClick={() => onToggle(s.id)}
                className={`flex min-h-[44px] w-full max-w-full flex-col items-start gap-1 rounded-lg border p-3 text-left ${FOCUS} ${
                  on ? "border-dash-gold bg-dash-gold/10" : "border-border bg-card hover:bg-muted"
                }`}
                data-suggested-role={s.id}
              >
                <span className="flex max-w-full flex-wrap items-center gap-2">
                  <span className="rounded-full bg-dash-gold/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-dash-gold-lit">
                    {RP_WORDS.suggested}
                  </span>
                  <span className="break-words font-semibold text-foreground">{s.name}</span>
                </span>
                <span className="break-words text-sm text-muted-foreground">
                  {RP_WORDS.fromYourWords} <q>{s.source}</q>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
