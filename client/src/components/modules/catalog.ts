/**
 * THE LIBRARY'S READS, in one place for both pages.
 *
 * `/modules` and `/modules/:id` read the same catalog, and since 2026-10-09
 * the catalog says how this reader sees the page (`viewer`, decided by the
 * server in server/routes/moduleLibrary.ts). Neither page looks at
 * `user.role`: a founder, a member holding the modules power and a visitor all
 * get the page the server says they get.
 *
 * Both reads re-run on the `modules:changed` window event, which every switch
 * on either page fires, so a module turned on from the detail page is shown on
 * when the reader goes back to the shelf.
 */
import { useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import type { CatalogModule } from "./ModuleCard";
import type { LibraryViewer } from "@shared/moduleSwitch";

export interface CatalogPayload {
  groups: { id: string; label: string; gloss: string }[];
  builder: { guideUrl: string; poolUrl: string };
  modules: CatalogModule[];
  /** Absent only on an older server; read through `viewerOf`. */
  viewer?: LibraryViewer;
}

const NOBODY: LibraryViewer = { mode: "visitor", launched: false, canSwitch: false, canPause: false };

export const viewerOf = (d: CatalogPayload | null | undefined): LibraryViewer => d?.viewer ?? NOBODY;

const bearer = (): Record<string, string> => {
  const tk = authToken();
  return tk ? { Authorization: `Bearer ${tk}` } : {};
};

/** Re-run `load` whenever any part of the page reports a switch. */
function useOnModulesChanged(load: () => void) {
  useEffect(() => {
    const on = () => load();
    window.addEventListener("modules:changed", on);
    return () => window.removeEventListener("modules:changed", on);
  }, [load]);
}

export function useCatalog(): { data: CatalogPayload | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    fetch("/api/modules/catalog", { headers: bearer() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setData({ ...d, modules: Array.isArray(d?.modules) ? d.modules : [] });
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => reload(), [reload]);
  useOnModulesChanged(reload);
  return { data, failed, reload };
}

/**
 * The steward's full view of every module (`/api/admin/modules`): vendor,
 * health, pricing, readiness, examples. Read only when the server said this
 * reader is a steward; anyone else would be refused and has no use for it.
 */
export function useAdminModules(enabled: boolean): { all: any[] | null; extra: any | null; reload: () => void } {
  const [all, setAll] = useState<any[] | null>(null);
  const [extra, setExtra] = useState<any | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    fetch("/api/admin/modules", { headers: bearer() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAll(Array.isArray(d.modules) ? d.modules : []);
        setExtra({ orphans: d.orphans ?? [], hypha: d.hypha ?? null });
      })
      .catch(() => {
        /* the steward panel stays quiet on a failed read */
      });
  }, [enabled]);
  useEffect(() => reload(), [reload]);
  useOnModulesChanged(reload);
  return { all, extra, reload };
}

export interface HistoryEvent {
  from: string;
  to: string;
  at: string;
  by: string | null;
  ballot: { id: string; title: string | null } | null;
}

export interface OpenProposal {
  id: string;
  title: string;
  status: string;
  ballotId: string | null;
  closesAt: string | null;
  to: string | null;
}

/** A module's history and any proposal still asking about it. Signed-in readers only. */
export function useModuleHistory(moduleId: string, enabled: boolean) {
  const [state, setState] = useState<{ events: HistoryEvent[]; openProposal: OpenProposal | null } | null>(null);
  const reload = useCallback(() => {
    if (!enabled || !moduleId) return;
    fetch(`/api/modules/${encodeURIComponent(moduleId)}/history`, { headers: bearer() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setState({ events: Array.isArray(d.events) ? d.events : [], openProposal: d.openProposal ?? null });
      })
      .catch(() => {
        /* no strip on a failed read; nothing on the page depends on it */
      });
  }, [enabled, moduleId]);
  useEffect(() => reload(), [reload]);
  useOnModulesChanged(reload);
  return { history: state, reload };
}
