"""Devuelve los device_tracker de Home Assistant"""

import logging
from homeassistant.components.http import HomeAssistantView

from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class DevicesEndpoint(HomeAssistantView):
    """Punto de acceso a la API para obtener los device_tracker filtrados"""

    url = "/api/ha_tracker/devices"
    name = "api:ha_tracker/devices"
    requires_auth = True

    async def get(self, request):
        """Devuelve la lista de device_tracker con lat/lon válidas (> 0)"""

        hass = request.app["hass"]
        
        
        """Devuelve solo si es administrador o only_admin es false"""
        only_admin = False
        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:                             # Normalmente solo habrá una entrada
            entry = entries[0]
            only_admin = entry.options.get(
                "only_admin",
                entry.data.get("only_admin", False),
            )
        user = request["hass_user"]             
        if only_admin and (user is None or not user.is_admin):
            return self.json([])        
        
        
        devices = hass.states.async_all()
        device_data = []

        for device in devices:
            if not device.entity_id.startswith("device_tracker"):
                continue

            lat = device.attributes.get("latitude")
            lon = device.attributes.get("longitude")

            # Comprobamos que existan y que no sean 0 (ni texto ni número)
            try:
                lat_val = float(lat)
                lon_val = float(lon)
            except (TypeError, ValueError):
                # Si no se pueden convertir a número, los descartamos
                continue

            if lat_val == 0 or lon_val == 0:
                continue

            # ---- Datos adicionales opcionales ----
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
                if battery_sensor_state and battery_sensor_state.state.lower() != "unknown"
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
