# Hermes — Geliştirme Kapsamı (toplu doküman)

Bu dosya, iş kalemi rework'ü çevresinde konuşulan **bütün geliştirmeleri tek yerde** toplar:
her kalemin kapsamı, kapsam dışı bıraktığı şey, bağımlılığı, fazı ve "bitti" ölçütü.

Ayrıntı için diğer dosyalar; bu dosya **karar ve kapsam** dosyasıdır.

| Dosya | Ne anlatır |
|---|---|
| `00-konumlandirma-ve-hedef-model.md` | Kimlik, sektörel karşılık, teşhis, hedef model |
| `01-tasarim.md` | İş gerekçesi, ürün yönü, başarı ölçütleri |
| `02-sema.md` | Hedef veri modeli, kısıtlar, veri taşıma, API etkisi |
| `03-yetenekler-ve-mimari.md` | Beş mimari katman, yetenek haritası |
| `04-roller-ve-ana-sayfa.md` | Persona, ana sayfa blokları, uyarı kuralları, iş yüzeyi |
| **`05-gelistirme-kapsami.md`** | **Bu dosya — toplu kapsam ve faz planı** |

---

## 1. Çerçeve

**Kimlik kilidi:** Hermes faturalandırılabilir iş yönetimidir; proje yönetimi ya da görev yönetimi
değildir. Buradaki hiçbir kalem bu çizgiyi geçmez.

**Öncelik kilidi:** stratejinin sırası para katmanı → e-fatura → timer → kârlılık ekranı. Bu
dokümandaki işler o sıranın **yerine geçmez**; yanında ilerler ve büyük kısmı o sıranın ön koşulunu
güçlendirir.

**Rework'ün bölünmesi:** şema işi para katmanından **önce** (paranın tutunacağı nesneyi kurar),
arayüz işi para ve e-fatura **sonrasında** (o ekran zaten yeniden çizilecek).

---

## 2. Faz özeti

| Faz | Adı | İçerik | Şemaya dokunur mu |
|---|---|---|---|
| **P0** | Bağımsız kazanımlar | Ayarların birleştirilmesi · kapasite · efor şeridi · durum ölçümü | Hayır (kapasite hariç, o da küçük) |
| **P1** | Şema rework'ü | İş kalemi nesnesi, katılımcı, durum akışı, görünürlük, yönlendirme, birleştirmeler | Evet |
| **P2** | Nesneye tutunanlar | Ek dosya · uygulama içi bildirim · proje ayarları sayfası | Ek tablolar |
| **P3** | Arayüz | Ana sayfa blokları · üç eksenli iş yüzeyi · kayıtlı görünümler · takvim | Hayır |

P0 bugün başlayabilir. P1 tenant cutover kapandıktan sonra. P3 para katmanı ve e-fatura sonrası.

---

## 3. Geliştirme kalemleri

### A · Şema rework'ü (P1)

| Kod | İş | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|
| A1 | İş kalemi nesnesi + katılımcılar | `work_items`, `work_item_participants`; toplu atamanın tek işe taşınması | Çoklu sahiplik; sahiplik devir geçmişi | Üç kişiye atanmış iş tek satır; arayüzde tek iş |
| A2 | Konfigüre edilebilir durum akışı | `workflow_states`, dört kategori, kiracı başına tek şema | Proje bazlı ayrı şema; durum bazlı otomasyon | Kiracı durum ekler, pano sütunu değişir, rapor kategoriden doğru çalışır |
| A3 | Görünürlük proje üyeliğine | `project_memberships` kullanımı, backfill | Alan bazlı gizlilik; kayıt bazlı paylaşım | Taşıma sonrası hiçbir kullanıcının görünürlüğü daralmaz |
| A4 | Yönlendirme politikasının ayrılması | `routing_relations`; yalnız atama kararı | Görünürlük kararı vermesi | Atama hiyerarşisi görünürlüğü etkilemez |
| A5 | `issues` birleştirme | `work_items(type=issue)`, `work_logs` bağı | `issue_key_manual` mantığının değişmesi | Tek iş nesnesi kalır; eski anahtarlar korunur |
| A6 | Talep → iş bağı | `origin_type` / `origin_ref_id`, ticket'tan dönüştürme | SLA motoru; otomatik dönüştürme kuralları | Ticket'tan doğan iş kaynağına gidilebilir |
| A7 | Hiyerarşi ve ilişkiler | `parent_id` (iki seviye), `work_item_links` | Üçüncü seviye; bağımlılığın tarih etkisi | Alt iş açılır, rollup sayılır; `blocks` hiçbir tarihi değiştirmez |
| A8 | Faturalandırılabilirlik iş kaleminde | `is_billable`, override alanları | Tutar, oran, kârlılık (para katmanı işi) | Onay ekranı iş kalemi seviyesinde çalışır |
| A9 | `/v1` ve MCP uyumluluk katmanı | Eski yanıt şeklinin korunması, uyumluluk matrisinin yeniden koşulması | `/v2` ilanı | Taşıma öncesi ve sonrası aynı yanıt; matris "denenmemişe Verified" demez |

