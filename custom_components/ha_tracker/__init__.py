import logging
import os
import json
import aiofiles  # Manejo de archivos de forma asíncrona
from .http_api import ConfigEndpoint, DevicesEndpoint, PersonsEndpoint, FilteredPositionsEndpoint, IsAdminEndpoint, ZonesAPI, register_zones
from .post_install import copy_www_files

_LOGGER = logging.getLogger(__name__)
DOMAIN = "ha_tracker"

async def async_setup(hass, config):
    """Configura la integración personalizada."""
    _LOGGER.info("Cargando la integración personalizada HA Tracker.")
    
    # Obtener la configuración
    ha_tracker_config = config.get(DOMAIN)
    if ha_tracker_config is None:
        _LOGGER.warning("No se encontró ha_tracker en configuration.yaml. Usando valores por defecto.")
        ha_tracker_config = {
            "update_interval": 10,
            "enable_debug": False
        }
    hass.data[DOMAIN] = ha_tracker_config
    _LOGGER.debug("Configuración cargada en hass.data: %s", hass.data[DOMAIN])

    # Obtener la versión del archivo manifest.json
    current_version = await get_version_from_manifest()
    if not current_version:
        _LOGGER.error("No se pudo obtener la versión desde manifest.json.")
        return False

    # Copiar los archivos del cliente si es necesario
    try:
        await copy_www_files(current_version)
    except Exception as e:
        _LOGGER.error(f"Error copiando archivos del cliente: {e}")

    # Registrar los endpoints de la API
    hass.http.register_view(ConfigEndpoint())
    hass.http.register_view(DevicesEndpoint())
    hass.http.register_view(PersonsEndpoint())
    hass.http.register_view(FilteredPositionsEndpoint())
    hass.http.register_view(IsAdminEndpoint())
    hass.http.register_view(ZonesAPI())
    await register_zones(hass)

    _LOGGER.info("Integración HA Tracker configurada correctamente.")
    return True

async def get_version_from_manifest():
    """Obtener la versión de manifest.json de forma asíncrona."""
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")

    try:
        async with aiofiles.open(manifest_path, "r") as f:
            manifest_data = await f.read()  # Leer el contenido del archivo
            manifest_json = json.loads(manifest_data)  # Convertir a JSON
            return manifest_json.get("version")  # Obtener la versión
    except Exception as e:
        _LOGGER.error(f"Error al leer manifest.json: {e}")
        return None