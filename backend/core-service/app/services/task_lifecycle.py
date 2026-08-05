"""
=============================================================================
HERMES - Work item lifecycle: logical kimlik, kapanis ve arsiv (TEK KAYNAK)
=============================================================================
Board, List, Explorer, scheduler ve API kendi logical-identity veya
kapanis algoritmasini YAZMAZ; hepsi bu modulu cagirir.

-----------------------------------------------------------------------
LOGICAL KIMLIK
-----------------------------------------------------------------------
Ayni Create-Task eylemi her assignee icin AYRI `tasks` satiri yazar ama
hepsine TEK `assignment_batch_id` basar (create_tasks_bulk /
create_tasks_for_group / Public API). Dolayisiyla:

    assignment_batch_id doluysa  → logical kimlik = batch id
    bos ise                      → logical kimlik = task.id (singleton)

Baslik/aciklama/tarih/assignee BENZERLIGI ile gruplama YAPILMAZ.

-----------------------------------------------------------------------
KAPANIS (closed_at) SOZLESMESI
-----------------------------------------------------------------------
Terminal durumlar: completed, rejected.
Terminal OLMAYAN: pending, in_progress, cancelled.

  - Herhangi bir assignment terminal degilse      → closed_at = NULL
  - Hepsi terminal ve closed_at NULL ise          → closed_at = terminal
                                                    kosulun ILK saglandigi an
  - Terminalden terminale gecis (completed↔rejected) closed_at'i SIFIRLAMAZ
  - Herhangi biri pending/in_progress'e donerse   → closed_at, archived_at,
                                                    archive_reason,
                                                    archived_by_user_id
                                                    TUM GRUP icin temizlenir

`updated_at` retention baslangici DEGILDIR: aciklama/priority/termin
degisikligi sureyi sifirlamaz. Bu yuzden runtime hesabinda yalnizca
closed_at kullanilir.

DIKKAT — `cancelled`: katalogda var ama bu turda otomatik arsiv
politikasina DAHIL EDILMEDI (sessizce terminal sayilmiyor). Yani icinde
cancelled assignment olan bir logical item kapanmaz ve otomatik
arsivlenmez. Urunde cancelled'in gercekten "kapanmis" sayilip
sayilmayacagi KULLANICI KARARIDIR; karar verilene kadar guvenli taraf
(arsivlememek) secildi.

-----------------------------------------------------------------------
GORUNURLUK
-----------------------------------------------------------------------
Kapanis hesabi logical item'in TUM gercek assignment'lari uzerinden
yapilir (RBAC ile kirpilmis alt kume uzerinden DEGIL) — aksi halde
gormedigi bir assignment yuzunden kullanicidan kapanmis gibi gorunen
bir is otomatik arsivlenirdi. Sunum katmani (response/UI) mevcut RBAC
gorunurlugunu korur; bu modul isim/sayi DONDURMEZ.
=============================================================================
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.task import Task

TERMINAL_STATUSES = frozenset({"completed", "rejected"})

#: Additive, idempotent sema ifadeleri. TEK KAYNAK: uygulama startup'i
#: (main._migrate_tasks_lifecycle) ve test kurulumu (conftest) AYNI
#: listeyi kosar. Ikinci bir kopya, testte gecip uretimde patlayan bir
#: sema kaymasi uretirdi.
LIFECYCLE_SCHEMA_STATEMENTS = (
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(20)",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_by_user_id UUID",
    "CREATE INDEX IF NOT EXISTS idx_tasks_closed_at ON tasks(closed_at)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_retention "
    "ON tasks(closed_at, archived_at)",
    # Politika tablosu: create_all yaratir, ama mevcut DB'de tabloyu
    # garanti etmek icin burada da idempotent olarak aciklanir.
    "CREATE TABLE IF NOT EXISTS task_lifecycle_policy ("
    "  id UUID PRIMARY KEY, singleton BOOLEAN NOT NULL DEFAULT TRUE, "
    "  retention_days INTEGER, "
    "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
    "  updated_by_user_id UUID, "
    "  CONSTRAINT uq_task_lifecycle_policy_single UNIQUE (singleton), "
    "  CONSTRAINT chk_task_lifecycle_singleton CHECK (singleton IS TRUE), "
    "  CONSTRAINT chk_task_lifecycle_retention_days CHECK ("
    "    retention_days IS NULL OR (retention_days > 0 "
    "    AND retention_days <= 3650))"
    ")",
    # Onceden arsivlenmis kayitlarin sebebi BILINMIYOR — uydurulmaz,
    # 'legacy' olarak siniflanir. Yalniz BOS olanlar doldurulur.
    "UPDATE tasks SET archive_reason = 'legacy' "
    "WHERE archived_at IS NOT NULL AND archive_reason IS NULL",
)

#: TARIHSEL BACKFILL (§8) — idempotent, veri SILMEZ, `updated_at`
#: DEGISTIRMEZ. Yalnizca closed_at'i BOS olan ve TUM satirlari terminal
#: olan logical gruplari doldurur.
#:
#: Terminal an onceligi:
#:   completed satir → completed_at, yoksa task_completed audit event'i,
#:                     yoksa (yalniz migration fallback'i) updated_at
#:   rejected satir  → task_rejected audit event'i,
#:                     yoksa (yalniz migration fallback'i) updated_at
#: Grubun closed_at'i satirlarin terminal anlarinin EN GEC olanidir.
#:
#: Aktif (pending/in_progress/cancelled) satir iceren grup KAPANMAZ.
#: Baslik/tarih benzerligiyle gruplama YOK: kimlik yalnizca
#: assignment_batch_id, yoksa satirin kendi id'sidir.
LIFECYCLE_BACKFILL_SQL = """
WITH row_moment AS (
    SELECT
        t.id,
        COALESCE(t.assignment_batch_id::text, 'task:' || t.id::text)
            AS logical_key,
        t.status,
        COALESCE(
            CASE WHEN t.status = 'completed' THEN t.completed_at END,
            (
                SELECT max(e.created_at)
                FROM task_activity_events e
                WHERE e.task_id = t.id
                  AND e.event_type = CASE
                        WHEN t.status = 'completed' THEN 'task_completed'
                        ELSE 'task_rejected'
                      END
            ),
            t.updated_at
        ) AS moment
    FROM tasks t
),
groups AS (
    SELECT
        r.logical_key,
        bool_and(r.status IN ('completed', 'rejected')) AS all_terminal,
        max(r.moment) AS closed_moment
    FROM row_moment r
    GROUP BY r.logical_key
)
UPDATE tasks t
SET closed_at = g.closed_moment
FROM row_moment r
JOIN groups g ON g.logical_key = r.logical_key
WHERE t.id = r.id
  AND t.closed_at IS NULL
  AND g.all_terminal
  AND g.closed_moment IS NOT NULL
