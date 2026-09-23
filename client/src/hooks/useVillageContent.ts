import { useEffect, useState } from "react";

/**
 * Which sections this village has written, asked once per page view.
 *
 * WHY A PAGE ASKS THIS BEFORE IT ASKS FOR A SECTION. The section route answers
 * 404 for a section nobody has written, and that answer is right: the admin
 * editor reads it as "not written yet" (ContentEditorTab.tsx) and so does the
 * hook below. What was wrong was the asking. A browser logs every failed
 * request in its console by itself, whatever the page's code does with the
 * response, so a catch in here could never have silenced it. Eleven public
 * pages asked for `legal`, `money` or `covenant` on every load of a village
 * that had written none of them (and /team asked for `team` on every fork that
 * had not), and the console was red on every visit. A new
 * error on those pages had nowhere to stand out. The only fix that holds is
 * not to send the request, so the page learns the names first
 * (GET /api/content, names only, never content) and asks only for a section
 * that is there.
 *
 * SHARED WHILE IN FLIGHT, THEN DROPPED. Two hooks on one page (the love letter
 * reads `legal` and `covenant`) mount together and share one listing request.
 * Once it answers it is forgotten, so the next page asks again and a section a
 * founder writes is read on the very next navigation, exactly as it was when
 * every page asked for its section directly. Caching it for the session would
 * have been one request cheaper and a page stale.
 *
 * Null means the list could not be read. The caller then asks for the section
 * as it always did, because an unknown answer is no reason to show a
 * placeholder over words a village may well have written.
 */
let inFlight: Promise<ReadonlySet<string> | null> | null = null;

function writtenSections(): Promise<ReadonlySet<string> | null> {
  if (!inFlight) {
    const asked: Promise<ReadonlySet<string> | null> = fetch("/api/content")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) =>
        Array.isArray(body?.sections) ? new Set<string>(body.sections.map(String)) : null,
      )
      .catch(() => null);
    inFlight = asked;
    void asked.then(() => {
      if (inFlight === asked) inFlight = null;
    });
  }
  return inFlight;
}

/**
 * One section's parsed body, or null when the village has not written it.
 *
 * The one door to GET /api/content/:section for a public page, so the rule
 * above holds everywhere: an unwritten section is never requested. The body is
 * returned as it came, whatever its shape, because the team cards are an array
 * and every other section is an object; each caller checks its own.
 */
export function readVillageSection(section: string): Promise<unknown> {
  return writtenSections()
    .then((written) => {
      // Known to be unwritten: the answer the section route would give,
      // without the request the browser would have logged.
      if (written && !written.has(section)) return null;
      return fetch(`/api/content/${section}`).then((r) =>
        // The route 404s with {error: "Section not found"} when nothing has
        // been saved for this key yet: the expected state for a fresh
        // instance, not a fetch failure.
        r.ok ? r.json().catch(() => null) : null,
      );
    })
    .catch(() => null);
}

/**
 * Reads one section of the runtime content document (server/repos/store.ts
 * DOCUMENTS, exposed read-only at GET /api/content/:section, writable by an
 * admin at PUT /api/admin/content/:section: no new server route needed for
 * a new section key, since both routes already key on whatever string is in
 * the URL).
 *
 * Built for the jurisdiction-specific pages (Land Share tax treatment,
 * residency law, the membership entity's tax status): a fresh instance has
 * never written this section. The listing above says so, and the hook
 * answers `isPlaceholder` without asking. If it asks anyway (the listing
 * could not be read) the route's 404 lands in the same place. Either way it
 * is not an error. The honest state for a village that has not published its
 * own legal or tax claims yet is "nothing here", never a fallback copied from
 * wherever this platform instance was forked from. Callers must render their
 * own neutral, non-committal placeholder in that state rather than any
 * jurisdiction's specific law. See WhyCostaRica.tsx for the fullest example.
 */
export function useVillageContent<T extends Record<string, any>>(
  section: string,
): { content: T | null; loading: boolean; isPlaceholder: boolean } {
  const [content, setContent] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    readVillageSection(section).then((body) => {
      if (!alive) return;
      setContent(body && typeof body === "object" && !Array.isArray(body) ? (body as T) : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [section]);

  return { content, loading, isPlaceholder: !loading && !content };
}
