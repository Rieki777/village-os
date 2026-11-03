/**
 * Night look for the admin panel.
 *
 * Off until a person turns it on, and the choice stays on this device.
 * The page root then carries `sheet-night`, the same colours as the member
 * profile. Nothing here is sent to the server.
 */
import { storedText, writeStored } from "@/lib/safeStorage";

export const ADMIN_NIGHT_KEY = "admin.night";

export function readAdminNight(): boolean {
  return storedText("local", ADMIN_NIGHT_KEY) === "1";
}

export function writeAdminNight(on: boolean): void {
  writeStored("local", ADMIN_NIGHT_KEY, on ? "1" : "0");
}

/** The class on the admin page root. Night adds the profile's sheet. */
export function adminRootClass(night: boolean): string {
  return night
    ? "admin-root sheet-night min-h-screen bg-gray-50"
    : "admin-root min-h-screen bg-gray-50";
}
