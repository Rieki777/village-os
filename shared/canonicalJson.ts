/**
 * Deterministic JSON. Signing is worthless if the bytes a verifier
 * reconstructs differ from the bytes that were signed, and object key order in
 * JS follows insertion order, which follows whatever the code happened to do
 * that day. Keys are sorted recursively; arrays keep their order because their
 * order is meaning.
 *
 * ONE CANONICALISER. This lived in server/lib/villageExport.ts, which still
 * re-exports it so every existing import keeps working. It moved here so the
 * seat settings model (shared/seatSettings.ts) can hash the same bytes the
 * village export signs, from code the client can also import. A second copy
 * would be a twin that drifts; `shared/canonicalJson.test.ts` pins the bytes
 * of a fixture so neither caller can change them by accident.
 *
 * Pure: no imports, no Node builtins, safe in the browser bundle.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}
