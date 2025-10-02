import logging
import math

from typing import List, Tuple, Optional
from dateutil.parser import isoparse
from datetime import timedelta, datetime
from functools import partial

from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder import get_instance as get_recorder_instance
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.util import dt as dt_util

DOMAIN = __package__.split(".")[-2]

_LOGGER = logging.getLogger(__name__)

MAX_DAYS_FOR_FILTER = 31

# ----------------------------
# UMBRALES DE FILTRO (ajustables)
# ----------------------------
MAX_GPS_ACCURACY_M_FALLBACK = 15.0  # descartar puntos con precisión peor que esto (m)
MAX_SPEED_KMH_FALLBACK = 150.0      # descartar puntos con salto mayores a este valor

MIN_DISTANCE = 0.0                  # distancia mínima entre puntos aceptados (m) 0.0 => desactivado
MIN_TIME = 0                        # tiempo mínimo entre puntos aceptados (segundos) 0 => desactivado

# ----------------------------
# PARADAS/JITTER por radio + “gap” al primer punto fuera
# (Estos valores sirven como *fallback*. En runtime se leen de la config:
#  stop_radius (m) y stop_time (s). Si stop_radius=0 no se agrupa; si stop_time=0 no se marcan paradas.)
# ----------------------------
REQUIRE_GOOD_ACC = True             # si True, exige precisión <= MAX_GPS_ACCURACY_M dentro del grupo
STOP_RADIUS_M_FALLBACK = 25.0       # m (float)
STOP_TIME_S_FALLBACK = 300          # s (int)
REENTRY_GAP_S_FALLBACK = 60         # s (int) si se sale un momento y se regresa al mismo sitio enseguida cuenta como la misma parada
OUTSIDE_GAP_S_FALLBACK = 300        # s (int) no se cierra la parada por una salida inferior a este tiempo

# fallbacks para el Anti-spike de 5 puntos por velocidad relativa (A→B, B→C→D, D→E)
ANTI_SPIKE_FACTOR_K = 3.0
ANTI_SPIKE_DETOUR_RATIO = 1.7
ANTI_SPIKE_RADIUS_FALLBACK = 30.0   # m (float)
ANTI_SPIKE_TIME_S_FALLBACK = 600    # s (int)

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
        return dt_util.as_utc(v) if v.tzinfo else dt_util.as_utc(v.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE))
    if v is None:
        return None
    try:
        dt = isoparse(v if isinstance(v, str) else str(v))
        return dt_util.as_utc(dt if dt.tzinfo else dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE))
    except Exception:
        return None

