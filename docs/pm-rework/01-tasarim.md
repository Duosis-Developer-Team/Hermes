# Hermes — İş Kalemi Modülü Tasarım Dokümanı

## 1. Bu doküman ne için var

Hermes'in "task management" olarak anılan modülü yeniden tasarlanıyor. Bu doküman **neden** yeniden
tasarlandığını, **neye** dönüştüğünü ve **hangi sırayla** ilerleneceğini iş ve teknik tarafta birlikte
anlatır. Şema ayrıntıları ayrı dokümanda (`02-sema.md`); konumlandırma tartışması ve teşhis kanıtları
`00-konumlandirma-ve-hedef-model.md` dosyasında.

Hedef okur: ürün kararını verecek yönetim ve işi yapacak geliştirici. İkisi de aynı belgeyi okur;
bölümler iş → teknik sırasıyla ilerler.

## 2. İş tarafı — neden dokunuyoruz

### 2.1 Ürün kimliği ne söylüyor

Hermes'in kimliği strateji dokümanlarında sabitlendi: **faturalandırılabilir iş yönetimi**, vaadi
**"saatten faturaya"**. Ürün açıkça proje yönetimi ya da görev yönetimi olarak konumlanmıyor. Bunun
modül için anlamı nettir: buradaki nesnenin işi Jira'ya benzemek değil, **saatin bağlanacağı ve
faturanın türeyeceği iş kalemini tutmaktır.**

Rakip analizi, "iş takibi ve zaman aynı üründe" olmasını Hermes'in bugün gerçek olan üç üstünlüğünden
biri sayıyor — Harvest ve Toggl bunu yapmıyor, müşteriler o yüzden Jira/Asana ile birlikte kullanmak
zorunda kalıyor. Yani modül bir yük değil, **satış argümanı**. Sorun argümanda değil, argümanı taşıyan
şemada.

### 2.2 Bugün ne bozuk

Modül bugün bir iş kalemi tutmuyor; **bir delegasyon kaydı** tutuyor. Veritabanında bir task, atayan
ile atanan arasındaki bir ilişki olarak var oluyor ve bu üç somut soruna yol açıyor:

1. **Aynı iş birden çok kişiye verildiğinde iş çoğalıyor.** Üç kişiye verilen tek iş, veritabanında üç
   ayrı kayıt oluyor. Tek işmiş gibi görünmesi tarayıcıda sonradan hesaplanıyor. Rapor, sayım ve
   sayfalama bu yüzden güvenilir değil.
2. **Proje ekibi projenin işini göremiyor.** Görünürlük "sana atandı mı / sen mi atadın" kuralına bağlı.
   Dolayısıyla proje bir kapsayıcı değil, sadece bir etiket. Bir iş devredildiğinde önceki kişi tüm
   bağlamı kaybediyor.
3. **Paranın tutunacağı yer yok.** Öncelik sırasındaki ilk madde para katmanı (ücret oranı → tutar →
   kârlılık). Bunlar iş kalemine bağlanacak; bugünkü iş kalemi ise bir ilişki kaydı ve kopyalar hâlinde.

Buna dördüncü bir sorun eşlik ediyor: üründe birbirinden habersiz **dört ayrı iş nesnesi** var
(`issues`, `tasks`, `tickets`, `plan_times`) ve strateji dokümanının "tek omurga" dediği zincir —
talep → faturalandırılabilir iş → fatura — kodda hiç kurulu değil.

### 2.3 Dokunmazsak ne olur

- **Para katmanı iki kez yazılır.** Kârlılık ve verimlilik ekranları iş kalemine bağlanacak; bozuk
  nesnenin üstüne kurulursa şema düzeltildiğinde ikinci kez yazılır.
- **MSP nişi açılamaz.** MSP dilinde ana nesne "iş emri / SLA'lı ticket". Aynı nesnenin iki dilde
  görünebilmesi, durum akışının konfigüre edilebilir olmasını gerektiriyor; bugünkü sabit durum listesi
  buna izin vermiyor.
- **Dış pilot riskli kalır.** Ürün dış pilota hazır durumda; en çok kullanılan ekranın altındaki model
  ise ölçeklenme varsayımı bozuk (liste ucu sayfalamaya geçtiği gün gruplama geçersizleşiyor).

### 2.4 Ne kazanıyoruz

| Kazanım | İş karşılığı |
|---|---|
| İş kalemi gerçek bir nesne olur | Çoklu atama tek iş olarak görünür; rapor ve sayım güvenilir hale gelir |
| Görünürlük projeye bağlanır | Ekip projenin işini görür; devir bağlam kaybettirmez |
| Durum akışı konfigüre edilebilir | Tek kod tabanı üstünde MSP modu / Ajans modu mümkün olur |
| Para alanları iş kalemine iner | Kârlılık ve verimlilik ekranı tek kaynaktan beslenir |
| Talep → iş → saat zinciri kurulur | Ticket'tan doğan iş izlenebilir; "yapılan ama faturalanmayan iş" görünür olur |

