/**
 * WHAT "READY" MEANS FOR REDEMPTION, and why the module has a reader at all.
 *
 * `setup: "required"` is not decoration: `attachModuleReadiness` gives every
 * module whose setup is not "none" a readiness reader, and the Go-live card
 * (client/src/components/modules/GoLiveCard.tsx) will not offer itself until
 * that reader says yes. The DEFAULT reader counts a module's own non-example
 * rows through the examples engine, and redemption has no entry there at all,
 * so a flip to "required" without the reader below would have answered "not
 * ready" for every village forever and quietly removed the Go-live card from
 * a module that used to have one. That is the regression this file exists to
 * catch, which is why it asserts what the reader answers AND that it never
 * reaches for the pool.
 *
 * `stringVar` is the one thing stubbed, because the answer is a game variable
 * and loading those needs a database. Every other export of that module stays
 * real.
 *
 * EVENTS JOINED THIS FILE on 2026-09-23, for the same shape of reason and a
 * different question. Redemption waits for words to be written; events waits
 * for a question to be ANSWERED, and `isAnswered` is stubbed beside
 * `stringVar` for the same reason. The third block below walks the whole
 * registry instead of naming modules, so the next module to declare setup
 * cannot arrive without an address to send a founder to.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

const processText = { value: "" };

/** Whether the village has answered `calendar.hemisphere`. See `isAnswered`. */
const hemisphereAnswered = { value: false };

vi.mock("./variables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./variables")>();
  return {
    ...actual,
    stringVar: (key: string) =>
      key === "redemption.process_text" ? processText.value : actual.stringVar(key),
    isAnswered: (key: string) =>
      key === "calendar.hemisphere" ? hemisphereAnswered.value : actual.isAnswered(key),
  };
});

import { attachModuleReadiness } from "./modules";
import { MODULES, MODULES_BY_ID } from "../../shared/modules";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { setupHref } from "../../shared/moduleSetupLink";

/** Both dial-answered readers must answer without a query. */
const noPool = (): Pool => {
  throw new Error("a dial-answered readiness reader reached for the database");
};

describe("redemption readiness", () => {
  beforeAll(() => {
    attachModuleReadiness(noPool);
  });

  it("is a module that declares setup, so it gets a reader", () => {
    expect(MODULES_BY_ID.redemption.setup).toBe("required");
    expect(MODULES_BY_ID.redemption.readiness).toBeTypeOf("function");
  });

  it("is not ready while nobody has written how a member gets paid", async () => {
    processText.value = "";
    const answer = await MODULES_BY_ID.redemption.readiness!();
    expect(answer.ready).toBe(false);
    expect(answer.hint).toBe("Write how redemption works here first");
  });

  it("counts whitespace as nothing written", async () => {
    processText.value = "   \n  ";
    expect((await MODULES_BY_ID.redemption.readiness!()).ready).toBe(false);
  });

  it("is ready the moment the process is written", async () => {
    processText.value = "Ask Suzy in the office. Bring your bank details.";
    expect((await MODULES_BY_ID.redemption.readiness!()).ready).toBe(true);
  });

  it("never asks the database, so it answers the same in a village with no rows", async () => {
    // noPool throws. The three reads above already proved it is not called;
    // this names the reason, because the default reader DOES query and
    // swapping back to it is the regression.
    processText.value = "Written.";
    await expect(MODULES_BY_ID.redemption.readiness!()).resolves.toEqual({
      ready: true,
      hint: "Write how redemption works here first",
      // The address, which arrived with the deep links: the hint says what is
      // missing and this says which control fixes it. Asserted whole rather
      // than loosened to `toMatchObject`, because a reader quietly dropping
      // its target is exactly the regression the link surfaces would show as
      // a link to the module card and nobody would notice.
      target: {
        kind: "setting",
        key: "redemption.process_text",
        label: VARIABLES_BY_KEY["redemption.process_text"].label,
      },
    });
  });
});

