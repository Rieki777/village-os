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
  /** Warning-badge denies the actor carries. */
  denies?: string[];
}

/** A gate shaped like the real one for these cases: admin short-circuit off village keys, the 409 on them. */
function deps(w: World): HolderDoorDeps {
  return {
    authedUser: async () => w.user,
    getPool: () => { throw new Error("no pool in a unit test"); },
    capabilityCtx: async () => ({ villageHeld: w.villageHeld ?? [], isAdmin: !!w.user?.isAdmin, badgeDenies: w.denies ?? [] }) as any,
    liveHoldersOf: async (cap: string) => w.holders[cap] ?? [],
    launchedByVote: async () => w.launched,
    guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: Record<string, unknown> }) => {
      const isHolder = (w.holders[cap] ?? []).includes(String(w.user?.id));
      const villageHolds = (w.villageHeld ?? []).includes(cap);
      // The real gate's order: the admin short-circuit off village keys comes BEFORE the badge deny.
      if (w.user?.isAdmin && !villageHolds) return true;
      if ((w.denies ?? []).includes(cap)) {
        if (refusal) res.status(refusal.status).json(refusal.body);
        return false;
      }
      if (isHolder) return true;
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

  it("hands the village-held refusal to the caller with the gate's own body, so the break-glass offer can be kept", async () => {
    const seen: any[] = [];
    const { res, out } = makeRes();
    const ok = await holderDoor({}, res, deps({ user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED, villageHeld: ["role.pay"] }), "role.pay", {
      refuse: (r: any, why: any) => { seen.push(why); budgetsRefusal(r, why); },
    });
    expect(ok).toBe(false);
    expect(seen[0].reason).toBe("village-holds-it");
    expect(seen[0].status).toBe(409);
    expect(seen[0].body).toEqual({ error: "village_holds", needsOverride: true });
    expect(out.body.why).toBe("village-holds-it");
  });

  it("sends the gate's 409 hatch as written when no caller shape is given", async () => {
    const { res, out } = makeRes();
    await holderDoor({}, res, deps({ user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED, villageHeld: ["role.pay"] }), "role.pay");
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

describe("a warning badge's deny on the pay power holds on the panel too (coordinator ruling, 2026-11-09)", () => {
  const denied = (launched: boolean, holders: Record<string, string[]> = SEATED): World => ({ user: { id: "admin-1", isAdmin: true }, launched, holders, denies: ["role.pay"] });

  for (const launched of [false, true]) {
    it(`refuses an admin carrying a deny on role.pay ${launched ? "after" : "before"} launch`, async () => {
      const { res, out } = makeRes();
      expect(await holderDoor({}, res, deps(denied(launched)), "role.pay")).toBe(false);
      expect(out.status).toBe(403);
      expect(out.body.error).toBe("denied_by_warning_badge");
    });
  }

  it("refuses a denied admin after launch with nobody in the steward's role", async () => {
    const { res, out } = makeRes();
    expect(await holderDoor({}, res, deps(denied(true, { "role.pay": ["treasurer-1"] })), "role.pay")).toBe(false);
    expect(out.body.error).toBe("denied_by_warning_badge");
  });

  it("names the deny to a caller that answers in its own shape, for an admin and a member alike", async () => {
    for (const user of [{ id: "admin-1", isAdmin: true }, { id: "treasurer-1" }]) {
      const seen: any[] = [];
      await holderDoor({}, makeRes().res, deps({ user, launched: false, holders: SEATED, denies: ["role.pay"] }), "role.pay", { refuse: (r: any, why: any) => { seen.push(why); r.status(409).json({}); } });
      expect(seen[0].reason).toBe("denied");
    }
  });

  it("shows a denied admin no standing, so the banner agrees", async () => {
    expect(await holderStanding(deps(denied(false)), { id: "admin-1", isAdmin: true }, "role.pay")).toBeNull();
  });

  it("leaves an admin with no deny through before launch, as before", async () => {
    expect(await holderDoor({}, makeRes().res, deps({ user: { id: "admin-1", isAdmin: true }, launched: false, holders: SEATED }), "role.pay")).toBe(true);
  });
});
