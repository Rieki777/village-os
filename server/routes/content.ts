/**
 * Public and admin content routes (extracted from server/index.ts).
 *
 * Three routes:
 *
 *   GET  /api/content/:section       public content, minus holder names
 *   GET  /api/admin/content          admin: read all content
 *   PUT  /api/admin/content/:section admin: update one section (story.tell)
 *
 * The `roles` section is the CARD-SHAPED org chart that 0049 replaced with
 * rows. The cards kept their `holders` array and `holderNote`, so the public
 * endpoint strips those fields rather than gating the whole route, because
 * content drives real public pages and no client reads `content/roles` any
 * more (Team.tsx reads `/api/org` plus `content/team`).
 */
import type { Express, Request, Response } from "express";
import type { DbDocument, Row } from "../repos/store-db";

/** Fields that name people, stripped from the public surface. */
const PERSON_FIELDS = ["holders", "holderNote"];

export interface ContentDeps {
  contentRepo: DbDocument<Row>;
  isAdmin: (req: Request) => Promise<boolean>;
  guardCapability: (
    req: Request,
    res: Response,
    cap: "story.tell",
  ) => Promise<boolean>;
}

export function register(app: Express, deps: ContentDeps): void {
  const { contentRepo, isAdmin, guardCapability } = deps;

  app.get("/api/content/:section", async (req, res) => {
    const content = contentRepo.get();
    const section = (content as any)[req.params.section];
    if (section === undefined) {
      return res.status(404).json({ error: "Section not found" });
    }
    if (await isAdmin(req)) return res.json(section);
    if (Array.isArray(section)) {
      return res.json(
        section.map((card: any) => {
          if (!card || typeof card !== "object" || !PERSON_FIELDS.some((f) => f in card)) return card;
          const copy = { ...card };
          for (const f of PERSON_FIELDS) delete copy[f];
          return copy;
        }),
      );
    }
    res.json(section);
  });

  app.get("/api/admin/content", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    res.json(contentRepo.get());
  });

  app.put("/api/admin/content/:section", async (req, res) => {
    // 0098: `story.tell`. What a village says about itself in public is the
    // clearest case in the set of a power that belongs to the village.
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const content = contentRepo.get() as any;
    content[req.params.section] = req.body;
    await contentRepo.put(content);
    res.json({ success: true });
  });
}
