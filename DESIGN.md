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

## Kimlik doğrulama ve yetki

### Token'lar

- HS256 JWT, `JWT_SECRET` ile imzalanır. Doğrulama `algorithms: ['HS256']` ile sabitlenir; token
  kendi algoritmasını (`none` ya da başka bir HMAC) seçemez. HTTP ve socket aynı doğrulama
  fonksiyonunu kullanır ([src/server/auth/tokens.ts](src/server/auth/tokens.ts)).
- Sır yalnız ortamdan gelir, kodda yoktur. `npm start` ilk çalıştırmada `.env` dosyasını oluşturur
  ve rastgele bir `JWT_SECRET` üretir; `JWT_SECRET` yoksa servis açılmaz.
- **Kullanıcı token'ı:** `{ sub, role, firmId? }` ile `iat` ve `exp`. Ömrü `USER_TOKEN_TTL`
  (varsayılan `12h`). Platform admin'de `firmId` gönderilmez: `null` değil, hiç yoktur.
- **Display token'ı:** `{ kind: 'display', firmId }` ile `iat` ve `jti`; `exp` yoktur. `jti`,
  token'ın `display_tokens` satırının id'sidir. Yalnız socket handshake'inde geçer, herhangi bir
  HTTP yolunda `401` alır. Onu üreten kullanıcının silinmesi ya da rolünün değişmesi token'ı
  etkilemez; firması silinince geçersiz olur. Token metni saklanmaz ve loglanmaz.
- Kullanıcı token'ıyla socket'e bağlanmaya çalışan `connect_error` alır.

### Her istekte veritabanı

`authenticate`, token'ın `sub` değeriyle kullanıcıyı her istekte yeniden okur; rol ve firma bu
satırdan gelir, token'daki `role` ve `firmId` claim'leri hiç okunmaz. Böylece rol değişikliği
sonraki istekte uygulanır; silinen bir kullanıcı ya da silinen bir firmanın kullanıcısı, token'ının
süresi dolmadan `401` alır. Bunun için bir blacklist gerekmez. `GET /api/auth/me` (uzantı) aynı
okumadan mevcut kullanıcıyı döner; arayüz rolü buradan öğrenir.

### Şifreler ve giriş

- Şifreler `node:crypto` scrypt ile saklanır: kullanıcı başına 16 baytlık rastgele salt, 64 baytlık
  anahtar, `timingSafeEqual` ile sabit zamanlı karşılaştırma
  ([src/server/auth/password.ts](src/server/auth/password.ts)). Hash asenkron hesaplanır, event
  loop'u bloklamaz; native bir bağımlılık gerekmez.
- Bilinmeyen e-posta, yanlış şifre, silinmiş kullanıcı ve silinmiş firma aynı `401` gövdesini alır
  ("E-posta veya şifre hatalı."). Bilinmeyen bir e-posta da sahte bir hash'e karşı denetlenir; yanıt
  süresi de hangi e-postaların var olduğunu ele vermez.
- Loglarda `Authorization` başlığı ve şifre alanları maskelenir.

### Platform admin modeli

Firma CRUD'u yalnız platform admin tarafından yapılır. Bunun nasıl modellendiği:

- Platform admin ayrı bir tablo ya da ayrı bir giriş yolu değildir: `users` tablosunda
  `role = 'platform_admin'` ve `firm_id = NULL` olan bir satırdır. `CHECK` kısıtı ikisini birbirine
  bağlar: firmasız kullanıcı yalnız platform admin olabilir, platform admin'in firması olamaz.
- Aynı `POST /api/auth/login` ile girer, aynı biçimde bir token alır (`firmId` olmadan) ve aynı
  `authenticate`'ten geçer. Fark yalnız yetkidedir: `/api/firms` altında yalnız platform admin geçer
  (`requirePlatformAdmin`); firma bağlamındaki yollarda (`/api/employees`, `/api/mode`,
  `/api/display-tokens`) her metotta `403` alır.
