/**
 * Which door, if any, the reader has to edit roles: "power", "admin" or none.
 * One read for every card on the page, kept for the page's life and forgotten
 * when the token changes. A signed-out reader asks nothing.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { readAccess } from "./roleEditApi";

type Door = "power" | "admin" | null;
let cached: { token: string; ask: Promise<Door> } | null = null;

function ask(token: string): Promise<Door> {
  if (cached?.token === token) return cached.ask;
  const ask = readAccess().then((r) => (r.ok ? r.data.door : null), () => null);
  cached = { token, ask };
  return ask;
}

/** For tests: the next read asks the server again. */
export function forgetEditAccess(): void {
  cached = null;
}

export function useEditAccess(): Door {
  const token = authToken();
  const [door, setDoor] = useState<Door>(null);
  useEffect(() => {
    let live = true;
    if (!token) {
      setDoor(null);
      return;
    }
    void ask(token).then((d) => live && setDoor(d));
    return () => {
      live = false;
    };
  }, [token]);
  return door;
}
