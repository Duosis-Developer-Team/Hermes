# =============================================================================
# HERMES - RBAC permission katalogu (TEK KAYNAK)
# =============================================================================
# Hem auth-service (rol dogrulama/bootstrap) hem core-service (guard'lar)
# bu modulu import eder. MCP-service ASLA import etmez (yapisal test).
#
# Adlandirma: "alan.eylem", nokta ayracli, kucuk harf. Public API
# scope'lari (tasks:read — iki nokta ust uste) AYRI bir yetki uzayidir;
# ayrac farki bilinclidir: iki uzay gorsel olarak da karismaz.
#
# LogiSlot derslerinden farklar (RBAC tasarim karari, 17.07.2026):
#   - ALL listesi ELLE TUTULMAZ — sinif alanlarindan turetilir. LogiSlot'ta
#     manuel ALL + 6 senkron noktasi drift uretmisti.
#   - Her iznin aciklamasi zorunludur (test kilitli) — katalog ayni
#     zamanda UI'nin izin editorunu besler.
#   - Katalogdan cikarilan bir izin, rollerde kayitli kalsa bile efektif
#     hesapta filtrelenir (rbac_service.effective_permissions) — olu izin
#     sessizce yasayamaz.
# =============================================================================


class Perm:
    """RBAC izin sabitleri. Yeni izin eklemek = buraya sabit + aciklama
    eklemek; ALL kendiliginden gunceller, system-admin rolu bir sonraki
    auth-service startup'inda yeni izni otomatik alir (bootstrap sync)."""

    USERS_MANAGE = "users.manage"
    ROLES_MANAGE = "roles.manage"
    GROUPS_MANAGE = "groups.manage"
    # RBAC cutover (2026-08-04): task-modulu operasyonel izinleri artik
    # ROLLERDEN gelir — PM Configurations'taki legacy access tablolari
    # karar kaynagi degildir. "Ne yapabilir" = rol; "kime yapabilir" =
    # assignment hierarchy (PM Configurations'ta kalir).
    TASKS_ACCESS = "tasks.access"
    TASKS_ASSIGN = "tasks.assign"
    ISSUES_ACCESS = "issues.access"
    ISSUES_ASSIGN = "issues.assign"
    TASKS_ADMIN = "tasks.admin"
    TASK_PERMISSIONS_MANAGE = "tasks.permissions.manage"
    API_MANAGE = "api.manage"
    REPORTS_VIEW = "reports.view"
    PLANS_MANAGE = "plans.manage"
    WORKLOGS_ADMIN = "worklogs.admin"
    MEETINGS_ADMIN = "meetings.admin"
    CUSTOMERS_MANAGE = "customers.manage"
    PROJECTS_MANAGE = "projects.manage"
    REFERENCE_MANAGE = "reference.manage"
    # -----------------------------------------------------------------
    # Ortak urun ticket platformu (Ticket Hub — 2026-08-25)
    # -----------------------------------------------------------------
    # Iki YUZEY, tek katalog: normal tenant'ta musteri destek portali,
    # Duosis support tenant'inda agent hub'i. Hangi yuzeyin acilacagini
    # izinler DEGIL, istegin tenant'i belirler (bkz.
    # services/support_tenant.py) — izinler "ne yapabilir"i soyler.
    TICKETS_ACCESS = "tickets.access"
    TICKETS_CREATE = "tickets.create"
    TICKETS_RESPOND = "tickets.respond"
    TICKETS_RESOLVE = "tickets.resolve"
    TICKETS_ASSIGN = "tickets.assign"
    TICKETS_VIEW_ALL = "tickets.view_all"
    TICKETS_ADMIN = "tickets.admin"
    TICKETS_CONFIG_MANAGE = "tickets.config.manage"


