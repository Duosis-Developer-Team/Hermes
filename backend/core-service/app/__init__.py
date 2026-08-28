# Hermes Core Service
#
# BU DOSYA BILEREK BOSTUR.
#
# Onceden `from .main import app` vardi. Zararsiz gorunuyordu ama
# `app` PAKETINDEN yapilan HER import'u — `import app.config` dahil —
# TUM FastAPI uygulamasini kurmaya zorluyordu: butun router'lar, Public
# API ve Support API alt-uygulamalari, metrik sunucusu ve
# `routers/reports.py` uzerinden **pandas**.
#
# Bedeli olculdu (2026-08-28, hermes-test): 11.0 sn CPU ve 206 MB zirve
# RSS. Ticket dispatcher CronJob'i bunu DAKIKADA BIR odiyordu — bos bir
# kuyrugu yoklamak icin gunde ~4.4 CPU-saati.
#
# API sunucusu etkilenmez: uvicorn zaten `app.main:app` ile cagirilir,
# yani uygulamayi ihtiyaci olan yer kurar. Paket duzeyindeki export'a
# bagimli tek bir cagri yeri YOKTU (arandi).
