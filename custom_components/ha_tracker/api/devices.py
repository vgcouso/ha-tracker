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
            
            #velocity en OwnTracks en vez de speed
            attrs = dict(device.attributes)
            if "velocity" in attrs and "speed" not in attrs:
                try:
                    # OwnTracks: km/h -> m/s
                    attrs["speed"] = round(float(attrs.pop("velocity")) / 3.6, 2)
                except (TypeError, ValueError):
                    # Si no es numérico, no tocamos nada
                    pass

            battery_level = ""
            attr_batt = device.attributes.get("battery_level")
            if attr_batt is not None and str(attr_batt).lower() != "unknown":
                battery_level = attr_batt
            else:
                battery_sensor_id = f"sensor.{friendly_name}_battery_level"
                batt_state = hass.states.get(battery_sensor_id)
                if batt_state and str(batt_state.state).lower() != "unknown":
                    battery_level = batt_state.state
                    

            device_data.append(
                {
                    "entity_id": device.entity_id,
                    "state": device.state,
                    "attributes": attrs,
                    "last_updated": device.last_updated,
                    "last_changed": device.last_changed,
                    "battery_level": battery_level,
                }
            )

        return self.json(device_data)
