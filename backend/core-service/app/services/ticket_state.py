# =============================================================================
# HERMES — Ticket durum makinesi (TEK KAYNAK)
# =============================================================================
# Blueprint §9: "Status degisimi direct field assignment ile dagitik
# yapilmaz; state machine service." Bu modul o servistir. Ticket
# `status` alanina yazan TEK yol `ticket_service._apply_transition`tir
# ve o da buradaki matrisi sorar.
#
# Matris 02_DOMAIN_LIFECYCLE_AND_RULES §3'ten BIREBIR alinmistir. Yeni
# bir kenar eklemek sozlesme karari gerektirir — kodda "sadece bu bir
# kere" diye acilan bir gecis, musteri portalinda ASLA gorunmeyecek bir
# duruma yol acabilir.
#
# Aktor rolleri (kimlik degil, ROL):
#   requester → musteri tarafi (portal kullanicisi veya source app'in
#               dogrulanmis requester'i)
#   agent     → Duosis support agent'i (tickets.respond/resolve)
#   admin     → tickets.admin (override yollari; gerekce ZORUNLU)
#   system    → scheduler/otomatik kural (7 gun auto-close, reply sonrasi
#               otomatik in_progress)
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Optional, Tuple

from shared.permissions import Perm

from ..ticket_contract import (
    IMPACT_DEFAULT_PRIORITY,
    IMPACT_MINIMUM_PRIORITY,
    PRIORITIES,
)


class TransitionError(ValueError):
    """Gecersiz/izinsiz durum gecisi. Cagiran katman uygun sozlesme
    hata koduna cevirir (`invalid_state_transition` / `forbidden`)."""

    def __init__(self, message: str, code: str = "invalid_state_transition"):
        self.code = code
        super().__init__(message)


ROLE_REQUESTER = "requester"
ROLE_AGENT = "agent"
ROLE_ADMIN = "admin"
ROLE_SYSTEM = "system"

ALL_ROLES = (ROLE_REQUESTER, ROLE_AGENT, ROLE_ADMIN, ROLE_SYSTEM)


@dataclass(frozen=True)
class TransitionRule:
    """Bir kenarin TUM kosullari.

    `requires_public_message`: gecis, ayni komut icinde musteriye gorunur
        bir mesajla yapilmak ZORUNDA (orn. bilgi talebi). Contract §3:
        "waiting_customer → Public bilgi talebi zorunlu".
    `requires_resolution`: resolve komutu; ozet + kod zorunlu.
    `requires_reason`: override/iptal gerekcesi zorunlu (audit).
    `permission`: agent tarafinda gereken RBAC izni.
    """

    roles: FrozenSet[str]
    permission: Optional[str] = None
    requires_public_message: bool = False
    requires_resolution: bool = False
    requires_reason: bool = False
    # Yalnizca musteri dogrulama penceresi (resolved → reopened/closed)
    # icinde gecerli; admin override pencereyi asabilir.
    window_bound: bool = False


_A = frozenset({ROLE_AGENT, ROLE_ADMIN})
_R = frozenset({ROLE_REQUESTER})
_RA = frozenset({ROLE_REQUESTER, ROLE_ADMIN})
_RS = frozenset({ROLE_REQUESTER, ROLE_SYSTEM})
_RAS = frozenset({ROLE_REQUESTER, ROLE_AGENT, ROLE_ADMIN})
_SYS = frozenset({ROLE_SYSTEM})
_ADMIN = frozenset({ROLE_ADMIN})


# (from_status, to_status) -> TransitionRule
TRANSITIONS = {
    ("open", "in_progress"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESPOND,
    ),
    ("open", "waiting_customer"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESPOND,
        requires_public_message=True,
    ),
    ("open", "resolved"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESOLVE,
        requires_resolution=True,
    ),
    # Requester yalnizca HENUZ AGENT CEVABI YOKKEN iptal edebilir; bu ek
    # kosul `can_requester_cancel()` ile ticket uzerinde dogrulanir
    # (matris tek basina ifade edemez).
    ("open", "cancelled"): TransitionRule(
        roles=_RA, requires_reason=True,
    ),
    ("in_progress", "waiting_customer"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESPOND,
        requires_public_message=True,
    ),
    ("in_progress", "resolved"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESOLVE,
        requires_resolution=True,
    ),
    # Musteri cevap verince OTOMATIK: komut degil, kural.
    ("waiting_customer", "in_progress"): TransitionRule(roles=_RS),
    ("waiting_customer", "resolved"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESOLVE,
        requires_resolution=True,
    ),
    ("resolved", "reopened"): TransitionRule(
        roles=_RAS, requires_reason=True, window_bound=True,
    ),
    ("resolved", "closed"): TransitionRule(
        roles=_RS, window_bound=False,
    ),
    ("reopened", "in_progress"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESPOND,
    ),
    ("reopened", "waiting_customer"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESPOND,
        requires_public_message=True,
    ),
    ("reopened", "resolved"): TransitionRule(
        roles=_A, permission=Perm.TICKETS_RESOLVE,
        requires_resolution=True,
    ),
    # Kapali ticket YALNIZCA admin tarafindan ve gerekceyle acilir;
    # normal requester yeni ticket acar (02 §3).
    ("closed", "reopened"): TransitionRule(
        roles=_ADMIN, requires_reason=True,
    ),
}


