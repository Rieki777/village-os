import { Eye, EyeOff } from "lucide-react";

/**
 * The eye inside a password field that shows what was typed. It sits at the
 * field's right edge, so the field needs right padding (pr-12) and a relative
 * parent. One `shown` state can drive a password and its confirmation together.
 */
export function ShowPasswordButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      title={shown ? "Hide password" : "Show password"}
      className="absolute right-1 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
    >
      {shown ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
