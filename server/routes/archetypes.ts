/**
 * Archetype routes (extracted from server/index.ts).
 *
 * Two routes:
 *
 *   GET /api/archetypes              the five classes, as this village names them
 *   GET /api/archetypes/:key/paths   what a class opens
 *
 * Both are public: the archetype list is the front door, and paths are a
 * suggestion, never a restriction.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import { listArchetypes, openPathsFor } from "../lib/characters";

export interface ArchetypeDeps {
  getPool: () => Pool;
  villageId: () => string;
}

export function register(app: Express, deps: ArchetypeDeps): void {
  const { getPool, villageId } = deps;

  /** The five classes, as this village names them. Public: it is the front door. */
  app.get("/api/archetypes", async (_req, res) => {
    res.json(await listArchetypes(getPool(), villageId()));
  });

  /** What a class opens. A suggestion, never a restriction. */
  app.get("/api/archetypes/:key/paths", async (req, res) => {
    res.json(await openPathsFor(getPool(), villageId(), req.params.key));
  });
}
