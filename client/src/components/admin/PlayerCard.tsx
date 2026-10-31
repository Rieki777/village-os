import { LogOut, Trash2 } from "lucide-react";
import { StageFloorPicker } from "./StageFloorPicker";
import { useGameConfig } from "@/lib/gameApi";

/**
 * The Players roster, one card per person, plus the key that sits above it
 * (Rye, 2026-10-30: "be clear about what each section is doing").
 *
 * The old row put two unrelated things side by side with the same look: a
 * "founder" pill and a "founder" select (ACCESS, what the account may do on
 * this site), then a "Role Holder" pill and a "Grant: Role Holder" select (the
 * STAGE, where the person stands on the village's ladder). Nothing said which
 * was which, and "role" means a third thing again on the org chart. So each
 * card now has two labelled panels, each with ONE control and a sentence
 * saying what it means, and the key above the list names both planes once.
 *
 * Every sentence here is read off the server's rules, never restated from
 * memory: access from `PUT /api/admin/users/:id/role` (R90 ends the founder
 * role at launch), the ladder from `climbLadder` in server/lib/admission.ts
 * (a grant is a floor, a person's own acts can lift them past it).
 */

export type Access = "member" | "admin" | "founder";

export type LadderStage = {
  id: string;
  name: string;
  description?: string;
  rule?: { type: string };
};

export type PathOption = { id: string; label: string };

export type Player = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  role: Access;
  paths: string[];
  joinedAt: string;
  balance: number;
  stageGranted: string | null;
  stageComputed: string;
};

/** Keyed by the union, so a fourth access level cannot render an empty pill. */
const ACCESS: Record<Access, { label: string; pill: string; does: string }> = {
  member: {
    label: "Member",
    pill: "bg-gray-100 text-gray-600 border-gray-200",
    does: "Plays the village. No admin panel.",
  },
  admin: {
    label: "Admin",
    pill: "bg-violet-100 text-violet-700 border-violet-200",
    does: "Opens this admin panel: settings, content, players and stage grants.",
  },
  founder: {
    label: "Founder",
    pill: "bg-amber-100 text-amber-800 border-amber-200",
    does: "Everything an admin does, and decides who is an admin or founder.",
  },
};

const ACCESS_ORDER: Access[] = ["member", "admin", "founder"];

const accessOf = (role: string): Access => (role in ACCESS ? (role as Access) : "member");

/**
 * The ladder's name: the one the village gave it (Admin, Paths & Stages,
 * served as `ladder.title` on /api/game/config) once the config has answered.
 * Before that, or from a server too old to serve one, it is named after the
 * rung the village's paths lead to, when the ladder has one. Platform code
 * names no village's stages, so a fork without that rung gets a plain label.
 */
export function ladderLabel(stages: LadderStage[], title?: string): string {
  if (title?.trim()) return title.trim();
  const peak = stages.find((s) => s.id === "co-creator");
  return peak ? `${peak.name} path` : "Village path";
}

const isGranted = (s: LadderStage) => s.rule?.type === "granted";

/** How the person reached the stage they stand on, in one sentence. */
export function howReached(stages: LadderStage[], p: Pick<Player, "stageGranted" | "stageComputed">): string {
  const at = stages.findIndex((s) => s.id === p.stageComputed);
  const floor = p.stageGranted ? stages.findIndex((s) => s.id === p.stageGranted) : -1;
  if (floor < 0) return "Reached by their own acts.";
  const floorName = stages[floor]!.name;
  if (at > floor) return `Their own acts lifted them past the ${floorName} grant.`;
  return `Granted: ${floorName} and every stage below it.`;
}

