"""Manejo de las zonas de HA Tracker"""

import json
import logging
import os
import re
from datetime import datetime

import aiofiles
from homeassistant.components.http import HomeAssistantView

from ..const import ZONES_FILE
from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class ZonesAPI(HomeAssistantView):
    """Punto de acceso a la API para manejar zonas"""

    url = "/api/ha_tracker/zones"
    name = "api:ha_tracker/zones"
    requires_auth = True

    async def get(self, request):
        """Devuelve las zonas"""

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
            
        
        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        custom_zones = await read_zones_file(zones_path)

        # Obtener zonas de Home Assistant
        ha_zones = [
            {
                "id": state.entity_id.split("zone.")[1],
                "name": state.attributes.get("friendly_name", ""),
                "latitude": state.attributes.get("latitude"),
                "longitude": state.attributes.get("longitude"),
                "radius": state.attributes.get("radius", 100),
                "icon": state.attributes.get("icon", "mdi:map-marker"),
                "passive": state.attributes.get("passive", False),
                "custom": False,
            }
            for state in hass.states.async_all()
            if state.entity_id.startswith("zone.")
        ]

        # Agregar solo zonas de HA que no estén en custom_zones
        for ha_zone in ha_zones:
            if not any(zone["id"] == ha_zone["id"] for zone in custom_zones):
                custom_zones.append(ha_zone)

        return self.json(custom_zones)

    async def post(self, request):
        """Crear una nueva zona."""

        user = request["hass_user"]
        if not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()

        # Generate ID if not present
        if "id" not in data or not data["id"].strip():
            name = data["name"]
            timestamp = int(datetime.now().timestamp() * 1000)
            sanitized_name = sanitize_id(name)  # Sanitize the name
            data["id"] = f"{sanitized_name}_{timestamp}"

        # Validar zona
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json(
                {"error": f"Skipping invalid zone: {data}. Reason: {error}"},
                status_code=400,
            )

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        # Evitar duplicados
        if any(zone["id"] == data["id"] for zone in zones):
            return self.json({"error": "Zone already exists"}, status_code=400)

        data["custom"] = True  # Solo las creadas manualmente son "custom"
        zones.append(data)

        # Guardar en el archivo
        await write_zones_file(zones_path, zones)

        await register_zones(hass)

        msg = {"success": True, "message": "Zone created", "id": data["id"]}
        return self.json(msg)

    async def delete(self, request):
        """Eliminar una zona."""

        user = request["hass_user"]
        if not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")

        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        # Verificar existencia
        filtered_zones = (zone for zone in zones if zone["id"] == zone_id)
        target_zone = next(filtered_zones, None)

        if not target_zone or not target_zone.get("custom", False):
            error_msg = {"error": "Zone not found or cannot be deleted"}
            return self.json(error_msg, status_code=404)

        updated_zones = [zone for zone in zones if zone["id"] != zone_id]

        # Guardar cambios
        await write_zones_file(zones_path, updated_zones)
        await register_zones(hass)

        error_msg = {"success": True, "message": "Zone deleted successfully"}
        return self.json(error_msg)

    async def put(self, request):
        """Actualizar una zona existente."""

        user = request["hass_user"]
        if not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")

        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        # Validar la zona
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json(
                {"error": f"Skipping invalid zone: {data}. Reason: {error}"},
                status_code=400,
            )

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        for zone in zones:
            if zone["id"] == zone_id and zone.get("custom", False):
                zone.update(data)
                await write_zones_file(zones_path, zones)
                await register_zones(hass)
                return self.json(
                    {"success": True, "message": "Zone updated successfully"}
                )

        return self.json(
            {"error": "Zone not found or cannot be updated"}, status_code=404
        )


async def unregister_zones(hass):
    """Eliminar zonas de Home Assistant."""

    zones_path = os.path.join(hass.config.path(), ZONES_FILE)

    if not os.path.exists(zones_path):
        _LOGGER.warning("Zones file not found")
        return

    try:
        # Eliminar solo zonas personalizadas
        for state in hass.states.async_all():
            if state.entity_id.startswith("zone.") and state.attributes.get(
                "custom", False
            ):
                hass.states.async_remove(state.entity_id)
    except (OSError, ValueError, KeyError) as e:
        _LOGGER.error("Error unregistering zones: %s", e)

async def register_zones(hass):
    """Registrar zonas en Home Assistant."""

    zones_path = os.path.join(hass.config.path(), ZONES_FILE)

    if not os.path.exists(zones_path):
        _LOGGER.warning("Zones file not found, creating empty zones file.")
        await write_zones_file(zones_path, [])
        return

    try:
        zones = await read_zones_file(zones_path)

        # Desregistrar zonas antes de volver a registrarlas
        await unregister_zones(hass)

        for zone in zones:
            is_valid, error = validate_zone(zone)
            if not is_valid:
                _LOGGER.warning("Invalid zone '%s'", zone.get("id", "unknown"))
                _LOGGER.warning("Error details: %s", error)
                continue

            try:
                # Registrar la zona personalizada
                hass.states.async_set(
                    f"zone.{sanitize_id(zone['id'])}",
                    "active",
                    {
                        "friendly_name": zone["name"],
                        "latitude": zone["latitude"],
                        "longitude": zone["longitude"],
                        "radius": zone["radius"],
                        "icon": zone.get("icon", "mdi:map-marker"),
                        "passive": zone.get("passive", False),
                        "custom": True,
                    },
                )
            except (OSError, ValueError, KeyError) as e:
                _LOGGER.exception("Failed to register %s: %s", zone["id"], e)

    except (OSError, ValueError, KeyError) as e:
        _LOGGER.error("Error registering zones: %s", e)


async def read_zones_file(zones_path):
    """Leer y parsear archivo JSON de zonas."""

    if not os.path.exists(zones_path):
        return []

    try:
        async with aiofiles.open(zones_path, mode="r") as f:
            return json.loads(await f.read()) or []
    except json.JSONDecodeError:
        return []


async def write_zones_file(zones_path, data):
    """Escribir en el archivo de zonas."""

    async with aiofiles.open(zones_path, mode="w") as f:
        await f.write(json.dumps(data, indent=4))


def validate_zone(zone):
    """Valida que una zona tenga los datos correctos."""

    required_keys = {"id", "name", "latitude", "longitude", "radius"}

    # Validar que estén todos los campos requeridos
    if not required_keys.issubset(zone):
        error_msg = "Missing required fields"
    else:
        try:
            lat = float(zone["latitude"])
            lon = float(zone["longitude"])
            radius = float(zone["radius"])
        except (ValueError, TypeError):
            error_msg = "Latitude, longitude, and radius must be numeric"
        else:
            # Validar rangos de valores
            if not -90 <= lat <= 90:
                error_msg = "Latitude must be between -90 and 90"
            elif not -180 <= lon <= 180:
                error_msg = "Longitude must be between -180 and 180"
            elif radius < 20:
                error_msg = "Radius must be at least 20 meters"
            elif not isinstance(zone["name"], str) or not zone["name"].strip():
                error_msg = "Name cannot be empty"
            else:
                return True, None  # Solo un `return` exitoso al final

    return False, error_msg  # Solo un `return` de error al final

def sanitize_id(zone_name):
    # Replace spaces with underscores and remove non-alphanumeric characters
    return re.sub('[^0-9a-zA-Z_]+', '', zone_name.replace(' ', '_')).lower()