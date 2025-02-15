"""Devuelve las posiciones entre fechas para una persona"""

import logging
import math

from dateutil.parser import isoparse
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.util import dt as dt_util

from ..const import MAX_DAYS_FOR_FILTER

_LOGGER = logging.getLogger(__name__)


# Función para calcular la distancia entre dos coordenadas usando Haversine
def haversine(lat1, lon1, lat2, lon2):
    """Calcula la distancia en metros entre dos puntos geográficos."""
    earth_radius_m = 6371000  # Radio de la Tierra en metros
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return earth_radius_m * c  # Distancia en metros


def validate_query_params(query):
    """Valida y extrae los parámetros de la consulta."""
    person_id = query.get("person_id")
    start_date = query.get("start_date")
    end_date = query.get("end_date")

    if not all([person_id, start_date, end_date]):
        return (
            None,
            None,
            None,
            {
                "error": "Missing parameters",
                "status_code": 400,
            },
        )

    return person_id, start_date, end_date, None


def validate_person(hass, person_id):
    """Valida que la persona y su dispositivo de rastreo sean válidos."""
    person_state = hass.states.get(person_id)
    if not person_state:
        return None, {
            "error": f"Person {person_id} not found",
            "status_code": 404,
        }

    source_device_id = person_state.attributes.get("source")
    if (
        not source_device_id
        or not isinstance(source_device_id, str)
        or not source_device_id.strip()
    ):
        return None, {
            "error": f"Not valid device_tracker for person {person_id}",
            "status_code": 400,
        }

    return source_device_id, None


def validate_dates(start_date, end_date):
    """Valida y convierte las fechas a UTC."""
    start_datetime = dt_util.parse_datetime(start_date)
    end_datetime = dt_util.parse_datetime(end_date)
    now = dt_util.utcnow()

    if start_datetime is None or end_datetime is None:
        return None, None, {"error": "Invalid date format", "status_code": 400}

    start_datetime_utc = dt_util.as_utc(start_datetime)
    end_datetime_utc = dt_util.as_utc(end_datetime)

    if start_datetime_utc >= end_datetime_utc:
        return (
            None,
            None,
            {"error": "start_date greater than end_date", "status_code": 400},
        )

    if start_datetime_utc >= now:
        return (
            None,
            None,
            {"error": "start_date must be in the past", "status_code": 400},
        )

    if start_datetime_utc >= end_datetime_utc or start_datetime_utc >= now:
        return (
            None,
            None,
            {
                "error": f"Days range not {MAX_DAYS_FOR_FILTER}",
                "status_code": 400,
            },
        )

    return start_datetime_utc, end_datetime_utc, None


def filter_positions(history):
    """Filtra posiciones basadas en distancia mínima y tiempo."""
    positions = []
    last_lat, last_lon = None, None
    last_seen_datetime = None  # Para evitar timestamps duplicados
    last_position = None  # Guardar la última posición

    for state in history:
        latitude = state.attributes.get("latitude")
        longitude = state.attributes.get("longitude")

        if latitude is None or longitude is None:
            continue

        # Convertir coordenadas a float
        latitude, longitude = float(latitude), float(longitude)

        # Obtener timestamp redondeado
        current_datetime = isoparse(state.last_updated.isoformat())
        current_datetime_rounded = current_datetime.replace(microsecond=0)

        # Guardar la última posición registrada antes del final
        last_position = {
            "entity_id": state.entity_id,
            "state": state.state,
            "attributes": state.attributes,
            "last_updated": state.last_updated.isoformat(),
            "last_changed": state.last_changed.isoformat(),
        }

        # Criterios de filtrado
        is_distance_ok = (
            last_lat is None
            or last_lon is None
            or haversine(last_lat, last_lon, latitude, longitude) > 20
        )
        is_no_previous_time = last_seen_datetime is None
        is_different_time = current_datetime_rounded != last_seen_datetime

        is_time_ok = is_no_previous_time or is_different_time

        if is_distance_ok and is_time_ok:
            positions.append(last_position)
            last_lat, last_lon = latitude, longitude
            last_seen_datetime = current_datetime_rounded

    # Asegurar que la última posición esté incluida
    if last_position and (
        not positions
        or (positions[-1]["last_updated"] != last_position["last_updated"])
    ):
        positions.append(last_position)

    return positions


# Endpoint para devolver posiciones filtradas por un usuario y rango de tiempo
class FilteredPositionsEndpoint(HomeAssistantView):
    """Obtener posiciones filtradas de un usuario entre fechas"""

    url = "/api/ha_tracker/filtered_positions"
    name = "api:ha_tracker/filtered_positions"
    requires_auth = True

    async def get(self, request):
        """Devuelve posiciones filtradas de un usuario entre fechas"""

        hass = request.app["hass"]
        query = request.query

        # Validar parámetros
        person_id, start_date, end_date, error = validate_query_params(query)
        if error:
            return self.json(error, status_code=error["status_code"])

        # Validar persona y dispositivo
        source_device_id, error = validate_person(hass, person_id)
        if error:
            return self.json(error, status_code=error["status_code"])

        # Validar fechas
        start_datetime_utc, end_datetime_utc, error = validate_dates(
            start_date, end_date
        )
        if error:
            return self.json(error, status_code=error["status_code"])

        # Obtener historial usando get_significant_states
        try:
            history = await hass.async_add_executor_job(
                get_significant_states,
                hass,
                start_datetime_utc,
                end_datetime_utc,
                [source_device_id],
            )
        except (OSError, ValueError, KeyError) as e:
            return self.json(
                {"error": f"Error with history: {str(e)}"}, status_code=500
            )

        if not history or source_device_id not in history:
            return self.json([])

        # Filtrar posiciones
        positions = filter_positions(history[source_device_id])

        return self.json(positions)
