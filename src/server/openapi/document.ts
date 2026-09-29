import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { LOGIN_FAILED_MESSAGE, loginBodySchema } from '../auth/login.ts';
import { INTERNAL_ERROR_MESSAGE } from '../http/error-handler.ts';
import {
  createFirmBodySchema,
  FIRM_NOT_FOUND_MESSAGE,
  renameFirmBodySchema,
} from '../modules/platform/firm-routes.ts';
import { issueDisplayTokenBodySchema } from '../modules/tenant/display-token-routes.ts';
import {
  createEmployeeBodySchema,
  EMPLOYEE_NOT_FOUND_MESSAGE,
  updateEmployeeBodySchema,
} from '../modules/tenant/employee-routes.ts';
import { setModeBodySchema } from '../modules/tenant/mode-routes.ts';
import {
  activeModeResponseSchema,
  createFirmResponseSchema,
  displayTokenResponseSchema,
  employeeListResponseSchema,
  employeeResponseSchema,
  errorResponse,
  firmListResponseSchema,
  firmResponseSchema,
  healthResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  setModeResponseSchema,
} from './schemas.ts';

const BEARER_AUTH = [{ bearerAuth: [] }];

const NON_BLANK_RULE =
  'Zorunlu alanlar boş olmayan string olmalıdır; yalnız boşluktan oluşan değer boş sayılır.';

const UNAUTHORIZED =
  'Token yok, geçersiz veya süresi dolmuş; kullanıcı ya da firması silinmiş; ya da display token.';

const PLATFORM_ADMIN_ONLY = 'Çağıran platform_admin değil (firm_admin veya member).';

const FIRM_CONTEXT_ONLY =
  'Çağıran platform_admin: firması olmadığı için firma bağlamındaki tüm yollarda 403 alır.';

const FIRM_ADMIN_ONLY =
  'Çağıran platform_admin (firma bağlamındaki tüm yollarda 403) ya da member (yazma işlemleri yalnız firm_admin içindir).';

const LOOKUP_BEFORE_BODY = 'Bu kontrol gövdenin doğrulanmasından önce yapılır.';

const FIRM_NOT_FOUND = 'Firma yok, silinmiş ya da `id` geçersiz.';

const EMPLOYEE_NOT_FOUND =
  'Çalışan yok, silinmiş, başka firmaya ait ya da `id` geçersiz; hepsi aynı yanıtı alır.';

const firmIdParams = z.object({ id: z.string().meta({ description: 'Firma kimliği.' }) });

const employeeIdParams = z.object({ id: z.string().meta({ description: 'Çalışan kimliği.' }) });

// The documented .env.example defaults, which a test keeps equal to that file. Not the live SEED_*
// config: that would publish whatever admin passwords are configured on this public page.
const SEED_LOGIN_EXAMPLES = {
  platformAdmin: {
    summary: 'Platform admin (seed)',
    value: { email: 'admin@platform.local', password: 'PlatformAdmin!2026' },
  },
  firm1Admin: {
    summary: 'Acme Fuarcılık firm_admin (seed)',
    value: { email: 'admin@acme.local', password: 'AcmeAdmin!2026' },
  },
  firm2Admin: {
    summary: 'Globex Etkinlik firm_admin (seed)',
    value: { email: 'admin@globex.local', password: 'GlobexAdmin!2026' },
  },
};

const SEED_LOGIN_HINT =
  "Seed hesaplarından birini istek gövdesinin örnek listesinden seçin. Bunlar `.env.example`'daki belgelenmiş varsayılan değerlerdir; `.env`'de `SEED_*` değiştirildiyse o değerleri kullanın. Dönen `token` değerini Authorize düğmesine `Bearer ` öneki olmadan yapıştırın; yetki sayfa yenilense de korunur.";

