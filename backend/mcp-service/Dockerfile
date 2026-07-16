# =============================================================================
# HERMES - MCP Service Dockerfile (Stage 5D)
# =============================================================================
# INCE katman ilkesi image'a da yansir: yalnizca hermes_mcp paketi +
# minimal bagimliliklar. DB surucusu, core kodu, shared paketi YOK.
# Non-root + read-only-rootfs uyumlu (yazilabilir dosya ihtiyaci yok).
# =============================================================================
FROM docker.io/library/python:3.11-slim AS builder

WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY mcp-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM docker.io/library/python:3.11-slim

RUN useradd --system --uid 10001 --no-create-home mcp
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY mcp-service/hermes_mcp/ ./hermes_mcp/

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER 10001
EXPOSE 8010

CMD ["uvicorn", "hermes_mcp.main:app", "--host", "0.0.0.0", "--port", "8010"]
