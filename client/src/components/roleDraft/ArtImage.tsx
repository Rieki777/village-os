/**
 * A picture with a drawn fallback, the same promise ModuleArt makes: a missing
 * file leaves a finished-looking gradient medallion, never a broken image.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * `portrait`: character art has a pale margin. Scale it past its frame so the margin is cropped,
 * over a forest gradient from the app's tokens, so no white band ever shows inside a ring.
 */
/** `className` must position the box: "absolute inset-0" to fill a header, or "relative" plus a size. */
export default function ArtImage({ src, className = "", imgClassName = "", portrait = false }: { src: string | null; className?: string; imgClassName?: string; portrait?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`overflow-hidden bg-gradient-to-br ${portrait ? "from-[var(--circle-ground)] via-[var(--circle-moss)] to-[var(--circle-ring)]" : "from-primary to-notice"} ${className}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={portrait ? { transform: "scale(1.14)" } : undefined} className={`sel-art h-full w-full object-cover ${imgClassName}`} />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-primary-foreground/80" aria-hidden="true">
          <Sparkles className="size-8" />
        </span>
      )}
    </div>
  );
}
