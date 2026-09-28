# Hermes yeniden tasarım + macOS uygulaması — plan (28.09)

CTO kararları (28.09): masaüstü = yerel kabuk, sunucudaki Hermes'i açar ·
varsayılan sunucu test, menüden dev · şimdilik imzasız (ad-hoc) .dmg ·
tasarım: önce tasarım sistemi + kabuk, sonra modül modül (dev'de).

Referans: Dribbble "AgroControl" — ekran görüntüsü `referans-goruntuler/image.png`.
Prototip v2 referansa göre yeniden yazıldı (onay bekliyor):
https://claude.ai/artifact/BuBrMnUhjW3ysM2VV3CYGB

## 1. Masaüstü uygulaması — YAPILDI (`18a1109`)

`desktop/` (Electron 44). Ayrıntı: `desktop/README.md`. Kalan: Developer ID
imza + notarization, otomatik güncelleme, yeni tasarımla `hiddenInset`
başlık çubuğu.

## 2. Tasarım dili (prototip v2, referanstan)

| Öğe | Karar |
|---|---|
| Zemin | Tam ekran fotoğraf/doku; üstünde koyu yeşil **buzlu cam** uygulama paneli (`rgba(20,29,22,.78)` + blur 28, radius 34). Tek, koyu görünüm (referans gibi). |
| Gezinme (ada) | Üst bar: solda logo + ad, **ortada hap segmentli gezinme** (aktif = neredeyse beyaz hap, koyu yazı), sağda yuvarlak arama/bildirim/ayar + avatar. Adada 4 ana modül + `···` (tüm modüller başlatıcısı, ⌘K) + canlı zamanlayıcı hapı (tıklayınca ada genişler). Sol menü kalkar. |
| Vurgu | Tek parlak renk **limon** `#FAED7E` — yalnız birincil eylem ("+ Yeni iş") ve bugünün vurgusu. |
| Kontroller | Hap arama/filtre/yerleşim; seçili = beyaz hap. |
| Kanban | Sütun başlığı yarı saydam bant + renkli durum rozeti (Bekliyor mor, Devam mavi, Tamam yeşil, Gecikmiş turuncu) + sayı dairesi. Kart: yarı saydam, iş kodu, başlık, tarih \| süre ikonlu satır, Müşteri · Proje, ayırıcı, bayraklı öncelik çipi (Yüksek turuncu / Orta sarı / Düşük mavi) + avatar yığını (+N). |
| Tip | Space Grotesk (referans), kod/süre JetBrains Mono. |

Not — E4 (P3.4) ile fark: referans öncelik bayrağını renkli ve durum rozetlerini
renkli kullanıyor; E4 "kartta tek renkli sinyal = termin" diyordu. Prototip
referansı izliyor; CTO onayıyla E4 kilidi yeni dile göre güncellenir.

## 3. Uygulama adımları (her biri ayrı dev commit'i, eski ekranlar çalışmaya devam eder)

| Adım | İçerik |
|---|---|
| R1 | Tasarım token'ları (`styles/tokens.css` yeni katman) + antd `ConfigProvider` teması + fontlar. Mevcut `--h-*` token'ları yeni değerlere bağlanır — tüm ekranlar renk/radius/tip olarak bir anda yeni dile yaklaşır. |
| R2 | Yeni kabuk: `AppShell` sol menü → dynamic island + Tümü başlatıcısı + ⌘K palet (izin filtreli, mevcut menü kataloğundan); mobilde ada alta iner. Canlı slot: toplantı (mevcut /home/week) — zamanlayıcı backend'i yok, R2'de yalnız toplantı. |
| R3 | Ana sayfa + İşler (bento, pano/liste/takvim, görünümler) yeni bileşenlerle. |
| R4 | Zaman girişi, Toplantılar, Talepler. |
| R5 | Raporlar/Panel/Faturalanabilir/Sözleşme, Ayarlar, Developer portalı. |
| R6 | Masaüstü: `hiddenInset` başlık + ada sürükleme bölgesi; imza/notarization (sertifika gelince). |

Açık soru: canlı adadaki **zamanlayıcı** (başlat/durdur → efor kaydı)
yeni bir özellik; backend'de çalışan zamanlayıcı yok. İstenirse R4'te
ayrı küçük bir uç (`/timers`) ile eklenir.


## 4. Revizyon (28.09, CTO): Hermes Liquid

CTO: referans birebir değil; **Hermes renkleri**, **tüm modüller eksiksiz**,
**koyu olmayan sıvı (liquid) zemin**, sayfa sayfa en estetik + kullanışlı,
animasyonlu; godly.design'dan uygun fikirler.

Prototip: https://claude.ai/artifact/HXXunk5DuR4VXEAVonnQfp · kopya
`docs/redesign/prototype-liquid.html` (tek dosya, örnek veri).

- Zemin: Hermes mavi/mor/yeşil (+az amber) blob'larından akan mesh, biri
  imleci izler; grain. Varsayılan AÇIK; koyu tema profil menüsünden.
- Yüzey: liquid glass (blur 24 + saturate 180 + üst kenar ışığı), kartlarda
  imleci izleyen parıltı.
- Ada (godly: dynamic island, Liquid Glass toolbar, two-step dock): logo,
  5 ana modül + kayan aktif gösterge, dock (Yönetim · Sistem kartları + ⌘K
  sonuçları: sayfa/iş/eylem/kişi), canlı zamanlayıcı (genişler: durdur ve
  kaydet), bildirimler, profil (organizasyon, tema, dil, çıkış). Kayıt
  sonrası toast adanın içinde akar. Mobilde alt dock.
- Sayfalar: Giriş, Ana sayfa, Zaman (hafta + çizelge, 3 adımlı efor
  sihirbazı), İşler (görünümler, pano sürükle-bırak, gruplu liste, takvim,
  sağdan kayan detay paneli 4 sekme), Toplantılar (saat ızgarası + şimdi
  çizgisi), Talepler (liste + yan yana çalışma alanı), Destek portalı,
  Panel, Faturalanabilir, Raporlar, Sözleşmeler, Ayarlar (11 sayfa),
  Developer (16 bölüm), Platform konsolu; modallar: efor, yeni iş, plan,
  toplantı, görünüm kaydet, talepten iş, yeni talep, kullanıcı, üyeler,
  token, referans kaydı.
- Geçişler: View Transitions (sayfa ve pano güncellemesi), yay (spring)
  eğrileri, kaynağından büyüyen modal, sayı sayma, halka çizimi,
  `prefers-reduced-motion` ile hepsi kapanır.

### Revizyon 2 (28.09, CTO geri bildirimi)
- Zemin: Hermes'in asıl rengi — uzay siyahı + koyu lacivert sıvı (mavi
  `#0C66E4` ışımalarıyla); iki temada da aynı. Açık tema = beyaz buzlu cam
  yüzeyler, koyu tema = koyu buzlu cam.
