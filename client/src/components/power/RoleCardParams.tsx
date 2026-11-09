/**
 * THE PARAMETERS BLOCK of the full card (role journey PR-C), drawn in the
 * card's settings section below the role. One view model
 * (shared/roleCardView.ts) feeds every host, so /roles, the circle page, the
 * map, the draft board and the profile agree.
 *
 * The public pay range sits here, below the role, because money is public but
 * not the first thing seen (20 Oct ruling). A reader of terms already has the
 * full pay in the drawer, so the range is drawn only where the drawer is not.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { roleCardView } from "@shared/roleCardView";

export default function RoleCardParams({ seat }: { seat: Record<string, any> }) {
  const { t } = useLingui();
  const view = roleCardView(seat);
  const readsTerms = "termsOffer" in seat;
  const showPay = !!view.pay && !readsTerms;
  if (view.rows.length === 0 && !showPay && !view.beingWritten) return null;
  return (
    <section aria-label={t`About this role`} className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm text-card-foreground" data-testid="role-card-params">
      {view.beingWritten && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-foreground" data-testid="being-written">
          {view.beingWrittenLine}
        </p>
      )}
      {view.rows.length > 0 && (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
          {view.rows.map((r) => (
            <div key={r.id} className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</dt>
              <dd>
                {r.lines.length === 1 ? (
                  r.lines[0]
                ) : (
                  <ul className="space-y-0.5">
                    {r.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {showPay && view.pay && (
        <div data-testid="public-pay">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Trans>What it pays</Trans></p>
          <p className="font-medium text-foreground">{view.pay.headline}</p>
          {view.pay.lines.map((l, i) => (
            <p key={i} className="text-muted-foreground">{l}</p>
          ))}
        </div>
      )}
    </section>
  );
}