### B · Yetki ve ayarlar

| Kod | İş | Faz | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|---|
| B1 | Ayarların tek çatı altına alınması | **P0** | Tek `/settings` rotası, beş bölüm, bölüm başına izin | Yeni izin kodu eklemek; ayar içeriklerini değiştirmek | Menüde tek "Ayarlar"; izni olmayan bölüm görünmez |
| B2 | Proje ayarları sayfası | P2 | Üyeler, üye rolleri, proje içi yönlendirme | Proje bazlı workflow şeması | Proje lideri kendi ekibini yönetir, kiracı ayarına girmeden |
| B3 | Düzenleme yetkisi kuralları | P1 | Sahip kendi işini düzenler; yetki proje rolünden | Alan bazlı yetki matrisi | Sorumlu terminini değiştirebilir |
| B4 | Kendine iş açma | P1 | `reporter = owner` serbest | — | Yönetici olmayan kullanıcı kendine iş açar |
| B5 | Takipçi | P1 | `participants.role = watcher`, bildirim kuralı | Takipçinin düzenleme yetkisi | Takipçi durum değişiminde bildirim alır, düzenleyemez |

### C · Bildirim ve olay (P2)

| Kod | İş | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|
| C1 | İş kalemi olay akışı | `work_item_events` + sıra numarası + giden kutusu | Olay yeniden oynatma (replay) arayüzü | Her değişiklik sıralı olay üretir |
| C2 | Uygulama içi bildirim | Okundu tablosu, rozet, liste, tıklayınca kayda gitme | **Gerçek zamanlı itme (WebSocket)** | Rozet sayfa açılışında ve odak dönüşünde güncellenir |
| C3 | Kanal ayrımı | Bildirim kural tablosuna `channel` sütunu | Kullanıcı başına bildirim tercihi (v2) | Yönetici bir olayı e-postada kapatıp uygulama içinde açık bırakabilir |

### D · Ana sayfa ve efor

| Kod | İş | Faz | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|---|
| D1 | Kapasite ayarları | **P0** | Kiracı varsayılan saat, çalışma günleri, tatil listesi, `plan_type` ile izin | Vardiya, esnek mesai, kısmi gün hesabı | İzinli gün eksik sayılmaz |
| D2 | Efor şeridi + eksik gün dürtmesi | **P0** | Haftalık dolum, gün kutuları, sarı nokta, tıklayınca giriş | Modal uyarı, e-posta hatırlatma | Bugün asla eksik sayılmaz; boş gün tek tıkla girilir |
| D3 | İşlerim blokları | P3 | Gecikmiş / bugün / bu hafta kovaları, proje gruplu | Terminli olmayan işlerin gösterimi | Kova boşsa sessizce kaybolur |
| D4 | Haftam bloğu | P3 | Toplantı + planlı zaman + termin tek şeritte | Takvime yazma, davet gönderme | Üç kaynak tek görünümde |
| D5 | Ekibim + dikkat bloğu | P3 | Kişi başına yük, gecikme, efor; sahipsiz iş sayacı | Performans puanı, sıralama | Sıralama işe göre, kişiye göre değil |
| D6 | Organizasyon özeti | P3 | Dönem KPI'ları, anomali sinyalleri | Yeni rapor türü | Eşik aşan sinyal öne çıkar |

### E · İş yüzeyi (P3)

