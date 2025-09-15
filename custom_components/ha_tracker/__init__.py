"""Módulo de inicialización para HA Tracker"""
from __future__ import annotations

import json
import logging
import os
import shutil
import asyncio
import aiofiles
import re

from datetime import timedelta
from functools import partial
from typing import Any, Dict
from urllib.parse import urlsplit, urlunsplit
from pathlib import Path

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
from homeassistant.const import EVENT_COMPONENT_LOADED
from homeassistant.helpers import entity_registry as er


from .api import register_api_views
from .api.zones import register_zones, unregister_zones
from .api.reverse_geocode import async_init_reverse_cache
from .const import DOMAIN, INSTALLED_VERSION_FILE
from .post_install import copy_www_files


# --------------------------------------------------------------------------- #
#  CONFIGURACIÓN BÁSICA                                                       #
# --------------------------------------------------------------------------- #

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_LOGGER = logging.getLogger(__name__)


BASE_JS_PANEL = "/local/ha-tracker/ha-tracker-panel.js"
BASE_JS_CARD = "/local/ha-tracker/ha-tracker-card.js"
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
    #  2. Copiar archivos frontend a /www si hace falta                  #
    # ------------------------------------------------------------------ #
    try:
        copied, prev_version = await copy_www_files(hass, current_version)
        if copied and hass.state == CoreState.running:
            hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))
            return True
    except (OSError, ValueError) as err:
        _LOGGER.error("Error copying client files: %s", err)

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
        frontend_url_path="ha-tracker",      # /ha-tracker
        webcomponent_name="ha-tracker-panel",      # <ha-tracker> (tu custom element)
        module_url = f"{BASE_JS_PANEL}?v={hass.data[DOMAIN]['version']}",                                   # mejor con ?v= para cache-busting
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
    #  7.                                                                #
    #     GPSLogger                                                      # 
    #     OwnTracks                                                      #
    # ------------------------------------------------------------------ #
    async def _refresh_mobile_configs(_now=None):
        # Idempotentes: solo escriben si hay cambios
        await ensure_gpslogger_properties(hass)
        await ensure_owntracks_otrc(hass)

    # 1) Arranque: refrescar al inicio
    if hass.state == CoreState.running:
        await _refresh_mobile_configs()
    else:
        async def _on_started(_event):
            await _refresh_mobile_configs()

        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)

    # 2) Refresco automático periódico (simple y robusto)
    unsub_refresh = async_track_time_interval(hass, _refresh_mobile_configs, timedelta(seconds=30))
    entry.async_on_unload(unsub_refresh)

    # ------------------------------------------------------------------ #
    #  8. Añadir recurso Lovelace (versión + caché)                      #
    # ------------------------------------------------------------------ #
    async def _register_resources(_event=None):
        await _ensure_lovelace_resource(hass, BASE_JS_CARD)

    if hass.state == CoreState.running:
        await _ensure_lovelace_resource(hass, BASE_JS_CARD)
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_resources)

    # Escuchar cambios de opciones
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # ------------------------------------------------------------------ #
    #  9. Pre-cargar la caché de reverse geocode                         #
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
        await async_remove_panel(hass, "ha-tracker")
    except Exception as err:
        _LOGGER.error("Error removing HA Tracker panel: %s", err)

    # Quitar recurso de Lovelace
    await _remove_lovelace_resource(hass, BASE_JS_CARD)

    # Limpiar datos
    hass.data.pop(DOMAIN, None)

    return True

