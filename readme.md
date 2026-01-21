Ürün Gereksinim Dokümanı (PRD): Hermes Platformu v1.0
Sürüm: 1.0 (MVP) Tarih: 4 Kasım 2025
1. Giriş ve Amaç
Problem: Ekip tarafından farklı müşteriler ve projeler için yapılan işlerin takibi, merkezi olmayan ve raporlanamayan bir yapıda (örn. Excel, e-posta) tutulmaktadır. Hangi projeye/müşteriye ne kadar efor harcandığını toplu olarak görmek ve temel düzeyde raporlamak mümkün değildir.
v1.0 Çözümü: Bu versiyonun (MVP) tek amacı, "yapılan işlerin" (zaman girişleri / timesheet) merkezi bir sisteme, standart bir veri yapısıyla girilmesini sağlamak ve bu verileri temel düzeyde raporlamaktır.
2. Üst Düzey Hedefler (v1.0)
1.	Yapılan tüm iş (zaman) girişlerini tek bir veritabanında toplamak.
2.	Yöneticilerin (Admin) sistemi yapılandırabilmesi (Müşteri, Proje listeleri vb.) için basit bir panel sunmak.
3.	Standart kullanıcıların sadece zaman girişi yapabilmesini sağlamak.
4.	Son bir aya ait zaman girişlerinin Excel dökümünü alabilmek.
5.	Girilen zaman verilerini basit bir görsel panelde özetlemek.
3. Kullanıcı Personaları (v1.0)
Bu versiyonda, önceki analizlerden [cf: user] farklı olarak, yalnızca iki basit rol vardır [user input]:
●	Admin User (Yönetici): "Workspace Konfigürasyonu" yapar [user input]. Kullanıcıları yönetir. Tüm zaman girişlerini görür ve raporlar.
●	Standart Kullanıcı: Sisteme giriş yapar ve yalnızca "yapılan iş girdisi" (zaman girişi) yapabilir [user input].
4. Fonksiyonel Gereksinimler (FR)
FR 1.0: Kimlik Doğrulama (Authentication)
●	FR 1.1: Standart Auth: Kullanıcılar e-posta ve şifre ile sisteme giriş yapabilmelidir. Gelişmiş rol bazlı (role-based) bir sistem v1'de olmayacaktır [user input].
●	FR 1.2: İkili Rol: Sistem, bir kullanıcının "Admin" mi yoksa "Standart Kullanıcı" mı olduğunu (basit bir boolean/flag ile) ayırt etmelidir.
FR 2.0: Zaman Girişi (Yapılan İşler) - Standart Kullanıcı
●	FR 2.1: Zaman Girişi Arayüzü: Standart Kullanıcının ana ekranı, yeni bir zaman girişi yapabileceği ve geçmiş girişlerini listeleyebileceği basit bir form olmalıdır.
●	FR 2.2: Zaman Girişi Veri Modeli: "Yapılan İş" (Work Log) kaydı, aşağıdaki alanları zorunlu olarak içermelidir [user input]:
○	Müşteri: Admin'in FR 3.1'de oluşturduğu listeden seçim (Dropdown).
○	İş Tipi: Admin'in FR 3.2'de oluşturduğu listeden seçim (Dropdown).
○	Yapıldığı Tarih: Tarih seçici (Date picker).
○	Süresi: Sayısal giriş (örn. 2.5 saat).
○	Açıklama: Çok satırlı metin alanı (Text area).
○	İşi Giren Kişi: Sisteme giriş yapan kullanıcı (Otomatik olarak atanır).
○	Ürün ya da Proje: Admin'in FR 3.3'te oluşturduğu listeden seçim (Dropdown).
FR 3.0: Workspace Konfigürasyonu - Admin User
Admin User, Standart Kullanıcıların FR 2.2'de seçeceği veri listelerini yönetebilmelidir.
●	FR 3.1: Müşteri Yönetimi (CRUD): Admin, sisteme yeni "Müşteri" kayıtları ekleyebilmeli, düzenleyebilmeli ve silebilmelidir (CRUD) [user input].
●	FR 3.2: İş Tipi Yönetimi (CRUD): Admin, "İş Tipi" (örn. "Geliştirme", "Toplantı", "Destek") tanımları ekleyebilmeli, düzenleyebilmeli ve silebilmelidir [user input].
●	FR 3.3: Ürün/Proje Yönetimi (CRUD): Admin, "Ürün ya da Proje" (örn. "X Projesi", "Y Ürünü Bakımı") kayıtları ekleyebilmeli, düzenleyebilmeli ve silebilmelidir [user input].
●	FR 3.4: Kullanıcı Yönetimi (CRUD): Admin, yeni kullanıcıları davet edebilmeli ("Standart Kullanıcı" olarak) veya mevcut kullanıcıları pasife alabilmelidir.
FR 4.0: Aylık Raporlama (Excel) - Admin User
●	FR 4.1: Raporlama Arayüzü: Admin panelinde basit bir raporlama ekranı olmalıdır.
●	FR 4.2: Filtreleme: Bu ekran, "Son 1 Ay" [user input] veya basit bir tarih aralığı (Başlangıç/Bitiş) seçimine izin vermelidir.
●	FR 4.3: Excel Çıktısı: Filtrelenen sonuçlar, FR 2.2'deki tüm alanları (Müşteri, İş Tipi, Tarih, Süre, Açıklama, Kişi, Proje) içeren bir Excel dosyası olarak dışa aktarılabilmelidir [user input].
FR 5.0: Görselleştirme Paneli (Dashboard) - Admin User
●	FR 5.1: Temel Dashboard: Admin panelinde, girilen zaman verilerini özetleyen basit bir görsel panel sunulmalıdır [user input].
●	FR 5.2: Önerilen Widget'lar (v1): Bu panel, en azından şunları göstermelidir (orijinal dokümandaki dashboard fikrinin basitleştirilmiş hali):
○	Toplam Harcanan Süre (KPI Sayacı).
○	Müşterilere Göre Süre Dağılımı (Pasta veya Çubuk Grafik).
○	Projelere/Ürünlere Göre Süre Dağılımı (Pasta veya Çubuk Grafik).
○	Kullanıcılara Göre Süre Dağılımı (Çubuk Grafik).
5. Kapsam Dışı (v1.0 için)
Aşağıdaki özellikler, önceki analiz dokümanında yer alsa da, v1.0 MVP kapsamı dışındadır:
●	Gelişmiş RBAC: "Proje Lideri", "Geliştirici" gibi özelleştirilebilir roller [user input], proje bazlı yetkilendirme [user input], izin devri [user input].
●	Finansal Takip: Kârlılık (Profitability) , Bütçe takibi, Maliyet Oranları (Cost Rate), Fatura Oranları (Bill Rate).
●	"Faturalandırılabilir" (Billable) Etiketi: Zaman girişlerindeki "Billable / Non-Billable" ayrımı.
●	Hibrit Model: "Projeler" (PSA) ve "Hizmet Masaları" (ITSM) ayrımı.
●	SLA Yönetimi: Destek talepleri için SLA takibi .
●	Bilgi Bankası (Wiki): Gömülü veya entegre Wiki sistemi .
●	Kaynak Planlama: İş Yükü (Workload) veya Kaynak Tahminlemesi (Forecasting).
●	Entegrasyonlar: CRM, Faturalandırma veya Muhasebe entegrasyonları.
 
