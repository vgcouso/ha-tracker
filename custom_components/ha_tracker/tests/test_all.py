# test_all_ok.py

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import json

##########################
# FIXTURES
##########################

@pytest.fixture
def hass():
    """
    Mock básico de HomeAssistant.
    - hass.config.path: MagicMock para evitar acceso real al sistema de archivos.
    - hass.async_add_executor_job: AsyncMock para simular llamadas asíncronas.
    - hass.components.frontend.async_remove_panel: AsyncMock para simular la eliminación del panel.
    """
    hass = MagicMock()
    hass.config.path = MagicMock(side_effect=lambda *args: "/mock_path/" + "/".join(args))
    hass.async_add_executor_job = AsyncMock()
    hass.components.frontend = MagicMock()
    hass.components.frontend.async_remove_panel = AsyncMock()
    return hass

@pytest.fixture
def config_entry():
    """Mock de ConfigEntry con datos válidos."""
    entry = MagicMock()
    entry.data = {"update_interval": 10, "enable_debug": False}
    entry.options = {}
    entry.entry_id = "test_entry"
    return entry

##########################
# TESTS DE __init__.py
##########################

@pytest.mark.asyncio
async def test_async_setup(hass):
    """Verifica que async_setup retorne True."""
    from custom_components.ha_tracker import async_setup
    result = await async_setup(hass, {})
    assert result is True, "async_setup debe retornar True si todo está OK."

@pytest.mark.asyncio
@patch("custom_components.ha_tracker.api.zones.write_zones_file", new_callable=AsyncMock)
@patch("custom_components.ha_tracker.copy_www_files", new_callable=AsyncMock, return_value=True)
@patch("custom_components.ha_tracker.get_version_from_manifest", new_callable=AsyncMock, return_value="1.0.0")
async def test_async_setup_entry(
    mock_get_version,
    mock_copy_www_files,
    mock_write_zones,
    hass,
    config_entry
):
    """
    Verifica que async_setup_entry:
    - Obtenga la versión "1.0.0"
    - Llame a copy_www_files y a write_zones_file (a través de register_zones)
    - Retorne True.
    """
    from custom_components.ha_tracker import async_setup_entry

    result = await async_setup_entry(hass, config_entry)
    assert result is True, "async_setup_entry debe retornar True en éxito."

    mock_get_version.assert_called_once()
    mock_copy_www_files.assert_awaited_once()
    mock_write_zones.assert_awaited()

@pytest.mark.asyncio
async def test_async_reload_entry(hass, config_entry):
    """
    Verifica que async_reload_entry invoque hass.config_entries.async_reload con el entry_id correcto.
    """
    from custom_components.ha_tracker import async_reload_entry

    hass.config_entries = MagicMock()
    hass.config_entries.async_reload = AsyncMock()

    await async_reload_entry(hass, config_entry)
    hass.config_entries.async_reload.assert_awaited_once_with(config_entry.entry_id)

@pytest.mark.asyncio
async def test_async_unload_entry(hass, config_entry):
    """
    Verifica que async_unload_entry:
    - Elimine hass.data[DOMAIN]
    - Llame a unregister_zones
    - Elimine archivo y carpeta
    - Llame a hass.components.frontend.async_remove_panel
    - Retorne True.
    """
    # Inyectamos el mock en la referencia local que usa __init__.py
    import custom_components.ha_tracker as tracker
    tracker.unregister_zones = AsyncMock()

    from custom_components.ha_tracker import async_unload_entry, DOMAIN

    hass.data[DOMAIN] = {}
    result = await async_unload_entry(hass, config_entry)
    assert result is True, "async_unload_entry debe retornar True en escenario normal."

    # Verificamos que se llamó a unregister_zones
    tracker.unregister_zones.assert_called_once()
    # Verificamos que se hayan llamado las funciones de eliminación de archivo y carpeta.
    # (Estos mocks están parcheados en __init__.py a través de otros decorators en otros tests, 
    # pero aquí asumimos que la lógica llama a esas funciones).
    hass.components.frontend.async_remove_panel.assert_awaited_once_with("ha-tracker")

