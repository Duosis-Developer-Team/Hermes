✅ Uygulanan Düzeltmeler

[KRİTİK-3] + [KRİTİK-4] — shared/auth.py + 3× config.py

Dosya	Değişiklik
backend/shared/auth.py	os.getenv(…, "hermes-dev-…") → sys.exit(1) ile crash-fast; SECRET_KEY[:4] ve str(e) log satırları → logger.warning ile genel mesaj
backend/auth-service/app/config.py	JWT_SECRET_KEY: str = "hermes-dev-…" kaldırıldı; zorunlu alan + field_validator (min 32 karakter, bilinen zayıf değer kontrolü) eklendi
backend/core-service/app/config.py	Aynı
backend/reporting-service/app/config.py	Aynı
[KRİTİK-5] — project_memberships.py + issues.py

Dosya	Değişiklik
project_memberships.py	POST ve DELETE → Depends(get_current_user) → Depends(require_admin); GET Optional[UUID] tip düzeltmesi
issues.py	_check_project_membership() yardımcı fonksiyon eklendi; create/get/get_by_id/update → üyelik kontrolü; delete → require_admin
[YÜKSEK-8] — customer_service.py

update() metoduna contract_duration_days < 1 için HTTP 422 fırlatan validasyon ve logger.info ile audit kaydı eklendi.

[YÜKSEK-9] — reports.py

export_excel ve get_user_logs_json endpoint'lerinde Optional[List[str]] → Optional[List[UUID]]; cast(…, String).in_() → .in_() (cast gereksiz kaldı); get_user_logs_json'da standart kullanıcı için filtreler admin bloğuna taşındı (ek kapsam sızdırma önlendi).