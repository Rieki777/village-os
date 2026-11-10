/** Which characters a role suits, as checkboxes in the editor. Saved with the rest, by the person's save. */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { PANEL } from "@/components/roleProposal/parts";

type Cast = { key: string; name: string };

let castOnce: Promise<Cast[]> | null = null;
function readCast(): Promise<Cast[]> {
  castOnce ??= fetch("/api/archetypes")
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => (Array.isArray(d) ? d.filter((a: any) => a && typeof a.key === "string").map((a: any) => ({ key: a.key, name: String(a.name ?? a.key) })) : []))
    .catch(() => {
      castOnce = null;
      return [];
    });
  return castOnce;
}

export default function CharacterTags({ value, onChange, changed }: { value: string[]; onChange: (v: string[]) => void; changed: boolean }) {
  const [cast, setCast] = useState<Cast[]>([]);
  useEffect(() => {
    let live = true;
    void readCast().then((c) => live && setCast(c));
    return () => {
      live = false;
    };
  }, []);
  if (!cast.length) return null;
  return (
    <section className={`${PANEL} space-y-2 ${changed ? "border-dash-gold" : ""}`} aria-labelledby="re-chars" data-changed={changed ? "true" : "false"}>
      <h3 id="re-chars" className="font-display text-lg"><Trans context="role editor characters">Characters it suits</Trans></h3>
      <div className="flex flex-wrap gap-x-4">
        {cast.map((c) => (
          <label key={c.key} className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="size-5 accent-dash-gold" checked={value.includes(c.key)} onChange={(e) => onChange(e.target.checked ? [...value, c.key] : value.filter((k) => k !== c.key))} />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
