import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from .const import DOMAIN

class HATrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Manejo de la configuración inicial de HA Tracker."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Paso inicial para la configuración de la integración."""
        errors = {}

        if user_input is not None:
            return self.async_create_entry(title="HA Tracker", data=user_input)

        data_schema = vol.Schema({
            vol.Required("update_interval", default=10): vol.All(vol.Coerce(int), vol.Range(min=10)),
            vol.Required("geocode_time", default=30): vol.All(vol.Coerce(int), vol.Range(min=30)),
            vol.Required("geocode_distance", default=20): vol.All(vol.Coerce(int), vol.Range(min=20)),
            vol.Required("enable_debug", default=False): bool,
        })

        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(entry):
        """Retorna el flujo de configuración de opciones."""
        return HATrackerOptionsFlowHandler(entry.entry_id)

class HATrackerOptionsFlowHandler(config_entries.OptionsFlow):
    """Manejo de opciones para HA Tracker."""

    def __init__(self, entry_id):
        """Inicializa el flujo de opciones sin almacenar config_entry directamente."""
        self.entry_id = entry_id

    async def async_step_init(self, user_input=None):
        """Pantalla de configuración de opciones."""
        config_entry = self.hass.config_entries.async_get_entry(self.entry_id)
        if config_entry is None:
            return self.async_abort(reason="config_entry_not_found")

        options = config_entry.options if config_entry.options else config_entry.data

        if user_input is not None:
            self.hass.config_entries.async_update_entry(config_entry, options=user_input)
            return self.async_create_entry(title="", data=user_input)

        options_schema = vol.Schema({
            vol.Required("update_interval", default=options.get("update_interval", 10)): vol.All(vol.Coerce(int), vol.Range(min=10)),
            vol.Required("geocode_time", default=options.get("geocode_time", 30)): vol.All(vol.Coerce(int), vol.Range(min=30)),
            vol.Required("geocode_distance", default=options.get("geocode_distance", 20)): vol.All(vol.Coerce(int), vol.Range(min=20)),
            vol.Required("enable_debug", default=options.get("enable_debug", False)): bool,
        })

        return self.async_show_form(
            step_id="init",
            data_schema=options_schema,
            errors={},
            description_placeholders={}  # Agregado para forzar carga de traducciones
        )
