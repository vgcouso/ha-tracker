"""Módulo de inicialización para HA Tracker"""

import json
import logging
import os
import shutil

import aiofiles
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.components.frontend import async_remove_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .api import register_api_views
from .api.zones import register_zones, unregister_zones
from .const import DOMAIN, INSTALLED_VERSION_FILE
from .post_install import copy_www_files

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_LOGGER = logging.getLogger(__name__)


async def async_setup(_hass: HomeAssistant, _config) -> bool:
    """Configuración inicial de la integración."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configura HA Tracker desde una entrada de configuración."""

    # Usar valores de opciones si están disponibles, sino usar los iniciales
    config = {**entry.data, **entry.options} if entry.options else entry.data

    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    hass.data[DOMAIN]["config"] = config

    # Obtener la versión del manifest.json
    current_version = await get_version_from_manifest()
    if not current_version:
        _LOGGER.error("Could not get version from manifest.json.")
        return False

    # Copiar archivos si es necesario
    try:
        await copy_www_files(hass, current_version)
    except (OSError, ValueError) as e:
        _LOGGER.error("Error copying client files: %s", e)

    # Registrar los endpoints de la API si aún no están registrados
    if "views_registered" not in hass.data[DOMAIN]:
        register_api_views(hass)
        hass.data[DOMAIN]["views_registered"] = True

    # regitra zonas en Home Assistant
    try:
        await register_zones(hass)
    except Exception as e:
        _LOGGER.error("Error while registering zones: %s", e)

    # Escuchar actualizaciones de configuración sin reiniciar
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # Registrar el panel en el menú lateral
    await async_register_panel(  
        hass,
        "ha-tracker",
        "ha-tracker",
        sidebar_title="HA Tracker",
        sidebar_icon="mdi:crosshairs-gps",
        module_url="/local/ha-tracker/ha-tracker.js",
        require_admin=False
    )

    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Actualizar integración con la UI."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Eliminar zonas, configuración y archivos"""

    if DOMAIN in hass.data:
        hass.data.pop(DOMAIN)

    # elimina zonas de Home Assistant
    await unregister_zones(hass)

    # Ruta del archivo y la carpeta a eliminar
    file_path = hass.config.path(".storage", INSTALLED_VERSION_FILE)
    folder_path = hass.config.path("www/ha-tracker")

    # Intentar eliminar el archivo de manera asíncrona
    if os.path.exists(file_path):
        try:
            await hass.async_add_executor_job(os.remove, file_path)
        except OSError as e:  # Errores de archivo
            _LOGGER.error("Error deleting file %s: %s", file_path, e)
    else:
        _LOGGER.warning("File %s does not exist", file_path)

    # Intentar eliminar la carpeta de manera asíncrona
    if os.path.exists(folder_path):
        try:
            await hass.async_add_executor_job(shutil.rmtree, folder_path)
        except OSError as e:  # Errores de directorios
            _LOGGER.error("Error deleting folder %s: %s", folder_path, e)
    else:
        _LOGGER.warning("The folder %s does not exist", folder_path)

    # Eliminar el panel personalizado correctamente
    try:
        async_remove_panel(hass, "ha-tracker")
    except Exception as e:
        _LOGGER.error("Error removing HA Tracker panel: %s", e)

    return True
    

async def get_version_from_manifest() -> str | None:
    """Obtener la versión del archivo manifest.json de forma asíncrona."""
    manifest_path = os.path.join(os.path.dirname(__file__), "manifest.json")

    try:
        async with aiofiles.open(manifest_path, "r") as f:
            manifest_data = await f.read()
            manifest_json = json.loads(manifest_data)
            return manifest_json.get("version")
    except (OSError, json.JSONDecodeError) as e:  # Errores de lectura JSON
        _LOGGER.error("Error reading manifest.json: %s", e)
        return None
