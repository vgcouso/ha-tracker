"""Manejo de las zonas de HA Tracker"""

import json
import logging
import os
import re
import unicodedata
from datetime import datetime

import aiofiles
from homeassistant.components.http import HomeAssistantView

from ..const import ZONES_FILE
from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DEFAULT_COLOR = "#008000"  # verde por defecto (CSS 'green')
MAX_ZONE_NAME_LEN = 30     # longitud máxima del nombre de la zona


class ZonesAPI(HomeAssistantView):
    """Punto de acceso a la API para manejar zonas"""

    url = "/api/ha_tracker/zones"
    name = "api:ha_tracker/zones"
    requires_auth = True

    async def get(self, request):
        """Devuelve las zonas"""

        hass = request.app["hass"]

        # Devuelve solo si es administrador o only_admin es false
        only_admin = False
        entries = hass.config_entries.async_entries(DOMAIN)
        if entries:  # Normalmente solo habrá una entrada
            entry = entries[0]
            only_admin = entry.options.get(
                "only_admin",
                entry.data.get("only_admin", False),
            )

        user = request.get("hass_user")
        if only_admin and (user is None or not user.is_admin):
            return self.json([])

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        store = await _read_store(zones_path)
        custom_zones = store["zones"]

        # Obtener zonas de Home Assistant
        ha_zones = [
            {
                "id": (state.entity_id.split("zone.", 1)[1]),
                "name": state.attributes.get("friendly_name", ""),
                "latitude": state.attributes.get("latitude"),
                "longitude": state.attributes.get("longitude"),
                "radius": state.attributes.get("radius", 100),
                "icon": state.attributes.get("icon", "mdi:map-marker"),
                "passive": state.attributes.get("passive", False),
                "custom": False,
                "color": normalize_color(state.attributes.get("color", DEFAULT_COLOR)),
                "visible": True,  # por defecto visibles
            }
            for state in hass.states.async_all()
            if state.entity_id.startswith("zone.")
        ]
        
        # Aplica overrides (color/visible) a zonas de HA y limpia overrides huérfanos
        overrides = store.get("ha_overrides", {})
        valid_ids = set()
        for z in ha_zones:
            zid = sanitize_id(z["id"])
            valid_ids.add(zid)
            ov = overrides.get(zid, {})
            if "color" in ov:
                z["color"] = normalize_color(ov.get("color"))
            z["visible"] = bool(ov.get("visible", True))

        # Elimina overrides de zonas HA que ya no existen
        stale = [k for k in list(overrides.keys()) if k not in valid_ids]
        if stale:
            for k in stale:
                overrides.pop(k, None)
            await _write_store(zones_path, store)
        

        # Agregar solo zonas de HA que no estén ya (comparando IDs sanitizados)
        sanitized_ids = {sanitize_id(z.get("id", "")) for z in custom_zones}
        for ha_zone in ha_zones:
            if sanitize_id(ha_zone["id"]) not in sanitized_ids:
                custom_zones.append(ha_zone)

        # Normaliza color y añade visible para TODAS las zonas
        normalized = []
        for z in custom_zones:
            zz = dict(z)
            zz["color"] = normalize_color(zz.get("color", DEFAULT_COLOR))
            if "visible" not in zz:
                zz["visible"] = True
            normalized.append(zz)

        return self.json(normalized)

    async def post(self, request):
        """Crear una nueva zona."""

        user = request.get("hass_user")
        if not user or not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()

        # Normaliza nombre y color
        if "name" in data and isinstance(data["name"], str):
            data["name"] = data["name"].strip()
        data["color"] = normalize_color(data.get("color", DEFAULT_COLOR))

        # Asegurar ID canónico
        if not data.get("id"):
            name = data.get("name", "").strip()
            ts = int(datetime.now().timestamp() * 1000)
            base = sanitize_id(name) or "zone"
            data["id"] = f"{base}_{ts}"
        else:
            data["id"] = sanitize_id(data["id"])

        # Validar zona (requiere todos los campos)
        is_valid, error = validate_zone(data)
        if not is_valid:
            return self.json(
                {"error": f"Skipping invalid zone: {data}. Reason: {error}"},
                status_code=400,
            )

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        store = await _read_store(zones_path)
        zones = store["zones"]

        # Evitar duplicados de ID (comparando IDs sanitizados)
        new_id_s = sanitize_id(data["id"])
        if any(sanitize_id(z.get("id", "")) == new_id_s for z in zones):
            return self.json({"error": "Zone already exists"}, status_code=400)

        # Evitar duplicados de NOMBRE (entre custom + HA)
        proposed_name_key = name_key(data["name"])
        if proposed_name_key in await existing_zone_name_keys(hass, zones):
            return self.json({"error": "Zone name already exists"}, status_code=400)

        data["custom"] = True  # Solo las creadas manualmente son "custom"
        if "visible" not in data:
            data["visible"] = True
        zones.append(data)

        # Guardar en el archivo
        store["zones"] = zones
        await _write_store(zones_path, store)

        await register_zones(hass)

        msg = {"success": True, "message": "Zone created", "id": data["id"]}
        return self.json(msg)

    async def delete(self, request):
        """Eliminar una zona."""

        user = request.get("hass_user")
        if not user or not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")
        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        zone_id_s = sanitize_id(zone_id)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        store = await _read_store(zones_path)
        zones = store["zones"]

        # Buscar zona objetivo por ID sanitizado
        target_idx = None
        for i, z in enumerate(zones):
            if sanitize_id(z.get("id", "")) == zone_id_s:
                target_idx = i
                break

        if target_idx is None or not zones[target_idx].get("custom", False):
            error_msg = {"error": "Zone not found or cannot be deleted"}
            return self.json(error_msg, status_code=404)

        # Eliminar y guardar
        del zones[target_idx]
        store["zones"] = zones
        await _write_store(zones_path, store)
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone deleted successfully"})

    async def put(self, request):
        """Actualizar una zona existente (admite actualización parcial)."""

        user = request.get("hass_user")
        if not user or not user.is_admin:
            return self.json(
                {"error": "User is not an administrator."}, status_code=403
            )

        hass = request.app["hass"]
        data = await request.json()
        zone_id = data.get("id")
        if not zone_id:
            return self.json({"error": "Missing zone ID"}, status_code=400)

        # Normaliza campos entrantes
        if "name" in data and isinstance(data["name"], str):
            data["name"] = data["name"].strip()
        incoming_color = data.get("color", None)
        if incoming_color is not None:
            data["color"] = normalize_color(incoming_color)

        zone_id_s = sanitize_id(zone_id)

        zones_path = os.path.join(hass.config.path(), ZONES_FILE)
        store = await _read_store(zones_path)
        zones = store["zones"]
        
        # Localizar zona por ID sanitizado
        target_idx = None
        for i, z in enumerate(zones):
            if sanitize_id(z.get("id", "")) == zone_id_s:
                target_idx = i
                break

        if target_idx is None or not zones[target_idx].get("custom", False):
            # No es custom: puede ser zona de HA -> actualizar overrides (solo color/visible)
            # Verifica que exista en HA
            exists_in_ha = any(
                sanitize_id(s.entity_id.split("zone.",1)[1]) == zone_id_s
                for s in hass.states.async_all() if s.entity_id.startswith("zone.")
            )
            if not exists_in_ha:
                return self.json({"error": "Zone not found or cannot be updated"}, status_code=404)

            allowed = {}
            if "color" in data:
                allowed["color"] = normalize_color(data["color"])
            if "visible" in data:
                allowed["visible"] = bool(data["visible"])
            if not allowed:
                return self.json({"error": "Nothing to update"}, status_code=400)

            store["ha_overrides"][zone_id_s] = {
                **store["ha_overrides"].get(zone_id_s, {}),
                **allowed,
            }
            await _write_store(zones_path, store)
            return self.json({"success": True, "message": "Zone updated successfully"})

        current = zones[target_idx].copy()

        # Fusionar cambios (no permitimos cambiar el ID)
        updatable_keys = {"name", "latitude", "longitude", "radius", "icon", "passive", "color", "visible"}
        merged = current | {k: v for k, v in data.items() if k in updatable_keys}

        # Validar el resultado completo
        is_valid, error = validate_zone(merged)
        if not is_valid:
            return self.json(
                {"error": f"Skipping invalid zone: {merged}. Reason: {error}"},
                status_code=400,
            )

        # Si cambia o establece nombre, comprobar duplicidad contra:
        # - Otras zonas CUSTOM (excluyendo la actual)
        # - Zonas de HA (friendly_name)
        if "name" in data:
            old_key = name_key(current.get("name", ""))
            new_key = name_key(merged.get("name", ""))

            # Solo si el nombre cambia (normalizado) chequeamos duplicados
            if new_key != old_key:
                name_keys_custom = {
                    name_key(z.get("name", ""))
                    for idx, z in enumerate(zones)
                    if idx != target_idx and z.get("name")
                }
                name_keys_ha = get_ha_zone_name_keys(hass)

                if new_key in (name_keys_custom | name_keys_ha):
                    return self.json({"error": "Zone name already exists"}, status_code=400)

        zones[target_idx] = merged
        store["zones"] = zones
        await _write_store(zones_path, store)
        
        await register_zones(hass)

        return self.json({"success": True, "message": "Zone updated successfully"})


