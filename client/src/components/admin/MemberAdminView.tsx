/**
 * THE ADMIN PANEL, AS A MEMBER SEES IT (Rye, Q5, 2026-11-01; ROLE_POWERS_DESIGN.md §4.5).
 *
 * "The admin panel should be open to ALL members to see. They need the power
 * to change something without a vote." A signed-in account that is not an
 * admin used to meet "Not an admin" here. Now it reads what the server lets
 * every member read (server/lib/memberReadable.ts), with nothing on the page
 * that could change it.
 *
 * READ-ONLY BY CONSTRUCTION. This view calls only the allow-listed GETs and
 * renders no write control at all. The admin tabs are not reused, because each
 * carries its own inline save buttons; hiding them one by one would be a
 * promise kept in forty places. A section appears here when the server opens
 * its read, and not before.
 *
 * The server decides who reads: a guest, or anyone who left, is refused, and
 * the page says so in one line.
 *
 * Admin is a light-only workspace by ruling (2026-09-04): fixed grays here.
 */
import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { capabilityLabel } from "@shared/capabilities";

interface HoldingPayload {
  powers: Array<{ capability: string; title: string; consequence: string; heldBy: { roleName: string | null; roleId: string } | null }>;
  roles: Array<{ id: string; name: string; capabilities: string[]; isExample: boolean; holderCount: number }>;
}
interface Draft {
  id: string;
  title: string;
  rationale: string | null;
  status: string;
}
interface Expiring {
  assignmentId: string;
  roleName: string;
  holder: string | null;
  lapsed: boolean;
}

/** The first word of a name: the house form names a holder by first name only (Rye, 2026-10-30). */
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

type Read<T> = { state: "loading" } | { state: "refused" } | { state: "ready"; data: T };

async function read<T>(path: string): Promise<Read<T>> {
  const t = authToken();
  try {
    const r = await fetch(path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!r.ok) return { state: "refused" };
    return { state: "ready", data: (await r.json()) as T };
  } catch {
    return { state: "refused" };
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-display text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-3 text-sm text-gray-700">{children}</div>
    </section>
  );
}

export default function MemberAdminView({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  const [holding, setHolding] = useState<Read<HoldingPayload>>({ state: "loading" });
  const [drafts, setDrafts] = useState<Read<Draft[]>>({ state: "loading" });
  const [expiring, setExpiring] = useState<Read<Expiring[]>>({ state: "loading" });

  useEffect(() => {
    // Literal paths, one per read the server allows members (server/lib/memberReadable.ts).
    void read<HoldingPayload>("/api/admin/capabilities/holding").then(setHolding);
    void read<Draft[]>("/api/admin/org/drafts").then(setDrafts);
    void read<Expiring[]>("/api/admin/org/expiring").then(setExpiring);
  }, []);

  const refusedEverywhere = holding.state === "refused" && drafts.state === "refused" && expiring.state === "refused";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-teal-deep text-white">
        <div className="mx-auto max-w-4xl px-4 py-6">
          <p className="flex items-center gap-2 text-sm text-white">
            <Eye className="h-4 w-4" aria-hidden="true" />
            Reading the admin panel as {userName}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold">How the village is run</h1>
          <p className="mt-2 max-w-2xl text-sm text-white">
            Every member can read this. Changing any of it needs the power to change it, or a village vote.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {refusedEverywhere && (
          <p className="text-gray-700">The admin panel opens to members of the village. Once you are a member you can read it here.</p>
        )}

        {holding.state === "ready" && (
          <Section title="Powers and the groups that carry them">
            <ul className="space-y-2">
              {holding.data.powers.map((p) => (
                <li key={p.capability}>
                  <span className="font-medium text-gray-900">{p.title}</span>
                  <span className="block text-gray-600">
                    {p.heldBy ? `The village holds this, looked after by ${p.heldBy.roleName ?? p.heldBy.roleId}.` : "The stewards hold this for now."}
                  </span>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 font-semibold text-gray-900">Power groups</h3>
            <ul className="mt-2 space-y-2">
              {holding.data.roles
                .filter((g) => !g.isExample)
                .map((g) => (
                  <li key={g.id}>
                    <span className="font-medium text-gray-900">{g.name}</span>
                    <span className="block text-gray-600">{g.capabilities.length ? g.capabilities.map(capabilityLabel).join("; ") : "No powers yet"}</span>
                  </li>
                ))}
            </ul>
          </Section>
        )}

        {drafts.state === "ready" && (
          <Section title="Changes to the village's structure">
            {drafts.data.length === 0 ? (
              <p>Nobody has drafted a change yet.</p>
            ) : (
              <ul className="space-y-2">
                {drafts.data.map((d) => (
                  <li key={d.id}>
                    <span className="font-medium text-gray-900">{d.title}</span>
                    <span className="ml-2 text-xs text-gray-500">{d.status}</span>
                    {d.rationale && <span className="block text-gray-600">{d.rationale}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {expiring.state === "ready" && (
          <Section title="Roles whose terms are ending">
            {expiring.data.length === 0 ? (
              <p>No role's term is ending soon.</p>
            ) : (
              <ul className="space-y-1">
                {expiring.data.map((e) => (
                  <li key={e.assignmentId}>
                    {e.roleName}
                    {/* Role (FirstName), the house form: a documented holder arrives as a full display name. */}
                    {e.holder ? ` (${firstNameOf(e.holder)})` : ""}
                    {e.lapsed ? ": the term has ended, waiting to be chosen again." : ": the term ends soon."}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <button
          type="button"
          onClick={onSignOut}
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800"
        >
          Sign out and switch accounts
        </button>
      </main>
    </div>
  );
}
