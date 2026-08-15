# =============================================================================
# HERMES - Entitlement katalogu (TEK KAYNAK, WS2)
# =============================================================================
# Plan ve tenant-override degerleri bu katalogda TANIMLI olmak zorundadir.
# Katalog disi bir kod FAIL-CLOSED islenir: ozelligi sessizce ACMAZ, aksine
# "tanimsiz" sayilir ve varsayilan (genellikle kapali) deger uygulanir.
#
# Neden tipli: `users.max` bir sayi, `api.enabled` bir bayrak. Tipsiz bir
# JSONB degeri "true" stringi ile sayisal limiti karistirabilir ve limit
# kontrolu sessizce her zaman gecebilirdi.
#
# v1 kapsam disi: odeme saglayicisi, self-servis checkout. Bu katalog
# faturalama HAZIRLIGIDIR, tahsilat degil.
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class EntitlementSpec:
    code: str
    kind: str            # "bool" | "int"
    description: str
    # Plan/override hicbir deger vermezse gecerli olan deger.
    default: Any
    # int icin: None = sinirsiz kabul edilir (acikca yazilir).
    allow_unlimited: bool = False


class Entitlement:
    USERS_MAX = "users.max"
    PROJECTS_ACTIVE_MAX = "projects.active.max"
    API_ENABLED = "api.enabled"
    MCP_ENABLED = "mcp.enabled"
    MEETINGS_ENABLED = "meetings.enabled"
    RETENTION_DAYS = "retention.days"
    SUPPORT_SLA_TIER = "support.sla_tier"


CATALOG: Dict[str, EntitlementSpec] = {
    spec.code: spec
    for spec in (
        EntitlementSpec(
            Entitlement.USERS_MAX, "int",
            "Maximum active + invited memberships in the tenant.",
            default=10, allow_unlimited=True,
        ),
        EntitlementSpec(
            Entitlement.PROJECTS_ACTIVE_MAX, "int",
            "Maximum active projects.",
            default=25, allow_unlimited=True,
        ),
        EntitlementSpec(
            Entitlement.API_ENABLED, "bool",
            "Public API access for the tenant.",
            default=False,
        ),
        EntitlementSpec(
            Entitlement.MCP_ENABLED, "bool",
            "MCP server access for the tenant.",
            default=False,
        ),
        EntitlementSpec(
            Entitlement.MEETINGS_ENABLED, "bool",
            "Meetings / calendar integration.",
            default=False,
        ),
        EntitlementSpec(
            Entitlement.RETENTION_DAYS, "int",
            "Work-item retention window in days.",
            default=365, allow_unlimited=True,
        ),
        EntitlementSpec(
            Entitlement.SUPPORT_SLA_TIER, "int",
            "Support tier (higher is faster); informational in v1.",
            default=1,
        ),
    )
}


class EntitlementValidationError(ValueError):
    """Katalog disi kod veya tip uyusmazligi."""


def validate(code: str, value: Any) -> Any:
    """Bir entitlement degerini katalog sozlesmesine gore dogrular.

    Raises:
        EntitlementValidationError: kod tanimsiz veya tip yanlis.
    """
    spec = CATALOG.get(code)
    if spec is None:
        raise EntitlementValidationError(
            f"tanimsiz entitlement kodu: {code}"
        )
    if spec.kind == "bool":
        if not isinstance(value, bool):
            raise EntitlementValidationError(
                f"{code} bool olmali, gelen: {type(value).__name__}"
            )
        return value
    if spec.kind == "int":
        if value is None:
            if not spec.allow_unlimited:
                raise EntitlementValidationError(
                    f"{code} sinirsiz olamaz"
                )
            return None
        # bool, Python'da int'in alt sinifidir — sessizce 1/0'a
        # donusmesini engelliyoruz.
        if isinstance(value, bool) or not isinstance(value, int):
            raise EntitlementValidationError(
                f"{code} tam sayi olmali, gelen: {type(value).__name__}"
            )
        if value < 0:
            raise EntitlementValidationError(f"{code} negatif olamaz")
        return value
    raise EntitlementValidationError(f"bilinmeyen tip: {spec.kind}")


def resolve(
    plan_values: Dict[str, Any],
    overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Efektif entitlement kumesini uretir.

    Sira: katalog varsayilani → plan degeri → tenant override'i.
    Katalog disi anahtarlar YOK SAYILIR (fail-closed: bilinmeyen bir kod
    hicbir ozelligi acamaz).
    """
    effective = {code: spec.default for code, spec in CATALOG.items()}
    for source in (plan_values or {}, overrides or {}):
        for code, value in source.items():
            if code not in CATALOG:
                continue
            try:
                effective[code] = validate(code, value)
            except EntitlementValidationError:
                # Bozuk kayit, varsayilani EZMEZ.
                continue
    return effective


def is_enabled(effective: Dict[str, Any], code: str) -> bool:
    """Bool entitlement kontrolu — tanimsizsa False (fail-closed)."""
    spec = CATALOG.get(code)
    if spec is None or spec.kind != "bool":
        return False
    return bool(effective.get(code, spec.default))
