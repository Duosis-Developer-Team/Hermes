#!/usr/bin/env bash
# =============================================================================
# HERMES - Runtime Secret preflight (Sprint 0, CTO paketi 2026-07-29)
# =============================================================================
# Hedef namespace'te zorunlu Secret NESNELERININ ve KEY ADLARININ var
# oldugunu dogrular. SALT-OKUNUR: hicbir degeri/base64 icerigi OKUMAZ,
# YAZDIRMAZ; yalniz key ADLARINI listeler. Eksikte non-zero exit —
# routine deploy Secret'lari overwrite etmek yerine burada DURUR.
#
# Kullanim: ./scripts/k8s/check-runtime-secrets.sh <hermes-dev|hermes-test>
# =============================================================================
set -euo pipefail
# 'set -x' BILEREK yok (Sprint 0 kurali: komut izi deger sizdirabilir).

namespace="${1:?usage: $0 <hermes-dev|hermes-test>}"

case "$namespace" in
  hermes-dev|hermes-test) ;;
  *) echo "[FAIL] unsupported namespace: $namespace (allowed: hermes-dev, hermes-test)" >&2; exit 2 ;;
esac

fail=0

check_secret() {
  local secret_name="$1"; shift

  if ! kubectl -n "$namespace" get secret "$secret_name" >/dev/null 2>&1; then
    echo "[FAIL] $namespace/$secret_name: Secret object missing" >&2
    fail=1
    return
  fi

  # go-template yalniz KEY adlarini cikarir; degerlere hic dokunulmaz.
  local keys
  keys="$(kubectl -n "$namespace" get secret "$secret_name" \
    -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}')"

  local missing=0 required
  for required in "$@"; do
    if ! grep -Fxq "$required" <<<"$keys"; then
      echo "[FAIL] $namespace/$secret_name missing key: $required" >&2
      missing=1
    fi
  done
  if [ "$missing" -eq 0 ]; then
    echo "[OK] $secret_name: required keys present"
  else
    fail=1
  fi
}

# Sozlesme: docs/security/runtime-secret-contract.md (tek kaynak).
check_secret hermes-secrets \
  POSTGRES_PASSWORD JWT_SECRET_KEY AZURE_CLIENT_SECRET RABBITMQ_PASSWORD
check_secret hermes-backup-secret \
  AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_TENANT_ID ONEDRIVE_USER DB_PASSWORD
check_secret hermes-tls tls.crt tls.key
check_secret hermes-jwt-auth JWT_PRIVATE_KEY JWT_PUBLIC_KEY
# Manifestte optional:true, ama RBAC izin cozumu + S2S dizin buna
# dayanir — CURRENT zorunlu sayilir (yoklugu = admin uclari 503).
check_secret hermes-s2s HERMES_S2S_TOKEN_CURRENT
check_secret ghcr-secret .dockerconfigjson

# Rotasyon yuvasi: eksikligi deploy'u DURDURMAZ, yalniz uyarilir.
if kubectl -n "$namespace" get secret hermes-s2s \
     -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}' \
     | grep -Fxq "HERMES_S2S_TOKEN_NEXT"; then
  echo "[OK] hermes-s2s: rotation slot (NEXT) present"
else
  echo "[WARN] hermes-s2s: rotation slot HERMES_S2S_TOKEN_NEXT absent (optional)"
fi

exit "$fail"
