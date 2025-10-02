"""Devuelve los device_tracker de Home Assistant"""

import logging
import re
import unicodedata

from homeassistant.components.http import HomeAssistantView

DOMAIN = __package__.split(".")[-2]

_LOGGER = logging.getLogger(__name__)


def _slugify_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "", s)
    return s
    
    
def _normalize_battery(raw):
    """Devuelve batería redondeada 0–100 (int) o '' si no hay dato válido."""
    if raw is None:
        return ""
    s = str(raw).strip().lower()
    if s in ("unknown", "none", "unavailable", ""):
        return ""

    # Quita símbolo % y extrae el primer número válido
    s = s.replace("%", "")
    m = re.search(r'[-+]?\d*\.?\d+', s)
    if not m:
        return ""
    try:
        val = float(m.group())
    except (TypeError, ValueError):
        return ""

    # Si parece fracción (0–1), escálala a porcentaje
    if 0 < val <= 1:
        val *= 100.0

    # Limita y redondea
    val = max(0.0, min(100.0, val))
    return int(round(val))
    

class DevicesEndpoint(HomeAssistantView):
    """Punto de acceso a la API para obtener los device_tracker filtrados"""

    url = "/api/ha_tracker/devices"
    name = "api:ha_tracker/devices"
    requires_auth = True

    async def get(self, request):
        """Devuelve la lista de device_tracker con lat/lon válidas (dentro de rango) y excluyendo (0,0)"""

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
        
        
        devices = hass.states.async_all("device_tracker")
        device_data = []

        for device in devices:
            lat = device.attributes.get("latitude")
            lon = device.attributes.get("longitude")

            # Validamos rango y descartamos solo (0,0)
            try:
                lat_val = float(lat)
                lon_val = float(lon)
            except (TypeError, ValueError):
                # Si no se pueden convertir a número, los descartamos
                continue

            if not (-90.0 <= lat_val <= 90.0 and -180.0 <= lon_val <= 180.0):
                continue
            if lat_val == 0.0 and lon_val == 0.0:
                continue

            # ---- Datos adicionales opcionales ----
            name = device.attributes.get("friendly_name", "")
            friendly_name = _slugify_name(name)
            
            attrs = dict(device.attributes)
            
            # velocity -> speed (OwnTracks)
            if "velocity" in attrs and "speed" not in attrs:
                try:
                    # OwnTracks: km/h -> m/s
                    attrs["speed"] = round(float(attrs.pop("velocity")) / 3.6, 2)
                except (TypeError, ValueError):
                    # Si no es numérico, no tocamos nada
                    pass

            # Normaliza "speed": si es negativa, ponla a 0.0
            try:
                spd_val = float(attrs.get("speed"))
                if spd_val < 0:
                    attrs["speed"] = 0.0
            except (TypeError, ValueError):
                # Sin "speed" o no numérica → lo dejamos como esté
                pass


            # --- Batería: redondeo y normalización ---
            battery_level = _normalize_battery(
                device.attributes.get("battery_level")
                or device.attributes.get("battery_percentage")
                or device.attributes.get("battery_state")  # <- extra
                or device.attributes.get("battery")
                or device.attributes.get("bat")
            )

            # Si no viene en atributos, intenta con el sensor sensor.<friendly>_battery_level
            if battery_level == "" and friendly_name:
                battery_sensor_id = f"sensor.{friendly_name}_battery_level"
                batt_state = hass.states.get(battery_sensor_id)
                if batt_state:
                    battery_level = _normalize_battery(batt_state.state)

            # (Opcional) Actualiza también el atributo para que salga redondeado en "attributes"
            if battery_level != "":
                attrs["battery_level"] = battery_level
                attrs["battery_unit"] = "%"
                    

            device_data.append(
                {
                    "entity_id": device.entity_id,
                    "state": device.state,
                    "attributes": attrs,
                    "last_updated": device.last_updated.isoformat() if hasattr(device.last_updated, "isoformat") else device.last_updated,
                    "last_changed": device.last_changed.isoformat() if hasattr(device.last_changed, "isoformat") else device.last_changed,
                    "battery_level": battery_level,
                }
            )

        return self.json(device_data)

