"""Devuelve los device_tracker de Home Assistant"""

import logging

from homeassistant.components.http import HomeAssistantView

_LOGGER = logging.getLogger(__name__)


class DevicesEndpoint(HomeAssistantView):
    """Punto de acceso a la API para obtener los device_tracker"""

    url = "/api/ha_tracker/devices"
    name = "api:ha_tracker/devices"
    requires_auth = True

    async def get(self, request):
        """Devuelve la lista de dispositivos rastreados (device_tracker)"""

        hass = request.app["hass"]
        devices = hass.states.async_all()

        device_data = []

        for device in devices:
            if (
                device.entity_id.startswith("device_tracker")
                and device.attributes.get("latitude")
                and device.attributes.get("longitude")
            ):

                name = device.attributes.get("friendly_name", "")
                friendly_name = name.lower().replace(" ", "_")

                sensor_id = f"sensor.{friendly_name}_geocoded_location"
                sensor_state = hass.states.get(sensor_id)
                location = (
                    sensor_state.state
                    if sensor_state and sensor_state.state.lower() != "unknown"
                    else ""
                )

                battery_sensor_id = f"sensor.{friendly_name}_battery_level"
                battery_sensor_state = hass.states.get(battery_sensor_id)
                battery_level = (
                    battery_sensor_state.state
                    if battery_sensor_state
                    and battery_sensor_state.state.lower() != "unknown"
                    else ""
                )

                device_data.append(
                    {
                        "entity_id": device.entity_id,
                        "state": device.state,
                        "attributes": device.attributes,
                        "last_updated": device.last_updated,
                        "last_changed": device.last_changed,
                        "geocoded_location": location,
                        "battery_level": battery_level,
                    }
                )

        return self.json(device_data)
