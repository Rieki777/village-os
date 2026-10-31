/**
 * YOUR PARTIES (approved design, Rye, 2026-10-30): the top of the board's
 * right-hand column.
 *
 * A party is the shared chat of a quest or task this member is on. When work
 * forms around two or more people it forms a party for that group chat (Rye,
 * 2026-10-30), so there is one place to follow its conversation. PR #642 made
 * those chats; this card lists them.
 *
 * Nothing new is fetched. The rows come off the dashboard's one read of
 * /api/messages (useDashData), which already sends each work thread's members
 * by first name, its last line and who wrote it, and its unread count.
 *
 * Draws nothing while that read has not answered, when it failed, or when the
 * messaging module is off. A member with no parties yet gets one honest line.
 */
import { Link } from "wouter";
import { useModuleOn } from "@/modules/ModuleProvider";
import { initialsOf, isWorkThread, type InboxConversation } from "@/lib/messaging";
import type { DashData } from "./useDashData";
import { H2, LINK, PANEL } from "./dashUi";

export interface PartyPerson {
  id: string;
  name: string;
}

export interface Party {
  id: string;
  title: string;
  /**
   * Everyone in the party by first name: the others in the order the API lists
   * them, then the viewer, so a party of 3 shows three faces as the design does.
   */
  people: PartyPerson[];
  /** "Jessica: Trays arrive Monday", or "" when nobody has spoken yet. */
  last: string;
  unread: number;
}

/** How many parties the card lists before the Messages link takes over. */
const MAX_ROWS = 4;
/** How many faces overlap at the start of a row. */
const MAX_FACES = 3;

/** The party rows for one viewer, newest first as the inbox already is. */
export function partiesOf(
  conversations: ReadonlyArray<
    Pick<InboxConversation, "id" | "kind" | "contextType" | "title" | "name" | "preview" | "lastAuthorId" | "unreadCount" | "muted"> & {
      members?: InboxConversation["members"];
    }
  >,
  viewerId: string,
): Party[] {
  return conversations.filter(isWorkThread).map((c) => {
    const live = (c.members ?? []).filter((m) => !m.left);
    const people = [...live.filter((m) => m.userId !== viewerId), ...live.filter((m) => m.userId === viewerId)].map((m) => ({
      id: m.userId,
      name: m.name?.trim() || "A member",
    }));
    const preview = String(c.preview ?? "").trim();
    const author =
      c.lastAuthorId == null
        ? null
        : c.lastAuthorId === viewerId
          ? "You"
          : (c.members ?? []).find((m) => m.userId === c.lastAuthorId)?.name?.trim() || "A member";
    return {
      id: String(c.id),
      title: String(c.title || c.name || "Shared work"),
      people,
      last: preview ? (author ? `${author}: ${preview}` : preview) : "",
      unread: c.muted ? 0 : Math.max(0, Math.trunc(Number(c.unreadCount) || 0)),
    };
  });
}

/** The person colours, all `dash-*` tokens, each with the dark ink it carries. */
const FACE_TONES = [
  "bg-dash-gold text-dash-gold-ink",
  "bg-dash-cash text-dash-cash-ink",
  "bg-dash-thanks text-dash-thanks-ink",
  "bg-dash-session text-dash-gold-ink",
  "bg-dash-voice text-dash-cash-ink",
];

export default function PartiesCard({ data }: { data: Pick<DashData, "messages"> }) {
  const on = useModuleOn("messaging");
  if (!on || !data.messages) return null;
  const parties = data.messages.parties;
  const rows = parties.slice(0, MAX_ROWS);

  return (
    <section aria-labelledby="party-h" className={`${PANEL} flex flex-col gap-3 p-5 sm:p-6`}>
      <div className="flex items-baseline gap-3">
        <h2 id="party-h" className={`${H2} flex-1`}>
          Your parties
        </h2>
        <Link href="/messages" className={`${LINK} text-sm`}>
          Messages
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          No parties yet. When you share a quest or task with someone, its chat gathers here.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/messages/${encodeURIComponent(p.id)}`}
                className="flex items-center gap-3 rounded-[14px] border border-dash-edge bg-dash-raised p-3.5 text-foreground no-underline hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex shrink-0" aria-hidden="true">
                  {p.people.slice(0, MAX_FACES).map((person, i) => (
                    <span
                      key={person.id}
                      data-testid="party-face"
                      className={`-mr-2 flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-card text-[13px] font-semibold ${FACE_TONES[i % FACE_TONES.length]}`}
                    >
                      {initialsOf(person.name)}
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1 pl-2.5">
                  <span className="block truncate text-[15px] font-medium">{p.title}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                    {p.last || "Nobody has written yet"}
                  </span>
                </span>
                {p.unread > 0 ? (
                  <span data-testid="party-unread" className="h-2.5 w-2.5 shrink-0 rounded-full bg-dash-gold">
                    <span className="sr-only">{p.unread === 1 ? "1 unread" : `${p.unread} unread`}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
