# =============================================================================
# HERMES - Dev-only mock veri tohumu: ortak guvenlik kapisi + kimlik semasi
# =============================================================================
# auth-service ve core-service'in `app.jobs.dev_seed` betikleri bu modulu
# paylasir (ikisinin image'inda da `shared/` vardir). Burada YALNIZCA:
#
#   1) GUVENLIK KAPISI — betik hermes-test'te (production-like, kutsal
#      veri) ASLA kosamaz. Kosul (hepsi birden):
#        - acik `--yes-dev` bayragi,
#        - HERMES_ENVIRONMENT == "dev" (ortamdan, varsayilansiz),
#        - PUBLIC_API_ENV == "dev" (servisin efektif degeri; hermes-test
#          core'unda "live"),
#        - pod icinde kosuyorsa (KUBERNETES_SERVICE_HOST) pod'un
#          namespace'i == "hermes-dev" (service account dosyasindan; env
#          ile EZILEMEZ).
#      Bir kosul tutmazsa hicbir DB baglantisi acilmadan cikilir (exit 2).
#
#   2) KIMLIK SEMASI — tohumlanan her satirin id'si deterministiktir
#      (uuid5) ve ilk 8 hex hanesi SABIT bir isarettir (`de5eed00`).
#      Boylece:
#        - tekrar kosmak ayni id'leri uretir (idempotent, kopya yok);
#        - `--purge` yalnizca isaretli satirlari (ve onlara bagli
#          satirlari) siler; gercek satirlar uuid4'tur (surum hanesi 4),
#          isaretli id'ler uuid5 (surum hanesi 5) — cakisma pratikte yok.
#
#   3) SAHTE KULLANICI KATALOGU — auth tohumu bu kisileri acar, core
#      tohumu ayni id'leri is verisine baglar (tek kaynak).
# =============================================================================

from __future__ import annotations

import os
import uuid
from typing import Iterable, Mapping, Optional

#: Tohum id'lerinin sabit on eki (8 hex). DEGISTIRILMEZ: purge buna bakar.
DEMO_ID_PREFIX = "de5eed00"

#: uuid5 isim alani. DEGISTIRILMEZ: id'lerin tekrar uretilebilirligi buna bagli.
DEMO_NAMESPACE = uuid.UUID("6f1d2c3e-8a4b-5c6d-9e0f-a1b2c3d4e5f6")

#: Sahte kullanicilarin e-posta alan adi. `example.com` RFC 2606 ile
#: ayrilmistir (IANA null-MX yayinlar: bu adreslere posta GIDEMEZ) ve
#: Entra'da boyle bir kimlik olamaz. `.invalid` KULLANILMAZ: sozdizimi
#: dogrulayicilari (email-validator) "special-use" TLD'yi reddeder ve
#: 2026-09-29'da hermes-dev'de /users listesini 500'e dusurmustu.
DEMO_EMAIL_DOMAIN = "hermes-demo.example.com"

#: (anahtar, ad soyad, unvan). Id ve e-posta anahtardan turetilir.
DEMO_USERS = (
    ("ada", "Ada Lovelace", "Kıdemli Yazılım Mühendisi"),
    ("grace", "Grace Hopper", "Teknik Lider"),
    ("alan", "Alan Turing", "Veri Mühendisi"),
    ("katherine", "Katherine Johnson", "Analist"),
    ("linus", "Linus Torvalds", "DevOps Mühendisi"),
    ("margaret", "Margaret Hamilton", "Proje Yöneticisi"),
)

REQUIRED_ENVIRONMENT = "dev"
REQUIRED_PUBLIC_API_ENV = "dev"
REQUIRED_NAMESPACE = "hermes-dev"
CONFIRM_FLAG = "--yes-dev"
SERVICE_ACCOUNT_NAMESPACE_FILE = (
    "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
)

#: Kapi reddinde cikis kodu.
EXIT_REFUSED = 2


class DevSeedRefused(RuntimeError):
    """Ortam dev degil (ya da onay bayragi yok) — tohum KOSMAZ."""


def demo_id(*parts: object) -> uuid.UUID:
    """Parcalardan deterministik, isaretli bir UUID uretir."""
    name = ":".join(str(p) for p in parts)
    raw = uuid.uuid5(DEMO_NAMESPACE, name).hex
    return uuid.UUID(DEMO_ID_PREFIX + raw[len(DEMO_ID_PREFIX):])


def is_demo_id(value: object) -> bool:
    """Id tohum isaretini tasiyor mu (uuid5 surum hanesi dahil)?"""
    try:
        u = value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (TypeError, ValueError):
        return False
    return u.hex.startswith(DEMO_ID_PREFIX) and u.version == 5


def demo_id_sql_pattern() -> str:
    """`id::text LIKE ...` icin desen."""
    return DEMO_ID_PREFIX + "-%"


def demo_user_id(key: str) -> uuid.UUID:
    return demo_id("user", key)


def demo_user_email(key: str, full_name: str) -> str:
    local = ".".join(full_name.lower().split())
    return f"{local}@{DEMO_EMAIL_DOMAIN}"


def demo_users() -> list:
    """Sahte kullanicilar: id, ad, e-posta, unvan."""
    return [
        {
            "key": key,
            "id": demo_user_id(key),
            "full_name": name,
            "email": demo_user_email(key, name),
            "title": title,
        }
        for key, name, title in DEMO_USERS
    ]


def _read_namespace(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return None


def assert_dev_only(
    argv: Iterable[str],
    *,
    public_api_env: Optional[str],
    environ: Optional[Mapping[str, str]] = None,
    namespace_file: str = SERVICE_ACCOUNT_NAMESPACE_FILE,
) -> None:
    """Tum kosullar tutmazsa DevSeedRefused firlatir (mesaj: nedenler).

    `public_api_env`: cagiran servisin EFEKTIF PUBLIC_API_ENV degeri.
    """
    env = os.environ if environ is None else environ
    reasons = []

    if CONFIRM_FLAG not in set(argv):
        reasons.append(f"explicit {CONFIRM_FLAG} flag is required")

    hermes_env = env.get("HERMES_ENVIRONMENT")
    if hermes_env != REQUIRED_ENVIRONMENT:
        reasons.append(
            f"HERMES_ENVIRONMENT must be '{REQUIRED_ENVIRONMENT}' "
            f"(got {hermes_env!r})"
        )

    if public_api_env != REQUIRED_PUBLIC_API_ENV:
        reasons.append(
            f"PUBLIC_API_ENV must be '{REQUIRED_PUBLIC_API_ENV}' "
            f"(got {public_api_env!r})"
        )
    # Servis ayari olmasa bile ortamda acikca baska bir deger varsa red.
    raw_public = env.get("PUBLIC_API_ENV")
    if raw_public is not None and raw_public != REQUIRED_PUBLIC_API_ENV:
        reasons.append(
            f"PUBLIC_API_ENV environment variable is {raw_public!r}"
        )

    # Pod icindeysek namespace'i service account dosyasindan dogrula.
    # Bu deger env ile ezilemez: yanlislikla hermes-test pod'unda
    # `HERMES_ENVIRONMENT=dev` verilse bile kapi kapali kalir.
    if env.get("KUBERNETES_SERVICE_HOST"):
        namespace = _read_namespace(namespace_file)
        if namespace != REQUIRED_NAMESPACE:
            reasons.append(
                f"pod namespace must be '{REQUIRED_NAMESPACE}' "
                f"(got {namespace!r})"
            )

    if reasons:
        raise DevSeedRefused(
            "dev_seed refused: " + "; ".join(reasons)
            + ". This seeder only runs on hermes-dev."
        )