## 3. Ürün yönü — neye dönüşüyor

### 3.1 Tek cümle

> İş kalemi bir nesnedir. Bir projeye aittir. Kişiler ona atanır. Bir talepten doğabilir. Saat ona
> yazılır, fatura ondan türer.

### 3.2 Kavram haritası

| Kavram | Bugün | Hedef |
|---|---|---|
| İş kalemi | Atayan–atanan ilişkisi | Projeye ait bağımsız nesne |
| Çoklu atama | Aynı işin kopyaları | Tek iş, çok katılımcı satırı |
| Sahiplik | Zorunlu tek atanan | Tek sorumlu (owner), boş olabilir → triage kuyruğu |
| Görünürlük | Kişi grafiği | Proje üyeliği |
| Atama hiyerarşisi | Görünürlüğün kaynağı | Yönlendirme politikası (kim kime iş verebilir) |
| Durum | Sabit liste | Tenant'ın tanımladığı akış, sabit dört kategoriye eşlenir |
| Hiyerarşi | Müşteri/proje/alt-proje klasörü | İş kaleminin kendi ana–alt ilişkisi (iki seviye) |
| Ekran durumu | Beş bağımsız filtre ekseni | Kaydedilebilir ve paylaşılabilir görünüm (view) |

### 3.3 Profil katmanı — iki niş, tek ürün

Strateji kararı tek kod tabanı ve iki konumlandırmadır. Modülde bunun karşılığı ince bir dil ve
varsayılan katmanıdır; motor aynıdır.

| Kavram | MSP modu | Ajans modu |
|---|---|---|
| Nesnenin adı | İş emri / ticket | İş kalemi / görev |
| Varsayılan görünüm | Kuyruk ve ilk yanıt süresi | Proje panosu ve termin |
| Detayda öne çıkan | Talep kaynağı, çözüm | Faturalandırılabilir saat, tutar |
| Ana metrik | Çözüm süresi | Verimlilik ve kârlılık |

Bu katmanın çalışabilmesi, durum akışının veriden gelmesine bağlıdır. Sabit durum listesiyle profil
anahtarı kurulamaz — mimari karar doğrudan şemaya dayanıyor.

### 3.4 Arayüz yönü

Tek omurga: **proje çalışma alanı.** Sol kolonda gezinme ve kayıtlı görünümler, ortada seçili görünüm,
sağda iş kalemi detayı.

- **Ekranın durumu = seçili görünüm.** Filtre değiştiğinde "yeni görünüm olarak kaydet" önerilir.
  Görünüm linklenebilir ve paylaşılabilir.
- Bugünkü beş eksen (yerleşim × kapsam × tip × zaman aralığı × hızlı filtre) tek bir görünüm kavramına
  toplanır.
- **Triage** kalıcı bir kuyruktur: sahibi olmayan işler burada birikir, kaybolmaz.
- İş kalemi detayı bir paneldir ama kendi adresiyle açılabilir (`/work/PROJ-142`) — bugün bir işe link
  verilemiyor.
- Detayda para bloğu birinci sınıftır: tahmin, girilen saat, faturalandırılabilir saat, tutar, kalan.

## 4. Kapsam — nereye kadar

Vizyon dokümanı "gantt, bağımlılık, sprint" üçünü tek maddede reddediyor. Bunlar maliyet ve risk olarak
farklı şeyler; kademelendirildi.

| Yetenek | Karar | Gerekçe |
|---|---|---|
| Bağımlılık bağı | Evet — görsel ve filtrelenebilir, otomatik tarih etkisi yok | Şema maliyeti sıfır; iki nişte de gerçek ihtiyaç |
| Read-only zaman şeridi | Evet — arayüz fazında | Tarih çizmek gantt değildir; sürükle-bırak yoksa motor da yok |
| İnteraktif gantt, kritik yol | Hayır | Karşılaştırma ekseni Monday/MS Project'e kayar; o eksende parite yok |
| Sprint, velocity, story point | Hayır | İkinci bir zaman para birimi yaratır; saat–tutar hikâyesini bulanıklaştırır |
| Kaynak planlama, forecasting | Hayır | Kapsam ve kapasite |
| Custom field builder, otomasyon motoru | Hayır | Konfigürasyon yüzeyini patlatır |
| Wiki | Ayrı iş | PRD v2 kapsamı; bu rework'ün parçası değil |

**Bağımlılığın sınırı yazılıdır:** bağ görsel ve filtrelenebilir; hiçbir otomatik tarih kaydırması yok.
Bu sınır konmazsa iki günlük iş, gantt motorunu (lag/lead, kısıt tipleri, çalışma takvimi) çağırır.

