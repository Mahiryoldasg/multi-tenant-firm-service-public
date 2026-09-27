import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  errorMessage,
  FORBIDDEN_TEXT,
  NETWORK_ERROR_TEXT,
  UNEXPECTED_ERROR_TEXT,
} from '../../web/src/api.ts';

function stubFetch(result: Response | Error) {
  const fetchMock = vi.fn(async (_path: string, _init: RequestInit) => {
    if (result instanceof Error) throw result;
    // A body can be read once, so every call gets its own copy.
    return result.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sends the method, the JSON body and the Bearer token', async () => {
    const fetchMock = stubFetch(jsonResponse(201, {}));

    await apiRequest('/api/firms', { method: 'POST', body: { name: 'Acme' }, token: 'tok' });

    expect(fetchMock).toHaveBeenCalledWith('/api/firms', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: '{"name":"Acme"}',
    });
  });

  it('sends a GET without Authorization when there is no token, and no Content-Type without a body', async () => {
    const fetchMock = stubFetch(jsonResponse(200, {}));

    await apiRequest('/health');
    await apiRequest('/api/auth/me', { token: 'tok' });

    expect(fetchMock.mock.calls[0]?.[1].method).toBe('GET');
    expect(fetchMock.mock.calls[0]?.[1].headers).toStrictEqual({});
    expect(fetchMock.mock.calls[1]?.[1].headers).toStrictEqual({ Authorization: 'Bearer tok' });
  });

  it('returns the parsed body of a 200', async () => {
    stubFetch(jsonResponse(200, { firms: [{ id: 'f1', name: 'Acme' }] }));

    await expect(apiRequest('/api/firms', { token: 'tok' })).resolves.toStrictEqual({
      firms: [{ id: 'f1', name: 'Acme' }],
    });
  });

  it('resolves a 204 to undefined without parsing a body', async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(
      apiRequest('/api/firms/f1', { method: 'DELETE', token: 'tok' }),
    ).resolves.toBeUndefined();
  });

  it.each([
    [409, 'CONFLICT', 'Bu e-posta adresi zaten kullanılıyor.'],
    [500, 'INTERNAL_ERROR', 'Sunucu hatası.'],
  ])(
    'turns a %i error envelope into an ApiError with its code and message',
    async (status, code, message) => {
      stubFetch(jsonResponse(status, { error: { code, message } }));

      await expect(apiRequest('/api/firms', { token: 'tok' })).rejects.toStrictEqual(
        new ApiError(status, code, message),
      );
    },
  );

  it.each([
    ['an HTML page', new Response('<html>Bad Gateway</html>', { status: 502 })],
    ['an empty body', new Response(null, { status: 500 })],
    ['JSON without the envelope', jsonResponse(400, { message: 'bad' })],
    ['an envelope with a non-string code', jsonResponse(400, { error: { code: 1, message: 'x' } })],
  ])('turns an error response with %s into UNEXPECTED_RESPONSE', async (_case, response) => {
    stubFetch(response);

    await expect(apiRequest('/api/firms', { token: 'tok' })).rejects.toStrictEqual(
      new ApiError(response.status, 'UNEXPECTED_RESPONSE', UNEXPECTED_ERROR_TEXT),
    );
  });

  it('turns a 2xx body that is not JSON into an ApiError', async () => {
    stubFetch(new Response('<!doctype html>', { status: 200 }));

    await expect(apiRequest('/api/firms', { token: 'tok' })).rejects.toStrictEqual(
      new ApiError(200, 'UNEXPECTED_RESPONSE', UNEXPECTED_ERROR_TEXT),
    );
  });

  it('turns a rejected fetch into a NETWORK_ERROR with status 0', async () => {
    stubFetch(new TypeError('fetch failed'));

    await expect(apiRequest('/api/firms', { token: 'tok' })).rejects.toStrictEqual(
      new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_TEXT),
    );
  });
});

describe('errorMessage', () => {
  it('uses the fixed forbidden text for a 403, whatever the message', () => {
    expect(errorMessage(new ApiError(403, 'FORBIDDEN', 'başka bir metin'))).toBe(FORBIDDEN_TEXT);
  });

  it("uses any other ApiError's message", () => {
    expect(errorMessage(new ApiError(400, 'VALIDATION_ERROR', 'Firma adı zorunludur.'))).toBe(
      'Firma adı zorunludur.',
    );
  });

  it('uses the generic text for anything that is not an ApiError', () => {
    expect(errorMessage(new Error('boom'))).toBe(UNEXPECTED_ERROR_TEXT);
    expect(errorMessage('boom')).toBe(UNEXPECTED_ERROR_TEXT);
  });
});
