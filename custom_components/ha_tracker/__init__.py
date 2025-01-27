import logging
import os
import json
from .http_api import DevicesEndpoint, PersonsEndpoint, FilteredPositionsEndpoint, IsAdminEndpoint, ZonesAPI, register_zones
from .post_install import copy_www_files

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass, config):
    """Configura la integración personalizada."""
    _LOGGER.info("Cargando la integración personalizada HA Tracker.")

    # Obtener la versión del archivo manifest.json
    current_version = get_version_from_manifest()
    if not current_version:
        _LOGGER.error("No se pudo obtener la versión desde manifest.json.")
        return False

    # Copiar los archivos del cliente si es necesario
    try:
        await copy_www_files(current_version)
    except Exception as e:
        _LOGGER.error(f"Error copiando archivos del cliente: {e}")

    # Registrar los endpoints de la API
    hass.http.register_view(DevicesEndpoint())
    hass.http.register_view(PersonsEndpoint())
    hass.http.register_view(FilteredPositionsEndpoint())
    hass.http.register_view(IsAdminEndpoint())
    hass.http.register_view(ZonesAPI())
    await register_zones(hass)

    _LOGGER.info("Integración HA Tracker configurada correctamente.")
    return True

def get_version_from_manifest():
    """Obtener la versión de manifest.json."""
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")
    try:
        with open(manifest_path, "r") as f:
            manifest_data = json.load(f)
            return manifest_data.get("version")
    except Exception as e:
        _LOGGER.error(f"Error al leer manifest.json: {e}")
        return None
