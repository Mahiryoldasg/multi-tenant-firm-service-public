# Multi-Tenant Firma & Çalışan Yönetim Servisi

[![Verify](https://github.com/Mahiryoldasg/multi-tenant-firm-service-public/actions/workflows/verify.yml/badge.svg)](https://github.com/Mahiryoldasg/multi-tenant-firm-service-public/actions/workflows/verify.yml)

Birden çok firmanın (tenant) tek bir serviste, birbirinden tamamen yalıtılmış olarak yönetildiği
firma ve çalışan yönetim servisi. Platform admin firmaları yönetir; firma admin'i kendi firmasının
çalışanlarını ve aktif modunu yönetir; display istemcileri Socket.IO üzerinden yalnız kendi
firmalarının `mode-change` olaylarını alır. Dışarıya açılan her şey (yollar, istek ve yanıt
şekilleri, token'lar, socket olayı, hata kodları) baştan sabit bir API sözleşmesine uyar.

Bu bir kişisel projedir: çok kiracılı bir serviste tenant izolasyonunu ve tenant'a özel gerçek
zamanlı kanalı uçtan uca (API, veritabanı, arayüz, testler) kurmak için geliştirdim.

Belgelerin ve kodun nerede olduğu ve önerilen okuma sırası için: [docs/README.md](docs/README.md).
Tasarım kararları, tenant izolasyonunun nerede uygulandığı ve sözleşme notları için:
[DESIGN.md](DESIGN.md). Katmanlar, izolasyonun uygulandığı noktalar ve gerçek zamanlı kanal için:
[mimari diyagram](docs/architecture.png) ([draw.io kaynağı](docs/architecture.drawio)).

## Gereksinimler

- Node.js 22 veya 24 LTS (en az 20.19); `node -v` ile kontrol edebilirsiniz
- npm (Node.js ile gelir)
- Git
- Örnek istekler için bash ve curl: macOS ve Linux'ta hazırdır, Windows'ta Git for Windows ile gelen
  Git Bash yeterlidir

Ayrı bir veritabanı sunucusu gerekmez: veriler bir SQLite dosyasında tutulur.

## Kurulum ve çalıştırma

```bash
git clone https://github.com/Mahiryoldasg/multi-tenant-firm-service.git
cd multi-tenant-firm-service
npm install
npm start
```

`npm start` sırasıyla şunları yapar:

1. Node.js sürümünü kontrol eder; desteklenmeyen bir sürümde açıklayıcı bir mesajla durur.
2. `.env` yoksa `.env.example` dosyasından oluşturur ve `JWT_SECRET` için rastgele bir değer
   üretir. Bu yalnız ilk çalıştırmada olur; sonraki çalıştırmalarda `.env` ve sır olduğu gibi kalır.
3. Sunucuyu ve kontrol arayüzünü `dist/` klasörüne derler.
4. Servisi `http://localhost:4000` adresinde başlatır.

İlk açılışta `data/app.db` oluşturulur ve seed verisi yüklenir. Loglar JSON satırlarıdır;
`"msg":"Server ready on http://localhost:4000"` satırı servisin hazır olduğunu gösterir. Durdurmak
için `Ctrl+C`.

`.env` dosyası Git tarafından yok sayılır ve üretilen sırrı içerir; commit'lemeyin. Portu
değiştirmek için `.env` içindeki `PORT` değerini düzenleyin.

### Adresler

| Adres                                | İçerik                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| `http://localhost:4000/`             | Kontrol arayüzü (seed hesaplarıyla giriş)                       |
| `http://localhost:4000/display`      | Display simülatörü (giriş gerekmez, display token ile bağlanır) |
| `http://localhost:4000/docs`         | Swagger UI ("Authorize" ile Bearer token girilir)               |
| `http://localhost:4000/openapi.json` | OpenAPI 3.1 belgesi                                             |
| `http://localhost:4000/health`       | Sağlık kontrolü: `{"status":"ok"}`                              |
| `http://localhost:4000/socket.io`    | Socket.IO (display'lerin kanalı ve arayüzün `/control` kanalı)  |

## Seed hesapları

Seed, ilk açılışta boş veritabanına bir kez yüklenir: 1 platform admin, 2 firma ve her firmada
1 firma admin'i (üye yok). Seed tekrarlanmaz; aynı veritabanıyla yeniden başlatınca firma ve
kullanıcı sayısı değişmez.

| Rol              | Firma           | E-posta                | Şifre                |
| ---------------- | --------------- | ---------------------- | -------------------- |
| `platform_admin` | -               | `admin@platform.local` | `PlatformAdmin!2026` |
| `firm_admin`     | Acme Fuarcılık  | `admin@acme.local`     | `AcmeAdmin!2026`     |
| `firm_admin`     | Globex Etkinlik | `admin@globex.local`   | `GlobexAdmin!2026`   |

Bu değerler `.env` içindeki `SEED_*` değişkenlerinden gelir. Değiştirirseniz yeni değerler ancak
`npm run db:reset` ve ardından `npm start` ile uygulanır; `db:reset` veritabanını tüm verisiyle
siler.

## Ortam değişkenleri

`npm start` bunları `.env` dosyasından okur; varsayılan değerler `.env.example` içindedir.

| Değişken                                                                 | Varsayılan                     | Açıklama                                                                  |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| `PORT`                                                                   | `4000`                         | HTTP ve Socket.IO portu                                                   |
| `JWT_SECRET`                                                             | yok, ilk çalıştırmada üretilir | Token imzalama sırrı (HS256); boşsa servis açılmaz                        |
| `DB_PATH`                                                                | `./data/app.db`                | SQLite dosyası; klasörü yoksa oluşturulur                                 |
| `USER_TOKEN_TTL`                                                         | `12h`                          | Kullanıcı token ömrü: bir tam sayı ve `s`, `m`, `h` ya da `d` (ör. `30m`) |
| `LOG_LEVEL`                                                              | `info`                         | pino log seviyesi (ör. `debug`, `info`, `warn`)                           |
| `SEED_PLATFORM_ADMIN_EMAIL`, `SEED_PLATFORM_ADMIN_PASSWORD`              | `.env.example`                 | Platform admin hesabı                                                     |
| `SEED_FIRM1_NAME`, `SEED_FIRM1_ADMIN_EMAIL`, `SEED_FIRM1_ADMIN_PASSWORD` | `.env.example`                 | 1. firma ve admin'i                                                       |
| `SEED_FIRM2_NAME`, `SEED_FIRM2_ADMIN_EMAIL`, `SEED_FIRM2_ADMIN_PASSWORD` | `.env.example`                 | 2. firma ve admin'i                                                       |

`SEED_*` değişkenlerinin kodda varsayılanı yoktur ve her açılışta okunur: biri eksik ya da boşsa
servis, eksik değişkenin adını yazarak açılmaz.

## Örnek istekler (curl)

Komutlar bash sözdizimindedir (macOS, Linux; Windows'ta Git Bash). Servis çalışırken aynı
terminale sırayla yapıştırın: token'lar ve id'ler değişkenlere alınır ve sonraki komutlarda
kullanılır. Dizi oluşturduğu her şeyi sonunda siler, bu yüzden tekrar çalıştırılabilir. Her
komutun üstünde beklenen durum kodu ve yanıt yazılıdır.

> **Windows:** Windows PowerShell 5.1'de `curl`, `Invoke-WebRequest` komutunun takma adıdır ve
> tırnaklar farklı çalışır; bu komutları Git Bash'te çalıştırın. Kabuk kullanmadan denemek için
> Swagger UI (`/docs`) yeterlidir.

### Hazırlık

```bash
# JSON yanıttan bir alanı okur (jq gerekmez, Node yeterli)
field() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }

# 200 {"status":"ok"}
curl -s http://localhost:4000/health
```

### Platform admin

```bash
# 200 {"token":"...","user":{"id":"...","email":"admin@platform.local","role":"platform_admin"}}
PLATFORM_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@platform.local","password":"PlatformAdmin!2026"}' | field token)

# 200 {"firms":[{"id":"...","name":"Acme Fuarcılık","createdAt":"..."},{...}]}
curl -s http://localhost:4000/api/firms -H "Authorization: Bearer $PLATFORM_TOKEN"

# İlk admin'iyle birlikte firma oluşturur
# 201 {"firm":{"id":"...","name":"Initech Organizasyon"},"admin":{"id":"...","email":"admin@initech.local"}}
FIRM_ID=$(curl -s -X POST http://localhost:4000/api/firms \
  -H "Authorization: Bearer $PLATFORM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Initech Organizasyon","adminEmail":"admin@initech.local","adminPassword":"InitechAdmin!2026"}' \
  | field firm.id)

# 200 {"firm":{"id":"...","name":"Initech Etkinlik"}}
curl -s -X PATCH http://localhost:4000/api/firms/$FIRM_ID \
  -H "Authorization: Bearer $PLATFORM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Initech Etkinlik"}'
```

### Firma admin'i: çalışanlar, mod ve display token

```bash
# 200 {"token":"...","user":{"id":"...","email":"admin@acme.local","role":"firm_admin","firmId":"..."}}
ACME_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.local","password":"AcmeAdmin!2026"}' | field token)

# Yalnız kendi firmasının çalışanları
# 200 {"employees":[{"id":"...","email":"admin@acme.local","role":"firm_admin"}]}
curl -s http://localhost:4000/api/employees -H "Authorization: Bearer $ACME_TOKEN"

# 201 {"employee":{"id":"...","email":"ayse@acme.local","role":"member"}}
EMPLOYEE_ID=$(curl -s -X POST http://localhost:4000/api/employees \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"ayse@acme.local","password":"Ayse!2026","role":"member"}' | field employee.id)

# 200 {"employee":{"id":"...","email":"ayse@acme.local","role":"firm_admin"}}
curl -s -X PATCH http://localhost:4000/api/employees/$EMPLOYEE_ID \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"role":"firm_admin"}'

# 200 {"modeId":null}; hiç mod seçilmediyse null, sonra son seçilen mod
curl -s http://localhost:4000/api/mode -H "Authorization: Bearer $ACME_TOKEN"

# 200 {"modeId":"fuar-acilis"}; Acme'nin bağlı display'lerine mode-change gider
curl -s -X POST http://localhost:4000/api/mode \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"modeId":"fuar-acilis"}'

# 201 {"token":"..."}; bu token /display sayfasında kullanılır
curl -s -X POST http://localhost:4000/api/display-tokens \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"Salon A"}'
```

### İzolasyon ve hata örnekleri

Bu komutlar yanıtın altına HTTP durum kodunu da yazar.

```bash
GLOBEX_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@globex.local","password":"GlobexAdmin!2026"}' | field token)

# Başka firmanın çalışanı yok sayılır: 404 NOT_FOUND (403 değil, varlık sızdırmaz)
curl -s -w '\n%{http_code}\n' -X PATCH http://localhost:4000/api/employees/$EMPLOYEE_ID \
  -H "Authorization: Bearer $GLOBEX_TOKEN" -H 'Content-Type: application/json' \
  -d '{"role":"member"}'

# Token yok: 401 UNAUTHORIZED
curl -s -w '\n%{http_code}\n' http://localhost:4000/api/employees

# Platform admin'in firması yoktur, firma bağlamındaki yollarda: 403 FORBIDDEN
curl -s -w '\n%{http_code}\n' http://localhost:4000/api/mode \
  -H "Authorization: Bearer $PLATFORM_TOKEN"

# Boş modeId: 400 VALIDATION_ERROR
curl -s -w '\n%{http_code}\n' -X POST http://localhost:4000/api/mode \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"modeId":"  "}'

# E-posta tüm sistemde ve büyük/küçük harfe duyarsız benzersizdir: 409 CONFLICT
curl -s -w '\n%{http_code}\n' -X POST http://localhost:4000/api/employees \
  -H "Authorization: Bearer $ACME_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"ADMIN@globex.local","password":"Test!2026","role":"member"}'
```

### Temizlik

```bash
# 204
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:4000/api/employees/$EMPLOYEE_ID \
  -H "Authorization: Bearer $ACME_TOKEN"

# Firmayı ve kullanıcılarını siler, e-postaları yeniden kullanılabilir olur: 204
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:4000/api/firms/$FIRM_ID \
  -H "Authorization: Bearer $PLATFORM_TOKEN"
```

## Gerçek zamanlı kanal (Socket.IO)

Display istemcisi handshake'te bir display token gönderir ve yalnız kendi firmasının olaylarını
alır:

```js
const socket = io('http://localhost:4000', { auth: { token: '<display token>' } });
socket.on('mode-change', ({ modeId }) => console.log(modeId));
// Sözleşme dışı: güncel modu sorar; yanıt { modeId }, hiç seçilmediyse { modeId: null }
socket.emit('mode:get', (answer) => console.log(answer));
```

Kullanıcı token'ı, geçersiz bir token ya da silinmiş bir firmanın token'ı `connect_error` ile
reddedilir. Sunucu bağlanınca kendiliğinden bir şey göndermez; sözleşme dışı `mode:get` isteği
yalnız soran display'e kendi firmasının güncel modunu döner ve hiçbir event tetiklemez.
`/display` simülatörü bunu her bağlanışta, otomatik yeniden bağlanmalar dahil, sorar. İzolasyonu
tarayıcıda görmek için:

1. Acme ve Globex için birer display token üretin: arayüzde firma admin'i olarak "Ekran
   token'ları" bölümünden ya da yukarıdaki `display-tokens` isteğini `$ACME_TOKEN` ve
   `$GLOBEX_TOKEN` ile göndererek.
2. İki ayrı pencerede `http://localhost:4000/display` adresini açın, her birine bir firmanın
   token'ını yapıştırıp bağlanın: her pencere, `mode:get` ile kendi firmasının güncel modunu
   gösterir.
3. Acme için bir mod seçin (arayüzde "Aktif mod" bölümünden ya da `POST /api/mode` ile):
   `mode-change` yalnız Acme'nin penceresinde görünür.

Kontrol arayüzü de, açık firma ekranlarında modu canlı göstermek için sözleşme dışı `/control`
namespace'ine kullanıcı token'ıyla bağlanır. Bu kanal veri taşımaz: her başarılı `POST /api/mode`'da
yalnız o firmanın ekranlarına `mode:changed` sinyali gider ve arayüz modu `GET /api/mode` ile yeniden
okur. "Aktif mod" bölümündeki alt satır kanalın durumunu gösterir. Görmek için:

1. İki ayrı sekmede `http://localhost:4000/` adresini açın; birinde Acme'nin firma admin'i, diğerinde
   Acme'nin bir üyesi olarak giriş yapın (üyeyi admin ekranındaki "Yeni çalışan" formuyla
   ekleyebilirsiniz).
2. Admin sekmesinde modu değiştirin: üyenin sekmesindeki "Aktif mod" sayfa yenilenmeden güncellenir.
   Globex admin'iyle açılan bir sekme değişmez.

## Testler

```bash
npm test
```

Testler Vitest ile çalışır; her test dosyası kendi bellek içi SQLite veritabanını kurar, çalışan bir
servis gerekmez. İzolasyon testleri `tests/isolation/` klasöründedir:

- `cross-tenant.test.ts`: bir firmanın token'ıyla diğer firmanın kaynaklarına her tenant
  endpoint'inde erişim denemesi
- `invalidation.test.ts`: silinen çalışan ve firma, rol değişimi, display token'ın ömrü
- `socket-leak.test.ts`: iki firma, firma başına üç display, olayların başka firmaya sızmaması ve
  `mode:get`'in her display'e yalnız kendi firmasının modunu döndürmesi

`mode:get`'in davranış testleri (yanıt biçimi, callback'siz istek, hata yanıtı)
`tests/realtime/mode-get.test.ts` dosyasındadır.

Diğer kontroller: `npm run lint`, `npm run typecheck`, `npm run format:check`.

## Geliştirme

- `npm run dev`: API `http://localhost:4000` adresinde değişikliklerde yeniden başlar, kontrol
  arayüzü `http://localhost:5173` adresinde Vite ile çalışır ve API isteklerini 4000'e iletir
- `npm run build`: sunucuyu ve arayüzü `dist/` klasörüne derler
- `npm run db:reset`: SQLite dosyasını siler; sonraki açılış veritabanını yeniden oluşturur ve seed
  eder

## Sorun giderme

- **`Node.js ... is not supported`:** Node.js 22 veya 24 LTS kurun.
- **`EADDRINUSE: address already in use`:** port başka bir süreç tarafından kullanılıyor (ör. açık
  kalmış başka bir `npm start`). O süreci kapatın ya da `.env` içindeki `PORT` değerini değiştirin.
- **Seed hesaplarıyla giriş yapılamıyor:** veritabanı daha önce başka `SEED_*` değerleriyle
  oluşturulmuş olabilir; `npm run db:reset` ve ardından `npm start` (tüm veri silinir).
