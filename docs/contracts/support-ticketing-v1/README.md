# Support Ticketing Contract v1 — provider fixtures

Bu klasor, **Hermes ile kaynak uygulamalar (LogiSlot ve gelecekteki
urunler) arasindaki sozlesmenin DONMUS anlik goruntusudur.**

Hermes bu sozlesmenin **provider** tarafidir. Consumer taraf bu klasoru
kendi reposuna **kopyalar** ve kendi testinde ayni karsilastirmayi
yapar. Cross-repo bir paket yayinlama altyapisi olmadigi icin yontem
bilincli olarak "kontrollu duplicate fixture + parite testi"dir
(WS0 karari).

## Dosyalar

| Dosya | Ne ise yarar |
|---|---|
| `contract.json` | Enum'lar, event tipleri, hata katalogu (+`retryable`), scope'lar, limitler, imza ve retry politikasi |
| `webhook-signature-vector.json` | **Altin imza vektoru** — iki repo ayni baytlari ayni sekilde imzalamali |
| `samples/ticket-create-request.json` | Ornek create govdesi |
| `samples/ticket-create-response.json` | Ornek create yaniti |
| `samples/webhook-events.json` | Her outbound event tipi icin ornek zarf |
| `samples/error-envelope.json` | Hata zarfi ornegi |

## Parite kapisi

Hermes tarafinda `backend/core-service/tests/ticketing/test_contract.py`
sunu dogrular:

```
app/ticket_contract.py  ==  contract.json
```

Kodda sessizce bir enum degistirmek CI'da **kirilir**. Degisiklik
isteniyorsa fixture da bilincli olarak guncellenir ve karsi repoya
bildirilir (breaking degisiklik v1 icinde sessizce yapilmaz).

## Taban adres

```
https://<hermes-host>/api/integrations/v1/support/...
```

Sozlesme dokumaninin ornegi `/api/public/v1/support` idi ve "gercek repo
routing convention'ina uyarlanabilir; **version ve semantik
korunmalidir**" diyor. `/api/public` mount'u Hermes'te **ayri** bir
uygulamadir: kendi donmus hata zarfi (`code/message/request_id`) ve
"service client'lar read-only" kurali vardir. Ticket sozlesmesi ise
`correlation_id` + `retryable` tasiyan farkli bir zarf ve service
client YAZMA gerektirir. Bu yuzden ticket ingress'i **izole bir
alt-uygulamaya** mount edildi; `v1/support/...` son eki **birebir**
korundu. Consumer icin bu bir **konfigurasyon** farkidir (taban URL),
sozlesme farki degil.

## Kimlik

```
Authorization: Bearer hsi_dev_...      (dev)
Authorization: Bearer hsi_live_...     (test/prod)
```

Token bir Duosis support yoneticisi tarafindan uretilir
(`tickets.config.manage`) ve **tek bir uygulama** adina calisir.
`application_code` istek govdesinde **yoktur** — kapsam token
kaydindan gelir.

## Imza dogrulama (consumer tarafi)

```
signed_bytes = f"{X-Hermes-Timestamp}.{raw_request_body}"
expected     = hmac_sha256(secret, signed_bytes).hexdigest()   # lowercase hex
```

- `X-Hermes-Signature` ile **sabit zamanli** karsilastirin.
- `X-Hermes-Timestamp` 300 saniyeden eskiyse **reddedin**.
- `X-Hermes-Event-Id` ile inbox tutun: ayni kimlik iki kez uygulanmaz.
- Govdeyi **ham** haliyle imzalayin/dogrulayin — yeniden serialize
  etmek imzayi bozar.

`webhook-signature-vector.json` bu adimlarin dogru uygulandigini
kanitlamak icindir; consumer testinizde bu vektoru kullanin.

## Sira (ordering)

Her olay ticket basina monoton `sequence` tasir:

- `sequence == local + 1` → uygula;
- `<=` → idempotent ack (tekrar uygulama);
- `>`  → **bosluk**: dogrudan uygulama, `GET /v1/support/tickets/{id}`
  ile snapshot al.

## Internal icerik

`internal note`, `internal root cause` ve agent kisisel kimligi
**hicbir** event'te, snapshot'ta veya API yanitinda bulunmaz. Musteri
yuzeyindeki agent mesajlarinda yazar adi **ekip adidir**.
