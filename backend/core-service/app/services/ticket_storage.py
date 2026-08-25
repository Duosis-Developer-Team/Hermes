# =============================================================================
# HERMES core — Attachment object storage soyutlamasi
# =============================================================================
# D-008: ekler S3 uyumlu object storage'da tutulur; DB'de base64/bytea
# YOKTUR ve kalici public URL YOKTUR.
#
# Iki uygulama:
#   LocalObjectStorage — gelistirme/test. Dosya sistemi. Uretimde
#                        KULLANILMAZ (readiness bunu soyler).
#   S3CompatibleStorage — uretim. MinIO/S3/R2 vb.
#
# NEDEN boto3 YOK: bu servisin ihtiyaci dort islemdir (put/get/move/
# delete). boto3+botocore, tek bir ozellik icin buyuk bir bagimlilik ve
# CI kurulum suresi demekti. SigV4 imzalama determinist ve testlenebilir
# bir algoritmadir; burada AWS'nin yayimladigi kanonik adimlarin birebir
# karsiligi yazilidir ve `tests/test_ticket_storage.py` bunu bilinen bir
# vektorle dogrular.
#
# PRESIGNED URL BILEREK YOK: indirme her zaman uygulama uzerinden,
# yetki kontrolunden SONRA stream edilir. Boylece imzali URL hicbir
# zaman uretilmez, loglanmaz, e-posta/webhook'a dusmez (05 §5) ve
# "URL'i olan herkes indirir" sinifindan bir sizinti yolu OLUSMAZ.
# =============================================================================

from __future__ import annotations

import hashlib
import hmac
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional, Protocol
from urllib.parse import quote

import httpx

from ..config import get_settings

_EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
_ALGORITHM = "AWS4-HMAC-SHA256"
_SERVICE = "s3"


class StorageError(RuntimeError):
    """Object storage islemi basarisiz. Detay ISTEMCIYE cikmaz."""


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes, *, content_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def stream(self, key: str, *, chunk_size: int = 64 * 1024
               ) -> Iterator[bytes]: ...

    def move(self, source_key: str, target_key: str) -> None: ...

    def delete(self, key: str) -> None: ...

    def healthy(self) -> bool: ...


def new_object_key(prefix: str) -> str:
    """Rastgele, tahmin edilemez nesne anahtari.

    Dosya adi ANAHTARA GIRMEZ (05 §5): kullanicidan gelen ad yalnizca
    gosterim metadata'sidir. Tarih bolumleri operasyonel (lifecycle/
    listeleme) kolaylik icindir.
    """
    now = datetime.now(timezone.utc)
    return (
        f"{prefix}{now:%Y/%m/%d}/{uuid.uuid4().hex}"
    )


# =============================================================================
# Local (gelistirme/test)
# =============================================================================

class LocalObjectStorage:
    """Dosya sistemi tabanli depo — YALNIZCA dev/test.

    Anahtar dogrudan yola cevrilir ama once NORMALIZE edilir: `..`
    bilesenleri ve mutlak yollar reddedilir. Anahtarlar zaten
    uygulamanin urettigi rastgele degerlerdir; bu kontrol, ileride
    disaridan bir anahtar sizsa bile kok dizinin disina cikilmamasi
    icindir.
    """

    def __init__(self, root: str):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        root = self.root.resolve()
        if not str(candidate).startswith(str(root) + os.sep):
            raise StorageError("invalid object key")
        return candidate

    def put(self, key: str, data: bytes, *, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise StorageError("object not found")
        return path.read_bytes()

    def stream(self, key: str, *, chunk_size: int = 64 * 1024):
        path = self._path(key)
        if not path.exists():
            raise StorageError("object not found")
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    def move(self, source_key: str, target_key: str) -> None:
        src, dst = self._path(source_key), self._path(target_key)
        if not src.exists():
            raise StorageError("object not found")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except StorageError:
            raise
        except OSError as exc:  # pragma: no cover
            raise StorageError("delete failed") from exc

    def healthy(self) -> bool:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            probe = self.root / ".health"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return True
        except OSError:
            return False


# =============================================================================
# S3 uyumlu (uretim)
# =============================================================================

def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret: str, date_stamp: str, region: str,
                service: str = _SERVICE) -> bytes:
    """SigV4 turetilmis imzalama anahtari (tarih → bolge → servis)."""
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def canonical_request(
    method: str, path: str, query: str, headers: dict, payload_hash: str
) -> str:
    """AWS kanonik istegi. Basliklar KUCUK HARF + SIRALI olmak zorunda —
    en sik yapilan imza hatasi budur."""
    lowered = {k.lower(): str(v).strip() for k, v in headers.items()}
    canonical_headers = "".join(
        f"{k}:{lowered[k]}\n" for k in sorted(lowered)
    )
    signed_headers = ";".join(sorted(lowered))
    return "\n".join([
        method.upper(), path, query, canonical_headers, signed_headers,
        payload_hash,
    ])