"""

#: Varsayilan retention (gun). UI secenekleri: 1 / 7 / 14 / 30 / Never.
DEFAULT_RETENTION_DAYS = 7
ALLOWED_RETENTION_DAYS = (1, 7, 14, 30)

ARCHIVE_REASON_AUTO = "auto_retention"
ARCHIVE_REASON_MANUAL = "manual"
ARCHIVE_REASON_LEGACY = "legacy"


def logical_key(task: Task) -> str:
    """Satirin ait oldugu logical work item'in kararli anahtari."""
    if task.assignment_batch_id:
        return f"batch:{task.assignment_batch_id}"
    return f"task:{task.id}"


def sibling_rows(db: Session, task: Task) -> List[Task]:
    """Logical item'in TUM satirlari (gorunurluk kirpmasi YOK).

    Singleton'da tek elemanli liste doner.
    """
    if not task.assignment_batch_id:
        return [task]
    return (
        db.query(Task)
        .filter(Task.assignment_batch_id == task.assignment_batch_id)
        .all()
    )


def is_terminal(status: Optional[str]) -> bool:
    return status in TERMINAL_STATUSES


def all_terminal(rows: List[Task]) -> bool:
    return bool(rows) and all(is_terminal(r.status) for r in rows)


def _terminal_moment(rows: List[Task], now: datetime) -> datetime:
    """Grubun terminal hale geldigi an.

    En guvenilir sinyal completed_at'tir; rejected satirda bu alan
    bilincli olarak NULL'dir (mevcut urun davranisi), o yuzden eksik
    olanlar icin CAGRI ANI kullanilir. Bu yalnizca RUNTIME icindir —
    tarihsel backfill audit event'lerine bakar (bkz. migration).
    """
    stamps = [r.completed_at for r in rows if r.completed_at is not None]
    return max(stamps) if stamps else now


