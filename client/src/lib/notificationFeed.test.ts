import { describe, expect, it } from "vitest";
import { BATCH_AT, batchRows, buildFeed, unreadIdsOf, type FeedItem } from "./notificationFeed";

const item = (over: Partial<FeedItem> & { id: string; type: string }): FeedItem => ({
  title: `title for ${over.id}`,
  body: null,
  link: null,
  isRead: false,
  at: "2026-08-20T10:00:00.000Z",
  ...over,
});

const many = (type: string, n: number, over: Partial<FeedItem> = {}) =>
  Array.from({ length: n }, (_, i) =>
    item({ id: `${type}-${i}`, type, at: new Date(Date.UTC(2026, 7, 20, 10, i)).toISOString(), ...over }),
  );

describe("batchRows", () => {
  it("leaves a run below the threshold alone", () => {
    const rows = batchRows(many("gratitude", BATCH_AT - 1));
    expect(rows).toHaveLength(BATCH_AT - 1);
    expect(rows.every((r) => r.batched)).toBe(false);
  });

  it("collapses the threshold and above into one line carrying the count", () => {
    const rows = batchRows(many("gratitude", 11));
    expect(rows).toHaveLength(1);
    expect(rows[0].batched).toBe(true);
    expect(rows[0].title).toContain("11");
    expect(rows[0].items).toHaveLength(11);
    expect(rows[0].unread).toBe(11);
  });

  it("never lets a batched row carry a link, because its members point at different objects", () => {
    const rows = batchRows(many("library", 5, { link: "/library" }));
    expect(rows[0].batched).toBe(true);
    expect(rows[0].link).toBeNull();
    // Every member keeps its own, so the expansion is where the links live.
    expect(rows[0].items.every((i) => i.link === "/library")).toBe(true);
  });

  it("keeps read and unread in separate batches, so a new one cannot hide in an old pile", () => {
    const rows = batchRows([...many("gratitude", 6, { isRead: true }), item({ id: "fresh", type: "gratitude" })]);
    expect(rows).toHaveLength(2);
    const fresh = rows.find((r) => !r.batched);
    expect(fresh?.key).toBe("fresh");
    expect(fresh?.unread).toBe(1);
    const settled = rows.find((r) => r.batched);
    expect(settled?.unread).toBe(0);
  });

  it("fills the second line with the kind's blurb only where the row carries no body", () => {
    const [withBody, without] = batchRows([
      item({ id: "a", type: "gratitude", body: "thank you for the pump", at: "2026-08-20T11:00:00.000Z" }),
      item({ id: "b", type: "gratitude", at: "2026-08-20T10:00:00.000Z" }),
    ]);
    expect(withBody.detail).toBe("thank you for the pump");
    expect(without.detail).toContain("thank you");
    expect(without.detail).not.toBe(without.title);
  });

  it("never batches a restorative intake, and shows each one's words whole", () => {
    // The intake's email carries the title alone, so this row is the one place
    // its recipient reads the words, and every intake carries the same title.
    const words = "Somebody wrote a long account of what happened. ".repeat(20);
    const unread = batchRows(many("restorative_intake", BATCH_AT + 2, { title: "A private intake is waiting for you", body: words }));
    expect(unread).toHaveLength(BATCH_AT + 2);
    expect(unread.every((r) => !r.batched && r.whole && r.detail === words)).toBe(true);
    // Read ones too: reading a row marks it read, and a read pile would batch.
    const read = batchRows(many("restorative_intake", BATCH_AT + 1, { body: words, isRead: true }));
    expect(read).toHaveLength(BATCH_AT + 1);
    expect(read.every((r) => !r.batched && r.whole)).toBe(true);
  });

  it("every other kind still batches, and a single row's body is still cut to fit", () => {
    expect(batchRows(many("moderation", BATCH_AT))[0].batched).toBe(true);
    const [one] = batchRows([item({ id: "g", type: "gratitude", body: "thank you" })]);
    expect(one.whole).toBe(false);
  });

  it("orders newest first", () => {
    const rows = batchRows([
      item({ id: "old", type: "badge", at: "2026-08-01T00:00:00.000Z" }),
      item({ id: "new", type: "badge", at: "2026-08-20T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["new", "old"]);
  });
});

describe("buildFeed", () => {
  it("sorts every type into the section it belongs to", () => {
    const groups = buildFeed([
      item({ id: "v", type: "ballot_opened", isRead: true }),
      item({ id: "g", type: "gratitude", isRead: true }),
      item({ id: "q", type: "quest_consented", isRead: true }),
    ]);
    expect(groups.map((g) => g.id).sort()).toEqual(["decisions", "people", "work"]);
  });

  it("floats a section carrying something unread above the settled ones", () => {
    // `village` is declared LAST, so seeing it first proves the unread split
    // is doing the work and not the declaration order.
    const groups = buildFeed([
      item({ id: "d", type: "ballot_opened", isRead: true }),
      item({ id: "b", type: "badge", isRead: false }),
    ]);
    expect(groups[0].id).toBe("village");
    expect(groups[0].unread).toBe(1);
    expect(groups[1].id).toBe("decisions");
  });

  it("keeps the declared order inside each half", () => {
    const groups = buildFeed([
      item({ id: "b", type: "badge" }),
      item({ id: "d", type: "ballot_opened" }),
      item({ id: "e", type: "exchange" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["decisions", "economy", "village"]);
  });

  it("puts a type it has never heard of somewhere sensible instead of dropping it", () => {
    const groups = buildFeed([item({ id: "x", type: "some_future_module_event" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("village");
    expect(groups[0].rows[0].detail).toBeTruthy();
  });

  it("counts a group's unread across batched and single rows together", () => {
    const groups = buildFeed([...many("gratitude", 5), item({ id: "solo", type: "message" })]);
    expect(groups[0].id).toBe("people");
    expect(groups[0].unread).toBe(6);
  });
});

describe("unreadIdsOf", () => {
  it("returns only the ids a click should actually mark", () => {
    const [row] = batchRows([
      ...many("library", 4, { isRead: true }),
      // A fifth, unread, batches separately; take the read pile deliberately.
    ]);
    expect(unreadIdsOf(row)).toEqual([]);
  });

  it("returns every unread member of a batch", () => {
    const rows = batchRows(many("library", 4));
    expect(unreadIdsOf(rows[0])).toHaveLength(4);
  });
});
