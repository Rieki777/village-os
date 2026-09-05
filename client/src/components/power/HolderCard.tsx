/**
 * The seat card (0083, spec 5): role, circle, who holds it, their focus,
 * when the term ends, HOW THE NEXT HOLDER IS CHOSEN (P6, the heart of "how
 * power is held"), and one action: raise a hand on an open seat, or reach
 * the holder through the relay. When the circle's way of deciding is hypha,
 * the card carries the DHO chip (P7), deep-linking through the tools module.
 *
 * Tapping an avatar applies the person filter (spec 7), so "what else does
 * this person hold" is one tap, not a search.
 */
import { useEffect, useState } from "react";
import { ExternalLink, Hand, Mail } from "lucide-react";
import { useHypha } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { ExampleChip } from "@/components/ExamplesBanner";
import SeatHistory from "./SeatHistory";
import type { PowerCircle, PowerData, PowerHolder, PowerSeat } from "./types";
import { daysUntil } from "./types";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/**
 * WHAT A TERM'S DATE SAYS ONCE IT HAS PASSED.
 *
 * Two words used to live here and on the holder chip further down: one that
 * put a term in the past tense as a thing that had failed, and one that
 * called the person holding the seat late. They were the only public deficit
 * language in the whole succession model, they sat on a shared surface with a
 * named person attached, and they described something the code does not do.
 * `isLapsed` revokes nothing and writes nothing, by design, and its own note
 * in `server/lib/orgChart.ts` says so: a lapsed holding is still a holding.
 *
 * A term reaching its date is the village's own agreement asking to be made
 * again. The seat has not slipped and its holder has taken nothing away from
 * anyone. The date arrived, which is what dates do.
 *
 * `seatLapse.test.ts` and `succession.copy.test.ts` hold the words to this.
 */
