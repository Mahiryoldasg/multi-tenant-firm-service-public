import type Database from 'better-sqlite3';
import { Router } from 'express';
import { listActiveFirms } from './firms.ts';

export interface FirmRouterDeps {
  db: Database.Database;
}

/** The platform-admin firm routes, mounted on `/api/firms` behind `requirePlatformAdmin`. */
export function createFirmRouter({ db }: FirmRouterDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ firms: listActiveFirms(db) });
  });

  return router;
}
