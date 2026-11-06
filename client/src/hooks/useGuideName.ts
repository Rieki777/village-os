import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { guideAudience, guideName, type GuideAudience, type GuideName } from "@shared/guideName";

/**
 * The village guide's name for whoever is looking, on a page that does not
 * already read the Work With Us document itself.
 *
 * The name is `workWithUs.assistantName` (shared/guideName.ts says why it is
 * the only place). Until the village names its guide this reads "your village
 * guide" to a founder or admin and "the village guide" to everyone else, so
 * the guide is never hidden and never borrows another village's name.
 *
 * `loaded` turns true once the document has answered or failed, for a page
 * that would rather wait than show the neutral label and then the name.
 */
export function useGuideName(): GuideName & { loaded: boolean; audience: GuideAudience } {
  const audience = useViewerGuideAudience();
  const [source, setSource] = useState<unknown>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    const done = (value: unknown) => {
      if (!live) return;
      setSource(value);
      setLoaded(true);
    };
    try {
      fetch("/api/work-with-us-config")
        .then((r) => (r.ok ? r.json() : null))
        .then((w) => done(w?.assistantName))
        .catch(() => done(undefined));
    } catch {
      done(undefined);
    }
    return () => {
      live = false;
    };
  }, []);

  return { ...guideName(source, audience), loaded, audience };
}

/**
 * Who is looking, as the guide's name needs it. Signed out, or on a tree with
 * no auth provider (a page rendered bare), the viewer is the public: the
 * neutral label is the safe answer and grants nothing.
 */
export function useViewerGuideAudience(): GuideAudience {
  let user: { role?: string | null } | null | undefined;
  try {
    user = useAuth().user;
  } catch {
    user = null;
  }
  return guideAudience(user);
}
