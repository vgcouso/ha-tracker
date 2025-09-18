"""Manejo de la configuración de HA Tracker (con secciones en un solo paso)."""

import re
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.config_entries import ConfigEntry
from homeassistant.data_entry_flow import section 

from .const import DOMAIN

DEFAULTS = {
    "update_interval": 10,
    "geocode_time": 30,
    "geocode_distance": 20,
    "stop_radius": 25,
    "stop_time": 300,
    "reentry_gap": 60,
    "outside_gap": 300,
    "anti_spike_radius": 20,
    "anti_spike_time": 300,
    "only_admin": False,
    "enable_debug": False,
    "use_imperial": False,
    "owntracks": "owntracks",
    "gpslogger": "gpslogger",
}

_IDENT_REGEX = re.compile(r"^[a-z0-9]+$")

def _clean_str(v: str) -> str:
    return (v or "").strip()

def _validate_identifiers(data: dict) -> dict:
    errors: dict[str, str] = {}
    gps = _clean_str(data.get("gpslogger"))
    own = _clean_str(data.get("owntracks"))
    if not _IDENT_REGEX.fullmatch(gps):
        errors["gpslogger"] = "invalid_identifier"
    if not _IDENT_REGEX.fullmatch(own):
        errors["owntracks"] = "invalid_identifier"
    if not errors and gps == own:
        errors["base"] = "identifiers_must_differ"
    data["gpslogger"] = gps
    data["owntracks"] = own
    return errors


class HATrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        data_schema = vol.Schema(
            {
                vol.Required("update_interval", default=DEFAULTS["update_interval"]):
                    vol.All(vol.Coerce(int), vol.Range(min=10)),
                vol.Required("geocode_time", default=DEFAULTS["geocode_time"]):
                    vol.All(vol.Coerce(int), vol.Range(min=10)),
                vol.Required("geocode_distance", default=DEFAULTS["geocode_distance"]):
                    vol.All(vol.Coerce(int), vol.Range(min=20)),
                vol.Required("stop_radius", default=DEFAULTS["stop_radius"]):
                    vol.All(vol.Coerce(int), vol.Range(min=0)),
                vol.Required("stop_time", default=DEFAULTS["stop_time"]):
                    vol.All(vol.Coerce(int), vol.Range(min=0)),
                vol.Required("reentry_gap", default=DEFAULTS["reentry_gap"]):
                    vol.All(vol.Coerce(int), vol.Range(min=0)),
                vol.Required("outside_gap", default=DEFAULTS["outside_gap"]):
                    vol.All(vol.Coerce(int), vol.Range(min=0)),
                #vol.Required("anti_spike_radius", default=DEFAULTS["anti_spike_radius"]):
                #    vol.All(vol.Coerce(int), vol.Range(min=0)),
                #vol.Required("anti_spike_time", default=DEFAULTS["anti_spike_time"]):
                #    vol.All(vol.Coerce(int), vol.Range(min=0)),
                vol.Required("only_admin", default=DEFAULTS["only_admin"]): bool,
                vol.Required("enable_debug", default=DEFAULTS["enable_debug"]): bool,
                vol.Required("use_imperial", default=DEFAULTS["use_imperial"]): bool,
                vol.Required("owntracks", default=DEFAULTS["owntracks"]): str,
                vol.Required("gpslogger", default=DEFAULTS["gpslogger"]): str,
            }
        )
        if user_input is not None:
            errors = _validate_identifiers(user_input)
            if not errors:
                return self.async_create_entry(title="HA Tracker", data=user_input)
        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        return HATrackerOptionsFlowHandler(config_entry)


class HATrackerOptionsFlowHandler(config_entries.OptionsFlow):
    """Opciones agrupadas en secciones en un único formulario."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self.config_entry = config_entry
        self._opts = {**DEFAULTS, **(config_entry.data or {}), **(config_entry.options or {})}

    async def async_step_init(self, user_input=None):
        # Si envían el formulario, aplanamos y guardamos
        if user_input is not None:
            flat: dict = {}
            for sec in ("general", "geocoding", "stops", "anti_spike", "sources"):
                flat.update(user_input.get(sec, {}))
            errors = _validate_identifiers(flat)
            if errors:
                # Volvemos a pintar el formulario con los errores
                return self.async_show_form(
                    step_id="init",
                    data_schema=self._build_schema(),
                    errors=errors,
                )
            return self.async_create_entry(title="", data=flat)

        # Primera carga del formulario
        return self.async_show_form(
            step_id="init",
            data_schema=self._build_schema(),
            errors={},
        )

    def _build_schema(self) -> vol.Schema:
        """Construye el esquema con secciones y defaults desde self._opts."""
        general = vol.Schema({
            vol.Required("update_interval", default=self._opts["update_interval"]):
                vol.All(vol.Coerce(int), vol.Range(min=10)),
            vol.Required("only_admin", default=self._opts["only_admin"]): bool,
            vol.Required("enable_debug", default=self._opts["enable_debug"]): bool,
            vol.Required("use_imperial", default=self._opts["use_imperial"]): bool,
        })

        geocoding = vol.Schema({
            vol.Required("geocode_time", default=self._opts["geocode_time"]):
                vol.All(vol.Coerce(int), vol.Range(min=10)),
            vol.Required("geocode_distance", default=self._opts["geocode_distance"]):
                vol.All(vol.Coerce(int), vol.Range(min=20)),
        })

        stops = vol.Schema({
            vol.Required("stop_radius", default=self._opts["stop_radius"]):
                vol.All(vol.Coerce(int), vol.Range(min=0)),
            vol.Required("stop_time", default=self._opts["stop_time"]):
                vol.All(vol.Coerce(int), vol.Range(min=0)),
            vol.Required("reentry_gap", default=self._opts["reentry_gap"]):
                vol.All(vol.Coerce(int), vol.Range(min=0)),
            vol.Required("outside_gap", default=self._opts["outside_gap"]):
                vol.All(vol.Coerce(int), vol.Range(min=0)),
        })

        #anti_spike = vol.Schema({
        #    vol.Required("anti_spike_radius", default=self._opts["anti_spike_radius"]):
        #        vol.All(vol.Coerce(int), vol.Range(min=0)),
        #    vol.Required("anti_spike_time", default=self._opts["anti_spike_time"]):
        #        vol.All(vol.Coerce(int), vol.Range(min=0)),
        #})

        sources = vol.Schema({
            vol.Required("owntracks", default=self._opts["owntracks"]): str,
            vol.Required("gpslogger", default=self._opts["gpslogger"]): str,
        })

        data_schema = {
            vol.Required("general"): section(general, {"collapsed": True}),
            vol.Required("geocoding"): section(geocoding, {"collapsed": True}),
            vol.Required("stops"): section(stops, {"collapsed": True}),
            #vol.Required("anti_spike"): section(anti_spike, {"collapsed": True}),
            vol.Required("sources"): section(sources, {"collapsed": True}),
        }
        return vol.Schema(data_schema)
