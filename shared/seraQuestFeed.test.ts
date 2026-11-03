import { describe, expect, it } from "vitest";
import { mapSeraQuest } from "./seraQuestFeed";

describe("mapping a Sera quest onto a quest proposal", () => {
  it("maps fields, difficulty onto the village's three, and archetypes into the rationale", () => {
    const m = mapSeraQuest({
      id: "q-1", title: " Map the springs ", subtitle: "Water", first_step: "Walk the creek", steps: ["a", "", "b"], tips: ["t"], tags: ["water"],
      difficulty: "Involved", archetypes: ["researching", "wizardry"], role_required: "Any", rationale: "Asked for twice", quote: "we need water", source_ref: "mtg-9",
    })!;
    expect(m.seraId).toBe("q-1");
    expect(m.prose).toMatchObject({ title: "Map the springs", firstStep: "Walk the creek", steps: ["a", "b"], difficulty: "Advanced", roleRequired: "Any" });
    expect(m.rationale).toBe("Asked for twice\n\nArchetypes: researching.");
    expect(m.sourceRef).toBe("mtg-9");
    expect(mapSeraQuest({ id: "q", title: "x", difficulty: "Easy" })!.prose.difficulty).toBe("Beginner");
    expect(mapSeraQuest({ id: "q", title: "x", difficulty: "Moderate" })!.prose.difficulty).toBe("Intermediate");
    expect(mapSeraQuest({ id: "q", title: "x", difficulty: "Weird" })!.prose.difficulty).toBe("Weird");
  });
  it("refuses a quest with no id or no title", () => {
    expect(mapSeraQuest({ title: "x" })).toBeNull();
    expect(mapSeraQuest({ id: "q" })).toBeNull();
  });
});
