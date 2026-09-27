export const FORBIDDEN_TEXT = 'Bu işlem için yetkiniz yok.';
export const SESSION_EXPIRED_TEXT = 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.';
export const NETWORK_ERROR_TEXT = 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.';
export const UNEXPECTED_ERROR_TEXT = 'Beklenmeyen bir hata oluştu.';

/** A failed API call: the API's error envelope, or a client-side stand-in when there is none. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function isErrorEnvelope(data: unknown): data is ErrorEnvelope {
  if (typeof data !== 'object' || data === null || !('error' in data)) return false;
  const { error } = data;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Calls the public API with JSON and an optional Bearer token; every failure is an `ApiError`. */
export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, token }: ApiRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_TEXT);
  }

  // A successful DELETE has no body to parse.
  if (res.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // Not JSON: an HTML error page from a proxy, an empty body or a cut-off response.
    throw new ApiError(res.status, 'UNEXPECTED_RESPONSE', UNEXPECTED_ERROR_TEXT);
  }

  if (res.ok) return data as T;
  if (isErrorEnvelope(data)) throw new ApiError(res.status, data.error.code, data.error.message);
  throw new ApiError(res.status, 'UNEXPECTED_RESPONSE', UNEXPECTED_ERROR_TEXT);
}

/** The Turkish text to show for a failed call. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return UNEXPECTED_ERROR_TEXT;
  // The project plan fixes this text for every 403, whatever the body says.
  return error.status === 403 ? FORBIDDEN_TEXT : error.message;
}