function termWords(iso: string | null | undefined): string | null {
  const d = daysUntil(iso);
  if (d === null) return null;
  if (d < 0) return "ready to be re-chosen";
  if (d === 0) return "term ends today";
  if (d <= 30) return `term ends in ${d} day${d === 1 ? "" : "s"}`;
  return `term ends ${new Date(iso!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function HolderCard({
  seat,
  circle,
  data,
  onPickPerson,
}: {
  seat: PowerSeat;
  circle: PowerCircle | null;
  data: PowerData;
  /** An avatar tap filters the map to that person's seats. */
  onPickPerson?: (holderKey: string, name: string | null) => void;
}) {
  const hypha = useHypha();
  const [composing, setComposing] = useState(false);
  const [raising, setRaising] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  // Selection changed: clear in-flight composer state so a half-written note
  // to one person never lands under another name.
  useEffect(() => {
    setComposing(false);
    setRaising(false);
    setMessage("");
    setNote("");
    setStatus("");
  }, [seat.id]);

  const glossary = data.power.glossary;
  const method =
    circle?.decidesBy ?? data.power.decidesBy ?? null;
  const methodDef = glossary.decidesBy.find((d) => d.id === method) ?? null;
  const howChosen = glossary.howChosen.find((h) => h.id === seat.howChosen) ?? null;
  const howChosenLine =
    seat.howChosen === "other"
      ? seat.howChosenGloss
      : howChosen
        ? howChosen.label
        : null;

  // An agent is already excluded by `kind !== "documented"`, since that is
  // what an agent is seated as. Left inherited rather than restated: a second
  // clause here would be a guard that can drift away from the model (0142).
  const contactable = seat.holders.find((h) => h.kind !== "documented" && h.userId) ?? null;

  const contact = (toUserId: string) => {
    setStatus("");
    fetch("/api/map/contact", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId, roleId: seat.id, circleId: circle?.id, message }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not send");
        setStatus("Sent. They'll get an email they can reply to directly.");
        setComposing(false);
        setMessage("");
      })
      .catch((e) => setStatus(e.message));
  };

  const raiseHand = () => {
    setStatus("");
    fetch(`/api/map/roles/${seat.id}/raise-hand`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not raise your hand");
        setStatus("Hand raised. The founding team will be in touch.");
        setRaising(false);
        setNote("");
      })
      .catch((e) => setStatus(e.message));
  };

  const term = termWords(seat.termEnds);

  return (
    <div data-power-card>
      <div className="mb-2">
        <h3 className="font-display text-lg font-bold text-foreground">
          {seat.name}
          {seat.isExample && <ExampleChip className="ml-2 align-middle" />}
        </h3>
        {circle && <p className="text-xs text-teal-deep">{circle.name}</p>}
      </div>

      {/* AIM AND DOMAIN, THE PAIR THAT ANSWERS "IS THIS THE SEAT TO ASK".
          Sociocracy defines a role by both: what it works toward, and what
          it decides on. Only the aim was ever shown, so a reader could see
          what a seat was FOR and not what it had authority over, which is
          the half that tells you whether to bring it your question. */}
      {seat.description && <p className="text-sm text-muted-foreground mb-3">{seat.description}</p>}

      {(seat.domain || (seat.accountabilities?.length ?? 0) > 0) && (
        <dl className="mb-3 space-y-2">
          {seat.domain && (
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Decides on</dt>
              <dd className="text-sm text-foreground">{seat.domain}</dd>
            </div>
          )}
          {(seat.accountabilities?.length ?? 0) > 0 && (
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Answerable for</dt>
              <dd className="text-sm text-foreground">
                <ul className="list-disc pl-4 space-y-0.5">
                  {seat.accountabilities!.map((a, i) => (
                    <li key={`${a}-${i}`}>{a}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="text-xs text-muted-foreground space-y-1 mb-3">
        <p>
          {seat.holderCount} of {seat.seats} held
          {term && <span className="ml-2 text-amber-700">{term}</span>}
        </p>
        {howChosenLine && <p>Next holder: {howChosenLine.toLowerCase()}</p>}
        {seat.representsCircle && circle && <p>Speaks for {circle.name} on how it decides.</p>}
        {methodDef && (
          <p className="flex items-center gap-1.5 flex-wrap">
            <span>Decisions here pass by {methodDef.label.toLowerCase()}.</span>
            {method === "hypha" && hypha.configured && (
              <a
                href={hypha.links["map"] ?? hypha.orgUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full font-medium hover:bg-teal-deep/20"
              >
                Binding record: Hypha DHO <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
          </p>
        )}
      </div>

      {data.viewer.viewPeople && seat.holders.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {seat.holders.map((h: PowerHolder, i) => (
            <button
              key={h.userId ?? `${h.name}-${i}`}
              type="button"
              onClick={() => onPickPerson?.(h.userId ?? h.name ?? "", h.name)}
              className="flex items-center gap-1.5 text-xs bg-muted text-foreground pl-1 pr-2 py-1 rounded-full hover:bg-muted/70"
              aria-label={`Show every role ${h.name ?? "this person"} holds`}
            >
              {h.avatar ? (
                <img src={h.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <span className="w-5 h-5 rounded-full bg-teal-deep/15 text-teal-deep text-[10px] flex items-center justify-center font-semibold">
                  {(h.name ?? "?").slice(0, 1)}
                </span>
              )}
              {h.name}
              {/* Said out loud, next to the name (0142). A village should be
                  able to see at a glance which of its seats a person holds and
                  which a machine does, and this is the only place the two are
                  side by side. */}
              {h.isAgent && <span className="text-muted-foreground">· an agent</span>}
              {h.focus && <span className="text-muted-foreground">· {h.focus}</span>}
              {/* `lapsed` covers a term that reached its date AND a seating
                  made in a season that has since turned. One word has to be
                  true of both, and nothing has been taken from this person in
                  either case, so the word says what the seat is waiting for
                  rather than what its holder failed to do. */}
              {h.lapsed && <span className="text-amber-700">· ready to be re-chosen</span>}
            </button>
          ))}
        </div>
      )}

      {/* One action (spec 5). Raising a hand on an example seat is refused
          server-side, so the button never shows for one. */}
      {seat.isExample ? null : seat.vacant ? (
        raising ? (
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Why this role calls to you (optional)"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
            />
            <div className="flex gap-2">
              <button type="button" onClick={raiseHand} className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">
                Raise my hand
              </button>
              <button type="button" onClick={() => setRaising(false)} className="text-sm text-muted-foreground">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRaising(true)}
            className="inline-flex items-center gap-2 text-sm bg-amber/90 text-teal-deep rounded-lg px-4 py-2 font-semibold"
          >
            <Hand className="w-4 h-4" aria-hidden="true" /> This role is open, raise your hand
          </button>
        )
      ) : contactable && data.viewer.viewPeople ? (
        composing ? (
          <div className="space-y-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={`A few words for ${contactable.name}…`}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
            />
            <p className="text-[11px] text-muted-foreground">
              They'll receive this by email, with YOUR email address as the reply-to, so replying reaches you directly.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => contactable.userId && contact(contactable.userId)}
                disabled={!message.trim()}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
              >
                Send
              </button>
              <button type="button" onClick={() => setComposing(false)} className="text-sm text-muted-foreground">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-2 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
          >
            <Mail className="w-4 h-4" aria-hidden="true" /> Contact {contactable.name}
          </button>
        )
      ) : seat.holders.length > 0 && data.viewer.viewPeople ? (
        <p className="text-xs text-muted-foreground">Held, and not reachable through the map yet.</p>
      ) : null}

      {status && <p className="text-xs text-teal-deep mt-3">{status}</p>}

      {/* THE SEAT OUTLIVES ITS HOLDER, and until now nothing said so. The
          card above is the seat right now; this is every person who has
          carried it. An example seat's history is seeded demo rows, so it is
          left off rather than presented as a village's own record. */}
      {!seat.isExample && (
        <div className="mt-4 border-t border-border pt-3">
          <SeatHistory roleId={seat.id} canSeePeople={data.viewer.viewPeople} />
        </div>
      )}
    </div>
  );
}
