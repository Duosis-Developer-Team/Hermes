# Hermes PM Rework — İnceleme, Kod Doğrulaması ve Kapatılan Kararlar

**22.09.2026 · 00–05 dokümanları ve prototip incelendi; iddialar koda ve canlı veriye karşı doğrulandı.**
Bu dosya 05'in "açık kararlar" tablosunu kapatır ve dokümanlarda düzeltilmesi gerekenleri listeler.

---

## 1. Kapatılan kararlar (CTO, 22.09.2026)

| # | Karar | Sonuç | Not |
|---|---|---|---|
| 1 | Sahiplik | **Tek `owner` + katılımcılar** | Dokümanın önerisi kabul. |
| 2 | Alt-proje | **Proje ağacı seviyesi olarak KALIR** | Dokümanın önerisinin (→ `parent_id`) tersi — gerekçe §2b. `parent_id` yalnız gerçek iş kırılımı için. |
| — | Çoklu atamada kişi başı ilerleme | **`work_item_participants.completed_at`** | 02-sema §5.1'de yoktu; gerekçe §2c. İş kaleminin durumu birleşik, katılımcının kendi tamamlanma damgası korunur. |
| 4 | A/B bölmesi | **Kabul** — P0 başladı | D1+D2 ile başlandı (bu commit). |
| 7 | Ayarlar birleştirmesi (B1) | Evet, P0 içinde, D1+D2'den sonra | Yapıldı. |
| 3 | Faturalanabilirlik varsayılanı | **Proje varsayılanı → iş kalemi → efor override** | `projects.is_billable_default` (varsayılan true; iç projeler false); iş kalemi açılırken miras alır, override kim/ne zaman izlenir; efor kaydı iş kaleminden miras alır, satır bazında değişir. (22.09, ikinci tur) |
| 5 | Ek dosya sahipliği | **Polimorfik** | Mevcut `ticket_attachments` exclusive-arc desenine `work_item_id` eklenir; tek servis, tek karantina/tarama hattı. |
| 6 | İki seviye kuralı | **Servis katmanı** | `work_item_service` doğrular; ticket durum makinesiyle aynı yaklaşım. |
| — | **A10 (yeni):** efor girişinde iş kalemi seçimi | **P1'e eklendi, isteğe bağlı** | LogTimeModal'da müşteri/proje seçilince o projenin açık işleri listelenir; zorunlu değil. Gerekçe §2a. |

Açık karar kalmadı; P1 (F00 şema dondurma) başlayabilir.

## 2. Canlı veri bulguları (hermes-test, salt-okunur, 22.09)

**a) Efor kayıtları işe bağlı değil.** 3.066 `work_logs` kaydının 18'i (%0,6) bir göreve bağlı; aylık ~500 kayıtta 0–11. Toplantıya bağlı %20. Efor girişinde iş kalemi seçimi yok (LogTimeModal'a task yalnız Tasks sayfasından ön-dolduruluyor). **Sonuç:** şema rework'ü tek başına "saat ona yazılır"ı gerçekleştirmez; efor girişinin iş kalemine bağlanması ayrı bir kalemdir (A8'in yanına). Ayrıca `billable_duration_hours == duration_hours` neredeyse her satırda — bugünkü veri faturalanabilir/değil ayrımı taşımıyor; karar 3'ün varsayılanını belirleyecek kaynak yok (02 §3.1 "proje ve iş tipi varsayılanından" derken §3.8 `projects`'e alan eklemiyor).

**b) Alt-projeler klasör.** İşlerin %63'ü (115/182) alt-projede; 16 alt-projenin adları "Infrastructure", "Data Collection", "Configuration Management", "Issue - Suggestions", "Maintenance". `parent_id`'ye dönüştürmek hiç kapanmayacak 16 ana iş ve anlamsız rollup üretirdi.

**c) Batch taşımasında kişi başı ilerleme.** 72 batch'in 25'i çok kişili; 7'sinde statüler karışık (ör. 3 completed + 4 pending). Tek `state_id` bunu siler; `assignee_note`, `first_accepted_at`, `first_completed_at`, `completed_by_user_id` de kişi başına ve 02 §5.1 eşlemesinde yok.

**d) G1 ölçümü (P0, tamam).** 182 iş: completed 109 · pending 51 · **rejected 14** · in_progress 8. Pending'de medyan **0,3 gün**, çalışmada medyan 6,8 gün; 27 iş in_progress'i atlamış. Pending fiilen kabul anı. **Varsayılan akış 3 adım** (todo · in_progress · done + cancelled); "Gözden geçirme" varsayılan değil, isteyen kiracı ekler.

**e) Diğer:** 70 projenin 70'inde `project_key` boş (item_key üretimi her proje için gerekli); `issues` 0 kayıt; `project_memberships` 0 satır, `member_role` serbest metin.

## 3. Kod doğrulaması — dokümanlarda düzeltilecekler

