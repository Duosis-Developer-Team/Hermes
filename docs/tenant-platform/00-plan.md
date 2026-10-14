# Tenant modülleri, Süper-admin konsolu ve Profesyonel talep yönetimi — plan

Tarih: 2026-10-14 · Durum: CTO onaylı (kararlar §1) · Ortam: önce yalnız **dev**;
test'e ff CTO "ff yapalım" deyince.

## 1. CTO kararları (14.10)

| # | Konu | Karar |
|---|---|---|
| K1 | Modül kataloğu | 6 seçilebilir modül: **Zaman girişi, İş yönetimi, Toplantılar/Takvim, Talepler, Raporlar & Panel, Geliştirici platformu**. Ana sayfa, Ayarlar, Kullanıcılar/Roller/Gruplar **her zaman açık** (çekirdek). |
| K2 | Atama | Tenant başına **doğrudan modül seçimi** + yalnız arayüzde **hazır şablon** kısayolu (Tam paket, Yalnız talep…). Paket/faturalama sistemi YOK. |
| K3 | Talep ağı | Kim kime talep açabilir, **süper-admin'de dinamik** tanımlanır (örn. "Defacto → InterTech"). Süper-admin yalnız Duosis'te. Sağlayıcı tenant kendi hub'ında yanıtlar, talep eden tenant portaldan açar. |
| K4 | Talep özellikleri | Kapsam Claude'a bırakıldı: profesyonel helpdesk seviyesi (Zendesk / Freshdesk / Jira SM referansı), Hermes diliyle. |

Değişmez kurallar aynen geçerli: test verisi kutsal (yalnız additive migration),
force-push yok, LogiSlot sözleşmesi (`docs/contracts/support-ticketing-v1`) tek
taraflı değişmez.

## 2. Faz 1 — Tenant modülleri

### 2.1 Katalog (tek kaynak `backend/shared/modules.py`)

| Kod | Ad | Bağımlılık | İzinler (modül kapalıysa efektif izinden düşer) |
|---|---|---|---|
| `time_entry` | Zaman girişi (efor, kapasite, referans verileri) | — | `worklogs.admin`, `reference.manage` |
| `work` | İş yönetimi (işler, görünümler, PM ayarları, iş bildirimleri) | — | `tasks.*`, `issues.*`, `tasks.permissions.manage` |
| `meetings` | Toplantılar / takvim (Outlook senkronu) | — | `meetings.admin` |
| `tickets` | Talepler (hub / portal / entegrasyonlar) | — | `tickets.*` |
| `reports` | Raporlar & Panel (panel, raporlar, faturalanabilir, sözleşme) | `time_entry` | `reports.view` |
| `developer` | Geliştirici platformu (portal, API yönetimi, Public API, MCP) | — | `api.manage` |

Çekirdek izinler (`users/roles/groups/customers/projects.manage`) modülsüzdür.
Müşteri/proje **ayar sayfaları** yalnız `time_entry` ya da `work` açıkken görünür
(veri ve uçlar çekirdek kalır: talep → iş dönüşümü de kullanır).

### 2.2 Saklama ve yayılım
- **auth** `tenants.enabled_modules` (JSONB, additive migration 0006). Mevcut
  tenant'lar migration'da **tüm katalogla** doldurulur → bugünkü davranış değişmez.
- **core** `tenant_registry.enabled_modules` (additive migration 0017); mevcut
  `/internal/tenants/projection` S2S akışı taşır (auth her değişiklikte yansıtır).
- Bağımlılık kuralı tek yerde (`shared/modules.normalize`): `reports` seçilip
  `time_entry` seçilmezse 422.

### 2.3 Uygulama (RBAC gibi iki katman, fail-closed)
1. **İzin kesişimi**: auth `effective_permissions` = rol izinleri ∩ katalog ∩
   **açık modüllerin izinleri**. Kapalı modülün izni rol üzerinden sızamaz;
   core/reporting zaten auth'tan çözdüğü için otomatik uygulanır.
