import type { RequestHandler } from 'express';
import { getAuth } from '../http/authenticate.ts';
import { toUserResponse } from './user-response.ts';

/** `GET /api/auth/me` (extension, contract note N6): the caller as the DB says on this request. */
export const meHandler: RequestHandler = (req, res) => {
  const { userId, email, role, firmId } = getAuth(req);
  res.json({ user: toUserResponse({ id: userId, email, role, firmId }) });
};
