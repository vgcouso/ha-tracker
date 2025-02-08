import logging
import os
import json
import aiofiles
import shutil
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from .const import DOMAIN
from .api import register_api_views
from .post_install import copy_www_files

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

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

    # Registrar el panel en el menú lateral
    hass.components.frontend.async_register_built_in_panel(
        component_name="iframe",
        sidebar_title="HA Tracker",
        sidebar_icon="mdi:crosshairs-gps",
        frontend_url_path="ha-tracker",
        config={
            "url": "/local/ha-tracker/index.html",  # Ruta interna de Home Assistant
        },
        require_admin=False,
    )

    _LOGGER.info("Integración HA Tracker configurada correctamente.")
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Actualizar la integración cuando se cambian las opciones en la UI."""
    _LOGGER.info("Actualizando configuración de HA Tracker sin reiniciar...")
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Eliminar configuración y archivos cuando se desinstala la integración."""
    _LOGGER.info("Eliminando configuración de HA Tracker...")

    if DOMAIN in hass.data:
        hass.data.pop(DOMAIN)

    # Ruta del archivo y la carpeta a eliminar
    file_path = hass.config.path("custom_components/ha_tracker/.installed_version")
    folder_path = hass.config.path("www/ha-tracker")

    # Intentar eliminar el archivo de manera asíncrona
    if os.path.exists(file_path):
        try:
            _LOGGER.info(f"Intentando eliminar archivo: {file_path}")
            await hass.async_add_executor_job(os.remove, file_path)
            _LOGGER.info(f"Archivo eliminado correctamente: {file_path}")
        except Exception as e:
            _LOGGER.error(f"Error eliminando archivo {file_path}: {e}")
    else:
        _LOGGER.warning(f"El archivo {file_path} no existe, no se eliminó.")

    # Intentar eliminar la carpeta de manera asíncrona
    if os.path.exists(folder_path):
        try:
            _LOGGER.info(f"Intentando eliminar carpeta: {folder_path}")
            await hass.async_add_executor_job(shutil.rmtree, folder_path)
            _LOGGER.info(f"Carpeta eliminada correctamente: {folder_path}")
        except Exception as e:
            _LOGGER.error(f"Error eliminando carpeta {folder_path}: {e}")
    else:
        _LOGGER.warning(f"La carpeta {folder_path} no existe, no se eliminó.")

    # Eliminar el panel de la UI si existe
    try:
        await hass.components.frontend.async_remove_panel("ha-tracker")
        _LOGGER.info("Panel de HA Tracker eliminado correctamente.")
    except Exception as e:
        _LOGGER.error(f"Error eliminando el panel de HA Tracker: {e}")

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
