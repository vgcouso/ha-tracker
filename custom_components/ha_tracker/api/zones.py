import os
import json
import logging
import aiofiles

from datetime import datetime
from homeassistant.components.http import HomeAssistantView
from ..const import ZONES_FILE

_LOGGER = logging.getLogger(__name__)


class ZonesAPI(HomeAssistantView):
    url = "/api/ha_tracker/zones"
    name = "api:ha_tracker/zones"
    requires_auth = True

    async def get(self, request):
        """Obtener todas las zonas, tanto personalizadas como de Home Assistant."""
        hass = request.app["hass"]
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
            for state in hass.states.async_all() if state.entity_id.startswith("zone.")
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
            return self.json({"error": "User is not an administrator."}, status_code=403)

        hass = request.app["hass"]
        data = await request.json()

        # Generar ID si no está presente
        if "id" not in data or not data["id"].strip():
            timestamp = int(datetime.now().timestamp() * 1000)
            data["id"] = f"{data['name'].replace(' ', '_').lower()}_{timestamp}"

        # Validar zona
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json({"error": f"Skipping invalid zone: {data}. Reason: {error}"}, status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        # Evitar duplicados
        if any(zone["id"] == data["id"] for zone in zones):
            return self.json({"error": "Zone ID already exists"}, status_code=400)

        data["custom"] = True  # Solo las creadas manualmente son "custom"
        zones.append(data)

        # Guardar en el archivo
        await write_zones_file(zones_path, zones)

        await register_zones(hass)

        return self.json({"success": True, "message": "Zone created successfully", "id": data["id"]})

    async def delete(self, request):
        """Eliminar una zona."""
        user = request["hass_user"]
        if not user.is_admin:
            return self.json({"error": "User is not an administrator."}, status_code=403)

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")

        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        # Verificar existencia
        target_zone = next((zone for zone in zones if zone["id"] == zone_id), None)
        if not target_zone or not target_zone.get("custom", False):
            return self.json({"error": "Zone not found or cannot be deleted"}, status_code=404)

        updated_zones = [zone for zone in zones if zone["id"] != zone_id]

        # Guardar cambios
        await write_zones_file(zones_path, updated_zones)
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone deleted successfully"})

    async def put(self, request):
        """Actualizar una zona existente."""
        user = request["hass_user"]
        if not user.is_admin:
            return self.json({"error": "User is not an administrator."}, status_code=403)

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")

        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        # Validar la zona
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json({"error": f"Skipping invalid zone: {data}. Reason: {error}"}, status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        zones = await read_zones_file(zones_path)

        for zone in zones:
            if zone["id"] == zone_id and zone.get("custom", False):
                zone.update(data)
                await write_zones_file(zones_path, zones)
                await register_zones(hass)
                return self.json({"success": True, "message": "Zone updated successfully"})

        return self.json({"error": "Zone ID not found or cannot be updated"}, status_code=404)


async def register_zones(hass):
    """Registrar zonas en Home Assistant."""
    zones_path = os.path.join(hass.config.path(), ZONES_FILE)

    try:
        zones = await read_zones_file(zones_path)

        # Eliminar solo zonas personalizadas
        for state in hass.states.async_all():
            if state.entity_id.startswith("zone.") and state.attributes.get("custom", False):
                hass.states.async_remove(state.entity_id)

        for zone in zones:
            hass.states.async_set(
                f"zone.{zone['id']}",
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
    except Exception as e:
        _LOGGER.error(f"Error registrando zonas: {str(e)}")


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
    """Validar estructura de zona."""
    try:
        if not all(k in zone for k in ["id", "name", "latitude", "longitude", "radius"]):
            return False, "Missing required fields"
        float(zone["latitude"])
        float(zone["longitude"])
        return True, None
    except ValueError:
        return False, "Invalid numeric values"
