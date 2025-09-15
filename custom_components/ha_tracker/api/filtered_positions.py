import logging
import math
from typing import List, Tuple, Optional

from dateutil.parser import isoparse
from datetime import timedelta, datetime
from functools import partial

from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.util import dt as dt_util

from ..const import MAX_DAYS_FOR_FILTER
from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# ----------------------------
# UMBRALES DE FILTRO (ajustables)
# ----------------------------
MAX_GPS_ACCURACY_M = 20.0   # descartar puntos con precisión peor que esto (m)
MAX_SPEED_KMH = 250.0       # descartar puntos con salto a > 250 km/h (filtro base)
MIN_DISTANCE = 0.0          # distancia mínima entre puntos aceptados (m)

# ----------------------------
# PARADAS/JITTER por radio + “gap” al primer punto fuera
# (Estos valores sirven como *fallback*. En runtime se leen de la config:
#  stop_radius (m) y stop_time (s). Si stop_radius=0 no se agrupa; si stop_time=0 no se marcan paradas.)
# ----------------------------
STOP_RADIUS_M_FALLBACK = 20.0       # m (float)
STOP_OUTSIDE_GAP_S_FALLBACK = 300   # s (int)
REQUIRE_GOOD_ACC = True             # si True, exige precisión <= MAX_GPS_ACCURACY_M dentro del grupo

# fallbacks para el “anti-spike” por retorno corto
ANTI_SPIKE_RADIUS_FALLBACK = 20.0   # m (float)
ANTI_SPIKE_TIME_S_FALLBACK = 300    # s (int)

# ----------------------------
# Haversine
# ----------------------------
def haversine(lat1, lon1, lat2, lon2) -> float:
    """Calcula la distancia en metros entre dos puntos geográficos."""
    earth_radius_m = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2.0) ** 2
    )
    # clamp por estabilidad numérica
    a = min(1.0, max(0.0, a))
    return earth_radius_m * (2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a)))

# ----------------------------
# Helpers para posiciones ya serializadas (dict)
# ----------------------------
def _latlon_from_pos(pos) -> Optional[Tuple[float, float]]:
    try:
        a = pos.get("attributes", {})
        return float(a["latitude"]), float(a["longitude"])
    except Exception:
        return None

def _acc_from_pos(pos) -> Optional[float]:
    a = pos.get("attributes", {})
    acc = a.get("gps_accuracy", a.get("accuracy"))
    try:
        return float(acc) if acc is not None else None
    except Exception:
        return None

def _dt_from_pos(pos):
    v = pos.get("last_updated")
    if isinstance(v, datetime):
        return v
    if v is None:
        return None
    try:
        return isoparse(v if isinstance(v, str) else str(v))
    except Exception:
        return None

def _as_dt(v):
    if isinstance(v, datetime):
        return v
    if v is None:
        return None
    try:
        return isoparse(v if isinstance(v, str) else str(v))
    except Exception:
        return None

# ----------------------------
# Validaciones de query/persona/fechas
# ----------------------------
def validate_query_params(query):
    person_id = query.get("person_id")
    start_date = query.get("start_date")
    end_date = query.get("end_date")

    if not all([person_id, start_date, end_date]):
        return None, None, None, {"error": "Missing parameters", "status_code": 400}

    return person_id, start_date, end_date, None

def validate_person(hass, person_id):
    person_state = hass.states.get(person_id)
    if not person_state:
        return None, {"error": f"Person {person_id} not found", "status_code": 404}

    source_device_id = person_state.attributes.get("source")
    if (
        not source_device_id
        or not isinstance(source_device_id, str)
        or not source_device_id.strip()
    ):
        return None, {"error": f"Not valid device_tracker for person {person_id}", "status_code": 400}

    # Verifica que el device_tracker exista realmente
    dev_state = hass.states.get(source_device_id)
    if not dev_state:
        return None, {"error": f"Device tracker {source_device_id} not found", "status_code": 404}

    return source_device_id, None

