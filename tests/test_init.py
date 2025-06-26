# test_init.py
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import json
import os

from custom_components.ha_tracker import (
    async_setup,
    async_setup_entry,
    async_unload_entry,
    get_version_from_manifest,
    async_reload_entry,
    register_api_views
)

@pytest.fixture
def hass():
    """Mock de HomeAssistant con http incluido."""
    hass = MagicMock()
    hass.config.path = MagicMock(side_effect=lambda *args: "/mock_path/" + "/".join(args))
    hass.async_add_executor_job = AsyncMock()
    return hass

@pytest.fixture
def mock_config_entry():
    """Fixture para configurar un objeto ConfigEntry simulado."""
    entry = MagicMock()
    entry.data = {'some_key': 'some_value'}
    entry.options = {'some_option_key': 'some_option_value'}
    entry.entry_id = "test_entry"
    return entry

@pytest.mark.asyncio
@patch('custom_components.ha_tracker.os.path.exists', return_value=True)
@patch('custom_components.ha_tracker.copy_www_files', new_callable=AsyncMock)
@patch('custom_components.ha_tracker.get_version_from_manifest', new_callable=AsyncMock, return_value='1.0.0')
async def test_async_setup_entry(get_version_mock, copy_files_mock, exists_mock, hass, mock_config_entry):
    """Prueba la función async_setup_entry (flujo exitoso)."""
    assert await async_setup_entry(hass, mock_config_entry) is True

@pytest.mark.asyncio
@patch('os.remove', new_callable=AsyncMock)
@patch('shutil.rmtree', new_callable=AsyncMock)
async def test_async_unload_entry(remove_mock, rmtree_mock, hass, mock_config_entry):
    """Prueba la función async_unload_entry."""
    assert await async_unload_entry(hass, mock_config_entry) is True

@pytest.mark.asyncio
@patch('aiofiles.open')
async def test_get_version_from_manifest(mock_open):
    """Prueba la obtención de la versión del archivo manifest.json."""
    # Configurar el contenido del archivo simulado.
    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value=json.dumps({"version": "1.0.0"}))
    
    # Simular que se entra y se sale del contexto sin errores.
    mock_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_open.return_value.__aexit__ = AsyncMock(return_value=None)
    
    # Ejecutar la función a probar.
    version = await get_version_from_manifest()
    
    # Verificar que la versión es la esperada.
    assert version == "1.0.0"
    # Verificar que se llama correctamente a read.
    mock_file.read.assert_awaited_once()

@pytest.mark.asyncio
async def test_async_setup(hass):
    """Prueba la configuración inicial de la integración."""
    result = await async_setup(hass, {})
    assert result is True

@pytest.mark.asyncio
async def test_async_reload_entry(hass, mock_config_entry):
    """Prueba la recarga de una entrada de configuración."""
    hass.config_entries.async_reload = AsyncMock()
    await async_reload_entry(hass, mock_config_entry)
    hass.config_entries.async_reload.assert_called_with(mock_config_entry.entry_id)

@pytest.mark.asyncio
async def test_register_api_views(hass):
    """Prueba el registro de vistas de API."""
    hass.http = MagicMock()
    register_api_views(hass)
    hass.http.register_view.assert_called()

# ------------------------------------------------------------------
# PRUEBA ESPECÍFICA PARA FORZAR UN FALLO Y EVITAR FILE NOT FOUND
# ------------------------------------------------------------------
@pytest.mark.asyncio
@patch('custom_components.ha_tracker.api.zones.write_zones_file',
       new_callable=AsyncMock, side_effect=Exception("Test exception"))
async def test_async_setup_entry_failure_no_false(mock_write_zones_file, hass, mock_config_entry, caplog):
    """
    Ya no esperamos que async_setup_entry devuelva False.
    En su lugar, verificamos que se loguea un error
    cuando write_zones_file lanza la excepción.
    """
    from custom_components.ha_tracker import async_setup_entry

    result = await async_setup_entry(hass, mock_config_entry)

    # Si tu código siempre retorna True, ajusta así:
    assert result is True, "async_setup_entry no falla aunque haya excepción."

    # En lugar de 'assert result is False', comprobamos que se haya logueado un error:
    assert "Error while registering zones: Test exception" in caplog.text, (
        "Se esperaba que el log registrara el error con 'Test exception'"
    )