- Ana sayfa: satır başına eşit yükseklik (Efor 8 + Dikkat 4 · İşlerim 7 +
  Takvimim 5 · Ekibim 7 + Organizasyon 5), boşluk yok; görseller: efor
  halkası + gün çubukları + özet, Dikkat sinyal satırları (mini grafik),
  İşlerim kova dağılım çubuğu + proje grupları, Takvimim gün şeridi +
  "sıradaki" kartı + bugünün zaman çizelgesi (şimdi çizgisi), Ekibim iş yükü
  çubuğu + 5 günlük efor ısı hücreleri, Organizasyon faturalanabilir halkası
  + 8 haftalık trend + müşteri çubukları.
- Toplantılar: sol ray (sıradaki toplantı, mini ay takvimi, haftalık özet +
  "kaydedilmemişleri efora dönüştür", takvim filtreleri) + katılımcı avatarlı
  zaman ızgarası; toplantı penceresi degrade başlıklı, gündem + katılımcı
  yanıtları + tek tıkla efor.
- Pencereler: ikon karolu başlık + alt başlık, gruplanmış form, yapışık
  eylem çubuğu, etiketli adım göstergesi.
- Arama: kompakt Spotlight (560 px): son kullanılanlar + eylemler, gruplu
  sonuçlar, ↑↓ ↵ klavye.
