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
import { EYEBROW, H1, HINT, LEDE, LINK, WORLD } from "@/components/journey/look";

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
      <div className={`${WORLD} py-8 sm:py-12`}>
      <div className="mx-auto max-w-xl space-y-4 px-4">
        {/* Decider calm: the same quiet header as every page where people decide. */}
        <p className={EYEBROW}>
          <Trans context="approval inbox">Waiting on a person</Trans>
        </p>
        <h1 className={H1}>
          <Trans context="approval inbox">Approvals</Trans>
        </h1>
        <p className={LEDE}>
          <Trans context="approval inbox">What a connector proposed and only a person may do. Read each one before you answer it.</Trans>
        </p>
        {signedOut ? (
          <p className={HINT}>
            <Trans context="approval inbox">The approval inbox is for people who steward roles here.</Trans>{" "}
            <Link href="/login" className={LINK}>
              <Trans context="approval inbox">Sign in to see it</Trans>
            </Link>
          </p>
        ) : auth?.loading ? null : (
          <ApprovalInbox headers={headers} />
        )}
      </div>
      </div>
    </Layout>
  );
}
