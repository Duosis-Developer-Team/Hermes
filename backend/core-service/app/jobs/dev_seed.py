# =============================================================================
# HERMES core-service - DEV-ONLY mock veri tohumu
# =============================================================================
# YALNIZCA hermes-dev. Amac: yeniden tasarlanan arayuzun her ekranini
# gercekci veriyle incelemek (ana sayfa, isler, pano/takvim, efor,
# toplantilar, ticket hub'i, bildirimler).
#
#   python -m app.jobs.dev_seed --yes-dev             # tohumla (idempotent)
#   python -m app.jobs.dev_seed --yes-dev --purge     # yalnizca tohumu sil
#   python -m app.jobs.dev_seed --yes-dev --reseed    # sil + bugune gore yeniden
#
# GUVENLIK: shared/dev_seed.assert_dev_only — `--yes-dev` + HERMES_ENVIRONMENT
# == dev + PUBLIC_API_ENV == dev + (pod icinde) namespace == hermes-dev.
# Kosul tutmazsa DB'ye BAGLANMADAN exit 2. hermes-test'te bu betik KOSAMAZ.
#
# SIRA: once auth-service tohumu (sahte kullanicilar), sonra bu betik.
#
# Kimlik: her satirin id'si shared/dev_seed.demo_id (uuid5 + `de5eed00`
# isareti). Tekrar kosmak kopya URETMEZ: var olan id atlanir. work_logs
# BIGSERIAL oldugu icin isaret tasiyamaz; onlar tohum projelerine baglidir
# ve (kullanici, gun, proje, aciklama) anahtariyla tekillenir.
#
# Purge: isaretli satirlar + onlara FK ile bagli satirlar (ornegin
# arayuzden bir demo ise yazilan yorum ya da demo projeye girilen efor)
# cocuktan ebeveyne silinir. Isaretsiz, demo satira bagli OLMAYAN hicbir
# satira dokunulmaz; ON DELETE SET NULL baglari (gercek bir efor kaydinin
# demo is kalemine referansi) DB kuraliyla NULL'lanir. DDL / TRUNCATE YOK.
# Tuketilmis is/ticket numaralari (tenant_counters) geri alinmaz.
# =============================================================================

from __future__ import annotations

import json
import logging
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.dev_seed import (
    DEMO_EMAIL_DOMAIN,
    EXIT_REFUSED,
    DevSeedRefused,
    assert_dev_only,
    demo_id,
    demo_id_sql_pattern,
    demo_users,
    is_demo_id,
)

logger = logging.getLogger("hermes.jobs.dev_seed")

DEFAULT_TENANT_SLUG = "duosis"
TZ = ZoneInfo("Europe/Istanbul")
#: Kesif edilen gercek kullanici ust siniri (buyuk dizinde veri patlamasin).
#: Her gercek kullanici kisisel "gecikmis / bugun / bu hafta" isi alir.
MAX_REAL_USERS = 60


# =============================================================================
# Katalog: musteriler, projeler, is kalemleri
# =============================================================================

CUSTOMERS = (
    # (anahtar, ad, sozlesme baslangici - gun once, sure gun)
    ("vakko", "Vakko", 420, 730),
    ("beymen", "Beymen", 300, 365),
    ("arcelik", "Arçelik", 540, 1095),
    ("migros", "Migros", 120, 365),
    ("duosis", "Duosis (İç Projeler)", None, None),
)

PROJECTS = (
    # (kod, musteri, ad, faturalanabilir mi, alt projeler)
    ("VKE", "vakko", "E-Ticaret Yenileme", True, ("Ödeme Akışı", "Ürün Detay Sayfası")),
    ("VKS", "vakko", "Mağaza Stok Entegrasyonu", True, ()),
    ("BYM", "beymen", "Mobil Uygulama v3", True, ("iOS", "Android")),
    ("BYC", "beymen", "CRM Veri Ambarı", True, ()),
    ("ARS", "arcelik", "Yetkili Servis Portalı", True, ("Randevu Modülü",)),
    ("ARI", "arcelik", "IoT Telemetri Paneli", True, ()),
    ("MGS", "migros", "Sadakat Programı API", True, ()),
    ("MGT", "migros", "Tedarik Planlama", True, ()),
    ("HRM", "duosis", "Hermes İç Geliştirme", False, ("Raporlama",)),
    ("OPS", "duosis", "Altyapı ve DevOps", False, ("Kubernetes Göçü",)),
)

#: Proje basina demo uyeler (gercek kullanicilarin hepsi ayrica uye olur).
PROJECT_DEMO_MEMBERS = {
    "VKE": ("ada", "grace", "katherine"),
    "VKS": ("linus", "alan", "margaret"),
    "BYM": ("ada", "katherine", "margaret"),
    "BYC": ("alan", "katherine", "grace"),
    "ARS": ("grace", "ada", "margaret"),
    "ARI": ("alan", "linus", "grace"),
    "MGS": ("ada", "alan", "margaret"),
    "MGT": ("katherine", "margaret", "linus"),
    "HRM": ("grace", "ada", "linus"),
    "OPS": ("linus", "grace", "alan"),
}

