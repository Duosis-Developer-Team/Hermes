#!/usr/bin/env bash
# =============================================================================
# HERMES - Sema migration Job'i calistirici (WS1)
# =============================================================================
# k8s/07-migration-job.yaml sablonunu doldurur, uygular ve BITMESINI
# BEKLER. Job basarisiz olursa non-zero exit doner — CD bu noktada durur
# ve uygulama rollout'u HIC baslamaz.
#
# Kullanim:
#   ./scripts/k8s/run-migration-job.sh <namespace> <image-tag>
#
# Ornek (CD):
#   ./scripts/k8s/run-migration-job.sh hermes-dev "$GITHUB_SHA"
#
# GUVENLIK: hicbir Secret degeri okunmaz/yazdirilmaz. Basarisizlikta
# Job loglari yazdirilir; migration_runner sifre/URL basmaz (yalniz
# hata tipi ve mesaji).
# =============================================================================
set -euo pipefail

namespace="${1:?usage: $0 <namespace> <image-tag>}"
image_tag="${2:?usage: $0 <namespace> <image-tag>}"

case "$namespace" in
  hermes-dev) hermes_environment="dev" ;;
  hermes-test) hermes_environment="test" ;;
  *) echo "[FAIL] unsupported namespace: $namespace" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
template="${repo_root}/k8s/07-migration-job.yaml"
[ -f "$template" ] || { echo "[FAIL] sablon yok: $template" >&2; exit 2; }

# Job adlari IMMUTABLE'dir: her kosu icin SHA'ya bagli benzersiz ad.
short_tag="$(printf '%s' "$image_tag" | tr -cd 'a-z0-9' | cut -c1-12)"
job_name="hermes-migrate-${short_tag}"

# Onkosul: migrator credential'i olmadan Job baslamasin (deger OKUNMAZ,
# yalnizca key varligi kontrol edilir).
if ! kubectl -n "$namespace" get secret hermes-db-roles >/dev/null 2>&1; then
  echo "[FAIL] ${namespace}/hermes-db-roles Secret'i yok — migrator " \
       "credential'i olmadan migration kosulamaz." >&2
  echo "       Kurulum: backend/sql_scripts/roles/README.md" >&2
  exit 3
fi

# -----------------------------------------------------------------------------
# Onkosul: migrator, degistirecegi nesnelerin SAHIBI olmali
# -----------------------------------------------------------------------------
# Eski Hermes semayi uygulama startup'inda superuser `hermes` adina
# yaratiyordu. `00_roles.sql` semanin sahibini migrator yapar ama ONCEDEN
# var olan nesnelerin sahipligini degistirmez. Migrator bir baskasinin
# nesnesini degistirmeye kalkinca PostgreSQL "must be owner of ..." der ve
# migration YARIDA kirilir (canlida birebir yasandi:
# `must be owner of function assign_task_type_number`).
#
# Bunu Job basladiktan SONRA ogrenmek pahali: hangi migration'in nerede
# durdugunu log'dan cikarmak gerekir. Burada, DDL'e dokunmadan, tek
# sorguyla ve NET talimatla duruyoruz.
#
# Eklenti uyeleri (`pg_depend.deptype='e'`) haric tutulur — TimescaleDB'nin
# 100+ fonksiyonu `public`'te yasar, sahipligi eklentiye aittir ve
# migration onlara dokunmaz.
check_object_ownership() {
  local db_pod="$1" db_name="$2" migrator="$3"
  local stray
  stray="$(kubectl -n "$namespace" exec "$db_pod" -- psql -U hermes \
    -d "$db_name" -tAc "
    SELECT count(*) FROM (
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
        AND pg_get_userbyid(c.relowner) <> '${migrator}'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid='pg_class'::regclass
                          AND d.objid=c.oid AND d.deptype='e')
      UNION ALL
      SELECT p.oid FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.prokind IN ('f','p')
        AND pg_get_userbyid(p.proowner) <> '${migrator}'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid='pg_proc'::regclass
                          AND d.objid=p.oid AND d.deptype='e')
    ) t" </dev/null 2>/dev/null | tr -d '[:space:]')"

  # Bos cikti = sorgu kosturulamadi. "0" ile ayni sayilmaz; sessizce
  # gecmek bu kapinin tum anlamini yok ederdi.
  if [ -z "$stray" ]; then
    echo "[FAIL] ${db_name}: sahiplik onkosulu DOGRULANAMADI (${db_pod})." >&2
    exit 4
  fi
  if [ "$stray" != "0" ]; then
    echo "[FAIL] ${db_name}: ${stray} nesnenin sahibi ${migrator} DEGIL." >&2
    echo "       Migration 'must be owner of ...' ile kirilir." >&2
    echo "       Duzeltme (sunucuda, superuser ile):" >&2
    echo "         kubectl -n ${namespace} exec -i ${db_pod} -- psql -U hermes \\" >&2
    echo "           -d ${db_name} -v ON_ERROR_STOP=1 -v prefix=${migrator%_migrator} \\" >&2
    echo "           -f - < backend/sql_scripts/roles/01_adopt_objects.sql" >&2
    exit 4
  fi
  echo "[OK] ${db_name}: tum uygulama nesneleri ${migrator} sahipliginde"
}

core_db_pod="$(kubectl -n "$namespace" get pod -l app=core-db \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
auth_db_pod="$(kubectl -n "$namespace" get pod -l app=auth-db \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
if [ -z "$core_db_pod" ] || [ -z "$auth_db_pod" ]; then
  echo "[FAIL] core-db/auth-db pod'u bulunamadi ($namespace)" >&2
  exit 4
fi
check_object_ownership "$auth_db_pod" auth_db hermes_auth_migrator
check_object_ownership "$core_db_pod" core_db hermes_core_migrator

# Ayni SHA icin onceki (basarili/basarisiz) Job varsa temizle: Job spec'i
# immutable oldugu icin yeniden apply edilemez.
if kubectl -n "$namespace" get job "$job_name" >/dev/null 2>&1; then
  echo "[INFO] onceki Job siliniyor: $job_name"
  kubectl -n "$namespace" delete job "$job_name" --wait=true
fi

echo "[INFO] migration Job olusturuluyor: ${namespace}/${job_name} (tag=${image_tag})"
JOB_NAME="$job_name" \
NAMESPACE="$namespace" \
IMAGE_TAG="$image_tag" \
HERMES_ENVIRONMENT="$hermes_environment" \
  envsubst '${JOB_NAME} ${NAMESPACE} ${IMAGE_TAG} ${HERMES_ENVIRONMENT}' \
  < "$template" | kubectl apply -f -

echo "[INFO] Job bitmesi bekleniyor (timeout 600s)..."
if kubectl -n "$namespace" wait --for=condition=complete \
     "job/${job_name}" --timeout=600s; then
  echo "[OK] migration tamamlandi"
  kubectl -n "$namespace" logs "job/${job_name}" --tail=50 || true
  exit 0
fi

echo "[FAIL] migration Job tamamlanmadi — rollout DURDURULUYOR." >&2
kubectl -n "$namespace" describe "job/${job_name}" >&2 || true
kubectl -n "$namespace" logs "job/${job_name}" --tail=200 >&2 || true
exit 1
