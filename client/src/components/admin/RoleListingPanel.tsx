/**
 * LISTING, for a steward (role journey PR-A): tick the roles a visitor may
 * discover and press "List only these". Every role you leave unticked is
 * unlisted, and the roles listed before are kept so the run can be put back.
 *
 * The panel draws from the org chart the tab already holds, and writes through
 * the tab's own `call`, so a refusal toasts the way every other save does.
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { LISTING_WORDS, isListed } from "@shared/roleListing";
import NotListedChip from "@/components/NotListedChip";

interface Props {
  roles: any[];
  circles: any[];
  call: (path: string, body?: any, method?: string) => Promise<any>;
  onDone: () => void;
}

export function RoleListingPanel({ roles, circles, call, onDone }: Props) {
  const { t } = useLingui();
  const real = roles.filter((r) => r && !r.isExample && r.active !== false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(real.filter((r) => isListed(r)).map((r) => String(r.id))));
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const rolesKey = real.map((r) => `${r.id}:${isListed(r) ? 1 : 0}`).join(",");
  useEffect(() => {
    setPicked(new Set(real.filter((r) => isListed(r)).map((r) => String(r.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);
  useEffect(() => {
    let live = true;
    void call("/admin/org/listing", undefined, "GET").then((d) => {
      if (live) setCanUndo(Array.isArray(d?.records) && d.records.some((x: any) => !x.undoneAt));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

  if (real.length === 0) return null;
  const circleName = new Map<string, string>(circles.map((c) => [String(c.id), String(c.name)]));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    const d = await call("/admin/org/listing/only", { ids: Array.from(picked) });
    setBusy(false);
    if (d) {
      toast.success(t`${d.listed} listed, ${d.unlisted} unlisted`);
      setCanUndo(true);
      onDone();
    }
  };
  const undo = async () => {
    setBusy(true);
    const d = await call("/admin/org/listing/undo", {});
    setBusy(false);
    if (d) {
      toast.success(t`The earlier listing is back`);
      onDone();
    }
  };

  return (
    <section aria-labelledby="role-listing-h" className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="role-listing-panel">
      <div>
        <h3 id="role-listing-h" className="font-display text-base font-bold text-foreground"><Trans>Listed roles</Trans></h3>
        <p className="text-sm text-muted-foreground">{LISTING_WORDS.listOnlyHelp}</p>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {real.map((r) => {
          const id = String(r.id);
          return (
            <li key={id}>
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} className="h-5 w-5" />
                <span className="min-w-0">
                  {r.name}
                  {r.circleId && circleName.get(String(r.circleId)) ? (
                    <span className="text-muted-foreground"> <Trans>in</Trans> {circleName.get(String(r.circleId))}</span>
                  ) : null}
                </span>
                <NotListedChip role={r} />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy || picked.size === 0}
          className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {LISTING_WORDS.listOnly}
        </button>
        {canUndo && (
          <button type="button" onClick={undo} disabled={busy} className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-foreground">
            {LISTING_WORDS.undo}
          </button>
        )}
        <span className="text-xs text-muted-foreground">{picked.size} <Trans>ticked</Trans></span>
      </div>
    </section>
  );
}
