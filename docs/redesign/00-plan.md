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

### Revizyon 6 (28.09.2026) — tam ekran cam

- Kabuğun kenar boşluğu, köşe yuvarlaması ve çerçeve halkası kaldırıldı:
  şeffaf cam artık TAM EKRAN (modal içinde gibi durmuyor). Sıvı zemin
  camın arkasından görünmeye devam eder; içerik 1440px'te ortalanır.

### Revizyon 7 (28.09.2026) — ince kenar çerçevesi

- Tam ekran camın kenarında sabit (kaydırmada yerinde kalan), 10px içeriden
  geçen ince çerçeve: 30px yuvarlak köşe + 1px ışık çizgisi, dışında hafif
  tonlu bant (açık = beyaz %26, koyu = siyah %28). Tıklamayı engellemez;
  mobilde 6px / 22px köşe.

### Revizyon 8 (28.09.2026) — çizgi çerçeve

- Kenar çerçevesi inceltildi: tonlu bant neredeyse yok (%7–8), 6px içeride
  26px köşe, 1px ışık çizgisi + üstte iç parlama / altta iç gölge ile çok
  hafif bombe. "Çerçeve" değil "çizgi" hissi.

## 5. Uygulama durumu (28.09.2026) — prototip v8 onaylandı, kodda

| Adım | Commit | Özet |
|---|---|---|
| R1+R2 | `7bb45b1` | Cam token'lar (RGBA yüzey, kontrast testi birleşik renkle), Geist yerel, varsayılan açık tema; ada + ⌘K + profil kartı + dock kabuğu, mobil alt sekme; LiquidBackdrop (yalnız transform) |
| R3a | `4174bc7` | Ana sayfa: Hermes işaretli karşılama, efor kapsülleri, cam bloklar |
| R3b | `df0a8d9` | Eski değişken köprüsü (51 dosya → cam), İşler panosu/kenar çubuğu cam |
| R4 | `cf5fb79` | Zaman girişi ve Toplantılar gün kartları cam; camgöbeği → Hermes mavisi |
| R5 | `665adcf` | Metrik karoları, cam filtre çubuğu, hap çoklu seçim; **ui.css global yükleme regresyonu düzeltildi** |
| R5b/R6 | `69e01d7` | Giriş ekranı sıvı zemin + Hermes işareti; masaüstü `hiddenInset` + sürükleme bölgesi (yalnız Electron'a enjekte) |

| Hareket | `c80a86e` | `liquid.css` + `components/liquid` (PageHero, GlassCard, CountUp, Ring, BarList…); View Transitions ile sayfa geçişi, kayan ada sekmesi, ada damlası açılır menüler, dock sekmesi, adada gerçek "sıradaki toplantı" |
| Sayfa sayfa | `58effa3` … `391c025` | Zaman girişi, Ana sayfa (bento + Dikkat kartı), İşler, Toplantılar (saat ızgarası), Talepler (bölünmüş liste + sohbet), Pano, Faturalanabilir, Raporlar, Sözleşme, Ayarlar, Developer ve Destek portalı prototip anatomisiyle yeniden kuruldu; global `dayjs.locale('en')` sızıntısı kaldırıldı |
| Dock eylemleri | `1615095` | Dock'ta "Efor gir" (`/time-entry?date=`), "Yeni iş" (`?new=task`) |
| Kalanlar | `956d332` | Çizelge, iş detay paneli (öncelik/durum i18n), tüm modallar (cam sayfa + yaylanan giriş), Platform konsolu |
| Masaüstü | `8e42adc` | İlk boya sıvı zemin tonunda; .dmg yeniden üretildi (`desktop/dist`, 28.09 22:15) |

| Zemin + işaret | `917c2a5` | Açık tema: nötr gümüş sıvı + %30 cam (saydam his); kutulu Hermes işareti iki temada (`--h-mark-*`); masaüstü vibrancy denemesi geri alındı (uygulama web ile aynı zemin) |
| Pencereler v2 | `c62ef0a` … `9d25805` | Tüm modallar prototip anatomisinde: ModalHead (ikon kutusu), adım çubuğu, seçenek kartları, çip seçici (anlamsal radyo), bölüm etiketleri, yapışkan cam alt çubuk; Efor gir 3 adım kartlarla; Yeni iş/Plan/Toplantı (kahraman şerit)/İş inceleme; onaylar; Filtreler ve tüm çekmeceler yüzen cam panel (`lq-sheet`) |
| Akıcılık + sıvı | `66981ea` | Kayan alanda canlı bulanıklık kaldırıldı (ölçüm: 33 ms → 16.7 ms, takılma 0); sıvı prototiple birebir (tek `blur(56px)` katmanı, organik blob, gren); açıkta gümüş + hafif mavi |
| Plan Time kaldırıldı | `5f39223`, `5ee74c3` | Backend uçları + ana sayfa planları + tüm UI; tablolar veride kalır (DROP yok), `plans.manage` izni katalogdan çıkarıldı (29.09; rollerde kalan kayıt etkisiz — roller ∩ katalog); gün sütununda tek "+" → efor; efor inceleme penceresi |
| Ada + profil + foto | `87e75ba`, `6694c4b` | Tema/dil adada; yeni profil kartı; Microsoft Graph fotoğrafı girişte `/me/photos/96x96` (User.Read) → `auth_db.user_photos` (0005) → Avatar |
| İşler / Talepler / Panel | `04916aa`, `f9f72c6`, `3f286e4` | Panel açıkken sütunlar sığar; kişi şeritleri; talep durum hapı + pencere, simetrik liste, TR etiketler; Panel kartları eşit, tüm kullanıcı adları görünür |
| Dev mock veri | `03157e6` | `app.jobs.dev_seed` (auth + core), yalnız hermes-dev (4 katlı kapı); 29.09 hermes-dev'e tohumlandı — runbook `docs/dev-seed.md` |

Akıcılık: CDP ile ölçüldü — ana sayfa kart bulanıklığıyla 60 fps (p95 16.8 ms).
Electron = Chromium, dolayısıyla View Transitions / backdrop-filter / dock web ile
masaüstünde AYNI; masaüstü ek olarak başlıksız pencere + sürükleme bölgesi taşır.
Arayüz sunucudan yüklenir: web'e giden her değişiklik uygulamaya da gelir
(test sunucusu ff'e kadar eski arayüzü gösterir; uygulamada sunucu dev seçilebilir).

Kararlar: 04.08 "mavi buton yok" kararı prototip onayıyla değişti (birincil = mavi
gradyan hap). Collapsed-sidebar ve onun testleri silindi; RBAC/prefetch/aktif
rota/offline/odak sözleşmeleri yeni kabukta korunuyor. Kullanılmayan eski logo
dosyaları silindi (`logo-icon-light.png` masaüstü/favicon kaynağı olarak kalır).

Bilinen, kapsam dışı: bazı Talepler sabitleri ve portal uyarısı hâlâ İngilizce
(i18n borcu); Developer dokümanları kural gereği İngilizce.
