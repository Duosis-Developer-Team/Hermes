# =============================================================================
# HERMES - Proje turu renkleri ve jenerik logo glifleri (sunucu tarafi sozluk)
# =============================================================================
# Jenerik proje logosu = TUR RENGI + GLIF. Ikisi de SABIT sozlukten gelir:
#   - renk: proje turunun `color` anahtari (admin ana renklerden secer),
#   - glif: projenin `logo_glyph` anahtari ("Logo sec" listesinden).
# Logo gorseli istemcide bu iki anahtardan CIZILIR (veritabaninda bayt yok);
# tur rengi degisince o turdeki tum jenerik logolar kendiliginden yeni renge
# gecer. Projeye YUKLENMIS ozel logo (project_logos) her zaman onceliklidir.
#
# Anahtarlar frontend'deki tek kaynakla birebir ayni olmali:
#   frontend/src/features/projectTypes/palette.js  (renkler)
#   frontend/src/features/projectTypes/glyphs.js   (glifler)
# tests/test_project_types.py parite testi ikisini de okur.
# =============================================================================

PROJECT_TYPE_COLORS = (
    "red", "orange", "amber", "yellow", "green", "teal",
    "cyan", "blue", "indigo", "violet", "pink", "slate",
)

LOGO_GLYPHS = (
    "general", "monitoring", "devops", "automation", "performance", "device",
    "content", "service", "data", "analytics", "product", "product-new",
    "product-existing", "code", "meeting", "partner", "training", "hiring",
    "management", "sales", "lv1", "lv2", "lv3",
)
