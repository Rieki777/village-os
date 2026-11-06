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
 *
 * Signed out or signed in, the tab renders the page's h1 and its sign-in
 * prompt (E7, 2026-10-31), so there is one wording of each, not two.
 */
import Layout from "@/components/Layout";
import CashPayoutsTab from "@/components/admin/CashPayoutsTab";
import { authToken } from "@/lib/gameApi";

export default function CashPayouts() {
  return (
    <Layout>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <CashPayoutsTab password={authToken() ?? ""} asPage />
      </div>
    </Layout>
  );
}