- Seed tek bir platform admin oluşturur (`SEED_PLATFORM_ADMIN_*`). API'de başka bir platform admin
  oluşturan yol yoktur: çalışan endpoint'leri `role` olarak yalnız `firm_admin` ya da `member`
  kabul eder, `platform_admin` `400` alır.
- Neden böyle: giriş, token ve kimlik doğrulama tek bir yol olarak kalır; sistem çapındaki e-posta
  benzersizliği platform admin'i de kapsar; firmasız bir firma kullanıcısı ya da firmalı bir
  platform admin veritabanı seviyesinde imkânsızdır.

### Kontrol arayüzü

Arayüz, dışarıya açık API'yi HTTP üzerinden, `Authorization: Bearer` ile kullanır; servis
katmanına ya da veritabanına arka bir yolu yoktur. Token `sessionStorage`'da tutulur: sayfa
yenilenince kalır, sekme kapanınca biter. Bir `401` oturumu kapatır ve giriş ekranına döner.

## Trade-off'lar

Her madde: seçim, neden, bedeli.

- **SQLite, tek dosya.** Kurulum gerektirmez; `npm install && npm start` yeter ve testler dosya
  başına bellek içi bir veritabanıyla hızlı çalışır. Bedeli: tek süreç ve tek yazıcı; birden fazla
  instance için bir veritabanı sunucusu gerekir.
- **Ham SQL ve repository'ler, ORM yok.** Tenant koşulu tek bir yerde ve göz önündedir; arada
  sihir yoktur, her sorgu satır satır açıklanabilir. Bedeli: şema değiştiğinde SQL ve tipler elle
  güncellenir.
- **Express 5 ve elle sıralanmış pipeline.** Sözleşmedeki `401 → 403 → 404 → 400 → 409` sırası,
  gövde doğrulamasının kaynak aramasından sonra yapılmasını gerektirir. Şema öncelikli
  framework'ler handler'dan önce doğrular ve `404` yerine `400` verirdi. Bedeli: her handler
  doğrulamayı açıkça çağırır.
- **Her istekte veritabanı okuması.** Silme ve rol değişikliği sonraki istekte geçerli olur,
  blacklist gerekmez (sözleşme §2). Bedeli: her istekte index'li bir sorgu; ölçekte bir önbellek ya
  da daha kısa ömürlü token'lar düşünülmeli.
- **Soft delete.** Silinen kaydın satırı kalır. `display_tokens` satırlarının firmaya ve token'ı
  üreten kullanıcıya bağlanan foreign key'leri kırılmaz, bu yüzden token'ı üreten kullanıcı
  silinse de display token'ı sözleşmedeki gibi çalışmaya devam eder ve kaydı kaybolmaz; firma
  silme, kullanıcılarıyla birlikte tek bir transaction'da iki `UPDATE`'tir. Bedeli: her okuma
  `deleted_at IS NULL` koşulu taşır, e-posta benzersizliği koşullu bir index ister ve veri fiziksel
  olarak silinmez.
- **Süreç içi Socket.IO odaları.** Tek instance için yeterli, ek servis gerektirmez. Bedeli: ikinci
  bir süreç, başka süreçteki display'lere yayın yapamaz; yatay ölçekte Redis adapter gibi paylaşılan
  bir katman gerekir.
- **Koşulsuz yayın, bağlanınca yayın yok.** Sözleşme her başarılı `POST /api/mode`'da olay istiyor;
  bağlanınca kendiliğinden gönderilen bir olay, sözleşme testlerindeki "tam bir olay" ya da "hiç olay
  yok" beklentilerini bozabilirdi. Bedeli: yeniden bağlanan bir display, bir sonraki
  `POST /api/mode`'a kadar güncel modu öğrenemez (N4).
