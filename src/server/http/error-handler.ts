import express, { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { type ErrorCode, HttpError } from './errors.ts';

export const NOT_FOUND_MESSAGE = 'Kaynak bulunamadı.';
const UNREADABLE_BODY_MESSAGE = 'İstek gövdesi okunamadı.';
export const INTERNAL_ERROR_MESSAGE = 'Beklenmeyen bir hata oluştu.';

// Not strict: a valid JSON body that is not an object (`"x"`, `null`, `42`) must reach the guards,
// because only unparseable JSON may skip the 401 → 403 → 404 order (contract §3). The handlers'
// object schemas then answer it with 400.
const parseJson = express.json({ strict: false });

/**
 * `express.json()`, with its client errors turned into the contract's 400 where they arise, so the
 * error handler never has to guess whether an error came from the request body.
 */
export const jsonBodyParser: RequestHandler = (req, res, next) => {
  parseJson(req, res, (err?: unknown) => {
    // The HttpError is not logged: a body-parser error's `body` holds the raw request text, which
    // can contain a password.
    next(isClientError(err) ? new HttpError('VALIDATION_ERROR', UNREADABLE_BODY_MESSAGE) : err);
  });
};

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

  if (isMalformedParam(err)) {
    sendError(res, 404, 'NOT_FOUND', NOT_FOUND_MESSAGE);
    return;
  }

  if (isClientError(err)) {
    // Body errors arrive as HttpErrors (jsonBodyParser), so this comes from a file response: send's
    // 412 for a failed If-Match or 416 for an unsatisfiable Range, behind express.static or the SPA
    // fallback's res.sendFile. No contract code fits, so it is answered the way send answers its
    // own errors: its status and headers, none of the file's headers, and no body. Not logged: the
    // client asked for it.
    sendFileError(res, err);
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

function sendFileError(res: Response, { status, headers }: ClientError): void {
  // The file response had already set its Content-Type, ETag, Cache-Control and the like.
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  // For example `Content-Range: bytes */<size>` on a 416.
  for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
  res.status(status).end();
}

/** An http-errors client error, as body-parser and send raise them. */
interface ClientError {
  status: number;
  headers?: Record<string, string>;
}

// http-errors client errors: a 4xx `status` with `expose: true`. body-parser (behind express.json)
// raises only these, from malformed JSON and oversized bodies to a corrupt compressed body, which
// has no `type`; the contract has no 413 or 415, and its 400 covers a broken body, so
// jsonBodyParser turns all of them into 400. send raises them for file responses. The router's
// malformed-param URIError has no `expose` and is handled before this.
function isClientError(err: unknown): err is ClientError {
  if (typeof err !== 'object' || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

// Express's router throws a URIError with `status: 400` when a route param is not valid
// percent-encoding (`/api/firms/%E0`). It happens while matching the `:id` route, so after the auth
// guards, and no resource can have such an id: it answers like any unknown id, 404. Any other
// URIError is unexpected and stays a 500.
function isMalformedParam(err: unknown): boolean {
  return err instanceof URIError && (err as URIError & { status?: unknown }).status === 400;
}
