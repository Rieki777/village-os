/**
 * DOORS, NEVER RUNGS (the prune, waves 1 and 2, display only; 11 Nov 2026).
 *
 * The stage ladder is the last step of the one capability gate, and it stays
 * exactly as it is: the ids, the order, the rules, every floor and every
 * multiplier. What changes is how a person SEES their own progress. Nothing
 * scores or ranks a person (docs/DESIGN_RULE.md, line 10), so a crossing is
 * told as the door it opened ("You can now cast a vote on a ballot") and never
 * as the rung it reached ("Stage 5", "you advanced to Member").
 *
 * Everything here is words and grouping over facts the server already holds:
 * `recordStageEvent`'s own diff of capabilities, and the capability catalogue
 * the progression payload serves. No gate reads this file.
 */

/**
 * "Cast a vote on a ballot" becomes "You can now cast a vote on a ballot".
 *
 * Capability labels are written as imperatives that start with a capital
 * (shared/capabilities.ts, CAPABILITY_LABELS), so lowering the first letter is
 * enough. A label that starts with two capitals is an acronym and keeps them.
 */
export function youCanNow(label: string): string {
  const words = String(label ?? "").trim();
  if (!words) return "";
  const keep = /^[A-Z]{2}/.test(words);
  return `You can now ${keep ? words : words.charAt(0).toLowerCase() + words.slice(1)}`;
}

/**
 * The private notice for a crossing: the door it opened, said once.
 *
 * `labels` are the human labels of the capabilities the crossing opened, in
 * the order the server diffed them. One door names itself in the title. More
 * than one names the first and lists every door in the body. A crossing that
 * opened nothing still says something kind and true, and never names a rung.
 */
export function doorNotice(labels: readonly string[]): { title: string; body: string | null } {
  const doors = labels.map((l) => String(l ?? "").trim()).filter(Boolean);
  if (doors.length === 0) return { title: "A new step on your walk", body: null };
  const first = youCanNow(doors[0]!);
  const title = `A door opened: ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
  if (doors.length === 1) return { title, body: null };
  return { title, body: doors.map((d) => `${youCanNow(d)}.`).join(" ") };
}

/**
 * A badge that grows is a fuller flower, never a number (C15). The tier stays
 * in the data and in the dedupe key; the words carry no "x3".
 */
export function badgeNoticeTitle(name: string, tier: number): string {
  return tier > 1 ? `Your ${name} badge grew fuller` : `Badge earned: ${name}`;
}

export interface DoorCapability {
  label: string;
  held: boolean;
  opens: { via: "stage"; stage: string } | { via: "appointment" };
}

/**
 * The doors a person has walked through, grouped by the crossing that opened
 * them, in the ladder's own order. Only HELD powers that a stage opened are
 * doors here: a power a role or a badge granted is entrusted, and is drawn
 * with the roles. Stages that opened nothing are left out, because a door is
 * something that opened. Unknown stage ids sort last and are kept, never
 * dropped, so a village's renamed or hidden stage still shows its door.
 */
export function doorsWalked(
  catalogue: readonly DoorCapability[],
  stages: ReadonlyArray<{ id: string }>,
): Array<{ stage: string; doors: string[] }> {
  const order = (id: string) => {
    const i = stages.findIndex((s) => s.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const groups = new Map<string, string[]>();
  for (const c of catalogue) {
    if (!c.held || c.opens.via !== "stage") continue;
    const list = groups.get(c.opens.stage) ?? [];
    list.push(c.label);
    groups.set(c.opens.stage, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([stage, doors]) => ({ stage, doors }));
}
