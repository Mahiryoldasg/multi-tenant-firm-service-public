import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { EMAIL_TAKEN_MESSAGE } from '../auth/email.ts';
import { INVALID_SESSION_MESSAGE } from '../http/authenticate.ts';
import { FORBIDDEN_MESSAGE } from '../http/authorize.ts';
import { NOT_FOUND_MESSAGE } from '../http/error-handler.ts';
import type { ErrorCode } from '../http/errors.ts';
import { INVALID_BODY_MESSAGE } from '../http/validate.ts';

// Response schemas are documentation only: handlers do not validate what they send, so
// tests/api/openapi-responses.test.ts parses real responses with them to keep them true.

export const userSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.enum(['platform_admin', 'firm_admin', 'member']),
    firmId: z.string().meta({ description: 'platform_admin için gönderilmez.' }).optional(),
  })
  .meta({ id: 'User' });

export const loginResponseSchema = z
  .object({ token: z.string().meta({ description: "HS256 kullanıcı token'ı." }), user: userSchema })
  .meta({ id: 'LoginResponse' });

export const meResponseSchema = z.object({ user: userSchema }).meta({ id: 'MeResponse' });

export const healthResponseSchema = z
  .object({ status: z.literal('ok') })
  .meta({ id: 'HealthResponse' });

const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const satisfies readonly (ErrorCode | 'INTERNAL_ERROR')[];

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES).meta({
        description:
          'İstemciler bu alana göre karar verir. INTERNAL_ERROR (500) sözleşme dışı bir uzantıdır.',
      }),
      message: z.string().meta({
        description: 'Türkçe, okunabilir açıklama; aynı kod için nedene göre değişebilir.',
      }),
    }),
  })
  .meta({ id: 'ErrorEnvelope' });

const ERRORS_BY_STATUS = {
  400: { code: 'VALIDATION_ERROR', message: INVALID_BODY_MESSAGE },
  401: { code: 'UNAUTHORIZED', message: INVALID_SESSION_MESSAGE },
  403: { code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE },
  404: { code: 'NOT_FOUND', message: NOT_FOUND_MESSAGE },
  409: { code: 'CONFLICT', message: EMAIL_TAKEN_MESSAGE },
} as const satisfies Record<number, { code: ErrorCode; message: string }>;

type ErrorStatus = keyof typeof ERRORS_BY_STATUS;

/**
 * An error response for `status` with the envelope schema and an example body. The example's message
 * is one the API sends for that code; pass `message` when the operation sends a different one.
 */
export function errorResponse(
  status: ErrorStatus,
  description: string,
  message: string = ERRORS_BY_STATUS[status].message,
): ResponseConfig {
  return {
    description,
    content: {
      'application/json': {
        schema: errorEnvelopeSchema,
        example: { error: { code: ERRORS_BY_STATUS[status].code, message } },
      },
    },
  };
}
