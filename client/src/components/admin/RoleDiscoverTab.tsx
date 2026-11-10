/**
 * THE DISCOVER MAPPING, in Admin (role journey, lane L3, decision D26).
 *
 * Which characters a Human Design type or a Gene Keys profile line points a
 * newcomer toward on the role draft board. The village sets it; the platform
 * ships none, so a village that saves nothing here gets no suggestions. Saved
 * through PUT /api/governance/role-discover/mapping, which asks for the power
 * `org.decide` and refuses everybody else.
 *
 * The mapping holds no person's data: it is a table of types and lines to
 * characters, and what a person's own type is stays in their browser.
 */
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { HD_TYPES } from "@shared/geneKeys";
import { EMPTY_MAPPING, parseMapping, type DiscoverMapping } from "@shared/roleDiscover";

const URL_ = `${API_BASE}/governance/role-discover/mapping`;
const LINES = ["1", "2", "3", "4", "5", "6"] as const;

type Group = "humanDesign" | "lines";

export default function RoleDiscoverTab({ password }: { password: string }) {
  const { t } = useLingui();
  const [cast, setCast] = useState<Array<{ key: string; name: string }>>([]);
  const [mapping, setMapping] = useState<DiscoverMapping>(EMPTY_MAPPING);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/archetypes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => live && Array.isArray(d) && setCast(d.filter((a: any) => a && typeof a.key === "string").map((a: any) => ({ key: a.key, name: String(a.name ?? a.key) }))))
      .catch(() => {});
    fetch(URL_)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setMapping(parseMapping(d?.mapping)))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = (group: Group, row: string, key: string) =>
    setMapping((m) => {
      const have = m[group][row] ?? [];
      const next = have.includes(key) ? have.filter((k) => k !== key) : [...have, key];
      const table = { ...m[group] };
      if (next.length) table[row] = next;
      else delete table[row];
      return { ...m, [group]: table };
    });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(URL_, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mapping }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(refusal(body, t`That did not save.`));
        return;
      }
      setMapping(parseMapping(body?.mapping));
      toast.success(t`Saved. The role draft board now uses this.`);
    } catch {
      toast.error(t`That did not save.`);
    } finally {
      setSaving(false);
    }
  };

  const table = (group: Group, rows: readonly string[], label: (r: string) => string) => (
    <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((row) => (
        <fieldset key={row} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
          <legend className="sr-only">{label(row)}</legend>
          <span className="w-44 text-sm font-semibold text-foreground" aria-hidden="true">{label(row)}</span>
          {cast.map((c) => (
            <label key={c.key} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="size-4" checked={(mapping[group][row] ?? []).includes(c.key)} onChange={() => toggle(group, row, c.key)} />
              {c.name}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h2 className="font-display text-2xl font-bold text-foreground">{t`Human Design and Gene Keys on the role draft board`}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t`Choose which characters a type or a profile line points a newcomer toward. They see these as suggestions they can add or ignore. Their own chart stays in their browser and is never sent. Leave everything unticked and the board suggests nothing.`}
        </p>
      </header>
      {!loaded ? (
        <p className="text-sm text-muted-foreground">{t({ message: "Loading…", context: "role discover admin" })}</p>
      ) : cast.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t`This village has no characters yet, so there is nothing to point toward.`}</p>
      ) : (
        <>
          <section aria-labelledby="rd-types">
            <h3 id="rd-types" className="font-display text-lg font-bold text-foreground">{t({ message: "Human Design types", context: "role discover admin" })}</h3>
            {table("humanDesign", HD_TYPES, (r) => r)}
          </section>
          <section aria-labelledby="rd-lines">
            <h3 id="rd-lines" className="font-display text-lg font-bold text-foreground">{t({ message: "Profile lines", context: "role discover admin" })}</h3>
            {table("lines", LINES, (r) => t({ message: `Line ${r}`, context: "role discover admin" }))}
          </section>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="min-h-11 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      )}
    </div>
  );
}
