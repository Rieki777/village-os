/**
 * THE CONFLICT AGREEMENT ON /governance: what anybody can read, and what a
 * member can do from it.
 *
 * PUBLIC, WITH ROLES ONLY. The body comes from GET /api/conflict-agreement/public,
 * which names roles and never people: outside contacts by organisation or role,
 * no safety contacts, and every piece of text naming a member of the village
 * withheld by the server (server/lib/conflictAgreement.ts). This component
 * prints what it is given and says when something was held back.
 *
 * NO AGREEMENT YET: the page keeps what it printed before, the village's
 * restorative steps from its exit policy (`VillageConflictSteps`).
 *
 * FOR A MEMBER, the body is the members' copy, whole: the page never tells a
 * member that a part shows to members and then hides it from them. And four
 * more things, all from GET /api/conflict-agreement:
 *   - the safety contacts, which are members-only;
 *   - the OMBUDS DOOR: ask an outside contact to talk. The server keeps who
 *     asked, when and which contact, and answers with how to reach them. No
 *     words are sent anywhere, and the button says so before it is pressed.
 *     A contact the member has asked keeps showing how to reach them;
 *   - an open change vote, with the agreement it would adopt in full, since
 *     the vote's own page holds back names and the members-only parts;
 *   - the editor, for whoever the server says holds the pen, loaded only
 *     when opened.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import VillageConflictSteps from "@/components/governance/VillageConflictSteps";
import {
  APPEAL_NOT_ENFORCED,
  LADDER_RUNGS,
  contactLabel,
  type ConflictAgreementContent,
  type LadderRungNumber,
  type SafetyContact,
} from "@shared/conflictAgreement";
import type { AgreementPayload } from "./ConflictAgreementEditor";

const ConflictAgreementEditor = lazy(() => import("./ConflictAgreementEditor"));

/** Text the public may read, or null where the server withheld it for naming a member. */
type Guarded = string | null;

/** What GET /api/conflict-agreement/public answers, as `publicAgreementView` builds it. */
export interface PublicAgreement {
  steps: Array<{ what: Guarded; whoInRoom: Guarded }>;
  careRole: { id: string; name: Guarded } | null;
  coverRole: { id: string; name: Guarded } | null;
  replyHours: number | null;
  outsideContacts: Array<{ id: string; label: Guarded }>;
  whenPowerInvolved: { role: Guarded; outsideContact: Guarded; words: Guarded };
  consequencesLadder: { rungs: Array<{ rung: number; words: Guarded }>; appeal: Guarded };
  practices: Array<{ name: Guarded; when: Guarded }>;
  version: number;
  adoptedHow: "founders" | "ballot" | null;
  adoptedAt: string | null;
  reviewDate: string | null;
  withheld: boolean;
}

type MembersView = AgreementPayload & { yourAsks: Array<{ id: string; contactId: string; contactLabel: string; askedAt: string }> };

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** Where the server held something back, the page says so in the same place. */
const WITHHELD = "Names a person, so members only.";

const show = (text: Guarded) => (text === null ? <em className="text-stone-500">{WITHHELD}</em> : text);

const hours = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString();

/**
 * A members' copy in the card's shape, with nothing withheld: roles by name,
 * outside contacts by organisation or role (their people and how to reach them
 * are listed with the ombuds door), the stamp when there is one.
 */
export function readable(
  a: ConflictAgreementContent & { version?: number; adoptedHow?: PublicAgreement["adoptedHow"]; adoptedAt?: string | null },
  roles: ReadonlyArray<{ id: string; name: string }>,
): PublicAgreement {
  const role = (id: string) => {
    const r = id ? roles.find((x) => x.id === id) : undefined;
    return r ? { id: r.id, name: r.name } : null;
  };
  const powerContact = a.outsideContacts.find((c) => c.id === a.whenPowerInvolved.outsideContactId);
  return {
    steps: a.steps,
    careRole: role(a.careRole),
    coverRole: role(a.coverRole),
    replyHours: a.replyHours,
    outsideContacts: a.outsideContacts.map((c) => ({ id: c.id, label: contactLabel(c) })),
    whenPowerInvolved: {
      role: role(a.whenPowerInvolved.roleId)?.name ?? "",
      outsideContact: powerContact ? contactLabel(powerContact) : "",
      words: a.whenPowerInvolved.words,
    },
    consequencesLadder: a.consequencesLadder,
    practices: a.practices,
    version: a.version ?? 0,
    adoptedHow: a.adoptedHow ?? null,
    adoptedAt: a.adoptedAt ?? null,
    reviewDate: a.reviewDate,
    withheld: false,
  };
}