class S3CompatibleStorage:
    """SigV4 imzali, path-style/virtual-host destekli minimal S3 istemcisi."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        region: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        force_path_style: bool = True,
        timeout: float = 30.0,
    ):
        if not (endpoint_url and bucket and access_key and secret_key):
            raise StorageError("object storage is not fully configured")
        self.endpoint = endpoint_url.rstrip("/")
        self.region = region
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key
        self.force_path_style = force_path_style
        self.timeout = timeout

    # -- adres/imza ---------------------------------------------------
    def _url_and_path(self, key: str) -> tuple:
        encoded = quote(key, safe="/")
        if self.force_path_style:
            path = f"/{self.bucket}/{encoded}"
            return f"{self.endpoint}{path}", path
        path = f"/{encoded}"
        scheme, _, host = self.endpoint.partition("://")
        return f"{scheme}://{self.bucket}.{host}{path}", path

    def _host(self, url: str) -> str:
        return url.split("://", 1)[1].split("/", 1)[0]

    def _auth_headers(
        self, method: str, url: str, path: str, payload: bytes,
        extra: Optional[dict] = None,
    ) -> dict:
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = (
            hashlib.sha256(payload).hexdigest() if payload else _EMPTY_SHA256
        )
        headers = {
            "host": self._host(url),
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if extra:
            headers.update({k.lower(): v for k, v in extra.items()})

        creq = canonical_request(method, path, "", headers, payload_hash)
        scope = f"{date_stamp}/{self.region}/{_SERVICE}/aws4_request"
        sts = "\n".join([
            _ALGORITHM, amz_date, scope,
            hashlib.sha256(creq.encode("utf-8")).hexdigest(),
        ])
        signature = hmac.new(
            signing_key(self.secret_key, date_stamp, self.region),
            sts.encode("utf-8"), hashlib.sha256,
        ).hexdigest()
        signed_headers = ";".join(sorted(headers))
        headers["authorization"] = (
            f"{_ALGORITHM} Credential={self.access_key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        return headers

    def _request(
        self, method: str, key: str, *, payload: bytes = b"",
        extra_headers: Optional[dict] = None, stream: bool = False,
    ):
        url, path = self._url_and_path(key)
        headers = self._auth_headers(
            method, url, path, payload, extra_headers
        )
        client = httpx.Client(timeout=self.timeout)
        try:
            if stream:
                # Cagiran, context manager'i kapatmakla yukumlu.
                return client, client.stream(
                    method, url, headers=headers
                )
            response = client.request(
                method, url, headers=headers, content=payload or None
            )
            if response.status_code >= 400:
                # Saglayici hata govdesi ISTEMCIYE cikmaz; yalnizca
                # status ile sinirli bir hata mesaji.
                raise StorageError(
                    f"object storage returned {response.status_code}"
                )
            return response
        finally:
            if not stream:
                client.close()

    # -- ObjectStorage ------------------------------------------------
    def put(self, key: str, data: bytes, *, content_type: str) -> None:
        self._request(
            "PUT", key, payload=data,
            extra_headers={
                "content-type": content_type or "application/octet-stream",
                # Sunucu tarafi sifreleme (05 §5). Destekleyemeyen bir
                # saglayici bu basligi yok sayar.
                "x-amz-server-side-encryption": "AES256",
            },
        )

    def get(self, key: str) -> bytes:
        return self._request("GET", key).content

    def stream(self, key: str, *, chunk_size: int = 64 * 1024):
        client, ctx = self._request("GET", key, stream=True)
        try:
            with ctx as response:
                if response.status_code >= 400:
                    raise StorageError(
                        f"object storage returned {response.status_code}"
                    )
                for chunk in response.iter_bytes(chunk_size):
                    yield chunk
        finally:
            client.close()

    def move(self, source_key: str, target_key: str) -> None:
        """COPY + DELETE. S3'te atomik `move` yoktur.

        Sira ONEMLI: once kopya DOGRULANIR, sonra kaynak silinir. Ters
        sirada bir hata, dosyanin tamamen kaybolmasi demekti.
        """
        src = quote(f"/{self.bucket}/{source_key}", safe="/")
        self._request(
            "PUT", target_key,
            extra_headers={
                "x-amz-copy-source": src,
                "x-amz-server-side-encryption": "AES256",
            },
        )
        self._request("DELETE", source_key)

    def delete(self, key: str) -> None:
        url, path = self._url_and_path(key)
        headers = self._auth_headers("DELETE", url, path, b"")
        with httpx.Client(timeout=self.timeout) as client:
            response = client.delete(url, headers=headers)
        if response.status_code not in (200, 204, 404):
            raise StorageError(
                f"object storage returned {response.status_code}"
            )

    def healthy(self) -> bool:
        """Bucket'a erisilebiliyor mu? Nesne YAZMAZ."""
        try:
            url, path = self._url_and_path("")
            headers = self._auth_headers("HEAD", url, path.rstrip("/"), b"")
            with httpx.Client(timeout=self.timeout) as client:
                response = client.head(
                    url.rstrip("/"), headers=headers
                )
            return response.status_code < 400
        except Exception:  # noqa: BLE001 — saglik kontrolu patlamaz
            return False


# =============================================================================
# Fabrika
# =============================================================================

_cached = None


def get_storage(force_reload: bool = False):
    """Yapilandirmaya gore depo ornegi (surec basina cache'li)."""
    global _cached
    if _cached is not None and not force_reload:
        return _cached
    settings = get_settings()
    backend = (settings.TICKET_STORAGE_BACKEND or "local").lower()
    if backend == "s3":
        _cached = S3CompatibleStorage(
            endpoint_url=settings.TICKET_S3_ENDPOINT_URL,
            region=settings.TICKET_S3_REGION,
            bucket=settings.TICKET_S3_BUCKET,
            access_key=settings.TICKET_S3_ACCESS_KEY_ID,
            secret_key=settings.TICKET_S3_SECRET_ACCESS_KEY,
            force_path_style=settings.TICKET_S3_FORCE_PATH_STYLE,
        )
    else:
        _cached = LocalObjectStorage(settings.TICKET_STORAGE_LOCAL_ROOT)
    return _cached


def reset_storage_cache() -> None:
    """Testler ve yapilandirma degisiklikleri icin."""
    global _cached
    _cached = None
