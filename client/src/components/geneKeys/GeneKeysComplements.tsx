/**
 * WHO COMPLEMENTS ME (Rye, 2026-10-23: "Great!"): the members whose lines fill
 * the gaps in yours, for forming a team. Opt-in on both sides, held by the
 * server (`complementsFor`): you see nobody until you show your lines and join,
 * and you see only people who did the same. Joining or leaving is one press.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { lineWord, type ComplementsAnswer, type OwnGeneKeysView } from "@shared/geneKeys";
import { changeMyGeneKeys, readComplements, GeneKeysRefusal } from "@/lib/geneKeysApi";
import { setMyGeneKeys } from "./useMyGeneKeys";
import { BTN_GOLD, BTN_LINK, EYEBROW, HINT } from "./ui";

export const COMPLEMENTS_WORDS = {
  heading: "Who complements me",
  why: "People whose lines fill the gaps in yours. A team that holds all six lines works well together.",
  join: "Join and see who complements me",
  joinHint: "You appear here for others who joined too, with your lines and profile. Leave any time.",
  hidden: "Show your lines to use this. It only lists people who show theirs.",
  none: "Nobody who complements you has joined yet. As more people join, they appear here.",
  leave: "Leave Who complements me",
  brings: (fills: number[]) => `Brings ${fills.map((l) => `line ${l} (${lineWord(l)})`).join(" and ")}`,
} as const;

export default function GeneKeysComplements({ mine }: { mine: OwnGeneKeysView }) {
  const [answer, setAnswer] = useState<ComplementsAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = `${mine.visibility}|${mine.complement}`;

  useEffect(() => {
    let live = true;
    readComplements()
      .then((a) => live && setAnswer(a))
      .catch(() => live && setAnswer(null));
    return () => {
      live = false;
    };
  }, [key]);

  const toggle = async (complement: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      setMyGeneKeys(await changeMyGeneKeys({ complement }));
    } catch (e) {
      setProblem(e instanceof GeneKeysRefusal ? e.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="gk-complements-h" className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 id="gk-complements-h" className={EYEBROW}>
        {COMPLEMENTS_WORDS.heading}
      </h3>
      <p className="text-sm text-foreground">{COMPLEMENTS_WORDS.why}</p>
      {answer?.state === "hidden" ? <p className={HINT}>{COMPLEMENTS_WORDS.hidden}</p> : null}
      {answer?.state === "not-joined" ? (
        <div className="flex flex-col items-start gap-2">
          <button type="button" className={BTN_GOLD} disabled={busy} onClick={() => toggle(true)}>
            {COMPLEMENTS_WORDS.join}
          </button>
          <p className={HINT}>{COMPLEMENTS_WORDS.joinHint}</p>
        </div>
      ) : null}
      {answer?.state === "joined" ? (
        <>
          {answer.people.length ? (
            <ul className="flex flex-col gap-2">
              {answer.people.map((p) => (
                <li key={`${p.handle ?? p.name}`} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-notice font-display text-sm text-notice">
                    {p.view.profile}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    {p.handle ? (
                      <Link href={`/profile/${encodeURIComponent(p.handle)}`} className="truncate font-medium text-foreground underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {COMPLEMENTS_WORDS.brings(p.fills)} · {p.view.type}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={HINT}>{COMPLEMENTS_WORDS.none}</p>
          )}
          <button type="button" className={`${BTN_LINK} self-start`} disabled={busy} onClick={() => toggle(false)}>
            {COMPLEMENTS_WORDS.leave}
          </button>
        </>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
