# Hermes — Roller, Ana Sayfa ve İş Yüzeyi

Bu doküman üç soruyu cevaplar: **kim ne yapmak için giriyor**, **giriş yaptığında ne görmeli**, ve
**iş listesi sıkışıklığından nasıl çıkılır**. Görsel sürüm (ekran taslaklarıyla) artifact olarak
yayınlandı; bu dosya kararları ve veri gereksinimlerini taşır.

Bağlam: `00-konumlandirma` (kimlik) · `01-tasarim` (ürün yönü) · `02-sema` (veri modeli) ·
`03-yetenekler-ve-mimari` (katmanlar ve yetenekler).

---

## 1. Bulgu: Hermes'in ana sayfası yok

`App.jsx` içinde kök rota doğrudan `/time-entry`'ye yönleniyor. Yani giriş yapan **herkes** — çalışan,
ekip yöneticisi, üst yönetici — bir **veri giriş formuna** düşüyor.

Sonuçları:

- Kullanıcı "bugün ne yapmalıyım" sorusunun cevabını hiçbir yerde göremiyor; iş listesine ayrıca
  gitmesi gerekiyor.
- Eksik efor girişi hiçbir yerde görünmüyor. Girmediğin gün sessizce geçiyor; ay sonunda rapor
  alınınca fark ediliyor.
- Termini geçmiş iş için tek uyarı kanalı e-posta. E-postayı kaçıran hiçbir şey görmüyor.
- Dashboard var ama tek bir yönetici ekranı: 30 günlük toplam saat + müşteri/proje/kişi kırılımı.
  Kişisel bir karşılığı yok.

**Ana sayfa eksikliği, uygulama içi bildirim eksikliğiyle aynı boşluğun iki yüzü.** Bildirim
"bir şey oldu" der; ana sayfa "şu an durumun bu" der. İkisi de yok.

---

## 2. Üç persona

| Persona | Neden giriyor | Bugün nereye bakıyor | Eksik olan |
|---|---|---|---|
| **Çalışan** | Bugün ne yapacağım? Eforumu girdim mi? Toplantım var mı? | Time Entry formu, sonra Project Management, sonra Meetings — üç ayrı yer | Tek bir "durumum" ekranı; eksik gün uyarısı; termin uyarısı |
| **Ekip yöneticisi** | Ekibim ne durumda? Kim neyi geciktiriyor? Kim kime iş verebilir? | Project Management (yalnız kendi verdikleri) + PM Configurations (erişimi varsa) | Ekip görünümü; kendi ekibinin atama ayarını kendi yönetmesi |
| **Üst yönetici** | Nereye ne kadar efor gitti? Faturalanabilir oran ne? | Dashboard + Raporlar + Billable Hours — üç ayrı sayfa | Tek bakışta özet; anomali (eksik giriş, gecikme yoğunluğu) sinyali |

**Ekip yöneticisinin bugünkü çıkmazı:** iş atama yetkisi rolden geliyor ama "kime atayabilirim"
ayarı kiracı genelinde ve `tasks.permissions.manage` istiyor. Yani ekibini yönetemiyor. Çözüm
`03-yetenekler-ve-mimari` §2'de: proje üyeliği + proje ayarları sayfası.

---

## 3. Karar: rol başına sayfa değil, izin başına blok

"Rol bazlı ana sayfa" isteğinin doğru uygulaması, üç ayrı sayfa yazmak **değil**. Gerekçe: roller
karma. Bir ekip yöneticisi aynı zamanda kendi eforunu girer; bir üst yönetici aynı zamanda ekip
yöneticisidir. Üç ayrı sayfa yazmak, aynı bloğu üç yerde bakım yapmak demektir.

**Kurgu:** tek `/` rotası, **blok kompozisyonu**. Her blok kendi iznini ister; izni olmayan blok
render edilmez. Menü zaten bu deseni kullanıyor (`can(perm)` filtresi) — ana sayfa aynı deseni
blok seviyesine indiriyor.

| Blok | Görünme koşulu | İçerik |
|---|---|---|
| Efor durumu | Herkes | Bu haftaki dolum, eksik günler, hızlı giriş |
| İşlerim | `tasks.access` | Bugün / bu hafta / gecikmiş, projeye göre gruplu |
| Takvimim | Herkes | Toplantılar + planlı zaman + termini gelen işler |
| Ekibim | `tasks.assign` **veya** proje lideri | Ekip yükü, gecikenler, atanmamış işler |
| Onay bekleyenler | `worklogs.admin` / faturalandırılabilirlik onayı | Onay kuyruğu |
| Organizasyon özeti | `reports.view` | Efor dağılımı, faturalanabilir oran, anomali sinyalleri |