def validate_dates(start_date, end_date):
    start_dt = dt_util.parse_datetime(start_date)
    end_dt = dt_util.parse_datetime(end_date)
    if start_dt is None or end_dt is None:
        return None, None, {"error": "Invalid date format", "status_code": 400}

    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)

    start_utc = dt_util.as_utc(start_dt)
    end_utc = dt_util.as_utc(end_dt)

    now = dt_util.utcnow()

    if start_utc >= end_utc:
        return None, None, {"error": "start_date must be before end_date", "status_code": 400}

    if end_utc > now:
        end_utc = now

    max_delta = timedelta(days=MAX_DAYS_FOR_FILTER)
    if (end_utc - start_utc) > max_delta:
        return None, None, {"error": f"Days range must be <= {MAX_DAYS_FOR_FILTER}", "status_code": 400}

    return start_utc, end_utc, None

# ----------------------------
# Filtro base (precisión, velocidad, distancia/tiempo)
# ----------------------------
def filter_positions(history, max_gps_accuracy=MAX_GPS_ACCURACY_M, max_speed_kmh=MAX_SPEED_KMH, min_distance=MIN_DISTANCE):
    positions = []
    last_lat, last_lon = None, None
    last_seen_dt_rounded = None
    last_seen_dt_real = None
    last_position = None

    for state in history:
        latitude = state.attributes.get("latitude")
        longitude = state.attributes.get("longitude")
        if latitude is None or longitude is None:
            continue

        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except (TypeError, ValueError):
            continue

        attrs = dict(state.attributes)

        # OwnTracks: 'velocity' (km/h) -> 'speed' (m/s)
        if "velocity" in attrs and "speed" not in attrs:
            try:
                attrs["speed"] = round(float(attrs.pop("velocity")) / 3.6, 2)
            except (TypeError, ValueError):
                pass

        current_datetime = isoparse(state.last_updated.isoformat())
        current_datetime_rounded = current_datetime.replace(microsecond=0)

        # Precisión GPS
        accuracy_raw = attrs.get("gps_accuracy", attrs.get("accuracy"))
        try:
            accuracy_m = float(accuracy_raw) if accuracy_raw is not None else None
        except (TypeError, ValueError):
            accuracy_m = None

        candidate = {
            "entity_id": state.entity_id,
            "state": state.state,
            "attributes": attrs,
            "last_updated": state.last_updated.isoformat(),
            "last_changed": state.last_changed.isoformat(),
        }
        last_position = candidate

        # 1) Precisión
        if accuracy_m is not None and accuracy_m > max_gps_accuracy:
            continue

        # 2) Velocidad respecto al último aceptado (usa dt REAL para el cálculo)
        if last_lat is not None and last_lon is not None and last_seen_dt_real is not None:
            dt_real_s = (current_datetime - last_seen_dt_real).total_seconds()
            if dt_real_s > 0:
                dist_m = haversine(last_lat, last_lon, latitude, longitude)
                speed_kmh = (dist_m / dt_real_s) * 3.6
                if speed_kmh > max_speed_kmh:
                    continue

        # 3) Distancia mínima
        if last_lat is not None and last_lon is not None:
            dist_m_for_min = haversine(last_lat, last_lon, latitude, longitude)
        else:
            dist_m_for_min = None

        is_distance_ok = (
            last_lat is None
            or last_lon is None
            or (dist_m_for_min is not None and dist_m_for_min > min_distance)
        )

        # 4) Deduplicación temporal a segundo
        is_time_ok = (last_seen_dt_rounded is None) or (current_datetime_rounded != last_seen_dt_rounded)

        if is_distance_ok and is_time_ok:
            positions.append(candidate)
            last_lat, last_lon = latitude, longitude
            last_seen_dt_rounded = current_datetime_rounded
            last_seen_dt_real = current_datetime

    # Asegurar última posición (respetando filtros y datos mínimos)
    if last_position and (not positions or positions[-1]["last_updated"] != last_position["last_updated"]):
        attrs_last = last_position.get("attributes", {})
        accuracy_raw = attrs_last.get("gps_accuracy", attrs_last.get("accuracy"))
        try:
            accuracy_m = float(accuracy_raw) if accuracy_raw is not None else None
        except (TypeError, ValueError):
            accuracy_m = None

        # Requiere lat/lon válidos
        try:
            lat2 = float(attrs_last.get("latitude"))
            lon2 = float(attrs_last.get("longitude"))
            latlon_ok = math.isfinite(lat2) and math.isfinite(lon2)
        except Exception:
            latlon_ok = False

        ok_by_speed = True
        if latlon_ok and last_lat is not None and last_lon is not None and last_seen_dt_real is not None:
            try:
                t2 = isoparse(last_position["last_updated"])
                dt_s = (t2 - last_seen_dt_real).total_seconds()
                if dt_s > 0:
                    dist_m = haversine(last_lat, last_lon, lat2, lon2)
                    speed_kmh = (dist_m / dt_s) * 3.6
                    if speed_kmh > max_speed_kmh:
                        ok_by_speed = False
            except Exception:
                ok_by_speed = True

        if latlon_ok and ok_by_speed and not (accuracy_m is not None and accuracy_m > max_gps_accuracy):
            positions.append(last_position)

    return positions

