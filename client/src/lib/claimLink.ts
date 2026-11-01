/**
 * FINDING AND OPENING THE CLAIM, for a founder who has just deployed.
 *
 * The founder-path pass of 2026-11-01 found two dead ends between a fresh
 * deploy and a claimed village:
 *
 *   1. The home page never pointed at `/claim`, so a founder who opened their
 *      new village saw a welcome page and no way in.
 *   2. The claim link the server hands back is built from FRONTEND_URL. That
 *      is right for the email, which needs an absolute address, and wrong for
 *      the link on the claim page itself: before DNS points at the village the
 *      custom domain does not answer yet, and a FRONTEND_URL left at its
 *      localhost example points at nothing on a rented server. The founder is
 *      standing on an address that works, so the page links there.
 */
import { useEffect, useState } from "react";

/** The same claim path and token, on the address this browser is using right now. */
export function claimLinkHere(claimUrl: string, origin: string): string {
  try {
    const at = new URL(claimUrl, origin);
    return `${origin.replace(/\/+$/, "")}${at.pathname}${at.search}`;
  } catch {
    return claimUrl;
  }
}

let asked: Promise<boolean> | null = null;

/** Whether this village can still be claimed (`GET /api/auth/claim-status`). False when unsure. */
export function readClaimOpen(): Promise<boolean> {
  if (!asked) {
    asked = fetch("/api/auth/claim-status")
      .then((r) => (r.ok ? r.json() : { open: false }))
      .then((d) => d?.open === true)
      .catch(() => false);
  }
  return asked;
}

export function useClaimOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void readClaimOpen().then((o) => {
      if (live) setOpen(o);
    });
    return () => {
      live = false;
    };
  }, []);
  return open;
}