**Kapı açık kalıyor:** bağ tablosunun tip alanı genel, `start_date` ve `due_date` ikisi de duruyor,
ana–alt ilişkisi var. Yarın zaman şeridi ya da bağımlılık görselleştirmesi istenirse **migration
gerekmez**.

## 5. Sıralama — ne zaman

Strateji dokümanının öncelik sırası: **1) para katmanı, 2) e-fatura, 3) timer, 4) verimlilik/kârlılık
ekranı, 5) çok-kiracılık** (sonuncusu tamamlandı). Bu rework o listede yok ve kendini listenin önüne
koyamaz.

Çözüm rework'ü ikiye bölmektir:

| | Kapsam | Ne zaman | Neden |
|---|---|---|---|
| **A — Şema** | Nesne, katılımcı, durum, yönlendirme, talep bağı | Para katmanından **önce** | Paranın tutunacağı nesneyi kurar; bir kez yazılır |
| **B — Arayüz** | Çalışma alanı, kayıtlı görünümler, profil katmanı | Para ve e-fatura **sonrası** | O ekran zaten tutar/kârlılık/timer için yeniden çizilecek |

Özet: **şemayı şimdi düzelt, ekranı para geldiğinde bir kere çiz.** A paketi küçüktür ve öncelik
sırasını geciktirmez; B paketi zaten yapılacak işin içine girer.

### Fazlar

| Faz | İş | Paket |
|---|---|---|
| F00 | Kararların kapatılması, şema dokümanının dondurulması | — |
| F01 | Yeni şema ve tek seferlik veri taşıma | A |
| F02 | Görünürlüğün proje üyeliğine çevrilmesi, yönlendirme politikasının ayrılması | A |
| F03 | `issues` birleştirmesi, ticket → iş kalemi bağı | A |
| F04 | Çalışma alanı, kayıtlı görünümler, profil katmanı | B |
| F05 | Eski tabloların kaldırılması | B sonrası |

## 6. Riskler

| Risk | Etki | Azaltım |
|---|---|---|
| **Public API ve MCP sözleşmesi** | Dışa açık uçlar ve 24 MCP aracının 6 yazma aracı doğrudan eski task şeklini konuşuyor. Bu katman rakip analizinde ürünün nadir üstünlüğü sayılıyor; kırmak satış argümanını kırmaktır | F01–F03 boyunca `/v1` uyumluluk katmanı zorunlu; MCP uyumluluk matrisi yeniden koşulur |
| Veri kaybı algısı | Taşıma sırasında "işim kayboldu" şikâyeti | Taşıma tahmine dayanmıyor; toplu atama kimliği kalıcı ve kesin. Görünürlük geçişinde mevcut atayan ve atananlar projeye üye yazılır |
| Migration sırası | Sıra bağımlı migration dosyaları | Bu fazlarda paralel ajan migration yazmaz (depo kuralı) |
| Kapasite | Dört kişilik ekip, "her şey aracı" tuzağı | A/B bölmesi tam olarak bu uyarıya cevap |
| Kapsam sızıntısı | Bağımlılıktan gantt'a kayma | Sınır bu dokümanda yazılı; bağ pasif |

## 7. Başarı ölçütleri

Rework "bitti" sayılır ancak şunlar doğruysa:

1. Üç kişiye atanan bir iş, veritabanında **tek** kayıttır ve arayüzde tek iş olarak görünür.
2. Proje üyesi, kendisine atanmamış bir projeyi ve işlerini görebilir; atama değişince kimse bağlam kaybetmez.
3. Sahibi olmayan iş kaybolmaz; triage kuyruğunda durur.
4. Bir tenant kendi durum akışını tanımlayabilir ve pano sütunları buna göre değişir.
5. Bir iş kaleminin tahmin / girilen saat / faturalandırılabilir saat değerleri tek yerden okunur ve
   proje toplamına eşittir.
6. Bir ticket'tan doğan iş, kaynağıyla birlikte izlenebilir.
7. `/v1` API ve MCP araçları, taşıma sonrası davranış değiştirmeden çalışmaya devam eder.

## 8. Kapatılacak kararlar

| # | Karar | Öneri |
|---|---|---|
| 1 | Sahiplik: tek sorumlu + katılımcılar mı, tamamen çoklu atanan mı | Tek sorumlu; grup ihtiyacı katılımcı ile karşılanır |
| 2 | Alt proje: proje ağacının seviyesi mi, iş kaleminin altı mı | İş kaleminin altı; proje ağacı müşteri → proje ile biter |
| 3 | Faturalandırılabilirlik varsayılanı nerede yaşar | İş kaleminde varsayılan, zaman kaydında override |
| 4 | A/B bölmesi kabul mü | Evet — rework'ün başlangıcını belirleyen tek karar |
