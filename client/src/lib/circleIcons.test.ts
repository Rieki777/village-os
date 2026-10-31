import { describe, expect, it } from "vitest";
import { CircleDot, Crown, DollarSign, ShieldCheck, Users } from "lucide-react";
import { iconFor, knowsIcon } from "./circleIcons";

describe("iconFor", () => {
  it("draws every icon the live village's circles store", () => {
    for (const name of ["Crown", "Sprout", "BookOpen", "Users2", "Music", "Handshake", "Users", "Heart", "Hammer", "Building2", "TrendingUp", "Briefcase", "TreePine"]) {
      expect(knowsIcon(name), name).toBe(true);
    }
    expect(iconFor("Crown")).toBe(Crown);
  });

  it("reads the spellings the seeds mix: any case, dashes or spaces", () => {
    expect(iconFor("users")).toBe(Users);
    expect(iconFor("shield-check")).toBe(ShieldCheck);
    expect(iconFor("Shield Check")).toBe(ShieldCheck);
    expect(iconFor("dollar")).toBe(DollarSign);
  });

  it("falls back to a plain dot for a missing or unknown name", () => {
    expect(iconFor(null)).toBe(CircleDot);
    expect(iconFor("")).toBe(CircleDot);
    expect(iconFor("NotAnIcon")).toBe(CircleDot);
    expect(knowsIcon("NotAnIcon")).toBe(false);
  });
});
