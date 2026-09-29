#!/usr/bin/env bash
# =============================================================================
# Hermes masaustu indirmelerini yayinla (landing /downloads/)
# =============================================================================
# SUNUCUDA calisir (kubectl erisimi olan yerde).
#
#   scripts/k8s/publish-downloads.sh <namespace> <surum> <klasor>
#   ornek: publish-downloads.sh hermes-dev 0.1.0 /tmp/hermes-downloads
#
# <klasor> icinde su adlarla dosyalar beklenir (olmayan platform landing'de
# "Yakinda" gorunur):
#   Hermes-<surum>-arm64.dmg   Hermes-<surum>-x64.dmg   Hermes-<surum>-Setup-x64.exe
#
# Yapilan: manifest.json uretilir (boyut + sha256), `hermes-downloads`
# diskine yazma yetkili GECICI bir pod acilir, dosyalar kopyalanir, eski
# surumler silinir, pod kaldirilir. Frontend pod'u diski SALT-OKUNUR
# gorur; deploy/restart GEREKMEZ.
# =============================================================================
set -euo pipefail

NS="${1:?namespace}"
VERSION="${2:?surum (ornek 0.1.0)}"
SRC="${3:?dosya klasoru}"
POD="downloads-publisher"

declare -A FILES=(
  [mac-arm64]="Hermes-${VERSION}-arm64.dmg"
  [mac-x64]="Hermes-${VERSION}-x64.dmg"
  [win-x64]="Hermes-${VERSION}-Setup-x64.exe"
)

# --- manifest.json -------------------------------------------------------------
entries=()
for key in mac-arm64 mac-x64 win-x64; do
  f="${FILES[$key]}"
  if [[ -f "${SRC}/${f}" ]]; then
    size=$(stat -c %s "${SRC}/${f}")
    sha=$(sha256sum "${SRC}/${f}" | cut -d' ' -f1)
    entries+=("\"${key}\": {\"file\": \"${f}\", \"size\": ${size}, \"sha256\": \"${sha}\"}")
    echo "  + ${key}: ${f} (${size} bayt)"
  else
    echo "  - ${key}: ${f} yok (landing'de 'Yakinda')"
  fi
done
(IFS=,; printf '{"version": "%s", "released": "%s", "files": {%s}}\n' \
  "${VERSION}" "$(date -u +%F)" "${entries[*]}") > "${SRC}/manifest.json"

# --- gecici yazici pod -------------------------------------------------------
kubectl -n "${NS}" delete pod "${POD}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" apply -f - <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: ${POD}
  labels: { purpose: desktop-downloads }
spec:
  restartPolicy: Never
  containers:
  - name: publisher
    image: busybox:1.36
    command: ["sh", "-c", "sleep 900"]
    volumeMounts:
    - { name: downloads, mountPath: /downloads }
  volumes:
  - name: downloads
    persistentVolumeClaim: { claimName: hermes-downloads }
YAML
trap 'kubectl -n "${NS}" delete pod "${POD}" --ignore-not-found --wait=false >/dev/null' EXIT
kubectl -n "${NS}" wait --for=condition=Ready "pod/${POD}" --timeout=180s

# Eski surum dosyalari silinir (yalniz dmg/exe/manifest).
kubectl -n "${NS}" exec "${POD}" -- sh -c 'rm -f /downloads/*.dmg /downloads/*.exe /downloads/manifest.json'
for key in mac-arm64 mac-x64 win-x64; do
  f="${FILES[$key]}"
  [[ -f "${SRC}/${f}" ]] && kubectl -n "${NS}" cp "${SRC}/${f}" "${POD}:/downloads/${f}"
done
kubectl -n "${NS}" cp "${SRC}/manifest.json" "${POD}:/downloads/manifest.json"
kubectl -n "${NS}" exec "${POD}" -- sh -c 'chmod 0644 /downloads/*; ls -la /downloads'
echo "Yayinlandi: ${NS} surum ${VERSION}"
