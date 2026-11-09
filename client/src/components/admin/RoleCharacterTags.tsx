/**
 * WHICH CHARACTERS A ROLE SUITS, in the admin org chart (role draft board,
 * Rye 9 Nov 2026: the roles that attach to each character are kept current by
 * the people who run the village, live). Until now a role's tags were only a
 * boot-time guess (server/lib/economySeed.ts) that nobody could correct, and
 * the draft board, the character page's "Roles that fit" and the map's party
 * filter all read them.
 *
 * One checkbox per character in the village's own cast (`GET /api/archetypes`),
 * saved straight to the role (`PUT /api/admin/org/roles/:id { archetypes }`).
 * Saving clears the "suggested" mark, so no later boot overwrites the choice,
 * and the route refuses a key the cast does not hold.
 *
 * LIGHT ONLY, by ruling: the admin panel is a light workspace.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLingui } from "@lingui/react/macro";

type Call = (path: string, body?: any, method?: string) => Promise<any>;

type CastMember = { key: string; name: string };

/** One read of the cast for every role row on the page, not one per row. */
let castOnce: Promise<CastMember[]> | null = null;
function readCast(): Promise<CastMember[]> {
  castOnce ??= fetch("/api/archetypes")
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? d.filter((a: any) => a && typeof a.key === "string").map((a: any) => ({ key: a.key, name: String(a.name ?? a.key) })) : []))
    .catch(() => {
      castOnce = null;
      return [];
    });
  return castOnce;
}
/** Tests start each case with a fresh read. */
export function forgetCastForTests(): void {
  castOnce = null;
}

export default function RoleCharacterTags({
  role,
  call,
  onSaved,
}: {
  role: Record<string, any>;
  call: Call;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const [cast, setCast] = useState<CastMember[]>([]);
  const start = Array.isArray(role.archetypes) ? (role.archetypes as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const [tags, setTags] = useState<string[]>(start);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readCast().then((c) => {
      if (live) setCast(c);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!cast.length) return null;
  const changed = tags.length !== start.length || tags.some((k) => !start.includes(k));
  const roleName = String(role.name ?? role.id);

  const save = async () => {
    if (!changed || busy) return;
    setBusy(true);
    try {
      const ok = await call(`/admin/org/roles/${encodeURIComponent(String(role.id))}`, { archetypes: tags }, "PUT");
      if (ok) {
        toast.success(t({ message: "Characters saved", context: "admin role characters" }));
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="mt-3 rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-xs font-medium text-gray-700">{t({ message: `Characters ${roleName} suits`, context: "admin role characters legend" })}</legend>
      <p className="text-xs text-gray-500">
        {t`Shown on the draft board, the character page and the map's party filter. Saving makes it the village's choice, so a later guess never replaces it.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {cast.map((c) => (
          <label key={c.key} className="inline-flex min-h-11 items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              className="size-4"
              checked={tags.includes(c.key)}
              onChange={() => setTags((x) => (x.includes(c.key) ? x.filter((k) => k !== c.key) : [...x, c.key]))}
            />
            {c.name}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={!changed || busy}
        onClick={() => void save()}
        className="mt-2 min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
      >
        {t({ message: "Save characters", context: "admin role characters" })}
      </button>
    </fieldset>
  );
}