2. **Sunucu kapısı**: izinsiz-açık uçlar için (zaman girişi, toplantılar, ana
   sayfa blokları, geliştirici portalı, Public API) core'da router düzeyinde
   `require_module(...)` → kapalıysa **404** (var olmayan uç gibi).
3. **Arayüz**: `/auth/users/me` ve giriş yanıtları `tenant.modules` taşır;
   menü, rotalar, dock eylemleri, ana sayfa blokları, ayar bölümleri, kabuk
   açılış çağrıları (toplantı senkronu, iş izinleri, talep bağlamı, bildirim)
   modüle bağlanır. Sabit `/time-entry` açılışı → **açık ilk modül**.

## 3. Faz 2 — Süper-admin konsolu (Hermes Liquid)
- Tenant **listesi** (arama, durum filtresi, modül rozetleri) + **detay sayfası**:
  Genel bakış · **Modüller** (görsel kartlar, çoklu seçim, şablonlar,
  bağımlılık uyarısı) · Üyeler/yöneticiler · Alan adları & SSO · Talep ağı ·
  Denetim (tenant'a filtreli).
- **Oluşturma sihirbazı**: Bilgiler → Modüller → Yönetici & alan adı → Özet.
- Bilinen hatalar: yönlendirme aç/kapa `record_audit` TypeError; sayfa
  yenilenince süper-admin oturumu düşüyor (`/me` ile geri yükleme); plan kodu
  doğrulanmıyor; PATCH sürüm kilidi.

## 4. Faz 3 — Profesyonel talep yönetimi

### 4.0 Talep ağı (K3)
- Global (RLS'siz, platform yönetimli) **bağlantı** kaydı: *talep eden tenant →
  sağlayıcı tenant + varsayılan ekip*. Süper-admin "Talep ağı" ekranından kurar.
- Sağlayıcı = `tickets` modülü açık tenant; canonical talep **sağlayıcının**
  verisinde (RLS) durur. Bugünkü sabit `HERMES_SUPPORT_TENANT_ID` geçidi
  (`support_session`, `get_support_db`) "isteğin sağlayıcısı"na genelleşir.
- Bir tenant hem sağlayıcı hem talep eden olabilir: **Gelen talepler** (hub) +
  **Açtığım talepler** (portal) iki sekme.
- Duosis, LogiSlot entegrasyonunun sağlayıcısı olarak aynen kalır; mevcut
  Duosis yönlendirmeleri bağlantıya taşınır (veri kaybı yok, additive).

### 4.1 Dalga A — Hatalar + arka uçta olup arayüzde olmayanlar
Çözüm özeti min 20 karakter hatası; durum penceresinden yeniden açma; 50 talep
sınırı (sayfalama + sıralama); canlı yenileme; ajana atama, öncelik, işlem
geçmişi; müşteri iptali ve yanıta ek; gelişmiş filtreler.

### 4.2 Dalga B — Helpdesk çekirdeği
SLA politikaları (öncelik başına ilk yanıt/çözüm hedefi) + mesai takvimi,
"müşteride bekliyor"da durur; listede kalan süre/ihlal rozetleri · etiketler ·
hazır yanıtlar (makro: metin + durum/öncelik/etiket) · toplu işlem · kayıtlı
görünümler (kişisel/paylaşılan) · talep eden yan paneli (önceki talepleri) ·
takipçiler · uygulama içi bildirimler (ajan: yeni/atanan/yanıt; müşteri: yanıt/
çözüldü).

### 4.3 Dalga C — İçgörü
Rapor paneli (hacim, birikim, ilk yanıt/çözüm medyanı, SLA %, ekip/ajan) ·
CSAT (çözüm sonrası 1–5 + yorum).

### 4.4 Dalga D — Kanal ve verim (CTO kararı K5, 14.10)
K5: e-posta bildirimleri evet; e-postadan talep önerilen şekilde (tek Hermes posta
kutusu + sağlayıcı başına artı-adres `talep+<slug>@…`, yalnız tanınan alan adları),
posta kutusu ve Graph Mail.ReadWrite izni verilene kadar KAPALI; yardım merkezi
denenecek; birleştirme ve otomasyon evet.
- **D1 Birleştirme:** fazla talep `duplicate` koduyla çözülür (`duplicate_of_ticket_id`,
  sözleşmede mevcut), içeriği hedefe iç not olarak taşınır, takipçi/etiket birleşir;
  yalnız aynı uygulama + aynı müşteri; `ticket_merges` kaydı.
- **D2 Otomasyon:** olay kuralları (talep açıldı / müşteri yanıtladı) aynı
  transaction'da; zamanlı kurallar saatlik bakım işinde (yaş: açılış / son
  güncelleme / son public hareket). Koşullar AND, eylemler mevcut servis
  kurallarıyla; her zamanlı kural bir talepte bir kez (`ticket_automation_runs`);
  aktör "Otomasyon: <ad>".
- **D3 Bilgi bankası:** kategori + makale (taslak/yayında, ekip içi/müşteriye açık),
  ajan yanıtına ekleme, portalda yardım merkezi + yeni talepte makale önerisi,
  "yardımcı oldu mu" oyu.
- **D4 E-posta:** giden — talep edene (yalnız Hermes/e-posta kanalı talepleri;
  LogiSlot müşterisine YOK, kendi webhook'u var) ve ajana (atama, müşteri yanıtı,
  yeniden açılış);
  aynı transaction'da posta outbox'ı, dakikalık dispatcher gönderir (Graph).
  Gelen — kapalı başlar; yanıt yalnız talep sahibinin adresinden gelirse talebe
  eklenir; otomatik yanıtlar/döngüler yok sayılır.

### Sözleşme notu
Yeni yetenekler **yeni tablolarla** gelir; LogiSlot'a giden olay/alan seti ve
`ticket_events` olay türleri değişmez (iç olaylar da sözleşme anlık
görüntüsünde). Helpdesk katmanının etkinlik kaydı ayrı tabloda tutulur.

## 5. Teslim ve doğrulama
Her faz: backend + frontend testleri, dev'de canlı doğrulama, `07-durum` gibi
kısa durum notu. Test'e ff: §ff-provası (yedek + geçici namespace'te migration
provası + satır sayımı).