async def unregister_zones(hass):
    """Eliminar zonas personalizadas registradas en Home Assistant."""
    try:
        for state in hass.states.async_all():
            if state.entity_id.startswith("zone.") and state.attributes.get("custom", False):
                hass.states.async_remove(state.entity_id)
    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Error unregistering zones: %s", e)


async def register_zones(hass):
    """Registrar zonas en Home Assistant."""

    zones_path = os.path.join(hass.config.path(), ZONES_FILE)

    if not os.path.exists(zones_path):
        _LOGGER.warning("Zones file not found, creating empty zones file.")
        await write_zones_file(zones_path, [])
        return

    try:
        store = await _read_store(zones_path)
        zones = store["zones"]

        # Desregistrar zonas antes de volver a registrarlas
        await unregister_zones(hass)

        for zone in zones:
            is_valid, error = validate_zone(zone)
            if not is_valid:
                _LOGGER.warning("Invalid zone '%s'", zone.get("id", "unknown"))
                _LOGGER.warning("Error details: %s", error)
                continue

            try:
                entity_object_id = sanitize_id(zone["id"])
                hass.states.async_set(
                    f"zone.{entity_object_id}",
                    "active",
                    {
                        "friendly_name": zone["name"],
                        "latitude": zone["latitude"],
                        "longitude": zone["longitude"],
                        "radius": zone["radius"],
                        "icon": zone.get("icon", "mdi:map-marker"),
                        "passive": zone.get("passive", False),
                        "custom": True,
                        "color": normalize_color(zone.get("color", DEFAULT_COLOR)),
                        "visible": bool(zone.get("visible", True)),
                    },
                )
            except Exception as e:  # noqa: BLE001
                _LOGGER.exception("Failed to register %s: %s", zone.get("id"), e)

    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Error registering zones: %s", e)


