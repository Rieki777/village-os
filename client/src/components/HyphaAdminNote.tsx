import { useIsAdmin } from "@/contexts/AuthContext";
import { useHypha } from "@/modules/ModuleProvider";

/**
 * Why a Hypha section is missing, told to a signed-in admin and nobody else.
 *
 * The Co-Creators Guide used to print "Add this village's Hypha DHO link in
 * Admin, Variables" to every anonymous visitor, and kept printing it after the
 * link was set. A Hypha section is now not drawn at all until the link is set,
 * so the one person who can set it is the one person told where.
 */
export function HyphaAdminNote() {
  const hypha = useHypha();
  const isAdmin = useIsAdmin();
  if (hypha.configured || !isAdmin) return null;
  return (
    <p className="mx-auto my-8 max-w-3xl rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      Only admins see this note. The Hypha section of this page is hidden until this village's Hypha DHO link is set in
      Admin, Variables.
    </p>
  );
}
