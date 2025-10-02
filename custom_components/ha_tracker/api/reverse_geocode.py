# reverse_geocode.py
"""
Reverse Geocoding endpoint (Nominatim) with:
- Persistent cache (HA Store) + optional compaction
- Grid index + bounding-box prefilter + haversine (prefiltro barato y exacto)
- Entry cap + TTL prune (con "hot map" para mantener vivas entradas REVISITADAS sin reescribir el JSON grande)
- Hysteresis cap (cuando supera 10k, baja hasta 8k de una vez)
- Global rate limit (con pequeño jitter)
- Coalesced saves (async_delay_save) para reducir I/O
- Concurrency de-dup por celda
- Rounding de coordenadas para mejorar hit-rate
- Nominatim 429 y 5xx (Retry-After) + email opcional
- Force-flush intervals (cache + hot_map) para no aplazar indefinidamente con tráfico continuo
- Flush on Home Assistant stop (con try/except)
- (Extras) Métricas rápidas ?metrics=1, robustez en tareas periódicas y Accept-Language fijo del servidor
- Backpressure: límite de misses simultáneos + modo nowait

Mejoras conservadoras y robustez:
- Parser de float tolerante a coma decimal
- _build_accept_lang(): construcción segura de Accept-Language
- Guardas ante Content-Type no JSON, JSON inválido y payloads enormes
- Parámetro ?debug=1 con diagnósticos ligeros
- Métrica rl_age y backoff_remaining
- Rechazo explícito de NaN/Inf en lat/lon
- Header Accept: application/json
- Lock de datos para mutaciones atómicas (cache/index/hot_map/neg_cache/inflight)
- Negative-cache con expiración absoluta respetando Retry-After
- Cache vinculada al idioma del servidor (se guarda `lang` y el lookup filtra por idioma)
- Respuesta incluye query_lat/query_lon
- Backoff global cuando hay 429 y 5xx
- `?force=1` (omite caché) y `?zoom=` (10..18) para la consulta
- Helpers para ETA de cola, manejo de negative cache y rate-limit sin bloquear E/S

Simplificaciones/ajustes aplicados:
- Rejilla fija por DECIMALS para el índice + caja de prefiltrado basada en radio (evita falsos negativos).
- Fallback opcional de idioma (desactivable con ?lang_strict=1) y override por ?lang=.
- (Nuevo) Capacidad de sobreescribir parámetros vía opciones del config entry (RL, per-cell, backlog, email).
- (Nuevo) Mapeo de 5xx de upstream a 503 (temporarily_unavailable) más semántico + propagación de Retry-After.
- (Nuevo) Fallback inteligente: prioriza el idioma primario (p. ej. `es`) antes de aceptar cualquier idioma.
- (Nuevo) Header X-Cache con `hit`, `hit-fallback` o `miss`.

Añadidos en esta versión:
- (Nuevo) Reset de estado/cachés: `?reset=cache|hot|neg|backoff|metrics|all` (sólo admin).
- (Nuevo) Coalescing por posición: de-dup de concurrencia **por celda** (ignora idioma) para que si llega una
  dirección de Nominatim y hay peticiones esperando la misma posición, **todas reciban esa respuesta** sin
  lanzar nuevas peticiones.
- (Nuevo) AUTO-NOWAIT: si hay backlog y la ETA estimada supera un umbral (p. ej. 2s), respondemos 202 automáticamente
  con `retry_after`/`X-Queue-ETA`/`X-Pending-Misses` arrancando la tarea en background antes de devolver 202.
- (Nuevo) Backpressure duro: si la cola supera el máximo configurado, respondemos `503 busy` con `retry_after`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import re
import time

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from math import isfinite
from typing import Any, DefaultDict, Dict, List, Optional, Tuple, TypedDict

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import CoreState
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.const import (
    EVENT_HOMEASSISTANT_STOP,
    EVENT_HOMEASSISTANT_STARTED,
)

DOMAIN = __package__.split(".")[-2]

# --- Logger / timeouts ---
_LOGGER = logging.getLogger(__name__)
NOMINATIM_TIMEOUT = 15  # seg
NOMINATIM_MAX_BYTES = 2_000_000  # ~2MB
LOG_SAMPLE_RATE = 0.1  # 10% logs no críticos

# --- Headers expuestos (DRY) ---
EXPOSE_HDRS = "Retry-After, Content-Language, X-Queue-ETA, X-Pending-Misses, X-Cache, X-Cache-Dist-M"

# --- Config (defaults) ---
CACHE_KEY = "reverse_geocode_cache"
INDEX_KEY = "reverse_geocode_index"
CACHE_TTL = timedelta(days=6)
CACHE_RADIUS_M = 20.0
MAX_ENTRIES = 10_000
LOW_WATER = 8_000
DECIMALS = 4  # ~11 m
PER_CELL_MAX = 64

RL_LOCK_KEY = "reverse_geocode_rl_lock"
RL_LAST_TS_KEY = "reverse_geocode_rl_last"
RL_LAST_MONO_KEY = "reverse_geocode_rl_last_mono"
RL_MIN_INTERVAL = 1.0  # s

SAVE_DEBOUNCE_ON_CHANGE = 900.0  # s

STORE_VERSION = 1
STORE_KEY = "ha_tracker_reverse_cache"
STORE_HANDLE_KEY = "reverse_geocode_store"

CACHE_DIRTY_KEY = "reverse_geocode_cache_dirty"
CACHE_LAST_FLUSH_KEY = "reverse_geocode_cache_last_flush"
HOT_DIRTY_KEY = "reverse_geocode_hot_dirty"
HOT_LAST_FLUSH_KEY = "reverse_geocode_hot_last_flush"

CACHE_FORCE_FLUSH_INTERVAL = 21_600.0  # 6 h
HOT_FORCE_FLUSH_INTERVAL = 10_800.0    # 3 h

HOT_MAP_KEY = "hot_map"
HOT_STORE_KEY = "ha_tracker_reverse_hits"
HOT_HANDLE_KEY = "reverse_geocode_hot_store"
HOT_SAVE_INTERVAL = 7_200.0  # 2 h
HOT_TTL = CACHE_TTL

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_EMAIL: Optional[str] = "vgcouso@gmail.com"

COMPACT_ADDRESS = True

INFLIGHT_KEY = "reverse_geocode_inflight"

# Métricas simples
MET_HITS = "rg_hits"
MET_MISS = "rg_miss"
MET_HIT_DIST_SUM = "rg_hit_dist_sum"
MET_HIT_DIST_N = "rg_hit_dist_n"
MET_RL_WAIT_SUM = "rg_rl_wait_sum"
MET_RL_WAIT_N = "rg_rl_wait_n"
MET_BP_202 = "rg_bp_202"
MET_BP_429 = "rg_bp_429"

STARTED_LISTENER_KEY = "reverse_geocode_started_listener"
STOP_LISTENER_KEY = "reverse_geocode_stop_listener"

NEG_CACHE_KEY = "reverse_geocode_neg_cache"
NEG_CACHE_TTL = 120.0  # s

MAX_PENDING_MISSES = 250  # overridable

DATA_LOCK_KEY = "reverse_geocode_data_lock"
BACKOFF_UNTIL_KEY = "reverse_geocode_backoff_until"

MAINT_TASK_KEY = "reverse_geocode_maint_task"

# Overrides via options
CFG_RL_MIN_INTERVAL = "reverse_geocode_cfg_rl_interval"
CFG_PER_CELL_MAX = "reverse_geocode_cfg_per_cell_max"
CFG_MAX_PENDING_MISSES = "reverse_geocode_cfg_max_pending_misses"
CFG_NOM_EMAIL = "reverse_geocode_cfg_nom_email"

# --- Geometría / celdas ---
SCALE = 10 ** DECIMALS
CELL_DEG = 1.0 / SCALE
M_PER_DEG_LAT = 111_320.0
BOX_DEG_LAT = max(CELL_DEG, (CACHE_RADIUS_M / M_PER_DEG_LAT) * 1.05)

_LANG_RE = re.compile(r"^[A-Za-z0-9-]{1,35}$")

MAX_BACKOFF_S = 900  # 15 min

AUTO_NOWAIT_ETA_S = 2.0  # s


class CacheEntry(TypedDict, total=False):
    lat: float
    lon: float
    address: Dict[str, Any]
    ts: str
    lang: str
    lang_hdr: str
    lang_primary: str
    lang_simple: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _quantize(x: float) -> float:
    """Cuantiza con formato decimal estable para evitar FP edge-cases."""
    return float(f"{x:.{DECIMALS}f}")


def _parse_float_field(raw: str) -> float:
    if raw is None:
        raise ValueError("missing")
    raw = raw.strip()
    raw = (
        raw.replace(" ", "")
           .replace("\u00A0", "")
           .replace("\u202F", "")
           .replace("\u2009", "")
           .replace("\u2007", "")
           .replace("\u2060", "")
           .replace("'", "")
           .replace("\u2212", "-")
    )
    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        raw = raw.replace(",", ".")
    return float(raw)


def _canon_bcp47(tag: str) -> str:
    parts = [p for p in tag.split("-") if p]
    out = []
    for i, p in enumerate(parts):
        if i == 0:
            out.append(p.lower())
        elif len(p) == 4 and p.isalpha():
            out.append(p.title())
        elif len(p) == 2 and p.isalpha():
            out.append(p.upper())
        elif len(p) == 3 and p.isdigit():
            out.append(p.upper())
        else:
            out.append(p.lower())
    return "-".join(out)


def _build_accept_lang(lang: Optional[str]) -> tuple[str, str]:
    lang = _canon_bcp47((lang or "en").replace("_", "-").strip())
    parts = lang.split("-", 1)
    base = parts[0] or "en"
    region = parts[1] if len(parts) > 1 else None
    if region:
        return (f"{base}-{region},{base};q=0.9,en;q=0.8", f"{base}-{region},{base},en")
    if base.lower() == "en":
        return ("en", "en")
    return (f"{base},en;q=0.9", f"{base},en")


def _primary_of(lang_param: str) -> str:
    first = (lang_param or "en").split(",", 1)[0]
    return first.split("-", 1)[0].lower()


def _hot_key(lat: float, lon: float) -> str:
    return f"{lat:.{DECIMALS}f},{lon:.{DECIMALS}f}"


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    a = min(1.0, max(0.0, a))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _close_enough_box(lat1, lon1, lat2, lon2):
    box_lat = BOX_DEG_LAT
    coslat = max(0.2, math.cos(math.radians((lat1 + lat2) * 0.5)))
    box_lon = max(CELL_DEG, (CACHE_RADIUS_M / (M_PER_DEG_LAT * coslat)) * 1.05)
    return abs(lat1 - lat2) <= box_lat and abs(lon1 - lon2) <= box_lon


def _cell_of(lat: float, lon: float) -> Tuple[int, int]:
    latq = _quantize(lat)
    lonq = _quantize(lon)
    return (int(round(latq * SCALE)), int(round(lonq * SCALE)))


def _neighbors(ix: int, iy: int) -> List[Tuple[int, int]]:
    return [(ix + dx, iy + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def _compact_nominatim(data: Dict[str, Any]) -> Dict[str, Any]:
    if not COMPACT_ADDRESS:
        return data
    addr = data.get("address", {})
    keep_addr_keys = (
        "house_number", "road", "neighbourhood", "suburb", "hamlet", "quarter", "borough",
        "village", "town", "city", "city_district", "municipality",
        "county", "state_district", "state", "state_code",
        "postcode", "country", "country_code",
    )
    compact = {
        "display_name": data.get("display_name"),
        "place_id": data.get("place_id"),
        "osm_type": data.get("osm_type"),
        "osm_id": data.get("osm_id"),
        "class": data.get("class"),
        "type": data.get("type"),
        "address": {k: addr.get(k) for k in keep_addr_keys if k in addr},
    }
    compact["address"] = {k: v for k, v in compact["address"].items() if v is not None}
    return compact


def _effective_ts(entry: Dict[str, Any], hot_map: Dict[str, str]) -> datetime:
    try:
        base_ts = datetime.fromisoformat(entry.get("ts", "1970-01-01T00:00:00+00:00"))
    except Exception:
        base_ts = datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        k = _hot_key(float(entry["lat"]), float(entry["lon"]))
    except Exception:
        return base_ts
    hot = hot_map.get(k)
    if not hot:
        return base_ts
    try:
        hot_ts = datetime.fromisoformat(hot)
    except Exception:
        return base_ts
    return max(base_ts, hot_ts)


def _prune_cache(cache: List[Dict[str, Any]], hot_map: Dict[str, str]) -> bool:
    cutoff = _utcnow() - CACHE_TTL
    old_len = len(cache)
    keep = []
    for it in cache:
        if _effective_ts(it, hot_map) >= cutoff:
            keep.append(it)
    if len(keep) != old_len:
        cache[:] = keep
        return True
    return False


def _prune_hot_map(hot_map: Dict[str, str]) -> bool:
    if not hot_map:
        return False
    cutoff = _utcnow() - HOT_TTL
    old = len(hot_map)
    new_map: Dict[str, str] = {}
    for k, v in hot_map.items():
        try:
            ts = datetime.fromisoformat(v)
        except Exception:
            continue
        if ts >= cutoff:
            new_map[k] = v
    if len(new_map) != old:
        hot_map.clear()
        hot_map.update(new_map)
        return True
    return False


def _enforce_cap(
    cache: List[Dict[str, Any]],
    hot_map: Dict[str, str],
    low_water: int = LOW_WATER,
    high_water: int = MAX_ENTRIES,
) -> bool:
    n = len(cache)
    if n <= high_water:
        return False
    try:
        ordered = sorted(cache, key=lambda it: _effective_ts(it, hot_map))
    except Exception:
        ordered = list(cache)
    keep = ordered[-low_water:]
    if len(keep) != n:
        cache[:] = keep
        return True
    return False


def _rebuild_index(cache: List[Dict[str, Any]]) -> DefaultDict[Tuple[int, int], List[int]]:
    idx: DefaultDict[Tuple[int, int], List[int]] = defaultdict(list)
    for i, it in enumerate(cache):
        try:
            lat = float(it["lat"])
            lon = float(it["lon"])
        except Exception:
            continue
        idx[_cell_of(lat, lon)].append(i)
    return idx


# --- Negative cache, ETA, flags y errores ---
def _neg_retry_after(neg_cache: Dict[Tuple[int, int], datetime], cell_key: Tuple[int, int]) -> int:
    exp = neg_cache.get(cell_key)
    if isinstance(exp, datetime):
        return max(0, int((exp - _utcnow()).total_seconds()))
    return 0


def _neg_set_for(neg_cache: Dict[Tuple[int, int], datetime], cell_key: Tuple[int, int], seconds: int) -> None:
    neg_cache[cell_key] = _utcnow() + timedelta(seconds=max(1, int(seconds)))


def _queue_eta(inflight: Dict[Any, asyncio.Task], last_mono: float, interval: float) -> Tuple[float, int]:
    backlog_n = sum(1 for t in inflight.values() if not t.done())
    elapsed = max(0.0, time.monotonic() - float(last_mono or 0.0))
    eta = max(0.0, backlog_n * interval - elapsed)  # segundos (float)
    return eta, backlog_n


def _parse_zoom(qs) -> Optional[int]:
    z = qs.get("zoom")
    try:
        zi = int(z) if z is not None else None
    except ValueError:
        return None
    return zi if zi is not None and 10 <= zi <= 18 else None


def _is_force(qs, user) -> bool:
    return qs.get("force") == "1" and (user and user.is_admin)


def _json_error(
    view: HomeAssistantView,
    status: int,
    msg: str,
    retry_after: Optional[int] = None,
    **extra: Any,
):
    payload: Dict[str, Any] = {"error": msg}
    if retry_after is not None:
        payload["retry_after"] = int(retry_after)
    if extra:
        payload.update(extra)
    resp = view.json(payload, status_code=status)
    resp.headers["Access-Control-Expose-Headers"] = EXPOSE_HDRS
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Vary"] = "Accept-Language"
    lang = extra.get("lang")
    if isinstance(lang, str):
        resp.headers["Content-Language"] = lang.split(",", 1)[0]
    if retry_after is not None:
        resp.headers["Retry-After"] = str(int(retry_after))
    if "eta" in extra:
        try:
            resp.headers["X-Queue-ETA"] = str(int(extra["eta"]))
        except Exception:
            pass
    if "pending" in extra:
        try:
            resp.headers["X-Pending-Misses"] = str(int(extra["pending"]))
        except Exception:
            pass
    resp.headers["X-Cache"] = "miss"
    return resp


def _json_ok(view: HomeAssistantView, payload: Dict[str, Any], status_code: int = 200):
    resp = view.json(payload, status_code=status_code)
    resp.headers["Access-Control-Expose-Headers"] = EXPOSE_HDRS
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Vary"] = "Accept-Language"
    lang = payload.get("lang")
    if isinstance(lang, str):
        resp.headers["Content-Language"] = lang.split(",", 1)[0]
    src = payload.get("source")
    if isinstance(src, str):
        if src == "cache_lang_fallback":
            resp.headers["X-Cache"] = "hit-fallback"
        elif src.startswith("cache"):
            resp.headers["X-Cache"] = "hit"
        else:
            resp.headers["X-Cache"] = "miss"
    else:
        resp.headers["X-Cache"] = "miss"
    if payload.get("hit_distance_m") is not None:
        resp.headers["X-Cache-Dist-M"] = str(payload["hit_distance_m"])
    return resp


def _err(status: int, code: str, retry_after: Optional[int] = None) -> Dict[str, Any]:
    d = {"error": code, "status": status}
    if retry_after is not None:
        d["retry_after"] = int(retry_after)
    return d


def _create_task(hass, coro, name: str):
    try:
        return hass.async_create_task(coro, name=name)  # type: ignore[call-arg]
    except TypeError:
        return hass.async_create_task(coro)


async def _rate_limit_wait(dd: Dict[str, Any]) -> None:
    lock: asyncio.Lock = dd[RL_LOCK_KEY]
    async with lock:
        now = time.monotonic()
        last = dd.get(RL_LAST_MONO_KEY, 0.0)
        interval = float(dd.get(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL))
        wait = max(0.0, interval - (now - last))
        dd[RL_LAST_MONO_KEY] = now + wait
    if wait > 0:
        await asyncio.sleep(wait + random.uniform(0, 0.3))
    dd[MET_RL_WAIT_SUM] = dd.get(MET_RL_WAIT_SUM, 0.0) + float(wait)
    dd[MET_RL_WAIT_N] = dd.get(MET_RL_WAIT_N, 0) + 1


def _get_only_admin(hass, dd: Dict[str, Any]) -> bool:
    if "only_admin" in dd:
        return bool(dd["only_admin"])
    try:
        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:
            entry = entries[0]
            dd["only_admin"] = entry.options.get("only_admin", entry.data.get("only_admin", False))
            return bool(dd["only_admin"])
    except Exception:
        pass
    dd["only_admin"] = False
    return False


def _load_cfg_overrides(hass, dd: Dict[str, Any]) -> None:
    try:
        entries = hass.config_entries.async_entries(DOMAIN)
        if not entries:
            dd.setdefault(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)
            dd.setdefault(CFG_PER_CELL_MAX, PER_CELL_MAX)
            dd.setdefault(CFG_MAX_PENDING_MISSES, MAX_PENDING_MISSES)
            dd.setdefault(CFG_NOM_EMAIL, NOMINATIM_EMAIL)
            return
        entry = entries[0]
        opts = getattr(entry, "options", {}) or {}
        data = getattr(entry, "data", {}) or {}
        try:
            dd[CFG_RL_MIN_INTERVAL] = max(0.1, float(opts.get("rg_rl_min_interval", RL_MIN_INTERVAL)))
        except Exception:
            dd[CFG_RL_MIN_INTERVAL] = RL_MIN_INTERVAL
        try:
            dd[CFG_PER_CELL_MAX] = max(1, int(opts.get("rg_per_cell_max", PER_CELL_MAX)))
        except Exception:
            dd[CFG_PER_CELL_MAX] = PER_CELL_MAX
        try:
            dd[CFG_MAX_PENDING_MISSES] = max(1, int(opts.get("rg_max_pending_misses", MAX_PENDING_MISSES)))
        except Exception:
            dd[CFG_MAX_PENDING_MISSES] = MAX_PENDING_MISSES
        nom_email = opts.get("rg_nominatim_email") or data.get("nominatim_email") or NOMINATIM_EMAIL
        if nom_email and "@" not in nom_email:
            nom_email = None
        dd[CFG_NOM_EMAIL] = nom_email
    except Exception:
        dd.setdefault(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)
        dd.setdefault(CFG_PER_CELL_MAX, PER_CELL_MAX)
        dd.setdefault(CFG_MAX_PENDING_MISSES, MAX_PENDING_MISSES)
        dd.setdefault(CFG_NOM_EMAIL, NOMINATIM_EMAIL)


async def _ensure_structs(hass) -> None:
    dd = hass.data.setdefault(DOMAIN, {})

    if RL_LOCK_KEY not in dd:
        dd[RL_LOCK_KEY] = asyncio.Lock()
    dd.setdefault(RL_LAST_TS_KEY, datetime.fromtimestamp(0, tz=timezone.utc))
    dd.setdefault(RL_LAST_MONO_KEY, 0.0)

    if DATA_LOCK_KEY not in dd:
        dd[DATA_LOCK_KEY] = asyncio.Lock()

    if STORE_HANDLE_KEY not in dd:
        dd[STORE_HANDLE_KEY] = Store(hass, STORE_VERSION, STORE_KEY)
    if HOT_HANDLE_KEY not in dd:
        dd[HOT_HANDLE_KEY] = Store(hass, STORE_VERSION, HOT_STORE_KEY)

    store: Store = dd[STORE_HANDLE_KEY]
    hot_store: Store = dd[HOT_HANDLE_KEY]

    if CACHE_KEY not in dd:
        saved: List[CacheEntry] | None = await store.async_load()
        cache: List[CacheEntry] = saved or []

        migrated = False
        for it in cache:
            try:
                if "lang_primary" not in it:
                    it["lang_primary"] = _primary_of(it.get("lang", "en"))
                    migrated = True
                if "lang_simple" not in it:
                    it["lang_simple"] = ((it.get("lang") or "").split(",", 1)[0] or "en").lower()
                    migrated = True
            except Exception:
                it["lang_primary"] = it.get("lang_primary") or "en"
                it["lang_simple"] = (it.get("lang_simple") or "en").lower()
                migrated = True

        dd[CACHE_KEY] = cache
        dd[INDEX_KEY] = _rebuild_index(cache)  # type: ignore[arg-type]
        dd.setdefault(INFLIGHT_KEY, {})
        dd.setdefault(MET_HITS, 0)
        dd.setdefault(MET_MISS, 0)
        dd.setdefault(MET_HIT_DIST_SUM, 0.0)
        dd.setdefault(MET_HIT_DIST_N, 0)
        dd.setdefault(MET_RL_WAIT_SUM, 0.0)
        dd.setdefault(MET_RL_WAIT_N, 0)
        dd.setdefault(MET_BP_202, 0)
        dd.setdefault(MET_BP_429, 0)
        dd.setdefault(CACHE_DIRTY_KEY, migrated)
        dd.setdefault(CACHE_LAST_FLUSH_KEY, _utcnow())
        if migrated:
            store.async_delay_save(lambda: cache, SAVE_DEBOUNCE_ON_CHANGE)

    if HOT_MAP_KEY not in dd:
        hot_saved: Dict[str, str] | None = await hot_store.async_load()
        dd[HOT_MAP_KEY] = hot_saved or {}
        dd.setdefault(HOT_DIRTY_KEY, False)
        dd.setdefault(HOT_LAST_FLUSH_KEY, _utcnow())
        if _prune_hot_map(dd[HOT_MAP_KEY]):
            dd[HOT_DIRTY_KEY] = True
            hot_store.async_delay_save(lambda: dd[HOT_MAP_KEY], HOT_SAVE_INTERVAL)

    dd.setdefault(NEG_CACHE_KEY, {})
    dd.setdefault(BACKOFF_UNTIL_KEY, datetime.fromtimestamp(0, tz=timezone.utc))
    _get_only_admin(hass, dd)
    _load_cfg_overrides(hass, dd)

    try:
        cache: List[CacheEntry] = dd[CACHE_KEY]
        index: DefaultDict[Tuple[int, int], List[int]] = dd[INDEX_KEY]
        hot_map: Dict[str, str] = dd[HOT_MAP_KEY]
        per_cell_max = int(dd.get(CFG_PER_CELL_MAX, PER_CELL_MAX))
        for k, lst in list(index.items()):
            if len(lst) > per_cell_max:
                lst.sort(key=lambda i: _effective_ts(cache[i], hot_map))
                index[k] = lst[-per_cell_max:]
    except Exception:
        pass

    async def _start_periodic_maintenance(_event=None):
        if MAINT_TASK_KEY in dd:
            return

        async def _periodic_maint():
            try:
                while True:
                    await asyncio.sleep(60)
                    now = _utcnow()
                    if dd.get(CACHE_DIRTY_KEY) and (now - dd.get(CACHE_LAST_FLUSH_KEY, now)).total_seconds() >= CACHE_FORCE_FLUSH_INTERVAL:
                        try:
                            await store.async_save(dd[CACHE_KEY])
                        except Exception:
                            pass
                        else:
                            dd[CACHE_LAST_FLUSH_KEY] = _utcnow()
                            dd[CACHE_DIRTY_KEY] = False
                    if dd.get(HOT_DIRTY_KEY) and (now - dd.get(HOT_LAST_FLUSH_KEY, now)).total_seconds() >= HOT_FORCE_FLUSH_INTERVAL:
                        try:
                            await hot_store.async_save(dd[HOT_MAP_KEY])
                        except Exception:
                            pass
                        else:
                            dd[HOT_LAST_FLUSH_KEY] = _utcnow()
                            dd[HOT_DIRTY_KEY] = False
                    try:
                        neg: Dict[Tuple[int, int], datetime] = dd.get(NEG_CACHE_KEY, {})
                        for k, exp in list(neg.items()):
                            if isinstance(exp, datetime) and exp <= now:
                                neg.pop(k, None)
                    except Exception:
                        pass
            except asyncio.CancelledError:
                return

        dd[MAINT_TASK_KEY] = _create_task(hass, _periodic_maint(), "rg_periodic_maint")

    if hass.state == CoreState.running:
        await _start_periodic_maintenance()
    else:
        if not dd.get(STARTED_LISTENER_KEY):
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _start_periodic_maintenance)
            dd[STARTED_LISTENER_KEY] = True

    async def _on_stop(event):
        task = dd.get(MAINT_TASK_KEY)
        if task:
            task.cancel()
        try:
            await store.async_save(dd[CACHE_KEY])
        except Exception:
            pass
        try:
            await hot_store.async_save(dd[HOT_MAP_KEY])
        except Exception:
            pass

    if not dd.get(STOP_LISTENER_KEY):
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _on_stop)
        dd[STOP_LISTENER_KEY] = True


def _find_cached_with_index(
    cache: List[CacheEntry],
    index: DefaultDict[Tuple[int, int], List[int]],
    lat: float,
    lon: float,
    lang_simple: Optional[str] = None,
) -> Optional[CacheEntry]:
    ix, iy = _cell_of(lat, lon)
    best = None
    best_d = float("inf")
    for cx, cy in _neighbors(ix, iy):
        for idx in list(index.get((cx, cy), ())):
            try:
                it = cache[idx]
                it_lat = float(it["lat"])
                it_lon = float(it["lon"])
            except Exception:
                continue
            if lang_simple:
                it_lang_simple = (it.get("lang_simple") or (it.get("lang") or "").split(",", 1)[0]).lower()
                if it_lang_simple != lang_simple:
                    continue
            if not _close_enough_box(lat, lon, it_lat, it_lon):
                continue
            d = _haversine_m(lat, lon, it_lat, it_lon)
            if d == 0.0:
                return it
            if d < CACHE_RADIUS_M and d < best_d:
                best = it
                best_d = d
    return best


def _find_cached_with_index_primary(
    cache: List[CacheEntry],
    index: DefaultDict[Tuple[int, int], List[int]],
    lat: float,
    lon: float,
    lang_primary: Optional[str] = None,
) -> Optional[CacheEntry]:
    if not lang_primary:
        return None
    ix, iy = _cell_of(lat, lon)
    best = None
    best_d = float("inf")
    for cx, cy in _neighbors(ix, iy):
        for idx in list(index.get((cx, cy), ())):
            try:
                it = cache[idx]
                it_lat = float(it["lat"]); it_lon = float(it["lon"])  # noqa: E702
            except Exception:
                continue
            if it.get("lang_primary") != lang_primary:
                continue
            if not _close_enough_box(lat, lon, it_lat, it_lon):
                continue
            d = _haversine_m(lat, lon, it_lat, it_lon)
            if d == 0.0:
                return it
            if d < CACHE_RADIUS_M and d < best_d:
                best, best_d = it, d
    return best


class ReverseGeocodeEndpoint(HomeAssistantView):
    url = "/api/ha_tracker/reverse_geocode"
    name = "api:ha_tracker/reverse_geocode"
    requires_auth = True

    async def get(self, request):
        """
        Query params:
          - lat (float)
          - lon (float)
          - nowait=1 (opcional) -> no encola misses; responde 202 con retry_after (arranca tarea)
          - debug=1 (opcional)
          - force=1 (solo admin)
          - zoom=10..18 (opcional)
          - lang_strict=1 (opcional)
          - lang=xx-YY (opcional)
          - metrics=1 (solo admin)
          - reset=cache|hot|neg|backoff|metrics|all (solo admin)
        """
        hass = request.app["hass"]
        await _ensure_structs(hass)

        dd = hass.data[DOMAIN]
        _load_cfg_overrides(hass, dd)

        qs = request.rel_url.query or {}
        debug = (qs.get("debug") == "1")

        server_lang = getattr(hass.config, "language", None) or "en"
        raw_lang = (qs.get("lang") or "").strip()
        norm_lang = raw_lang.replace("_", "-")
        client_lang = norm_lang if (norm_lang and _LANG_RE.match(norm_lang)) else None

        accept_lang, accept_lang_param = _build_accept_lang(client_lang or server_lang)
        _param_token = accept_lang_param.split(",", 1)[0]
        param_lang_simple = _canon_bcp47(_param_token)
        param_lang_simple_lc = _param_token.lower()
        lang_strict = (qs.get("lang_strict") == "1")

        only_admin = _get_only_admin(hass, dd)
        try:
            user = request["hass_user"]
        except KeyError:
            user = None
        if only_admin and (user is None or not user.is_admin):
            return _json_error(self, 403, "forbidden", lang=accept_lang_param)

        # RESET
        if "reset" in qs:
            if user is None or not user.is_admin:
                return _json_error(self, 403, "forbidden", lang=accept_lang_param)

            what = (qs.get("reset") or "").strip().lower()
            valid = {"cache", "hot", "neg", "backoff", "metrics", "all"}
            if what not in valid:
                return _json_error(self, 400, "invalid_reset", lang=accept_lang_param)

            store: Store = dd[STORE_HANDLE_KEY]
            hot_store: Store = dd[HOT_HANDLE_KEY]
            save_cache = save_hot = False

            async with dd[DATA_LOCK_KEY]:
                out: Dict[str, Any] = {"action": what}

                if what in ("cache", "all"):
                    out["cache_len_before"] = len(dd[CACHE_KEY])
                    dd[CACHE_KEY].clear()
                    dd[INDEX_KEY].clear()
                    dd[CACHE_DIRTY_KEY] = True
                    save_cache = True

                if what in ("hot", "all"):
                    out["hot_len_before"] = len(dd[HOT_MAP_KEY])
                    dd[HOT_MAP_KEY].clear()
                    dd[HOT_DIRTY_KEY] = True
                    save_hot = True

                if what in ("neg", "all"):
                    out["neg_len_before"] = len(dd[NEG_CACHE_KEY])
                    dd[NEG_CACHE_KEY].clear()

                if what in ("backoff", "all"):
                    dd[BACKOFF_UNTIL_KEY] = datetime.fromtimestamp(0, tz=timezone.utc)
                    out["backoff_cleared"] = True

                if what in ("metrics", "all"):
                    dd[MET_HITS] = 0
                    dd[MET_MISS] = 0
                    dd[MET_HIT_DIST_SUM] = 0.0
                    dd[MET_HIT_DIST_N] = 0
                    dd[MET_RL_WAIT_SUM] = 0.0
                    dd[MET_RL_WAIT_N] = 0
                    dd[MET_BP_202] = 0
                    dd[MET_BP_429] = 0

                out["lang"] = accept_lang_param

            if save_cache:
                store.async_delay_save(lambda: dd[CACHE_KEY], 0)
            if save_hot:
                hot_store.async_delay_save(lambda: dd[HOT_MAP_KEY], 0)

            return _json_ok(self, out)

        # Métricas
        if qs.get("metrics") == "1":
            if user is None or not user.is_admin:
                return _json_error(self, 403, "forbidden", lang=accept_lang_param)
            rl_age = (_utcnow() - dd.get(RL_LAST_TS_KEY, _utcnow())).total_seconds()
            bo = dd.get(BACKOFF_UNTIL_KEY, _utcnow())
            backoff_remaining = max(0, int((bo - _utcnow()).total_seconds()))
            hits, miss = dd.get(MET_HITS, 0), dd.get(MET_MISS, 0)
            hit_rate = hits / max(1, hits + miss)
            eta, backlog_n = _queue_eta(
                dd.get(INFLIGHT_KEY, {}),
                dd.get(RL_LAST_MONO_KEY, 0.0),
                float(dd.get(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)),
            )
            avg_hit_dist = None
            if dd.get(MET_HIT_DIST_N, 0) > 0:
                avg_hit_dist = dd[MET_HIT_DIST_SUM] / dd[MET_HIT_DIST_N]
            avg_rl_wait = None
            if dd.get(MET_RL_WAIT_N, 0) > 0:
                avg_rl_wait = dd[MET_RL_WAIT_SUM] / dd[MET_RL_WAIT_N]
            payload = {
                "hits": hits,
                "miss": miss,
                "hit_rate": round(hit_rate, 4),
                "cache_len": len(dd.get(CACHE_KEY, [])),
                "index_cells": len(dd.get(INDEX_KEY, {})),
                "hot_len": len(dd.get(HOT_MAP_KEY, {})),
                "store_dirty": bool(dd.get(CACHE_DIRTY_KEY, False)),
                "hot_dirty": bool(dd.get(HOT_DIRTY_KEY, False)),
                "neg_cells": len(dd.get(NEG_CACHE_KEY, {})),
                "pending_misses": backlog_n,
                "backlog_eta": int(eta),
                "rl_age": rl_age,
                "backoff_remaining": backoff_remaining,
                "avg_hit_distance_m": round(avg_hit_dist, 3) if avg_hit_dist is not None else None,
                "avg_rate_limit_wait_s": round(avg_rl_wait, 3) if avg_rl_wait is not None else None,
                "bp_202": dd.get(MET_BP_202, 0),
                "bp_429": dd.get(MET_BP_429, 0),
                "cfg_rl_min_interval": float(dd.get(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)),
                "cfg_per_cell_max": int(dd.get(CFG_PER_CELL_MAX, PER_CELL_MAX)),
                "cfg_max_pending_misses": int(dd.get(CFG_MAX_PENDING_MISSES, MAX_PENDING_MISSES)),
                "cfg_nom_email": dd.get(CFG_NOM_EMAIL, NOMINATIM_EMAIL),
                "lang": accept_lang_param,
            }
            return _json_ok(self, payload)

        # Parse lat/lon
        lat_raw = qs.get("lat", "")
        lon_raw = qs.get("lon", "")
        try:
            lat_q = _parse_float_field(lat_raw)
            lon_q = _parse_float_field(lon_raw)
        except ValueError:
            return _json_error(self, 400, "lat/lon must be float", lang=accept_lang_param)

        if not (isfinite(lat_q) and isfinite(lon_q)):
            return _json_error(self, 400, "lat/lon not finite", lang=accept_lang_param)
        if not (-90.0 <= lat_q <= 90.0) or not (-180.0 <= lon_q <= 180.0):
            return _json_error(self, 400, "lat/lon out of range", lang=accept_lang_param)

        lat = _quantize(lat_q)
        lon = _quantize(lon_q)

        cache: List[CacheEntry] = dd[CACHE_KEY]
        index: DefaultDict[Tuple[int, int], List[int]] = dd[INDEX_KEY]
        store: Store = dd[STORE_HANDLE_KEY]
        hot_store: Store = dd[HOT_HANDLE_KEY]
        hot_map: Dict[str, str] = dd[HOT_MAP_KEY]
        data_lock: asyncio.Lock = dd[DATA_LOCK_KEY]



        force = _is_force(qs, user)
        zoom_override = _parse_zoom(qs)

        # 1) cache hit
        fallback_used = False
        async with data_lock:
            hit = None if force else _find_cached_with_index(
                cache, index, lat, lon, param_lang_simple_lc
            )
            if not hit and not force and not lang_strict:
                prim = _primary_of(accept_lang_param)
                hit = _find_cached_with_index_primary(cache, index, lat, lon, prim)
                if not hit:
                    hit = _find_cached_with_index(cache, index, lat, lon, lang_simple=None)
                fallback_used = bool(hit)

        if hit:
            dd[MET_HITS] = dd.get(MET_HITS, 0) + 1
            hd: Optional[float] = None
            try:
                hd = _haversine_m(lat, lon, float(hit["lat"]), float(hit["lon"]))
                dd[MET_HIT_DIST_SUM] = dd.get(MET_HIT_DIST_SUM, 0.0) + float(hd)
                dd[MET_HIT_DIST_N] = dd.get(MET_HIT_DIST_N, 0) + 1
            except Exception:
                pass

            now_iso = _utcnow().isoformat()
            try:
                entry_key = _hot_key(float(hit["lat"]), float(hit["lon"]))
            except Exception:
                entry_key = _hot_key(lat, lon)

            async with data_lock:
                hot_map[entry_key] = now_iso
                dd[HOT_DIRTY_KEY] = True
                hot_store.async_delay_save(lambda: hot_map, HOT_SAVE_INTERVAL)

            payload = {
                "lat": lat,
                "lon": lon,
                "query_lat": lat_q,
                "query_lon": lon_q,
                "address": hit.get("address"),
                "source": "cache_lang_fallback" if fallback_used else "cache",
                "cached_at": hit.get("ts"),
                "lang": hit.get("lang", accept_lang_param),
                "source_lang": hit.get("lang", accept_lang_param),
                "hit_distance_m": round(hd, 3) if hd is not None else None,
            }
            if fallback_used and hit.get("lang"):
                payload["lang_cached"] = hit["lang"]
            return _json_ok(self, payload)

        # 1.5) MISS → aplicar backoff/negative-cache DESPUÉS de intentar caché
        neg_cache: Dict[Tuple[int, int], datetime] = dd[NEG_CACHE_KEY]
        cell_key = _cell_of(lat, lon)

        # Backoff global activo
        backoff_until = dd.get(BACKOFF_UNTIL_KEY)
        if isinstance(backoff_until, datetime) and _utcnow() < backoff_until:
            retry_after = max(1, int((backoff_until - _utcnow()).total_seconds()))
            return _json_error(self, 503, "temporarily_unavailable", retry_after, lang=accept_lang_param)

        # Negative cache por celda
        retry = _neg_retry_after(neg_cache, cell_key)
        if retry > 0:
            return _json_error(self, 503, "temporarily_unavailable", retry, lang=accept_lang_param)


        # 2) MISS → mantenimiento básico
        nowait = qs.get("nowait") == "1"
        inflight: Dict[Any, asyncio.Task] = dd.setdefault(INFLIGHT_KEY, {})
        inflight_key = cell_key

        dd[MET_MISS] = dd.get(MET_MISS, 0) + 1
        async with data_lock:
            cache_changed = _prune_cache(cache, hot_map) or _enforce_cap(cache, hot_map)
            hot_changed = _prune_hot_map(hot_map)
            if cache_changed:
                dd[INDEX_KEY] = index = _rebuild_index(cache)  # type: ignore[arg-type]
                per_cell_max = int(dd.get(CFG_PER_CELL_MAX, PER_CELL_MAX))
                for k, lst in list(index.items()):
                    if len(lst) > per_cell_max:
                        lst.sort(key=lambda i: _effective_ts(cache[i], hot_map))
                        index[k] = lst[-per_cell_max:]
                dd[CACHE_DIRTY_KEY] = True
                store.async_delay_save(lambda: cache, SAVE_DEBOUNCE_ON_CHANGE)
            if hot_changed:
                dd[HOT_DIRTY_KEY] = True
                hot_store.async_delay_save(lambda: hot_map, HOT_SAVE_INTERVAL)

        # 3) fetch/cache (definida aquí para cerrar sobre variables)
        async def _do_fetch_and_cache() -> Dict[str, Any]:
            await _rate_limit_wait(dd)
            dd[RL_LAST_TS_KEY] = _utcnow()

            session = async_get_clientsession(hass)
            params = {
                "format": "json",
                "lat": f"{lat_q:.8f}",
                "lon": f"{lon_q:.8f}",
                "zoom": str(zoom_override or 18),
                "addressdetails": "1",
                "accept-language": param_lang_simple,
            }
            nom_email = dd.get(CFG_NOM_EMAIL, NOMINATIM_EMAIL)
            if nom_email and "@" not in nom_email:
                nom_email = None
            if nom_email:
                params["email"] = nom_email
            headers = {
                "User-Agent": f"HA-Tracker/1.0 ({nom_email or 'no-contact'})",
                "Accept-Language": accept_lang,
                "Accept": "application/json",
            }
            try:
                external_url = getattr(getattr(hass, "config", None), "external_url", None)
                if external_url:
                    headers["Referer"] = external_url
            except Exception:
                pass

            raw: Any = None
            try:
                async with session.get(NOMINATIM_URL, params=params, headers=headers, timeout=NOMINATIM_TIMEOUT) as resp:
                    ctype = resp.headers.get("Content-Type", "")
                    charset = resp.charset or "utf-8"

                    if resp.status == 429:
                        ra_hdr = resp.headers.get("Retry-After")
                        ttl_secs = int(NEG_CACHE_TTL)
                        if ra_hdr:
                            try:
                                ttl_secs = int(ra_hdr)
                            except ValueError:
                                try:
                                    ra_dt = parsedate_to_datetime(ra_hdr)
                                    ttl_secs = max(1, int((ra_dt - _utcnow()).total_seconds()))
                                except Exception:
                                    ttl_secs = int(NEG_CACHE_TTL)
                        backoff_secs = min(int(max(ttl_secs, int(NEG_CACHE_TTL)) * random.uniform(0.9, 1.1)), MAX_BACKOFF_S)
                        async with data_lock:
                            _neg_set_for(neg_cache, cell_key, backoff_secs)
                            dd[BACKOFF_UNTIL_KEY] = _utcnow() + timedelta(seconds=backoff_secs)
                        return _err(429, "rate_limited", backoff_secs)

                    if resp.status != 200:
                        ra_hdr = resp.headers.get("Retry-After")
                        retry_after = None
                        if ra_hdr:
                            try:
                                retry_after = int(ra_hdr)
                            except ValueError:
                                try:
                                    ra_dt = parsedate_to_datetime(ra_hdr)
                                    retry_after = max(1, int((ra_dt - _utcnow()).total_seconds()))
                                except Exception:
                                    retry_after = None

                        if 500 <= resp.status <= 599:
                            async with data_lock:
                                _neg_set_for(neg_cache, cell_key, int(retry_after or NEG_CACHE_TTL))
                                secs = int(retry_after or NEG_CACHE_TTL)
                                dd[BACKOFF_UNTIL_KEY] = _utcnow() + timedelta(seconds=min(secs, MAX_BACKOFF_S))
                            return _err(503, "upstream_unavailable", retry_after)
                        else:
                            async with data_lock:
                                _neg_set_for(neg_cache, cell_key, int(retry_after or NEG_CACHE_TTL))
                            return _err(502, f"upstream_http_{resp.status}", retry_after)

                    if resp.content_length and resp.content_length > NOMINATIM_MAX_BYTES:
                        _LOGGER.warning("Nominatim payload too large: %s bytes", resp.content_length)
                        async with data_lock:
                            _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                        return _err(502, "payload_too_large")

                    if "application/json" not in ctype:
                        raw_preview = await resp.content.read(300)
                        text_preview = raw_preview.decode(charset, errors="ignore").strip()
                        if random.random() < LOG_SAMPLE_RATE:
                            _LOGGER.warning("Nominatim non-JSON 200: Content-Type=%s preview=%r", ctype, text_preview)
                        async with data_lock:
                            _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                        return _err(502, "invalid_content_type")

                    raw_bytes = await resp.content.read(NOMINATIM_MAX_BYTES + 1)
                    if len(raw_bytes) > NOMINATIM_MAX_BYTES:
                        _LOGGER.warning("Nominatim payload exceeded max bytes: > %s", NOMINATIM_MAX_BYTES)
                        async with data_lock:
                            _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                        return _err(502, "payload_too_large")

                    try:
                        raw = json.loads(raw_bytes.decode(charset, errors="strict"))
                    except Exception as e:
                        if random.random() < LOG_SAMPLE_RATE:
                            _LOGGER.warning("Nominatim invalid JSON: %s", e)
                        async with data_lock:
                            _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                        return _err(502, "invalid_json_from_nominatim")

            except asyncio.TimeoutError:
                async with data_lock:
                    _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                return _err(504, "nominatim_timeout")
            except Exception:
                async with data_lock:
                    _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                return _err(502, "nominatim_error")

            if not isinstance(raw, dict):
                async with data_lock:
                    _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                return _err(502, "invalid_json_from_nominatim")

            if "error" in raw:
                try:
                    _LOGGER.warning("Nominatim returned error: %r", raw.get("error"))
                except Exception:
                    pass
                async with data_lock:
                    _neg_set_for(neg_cache, cell_key, int(NEG_CACHE_TTL))
                return _err(502, "nominatim_error")

            data = _compact_nominatim(raw)

            addr = data.get("address") if isinstance(data, dict) else None
            if not addr:
                short_ttl = 30
                async with data_lock:
                    _neg_set_for(neg_cache, cell_key, short_ttl)
                return {
                    "lat": lat, "lon": lon,
                    "query_lat": lat_q, "query_lon": lon_q,
                    "address": data, "source": "nominatim",
                    "cached": False, "cacheable": False,
                    "lang": accept_lang_param,
                }

            ts = _utcnow().isoformat()
            entry: CacheEntry = {
                "lat": lat, "lon": lon, "address": data, "ts": ts,
                "lang": accept_lang_param, "lang_hdr": accept_lang,
                "lang_primary": _primary_of(accept_lang_param),
                "lang_simple": param_lang_simple_lc,
            }

            async with data_lock:
                cache.append(entry)
                index.setdefault(cell_key, []).append(len(cache) - 1)
                per_cell_max = int(dd.get(CFG_PER_CELL_MAX, PER_CELL_MAX))
                cell_list = index[cell_key]
                if len(cell_list) > per_cell_max:
                    cell_list.sort(key=lambda i: _effective_ts(cache[i], hot_map))
                    del cell_list[0: len(cell_list) - per_cell_max]
                if _enforce_cap(cache, hot_map):
                    dd[INDEX_KEY] = _rebuild_index(cache)  # type: ignore[arg-type]
                    per_cell_max = int(dd.get(CFG_PER_CELL_MAX, PER_CELL_MAX))
                    for k, lst in list(dd[INDEX_KEY].items()):
                        if len(lst) > per_cell_max:
                            lst.sort(key=lambda i: _effective_ts(cache[i], hot_map))
                            dd[INDEX_KEY][k] = lst[-per_cell_max:]
                dd[CACHE_DIRTY_KEY] = True
                store.async_delay_save(lambda: cache, SAVE_DEBOUNCE_ON_CHANGE)
                neg_cache.pop(cell_key, None)
                dd[BACKOFF_UNTIL_KEY] = datetime.fromtimestamp(0, tz=timezone.utc)

            return {
                "lat": lat, "lon": lon,
                "query_lat": lat_q, "query_lon": lon_q,
                "address": data, "source": "nominatim",
                "cached_at": ts, "lang": accept_lang_param,
                "source_lang": accept_lang_param,
            }

        # 4) Decisiones AUTO-NOWAIT / NOWAIT + backpressure duro
        eta, backlog_n = _queue_eta(
            inflight,
            dd.get(RL_LAST_MONO_KEY, 0.0),
            float(dd.get(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)),
        )

        cfg_max = int(dd.get(CFG_MAX_PENDING_MISSES, MAX_PENDING_MISSES))
        if backlog_n >= cfg_max:
            return _json_error(self, 503, "busy", 1, eta=int(eta), pending=backlog_n, lang=accept_lang_param)

        # ¿Ya hay una tarea para esta celda?
        async with data_lock:
            existing = inflight.get(inflight_key)

        if existing:
            eta2, backlog_n2 = _queue_eta(
                inflight,
                dd.get(RL_LAST_MONO_KEY, 0.0),
                float(dd.get(CFG_RL_MIN_INTERVAL, RL_MIN_INTERVAL)),
            )
            if not nowait and eta2 >= AUTO_NOWAIT_ETA_S:
                dd[MET_BP_202] = dd.get(MET_BP_202, 0) + 1
                return _json_error(self, 202, "queued", max(1, int(eta2)), eta=int(eta2), pending=backlog_n2, lang=accept_lang_param)
            if nowait:
                dd[MET_BP_202] = dd.get(MET_BP_202, 0) + 1
                return _json_error(self, 202, "queued", max(1, int(eta2)), eta=int(eta2), pending=backlog_n2, lang=accept_lang_param)
            try:
                result = await existing
            except Exception:
                pass
            else:
                # Limpia la entrada inflight si sigue apuntando a esta task
                async with data_lock:
                    if inflight.get(inflight_key) is existing:
                        inflight.pop(inflight_key, None)
                if isinstance(result, dict) and "error" in result and "status" in result:
                    return _json_error(
                        self,
                        result.get("status", 502),
                        result["error"],
                        int(result.get("retry_after", 0)) if "retry_after" in result else None,
                        lang=accept_lang_param,
                    )
                return _json_ok(self, result)

        # No hay tarea aún → arrancar
        if nowait or eta >= AUTO_NOWAIT_ETA_S:
            async with data_lock:
                task_name = f"rg_fetch_{cell_key[0]}_{cell_key[1]}_any"
                task = _create_task(hass, _do_fetch_and_cache(), task_name)
                inflight[inflight_key] = task

                # cleanup automático
                def _cleanup(_t, k=inflight_key, tsk=task):
                    async def _rm():
                        async with data_lock:
                            if inflight.get(k) is tsk:
                                inflight.pop(k, None)
                    _create_task(hass, _rm(), "rg_inflight_cleanup")
                task.add_done_callback(_cleanup)

            dd[MET_BP_202] = dd.get(MET_BP_202, 0) + 1
            return _json_error(self, 202, "queued", max(1, int(eta)), eta=int(eta), pending=backlog_n, lang=accept_lang_param)

        # Camino síncrono: arrancar y esperar
        async with data_lock:
            task_name = f"rg_fetch_{cell_key[0]}_{cell_key[1]}_any"
            task = _create_task(hass, _do_fetch_and_cache(), task_name)
            inflight[inflight_key] = task

            # cleanup automático por si alguien no alcanza el finally
            def _cleanup(_t, k=inflight_key, tsk=task):
                async def _rm():
                    async with data_lock:
                        if inflight.get(k) is tsk:
                            inflight.pop(k, None)
                _create_task(hass, _rm(), "rg_inflight_cleanup")
            task.add_done_callback(_cleanup)

        try:
            result = await task
        finally:
            async with data_lock:
                if inflight.get(inflight_key) is task:
                    inflight.pop(inflight_key, None)

        if isinstance(result, dict) and "error" in result and "status" in result:
            return _json_error(
                self,
                result.get("status", 502),
                result["error"],
                int(result.get("retry_after", 0)) if "retry_after" in result else None,
                lang=accept_lang_param,
            )

        return _json_ok(self, result)


async def async_init_reverse_cache(hass) -> None:
    """Carga la caché persistida y prepara rate-limit/estructuras al iniciar la integración."""
    await _ensure_structs(hass)