# (proje, alt proje, tur, baslik, oncelik, kategori, termin - bugune gore gun, tahmin dk)
ITEMS = (
    ("VKE", "Ödeme Akışı", "task", "3D Secure yönlendirme hatasını düzelt", "urgent", "in_progress", -2, 240),
    ("VKE", "Ödeme Akışı", "task", "Taksit seçeneklerini banka bazında göster", "high", "todo", 3, 480),
    ("VKE", "Ödeme Akışı", "issue", "Kupon kodu sepet toplamını iki kez düşürüyor", "high", "todo", 0, 120),
    ("VKE", "Ürün Detay Sayfası", "task", "Ürün görsel galerisine yakınlaştırma ekle", "medium", "in_progress", 2, 360),
    ("VKE", "Ürün Detay Sayfası", "task", "Beden tablosu penceresini yeniden tasarla", "low", "todo", 9, 240),
    ("VKE", None, "task", "Lighthouse performans skorunu 90 üstüne çıkar", "medium", "todo", 12, 600),
    ("VKE", None, "suggestion", "Sepette 'birlikte alınanlar' önerisi", "low", "todo", None, None),
    ("VKE", None, "task", "Kategori sayfası filtre URL yapısı", "medium", "done", -6, 180),
    ("VKS", None, "task", "Mağaza stok senkronizasyonu için kuyruk yapısı", "high", "in_progress", 1, 480),
    ("VKS", None, "issue", "Gece senkronizasyonunda 3 mağaza eksik geliyor", "urgent", "todo", -1, 180),
    ("VKS", None, "task", "SAP IDoc eşleme dokümanını güncelle", "low", "done", -9, 120),
    ("VKS", None, "task", "Stok eşik uyarıları için e-posta şablonu", "medium", "todo", 5, 120),
    ("VKS", None, "task", "Eski FTP entegrasyonunu kapat", "medium", "cancelled", -4, 60),
    ("BYM", "iOS", "task", "iOS 18 bildirim izinleri akışı", "high", "in_progress", 0, 300),
    ("BYM", "iOS", "issue", "Apple Pay sonrası uygulama donuyor", "urgent", "in_progress", -3, 240),
    ("BYM", "Android", "task", "Android 15 kenardan kenara ekran uyumu", "medium", "todo", 4, 360),
    ("BYM", "Android", "issue", "Play Store incelemesinde izin reddi", "high", "todo", 1, 120),
    ("BYM", None, "task", "Favoriler ekranının çevrimdışı önbelleği", "medium", "todo", 10, 420),
    ("BYM", None, "task", "Sürüm 3.2 notlarını hazırla", "low", "done", -2, 60),
    ("BYM", None, "suggestion", "Karanlık tema desteği", "low", "todo", None, None),
    ("BYC", None, "task", "Müşteri segmentasyon tablolarını modelle", "high", "in_progress", 6, 600),
    ("BYC", None, "task", "Günlük ETL süresini 40 dakikanın altına indir", "medium", "todo", 8, 480),
    ("BYC", None, "issue", "Kampanya raporunda mükerrer müşteri kaydı", "high", "todo", -5, 180),
    ("BYC", None, "task", "KVKK maskeleme kurallarını uygula", "urgent", "todo", 2, 300),
    ("BYC", None, "task", "Veri sözlüğü ilk sürümü", "low", "done", -12, 240),
    ("ARS", "Randevu Modülü", "task", "Teknisyen takvim çakışma kontrolü", "high", "in_progress", 3, 420),
    ("ARS", "Randevu Modülü", "task", "SMS ile randevu hatırlatma", "medium", "todo", 11, 240),
    ("ARS", "Randevu Modülü", "issue", "Hafta sonu randevu slotları görünmüyor", "medium", "todo", 0, 90),
    ("ARS", None, "task", "Servis formu PDF çıktısı", "medium", "done", -3, 180),
    ("ARS", None, "task", "Yedek parça stok sorgusu entegrasyonu", "high", "todo", -2, 360),
    ("ARS", None, "suggestion", "Teknisyenler için mobil kontrol listesi", "low", "todo", None, None),
    ("ARI", None, "task", "Cihaz telemetri grafiklerini canlıya al", "high", "in_progress", 2, 480),
    ("ARI", None, "task", "MQTT bağlantı kopmalarında yeniden deneme", "urgent", "todo", -1, 240),
    ("ARI", None, "issue", "Sıcaklık sensörü birimi yanlış gösteriliyor", "medium", "done", -7, 60),
    ("ARI", None, "task", "Alarm eşikleri yönetim ekranı", "medium", "todo", 15, 420),
    ("ARI", None, "task", "Grafana panosunu müşteriye aç", "low", "cancelled", -10, 60),
    ("MGS", None, "task", "Puan kazanım uç noktası v2", "high", "in_progress", 1, 480),
    ("MGS", None, "task", "Rate limit ve idempotency anahtarı", "medium", "todo", 4, 300),
    ("MGS", None, "issue", "Puan iadesinde negatif bakiye oluşuyor", "urgent", "todo", 0, 180),
    ("MGS", None, "task", "OpenAPI şemasını yayınla", "low", "done", -4, 120),
    ("MGS", None, "task", "Yük testi senaryoları (k6)", "medium", "todo", 7, 360),
    ("MGT", None, "task", "Talep tahmin modelinin veri hattı", "high", "todo", 9, 720),
    ("MGT", None, "task", "Tedarikçi portalı giriş ekranı", "medium", "in_progress", -1, 300),
    ("MGT", None, "issue", "Sipariş önerisi Excel dışa aktarımı bozuk", "medium", "todo", 2, 120),
    ("MGT", None, "task", "Canlıya geçiş kontrol listesi", "high", "todo", 10, 180),
    ("HRM", None, "task", "Ana sayfa ekip görünümü performans iyileştirmesi", "medium", "in_progress", 3, 300),
    ("HRM", "Raporlama", "task", "Efor raporuna proje kırılımı ekle", "medium", "todo", 6, 360),
    ("HRM", "Raporlama", "issue", "CSV dışa aktarımında Türkçe karakterler bozuluyor", "high", "todo", -4, 120),
    ("HRM", None, "task", "Bildirim merkezine 'tümünü okundu say'", "low", "done", -1, 120),
    ("HRM", None, "suggestion", "Takvimde sürükle-bırak ile iş planlama", "medium", "todo", None, None),
    ("HRM", None, "task", "Ticket'tan iş kalemi oluşturma akışını test et", "medium", "todo", 1, 180),
    ("HRM", None, "task", "Kayıtlı görünümler için paylaşım izinleri", "low", "todo", 14, 240),
    ("OPS", "Kubernetes Göçü", "task", "hermes-dev için HPA tanımları", "medium", "todo", 5, 180),
    ("OPS", "Kubernetes Göçü", "task", "PostgreSQL yedekleme CronJob'unu doğrula", "high", "in_progress", 0, 120),
    ("OPS", None, "issue", "Sertifika yenileme uyarısı gelmedi", "urgent", "todo", -2, 60),
    ("OPS", None, "task", "Grafana uyarı kurallarını gözden geçir", "medium", "done", -5, 180),
    ("OPS", None, "task", "MinIO ve ClamAV kaynak limitleri", "low", "todo", 8, 120),
    ("OPS", None, "task", "CI süresini 10 dakikanın altına indir", "medium", "in_progress", 4, 300),
    ("OPS", None, "task", "Log saklama politikasını belgele", "low", "cancelled", -8, 60),
    ("OPS", None, "suggestion", "Her PR için önizleme ortamı", "low", "todo", None, None),
)

#: A7: cocuk index -> ebeveyn index (ayni proje, iki seviye).
PARENTS = {1: 0, 2: 0, 21: 20, 23: 20, 26: 25, 27: 25, 37: 36, 38: 36}
#: (kaynak index, hedef index, tur)
LINKS = (
    (32, 31, "blocks"),
    (9, 8, "relates"),
    (54, 53, "relates"),
    (14, 13, "blocks"),
    (22, 20, "relates"),
    (47, 45, "duplicates"),
)

#: Gercek kullanicilara ozel isler: (baslik, oncelik, kategori, termin turu)
PERSONAL_ITEMS = (
    ("Haftalık durum raporunu gönder", "medium", "todo", "overdue"),
    ("Müşteri toplantısı notlarını paylaş", "high", "in_progress", "today"),
    ("Açık pull request'leri incele", "medium", "todo", "this_week"),
)

DESCRIPTIONS = {
    "task": "Kabul kriterleri:\n- Değişiklik test ortamında doğrulanmalı\n- İlgili dokümantasyon güncellenmeli\n- Kod incelemesi tamamlanmalı",
    "issue": "Adımlar:\n1. İlgili ekranı aç\n2. İşlemi tekrarla\n\nBeklenen: İşlem hatasız tamamlanmalı.\nGerçekleşen: Hata alınıyor, ekran görüntüsü yorumlarda.",
    "suggestion": "Kullanıcı geri bildirimlerinden gelen öneri. Önceliklendirme toplantısında değerlendirilecek.",
}

COMMENTS = (
    "İlk analizi yaptım, tahmin ettiğimizden biraz daha büyük görünüyor.",
    "Test ortamına aldım, sabah kontrol edebilir misin?",
    "Müşteriden gelen ek bilgiyi açıklamaya ekledim.",
    "Bu işi yarına kadar bitirmem zor, bir gün kayabilir.",
    "Kod incelemesinde iki küçük düzeltme istedim, gerisi tamam.",
    "Bununla ilgili geçen sprintte benzer bir kayıt vardı, bağladım.",
    "Canlı ortamda log'larda aynı hatayı gördüm, öncelik yükseltilmeli.",
    "Tamamdır, bu akşam deploy penceresinde canlıya alıyoruz.",
)

