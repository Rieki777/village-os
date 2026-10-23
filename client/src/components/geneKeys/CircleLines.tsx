/**
 * A CIRCLE'S SIX LINES: who holds each, and where the gaps are.
 *
 * Rye, 2026-10-22: "the circle view is great". Each person carries two lines
 * (their profile, say 2/5), so a circle's members together cover some of the
 * six. The words are the Life's Work six, the same ones on every seal.
 *
 * A GAP IS AN INVITATION, NEVER A DEFICIT, and it is common: the six common
 * profiles pair odd lines with odd and even with even, so a random team of
 * three covers all six only about 2% of the time, and of six people about half
 * the time. The open line says so plainly and points at the circle, never at a
 * person.
 *
 * Only members who show their lines are counted. Everyone else in the circle is
 * one number, "1 member keeps their lines private", so a hidden result can never
 * be inferred from who is missing. Nothing renders while the module is off or
 * before anybody in the circle has saved lines.
 */
import { useEffect, useState } from "react";
import { lineWord, type GeneKeysView } from "@shared/geneKeys";
import { useModuleOn } from "@/modules/ModuleProvider";
import { readPeopleGeneKeys } from "@/lib/geneKeysApi";
import { EYEBROW, HINT } from "./ui";

export interface CircleHolder {
  id: string;
  name: string;
}

const TYPE_PLURAL: Record<string, string> = {
  Generator: "Generators",
  "Manifesting Generator": "Manifesting Generators",
  Projector: "Projectors",
  Manifestor: "Manifestors",
  Reflector: "Reflectors",
};

export default function CircleLines({ holders }: { holders: CircleHolder[] }) {
  const on = useModuleOn("gene_keys");
  const [people, setPeople] = useState<Record<string, GeneKeysView> | null>(null);
  const key = holders.map((h) => h.id).sort().join(",");

  useEffect(() => {
    if (!on || !key) return;
    let live = true;
    readPeopleGeneKeys(key.split(","))
      .then((p) => live && setPeople(p))
      .catch(() => live && setPeople({}));
    return () => {
      live = false;
    };
  }, [on, key]);

  if (!on || !people) return null;
  const shown = holders.filter((h) => people[h.id]);
  if (!shown.length) return null;
  const hidden = holders.length - shown.length;

  const byLine = new Map<number, CircleHolder[]>();
  for (const h of shown) {
    for (const line of Array.from(new Set(people[h.id].lines))) {
      byLine.set(line, [...(byLine.get(line) ?? []), h]);
    }
  }
  const held = [1, 2, 3, 4, 5, 6].filter((n) => byLine.has(n)).length;
  const types = new Map<string, number>();
  for (const h of shown) types.set(people[h.id].type, (types.get(people[h.id].type) ?? 0) + 1);
  const sleepers = shown.filter((h) => people[h.id].authority === "Emotional").length;

  return (
    <section aria-label="This circle's six lines" className="sheet-night rounded-2xl border border-border bg-card p-5 text-card-foreground">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h4 className="font-display text-2xl text-foreground">Our six lines</h4>
        <p className={HINT}>
          {held} of 6 lines held{hidden > 0 ? ` · ${hidden} member${hidden === 1 ? " keeps their" : "s keep their"} lines private` : ""}
        </p>
      </div>
      <ol className="mt-3 flex flex-col-reverse">
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const who = byLine.get(n) ?? [];
          return (
            <li key={n} className="flex flex-wrap items-center gap-3 border-b border-border py-3 first:border-b-0">
              <span
                aria-hidden="true"
                className={`h-2.5 w-14 shrink-0 rounded-sm ${who.length ? "bg-foreground" : "border-[1.5px] border-dashed border-notice"}`}
              />
              <span className="w-36 shrink-0 font-display text-xl text-foreground">
                {n} · {lineWord(n)}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {who.length ? (
                  who.map((h) => (
                    <span key={h.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted py-1 pl-1 pr-3 text-sm">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-notice font-display text-sm">
                        {h.name.slice(0, 1)}
                      </span>
                      {h.name} <span className="text-muted-foreground">{people[h.id].profile}</span>
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border-[1.5px] border-dashed border-notice px-3 py-1 text-sm text-notice">
                    Open · who will hold it?
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={`${HINT} mt-3`}>Lines read from the bottom up. A gap is an invitation for the circle to talk about who might hold it.</p>
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-muted p-4 text-sm">
        <p className={EYEBROW}>How this circle works best</p>
        <p className="text-foreground">
          {Array.from(types.entries())
            .map(([t, c]) => `${c} ${c === 1 ? t : TYPE_PLURAL[t] ?? t}`)
            .join(" · ")}
        </p>
        {types.has("Generator") || types.has("Manifesting Generator") ? (
          <p className="text-foreground">
            <span className="font-semibold text-notice">Bring options.</span> Generators do their best work responding to a clear offer.
          </p>
        ) : null}
        {types.has("Projector") ? (
          <p className="text-foreground">
            <span className="font-semibold text-notice">Invite by name.</span> Projectors land best when someone asks for their gift.
          </p>
        ) : null}
        {types.has("Manifestor") ? (
          <p className="text-foreground">
            <span className="font-semibold text-notice">Expect a heads up.</span> Manifestors start things and tell the circle first.
          </p>
        ) : null}
        {sleepers > 1 ? (
          <p className="text-foreground">
            <span className="font-semibold text-notice">Leave big choices open overnight.</span> {sleepers} of you sleep on them.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">Type and authority come from Human Design.</p>
      </div>
    </section>
  );
}
