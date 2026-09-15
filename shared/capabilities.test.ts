/**
 * The one gate's truth table (S36). hasCapability is the single permission
 * decision in the product; this table pins its order of authority so no
 * later contributor can quietly reorder it:
 *
 *   admin > deny > role > badge > stage > nothing
 *
 * Gate E, stated as a test: a warning badge's deny beats a ROLE grant (and
 * a badge grant, and a stage unlock). Only admin outranks a deny.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  CAPABILITY_LABELS,
  capabilityDecision,
  capabilityLabel,
  DENIABLE,
  hasCapability,
  isDeniable,
  isVillageHeld,
  STAGE_UNLOCKS,
  TRANSFERABLE,
  type Capability,


} from "./capabilities";

const LADDER = ["visitor", "guest", "member", "co-creator"];
const stageIndexOf = (id: string) => LADDER.indexOf(id);

/** forum.post unlocks at 'member' (index 2) — the stage-driven fixture. */
const CAP: Capability = "forum.post";

function ctx(overrides: Partial<Parameters<typeof hasCapability>[1]> = {}) {
  return {
    stageIndex: 0, // visitor: below every unlock
    stageIndexOf,
    roleCapabilities: [] as string[],
    ...overrides,
  };
}

describe("hasCapability truth table", () => {
  it("row 0: nothing grants → false", () => {
    expect(hasCapability(CAP, ctx())).toBe(false);
  });

  it("row 1: stage alone grants", () => {
    expect(STAGE_UNLOCKS[CAP]).toBe("member"); // fixture assumption, pinned
    expect(hasCapability(CAP, ctx({ stageIndex: 2 }))).toBe(true);
    expect(hasCapability(CAP, ctx({ stageIndex: 1 }))).toBe(false); // one below
  });

  it("row 2: role alone grants, regardless of stage", () => {
    expect(hasCapability(CAP, ctx({ roleCapabilities: [CAP] }))).toBe(true);
  });

  it("row 3: badge alone grants, regardless of stage", () => {
    expect(hasCapability(CAP, ctx({ badgeCapabilities: [CAP] }))).toBe(true);
  });

  it("row 4: a capability with NO stage unlock is never granted by stage", () => {
    // forum.moderate has no STAGE_UNLOCKS entry: only role/badge/admin open it.
    expect(hasCapability("forum.moderate", ctx({ stageIndex: 99 }))).toBe(false);
    expect(hasCapability("forum.moderate", ctx({ badgeCapabilities: ["forum.moderate"] }))).toBe(true);
  });

  it("GATE E: deny beats the badge grant", () => {
    expect(hasCapability(CAP, ctx({ badgeCapabilities: [CAP], badgeDenies: [CAP] }))).toBe(false);
  });

  it("GATE E: deny beats the ROLE grant — a warning a role overrides is no warning", () => {
    expect(hasCapability(CAP, ctx({ roleCapabilities: [CAP], badgeDenies: [CAP] }))).toBe(false);
  });

  it("GATE E: deny beats the stage unlock", () => {
    expect(hasCapability(CAP, ctx({ stageIndex: 3, badgeDenies: [CAP] }))).toBe(false);
  });

  it("GATE E: deny beats every grant source COMBINED", () => {
    expect(
      hasCapability(CAP, ctx({ stageIndex: 3, roleCapabilities: [CAP], badgeCapabilities: [CAP], badgeDenies: [CAP] })),
    ).toBe(false);
  });

  /*
   * UPDATED, NEVER DELETED (0098). This test used to say "admin outranks
   * everything, including a deny" with no qualification, and that sentence
   * was the reason no power could ever leave the admin panel. It is still
   * true, and it is now true of a NAMED set: everything the village has not
   * taken on. A deleted test is an invariant nobody is watching, so the old
   * assertions are all still here and the new condition sits beside them.
   */
  it("admin outranks everything, including a deny, on a power the village does not hold", () => {
    expect(hasCapability(CAP, ctx({ isAdmin: true }))).toBe(true);
    expect(hasCapability(CAP, ctx({ isAdmin: true, badgeDenies: [CAP] }))).toBe(true);
    // Explicitly with holdings present but naming something else: the
    // short-circuit is scoped to the key, never to the request.
    expect(
      hasCapability(CAP, ctx({ isAdmin: true, badgeDenies: [CAP], villageHeld: ["library.keep"] })),
    ).toBe(true);
  });

  it("an UNTRANSFERRED key answers exactly as it did before, holdings or not", () => {
    // The whole safety argument for shipping this on live deployments: the
    // holding table is empty everywhere, so every existing village gets the
    // pre-0098 gate byte for byte.
    for (const held of [undefined, [] as string[], ["library.keep"]]) {
      expect(hasCapability(CAP, ctx({ isAdmin: true, villageHeld: held }))).toBe(true);
      expect(hasCapability(CAP, ctx({ roleCapabilities: [CAP], villageHeld: held }))).toBe(true);
      expect(hasCapability(CAP, ctx({ badgeDenies: [CAP], roleCapabilities: [CAP], villageHeld: held }))).toBe(false);
      expect(hasCapability(CAP, ctx({ villageHeld: held }))).toBe(false);
    }
  });

  describe("a TRANSFERRED key: the admin is judged like anybody else", () => {
    // A real transferable key, read off the map so this cannot drift.
    const MOVED: Capability = "library.keep";
    const held = { villageHeld: [MOVED as string] };

    it("is transferable in the first place, or the rest of this block proves nothing", () => {
      expect(TRANSFERABLE[MOVED]).toBe(true);
    });

    it("an admin holding it by nothing else is refused", () => {
      expect(hasCapability(MOVED, ctx({ isAdmin: true, ...held }))).toBe(false);
      expect(capabilityDecision(MOVED, ctx({ isAdmin: true, ...held })).source).toBe("not granted");
    });

    it("an admin who holds the ROLE passes, and passes AS the holder", () => {
      const d = capabilityDecision(MOVED, ctx({ isAdmin: true, roleCapabilities: [MOVED], ...held }));
      expect(d.allowed).toBe(true);
      expect(d.source).toBe("role");
      expect(d.reachedPastVillage).toBe(false);
    });

    it("a warning badge's deny now reaches an ADMIN, because steps 2-5 are what judges them", () => {
      const d = capabilityDecision(
        MOVED,
        ctx({ isAdmin: true, roleCapabilities: [MOVED], badgeDenies: [MOVED], ...held }),
      );
      expect(d.allowed).toBe(false);
      expect(d.source).toBe("denied by warning badge");
    });

    it("the break-glass passes and says it owes a record", () => {
      const d = capabilityDecision(MOVED, ctx({ isAdmin: true, adminOverride: true, ...held }));
      expect(d.allowed).toBe(true);
      expect(d.source).toBe("admin-override");
      expect(d.reachedPastVillage).toBe(true);
    });

    it("the break-glass is an ADMIN's affordance and grants a member nothing", () => {
      const d = capabilityDecision(MOVED, ctx({ adminOverride: true, ...held }));
      expect(d.allowed).toBe(false);
      expect(d.reachedPastVillage).toBe(false);
    });

    it("a member holding it by role is untouched by the transfer", () => {
      expect(hasCapability(MOVED, ctx({ roleCapabilities: [MOVED], ...held }))).toBe(true);
    });

    it("a holding row naming a NON-transferable key cannot close a door", () => {
      // The second lock, beside the boot assertion. A hand-written INSERT is
      // invisible to code review by definition.
      expect(TRANSFERABLE["message.send"]).toBe(false);
      const d = capabilityDecision("message.send", ctx({ isAdmin: true, villageHeld: ["message.send"] }));
      expect(d.allowed).toBe(true);
      expect(d.source).toBe("admin");
      expect(isVillageHeld("message.send", ["message.send"])).toBe(false);
    });
  });

  describe("the TRANSFERABLE map", () => {
    it("classifies every capability, and nothing else", () => {
      expect(Object.keys(TRANSFERABLE).sort()).toEqual([...ALL_CAPABILITIES].sort());
    });

    it("names at least one power, or the handover has no substrate", () => {
      expect(ALL_CAPABILITIES.filter((c) => TRANSFERABLE[c]).length).toBeGreaterThan(0);
    });

    it("never marks a personal act as a power that can move", () => {
      // A row saying the village holds "start a conversation" is a category
      // error with a lockout attached.
      for (const personal of ["forum.post", "message.send", "event.rsvp", "exchange.buy"] as Capability[]) {
        expect(TRANSFERABLE[personal], personal).toBe(false);
      }
    });
  });

  it("a deny only blocks ITS capability, not the member's whole hand", () => {
    const c = ctx({ stageIndex: 3, badgeDenies: ["map.contact"] });
    expect(hasCapability("map.contact", c)).toBe(false);
    expect(hasCapability(CAP, c)).toBe(true); // untouched grant still works
  });

  it("absent badge fields behave exactly like empty lists (back-compat)", () => {
    const before = hasCapability(CAP, ctx({ stageIndex: 2 }));
    const after = hasCapability(CAP, ctx({ stageIndex: 2, badgeCapabilities: [], badgeDenies: [] }));
    expect(before).toBe(after);
  });
});

