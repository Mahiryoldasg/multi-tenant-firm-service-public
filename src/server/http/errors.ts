// The error codes of the integration contract (§3), each with its fixed HTTP status.
const STATUS_BY_CODE = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

/**
 * A client error with a contract code and a short Turkish message. Handlers throw it; the central
 * error handler turns it into the `{ error: { code, message } }` envelope.
 */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