# Agent'in composer'dan secebilecegi hedefler (UI, yalnizca gorunum —
# otorite yine bu modul).
def agent_targets(status: str, *, is_admin: bool = False) -> Tuple[str, ...]:
    """UI'nin gosterecegi hedefler.

    `is_admin` bilincli bir parametredir: `resolved → cancelled` gibi
    bazi kenarlar YALNIZCA admin'e aciktir ve normal agent'a gosterilen
    bir buton, tiklandiginda 409 verirdi. Otorite yine `validate()`tir;
    burasi yalnizca gorunum.
    """
    roles = {ROLE_AGENT, ROLE_ADMIN} if is_admin else {ROLE_AGENT}
    return tuple(
        to for (frm, to), rule in TRANSITIONS.items()
        if frm == status and (rule.roles & roles)
    )


def rule_for(from_status: str, to_status: str) -> TransitionRule:
    rule = TRANSITIONS.get((from_status, to_status))
    if rule is None:
        raise TransitionError(
            f"Cannot move a ticket from '{from_status}' to '{to_status}'."
        )
    return rule


def validate(
    *,
    from_status: str,
    to_status: str,
    role: str,
    has_public_message: bool = False,
    has_resolution: bool = False,
    reason: Optional[str] = None,
    within_customer_window: bool = True,
) -> TransitionRule:
    """Kenari ve TUM kosullarini dogrular; kural nesnesini doner.

    Not: RBAC izin kontrolu cagiran katmandadir (guard/servis). Burada
    yalnizca `permission` alani TASINIR — durum makinesi auth-service'e
    sorgu yapmaz (saf, test edilebilir kalir).
    """
    if from_status == to_status:
        raise TransitionError(
            f"The ticket is already '{to_status}'."
        )
    rule = rule_for(from_status, to_status)

    if role not in rule.roles:
        raise TransitionError(
            f"'{role}' is not allowed to move a ticket from "
            f"'{from_status}' to '{to_status}'.",
            code="forbidden",
        )
    if rule.requires_public_message and not has_public_message:
        raise TransitionError(
            "This status change requires a customer-visible message in "
            "the same request."
        )
    if rule.requires_resolution and not has_resolution:
        raise TransitionError(
            "Resolving a ticket requires a resolution summary and code."
        )
    if rule.requires_reason and not (reason or "").strip():
        raise TransitionError("This status change requires a reason.")
    # Dogrulama penceresi: admin override pencereyi ASABILIR, requester
    # ve agent asamaz.
    if rule.window_bound and not within_customer_window \
            and role != ROLE_ADMIN:
        raise TransitionError(
            "The customer verification window for this ticket has "
            "closed. A support administrator can still reopen it."
        )
    return rule


def can_requester_cancel(*, status: str, has_agent_reply: bool) -> bool:
    """Requester iptali: yalnizca `open` ve HENUZ agent cevabi yokken.

    Is baslamis bir ticketin sessizce yok olmasini engeller; agent
    cevabi geldiyse musteri yerine iptal AGENT/ADMIN kararidir.
    """
    return status == "open" and not has_agent_reply


# =============================================================================
# Priority turetme
# =============================================================================

_PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}


def default_priority(impact: str) -> str:
    return IMPACT_DEFAULT_PRIORITY.get(impact, "normal")


def clamp_priority(priority: str, impact: str) -> str:
    """Impact'in dayattigi TABANIN altina inilemez.

    `security_or_data_risk` en az `high` demektir (02 §4). Agent daha
    yukari cikarabilir, asagi INEMEZ — aksi halde bir guvenlik riski
    triage sirasinda sessizce `low`a dusurulebilirdi.
    """
    minimum = IMPACT_MINIMUM_PRIORITY.get(impact, "low")
    if _PRIORITY_ORDER.get(priority, 0) < _PRIORITY_ORDER[minimum]:
        return minimum
    return priority