# ---------- helpers de almacenamiento unificado ----------
async def _read_store(zones_path):
    """
    Devuelve dict con forma:
      { "zones": [ ...custom... ], "ha_overrides": { "<id>": {"color":"#rrggbb","visible": true/false}, ... } }
    Acepta también el formato antiguo (lista) y lo adapta.
    """
    data = await read_zones_file(zones_path)
    if isinstance(data, list):
        return {"zones": data, "ha_overrides": {}}
    if isinstance(data, dict):
        return {
            "zones": data.get("zones", []) or [],
            "ha_overrides": data.get("ha_overrides", {}) or {},
        }
    return {"zones": [], "ha_overrides": {}}


async def _write_store(zones_path, store):
    # Asegura claves mínimas
    payload = {
        "zones": store.get("zones", []) or [],
        "ha_overrides": store.get("ha_overrides", {}) or {},
    }
    await write_zones_file(zones_path, payload)


async def read_zones_file(zones_path):
    """Leer y parsear archivo JSON de zonas."""
    if not os.path.exists(zones_path):
        return []

    try:
        async with aiofiles.open(zones_path, mode="r") as f:
            content = await f.read()
            return json.loads(content) or []
    except json.JSONDecodeError:
        _LOGGER.error("Zones file is not valid JSON. Returning empty list.")
        return []
    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Error reading zones file: %s", e)
        return []


async def write_zones_file(zones_path, data):
    """Escribir en el archivo de zonas."""
    try:
        # Asegurar directorio existente
        os.makedirs(os.path.dirname(zones_path), exist_ok=True)
        async with aiofiles.open(zones_path, mode="w") as f:
            await f.write(json.dumps(data, indent=4))
    except Exception as e:  # noqa: BLE001
        _LOGGER.error("Error writing zones file: %s", e)
        raise