/**
 * The map's two keys (0063). The village's front door is an appointment, so
 * the interesting assertions here are about what does NOT grant them.
 */
describe("map.edit and map.publish are appointments", () => {
  const KEYS: Capability[] = ["map.edit", "map.publish"];

  it("no stage unlocks either, at any height on the ladder", () => {
    for (const key of KEYS) {
      expect(STAGE_UNLOCKS[key]).toBeUndefined();
      // Top of the ladder, nothing appointed: still closed.
      expect(hasCapability(key, ctx({ stageIndex: LADDER.length - 1 }))).toBe(false);
    }
  });

  it("both are grantable by role and by badge", () => {
    for (const key of KEYS) {
      expect(hasCapability(key, ctx({ roleCapabilities: [key] }))).toBe(true);
      expect(hasCapability(key, ctx({ badgeCapabilities: [key] }))).toBe(true);
    }
  });

  /*
   * The reason they are two keys and not one. A member who may draft must be
   * able to hold map.edit while map.publish stays shut, or the split buys
   * nothing.
   */
  it("drafting does not imply publishing", () => {
    const drafter = ctx({ badgeCapabilities: ["map.edit"] });
    expect(hasCapability("map.edit", drafter)).toBe(true);
    expect(hasCapability("map.publish", drafter)).toBe(false);
  });

  it("a warning badge suspends publishing while editing survives", () => {
    const c = ctx({ roleCapabilities: ["map.edit", "map.publish"], badgeDenies: ["map.publish"] });
    expect(hasCapability("map.publish", c)).toBe(false);
    expect(hasCapability("map.edit", c)).toBe(true);
  });
});

