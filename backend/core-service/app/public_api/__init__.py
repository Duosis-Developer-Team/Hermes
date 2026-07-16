# =============================================================================
# HERMES - Public API package
# =============================================================================
# Dis entegrasyonlara acilan, versiyonlanmis public API yuzeyi. main.py bu
# paketi ayri bir FastAPI alt-uygulamasi olarak /api/public altina mount
# eder; boylece internal API'den yapisal olarak izole kalir (ayri OpenAPI
# semasi, ayri middleware zinciri, ayri hata zarfi).
# =============================================================================
