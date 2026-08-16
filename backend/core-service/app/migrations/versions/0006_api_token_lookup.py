"""core_db — Public API token'i icin DAR kapsamli ayricalikli lookup

Revision ID: 0006_api_token_lookup
Revises: 0005_tenant_enforce
Create Date: 2026-08-16

TAVUK-YUMURTA PROBLEMI (05_POSTGRES_RLS §7): Public API kimlik
dogrulamasi, token'in HANGI TENANT'a ait oldugunu token'i BULMADAN
bilemez. Ama RLS altinda tenant baglami kurulmadan `api_tokens`
sorgusu SIFIR satir doner — yani hicbir API token'i calismaz.

YANLIS cozumler:
  - api_tokens'ta RLS'i kapatmak (tum token metadata'si acilir);
  - uygulama rolune BYPASSRLS vermek (tum izolasyon biter);
  - istemcinin gonderdigi bir tenant degerine guvenmek (sahtelenebilir).

DOGRU cozum: TEK bir dar SECURITY DEFINER fonksiyonu.

  - girdi: token HASH'i (asla plaintext) + beklenen ortam;
  - cikti: yalnizca `ApiPrincipal` kurmak icin gereken GUVENLI
    tanimlayicilar/durumlar — scope, binding, isim, IP gibi hicbir
    icerik DONMEZ;
  - sahibi migrator; `search_path` SABIT (fonksiyon her istekte
    calisir — arama yolu ele gecirilirse kimlik dogrulama ele gecer);
  - EXECUTE yalnizca core runtime rolune verilir;
  - dinamik SQL YOK.

Kesif sonrasi normal akis: transaction-local tenant baglami kurulur ve
token/client NORMAL RLS altinda yeniden okunur. Yani bu fonksiyon
yalnizca "hangi tenant?" sorusunu cevaplar; yetki kararlarini VERMEZ.
"""
import os

from alembic import op
from sqlalchemy import text

revision = "0006_api_token_lookup"
down_revision = "0005_tenant_enforce"
branch_labels = None
depends_on = None

SECURITY_SCHEMA = "hermes_sec"
FUNCTION_NAME = "api_token_lookup"


def upgrade() -> None:
    # Ifadenin TEK kaynagi tenant_enforce'tur; test fixture'lari da ayni
    # fonksiyonu cagirir, boylece test semasi uretimden ayrisamaz.
    from app.migrations.tenant_enforce import (
        install_api_token_lookup, grant_runtime_role,
    )

    conn = op.get_bind()
    install_api_token_lookup(conn)

    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    grant_runtime_role(conn, runtime_role)


def downgrade() -> None:
    op.execute(
        f"DROP FUNCTION IF EXISTS {SECURITY_SCHEMA}.{FUNCTION_NAME}"
        "(text, text)"
    )
