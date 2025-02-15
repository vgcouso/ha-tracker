"""Operaciones a realizar después de la instalación"""

import asyncio  # Para ejecutar funciones bloqueantes en otro hilo
import logging
import os
import shutil
import stat

import aiofiles  # Para operaciones de archivo asíncronas
from homeassistant.core import HomeAssistant  # Importamos HomeAssistant

from .const import INSTALLED_VERSION_FILE

_LOGGER = logging.getLogger(__name__)


async def copy_www_files(hass: HomeAssistant, current_version: str):
    """Copiar archivos del cliente a la carpeta www/ha-tracker"""
    source_dir = os.path.join(os.path.dirname(__file__), "www")
    target_dir = hass.config.path("www/ha-tracker")

    marker_file = hass.config.path(".storage", INSTALLED_VERSION_FILE)

    # Verificar si ya se copió esta versión (lectura asíncrona)
    if os.path.exists(marker_file):
        try:
            async with aiofiles.open(marker_file, "r") as f:
                installed_version = await f.read()
            if installed_version.strip() == current_version:
                return
        except (OSError, PermissionError, FileNotFoundError) as e:
            _LOGGER.warning("Can't read %s: %s", marker_file, e)

    # Verificar si el directorio fuente existe
    if not os.path.exists(source_dir):
        _LOGGER.warning("The source directory %s does not exist.", source_dir)
        return

    # Crear el directorio de destino si no existe
    await asyncio.to_thread(os.makedirs, target_dir, exist_ok=True)

    # Copiar archivos y carpetas en un hilo separado
    await asyncio.to_thread(copy_tree_sync, source_dir, target_dir)

    # Ajustar permisos de la carpeta y los archivos copiados
    await asyncio.to_thread(set_permissions, target_dir)

    # Guardar la versión actual en el archivo marcador
    try:
        async with aiofiles.open(marker_file, "w") as f:
            await f.write(str(current_version))
    except (OSError, PermissionError, IOError) as e:
        _LOGGER.error("Error writing version file %s: %s", marker_file, e)


def copy_tree_sync(source_dir, target_dir):
    """Copia síncrona de archivos y directorios."""
    for item in os.listdir(source_dir):
        src_path = os.path.join(source_dir, item)
        dest_path = os.path.join(target_dir, item)

        if os.path.isdir(src_path):
            shutil.copytree(src_path, dest_path, dirs_exist_ok=True)
        else:
            shutil.copy2(src_path, dest_path)


def set_permissions(path):
    """Establecer permisos de lectura y escritura"""
    for root, dirs, files in os.walk(path):
        for dir_name in dirs:
            os.chmod(
                os.path.join(root, dir_name),
                stat.S_IRWXU
                | stat.S_IRGRP
                | stat.S_IXGRP
                | stat.S_IROTH
                | stat.S_IXOTH,
            )
        for file_name in files:
            os.chmod(
                os.path.join(root, file_name),
                stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH,
            )
