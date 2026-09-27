import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { LOGIN_FAILED_MESSAGE, loginBodySchema } from '../auth/login.ts';
import { INTERNAL_ERROR_MESSAGE } from '../http/error-handler.ts';
import { createFirmBodySchema, renameFirmBodySchema } from '../modules/platform/firm-routes.ts';
import {
  createFirmResponseSchema,
  errorResponse,
  firmListResponseSchema,
  firmResponseSchema,
  healthResponseSchema,
  loginResponseSchema,
  meResponseSchema,
} from './schemas.ts';

const BEARER_AUTH = [{ bearerAuth: [] }];

const NON_BLANK_RULE =
  'Zorunlu alanlar boş olmayan string olmalıdır; yalnız boşluktan oluşan değer boş sayılır.';

const UNAUTHORIZED =
  'Token yok, geçersiz veya süresi dolmuş; kullanıcı ya da firması silinmiş; ya da display token.';

const PLATFORM_ADMIN_ONLY = 'Çağıran platform_admin değil (firm_admin veya member).';

const FIRM_NOT_FOUND =
  'Firma yok, silinmiş ya da `id` geçersiz. Bu kontrol gövdenin doğrulanmasından önce yapılır.';

const firmIdParams = z.object({ id: z.string().meta({ description: 'Firma kimliği.' }) });

const DESCRIPTION = `Çok kiracılı (multi-tenant) firma ve çalışan yönetimi servisi. Dış yüzey, API sözleşmesine uyar.

**Kimlik doğrulama.** \`POST /api/auth/login\` dışındaki her \`/api\` isteği \`Authorization: Bearer <token>\` ister. Kullanıcı token'ı HS256 JWT'dir: \`{ sub, role, firmId? }\`; platform_admin'de \`firmId\` yoktur. Rol ve firma her istekte veritabanından okunur: rolü değişen kullanıcının token'ı sonraki istekte yeni rolüyle işlem görür, silinen kullanıcı veya firma \`401\` alır. Display token (\`{ kind: 'display', firmId }\`) yalnız socket bağlantısı içindir; HTTP'de \`401\` döner.

**Hatalar.** Her hata \`{ "error": { "code", "message" } }\` şeklindedir. Bir istekte birden fazla sorun varsa sonuç \`401 → 403 → 404 → 400 → 409\` sırasıyla belirlenir. Başka firmanın kaynağı \`404\` döner, asla \`403\` değil. Parse edilemeyen JSON gövdesi bu sıranın dışındadır ve \`400\` alır. Beklenmeyen bir sunucu hatası \`500 INTERNAL_ERROR\` ("${INTERNAL_ERROR_MESSAGE}") döner; bu kod sözleşme dışı bir uzantıdır.

**Uzantılar.** Sözleşmede olmayan işlemlerin özetinde "(uzantı)" yazar: \`GET /api/auth/me\` ve \`GET /health\`.`;

function registerAuthPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Kimlik'],
    summary: 'Giriş yap',
    description: `E-posta ve şifreyi kullanıcı token'ına çevirir. E-posta büyük/küçük harfe duyarsız karşılaştırılır. ${NON_BLANK_RULE}`,
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: loginBodySchema.meta({ id: 'LoginRequest' }) } },
      },
    },
    responses: {
      200: {
        description: "Kullanıcı token'ı ve kullanıcı.",
        content: { 'application/json': { schema: loginResponseSchema } },
      },
      400: errorResponse(
        400,
        'Gövde bir JSON nesnesi değil ya da `email` veya `password` eksik veya boş.',
      ),
      401: errorResponse(
        401,
        'E-posta veya şifre hatalı. Silinmiş kullanıcı ve silinmiş firmanın kullanıcısı da aynı yanıtı alır.',
        LOGIN_FAILED_MESSAGE,
      ),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/auth/me',
    tags: ['Kimlik'],
    summary: 'Oturumdaki kullanıcı (uzantı)',
    description:
      "Sözleşme dışı uzantı (sözleşme notu N6): rol oturum ortasında değişebildiği için kullanıcıyı token'dan değil, bu istekte veritabanından okur. Kontrol arayüzü rol yönlendirmesi için kullanır.",
    security: BEARER_AUTH,
    responses: {
      200: {
        description: 'Veritabanındaki güncel kullanıcı.',
        content: { 'application/json': { schema: meResponseSchema } },
      },
      401: errorResponse(401, UNAUTHORIZED),
    },
  });
}

function registerFirmPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/api/firms',
    tags: ['Firmalar'],
    summary: 'Firmaları listele',
    description: 'Silinmemiş firmalar, en eskiden en yeniye. Yalnız platform_admin.',
    security: BEARER_AUTH,
    responses: {
      200: {
        description: 'Silinmemiş firmalar.',
        content: { 'application/json': { schema: firmListResponseSchema } },
      },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, PLATFORM_ADMIN_ONLY),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/firms',
    tags: ['Firmalar'],
    summary: "Firma ve ilk admin'ini oluştur",
    description: `Firmayı ve ilk firm_admin kullanıcısını tek işlemde oluşturur. \`adminEmail\` çakışırsa \`409\` döner ve firma oluşmaz. E-posta tüm sistemde, büyük/küçük harfe duyarsız olarak benzersizdir ve \`ad@alan\` biçiminde olmalıdır. ${NON_BLANK_RULE} Yalnız platform_admin.`,
    security: BEARER_AUTH,
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: createFirmBodySchema.meta({ id: 'CreateFirmRequest' }),
            example: {
              name: 'Initech Organizasyon',
              adminEmail: 'admin@initech.local',
              adminPassword: 'InitechAdmin!2026',
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: "Oluşturulan firma ve ilk admin'i.",
        content: { 'application/json': { schema: createFirmResponseSchema } },
      },
      400: errorResponse(
        400,
        'Gövde bir JSON nesnesi değil; `name`, `adminEmail` veya `adminPassword` eksik veya boş; ya da `adminEmail` geçerli değil.',
      ),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, PLATFORM_ADMIN_ONLY),
      409: errorResponse(
        409,
        '`adminEmail` başka bir aktif kullanıcıda kayıtlı; firma oluşturulmaz.',
      ),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/firms/{id}',
    tags: ['Firmalar'],
    summary: 'Firmayı yeniden adlandır',
    description: `${NON_BLANK_RULE} Yalnız platform_admin.`,
    security: BEARER_AUTH,
    request: {
      params: firmIdParams,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: renameFirmBodySchema.meta({ id: 'RenameFirmRequest' }),
            example: { name: 'Acme Fuarcılık A.Ş.' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Yeni adıyla firma.',
        content: { 'application/json': { schema: firmResponseSchema } },
      },
      400: errorResponse(400, 'Gövde bir JSON nesnesi değil ya da `name` eksik veya boş.'),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, PLATFORM_ADMIN_ONLY),
      404: errorResponse(404, FIRM_NOT_FOUND),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/firms/{id}',
    tags: ['Firmalar'],
    summary: 'Firmayı sil',
    description:
      "Soft delete: firma ve aktif kullanıcıları silinmiş sayılır. Kullanıcıların e-postaları yeniden kullanılabilir; token'ları ve firmanın display token'ları geçersizleşir; bağlı display'lerin bağlantısı kesilir. Silme idempotent değildir: silinmiş firmaya tekrar `DELETE` veya `PATCH` → `404`. Yalnız platform_admin.",
    security: BEARER_AUTH,
    request: { params: firmIdParams },
    responses: {
      204: { description: 'Silindi; gövde yok.' },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, PLATFORM_ADMIN_ONLY),
      404: errorResponse(404, FIRM_NOT_FOUND),
    },
  });
}

function createOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      "`POST /api/auth/login` yanıtındaki `token` değerini `Bearer ` öneki olmadan yapıştırın. Display token HTTP'de kabul edilmez.",
  });

  registerAuthPaths(registry);
  registerFirmPaths(registry);

  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Sağlık'],
    summary: 'Canlılık kontrolü (uzantı)',
    description: 'Sözleşme dışı uzantı: kimlik doğrulaması gerektirmeyen canlılık kontrolü.',
    responses: {
      200: {
        description: 'Servis ayakta.',
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Multi-Tenant Firm Service', version: '1.3', description: DESCRIPTION },
    tags: [
      { name: 'Kimlik', description: 'Giriş ve oturumdaki kullanıcı.' },
      { name: 'Firmalar', description: 'Platform admin firma yönetimi.' },
      { name: 'Sağlık', description: 'Canlılık kontrolü.' },
    ],
  });
}

/** Built once: the document is static, so every app serves this same object. */
export const OPENAPI_DOCUMENT = createOpenApiDocument();
