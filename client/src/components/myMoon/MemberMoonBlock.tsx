/**
 * THIS MOON, on another member's profile: their SENT recap as
 * `GET /api/members/:handle/moon` reads it (`memberView`). Kept items marked
 * Members, grouped by role, and "1 item held privately" where others sit.
 * The response has no field for an amount, a route, an invoice, a review
 * note, a suggestion or a score, so none can show here.
 *
 * An off module, an unsent recap or an empty one draws nothing at all.
 */
import { useEffect, useState } from "react";
import { MOON_WORDS, heldPrivatelyWords, type MemberMoonResponse } from "@shared/moonRecap";
import * as api from "./moonApi";

export function MemberMoonView({ data }: { data: MemberMoonResponse }) {
  if (data.roles.length === 0) return null;
  return (
    <section aria-label={MOON_WORDS.thisMoon} className="mt-10 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground" data-testid="member-moon">
      <div>
        <h2 className="m-0 text-xl font-semibold text-foreground">{MOON_WORDS.thisMoon}</h2>
        <p className="m-0 text-sm text-muted-foreground">{data.moon.periodWords}</p>
      </div>
      {data.roles.map((r) => (
        <div key={r.roleId ?? "outside"} className="flex flex-col gap-1">
          <h3 className="m-0 text-base font-semibold text-foreground">{r.name}</h3>
          {r.items.length > 0 ? (
            <ul className="m-0 list-disc pl-5 text-sm text-foreground">
              {r.items.map((i) => (
                <li key={i.id}>
                  {i.evidenceUrl ? <a href={i.evidenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{i.text}</a> : i.text}
                </li>
              ))}
            </ul>
          ) : null}
          {r.heldPrivately > 0 ? <p className="m-0 text-sm text-muted-foreground">{heldPrivatelyWords(r.heldPrivately)}</p> : null}
        </div>
      ))}
    </section>
  );
}

export default function MemberMoonBlock({ handle }: { handle: string }) {
  const [data, setData] = useState<MemberMoonResponse | null>(null);
  useEffect(() => {
    let live = true;
    void api.fetchMemberMoon(handle).then((r) => live && setData(r.ok && Array.isArray(r.data?.roles) && r.data.moon ? r.data : null));
    return () => { live = false; };
  }, [handle]);
  return data ? <MemberMoonView data={data} /> : null;
}
