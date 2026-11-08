/**
 * Fetch a compiled catalog from the server (internal spec i18n, plan §1.1).
 *
 * Non-English catalogs are never part of dist/public: the server compiles the
 * reviewed PO files at build time and serves them here, so a new language adds
 * no bytes to the bundle budget. A public, unauthenticated read.
 */
export type CatalogResponse = {
  locale?: string;
  /** message id -> compiled message. */
  messages: Record<string, unknown>;
  /** Ids no person has reviewed yet; they carry the "Translated automatically" label (V.12). */
  unreviewed?: string[];
};

export async function fetchCatalog(locale: string): Promise<CatalogResponse> {
  const res = await fetch(`/api/i18n/catalog/${encodeURIComponent(locale)}`, { credentials: "omit" });
  if (!res.ok) throw new Error(`catalog ${locale}: ${res.status}`);
  return (await res.json()) as CatalogResponse;
}
