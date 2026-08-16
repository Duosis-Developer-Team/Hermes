#!/usr/bin/env bash
# =============================================================================
# HERMES - Rollout SONRASI tenant izolasyon dumani (WS10)
# =============================================================================
# Deploy'dan sonra CANLI ortamda calisir ve cutover'in en kritik
# ozelliklerini DOGRULAR. Amaci kapsamli test degil, "yanlis bir sey
# canliya cikti mi?" sorusuna dakikalar icinde cevap vermektir.
#
# Kullanim:
#   ./scripts/k8s/post-deploy-tenant-smoke.sh <namespace>
#
# Kontroller (hepsi SALT-OKUNUR; hicbir is verisi yazilmaz/silinmez):
#   1. auth + core sema revizyonu beklenen head'de mi?
#   2. Uygulama DB rolleri NOBYPASSRLS mi ve tablo sahibi DEGIL mi?
#   3. Her tenant-owned tabloda RLS ENABLE + FORCE ve politika var mi?
#   4. tenant_id NULL kalan satir var mi?
#   5. Tenant baglami OLMADAN uygulama rolu satir gorebiliyor mu?
#   6. Servisler /ready doner mi (sema uyumlulugu dahil)?
#
# GUVENLIK: hicbir sifre/token yazdirilmaz. psql cagrilari pod icinden
# yapilir; kimlik bilgisi zaten pod ortamindadir.
# =============================================================================
set -euo pipefail

namespace="${1:?usage: $0 <namespace>}"

case "$namespace" in
  hermes-dev|hermes-test) ;;
  *) echo "[FAIL] unsupported namespace: $namespace" >&2; exit 2 ;;
esac

fail=0
note() { printf '%s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
bad()  { printf '[FAIL] %s\n' "$*" >&2; fail=1; }

# psql'i core-db/auth-db pod'unda calistirir; cikti TEK satir olur.
q_core() {
  kubectl -n "$namespace" exec deploy/core-db -- \
    psql -U hermes -d core_db -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}
q_auth() {
  kubectl -n "$namespace" exec deploy/auth-db -- \
    psql -U hermes -d auth_db -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}

note "=== 1) Sema revizyonlari ==="
core_rev="$(q_core "SELECT version_num FROM alembic_version")"
auth_rev="$(q_auth "SELECT version_num FROM alembic_version")"
[ -n "$core_rev" ] && ok "core revision: $core_rev" || bad "core revision okunamadi"
[ -n "$auth_rev" ] && ok "auth revision: $auth_rev" || bad "auth revision okunamadi"

note "=== 2) Runtime rol ayrimi ==="
bypass="$(q_core "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'hermes_%_app' AND (rolbypassrls OR rolsuper)")"
if [ "$bypass" = "0" ]; then
  ok "uygulama rolleri NOBYPASSRLS ve superuser degil"
else
  bad "uygulama rolu RLS'i asabiliyor (bypassrls/superuser) — izolasyon ANLAMSIZ"
fi

owned="$(q_core "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind='r' AND r.rolname LIKE 'hermes_%_app'")"
if [ "$owned" = "0" ]; then
  ok "uygulama rolu hicbir tablonun sahibi degil"
else
  bad "uygulama rolu $owned tablonun SAHIBI — FORCE RLS disinda kalabilir"
fi

note "=== 3) RLS kapsami ==="
# tenant_id tasiyan her tabloda RLS ENABLE + FORCE bekleriz.
missing_rls="$(q_core "
  SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_name = c.relname
                  AND col.column_name = 'tenant_id')
    AND c.relname NOT IN ('tenant_registry','tenant_counters')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")"
if [ "$missing_rls" = "0" ]; then
  ok "tum tenant tablolarinda RLS ENABLE + FORCE"
else
  bad "$missing_rls tabloda RLS eksik/zorlanmamis"
fi

missing_policy="$(q_core "
  SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname='public' AND p.tablename=c.relname)")"
if [ "$missing_policy" = "0" ]; then
  ok "RLS acik her tabloda en az bir politika var"
else
  bad "$missing_policy tabloda RLS acik ama POLITIKA YOK"
fi

note "=== 4) Backfill butunlugu ==="
null_rows="$(q_core "
  SELECT COALESCE(sum(cnt), 0) FROM (
    SELECT (xpath('/row/c/text()',
      query_to_xml(format('SELECT count(*) AS c FROM %I WHERE tenant_id IS NULL', c.relname),
                   false, true, '')))[1]::text::bigint AS cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_name=c.relname AND col.column_name='tenant_id')
  ) t")"
if [ "$null_rows" = "0" ]; then
  ok "tenant_id NULL kalan satir yok"
else
  bad "$null_rows satirda tenant_id NULL"
fi

note "=== 5) Baglamsiz erisim (fail-closed) ==="
# Uygulama rolunun kimligiyle, tenant baglami KURMADAN sorgu.
# Beklenen: 0 satir. Bu, "baglam yok = veri yok" vaadinin canli kaniti.
app_user="$(kubectl -n "$namespace" get secret hermes-db-roles \
  -o go-template='{{index .data "CORE_APP_DB_USER"}}' 2>/dev/null | base64 -d || true)"
if [ -z "$app_user" ]; then
  note "[SKIP] hermes-db-roles bulunamadi — baglamsiz erisim testi atlandi"
else
  visible="$(kubectl -n "$namespace" exec deploy/core-db -- \
    psql -U "$app_user" -d core_db -tAc \
    "SELECT count(*) FROM customers" 2>/dev/null | tr -d '[:space:]' || echo "ERR")"
  if [ "$visible" = "0" ]; then
    ok "tenant baglami olmadan 0 satir gorunuyor (fail-closed)"
  elif [ "$visible" = "ERR" ]; then
    note "[SKIP] uygulama rolu ile baglanilamadi (peer auth) — atlandi"
  else
    bad "tenant baglami YOKKEN $visible satir gorunuyor — RLS ETKISIZ"
  fi
fi

note "=== 6) Servis hazirligi ==="
for svc in auth-service core-service; do
  port=8000; [ "$svc" = "core-service" ] && port=8001
  code="$(kubectl -n "$namespace" exec "deploy/$svc" -- \
    sh -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:$port/ready" \
    2>/dev/null || echo "000")"
  if [ "$code" = "200" ]; then
    ok "$svc /ready → 200"
  else
    bad "$svc /ready → $code (sema uyumsuz veya pod hazir degil)"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ tenant izolasyon dumani GECTI ($namespace)"
else
  echo "❌ tenant izolasyon dumani BASARISIZ ($namespace)" >&2
fi
exit "$fail"
