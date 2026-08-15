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