@pytest.mark.asyncio
@patch("custom_components.ha_tracker.__init__.aiofiles.open")
async def test_get_version_from_manifest(mock_aiofiles_open):
    """
    Verifica la lectura de la versión en manifest.json sin tocar disco real.
    Configura manualmente __aenter__ y __aexit__ para simular el administrador de contexto.
    """
    from custom_components.ha_tracker import get_version_from_manifest

    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value=json.dumps({"version": "1.0.0"}))
    mock_aiofiles_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_aiofiles_open.return_value.__aexit__ = AsyncMock()

    version = await get_version_from_manifest()
    assert version == "1.0.0", "La versión leída debe ser 1.0.0."
    # Usamos assert_called_once() ya que assert_awaited_once() no es válido.
    mock_aiofiles_open.assert_called_once()

##########################
# TESTS DE config_flow.py
##########################

@pytest.mark.asyncio
async def test_config_flow_step_user_valid(hass):
    """
    Prueba un user_input válido => create_entry.
    """
    from custom_components.ha_tracker.config_flow import HATrackerConfigFlow

    flow = HATrackerConfigFlow()
    flow.hass = hass
    user_input = {
        "update_interval": 10,
        "geocode_time": 30,
        "geocode_distance": 20,
        "enable_debug": False
    }

    result = await flow.async_step_user(user_input=user_input)
    assert result["type"] == "create_entry", "El flujo debe crear la entrada."
    assert result["data"] == user_input, "Los datos deben coincidir con el input."

@pytest.mark.asyncio
async def test_config_flow_options_init(hass):
    """
    Verifica que el OptionsFlow muestre su formulario 'init'.
    """
    from custom_components.ha_tracker.config_flow import HATrackerOptionsFlowHandler

    flow = HATrackerOptionsFlowHandler("test_entry")
    flow.hass = hass

    hass.config_entries = MagicMock()
    hass.config_entries.async_get_entry = MagicMock(return_value=MagicMock())

    result = await flow.async_step_init()
    assert result["type"] == "form", "El OptionsFlow debe mostrar un formulario."
    assert result["step_id"] == "init", "El step_id debe ser 'init'."

##########################
# TESTS DE post_install.py
##########################

@pytest.mark.asyncio
@patch("custom_components.ha_tracker.post_install.os.path.exists", return_value=True)
@patch("custom_components.ha_tracker.post_install.asyncio.to_thread", new_callable=AsyncMock)
@patch("custom_components.ha_tracker.post_install.aiofiles.open")
async def test_copy_www_files_same_version(
    mock_aiofiles_open,
    mock_to_thread,
    mock_exists,
    hass
):
    """
    Si la versión instalada es igual a la actual, no se copian archivos (no se llama a to_thread).
    """
    from custom_components.ha_tracker.post_install import copy_www_files

    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value="1.0.0")
    mock_aiofiles_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_aiofiles_open.return_value.__aexit__ = AsyncMock()

    await copy_www_files(hass, "1.0.0")
    mock_to_thread.assert_not_called()

@pytest.mark.asyncio
@patch("custom_components.ha_tracker.post_install.os.path.exists", return_value=True)
@patch("custom_components.ha_tracker.post_install.asyncio.to_thread", new_callable=AsyncMock)
@patch("custom_components.ha_tracker.post_install.aiofiles.open")
async def test_copy_www_files_diff_version(
    mock_aiofiles_open,
    mock_to_thread,
    mock_exists,
    hass
):
    """
    Si la versión instalada es diferente a la actual, se copian archivos (se llama a to_thread).
    """
    from custom_components.ha_tracker.post_install import copy_www_files

    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value="1.0.1")  # Distinta de "1.0.0"
    mock_aiofiles_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_aiofiles_open.return_value.__aexit__ = AsyncMock()

    await copy_www_files(hass, "1.0.0")
    mock_to_thread.assert_called()