| Kod | İş | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|
| E1 | Üç eksen | Görünüm · gruplama · yerleşim | Beşinci eksen, ikinci filtre çubuğu | Kontrol çubuğunda üçten fazla eksen yok |
| E2 | Kayıtlı görünümler | Sistem + kişisel + paylaşılan; linklenebilir | Görünüm paylaşım izinleri (v2) | Görünüm link ile açılır, aynı sonucu verir |
| E3 | Triage kuyruğu | Sahibi olmayan işler kalıcı kuyrukta | Otomatik atama kuralları | Sahipsiz iş kaybolmaz |
| E4 | Görsel dil | Tek renkli sinyal = termin; öncelik nötr çubuk; durum konumdan | Tip rengi, çoklu renkli rozet | Bir kartta en fazla bir renkli sinyal |
| E5 | Takvim yerleşimi | Görünümün bir yerleşim tipi | Ayrı takvim sayfası | Takvim bir görünüm olarak açılır |
| E6 | Derin link | `/work/PROJ-142` | Genel arama sayfası | Bir işe link verilebilir |

### F · Ek dosya (P2)

| Kod | İş | Kapsam içi | Kapsam DIŞI | Kabul ölçütü |
|---|---|---|---|---|
| F1 | İş kalemine dosya ekleme | Mevcut ek dosya altyapısının polimorfik sahipliğe genelleşmesi (karantina → tarama → temiz → indirme izni) | Önizleme, sürükle-bırak, sürüm geçmişi | Dosya eklenir, taranır, yetkisiz indiremez |

### G · Ölçüm (P0)

| Kod | İş | Kapsam içi | Kabul ölçütü |
|---|---|---|---|
| G1 | Durum kullanım ölçümü | Durum başına iş sayısı ve durumda geçen ortalama süre | Varsayılan akışın kaç adım olacağı veriyle kararlaşır |

---

## 4. Kapsam dışı — kalıcı

Aşağıdakiler "sonra bakarız" değil, **kimlik gereği yok**:

| Konu | Gerekçe |
|---|---|
| İnteraktif gantt, kritik yol, baseline | Karşılaştırma eksenini Monday/MS Project'e kaydırır; o eksende parite yok |
| Sprint, velocity, story point | İkinci bir zaman para birimi yaratır; saat–tutar hikâyesini bulanıklaştırır |
| Kaynak planlama, kapasite tahminleme | Kapsam ve ekip kapasitesi |
| Custom field builder | Konfigürasyon yüzeyini patlatır |
| Otomasyon kuralı motoru | Aynı sebep |
| Proje bazlı çoklu workflow şeması | v1'de kiracı başına tek şema yeterli |
| Wiki | PRD v2 kapsamı; ayrı iş |
| Gerçek zamanlı bildirim itme | v1'de yok; çekme yeterli |

**Kademeli olanlar** (yasak değil, sınırlı): bağımlılık bağı görsel ve filtrelenebilir ama tarih
etkisi yok; zaman şeridi read-only.

---

## 5. Bağımlılık zinciri

```
P0  B1 ─┐
    D1 ─┼─ D2
    G1 ─┘        (hiçbiri şemayı beklemez)

P1  A1 ─→ A2 ─→ A3 ─→ A4
     └─→ A5 ─→ A6
     └─→ A7, A8
    A9 (A1..A6 boyunca paralel, zorunlu)
    B3, B4, B5 (A1 + A3 ile birlikte gelir)

P2  C1 ─→ C2 ─→ C3        (A1 gerekli)
    F1                     (A1 gerekli)
    B2                     (A3 gerekli)

P3  D3..D6, E1..E6         (A1, A2, A3 gerekli)
```

---

## 6. Bu kapsamın dışında kalan açık kararlar

| # | Karar | Öneri | Kimin |
|---|---|---|---|
| 1 | Sahiplik: tek sorumlu + katılımcılar mı | Tek sorumlu | Ürün |
| 2 | Alt proje: proje ağacı seviyesi mi, iş kaleminin altı mı | İş kaleminin altı | Ürün |
| 3 | Faturalandırılabilirlik varsayılanının kaynağı | İş kaleminde varsayılan, zaman kaydında override | Ürün |
| 4 | A/B bölmesi (şema önce, arayüz sonra) | Kabul | Ürün |
| 5 | Ek dosya sahipliği polimorfik mi | Polimorfik | Teknik |
| 6 | İki seviye kuralı nerede zorlanır | Servis katmanı | Teknik |
| 7 | Ayarların birleştirilmesi rework'ten önce mi | Evet | Ürün |
