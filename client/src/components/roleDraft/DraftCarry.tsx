/**
 * WHAT A NEWCOMER DRAFTED, WAITING FOR THEM AFTER SIGN-UP (role draft board,
 * 9 Nov 2026). The draft board (pages/RoleDraft.tsx) keeps `{ chars, picks }`
 * in this browser. On the character page, which is where an invitation lands
 * a new account (`/profile/characters?first=1`), this offers what they
 * picked: each character opens on the stage, where "Play this character" is
 * the one write that joins it, and the drafted roles go to Propose my roles.
 * Nothing is joined or proposed on their behalf, and Clear forgets the draft.
 *
 * Role names come from the host, which already read the chart. A drafted role
 * the host cannot name is still carried by id, so the proposal can tick it.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { gameFetch } from "@/lib/gameApi";
import { readStoredJson, removeStored } from "@/lib/safeStorage";
import { ROLE_DRAFT_KEY, applyHrefFor, draftFromStored } from "@shared/roleDraft";
import { readsTerms } from "@/components/characters/RolesThatFit";

export default function DraftCarry({
  cast,
  roleNames,
  onPickCharacter,
}: {
  cast: ReadonlyArray<{ key: string; name: string }>;
  /** Names the host already has. Without them, the chart is read once. */
  roleNames?: Readonly<Record<string, string>>;
  onPickCharacter: (key: string) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(() => {
    const read = readStoredJson("local", ROLE_DRAFT_KEY);
    return draftFromStored(read.status === "value" ? read.value : null);
  });
  const [read, setRead] = useState<Record<string, string>>({});
  /** Whether the chart was read at the terms tier: a member applies through a role application. */
  const [member, setMember] = useState(false);
  useEffect(() => {
    if (!draft.picks.length) return;
    let live = true;
    gameFetch("/api/org")
      .then((r) => (r.ok ? r.json() : null))
      .then((org) => {
        if (!live || !org || !Array.isArray(org.roles)) return;
        setMember(readsTerms(org));
        setRead(Object.fromEntries(org.roles.filter((r: any) => r && typeof r.id === "string" && typeof r.name === "string").map((r: any) => [r.id, r.name])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft.picks.length]);
  const names = roleNames ?? read;
  if (!draft.chars.length && !draft.picks.length) return null;

  // Only characters in the village's own cast; a stored key it does not know is dropped (red team, 9 Nov).
  const chars = draft.chars.flatMap((k) => {
    const c = cast.find((x) => x.key === k);
    return c ? [{ key: k, name: c.name }] : [];
  });
  const named = draft.picks.map((id) => names[id]).filter((n): n is string => !!n);
  const propose = applyHrefFor(draft.picks, member);
  const roleList = named.join(", ");

  return (
    <section aria-labelledby="draft-carry" className="rounded-2xl border-2 border-notice bg-card p-4 text-card-foreground">
      <h2 id="draft-carry" className="font-display text-lg font-bold">{t({ message: "From your draft", context: "role draft carry" })}</h2>
      {chars.length > 0 && (
        <div className="mt-2">
          <p className="text-sm">{t`The characters you picked. Show one, then choose Play this character to keep it.`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chars.map((c) => {
              const cn = c.name;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onPickCharacter(c.key)}
                  className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {t({ message: `Show ${cn}`, context: "role draft carry button" })}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {draft.picks.length > 0 && propose && (
        <div className="mt-3">
          <p className="text-sm">
            {named.length ? t`The roles you drafted: ${roleList}.` : t`You drafted roles before you joined.`}
          </p>
          <Link href={propose} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-notice px-4 text-sm font-bold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {member ? t`Apply for the roles you drafted` : t`Apply with your draft`}
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          removeStored("local", ROLE_DRAFT_KEY);
          setDraft({ chars: [], picks: [] });
        }}
        className="mt-3 min-h-11 text-sm text-muted-foreground underline underline-offset-2"
      >
        {t({ message: "Clear my draft", context: "role draft carry" })}
      </button>
    </section>
  );
}
