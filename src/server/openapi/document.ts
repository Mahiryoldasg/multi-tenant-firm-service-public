import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { LOGIN_FAILED_MESSAGE, loginBodySchema } from '../auth/login.ts';
import { INTERNAL_ERROR_MESSAGE } from '../http/error-handler.ts';
import {
  errorResponse,
  healthResponseSchema,
  loginResponseSchema,
  meResponseSchema,
} from './schemas.ts';

const BEARER_AUTH = [{ bearerAuth: [] }];

const NON_BLANK_RULE =
  'Zorunlu alanlar boş olmayan string olmalıdır; yalnız boşluktan oluşan değer boş sayılır.';

const DESCRIPTION = `Çok kiracılı (multi-tenant) firma ve çalışan yönetimi servisi. Dış yüzey, API sözleşmesine uyar.

**Kimlik doğrulama.** \`POST /api/auth/login\` dışındaki her \`/api\` isteği \`Authorization: Bearer <token>\` ister. Kullanıcı token'ı HS256 JWT'dir: \`{ sub, role, firmId? }\`; platform_admin'de \`firmId\` yoktur. Rol ve firma her istekte veritabanından okunur: rolü değişen kullanıcının token'ı sonraki istekte yeni rolüyle işlem görür, silinen kullanıcı veya firma \`401\` alır. Display token (\`{ kind: 'display', firmId }\`) yalnız socket bağlantısı içindir; HTTP'de \`401\` döner.

**Hatalar.** Her hata \`{ "error": { "code", "message" } }\` şeklindedir. Bir istekte birden fazla sorun varsa sonuç \`401 → 403 → 404 → 400 → 409\` sırasıyla belirlenir. Başka firmanın kaynağı \`404\` döner, asla \`403\` değil. Parse edilemeyen JSON gövdesi bu sıranın dışındadır ve \`400\` alır. Beklenmeyen bir sunucu hatası \`500 INTERNAL_ERROR\` ("${INTERNAL_ERROR_MESSAGE}") döner; bu kod sözleşme dışı bir uzantıdır.

**Uzantılar.** Sözleşmede olmayan işlemlerin özetinde "(uzantı)" yazar: \`GET /api/auth/me\` ve \`GET /health\`.`;

function createOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      "`POST /api/auth/login` yanıtındaki `token` değerini `Bearer ` öneki olmadan yapıştırın. Display token HTTP'de kabul edilmez.",
  });

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
      401: errorResponse(
        401,
        'Token yok, geçersiz veya süresi dolmuş; kullanıcı ya da firması silinmiş; ya da display token.',
      ),
    },
  });

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
      { name: 'Sağlık', description: 'Canlılık kontrolü.' },
    ],
  });
}

/** Built once: the document is static, so every app serves this same object. */
export const OPENAPI_DOCUMENT = createOpenApiDocument();
