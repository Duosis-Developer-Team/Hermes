# =============================================================================
# HERMES Public API - Rate limiting (Stage 2C)
# =============================================================================
# Onayli karar #3: v1'de in-memory fixed-window limiter; arayuz Redis'e
# gecise hazir (RateLimiter soyutlamasi — backend degisince cagiranlar
# degismez).
#
# BILINEN SINIRLAR (tek replika gercekligi ile kabul edildi):
#   - Sayaclar pod restart'inda sifirlanir.
#   - Birden fazla replika calisirsa limit POD BASINA olur (global degil).
#   Redis backend'i eklendiginde ikisi de ortadan kalkar.
# =============================================================================

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_epoch: int  # pencerenin sifirlanacagi Unix saniyesi

    @property
    def retry_after(self) -> int:
        return max(1, self.reset_epoch - int(time.time()))


class RateLimiter:
    """Degistirilebilir arayuz — Redis implementasyonu ayni imzayi korur."""

    def check(self, key: str, limit: int, window_seconds: int) -> RateLimitResult:
        raise NotImplementedError


class InMemoryRateLimiter(RateLimiter):
    """Fixed-window sayac. `now_fn` testlerde saat enjeksiyonu icindir."""

    def __init__(self, now_fn=time.time):
        self._now = now_fn
        self._lock = threading.Lock()
        # key -> (window_start_epoch, count)
        self._buckets: dict = {}

    def check(self, key: str, limit: int, window_seconds: int) -> RateLimitResult:
        now = int(self._now())
        window_start = now - (now % window_seconds)
        reset = window_start + window_seconds
        with self._lock:
            start, count = self._buckets.get(key, (window_start, 0))
            if start != window_start:
                count = 0  # yeni pencere
            count += 1
            self._buckets[key] = (window_start, count)
            # Basit bellek hijyeni: kova sayisi buyurse eski pencereleri at.
            if len(self._buckets) > 10000:
                self._buckets = {
                    k: v
                    for k, v in self._buckets.items()
                    if v[0] == window_start
                }
        allowed = count <= limit
        return RateLimitResult(
            allowed=allowed,
            limit=limit,
            remaining=max(0, limit - count),
            reset_epoch=reset,
        )


_limiter: RateLimiter = InMemoryRateLimiter()


def get_limiter() -> RateLimiter:
    return _limiter


def set_limiter(limiter: RateLimiter) -> None:
    """Test izolasyonu / gelecekte Redis backend takmak icin."""
    global _limiter
    _limiter = limiter


def rate_limit_headers(result: RateLimitResult) -> dict:
    headers = {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(result.remaining),
        "X-RateLimit-Reset": str(result.reset_epoch),
    }
    if not result.allowed:
        headers["Retry-After"] = str(result.retry_after)
    return headers
