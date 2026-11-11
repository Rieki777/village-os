/**
 * WHICH CHARACTERS A ROLE SUITS, in the admin org chart (role draft board,
 * Rye 9 Nov 2026: the roles that attach to each character are kept current by
 * the people who run the village, live). Until now a role's tags were only a
 * boot-time guess (server/lib/economySeed.ts) that nobody could correct, and
 * the draft board, the character page's "Roles that fit" and the map's party
 * filter all read them.
 *
 * The roots kit's `RootPicker` (one to three of the village's own roots, read
 * from `GET /api/archetypes`), saved straight to the role (`PUT /api/admin/org/roles/:id { archetypes }`).
 * Saving clears the "suggested" mark, so no later boot overwrites the choice,
 * and the route refuses a key the cast does not hold.
 *
 * LIGHT ONLY, by ruling: the admin panel is a light workspace.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useLingui } from "@lingui/react/macro";
import RootPicker from "@/components/roots/RootPicker";
import { forgetRootCast, useRootCast } from "@/components/roots/rootCast";

type Call = (path: string, body?: any, method?: string) => Promise<any>;

/** Tests start each case with a fresh read of the cast. */
export function forgetCastForTests(): void {
  forgetRootCast();
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
  const start = Array.isArray(role.archetypes) ? (role.archetypes as unknown[]).filter((k): k is string => typeof k === "string") : [];
  const [tags, setTags] = useState<string[]>(start);
  const [busy, setBusy] = useState(false);
  // Nothing to pick from until the cast arrives, so nothing (not even a dead save) is drawn.
  const cast = useRootCast();
  if (!cast.length) return null;

  const changed = tags.length !== start.length || tags.some((k) => !start.includes(k));

  const save = async () => {
    if (!changed || busy) return;
    setBusy(true);
    try {
      const ok = await call(`/admin/org/roles/${encodeURIComponent(String(role.id))}`, { archetypes: tags }, "PUT");
      if (ok) {
        toast.success(t({ message: "Roots saved", context: "admin role roots" }));
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border p-3" data-role-roots={String(role.id)}>
      <RootPicker value={tags} onChange={setTags} />
      <button
        type="button"
        disabled={!changed || busy}
        onClick={() => void save()}
        className="mt-2 min-h-11 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
      >
        {t({ message: "Save roots", context: "admin role roots" })}
      </button>
    </div>
  );
}