WORK_LOG_TEXTS = (
    "Geliştirme ve birim testleri",
    "Kod incelemesi ve düzeltmeler",
    "Müşteri ile analiz görüşmesi",
    "Hata ayıklama ve log incelemesi",
    "Test ortamında doğrulama",
    "Dokümantasyon güncellemesi",
    "Deploy hazırlığı ve kontrol listesi",
)

#: Her gun icin saat dagilimlari (toplam 8, 7.5 veya eksik gun icin 4).
HOUR_SPLITS = (
    (Decimal("4.00"), Decimal("2.50"), Decimal("1.50")),
    (Decimal("3.00"), Decimal("3.00"), Decimal("2.00")),
    (Decimal("5.00"), Decimal("2.50")),
    (Decimal("2.00"), Decimal("4.00"), Decimal("2.00")),
    (Decimal("6.00"), Decimal("2.00")),
)


# =============================================================================
# Yardimcilar
# =============================================================================

class _Writer:
    """Id'si deterministik satirlari idempotent yazar ve sayar."""

    def __init__(self, db: Session, tenant_id: str):
        self.db = db
        self.tenant_id = UUID(str(tenant_id))
        self.created: Counter = Counter()

    def add(self, model, **fields):
        existing = self.db.get(model, fields["id"])
        if existing is not None:
            return existing, False
        obj = model(tenant_id=self.tenant_id, **fields)
        self.db.add(obj)
        self.created[model.__tablename__] += 1
        return obj, True

    def flush(self):
        self.db.flush()


def _at(day: date, hh: int, mm: int = 0) -> datetime:
    """Istanbul yerel saati → UTC-aware datetime."""
    return datetime.combine(day, time(hh, mm), tzinfo=TZ).astimezone(timezone.utc)


def _due(today: date, kind_or_offset) -> Optional[date]:
    if kind_or_offset is None:
        return None
    if kind_or_offset == "overdue":
        return today - timedelta(days=2)
    if kind_or_offset == "today":
        return today
    if kind_or_offset == "this_week":
        sunday = today + timedelta(days=6 - today.weekday())
        return min(today + timedelta(days=2), sunday) if today < sunday else today + timedelta(days=1)
    return today + timedelta(days=int(kind_or_offset))


def _placeholder_email(uid) -> str:
    return f"user-{str(uid)[:8]}@unknown.{DEMO_EMAIL_DOMAIN}"


def resolve_tenant_id(db: Session, slug: str) -> str:
    row = db.execute(text(
        "SELECT tenant_id FROM tenant_registry "
        "WHERE slug = :s AND status IN ('active', 'grace')"
    ), {"s": slug}).scalar()
    if row is None:
        raise RuntimeError(f"tenant '{slug}' not found in tenant_registry")
    return str(row)


def discover_real_users(db: Session, tenant_id: str) -> List[dict]:
    """Gercek (isaretsiz) aktif kullanicilar.

    Once auth dizini (S2S, core pod'unda zaten tanimli); yoksa core
    tablolarinda gecen kimlikler (ad/e-posta bilinmez). E-posta ASLA
    koda gomulmez — calisma aninda kesfedilir.
    """
    from ..services import directory_client

    users: List[dict] = []
    try:
        offset = 0
        while len(users) < MAX_REAL_USERS:
            page, more = directory_client.list_users_global(
                tenant_id=tenant_id, limit=100, offset=offset)
            for u in page:
                if is_demo_id(u["id"]) or not u.get("is_active", True):
                    continue
                users.append({"id": UUID(str(u["id"])),
                              "name": u.get("display_name") or u.get("work_email"),
                              "email": (u.get("work_email") or "").lower() or None})
            if not more:
                break
            offset += 100
        return users[:MAX_REAL_USERS]
    except directory_client.DirectoryUnavailable:
        logger.warning("directory unavailable; falling back to core tables")

    rows = db.execute(text(
        "SELECT user_id FROM project_memberships WHERE is_active "
        "UNION SELECT user_id FROM work_logs "
        "UNION SELECT user_id FROM work_item_participants "
        "UNION SELECT user_id FROM user_group_members WHERE is_active "
        "UNION SELECT reporter_user_id FROM work_items"
    )).scalars().all()
    ids = sorted({str(r) for r in rows if r is not None and not is_demo_id(r)})
    return [{"id": UUID(i), "name": None, "email": None} for i in ids[:MAX_REAL_USERS]]


# =============================================================================
# Tohum
# =============================================================================

