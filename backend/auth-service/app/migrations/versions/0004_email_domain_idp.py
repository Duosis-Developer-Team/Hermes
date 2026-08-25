"""auth_db — e-posta alan adi saglayicisi icin provider_tenant_id nullable

`tenant_identity_providers.provider_tenant_id` "SAGLAYICIDAKI tenant
kimligi" demektir ve Azure/Entra gibi harici IdP'ler icin tasarlandi.
WS12'de eklenen `email-domain` saglayicisinda harici bir saglayici
YOKTUR — dolayisiyla oraya yazilacak anlamli bir deger de yok. Kolona
slug gibi bir sey doldurmak, alanin anlamini bozar ve sonraki okuyucuyu
yanıltir; dogrusu kolonu opsiyonel yapmaktir.

Yon: ILERI ve ADDITIVE. NOT NULL kaldirilir; mevcut satirlar
degismez, hicbir veri silinmez. Eski kod da calismaya devam eder
(deger yazmaya devam eder, kisit yalnizca gevsedi).
"""

from alembic import op

revision = "0004_email_domain_idp"
down_revision = "0003_initial_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "tenant_identity_providers",
        "provider_tenant_id",
        nullable=True,
    )


def downgrade() -> None:
    # NOT NULL'a geri donmek, harici saglayicisi olmayan (email-domain)
    # satirlari gecersiz kilar. Bilerek desteklenmiyor.
    raise NotImplementedError(
        "Geri alinamaz: email-domain saglayicilarinda provider_tenant_id "
        "bos olmak ZORUNDADIR."
    )
