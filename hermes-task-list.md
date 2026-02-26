# HERMES Projesi Geliştirme ve Hata Giderme Görevleri

## ⚠️ KRİTİK UYARI (SİSTEM DURUMU)
Bu uygulama şu anda aktif bir geliştirme (dev) ortamında kullanılmakta olup içerisinde gerçek/test verileri barındırmaktadır. 
**Kesin Kural:** Mevcut veritabanı kayıtlarını silecek, bozacak veya `null` referans hatalarına düşürecek hiçbir işlem yapılmamalıdır. Eski datalar olduğu gibi çalışmaya devam etmelidir.

---

## GÖREV 1: UI/UX Düzeltmesi - Duration Rengi
* **Sorun:** Süre (Duration) belirten metinlerin rengi şu an siyah. Koyu arkaplanda görünmez duruma düşüyor.
* **İstenen:** Bu alanların CSS/Tailwind sınıfları incelenerek renklerinin standart beyaz (`#FFFFFF` veya eşdeğeri) yapılması.

## GÖREV 2: Otomatik 'CODE' Üretimi (İsimden Koda)
* **Mevcut Durum:** Formlarda yer alan 'CODE' alanı kullanıcı tarafından manuel dolduruluyor.
* **İstenen:** 'CODE' alanı artık 'İsim' alanına girilen değere göre dinamik ve otomatik olarak üretilmeli.
* **Algoritma:**
    1. İsmin içindeki **sessiz harfler** sırasıyla bulunacak.
    2. İlk 3 sessiz harf alınarak büyük harfe çevrilecek (Örn: "Vakıfbank" -> "VKF").
    3. Eğer kelimenin içinde 3'ten az sessiz harf varsa, kelimenin ilk 3 harfi (sesli/sessiz fark etmeksizin) alınacak (Örn: "Ata" -> "ATA", "Ali" -> "ALI").
* **Kısıtlar:** Eski dataların `CODE` alanlarına dokunulmayacak. Bu işlem tercihen Frontend tarafında (kullanıcı ismi yazarken anlık olarak Code input'unun dolması şeklinde) yapılmalı ki kullanıcı isterse müdahale edebilsin ve backend yapısı zarar görmesin.

## GÖREV 3: Müşteri (Customer) Seçim Alanına Arama Filtresi
* **Sorun:** Project girişindeki Customer seçimi basit bir Dropdown/Select listesi. Müşteri sayısı arttığı için listeden bulmak imkansızlaşıyor.
* **İstenen:** Customer seçimi yapılan `select` elementinin "Arama yapılabilir" (Searchable Dropdown / Typeahead) bir yapıya dönüştürülmesi. Kullanıcı input'a yazı yazdıkça müşteri listesi filtrelenmeli.

## GÖREV 4: Time Entry Alanlarında İyileştirme
* **İstenen 1:** Time entry kısmında yer alan tüm seçim alanları (Dropdown'lar) default olarak **alfabetik sıralı** (A-Z) gelmeli.
* **İstenen 2:** Tıpkı 3. görevdeki gibi, bu alanların tamamına "Arama filtresi" eklenmeli (Searchable Dropdown).

## GÖREV 5: 'Log Another' Özelliği Bug Fix
* **Sorun:** Kullanıcılar ardışık kayıt girmek için 'Log another' seçeneğini kullandığında sistem kararsız çalışıyor. İki farklı hata gözlemlendi:
    1. Kayıt işlemi sırasında backend hatası fırlatması (Save fail).
    2. Kayıt başarılı olsa bile yeni, temiz bir kayıt ekranının açılmaması (UI/State fail).
* **İstenen:** Form submit işlemlerindeki state management, asenkron işlemler veya form reset fonksiyonları debug edilerek bu sorunun kökten çözülmesi. Kayıt atıldıktan sonra form başarıyla temizlenmeli ve yeni kayda hazır hale gelmeli.

## GÖREV 6: Reports (Raporlar) Ekranının Yeniden Tasarlanması (JIRA Mentality)
* **Mevcut Durum:** Seçime dayalı, muhtemelen sayfa yenilemesi gerektiren tekil bir raporlama var.
* **İstenen Yeni Yapı:** JIRA tarzı, anlık tepki veren bir "Dashboard/Filtreleme" sistemi.

## GÖREV 7: Contract Status (Sözleşme Durumu) Mantığının Yeniden Yapılandırılması
* **Mevcut Durum:** Contract süresi (kaç gün süreceği vb. optional alanlar) ve durumu yanlış bir mimariyle doğrudan `Customer` (Müşteri) nesnesine bağlanmış durumda.
* **İstenen Yeni Yapı:** Sözleşme süreleri ve durumları `Customer` yerine `Project` (Proje) nesnesine/tablosuna özgü olmalıdır. Bu alanlar proje oluşturulurken/düzenlenirken **optional (isteğe bağlı)** olarak girilebilmelidir.
* **Liste Görünümü (UI İsteri):** Contract'ların veya projelerin listelendiği ekranda, hangi projenin hangi müşteriye ait olduğunu netleştirmek için tablo kolonları şu sırayla gösterilmelidir:
  1. Customer (Müşteri Adı)
  2. Project (Proje Adı)
  3. Status (Sözleşme/Proje Durumu)
  4. Remaining Time (Kalan Süre)
  5. End Date (Bitiş Tarihi)
* **Kritik Veritabanı Kuralı:** Sistem canlıda olduğu için bu mimari değişikliği yaparken mevcut veriler asla uçurulmamalıdır. Eğer `Customer` tablosunda halihazırda girilmiş contract verileri varsa, bu veriler ilgili müşterinin mevcut projelerine `migration` veya özel bir script ile zarar vermeden aktarılmalı (veya eski yapı salt okunur tutularak yeni yapı `Project` üzerinden inşa edilmeli). Eski datayı silecek herhangi bir "Drop Column" işlemi **yapılmamalıdır**.

* **Detaylar:**
    1. **Çoklu Seçim (Multi-Select):** Artık örneğin tek bir User değil, checkbox/tag mantığı ile birden fazla User aynı anda seçilebilmeli (Örn: "Ahmet, Mehmet ve Ayşe'nin verilerini getir").
    2. **Anlık Yansıma (Real-time Filtering):** Kullanıcı filtreyi değiştirdiği an (örneğin yeni bir user eklediğinde veya tarih aralığını değiştirdiğinde), sayfa yenilenmeden asenkron (AJAX/Fetch/Axios vb.) olarak veriler çekilmeli ve ekrandaki grafiklere/tablolara yansımalı.
    3. **Performans:** Çoklu seçim yapıldığında veritabanına giden sorguların (LINQ/SQL) `IN` veya `Contains` metodlarıyla optimize edilmesi (Örn: `WHERE UserId IN (1, 2, 3)`).