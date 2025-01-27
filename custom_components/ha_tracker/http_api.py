from dateutil.parser import isoparse
from datetime import datetime
from homeassistant.util import dt as dt_util
from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.helpers.entity_registry import async_get
from homeassistant.helpers import entity_registry

import os
import json
import logging
import aiofiles

_LOGGER = logging.getLogger(__name__)

ZONES_FILE = "custom_components/ha_tracker/zones.json"

# Endpoint para devolver todos los dispositivos (device_trackers)
class DevicesEndpoint(HomeAssistantView):
    url = "/api/devices"
    name = "api:devices"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        devices = hass.states.async_all()
        device_data = [
            {
                "entity_id": device.entity_id,
                "state": device.state,
                "attributes": device.attributes,
                "last_updated": device.last_updated,
                "last_changed": device.last_changed,
            }
            for device in devices
            if device.entity_id.startswith("device_tracker") and
               device.attributes.get("latitude") and
               device.attributes.get("longitude")
        ]
        return self.json(device_data)

# Endpoint para devolver todas las personas
class PersonsEndpoint(HomeAssistantView):
    url = "/api/persons"
    name = "api:persons"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        persons = hass.states.async_all()
        person_data = [
            {
                "entity_id": person.entity_id,
                "state": person.state,
                "attributes": person.attributes,
                "last_updated": person.last_updated,
                "last_changed": person.last_changed,
            }
            for person in persons
            if person.entity_id.startswith("person.")
        ]
        return self.json(person_data)

# Endpoint para devolver posiciones filtradas por un dispositivo y rango de tiempo
class FilteredPositionsEndpoint(HomeAssistantView):
    url = "/api/filtered_positions"
    name = "api:filtered_positions"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        query = request.query
        device_id = query.get("device_id")
        start_date = query.get("start_date")
        end_date = query.get("end_date")

        # Validar parámetros
        if not all([device_id, start_date, end_date]):
            return self.json({"error": "Missing parameters"}, status_code=400)

        # Validar y convertir fechas
        start_datetime = dt_util.parse_datetime(start_date)
        end_datetime = dt_util.parse_datetime(end_date)
        now = dt_util.utcnow()

        if start_datetime is None or end_datetime is None:
            return self.json({"error": "Invalid date format"}, status_code=400)

        start_datetime_utc = dt_util.as_utc(start_datetime)
        end_datetime_utc = dt_util.as_utc(end_datetime)

        if start_datetime_utc >= end_datetime_utc:
            return self.json({"error": "start_date must be earlier than end_date"}, status_code=400)

        if start_datetime_utc >= now:
            return self.json({"error": "start_date must be in the past"}, status_code=400)

        # Validar si el dispositivo existe
        device_state = hass.states.get(device_id)
        if not device_state:
            return self.json({"error": f"Device {device_id} not found"}, status_code=404)

        # Obtener historial usando get_significant_states
        try:
            history = await hass.async_add_executor_job(
                get_significant_states,
                hass,
                start_datetime_utc,
                end_datetime_utc,
                [device_id]
            )
        except Exception as e:
            return self.json({"error": f"Error retrieving history: {str(e)}"}, status_code=500)

        if not history or device_id not in history:
            return self.json([])

        # Filtrar posiciones únicas y dentro del rango de tiempo
        filtered_positions = []
        last_seen_datetime = None

        for state in history[device_id]:
            if not (state.attributes.get("latitude") and state.attributes.get("longitude")):
                continue

            current_datetime = isoparse(state.last_updated.isoformat())
            current_datetime_rounded = current_datetime.replace(microsecond=0)  # Redondear a segundos

            if (
                current_datetime_rounded > start_datetime_utc.replace(microsecond=0)
                and (last_seen_datetime is None or current_datetime_rounded != last_seen_datetime)
            ):
                filtered_positions.append({
                    "entity_id": state.entity_id,
                    "state": state.state,
                    "attributes": state.attributes,
                    "last_updated": state.last_updated.isoformat(),
                    "last_changed": state.last_changed.isoformat(),
                })
                last_seen_datetime = current_datetime_rounded

        return self.json(filtered_positions)
        
# Endpoint para verificar si el usuario es administrador
class IsAdminEndpoint(HomeAssistantView):
    url = "/api/is_admin"
    name = "api:is_admin"
    requires_auth = True

    async def get(self, request):
        hass_user = request["hass_user"]
        if hass_user is None:
            return self.json({"error": "User not authenticated"}, status_code=401)

        # Verificar si el usuario tiene permisos administrativos
        is_admin = hass_user.is_admin

        return self.json({"is_admin": is_admin})
        

