// @vitest-environment jsdom
/**
 * One item card on My moon: its words and choices come from the contract's
 * word tables, each choice saves exactly the field it names, Let go and
 * Redirect ask for their reason, Outside my roles asks for the role the work
 * belongs to, and a recap that is not the member's to edit is read-only.
 * Every person and role is invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LET_GO_NEEDS_REASON, MY_MOON_WORDS, OUTSIDE_MY_ROLES, REDIRECT_NEEDS_WHO, TASK_STATUS_WORDS } from "@shared/moonRecap";
import ItemCard from "./ItemCard";
import { ROLES, item } from "./myMoon.fixture";

afterEach(cleanup);

const VILLAGE_ROLES = [{ id: "role-seeds", name: "Seed keeper" }, { id: "role-water", name: "Water steward" }];

function renderCard(over: Parameters<typeof item>[0] = {}, editable = true) {
  const onSave = vi.fn(async () => null);
  render(
    <ItemCard item={item(over)} roles={ROLES} seasonGoals={[{ id: "g-1", words: "Grow our own food" }]} ownGoals={["Learn the old seeds"]} villageRoles={VILLAGE_ROLES} editable={editable} onSave={onSave} />,
  );
  return onSave;
}

describe("ItemCard", () => {
  it("shows the five statuses in the contract's words, with the current one pressed", () => {
    renderCard();
    for (const w of Object.values(TASK_STATUS_WORDS)) expect(screen.getByRole("button", { name: w })).toBeTruthy();
    expect(screen.getByRole("button", { name: TASK_STATUS_WORDS.done }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves only the status when Let go is pressed, then asks for the reason", async () => {
    const onSave = renderCard();
    fireEvent.click(screen.getByRole("button", { name: TASK_STATUS_WORDS.let_go }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ taskStatus: "let_go" }));
    cleanup();
    renderCard({ taskStatus: "let_go" });
    expect(screen.getByText(LET_GO_NEEDS_REASON)).toBeTruthy();
    const reason = screen.getByLabelText(new RegExp(MY_MOON_WORDS.letGoReason));
    fireEvent.change(reason, { target: { value: "The plan changed" } });
    fireEvent.blur(reason);
    expect(screen.getByLabelText(new RegExp(MY_MOON_WORDS.letGoReason))).toBeTruthy();
  });

  it("asks who a redirected item belongs to", () => {
    renderCard({ taskStatus: "redirect" });
    expect(screen.getByText(REDIRECT_NEEDS_WHO)).toBeTruthy();
  });

  it("saves the words once, when the field loses focus and they changed", async () => {
    const onSave = renderCard();
    const words = screen.getByLabelText(MY_MOON_WORDS.itemWords);
    fireEvent.blur(words);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(words, { target: { value: "Mapped and labelled the shelves" } });
    fireEvent.blur(words);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ text: "Mapped and labelled the shelves" }));
  });

  it("offers Outside my roles, and then the role the work belongs to, never a role the member holds", () => {
    renderCard({ roleId: null, accountabilityWords: null });
    const role = screen.getByLabelText(MY_MOON_WORDS.role) as HTMLSelectElement;
    expect(role.value).toBe("");
    expect(Array.from(role.options).map((o) => o.text)).toContain(OUTSIDE_MY_ROLES);
    const belongs = screen.getByLabelText(MY_MOON_WORDS.belongsTo) as HTMLSelectElement;
    const names = Array.from(belongs.options).map((o) => o.text);
    expect(names).toContain("Water steward");
    expect(names).not.toContain("Seed keeper");
  });

  it("moving an item to another role clears its accountability in the same save", async () => {
    const onSave = renderCard();
    fireEvent.change(screen.getByLabelText(MY_MOON_WORDS.role), { target: { value: "" } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ roleId: null, accountabilityWords: null }));
  });

  it("offers Members and Approvers only for who sees it", () => {
    renderCard();
    const sees = screen.getByLabelText(MY_MOON_WORDS.whoSees) as HTMLSelectElement;
    expect(Array.from(sees.options).map((o) => o.text)).toEqual(["Members", "Approvers only"]);
  });

  it("is read-only once the recap is sent", () => {
    const onSave = renderCard({}, false);
    const keep = screen.getByRole("button", { name: "Drop" }) as HTMLButtonElement;
    expect(keep.disabled).toBe(true);
    fireEvent.click(keep);
    expect(onSave).not.toHaveBeenCalled();
    expect((screen.getByLabelText(MY_MOON_WORDS.itemWords) as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("shows the server's refusal under the card", async () => {
    const onSave = vi.fn(async () => "This item names another member. Reword it to say what you delivered.");
    render(<ItemCard item={item()} roles={ROLES} seasonGoals={[]} ownGoals={[]} villageRoles={[]} editable onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: TASK_STATUS_WORDS.partly }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