- **Display token'ında `exp` ve revoke yok.** Sözleşme böyle tanımlıyor ve kiosk'un yeniden giriş
  yapma yolu yok; `jti` ileride revoke için saklanır. Bedeli: sızan bir display token'ı firma
  silinene kadar geçerlidir; yalnız o firmanın mod değişikliklerini dinleyebilir, HTTP'de `401`
  alır.
- **`sessionStorage` ve Bearer, HttpOnly cookie değil.** Sözleşme tarayıcıdan
  `Authorization: Bearer` istiyor; cookie olmadığı için CSRF yüzeyi de yok. Bedeli: bir XSS token'ı
  okuyabilir. Arayüz kullanıcı metnini yalnız React ile, kaçışlı olarak render eder.
- **Lint sınırı bir korkuluk.** Ayrı bir paket ya da çalışma zamanı sandbox'ı yerine lint kuralı ve
  tenant router'larına `db` verilmemesi. Bedeli: dinamik bir `import()` kuralı atlatabilir; bunu
  kod incelemesi yakalamalı.
- **Son firma admin'i korunmuyor.** Sözleşme bu durumu tanımlamıyor; engellemek sözleşme testleriyle
  çelişebilirdi. Bedeli: bir firma yönetilemez kalabilir (N2).
- **Türkçe `error.message`, sözleşmedeki `code`.** Sözleşme örneği Türkçe, arayüz mesajı olduğu gibi
  gösterir, testler `code`'a bakar. Bedeli: tek dil; i18n kapsam dışı.
- **Node'un varsayılan scrypt maliyeti** (N=16384, r=8, p=1). Giriş ve testler hızlı kalır. Bedeli:
  OWASP daha yüksek bir maliyet öneriyor; yükseltmek hash biçimine bir sürüm ya da yeniden seed
  gerektirir.

## Sözleşme notları

Sözleşme, bulunan çelişki ve belirsizliklerin DESIGN.md'de "sözleşme notu" olarak yazılmasını
istiyor. Sözleşmedeki yollar, istek ve yanıt şekilleri değiştirilmedi; sözleşmenin sustuğu yerde
seçilen davranış ve gerekçesi aşağıda. Swagger açıklamalarında ve kodda geçen not numaraları
bunlarla aynıdır.

**N1: Node ≥ 18 ve bugünkü ekosistem.** Sözleşme §1 `Node.js ≥ 18` diyor. Node 18'in desteği Nisan
2025'te, Node 20'ninki Nisan 2026'da bitti. better-sqlite3 13.x Node 22 ve üstünü ister, 12.x Node
20-26'yı destekler, 11.x ise en yeni Node sürümleri için hazır binary içermez. Node 18'den bugünkü
sürümlere kadar hazır binary'yle çalışan bir sürüm yok; temiz bir makinede C++ derleme araçları
gerekirdi. Ne yaptık: `engines` alanında `>=20.19`; Node 22 ve 24 ile doğrulandı; daha eski bir
Node'da `npm start` anlaşılır bir mesajla durur.

**N2: Bir firma yönetilemez kalabilir.** Son `firm_admin` kendini silebilir ya da `member`'a
düşürebilir. `platform_admin` `/api/employees`'ta `403` alır (§3) ve firma yolları yalnız adı
değiştirir; firmayı kurtaracak bir yol kalmaz. Ne yaptık: engellemedik, çünkü sözleşme böyle bir
kural ya da durum kodu tanımlamıyor ve engellemek sözleşme testleriyle çelişebilirdi. Öneri: platform
admin'in bir firmaya admin atayabileceği bir endpoint ya da tanımlı bir durum koduyla son admin
kuralı.

**N3: Silinen firmanın bağlı display'leri.** §2 silinen firmanın display token'larını geçersiz sayar
ve yeni bağlantıya `connect_error` tanımlar, ama o anda bağlı olan socket'lere ne olacağını
söylemez. Ne yaptık: firma silme commit edildikten sonra firmanın odasındaki bütün socket'leri
koparıyoruz; yeniden bağlanma handshake'te reddedilir.

