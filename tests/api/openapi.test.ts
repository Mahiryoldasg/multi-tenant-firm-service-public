import request, { type Response } from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { loginBodySchema } from '../../src/server/auth/login.ts';
import {
  createFirmBodySchema,
  renameFirmBodySchema,
} from '../../src/server/modules/platform/firm-routes.ts';
import { OPENAPI_DOCUMENT } from '../../src/server/openapi/document.ts';
import { createTestApp } from '../helpers/app.ts';

interface DocumentedOperation {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  secured: boolean;
  statuses: string[];
  extension: boolean;
  body?: { schema: z.ZodType; required: boolean; fields: string[] };
}

// Every operation the document must hold, with the statuses its place in the pipeline can produce.
const OPERATIONS: DocumentedOperation[] = [
  {
    method: 'post',
    path: '/api/auth/login',
    secured: false,
    statuses: ['200', '400', '401'],
    extension: false,
    body: { schema: loginBodySchema, required: true, fields: ['email', 'password'] },
  },
  { method: 'get', path: '/api/auth/me', secured: true, statuses: ['200', '401'], extension: true },
  {
    method: 'get',
    path: '/api/firms',
    secured: true,
    statuses: ['200', '401', '403'],
    extension: false,
  },
  {
    method: 'post',
    path: '/api/firms',
    secured: true,
    statuses: ['201', '400', '401', '403', '409'],
    extension: false,
    body: {
      schema: createFirmBodySchema,
      required: true,
      fields: ['name', 'adminEmail', 'adminPassword'],
    },
  },
  {
    method: 'patch',
    path: '/api/firms/{id}',
    secured: true,
    statuses: ['200', '400', '401', '403', '404'],
    extension: false,
    body: { schema: renameFirmBodySchema, required: true, fields: ['name'] },
  },
  {
    method: 'delete',
    path: '/api/firms/{id}',
    secured: true,
    statuses: ['204', '401', '403', '404'],
    extension: false,
  },
  { method: 'get', path: '/health', secured: false, statuses: ['200'], extension: true },
];

const CODE_BY_STATUS: Record<string, string> = {
  '400': 'VALIDATION_ERROR',
  '401': 'UNAUTHORIZED',
  '403': 'FORBIDDEN',
  '404': 'NOT_FOUND',
  '409': 'CONFLICT',
};

let res: Response;

beforeAll(async () => {
  const { app } = await createTestApp();
  res = await request(app).get('/openapi.json');
});

/** Follows a `#/components/schemas/<name>` reference in the served document. */
function resolveSchema(schema: { $ref: string }) {
  return res.body.components.schemas[schema.$ref.replace('#/components/schemas/', '')];
}

describe('GET /openapi.json', () => {
  it('serves the OpenAPI 3.1 document as JSON', () => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.openapi).toMatch(/^3\.1\./);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(OPENAPI_DOCUMENT)));
  });

  it('defines the Bearer JWT scheme behind the Authorize button', () => {
    expect(res.body.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('lists the five contract error codes plus the INTERNAL_ERROR extension', () => {
    const code = res.body.components.schemas.ErrorEnvelope.properties.error.properties.code;
    expect(code.enum).toEqual([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'CONFLICT',
      'INTERNAL_ERROR',
    ]);
  });
});

describe.each(OPERATIONS)(
  '$method $path',
  ({ method, path, secured, statuses, extension, body }) => {
    const operation = () => res.body.paths[path][method];

    it(secured ? 'requires the Bearer token' : 'is public', () => {
      expect(operation().security).toEqual(secured ? [{ bearerAuth: [] }] : undefined);
    });

    it('documents exactly its statuses', () => {
      expect(Object.keys(operation().responses).sort()).toEqual([...statuses].sort());
    });

    it(extension ? 'is marked as an extension' : 'is not marked as an extension', () => {
      expect(operation().summary.endsWith('(uzantı)')).toBe(extension);
    });

    it('documents each error with the envelope and a matching example', () => {
      for (const status of statuses.filter((status) => Number(status) >= 400)) {
        const content = operation().responses[status].content['application/json'];
        expect(content.schema).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' });
        expect(content.example.error.code).toBe(CODE_BY_STATUS[status]);
        expect(content.example.error.message).toEqual(expect.any(String));
      }
    });

    it(body ? 'documents its request body' : 'has no request body', () => {
      const requestBody = operation().requestBody;
      if (!body) {
        expect(requestBody).toBeUndefined();
        return;
      }
      expect(requestBody.required).toBe(body.required);
      const content = requestBody.content['application/json'];
      expect(resolveSchema(content.schema).required ?? []).toEqual(body.fields);
      // Each example is valid for the handler's own schema, so "Try it out" gets past validation.
      const examples = [
        ...(content.example === undefined ? [] : [content.example]),
        ...Object.values<{ value: unknown }>(content.examples ?? {}).map(({ value }) => value),
      ];
      for (const example of examples) expect(body.schema.safeParse(example).success).toBe(true);
    });
  },
);

it.each(OPERATIONS.filter(({ statuses }) => statuses.includes('204')))(
  '$method $path documents its 204 without content',
  ({ method, path }) => {
    expect(res.body.paths[path][method].responses['204'].content).toBeUndefined();
  },
);
