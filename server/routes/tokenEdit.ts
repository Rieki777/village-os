/**
 * Editing one token in the registry: its name, what it means, whether members
 * see it, and whether they may send it to each other.
 *
 *   PUT /api/admin/tokens/:slug
 *
 * MOVED OUT OF server/index.ts with the meaning (0283), and unchanged
 * otherwise apart from where its three statements live (server/repos/tokens.ts).
 * That file is on a ratchet that turns one way, and a route module's import and
 * register call are the lines it exempts. Registered at exactly the point the
 * route used to occupy, because Express matches in registration order.
 *
 * Rye, 2026-10-23: "Village Tokens is the umbrella word, which should be able to
 * be set in admin to name each type of token and for what categories it's issued
 * and what it means." The name and the meaning are both set here.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { EXAMPLE_REFUSAL_BODY } from "../lib/examples";
import { loadTokenRegistry, slugFreezeRefusal, tokenDef, tokenNameClash } from "../lib/ledger";
import { mayToggleTransferable } from "../lib/spending";
import { saveTokenDescription, tokenDescriptionProblem } from "../lib/tokenMeaning";
import { writeTokenActive, writeTokenName, writeTokenTransferable } from "../repos/tokens";

type Deps = Pick<AppDeps, "isAdmin" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, getPool } = deps;

  /**
   * Rename a platform token. The SLUG is history's identity and never
   * changes; the display NAME is the village's word for it, and renaming it
   * here is how a fork names its value token ONCE and has every surface —
   * wallet, exchange, and the public pages that read the config's value
   * token — follow. Only the name column moves: routing this through
   * registerToken's upsert would let a rename quietly rewrite
   * kind/governance/transferable too.
   */
  app.put("/api/admin/tokens/:slug", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const slug = String(req.params.slug);
    const def = tokenDef(slug);
    if (!def) return res.status(404).json({ error: `unknown token "${slug}"` });
    const frozen = slugFreezeRefusal(req.body?.slug, slug);
    if (frozen) return res.status(409).json({ error: frozen });
    if (def.governance !== "platform" && ["name", "active", "transferable"].some((k) => Object.prototype.hasOwnProperty.call(req.body ?? {}, k))) return res.status(400).json({ error: `${slug} is a read-only Hypha mirror. Its name is a fact about Base, not a setting` }); // its description is the village's own words (0283), so that alone is allowed
    // Renaming an example keeps its flag, so the admin's own word for the
    // token would be deleted by the first real one they create.
    if (def.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    // Either field alone is a valid edit: the panel sends a name when the admin
    // finishes typing and an `active` when they flip the switch, and requiring
    // both would make a toggle silently depend on the name field being intact.
    const body = req.body ?? {};
    const wantsName = Object.prototype.hasOwnProperty.call(body, "name");
    const wantsActive = Object.prototype.hasOwnProperty.call(body, "active");
    const wantsTransferable = Object.prototype.hasOwnProperty.call(body, "transferable");
    const wantsDescription = Object.prototype.hasOwnProperty.call(body, "description"); // 0283: what it means, server/lib/tokenMeaning.ts
    if (!wantsName && !wantsActive && !wantsTransferable && !wantsDescription) {
      return res.status(400).json({ error: "Send a name, a description, an active flag, a sending flag, or any of them" });
    }
    const descriptionBad = wantsDescription ? tokenDescriptionProblem(body.description) : null; // judged before anything is written
    if (descriptionBad) return res.status(400).json({ error: descriptionBad });

    if (wantsName) {
      const name = String(body.name ?? "").trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: "A display name is required" });
      const clash = tokenNameClash(name, slug);
      if (clash) return res.status(409).json({ error: clash });
      await writeTokenName(getPool(), slug, name);
    }
    if (wantsDescription) await saveTokenDescription(getPool(), slug, body.description);
    if (wantsActive) {
      // `active` is a MEMBER-VISIBILITY flag and nothing more (Rye, 2026-08-14).
      // Balances, history and the double-entry ledger are untouched, so
      // conservation still proves at boot and switching it back restores the
      // surface exactly. It deliberately does NOT stop issuance: a token that
      // pays a mint rule while hidden is a reporting problem, not a lost
      // entry, and the reverse — silently freezing an economy from a display
      // switch — is the one that cannot be undone.
      await writeTokenActive(getPool(), slug, body.active === true);
    }
    /*
     * 0092: THE VILLAGE'S OWN SWITCH FOR MEMBER-TO-MEMBER SENDING.
     *
     * `transferable` was writable only at CREATE, from an unvalidated body
     * field, and the rename route refused to touch it precisely so a rename
     * could not rewrite policy by accident. Now that a surface reads the
     * column, a village needs a way to close sending it opened, and a way to
     * open it on a token created before there was a surface.
     *
     * `mayToggleTransferable` is the firewall and it refuses by KIND: only a
     * credit token this platform governs can ever be flipped, so recognition
     * cannot be opened here, by an admin, by a typo, or by a future caller
     * that forgets to ask. The boot invariant proves the same thing from the
     * data side every morning.
     */
    if (wantsTransferable) {
      const blocked = mayToggleTransferable(def);
      if (blocked) return res.status(409).json({ error: blocked });
      await writeTokenTransferable(getPool(), slug, body.transferable === true);
    }
    await loadTokenRegistry(getPool());
    res.json({ success: true, token: tokenDef(slug) });
  });
}
