#!/usr/bin/env bash
# =============================================================================
# logislot-prod  ->  hermes-test  baglantisi (idempotent)
# =============================================================================
# CD (kustomize) ConfigMap'i HER DEPLOY'DA repo'daki haline dondurur; bu betik
# deploy'dan SONRA calistirilir. Secret repo'da yonetilmedigi icin kalicidir.
set -euo pipefail
CID=8efe5764-eb20-46cf-9c01-66e7c004005f
BASE=https://hermes.duosis.com/api/integrations/v1

pod() { kubectl -n logislot-prod get pods -l app.kubernetes.io/name=logislot-api   --field-selector=status.phase=Running --no-headers -o custom-columns=N:.metadata.name 2>/dev/null | head -1; }
[ -z "$(pod)" ] && pod() { kubectl -n logislot-prod get pods --field-selector=status.phase=Running   --no-headers -o custom-columns=N:.metadata.name | grep '^logislot-api' | head -1; }

echo '== 1. ticketing kodu var mi (kapi) =='
P=$(pod)
if ! kubectl -n logislot-prod exec "$P" -c api -- test -f /srv/api/app/integrations/hermes_support_client.py 2>/dev/null; then
  echo '   DURDU: logislot-prod hala ticketing ONCESI imajda. Once GitHub deploy onayi.'; exit 1
fi
echo '   tamam'

echo '== 2. secret (hermes-test kaynakli, deger loglanmaz) =='
TOK=$(kubectl -n hermes-test get secret logislot-hermes-credential -o jsonpath='{.data.HERMES_SUPPORT_API_TOKEN}' | base64 -d)
WHS=$(kubectl -n hermes-test get secret logislot-hermes-credential -o jsonpath='{.data.HERMES_SUPPORT_WEBHOOK_SECRET}' | base64 -d)
kubectl -n logislot-prod patch secret logislot-secrets --type merge   -p "{\"stringData\":{\"LOGISLOT_HERMES_SUPPORT_TOKEN\":\"$TOK\",\"LOGISLOT_HERMES_SUPPORT_WEBHOOK_SECRET\":\"$WHS\"}}" >/dev/null
echo '   tamam'

echo '== 3. configmap (TUZAK: base /v1 ile biter, sonuna /support EKLENMEZ) =='
kubectl -n logislot-prod patch cm logislot-config --type merge   -p "{\"data\":{\"LOGISLOT_HERMES_SUPPORT_BASE_URL\":\"$BASE\",\"LOGISLOT_HERMES_SUPPORT_CLIENT_ID\":\"$CID\"}}" >/dev/null
echo '   tamam'

echo '== 4. restart =='
kubectl -n logislot-prod rollout restart deploy/logislot-api deploy/logislot-scheduler >/dev/null
kubectl -n logislot-prod rollout status deploy/logislot-api --timeout=180s

echo '== 5. dogrulama: pod icinden hermes-test cagrisi =='
P=$(pod)
kubectl -n logislot-prod exec "$P" -c api -- python3 -c "
from app.core.config import get_settings
import urllib.request, urllib.error, json
s = get_settings()
print('   base_url  =', s.hermes_support_base_url)
print('   client_id =', s.hermes_support_client_id)
print('   token     =', 'DOLU' if s.hermes_support_token else 'BOS')
r = urllib.request.Request(s.hermes_support_base_url + '/support/routing-groups',
                           headers={'Authorization': 'Bearer ' + s.hermes_support_token})
try:
    b = json.load(urllib.request.urlopen(r, timeout=10))
    print('   routing-groups 200:', [i['name'] for i in b['items']])
except urllib.error.HTTPError as e:
    print('   routing-groups HATA', e.code, e.read()[:200].decode())
"
echo
echo 'KALAN (bu betigin disinda):'
echo '  a) hermes-test: logislot application callback_url  ->  DNS sonrasi'
echo '  b) hermes-test: source tenant + route  ->  tenant UUID + hedef ekip karari'