Sıralama sabit değil: kullanıcı bloğu gizleyebilir/sıralayabilir, ama **varsayılan sıra role göre
seçilir** (en çok izne sahip blok üstte değil — en sık kullanılan blok üstte).

---

## 4. Çalışanın ana sayfası

Üç soruyu, üç blokla, tek ekranda cevaplar: *eforumu girdim mi · bugün ne yapacağım · nerede olmam
gerekiyor.*

### 4.1 Efor durumu şeridi

Üstte, en görünür yerde. İçeriği:

| Öğe | Kural |
|---|---|
| Haftalık dolum | `girilen saat / beklenen saat` — çubuk + oran |
| Gün gün dolum | Beş (veya çalışma takvimine göre N) kutu; her biri o günün dolumunu gösterir |
| Eksik gün | Geçmiş çalışma günü + 0 saat + izin/tatil değil → **sarı**, tıklayınca o güne giriş açılır |
| Eksik saat | Geçmiş çalışma günü + beklenenin altında → soluk gösterim, uyarı değil |
| Bugün | Hiçbir zaman uyarı değil — gün bitmeden eksik sayılmaz |

### 4.2 İşlerim bloğu

Sıkışıklıktan kurtulmanın anahtarı: **liste değil, üç kova.**

| Kova | Kural | Boşsa |
|---|---|---|
| Gecikmiş | `due_date < bugün` ve durum kategorisi `done/cancelled` değil | Blok hiç görünmez |
| Bugün | `due_date = bugün` | "Bugün için terminli işin yok" |
| Bu hafta | `due_date` bu hafta içinde | Sessizce boş |

Her kovanın içinde işler **projeye göre gruplanır** — kullanıcının istediği "bak bu projede dört
taskın var, ikisi bu hafta" görünümü budur. Grup başlığı: `Müşteri · Proje` + sayı. Grup içi sıra:
termin, sonra öncelik.

Terminli olmayan işler ana sayfada **görünmez** — onlar iş yüzeyindedir. Ana sayfa "şimdi ne" ekranı;
"her şey" ekranı değil.

### 4.3 Takvimim bloğu

Üç kaynak tek şeritte: toplantılar (Graph senkronu), planlı zaman, termini bugün/bu hafta olan işler.
Ayrı bir takvim sayfası açmak yerine gün şeridi; tıklama ilgili kaydı açar.

---

## 5. Ekip yöneticisinin ana sayfası

Çalışan bloklarının **üstüne** iki blok gelir:

| Blok | İçerik |
|---|---|
| **Ekibim** | Kişi başına: açık iş sayısı, gecikmiş sayısı, bu hafta girilen efor / beklenen. Kırmızı yalnız gecikmede |
| **Dikkat gerektirenler** | Atanmamış işler (triage), terminini geçmiş işler, bu hafta hiç efor girmemiş kişiler |

**Ton kuralı:** ekip bloğu bir performans karnesi değil, bir kuyruk. Sıralama "en kötü kişi" değil,
"en çok bekleyen iş" üzerinden yapılır. Kişi kırılımı isteyen raporlara gider.

---

## 6. Üst yöneticinin ana sayfası

Mevcut Dashboard'ın yerine geçmez, **önüne** geçer: dashboard detay, ana sayfa özet.

| Blok | İçerik |
|---|---|
| Dönem özeti | Toplam efor, faturalandırılabilir oran, müşteri/proje kırılımı — mevcut dashboard verisi |
| Anomali sinyalleri | Bu hafta hiç giriş yapmamış kişi sayısı · gecikmiş iş sayısı ve trendi · atanmamış iş birikmesi |
| Kısayollar | Rapor al, Excel çıktısı, sözleşme durumu |

Anomali bloğu yeni veri istemiyor: üçü de mevcut tablolardan sayım. Değer, sayıların **eşik
aşıldığında** öne çıkmasında.

---

## 7. Uyarı ve dürtme kuralları

Kullanıcının isteği net: *"çok göze batmayan bir uyarıyla."* Kural seti:

| Durum | Nerede | Şiddet | Metin yönü |
|---|---|---|---|
| Dün efor girilmemiş (çalışma günü, izin değil) | Efor şeridi, ilgili gün kutusu | Sarı nokta | "Perşembe boş" — suçlayıcı değil, tıklanabilir |
| Bu hafta ≥2 gün boş | Efor şeridi başlığı | Sarı satır | "Bu hafta 2 gün eksik" |
| Termini geçmiş iş var | İşlerim bloğunda "Gecikmiş" kovası | Kırmızı sayaç | Sayı + liste; ayrıca banner yok |
| Termini bugün olan iş | "Bugün" kovası | Amber kenar | Uyarı değil, vurgu |
| Atanmamış iş (yönetici) | Dikkat bloğu | Nötr sayaç | "3 iş sahipsiz" |
| Hiç iş / hiç eksik yok | — | — | Blok sessizce boş; "tebrikler" tonu yok |

