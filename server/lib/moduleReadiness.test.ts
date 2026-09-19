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
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";

const processText = { value: "" };

vi.mock("./variables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./variables")>();
  return {
    ...actual,
    stringVar: (key: string) =>
      key === "redemption.process_text" ? processText.value : actual.stringVar(key),
  };
});

import { attachModuleReadiness } from "./modules";
import { MODULES_BY_ID } from "../../shared/modules";

/** The redemption reader must answer from a dial alone, never from a query. */
const noPool = (): Pool => {
  throw new Error("the redemption readiness reader reached for the database");
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
    });
  });
});
