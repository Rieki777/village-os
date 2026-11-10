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
import { IKIGAI_KEY, hasIkigai, ikigaiFromStored } from "@shared/roleDiscover";
import { ROLE_DRAFT_KEY, applyHrefFor, draftFromStored } from "@shared/roleDraft";
import { readsTerms } from "@/components/characters/RolesThatFit";

export default function DraftCarry({
  cast,
  roleNames,
  onPickCharacter,
  userId,
}: {
  cast: ReadonlyArray<{ key: string; name: string }>;
  /** Names the host already has. Without them, the chart is read once. */
  roleNames?: Readonly<Record<string, string>>;
  onPickCharacter: (key: string) => void;
  /** The signed-in member, so a drafted role they already applied for (or were adopted for) is not offered again. */
  userId?: string | null;
}) {
  const me = userId ?? null;
  const { t } = useLingui();
  const [draft, setDraft] = useState(() => {
    const read = readStoredJson("local", ROLE_DRAFT_KEY);
    return draftFromStored(read.status === "value" ? read.value : null);
  });
  // R-Ikigai answers kept beside the draft. They are carried the same way: in this browser, until the person clears them.
  const [ikigai, setIkigai] = useState(() => {
    const r = readStoredJson("local", IKIGAI_KEY);
    return ikigaiFromStored(r.status === "value" ? r.value : null);
  });
  const [read, setRead] = useState<Record<string, string>>({});
  /** Whether the chart was read at the terms tier: a member applies through a role application. */
  const [member, setMember] = useState(false);
  /**
   * Drafted roles this person already has an application for, by role id:
   * "adopted" or "applied". Somebody who arrives through an adopted proposal
   * was placed on those roles at sign-up (server/lib/openProposalDecide.ts,
   * placeOnRoles); offering to apply for them again would invite a duplicate
   * (role journey walk, 9 Nov).
   */
  const [already, setAlready] = useState<Record<string, "adopted" | "applied">>({});
  useEffect(() => {
    if (!me || !draft.picks.length) return;
    let live = true;
    gameFetch("/api/governance/role-applications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d || !Array.isArray(d.applications)) return;
        const out: Record<string, "adopted" | "applied"> = {};
        for (const a of d.applications) {
          if (String(a?.candidate?.id ?? "") !== String(me)) continue;
          const status = String(a?.status ?? "");
          if (status === "withdrawn" || status === "declined") continue;
          for (const seat of Array.isArray(a?.seats) ? a.seats : []) {
            const id = String(seat?.id ?? "");
            if (id && out[id] !== "adopted") out[id] = status === "adopted" ? "adopted" : "applied";
          }
        }
        setAlready(out);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me, draft.picks.length]);
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
  const hasAnswers = hasIkigai(ikigai);
  if (!draft.chars.length && !draft.picks.length && !hasAnswers) return null;

  // Only characters in the village's own cast; a stored key it does not know is dropped (red team, 9 Nov).
  const chars = draft.chars.flatMap((k) => {
    const c = cast.find((x) => x.key === k);
    return c ? [{ key: k, name: c.name }] : [];
  });
  const open = draft.picks.filter((id) => !already[id]);
  const named = open.map((id) => names[id]).filter((n): n is string => !!n);
  const propose = applyHrefFor(open, member);
  const adoptedNames = draft.picks.filter((id) => already[id] === "adopted").map((id) => names[id] ?? id).join(", ");
  const appliedNames = draft.picks.filter((id) => already[id] === "applied").map((id) => names[id] ?? id).join(", ");
  const roleList = named.join(", ");

  return (
    <section aria-labelledby="draft-carry" className="rounded-2xl border-2 border-notice bg-card p-4 text-card-foreground">
      <h2 id="draft-carry" className="font-display text-lg font-bold">{t({ message: "From your selection", context: "role draft carry" })}</h2>
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
      {hasAnswers && (
        <p className="mt-3 text-sm">
          {ikigai.carry
            ? t`Your R-Ikigai answers are saved in this browser, and the open form copies them into Why you.`
            : t`Your R-Ikigai answers are saved in this browser. Nothing has been sent.`}
        </p>
      )}
      {adoptedNames && <p className="mt-3 text-sm font-semibold">{t`Adopted, and yours from the start of next season: ${adoptedNames}.`}</p>}
      {appliedNames && <p className="mt-3 text-sm">{t`Already in your application: ${appliedNames}.`}</p>}
      {open.length > 0 && propose && (
        <div className="mt-3">
          <p className="text-sm">
            {named.length ? t`The roles you selected: ${roleList}.` : t`You selected roles before you joined.`}
          </p>
          <Link href={propose} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-teal-deep-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {member ? t`Apply for the roles you selected` : t`Apply with your selection`}
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          removeStored("local", ROLE_DRAFT_KEY);
          removeStored("local", IKIGAI_KEY);
          setDraft({ chars: [], picks: [] });
          setIkigai(ikigaiFromStored(null));
        }}
        className="mt-3 min-h-11 text-sm text-muted-foreground underline underline-offset-2"
      >
        {t({ message: "Clear my selection", context: "role draft carry" })}
      </button>
    </section>
  );
}