# ----------------------------
# Anti-spike de 3 puntos (A-B-C)
# ----------------------------
def squash_return_jitter(
    positions: List[dict],
    center_radius_m,
    max_loop_time_s,
    min_excursion_m,
    require_good_acc: bool = REQUIRE_GOOD_ACC,
    max_acc_m: float = MAX_GPS_ACCURACY_M,
) -> List[dict]:
    """
    Elimina excursiones cortas que salen del radio y vuelven en poco tiempo.
    Mantiene los puntos 'dentro' del radio y descarta los 'fuera' entre A y el retorno.

    - center_radius_m: normalmente usa stop_radius_m
    - max_loop_time_s: tiempo máximo para considerar que 'vuelve' (p.ej. 180 s)
    - min_excursion_m: distancia mínima fuera del radio para considerar que fue 'excursión' (por defecto 1.2*radio o 15 m)
    """
    if center_radius_m <= 0 or len(positions) < 3:
        return positions

    if min_excursion_m is None:
        min_excursion_m = max(1.2 * center_radius_m, 15.0)

    out: List[dict] = []
    n = len(positions)
    i = 0

    while i < n:
        A = positions[i]
        llA = _latlon_from_pos(A)
        tA = _dt_from_pos(A)
        if not llA or not tA:
            out.append(A); i += 1; continue
        if require_good_acc:
            accA = _acc_from_pos(A)
            if accA is not None and accA > max_acc_m:
                out.append(A); i += 1; continue

        # Busca el primer retorno a <= center_radius_m en <= max_loop_time_s
        j = i + 1
        found_return = None
        saw_excursion = False

        while j < n:
            Bj = positions[j]
            tJ = _dt_from_pos(Bj)
            if not tJ:
                j += 1; continue
            if (tJ - tA).total_seconds() > max_loop_time_s:
                break

            llJ = _latlon_from_pos(Bj)
            if not llJ:
                j += 1; continue

            dAJ = haversine(llA[0], llA[1], llJ[0], llJ[1])
            # marca que hubo salida "real" del radio
            if dAJ > min_excursion_m:
                saw_excursion = True

            # retorno al entorno del ancla A
            if dAJ <= center_radius_m:
                found_return = j
                break

            j += 1

        if found_return is not None and saw_excursion:
            # Conserva A y puntos 'dentro' del radio; elimina los 'fuera' entre A y el retorno
            out.append(A)
            for k in range(i + 1, found_return):
                Bk = positions[k]
                llk = _latlon_from_pos(Bk)
                if not llk:
                    out.append(Bk); continue
                d = haversine(llA[0], llA[1], llk[0], llk[1])
                if d <= center_radius_m:
                    out.append(Bk)
                else:
                    _LOGGER.debug("squash_return_jitter: drop idx=%d d=%.1f m (> %.1f)", k, d, center_radius_m)
            # Añade el punto de retorno (dentro del radio)
            out.append(positions[found_return])
            i = found_return + 1
        else:
            out.append(A)
            i += 1

    return out

# ----------------------------
# Stops + colapso de jitter (unificado)
# ----------------------------
def keep_first_stop_in_same_radius(
    positions: List[dict],
    same_radius_m: float,
) -> List[dict]:
    """
    Mantiene solo la PRIMERA parada si la siguiente parada cae en el mismo radio.
    Importante: no se reinicia al ver puntos de movimiento entre medias; se compara
    con la última parada conservada (más robusto frente a jitter).
    """
    out = []
    prev_stop = None  # última parada conservada

    for pos in positions:
        if not pos.get("stop"):
            out.append(pos)
            # OJO: NO reseteamos prev_stop aquí; así colapsamos secuencias stop-mov-stop.
            continue

        # pos es una parada
        if prev_stop is not None:
            ll_prev = _stop_center_latlon(prev_stop)
            ll_cur  = _stop_center_latlon(pos)
            if ll_prev and ll_cur:
                d = haversine(ll_prev[0], ll_prev[1], ll_cur[0], ll_cur[1])
                if d <= same_radius_m:
                    # Misma área de parada -> descarta esta (nos quedamos con la primera)
                    continue

        # No hay parada previa conservada o está fuera del radio -> conserva
        out.append(pos)
        prev_stop = pos

    return out