/**
 * The labels are what a member reads when a stage advance tells them what
 * opened. A key with no label renders as `forum.post`, which is the machine
 * text this table exists to replace, so the lockstep is a test and not a
 * comment asking nicely.
 */
describe("capability labels", () => {
  it("names every capability the platform knows about", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap], `no label for ${cap}`).toBeTruthy();
    }
  });

  it("names nothing that is not a capability", () => {
    expect(Object.keys(CAPABILITY_LABELS).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("reads as the completion of 'You can now', so the list is an invitation", () => {
    for (const cap of ALL_CAPABILITIES) {
      const label = CAPABILITY_LABELS[cap];
      // A sentence-shaped label would read "You can now You may post."
      expect(label).not.toMatch(/^(You|Can|May|Able)\b/);
      expect(label).not.toMatch(/[.]$/);
      // Capitalised, because each one is a list item on its own line.
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("carries no dotted key through as its own label", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap]).not.toBe(cap);
    }
  });

  it("falls back to the key rather than dropping an unknown one", () => {
    // A key with no label is a bug in the table; saying so out loud beats
    // rendering an empty row and telling a member less than they hold.
    expect(capabilityLabel("nope.invented")).toBe("nope.invented");
    expect(capabilityLabel("forum.post")).toBe(CAPABILITY_LABELS["forum.post"]);
  });
});

