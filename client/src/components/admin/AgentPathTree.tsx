/**
 * The agent paths as a collapsible tree (the lead, 11 Nov 2026: "tree those 72+ paths so it's easier to understand
 * and see and not a massive list"). Grouped by the area each path reaches (agentPathGroups.ts), each group with its
 * count and how many are reads and writes, each path with its method, what it is for, the path and who confirms.
 * The list itself stays in AgentsPanel: this only shows it, and every change goes back through `onSet` and
 * `onRemove`, so Save, Add a path and Paste a list work as before.
 *
 * Light-only, like the rest of the admin tabs.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { groupAgentPaths, type PathGroup } from "./agentPathGroups";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface PathEntry { method: Method; path: string; confirm: "agent" | "person"; label: string }

const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const field = "w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground";
const button = "min-h-9 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function PathTree({
  draft,
  fresh,
  editing,
  onEdit,
  onDone,
  onSet,
  onRemove,
}: {
  draft: PathEntry[];
  fresh: ReadonlySet<number>;
  editing: ReadonlySet<number>;
  onEdit: (i: number) => void;
  onDone: (i: number) => void;
  onSet: (i: number, patch: Partial<PathEntry>) => void;
  onRemove: (i: number) => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(["new"]));

  const GROUP_WORDS: Record<PathGroup | "new", string> = {
    new: t({ message: "New, not saved yet", context: "agent paths, a group" }),
    pages: t({ message: "Pages content", context: "agent paths, a group" }),
    faqs: t({ message: "FAQs", context: "agent paths, a group" }),
    circles: t({ message: "Circles", context: "agent paths, a group" }),
    roles: t({ message: "Roles and org chart", context: "agent paths, a group" }),
    seasons: t({ message: "Seasons and moons", context: "agent paths, a group" }),
    onboarding: t({ message: "Onboarding", context: "agent paths, a group" }),
    map: t({ message: "Map", context: "agent paths, a group" }),
    events: t({ message: "Events", context: "agent paths, a group" }),
    quests: t({ message: "Quests", context: "agent paths, a group" }),
    connector: t({ message: "Connector and settings", context: "agent paths, a group" }),
    other: t({ message: "Other", context: "agent paths, a group" }),
  };

  const groups = useMemo(
    () => groupAgentPaths(draft, { query, fresh, groupWords: (g) => GROUP_WORDS[g] }),
    // GROUP_WORDS follows the locale, which `t` carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, query, fresh, t],
  );
  const searching = query.trim() !== "";
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const isOpen = (g: string) => searching || open.has(g);
  const toggle = (g: string) =>
    setOpen((all) => {
      const next = new Set(all);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm text-foreground">
          <Trans context="agent paths">Search the paths</Trans>
          <input
            type="search"
            className={`${field} mt-1`}
            value={query}
            placeholder={t({ message: "A word, a path or GET", context: "agent paths, search hint" })}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className={button} onClick={() => setOpen(new Set(["new", ...groups.map((g) => g.group)]))}>
          <Trans context="agent paths">Open all</Trans>
        </button>
        <button type="button" className={button} onClick={() => setOpen(new Set())}>
          <Trans context="agent paths">Close all</Trans>
        </button>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {searching ? (
          <Trans context="agent paths">{shown} of {draft.length} paths match</Trans>
        ) : (
          <Trans context="agent paths">{draft.length} paths in {groups.length} groups</Trans>
        )}
      </p>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {searching ? <Trans context="agent paths">No path matches that search.</Trans> : <Trans context="agent paths">No paths are open to agents yet.</Trans>}
        </p>
      )}
      <ul className="space-y-2" aria-label={t({ message: "Agent paths by area", context: "agent paths" })}>
        {groups.map((g) => {
          const id = `agent-paths-${g.group}`;
          const expanded = isOpen(g.group);
          const count = g.items.length;
          const reads = g.reads;
          const writes = g.writes;
          const byPerson = g.byPerson;
          return (
            <li key={g.group} className="rounded-lg border border-border bg-card">
              <button
                type="button"
                className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
                aria-controls={id}
                onClick={() => toggle(g.group)}
              >
                {expanded ? <ChevronDown aria-hidden className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />}
                <span className="text-sm font-semibold text-foreground">{GROUP_WORDS[g.group]}</span>
                <span className="rounded-full border border-border px-2 text-xs text-foreground">{count}</span>
                <span className="text-xs text-muted-foreground">
                  <Trans context="agent paths, a group's summary">{reads} read, {writes} write</Trans>
                  {byPerson > 0 && (
                    <>
                      {", "}
                      <Trans context="agent paths, a group's summary">{byPerson} a person confirms</Trans>
                    </>
                  )}
                </span>
              </button>
              {expanded && (
                <ul id={id} className="divide-y divide-border border-t border-border">
                  {g.items.map(({ entry: e, index: i }) => (
                    <li key={i} className="px-3 py-2">
                      {editing.has(i) ? (
                        <div className="grid gap-2 sm:grid-cols-[6rem_2fr_7rem_2fr_auto_auto]">
                          <select aria-label={t({ message: "Method", context: "agent paths" })} className={field} value={e.method} onChange={(x) => onSet(i, { method: x.target.value as Method })}>
                            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <input aria-label={t({ message: "Path", context: "agent paths" })} className={field} value={e.path} onChange={(x) => onSet(i, { path: x.target.value })} />
                          <select aria-label={t({ message: "Who confirms", context: "agent paths" })} className={field} value={e.confirm} onChange={(x) => onSet(i, { confirm: x.target.value as "agent" | "person" })}>
                            <option value="agent">{t({ message: "The agent", context: "agent paths, who confirms" })}</option>
                            <option value="person">{t({ message: "A person", context: "agent paths, who confirms" })}</option>
                          </select>
                          <input aria-label={t({ message: "What it is for", context: "agent paths" })} className={field} value={e.label} onChange={(x) => onSet(i, { label: x.target.value })} />
                          <button type="button" className={button} onClick={() => onDone(i)}><Trans context="agent paths, close a path's editor">Done</Trans></button>
                          <button type="button" className={button} onClick={() => onRemove(i)}><Trans context="agent paths">Remove</Trans></button>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 min-w-16 shrink-0 whitespace-nowrap rounded-full border border-border px-2 text-center text-xs font-semibold ${e.method === "GET" ? "text-muted-foreground" : "text-foreground"}`}>{e.method}</span>
                          <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-foreground">{e.label || <span className="text-muted-foreground"><Trans context="agent paths">No words yet</Trans></span>}</p>
                              <p className="break-all text-xs text-muted-foreground">{e.path}</p>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-0 sm:shrink-0">
                              <span className="w-full text-xs text-muted-foreground sm:w-auto">
                                {e.method === "GET" ? (
                                  <Trans context="agent paths, a read">Read</Trans>
                                ) : e.confirm === "agent" ? (
                                  <Trans context="agent paths">The agent confirms</Trans>
                                ) : (
                                  <Trans context="agent paths">A person confirms</Trans>
                                )}
                              </span>
                              <button type="button" className={button} aria-label={t({ message: `Change ${e.method} ${e.path}`, context: "agent paths" })} onClick={() => onEdit(i)}>
                                <Trans context="agent paths, open a path's editor">Change</Trans>
                              </button>
                              <button type="button" className={button} aria-label={t({ message: `Remove ${e.method} ${e.path}`, context: "agent paths" })} onClick={() => onRemove(i)}>
                                <Trans context="agent paths">Remove</Trans>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
