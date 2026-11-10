/**
 * The connector's OAuth rules (addendum v6, B4). What each case pins:
 *
 *   metadata    both documents point at this village and name S256 as the
 *               only challenge method and "none" as the only client auth
 *   redirects   https, or http on the loopback; no fragment, no credentials
 *   register    public clients only, one to five redirect URIs
 *   check 33    PKCE: a challenge must be S256 of a verifier, and a verifier
 *               that does not match is refused
 *   scopes      only the connector's list; admin and Sera's scope never
 */
import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  challengeProblem,
  chosenScopes,
  parseRegistration,
  pkceMatches,
  protectedResourceMetadata,
  redirectUriProblem,
  redirectWith,
  s256,
  verifierProblem,
  wwwAuthenticate,
} from "./agentOAuth";

const ORIGIN = "https://village.example";

describe("the metadata", () => {
  it("names this village and only the methods it supports", () => {
    expect(protectedResourceMetadata(ORIGIN)).toMatchObject({ resource: `${ORIGIN}/api/agent/v1/mcp`, authorization_servers: [ORIGIN] });
    const as = authorizationServerMetadata(ORIGIN);
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/agent/v1/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/agent/v1/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code"],
    });
    // Only scopes that open a connector tool; the two extras are offered only to the accounts allowed them.
    expect(as.scopes_supported).toEqual(["moon.read", "moon.write", "tasks.write", "moon.review", "roles.read", "roles.propose", "letters.draft", "applicants.read", "onboarding.write", "settings.propose", "listing.propose", "pages.propose", "map.propose", "admin", "sera.undoable"]);
    expect(wwwAuthenticate(ORIGIN)).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  });
});

describe("redirect URIs", () => {
  it("takes https and loopback http, and nothing else", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:6274/callback", "http://127.0.0.1:33418/cb"]) expect(redirectUriProblem(ok), ok).toBeNull();
    for (const bad of ["http://claude.ai/cb", "javascript:alert(1)", "https://a.example/cb#frag", "https://u:p@a.example/cb", "/relative", "ftp://a.example/"]) {
      expect(redirectUriProblem(bad), bad).not.toBeNull();
    }
  });

  it("keeps the registered URI's own query and adds the code and state", () => {
    expect(redirectWith("https://a.example/cb?x=1", { code: "c", state: "s" })).toBe("https://a.example/cb?x=1&code=c&state=s");
    expect(redirectWith("https://a.example/cb", { error: "access_denied", state: undefined })).toBe("https://a.example/cb?error=access_denied");
  });
});

describe("registration", () => {
  it("registers every client as a public one, whatever auth method it asked for", () => {
    expect(parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude", token_endpoint_auth_method: "none" })).toEqual({
      ok: true,
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }).ok).toBe(true);
    expect(parseRegistration({ redirect_uris: [] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: Array(6).fill("https://a.example/cb") }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }).ok).toBe(false);
  });
});

describe("PKCE (check 33)", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // RFC 7636 appendix B

  it("computes S256 as RFC 7636 does", () => {
    expect(s256(verifier)).toBe(challenge);
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
  });

  it("refuses a missing or plain challenge, and a short verifier", () => {
    expect(challengeProblem(undefined, undefined)).not.toBeNull();
    expect(challengeProblem(challenge, "plain")).not.toBeNull();
    expect(challengeProblem(challenge, "S256")).toBeNull();
    expect(verifierProblem("short")).not.toBeNull();
    expect(verifierProblem(verifier)).toBeNull();
  });
});

describe("scopes", () => {
  it("keeps the connector's list and drops the rest", () => {
    expect(chosenScopes(["moon.read", "admin", "sera.undoable", "tasks.write", "moon.read"])).toEqual(["moon.read", "tasks.write"]);
    // A scope that opens no connector tool is not offered at all.
    expect(chosenScopes("moon.read me.read calendar.read directory.read")).toEqual(["moon.read"]);
    expect(chosenScopes(null)).toEqual([]);
  });

  it("offers an extra scope only where the member's own rules allow it", () => {
    expect(chosenScopes(["moon.read", "admin"], ["admin"])).toEqual(["moon.read", "admin"]);
    expect(chosenScopes(["sera.undoable"], ["admin"])).toEqual([]);
    expect(chosenScopes(["sera.undoable"], ["sera.undoable"])).toEqual(["sera.undoable"]);
    // An extra that is not on the extras list never gets through, whoever passes it.
    expect(chosenScopes(["rsvp.write"], ["rsvp.write" as any])).toEqual([]);
  });
});
