# =============================================================================
# HERMES — CronJob girisleri TUM uygulamayi kurmamalidir
# =============================================================================
# `app/__init__.py` bir zamanlar `from .main import app` yapiyordu.
# Zararsiz gorunen bu satir, `app` paketinden yapilan HER import'u tum
# FastAPI uygulamasini kurmaya zorluyordu: butun router'lar, iki alt
# uygulama, metrik sunucusu ve `routers/reports.py` uzerinden pandas.
#
# Bedeli olculdu (2026-08-28, hermes-test): 11.0 sn CPU ve 206 MB zirve
# RSS — ve ticket dispatcher bunu DAKIKADA BIR odiyordu. Gunde ~4.4
# CPU-saati, bos bir kuyrugu yoklamak icin. Node zaten I/O'da doymus
# durumdayken bu, kesintiye katki veren gercek bir maliyetti.
#
# Bu test o satirin geri gelmesini engeller. Alt surecte kosar: pytest
# sureci `app.main`'i zaten import etmis olur.
from __future__ import annotations

import os
import subprocess
import sys

import pytest

# Import edilen modul stdout'a yazabilir (ornegin metrik uyarilari), bu
# yuzden sonuc SATIR ONEKI ile isaretlenir ve yalnizca o satir okunur.
_MARK = "HEAVY:"
_PROBE = """
import sys
import {module}
loaded = [m for m in ("app.main", "pandas") if m in sys.modules]
print("%s" + ",".join(loaded))
""" % _MARK


def _heavy(stdout: str) -> list[str]:
    """Isaretli satiri bulur; digerleri (uyarilar) YOK SAYILIR."""
    for line in stdout.splitlines():
        if line.startswith(_MARK):
            return [m for m in line[len(_MARK):].split(",") if m]
    return []


def _probe(module):
    """Alt surecte import eder ve agir modullerin yuklenip yuklenmedigini
    doner.

    PYTHONPATH ACIKCA verilir: conftest `backend` kokunu `sys.path`e
    ekler ama alt surec bunu DEVRALMAZ (yalnizca PYTHONPATH gecer).
    Verilmezse test, olcmek istedigi seyi degil `shared` import
    hatasini yakalar.
    """
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(p for p in sys.path if p)
    return subprocess.run(
        [sys.executable, "-c", _PROBE.format(module=module)],
        capture_output=True, text=True, timeout=120, env=env,
    )


@pytest.mark.parametrize("module", [
    "app.jobs.ticket_dispatcher",
    "app.jobs.ticket_maintenance",
])
def test_job_entrypoint_does_not_build_the_whole_app(module):
    result = _probe(module)
    assert result.returncode == 0, result.stderr[-500:]
    loaded = _heavy(result.stdout)
    assert not loaded, (
        f"{module} su agir modulleri yukledi: {loaded}. "
        "app/__init__.py'ye tekrar `from .main import app` eklenmis "
        "olabilir — o satir her CronJob kosusuna tum uygulamanin "
        "kurulum maliyetini bindirir."
    )


def test_app_package_init_stays_side_effect_free():
    """`app` paketini import etmek tek basina uygulamayi KURMAMALI."""
    result = _probe("app.config")
    assert result.returncode == 0, result.stderr[-500:]
    assert not _heavy(result.stdout), (
        "app.config import etmek uygulamayi kurdu — paket __init__'i "
        "yan etkili hale gelmis."
    )