# Endpoint para manejar zonas
class ZonesAPI(HomeAssistantView):
    url = "/api/zones"
    name = "api:zones"
    requires_auth = True

    async def get(self, request):
        """Obtener todas las zonas, tanto personalizadas como de Home Assistant."""
        hass = request.app["hass"]
        zones_path = os.path.join(hass.config.path(), ZONES_FILE)

        # Leer zonas personalizadas
        custom_zones = await read_zones_file(zones_path)                

        # Leer zonas de Home Assistant
        ha_zones = []
        for state in hass.states.async_all():
            entity_id = state.entity_id
            if entity_id.startswith("zone."):
                zone_data = {
                    "id": entity_id.split("zone.")[1],
                    "name": state.attributes.get("friendly_name", ""),
                    "latitude": state.attributes.get("latitude"),
                    "longitude": state.attributes.get("longitude"),
                    "radius": state.attributes.get("radius", 100),
                    "icon": state.attributes.get("icon", "mdi:map-marker"),
                    "passive": state.attributes.get("passive", False),
                    "custom": False,  # Las zonas de Home Assistant no son personalizadas
                }
                # Verificar si ya está en las zonas personalizadas
                if not any(
                    zone["id"] == zone_data["id"] for zone in custom_zones
                ):
                    ha_zones.append(zone_data)

        # Combinar ambas listas
        combined_zones = custom_zones + ha_zones

        return self.json(combined_zones)

    async def post(self, request):
        user = request["hass_user"]
        if not user.is_admin:
            return self.json({"error": "User is not an administrator."}, status_code=400)

        """Crear una nueva zona."""
        hass = request.app["hass"]
        data = await request.json()

        # Generar un ID único basado en el nombre y la fecha en milisegundos
        timestamp = int(datetime.now().timestamp() * 1000)  # Convertir a milisegundos
        generated_id = f"{data['name'].replace(' ', '_').lower()}_{timestamp}"
        data["id"] = data.get("id", generated_id)  # Usar el ID proporcionado o generar uno

        # Completar los campos faltantes con valores predeterminados
        data.setdefault("icon", "mdi:map-marker")  # Icono por defecto
        data.setdefault("passive", False)  # No pasivo por defecto
        data.setdefault("custom", True)  # Personalizado por defecto

        # Validar los datos requeridos
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json(f"Skipping invalid zone: {zone}. Reason: {error}", status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)

        # Leer las zonas existentes
        zones = []
        if os.path.exists(zones_path):
            async with aiofiles.open(zones_path, mode="r") as f:
                content = await f.read()
                try:
                    zones = json.loads(content) if content else []
                except json.JSONDecodeError:
                    zones = []

        # Evitar duplicados
        if any(zone["id"] == data["id"] for zone in zones):
            return self.json({"error": "Zone ID already exists"}, status_code=400)

        # Agregar la nueva zona
        zones.append(data)

        # Guardar en el archivo
        async with aiofiles.open(zones_path, mode="w") as f:
            await f.write(json.dumps(zones, indent=4))

        # Registrar la zona en Home Assistant
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone created successfully", "id": data["id"]})

    async def delete(self, request):
        user = request["hass_user"]
        if not user.is_admin:
            return self.json({"error": "User is not an administrator."}, status_code=400)
            
        """Eliminar una zona."""
        hass = request.app["hass"]
        data = await request.json()

        zone_id = data.get("id")
        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)

        # Leer las zonas existentes
        zones = await read_zones_file(zones_path)   

        # Verificar si la zona tiene custom=True
        target_zone = next((zone for zone in zones if zone["id"] == zone_id), None)
        if not target_zone:
            return self.json({"error": "Zone ID not found"}, status_code=404)

        if not target_zone.get("custom", False):
            return self.json({"error": "Cannot delete non-custom zones"}, status_code=400)

        # Filtrar para eliminar la zona
        updated_zones = [zone for zone in zones if zone["id"] != zone_id]

        # Verificar si se eliminó algo
        if len(updated_zones) == len(zones):
            return self.json({"error": "Zone ID not found"}, status_code=404)

        # Guardar los cambios
        async with aiofiles.open(zones_path, mode="w") as f:
            await f.write(json.dumps(updated_zones, indent=4))

        # Registrar las zonas actualizadas en Home Assistant
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone deleted successfully"})

    async def put(self, request):
        user = request["hass_user"]
        if not user.is_admin:
            return self.json({"error": "User is not an administrator."}, status_code=400)
            
        """Actualizar una zona existente."""
        hass = request.app["hass"]
        data = await request.json()

        zone_id = data.get("id")
        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        # Validar los datos requeridos
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json(f"Skipping invalid zone: {zone}. Reason: {error}", status_code=400)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)

        # Leer las zonas existentes
        zones = await read_zones_file(zones_path)

        # Verificar si la zona tiene custom=True
        target_zone = next((zone for zone in zones if zone["id"] == zone_id), None)
        if not target_zone:
            return self.json({"error": "Zone ID not found"}, status_code=404)

        if not target_zone.get("custom", False):
            return self.json({"error": "Cannot update non-custom zones"}, status_code=400)

        # Actualizar la zona
        updated = False
        for zone in zones:
            if zone["id"] == zone_id:
                zone.update(data)
                updated = True
                break

        if not updated:
            return self.json({"error": "Zone ID not found"}, status_code=404)

        # Guardar los cambios
        async with aiofiles.open(zones_path, mode="w") as f:
            await f.write(json.dumps(zones, indent=4))

        # Registrar las zonas actualizadas en Home Assistant
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone updated successfully"})
       