def _stop_center_latlon(pos) -> Optional[Tuple[float, float]]:
    lat = pos.get("stop_center_lat")
    lon = pos.get("stop_center_lon")
    if lat is not None and lon is not None:
        try:
            return float(lat), float(lon)
        except Exception:
            pass
    return _latlon_from_pos(pos)

def annotate_stops_and_collapse(
    positions: List[dict],
    stop_radius_m: float,
    stop_time_s: int,
    require_good_acc: bool = REQUIRE_GOOD_ACC,
    max_acc_m: float = MAX_GPS_ACCURACY_M,
) -> List[dict]:
    """
    Detección de paradas por radio + cálculo del dwell hasta el primer punto FUERA.
    Si no es parada (dwell < stop_time_s), NO se colapsa el grupo.
    Sin 'fallback' de gap: el dwell usa directamente t_next (si existe).
    """
    n = len(positions)
    if n == 0 or stop_radius_m <= 0:
        return positions

    if stop_time_s <= 0:
        return positions

    # limpiar marcas previas
    for p in positions:
        p["stop"] = False
        p.pop("stop_start", None)
        p.pop("stop_end", None)
        p.pop("stop_leave", None)
        p.pop("stop_duration_s", None)
        p.pop("stop_center_lat", None)
        p.pop("stop_center_lon", None)

    def latlon(idx):
        try:
            a = positions[idx]["attributes"]
            return float(a["latitude"]), float(a["longitude"])
        except Exception:
            return None

    def t(idx):
        try:
            return _dt_from_pos(positions[idx])
        except Exception:
            return None

    def acc_ok(idx):
        if not require_good_acc:
            return True
        a = _acc_from_pos(positions[idx])
        return (a is None) or (a <= max_acc_m)

    out = []
    i = 0

    while i < n:
        anchor = latlon(i)
        if not anchor or not acc_ok(i):
            out.append(positions[i])
            i += 1
            continue

        # Grupo por radio con centroide incremental
        c_lat, c_lon = anchor
        count = 1
        t_start = t(i)
        last_in = i
        j = i

        def close_group(t_next):
            """
            Cierra el grupo actual calculando el dwell desde t_start hasta:
              - t_next, si existe y es el primer punto fuera del radio
              - t_last_in, si no hay siguiente (fin de lista)
            """
            t_last_in = t(last_in) or t_start
            leave_dt = t_next if t_next else t_last_in
            dwell_s = (leave_dt - t_start).total_seconds() if (t_start and leave_dt) else 0

            if dwell_s >= stop_time_s:
                rep = positions[i].copy()
                rep["stop"] = True
                rep["stop_start"] = t_start.isoformat() if t_start else None
                rep["stop_end"] = t_last_in.isoformat() if t_last_in else None
                rep["stop_leave"] = leave_dt.isoformat() if leave_dt else None
                rep["stop_duration_s"] = dwell_s
                rep["stop_center_lat"] = c_lat
                rep["stop_center_lon"] = c_lon
                out.append(rep)
            else:
                # NO colapsar: conservar puntos originales "dentro"
                out.extend(positions[i:last_in + 1])

        while j + 1 < n:
            t_next = t(j + 1)
            nxt_ll = latlon(j + 1)

            # Siguiente inválido o mala precisión -> cerrar usando t_next
            if (nxt_ll is None) or (not acc_ok(j + 1)):
                close_group(t_next)
                i = j + 1
                break

            # Distancia al centroide
            dist_to_center = haversine(c_lat, c_lon, nxt_ll[0], nxt_ll[1])

            if dist_to_center <= stop_radius_m:
                j += 1
                count += 1
                last_in = j
                # actualizar centroide incremental
                c_lat = (c_lat * (count - 1) + nxt_ll[0]) / count
                c_lon = (c_lon * (count - 1) + nxt_ll[1]) / count
                continue

            # Siguiente está FUERA del radio -> cerrar usando t_next
            close_group(t_next)
            i = j + 1
            break
        else:
            # Fin de lista -> cerrar sin t_next (leave_dt = t_last_in)
            close_group(None)
            i = last_in + 1

    return keep_first_stop_in_same_radius(out, same_radius_m=stop_radius_m)

