import os
import shutil
import logging
import stat
import aiofiles  # Para operaciones de archivo asíncronas
import asyncio   # Para ejecutar funciones bloqueantes en otro hilo

_LOGGER = logging.getLogger(__name__)

MARKER_FILE = os.path.join(os.path.dirname(__file__), ".installed_version")

async def copy_www_files(current_version):
    """Copiar archivos del cliente a la carpeta www/ha-tracker de forma asíncrona."""
    source_dir = os.path.join(os.path.dirname(__file__), "www")
    target_dir = os.path.join(os.getenv("HASS_CONFIG", "/config"), "www", "ha-tracker")

    # Verificar si ya se copió esta versión (lectura asíncrona)
    if os.path.exists(MARKER_FILE):
        try:
            async with aiofiles.open(MARKER_FILE, "r") as f:
                installed_version = await f.read()
            if installed_version.strip() == current_version:
                _LOGGER.info("Archivos del cliente ya están actualizados. No es necesario copiarlos.")
                return
        except Exception as e:
            _LOGGER.warning(f"No se pudo leer {MARKER_FILE}: {e}")

    # Verificar si el directorio fuente existe
    if not os.path.exists(source_dir):
        _LOGGER.warning(f"El directorio fuente {source_dir} no existe.")
        return

    # Crear el directorio de destino si no existe
    await asyncio.to_thread(os.makedirs, target_dir, exist_ok=True)

    # Copiar archivos y carpetas en un hilo separado
    await asyncio.to_thread(copy_tree_sync, source_dir, target_dir)

    # Ajustar permisos de la carpeta y los archivos copiados en un hilo separado
    await asyncio.to_thread(set_permissions, target_dir)

    # Guardar la versión actual en el archivo marcador (escritura asíncrona)
    try:
        async with aiofiles.open(MARKER_FILE, "w") as f:
            await f.write(str(current_version))
        _LOGGER.info(f"Versión {current_version} guardada en {MARKER_FILE}.")
    except Exception as e:
        _LOGGER.error(f"Error al escribir el archivo de versión {MARKER_FILE}: {e}")

    _LOGGER.info(f"Archivos copiados de {source_dir} a {target_dir}.")

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
    """Establecer permisos de lectura y escritura para el propietario y lectura para otros."""
    for root, dirs, files in os.walk(path):
        for dir_name in dirs:
            os.chmod(os.path.join(root, dir_name), stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
        for file_name in files:
            os.chmod(os.path.join(root, file_name), stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    _LOGGER.info(f"Permisos ajustados para {path}.")