def _as_dt(v):
    if isinstance(v, datetime):
        return dt_util.as_utc(v) if v.tzinfo else dt_util.as_utc(v.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE))
    if v is None:
        return None
    try:
        dt = isoparse(v if isinstance(v, str) else str(v))
        return dt_util.as_utc(dt if dt.tzinfo else dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE))
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
def filter_positions(
    history,
    max_gps_accuracy_m: float,
    max_speed_kmh: float,
    min_distance=MIN_DISTANCE,
    min_time_s=MIN_TIME,   
):
    """
    Filtra estados de device_tracker aplicando:
      1) Precisión GPS máxima
      2) Tope de velocidad respecto al último punto aceptado
      3) Distancia mínima entre puntos aceptados
      4) Tiempo mínimo entre puntos aceptados (+ deduplicación por segundo)
    """
    positions = []
    last_lat, last_lon = None, None
    last_seen_dt_rounded = None  # último aceptado, redondeado a segundo
    last_seen_dt_real = None     # último aceptado, datetime real
    last_position = None         # último candidato, para 'asegurar última posición'

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

        # OwnTracks: 'velocity' (km/h) -> 'speed' (m/s) si falta 'speed'
        if "velocity" in attrs and "speed" not in attrs:
            try:
                attrs["speed"] = round(float(attrs.pop("velocity")) / 3.6, 2)
            except (TypeError, ValueError):
                pass

       # Normaliza speed: si es numérica y < 0 -> 0.0
        try:
            spd = float(attrs.get("speed"))
            if math.isfinite(spd) and spd < 0:
                attrs["speed"] = 0.0
        except (TypeError, ValueError):
            pass
            
        current_datetime = dt_util.as_utc(state.last_updated)
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
        if accuracy_m is not None and accuracy_m > max_gps_accuracy_m:
            continue

        # 2) Velocidad respecto al último aceptado
        if last_lat is not None and last_lon is not None and last_seen_dt_real is not None:
            dt_real_s = (current_datetime - last_seen_dt_real).total_seconds()
            if dt_real_s > 0:
                dist_m = haversine(last_lat, last_lon, latitude, longitude)
                speed_kmh = (dist_m / dt_real_s) * 3.6
                if speed_kmh > max_speed_kmh:
                    continue

        # 3) Distancia mínima entre aceptados
        if last_lat is not None and last_lon is not None:
            dist_m_for_min = haversine(last_lat, last_lon, latitude, longitude)
        else:
            dist_m_for_min = None

        is_distance_ok = (
            last_lat is None
            or last_lon is None
            or (dist_m_for_min is not None and dist_m_for_min > min_distance)
        )

        # 4) Tiempo mínimo + deduplicación por segundo
        if last_seen_dt_real is not None:
            dt_since_last = (current_datetime - last_seen_dt_real).total_seconds()
        else:
            dt_since_last = None

        is_time_ok = (
            last_seen_dt_real is None
            or (
                # respeta el umbral de tiempo mínimo si está activo
                (min_time_s <= 0 or (dt_since_last is not None and dt_since_last >= float(min_time_s)))
                # y evita duplicados exactamente en el mismo segundo
                and (current_datetime_rounded != last_seen_dt_rounded)
            )
        )

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
        except Exception:
            accuracy_m = None

        # Requiere lat/lon válidos
        try:
            lat2 = float(attrs_last.get("latitude"))
            lon2 = float(attrs_last.get("longitude"))
            latlon_ok = math.isfinite(lat2) and math.isfinite(lon2)
        except Exception:
            latlon_ok = False

        ok_by_speed = True
        ok_by_time = True

        if last_seen_dt_real is not None:
            try:
                t2 = dt_util.as_utc(isoparse(last_position["last_updated"]))
                dt_s = (t2 - last_seen_dt_real).total_seconds()

                # tiempo mínimo entre aceptados
                if min_time_s > 0 and dt_s is not None and dt_s < float(min_time_s):
                    ok_by_time = False

                # deduplicación exacta por segundo
                if ok_by_time and t2.replace(microsecond=0) == last_seen_dt_rounded:
                    ok_by_time = False

                # velocidad respecto al último aceptado
                if dt_s > 0 and latlon_ok and last_lat is not None and last_lon is not None:
                    dist_m = haversine(last_lat, last_lon, lat2, lon2)
                    speed_kmh = (dist_m / dt_s) * 3.6
                    if speed_kmh > max_speed_kmh:
                        ok_by_speed = False
            except Exception:
                ok_by_speed = True
                ok_by_time = True

        if (
            latlon_ok
            and ok_by_speed
            and ok_by_time
            and not (accuracy_m is not None and accuracy_m > max_gps_accuracy_m)
        ):
            positions.append(last_position)

    return positions


