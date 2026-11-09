/**
 * /pricing: the Treasurer's pricing desk, as a page of its own (quest re-price
 * Q3). Whoever holds the pay-setting power opens it here, admin or not; the
 * server refuses everyone else (`GET /api/quests/pricing-desk`, role.pay).
 */
import { useCallback } from "react";
import Layout from "@/components/Layout";
import PricingDesk from "@/components/valuation/PricingDesk";
import { gameFetch } from "@/lib/gameApi";

export default function PricingDeskPage() {
  const call = useCallback(async (path: string, body?: unknown, method = "POST") => {
    const r = await gameFetch(`/api${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) return { error: "The pricing desk is for whoever holds the pay-setting power, such as the Treasurer." };
    return data;
  }, []);
  return (
    <Layout>
      <section className="py-8 px-4">
        <PricingDesk call={call} />
      </section>
    </Layout>
  );
}
