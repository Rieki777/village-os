/**
 * Where the calendar feed's links point, and the host its event UIDs carry.
 *
 * The feed is served by this app, so its address is the app's own:
 * FRONTEND_URL when the operator set it (every email, invite and sign-in link
 * already uses it), else the origin the request arrived on. It used to prefer
 * `project.siteUrl`, the village's "Main website" link, which on a real
 * village is a static marketing site with no feed behind it, so members were
 * handed an address that answers nothing (sweep, 2026-10-31).
 *
 * The UID host is a different question. UIDs are `<id>@<host>` and every
 * subscribed calendar keys on them, so they keep the host they were minted
 * with: the outside website's when one is set, as they always have been.
 * Moving the feed's ADDRESS then changes no event's identity.
 */
type Req = { headers: Record<string, unknown>; protocol?: string; get(name: string): string | undefined };
type Where = { frontendUrl?: string | null; siteUrl?: string | null };

const trim = (s: unknown) => String(s ?? "").trim().replace(/\/$/, "");

export function feedOrigin(where: Where, req: Req): string {
  const configured = trim(where.frontendUrl);
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

export function feedUidHost(where: Where, origin: string): string {
  for (const candidate of [trim(where.siteUrl), origin]) {
    try {
      if (candidate) return new URL(candidate).host;
    } catch {
      /* not a URL: try the next */
    }
  }
  return "village";
}
