/**
 * THE HOLDER'S DOOR, ASKED BY ANOTHER DOOR (the Saberra lane's review of #1027).
 *
 *   1. A caller may answer a refusal in its own shape (`refuse`), so Budgets keeps
 *      its 409 and its suggestion vote path; the decision and its order are the
 *      door's, unchanged.
 *   2. The gate's own answers still go out as the gate wrote them: the 409 hatch
 *      on a key the village holds is never rewritten by a caller.
 *   3. `holderStanding` and the door always agree: whenever the door would refuse,
 *      the standing is null, so a banner never offers a door that is shut. That
 *      includes an admin on a key the village holds, whom the gate refuses.
 */
import { describe, expect, it } from "vitest";
import { holderDoor, holderStanding, type HolderDoorDeps } from "./holderDoor";

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

interface World {
  user: { id: string; isAdmin?: boolean } | null;
  launched: boolean;
  holders: Record<string, string[]>;
  villageHeld?: string[];
}

/** A gate shaped like the real one for these cases: admin short-circuit off village keys, the 409 on them. */
function deps(w: World): HolderDoorDeps {
  return {
    authedUser: async () => w.user,
    getPool: () => { throw new Error("no pool in a unit test"); },
    capabilityCtx: async () => ({ villageHeld: w.villageHeld ?? [], isAdmin: !!w.user?.isAdmin }) as any,
    liveHoldersOf: async (cap: string) => w.holders[cap] ?? [],
    launchedByVote: async () => w.launched,
    guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: Record<string, unknown> }) => {
      const isHolder = (w.holders[cap] ?? []).includes(String(w.user?.id));
      const villageHolds = (w.villageHeld ?? []).includes(cap);
      if (isHolder) return true;
      if (w.user?.isAdmin && !villageHolds) return true;
      if (w.user?.isAdmin && villageHolds) {
        res.status(409).json({ error: "village_holds", needsOverride: true });
        return false;
      }
      if (refusal) res.status(refusal.status).json(refusal.body);
      else res.status(401).json({ error: "auth_required" });
      return false;
    },
  };
}

const SEATED = { "steward.veto": ["steward-1"], "role.pay": ["treasurer-1"] };
const budgetsRefusal = (res: any, r: { reason: string; holders: readonly string[] }) =>
  res.status(409).json({ error: "suggest_instead", why: r.reason, suggestPath: "/api/budgets/lines/:id/suggest", holders: r.holders.length });

describe("a caller answers the door's refusal in its own shape", () => {
  it("hands an admin's after-launch refusal to the caller, which answers it", async () => {
    const { res, out } = makeRes();
    const ok = await holderDoor({}, res, deps({ user: { id: "admin-1", isAdmin: true }, launched: true, holders: SEATED }), "role.pay", { refuse: budgetsRefusal });
    expect(ok).toBe(false);
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: "suggest_instead", why: "not-a-holder", suggestPath: "/api/budgets/lines/:id/suggest", holders: 1 });
  });

  it("hands a member with no standing to the caller too, the gate's refusal included", async () => {
    const { res, out } = makeRes();
    const ok = await holderDoor({}, res, deps({ user: { id: "member-1" }, launched: true, holders: SEATED }), "role.pay", { refuse: budgetsRefusal });
    expect(ok).toBe(false);
    expect(out.body.error).toBe("suggest_instead");
  });

  it("never rewrites the gate's 409 hatch on a key the village holds", async () => {
    const { res, out } = makeRes();
    const ok = await holderDoor({}, res, deps({ user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED, villageHeld: ["role.pay"] }), "role.pay", { refuse: budgetsRefusal });
    expect(ok).toBe(false);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("village_holds");
  });

  it("answers in its own words when no caller shape is given", async () => {
    const { res, out } = makeRes();
    await holderDoor({}, res, deps({ user: { id: "admin-1", isAdmin: true }, launched: true, holders: SEATED }), "role.pay");
    expect(out.status).toBe(403);
    expect(out.body.error).toBe("not_a_holder");
  });

  it("lets the same people through with or without a caller shape", async () => {
    for (const w of [
      { user: { id: "treasurer-1" }, launched: true, holders: SEATED },
      { user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED },
      { user: { id: "admin-1", isAdmin: true }, launched: true, holders: { "role.pay": ["treasurer-1"] } },
    ] as World[]) {
      expect(await holderDoor({}, makeRes().res, deps(w), "role.pay", { refuse: budgetsRefusal })).toBe(true);
      expect(await holderDoor({}, makeRes().res, deps(w), "role.pay")).toBe(true);
    }
  });
});

describe("the standing a page shows always agrees with the door", () => {
  const worlds: World[] = [
    { user: { id: "treasurer-1" }, launched: true, holders: SEATED },
    { user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED },
    { user: { id: "admin-1", isAdmin: true }, launched: true, holders: SEATED },
    { user: { id: "admin-1", isAdmin: true }, launched: true, holders: { "role.pay": ["treasurer-1"] } },
    { user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED, villageHeld: ["role.pay"] },
    { user: { id: "member-1" }, launched: false, holders: SEATED },
    { user: null, launched: false, holders: SEATED },
  ];
  for (const w of worlds) {
    it(`agrees for ${w.user?.id ?? "nobody"}${w.user?.isAdmin ? " (admin)" : ""}, ${w.launched ? "after" : "before"} launch${w.villageHeld ? ", village-held" : ""}`, async () => {
      const d = deps(w);
      const opens = await holderDoor({}, makeRes().res, d, "role.pay");
      const standing = await holderStanding(d, w.user, "role.pay");
      expect(standing !== null).toBe(opens);
    });
  }
});
