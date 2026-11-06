/**
 * "ROLES THAT FIT YOUR LINES", on the last step of /profile/gene-keys.
 *
 * The step used to end in one button, "Next: see roles that fit you", that went
 * to the character select. That page reads no lines at all: it opens on the
 * first class in the cast (not the member's own), offers the seats tagged with
 * that class, and drops every full seat. Rick found his lines on 2026-10-30,
 * pressed it, and the page "really didn't do anything": the seats that suit
 * him are the ones he already holds, so they were full and left out, and
 * nothing said so.
 *
 * So the step answers here, from the lines just found:
 *
 *   - a role FITS when its circle has nobody else holding one of the member's
 *     lines (the gap "Why you" already names on the character page, read the
 *     same way through `lineThisCircleLacks`), and it fits a little more when
 *     it suits one of the member's own characters (`org_roles.archetypes`);
 *   - the roles that fit and that the member already holds are named in one
 *     sentence, "Your lines fit the roles you already hold: Builder (Rick)";
 *   - the open roles follow, best fit first, each saying why, so the step
 *     always offers something to read even when every fit is already held.
 *
 * Roles are named "Role (FirstName)" (Rye, 2026-10-30) through
 * `roleWithHolders`. Everything comes from `/api/org` via `loadOrg`, the same
 * read the character page and the wizard make, plus the member's own party.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { lineWord } from "@shared/geneKeys";
import type { GeneKeysView } from "@shared/geneKeys";
import { roleWithHolders } from "@shared/roleHolderLabel";
import { orgHolderName } from "@shared/roleSheetInputs";
import { loadOrg } from "@/components/governance/pickSources";
import { holdersByCircle, lineThisCircleLacks } from "@/components/characters/RolesThatFit";
import { readPeopleGeneKeys } from "@/lib/geneKeysApi";
import { authToken } from "@/lib/gameApi";
import { BTN_LINK, EYEBROW, HINT, TILE } from "@/components/geneKeys/ui";

/** How many open roles the step offers before "See every role". */
export const OPEN_SHOWN = 6;

export const LINES_FIT_WORDS = {
  heading: "Roles that fit your lines",
  loading: "Finding the roles.",
  failed: "The roles did not load.",
  retry: "Retry",
  held: (labels: string) => `Your lines fit the roles you already hold: ${labels}.`,
  open: "Open roles on the chart, best fit first.",
  noneOpen: "No role is open on the chart right now.",
  gap: (circle: string, line: number) => `Why you: nobody else in ${circle} holds line ${line} (${lineWord(line)}) yet.`,
  suits: (character: string) => `Why you: it suits ${character}.`,
  both: (circle: string, line: number, character: string) =>
    `Why you: nobody else in ${circle} holds line ${line} (${lineWord(line)}) yet, and it suits ${character}.`,
  openNow: "Why you: it is open now.",
  read: "Read the role",
  every: "See every role",
  characters: "Roles that fit your characters",
} as const;

export interface LineFit {
  id: string;
  /** "Builder (Rick)", the role first and its holders' first names after. */
  label: string;
  circle: string | null;
  /** A line of the member's that nobody else in the circle shows, or null. */
  gap: number | null;
  /** The name of the member's character this role suits, or null. */
  suits: string | null;
  score: number;
}

export interface LinesFitAnswer {
  /** Roles the member holds now that their lines fit, best fit first. */
  held: LineFit[];
  /** Roles still open, best fit first, those that fit nothing at the end. */
  open: LineFit[];
}

const liveHolders = (r: any): any[] => (Array.isArray(r?.holders) ? r.holders.filter((h: any) => h && !h.lapsed) : []);

/**
 * The chart, ranked for one member's lines. `characters` is the member's own
 * party as { key, name }; `people` is the shown lines of everyone in the
 * circles, by id. The member never counts as filling their own gap.
 */
export function rankForLines(
  org: { roles?: any[]; circles?: any[] } | null,
  me: string,
  mine: readonly number[],
  characters: ReadonlyArray<{ key: string; name: string }>,
  people: Record<string, GeneKeysView>,
): LinesFitAnswer {
  const roles = Array.isArray(org?.roles) ? org!.roles : [];
  const circles = Array.isArray(org?.circles) ? org!.circles : [];
  const others = holdersByCircle(org);
  for (const [id, list] of Array.from(others)) others.set(id, list.filter((u) => u !== me));
  const held: LineFit[] = [];
  const open: LineFit[] = [];
  const order = new Map<string, number>();
  roles.forEach((r, i) => {
    if (!r || r.isExample) return;
    const id = String(r.id ?? "");
    if (!id) return;
    order.set(id, (r.recruiting ? 0 : 1000) + i);
    const circleId = r.circleId ? String(r.circleId) : "";
    const circle = circles.find((c) => String(c?.id ?? "") === circleId)?.name ?? null;
    const gap = circleId ? lineThisCircleLacks(mine, others.get(circleId) ?? [], people) : null;
    const tags: string[] = Array.isArray(r.archetypes) ? r.archetypes.map(String) : [];
    const suits = characters.find((c) => tags.includes(c.key))?.name ?? null;
    const holders = liveHolders(r);
    const fit: LineFit = {
      id,
      label: roleWithHolders(String(r.name ?? id), holders.map(orgHolderName)),
      circle: circle ? String(circle) : null,
      gap: circle ? gap : null,
      suits,
      score: (circle && gap ? 2 : 0) + (suits ? 1 : 0),
    };
    if (holders.some((h) => String(h.userId ?? "") === me)) {
      if (fit.score > 0) held.push(fit);
    } else if (r.state !== "filled") open.push(fit);
  });
  const best = (a: LineFit, b: LineFit) => b.score - a.score || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  return { held: held.sort(best), open: open.sort(best) };
}