**Yasaklar:** modal uyarı yok, kırmızı toast yok, giriş yapınca çıkan hatırlatma penceresi yok.
Uyarı hep bulunduğu bloğun içinde ve tıklanabilir. Bir durum aynı anda iki yerde uyarı üretmez.

---

## 8. Veri gereksinimleri

Ana sayfanın istediği ama bugün **olmayan** tek şey kapasite bilgisi:

| İhtiyaç | Bugün | Öneri |
|---|---|---|
| Günlük beklenen saat | Yok | Kiracı varsayılanı (ör. 8) + kullanıcı başına override |
| Çalışma günleri | Yok | Kiracı ayarı (varsayılan Pzt–Cum) |
| Resmî tatil | Yok | Kiracı takvimi; basit tarih listesi yeterli |
| İzin | Yok | `plan_times` bir `plan_type` alanı kazanır: `planned_work` / `leave` / `holiday`. İzin günü eksik sayılmaz |

Bunlar "Ayarlar › Organizasyon" bölümüne düşer ve küçük bir iştir. Kapasite yoksa efor şeridi
**dolum oranı göstermez**, yalnız "girildi / girilmedi" ikilisini gösterir — yani özellik kapasite
konfigü olmadan da çalışır, sadece zayıflar.

Geri kalan her şey mevcut verilerden: `work_logs` (efor), `work_items` (termin, durum, proje),
`meetings` (Graph senkronu), `plan_times` (planlı zaman).

---

## 9. İş yüzeyinin sıkışıklığı

Ana sayfa "şimdi ne" sorusunu çözüyor; iş yüzeyi hâlâ "her şey" ekranı ve bugün beş bağımsız
eksenle sıkışık (yerleşim × kapsam × tip × zaman aralığı × hızlı filtre).

**Hedef:** üç kalıcı eksen.

| Eksen | Nerede | Değerler |
|---|---|---|
| Görünüm | Sol kolon | Kayıtlı görünümler — sistem + kişisel |
| Gruplama | Üst çubuk, tek seçim | Proje · durum · sahip · termin |
| Yerleşim | Üst çubuk, tek seçim | Liste · pano · takvim |

Filtreler görünümün içine gömülür; çubukta ayrı eksen olarak durmaz. Kullanıcı filtre değiştirdiğinde
"yeni görünüm olarak kaydet" çıkar.

### 9.1 Görsel dil — hangi sinyal neyi taşır

Bugünkü kartta tip rengi, öncelik rengi ve durum aynı anda yarışıyor. Kural:

| Bilgi | Taşıyıcı | Gerekçe |
|---|---|---|
| **Durum** | Konum (pano sütunu / liste grubu) | Renk harcamaya değmez; zaten yerinden belli |
| **Termin** | Tek renkli sinyal — gecikmiş kırmızı, bugün amber, diğer nötr | En güçlü sinyal en acil bilgiye |
| **Öncelik** | Kart kenarında ince çubuk, renksiz kademe | İkincil; tek başına dikkat çekmemeli |
| **Tip** | Küçük metin etiketi | Filtre bilgisi, görsel gürültü değil |

Kuralın özeti: **bir kartta en fazla bir renkli sinyal, o da terminden gelir.**

### 9.2 "Pending / In Progress" ne kadar kullanılıyor

Bu, ölçülmeden karar verilecek bir şey değil. Rework öncesi tek bir sorgu yeterli: durum başına iş
sayısı ve durumda geçirilen ortalama süre. Sonuç iki şeyi belirler: varsayılan durum akışında kaç
adım olacağı ve panonun kaç sütunla açılacağı. Kiracı akışı konfigüre edebileceği için bu bir
varsayılan seçimidir, kalıcı bir kısıt değil.

---

## 10. Sıra

| Ne zaman | İş | Not |
|---|---|---|
| Rework'ten bağımsız | Kapasite ayarları + efor şeridi + eksik gün dürtmesi | `work_logs` yeterli; iş kalemi şemasına dokunmuyor |
| Rework'ten bağımsız | Ayarların tek çatı altına alınması | `03` §6 |
| Şema rework'ü sonrası | İşlerim bloğu, ekip bloğu, triage | Kova mantığı `owner` ve `state.category` ister |
| Arayüz fazıyla | Üç eksenli iş yüzeyi, kayıtlı görünümler, takvim yerleşimi | `01` F04 |

**Not:** efor şeridi ve eksik gün dürtmesi, tüm listedeki en yüksek fayda/maliyet oranına sahip iş —
mevcut veriyle çalışıyor, şemaya dokunmuyor ve doğrudan verinin eksiksizliğini artırıyor. Veri
eksiksizliği de para katmanının ön koşulu: girilmeyen saat faturalanamaz.