/**
 * WHAT "READY" MEANS FOR THE VILLAGE CALENDAR.
 *
 * Rye, 2026-09-21, on a module owning a default that depends on where a
 * village is: "Yes - and whenever this happens have a link to direct people to
 * exactly what they need."
 *
 * `calendar.hemisphere` ships "north". That is right in Costa Rica and upside
 * down south of the equator, and the module told every fork there was nothing
 * to set up. Ready here therefore cannot be a value test: "north" is a true
 * answer for most villages, and "differs from the default" is the same
 * sentence. It is whether anybody answered, which is a stored row
 * (`placeDependent`, shared/gameVariables.ts) and nothing else.
 */
describe("events readiness", () => {
  beforeAll(() => {
    attachModuleReadiness(noPool);
  });

  it("declares setup, so the registry hands it a reader", () => {
    expect(MODULES_BY_ID.events.setup).toBe("required");
    expect(MODULES_BY_ID.events.readiness).toBeTypeOf("function");
  });

  it("is not ready while nobody here has said which hemisphere this is", async () => {
    hemisphereAnswered.value = false;
    const answer = await MODULES_BY_ID.events.readiness!();
    expect(answer.ready).toBe(false);
    expect(answer.hint).toBe("Say which hemisphere this village is in first");
  });

  it("is ready once the question is answered, whatever the answer was", async () => {
    // The whole point of the flag. A village in Costa Rica confirming "north"
    // is as ready as one choosing "south", and before this it was
    // indistinguishable from a village that never looked.
    hemisphereAnswered.value = true;
    expect((await MODULES_BY_ID.events.readiness!()).ready).toBe(true);
  });

  it("sends a founder to the hemisphere dial, not to the module", async () => {
    const { target } = await MODULES_BY_ID.events.readiness!();
    expect(target).toEqual({
      kind: "setting",
      key: "calendar.hemisphere",
      label: VARIABLES_BY_KEY["calendar.hemisphere"].label,
    });
    expect(setupHref("events", target, { on: true })).toBe(
      "/admin?tab=modules&module=events&setting=calendar.hemisphere",
    );
  });

  it("never asks the database, so a village with an empty calendar answers the same", async () => {
    // noPool throws. This names the reason: the DEFAULT reader queries, events
    // has no examples-engine entry, and falling back to it would answer "not
    // ready" forever however many gatherings the village had posted.
    hemisphereAnswered.value = true;
    await expect(MODULES_BY_ID.events.readiness!()).resolves.toEqual({
      ready: true,
      hint: "Say which hemisphere this village is in first",
      target: {
        kind: "setting",
        key: "calendar.hemisphere",
        label: VARIABLES_BY_KEY["calendar.hemisphere"].label,
      },
    });
  });
});

/**
 * THE REGISTRY-WIDE PROMISE, walked rather than listed.
 *
 * Every module that declares setup gets a reader, and every reader says where
 * to go. A module added later with a hint and no address would ship a link to
 * its own card, which reads like the product working while a founder hunts
 * for the control; this fails the build instead.
 */
describe("every module that declares setup", () => {
  beforeAll(() => {
    attachModuleReadiness(noPool);
  });

  const declaring = MODULES.filter((m) => m.setup && m.setup !== "none");

  it("is a list with something in it, so the loops below can fail", () => {
    expect(declaring.length).toBeGreaterThan(0);
  });

  for (const def of declaring) {
    it(`"${def.id}" has a reader and an address`, async () => {
      expect(def.readiness, `"${def.id}" declares setup and has no reader`).toBeTypeOf("function");
      const answer = await def.readiness!();
      expect(answer.hint.trim().length, `"${def.id}" answers with an empty hint`).toBeGreaterThan(0);
      const target = answer.target;
      expect(target, `"${def.id}" answers with no address to send a founder to`).toBeTruthy();
      if (target?.kind === "setting") {
        // A dial that no longer exists would render a link to a control that
        // is not on the card, which is worse than no link: it promises an
        // answer and lands nowhere.
        expect(
          VARIABLES_BY_KEY[target.key],
          `"${def.id}" points at the dial "${target.key}", which is not in the registry`,
        ).toBeTruthy();
        expect(target.label).toBe(VARIABLES_BY_KEY[target.key].label);
      }
      // Whatever the kind, the address is a real one.
      expect(setupHref(def.id, target, { on: true }).startsWith("/admin?tab=")).toBe(true);
      expect(setupHref(def.id, target, { on: false }).startsWith("/admin?tab=")).toBe(true);
    });
  }
});