**N4: Display güncel modu öğrenemez.** Display token HTTP'de `401` alır (§2) ve bağlanınca bir
senkron tanımlı değil (§6 bunu serbest bırakıyor). §4'e göre yeniden bağlanan display'in senkronu
koşulsuz yayına dayanır; yani display, bir sonraki `POST /api/mode`'a kadar güncel modu bilemez. Ne
yaptık: bağlanınca kendiliğinden olay göndermiyoruz; sözleşme testlerindeki olay sayısı beklentilerini
bozabilirdi. Öneri: tanımlı bir socket isteği, örneğin ack ile yanıtlanan bir `mode:get`.

**N5: Çalışanı id ile okuma yok.** A firmasının token'ıyla B firmasının çalışanının
"okunamaz" olduğunun test edilmesi gerekir ve §3'teki `403` kuralı `/api/employees/:id` yolunu
"tüm metotlarıyla" anıyor; ama tabloda `GET /api/employees/:id` yok. Ne yaptık: uzantı olarak
ekledik. Firmadaki herkes kullanabilir; başka firmanın ya da silinmiş bir çalışan `404` alır.

**N6: Mevcut kullanıcıyı veren bir endpoint yok.** Rol oturum ortasında değişebiliyor (§2), ama
güncel rolü öğrenmenin yolu yok; login yanıtındaki rol eskiyebilir. Ne yaptık: `GET /api/auth/me`
uzantısı. Kullanıcıyı token'dan değil veritabanından okur ve login'deki `user` ile aynı şekli
döner; arayüz rol yönlendirmesini buna dayandırır.

**N7: Tanımsız davranışlar.** Sözleşme şunları tanımlamıyor; seçimlerimiz aşağıdaki tabloda:

- e-posta biçim doğrulaması ve dönen e-postanın harf büyüklüğü
- şifre politikası
- kullanıcı token'ının ömrü
- şifre değiştirme (endpoint yok)
- `member`'ın arayüzde ne göreceği
- desteklenmeyen HTTP metotları (`405` kod listesinde yok)

**N8: Display token'ında bir kimlik yok.** Sözleşmedeki display claim'leri token'ı ayırt edecek bir
kimlik içermiyor; §6'da kapsam dışı bırakılan revoke ileride eklenirse buna ihtiyaç olacak. Ne
yaptık: kayıtlı (registered) `jti` claim'ini ekledik; değeri, token'ın `display_tokens` satırının
id'sidir. Sözleşmedeki claim'ler değişmedi; revoke uygulanmadı.

### Sözleşmenin sustuğu yerlerde seçimlerimiz

