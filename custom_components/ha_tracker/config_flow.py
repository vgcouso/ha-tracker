# ./custom_components/ha_tracker/config_flow.py

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback, HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.data_entry_flow import section
from homeassistant.helpers.network import get_url

DOMAIN = __package__.split(".")[-1]

# ---------------------------------------------------------------------------
#  Defaults y mínimos centralizados
# ---------------------------------------------------------------------------
DEFAULTS = {
    "update_interval": 10,
    "geocode_time": 30,
    "geocode_distance": 20,
    "stop_radius": 30,
    "stop_time": 300,
    "reentry_gap": 60,
    "outside_gap": 300,
    "gps_accuracy": 15,
    "max_speed": 150,
    "anti_spike_factor_k": 3.0,
    "anti_spike_detour_ratio": 1.7,
    "anti_spike_radius": 30,
    "anti_spike_time": 600,
    "only_admin": False,
    "enable_debug": False,
    "use_imperial": False,
}

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
    "anti_spike_factor_k": 1.5,
    "anti_spike_detour_ratio": 1.1,
    "anti_spike_radius": 0,
    "anti_spike_time": 0,
}


def _validate_minimums(flat: dict) -> dict[str, str]:
    """Devuelve un dict de errores con claves por campo si no cumple el mínimo numérico."""
    errors: dict[str, str] = {}
    for key, minv in MINIMUMS.items():
        if key in flat:
            try:
                value = float(flat[key])
            except (TypeError, ValueError):
                # Deja que voluptuous marque error de tipo; aquí no añadimos error.
                continue
            if value < float(minv):
                errors[key] = f"min_{key}"
    return errors


# ---------------------------------------------------------------------------
#  Cálculo de URLs de webhooks (locales a este archivo)
# ---------------------------------------------------------------------------
async def get_owntracks_webhook_url(hass: HomeAssistant) -> str | None:
    """Obtiene la URL de OwnTracks priorizando cloudhook, si existe."""
    entries = hass.config_entries.async_entries(domain="owntracks")
    if not entries:
        return None
    entry = entries[0]

    cloudhook = entry.data.get("cloudhook_url")
    if cloudhook:
        return cloudhook

    webhook_id = entry.data.get("webhook_id")
    if not webhook_id:
        return None

    base_url = get_url(hass, prefer_external=True)
    return f"{base_url}/api/webhook/{webhook_id}"


async def get_gpslogger_webhook_url(hass: HomeAssistant) -> str | None:
    """Obtiene la URL de GPSLogger priorizando cloudhook, si existe."""
    entries = hass.config_entries.async_entries(domain="gpslogger")
    if not entries:
        return None
    entry = entries[0]

    cloudhook = entry.data.get("cloudhook_url")
    if cloudhook:
        return cloudhook

    webhook_id = entry.data.get("webhook_id")
    if not webhook_id:
        return None

    base_url = get_url(hass, prefer_external=True)
    return f"{base_url}/api/webhook/{webhook_id}"


async def get_traccar_webhook_url(hass: HomeAssistant) -> str | None:
    """Obtiene la URL de Traccar priorizando cloudhook, si existe."""
    entries = hass.config_entries.async_entries(domain="traccar")
    if not entries:
        return None
    entry = entries[0]

    cloudhook = entry.data.get("cloudhook_url")
    if cloudhook:
        return cloudhook

    webhook_id = entry.data.get("webhook_id")
    if not webhook_id:
        return None

    base_url = get_url(hass, prefer_external=True)
    return f"{base_url}/api/webhook/{webhook_id}"