# Función para registrar las zonas dinámicamente en Home Assistant       
async def register_zones(hass):
    zones_path = os.path.join(hass.config.path(), ZONES_FILE)

    if not os.path.exists(zones_path):
        _LOGGER.warning("Zones file not found. Skipping zone updates.")
        return

    try:
        # Eliminar todas las zonas personalizadas antes de registrar nuevas
        for state in hass.states.async_all():
            if state.entity_id.startswith("zone.") and state.attributes.get("custom", False):
                hass.states.async_remove(state.entity_id)

        # Leer zonas del archivo
        async with aiofiles.open(zones_path, mode="r") as f:
            content = await f.read()
            
        try:
            zones = json.loads(content)
        except json.JSONDecodeError:
            _LOGGER.error("Failed to decode zones JSON. Skipping registration.")
            return

        # Registrar zonas personalizadas
        valid_zones = 0
        for zone in zones:
            is_valid, error = validate_zone(zone)
            if not is_valid:
                _LOGGER.warning(f"Skipping invalid zone ID '{zone.get('id', 'unknown')}': {error}")
                continue

            # Registrar la zona personalizada con manejo de excepciones
            try:
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
                valid_zones += 1
                _LOGGER.info(f"Registered zone: zone.{zone['id']}")
            except Exception as e:
                _LOGGER.exception(f"Failed to register zone {zone['id']}: {e}")

        _LOGGER.info(f"{valid_zones} custom zones have been registered dynamically.")
    except json.JSONDecodeError as json_error:
        _LOGGER.error(f"Error decoding zones file: {str(json_error)}")
    except Exception as e:
        _LOGGER.error(f"Failed to register custom zones dynamically: {str(e)}")

async def read_zones_file(zones_path):
    """Lee y parsea un archivo JSON que contiene zonas."""
    if not os.path.exists(zones_path):
        _LOGGER.warning(f"Zones file not found at path: {zones_path}")
        return []

    try:
        async with aiofiles.open(zones_path, mode="r") as f:
            content = await f.read()
            return json.loads(content) if content else []
    except json.JSONDecodeError as e:
        _LOGGER.error(f"Failed to parse zones JSON file: {e}")
        return []
    except Exception as e:
        _LOGGER.exception(f"Unexpected error while reading zones file: {e}")
        return []

def validate_zone(zone):
    try:
        # Validar campos obligatorios
        if not all(key in zone for key in ["id", "name", "latitude", "longitude", "radius"]):
            return False, "Missing required fields"

        # Validar tipos de datos
        zone["latitude"] = float(zone["latitude"])
        zone["longitude"] = float(zone["longitude"])
        zone["radius"] = float(zone["radius"])

        # Validar rango de valores 
        if not (-90 <= zone["latitude"] <= 90) or not (-180 <= zone["longitude"] <= 180) or zone["radius"] < 20:
            return False, "Invalid latitude, longitude, or radius range"

        # Validar que name no esté vacío
        if not zone["name"] or not zone["name"].strip():
            return False, "Name cannot be empty"

        return True, None
    except (ValueError, TypeError):
        return False, "Invalid numeric values"