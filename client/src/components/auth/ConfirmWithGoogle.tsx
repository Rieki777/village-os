/**
 * Confirming who you are with Google, for a member who has no password.
 *
 * Leaving the village and deleting an account both ask the member to prove it
 * is them. A member who joined through Google has no password, so a password
 * box is a control they can never use. This asks the server what this member
 * confirms with (`GET /api/auth/confirm-methods`) and draws the matching
 * control. The confirmation itself is a fresh Google sign-in that returns to
 * the same screen and leaves a five-minute, single-use, HttpOnly cookie the
 * page never reads (server/lib/identityConfirm.ts). The page only learns THAT
 * it happened, from `?google_confirm=<action>` on the return address.
 *
 * A member with a password sees exactly the password box they always had.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { GoogleMark } from "./GoogleSignInButton";

export type ConfirmAction = "request-exit" | "delete-account";
export type ConfirmWith = "password" | "google" | "none";

export interface IdentityConfirmState {
  /** null until the server has answered. */
  confirmWith: ConfirmWith | null;
  /** True when Google sent the member back to this screen confirmed for this action. */
  confirmed: boolean;
  /** A sentence when the Google round trip did not finish. */
  returnError: string;
  /** Forget the confirmation on this screen, after the server spent or refused it. */
  reset(): void;
}

/** Every reason the callback sends back on this path, in words. */
const RETURN_REFUSALS: Record<string, string> = {
  cancelled: "The Google confirmation was cancelled. Nothing has changed.",
  not_linked:
    "That Google account is not the one connected to your account here. Confirm with the Google account you sign in with.",
  has_password: "Your account has a password. Confirm with your password.",
  account_unavailable: "That account cannot be confirmed right now. Nothing has changed.",
  rate_limited: "Too many attempts from this connection. Wait a few minutes and try again.",
  bad_state: "The Google confirmation took too long to finish. Start again.",
  not_configured: "Google sign-in is not set up on this village.",
};
const RETURN_FALLBACK = "The Google confirmation did not finish. Nothing has changed. Try again.";

export const CONFIRMED_WITH_GOOGLE = "Google confirmed it is you. This lasts five minutes and works once.";

export const NO_WAY_TO_CONFIRM =
  "Your account has no password, and this village has no other way to confirm it is you. Set a password, then come back.";

export function useIdentityConfirm(action: ConfirmAction): IdentityConfirmState {
  const [confirmWith, setConfirmWith] = useState<ConfirmWith | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [returnError, setReturnError] = useState("");

  useEffect(() => {
    const token = authToken();
    if (!token) return;
    let alive = true;
    fetch("/api/auth/confirm-methods", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const w = d?.confirmWith;
        // An unreadable answer draws the password box, which is what these
        // screens drew for everybody before this existed.
        setConfirmWith(w === "google" || w === "none" ? w : "password");
      })
      .catch(() => {
        if (alive) setConfirmWith("password");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const word = params.get("google_confirm");
    if (word === action) setConfirmed(true);
    else if (word === "error" && params.get("for") === action) {
      setReturnError(RETURN_REFUSALS[params.get("reason") ?? ""] ?? RETURN_FALLBACK);
    } else return;
    // Off the address bar, so a reload or a shared link does not claim a
    // confirmation the server has since spent.
    params.delete("google_confirm");
    params.delete("for");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, [action]);

  return { confirmWith, confirmed, returnError, reset: () => setConfirmed(false) };
}

/**
 * A plain anchor and a full page navigation, like the sign-in button: this
 * starts a redirect to Google, so there is nothing for the router to do.
 */
export function ConfirmWithGoogleButton({ action }: { action: ConfirmAction }) {
  // No destination is sent: the callback returns to the action's own screen.
  const href = `/api/auth/google/start?confirm=${action}`;
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground hover:shadow-md transition-shadow"
    >
      <GoogleMark />
      Confirm with Google
    </a>
  );
}

/** The control a member confirms with, in place of the bare password box. */
export function IdentityConfirmField({
  state,
  action,
  password,
  onPassword,
  placeholder,
  inputClassName,
}: {
  state: IdentityConfirmState;
  action: ConfirmAction;
  password: string;
  onPassword(value: string): void;
  placeholder: string;
  inputClassName: string;
}) {
  if (state.confirmWith === "google") {
    return state.confirmed ? (
      <p role="status" className="text-xs text-card-foreground">{CONFIRMED_WITH_GOOGLE}</p>
    ) : (
      <ConfirmWithGoogleButton action={action} />
    );
  }
  if (state.confirmWith === "none") {
    return (
      <p className="text-xs text-muted-foreground">
        {NO_WAY_TO_CONFIRM}{" "}
        <a href="/forgot-password" className="underline">
          Set a password
        </a>
      </p>
    );
  }
  return (
    <input
      type="password"
      value={password}
      onChange={(e) => onPassword(e.target.value)}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
}

/** Whether the destructive button may be pressed yet. */
export function identityReady(state: IdentityConfirmState, password: string): boolean {
  if (state.confirmWith === "google") return state.confirmed;
  if (state.confirmWith === "none") return false;
  return Boolean(password);
}

/** The body field the route reads: a password for a password member, nothing otherwise. */
export function identityBody(state: IdentityConfirmState, password: string): { password?: string } {
  return state.confirmWith === "google" || state.confirmWith === "none" ? {} : { password };
}
