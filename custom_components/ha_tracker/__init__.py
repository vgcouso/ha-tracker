"""Módulo de inicialización para HA Tracker"""
from __future__ import annotations

import json
import logging
import asyncio
import aiofiles
import re

from datetime import timedelta
from functools import partial
from typing import Any, Dict
from urllib.parse import urlsplit, urlunsplit
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.lovelace.resources import (
    ResourceStorageCollection,  # type: ignore
)
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, CoreState
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.network import get_url
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED

from .api import register_api_views
from .api.zones import register_zones, unregister_zones
from .api.reverse_geocode import async_init_reverse_cache


# --------------------------------------------------------------------------- #
#  CONFIGURACIÓN BÁSICA                                                       #
# --------------------------------------------------------------------------- #

DOMAIN = __package__.split(".")[-1]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_LOGGER = logging.getLogger(__name__)

STATIC_DIR = (Path(__file__).parent / "www").resolve()

PANEL_URL = "/ha-tracker/assets/ha-tracker-panel.js"
CARD_URL  = "/ha-tracker/assets/ha-tracker-card.js"

BASE_OWNTRACKS = "custom_components/ha_tracker/integrations/owntracks"
BASE_GPSLOGGER = "custom_components/ha_tracker/integrations/gpslogger"


# --------------------------------------------------------------------------- #
#  SETUP                                                                      #
# --------------------------------------------------------------------------- #
async def async_setup(_hass: HomeAssistant, _config) -> bool:
    """Configuración inicial de la integración (vacío)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configura HA Tracker desde una entrada de configuración."""

    # Mezcla de datos y opciones
    config: Dict[str, Any] = {**entry.data, **entry.options} if entry.options else entry.data

    domain_data: Dict[str, Any] = hass.data.setdefault(DOMAIN, {})
    domain_data["config"] = config

    # ------------------------------------------------------------------ #
    #  1. Obtener versión actual del manifest.json                       #
    # ------------------------------------------------------------------ #
    current_version: str | None = await get_version_from_manifest()
    if current_version is None:
        _LOGGER.error("Could not get version from manifest.json.")
        return False

    domain_data["version"] = current_version

    # ------------------------------------------------------------------ #
    #  2. registro de estáticos                                          #
    # ------------------------------------------------------------------ #
    await hass.http.async_register_static_paths([
        StaticPathConfig(url_path="/ha-tracker", path=str(STATIC_DIR), cache_headers=True),
    ])

    # ------------------------------------------------------------------ #
    #  3. Registrar vistas REST (solo una vez)                           #
    # ------------------------------------------------------------------ #
    register_api_views(hass)

    # ------------------------------------------------------------------ #
    #  4. Registrar zonas                                                #
    # ------------------------------------------------------------------ #
    try:
        await register_zones(hass)
    except Exception as err:  # noqa: BLE001
        _LOGGER.error("Error while registering zones: %s", err)

    # ------------------------------------------------------------------ #
    #  5. Registrar panel lateral                                        #
    # ------------------------------------------------------------------ #
    await async_register_panel(
        hass=hass,
        frontend_url_path="ha_tracker",      # /ha-tracker
        webcomponent_name="ha-tracker-panel",      # <ha-tracker> (tu custom element)
        module_url = f"{PANEL_URL}?v={hass.data[DOMAIN]['version']}",                                   # mejor con ?v= para cache-busting
        sidebar_title="HA Tracker",
        sidebar_icon="mdi:crosshairs-gps",
        require_admin=config.get("only_admin", False),
        embed_iframe=True,                   # ← aquí la clave
    )    

    # ------------------------------------------------------------------ #
    #  6. BLUEPRINTS                                                     #
    # ------------------------------------------------------------------ #
    async def _install_blueprint(_event=None):
        try:
            await _ensure_blueprint(hass)
        except Exception as err:
            _LOGGER.error("Failed to install blueprint: %s", err)

    if hass.state == CoreState.running:
        await _install_blueprint()
    else:
        # IMPORTANTE: usar async_listen_once (callback async) — nada de create_task desde hilos
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _install_blueprint)

    # ------------------------------------------------------------------ #
    #  7. Añadir recurso Lovelace (versión + caché)                      #
    # ------------------------------------------------------------------ #
    async def _register_resources(_event=None):
        await _ensure_lovelace_resource(hass, CARD_URL)

    if hass.state == CoreState.running:
        await _ensure_lovelace_resource(hass, CARD_URL)
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_resources)

    # Escuchar cambios de opciones
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # ------------------------------------------------------------------ #
    #  8. Pre-cargar la caché de reverse geocode                         #
    # ------------------------------------------------------------------ #
    await async_init_reverse_cache(hass)

    return True