export function AgreementBody({ a }: { a: PublicAgreement }) {
  const outside = a.outsideContacts;
  return (
    <div className="space-y-5 text-stone-700 leading-relaxed">
      <p className="text-sm text-stone-600">
        {a.adoptedAt
          ? `Adopted on ${day(a.adoptedAt)} ${a.adoptedHow === "ballot" ? "by the village's vote" : "by the founders, before the Game started"}.`
          : "A draft the village has not adopted yet."}
        {a.reviewDate ? ` It comes back for review on ${day(a.reviewDate)}.` : ""}
      </p>

      <div>
        <h3 className="font-semibold text-stone-900">When two of us disagree</h3>
        <ol className="mt-2 space-y-2 list-decimal pl-6">
          {a.steps.map((s, i) => (
            <li key={i}>
              {show(s.what)}
              {s.whoInRoom !== "" && <span className="block text-sm text-stone-600">In the room: {show(s.whoInRoom)}</span>}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className="font-semibold text-stone-900">Who hears it first</h3>
        <p className="mt-1">
          {a.careRole ? <>The {show(a.careRole.name)} role{a.coverRole ? <>, and the {show(a.coverRole.name)} role when they cannot</> : null}.</> : "No role is named yet."}
          {a.replyHours !== null ? ` Someone who reaches out hears back within ${hours(a.replyHours)}.` : ""}
        </p>
        {outside.length > 0 && (
          <p className="mt-1">
            Outside the village: {outside.map((c, i) => <span key={c.id}>{i > 0 ? ", " : ""}{show(c.label)}</span>)}.
          </p>
        )}
      </div>

      {/* A withheld name is null, and still a clause: it prints the withheld marker. */}
      {(a.whenPowerInvolved.role !== "" || a.whenPowerInvolved.outsideContact !== "" || a.whenPowerInvolved.words !== "") && (
        <div>
          <h3 className="font-semibold text-stone-900">When it involves someone who holds power here</h3>
          {(a.whenPowerInvolved.role !== "" || a.whenPowerInvolved.outsideContact !== "") && (
            <p className="mt-1">It goes to {show(a.whenPowerInvolved.role !== "" ? a.whenPowerInvolved.role : a.whenPowerInvolved.outsideContact)} instead.</p>
          )}
          {a.whenPowerInvolved.words !== "" && <p className="mt-1">{show(a.whenPowerInvolved.words)}</p>}
        </div>
      )}

      {a.consequencesLadder.rungs.length > 0 && (
        <div>
          <h3 className="font-semibold text-stone-900">Consequences, and how to appeal</h3>
          <ul className="mt-2 space-y-2">
            {a.consequencesLadder.rungs.map((r) => (
              <li key={r.rung}>
                <span className="font-medium text-stone-900">{LADDER_RUNGS[r.rung as LadderRungNumber]?.name}: </span>
                {show(r.words)}
              </li>
            ))}
          </ul>
          {a.consequencesLadder.appeal !== "" && <p className="mt-2">Appeal: {show(a.consequencesLadder.appeal)}</p>}
          <p className="mt-2 text-sm text-stone-600">{APPEAL_NOT_ENFORCED}</p>
        </div>
      )}

      {a.practices.length > 0 && (
        <div>
          <h3 className="font-semibold text-stone-900">What keeps small tensions small</h3>
          <ul className="mt-2 space-y-1 list-disc pl-6">
            {a.practices.map((p, i) => (
              <li key={i}>
                {show(p.name)}
                {p.when !== "" && <>: {show(p.when)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.withheld && <p className="text-sm text-stone-600">Parts of this agreement name people, so they show to members only.</p>}
    </div>
  );
}

/**
 * The ombuds door for one outside contact. Once the member has asked (`asked`,
 * from their own recorded asks), how to reach the contact stays on the page,
 * so looking again never costs another ask.
 */
function OmbudsDoor({
  contact,
  asked,
  onAsked,
}: {
  contact: { id: string; name: string; organisation: string; role: string; howToReach: string };
  asked: boolean;
  onAsked: () => void;
}) {
  const [answer, setAnswer] = useState<{ name: string; howToReach: string; organisation: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = contact.role && contact.organisation ? `${contact.role}, ${contact.organisation}` : contact.role || contact.organisation;
  const reach = answer ?? (asked ? contact : null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/conflict-agreement/ombuds-asks", { method: "POST", headers: headers(), body: JSON.stringify({ contactId: contact.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(String(d?.error ?? "That was not recorded."));
        return;
      }
      setAnswer(d.contact);
      onAsked();
    } catch {
      setError("That did not reach the server, so nothing was recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-2">
      <p className="font-medium text-stone-900">
        {contact.name}
        {label ? `, ${label}` : ""}
      </p>
      {reach ? (
        <p role="status" className="text-sm">
          Reach {reach.name} here: <span className="font-medium">{reach.howToReach}</span>. The village has a note that you asked, and when. What you say to them is yours: nothing was sent.
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-600">
            Asking records that you asked, when, and which contact, and then shows you how to reach them. No words go anywhere, and nobody is sent a notice.
          </p>
          <button type="button" disabled={busy} onClick={() => void ask()} className="min-h-[44px] rounded-lg border border-teal-deep px-3 text-sm font-medium text-teal-deep hover:bg-stone-50 disabled:opacity-50">
            Ask to talk
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** The safety contacts, members-only. */
function SafetyContacts({ contacts }: { contacts: readonly SafetyContact[] }) {
  return (
    <div>
      <h3 className="font-semibold text-stone-900">If it is not something to mediate</h3>
      <p className="mt-1 text-sm">If anyone is in danger now, call local emergency services first. Then:</p>
      <ul className="mt-2 space-y-1 list-disc pl-6 text-sm">
        {contacts.map((c, i) => (
          <li key={i}>
            {c.name}: {c.howToReach}
            {c.when ? ` (${c.when})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An open change vote, and the agreement it would adopt in full. The vote's
 * page withholds names and says of the members-only parts only whether they
 * change, so this is where a member reads what they are voting on.
 */
function OpenVote({ vote, roles }: { vote: NonNullable<MembersView["openBallot"]>; roles: MembersView["roles"] }) {
  const p = vote.proposal;
  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-2">
      <h3 className="font-semibold text-stone-900">A vote to change this agreement is open</h3>
      <p className="text-sm">
        Voting closes on {day(vote.closesAt)}.{" "}
        <a className="font-medium text-teal-deep underline" href={`/decisions/${vote.id}`}>
          Read the vote and cast yours
        </a>
        . The vote's page holds back anything that names a person, and the members-only parts. All of what it would adopt is here.
      </p>
      {p ? (
        <details className="text-sm">
          <summary className="cursor-pointer min-h-[44px] py-2 font-medium text-teal-deep">The agreement this vote would adopt</summary>
          <div className="mt-2 space-y-4">
            <AgreementBody a={readable(p, roles)} />
            {p.safetyContacts.length > 0 ? <SafetyContacts contacts={p.safetyContacts} /> : <p>It names no safety contacts.</p>}
            {p.outsideContacts.length > 0 && (
              <div>
                <h3 className="font-semibold text-stone-900">The people outside the village it names</h3>
                <ul className="mt-2 space-y-1 list-disc pl-6">
                  {p.outsideContacts.map((c) => (
                    <li key={c.id}>
                      {c.name}, {contactLabel(c)}: {c.howToReach}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      ) : (
        <p className="text-sm text-stone-600">What this vote would adopt could not be read just now. The vote's page shows it, with names held back.</p>
      )}
    </div>
  );
}

/** Everything a member adds to the public card. */
function ForMembers({ view, reload }: { view: MembersView; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const a = view.agreement;
  const openLabel = view.pen.mayWrite
    ? view.stored
      ? "Edit the agreement"
      : "Write the agreement"
    : view.pen.mayPropose
      ? "Propose a change"
      : "Read every frame";

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      {a.safetyContacts.length > 0 && <SafetyContacts contacts={a.safetyContacts} />}

      {a.outsideContacts.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-stone-900">Talk to someone outside the village</h3>
          {a.outsideContacts.map((c) => (
            <OmbudsDoor key={c.id} contact={c} asked={view.yourAsks.some((x) => x.contactId === c.id)} onAsked={reload} />
          ))}
          {view.yourAsks.length > 0 && (
            <p className="text-xs text-stone-600">
              You asked: {view.yourAsks.map((x) => `${x.contactLabel} on ${day(x.askedAt)}`).join("; ")}. Only you see this list.
            </p>
          )}
        </div>
      )}

      {view.openBallot && <OpenVote vote={view.openBallot} roles={view.roles} />}

      <div>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className="min-h-[44px] rounded-lg border border-teal-deep px-3 text-sm font-medium text-teal-deep hover:bg-stone-50"
        >
          {editing ? "Close the agreement's frames" : openLabel}
        </button>
        {editing && (
          <div className="mt-3">
            <Suspense fallback={<p role="status" className="text-sm text-stone-600">Loading the frames…</p>}>
              <ConflictAgreementEditor onDone={reload} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConflictAgreementPublic() {
  const [pub, setPub] = useState<{ stored: boolean; agreement: PublicAgreement | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState<MembersView | null>(null);

  const load = useCallback(() => {
    fetch("/api/conflict-agreement/public")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setPub(d))
      .catch(() => setFailed(true));
    if (authToken()) {
      fetch("/api/conflict-agreement", { headers: headers() })
        .then(async (r) => (r.ok ? ((await r.json()) as MembersView) : null))
        .then((d) => setMembers(d))
        .catch(() => setMembers(null));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <VillageConflictSteps />;
  if (!pub) {
    return (
      <p role="status" className="text-stone-600">
        Loading this village's conflict agreement…
      </p>
    );
  }
  return (
    <div id="conflict-agreement" className="space-y-4">
      {/* A member reads the members' copy whole; everybody else, the public view. */}
      {pub.stored && pub.agreement ? (
        <AgreementBody a={members?.stored ? readable(members.agreement, members.roles) : pub.agreement} />
      ) : (
        <VillageConflictSteps />
      )}
      {members && <ForMembers view={members} reload={load} />}
    </div>
  );
}
