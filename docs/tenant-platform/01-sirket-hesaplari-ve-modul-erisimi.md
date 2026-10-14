# Şirket hesapları ve modül erişimi (14.10.2026)

Bağlam: Defacto gibi müşterilerin "iç yönetimi" yok; ayrı bir tenant açmak
anlamsız. Duosis tenant'ı içinde Defacto'ya **tek bir hesap** verilir ve bu
hesap yalnız talep yönetimini görür. Aynı mekanizma, tenant içinde modüllerin
kimlere açık olduğunu (şirketler/gruplar/kullanıcılar) seçmeye genellenir.

## 1. CTO kararları (K6)

| # | Karar |
|---|---|
| K6.1 | Şirket = tenant içinde **tek giriş hesabı** (çalışanları olan bir kap DEĞİL). Kullanıcılar listesinde değil, ayrı **Şirketler** listesinde durur. |
| K6.2 | Şirket hesabı talep iznini **otomatik** alır: Talepler modülü verildiyse talep açar ve kendi taleplerini görür; rol atanmaz. |
| K6.3 | Modül erişimi RBAC benzeri: her modül "Herkes" (iç kullanıcılar, varsayılan) ya da seçili şirketler/gruplar/kullanıcılar. Bugünkü davranış değişmez. |
| K6.4 | Tenant yöneticileri (system-admin) modül kısıtından **muaf**: tenant'ta açık her modülü görür. |
| K6.5 | Geliştirme dev'de; test'e ff yalnız CTO "ff yapalım" deyince. |

## 2. Model

- **Hesap türü:** `tenant_memberships.account_kind` = `person` | `company`
  (auth 0007, varsayılan `person` → mevcut herkes aynen).
- **Modül politikası:** `tenant_module_policies(tenant, module, everyone)`;
  satır yoksa `everyone = true`. **Erişim kuralları:**
  `tenant_module_grants(tenant, module, principal_type user|group, principal_id)`.
  Şirket hesabı bir `user` kuralıyla seçilir (arayüzde "Şirketler" başlığında).
- **Etkin modüller** = tenant modülleri (süper-admin, tavan) ∩
  - yönetici (person) → hepsi;
  - person → `everyone` olan modüller ∪ kendisine/gruplarına verilenler;
  - company → yalnız kendisine verilenler ("Herkes" şirketleri KAPSAMAZ).
- **Etkin izinler** (auth, tek nokta — core/raporlar/ön yüz aynı sonucu görür):
  - person: rol izinleri ∩ etkin modüllerin izinleri (+ çekirdek izinler);
  - company: rol izni yok; yalnız etkin modüllerin izinleri — çekirdek izinler
    (users.manage vb.) HER ZAMAN düşer; Talepler varsa `tickets.access` +
    `tickets.create` örtük gelir.
- **Gruplar core'da kalır:** core, auth'a izin sorarken kullanıcının aktif
  grup kimliklerini iletir; auth'un kendi uçları (giriş, `/me`, `/rbac/me`)
  core'dan S2S okur (kısa önbellek). Grup kuralı yoksa çağrı yapılmaz.

## 3. Uygulama noktaları

- **auth:** `module_access` servisi (etkin modül + izin), `/internal/authz/resolve`
  yanıtına `modules` + `account_kind`; `/users/me` ve `/rbac/me` yanıtına
  `access`; şirket hesabı CRUD (`users.manage`); modül erişimi CRUD
  (`roles.manage`); şirket hesabına rol atanamaz; kullanıcı listeleri ve
  dizin aramaları şirket hesaplarını göstermez; şirket hesabı dizinde yalnız
  kendini görür.
- **core:** modül kapısı kullanıcı bazlı (auth profilinden); şirket hesabı
  için **iç kullanıcı kapısı** — talep portalı, yardım merkezi ve
  `/tickets/context` dışındaki her uç 404 (route-walk testiyle kilitli);
  talep yüzeyi: şirket hesabı hub görmez, portalda sağlayıcısı kendi
  tenant'ıdır, müşteri kaydı `company:<hesap>` ve şirketin destek ekibine
  yönlenir.
- **Ön yüz:** `hasModule` etkin modüllerden; şirket hesabının kabuğu yalnız
  izinli modüller (Talepler → Taleplerim); Ayarlar → Kullanıcılar'a
  **Şirketler** ve **Modül erişimi** sekmeleri.

## 4. Fazlar

| Faz | İçerik |
|---|---|
| M1 | Şema (auth 0007), çözümleyici, auth/core kapıları, güvenlik testleri |
| M2 | Şirketler (CRUD + destek ekibi) ve şirket hesabının talep akışı uçtan uca |
| M3 | Modül erişimi ekranı (Herkes / şirket / grup / kullanıcı seçimi) |

## 4b. Durum

| Faz | Commit | Dev | Kanıt |
|---|---|---|---|
| M1–M3 | (bu commit) | CD sonrası (auth 0007) | auth 272, core 917, frontend 1193 |

Notlar:
- Şirket hesabının türü JWT'de (`account_kind`) — core, auth'a ulaşamasa da
  şirket hesabını iç uçlardan 404 ile çevirir; route-walk testi (`tests/
  test_company_access_gate.py`) yeni bir router'ın kapısız kalmasını engeller.
- core → auth izin sorgusu kullanıcının aktif grup kimliklerini taşır (iç içe
  S2S yok); auth kendi uçları için `POST /internal/access/groups` (core, S2S).
- Şirket hesabının talebi `company:<hesap>` müşterisi olarak saklanır; müşteri
  kaydı + destek ekibi Ayarlar → Kullanıcılar → Şirketler'den
  (`PUT /api/v1/core/companies/{id}/support`, `users.manage`). Yalnız talep
  alan (sağlayıcı) tenant'larda.
- Kişi hesabı için modül profili alınamazsa (auth erişilemez) tenant tavanına
  düşülür; izinli uçlar zaten auth'a bağlıdır. Şirket hesabı fail-closed.

## 5. Bilinen sınırlar

- Başka tenant'ta hesabı olan bir e-posta bugün eklenemez (409); şirket
  hesabı için ayrı bir giriş e-postası kullanılır.
- Değişiklikler önbellekler nedeniyle en geç ~1–2 dk içinde etkili olur.
- Public API (token) aktörleri tenant düzeyinde kalır (kendi kapsam/mod
  eşlemesi var).