# --------------------------------------------
# ESTADISTICAS
# --------------------------------------------
STEPS = 32  # muestreo base por tramo para refinar zonas

# --- utilidades de conversión aprox. m -> grados ---
def _deg_lat(m: float) -> float:
    return m / 111_320.0

def _deg_lon(m: float, lat: float) -> float:
    denom = 111_320.0 * math.cos(math.radians(lat))
    if abs(denom) < 1e-9:
        return m / 111_320.0
    return m / denom

# --- utilidades zonas ---
def _all_zones(hass):
    """Lee zonas de Home Assistant con id SIN el prefijo 'zone.'. Añade bounding boxes para acelerar lookup."""
    zones = []
    for st in hass.states.async_all("zone"):
        a = st.attributes or {}
        try:
            lat = float(a["latitude"])
            lon = float(a["longitude"])
            r_m = float(a.get("radius", 100.0))
            dlat = _deg_lat(r_m)
            dlon = _deg_lon(r_m, lat)
            object_id = st.entity_id.split("zone.", 1)[1]
            zones.append({
                "id": object_id,                              # <-- sin 'zone.'
                "entity_id": st.entity_id,                    #     con 'zone.'
                "name": a.get("friendly_name", st.name or st.entity_id),
                "latitude": lat,
                "longitude": lon,
                "radius_m": r_m,
                "lat_min": lat - dlat,
                "lat_max": lat + dlat,
                "lon_min": lon - dlon,
                "lon_max": lon + dlon,
                "color": a.get("color") or a.get("icon_color") or None,
                "is_custom": bool(a.get("icon") or a.get("color")),  # heurística
            })
        except Exception:
            continue
    return zones

def _zone_of(lat, lon, zones):
    """Devuelve el nombre de la zona que contiene el punto, o '' si ninguna. Usa bbox previa para minimizar Haversine."""
    if not zones:
        return ''
    best = None
    for z in zones:
        if not (z["lat_min"] <= lat <= z["lat_max"] and z["lon_min"] <= lon <= z["lon_max"]):
            continue
        d = haversine(lat, lon, z["latitude"], z["longitude"])
        if d <= z["radius_m"]:
            if best is None or d < best[0]:
                best = (d, z["name"])
    return best[1] if best else ''

def _lerp(a, b, t):
    return a + (b - a) * t

def _interp_latlon(lat1, lon1, lat2, lon2, t):
    return _lerp(lat1, lat2, t), _lerp(lon1, lon2, t)

def _refine_boundary(lat1, lon1, lat2, lon2, t0, t1, zoneA, zones, max_iter=25, eps_m=2.0):
    lo, hi = t0, t1
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        mlat, mlon = _interp_latlon(lat1, lon1, lat2, lon2, mid)
        zmid = _zone_of(mlat, mlon, zones)
        if zmid == zoneA:
            lo = mid
        else:
            hi = mid
        Alat, Alon = _interp_latlon(lat1, lon1, lat2, lon2, lo)
        Blat, Blon = _interp_latlon(lat1, lon1, lat2, lon2, hi)
        if haversine(Alat, Alon, Blat, Blon) < eps_m:
            break
    return (lo + hi) / 2.0

def _split_segment_by_zones(lat1, lon1, lat2, lon2, steps, zones):
    """Divide el segmento en subtramos homogéneos por zona. Ajusta steps de forma adaptativa."""
    # steps adaptativos (~cada 10 m, cap 4..64)
    seg_len_m = haversine(lat1, lon1, lat2, lon2)
    steps_local = max(4, min(64, int(max(1.0, seg_len_m / 10.0))))
    steps = max(steps, steps_local)

    segs = []
    prev_t = 0.0
    prev_zone = _zone_of(lat1, lon1, zones)
    for i in range(1, max(2, steps) + 1):
        t = i / float(steps)
        la, lo = _interp_latlon(lat1, lon1, lat2, lon2, t)
        z = _zone_of(la, lo, zones)
        if z != prev_zone:
            t_cross = _refine_boundary(lat1, lon1, lat2, lon2, prev_t, t, prev_zone, zones)
            if t_cross - prev_t > 1e-9:
                segs.append({"zone": prev_zone, "t0": prev_t, "t1": t_cross})
            prev_t = t_cross
            prev_zone = _zone_of(*_interp_latlon(lat1, lon1, lat2, lon2, prev_t), zones)
    if 1.0 - prev_t > 1e-9:
        segs.append({"zone": prev_zone, "t0": prev_t, "t1": 1.0})
    return segs

