/**
 * A member's own account record: read it, change it, add a note to it.
 *
 *   GET  /api/profile               the signed-in member's own record
 *   PUT  /api/profile               name, bio, avatar, handle, paths
 *   POST /api/profile/contribution  a journal entry the member writes
 *
 * Lifted out of server/index.ts with the handlers unchanged apart from the
 * path validation named below. `HANDLE_RE` came with them: server/index.ts
 * held it at module scope and this was its only reader.
 *
 * WHY THESE THREE TOGETHER. One subject and one audience: the account behind
 * the bearer token, answering only to itself. Every one of them refuses a
 * stranger with the same 401 and none of them reads another member's row,
 * which is what makes `members` a defensible slice here rather than a roster
 * read. The neighbouring /api/profile/prefs routes stay where they are: they
 * resolve notification preferences, which is a different dependency slice.
 *
 * REGISTERED WHERE IT WAS. `register()` is called from startServer at exactly
 * the point these routes used to occupy, because Express matches in
 * registration order.
 *
 * THE ONE BEHAVIOUR CHANGE. `PUT /api/profile` accepted any JSON at all under
 * `paths` and wrote it to the column: a string, an object, ids nothing had
 * ever defined. It now runs `claimPaths` (shared/gameConfig.ts) and answers
 * 400 for anything the village does not offer. That route is the only door a
 * member can open onto their own paths, and until the profile grew a claim
 * control nothing in the client had ever sent the field.
 */
import type { Express } from "express";
import { claimPaths } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";

type Deps = Pick<AppDeps, "authedUser" | "members" | "publicUser">;

/** A handle is 3 to 30 characters: letters, numbers, dashes, underscores. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-_]{2,29}$/;

export function register(app: Express, deps: Deps): void {
  const { authedUser, members, publicUser } = deps;

  // Auth: Get Profile
  app.get("/api/profile", async (req, res) => {
    // Through requireUser like everything else (S1): a second decode path here
    // silently bypassed the tokenVersion revocation check.
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json(publicUser(user));
  });

  // Auth: Update Profile
  app.put("/api/profile", async (req, res) => {
    const authed = await authedUser(req);
    if (!authed) return res.status(401).json({ error: "auth_required" });
    const { name, bio, avatar, paths, handle } = req.body;
    let wanted: string | undefined;
    if (handle !== undefined) {
      wanted = String(handle).toLowerCase().trim();
      if (!HANDLE_RE.test(wanted)) {
        return res.status(400).json({ error: "Handles are 3-30 characters: letters, numbers, dashes" });
      }
      const clash = (await members.all()).some(
        (u: any) => u.id !== authed.id && String(u.handle ?? "").toLowerCase() === wanted,
      );
      if (clash) return res.status(409).json({ error: "That handle is taken" });
    }
    const claimed = claimPaths(paths, authed.paths ?? []);
    if (!claimed.ok) return res.status(400).json({ error: claimed.error });
    const updated = await members.update(authed.id, (u: any) => {
      if (name) u.name = name;
      if (bio !== undefined) u.bio = bio;
      if (avatar !== undefined) u.avatar = avatar;
      if (claimed.paths !== undefined) u.paths = claimed.paths;
      if (wanted !== undefined) u.handle = wanted;
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(publicUser(updated));
  });

  // Auth: Log Contribution
  app.post("/api/profile/contribution", async (req, res) => {
    const authed = await authedUser(req);
    if (!authed) return res.status(401).json({ error: "auth_required" });
    const { type, description } = req.body;
    if (!type || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // A JOURNAL ENTRY, never a payment. This route used to add a
    // caller-supplied `recognitionEarned` straight onto the member's
    // balance: self-service minting, off-ledger, breaking the conservation
    // proof. Value only ever moves through postTransfer behind a human
    // consent gate (quest consent, gratitude send, admin mint). The note
    // itself is still worth keeping: it is the member's own record.
    const contribution = {
      id: `contrib-${Date.now()}`,
      type: String(type).slice(0, 120),
      description: String(description).slice(0, 2000),
      date: new Date().toISOString(),
    };
    const updated = await members.update(authed.id, (u: any) => {
      u.contributions = u.contributions ?? [];
      u.contributions.push(contribution);
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, contribution });
  });
}
