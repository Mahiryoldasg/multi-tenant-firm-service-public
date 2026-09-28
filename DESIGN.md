# Tasarım

Bu belge, çok kiracılı (multi-tenant) firma ve çalışan yönetim
servisinin tasarım kararlarını ve gerekçelerini anlatır. Servis Node.js ve TypeScript ile
yazıldı: HTTP için Express 5, veri için better-sqlite3 (SQLite), gerçek zamanlı kanal için
Socket.IO, kontrol arayüzü için React. Dış yüzeyin tek kaynağı
API sözleşmesi; bir çelişkide sözleşme kazanır.

Kurulum ve örnek istekler için [README.md](README.md), belgelerin haritası için
[docs/README.md](docs/README.md), her kararın kısa "neden"i için
[docs/decisions.md](docs/decisions.md) (İngilizce).

## Veri modeli

Tek bir SQLite dosyası (`DB_PATH`, varsayılan `./data/app.db`), WAL modu ve
`foreign_keys = ON` ile açılır. Şema, açılışta sırayla uygulanan migration'larla kurulur;
kaçının uygulandığını `PRAGMA user_version` tutar
([src/server/db/migrations.ts](src/server/db/migrations.ts)). ORM yok: SQL, repository'lerde
açıkça yazılır.

| Tablo            | Alanlar                                                                                                         | Notlar                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firms`          | `id`, `name`, `active_mode_id`, `created_at`, `updated_at`, `deleted_at`                                        | `active_mode_id` firmanın aktif modudur: sözleşmedeki opak `modeId` gönderildiği gibi saklanır, hiç seçilmediyse `NULL`. Firma adı benzersiz değildir.                                                  |
| `users`          | `id`, `firm_id`, `email`, `email_normalized`, `password_hash`, `role`, `created_at`, `updated_at`, `deleted_at` | `role`: `platform_admin`, `firm_admin` ya da `member`. `email` gönderildiği harf büyüklüğüyle saklanır ve döner; karşılaştırma ve benzersizlik `email_normalized` (kırpılmış, küçük harf) üzerindendir. |
| `display_tokens` | `id`, `firm_id`, `label`, `created_by_user_id`, `created_at`                                                    | `id`, token'daki `jti`'dir. Token'ın kendisi hiçbir yerde saklanmaz. `created_by_user_id` yalnız kayıt içindir, token'ın geçerliliğini etkilemez.                                                       |
| `meta`           | `key`, `value`                                                                                                  | Seed işareti (`seeded_at`).                                                                                                                                                                             |

Kısıtlar:

- **`CHECK`:** `role = 'platform_admin'` ancak ve ancak `firm_id IS NULL`. Firmasız bir kullanıcı
  tam olarak platform admin'dir; bir firma kullanıcısının firması boş olamaz.
- **E-posta benzersizliği:** `email_normalized` üzerinde `WHERE deleted_at IS NULL` koşullu
  benzersiz index. E-posta tüm sistemde ve büyük/küçük harfe duyarsız benzersizdir; silinen bir
  kullanıcının e-postası yeniden kullanılabilir. Uygulama temiz bir `409` için önce kendisi
  kontrol eder; araya giren bir yazma index'e takılırsa o hata da `409`'a çevrilir.
- **`(firm_id, deleted_at)` index'i:** bir firmanın aktif kullanıcılarını okuyan sorgular için.

Kimlikler ve zaman:

- Kimlikler `crypto.randomUUID()` ile üretilen TEXT UUID'lerdir. Tahmin edilemezler, ama izolasyon
  buna dayanmaz: başka firmanın id'sini bilen biri de `404` alır. Bu yalnız ek bir savunma
  katmanıdır.
- Zaman damgaları ISO 8601 biçiminde, UTC, TEXT olarak saklanır.

Soft delete:

- Silme, satırı kaldırmaz, `deleted_at` alanını doldurur; okumalar silinmiş satırları dışarıda
  bırakır. Silinmiş bir kaynak `404`'tür, tekrar gelen bir `DELETE` ya da `PATCH` dahil.
- Firma silme tek bir `BEGIN IMMEDIATE` transaction'ıdır: firmayı ve aktif kullanıcılarını
  birlikte siler, böylece kullanıcıların e-postaları serbest kalır. Commit'ten sonra firmanın
  bağlı display'leri koparılır (bkz. "Tenant izolasyonu", gerçek zamanlı kanal).

Seed ([src/server/db/seed.ts](src/server/db/seed.ts)):

- İlk açılışta, tek bir transaction'da: platform admin ve iki firma, her biri ilk admin'iyle.
  Varsayılan değerlerle "Acme Fuarcılık" (`admin@acme.local`) ve "Globex Etkinlik"
  (`admin@globex.local`). Değerler `SEED_*` ortam değişkenlerinden gelir ve README'de listelidir.
  Tam 2 firma oluşur, üye oluşmaz.
- Seed'in yapıldığı satır sayılarından değil, `meta` tablosundaki işaretten anlaşılır. Seed
  firmaları silinse de ikinci bir seed olmaz.

## Tenant izolasyonu

Farklı firmaların kullanıcıları birbirine düşman kabul edilir: bir kullanıcı başka firmanın
id'lerini tahmin edebilir ya da bir yerden öğrenebilir. Hedef, başka firmanın verisine erişimi
her endpoint'te ve socket kanalında imkânsız kılmak; bunu her sorguya elle `WHERE firm_id = ?`
ekleyerek değil, unutulması zor bir yapıyla yapmak. Başka firmanın kaynağı `404` döner, `403`
değil: yanıt, kaynağın var olup olmadığını da sızdırmaz.

### Nerede uygulanır

**1. HTTP pipeline'ı** ([src/server/app.ts](src/server/app.ts)). Kapılar, sözleşmedeki kontrol
sırasını (`401 → 403 → 404 → 400 → 409`) veren sırayla dizilir:

- `authenticate` (`/api` altında login dışındaki her yol): token'ı doğrular, kullanıcıyı ve
  firmasını her istekte veritabanından yeniden okur; ikisinden biri yoksa ya da silinmişse `401`.
  Rol ve firma token'dan değil, bu okumadan gelir.
- `requirePlatformAdmin` (`/api/firms`): platform admin değilse, her metot ve alt yolda `403`.
- `requireTenant` (`/api/employees`, `/api/mode`, `/api/display-tokens`): firmasız çağıran, yani
  platform admin, her metot ve alt yolda `403` alır; firma kullanıcısı için `req.tenant` kurulur.
- `requireFirmAdmin` (yazma işlemleri): `member` `403` alır.
- Handler: önce firmaya bağlı arama (yoksa ya da başka firmanınsa `404`), sonra Zod ile gövde
  doğrulaması (`400`), sonra servis (e-posta çakışması `409`). Doğrulamanın aramadan sonra
  olması bilinçli: şema önce çalışsaydı, başka firmanın kaynağına bozuk gövdeyle gelen istek
  `404` yerine `400` alırdı.

**2. Firmaya bağlı repository'ler** ([src/server/tenancy/](src/server/tenancy/)).
`createTenantScope(db, firmId)`, bir firmaya bağlı `employees`, `mode` ve `displayTokens`
repository'lerini ve firmanın display kanalını (`displays`) döner:

- Firma, scope kurulurken bir kez verilir: `authenticate`'in o istekte veritabanından okuduğu
  firma. Hiçbir metot firma id'si almaz; handler başka bir firmanın satırını isteyemez, çünkü
  isteyecek bir parametre yoktur.
- Tenant handler'larının okuduğu ve yazdığı her satırın firma koşulu yalnız bu repository'lerde
  yazılır.
- Çağıranın nesnesi SQL parametrelerine yayılırken önce o nesne, sonra repository'nin kendi `id`,
  `firmId` ve `now` değerleri gelir. Yanlışlıkla bir `firmId` taşıyan nesne bile satırı başka
  firmaya yazamaz; bunu çalışan ve display token eklemeleri için birer regresyon testi kanıtlar.

**3. Tenant route'ları yalnız `req.tenant` görür**
([src/server/modules/tenant/](src/server/modules/tenant/)). Route'lar veriye yalnız
`getTenant(req)` ile ulaşır. `app.ts` bu router'ları `db` bağımlılığı vermeden kurar; tenant
kodunun elinde kötüye kullanabileceği bir veritabanı bağlantısı yoktur. `getTenant`,
`requireTenant` arkasında olmayan bir route'ta çağrılırsa istek `500` ile düşer; route anonim
çalışmaz.

**4. Lint sınırı** ([eslint.config.js](eslint.config.js)). `no-restricted-imports` kuralı,
`src/server/modules/tenant/**` dosyalarının `better-sqlite3`'ü, herhangi bir `db` modülünü ya da
`platform` modülünü import etmesini yasaklar (type-only import'lar ve re-export'lar dahil);
ihlal `npm run lint`'i kırar. Kural, gerçek config ile bir testte de denenir
([tests/tenancy/boundary-rule.test.ts](tests/tenancy/boundary-rule.test.ts)). Bu bir korkuluktur,
kum havuzu değil: yalnız statik import'ları görür, dinamik bir `import()` ya da Node'un kendi
`node:sqlite` modülü onu atlatabilir. Asıl güvence, tenant router'larının zaten bir `db`
bağlantısı almamasıdır.

**5. Hata yanıtları.** Başka firmanın, hiç olmayan ve silinmiş bir çalışan aynı `404` kodunu ve
aynı mesajı alır ("Çalışan bulunamadı."); iç ayrıntılar yalnız loglara gider. Platform admin firma
bağlamındaki yollarda `403` alır: firması olmadığı için orada bakabileceği bir kaynak yoktur.

**6. Gerçek zamanlı kanal** ([src/server/realtime/](src/server/realtime/)):

- Handshake yalnız display token'ı kabul eder: HS256 imzalı, `kind: 'display'`, string bir
  `firmId`, `sub` ya da `role` yok ve firma hâlâ aktif. Aksi halde bağlantı `connect_error` ile
  reddedilir.
- Socket, `firm:<firmId>` odasına girer; firma id'si doğrulanmış token'dan ve veritabanındaki
  firma satırından gelir. İstemci oda seçemez; sunucu istemciden hiçbir olay dinlemez.
- `mode-change` yalnız `broadcastModeChange(firmId, modeId)` ile gönderilir. Tenant handler'ı
  ona da `req.tenant.displays` üzerinden ulaşır; firma burada da scope kurulurken sabitlenir.
- Başarılı her `POST /api/mode`, değer değişmese de olayı gönderir. Bağlanınca hiçbir şey
  gönderilmez.
- Firma silinince, commit'ten sonra firmanın odasındaki bütün socket'ler koparılır; yeniden
  bağlanmaya çalışan display, aktif firma kontrolünde reddedilir.
- Handshake kontrolü senkrondur: Socket.IO socket'i bu zincirden bir `process.nextTick` sonra
  bağlar, yani aktif firma kontrolü ile odaya katılma arasına bir firma silme isteği giremez.

### Nasıl kanıtlanır

[tests/isolation/](tests/isolation/) klasöründeki testler:

- `cross-tenant.test.ts`: A firmasının token'ı ile B firmasının id'leri, her tenant endpoint'inde
  `404` alır (rol zaten yetmiyorsa `403`) ve hiçbir tabloyu değiştirmez. Başka firmanın, bilinmeyen
  ve silinmiş bir id aynı gövdeyi alır. Sorguya ya da gövdeye sokulan başka firma id'si yok
  sayılır. Token claim'leri firmayı ve rolü seçemez.
- `invalidation.test.ts`: silinen çalışanın token'ı ve girişi sonraki istekte `401` alır; silinen
  firmanın kullanıcıları `401`, display'leri `connect_error` alır ve diğer firma çalışmaya devam
  eder. Rol değişikliği sonraki istekte, iki yönde de uygulanır. Display token'ı, onu üreten
  kullanıcının rolü düşürülüp silinse de çalışır.
- `socket-leak.test.ts`: iki firma, her birinde üç display, aynı anda bağlı. Her olay kendi
  firmasının bütün display'lerine sırasıyla ulaşır, diğer firmanınkilere hiç ulaşmaz. Bir olayın
  gelmediği, ardından gelmesi gereken bir olay gönderilerek kanıtlanır: Socket.IO bir bağlantıda
  sırayı korur, sızan bir olay ondan önce gelirdi. Testler sabit bir bekleme süresine dayanmaz.