Ürün Gereksinim Dokümanı (PRD): Hermes Platformu v2.0
Sürüm: 2.0 Tarih: 4 Kasım 2025 İlgili Kişiler: (Proje Yöneticisi, Geliştirme Ekibi, Finans Ekibi Temsilcisi)
1. Giriş ve v2 Hedefleri
v1.0 Özeti: v1.0 (MVP), çalışanların yaptıkları işleri (zaman girişlerini) standart bir formatta (Müşteri, Proje, İş Tipi vb. seçerek) [user input in previous turn] merkezi bir sisteme kaydetmesini sağladı. Yöneticiler için temel bir Excel çıktısı [user input in previous turn] ve basit bir görselleştirme paneli [user input in previous turn] sundu.
v2.0 Amacı: v1.0'da topladığımız ham zaman verisini, operasyonel ve yönetsel "bilgiye" dönüştürmektir. v2.0'ın odak noktası, finansal kâr hesabı (v3 sonrasına ertelendi) [user input] değil, verinin "faturalandırılabilirlik" ve "verimlilik" ekseninde organize edilmesidir.
v2.0'ın iki temel hedefi vardır [user input]:
1.	Faturalandırma Odaklı Raporlama: Finans ekibinin [user input in previous turn] müşterilere ne kadarlık faturalandırılabilir iş yapıldığını kolayca görmesini sağlamak [user input].
2.	Çalışan Verimliliği Raporlaması: Yöneticilerin, ekibin toplam zamanının yüzde kaçını faturalandırılabilir işlere harcadığını (verimlilik oranı) ölçmesini sağlamak [user input].
Bu hedefleri desteklemek için, v2.0 ayrıca gelişmiş bir yetkilendirme sistemi (RBAC) ve proje bazlı bir bilgi bankası (Wiki) sunacaktır [user input].
2. Kullanıcı Personaları (v2.0)
v1.0'daki basit "Admin" ve "Standart Kullanıcı" [user input in previous turn] rolleri, v2.0'da aşağıdaki gibi gelişecektir:
●	Admin User (Yönetici): Sistemin genel konfigürasyonunu (roller, izinler, global listeler) yapar. Tüm raporlara erişir.
●	Proje Lideri (PL) (Yeni Rol): Belirli projelerden sorumludur. Kendi projelerine ait zaman girişlerinin "faturalandırılabilir" durumunu onaylar/değiştirir [user input]. Proje wiki'lerini yönetir [user input]. Kendi ekibinin verimliliğini izler.
●	Standart Kullanıcı (Geliştirici/Danışman): Ana görevi v1.0'daki gibi zaman girişi yapmaktır [user input in previous turn]. Artık bir işin "billable" olup olmadığını düşünmek zorunda değildir [user input]. Proje wiki'lerini okur.
●	Finans Kullanıcısı (Stakeholder): Sistemi aktif olarak kullanmaz, ancak faturalandırma için FR 2.1'de tanımlanan Excel raporunun ana tüketicisidir [user input].
3. Fonksiyonel Gereksinimler (FR)
FR 1.0: "Faturalandırılabilirlik" (Billability) Altyapısı
Hedef: Bir zaman girişinin "faturalandırılabilir" olup olmadığını, çalışana sormadan [user input], sistemin akıllıca belirlemesi ve yöneticinin onaylaması.
●	FR 1.1: Otomatik "Billable" Atama Mantığı:
○	Yönetici (Admin), v1'de [user input in previous turn] oluşturduğu "İş Tipi" kayıtlarını düzenlerken ("Geliştirme", "İç Toplantı" vb.) her birine "Varsayılan Olarak Faturalandırılabilir mi?" (Evet/Hayır) bayrağı ekleyebilmelidir [user input].
○	Yönetici (Admin), v1'de [user input in previous turn] oluşturduğu "Proje" kayıtlarının her zaman varsayılan olarak "Faturalandırılabilir" olacağı sistemsel olarak tanımlanmalıdır [user input].
○	Standart Kullanıcı, v1'deki [user input in previous turn] zaman giriş formunu doldururken, sistem girilen kaydın "Billable" durumunu (Proje ise Evet, değilse İş Tipine bakarak) arka planda otomatik olarak atamalıdır.
●	FR 1.2: Manuel Onay/Değişiklik Ekranı (PL / Admin):
○	Proje Liderleri ve Adminler için "Zaman Girişi Onay" adında yeni bir ekran oluşturulmalıdır.
○	Bu ekran, girilen zaman kayıtlarını (proje, kişi, tarih bazlı filtreleyerek) listelemelidir.
○	Kullanıcı (PL/Admin), bu ekranda sistemin (FR 1.1) otomatik atadığı "Faturalandırılabilir" (Evet/Hayır) durumunu manuel olarak değiştirebilmelidir (override) [user input].
FR 2.0: Hedef 1 - Faturalandırma Raporlaması
Hedef: Finans ekibine [user input in previous turn] ve yöneticilere, müşterilere fatura edilecek iş dökümünü net bir şekilde sunmak [user input].
●	FR 2.1: Gelişmiş Rapor (Excel) - Faturalandırılabilir İş Dökümü:
○	v1'deki [user input in previous turn] Excel raporlama [user input in previous turn] ekranı geliştirilmelidir.
○	Kullanıcı (Admin/PL/Finans), raporu alırken şu filtrelere sahip olmalıdır:
■	Tarih Aralığı
■	Müşteri (Bir veya birden fazla)
■	Sadece "Faturalandırılabilir = Evet" olan kayıtları göster.
○	Çıktı, müşteriye göre gruplanmış, fatura kesmeye hazır bir iş dökümü sağlamalıdır [user input].
●	FR 2.2: Görselleştirme Paneli (Faturalandırma Odaklı):
○	v1'deki [user input in previous turn] görselleştirme paneli [user input], "Faturalandırma" sekmesi ile zenginleştirilmelidir.
○	Bu panel, FR 1.1 ve 1.2'den gelen verilerle en az şu widget'ları göstermelidir:
■	"Müşteri Bazlı Faturalandırılabilir Saat Dağılımı" (Pasta Grafik) [user input].
■	"Proje Bazlı Faturalandırılabilir Saat Dağılımı" (Çubuk Grafik) [user input].
FR 3.0: Hedef 2 - Çalışan Verimliliği Raporlaması
Hedef: Ekibin ve bireylerin zamanını ne kadar verimli (faturalandırılabilir işlere odaklı) kullandığını ölçmek [user input].
●	FR 3.1: Rapor (Excel) - Çalışan Verimlilik Karnesi:
○	Yeni bir Excel rapor şablonu oluşturulmalıdır.
○	Bu rapor, seçilen tarih aralığında her çalışan için şu satırları göstermelidir:
■	Toplam Çalışma Saati
■	Toplam Faturalandırılabilir Saat
■	Toplam Faturalandırılamaz Saat
■	Verimlilik Oranı (%) (= Faturalandırılabilir Saat / Toplam Saat) [user input].
●	FR 3.2: Görselleştirme Paneli (Verimlilik Odaklı):
○	v1'deki [user input in previous turn] görselleştirme paneline [user input in previous turn] "Verimlilik" sekmesi eklenmelidir.
○	Bu panel en az şu widget'ları göstermelidir:
■	"Genel Ekip Verimlilik Oranı (%)" (KPI Göstergesi) [user input].
■	"Çalışan Bazlı Verimlilik Oranları" (Çubuk Grafik) [user input].
■	"Genel Faturalandırılabilir / Faturalandırılamaz Saat Dağılımı" (Pasta Grafik) [user input].
FR 4.0: Gelişmiş Yetkilendirme (RBAC)
Hedef: FR 1.2 (Onay) ve FR 5.0 (Wiki) gibi özellikleri desteklemek için v1'deki [user input in previous turn] basit rol modelinden esnek bir RBAC sistemine geçmek.
●	FR 4.1: Özelleştirilebilir Rol Yönetimi (Admin Paneli):
○	Admin, sistemde "Proje Lideri", "Geliştirici", "Finans Okuyucu" gibi yeni roller oluşturabilmelidir [user input].
●	FR 4.2: İzin (Permission) Yönetimi (Admin Paneli):
○	Admin, bu rollere zaman_girişi_onayla (FR 1.2 için), wiki_düzenle (FR 5.3 için), verimlilik_raporu_gör (FR 3.0 için) gibi atomik izinler atayabilmelidir.
●	FR 4.3: Proje Bazlı (Bağlamsal) Rol Ataması:
○	Sistem, bir kullanıcının farklı projelerde farklı rollere sahip olmasını desteklemelidir (örn. Kullanıcı A, Proje X'te "Proje Lideri" iken Proje Y'de "Geliştirici" olabilir) [user input].
○	Bu, Proje Liderinin sadece kendi projesinin zaman girişlerini (FR 1.2) onaylayabilmesi ve sadece kendi projesinin wiki'sini (FR 5.3) düzenleyebilmesi için kritiktir.
FR 5.0: Proje Bazlı Wiki Sistemi
Hedef: Proje bilgilerini merkezileştirmek ve dağınıklığı önlemek.
●	FR 5.1: Gömülü (Native) Wiki Arayüzü:
○	v1'de [user input in previous turn] oluşturulan her "Proje" kaydının detay sayfasına "Wiki" adında yeni bir sekme eklenmelidir [user input].
●	FR 5.2: Hiyerarşik Sayfa Yönetimi:
○	Bu Wiki sekmesi, kullanıcıların ana sayfalar ve bu sayfaların altına iç içe geçmiş (nested) alt sayfalar oluşturmasına (Notion/Confluence benzeri) izin vermelidir [user input].
●	FR 5.3: Wiki Yetkilendirmesi (RBAC ile):
○	Bir projenin wiki'sini düzenleme veya sadece okuma yetkisi, FR 4.0'da tanımlanan RBAC sistemine (örn. "Proje Lideri" düzenler, "Geliştirici" okur) bağlı olmalıdır [user input].
4. Kapsam Dışı (v2.0 için)
Aşağıdaki özellikler, önceki konuşmalarda analiz edilmiş ancak stratejik olarak v3 ve sonrasına ertelenmiştir:
●	Finansal Oran Yönetimi: Çalışan Saatlik Maliyeti (Cost Rate) ve Müşteri Saatlik Fatura Oranı (Bill Rate) tanımları [user input].
●	Proje Bütçe Yönetimi: Projelere parasal veya saatlik bütçe atanması [user input].
●	Kâr Marjı Raporlaması: (Yukarıdaki iki madde ertelendiği için otomatik olarak kapsam dışıdır).
●	Proje Yönetimi (PM) Modülü: Görev (Task) Yönetimi, Kanban Panoları, Zaman Çizelgeleri (Gantt) [user input].
●	Hizmet Yönetimi (ITSM) Modülü: Talep (Ticket) Yönetimi, SLA Takibi [user input].
●	Faturalandırma Entegrasyonları: Muhasebe yazılımlarına otomatik veri aktarımı [user input in previous turn].

