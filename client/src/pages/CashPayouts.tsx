/**
 * CASH TO PAY OUT, FOR WHOEVER HOLDS THE TREASURER'S KEY (0285, 2026-10-30).
 *
 * Rye, 2026-10-30: finance roles holding `cash.pay` reach the payout list
 * without being admins. The list itself is `CashPayoutsTab`, the same one the
 * admin panel shows; this page only gives it a door outside /admin, signed in
 * as the member. The profile's cash card links here when the member route
 * says the viewer keeps the books.
 *
 * Permission is still the server's one gate: every read and write the tab
 * makes asks `guardCapability(..., "cash.pay")`, and a member without the key
 * sees the refusal sentence the tab already renders.
 */
import Layout from "@/components/Layout";
import CashPayoutsTab from "@/components/admin/CashPayoutsTab";
import { authToken } from "@/lib/gameApi";

export default function CashPayouts() {
  const token = authToken();
  return (
    <Layout>
      <div className="mx-auto max-w-5xl px-4 py-8">
        {token ? (
          <CashPayoutsTab password={token} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Sign in to read the cash the village owes. <a href="/login" className="underline">Sign in</a>
          </p>
        )}
      </div>
    </Layout>
  );
}
