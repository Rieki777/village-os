/**
 * "Come as a guest": a signed-out visitor says they are coming to a public
 * gathering with a name and an email, and confirms from the link we send
 * (the comms build spec 5.8).
 *
 * The card shows the door only where it can open: the village's email open to
 * everyone (the comms module reaches a signed-out visitor only when it is
 * public), a public, scheduled, free gathering or festival that has not begun.
 * The gathering's own guest switch is the server's to answer, so pressing the
 * door asks it first and says why when it is closed.
 *
 * Honest about the email: nothing is held until the link is pressed, and the
 * form says so before anybody types. The time zone is read from the browser,
 * so the emails can give the time in theirs too.
 *
 * Member page: semantic theme tokens, never numbered grays.
 */
import { useState } from "react";
import type { CalendarItem } from "@shared/gatherings";
import type { GuestDoor } from "@shared/comms/guests";
import { useModule } from "@/modules/ModuleProvider";

const jsonHeaders = (): Record<string, string> => ({ "Content-Type": "application/json" });

/** True when this card may show the door at all; the server still has the last word. */
export function mayOfferGuestDoor(g: Pick<CalendarItem, "kind" | "layer" | "status" | "seatPrice" | "startsAt">, now = Date.now()): boolean {
  return (
    (g.kind === "gathering" || g.kind === "festival") &&
    g.layer === "public" &&
    g.status === "scheduled" &&
    (g.seatPrice ?? 0) === 0 &&
    Date.parse(g.startsAt) > now
  );
}

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export default function GuestRsvpForm({ gathering }: { gathering: CalendarItem }) {
  const comms = useModule("comms");
  const [stage, setStage] = useState<"closed" | "checking" | "form" | "sent" | "shut">("closed");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  if (!comms || comms.lifecycle !== "public" || !mayOfferGuestDoor(gathering)) return null;
  const occ = gathering.occurrenceKey ?? "";
  const base = `/api/events/${encodeURIComponent(gathering.id)}/guest-rsvp`;

  const open = async () => {
    setStage("checking");
    setProblem(null);
    try {
      const res = await fetch(`${base}?occurrence=${encodeURIComponent(occ)}`, { headers: jsonHeaders() });
      const door = (await res.json().catch(() => null)) as GuestDoor | null;
      if (!res.ok || !door) {
        setSaid("This didn't load. Try again in a moment.");
        setStage("shut");
      } else if (door.open) setStage("form");
      else {
        setSaid(door.message ?? "This one is for members. Ask a member to bring you.");
        setStage("shut");
      }
    } catch {
      setSaid("This didn't load. Try again in a moment.");
      setStage("shut");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name, email, timezone: browserZone(), occurrenceKey: occ || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setProblem(String(body?.error ?? "That didn't go through. Try again."));
      else {
        setSaid(String(body?.message ?? "Check your email. Press the link inside to save your place."));
        setStage("sent");
      }
    } catch {
      setProblem("That didn't go through. Try again.");
    }
    setBusy(false);
  };

  if (stage === "closed" || stage === "checking") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={open}
          disabled={stage === "checking"}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40"
        >
          Come as a guest
        </button>
      </div>
    );
  }

  if (stage === "shut" || stage === "sent") {
    return (
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {said}
      </p>
    );
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3" aria-label={`Come to ${gathering.title} as a guest`}>
      <p className="text-sm text-foreground">Come as a guest. No account needed.</p>
      <label className="block text-xs text-muted-foreground">
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          autoComplete="name"
          className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground"
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Your email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={191}
          autoComplete="email"
          inputMode="email"
          className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        We email you a link. Your place is saved when you press it. We only write about this gathering, and every email can stop
        the rest.
      </p>
      {problem && (
        <p role="alert" className="text-xs text-red-700">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim() || !email.trim()}
        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-deep text-white border border-teal-deep hover:bg-teal-deep-dark disabled:opacity-40"
      >
        Email me the link
      </button>
    </form>
  );
}