const DESCRIPTION = `Çok kiracılı (multi-tenant) firma ve çalışan yönetimi servisi. Dış yüzey, API sözleşmesine uyar.

**Hızlı başlangıç.** \`POST /api/auth/login\` işleminde "Try it out" deyin. ${SEED_LOGIN_HINT}

**Kimlik doğrulama.** \`POST /api/auth/login\` dışındaki her \`/api\` isteği \`Authorization: Bearer <token>\` ister. Kullanıcı token'ı HS256 JWT'dir: \`{ sub, role, firmId? }\`; platform_admin'de \`firmId\` yoktur. Rol ve firma her istekte veritabanından okunur: rolü değişen kullanıcının token'ı sonraki istekte yeni rolüyle işlem görür, silinen kullanıcı veya firma \`401\` alır. Display token (\`{ kind: 'display', firmId }\`) yalnız socket bağlantısı içindir; HTTP'de \`401\` döner.

**Hatalar.** Her hata \`{ "error": { "code", "message" } }\` şeklindedir. Bir istekte birden fazla sorun varsa sonuç \`401 → 403 → 404 → 400 → 409\` sırasıyla belirlenir. Başka firmanın kaynağı \`404\` döner, asla \`403\` değil. Parse edilemeyen JSON gövdesi bu sıranın dışındadır ve \`400\` alır. Beklenmeyen bir sunucu hatası \`500 INTERNAL_ERROR\` ("${INTERNAL_ERROR_MESSAGE}") döner; bu kod sözleşme dışı bir uzantıdır.

**Gerçek zamanlı kanal (Socket.IO).** Display istemcisi \`io(url, { auth: { token: <display token> } })\` ile bağlanır. Eksik veya geçersiz token, kullanıcı token'ı ve silinmiş firmanın token'ı \`connect_error\` ile reddedilir. \`POST /api/mode\` her başarılı çağrıda, aynı değer tekrar gönderilse bile, yalnız o firmanın bağlı display'lerine \`mode-change\` event'ini \`{ modeId }\` ile gönderir; başka firmanın display'i bu event'i hiçbir koşulda almaz. Firma silinince bağlı display'lerinin bağlantısı sunucu tarafından kesilir. Bağlanma anında mevcut mod gönderilmez; bağlı bir display onu sözleşme dışı bir istekle sorabilir (uzantı): \`socket.emit('mode:get', (yanıt) => ...)\`. Yanıt yalnız soran display'e gider ve kendi firmasının modunu \`GET /api/mode\` ile aynı şekilde taşır: \`{ modeId }\`, hiç mod seçilmediyse \`{ modeId: null }\`. İstek başka bir firmayı adlandıramaz ve hiçbir event tetiklemez; beklenmeyen bir hatada yanıt \`{ "error": { "code": "INTERNAL_ERROR", "message" } }\` olur. Socket kanalı OpenAPI ile tanımlanamadığı için yalnız burada anlatılır.

**Kontrol kanalı (uzantı, sözleşme dışı).** Kontrol arayüzü, açık firma ekranlarında modu canlı göstermek için ayrı bir namespace'e bağlanır: \`io(url + '/control', { auth: { token: <kullanıcı token'ı> } })\`. Yalnız firma kullanıcıları (firm_admin ve member) bağlanabilir; kullanıcı ve firması handshake'te veritabanından okunur. Platform admin, display token ve geçersiz, süresi dolmuş ya da silinmiş kullanıcının token'ı \`connect_error\` ile reddedilir. Her başarılı \`POST /api/mode\`, aynı değer tekrar gönderilse bile, yalnız o firmanın kontrol ekranlarına veri taşımayan bir \`mode:changed\` event'i gönderir; istemci modu \`GET /api/mode\` ile okur. Display'ler bu event'i, kontrol ekranları da \`mode-change\` event'ini almaz. Bağlanma anında bir şey gönderilmez; firma silinince bu bağlantılar da kesilir.

**Uzantılar.** Sözleşmede olmayan işlemlerin özetinde "(uzantı)" yazar: \`GET /api/auth/me\`, \`GET /api/employees/{id}\` ve \`GET /health\`.`;

function registerAuthPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Kimlik'],
    summary: 'Giriş yap',
    description: `E-posta ve şifreyi kullanıcı token'ına çevirir. E-posta büyük/küçük harfe duyarsız karşılaştırılır. ${NON_BLANK_RULE}\n\n${SEED_LOGIN_HINT}`,
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: loginBodySchema.meta({ id: 'LoginRequest' }),
            examples: SEED_LOGIN_EXAMPLES,
          },
        },
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
      404: errorResponse(404, `${FIRM_NOT_FOUND} ${LOOKUP_BEFORE_BODY}`, FIRM_NOT_FOUND_MESSAGE),
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
      404: errorResponse(404, FIRM_NOT_FOUND, FIRM_NOT_FOUND_MESSAGE),
    },
  });
}

function registerEmployeePaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/api/employees',
    tags: ['Çalışanlar'],
    summary: 'Çalışanları listele',
    description:
      'Çağıranın firmasının silinmemiş çalışanları, en eskiden en yeniye. Firmadaki herkes (firm_admin, member).',
    security: BEARER_AUTH,
    responses: {
      200: {
        description: 'Kendi firmasının çalışanları.',
        content: { 'application/json': { schema: employeeListResponseSchema } },
      },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_CONTEXT_ONLY),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/employees/{id}',
    tags: ['Çalışanlar'],
    summary: 'Çalışanı getir (uzantı)',
    description:
      'Sözleşme dışı uzantı (sözleşme notu N5): başka firmanın çalışanının okunamadığı test edilmelidir ve sözleşme `/api/employees/:id` yolunu "tüm metotlarıyla" anar. Firmadaki herkes (firm_admin, member).',
    security: BEARER_AUTH,
    request: { params: employeeIdParams },
    responses: {
      200: {
        description: 'Kendi firmasının çalışanı.',
        content: { 'application/json': { schema: employeeResponseSchema } },
      },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_CONTEXT_ONLY),
      404: errorResponse(404, EMPLOYEE_NOT_FOUND, EMPLOYEE_NOT_FOUND_MESSAGE),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/employees',
    tags: ['Çalışanlar'],
    summary: 'Çalışan ekle',
    description: `Çağıranın firmasına çalışan ekler. \`role\` yalnız \`firm_admin\` veya \`member\` olabilir; platform_admin bu yolla yaratılamaz. E-posta tüm sistemde, büyük/küçük harfe duyarsız olarak benzersizdir ve \`ad@alan\` biçiminde olmalıdır. ${NON_BLANK_RULE} Yalnız firm_admin.`,
    security: BEARER_AUTH,
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: createEmployeeBodySchema.meta({ id: 'CreateEmployeeRequest' }),
            example: { email: 'ayse@acme.local', password: 'Calisan!2026', role: 'member' },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Eklenen çalışan.',
        content: { 'application/json': { schema: employeeResponseSchema } },
      },
      400: errorResponse(
        400,
        'Gövde bir JSON nesnesi değil; `email`, `password` veya `role` eksik veya boş; `email` geçerli değil; ya da `role` `firm_admin` veya `member` değil.',
      ),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_ADMIN_ONLY),
      409: errorResponse(409, 'E-posta başka bir aktif kullanıcıda kayıtlı.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/employees/{id}',
    tags: ['Çalışanlar'],
    summary: 'Çalışanı güncelle',
    description:
      "`email` ve `role` alanlarından en az biri gönderilmelidir; diğer alanlar (`password` ve `firmId` dahil) yok sayılır. Alan kuralları `POST` ile aynıdır. Rol değişikliği çalışanın mevcut token'ına sonraki istekte yansır. Yalnız firm_admin.",
    security: BEARER_AUTH,
    request: {
      params: employeeIdParams,
      body: {
        required: true,
        content: {
          'application/json': {
            schema: updateEmployeeBodySchema.meta({ id: 'UpdateEmployeeRequest' }),
            example: { role: 'firm_admin' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Güncellenen çalışan.',
        content: { 'application/json': { schema: employeeResponseSchema } },
      },
      400: errorResponse(
        400,
        'Gövde bir JSON nesnesi değil; güncellenecek alan yok; `email` boş veya geçerli değil; ya da `role` geçerli değil.',
      ),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_ADMIN_ONLY),
      404: errorResponse(
        404,
        `${EMPLOYEE_NOT_FOUND} ${LOOKUP_BEFORE_BODY}`,
        EMPLOYEE_NOT_FOUND_MESSAGE,
      ),
      409: errorResponse(409, 'Yeni e-posta başka bir aktif kullanıcıda kayıtlı.'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/employees/{id}',
    tags: ['Çalışanlar'],
    summary: 'Çalışanı sil',
    description:
      "Soft delete: çalışanın token'ı ve login'i geçersizleşir, e-postası yeniden kullanılabilir. Silme idempotent değildir: silinmiş çalışana tekrar `DELETE` veya `PATCH` → `404`. Yalnız firm_admin.",
    security: BEARER_AUTH,
    request: { params: employeeIdParams },
    responses: {
      204: { description: 'Silindi; gövde yok.' },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_ADMIN_ONLY),
      404: errorResponse(404, EMPLOYEE_NOT_FOUND, EMPLOYEE_NOT_FOUND_MESSAGE),
    },
  });
}

function registerModeAndDisplayTokenPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/api/mode',
    tags: ['Mod'],
    summary: 'Aktif modu getir',
    description:
      'Çağıranın firmasının aktif modu; hiç mod seçilmediyse `null`. Firmadaki herkes (firm_admin, member).',
    security: BEARER_AUTH,
    responses: {
      200: {
        description: 'Firmanın aktif modu.',
        content: { 'application/json': { schema: activeModeResponseSchema } },
      },
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_CONTEXT_ONLY),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/mode',
    tags: ['Mod'],
    summary: 'Aktif modu ayarla',
    description:
      "`modeId` opak bir string'dir: boş olmayan her değer olduğu gibi (kırpılmadan) saklanır; mod listesi veya doğrulaması yoktur. Her başarılı çağrıda, aynı değer tekrar gönderilse bile, yalnız bu firmanın bağlı display'lerine Socket.IO `mode-change` event'i `{ modeId }` ile gider. Yalnız firm_admin.",
    security: BEARER_AUTH,
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: setModeBodySchema.meta({ id: 'SetModeRequest' }),
            example: { modeId: 'welcome-screen' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Saklanan aktif mod.',
        content: { 'application/json': { schema: setModeResponseSchema } },
      },
      400: errorResponse(400, 'Gövde bir JSON nesnesi değil ya da `modeId` eksik veya boş.'),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_ADMIN_ONLY),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/display-tokens',
    tags: ['Display token'],
    summary: 'Display token üret',
    description:
      "Bu firmanın display'leri için HS256 token üretir. Claim'leri `{ kind: 'display', firmId }` (ayrıca `iat` ve `jti`); süresi dolmaz. Token yalnız Socket.IO handshake'inde (`auth.token`) geçerlidir; HTTP API'de `401` alır. Onu üreten kullanıcının silinmesinden veya rol değişiminden etkilenmez, yalnız firma silinince geçersizleşir. Gövde isteğe bağlıdır; `label` gönderilirse string olmalıdır. Yalnız firm_admin.",
    security: BEARER_AUTH,
    request: {
      body: {
        required: false,
        content: {
          'application/json': {
            schema: issueDisplayTokenBodySchema.meta({ id: 'IssueDisplayTokenRequest' }),
            example: { label: 'Salon A ekranı' },
          },
        },
      },
    },
    responses: {
      201: {
        description: "Display token'ı.",
        content: { 'application/json': { schema: displayTokenResponseSchema } },
      },
      400: errorResponse(400, 'Gövde bir JSON nesnesi değil ya da `label` string değil.'),
      401: errorResponse(401, UNAUTHORIZED),
      403: errorResponse(403, FIRM_ADMIN_ONLY),
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
  registerEmployeePaths(registry);
  registerModeAndDisplayTokenPaths(registry);

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
      { name: 'Çalışanlar', description: 'Çağıranın firmasındaki çalışanlar.' },
      { name: 'Mod', description: 'Firmanın aktif modu.' },
      { name: 'Display token', description: 'Socket bağlantısı için display token üretimi.' },
      { name: 'Sağlık', description: 'Canlılık kontrolü.' },
    ],
  });
}

/** Built once: the document is static, so every app serves this same object. */
export const OPENAPI_DOCUMENT = createOpenApiDocument();