| Konu                       | Seçim                                                                                                                                                                                                                                                                                                                    | Gerekçe                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Parse edilemeyen JSON      | `400 VALIDATION_ERROR`. JSON olarak geçerli ama nesne olmayan gövdeler (`"x"`, `null`, `42`) normal kontrol sırasından geçer.                                                                                                                                                                                            | §3 `400` ya da `401`'e izin verir.                                                                                     |
| Bilinmeyen yol ya da metot | `404 NOT_FOUND` zarfı, `405` yok. `/api` altında önce kimlik doğrulama çalışır: token yoksa `401`.                                                                                                                                                                                                                       | `405` kod listesinde yok; §3 "tüm metotlarıyla".                                                                       |
| E-posta                    | Kırpılır; `local@domain` biçiminde ve boşluksuz olmalı, yoksa `400`. Büyük/küçük harfe duyarsız karşılaştırılır, gönderildiği harf büyüklüğüyle saklanır ve döner. Kendi e-postasını farklı harflerle göndermek çakışma değildir. Girişte biçim kontrolü yok: biçimsiz bir e-posta kimseyle eşleşmez, normal `401` alır. | §3 duyarsız karşılaştırma; gönderilen biçimi döndürmek eşitlik kontrolleri için en güvenlisi.                          |
| Şifre                      | Boş olmayan bir string; politika yok; kırpılmadan hash'lenir.                                                                                                                                                                                                                                                            | Sözleşme yalnız boş olmamayı tanımlar.                                                                                 |
| Zorunlu string'ler         | String ve kırpıldıktan sonra boş olmayan bir değer, yoksa `400`. Bilinmeyen alanlar yok sayılır; güncellenebilir alan içermeyen bir `PATCH` `400` alır.                                                                                                                                                                  | §3 notları.                                                                                                            |
| Firma adı                  | Kırpılır, benzersiz değil.                                                                                                                                                                                                                                                                                               | `409` yalnız e-posta için tanımlı.                                                                                     |
| `modeId`                   | Boş olmayan herhangi bir string; kırpılmadan saklanır ve döner.                                                                                                                                                                                                                                                          | §3: opak string.                                                                                                       |
| Display `label`            | Opsiyonel; gönderilirse string olmalı, yoksa `400`. Token'a değil veritabanına yazılır.                                                                                                                                                                                                                                  | Sözleşme label'ın amacını tanımlamıyor; token'ı büyütmeden kaydıyla birlikte saklanır. Henüz onu döndüren bir yol yok. |
| Kullanıcı token'ının ömrü  | `USER_TOKEN_TTL`, varsayılan 12 saat; refresh token yok.                                                                                                                                                                                                                                                                 | §6 oturum politikalarını serbest bırakır.                                                                              |
| Platform admin'de `firmId` | Login yanıtında ve token'da hiç yok, `null` değil.                                                                                                                                                                                                                                                                       | §2 "platform_admin'de firmId yoktur"; §3 ikisini de kabul eder.                                                        |
| Son `firm_admin`           | Koruma yok.                                                                                                                                                                                                                                                                                                              | N2.                                                                                                                    |
| Bağlanınca mod             | Gönderilmez.                                                                                                                                                                                                                                                                                                             | N4; §6 serbest bırakır.                                                                                                |
| Yanıt alanları             | Yalnız sözleşmedeki alanlar.                                                                                                                                                                                                                                                                                             | Ek alan bir şey katmıyor.                                                                                              |
| Giriş hatası               | Bilinmeyen e-posta, yanlış şifre, silinmiş kullanıcı ve silinmiş firma için aynı `401` mesajı.                                                                                                                                                                                                                           | Hesap tahminini önler.                                                                                                 |
| `error.message`            | Türkçe, kısa, kullanıcıya yönelik; `code` sözleşmedeki gibi. Eksik ve başka firmanın kaynağı aynı mesajı alır.                                                                                                                                                                                                           | Sözleşme örneği Türkçe; testler `code`'a bakar; i18n kapsam dışı.                                                      |
| Beklenmeyen hata           | `500 INTERNAL_ERROR`, aynı zarf ve genel bir Türkçe mesaj; ayrıntı yalnız logda.                                                                                                                                                                                                                                         | Sözleşmede sunucu hatası kodu yok; zarfın şekli her yerde aynı kalır.                                                  |
| Şifre değiştirme           | Endpoint yok.                                                                                                                                                                                                                                                                                                            | Sözleşmede yok (N7).                                                                                |
| `member` arayüzü           | Çalışanları ve modu salt okunur görür.                                                                                                                                                                                                                                                                                   | N7.                                                                                                                    |

### Sözleşmeye eklenenler

Üç endpoint Swagger'da "(uzantı)" olarak işaretli; diğer ikisi Swagger açıklamalarında yazılı:

- `GET /api/employees/:id` (N5)
- `GET /api/auth/me` (N6)
- `GET /health`: kimlik doğrulaması gerektirmeyen canlılık kontrolü
- `500 INTERNAL_ERROR`: beklenmeyen sunucu hataları için
- Display token'ında `jti` claim'i (N8)
