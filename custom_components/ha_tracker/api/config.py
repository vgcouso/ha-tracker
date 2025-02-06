import logging
from homeassistant.components.http import HomeAssistantView
from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class ConfigEndpoint(HomeAssistantView):
    url = "/api/ha_tracker/config"
    name = "api:ha_tracker/config"
    requires_auth = True

    async def get(self, request):
        """Devuelve la configuración guardada en config_entries."""
        hass = request.app["hass"]

        config_entry = next((entry for entry in hass.config_entries.async_entries(DOMAIN)), None)
        if not config_entry:
            return self.json({"error": "Configuración no encontrada"}, status_code=404)

        config = {**config_entry.data, **config_entry.options} if config_entry.options else config_entry.data

        return self.json({
            "update_interval": config.get("update_interval", 10),
            "enable_debug": config.get("enable_debug", False),
            "geocode_time": config.get("geocode_time", 30),
            "geocode_distance": config.get("geocode_distance", 20),
        })
