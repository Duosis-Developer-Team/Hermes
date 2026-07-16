"""Hermes MCP server — Public API uzerinde INCE katman (Stage 5A).

Yapisal garantiler (onayli D5-1):
  - PostgreSQL baglantisi YOK, DB surucusu dahi kurulu degil.
  - core-service uygulama/is modulu import ETMEZ.
  - Tek upstream: konfigurasyondaki Hermes Public API base URL'i.
  - Admin yuzeyi yok; /health + /mcp disinda endpoint yok.
"""

__version__ = "0.1.0"
