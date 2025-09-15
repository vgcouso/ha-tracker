import logging
from datetime import timedelta
from functools import partial
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder.history import (
    state_changes_during_period,
    get_significant_states,
)
from homeassistant.util import dt as dt_util
from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

NEAREST_WINDOW_MINUTES = 30  # ventana ±X min

def _parse_date_to_utc(date_str):
    dt = dt_util.parse_datetime(date_str)
    if dt is None:
        return None, {"error":"Invalid date format", "status_code":400}
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
    return dt_util.as_utc(dt), None

def _validate_query(q):
    person_id = q.get("person_id")
    date_str  = q.get("date")
    if not person_id or not date_str:
        return None, None, {"error":"Missing parameters (need person_id and date)", "status_code":400}
    return person_id, date_str, None

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


class NearestPositionEndpoint(HomeAssistantView):
    url = "/api/ha_tracker/nearest_position"
    name = "api:ha_tracker/nearest_position"
    requires_auth = True

    async def get(self, request):
        try:
            hass = request.app["hass"]

            # Respeta only_admin
            only_admin = False
            entries = hass.config_entries.async_entries(DOMAIN)
            if entries:
                entry = entries[0]
                only_admin = entry.options.get("only_admin", entry.data.get("only_admin", False))
            user = request["hass_user"]
            if only_admin and (user is None or not user.is_admin):
                return self.json({})

            # --- Query ---
            person_id = request.query.get("person_id")
            date_str  = request.query.get("date")
            if not person_id or not date_str:
                return self.json({"error":"Missing parameters (need person_id and date)"}, status_code=400)

            source_device_id, err = validate_person(hass, person_id)
            if err:
                return self.json(err, status_code=err["status_code"])

            target_utc = dt_util.parse_datetime(date_str)
            if target_utc is None:
                return self.json({"error":"Invalid date format"}, status_code=400)
            if target_utc.tzinfo is None:
                target_utc = target_utc.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
            target_utc = dt_util.as_utc(target_utc)

            window = timedelta(minutes=NEAREST_WINDOW_MINUTES)
            start_utc = target_utc - window
            end_utc   = target_utc + window
            now_utc = dt_util.utcnow()
            if end_utc > now_utc:
                end_utc = now_utc
            if start_utc >= end_utc:
                return self.json({})

            _LOGGER.debug("nearest_position: person=%s device=%s window=[%s..%s] target=%s",
                          person_id, source_device_id, start_utc, end_utc, target_utc)

            # --- Historial (intento principal) ---
            states = []
            try:
                hist = await hass.async_add_executor_job(
                    partial(
                        state_changes_during_period,
                        hass,
                        start_utc,
                        end_utc,
                        entity_id=source_device_id,            # <- singular, string
                        include_start_time_state=True,
                        significant_changes_only=False,
                        # no_attributes omitido por compatibilidad
                    )
                )
                # Algunas versiones devuelven dict; otras podrían devolver lista
                if isinstance(hist, dict):
                    states = hist.get(source_device_id, [])
                elif isinstance(hist, list):
                    states = hist
                else:
                    states = hist or []
            except Exception as e:
                _LOGGER.exception("nearest_position: error en state_changes_during_period: %s", e)
                states = []

            # --- Fallback ---
            if not states:
                try:
                    sig = await hass.async_add_executor_job(
                        partial(
                            get_significant_states,
                            hass,
                            start_utc,
                            end_utc,
                            [source_device_id],
                            include_start_time_state=True,
                        )
                    )
                    if isinstance(sig, dict):
                        states = sig.get(source_device_id, [])
                except Exception as e:
                    _LOGGER.exception("nearest_position: error en get_significant_states: %s", e)
                    return self.json({"error": f"Error with history: {e}"}, status_code=500)

            _LOGGER.debug("nearest_position: states_count=%s", len(states) if states else 0)

            if not states:
                return self.json({})

            # --- Selección más cercana ---
            target_sec = target_utc.replace(microsecond=0)
            best = None
            best_diff = None

            for s in states:
                try:
                    lat = s.attributes.get("latitude")
                    lon = s.attributes.get("longitude")
                    if lat is None or lon is None:
                        continue
                    t = dt_util.as_utc(s.last_updated).replace(microsecond=0)
                    diff = abs((t - target_sec).total_seconds())
                    if (best_diff is None) or (diff < best_diff) or (diff == best_diff and best and t > dt_util.as_utc(best.last_updated)):
                        best = s
                        best_diff = diff
                except Exception as e:
                    _LOGGER.debug("nearest_position: saltando estado inválido: %s", e)
                    continue

            if best is None:
                return self.json({})

            attrs = dict(best.attributes)
            if "velocity" in attrs and "speed" not in attrs:
                try:
                    attrs["speed"] = round(float(attrs.pop("velocity")) / 3.6, 2)
                except Exception:
                    pass

            return self.json({
                "entity_id": best.entity_id,
                "state": best.state,
                "attributes": attrs,
                "last_updated": best.last_updated.isoformat(),
                "last_changed": best.last_changed.isoformat(),
            })

        except Exception as e:
            # Captura cualquier bug residual para no devolver 500 "vacío"
            _LOGGER.exception("nearest_position: excepción no controlada: %s", e)
            return self.json({"error": f"Unhandled error: {e}"}, status_code=500)
