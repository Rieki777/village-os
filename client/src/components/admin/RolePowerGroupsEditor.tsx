/**
 * THE POWER GROUPS A ROLE CARRIES (0322; ROLE_POWERS_DESIGN.md §3).
 *
 * Whoever holds this role, right now, holds the powers of every Power group
 * ticked here, and loses them the moment the seating ends, lapses or they leave
 * (server/lib/seatGrants.ts). The server refuses a group carrying the steward's
 * veto and an unlink that would leave nobody able to open the admin panel; this
 * only says what each group would hand over before anybody presses save.
 *
 * Admin is a light-only workspace by ruling (2026-09-04): fixed grays here.
 */
import { useState } from "react";
import { toast } from "sonner";
import { capabilityLabel } from "@shared/capabilities";

interface GroupRow {
  id: string;
  name: string;
  capabilities: string[];
  grantsAdmin: boolean;
  isExample: boolean;
  linked: boolean;
}

export default function RolePowerGroupsEditor({
  role,
  call,
}: {
  role: { id: string; name?: string };
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);

  const load = async () => {
    const d = await call(`/admin/org-roles/${role.id}/power-groups`, undefined, "GET");
    if (!d) return;
    const rows = (d.groups ?? []) as GroupRow[];
    setGroups(rows.filter((g) => !g.isExample));
    setPicked(d.roleIds ?? []);
    setSaved(d.roleIds ?? []);
  };

  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify([...saved].sort());

  return (
    <div className="mt-3 rounded-lg border border-gray-100 px-3 py-2 text-gray-700">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !groups) void load();
        }}
        className="text-xs font-semibold text-gray-600 min-h-[32px]"
      >
        {open ? "Hide the powers this role carries" : "Powers this role carries"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500">
            Whoever holds this role holds the powers of each group you tick, for as long as they hold the role.
          </p>
          {!groups && <p className="text-xs text-gray-500">Loading the Power groups…</p>}
          {groups?.length === 0 && <p className="text-xs text-gray-500">There are no Power groups yet.</p>}
          {groups?.map((g) => (
            <label key={g.id} className="flex items-start gap-2 text-sm min-h-[44px]">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.includes(g.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((id) => id !== g.id))}
              />
              <span>
                <span className="font-medium text-gray-800">{g.name}</span>
                {g.grantsAdmin && <span className="ml-1 text-xs text-gray-500">(opens the admin panel)</span>}
                <span className="block text-xs text-gray-500">
                  {g.capabilities.length ? g.capabilities.map(capabilityLabel).join("; ") : "No powers yet"}
                </span>
              </span>
            </label>
          ))}
          {groups && groups.length > 0 && (
            <button
              type="button"
              disabled={!dirty}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 disabled:opacity-40 min-h-[44px]"
              onClick={async () => {
                const d = await call(`/admin/org-roles/${role.id}/power-groups`, { roleIds: picked }, "PUT");
                if (d) {
                  toast.success("Saved");
                  setSaved(d.roleIds ?? picked);
                }
              }}
            >
              Save the powers this role carries
            </button>
          )}
        </div>
      )}
    </div>
  );
}
