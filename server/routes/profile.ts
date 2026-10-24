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
 * stranger with the same 401. ONE OF THEM READS EVERY MEMBER: `PUT` checks a
 * new handle against every other member's handle through `members.all()`,
 * which is a read of the whole roll, and that is why the slice is `members`
 * and not a single-row getter. This header used to say none of them read
 * another member's row, and docs/modules/profiles.md picked the sentence up as
 * current. The neighbouring /api/profile/prefs routes stay where they are:
 * they resolve notification preferences, which is a different dependency slice.
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
 *
 * THE SESSION IS ASKED AGAIN UNDER THE LOCK. Both writes check the session
 * once, then wait for the row lock, and the handle check reads every member in
 * between. A save already past its check when the member was erased, or when
 * their password was reset or their sessions revoked, took the lock after
 * that and wrote anyway: onto a tombstone, the real name and handle came back
 * and every surface that de-attributes through the join printed them again.
 * So the mutator refuses a row that is a tombstone or whose session version
 * moved, and the route answers 401, the way set-password already rechecks.
 * `server/repos/users.ts` pins a tombstone's identity for every other writer.
 */
import type { Express } from "express";
import { claimPaths } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";
import { isTombstone } from "../lib/oauthAccounts";
import { DEPARTED_HANDLE_REFUSAL, isDepartedHandle } from "../lib/profile";
// Village Comms: the one door to the email system (server/lib/commsSink.ts).
import { commsSink } from "../lib/commsSink";

type Deps = Pick<AppDeps, "authedUser" | "members" | "publicUser">;

/** A handle is 3 to 30 characters: letters, numbers, dashes, underscores. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-_]{2,29}$/;

/** The row under the lock is no longer the session's: erased, or its sessions ended since the check. */
function sessionGone(row: any, authed: any): boolean {
  return isTombstone({ email: String(row.email ?? "") }) || Number(row.tokenVersion ?? 0) !== Number(authed.tokenVersion ?? 0);
}

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
      // A member who already wears one, from before this rule, keeps saving
      // their profile with it; nobody moves onto one (server/lib/profile.ts).
      if (isDepartedHandle(wanted) && wanted !== String(authed.handle ?? "").toLowerCase()) {
        return res.status(400).json({ error: DEPARTED_HANDLE_REFUSAL });
      }
      const clash = (await members.all()).some(
        (u: any) => u.id !== authed.id && String(u.handle ?? "").toLowerCase() === wanted,
      );
      if (clash) return res.status(409).json({ error: "That handle is taken" });
    }
    const claimed = claimPaths(paths, authed.paths ?? []);
    if (!claimed.ok) return res.status(400).json({ error: claimed.error });
    // Copied BEFORE the update: the cached record can be the very object it mutates.
    const pathsBefore = new Set<string>(Array.isArray(authed.paths) ? authed.paths : []);
    let gone = false;
    const updated = await members.update(authed.id, (u: any) => {
      if ((gone = sessionGone(u, authed))) return;
      if (name) u.name = name;
      if (bio !== undefined) u.bio = bio;
      if (avatar !== undefined) u.avatar = avatar;
      if (claimed.paths !== undefined) u.paths = claimed.paths;
      if (wanted !== undefined) u.handle = wanted;
    });
    if (gone) return res.status(401).json({ error: "auth_required" });
    if (!updated) return res.status(404).json({ error: "User not found" });
    const pathsAfter = new Set<string>(Array.isArray(updated.paths) ? updated.paths : []);
    for (const pathId of Array.from(pathsAfter)) if (!pathsBefore.has(pathId)) commsSink.fire({ type: "path_joined", personKey: authed.id, userId: authed.id, pathId, source: "profile" });
    for (const pathId of Array.from(pathsBefore)) if (!pathsAfter.has(pathId)) commsSink.fire({ type: "path_left", personKey: authed.id, userId: authed.id, pathId, source: "profile" });
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
    let gone = false;
    const updated = await members.update(authed.id, (u: any) => {
      if ((gone = sessionGone(u, authed))) return;
      u.contributions = u.contributions ?? [];
      u.contributions.push(contribution);
    });
    if (gone) return res.status(401).json({ error: "auth_required" });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, contribution });
  });
}
