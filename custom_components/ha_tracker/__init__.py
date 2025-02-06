import logging
import os
import json
import aiofiles
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from .const import DOMAIN
from .api import register_api_views
from .post_install import copy_www_files

_LOGGER = logging.getLogger(__name__)

async def async_setup(hass: HomeAssistant, config) -> bool:
    """Configuración inicial de la integración."""
    _LOGGER.info("Cargando la integración HA Tracker.")
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configura HA Tracker desde una entrada de configuración."""

    _LOGGER.info("Cargando HA Tracker desde configuración de la UI.")

    # Usar valores de opciones si están disponibles, sino, usar los datos iniciales
    config = {**entry.data, **entry.options} if entry.options else entry.data

    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    hass.data[DOMAIN]["config"] = config  

    _LOGGER.debug(f"Configuración cargada en hass.data: {config}")

    # Obtener la versión del manifest.json
    current_version = await get_version_from_manifest()
    if not current_version:
        _LOGGER.error("No se pudo obtener la versión desde manifest.json.")
        return False

    # Copiar archivos si es necesario
    try:
        await copy_www_files(current_version)
    except Exception as e:
        _LOGGER.error(f"Error copiando archivos del cliente: {e}")

    # Registrar los endpoints de la API si aún no están registrados
    if "views_registered" not in hass.data[DOMAIN]:
        register_api_views(hass)
        hass.data[DOMAIN]["views_registered"] = True

    # Escuchar actualizaciones de configuración sin reiniciar
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    _LOGGER.info("Integración HA Tracker configurada correctamente.")
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Actualizar la integración cuando se cambian las opciones en la UI."""
    _LOGGER.info("Actualizando configuración de HA Tracker sin reiniciar...")
    await hass.config_entries.async_reload(entry.entry_id)

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Eliminar configuración cuando se desinstala o actualiza la integración."""
    _LOGGER.info("Eliminando configuración de HA Tracker...")

    if DOMAIN in hass.data:
        hass.data.pop(DOMAIN)

    return True

async def get_version_from_manifest():
    """Obtener la versión del archivo manifest.json de forma asíncrona."""
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")

    try:
        async with aiofiles.open(manifest_path, "r") as f:
            manifest_data = await f.read()
            manifest_json = json.loads(manifest_data)
            return manifest_json.get("version")
    except Exception as e:
        _LOGGER.error(f"Error al leer manifest.json: {e}")
        return None
