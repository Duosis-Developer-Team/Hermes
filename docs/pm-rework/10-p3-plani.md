# P3 planı — ana sayfa ve iş yüzeyi (D3–D6, E1–E6) + A5 · CTO kararıyla dev'de (22.09)

06'daki "P3 para katmanı sonrası" notu CTO kararıyla kaldırıldı: kalan kalemler de dev'de yapılır, hepsi birlikte test edilir, toplu ff. Girdi: 04-roller-ve-ana-sayfa (§3 izin başına blok, §4–7 bloklar ve dürtme kuralları, §9 üç eksen + görsel dil), 05 §D/§E kabul ölçütleri, 01 §3.4 (çalışma alanı, triage, `/work/KEY`), `prototip.html` (Can'ın taslağı).

## 0. Bitti sayılma ölçütleri (05'ten, aynen)

| Kod | Kabul ölçütü |
|---|---|
| D3 | Gecikmiş / bugün / bu hafta kovaları, proje gruplu; kova boşsa sessizce kaybolur |
| D4 | Toplantı + planlı zaman + termin tek şeritte (üç kaynak tek görünümde) |
| D5 | Kişi başına yük/gecikme/efor; sahipsiz iş sayacı; sıralama işe göre, kişiye göre değil |
| D6 | Dönem KPI'ları + anomali sinyalleri; eşik aşan sinyal öne çıkar |
| E1 | Kontrol çubuğunda üçten fazla eksen yok (görünüm · gruplama · yerleşim) |
| E2 | Görünüm link ile açılır, aynı sonucu verir (sistem + kişisel + paylaşılan) |
| E3 | Sahipsiz iş kaybolmaz — kalıcı triage kuyruğu |
| E4 | Bir kartta en fazla bir renkli sinyal (termin); öncelik nötr çubuk; durum konumdan |
| E5 | Takvim ayrı sayfa değil, bir yerleşim tipi |
| E6 | Bir işe link verilebilir (`/work/TASK-56`) |

Kapsam DIŞI (05 aynen): terminsiz işlerin ana sayfada gösterimi, takvime yazma/davet, performans puanı/sıralama, yeni rapor türü, beşinci eksen, görünüm paylaşım izinleri (v2), tip rengi, ayrı takvim sayfası, genel arama sayfası.

## 1. Bugünkü gerçekler

- Ana sayfa yok: `/` → Time Entry; `/dashboard` (reports.view) efor dağılımı (müşteri/proje/kullanıcı) gösterir.
- D2 efor şeridi Time Entry'de yaşıyor (`features/time-entry`), kapasite API'si var → ana sayfada **aynı bileşen** kullanılır.
- Tasks sayfası 5 eksen: yerleşim (explorer/board/list) × kapsam (my/assigned-by-me) × tip sekmesi × zaman (hafta/tümü) × hızlı filtre; kart üzerinde tip rengi + öncelik rengi + durum rozeti birlikte (04 §9.1'in "yarışan sinyaller" tespiti).
- `saved_views` tablosu P1.1'de geldi (scope personal|shared|system, layout board|list|timeline|calendar, filter_json); henüz uç/UI yok.
- `?item=<uuid>` tek seferlik derin link var; kalıcı `/work/KEY` yok.
- `issues` tablosu 0 kayıt; `/issues` CRUD router'ı ve `work_logs.issue_id` (Jira bağı) canlı — A5.

## 2. Seçimler — CTO 22.09'da dördünü de öneri yönünde onayladı

| # | Konu | Öneri (ONAYLI) | Alternatif |
|---|---|---|---|
| P3-1 | Ana sayfanın yeri | **Yeni `/` (login sonrası açılış) = blok kompozisyonu; `/dashboard` detay olarak kalır** (04 §6: "yerine geçmez, önüne geçer") | Ana sayfa dashboard'un yerine geçsin |
| P3-2 | İş yüzeyi geçişi (E1/E2) | **Tam geçiş:** sol kolon "Görünümler" (sistem + kişisel + paylaşılan), üst çubuk yalnız *gruplama · yerleşim*; bugünkü kapsam/tip/zaman/hızlı filtre eksenleri sistem görünümlerine dönüşür (Benim işlerim · Verdiklerim · Gecikmiş · Bu hafta · Sahipsiz · Issue'lar · Öneriler) | Mevcut çubuğu koruyup üstüne görünüm kaydetme eklemek (dört eksen kalır — E1 sağlanmaz) |
| P3-3 | Görsel dil (E4) | **Uygula:** öncelik ince nötr çubuk, tip küçük etiket, durum rozeti kalkar (konumdan), tek renkli sinyal termin (gecikmiş kırmızı · bugün amber · diğer nötr) | Bugünkü renkli kartı koru |
| P3-4 | A5 `issues` modülü | **Şimdi emekliye ayır:** `/issues` uçları 410, model/tablo F05'e kadar durur, menü/menü dışı referanslar kalkar; `work_logs.issue_id` (Jira) dokunulmaz | F05'te birlikte |

D5 görünme koşulu 04 §3 aynen: `tasks.assign` **veya** proje lideri; D6: `reports.view`. "Onay bekleyenler" bloğu (04 §3) para katmanının işi — bu turda yok.

## 3. Adımlar (her biri ayrı dev commit'i)

| Adım | İçerik | Kabul |
|---|---|---|
| **P3.1** Ana sayfa + D3 | `pages/HomePage.jsx` (`/`), blok kompozisyonu (izin başına), efor şeridi (mevcut bileşen), **İşlerim**: `GET /home/my-work` → {overdue, today, this_week} her biri proje gruplu (Müşteri · Proje + sayı; grup içi termin→öncelik); boş kova sessiz; gecikmiş kırmızı sayaç, bugün amber kenar; menüde "Ana sayfa" | D3 |
| **P3.2** D4 Takvimim | `GET /home/week?start=` → gün başına toplantılar (Graph senkronu, iptal hariç) + planlı zaman + termini o gün olan işlerim; tıklama ilgili kaydı açar (toplantı → Meetings, plan → Time Entry, iş → `/work/KEY`) | D4 |
| **P3.3** D5 + D6 | `GET /home/team` (tasks.assign ∨ lead): kişi başına açık/gecikmiş/bu hafta efor÷beklenen; "Dikkat": sahipsiz işler, terminini geçmişler, bu hafta hiç efor girmemişler — sıralama bekleyen iş sayısına göre. `GET /home/org` (reports.view): dönem toplam efor + faturalanabilir oran (mevcut dashboard verisi) + anomali sayaçları (giriş yapmamış kişi, gecikmiş iş + geçen haftaya göre trend, sahipsiz birikme) — eşik aşınca vurgu; kısayollar | D5, D6 |
| **P3.4** E3 + E4 + E6 | Triage: sahipsiz işler sistem görünümü + ana sayfa "Dikkat" sayacı; görsel dil kart/liste/pano'da; `/work/:key` rotası → kodu çözer, Tasks'ı `?item=` ile açar (alias'lar da çözülür) | E3, E4, E6 |
| **P3.5** E1 + E2 + E5 | `saved_views` uçları (`GET/POST/PATCH/DELETE /views`; sistem görünümleri tohum, kişisel/paylaşılan kullanıcıdan; filtre = tip/kapsam/durum/proje/termin/sahip); sol kolon + üst çubuk (gruplama: proje·durum·sahip·termin; yerleşim: liste·pano·takvim); URL `?view=<id>` link ile aynı sonucu verir; **takvim yerleşimi**: hafta ızgarası, termin + toplantı (D4'ün bileşeni) | E1, E2, E5 |
| **P3.6** A5 | `/issues` uçları 410 + frontend referanslarının kaldırılması (onaylanırsa) | — |

Şema: yeni tablo yok; `saved_views` P1.1'den. Yeni izin yok (blok/görünüm görünürlüğü mevcut izin + proje lideri).

## 4. Riskler
- Tasks sayfası testleri (21 dosya) E1 geçişinde yeniden yazılır; `viewParity`/`featureStructure` kilitleri korunur, TasksPage <450 satır sınırı (sol kolon ayrı bileşen).
- Ana sayfa blokları çok sorgu açar → blok başına tek uç (`/home/*`), react-query ile paralel; her blok kendi izniyle 403 yerine sunucu "yok" döner (blok render edilmez).
- Görsel dil değişikliği kullanıcıya görünür; E4'ü kabul ölçütü olarak Can koydu, CTO onayı P3-3.
