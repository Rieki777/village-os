import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommsTrigger } from "../../shared/comms/contracts";
import { commsSink } from "./commsSink";

/**
 * The sink's whole contract (docs/comms/BUILD_SPEC.md section 4): `fire()`
 * never throws and never waits, and whatever the handler does wrong is caught
 * and logged with the trigger's type and never its contents.
 */

const nextTurn = () => new Promise<void>((r) => setImmediate(r));
const joined: CommsTrigger = { type: "member_joined", userId: "u-1" };
const private_: CommsTrigger = { type: "form_submitted", formType: "resident", submissionId: "s-1", email: "ana@example.test", name: "Ana", consentPaths: true };

afterEach(() => {
  commsSink.register(async () => undefined);
  vi.restoreAllMocks();
});

describe("the comms sink", () => {
  it("hands the trigger to the handler on a later turn, never inside the caller", async () => {
    const seen: CommsTrigger[] = [];
    commsSink.register(async (t) => {
      seen.push(t);
    });
    commsSink.fire(joined);
    expect(seen, "the caller has moved on before the handler runs").toEqual([]);
    await nextTurn();
    expect(seen).toEqual([joined]);
  });

  it("never throws when the handler throws, and logs the type without the contents", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    commsSink.register(() => {
      throw new Error("handler exploded");
    });
    expect(() => commsSink.fire(private_)).not.toThrow();
    await nextTurn();
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0][0]);
    expect(line).toContain("form_submitted");
    expect(line).not.toContain("ana@example.test");
    expect(line).not.toContain("Ana");
  });

  it("never lets a rejected handler become an unhandled rejection", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    commsSink.register(async () => {
      throw new Error("the database is gone");
    });
    commsSink.fire(joined);
    await nextTurn();
    await nextTurn();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("member_joined");
  });

  it("stays quiet and harmless when nothing is registered, and when handed nonsense", async () => {
    commsSink.register(null as unknown as (t: CommsTrigger) => Promise<void>);
    expect(() => commsSink.fire(joined)).not.toThrow();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    commsSink.register(async (t) => {
      if (!t) throw new Error("no trigger");
    });
    expect(() => commsSink.fire(null as unknown as CommsTrigger)).not.toThrow();
    await nextTurn();
    expect(String(logged.mock.calls[0]?.[0] ?? "")).toContain("unknown");
  });
});