#------------------------------
# Anti-spike 5 puntos por velocidad relativa (A→B, B→C→D, D→E)
#------------------------------
def drop_c_spikes_relative_5pt(
    positions: List[dict],
    max_gps_accuracy_m: float = MAX_GPS_ACCURACY_M_FALLBACK,
    factor_k: float = 3.0,          # v_detour debe superar k·v1 y k·v2
    min_detour_ratio: float = 1.7,   # (dBC + dCD) / dBD > R => hay ida-vuelta clara
    max_bd_dt_s: int = 180,          # B→D debe suceder “rápido”
    min_leg_m: float = 15.0,         # cada pierna (BC y CD) al menos X m
    require_good_acc: bool = REQUIRE_GOOD_ACC,    
) -> List[dict]:
    """
    Elimina el punto central C cuando el tramo B→C→D es anormalmente rápido
    frente a las velocidades de contexto A→B y D→E, y además forma un desvío
    (ida-vuelta) claro en un tiempo corto.
    """
    n = len(positions)
    if n < 5:
        return positions

    def _t(i): return _dt_from_pos(positions[i])
    def _ll(i): return _latlon_from_pos(positions[i])

    drop_idx = set()
    eps_v = 1e-6
    eps_d = 1e-6

    for i in range(2, n - 2):
        A, B, C, D, E = positions[i-2], positions[i-1], positions[i], positions[i+1], positions[i+2]

        # Precisión opcional (al menos en C; puedes ampliar a B y D si quieres)
        if require_good_acc:
            accC = _acc_from_pos(C)
            if accC is not None and accC > max_gps_accuracy_m:
                continue

        tA, tB, tC, tD, tE = _t(i-2), _t(i-1), _t(i), _t(i+1), _t(i+2)
        llA, llB, llC, llD, llE = _ll(i-2), _ll(i-1), _ll(i), _ll(i+1), _ll(i+2)
        if not all([tA, tB, tC, tD, tE, llA, llB, llC, llD, llE]):
            continue

        dtAB = (tB - tA).total_seconds()
        dtDE = (tE - tD).total_seconds()
        dtBD = (tD - tB).total_seconds()
        if dtAB <= 0 or dtDE <= 0 or dtBD <= 0 or dtBD > max_bd_dt_s:
            continue

        dAB = haversine(llA[0], llA[1], llB[0], llB[1])
        dBC = haversine(llB[0], llB[1], llC[0], llC[1])
        dCD = haversine(llC[0], llC[1], llD[0], llD[1])
        dDE = haversine(llD[0], llD[1], llE[0], llE[1])
        dBD = haversine(llB[0], llB[1], llD[0], llD[1])

        # Evitar borrar microvariaciones por debajo de la precisión/ruido
        if dBC < min_leg_m or dCD < min_leg_m:
            continue

        v1 = dAB / max(dtAB, eps_v)
        v2 = dDE / max(dtDE, eps_v)
        v_detour = (dBC + dCD) / max(dtBD, eps_v)

        detour_ratio = (dBC + dCD) / max(dBD, eps_d)

        # Condición principal: v_detour mucho mayor que velocidades “de contexto”
        # y además desvío geométrico claro.
        if (v_detour > factor_k * max(v1, v2, eps_v)) and (detour_ratio > min_detour_ratio):
            # Marca C para borrado
            # _LOGGER.debug("drop_c_spikes_relative_5pt: drop C idx=%d v_detour=%.2f v1=%.2f v2=%.2f ratio=%.2f", i, v_detour, v1, v2, detour_ratio)
            drop_idx.add(i)

    if not drop_idx:
        return positions

    out = [p for j, p in enumerate(positions) if j not in drop_idx]
    return out

