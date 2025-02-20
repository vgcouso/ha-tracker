# test_post_install.py

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from custom_components.ha_tracker.post_install import copy_www_files

@pytest.fixture
def hass():
    """Mock de HomeAssistant."""
    hass = MagicMock()
    # OJO: Usar MagicMock en lugar de AsyncMock, porque config.path es sincrónico
    hass.config.path = MagicMock(side_effect=lambda *args: f"/mock_path/{'/'.join(args)}")
    return hass

@pytest.mark.asyncio
@patch('custom_components.ha_tracker.post_install.os.path.exists', return_value=True)
@patch('custom_components.ha_tracker.post_install.asyncio.to_thread', new_callable=AsyncMock)
@patch('custom_components.ha_tracker.post_install.aiofiles.open')
async def test_copy_www_files_same_version(mock_aiofiles_open, to_thread_mock, path_exists_mock, hass):
    """
    Escenario 1: la versión instalada coincide con la actual,
    no se copia nada => no se llama a to_thread.
    """
    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value='1.0.0')
    mock_aiofiles_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_aiofiles_open.return_value.__aexit__ = AsyncMock(return_value=None)

    await copy_www_files(hass, '1.0.0')
    to_thread_mock.assert_not_called()

@pytest.mark.asyncio
@patch('custom_components.ha_tracker.post_install.os.path.exists', return_value=True)
@patch('custom_components.ha_tracker.post_install.asyncio.to_thread', new_callable=AsyncMock)
@patch('custom_components.ha_tracker.post_install.aiofiles.open')
async def test_copy_www_files_diff_version(mock_aiofiles_open, to_thread_mock, path_exists_mock, hass):
    """
    Escenario 2: la versión instalada difiere de la actual,
    sí se copian archivos => se llama a to_thread.
    """
    mock_file = AsyncMock()
    mock_file.read = AsyncMock(return_value='1.0.1')
    mock_aiofiles_open.return_value.__aenter__ = AsyncMock(return_value=mock_file)
    mock_aiofiles_open.return_value.__aexit__ = AsyncMock(return_value=None)

    await copy_www_files(hass, '1.0.0')
    to_thread_mock.assert_called()
