# =============================================================================
# HERMES - Tenant modul katalogu (TEK kaynak)
# =============================================================================
# Bir tenant Hermes'in hangi BOLUMLERINI kullanir? (docs/tenant-platform/
# 00-plan.md §2). RBAC "ne yapabilir"i, modul "bu tenant'ta bu bolum var
# mi"yi soyler; ikisi de her istekte, fail-closed:
#
#   - Efektif izin = rol izinleri ∩ katalog ∩ ACIK MODULLERIN izinleri
#     (auth rbac_service). Kapali modulun izni rol uzerinden SIZAMAZ.
#   - Izinsiz-acik uclar (zaman girisi, toplantilar...) core'da router
#     duzeyinde modul kapisindan gecer → kapaliysa 404.
#
# Cekirdek (her zaman acik, listede YOK): ana sayfa, ayarlar, kullanicilar/
# roller/gruplar, musteri/proje verisi. Cekirdek izinler hicbir module bagli
# degildir.
#
# Frontend aynasi: frontend/src/features/modules/catalog.js (parite testi).
# Yeni modul = buraya kod + (varsa) izinleri + bagimliligi; mevcut tenant'lar
# yeni modulu KENDILIGINDEN almaz (migration/yonetici karari).
# =============================================================================

from typing import Dict, FrozenSet, Iterable, List, Tuple

from .permissions import Perm


class Module:
    TIME_ENTRY = "time_entry"
    WORK = "work"
    MEETINGS = "meetings"
    TICKETS = "tickets"
    REPORTS = "reports"
    DEVELOPER = "developer"


# Katalog SIRASI arayuzun sirasidir (menu, kartlar).
ALL_MODULES: Tuple[str, ...] = (
    Module.TIME_ENTRY,
    Module.WORK,
    Module.MEETINGS,
    Module.TICKETS,
    Module.REPORTS,
    Module.DEVELOPER,
)

MODULE_DESCRIPTIONS: Dict[str, str] = {
    Module.TIME_ENTRY: "Time entry, effort and capacity, time reference data",
    Module.WORK: "Work management: tasks, views, PM configuration, work notifications",
    Module.MEETINGS: "Meetings and calendar (Outlook sync)",
    Module.TICKETS: "Ticket management: hub, customer portal, integrations",
    Module.REPORTS: "Dashboard, reports, billable hours, contract status",
    Module.DEVELOPER: "Developer platform: portal, API management, Public API, MCP",
}

# Bir modul ancak bagimli oldugu moduller de aciksa acilabilir.
# Raporlar zaman girisi verisinden uretilir (work_logs).
MODULE_REQUIRES: Dict[str, Tuple[str, ...]] = {
    Module.REPORTS: (Module.TIME_ENTRY,),
}

# Hangi izin hangi module aittir. Listede olmayan izin CEKIRDEKTIR.
PERMISSION_MODULE: Dict[str, str] = {
    Perm.WORKLOGS_ADMIN: Module.TIME_ENTRY,
    Perm.REFERENCE_MANAGE: Module.TIME_ENTRY,
    Perm.TASKS_ACCESS: Module.WORK,
    Perm.TASKS_ASSIGN: Module.WORK,
    Perm.ISSUES_ACCESS: Module.WORK,
    Perm.ISSUES_ASSIGN: Module.WORK,
    Perm.TASKS_ADMIN: Module.WORK,
    Perm.TASK_PERMISSIONS_MANAGE: Module.WORK,
    Perm.MEETINGS_ADMIN: Module.MEETINGS,
    Perm.TICKETS_ACCESS: Module.TICKETS,
    Perm.TICKETS_CREATE: Module.TICKETS,
    Perm.TICKETS_RESPOND: Module.TICKETS,
    Perm.TICKETS_RESOLVE: Module.TICKETS,
    Perm.TICKETS_ASSIGN: Module.TICKETS,
    Perm.TICKETS_VIEW_ALL: Module.TICKETS,
    Perm.TICKETS_ADMIN: Module.TICKETS,
    Perm.TICKETS_CONFIG_MANAGE: Module.TICKETS,
    Perm.REPORTS_VIEW: Module.REPORTS,
    Perm.API_MANAGE: Module.DEVELOPER,
}


class ModuleSelectionError(ValueError):
    """Gecersiz modul secimi (bilinmeyen kod ya da eksik bagimlilik)."""


def normalize(codes: Iterable[str]) -> List[str]:
    """Secimi dogrular ve KATALOG SIRASINDA, tekil liste dondurur.

    Bilinmeyen kod ya da bagimliligi secilmemis modul → ModuleSelectionError.
    Bos secim GECERLIDIR (yalniz cekirdek: ana sayfa, ayarlar, kullanicilar).
    """
    wanted = {str(c).strip() for c in (codes or []) if str(c).strip()}
    unknown = sorted(wanted - set(ALL_MODULES))
    if unknown:
        raise ModuleSelectionError(f"Unknown module(s): {', '.join(unknown)}")
    for code in wanted:
        missing = [dep for dep in MODULE_REQUIRES.get(code, ()) if dep not in wanted]
        if missing:
            raise ModuleSelectionError(
                f"Module '{code}' requires: {', '.join(missing)}"
            )
    return [code for code in ALL_MODULES if code in wanted]


def coerce(value) -> FrozenSet[str]:
    """Veritabanindan gelen degeri guvenle kumeye cevirir (fail-closed).

    Liste degilse ya da bozuksa BOS kume: modul bilgisi okunamayan bir
    tenant'ta hicbir modul acilmaz (cekirdek kalir). Bilinmeyen kodlar
    sessizce atilir (katalogdan cikarilmis modul diriltilmez).
    """
    if not isinstance(value, (list, tuple)):
        return frozenset()
    return frozenset(c for c in value if isinstance(c, str) and c in ALL_MODULES)


def module_allows_permission(permission: str, modules: Iterable[str]) -> bool:
    module = PERMISSION_MODULE.get(permission)
    return module is None or module in set(modules)


def filter_permissions(permissions: Iterable[str], modules: Iterable[str]) -> FrozenSet[str]:
    """Izin kumesinden KAPALI modullere ait olanlari cikarir."""
    enabled = set(modules)
    return frozenset(
        p for p in permissions
        if PERMISSION_MODULE.get(p) is None or PERMISSION_MODULE[p] in enabled
    )