# --- resumen global ---
def _calc_summary(positions):
    if not positions:
        return {
            "positions_count": 0,
            "start_utc": None,
            "end_utc": None,
            "total_time_s": 0,
            "distance_m": 0.0,
            "max_speed_mps": 0.0,
            "average_speed_mps": 0.0,
            "stops_count": 0,
            "stopped_time_s": 0
        }

    # tiempos
    t0 = _as_dt(positions[0].get("last_updated"))
    tn = _as_dt(positions[-1].get("last_updated"))
    if not t0 or not tn:
        # si algo raro pasó con las fechas, devuelve vacío coherente
        return {
            "positions_count": len(positions),
            "start_utc": None,
            "end_utc": None,
            "total_time_s": 0,
            "distance_m": 0.0,
            "max_speed_mps": 0.0,
            "average_speed_mps": 0.0,
            "stops_count": len([p for p in positions if p.get("stop")]),
            "stopped_time_s": 0
        }
    total_time_s = max(0, (tn - t0).total_seconds())

    # distancia
    distance_m = 0.0
    for i in range(1, len(positions)):
        a, b = positions[i-1], positions[i]
        try:
            lat1 = float(a["attributes"]["latitude"]); lon1 = float(a["attributes"]["longitude"])
            lat2 = float(b["attributes"]["latitude"]); lon2 = float(b["attributes"]["longitude"])
            distance_m += haversine(lat1, lon1, lat2, lon2)
        except Exception:
            pass

    # velocidades (m/s) desde atributos
    speeds = []
    for p in positions:
        v = p.get("attributes", {}).get("speed")
        try:
            v = float(v)
            if math.isfinite(v):
                speeds.append(v)
        except Exception:
            pass
    max_speed_mps = max(speeds) if speeds else 0.0

    # media ponderada por tiempo (usa v de A en el tramo A→B)
    time_weighted_sum = 0.0
    time_total = 0.0
    for i in range(1, len(positions)):
        A = positions[i - 1]
        B = positions[i]
        try:
            vA = float(A.get("attributes", {}).get("speed"))
        except Exception:
            vA = None
        tA = _as_dt(A.get("last_updated"))
        tB = _as_dt(B.get("last_updated"))
        if vA is not None and tA and tB and tB > tA and math.isfinite(vA):
            dt = (tB - tA).total_seconds()
            time_weighted_sum += vA * dt
            time_total += dt
    avg_speed_mps = (time_weighted_sum / time_total) if time_total > 0 else 0.0

    # paradas
    stops = [p for p in positions if p.get("stop")]
    stops_count = len(stops)
    # tiempo parado: usa stop_duration_s si existe; si no, fallback al siguiente punto
    stopped_time_s = 0
    got_durations = any("stop_duration_s" in p for p in stops)
    if got_durations:
        for p in stops:
            try:
                stopped_time_s += int(round(float(p.get("stop_duration_s") or 0)))
            except Exception:
                pass
    else:
        for i, p in enumerate(positions[:-1]):
            if p.get("stop"):
                tA = _as_dt(p.get("last_updated"))
                tB = _as_dt(positions[i+1].get("last_updated"))
                if tA and tB:
                    stopped_time_s += max(0, int((tB - tA).total_seconds()))

    return {
        "positions_count": len(positions),
        "start_utc": t0.isoformat(),
        "end_utc": tn.isoformat(),
        "total_time_s": int(round(total_time_s)),
        "distance_m": distance_m,
        "max_speed_mps": max_speed_mps,
        "average_speed_mps": avg_speed_mps,
        "stops_count": stops_count,
        "stopped_time_s": int(round(stopped_time_s))
    }

