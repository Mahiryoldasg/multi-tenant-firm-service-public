# Belgeler

Bu sayfa depodaki belgelerin ve kodun nerede olduğunu ve hangi sırayla okunabileceğini gösterir.
Kurulum ve çalıştırma için [ana README](../README.md) dosyasına bakın.

## Okuma sırası

1. [README](../README.md): servisi çalıştırın, seed hesaplarıyla giriş yapın, curl örneklerini
   deneyin.
2. API sözleşmesi:
   ne istendiği ve dış yüzeyin değişmez kuralları.
3. [Mimari diyagram](architecture.png) ([draw.io kaynağı](architecture.drawio)): katmanlar,
   tenant izolasyonunun uygulandığı noktalar (DESIGN.md'deki numaralarla), gerçek zamanlı kanal
   ve kontrol arayüzünün API'yi nasıl kullandığı, tek resimde.
4. [DESIGN.md](../DESIGN.md): veri modeli, tenant izolasyonunun nerede uygulandığı, kimlik
   doğrulama, trade-off'lar, sözleşme notları, database-per-tenant cevabı ve önceliklendirme.
5. [Karar günlüğü](decisions.md) (İngilizce): her özellik kapanırken yazılan kısa "neden" notları.
6. [Build plan](../blueprint/build-plan.md) ve
   [tamamlanan özelliklerin spec'leri](../blueprint/history/features/) (İngilizce): işin hangi
   sırayla, hangi adımlarla ve hangi testlerle yapıldığı. Commit geçmişi aynı sırayı izler; her
   özellik `main` dalına bir merge commit'iyle girer (`git log --first-parent main`).
7. Kod, bir isteğin yolunu izleyerek:
   - [src/server/app.ts](../src/server/app.ts): HTTP pipeline'ı; kimlik doğrulama, yetki ve tenant
     kapılarının sırası
   - [src/server/http/authenticate.ts](../src/server/http/authenticate.ts): token doğrulama ve her
     istekte kullanıcının ve firmasının veritabanından yeniden kontrolü
   - [src/server/http/tenant.ts](../src/server/http/tenant.ts) ve
     [src/server/tenancy/](../src/server/tenancy/): firmaya bağlı repository'ler (`req.tenant`),
     yani tenant izolasyonunun uygulandığı yer
   - [src/server/realtime/](../src/server/realtime/): display handshake'i, firma odaları ve
     `mode-change` yayını
8. [tests/isolation/](../tests/isolation/): izolasyonun kanıtı (firmalar arası erişim matrisi,
   token'ların geçersizleşmesi, socket sızıntısı).

## Nerede ne var

### Belgeler

| Yol                                                                                        | İçerik                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [README.md](../README.md)                                                                  | Kurulum, tek komutla çalıştırma, seed hesapları, curl örnekleri, test komutu                                                                     |
| [DESIGN.md](../DESIGN.md)                                                                  | Tasarım: veri modeli, izolasyon, kimlik doğrulama, trade-off'lar, sözleşme notları, database-per-tenant, önceliklendirme, AI kullanımı           |
| [docs/architecture.png](architecture.png), [docs/architecture.drawio](architecture.drawio) | Mimari diyagram ve draw.io kaynağı: katmanlar, izolasyon noktaları (DESIGN.md'deki numaralarla), gerçek zamanlı kanal, arayüzün API'yi kullanışı |
| [docs/decisions.md](decisions.md)                                                          | Karar günlüğü: özellik bazında tarihli "neden" notları (İngilizce)                                                                               |

### Planlar ve spec'ler

Proje AI Blueprint iş akışıyla geliştirildi: her özellik önce bir spec'e dönüştü, küçük ve
incelenmiş adımlarla uygulandı, sonra arşivlendi. Bu dosyalar İngilizcedir.

| Yol                                                                               | İçerik                                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [blueprint/project-plan.md](../blueprint/project-plan.md)                         | Proje planı: problem, kullanıcılar, veri modeli, teknoloji, sözleşme yorumları, program   |
| [blueprint/build-plan.md](../blueprint/build-plan.md)                             | Özellik listesi, öncelikler (P0, P1, P2) ve tahmini süreler                               |
| [blueprint/context/project-overview.md](../blueprint/context/project-overview.md) | İki planın özeti; spec'ler buradan yazıldı                                                |
| [blueprint/context/coding-standards.md](../blueprint/context/coding-standards.md) | Kod, test ve yazım standartları                                                           |
| [blueprint/history/features/](../blueprint/history/features/)                     | Tamamlanan her özelliğin spec'i: kapsam, adımlar, testler, kanıtlar ve inceleme bulguları |
| [blueprint/history/fixes/](../blueprint/history/fixes/)                           | Özellikler dışındaki düzeltmelerin kayıtları                                              |
| [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md)                              | AI kodlama araçlarının çalışma talimatları                                                |

### Kod

| Yol                                                             | İçerik                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [src/server/](../src/server/)                                   | Sunucu: `config.ts` (ortam değişkenleri), `logger.ts` (JSON loglar), `app.ts` (Express uygulaması), `index.ts` (açılış)                                |
| [src/server/db/](../src/server/db/)                             | SQLite bağlantısı, migration'lar ve seed                                                                                                               |
| [src/server/auth/](../src/server/auth/)                         | Giriş, JWT üretimi ve doğrulaması, şifre hash'leme                                                                                                     |
| [src/server/http/](../src/server/http/)                         | Hata zarfı, kimlik doğrulama, yetki ve tenant middleware'leri, gövde doğrulama                                                                         |
| [src/server/modules/platform/](../src/server/modules/platform/) | Firma yönetimi ve girişte kullanıcı araması (platform düzeyi)                                                                                          |
| [src/server/modules/tenant/](../src/server/modules/tenant/)     | Çalışan, mod ve display token route'ları; veriye yalnız `req.tenant` ile erişir                                                                        |
| [src/server/tenancy/](../src/server/tenancy/)                   | Firmaya bağlı repository'ler: her sorgu, kurulurken verilen firmayla sınırlıdır                                                                        |
| [src/server/realtime/](../src/server/realtime/)                 | Socket.IO sunucusu, display handshake'i, `mode-change` yayını                                                                                          |
| [src/server/openapi/](../src/server/openapi/)                   | OpenAPI belgesi ve Swagger UI                                                                                                                          |
| [web/src/](../web/src/)                                         | Kontrol arayüzü (React): `auth/` giriş ve rol yönlendirmesi, `firms/` platform admin ekranları, `workspace/` firma çalışma alanı, `display/` simülatör |
| [tests/](../tests/)                                             | Vitest testleri; klasörler sunucu katmanlarını izler, `isolation/` izolasyon testlerini, `web/` arayüzün DOM'suz modüllerini içerir                    |
| [scripts/](../scripts/)                                         | npm komutlarının çağırdığı, platformdan bağımsız Node betikleri: Node kontrolü, `.env` hazırlığı, `dist/` temizliği, veritabanı sıfırlama              |
