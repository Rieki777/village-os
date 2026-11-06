import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken, useGameConfig } from "@/lib/gameApi";
import { LocaleProvider } from "./LocaleProvider";

/**
 * The app's language sources, wired into the provider (internal spec i18n,
 * US1, US2.4, US3).
 *
 * The member's saved choice comes from their profile (`prefs.locale`), the
 * village default from the public config (dial `village.default_locale`).
 * When a signed-in member picks a language it is saved to their profile, so it
 * follows them to every device; a visitor's stays in this browser.
 */
function saveForMember(tag: string | null): void {
  const token = authToken();
  if (!token) return;
  fetch("/api/profile/locale", {
    // save-ok: local-first. The provider has already switched the page and
    // stored the choice in this browser; the server copy only carries it to
    // another device, so a refusal costs nothing the member can see here.
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ locale: tag ?? "" }),
  }).catch(() => {});
}

export function LocaleRoot({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { user } = useAuth();
  const config = useGameConfig();
  const saved = user?.prefs?.locale ?? null;
  const villageDefault = config?.defaultLocale ?? null;
  return (
    <LocaleProvider sources={{ saved, villageDefault }} fallback={fallback} onChoose={saveForMember}>
      {children}
    </LocaleProvider>
  );
}