# Aciklamalar (Ingilizce — API/dokuman dili). UI Turkce etiketlerini
# frontend tarafinda tutar (LogiSlot PERMISSION_LABELS deseni).
PERMISSION_DESCRIPTIONS = {
    Perm.USERS_MANAGE: (
        "Create, update and deactivate Hermes users; assign roles."
    ),
    Perm.ROLES_MANAGE: (
        "Create and edit RBAC roles and their permission sets."
    ),
    Perm.GROUPS_MANAGE: "Manage user groups and group memberships.",
    Perm.TASKS_ACCESS: (
        "Access the task module: see tasks assigned to you."
    ),
    Perm.TASKS_ASSIGN: (
        "Create tasks and assign them to targets allowed by the "
        "assignment hierarchy. Requires tasks.access."
    ),
    Perm.ISSUES_ACCESS: (
        "Access issues & suggestions assigned to you."
    ),
    Perm.ISSUES_ASSIGN: (
        "Create issues & suggestions and assign them to targets allowed "
        "by the assignment hierarchy. Requires issues.access."
    ),
    Perm.TASKS_ADMIN: (
        "Full task-module authority: covers all four operational task "
        "permissions, sees and edits every work item and bypasses the "
        "assignment hierarchy. Does NOT include PM configuration "
        "management."
    ),
    Perm.TASK_PERMISSIONS_MANAGE: (
        "Manage PM configuration: assignment hierarchies, sub-projects "
        "and task notification settings."
    ),
    Perm.API_MANAGE: (
        "Manage Public API clients, tokens, data-access bindings and "
        "request logs (Developer Platform administration)."
    ),
    Perm.REPORTS_VIEW: (
        "View company-wide reports, dashboards and exports (not limited "
        "to own records)."
    ),
    Perm.PLANS_MANAGE: "Manage plan/time configuration (plan times).",
    Perm.WORKLOGS_ADMIN: (
        "Create, edit and list work logs on behalf of other users."
    ),
    Perm.MEETINGS_ADMIN: (
        "See all meetings and trigger calendar syncs for other users."
    ),
    Perm.CUSTOMERS_MANAGE: "Manage customers.",
    Perm.PROJECTS_MANAGE: (
        "Manage projects, sub-project structure and project memberships."
    ),
    Perm.REFERENCE_MANAGE: (
        "Manage reference data: work types, work lines, platforms and "
        "activity types."
    ),
    Perm.TICKETS_ACCESS: (
        "Open the support ticket module. Data scope is decided "
        "separately: support agents see the tickets of groups they are "
        "an active member of; customer users see their own tickets."
    ),
    Perm.TICKETS_CREATE: (
        "Raise a new support ticket on behalf of your own workspace. "
        "Requires tickets.access."
    ),
    Perm.TICKETS_RESPOND: (
        "Post public replies and internal notes and move a ticket "
        "through its normal working states. Requires tickets.access."
    ),
    Perm.TICKETS_RESOLVE: (
        "Resolve, reopen and close tickets, including writing the "
        "customer-visible resolution. Requires tickets.access."
    ),
    Perm.TICKETS_ASSIGN: (
        "Change the support group a ticket belongs to and assign it to "
        "an agent inside that group. Requires tickets.access."
    ),
    Perm.TICKETS_VIEW_ALL: (
        "See every ticket raised by your own workspace, not only your "
        "own. Requires tickets.access."
    ),
    Perm.TICKETS_ADMIN: (
        "Full support authority inside the Duosis support workspace: "
        "see and act on every canonical ticket regardless of group "
        "membership (audited) and operate event delivery. Does NOT "
        "include integration configuration."
    ),
    Perm.TICKETS_CONFIG_MANAGE: (
        "Manage support integration configuration: applications, source "
        "tenant mappings, routing groups and integration credentials."
    ),
}


def _derive_all() -> tuple:
    """ALL, Perm sinifindan TURETILIR — elle liste tutulmaz."""
    return tuple(
        sorted(
            v
            for k, v in vars(Perm).items()
            if not k.startswith("_") and isinstance(v, str)
        )
    )


ALL_PERMISSIONS = _derive_all()


# Bagimlilik kurallari (TEK kaynak): assign izinleri ayni scope'un
# access iznini GEREKTIRIR. auth-service rol yazim yolunda dogrular;
# frontend rol editoru checkbox davranisini buradan aynalar.
PERMISSION_REQUIRES = {
    Perm.TASKS_ASSIGN: Perm.TASKS_ACCESS,
    Perm.ISSUES_ASSIGN: Perm.ISSUES_ACCESS,
    # Ticket modulu: her operasyonel izin modul erisimini GEREKTIRIR.
    # `tickets.admin` ve `tickets.config.manage` BILEREK bagimsizdir:
    # ilki kendi genis kapsamini tasir (TICKETS_ADMIN_COVERS), ikincisi
    # bir konfigurasyon yetkisidir ve ticket ICERIGI vermez.
    Perm.TICKETS_CREATE: Perm.TICKETS_ACCESS,
    Perm.TICKETS_RESPOND: Perm.TICKETS_ACCESS,
    Perm.TICKETS_RESOLVE: Perm.TICKETS_ACCESS,
    Perm.TICKETS_ASSIGN: Perm.TICKETS_ACCESS,
    Perm.TICKETS_VIEW_ALL: Perm.TICKETS_ACCESS,
}


# `tickets.admin` sahibinin TUREVSEL olarak tasidigi operasyonel izinler.
# Rol kaydinda gorunmeseler bile efektif kontrolde saglanir (tasks.admin
# ile ayni desen). Katalogda YENI bir izin degildir — turetme kuralidir.
TICKETS_ADMIN_COVERS = (
    Perm.TICKETS_ACCESS,
    Perm.TICKETS_CREATE,
    Perm.TICKETS_RESPOND,
    Perm.TICKETS_RESOLVE,
    Perm.TICKETS_ASSIGN,
    Perm.TICKETS_VIEW_ALL,
)
