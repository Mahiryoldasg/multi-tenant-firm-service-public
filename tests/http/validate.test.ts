import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpError } from '../../src/server/http/errors.ts';
import { INVALID_BODY_MESSAGE, parseBody, requiredString } from '../../src/server/http/validate.ts';

const NAME_REQUIRED = 'name required';
const CODE_REQUIRED = 'code required';

const schema = z.object(
  { name: requiredString(NAME_REQUIRED), code: requiredString(CODE_REQUIRED) },
  { error: INVALID_BODY_MESSAGE },
);

/** The error `parseBody` throws for this body. */
function parseError(body: unknown): HttpError {
  try {
    parseBody(schema, body);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('parseBody accepted the body');
}

describe('requiredString', () => {
  it('accepts a non-blank string and keeps it untrimmed', () => {
    expect(requiredString(NAME_REQUIRED).parse('  a b  ')).toBe('  a b  ');
  });

  it.each([
    { label: 'an empty string', value: '' },
    { label: 'a whitespace-only string', value: ' \t\n ' },
    { label: 'a number', value: 42 },
    { label: 'null', value: null },
    { label: 'a missing value', value: undefined },
  ])('rejects $label with the given message', ({ value }) => {
    const result = requiredString(NAME_REQUIRED).safeParse(value);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(NAME_REQUIRED);
  });
});

describe('parseBody', () => {
  it('returns the parsed body without unknown fields', () => {
    expect(parseBody(schema, { name: 'n', code: 'c', role: 'platform_admin' })).toEqual({
      name: 'n',
      code: 'c',
    });
  });

  it('throws a 400 VALIDATION_ERROR with the first issue message', () => {
    const error = parseError({ name: ' ', code: '' });

    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe(NAME_REQUIRED);
  });

  it('reports a later field when the earlier ones are valid', () => {
    expect(parseError({ name: 'n' }).message).toBe(CODE_REQUIRED);
  });

  it.each([
    { label: 'a missing body', body: undefined },
    { label: 'null', body: null },
    { label: 'an array', body: [{ name: 'n', code: 'c' }] },
    { label: 'a string', body: 'name=n' },
  ])('answers $label with the invalid-body message', ({ body }) => {
    const error = parseError(body);

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe(INVALID_BODY_MESSAGE);
  });
});