/**
 * R65 AND R66: NOBODY MAY TAKE AWAY A VOICE THAT WAS EARNED.
 *
 * The founder's ruling, in his words: "denying a voice is not a power anyone
 * should hold", and "when voice is earned it should never be force taken
 * away". Waning is the one thing that survives it: a rule under which unused
 * voice decays over time is legitimate and belongs to Hypha, for villages
 * that want professional governance. An ACT by which one party strips
 * another's earned voice is not legitimate at any tier, held by anybody.
 *
 * Before this, `denies` on a warning badge could name any of the platform's
 * capability keys, and the deny sat at step 2 of the gate ahead of role and
 * stage, so a warning badge naming `ballot.vote` took a member off every roll
 * built while it stood. `ballot.vote` is deliberately non-transferable, so the
 * village could never take that power back either.
 *
 * These tests are the floor under the ruling. They were written and watched
 * FAIL before `DENIABLE` existed.
 */
describe("a badge may never take away a voice", () => {
  /** The voice keys, read off the map so this cannot drift from the source. */
  const VOICE = ALL_CAPABILITIES.filter((c) => !DENIABLE[c]);

  it("REGRESSION: a member carrying a badge that denies ballot.vote still holds the vote", () => {
    // Member stage, nothing else. This is exactly the member round 6
    // measured off every roll opened after her warning landed.
    const warned = ctx({ stageIndex: 2, badgeDenies: ["ballot.vote"] });
    expect(hasCapability("ballot.vote", warned)).toBe(true);
    expect(capabilityDecision("ballot.vote", warned).source).toBe("stage");
  });

  it("REGRESSION: the electorate builder runs this same gate, so she is on the roll", () => {
    // `buildElectorate` runs `hasCapability("ballot.vote", ctx)` over every
    // member with no request in hand. Whatever this answers IS the roll.
    const members = [
      { name: "no badge", c: ctx({ stageIndex: 2 }) },
      { name: "warned on the vote", c: ctx({ stageIndex: 2, badgeDenies: ["ballot.vote"] }) },
      { name: "warned on posting", c: ctx({ stageIndex: 2, badgeDenies: ["forum.post"] }) },
    ];
    const roll = members.filter((m) => hasCapability("ballot.vote", m.c)).map((m) => m.name);
    expect(roll).toEqual(["no badge", "warned on the vote", "warned on posting"]);
  });

  it("a deny cannot reach a voice key by any route: role, badge or stage held it", () => {
    for (const cap of VOICE) {
      for (const source of ["roleCapabilities", "badgeCapabilities"] as const) {
        const c = ctx({ [source]: [cap], badgeDenies: [cap] });
        expect(hasCapability(cap, c), `${cap} via ${source}`).toBe(true);
      }
    }
  });

  it("a deny cannot reach a voice key on an ADMIN judged as a member either", () => {
    // The 0098 branch: on a village-held key the admin is judged on steps
    // 2 to 5. A voice key must come out the same way there.
    const cap: Capability = "ballot.vote";
    const d = capabilityDecision(cap, ctx({ isAdmin: true, stageIndex: 2, badgeDenies: [cap] }));
    expect(d.allowed).toBe(true);
  });

  it("STILL REFUSES what the deny path keeps: a warning on posting stands", () => {
    // The other half of the pair, so the next reader can tell the two apart.
    // This is a village asking somebody to stop posting for a while, which is
    // not the act the founder ruled on.
    const c = ctx({ stageIndex: 3, roleCapabilities: ["forum.post"], badgeDenies: ["forum.post"] });
    expect(hasCapability("forum.post", c)).toBe(false);
    expect(capabilityDecision("forum.post", c).source).toBe("denied by warning badge");
  });

  /**
   * THE GATE-ORDER PROOF the brief asks for. Removing an input from a gate
   * that role and stage sit behind can change the answer for keys nobody
   * meant to touch, so this walks EVERY capability rather than sampling.
   */
  it("the decision is unchanged for a member with no badge, key for key", () => {
    const plain = ctx({ stageIndex: 3, roleCapabilities: ["library.keep"] });
    for (const cap of ALL_CAPABILITIES) {
      const d = capabilityDecision(cap, plain);
      expect(d.source, cap).not.toBe("denied by warning badge");
      // And the same context with an explicitly empty deny list answers the
      // same way, which is the back-compat shape every deployment is in.
      const same = capabilityDecision(cap, ctx({ stageIndex: 3, roleCapabilities: ["library.keep"], badgeDenies: [] }));
      expect(same, cap).toEqual(d);
    }
  });

  it("a deny on a voice key changes NO key's answer, not even its own neighbours", () => {
    const base = ctx({ stageIndex: 3, roleCapabilities: ["library.keep", "forum.moderate"] });
    const withDeny = ctx({
      stageIndex: 3,
      roleCapabilities: ["library.keep", "forum.moderate"],
      badgeDenies: VOICE as string[],
    });
    for (const cap of ALL_CAPABILITIES) {
      expect(capabilityDecision(cap, withDeny), cap).toEqual(capabilityDecision(cap, base));
    }
  });

  it("a deny on a key that stayed deniable changes exactly that one key", () => {
    const base = ctx({ stageIndex: 3, roleCapabilities: ["library.keep", "forum.moderate"] });
    const withDeny = ctx({
      stageIndex: 3,
      roleCapabilities: ["library.keep", "forum.moderate"],
      badgeDenies: ["forum.moderate"],
    });
    const changed = ALL_CAPABILITIES.filter(
      (cap) => capabilityDecision(cap, withDeny).allowed !== capabilityDecision(cap, base).allowed,
    );
    expect(changed).toEqual(["forum.moderate"]);
  });

  describe("the DENIABLE map", () => {
    it("classifies every capability, and nothing else", () => {
      expect(Object.keys(DENIABLE).sort()).toEqual([...ALL_CAPABILITIES].sort());
    });

    it("names the vote as a voice, which is the ruling itself", () => {
      expect(DENIABLE["ballot.vote"]).toBe(false);
    });

    it("names vouching as a voice: it is a member's say in who joins", () => {
      expect(DENIABLE["member.vouch"]).toBe(false);
    });

    it("names proposing a rule change as a voice, which is the round 7 ruling", () => {
      // The say itself, one step earlier: a village's rules are the thing its
      // members vote about, so putting a change in front of them is a voice in
      // every decision that follows.
      expect(DENIABLE["mechanics.propose"]).toBe(false);
    });

    it("keeps opening a decision deniable, because that deny leaves a way to be heard", () => {
      // The pair is the whole point of the split. A deny on `proposal.open`
      // leaves the drafts and the forum standing. A deny on
      // `mechanics.propose` closed the only route to the rule set, and closed
      // the draft path with it, so there was nothing left over.
      expect(DENIABLE["proposal.open"]).toBe(true);
      expect(DENIABLE["mechanics.propose"]).toBe(false);
    });

    it("leaves the expression keys alone, because the founder has not ruled on them", () => {
      // Silencing a harasser is a different act from disenfranchising a
      // dissenter. These stay deniable until he says otherwise.
      for (const cap of ["forum.post", "message.send", "map.contact", "map.photograph", "proposal.open"] as Capability[]) {
        expect(DENIABLE[cap], cap).toBe(true);
      }
    });

    it("isDeniable refuses a key the platform does not know, which is the safe direction", () => {
      expect(isDeniable("nope.invented")).toBe(false);
      expect(isDeniable("forum.post")).toBe(true);
      expect(isDeniable("ballot.vote")).toBe(false);
    });
  });
});

