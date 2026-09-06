/**
 * The village's own reading of 19G, taken off one setting.
 *
 * Red before this: nothing turned `governance.nonhuman_in_quorum` into the
 * policy the arithmetic takes, so every caller would have parsed the string
 * itself and two callers would eventually have parsed it differently.
 */
import { describe, expect, it } from "vitest";
import { quorumPolicyFrom, ABSENT_CYCLES_DEFAULT, REPRESENTS_BEING_COLUMN } from "./nonHumanSeats";

describe("the quorum policy a village has set", () => {
  it("ships with seats for other beings outside the count", () => {
    expect(quorumPolicyFrom(() => "false")).toEqual({ nonHumanInQuorum: false });
    expect(quorumPolicyFrom(() => undefined)).toEqual({ nonHumanInQuorum: false });
    expect(quorumPolicyFrom(() => "")).toEqual({ nonHumanInQuorum: false });
  });

  it("reads every shape a boolean is stored in", () => {
    expect(quorumPolicyFrom(() => "true").nonHumanInQuorum).toBe(true);
    expect(quorumPolicyFrom(() => "TRUE").nonHumanInQuorum).toBe(true);
    expect(quorumPolicyFrom(() => "1").nonHumanInQuorum).toBe(true);
    expect(quorumPolicyFrom(() => true).nonHumanInQuorum).toBe(true);
  });

  it("treats anything it does not recognise as the shipped answer", () => {
    expect(quorumPolicyFrom(() => "sometimes").nonHumanInQuorum).toBe(false);
  });

  it("asks for the key the registry holds, and no other", () => {
    const asked: string[] = [];
    quorumPolicyFrom((key) => {
      asked.push(key);
      return "false";
    });
    expect(asked).toEqual(["governance.nonhuman_in_quorum"]);
  });

  it("names the column the founding step writes, and the silence default", () => {
    expect(REPRESENTS_BEING_COLUMN).toBe("represents_being");
    expect(ABSENT_CYCLES_DEFAULT).toBe(3);
  });
});