## 6. Durum

| Faz | Commit | Dev | Kanıt |
|---|---|---|---|
| 1 — Tenant modülleri | `610314c` | canlı (14.10) | auth 0006 / core 0017 head; acme + duosis 6 modülle (davranış değişmedi); auth 256, core 837, MCP 104, frontend 1156 test |
| 2 — Süper-admin konsolu | `591095c` | canlı (14.10) | auth 260, frontend 1163 test; görsel kontrol açık/koyu + 500 px |
| 3.0 — Talep ağı | `8a3883a` | canlı (14.10; acme → duosis geri dolduruldu) | core 854 (RLS kanıtı dahil), auth 262, frontend 1166 |
| 3.1 — Dalga A | `331810a` | canlı (14.10) | core 861, frontend 1171 |
| 3.2 — Dalga B | `df48a54` | canlı (14.10) | core 877, frontend 1178 |
| 3.3 — Dalga C | `c71bcbc` (+ perf `8513886`) | canlı (14.10) | core 881, frontend 1181 |
| 3.4 — Dalga D1 birleştirme | `27739e5` | canlı (14.10) | core 884, frontend 1182 |
| 3.5 — Dalga D2 otomasyon | `81506be` | canlı (14.10) | core 889, frontend 1183 |
| 3.6 — Dalga D3 bilgi bankası | `18f3ee3` | canlı (14.10) | core 893, frontend 1187 |
| 3.7 — Dalga D4 e-posta | (bu commit) | CD sonrası; giden için dispatcher CronJob'u MANUEL apply | core 908, frontend 1190 |

Faz 2 notları:
- Konsol adresli: `/platform-admin` (genel bakış), `/tenants`, `/tenants/:id`
  (Genel · Modüller · Üyeler · Erişim ve kimlik · Denetim), `/routing`, `/audit`.