/** The whole ladder as a row of dots: filled up to where they stand, the granted floor ringed. */
function LadderDots({ stages, at, floor }: { stages: LadderStage[]; at: number; floor: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {stages.map((s, i) => (
        <span
          key={s.id}
          title={s.name}
          className={`h-2 w-2 rounded-full ${i <= at ? "bg-teal-deep" : "bg-gray-200"} ${i === floor ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
        />
      ))}
    </div>
  );
}

/** The key above the roster: what the two panels on every card mean. */
export function PlayersKey({
  players,
  stages,
  gameStarted,
}: {
  players: Player[];
  stages: LadderStage[];
  gameStarted: boolean;
}) {
  const count = (a: Access) => players.filter((p) => accessOf(p.role) === a).length;
  const ceremony = stages.filter(isGranted);
  const ladderTitle = useGameConfig()?.ladder?.title;
  return (
    <details open className="group mb-6 rounded-2xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium text-gray-900">
        How to read this page
        <span className="text-xs font-normal text-gray-500 group-open:hidden">Show</span>
        <span className="hidden text-xs font-normal text-gray-500 group-open:inline">Hide</span>
      </summary>
      <div className="grid gap-6 border-t border-gray-100 px-5 py-4 md:grid-cols-2">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Access</h3>
          <p className="mt-1 text-sm text-gray-600">What their account may do on this site.</p>
          <ul className="mt-3 space-y-2">
            {ACCESS_ORDER.map((a) => (
              <li key={a} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${ACCESS[a].pill}`}>
                  {ACCESS[a].label} · {count(a)}
                </span>
                <span className="text-gray-700">{ACCESS[a].does}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            {gameStarted
              ? "The founder role ended when the village started its Game. Admins now set access, and nobody new can be made a founder."
              : "Until the village starts its Game, only a founder can change access. The founder role ends at launch, and admins take it over."}{" "}
            Specific powers on top of this come from Power groups.
          </p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{ladderLabel(stages, ladderTitle)}</h3>
          <p className="mt-1 text-sm text-gray-600">
            Where they stand in village life. Most stages arrive on their own from real acts. The ceremony stages are granted here.
          </p>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {stages.map((s) => (
              <li
                key={s.id}
                title={s.description}
                className={`rounded-full px-2 py-0.5 text-xs ${isGranted(s) ? "border border-amber-300 bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-600"}`}
              >
                {s.name}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            {ceremony.length > 0 && <>Outlined stages are ceremonies an admin grants. </>}
            A grant is a floor: they stand at least there, with every stage below it, and their own acts can still lift them higher.
          </p>
        </section>
      </div>
    </details>
  );
}

export function PlayerCard({
  player: p,
  stages,
  paths,
  canSetAccess,
  gameStarted,
  picked,
  onPick,
  onAccess,
  onStage,
  onSignOut,
  onDelete,
}: {
  player: Player;
  stages: LadderStage[];
  paths: PathOption[];
  canSetAccess: boolean;
  gameStarted: boolean;
  picked: boolean;
  onPick: (on: boolean) => void;
  onAccess: (role: Access) => void;
  onStage: (stageId: string | null) => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const access = accessOf(p.role);
  const ladderTitle = useGameConfig()?.ladder?.title;
  const at = stages.findIndex((s) => s.id === p.stageComputed);
  const floor = p.stageGranted ? stages.findIndex((s) => s.id === p.stageGranted) : -1;
  const walking = p.paths.map((id) => paths.find((x) => x.id === id)?.label ?? id);
  const initial = (p.name || p.email).trim().charAt(0).toUpperCase();

  return (
    <article className={`rounded-2xl border bg-white transition-colors ${picked ? "border-teal-deep/50 ring-1 ring-teal-deep/30" : "border-gray-200"}`}>
      <header className="flex items-center gap-3 px-5 pt-4">
        <input
          type="checkbox"
          aria-label={`Select ${p.name}`}
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
          className="h-5 w-5 shrink-0"
        />
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-deep/10 font-semibold text-teal-deep">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-900">
            {p.name}
            {p.handle && <span className="font-normal text-gray-500"> @{p.handle}</span>}
          </div>
          <div className="truncate text-xs text-gray-500">
            {p.email} · joined {new Date(p.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold leading-none text-gray-900">{p.balance}</div>
          <div className="text-xs text-gray-500">earned</div>
        </div>
      </header>

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Access" className="rounded-xl bg-gray-50 px-4 py-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Access</h4>
          <div className="mt-2">
            {canSetAccess ? (
              <select
                value={access}
                onChange={(e) => onAccess(e.target.value as Access)}
                aria-label={`Access for ${p.name}`}
                className="w-full max-w-[12rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-medium"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {/* Only while the role still exists, or on the row of
                    somebody who already holds it. After launch the server
                    refuses a new one, and an option that can only ever
                    produce a refusal is worse than no option. Dropping it
                    from a founder's OWN row would be worse again: the select
                    would have no option matching the value and would show
                    that person as a member. */}
                {(!gameStarted || access === "founder") && <option value="founder">Founder</option>}
              </select>
            ) : (
              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium ${ACCESS[access].pill}`}>
                {ACCESS[access].label}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-600">{ACCESS[access].does}</p>
        </section>

        <section aria-label={ladderLabel(stages, ladderTitle)} className="rounded-xl bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{ladderLabel(stages, ladderTitle)}</h4>
            <StageFloorPicker stages={stages} value={p.stageGranted} onChange={onStage} label="Change stage" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-sm text-gray-600">Now at</span>
            <span className="rounded-full bg-teal-deep/10 px-2.5 py-0.5 text-sm font-semibold text-teal-deep">
              {stages[at]?.name ?? p.stageComputed}
            </span>
            {at >= 0 && <LadderDots stages={stages} at={at} floor={floor} />}
          </div>
          <p className="mt-2 text-xs text-gray-600">{howReached(stages, p)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {walking.length > 0 ? <>Paths they chose: {walking.join(", ")}</> : "No path chosen yet."}
          </p>
        </section>
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-2.5">
        <button
          type="button"
          onClick={onSignOut}
          title="Ends every session and agent token. Their password keeps working."
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out everywhere
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete account
        </button>
      </footer>
    </article>
  );
}
