import { describe, expect, it } from "vitest";
import { coordinatingCircle } from "./coordinatingCircle";

const circle = (id: string, name: string, parentCircleId: string | null = null, isExample = false) => ({ id, name, parentCircleId, isExample });

describe("the circle that coordinates the others", () => {
  it("is the one top circle with circles under it, by the village's own name", () => {
    const rows = [circle("top", "Village Council"), circle("land", "Land Circle", "top"), circle("arch", "Architecture", "land")];
    expect(coordinatingCircle(rows)?.name).toBe("Village Council");
  });

  it("is nobody in a village whose circles are flat, which is every new village", () => {
    expect(coordinatingCircle([circle("a", "Land"), circle("b", "Care"), circle("c", "Build")])).toBeNull();
  });

  it("is nobody when two circles sit at the top", () => {
    expect(coordinatingCircle([circle("a", "Land"), circle("b", "Care"), circle("c", "Build", "a")])).toBeNull();
  });

  it("is nobody when the only circle has nothing under it", () => {
    expect(coordinatingCircle([circle("a", "Land")])).toBeNull();
    expect(coordinatingCircle([])).toBeNull();
    expect(coordinatingCircle(null)).toBeNull();
  });

  it("leaves the platform's example circles out of the village's structure", () => {
    const rows = [circle("top", "Village Council"), circle("land", "Land Circle", "top"), circle("ex", "Example Circle", null, true)];
    expect(coordinatingCircle(rows)?.id).toBe("top");
  });

  it("counts a circle whose parent is missing from the list as a top circle", () => {
    expect(coordinatingCircle([circle("top", "Village Council"), circle("land", "Land", "top"), circle("lost", "Lost", "gone")])).toBeNull();
  });
});