- Talep ağı sekmesi Faz 3.0'a kaldı (bağlantı kaydı o fazın tablosu).
- Düzeltilen hatalar: yönlendirme aç/kapa `record_audit` TypeError; yenilemede
  oturum düşmesi (`/me` ile geri yükleme); bilinmeyen plan kodu 400;
  PATCH `expected_version` → 409; konsolda kiracı bildirim zili (kiracı API'si
  platform düzleminde çağrılıyordu) kaldırıldı.
- Yeni uç: `GET /api/platform/v1/tenants/{id}/members` (yalnız metadata; yönetici
  bilgisi aktif `system-admin` rolünden).

Faz 3.0 notları (talep ağı):
- `ticket_network_links` (0018, GLOBAL): talep eden → sağlayıcı; varsayılan ekip
  sağlayıcının route'unda. Mevcut Hermes yönlendirmeleri geri dolduruldu.
- Hub = kendi tenant'ı sağlayıcıysa; portal = bağlantısı varsa; ikisi birden
  olabilir (üstte "Gelen talepler / Açtığım talepler" anahtarı).
- Birden fazla sağlayıcıda istemci `provider` seçer (sunucu doğrular).
- Konsol: Talep ağı sayfası (sağlayıcı kartları, ekip seçimi, aç/kapa, yeni
  bağlantı) + kiracı detayında özet. Eski `/support/routing` uçları kaldırıldı.
- LogiSlot entegrasyonu ve sözleşme değişmedi (Duosis = destek tenant'ı).

Dalga A notları:
- Çözüm özeti: servis hâlâ 20 karakter istiyordu (kontrat 28.08'de 1'e inmişti) → kontrat sabiti.
- Ajan "Yeniden aç" gerekçesiz gidiyordu (409) → pencere gerekçe/soru sorar
  (yeniden aç, iptal: gerekçe; müşteride bekliyor: müşteriye soru, taslak dolu).
- Talep paneli: öncelik, atanan kişi + "Bana ata" (yanıt yetkisi yeter; başkasına
  atamak `tickets.assign`), işlem geçmişi (denetim olayları).
- Liste: öncelik/kategori/ekip filtresi, sıralama (son güncellenen/en yeni/en
  eski/öncelik), sayfalama (50; portal 24), 30 sn canlı yenileme (liste+detay).
- Portal: müşteri iptali yalnız sunucu izin verince (`can_cancel`), yanıta ek.
- CD dumanı: global tablo listesi `mixins.GLOBAL_TABLES` ile parite testine bağlandı.

Dalga B notları (helpdesk çekirdeği, 0019 — 9 yeni tenant-owned tablo, RLS+FORCE):
- SLA: sağlayıcı başına tek politika (öncelik → ilk yanıt/çözüm, mesai dakikası) +
  takvim (saat dilimi, haftalık pencere, tatiller; boş = 7/24). Saat açılışta
  hedefleri kopyalar; "müşteride bekliyor"da durur (kalan süre yukarı yuvarlanır),
  müşteri yanıtıyla devam eder; çözüm/kapanış/iptal karşılar; yeniden açılış tam
  süreyle yeniden başlar; öncelik değişince karşılanmamış hedefler güncellenir.
  İhlal OKUMADA hesaplanır; "SLA ihlali" kuyruğu + "SLA vadesi en yakın" sıralaması.
- Etiket (yapılandırma yetkisi), hazır yanıt (paylaşılan = yapılandırma; kişisel =
  yanıt yetkisi; eylem: durum yalnız işleme al/müşteride bekliyor, öncelik, etiket —
  tek transaction, mevcut servis kurallarıyla), kayıtlı görünüm (kişisel/paylaşılan,
  erişim vermez), takip, talep eden geçmişi, toplu işlem (talep başına sonuç;
  çözme/kapatma toplu yok).
- Okundu bilgisi sağlayıcıda (`ticket_reads`): ajan için "okunmamış", müşteri için
  "yeni güncelleme" — tenant'lar arası yazma yok.
- Zil: talep bildirimleri (yeni talep → ekip; müşteri yanıtı/yeniden açılış →
  atanan+takipçi, yoksa ekip; atama → atanan; eylemi yapan hariç) iş kalemi
  bildirimleriyle birleşik; okunmuşlar 90 günde mevcut cleanup işiyle temizlenir.
- Sözleşme değişmedi: yeni `ticket_events` türü yok, outbox alanı yok.

Dalga C notları (içgörü, 0020 — `ticket_csat`, RLS+FORCE):
- Raporlar (`/tickets/reports`): açılan/çözülen/birikim/yeniden açılan, medyan ilk
  yanıt ve çözüm (duvar saati), SLA uyumu (takvimli vadeye göre), CSAT ortalaması +
  memnun oranı (4–5), günlük seri (yerel gün), ekip/ajan/kategori/öncelik kırılımı.
  Kapsam = hub görünürlüğü (yönetici tümü, ajan kendi ekipleri) — liste ile aynı kural.
- CSAT: çözüldü/kapandı'da yalnız talebin sahibi 1–5 + yorum verir (talep başına tek
  kayıt, değiştirilebilir); ajan detayda görür. Sözleşme olayı üretmez.

