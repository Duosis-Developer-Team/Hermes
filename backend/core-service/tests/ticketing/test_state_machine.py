# =============================================================================
# HERMES — Durum makinesi: gecerli/gecersiz kenarlar
# =============================================================================
# Saf birim testleri: DB yok, ag yok. Matris `02_DOMAIN_LIFECYCLE §3`
# ile birebir olmali; buradaki her satir bir urun kuralidir.
# =============================================================================

import pytest

from app.services import ticket_state as st
from app.ticket_contract import STATUSES

VALID = [
    ("open", "in_progress", st.ROLE_AGENT, {}),
    ("open", "waiting_customer", st.ROLE_AGENT,
     {"has_public_message": True}),
    ("open", "resolved", st.ROLE_AGENT, {"has_resolution": True}),
    ("open", "cancelled", st.ROLE_REQUESTER, {"reason": "vazgectim"}),
    ("in_progress", "waiting_customer", st.ROLE_AGENT,
     {"has_public_message": True}),
    ("in_progress", "resolved", st.ROLE_AGENT, {"has_resolution": True}),
    ("waiting_customer", "in_progress", st.ROLE_REQUESTER, {}),
    ("waiting_customer", "in_progress", st.ROLE_SYSTEM, {}),
    ("waiting_customer", "resolved", st.ROLE_AGENT,
     {"has_resolution": True}),
    ("resolved", "reopened", st.ROLE_REQUESTER, {"reason": "tekrar etti"}),
    ("resolved", "closed", st.ROLE_REQUESTER, {}),
    ("resolved", "closed", st.ROLE_SYSTEM, {}),
    ("reopened", "in_progress", st.ROLE_AGENT, {}),
    ("reopened", "resolved", st.ROLE_AGENT, {"has_resolution": True}),
    ("closed", "reopened", st.ROLE_ADMIN, {"reason": "yanlis kapandi"}),
]


@pytest.mark.parametrize("frm,to,role,kwargs", VALID)
def test_valid_edges(frm, to, role, kwargs):
    rule = st.validate(from_status=frm, to_status=to, role=role, **kwargs)
    assert rule is not None


def test_unknown_edge_is_rejected():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="closed", to_status="in_progress",
            role=st.ROLE_AGENT,
        )


def test_customer_cannot_resolve_their_own_ticket():
    with pytest.raises(st.TransitionError) as exc:
        st.validate(
            from_status="open", to_status="resolved",
            role=st.ROLE_REQUESTER, has_resolution=True,
        )
    assert exc.value.code == "forbidden"


def test_normal_requester_cannot_reopen_a_closed_ticket():
    """Kapali ticket YALNIZCA admin tarafindan acilir; musteri yeni
    ticket acar (02 §3)."""
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="closed", to_status="reopened",
            role=st.ROLE_REQUESTER, reason="lutfen",
        )


def test_waiting_customer_requires_a_public_message():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="open", to_status="waiting_customer",
            role=st.ROLE_AGENT,
        )


def test_resolve_requires_a_resolution():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="open", to_status="resolved", role=st.ROLE_AGENT
        )


def test_reason_is_required_where_declared():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="resolved", to_status="reopened",
            role=st.ROLE_REQUESTER, reason="   ",
        )


def test_verification_window_blocks_requester_but_not_admin():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="resolved", to_status="reopened",
            role=st.ROLE_REQUESTER, reason="gec kaldim",
            within_customer_window=False,
        )
    # Admin pencereyi ASABILIR (gerekce zorunlu).
    st.validate(
        from_status="resolved", to_status="reopened",
        role=st.ROLE_ADMIN, reason="musteri telefonla bildirdi",
        within_customer_window=False,
    )


def test_same_status_transition_is_rejected():
    with pytest.raises(st.TransitionError):
        st.validate(
            from_status="open", to_status="open", role=st.ROLE_AGENT
        )


def test_requester_cancel_only_before_an_agent_reply():
    assert st.can_requester_cancel(status="open", has_agent_reply=False)
    assert not st.can_requester_cancel(status="open", has_agent_reply=True)
    assert not st.can_requester_cancel(
        status="in_progress", has_agent_reply=False
    )


def test_priority_floor_from_impact():
    assert st.default_priority("security_or_data_risk") == "high"
    # Guvenlik riski `low`a DUSURULEMEZ.
    assert st.clamp_priority("low", "security_or_data_risk") == "high"
    # Yukari cikmak serbest.
    assert st.clamp_priority("urgent", "security_or_data_risk") == "urgent"
    assert st.clamp_priority("low", "single_user") == "low"


def test_matrix_only_uses_known_statuses():
    for frm, to in st.TRANSITIONS:
        assert frm in STATUSES and to in STATUSES


def test_agent_targets_are_derived_from_the_matrix():
    # Normal agent: iptal YOK (matriste `open → cancelled` requester/
    # admin kenaridir).
    assert set(st.agent_targets("open")) == {
        "in_progress", "waiting_customer", "resolved",
    }
    # Admin ayni durumda iptali de gorur.
    assert "cancelled" in st.agent_targets("open", is_admin=True)
    # `closed` hicbir rolde `open`dan dogrudan erisilebilir degil.
    assert "closed" not in st.agent_targets("open", is_admin=True)