# --------------------------------------------------------------------------- #
#  RELOAD / UNLOAD                                                            #
# --------------------------------------------------------------------------- #
async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Recargar la integración al cambiar opciones desde la UI."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Desinstalar completamente la integración."""

    # Eliminar zonas
    await unregister_zones(hass)

    # Quitar panel personalizado
    try:
        await async_remove_panel(hass, "ha_tracker")
    except Exception as err:
        _LOGGER.error("Error removing HA Tracker panel: %s", err)

    # Quitar recurso de Lovelace
    await _remove_lovelace_resource(hass, CARD_URL)

    # Limpiar datos
    hass.data.pop(DOMAIN, None)

    return True

# --------------------------------------------------------------------------- #
#  MANEJO DEL RECURSO LOVELACE                                                #
# --------------------------------------------------------------------------- #
async def _ensure_lovelace_resource(
    hass: HomeAssistant,
    path: str,  # «/ha-tracker/ha-tracker-card.js»
) -> None:
    """Añade o actualiza un recurso Lovelace sin tocar los demás."""
    ll = hass.data.get("lovelace")
    resources: ResourceStorageCollection | None = getattr(ll, "resources", None)  # type: ignore[attr-defined]

    if resources is None:
        _LOGGER.warning("Lovelace resources not ready yet")
        return

    version = hass.data[DOMAIN].get("version", "0")
    expected_url = f"{path}?v={version}"

    # Todos los recursos que son *exactamente* ese archivo
    matches = [it for it in resources.async_items() if _base(it["url"]) == path]

    if matches:
        # Quedarse con el primero → actualizar si hace falta
        main = matches[0]
        if main["url"] != expected_url:
            await resources.async_update_item(main["id"], {"url": expected_url})
        # Eliminar duplicados, si existieran
        for dup in matches[1:]:
            await resources.async_delete_item(dup["id"])
    else:
        # No existe todavía → crearlo
        await resources.async_create_item({"res_type": "module", "url": expected_url})

async def _remove_lovelace_resource(hass: HomeAssistant, path: str) -> None:
    resources = getattr(hass.data.get("lovelace"), "resources", None)
    if not resources:
        return

    ids_to_delete = [item["id"] for item in resources.async_items() if _base(item["url"]) == path]

    for res_id in ids_to_delete:
        await resources.async_delete_item(res_id)


# --------------------------------------------------------------------------- #
#  BLUEPRINTS                                                                 #
# --------------------------------------------------------------------------- #
async def _ensure_blueprint(hass: HomeAssistant) -> None:
    """Copia el blueprint interno a la carpeta de HA si está ausente o ha cambiado,
    sin bloquear el event loop."""
    # Ruta del blueprint dentro del paquete de la integración
    src_path = Path(__file__).parent / "blueprints" / "persons_in_zones_alert.yaml"

    # Carpeta destino (dentro de /config)
    bp_dir = Path(hass.config.path("blueprints/automation/ha_tracker"))
    # mkdir es I/O → ejecutor
    await hass.async_add_executor_job(partial(bp_dir.mkdir, parents=True, exist_ok=True))
    dest = bp_dir / src_path.name

    # Leer fuente (async)
    async with aiofiles.open(src_path, "r", encoding="utf-8") as f:
        yaml_text = await f.read()

    # Leer destino (async) si existe; evitar Path.exists() sincrono
    current: str | None = None
    try:
        async with aiofiles.open(dest, "r", encoding="utf-8") as f:
            current = await f.read()
    except FileNotFoundError:
        current = None

    if current != yaml_text:
        async with aiofiles.open(dest, "w", encoding="utf-8") as f:
            await f.write(yaml_text)

# --------------------------------------------------------------------------- #
#  UTILIDADES                                                                 #
# --------------------------------------------------------------------------- #
async def get_version_from_manifest() -> str | None:
    """Leer versión desde manifest.json (asíncrono)."""
    manifest_path = Path(__file__).parent / "manifest.json"

    try:
        async with aiofiles.open(manifest_path, "r", encoding="utf-8") as file:
            manifest_data = await file.read()
        manifest_json = json.loads(manifest_data)
        return manifest_json.get("version")
    except (OSError, json.JSONDecodeError) as err:
        _LOGGER.error("Error reading manifest.json: %s", err)
        return None


def _base(u: str) -> str:
    """Devuelve la URL sin query ni fragmento."""
    parts = list(urlsplit(u))
    parts[3] = parts[4] = ""  # query, fragment
    return urlunsplit(parts)