async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Se llama cuando el usuario elimina la integración desde la UI."""
    file_path = hass.config.path(".storage", INSTALLED_VERSION_FILE)
    folder_path = hass.config.path("www/ha-tracker")

    if os.path.exists(file_path):
        try:
            await hass.async_add_executor_job(os.remove, file_path)
        except OSError as err:
            _LOGGER.error("Error deleting file %s: %s", file_path, err)

    if os.path.exists(folder_path):
        try:
            await hass.async_add_executor_job(shutil.rmtree, folder_path)
        except OSError as err:
            _LOGGER.error("Error deleting folder %s: %s", folder_path, err)

# --------------------------------------------------------------------------- #
#  MANEJO DEL RECURSO LOVELACE                                                #
# --------------------------------------------------------------------------- #
async def _ensure_lovelace_resource(
    hass: HomeAssistant,
    path: str,  # «/local/ha-tracker/ha-tracker-card.js»
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
#  OwnTracks                                                                  #
# --------------------------------------------------------------------------- #

async def get_owntracks_webhook_url(hass: HomeAssistant) -> str | None:
    entries = hass.config_entries.async_entries(domain="owntracks")
    if not entries:
        return None

    entry = entries[0]

    # 1) Si HA guardó la URL del cloudhook, úsala
    cloudhook = entry.data.get("cloudhook_url")
    if cloudhook:
        return cloudhook

    # 2) Si cloudhook está desactivado, construir URL local/externa
    webhook_id = entry.data.get("webhook_id")
    if not webhook_id:
        return None

    base_url = get_url(hass, prefer_external=True)
    return f"{base_url}/api/webhook/{webhook_id}"

async def ensure_owntracks_otrc(hass: HomeAssistant) -> None:
    url = await get_owntracks_webhook_url(hass)
    if not url:
        return

    dest = Path(hass.config.path(BASE_OWNTRACKS))
    await hass.async_add_executor_job(partial(dest.parent.mkdir, parents=True, exist_ok=True))

    # Cargar JSON existente (si no existe, vacío)
    try:
        async with aiofiles.open(dest, "r", encoding="utf-8") as f:
            raw = await f.read()
        try:
            cfg = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            _LOGGER.warning("Contenido JSON inválido en %s; se regenerará parcialmente.", dest)
            cfg = {}
    except FileNotFoundError:
        cfg = {}

    cfg.setdefault("_type", "configuration")
    if cfg.get("url") != url:
        cfg["url"] = url

    entries = hass.config_entries.async_entries(domain="owntracks")
    if entries:
        secret = entries[0].data.get("secret") or entries[0].options.get("secret")
        if secret and cfg.get("encryptionKey") != secret:
            cfg["encryptionKey"] = secret

    new_text = json.dumps(
        cfg,
        ensure_ascii=False,
        indent=2,
        separators=(', ', ' : ')
    ) + "\n"

    try:
        async with aiofiles.open(dest, "r", encoding="utf-8") as f:
            old_text = await f.read()
    except FileNotFoundError:
        old_text = ""

    if new_text != old_text:
        async with aiofiles.open(dest, "w", encoding="utf-8") as f:
            await f.write(new_text)

# --------------------------------------------------------------------------- #
#  GPSLogger                                                                 #
# --------------------------------------------------------------------------- #

async def get_gpslogger_webhook_url(hass: HomeAssistant) -> str | None:
    entries = hass.config_entries.async_entries(domain="gpslogger")
    if not entries:
        return None

    entry = entries[0]

    # 1) Nabu Casa (cloudhook) tiene prioridad
    cloudhook = entry.data.get("cloudhook_url")
    if cloudhook:
        return cloudhook

    # 2) URL local/externa con webhook_id
    webhook_id = entry.data.get("webhook_id")
    if not webhook_id:
        return None

    base_url = get_url(hass, prefer_external=True)
    return f"{base_url}/api/webhook/{webhook_id}"

async def ensure_gpslogger_properties(hass: HomeAssistant) -> None:
    url = await get_gpslogger_webhook_url(hass)  
    if not url:
        return

    dest = Path(hass.config.path(BASE_GPSLOGGER))
    # Asegurar carpeta /config/www/ha-tracker
    await hass.async_add_executor_job(
        partial(dest.parent.mkdir, parents=True, exist_ok=True)
    )

    # Leer contenido actual (si existe)
    try:
        async with aiofiles.open(dest, "r", encoding="utf-8") as f:
            content = await f.read()
    except FileNotFoundError:
        content = ""

    # Reemplazar o añadir la línea log_customurl_url=
    if re.search(r"^log_customurl_url\s*=.*$", content, flags=re.M):
        new_content = re.sub(
            r"^log_customurl_url\s*=.*$",
            f"log_customurl_url={url}",
            content,
            flags=re.M,
        )
    else:
        if content and not content.endswith("\n"):
            content += "\n"
        new_content = content + f"log_customurl_url={url}\n"

    # Escribir sólo si hay cambios
    if new_content != content:
        async with aiofiles.open(dest, "w", encoding="utf-8") as f:
            await f.write(new_content)

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