- Profil: kimlik kartı, organizasyon değiştirici (onay işaretiyle), tercihler
  (tema, dil), ayarlar/kısayollar, masaüstü sürümü, çıkış.
- Dock: macOS mantığı — alt kenarda büyüyen (magnification) dock: Yönetim
  (Panel, Faturalanabilir, Raporlar, Sözleşmeler) · Sistem (Ayarlar,
  Developer, Destek portalı, Platform) · hızlı eylemler (Efor gir, Yeni iş).
- Ayarlar/Developer yan menüsü: 16 px ikon, 28 px karo.

### Revizyon 3 (28.09, CTO)
- Açık tema: zemin açık tonlu (inci/gümüş + Hermes mavisi) şeffaf sıvı;
  kartlar opak değil, %34–58 beyaz buzlu cam (blur 28 + saturate 190).
- Koyu tema: uzay grisi + uzay siyahı sıvı (grafit tonları), canlı mavi yok;
  kartlar koyu şeffaf cam.
- Marka: adada logo karosu (grafit küre + ışık yansıması animasyonu) +
  "Hermes" kelime işareti; ana sayfada 76 px logo karosu (dönen ışıma halkası)
  + "HERMES · Duosis çalışma alanı" üst satırı; giriş ekranı aynı karo. Logo
  maskesi 192 px ve kalınlaştırılmış çizgiyle.
- Dock ve sayfa üstü metinler tema token'larına bağlandı.

### Revizyon 4 (28.09.2026)

- **Raporlar filtreleri**: checkbox listeleri yerine aranabilir çoklu seçim
  alanı (seçilenler kaldırılabilir çip, `+N` taşması; açılır listede arama,
  kişide avatar / müşteride renk noktası, kayıt başına saat, "Tümünü seç /
  Temizle"). Tarih = 4'lü hazır aralık segmenti + özel aralık. Tablonun
  üstünde "Etkin" filtre çubuğu (tek tık kaldır, "Tümünü temizle").
- **Profil menüsü**: kapak şeridi + durum noktalı büyük avatar, hızlı
  istatistik (bu hafta saat / açık iş / toplantı, tıklanınca ilgili sayfa),
  durum seçimi (Müsait/Odakta/Meşgul), organizasyon kartları, önizlemeli
  Açık/Koyu tema karoları, dil, kısayollar, çıkış.
- **Ayarlar sol menüsü**: v1'deki sade ikon + etiket satırlarına dönüldü;
  ikon 16px, soluk renk, hover/aktifte metinle aynı renk (ikon kutusu yok).

### Revizyon 5 (28.09.2026) — şeffaf kabuk

- Uygulama, sıvı zeminin üstünde yüzen tek büyük yarı saydam **kabuk**
  (40px köşe, 12px çerçeve halkası) içinde; zemin kenarlardan ve kabuğun
  içinden görünür. Açık = beyaz şeffaf cam (`--shell` %34 beyaz), koyu =
  uzay siyahı şeffaf cam (`--shell` %36 siyah).
- Sıvı daha canlı ve daha az bulanık (blur 56px) ki şeffaflık okunsun;
  koyuda gri/çelik tonlar, canlı mavi yok.
- Kartlar kabuk içinde hafif renkli cam (blur 14px); üst menü koyu ada
  yerine yarı saydam hap, aktif sekme beyaz dolgu (`--nav-*` tokenları).
