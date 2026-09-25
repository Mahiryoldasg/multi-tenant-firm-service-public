import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { type ErrorCode, HttpError } from './errors.ts';

const NOT_FOUND_MESSAGE = 'Kaynak bulunamadı.';
const UNREADABLE_BODY_MESSAGE = 'İstek gövdesi okunamadı.';
const INTERNAL_ERROR_MESSAGE = 'Beklenmeyen bir hata oluştu.';

/** Answers every request no route handled, whatever its method: the contract has no 405. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError('NOT_FOUND', NOT_FOUND_MESSAGE));
};

/** The only writer of error bodies. Internals go to the log, never into the response. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    sendError(res, err.status, err.code, err.message);
    return;
  }

  if (isClientError(err)) {
    // Not logged: a body-parser error's `body` holds the raw request text, which can contain a
    // password.
    sendError(res, 400, 'VALIDATION_ERROR', UNREADABLE_BODY_MESSAGE);
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  // INTERNAL_ERROR is our extension: the contract defines no code for a server failure.
  sendError(res, 500, 'INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE);
};

function sendError(
  res: Response,
  status: number,
  code: ErrorCode | 'INTERNAL_ERROR',
  message: string,
): void {
  res.status(status).json({ error: { code, message } });
}

// http-errors client errors: a 4xx `status` with `expose: true`. body-parser (behind express.json)
// raises only these, from malformed JSON and oversized bodies to a corrupt compressed body, which
// has no `type`. The contract has no 413 or 415, and its 400 covers a broken body, so all of them
// become 400. Express's router URIError for a malformed percent-encoded param has `status: 400` but
// no `expose`, so it stays a 500 here; the features that add `:id` routes decide its answer.
function isClientError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}
