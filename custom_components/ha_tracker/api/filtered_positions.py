import logging
from datetime import timedelta
from homeassistant.util import dt as dt_util
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder.history import get_significant_states

_LOGGER = logging.getLogger(__name__)

MAX_DAYS = 30

class FilteredPositionsEndpoint(HomeAssistantView):
    url = "/api/ha_tracker/filtered_positions"
    name = "api:ha_tracker/filtered_positions"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        query = request.query
        person_id = query.get("person_id")
        start_date = query.get("start_date")
        end_date = query.get("end_date")

        if not all([person_id, start_date, end_date]):
            return self.json({"error": "Missing parameters"}, status_code=400)

        person_state = hass.states.get(person_id)
        if not person_state:
            return self.json({"error": f"Person {person_id} not found"}, status_code=404)

        source_device_id = person_state.attributes.get("source")
        if not source_device_id:
            return self.json({"error": f"Person {person_id} does not have a valid 'source' device_tracker"}, status_code=400)

        start_datetime_utc = dt_util.as_utc(dt_util.parse_datetime(start_date))
        end_datetime_utc = dt_util.as_utc(dt_util.parse_datetime(end_date))

        if (end_datetime_utc - start_datetime_utc) > timedelta(days=MAX_DAYS):
            return self.json({"error": f"The date range cannot be greater than {MAX_DAYS} days."}, status_code=400)

        history = await hass.async_add_executor_job(
            get_significant_states,
            hass,
            start_datetime_utc,
            end_datetime_utc,
            [source_device_id]
        )

        if not history or source_device_id not in history:
            return self.json([])

        return self.json(history[source_device_id])