| Doküman | Kodda | Etki |
|---|---|---|
| `rejected` "üründen kalkmış" (00 K5, 02 §5.1) | Lifecycle'da terminal değil ama yazma yolu **canlı**: `PATCH /tasks/{id}/reject`, `task_service.reject_task`, frontend mutasyonu; 14 kayıt + 35 olay | §5.1 `rejected → Pending` eşlemesi reddedilmiş işi yeniden açar. **`cancelled` kategorisine** eşlenmeli; reject ucu ya kalkar ya state-machine geçişi olur |
| `AGENTS.md` kırmızı çizgisi, `sql_scripts/migrations` sıra bağımlı (00 §7, 02 §6) | `AGENTS.md` yok; `backend/sql_scripts/migrations` legacy. Aktif mekanizma **Alembic** `backend/core-service/app/migrations/versions/` (head `0009_capacity_foundation`). Yeni tablo deseni: `TABLES` tuple + `create_all(tables=…)` + `apply_enforce(only=…)` (0007/0008/0009) | F01–F03 migration planı buna göre yazılmalı; startup DDL yok |
| İzin kataloğu 13, `PERMISSION_REQUIRES` yalnız assign→access (03 §2) | **25** kod, **7** giriş | Y1 analizi geçerli; rakamlar eski |
| MCP 24 araç / 6 yazma (02 §7.2, 05 A9) | 24 = 17 okuma + **7 yazma**; `hermes_log_time` unutulmuş | A9 kapsamı 7 araç; `log_time` work_log→work_item bağını konuşur |
| `ticket_attachments.ticket_id` ile anahtarlı (03 §3) | `ticket_id` **nullable**; sahiplik ticket/message/resolution exclusive-arc, karantina "upload handle" akışı | F1 polimorfik geçiş bu deseni devralmalı |
| Reporting `tasks` okur (03 §1) | Okumaz; HTTP ile `/core/work-logs/all` + `/auth/users` | Rework'ün reporting'e etkisi yalnız bu iki yanıt şekli |
| "Bir işe link verilemiyor" (01 §3.4) | `?item=<uuid>` tek seferlik derin link var, URL'den siliniyor | E6 (kalıcı `/work/KEY`) geçerli |
| Efor sayfasında doluluk yok (04 §1) | Gün/hafta çubuğu vardı, 8h/40h sabit kodlu; eksik gün sinyali yoktu | D2 bu commit'te: sabitler kapasite ayarına bağlandı |
| `project_memberships` hiç kullanılmıyor, `issues` yalnız etiket (00 K2/K3) | İkisi de `issues` CRUD router'ında canlı | A5 veri taşımasız; router emekliliği kod işi |
| Kaynaklar: Niş-Strateji.docx, Rakip-Analizi.md | Repoda yok (ayrı repoda olabilir); `readme2.md` PRD v2 değil TAD | 00'ın vizyon kilitleri bu repodan doğrulanamıyor |
| ~3.700 satır JSX (00 K7) | `components/tasks` + `features/tasks` .jsx = 3.541; tüm js/jsx 5.618 | Kapsam belirtilmeli |

## 4. Doküman içi boşluklar

- `work_item_types` FK olarak geçiyor (02 §3.1), tablo tanımı yok.
- `scheduled_date NOT NULL` (182 kayıtta dolu) hedef modelde eşlenmemiş → `start_date`.
- `task_number` tenant-geneli → `item_number` proje-içi: yorum/e-posta/`/v1 task_code` referansları kırılır. `legacy_task_number` saklanmalı, `/v1` `task_code` alias olarak çözülmeli (A9'un somut gereği).
- `closed_at` bugün yalnız `completed`'da; hedefte cancelled da terminal → arşiv sayacı davranışı değişir, bilerek olduğu yazılmalı.
- 00/01/02 F00–F05 ile 05 P0–P3 iki numaralandırma; 05 tek kaynak olmalı.
- Prototip: `toggleTheme` dört fonksiyona kopyalanmış, tanımsız `--ink-3/--amber/--accent/--mono`, `.bell` sınıfı yok — kod tabanına girmeyeceği için sorun değil.

## 5. P0 / D1+D2 uygulama notları (bu commit)

- **`plan_times.plan_type` yerine `user_absences`.** 04 §8 "plan_times bir plan_type alanı kazanır" demişti; `plan_times.customer_id/project_id` NOT NULL — iznin müşterisi/projesi yok. Kolonları gevşetmek PlanTimeCard/recurrence/atama akışını izin için de çalıştırmak demekti. İzin ayrı tablo; efor şeridi ikisini de okur.
- Kapasite = kiracı varsayılanı (`tenant_capacity_settings`, singleton) + tatil (`tenant_holidays`) + kişi override (`user_capacity_overrides`, yalnız dolu alan ezer) + izin (`user_absences`). Satır yoksa 8h / Pzt–Cum tek kapıda (`capacity_service.effective_settings`).
- "Bugün" `HERMES_CAPACITY_TZ` (varsayılan Europe/Istanbul) ile hesaplanır; core kiracı saat dilimini bilmiyor — ileride kiracı ayarına bağlanır.
- Yetki: ayarlar `users.manage` (Ayarlar › Organizasyon); başkasının haftası/izni `worklogs.admin` (efor sayfasındaki "başkası adına" kuralıyla aynı).
- Ekran: `/capacity` (Yapılandırma menüsü). B1 gelince `/settings` › Organizasyon'a taşınır.
- Durum kuralları 04 §4.1/§7 birebir: bugün asla eksik değil; tatil/izin/hafta sonu `off`; 0 saat `missing` (sarı, kutunun içinde, iki eylem: efor gir / izin işaretle); beklenenin altı `partial` (uyarı değil). Modal/toast yok.
