/**
 * The Google sign-in button, as one component every sign-in surface can drop in.
 *
 * IT IS SHARED SO THE ADMIN SIGN-IN CARD CAN ADOPT IT IN ONE LINE. That card
 * lives inside client/src/pages/Admin.tsx, which another lane owns and this one
 * must not touch. The whole of the adoption is:
 *
 *     <GoogleSignInButton next="/admin" />
 *
 * plus the import. Everything else, whether the village has Google at all, the
 * destination, the wording, is decided in here.
 *
 * IT RENDERS NOTHING UNTIL IT KNOWS. A village with no Google credentials must
 * show no button, and a button that appears and then vanishes is its own small
 * lie about what the page can do. So the component holds `null` until the
 * answer arrives and returns null for both "not asked yet" and "not available".
 */
import { useEffect, useState } from "react";
import { fetchSignInMethods } from "./signInMethods";

interface Props {
  /**
   * Where to land after signing in. Server-side normalised, so an off-site
   * value is dropped.
   */
  next?: string;
  /** Override for a surface where "Sign in" reads oddly, such as a join page. */
  label?: string;
  /**
   * The invitation token from the link somebody followed. The server's start
   * route checks it, and only the invitation's id travels to Google and back.
   */
  invite?: string;
}

/**
 * Google's own mark, unmodified.
 *
 * The four hex values are Google's brand colours and are deliberately NOT
 * routed through this village's palette: the whole point of the mark is that a
 * member recognises it, and Google's brand guidelines require it unaltered.
 * This is the one place in the client where a colour should not follow the
 * founder's seed colour.
 */
export function GoogleMark() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {/* theme-ok: Google's brand mark, fixed by Google's guidelines and never re-themed by a village. */}
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h11.8c-.5 2.8-2 5.1-4.4 6.7v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.5z" />
      {/* theme-ok: Google's brand mark, fixed by Google's guidelines and never re-themed by a village. */}
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.6-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
      {/* theme-ok: Google's brand mark, fixed by Google's guidelines and never re-themed by a village. */}
      <path fill="#FBBC05" d="M11.6 28.1c-.5-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.3-5.7z" />
      {/* theme-ok: Google's brand mark, fixed by Google's guidelines and never re-themed by a village. */}
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.7c1.8-5.2 6.6-9.1 12.4-9.1z" />
    </svg>
  );
}

export default function GoogleSignInButton({ next, label, invite }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchSignInMethods().then((m) => {
      if (alive) setAvailable(m.google);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (available !== true) return null;

  const query = new URLSearchParams();
  if (next) query.set("next", next);
  if (invite) query.set("invite", invite);
  const search = query.toString();
  const href = `/api/auth/google/start${search ? `?${search}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {/*
        A plain anchor, and a full page navigation on purpose. This starts a
        redirect to Google, so there is nothing for the single-page router to
        do, and an anchor keeps the middle-click and open-in-new-tab behaviour
        a member expects from a link.
      */}
      <a
        href={href}
        className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white border border-border rounded-lg font-semibold text-foreground hover:shadow-md transition-shadow"
      >
        <GoogleMark />
        {label ?? "Continue with Google"}
      </a>
    </div>
  );
}
