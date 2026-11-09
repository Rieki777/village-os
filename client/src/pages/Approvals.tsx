/**
 * /approvals: the one-tap approval inbox on its own page, built to be opened on
 * a phone (role journey L13). The component is shared with Admin.
 */
import { useCallback } from "react";
import { Trans } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import ApprovalInbox from "@/components/approvals/ApprovalInbox";
import { authToken } from "@/lib/gameApi";

export default function Approvals() {
  const headers = useCallback((): Record<string, string> => {
    const t = authToken();
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, []);
  return (
    <Layout>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
        <h1 className="text-2xl font-bold text-foreground">
          <Trans>Approvals</Trans>
        </h1>
        <ApprovalInbox headers={headers} />
      </div>
    </Layout>
  );
}