def recompute_closure(
    db: Session,
    task: Task,
    *,
    now: Optional[datetime] = None,
    require_work_log: bool = False,
) -> None:
    """Logical item'in kapanis/arsiv alanlarini YENIDEN hesaplar.

    Complete / Reject / Reopen / status update / restore ve Log Time
    basari akisindan SONRA cagrilir. Grup icindeki BUTUN satirlara ayni
    degerleri yazar — parcali (bir kismi kapali) grup olusmaz.

    `require_work_log=True` iken: completed bir assignment'in kanonik
    Log Time kaydi henuz yoksa grup KAPANMIS SAYILMAZ. Boylece
    "completed ama saati girilmemis" isler otomatik arsiv sirasina
    girmez.
    """
    now = now or datetime.now(timezone.utc)
    rows = sibling_rows(db, task)

    if not all_terminal(rows):
        # Yeniden acilma: kapanis VE arsiv izleri tum grup icin silinir.
        for row in rows:
            row.closed_at = None
            row.archived_at = None
            row.archive_reason = None
            row.archived_by_user_id = None
        return

    if require_work_log and not _work_logs_complete(db, rows):
        for row in rows:
            row.closed_at = None
        return

    # Hepsi terminal. Zaten kapaliysa DOKUNMA — terminalden terminale
    # gecis (completed ↔ rejected) sureyi sifirlamaz.
    existing = [r.closed_at for r in rows if r.closed_at is not None]
    moment = min(existing) if existing else _terminal_moment(rows, now)
    for row in rows:
        row.closed_at = moment


def _work_logs_complete(db: Session, rows: List[Task]) -> bool:
    """Completed her assignment'in bir work log kaydi var mi?

    Rejected assignment icin Log Time ARANMAZ. Work log tablosuna
    yalnizca OKUMA yapilir — bu modul work_logs'u asla degistirmez.
    """
    from ..models.work_log import WorkLog

    needing = [r.id for r in rows if r.status == "completed"]
    if not needing:
        return True
    logged = {
        row[0]
        for row in db.query(WorkLog.task_id)
        .filter(WorkLog.task_id.in_(needing))
        .distinct()
        .all()
    }
    return all(tid in logged for tid in needing)


def archive_group(
    db: Session,
    task: Task,
    *,
    reason: str,
    actor_user_id: Optional[UUID],
    now: Optional[datetime] = None,
) -> List[Task]:
    """Logical item'in TUM satirlarini arsivler (parcali arsiv YOK).

    Kalici silme yapmaz; yalnizca lifecycle metadata'si yazar. Zaten
    arsivlenmis satirlara yeniden damga vurmaz (idempotent).
    """
    now = now or datetime.now(timezone.utc)
    rows = sibling_rows(db, task)
    for row in rows:
        if row.archived_at is None:
            row.archived_at = now
            row.archive_reason = reason
            row.archived_by_user_id = actor_user_id
    return rows


def restore_group(db: Session, task: Task) -> List[Task]:
    """Arsivden cikarir: arsiv izleri TUM grup icin temizlenir.

    Status'a DOKUNMAZ — hangi assignment'in yeniden acilacagi cagiranin
    (acik kullanici secimi olan) kararidir. Yalniz arsiv alanlarini
    temizlemek yetmez; cagiran ardindan bir assignment'i terminal
    olmayan bir duruma tasimali, aksi halde is bir sonraki job
    kosusunda yeniden arsivlenir.
    """
    rows = sibling_rows(db, task)
    for row in rows:
        row.archived_at = None
        row.archive_reason = None
        row.archived_by_user_id = None
    return rows


# =============================================================================
# Politika erisimi
# =============================================================================
def get_policy(db: Session):
    """Tekil politika satirini dondurur; yoksa varsayilanla OLUSTURUR.

    Cagiran her yerde ayni varsayilani tekrar yazmasin diye tek kapi.
    """
    from ..models.task import TaskLifecyclePolicy

    row = db.query(TaskLifecyclePolicy).first()
    if row is None:
        # Varsayilan YALNIZ burada uygulanir (model tarafinda degil —
        # orada bir default, acikca verilen None'i ezerdi).
        row = TaskLifecyclePolicy(
            singleton=True, retention_days=DEFAULT_RETENTION_DAYS
        )
        db.add(row)
        db.flush()
    return row


def set_policy(db: Session, *, retention_days: Optional[int], actor_user_id):
    """Politikayi gunceller. `retention_days=None` → Never (otomatik
    arsiv kapali). Gecerlilik kontrolu CAGIRANDA degil burada yapilir."""
    if retention_days is not None and retention_days not in ALLOWED_RETENTION_DAYS:
        raise ValueError("unsupported retention_days")
    row = get_policy(db)
    row.retention_days = retention_days
    row.updated_by_user_id = actor_user_id
    return row


def retention_cutoff(policy, now: Optional[datetime] = None):
    """Politikaya gore kapanis kesme noktasi.

    `Never` ise None doner — cagiran otomatik arsivi ATLAR.
    """
    from datetime import timedelta

    if policy.retention_days is None:
        return None
    return (now or datetime.now(timezone.utc)) - timedelta(
        days=policy.retention_days
    )