def _count_zone_visits_by_runs(positions, zones):
    """
    Cuenta 1 visita cada vez que entramos en una zona desde fuera (o desde otra).
    Varias posiciones seguidas en la misma zona => 1 sola visita.
    Salgo y reentro => otra visita.
    """
    visits = {}
    prev_zone = ''
    for p in positions:
        ll = _latlon_from_pos(p)
        if not ll:
            continue
        z = _zone_of(float(ll[0]), float(ll[1]), zones) or ''
        if z and z != prev_zone:
            visits[z] = visits.get(z, 0) + 1
        prev_zone = z
    return visits

# --- estadísticas por zona ---
def _calc_zone_stats(positions, zones):
    out = {}

    def _ensure(name):
        if name not in out:
            meta = next((z for z in zones if z["name"] == name), None)
            out[name] = {
                "zone": name,
                "time_s": 0.0,
                "visits": 0,      # se fijará al final con runs
                "stops": 0,
                "distance_m": 0.0,
                "meta": meta
            }
        return out[name]

    if not positions:
        return []

    # 1) Paradas por zona
    for p in positions:
        if p.get("stop"):
            ll = _latlon_from_pos(p)
            if not ll:
                continue
            zn = _zone_of(float(ll[0]), float(ll[1]), zones)
            _ensure(zn)["stops"] += 1

    # 2) TIEMPO por zona (TODO el dt A→B se asigna a la zona de A, fallback a B si A no tiene)
    for i in range(1, len(positions)):
        A = positions[i - 1]
        B = positions[i]
        tA = _as_dt(A.get("last_updated"))
        tB = _as_dt(B.get("last_updated"))
        if not tA or not tB:
            continue

        dt = max(0.0, (tB - tA).total_seconds())
        if dt <= 0:
            continue

        llA = _latlon_from_pos(A)
        llB = _latlon_from_pos(B)

        zA = _zone_of(float(llA[0]), float(llA[1]), zones) if llA else None
        zB = _zone_of(float(llB[0]), float(llB[1]), zones) if llB else None

        # Asignación: preferimos la zona de A; si no hay, caemos a la de B; si tampoco, ''.
        z_time = zA if (zA is not None) else (zB if (zB is not None) else '')
        _ensure(z_time)["time_s"] += dt

    # 3) DISTANCIA por zona (split por zonas para precisión)
    for i in range(1, len(positions)):
        A = positions[i - 1]
        B = positions[i]

        llA = _latlon_from_pos(A)
        llB = _latlon_from_pos(B)
        if not llA or not llB:
            continue

        lat1, lon1 = float(llA[0]), float(llA[1])
        lat2, lon2 = float(llB[0]), float(llB[1])

        segs = _split_segment_by_zones(lat1, lon1, lat2, lon2, STEPS, zones)
        for s in segs:
            zn = s["zone"] or ''
            aLat, aLon = _interp_latlon(lat1, lon1, lat2, lon2, s["t0"])
            bLat, bLon = _interp_latlon(lat1, lon1, lat2, lon2, s["t1"])
            _ensure(zn)["distance_m"] += haversine(aLat, aLon, bLat, bLon)

    # 4) Visitas por “runs”
    visits_map = _count_zone_visits_by_runs(positions, zones)
    for zname in visits_map.keys():
        _ensure(zname)

    # 5) Construcción de filas
    rows = []
    for name, agg in out.items():
        rows.append({
            "zone": name,
            "time_s": int(round(agg["time_s"])),
            "visits": int(visits_map.get(name, 0)),
            "stops": int(agg["stops"]),
            "distance_m": float(agg["distance_m"]),
            "meta": agg["meta"]
        })
    return rows

# --- payload vacío coherente ---
def _empty_payload():
    return { "positions": [], "summary": _calc_summary([]), "zones": [] }

