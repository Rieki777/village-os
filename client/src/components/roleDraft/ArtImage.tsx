/**
 * A picture with a drawn fallback, the same promise ModuleArt makes: a missing
 * file leaves a finished-looking gradient medallion, never a broken image.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";

/** `className` must position the box: "absolute inset-0" to fill a header, or "relative" plus a size. */
export default function ArtImage({ src, className = "", imgClassName = "" }: { src: string | null; className?: string; imgClassName?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`overflow-hidden bg-gradient-to-br from-primary to-notice ${className}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={`sel-art h-full w-full object-cover ${imgClassName}`} />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-primary-foreground/80" aria-hidden="true">
          <Sparkles className="size-8" />
        </span>
      )}
    </div>
  );
}