def seed(
    db: Session,
    *,
    tenant_id: str,
    real_users: Sequence[dict],
    today: Optional[date] = None,
    with_tickets: Optional[bool] = None,
) -> dict:
    """Tum demo veriyi yazar (idempotent). Commit CAGIRANA aittir."""
    from ..config import get_settings
    from ..models.capacity import UserAbsence, UserCapacityOverride
    from ..models.customer import Customer
    from ..models.meeting import Meeting, MeetingAttendee
    from ..models.project import Project
    from ..models.project_membership import ProjectMembership
    from ..models.task import TaskSubProject
    from ..models.user_group import UserGroup, UserGroupMember
    from ..models.work_item import (
        RoutingRelation, WorkflowState, WorkItem, WorkItemComment, WorkItemEvent,
        WorkItemLink, WorkItemNotification, WorkItemParticipant,
    )
    from ..models.work_log import WorkLog
    from ..models.work_type import WorkType
    from ..services import work_item_service as wis
    from ..services.capacity_service import today_in_tenant_tz, week_monday

    tid = str(tenant_id)
    today = today or today_in_tenant_tz()
    monday = week_monday(today)
    now = datetime.now(timezone.utc)
    w = _Writer(db, tid)

    def did(*parts):
        return demo_id(tid, *parts)

    # --- Kisiler ---------------------------------------------------------
    demo = {u["key"]: u for u in demo_users()}
    real = [dict(u, id=UUID(str(u["id"]))) for u in real_users
            if not is_demo_id(u["id"])][:MAX_REAL_USERS]
    for i, u in enumerate(real):
        u["name"] = u.get("name") or f"Kullanıcı {i + 1}"
    names: Dict[UUID, str] = {u["id"]: u["name"] for u in real}
    emails: Dict[UUID, str] = {u["id"]: (u.get("email") or _placeholder_email(u["id"])) for u in real}
    for d in demo.values():
        names[d["id"]] = d["full_name"]
        emails[d["id"]] = d["email"]
    real_ids = [u["id"] for u in real]
    demo_ids = [d["id"] for d in demo.values()]
    rotation = [uid for uid in real_ids for _ in (0, 1)] + demo_ids
    margaret = demo["margaret"]["id"]

    # --- Referans veri ---------------------------------------------------
    wis.ensure_states(db)
    states = db.query(WorkflowState).filter(WorkflowState.is_active.is_(True)) \
        .order_by(WorkflowState.position.asc(), WorkflowState.name.asc()).all()
    by_cat: Dict[str, list] = defaultdict(list)
    for st in states:
        by_cat[st.category].append(st)
    cancelled_state = next((s for s in by_cat["cancelled"] if s.name == "Cancelled"),
                           (by_cat["cancelled"] or [None])[0])
    cat_counter: Counter = Counter()

    def state_for(cat: str):
        if cat == "cancelled":
            return cancelled_state
        pool = by_cat.get(cat) or by_cat["todo"]
        st = pool[cat_counter[cat] % len(pool)]
        cat_counter[cat] += 1
        return st

    work_types = db.query(WorkType).filter(WorkType.is_active.is_(True)) \
        .order_by(WorkType.name.asc()).all()
    if not work_types:
        for name in ("Geliştirme", "Analiz", "Toplantı", "Destek"):
            wt, _ = w.add(WorkType, id=did("work_type", name), name=name, is_active=True)
            work_types.append(wt)
        w.flush()

    # --- Musteriler / projeler / alt projeler ---------------------------
    customers = {}
    existing_names = {n for (n,) in db.query(Customer.name).all()}
    for key, name, start_ago, duration in CUSTOMERS:
        cid = did("customer", key)
        label = name
        if db.get(Customer, cid) is None and name in existing_names:
            label = f"{name} (Demo)"
        c, _ = w.add(
            Customer, id=cid, name=label, is_active=True,
            contract_start_date=_at(today - timedelta(days=start_ago), 9) if start_ago else None,
            contract_duration_days=duration,
        )
        customers[key] = c
    w.flush()

    projects, subs = {}, {}
    for code, cust, name, billable, sub_names in PROJECTS:
        p, _ = w.add(
            Project, id=did("project", code), customer_id=customers[cust].id,
            name=name, project_key=f"DEMO-{code}", is_billable_default=billable,
            is_active=True, contract_start_date=_at(today - timedelta(days=90), 9),
            contract_duration_days=365,
        )
        projects[code] = p
    w.flush()
    for code, cust, _name, _b, sub_names in PROJECTS:
        for sub in sub_names:
            sp, _ = w.add(
                TaskSubProject, id=did("sub_project", code, sub),
                customer_id=customers[cust].id, project_id=projects[code].id,
                name=sub, description=f"{sub} çalışmaları", is_active=True,
                created_by_user_id=margaret,
            )
            subs[(code, sub)] = sp
    w.flush()

    # --- Proje uyelikleri (B2) ------------------------------------------
    leads: Dict[str, UUID] = {}
    for i, (code, *_rest) in enumerate(PROJECTS):
        lead = real_ids[i % len(real_ids)] if real_ids else demo[PROJECT_DEMO_MEMBERS[code][0]]["id"]
        leads[code] = lead
        members = [(lead, "lead")]
        members += [(demo[k]["id"], "member") for k in PROJECT_DEMO_MEMBERS[code]]
        members += [(uid, "member") for uid in real_ids]
        seen = set()
        for uid, role in members:
            if uid in seen:
                continue
            seen.add(uid)
            exists = db.query(ProjectMembership.id).filter(
                ProjectMembership.project_id == projects[code].id,
                ProjectMembership.user_id == uid,
            ).first()
            if exists is None:
                w.add(ProjectMembership, id=did("membership", code, uid),
                      project_id=projects[code].id, user_id=uid, member_role=role,
                      start_date=today - timedelta(days=90), is_active=True)
    w.flush()

    # --- Gruplar + yonlendirme (A4) --------------------------------------
    support_group, _ = w.add(
        UserGroup, id=did("group", "support"), name="Destek Ekibi (Demo)",
        description="Ticket Hub demo destek ekibi", is_active=True,
        created_by_user_id=margaret,
    )
    mobile_group, _ = w.add(
        UserGroup, id=did("group", "mobile"), name="Mobil Ekip (Demo)",
        description="iOS / Android geliştirme ekibi", is_active=True,
        created_by_user_id=margaret,
    )
    w.flush()
    group_members = [(support_group, uid, "Destek Uzmanı") for uid in real_ids]
    group_members += [(support_group, demo[k]["id"], demo[k]["title"]) for k in ("grace", "ada", "linus")]
    group_members += [(mobile_group, demo[k]["id"], demo[k]["title"]) for k in ("ada", "katherine")]
    group_members += [(mobile_group, uid, "Mobil Geliştirici") for uid in real_ids[:2]]
    for group, uid, title in group_members:
        exists = db.query(UserGroupMember.id).filter(
            UserGroupMember.group_id == group.id, UserGroupMember.user_id == uid).first()
        if exists is None:
            w.add(UserGroupMember, id=did("group_member", group.id, uid),
                  group_id=group.id, user_id=uid, title=title, is_active=True)
    # Gercek kullanicilar demo kisilere, demo yoneticiler gercek kisilere
    # is yonlendirebilsin (gercekler arasi politikaya DOKUNULMAZ).
    pairs = [(a, b) for a in real_ids for b in demo_ids]
    pairs += [(a, b) for a in (margaret, demo["grace"]["id"]) for b in demo_ids + real_ids if a != b]
    for assigner, assignee in pairs:
        for scope in ("task", "issue"):
            exists = db.query(RoutingRelation.id).filter(
                RoutingRelation.assigner_user_id == assigner,
                RoutingRelation.assignee_user_id == assignee,
                RoutingRelation.scope == scope,
            ).first()
            if exists is None:
                w.add(RoutingRelation, id=did("routing", assigner, assignee, scope),
                      assigner_user_id=assigner, assignee_user_id=assignee, scope=scope)
    w.flush()

    # --- Is kalemleri ----------------------------------------------------
    specs = []  # (anahtar, proje kodu, alt proje, tur, baslik, oncelik, kategori, termin, tahmin, sahip)
    for i, (code, sub, typ, title, prio, cat, due_off, est) in enumerate(ITEMS):
        owner = rotation[i % len(rotation)]
        specs.append((("general", i), code, sub, typ, title, prio, cat, _due(today, due_off), est, owner))
    personal_codes = [c for c, *_ in PROJECTS]
    for ui, uid in enumerate(real_ids):
        for k, (title, prio, cat, kind) in enumerate(PERSONAL_ITEMS):
            code = personal_codes[(ui + k) % len(personal_codes)]
            specs.append((("personal", uid, k), code, None, "task", title, prio, cat,
                          _due(today, kind), 60, uid))

    items: Dict[tuple, object] = {}
    item_meta: Dict[tuple, dict] = {}
    for n, (key, code, sub, typ, title, prio, cat, due, est, owner) in enumerate(specs):
        item_id = did("work_item", *key)
        project = projects[code]
        reporter = leads[code] if leads[code] != owner else margaret
        start = (due - timedelta(days=max(1, (est or 240) // 240))) if due else today - timedelta(days=5)
        start = min(start, today - timedelta(days=1)) if cat != "todo" else start
        if due and start > due:
            start = due
        created_day = min(start, today) - timedelta(days=2 + n % 5)
        created_at = _at(created_day, 9 + n % 8, (n * 7) % 60)
        closed_at = None
        if cat in ("done", "cancelled"):
            closed_day = min(due or today, today - timedelta(days=1))
            closed_at = max(_at(closed_day, 17), created_at + timedelta(hours=2))
        assignees = [owner]
        if n % 5 == 0 and cat in ("in_progress", "done"):
            extra = rotation[(n + 3) % len(rotation)]
            if extra != owner:
                assignees.append(extra)
        item = db.get(WorkItem, item_id)
        if item is None:
            number = wis._next_number(db, tid, typ)
            item, _ = w.add(
                WorkItem, id=item_id, project_id=project.id,
                sub_project_id=subs[(code, sub)].id if sub else None,
                item_key=wis.code_of(typ, number), item_number=number, item_type=typ,
                title=title, description=DESCRIPTIONS[typ], state_id=state_for(cat).id,
                priority=prio, reporter_user_id=reporter, owner_user_id=owner,
                estimate_minutes=est, start_date=start, due_date=due,
                is_billable=bool(project.is_billable_default), closed_at=closed_at,
                created_at=created_at, updated_at=closed_at or created_at + timedelta(hours=3),
            )
        items[key] = item
        item_meta[key] = {"cat": cat, "created_at": created_at, "closed_at": closed_at,
                          "reporter": reporter, "assignees": assignees, "n": n,
                          "watchers": []}
    w.flush()

    # Hiyerarsi (A7) ve baglar
    for child, parent in PARENTS.items():
        c_item, p_item = items[("general", child)], items[("general", parent)]
        if c_item.parent_id is None:
            c_item.parent_id = p_item.id
    for src, dst, kind in LINKS:
        w.add(WorkItemLink, id=did("link", src, dst, kind),
              from_item_id=items[("general", src)].id, to_item_id=items[("general", dst)].id,
              link_type=kind, created_by_user_id=margaret)
    w.flush()

    # Katilimcilar: atananlar, inceleyici, takipci (B5)
    for key, item in items.items():
        meta = item_meta[key]
        n, cat = meta["n"], meta["cat"]
        for uid in meta["assignees"]:
            w.add(WorkItemParticipant, id=did("participant", item.id, uid, "assignee"),
                  work_item_id=item.id, user_id=uid, role="assignee",
                  accepted_at=meta["created_at"] + timedelta(hours=1) if cat != "todo" else None,
                  completed_at=meta["closed_at"] if cat == "done" else None,
                  added_by_user_id=meta["reporter"], created_at=meta["created_at"])
        if n % 7 == 0:
            reviewer = demo["grace"]["id"] if demo["grace"]["id"] not in meta["assignees"] else demo["ada"]["id"]
            w.add(WorkItemParticipant, id=did("participant", item.id, reviewer, "reviewer"),
                  work_item_id=item.id, user_id=reviewer, role="reviewer",
                  added_by_user_id=meta["reporter"], created_at=meta["created_at"])
        if n % 3 == 0 and real_ids:
            watcher = real_ids[(n // 3) % len(real_ids)]
            if watcher not in meta["assignees"]:
                meta["watchers"].append(watcher)
                w.add(WorkItemParticipant, id=did("participant", item.id, watcher, "watcher"),
                      work_item_id=item.id, user_id=watcher, role="watcher",
                      added_by_user_id=meta["reporter"], created_at=meta["created_at"])
    w.flush()

    # Yorumlar + olaylar (etkinlik akisi) + uygulama ici bildirimler (C2)
    for key, item in items.items():
        meta = item_meta[key]
        n, cat = meta["n"], meta["cat"]
        timeline = [(meta["created_at"], "task_created", meta["reporter"], {
            "title": item.title, "assignee_user_ids": [str(u) for u in meta["assignees"]],
            "priority": item.priority,
            "due_date": item.due_date.isoformat() if item.due_date else None,
        }, None)]
        n_comments = (n % 3) + 1 if n % 2 == 0 else 0
        authors = meta["assignees"] + [meta["reporter"]]
        for k in range(n_comments):
            at = meta["created_at"] + timedelta(hours=3 * (k + 1))
            author = authors[k % len(authors)]
            comment, _ = w.add(
                WorkItemComment, id=did("comment", item.id, k), work_item_id=item.id,
                author_user_id=author, body=COMMENTS[(n + k) % len(COMMENTS)], created_at=at,
            )
            timeline.append((at, "comment_added", author, {"comment_id": str(comment.id)}, k))
        owner = meta["assignees"][0]
        if cat == "in_progress":
            timeline.append((meta["created_at"] + timedelta(days=1), "task_status_changed", owner,
                             {"from": "pending", "to": "in_progress",
                              "participant_user_id": str(owner)}, None))
        elif cat == "done":
            timeline.append((meta["closed_at"], "task_completed", owner,
                             {"from": "in_progress", "participant_user_id": str(owner)}, None))
        elif cat == "cancelled":
            timeline.append((meta["closed_at"], "task_status_changed", meta["reporter"],
                             {"from": "pending", "to": "cancelled"}, None))
        timeline.sort(key=lambda e: e[0])
        watchers = meta["watchers"]
        for seq, (at, etype, actor, data, _k) in enumerate(timeline, start=1):
            ev, _ = w.add(WorkItemEvent, id=did("event", item.id, etype, seq),
                          work_item_id=item.id, actor_user_id=actor, event_type=etype,
                          event_data=data, sequence=seq, created_at=at)
            # Bildirim yalnizca gercek kullanicilara (demo kisiler giris yapamaz).
            recipients = set(meta["assignees"]) if etype == "task_created" \
                else set(meta["assignees"]) | {meta["reporter"]}
            recipients |= set(watchers)
            for uid in recipients:
                if uid == actor or uid not in names or is_demo_id(uid):
                    continue
                w.add(WorkItemNotification, id=did("notification", ev.id, uid),
                      user_id=uid, work_item_id=item.id, event_id=ev.id, kind=etype,
                      read_at=(at + timedelta(hours=5)) if at < now - timedelta(days=2) else None,
                      created_at=at)
    w.flush()

    # --- Efor (work logs): son 3 hafta + bu hafta -----------------------
    absences = {
        demo["katherine"]["id"]: [(monday + timedelta(days=7), monday + timedelta(days=9), "leave",
                                   "Yıllık izin")],
        demo["linus"]["id"]: [(monday - timedelta(days=4), monday - timedelta(days=4), "sick",
                               "Rapor")],
        demo["grace"]["id"]: [(monday + timedelta(days=4), monday + timedelta(days=4), "other",
                               "DevOpsDays İstanbul konferansı")],
        demo["alan"]["id"]: [(monday - timedelta(days=14), monday - timedelta(days=13), "leave",
                              "Yıllık izin")],
    }
    for uid, ranges in absences.items():
        for k, (s, e, typ, note) in enumerate(ranges):
            w.add(UserAbsence, id=did("absence", uid, k), user_id=uid, start_date=s, end_date=e,
                  absence_type=typ, note=note, created_by_user_id=margaret)
    exists = db.query(UserCapacityOverride.id).filter(
        UserCapacityOverride.user_id == margaret).first()
    if exists is None:
        w.add(UserCapacityOverride, id=did("capacity", margaret), user_id=margaret,
              daily_expected_hours=Decimal("6.00"), working_days=[1, 2, 3, 4],
              updated_by_user_id=margaret)
    w.flush()

    def absent(uid, day):
        return any(s <= day <= e for s, e, _t, _n in absences.get(uid, ()))

    project_ids = [p.id for p in projects.values()]
    existing_logs = {
        (r.user_id, r.date_worked, r.project_id, r.description)
        for r in db.query(WorkLog.user_id, WorkLog.date_worked, WorkLog.project_id,
                          WorkLog.description).filter(WorkLog.project_id.in_(project_ids))
    }
    items_by_user: Dict[UUID, list] = defaultdict(list)
    for key, item in items.items():
        for uid in item_meta[key]["assignees"]:
            items_by_user[uid].append(item)
    project_by_id = {p.id: p for p in projects.values()}
    customer_of = {p.id: p.customer_id for p in projects.values()}
    people = real_ids + demo_ids
    day = monday - timedelta(days=21)
    while day <= today:
        if day.weekday() < 5:
            for pi, uid in enumerate(people):
                if absent(uid, day):
                    continue
                mine = items_by_user.get(uid) or list(items.values())[pi::len(people)] or list(items.values())
                split = HOUR_SPLITS[(pi + day.toordinal()) % len(HOUR_SPLITS)]
                if (pi * 3 + day.toordinal()) % 11 == 0:
                    split = (Decimal("4.00"),)  # eksik gun (kapasite ekraninda gorunsun)
                if day == today:
                    split = split[:1]  # bugun: yalnizca sabah girisi
                for k, hours in enumerate(split):
                    item = mine[(day.toordinal() + k) % len(mine)]
                    text_ = WORK_LOG_TEXTS[(pi + k + day.toordinal()) % len(WORK_LOG_TEXTS)]
                    desc = f"{item.item_key} · {text_}"
                    sig = (uid, day, item.project_id, desc)
                    if sig in existing_logs:
                        continue
                    existing_logs.add(sig)
                    billable = bool(item.is_billable)
                    db.add(WorkLog(
                        tenant_id=w.tenant_id, user_id=uid, customer_id=customer_of[item.project_id],
                        project_id=item.project_id, work_type_id=work_types[(pi + k) % len(work_types)].id,
                        work_item_id=item.id, date_worked=day, duration_hours=hours,
                        billable_duration_hours=hours if billable else Decimal("0"),
                        description=desc, created_at=_at(day, 18), updated_at=_at(day, 18),
                    ))
                    w.created["work_logs"] += 1
        day += timedelta(days=1)
    w.flush()

    # Plan zamanlari artik TOHUMLANMAZ (ozellik CTO karariyla kaldirildi,
    # 2026-09-29). Onceki tohumlarin plan_times/plan_time_assignments
    # satirlari demo id tasir; purge onlari genel tenant-owned taramasiyla
    # yine siler (model bu yuzden metadata'da kalir).

    # --- Toplantilar (bu hafta + gelecek hafta) --------------------------
    everyone = real_ids + demo_ids
    next_monday = monday + timedelta(days=7)
    meetings = []
    for week_start in (monday, next_monday):
        for d in range(5):
            day_ = week_start + timedelta(days=d)
            meetings.append((f"standup:{day_.isoformat()}", "Günlük Stand-up", day_, (9, 30), (9, 45),
                             everyone, demo["grace"]["id"], True, False))
    meetings += [
        ("sprint-planning", "Sprint Planlama", monday, (10, 0), (11, 30), everyone, margaret, True, False),
        ("vakko-demo", "Vakko · E-Ticaret Sprint Demosu", monday + timedelta(days=2), (14, 0), (15, 0),
         real_ids + [demo[k]["id"] for k in ("ada", "grace", "margaret")], margaret, True, False),
        ("arcelik-architecture", "Arçelik · Mimari Gözden Geçirme", monday + timedelta(days=3), (14, 0),
         (15, 30), real_ids[:4] + [demo[k]["id"] for k in ("grace", "alan", "linus")], demo["grace"]["id"],
         True, False),
        ("one-on-one", "Birebir Görüşme", monday + timedelta(days=3), (14, 30), (15, 0),
         real_ids[:1] + [demo["grace"]["id"]], demo["grace"]["id"], True, False),
        ("migros-weekly", "Migros Haftalık Durum", monday + timedelta(days=4), (11, 0), (11, 30),
         real_ids[:3] + [margaret, demo["alan"]["id"]], margaret, True, True),
        ("all-hands", "Duosis Aylık Genel Toplantı", monday + timedelta(days=4), (16, 0), (17, 0),
         everyone, margaret, True, False),
        ("beymen-workshop", "Beymen Yerinde Çalıştay", next_monday + timedelta(days=1), None, None,
         real_ids[:3] + [demo[k]["id"] for k in ("ada", "katherine", "margaret")], margaret, False, False),
        ("ops-weekly", "Altyapı Haftalık", next_monday, (11, 0), (11, 45),
         real_ids[:2] + [demo[k]["id"] for k in ("linus", "grace")], demo["linus"]["id"], True, False),
        ("mgs-kickoff", "Migros Sadakat API v2 Başlangıç", next_monday + timedelta(days=2), (10, 0), (11, 0),
         real_ids + [demo[k]["id"] for k in ("ada", "alan", "margaret")], margaret, True, False),
        ("retro", "Sprint Retrospektif", next_monday + timedelta(days=4), (15, 0), (16, 0),
         everyone, margaret, True, False),
    ]
    for key, subject, day_, start_hm, end_hm, attendees, organizer, online, cancelled in meetings:
        mkey = key if key.startswith("standup:") else f"{key}:{monday.isoformat()}"
        if start_hm is None:  # tum gun
            start_dt = datetime.combine(day_, time(0, 0), tzinfo=TZ).astimezone(timezone.utc)
            end_dt = start_dt + timedelta(days=1)
        else:
            start_dt, end_dt = _at(day_, *start_hm), _at(day_, *end_hm)
        m, _ = w.add(
            Meeting, id=did("meeting", mkey), external_event_id=f"dev-seed:{mkey}",
            source="dev_seed", subject=subject,
            body_preview="Gündem toplantı davetinde paylaşıldı.",
            organizer_email=emails[organizer], organizer_name=names[organizer],
            start_datetime=start_dt, end_datetime=end_dt, timezone="Europe/Istanbul",
            duration_minutes=int((end_dt - start_dt).total_seconds() // 60),
            join_url=f"https://teams.microsoft.com/l/meetup-join/dev-seed-{did('join', mkey)}" if online else None,
            is_online_meeting=online, is_cancelled=cancelled, sensitivity="normal",
            last_synced_at=now,
        )
        w.flush()
        for uid in dict.fromkeys([organizer] + list(attendees)):
            w.add(MeetingAttendee, id=did("attendee", m.id, uid), meeting_id=m.id,
                  email=emails[uid], display_name=names[uid], hermes_user_id=uid,
                  response_status="organizer" if uid == organizer else "accepted",
                  attendee_type="organizer" if uid == organizer else "required")
    w.flush()

    # --- Ticket Hub (yalnizca support tenant'inda) -----------------------
    settings = get_settings()
    if with_tickets is None:
        with_tickets = str(settings.HERMES_SUPPORT_TENANT_ID or "").strip() == tid
    tickets_note = "seeded" if with_tickets else "skipped (tenant is not HERMES_SUPPORT_TENANT_ID)"
    if with_tickets:
        agents = real_ids or [demo["grace"]["id"]]
        _seed_tickets(db, w, did, today=today, now=now, group=support_group,
                      agents=agents, names=names, environment=settings.PUBLIC_API_ENV or "dev")
    w.flush()

    return {
        "ok": True,
        "tenant_id": tid,
        "today": today.isoformat(),
        "real_users": len(real_ids),
        "demo_users": len(demo_ids),
        "tickets": tickets_note,
        "created": dict(sorted(w.created.items())),
    }


TICKETS = (
    # (anahtar, kaynak tenant, baslik, kategori, etki, oncelik, durum, talep eden index, atanmis mi, kac gun once)
    ("t1", "arkas", "Rampa randevusu kaydedilemiyor", "bug", "multiple_users", "high", "in_progress", 0, True, 2),
    ("t2", "arkas", "Günlük slot raporu boş geliyor", "bug", "single_user", "normal", "open", 1, False, 0),
    ("t3", "horoz", "Yeni depo için kullanıcı açılması", "question", "single_user", "low", "waiting_customer", 2, True, 4),
    ("t4", "horoz", "Araç plakası yanlış eşleşiyor", "data_correction", "single_user", "normal", "resolved", 3, True, 6),
    ("t5", "arkas", "Sisteme erişilemiyor (502 hatası)", "incident", "tenant_blocked", "urgent", "closed", 0, True, 12),
    ("t6", "horoz", "Toplu slot iptali özelliği", "improvement", "multiple_users", "low", "open", 2, False, 1),
    ("t7", "arkas", "Şoför SMS bildirimi gecikiyor", "bug", "multiple_users", "normal", "reopened", 1, True, 8),
    ("t8", "horoz", "Yetkisiz kullanıcı raporları görebiliyor", "bug", "security_or_data_risk", "urgent", "in_progress", 3, True, 1),
    ("t9", "arkas", "Yanlışlıkla açılmış kayıt", "question", "single_user", "low", "cancelled", 1, False, 5),
    ("t10", "horoz", "Excel içe aktarımda tarih formatı hatası", "bug", "single_user", "normal", "waiting_customer", 0, True, 3),
)

REQUESTERS = (
    ("mehmet.yilmaz", "Mehmet Yılmaz"),
    ("ayse.demir", "Ayşe Demir"),
    ("can.ozturk", "Can Öztürk"),
    ("zeynep.kaya", "Zeynep Kaya"),
)


def _seed_tickets(db, w: _Writer, did, *, today, now, group, agents, names, environment):
    from ..models.ticketing import (
        SupportApplication, SupportSourceTenant, SupportTicketRoute, Ticket, TicketEvent,
        TicketMessage, TicketResolution,
    )
    from ..services import tenant_counters
    from ..ticket_contract import (
        EVENT_TICKET_CLOSED, EVENT_TICKET_CREATED, EVENT_TICKET_RESOLVED,
        EVENT_TICKET_STATUS_CHANGED, TICKET_COUNTER_KEY,
    )

    # Callback YOK → outbox satiri uretilmez (dis sisteme hicbir sey gitmez).
    app_, _ = w.add(SupportApplication, id=did("support_app"), code="demo-logislot",
                    display_name="LogiSlot (Demo)", description="Dev ortamı demo uygulaması",
                    status="active", environment=environment, capabilities_json={})
    w.flush()
    sources = {}
    for key, label in (("arkas", "Arkas Lojistik (Demo)"), ("horoz", "Horoz Lojistik (Demo)")):
        st, _ = w.add(SupportSourceTenant, id=did("support_source", key), application_id=app_.id,
                      source_tenant_id=f"demo-{key}", source_tenant_slug=key, display_name=label,
                      status="active", metadata_json={})
        sources[key] = st
    w.flush()
    for key, st in sources.items():
        active = db.query(SupportTicketRoute.id).filter(
            SupportTicketRoute.source_tenant_row_id == st.id,
            SupportTicketRoute.is_active.is_(True)).first()
        if active is None:
            w.add(SupportTicketRoute, id=did("support_route", key), application_id=app_.id,
                  source_tenant_row_id=st.id, group_id=group.id, route_version=1, is_active=True,
                  configured_by_actor_type="system_job", configured_by_actor_id="dev_seed",
                  verified_at=now)
    w.flush()

    for n, (key, src, title, cat, impact, prio, status, req_i, assigned, days_ago) in enumerate(TICKETS):
        ticket_id = did("ticket", key)
        if db.get(Ticket, ticket_id) is not None:
            continue
        req_key, req_name = REQUESTERS[req_i]
        agent = agents[n % len(agents)]
        created = now - timedelta(days=days_ago, hours=2 + n)
        number = tenant_counters.next_number(db, tenant_id=w.tenant_id, counter_key=TICKET_COUNTER_KEY)
        msgs = [("public", "requester", None,
                 f"Merhaba, {title.lower()}. Ekip olarak işlemlerimizi yapamıyoruz, yardımcı olabilir misiniz?")]
        if status != "open" and status != "cancelled":
            msgs.append(("public", "agent", agent,
                         "Merhaba, kaydınızı aldık ve inceliyoruz. Kısa süre içinde dönüş yapacağız."))
            msgs.append(("internal", "agent", agent,
                         "İç not: son deploy ile ilişkili olabilir, log'ları kontrol ediyorum."))
        if status == "waiting_customer":
            msgs.append(("public", "agent", agent,
                         "Sorunu tekrar üretebilmemiz için ekran görüntüsü ve işlem saatini paylaşır mısınız?"))
        if status == "reopened":
            msgs.append(("public", "requester", None, "Sorun bu sabah tekrar etti, kaydı yeniden açıyorum."))
        if status in ("resolved", "closed"):
            msgs.append(("public", "agent", agent, "Düzeltme canlıya alındı. Kontrol edip bilgi verir misiniz?"))
        resolved_at = created + timedelta(days=1) if status in ("resolved", "closed") else None
        closed_at = created + timedelta(days=3) if status == "closed" else None
        if status == "cancelled":
            closed_at = created + timedelta(hours=3)
        first_response = created + timedelta(hours=1) if len(msgs) > 1 else None
        resolution_id = did("ticket_resolution", key) if resolved_at else None
        events = [(created, EVENT_TICKET_CREATED, "integration_client", None)]
        if status in ("in_progress", "waiting_customer", "reopened", "resolved", "closed"):
            events.append((created + timedelta(hours=1), EVENT_TICKET_STATUS_CHANGED, "support_agent", agent))
        if resolved_at:
            events.append((resolved_at, EVENT_TICKET_RESOLVED, "support_agent", agent))
        if status == "closed":
            events.append((closed_at, EVENT_TICKET_CLOSED, "system_job", None))
        if status == "cancelled":
            events.append((closed_at, EVENT_TICKET_STATUS_CHANGED, "integration_client", None))
        last_at = max(created + timedelta(hours=2 * (len(msgs) - 1)), events[-1][0])
        w.add(
            Ticket, id=ticket_id, number=number, application_id=app_.id,
            source_tenant_row_id=sources[src].id, source_ticket_id=f"DEMO-{key.upper()}",
            requester_source_user_id=f"{src}-{req_key}", requester_display_name=req_name,
            requester_email=f"{req_key}@{src}.{DEMO_EMAIL_DOMAIN}", title=title, category=cat,
            impact=impact, priority=prio,
            reproduction_steps="1. Uygulamaya giriş yap\n2. İlgili ekranı aç\n3. Kaydet'e bas",
            expected_result="İşlem başarıyla kaydedilmeli.",
            actual_result="Hata mesajı görüntüleniyor.", error_code="E-4012" if cat == "bug" else None,
            correlation_id=f"demo-{key}", occurred_at=created - timedelta(minutes=20),
            client_context_json={"app_version": "4.12.0", "locale": "tr-TR"},
            status=status, assigned_group_id=group.id, assigned_group_name_snapshot=group.name,
            assigned_user_id=agent if assigned else None, route_version=1,
            first_response_at=first_response, resolved_at=resolved_at, closed_at=closed_at,
            last_public_activity_at=last_at, current_resolution_id=resolution_id,
            resolution_revision=1 if resolution_id else 0, version=len(events),
            event_sequence=len(events), created_at=created, updated_at=last_at,
        )
        w.flush()
        for seq, (vis, author_type, author, body) in enumerate(msgs, start=1):
            w.add(TicketMessage, id=did("ticket_message", key, seq), ticket_id=ticket_id,
                  sequence=seq, visibility=vis, author_type=author_type, author_user_id=author,
                  author_source_user_id=f"{src}-{req_key}" if author_type == "requester" else None,
                  author_display_name=req_name if author_type == "requester" else names.get(author),
                  body=body, body_format="plain", created_at=created + timedelta(hours=2 * (seq - 1)))
        if resolution_id:
            w.add(TicketResolution, id=resolution_id, ticket_id=ticket_id, revision=1,
                  resolution_code="fixed",
                  public_summary="Hata giderildi ve düzeltme canlı ortama alındı.",
                  internal_root_cause="Önbellek anahtarı kiracı kimliğini içermiyordu.",
                  fix_version="4.12.1", resolved_by_user_id=agent,
                  resolved_by_display_name=names.get(agent), resolved_at=resolved_at)
        for seq, (at, etype, actor_type, actor) in enumerate(events, start=1):
            w.add(TicketEvent, id=did("ticket_event", key, seq), ticket_id=ticket_id, sequence=seq,
                  event_type=etype, aggregate_version=seq, actor_type=actor_type,
                  actor_id=str(actor) if actor else None,
                  actor_display_name=names.get(actor) if actor else "LogiSlot (Demo)",
                  metadata_json={"source": "dev_seed"}, correlation_id=f"demo-{key}", occurred_at=at)
        w.flush()


# =============================================================================
# Purge
# =============================================================================

_FK_SQL = """
SELECT con.conrelid::regclass::text AS child,
       con.confrelid::regclass::text AS parent,
       con.confdeltype AS on_delete,
       ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n
             ORDER BY k.i) AS child_cols,
       ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
             JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n
             ORDER BY k.i) AS parent_cols
  FROM pg_constraint con
  JOIN pg_namespace ns ON ns.oid = con.connamespace
 WHERE con.contype = 'f' AND ns.nspname = current_schema()
"""

_PK_SQL = """
SELECT a.attname::text
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
 WHERE i.indrelid = CAST(:t AS regclass) AND i.indisprimary
"""


def _fk_edges(db: Session) -> List[dict]:
    """Cocuk → ebeveyn FK kenarlari; tenant_id cifti dusulur (composite FK)."""
    edges = []
    for child, parent, on_delete, ccols, pcols in db.execute(text(_FK_SQL)).all():
        pairs = [(c, p) for c, p in zip(ccols, pcols) if c != "tenant_id"]
        if len(pairs) != 1:
            continue
        edges.append({"child": child, "parent": parent, "on_delete": on_delete,
                      "col": pairs[0][0], "ref": pairs[0][1]})
    return edges


def _pk(db: Session, table: str, cache: dict) -> str:
    if table not in cache:
        cols = [c for c in db.execute(text(_PK_SQL), {"t": table}).scalars().all() if c != "tenant_id"]
        if len(cols) != 1:
            raise RuntimeError(f"purge: {table} has no single-column primary key")
        cache[table] = cols[0]
    return cache[table]


def collect_purge_set(db: Session, *, tenant_id: str) -> Dict[str, set]:
    """Silinecek satirlar: isaretli id'ler + FK ile onlara bagli satirlar.

    ON DELETE SET NULL kenarlari TAKIP EDILMEZ: o cocuk satir demo
    veriye yalnizca referans verir (ornegin gercek bir efor kaydi demo
    toplantiya); satir kalir, referansi DB NULL'lar.
    """
    from ..models.mixins import tenant_owned_tables

    tid = str(tenant_id)
    pk_cache: dict = {}
    to_delete: Dict[str, set] = defaultdict(set)
    frontier: List[tuple] = []
    owned = set(tenant_owned_tables())
    for table in sorted(owned):
        cols = {c for (c,) in db.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = :t"), {"t": table}).all()}
        if "id" not in cols:
            continue
        ids = db.execute(text(
            f"SELECT CAST(id AS text) FROM {table} "
            "WHERE tenant_id = CAST(:t AS uuid) AND CAST(id AS text) LIKE :p"
        ), {"t": tid, "p": demo_id_sql_pattern()}).scalars().all()
        ids = {i for i in ids if is_demo_id(i)}
        if ids:
            to_delete[table] |= ids
            frontier.append((table, ids))

    edges = _fk_edges(db)
    by_parent: Dict[str, list] = defaultdict(list)
    for e in edges:
        by_parent[e["parent"]].append(e)
    while frontier:
        table, ids = frontier.pop()
        for e in by_parent.get(table, ()):
            if e["on_delete"] == "n":  # SET NULL: takip etme
                continue
            if e["child"] not in owned:
                raise RuntimeError(f"purge: {e['child']} references demo rows but is not tenant-owned")
            child_pk = _pk(db, e["child"], pk_cache)
            rows = db.execute(text(
                f"SELECT CAST({child_pk} AS text) FROM {e['child']} "
                f"WHERE tenant_id = CAST(:t AS uuid) AND CAST({e['col']} AS text) = ANY(:ids)"
            ), {"t": tid, "ids": list(ids)}).scalars().all()
            new = set(rows) - to_delete[e["child"]]
            if new:
                to_delete[e["child"]] |= new
                frontier.append((e["child"], new))
    return {t: ids for t, ids in to_delete.items() if ids}


def purge(db: Session, *, tenant_id: str) -> dict:
    """Tohumu (ve ona bagli satirlari) cocuktan ebeveyne siler."""
    tid = str(tenant_id)
    to_delete = collect_purge_set(db, tenant_id=tid)
    edges = [e for e in _fk_edges(db) if e["child"] in to_delete and e["parent"] in to_delete]
    pk_cache: dict = {}

    # Kendi kendine referanslar (work_items.parent_id, tickets.duplicate_of):
    # silinecek kume icinde once NULL'lanir ki sira sorunu cikmasin.
    for e in edges:
        if e["child"] == e["parent"]:
            pk = _pk(db, e["child"], pk_cache)
            db.execute(text(
                f"UPDATE {e['child']} SET {e['col']} = NULL "
                f"WHERE tenant_id = CAST(:t AS uuid) AND CAST({pk} AS text) = ANY(:ids)"
            ), {"t": tid, "ids": list(to_delete[e["child"]])})

    remaining = set(to_delete)
    deps = defaultdict(set)  # ebeveyn -> onu referanslayan cocuk tablolar
    for e in edges:
        if e["child"] != e["parent"]:
            deps[e["parent"]].add(e["child"])
    deleted: Dict[str, int] = {}
    while remaining:
        ready = sorted(t for t in remaining if not (deps[t] & remaining))
        if not ready:
            raise RuntimeError(f"purge: FK cycle among {sorted(remaining)}")
        for table in ready:
            pk = _pk(db, table, pk_cache)
            deleted[table] = db.execute(text(
                f"DELETE FROM {table} WHERE tenant_id = CAST(:t AS uuid) "
                f"AND CAST({pk} AS text) = ANY(:ids)"
            ), {"t": tid, "ids": list(to_delete[table])}).rowcount
            remaining.discard(table)
    return {"ok": True, "tenant_id": tid, "deleted": dict(sorted(deleted.items()))}


# =============================================================================
# Giris noktasi
# =============================================================================

def main(argv: Optional[Sequence[str]] = None) -> int:
    from ..config import get_settings

    args = list(sys.argv[1:] if argv is None else argv)
    try:
        assert_dev_only(args, public_api_env=get_settings().PUBLIC_API_ENV)
    except DevSeedRefused as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED

    slug = DEFAULT_TENANT_SLUG
    if "--tenant-slug" in args:
        slug = args[args.index("--tenant-slug") + 1]

    from ..database import SessionLocal
    from ..tenant_db import bind_tenant

    db = SessionLocal()
    summary: dict = {}
    try:
        tenant_id = resolve_tenant_id(db, slug)
        bind_tenant(db, tenant_id)
        if "--purge" in args or "--reseed" in args:
            summary["purge"] = purge(db, tenant_id=tenant_id)
        if "--purge" not in args:
            users = discover_real_users(db, tenant_id)
            summary["seed"] = seed(db, tenant_id=tenant_id, real_users=users)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(json.dumps({"ok": False, "error": type(exc).__name__,
                          "detail": str(exc)[:500]}), file=sys.stderr)
        return 1
    finally:
        db.close()
    print(json.dumps(summary, default=str, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
