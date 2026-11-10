/**
 * /approvals: the one-tap approval inbox on its own page, built to be opened on
 * a phone (role journey L13). The component is shared with Admin.
 */
import { useCallback } from "react";
import { Trans } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import ApprovalInbox from "@/components/approvals/ApprovalInbox";
import { authToken } from "@/lib/gameApi";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";

export default function Approvals() {
  const headers = useCallback((): Record<string, string> => {
    const t = authToken();
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, []);
  // The inbox reads its list on mount, and a call that cannot succeed is not
  // made: a signed-out visitor logged a 401 in the console. Wait for the
  // session to be read, then ask only when somebody is signed in.
  const auth = useOptionalAuth();
  const signedOut = !!auth && !auth.loading && !auth.user;
  return (
    <Layout>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
        <h1 className="text-2xl font-bold text-foreground">
          <Trans context="approval inbox">Approvals</Trans>
        </h1>
        {signedOut ? (
          <p className="text-sm text-muted-foreground">
            <Trans context="approval inbox">The approval inbox is for people who steward roles here.</Trans>{" "}
            <Link href="/login" className="text-teal-deep underline">
              <Trans context="approval inbox">Sign in to see it</Trans>
            </Link>
          </p>
        ) : auth?.loading ? null : (
          <ApprovalInbox headers={headers} />
        )}
      </div>
    </Layout>
  );
}