def validate_zone(zone):
    """Valida que una zona tenga los datos correctos (requiere todos los campos)."""

    required_keys = {"id", "name", "latitude", "longitude", "radius"}

    # Validar que estén todos los campos requeridos
    if not required_keys.issubset(zone):
        error_msg = "Missing required fields"
        return False, error_msg

    # Tipos numéricos correctos
    try:
        lat = float(zone["latitude"])
        lon = float(zone["longitude"])
        radius = float(zone["radius"])
    except (ValueError, TypeError):
        return False, "Latitude, longitude, and radius must be numeric"

    # Rangos válidos
    if not -90 <= lat <= 90:
        return False, "Latitude must be between -90 and 90"
    if not -180 <= lon <= 180:
        return False, "Longitude must be between -180 and 180"
    if radius < 20:
        return False, "Radius must be at least 20 meters"

    # Nombre válido
    if not isinstance(zone["name"], str) or not zone["name"].strip():
        return False, "Name cannot be empty"
    if len(zone["name"].strip()) > MAX_ZONE_NAME_LEN:
        return False, f"Name cannot exceed {MAX_ZONE_NAME_LEN} characters"

    # ID sanitizado y no vacío
    if not sanitize_id(zone.get("id", "")):
        return False, "Invalid id after sanitization"

    # Validar color si viene informado (opcional)
    if "color" in zone and zone["color"] not in (None, ""):
        if not validate_color(str(zone["color"])):
            return False, "Color must be hex (#RGB or #RRGGBB)"

    # Normalizar color a #rrggbb
    zone["color"] = normalize_color(zone.get("color", DEFAULT_COLOR))
    
    # visible opcional (bool)
    if "visible" in zone:
        zone["visible"] = bool(zone["visible"])
    else:
        zone["visible"] = True    

    return True, None


def sanitize_id(value: str) -> str:
    """
    Convierte cualquier cadena a un object_id válido:
    - minúsculas
    - espacios y separadores -> '_'
    - solo [a-z0-9_]
    - colapsa múltiples '_' y recorta '_' al principio/fin
    - si queda vacío, genera 'zone_<timestamp>'
    """
    s = (value or "").strip().lower()
    s = s.replace(" ", "_")
    # Reemplaza todo lo no permitido por '_'
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    # Colapsar múltiples '_'
    s = re.sub(r"_+", "_", s)
    # Quitar '_' de extremos
    s = s.strip("_")
    if not s:
        s = f"zone_{int(datetime.now().timestamp())}"
    return s


def validate_color(color: str) -> bool:
    """Acepta #RGB o #RRGGBB (hex)."""
    if not isinstance(color, str):
        return False
    c = color.strip()
    return bool(re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", c))


def normalize_color(color: str | None) -> str:
    """Normaliza a #rrggbb; si falta o no es válido, usa DEFAULT_COLOR."""
    if not color:
        return DEFAULT_COLOR
    c = color.strip().lower()
    if re.fullmatch(r"#([0-9a-f]{3})", c):
        c = "#" + "".join(ch * 2 for ch in c[1:])
    if re.fullmatch(r"#[0-9a-f]{6}", c):
        return c
    return DEFAULT_COLOR


# ===== Helpers para unicidad de nombre =====

def name_key(name: str) -> str:
    """
    Normaliza el nombre para comparación de unicidad:
    - quita espacios extremos
    - colapsa espacios internos a uno
    - pasa a minúsculas
    - elimina acentos/diacríticos (NFKD)
    """
    s = (name or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    # Eliminar diacríticos
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    return s


def get_ha_zone_name_keys(hass) -> set[str]:
    """Obtiene el conjunto de 'name_key' de las zonas de HA (friendly_name)."""
    keys = set()
    for state in hass.states.async_all():
        if state.entity_id.startswith("zone."):
            fname = state.attributes.get("friendly_name")
            if isinstance(fname, str) and fname.strip():
                keys.add(name_key(fname))
    return keys


async def existing_zone_name_keys(hass, custom_zones: list[dict]) -> set[str]:
    """
    Conjunto de claves de nombre existentes entre:
      - Zonas personalizadas (archivo)
      - Zonas HA (friendly_name)
    """
    keys = {name_key(z.get("name", "")) for z in custom_zones if z.get("name")}
    keys |= get_ha_zone_name_keys(hass)
    # Eliminar clave de vacío por si acaso
    keys.discard(name_key(""))
    return keys