/** The "Why you" sentence for one role. Every suggestion says why (Rye, 2026-10-23). */
export function whyLine(f: LineFit): string {
  if (f.gap && f.circle && f.suits) return LINES_FIT_WORDS.both(f.circle, f.gap, f.suits);
  if (f.gap && f.circle) return LINES_FIT_WORDS.gap(f.circle, f.gap);
  if (f.suits) return LINES_FIT_WORDS.suits(f.suits);
  return LINES_FIT_WORDS.openNow;
}

const authHeaders = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** The member's own characters, named, or none when either read fails. */
async function readMyCharacters(): Promise<Array<{ key: string; name: string }>> {
  try {
    const [party, cast] = await Promise.all([
      fetch("/api/me/characters", { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/archetypes").then((r) => (r.ok ? r.json() : null)),
    ]);
    const list: any[] = Array.isArray(cast) ? cast : [];
    return (Array.isArray(party?.party) ? party.party : []).map((c: any) => {
      const key = String(c?.archetypeKey ?? "");
      return { key, name: String(list.find((a) => a?.key === key)?.name ?? key) };
    });
  } catch {
    return [];
  }
}

export default function RolesForYourLines({ me, lines }: { me: string; lines: readonly number[] }) {
  const [org, setOrg] = useState<{ roles?: any[]; circles?: any[] } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [characters, setCharacters] = useState<Array<{ key: string; name: string }>>([]);
  const [people, setPeople] = useState<Record<string, GeneKeysView>>({});

  const read = () => {
    setStatus("loading");
    void loadOrg().then((o) => {
      setOrg(o);
      setStatus(o ? "ready" : "failed");
    });
  };
  useEffect(read, []);
  useEffect(() => {
    let live = true;
    void readMyCharacters().then((c) => live && setCharacters(c));
    return () => {
      live = false;
    };
  }, [me]);

  const askIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Array.from(holdersByCircle(org).values())) for (const id of list) if (id !== me) ids.add(id);
    return Array.from(ids).sort().join(",");
  }, [org, me]);
  useEffect(() => {
    if (!askIds) return;
    let live = true;
    readPeopleGeneKeys(askIds.split(","))
      .then((p) => live && setPeople(p))
      .catch(() => live && setPeople({}));
    return () => {
      live = false;
    };
  }, [askIds]);

  const answer = useMemo(() => rankForLines(org, me, lines, characters, people), [org, me, lines, characters, people]);
  const shown = answer.open.slice(0, OPEN_SHOWN);

  return (
    <section aria-labelledby="gk-fit-h" className="flex w-full flex-col gap-3">
      <p className={EYEBROW} id="gk-fit-h">
        {LINES_FIT_WORDS.heading}
      </p>
      {status === "loading" ? (
        <p role="status" className={HINT}>
          {LINES_FIT_WORDS.loading}
        </p>
      ) : status === "failed" ? (
        <p role="status" className="text-sm text-destructive">
          {LINES_FIT_WORDS.failed}{" "}
          <button type="button" onClick={read} className={BTN_LINK}>
            {LINES_FIT_WORDS.retry}
          </button>
        </p>
      ) : (
        <>
          {answer.held.length > 0 ? <p className="text-base">{LINES_FIT_WORDS.held(answer.held.map((f) => f.label).join(", "))}</p> : null}
          <p className={HINT}>{shown.length ? LINES_FIT_WORDS.open : LINES_FIT_WORDS.noneOpen}</p>
          {shown.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {shown.map((f) => (
                <li key={f.id} className={TILE}>
                  <span className="font-medium">{f.label}</span>
                  {f.circle ? <span className="text-xs text-muted-foreground">{f.circle}</span> : null}
                  <span className="mt-1 text-sm text-muted-foreground">{whyLine(f)}</span>
                  <Link href={`/roles?seat=${encodeURIComponent(f.id)}`} className={`${BTN_LINK} text-sm`}>
                    {LINES_FIT_WORDS.read}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-x-4">
        <Link href="/roles" className={BTN_LINK}>
          {LINES_FIT_WORDS.every}
        </Link>
        <Link href="/profile/characters" className={BTN_LINK}>
          {LINES_FIT_WORDS.characters}
        </Link>
      </div>
    </section>
  );
}
