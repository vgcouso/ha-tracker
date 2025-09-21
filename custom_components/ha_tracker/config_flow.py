from __future__ import annotations

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
    "gps_accuracy": 15,
    "max_speed": 150,
    "anti_spike_radius": 20,
    "anti_spike_time": 300,
    "only_admin": False,
    "enable_debug": False,
    "use_imperial": False,
    "owntracks": "owntracks",
    "gpslogger": "gpslogger",
}

# Mínimos centralizados
MINIMUMS = {
    "update_interval": 10,
    "geocode_time": 10,
    "geocode_distance": 20,
    "stop_radius": 0.0,
    "stop_time": 0,
    "reentry_gap": 0,
    "outside_gap": 0,
    "gps_accuracy": 10.0,
    "max_speed": 100.0,
    # "anti_spike_radius": 0,
    # "anti_spike_time": 0,
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
        errors["base"] = "identifiers_must_differ"  # <- CLAVE CORRECTA
        # Alternativa: asociarlo a un campo:
        # errors["gpslogger"] = "identifiers_must_differ"
    data["gpslogger"] = gps
    data["owntracks"] = own
    return errors


def _validate_minimums(flat: dict) -> dict:
    """Devuelve un dict de errores con claves por campo si no cumple el mínimo."""
    errors: dict[str, str] = {}
    for key, minv in MINIMUMS.items():
        if key in flat:
            try:
                value = float(flat[key])
            except (TypeError, ValueError):
                # Si falla la conversión, deja que voluptuous marque tipo; aquí ignoramos.
                continue
            if value < float(minv):
                errors[key] = f"min_{key}"
    return errors


class HATrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        # --- Single instance guard ---
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        # ---- Construcción de secciones (instalación con grupos) ----
        general = vol.Schema({
            vol.Required("update_interval", default=DEFAULTS["update_interval"]): vol.All(vol.Coerce(int)),
            vol.Required("only_admin", default=DEFAULTS["only_admin"]): bool,
            vol.Required("enable_debug", default=DEFAULTS["enable_debug"]): bool,
            vol.Required("use_imperial", default=DEFAULTS["use_imperial"]): bool,
        })

        geocoding = vol.Schema({
            vol.Required("geocode_time", default=DEFAULTS["geocode_time"]): vol.All(vol.Coerce(int)),
            vol.Required("geocode_distance", default=DEFAULTS["geocode_distance"]): vol.All(vol.Coerce(int)),
        })

        stops = vol.Schema({
            vol.Required("stop_radius", default=DEFAULTS["stop_radius"]): vol.All(vol.Coerce(float)),
            vol.Required("stop_time", default=DEFAULTS["stop_time"]): vol.All(vol.Coerce(int)),
            vol.Required("reentry_gap", default=DEFAULTS["reentry_gap"]): vol.All(vol.Coerce(int)),
            vol.Required("outside_gap", default=DEFAULTS["outside_gap"]): vol.All(vol.Coerce(int)),
        })

        accuracy = vol.Schema({
            vol.Required("gps_accuracy", default=DEFAULTS["gps_accuracy"]): vol.All(vol.Coerce(float)),
            vol.Required("max_speed", default=DEFAULTS["max_speed"]): vol.All(vol.Coerce(float)),
        })

        # anti_spike = vol.Schema({
        #     vol.Required("anti_spike_radius", default=DEFAULTS["anti_spike_radius"]): vol.All(vol.Coerce(int)),
        #     vol.Required("anti_spike_time", default=DEFAULTS["anti_spike_time"]): vol.All(vol.Coerce(int)),
        # })

        sources = vol.Schema({
            vol.Required("owntracks", default=DEFAULTS["owntracks"]): str,
            vol.Required("gpslogger", default=DEFAULTS["gpslogger"]): str,
        })

        data_schema = vol.Schema({
            vol.Required("general"): section(general, {"collapsed": True}),
            vol.Required("geocoding"): section(geocoding, {"collapsed": True}),
            vol.Required("stops"): section(stops, {"collapsed": True}),
            vol.Required("accuracy"): section(accuracy, {"collapsed": True}),
            # vol.Required("anti_spike"): section(anti_spike, {"collapsed": True}),
            vol.Required("sources"): section(sources, {"collapsed": True}),
        })

        errors: dict[str, str] = {}

        if user_input is not None:
            # Aplana las secciones antes de validar/guardar
            flat: dict = {}
            for sec in ("general", "geocoding", "stops", "accuracy", "sources"):
                flat.update(user_input.get(sec, {}))

            # --- Single instance por unique_id (doble seguridad) ---
            await self.async_set_unique_id(DOMAIN)  # Fija unique_id global
            self._abort_if_unique_id_configured()   # Aborta con reason="already_configured" si ya existe

            # Validaciones personalizadas
            errors.update(_validate_identifiers(flat))
            errors.update(_validate_minimums(flat))

            if not errors:
                return self.async_create_entry(title="HA Tracker", data=flat)

            # Si hay errores, vuelve a mostrar el formulario seccionado
            return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)

        # Primer render del formulario seccionado
        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)
    
    async def async_step_import(self, user_input):
        """Soporta importaciones (p.ej., desde YAML) evitando duplicados."""
        # Mismo guard de instancia única
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        # Unique ID global (doble seguridad)
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        # Si llega configuración importada, crea la entrada directamente.
        # Si quieres revalidar/normalizar como en user, puedes reutilizar la lógica:
        return await self.async_step_user(user_input)
    
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
        if user_input is not None:
            # Aplana secciones
            flat: dict = {}
            for sec in ("general", "geocoding", "stops", "accuracy", "sources"):
                flat.update(user_input.get(sec, {}))

            errors: dict[str, str] = {}
            errors.update(_validate_identifiers(flat))
            errors.update(_validate_minimums(flat))

            if errors:
                return self.async_show_form(
                    step_id="init",
                    data_schema=self._build_schema(),
                    errors=errors,
                )
            return self.async_create_entry(title="", data=flat)

        return self.async_show_form(
            step_id="init",
            data_schema=self._build_schema(),
            errors={},
        )

    def _build_schema(self) -> vol.Schema:
        """Construye el esquema con secciones y defaults desde self._opts.

        NOTA: sin Range(min=...) para permitir errores personalizados.
        """
        general = vol.Schema({
            vol.Required("update_interval", default=self._opts["update_interval"]): vol.All(vol.Coerce(int)),
            vol.Required("only_admin", default=self._opts["only_admin"]): bool,
            vol.Required("enable_debug", default=self._opts["enable_debug"]): bool,
            vol.Required("use_imperial", default=self._opts["use_imperial"]): bool,
        })

        geocoding = vol.Schema({
            vol.Required("geocode_time", default=self._opts["geocode_time"]): vol.All(vol.Coerce(int)),
            vol.Required("geocode_distance", default=self._opts["geocode_distance"]): vol.All(vol.Coerce(int)),
        })

        stops = vol.Schema({
            vol.Required("stop_radius", default=self._opts["stop_radius"]): vol.All(vol.Coerce(float)),
            vol.Required("stop_time", default=self._opts["stop_time"]): vol.All(vol.Coerce(int)),
            vol.Required("reentry_gap", default=self._opts["reentry_gap"]): vol.All(vol.Coerce(int)),
            vol.Required("outside_gap", default=self._opts["outside_gap"]): vol.All(vol.Coerce(int)),
        })

        accuracy = vol.Schema({
            vol.Required("gps_accuracy", default=self._opts["gps_accuracy"]): vol.All(vol.Coerce(float)),
            vol.Required("max_speed", default=self._opts["max_speed"]): vol.All(vol.Coerce(float)),
        })

        # anti_spike = vol.Schema({
        #     vol.Required("anti_spike_radius", default=self._opts["anti_spike_radius"]): vol.All(vol.Coerce(int)),
        #     vol.Required("anti_spike_time", default=self._opts["anti_spike_time"]): vol.All(vol.Coerce(int)),
        # })

        sources = vol.Schema({
            vol.Required("owntracks", default=self._opts["owntracks"]): str,
            vol.Required("gpslogger", default=self._opts["gpslogger"]): str,
        })

        data_schema = {
            vol.Required("general"): section(general, {"collapsed": True}),
            vol.Required("geocoding"): section(geocoding, {"collapsed": True}),
            vol.Required("stops"): section(stops, {"collapsed": True}),
            vol.Required("accuracy"): section(accuracy, {"collapsed": True}),
            # vol.Required("anti_spike"): section(anti_spike, {"collapsed": True}),
            vol.Required("sources"): section(sources, {"collapsed": True}),
        }
        return vol.Schema(data_schema)