# ----------------------------
# Endpoint
# ----------------------------
class FilteredPositionsEndpoint(HomeAssistantView):
    """Obtener posiciones filtradas de un usuario entre fechas"""

    url = "/api/ha_tracker/filtered_positions"
    name = "api:ha_tracker/filtered_positions"
    requires_auth = True

    async def get(self, request):
        """Devuelve posiciones filtradas de un usuario entre fechas"""

        hass = request.app["hass"]

        # Devuelve solo si es administrador o only_admin es false
        only_admin = False

        # valores por defecto (radios float, tiempos int)
        stop_radius_m: float = float(STOP_RADIUS_M_FALLBACK)
        stop_time_s: int = int(STOP_OUTSIDE_GAP_S_FALLBACK)
        anti_spike_radius: float = float(ANTI_SPIKE_RADIUS_FALLBACK)
        anti_spike_time: int = int(ANTI_SPIKE_TIME_S_FALLBACK)

        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:
            entry = entries[0]
            only_admin = entry.options.get("only_admin", entry.data.get("only_admin", False))

            # stop_radius (float >= 0)
            try:
                stop_radius_m = float(entry.options.get("stop_radius", entry.data.get("stop_radius", stop_radius_m)))
                if stop_radius_m < 0:
                    stop_radius_m = 0.0
            except (TypeError, ValueError):
                pass

            # stop_time (int >= 0)
            try:
                stop_time_s = int(entry.options.get("stop_time", entry.data.get("stop_time", stop_time_s)))
                if stop_time_s < 0:
                    stop_time_s = 0
            except (TypeError, ValueError):
                pass

            # anti_spike_radius (float >= 0)
            try:
                anti_spike_radius = float(entry.options.get("anti_spike_radius", entry.data.get("anti_spike_radius", anti_spike_radius)))
                if anti_spike_radius < 0:
                    anti_spike_radius = 0.0
            except (TypeError, ValueError):
                pass

            # anti_spike_time (int >= 0)
            try:
                anti_spike_time = int(entry.options.get("anti_spike_time", entry.data.get("anti_spike_time", anti_spike_time)))
                if anti_spike_time < 0:
                    anti_spike_time = 0
            except (TypeError, ValueError):
                pass

        user = request["hass_user"]
        if only_admin and (user is None or not user.is_admin):
            return self.json({"error": "Forbidden"}, status_code=403)

        query = request.query

        person_id, start_date, end_date, error = validate_query_params(query)
        if error:
            return self.json(error, status_code=error["status_code"])

        source_device_id, error = validate_person(hass, person_id)
        if error:
            return self.json(error, status_code=error["status_code"])

        start_datetime_utc, end_datetime_utc, error = validate_dates(start_date, end_date)
        if error:
            return self.json(error, status_code=error["status_code"])

        try:
            history = await hass.async_add_executor_job(
                partial(
                    get_significant_states, hass,
                    start_datetime_utc, end_datetime_utc, [source_device_id],
                    include_start_time_state=False,
                    significant_changes_only=False,
                    minimal_response=False,
                    no_attributes=False,
                )
            )
        except (OSError, ValueError, KeyError) as e:
            return self.json({"error": f"Error with history: {str(e)}"}, status_code=500)

        if not history or source_device_id not in history:
            return self.json(_empty_payload())

        states = history[source_device_id]
        states = [s for s in states
                  if dt_util.as_utc(s.last_updated) >= start_datetime_utc
                  and dt_util.as_utc(s.last_updated) <= end_datetime_utc]
        states.sort(key=lambda s: dt_util.as_utc(s.last_updated))

        # Filtra posiciones
        positions = filter_positions(
            states, max_gps_accuracy=MAX_GPS_ACCURACY_M,
            max_speed_kmh=MAX_SPEED_KMH, min_distance=MIN_DISTANCE
        )

        # aplasta excursiones cortas que salen y vuelven (jitter típico)
        if anti_spike_radius > 0 and anti_spike_time > 0:
            positions = squash_return_jitter(
                positions,
                center_radius_m=float(anti_spike_radius),
                max_loop_time_s=int(anti_spike_time),
                min_excursion_m=None,  # usa 1.2*radio/15m por defecto
                require_good_acc=REQUIRE_GOOD_ACC,
                max_acc_m=MAX_GPS_ACCURACY_M,
            )

        # Paradas
        if stop_radius_m > 0:
            positions = annotate_stops_and_collapse(
                positions,
                stop_radius_m=float(stop_radius_m),
                stop_time_s=int(stop_time_s),
                require_good_acc=REQUIRE_GOOD_ACC,
                max_acc_m=MAX_GPS_ACCURACY_M
            )

        # --- calcular resumen y zonas en servidor ---
        zones = _all_zones(hass)
        summary = _calc_summary(positions)
        zones_rows = _calc_zone_stats(positions, zones)

        payload = {
            "positions": positions,
            "summary": summary,
            "zones": zones_rows
        }
        return self.json(payload)