# ---------------------------------------------------------------------------
#  Config Flow
# ---------------------------------------------------------------------------
class HATrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        # --- Single instance guard ---
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        # URLs informativas para mostrarlas en el formulario
        own_url = await get_owntracks_webhook_url(self.hass) or "OwnTracks no configurado"
        gps_url = await get_gpslogger_webhook_url(self.hass) or "GPSLogger no configurado"
        trc_url = await get_traccar_webhook_url(self.hass) or "Traccar no configurado"

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

        anti_spike = vol.Schema({
            vol.Required("anti_spike_factor_k", default=DEFAULTS["anti_spike_factor_k"]): vol.All(vol.Coerce(float)),
            vol.Required("anti_spike_detour_ratio", default=DEFAULTS["anti_spike_detour_ratio"]): vol.All(vol.Coerce(float)),
            vol.Required("anti_spike_radius", default=DEFAULTS["anti_spike_radius"]): vol.All(vol.Coerce(int)),
            vol.Required("anti_spike_time", default=DEFAULTS["anti_spike_time"]): vol.All(vol.Coerce(int)),
        })

        # Solo URLs informativas (no se persisten)
        sources = vol.Schema({
            vol.Optional("owntracks_webhook_url", default=own_url): str,
            vol.Optional("gpslogger_webhook_url", default=gps_url): str,
            vol.Optional("traccar_webhook_url", default=trc_url): str,
        })

        data_schema = vol.Schema({
            vol.Required("general"): section(general, {"collapsed": True}),
            vol.Required("geocoding"): section(geocoding, {"collapsed": True}),
            vol.Required("stops"): section(stops, {"collapsed": True}),
            vol.Required("accuracy"): section(accuracy, {"collapsed": True}),
            vol.Required("anti_spike"): section(anti_spike, {"collapsed": True}),
            vol.Required("sources"): section(sources, {"collapsed": True}),
        })

        errors: dict[str, str] = {}

        if user_input is not None:
            # Aplana las secciones antes de validar/guardar
            flat: dict = {}
            for sec in ("general", "geocoding", "stops", "accuracy", "anti_spike", "sources"):
                flat.update(user_input.get(sec, {}))

            # No persistir los campos informativos
            flat.pop("owntracks_webhook_url", None)
            flat.pop("gpslogger_webhook_url", None)
            flat.pop("traccar_webhook_url", None)

            # Unique ID global (instancia única)
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()

            # Validaciones personalizadas (solo mínimos numéricos)
            errors.update(_validate_minimums(flat))

            if not errors:
                return self.async_create_entry(title="HA Tracker", data=flat)

            # Si hay errores, volver a mostrar formulario
            return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)

        # Primer render del formulario
        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)

    async def async_step_import(self, user_input):
        """Soporta importaciones (p.ej. YAML) evitando duplicados."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        # Reutiliza la lógica de user (incluye validaciones y aplanado)
        return await self.async_step_user(user_input)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        return HATrackerOptionsFlowHandler(config_entry)


# ---------------------------------------------------------------------------
#  Options Flow (un único formulario seccionado)
# ---------------------------------------------------------------------------
class HATrackerOptionsFlowHandler(config_entries.OptionsFlow):
    """Opciones agrupadas en secciones, con URLs informativas calculadas a demanda."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry
        self._opts = {
            **DEFAULTS,
            **(self._entry.data or {}),
            **(self._entry.options or {}),
        }
        self._webhook_urls: dict[str, str] = {
            "own": "OwnTracks no configurado",
            "gps": "GPSLogger no configurado",
            "trc": "Traccar no configurado",
        }

    async def async_step_init(self, user_input=None):
        # Refrescar URLs cada vez que se abre la pantalla de opciones
        self._webhook_urls["own"] = await get_owntracks_webhook_url(self.hass) or "OwnTracks no configurado"
        self._webhook_urls["gps"] = await get_gpslogger_webhook_url(self.hass) or "GPSLogger no configurado"
        self._webhook_urls["trc"] = await get_traccar_webhook_url(self.hass) or "Traccar no configurado"

        if user_input is not None:
            # Aplana secciones
            flat: dict = {}
            for sec in ("general", "geocoding", "stops", "accuracy", "anti_spike", "sources"):
                flat.update(user_input.get(sec, {}))

            # No persistir los campos informativos
            flat.pop("owntracks_webhook_url", None)
            flat.pop("gpslogger_webhook_url", None)
            flat.pop("traccar_webhook_url", None)

            errors: dict[str, str] = {}
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
        """Construye el esquema con secciones y defaults actuales (sin Range para permitir errores personalizados)."""
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

        anti_spike = vol.Schema({
            vol.Required("anti_spike_factor_k", default=self._opts["anti_spike_factor_k"]): vol.All(vol.Coerce(float)),
            vol.Required("anti_spike_detour_ratio", default=self._opts["anti_spike_detour_ratio"]): vol.All(vol.Coerce(float)),
            vol.Required("anti_spike_radius", default=self._opts["anti_spike_radius"]): vol.All(vol.Coerce(int)),
            vol.Required("anti_spike_time", default=self._opts["anti_spike_time"]): vol.All(vol.Coerce(int)),
        })

        # Solo URLs informativas (no se persisten)
        sources = vol.Schema({
            vol.Optional("owntracks_webhook_url", default=self._webhook_urls["own"]): str,
            vol.Optional("gpslogger_webhook_url", default=self._webhook_urls["gps"]): str,
            vol.Optional("traccar_webhook_url", default=self._webhook_urls["trc"]): str,
        })

        data_schema = {
            vol.Required("general"): section(general, {"collapsed": True}),
            vol.Required("geocoding"): section(geocoding, {"collapsed": True}),
            vol.Required("stops"): section(stops, {"collapsed": True}),
            vol.Required("accuracy"): section(accuracy, {"collapsed": True}),
            vol.Required("anti_spike"): section(anti_spike, {"collapsed": True}),
            vol.Required("sources"): section(sources, {"collapsed": True}),
        }
        return vol.Schema(data_schema)
