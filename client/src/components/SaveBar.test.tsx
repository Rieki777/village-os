// @vitest-environment jsdom
/**
 * The floating save bar shows up on a change, goes on save or discard, says
 * "Saved" only for an answer that was ok, and the leave guard asks while any
 * change is waiting.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import SaveBar, { saveEach, type SaveResult } from "./SaveBar";
import { confirmLeave, resetUnsavedForTests, unsavedCount, useDraftDoc } from "@/lib/unsavedChanges";

function Surface({ onSave }: { onSave: (name: string) => Promise<SaveResult> }) {
  const [loaded] = useState<Record<string, unknown>>({ name: "Hearth" });
  const doc = useDraftDoc(loaded);
  return (
    <div>
      <label>Name<input value={String(doc.draft?.name ?? "")} onChange={(e) => doc.patch({ name: e.target.value })} /></label>
      <SaveBar
        count={doc.count}
        onDiscard={doc.discard}
        onSave={async () => {
          const r = await onSave(String(doc.draft?.name));
          if (r.ok) doc.accept();
          return r;
        }}
      />
    </div>
  );
}

const bar = () => document.querySelector("[data-save-bar]");

describe("SaveBar", () => {
  afterEach(() => { cleanup(); resetUnsavedForTests(); vi.restoreAllMocks(); });

  it("appears on a change and disappears on discard", async () => {
    render(<Surface onSave={async () => ({ ok: true })} />);
    expect(bar()).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hearth Circle" } });
    expect(bar()).not.toBeNull();
    expect(screen.getByText("1 change not saved yet")).toBeTruthy();
    expect(unsavedCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(bar()).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Hearth");
    expect(unsavedCount()).toBe(0);
  });

  it("says Saved only after an ok answer, then goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSave = vi.fn(async () => ({ ok: true as const }));
    render(<Surface onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hearth Circle" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(onSave).toHaveBeenCalledWith("Hearth Circle");
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(unsavedCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(bar()).toBeNull();
    vi.useRealTimers();
  });

  it("still says Saved when the surface's count clears a render after the save answered", async () => {
    // A bar that draws for several surfaces reads its total through the
    // registry, so a count a save just cleared can read as it was for a beat.
    // That stale number is not a new edit and must not cancel "Saved".
    function Late() {
      const [n, setN] = useState(0);
      return (
        <>
        <button type="button" onClick={() => setN(1)}>Edit</button>
        <SaveBar
          count={n}
          onDiscard={() => setN(0)}
          onSave={async () => {
            setTimeout(() => setN(0), 20);
            return { ok: true };
          }}
        />
        </>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const save = await screen.findByRole("button", { name: "Save" });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(unsavedCount()).toBe(0));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("keeps the bar and the change when the server says no", async () => {
    render(<Surface onSave={async () => ({ ok: false, reason: "You do not hold that power." })} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hearth Circle" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("alert").textContent).toContain("You do not hold that power.");
    expect(screen.queryByText("Saved")).toBeNull();
    expect(bar()).not.toBeNull();
    expect(unsavedCount()).toBe(1);
  });

  it("saves with Ctrl+S while changes wait", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }));
    render(<Surface onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("asks before leaving while a change waits, and not after", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Surface onSave={async () => ({ ok: true })} />);
    expect(confirmLeave()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    expect(confirmLeave()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("stops a link click while a change waits, when the person stays", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<><a href="/elsewhere">Away</a><Surface onSave={async () => ({ ok: true })} /></>);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    await waitFor(() => expect(unsavedCount()).toBe(1));
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByText("Away").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("draws one bar for two surfaces, saves both, and names the one that failed", async () => {
    const a = vi.fn(async () => ({ ok: true as const }));
    const b = vi.fn(async () => ({ ok: false as const, reason: "Refused." }));
    function Two() {
      const [x, setX] = useState(0);
      const [y, setY] = useState(0);
      return (
        <>
          <button onClick={() => { setX(1); setY(2); }}>edit</button>
          <SaveBar count={x} onSave={async () => { const r = await a(); setX(0); return r; }} onDiscard={() => setX(0)} what="Circles" />
          <SaveBar count={y} onSave={b} onDiscard={() => setY(0)} what="Onboarding path" />
        </>
      );
    }
    render(<Two />);
    fireEvent.click(screen.getByText("edit"));
    await waitFor(() => expect(screen.getByText("3 changes not saved yet")).toBeTruthy());
    expect(document.querySelectorAll("[data-save-bar]")).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Onboarding path");
    expect(alert).toContain("Refused.");
    await waitFor(() => expect(screen.getByText("2 changes not saved yet")).toBeTruthy());
  });

  it("saveEach keeps only the failed keys", async () => {
    const { result, failedKeys } = await saveEach([
      { key: "a", label: "A", run: async () => null },
      { key: "b", label: "B", run: async () => "refused" },
      { key: "c", label: "C", run: async () => { throw new Error("offline"); } },
    ]);
    expect(result.ok).toBe(false);
    expect(Array.from(failedKeys)).toEqual(["b", "c"]);
  });
});
