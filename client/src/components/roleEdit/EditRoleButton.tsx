/**
 * THE TWO DOORS INTO THE EDITOR, drawn on the role card (/roles, the draft board
 * and the Admin org chart): "Edit this role" and "New role from a card".
 *
 * They draw nothing for a visitor or a member without the power to decide the
 * structure (`useEditAccess`), and the editor itself is a separate chunk loaded
 * only when one of these is pressed, so nobody else downloads it. The server asks
 * the same question again on every route (server/routes/roleEdit.ts).
 */
import { lazy, Suspense, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { SECONDARY } from "@/components/roleProposal/parts";
import { useEditAccess } from "./useEditAccess";

const RoleEditor = lazy(() => import("./RoleEditor"));
const NewRoleFromCard = lazy(() => import("./NewRoleFromCard"));

export default function EditRoleButton({ roleId, onSaved, className = "" }: { roleId: string; onSaved?: () => void; className?: string }) {
  const door = useEditAccess();
  const [open, setOpen] = useState(false);
  if (!door) return null;
  return (
    <>
      <button type="button" className={`${SECONDARY} ${className}`} onClick={() => setOpen(true)} data-edit-role={roleId}>
        <Trans context="role card, opens the role editor">Edit this role</Trans>
      </button>
      {open && (
        <Suspense fallback={null}>
          <RoleEditor roleId={roleId} onClose={() => setOpen(false)} onSaved={onSaved} />
        </Suspense>
      )}
    </>
  );
}

export function NewRoleFromCardButton({ onMade, className = "" }: { onMade?: (roleId: string) => void; className?: string }) {
  const door = useEditAccess();
  const [open, setOpen] = useState(false);
  if (!door) return null;
  return (
    <>
      <button type="button" className={`${SECONDARY} ${className}`} onClick={() => setOpen(true)}>
        <Trans context="role lists, opens the new role from a card dialog">New role from a card</Trans>
      </button>
      {open && (
        <Suspense fallback={null}>
          <NewRoleFromCard onClose={() => setOpen(false)} onMade={onMade} />
        </Suspense>
      )}
    </>
  );
}
