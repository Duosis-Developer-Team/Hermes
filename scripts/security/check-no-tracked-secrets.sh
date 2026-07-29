#!/usr/bin/env bash
# =============================================================================
# HERMES - Tracked-secret guard (Sprint 0, CTO paketi 2026-07-29)
# =============================================================================
# Git INDEX'inde secret tasiyabilecek dosya kalmadigini dogrular.
# HICBIR deger/icerik yazdirmaz — yalnizca ihlal eden PATH'i soyler.
# CI'da production build'den once kosar; ihlal = non-zero exit.
#
# Kapsam bilinci: bu kontrol CURRENT TREE icindir. Eski commit'lerdeki
# bloblar bilerek kapsam disidir (history cleanup ayri onayli operasyon;
# bkz. Hermes_Premium_Frontend_CTO_Pack_v1/12_GIT_HISTORY_CLEANUP_RUNBOOK.md).
# =============================================================================
set -euo pipefail

fail=0

say_fail() { echo "[FAIL] $1" >&2; fail=1; }

# --- 1. Yasakli tracked path desenleri (example'lar muaf) ---------------
while IFS= read -r path; do
  case "$path" in
    *.env.example|*/.env.example|*.example.yaml|*.example.yml) continue ;;
  esac
  case "$path" in
    .env|*/.env|*.env|.env.*|*/.env.*|*.key|*.pem|*.p12|*.pfx|tls.crt|*/tls.crt)
      say_fail "forbidden tracked path: $path" ;;
    *secret*.yaml|*secret*.yml)
      say_fail "tracked secret manifest: $path" ;;
    kubeconfig|*.kubeconfig|*/kubeconfig)
      say_fail "tracked kubeconfig: $path" ;;
  esac
done < <(git ls-files)

# --- 2. Tracked icerikte private-key marker (yalniz PATH basilir) -------
# Ikili dosyalar atlanir (-I); eslesen SATIR asla yazdirilmaz (-l).
# Desen iki parcadan kurulur ki bu script kendi regex'iyle ESLESMESIN
# (self-match: ilk surumde guard kendini yakaladi).
pk_head='-----BEGIN'
pk_tail='PRIVATE KEY-----'
if key_paths="$(git grep -lIE "${pk_head}.*${pk_tail}" -- . 2>/dev/null)"; then
  while IFS= read -r p; do
    say_fail "tracked private-key marker in: $p"
  done <<< "$key_paths"
fi

# --- 3. Example sablonlarinda placeholder disi deger ---------------------
# stringData/data altindaki her deger acik placeholder olmali. Ihlalde
# yalnizca dosya+key adi soylenir, deger ASLA basilmaz.
for tpl in $(git ls-files | grep -E '\.example\.ya?ml$' || true); do
  bad_keys="$(awk '
    /^(stringData|data):[[:space:]]*$/ {mode=1; next}
    mode && /^[^[:space:]]/ {mode=0}
    mode && /^[[:space:]]{2}[A-Za-z_.0-9-]+:/ {
      key=$1; sub(/:$/,"",key)
      val=$0; sub(/^[[:space:]]+[A-Za-z_.0-9-]+:[[:space:]]*/,"",val)
      if (val !~ /^(REQUIRED_FROM_OPERATOR|REQUIRED_LOCAL_VALUE|REPLACE_WITH_[A-Z_]+)[[:space:]]*$/)
        print key
    }' "$tpl")"
  if [ -n "$bad_keys" ]; then
    while IFS= read -r k; do
      say_fail "non-placeholder value in template: $tpl key=$k"
    done <<< "$bad_keys"
  fi
done

# --- 4. Uretilen artefakt dizinleri tracked mi ---------------------------
for d in frontend/dist dist coverage playwright-report test-results; do
  if git ls-files --error-unmatch "$d" >/dev/null 2>&1 || \
     [ -n "$(git ls-files "$d" 2>/dev/null | head -1)" ]; then
    say_fail "generated artifact directory is tracked: $d"
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "[OK] no tracked secrets, private keys, env files or real-valued templates"
fi
exit "$fail"
