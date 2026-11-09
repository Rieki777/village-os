/**
 * The pricing desk inside the admin panel (quest re-price Q3), beside the
 * other books a treasurer keeps. The same desk a Treasurer opens at /pricing;
 * the server holds both to the pay-setting power.
 */
import { lazy, Suspense } from "react";
import { Trans } from "@lingui/react/macro";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

const PricingDesk = lazy(() => import("@/components/valuation/PricingDesk"));

export default function PricingDeskTab({ password }: { password: string }) {
  const call = async (path: string, body?: unknown, method = "POST") => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ...d, error: refusal(d, "That did not save") };
    return d;
  };
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground"><Trans context="pricing desk">Opening the pricing desk…</Trans></p>}>
      <PricingDesk call={call} />
      <p className="mt-4 text-sm"><a className="underline font-semibold text-emerald-800" href="/pricing"><Trans context="pricing desk">Open the desk as its own page, for a Treasurer who is not an admin</Trans></a></p>
    </Suspense>
  );
}