# ----------------------------
# Stops + colapso de jitter (unificado)
# ----------------------------
def keep_first_stop_in_same_radius(
    positions: List[dict],
    same_radius_m: float,
    reentry_gap_s: int = 0,
) -> List[dict]:
    out = []
    prev_stop = None

    for pos in positions:
        if not pos.get("stop"):
            out.append(pos)
            continue

        keep = True
        if prev_stop is not None:
            ll_prev = _stop_center_latlon(prev_stop)
            ll_cur  = _stop_center_latlon(pos)
            if ll_prev and ll_cur:
                d = haversine(ll_prev[0], ll_prev[1], ll_cur[0], ll_cur[1])
                if d <= same_radius_m:
                    t_leave_prev = _as_dt(prev_stop.get("stop_leave") or prev_stop.get("stop_end") or prev_stop.get("last_updated"))
                    t_start_cur  = _as_dt(pos.get("stop_start")  or pos.get("last_updated"))
                    gap_s = (t_start_cur - t_leave_prev).total_seconds() if (t_leave_prev and t_start_cur) else None

                    if gap_s is None or gap_s < float(reentry_gap_s):
                        # --- FUSIÓN: extender la parada anterior con los tiempos de la actual ---
                        # stop_end: máximo de ambos
                        t_end_prev = _as_dt(prev_stop.get("stop_end") or prev_stop.get("last_updated"))
                        t_end_cur  = _as_dt(pos.get("stop_end") or pos.get("last_updated"))
                        if t_end_prev and t_end_cur and t_end_cur > t_end_prev:
                            prev_stop["stop_end"] = t_end_cur.isoformat()

                        # stop_leave: máximo de ambos
                        t_leave_cur = _as_dt(pos.get("stop_leave") or pos.get("stop_end") or pos.get("last_updated"))
                        if t_leave_prev and t_leave_cur and t_leave_cur > t_leave_prev:
                            prev_stop["stop_leave"] = t_leave_cur.isoformat()

                        # Recalcular duración desde su stop_start original
                        t_start_prev = _as_dt(prev_stop.get("stop_start") or prev_stop.get("last_updated"))
                        t_leave_new  = _as_dt(prev_stop.get("stop_leave") or prev_stop.get("stop_end") or prev_stop.get("last_updated"))
                        if t_start_prev and t_leave_new and t_leave_new >= t_start_prev:
                            prev_stop["stop_duration_s"] = int((t_leave_new - t_start_prev).total_seconds())

                        keep = False  # descartamos 'pos' porque ya fue fusionada

        if keep:
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
    reentry_gap_s: int,
    outside_gap_s: int,   
    max_gps_accuracy_m: float,
    require_good_acc: bool = REQUIRE_GOOD_ACC,    
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
        return (a is None) or (a <= max_gps_accuracy_m)

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
                attrs_src = positions[i].get("attributes", {})
                rep["attributes"] = dict(attrs_src)  # <- copia del dict para no mutar el original
                rep["stop"] = True
                rep["stop_start"] = t_start.isoformat() if t_start else None
                rep["stop_end"] = t_last_in.isoformat() if t_last_in else None
                rep["stop_leave"] = leave_dt.isoformat() if leave_dt else None
                rep["stop_duration_s"] = dwell_s
                rep["stop_center_lat"] = c_lat
                rep["stop_center_lon"] = c_lon
                # coords visibles al centroide
                rep["attributes"]["latitude"] = c_lat
                rep["attributes"]["longitude"] = c_lon   
                rep["attributes"]["speed"] = 0.0
                
                out.append(rep)
            else:
                # NO colapsar: conservar puntos originales "dentro"
                out.extend(positions[i:last_in + 1])

        while j + 1 < n:
            t_next = t(j + 1)
            nxt_ll = latlon(j + 1)

            # Siguiente inválido o mala precisión -> ignorar y seguir
            if (nxt_ll is None) or (not acc_ok(j + 1)):
                j += 1
                continue

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

            # Siguiente está FUERA del radio -> comprobar si la salida persiste al menos outside_gap_s
            persist_until = t_next + timedelta(seconds=int(outside_gap_s))
            k = j + 1
            returned_inside = False
            ret_ll = None

            while k < n:
                tk = t(k)
                if not tk or tk > persist_until:
                    break
                llk = latlon(k)
                if llk and acc_ok(k):
                    if haversine(c_lat, c_lon, llk[0], llk[1]) <= stop_radius_m:
                        returned_inside = True
                        ret_ll = llk
                        break
                k += 1

            if returned_inside:
                # Ignorar la mini-excursión: continúa el grupo desde el retorno
                j = k
                count += 1
                last_in = j
                # (opcional) actualiza centroide con el punto de retorno
                if ret_ll:
                    c_lat = (c_lat * (count - 1) + ret_ll[0]) / count
                    c_lon = (c_lon * (count - 1) + ret_ll[1]) / count
                continue

            # Si no volvió dentro del margen, sí cerramos
            close_group(t_next)
            i = j + 1
            break

        else:
            # Fin de lista -> cerrar sin t_next (leave_dt = t_last_in)
            close_group(None)
            i = last_in + 1

    return keep_first_stop_in_same_radius(out, same_radius_m=stop_radius_m, reentry_gap_s=reentry_gap_s)

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
    """Lee zonas HA. (Colores ignorados intencionadamente en backend)."""

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
            name = a.get("friendly_name", st.name or st.entity_id)

            zones.append({
                "id": object_id,
                "entity_id": st.entity_id,
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "radius_m": r_m,
                "lat_min": lat - dlat,
                "lat_max": lat + dlat,
                "lon_min": lon - dlon,
                "lon_max": lon + dlon,
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
    """
    Resumen robusto:
      - t0 = mínimo entre last_updated y stop_start (si hubiese).
      - tn = máximo entre last_updated y stop_end.
    """
    def _collect_times_for_start(ps):
        times = []
        for p in ps:
            t = _as_dt(p.get("last_updated"))
            if t: times.append(t)
            if p.get("stop"):
                ts = _as_dt(p.get("stop_start"))
                if ts: times.append(ts)
        return times

    def _collect_times_for_end(ps):
        times = []
        for p in ps:
            t = _as_dt(p.get("last_updated"))
            if t: times.append(t)
            if p.get("stop"):
                te = _as_dt(p.get("stop_end"))
                if te: times.append(te)
        return times

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

    start_candidates = _collect_times_for_start(positions)
    end_candidates   = _collect_times_for_end(positions)

    if not start_candidates or not end_candidates:
        # Fallback coherente si algo raro pasó con fechas
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

    t0 = min(start_candidates)
    tn = max(end_candidates)

    total_time_s = max(0, int(round((tn - t0).total_seconds())))

    # Distancia (sin cambios)
    distance_m = 0.0
    for i in range(1, len(positions)):
        a, b = positions[i-1], positions[i]
        try:
            tA = _as_dt(a.get("last_updated"))
            tB = _as_dt(b.get("last_updated"))
            if not (tA and tB and tB > tA):
                continue
            
            lat1 = float(a["attributes"]["latitude"]); lon1 = float(a["attributes"]["longitude"])
            lat2 = float(b["attributes"]["latitude"]); lon2 = float(b["attributes"]["longitude"])
            distance_m += haversine(lat1, lon1, lat2, lon2)
        except Exception:
            pass

    # Velocidad máxima desde atributos (sin cambios)
    speeds = []
    for p in positions:
        v = p.get("attributes", {}).get("speed")
        try:
            v = float(v)
            if math.isfinite(v) and v >= 0:     # ignora negativas
                speeds.append(v)
        except Exception:
            pass
    max_speed_mps = max(speeds) if speeds else 0.0

    # Velocidad media ponderada por tiempo (solo en movimiento y sin stops)
    def _eff_seg_times(A, B):
        """Devuelve (tA, tB) excluyendo tiempo parado en los extremos."""
        tA = _as_dt(A.get("last_updated"))
        tB = _as_dt(B.get("last_updated"))
        if A.get("stop"):
            tA = _as_dt(A.get("stop_leave")) or _as_dt(A.get("stop_end")) or tA
        if B.get("stop"):
            tB = _as_dt(B.get("stop_start")) or tB
        return tA, tB

    time_weighted_sum = 0.0
    time_total = 0.0
    for i in range(1, len(positions)):
        A = positions[i - 1]
        B = positions[i]

        # Omitir segmentos cuyo punto A es una parada
        if A.get("stop"):
            continue

        # velocidad en A (si existe y es válida)
        try:
            vA = float(A.get("attributes", {}).get("speed"))
            if not math.isfinite(vA) or vA < 0:
                vA = None
        except Exception:
            vA = None

        tA, tB = _eff_seg_times(A, B)
        if vA is not None and tA and tB and tB > tA:
            dt = (tB - tA).total_seconds()
            if dt > 0:
                time_weighted_sum += vA * dt
                time_total += dt
    average_speed_mps = (time_weighted_sum / time_total) if time_total > 0 else 0.0

    # Paradas (sumar siempre stop_leave - stop_start si existen)
    stops = [p for p in positions if p.get("stop")]
    stopped_time_s = 0

    for p in stops:
        t_start = _as_dt(p.get("stop_start")) or _as_dt(p.get("last_updated"))
        t_leave = _as_dt(p.get("stop_leave")) or _as_dt(p.get("stop_end"))
        if t_start and t_leave and t_leave >= t_start:
            stopped_time_s += int((t_leave - t_start).total_seconds())
        elif "stop_duration_s" in p:
            # Fallback por si faltan marcas explícitas
            try:
                stopped_time_s += int(round(float(p["stop_duration_s"] or 0)))
            except Exception:
                pass

    # Fallback adicional si no se sumó nada (p.ej. sin campos de parada)
    if stopped_time_s == 0:
        for i, p in enumerate(positions[:-1]):
            if p.get("stop"):
                tA = _as_dt(p.get("last_updated"))
                tB = _as_dt(positions[i+1].get("last_updated"))
                if tA and tB and tB > tA:
                    stopped_time_s += int((tB - tA).total_seconds())

    if stopped_time_s > total_time_s:
        stopped_time_s = total_time_s

    return {
        "positions_count": len(positions),
        "start_utc": t0.isoformat(),
        "end_utc": tn.isoformat(),
        "total_time_s": total_time_s,
        "distance_m": distance_m,
        "max_speed_mps": max_speed_mps,
        "average_speed_mps": average_speed_mps,
        "stops_count": len(stops),
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
        ll = _stop_center_latlon(p) or _latlon_from_pos(p)
        if not ll:
            continue
        z = _zone_of(float(ll[0]), float(ll[1]), zones) or ''
        if z and z != prev_zone:
            visits[z] = visits.get(z, 0) + 1
        prev_zone = z
    return visits

# --- estadísticas por zona ---
def _calc_zone_stats(positions, zones, expected_total_s=None):
    out = {}
    
    # Índice rápido de zonas por nombre para resolver el id
    zones_by_name = {str(z.get("name")): z for z in (zones or [])}
    
    def _ensure(name):
        if name not in out:
            zinfo = zones_by_name.get(name) or {}
            out[name] = {
                "zone": name,
                "id": zinfo.get("id"),
                "time_s": 0.0,     # parado + movimiento
                "visits": 0,
                "stops": 0,
                "distance_m": 0.0
            }
        return out[name]

    def _eff_seg_times(A, B):
        """Devuelve (tA_eff, tB_eff) excluyendo tiempo parado en los extremos."""
        tA = _as_dt(A.get("last_updated"))
        tB = _as_dt(B.get("last_updated"))
        if A.get("stop"):
            tA = _as_dt(A.get("stop_leave")) or _as_dt(A.get("stop_end")) or tA
        if B.get("stop"):
            tB = _as_dt(B.get("stop_start")) or tB
        return tA, tB

    if not positions:
        return []

    # 1) Paradas: sumar SOLO aquí el tiempo parado a su zona
    for p in positions:
        if not p.get("stop"):
            continue
        ll = _stop_center_latlon(p) or _latlon_from_pos(p)
        if not ll:
            continue
        zn = _zone_of(float(ll[0]), float(ll[1]), zones) or ''
        row = _ensure(zn)
        row["stops"] += 1

        dur = p.get("stop_duration_s")
        try:
            dur = float(dur) if dur is not None else 0.0
        except Exception:
            dur = 0.0
        row["time_s"] += dur

    # 2) Movimiento: repartir SOLO el tiempo en movimiento por zonas
    for i in range(1, len(positions)):
        A, B = positions[i - 1], positions[i]
        tA, tB = _eff_seg_times(A, B)
        if not tA or not tB:
            continue

        dt = (tB - tA).total_seconds()
        llA, llB = _latlon_from_pos(A), _latlon_from_pos(B)

        if not llA or not llB:
            continue
        lat1, lon1 = float(llA[0]), float(llA[1])
        lat2, lon2 = float(llB[0]), float(llB[1])

        seg_len = haversine(lat1, lon1, lat2, lon2)

        if seg_len < 0.5:
            # Siempre asigna distancia; asigna tiempo solo si dt > 0
            zn = _zone_of(lat1, lon1, zones) or (_zone_of(lat2, lon2, zones) or '')
            row = _ensure(zn)
            if dt > 0:
                row["time_s"] += dt
            row["distance_m"] += seg_len
            continue

        segs = _split_segment_by_zones(lat1, lon1, lat2, lon2, STEPS, zones)
        total_assigned_dt = 0.0
        total_assigned_len = 0.0

        for s in segs:
            aLat, aLon = _interp_latlon(lat1, lon1, lat2, lon2, s["t0"])
            bLat, bLon = _interp_latlon(lat1, lon1, lat2, lon2, s["t1"])
            sub_len = max(0.0, haversine(aLat, aLon, bLat, bLon))
            share = sub_len / seg_len if seg_len > 0 else 0.0
            sub_dt = (dt * share) if dt > 0 else 0.0

            zn = s["zone"] or ''
            row = _ensure(zn)
            if dt > 0:
                row["time_s"] += sub_dt
                total_assigned_dt += sub_dt
            row["distance_m"] += sub_len

            total_assigned_len += sub_len

        # Residuo de tiempo solo si hay tiempo efectivo
        if dt > 0:
            resid_dt = dt - total_assigned_dt
            if abs(resid_dt) > 1e-6:
                zn_last = (segs[-1]["zone"] or '') if segs else (_zone_of(lat2, lon2, zones) or '')
                _ensure(zn_last)["time_s"] += resid_dt            

        resid_len = seg_len - total_assigned_len
        if abs(resid_len) > 1e-6:
            zn_last = (segs[-1]["zone"] or '') if segs else (_zone_of(lat2, lon2, zones) or '')
            _ensure(zn_last)["distance_m"] += resid_len            


    # 3) Visitas por “runs”
    visits_map = _count_zone_visits_by_runs(positions, zones)
    for name, cnt in visits_map.items():
        _ensure(name)["visits"] = int(cnt)

    # 4) Cierre y ajuste global (cuadratura con summary)
    rows = []
    for name, agg in out.items():
        rows.append({
            "zone": name,
            "id": agg.get("id"),
            "time_s": int(round(agg["time_s"])),
            "visits": int(agg.get("visits", 0)),
            "stops": int(agg["stops"]),
            "distance_m": float(agg["distance_m"])
        })

    if expected_total_s is not None and rows:
        sum_s = sum(r["time_s"] for r in rows)
        delta = int(expected_total_s) - int(sum_s)
        if delta != 0:
            # preferimos ajustar a la zona '' (fuera de zonas); si no existe, a la última
            idx = next((i for i, r in enumerate(rows) if r["zone"] == ''), len(rows) - 1)
            rows[idx]["time_s"] = max(0, rows[idx]["time_s"] + delta)
            if abs(delta) > 2:
                _LOGGER.warning("Zone time adjusted by %d s to match summary total (was %d, target %d)",
                                delta, sum_s, expected_total_s)

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
        stop_time_s: int = int(STOP_TIME_S_FALLBACK)
        anti_spike_factor_k: float = float(ANTI_SPIKE_FACTOR_K)
        anti_spike_detour_ratio: float = float(ANTI_SPIKE_DETOUR_RATIO)
        anti_spike_radius: float = float(ANTI_SPIKE_RADIUS_FALLBACK)
        anti_spike_time: int = int(ANTI_SPIKE_TIME_S_FALLBACK)
        reentry_gap_s: int = int(REENTRY_GAP_S_FALLBACK)
        outside_gap_s: int = int(OUTSIDE_GAP_S_FALLBACK)
        max_gps_accuracy_m: float = float(MAX_GPS_ACCURACY_M_FALLBACK)
        max_speed_kmh: float = float(MAX_SPEED_KMH_FALLBACK)        

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

            # reentry_gap (int >= 0)
            try:
                reentry_gap_s = int(entry.options.get("reentry_gap", entry.data.get("reentry_gap", reentry_gap_s)))
                if reentry_gap_s < 0:
                    reentry_gap_s = 0
            except (TypeError, ValueError):
                pass
                
            # outside_gap (int >= 0)
            try:
                outside_gap_s = int(entry.options.get("outside_gap", entry.data.get("outside_gap", outside_gap_s)))
                if outside_gap_s < 0:
                    outside_gap_s = 0
            except (TypeError, ValueError):
                pass        

            # gps_accuracy (float >= 0)
            try:
                max_gps_accuracy_m = float(entry.options.get("gps_accuracy", entry.data.get("gps_accuracy", max_gps_accuracy_m)))
                if max_gps_accuracy_m < 0:
                    max_gps_accuracy_m = 0
            except (TypeError, ValueError):
                pass
                
            # max_speed (float >= 0)
            try:
                max_speed_kmh = float(entry.options.get("max_speed", entry.data.get("max_speed", max_speed_kmh)))
                if max_speed_kmh < 0:
                    max_speed_kmh = 0
            except (TypeError, ValueError):
                pass                     

            # anti_spike_factor_k (float >= 0)
            try:
                anti_spike_factor_k = float(entry.options.get("anti_spike_factor_k", entry.data.get("anti_spike_factor_k", anti_spike_factor_k)))
                if anti_spike_factor_k < 0:
                    anti_spike_factor_k = 0.0
            except (TypeError, ValueError):
                pass

            # anti_spike_detour_ratio (float >= 0)
            try:
                anti_spike_detour_ratio = float(entry.options.get("anti_spike_detour_ratio", entry.data.get("anti_spike_detour_ratio", anti_spike_detour_ratio)))
                if anti_spike_detour_ratio < 0:
                    anti_spike_detour_ratio = 0.0
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
            rec = get_recorder_instance(hass)
            history = await rec.async_add_executor_job(
                partial(
                    get_significant_states,
                    hass,
                    start_datetime_utc,
                    end_datetime_utc,
                    [source_device_id],
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
            states, 
            max_gps_accuracy_m=max_gps_accuracy_m,
            max_speed_kmh=max_speed_kmh, 
            min_distance=MIN_DISTANCE
        )            

        # Anti-spike 5 puntos por velocidad relativa (A→B, B→C→D, D→E)
        if anti_spike_radius > 0 and anti_spike_time > 0:
            positions = drop_c_spikes_relative_5pt(
                positions,
                factor_k=float(anti_spike_factor_k),
                min_detour_ratio=float(anti_spike_detour_ratio),
                max_bd_dt_s=int(anti_spike_time),          # puedes reutilizar tu opción existente
                min_leg_m=max(10.0, anti_spike_radius),    # coherente con tu escala espacial
                max_gps_accuracy_m=max_gps_accuracy_m
            )   

        # Paradas
        if stop_radius_m > 0 and stop_time_s > 0:
            positions = annotate_stops_and_collapse(
                positions,
                stop_radius_m=float(stop_radius_m),
                stop_time_s=int(stop_time_s),
                reentry_gap_s=int(reentry_gap_s),
                outside_gap_s=int(outside_gap_s),
                max_gps_accuracy_m=float(max_gps_accuracy_m),
                require_good_acc=REQUIRE_GOOD_ACC,               
            )

        # --- calcular resumen y zonas en servidor ---
        zones = _all_zones(hass)
        
        summary = _calc_summary(positions)
        zones_rows = _calc_zone_stats(positions, zones, expected_total_s=summary["total_time_s"])

        payload = {
            "positions": positions,
            "summary": summary,
            "zones": zones_rows
        }
        return self.json(payload)
