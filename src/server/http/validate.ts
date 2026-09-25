import { z } from 'zod';
import { HttpError } from './errors.ts';

/** The 400 message for a body that is not a JSON object, including a missing body. */
export const INVALID_BODY_MESSAGE = 'İstek gövdesi bir JSON nesnesi olmalı.';

const isNotBlank = (value: string) => value.trim() !== '';

/**
 * A required string: a string that is non-blank after trimming, otherwise `message`. The value stays
 * untrimmed, so a password keeps its spaces; handlers trim the fields they store trimmed.
 */
export function requiredString(message: string) {
  return z.string({ error: message }).refine(isNotBlank, message);
}

/**
 * Parses a request body with `schema` and returns the result, with unknown fields dropped. An
 * invalid body throws a 400 with the first issue's message.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? INVALID_BODY_MESSAGE,
    );
  }
  return parsed.data;
}
