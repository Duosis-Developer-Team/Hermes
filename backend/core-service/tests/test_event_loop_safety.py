# =============================================================================
# HERMES — `async def` uclarinda SENKRON DB isi YASAK
# =============================================================================
# 2026-09-01 kesintisinin kok sebebi buydu: `async def` olarak tanimlanmis
# uclar iclerinde senkron SQLAlchemy calistiriyordu. O sorgu surdugu
# surece EVENT LOOP bloke olur ve surec `/health` dahil HICBIR istege
# cevap veremez. Iki replika da ayni anda dustu, liveness ikisini de
# oldurdu (exitCode 137, bellek 210/512 MB, oom_kill 0 — yani bellek
# DEGIL, loop acligi).
#
# Tetikleyici Meetings sayfasiydi: acilista otomatik `POST /meetings/
# sync-me` cagiriyor ve o uc her takvim olayi icin loop uzerinde bir
# upsert yapiyordu.
#
# KURAL: bir uc ya `def` olacak (FastAPI onu threadpool'da kosturur) ya
# da senkron isini `run_in_threadpool` ile disari verecek.
from __future__ import annotations

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent / "app"

#: GERCEKTEN IO yapan cagrilar. `db.query(...)` ve `db.add(...)` burada
#: DEGILDIR: ilki yalnizca sorgu nesnesi kurar, ikincisi kaydi oturuma
#: ekler — ikisi de veritabanina GITMEZ. IO, sorgunun materyalize
#: edildigi ya da oturumun bosaltildigi anda olur.
TERMINAL_CALLS = {
    "all", "first", "one", "one_or_none", "scalar", "scalars", "count",
}
SESSION_IO = {"execute", "commit", "flush", "refresh", "get"}

ROUTE_DECORATORS = {"get", "post", "put", "patch", "delete"}


def _is_route(node: ast.AsyncFunctionDef) -> bool:
    for dec in node.decorator_list:
        target = dec.func if isinstance(dec, ast.Call) else dec
        if isinstance(target, ast.Attribute) and target.attr in ROUTE_DECORATORS:
            return True
    return False


def _sync_db_calls(node: ast.AST) -> list[str]:
    """Fonksiyon govdesinde `await`SIZ DB cagrilarini toplar.

    IKI istisna vardir ve ikisi de GERCEK bir yanlis pozitifi onler:

      * `await run_in_threadpool(...)` — is zaten loop'tan cikarilmistir.
      * IC ICE tanimli SENKRON fonksiyonlar — yaygin kalip, agir isi bir
        `def run():` icine toplayip `await run_in_threadpool(run)` ile
        cagirmaktir. O govde loop'ta KOSMAZ; icine bakmak, dogru yazilmis
        kodu hatali gostermek olurdu (bir kez tam olarak boyle oldu).
    """
    # Ic ice senkron fonksiyonlarin govdesi TARANMAZ.
    nested = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.FunctionDef) and sub is not node:
            for inner in ast.walk(sub):
                nested.add(id(inner))

    awaited = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Await):
            for inner in ast.walk(sub):
                awaited.add(id(inner))

    found = []
    for sub in ast.walk(node):
        if not isinstance(sub, ast.Call) or id(sub) in awaited:
            continue
        if id(sub) in nested:
            continue
        fn = sub.func
        if not isinstance(fn, ast.Attribute):
            continue
        base = fn.value
        is_session = isinstance(base, ast.Name) and base.id in {"db", "session"}
        if fn.attr in TERMINAL_CALLS or (is_session and fn.attr in SESSION_IO):
            found.append(f".{fn.attr}() (satir {sub.lineno})")
    return found


def _async_routes():
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and _is_route(node):
                yield path, node


def test_async_routes_do_no_blocking_db_work():
    offenders = []
    for path, node in _async_routes():
        calls = _sync_db_calls(node)
        if calls:
            rel = path.relative_to(APP.parent)
            offenders.append(f"{rel}::{node.name} -> {', '.join(calls)}")
    assert offenders == [], (
        "async uclarda senkron DB isi bulundu; bunlar EVENT LOOP'u bloke "
        "eder ve tum surecin cevap veremez hale gelmesine yol acar "
        "(2026-09-01 kesintisi). Ucu `def` yapin ya da isi "
        "`run_in_threadpool` ile disari verin:\n  " + "\n  ".join(offenders)
    )


def test_readiness_does_not_hit_the_database_on_every_probe():
    """`/ready` her probe'ta DB'ye GITMEZ.

    Sema surec omru boyunca degismez (migration Job'i rollout'tan once
    bloke ederek kosar). Her 10 saniyede bir `engine.connect()` cagirmak
    hem gereksizdi hem de havuz doluyken loop'u `pool_timeout` boyunca
    bloke ediyordu.
    """
    main = (APP / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(main)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "readiness_check"
    )
    body = ast.dump(fn)
    assert "verify_schema_compatibility" not in body, (
        "/ready dogrudan sema dogrulamasi cagiriyor — sonuc "
        "ONBELLEKLENMELI (_schema_is_compatible)."
    )