Dalga D notları:
- D1 birleştirme (0021 `ticket_merges`): kaynak `duplicate` koduyla çözülür
  (`duplicate_of_ticket_id`), public yazışması hedefe iç not olarak taşınır,
  takipçi/etiket geçer; yalnız aynı uygulama + aynı müşteri, `tickets.resolve`.
- D2 otomasyon (0022 `ticket_automations` + `ticket_automation_runs`;
  `ticket_notifications.kind` kısıtı `automation` ile genişledi —
  `baseline_ddl.apply_ticket_notification_kinds` tek tanım). Kural başına
  savepoint; hata talep akışını bozmaz, çalışma geçmişine yazılır. Zamanlı
  kurallar mevcut `ticket-maintenance` CronJob'unda — yeni manifest YOK.
- D3 bilgi bankası (0023 `kb_categories`, `kb_articles`, `kb_votes`):
  ajan `/tickets/kb` (okuma: hub erişimi; yazma: `tickets.config.manage` ∨
  `tickets.admin`), müşteri `/support/help` (yalnız yayında + müşteriye açık;
  diğerleri 404). Arama TR karakter duyarsız + 5 harf kök eşleşmesi (başlık 3,
  anahtar kelime 2, özet 1,5, gövde 1). Yeni talep penceresinde başlığa göre
  öneri; ajan yanıtına "Makale ekle" (düz metin). Gövde güvenli Markdown alt
  kümesi — HTML üretilmez, bağlantılar yalnız http/https/mailto. Oy okuyucu
  başına tek (değiştirilebilir); görüntülenme müşteri okumasında sayılır.
- D4 e-posta (0024 `ticket_mail_settings`, `ticket_mail_outbox`,
  `ticket_mail_inbound`): kuyruk kanonik transaction'da her süreçte yazılır,
  dakikalık dispatcher Graph ile gönderir (yeniden deneme 1/5/15/60 dk, kalıcı
  hata, 24 saatte bayatlama). Talep edene yalnız Hermes uygulamasının talepleri
  (LogiSlot'a yok), ekibe atama/müşteri yanıtı/yeniden açılış; öncelik müşteri
  e-postasında yok. Gelen kutu `TICKET_MAIL_INBOUND_MAILBOX` boşken hiç
  çalışmaz; açılınca: artı-adres yönlendirme, DMARC/compauth doğrulaması (en
  üstteki başlık + `header.from` eşleşmesi), bağlı tenant'ın `tickets.create`
  izinli aktif üyesi şartı, numara + talep sahibi = yanıt, ekler tarama hattından.
  **Manuel adım:** dispatcher CronJob'una Graph/S2S/depolama env'i eklendi —
  `kubectl diff` + `apply` (ayrıntı: `docs/support-ticketing.md` §1d). Gelen
  kutu için posta kutusu + Mail.ReadWrite (kutuya kapsamlı) + ConfigMap anahtarı
  CTO kararını bekliyor.

