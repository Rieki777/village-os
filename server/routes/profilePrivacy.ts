/**
 * A MEMBER'S OWN PRIVACY FLAGS (server/lib/profile.ts holds the flags and
 * their conservative defaults).
 *
 *   GET /api/me/privacy    every flag, resolved: an unset one reads as its default
 *   PUT /api/me/privacy    change one or more flags, e.g. { showInventory: true }
 *
 * Only real booleans for flags that exist are taken; anything else is
 * refused with 400 and nothing is written, so a typo can never quietly leave
 * a member more public than they asked. The stored blob is written whole
 * from the resolved flags, so a row that predates a flag gains its default,
 * never a guess.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { PRIVACY_DEFAULTS, resolvePrivacy, type Privacy } from "../lib/profile";
import { PRIVACY_URL } from "../../shared/profileInventory";
import { readPrivacyBlob, writePrivacyBlob } from "../repos/profileInventory";

type Deps = Pick<AppDeps, "authedUser" | "getPool">;

const FLAGS = Object.keys(PRIVACY_DEFAULTS) as Array<keyof Privacy>;

/** The flags a body sets, or a refusal. */
export function privacyChange(body: unknown): { change: Partial<Privacy> } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the settings to change, like { showInventory: true }." };
  const change: Partial<Privacy> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!FLAGS.includes(key as keyof Privacy)) return { error: `There is no privacy setting called ${key}.` };
    if (typeof value !== "boolean") return { error: `${key} is on or off: true or false.` };
    change[key as keyof Privacy] = value;
  }
  if (Object.keys(change).length === 0) return { error: "Send the settings to change, like { showInventory: true }." };
  return { change };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool } = deps;

  const stored = async (userId: string): Promise<Privacy | null> => {
    const raw = await readPrivacyBlob(getPool(), userId);
    return raw === undefined ? null : resolvePrivacy(raw);
  };

  app.get(PRIVACY_URL, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const privacy = await stored(String(user.id));
    if (!privacy) return res.status(404).json({ error: "Not found" });
    return res.json({ privacy });
  });

  app.put(PRIVACY_URL, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const asked = privacyChange(req.body);
    if ("error" in asked) return res.status(400).json({ error: asked.error });
    const now = await stored(String(user.id));
    if (!now) return res.status(404).json({ error: "Not found" });
    const next: Privacy = { ...now, ...asked.change };
    await writePrivacyBlob(getPool(), String(user.id), next);
    return res.json({ privacy: next });
  });
}
