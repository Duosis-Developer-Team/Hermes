# =============================================================================
# HERMES core — Ticket metin sanitizasyonu (SUNUCU TARAFI KANONIK)
# =============================================================================
# 05 §6: "Server-side sanitization canonicaldir; frontend sanitization
# tek savunma DEGILDIR." Ticket govdeleri uc ayri yuzeyde render edilir
# (Hermes hub, Hermes portal, kaynak uygulamanin portali) ve ucuncusunu
# BIZ kontrol etmiyoruz. Bu yuzden temizlik, veri KAYDEDILMEDEN once
# burada yapilir — her tuketici ayni guvenli metni alir.
#
# V1 icerik politikasi: duz metin + sinirli CommonMark (kalin, italik,
# liste, kod, link). Ham HTML KAPALI. `javascript:`/`data:` URI YASAK.
# =============================================================================

from __future__ import annotations

import re
import unicodedata

# `<script>`, `<img onerror=...>`, `<iframe>` ... — etiket benzeri her
# sey kaldirilir. Markdown'da acisal parantezle yazilan otolink
# (`<https://x>`) da kaldirilir; kayip degil, cunku duz URL zaten
# otolink olur.
_TAG_RE = re.compile(r"<[^>\n]{0,2000}>")

# Markdown link/imaj hedefinde tehlikeli semalar.
_DANGEROUS_URI_RE = re.compile(
    r"\]\(\s*(javascript|data|vbscript|file)\s*:", re.IGNORECASE
)

# Duz metinde gecen tehlikeli semalar (otolink'e donusebilir).
_BARE_DANGEROUS_RE = re.compile(
    r"\b(javascript|vbscript)\s*:", re.IGNORECASE
)

# Kontrol karakterleri (tab/newline haric) — terminal/CSV enjeksiyonu ve
# gorunmez icerik.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Sifir genislikli / yon degistiren karakterler: gorsel kandirma
# (bidi override) icin kullanilir.
_INVISIBLE_RE = re.compile(r"[​-‏‪-‮⁦-⁩]")


def sanitize_body(value: str, *, max_length: int) -> str:
    """Kullanici metnini kanonik guvenli bicime getirir.

    Kaldirir/etkisizlestirir: ham HTML etiketleri, tehlikeli URI
    semalari, kontrol ve gorunmez karakterler, CRLF. Kirpma SON adimdir
    — once temizlik, sonra uzunluk (aksi halde kirpma bir etiketi yarim
    birakip yeniden tehlikeli hale getirebilirdi).

    NOT: bu bir HTML sanitizer'i DEGILDIR (biz HTML uretmiyoruz); amac,
    depolanan metnin herhangi bir tuketicide aktif icerige donusememesi.
    """
    if value is None:
        return ""
    text = unicodedata.normalize("NFC", str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)
    text = _INVISIBLE_RE.sub("", text)
    text = _TAG_RE.sub("", text)
    text = _DANGEROUS_URI_RE.sub("](blocked:", text)
    text = _BARE_DANGEROUS_RE.sub("blocked:", text)
    # Uc uc bosluklari kirp; ic bosluk/satirlar korunur (log yapistirma).
    text = text.strip()
    if len(text) > max_length:
        text = text[:max_length].rstrip()
    return text


def sanitize_single_line(value, *, max_length: int) -> str:
    """Baslik/isim gibi TEK SATIR alanlar icin."""
    text = sanitize_body(value or "", max_length=max_length)
    text = " ".join(text.split())
    return text[:max_length]


_FILENAME_UNSAFE_RE = re.compile(r"[^A-Za-z0-9._ ()\-À-ɏ]")


def sanitize_filename(value: str, *, max_length: int = 200) -> str:
    """Dosya adi YALNIZCA gosterim metadata'sidir (05 §5).

    Path traversal bilesenleri (`/`, `\\`, `..`) ve surprizli karakterler
    duser. Gercek nesne anahtari zaten rastgeledir — yani bu ad hicbir
    zaman bir dosya sistemi yoluna donmez; yine de indirme sirasinda
    `Content-Disposition`a girdigi icin temiz olmasi gerekir.
    """
    name = unicodedata.normalize("NFC", str(value or "")).strip()
    name = name.replace("\\", "/").split("/")[-1]
    name = name.replace("..", ".")
    name = _CONTROL_RE.sub("", name)
    name = _INVISIBLE_RE.sub("", name)
    name = _FILENAME_UNSAFE_RE.sub("_", name)
    name = name.strip(" .") or "attachment"
    if len(name) > max_length:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            name = stem[: max_length - len(ext) - 1] + "." + ext
        else:
            name = name[:max_length]
    return name
