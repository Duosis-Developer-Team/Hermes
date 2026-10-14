#!/usr/bin/env bash
# =============================================================================
# HERMES - cd-dev hizli hat karari: bu commit YALNIZ frontend mi degistiriyor?
# =============================================================================
# Taban = kumede CANLI calisan backend SHA'si (push'un `before`'i DEGIL):
# iptal edilmis/atlanmis bir onceki kosunun backend degisikligi de boylece
# farka girer ve hizli hatta kaybolmaz. Herhangi bir belirsizlikte TAM hat
# (fail-safe): backend SHA'lari ayrismis, canli SHA repoda yok / ata degil,
# fark bos ya da `frontend/` disinda tek bir dosya bile var.
#
# Cikti: GITHUB_OUTPUT'a `frontend_only=true|false`. Salt-okur (kubectl get).
# Kullanim: dev-change-scope.sh <namespace>
# =============================================================================
set -uo pipefail

NS="${1:?namespace}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

decide() {
    echo "frontend_only=$1" >> "$OUT"
    echo "::notice::kapsam: $2"
    exit 0
}

DEPLOYS="auth-service core-service reporting-service"
kubectl -n "$NS" get deployment hermes-mcp >/dev/null 2>&1 && DEPLOYS="$DEPLOYS hermes-mcp"

# shellcheck disable=SC2086
SHAS="$(kubectl -n "$NS" get deployment $DEPLOYS \
    -o jsonpath='{range .items[*]}{.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null \
    | sed -n 's/.*:\([0-9a-f]\{40\}\)$/\1/p' | sort -u)"
COUNT="$(printf '%s\n' "$SHAS" | grep -c . || true)"
[ "$COUNT" = "1" ] || decide false "canli backend SHA'si tek ve okunur degil ($COUNT) -> tam hat"
BASE="$SHAS"

git cat-file -e "${BASE}^{commit}" 2>/dev/null || decide false "canli SHA $BASE repoda yok -> tam hat"
git merge-base --is-ancestor "$BASE" "$GITHUB_SHA" || decide false "canli SHA $BASE bu commit'in atasi degil -> tam hat"

CHANGED="$(git diff --name-only "$BASE" "$GITHUB_SHA")"
[ -n "$CHANGED" ] || decide false "canli backend ile fark yok -> tam hat"
if printf '%s\n' "$CHANGED" | grep -qv '^frontend/'; then
    decide false "frontend disi degisiklik var -> tam hat"
fi
decide true "yalniz frontend degisti (canli backend ${BASE:0:7}) -> hizli hat"