/**
 * A GREATER KEY CARRYING A LESSER ONE.
 *
 * Rye ruled on 2026-09-08 that founders and stewards may ALWAYS vouch, so a
 * village always has a path to admit its next member. Stewards hold
 * `member.superVouch`, which admits somebody OUTRIGHT, and refusing them the
 * smaller act of adding one vouch would be an absurdity.
 *
 * These pin the three properties that keep it from becoming a back door.
 */
describe("keys that carry other keys", () => {
  it("a super vouch carries a vouch, from a rung that grants neither", () => {
    // stageIndex 0 is visitor, below every unlock, so nothing but the carry
    // can be doing this.
    expect(hasCapability("member.vouch", ctx({ stageIndex: 0 }))).toBe(false);
    expect(
      hasCapability("member.vouch", ctx({ stageIndex: 0, roleCapabilities: ["member.superVouch"] })),
    ).toBe(true);
  });

  it("says WHY, rather than claiming the role held the key itself", () => {
    const d = capabilityDecision("member.vouch", ctx({ roleCapabilities: ["member.superVouch"] }));
    expect(d.allowed).toBe(true);
    expect(d.source).toBe("carried by a greater key");
  });

  it("DOES NOT RUN BACKWARDS: a vouch does not carry a super vouch", () => {
    // The whole point of the override being its own key is that it is scarcer.
    // If the carry ran both ways it would be one key again.
    expect(
      hasCapability("member.superVouch", ctx({ roleCapabilities: ["member.vouch"] })),
    ).toBe(false);
  });

  it("DOES NOT CHAIN, so nobody composes a path to a power nobody granted", () => {
    // Holding a key carries what that key names, and not whatever those carry
    // in turn. Asserted against the whole catalogue rather than one example, so
    // it stays true when somebody adds a second entry to CARRIES.
    for (const cap of ALL_CAPABILITIES) {
      const viaSuper = hasCapability(cap, ctx({ roleCapabilities: ["member.superVouch"] }));
      const directly = cap === "member.superVouch" || cap === "member.vouch";
      expect(viaSuper, `member.superVouch should not reach ${cap}`).toBe(directly);
    }
  });

  it("OPENS NO PATH AROUND A DENY: carried and direct answer alike", () => {
    /*
     * The first version of this asserted that a warning badge stops a carried
     * vouch, and it failed, and the TEST was wrong rather than the gate.
     * `member.vouch` is not deniable: it is a voice key, and 0109/R65-R66 have
     * the gate ignore a badge naming one rather than trust it, because a voice
     * in a decision is not a thing a badge may take away.
     *
     * So the property worth pinning is not "a deny stops the carry", it is that
     * the carry ANSWERS THE SAME as holding the key outright. A carry that
     * answered differently in the presence of a deny would be a second route
     * through the gate, which is exactly what a single gate exists to prevent.
     */
    const denied = { badgeDenies: ["member.vouch"] as string[] };
    const direct = hasCapability("member.vouch", ctx({ ...denied, roleCapabilities: ["member.vouch"] }));
    const carried = hasCapability("member.vouch", ctx({ ...denied, roleCapabilities: ["member.superVouch"] }));
    expect(carried).toBe(direct);

    // And on a key that CAN be denied, the deny still lands, so the ordering
    // of the deny step above the carry is doing its job.
    expect(DENIABLE["forum.moderate"]).toBe(true);
    expect(
      hasCapability("forum.moderate", ctx({ roleCapabilities: ["forum.moderate"], badgeDenies: ["forum.moderate"] })),
    ).toBe(false);
  });
});
